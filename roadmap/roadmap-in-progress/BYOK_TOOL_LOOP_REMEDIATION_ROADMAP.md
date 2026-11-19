# BYOK Tool-Loop Remediation Roadmap

**Status:** In progress — Findings 1–10 and 12 implemented (2026-08-07). Follow-up reliability and
timeline fixes landed 2026-08-10. Finding 11 remains blocked (see Implementation Status).

**2026-08-10 follow-up:** BYOK now emits normalized `tool_started` events before MCP execution,
recovers once from actionable planning text or an empty post-inspection response, feeds thrown tool
errors back into the model, preserves useful partial work when the provider fails, and orders mobile
history broadcasts by `timeline_order` rather than wall-clock timestamps. Interrupted single text
segments are now persisted as well.

## Implementation Status (2026-08-07)

| # | Finding | Status | Where |
|---|---------|--------|-------|
| 1 | BYOK tool calls not persisted as renderable history | ✅ Done | `chat-handlers.ts` `onToolFinished` now inserts a `role='tool-call'` message row (same `__type:'tool-call'` shape as CLI), ordered via `byokNextOccurrenceAt()` |
| 2 | Interstitial assistant text dropped | ✅ Done | `tool-loop.ts` streams `result.content` on tool-calling rounds, keeps it in `fullResponse` and as the assistant message content |
| 3 | No cross-turn tool memory | ✅ Done (digest) | `buildToolHistoryDigest()` folds a bounded digest of prior tool actions into the system prompt. Full synthetic assistant/tool replay (option 1) intentionally not done — would break OpenAI's pairing contract |
| 5 | Reasoning lost in OpenAI tool loop | ✅ Done | `sendOpenAIWithTools` forwards `message.reasoning`/`reasoning_content` via thinking callbacks; dispatch threads `thinkingCallbacks` into the tool-loop callers |
| 6 | One transient error kills the turn | ✅ Done | `provider-resilience.ts` `callWithResilience` — bounded exponential-backoff retry on 429/5xx + transient network errors, wrapping every tool-loop caller |
| 7 | Malformed tool args silently become `{}` | ✅ Done | `parseToolArguments` (repair + `argsError`); `tool-loop.ts` feeds the parse error back as the tool result instead of running with `{}` |
| 8 | `required`/`any` rejected by some endpoints | ✅ Done | `callWithResilience` downgrades `required`→`auto` once on rejection |
| 9 | Usage/cost not recorded for tool-loop turns | ✅ Done | `*WithTools` parse `usage`; `tool-loop.ts` forwards each round's usage via new `onUsage` param → `recordServerUsage` |
| 12 | `onModel` not wired for Anthropic tool loop | ✅ Done | Anthropic branch now passes `onModel` |
| 4 | Entire tool loop is non-streaming | ✅ Done (final answer) | `runProviderMcpToolLoop` takes a `finalStreamCaller`; the terminal answer streams token-by-token via `sendOpenAIMessage`/`sendAzureMessage`/new `sendAnthropicMessagesStream` (history-aware via `toAnthropicMessages`). Safe fallback to the non-streaming forced-'none' caller when the stream errors *before* emitting. Intra-loop token streaming (a streaming tool-call parser) is still future work |
| 10 | Stop can't interrupt in-flight tool round | ✅ Done | `httpsRequestUrl` takes an `abortKey` (conversation id) → `requestWithResponse` registers the in-flight non-streaming request in `activeStreamingRequests`, so `abortActiveStream(conversationId)` cancels it. `requestWithResponse` now rejects on close-before-settle so a bare `req.destroy()` never hangs. `conversationId` threaded through `sendOpenAIWithTools`/`sendAzureWithTools`/`sendAnthropicWithTools` and dispatch. The streamed final answer is abortable automatically (it uses `runStreamingRequest`) |
| 11 | Context budget crude for large-context models | ✅ Done | Tool loops use catalog context windows and model fallbacks, count schemas/reasoning/images, reserve output capacity, and trim complete exchanges while retaining the current task |

**Tests added:** `tool-loop.test.ts` (interstitial text, malformed-arg feedback, usage forwarding), `openai-tool-args.test.ts` (arg repair/`argsError`), `provider-resilience.test.ts` (retry classification, backoff, `required`→`auto` downgrade), `chat.test.ts` (BYOK `tool-call` row persisted + ordered before the assistant message).

---

**Original status:** New / proposed
**Author:** investigation triggered by an OpenRouter (`anthropic/claude-opus-4.8`) agentic run that
attempted the full 20 tool iterations, had most calls fail, "abruptly stopped," and left **no tool
calls in the persisted chat history** afterward.
**Scope:** the BYOK provider path only (OpenAI / Anthropic / Azure / OpenRouter / Groq / Mistral /
Gemini / xAI). The Claude CLI / Codex CLI / Hermes adapter paths are the reference implementation we
are trying to reach parity with.

---

## 1. How the BYOK tool path actually works today

```
dispatchChatSend (chat-handlers.ts)
  └─ dispatchToProvider (chat-provider-dispatch.ts)
       └─ runProviderMcpToolLoop (tool-loop.ts)          ← up to MCP_MAX_ITERATIONS (20) rounds
            └─ caller = sendOpenAIWithTools / sendAnthropicWithTools / sendAzureWithTools
                 (all stream:false, one blocking request per round)
```

Per round the loop:
1. calls the provider **non-streaming** with the accumulated `loopMessages` + tool defs,
2. if the result has `toolCalls`, pushes an `assistant` message with `content: null` + the calls,
   runs each tool, pushes `tool` result messages, and loops,
3. if the result has **no** tool calls, `onChunk`s the text and returns,
4. after 20 rounds, makes one final `toolChoice: 'none'` call and returns its text.

Tool completions are surfaced live via `onToolFinished → turnEmitter.toolFinished(...)`
(chat-handlers.ts:1785, chat-turn-emitter.ts:182) and a minimal row is written to
`conversation_tool_calls` (tool-loop.ts:161) **for rating analytics only** (`tool_name`,
`server_name`, `success` — no args, no result, not renderable).

The final assistant **text** is persisted via `persistAssistantMessage` (chat-handlers.ts:1811).

---

## 2. Root-cause findings (ranked)

### Finding 1 — BYOK tool calls are never persisted as renderable history (**the reported bug**)
The CLI path persists every completed tool call as a `role='tool-call'` message row
(`persistCompletedCliToolCalls`, chat-handlers.ts:1155-1177). **The BYOK path has no equivalent.**
`turnEmitter.toolFinished` only emits a *live* `chat:tool-call-event`; nothing writes a durable row.

Consequence: while the turn is streaming, the desktop/Android UI shows the tool calls (from live
events), but the moment the client reloads from the DB — which `broadcastConversationMessages`
(chat-handlers.ts:132) triggers at the end of *every* turn, and which every fresh open does — the
tool calls vanish, leaving only the final assistant text. This is exactly the "all the toolcalls
disappeared from the chat history" symptom.

- **Fix:** in the BYOK `onToolFinished` callback (chat-handlers.ts:1785), insert a `role='tool-call'`
  message row with the same `__type: 'tool-call'` JSON shape the CLI path uses
  (`toolCallId`, `toolName`, `serverName`, `toolArgs`, `toolResult`, `toolSuccess`), using a
  monotonic occurrence timestamp so ordering vs. assistant text is deterministic (mirror
  `nextOccurrenceAt` at chat-handlers.ts:1150). Persist *before* `broadcastConversationMessages`.
- **Tests:** extend `src/main/__tests__/chat.test.ts` (already asserts a `tool-call` message exists
  for the CLI path — add the BYOK equivalent) and `tool-loop.test.ts`.

### Finding 2 — Interstitial assistant text emitted alongside tool calls is dropped
When a round returns both text and tool calls, the loop pushes
`{ role: 'assistant', content: null, tool_calls: [...] }` (tool-loop.ts:224-232) — `result.content`
is **discarded**. It is neither streamed to the user nor kept in `loopMessages` for the model's own
continuity. Models like Opus routinely narrate ("Now let me find the parser…") *in the same message*
as a tool call; all of that is lost on BYOK, whereas the CLI path interleaves and persists text
bursts (`cliTextBuffer`, chat-handlers.ts:1183-1191).

- **Fix:** when `result.content` is non-empty on a tool-calling round, (a) `onChunk` it (as its own
  text segment) and (b) set it as the assistant message `content` instead of `null`. Persist it as
  an interleaved text segment so history reconstructs in order.

### Finding 3 — No cross-turn tool memory: "Continue from where you left off" starts blind
History fed to the provider filters out `role='tool-call'` rows (chat-handlers.ts:1582-1586) **and**
tool calls were never persisted for BYOK anyway (Finding 1). So a follow-up turn has zero record of
the 20 tool calls the previous turn made — only the final summary text. This is why "Continue from
where you left off" re-investigates from scratch ("Let me find the remaining files…") instead of
resuming.

- **Fix (design):** decide what tool history the model should see on subsequent turns. Options:
  1. Replay compacted `tool-call` rows as synthetic `assistant(tool_calls)`/`tool` message pairs
     when rebuilding provider context (preferred — true continuity, bounded by the same context
     budget logic), or
  2. At minimum, fold a short "actions taken last turn" digest into context.
  Must respect `MAX_LOOP_CONTEXT_CHARS` and compression. Applies to CLI paths too, but BYOK first.

### Finding 4 — The entire tool loop is non-streaming
`sendOpenAIWithTools` / `sendAnthropicWithTools` / `sendAzureWithTools` all send `stream: false`
(openai-provider.ts:242, anthropic-provider.ts:95). Every round — including the forced final answer
(tool-loop.ts:359) — arrives as one blob after the full round completes. UX is "thinking… (long
pause)… wall of text," unlike the CLI token stream. For long final answers this reads as a stall,
compounding the "abruptly stopped" impression.

- **Fix:** stream the terminal answer at minimum. The final `caller(..., 'none')` can route to the
  streaming `sendOpenAIMessage` / `sendAnthropicMessage` (which already stream and already emit
  reasoning deltas) rather than the non-streaming `*WithTools` variant. Longer term, adopt a
  streaming tool-call parser so intra-loop text/reasoning streams too.

### Finding 5 — Reasoning/thinking is lost in the OpenAI-compatible tool loop
`sendAnthropicWithTools` forwards `onThinkingChunk/onThinkingEnd` (anthropic-provider.ts:134-138),
but `sendOpenAIWithTools` accepts **no** thinking callbacks (openai-provider.ts:229-259). Reasoning
models behind OpenRouter/Groq/etc. therefore show no thinking during tool loops (only the
non-tool streaming path handles `delta.reasoning`, openai-provider.ts:140-144).

- **Fix:** thread thinking callbacks through `sendOpenAIWithTools`, or (with Finding 4) route
  through the streaming path which already handles reasoning deltas.

### Finding 6 — A single transient provider error aborts the whole turn and discards all work
Any throw from `caller` inside the loop (429 rate-limit, 5xx, socket reset, the OpenRouter spend
limit seen in the screenshot) propagates out of `runProviderMcpToolLoop`, is caught at
chat-handlers.ts:1798, and the turn is replaced by the error string. All 19 prior successful tool
results are thrown away. The only in-loop recovery is the narrow retry for the literal strings
`"No endpoints found that support tool use"` / `"...image input"` (chat-provider-dispatch.ts:256-265).

- **Fix:** wrap `caller` with bounded retry + backoff for retryable statuses (429/500/502/503/504 and
  transient network errors), honoring `Retry-After` where present. On non-retryable failure *after*
  useful work, degrade gracefully: return a partial answer summarizing completed tool results rather
  than discarding them.

### Finding 7 — Malformed tool-call arguments silently become `{}`
`extractToolCalls` does `JSON.parse(tc.function.arguments)` and returns `{}` on failure
(openai-provider.ts:64-71). A model that emits slightly invalid JSON (common with smaller/OSS
OpenRouter models) gets an empty-args tool invocation → `write_project_file` etc. fail → the loop
burns iterations on failures. This is a strong candidate for the "most of which failed" observation.

- **Fix:** on parse failure, (a) attempt a tolerant repair (trailing comma / concatenated-fragment
  reconstruction), and (b) if still invalid, feed the parse error back as the tool result
  (`Error: could not parse arguments as JSON: …`) so the model can self-correct, instead of running
  the tool with `{}`. Log the raw arguments under `debugLog('provider', …)`.

### Finding 8 — `tool_choice: 'required'` / `'any'` may be rejected by some endpoints
`forceFirstToolChoice` (chat-handlers.ts:1732) and the inspection-recovery step (tool-loop.ts:208)
force `required`. Several OpenRouter endpoints reject forced tool choice; that error currently isn't
in the retry allowlist (Finding 6), so it aborts the turn.

- **Fix:** add a fallback that retries the round with `tool_choice: 'auto'` when an endpoint rejects
  `required`/`any`, alongside the Finding 6 retry work.

### Finding 9 — Provider usage/cost is not recorded for tool-loop turns
`onUsage` is only wired into the streaming/non-tool paths (chat-provider-dispatch.ts:237, 258, 292);
`sendOpenAIWithTools` / `sendAnthropicWithTools` / `sendAzureWithTools` never call it. So
`recordServerUsage` (chat-handlers.ts:1770) records nothing for agentic BYOK turns, and `/usage`
undercounts the most expensive conversations.

- **Fix:** parse `usage` from each non-streaming tool-loop response and forward it via `onUsage`,
  accumulating across rounds.

### Finding 10 — "Stop" cannot interrupt an in-flight tool-loop request
`abortActiveStream` (provider-stream-state.ts) only aborts requests registered by the *streaming*
helpers. The non-streaming `httpsRequestUrl` calls the tool loop makes are not registered, so
pressing Stop during a BYOK tool round does nothing until the current request returns.
`assertConversationStartsAllowed()` (tool-loop.ts:188) only gates *between* rounds.

- **Fix:** register the in-flight non-streaming request against the conversation id so
  `chat:stop-generation` can abort it, and check the abort signal between tool executions.

### Finding 11 — Context budget is crude and over-aggressive for large-context models
`MAX_LOOP_CONTEXT_CHARS = 100000` (~25k tokens) and `MAX_TOOL_RESULT_CHARS = 16000` (tool-loop.ts:19,
31) are fixed and provider-agnostic. For a 200k-context Opus doing real multi-file edits this both
truncates individual file reads mid-content and drops earlier tool results with a
`[Earlier tool results were dropped…]` note (tool-loop.ts:70) — degrading exactly the multi-step
editing task in the screenshot.

- **Fix:** derive the budget from the model catalog's context window when available
  (`getCachedCatalog`, already imported in chat-provider-dispatch.ts), falling back to the current
  constants only when unknown. Keep the summarize-and-trim behavior but at a realistic ceiling.

### Finding 12 — `onModel` is not wired for the Anthropic tool-loop path
The Anthropic branch passes `undefined` for the `onModel` arg (chat-provider-dispatch.ts:183),
unlike the OpenAI/OpenRouter/Azure branches, so `handleStreamModel` never fires and the model label
may not update for native-Anthropic agentic turns. Minor, but a real inconsistency.

- **Fix:** pass `onModel` in the Anthropic branch too.

---

## 3. Suggested sequencing

**Phase 1 — Stop losing data (highest impact, matches the report):**
- Finding 1 (persist BYOK tool-call rows) — the headline bug.
- Finding 2 (keep interstitial assistant text).
- Finding 9 (usage) and Finding 12 (onModel) — cheap correctness wins in the same files.

**Phase 2 — Resilience:**
- Finding 6 (retry/backoff + partial-result degradation).
- Finding 7 (argument parse repair + feedback).
- Finding 8 (`required` → `auto` fallback).
- Finding 10 (abortable tool-loop requests).

**Phase 3 — Parity & UX:**
- Finding 4 (stream the final answer, then intra-loop streaming).
- Finding 5 (reasoning in the OpenAI-compatible tool loop).
- Finding 3 (cross-turn tool memory — enables real "Continue from where you left off").
- Finding 11 (catalog-driven context budget).

---

## 4. Files most affected

| File | Findings |
|------|----------|
| `src/main/chat-handlers.ts` | 1, 2, 3, 9, 12 (persist rows, interleave text, history replay) |
| `src/main/tool-loop.ts` | 2, 6, 7, 8, 10, 11 (loop control, retry, parse, abort, budget) |
| `src/main/chat-provider-dispatch.ts` | 4, 5, 6, 8, 12 (routing, retry, callbacks) |
| `src/main/providers/openai-provider.ts` | 5, 7, 9 (thinking callbacks, arg parsing, usage) |
| `src/main/providers/anthropic-provider.ts` | 9 (usage) |
| `src/main/chat-turn-emitter.ts` | 1 (optional: shared persistence helper) |

## 5. Test coverage to add
- `src/main/__tests__/tool-loop.test.ts`: BYOK `tool-call` rows persisted; interstitial text kept;
  malformed args fed back as errors; retry on 429/5xx; `required`→`auto` fallback; abort between
  rounds; usage accumulation.
- `src/main/__tests__/chat.test.ts`: after a BYOK agentic turn, reloading messages returns the
  `tool-call` rows in order (parity with the existing CLI assertion at chat.test.ts:649).
- `src/main/__tests__/conversation-export.test.ts`: BYOK tool-call rows export/round-trip like CLI.

# Roadmap: Hermes-First ACP Runtime Pilot

Drafted 2026-08-04. **Status: PROPOSED.**

## Executive summary

Nexy should use Hermes as the only production target for the first Agent Client Protocol (ACP) implementation. Claude and Codex are explicitly deferred until the Hermes pilot has been built, tested by the Nexy team, and approved to continue.

This is a deliberate vertical-slice strategy. The current Hermes integration is a synchronous `hermes -z` process that returns only final stdout. It does not provide a dependable interactive experience, streaming, tool lifecycle, permissions, or useful cancellation. Preserving that implementation through a broad multi-agent refactor would protect very little while delaying the first meaningful result.

The pilot should therefore connect native `hermes acp` to Nexy's existing product event boundary with the smallest sound architecture:

```text
Hermes Agent
    |
ACP v1 over stdio
    |
HermesAcpClient + HermesSessionManager
    |
existing CliAgentAdapter / CliStreamEvent boundary
    |
ChatTurnEmitter
    |
Desktop UI + existing Android remote UI
```

The implementation should be reusable where reuse is natural, but it must not build unverified Claude/Codex abstractions in advance. The purpose of the pilot is to learn whether ACP gives Nexy a reliable agent runtime boundary in practice.

## Decision in one sentence

**Make Hermes genuinely functional through ACP, prove the complete Nexy experience, stop for a go/no-go review, and only then consider another CLI.**

## Why Hermes only

### The existing Hermes path is not a useful safety rail

`src/main/cli-adapters/hermes.ts` currently:

- calls `spawnSync`, blocking useful streaming behavior;
- sends one prompt through `hermes -z`;
- only emits final text after the process exits;
- does not expose thinking or tool activity;
- cannot pause for Nexy's permission UI;
- cannot cancel a running turn through the adapter signal;
- does not preserve a live agent session between turns;
- reports no structured usage, diffs, terminal activity, or progress.

The legacy adapter may remain temporarily as an advanced diagnostic option, but the pilot should not spend an initial phase wrapping it in a new runtime architecture or claiming parity with it. ACP should become the default Hermes path once preflight succeeds.

### Hermes has a native ACP server

Hermes exposes `hermes acp` over stdio and documents streamed response/thinking chunks, tool activity, file diffs, terminal commands, approval prompts, working-directory binding, session-scoped models, and in-process sessions. It also provides non-interactive `--version` and `--check` commands. This makes Hermes the clearest way to test ACP without adding a separate vendor adapter.

### A single backend produces better evidence

A multi-CLI framework could hide backend-specific failures behind generalized interfaces. A Hermes-only slice lets the team answer concrete questions first:

- Does a real ACP turn render in correct text/tool/text order?
- Do dangerous commands reach Nexy's approval UI and default to deny safely?
- Does cancellation actually stop Hermes and its active work?
- Does a second prompt continue the same session correctly?
- Can Nexy isolate project MCP servers and workspace paths?
- Can the runtime be packaged, diagnosed, and recovered without confusing users?
- Is the experience reliable enough to justify applying the pattern elsewhere?

## Product and ownership mindset

### Nexy owns the experience

Nexy remains authoritative for:

- the persisted conversation and timeline;
- project/workspace trust and allowed roots;
- permission policy and approval presentation;
- audit records and file-change attribution;
- cancellation and emergency stop;
- desktop-to-Android events;
- user-facing status, errors, and setup guidance.

Hermes owns model execution, its tools, and its internal ACP session state. ACP owns the communication contract between them.

An ACP session ID is an execution handle, not the conversation database key. Hermes replay or internal history must never overwrite, reorder, or duplicate Nexy's stored transcript.

### ACP stays below the UI boundary

Raw JSON-RPC must not reach React, Android Compose, the database, or Nexy's WebSocket protocol. The pilot should translate ACP notifications into the existing `onChunk` and `CliStreamEvent` vocabulary wherever possible.

Only add a new normalized Nexy event when a required Hermes behavior cannot be represented correctly. Do not add generic plan, terminal, diff, or configuration UI merely because ACP supports it; those can follow after the basic runtime proves stable.

### Build for the evidence we have

Names may be generic where the implementation is genuinely protocol-level, such as `AcpStdioConnection`. Policy and conformance code should remain Hermes-specific, such as `HermesAcpSessionManager` and `mapHermesPermissionRequest`. This avoids encoding guesses about Claude or Codex while keeping low-level framing reusable.

### Failure must be visible and safe

There must be no silent fallback after Hermes accepts a prompt. A failed turn may already have run a command or edited a file, so automatically repeating it through `hermes -z` can duplicate side effects.

Fallback is allowed only during preflight, before `session/prompt` is accepted. After acceptance, Nexy should mark the turn interrupted, preserve all received events, clean up the process, and offer an explicit user-controlled retry.

## Scope

### In scope for the pilot

- Desktop execution of native `hermes acp`.
- ACP v1 stdio framing, request correlation, notifications, and server-to-client requests.
- One managed Hermes ACP session per active Nexy conversation.
- Text and thinking streaming.
- Tool start/update/completion normalization.
- Nexy-mediated permission decisions.
- Cancellation, timeout, crash cleanup, and emergency stop.
- Project working-directory and MCP isolation.
- Same-process multi-turn continuity.
- Minimal availability, setup, and diagnostic UI on desktop.
- Existing Android remote rendering through Nexy's normalized chat events.
- Automated protocol, adapter, integration, and manual acceptance tests.
- A feature flag and explicit rollback path.

### Explicitly deferred

- Claude ACP integration.
- Codex ACP integration.
- A universal `AgentRuntime` migration for all existing adapters.
- Retirement or refactoring of Claude/Codex parsers.
- Android standalone execution or a Termux bridge.
- ACP session recovery after a full Nexy restart.
- Process pooling across conversations.
- Rich new diff, terminal, plan, or model-configuration UI.
- Permanent `allow_always` approvals from Nexy.
- Automatic runtime downloads or background installation.
- ACP v2.

These items require a new decision after the Hermes evaluation. They are not later phases that begin automatically.

## Milestone alignment

The active milestone is UI Unification. The Hermes pilot should be a separately approved backend workstream and should avoid unrelated visual changes.

Any necessary UI should use the unified design system on desktop and preserve the semantics already consumed by Android remote chat. The pilot may add only the surfaces needed to make Hermes usable and diagnosable:

- Hermes readiness/setup state;
- connecting, ready, interrupted, and failed states;
- existing tool and thinking timeline treatment;
- permission prompts;
- cancel behavior;
- concise unsupported-feature explanations.

No component should expose raw ACP terminology in normal chat. ACP version and method-level errors belong in advanced diagnostics.

## Target design

### 1. `AcpStdioConnection`

A small protocol transport should own:

- launching an explicit executable with `shell: false`;
- newline-delimited JSON-RPC framing on stdout;
- buffering partial lines and bounding maximum frame size;
- monotonically increasing request IDs;
- response correlation and per-request timeouts;
- notification dispatch;
- server-to-client request dispatch, especially permission requests;
- stderr capture as bounded diagnostics, never protocol input;
- graceful shutdown followed by process-tree termination when required;
- rejection of all pending requests when the process exits;
- redaction-safe lifecycle logging.

This module may be protocol-generic because those responsibilities are defined by ACP itself. It must not contain Hermes product policy.

### 2. `HermesAcpSessionManager`

Maintain a map keyed by Nexy conversation ID:

```ts
interface ManagedHermesSession {
  conversationId: string
  acpSessionId: string
  cwd: string
  model: string
  securityFingerprint: string
  connection: AcpStdioConnection
  state: 'starting' | 'ready' | 'prompting' | 'interrupted' | 'closed'
  lastUsedAt: number
}
```

The first implementation should use one Hermes process and one ACP session per active conversation. This is intentionally conservative:

- failures are isolated to one conversation;
- permissions cannot cross conversation boundaries;
- working-directory changes are unambiguous;
- cancellation and diagnostics are easier to reason about;
- Hermes sessions are currently scoped to the running ACP server process.

Do not pool conversations into one process until measurements show a need and isolation tests prove it safe.

Create a new process/session when no valid binding exists. Invalidate and recreate it when any hard boundary changes:

- working directory;
- selected Hermes model;
- MCP server set or relevant environment;
- security/permission profile;
- system-prompt fingerprint;
- Hermes or ACP protocol incompatibility;
- prior unrecoverable process failure.

Only one prompt may be active per conversation. A second request should be rejected or queued by the existing turn policy, never multiplexed into the same session accidentally.

### 3. `HermesAcpAdapter`

For the pilot, keep the existing `CliAgentAdapter` call site. Replace the implementation behind `hermes-cli` with an asynchronous ACP adapter rather than migrating every backend.

Responsibilities:

- obtain or create a managed session;
- convert the Nexy request into ACP prompt content;
- translate ACP updates into `onChunk` and `CliStreamEvent` calls;
- maintain stable Nexy block IDs around tool interruptions;
- return the final assembled text expected by current persistence code;
- connect `AbortSignal` to ACP cancellation and cleanup escalation;
- route permission requests through `req.requestPermission`;
- classify preflight, initialization, turn, cancellation, and process failures.

The adapter must be asynchronous end-to-end. `spawnSync` must not remain on the primary Hermes path.

### 4. Event mapping for the first release

Map required Hermes activity into Nexy's existing vocabulary:

| Hermes ACP concept | Nexy pilot representation |
|---|---|
| response text chunk | `onChunk(chunk, blockId)` |
| completed text burst | `text_end` |
| thinking chunk | `thinking_chunk` |
| completed thinking | `thinking_end` |
| tool call begins | `tool_start` |
| tool progress | `activity` until a richer shared event is justified |
| tool completes/fails | `tool_end` |
| usage, when supplied | `cost` with supported token fields; never invent cost |
| turn stopped | adapter completion or typed error handled by the turn coordinator |
| file diff | tool lifecycle in MVP; preserve enough normalized data for later rich UI |
| terminal activity | tool lifecycle in MVP; bound output size |

Unknown optional updates should be recorded as redacted diagnostic counters and ignored safely. Unknown required request types should receive a protocol error rather than hang.

The normalizer should be pure and exhaustively fixture-tested. It must preserve ordering using a per-turn monotonic sequence and correlate every tool update by ACP tool-call ID.

### 5. Prompt and conversation policy

During a live Nexy process, subsequent turns should reuse the same Hermes ACP session so Hermes owns conversational execution state.

For the first prompt:

- send the current user content and supported attachments;
- apply the current Nexy system-prompt workaround in a Hermes-specific, clearly delimited instruction block;
- do not replay the full Nexy transcript unless a conformance test proves a safe non-duplicating bootstrap format.

Because Hermes ACP sessions are in-memory and scoped to the running server, full app restart recovery is deferred. After restart, Nexy should create a new Hermes session and clearly treat it as a new execution context while retaining the visible Nexy transcript. The pilot must not imply that Hermes has resumed hidden state when it has not.

System-prompt adherence is an explicit conformance test. If custom Nexy agent instructions are not reliably honored, the pilot should restrict Hermes ACP to a narrower supported agent configuration rather than silently weakening instructions.

### 6. MCP and workspace isolation

Nexy should own which MCP servers are available to the session. Launch Hermes with `HERMES_ACP_SKIP_CONFIGURED_MCP=1`, then supply only the approved project/session MCP servers through ACP session creation. This prevents unrelated globally configured Hermes MCP servers from starting behind Nexy's back or delaying initialization.

Security rules:

- bind the ACP session cwd to the selected project root;
- validate all Nexy-supplied MCP commands, cwd values, and environment entries using existing policy;
- pass a minimal inherited environment plus explicitly required Hermes configuration variables;
- never include secrets in logs or UI diagnostics;
- keep project audit snapshots around tool execution as today;
- treat Hermes memory, skills, and other user configuration as active capabilities and document that behavior in setup;
- do not claim filesystem sandboxing beyond what Nexy and Hermes actually enforce.

The team must explicitly decide whether preserving Hermes memory and skills is desired for the pilot. Native ACP uses the same Hermes configuration and state; this differs from the current adapter's `--ignore-user-config --ignore-rules` isolation attempt.

### 7. Permission policy

Hermes ACP can offer `allow_once`, `allow_session`, `allow_always`, and `deny`. Nexy's current callback returns only a boolean, so the first implementation should map:

- approved -> the exact `allow_once` option supplied by Hermes;
- denied, dismissed, timed out, stale, or disconnected -> `deny`.

Do not map a boolean approval to `allow_session` or `allow_always`. Broader scopes require a deliberate Nexy permission-contract and UI change after the basic pilot works.

Every request must be bound to conversation ID, Nexy turn ID, ACP session ID, and tool-call/request ID. Reject duplicate or stale decisions. If the UI disappears, the turn is cancelled, or the request times out, deny by default.

`skipPermissions` must not silently grant permanent approval. For the internal pilot it may auto-select `allow_once` only when existing Nexy policy explicitly authorizes unattended execution, and that behavior must be covered by a destructive-command safety test.

### 8. Cancellation and failure recovery

On `AbortSignal`:

1. send ACP cancellation for the active prompt;
2. wait a short bounded grace period for a stopped response;
3. if Hermes remains active, terminate the process tree;
4. mark the session invalid so it cannot be reused;
5. preserve already emitted Nexy timeline events and mark the turn interrupted.

Initialization, prompt acceptance, and first event need separate timeouts. A silent Hermes process must never leave the UI indefinitely spinning.

On unexpected exit:

- reject all pending protocol requests;
- mark only the affected conversation session invalid;
- include bounded stderr and exit metadata in advanced diagnostics;
- never expose credentials or raw prompt/tool content;
- do not retry automatically after prompt acceptance;
- allow the next explicit turn/retry to create a fresh session.

## Runtime discovery and setup

Hermes availability must mean ACP readiness, not merely that `hermes` exists.

Preflight should distinguish:

1. Hermes executable not found.
2. Hermes installed but ACP extra unavailable.
3. `hermes acp --check` reports missing configuration or credentials.
4. ACP version unsupported.
5. ACP initializes but lacks a required pilot capability.
6. Hermes ACP ready.

Use `hermes acp --version` and `hermes acp --check` as non-interactive probes with strict timeouts. Cache successful checks briefly, invalidate the cache when the executable/version changes, and expose a manual recheck action.

Nexy should not run `uv pip install`, `hermes acp --setup`, browser downloads, or any other installation automatically. Setup UI may show verified commands and link to Hermes documentation. Installation remains an explicit user action during the pilot.

Record in redacted diagnostics:

- resolved executable source/path category, not a private full path by default;
- Hermes and ACP adapter versions;
- preflight status and duration;
- initialization result and advertised capabilities;
- process exit category.

## Implementation work packages

### H0 — Freeze the pilot contract

Deliverables:

- Confirm Hermes-only scope and the stop-after-evaluation rule.
- Record supported operating systems and minimum Hermes version for the pilot.
- Capture real `hermes acp --version`, `--check`, initialize, session, prompt, tool, permission, cancellation, and shutdown fixtures.
- Decide whether Hermes memory/skills/user configuration are permitted.
- Define required versus optional ACP capabilities.
- Define feature flag, diagnostic legacy escape hatch, and rollback behavior.

Gate:

- Security, configuration inheritance, system-prompt handling, and fallback semantics are explicitly approved.
- No production behavior changes.

### H1 — Protocol transport and fake Hermes server

Deliverables:

- Implement `AcpStdioConnection`.
- Add bounded framing, timeouts, server-request dispatch, cancellation, and process cleanup.
- Build a deterministic fake ACP server process used only by tests.
- Add fixtures for partial lines, batched lines, malformed JSON, unknown messages, duplicate IDs, stderr noise, slow responses, and crashes.

Gate:

- All pending requests settle on exit.
- No malformed input can hang the connection or grow an unbounded buffer.
- Cancellation and forced termination leave no child process.

### H2 — Hermes session and event integration

Deliverables:

- Implement `HermesAcpSessionManager`.
- Replace the primary `HermesAdapter.send` path with ACP.
- Initialize and create one session per conversation.
- Pass cwd, approved MCP servers, model/configuration where supported, and Hermes-specific prompt content.
- Normalize text, thinking, tool lifecycle, activity, and usage.
- Reuse existing `ChatTurnEmitter`, persistence, audit, and Android remote events.
- Add session invalidation and idle cleanup.

Gate:

- Text-only and text/tool/text turns stream and persist in identical order.
- Two simultaneous conversations cannot cross events or permissions.
- A second turn in one conversation demonstrably retains Hermes session context.

### H3 — Permissions, cancellation, and security

Deliverables:

- Route Hermes permission requests into Nexy's existing approval UI.
- Implement allow-once and deny mapping using Hermes-supplied option IDs.
- Add stale-response and timeout protection.
- Connect `AbortSignal` and emergency stop to ACP cancel plus process escalation.
- Set `HERMES_ACP_SKIP_CONFIGURED_MCP=1` and verify only approved session MCP servers start.
- Verify cwd and audit behavior for reads, writes, patches, and terminal commands.

Gate:

- Deny, dismiss, timeout, cancellation, and disconnect all fail closed.
- A cancelled process cannot continue changing files.
- No global MCP server is started when Nexy owns the session MCP configuration.
- No automatic retry can duplicate a file edit or command.

### H4 — Readiness and minimal UX

> **Status (2026-08-07): substantially delivered via the Hermes Profile Picker Unification roadmap (PR-1/PR-2/PR-3).** `hermesAcpReadiness()` (`cli-detection.ts`) runs `hermes acp --version` + `--check` as non-interactive probes (3s timeout, cached with a `force` recheck) and is exposed over IPC (`hermes:acp-readiness`) and to Android via the `app:cli-status` `hermes` block. Desktop `SettingsTab.tsx` renders a not-ready warning note, relabels the backend "Hermes Agent (ACP)", and no longer says `hermes -z`. Profile enumeration (`hermes:list-profiles`) shipped alongside.

Deliverables:

- [x] Replace “Hermes installed” checks used for selection with an ACP readiness state. *(readiness is warmed at IPC registration and only a successful ACP readiness result participates in routing.)*
- [x] Add setup, recheck, connecting, interrupted, and actionable error states using the unified UI system. *(desktop readiness/recheck/setup guidance is live; runtime interruption is normalized through the existing chat error/activity boundary.)*
- [x] Keep normal labels as “Hermes Agent”; expose “ACP” only in diagnostics. *(desktop label now "Hermes Agent (ACP)".)*
- [x] Preserve Android remote timeline and permission semantics through existing normalized events.
- [x] Remove or update UI copy that describes Hermes as `hermes -z` or as lacking streaming/modes when no longer true.

Gate:

- A user can distinguish missing Hermes, missing ACP extra, missing credentials, unsupported version, and runtime failure.
- Desktop narrow/wide, light/dark, keyboard, and screen-reader checks pass for touched UI.
- Existing Android remote chat does not need to parse ACP.

### H5 — Internal pilot and decision review

Run the pilot on representative real projects and supported desktop platforms. Keep rollout internal and opt-in until the acceptance suite passes.

Collect non-sensitive measurements:

- preflight and initialization success;
- initialization and first-token latency;
- normalized event counts;
- permission wait and resolution category;
- cancellation outcome and cleanup duration;
- unknown ACP message types;
- process exit category;
- session continuity success;
- timeline/persistence mismatch reports.

Gate:

- The team completes the manual test script on real Hermes installations.
- No high-severity permission, cancellation, workspace, transcript-integrity, or duplicate-side-effect defect remains.
- Hermes is materially more functional than the current `-z` implementation.
- The user explicitly chooses one outcome: proceed to another CLI, extend the Hermes pilot, keep Hermes opt-in, or roll back ACP.

**Work stops at this gate. Claude and Codex do not begin without a new instruction.**

## Hermes acceptance suite

### Setup and discovery

- Hermes absent.
- Hermes present without ACP extra.
- ACP extra present without provider credentials.
- Unsupported and supported versions.
- `--check` timeout and non-zero exit.
- Manual recheck after setup.

### Content and ordering

- Text-only response streams incrementally.
- Thinking streams separately from final text.
- `text -> tool -> text -> tool -> text` retains exact live and persisted order.
- Multiple tool calls retain stable IDs.
- Tool failure is distinct from turn failure.
- Large terminal/tool output is bounded without corrupting the protocol.
- Final response text is emitted and persisted exactly once.
- Reopened desktop and Android remote timelines are semantically equivalent.

### Conversation behavior

- Second prompt in the same conversation uses the same Hermes session.
- Two conversations use isolated processes/sessions.
- Model, cwd, MCP set, security profile, or system-prompt change invalidates the session.
- Nexy restart creates an explicit new execution context without rewriting history.
- Imported and forked conversations do not imply a resumed Hermes session.

### Permissions and workspace safety

- Read-only tool behavior.
- File write and patch approval.
- Harmless and dangerous terminal command approval.
- Allow once applies only to the requested action.
- Deny, dismiss, timeout, stale response, duplicate response, and disconnected UI.
- Cancellation while permission is pending.
- Workspace-root and additional-directory boundaries.
- Only approved MCP servers start.
- Audit records associate changes with the correct turn and tool.

### Lifecycle

- Cancel during text.
- Cancel during thinking.
- Cancel during a long terminal command.
- Hermes crash before initialization.
- Hermes crash before prompt acceptance.
- Hermes crash after possible side effects.
- Malformed or unknown ACP traffic.
- Idle session cleanup.
- App shutdown and emergency stop.
- No orphaned Hermes or tool subprocesses.

### Product regression

- Copy, share, export, ratings, notifications, and spoken output still work.
- Existing Claude, Codex, and BYOK routes are unchanged.
- Android remote chat receives only existing normalized Nexy events.
- Feature-flag rollback restores the diagnostic legacy path without data migration.

## Rollout policy

Use this progression:

```text
automated fake-server tests
    -> developer-only feature flag
    -> internal real-project testing
    -> explicit go/no-go review
```

There is no automatic public-default or next-backend stage in this roadmap.

Immediate rollback criteria include:

- a permission request is bypassed or mapped to a broader scope than selected;
- cancellation leaves commands running;
- files can be changed outside the approved workspace policy;
- timeline content is missing, duplicated, or reordered;
- one conversation receives another conversation's events;
- Nexy silently repeats a possibly side-effecting turn;
- sensitive prompt, tool, environment, credential, or path data appears in routine logs;
- Hermes configuration inheritance violates the approved pilot policy.

## Open decisions required before coding

1. **Configuration inheritance:** Native Hermes ACP uses the user's Hermes configuration, memory, skills, and state. Should Nexy embrace that behavior, provide an isolated Hermes home/profile, or restrict the initial pilot?
2. **Minimum version and platforms:** Which Hermes release and which desktop operating systems form the supported internal matrix?
3. **Legacy exposure:** Should `hermes -z` remain selectable only through a developer flag, or be removed from normal selection once ACP preflight passes?
4. **System prompts:** Is the existing delimited instruction-prefix behavior acceptable for initial testing, or must custom Nexy agents remain disabled until stronger Hermes support is verified?
5. **Unattended mode:** Should `skipPermissions` be disabled for the pilot or map strictly to repeated `allow_once` decisions under existing Nexy policy?

Defaults recommended for the safest first build:

- use the user's configured Hermes identity but skip globally configured MCP servers;
- support only the desktop platforms the team can test directly;
- keep `hermes -z` behind a developer-only rollback flag;
- permit custom system prompts only after a conformance test;
- require interactive allow-once decisions and disable unattended approval initially.

## Definition of done

The Hermes ACP pilot is complete when:

- Hermes produces incremental text and thinking in Nexy;
- tool calls appear in correct live and persisted order;
- dangerous operations are routed through fail-closed Nexy approvals;
- cancellation reliably stops active work and cleans up processes;
- one conversation continues coherently across multiple turns in the same app run;
- conversations, workspaces, permissions, and MCP servers remain isolated;
- desktop and Android remote clients render the same normalized timeline semantics;
- setup and failure states are actionable without requiring protocol knowledge;
- tests cover protocol framing, real adapter behavior, product integration, and failure paths;
- operational diagnostics contain no sensitive content;
- the internal manual pilot is completed and documented;
- no Claude, Codex, or Android-Termux implementation has started;
- the team reaches an explicit go/no-go decision for subsequent work.

## Recommended first implementation increment

Implement **H0 and H1 only**:

1. resolve the five open pilot decisions;
2. capture/version real Hermes ACP messages for conformance fixtures;
3. implement the bounded ACP stdio connection;
4. implement the deterministic fake ACP server;
5. prove framing, correlation, server requests, cancellation, timeouts, and process cleanup.

This increment validates the risky transport and lifecycle assumptions without changing the live Hermes route. The next increment connects only Hermes to that transport.

## Reference material

- Hermes ACP host integration: <https://hermes-agent.nousresearch.com/docs/user-guide/features/acp>
- Agent Client Protocol architecture: <https://agentclientprotocol.com/get-started/architecture>
- ACP v1 overview: <https://agentclientprotocol.com/protocol/v1/overview>
- ACP v1 transports: <https://agentclientprotocol.com/protocol/v1/transports>
- ACP session setup: <https://agentclientprotocol.com/protocol/v1/session-setup>

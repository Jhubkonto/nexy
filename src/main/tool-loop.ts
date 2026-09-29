import { randomUUID } from 'crypto'

import { getDatabase } from './database'
import { callMcpTool, servers, type McpExecutionPolicy } from './mcp'
import { broadcastToMobile } from './ws-server'
import type { ProviderNonStreamResult, ToolChoice, ToolDefinition } from './provider-types'
import type { ProviderMessage } from './providers'
import { assertConversationStartsAllowed } from './emergency-stop'

export const MCP_MAX_ITERATIONS = 20
export const MCP_REQUIRED_ITERATIONS = 0

/**
 * Tool result content is truncated to this length before being added to the
 * model's context. Large accessibility trees and DOM snapshots can easily
 * exceed 20k characters and push the model into "explanation mode" rather than
 * action mode. The full result is still forwarded to the renderer for display.
 */
export const MAX_TOOL_RESULT_CHARS = 16000

/**
 * Character budget for the accumulated loopMessages conversation (rough proxy for tokens at
 * ~4 chars/token). Per-message truncation (MAX_TOOL_RESULT_CHARS) bounds each individual result,
 * but with MCP_MAX_ITERATIONS rounds of tool calls the *sum* can still balloon well past what even
 * large-context models accept — a real-world run hit ~530K tokens over ~2M characters after
 * repeated revisions layered more tool calls onto an already-long conversation. There's no
 * per-model context-window size tracked in the model catalog to trim against precisely, so this
 * is a conservative, provider-agnostic ceiling (well under the smallest common ~32K-token window)
 * rather than a per-model exact fit.
 */
export const MAX_LOOP_CONTEXT_CHARS = 100000

function messageCharCount(message: ProviderMessage): number {
  let total = typeof message.content === 'string' ? message.content.length : 0
  if ('tool_calls' in message && Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) total += call.function.arguments.length
  }
  return total
}

function loopMessagesCharCount(loopMessages: ProviderMessage[]): number {
  return loopMessages.reduce((total, message) => total + messageCharCount(message), 0)
}

/**
 * Drops the oldest assistant/tool exchanges (keeping the leading system+user messages, which
 * carry the actual task, and the most recent exchanges, which are most relevant to wrapping up)
 * until the conversation fits MAX_LOOP_CONTEXT_CHARS. Used right before the forced final answer —
 * merely stopping new tool calls isn't enough, since the oversized history already collected would
 * still be sent as-is otherwise.
 */
function trimLoopMessagesToBudget(loopMessages: ProviderMessage[]): ProviderMessage[] {
  if (loopMessagesCharCount(loopMessages) <= MAX_LOOP_CONTEXT_CHARS) return loopMessages

  const leadingCount = loopMessages[0]?.role === 'system' ? 2 : 1
  const leading = loopMessages.slice(0, leadingCount)
  const rest = loopMessages.slice(leadingCount)
  const leadingChars = leading.reduce((total, message) => total + messageCharCount(message), 0)

  const kept: ProviderMessage[] = []
  let keptChars = 0
  for (let i = rest.length - 1; i >= 0; i--) {
    const chars = messageCharCount(rest[i])
    if (leadingChars + keptChars + chars > MAX_LOOP_CONTEXT_CHARS && kept.length > 0) break
    kept.unshift(rest[i])
    keptChars += chars
  }
  return [
    ...leading,
    { role: 'user' as const, content: '[Earlier tool results were dropped to stay within the context limit — proceed with the information below.]' },
    ...kept,
  ]
}

/**
 * Tool name fragments that indicate a read-only inspection step.
 * When the previous loop iteration consisted entirely of inspection tools,
 * a text-only response is treated as a planning step and the loop attempts
 * one recovery by forcing the next call with toolChoice = 'required'.
 */
const INSPECTION_TOOL_KEYWORDS = ['snapshot', 'screenshot', 'evaluate', 'source', 'console', 'dom']

function isInspectionTool(toolName: string): boolean {
  const lower = toolName.toLowerCase()
  return INSPECTION_TOOL_KEYWORDS.some((kw) => lower.includes(kw))
}

/**
 * Recognizes the specific empty/truncated-response diagnoses providers throw (see
 * emptyResponseError in providers/openai-provider.ts and the streaming empty-stop rejection above
 * it) so the forced-final-answer catch below can surface the real reason instead of the generic
 * "no final response" placeholder. Matched by message prefix rather than an `instanceof` check
 * since these errors cross the caller-function boundary as plain Errors, not a shared class.
 */
function isDiagnosticEmptyResponseError(error: unknown): error is Error {
  return error instanceof Error && (
    error.message.startsWith('The model returned an empty response') ||
    error.message.startsWith('The model\'s response was cut off')
  )
}

export interface ModelToolCaller {
  (
    messages: ProviderMessage[],
    tools: ToolDefinition[] | undefined,
    toolChoice: ToolChoice
  ): Promise<ProviderNonStreamResult>
}

export interface ToolLoopToolFinishedEvent {
  id?: string
  toolName: string
  serverName: string
  args: Record<string, unknown>
  result: string
  success: boolean
  conversationId: string | null
  resultImages?: { dataUrl: string }[]
}

/**
 * Streaming variant of a tool-capable provider round. Text is forwarded as it
 * arrives, while the returned result contains only complete tool calls so the
 * loop never dispatches partial JSON arguments.
 */
export interface ModelToolStreamCaller {
  (
    messages: ProviderMessage[],
    tools: ToolDefinition[] | undefined,
    toolChoice: ToolChoice,
    onChunk: (chunk: string) => void,
  ): Promise<ProviderNonStreamResult>
}

export interface ToolLoopToolStartedEvent {
  id: string
  toolName: string
  serverName: string
  args: Record<string, unknown>
  conversationId: string | null
}

export async function runProviderMcpToolLoop(
  caller: ModelToolCaller,
  messages: ProviderMessage[],
  toolDefs: ToolDefinition[],
  toolMap: Map<string, { serverId: string; toolName: string }>,
  agentId: string,
  conversationId: string | null,
  webContents: Electron.WebContents | undefined,
  onChunk: (chunk: string) => void,
  onModel?: (model: string) => void,
  agenticMode?: boolean,
  inlineHandlers?: Map<string, (args: Record<string, unknown>) => Promise<{ success: boolean; result?: string; error?: string }>>,
  toolDirective?: string,
  onActivity?: (event: { type: 'thinking' } | { type: 'tool'; name: string; server: string }) => void,
  autoApproveTools?: boolean,
  toolPolicy?: { preApproved: string[]; alwaysAsk: string[]; neverAllow: string[] },
  onToolFinished?: (event: ToolLoopToolFinishedEvent) => void,
  fullAutoApprove?: boolean,
  forceFirstToolChoice?: boolean,
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void,
  /**
   * Streams the terminal answer token-by-token instead of the non-streaming forced-'none' call.
   * When provided, it is used for the final wrap-up; on any error *before* it emits text, the loop
   * falls back to the non-streaming `caller` so the turn still completes. It receives the same
   * budget-trimmed messages and must emit text via the provided onChunk.
   */
  finalStreamCaller?: (
    messages: ProviderMessage[],
    onChunk: (chunk: string) => void,
  ) => Promise<void>,
  onToolStarted?: (event: ToolLoopToolStartedEvent) => void,
  toolRoundStreamCaller?: ModelToolStreamCaller,
  mcpPolicy?: McpExecutionPolicy,
): Promise<string> {
  const toolNames = [...new Set(toolDefs.map((t) => t.function.name.split('__').pop()))].join(', ')
  const directive = toolDirective ??
    `You have browser automation tools available: ${toolNames}. ` +
    'CRITICAL: Only use these tools when the user\'s request explicitly requires interacting with a web browser or web page. ' +
    'For conversational questions, general knowledge, or anything that does not require a browser, respond directly WITHOUT calling any tools. ' +
    'When a browser task IS required, call the tools immediately and completely — ' +
    'do NOT say you "will" do something, just do it. ' +
    'After any inspection step (e.g. browser_snapshot), take the next required action immediately — ' +
    'do NOT narrate your findings before acting. ' +
    'Continue calling tools until the task is fully finished, then give a brief summary.'
  const baseMessages: ProviderMessage[] = messages.length > 0 && messages[0].role === 'system'
    ? [
        { role: 'system' as const, content: `${messages[0].content as string}\n\n${directive}` },
        ...messages.slice(1)
      ]
    : [{ role: 'system' as const, content: directive }, ...messages]

  const loopMessages = [...baseMessages]
  let fullResponse = ''
  let modelEmitted = false
  let executedTool = false

  // Recovery state — when the model returns planning text after a pure inspection step,
  // we force one additional 'required' iteration rather than exiting immediately.
  let prevIterationInspectionOnly = false
  let hasRecovered = false
  let forcedToolChoice: 'required' | null = forceFirstToolChoice ? 'required' : null

  const sendActivity = (event: { type: 'thinking' } | { type: 'tool'; name: string; server: string }) => {
    if (webContents && !webContents.isDestroyed()) webContents.send('chat:activity', event)
    onActivity?.(event)
  }
  const sendToolFinished = (event: ToolLoopToolFinishedEvent) => {
    if (event.conversationId) {
      getDatabase()
        .prepare(
          'INSERT INTO conversation_tool_calls (id, conversation_id, tool_name, server_name, success, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), event.conversationId, event.toolName, event.serverName ?? null, event.success ? 1 : 0, Date.now())
    }
    if (onToolFinished) {
      onToolFinished(event)
      return
    }
    if (webContents && !webContents.isDestroyed()) webContents.send('chat:tool-call-event', event)
    broadcastToMobile({ event: 'chat:tool-call-event', data: event })
  }
  const sendToolStarted = (event: ToolLoopToolStartedEvent) => {
    onToolStarted?.(event)
  }

  for (let i = 0; i < MCP_MAX_ITERATIONS; i++) {
    // Stop accumulating tool results once the conversation itself risks exceeding the model's
    // context window (see MAX_LOOP_CONTEXT_CHARS) — force a final answer with what's gathered so
    // far instead of sending an ever-larger request that the provider will simply reject.
    if (loopMessagesCharCount(loopMessages) > MAX_LOOP_CONTEXT_CHARS) break

    let toolChoice: 'auto' | 'required' | 'none'
    if (forcedToolChoice) {
      toolChoice = forcedToolChoice
      forcedToolChoice = null
    } else {
      toolChoice = i < MCP_REQUIRED_ITERATIONS ? 'required' : 'auto'
    }

    sendActivity({ type: 'thinking' })
    assertConversationStartsAllowed()
    let result: ProviderNonStreamResult
    let streamedRoundText = false
    try {
      if (toolRoundStreamCaller) {
        result = await toolRoundStreamCaller(loopMessages, toolDefs, toolChoice, (chunk) => {
          if (chunk) streamedRoundText = true
          fullResponse += chunk
          onChunk(chunk)
        })
      } else {
        result = await caller(loopMessages, toolDefs, toolChoice)
      }
    } catch (error) {
      // A dropped provider request must not erase useful narration already emitted during this
      // turn. The caller has already retried transient failures; if it still fails, preserve the
      // partial response and let the turn settle instead of replacing it with a raw error.
      if (fullResponse || executedTool) {
        return fullResponse || 'I completed some tool actions, but the provider stopped before providing a final response.'
      }
      throw error
    }
    assertConversationStartsAllowed()

    if (result.usage) onUsage?.(result.usage)

    if (!modelEmitted && onModel && result.model) {
      modelEmitted = true
      onModel(result.model)
    }

    if (!result.toolCalls || result.toolCalls.length === 0) {
      const text = result.content ?? ''

      // Mid-loop recovery: the model returned planning text after a pure inspection
      // step (e.g. browser_snapshot). Push a user nudge (not an assistant message —
      // ending a turn with a bare assistant text message and then requesting more tool
      // calls causes a 400 from the API) and force one more 'required' iteration.
      const planningText = text.trim()
      const shouldRecoverPlanning = planningText.length > 0 && (
        prevIterationInspectionOnly ||
        isActionPlanningText(planningText) && (i === 0 || executedTool)
      )
      // An empty first response is usually a provider/model failure, not evidence that a tool is
      // required (the tool list may contain only nexy_ask_user). Once an inspection tool has run,
      // however, an empty response is the same stalled boundary as planning text and merits one
      // bounded recovery attempt.
      const shouldRecoverEmpty = !planningText && executedTool && prevIterationInspectionOnly
      if (!hasRecovered && (shouldRecoverPlanning || shouldRecoverEmpty)) {
        hasRecovered = true
        forcedToolChoice = 'required'
        loopMessages.push({
          role: 'user' as const,
          content: planningText
            ? 'Please proceed with the actions now — call the appropriate tools directly instead of narrating what you will do.'
            : 'Continue the task now — call the appropriate tool if an action remains, then provide the final result.'
        })
        continue
      }

      if (!streamedRoundText) {
        onChunk(text)
        fullResponse += text
      }
      return fullResponse
    }

    // Track whether this iteration was entirely inspection tools (no mutations).
    prevIterationInspectionOnly = result.toolCalls.every((tc) =>
      isInspectionTool(tc.name.split('__').pop() ?? tc.name)
    )

    // Interstitial narration: models routinely write text ("Now let me open the parser…") in the
    // SAME message as a tool call. Previously this was discarded (content: null). Stream it to the
    // user, keep it in fullResponse so it's persisted, and preserve it as the assistant message
    // content so the model retains its own continuity across rounds.
    const interstitialText = (result.content ?? '').trim()
    if (interstitialText && !streamedRoundText) {
      onChunk(result.content as string)
      fullResponse += result.content as string
    }

    loopMessages.push({
      role: 'assistant' as const,
      content: interstitialText ? (result.content as string) : null,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
      }))
    })

    for (const call of result.toolCalls) {
      assertConversationStartsAllowed()
      executedTool = true
      const toolShortName = call.name.split('__').pop() ?? call.name
      const resolved = toolMap.get(call.name)
      const inlineHandler = inlineHandlers?.get(call.name)
      const resolvedServer = resolved ? servers.get(resolved.serverId) : undefined
      const defaultServerName = call.name.split('__')[0] ?? ''
      const serverName = inlineHandler
        ? 'Project Wiki'
        : resolvedServer?.config.name ?? (resolved?.serverId ?? defaultServerName)
      let toolResultContent: string
      let toolImages: { dataUrl: string }[] | undefined

      sendToolStarted({
        id: call.id,
        toolName: toolShortName,
        serverName,
        args: call.arguments as Record<string, unknown>,
        conversationId,
      })

      // Malformed arguments: the provider returned a tool call whose arguments couldn't be parsed
      // as JSON. Running the tool with `{}` silently produces a wrong result and burns an
      // iteration; instead feed the parse error back so the model can re-emit valid arguments.
      if (call.argsError) {
        toolResultContent = `Error: ${call.argsError}. Re-call the tool with valid JSON arguments.`
        sendActivity({ type: 'tool', name: toolShortName, server: call.name.split('__')[0] ?? '' })
        sendToolFinished({
          id: call.id,
          toolName: toolShortName,
          serverName,
          args: call.arguments as Record<string, unknown>,
          result: toolResultContent,
          success: false,
          conversationId,
        })
        loopMessages.push({ role: 'tool' as const, tool_call_id: call.id, content: toolResultContent })
        continue
      }

      // Tool policy enforcement for scheduled runs
      if (toolPolicy) {
        const isNeverAllow = toolPolicy.neverAllow.some(
          (n) => call.name === n || toolShortName === n
        )
        const isPreApproved = toolPolicy.preApproved.some(
          (p) => call.name === p || toolShortName === p
        )
        if (isNeverAllow) {
          toolResultContent = `Error: Tool "${toolShortName}" is not permitted by the task's tool policy (neverAllow).`
          const neverAllowPayload = {
            id: call.id,
            toolName: toolShortName,
            serverName,
            args: call.arguments as Record<string, unknown>,
            result: toolResultContent,
            success: false,
            conversationId,
          }
          sendToolFinished(neverAllowPayload)
          loopMessages.push({ role: 'tool' as const, tool_call_id: call.id, content: toolResultContent })
          continue
        }
        if (!isPreApproved) {
          // Every scheduled tool, including Nexy's inline tools, must be explicitly pre-approved.
          toolResultContent = `Error: Tool "${toolShortName}" is not in the pre-approved list for this scheduled task. Add it to the task's tool policy to allow it.`
          const notApprovedPayload = {
            id: call.id,
            toolName: toolShortName,
            serverName,
            args: call.arguments as Record<string, unknown>,
            result: toolResultContent,
            success: false,
            conversationId,
          }
          sendToolFinished(notApprovedPayload)
          loopMessages.push({ role: 'tool' as const, tool_call_id: call.id, content: toolResultContent })
          continue
        }
      }

      if (!resolved && !inlineHandler) {
        toolResultContent = `Error: Unknown tool "${call.name}"`
        sendActivity({ type: 'tool', name: toolShortName, server: call.name.split('__')[0] ?? '' })
        const unknownPayload = {
          id: call.id,
          toolName: toolShortName,
          serverName,
          args: call.arguments as Record<string, unknown>,
          result: toolResultContent,
          success: false,
          conversationId,
        }
        sendToolFinished(unknownPayload)
      } else if (inlineHandler) {
        sendActivity({ type: 'tool', name: call.name, server: 'Project Wiki' })
        try {
          const toolResult = await inlineHandler(call.arguments as Record<string, unknown>)
          toolResultContent = toolResult.success
            ? (toolResult.result ?? '(no output)')
            : `Error: ${toolResult.error ?? 'Tool execution failed'}`
          const inlinePayload = {
            id: call.id,
            toolName: call.name,
            serverName,
            args: call.arguments as Record<string, unknown>,
            result: toolResultContent,
            success: toolResult.success,
            conversationId,
          }
          sendToolFinished(inlinePayload)
        } catch (error) {
          toolResultContent = `Error: ${error instanceof Error ? error.message : String(error)}`
          sendToolFinished({
            id: call.id,
            toolName: call.name,
            serverName,
            args: call.arguments as Record<string, unknown>,
            result: toolResultContent,
            success: false,
            conversationId,
          })
        }
      } else {
        // resolved is guaranteed non-null: the first branch handles !resolved && !inlineHandler
        const mcpResolved = resolved!
        sendActivity({ type: 'tool', name: toolShortName, server: serverName })
        try {
          const mcpPolicyArgs = mcpPolicy ? [mcpPolicy] as const : [] as const
          const toolResult = await callMcpTool(
            mcpResolved.serverId,
            mcpResolved.toolName,
            call.arguments as Record<string, unknown>,
            agentId,
            webContents,
            agenticMode,
            autoApproveTools,
            fullAutoApprove,
            ...mcpPolicyArgs,
          )
          toolResultContent = toolResult.success
            ? (toolResult.result ?? '(no output)')
            : `Error: ${toolResult.error ?? 'Tool execution failed'}`
          if (toolResult.images?.length) {
            toolImages = toolResult.images.map(img => ({ dataUrl: img.dataUrl }))
          }
          const mcpPayload = {
            id: call.id,
            toolName: toolShortName,
            serverName,
            args: call.arguments as Record<string, unknown>,
            result: toolResultContent,
            success: toolResult.success,
            conversationId,
            ...(toolImages?.length && { resultImages: toolImages }),
          }
          sendToolFinished(mcpPayload)
        } catch (error) {
          toolResultContent = `Error: ${error instanceof Error ? error.message : String(error)}`
          sendToolFinished({
            id: call.id,
            toolName: toolShortName,
            serverName,
            args: call.arguments as Record<string, unknown>,
            result: toolResultContent,
            success: false,
            conversationId,
          })
        }
      }

      // Truncate large results for the model context to prevent inspection tools
      // (e.g. browser_snapshot) from overwhelming the model into planning mode.
      // The full result is already forwarded to the renderer above.
      const modelFacingContent = toolResultContent.length > MAX_TOOL_RESULT_CHARS
        ? toolResultContent.slice(0, MAX_TOOL_RESULT_CHARS) +
          '\n...[output truncated — proceed with the task using the above information]'
        : toolResultContent

      const toolMsg: ProviderMessage = { role: 'tool' as const, tool_call_id: call.id, content: modelFacingContent }
      if (toolImages?.length) {
        (toolMsg as { role: 'tool'; tool_call_id: string; content: string; images?: { dataUrl: string }[] }).images = toolImages
      }
      loopMessages.push(toolMsg)
    }
  }

  sendActivity({ type: 'thinking' })
  const finalMessages = trimLoopMessagesToBudget(loopMessages)

  // Stream the terminal answer when a streaming caller is available (parity with the CLI token
  // stream). A long final answer arriving as one blob reads as a stall; streaming avoids that.
  if (finalStreamCaller) {
    let streamedAny = false
    const trackedChunk = (chunk: string) => {
      if (chunk) streamedAny = true
      fullResponse += chunk
      onChunk(chunk)
    }
    try {
      await finalStreamCaller(finalMessages, trackedChunk)
      return fullResponse
    } catch {
      // If text already streamed, surface the error rather than re-running the non-streaming
      // caller (which would duplicate the streamed text). If nothing streamed (e.g. the endpoint
      // rejected the request outright), fall through to the resilient non-streaming path.
      // Once any terminal text was emitted, keep it as the completed response. Re-throwing here
      // causes chat-handlers to persist only the transport error and makes a turn appear to stop
      // halfway through, even though the renderer already received a usable partial answer.
      if (streamedAny) return fullResponse
      // No terminal text was emitted: let the resilient non-streaming fallback below retry
      // endpoints that reject streaming outright.
    }
  }

  let finalResult: ProviderNonStreamResult
  try {
    finalResult = await caller(finalMessages, undefined, 'none')
  } catch (error) {
    if (fullResponse) return fullResponse
    if (executedTool) {
      // Providers that detect a truncated/empty forced-final-answer (see openai-provider.ts
      // emptyResponseError) throw a specific, actionable diagnosis instead of silently returning
      // empty content. Surface that instead of the generic placeholder so the user knows *why* —
      // e.g. a max_tokens cutoff after a long tool loop — rather than just "no final response".
      return isDiagnosticEmptyResponseError(error)
        ? error.message
        : 'I completed some tool actions, but the provider stopped before providing a final response.'
    }
    throw error
  }
  if (finalResult.usage) onUsage?.(finalResult.usage)
  if (!modelEmitted && onModel && finalResult.model) {
    onModel(finalResult.model)
  }
  const text = finalResult.content ?? ''
  onChunk(text)
  fullResponse += text
  return fullResponse || (executedTool
    ? 'I completed some tool actions, but the provider returned no final response.'
    : fullResponse)
}

function isActionPlanningText(text: string): boolean {
  return /\b(?:i['’]?m going to|i['’]?ll|i will|let me|about to|next,?\s+i|first,?\s+i|i need to)\b[\s\S]{0,180}\b(?:call|use|open|read|write|edit|update|create|click|fill|search|inspect|run|check|find|navigate|apply|change|save|delete|fetch|test|implement|perform)\b/i.test(text)
}

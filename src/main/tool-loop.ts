import { randomUUID } from 'crypto'

import { getDatabase } from './database'
import { callMcpTool, servers, type McpExecutionPolicy } from './mcp'
import { broadcastToMobile } from './ws-server'
import type { ProviderNonStreamResult, ToolChoice, ToolDefinition } from './provider-types'
import type { ProviderMessage } from './providers'
import { assertConversationStartsAllowed } from './emergency-stop'
import { createToolMarkupBuffer, hasUnexecutedToolMarkup } from '../shared/unexecuted-tool-markup'
import { debugLog } from './debug-mode'
import { providerFinishReason } from './output-budget'
import { estimateToolRequestTokens, toolLoopInputBudget, trimToolLoopContext, FINAL_ANSWER_INSTRUCTION, type ToolLoopOptions } from './tool-loop-context'

export const MCP_MAX_ITERATIONS = 20
export const MCP_REQUIRED_ITERATIONS = 0

/**
 * Tool result content is truncated to this length before being added to the
 * model's context. Large accessibility trees and DOM snapshots can easily
 * exceed 20k characters and push the model into "explanation mode" rather than
 * action mode. The full result is still forwarded to the renderer for display.
 */
export const MAX_TOOL_RESULT_CHARS = 16000

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
  ) => Promise<ProviderNonStreamResult | void>,
  onToolStarted?: (event: ToolLoopToolStartedEvent) => void,
  toolRoundStreamCaller?: ModelToolStreamCaller,
  mcpPolicy?: McpExecutionPolicy,
  options: ToolLoopOptions = {},
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

  let loopMessages = [...baseMessages]
  const currentTask = [...messages].reverse().find((message) => message.role === 'user')
  const inputBudget = () => toolLoopInputBudget(options)
  const request = <T>(msgs: ProviderMessage[], tools: ToolDefinition[], send: (msgs: ProviderMessage[]) => Promise<T>, onMessages?: (msgs: ProviderMessage[]) => void): Promise<T> =>
    options.outputRecovery ? options.outputRecovery.run(msgs, tools, send, onMessages, currentTask) : send(msgs)
  let fullResponse = ''
  let modelEmitted = false
  let executedTool = false

  const reportInterruptedResponse = (error: unknown): string => {
    const detail = error instanceof Error && error.message ? error.message : 'Unexpected provider error'
    const notice = `The provider stopped before completing its response: ${detail}`
    const suffix = fullResponse ? `\n\n${notice}` : notice
    onChunk(suffix)
    return fullResponse + suffix
  }
  const markupError = () => new Error('The provider returned tool calls as text instead of structured tool calls. No calls in that text were executed; please retry or use another model.')

  // Each recovery is bounded. Empty answers may finish from existing results;
  // promises to act get one forced tool round.
  let hasRecovered = false
  let hasRecoveredEmpty = false
  let hasRecoveredMarkup = false
  let forcedToolChoice: 'required' | null = forceFirstToolChoice ? 'required' : null

  const sendActivity = (event: { type: 'thinking' } | { type: 'tool'; name: string; server: string }) => {
    if (webContents && !webContents.isDestroyed()) webContents.send('chat:activity', event)
    onActivity?.(event)
  }
  const sendToolFinished = (event: ToolLoopToolFinishedEvent) => {
    options.outputRecovery?.recordToolCompletion()
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

  try {
    for (let i = 0; i < MCP_MAX_ITERATIONS; i++) {
      if (estimateToolRequestTokens(loopMessages, toolDefs) > inputBudget()) {
        const before = estimateToolRequestTokens(loopMessages, toolDefs)
        loopMessages = trimToolLoopContext(loopMessages, toolDefs, inputBudget(), currentTask)
        debugLog('tool-loop', `compacted context: estimatedTokens=${before} retainedTokens=${estimateToolRequestTokens(loopMessages, toolDefs)} budget=${inputBudget()}`)
      }

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
      const emitRoundText = (chunk: string) => {
        if (chunk) streamedRoundText = true
        fullResponse += chunk
        onChunk(chunk)
      }
      const markupBuffer = createToolMarkupBuffer(emitRoundText)
      try {
        if (toolRoundStreamCaller) {
          result = await request(loopMessages, toolDefs, (msgs) => toolRoundStreamCaller(msgs, toolDefs, toolChoice, markupBuffer.write), (msgs) => { loopMessages = msgs })
        } else {
          result = await request(loopMessages, toolDefs, (msgs) => caller(msgs, toolDefs, toolChoice), (msgs) => { loopMessages = msgs })
        }
      } catch (error) {
        markupBuffer.flush()
        if (error instanceof Error && error.name === 'EmptyProviderResponseError' && !hasRecoveredEmpty) {
          hasRecoveredEmpty = true
          debugLog('tool-loop', `retrying empty response: round=${i + 1} executedTool=${executedTool}`)
          const reasoning = (error as Error & { reasoningContent?: string }).reasoningContent
          if (reasoning !== undefined) loopMessages.push({ role: 'assistant', content: null, reasoning_content: reasoning })
          loopMessages.push({ role: 'user', content: 'Your last response was empty. Continue from the existing tool results and provide a complete answer. Use tools only if more information or action is needed.' })
          continue
        }
        if (fullResponse || executedTool) {
          return reportInterruptedResponse(error)
        }
        throw error
      }
      assertConversationStartsAllowed()
      debugLog('tool-loop', `round=${i + 1} choice=${toolChoice} finishReason=${result.finishReason ?? 'missing'} contentChars=${result.content?.length ?? 0} tools=${result.toolCalls?.length ?? 0}`)

      const contentHasMarkup = hasUnexecutedToolMarkup(result.content ?? '')
      const streamHasMarkup = !markupBuffer.flush()
      const unexecutedMarkup = !result.toolCalls?.length && (contentHasMarkup || streamHasMarkup)
      if (unexecutedMarkup) {
        if (!hasRecoveredMarkup) {
          hasRecoveredMarkup = true
          forcedToolChoice = 'required'
          if (result.reasoningContent !== undefined) loopMessages.push({ role: 'assistant', content: null, reasoning_content: result.reasoningContent })
          loopMessages.push({ role: 'user', content: 'Your previous response contained tool-call markup as text, so no tool call was executed. Call the appropriate tool using the structured tool calling interface, then complete the task.' })
          continue
        }
        const notice = 'The provider repeatedly returned tool calls as text. Those calls were not executed; please retry or use another model.'
        const suffix = fullResponse ? `\n\n${notice}` : notice
        onChunk(suffix)
        return fullResponse + suffix
      }
      // A mixed response may have legitimate native calls as well as protocol text.
      // Only the native calls enter the normal execution path.
      if (contentHasMarkup) result = { ...result, content: null }

      if (result.usage) onUsage?.(result.usage)

      if (!modelEmitted && onModel && result.model) {
        modelEmitted = true
        onModel(result.model)
      }

      if (!result.toolCalls || result.toolCalls.length === 0) {
        const text = result.content ?? ''

        // Only a promise to act is a stalled plan. A factual answer after an
        // inspection is a valid completion and must not force an unrelated tool.
        const planningText = text.trim()
        const shouldRecoverPlanning = isActionPlanningText(planningText)
        if (!hasRecovered && shouldRecoverPlanning) {
          hasRecovered = true
          forcedToolChoice = 'required'
          // Thinking-mode tool requests must replay reasoning even for a round
          // without calls. Keep the completed assistant message before the nudge.
          loopMessages.push({ role: 'assistant', content: result.content, ...(result.reasoningContent !== undefined ? { reasoning_content: result.reasoningContent } : {}) })
          loopMessages.push({
            role: 'user' as const,
            content: 'Please proceed with the actions now — call the appropriate tools directly instead of narrating what you will do.'
          })
          continue
        }

        if (!planningText) {
          if (!hasRecoveredEmpty) {
            hasRecoveredEmpty = true
            loopMessages.push({ role: 'assistant', content: result.content, ...(result.reasoningContent !== undefined ? { reasoning_content: result.reasoningContent } : {}) })
            loopMessages.push({ role: 'user', content: 'Your last response was empty. Provide a complete answer using the existing results, calling tools only if necessary.' })
            continue
          }
          return reportInterruptedResponse(new Error('The provider repeatedly returned an empty answer.'))
        }

        if (hasRecovered && shouldRecoverPlanning) {
          return reportInterruptedResponse(new Error('The provider repeated a plan without calling a tool or completing the answer.'))
        }

        if (!streamedRoundText) {
          onChunk(text)
          fullResponse += text
        }
        loopMessages.push({ role: 'assistant', content: text, ...(result.reasoningContent !== undefined ? { reasoning_content: result.reasoningContent } : {}) })
        return fullResponse
      }

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
        ...(result.reasoningContent !== undefined ? { reasoning_content: result.reasoningContent } : {}),
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
    const originalSystem = messages[0]?.role === 'system' ? messages[0].content : ''
    const terminalBase = loopMessages.map((message, index) => message.role === 'system'
      ? { ...message, content: `${index === 0 ? originalSystem : message.content ?? ''}\n\n${FINAL_ANSWER_INSTRUCTION}` } as ProviderMessage
      : message)
    let finalMessages = trimToolLoopContext(terminalBase, toolDefs, inputBudget(), currentTask)

    // Stream the terminal answer when a streaming caller is available (parity with the CLI token
    // stream). A long final answer arriving as one blob reads as a stall; streaming avoids that.
    if (finalStreamCaller) {
      let streamedAny = false
      const trackedChunk = (chunk: string) => {
        if (chunk.trim()) streamedAny = true
        fullResponse += chunk
        onChunk(chunk)
      }
      const markupBuffer = createToolMarkupBuffer(trackedChunk)
      try {
        const final = await request(finalMessages, toolDefs, (msgs) => finalStreamCaller(msgs, markupBuffer.write), (msgs) => { finalMessages = msgs })
        if (final?.toolCalls?.length) throw markupError()
        if (!markupBuffer.flush()) throw markupError()
        if (!streamedAny) throw new Error('The provider returned an empty final answer.')
        loopMessages.push({ role: 'assistant', content: final?.content ?? fullResponse, ...(final?.reasoningContent !== undefined ? { reasoning_content: final.reasoningContent } : {}) })
        return fullResponse
      } catch (error) {
        markupBuffer.flush()
        // If text already streamed, surface the error rather than re-running the non-streaming
        // caller (which would duplicate the streamed text). If nothing streamed (e.g. the endpoint
        // rejected the request outright), fall through to the resilient non-streaming path.
        if (streamedAny) return reportInterruptedResponse(error)
        // Token recovery is shared with all earlier rounds. A terminal length
        // failure must not acquire another attempt via the fallback transport.
        if (providerFinishReason(error) === 'length') throw error
        // No terminal text was emitted: let the resilient non-streaming fallback below retry
        // endpoints that reject streaming outright.
      }
    }

    let finalResult: ProviderNonStreamResult
    try {
      finalResult = await request(finalMessages, toolDefs, (msgs) => caller(msgs, undefined, 'none'), (msgs) => { finalMessages = msgs })
    } catch (error) {
      if (fullResponse || executedTool) return reportInterruptedResponse(error)
      throw error
    }
    if (finalResult.usage) onUsage?.(finalResult.usage)
    if (hasUnexecutedToolMarkup(finalResult.content ?? '') || finalResult.toolCalls?.length) {
      return reportInterruptedResponse(markupError())
    }
    if (!modelEmitted && onModel && finalResult.model) {
      onModel(finalResult.model)
    }
    const text = finalResult.content ?? ''
    if (!text.trim()) return reportInterruptedResponse(new Error('The provider returned an empty final answer.'))
    loopMessages.push({ role: 'assistant', content: text, ...(finalResult.reasoningContent !== undefined ? { reasoning_content: finalResult.reasoningContent } : {}) })
    onChunk(text)
    fullResponse += text
    return fullResponse || (executedTool
      ? 'I completed some tool actions, but the provider returned no final response.'
      : fullResponse)
  } catch (error) {
    if (fullResponse || executedTool) return reportInterruptedResponse(error)
    throw error
  } finally {
    const taskIndex = currentTask ? loopMessages.indexOf(currentTask) : -1
    if (taskIndex >= 0) options.onHistory?.(loopMessages.slice(taskIndex + 1))
  }
}

function isActionPlanningText(text: string): boolean {
  if (text.length > 600 || /[`]|^\s*>/m.test(text)) return false
  return /(?:^|[.!?]\s+)(?:(?:now|first|next)[,:]?\s+)?(?:i['’]?m going to|i['’]?ll|i will|let me|i need to)\b[^.!?]{0,180}\b(?:call|use|open|read|write|edit|update|create|click|fill|search|inspect|investigate|review|compare|trace|look|run|check|find|navigate|apply|change|save|delete|fetch|test|implement|perform)\b[^.!?]*[.!]?\s*$/i.test(text)
}

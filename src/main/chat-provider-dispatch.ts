import type { WebContents } from 'electron'
import {
  PROVIDERS,
  sendOpenAIMessage,
  sendOpenAIWithToolsResilient,
  sendOpenAIWithToolsStream,
  sendAnthropicMessage,
  sendAnthropicMessagesStream,
  sendAnthropicWithTools,
  sendAnthropicWithToolsStream,
  sendAzureMessage,
  sendAzureWithTools,
  sendAzureWithToolsStream,
  getAzureEndpoint,
  toOpenAICompatibleMessages,
  type ProviderMessage,
} from './providers'
import { runProviderMcpToolLoop } from './tool-loop'
import type { ModelToolStreamCaller, ToolLoopToolFinishedEvent, ToolLoopToolStartedEvent } from './tool-loop'
import type { McpExecutionPolicy } from './mcp'
import { callWithResilience } from './provider-resilience'
import type { ToolDefinition, ToolChoice, ProviderNonStreamResult } from './provider-types'
import type { InlineHandler, MobileChatActivity } from './chat-context-builder'
import type { MessageContentPart } from './provider-core-types'
import { resolveToolsSupported } from '../shared/models'
import { getCachedCatalog } from './model-catalog'
import { debugLog } from './debug-mode'
import { PROVIDER_THINKING_SUPPORT } from '../shared/types'
import type { ProviderCredentialInput } from './credential-vault'
import type { Citation } from '../shared/citations'
import { countProviderInputTokens } from './token-counting'
import type { TokenCount } from '../shared/token-usage'

function stripImageParts(msgs: ProviderMessage[]): ProviderMessage[] {
  return msgs.map((msg) => {
    if (msg.role === 'tool' || !Array.isArray(msg.content)) return msg
    const textOnly = (msg.content as MessageContentPart[]).filter((p) => p.type !== 'image_url')
    return { ...msg, content: textOnly.length > 0 ? textOnly : '' } as ProviderMessage
  })
}

export type ProviderDispatchOptions = {
  providerName: string
  providerModel: string
  /** Opaque vault reference used by production callers. */
  credential?: ProviderCredentialInput
  /** @deprecated Test/legacy compatibility only; production callers must use credential. */
  byokKey?: ProviderCredentialInput
  chatMessages: ProviderMessage[]
  toolDefs: ToolDefinition[]
  toolMap: Map<string, { serverId: string; toolName: string }>
  effectiveAgentId: string | null
  agenticMode: boolean
  wikiInlineHandlers: Map<string, InlineHandler>
  toolDirective: string
  generationOptions: { temperature: number; maxTokens: number; thinkingEffort?: string }
  conversationId: string
  webContents: WebContents | undefined
  sendChunk: (chunk: string) => void
  sendActivity: (a: MobileChatActivity) => void
  onModel?: (model: string) => void
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
  onCitations?: (citations: Citation[]) => void
  onPreflightUsage?: (count: TokenCount) => void
  systemPrompt: string
  onThinkingChunk?: (blockId: string, chunk: string) => void
  onThinkingEnd?: (blockId: string) => void
  onToolFinished?: (event: ToolLoopToolFinishedEvent) => void
  onToolStarted?: (event: ToolLoopToolStartedEvent) => void
  toolPolicy?: { preApproved: string[]; alwaysAsk: string[]; neverAllow: string[] }
  fullAutoApprove?: boolean
  forceFirstToolChoice?: boolean
  mcpPolicy?: McpExecutionPolicy
}

function makeActivityHandler(sendActivity: (a: MobileChatActivity) => void) {
  return (event: { type: 'thinking' } | { type: 'tool'; name: string; server: string }) => {
    if (event.type === 'tool') {
      sendActivity({ state: 'tool', label: `Running ${event.name}`, toolName: event.name, serverName: event.server })
    } else {
      sendActivity({ state: 'thinking', label: 'Thinking' })
    }
  }
}

/**
 * Keeps transient retry behavior for streamed tool rounds, but never retries a
 * request after it has already exposed text to the UI. Retrying at that point
 * would duplicate the narration and break the visible chronology.
 */
function makeStreamingToolRoundCaller(
  request: (
    messages: ProviderMessage[],
    tools: ToolDefinition[] | undefined,
    choice: ToolChoice,
    onChunk: (chunk: string) => void,
  ) => Promise<ProviderNonStreamResult>,
): ModelToolStreamCaller {
  return (messages, tools, choice, onChunk) => {
    let emitted = false
    return callWithResilience(
      (effectiveChoice) => request(messages, tools, effectiveChoice, (chunk) => {
        if (chunk) emitted = true
        onChunk(chunk)
      }).catch((error) => {
        if (emitted) {
          throw new Error(`Provider stream interrupted after partial tool-round output: ${error instanceof Error ? error.message : String(error)}`)
        }
        throw error
      }),
      choice,
    )
  }
}


export async function dispatchToProvider(opts: ProviderDispatchOptions): Promise<string> {
  const {
    providerName,
    providerModel,
    credential,
    byokKey: legacyByokKey,
    toolDefs,
    toolMap,
    effectiveAgentId,
    agenticMode,
    wikiInlineHandlers,
    toolDirective,
    generationOptions,
    conversationId,
    webContents,
    sendChunk,
    sendActivity,
    onModel,
    onUsage,
    onThinkingChunk: callerOnThinkingChunk,
    onThinkingEnd: callerOnThinkingEnd,
    onToolFinished,
    onToolStarted,
    toolPolicy,
    fullAutoApprove,
    forceFirstToolChoice,
    mcpPolicy,
  } = opts
  const byokKey = credential ?? legacyByokKey
  if (!byokKey) throw new Error('No provider credential reference supplied')
  let { chatMessages, systemPrompt } = opts

  // Strip thinking effort for providers that don't support it (H5).
  // openrouter does not expose Anthropic extended thinking via its OpenAI-compatible endpoint.
  const thinkingSupport = PROVIDER_THINKING_SUPPORT[providerName]
  const effectiveGenerationOptions = { ...generationOptions }
  if (
    effectiveGenerationOptions.thinkingEffort &&
    effectiveGenerationOptions.thinkingEffort !== 'disabled' &&
    thinkingSupport === false
  ) {
    debugLog('provider', `${providerName}: thinking not supported — stripping thinkingEffort=${effectiveGenerationOptions.thinkingEffort} model=${providerModel}`)
    webContents?.send('chat:activity-global', { label: `Thinking effort ignored: not supported by ${providerName}` })
    effectiveGenerationOptions.thinkingEffort = 'disabled'
  } else if (
    effectiveGenerationOptions.thinkingEffort &&
    effectiveGenerationOptions.thinkingEffort !== 'disabled' &&
    thinkingSupport === 'o-series-only' &&
    !/^o\d|^o-/.test(providerModel)
  ) {
    debugLog('provider', `${providerName}: thinking only supported for o-series models — stripping thinkingEffort=${effectiveGenerationOptions.thinkingEffort} model=${providerModel}`)
    effectiveGenerationOptions.thinkingEffort = 'disabled'
  }

  const catalog = getCachedCatalog()
  const catalogEntry = catalog.find((m) => m.id === providerModel)
  const toolsSupported = resolveToolsSupported(providerName, providerModel, catalog)
  const toolSupportSource = providerName !== 'openrouter'
    ? 'catalog-lookup'
    : catalogEntry
      ? `openrouter-catalog caps=[${catalogEntry.capabilities.join(',')}]`
      : `openrouter-heuristic id="${providerModel.toLowerCase().replace(/^~/, '')}"`
  const effectiveToolDefs = toolsSupported ? toolDefs : []
  const hasToolLoop = effectiveToolDefs.length > 0
  if (opts.onPreflightUsage) {
    const count = await countProviderInputTokens({
      providerName,
      model: providerModel,
      credential: byokKey,
      messages: chatMessages,
      tools: effectiveToolDefs,
      conversationId,
    })
    if (count) opts.onPreflightUsage(count)
  }
  debugLog('provider', `dispatch: provider=${providerName} model=${providerModel} toolsSupported=${toolsSupported} toolSupportSource=${toolSupportSource} toolDefs=${toolDefs.length} effectiveTools=${effectiveToolDefs.length} hasToolLoop=${hasToolLoop} agenticMode=${agenticMode}`)
  const inlineHandlers = wikiInlineHandlers.size > 0 ? wikiInlineHandlers : undefined
  const agentId = effectiveAgentId ?? 'default'
  const onActivity = makeActivityHandler(sendActivity)

  // When this model/endpoint can't actually call tools but the agent has tools configured
  // (toolDefs.length > 0), the system prompt built upstream still describes those tools as
  // available. Left uncorrected, models — especially ones with a strong "helpful assistant"
  // prior and no tool support (e.g. OpenRouter Hermes/Nous-family models) — will hallucinate
  // having performed the action instead of admitting they can't. Override that impression here,
  // where toolsSupported is actually known, rather than relying on the model to infer it.
  const noToolSupportNotice =
    !toolsSupported && toolDefs.length > 0
      ? '\n\nIMPORTANT: Despite any tool descriptions elsewhere in this prompt, this model/endpoint does ' +
        'not support tool calling in this conversation. You cannot read, write, or modify files, search ' +
        'the wiki, or call any other tool — you have no way to actually perform those actions. If the ' +
        'user asks you to do something that would require a tool, say plainly that this model does not ' +
        'support tool calling and suggest switching to a tool-capable model. Do NOT claim to have read, ' +
        'written, or otherwise acted on any file or system, and do NOT invent a result as if a tool had run.'
      : ''
  if (noToolSupportNotice) {
    chatMessages = chatMessages.map((m, i) =>
      i === 0 && m.role === 'system' ? { ...m, content: `${m.content as string}${noToolSupportNotice}` } : m,
    )
    systemPrompt = `${systemPrompt}${noToolSupportNotice}`
  }

  const thinkingCallbacks = {
    onThinkingChunk: (blockId: string, chunk: string) => {
      if (callerOnThinkingChunk) {
        callerOnThinkingChunk(blockId, chunk)
      } else {
        webContents?.send('chat:thinking-delta', { blockId, chunk })
      }
    },
    onThinkingEnd: (blockId: string) => {
      if (callerOnThinkingEnd) {
        callerOnThinkingEnd(blockId)
      } else {
        webContents?.send('chat:thinking-end', { blockId })
      }
    },
    onCitations: (citations: Citation[]) => opts.onCitations?.(citations),
  }

  if (providerName === 'anthropic') {
    debugLog('provider', `anthropic: path=${hasToolLoop ? 'tool-loop' : 'streaming'} model=${providerModel} thinkingEffort=${generationOptions.thinkingEffort ?? 'none'}`)
    if (hasToolLoop) {
      return runProviderMcpToolLoop(
        (msgs, tools, choice) =>
          callWithResilience(
            (c) => sendAnthropicWithTools(byokKey, providerModel, msgs, tools ?? [], c, { ...effectiveGenerationOptions, ...thinkingCallbacks, onUsage, conversationId }),
            choice,
          ),
        chatMessages,
        effectiveToolDefs,
        toolMap,
        agentId,
        conversationId,
        webContents,
        sendChunk,
        onModel,
        agenticMode,
        inlineHandlers,
        toolDirective,
        onActivity,
        undefined,
        toolPolicy,
        onToolFinished,
        fullAutoApprove,
        forceFirstToolChoice,
        onUsage,
        async (msgs, onChunk) => {
          await sendAnthropicMessagesStream(conversationId, byokKey, providerModel, msgs, onChunk, { ...effectiveGenerationOptions, ...thinkingCallbacks })
        },
        onToolStarted,
        makeStreamingToolRoundCaller((msgs, tools, choice, onChunk) =>
          sendAnthropicWithToolsStream(byokKey, providerModel, msgs, tools ?? [], choice, onChunk, {
            ...effectiveGenerationOptions,
            ...thinkingCallbacks,
            onUsage,
            conversationId,
          })
        ),
        mcpPolicy,
      )
    }
    sendActivity({ state: 'thinking', label: 'Generating response' })
    return sendAnthropicMessage(
      conversationId,
      byokKey,
      providerModel,
      chatMessages.slice(1),
      systemPrompt,
      sendChunk,
      { ...effectiveGenerationOptions, ...thinkingCallbacks },
    )
  }

  if (providerName === 'openai') {
    debugLog('provider', `openai: path=${hasToolLoop ? 'tool-loop' : 'streaming'} model=${providerModel}`)
    if (hasToolLoop) {
      return runProviderMcpToolLoop(
        (msgs, tools, choice) =>
          callWithResilience(
            (c) => sendOpenAIWithToolsResilient(byokKey, providerModel, msgs, tools ?? [], c, { ...effectiveGenerationOptions, ...thinkingCallbacks, onUsage, conversationId }),
            choice,
          ),
        chatMessages,
        effectiveToolDefs,
        toolMap,
        agentId,
        conversationId,
        webContents,
        sendChunk,
        onModel,
        agenticMode,
        inlineHandlers,
        toolDirective,
        onActivity,
        undefined,
        toolPolicy,
        onToolFinished,
        fullAutoApprove,
        forceFirstToolChoice,
        onUsage,
        async (msgs, onChunk) => {
          await sendOpenAIMessage(conversationId, byokKey, providerModel, toOpenAICompatibleMessages(msgs), onChunk, { ...effectiveGenerationOptions, ...thinkingCallbacks, onUsage })
        },
        onToolStarted,
        makeStreamingToolRoundCaller((msgs, tools, choice, onChunk) =>
          sendOpenAIWithToolsStream(byokKey, providerModel, msgs, tools ?? [], choice, onChunk, {
            ...effectiveGenerationOptions,
            ...thinkingCallbacks,
            onUsage,
            conversationId,
          })
        ),
        mcpPolicy,
      )
    }
    sendActivity({ state: 'thinking', label: 'Generating response' })
    return sendOpenAIMessage(conversationId, byokKey, providerModel, chatMessages, sendChunk, {
      ...effectiveGenerationOptions,
      ...thinkingCallbacks,
      onUsage,
    })
  }

  // OpenAI-compatible providers (OpenRouter, Groq, Mistral, Gemini, xAI)
  const openAiCompatible = ['openrouter', 'groq', 'mistral', 'gemini', 'xai']
  if (openAiCompatible.includes(providerName)) {
    const providerCfg = PROVIDERS.find((p) => p.name === providerName)
    const baseUrl = providerCfg?.baseUrl
    debugLog('provider', `${providerName}: path=${hasToolLoop ? 'tool-loop' : 'streaming'} model=${providerModel} baseUrl=${baseUrl ?? 'default'}`)
    if (hasToolLoop) {
      // Some OpenRouter models don't support tool use or image input. If the
      // first call fails with those specific errors, retry gracefully so the
      // user gets a response instead of a hard failure.
      const caller = (msgs: ProviderMessage[], tools: ToolDefinition[] | undefined, choice: ToolChoice): Promise<ProviderNonStreamResult> =>
        callWithResilience(async (c) => {
          try {
            return await sendOpenAIWithToolsResilient(byokKey, providerModel, msgs, tools ?? [], c, { ...effectiveGenerationOptions, ...thinkingCallbacks, onUsage, conversationId }, baseUrl)
          } catch (err) {
            if (!(err instanceof Error)) throw err
            if (err.message.includes('No endpoints found that support tool use')) {
              debugLog('provider', `${providerName}: tool-use not supported by endpoint — retrying without tools model=${providerModel}`)
              const text = await sendOpenAIMessage(conversationId, byokKey, providerModel, msgs, sendChunk, { ...effectiveGenerationOptions, ...thinkingCallbacks, onUsage }, baseUrl)
              return { content: text, toolCalls: [] }
            }
            if (err.message.includes('No endpoints found that support image input')) {
              debugLog('provider', `${providerName}: image input not supported by endpoint — retrying with text-only model=${providerModel}`)
              const text = await sendOpenAIMessage(conversationId, byokKey, providerModel, stripImageParts(msgs), sendChunk, { ...effectiveGenerationOptions, ...thinkingCallbacks, onUsage }, baseUrl)
              return { content: text, toolCalls: [] }
            }
            throw err
          }
        }, choice)
      const streamingToolCaller = makeStreamingToolRoundCaller((msgs, tools, choice, onChunk) =>
        sendOpenAIWithToolsStream(byokKey, providerModel, msgs, tools ?? [], choice, onChunk, {
          ...effectiveGenerationOptions,
          ...thinkingCallbacks,
          onUsage,
          conversationId,
        }, baseUrl).catch(async (err) => {
          if (!(err instanceof Error)) throw err
          if (err.message.includes('No endpoints found that support tool use')) {
            debugLog('provider', `${providerName}: streamed tool use not supported by endpoint — retrying without tools model=${providerModel}`)
            const text = await sendOpenAIMessage(conversationId, byokKey, providerModel, msgs, onChunk, { ...effectiveGenerationOptions, ...thinkingCallbacks, onUsage }, baseUrl)
            return { content: text, toolCalls: [] }
          }
          if (err.message.includes('No endpoints found that support image input')) {
            debugLog('provider', `${providerName}: streamed image input not supported — retrying with text-only model=${providerModel}`)
            const text = await sendOpenAIMessage(conversationId, byokKey, providerModel, stripImageParts(msgs), onChunk, { ...effectiveGenerationOptions, ...thinkingCallbacks, onUsage }, baseUrl)
            return { content: text, toolCalls: [] }
          }
          throw err
        })
      )
      return runProviderMcpToolLoop(
        caller,
        chatMessages,
        effectiveToolDefs,
        toolMap,
        agentId,
        conversationId,
        webContents,
        sendChunk,
        onModel,
        agenticMode,
        inlineHandlers,
        toolDirective,
        onActivity,
        undefined,
        toolPolicy,
        onToolFinished,
        fullAutoApprove,
        forceFirstToolChoice,
        onUsage,
        async (msgs, onChunk) => {
          await sendOpenAIMessage(conversationId, byokKey, providerModel, toOpenAICompatibleMessages(msgs), onChunk, { ...effectiveGenerationOptions, ...thinkingCallbacks, onUsage }, baseUrl)
        },
        onToolStarted,
        streamingToolCaller,
        mcpPolicy,
      )
    }
    sendActivity({ state: 'thinking', label: 'Generating response' })
    try {
      return await sendOpenAIMessage(conversationId, byokKey, providerModel, chatMessages, sendChunk, {
        ...effectiveGenerationOptions,
        ...thinkingCallbacks,
        onUsage,
      }, baseUrl)
    } catch (err) {
      if (err instanceof Error && err.message.includes('No endpoints found that support image input')) {
        return sendOpenAIMessage(conversationId, byokKey, providerModel, stripImageParts(chatMessages), sendChunk, { ...effectiveGenerationOptions, onUsage, onCitations: opts.onCitations }, baseUrl)
      }
      throw err
    }
  }

  // Azure
  const azureEndpoint = getAzureEndpoint()
  if (!azureEndpoint) {
    debugLog('provider', `azure: endpoint not configured — aborting model=${providerModel}`)
    throw new Error('Azure endpoint not configured')
  }
  debugLog('provider', `azure: path=${hasToolLoop ? 'tool-loop' : 'streaming'} model=${providerModel} endpoint=${azureEndpoint.slice(0, 40)}`)
  if (hasToolLoop) {
    return runProviderMcpToolLoop(
      (msgs, tools, choice) =>
        callWithResilience(
          (c) => sendAzureWithTools(byokKey, azureEndpoint, providerModel, msgs, tools ?? [], c, { ...effectiveGenerationOptions, onUsage, onCitations: opts.onCitations, conversationId }),
          choice,
        ),
      chatMessages,
      effectiveToolDefs,
      toolMap,
      agentId,
      conversationId,
      webContents,
      sendChunk,
      onModel,
      agenticMode,
      inlineHandlers,
      toolDirective,
      onActivity,
      undefined,
      toolPolicy,
      onToolFinished,
      fullAutoApprove,
      forceFirstToolChoice,
      onUsage,
      async (msgs, onChunk) => {
        await sendAzureMessage(conversationId, byokKey, azureEndpoint, providerModel, toOpenAICompatibleMessages(msgs), onChunk, { ...effectiveGenerationOptions, onCitations: opts.onCitations })
      },
      onToolStarted,
      makeStreamingToolRoundCaller((msgs, tools, choice, onChunk) =>
        sendAzureWithToolsStream(byokKey, azureEndpoint, providerModel, msgs, tools ?? [], choice, onChunk, {
          ...effectiveGenerationOptions,
          onUsage,
          onCitations: opts.onCitations,
          conversationId,
        })
      ),
      mcpPolicy,
    )
  }
  sendActivity({ state: 'thinking', label: 'Generating response' })
  return sendAzureMessage(
    conversationId,
    byokKey,
    azureEndpoint,
    providerModel,
    chatMessages,
    sendChunk,
    { ...effectiveGenerationOptions, onCitations: opts.onCitations },
  )
}

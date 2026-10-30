import { httpsRequestUrl, providerHttpError, parseSseStream } from '../http-client'
import type { ProviderNonStreamResult, ToolCallResult, ToolChoice, ToolDefinition } from '../provider-types'
import type { ProviderMessage } from '../provider-core-types'
import { toAnthropicContent, toAnthropicMessages } from '../provider-messages'
import type { AnthropicContentBlock } from '../provider-messages'
import { runStreamingRequest, rejectHttpError } from './streaming'
import { debugLog } from '../debug-mode'
import { resolveProviderCredentialInput, type ProviderCredentialInput } from '../credential-vault'
import { extractCitations, type Citation } from '../../shared/citations'

interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

const THINKING_BUDGET_MAP: Record<string, number> = { low: 2000, medium: 8000, high: 16000, max: 32000 }

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }
}

/** Enables extended thinking on the request body when the effort + model support it. */
function applyThinkingBudget(bodyObj: Record<string, unknown>, model: string, thinkingEffort?: string): void {
  if (!thinkingEffort || thinkingEffort === 'disabled' || !supportsExtendedThinking(model)) return
  const budget = THINKING_BUDGET_MAP[thinkingEffort]
  if (budget) {
    bodyObj.thinking = { type: 'enabled', budget_tokens: budget }
    bodyObj.temperature = 1
  }
}

export function toAnthropicTools(
  tools: ToolDefinition[]
): { tools: AnthropicTool[]; nameMap: Map<string, string> } {
  const nameMap = new Map<string, string>()
  const usedNames = new Set<string>()

  const anthropicTools: AnthropicTool[] = tools.map((tool) => {
    const originalName = tool.function.name
    let normalized = originalName.replace(/[^a-zA-Z0-9_-]/g, '_')
    if (normalized.length > 64) normalized = normalized.slice(0, 64)
    if (usedNames.has(normalized)) {
      let suffix = 2
      while (usedNames.has(`${normalized.slice(0, 62)}_${suffix}`)) suffix++
      normalized = `${normalized.slice(0, 62)}_${suffix}`
    }
    usedNames.add(normalized)
    nameMap.set(normalized, originalName)

    return {
      name: normalized,
      description: tool.function.description,
      input_schema: tool.function.parameters
    }
  })

  return { tools: anthropicTools, nameMap }
}

function supportsExtendedThinking(model: string): boolean {
  return /claude-3[-.]?[57]|claude-3[-.]?7|claude-4/.test(model)
}

export async function sendAnthropicWithTools(
  apiKey: ProviderCredentialInput,
  model: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: {
    maxTokens?: number
    temperature?: number
    thinkingEffort?: string
    conversationId?: string
    onThinkingChunk?: (blockId: string, chunk: string) => void
    onThinkingEnd?: (blockId: string) => void
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
  } = {}
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const { system, messages: anthropicMsgs } = toAnthropicMessages(messages)
  const { tools: anthropicTools, nameMap } = toAnthropicTools(tools)

  const toolChoiceParam =
    toolChoice === 'required' ? { type: 'any' } :
    toolChoice === 'none' ? { type: 'auto' } :
    { type: 'auto' }

  const bodyObj: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    stream: false,
    messages: anthropicMsgs
  }
  if (system) bodyObj.system = system
  if (toolChoice !== 'none' && anthropicTools.length > 0) {
    bodyObj.tools = anthropicTools
    bodyObj.tool_choice = toolChoiceParam
  }
  applyThinkingBudget(bodyObj, model, options.thinkingEffort)

  const body = JSON.stringify(bodyObj)
  const thinkingEnabled = !!(bodyObj.thinking)
  const thinkingBudget = thinkingEnabled ? (bodyObj.thinking as { budget_tokens?: number })?.budget_tokens : undefined
  debugLog('anthropic', `withTools: model=${model} tools=${tools.length} thinking=${thinkingEnabled}${thinkingBudget ? ` budget=${thinkingBudget}` : ''} keyLen=${apiKey.length}`)
  const { status, data } = await httpsRequestUrl(
    ANTHROPIC_MESSAGES_URL,
    {
      method: 'POST',
      headers: { ...anthropicHeaders(apiKey), 'Content-Length': String(Buffer.byteLength(body)) }
    },
    body,
    options.conversationId,
  )

  if (status >= 400) {
    const err = providerHttpError('Anthropic', status, data)
    debugLog('anthropic', `withTools error: HTTP ${status} model=${model} message="${err.message}"`)
    throw err
  }
  debugLog('anthropic', `withTools: HTTP ${status} model=${model}`)

  const parsed = JSON.parse(data)
  const contentBlocks: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }> =
    parsed.content ?? []

  let content: string | null = null
  const toolCalls: ToolCallResult[] = []

  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    if (block.type === 'thinking' && (block.thinking || block.text)) {
      const blockId = `thinking-${i}`
      const thinkingText = block.thinking ?? block.text ?? ''
      options.onThinkingChunk?.(blockId, thinkingText)
      options.onThinkingEnd?.(blockId)
    } else if (block.type === 'text' && block.text) {
      content = (content ?? '') + block.text
    } else if (block.type === 'tool_use' && block.id && block.name) {
      const originalName = nameMap.get(block.name) ?? block.name
      const args = block.input && typeof block.input === 'object'
        ? block.input as Record<string, unknown>
        : {}
      toolCalls.push({ id: block.id, name: originalName, arguments: args })
    }
  }

  const rawUsage = parsed.usage as { input_tokens?: number; output_tokens?: number } | undefined
  const usage = rawUsage && typeof rawUsage.input_tokens === 'number' && typeof rawUsage.output_tokens === 'number'
    ? { inputTokens: rawUsage.input_tokens, outputTokens: rawUsage.output_tokens }
    : undefined
  if (usage) options.onUsage?.(usage)

  return {
    content,
    toolCalls,
    ...(typeof parsed.stop_reason === 'string' ? { finishReason: parsed.stop_reason } : {}),
    ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
    ...(usage ? { usage } : {}),
  }
}

interface AnthropicStreamContentBlock {
  type?: string
  thinking?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

interface AnthropicStreamPayload {
  model?: string
  content?: AnthropicStreamContentBlock[]
  usage?: { output_tokens?: number }
  message?: { model?: string; usage?: { input_tokens?: number } }
  type?: string
  index?: number
  content_block?: AnthropicStreamContentBlock
  delta?: {
    type?: string
    thinking?: string
    text?: string
    partial_json?: string
  }
}

/**
 * Streaming counterpart to sendAnthropicWithTools. Anthropic emits tool input
 * as input_json_delta fragments; those fragments are deliberately kept out of
 * the tool loop until the complete tool_use block has arrived.
 */
export function sendAnthropicWithToolsStream(
  apiKey: ProviderCredentialInput,
  model: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  onChunk: (chunk: string) => void,
  options: {
    maxTokens?: number
    temperature?: number
    thinkingEffort?: string
    conversationId?: string
    onThinkingChunk?: (blockId: string, chunk: string) => void
    onThinkingEnd?: (blockId: string) => void
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
    onCitations?: (citations: Citation[]) => void
  } = {},
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const { system, messages: anthropicMsgs } = toAnthropicMessages(messages)
  const { tools: anthropicTools, nameMap } = toAnthropicTools(tools)
  const toolChoiceParam =
    toolChoice === 'required' ? { type: 'any' } :
    { type: 'auto' }
  const bodyObj: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    stream: true,
    ...(system ? { system } : {}),
    messages: anthropicMsgs,
  }
  if (toolChoice !== 'none' && anthropicTools.length > 0) {
    bodyObj.tools = anthropicTools
    bodyObj.tool_choice = toolChoiceParam
  }
  applyThinkingBudget(bodyObj, model, options.thinkingEffort)

  let streamedResult: ProviderNonStreamResult = { content: null, toolCalls: [] }
  return runStreamingRequest(conversationIdOrEmpty(options.conversationId), ANTHROPIC_MESSAGES_URL, anthropicHeaders(apiKey), JSON.stringify(bodyObj), (res, finish) => {
    if (res.statusCode && res.statusCode >= 400) {
      rejectHttpError(res, finish, (errBody) => providerHttpError('Anthropic', res.statusCode, errBody))
      return
    }

    const contentType = res.headers['content-type'] ?? ''
    if (!contentType.includes('text/event-stream')) {
      let rawBody = ''
      res.on('data', (chunk: Buffer) => { rawBody += chunk.toString() })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawBody) as AnthropicStreamPayload
          options.onCitations?.(extractCitations(parsed))
          const blocks = Array.isArray(parsed.content) ? parsed.content : []
          let content = ''
          const toolCalls: ToolCallResult[] = []
          blocks.forEach((block, index) => {
            if (block.type === 'thinking' && (block.thinking || block.text)) {
              const thinking = block.thinking ?? block.text ?? ''
              options.onThinkingChunk?.(`thinking-${index}`, thinking)
              options.onThinkingEnd?.(`thinking-${index}`)
            } else if (block.type === 'text' && typeof block.text === 'string') {
              content += block.text
              onChunk(block.text)
            } else if (block.type === 'tool_use' && block.id && block.name) {
              const input = block.input && typeof block.input === 'object' && !Array.isArray(block.input)
                ? block.input as Record<string, unknown>
                : {}
              toolCalls.push({ id: block.id, name: nameMap.get(block.name) ?? block.name, arguments: input })
            }
          })
          const rawUsage = parsed.usage as { input_tokens?: number; output_tokens?: number } | undefined
          const usage = rawUsage && typeof rawUsage.input_tokens === 'number' && typeof rawUsage.output_tokens === 'number'
            ? { inputTokens: rawUsage.input_tokens, outputTokens: rawUsage.output_tokens }
            : undefined
          if (usage) options.onUsage?.(usage)
          streamedResult = {
            content: content || null,
            toolCalls,
            ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
            ...(usage ? { usage } : {}),
          }
        } catch {
          // Keep the empty result; the normal tool-loop recovery handles it.
        }
        finish.resolve(streamedResult.content ?? '')
      })
      res.on('error', (err: Error) => finish.reject(err))
      return
    }

    let content = ''
    let modelName: string | undefined
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    let activeThinkingBlockId: string | null = null
    const toolBlocks = new Map<number, { id: string; name: string; inputJson: string }>()

    parseSseStream(res, (data) => {
      try {
        const parsed = JSON.parse(data) as AnthropicStreamPayload
        options.onCitations?.(extractCitations(parsed))
        const message = parsed.message
        if (typeof message?.model === 'string') modelName = message.model
        if (typeof message?.usage?.input_tokens === 'number') inputTokens = message.usage.input_tokens
        if (typeof parsed.usage?.output_tokens === 'number') outputTokens = parsed.usage.output_tokens

        if (parsed.type === 'content_block_start') {
          const block = parsed.content_block
          const index = typeof parsed.index === 'number' ? parsed.index : toolBlocks.size
          if (block?.type === 'thinking') {
            activeThinkingBlockId = `thinking-${index}`
          } else if (block?.type === 'tool_use' && block.id && block.name) {
            toolBlocks.set(index, { id: block.id, name: block.name, inputJson: '' })
          }
        } else if (parsed.type === 'content_block_delta') {
          const index = typeof parsed.index === 'number' ? parsed.index : 0
          const delta = parsed.delta
          if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && activeThinkingBlockId) {
            options.onThinkingChunk?.(activeThinkingBlockId, delta.thinking)
          } else if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            content += delta.text
            onChunk(delta.text)
          } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            const tool = toolBlocks.get(index)
            if (tool) tool.inputJson += delta.partial_json
          }
        } else if (parsed.type === 'content_block_stop' && activeThinkingBlockId) {
          options.onThinkingEnd?.(activeThinkingBlockId)
          activeThinkingBlockId = null
        }
      } catch {
        // Skip malformed chunks; the provider stream parser continues.
      }
    })
      .then(() => {
        if (activeThinkingBlockId) options.onThinkingEnd?.(activeThinkingBlockId)
        const toolCalls: ToolCallResult[] = [...toolBlocks.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, block]) => {
            let args: Record<string, unknown> = {}
            let argsError: string | undefined
            try {
              const parsed = block.inputJson.trim() ? JSON.parse(block.inputJson) : {}
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                argsError = 'tool input was not a JSON object'
              } else {
                args = parsed as Record<string, unknown>
              }
            } catch {
              argsError = `could not parse tool input as JSON: ${block.inputJson.slice(0, 200)}`
            }
            return {
              id: block.id,
              name: nameMap.get(block.name) ?? block.name,
              arguments: args,
              ...(argsError ? { argsError } : {}),
            }
          })
        const usage = typeof inputTokens === 'number' && typeof outputTokens === 'number'
          ? { inputTokens, outputTokens }
          : undefined
        if (usage) options.onUsage?.(usage)
        streamedResult = {
          content: content || null,
          toolCalls,
          ...(modelName ? { model: modelName } : {}),
          ...(usage ? { usage } : {}),
        }
        finish.resolve(content)
      })
      .catch((err: Error) => finish.reject(err))
  }).then(() => streamedResult)
}

function conversationIdOrEmpty(conversationId?: string): string {
  return conversationId ?? ''
}

export async function sendAnthropicMessage(
  conversationId: string,
  apiKey: ProviderCredentialInput,
  model: string,
  messages: ProviderMessage[],
  systemPrompt: string | undefined,
  onChunk: (chunk: string) => void,
  options: {
    maxTokens?: number
    temperature?: number
    thinkingEffort?: string
    onThinkingChunk?: (blockId: string, chunk: string) => void
    onThinkingEnd?: (blockId: string) => void
    onCitations?: (citations: Citation[]) => void
  } = {}
): Promise<string> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const anthropicMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: toAnthropicContent(m.content ?? '') as string | AnthropicContentBlock[] }))
  const bodyObj: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    stream: true,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: anthropicMessages
  }
  applyThinkingBudget(bodyObj, model, options.thinkingEffort)
  const body = JSON.stringify(bodyObj)
  const streamThinkingEnabled = !!(bodyObj.thinking)
  const streamThinkingBudget = streamThinkingEnabled ? (bodyObj.thinking as { budget_tokens?: number })?.budget_tokens : undefined
  debugLog('anthropic', `stream: model=${model} thinking=${streamThinkingEnabled}${streamThinkingBudget ? ` budget=${streamThinkingBudget}` : ''} msgs=${messages.length} keyLen=${apiKey.length}`)

  return runAnthropicStream(conversationId, apiKey, model, body, onChunk, options)
}

interface AnthropicStreamCallbacks {
  onThinkingChunk?: (blockId: string, chunk: string) => void
  onThinkingEnd?: (blockId: string) => void
  onCitations?: (citations: Citation[]) => void
}

/** Shared SSE handler for Anthropic streaming (thinking + text deltas). */
function runAnthropicStream(
  conversationId: string,
  apiKey: string,
  model: string,
  body: string,
  onChunk: (chunk: string) => void,
  options: AnthropicStreamCallbacks,
): Promise<string> {
  return runStreamingRequest(conversationId, ANTHROPIC_MESSAGES_URL, anthropicHeaders(apiKey), body, (res, finish) => {
    if (res.statusCode && res.statusCode >= 400) {
      rejectHttpError(res, finish, (errBody) => {
        const err = providerHttpError('Anthropic', res.statusCode, errBody)
        debugLog('anthropic', `stream error: HTTP ${res.statusCode} model=${model} message="${err.message}"`)
        return err
      })
      return
    }
    debugLog('anthropic', `stream: HTTP ${res.statusCode} model=${model} — receiving chunks`)

    let fullContent = ''
    let activeThinkingBlockId: string | null = null

    parseSseStream(res, (data) => {
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>
        options.onCitations?.(extractCitations(parsed))
        if (
          parsed.type === 'content_block_start' &&
          (parsed.content_block as Record<string, unknown> | undefined)?.type === 'thinking'
        ) {
          activeThinkingBlockId = `thinking-${parsed.index as number ?? 0}`
        }
        if (parsed.type === 'content_block_stop' && activeThinkingBlockId) {
          options.onThinkingEnd?.(activeThinkingBlockId)
          activeThinkingBlockId = null
        }
        if (parsed.type === 'content_block_delta') {
          const delta = parsed.delta as Record<string, unknown> | undefined
          if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && activeThinkingBlockId) {
            options.onThinkingChunk?.(activeThinkingBlockId, delta.thinking)
          } else if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            fullContent += delta.text
            onChunk(delta.text)
          } else if (typeof (parsed.delta as Record<string, unknown> | undefined)?.text === 'string') {
            // fallback: older delta format without explicit type
            const text = (parsed.delta as { text: string }).text
            fullContent += text
            onChunk(text)
          }
        }
      } catch {
        // Skip malformed chunks
      }
    })
      .then(() => finish.resolve(fullContent))
      .catch((err: Error) => finish.reject(err))
  })
}

/**
 * Streams a terminal (text-only) answer for the BYOK tool loop. Unlike sendAnthropicMessage, this
 * accepts the full tool-loop message array (system + assistant tool_use + tool_result history) and
 * normalizes it via toAnthropicMessages so the streamed final answer has the same context the
 * non-streaming forced-'none' call would. No tools are sent — the model produces text only.
 */
export function sendAnthropicMessagesStream(
  conversationId: string,
  apiKey: ProviderCredentialInput,
  model: string,
  messages: ProviderMessage[],
  onChunk: (chunk: string) => void,
  options: {
    maxTokens?: number
    temperature?: number
    thinkingEffort?: string
    onThinkingChunk?: (blockId: string, chunk: string) => void
    onThinkingEnd?: (blockId: string) => void
    onCitations?: (citations: Citation[]) => void
  } = {},
): Promise<string> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const { system, messages: anthropicMsgs } = toAnthropicMessages(messages)
  const bodyObj: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    stream: true,
    ...(system ? { system } : {}),
    messages: anthropicMsgs,
  }
  applyThinkingBudget(bodyObj, model, options.thinkingEffort)
  const body = JSON.stringify(bodyObj)
  debugLog('anthropic', `stream-final: model=${model} msgs=${anthropicMsgs.length} keyLen=${apiKey.length}`)
  return runAnthropicStream(conversationId, apiKey, model, body, onChunk, options)
}

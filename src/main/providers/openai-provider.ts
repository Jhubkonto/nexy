import { randomUUID } from 'crypto'
import { parseSseStream, httpsRequestUrl, providerHttpError } from '../http-client'
import type { ProviderNonStreamResult, ToolCallResult, ToolChoice, ToolDefinition } from '../provider-types'
import type { ProviderMessage } from '../provider-core-types'
import { toOpenAICompatibleMessages } from '../provider-messages'
import { runStreamingRequest, rejectHttpError } from './streaming'
import { debugLog } from '../debug-mode'
import { resolveProviderCredentialInput, type ProviderCredentialInput } from '../credential-vault'
import { extractCitations, type Citation } from '../../shared/citations'
import { createToolMarkupBuffer, hasUnexecutedToolMarkup, parseDsmlToolCalls } from '../../shared/unexecuted-tool-markup'

// Returns true for OpenAI o-series and compatible reasoning models.
function supportsReasoningEffort(model: string): boolean {
  return /^o\d|\/o\d|[/-]o1[^a-z]|[/-]o3[^a-z]|[/-]o4[^a-z]/i.test(model)
}

const REASONING_EFFORT_MAP: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', max: 'high' }

function applyReasoningEffort(bodyObj: Record<string, unknown>, model: string, thinkingEffort?: string): void {
  if (!thinkingEffort || thinkingEffort === 'disabled' || !supportsReasoningEffort(model)) return
  const effort = REASONING_EFFORT_MAP[thinkingEffort]
  if (effort) bodyObj.reasoning_effort = effort
}

function isDeepSeek(baseUrl?: string): boolean {
  try { return !!baseUrl && new URL(baseUrl).hostname === 'api.deepseek.com' } catch { return false }
}

function prepareMessages(messages: ProviderMessage[], baseUrl?: string): ProviderMessage[] {
  const converted = toOpenAICompatibleMessages(messages)
  if (isDeepSeek(baseUrl)) return converted.map((message) => {
    if (message.role !== 'assistant') return message
    // Do not teach the model to repeat a failed tool protocol from chat history.
    const content = typeof message.content === 'string' && hasUnexecutedToolMarkup(message.content)
      ? '[An earlier response contained invalid tool-call markup. No calls in that text were executed.]'
      : message.content
    // Non-thinking recovery rounds have no reasoning. Represent that explicitly
    // when returning to thinking mode; never replace reasoning we did receive.
    return { ...message, content, reasoning_content: message.reasoning_content ?? '' }
  })
  return converted.map((message) => {
    if (message.role !== 'assistant') return message
    const { reasoning_content: _reasoning, ...rest } = message
    return rest
  })
}

function applyProviderOptions(body: Record<string, unknown>, model: string, effort?: string, baseUrl?: string): void {
  if (!isDeepSeek(baseUrl)) { applyReasoningEffort(body, model, effort); return }
  // DeepSeek rejects required tool choice in thinking mode. Preserve the caller's
  // request to force a tool (including protocol recovery) by disabling thinking
  // for this request, rather than silently weakening required to auto.
  // https://api-docs.deepseek.com/api/create-chat-completion/
  const enabled = effort !== 'disabled' && body.tool_choice !== 'required'
  body.thinking = { type: enabled ? 'enabled' : 'disabled' }
  if (enabled) {
    delete body.temperature
    body.reasoning_effort = effort === 'max' ? 'max' : effort === 'low' ? 'low' : 'high'
  }
}

/** One OpenAI-compatible chat-completions endpoint: OpenAI itself, a baseUrl-compatible provider, or Azure. */
interface ChatEndpoint {
  label: string
  url: string
  headers: Record<string, string>
}

const AZURE_API_VERSION = '2024-02-01'

function openAiEndpoint(apiKey: string, baseUrl?: string): ChatEndpoint {
  return {
    label: baseUrl ? 'OpenAI-compatible' : 'OpenAI',
    url: `${baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  }
}

function azureEndpoint(apiKey: string, endpoint: string, deployment: string): ChatEndpoint {
  return {
    label: 'Azure',
    url: `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${AZURE_API_VERSION}`,
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
  }
}

/** POSTs a non-streaming chat-completions body and returns the parsed JSON, throwing on HTTP errors.
 *  `abortKey` (a conversation id) makes the in-flight request cancellable via abortActiveStream. */
async function chatCompletionsRequest(endpoint: ChatEndpoint, body: string, abortKey?: string): Promise<Record<string, unknown>> {
  const { status, data } = await httpsRequestUrl(
    endpoint.url,
    {
      method: 'POST',
      headers: { ...endpoint.headers, 'Content-Length': String(Buffer.byteLength(body)) },
    },
    body,
    abortKey,
  )
  if (status >= 400) {
    const err = providerHttpError(endpoint.label, status, data)
    debugLog('openai', `request error: HTTP ${status} url=${endpoint.url} message="${err.message}"`)
    throw err
  }
  return JSON.parse(data)
}

/**
 * Best-effort repair of tool-call argument strings that aren't quite valid JSON. Smaller/OSS
 * models (common on OpenRouter) frequently emit trailing commas, unquoted output, or concatenated
 * fragments. We attempt a few tolerant fixes before giving up. Returns the parsed object, or an
 * `error` string describing why it could not be parsed so the caller can feed it back to the model.
 */
export function parseToolArguments(raw: string): { args: Record<string, unknown>; error?: string } {
  const text = (raw ?? '').trim()
  if (text === '' || text === '{}') return { args: {} }
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { args: parsed as Record<string, unknown> }
      : { args: {}, error: `arguments were valid JSON but not an object: ${text.slice(0, 200)}` }
  } catch {
    // Tolerant repair pass: strip trailing commas, and if the model concatenated multiple JSON
    // objects, keep only the first balanced one.
    const repaired = repairJsonObject(text)
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { args: parsed as Record<string, unknown> }
        }
      } catch { /* fall through to error */ }
    }
    return { args: {}, error: `could not parse arguments as JSON: ${text.slice(0, 200)}` }
  }
}

/** Strips trailing commas and extracts the first balanced top-level object, if any. */
function repairJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const candidate = text.slice(start, i + 1)
        return candidate.replace(/,(\s*[}\]])/g, '$1')
      }
    }
  }
  return null
}

function extractToolCalls(msg: Record<string, unknown> | undefined): ToolCallResult[] {
  const rawCalls = (msg?.tool_calls ?? []) as Array<{ id: string; function: { name: string; arguments: string } }>
  return rawCalls.map((tc) => {
    const { args, error } = parseToolArguments(tc.function.arguments)
    if (error) debugLog('openai', `tool-call arg parse failed: name=${tc.function.name} ${error}`)
    return {
      id: tc.id,
      name: tc.function.name,
      arguments: args,
      ...(error ? { argsError: error } : {}),
    }
  })
}

/** Recover only DeepSeek tool rounds; the caller still owns policy and execution. */
function normalizeDeepSeekToolCalls(
  result: ProviderNonStreamResult,
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  baseUrl?: string,
): ProviderNonStreamResult {
  if (!isDeepSeek(baseUrl) || toolChoice === 'none' || !tools.length || result.toolCalls.length || !result.content) return result
  const parsed = parseDsmlToolCalls(result.content)
  const allowedNames = new Set(tools.map((tool) => tool.function.name))
  if (!parsed || parsed.toolCalls.some((call) => !allowedNames.has(call.name))) return result
  debugLog('openai', `recovered ${parsed.toolCalls.length} DSML tool calls from DeepSeek content`)
  return {
    ...result,
    content: parsed.content,
    toolCalls: parsed.toolCalls.map((call) => ({ ...call, id: `call_dsml_${randomUUID()}` })),
  }
}

/** Extracts token usage from a non-streaming chat-completions response, if present. */
function extractUsage(parsed: Record<string, unknown>): { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | undefined {
  const usage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number } | undefined
  if (usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
    return { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, ...(typeof usage.prompt_cache_hit_tokens === 'number' ? { cachedInputTokens: usage.prompt_cache_hit_tokens } : {}) }
  }
  return undefined
}

function extractMessage(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  const choices = parsed.choices as Array<{ message?: Record<string, unknown> }> | undefined
  return choices?.[0]?.message
}

function extractFinishReason(parsed: Record<string, unknown>): string | undefined {
  const choices = parsed.choices as Array<{ finish_reason?: string }> | undefined
  return choices?.[0]?.finish_reason
}

/**
 * Builds the same "empty response" diagnosis the streaming path already produces, but for the
 * non-streaming forced-final-answer call, which previously had no detection at all and silently
 * returned `content: null`. The `finishReason` is attached to the error (not just embedded in the
 * message) so callers can programmatically distinguish a token-budget cutoff (`'length'`, worth
 * retrying with more tokens) from a genuine empty stop.
 */
function emptyResponseError(finishReason: string | undefined): Error & { finishReason?: string } {
  const message = finishReason === 'length'
    ? 'The model\'s response was cut off because it ran out of tokens. Try increasing the max output tokens or shortening the conversation.'
    : 'The model returned an empty response instead of an answer.'
  const err = new Error(message) as Error & { finishReason?: string }
  err.name = 'EmptyProviderResponseError'
  err.finishReason = finishReason
  return err
}

/** A partial response is not a completed answer or an executable tool batch. */
function validateCompletion(content: string | null, toolCalls: ToolCallResult[], finishReason?: string, requireFinishReason = false, reasoningContent?: string): void {
  if (finishReason === 'length' || finishReason === 'content_filter' || finishReason === 'insufficient_system_resource' || finishReason === 'aborted' || (requireFinishReason && !finishReason)) {
    const detail = finishReason === 'length'
      ? 'The model ran out of tokens before completing its response. Increase the max output tokens or reduce thinking effort.'
      : finishReason === 'content_filter'
        ? 'The provider filtered its response.'
        : finishReason === 'insufficient_system_resource'
          ? 'The provider interrupted its response because of insufficient inference resources.'
          : finishReason === 'aborted'
            ? 'The provider aborted its response.'
            : 'The provider stream ended without a completion finish reason.'
    throw Object.assign(new Error(`${detail} No tool calls from this response were executed.`), { finishReason, rejectedToolCallCount: toolCalls.length })
  }
  if (!content?.trim() && !toolCalls.length) throw Object.assign(emptyResponseError(finishReason), { reasoningContent })
}

function logCompletion(path: string, content: string | null, toolCalls: ToolCallResult[], finishReason?: string): void {
  debugLog('openai', `${path}: finishReason=${finishReason ?? 'missing'} contentChars=${content?.length ?? 0} tools=${toolCalls.length}`)
}

interface StreamOptions {
  onThinkingChunk?: (blockId: string, chunk: string) => void
  onThinkingEnd?: (blockId: string) => void
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
  onCitations?: (citations: Citation[]) => void
}

/**
 * Shared streaming response handler for every OpenAI-compatible endpoint:
 * HTTP-error rejection, non-SSE fallback (some providers ignore stream:true),
 * reasoning deltas, usage reporting, and empty-stop detection.
 */
function streamChatCompletions(
  conversationId: string,
  endpoint: ChatEndpoint,
  body: string,
  onChunk: (chunk: string) => void,
  options: StreamOptions = {},
): Promise<string> {
  return runStreamingRequest(conversationId, endpoint.url, endpoint.headers, body, (res, finish) => {
    let fullContent = ''
    let latestUsage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | undefined
    const contentType = res.headers['content-type'] ?? ''
    debugLog('openai', `stream: HTTP ${res.statusCode} url=${endpoint.url} contentType="${contentType.split(';')[0]}"`)

    if (res.statusCode && res.statusCode >= 400) {
      rejectHttpError(res, finish, (errBody) => {
        const err = providerHttpError(endpoint.label, res.statusCode, errBody)
        debugLog('openai', `stream error: HTTP ${res.statusCode} url=${endpoint.url} message="${err.message}"`)
        return err
      })
      return
    }

    if (!contentType.includes('text/event-stream')) {
      // Non-streaming response (some providers ignore stream:true).
      // Collect the full body and extract content normally.
      let rawBody = ''
      res.on('data', (chunk: Buffer) => { rawBody += chunk.toString() })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawBody)
          options.onCitations?.(extractCitations(parsed))
          const content = parsed.choices?.[0]?.message?.content
          if (content) { fullContent = content; onChunk(content) }
          const finishReason = extractFinishReason(parsed)
          logCompletion('stream-json', content, [], finishReason)
          validateCompletion(content, [], finishReason)
        } catch (error) { finish.reject(error as Error); return }
        finish.resolve(fullContent)
      })
      res.on('error', (err: Error) => finish.reject(err))
      return
    }

    let finishReason: string | undefined
    let reasoningBlockOpen = false
    parseSseStream(res, (data) => {
      try {
        const parsed = JSON.parse(data)
        options.onCitations?.(extractCitations(parsed))
        const usage = parsed.usage
        if (usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
          latestUsage = extractUsage(parsed)
        }
        const choice = parsed.choices?.[0]
        const delta = choice?.delta
        if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason
        const textContent = delta?.content ?? choice?.message?.content
        const reasoning = delta?.reasoning ?? delta?.reasoning_content
        if (reasoning && typeof reasoning === 'string') {
          reasoningBlockOpen = true
          options.onThinkingChunk?.('reasoning-0', reasoning)
        }
        if (textContent) {
          if (reasoningBlockOpen) {
            options.onThinkingEnd?.('reasoning-0')
            reasoningBlockOpen = false
          }
          fullContent += textContent
          onChunk(textContent)
        }
        if (!textContent && finishReason === 'stop') {
          if (reasoningBlockOpen) {
            options.onThinkingEnd?.('reasoning-0')
            reasoningBlockOpen = false
          }
        }
      } catch {
        // Skip malformed chunks
      }
    })
      .then(() => {
        if (reasoningBlockOpen) options.onThinkingEnd?.('reasoning-0')
        if (latestUsage) options.onUsage?.(latestUsage)
        logCompletion('stream', fullContent, [], finishReason)
        validateCompletion(fullContent, [], finishReason, isDeepSeek(endpoint.url))
        finish.resolve(fullContent)
      })
      .catch((err: Error) => finish.reject(err))
  })
}

interface OpenAIStreamToolDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface OpenAIStreamPayload {
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number }
  choices?: Array<{
    delta?: {
      content?: string
      reasoning?: string
      reasoning_content?: string
      tool_calls?: OpenAIStreamToolDelta[]
      function_call?: { name?: string; arguments?: string }
    }
    message?: { content?: string }
    finish_reason?: string | null
  }>
}

/**
 * Streams an OpenAI-compatible tool round. Function names and argument JSON
 * arrive in separate SSE deltas, so they are assembled here and exposed to the
 * tool loop only after the response has ended.
 */
function streamChatCompletionsWithTools(
  conversationId: string,
  endpoint: ChatEndpoint,
  body: string,
  onChunk: (chunk: string) => void,
  options: StreamOptions = {},
): Promise<ProviderNonStreamResult> {
  let streamedResult: ProviderNonStreamResult = { content: null, toolCalls: [] }
  return runStreamingRequest(conversationId, endpoint.url, endpoint.headers, body, (res, finish) => {
    const contentType = res.headers['content-type'] ?? ''
    if (res.statusCode && res.statusCode >= 400) {
      rejectHttpError(res, finish, (errBody) => providerHttpError(endpoint.label, res.statusCode, errBody))
      return
    }

    if (!contentType.includes('text/event-stream')) {
      let rawBody = ''
      res.on('data', (chunk: Buffer) => { rawBody += chunk.toString() })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawBody) as Record<string, unknown>
          options.onCitations?.(extractCitations(parsed))
          const msg = extractMessage(parsed)
          const content = typeof msg?.content === 'string' ? msg.content : null
          if (content) onChunk(content)
          const usage = extractUsage(parsed)
          if (usage) options.onUsage?.(usage)
          streamedResult = {
            content,
            ...(typeof msg?.reasoning_content === 'string' ? { reasoningContent: msg.reasoning_content } : {}),
            toolCalls: extractToolCalls(msg),
            ...(extractFinishReason(parsed) ? { finishReason: extractFinishReason(parsed) } : {}),
            ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
            ...(usage ? { usage } : {}),
          }
          logCompletion('tool-stream-json', content, streamedResult.toolCalls, streamedResult.finishReason)
          validateCompletion(content, streamedResult.toolCalls, streamedResult.finishReason, false, streamedResult.reasoningContent)
        } catch (error) { finish.reject(error as Error); return }
        finish.resolve(streamedResult.content ?? '')
      })
      res.on('error', (err: Error) => finish.reject(err))
      return
    }

    let fullContent = ''
    let model: string | undefined
    let usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | undefined
    let reasoningContent = ''
    let finishReason: string | undefined
    let reasoningBlockOpen = false
    const calls = new Map<number, { id: string; name: string; arguments: string }>()

    parseSseStream(res, (data) => {
      try {
        const parsed = JSON.parse(data) as OpenAIStreamPayload
        options.onCitations?.(extractCitations(parsed))
        if (typeof parsed.model === 'string') model = parsed.model
        const parsedUsage = parsed.usage
        if (parsedUsage && typeof parsedUsage.prompt_tokens === 'number' && typeof parsedUsage.completion_tokens === 'number') {
          usage = extractUsage(parsed as Record<string, unknown>)
        }
        const choice = parsed.choices?.[0]
        if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason
        const delta = choice?.delta ?? {}
        const textContent = delta.content ?? choice?.message?.content
        const reasoning = delta.reasoning ?? delta.reasoning_content
        if (typeof reasoning === 'string' && reasoning) {
          reasoningContent += reasoning
          reasoningBlockOpen = true
          options.onThinkingChunk?.('reasoning-0', reasoning)
        }
        if (typeof textContent === 'string' && textContent) {
          if (reasoningBlockOpen) {
            options.onThinkingEnd?.('reasoning-0')
            reasoningBlockOpen = false
          }
          fullContent += textContent
          onChunk(textContent)
        }

        const streamedCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
        streamedCalls.forEach((toolCall, position) => {
          const index = typeof toolCall.index === 'number' ? toolCall.index : position
          const existing = calls.get(index) ?? {
            id: typeof toolCall.id === 'string' ? toolCall.id : `tool-call-${index}`,
            name: '',
            arguments: '',
          }
          if (typeof toolCall.id === 'string' && toolCall.id) existing.id = toolCall.id
          if (typeof toolCall.function?.name === 'string') existing.name += toolCall.function.name
          if (typeof toolCall.function?.arguments === 'string') existing.arguments += toolCall.function.arguments
          calls.set(index, existing)
        })

        // Older OpenAI-compatible endpoints sometimes use the legacy single
        // function_call delta instead of tool_calls[].
        if (delta.function_call) {
          const existing = calls.get(0) ?? { id: 'tool-call-0', name: '', arguments: '' }
          if (typeof delta.function_call.name === 'string') existing.name += delta.function_call.name
          if (typeof delta.function_call.arguments === 'string') existing.arguments += delta.function_call.arguments
          calls.set(0, existing)
        }
      } catch {
        // Skip malformed chunks; the provider stream parser continues.
      }
    })
      .then(() => {
        if (reasoningBlockOpen) options.onThinkingEnd?.('reasoning-0')
        const rawCalls = [...calls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, call]) => ({ id: call.id, function: { name: call.name, arguments: call.arguments } }))
        const toolCalls = extractToolCalls({ tool_calls: rawCalls })
        if (usage) options.onUsage?.(usage)
        logCompletion('tool-stream', fullContent, toolCalls, finishReason)
        validateCompletion(fullContent, toolCalls, finishReason, isDeepSeek(endpoint.url), reasoningContent)
        streamedResult = {
          content: fullContent || null,
          ...(reasoningContent ? { reasoningContent } : {}),
          toolCalls,
          ...(finishReason ? { finishReason } : {}),
          ...(model ? { model } : {}),
          ...(usage ? { usage } : {}),
        }
        finish.resolve(fullContent)
      })
      .catch((err: Error) => finish.reject(err))
  }).then(() => streamedResult)
}

export async function sendOpenAIMessage(
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
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
    onCitations?: (citations: Citation[]) => void
  } = {},
  baseUrl?: string
): Promise<string> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const bodyObj: Record<string, unknown> = {
    model,
    messages: prepareMessages(messages, baseUrl),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
  }
  applyProviderOptions(bodyObj, model, options.thinkingEffort, baseUrl)
  const body = JSON.stringify(bodyObj)
  debugLog('openai', `stream: model=${model} baseUrl=${baseUrl ?? 'openai-default'} reasoningEffort=${bodyObj.reasoning_effort ?? 'none'} msgs=${messages.length} keyLen=${apiKey.length}`)

  if (!isDeepSeek(baseUrl)) return streamChatCompletions(conversationId, openAiEndpoint(apiKey, baseUrl), body, onChunk, options)
  const markupBuffer = createToolMarkupBuffer(onChunk)
  try {
    const content = await streamChatCompletions(conversationId, openAiEndpoint(apiKey, baseUrl), body, markupBuffer.write, options)
    if (!markupBuffer.flush() || hasUnexecutedToolMarkup(content)) {
      throw new Error('DeepSeek returned tool calls as text instead of structured tool calls. No calls in that text were executed; please retry or use another model.')
    }
    return content
  } catch (error) {
    markupBuffer.flush()
    throw error
  }
}

export async function sendOpenAINonStreaming(
  apiKey: ProviderCredentialInput,
  model: string,
  messages: ProviderMessage[],
  options: { maxTokens?: number; temperature?: number; conversationId?: string } = {},
  baseUrl?: string,
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const body = JSON.stringify({
    model,
    messages: prepareMessages(messages, baseUrl),
    stream: false,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.3
  })

  const parsed = await chatCompletionsRequest(openAiEndpoint(apiKey, baseUrl), body, options.conversationId)
  const msg = extractMessage(parsed)
  const citations = extractCitations(parsed)
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls: [],
    ...(extractFinishReason(parsed) ? { finishReason: extractFinishReason(parsed) } : {}),
    ...(citations.length > 0 ? { citations } : {}),
  }
}

export async function sendOpenAIWithTools(
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
    onCitations?: (citations: Citation[]) => void
  } = {},
  baseUrl?: string
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const bodyObj: Record<string, unknown> = {
    model,
    messages: prepareMessages(messages, baseUrl),
    stream: false,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7
  }
  if (tools.length > 0) {
    bodyObj.tools = tools
    bodyObj.tool_choice = toolChoice
  }
  applyProviderOptions(bodyObj, model, options.thinkingEffort, baseUrl)
  const body = JSON.stringify(bodyObj)
  debugLog('openai', `withTools: model=${model} baseUrl=${baseUrl ?? 'openai-default'} tools=${tools.length} toolChoice=${toolChoice} keyLen=${apiKey.length}`)

  const parsed = await chatCompletionsRequest(openAiEndpoint(apiKey, baseUrl), body, options.conversationId)
  const msg = extractMessage(parsed)
  const citations = extractCitations(parsed)
  options.onCitations?.(citations)
  const usage = extractUsage(parsed)
  if (usage) options.onUsage?.(usage)
  // Some OpenAI-compatible endpoints (OpenRouter, etc.) surface non-streamed reasoning as
  // `message.reasoning` / `message.reasoning_content`. Forward it so reasoning models still show
  // thinking during agentic tool loops (parity with the streaming path).
  const reasoning = (msg?.reasoning ?? msg?.reasoning_content)
  if (typeof reasoning === 'string' && reasoning.trim() && options.onThinkingChunk) {
    options.onThinkingChunk('reasoning-0', reasoning)
    options.onThinkingEnd?.('reasoning-0')
  }
  const content = typeof msg?.content === 'string' ? msg.content : null
  const toolCalls = extractToolCalls(msg)
  const finishReason = extractFinishReason(parsed)
  logCompletion('withTools', content, toolCalls, finishReason)
  validateCompletion(content, toolCalls, finishReason, false, typeof reasoning === 'string' ? reasoning : undefined)
  return normalizeDeepSeekToolCalls({
    content,
    toolCalls,
    ...(finishReason ? { finishReason } : {}),
    ...(typeof reasoning === 'string' ? { reasoningContent: reasoning } : {}),
    ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
    ...(usage ? { usage } : {}),
    ...(citations.length > 0 ? { citations } : {}),
  }, tools, toolChoice, baseUrl)
}

/** Compatibility entry point. Chat owns the single, turn-wide output-budget recovery. */
export async function sendOpenAIWithToolsResilient(
  apiKey: ProviderCredentialInput,
  model: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: Parameters<typeof sendOpenAIWithTools>[5] = {},
  baseUrl?: string,
): Promise<ProviderNonStreamResult> {
  return sendOpenAIWithTools(apiKey, model, messages, tools, toolChoice, options, baseUrl)
}

export async function sendOpenAIWithToolsStream(
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
  baseUrl?: string,
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const bodyObj: Record<string, unknown> = {
    model,
    messages: prepareMessages(messages, baseUrl),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
  }
  if (tools.length > 0) {
    bodyObj.tools = tools
    bodyObj.tool_choice = toolChoice
  }
  applyProviderOptions(bodyObj, model, options.thinkingEffort, baseUrl)
  let emittedLength = 0
  const markupBuffer = isDeepSeek(baseUrl) ? createToolMarkupBuffer((chunk) => {
    emittedLength += chunk.length
    onChunk(chunk)
  }) : undefined
  let result: ProviderNonStreamResult
  try {
    result = await streamChatCompletionsWithTools(
      options.conversationId ?? '',
      openAiEndpoint(apiKey, baseUrl),
      JSON.stringify(bodyObj),
      markupBuffer?.write ?? onChunk,
      options,
    )
  } catch (error) {
    markupBuffer?.flush()
    throw error
  }
  const normalized = normalizeDeepSeekToolCalls(result, tools, toolChoice, baseUrl)
  if (normalized !== result) {
    const remaining = (normalized.content ?? '').slice(emittedLength)
    if (remaining) onChunk(remaining)
  } else {
    markupBuffer?.flush()
  }
  return normalized
}

export async function sendAzureMessage(
  conversationId: string,
  apiKey: ProviderCredentialInput,
  endpoint: string,
  deployment: string,
  messages: ProviderMessage[],
  onChunk: (chunk: string) => void,
  options: { maxTokens?: number; temperature?: number; onCitations?: (citations: Citation[]) => void } = {}
): Promise<string> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const body = JSON.stringify({
    messages,
    stream: true,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7
  })
  return streamChatCompletions(conversationId, azureEndpoint(apiKey, endpoint, deployment), body, onChunk, options)
}

export async function sendAzureNonStreaming(
  apiKey: ProviderCredentialInput,
  endpoint: string,
  deployment: string,
  messages: ProviderMessage[],
  options: { maxTokens?: number; temperature?: number; conversationId?: string } = {}
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const body = JSON.stringify({
    messages: toOpenAICompatibleMessages(messages),
    stream: false,
    max_tokens: options.maxTokens ?? 2000,
    temperature: options.temperature ?? 0.3
  })

  const parsed = await chatCompletionsRequest(azureEndpoint(apiKey, endpoint, deployment), body, options.conversationId)
  const msg = extractMessage(parsed)
  const citations = extractCitations(parsed)
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls: [],
    ...(extractFinishReason(parsed) ? { finishReason: extractFinishReason(parsed) } : {}),
    ...(citations.length > 0 ? { citations } : {}),
  }
}

export async function sendAzureWithTools(
  apiKey: ProviderCredentialInput,
  endpoint: string,
  deployment: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  options: {
    maxTokens?: number
    temperature?: number
    conversationId?: string
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
    onCitations?: (citations: Citation[]) => void
  } = {}
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const bodyObj: Record<string, unknown> = {
    messages: toOpenAICompatibleMessages(messages),
    stream: false,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7
  }
  if (tools.length > 0) {
    bodyObj.tools = tools
    bodyObj.tool_choice = toolChoice
  }
  const body = JSON.stringify(bodyObj)

  const parsed = await chatCompletionsRequest(azureEndpoint(apiKey, endpoint, deployment), body, options.conversationId)
  const msg = extractMessage(parsed)
  const citations = extractCitations(parsed)
  options.onCitations?.(citations)
  const usage = extractUsage(parsed)
  if (usage) options.onUsage?.(usage)
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls: extractToolCalls(msg),
    ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
    ...(usage ? { usage } : {}),
    ...(citations.length > 0 ? { citations } : {}),
  }
}

export function sendAzureWithToolsStream(
  apiKey: ProviderCredentialInput,
  endpoint: string,
  deployment: string,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  toolChoice: ToolChoice,
  onChunk: (chunk: string) => void,
  options: {
    maxTokens?: number
    temperature?: number
    conversationId?: string
    onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
    onCitations?: (citations: Citation[]) => void
  } = {},
): Promise<ProviderNonStreamResult> {
  apiKey = resolveProviderCredentialInput(apiKey)
  const bodyObj: Record<string, unknown> = {
    messages: toOpenAICompatibleMessages(messages),
    stream: true,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
  }
  if (tools.length > 0) {
    bodyObj.tools = tools
    bodyObj.tool_choice = toolChoice
  }
  return streamChatCompletionsWithTools(
    options.conversationId ?? '',
    azureEndpoint(apiKey, endpoint, deployment),
    JSON.stringify(bodyObj),
    onChunk,
    options,
  )
}

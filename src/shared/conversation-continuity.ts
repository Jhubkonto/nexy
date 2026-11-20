export type ContinuationContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
export type ContinuationContent = string | ContinuationContentPart[]
export interface ContinuationToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
export type ContinuationMessage =
  | { role: 'system' | 'user'; content: ContinuationContent }
  | { role: 'assistant'; content: ContinuationContent | null; tool_calls?: ContinuationToolCall[]; reasoning_content?: string }
  | { role: 'tool'; tool_call_id: string; content: string; images?: { dataUrl: string }[] }

/** Model-facing content, independent of editable display text. Images are immutable data URLs
 * stored in the application database, so exports/forks need no original filesystem paths. */
export interface ConversationContinuation {
  version: 1
  backend: string
  status: 'running' | 'complete' | 'interrupted'
  submitted?: ContinuationContent
  exchange: ContinuationMessage[]
  imageDescriptions?: Record<string, string>
}

function validContent(value: unknown): value is ContinuationContent {
  return typeof value === 'string' || Array.isArray(value) && value.every((part) =>
    part?.type === 'text' && typeof part.text === 'string'
    || part?.type === 'image_url' && typeof part.image_url?.url === 'string')
}

/** Validate complete batches. Never replay an orphan result or inject stored system instructions. */
export function validContinuationExchange(value: unknown): value is ContinuationMessage[] {
  if (!Array.isArray(value)) return false
  const pending = new Set<string>()
  const seen = new Set<string>()
  for (const message of value) {
    if (!message || !['assistant', 'tool', 'user'].includes(message.role)) return false
    if (message.role === 'tool') {
      if (typeof message.content !== 'string' || !pending.delete(message.tool_call_id)) return false
      if (message.images !== undefined && (!Array.isArray(message.images)
        || !message.images.every((image: { dataUrl?: unknown }) => typeof image?.dataUrl === 'string'))) return false
    } else {
      if (pending.size || !(validContent(message.content) || message.role === 'assistant' && message.content === null)) return false
      if (message.reasoning_content !== undefined && typeof message.reasoning_content !== 'string') return false
      if (message.tool_calls !== undefined) {
        if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) return false
        for (const call of message.tool_calls) {
          if (!call || typeof call.id !== 'string' || !call.id || seen.has(call.id) || call.type !== 'function'
            || typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string') return false
          seen.add(call.id)
          pending.add(call.id)
        }
      }
    }
  }
  return pending.size === 0
}

export function parseContinuation(json: string | null | undefined): ConversationContinuation | null {
  if (!json) return null
  try {
    const value = JSON.parse(json)
    if (value?.version !== 1 || typeof value.backend !== 'string'
      || !['running', 'complete', 'interrupted'].includes(value.status)
      || value.submitted !== undefined && !validContent(value.submitted)
      || !validContinuationExchange(value.exchange)
      || value.imageDescriptions !== undefined && (!value.imageDescriptions || typeof value.imageDescriptions !== 'object'
        || Array.isArray(value.imageDescriptions) || !Object.values(value.imageDescriptions).every((text) => typeof text === 'string'))) return null
    return value
  } catch { return null }
}

/** Checkpoints may end mid-batch. Explicitly mark unmatched calls as interrupted, never successful. */
export function closeInterruptedExchange(messages: ContinuationMessage[]): ContinuationMessage[] {
  const result: ContinuationMessage[] = []
  const pending = new Set<string>()
  const close = () => {
    for (const id of pending) result.push({ role: 'tool', tool_call_id: id,
      content: '[Interrupted: no completed result was recorded for this call. Do not assume it succeeded or repeat it without checking current state.]' })
    pending.clear()
  }
  for (const message of messages) {
    if (message.role !== 'tool') close()
    if (message.role === 'tool') {
      if (!pending.delete(message.tool_call_id)) continue
    }
    result.push(message)
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) pending.add(call.id)
  }
  close()
  return result
}

export function continuationText(messages: ContinuationMessage[]): string {
  return messages.map((message) => {
    const content = typeof message.content === 'string' ? message.content
      : (message.content ?? []).map((part) => part.type === 'text' ? part.text : '[Image supplied with this message]').join('\n')
    if (message.role === 'tool') return `Tool result (${message.tool_call_id}): ${content}`
    const calls = message.role === 'assistant' ? (message.tool_calls ?? []).map((call) =>
      `Historical tool call (${call.id}): ${call.function.name}(${call.function.arguments})`).join('\n') : ''
    return `${message.role}: ${content}${calls ? `\n${calls}` : ''}`
  }).join('\n\n')
}

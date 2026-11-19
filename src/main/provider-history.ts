import type { ProviderMessage } from './provider-core-types'

/** Stored separately from display text so exact reasoning and tool pairing survive reloads. */
export function serializeProviderHistory(messages: ProviderMessage[]): string | null {
  if (!messages.length) return null
  const encoded = JSON.stringify({ provider: 'deepseek', messages })
  return parseProviderHistory(encoded) ? encoded : null
}

export function parseProviderHistory(json: string | null | undefined): ProviderMessage[] | null {
  if (!json) return null
  try {
    const value = JSON.parse(json)
    if (value?.provider !== 'deepseek' || !Array.isArray(value.messages) || !value.messages.length) return null
    const pending = new Set<string>()
    for (const message of value.messages) {
      if (!message || !['assistant', 'tool', 'user'].includes(message.role)) return null
      if (message.content !== null && typeof message.content !== 'string' && !Array.isArray(message.content)) return null
      if (message.role === 'tool') {
        if (!pending.delete(message.tool_call_id) || typeof message.content !== 'string') return null
      } else {
        if (pending.size) return null
        if (message.role === 'assistant') {
          if (message.reasoning_content !== undefined && typeof message.reasoning_content !== 'string') return null
          if (message.tool_calls !== undefined) {
            if (!Array.isArray(message.tool_calls)) return null
            for (const call of message.tool_calls) {
              if (!call || typeof call.id !== 'string' || pending.has(call.id) || call.type !== 'function' || typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string') return null
              pending.add(call.id)
            }
          }
        }
      }
    }
    return pending.size ? null : value.messages as ProviderMessage[]
  } catch {
    return null
  }
}

export function restoreProviderHistory(messages: { role: string; content: string; providerHistory?: string | null }[]): ProviderMessage[] {
  return messages.flatMap((message) => {
    if (message.role === 'assistant') {
      const history = parseProviderHistory(message.providerHistory)
      if (history) return history
    }
    return [{ role: message.role, content: message.content } as ProviderMessage]
  })
}

import type { ProviderMessage } from './provider-core-types'
import { validContinuationExchange } from '../shared/conversation-continuity'

/** Stored separately from display text so exact reasoning and tool pairing survive reloads. */
export function serializeProviderHistory(messages: ProviderMessage[], provider = 'deepseek'): string | null {
  if (!messages.length) return null
  const encoded = JSON.stringify({ version: 1, provider, messages })
  return parseProviderHistory(encoded) ? encoded : null
}

export function parseProviderHistory(json: string | null | undefined): ProviderMessage[] | null {
  if (!json) return null
  try {
    const value = JSON.parse(json)
    if (value?.version !== undefined && value.version !== 1) return null
    if ((value?.provider !== 'deepseek' && !(value?.version === 1 && typeof value.provider === 'string'))
      || !validContinuationExchange(value.messages) || !value.messages.length) return null
    return value.messages as ProviderMessage[]
  } catch {
    return null
  }
}

export function restoreProviderHistory(messages: { role: string; content: string; providerHistory?: string | null; replay?: ProviderMessage[] }[], provider?: string): ProviderMessage[] {
  return messages.flatMap((message) => {
    if (message.replay) return compatibleProviderHistory(message.replay, provider)
    if (message.role === 'assistant') {
      const history = parseProviderHistory(message.providerHistory)
      if (history) return compatibleProviderHistory(history, provider)
    }
    return [{ role: message.role, content: message.content } as ProviderMessage]
  })
}

export function compatibleProviderHistory(messages: ProviderMessage[], provider?: string): ProviderMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant' || provider === undefined || provider === 'deepseek') return message
    const rest = { ...message }
    delete rest.reasoning_content
    return rest
  })
}

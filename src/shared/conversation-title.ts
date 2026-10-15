export const MAX_CONVERSATION_TITLE_LENGTH = 120
export const DEFAULT_CONVERSATION_TITLE = 'New Chat'

/** Returns the persisted form of a user-entered title, or null when invalid. */
export function normalizeConversationTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = value.trim()
  if (!title) return null
  return title.slice(0, MAX_CONVERSATION_TITLE_LENGTH)
}

export function isPlaceholderConversationTitle(value: string | null | undefined): boolean {
  return !value?.trim() || value.trim() === DEFAULT_CONVERSATION_TITLE
}

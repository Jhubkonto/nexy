import { createHash } from 'crypto'
import type Database from 'better-sqlite3'
import { closeInterruptedExchange, continuationText, parseContinuation, type ConversationContinuation } from '../shared/conversation-continuity'
import { isLegacyPortableOperationalSummary } from '../shared/conversation-portability'
import type { MessageContent, ProviderMessage } from './provider-core-types'
import { parseProviderHistory, compatibleProviderHistory } from './provider-history'
import type { CompressibleMessage } from './context-compression'

export type HistoryRow = {
  id: string; role: string; content: string; timestamp: number; is_edited?: number
  provider_history?: string | null; continuation_json?: string | null
}

export function writeContinuation(db: Database.Database, messageId: string | null, record: ConversationContinuation): void {
  if (!messageId) return
  db.prepare('UPDATE messages SET continuation_json = ? WHERE id = ?').run(JSON.stringify(record), messageId)
}

/** The unfinished exchange lives on the user row until the response is committed. A crash
 * therefore preserves completed actions without requiring an assistant display bubble. */
export function createTurnCapture(db: Database.Database, userId: string | null, submitted: MessageContent, backend: string) {
  let record: ConversationContinuation = { version: 1, backend, status: 'running', submitted, exchange: [] }
  const previous = userId ? db.prepare('SELECT continuation_json FROM messages WHERE id = ?').get(userId) as { continuation_json?: string } | undefined : undefined
  const previousDescriptions = parseContinuation(previous?.continuation_json)?.imageDescriptions
  if (previousDescriptions) record.imageDescriptions = previousDescriptions
  let finished = false
  const descriptions = new Map<string, string>()
  if (userId) {
    const rows = db.prepare('SELECT continuation_json FROM messages WHERE conversation_id = (SELECT conversation_id FROM messages WHERE id = ?)')
      .all(userId) as { continuation_json: string | null }[]
    for (const row of rows) for (const [key, value] of Object.entries(parseContinuation(row.continuation_json)?.imageDescriptions ?? {})) descriptions.set(key, value)
  }
  const imageKey = (url: string) => createHash('sha256').update(url).digest('hex')
  writeContinuation(db, userId, record)
  return {
    imageDescriptionCache: {
      get: (url: string) => descriptions.get(imageKey(url)),
      set(url: string, text: string) {
        const key = imageKey(url)
        descriptions.set(key, text)
        record = { ...record, imageDescriptions: { ...record.imageDescriptions, [key]: text } }
        writeContinuation(db, userId, record)
      },
    },
    checkpoint(messages: ProviderMessage[]) {
      record = { ...record, exchange: closeInterruptedExchange(messages) }
      writeContinuation(db, userId, record)
    },
    finish(assistantId: string, content: string, interrupted = false) {
      const exchange = record.exchange.length ? record.exchange : [{ role: 'assistant' as const, content }]
      // Atomic handoff prevents duplicate replay if the application exits while persisting.
      db.transaction(() => {
        writeContinuation(db, assistantId, { version: 1, backend, status: interrupted ? 'interrupted' : 'complete', exchange })
        writeContinuation(db, userId, { ...record, exchange: [], status: 'complete' })
      })()
      finished = true
    },
    interrupt() { if (!finished) { record = { ...record, status: 'interrupted' }; writeContinuation(db, userId, record) } },
  }
}

export function currentUserRow(db: Database.Database, conversationId: string, userId?: string | null): HistoryRow | undefined {
  return db.prepare(userId ? 'SELECT * FROM messages WHERE id = ? AND conversation_id = ?'
    : "SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY timeline_order DESC, timestamp DESC, id DESC LIMIT 1")
    .get(...(userId ? [userId, conversationId] : [conversationId])) as HistoryRow | undefined
}

/** Select by the current user's ID, never by the number of display/tool rows. */
export function loadConversationHistory(db: Database.Database, conversationId: string, currentUserId: string, provider?: string): CompressibleMessage[] {
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timeline_order ASC, timestamp ASC, id ASC')
    .all(conversationId) as HistoryRow[]
  const currentIndex = rows.findIndex((row) => row.id === currentUserId)
  return historyFromRows(currentIndex < 0 ? rows : rows.slice(0, currentIndex), provider)
}

export function historyFromRows(rows: HistoryRow[], provider?: string): CompressibleMessage[] {
  const history: CompressibleMessage[] = []
  // Legacy traces have no reliable narration ordering. Preserve their actual results as text,
  // but only where no durable exchange covers the same user turn.
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (row.role === 'team-activity' || isLegacyPortableOperationalSummary(row.role, row.content)) continue
    const record = parseContinuation(row.continuation_json)
    let replay: ProviderMessage[]
    if (row.role === 'tool-call') {
      let end = index + 1
      while (end < rows.length && rows[end].role !== 'user') end++
      let start = index - 1
      while (start >= 0 && rows[start].role !== 'user') start--
      const covered = rows.slice(Math.max(0, start), end).some((candidate) => {
        const saved = parseContinuation(candidate.continuation_json)
        return saved?.exchange.length || !candidate.is_edited && parseProviderHistory(candidate.provider_history)?.length
      })
      if (covered) continue
      try {
        const tool = JSON.parse(row.content)
        replay = [{ role: 'assistant', content: `[Historical tool activity]\n${tool.toolName ?? tool.name ?? 'tool'}(${JSON.stringify(tool.toolArgs ?? tool.args ?? tool.input ?? {})})\nResult (${tool.toolSuccess === false || tool.isError ? 'error' : 'recorded'}): ${tool.toolResult ?? tool.result ?? tool.content ?? row.content}` }]
      } catch { replay = [{ role: 'assistant', content: `[Historical tool activity]\n${row.content}` }] }
    } else if (row.role === 'user') {
      replay = [{ role: 'user', content: record?.submitted ?? row.content }, ...(record?.exchange ?? [])]
    } else if (row.role === 'assistant') {
      replay = record?.exchange.length ? record.exchange
        : !row.is_edited && parseProviderHistory(row.provider_history) || [{ role: 'assistant', content: row.content }]
    } else if (row.role === 'system') {
      // Imported summaries are reference content, not live runtime instructions.
      replay = [{ role: 'user', content: `[Historical context]\n${row.content}` }]
    } else continue
    // Never forward reasoning captured by a different provider.
    const reasoningProvider = record?.backend ?? (parseProviderHistory(row.provider_history) ? JSON.parse(row.provider_history!).provider : '')
    replay = compatibleProviderHistory(replay, provider === undefined ? undefined : reasoningProvider === provider ? provider : 'other')
    history.push({ id: row.id, role: row.role === 'tool-call' ? 'assistant' : row.role,
      content: continuationText(replay), replay, timestamp: row.timestamp })
  }
  return history
}

export function historyRevision(messages: CompressibleMessage[]): string {
  return createHash('sha256').update(JSON.stringify(messages.map((m) => [m.id, m.replay ?? m.providerHistory ?? m.content]))).digest('hex')
}

export function collectHistoryImages(messages: ProviderMessage[]): { id: string; name: string; dataUrl: string }[] {
  const urls = new Set<string>()
  for (const message of messages) {
    if (Array.isArray(message.content)) for (const part of message.content) if (part.type === 'image_url') urls.add(part.image_url.url)
    if (message.role === 'tool') for (const image of message.images ?? []) urls.add(image.dataUrl)
  }
  return [...urls].map((dataUrl, index) => ({ id: `history-${index + 1}`, name: `History image ${index + 1}`, dataUrl }))
}

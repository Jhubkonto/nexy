import type Database from 'better-sqlite3'
import type {
  ConversationPage,
  ConversationPageRequest,
  ConversationRow,
} from '../shared/types'

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100

type CursorPosition = { pinned: number; updatedAt: number; id: string }

function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | null | undefined): CursorPosition | null {
  if (!cursor) return null
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorPosition>
    if (
      (value.pinned !== 0 && value.pinned !== 1) ||
      typeof value.updatedAt !== 'number' ||
      !Number.isFinite(value.updatedAt) ||
      typeof value.id !== 'string' ||
      !value.id
    ) return null
    return { pinned: value.pinned, updatedAt: value.updatedAt, id: value.id }
  } catch {
    return null
  }
}

/** One authoritative active-history query used by Electron IPC and Android WebSocket clients. */
export function listConversationPage(
  db: Database.Database,
  request: ConversationPageRequest = {},
  projection = 'c.*, cr.rating AS rating',
): ConversationPage {
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(request.limit ?? DEFAULT_PAGE_SIZE)))
  const filters = ["c.archived = 0", "c.kind != 'project-conversation-mode'"]
  const filterParams: Array<string | number> = []
  const scope = request.scope ?? { type: 'all' as const }
  const completion = request.completion ?? 'all'

  if (completion === 'ongoing') filters.push('c.completed_at IS NULL')
  else if (completion === 'completed') filters.push('c.completed_at IS NOT NULL')
  else if (completion !== 'all') throw new Error('Invalid conversation completion filter')

  if (scope.type === 'project') {
    if (scope.id == null) filters.push('c.project_id IS NULL')
    else { filters.push('c.project_id = ?'); filterParams.push(scope.id) }
  } else if (scope.type === 'pinned') {
    filters.push('COALESCE(c.pinned, 0) = 1')
  } else if (scope.type === 'agent') {
    if (!scope.id) filters.push('1 = 0')
    else { filters.push('c.agent_id = ?'); filterParams.push(scope.id) }
  }

  const query = request.query?.trim()
  if (query) {
    filters.push(`(c.title LIKE ? ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ? ESCAPE '\\'
    ) OR EXISTS (
      SELECT 1 FROM projects sp WHERE sp.id = c.project_id AND sp.name LIKE ? ESCAPE '\\'
    ) OR EXISTS (
      SELECT 1 FROM agents sa
      WHERE sa.id = c.agent_id AND json_extract(sa.config_json, '$.name') LIKE ? ESCAPE '\\'
    ))`)
    const escaped = query.replace(/[\\%_]/g, '\\$&')
    filterParams.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`)
  }

  const where = filters.join(' AND ')
  const totalCount = (db.prepare(`SELECT COUNT(*) AS count FROM conversations c WHERE ${where}`)
    .get(...filterParams) as { count: number }).count

  const pageFilters = [...filters]
  const pageParams = [...filterParams]
  const cursor = decodeCursor(request.cursor)
  if (request.cursor && !cursor) throw new Error('Invalid conversation page cursor')
  if (cursor) {
    pageFilters.push(`(
      COALESCE(c.pinned, 0) < ? OR
      (COALESCE(c.pinned, 0) = ? AND c.updated_at < ?) OR
      (COALESCE(c.pinned, 0) = ? AND c.updated_at = ? AND c.id < ?)
    )`)
    pageParams.push(cursor.pinned, cursor.pinned, cursor.updatedAt, cursor.pinned, cursor.updatedAt, cursor.id)
  }

  const rows = db.prepare(`
    SELECT ${projection}
    FROM conversations c
    LEFT JOIN agents a ON c.agent_id = a.id
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN conversation_ratings cr ON cr.conversation_id = c.id
    WHERE ${pageFilters.join(' AND ')}
    ORDER BY COALESCE(c.pinned, 0) DESC, c.updated_at DESC, c.id DESC
    LIMIT ?
  `).all(...pageParams, limit + 1) as ConversationRow[]

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items.at(-1)
  return {
    requestId: request.requestId ?? '',
    items,
    totalCount,
    hasMore,
    nextCursor: hasMore && last
      ? encodeCursor({ pinned: last.pinned ? 1 : 0, updatedAt: last.updated_at, id: last.id })
      : null,
  }
}

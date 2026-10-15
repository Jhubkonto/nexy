import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  approvePendingApprovalsForConversation: vi.fn(),
}))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('Database not initialized')
    return state.db
  },
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    state.handlers.set(channel, handler)
  },
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))
vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn() }))
vi.mock('../project-handlers', () => ({
  parseProjectConfig: vi.fn(() => ({ workflowMode: 'single-agent' })),
}))
vi.mock('../tools', () => ({
  approvePendingApprovalsForConversation: state.approvePendingApprovalsForConversation,
}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { registerConversationHandlers, registerMessageHandlers } from '../conversation-handlers'
import { submitRatingForConversation } from '../rating-handlers'
import { broadcastToMobile } from '../ws-server'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return (await handler({}, ...args)) as T
}

describe('conversation:list — rating column', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.approvePendingApprovalsForConversation.mockClear()
    vi.mocked(broadcastToMobile).mockClear()
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    registerConversationHandlers()
    registerMessageHandlers()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('left-joins the rating in, defaulting to null when unrated', async () => {
    const db = state.db!
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-1', 'Rated')").run()
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-2', 'Unrated')").run()
    submitRatingForConversation('conv-1', 4)

    const list = await invoke<{ id: string; rating: number | null }[]>('conversation:list')
    const byId = Object.fromEntries(list.map((c) => [c.id, c.rating]))

    expect(byId['conv-1']).toBe(4)
    expect(byId['conv-2']).toBeNull()
  })

  it('paginates with stable pinned/time/id cursors and matching scoped totals', async () => {
    const db = state.db!
    const insert = db.prepare(
      'INSERT INTO conversations (id, project_id, title, pinned, archived, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    insert.run('z-pinned', 'project-a', 'Pinned', 1, 0, 'chat', 100, 100)
    insert.run('b-new', 'project-a', 'New B', 0, 0, 'chat', 300, 300)
    insert.run('a-new', 'project-a', 'New A', 0, 0, 'chat', 300, 300)
    insert.run('archived', 'project-a', 'Archived', 0, 1, 'chat', 400, 400)
    insert.run('internal', 'project-a', 'Internal', 0, 0, 'project-conversation-mode', 500, 500)
    insert.run('other', 'project-b', 'Other', 0, 0, 'chat', 600, 600)

    const first = await invoke<{
      items: Array<{ id: string }>; totalCount: number; nextCursor: string | null; hasMore: boolean
    }>('conversation:list-page', { scope: { type: 'project', id: 'project-a' }, limit: 2 })
    expect(first.items.map((item) => item.id)).toEqual(['z-pinned', 'b-new'])
    expect(first.totalCount).toBe(3)
    expect(first.hasMore).toBe(true)

    const second = await invoke<{
      items: Array<{ id: string }>; totalCount: number; nextCursor: string | null; hasMore: boolean
    }>('conversation:list-page', {
      scope: { type: 'project', id: 'project-a' }, limit: 2, cursor: first.nextCursor,
    })
    expect(second.items.map((item) => item.id)).toEqual(['a-new'])
    expect(second.totalCount).toBe(3)
    expect(second.hasMore).toBe(false)

    const pinned = await invoke<{
      items: Array<{ id: string }>; totalCount: number; hasMore: boolean
    }>('conversation:list-page', { scope: { type: 'pinned' }, limit: 2 })
    expect(pinned.items.map((item) => item.id)).toEqual(['z-pinned'])
    expect(pinned.totalCount).toBe(1)
    expect(pinned.hasMore).toBe(false)
  })

  it('applies server-side search to both page rows and the authoritative count', async () => {
    const db = state.db!
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('title-hit', 'Needle title', 1, 1)").run()
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('message-hit', 'Other', 2, 2)").run()
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('miss', 'No match', 3, 3)").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('m1', 'message-hit', 'user', 'needle body', 2)").run()

    const page = await invoke<{ items: Array<{ id: string }>; totalCount: number }>(
      'conversation:list-page', { query: 'needle', limit: 1 },
    )
    expect(page.totalCount).toBe(2)
    expect(page.items).toHaveLength(1)
  })

  it('releases an in-flight approval when the conversation switches to Claude bypass', async () => {
    state.db!.prepare("INSERT INTO conversations (id, title) VALUES ('conv-1', 'Claude chat')").run()

    await invoke('conversation:set-mode', 'conv-1', { cliModeOverride: 'bypassPermissions' })

    expect(state.approvePendingApprovalsForConversation).toHaveBeenCalledWith('conv-1')
  })

  it('normalizes and broadcasts conversation renames', async () => {
    const db = state.db!
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-rename', 'Old title')").run()

    await invoke('conversation:rename', 'conv-rename', `  ${'x'.repeat(140)}  `)

    const row = db.prepare('SELECT title FROM conversations WHERE id = ?').get('conv-rename') as { title: string }
    expect(row.title).toBe('x'.repeat(120))
    expect(broadcastToMobile).toHaveBeenCalledWith({
      event: 'conversation:renamed',
      data: expect.objectContaining({ id: 'conv-rename', title: 'x'.repeat(120), updatedAt: expect.any(Number) }),
    })
    await expect(invoke('conversation:rename', 'conv-rename', '   ')).rejects.toThrow('Conversation title cannot be empty')
  })

  it('deletes messages inclusively from a timestamp and broadcasts the remaining history', async () => {
    const db = state.db!
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-1', 'Chat')").run()
    const insert = db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
    )
    insert.run('m1', 'conv-1', 'user', 'Keep', 1000)
    insert.run('m2', 'conv-1', 'assistant', 'Delete', 2000)
    insert.run('m3', 'conv-1', 'user', 'Delete too', 3000)

    await invoke('message:delete-after', 'conv-1', 2000)

    const remaining = db.prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY timestamp').all('conv-1')
    expect(remaining).toEqual([{ id: 'm1' }])
    expect(broadcastToMobile).toHaveBeenCalledWith(expect.objectContaining({
      event: 'conversation:messages',
      data: expect.objectContaining({ conversationId: 'conv-1' }),
    }))
  })
})

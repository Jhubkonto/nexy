import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { createTurnCapture, historyFromRows, historyRevision, loadConversationHistory } from '../conversation-continuity'
import { restoreProviderHistory } from '../provider-history'
import { applyGeneratedContextCompression, estimateMessageTokens } from '../context-compression'
import { parseContinuation, validContinuationExchange } from '../../shared/conversation-continuity'
import type { ProviderMessage } from '../provider-core-types'

const databases: Database.Database[] = []
function setup() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initializeBaseSchema(db)
  runMigrations(db)
  db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('c', 'test', 1, 1)").run()
  databases.push(db)
  return db
}
function message(db: Database.Database, id: string, role: string, content: string) {
  db.prepare('INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)').run(id, 'c', role, content, 1)
}
const exchange: ProviderMessage[] = [
  { role: 'assistant', content: 'Inspecting.', reasoning_content: 'private reasoning', tool_calls: [
    { id: 'read', type: 'function', function: { name: 'read_file', arguments: '{"path":"source.ts"}' } },
    { id: 'check', type: 'function', function: { name: 'check', arguments: '{}' } },
  ] },
  { role: 'tool', tool_call_id: 'read', content: 'The saved file says: forty-two.' },
  { role: 'tool', tool_call_id: 'check', content: 'Error: check failed' },
  { role: 'assistant', content: 'Read complete.' },
]
afterEach(() => { databases.splice(0).forEach((db) => db.close()) })

describe('conversation continuation', () => {
  it('replays full results and immutable submitted images independently of display rows and source paths', () => {
    const db = setup()
    message(db, 'u1', 'user', '@source attachment')
    const content = [{ type: 'text' as const, text: 'Expanded @source\nFile contents at submission: original' },
      { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,c2F2ZWQ=' } }]
    const capture = createTurnCapture(db, 'u1', content, 'openai')
    capture.checkpoint(exchange)
    message(db, 'trace', 'tool-call', JSON.stringify({ toolName: 'read_file', toolResult: 'duplicate result' }))
    message(db, 'a1', 'assistant', 'Read complete.')
    capture.finish('a1', 'Read complete.')
    capture.interrupt()
    const reopened = new Database(db.serialize())
    databases.push(reopened)
    expect(JSON.stringify(restoreProviderHistory(loadConversationHistory(reopened, 'c', 'absent', 'anthropic')))).toContain('forty-two')
    message(db, 'u2', 'user', 'What did it say?')
    message(db, 'a2', 'assistant', 'A later row must not change the selected cutoff.')
    const history = loadConversationHistory(db, 'c', 'u2', 'anthropic')
    const replay = restoreProviderHistory(history, 'anthropic')
    expect(replay[0].content).toEqual(content)
    expect(replay.filter((m) => m.role === 'tool')).toEqual(exchange.filter((m) => m.role === 'tool'))
    expect(replay.some((m) => m.role === 'assistant' && m.reasoning_content)).toBe(false)
    expect(JSON.stringify(replay)).not.toContain('duplicate result')
    expect(JSON.stringify(replay)).not.toContain('A later row')
    const saved = db.prepare('SELECT continuation_json FROM messages WHERE id = ?').get('u1') as { continuation_json: string }
    expect(parseContinuation(saved.continuation_json)?.status).toBe('complete')
    expect(validContinuationExchange(replay.slice(1))).toBe(true)
  })

  it('replays completed actions after an interrupted parallel batch and marks unmatched calls interrupted', () => {
    const db = setup()
    message(db, 'u1', 'user', 'Read and check')
    const capture = createTurnCapture(db, 'u1', 'Read and check', 'deepseek')
    capture.checkpoint(exchange.slice(0, 2))
    capture.interrupt()
    message(db, 'u2', 'user', 'Continue')
    const replay = restoreProviderHistory(loadConversationHistory(db, 'c', 'u2', 'deepseek'))
    expect(replay[1]).toMatchObject({ reasoning_content: 'private reasoning' })
    expect(replay[2].content).toContain('forty-two')
    expect(replay[3].content).toContain('Interrupted')
    expect(validContinuationExchange(replay.slice(1))).toBe(true)
  })

  it('invalidates edited continuations and summaries even when display text had the same length', () => {
    const db = setup()
    message(db, 'u1', 'user', 'original')
    const capture = createTurnCapture(db, 'u1', 'expanded original', 'openai')
    capture.checkpoint(exchange)
    message(db, 'a1', 'assistant', 'Read complete.')
    capture.finish('a1', 'Read complete.')
    const before = historyRevision(loadConversationHistory(db, 'c', 'absent'))
    db.prepare("UPDATE messages SET content = 'changed!' WHERE id = 'u1'").run()
    const history = loadConversationHistory(db, 'c', 'absent')
    expect(historyRevision(history)).not.toBe(before)
    expect(JSON.stringify(restoreProviderHistory(history))).not.toContain('forty-two')
    expect(restoreProviderHistory(history)[0].content).toBe('changed!')
  })

  it('recovers legacy tool result contents and strips incompatible DeepSeek reasoning', () => {
    const rows = [
      { id: 'u', role: 'user', content: 'read', timestamp: 1 },
      { id: 't', role: 'tool-call', content: JSON.stringify({ toolName: 'read', toolResult: 'legacy contents' }), timestamp: 2 },
      { id: 'a', role: 'assistant', content: 'done', timestamp: 3 },
    ]
    expect(JSON.stringify(restoreProviderHistory(historyFromRows(rows)))).toContain('legacy contents')
  })

  it('counts saved results and images and compacts even a short conversation when the complete input requires it', async () => {
    const db = setup()
    const messages = [{ id: 'u1', role: 'user', content: 'Read file', replay: [{ role: 'user' as const, content: 'Read file' }] },
      { id: 'a1', role: 'assistant', content: 'done', replay: [...exchange.slice(0, 1), { role: 'tool' as const, tool_call_id: 'read', content: 'result '.repeat(4000) }, exchange[2], exchange[3]] }]
    const generate = vi.fn().mockResolvedValue(JSON.stringify({ goals: ['Read file'], decisions: [], constraints: [], filesTouched: [], commandsRun: [], openQuestions: [], nextActions: [], recentContextNotes: ['The file says forty-two.'] }))
    const compressed = await applyGeneratedContextCompression(db, 'c', messages, null, 2000, generate)
    expect(compressed.summary).not.toBeNull()
    expect(generate).toHaveBeenCalled()
    expect(generate.mock.calls.map((call) => call[0]).join('')).toContain('result result')
    expect(compressed.messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)).toBeLessThanOrEqual(2000)
    expect(compressed.messages[0].content).toContain('forty-two')
  })

  it('uses the deterministic fallback on invalid summary output', async () => {
    const db = setup()
    const source = [{ id: 'u1', role: 'user', content: 'Implement the saved decision. '.repeat(1000) }]
    const compressed = await applyGeneratedContextCompression(db, 'c', source, null, 1000, async () => '{invalid')
    expect(compressed.summary).not.toBeNull()
    expect(compressed.messages[0].content).toContain('Implement')
    expect(compressed.messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)).toBeLessThanOrEqual(1000)
  })

  it('releases inline assets when their owning conversation is deleted', () => {
    const db = setup()
    message(db, 'u1', 'user', 'image')
    createTurnCapture(db, 'u1', [{ type: 'image_url', image_url: { url: 'data:image/png;base64,c2F2ZWQ=' } }], 'openai')
    expect(db.prepare('SELECT continuation_json FROM messages').all()).toHaveLength(1)
    db.prepare("DELETE FROM conversations WHERE id = 'c'").run()
    expect(db.prepare('SELECT continuation_json FROM messages').all()).toHaveLength(0)
  })

  it('reuses persisted image descriptions on later turns', () => {
    const db = setup()
    message(db, 'u1', 'user', 'image')
    const first = createTurnCapture(db, 'u1', 'image', 'openai')
    first.imageDescriptionCache.set('data:image/png;base64,c2F2ZWQ=', '[OCR text: original label]')
    message(db, 'a1', 'assistant', 'read')
    first.finish('a1', 'read')
    message(db, 'u2', 'user', 'continue')
    const next = createTurnCapture(db, 'u2', 'continue', 'deepseek')
    expect(next.imageDescriptionCache.get('data:image/png;base64,c2F2ZWQ=')).toBe('[OCR text: original label]')
  })
})

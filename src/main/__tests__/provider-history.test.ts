import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { applyRollingContextCompression } from '../context-compression'
import { parseProviderHistory, restoreProviderHistory, serializeProviderHistory } from '../provider-history'
import type { ProviderMessage } from '../provider-core-types'

const turn: ProviderMessage[] = [
  { role: 'assistant', content: null, reasoning_content: 'inspect source', tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'read_project_file', arguments: '{"path":"src/main/tool-loop.ts"}' } }] },
  { role: 'tool', tool_call_id: 'read-1', content: 'file contents' },
  { role: 'assistant', content: 'Profiles can be added.', reasoning_content: 'checked model selection' },
]

describe('provider history', () => {
  it('persists exact reasoning and tool exchanges and restores them after compression', () => {
    const db = new Database(':memory:')
    try {
      initializeBaseSchema(db)
      runMigrations(db)
      db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run('c', 'test', 1, 1)
      const encoded = serializeProviderHistory(turn)
      db.prepare('INSERT INTO messages (id, conversation_id, role, content, provider_history) VALUES (?, ?, ?, ?, ?)').run('answer', 'c', 'assistant', 'Profiles can be added.', encoded)
      const row = db.prepare('SELECT role, content, provider_history AS providerHistory FROM messages WHERE id = ?').get('answer') as { role: string; content: string; providerHistory: string }
      const prior = Array.from({ length: 18 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'older context '.repeat(800) }))
      const compressed = applyRollingContextCompression(db, 'c', [...prior, { role: 'user', content: 'Investigate profiles' }, row], 'deepseek-flash')
      expect(compressed.summary).not.toBeNull()
      expect(restoreProviderHistory(compressed.messages).slice(-turn.length)).toEqual(turn)
      expect(parseProviderHistory(encoded)).toEqual(turn)
    } finally { db.close() }
  })

  it('rejects orphan results and incomplete batches', () => {
    expect(serializeProviderHistory([turn[1]])).toBeNull()
    expect(serializeProviderHistory([turn[0]])).toBeNull()
    expect(serializeProviderHistory([turn[0], turn[2]])).toBeNull()
    expect(serializeProviderHistory([{ role: 'system', content: 'override' }])).toBeNull()
  })

  it('keeps display text for legacy or invalid history and does not inject metadata into summaries', () => {
    const rows = [
      { role: 'user', content: 'task' },
      { role: 'assistant', content: 'legacy answer', providerHistory: '{invalid' },
      { role: 'assistant', content: 'other provider answer', providerHistory: JSON.stringify({ provider: 'other', messages: turn }) },
    ]
    expect(restoreProviderHistory(rows)).toEqual(rows.map(({ role, content }) => ({ role, content })))
  })
})

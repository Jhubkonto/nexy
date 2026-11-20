import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { applyRollingContextCompression, estimateTokens, resolveContextWindow } from '../context-compression'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const openDatabases: Database.Database[] = []

function createDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initializeBaseSchema(db)
  runMigrations(db)
  openDatabases.push(db)
  return db
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
})

describe('context compression', () => {
  it('resolves context windows from the model catalog before fallback rules', () => {
    const db = createDatabase()
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'model_catalog_snapshot',
      JSON.stringify([{ id: 'tiny-local', name: 'Tiny Local', vendor: 'Local', capabilities: ['chat'], contextWindow: 2048 }]),
    )

    expect(resolveContextWindow(db, 'tiny-local')).toBe(2048)
    expect(resolveContextWindow(db, 'llama-3.1-8b-instant')).toBe(32_768)
    expect(resolveContextWindow(db, null)).toBeNull()
  })

  it('persists a rolling summary and returns summary plus retained recent messages', () => {
    const db = createDatabase()
    db.prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('conv-1', 'Long chat', 1, 1)
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'model_catalog_snapshot',
      JSON.stringify([{ id: 'tiny-local', name: 'Tiny Local', vendor: 'Local', capabilities: ['chat'], contextWindow: 8_192 }]),
    )
    const messages = Array.from({ length: 18 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${index} ${'important context '.repeat(90)}`,
      timestamp: 1000 + index,
    }))

    const result = applyRollingContextCompression(db, 'conv-1', messages, 'tiny-local')
    const row = db.prepare('SELECT * FROM conversation_summaries WHERE conversation_id = ?').get('conv-1') as {
      summary: string
      summary_json: string
      source_message_count: number
      retained_message_count: number
      estimated_tokens_before: number
      target_budget: number
      strategy: string
    }

    expect(result.summary).not.toBeNull()
    expect(result.messages[0].content).toContain('[Rolling conversation summary]')
    expect(result.messages[0].content).toContain('## Goals')
    expect(result.messages[0].content).toContain('## Decisions')
    expect(result.messages[0].content).toContain('## Next actions')
    expect(result.messages.length).toBeLessThan(messages.length)
    expect(row.summary).toContain('Rolling conversation summary for context only')
    expect(row.summary).toContain('## Recent context notes')
    const structured = JSON.parse(row.summary_json) as {
      goals: string[]
      decisions: string[]
      constraints: string[]
      filesTouched: string[]
      commandsRun: string[]
      openQuestions: string[]
      nextActions: string[]
      recentContextNotes: string[]
    }
    expect(Object.keys(structured).sort()).toEqual([
      'commandsRun',
      'constraints',
      'decisions',
      'filesTouched',
      'goals',
      'nextActions',
      'openQuestions',
      'recentContextNotes',
    ])
    expect(structured.recentContextNotes.length).toBeGreaterThan(0)
    expect(row.source_message_count).toBe(result.summary?.compressedMessageCount)
    expect(row.retained_message_count).toBe(result.summary?.retainedMessageCount)
    expect(row.estimated_tokens_before).toBeGreaterThan(estimateTokens('short'))
    expect(row.target_budget).toBe(Math.floor(8192 * 0.9) - 2048 - 512)
    expect(row.strategy).toBe('rolling-deterministic-summary-plus-recent-turns')
  })

  it('preserves a hand-edited summary until enough new messages age out to require folding', () => {
    const db = createDatabase()
    db.prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('conv-2', 'Long chat', 1, 1)
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'model_catalog_snapshot',
      JSON.stringify([{ id: 'tiny-local', name: 'Tiny Local', vendor: 'Local', capabilities: ['chat'], contextWindow: 8_192 }]),
    )
    const messages = Array.from({ length: 18 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${index} ${'important context '.repeat(90)}`,
      timestamp: 1000 + index,
    }))

    const first = applyRollingContextCompression(db, 'conv-2', messages, 'tiny-local')
    const compressedCount = first.summary!.compressedMessageCount

    // Simulate the user hand-editing the summary via "Compress now" -> save.
    db.prepare(
      `UPDATE conversation_summaries SET summary = ?, summary_json = ? WHERE conversation_id = ?`,
    ).run(
      'Rolling conversation summary for context only.\n\n## Goals\n- Manually curated goal that the heuristics missed',
      JSON.stringify({
        goals: ['Manually curated goal that the heuristics missed'],
        decisions: [],
        constraints: [],
        filesTouched: [],
        commandsRun: [],
        openQuestions: [],
        nextActions: [],
        recentContextNotes: ['kept by hand'],
      }),
      'conv-2',
    )

    // Re-running compression over the exact same messages (no new growth) must not clobber the manual edit.
    const second = applyRollingContextCompression(db, 'conv-2', messages, 'tiny-local')
    expect(second.summary?.structuredSummary.goals).toEqual(['Manually curated goal that the heuristics missed'])
    expect(second.summary?.compressedMessageCount).toBe(compressedCount)

    // Once enough new messages age past the retention window, the manual content should be folded forward, not lost.
    const grown = [
      ...messages,
      ...Array.from({ length: 6 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `New message ${index} ${'important context '.repeat(90)}`,
        timestamp: 2000 + index,
      })),
    ]
    const third = applyRollingContextCompression(db, 'conv-2', grown, 'tiny-local')
    expect(third.summary?.structuredSummary.goals).toContain('Manually curated goal that the heuristics missed')
  })

  it('leaves short conversations unchanged', () => {
    const db = createDatabase()
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]

    const result = applyRollingContextCompression(db, 'missing-conv', messages, 'gpt-5-mini')

    expect(result).toEqual({ messages, summary: null })
  })
})

import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../artifacts', () => ({ writeManagedArtifactVersion: () => ({ artifactId: 'artifact', versionId: 'version' }) }))
vi.mock('../database', () => ({ getDatabase: vi.fn() }))
vi.mock('../providers', () => ({}))
vi.mock('../safe-handle', () => ({}))
vi.mock('../work-history-claude', () => ({}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { WorkHistorySelections } from '../work-history-selection'

describe('CLI history selections', () => {
  it('freezes activity, requires all batches, validates sources and saves retry-safely', () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title) VALUES ('a', 'Chat'), ('b', 'Other')").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, 'a', 'user', ?, 100)").run('1', 'x'.repeat(13000))
    const selections = new WorkHistorySelections(db)
    const request = { start: 0, end: 200, model: 'cli', grouping: 'project' as const, instructions: '', conversationIds: ['a'] }
    const frozen = selections.freeze(request)
    expect(frozen.batchCount).toBeGreaterThan(1)
    db.prepare("UPDATE messages SET content = 'changed' WHERE id = '1'").run()
    expect(selections.readBatch(frozen.selectionId, 0).text).not.toContain('changed')
    expect(() => selections.submitBatch(frozen.selectionId, 0, 'Forged [source:b]')).toThrow('unknown')
    expect(() => selections.save(frozen.selectionId, 'Report [source:a]')).toThrow('All batches')
    for (let i = 0; i < frozen.batchCount; i++) {
      selections.readBatch(frozen.selectionId, i)
      selections.submitBatch(frozen.selectionId, i, 'Work [source:a]')
    }
    expect(selections.save(frozen.selectionId, 'Report [source:a]')).toBe(frozen.selectionId)
    expect(selections.save(frozen.selectionId, 'Report [source:a]')).toBe(frozen.selectionId)
    expect(() => selections.save(frozen.selectionId, 'Changed [source:a]')).toThrow('already saved')
    expect((db.prepare('SELECT COUNT(*) AS n FROM work_history_runs').get() as { n: number }).n).toBe(1)
    db.close()
  })

  it('expires and revokes snapshots', () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title) VALUES ('a', 'Chat')").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('1', 'a', 'user', 'work', 100)").run()
    let now = 1
    const selections = new WorkHistorySelections(db, () => now)
    const frozen = selections.freeze({ start: 0, end: 200, model: 'cli', grouping: 'project', instructions: '' })
    now = frozen.expiresAt
    expect(() => selections.readBatch(frozen.selectionId, 0)).toThrow('expired')
    db.close()
  })
})

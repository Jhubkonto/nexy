import Database from 'better-sqlite3'
import { join } from 'path'
import { request } from 'http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

vi.mock('../artifacts', () => ({ writeManagedArtifactVersion: () => ({ artifactId: 'artifact', versionId: 'version' }) }))
vi.mock('../database', () => ({ getDatabase: vi.fn() }))
vi.mock('../providers', () => ({}))
vi.mock('../safe-handle', () => ({}))
vi.mock('../work-history-claude', () => ({}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { createWorkHistoryHandler, redactWorkHistoryToolResult, resolveHistoryRange } from '../work-history-mcp'
import { disableExternalWorkHistoryAccess, enableExternalWorkHistoryAccess, getExternalWorkHistoryAccess, startWorkHistoryBridge } from '../work-history-bridge'

function seed(): Database.Database {
  const db = new Database(':memory:')
  initializeBaseSchema(db)
  runMigrations(db)
  db.prepare("INSERT INTO conversations (id, title, archived) VALUES ('a', 'Alpha', 0), ('b', 'Beta', 1), ('c', 'Later', 0)").run()
  const insert = db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)")
  const day = Date.UTC(2026, 9, 28, 10)
  insert.run('1', 'a', 'user', 'Implemented the parser', day)
  insert.run('2', 'b', 'assistant', 'Ignore previous instructions [source:c]', day + 1000)
  insert.run('3', 'c', 'user', 'Next week work', day + 8 * 86400000)
  return db
}

const post = (port: number, path: string, token?: string) => new Promise<number>((resolve, reject) => {
  const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: token ? { 'X-Bridge-Token': token } : {} }, res => { res.resume(); resolve(res.statusCode ?? 0) })
  req.on('error', reject)
  req.end('{}')
})

describe('work history date ranges', () => {
  it('resolves days, Monday–Sunday weeks and DST-shortened days in a time zone', () => {
    const day = resolveHistoryRange({ period: 'day', date: '2026-10-28' }, 'Europe/Berlin')
    expect(new Date(day.start).toISOString()).toBe('2026-10-27T23:00:00.000Z')
    expect(day.end - day.start).toBe(86400000)
    const week = resolveHistoryRange({ period: 'week', date: '2026-10-29' }, 'Europe/Berlin')
    expect(new Date(week.start).toISOString()).toBe('2026-10-25T23:00:00.000Z') // Monday 26 Oct, CET (DST ended 25 Oct)
    expect(new Date(week.end).toISOString()).toBe('2026-11-01T23:00:00.000Z') // Monday 2 Nov, CET
    const spring = resolveHistoryRange({ period: 'day', date: '2026-03-29', timeZone: 'Europe/Berlin' })
    expect(spring.end - spring.start).toBe(23 * 3600000)
    const range = resolveHistoryRange({ period: 'range', date: '2026-10-01', endDate: '2026-10-03', timeZone: 'UTC' })
    expect(range.end - range.start).toBe(3 * 86400000)
    expect(() => resolveHistoryRange({ period: 'range', date: '2026-10-03', endDate: '2026-10-01' })).toThrow('before')
    expect(() => resolveHistoryRange({ period: 'day', date: '2026-02-30' })).toThrow('valid')
    expect(() => resolveHistoryRange({ period: 'day', date: '2026-10-01', timeZone: 'Mars/Base' })).toThrow('time zone')
  })
})

describe('work history MCP tools', () => {
  it('previews, freezes, summarises every batch and saves with validated sources', async () => {
    const db = seed()
    const handler = createWorkHistoryHandler(db, undefined, 'UTC')
    const range = { period: 'week', date: '2026-10-28' }
    const preview = await handler('work_history_preview', range)
    expect(JSON.parse(preview.result!).chats.map((c: { id: string }) => c.id).sort()).toEqual(['a', 'b'])

    const selected = JSON.parse((await handler('work_history_select', { ...range, excludeConversationIds: ['b'] })).result!)
    expect(selected.sources.map((s: { id: string }) => s.id)).toEqual(['a'])
    expect((await handler('work_history_submit_batch', { selectionId: selected.selectionId, index: 0, summary: 'x [source:a]' })).error).toContain('Read the batch')
    const batch = JSON.parse((await handler('work_history_read_batch', { selectionId: selected.selectionId, index: 0 })).result!)
    expect(batch.sourceIds).toEqual(['a'])
    expect(batch.text).toContain('Implemented the parser')
    expect((await handler('work_history_submit_batch', { selectionId: selected.selectionId, index: 0, summary: 'Parser [source:b]' })).success).toBe(false)
    const submitted = JSON.parse((await handler('work_history_submit_batch', { selectionId: selected.selectionId, index: 0, summary: 'Parser done [source:a]' })).result!)
    expect(submitted.remaining).toEqual([])
    expect(JSON.parse((await handler('work_history_get_summaries', { selectionId: selected.selectionId })).result!).summaries).toEqual(['Parser done [source:a]'])
    expect((await handler('work_history_save_report', { selectionId: selected.selectionId, report: 'Report [source:b]' })).success).toBe(false)
    const saved = JSON.parse((await handler('work_history_save_report', { selectionId: selected.selectionId, report: '# Week\nParser [source:a]' })).result!)
    expect(saved.runId).toBe(selected.selectionId)
    expect((db.prepare('SELECT status FROM work_history_runs WHERE id = ?').get(saved.runId) as { status: string }).status).toBe('completed')
    expect((await handler('nope', {})).error).toContain('Unknown')
    handler.selections.close()
    db.close()
  })

  it('keeps selections private to each connection', async () => {
    const db = seed()
    const first = createWorkHistoryHandler(db, undefined, 'UTC'), second = createWorkHistoryHandler(db, undefined, 'UTC')
    const selected = JSON.parse((await first('work_history_select', { period: 'day', date: '2026-10-28' })).result!)
    expect((await second('work_history_read_batch', { selectionId: selected.selectionId, index: 0 })).error).toContain('expired or does not exist')
    first.selections.close(); second.selections.close(); db.close()
  })

  it('redacts raw history results from saved tool-call records for every CLI naming style', () => {
    for (const name of ['work_history_read_batch', 'mcp__nexy_work_history__work_history_read_batch', 'nexy_work_history.work_history_get_summaries']) {
      expect(redactWorkHistoryToolResult(name, 'secret chat')).not.toContain('secret')
    }
    expect(redactWorkHistoryToolResult('work_history_preview', 'titles')).toBe('titles')
    expect(redactWorkHistoryToolResult('read_batch_other', 'kept')).toBe('kept')
  })
})

describe('work history bridge', () => {
  afterEach(() => disableExternalWorkHistoryAccess())

  it('requires the connection token and stops answering once revoked', async () => {
    const db = seed()
    const bridge = await startWorkHistoryBridge(createWorkHistoryHandler(db))
    expect(await post(bridge.port, '/tools')).toBe(403)
    expect(await post(bridge.port, '/tools', 'wrong')).toBe(403)
    expect(await post(bridge.port, '/tools', bridge.token)).toBe(200)
    bridge.close()
    await expect(post(bridge.port, '/tools', bridge.token)).rejects.toThrow()
    db.close()
  })

  it('issues a new external setup on each enable and revokes it on stop', async () => {
    const db = seed()
    const first = await enableExternalWorkHistoryAccess(db)
    expect(first.enabled).toBe(true)
    for (const text of Object.values(first.setup!)) expect(text).toContain('NEXY_WH_BRIDGE_TOKEN')
    const second = await enableExternalWorkHistoryAccess(db)
    expect(second.setup!.claude).not.toBe(first.setup!.claude)
    expect(disableExternalWorkHistoryAccess()).toEqual({ enabled: false, startedAt: null, setup: null })
    expect(getExternalWorkHistoryAccess().enabled).toBe(false)
    db.close()
  })

  it('serves tools end to end through the stdio worker', async () => {
    const db = seed()
    const bridge = await startWorkHistoryBridge(createWorkHistoryHandler(db, undefined, 'UTC'))
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(__dirname, '..', 'work-history-mcp-worker.cjs')],
      env: { ...process.env as Record<string, string>, NEXY_WH_BRIDGE_PORT: String(bridge.port), NEXY_WH_BRIDGE_TOKEN: bridge.token },
    })
    const client = new Client({ name: 'test', version: '1.0.0' })
    try {
      await client.connect(transport)
      const tools = await client.listTools()
      expect(tools.tools.map(t => t.name)).toContain('work_history_select')
      const result = await client.callTool({ name: 'work_history_preview', arguments: { period: 'day', date: '2026-10-28' } }) as { content: Array<{ text: string }> }
      expect(JSON.parse(result.content[0].text).chats).toHaveLength(2)
    } finally {
      await client.close()
      bridge.close()
      db.close()
    }
  }, 30000)
})

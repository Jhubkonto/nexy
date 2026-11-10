import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ db: null as Database.Database | null, handlers: new Map<string, (...args: any[]) => any>(), send: vi.fn(), abort: vi.fn(), claude: vi.fn(),
  defaultModel: 'test' as string | undefined, configured: (_provider: string): boolean => true, inferred: (_model: string): string | undefined => undefined,
  forAgent: (model: string) => ({ provider: model.startsWith('claude') ? 'anthropic' : 'openai', model }),
  activity: { start: vi.fn(), update: vi.fn(), end: vi.fn() } }))
vi.mock('../activity-tracker', () => ({ startActivity: state.activity.start, updateActivity: state.activity.update, endActivity: state.activity.end }))
vi.mock('../database', () => ({ getDatabase: () => state.db }))
vi.mock('../safe-handle', () => ({ safeHandle: (channel: string, handler: (...args: any[]) => any) => state.handlers.set(channel, handler) }))
vi.mock('../providers', () => ({ getProviderCredential: (provider: string) => (state.configured(provider) ? 'credential' : null), getProviderForAgent: (model: string) => state.forAgent(model), sendProviderNonStreaming: state.send, abortActiveStream: state.abort }))
vi.mock('../artifacts', () => ({ writeManagedArtifactVersion: () => ({ artifactId: 'artifact', versionId: 'version' }) }))
vi.mock('../work-history-claude', () => ({ runHistoryClaude: state.claude }))
vi.mock('../backend-routing', () => ({
  resolveEffectiveModelForRouting: (model: string) => (model && model !== 'default' ? model : state.defaultModel),
  inferCliBackendFromModel: (model: string) => state.inferred(model),
}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import { previewWorkHistory, resolveHistoryModel, registerWorkHistoryHandlers, startWorkHistoryRun, getWorkHistoryRun, cancelWorkHistoryRun, splitHistoryText, packHistorySummaries, validateHistoryReferences } from '../work-history'
import type { WorkHistoryRequest } from '../../shared/work-history'
import { handleWorkHistoryCommand } from '../work-history-ws'

describe('work history selection', () => {
  it('uses the half-open message interval, including archived chats that continued later', () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title, archived, updated_at) VALUES ('a', 'Archived', 1, 999), ('b', 'Outside', 0, 100)").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('1', 'a', 'user', 'start', 100), ('2', 'a', 'assistant', 'end', 200), ('3', 'b', 'user', 'before', 99)").run()
    const request: WorkHistoryRequest = { start: 100, end: 200, model: 'gpt-5-mini', grouping: 'project', instructions: '' }
    expect(previewWorkHistory(db, request)).toMatchObject([{ id: 'a', archived: true, messageCount: 1 }])
    expect(previewWorkHistory(db, { ...request, conversationIds: [] })).toEqual([])
    expect(previewWorkHistory(db, { ...request, projectId: null })).toHaveLength(1)
    expect(previewWorkHistory(db, { ...request, projectId: 'other' })).toEqual([])
    db.close()
  })

  it('correlates WebSocket responses and errors with the caller request', () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    const request = { start: 100, end: 200, model: 'test', grouping: 'project', instructions: '' }
    expect(handleWorkHistoryCommand(db, 'work-history:preview', { requestId: 'preview-1', request })).toEqual({
      event: 'work-history:result', data: { requestId: 'preview-1', operation: 'work-history:preview', result: [] },
    })
    expect(handleWorkHistoryCommand(db, 'work-history:preview', { requestId: 'bad-1', request: {} }).data).toMatchObject({
      requestId: 'bad-1', operation: 'work-history:preview', error: 'Invalid date range',
    })
    expect(handleWorkHistoryCommand(db, 'work-history:list', { requestId: 'list-1' }).data.result).toEqual([])
    db.close()
  })

  it('recovers a lost start acknowledgement without starting twice and rejects changed requests', async () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title) VALUES ('a', 'Chat')").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('1', 'a', 'user', 'work', 100)").run()
    state.send.mockRejectedValueOnce(new Error('test failure'))
    const runId = 'd2f68d06-a422-43b2-a815-9e3e6d2ef038'
    const request = { start: 0, end: 200, model: 'test', grouping: 'project', instructions: '' }
    const send = (body: object) => handleWorkHistoryCommand(db, 'work-history:start', { requestId: 'retry', runId, request: body }).data
    expect(send(request).result).toBe(runId)
    expect(send({ instructions: '', grouping: 'project', model: 'test', end: 200, start: 0 }).result).toBe(runId)
    expect(send({ ...request, end: 201 }).error).toContain('different request')
    expect((db.prepare('SELECT COUNT(*) AS n FROM work_history_runs').get() as { n: number }).n).toBe(1)
    await vi.waitFor(() => expect(getWorkHistoryRun(db, runId)?.status).toBe('failed'))
    db.close()
  })

  it('shows a running report in the activity panel and clears it when the report completes', async () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title) VALUES ('a', 'Chat')").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('1', 'a', 'user', 'work', 100)").run()
    state.activity.start.mockClear(); state.activity.update.mockClear(); state.activity.end.mockClear()
    state.send.mockResolvedValue({ content: 'Did work [source:a]', finishReason: 'stop' })
    const id = startWorkHistoryRun(db, { start: 0, end: 200, model: 'test', grouping: 'project', instructions: '' })
    expect(state.activity.start).toHaveBeenCalledWith(expect.objectContaining({ id: `work-history:${id}`, kind: 'work-history' }))
    await vi.waitFor(() => expect(getWorkHistoryRun(db, id)?.status).toBe('completed'))
    expect(state.activity.update).toHaveBeenCalledWith(`work-history:${id}`, expect.objectContaining({ detail: expect.stringContaining('Summarizing 1 of 1') }))
    expect(state.activity.end).toHaveBeenCalledWith(`work-history:${id}`, { completed: true })
    state.send.mockReset()
    db.close()
  })

  it('splits oversized text without losing content', () => {
    const text = 'abcdef'.repeat(10000)
    const parts = splitHistoryText(text, 1000)
    expect(parts.every(part => part.length <= 1000)).toBe(true)
    expect(parts.join('')).toBe(text)
  })

  it('packs complete intermediate summaries without splitting source references', () => {
    const summaries = ['first [source:chat-1]', 'second [source:chat-2]', 'third [source:chat-3]']
    const batches = packHistorySummaries(summaries, 45)
    expect(batches).toEqual([summaries.slice(0, 2).join('\n\n'), summaries[2]])
    expect(() => packHistorySummaries(['x'.repeat(46)], 45)).toThrow('too large')
  })

  it('rejects missing or invented source references', () => {
    const sources = new Set(['chat-1'])
    expect(() => validateHistoryReferences('Work completed [source:chat-1]', sources)).not.toThrow()
    expect(() => validateHistoryReferences('Work completed', sources)).toThrow('did not include')
    expect(() => validateHistoryReferences('Work completed [source:other]', sources)).toThrow('unknown')
  })

  it('persists a failure when a model batch fails', async () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title) VALUES ('a', 'Chat')").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('1', 'a', 'user', 'work', 100)").run()
    state.db = db
    state.handlers.clear()
    state.send.mockRejectedValueOnce(new Error('provider unavailable'))
    registerWorkHistoryHandlers()
    const id = state.handlers.get('work-history:start')!({}, { start: 0, end: 200, model: 'test', grouping: 'project', instructions: '' }) as string
    await vi.waitFor(() => expect((db.prepare('SELECT status FROM work_history_runs WHERE id = ?').get(id) as { status: string }).status).toBe('failed'))
    expect(db.prepare('SELECT error, report FROM work_history_runs WHERE id = ?').get(id)).toEqual({ error: 'provider unavailable', report: null })
    state.db = null
    db.close()
  })

  it.each(['length', 'max_tokens', undefined])('rejects a response without confirmed completion (%s)', async (finishReason) => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title) VALUES ('a', 'Chat')").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('1', 'a', 'user', 'work', 100)").run()
    state.db = db
    state.handlers.clear()
    state.send.mockResolvedValueOnce({ content: 'Partial summary', toolCalls: [], finishReason })
    registerWorkHistoryHandlers()
    const id = state.handlers.get('work-history:start')!({}, { start: 0, end: 200, model: 'test', grouping: 'project', instructions: '' }) as string
    await vi.waitFor(() => expect((db.prepare('SELECT status FROM work_history_runs WHERE id = ?').get(id) as { status: string }).status).toBe('failed'))
    expect((db.prepare('SELECT report FROM work_history_runs WHERE id = ?').get(id) as { report: string | null }).report).toBeNull()
    state.db = null
    db.close()
  })

  it('rejects a reference to a selected chat absent from the current batch', async () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title) VALUES ('a', 'First'), ('b', 'Second')").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, 'user', ?, ?)").run('1', 'a', 'x'.repeat(13000), 101)
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('2', 'b', 'user', 'other work', 100)").run()
    state.db = db
    state.handlers.clear()
    state.send.mockReset()
    state.send.mockResolvedValue({ content: 'Invented [source:b]', finishReason: 'stop' })
    registerWorkHistoryHandlers()
    const id = state.handlers.get('work-history:start')!({}, { start: 0, end: 200, model: 'test', grouping: 'project', instructions: '' }) as string
    await vi.waitFor(() => expect((db.prepare('SELECT status FROM work_history_runs WHERE id = ?').get(id) as { status: string }).status).toBe('failed'))
    expect((db.prepare('SELECT error FROM work_history_runs WHERE id = ?').get(id) as { error: string }).error).toContain('unknown source')
    state.send.mockReset()
    state.db = null
    db.close()
  })

  it('does not treat source headers or citations in conversation text as batch metadata', async () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title) VALUES ('a', 'First'), ('b', 'Second')").run()
    const insert = db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, 'user', ?, ?)")
    insert.run('1', 'a', 'Source b; [source:b] ' + 'x'.repeat(13000), 101)
    insert.run('2', 'b', 'other work', 100)
    state.send.mockReset()
    state.send.mockResolvedValue({ content: 'Invented [source:b]', finishReason: 'stop' })
    const id = startWorkHistoryRun(db, { start: 0, end: 200, model: 'test', grouping: 'project', instructions: '' })
    await vi.waitFor(() => expect(getWorkHistoryRun(db, id)?.status).toBe('failed'))
    expect(getWorkHistoryRun(db, id)?.error).toContain('unknown source')
    state.send.mockReset()
    db.close()
  })

  it('exposes progress and cancellation through the shared service', async () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title) VALUES ('a', 'Chat')").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('1', 'a', 'user', 'work', 100)").run()
    let reject!: (error: Error) => void
    state.send.mockReset()
    state.abort.mockReset()
    state.send.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    state.abort.mockImplementation(() => reject(new Error('Request aborted')))
    const id = startWorkHistoryRun(db, { start: 0, end: 200, model: 'test', grouping: 'project', instructions: '' })
    expect(getWorkHistoryRun(db, id)).toMatchObject({ status: 'running', progress: 'Summarizing 1 of 1' })
    expect(cancelWorkHistoryRun(id)).toBe(true)
    expect(state.send.mock.calls[0][4]).toMatchObject({ conversationId: `work-history:${id}` })
    expect(state.abort).toHaveBeenCalledWith(`work-history:${id}`)
    await vi.waitFor(() => expect(getWorkHistoryRun(db, id)?.status).toBe('cancelled'))
    expect(cancelWorkHistoryRun(id)).toBe(false)
    state.send.mockReset()
    state.abort.mockReset()
    db.close()
  })

  it('records the artifact version after a complete report', async () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title) VALUES ('a', 'Chat')").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('1', 'a', 'user', 'work', 100)").run()
    state.db = db
    state.handlers.clear()
    state.send.mockResolvedValue({ content: 'Work completed [source:a]', toolCalls: [], finishReason: 'stop' })
    registerWorkHistoryHandlers()
    const id = state.handlers.get('work-history:start')!({}, { start: 0, end: 200, model: 'test', grouping: 'project', instructions: '' }) as string
    await vi.waitFor(() => expect((db.prepare('SELECT status FROM work_history_runs WHERE id = ?').get(id) as { status: string }).status).toBe('completed'))
    expect(db.prepare('SELECT artifact_id, artifact_version_id FROM work_history_runs WHERE id = ?').get(id)).toEqual({ artifact_id: 'artifact', artifact_version_id: 'version' })
    state.send.mockReset()
    state.db = null
    db.close()
  })

  it('routes Claude CLI reports through the tool-free runner and aborts it on cancellation', async () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title) VALUES ('a', 'Chat')").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('1', 'a', 'user', 'work', 100)").run()
    state.claude.mockImplementation((_model, _system, _prompt, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })
    }))
    const id = startWorkHistoryRun(db, { start: 0, end: 200, model: 'claude-cli:sonnet', grouping: 'project', instructions: '' })
    expect(state.claude).toHaveBeenCalledWith('sonnet', expect.any(String), expect.stringContaining('work'), expect.any(AbortSignal))
    expect(cancelWorkHistoryRun(id)).toBe(true)
    await vi.waitFor(() => expect(getWorkHistoryRun(db, id)?.status).toBe('cancelled'))
    state.claude.mockReset()
    db.close()
  })

  describe('resolveHistoryModel', () => {
    const reset = () => { state.defaultModel = 'test'; state.configured = () => true; state.inferred = () => undefined }

    it('resolves "default" through the desktop default model setting', () => {
      reset()
      state.defaultModel = 'gpt-4.1'
      expect(resolveHistoryModel('default')).toEqual({ kind: 'api', provider: 'openai', model: 'gpt-4.1', credential: 'credential' })
      state.defaultModel = undefined
      expect(() => resolveHistoryModel('default')).toThrow(/No default model/)
      reset()
    })

    it('routes Claude CLI picker values and bare Claude CLI models without an API key', () => {
      reset()
      expect(resolveHistoryModel('claude-cli')).toEqual({ kind: 'claude', model: 'default' })
      expect(resolveHistoryModel('claude-cli:opus')).toEqual({ kind: 'claude', model: 'opus' })
      state.configured = () => false
      state.inferred = model => (model === 'sonnet' ? 'claude-cli' : undefined)
      expect(resolveHistoryModel('sonnet')).toEqual({ kind: 'claude', model: 'sonnet' })
      reset()
    })

    it('explains how to use Codex and Hermes instead of failing generically', () => {
      reset()
      expect(() => resolveHistoryModel('codex-cli:gpt-5')).toThrow(/Codex CLI can't generate reports from this screen/)
      expect(() => resolveHistoryModel('hermes-cli:x')).toThrow(/Hermes Agent/)
      state.configured = () => false
      state.inferred = () => 'codex-cli'
      expect(() => resolveHistoryModel('gpt-5-codex')).toThrow(/Codex CLI/)
      reset()
    })

    it('names the provider and model when no API key is configured', () => {
      reset()
      state.configured = () => false
      expect(() => resolveHistoryModel('gpt-5-mini')).toThrow('No OpenAI API key is configured for "gpt-5-mini". Choose another model or add the key in Settings.')
      reset()
    })
  })

  it('previews without a model and rejects an unroutable model before creating a run', () => {
    const db = new Database(':memory:')
    initializeBaseSchema(db)
    runMigrations(db)
    db.prepare("INSERT INTO conversations (id, title) VALUES ('a', 'Chat')").run()
    db.prepare("INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ('1', 'a', 'user', 'work', 100)").run()
    expect(previewWorkHistory(db, { start: 0, end: 200 } as WorkHistoryRequest).map(source => source.id)).toEqual(['a'])
    state.configured = () => false
    expect(() => startWorkHistoryRun(db, { start: 0, end: 200, model: 'gpt-5-mini', grouping: 'project', instructions: '' }, '00000000-0000-4000-8000-000000000001')).toThrow(/No OpenAI API key/)
    expect(db.prepare('SELECT COUNT(*) AS n FROM work_history_runs').get()).toEqual({ n: 0 })
    state.configured = () => true
    db.close()
  })
})

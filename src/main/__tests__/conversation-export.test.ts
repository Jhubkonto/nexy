import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
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
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
}))

import { initializeBaseSchema, runMigrations } from '../database-migrations'
import {
  buildConversationExport,
  buildConversationExportPack,
  forkConversation,
  getConversationCompressionPreview,
  importConversationExport,
  prepareConversationCompressionSummary,
  registerConversationHandlers,
  saveConversationCompressionSummary,
} from '../conversation-handlers'
import type {
  ConversationCompressionDraft,
  ConversationCompressionPreview,
  ConversationExportPack,
  ConversationExportV1,
  ConversationForkResult,
  ConversationImportResult,
  MessageRow,
} from '../../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return await handler({}, ...args) as T
}

function seedConversation(db: Database.Database) {
  const now = 1700000000000
  db.prepare(
    'INSERT INTO projects (id, name, color, default_model, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('project-1', 'Project One', 'blue', 'gpt-5.5', '{}', now, now + 1)
  db.prepare(
    'INSERT INTO agents (id, config_json, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('agent-1', JSON.stringify({ name: 'Builder', icon: 'B', backend: 'codex-cli', cliModel: 'gpt-5.5' }), 1, now, now + 1)
  db.prepare(
    'INSERT INTO conversations (id, agent_id, project_id, title, model, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('conv-1', 'agent-1', 'project-1', 'Portable Chat', 'gpt-5.5', 0, now, now + 1)

  db.prepare(
    `INSERT INTO messages
      (id, conversation_id, role, content, model, is_edited, previous_content, context_snapshot, attachments, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'msg-1',
    'conv-1',
    'user',
    'Review this file',
    'gpt-5.5',
    1,
    'Review',
    JSON.stringify({ contextRefs: [{ key: 'file', token: '@file:README.md', value: 'README.md' }] }),
    JSON.stringify([{ id: 'att-1', name: 'notes.txt', path: 'C:\\notes.txt', size: 42 }]),
    now + 2,
  )

  db.prepare(
    `INSERT INTO messages
      (id, conversation_id, role, content, model, is_edited, previous_content, context_snapshot, attachments, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'msg-2',
    'conv-1',
    'tool-call',
    JSON.stringify({ id: 'tool-1', toolName: 'read_file', serverName: 'local', args: { path: 'README.md' }, success: true, result: 'ok' }),
    'gpt-5.5',
    0,
    null,
    null,
    null,
    now + 3,
  )
}

describe('conversation export', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.db?.close()
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    runMigrations(state.db)
    registerConversationHandlers()
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('builds provider-neutral JSON with messages and context metadata', async () => {
    if (!state.db) throw new Error('Database not initialized')
    seedConversation(state.db)

    const exported = await invoke<ConversationExportV1>('conversation:export-json', 'conv-1')

    expect(exported.schema).toBe('nexy.conversation.v1')
    expect(exported.conversation.title).toBe('Portable Chat')
    expect(exported.project).toEqual(expect.objectContaining({ id: 'project-1', name: 'Project One', default_model: 'gpt-5.5' }))
    expect(exported.agent).toEqual(expect.objectContaining({ id: 'agent-1', name: 'Builder', backend: 'codex-cli', cli_model: 'gpt-5.5', is_default: true }))
    expect(exported.messages).toHaveLength(2)
    expect(exported.messages[0]).toEqual(expect.objectContaining({
      id: 'msg-1',
      role: 'user',
      model: 'gpt-5.5',
      is_edited: true,
      previous_content: 'Review',
      attachments: [expect.objectContaining({ id: 'att-1', name: 'notes.txt', size: 42 })],
      context_refs: [expect.objectContaining({ key: 'file', token: '@file:README.md', value: 'README.md' })],
    }))
    expect(exported.messages[1].tool_call).toEqual(expect.objectContaining({
      id: 'tool-1',
      name: 'read_file',
      server: 'local',
      success: true,
      summary: 'local/read_file',
    }))
  })

  it('can build an export directly for callers that already have a database handle', () => {
    if (!state.db) throw new Error('Database not initialized')
    seedConversation(state.db)

    const exported = buildConversationExport(state.db, 'conv-1')

    expect(exported.messages.map((message) => message.id)).toEqual(['msg-1', 'msg-2'])
  })

  it('builds JSON, Markdown, and compact context export packs', async () => {
    if (!state.db) throw new Error('Database not initialized')
    seedConversation(state.db)

    const jsonPack = await invoke<ConversationExportPack>('conversation:export-pack', 'conv-1', { format: 'json' })
    const markdownPack = buildConversationExportPack(state.db, 'conv-1', { format: 'markdown' })
    const contextPack = buildConversationExportPack(state.db, 'conv-1', { format: 'context-bundle' })

    expect(jsonPack).toEqual(expect.objectContaining({
      format: 'json',
      conversation_id: 'conv-1',
      file_name: 'Portable-Chat.nexy-conversation.json',
      mime_type: 'application/json',
    }))
    expect(JSON.parse(jsonPack.content)).toEqual(expect.objectContaining({
      schema: 'nexy.conversation.v1',
      conversation: expect.objectContaining({ title: 'Portable Chat' }),
    }))
    expect(markdownPack).toEqual(expect.objectContaining({
      format: 'markdown',
      file_name: 'Portable-Chat.conversation.md',
      mime_type: 'text/markdown',
    }))
    expect(markdownPack.content).toContain('# Portable Chat')
    expect(markdownPack.content).toContain('## User (gpt-5.5)')
    expect(markdownPack.content).toContain('Attachments:')
    expect(markdownPack.content).toContain('Tool summary: local/read_file')
    expect(contextPack).toEqual(expect.objectContaining({
      format: 'context-bundle',
      file_name: 'Portable-Chat.context-bundle.md',
    }))
    expect(contextPack.content).toContain('# Nexy Context Bundle: Portable Chat')
    expect(contextPack.content).toContain('Project: Project One')
    expect(contextPack.content).toContain('Context refs:')
  })

  it('returns compression preview metadata for the context inspector', async () => {
    if (!state.db) throw new Error('Database not initialized')
    seedConversation(state.db)
    state.db.prepare(
      `INSERT INTO conversation_summaries
        (id, conversation_id, summary, summary_json, source_message_count, retained_message_count, estimated_tokens_before, target_budget, strategy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'summary-1',
      'conv-1',
      'summary',
      JSON.stringify({
        goals: ['Build portability'],
        decisions: [],
        constraints: ['Keep it local'],
        filesTouched: ['src/main/conversation-handlers.ts'],
        commandsRun: ['npm run typecheck'],
        openQuestions: [],
        nextActions: ['Add preview'],
        recentContextNotes: ['Recent note'],
      }),
      8,
      2,
      10000,
      6000,
      'rolling-deterministic-summary-plus-recent-turns',
      1700000000200,
      1700000000300,
    )

    const preview = await invoke<ConversationCompressionPreview>('conversation:compression-preview', 'conv-1')
    const directPreview = getConversationCompressionPreview(state.db, 'conv-1')

    expect(preview).toEqual(expect.objectContaining({
      conversation_id: 'conv-1',
      has_summary: true,
      summarized_message_count: 8,
      retained_message_count: 2,
      estimated_tokens_before: 10000,
      target_budget: 6000,
      strategy: 'rolling-deterministic-summary-plus-recent-turns',
      updated_at: 1700000000300,
    }))
    expect(preview.sections).toEqual(expect.objectContaining({
      goals: ['Build portability'],
      constraints: ['Keep it local'],
      filesTouched: ['src/main/conversation-handlers.ts'],
      commandsRun: ['npm run typecheck'],
      nextActions: ['Add preview'],
    }))
    expect(directPreview.has_summary).toBe(true)
  })

  it('prepares and saves an editable manual compression summary', async () => {
    if (!state.db) throw new Error('Database not initialized')
    seedConversation(state.db)
    const insertMessage = state.db.prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
    )
    for (let index = 0; index < 8; index += 1) {
      insertMessage.run(
        `manual-${index}`,
        'conv-1',
        index % 2 === 0 ? 'user' : 'assistant',
        `Implement manual compression step ${index} in src/renderer/components/ContextInspector.tsx`,
        1700000000100 + index,
      )
    }

    const draft = await invoke<ConversationCompressionDraft>('conversation:prepare-compression-summary', 'conv-1')
    const directDraft = prepareConversationCompressionSummary(state.db, 'conv-1')

    expect(draft).toEqual(expect.objectContaining({
      conversation_id: 'conv-1',
      summarized_message_count: 6,
      retained_message_count: 4,
      omitted_message_count: 0,
      strategy: 'manual-structured-summary-plus-recent-turns',
    }))
    expect(draft.sections.goals.length).toBeGreaterThan(0)
    expect(directDraft.summarized_message_count).toBe(draft.summarized_message_count)

    const preview = await invoke<ConversationCompressionPreview>('conversation:save-compression-summary', {
      conversationId: 'conv-1',
      summarizedMessageCount: draft.summarized_message_count,
      retainedMessageCount: draft.retained_message_count,
      estimatedTokensBefore: draft.estimated_tokens_before,
      targetBudget: draft.target_budget,
      strategy: draft.strategy,
      sections: {
        ...draft.sections,
        nextActions: ['Continue with manual compression tests'],
      },
    })
    const directPreview = saveConversationCompressionSummary(state.db, {
      conversationId: 'conv-1',
      summarizedMessageCount: draft.summarized_message_count,
      retainedMessageCount: draft.retained_message_count,
      estimatedTokensBefore: draft.estimated_tokens_before,
      targetBudget: draft.target_budget,
      strategy: draft.strategy,
      sections: {
        ...draft.sections,
        nextActions: ['Persist edited summary'],
      },
    })

    expect(preview).toEqual(expect.objectContaining({
      conversation_id: 'conv-1',
      has_summary: true,
      summarized_message_count: draft.summarized_message_count,
      retained_message_count: draft.retained_message_count,
      strategy: 'manual-structured-summary-plus-recent-turns',
    }))
    expect(preview.sections?.nextActions).toEqual(['Continue with manual compression tests'])
    expect(directPreview.sections?.nextActions).toEqual(['Persist edited summary'])
  })

  it('imports an exported conversation as a new conversation', () => {
    if (!state.db) throw new Error('Database not initialized')
    seedConversation(state.db)
    const exported = buildConversationExport(state.db, 'conv-1')

    const result = importConversationExport(state.db, exported)
    const messages = state.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
      .all(result.conversation.id) as MessageRow[]

    expect(result).toEqual(expect.objectContaining({
      message_count: 2,
      imported_into_existing: false,
    }))
    expect(result.conversation.id).not.toBe('conv-1')
    expect(result.conversation.title).toBe('Imported: Portable Chat')
    expect(result.conversation.project_id).toBe('project-1')
    expect(result.conversation.agent_id).toBe('agent-1')
    expect(messages.map((message) => message.role)).toEqual(['user', 'tool-call'])
    expect(messages[0]).toEqual(expect.objectContaining({
      content: 'Review this file',
      model: 'gpt-5.5',
      is_edited: 1,
      previous_content: 'Review',
      timestamp: 1700000000002,
    }))
  })

  it('imports an exported conversation into an existing conversation', async () => {
    if (!state.db) throw new Error('Database not initialized')
    seedConversation(state.db)
    const exported = buildConversationExport(state.db, 'conv-1')
    state.db.prepare(
      'INSERT INTO conversations (id, agent_id, project_id, title, model, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('target-1', null, null, 'Target Chat', null, 0, 1700000000100, 1700000000100)
    state.db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
    ).run('existing-msg', 'target-1', 'user', 'Existing message', 1700000000101)

    const result = importConversationExport(state.db, exported, { targetConversationId: 'target-1' })
    const messages = state.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
      .all('target-1') as MessageRow[]

    expect(result).toEqual(expect.objectContaining({
      conversation: expect.objectContaining({ id: 'target-1', title: 'Target Chat' }),
      message_count: 2,
      imported_into_existing: true,
    }))
    expect(messages.map((message) => message.content)).toEqual(['Existing message', 'Review this file', exported.messages[1].content])
    expect(messages[1].timestamp).toBeGreaterThan(1700000000101)
    expect(JSON.parse(messages[1].context_snapshot ?? '{}')).toEqual(expect.objectContaining({
      nexyImport: expect.objectContaining({
        originalMessageId: 'msg-1',
        originalTimestamp: 1700000000002,
        timestampShifted: true,
      }),
    }))

    const importedViaHandler = await invoke<ConversationImportResult | null>('conversation:import-json', { targetConversationId: 'target-1' })
    expect(importedViaHandler).toBeNull()
  })

  it('forks a conversation onto a target model and agent', async () => {
    if (!state.db) throw new Error('Database not initialized')
    seedConversation(state.db)
    state.db.prepare(
      'INSERT INTO agents (id, config_json, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('agent-2', JSON.stringify({ name: 'Reviewer', icon: 'R', backend: 'claude-cli', cliModel: 'claude-sonnet-4-6' }), 0, 1700000000200, 1700000000200)

    const result = await invoke<ConversationForkResult>('conversation:fork', 'conv-1', {
      model: 'claude-sonnet-4-6',
      agentId: 'agent-2',
    })
    const messages = state.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
      .all(result.conversation.id) as MessageRow[]

    expect(result).toEqual(expect.objectContaining({
      message_count: 1,
      rewritten_message_count: 0,
      omitted_message_count: 1,
      conversation: expect.objectContaining({
        title: 'Continued: Portable Chat',
        model: 'claude-sonnet-4-6',
        agent_id: 'agent-2',
        project_id: 'project-1',
      }),
    }))
    expect(result.conversation.id).not.toBe('conv-1')
    expect(messages[0].content).toContain('Review this file')
    expect(messages[0].id).not.toBe('msg-1')
    expect(messages[0].attachments).toContain('notes.txt')
    expect(JSON.parse(messages[0].context_snapshot ?? '{}')).toEqual(expect.objectContaining({
      nexyFork: expect.objectContaining({
        sourceConversationId: 'conv-1',
        sourceMessageId: 'msg-1',
        compatibilityRewrites: [],
      }),
    }))

    const directResult = forkConversation(state.db, 'conv-1', { model: 'default', agentId: null })
    expect(directResult).toEqual(expect.objectContaining({
      rewritten_message_count: 0,
      omitted_message_count: 1,
      conversation: expect.objectContaining({ model: null, agent_id: null }),
    }))
  })

  it('forks a conversation into a different project or no project', () => {
    if (!state.db) throw new Error('Database not initialized')
    seedConversation(state.db)
    state.db.prepare(
      'INSERT INTO projects (id, name, color, default_model, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('project-2', 'Project Two', 'green', null, '{}', 1700000000300, 1700000000300)

    const moved = forkConversation(state.db, 'conv-1', { projectId: 'project-2', agentId: null })
    expect(moved.conversation.project_id).toBe('project-2')

    const standalone = forkConversation(state.db, 'conv-1', { projectId: null, agentId: null })
    expect(standalone.conversation.project_id).toBeNull()

    expect(() => forkConversation(state.db!, 'conv-1', { projectId: 'missing-project', agentId: null }))
      .toThrow(/Target project not found/)
  })

  it('rejects fork model choices that do not match the selected backend', () => {
    if (!state.db) throw new Error('Database not initialized')
    const db = state.db
    seedConversation(db)
    db.prepare(
      'INSERT INTO agents (id, config_json, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('agent-claude', JSON.stringify({ name: 'Claude', backend: 'claude-cli' }), 0, 1700000000200, 1700000000200)
    db.prepare(
      'INSERT INTO agents (id, config_json, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('agent-hermes', JSON.stringify({ name: 'Hermes', backend: 'hermes-cli' }), 0, 1700000000200, 1700000000200)

    expect(() => forkConversation(db, 'conv-1', {
      model: 'gpt-5.5',
      agentId: 'agent-claude',
    })).toThrow(/not available for claude-cli/)

    expect(() => forkConversation(db, 'conv-1', {
      model: 'gpt-5.5',
      agentId: 'agent-hermes',
    })).toThrow(/not available for hermes-cli/)

    const hermesResult = forkConversation(db, 'conv-1', {
      model: 'anthropic/claude-sonnet-4-6',
      agentId: 'agent-hermes',
    })
    expect(hermesResult.conversation).toEqual(expect.objectContaining({
      agent_id: 'agent-hermes',
      model: 'anthropic/claude-sonnet-4-6',
    }))
  })

  it('omits execution traces and preserves attachments when forking', () => {
    if (!state.db) throw new Error('Database not initialized')
    const db = state.db
    seedConversation(db)
    db.prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, attachments, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'msg-team',
      'conv-1',
      'team-activity',
      JSON.stringify({ steps: [{ agentName: 'Reviewer', task: 'Check output', status: 'done', result: 'Looks good' }] }),
      null,
      1700000000004,
    )
    db.prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, attachments, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'msg-attachment',
      'conv-1',
      'user',
      'See attached file',
      JSON.stringify([{ id: 'att-2', name: 'diagram.png', size: 512, type: 'image/png' }]),
      1700000000005,
    )

    const result = forkConversation(db, 'conv-1', { model: 'gpt-5.5', agentId: null })
    const messages = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
      .all(result.conversation.id) as MessageRow[]

    expect(result.rewritten_message_count).toBe(0)
    expect(result.omitted_message_count).toBe(2)
    expect(messages).toHaveLength(2)
    expect(messages.some((message) => message.role === 'tool-call' || message.role === 'team-activity')).toBe(false)
    const attachmentMessage = messages.find((message) => message.content === 'See attached file')
    expect(attachmentMessage).toEqual(expect.objectContaining({
      role: 'user',
      attachments: expect.stringContaining('diagram.png'),
    }))
    expect(JSON.parse(attachmentMessage?.context_snapshot ?? '{}').nexyFork.compatibilityRewrites).toEqual([])
  })

  it('repairs repeated forks by pruning legacy portable execution summaries', () => {
    if (!state.db) throw new Error('Database not initialized')
    const db = state.db
    seedConversation(db)
    db.prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'legacy-portable-tool',
      'conv-1',
      'system',
      '[Portable tool-call summary]\nTool: shell\nResult: an entire file dump',
      1700000000004,
    )
    db.prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'assistant-after-tool',
      'conv-1',
      'assistant',
      'The requested change is complete.',
      1700000000005,
    )

    const first = forkConversation(db, 'conv-1', { model: 'gpt-5.5', agentId: null })
    const second = forkConversation(db, first.conversation.id, { model: 'gpt-5.5', agentId: null })
    const messages = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
      .all(second.conversation.id) as MessageRow[]

    expect(first.omitted_message_count).toBe(2)
    expect(second.omitted_message_count).toBe(0)
    expect(second.conversation.title).toBe('Continued: Portable Chat')
    expect(messages.map((message) => message.content)).toEqual([
      'Review this file',
      'The requested change is complete.',
    ])
    expect(messages.some((message) => message.content.includes('[Portable tool-call summary]'))).toBe(false)

    const exported = buildConversationExport(db, 'conv-1')
    expect(exported.messages.some((message) => message.content.includes('[Portable tool-call summary]'))).toBe(false)
  })

  it('compresses fork context when the target model context window is smaller than the conversation', () => {
    if (!state.db) throw new Error('Database not initialized')
    const db = state.db
    seedConversation(db)
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'model_catalog_snapshot',
      JSON.stringify([{ id: 'tiny-local', name: 'Tiny Local', vendor: 'Local', capabilities: ['chat'], contextWindow: 200 }]),
    )
    const insertMessage = db.prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
    )
    for (let index = 0; index < 10; index += 1) {
      insertMessage.run(
        `long-${index}`,
        'conv-1',
        index % 2 === 0 ? 'user' : 'assistant',
        `Long message ${index} ${'context '.repeat(140)}`,
        1700000000100 + index,
      )
    }

    const result = forkConversation(db, 'conv-1', { model: 'tiny-local', agentId: null })
    const messages = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
      .all(result.conversation.id) as MessageRow[]

    expect(result.compressed_message_count).toBeGreaterThan(0)
    expect(result.message_count).toBeLessThan(12)
    expect(messages[0]).toEqual(expect.objectContaining({
      role: 'system',
      model: 'tiny-local',
    }))
    expect(messages[0].content).toContain('[Compressed continuation context]')
    expect(messages[0].content).toContain('Target context window: 200 tokens')
    const summarySnapshot = JSON.parse(messages[0].context_snapshot ?? '{}')
    expect(summarySnapshot.nexyCompression).toEqual(expect.objectContaining({
      sourceConversationId: 'conv-1',
      targetModel: 'tiny-local',
      targetContextWindow: 200,
      compressedMessageCount: result.compressed_message_count,
      strategy: 'deterministic-summary-plus-recent-turns',
    }))
    const retainedSnapshot = JSON.parse(messages[1].context_snapshot ?? '{}')
    expect(retainedSnapshot.nexyCompression).toEqual(expect.objectContaining({
      retainedFromCompression: true,
    }))
  })
})

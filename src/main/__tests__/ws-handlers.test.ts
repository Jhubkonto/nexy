import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConversationRating,
  ConversationRatingListItem,
  ConversationRatingStats,
  ProjectEditSession,
  ProjectTouchedFile,
  ProjectFileDiff,
} from '../../shared/types'

const state = vi.hoisted(() => {
  let commandHandler: ((command: string, data: Record<string, unknown>, reply: (event: unknown) => void) => void) | null = null
  const replies: unknown[] = []
  const runs: Array<{ sql: string; args: unknown[] }> = []
  let promptRows: Array<Record<string, unknown>> = []
  const abortActiveStream = vi.fn()
  const dispatchChatSend = vi.fn()
  const webContentsSend = vi.fn()
  const broadcastToMobile = vi.fn()
  const approveConversationApprovals = vi.fn()
  const listProjectAuditSessions = vi.fn<(projectId?: string | null) => ProjectEditSession[]>(() => [])
  const listProjectAuditFiles = vi.fn<(sessionId: string) => ProjectTouchedFile[]>(() => [])
  const getProjectAuditDiff = vi.fn<(sessionId: string, relativePath: string) => ProjectFileDiff | null>(() => null)
  let projectConfigJson: string | null = null
  let projectSources: Array<Record<string, unknown>> = []
  const runAutomatedWorkflowGeneratorChatForAndroid = vi.fn()
  const getAutomatedWorkflowGeneratorModel = vi.fn(() => 'gpt-5.5')
  const setAutomatedWorkflowGeneratorModel = vi.fn()
  const submitRatingForConversation = vi.fn<(conversationId: string, rating: number, note?: string | null) => ConversationRating>()
  const getRatingForConversation = vi.fn<(conversationId: string) => ConversationRating | null>()
  const deleteRatingForConversation = vi.fn<(conversationId: string) => boolean>()
  const listRatings = vi.fn<() => ConversationRatingListItem[]>(() => [])
  const getRatingStats = vi.fn<() => ConversationRatingStats>(() => ({
    averageByAgent: [], averageByModel: [], averageBySkill: [], averageByServer: [], averageByProject: [], trend: [],
  }))
  const readFileForRemote = vi.fn((): {
    path: string
    content: string
    truncated: boolean
    mimeType?: string
    encoding?: 'utf8' | 'base64'
    error?: string
  } => ({ path: '', content: '', truncated: false }))
  const readImageFileForRemote = vi.fn(() => ({
    path: 'C:/project/photo.png', content: 'encoded', truncated: false, mimeType: 'image/png', encoding: 'base64' as const,
  }))
  const isRemoteImagePath = vi.fn((path: string) => /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(path))

  return {
    get commandHandler() { return commandHandler },
    set commandHandler(handler) { commandHandler = handler },
    replies,
    runs,
    abortActiveStream,
    dispatchChatSend,
    webContentsSend,
    broadcastToMobile,
    approveConversationApprovals,
    listProjectAuditSessions,
    listProjectAuditFiles,
    getProjectAuditDiff,
    runAutomatedWorkflowGeneratorChatForAndroid,
    getAutomatedWorkflowGeneratorModel,
    setAutomatedWorkflowGeneratorModel,
    submitRatingForConversation,
    getRatingForConversation,
    deleteRatingForConversation,
    listRatings,
    getRatingStats,
    readFileForRemote,
    readImageFileForRemote,
    isRemoteImagePath,
    get projectConfigJson() { return projectConfigJson },
    set projectConfigJson(value) { projectConfigJson = value },
    get projectSources() { return projectSources },
    set projectSources(value) { projectSources = value },
    get promptRows() { return promptRows },
    set promptRows(value) { promptRows = value },
  }
})

vi.mock('../safe-handle', () => ({
  safeHandle: vi.fn(),
}))

vi.mock('../database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      all: (..._args: unknown[]) => {
        if (sql.includes('FROM project_sources')) return state.projectSources
        if (sql.includes('FROM conversations c')) return [{ id: 'conv-1', title: 'Chat 1' }]
        if (sql.includes('FROM projects p')) return [{ id: 'proj-1', name: 'Project 1' }]
        if (sql.includes('FROM messages')) return [{ id: 'msg-1', role: 'user', content: 'hello', timestamp: 1 }]
        if (sql.includes('FROM agents')) return [{ id: 'agent-1', name: 'Codex', icon: 'C', backend: 'codex-cli', cli_model: 'gpt-5.5' }]
        if (sql.includes('FROM prompt_library_entries')) return state.promptRows
        return []
      },
      get: (..._args: unknown[]) => {
        if (sql.includes('SELECT config_json FROM projects WHERE id = ?')) return { config_json: state.projectConfigJson }
        if (sql.includes('FROM agents')) return { backend: 'codex-cli' }
        return undefined
      },
      run: (...args: unknown[]) => {
        state.runs.push({ sql, args })
        return { changes: 1 }
      },
    }),
  }),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: vi.fn(() => false), webContents: { send: state.webContentsSend } }],
  },
}))

vi.mock('../providers', () => ({
  abortActiveStream: state.abortActiveStream,
  PROVIDERS: [
    { name: 'openai', label: 'OpenAI', models: ['gpt-5-mini'] },
    { name: 'anthropic', label: 'Anthropic', models: ['claude-haiku-4.5'] },
  ],
  isProviderConfigured: vi.fn((provider: string) => provider === 'openai'),
  getProviderModelIds: vi.fn((provider: { models: string[] }) => provider.models),
}))

vi.mock('../model-catalog', () => ({
  getCachedCatalog: vi.fn(() => [
    { id: 'gpt-5-mini', name: 'GPT-5 mini', vendor: 'OpenAI' },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', vendor: 'Anthropic' },
  ]),
}))

vi.mock('../chat-handlers', () => ({
  dispatchChatSend: state.dispatchChatSend,
}))

vi.mock('../project-audit', () => ({
  listProjectAuditSessions: state.listProjectAuditSessions,
  listProjectAuditFiles: state.listProjectAuditFiles,
  getProjectAuditDiff: state.getProjectAuditDiff,
}))

vi.mock('../file-handlers', () => ({
  listDirectoryEntriesForRemote: vi.fn(),
  readFileForRemote: state.readFileForRemote,
  readImageFileForRemote: state.readImageFileForRemote,
  isRemoteImagePath: state.isRemoteImagePath,
  getFsStartRoots: vi.fn(() => ({ home: 'C:/Users/test', recents: [] })),
  getFsAuthorizedRoots: vi.fn(() => ['C:/project']),
}))

vi.mock('../cli-detection', () => ({
  getCliModels: vi.fn((backend: string) => backend === 'codex-cli'
    ? [{ id: 'gpt-5.5', label: 'GPT-5.5' }]
    : [{ id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' }]
  ),
}))

vi.mock('../cli-adapters/claude-model-probe', () => ({
  getClaudeCliModelChoices: vi.fn(() => [{ id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', source: 'cli-menu-confirmed' }]),
  isClaudeCliModelOrCandidate: vi.fn((model: string) => model === 'claude-sonnet-4.6'),
}))

vi.mock('../auth', () => ({
  retrieveAuthMode: vi.fn(() => 'byok'),
}))

vi.mock('../android-handlers', () => ({
  getAndroidUpdateManifest: vi.fn(),
}))

vi.mock('../cli-adapters/claude', () => ({
  ClaudeAdapter: { isAvailable: vi.fn(() => false) },
}))

vi.mock('../cli-adapters/codex', () => ({
  CodexAdapter: { isAvailable: vi.fn(() => false) },
}))

vi.mock('../cli-adapters/hermes', () => ({
  HermesAdapter: { isAvailable: vi.fn(() => false) },
}))

vi.mock('../ws-server', () => ({
  startWsServer: vi.fn(),
  stopWsServer: vi.fn(),
  getWsStatus: vi.fn(() => ({ enabled: false })),
  getQrDataUrl: vi.fn(),
  regenerateToken: vi.fn(),
  broadcastToMobile: state.broadcastToMobile,
  setWsCommandHandler: vi.fn((handler) => { state.commandHandler = handler }),
}))

vi.mock('../scheduler-engine', () => ({
  dbListTasks: vi.fn(() => []),
  dbGetTask: vi.fn(() => null),
  dbCreateTask: vi.fn((input: Record<string, unknown>) => ({ id: 'task-1', ...input })),
  dbUpdateTask: vi.fn(() => null),
  dbDeleteTask: vi.fn(),
  dbSetTaskEnabled: vi.fn(() => null),
  dbListRuns: vi.fn(() => []),
  schedulerEngine: {
    scheduleTask: vi.fn(),
    unscheduleTask: vi.fn(),
    triggerRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
  },
}))

vi.mock('../automated-workflow-generator', () => ({
  runAutomatedWorkflowGeneratorChatForAndroid: state.runAutomatedWorkflowGeneratorChatForAndroid,
  getAutomatedWorkflowGeneratorModel: state.getAutomatedWorkflowGeneratorModel,
  setAutomatedWorkflowGeneratorModel: state.setAutomatedWorkflowGeneratorModel,
  normalizeAutomatedWorkflowSpec: (raw: Record<string, unknown>) => raw,
}))

vi.mock('../rating-handlers', () => ({
  submitRatingForConversation: state.submitRatingForConversation,
  getRatingForConversation: state.getRatingForConversation,
  deleteRatingForConversation: state.deleteRatingForConversation,
  listRatings: state.listRatings,
  getRatingStats: state.getRatingStats,
}))

import {
  decodeMobileAttachmentDataUrl,
  registerWsHandlers,
  registerApprovalResolver,
  registerConversationApprovalEscalator,
} from '../ws-handlers'
import { retrieveAuthMode } from '../auth'
import { getAndroidUpdateManifest } from '../android-handlers'
import { isProviderConfigured } from '../providers'
import { ClaudeAdapter } from '../cli-adapters/claude'
import { CodexAdapter } from '../cli-adapters/codex'
import { HermesAdapter } from '../cli-adapters/hermes'

function sendCommand(command: string, data: Record<string, unknown> = {}) {
  if (!state.commandHandler) throw new Error('WS command handler not registered')
  const reply = vi.fn((event: unknown) => state.replies.push(event))
  state.commandHandler(command, data, reply)
  return reply
}

describe('ws handlers', () => {
  it('validates mobile binary attachment data URLs before materializing them', () => {
    const decoded = decodeMobileAttachmentDataUrl('data:application/pdf;base64,JVBERg==')
    expect(decoded?.mimeType).toBe('application/pdf')
    expect(decoded?.bytes.toString('utf8')).toBe('%PDF')
    expect(decodeMobileAttachmentDataUrl('https://example.com/file.pdf')).toBeNull()
    expect(decodeMobileAttachmentDataUrl('data:application/pdf,not-base64')).toBeNull()
  })

  it('returns a compatibility tombstone for retired Conversation Mode commands', () => {
    const reply = sendCommand('conversation-mode:create', { projectId: 'project-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'conversation-mode:error',
      data: {
        code: 'feature-removed',
        message: 'Talk to Project has been removed. Use the microphone in standard chat.',
      },
    })
  })

  it('returns a compatibility tombstone for retired Code Changes commands', () => {
    const reply = sendCommand('code-change:submit-description', { projectId: 'project-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'code-change:removed',
      data: {
        code: 'feature-removed',
        message: 'Code Changes has been removed. Use a normal project conversation or the Git code panel.',
      },
    })
  })

  it('routes the dedicated image command to the binary reader', () => {
    const reply = sendCommand('fs:read-image', { path: 'C:/project/photo.png', requestId: 'image-1' })

    expect(state.readImageFileForRemote).toHaveBeenCalledWith('C:/project/photo.png', ['C:/project'])
    expect(state.readFileForRemote).not.toHaveBeenCalled()
    expect(reply).toHaveBeenCalledWith({
      event: 'fs:file-content',
      data: {
        path: 'C:/project/photo.png',
        content: 'encoded',
        truncated: false,
        mimeType: 'image/png',
        encoding: 'base64',
        requestId: 'image-1',
      },
    })
  })

  it('keeps the generic file command binary-safe for legacy image viewers', () => {
    state.readFileForRemote.mockReturnValue({
      path: 'C:/project/photo.png',
      content: 'encoded',
      truncated: false,
      mimeType: 'image/png',
      encoding: 'base64',
    })
    const reply = sendCommand('fs:read-file', { path: 'C:/project/photo.png', requestId: 'legacy-image-1' })

    expect(state.readFileForRemote).toHaveBeenCalledWith('C:/project/photo.png', ['C:/project'])
    expect(reply).toHaveBeenCalledWith({
      event: 'fs:file-content',
      data: {
        path: 'C:/project/photo.png',
        content: 'encoded',
        truncated: false,
        mimeType: 'image/png',
        encoding: 'base64',
        requestId: 'legacy-image-1',
      },
    })
  })

  it('returns opaque Project Peek source identities without desktop paths', () => {
    state.projectSources = [{
      id: 'source-1', project_id: 'proj-1', label: 'Private workspace', kind: 'workspace-root',
      local_path: 'C:/private/workspace', enabled: 1, is_primary: 1, created_at: 1, updated_at: 1,
    }]

    const reply = sendCommand('project-peek:get-sources', { projectId: 'proj-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'project-peek:sources',
      data: { projectId: 'proj-1', sources: [{ id: 'source-1', projectId: 'proj-1', label: 'Private workspace', enabled: true, isPrimary: true }] },
    })
  })

  beforeEach(() => {
    state.replies.length = 0
    state.runs.length = 0
    state.readFileForRemote.mockReset()
    state.readImageFileForRemote.mockReset()
    state.readImageFileForRemote.mockReturnValue({
      path: 'C:/project/photo.png', content: 'encoded', truncated: false, mimeType: 'image/png', encoding: 'base64',
    })
    state.isRemoteImagePath.mockClear()
    state.abortActiveStream.mockClear()
    state.dispatchChatSend.mockClear()
    state.dispatchChatSend.mockResolvedValue(undefined)
    state.webContentsSend.mockClear()
    state.broadcastToMobile.mockClear()
    state.approveConversationApprovals.mockClear()
    state.projectConfigJson = null
    state.projectSources = []
    state.promptRows = []
    state.listProjectAuditSessions.mockReset()
    state.listProjectAuditSessions.mockReturnValue([])
    state.listProjectAuditFiles.mockReset()
    state.listProjectAuditFiles.mockReturnValue([])
    state.getProjectAuditDiff.mockReset()
    state.getProjectAuditDiff.mockReturnValue(null)
    state.runAutomatedWorkflowGeneratorChatForAndroid.mockReset()
    state.runAutomatedWorkflowGeneratorChatForAndroid.mockResolvedValue(undefined)
    state.getAutomatedWorkflowGeneratorModel.mockReset()
    state.getAutomatedWorkflowGeneratorModel.mockReturnValue('gpt-5.5')
    state.setAutomatedWorkflowGeneratorModel.mockReset()
    state.submitRatingForConversation.mockReset()
    state.getRatingForConversation.mockReset()
    state.deleteRatingForConversation.mockReset()
    state.listRatings.mockReset()
    state.listRatings.mockReturnValue([])
    state.getRatingStats.mockReset()
    state.getRatingStats.mockReturnValue({
      averageByAgent: [], averageByModel: [], averageBySkill: [], averageByServer: [], averageByProject: [], trend: [],
    })
    vi.mocked(retrieveAuthMode).mockReturnValue('byok')
    vi.mocked(getAndroidUpdateManifest).mockResolvedValue(null)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(false)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(false)
    vi.mocked(HermesAdapter.isAvailable).mockReturnValue(false)
    registerWsHandlers()
    registerConversationApprovalEscalator(state.approveConversationApprovals)
  })

  it('replies to the requesting client for conversation lists', () => {
    const reply = sendCommand('conversation:list')

    expect(reply).toHaveBeenCalledWith({
      event: 'conversation:list',
      data: [{ id: 'conv-1', title: 'Chat 1' }],
    })
  })

  it('lists global prompts only without a project and includes the matching project', () => {
    state.promptRows = [
      { id: 'global-1', title: 'Global', body: 'Global body', description: '', category: 'Custom', tags: '[]', scope: 'global', project_id: null, created_at: 1, updated_at: 1 },
      { id: 'project-a-1', title: 'Project A', body: 'A body', description: '', category: 'Custom', tags: '[]', scope: 'project', project_id: 'project-a', created_at: 2, updated_at: 2 },
      { id: 'project-b-1', title: 'Project B', body: 'B body', description: '', category: 'Custom', tags: '[]', scope: 'project', project_id: 'project-b', created_at: 3, updated_at: 3 },
    ]

    const globalReply = sendCommand('prompt:list')
    const projectReply = sendCommand('prompt:list', { projectId: ' project-a ' })

    expect(globalReply).toHaveBeenCalledWith({
      event: 'prompt:list',
      data: { entries: [expect.objectContaining({ title: 'Global' })] },
    })
    expect(projectReply).toHaveBeenCalledWith({
      event: 'prompt:list',
      data: { entries: [
        expect.objectContaining({ title: 'Global' }),
        expect.objectContaining({ title: 'Project A' }),
      ] },
    })
  })

  it('replies with the curated MCP catalog for companion clients', () => {
    const reply = sendCommand('mcp:catalog')

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      event: 'mcp:catalog',
      data: expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ id: 'github', requiredEnv: expect.arrayContaining([
            expect.objectContaining({ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', secret: true }),
          ]) }),
        ]),
      }),
    }))
  })

  it('replies to the requesting client for message history', () => {
    const reply = sendCommand('conversation:get-messages', { conversationId: 'conv-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'conversation:messages',
      data: {
        conversationId: 'conv-1',
        messages: [{ id: 'msg-1', role: 'user', content: 'hello', timestamp: 1 }],
      },
    })
  })

  it('streams bounded history with correlation and supports not-modified refreshes', () => {
    const firstReply = sendCommand('conversation:get-messages', {
      conversationId: 'conv-1',
      limit: 20,
      requestId: 'history-1',
      responseMode: 'chunked-v2',
    })

    expect(firstReply.mock.calls.map(call => (call[0] as { event: string }).event)).toEqual([
      'conversation:history-start',
      'conversation:history-chunk',
      'conversation:history-complete',
    ])
    const complete = firstReply.mock.calls[2][0] as {
      data: { historyVersion: string }
    }

    const unchangedReply = sendCommand('conversation:get-messages', {
      conversationId: 'conv-1',
      limit: 20,
      requestId: 'history-2',
      responseMode: 'chunked-v2',
      historyVersion: complete.data.historyVersion,
    })
    expect(unchangedReply).toHaveBeenCalledOnce()
    expect(unchangedReply).toHaveBeenCalledWith({
      event: 'conversation:history-not-modified',
      data: expect.objectContaining({
        conversationId: 'conv-1',
        requestId: 'history-2',
        historyVersion: complete.data.historyVersion,
      }),
    })
  })

  it('replies to the requesting client when creating a conversation', () => {
    const reply = sendCommand('conversation:create', { agentId: 'agent-1', projectId: 'proj-1' })

    expect(state.runs).toHaveLength(1)
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      event: 'conversation:created',
      data: expect.objectContaining({ agentId: 'agent-1', projectId: 'proj-1', title: 'New Chat' }),
    }))
  })

  it('does not send request replies for approval and stop commands', () => {
    const resolve = vi.fn()
    registerApprovalResolver(resolve)

    const approvalReply = sendCommand('tool:approve', { requestId: 'req-1' })
    const stopReply = sendCommand('agent:stop', { conversationId: 'conv-1' })

    expect(resolve).toHaveBeenCalledWith('req-1', true)
    expect(state.abortActiveStream).toHaveBeenCalledWith('conv-1')
    expect(approvalReply).not.toHaveBeenCalled()
    expect(stopReply).not.toHaveBeenCalled()
  })

  it('dispatches remote chat without sending a request reply', () => {
    const reply = sendCommand('chat:send-message', {
      conversationId: 'conv-1',
      content: 'hello',
      agentId: 'agent-1',
      projectId: 'project-1',
    })

    expect(state.webContentsSend).toHaveBeenCalledWith('chat:remote-message', { conversationId: 'conv-1', content: 'hello', images: undefined })
    expect(state.dispatchChatSend).toHaveBeenCalledWith(
      expect.anything(),
      'conv-1',
      'hello',
      expect.objectContaining({ agentId: 'agent-1', projectId: 'project-1' }),
    )
    expect(reply).not.toHaveBeenCalled()
  })

  it('dispatches mobile image attachments to the desktop chat path', () => {
    const images = [{ id: 'img-1', name: 'photo.png', dataUrl: 'data:image/png;base64,abc123' }]
    const reply = sendCommand('chat:send-message', {
      conversationId: 'conv-1',
      content: '',
      images,
    })

    expect(state.webContentsSend).toHaveBeenCalledWith('chat:remote-message', { conversationId: 'conv-1', content: '', images })
    expect(state.dispatchChatSend).toHaveBeenCalledWith(
      expect.anything(),
      'conv-1',
      '',
      expect.objectContaining({ images }),
    )
    expect(reply).not.toHaveBeenCalled()
  })

  it('replies with configured BYOK provider models when no mobile backend is provided', () => {
    const reply = sendCommand('model:list')

    expect(reply).toHaveBeenCalledWith({
      event: 'model:list',
      data: {
        source: { type: 'provider', label: 'OpenAI' },
        models: [
          { id: 'default', label: 'Default model' },
          { id: 'gpt-5-mini', label: 'GPT-5 mini', vendor: 'OpenAI' },
        ],
      },
    })
  })

  it('falls back to installed Claude CLI models when no BYOK backend is active', () => {
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(isProviderConfigured).mockReturnValue(false)

    const reply = sendCommand('model:list')

    expect(reply).toHaveBeenCalledWith({
      event: 'model:list',
      data: {
        source: { type: 'provider', label: 'Claude CLI' },
        models: [
          { id: 'default', label: 'Default model' },
          { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', vendor: 'Claude CLI', isCliSourced: true, backend: 'claude-cli' },
        ],
      },
    })
  })

  it('replies with Codex CLI models for Codex-backed mobile chats', () => {
    const reply = sendCommand('model:list', { backend: 'codex-cli' })

    expect(reply).toHaveBeenCalledWith({
      event: 'model:list',
      data: {
        source: { type: 'cli', label: 'Codex CLI models', backend: 'codex-cli' },
        models: [
          { id: 'default', label: 'Default model' },
          { id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'Codex CLI', isCliSourced: true, backend: 'codex-cli' },
        ],
      },
    })
  })

  it('replies with CLI models using the mobile chat agent backend', () => {
    const reply = sendCommand('model:list', { agentId: 'agent-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'model:list',
      data: {
        source: { type: 'cli', label: 'Codex CLI models', backend: 'codex-cli' },
        models: [
          { id: 'default', label: 'Default model' },
          { id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'Codex CLI', isCliSourced: true, backend: 'codex-cli' },
        ],
      },
    })
  })

  it('replies with Claude CLI models for Claude-backed mobile chats', () => {
    const reply = sendCommand('model:list', { backend: 'claude-cli' })

    expect(reply).toHaveBeenCalledWith({
      event: 'model:list',
      data: {
        source: { type: 'cli', label: 'Claude CLI models', backend: 'claude-cli' },
        models: [
          { id: 'default', label: 'Default model' },
          { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', vendor: 'Claude CLI', isCliSourced: true, backend: 'claude-cli' },
        ],
      },
    })
  })

  it('marks CLI-sourced models with isCliSourced so standalone clients can filter them out', () => {
    const reply = sendCommand('model:list', { backend: 'claude-cli' })
    const models = (reply.mock.calls[0][0] as { data: { models: Array<{ id: string; isCliSourced?: boolean }> } }).data.models
    const cliModel = models.find((m) => m.id === 'claude-sonnet-4.6')
    const defaultModel = models.find((m) => m.id === 'default')

    expect(cliModel?.isCliSourced).toBe(true)
    expect(defaultModel?.isCliSourced).toBeUndefined()
  })

  it('updates a conversation model over mobile websocket', () => {
    const reply = sendCommand('conversation:set-model', { conversationId: 'conv-1', model: 'gpt-5.5' })

    expect(state.runs[0]).toEqual(expect.objectContaining({
      sql: expect.stringContaining('UPDATE conversations SET model'),
      args: ['gpt-5.5', expect.any(Number), 'conv-1'],
    }))
    expect(reply).toHaveBeenCalledWith({
      event: 'conversation:model-updated',
      data: { conversationId: 'conv-1', model: 'gpt-5.5' },
    })
  })

  it('updates a conversation agentic override over mobile websocket', () => {
    sendCommand('conversation:set-mode', {
      conversationId: 'conv-1',
      agenticModeOverride: true,
    })

    expect(state.runs[0]).toEqual(expect.objectContaining({
      sql: expect.stringContaining('agentic_mode_override = ?'),
      args: [null, null, 1, null, null, null, expect.any(Number), 'conv-1'],
    }))
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'conversation:mode-updated',
      data: expect.objectContaining({
        conversationId: 'conv-1',
        agenticModeOverride: 1,
      }),
    })
  })

  it('releases an in-flight approval when Android switches the conversation to Claude bypass', () => {
    sendCommand('conversation:set-mode', {
      conversationId: 'conv-1',
      cliModeOverride: 'bypassPermissions',
    })

    expect(state.approveConversationApprovals).toHaveBeenCalledWith('conv-1')
  })

  it('serves the Android update manifest over the paired websocket', async () => {
    const manifest = {
      versionCode: 42,
      versionName: '1.2.3',
      commitSha: 'abc123',
      changelog: '',
      checksum: 'sha256',
      artifactUrl: 'http://192.168.1.100:12345/android/app-release.apk',
      publishedAt: 123456,
    }
    vi.mocked(getAndroidUpdateManifest).mockResolvedValue(manifest)

    const reply = sendCommand('android:update-manifest')
    await Promise.resolve()

    expect(reply).toHaveBeenCalledWith({
      event: 'android:update-manifest',
      data: manifest,
    })
  })

  it('returns null when no Android update manifest has been published', async () => {
    vi.mocked(getAndroidUpdateManifest).mockResolvedValue(null)

    const reply = sendCommand('android:update-manifest')
    await Promise.resolve()

    expect(reply).toHaveBeenCalledWith({
      event: 'android:update-manifest',
      data: null,
    })
  })

  it('replies with project audit sessions/files/diffs for mobile consumers', () => {
    state.listProjectAuditSessions.mockReturnValue([
      {
        id: 'session-1',
        projectId: 'proj-1',
        conversationId: null,
        agentId: null,
        title: 'Remote edit fix',
        source: 'remote-edit',
        createdAt: 1,
        updatedAt: 2,
        fileCount: 1,
      },
    ])
    state.listProjectAuditFiles.mockReturnValue([
      {
        id: 'file-1',
        sessionId: 'session-1',
        sourceId: 'source-1',
        sourceLabel: 'Workspace',
        repositoryId: 'repo-1',
        repositoryLabel: 'desktop',
        repositoryAvailable: true,
        relativePath: 'src/example.ts',
        displayPath: 'desktop/src/example.ts',
        status: 'modified',
        lastOperation: 'apply',
        branch: 'main',
        commitHash: null,
        legacyRepositoryUnknown: false,
        firstTouchedAt: 1,
        lastTouchedAt: 2,
        diffAvailable: true,
      },
    ])
    state.getProjectAuditDiff.mockReturnValue({
      relativePath: 'src/example.ts',
      hunks: [],
    })

    const sessionsReply = sendCommand('project-audit:list-sessions', { projectId: 'proj-1' })
    const filesReply = sendCommand('project-audit:list-files', { sessionId: 'session-1' })
    const diffReply = sendCommand('project-audit:get-diff', { sessionId: 'session-1', relativePath: 'src/example.ts' })

    expect(sessionsReply).toHaveBeenCalledWith({
      event: 'project-audit:sessions',
      data: {
        projectId: 'proj-1',
        sessions: expect.arrayContaining([expect.objectContaining({ id: 'session-1' })]),
      },
    })
    expect(filesReply).toHaveBeenCalledWith({
      event: 'project-audit:files',
      data: {
        sessionId: 'session-1',
        files: expect.arrayContaining([expect.objectContaining({ relativePath: 'src/example.ts' })]),
      },
    })
    expect(diffReply).toHaveBeenCalledWith({
      event: 'project-audit:diff',
      data: {
        sessionId: 'session-1',
        fileId: null,
        diff: { relativePath: 'src/example.ts', hunks: [] },
      },
    })
  })

  it('normalizes project:get-config workflow mode for mobile consumers, self-healing the pre-rename value', () => {
    state.projectConfigJson = '{"workflowMode":"manual-delegation","orchestrationEnabled":true}'

    const reply = sendCommand('project:get-config', { id: 'proj-1' })

    expect(reply).toHaveBeenCalledWith({
      event: 'project:config',
      data: {
        id: 'proj-1',
        config: expect.objectContaining({
          workflowMode: 'automated-delegation',
          orchestrationEnabled: false,
        }),
      },
    })
  })

  it('reads and replaces project capabilities for mobile Project Settings', () => {
    state.projectConfigJson = JSON.stringify({
      rootDirectory: 'C:/repo',
      capabilityProfile: { version: 1, skillIds: [], mcp: [{ serverId: 'browser', trust: 'always-ask' }] },
    })

    const readReply = sendCommand('project:get-capabilities', { projectId: 'proj-1' })
    expect(readReply).toHaveBeenCalledWith({
      event: 'project:capabilities',
      data: {
        projectId: 'proj-1',
        profile: { version: 1, skillIds: [], mcp: [{ serverId: 'browser', trust: 'always-ask' }] },
      },
    })

    const saveReply = sendCommand('project:set-capabilities', {
      projectId: 'proj-1',
      profile: { version: 1, skillIds: [], mcp: [] },
    })
    expect(saveReply).toHaveBeenCalledWith({
      event: 'project:capabilities-updated',
      data: { projectId: 'proj-1', profile: { version: 1, skillIds: [], mcp: [] } },
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith(expect.objectContaining({
      event: 'project:config-changed',
      data: expect.objectContaining({ id: 'proj-1' }),
    }))
  })

  it('updates and broadcasts a project color supplied by mobile', () => {
    sendCommand('project:rename', { id: 'proj-1', name: 'Project 1', color: 'purple' })

    expect(state.runs).toContainEqual({
      sql: 'UPDATE projects SET name = ?, color = ?, updated_at = ? WHERE id = ?',
      args: ['Project 1', 'purple', expect.any(Number), 'proj-1'],
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'project:renamed',
      data: { id: 'proj-1', name: 'Project 1', color: 'purple' },
    })
  })

  it('broadcasts normalized workflow config after mobile project:update-config', () => {
    state.projectConfigJson = '{"orchestrationEnabled":true}'

    sendCommand('project:update-config', { id: 'proj-1', workflowMode: 'automated-delegation' })

    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'project:config-updated',
      data: {
        id: 'proj-1',
        config: expect.objectContaining({
          workflowMode: 'automated-delegation',
          orchestrationEnabled: false,
        }),
      },
    })
  })

  it('persists rootDirectory in project config when updated from mobile', () => {
    state.projectConfigJson = '{"instructions":"","orchestrationEnabled":false}'

    sendCommand('project:update-config', { id: 'proj-1', rootDirectory: '/home/user/my-project' })

    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'project:config-updated',
      data: {
        id: 'proj-1',
        config: expect.objectContaining({
          rootDirectory: '/home/user/my-project',
        }),
      },
    })
  })

  it('removes a project repository requested by mobile and returns refreshed sources', async () => {
    state.projectConfigJson = '{"rootDirectory":"C:/workspace"}'

    const reply = sendCommand('project:remove-repository', { id: 'proj-1', repositoryId: 'repo-1' })

    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({
      event: 'project:sources-updated',
      data: {
        id: 'proj-1',
        action: 'remove',
        config: expect.objectContaining({ sources: [], repositories: [] }),
      },
    }))
    expect(state.runs).toContainEqual({
      sql: 'DELETE FROM project_repositories WHERE id = ? AND project_id = ?',
      args: ['repo-1', 'proj-1'],
    })
  })

  it('rescans project sources requested by mobile and returns refreshed sources', async () => {
    state.projectConfigJson = '{"rootDirectory":"C:/workspace"}'

    const reply = sendCommand('project:rescan-sources', { id: 'proj-1' })

    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({
      event: 'project:sources-updated',
      data: {
        id: 'proj-1',
        action: 'rescan',
        config: expect.objectContaining({ sources: [], repositories: [] }),
      },
    }))
  })

  it('starts the automated workflow generator for mobile consumers', () => {
    sendCommand('automated-workflow-generator:start', {
      projectId: 'proj-1',
      messages: [{ role: 'user', content: 'Plan the release' }],
      sessionId: 'mw-1',
    })

    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'automated-workflow-generator:model',
      data: { sessionId: 'mw-1', modelId: 'gpt-5.5' },
    })
    expect(state.runAutomatedWorkflowGeneratorChatForAndroid).toHaveBeenCalledWith(
      'proj-1',
      [{ role: 'user', content: 'Plan the release' }],
      'mw-1',
      undefined,
    )
  })

  it('starts the automated workflow generator for a project-less (standalone) mobile run', () => {
    sendCommand('automated-workflow-generator:start', {
      messages: [{ role: 'user', content: 'Plan a standalone workflow' }],
      sessionId: 'mw-global-1',
    })

    expect(state.runAutomatedWorkflowGeneratorChatForAndroid).toHaveBeenCalledWith(
      null,
      [{ role: 'user', content: 'Plan a standalone workflow' }],
      'mw-global-1',
      undefined,
    )
  })

  it('updates the mobile automated workflow generator model', () => {
    sendCommand('automated-workflow-generator:set-model', { sessionId: 'mw-2', modelId: 'gpt-5.4-mini' })

    expect(state.setAutomatedWorkflowGeneratorModel).toHaveBeenCalledWith('gpt-5.4-mini')
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'automated-workflow-generator:model',
      data: { sessionId: 'mw-2', modelId: 'gpt-5.5' },
    })
  })

  it('replies with every automated workflow run regardless of project for :list-all', () => {
    const reply = sendCommand('automated-workflow-runs:list-all')

    expect(reply).toHaveBeenCalledWith({ event: 'automated-workflow-runs:list-all', data: { runs: [] } })
  })

  it('treats a null/omitted projectId on :list as "project-less runs", not an error', () => {
    const reply = sendCommand('automated-workflow-runs:list', {})

    expect(reply).toHaveBeenCalledWith({
      event: 'automated-workflow-runs:list',
      data: { projectId: null, runs: [] },
    })
  })

  it('replies with saved workflow runs as schedule-attachment candidates', () => {
    const reply = sendCommand('scheduler:list-workflow-templates')

    expect(reply).toHaveBeenCalledWith({ event: 'scheduler:list-workflow-templates', data: { runs: [] } })
  })

  describe('conversation ratings', () => {
    it('sets a rating and replies with the updated result', () => {
      const rating = {
        id: 'r1', conversationId: 'conv-1', rating: 5, note: 'great',
        snapshot: {
          agentId: null, agentName: null, model: null, backend: null, projectId: null, projectName: null,
          workflowMode: null, toolNames: [], serverNames: [], skillIds: [], skillNames: [], keywords: [],
        },
        createdAt: 1, updatedAt: 1,
      } satisfies ConversationRating
      state.submitRatingForConversation.mockReturnValue(rating)

      const reply = sendCommand('conversation:set-rating', { conversationId: 'conv-1', rating: 5, note: 'great' })

      expect(state.submitRatingForConversation).toHaveBeenCalledWith('conv-1', 5, 'great')
      expect(reply).toHaveBeenCalledWith({ event: 'rating:updated', data: { conversationId: 'conv-1', rating } })
    })

    it('ignores a set-rating command with a non-integer rating', () => {
      sendCommand('conversation:set-rating', { conversationId: 'conv-1', rating: 3.5 })
      expect(state.submitRatingForConversation).not.toHaveBeenCalled()
    })

    it('replies with an error event when submitRatingForConversation throws', () => {
      state.submitRatingForConversation.mockImplementation(() => { throw new Error('rating must be an integer between 1 and 5') })

      const reply = sendCommand('conversation:set-rating', { conversationId: 'conv-1', rating: 9 })

      expect(reply).toHaveBeenCalledWith({ event: 'rating:error', data: { message: 'rating must be an integer between 1 and 5' } })
    })

    it('fetches a rating for a conversation', () => {
      state.getRatingForConversation.mockReturnValue(null)
      const reply = sendCommand('conversation:get-rating', { conversationId: 'conv-1' })

      expect(state.getRatingForConversation).toHaveBeenCalledWith('conv-1')
      expect(reply).toHaveBeenCalledWith({ event: 'rating:loaded', data: { conversationId: 'conv-1', rating: null } })
    })

    it('deletes a rating and replies only on success', () => {
      state.deleteRatingForConversation.mockReturnValue(false)
      let reply = sendCommand('conversation:delete-rating', { conversationId: 'conv-1' })
      expect(reply).not.toHaveBeenCalled()

      state.deleteRatingForConversation.mockReturnValue(true)
      reply = sendCommand('conversation:delete-rating', { conversationId: 'conv-1' })
      expect(reply).toHaveBeenCalledWith({ event: 'rating:updated', data: { conversationId: 'conv-1', rating: null } })
    })

    it('lists all ratings', () => {
      const rows = [{
        id: 'r1', conversationId: 'conv-1', conversationTitle: 'Chat', projectId: null, projectName: null,
        rating: 4, note: null, agentName: null, model: null, toolNames: [], skillNames: [], createdAt: 1, updatedAt: 1,
      }] satisfies ConversationRatingListItem[]
      state.listRatings.mockReturnValue(rows)

      const reply = sendCommand('conversation:list-ratings')

      expect(reply).toHaveBeenCalledWith({ event: 'rating:list-loaded', data: { ratings: rows } })
    })

    it('returns rating stats', () => {
      const stats = { averageByAgent: [{ label: 'Agent', average: 4, count: 2 }], averageByModel: [], averageBySkill: [], averageByServer: [], averageByProject: [], trend: [] }
      state.getRatingStats.mockReturnValue(stats)

      const reply = sendCommand('conversation:rating-stats')

      expect(reply).toHaveBeenCalledWith({ event: 'rating:stats-loaded', data: { stats } })
    })
  })
})

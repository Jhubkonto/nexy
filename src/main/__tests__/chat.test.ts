import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import path from 'path'

const state = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const messages: Array<{
    role: string
    content: string
    attachments: string | null
    model: string | null
    timestamp: number
    thinkingBlocks: string | null
    textSegments: string | null
  }> = []
  const modelUpdates: Array<{ sql: string; model: unknown; conversationId: unknown }> = []
  const conversationInserts: Array<{ id: unknown; agentId: unknown; projectId: unknown }> = []
  const modeClears: string[] = []
  const events: string[] = []
  const send = vi.fn()
  const broadcastToMobile = vi.fn((payload: { event?: string; data?: { state?: string } }) => {
    if (payload.event === 'conversation:messages') events.push('mobile:messages')
    if (payload.event === 'chat:stream-end') events.push('mobile:stream-end')
    if (payload.event === 'chat:activity' && payload.data?.state === 'complete') events.push('mobile:complete')
    if (payload.event === 'chat:activity' && payload.data?.state === 'error') events.push('mobile:error')
  })
  const abortActiveStream = vi.fn()
  // Per-test overrides: map SQL substrings to fixed return values for get()
  const getOverrides = new Map<string, unknown>()
  const allOverrides = new Map<string, unknown[]>()
  const recordProjectAuditChange = vi.fn()
  const saveFinalizedPlanArtifact = vi.fn()
  const startSkillSaveMcpBridge = vi.fn()
  const getApiKey = vi.fn(() => 'test-key')
  return { handlers, messages, modelUpdates, conversationInserts, modeClears, events, send, broadcastToMobile, abortActiveStream, getOverrides, allOverrides, recordProjectAuditChange, saveFinalizedPlanArtifact, startSkillSaveMcpBridge, getApiKey }
})

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    state.handlers.set(channel, handler)
  },
}))

vi.mock('../database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (sql.includes('INSERT INTO messages')) {
          const role = String(args[2])
          // Column order differs by role: the assistant insert (persistAssistantMessage) is
          // (…, timestamp, model, thinking_blocks, …) so model is args[6]; the user insert is
          // (…, timestamp, model) so model is args[7].
          const model = role === 'assistant'
            ? (typeof args[6] === 'string' ? args[6] : null)
            : (typeof args[7] === 'string' ? args[7] : null)
          state.messages.push({
            role,
            content: String(args[3]),
            attachments: typeof args[4] === 'string' ? args[4] : null,
            model,
            timestamp: Number(args[5]),
            thinkingBlocks: typeof args[7] === 'string' ? args[7] : null,
            textSegments: typeof args[8] === 'string' ? args[8] : null,
          })
          if (role === 'assistant') state.events.push('db:assistant-insert')
        }
        if (sql.includes('INSERT INTO conversations')) {
          // Column order: (id, agent_id, project_id, title, cli_backend, created_at, updated_at)
          state.conversationInserts.push({ id: args[0], agentId: args[1], projectId: args[2] })
        }
        if (sql.includes('UPDATE conversations SET model = ?')) {
          state.modelUpdates.push({ sql, model: args[0], conversationId: args[1] })
        }
        if (sql.includes('UPDATE conversations SET cli_mode_override = NULL')) {
          state.modeClears.push('claude')
        }
        if (sql.includes('UPDATE conversations SET codex_execution_mode_override = NULL')) {
          state.modeClears.push('codex')
        }
        return { changes: 1 }
      },
      get: () => {
        for (const [pattern, value] of state.getOverrides) {
          if (sql.includes(pattern)) return value
        }
        return { agent_id: null, model: null, cli_backend: null }
      },
      all: () => {
        for (const [pattern, value] of state.allOverrides) {
          if (sql.includes(pattern)) return value
        }
        if (sql.includes('SELECT id, role, content')) {
          return state.messages.map((message, index) => ({
            id: `m-${index}`,
            role: message.role,
            content: message.content,
            model: null,
            attachments: message.attachments,
            timestamp: message.timestamp,
            thinking_blocks: message.thinkingBlocks,
            text_segments: message.textSegments,
          }))
        }
        return []
      },
    }),
  }),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: () => ({ webContents: { send: state.send, isDestroyed: () => false } }),
    getAllWindows: () => [],
  },
}))

vi.mock('../agents', () => ({ getAgentConfig: vi.fn(() => null) }))
vi.mock('../artifacts', () => ({
  saveFinalizedPlanArtifact: state.saveFinalizedPlanArtifact,
}))
vi.mock('../project-handlers', () => ({
  parseProjectConfig: vi.fn(() => ({
    instructions: '',
    instructionsEnabled: true,
    rootDirectory: null,
    variables: [],
    instructionMode: 'prepend',
    workflowMode: 'single-agent',
    orchestrationEnabled: false,
    maxDelegationDepth: 5,
    showTeamActivity: true,
    inScope: [],
    outOfScope: [],
    milestones: [],
    defaultModel: null,
  })),
}))
vi.mock('../fcm-sender', () => ({ sendChatCompleteNotification: vi.fn(async () => undefined) }))
vi.mock('../file-handlers', () => ({ listDirectoryEntries: vi.fn(() => []), getWorkingDirectory: vi.fn(() => '/mock-cwd') }))
vi.mock('../mcp', () => ({
  ensureMcpServersReady: vi.fn(async () => undefined),
  getAvailableMcpTools: vi.fn(() => []),
  getMcpServerConfigsForCli: vi.fn(() => []),
}))
vi.mock('../orchestrator', () => ({ runOrchestration: vi.fn() }))
vi.mock('../tool-loop', () => ({ runProviderMcpToolLoop: vi.fn() }))
vi.mock('../skill-save-mcp-bridge', () => ({ startSkillSaveMcpBridge: state.startSkillSaveMcpBridge }))
vi.mock('../cli-adapters/registry', () => ({ getAdapter: vi.fn(() => null) }))
vi.mock('../cli-adapters/claude', () => ({ ClaudeAdapter: { isAvailable: vi.fn(() => false) } }))
vi.mock('../cli-adapters/codex', () => ({
  CodexAdapter: { isAvailable: vi.fn(() => false) },
  readCodexConfigModel: vi.fn(() => null),
  CODEX_DEFAULT_MODELS: [],
}))
vi.mock('../ws-server', () => ({ broadcastToMobile: state.broadcastToMobile, hasMobileClients: vi.fn(() => true), isMobileInForeground: vi.fn(() => true) }))
vi.mock('../auth', () => ({ retrieveAuthMode: vi.fn(() => 'byok') }))
vi.mock('../wiki-context', () => ({ getRelevantWikiEntries: vi.fn(() => []), formatWikiSection: vi.fn(() => '') }))
vi.mock('../wiki-handlers', () => ({ insertWikiEntry: vi.fn() }))
vi.mock('../tools', () => ({ requestApproval: vi.fn(), registerApprovalResolver: vi.fn(), denyPendingApprovalsForConversation: vi.fn() }))
vi.mock('../context-compression', () => ({
  applyRollingContextCompression: vi.fn((_db, _conversationId, messages) => ({ messages, summary: null })),
}))
vi.mock('../project-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../project-audit')>()
  // inferProjectAuditTarget stays real — it's pure path-matching logic against the (mocked)
  // getDatabase() projects table, worth exercising for real. recordProjectAuditChange is spied
  // so tests can assert on it without needing the fake db to actually persist rows.
  return { ...actual, recordProjectAuditChange: state.recordProjectAuditChange }
})
vi.mock('../chat-context-builder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chat-context-builder')>()
  // Wrapped in vi.fn() so a single test can override it (e.g. simulate an unexpected
  // throw) via mockRejectedValueOnce, while every other test still gets the real
  // implementation by default.
  return { ...actual, buildChatContext: vi.fn(actual.buildChatContext) }
})
vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'gpt-5-mini',
  NO_PROVIDER_CONFIGURED_MESSAGE: 'No provider configured. Add an API key in Settings.',
  getProviderForAgent: vi.fn(() => ({ provider: 'openai', model: 'gpt-4o' })),
  getApiKey: state.getApiKey,
  getProviderCredential: state.getApiKey,
  getOpenRouterModels: vi.fn(() => []),
  toOpenAICompatibleMessages: vi.fn((messages) => messages),
  sendOpenAIMessage: vi.fn(async (_conversationId, _apiKey, _model, _messages, onChunk) => {
    onChunk('Hello')
    onChunk(' world')
    return 'Hello world'
  }),
  sendOpenAIWithTools: vi.fn(),
  sendAnthropicMessage: vi.fn(),
  sendAnthropicWithTools: vi.fn(),
  sendAzureMessage: vi.fn(),
  sendAzureWithTools: vi.fn(),
  getAzureEndpoint: vi.fn(() => null),
  abortActiveStream: state.abortActiveStream,
}))

import { registerChatHandlers } from '../chat-handlers'
import { getAdapter } from '../cli-adapters/registry'
import { ClaudeAdapter } from '../cli-adapters/claude'
import { CodexAdapter } from '../cli-adapters/codex'
import { retrieveAuthMode } from '../auth'
import { getAgentConfig } from '../agents'
import { getAvailableMcpTools, getMcpServerConfigsForCli } from '../mcp'
import { getApiKey, getProviderForAgent, sendOpenAIMessage } from '../providers'
import { requestApproval, denyPendingApprovalsForConversation } from '../tools'
import { runOrchestration } from '../orchestrator'
import { runProviderMcpToolLoop } from '../tool-loop'
import { buildChatContext } from '../chat-context-builder'
import { getActivitySnapshot } from '../activity-tracker'
import { parseProjectConfig } from '../project-handlers'
import { DEFAULT_PROJECT_CONFIG } from '../../shared/types'
import { getActiveChatTurnSnapshot, recordActiveChatTurnEvent } from '../active-chat-turns'
import { startSkillSaveMcpBridge } from '../skill-save-mcp-bridge'

describe('chat handlers', () => {
  beforeEach(() => {
    state.handlers.clear()
    state.messages.length = 0
    state.modelUpdates.length = 0
    state.conversationInserts.length = 0
    state.modeClears.length = 0
    state.events.length = 0
    state.send.mockClear()
    state.broadcastToMobile.mockClear()
    state.abortActiveStream.mockClear()
    state.getOverrides.clear()
    state.allOverrides.clear()
    vi.mocked(requestApproval).mockReset()
    vi.mocked(denyPendingApprovalsForConversation).mockReset()
    vi.mocked(getAdapter).mockReturnValue(undefined)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(false)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(false)
    vi.mocked(retrieveAuthMode).mockReturnValue('byok')
    vi.mocked(getAgentConfig).mockReturnValue(null)
    vi.mocked(getAvailableMcpTools).mockReturnValue([])
    vi.mocked(getMcpServerConfigsForCli).mockResolvedValue([])
    vi.mocked(getApiKey).mockReturnValue('test-key')
    vi.mocked(runProviderMcpToolLoop).mockReset()
    vi.mocked(runProviderMcpToolLoop).mockImplementation(async (...args) => {
      const onChunk = args[7]
      const finalStreamCaller = args[19]
      let response = ''
      if (finalStreamCaller) {
        await finalStreamCaller(args[1], (chunk) => {
          response += chunk
          onChunk(chunk)
        })
      }
      return response
    })
    vi.mocked(requestApproval).mockResolvedValue(false)
    vi.mocked(startSkillSaveMcpBridge).mockReset()
    state.recordProjectAuditChange.mockClear()
    registerChatHandlers()
  })

  it('streams a BYOK provider response', async () => {
    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>

    const result = await handler({ sender: {} }, 'conv-1', 'Hello there')

    expect(result.assistantMsgId).toBeTruthy()
    expect(state.send).toHaveBeenCalledWith('chat:stream-response', 'Hello')
    expect(state.send).toHaveBeenCalledWith('chat:stream-response', ' world')
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:activity',
      data: expect.objectContaining({ conversationId: 'conv-1', state: 'thinking', label: 'Preparing context' }),
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:activity',
      data: expect.objectContaining({
        conversationId: 'conv-1',
        state: 'thinking',
        label: expect.stringMatching(/^Context ready · ~[\d,]+ tokens$/),
      }),
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:activity',
      data: expect.objectContaining({
        conversationId: 'conv-1',
        state: 'thinking',
        label: expect.stringMatching(/^Contacting model · ~[\d,]+ tokens$/),
      }),
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:activity',
      data: expect.objectContaining({ conversationId: 'conv-1', state: 'complete', label: 'Complete' }),
    })
    expect(state.events.indexOf('db:assistant-insert')).toBeLessThan(state.events.indexOf('mobile:stream-end'))
    expect(state.events.indexOf('db:assistant-insert')).toBeLessThan(state.events.indexOf('mobile:complete'))
    expect(state.events.indexOf('db:assistant-insert')).toBeLessThan(state.events.indexOf('mobile:messages'))
    expect(state.events.indexOf('mobile:messages')).toBeLessThan(state.events.indexOf('mobile:stream-end'))
  })

  it('uses the project default thinking effort when the chat has no override', async () => {
    vi.mocked(parseProjectConfig).mockReturnValueOnce({
      ...DEFAULT_PROJECT_CONFIG,
      defaultThinkingEffort: 'high',
    })
    vi.mocked(getProviderForAgent).mockReturnValue({ provider: 'openai', model: 'o3' })
    vi.mocked(sendOpenAIMessage).mockClear()

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-project-thinking', 'Think carefully', { projectId: 'proj-1' })

    const generationOptions = vi.mocked(sendOpenAIMessage).mock.calls.at(-1)?.[5]
    expect(generationOptions).toEqual(expect.objectContaining({ thinkingEffort: 'high' }))
    vi.mocked(getProviderForAgent).mockReturnValue({ provider: 'openai', model: 'gpt-4o' })
  })

  it('binds a project chat to the project primary agent when no agent is supplied (Android parity)', async () => {
    // A new project conversation is created with no explicit agentId (as Android's
    // new-project-chat entry points do). The conversation must be created bound to the project's
    // primary agent so the agent's backend and settings actually take effect — matching the
    // desktop renderer's newChat, which resolves the primary client-side.
    state.getOverrides.set('SELECT id FROM conversations WHERE id', undefined) // force creation branch
    state.getOverrides.set('SELECT id FROM projects WHERE id', { id: 'proj-1' }) // project exists
    state.getOverrides.set('FROM project_agents WHERE project_id', { agent_id: 'primary-agent' })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-project-primary', 'Hello', { projectId: 'proj-1' })

    const insert = state.conversationInserts.find((row) => row.id === 'conv-project-primary')
    expect(insert).toBeDefined()
    expect(insert!.agentId).toBe('primary-agent')
    expect(insert!.projectId).toBe('proj-1')
  })

  it('does not bind any agent to a project chat when the project has no agents', async () => {
    state.getOverrides.set('SELECT id FROM conversations WHERE id', undefined)
    state.getOverrides.set('SELECT id FROM projects WHERE id', { id: 'proj-2' })
    state.getOverrides.set('FROM project_agents WHERE project_id', undefined) // no rows

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-project-noagent', 'Hello', { projectId: 'proj-2' })

    const insert = state.conversationInserts.find((row) => row.id === 'conv-project-noagent')
    expect(insert).toBeDefined()
    expect(insert!.agentId).toBeNull()
  })

  it('forwards and stores BYOK provider thinking events', async () => {
    vi.mocked(sendOpenAIMessage).mockImplementationOnce(async (
      _conversationId,
      _apiKey,
      _model,
      _messages,
      onChunk,
      options,
    ) => {
      options?.onThinkingChunk?.('reasoning-0', 'Checking context.')
      options?.onThinkingEnd?.('reasoning-0')
      onChunk('Hello')
      return 'Hello'
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-byok-thinking', 'Hello there')

    expect(state.send).toHaveBeenCalledWith('chat:thinking-delta', {
      blockId: 'reasoning-0',
      chunk: 'Checking context.',
    })
    expect(state.send).toHaveBeenCalledWith('chat:thinking-end', { blockId: 'reasoning-0' })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:thinking-delta',
      data: expect.objectContaining({ conversationId: 'conv-byok-thinking', blockId: 'reasoning-0', chunk: 'Checking context.' }),
    })
    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(JSON.parse(assistantMessage?.thinkingBlocks ?? '[]')).toEqual([
      { blockId: 'reasoning-0', content: 'Checking context.', done: true, firstSeenAt: expect.any(Number) },
    ])
  })

  it('routes BYOK provider tool-loop events through normalized chat turn events', async () => {
    vi.mocked(getAgentConfig).mockReturnValue({
      id: 'agent-tools',
      name: 'Tool Agent',
      systemPrompt: 'Use tools.',
      mcpServers: ['server-1'],
      agenticMode: true,
    } as never)
    vi.mocked(getAvailableMcpTools).mockReturnValue([{
      name: 'browser_snapshot',
      serverId: 'server-1',
      serverName: 'Browser',
    }])
    vi.mocked(runProviderMcpToolLoop).mockImplementationOnce(async (
      _caller,
      _messages,
      _toolDefs,
      _toolMap,
      _agentId,
      _conversationId,
      _webContents,
      onChunk,
      _onModel,
      _agenticMode,
      _inlineHandlers,
      _toolDirective,
      _onActivity,
      _autoApproveTools,
      _toolPolicy,
      onToolFinished,
      _fullAutoApprove,
      _forceFirstToolChoice,
      _onUsage,
      _finalStreamCaller,
      onToolStarted,
    ) => {
      onToolStarted?.({
        id: 'call-1',
        conversationId: 'conv-byok-tool',
        toolName: 'browser_snapshot',
        serverName: 'Browser',
        args: { tab: 'active' },
      })
      onToolFinished?.({
        id: 'call-1',
        conversationId: 'conv-byok-tool',
        toolName: 'browser_snapshot',
        serverName: 'Browser',
        args: { tab: 'active' },
        result: 'Snapshot captured',
        success: true,
      })
      onChunk('Done')
      return 'Done'
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-byok-tool', 'Inspect page', { agentId: 'agent-tools' })

    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:tool-call-event',
      data: expect.objectContaining({
        conversationId: 'conv-byok-tool',
        toolName: 'browser_snapshot',
        serverName: 'Browser',
        args: { tab: 'active' },
        result: 'Snapshot captured',
        success: true,
        turnId: expect.any(String),
        sequence: expect.any(Number),
      }),
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:turn-event',
      data: expect.objectContaining({
        conversationId: 'conv-byok-tool',
        type: 'tool_started',
        id: 'call-1',
        name: 'browser_snapshot',
      }),
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:turn-event',
      data: expect.objectContaining({
        conversationId: 'conv-byok-tool',
        type: 'tool_finished',
        toolName: 'browser_snapshot',
        result: 'Snapshot captured',
      }),
    })

    // Parity with the CLI path: the completed tool call must be persisted as a durable
    // renderable 'tool-call' message row so it survives an end-of-turn DB reload (regression
    // guard for the "toolcalls disappeared from history" bug).
    const toolCallRow = state.messages.find((message) => message.role === 'tool-call')
    expect(toolCallRow).toBeDefined()
    expect(JSON.parse(toolCallRow!.content)).toMatchObject({
      __type: 'tool-call',
      toolName: 'browser_snapshot',
      serverName: 'Browser',
      toolArgs: { tab: 'active' },
      toolResult: 'Snapshot captured',
      toolSuccess: true,
    })
    // And it must sort before the final assistant message.
    const assistantRow = state.messages.find((message) => message.role === 'assistant')
    expect(toolCallRow!.timestamp).toBeLessThan(assistantRow!.timestamp)
  })

  it('CLI path sends conversation:messages before chat:stream-end so Android history is loaded before stream closes', async () => {
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, _req: unknown, onChunk: (chunk: string) => void) => {
        onChunk('cli response')
        return 'cli response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-cli-order', 'Hello there')

    expect(state.events).toContain('db:assistant-insert')
    expect(state.events).toContain('mobile:messages')
    expect(state.events).toContain('mobile:stream-end')
    expect(state.events.indexOf('db:assistant-insert')).toBeLessThan(state.events.indexOf('mobile:stream-end'))
    expect(state.events.indexOf('mobile:messages')).toBeLessThan(state.events.indexOf('mobile:stream-end'))
  })

  it('aborts a still-active CLI turn and denies its pending approval when a second send arrives for the same conversation', async () => {
    let releaseFirstSend: (() => void) | undefined
    const firstSendGate = new Promise<void>((resolve) => { releaseFirstSend = resolve })
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: { conversationId?: string }) => {
        if (req.conversationId === 'conv-concurrent') {
          await firstSendGate
        }
        return 'cli response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>

    const firstTurn = handler({ sender: {} }, 'conv-concurrent', 'Hello there')
    // Let the first turn register its CLI abort controller before the second send arrives.
    await Promise.resolve()
    await Promise.resolve()

    const secondTurn = handler({ sender: {} }, 'conv-concurrent', 'try again')
    releaseFirstSend?.()
    await Promise.all([firstTurn, secondTurn])

    expect(state.abortActiveStream).toHaveBeenCalledWith('conv-concurrent')
    expect(denyPendingApprovalsForConversation).toHaveBeenCalledWith('conv-concurrent')
  })

  it('routes through the forced agent CLI backend even when a provider model is supplied', async () => {
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async () => 'cli response'),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(getAgentConfig).mockReturnValue({
      id: 'agent-1',
      name: 'Project Agent',
      icon: 'A',
      systemPrompt: '',
      backend: 'codex-cli',
      cliModel: 'gpt-5.5',
    } as never)
    vi.mocked(sendOpenAIMessage).mockClear()
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: 'agent-1',
      model: 'gpt-5-mini',
      cli_backend: null,
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-provider-override', 'Hello there', { model: 'gpt-5-mini' })

    expect(mockAdapter.send).toHaveBeenCalled()
    expect(sendOpenAIMessage).not.toHaveBeenCalled()
  })

  it('stores mobile image attachment metadata without persisting image data', async () => {
    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>

    await handler({ sender: {} }, 'conv-1', '', {
      images: [{ id: 'img-1', name: 'photo.png', dataUrl: 'data:image/png;base64,abc123' }],
    })

    const userMessage = state.messages.find((message) => message.role === 'user')
    expect(userMessage?.attachments).toBeTruthy()
    const attachments = JSON.parse(userMessage?.attachments ?? '[]')
    expect(attachments).toEqual([
      {
        id: 'img-1',
        name: 'photo.png',
        size: 4,
        type: 'image',
        source: 'mobile',
      },
    ])
    expect(userMessage?.attachments).not.toContain('abc123')
    expect(userMessage?.attachments).not.toContain('data:image/png')
  })

  it('CLI backend does not inject BYOK model identity into system prompt', async () => {
    // Make the handler route through the CLI adapter
    const capturedReqs: { systemPrompt?: string }[] = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: { systemPrompt?: string }, _onChunk: unknown) => {
        capturedReqs.push({ systemPrompt: req.systemPrompt })
        return 'cli response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli', 'tell me something')

    expect(capturedReqs).toHaveLength(1)
    // Must NOT contain the BYOK model identity instruction
    expect(capturedReqs[0].systemPrompt ?? '').not.toContain('gpt-5-mini')
    expect(capturedReqs[0].systemPrompt ?? '').not.toContain('Runtime model for this conversation')
  })

  it('refreshes Claude CLI custom agents from the live project team on every turn', async () => {
    const capturedReqs: Array<{
      systemPrompt?: string
      agents?: Record<string, { description: string; prompt: string }>
      allowedTools?: string[]
    }> = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: typeof capturedReqs[number]) => {
        capturedReqs.push(req)
        return 'cli response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(getAgentConfig).mockReturnValue({
      id: 'leader-id',
      name: 'Pipeline Architect',
      systemPrompt: 'Lead the project.',
      backend: 'claude-cli',
      tools: {},
    } as never)
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: 'leader-id',
      model: null,
      cli_backend: 'claude-cli',
    })
    state.getOverrides.set('SELECT name, config_json FROM projects', {
      name: 'MOMM',
      config_json: JSON.stringify({ workflowMode: 'orchestrated', orchestrationEnabled: true }),
    })
    const builtContext = {
      augmentedContent: 'Ask the specialist',
      attachedImages: [],
      injectedRootDirectory: null,
      wikiProjectId: 'project-1',
      wikiToolDefs: [],
      wikiInlineHandlers: new Map(),
      fileToolDefs: [],
      fileInlineHandlers: new Map(),
      skillToolDefs: [],
      skillInlineHandlers: new Map(),
      planToolDefs: [],
      planInlineHandlers: new Map(),
    }
    vi.mocked(buildChatContext).mockResolvedValueOnce(builtContext).mockResolvedValueOnce(builtContext)

    state.allOverrides.set('project_agents pa JOIN agents', [
      { agent_id: 'leader-id', is_primary: 1, sort_order: 0, config_json: JSON.stringify({ name: 'Pipeline Architect', systemPrompt: 'Lead.' }) },
      { agent_id: 'builder-id', is_primary: 0, sort_order: 1, config_json: JSON.stringify({ name: 'Builder', systemPrompt: 'Build carefully.' }) },
    ])

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-live-team', 'Ask Builder', { projectId: 'project-1' })

    // Add a member after the conversation already exists, then send another message in it.
    state.allOverrides.set('project_agents pa JOIN agents', [
      { agent_id: 'leader-id', is_primary: 1, sort_order: 0, config_json: JSON.stringify({ name: 'Pipeline Architect', systemPrompt: 'Lead.' }) },
      { agent_id: 'builder-id', is_primary: 0, sort_order: 1, config_json: JSON.stringify({ name: 'Builder', systemPrompt: 'Build carefully.' }) },
      { agent_id: 'skeptic-id', is_primary: 0, sort_order: 2, config_json: JSON.stringify({ name: 'The Skeptical Senior', icon: '🧐', systemPrompt: 'Challenge assumptions.' }) },
    ])
    await handler({ sender: {} }, 'conv-live-team', 'Ask the skeptic', { projectId: 'project-1' })

    expect(capturedReqs).toHaveLength(2)
    expect(capturedReqs[0].agents).not.toHaveProperty('the-skeptical-senior')
    expect(capturedReqs[1].agents?.['the-skeptical-senior']).toEqual({
      description: 'Challenge assumptions.',
      prompt: 'Challenge assumptions.',
    })
    expect(capturedReqs[1].systemPrompt).toContain('authoritative current roster for this turn')
    expect(capturedReqs[1].systemPrompt).toContain('Do not use SendMessage')
    expect(capturedReqs[1].allowedTools).toEqual(expect.arrayContaining(['Agent', 'Task']))
  })

  it('forwards and stores CLI thinking events', async () => {
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, _req: unknown, onChunk: (chunk: string) => void, onEvent: (event: unknown) => void) => {
        onEvent({ type: 'thinking_chunk', blockId: 'codex-activity', chunk: 'Starting Codex CLI.\n' })
        onEvent({ type: 'thinking_end', blockId: 'codex-activity' })
        onChunk('cli response')
        return 'cli response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(false)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli-thinking', 'tell me something')

    expect(state.send).toHaveBeenCalledWith('chat:thinking-delta', {
      blockId: 'codex-activity',
      chunk: 'Starting Codex CLI.\n',
    })
    expect(state.send).toHaveBeenCalledWith('chat:thinking-end', { blockId: 'codex-activity' })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:thinking-delta',
      data: expect.objectContaining({ conversationId: 'conv-cli-thinking', blockId: 'codex-activity', chunk: 'Starting Codex CLI.\n' }),
    })
    expect(state.broadcastToMobile).toHaveBeenCalledWith({
      event: 'chat:thinking-end',
      data: expect.objectContaining({ conversationId: 'conv-cli-thinking', blockId: 'codex-activity' }),
    })
    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(JSON.parse(assistantMessage?.thinkingBlocks ?? '[]')).toEqual([
      { blockId: 'codex-activity', content: 'Starting Codex CLI.\n', done: true, firstSeenAt: expect.any(Number) },
    ])
  })

  it('persists segmented CLI text and tools with strict occurrence order even in one millisecond', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (
        _win: unknown,
        _req: unknown,
        onChunk: (chunk: string, blockId?: string) => void,
        onEvent: (event: { type: string; [key: string]: unknown }) => void,
      ) => {
        onChunk('Before', 'codex-text-msg-1')
        onEvent({ type: 'text_end', blockId: 'codex-text-msg-1' })
        onEvent({ type: 'tool_start', id: 'cmd-1', name: 'Run Command', input: { command: 'pwd' } })
        onEvent({ type: 'tool_end', id: 'cmd-1', content: '/workspace', isError: false })
        onChunk('After', 'codex-text-msg-2')
        onEvent({ type: 'text_end', blockId: 'codex-text-msg-2' })
        return 'Before\n\nAfter'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    try {
      const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
      await handler({ sender: {} }, 'conv-cli-order', 'inspect')
    } finally {
      now.mockRestore()
    }

    const tool = state.messages.find((message) => message.role === 'tool-call')
    const assistant = state.messages.find((message) => message.role === 'assistant')
    const segments = JSON.parse(assistant?.textSegments ?? '[]') as Array<{ content: string; firstSeenAt: number }>

    expect(segments.map((segment) => segment.content)).toEqual(['Before', 'After'])
    expect(segments[0].firstSeenAt).toBeLessThan(tool?.timestamp ?? 0)
    expect(tool?.timestamp).toBeLessThan(segments[1].firstSeenAt)
    expect(segments[1].firstSeenAt).toBeLessThan(assistant?.timestamp ?? 0)
  })

  it('injects assigned MCP servers when falling back to Claude CLI for MCP agents', async () => {
    const capturedReqs: Array<{ mcpServers?: unknown[]; allowedTools?: string[] }> = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: { mcpServers?: unknown[]; allowedTools?: string[] }) => {
        capturedReqs.push({ mcpServers: req.mcpServers, allowedTools: req.allowedTools })
        return 'cli response'
      }),
    }
    vi.mocked(getAgentConfig).mockReturnValue({
      id: 'agent-mcp',
      name: 'MCP Agent',
      systemPrompt: 'Use browser tools.',
      mcpServers: ['server-1'],
      agenticMode: true,
    } as never)
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    vi.mocked(getMcpServerConfigsForCli).mockResolvedValue([{
      id: 'server-1',
      key: 'playwright_chromium',
      command: 'npx',
      args: ['-y', '@playwright/mcp'],
    }])
    vi.mocked(getAvailableMcpTools).mockReturnValue([{
      name: 'browser_navigate',
      serverId: 'server-1',
      serverName: 'Playwright (Chromium)',
    }])

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-mcp', 'open google', { agentId: 'agent-mcp' })

    expect(mockAdapter.send).toHaveBeenCalled()
    expect(capturedReqs[0].mcpServers).toEqual([{
      id: 'server-1',
      key: 'playwright_chromium',
      command: 'npx',
      args: ['-y', '@playwright/mcp'],
    }])
    expect(capturedReqs[0].allowedTools).toEqual(['mcp__playwright_chromium__browser_navigate'])
  })

  it('asks for the exact PowerShell command when Claude CLI attempts it', async () => {
    const capturedReqs: Array<{
      allowedTools?: string[]
      requestPermission?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
    }> = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: {
        allowedTools?: string[]
        requestPermission?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
      }) => {
        capturedReqs.push(req)
        expect(await req.requestPermission?.('PowerShell', { command: 'Get-ChildItem -Force' })).toBe(true)
        return 'cli response'
      }),
    }
    vi.mocked(getAgentConfig).mockReturnValue({
      id: 'agent-terminal',
      name: 'Terminal Agent',
      systemPrompt: 'Inspect the workspace.',
      mcpServers: [],
      agenticMode: false,
      tools: {
        fileEdit: { enabled: false, approval: 'always-ask', instructions: '' },
        terminal: { enabled: true, approval: 'always-ask', instructions: '' },
        webFetch: { enabled: false, approval: 'always-ask', instructions: '' },
      },
    } as never)
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    vi.mocked(requestApproval).mockResolvedValue(true)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-terminal', 'inspect files', { agentId: 'agent-terminal' })

    expect(requestApproval).toHaveBeenCalledWith(
      expect.anything(),
      'claude-cli:terminal',
      { command: 'Get-ChildItem -Force' },
      'Allow Claude CLI to run terminal commands for this message?',
      { conversationId: 'conv-terminal', onRemember: expect.any(Function) },
    )
    // always-ask tools are deliberately absent from --allowedTools; the live
    // PermissionRequest hook pauses and asks only if Claude actually calls one.
    expect(capturedReqs[0].allowedTools).toBeUndefined()
  })

  it('injects assigned MCP servers when falling back to Codex CLI for MCP agents', async () => {
    const capturedReqs: Array<{ mcpServers?: unknown[]; allowedTools?: string[] }> = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: { mcpServers?: unknown[]; allowedTools?: string[] }) => {
        capturedReqs.push({ mcpServers: req.mcpServers, allowedTools: req.allowedTools })
        return 'cli response'
      }),
    }
    vi.mocked(getAgentConfig).mockReturnValue({
      id: 'agent-mcp',
      name: 'MCP Agent',
      systemPrompt: 'Use browser tools.',
      mcpServers: ['server-1'],
      agenticMode: true,
    } as never)
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(false)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    vi.mocked(getMcpServerConfigsForCli).mockResolvedValue([{
      id: 'server-1',
      key: 'playwright_chromium',
      command: 'npx',
      args: ['-y', '@playwright/mcp'],
    }])
    vi.mocked(getAvailableMcpTools).mockReturnValue([{
      name: 'browser_navigate',
      serverId: 'server-1',
      serverName: 'Playwright (Chromium)',
    }])

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-mcp', 'open google', { agentId: 'agent-mcp' })

    expect(mockAdapter.send).toHaveBeenCalled()
    expect(capturedReqs[0].mcpServers).toEqual([{
      id: 'server-1',
      key: 'playwright_chromium',
      command: 'npx',
      args: ['-y', '@playwright/mcp'],
    }])
    expect(capturedReqs[0].allowedTools).toEqual(['mcp__playwright_chromium__browser_navigate'])
  })

  it('reports fallback CLI errors without falling through to provider configuration errors', async () => {
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, _req: unknown, _onChunk: unknown, onEvent: (event: unknown) => void) => {
        onEvent({ type: 'thinking_chunk', blockId: 'codex-activity', chunk: 'Starting Codex CLI.\n' })
        throw new Error('claude failed after running MCP tools')
      }),
    }
    vi.mocked(getAgentConfig).mockReturnValue(null)
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli-error', 'open google')

    expect(mockAdapter.send).toHaveBeenCalled()
    expect(state.send).toHaveBeenCalledWith('chat:stream-error', expect.objectContaining({
      message: 'claude failed after running MCP tools',
    }))
    expect(state.send).toHaveBeenCalledWith('chat:thinking-end', { blockId: 'codex-activity' })
    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(JSON.parse(assistantMessage?.thinkingBlocks ?? '[]')).toEqual([
      { blockId: 'codex-activity', content: 'Starting Codex CLI.\n', done: true, firstSeenAt: expect.any(Number) },
    ])
    expect(state.messages.some((message) => message.content.includes('No provider configured'))).toBe(false)
  })

  it('threads the conversation cli_mode_override into the CLI adapter request as permissionMode', async () => {
    const capturedReqs: Array<{ permissionMode?: string }> = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: { permissionMode?: string }) => {
        capturedReqs.push({ permissionMode: req.permissionMode })
        return 'cli response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null,
      model: null,
      cli_backend: null,
      cli_mode_override: 'plan',
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli-mode', 'hello there')

    expect(capturedReqs).toHaveLength(1)
    expect(capturedReqs[0].permissionMode).toBe('plan')
  })

  it('uses the conversation agentic override for a plain BYOK project chat', async () => {
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null,
      model: null,
      cli_backend: null,
      thinking_effort_override: null,
      full_auto_approve_override: null,
      agentic_mode_override: 1,
      terminal_sandbox_override: null,
      cli_mode_override: null,
      codex_execution_mode_override: null,
    })
    vi.mocked(buildChatContext).mockResolvedValueOnce({
      augmentedContent: 'Use the project tool',
      attachedImages: [],
      injectedRootDirectory: 'C:\\project',
      wikiProjectId: 'project-1',
      wikiToolDefs: [{
        type: 'function',
        function: {
          name: 'search_project_wiki',
          description: 'Search project memory',
          parameters: { type: 'object', properties: {} },
        },
      }],
      wikiInlineHandlers: new Map([['search_project_wiki', vi.fn()]]),
      fileToolDefs: [],
      fileInlineHandlers: new Map(),
      skillToolDefs: [],
      skillInlineHandlers: new Map(),
      planToolDefs: [],
      planInlineHandlers: new Map(),
    })
    vi.mocked(runProviderMcpToolLoop).mockResolvedValueOnce('Done')

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-plain-agentic', 'Work autonomously', { projectId: 'project-1' })

    expect(runProviderMcpToolLoop).toHaveBeenCalled()
    expect(vi.mocked(runProviderMcpToolLoop).mock.calls[0][9]).toBe(true)
  })

  it('does not attach Nexy approval callbacks to Claude CLI turns in bypass mode', async () => {
    const capturedReqs: Array<{ permissionMode?: string; requestPermission?: unknown }> = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (
        _win: unknown,
        req: { permissionMode?: string; requestPermission?: unknown },
      ) => {
        capturedReqs.push({
          permissionMode: req.permissionMode,
          requestPermission: req.requestPermission,
        })
        return 'cli response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null,
      model: null,
      cli_backend: null,
      cli_mode_override: 'bypassPermissions',
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli-bypass', 'edit the file')

    expect(capturedReqs).toEqual([{
      permissionMode: 'bypassPermissions',
      requestPermission: undefined,
    }])
  })

  it('threads the independent Codex execution mode override into the CLI adapter request', async () => {
    const capturedReqs: Array<{ executionMode?: string }> = []
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: { executionMode?: string }) => {
        capturedReqs.push({ executionMode: req.executionMode })
        return 'plan response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null,
      model: 'gpt-5.5',
      cli_backend: 'codex-cli',
      cli_mode_override: 'read-only',
      codex_execution_mode_override: 'plan',
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-codex-plan', 'plan this change')

    expect(capturedReqs).toEqual([{ executionMode: 'plan' }])
  })

  it('treats a native Codex plan item as ExitPlanMode and clears Plan mode after approval', async () => {
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (
        _win: unknown,
        _req: unknown,
        onChunk: (chunk: string, blockId?: string) => void,
        onEvent: (event: unknown) => void,
      ) => {
        onChunk('Step one', 'codex-plan-plan-1')
        onEvent({ type: 'plan_ready', plan: 'Step one' })
        return 'Step one'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(CodexAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    vi.mocked(requestApproval).mockResolvedValue(true)
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null,
      model: 'gpt-5.5',
      cli_backend: 'codex-cli',
      cli_mode_override: 'read-only',
      codex_execution_mode_override: 'plan',
    })
    state.getOverrides.set('SELECT thinking_effort_override', {
      thinking_effort_override: null,
      full_auto_approve_override: null,
      terminal_sandbox_override: null,
      cli_mode_override: 'read-only',
      codex_execution_mode_override: null,
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-codex-exit-plan', 'plan this change')

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ isDestroyed: expect.any(Function) }),
      'exit_plan_mode',
      { plan: 'Step one' },
      'Review the completed plan and choose what Codex should do next.',
      { noRemember: true, conversationId: 'conv-codex-exit-plan' },
    )
    expect(state.modeClears).toContain('codex')
    expect(state.saveFinalizedPlanArtifact).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-codex-exit-plan',
      plan: 'Step one',
    }))
    await vi.waitFor(() => expect(mockAdapter.send).toHaveBeenCalledTimes(2))
    expect(mockAdapter.send.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      executionMode: undefined,
    }))
    expect(state.messages).toContainEqual(expect.objectContaining({
      role: 'user',
      content: 'Implement the approved plan now. Continue until it is fully complete, then verify the result.',
    }))
  })

  it('clears Claude Plan mode when Claude invokes its native ExitPlanMode tool', async () => {
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (
        _win: unknown,
        req: { requestPermission?: (toolName: string, input: Record<string, unknown>) => Promise<boolean> },
      ) => {
        await req.requestPermission?.('ExitPlanMode', { plan: 'Implement in two steps.' })
        return 'Plan ready'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    vi.mocked(requestApproval).mockResolvedValue(true)
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null,
      model: 'claude-sonnet',
      cli_backend: 'claude-cli',
      cli_mode_override: 'plan',
      codex_execution_mode_override: null,
    })
    state.getOverrides.set('SELECT thinking_effort_override', {
      thinking_effort_override: null,
      full_auto_approve_override: null,
      terminal_sandbox_override: null,
      cli_mode_override: null,
      codex_execution_mode_override: null,
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-claude-exit-plan', 'plan this change')

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ isDestroyed: expect.any(Function) }),
      'exit_plan_mode',
      { plan: 'Implement in two steps.' },
      'Approve this plan and start implementing?',
      { noRemember: true, conversationId: 'conv-claude-exit-plan' },
    )
    expect(state.modeClears).toContain('claude')
    expect(state.saveFinalizedPlanArtifact).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-claude-exit-plan',
      plan: 'Implement in two steps.',
    }))
    await vi.waitFor(() => expect(mockAdapter.send).toHaveBeenCalledTimes(2))
    expect(mockAdapter.send.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ permissionMode: undefined }))
  })

  it('uses the Claude Plan MCP completion callback and starts a normal implementation turn after approval', async () => {
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (
        _win: unknown,
        req: { requestPlanApproval?: (plan: string) => Promise<boolean> },
      ) => {
        await req.requestPlanApproval?.('# Plan\n\n- Implement it')
        return '# Plan\n\n- Implement it'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    vi.mocked(requestApproval).mockResolvedValue(true)
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null, model: 'claude-sonnet', cli_backend: 'claude-cli', cli_mode_override: 'plan', codex_execution_mode_override: null,
    })
    state.getOverrides.set('SELECT thinking_effort_override', {
      thinking_effort_override: null, full_auto_approve_override: null, terminal_sandbox_override: null, cli_mode_override: null, codex_execution_mode_override: null,
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-claude-plan-bridge', 'plan this change')

    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ isDestroyed: expect.any(Function) }), 'exit_plan_mode', { plan: '# Plan\n\n- Implement it' },
      'Approve this plan and start implementing?', { noRemember: true, conversationId: 'conv-claude-plan-bridge' },
    )
    expect(state.modeClears).toContain('claude')
    await vi.waitFor(() => expect(mockAdapter.send).toHaveBeenCalledTimes(2))
    expect(mockAdapter.send.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ permissionMode: undefined }))
  })

  it('labels the assistant message with the explicitly selected model', async () => {
    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-model-label', 'Hello there', { model: 'gpt-5.4-mini' })

    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(assistantMessage?.model).toBe('gpt-5.4-mini')
  })

  it('syncs conversations.model unconditionally to the selected model so later un-modeled messages do not fall back to a stale model', async () => {
    // Regression: conversations.model was only written while NULL/'default', so after the
    // first turn the desktop picker and the stored model diverged. A later message that
    // arrived without its own override (e.g. the Android companion omitting it) then
    // resolved to — and was generated by — the stale stored model.
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null,
      model: 'gpt-5.5', // stale value locked in on an earlier turn
      cli_backend: null,
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-model-sync', 'Hello there', { model: 'gpt-5.4-mini' })

    const modelSync = state.modelUpdates.find((u) => u.conversationId === 'conv-model-sync')
    expect(modelSync).toBeDefined()
    expect(modelSync?.model).toBe('gpt-5.4-mini')
    // The update must be unconditional — not gated on the column still being NULL/'default'.
    expect(modelSync?.sql).not.toContain('IS NULL')
  })

  it('labels an un-modeled message with the conversation model (fallback path)', async () => {
    // With the sync in place, conversations.model tracks the last explicit selection, so the
    // fallback used for a message that carries no override resolves to the intended model.
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null,
      model: 'gpt-5.4-mini',
      cli_backend: null,
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-model-fallback', 'Hello there')

    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(assistantMessage?.model).toBe('gpt-5.4-mini')
  })

  it('aborts the active provider stream', async () => {
    const handler = state.handlers.get('chat:stop-generation') as (...args: unknown[]) => Promise<boolean>
    recordActiveChatTurnEvent({
      type: 'turn_started',
      conversationId: 'conv-1',
      turnId: 'turn-to-stop',
      sequence: 1,
      timestamp: Date.now(),
    })

    await expect(handler({}, 'conv-1')).resolves.toBe(true)
    expect(state.abortActiveStream).toHaveBeenCalledWith('conv-1')
    expect(denyPendingApprovalsForConversation).toHaveBeenCalledWith('conv-1')
    expect(getActiveChatTurnSnapshot('conv-1')).toBeNull()
  })

  it('honors a live escalation to bypass in an already-running Claude permission hook', async () => {
    let requestPermission: ((toolName: string, input: Record<string, unknown>) => Promise<boolean>) | undefined
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (
        _win: unknown,
        req: { requestPermission?: typeof requestPermission },
      ) => {
        requestPermission = req.requestPermission
        return 'cli response'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    state.getOverrides.set('SELECT agent_id, model, cli_backend', {
      agent_id: null,
      model: null,
      cli_backend: null,
      cli_mode_override: null,
    })
    state.getOverrides.set('SELECT cli_mode_override FROM conversations', {
      cli_mode_override: 'bypassPermissions',
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli-live-bypass', 'edit the file')

    expect(requestPermission).toBeTypeOf('function')
    await expect(requestPermission!('Edit', { file_path: 'README.md' })).resolves.toBe(true)
  })

  it('closes out the background activity entry when an unexpected error occurs before any provider/CLI dispatch begins', async () => {
    // buildChatContext runs before any of the branch-specific try/catch blocks — an
    // unhandled throw there used to skip every turnEmitter.closeStream()/sendStreamEnd()
    // call, leaving the chat's activity-tracker entry ("still generating") stuck forever.
    vi.mocked(buildChatContext).mockRejectedValueOnce(new Error('context build blew up'))

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-context-crash', 'Hello there')

    expect(state.send).toHaveBeenCalledWith('chat:stream-error', expect.objectContaining({
      message: 'context build blew up',
    }))
    // chat:stream-response with a null payload is how closeStream signals the turn ended.
    expect(state.send).toHaveBeenCalledWith('chat:stream-response', null)
    const assistantMessage = state.messages.find((message) => message.role === 'assistant')
    expect(assistantMessage?.content).toBe('context build blew up')
    expect(getActivitySnapshot().some((activity) => activity.id === 'chat:conv-context-crash')).toBe(false)
  })

  it('clears the background activity entry after a successful CLI turn that includes a failed tool call followed by a retry', async () => {
    // Reproduces a reported "Activity" sidebar badge stuck on 'Assistant is responding…'
    // after a normal, fully-completed CLI response — specifically one where the CLI's own
    // agentic loop hit a tool_use_error (e.g. writing to a file it hadn't read yet) and
    // recovered with a follow-up tool call before finishing successfully.
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, _req: unknown, onChunk: (chunk: string) => void, onEvent: (event: unknown) => void) => {
        onEvent({ type: 'tool_start', id: 'call-1', name: 'Write', input: { file_path: 'x.test' } })
        onEvent({ type: 'tool_end', id: 'call-1', content: '<tool_use_error>File has not been read yet.</tool_use_error>', isError: true })
        onEvent({ type: 'tool_start', id: 'call-2', name: 'Read', input: { file_path: 'x.test' } })
        onEvent({ type: 'tool_end', id: 'call-2', content: '1  // ok', isError: false })
        onEvent({ type: 'cost', totalCostUsd: 0.06, inputTokens: 26, outputTokens: 1130 })
        onChunk('It is ready to go!')
        return 'It is ready to go!'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    await handler({ sender: {} }, 'conv-cli-retry', 'This is a test.')

    expect(state.send).toHaveBeenCalledWith('chat:stream-response', null)
    expect(getActivitySnapshot().some((activity) => activity.id === 'chat:conv-cli-retry')).toBe(false)
  })

  it('records a CLI-driven file edit in Project Audit with a real diff, matching what write_project_file already does for BYOK chat', async () => {
    // Regression: Claude CLI / Codex CLI edit files directly inside their own subprocess, so
    // Nexy only ever saw a plain ToolCallBlock for these edits — no diff, no undo, no entry in
    // The CLI audit path — unlike write_project_file (BYOK chat's own file tool), which
    // has always called recordProjectAuditChange. This exercises the tool_start (snapshot
    // "before") / tool_end (diff against "after") flow added to close that gap.
    const testRoot = path.join(process.cwd(), '.test-chat-cli-audit')
    const targetFile = path.join(testRoot, 'src', 'example.ts')
    mkdirSync(path.dirname(targetFile), { recursive: true })
    writeFileSync(targetFile, 'export const value = 1\n', 'utf8')

    state.allOverrides.set('SELECT id, config_json FROM projects', [
      { id: 'proj-1', config_json: JSON.stringify({ rootDirectory: testRoot }) },
    ])

    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, _req: unknown, onChunk: (chunk: string) => void, onEvent: (event: unknown) => void) => {
        onEvent({ type: 'tool_start', id: 'call-1', name: 'Write', input: { file_path: targetFile, content: 'export const value = 2\n' } })
        // Simulates the CLI subprocess actually performing the edit on disk between the two
        // events — Nexy never writes this itself, it only observes tool_start/tool_end.
        writeFileSync(targetFile, 'export const value = 2\n', 'utf8')
        onEvent({ type: 'tool_end', id: 'call-1', content: 'File written', isError: false })
        onChunk('Done')
        return 'Done'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    try {
      const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
      await handler({ sender: {} }, 'conv-cli-audit', 'edit the file', { projectId: 'proj-1' })

      expect(state.recordProjectAuditChange).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'proj-1',
        source: 'cli-tool',
        relativePath: 'src/example.ts',
        status: 'modified',
        lastOperation: 'write',
        diff: { hunks: expect.arrayContaining([expect.objectContaining({
          lines: expect.arrayContaining([
            expect.objectContaining({ type: 'removed', content: 'export const value = 1' }),
            expect.objectContaining({ type: 'added', content: 'export const value = 2' }),
          ]),
        })]) },
      }))
    } finally {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  it('does not record Project Audit for a failed CLI file-edit tool call', async () => {
    const testRoot = path.join(process.cwd(), '.test-chat-cli-audit-fail')
    const targetFile = path.join(testRoot, 'src', 'example.ts')
    mkdirSync(path.dirname(targetFile), { recursive: true })
    writeFileSync(targetFile, 'export const value = 1\n', 'utf8')

    state.allOverrides.set('SELECT id, config_json FROM projects', [
      { id: 'proj-1', config_json: JSON.stringify({ rootDirectory: testRoot }) },
    ])

    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, _req: unknown, onChunk: (chunk: string) => void, onEvent: (event: unknown) => void) => {
        onEvent({ type: 'tool_start', id: 'call-1', name: 'Write', input: { file_path: targetFile, content: 'export const value = 2\n' } })
        onEvent({ type: 'tool_end', id: 'call-1', content: '<tool_use_error>Permission denied</tool_use_error>', isError: true })
        onChunk('Could not write the file.')
        return 'Could not write the file.'
      }),
    }
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)

    try {
      const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
      await handler({ sender: {} }, 'conv-cli-audit-fail', 'edit the file', { projectId: 'proj-1' })

      expect(state.recordProjectAuditChange).not.toHaveBeenCalled()
    } finally {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  it('attaches a real diff when write_project_file overwrites an existing file, matching the CLI-driven audit path', async () => {
    // Regression: write_project_file recorded a Project Audit entry with no diff at all
    // (diff omitted entirely), so the audit diff is only available for
    // Code-Changes-sourced rows even though every source rendered the same affordance.
    const testRoot = path.join(process.cwd(), '.test-chat-write-project-file')
    const targetFile = path.join(testRoot, 'notes.md')
    mkdirSync(testRoot, { recursive: true })
    writeFileSync(targetFile, 'old notes', 'utf8')

    vi.mocked(parseProjectConfig).mockReturnValueOnce({
      ...DEFAULT_PROJECT_CONFIG,
      rootDirectory: testRoot,
    } as ReturnType<typeof parseProjectConfig>)
    vi.mocked(requestApproval).mockResolvedValue(true)
    // inferProjectAuditTarget (called inside write_project_file) resolves the project via
    // getDatabase() directly, independent of the stubDb passed to buildChatContext below.
    state.allOverrides.set('SELECT id, config_json FROM projects', [
      { id: 'proj-1', config_json: JSON.stringify({ rootDirectory: testRoot }) },
    ])

    const stubDb = {
      prepare: (sql: string) => ({
        get: () => (sql.includes('COUNT(*)') ? { count: 0 } : undefined),
        all: () => [],
        run: () => ({ changes: 1 }),
      }),
    } as unknown as Parameters<typeof buildChatContext>[0]
    const stubWebContents = { isDestroyed: () => false } as unknown as Parameters<typeof buildChatContext>[4]

    try {
      const built = await buildChatContext(
        stubDb, 'conv-write-project-file', 'update notes.md',
        { projectId: 'proj-1' }, stubWebContents, vi.fn(),
      )
      const writeHandler = built.fileInlineHandlers.get('write_project_file')!
      const result = await writeHandler({ path: 'notes.md', content: 'new notes' })

      expect(result.success).toBe(true)
      expect(state.recordProjectAuditChange).toHaveBeenCalledWith(expect.objectContaining({
        source: 'chat-tool',
        relativePath: 'notes.md',
        status: 'modified',
        lastOperation: 'write',
        diff: { hunks: expect.arrayContaining([expect.objectContaining({
          lines: expect.arrayContaining([
            expect.objectContaining({ type: 'removed', content: 'old notes' }),
            expect.objectContaining({ type: 'added', content: 'new notes' }),
          ]),
        })]) },
      }))
    } finally {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  it('exposes ExitPlanMode to provider chats and clears the persisted mode only after approval', async () => {
    vi.mocked(requestApproval).mockResolvedValue(true)
    const updates: string[] = []
    const stubDb = {
      prepare: (sql: string) => ({
        get: () => {
          if (sql.includes('COUNT(*)')) return { count: 0 }
          if (sql.includes('SELECT thinking_effort_override')) {
            return {
              thinking_effort_override: null,
              full_auto_approve_override: null,
              terminal_sandbox_override: null,
              cli_mode_override: null,
              codex_execution_mode_override: null,
            }
          }
          return undefined
        },
        all: () => [],
        run: () => {
          updates.push(sql)
          return { changes: 1 }
        },
      }),
    } as unknown as Parameters<typeof buildChatContext>[0]
    const stubWebContents = {
      isDestroyed: () => false,
      send: vi.fn(),
    } as unknown as Parameters<typeof buildChatContext>[4]

    const built = await buildChatContext(
      stubDb,
      'conv-provider-plan',
      'Plan this change',
      { planMode: true, onPlanFinalized: state.saveFinalizedPlanArtifact },
      stubWebContents,
      vi.fn(),
    )

    expect(built.planToolDefs.map((tool) => tool.function.name)).toEqual(['exit_plan_mode'])
    const result = await built.planInlineHandlers.get('exit_plan_mode')?.({ plan: '1. Inspect\n2. Implement' })
    expect(result?.success).toBe(true)
    expect(state.saveFinalizedPlanArtifact).toHaveBeenCalledWith('1. Inspect\n2. Implement')
    expect(updates.some((sql) => sql.includes('SET cli_mode_override = NULL'))).toBe(true)
    expect(requestApproval).toHaveBeenCalledWith(
      stubWebContents,
      'exit_plan_mode',
      { plan: '1. Inspect\n2. Implement' },
      'Approve this plan and start implementing?',
      { noRemember: true, conversationId: 'conv-provider-plan' },
    )
  })

  it('injects the approval-gated Nexy skill bridge for an explicit CLI skill-save request', async () => {
    const capturedReqs: Array<{ mcpServers?: Array<{ key: string }>; allowedTools?: string[] }> = []
    const close = vi.fn()
    let approveSkill: ((name: string, args: Record<string, unknown>) => Promise<boolean>) | undefined
    const mockAdapter = {
      isAvailable: () => true,
      send: vi.fn(async (_win: unknown, req: { mcpServers?: Array<{ key: string }>; allowedTools?: string[] }) => {
        capturedReqs.push({ mcpServers: req.mcpServers, allowedTools: req.allowedTools })
        return 'cli response'
      }),
    }
    vi.mocked(startSkillSaveMcpBridge).mockImplementation(async (approval) => {
      approveSkill = approval
      return {
        server: { id: 'nexy-skill-save', key: 'nexy_skill', command: 'node', args: [], env: {} },
        allowedTool: 'mcp__nexy_skill__save_skill',
        close,
      }
    })
    vi.mocked(getAdapter).mockReturnValue(mockAdapter as never)
    vi.mocked(ClaudeAdapter.isAvailable).mockReturnValue(true)
    vi.mocked(retrieveAuthMode).mockReturnValue('none')
    vi.mocked(getApiKey).mockReturnValue(null)
    vi.mocked(requestApproval).mockResolvedValue(true)

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<unknown>
    await handler({ sender: {} }, 'conv-cli-save-skill', 'Create a reusable skill and save it into Nexy.', { cliBackend: 'claude-cli' })

    expect(startSkillSaveMcpBridge).toHaveBeenCalledOnce()
    expect(capturedReqs[0].mcpServers).toEqual([{ id: 'nexy-skill-save', key: 'nexy_skill', command: 'node', args: [], env: {} }])
    expect(capturedReqs[0].allowedTools).toEqual(['mcp__nexy_skill__save_skill'])
    await expect(approveSkill?.('demo', { name: 'demo' })).resolves.toBe(true)
    expect(requestApproval).toHaveBeenCalledWith(
      expect.anything(),
      'save_skill',
      { name: 'demo' },
      'Save skill to library: demo',
      { noRemember: true, conversationId: 'conv-cli-save-skill' },
    )
    expect(close).toHaveBeenCalledOnce()
  })

  it('exposes save_skill to a normal provider chat when the user asks to save a skill', async () => {
    const stubDb = {
      prepare: (sql: string) => ({
        get: () => {
          if (sql.includes('COUNT(*)')) return { count: 0 }
          return { agent_id: null }
        },
        all: () => [],
        run: () => ({ changes: 1 }),
      }),
    } as unknown as Parameters<typeof buildChatContext>[0]
    const stubWebContents = {
      isDestroyed: () => false,
      send: vi.fn(),
    } as unknown as Parameters<typeof buildChatContext>[4]

    const built = await buildChatContext(
      stubDb,
      'conv-provider-save-skill',
      'Create a reusable skill for this workflow and save it into Nexy.',
      {},
      stubWebContents,
      vi.fn(),
    )

    expect(built.skillToolDefs.map((tool) => tool.function.name)).toEqual(['save_skill'])
    expect(built.skillInlineHandlers.has('save_skill')).toBe(true)
  })

  it('broadcasts messages and stream-end to mobile after orchestration completes', async () => {
    // Set up database to return a project with orchestrationEnabled=true and two agents
    state.getOverrides.set('SELECT name, config_json FROM projects', {
      name: 'Test Project',
      config_json: JSON.stringify({ workflowMode: 'orchestrated', orchestrationEnabled: true }),
    })
    state.getOverrides.set('SELECT project_id FROM conversations', { project_id: 'proj-1' })
    state.allOverrides.set('project_agents pa JOIN agents', [
      { agent_id: 'agent-leader', is_primary: 1, sort_order: 0, config_json: JSON.stringify({ name: 'Leader', icon: '🎯' }) },
      { agent_id: 'agent-worker', is_primary: 0, sort_order: 1, config_json: JSON.stringify({ name: 'Worker', icon: '🔨' }) },
    ])

    vi.mocked(runOrchestration).mockResolvedValueOnce({
      finalContent: 'Orchestrated answer',
      teamActivity: [],
    })

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    const result = await handler({ sender: {} }, 'conv-orch', 'Do the thing', { projectId: 'proj-1' })

    expect(result.assistantMsgId).toBeTruthy()
    expect(vi.mocked(runOrchestration)).toHaveBeenCalledOnce()

    // Android must receive messages push before stream-end so the UI can update
    expect(state.events).toContain('mobile:messages')
    expect(state.events).toContain('mobile:stream-end')
    expect(state.events.indexOf('mobile:messages')).toBeLessThan(state.events.indexOf('mobile:stream-end'))
    expect(state.events).toContain('mobile:complete')

    const assistantMessage = state.messages.find((m) => m.role === 'assistant')
    expect(assistantMessage?.content).toBe('Orchestrated answer')
  })

  it('broadcasts error and stream-end to mobile when orchestration throws', async () => {
    state.getOverrides.set('SELECT name, config_json FROM projects', {
      name: 'Test Project',
      config_json: JSON.stringify({ workflowMode: 'orchestrated', orchestrationEnabled: true }),
    })
    state.getOverrides.set('SELECT project_id FROM conversations', { project_id: 'proj-1' })
    state.allOverrides.set('project_agents pa JOIN agents', [
      { agent_id: 'agent-leader', is_primary: 1, sort_order: 0, config_json: JSON.stringify({ name: 'Leader', icon: '🎯' }) },
      { agent_id: 'agent-worker', is_primary: 0, sort_order: 1, config_json: JSON.stringify({ name: 'Worker', icon: '🔨' }) },
    ])

    vi.mocked(runOrchestration).mockRejectedValueOnce(new Error('Orchestration network error'))

    const handler = state.handlers.get('chat:send-message') as (...args: unknown[]) => Promise<{ assistantMsgId: string }>
    const result = await handler({ sender: {} }, 'conv-orch-err', 'Do the thing', { projectId: 'proj-1' })

    expect(result.assistantMsgId).toBeTruthy()
    expect(state.events).toContain('mobile:messages')
    expect(state.events).toContain('mobile:stream-end')
    expect(state.events).toContain('mobile:error')
    const assistantMessage = state.messages.find((m) => m.role === 'assistant')
    expect(assistantMessage?.content).toContain('Orchestration network error')
  })
})

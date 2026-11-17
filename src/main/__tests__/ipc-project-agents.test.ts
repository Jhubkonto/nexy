import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockDb, ipcHandlers, mockIpcMain } = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()

  const stmtResults = new Map<string, unknown>()

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((..._args: unknown[]) => ({ changes: 1 })),
      get: vi.fn((..._args: unknown[]): unknown => stmtResults.get(sql) ?? undefined),
      all: vi.fn((): unknown[] => (stmtResults.get(sql) as unknown[]) ?? [])
    })),
    exec: vi.fn(),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
    _setResult: (sql: string, value: unknown) => stmtResults.set(sql, value),
    _clearResults: () => stmtResults.clear()
  }

  return {
    mockDb,
    ipcHandlers,
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => [{}]) }
}))

vi.mock('../database', () => ({
  getDatabase: () => mockDb
}))

vi.mock('../settings-handlers', () => ({ registerSettingsHandlers: vi.fn() }))
vi.mock('../conversation-handlers', () => ({
  registerConversationHandlers: vi.fn(),
  registerMessageHandlers: vi.fn(),
}))
vi.mock('../chat-handlers', () => ({
  registerChatHandlers: vi.fn(),
  clearDirListingCache: vi.fn(),
}))
vi.mock('../file-handlers', () => ({
  registerFileHandlers: vi.fn(),
  registerContextHandlers: vi.fn(),
  listDirectoryEntries: vi.fn(),
}))
vi.mock('../system-handlers', () => ({ registerSystemHandlers: vi.fn() }))
vi.mock('../agents', () => ({ registerAgentHandlers: vi.fn() }))
vi.mock('../skills', () => ({ registerSkillHandlers: vi.fn() }))
vi.mock('../knowledge', () => ({ registerKnowledgeHandlers: vi.fn() }))
vi.mock('../wiki-handlers', () => ({ registerWikiHandlers: vi.fn() }))
vi.mock('../prompt-handlers', () => ({ registerPromptHandlers: vi.fn() }))
vi.mock('../tools', () => ({ registerToolHandlers: vi.fn() }))
vi.mock('../mcp', () => ({ registerMcpHandlers: vi.fn(), initDesktopNavigatorMcp: vi.fn(), initWorkHistoryMcp: vi.fn() }))
vi.mock('../providers', () => ({ registerProviderHandlers: vi.fn() }))
vi.mock('../screen-capture-handlers', () => ({ registerScreenCaptureHandlers: vi.fn() }))
vi.mock('../model-catalog-handlers', () => ({ registerModelCatalogHandlers: vi.fn() }))
vi.mock('../cli-detection', () => ({ registerCliHandlers: vi.fn() }))
vi.mock('../ws-handlers', () => ({
  registerWsHandlers: vi.fn(),
  registerUserInputResolver: vi.fn(),
  registerPendingUserInputProvider: vi.fn(),
}))
vi.mock('../build-handlers', () => ({ registerBuildHandlers: vi.fn() }))
vi.mock('../android-handlers', () => ({ registerAndroidHandlers: vi.fn() }))
vi.mock('../model-availability', () => ({ registerModelAvailabilityHandlers: vi.fn() }))
vi.mock('../error-log-handlers', () => ({ registerErrorLogHandlers: vi.fn() }))
vi.mock('../project-generator', () => ({ registerProjectGeneratorHandlers: vi.fn() }))
vi.mock('../agent-generator', () => ({ registerAgentGeneratorHandlers: vi.fn() }))
vi.mock('../artifacts', () => ({ registerArtifactHandlers: vi.fn() }))
vi.mock('../artifact-generator', () => ({ registerArtifactGeneratorHandlers: vi.fn() }))
vi.mock('../skill-generator', () => ({ registerSkillGeneratorHandlers: vi.fn() }))
vi.mock('../scheduler-generator', () => ({ registerScheduleGeneratorHandlers: vi.fn() }))
vi.mock('../voice-handlers', () => ({ registerVoiceHandlers: vi.fn() }))
vi.mock('../scheduler-handlers', () => ({ registerSchedulerHandlers: vi.fn() }))
vi.mock('../debrief-handlers', () => ({ registerDebriefHandlers: vi.fn() }))
vi.mock('../quiz-handlers', () => ({ registerQuizHandlers: vi.fn() }))
vi.mock('../teachback-handlers', () => ({ registerTeachbackHandlers: vi.fn() }))
vi.mock('../screen-capture', () => ({
  cacheExternalWindowLabel: vi.fn().mockResolvedValue(undefined),
  consumeSuppressFocusEvent: vi.fn(() => false),
}))

vi.mock('../safe-handle', () => ({
  safeHandle: async (channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handle(channel, async (...args: unknown[]) => {
      try {
        return await handler(...args)
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Unknown error' }
      }
    })
  }
}))

vi.mock('crypto', () => ({ randomUUID: vi.fn(() => 'test-uuid') }))
vi.mock('fs', () => ({ readFileSync: vi.fn(), writeFileSync: vi.fn() }))

// ── Helpers ────────────────────────────────────────────────────────────────────

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`No handler registered for "${channel}"`)
  return handler({}, ...args)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('project-agents — IPC Handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    ipcHandlers.clear()
    mockDb._clearResults()

    // Prevent agents/projects seed queries from throwing
    mockDb._setResult('SELECT COUNT(*) as count FROM agents WHERE is_default = 1', { count: 1 })

    await import('../ipc-handlers').then((mod) => mod.registerIpcHandlers())
  })

  // ── project:list-agents ───────────────────────────────────────────────────

  describe('project:list-agents', () => {
    it('pa-1: returns agent rows mapped to camelCase', async () => {
      mockDb._setResult(
        'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC',
        [
          {
            agent_id: 'agent-1',
            is_primary: 1,
            sort_order: 0,
            config_json: JSON.stringify({ name: 'Agent One', icon: '🤖' })
          }
        ]
      )

      const result = await invoke('project:list-agents', 'proj-1')
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        agentId: 'agent-1',
        isPrimary: true,
        sortOrder: 0,
        agentName: 'Agent One',
        agentIcon: '🤖'
      })
    })

    it('pa-2: returns empty array when project has no agents', async () => {
      mockDb._setResult(
        'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC',
        []
      )

      const result = await invoke('project:list-agents', 'proj-empty')
      expect(result).toEqual([])
    })

    it('pa-3: returns error object on thrown exception', async () => {
      mockDb.prepare.mockImplementationOnce(() => {
        throw new Error('DB failure')
      })

      const result = await invoke('project:list-agents', 'proj-x')
      expect(result).toHaveProperty('error')
    })
  })

  // ── project:add-agent ─────────────────────────────────────────────────────

  describe('project:add-agent', () => {
    it('pa-4: inserts membership row and returns true', async () => {
      const result = await invoke('project:add-agent', 'proj-1', 'agent-2')
      expect(result).toBe(true)

      // The prepare mock was called with an INSERT ... OR IGNORE statement
      const insertCall = mockDb.prepare.mock.calls.find(([sql]: string[]) =>
        sql.includes('INSERT OR IGNORE INTO project_agents')
      )
      expect(insertCall).toBeDefined()
    })

    it('pa-5: returns error object when DB throws', async () => {
      mockDb.prepare.mockImplementationOnce(() => { throw new Error('constraint') })
      const result = await invoke('project:add-agent', 'proj-1', 'agent-bad')
      expect(result).toHaveProperty('error')
    })
  })

  // ── project:remove-agent ──────────────────────────────────────────────────

  describe('project:remove-agent', () => {
    it('pa-6: deletes row and returns true', async () => {
      const result = await invoke('project:remove-agent', 'proj-1', 'agent-2')
      expect(result).toBe(true)

      const deleteCall = mockDb.prepare.mock.calls.find(([sql]: string[]) =>
        sql.includes('DELETE FROM project_agents')
      )
      expect(deleteCall).toBeDefined()
    })

    it('pa-7: returns error object when DB throws', async () => {
      mockDb.prepare.mockImplementationOnce(() => { throw new Error('boom') })
      const result = await invoke('project:remove-agent', 'proj-1', 'agent-x')
      expect(result).toHaveProperty('error')
    })
  })

  // ── project:set-primary-agent ─────────────────────────────────────────────

  describe('project:set-primary-agent', () => {
    it('pa-8: calls transaction and returns true', async () => {
      const result = await invoke('project:set-primary-agent', 'proj-1', 'agent-2')
      expect(result).toBe(true)
      expect(mockDb.transaction).toHaveBeenCalled()
    })

    it('pa-9: returns error when DB throws', async () => {
      mockDb.prepare.mockImplementationOnce(() => { throw new Error('tx fail') })
      const result = await invoke('project:set-primary-agent', 'proj-1', 'agent-x')
      expect(result).toHaveProperty('error')
    })
  })

  // ── project:reorder-agents ────────────────────────────────────────────────

  describe('project:reorder-agents', () => {
    it('pa-10: updates sort_order for each agent and returns true', async () => {
      const orderedIds = ['agent-b', 'agent-a', 'agent-c']
      const result = await invoke('project:reorder-agents', 'proj-1', orderedIds)
      expect(result).toBe(true)

      // Prepare is called once; run is called once per agent
      const prepareCall = mockDb.prepare.mock.calls.find(([sql]: string[]) =>
        sql.includes('UPDATE project_agents SET sort_order')
      )
      expect(prepareCall).toBeDefined()
    })

    it('pa-11: returns error when DB throws', async () => {
      mockDb.prepare.mockImplementationOnce(() => { throw new Error('reorder fail') })
      const result = await invoke('project:reorder-agents', 'proj-1', ['a'])
      expect(result).toHaveProperty('error')
    })
  })
})

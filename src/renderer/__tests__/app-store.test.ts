import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentConfig } from '../../shared/types'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { useAppStore } from '../../renderer/store/app-store'

let mockApi: MockApi
const initialState = useAppStore.getState()

const mockAgents: AgentConfig[] = [
  {
    id: 'a1',
    name: 'Agent 1',
    icon: '🤖',
    systemPrompt: '',
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 4096,
    contextDirectories: [],
    contextFiles: [],
    mcpServers: [],
    agenticMode: false,
    tools: {
      fileEdit: { enabled: false, approval: 'always-ask', instructions: '' },
      terminal: { enabled: false, approval: 'always-ask', instructions: '' },
      webFetch: { enabled: false, approval: 'always-ask', instructions: '' },
    },
    responseFormat: 'default',
  },
]

beforeEach(() => {
  mockApi = setupMockApi()
  useAppStore.setState(initialState, true)
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('app store', () => {
  it('hydrates BYOK auth state from IPC', async () => {
    mockApi.authStatus.mockResolvedValue({ authenticated: true, mode: 'byok', user: null, cliInstalled: false })

    await useAppStore.getState().checkAuth()

    expect(useAppStore.getState().authState).toEqual({
      authenticated: true,
      mode: 'byok',
      user: null,
      cliInstalled: false,
      clis: { claude: false, codex: false },
    })
  })

  it('enables BYOK auth mode', async () => {
    mockApi.authLoginByok.mockResolvedValue({ success: true })

    await useAppStore.getState().loginByok()

    expect(useAppStore.getState().authState).toEqual({
      authenticated: true,
      mode: 'byok',
      user: null,
      cliInstalled: false,
      clis: { claude: false, codex: false },
    })
  })

  it('loads conversations from IPC', async () => {
    const mockConversations = [
      { id: 'c1', agent_id: null, project_id: null, title: 'Chat 1', created_at: 1000, updated_at: 1000, model: null, pinned: 0 },
      { id: 'c2', agent_id: null, project_id: null, title: 'Chat 2', created_at: 2000, updated_at: 2000, model: null, pinned: 0 },
    ]
    mockApi.listConversations.mockResolvedValue(mockConversations)

    await useAppStore.getState().loadConversations()

    expect(useAppStore.getState().conversations).toEqual(mockConversations)
  })

  it('starts a new chat by clearing currentConversationId', () => {
    useAppStore.setState({ currentConversationId: 'c1' })

    useAppStore.getState().newChat()

    expect(useAppStore.getState().currentConversationId).toBeNull()
  })

  it('loads agents from IPC', async () => {
    mockApi.listAgents.mockResolvedValue(mockAgents)

    await useAppStore.getState().loadAgents()

    expect(useAppStore.getState().agents).toEqual(mockAgents)
  })

  describe('hydrate()', () => {
    it('restores compact mode and the expanded width without rewriting settings', async () => {
      mockApi.getSetting.mockImplementation(async (key: string) => ({ sidebar_collapsed: 'true', sidebar_expanded_width: '315' }[key] ?? null))
      await useAppStore.getState().hydrate()
      expect(useAppStore.getState().sidebarCollapsed).toBe(true)
      expect(useAppStore.getState().sidebarExpandedWidth).toBe(315)
      expect(mockApi.setSetting).not.toHaveBeenCalledWith('sidebar_collapsed', expect.anything())
      expect(mockApi.setSetting).not.toHaveBeenCalledWith('sidebar_expanded_width', expect.anything())
    })

    it.each([null, '', 'bad', 'Infinity', '0', '159', '481'])('uses sidebar defaults for invalid settings: %s', async (width) => {
      mockApi.getSetting.mockImplementation(async (key: string) => key === 'sidebar_expanded_width' ? width : 'bad')
      await useAppStore.getState().hydrate()
      expect(useAppStore.getState().sidebarCollapsed).toBe(false)
      expect(useAppStore.getState().sidebarExpandedWidth).toBe(256)
    })

    it('keeps sidebar defaults when reading settings fails', async () => {
      mockApi.getSetting.mockRejectedValue(new Error('Unavailable'))
      await useAppStore.getState().hydrate()
      expect(useAppStore.getState().sidebarCollapsed).toBe(false)
      expect(useAppStore.getState().sidebarExpandedWidth).toBe(256)
    })

    beforeEach(() => {
      mockApi.listConversations.mockResolvedValue([])
      mockApi.listAgents.mockResolvedValue([])
      mockApi.listProjects.mockResolvedValue([])
      mockApi.listModelCatalog.mockResolvedValue([])
      mockApi.getTheme.mockResolvedValue('dark')
    })

    it('auto-completes onboarding when CLI is installed', async () => {
      mockApi.authStatus.mockResolvedValue({ authenticated: false, mode: 'none', user: null, cliInstalled: true })
      mockApi.getSetting.mockResolvedValue(null)

      await useAppStore.getState().hydrate()

      expect(mockApi.setSetting).toHaveBeenCalledWith('onboarding_complete', 'true')
      expect(useAppStore.getState().showOnboarding).toBe(false)
    })

    it('auto-completes onboarding when BYOK authenticated', async () => {
      mockApi.authStatus.mockResolvedValue({ authenticated: true, mode: 'byok', user: null, cliInstalled: false })
      mockApi.getSetting.mockResolvedValue(null)

      await useAppStore.getState().hydrate()

      expect(mockApi.setSetting).toHaveBeenCalledWith('onboarding_complete', 'true')
      expect(useAppStore.getState().showOnboarding).toBe(false)
    })

    it('shows onboarding when no provider configured and onboarding not complete', async () => {
      mockApi.authStatus.mockResolvedValue({ authenticated: false, mode: 'none', user: null, cliInstalled: false })
      mockApi.getSetting.mockResolvedValue(null)

      await useAppStore.getState().hydrate()

      expect(mockApi.setSetting).not.toHaveBeenCalledWith('onboarding_complete', 'true')
      expect(useAppStore.getState().showOnboarding).toBe(true)
    })

    it('skips onboarding when already marked complete', async () => {
      mockApi.authStatus.mockResolvedValue({ authenticated: false, mode: 'none', user: null, cliInstalled: false })
      mockApi.getSetting.mockResolvedValue('true')

      await useAppStore.getState().hydrate()

      expect(useAppStore.getState().showOnboarding).toBe(false)
      expect(mockApi.setSetting).not.toHaveBeenCalledWith('onboarding_complete', 'true')
    })
  })
})

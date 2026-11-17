import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCacheExternalWindowLabel, mockConsumeSuppressFocusEvent } = vi.hoisted(() => ({
  mockCacheExternalWindowLabel: vi.fn().mockResolvedValue(undefined),
  mockConsumeSuppressFocusEvent: vi.fn().mockReturnValue(false),
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

vi.mock('../project-handlers', () => ({
  registerProjectHandlers: vi.fn(),
  registerProjectAgentHandlers: vi.fn(),
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
vi.mock('../build-handlers', () => ({ registerBuildHandlers: vi.fn() }))
vi.mock('../agents', () => ({ registerAgentHandlers: vi.fn() }))
vi.mock('../skills', () => ({ registerSkillHandlers: vi.fn() }))
vi.mock('../knowledge', () => ({ registerKnowledgeHandlers: vi.fn() }))
vi.mock('../wiki-handlers', () => ({ registerWikiHandlers: vi.fn() }))
vi.mock('../prompt-handlers', () => ({ registerPromptHandlers: vi.fn() }))
vi.mock('../tools', () => ({ registerToolHandlers: vi.fn() }))
vi.mock('../mcp', () => ({ registerMcpHandlers: vi.fn(), initDesktopNavigatorMcp: vi.fn(), initWorkHistoryMcp: vi.fn() }))
vi.mock('../providers', () => ({
  registerProviderHandlers: vi.fn(),
  PROVIDERS: [],
  isProviderConfigured: vi.fn(() => false),
  getOpenRouterModels: vi.fn(() => []),
  fetchAndCacheOpenRouterModels: vi.fn(),
  retrieveApiKey: vi.fn(() => null),
}))
vi.mock('../screen-capture-handlers', () => ({ registerScreenCaptureHandlers: vi.fn() }))
vi.mock('../model-catalog-handlers', () => ({ registerModelCatalogHandlers: vi.fn() }))
vi.mock('../cli-detection', () => ({ registerCliHandlers: vi.fn() }))
vi.mock('../ws-handlers', () => ({
  registerWsHandlers: vi.fn(),
  registerUserInputResolver: vi.fn(),
  registerPendingUserInputProvider: vi.fn(),
}))
vi.mock('../android-handlers', () => ({ registerAndroidHandlers: vi.fn() }))
vi.mock('../model-availability', () => ({ registerModelAvailabilityHandlers: vi.fn() }))
vi.mock('../voice-handlers', () => ({ registerVoiceHandlers: vi.fn() }))
vi.mock('../error-log-handlers', () => ({ registerErrorLogHandlers: vi.fn() }))
vi.mock('../project-generator', () => ({ registerProjectGeneratorHandlers: vi.fn() }))
vi.mock('../agent-generator', () => ({ registerAgentGeneratorHandlers: vi.fn() }))
vi.mock('../artifacts', () => ({ registerArtifactHandlers: vi.fn() }))
vi.mock('../artifact-generator', () => ({ registerArtifactGeneratorHandlers: vi.fn() }))
vi.mock('../skill-generator', () => ({ registerSkillGeneratorHandlers: vi.fn() }))
vi.mock('../scheduler-generator', () => ({ registerScheduleGeneratorHandlers: vi.fn() }))
vi.mock('../scheduler-handlers', () => ({ registerSchedulerHandlers: vi.fn() }))
vi.mock('../debrief-handlers', () => ({ registerDebriefHandlers: vi.fn() }))
vi.mock('../quiz-handlers', () => ({ registerQuizHandlers: vi.fn() }))
vi.mock('../teachback-handlers', () => ({ registerTeachbackHandlers: vi.fn() }))
vi.mock('../screen-capture', () => ({
  cacheExternalWindowLabel: mockCacheExternalWindowLabel,
  consumeSuppressFocusEvent: mockConsumeSuppressFocusEvent,
}))

describe('registerIpcHandlers window events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wires blur and focus listeners for clipboard integration', async () => {
    const listeners = new Map<string, () => void>()
    const mainWindow = {
      getTitle: vi.fn().mockReturnValue('Nexy'),
      on: vi.fn((event: string, handler: () => void) => {
        listeners.set(event, handler)
      }),
      webContents: { send: vi.fn() },
    }

    const { registerIpcHandlers } = await import('../ipc-handlers')
    registerIpcHandlers(mainWindow as never)

    listeners.get('blur')?.()
    expect(mockCacheExternalWindowLabel).toHaveBeenCalledWith('Nexy')

    listeners.get('focus')?.()
    expect(mockConsumeSuppressFocusEvent).toHaveBeenCalled()
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('clipboard:auto-focus')
  }, 15000)

  it('skips auto-clipboard when the focus event is suppressed', async () => {
    mockConsumeSuppressFocusEvent.mockReturnValue(true)
    const listeners = new Map<string, () => void>()
    const mainWindow = {
      getTitle: vi.fn().mockReturnValue('Nexy'),
      on: vi.fn((event: string, handler: () => void) => {
        listeners.set(event, handler)
      }),
      webContents: { send: vi.fn() },
    }

    const { registerIpcHandlers } = await import('../ipc-handlers')
    registerIpcHandlers(mainWindow as never)

    listeners.get('focus')?.()

    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
  })
})

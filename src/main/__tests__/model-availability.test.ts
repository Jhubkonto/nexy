import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: class {} }))
vi.mock('../database', () => ({ getDatabase: vi.fn() }))

const {
  safeHandleMock,
  detectCliMock,
  getCliModelsMock,
  isProviderConfiguredMock,
  getProviderModelIdsMock,
  retrieveApiKeyMock,
  getOpenRouterModelsMock,
  getCachedProviderModelsMock,
  getAzureEndpointMock,
  fetchAndCacheOpenRouterModelsMock,
  fetchAndCacheOpenAIModelsMock,
  fetchAndCacheGeminiModelsMock,
  fetchAndCacheAzureModelsMock,
  getCachedAnthropicModelsMock,
  fetchAndCacheAnthropicModelsMock,
  getClaudeCliModelChoicesMock,
} = vi.hoisted(() => ({
  safeHandleMock: vi.fn(),
  detectCliMock: vi.fn(),
  getCliModelsMock: vi.fn(),
  isProviderConfiguredMock: vi.fn(),
  getProviderModelIdsMock: vi.fn((provider: { models: string[] }) => provider.models),
  retrieveApiKeyMock: vi.fn(),
  getOpenRouterModelsMock: vi.fn(),
  getCachedProviderModelsMock: vi.fn(() => []),
  getAzureEndpointMock: vi.fn(() => null),
  fetchAndCacheOpenRouterModelsMock: vi.fn(),
  fetchAndCacheOpenAIModelsMock: vi.fn(),
  fetchAndCacheGeminiModelsMock: vi.fn(),
  fetchAndCacheAzureModelsMock: vi.fn(),
  getCachedAnthropicModelsMock: vi.fn(),
  fetchAndCacheAnthropicModelsMock: vi.fn(),
  getClaudeCliModelChoicesMock: vi.fn<() => any[]>(() => []),
}))

vi.mock('../safe-handle', () => ({ safeHandle: safeHandleMock }))
vi.mock('../cli-detection', () => ({ detectCli: detectCliMock, getCliModels: getCliModelsMock }))
vi.mock('../cli-adapters/claude-model-probe', () => ({ getClaudeCliModelChoices: getClaudeCliModelChoicesMock }))
vi.mock('../providers', () => ({
  PROVIDERS: [
    { name: 'anthropic', label: 'Anthropic', models: ['claude-sonnet-4-6', 'claude-opus-4-8'] },
    { name: 'openai',    label: 'OpenAI',    models: ['gpt-5.5', 'gpt-5.4'] },
    { name: 'azure',     label: 'Azure OpenAI', models: ['gpt-4o'] },
  ],
  isProviderConfigured: isProviderConfiguredMock,
  getProviderModelIds: getProviderModelIdsMock,
  retrieveApiKey: retrieveApiKeyMock,
  getOpenRouterModels: getOpenRouterModelsMock,
  getCachedProviderModels: getCachedProviderModelsMock,
  getAzureEndpoint: getAzureEndpointMock,
  fetchAndCacheOpenRouterModels: fetchAndCacheOpenRouterModelsMock,
  fetchAndCacheOpenAIModels: fetchAndCacheOpenAIModelsMock,
  fetchAndCacheGeminiModels: fetchAndCacheGeminiModelsMock,
  fetchAndCacheAzureModels: fetchAndCacheAzureModelsMock,
}))
vi.mock('../anthropic-models', () => ({
  getCachedAnthropicModels: getCachedAnthropicModelsMock,
  fetchAndCacheAnthropicModels: fetchAndCacheAnthropicModelsMock,
}))

import { getAvailableModelGroups, registerModelAvailabilityHandlers } from '../model-availability'

afterEach(() => {
  detectCliMock.mockReset()
  getCliModelsMock.mockReset()
  isProviderConfiguredMock.mockReset()
  retrieveApiKeyMock.mockReset()
  getOpenRouterModelsMock.mockReset()
  getCachedProviderModelsMock.mockReset()
  getCachedProviderModelsMock.mockReturnValue([])
  getAzureEndpointMock.mockReset()
  getAzureEndpointMock.mockReturnValue(null)
  fetchAndCacheOpenRouterModelsMock.mockReset()
  fetchAndCacheOpenAIModelsMock.mockReset()
  fetchAndCacheGeminiModelsMock.mockReset()
  fetchAndCacheAzureModelsMock.mockReset()
  getCachedAnthropicModelsMock.mockReset()
  fetchAndCacheAnthropicModelsMock.mockReset()
  getClaudeCliModelChoicesMock.mockReset()
  getClaudeCliModelChoicesMock.mockReturnValue([])
  getProviderModelIdsMock.mockReset()
  getProviderModelIdsMock.mockImplementation((provider: { models: string[] }) => provider.models)
  safeHandleMock.mockReset()
})

describe('getAvailableModelGroups', () => {
  beforeEach(() => {
    detectCliMock.mockResolvedValue({ installed: false, path: null, version: null })
    isProviderConfiguredMock.mockReturnValue(false)
  })

  it('returns empty array when nothing is configured', async () => {
    await expect(getAvailableModelGroups()).resolves.toEqual([])
  })

  it('returns one CLI group for Claude CLI only', async () => {
    detectCliMock.mockImplementation((name: string) => Promise.resolve({ installed: name === 'claude', path: '/usr/bin/claude', version: null }))
    getClaudeCliModelChoicesMock.mockReturnValue([{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', source: 'validated' }])
    const groups = await getAvailableModelGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].sourceKey).toBe('claude-cli')
    expect(groups[0].sourceType).toBe('cli')
    expect(groups[0].sourceLabel).toBe('Claude CLI')
  })

  it('returns one CLI group for Codex CLI only', async () => {
    detectCliMock.mockImplementation((name: string) => Promise.resolve({ installed: name === 'codex', path: '/usr/bin/codex', version: null }))
    getCliModelsMock.mockReturnValue([{ id: 'gpt-5.5', label: 'GPT-5.5' }])
    const groups = await getAvailableModelGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].sourceKey).toBe('codex-cli')
    expect(groups[0].sourceType).toBe('cli')
  })

  it('returns one CLI group for Hermes Agent only', async () => {
    detectCliMock.mockImplementation((name: string) => Promise.resolve({ installed: name === 'hermes', path: '/usr/bin/hermes', version: null }))
    getCliModelsMock.mockReturnValue([{ id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Anthropic)' }])
    const groups = await getAvailableModelGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].sourceKey).toBe('hermes-cli')
    expect(groups[0].sourceType).toBe('cli')
    expect(groups[0].sourceLabel).toBe('Hermes Agent')
  })

  it('returns two CLI groups when both CLIs available, claude first', async () => {
    detectCliMock.mockImplementation((name: string) => Promise.resolve({ installed: name === 'claude' || name === 'codex', path: `/usr/bin/${name}`, version: null }))
    getCliModelsMock.mockReturnValue([{ id: 'gpt-5.5', label: 'GPT-5.5' }])
    getClaudeCliModelChoicesMock.mockReturnValue([{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', source: 'validated' }])
    const groups = await getAvailableModelGroups()
    expect(groups).toHaveLength(2)
    expect(groups[0].sourceKey).toBe('claude-cli')
    expect(groups[1].sourceKey).toBe('codex-cli')
  })

  it('returns one provider group when a single provider is configured', async () => {
    isProviderConfiguredMock.mockImplementation((name: string) => name === 'anthropic')
    const groups = await getAvailableModelGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].sourceKey).toBe('anthropic')
    expect(groups[0].sourceType).toBe('provider')
    expect(groups[0].sourceLabel).toBe('Anthropic')
  })

  it('prefixes azure model IDs with azure:', async () => {
    isProviderConfiguredMock.mockImplementation((name: string) => name === 'azure')
    const groups = await getAvailableModelGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].models[0].id).toBe('azure:gpt-4o')
  })

  it('returns CLI groups before provider groups', async () => {
    detectCliMock.mockImplementation((name: string) => Promise.resolve({ installed: name === 'claude' || name === 'codex', path: `/usr/bin/${name}`, version: null }))
    isProviderConfiguredMock.mockImplementation((name: string) => name === 'anthropic' || name === 'openai')
    getCliModelsMock.mockReturnValue([{ id: 'model-x', label: 'Model X' }])
    getClaudeCliModelChoicesMock.mockReturnValue([{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', source: 'validated' }])
    const groups = await getAvailableModelGroups()
    expect(groups).toHaveLength(4)
    expect(groups[0].sourceKey).toBe('claude-cli')
    expect(groups[1].sourceKey).toBe('codex-cli')
    expect(groups[2].sourceKey).toBe('anthropic')
    expect(groups[3].sourceKey).toBe('openai')
  })

  it('excludes CLI groups with no models', async () => {
    detectCliMock.mockImplementation((name: string) => Promise.resolve({ installed: name === 'claude', path: '/usr/bin/claude', version: null }))
    getCliModelsMock.mockReturnValue([])
    await expect(getAvailableModelGroups()).resolves.toEqual([])
  })
})

describe('registerModelAvailabilityHandlers', () => {
  beforeEach(() => {
    isProviderConfiguredMock.mockReturnValue(false)
    getOpenRouterModelsMock.mockReturnValue([])
    getCachedAnthropicModelsMock.mockReturnValue([])
  })

  it('registers the model:list-available IPC channel', () => {
    registerModelAvailabilityHandlers()
    expect(safeHandleMock).toHaveBeenCalledWith('model:list-available', expect.any(Function))
  })

  it('backfills the Anthropic model cache when key configured but cache empty', () => {
    isProviderConfiguredMock.mockImplementation((name: string) => name === 'anthropic')
    retrieveApiKeyMock.mockReturnValue('sk-ant-test')
    fetchAndCacheAnthropicModelsMock.mockResolvedValue(undefined)

    registerModelAvailabilityHandlers()

    expect(retrieveApiKeyMock).toHaveBeenCalledWith('anthropic')
    expect(fetchAndCacheAnthropicModelsMock).toHaveBeenCalledWith('sk-ant-test')
  })

  it('does not backfill Anthropic cache when already populated', () => {
    isProviderConfiguredMock.mockImplementation((name: string) => name === 'anthropic')
    getCachedAnthropicModelsMock.mockReturnValue([{ id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }])

    registerModelAvailabilityHandlers()

    expect(fetchAndCacheAnthropicModelsMock).not.toHaveBeenCalled()
  })

  it('does not backfill Anthropic cache when no key configured', () => {
    isProviderConfiguredMock.mockReturnValue(false)

    registerModelAvailabilityHandlers()

    expect(fetchAndCacheAnthropicModelsMock).not.toHaveBeenCalled()
  })
})

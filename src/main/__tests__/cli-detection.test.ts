import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ── Hoisted mocks ─────────────────────────────────────────── */
const { mockIpcMain, mockExecSync, mockExecFile, mockExistsSync, mockReadFileSync, getCachedAnthropicModelsMock, getCachedClaudeCliPtyModelsMock } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      _handlers: handlers
    },
    mockExecSync: vi.fn(),
    mockExecFile: vi.fn(),
    mockExistsSync: vi.fn(),
    mockReadFileSync: vi.fn(),
    getCachedAnthropicModelsMock: vi.fn(),
    getCachedClaudeCliPtyModelsMock: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain
}))

vi.mock('child_process', () => ({
  execSync: mockExecSync,
  exec: vi.fn(),
  execFile: mockExecFile,
  spawn: vi.fn(),
  spawnSync: vi.fn()
}))

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync
}))

vi.mock('../anthropic-models', () => ({
  getCachedAnthropicModels: getCachedAnthropicModelsMock
}))

vi.mock('../cli-adapters/claude-model-probe', () => ({
  getCachedClaudeCliPtyModels: getCachedClaudeCliPtyModelsMock
}))

import { registerCliHandlers, checkCliOnStartup, detectAllClis, getCliModels } from '../cli-detection'
import { clearCliPathCache } from '../cli-adapters/utils'

async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = mockIpcMain._handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const fakeEvent = { sender: { id: 1 } }
  return handler(fakeEvent, ...args)
}

beforeEach(() => {
  vi.clearAllMocks()
  // findCli now resolves paths through the shared resolveCliPath cache (utils.ts), which is
  // module-level and would otherwise leak positive/negative entries across these fast cases.
  clearCliPathCache()
  mockExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error, stdout: string, stderr: string) => void) => {
    callback(new Error('not found'), '', '')
  })
  mockReadFileSync.mockImplementation(() => {
    throw new Error('no file')
  })
  getCachedAnthropicModelsMock.mockReturnValue([])
  getCachedClaudeCliPtyModelsMock.mockReturnValue([])
  registerCliHandlers()
})

describe('CLI Detection', () => {
  it('cli:status returns not installed when CLI not found', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found') })
    mockExistsSync.mockReturnValue(false)

    const result = await invokeHandler('cli:status')
    expect(result.installed).toBe(false)
    expect(result.path).toBeNull()
  })

  it('registers and serves Hermes profile discovery over IPC', async () => {
    mockExistsSync.mockReturnValue(false)

    await expect(invokeHandler('hermes:profile-discovery')).resolves.toMatchObject({
      profiles: [{ name: 'default', isDefault: true }],
      namedProfileCount: 0,
    })
  })

  it('cli:status returns installed when CLI found via which/where', async () => {
    mockExecFile.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      if ((command.includes('where') || command.includes('which')) && args[0] === 'copilot') {
        callback(null, '/usr/local/bin/copilot\n', '')
      } else if (args[0] === '--version') {
        callback(null, '1.0.0', '')
      } else {
        callback(new Error('unknown'), '', '')
      }
    })
    mockExistsSync.mockReturnValue(true)

    // Use cli:check to force re-detection (bypasses cache)
    const result = await invokeHandler('cli:check')
    expect(result.installed).toBe(true)
    expect(result.path).toBe('/usr/local/bin/copilot')
    expect(result.version).toBe('1.0.0')
  })

  it('cli:check forces re-detection', async () => {
    // First: CLI found
    mockExecFile.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      if ((command.includes('where') || command.includes('which')) && args[0] === 'copilot') {
        callback(null, '/usr/bin/copilot', '')
      } else {
        callback(new Error('unknown'), '', '')
      }
    })
    mockExistsSync.mockReturnValue(true)

    const r1 = await invokeHandler('cli:check')
    expect(r1.installed).toBe(true)

    // Now CLI disappears
    mockExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error, stdout: string, stderr: string) => void) => callback(new Error('not found'), '', ''))
    mockExistsSync.mockReturnValue(false)

    // cli:status would return cached true
    const cached = await invokeHandler('cli:status')
    expect(cached.installed).toBe(true)

    // cli:check forces re-detection
    const r2 = await invokeHandler('cli:check')
    expect(r2.installed).toBe(false)
  })

  it('checkCliOnStartup returns CLI status', async () => {
    mockExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error, stdout: string, stderr: string) => void) => callback(new Error('not found'), '', ''))
    mockExistsSync.mockReturnValue(false)

    const result = await checkCliOnStartup()
    expect(result.installed).toBe(false)
  })

  it('detectAllClis returns status for all CLIs', async () => {
    mockExecFile.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      if (command.includes('where') || command.includes('which')) {
        const paths: Record<string, string> = {
          'github-copilot-cli': '/usr/bin/copilot', 'copilot': '/usr/bin/copilot', 'claude': '/usr/bin/claude', 'codex': '/usr/bin/codex',
          'gh': '/usr/bin/gh', 'hermes': '/usr/bin/hermes', 'ollama': '/usr/bin/ollama',
        }
        callback(null, `${paths[args[0]]}\n`, '')
        return
      }
      const versions: Record<string, string> = {
        copilot: '1.0.0', claude: '0.9.1', codex: 'codex 0.1.0', gh: 'gh version 2.0.0\nmore', hermes: 'hermes 1.0.0', ollama: '0.7.0',
      }
      callback(null, versions[command.split(/[\\/]/).pop()!.replace('.exe', '')] ?? '', '')
    })
    mockExistsSync.mockReturnValue(true)

    const result = await detectAllClis()
    expect(result).toEqual({
      copilot: { installed: true, path: '/usr/bin/copilot', version: '1.0.0' },
      claude: { installed: true, path: '/usr/bin/claude', version: '0.9.1' },
      codex: { installed: true, path: '/usr/bin/codex', version: 'codex 0.1.0' },
      gh: { installed: true, path: '/usr/bin/gh', version: 'gh version 2.0.0' },
      hermes: { installed: true, path: '/usr/bin/hermes', version: 'hermes 1.0.0' },
      ollama: { installed: true, path: '/usr/bin/ollama', version: '0.7.0' },
    })

    const viaIpc = await invokeHandler('cli:detect-all')
    expect(viaIpc).toEqual(result)
  })

  it('detectAllClis returns not-installed when commands fail', async () => {
    mockExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: Error, stdout: string, stderr: string) => void) => callback(new Error('not found'), '', ''))
    mockExistsSync.mockReturnValue(false)

    await expect(detectAllClis()).resolves.toEqual({
      copilot: { installed: false, path: null, version: null },
      claude: { installed: false, path: null, version: null },
      codex: { installed: false, path: null, version: null },
      gh: { installed: false, path: null, version: null },
      hermes: { installed: false, path: null, version: null },
      ollama: { installed: false, path: null, version: null },
    })
  })

  it('handles version command failure gracefully', async () => {
    mockExecFile.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      if ((command.includes('where') || command.includes('which')) && args[0] === 'copilot') {
        callback(null, '/usr/bin/copilot', '')
      } else {
        callback(new Error('no version'), '', '')
      }
    })
    mockExistsSync.mockReturnValue(true)

    // Use cli:check to force re-detection
    const result = await invokeHandler('cli:check')
    expect(result.installed).toBe(true)
    expect(result.version).toBeNull()
  })

  it('getCliModels returns listed Codex cache models only', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.includes('models_cache.json')) {
        return JSON.stringify({
          models: [
            { slug: 'gpt-4.1', display_name: 'GPT-4.1', visibility: 'hidden', priority: 1 },
            { slug: 'gpt-5.4-mini', display_name: 'GPT-5.4-Mini', visibility: 'list', priority: 20 },
            { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', priority: 5 },
          ],
        })
      }
      if (path.includes('config.toml')) return 'model = "gpt-4.1"'
      throw new Error('unexpected path')
    })

    expect(getCliModels('codex-cli')).toEqual([
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
    ])
  })

  it('getCliModels returns static fallback for hermes-cli when config.yaml is missing', () => {
    expect(getCliModels('hermes-cli')).toEqual([
      { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Anthropic)' },
      { id: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8 (Anthropic)' },
      { id: 'openrouter/auto', label: 'Auto (OpenRouter)' },
    ])
  })

  it('getCliModels reads the configured model and fallback chain from config.yaml for hermes-cli', () => {
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.includes('config.yaml')) {
        return [
          'model:',
          '  provider: anthropic',
          '  default: claude-opus-4-8',
          '  base_url: \'\'',
          'fallback_providers:',
          '  - provider: openrouter',
          '    model: google/gemini-2.5-flash',
          '  - provider: nous',
          '    model: anthropic/claude-sonnet-4-6',
          'auxiliary:',
          '  vision:',
          '    provider: auto',
          '    model: \'\'',
        ].join('\n')
      }
      throw new Error('unexpected path')
    })

    expect(getCliModels('hermes-cli')).toEqual([
      { id: 'anthropic/claude-opus-4-8', label: 'claude-opus-4-8 (anthropic)' },
      { id: 'google/gemini-2.5-flash', label: 'google/gemini-2.5-flash (openrouter)' },
      { id: 'anthropic/claude-sonnet-4-6', label: 'anthropic/claude-sonnet-4-6 (nous)' },
      { id: 'openrouter/auto', label: 'Auto (OpenRouter)' },
    ])
  })

  it('getCliModels returns no invented models for Claude CLI before its probe completes', () => {
    getCachedClaudeCliPtyModelsMock.mockReturnValue([])
    getCachedAnthropicModelsMock.mockReturnValue([])

    expect(getCliModels('claude-cli')).toEqual([])
  })

  it('getCliModels never treats BYOK Anthropic models as Claude CLI entitlement', () => {
    getCachedClaudeCliPtyModelsMock.mockReturnValue([])
    getCachedAnthropicModelsMock.mockReturnValue([
      { id: 'claude-opus-4-9', label: 'Claude Opus 4.9' },
    ])

    expect(getCliModels('claude-cli')).toEqual([])
  })

  it('getCliModels prefers PTY-probed models over the Anthropic API cache', () => {
    getCachedClaudeCliPtyModelsMock.mockReturnValue([
      { id: 'opus', label: 'Opus 4.8' },
      { id: 'sonnet', label: 'Sonnet 5' },
    ])
    getCachedAnthropicModelsMock.mockReturnValue([
      { id: 'claude-opus-4-9', label: 'Claude Opus 4.9' },
    ])

    expect(getCliModels('claude-cli')).toEqual([
      { id: 'opus', label: 'Opus 4.8' },
      { id: 'sonnet', label: 'Sonnet 5' },
    ])
  })
})

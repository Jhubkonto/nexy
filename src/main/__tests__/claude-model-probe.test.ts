import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockDb, resolveCliPathMock, ptySpawnMock, execFileMock } = vi.hoisted(() => {
  const store = new Map<string, string>()
  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT OR REPLACE INTO settings')) store.set(args[0] as string, args[1] as string)
        return { changes: 1 }
      }),
      get: vi.fn((...args: unknown[]): { value: string } | undefined => {
        if (sql.includes('WHERE key = ?') && args[0]) {
          const val = store.get(args[0] as string)
          return val !== undefined ? { value: val } : undefined
        }
        return undefined
      }),
    })),
    _store: store,
  }
  return { mockDb, resolveCliPathMock: vi.fn(), ptySpawnMock: vi.fn(), execFileMock: vi.fn() }
})

vi.mock('../database', () => ({ getDatabase: () => mockDb }))
vi.mock('../cli-adapters/utils', () => ({ resolveCliPath: resolveCliPathMock, buildCliChildEnv: () => ({}) }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('child_process', () => ({ execFile: execFileMock }))

// Fake terminal: `write` is a no-op; the module's polling logic reads the grid via `getLine`,
// which is backed by `gridState.text` that each test sets directly to simulate a rendered frame.
const { gridState, FakeTerminal } = vi.hoisted(() => {
  const gridState = { text: '' }
  class FakeTerminal {
    rows = 40
    write(_chunk: string): void { /* no-op: grid content is driven via gridState in tests */ }
    buffer = {
      active: {
        getLine: (i: number) => {
          const lines = gridState.text.split('\n')
          const content = lines[i] ?? ''
          return { translateToString: () => content }
        },
      },
    }
  }
  return { gridState, FakeTerminal }
})
vi.mock('@xterm/headless', () => ({ default: { Terminal: FakeTerminal } }))
vi.mock('module', () => ({
  createRequire: () => (id: string) => {
    if (id === 'node-pty') return { spawn: ptySpawnMock }
    if (id === '@xterm/headless') return { Terminal: FakeTerminal }
    throw new Error(`Unexpected native dependency: ${id}`)
  },
}))

import {
  probeClaudeCliModels,
  cacheClaudeCliPtyModels,
  cacheClaudeCliDiscovery,
  getCachedClaudeCliPtyModels,
  getCachedClaudeCliModelSnapshot,
  getClaudeCliModelChoices,
  isClaudeCliModelOrCandidate,
  resolveClaudeCliLaunchModel,
  validateClaudeCliLegacyCandidate,
  __setProbeTimingForTests,
} from '../cli-adapters/claude-model-probe'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeFakePty() {
  const dataHandlers: ((chunk: string) => void)[] = []
  const exitHandlers: (() => void)[] = []
  const written: string[] = []
  return {
    onData: (cb: (chunk: string) => void) => { dataHandlers.push(cb) },
    onExit: (cb: () => void) => { exitHandlers.push(cb) },
    write: (data: string) => { written.push(data) },
    kill: vi.fn(),
    _emitData: (chunk: string) => dataHandlers.forEach((h) => h(chunk)),
    _emitExit: () => exitHandlers.forEach((h) => h()),
    _written: written,
  }
}

beforeEach(() => {
  mockDb._store.clear()
  gridState.text = ''
  resolveCliPathMock.mockReset()
  ptySpawnMock.mockReset()
  __setProbeTimingForTests({ probeTimeoutMs: 400, quietMs: 30, pollMs: 10 })
})

afterEach(() => {
  __setProbeTimingForTests(null)
})

describe('probeClaudeCliModels', () => {
  it('reports a failed result when claude CLI is not found', async () => {
    resolveCliPathMock.mockReturnValue(null)
    const result = await probeClaudeCliModels()
    expect(result).toMatchObject({ status: 'failed', models: [], reason: 'Claude CLI was not found' })
    expect(ptySpawnMock).not.toHaveBeenCalled()
  })

  it('drives the session to the model menu and parses the top-level entries', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()

    // Initial banner settles into the idle prompt
    gridState.text = '❯ \n  for shortcuts · ← for agents'
    fakePty._emitData('banner')
    await wait(80)

    expect(fakePty._written).toContain('/model\r')

    // Model menu renders
    gridState.text = [
      'More models',
      '    1. Default (recommended)  Sonnet 5 · Efficient for routine tasks',
      '  ❯ 2. Sonnet ✔               Sonnet 5 · Efficient for routine tasks',
      '    3. Fable                  Fable 5 · Most capable for your hardest and longest-running tasks',
      '    4. Opus                   Opus 4.8 · Best for everyday, complex tasks · ~2× usage vs Sonnet',
      '    5. Haiku                  Haiku 4.5 · Fastest for quick answers',
    ].join('\n')
    fakePty._emitData('menu')
    await wait(80)

    const result = await promise
    expect(result).toMatchObject({ status: 'success', models: [
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'fable', label: 'Fable 5' },
      { id: 'opus', label: 'Opus 4.8' },
      { id: 'haiku', label: 'Haiku 4.5' },
    ] })
    expect(fakePty.kill).toHaveBeenCalled()
  })

  it('discovers the current > prompt menu, including its selected row, without offering disabled models', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()

    // Claude Code 2.1.252+ replaced the old `❯` composer prompt with `>`.
    gridState.text = 'Claude Code v2.1.252\n> Try "write a test"'
    fakePty._emitData('banner')
    await wait(80)
    expect(fakePty._written).toContain('/model\r')

    gridState.text = [
      'Select model',
      '    1. Default (recommended)  Sonnet 5 · Efficient for routine tasks',
      '    2. Sonnet                 Sonnet 5 · Efficient for routine tasks',
      '    3. Fable                  Fable 5 · Most capable for long-running tasks',
      '  > 4. Opus √                 Opus 5 · Best for everyday, complex tasks',
      '    5. Haiku                  Haiku 4.5 · Fastest for quick answers',
      '    6. Fable 5.1 (disabled)   Update to 2.1.255+ to use Fable 5.1',
    ].join('\n')
    fakePty._emitData('menu')
    await wait(80)

    const result = await promise
    expect(result).toMatchObject({
      status: 'success',
      cliVersion: '2.1.252',
      models: [
        { id: 'sonnet', label: 'Sonnet 5' },
        { id: 'fable', label: 'Fable 5' },
        { id: 'opus', label: 'Opus 5' },
        { id: 'haiku', label: 'Haiku 4.5' },
      ],
    })
  })

  it('uses the alias when Claude renders a description instead of a model name', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()

    gridState.text = 'Claude Code v2.1.285\n> Try "write a test"'
    fakePty._emitData('banner')
    await wait(80)

    gridState.text = [
      'Select model',
      '    1. Default (recommended)  Use the default model for this session',
      '    2. Sonnet                 Best for everyday, complex tasks',
      '  > 3. Opus √                 Most capable for complex work',
      '    4. Haiku                  Fastest for quick answers',
    ].join('\n')
    fakePty._emitData('description-only-menu')
    await wait(80)

    await expect(promise).resolves.toMatchObject({
      status: 'success',
      models: [
        { id: 'sonnet', label: 'Sonnet' },
        { id: 'opus', label: 'Opus' },
        { id: 'haiku', label: 'Haiku' },
      ],
    })
  })

  it('turns versioned menu aliases into the CLI aliases accepted by --model', () => {
    expect(resolveClaudeCliLaunchModel('Opus 5.5')).toBe('opus')
    expect(resolveClaudeCliLaunchModel('Sonnet 5')).toBe('sonnet')
    expect(resolveClaudeCliLaunchModel('claude-opus-4-8')).toBe('claude-opus-4-8')
  })

  it('navigates into the "More models" flyout and merges its entries with the top-level menu', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()

    gridState.text = '❯ \n  for shortcuts · ← for agents'
    fakePty._emitData('banner')
    await wait(80)
    expect(fakePty._written).toContain('/model\r')

    gridState.text = [
      'Select model',
      '    1. Default (recommended)  Sonnet 5 · Efficient for routine tasks',
      '  ❯ 2. Sonnet ✔               Sonnet 5 · Efficient for routine tasks',
      '    3. Haiku                  Haiku 4.5 · Fastest for quick answers',
      '    4. More models            Opus, legacy models, and more',
    ].join('\n')
    fakePty._emitData('top-level-menu')
    await wait(80)

    expect(fakePty._written).toContain('4\r')

    gridState.text = [
      'More models',
      '  ❯ 1. Opus                   Opus 4.8 · Best for everyday, complex tasks',
      '    2. Sonnet ✔               Sonnet 5 · Efficient for routine tasks',
    ].join('\n')
    fakePty._emitData('submenu')
    await wait(80)

    const result = await promise
    expect(result).toMatchObject({ status: 'success', models: [
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'haiku', label: 'Haiku 4.5' },
      { id: 'opus', label: 'Opus 4.8' },
    ] })
  })

  it('re-requests the "More models" flyout once when it stalls, then merges its entries', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    __setProbeTimingForTests({ probeTimeoutMs: 5000, quietMs: 20, pollMs: 10, submenuTimeoutMs: 100 })
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()

    gridState.text = '❯ \n  for shortcuts · ← for agents'
    fakePty._emitData('banner')
    await wait(60)
    expect(fakePty._written).toContain('/model\r')

    // Top-level menu renders with a "More models" row; the probe requests the flyout.
    gridState.text = [
      'Select model',
      '    1. Default (recommended)  Sonnet 5 · Efficient for routine tasks',
      '  ❯ 2. Sonnet ✔               Sonnet 5 · Efficient for routine tasks',
      '    3. Haiku                  Haiku 4.5 · Fastest for quick answers',
      '    4. More models            Opus, legacy models, and more',
    ].join('\n')
    fakePty._emitData('top-level-menu')
    await wait(60)
    expect(fakePty._written.filter((w) => w === '4\r')).toHaveLength(1)

    // The flyout stalls (grid stays on the top-level menu). No new data arrives, so after the
    // submenu timeout elapses the probe re-requests the flyout exactly once.
    await wait(140)
    expect(fakePty._written.filter((w) => w === '4\r')).toHaveLength(2)

    // This time the flyout renders with Opus, well within the fresh post-retry window.
    gridState.text = [
      'Select model',
      '  ❯ 1. Opus                   Opus 4.8 · Best for everyday, complex tasks',
      '    2. Sonnet ✔               Sonnet 5 · Efficient for routine tasks',
    ].join('\n')
    fakePty._emitData('submenu')
    await wait(60)

    const result = await promise
    expect(result).toMatchObject({ status: 'success', models: [
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'haiku', label: 'Haiku 4.5' },
      { id: 'opus', label: 'Opus 4.8' },
    ] })
  })

  it('falls back to top-level models when the flyout never opens after a retry', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    __setProbeTimingForTests({ probeTimeoutMs: 5000, quietMs: 20, pollMs: 10, submenuTimeoutMs: 100 })
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()

    gridState.text = '❯ \n  for shortcuts · ← for agents'
    fakePty._emitData('banner')
    await wait(60)

    gridState.text = [
      'Select model',
      '  ❯ 2. Sonnet ✔               Sonnet 5 · Efficient for routine tasks',
      '    3. Haiku                  Haiku 4.5 · Fastest for quick answers',
      '    4. More models            Opus, legacy models, and more',
    ].join('\n')
    fakePty._emitData('top-level-menu')
    await wait(60)
    expect(fakePty._written.filter((w) => w === '4\r')).toHaveLength(1)

    // The flyout never renders. After the first timeout the probe retries once (2× "4\r"), and
    // after the second timeout it gives up and falls back to the top-level entries.
    await wait(140)
    expect(fakePty._written.filter((w) => w === '4\r')).toHaveLength(2)
    await wait(140)

    const result = await promise
    // An incomplete flyout is useful diagnostic data, but never a complete snapshot.
    expect(result).toMatchObject({ status: 'partial', models: [
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'haiku', label: 'Haiku 4.5' },
    ] })
  })

  it('accepts the workspace trust dialog before continuing', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()

    gridState.text = 'Is this a project you trust?\n❯ 1. Yes, trust this folder'
    fakePty._emitData('trust-dialog')
    await wait(80)
    expect(fakePty._written).toContain('\r')

    gridState.text = '❯ \n  for shortcuts · ← for agents'
    fakePty._emitData('settled')
    await wait(80)
    expect(fakePty._written).toContain('/model\r')

    gridState.text = 'Select model\n  ❯ 2. Sonnet ✔  Sonnet 5 · Efficient for routine tasks'
    fakePty._emitData('menu')
    await wait(80)

    const result = await promise
    expect(result).toMatchObject({ status: 'success', models: [{ id: 'sonnet', label: 'Sonnet 5' }] })
  })

  it('declines the MCP server prompt via Escape', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()

    gridState.text = 'New MCP server found in this project: playwright\n❯ 1. Use this MCP server'
    fakePty._emitData('mcp-prompt')
    await wait(80)
    expect(fakePty._written).toContain('\x1b')

    gridState.text = '❯ \n  for shortcuts · ← for agents'
    fakePty._emitData('settled')
    await wait(80)

    gridState.text = 'Select model\n  ❯ 2. Sonnet ✔  Sonnet 5 · Efficient for routine tasks'
    fakePty._emitData('menu')
    await wait(80)

    const result = await promise
    expect(result).toMatchObject({ status: 'success', models: [{ id: 'sonnet', label: 'Sonnet 5' }] })
  })

  it('reports a failure on hard timeout when the CLI never settles', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()
    gridState.text = 'still loading...'
    fakePty._emitData('stuck')

    const result = await promise
    expect(result).toMatchObject({ status: 'failed', models: [] })
  }, 2000)

  it('reports a failure when the pty process exits early', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const promise = probeClaudeCliModels()
    fakePty._emitExit()

    const result = await promise
    expect(result).toMatchObject({ status: 'failed', models: [] })
  })

  it('coalesces concurrent calls into a single in-flight probe', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    const fakePty = makeFakePty()
    ptySpawnMock.mockReturnValue(fakePty)

    const p1 = probeClaudeCliModels()
    const p2 = probeClaudeCliModels()
    expect(ptySpawnMock).toHaveBeenCalledTimes(1)

    fakePty._emitExit()
    await Promise.all([p1, p2])
  })
})

describe('claude CLI PTY model cache', () => {
  beforeEach(() => {
    mockDb._store.clear()
  })

  it('returns empty array when nothing cached', () => {
    expect(getCachedClaudeCliPtyModels()).toEqual([])
  })

  it('does not trust a version-1 cache produced by the obsolete prompt parser', () => {
    mockDb._store.set('claude_cli_pty_models_cache', JSON.stringify({
      version: 1,
      models: [{ id: 'obsolete', label: 'Obsolete result' }],
      completedAt: null,
    }))
    expect(getCachedClaudeCliPtyModels()).toEqual([])
    expect(getCachedClaudeCliModelSnapshot().completedAt).toBeNull()
  })

  it('migrates a version-2 confirmed snapshot without showing legacy candidates as validated', () => {
    mockDb._store.set('claude_cli_pty_models_cache', JSON.stringify({
      version: 2,
      models: [{ id: 'sonnet', label: 'Sonnet 5' }],
      completedAt: '2026-01-01T00:00:00.000Z', lastAttemptAt: '2026-01-01T00:00:00.000Z',
      cliVersion: '2.1.263', lastFailure: null,
    }))
    expect(getCachedClaudeCliPtyModels()).toEqual([{ id: 'sonnet', label: 'Sonnet 5' }])
    expect(getClaudeCliModelChoices().find((model) => model.id === 'claude-opus-4-8')).toMatchObject({ source: 'legacy-candidate' })
  })

  it('round-trips cached models through the settings table', () => {
    cacheClaudeCliPtyModels([{ id: 'opus', label: 'Opus 4.8' }])
    expect(getCachedClaudeCliPtyModels()).toEqual([{ id: 'opus', label: 'Opus 4.8' }])
  })

  it('repairs description labels already persisted by the old parser', () => {
    mockDb._store.set('claude_cli_pty_models_cache', JSON.stringify({
      version: 3,
      models: [
        { id: 'sonnet', label: 'Best for everyday, complex tasks' },
        { id: 'haiku', label: 'Fastest for quick answers' },
      ],
      completedAt: '2026-01-01T00:00:00.000Z', lastAttemptAt: '2026-01-01T00:00:00.000Z',
      cliVersion: '2.1.285', lastFailure: null,
    }))

    expect(getCachedClaudeCliPtyModels()).toEqual([
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'haiku', label: 'Haiku' },
    ])
  })

  it('repairs persisted versioned menu aliases and recognises old saved selections', () => {
    mockDb._store.set('claude_cli_pty_models_cache', JSON.stringify({
      version: 3,
      models: [{ id: 'opus 5.5', label: 'Opus 5.5' }],
      completedAt: '2026-01-01T00:00:00.000Z', lastAttemptAt: '2026-01-01T00:00:00.000Z',
      cliVersion: '2.1.289', lastFailure: null,
    }))

    expect(getCachedClaudeCliPtyModels()).toEqual([{ id: 'opus', label: 'Opus 5.5' }])
    expect(isClaudeCliModelOrCandidate('opus 5.5')).toBe(true)
  })

  it('records a failed probe without inventing selectable models', () => {
    cacheClaudeCliDiscovery({ status: 'failed', models: [], source: 'pty-menu', attemptedAt: '2026-01-01T00:00:00.000Z', reason: 'timeout' })
    expect(getCachedClaudeCliPtyModels()).toEqual([])
    expect(getCachedClaudeCliModelSnapshot().lastFailure).toMatchObject({ status: 'failed', reason: 'timeout' })
  })

  it('replaces a confirmed snapshot when a later complete probe removes a model', () => {
    cacheClaudeCliPtyModels([
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'fable', label: 'Fable 5' },
      { id: 'opus', label: 'Opus 4.8' },
      { id: 'haiku', label: 'Haiku 4.5' },
    ])

    // A later complete model menu no longer exposes Opus.
    cacheClaudeCliPtyModels([
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'fable', label: 'Fable 5' },
      { id: 'haiku', label: 'Haiku 4.5' },
    ])

    expect(getCachedClaudeCliPtyModels()).toEqual([
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'fable', label: 'Fable 5' },
      { id: 'haiku', label: 'Haiku 4.5' },
    ])
  })

  it('preserves a confirmed snapshot when a later probe is partial', () => {
    cacheClaudeCliPtyModels([{ id: 'sonnet', label: 'Sonnet 5' }, { id: 'opus', label: 'Opus 4.8' }])
    cacheClaudeCliDiscovery({ status: 'partial', models: [{ id: 'sonnet', label: 'Sonnet 5' }], source: 'pty-menu', attemptedAt: '2026-01-01T00:00:00.000Z', reason: 'submenu timeout' })
    expect(getCachedClaudeCliPtyModels()).toEqual([{ id: 'sonnet', label: 'Sonnet 5' }, { id: 'opus', label: 'Opus 4.8' }])
    expect(getCachedClaudeCliModelSnapshot().lastFailure?.status).toBe('partial')
  })

  it('adds newly discovered models to an existing cache', () => {
    cacheClaudeCliPtyModels([{ id: 'sonnet', label: 'Sonnet 5' }])
    cacheClaudeCliPtyModels([{ id: 'sonnet', label: 'Sonnet 5' }, { id: 'opus', label: 'Opus 4.8' }])

    expect(getCachedClaudeCliPtyModels()).toEqual([
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'opus', label: 'Opus 4.8' },
    ])
  })

  it('promotes an official legacy candidate only after Claude Code accepts a tool-free request', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    execFileMock.mockImplementation((_path: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      expect(args).toEqual(expect.arrayContaining(['--print', '--strict-mcp-config', '--model', 'claude-opus-4-8']))
      callback(null, '{"result":"OK"}', '')
    })

    await expect(validateClaudeCliLegacyCandidate('claude-opus-4-8')).resolves.toMatchObject({ ok: true, changed: true })
    expect(getCachedClaudeCliPtyModels()).toContainEqual({ id: 'claude-opus-4-8', label: 'Claude Opus 4.8' })
    expect(getClaudeCliModelChoices().find((model) => model.id === 'claude-opus-4-8')).toMatchObject({ source: 'validated' })
  })

  it('hides a legacy candidate after Claude Code explicitly rejects the model entitlement', async () => {
    resolveCliPathMock.mockReturnValue('/usr/local/bin/claude')
    execFileMock.mockImplementation((_path: string, _args: string[], _options: unknown, callback: (error: Error, stdout: string, stderr: string) => void) => {
      callback(new Error('command failed'), '', 'Error: model claude-opus-4-8 is not available for this account')
    })

    await expect(validateClaudeCliLegacyCandidate('claude-opus-4-8')).resolves.toMatchObject({ ok: false, changed: true })
    expect(getClaudeCliModelChoices().some((model) => model.id === 'claude-opus-4-8')).toBe(false)
  })
})

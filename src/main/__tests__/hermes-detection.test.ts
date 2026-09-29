import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Standard main-process boilerplate — cli-detection transitively pulls these in.
vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: class {} }))
vi.mock('../database', () => ({ getDatabase: vi.fn() }))
vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))

// child_process is mocked so readiness probing is deterministic (per CLAUDE.md ESM rule).
const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}))
vi.mock('child_process', () => ({ execFile: execFileMock, execSync: vi.fn(), spawnSync: vi.fn() }))

// os.homedir is redirected to a temp fixture root; keep tmpdir real.
let fakeHome = ''
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => fakeHome }
})

import { getHermesProfileDiscovery, listHermesProfiles, hermesAcpReadiness, getCliModels, validateHermesHome } from '../cli-detection'
import { getDatabase } from '../database'
import { clearCliPathCache } from '../cli-adapters/utils'

const getDatabaseMock = vi.mocked(getDatabase)

function writeProfile(name: string, files: Record<string, string>): void {
  const dir = join(fakeHome, '.hermes', 'profiles', name)
  mkdirSync(dir, { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content)
  }
}

describe('listHermesProfiles', () => {
  // The dev machine sets HERMES_HOME to a real path (%LOCALAPPDATA%\hermes) and on Windows
  // the platform default is not ~/.hermes — both would make resolveHermesRoot() escape the
  // fixture. Pin HERMES_HOME to the fixture root so enumeration is hermetic on every platform.
  const savedHermesHome = process.env['HERMES_HOME']

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'nexy-hermes-'))
    process.env['HERMES_HOME'] = join(fakeHome, '.hermes')
  })

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true })
    if (savedHermesHome === undefined) delete process.env['HERMES_HOME']
    else process.env['HERMES_HOME'] = savedHermesHome
    execFileMock.mockReset()
    getDatabaseMock.mockReset()
  })

  it('synthesizes a default entry when no profiles dir exists', () => {
    const profiles = listHermesProfiles()
    expect(profiles).toEqual([{ name: 'default', isDefault: true }])
  })

  it('enumerates named profiles with model/provider and SOUL description', () => {
    writeProfile('localllm', {
      'config.yaml': 'model:\n  provider: ollama\n  default: qwen3\n',
      'SOUL.md': '# Heading\n\nA local-first coding assistant.\n',
    })
    writeProfile('localllm-iso', {
      'config.yaml': 'model:\n  provider: anthropic\n  default: claude-opus-4-8\n',
    })

    const profiles = listHermesProfiles()

    expect(profiles[0]).toEqual({ name: 'default', isDefault: true })
    // Named profiles are sorted and follow the default entry.
    expect(profiles.map((p) => p.name)).toEqual(['default', 'localllm', 'localllm-iso'])

    const localllm = profiles.find((p) => p.name === 'localllm')!
    expect(localllm).toMatchObject({
      isDefault: false,
      model: 'qwen3',
      provider: 'ollama',
      description: 'A local-first coding assistant.',
    })

    const iso = profiles.find((p) => p.name === 'localllm-iso')!
    expect(iso).toMatchObject({ model: 'claude-opus-4-8', provider: 'anthropic' })
    expect(iso.description).toBeUndefined()
  })

  it('ignores a profiles/default subdir (default is always synthetic) and non-directories', () => {
    writeProfile('default', { 'config.yaml': 'model:\n  default: ignored\n' })
    mkdirSync(join(fakeHome, '.hermes', 'profiles'), { recursive: true })
    writeFileSync(join(fakeHome, '.hermes', 'profiles', 'stray.txt'), 'not a profile')
    writeProfile('real', { 'config.yaml': '' })

    const profiles = listHermesProfiles()
    expect(profiles.map((p) => p.name)).toEqual(['default', 'real'])
    // The synthetic default carries no model from the on-disk default/ dir.
    expect(profiles.find((p) => p.name === 'default')!.model).toBeUndefined()
  })

  it('honors a relocated HERMES_HOME instead of hardcoding ~/.hermes', () => {
    // Regression: HERMES_HOME points at a custom root (as on native Windows,
    // %LOCALAPPDATA%\hermes). Profiles there must still be found.
    const customRoot = join(fakeHome, 'AppData', 'Local', 'hermes')
    mkdirSync(join(customRoot, 'profiles', 'localllm'), { recursive: true })
    writeFileSync(
      join(customRoot, 'profiles', 'localllm', 'config.yaml'),
      'model:\n  provider: ollama\n  default: qwen3\n',
    )
    process.env['HERMES_HOME'] = customRoot

    const profiles = listHermesProfiles()
    expect(profiles.map((p) => p.name)).toEqual(['default', 'localllm'])
  })

  it('climbs from a profile-mode HERMES_HOME to enumerate sibling profiles', () => {
    // HERMES_HOME may point at a specific profile dir (<root>/profiles/<name>); the
    // enumerator should still see all siblings under <root>/profiles.
    const root = join(fakeHome, 'AppData', 'Local', 'hermes')
    for (const name of ['localllm', 'localllm-iso']) {
      mkdirSync(join(root, 'profiles', name), { recursive: true })
      writeFileSync(join(root, 'profiles', name, 'config.yaml'), '')
    }
    process.env['HERMES_HOME'] = join(root, 'profiles', 'localllm')

    const profiles = listHermesProfiles()
    expect(profiles.map((p) => p.name)).toEqual(['default', 'localllm', 'localllm-iso'])
  })

  it('ignores invalid names, tombstones, markerless directories, and files with diagnostics', () => {
    writeProfile('valid', { 'profile.yaml': 'description: A valid profile\n' })
    writeProfile('empty', {})
    writeProfile('deleted', { 'config.yaml': '', '.deleted': '' })
    writeProfile('invalid name', { 'config.yaml': '' })
    mkdirSync(join(fakeHome, '.hermes', 'profiles'), { recursive: true })
    writeFileSync(join(fakeHome, '.hermes', 'profiles', 'not-a-directory'), 'ignore me')

    const discovery = getHermesProfileDiscovery()

    expect(discovery.profiles.map((p) => p.name)).toEqual(['default', 'valid'])
    expect(discovery.profiles.find((p) => p.name === 'valid')?.description).toBe('A valid profile')
    expect(discovery.namedProfileCount).toBe(1)
    expect(discovery.ignoredEntries).toEqual(expect.arrayContaining([
      { name: 'empty', reason: 'markerless' },
      { name: 'deleted', reason: 'tombstone' },
      { name: 'invalid name', reason: 'invalid-name' },
      { name: 'not-a-directory', reason: 'not-directory' },
    ]))
  })

  it('reports the resolved root and source without exposing profile contents', () => {
    const root = join(fakeHome, 'relocated-hermes')
    process.env['HERMES_HOME'] = root
    const discovery = getHermesProfileDiscovery()

    expect(discovery.root).toBe(root)
    expect(discovery.rootSource).toBe('environment')
    expect(discovery.profilesDirectory).toBe(join(root, 'profiles'))
    expect(discovery.profiles).toEqual([{ name: 'default', isDefault: true }])
  })

  it('uses the persisted Hermes home override and validates the profiles directory', () => {
    const configuredRoot = join(fakeHome, 'shared-hermes-assets')
    mkdirSync(join(configuredRoot, 'profiles', 'localllm'), { recursive: true })
    writeFileSync(join(configuredRoot, 'profiles', 'localllm', 'config.yaml'), '')
    getDatabaseMock.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue({ value: configuredRoot }) }),
    } as never)

    const discovery = getHermesProfileDiscovery()
    expect(discovery.root).toBe(configuredRoot)
    expect(discovery.rootSource).toBe('configured')
    expect(discovery.profiles.map((profile) => profile.name)).toEqual(['default', 'localllm'])
    expect(validateHermesHome(configuredRoot)).toMatchObject({ valid: true, profilesDirectory: join(configuredRoot, 'profiles') })
    expect(validateHermesHome(join(fakeHome, 'not-a-hermes-home'))).toMatchObject({ valid: false, reason: 'profiles-directory-missing' })
  })
})

describe('getCliModels(hermes-cli) profile scoping', () => {
  const savedHermesHome = process.env['HERMES_HOME']

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'nexy-hermes-models-'))
    process.env['HERMES_HOME'] = join(fakeHome, '.hermes')
    // Root/default config points at a distinct model (not one of the hardcoded HERMES_DEFAULT_MODELS,
    // so a leak from the default config is unambiguously detectable); a named profile points at a local model.
    mkdirSync(join(fakeHome, '.hermes'), { recursive: true })
    writeFileSync(
      join(fakeHome, '.hermes', 'config.yaml'),
      'model:\n  provider: anthropic\n  default: claude-root-only\n',
    )
    writeProfile('localllm', {
      'config.yaml': 'model:\n  provider: openai-api\n  default: Qwen3.6-35B-A3B-AWQ-4bit\n',
    })
  })

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true })
    if (savedHermesHome === undefined) delete process.env['HERMES_HOME']
    else process.env['HERMES_HOME'] = savedHermesHome
  })

  it('reads the named profile config, not the default, when a profile is passed', () => {
    const models = getCliModels('hermes-cli', 'localllm')
    expect(models[0]).toEqual({
      id: 'openai-api/Qwen3.6-35B-A3B-AWQ-4bit',
      label: 'Qwen3.6-35B-A3B-AWQ-4bit (openai-api)',
    })
    // The default profile's Anthropic model must not leak into a profile-scoped list.
    expect(models.some((m) => m.id === 'anthropic/claude-root-only')).toBe(false)
  })

  it('parses a CRLF-terminated profile config (Hermes writes CRLF on Windows)', () => {
    // Regression: config.yaml written with CRLF made the YAML block regex miss `model:\r\n`,
    // so the profile reported no models and the picker fell back to the hardcoded defaults.
    writeProfile('crlf', {
      'config.yaml': 'model:\r\n  provider: openai-api\r\n  default: Qwen3.6-35B-A3B-AWQ-4bit\r\n',
    })
    const models = getCliModels('hermes-cli', 'crlf')
    expect(models[0]).toEqual({
      id: 'openai-api/Qwen3.6-35B-A3B-AWQ-4bit',
      label: 'Qwen3.6-35B-A3B-AWQ-4bit (openai-api)',
    })
  })

  it('reads the root config for the default (or omitted) profile', () => {
    for (const models of [getCliModels('hermes-cli'), getCliModels('hermes-cli', 'default')]) {
      expect(models[0]).toEqual({
        id: 'anthropic/claude-root-only',
        label: 'claude-root-only (anthropic)',
      })
    }
  })
})

describe('hermesAcpReadiness', () => {
  let hermesBin = ''
  type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

  beforeEach(() => {
    execFileMock.mockReset()
    // findCli('hermes') now resolves through the shared resolveCliPath cache; clear it so a
    // negative from the "binary absent" case doesn't leak (within its 15s TTL) into the next.
    clearCliPathCache()
    // findCli('hermes') resolves via where/which then verifies existsSync(path),
    // so point it at a real temp file that stands in for the hermes binary.
    const dir = mkdtempSync(join(tmpdir(), 'nexy-hermes-bin-'))
    hermesBin = join(dir, 'hermes')
    writeFileSync(hermesBin, '')
    execFileMock.mockImplementation((command: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      if (command.includes('where') || command.includes('which')) callback(null, `${hermesBin}\n`, '')
      else callback(new Error('not configured'), '', '')
    })
  })

  afterEach(() => {
    rmSync(join(hermesBin, '..'), { recursive: true, force: true })
  })

  afterAll(() => {
    execFileMock.mockReset()
  })

  it('reports not-ready when the binary is absent', async () => {
    execFileMock.mockImplementation((_command: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(new Error('not found'), '', '')
    })
    const readiness = await hermesAcpReadiness(true)
    expect(readiness.ready).toBe(false)
    expect(readiness.detail).toMatch(/not found/i)
  })

  it('reports ready with version when acp --check exits 0', async () => {
    execFileMock.mockImplementation((command: string, args: string[], _options: unknown, callback: ExecCallback) => {
      if (command.includes('where') || command.includes('which')) callback(null, `${hermesBin}\n`, '')
      else if (args.includes('--version')) callback(null, 'hermes 0.17.0\n', '')
      else callback(null, '', '')
    })
    const readiness = await hermesAcpReadiness(true)
    expect(readiness).toEqual({ ready: true, version: 'hermes 0.17.0' })
  })

  it('reports not-ready with stderr detail on non-zero check exit', async () => {
    execFileMock.mockImplementation((command: string, args: string[], _options: unknown, callback: ExecCallback) => {
      if (command.includes('where') || command.includes('which')) callback(null, `${hermesBin}\n`, '')
      else if (args.includes('--version')) callback(null, 'hermes 0.17.0\n', '')
      else callback(Object.assign(new Error('exit 1'), { code: 1 }), '', 'no provider credentials configured\n')
    })
    const readiness = await hermesAcpReadiness(true)
    expect(readiness.ready).toBe(false)
    expect(readiness.status).toBe('authentication')
    expect(readiness.version).toBe('hermes 0.17.0')
    expect(readiness.detail).toBe('no provider credentials configured')
  })

  it('caches the result until force re-probe', async () => {
    execFileMock.mockImplementation((command: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      if (command.includes('where') || command.includes('which')) callback(null, `${hermesBin}\n`, '')
      else callback(null, '', '')
    })
    await hermesAcpReadiness(true)
    const callsAfterForce = execFileMock.mock.calls.length
    await hermesAcpReadiness() // cached — no new probe
    expect(execFileMock.mock.calls.length).toBe(callsAfterForce)
    await hermesAcpReadiness(true) // force — re-probes
    expect(execFileMock.mock.calls.length).toBeGreaterThan(callsAfterForce)
  })

  it('re-probes automatically once the cache TTL lapses, without an explicit force', async () => {
    vi.useFakeTimers()
    try {
      execFileMock.mockImplementation((command: string, _args: string[], _options: unknown, callback: ExecCallback) => {
        if (command.includes('where') || command.includes('which')) callback(null, `${hermesBin}\n`, '')
        else callback(null, '', '')
      })
      await hermesAcpReadiness(true)
      const baseline = execFileMock.mock.calls.length
      await hermesAcpReadiness() // still within TTL — served from cache
      expect(execFileMock.mock.calls.length).toBe(baseline)
      vi.advanceTimersByTime(31_000) // past the 30s readiness TTL
      await hermesAcpReadiness() // stale — re-probes even without force (e.g. credentials since added)
      expect(execFileMock.mock.calls.length).toBeGreaterThan(baseline)
    } finally {
      vi.useRealTimers()
    }
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userData = mkdtempSync(join(tmpdir(), 'nexy-managed-node-'))
const originalPlatform = process.platform

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => userData) },
}))

import {
  createManagedNodeNpxLaunch,
  ensureManagedNodeNpxRuntime,
  installManagedNodeRuntime,
  isManagedNodeNpxConfig,
  normalizeMcpRemoteHeaderArgs,
} from '../managed-node'

function useWindows(): void {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
}

function restorePlatform(): void {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
}

function installReadyRuntime(): void {
  const root = join(userData, 'managed-mcp-node', `node-v24.22.0-win-${process.arch}`)
  mkdirSync(join(root, 'node_modules', 'npm', 'bin'), { recursive: true })
  writeFileSync(join(root, 'node.exe'), '')
  writeFileSync(join(root, 'node_modules', 'npm', 'bin', 'npx-cli.js'), '')
}

afterEach(() => {
  restorePlatform()
  rmSync(userData, { recursive: true, force: true })
  userData = mkdtempSync(join(tmpdir(), 'nexy-managed-node-'))
})

describe('managed Node MCP runtime', () => {
  it('only removes a complete pair of shell quotes around mcp-remote headers', () => {
    expect(normalizeMcpRemoteHeaderArgs(['mcp-remote@0.1.0', '--header', "'X-Test: a:b'", '--header', 'X-Other: "quoted value"']))
      .toEqual(['mcp-remote@0.1.0', '--header', 'X-Test: a:b', '--header', 'X-Other: "quoted value"'])
    expect(normalizeMcpRemoteHeaderArgs(['another-server', '--header', '"X-Test: keep"']))
      .toEqual(['another-server', '--header', '"X-Test: keep"'])
  })

  it('gives mcp-remote persistent private auth storage and removes shell quotes around a header', () => {
    useWindows()
    installReadyRuntime()
    const config = {
      name: 'Easy8', env: {},
      args: ['-y', 'mcp-remote', 'https://easy8.example/mcp', '--header', '"X-Easy8-API-Key: test key"'],
    }
    const first = createManagedNodeNpxLaunch(config)
    const authPath = first.request.env.MCP_REMOTE_CONFIG_DIR
    expect(authPath).toBeDefined()
    expect(authPath).toContain(join(userData, 'managed-mcp-node'))
    expect(first.request.profile?.filesystem).toContainEqual({ path: authPath, access: 'read-write' })
    expect(first.request.args.at(-1)).toBe('X-Easy8-API-Key: test key')
    first.cleanup()
    const second = createManagedNodeNpxLaunch(config)
    expect(second.request.env.MCP_REMOTE_CONFIG_DIR).toBe(authPath)
    expect(existsSync(authPath)).toBe(true)
    second.cleanup()
  })

  it('replaces both standard Windows spellings of npx', () => {
    useWindows()
    expect(isManagedNodeNpxConfig({ command: 'npx' })).toBe(true)
    expect(isManagedNodeNpxConfig({ command: 'NPX' })).toBe(true)
    expect(isManagedNodeNpxConfig({ command: 'npx.cmd' })).toBe(true)
    expect(isManagedNodeNpxConfig({ command: 'C:\\Program Files\\nodejs\\npx.cmd' })).toBe(true)
    expect(isManagedNodeNpxConfig({ command: 'node' })).toBe(false)
  })

  it('runs npm npx through the managed Node executable and grants only its private paths', () => {
    useWindows()
    installReadyRuntime()
    mkdirSync(join(userData, 'project'), { recursive: true })
    const launch = createManagedNodeNpxLaunch({
      name: 'Easy8',
      args: ['-y', 'mcp-remote', 'https://easy8.example/mcp'],
      env: { EASY8_TOKEN: 'secret' },
      cwd: join(userData, 'project'),
      sandboxProfile: {
        version: 1,
        network: 'allowed',
        childProcesses: 'allowed',
        filesystem: [],
        memoryLimitMiB: 512,
        maxProcesses: 8,
        startupTimeoutMs: 15_000,
        gracefulShutdownTimeoutMs: 2_000,
        hardTerminationTimeoutMs: 5_000,
        maxDiagnosticBytes: 65_536,
      },
    })

    expect(launch.request.command).toMatch(/managed-mcp-node[\\/]node-v24\.22\.0-win-[^\\/]+[\\/]node\.exe$/)
    expect(launch.request.command).not.toMatch(/Program Files/i)
    expect(launch.request.args.slice(0, 4)).toEqual(['--preserve-symlinks', '--preserve-symlinks-main', expect.stringMatching(/npx-session-[^\\/]+[\\/]managed-npx\.cjs$/), expect.stringMatching(/npm[\\/]bin[\\/]npx-cli\.js$/)])
    expect(launch.request.args.slice(4)).toEqual(['-y', 'mcp-remote', 'https://easy8.example/mcp'])
    expect(launch.request.env).toMatchObject({
      EASY8_TOKEN: 'secret',
      NPM_CONFIG_CACHE: expect.stringContaining('npm-cache-v24.22.0'),
      NPM_CONFIG_LOGS_MAX: '0',
      NODE_OPTIONS: '--preserve-symlinks --preserve-symlinks-main',
    })
    expect(launch.request.profile?.filesystem).toEqual(expect.arrayContaining([
      { path: expect.stringMatching(/node-v24\.22\.0-win-/), access: 'read-only' },
      { path: expect.stringContaining('npm-cache-v24.22.0'), access: 'read-write' },
      { path: expect.stringContaining('npx-session-'), access: 'read-write' },
    ]))
    const sessionDirectory = launch.request.profile?.filesystem.find((grant) => grant.path.includes('npx-session-'))?.path
    expect(sessionDirectory).toBeDefined()
    launch.cleanup()
    expect(existsSync(sessionDirectory!)).toBe(false)
  })

  it('fails closed when the official archive cannot pass verification', async () => {
    useWindows()
    const status = await installManagedNodeRuntime(async () => new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04])))
    expect(status).toMatchObject({ state: 'failed' })
    expect(status.detail).toMatch(/SHA-256 verification/i)
    await expect(ensureManagedNodeNpxRuntime({ command: 'npx' })).rejects.toThrow(/requires network access/i)
  })
})

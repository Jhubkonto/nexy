import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { spawn } from 'node:child_process'

let userData = mkdtempSync(join(tmpdir(), 'nexy-managed-playwright-'))
const require = createRequire(import.meta.url)

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => userData) },
}))
vi.mock('../error-log-handlers', () => ({
  recordErrorLogEntry: vi.fn(() => ({ id: 'log-1' })),
}))

import { MCP_CATALOG, catalogEntryToConfig } from '../../shared/mcp-catalog'
import {
  createManagedPlaywrightLaunch,
  executableAt,
  getManagedBrowserStatus,
  installManagedBrowser,
  summarizeInstallProgress,
} from '../managed-playwright'

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
  userData = mkdtempSync(join(tmpdir(), 'nexy-managed-playwright-'))
})

function managedBrowserRoot(): string {
  const browserVersion = require('@playwright/mcp/package.json').dependencies.playwright as string
  return join(userData, 'managed-playwright', `chromium-${browserVersion.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
}

/** Fake installer: optionally writes Chromium into PLAYWRIGHT_BROWSERS_PATH, then exits. */
function fakeInstaller(options: { writeExecutable: boolean; code: number; output?: string }): typeof spawn {
  return ((_command: string, args: string[], spawnOptions: { env: NodeJS.ProcessEnv }) => {
    expect(args.slice(-2)).toEqual(['install', 'chromium'])
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() })
    setTimeout(() => {
      if (options.output) child.stdout.emit('data', Buffer.from(options.output))
      if (options.writeExecutable) {
        const executable = executableAt(spawnOptions.env.PLAYWRIGHT_BROWSERS_PATH!)
        mkdirSync(dirname(executable), { recursive: true })
        writeFileSync(executable, '')
      }
      child.emit('close', options.code, null)
    }, 5)
    return child
  }) as unknown as typeof spawn
}

describe('managed Playwright catalog', () => {
  it('uses a managed launcher rather than npx for both browser cards', () => {
    for (const id of ['playwright', 'playwright-cdp']) {
      const entry = MCP_CATALOG.find((candidate) => candidate.id === id)!
      expect(catalogEntryToConfig(entry)).toMatchObject({ command: '', args: [], launch: { kind: 'managed-playwright' } })
    }
  })

  it('requires an explicit browser installation before a managed launch', () => {
    expect(getManagedBrowserStatus()).toMatchObject({ state: 'download-required', browser: 'chromium' })
    expect(() => createManagedPlaywrightLaunch({ kind: 'managed-playwright', mode: 'launch' }))
      .toThrow(/not installed/i)
  })

  it('launches the declared MCP executable once Chromium is installed', () => {
    const executable = executableAt(managedBrowserRoot())
    mkdirSync(dirname(executable), { recursive: true })
    writeFileSync(executable, '')

    const managed = createManagedPlaywrightLaunch({ kind: 'managed-playwright', mode: 'launch' })
    expect(managed.request.args[0]).toMatch(/@playwright.mcp.cli.js$/)
    expect(managed.request.args.slice(1)).toEqual(['--isolated', '--user-data-dir', expect.any(String), '--headed'])
    managed.cleanup()
  })
})

describe('managed Chromium installation', () => {
  it('finds Chromium in the staging directory and promotes it (regression: cached browsers path)', async () => {
    // Load playwright-core against the final root first, as app startup does.
    expect(getManagedBrowserStatus().state).toBe('download-required')

    const status = await installManagedBrowser(fakeInstaller({ writeExecutable: true, code: 0 }))
    expect(status.state).toBe('ready')
    expect(getManagedBrowserStatus().state).toBe('ready')
  })

  it('reports a final failure instead of a stale downloading state', async () => {
    const status = await installManagedBrowser(fakeInstaller({ writeExecutable: false, code: 1, output: 'network error' }))
    expect(status).toMatchObject({ state: 'failed', errorLogId: 'log-1' })
    expect(status.detail).toContain("exit code 1")
    expect(status.detail).toContain("network error")
    expect(getManagedBrowserStatus().state).toBe('failed')
  })

  it('summarizes installer progress output', () => {
    const output = 'Downloading Chrome for Testing 149.0.7827.3 (playwright chromium v1224) from https://x\n'
      + '|■■■■     |  40% of 180.2 MiB\r|■■■■■■   |  60% of 180.2 MiB\n'
    expect(summarizeInstallProgress(output)).toBe('Downloading Chrome for Testing 149.0.7827.3: 60% of 180.2 MiB')
    expect(summarizeInstallProgress('')).toBeUndefined()
  })
})

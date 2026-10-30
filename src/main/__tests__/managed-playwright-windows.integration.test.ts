import { afterAll, describe, expect, it, vi } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

// Use an already installed browser without downloading or changing Nexy's data.
const browserRuntime = process.env.NEXY_TEST_MANAGED_PLAYWRIGHT_RUNTIME
let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

import { createManagedPlaywrightLaunch } from '../managed-playwright'
import { createSandboxedMcpTransport, shutdownMcpSandboxBroker } from '../mcp-sandbox'

describe.skipIf(process.platform !== 'win32' || !browserRuntime)('managed Playwright through the Windows helper', () => {
  afterAll(async () => {
    await shutdownMcpSandboxBroker()
    if (userData) rmSync(userData, { recursive: true, force: true })
  })

  it('opens a page, closes the browser, and opens a new page in the same MCP session', async () => {
    userData = mkdtempSync(join(tmpdir(), 'nexy-native-playwright-'))
    const require = createRequire(import.meta.url)
    const version = require('@playwright/mcp/package.json').dependencies.playwright as string
    const managedRoot = join(userData, 'managed-playwright')
    mkdirSync(managedRoot)
    cpSync(browserRuntime!, join(managedRoot, `chromium-${version.replace(/[^a-zA-Z0-9._-]/g, '_')}`), { recursive: true })
    const launch = createManagedPlaywrightLaunch({ kind: 'managed-playwright', mode: 'launch' })
    // Exercise the same Electron-as-Node process used in the desktop app.
    launch.request.command = require('electron') as string
    launch.request.env.DEBUG = 'pw:browser'
    const handle = createSandboxedMcpTransport({ ...launch.request, cleanup: launch.cleanup })
    const client = new Client({ name: 'nexy-native-browser-test', version: '1.0.0' })
    try {
      await client.connect(handle.transport, { timeout: 25_000 })
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain('browser_navigate')
      for (const name of ['browser_navigate', 'browser_close', 'browser_navigate']) {
        const response = await client.callTool({ name, arguments: name === 'browser_navigate' ? { url: 'about:blank' } : {} })
        expect(response, JSON.stringify(response)).not.toHaveProperty('isError', true)
      }
      // Closing the underlying browser simulates the browser vanishing while
      // its MCP transport remains connected. Never replay a page action.
      await client.callTool({ name: 'browser_run_code_unsafe', arguments: { code: 'async (page) => { await page.context().browser().close(); }' } })
      const reopened = await client.callTool({ name: 'browser_navigate', arguments: { url: 'about:blank' } })
      expect(reopened, JSON.stringify(reopened)).not.toHaveProperty('isError', true)
    } catch (error) {
      await handle.close()
      await handle.stderrSettled(2000)
      throw new Error(`${String(error)}\n${handle.stderrTail()}`)
    } finally {
      await client.close()
      await handle.close()
    }
    expect(existsSync(launch.request.cwd!)).toBe(false)
  }, 60_000)
})

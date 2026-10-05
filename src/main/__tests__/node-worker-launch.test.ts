import { afterEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// The defer bridge reaches into the callbacks table on construction; this suite only cares
// about how its worker is launched, so keep it off the real database.
vi.mock('../deferred-callbacks', () => ({
  createDeferredCallback: vi.fn(() => ({ id: 'cb-1', status: 'pending' })),
  resolveDeferredCallback: vi.fn().mockResolvedValue(true),
}))

import { nodeWorkerCommand, nodeWorkerEnv } from '../node-worker-launch'
import { startPlanMcpBridge } from '../plan-mcp-bridge'
import { startUserInputMcpBridge } from '../user-input-mcp-bridge'
import { startDeferMcpBridge } from '../defer-mcp-bridge'

const open: Array<{ close: () => void }> = []
afterEach(() => { for (const bridge of open.splice(0)) bridge.close() })

describe('nodeWorkerEnv', () => {
  it('forces Electron into Node mode and preserves caller variables', () => {
    expect(nodeWorkerEnv({ FOO: 'bar' })).toEqual({ FOO: 'bar', ELECTRON_RUN_AS_NODE: '1' })
    expect(nodeWorkerEnv()).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('cannot be clobbered by a caller that disables it', () => {
    expect(nodeWorkerEnv({ ELECTRON_RUN_AS_NODE: '0' }).ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('runs workers with the Electron binary, the only JS runtime Nexy ships', () => {
    expect(nodeWorkerCommand()).toBe(process.execPath)
  })
})

// Regression: these servers were launched as `process.execPath <script>` with no
// ELECTRON_RUN_AS_NODE, so in a packaged build the Electron binary started a second Nexy app
// instead of the worker. The MCP client saw no stdio handshake and reported CONNECTION_CLOSED,
// which left Claude unable to call nexy_plan.exit_plan_mode and dead-ended Plan mode turns.
describe('in-process MCP bridge launch descriptors', () => {
  it('starts the plan bridge worker in Node mode', async () => {
    const bridge = await startPlanMcpBridge(vi.fn().mockResolvedValue(true))
    open.push(bridge)
    expect(bridge.server.command).toBe(process.execPath)
    expect(bridge.server.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(bridge.server.env.NEXY_PLAN_BRIDGE_SECRET).toBeTruthy()
  })

  it('starts the user-input bridge worker in Node mode', async () => {
    const bridge = await startUserInputMcpBridge(vi.fn().mockResolvedValue([]))
    open.push(bridge)
    expect(bridge.server.env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('starts the defer bridge worker in Node mode', async () => {
    const bridge = await startDeferMcpBridge({ conversationId: 'c1', cwd: process.cwd() })
    open.push(bridge)
    expect(bridge.server.env.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})

// Regression: defer-mcp-worker.cjs existed in src/main but was missing from the build's
// hand-maintained copy list, so the packaged app had no file to launch at all.
describe('worker script packaging', () => {
  it('copies every *-worker.cjs in src/main into the build output', () => {
    const mainDir = join(__dirname, '..')
    const workers = readdirSync(mainDir).filter((file) => file.endsWith('-worker.cjs'))
    expect(workers.length).toBeGreaterThan(0)

    const config = readFileSync(join(mainDir, '..', '..', 'electron.vite.config.ts'), 'utf8')
    // The copy plugin must discover workers by convention; a literal list goes stale silently.
    expect(config).toContain("readdirSync(srcDir).filter((file) => file.endsWith('-worker.cjs'))")
    for (const worker of workers) {
      expect(config).not.toContain(`'${worker}'`)
    }
  })

  it('references each bridge worker by a name the copy plugin matches', () => {
    const mainDir = join(__dirname, '..')
    const sources = readdirSync(mainDir).filter((file) => file.endsWith('.ts'))
    const referenced = new Set<string>()
    for (const file of sources) {
      for (const match of readFileSync(join(mainDir, file), 'utf8').matchAll(/'([\w-]+\.cjs)'/g)) {
        referenced.add(match[1])
      }
    }
    const present = new Set(readdirSync(mainDir).filter((file) => file.endsWith('.cjs')))
    for (const worker of referenced) {
      expect(present.has(worker), `${worker} is referenced but missing from src/main`).toBe(true)
      expect(worker.endsWith('-worker.cjs'), `${worker} must end in -worker.cjs to be packaged`).toBe(true)
    }
  })
})

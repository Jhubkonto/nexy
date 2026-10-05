import { afterEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted mocks ──────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
}))

vi.mock('../deferred-callbacks', () => ({
  createDeferredCallback: vi.fn((input: Record<string, unknown>) => {
    state.created.push(input)
    return { id: `cb-${state.created.length}`, status: 'pending', ...input }
  }),
  resolveDeferredCallback: vi.fn().mockResolvedValue(true),
}))

import { startDeferMcpBridge } from '../defer-mcp-bridge'
import { createDeferredCallback, resolveDeferredCallback } from '../deferred-callbacks'

const bridges: Array<{ close: () => void }> = []
// A shell utility named `timeout`/`sleep` can resolve to different, incompatible implementations
// depending on what's earliest on PATH (e.g. Git-for-Windows' coreutils shadowing the Windows
// system one). A `node -e` one-liner sidesteps that entirely and behaves identically everywhere.
const SLEEP_30 = 'node -e "setTimeout(()=>{},30000)"'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Process teardown here is inherently asynchronous (on Windows `killTree` shells out to
 * `taskkill`), so a fixed sleep turns into a load-dependent flake on a busy machine. Poll the
 * condition up to a generous deadline instead.
 */
async function waitUntil(predicate: () => boolean, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await wait(50)
  }
  return predicate()
}

afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.close()
  state.created.length = 0
  vi.mocked(createDeferredCallback).mockClear()
  vi.mocked(resolveDeferredCallback).mockClear()
})

async function post(bridge: Awaited<ReturnType<typeof startDeferMcpBridge>>, path: string, body: unknown, secret = true) {
  const port = bridge.server.env.NEXY_DEFER_BRIDGE_PORT
  const bridgeSecret = bridge.server.env.NEXY_DEFER_BRIDGE_SECRET
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Bridge-Secret': bridgeSecret } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('nexy_defer MCP bridge', () => {
  it('exposes only run_and_notify and rejects unauthenticated requests', async () => {
    const bridge = await startDeferMcpBridge({ conversationId: 'conv-1', cwd: process.cwd() })
    bridges.push(bridge)

    expect((await post(bridge, '/tools', {}, false)).status).toBe(403)
    const response = await post(bridge, '/tools', {})
    expect(await response.json()).toMatchObject({ tools: [{ name: 'run_and_notify' }] })
  })

  it('rejects a missing command without spawning anything', async () => {
    const bridge = await startDeferMcpBridge({ conversationId: 'conv-1', cwd: process.cwd() })
    bridges.push(bridge)

    const response = await post(bridge, '/call', { toolName: 'run_and_notify', args: {} })
    expect(await response.json()).toMatchObject({ success: false })
    expect(createDeferredCallback).not.toHaveBeenCalled()
  })

  it('spawns the command, arms a deferred callback, and returns before the command finishes', async () => {
    const bridge = await startDeferMcpBridge({ conversationId: 'conv-1', cwd: process.cwd(), chainDepth: 1 })
    bridges.push(bridge)

    const response = await post(bridge, '/call', {
      toolName: 'run_and_notify',
      args: { command: 'exit 0', label: 'demo job' },
    })
    const json = await response.json() as { success: boolean; result: string }

    expect(json.success).toBe(true)
    expect(json.result).toContain('demo job')
    expect(createDeferredCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        triggerKind: 'process',
        label: 'demo job',
        chainDepth: 1,
      }),
    )

    await waitUntil(() => vi.mocked(resolveDeferredCallback).mock.calls.length > 0)
    expect(resolveDeferredCallback).toHaveBeenCalledWith(
      'process',
      expect.any(String),
      expect.objectContaining({ status: 'success', exitCode: 0 }),
    )
  })

  it('reports a nonzero exit as a failure with captured output', async () => {
    const bridge = await startDeferMcpBridge({ conversationId: 'conv-1', cwd: process.cwd() })
    bridges.push(bridge)

    await post(bridge, '/call', { toolName: 'run_and_notify', args: { command: 'exit 3', label: 'bad job' } })
    await waitUntil(() => vi.mocked(resolveDeferredCallback).mock.calls.length > 0)

    expect(resolveDeferredCallback).toHaveBeenCalledWith(
      'process',
      expect.any(String),
      expect.objectContaining({ status: 'failure', exitCode: 3 }),
    )
  })

  it('kills the spawned process and reports the error if arming the callback fails', async () => {
    let capturedPid: number | undefined
    vi.mocked(createDeferredCallback).mockImplementationOnce((input) => {
      capturedPid = (input as { pid?: number }).pid
      throw new Error('chain depth exceeded')
    })
    const bridge = await startDeferMcpBridge({ conversationId: 'conv-1', cwd: process.cwd() })
    bridges.push(bridge)

    const response = await post(bridge, '/call', {
      toolName: 'run_and_notify',
      args: { command: SLEEP_30, label: 'x' },
    })
    expect(await response.json()).toMatchObject({ success: false, error: expect.stringContaining('chain depth exceeded') })

    // A rejected binding must not leave the process running unsupervised — nothing would ever
    // hear it finish. Confirm it actually died rather than just checking the HTTP response shape.
    expect(capturedPid).toBeGreaterThan(0)
    const isAlive = () => {
      try {
        process.kill(capturedPid!, 0)
        return true
      } catch {
        return false
      }
    }
    await waitUntil(() => !isAlive())
    expect(isAlive()).toBe(false)
  }, 15_000)

  it('kills the process and reports a timeout when timeoutMs elapses', async () => {
    const bridge = await startDeferMcpBridge({ conversationId: 'conv-1', cwd: process.cwd() })
    bridges.push(bridge)

    await post(bridge, '/call', {
      toolName: 'run_and_notify',
      args: { command: SLEEP_30, label: 'slow job', timeoutMs: 200 },
    })
    await waitUntil(() => vi.mocked(resolveDeferredCallback).mock.calls.length > 0)

    expect(resolveDeferredCallback).toHaveBeenCalledWith(
      'process',
      expect.any(String),
      expect.objectContaining({ status: 'timeout' }),
    )
  }, 15_000)
})

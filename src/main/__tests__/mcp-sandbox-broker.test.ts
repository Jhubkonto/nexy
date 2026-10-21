import { createConnection } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MCP_SANDBOX_PROFILE } from '../../shared/mcp-sandbox'
import {
  getMcpSandboxProxyConfig,
  getMcpSandboxSessionCount,
  shutdownMcpSandboxBroker,
} from '../mcp-sandbox'

async function claimSession(endpoint: string, token: string): Promise<() => Promise<void>> {
  const [host, rawPort] = endpoint.split(':')
  const port = Number(rawPort)
  return await new Promise<() => Promise<void>>((resolve, reject) => {
    const socket = createConnection({ host, port })
    let response = ''
    socket.once('error', reject)
    socket.once('connect', () => socket.write(`${JSON.stringify({ type: 'hello', token })}\n`))
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8')
      if (!response.includes('\n')) return
      try {
        expect(JSON.parse(response)).toMatchObject({ type: 'launch', protocolVersion: 1 })
        resolve(() => new Promise<void>((closeResolve) => {
          socket.once('close', closeResolve)
          socket.end()
        }))
      } catch (error) {
        reject(error)
      }
    })
  })
}

afterEach(async () => {
  await shutdownMcpSandboxBroker()
})

describe('MCP sandbox broker lifecycle', () => {
  it('does not release managed-runtime files immediately after the helper claims its descriptor', async () => {
    const cleanup = vi.fn()
    const proxy = getMcpSandboxProxyConfig({
      command: 'node.exe',
      args: [],
      env: {},
      profile: { ...DEFAULT_MCP_SANDBOX_PROFILE, network: 'allowed', childProcesses: 'allowed', filesystem: [] },
      cleanup,
    })
    const endpoint = proxy.args[1]
    const token = proxy.args[3]

    const closeControlConnection = await claimSession(endpoint, token)
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(getMcpSandboxSessionCount()).toBe(1)
    expect(cleanup).not.toHaveBeenCalled()

    await closeControlConnection()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(cleanup).toHaveBeenCalledOnce()
    expect(getMcpSandboxSessionCount()).toBe(0)
  })
})

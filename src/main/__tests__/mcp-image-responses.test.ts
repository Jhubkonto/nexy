import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConnection } from 'node:net'

const { mockIpcMain, mockDb, transportOptions } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const serverRows: { id: string; config_json: string; enabled: number }[] = []
  const transportOptions: Array<Record<string, unknown>> = []

  return {
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      _handlers: handlers
    },
    mockDb: {
      prepare: vi.fn((sql: string) => ({
        run: vi.fn((...args: unknown[]) => {
          if (sql.includes('INSERT OR REPLACE INTO mcp_servers')) {
            // Column order: (id, config_json, config_encrypted, enabled, updated_at)
            const idx = serverRows.findIndex((row) => row.id === args[0])
            const row = { id: args[0] as string, config_json: args[1] as string, enabled: args[3] as number }
            if (idx >= 0) serverRows[idx] = row
            else serverRows.push(row)
          }
          return { changes: 1 }
        }),
        all: vi.fn(() => [...serverRows]),
        get: vi.fn(() => undefined)
      }))
    },
    transportOptions
  }
})

const { MockClient, MockTransport } = vi.hoisted(() => {
  class MockTransport {
    onclose?: () => void
    constructor(options: Record<string, unknown>) {
      transportOptions.push(options)
    }
    close = vi.fn().mockResolvedValue(undefined)
  }

  class MockClient {
    connect = vi.fn().mockResolvedValue(undefined)
    listTools = vi.fn().mockResolvedValue({ tools: [] })
    callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false })
  }

  return { MockClient, MockTransport }
})

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  }
}))

vi.mock('../database', () => ({
  getDatabase: () => mockDb
}))

vi.mock('../safe-handle', () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handle(channel, handler)
  }
}))

vi.mock('../tools', () => ({
  requestApproval: vi.fn().mockResolvedValue(true)
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: MockTransport
}))

import { registerMcpHandlers, shutdownMcpServers, servers } from '../mcp'

async function invokeHandler(channel: string, ...args: unknown[]) {
  const handler = mockIpcMain._handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler({ sender: { isDestroyed: vi.fn().mockReturnValue(false) } }, ...args)
}

async function readSandboxLaunch(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const args = options.args as string[]
  const endpoint = args[1]
  const token = args[3]
  return await new Promise((resolve, reject) => {
    let buffer = ''
    let attempts = 0
    const connect = () => {
      const socket = createConnection(Number(endpoint.split(':')[1]), '127.0.0.1')
      socket.on('connect', () => socket.write(`${JSON.stringify({ type: 'hello', token })}\n`))
      socket.on('data', (chunk) => {
        buffer += chunk.toString()
        const line = buffer.split('\n')[0]
        if (!line) return
        socket.end()
        resolve(JSON.parse(line) as Record<string, unknown>)
      })
      socket.on('error', () => {
        if (++attempts < 20) setTimeout(connect, 10)
        else reject(new Error(`could not connect to sandbox test session at ${endpoint}`))
      })
    }
    connect()
  })
}

describe('MCP imageResponses transport args', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transportOptions.length = 0
    servers.clear()
    registerMcpHandlers()
  })

  afterEach(async () => {
    await shutdownMcpServers()
  })

  it('includes --imageResponses omit when configured', async () => {
    await invokeHandler('mcp:add-server', {
      name: 'Playwright',
      command: 'npx',
      args: ['@playwright/mcp'],
      env: {},
      imageResponses: 'omit',
      enabled: true
    })

    expect(transportOptions[0]?.args).toContain('--session')
    const launch = await readSandboxLaunch(transportOptions[0])
    expect(launch.args).toEqual(['@playwright/mcp', '--imageResponses', 'omit'])
  })

  it('does not include imageResponses args when undefined or allow', async () => {
    await invokeHandler('mcp:add-server', {
      name: 'Default',
      command: 'npx',
      args: ['tool-a'],
      env: {},
      enabled: true
    })
    await invokeHandler('mcp:add-server', {
      name: 'Allow',
      command: 'npx',
      args: ['tool-b'],
      env: {},
      imageResponses: 'allow',
      enabled: true
    })

    expect(transportOptions[0]?.args).toContain('--session')
    expect(transportOptions[1]?.args).toContain('--session')
    expect((await readSandboxLaunch(transportOptions[0])).args).toEqual(['tool-a'])
    expect((await readSandboxLaunch(transportOptions[1])).args).toEqual(['tool-b'])
  })
})

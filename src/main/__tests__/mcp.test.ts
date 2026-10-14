import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/* ── Hoisted mocks ─────────────────────────────────────────── */
const { mockIpcMain, mockDb, mockOverrideRows, mockAgentRows, mockTrustRows } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const serverRows: { id: string; config_json: string; config_encrypted: number; enabled: number }[] = []
  const overrideRows = new Map<string, { enabled: number; approval: string }>()
  const agentRows = [
    { id: 'agent-1', config_json: JSON.stringify({ name: 'Research Agent', mcpServers: [] }) },
    { id: 'agent1', config_json: JSON.stringify({ name: 'Approval Agent', mcpServers: [] }) },
  ]
  const trustRows = new Map<string, string>()

  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    _handlers: handlers
  }

  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT OR REPLACE INTO mcp_servers')) {
          // Column order: (id, config_json, config_encrypted, enabled, updated_at)
          const idx = serverRows.findIndex((r) => r.id === args[0])
          const row = {
            id: args[0] as string,
            config_json: args[1] as string,
            config_encrypted: args[2] as number,
            enabled: args[3] as number,
          }
          if (idx >= 0) serverRows[idx] = row
          else serverRows.push(row)
        }
        if (sql.includes('DELETE FROM mcp_servers')) {
          const idx = serverRows.findIndex((r) => r.id === args[0])
          if (idx >= 0) serverRows.splice(idx, 1)
        }
        if (sql.includes('UPDATE agents SET config_json')) {
          const row = agentRows.find((agent) => agent.id === args[2])
          if (row) row.config_json = args[0] as string
        }
        if (sql.includes('INSERT OR REPLACE INTO agent_mcp_server_trust')) {
          trustRows.set(`${args[0]}:${args[1]}`, args[2] as string)
        }
        return { changes: 1 }
      }),
      all: vi.fn((...args: unknown[]) => {
        void args
        if (sql.includes('agent_mcp_server_trust')) {
          return [...trustRows.entries()].map(([key, trust]) => {
            const [agent_id, server_id] = key.split(':')
            return { agent_id, server_id, trust }
          })
        }
        return [...serverRows]
      }),
      get: vi.fn((...args: unknown[]): unknown => {
        if (sql.includes('agent_mcp_tool_overrides')) {
          const key = `${args[0]}:${args[1]}:${args[2]}`
          return overrideRows.get(key)
        }
        if (sql.includes('agent_mcp_server_trust')) {
          const trust = trustRows.get(`${args[0]}:${args[1]}`)
          return trust ? { trust } : undefined
        }
        if (sql.includes('SELECT config_json FROM agents')) {
          return agentRows.find((agent) => agent.id === args[0])
        }
        return undefined
      })
    })),
    _serverRows: serverRows,
    _agentRows: agentRows,
    _trustRows: trustRows,
  }

  return { mockIpcMain, mockDb, mockOverrideRows: overrideRows, mockAgentRows: agentRows, mockTrustRows: trustRows }
})

/* ── Mock requestApproval from tools ──────────────────────── */
const { mockRequestApproval } = vi.hoisted(() => ({
  mockRequestApproval: vi.fn().mockResolvedValue(true)
}))

const { MockClient, MockTransport } = vi.hoisted(() => {
  class MockTransport {
    close = vi.fn().mockResolvedValue(undefined)
    onclose?: () => void
  }

  class MockClient {
    connect = vi.fn().mockResolvedValue(undefined)
    listTools = vi.fn().mockResolvedValue({ tools: [] })
    callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false })
  }

  return { MockClient, MockTransport }
})

vi.mock('../tools', () => ({
  requestApproval: mockRequestApproval
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: MockTransport
}))

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  // Keyring unavailable in tests → mcp.ts falls back to plaintext config storage.
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  }
}))

vi.mock('../database', () => ({
  getDatabase: () => mockDb
}))

/* ── Import & Register ─────────────────────────────────────── */
import { registerMcpHandlers, disconnectServer, shutdownMcpServers, servers, callMcpTool, getMcpServersForCompanion, buildMcpProcessEnv, getMcpServerConfigsForCli } from '../mcp'
import { safeStorage } from 'electron'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

/* ── Helpers ─────────────────────────────────────────────── */
const fakeSender = {
  id: 1,
  send: vi.fn(),
  isDestroyed: vi.fn().mockReturnValue(false)
}

async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const handler = mockIpcMain._handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  const fakeEvent = { sender: fakeSender }
  return handler(fakeEvent, ...args)
}

function makeMockClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false })
  }
}

/** Directly inject a connected server — bypasses SDK subprocess spawning */
function injectConnectedServer(id: string, name: string, client: ReturnType<typeof makeMockClient>) {
  servers.set(id, {
    config: { id, name, command: 'node', args: [], env: {}, enabled: true },
    client: client as unknown as Client,
    transport: { close: vi.fn().mockResolvedValue(undefined) } as unknown as StdioClientTransport,
    status: 'connected',
    tools: [{ name: 'testTool', description: 'Does a thing', inputSchema: {}, serverId: id, serverName: name }]
  })
}

beforeEach(() => {
  mockDb._serverRows.length = 0
  mockAgentRows[0].config_json = JSON.stringify({ name: 'Research Agent', mcpServers: [] })
  mockAgentRows[1].config_json = JSON.stringify({ name: 'Approval Agent', mcpServers: [] })
  mockTrustRows.clear()
  mockOverrideRows.clear()
  servers.clear()
  vi.useRealTimers()
  vi.clearAllMocks()
  fakeSender.isDestroyed.mockReturnValue(false)
  mockRequestApproval.mockResolvedValue(true)
  registerMcpHandlers()
})

afterEach(async () => {
  await shutdownMcpServers()
  vi.useRealTimers()
})

/* ── Tests ─────────────────────────────────────── */
describe('MCP — IPC Handlers', () => {
  it('mcp:list-servers returns empty when no servers configured', async () => {
    const r = await invokeHandler('mcp:list-servers')
    expect(r).toEqual([])
  })

  it('mcp:add-server stores config and returns with id', async () => {
    const config = { name: 'Test MCP', command: 'node', args: ['server.js'], env: {}, enabled: false }
    const r = await invokeHandler('mcp:add-server', config)
    expect(r.id).toBeDefined()
    expect(r.name).toBe('Test MCP')
    expect(mockDb._serverRows.length).toBe(1)
  })

  it('mcp:add-server returns fullConfig', async () => {
    const config = { name: 'Active Server', command: 'npx', args: ['-y', 'some-mcp'], env: {}, enabled: false }
    const result = await invokeHandler('mcp:add-server', config)
    expect(result.name).toBe('Active Server')
    expect(result.enabled).toBe(false)
    expect(mockDb._serverRows.length).toBe(1)
  })

  it('mcp:remove-server deletes config', async () => {
    const config = { name: 'Tmp', command: 'x', args: [], env: {}, enabled: false }
    const added = await invokeHandler('mcp:add-server', config)
    const r = await invokeHandler('mcp:remove-server', added.id)
    expect(r).toBe(true)
  })

  it('mcp:get-server-status returns disconnected for unknown server', async () => {
    const r = await invokeHandler('mcp:get-server-status', 'nonexistent')
    expect(r.status).toBe('disconnected')
    expect(r.tools).toEqual([])
  })

  it('mcp:list-tools returns empty when no servers connected', async () => {
    const r = await invokeHandler('mcp:list-tools')
    expect(r).toEqual([])
  })
})

describe('MCP — Secret storage at rest', () => {
  it('persists config as plaintext with config_encrypted=0 when keyring is unavailable', async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    await invokeHandler('mcp:add-server', {
      name: 'Plain', command: 'node', args: [], env: { API_KEY: 'sekret' }, enabled: false
    })
    const row = mockDb._serverRows[0]
    expect(row.config_encrypted).toBe(0)
    expect(row.config_json).toContain('sekret') // plaintext fallback
  })

  it('encrypts config and round-trips env secrets when keyring is available', async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    const added = await invokeHandler('mcp:add-server', {
      name: 'Secure', command: 'node', args: [], env: { API_KEY: 'sekret' }, enabled: false
    })

    const row = mockDb._serverRows[0]
    expect(row.config_encrypted).toBe(1)
    // Stored blob is base64 of the encrypted bytes — must not expose the secret verbatim.
    expect(Buffer.from(row.config_json, 'base64').toString()).toContain('sekret')

    // list-servers reads it back through the decrypt path.
    const servers = await invokeHandler('mcp:list-servers')
    const loaded = servers.find((s: { id: string }) => s.id === added.id)
    expect(loaded.env.API_KEY).toBe('sekret')

    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
  })
})

describe('MCP — Pre-flight test-server', () => {
  it('rejects a blank command without spawning', async () => {
    const r = await invokeHandler('mcp:test-server', { command: '', args: [], env: {} })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/command is required/i)
  })

  it('connects, lists tools, and reports ok', async () => {
    const r = await invokeHandler('mcp:test-server', { command: 'node', args: ['server.js'], env: {} })
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.tools)).toBe(true)
  })

  it('does not persist or register the ephemeral server', async () => {
    await invokeHandler('mcp:test-server', { command: 'node', args: [], env: {} })
    expect(mockDb._serverRows.length).toBe(0)
    expect(servers.size).toBe(0)
  })
})

describe('MCP — Agent assignment', () => {
  it('assigns a server and persists the selected trust tier', async () => {
    const added = await invokeHandler('mcp:add-server', {
      name: 'Calendar', command: 'node', args: [], env: {}, enabled: false
    })

    const result = await invokeHandler('agent:assign-mcp-server', 'agent-1', added.id, 'always-ask')

    expect(result).toEqual({ assigned: true, trust: 'always-ask' })
    expect(JSON.parse(mockAgentRows[0].config_json).mcpServers).toEqual([added.id])
    expect(mockTrustRows.get(`agent-1:${added.id}`)).toBe('always-ask')
  })

  it('rejects an invalid trust tier', async () => {
    const added = await invokeHandler('mcp:add-server', {
      name: 'Calendar', command: 'node', args: [], env: {}, enabled: false
    })

    await expect(invokeHandler('agent:assign-mcp-server', 'agent-1', added.id, 'trust-everything')).resolves.toEqual({ error: 'Invalid MCP trust tier' })
  })
})

describe('MCP — Tool Approval', () => {
  function addTestServer() {
    const id = `test-server-${Math.random().toString(36).slice(2)}`
    const client = makeMockClient()
    injectConnectedServer(id, 'ApprovalServer', client)
    const agent = mockAgentRows.find((row) => row.id === 'agent1')!
    const config = JSON.parse(agent.config_json) as { mcpServers: string[] }
    config.mcpServers.push(id)
    agent.config_json = JSON.stringify(config)
    return { id, client }
  }

  it('calls requestApproval when approval is always-ask', async () => {
    const { id: serverId } = addTestServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })

    await invokeHandler('mcp:call-tool', serverId, 'testTool', { x: 1 }, 'agent1')

    expect(mockRequestApproval).toHaveBeenCalledWith(
      fakeSender,
      'testTool',
      { x: 1 },
      expect.any(String),
      { noRemember: true }
    )
  })

  it('executes tool when approval is granted', async () => {
    const { id: serverId, client } = addTestServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })
    mockRequestApproval.mockResolvedValue(true)

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(true)
    expect(client.callTool).toHaveBeenCalled()
  })

  it('denies tool execution when approval is rejected', async () => {
    const { id: serverId, client } = addTestServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })
    mockRequestApproval.mockResolvedValue(false)

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(false)
    expect(r.error).toContain('denied')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('auto-approves when approval policy is auto', async () => {
    const { id: serverId, client } = addTestServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'auto' })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(true)
    expect(mockRequestApproval).not.toHaveBeenCalled()
    expect(client.callTool).toHaveBeenCalled()
  })

  it('defaults to always-ask when no override exists for an agent', async () => {
    const { id: serverId } = addTestServer()
    // No override row — defaults to always-ask
    await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(mockRequestApproval).toHaveBeenCalled()
  })

  it('denies when approval is disabled', async () => {
    const { id: serverId, client } = addTestServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'disabled' })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(false)
    expect(r.error).toContain('disabled')
    expect(mockRequestApproval).not.toHaveBeenCalled()
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('denies when enabled flag is 0', async () => {
    const { id: serverId, client } = addTestServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 0, approval: 'auto' })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(false)
    expect(r.error).toContain('disabled')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('rejects direct calls without an agentId', async () => {
    const { id: serverId } = addTestServer()
    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {})
    expect(r.success).toBe(false)
    expect(r.error).toContain('agent identity')
  })

  it('rejects direct calls without an assigned agent', async () => {
    const { id: serverId, client } = addTestServer()
    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent-1')
    expect(r.success).toBe(false)
    expect(r.error).toContain('not assigned')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('rejects direct calls for tools that were not discovered from the server', async () => {
    const { id: serverId, client } = addTestServer()
    const r = await invokeHandler('mcp:call-tool', serverId, 'forgedTool', {}, 'agent1')
    expect(r.success).toBe(false)
    expect(r.error).toContain('not available')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('requires an agent identity for direct IPC calls', async () => {
    const { id: serverId, client } = addTestServer()
    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {})
    expect(r.success).toBe(false)
    expect(r.error).toContain('agent identity')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('fails closed when always-ask but webContents is destroyed', async () => {
    const { id: serverId, client } = addTestServer()
    fakeSender.isDestroyed.mockReturnValue(true)

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(false)
    expect(r.error).toContain('no UI is available')
    expect(mockRequestApproval).not.toHaveBeenCalled()
    expect(client.callTool).not.toHaveBeenCalled()
  })

  describe('Agentic Mode', () => {
    it('auto-approves a tool with no explicit override when agenticMode=true', async () => {
      const { id: serverId, client } = addTestServer()
      // No override row exists — default always-ask — should be bypassed
      client.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'done' }], isError: false })

      const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, true)
      expect(mockRequestApproval).not.toHaveBeenCalled()
      expect(r.success).toBe(true)
    })

    it('still prompts for an explicit always-ask override even when agenticMode=true', async () => {
      const { id: serverId } = addTestServer()
      mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })
      mockRequestApproval.mockResolvedValue(true)

      await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, true)
      expect(mockRequestApproval).toHaveBeenCalled()
    })

    it('still blocks a disabled tool when agenticMode=true', async () => {
      const { id: serverId } = addTestServer()
      mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'disabled' })

      const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, true)
      expect(r.success).toBe(false)
      expect(r.error).toContain('disabled')
      expect(mockRequestApproval).not.toHaveBeenCalled()
    })

    it('still blocks an enabled=0 tool when agenticMode=true', async () => {
      const { id: serverId } = addTestServer()
      mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 0, approval: 'auto' })

      const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, true)
      expect(r.success).toBe(false)
      expect(mockRequestApproval).not.toHaveBeenCalled()
    })
  })
})

describe('MCP — Image extraction', () => {
  function addAutoApproveServer() {
    const id = `img-server-${Math.random().toString(36).slice(2)}`
    const client = makeMockClient()
    injectConnectedServer(id, 'ImgServer', client)
    const agent = mockAgentRows.find((row) => row.id === 'agent1')!
    const config = JSON.parse(agent.config_json) as { mcpServers: string[] }
    config.mcpServers.push(id)
    agent.config_json = JSON.stringify(config)
    mockOverrideRows.set(`agent1:${id}:testTool`, { enabled: 1, approval: 'auto' })
    return { id, client }
  }

  it('returns images array when tool result contains image content', async () => {
    const { id: serverId, client } = addAutoApproveServer()
    client.callTool.mockResolvedValue({
      content: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
      isError: false
    })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.success).toBe(true)
    expect(r.images).toHaveLength(1)
    expect(r.images[0].dataUrl).toBe('data:image/png;base64,abc123')
    expect(r.images[0].mimeType).toBe('image/png')
  })

  it('suppresses JSON fallback and returns summary text when only images present', async () => {
    const { id: serverId, client } = addAutoApproveServer()
    client.callTool.mockResolvedValue({
      content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
      isError: false
    })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.result).toMatch(/Screenshot captured/)
    expect(r.result).not.toContain('base64data')
  })

  it('returns both text result and images when tool result has mixed content', async () => {
    const { id: serverId, client } = addAutoApproveServer()
    client.callTool.mockResolvedValue({
      content: [
        { type: 'text', text: 'Screenshot of viewport' },
        { type: 'image', data: 'imgdata', mimeType: 'image/png' }
      ],
      isError: false
    })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.result).toBe('Screenshot of viewport')
    expect(r.images).toHaveLength(1)
    expect(r.images[0].dataUrl).toBe('data:image/png;base64,imgdata')
  })

  it('returns no images field when tool result has only text content', async () => {
    const { id: serverId, client } = addAutoApproveServer()
    client.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'plain result' }],
      isError: false
    })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.result).toBe('plain result')
    expect(r.images).toBeUndefined()
  })

  it('handles multiple images in result', async () => {
    const { id: serverId, client } = addAutoApproveServer()
    client.callTool.mockResolvedValue({
      content: [
        { type: 'image', data: 'img1', mimeType: 'image/png' },
        { type: 'image', data: 'img2', mimeType: 'image/jpeg' }
      ],
      isError: false
    })

    const r = await invokeHandler('mcp:call-tool', serverId, 'testTool', {}, 'agent1')
    expect(r.images).toHaveLength(2)
    expect(r.result).toMatch(/2 image\(s\)/)
  })
})

describe('MCP — fullAutoApprove bypass', () => {
  function addFaaServer() {
    const id = `faa-server-${Math.random().toString(36).slice(2)}`
    const client = makeMockClient()
    injectConnectedServer(id, 'FaaServer', client)
    const agent = mockAgentRows.find((row) => row.id === 'agent1')!
    const config = JSON.parse(agent.config_json) as { mcpServers: string[] }
    config.mcpServers.push(id)
    agent.config_json = JSON.stringify(config)
    client.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'done' }], isError: false })
    return { id, client }
  }

  it('bypasses an explicit always-ask override when fullAutoApprove is true', async () => {
    const { id: serverId, client } = addFaaServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })

    const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, false, false, true)
    expect(mockRequestApproval).not.toHaveBeenCalled()
    expect(r.success).toBe(true)
    expect(client.callTool).toHaveBeenCalled()
  })

  it('never bypasses a blocked server trust when fullAutoApprove is true', async () => {
    const { id: serverId, client } = addFaaServer()
    mockTrustRows.set(`agent1:${serverId}`, 'block')

    const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, false, false, true)
    expect(r.success).toBe(false)
    expect(r.error).toContain('blocked')
    expect(client.callTool).not.toHaveBeenCalled()
    expect(mockRequestApproval).not.toHaveBeenCalled()
  })

  it('enforces a conversation policy even when the agent row has no server grant', async () => {
    const { id: serverId, client } = addFaaServer()
    const r = await callMcpTool(
      serverId,
      'testTool',
      {},
      'agent-1',
      fakeSender as unknown as Electron.WebContents,
      false,
      false,
      true,
      { assignedServerIds: [serverId], serverTrust: { [serverId]: 'block' } },
    )
    expect(r.success).toBe(false)
    expect(r.error).toContain('blocked')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('does not let a per-tool auto row override an agent server block', async () => {
    const { id: serverId, client } = addFaaServer()
    mockTrustRows.set(`agent1:${serverId}`, 'block')
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'auto' })

    const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, false, false, true)
    expect(r.success).toBe(false)
    expect(r.error).toContain('blocked')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('never bypasses a disabled tool override when fullAutoApprove is true', async () => {
    const { id: serverId, client } = addFaaServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 0, approval: 'auto' })

    const r = await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, false, false, true)
    expect(r.success).toBe(false)
    expect(r.error).toContain('disabled')
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('still respects explicit always-ask override when fullAutoApprove is false', async () => {
    const { id: serverId } = addFaaServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'always-ask' })
    mockRequestApproval.mockResolvedValue(true)

    await callMcpTool(serverId, 'testTool', {}, 'agent1', fakeSender as unknown as Electron.WebContents, false, false, false)
    expect(mockRequestApproval).toHaveBeenCalled()
  })

  it('emits tool:auto-approved when fullAutoApprove is true', async () => {
    const { id: serverId } = addFaaServer()
    mockOverrideRows.set(`agent1:${serverId}:testTool`, { enabled: 1, approval: 'auto' })

    await callMcpTool(serverId, 'testTool', { x: 1 }, 'agent1', fakeSender as unknown as Electron.WebContents, false, false, true)
    expect(fakeSender.send).toHaveBeenCalledWith('tool:auto-approved', { toolName: 'testTool', args: { x: 1 } })
  })
})

describe('MCP — Crash recovery', () => {
  it('does not restart a disabled server', async () => {
    const added = await invokeHandler('mcp:add-server', {
      name: 'Disabled Server', command: 'node', args: [], env: {}, enabled: false,
    })

    const result = await invokeHandler('mcp:restart-server', added.id)
    expect(result).toEqual(expect.objectContaining({ attempted: false, connected: false }))
    expect(servers.has(added.id)).toBe(false)
  })

  it('diagnoses a saved server without starting its live connection', async () => {
    const added = await invokeHandler('mcp:add-server', {
      name: 'Diagnostic Server', command: 'node', args: [], env: {}, enabled: false,
    })

    const result = await invokeHandler('mcp:diagnose-server', added.id)

    expect(result).toEqual(expect.objectContaining({
      found: true,
      enabled: false,
      status: 'disconnected',
      test: expect.objectContaining({ ok: true }),
    }))
    expect(result.guidance.join(' ')).toContain('Enable the server')
    expect(servers.has(added.id)).toBe(false)
  })

  it('auto-reconnects after an unexpected transport close', async () => {
    vi.useFakeTimers()

    const added = await invokeHandler('mcp:add-server', {
      name: 'Recoverable Server',
      command: 'node',
      args: ['server.js'],
      env: {},
      enabled: true
    })

    const instance = servers.get(added.id)
    expect(instance?.status).toBe('connected')

    ;(instance?.transport as { onclose?: () => void }).onclose?.()
    expect(servers.has(added.id)).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)

    expect(servers.get(added.id)?.status).toBe('connected')
  })

  it('does not auto-reconnect after intentional disconnect', async () => {
    vi.useFakeTimers()

    const added = await invokeHandler('mcp:add-server', {
      name: 'Disconnectable Server',
      command: 'node',
      args: ['server.js'],
      env: {},
      enabled: true
    })

    const instance = servers.get(added.id)
    ;(instance?.transport as { onclose?: () => void }).onclose?.()

    await disconnectServer(added.id)
    await vi.advanceTimersByTimeAsync(5000)

    expect(servers.has(added.id)).toBe(false)
  })
})

describe('MCP — Companion redaction', () => {
  it('never includes environment secrets in companion server payloads', async () => {
    const added = await invokeHandler('mcp:add-server', {
      name: 'Secret Server', command: 'node', args: [], env: { API_KEY: 'do-not-send' }, enabled: false,
    })

    const payload = getMcpServersForCompanion()
    const server = payload.find((entry) => entry.id === added.id)
    expect(server).toBeDefined()
    expect(server).not.toHaveProperty('env')
    expect(JSON.stringify(server)).not.toContain('do-not-send')
  })
})

describe('MCP — CLI sandbox proxy', () => {
  it('does not expose a third-party command, cwd, or environment to a CLI adapter', async () => {
    const added = await invokeHandler('mcp:add-server', {
      name: 'CLI Secret Server', command: 'node', args: ['server.js'], cwd: 'C:\\private',
      env: { API_KEY: 'must-not-reach-cli' }, enabled: false,
    })
    // CLI preparation only returns enabled servers.
    await invokeHandler('mcp:update-server', added.id, { enabled: true })
    const [proxy] = getMcpServerConfigsForCli([added.id])
    expect(proxy.command).not.toBe('node')
    expect(proxy.args).toContain('--session')
    expect(proxy.args).not.toContain('server.js')
    expect(proxy.cwd).toBeUndefined()
    expect(proxy.env).toBeUndefined()
    expect(JSON.stringify(proxy)).not.toContain('must-not-reach-cli')
  })
})

describe('MCP — child process boundary', () => {
  it('inherits only launch variables and explicit server variables', () => {
    const previous = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'must-not-cross'
    const env = buildMcpProcessEnv({ MCP_TOKEN: 'explicit-server-secret' })
    expect(env.MCP_TOKEN).toBe('explicit-server-secret')
    expect(env.OPENAI_API_KEY).toBeUndefined()
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  })
})

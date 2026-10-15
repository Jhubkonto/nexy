import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { McpServerPanel } from '../../renderer/components/McpServerPanel'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({
  useAppStore
}))

let mockApi: MockApi
let mockStore: ReturnType<typeof createMockAppStore>
const user = userEvent.setup()

const SAMPLE_SERVERS = [
  {
    id: 'srv-1',
    name: 'GitHub MCP',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: 'test' },
    cwd: undefined,
    enabled: true,
    status: 'connected' as const,
    toolCount: 5
  },
  {
    id: 'srv-2',
    name: 'Broken Server',
    command: 'node',
    args: ['server.js'],
    env: {},
    cwd: '/tmp',
    enabled: false,
    status: 'error' as const,
    error: 'Connection refused',
    toolCount: 0
  }
]

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.listMcpServers = vi.fn().mockResolvedValue(SAMPLE_SERVERS)
  mockStore = createMockAppStore({ showMcpPanel: true })
  setupStoreMock(useAppStore, mockStore)
})

describe('McpServerPanel — Rendering', () => {
  it('does not render when not visible', () => {
    mockStore = createMockAppStore({ showMcpPanel: false })
    setupStoreMock(useAppStore, mockStore)

    const { container } = render(<McpServerPanel />)
    expect(container.innerHTML).toBe('')
  })

  it('renders server list with status indicators', async () => {
    render(<McpServerPanel />)

    await waitFor(() => {
      expect(screen.getByText('GitHub MCP')).toBeInTheDocument()
      expect(screen.getByText('Broken Server')).toBeInTheDocument()
    })
  })

  it('shows tool count for connected servers', async () => {
    render(<McpServerPanel />)

    await waitFor(() => {
      expect(screen.getByText('5 tools')).toBeInTheDocument()
    })
  })

  it('shows error message for errored servers', async () => {
    render(<McpServerPanel />)

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeInTheDocument()
    })
  })

  it('shows the add-a-server gallery when no servers', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    render(<McpServerPanel />)

    await waitFor(() => {
      expect(screen.getByText('Add a server')).toBeInTheDocument()
      expect(screen.getByText('Custom server')).toBeInTheDocument()
    })
  })

  it('offers catalog entries in the gallery', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Filesystem')).toBeInTheDocument())
  })

  it('browses the official registry and opens an installable result', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    mockApi.searchMcpRegistry = vi.fn().mockResolvedValue({
      stale: false,
      fetchedAt: Date.now(),
      servers: [{
        name: 'io.github.acme/calendar',
        title: 'Calendar',
        description: 'Read calendars',
        version: '1.2.3',
        status: 'active',
        isLatest: true,
        transport: 'stdio',
        install: {
          command: 'npx',
          args: ['-y', '@acme/calendar@1.2.3'],
          requiredEnv: [],
        },
      }],
    })
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Browse official MCP Registry')).toBeInTheDocument())
    await user.click(screen.getByText('Browse official MCP Registry'))
    await user.type(screen.getByRole('textbox', { name: 'Search MCP Registry' }), 'calendar')
    await user.click(screen.getByText('Search'))

    expect(await screen.findByText('Calendar')).toBeInTheDocument()
    await user.click(screen.getByText('Use this server'))
    expect(screen.getByDisplayValue('Calendar')).toBeInTheDocument()
  })

  it('organizes the tool library by server with capability and risk metadata', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue(SAMPLE_SERVERS)
    mockApi.listMcpTools = vi.fn().mockResolvedValue([
      {
        name: 'read_file',
        description: 'Read a local file',
        serverId: 'srv-1',
        serverName: 'GitHub MCP',
      },
      {
        name: 'delete_repository',
        description: 'Delete a repository',
        serverId: 'srv-1',
        serverName: 'GitHub MCP',
      },
    ])
    render(<McpServerPanel />)

    await user.click(screen.getByRole('button', { name: /Tool library/ }))

    expect((await screen.findAllByText('Tool library')).length).toBeGreaterThan(0)
    expect(screen.getByText('GitHub MCP')).toBeInTheDocument()
    expect(screen.getByText('Read File')).toBeInTheDocument()
    expect(screen.getByText('Delete Repository')).toBeInTheDocument()
    expect(screen.getAllByText('High impact').length).toBeGreaterThan(0)
    expect(screen.getByText(/Local files and folders/)).toBeInTheDocument()
  })

  it('lets an agent enable a server from the Agent access view', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue(SAMPLE_SERVERS)
    mockApi.listAgents = vi.fn().mockResolvedValue([{
      id: 'agent-1',
      name: 'Research Agent',
      icon: '🔎',
      mcpServers: [],
    }])
    render(<McpServerPanel />)

    await user.click(screen.getByRole('button', { name: /Agent access/ }))

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Agent to configure' })).toHaveValue('agent-1'))
    await user.click(screen.getByRole('button', { name: /Add GitHub MCP to Research Agent/ }))

    await waitFor(() => expect(mockApi.assignMcpServerToAgent).toHaveBeenCalledWith(
      'agent-1',
      'srv-1',
      'always-ask',
    ))
  })
})

describe('McpServerPanel — CRUD Operations', () => {
  it('custom server button opens form', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Custom server')).toBeInTheDocument())
    await user.click(screen.getByText('Custom server'))

    expect(screen.getByPlaceholderText('My MCP Server')).toBeInTheDocument()
    expect(screen.getByText('Add Server')).toBeInTheDocument()
  })

  it('catalog card pre-fills the form', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Filesystem')).toBeInTheDocument())
    await user.click(screen.getByText('Filesystem'))

    expect(screen.getByPlaceholderText('My MCP Server')).toHaveValue('Filesystem')
  })

  it('shows explicit managed Chromium setup for the Playwright card', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Control a browser')).toBeInTheDocument())
    await user.click(screen.getByText('Control a browser'))

    expect(screen.getByText('Nexy-managed Playwright')).toBeInTheDocument()
    expect(screen.getByText('Download Chromium')).toBeInTheDocument()
    expect(screen.queryByText('Advanced (launch command)')).not.toBeInTheDocument()
  })

  it('renders a guided secret field for a catalog entry with requiredEnv', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub')).toBeInTheDocument())
    await user.click(screen.getByText('GitHub'))

    // Labeled, masked field for the declared token + a help link.
    const field = screen.getByPlaceholderText('GITHUB_PERSONAL_ACCESS_TOKEN') as HTMLInputElement
    expect(field.type).toBe('password')
    expect(screen.getByText('How to get one')).toBeInTheDocument()
  })

  it('save new server calls addMcpServer', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Custom server')).toBeInTheDocument())
    await user.click(screen.getByText('Custom server'))

    await user.type(screen.getByPlaceholderText('My MCP Server'), 'Test Server')
    await user.type(screen.getByPlaceholderText('npx'), 'node')
    await user.click(screen.getByText('Add Server'))

    expect(mockApi.addMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Test Server', command: 'node' })
    )
  })

  it('offers safe assignment and trust after adding a server', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    mockApi.listAgents = vi.fn().mockResolvedValue([{ id: 'agent-1', name: 'Research Agent' }])
    mockApi.addMcpServer = vi.fn().mockResolvedValue({ id: 'mcp-new', name: 'Test Server' })
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Custom server')).toBeInTheDocument())
    await user.click(screen.getByText('Custom server'))
    await user.type(screen.getByPlaceholderText('My MCP Server'), 'Test Server')
    await user.type(screen.getByPlaceholderText('npx'), 'node')
    await user.click(screen.getByText('Add Server'))

    expect(await screen.findByText('Test Server is ready')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Research Agent')).toBeInTheDocument()
    await user.click(screen.getByText('Add to agent'))

    await waitFor(() => expect(mockApi.assignMcpServerToAgent).toHaveBeenCalledWith(
      'agent-1',
      'mcp-new',
      'always-ask',
    ))
  })

  it('delete server calls removeMcpServer', async () => {
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())

    const removeButtons = screen.getAllByTitle('Remove')
    await user.click(removeButtons[0])

    expect(mockApi.removeMcpServer).toHaveBeenCalledWith('srv-1')
  })

  it('toggle server calls updateMcpServer with enabled flag', async () => {
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())

    const onButton = screen.getByText('ON')
    await user.click(onButton)

    expect(mockApi.updateMcpServer).toHaveBeenCalledWith('srv-1', { enabled: false })
  })

  it('restart server calls restartMcpServer', async () => {
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())

    const restartButtons = screen.getAllByTitle('Retry connection')
    await user.click(restartButtons[0])

    expect(mockApi.restartMcpServer).toHaveBeenCalledWith('srv-1')
  })

  it('runs an isolated diagnosis and displays actionable guidance for an offline server', async () => {
    mockApi.diagnoseMcpServer = vi.fn().mockResolvedValue({
      found: true,
      enabled: true,
      status: 'error',
      test: { ok: false, error: 'MCP error -32000: Connection closed' },
      guidance: ['The server exited during MCP startup. Check its arguments, required environment variables, and working directory.'],
    })
    render(<McpServerPanel />)

    await user.click(await screen.findByText('Diagnose connection'))

    expect(mockApi.diagnoseMcpServer).toHaveBeenCalledWith('srv-2')
    expect(await screen.findByText('Connection diagnosis')).toBeInTheDocument()
    expect(screen.getByText(/The server exited during MCP startup/)).toBeInTheDocument()
  })
})

describe('McpServerPanel — Pre-flight test', () => {
  it('test connection reports found tools on success', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    mockApi.testMcpServer = vi
      .fn()
      .mockResolvedValue({ ok: true, tools: [{ name: 'a' }, { name: 'b' }] })
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Custom server')).toBeInTheDocument())
    await user.click(screen.getByText('Custom server'))
    await user.type(screen.getByPlaceholderText('npx'), 'node')
    await user.click(screen.getByText('Test connection'))

    await waitFor(() =>
      expect(mockApi.testMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'node' })
      )
    )
    expect(await screen.findByText(/found 2 tools/)).toBeInTheDocument()
  })

  it('test connection surfaces the error on failure', async () => {
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    mockApi.testMcpServer = vi.fn().mockResolvedValue({ ok: false, error: 'spawn ENOENT' })
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Custom server')).toBeInTheDocument())
    await user.click(screen.getByText('Custom server'))
    await user.type(screen.getByPlaceholderText('npx'), 'nope')
    await user.click(screen.getByText('Test connection'))

    expect(await screen.findByText('spawn ENOENT')).toBeInTheDocument()
  })
})

describe('McpServerPanel — Error Handling', () => {
  it('shows toast on save failure', async () => {
    mockApi.addMcpServer = vi.fn().mockRejectedValue(new Error('fail'))
    mockApi.listMcpServers = vi.fn().mockResolvedValue([])
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Custom server')).toBeInTheDocument())
    await user.click(screen.getByText('Custom server'))

    await user.type(screen.getByPlaceholderText('My MCP Server'), 'Test')
    await user.type(screen.getByPlaceholderText('npx'), 'node')
    await user.click(screen.getByText('Add Server'))

    expect(mockStore.addToast).toHaveBeenCalledWith('Failed to add server', 'error')
  })

  it('shows toast on delete failure', async () => {
    mockApi.removeMcpServer = vi.fn().mockRejectedValue(new Error('fail'))
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())
    await user.click(screen.getAllByTitle('Remove')[0])

    expect(mockStore.addToast).toHaveBeenCalledWith('Failed to remove server', 'error')
  })

  it('shows toast on restart failure', async () => {
    mockApi.restartMcpServer = vi.fn().mockRejectedValue(new Error('fail'))
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())
    await user.click(screen.getAllByTitle('Retry connection')[0])

    expect(mockStore.addToast).toHaveBeenCalledWith('Failed to restart server', 'error')
  })

  it('shows toast on toggle failure', async () => {
    mockApi.updateMcpServer = vi.fn().mockRejectedValue(new Error('fail'))
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('GitHub MCP')).toBeInTheDocument())
    await user.click(screen.getByText('ON'))

    expect(mockStore.addToast).toHaveBeenCalledWith('Failed to toggle server', 'error')
  })
})

describe('McpServerPanel — JSON Import', () => {
  it('switches to JSON import mode', async () => {
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Paste JSON')).toBeInTheDocument())
    await user.click(screen.getByText('Paste JSON'))
    expect(screen.getByText(/Paste a Claude Desktop/)).toBeInTheDocument()
  })

  it('shows error for invalid JSON', async () => {
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Paste JSON')).toBeInTheDocument())
    await user.click(screen.getByText('Paste JSON'))
    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'not json')
    await user.click(screen.getByText('Import Servers'))

    expect(screen.getByText('Invalid JSON')).toBeInTheDocument()
  })

  it('shows error for missing mcpServers key', async () => {
    render(<McpServerPanel />)

    await waitFor(() => expect(screen.getByText('Paste JSON')).toBeInTheDocument())
    await user.click(screen.getByText('Paste JSON'))
    const textarea = screen.getByRole('textbox')
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(textarea, { target: { value: '{"other": {}}' } })
    await user.click(screen.getByText('Import Servers'))

    expect(screen.getByText(/Expected.*mcpServers/)).toBeInTheDocument()
  })

  it('close button calls setShowMcpPanel(false)', async () => {
    render(<McpServerPanel />)

    await user.click(screen.getByLabelText('Close MCP panel'))
    expect(mockStore.setShowMcpPanel).toHaveBeenCalledWith(false)
  })
})

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plug, X, RefreshCw, Settings, Trash2, Plus, ChevronLeft, ChevronDown, ChevronRight, Search, Wrench, ClipboardPaste, ExternalLink, CheckCircle2, AlertCircle, Loader2, Globe2, ShieldCheck, Users, Library, SlidersHorizontal, Database, FileText, TerminalSquare, Eye, LockKeyhole } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { Button, ModalShell } from './ui/primitives'
import { isApiError, type AgentConfig, type McpRegistrySearchResult, type McpRegistryServer, type McpSandboxProfile, type McpSandboxRuntimeStatus, type McpTool } from '@shared/types'
import { DEFAULT_MCP_SANDBOX_PROFILE, normalizeMcpSandboxProfile } from '@shared/mcp-sandbox'
import {
  MCP_CATALOG,
  MCP_CATEGORY_LABELS,
  MCP_CATEGORY_ORDER,
  catalogEntryToConfig,
  searchCatalog,
  type McpCatalogCategory,
  type McpCatalogRequiredEnv,
} from '@shared/mcp-catalog'

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; toolCount: number }
  | { status: 'error'; message: string }

interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  imageResponses?: 'allow' | 'omit'
  sandboxProfile?: McpSandboxProfile
  enabled: boolean
}

interface McpServerStatus extends McpServerConfig {
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  toolCount: number
  managed?: boolean
  sandbox?: McpSandboxRuntimeStatus
}

type PanelView = 'gallery' | 'tools' | 'access' | 'form' | 'json' | 'registry' | 'assign'

type AssignmentTrust = 'auto' | 'always-ask' | 'block'

interface AssignmentState {
  serverId: string
  serverName: string
  toolCount: number
  agents: AgentConfig[]
  selectedAgentId: string
  trust: AssignmentTrust
}

const STATUS_COLORS: Record<string, string> = {
  connected: 'text-green-500',
  connecting: 'text-yellow-500',
  error: 'text-red-500',
  disconnected: 'text-gray-400'
}

const STATUS_ICONS: Record<string, string> = {
  connected: '●',
  connecting: '◐',
  error: '●',
  disconnected: '○'
}

type ToolCategory = 'all' | 'files' | 'browser' | 'git' | 'web' | 'data' | 'system'
type ToolRisk = 'low' | 'review' | 'high'

const TOOL_CATEGORY_LABELS: Record<ToolCategory, string> = {
  all: 'All tools',
  files: 'Files',
  browser: 'Browser',
  git: 'Git',
  web: 'Web',
  data: 'Data',
  system: 'System',
}

const TOOL_CATEGORY_ICONS: Record<ToolCategory, typeof FileText> = {
  all: Library,
  files: FileText,
  browser: Eye,
  git: SlidersHorizontal,
  web: Globe2,
  data: Database,
  system: TerminalSquare,
}

function friendlyToolName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isSensitiveEnvKey(key: string): boolean {
  return /(?:PASSWORD|PASSWD|TOKEN|API[_-]?KEY|SECRET|PRIVATE[_-]?KEY|CREDENTIAL)/i.test(key)
}

function sandboxProfileFor(server: McpServerConfig): McpSandboxProfile {
  return normalizeMcpSandboxProfile(server.sandboxProfile ?? DEFAULT_MCP_SANDBOX_PROFILE)
}

function getToolPresentation(tool: McpTool): {
  category: Exclude<ToolCategory, 'all'>
  categoryLabel: string
  risk: ToolRisk
  riskLabel: string
  access: string
  description: string
} {
  const text = `${tool.name} ${tool.description ?? ''}`.toLowerCase()
  const category: Exclude<ToolCategory, 'all'> =
    /git|commit|branch|diff|repo/.test(text) ? 'git' :
      /browser|playwright|screenshot|page|navigate|click|form/.test(text) ? 'browser' :
        /file|folder|directory|path|read|write|edit|delete/.test(text) ? 'files' :
          /database|sql|query|record|table|airtable|notion/.test(text) ? 'data' :
            /shell|terminal|command|execute|process|system|desktop/.test(text) ? 'system' :
              /fetch|http|url|search|web|crawl|request/.test(text) ? 'web' : 'web'
  const risk: ToolRisk = /delete|remove|write|edit|execute|run|shell|command|send|publish|commit/.test(text)
    ? 'high'
    : /browser|navigate|click|create|update|move|upload/.test(text)
      ? 'review'
      : 'low'
  const access = category === 'files' ? 'Local files and folders'
    : category === 'browser' ? 'Browser session and pages'
      : category === 'git' ? 'Repositories and version history'
        : category === 'data' ? 'Records and structured data'
          : category === 'system' ? 'Local system actions'
            : 'External web content'
  return {
    category,
    categoryLabel: TOOL_CATEGORY_LABELS[category],
    risk,
    riskLabel: risk === 'high' ? 'High impact' : risk === 'review' ? 'Review first' : 'Read-only likely',
    access,
    description: tool.description?.trim() || 'No description provided by this server.',
  }
}

function EnvEditor({
  env,
  onChange
}: {
  env: Record<string, string>
  onChange: (env: Record<string, string>) => void
}) {
  const entries = Object.entries(env)

  const addEntry = () => {
    onChange({ ...env, '': '' })
  }

  const removeEntry = (key: string) => {
    const next = { ...env }
    delete next[key]
    onChange(next)
  }

  const updateEntry = (oldKey: string, newKey: string, value: string) => {
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(env)) {
      if (k === oldKey) {
        next[newKey] = value
      } else {
        next[k] = v
      }
    }
    onChange(next)
  }

  return (
    <div className="space-y-1">
      {entries.map(([key, value], i) => (
        <div key={i} className="flex gap-1">
          <input
            value={key}
            onChange={(e) => updateEntry(key, e.target.value, value)}
            placeholder="KEY"
            className="flex-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
          <input
            value={value}
            type={isSensitiveEnvKey(key) ? 'password' : 'text'}
            onChange={(e) => updateEntry(key, key, e.target.value)}
            placeholder="value"
            autoComplete="off"
            className="flex-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
          <button
            onClick={() => removeEntry(key)}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Remove variable"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <button
        onClick={addEntry}
        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        <Plus className="w-3 h-3" />
        Add variable
      </button>
    </div>
  )
}

export function McpServerPanel() {
  const visible = useAppStore((s) => s.showMcpPanel)
  const setShowMcpPanel = useAppStore((s) => s.setShowMcpPanel)
  const addToast = useAppStore((s) => s.addToast)
  const loadAgents = useAppStore((s) => s.loadAgents)
  const onClose = () => setShowMcpPanel(false)

  const [servers, setServers] = useState<McpServerStatus[]>([])
  const [view, setView] = useState<PanelView>('gallery')
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [guidedEnv, setGuidedEnv] = useState<McpCatalogRequiredEnv[]>([])
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [search, setSearch] = useState('')
  const [catalogCategory, setCatalogCategory] = useState<McpCatalogCategory | 'all'>('all')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [registryQuery, setRegistryQuery] = useState('')
  const [registry, setRegistry] = useState<McpRegistrySearchResult | null>(null)
  const [registryLoading, setRegistryLoading] = useState(false)
  const [registryError, setRegistryError] = useState<string | null>(null)
  const [assignment, setAssignment] = useState<AssignmentState | null>(null)
  const [assignmentLoading, setAssignmentLoading] = useState(false)
  const [tools, setTools] = useState<McpTool[]>([])
  const [toolSearch, setToolSearch] = useState('')
  const [toolCategory, setToolCategory] = useState<ToolCategory>('all')
  const [expandedToolServers, setExpandedToolServers] = useState<Set<string>>(new Set())
  const [expandedServerDetails, setExpandedServerDetails] = useState<Set<string>>(new Set())
  const [accessAgents, setAccessAgents] = useState<AgentConfig[]>([])
  const [accessAgentId, setAccessAgentId] = useState('')
  const [accessTrust, setAccessTrust] = useState<Record<string, AssignmentTrust>>({})
  const [accessLoading, setAccessLoading] = useState(false)
  const [accessError, setAccessError] = useState<string | null>(null)

  const loadServers = useCallback(async () => {
    try {
      const result = await window.api.listMcpServers()
      setServers(result)
      return result
    } catch {
      addToast('Failed to load MCP servers', 'error')
      return [] as McpServerStatus[]
    }
  }, [addToast])

  const loadTools = useCallback(async () => {
    try {
      const result = await window.api.listMcpTools()
      setTools(result)
      setExpandedToolServers((previous) => {
        if (previous.size > 0) return previous
        return new Set(result.map((tool) => tool.serverId))
      })
    } catch {
      addToast('Failed to load MCP tools', 'error')
    }
  }, [addToast])

  const loadAccessAgents = useCallback(async () => {
    setAccessLoading(true)
    setAccessError(null)
    try {
      const result = await window.api.listAgents()
      if (isApiError(result)) throw new Error(result.error)
      setAccessAgents(result)
      setAccessAgentId((previous) => previous || result[0]?.id || '')
    } catch {
      setAccessError('Could not load agents. Try again or manage access from the agent editor.')
    } finally {
      setAccessLoading(false)
    }
  }, [])

  const loadAccessTrust = useCallback(async (agentId: string) => {
    if (!agentId) return
    try {
      const rows = await window.api.getMcpServerTrust(agentId)
      const next: Record<string, AssignmentTrust> = {}
      for (const row of rows) {
        if (row.trust === 'auto' || row.trust === 'always-ask' || row.trust === 'block') {
          next[row.server_id] = row.trust
        }
      }
      setAccessTrust(next)
    } catch {
      setAccessTrust({})
    }
  }, [])

  useEffect(() => {
    if (visible) {
      loadServers()
      void loadTools()
      void loadAccessAgents()
      // Reset to the gallery landing each time the panel opens.
      setView('gallery')
      setEditingServer(null)
      setSearch('')
      setCatalogCategory('all')
      setJsonError(null)
      setAssignment(null)
      setToolSearch('')
      setToolCategory('all')
      setAccessError(null)
      setAccessAgentId('')
      setAccessTrust({})
    }
  }, [visible, loadServers, loadTools, loadAccessAgents])

  useEffect(() => {
    if (visible && view === 'access' && accessAgentId) void loadAccessTrust(accessAgentId)
  }, [visible, view, accessAgentId, loadAccessTrust])

  useEffect(() => {
    if (!visible) return
    return window.api.onMcpServerStatusChanged((server) => {
      setServers((prev) => {
        const idx = prev.findIndex((s) => s.id === server.id)
        if (idx === -1) return prev
        const next = [...prev]
        next[idx] = server
        return next
      })
      if (view === 'tools') void loadTools()
    })
  }, [visible, view, loadTools])

  const openCustomForm = () => {
    setEditingServer({
      id: '',
      name: '',
      command: '',
      args: [],
      env: {},
      cwd: '',
      enabled: true
    })
    setIsNew(true)
    setGuidedEnv([])
    setTest({ status: 'idle' })
    setAdvancedOpen(true) // custom entry needs command/args visible
    setView('form')
  }

  const openCatalogForm = (catalogId: string) => {
    const entry = MCP_CATALOG.find((e) => e.id === catalogId)
    if (!entry) return
    setEditingServer({ id: '', ...catalogEntryToConfig(entry) })
    setIsNew(true)
    setGuidedEnv(entry.requiredEnv ?? [])
    setTest({ status: 'idle' })
    setAdvancedOpen(false) // command pre-filled — keep it tucked away
    setView('form')
  }

  const openRegistryForm = (entry: McpRegistryServer) => {
    if (!entry.install) return
    setEditingServer({
      id: '',
      name: entry.title || entry.name,
      command: entry.install.command,
      args: [...entry.install.args],
      env: Object.fromEntries(entry.install.requiredEnv.map((req) => [req.key, ''])),
      enabled: true,
    })
    setIsNew(true)
    setGuidedEnv(entry.install.requiredEnv.map((req) => ({ ...req })))
    setTest({ status: 'idle' })
    setAdvancedOpen(false)
    setView('form')
  }

  const searchRegistry = async () => {
    setRegistryLoading(true)
    setRegistryError(null)
    try {
      const result = await window.api.searchMcpRegistry(registryQuery)
      if (isApiError(result)) throw new Error(result.error)
      setRegistry(result)
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : 'Could not reach the MCP Registry')
    } finally {
      setRegistryLoading(false)
    }
  }

  const handleEdit = (server: McpServerStatus) => {
    setEditingServer({ ...server })
    setIsNew(false)
    setGuidedEnv([])
    setTest({ status: 'idle' })
    setAdvancedOpen(true)
    setView('form')
  }

  const backToGallery = () => {
    setEditingServer(null)
    setGuidedEnv([])
    setTest({ status: 'idle' })
    setJsonError(null)
    setAssignment(null)
    setView('gallery')
  }

  const handleTestConnection = async () => {
    if (!editingServer || !editingServer.command) return
    setTest({ status: 'testing' })
    try {
      const result = await window.api.testMcpServer({
        command: editingServer.command,
        args: editingServer.args,
        env: editingServer.env,
        cwd: editingServer.cwd,
        imageResponses: editingServer.imageResponses,
        sandboxProfile: sandboxProfileFor(editingServer),
      })
      if (result.ok) {
        setTest({ status: 'ok', toolCount: result.tools?.length ?? 0 })
      } else {
        setTest({ status: 'error', message: result.error || 'Connection failed' })
      }
    } catch {
      setTest({ status: 'error', message: 'Could not run the test' })
    }
  }

  const handleSave = async () => {
    if (!editingServer || !editingServer.name || !editingServer.command) return

    try {
      if (isNew) {
        const added = await window.api.addMcpServer({ ...editingServer })
        addToast(`Server "${editingServer.name}" added`, 'success')
        const freshServers = await loadServers()
        let agents: AgentConfig[] = []
        try {
          const listedAgents = await window.api.listAgents()
          if (!isApiError(listedAgents)) agents = listedAgents
        } catch {
          // Assignment is an optional post-install step; the server is already saved.
        }
        if (agents.length > 0) {
          const live = freshServers.find((server) => server.id === added.id)
          setAssignment({
            serverId: added.id,
            serverName: added.name,
            toolCount: live?.toolCount ?? 0,
            agents,
            selectedAgentId: agents[0].id,
            trust: 'always-ask',
          })
          setEditingServer(null)
          setView('assign')
          return
        }
      } else {
        await window.api.updateMcpServer(editingServer.id, { ...editingServer })
        addToast(`Server "${editingServer.name}" updated`, 'success')
      }
      backToGallery()
      loadServers()
    } catch {
      addToast(`Failed to ${isNew ? 'add' : 'update'} server`, 'error')
    }
  }

  const handleAssign = async () => {
    if (!assignment || !assignment.selectedAgentId) return
    setAssignmentLoading(true)
    try {
      const result = await window.api.assignMcpServerToAgent(
        assignment.selectedAgentId,
        assignment.serverId,
        assignment.trust,
      )
      if (isApiError(result)) throw new Error(result.error)
      const agent = assignment.agents.find((candidate) => candidate.id === assignment.selectedAgentId)
      addToast(`${assignment.serverName} added to ${agent?.name || 'agent'}`, 'success')
      await loadAgents()
      backToGallery()
      await loadServers()
    } catch {
      addToast('Could not assign MCP server to the agent', 'error')
    } finally {
      setAssignmentLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await window.api.removeMcpServer(id)
      if (editingServer?.id === id) backToGallery()
      loadServers()
      addToast('Server removed', 'success')
    } catch {
      addToast('Failed to remove server', 'error')
    }
  }

  const handleRestart = async (id: string) => {
    try {
      await window.api.restartMcpServer(id)
      // Status updates arrive via the mcp:server-status-changed push event.
    } catch {
      addToast('Failed to restart server', 'error')
    }
  }

  const handleToggle = async (server: McpServerStatus) => {
    try {
      await window.api.updateMcpServer(server.id, { enabled: !server.enabled })
      loadServers()
    } catch {
      addToast('Failed to toggle server', 'error')
    }
  }

  const selectedAccessAgent = useMemo(
    () => accessAgents.find((agent) => agent.id === accessAgentId) ?? null,
    [accessAgents, accessAgentId],
  )

  const handleAccessToggle = async (server: McpServerStatus) => {
    if (!selectedAccessAgent) return
    setAccessLoading(true)
    setAccessError(null)
    const isAssigned = selectedAccessAgent.mcpServers.includes(server.id)
    try {
      if (isAssigned) {
        const nextServers = selectedAccessAgent.mcpServers.filter((id) => id !== server.id)
        const result = await window.api.updateAgent(selectedAccessAgent.id, {
          ...selectedAccessAgent,
          mcpServers: nextServers,
        })
        if (isApiError(result)) throw new Error(result.error)
        setAccessAgents((previous) => previous.map((agent) =>
          agent.id === selectedAccessAgent.id ? { ...agent, mcpServers: nextServers } : agent,
        ))
        addToast(`${server.name} removed from ${selectedAccessAgent.name}`, 'success')
      } else {
        const trust = accessTrust[server.id] ?? 'always-ask'
        const result = await window.api.assignMcpServerToAgent(selectedAccessAgent.id, server.id, trust)
        if (isApiError(result)) throw new Error(result.error)
        setAccessAgents((previous) => previous.map((agent) =>
          agent.id === selectedAccessAgent.id
            ? { ...agent, mcpServers: [...agent.mcpServers, server.id] }
            : agent,
        ))
        setAccessTrust((previous) => ({ ...previous, [server.id]: trust }))
        addToast(`${server.name} added to ${selectedAccessAgent.name}`, 'success')
      }
      await loadAgents()
    } catch {
      setAccessError(`Could not update ${server.name} for ${selectedAccessAgent.name}.`)
    } finally {
      setAccessLoading(false)
    }
  }

  const handleAccessTrustChange = async (server: McpServerStatus, trust: AssignmentTrust) => {
    if (!selectedAccessAgent) return
    setAccessTrust((previous) => ({ ...previous, [server.id]: trust }))
    if (!selectedAccessAgent.mcpServers.includes(server.id)) return
    try {
      await window.api.setMcpServerTrust(selectedAccessAgent.id, server.id, trust)
    } catch {
      setAccessError(`Could not update approval for ${server.name}.`)
    }
  }

  const handleJsonImport = () => {
    if (!jsonText.trim()) return
    try {
      const parsed = JSON.parse(jsonText)
      if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
        setJsonError('Expected { "mcpServers": { ... } } format')
        return
      }
      setJsonError(null)

      const promises = Object.entries(parsed.mcpServers).map(
        async ([name, config]: [string, unknown]) => {
          const c = config as { command?: string; args?: string[]; env?: Record<string, string> }
          await window.api.addMcpServer({
            name,
            command: c.command || '',
            args: c.args || [],
            env: c.env || {},
            enabled: true
          })
        }
      )
      Promise.all(promises).then(() => {
        setJsonText('')
        backToGallery()
        loadServers()
        addToast('Servers imported successfully', 'success')
      }).catch(() => {
        addToast('Failed to import some servers', 'error')
      })
    } catch {
      setJsonError('Invalid JSON')
    }
  }

  const filteredCatalog = useMemo(() => {
    const matches = searchCatalog(search)
    return catalogCategory === 'all' ? matches : matches.filter((entry) => entry.category === catalogCategory)
  }, [catalogCategory, search])

  // Group filtered entries by category, preserving MCP_CATEGORY_ORDER.
  const groupedCatalog = useMemo(() => {
    const groups: { category: McpCatalogCategory; entries: typeof MCP_CATALOG }[] = []
    for (const category of MCP_CATEGORY_ORDER) {
      const entries = filteredCatalog.filter((e) => e.category === category)
      if (entries.length > 0) groups.push({ category, entries })
    }
    return groups
  }, [filteredCatalog])

  // Catalog ids already configured (by name match) so we can mark them as added.
  const configuredNames = useMemo(
    () => new Set(servers.map((s) => s.name.toLowerCase())),
    [servers]
  )

  const agentCountByServer = useMemo(() => {
    const counts = new Map<string, number>()
    for (const agent of accessAgents) {
      for (const serverId of agent.mcpServers ?? []) counts.set(serverId, (counts.get(serverId) ?? 0) + 1)
    }
    return counts
  }, [accessAgents])

  const filteredTools = useMemo(() => {
    const query = toolSearch.trim().toLowerCase()
    return tools.filter((tool) => {
      const presentation = getToolPresentation(tool)
      const matchesCategory = toolCategory === 'all' || presentation.category === toolCategory
      const haystack = `${tool.name} ${tool.serverName} ${tool.description ?? ''} ${presentation.access}`.toLowerCase()
      return matchesCategory && (!query || haystack.includes(query))
    })
  }, [tools, toolSearch, toolCategory])

  const groupedTools = useMemo(() => {
    const groups = new Map<string, { serverName: string; tools: McpTool[] }>()
    for (const tool of filteredTools) {
      const group = groups.get(tool.serverId)
      if (group) group.tools.push(tool)
      else groups.set(tool.serverId, { serverName: tool.serverName, tools: [tool] })
    }
    return Array.from(groups.entries())
  }, [filteredTools])

  if (!visible) return null

  const workspaceView = view === 'gallery' || view === 'tools' || view === 'access'
  const panelTitle = view === 'tools' ? 'MCP Tool library' : view === 'access' ? 'MCP Agent access' : 'MCP Servers'
  const panelIcon = view === 'tools' ? <Library className="w-4 h-4" /> : view === 'access' ? <Users className="w-4 h-4" /> : <Plug className="w-4 h-4" />

  const headerActions =
    workspaceView ? undefined : (
      <Button onClick={backToGallery} className="px-2 py-1">
        <ChevronLeft className="w-3.5 h-3.5" />
        Back
      </Button>
    )

  return (
    <ModalShell
      title={panelTitle}
      icon={panelIcon}
      ariaLabel="MCP panel"
      maxWidth="max-w-3xl"
      height="h-[82vh]"
      bodyClassName="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6"
      onClose={onClose}
      headerActions={headerActions}
    >
      {workspaceView && (
        <div className="mb-4 grid grid-cols-3 gap-1 rounded-nexy-md border-2 border-nexy-border bg-nexy-recessed p-1">
          {([
            { id: 'gallery' as const, label: 'Servers', detail: `${servers.length}`, icon: Plug },
            { id: 'tools' as const, label: 'Tool library', detail: `${tools.length}`, icon: Library },
            { id: 'access' as const, label: 'Agent access', detail: `${accessAgents.length}`, icon: Users },
          ]).map((tab) => {
            const Icon = tab.icon
            const active = view === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={`flex min-w-0 items-center justify-center gap-1.5 rounded-nexy-sm px-2 py-2 text-[11px] font-bold transition-colors ${
                  active
                    ? 'border-2 border-nexy-border bg-nexy-raised text-nexy-text shadow-[1px_1px_0_rgb(var(--nexy-shadow))]'
                    : 'border-2 border-transparent text-nexy-muted hover:bg-nexy-raised hover:text-nexy-text'
                }`}
                aria-pressed={active}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{tab.label}</span>
                <span className="hidden rounded-full bg-nexy-recessed px-1.5 py-0.5 text-[10px] font-medium text-nexy-muted sm:inline">
                  {tab.detail}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {view === 'tools' ? (
        <div className="space-y-4">
          <div className="rounded-nexy-md border-2 border-nexy-border bg-nexy-recessed p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised p-2 text-nexy-accent shadow-[1px_1px_0_rgb(var(--nexy-shadow))]">
                <Library className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-nexy-text">Tool library</h3>
                <p className="mt-1 text-xs leading-relaxed text-nexy-muted">
                  Browse what your connected servers expose. Tools are grouped by server so ownership and access stay visible.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadTools()}
                className="ml-auto rounded-nexy-sm border-2 border-transparent p-1.5 text-nexy-muted hover:border-nexy-border hover:bg-nexy-raised hover:text-nexy-text"
                title="Refresh tools"
                aria-label="Refresh tools"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-2 py-2">
                <p className="text-base font-bold tabular-nums text-nexy-text">{tools.length}</p>
                <p className="text-[10px] uppercase tracking-wide text-nexy-muted">Total tools</p>
              </div>
              <div className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-2 py-2">
                <p className="text-base font-bold tabular-nums text-nexy-text">{new Set(tools.map((tool) => tool.serverId)).size}</p>
                <p className="text-[10px] uppercase tracking-wide text-nexy-muted">Servers</p>
              </div>
              <div className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-2 py-2">
                <p className="text-base font-bold tabular-nums text-nexy-text">{tools.filter((tool) => getToolPresentation(tool).risk === 'high').length}</p>
                <p className="text-[10px] uppercase tracking-wide text-nexy-muted">High impact</p>
              </div>
            </div>
            <p className="mt-3 inline-flex items-start gap-1.5 text-[10px] leading-relaxed text-nexy-muted">
              <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
              Impact labels are guidance based on tool names and descriptions. Review the server source before enabling sensitive actions.
            </p>
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-nexy-muted" />
              <input
                value={toolSearch}
                onChange={(event) => setToolSearch(event.target.value)}
                placeholder="Search tools, servers, or capabilities…"
                aria-label="Search tool library"
                className="w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed py-2 pl-9 pr-3 text-sm text-nexy-text placeholder:text-nexy-muted focus:bg-nexy-raised focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-nexy-accent"
              />
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Tool categories">
              {(Object.keys(TOOL_CATEGORY_LABELS) as ToolCategory[]).map((category) => {
                const Icon = TOOL_CATEGORY_ICONS[category]
                const active = toolCategory === category
                return (
                  <button
                    key={category}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setToolCategory(category)}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full border-2 px-2.5 py-1 text-[11px] font-bold transition-colors ${
                      active
                        ? 'border-nexy-border bg-nexy-text text-nexy-raised'
                        : 'border-nexy-border bg-nexy-raised text-nexy-muted hover:bg-nexy-recessed hover:text-nexy-text'
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {TOOL_CATEGORY_LABELS[category]}
                  </button>
                )
              })}
            </div>
          </div>

          {groupedTools.length === 0 ? (
            <div className="rounded-nexy-md border-2 border-dashed border-nexy-border px-4 py-8 text-center">
              <Wrench className="mx-auto h-6 w-6 text-nexy-muted" />
              <p className="mt-2 text-sm font-bold text-nexy-text">No tools to show</p>
              <p className="mt-1 text-xs text-nexy-muted">
                {tools.length === 0 ? 'Connect a server to discover its tools.' : 'Try a different search or category.'}
              </p>
              {tools.length === 0 && <Button onClick={() => setView('gallery')} className="mt-3">Manage servers</Button>}
            </div>
          ) : (
            <div className="space-y-2">
              {groupedTools.map(([serverId, group]) => {
                const open = expandedToolServers.has(serverId)
                return (
                  <section key={serverId} className="overflow-hidden rounded-nexy-md border-2 border-nexy-border bg-nexy-raised">
                    <button
                      type="button"
                      onClick={() => setExpandedToolServers((previous) => {
                        const next = new Set(previous)
                        if (next.has(serverId)) next.delete(serverId)
                        else next.add(serverId)
                        return next
                      })}
                      className="flex w-full items-center gap-2 bg-nexy-surface px-3 py-3 text-left hover:bg-nexy-recessed"
                      aria-expanded={open}
                    >
                      {open ? <ChevronDown className="h-3.5 w-3.5 text-nexy-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-nexy-muted" />}
                      <Plug className="h-3.5 w-3.5 text-nexy-accent" />
                      <span className="min-w-0 flex-1 truncate text-xs font-bold text-nexy-text">{group.serverName}</span>
                      <span className="rounded-full bg-nexy-recessed px-2 py-0.5 text-[10px] font-bold text-nexy-muted">{group.tools.length}</span>
                    </button>
                    {open && (
                      <div className="divide-y-2 divide-nexy-border">
                        {group.tools.map((tool) => {
                          const presentation = getToolPresentation(tool)
                          const riskClass = presentation.risk === 'high'
                            ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300'
                            : presentation.risk === 'review'
                              ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                              : 'border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300'
                          return (
                            <div key={`${tool.serverId}:${tool.name}`} className="px-3 py-3">
                              <div className="flex items-start gap-2">
                                <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-nexy-muted" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-xs font-bold text-nexy-text">{friendlyToolName(tool.name)}</span>
                                    <span className="rounded-full border border-nexy-border bg-nexy-recessed px-1.5 py-0.5 text-[10px] font-medium text-nexy-muted">{presentation.categoryLabel}</span>
                                    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${riskClass}`}>{presentation.riskLabel}</span>
                                  </div>
                                  <p className="mt-1 text-[11px] leading-relaxed text-nexy-muted">{presentation.description}</p>
                                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-nexy-muted">
                                    <span className="inline-flex items-center gap-1"><LockKeyhole className="h-3 w-3" /> Access: {presentation.access}</span>
                                    {tool.inputSchema && typeof tool.inputSchema.properties === 'object' && (
                                      <span>{Object.keys(tool.inputSchema.properties as Record<string, unknown>).length} input fields</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </div>
      ) : view === 'access' ? (
        <div className="space-y-4">
          <div className="rounded-nexy-md border-2 border-nexy-border bg-nexy-recessed p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised p-2 text-nexy-accent shadow-[1px_1px_0_rgb(var(--nexy-shadow))]">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-nexy-text">Agent access</h3>
                <p className="mt-1 text-xs leading-relaxed text-nexy-muted">Choose which agents can use each server. Approval is set per server and starts safely at “Ask before running”.</p>
              </div>
            </div>
            <label className="mt-4 block text-xs font-bold text-nexy-text">
              Editing access for
              <select
                value={accessAgentId}
                onChange={(event) => setAccessAgentId(event.target.value)}
                aria-label="Agent to configure"
                className="mt-1 w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-3 py-2 text-sm text-nexy-text focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-nexy-accent"
                disabled={accessLoading && accessAgents.length === 0}
              >
                {accessAgents.length === 0 && <option value="">No agents found</option>}
                {accessAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.icon} {agent.name}</option>)}
              </select>
            </label>
          </div>

          {accessError && <div className="rounded-nexy-sm border-2 border-nexy-error bg-red-50 px-3 py-2 text-xs text-nexy-error dark:bg-red-950/30">{accessError}</div>}
          {accessLoading && accessAgents.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-nexy-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading agents…</div>
          ) : selectedAccessAgent ? (
            <div className="space-y-2">
              {servers.length === 0 ? (
                <div className="rounded-nexy-md border-2 border-dashed border-nexy-border px-4 py-8 text-center">
                  <Plug className="mx-auto h-6 w-6 text-nexy-muted" />
                  <p className="mt-2 text-sm font-bold text-nexy-text">No servers configured</p>
                  <Button onClick={() => setView('gallery')} className="mt-3">Add a server</Button>
                </div>
              ) : servers.map((server) => {
                const assigned = selectedAccessAgent.mcpServers.includes(server.id)
                const trust = accessTrust[server.id] ?? 'always-ask'
                return (
                  <div key={server.id} className="rounded-nexy-md border-2 border-nexy-border bg-nexy-raised p-3">
                    <div className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${server.status === 'connected' ? 'bg-nexy-success' : server.status === 'error' ? 'bg-nexy-error' : 'bg-nexy-muted'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-nexy-text">{server.name}</p>
                        <p className="mt-0.5 text-[11px] text-nexy-muted">{server.toolCount} tool{server.toolCount === 1 ? '' : 's'} · {server.status}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleAccessToggle(server)}
                        disabled={accessLoading}
                        className={`rounded-full border-2 px-2.5 py-1 text-[11px] font-bold ${assigned ? 'border-nexy-success bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300' : 'border-nexy-border bg-nexy-recessed text-nexy-muted'}`}
                        aria-label={`${assigned ? 'Remove' : 'Add'} ${server.name} ${assigned ? 'from' : 'to'} ${selectedAccessAgent.name}`}
                      >
                        {assigned ? 'Enabled' : 'Not enabled'}
                      </button>
                    </div>
                    {assigned && (
                      <div className="mt-3 flex items-center gap-2 border-t-2 border-nexy-border pt-3">
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-nexy-muted" />
                        <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-nexy-muted">
                          Approval
                          <select
                            value={trust}
                            onChange={(event) => void handleAccessTrustChange(server, event.target.value as AssignmentTrust)}
                            aria-label={`Approval for ${server.name}`}
                            className="min-w-0 flex-1 rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed px-2 py-1 text-[11px] font-bold text-nexy-text focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-nexy-accent"
                          >
                            <option value="always-ask">Ask before running</option>
                            <option value="auto">Run automatically</option>
                            <option value="block">Block all tools</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-nexy-md border-2 border-dashed border-nexy-border px-4 py-8 text-center text-xs text-nexy-muted">Create an agent before assigning MCP access.</div>
          )}
        </div>
      ) : view === 'registry' ? (
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <Globe2 className="w-4 h-4 text-blue-500" />
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Official MCP Registry</p>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Search community-published servers by name. Review the source and required credentials before installing.
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void searchRegistry()
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={registryQuery}
                onChange={(event) => setRegistryQuery(event.target.value)}
                placeholder="Search server names — github, filesystem, calendar…"
                aria-label="Search MCP Registry"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
              />
            </div>
            <Button type="submit" disabled={registryLoading} className="px-3">
              {registryLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
            </Button>
          </form>

          {registryError && (
            <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span className="min-w-0 break-words">{registryError}</span>
            </div>
          )}
          {registry?.stale && (
            <p className="text-[11px] text-amber-600 dark:text-amber-500">
              Showing the last cached result because the registry is temporarily unavailable.
            </p>
          )}
          {registry && registry.servers.length === 0 && !registryLoading && (
            <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-4">
              No servers matched that name.
            </p>
          )}
          <div className="space-y-2">
            {registry?.servers.map((entry) => (
              <div
                key={`${entry.name}@${entry.version}`}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-gray-800 dark:text-gray-100 break-all">
                        {entry.title || entry.name}
                      </span>
                      <span className="text-[10px] text-gray-400">v{entry.version}</span>
                      {entry.status !== 'active' && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-500 font-medium">
                          {entry.status}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{entry.description}</p>
                    {entry.statusMessage && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1">{entry.statusMessage}</p>
                    )}
                  </div>
                  {entry.install ? (
                    <Button
                      onClick={() => openRegistryForm(entry)}
                      variant="primary"
                      className="shrink-0 px-2 py-1 text-xs"
                      disabled={entry.status === 'deleted'}
                    >
                      Use this server
                    </Button>
                  ) : entry.docsUrl ? (
                    <a
                      href={entry.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600"
                    >
                      Details <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-400 dark:text-gray-500">
                  <span>{entry.transport === 'stdio' ? 'Local stdio' : entry.transport === 'remote' ? 'Remote server' : 'Package metadata'}</span>
                  {entry.install?.requiredEnv.length ? <span>• requires configuration</span> : null}
                  {entry.repositoryUrl && (
                    <a href={entry.repositoryUrl} target="_blank" rel="noreferrer" className="hover:text-gray-600 dark:hover:text-gray-300">
                      Source <ExternalLink className="inline w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : view === 'assign' && assignment ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{assignment.serverName} is ready</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {assignment.toolCount > 0
                  ? `${assignment.toolCount} tool${assignment.toolCount === 1 ? '' : 's'} found. `
                  : ''}
                Assign it to an agent now, or do this later from the agent&apos;s Skills tab.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-px" />
            <span>New assignments start with approval required. You can change this per agent later.</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Assign to agent</label>
            <select
              value={assignment.selectedAgentId}
              onChange={(event) => setAssignment({ ...assignment, selectedAgentId: event.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
            >
              {assignment.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tool approval</label>
            <select
              value={assignment.trust}
              onChange={(event) => setAssignment({ ...assignment, trust: event.target.value as AssignmentTrust })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
            >
              <option value="always-ask">Ask before running (recommended)</option>
              <option value="auto">Run automatically</option>
              <option value="block">Block all tools</option>
            </select>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              {assignment.trust === 'auto' && 'Tools run without an approval prompt for this agent.'}
              {assignment.trust === 'always-ask' && 'The agent must get approval before every tool call.'}
              {assignment.trust === 'block' && 'The server is assigned but none of its tools can run.'}
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={() => void handleAssign()} variant="primary" disabled={assignmentLoading} className="flex-1 justify-center py-2">
              {assignmentLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Assigning…</> : 'Add to agent'}
            </Button>
            <Button onClick={backToGallery} className="py-2">Maybe later</Button>
          </div>
        </div>
      ) : view === 'json' ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Paste a Claude Desktop / VS Code MCP config JSON:
          </p>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder={'{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "@some/mcp-server"]\n    }\n  }\n}'}
            rows={10}
            className="w-full text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {jsonError && <p className="text-xs text-red-500">{jsonError}</p>}
          <Button onClick={handleJsonImport} variant="primary" className="w-full justify-center py-2">
            Import Servers
          </Button>
        </div>
      ) : view === 'form' && editingServer ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Name
            </label>
            <input
              value={editingServer.name}
              onChange={(e) => setEditingServer({ ...editingServer, name: e.target.value })}
              placeholder="My MCP Server"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
            />
          </div>

          {(editingServer.command.toLowerCase().includes('playwright') ||
            editingServer.name.toLowerCase().includes('playwright') ||
            editingServer.args.some((a) => a.toLowerCase().includes('playwright'))) && (
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingServer.imageResponses !== 'omit'}
                  onChange={(e) =>
                    setEditingServer({
                      ...editingServer,
                      imageResponses: e.target.checked ? 'allow' : 'omit',
                    })
                  }
                  className="rounded"
                />
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  Include screenshots in tool results
                </span>
              </label>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 ml-5">
                Disable to reduce token usage on limited API plans
              </p>
            </div>
          )}

          {guidedEnv.length > 0 && (
            <div className="space-y-2">
              {guidedEnv.map((req) => (
                <div key={req.key}>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    {req.label}
                    {req.helpUrl && (
                      <a
                        href={req.helpUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-blue-500 hover:text-blue-600 font-normal"
                      >
                        <ExternalLink className="w-3 h-3" />
                        How to get one
                      </a>
                    )}
                  </label>
                  <input
                    type={req.secret ? 'password' : 'text'}
                    value={editingServer.env[req.key] ?? ''}
                    onChange={(e) =>
                      setEditingServer({
                        ...editingServer,
                        env: { ...editingServer.env, [req.key]: e.target.value },
                      })
                    }
                    placeholder={req.key}
                    autoComplete="off"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          {guidedEnv.length > 0 ? 'Other environment variables' : 'Environment Variables'}
            </label>
            <EnvEditor
              env={Object.fromEntries(
                Object.entries(editingServer.env).filter(([k]) => !guidedEnv.some((r) => r.key === k))
              )}
              onChange={(env) => {
                // Preserve guided-secret keys, which the EnvEditor doesn't show.
                const preserved: Record<string, string> = {}
                for (const r of guidedEnv) {
                  if (r.key in editingServer.env) preserved[r.key] = editingServer.env[r.key]
                }
                setEditingServer({ ...editingServer, env: { ...preserved, ...env } })
              }}
            />
          </div>

          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="text-xs font-bold text-gray-700 dark:text-gray-200">OS sandbox profile</p>
                <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">The server is always launched through Nexy’s signed helper. These permissions affect the server process, not tool approval.</p>
              </div>
            </div>
            {(() => {
              const profile = sandboxProfileFor(editingServer)
              return (
                <>
                  <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={profile.network === 'allowed'}
                      onChange={(event) => setEditingServer({ ...editingServer, sandboxProfile: { ...profile, network: event.target.checked ? 'allowed' : 'blocked' } })}
                    />
                    Allow network access
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={profile.childProcesses === 'allowed'}
                      onChange={(event) => setEditingServer({ ...editingServer, sandboxProfile: { ...profile, childProcesses: event.target.checked ? 'allowed' : 'blocked', maxProcesses: event.target.checked ? 8 : 1 } })}
                    />
                    Allow child processes
                  </label>
                  <label className="block text-xs text-gray-700 dark:text-gray-300">
                    Additional read/write folders
                    <input
                      value={profile.filesystem.filter((grant) => grant.access === 'read-write').map((grant) => grant.path).join(', ')}
                      onChange={(event) => setEditingServer({
                        ...editingServer,
                        sandboxProfile: {
                          ...profile,
                          filesystem: event.target.value.split(',').map((path) => path.trim()).filter(Boolean).map((path) => ({ path, access: 'read-write' as const })),
                        },
                      })}
                      placeholder="Optional absolute paths, comma-separated"
                      className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800"
                    />
                  </label>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">Memory is capped at 512 MiB. The working directory is writable; additional folders are opened only when listed above.</p>
                </>
              )
            })()}
          </div>

          {/* Advanced disclosure — raw launch command. Open by default for custom servers. */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
            <button
              onClick={() => setAdvancedOpen((o) => !o)}
              className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              {advancedOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              Advanced (launch command)
            </button>

            {advancedOpen && (
              <div className="space-y-3 mt-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Command
                  </label>
                  <input
                    value={editingServer.command}
                    onChange={(e) => setEditingServer({ ...editingServer, command: e.target.value })}
                    placeholder="npx"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Arguments
                  </label>
                  <input
                    value={editingServer.args.join(' ')}
                    onChange={(e) =>
                      setEditingServer({
                        ...editingServer,
                        args: e.target.value.split(' ').filter(Boolean),
                      })
                    }
                    placeholder="-y @modelcontextprotocol/server-github"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Working Directory
                  </label>
                  <input
                    value={editingServer.cwd || ''}
                    onChange={(e) => setEditingServer({ ...editingServer, cwd: e.target.value || undefined })}
                    placeholder="(optional)"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500"
                  />
                </div>
              </div>
            )}
          </div>

          {editingServer.command && (
            <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">
              Runs: {editingServer.command} {editingServer.args.join(' ')}
            </p>
          )}

          {/* Pre-flight: spawn the server, list its tools, tear it down — before saving. */}
          <div className="space-y-2">
            <Button
              onClick={handleTestConnection}
              disabled={!editingServer.command || test.status === 'testing'}
              className="w-full justify-center py-2"
            >
              {test.status === 'testing' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Testing connection…
                </>
              ) : (
                <>
                  <Plug className="w-3.5 h-3.5" />
                  Test connection
                </>
              )}
            </Button>
            {test.status === 'ok' && (
              <div className="flex items-start gap-2 text-xs text-green-600 dark:text-green-500 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
                <span>
                  Connected — found {test.toolCount} tool{test.toolCount !== 1 ? 's' : ''}.
                </span>
              </div>
            )}
            {test.status === 'error' && (
              <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                <span className="min-w-0 break-words">{test.message}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleSave}
              disabled={!editingServer.name || !editingServer.command}
              variant="primary"
              className="flex-1 justify-center py-2"
            >
              {isNew ? 'Add Server' : 'Save Changes'}
            </Button>
            <Button onClick={backToGallery} className="py-2">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        // Servers workspace: configured servers + guided capability catalog.
        <div className="space-y-5">
          <div className="rounded-nexy-md border-2 border-nexy-border bg-nexy-recessed p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised p-2 text-nexy-accent shadow-[1px_1px_0_rgb(var(--nexy-shadow))]">
                <Plug className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-nexy-text">MCP workspace</h3>
                <p className="mt-1 text-xs leading-relaxed text-nexy-muted">Connect capabilities once, then use them in a chat or promote them to a project or agent.</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-2 py-2"><p className="text-base font-bold tabular-nums text-nexy-text">{servers.length}</p><p className="text-[10px] uppercase tracking-wide text-nexy-muted">Servers</p></div>
              <div className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-2 py-2"><p className="text-base font-bold tabular-nums text-nexy-text">{servers.filter((server) => server.status === 'connected').length}</p><p className="text-[10px] uppercase tracking-wide text-nexy-muted">Connected</p></div>
              <div className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-2 py-2"><p className="text-base font-bold tabular-nums text-nexy-text">{servers.reduce((count, server) => count + server.toolCount, 0)}</p><p className="text-[10px] uppercase tracking-wide text-nexy-muted">Tools ready</p></div>
            </div>
          </div>

          {servers.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-nexy-text">Configured servers</h3>
                  <p className="mt-0.5 text-xs text-nexy-muted">Installed connections and their current health.</p>
                </div>
                <button type="button" onClick={() => setView('access')} className="inline-flex items-center gap-1 text-[11px] font-bold text-nexy-accent hover:underline">
                  <Users className="h-3 w-3" /> Manage access
                </button>
              </div>
              {servers.map((server) => {
                const detailsOpen = expandedServerDetails.has(server.id)
                const statusLabel = server.status === 'connected' ? 'Connected' : server.status === 'connecting' ? 'Connecting' : server.status === 'error' ? 'Needs attention' : server.enabled ? 'Offline' : 'Disabled'
                const assignedAgentCount = agentCountByServer.get(server.id) ?? 0
                return (
                  <article key={server.id} className="overflow-hidden rounded-nexy-md border-2 border-nexy-border bg-nexy-raised">
                    <div className="flex items-start gap-3 p-3">
                      <span className={`mt-1 text-sm ${STATUS_COLORS[server.status]}`} aria-label={statusLabel}>{STATUS_ICONS[server.status]}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate text-xs font-bold text-nexy-text">{server.name}</h4>
                          <span className="rounded-full border border-nexy-border bg-nexy-recessed px-1.5 py-0.5 text-[10px] font-bold text-nexy-muted">{statusLabel}</span>
                          <span className="text-[10px] text-nexy-muted">{server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}</span>
                          {server.managed && <span className="rounded-full border border-nexy-border bg-nexy-recessed px-1.5 py-0.5 text-[10px] font-bold text-nexy-muted">Built in</span>}
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-3 w-3" /> {server.sandbox?.status === 'unavailable' ? 'Sandbox unavailable' : 'Sandboxed'}</span>
                          {assignedAgentCount > 0 && <span className="text-[10px] text-nexy-muted">· {assignedAgentCount} agent{assignedAgentCount === 1 ? '' : 's'}</span>}
                        </div>
                        {server.error ? <p className="mt-1 truncate text-[11px] text-nexy-error">{server.error}</p> : <p className="mt-1 text-[11px] text-nexy-muted">Ready to use in a chat or assign to an agent.</p>}
                      </div>
                      {!server.managed && <div className="flex shrink-0 items-center gap-1">
                        <button onClick={() => handleToggle(server)} className={`rounded-full border-2 px-2 py-1 text-[10px] font-bold ${server.enabled ? 'border-nexy-success bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300' : 'border-nexy-border bg-nexy-recessed text-nexy-muted'}`} title={server.enabled ? 'Disable' : 'Enable'}>{server.enabled ? 'ON' : 'OFF'}</button>
                        <button onClick={() => handleRestart(server.id)} className="rounded-nexy-sm border-2 border-transparent p-1.5 text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text" title="Restart" aria-label="Restart server"><RefreshCw className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleEdit(server)} className="rounded-nexy-sm border-2 border-transparent p-1.5 text-nexy-muted hover:border-nexy-border hover:bg-nexy-recessed hover:text-nexy-text" title="Edit" aria-label="Edit server"><Settings className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(server.id)} className="rounded-nexy-sm border-2 border-transparent p-1.5 text-nexy-muted hover:border-nexy-error hover:bg-red-50 hover:text-nexy-error dark:hover:bg-red-950/30" title="Remove" aria-label="Remove server"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>}
                    </div>
                    <button type="button" onClick={() => setExpandedServerDetails((previous) => { const next = new Set(previous); if (next.has(server.id)) next.delete(server.id); else next.add(server.id); return next })} className="flex w-full items-center gap-1 border-t-2 border-nexy-border bg-nexy-surface px-3 py-2 text-left text-[10px] font-bold text-nexy-muted hover:bg-nexy-recessed" aria-expanded={detailsOpen}>
                      {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Technical details
                    </button>
                    {detailsOpen && <div className="space-y-1 border-t-2 border-nexy-border bg-nexy-recessed px-3 py-2 text-[10px] text-nexy-muted"><p className="break-all font-mono">{server.command} {server.args.join(' ')}</p>{server.cwd && <p>Working directory: {server.cwd}</p>}<p>Sandbox: {server.sandbox?.status ?? 'pending'}{server.sandbox?.backend ? ` · ${server.sandbox.backend}` : ''}</p>{server.sandbox?.diagnostics && <p className="break-words text-nexy-error">{server.sandbox.diagnostics}</p>}</div>}
                  </article>
                )
              })}
            </section>
          )}

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-bold text-nexy-text">Available capabilities<span className="sr-only">Add a server</span></h3>
              <p className="mt-0.5 text-xs text-nexy-muted">Start with the capability you need. We’ll fill in the technical setup.</p>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-nexy-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search capabilities — web, github, files, screenshot…" aria-label="Search server catalog" className="w-full rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed py-2 pl-9 pr-3 text-sm text-nexy-text placeholder:text-nexy-muted focus:bg-nexy-raised focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-nexy-accent" />
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Capability categories">
              {(['all', ...MCP_CATEGORY_ORDER] as const).map((category) => {
                const active = catalogCategory === category
                const label = category === 'all' ? 'All' : MCP_CATEGORY_LABELS[category]
                return <button key={category} type="button" role="tab" aria-selected={active} onClick={() => setCatalogCategory(category)} className={`shrink-0 rounded-full border-2 px-2.5 py-1 text-[11px] font-bold transition-colors ${active ? 'border-nexy-border bg-nexy-text text-nexy-raised' : 'border-nexy-border bg-nexy-raised text-nexy-muted hover:bg-nexy-recessed hover:text-nexy-text'}`}>{label}</button>
              })}
            </div>
            {groupedCatalog.length === 0 ? <p className="rounded-nexy-md border-2 border-dashed border-nexy-border px-4 py-5 text-center text-xs text-nexy-muted">No matching servers. Try a custom server below.</p> : groupedCatalog.map((group) => (
              <div key={group.category} className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-nexy-muted">{MCP_CATEGORY_LABELS[group.category]}</p>
                {group.entries.map((entry) => {
                  const added = configuredNames.has(entry.name.toLowerCase())
                  return <button key={entry.id} onClick={() => openCatalogForm(entry.id)} className="flex w-full items-start gap-3 rounded-nexy-md border-2 border-nexy-border bg-nexy-raised p-3 text-left shadow-[1px_1px_0_rgb(var(--nexy-shadow))] transition-colors hover:bg-nexy-recessed">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed text-[11px] font-bold text-nexy-accent">{entry.name.slice(0, 1)}</div>
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><span className="text-xs font-bold text-nexy-text">{entry.capability}</span>{added && <span className="rounded-full border border-nexy-success px-1.5 py-0.5 text-[10px] font-bold text-green-700 dark:text-green-300">Added</span>}{entry.requiredEnv && entry.requiredEnv.length > 0 && <span className="rounded-full border border-nexy-warning px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">Requires {entry.requiredEnv.length === 1 ? 'credential' : 'credentials'}</span>}<span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${entry.impact === 'can-change' ? 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300' : 'border-green-300 text-green-700 dark:border-green-800 dark:text-green-300'}`}>{entry.impact === 'can-change' ? 'Can make changes' : 'Read-only'}</span></div><span className="mt-1 block text-[11px] leading-relaxed text-nexy-muted">{entry.description}</span><span className="mt-1 block text-[10px] text-nexy-muted">Server: <span className="font-semibold text-nexy-text">{entry.name}</span> · Access: {entry.access}</span></div>
                    {entry.docsUrl && <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-nexy-muted" aria-hidden />}
                  </button>
                })}
              </div>
            ))}
            <div className="border-t-2 border-nexy-border pt-3"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-nexy-muted">Other ways to add</p><button onClick={() => { setRegistryError(null); setView('registry') }} className="flex w-full items-center gap-3 rounded-nexy-md border-2 border-nexy-accent bg-nexy-recessed p-3 text-left text-xs hover:bg-nexy-raised"><Globe2 className="h-4 w-4 shrink-0 text-nexy-accent" /><span className="min-w-0 flex-1"><span className="block font-bold text-nexy-text">Browse official MCP Registry</span><span className="mt-0.5 block text-[11px] font-normal text-nexy-muted">Discover community-published servers. Review source and permissions before installing.</span></span><ChevronRight className="h-4 w-4 shrink-0 text-nexy-accent" /></button></div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={openCustomForm} className="flex items-center justify-center gap-1.5 rounded-nexy-sm border-2 border-dashed border-nexy-border px-3 py-2 text-xs font-bold text-nexy-muted hover:bg-nexy-recessed hover:text-nexy-text"><Wrench className="h-3.5 w-3.5" /> Custom server</button>
              <button onClick={() => { setJsonError(null); setView('json') }} className="flex items-center justify-center gap-1.5 rounded-nexy-sm border-2 border-dashed border-nexy-border px-3 py-2 text-xs font-bold text-nexy-muted hover:bg-nexy-recessed hover:text-nexy-text"><ClipboardPaste className="h-3.5 w-3.5" /> Paste JSON</button>
            </div>
          </section>
          <section className="space-y-2">
            <div className="flex items-end justify-between gap-2"><div><h3 className="text-sm font-bold text-nexy-text">Nexy services</h3><p className="mt-0.5 text-xs text-nexy-muted">Built-in project connections managed by Nexy, not third-party servers.</p></div><Database className="h-4 w-4 text-nexy-accent" /></div>
            <div className="rounded-nexy-md border-2 border-nexy-border bg-nexy-recessed p-3"><div className="flex items-start gap-3"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised text-nexy-accent"><Database className="h-3.5 w-3.5" /></div><div className="min-w-0"><p className="text-xs font-bold text-nexy-text">Project Wiki</p><p className="mt-1 text-[11px] leading-relaxed text-nexy-muted">Search project knowledge and propose approved updates from project chats. Available automatically when a project is active.</p><span className="mt-1 inline-flex rounded-full border border-nexy-success px-1.5 py-0.5 text-[10px] font-bold text-green-700 dark:text-green-300">Nexy-managed</span></div></div></div>
          </section>
        </div>
      )}
    </ModalShell>
  )
}

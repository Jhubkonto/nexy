import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { BrowserWindow, safeStorage, type WebContents } from 'electron'
import { getDatabase } from './database'
import { randomUUID } from 'crypto'
import { safeHandle } from './safe-handle'
import { requestApproval } from './tools'
import { DESKTOP_NAVIGATOR_ID, DESKTOP_NAVIGATOR_TOOLS, createDesktopNavigatorHandler } from './desktop-navigator-mcp'
import { startDesktopNavigatorBridge, getDesktopNavigatorCliConfig } from './desktop-navigator-bridge'
import { debugLog } from './debug-mode'
import { searchMcpRegistry } from './mcp-registry'
import type { McpServerConfig, McpSandboxRuntimeStatus, McpRestartResult, McpServerDiagnosis } from '../shared/types'
import { normalizeMcpSandboxProfile } from '../shared/mcp-sandbox'
import { createSandboxedMcpTransport, getMcpSandboxProxyConfig, repairMcpSandboxProfile, shutdownMcpSandboxBroker, type McpSandboxHandle, type McpSandboxLaunchRequest } from './mcp-sandbox'
import { createManagedPlaywrightLaunch, getManagedBrowserStatus, installManagedBrowser } from './managed-playwright'

type InProcessHandler = (toolName: string, args: Record<string, unknown>) => Promise<{ success: boolean; result?: string; images?: { dataUrl: string; mimeType: string }[]; error?: string }>

interface McpServerInstance {
  config: McpServerConfig
  client?: Client
  transport?: StdioClientTransport
  inProcessHandler?: InProcessHandler
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  tools: McpTool[]
  capabilities?: Record<string, unknown>
  serverVersion?: { name: string; version: string }
  instructions?: string
  resources?: McpResource[]
  prompts?: McpPrompt[]
  sandbox?: McpSandboxRuntimeStatus
  sandboxHandle?: McpSandboxHandle
}

interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  serverId: string
  serverName: string
}

export interface CliMcpServerConfig {
  id: string
  key: string
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
}

interface McpResource {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

interface McpPrompt {
  name: string
  description?: string
  arguments?: Array<{ name: string; description?: string; required?: boolean }>
}

export interface McpExecutionPolicy {
  assignedServerIds: string[]
  serverTrust: Record<string, 'auto' | 'always-ask' | 'block'>
}

const INHERITED_MCP_ENV_KEYS = new Set([
  'PATH', 'Path', 'PATHEXT', 'ComSpec', 'COMSPEC', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
  'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL',
])

/** Keep provider credentials and other desktop secrets out of third-party MCP processes. */
export function buildMcpProcessEnv(explicitEnv: Record<string, string> = {}): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => INHERITED_MCP_ENV_KEYS.has(key) && typeof value === 'string'),
  ) as Record<string, string>
  return { ...inherited, ...explicitEnv }
}

export const servers = new Map<string, McpServerInstance>()
const reconnectTimers = new Map<string, NodeJS.Timeout>()
const intentionallyDisconnected = new Set<string>()
const RECONNECT_DELAY_MS = 5000

function resolveLaunch(config: Pick<McpServerConfig, 'command' | 'args' | 'env' | 'cwd' | 'sandboxProfile' | 'name' | 'launch'>): { request: McpSandboxLaunchRequest; cleanup?: () => void } {
  if (config.launch?.kind === 'managed-playwright') return createManagedPlaywrightLaunch(config.launch)
  const rawProfile = { ...(config.sandboxProfile ?? {}) } as Record<string, unknown>
  delete rawProfile.managedRuntime
  return {
    request: {
      command: config.command,
      args: config.args,
      env: buildMcpProcessEnv(config.env),
      cwd: config.cwd || undefined,
      profile: normalizeMcpSandboxProfile(rawProfile),
      diagnosticLabel: config.name,
    },
  }
}

function isLegacyBuiltInPlaywright(config: McpServerConfig): 'launch' | 'cdp' | undefined {
  if (config.command.toLowerCase() !== 'npx' || Object.keys(config.env).length !== 0) return undefined
  const exact = (name: string, args: string[]) => config.name === name && args.length === config.args.length && args.every((arg, index) => config.args[index] === arg)
  if (exact('Playwright (Chromium)', ['-y', '@playwright/mcp'])) return 'launch'
  if (exact('Playwright (CDP attach)', ['-y', '@playwright/mcp', '--cdp-endpoint', 'http://localhost:9222'])) return 'cdp'
  return undefined
}

/** Migrate only Nexy's old stock cards; custom npx configurations remain untouched. */
function migrateLegacyPlaywrightConfigs(): void {
  for (const config of loadServerConfigs()) {
    const mode = isLegacyBuiltInPlaywright(config)
    if (!mode) continue
    saveServerConfig({ ...config, command: '', args: [], launch: { kind: 'managed-playwright', mode } })
  }
}

function broadcastServerStatus(id: string): void {
  const instance = servers.get(id)
  const dbConfig = loadServerConfigs().find((c) => c.id === id)
  const config = dbConfig ?? instance?.config
  if (!config) return
  const payload = {
    ...config,
    status: instance?.status ?? 'disconnected',
    error: instance?.error,
    toolCount: instance?.tools.length ?? 0,
    managed: Boolean(instance?.inProcessHandler),
    ...(instance?.sandbox ? { sandbox: instance.sandbox } : {}),
  }
  let windows: BrowserWindow[]
  try {
    windows = BrowserWindow.getAllWindows()
  } catch {
    // Some headless/unit-test Electron shims do not expose BrowserWindow.
    return
  }
  for (const win of windows) {
    win.webContents.send('mcp:server-status-changed', payload)
  }
}

// A server's config_json can carry secrets (API tokens in its env map). We encrypt
// the whole blob at rest via Electron safeStorage — mirroring how provider API keys
// are handled — and flag it with config_encrypted so legacy plaintext rows written
// before this change still decode. When the OS keyring is unavailable (e.g. some
// Linux setups) we fall back to plaintext, exactly like provider-secrets.ts.
function decodeStoredConfig(configJson: string, encrypted: boolean): string {
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(configJson, 'base64'))
  }
  return configJson
}

function encodeConfigForStorage(json: string): { value: string; encrypted: boolean } {
  if (safeStorage.isEncryptionAvailable()) {
    return { value: safeStorage.encryptString(json).toString('base64'), encrypted: true }
  }
  return { value: json, encrypted: false }
}

function loadServerConfigs(): McpServerConfig[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT id, config_json, config_encrypted, enabled FROM mcp_servers').all() as {
    id: string
    config_json: string
    config_encrypted: number
    enabled: number
  }[]
  return rows.map((row) => {
    const config = JSON.parse(decodeStoredConfig(row.config_json, row.config_encrypted === 1))
    return { ...config, id: row.id, enabled: row.enabled === 1, sandboxProfile: normalizeMcpSandboxProfile(config.sandboxProfile) }
  })
}

function saveServerConfig(config: McpServerConfig): void {
  const db = getDatabase()
  // A generic external server can never inherit the wider managed-browser
  // envelope, even when its stored JSON was edited outside the UI.
  const rawProfile = { ...(config.sandboxProfile ?? {}) } as Record<string, unknown>
  if (config.launch?.kind !== 'managed-playwright') delete rawProfile.managedRuntime
  const normalized = { ...config, sandboxProfile: normalizeMcpSandboxProfile(rawProfile) }
  const { id, enabled, ...rest } = normalized
  const { value, encrypted } = encodeConfigForStorage(JSON.stringify(rest))
  db.prepare(
    'INSERT OR REPLACE INTO mcp_servers (id, config_json, config_encrypted, enabled, updated_at) VALUES (?, ?, ?, ?, unixepoch() * 1000)'
  ).run(id, value, encrypted ? 1 : 0, enabled ? 1 : 0)
}

function removeServerConfig(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
}

function scheduleReconnect(id: string): void {
  if (intentionallyDisconnected.has(id)) return
  const existing = reconnectTimers.get(id)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(async () => {
    reconnectTimers.delete(id)
    if (intentionallyDisconnected.has(id)) return

    const configs = loadServerConfigs()
    const config = configs.find((c) => c.id === id)
    if (!config || !config.enabled) return

    debugLog('mcp', `auto-reconnect: attempting ${config.name} (${config.id})`)
    await connectServer(config).catch((err) => {
      debugLog('mcp', `auto-reconnect failed for ${config.name}: ${err instanceof Error ? err.message : String(err)}`)
      console.error(`[mcp] auto-reconnect failed for ${config.name}:`, err)
      scheduleReconnect(id)
    })
  }, RECONNECT_DELAY_MS)

  reconnectTimers.set(id, timer)
}

async function connectServer(config: McpServerConfig): Promise<void> {
  if (!config.enabled) {
    intentionallyDisconnected.add(config.id)
    return
  }
  intentionallyDisconnected.delete(config.id)

  // Disconnect existing if any
  await disconnectServer(config.id)
  intentionallyDisconnected.delete(config.id)

  const extraArgs: string[] = []
  if (config.imageResponses === 'omit') {
    extraArgs.push('--imageResponses', 'omit')
  }

  let sandboxHandle: McpSandboxHandle
  let resolved: ReturnType<typeof resolveLaunch> | undefined
  try {
    resolved = resolveLaunch(config)
    sandboxHandle = createSandboxedMcpTransport({ ...resolved.request, args: [...resolved.request.args, ...extraArgs] })
  } catch (error) {
    try { resolved?.cleanup?.() } catch { /* best effort */ }
    const message = error instanceof Error ? error.message : String(error)
    servers.set(config.id, { config, status: 'error', error: message, tools: [], sandbox: { status: 'unavailable', backend: process.platform, diagnostics: message } })
    broadcastServerStatus(config.id)
    throw error
  }
  const transport = sandboxHandle.transport

  const client = new Client(
    { name: 'nexy', version: '0.9.0' },
    { capabilities: {} }
  )

  const instance: McpServerInstance = {
    config,
    client,
    transport,
    status: 'connecting',
    tools: [],
    resources: [],
    prompts: [],
    sandbox: sandboxHandle.status,
    sandboxHandle,
  }

  servers.set(config.id, instance)

  debugLog('mcp', `connecting: ${config.name} (${config.id}) cmd="${config.command}"`)
  try {
    await client.connect(transport)
    instance.status = 'connected'
    instance.sandbox = { ...sandboxHandle.status, status: 'sandboxed' }
    instance.capabilities = typeof client.getServerCapabilities === 'function'
      ? client.getServerCapabilities() as Record<string, unknown> | undefined
      : undefined
    instance.serverVersion = typeof client.getServerVersion === 'function'
      ? client.getServerVersion() as { name: string; version: string } | undefined
      : undefined
    instance.instructions = typeof client.getInstructions === 'function' ? client.getInstructions() : undefined

    transport.onclose = () => {
      const inst = servers.get(config.id)
      if (inst && inst.status === 'connected') {
        debugLog('mcp', `transport closed unexpectedly: ${config.name} — scheduling reconnect`)
        inst.status = 'disconnected'
        servers.delete(config.id)
        scheduleReconnect(config.id)
        broadcastServerStatus(config.id)
      }
    }

    // Discover tools
    try {
      const toolsResult = await client.listTools()
      instance.tools = (toolsResult.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
        serverId: config.id,
        serverName: config.name
      }))
      debugLog('mcp', `connected: ${config.name} tools=[${instance.tools.map((t) => t.name).join(', ')}]`)
    } catch {
      // Server may not support tools
      instance.tools = []
      debugLog('mcp', `connected: ${config.name} (no tools listed)`)
    }
    if (instance.capabilities?.resources && typeof client.listResources === 'function') {
      try {
        const resourceResult = await client.listResources()
        instance.resources = (resourceResult.resources || []).map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType,
        }))
      } catch (error) {
        debugLog('mcp', `resource discovery failed: ${config.name} — ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (instance.capabilities?.prompts && typeof client.listPrompts === 'function') {
      try {
        const promptResult = await client.listPrompts()
        instance.prompts = (promptResult.prompts || []).map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          arguments: prompt.arguments,
        }))
      } catch (error) {
        debugLog('mcp', `prompt discovery failed: ${config.name} — ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } catch (error) {
    instance.status = 'error'
    instance.error = (error as Error).message
    debugLog('mcp', `connect failed: ${config.name} — ${instance.error}`)
    console.error(`[mcp] failed to start ${config.name}:`, error)
  }

  broadcastServerStatus(config.id)
}

export interface McpTestResult {
  ok: boolean
  tools?: { name: string; description?: string }[]
  error?: string
  sandbox?: McpSandboxRuntimeStatus
}

type McpLaunchConfig = Pick<McpServerConfig, 'command' | 'args' | 'env'> &
  Partial<Pick<McpServerConfig, 'cwd' | 'imageResponses' | 'sandboxProfile' | 'launch' | 'name'>>

/**
 * Pre-flight check for a candidate server. Spawns an ephemeral stdio connection,
 * lists its tools, then tears it down — without persisting anything or touching the
 * live `servers` map. Powers the "Test connection" button in the add-server wizard.
 */
export async function testMcpServer(
  config: McpLaunchConfig
): Promise<McpTestResult> {
  if ((!config.command || !config.command.trim()) && config.launch?.kind !== 'managed-playwright') {
    return { ok: false, error: 'A launch command is required.' }
  }

  const extraArgs: string[] = []
  if (config.imageResponses === 'omit') {
    extraArgs.push('--imageResponses', 'omit')
  }

  let sandboxHandle: McpSandboxHandle
  let resolved: ReturnType<typeof resolveLaunch> | undefined
  try {
    resolved = resolveLaunch({ ...config, name: config.name ?? 'preflight', args: config.args ?? [], env: config.env ?? {} })
    sandboxHandle = createSandboxedMcpTransport({ ...resolved.request, args: [...resolved.request.args, ...extraArgs] })
  } catch (error) {
    try { resolved?.cleanup?.() } catch { /* best effort */ }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message, sandbox: { status: 'unavailable', backend: process.platform, diagnostics: message } }
  }
  const transport = sandboxHandle.transport

  const client = new Client({ name: 'nexy-preflight', version: '0.9.0' }, { capabilities: {} })

  try {
    await client.connect(transport)
    let tools: { name: string; description?: string }[] = []
    try {
      const result = await client.listTools()
      tools = (result.tools || []).map((t) => ({ name: t.name, description: t.description }))
    } catch {
      // Server connected but exposes no tools list — still a successful connection.
      tools = []
    }
    return { ok: true, tools, sandbox: { ...sandboxHandle.status, status: 'sandboxed' } }
  } catch (error) {
    return { ok: false, error: (error as Error).message, sandbox: sandboxHandle.status }
  } finally {
    try {
      await sandboxHandle.close()
    } catch {
      // Ignore teardown errors.
    }
  }
}

export async function disconnectServer(id: string): Promise<void> {
  debugLog('mcp', `disconnecting: ${id}`)
  intentionallyDisconnected.add(id)

  const existing = reconnectTimers.get(id)
  if (existing) {
    clearTimeout(existing)
    reconnectTimers.delete(id)
  }

  const instance = servers.get(id)
  if (instance) {
    if (instance.sandboxHandle) {
      try {
        await instance.sandboxHandle.close()
      } catch {
        // Ignore close errors
      }
    } else if (instance.transport) {
      try { await instance.transport.close() } catch { /* Ignore close errors */ }
    }
    instance.status = 'disconnected'
    servers.delete(id)
    broadcastServerStatus(id)
  }
}

export function getAvailableMcpTools(serverIds?: string[]): McpTool[] {
  const tools: McpTool[] = []
  for (const [id, instance] of servers) {
    if (instance.status !== 'connected') continue
    if (serverIds && !serverIds.includes(id)) continue
    tools.push(...instance.tools)
  }
  return tools
}

export async function ensureMcpServersReady(serverIds: string[]): Promise<void> {
  if (serverIds.length === 0) return

  const configs = loadServerConfigs()
  for (const serverId of serverIds) {
    const instance = servers.get(serverId)
    if (instance?.status === 'connected' && instance.tools.length > 0) continue

    const config = configs.find((c) => c.id === serverId)
    if (!config || !config.enabled) continue
    await connectServer(config).catch((err) => {
      debugLog('mcp', `ensureReady failed for ${config.name}: ${err instanceof Error ? err.message : String(err)}`)
      console.error(`[mcp] failed to prepare ${config.name}:`, err)
    })
  }
}

function toCliMcpServerKey(config: McpServerConfig): string {
  const base = config.name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base || `mcp_${config.id.replace(/[^a-zA-Z0-9_-]+/g, '_')}`
}

export function getMcpServerConfigsForCli(serverIds: string[]): CliMcpServerConfig[] {
  const allowed = new Set(serverIds)
  const configs = loadServerConfigs()
    .filter((config) => config.enabled && allowed.has(config.id))
    .map((config) => {
      const extraArgs = config.imageResponses === 'omit'
        ? ['--imageResponses', 'omit']
        : []
      const resolved = resolveLaunch(config)
      const proxy = getMcpSandboxProxyConfig({ ...resolved.request, args: [...resolved.request.args, ...extraArgs] })
      return { ...proxy, id: config.id, key: toCliMcpServerKey(config) }
    })

  // Inject the Desktop Navigator bridge when it is assigned to this agent
  if (allowed.has(DESKTOP_NAVIGATOR_ID)) {
    const bridgeConfig = getDesktopNavigatorCliConfig()
    if (bridgeConfig) configs.push(bridgeConfig)
  }

  return configs
}

export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  agentId?: string,
  webContents?: WebContents,
  agenticMode?: boolean,
  autoApprove?: boolean,
  fullAutoApprove?: boolean,
  executionPolicy?: McpExecutionPolicy,
): Promise<{ success: boolean; result?: string; images?: { dataUrl: string; mimeType: string }[]; error?: string }> {
  const instance = servers.get(serverId)
  if (!instance || instance.status !== 'connected') {
    return { success: false, error: `Server ${serverId} not connected` }
  }
  if (!instance.tools.some((tool) => tool.name === toolName)) {
    return { success: false, error: `Tool ${toolName} is not available on server ${serverId}` }
  }
  if (!agentId) return { success: false, error: 'An agent identity is required for MCP tool execution' }

  const db = getDatabase()
  const agentRow = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(agentId) as { config_json: string } | undefined
  if (!agentRow && !executionPolicy) return { success: false, error: `Agent ${agentId} not found` }
  if (agentRow) {
    let agentConfig: Record<string, unknown>
    try {
      agentConfig = JSON.parse(agentRow.config_json) as Record<string, unknown>
    } catch {
      return { success: false, error: `Agent ${agentId} has invalid configuration` }
    }
    const assignedServerIds = Array.isArray(agentConfig.mcpServers)
      ? agentConfig.mcpServers.filter((id): id is string => typeof id === 'string')
      : []
    if (!assignedServerIds.includes(serverId) && !executionPolicy?.assignedServerIds.includes(serverId)) {
      return { success: false, error: `MCP server ${serverId} is not assigned to agent ${agentId}` }
    }
  }
  if (executionPolicy && !executionPolicy.assignedServerIds.includes(serverId)) {
    return { success: false, error: `MCP server ${serverId} is not enabled for this conversation` }
  }

  // Resolve approval policy. Per-tool overrides take precedence; the server-level
  // trust setting is the fallback. Both count as "explicit" so that agentic mode
  // cannot bypass them — agentic auto-approve only applies when neither a tool
  // override nor a server trust row exists.
  let approval: string = 'always-ask'
  let hasExplicitOverride = false

  {
    const serverTrust = db.prepare(
      'SELECT trust FROM agent_mcp_server_trust WHERE agent_id=? AND server_id=?'
    ).get(agentId, serverId) as { trust: string } | undefined
    const effectiveTrust = executionPolicy?.serverTrust[serverId] ?? serverTrust?.trust
    if (effectiveTrust === 'block') return { success: false, error: 'MCP server is blocked by policy' }
    const override = db.prepare(
      'SELECT enabled, approval FROM agent_mcp_tool_overrides WHERE agent_id=? AND server_id=? AND tool_name=?'
    ).get(agentId, serverId, toolName) as { enabled: number; approval: string } | undefined
    // Explicit denials are absolute, including in full-auto mode.
    if (override?.enabled === 0) return { success: false, error: 'Tool disabled for this agent' }
    if (override) {
      approval = override.approval
      hasExplicitOverride = true
    } else if (effectiveTrust) {
      // No per-tool row — fall back to the server-level trust setting.
      approval = effectiveTrust === 'auto' ? 'auto' : 'always-ask'
      hasExplicitOverride = true
    }
  }

  const policyTrust = executionPolicy?.serverTrust[serverId]
  if (policyTrust === 'block') return { success: false, error: 'MCP server is blocked by policy' }
  if (policyTrust === 'always-ask' && approval === 'auto') approval = 'always-ask'
  if (approval === 'disabled') return { success: false, error: 'Tool disabled for this agent' }

  // fullAutoApprove may bypass approval prompts, but never an explicit denial.
  // autoApprove bypasses when no explicit override exists (agentic mode).
  // agenticMode auto-approves tools that have no explicit override.
  const bypassApproval = fullAutoApprove || autoApprove || (agenticMode && !hasExplicitOverride)

  if (approval === 'always-ask' && !bypassApproval) {
    if (!webContents || webContents.isDestroyed()) {
      return { success: false, error: 'Tool requires interactive approval but no UI is available' }
    }
    const tool = instance.tools.find((t) => t.name === toolName)
    const description = `[${instance.config.name}] ${tool?.description ?? toolName}`
    const approved = await requestApproval(webContents, toolName, args, description, { noRemember: true })
    if (!approved) return { success: false, error: 'Tool execution denied by user' }
  }

  if (fullAutoApprove && webContents && !webContents.isDestroyed()) {
    webContents.send('tool:auto-approved', { toolName, args })
  }

  debugLog('mcp', `tool-call: server=${serverId} tool=${toolName} approval=${approval} bypass=${String(bypassApproval)}`)
  try {
    if (instance.inProcessHandler) {
      return await instance.inProcessHandler(toolName, args)
    }

    if (!instance.client) {
      return { success: false, error: `Server ${serverId} has no client` }
    }

    const result = await instance.client.callTool({ name: toolName, arguments: args })
    const contentArray = Array.isArray(result.content) ? result.content : []

    const textContent = contentArray
      .filter((c): c is { type: string; text: string } =>
        c != null && typeof c === 'object' && 'type' in c &&
        c.type === 'text' && typeof (c as { text?: unknown }).text === 'string')
      .map((c) => c.text)
      .join('\n')

    const images = contentArray
      .filter((c): c is { type: 'image'; data: string; mimeType: string } =>
        c != null && typeof c === 'object' && 'type' in c &&
        c.type === 'image' &&
        typeof (c as { data?: unknown }).data === 'string' &&
        typeof (c as { mimeType?: unknown }).mimeType === 'string')
      .map((c) => ({ dataUrl: `data:${c.mimeType};base64,${c.data}`, mimeType: c.mimeType }))

    // When image parts are present, use a short summary rather than dumping the raw JSON blob
    const resultText = textContent || (images.length > 0
      ? `[Screenshot captured — ${images.length} image(s)]`
      : JSON.stringify(result.content))

    if (result.isError) {
      return { success: false, error: resultText, ...(images.length > 0 && { images }) }
    }
    return { success: true, result: resultText, ...(images.length > 0 && { images }) }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

export async function initMcpServers(): Promise<void> {
  migrateLegacyPlaywrightConfigs()
  const configs = loadServerConfigs()
  for (const config of configs) {
    if (config.enabled) {
      await connectServer(config).catch((err) => {
        debugLog('mcp', `init failed for ${config.name}: ${err instanceof Error ? err.message : String(err)}`)
        console.error(`[mcp] failed to start ${config.name}:`, err)
      })
    }
  }
}

export async function shutdownMcpServers(): Promise<void> {
  for (const [id, timer] of reconnectTimers) {
    clearTimeout(timer)
    reconnectTimers.delete(id)
  }

  const ids = [...servers.keys()]
  for (const id of ids) {
    await disconnectServer(id).catch((err) => {
      debugLog('mcp', `shutdown disconnect failed for ${id}: ${err instanceof Error ? err.message : String(err)}`)
      console.error(`[mcp] failed to disconnect ${id}:`, err)
    })
  }
  await shutdownMcpSandboxBroker()
}

export function initDesktopNavigatorMcp(win: BrowserWindow): void {
  const handler = createDesktopNavigatorHandler(win)
  servers.set(DESKTOP_NAVIGATOR_ID, {
    config: {
      id: DESKTOP_NAVIGATOR_ID,
      name: 'Desktop Navigator',
      description: 'Inspect and operate the Nexy desktop interface through navigation and interaction tools.',
      command: '',
      args: [],
      env: {},
      enabled: true,
    },
    inProcessHandler: handler,
    status: 'connected',
    tools: DESKTOP_NAVIGATOR_TOOLS,
    sandbox: { status: 'sandboxed', backend: 'internal' },
  })
  // Start the HTTP bridge so CLI adapters (claude, codex) can also reach Desktop
  // Navigator tools via the stdio bridge worker script.
  startDesktopNavigatorBridge(handler).catch((err) => {
    debugLog('mcp', `Desktop Navigator CLI bridge failed to start: ${err instanceof Error ? err.message : String(err)}`)
    console.error('[mcp] Desktop Navigator CLI bridge failed to start:', err)
  })
}

export function getMcpServersWithStatus(): (McpServerConfig & { status: string; error?: string; toolCount: number; resourceCount: number; promptCount: number; capabilities?: Record<string, unknown>; serverVersion?: { name: string; version: string }; instructions?: string; sandbox?: McpSandboxRuntimeStatus })[] {
  const configs = loadServerConfigs()
  const configIds = new Set(configs.map((c) => c.id))
  const result = configs.map((config) => {
    const instance = servers.get(config.id)
    return {
      ...config,
      status: instance?.status ?? 'disconnected',
      error: instance?.error,
      toolCount: instance?.tools.length ?? 0,
      resourceCount: instance?.resources?.length ?? 0,
      promptCount: instance?.prompts?.length ?? 0,
      managed: Boolean(instance?.inProcessHandler),
      ...(instance?.capabilities ? { capabilities: instance.capabilities } : {}),
      ...(instance?.serverVersion ? { serverVersion: instance.serverVersion } : {}),
      ...(instance?.instructions ? { instructions: instance.instructions } : {}),
      ...(instance?.sandbox ? { sandbox: instance.sandbox } : {}),
    }
  })
  for (const [id, instance] of servers) {
    if (!configIds.has(id) && instance.inProcessHandler) {
      result.push({
        ...instance.config,
        status: instance.status,
        error: instance.error,
        toolCount: instance.tools.length,
        resourceCount: instance.resources?.length ?? 0,
        promptCount: instance.prompts?.length ?? 0,
        managed: true,
        ...(instance.capabilities ? { capabilities: instance.capabilities } : {}),
        ...(instance.serverVersion ? { serverVersion: instance.serverVersion } : {}),
        ...(instance.instructions ? { instructions: instance.instructions } : {}),
      })
    }
  }
  return result
}

/** Secret-free metadata for the companion protocol. */
export function getMcpServersForCompanion(): Array<Omit<ReturnType<typeof getMcpServersWithStatus>[number], 'env'>> {
  return getMcpServersWithStatus().map(({ env: _env, ...server }) => server)
}

export function getMcpServerStatus(id: string): { status: string; error?: string; tools: McpTool[]; resources: McpResource[]; prompts: McpPrompt[]; capabilities?: Record<string, unknown>; serverVersion?: { name: string; version: string }; instructions?: string; sandbox?: McpSandboxRuntimeStatus } {
  const instance = servers.get(id)
  return {
    status: instance?.status ?? 'disconnected',
    error: instance?.error,
    tools: instance?.tools ?? [],
    resources: instance?.resources ?? [],
    prompts: instance?.prompts ?? [],
    ...(instance?.capabilities ? { capabilities: instance.capabilities } : {}),
    ...(instance?.serverVersion ? { serverVersion: instance.serverVersion } : {}),
        ...(instance?.instructions ? { instructions: instance.instructions } : {}),
        ...(instance?.sandbox ? { sandbox: instance.sandbox } : {}),
  }
}

export async function addMcpServer(config: Omit<McpServerConfig, 'id'>): Promise<McpServerConfig> {
  const id = randomUUID()
  const full = { ...config, id, sandboxProfile: normalizeMcpSandboxProfile(config.sandboxProfile) } as McpServerConfig
  saveServerConfig(full)
  if (full.enabled) await connectServer(full).catch(() => {})
  return full
}

export async function updateMcpServer(id: string, updates: Partial<McpServerConfig>): Promise<McpServerConfig | null> {
  const configs = loadServerConfigs()
  const existing = configs.find((c) => c.id === id)
  if (!existing) return null
  const updated = { ...existing, ...updates, id, sandboxProfile: normalizeMcpSandboxProfile(updates.sandboxProfile ?? existing.sandboxProfile) }
  saveServerConfig(updated)
  if (updated.enabled) {
    await connectServer(updated).catch(() => {})
  } else {
    await disconnectServer(id)
  }
  return updated
}

export async function removeMcpServer(id: string): Promise<void> {
  await disconnectServer(id)
  removeServerConfig(id)
}

export async function restartMcpServer(id: string): Promise<McpRestartResult> {
  // Nexy-owned bridges do not have a user launch configuration to restart.
  if (id === DESKTOP_NAVIGATOR_ID) {
    return { attempted: false, connected: true, error: 'This Nexy-managed server cannot be restarted here.' }
  }
  const configs = loadServerConfigs()
  const config = configs.find((c) => c.id === id)
  if (!config) return { attempted: false, connected: false, error: 'Server configuration was not found.' }
  if (!config.enabled) return { attempted: false, connected: false, error: 'Server is disabled. Enable it to start a connection.' }
  await connectServer(config).catch(() => {})
  const instance = servers.get(id)
  return {
    attempted: true,
    connected: instance?.status === 'connected',
    ...(instance?.status === 'connected' ? {} : { error: instance?.error ?? 'The server did not establish an MCP connection.' }),
  }
}

function connectionGuidance(config: McpServerConfig, test: McpTestResult): string[] {
  if (test.ok) {
    return config.enabled
      ? ['The isolated connection test passed. Retry connection to replace the live process, then check whether another process or policy is closing it.']
      : ['The isolated connection test passed. Enable the server when you are ready to start its live connection.']
  }

  const error = `${test.error ?? ''} ${test.sandbox?.diagnostics ?? ''}`.toLowerCase()
  const guidance: string[] = []
  if (/enoent|not recognized|command not found|spawn/.test(error)) {
    guidance.push('Verify that the launch command is installed and available on Nexy’s PATH, then check its spelling.')
  }
  if (/connection closed|closed unexpectedly|eof|exited/.test(error)) {
    guidance.push('The server exited during MCP startup. Check its arguments, required environment variables, and working directory; run the displayed command in a terminal for its own startup output.')
  }
  if (/sandbox|access denied|permission/.test(error)) {
    guidance.push('Review the sandbox diagnostic below and the server’s filesystem, network, or child-process requirements in Edit setup.')
  }
  if (config.cwd) guidance.push('Confirm that the configured working directory still exists and is accessible.')
  if (guidance.length === 0) guidance.push('Review the exact test error and verify the command, arguments, environment variables, and working directory in Edit setup.')
  return guidance
}

/**
 * Safely investigates the persisted configuration without changing its enabled state
 * or replacing the live connection. Secrets in the environment are never returned.
 */
export async function diagnoseMcpServer(id: string): Promise<McpServerDiagnosis> {
  const config = loadServerConfigs().find((candidate) => candidate.id === id)
  const instance = servers.get(id)
  if (!config) {
    return { found: false, enabled: false, status: 'disconnected', guidance: ['Server configuration was not found. Refresh the list or add the server again.'] }
  }
  const test = await testMcpServer(config)
  return {
    found: true,
    enabled: config.enabled,
    status: instance?.status ?? 'disconnected',
    ...(instance?.error ? { liveError: instance.error } : {}),
    test,
    guidance: connectionGuidance(config, test),
  }
}

export function listMcpTools(serverIds?: string[]): McpTool[] {
  return getAvailableMcpTools(serverIds)
}

export function listMcpToolsForAgent(agentId: string): McpTool[] {
  const db = getDatabase()
  const row = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(agentId) as { config_json: string } | undefined
  if (!row) return []
  const cfg = JSON.parse(row.config_json) as Record<string, unknown>
  const serverIds: string[] = Array.isArray(cfg.mcpServers) ? cfg.mcpServers as string[] : []
  return getAvailableMcpTools(serverIds)
}

export function registerMcpHandlers(): void {
  safeHandle('mcp:get-managed-browser-status', () => getManagedBrowserStatus())
  safeHandle('mcp:install-managed-browser', async () => installManagedBrowser())
  safeHandle('mcp:repair-sandbox', () => {
    repairMcpSandboxProfile()
    return true
  })
  safeHandle('mcp:list-servers', () => {
    return getMcpServersWithStatus()
  })

  safeHandle('mcp:add-server', async (_event, config: Omit<McpServerConfig, 'id'>) => {
    const id = randomUUID()
    const fullConfig = { ...config, id } as McpServerConfig
    saveServerConfig(fullConfig)
    if (fullConfig.enabled) {
      await connectServer(fullConfig).catch(() => {})
    }
    return fullConfig
  })

  safeHandle('mcp:update-server', async (_event, id: string, updates: Partial<McpServerConfig>) => {
    const configs = loadServerConfigs()
    const existing = configs.find((c) => c.id === id)
    if (!existing) return null

    const updated = { ...existing, ...updates, id }
    saveServerConfig(updated)

    // Reconnect if enabled, disconnect if disabled
    if (updated.enabled) {
      await connectServer(updated).catch(() => {})
    } else {
      await disconnectServer(id)
    }
    return updated
  })

  safeHandle('mcp:remove-server', async (_event, id: string) => {
    await disconnectServer(id)
    removeServerConfig(id)
    return true
  })

  safeHandle('mcp:get-server-status', (_event, id: string) => {
    return getMcpServerStatus(id)
  })

  safeHandle('mcp:list-tools', (_event, serverIds?: string[]) => {
    return getAvailableMcpTools(serverIds)
  })

  safeHandle('mcp:list-tools-for-agent', (_event, agentId: string) => {
    const db = getDatabase()
    const agentRow = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(agentId) as { config_json: string } | undefined
    if (!agentRow) return []
    const cfg = JSON.parse(agentRow.config_json)
    const serverIds: string[] = cfg.mcpServers ?? []
    return getAvailableMcpTools(serverIds)
  })

  safeHandle('agent:get-mcp-tool-overrides', (_event, agentId: string) => {
    const db = getDatabase()
    return db.prepare('SELECT * FROM agent_mcp_tool_overrides WHERE agent_id = ?').all(agentId)
  })

  safeHandle('agent:set-mcp-tool-override', (_event, agentId: string, serverId: string, toolName: string, config: { enabled: boolean; approval: string; instructions: string }) => {
    const db = getDatabase()
    db.prepare(
      'INSERT OR REPLACE INTO agent_mcp_tool_overrides (agent_id, server_id, tool_name, enabled, approval, instructions) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(agentId, serverId, toolName, config.enabled ? 1 : 0, config.approval, config.instructions)
    return true
  })

  safeHandle('agent:get-mcp-server-trust', (_event, agentId: string) => {
    const db = getDatabase()
    return db.prepare('SELECT server_id, trust FROM agent_mcp_server_trust WHERE agent_id = ?').all(agentId)
  })

  safeHandle('agent:set-mcp-server-trust', (_event, agentId: string, serverId: string, trust: string) => {
    const db = getDatabase()
    db.prepare(
      'INSERT OR REPLACE INTO agent_mcp_server_trust (agent_id, server_id, trust) VALUES (?, ?, ?)'
    ).run(agentId, serverId, trust)
    return true
  })

  safeHandle('agent:assign-mcp-server', (_event, agentId: string, serverId: string, trust: string = 'always-ask') => {
    if (!['auto', 'always-ask', 'block'].includes(trust)) {
      throw new Error('Invalid MCP trust tier')
    }
    const db = getDatabase()
    const agentRow = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(agentId) as
      | { config_json: string }
      | undefined
    if (!agentRow) throw new Error('Agent not found')

    const serverExists = loadServerConfigs().some((config) => config.id === serverId) || servers.has(serverId)
    if (!serverExists) throw new Error('MCP server not found')

    const config = JSON.parse(agentRow.config_json) as Record<string, unknown>
    const assignedServers = Array.isArray(config.mcpServers)
      ? config.mcpServers.filter((id): id is string => typeof id === 'string')
      : []
    if (!assignedServers.includes(serverId)) assignedServers.push(serverId)
    config.mcpServers = assignedServers
    db.prepare('UPDATE agents SET config_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(config),
      Date.now(),
      agentId,
    )
    db.prepare(
      'INSERT OR REPLACE INTO agent_mcp_server_trust (agent_id, server_id, trust) VALUES (?, ?, ?)'
    ).run(agentId, serverId, trust)
    return { assigned: true, trust }
  })

  safeHandle(
    'mcp:call-tool',
    async (event, serverId: string, toolName: string, args: Record<string, unknown>, agentId?: string) => {
      return await callMcpTool(serverId, toolName, args, agentId, event.sender)
    }
  )

  safeHandle('mcp:restart-server', async (_event, id: string) => {
    return await restartMcpServer(id)
  })

  safeHandle('mcp:diagnose-server', async (_event, id: string) => {
    return await diagnoseMcpServer(id)
  })

  safeHandle('mcp:test-server', async (_event, config: McpLaunchConfig) => {
    return await testMcpServer(config)
  })

  safeHandle('mcp:search-registry', async (_event, query: string) => {
    return await searchMcpRegistry(typeof query === 'string' ? query : '')
  })
}

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { nodeWorkerCommand, nodeWorkerEnv } from './node-worker-launch'

export interface IsolatedRuntime {
  runtimeId: string
  /** Present only when the runtime was started from an operator project chat. */
  projectId?: string
  workspacePath: string
  cdpUrl: string
  startedAt: number
  pid: number | null
}

export interface IsolatedRuntimeStatus extends IsolatedRuntime {
  running: boolean
}

export interface IsolatedRuntimeToolDefinition {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  pack: string
  mutating?: boolean
}

const RUNTIME_TOOLS: IsolatedRuntimeToolDefinition[] = [
  {
    name: 'start_isolated_nexy_instance',
    pack: 'build',
    mutating: true,
    description: 'Start one disposable Nexy instance from the development workspace. Build it first; the returned CDP endpoint is only used by the bridge Playwright tools.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_isolated_nexy_instance',
    pack: 'build',
    description: 'Get the disposable Nexy instance and loopback CDP endpoint for the development workspace.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'stop_isolated_nexy_instance',
    pack: 'build',
    mutating: true,
    description: 'Stop and remove the disposable Nexy instance for the development workspace.',
    inputSchema: { type: 'object', properties: {} },
  },
]

interface ActiveRuntime {
  runtime: IsolatedRuntime
  child: ChildProcess
  tempRoot: string
  playwrightClient: Client
  playwrightTransport: StdioClientTransport
  tools: IsolatedRuntimeToolDefinition[]
}

let active: ActiveRuntime | null = null
let toolChangeListener: (() => void) | null = null

export function setIsolatedRuntimeToolChangeListener(listener: (() => void) | null): void {
  toolChangeListener = listener
}

function assertNexyWorkspace(workspacePath: string): void {
  const packagePath = join(workspacePath, 'package.json')
  if (!existsSync(packagePath)) throw new Error('The selected workspace is not a Nexy workspace')
  let packageJson: { name?: string }
  try {
    packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: string }
  } catch {
    throw new Error('The selected workspace is not a Nexy workspace')
  }
  if (packageJson.name !== 'nexy') throw new Error('The selected workspace is not a Nexy workspace')
}

function sanitizedEnvironment(userDataPath: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|AUTH)/i.test(key) && !key.startsWith('NEXY_PROJECT_')) env[key] = value
  }
  env.NEXY_ISOLATED_RUNTIME = '1'
  env.NEXY_ISOLATED_USER_DATA = userDataPath
  env.NEXY_DISABLE_EXTERNAL_SERVICES = '1'
  env.NEXY_RUNTIME_NETWORK = 'loopback-only'
  env.NO_PROXY = '127.0.0.1,localhost'
  env.no_proxy = '127.0.0.1,localhost'
  return env
}

async function waitForCdp(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated Nexy exited before CDP became available (code ${child.exitCode})`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for the isolated Nexy instance')
}

async function killProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.once('close', () => resolve())
      killer.once('error', () => resolve())
    })
    return
  }
  try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch { /* already stopped */ } }
}

function playwrightCliPath(): string {
  return join(app.getAppPath(), 'node_modules', '@playwright', 'mcp', 'cli.js')
}

function normalizePlaywrightTools(runtimeId: string, tools: Array<{ name: string; description?: string; inputSchema?: unknown }>): IsolatedRuntimeToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    pack: 'browser',
    mutating: true,
    description: tool.description ?? `Playwright browser tool for isolated Nexy runtime ${runtimeId}`,
    inputSchema: (tool.inputSchema && typeof tool.inputSchema === 'object'
      ? tool.inputSchema
      : { type: 'object', properties: {} }) as IsolatedRuntimeToolDefinition['inputSchema'],
  }))
}

export function getIsolatedRuntimeToolDefinitions(): IsolatedRuntimeToolDefinition[] {
  return [...RUNTIME_TOOLS, ...(active?.tools ?? [])]
}

export function getIsolatedRuntime(projectId?: string): IsolatedRuntimeStatus | null {
  if (!active || (projectId && active.runtime.projectId !== projectId)) return null
  const running = active.child.exitCode === null && !active.child.killed
  return { ...active.runtime, running }
}

export async function startIsolatedNexyInstance(workspacePathOrProjectId: string, workspacePathArg?: string): Promise<IsolatedRuntimeStatus> {
  const projectId = workspacePathArg ? workspacePathOrProjectId : undefined
  const workspacePath = workspacePathArg ?? workspacePathOrProjectId
  const existing = getIsolatedRuntime(projectId)
  if (existing?.running && (existing.workspacePath !== workspacePath || existing.projectId !== projectId)) {
    throw new Error('Another isolated Nexy instance is already running; stop it before starting a different runtime')
  }
  if (existing?.running) return existing
  if (active) await stopIsolatedNexyInstance(active.runtime.projectId)

  assertNexyWorkspace(workspacePath)
  if (!existsSync(join(workspacePath, 'dist', 'main', 'index.js'))) {
    throw new Error('Build Nexy first with the existing Build tool, then start the isolated instance')
  }

  const runtimeId = randomUUID()
  const tempRoot = await fs.mkdtemp(join(app.getPath('temp'), `nexy-isolated-runtime-${runtimeId.slice(0, 8)}-`))
  const profilePath = join(tempRoot, 'profile')
  await fs.mkdir(profilePath, { recursive: true })
  const port = 10_000 + Math.floor(Math.random() * 40_000)
  const child = spawn(process.execPath, [
    '--disable-gpu',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '.',
    '--nexy-isolated-runtime',
  ], {
    cwd: workspacePath,
    env: sanitizedEnvironment(profilePath),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForCdp(port, child)
    const cdpUrl = `http://127.0.0.1:${port}`
    const transport = new StdioClientTransport({
      command: nodeWorkerCommand(),
      args: [playwrightCliPath(), '--cdp-endpoint', cdpUrl, '--headless', '--image-responses', 'omit', '--allowed-hosts', '127.0.0.1,localhost'],
      // Playwright's MCP entry point is a Node script, so Electron must run as Node here.
      // The sibling spawn above deliberately omits this: it launches a real Electron app.
      env: nodeWorkerEnv(sanitizedEnvironment(join(tempRoot, 'playwright-profile'))),
      stderr: 'pipe',
    })
    const client = new Client({ name: 'nexy-isolated-runtime', version: '1.0.0' }, { capabilities: {} })
    await client.connect(transport)
    const result = await client.listTools()
    const runtime: IsolatedRuntime = { runtimeId, ...(projectId ? { projectId } : {}), workspacePath, cdpUrl, startedAt: Date.now(), pid: child.pid ?? null }
    active = { runtime, child, tempRoot, playwrightClient: client, playwrightTransport: transport, tools: normalizePlaywrightTools(runtimeId, result.tools ?? []) }
    toolChangeListener?.()
    child.once('exit', () => { if (active?.runtime.runtimeId === runtimeId) void stopIsolatedNexyInstance(projectId) })
    return { ...runtime, running: true }
  } catch (error) {
    await killProcessTree(child)
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export async function callIsolatedRuntimeTool(projectIdOrToolName: string, toolNameOrArgs: string | Record<string, unknown>, argsArg?: Record<string, unknown>): Promise<unknown> {
  const projectId = argsArg ? projectIdOrToolName : undefined
  const toolName = argsArg ? toolNameOrArgs as string : projectIdOrToolName
  const args = (argsArg ?? toolNameOrArgs) as Record<string, unknown>
  if (RUNTIME_TOOLS.some((tool) => tool.name === toolName)) throw new Error('Runtime control tools must be called through the development bridge')
  if (!active || !getIsolatedRuntime(projectId)?.running) throw new Error(projectId ? 'No isolated Nexy instance is running for the selected project' : 'No isolated Nexy instance is running for the development workspace')
  if (!active.tools.some((tool) => tool.name === toolName)) throw new Error(`Unknown isolated browser tool: ${toolName}`)
  return active.playwrightClient.callTool({ name: toolName, arguments: args })
}

export async function stopIsolatedNexyInstance(projectId?: string): Promise<boolean> {
  if (!active || (projectId && active.runtime.projectId !== projectId)) return false
  const current = active
  active = null
  toolChangeListener?.()
  await current.playwrightClient.close().catch(() => {})
  await current.playwrightTransport.close().catch(() => {})
  await killProcessTree(current.child)
  await fs.rm(current.tempRoot, { recursive: true, force: true }).catch(() => {})
  return true
}

export async function stopAllIsolatedNexyInstances(): Promise<void> {
  await stopIsolatedNexyInstance()
}

export async function callRuntimeControlTool(projectIdOrWorkspacePath: string, workspacePathOrToolName: string, toolNameArg?: string): Promise<unknown> {
  const projectId = toolNameArg ? projectIdOrWorkspacePath : undefined
  const workspacePath = toolNameArg ? workspacePathOrToolName : projectIdOrWorkspacePath
  const toolName = toolNameArg ?? workspacePathOrToolName
  if (toolName === 'start_isolated_nexy_instance') return projectId ? startIsolatedNexyInstance(projectId, workspacePath) : startIsolatedNexyInstance(workspacePath)
  if (toolName === 'get_isolated_nexy_instance') return getIsolatedRuntime(projectId)
  if (toolName === 'stop_isolated_nexy_instance') return ({ stopped: await stopIsolatedNexyInstance(projectId) })
  throw new Error(`Unknown isolated runtime tool: ${toolName}`)
}

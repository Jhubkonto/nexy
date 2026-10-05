import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { WebContents } from 'electron'
import { nodeWorkerCommand, nodeWorkerEnv } from './node-worker-launch'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import { getDevelopmentMcpToolDefinitions, callDevelopmentMcpTool } from './development-mcp-capabilities'
import { setIsolatedRuntimeToolChangeListener } from './isolated-runtime'

const MCP_PATH = '/mcp'
const MAX_BODY_BYTES = 2 * 1024 * 1024

export interface DevelopmentMcpConnection { url: string; token: string; command: string; args: string[]; env: Record<string, string> }
export interface DevelopmentMcpStatus { workspacePath: string | null; running: boolean; url: string | null; stdio: { command: string; args: string[]; env: Record<string, string> } | null }
interface Session { server: Server; transport: StreamableHTTPServerTransport }
interface Bridge { root: string; token: string; server: HttpServer; port: number; webContents: WebContents; sessions: Map<string, Session> }
let bridge: Bridge | null = null

function configuredWorkspace(): string {
  const row = getDatabase().prepare("SELECT value FROM settings WHERE key = 'build_workspace_path'").get() as { value: string } | undefined
  return row?.value ?? process.cwd()
}

export function validatedDevelopmentWorkspace(): string {
  const workspace = resolve(configuredWorkspace())
  const packagePath = join(workspace, 'package.json')
  if (!existsSync(packagePath)) throw new Error('Configure an accessible Nexy source checkout before connecting an external agent')
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: string }
    if (packageJson.name !== 'nexy') throw new Error()
  } catch { throw new Error('The configured development workspace is not a Nexy source checkout') }
  return realpathSync(workspace)
}

function workerScriptPath(): string { return join(__dirname, 'development-mcp-worker.cjs') }
function sendJson(res: ServerResponse, status: number, body: unknown): void { if (!res.headersSent) { const json = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) }); res.end(json) } }
function authorized(req: IncomingMessage, token: string): boolean { return req.headers.authorization === `Bearer ${token}` }
function parseRequestBody(req: IncomingMessage): Promise<unknown> { return new Promise((resolveBody, reject) => { let raw = ''; let size = 0; req.setEncoding('utf8'); req.on('data', (chunk: string) => { size += Buffer.byteLength(chunk); if (size > MAX_BODY_BYTES) { reject(new Error('MCP request body is too large')); req.destroy() } else raw += chunk }); req.on('end', () => { if (!raw) resolveBody(undefined); else { try { resolveBody(JSON.parse(raw)) } catch { reject(new Error('Invalid JSON')) } } }); req.on('error', reject) }) }

function createMcpServer(current: Bridge): Server {
  const server = new Server({ name: 'nexy-development', version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: getDevelopmentMcpToolDefinitions(current.root) }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try { return await callDevelopmentMcpTool(current.root, current.webContents, request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>) }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] } }
  })
  return server
}

async function handleRequest(current: Bridge, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorized(req, current.token)) { sendJson(res, 401, { error: 'Unauthorized' }); return }
  if (req.url !== MCP_PATH) { sendJson(res, 404, { error: 'Not found' }); return }
  let body: unknown; try { body = req.method === 'POST' ? await parseRequestBody(req) : undefined } catch (error) { sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) }); return }
  const sessionId = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : undefined
  let session = sessionId ? current.sessions.get(sessionId) : undefined
  if (!session) {
    if (req.method !== 'POST' || !body || typeof body !== 'object' || (body as { method?: unknown }).method !== 'initialize') { sendJson(res, 400, { error: 'A valid MCP initialize request is required' }); return }
    const server = createMcpServer(current)
    let transport: StreamableHTTPServerTransport
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id): void => { current.sessions.set(id, { server, transport }) } })
    session = { server, transport }; transport.onclose = () => { if (transport.sessionId) current.sessions.delete(transport.sessionId) }; await server.connect(transport)
  }
  try { await session.transport.handleRequest(req, res, body) } catch (error) { sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }) }
}

function connectionFor(current: Bridge): DevelopmentMcpConnection {
  const url = `http://127.0.0.1:${current.port}${MCP_PATH}`
  return { url, token: current.token, command: nodeWorkerCommand(), args: [workerScriptPath()], env: nodeWorkerEnv({ NEXY_DEVELOPMENT_MCP_URL: url, NEXY_DEVELOPMENT_MCP_TOKEN: current.token }) }
}

export async function startDevelopmentMcpBridge(webContents: WebContents): Promise<DevelopmentMcpConnection> {
  const root = validatedDevelopmentWorkspace()
  if (bridge && !bridge.webContents.isDestroyed() && bridge.root === root) return connectionFor(bridge)
  if (bridge) await stopDevelopmentMcpBridge()
  const current = {} as Bridge
  const server = createServer((req, res) => { void handleRequest(current, req, res).catch((error) => sendJson(res, 500, { error: String(error) })) })
  Object.assign(current, { root, token: randomBytes(24).toString('hex'), server, port: 0, webContents, sessions: new Map<string, Session>() })
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { current.port = (server.address() as { port: number }).port; resolveListen() }) })
  bridge = current
  return connectionFor(current)
}

export async function stopDevelopmentMcpBridge(): Promise<boolean> {
  if (!bridge) return false
  const current = bridge; bridge = null
  for (const session of current.sessions.values()) await session.transport.close().catch(() => {})
  current.sessions.clear(); await new Promise<void>((resolveClose) => current.server.close(() => resolveClose()))
  return true
}

export function getDevelopmentMcpStatus(): DevelopmentMcpStatus {
  if (!bridge) { let workspacePath: string | null = null; try { workspacePath = validatedDevelopmentWorkspace() } catch { /* unavailable */ }; return { workspacePath, running: false, url: null, stdio: null } }
  const connection = connectionFor(bridge); return { workspacePath: bridge.root, running: true, url: connection.url, stdio: { command: connection.command, args: connection.args, env: connection.env } }
}

export function notifyDevelopmentMcpToolListChanged(): void { if (bridge) for (const session of bridge.sessions.values()) void session.server.sendToolListChanged().catch(() => {}) }
export function registerDevelopmentMcpHandlers(): void {
  setIsolatedRuntimeToolChangeListener(notifyDevelopmentMcpToolListChanged)
  safeHandle('development:mcp-start', (event) => startDevelopmentMcpBridge(event.sender))
  safeHandle('development:mcp-stop', () => stopDevelopmentMcpBridge())
  safeHandle('development:mcp-status', () => getDevelopmentMcpStatus())
}

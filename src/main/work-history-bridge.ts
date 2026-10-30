import { createServer, type IncomingMessage, type Server } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import { join } from 'path'
import type Database from 'better-sqlite3'
import type { CliMcpServerConfig } from './mcp'
import { nodeWorkerCommand, nodeWorkerEnv } from './node-worker-launch'
import { WORK_HISTORY_CLI_KEY, WORK_HISTORY_ID, WORK_HISTORY_TOOLS, createWorkHistoryHandler, type WorkHistoryToolHandler } from './work-history-mcp'
import type { WorkHistoryExternalAccess } from '../shared/work-history'

const MAX_BODY = 1_000_000

interface BridgeHandle { port: number; token: string; close: () => void }

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
      if (raw.length > MAX_BODY) { reject(new Error('Request body is too large')); req.destroy() }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}') as Record<string, unknown>) } catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function tokenMatches(header: string | string[] | undefined, token: string): boolean {
  if (typeof header !== 'string') return false
  const a = Buffer.from(header), b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Start a loopback bridge that serves the work-history tools to authorised stdio workers. */
export function startWorkHistoryBridge(handler: WorkHistoryToolHandler, onClose?: () => void): Promise<BridgeHandle> {
  const token = randomBytes(32).toString('hex')
  return new Promise((resolve, reject) => {
    const server: Server = createServer(async (req, res) => {
      const send = (status: number, value: unknown) => {
        const body = JSON.stringify(value)
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
        res.end(body)
      }
      // Reject browser-originated requests outright; only the worker talks to this port.
      if (req.method !== 'POST' || req.headers.origin || !tokenMatches(req.headers['x-bridge-token'], token)) return send(403, { error: 'Forbidden' })
      try {
        const body = await readJson(req)
        if (req.url === '/tools') return send(200, { tools: WORK_HISTORY_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
        if (req.url !== '/call') return send(404, { error: 'Not found' })
        const args = typeof body.args === 'object' && body.args !== null ? body.args as Record<string, unknown> : {}
        return send(200, await handler(String(body.toolName ?? ''), args))
      } catch (error) {
        send(400, { success: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Failed to start work history bridge')); return }
      resolve({ port: address.port, token, close: () => { server.closeAllConnections?.(); server.close(); onClose?.() } })
    })
  })
}

export function workHistoryWorkerConfig(port: number, token: string): CliMcpServerConfig {
  return {
    id: WORK_HISTORY_ID, key: WORK_HISTORY_CLI_KEY, command: nodeWorkerCommand(),
    args: [join(__dirname, 'work-history-mcp-worker.cjs')],
    env: nodeWorkerEnv({ NEXY_WH_BRIDGE_PORT: String(port), NEXY_WH_BRIDGE_TOKEN: token }),
  }
}

// ── In-Nexy chats: always available, granted per chat through the capability picker ──
let internal: BridgeHandle | null = null

export async function startInternalWorkHistoryBridge(handler: WorkHistoryToolHandler): Promise<void> {
  if (!internal) internal = await startWorkHistoryBridge(handler)
}

export function getWorkHistoryCliConfig(): CliMcpServerConfig | null {
  return internal ? workHistoryWorkerConfig(internal.port, internal.token) : null
}

// ── External terminal sessions: explicit opt-in, revoked on stop or app exit ──
let external: (BridgeHandle & { startedAt: number }) | null = null

function setupSnippets(config: CliMcpServerConfig): WorkHistoryExternalAccess['setup'] {
  const env = config.env ?? {}
  const json = JSON.stringify({ type: 'stdio', command: config.command, args: config.args, env })
  const quote = (value: string) => JSON.stringify(value)
  const inlineEnv = Object.entries(env).map(([key, value]) => `${key} = ${quote(value)}`).join(', ')
  const yamlEnv = Object.entries(env).map(([key, value]) => `      ${key}: ${quote(value)}`).join('\n')
  return {
    claude: `claude mcp add-json nexy-work-history '${json}'`,
    codex: `[mcp_servers.nexy_work_history]\ncommand = ${quote(config.command)}\nargs = [${config.args.map(quote).join(', ')}]\nenv = { ${inlineEnv} }
# Codex asks before each MCP tool call; \`codex exec\` cannot ask, so approve this server's tools there.
default_tools_approval_mode = "approve"`,
    hermes: `mcp_servers:\n  nexy_work_history:\n    command: ${quote(config.command)}\n    args: [${config.args.map(quote).join(', ')}]\n    env:\n${yamlEnv}`,
  }
}

export function getExternalWorkHistoryAccess(): WorkHistoryExternalAccess {
  if (!external) return { enabled: false, startedAt: null, setup: null }
  return { enabled: true, startedAt: external.startedAt, setup: setupSnippets(workHistoryWorkerConfig(external.port, external.token)) }
}

export async function enableExternalWorkHistoryAccess(db: Database.Database): Promise<WorkHistoryExternalAccess> {
  // Every enable issues a fresh port and token, so earlier setups stop working.
  disableExternalWorkHistoryAccess()
  const handler = createWorkHistoryHandler(db)
  const bridge = await startWorkHistoryBridge(handler, () => handler.selections.close())
  external = { ...bridge, startedAt: Date.now() }
  return getExternalWorkHistoryAccess()
}

export function disableExternalWorkHistoryAccess(): WorkHistoryExternalAccess {
  external?.close()
  external = null
  return getExternalWorkHistoryAccess()
}

export function stopWorkHistoryBridges(): void {
  disableExternalWorkHistoryAccess()
  internal?.close()
  internal = null
}

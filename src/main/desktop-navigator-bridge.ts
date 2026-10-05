import { createServer, type Server as HttpServer } from 'http'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { DESKTOP_NAVIGATOR_ID, DESKTOP_NAVIGATOR_TOOLS } from './desktop-navigator-mcp'
import type { CliMcpServerConfig } from './mcp'
import { nodeWorkerCommand, nodeWorkerEnv } from './node-worker-launch'

type ToolResult = {
  success: boolean
  result?: string
  images?: { dataUrl: string; mimeType: string }[]
  error?: string
}

type InProcessHandler = (toolName: string, args: Record<string, unknown>) => Promise<ToolResult>

const BRIDGE_KEY = 'desktop_navigator'

let httpServer: HttpServer | null = null
let bridgePort: number | null = null
let bridgeSecret: string | null = null
let registeredHandler: InProcessHandler | null = null

function workerScriptPath(): string {
  // electron-vite copies non-TS files from src/main to dist/main at build time.
  // __dirname in the main process bundle is always dist/main/.
  return join(__dirname, 'desktop-navigator-bridge-worker.cjs')
}

function parseBody(req: import('http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString() })
    req.on('end', () => {
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

export async function startDesktopNavigatorBridge(handler: InProcessHandler): Promise<void> {
  registeredHandler = handler

  if (httpServer !== null) return // already running

  const secret = randomBytes(16).toString('hex')
  bridgeSecret = secret

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      // Validate secret header to prevent any other process on the machine
      // from invoking desktop automation via the loopback port.
      if (req.headers['x-bridge-secret'] !== secret) {
        res.writeHead(403)
        res.end()
        return
      }

      const send = (status: number, body: unknown) => {
        const json = JSON.stringify(body)
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(json)
      }

      try {
        const body = await parseBody(req)

        if (req.url === '/tools') {
          send(200, { tools: DESKTOP_NAVIGATOR_TOOLS })
          return
        }

        if (req.url === '/call') {
          const { toolName, args } = body as { toolName: string; args: Record<string, unknown> }
          if (!registeredHandler) {
            send(503, { error: 'Handler not registered' })
            return
          }
          const result = await registeredHandler(String(toolName), args ?? {})
          send(200, result)
          return
        }

        res.writeHead(404)
        res.end()
      } catch (err) {
        send(500, { error: err instanceof Error ? err.message : String(err) })
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      bridgePort = addr.port
      httpServer = server
      resolve()
    })

    server.on('error', (err) => {
      httpServer = null
      bridgePort = null
      reject(err)
    })
  })
}

export function stopDesktopNavigatorBridge(): void {
  httpServer?.close()
  httpServer = null
  bridgePort = null
  bridgeSecret = null
}

/**
 * Returns a CliMcpServerConfig for Desktop Navigator that points the CLI at
 * the bridge worker script. The worker connects back to the HTTP loopback
 * server in Nexy's main process to execute tools.
 *
 * Returns null if the bridge has not been started yet.
 */
export function getDesktopNavigatorCliConfig(): CliMcpServerConfig | null {
  if (bridgePort === null || bridgeSecret === null) return null

  return {
    id: DESKTOP_NAVIGATOR_ID,
    key: BRIDGE_KEY,
    command: nodeWorkerCommand(), // the Electron binary, run as Node
    args: [workerScriptPath()],
    env: nodeWorkerEnv({
      NEXY_DN_BRIDGE_PORT: String(bridgePort),
      NEXY_DN_BRIDGE_SECRET: bridgeSecret,
    }),
  }
}

export { BRIDGE_KEY }

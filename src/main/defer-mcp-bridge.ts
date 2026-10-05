import { createServer, type Server } from 'http'
import { randomBytes, randomUUID } from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { nodeWorkerCommand, nodeWorkerEnv } from './node-worker-launch'
import { createDeferredCallback, resolveDeferredCallback } from './deferred-callbacks'

/**
 * Per-CLI-turn bridge giving the agent a Nexy-owned alternative to a raw background shell
 * command: `run_and_notify` spawns the command, arms a `deferred_callbacks` row bound to the
 * turn's conversation, and returns immediately with a handle. The row (not this bridge, which
 * dies with the turn) is what survives the app restarting or the session ending — the actual
 * completion is reported by `resolveDeferredCallback` from the child's own 'close' handler,
 * which fires whenever the app is next alive to run it.
 */

export interface DeferMcpBridgeOptions {
  conversationId: string
  /** Default working directory when the tool call omits its own `cwd`. */
  cwd: string
  agentId?: string | null
  projectId?: string | null
  /** How deep in a fire→re-arm chain this turn already is (see MAX_CHAIN_DEPTH). */
  chainDepth?: number
}

export interface DeferMcpBridge {
  server: { id: string; key: string; command: string; args: string[]; env: Record<string, string>; cwd?: string }
  allowedTool: string
  close: () => void
}

// Keeps a chatty command's output usable as a report without blowing up the woken turn's context
// (renderDeferredPrompt caps the overall prompt separately; this bounds what gets built into it).
const MAX_OUTPUT_CHARS = 8_000

function readJson(req: import('http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
      if (raw.length > 1_000_000) reject(new Error('Request body is too large'))
    })
    req.on('end', () => {
      try { resolve(JSON.parse(raw) as Record<string, unknown>) }
      catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

/**
 * Best-effort termination of the whole process tree, mirroring build-runner's cancellation
 * approach: on Windows a `spawn(..., shell: true)` command runs under a cmd.exe wrapper, so only
 * `taskkill /T` reliably takes the real work with it. On POSIX the child is spawned detached as
 * its own process-group leader for the same reason.
 */
function killTree(child: ChildProcess): void {
  if (child.pid == null) {
    child.kill('SIGTERM')
    return
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref()
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
}

export function startDeferMcpBridge(options: DeferMcpBridgeOptions): Promise<DeferMcpBridge> {
  const secret = randomBytes(24).toString('hex')
  return new Promise((resolve, reject) => {
    const server: Server = createServer(async (req, res) => {
      const send = (status: number, value: unknown) => {
        const body = JSON.stringify(value)
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
        res.end(body)
      }
      if (req.headers['x-bridge-secret'] !== secret) return send(403, { error: 'Forbidden' })
      try {
        const body = await readJson(req)
        if (req.url === '/tools') {
          return send(200, { tools: [{
            name: 'run_and_notify',
            description:
              'Run a shell command that may take longer than a normal reply (a build, a long test suite, ' +
              'a slow install) instead of waiting on it directly. Nexy tracks the process and posts the ' +
              'result into this conversation as soon as it finishes — even if this session ends or Nexy ' +
              'restarts in the meantime. Returns immediately with a handle; do not poll for the result ' +
              "yourself and do not promise to 'check back later' — Nexy delivers it.",
            inputSchema: {
              type: 'object',
              required: ['command', 'label'],
              properties: {
                command: { type: 'string', description: 'Shell command to run.' },
                cwd: { type: 'string', description: 'Working directory; defaults to the current project directory.' },
                label: { type: 'string', description: 'Short human-readable description of the job, shown when the result is reported.' },
                timeoutMs: { type: 'number', description: 'Optional hard timeout in milliseconds; the process is killed and reported as timed out if it runs longer.' },
              },
            },
          }] })
        }
        if (req.url !== '/call') return send(404, { error: 'Not found' })
        if (body.toolName !== 'run_and_notify') return send(400, { success: false, error: 'Unknown defer bridge tool' })

        const args = typeof body.args === 'object' && body.args !== null ? body.args as Record<string, unknown> : {}
        const command = typeof args.command === 'string' ? args.command.trim() : ''
        if (!command) return send(200, { success: false, error: 'A non-empty command is required.' })
        const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim() : command.slice(0, 80)
        const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : options.cwd
        const timeoutMs = typeof args.timeoutMs === 'number' && args.timeoutMs > 0 ? args.timeoutMs : undefined

        const triggerRef = randomUUID()
        const child = spawn(command, {
          shell: true,
          cwd,
          detached: process.platform !== 'win32',
        })

        let created
        try {
          created = createDeferredCallback({
            conversationId: options.conversationId,
            triggerKind: 'process',
            triggerRef,
            label,
            pid: child.pid ?? null,
            projectId: options.projectId ?? null,
            agentId: options.agentId ?? null,
            chainDepth: options.chainDepth ?? 0,
            timeoutMs,
          })
        } catch (error) {
          // No binding means no one will ever hear this process finish — leaving it running would
          // be a silent leaked job, so it must die with the rejected request.
          killTree(child)
          return send(200, { success: false, error: error instanceof Error ? error.message : String(error) })
        }

        let output = ''
        const append = (chunk: Buffer) => {
          output += chunk.toString('utf8')
          if (output.length > MAX_OUTPUT_CHARS) output = output.slice(-MAX_OUTPUT_CHARS)
        }
        child.stdout?.on('data', append)
        child.stderr?.on('data', append)

        let timedOut = false
        const timer = timeoutMs
          ? setTimeout(() => {
              timedOut = true
              killTree(child)
            }, timeoutMs)
          : null

        const reportResolutionFailure = (): void => {
          /* the child has already exited; a failure to reach the resolver must not surface here */
        }

        child.on('close', (code) => {
          if (timer) clearTimeout(timer)
          const status: 'success' | 'failure' | 'timeout' = timedOut ? 'timeout' : code === 0 ? 'success' : 'failure'
          void resolveDeferredCallback('process', triggerRef, {
            status,
            exitCode: code ?? null,
            detail: output.trim() || undefined,
          }).catch(reportResolutionFailure)
        })

        child.on('error', (error) => {
          if (timer) clearTimeout(timer)
          void resolveDeferredCallback('process', triggerRef, {
            status: 'failure',
            exitCode: null,
            detail: error.message,
          }).catch(reportResolutionFailure)
        })

        return send(200, {
          success: true,
          result:
            `Started "${label}" (pid ${child.pid ?? 'unknown'}), tracked as ${created.id}. I'll post the result ` +
            'into this conversation when it exits — including if Nexy restarts while it is running. ' +
            'Continue with other work; do not wait on this.',
        })
      } catch (error) {
        send(500, { success: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to start defer MCP bridge'))
        return
      }
      resolve({
        server: {
          id: 'nexy-defer',
          key: 'nexy_defer',
          command: nodeWorkerCommand(),
          args: [join(__dirname, 'defer-mcp-worker.cjs')],
          env: nodeWorkerEnv({ NEXY_DEFER_BRIDGE_PORT: String(address.port), NEXY_DEFER_BRIDGE_SECRET: secret }),
        },
        allowedTool: 'mcp__nexy_defer__run_and_notify',
        close: () => server.close(),
      })
    })
  })
}

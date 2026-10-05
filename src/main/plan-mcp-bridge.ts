import { createServer, type Server } from 'http'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { nodeWorkerCommand, nodeWorkerEnv } from './node-worker-launch'

export interface PlanMcpBridge {
  server: { id: string; key: string; command: string; args: string[]; env: Record<string, string>; cwd?: string }
  allowedTool: string
  /** The most recently submitted plan, retained for tool-only Claude responses. */
  submittedPlan: () => string | null
  close: () => void
}

function readJson(req: import('http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    req.on('end', () => {
      try { resolve(JSON.parse(raw) as Record<string, unknown>) }
      catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

/**
 * Per-turn Plan-mode completion bridge for Claude's non-interactive --print sessions.
 * Unlike Claude's native ExitPlanMode tool, this MCP tool is available in strict MCP mode.
 */
export function startPlanMcpBridge(requestPlanApproval: (plan: string) => Promise<boolean>): Promise<PlanMcpBridge> {
  const secret = randomBytes(24).toString('hex')
  let submittedPlan: string | null = null
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
            name: 'exit_plan_mode',
            description: 'Submit the completed Markdown implementation plan to Nexy for approval. Call this only when the plan is complete and ready to implement.',
            inputSchema: {
              type: 'object', required: ['plan'], properties: {
                plan: { type: 'string', minLength: 1, description: 'The complete Markdown implementation plan.' },
              },
            },
          }] })
        }
        if (req.url !== '/call') return send(404, { error: 'Not found' })
        if (body.toolName !== 'exit_plan_mode') return send(400, { success: false, error: 'Unknown plan bridge tool' })
        const args = typeof body.args === 'object' && body.args !== null ? body.args as Record<string, unknown> : {}
        const plan = typeof args.plan === 'string' ? args.plan.trim() : ''
        if (!plan) return send(200, { success: false, error: 'A non-empty Markdown plan is required.' })
        submittedPlan = plan
        const approved = await requestPlanApproval(plan)
        return send(200, approved
          ? { success: true, result: 'Plan approved. Nexy will start a new implementation turn after this planning turn ends.' }
          : { success: false, error: 'Plan was not approved. Stay in Plan mode and refine it if needed.' })
      } catch (error) {
        send(500, { success: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to start plan MCP bridge'))
        return
      }
      resolve({
        server: {
          id: 'nexy-plan', key: 'nexy_plan', command: nodeWorkerCommand(),
          args: [join(__dirname, 'plan-mcp-worker.cjs')],
          env: nodeWorkerEnv({ NEXY_PLAN_BRIDGE_PORT: String(address.port), NEXY_PLAN_BRIDGE_SECRET: secret }),
        },
        allowedTool: 'mcp__nexy_plan__exit_plan_mode',
        submittedPlan: () => submittedPlan,
        close: () => server.close(),
      })
    })
  })
}

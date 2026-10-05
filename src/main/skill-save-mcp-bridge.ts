import { createServer, type Server } from 'http'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { nodeWorkerCommand, nodeWorkerEnv } from './node-worker-launch'
import type { SkillCaptureInput } from './skill-service'
import { captureSkill, prepareSkillCapture, type PersistedSkillCapture } from './skill-service'

export interface SkillSaveMcpBridge {
  server: { id: string; key: string; command: string; args: string[]; env: Record<string, string> }
  allowedTool: string
  close: () => void
}

type ApprovalRequest = (name: string, args: Record<string, unknown>) => Promise<boolean>
type SkillSavedCallback = (result: PersistedSkillCapture) => void

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
 * Starts a per-CLI-turn, loopback-only MCP server. The worker has no persistence access;
 * it forwards the validated tool request here, where Nexy owns approval and the database.
 */
export function startSkillSaveMcpBridge(
  requestApproval: ApprovalRequest,
  onSaved?: SkillSavedCallback,
  onWaitingChange?: (waiting: boolean) => void,
): Promise<SkillSaveMcpBridge> {
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
            name: 'save_skill',
            description: 'Save a reusable skill to the Nexy skill library. Always requires user approval.',
            inputSchema: {
              type: 'object',
              properties: {
                markdown: { type: 'string', description: 'Complete SKILL.md document; takes precedence over structured fields.' },
                name: { type: 'string' },
                description: { type: 'string' },
                instructions: { type: 'string' },
                icon: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
              },
            },
          }] })
        }
        if (req.url !== '/call') return send(404, { error: 'Not found' })
        if (body.toolName !== 'save_skill') return send(400, { success: false, error: 'Unknown skill bridge tool' })

        const args = typeof body.args === 'object' && body.args !== null
          ? body.args as Record<string, unknown>
          : {}
        const prepared = prepareSkillCapture(args as SkillCaptureInput)
        if ('error' in prepared) return send(200, { success: false, error: prepared.error })

        onWaitingChange?.(true)
        try {
          const approved = await requestApproval(prepared.name, args)
          if (!approved) return send(200, { success: false, error: 'User declined saving the skill' })

          const result = captureSkill(args as SkillCaptureInput)
          if ('error' in result) return send(200, { success: false, error: result.error })
          onSaved?.(result)
          return send(200, {
            success: true,
            result: `${result.created ? 'Created' : 'Updated'} skill "${prepared.name}" (id: ${result.skill.id}) in the Nexy skill library.`,
          })
        } finally {
          onWaitingChange?.(false)
        }
      } catch (error) {
        send(500, { success: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to start skill-save MCP bridge'))
        return
      }
      resolve({
        server: {
          id: 'nexy-skill-save',
          key: 'nexy_skill',
          command: nodeWorkerCommand(),
          args: [join(__dirname, 'skill-save-mcp-worker.cjs')],
          env: nodeWorkerEnv({ NEXY_SKILL_BRIDGE_PORT: String(address.port), NEXY_SKILL_BRIDGE_SECRET: secret }),
        },
        allowedTool: 'mcp__nexy_skill__save_skill',
        close: () => server.close(),
      })
    })
  })
}

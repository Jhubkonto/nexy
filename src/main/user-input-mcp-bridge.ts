import { createServer, type Server } from 'http'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { nodeWorkerCommand, nodeWorkerEnv } from './node-worker-launch'
import type { UserInputAnswer, UserInputQuestion } from '../shared/chat-turn-types'
import { userInputQuestionsFromArgs } from './user-input'

export interface UserInputMcpBridge {
  server: { id: string; key: string; command: string; args: string[]; env: Record<string, string>; cwd?: string }
  allowedTool: string
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

export function startUserInputMcpBridge(
  requestUserInput: (questions: UserInputQuestion[]) => Promise<UserInputAnswer[]>,
  onWaitingChange?: (waiting: boolean) => void,
): Promise<UserInputMcpBridge> {
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
            name: 'ask_user',
            description: 'Ask the user necessary clarification questions and wait for an answer.',
            inputSchema: {
              type: 'object', required: ['questions'], properties: {
                questions: { type: 'array', minItems: 1, items: { type: 'object', required: ['id', 'prompt'], properties: {
                  id: { type: 'string' }, header: { type: 'string' }, prompt: { type: 'string' },
                  selection: { type: 'string', enum: ['single', 'multiple'] }, allowFreeText: { type: 'boolean' },
                  options: { type: 'array', items: { type: 'object', required: ['id', 'label'], properties: {
                    id: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' },
                  } } },
                } } },
              },
            },
          }] })
        }
        if (req.url !== '/call') return send(404, { error: 'Not found' })
        const args = typeof body.args === 'object' && body.args !== null ? body.args as Record<string, unknown> : {}
        const questions = userInputQuestionsFromArgs(args)
        if (questions.length === 0) return send(400, { success: false, error: 'At least one valid question is required.' })
        onWaitingChange?.(true)
        try {
          const answers = await requestUserInput(questions)
          return send(200, { success: true, result: JSON.stringify({ answers }) })
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
        reject(new Error('Failed to start user-input MCP bridge'))
        return
      }
      resolve({
        server: {
          id: 'nexy-user-input', key: 'nexy_user_input', command: nodeWorkerCommand(),
          args: [join(__dirname, 'user-input-mcp-worker.cjs')],
          env: nodeWorkerEnv({ NEXY_UI_BRIDGE_PORT: String(address.port), NEXY_UI_BRIDGE_SECRET: secret }),
        },
        allowedTool: 'mcp__nexy_user_input__ask_user',
        close: () => server.close(),
      })
    })
  })
}

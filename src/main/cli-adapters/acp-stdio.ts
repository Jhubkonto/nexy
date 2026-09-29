import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createLineBuffer, killProcess } from './utils'

type JsonRpcMessage = {
  jsonrpc?: string
  id?: string | number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string }
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

const MAX_FRAME_BYTES = 4 * 1024 * 1024

export class AcpStdioConnection {
  private readonly process: ChildProcessWithoutNullStreams
  private readonly pending = new Map<string | number, Pending>()
  private nextId = 1
  private closed = false
  private stderr = ''
  private readonly onNotification: (message: JsonRpcMessage) => void
  private readonly onRequest: (message: JsonRpcMessage) => Promise<unknown>

  constructor(
    executable: string,
    args: string[],
    cwd: string,
    onNotification: (message: JsonRpcMessage) => void,
    onRequest: (message: JsonRpcMessage) => Promise<unknown>,
    env?: NodeJS.ProcessEnv,
  ) {
    this.onNotification = onNotification
    this.onRequest = onRequest
    this.process = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const lines = createLineBuffer((line) => this.handleLine(line))
    this.process.stdout.on('data', (chunk: Buffer) => {
      if (Buffer.byteLength(lines.remainder()) + Buffer.byteLength(chunk) > MAX_FRAME_BYTES) {
        this.fail(new Error('Hermes ACP message exceeded the 4 MiB limit'))
        return
      }
      lines.push(chunk)
    })
    this.process.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-8192)
    })
    this.process.once('error', (error) => this.fail(error))
    this.process.once('close', (code, signal) => {
      if (!this.closed) {
        this.fail(new Error(`Hermes ACP exited (${code ?? 'null'}${signal ? `, ${signal}` : ''})${this.stderr.trim() ? `: ${this.stderr.trim()}` : ''}`))
      }
    })
  }

  /** Recent stderr tail from the Hermes process — surfaced in diagnostics so a timeout is not a
   *  bare "timed out" with no explanation of what the agent was doing when it stalled. */
  recentStderr(): string {
    return this.stderr.trim()
  }

  request(method: string, params: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
    if (this.closed || this.process.stdin.destroyed) return Promise.reject(new Error('Hermes ACP connection is closed'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        const tail = this.stderr.trim().slice(-800)
        reject(new Error(`Hermes ACP request timed out: ${method}${tail ? ` — recent output: ${tail}` : ''}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: Record<string, unknown>): void {
    if (!this.closed) this.write({ jsonrpc: '2.0', method, params })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Hermes ACP connection closed'))
    }
    this.pending.clear()
    if (!this.process.killed) {
      this.process.stdin.end()
      setTimeout(() => {
        if (!this.process.killed) killProcess(this.process)
      }, 500)
    }
  }

  private write(message: JsonRpcMessage): void {
    if (this.closed || this.process.stdin.destroyed || this.process.stdin.writableEnded) return
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleLine(line: string): void {
    if (!line.trim()) return
    let message: JsonRpcMessage
    try {
      message = JSON.parse(line) as JsonRpcMessage
    } catch {
      // A single non-JSON line (a stray warning/banner a library wrote to stdout instead
      // of stderr) must not tear down the whole connection — the JSONL adapters tolerate
      // junk lines the same way. Skip it; genuine protocol failures still surface via
      // request timeouts, the frame-size cap, and process exit.
      return
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(message.error.message ?? 'Hermes ACP request failed'))
      else pending.resolve(message.result)
      return
    }
    if (message.id !== undefined && message.method) {
      void this.onRequest(message).then(
        (result) => this.write({ jsonrpc: '2.0', id: message.id, result }),
        (error: unknown) => this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }),
      )
      return
    }
    if (message.method) this.onNotification(message)
  }

  private fail(error: Error): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    // Tree-kill (not bare process.kill) so that if Hermes ever spawns tool subprocesses of
    // its own, the failure path reaps the whole tree on Windows — matching close()'s cleanup.
    try { killProcess(this.process) } catch { /* already exited */ }
  }
}

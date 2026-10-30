import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { buildCliChildEnv, killProcess, resolveCliPath } from './cli-adapters/utils'

/** Accept only an explicitly completed, tool-free Claude CLI response. */
export function parseHistoryClaudeResponse(output: string): { content: string; finishReason: string } {
  let result: Record<string, unknown>
  try { result = JSON.parse(output) as Record<string, unknown> } catch { throw new Error('Claude CLI returned invalid JSON') }
  if (result.type !== 'result' || result.subtype !== 'success' || result.is_error || typeof result.result !== 'string') {
    throw new Error('Claude CLI did not complete the report request successfully')
  }
  if (result.stop_reason !== 'end_turn') throw new Error(`Claude CLI did not confirm a complete response${typeof result.stop_reason === 'string' ? `: ${result.stop_reason}` : ''}`)
  return { content: result.result, finishReason: 'end_turn' }
}

export function runHistoryClaude(model: string, system: string, prompt: string, signal: AbortSignal): Promise<{ content: string; finishReason: string }> {
  const path = resolveCliPath('claude')
  if (!path) return Promise.reject(new Error('Claude CLI was not found'))
  if (signal.aborted) return Promise.reject(new Error('Cancelled'))
  return new Promise((resolve, reject) => {
    // Unknown options cause older CLI versions to fail closed. Safe mode also disables
    // hooks, plugins, and user configuration; strict MCP and an empty tool set are explicit.
    const args = ['--print', '--output-format', 'json', '--safe-mode', '--strict-mcp-config', '--tools', '', '--disable-slash-commands', '--no-session-persistence', '--system-prompt', system]
    if (model && model !== 'default') args.push('--model', model)
    const proc = spawn(path, args, { cwd: tmpdir(), env: buildCliChildEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', settled = false
    const finish = (error?: Error, value?: { content: string; finishReason: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(value!)
    }
    const abort = () => { killProcess(proc); finish(new Error('Cancelled')) }
    const timer = setTimeout(() => { killProcess(proc); finish(new Error('Claude CLI timed out')) }, 300_000)
    signal.addEventListener('abort', abort, { once: true })
    proc.on('error', error => finish(error))
    proc.stdin.on('error', () => { /* close/error reports the subprocess failure */ })
    proc.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > 2_000_000) { killProcess(proc); finish(new Error('Claude CLI response was too large')) }
    })
    proc.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })
    proc.on('close', code => {
      if (code !== 0) return finish(new Error(`Claude CLI failed${stderr.trim() ? `: ${stderr.trim().slice(0, 500)}` : ` (exit ${code})`}`))
      try { finish(undefined, parseHistoryClaudeResponse(stdout)) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    })
    proc.stdin.end(prompt)
  })
}

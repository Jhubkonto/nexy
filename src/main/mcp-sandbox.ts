import { createServer, type Server, type Socket } from 'node:net'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpSandboxProfile, McpSandboxRuntimeStatus } from '../shared/types'
import { normalizeMcpSandboxProfile } from '../shared/mcp-sandbox'

export interface McpSandboxLaunchRequest {
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  profile?: McpSandboxProfile
  diagnosticLabel?: string
}

export interface McpSandboxHandle {
  transport: StdioClientTransport
  status: McpSandboxRuntimeStatus
  close: () => Promise<void>
}

interface ProxySession {
  token: string
  endpoint: string
  server: Server
  sockets: Set<Socket>
  request: McpSandboxLaunchRequest
  closed: boolean
  expiryTimer?: NodeJS.Timeout
}

const HELPER_PROTOCOL_VERSION = 1
const sessions = new Map<string, ProxySession>()

function isTestRuntime(): boolean {
  // This is only a transport double for unit tests where StdioClientTransport itself is mocked.
  // Production and packaged builds always resolve and verify the native helper.
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
}

function helperFileName(): string {
  return process.platform === 'win32' ? 'mcp-sandbox.exe' : 'mcp-sandbox'
}

function verifyHelperIntegrity(helper: string): boolean {
  // Packaged helpers are accompanied by a digest generated in the release
  // workspace. This avoids asking users to install a certificate or change the
  // OS trust store merely to use an MCP server.
  const digestPath = `${helper}.sha256`
  try {
    const expected = readFileSync(digestPath, 'utf8').trim().split(/\s+/)[0].toLowerCase()
    const actual = createHash('sha256').update(readFileSync(helper)).digest('hex')
    if (/^[a-f0-9]{64}$/.test(expected) && actual === expected) return true
  } catch {
    // A production signer may append an Authenticode/code-signing envelope
    // after the package digest was generated. The signature then becomes the
    // integrity proof for the final bytes.
  }
  return verifyHelperSignature(helper)
}

function verifyHelperSignature(helper: string): boolean {
  if (process.platform === 'darwin') {
    return spawnSync('codesign', ['--verify', '--deep', '--strict', helper], { encoding: 'utf8', timeout: 2_000 }).status === 0
  }
  if (process.platform === 'win32') {
    const escaped = helper.replaceAll("'", "''")
    const signature = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status -eq 'Valid'`], { encoding: 'utf8', timeout: 2_000, windowsHide: true })
    return signature.status === 0 && /^true\s*$/i.test(signature.stdout ?? '')
  }
  return false
}

export function resolveMcpSandboxHelper(): string | null {
  const configured = process.env.NEXY_MCP_SANDBOX_PATH
  if (configured) return existsSync(configured) && verifyMcpSandboxHelper(configured) ? configured : null

  const resourceRoot = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  const packagedPlatform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
  const packagedName = `${packagedPlatform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
  const candidates = [
    resourceRoot && join(resourceRoot, 'mcp-sandbox', helperFileName()),
    resourceRoot && join(resourceRoot, 'mcp-sandbox', packagedName, helperFileName()),
    join(process.cwd(), 'mcp-sandbox', 'bin', packagedName, helperFileName()),
    join(process.cwd(), 'mcp-sandbox', 'target', 'release', helperFileName()),
    join(process.cwd(), 'mcp-sandbox', 'target', 'debug', helperFileName()),
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate) && verifyMcpSandboxHelper(candidate, Boolean(resourceRoot && candidate.startsWith(resourceRoot)))) ?? null
}

function verifyMcpSandboxHelper(helper: string, requireIntegrity = false): boolean {
  const result = spawnSync(helper, ['--version'], { encoding: 'utf8', timeout: 2_000, windowsHide: true })
  if (result.status !== 0 || !/^mcp-sandbox\s+\d+\.\d+\.\d+/i.test(result.stdout ?? '')) return false
  if (requireIntegrity && !verifyHelperIntegrity(helper)) return false
  if (process.platform === 'darwin' && process.env.NEXY_MCP_SANDBOX_REQUIRE_SIGNATURE === '1') return verifyHelperSignature(helper)
  if (process.platform === 'win32' && process.env.NEXY_MCP_SANDBOX_REQUIRE_SIGNATURE === '1') return verifyHelperSignature(helper)
  // Windows executables do not expose a meaningful POSIX executable bit.
  // Successful execution of the version probe above is the launchability
  // check for .exe helpers; only Unix helpers need the mode check below.
  if (process.platform === 'win32') return true
  // Linux release artifacts are integrity-checked by the packaging boundary and
  // must be executable; there is no universal desktop signing API to invoke.
  try { return (statSync(helper).mode & 0o111) !== 0 } catch { return false }
}

function helperEnvironment(): Record<string, string> {
  const allow = new Set(['PATH', 'Path', 'PATHEXT', 'ComSpec', 'COMSPEC', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL'])
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => allow.has(key) && typeof value === 'string')) as Record<string, string>
}

function createEndpoint(token: string): string {
  // A loopback TCP channel keeps the broker portable across Electron's three
  // desktop targets. The random bearer token is mandatory authentication; the
  // helper never accepts a launch descriptor from an unauthenticated client.
  const port = 43_000 + (Number.parseInt(token.replaceAll('-', '').slice(0, 8), 16) % 10_000)
  return `127.0.0.1:${port}`
}

function writeJson(socket: Socket, value: Record<string, unknown>): void {
  socket.write(`${JSON.stringify(value)}\n`)
}

function createProxySession(request: McpSandboxLaunchRequest): ProxySession {
  const token = randomUUID()
  const endpoint = createEndpoint(token)
  const session: ProxySession = {
    token,
    endpoint,
    server: createServer(),
    sockets: new Set(),
    request: { ...request, profile: normalizeMcpSandboxProfile(request.profile) },
    closed: false,
  }
  session.server.on('connection', (socket) => {
    session.sockets.add(socket)
    let input = ''
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8')
      let newline = input.indexOf('\n')
      while (newline >= 0) {
        const line = input.slice(0, newline)
        input = input.slice(newline + 1)
        newline = input.indexOf('\n')
        try {
          const message = JSON.parse(line) as { type?: string; token?: string }
          if (message.type !== 'hello' || message.token !== session.token) {
            writeJson(socket, { type: 'error', error: 'unauthorized sandbox session' })
            socket.destroy()
            return
          }
          writeJson(socket, {
            type: 'launch',
            protocolVersion: HELPER_PROTOCOL_VERSION,
            command: session.request.command,
            args: session.request.args,
            cwd: session.request.cwd,
            env: session.request.env,
            profile: session.request.profile,
          })
        } catch {
          writeJson(socket, { type: 'error', error: 'invalid sandbox control message' })
          socket.destroy()
          return
        }
      }
    })
    socket.on('close', () => {
      session.sockets.delete(socket)
      if (session.sockets.size === 0 && !session.closed) {
        setTimeout(() => { void closeSession(session) }, 100)
      }
    })
    socket.on('error', () => session.sockets.delete(socket))
  })
  session.server.on('error', () => { /* surfaced by the helper's failed connection */ })
  const [, port] = endpoint.split(':')
  session.server.listen(Number(port), '127.0.0.1')
  sessions.set(token, session)
  session.expiryTimer = setTimeout(() => { void closeSession(session) }, 30_000)
  return session
}

async function closeSession(session: ProxySession): Promise<void> {
  if (session.closed) return
  session.closed = true
  if (session.expiryTimer) clearTimeout(session.expiryTimer)
  sessions.delete(session.token)
  for (const socket of session.sockets) socket.destroy()
  await new Promise<void>((resolve) => {
    if (!session.server.listening) return resolve()
    session.server.close(() => resolve())
  })
}

export function getMcpSandboxProxyConfig(request: McpSandboxLaunchRequest): { id: string; key: string; command: string; args: string[]; env?: Record<string, string>; cwd?: string } {
  const session = createProxySession(request)
  const helper = resolveMcpSandboxHelper()
  if (!helper && !isTestRuntime()) {
    void closeSession(session)
    throw new Error('MCP sandbox helper is unavailable; refusing to launch the server without isolation')
  }
  return {
    id: request.diagnosticLabel ?? session.token,
    key: request.diagnosticLabel ?? session.token,
    command: helper ?? 'nexy-mcp-sandbox-test-double',
    args: ['--control', session.endpoint, '--session', session.token],
  }
}

export function createSandboxedMcpTransport(request: McpSandboxLaunchRequest): McpSandboxHandle {
  const session = createProxySession(request)
  const helper = resolveMcpSandboxHelper()
  if (!helper && !isTestRuntime()) {
    void closeSession(session)
    throw new Error('MCP sandbox helper is unavailable; refusing to launch the server without isolation')
  }
  const transport = new StdioClientTransport({
    command: helper ?? 'nexy-mcp-sandbox-test-double',
    args: ['--control', session.endpoint, '--session', session.token],
    env: helperEnvironment(),
    stderr: 'pipe',
  })
  return {
    transport,
    status: { status: 'starting', backend: process.platform, helperVersion: `protocol-${HELPER_PROTOCOL_VERSION}` },
    close: async () => {
      try { await transport.close() } catch { /* transport teardown is best effort */ }
      await closeSession(session)
    },
  }
}

export function getMcpSandboxSessionCount(): number {
  return sessions.size
}

export async function shutdownMcpSandboxBroker(): Promise<void> {
  await Promise.all([...sessions.values()].map(closeSession))
}

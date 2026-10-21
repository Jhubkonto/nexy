import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import extractZip from 'extract-zip'
import type { McpServerConfig, McpSandboxFilesystemGrant, McpSandboxProfile } from '../shared/types'
import { normalizeMcpSandboxProfile } from '../shared/mcp-sandbox'
import type { McpSandboxLaunchRequest } from './mcp-sandbox'
import { buildMcpProcessEnv } from './mcp-process-env'

/**
 * A pinned, portable Node distribution keeps npx-based MCP servers out of
 * system-owned locations such as Program Files. Hashes are the official Node.js
 * release checksums for the archive, not values fetched at installation time.
 */
const NODE_VERSION = '24.22.0'
const NODE_ARCHIVES = {
  x64: {
    file: `node-v${NODE_VERSION}-win-x64.zip`,
    sha256: 'f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3',
  },
  arm64: {
    file: `node-v${NODE_VERSION}-win-arm64.zip`,
    sha256: '3a5c209a5bc59e65b3bc0fa13ed5e166a26bd3d55332847f498b76b037408d61',
  },
} as const
const RUNTIME_DIRECTORY = 'managed-mcp-node'
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024

type ManagedNodeArchitecture = keyof typeof NODE_ARCHIVES

export interface ManagedNodeRuntimeStatus {
  state: 'ready' | 'downloading' | 'failed' | 'unsupported'
  version: string
  detail?: string
}

export interface ManagedNodeLaunch {
  request: McpSandboxLaunchRequest
  cleanup: () => void
}

function usesMcpRemote(args: readonly string[]): boolean {
  return args.some((arg) => /^mcp-remote(?:@\S+)?$/.test(arg))
}

/** Argument-array editors do not consume shell quotes as a terminal would. */
export function normalizeMcpRemoteHeaderArgs(args: readonly string[]): string[] {
  if (!usesMcpRemote(args)) return [...args]
  return args.map((arg, index) => {
    if (args[index - 1] !== '--header') return arg
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
      const header = arg.slice(1, -1)
      if (/^[!#$%&'*+.^_`|~\w-]+:/.test(header)) return header
    }
    return arg
  })
}

let installPromise: Promise<ManagedNodeRuntimeStatus> | undefined
let installFailure: string | undefined

function userDataPath(): string {
  return app.getPath('userData')
}

function architecture(): ManagedNodeArchitecture | undefined {
  return process.arch === 'x64' || process.arch === 'arm64' ? process.arch : undefined
}

function archive(): (typeof NODE_ARCHIVES)[ManagedNodeArchitecture] {
  const arch = architecture()
  if (!arch) throw new Error(`Managed Node is not available for Windows ${process.arch}.`)
  return NODE_ARCHIVES[arch]
}

function runtimeRoot(): string {
  return join(userDataPath(), RUNTIME_DIRECTORY, `node-v${NODE_VERSION}-win-${architecture() ?? process.arch}`)
}

function cacheRoot(): string {
  return join(userDataPath(), RUNTIME_DIRECTORY, `npm-cache-v${NODE_VERSION}`)
}

function nodePath(): string {
  return join(runtimeRoot(), 'node.exe')
}

function npxCliPath(): string {
  return join(runtimeRoot(), 'node_modules', 'npm', 'bin', 'npx-cli.js')
}

function runtimeReady(): boolean {
  return existsSync(nodePath()) && existsSync(npxCliPath())
}

/** Remove superseded Nexy-owned Node payloads after a verified replacement. */
function removeSupersededRuntimes(parent: string): void {
  const activeRuntime = basename(runtimeRoot())
  const activeCache = basename(cacheRoot())
  try {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === activeRuntime || entry.name === activeCache) continue
      // Never treat arbitrary user-data folders as managed runtime content.
      if (!/^node-v[\d.]+-win-(?:x64|arm64)$/.test(entry.name) && !/^npm-cache-v[\d.]+$/.test(entry.name)) continue
      try { rmSync(join(parent, entry.name), { recursive: true, force: true }) } catch { /* old runtime may still be in use */ }
    }
  } catch { /* cleanup is opportunistic and must not invalidate a verified runtime */ }
}

/** Exported for diagnostics and tests; no host Node executable is considered valid. */
export function getManagedNodeRuntimeStatus(): ManagedNodeRuntimeStatus {
  if (process.platform !== 'win32') return { state: 'unsupported', version: NODE_VERSION, detail: 'Managed Node is required only for Windows npx MCP servers.' }
  if (!architecture()) return { state: 'unsupported', version: NODE_VERSION, detail: `Windows ${process.arch} is not supported by Nexy’s managed Node runtime.` }
  if (installPromise) return { state: 'downloading', version: NODE_VERSION }
  if (runtimeReady()) return { state: 'ready', version: NODE_VERSION }
  return installFailure
    ? { state: 'failed', version: NODE_VERSION, detail: installFailure }
    : { state: 'failed', version: NODE_VERSION, detail: 'Managed Node has not been installed yet.' }
}

function ensureArchive(bytes: Uint8Array, expectedHash: string): void {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Managed Node download exceeded the expected archive size.')
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    throw new Error('Managed Node download was not a ZIP archive.')
  }
  const actualHash = createHash('sha256').update(bytes).digest('hex')
  if (actualHash !== expectedHash) throw new Error('Managed Node download failed SHA-256 verification.')
}

/** Read a fetch body with a hard limit even when the server omits Content-Length. */
async function readArchive(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error('Managed Node download did not include a response body.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      length += value.byteLength
      if (length > MAX_ARCHIVE_BYTES) {
        await reader.cancel()
        throw new Error('Managed Node download exceeded the expected archive size.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * Activate a verified runtime without discarding the prior usable runtime until
 * its replacement has taken its place. All paths are under Nexy's user data.
 */
function activateRuntime(extractedRoot: string, parent: string): void {
  const target = runtimeRoot()
  const backup = join(parent, `.node-previous-${process.pid}-${Date.now()}`)
  const hadPreviousRuntime = existsSync(target)
  try {
    if (hadPreviousRuntime) renameSync(target, backup)
    renameSync(extractedRoot, target)
  } catch (error) {
    // If promotion failed after moving an existing runtime aside, restore it.
    // This also leaves a corrupt/incomplete prior target untouched when there
    // was no old runtime to restore.
    if (hadPreviousRuntime && existsSync(backup) && !existsSync(target)) {
      try { renameSync(backup, target) } catch { /* preserve original failure */ }
    }
    throw error
  }
  if (hadPreviousRuntime) {
    try { rmSync(backup, { recursive: true, force: true }) } catch { /* cleanup is best effort */ }
  }
}

/**
 * Downloads to a private staging directory and promotes it only after archive
 * integrity and the Node/npm launch paths have both been checked.
 */
export async function installManagedNodeRuntime(fetcher: typeof fetch = fetch): Promise<ManagedNodeRuntimeStatus> {
  if (process.platform !== 'win32') return getManagedNodeRuntimeStatus()
  if (!architecture()) return getManagedNodeRuntimeStatus()
  if (runtimeReady()) return getManagedNodeRuntimeStatus()
  if (installPromise) return installPromise

  const operation = (async (): Promise<ManagedNodeRuntimeStatus> => {
    let staging: string | undefined
    try {
      const selected = archive()
      const parent = join(userDataPath(), RUNTIME_DIRECTORY)
      mkdirSync(parent, { recursive: true })
      staging = mkdtempSync(join(parent, '.node-staging-'))
      const response = await fetcher(`https://nodejs.org/dist/v${NODE_VERSION}/${selected.file}`, {
        redirect: 'error',
        headers: { 'User-Agent': 'Nexy-Desktop/managed-mcp-node' },
      })
      if (!response.ok) throw new Error(`Managed Node download failed (HTTP ${response.status}).`)
      const contentLength = Number(response.headers.get('content-length') ?? '0')
      if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) throw new Error('Managed Node download exceeded the expected archive size.')
      const bytes = await readArchive(response)
      ensureArchive(bytes, selected.sha256)
      const archivePath = join(staging, selected.file)
      writeFileSync(archivePath, bytes)
      await extractZip(archivePath, { dir: staging })

      const extractedRoot = join(staging, `node-v${NODE_VERSION}-win-${architecture()}`)
      const extractedNode = join(extractedRoot, 'node.exe')
      const extractedNpx = join(extractedRoot, 'node_modules', 'npm', 'bin', 'npx-cli.js')
      if (!existsSync(extractedNode) || !existsSync(extractedNpx)) {
        throw new Error('Managed Node archive did not contain the expected Node and npm executables.')
      }
      // The target is Nexy-owned user data. Activation is intentionally last so
      // an interrupted replacement retains the previously usable runtime.
      activateRuntime(extractedRoot, parent)
      removeSupersededRuntimes(parent)
      installFailure = undefined
      return { state: 'ready', version: NODE_VERSION }
    } catch (error) {
      installFailure = `Managed Node runtime installation failed: ${error instanceof Error ? error.message : String(error)}`
      return { state: 'failed', version: NODE_VERSION, detail: installFailure }
    } finally {
      if (staging && existsSync(staging)) rmSync(staging, { recursive: true, force: true })
    }
  })()
  installPromise = operation
  try {
    return await operation
  } finally {
    if (installPromise === operation) installPromise = undefined
  }
}

export function isManagedNodeNpxConfig(config: Pick<McpServerConfig, 'command'>): boolean {
  if (process.platform !== 'win32') return false
  // `npx.cmd` is Windows' normal spelling, including an explicitly configured
  // host path such as C:\\Program Files\\nodejs\\npx.cmd. Treat both forms as
  // npx so users do not need to know which spelling avoids the host runtime.
  const command = config.command.trim().toLowerCase()
  return command === 'npx' || basename(command) === 'npx.cmd'
}

function addFilesystemGrant(profile: McpSandboxProfile, grant: McpSandboxFilesystemGrant): McpSandboxFilesystemGrant[] {
  const existing = profile.filesystem.find((candidate) => candidate.path.toLowerCase() === grant.path.toLowerCase())
  if (!existing) return [...profile.filesystem, grant]
  // A user-selected read-write grant must never be narrowed. A read-only entry
  // for Nexy's own cache/session path, however, must be upgraded: npm cannot
  // function without its private writable directories.
  if (existing.access === 'read-write' || grant.access === 'read-only') return profile.filesystem
  return profile.filesystem.map((candidate) => candidate === existing ? grant : candidate)
}

/** Builds the sandboxed, direct-Node form of `npx …`; never invokes npx.cmd. */
export async function ensureManagedNodeNpxRuntime(config: Pick<McpServerConfig, 'command' | 'sandboxProfile'>): Promise<void> {
  if (!isManagedNodeNpxConfig(config)) return
  // Installing a missing runtime is a network operation performed by Nexy, so
  // honor the same explicit network grant required for npx to fetch its MCP
  // package. A ready runtime can still be used by an offline/cached server.
  if (!runtimeReady() && normalizeMcpSandboxProfile(config.sandboxProfile).network !== 'allowed') {
    throw new Error('Managed Node runtime installation requires network access. Enable network access for this MCP server, then retry.')
  }
  const status = await installManagedNodeRuntime()
  if (status.state !== 'ready') throw new Error(status.detail || 'Managed Node runtime is unavailable.')
}

export function createManagedNodeNpxLaunch(config: Pick<McpServerConfig, 'args' | 'env' | 'cwd' | 'sandboxProfile' | 'name'>): ManagedNodeLaunch {
  if (!runtimeReady()) throw new Error('Managed Node runtime is unavailable. Test the MCP server again to install it.')

  const root = runtimeRoot()
  const cache = cacheRoot()
  const args = normalizeMcpRemoteHeaderArgs(config.args)
  // mcp-remote probes its OAuth cache even when a static API header is used.
  // Keep it private to this configuration instead of opening the host profile.
  const remoteConfigDirectory = usesMcpRemote(args) && !config.env.MCP_REMOTE_CONFIG_DIR
    ? join(userDataPath(), RUNTIME_DIRECTORY, `remote-state-${createHash('sha256').update(JSON.stringify([config.name, args])).digest('hex')}`)
    : undefined
  if (remoteConfigDirectory) mkdirSync(remoteConfigDirectory, { recursive: true })
  mkdirSync(cache, { recursive: true })
  const sessionDirectory = mkdtempSync(join(userDataPath(), RUNTIME_DIRECTORY, 'npx-session-'))
  const temporaryDirectory = join(sessionDirectory, 'tmp')
  mkdirSync(temporaryDirectory, { recursive: true })
  const userConfigPath = join(sessionDirectory, 'npmrc')
  const launcherPath = join(sessionDirectory, 'managed-npx.cjs')
  writeFileSync(launcherPath, readFileSync(join(__dirname, 'managed-npx-worker.cjs')))
  // npm debug logs include its full argv, which could contain an MCP header
  // credential. Nexy captures/redacts launch diagnostics itself, so do not
  // create a persistent npm log for managed server launches.
  writeFileSync(userConfigPath, 'update-notifier=false\naudit=false\nfund=false\nlogs-max=0\n')

  const rawProfile = { ...(config.sandboxProfile ?? {}) } as Record<string, unknown>
  delete rawProfile.managedRuntime
  let profile = normalizeMcpSandboxProfile(rawProfile)
  const managedGrants: McpSandboxFilesystemGrant[] = [
    { path: root, access: 'read-only' as const },
    { path: cache, access: 'read-write' as const },
    ...(remoteConfigDirectory ? [{ path: remoteConfigDirectory, access: 'read-write' as const }] : []),
    // When no working directory was configured, the session directory is the
    // cwd and the helper already grants it exactly once. With an explicit cwd,
    // add a separate grant for npm's private temporary directory.
    ...(config.cwd ? [{ path: sessionDirectory, access: 'read-write' as const }] : []),
  ]
  for (const grant of managedGrants) {
    profile = { ...profile, filesystem: addFilesystemGrant(profile, grant) }
  }

  const environment = buildMcpProcessEnv({
    ...config.env,
    ...(remoteConfigDirectory ? { MCP_REMOTE_CONFIG_DIR: remoteConfigDirectory } : {}),
    NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_USERCONFIG: userConfigPath,
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_LOGS_MAX: '0',
    // npm's .cmd package shims start another node.exe. The same path-resolution
    // flags must reach that process as well as npm itself.
    NODE_OPTIONS: ['--preserve-symlinks', '--preserve-symlinks-main', config.env.NODE_OPTIONS].filter(Boolean).join(' '),
    TEMP: temporaryDirectory,
    TMP: temporaryDirectory,
  })
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') ?? 'Path'
  // Child processes launched by npx that resolve `node` by PATH should get the
  // same managed runtime, not fall back to the inaccessible system Node.
  environment[pathKey] = `${root};${environment[pathKey] ?? ''}`

  return {
    request: {
      command: nodePath(),
      args: ['--preserve-symlinks', '--preserve-symlinks-main', launcherPath, npxCliPath(), ...args],
      env: environment,
      cwd: config.cwd || sessionDirectory,
      profile,
      diagnosticLabel: config.name,
    },
    cleanup: () => rmSync(sessionDirectory, { recursive: true, force: true }),
  }
}

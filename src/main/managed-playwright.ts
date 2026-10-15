import { app } from 'electron'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { join, dirname, isAbsolute, relative, basename } from 'node:path'
import { spawn } from 'node:child_process'
import type { ManagedBrowserRuntimeStatus, McpManagedLaunch } from '../shared/types'
import type { McpSandboxLaunchRequest } from './mcp-sandbox'
import { recordErrorLogEntry } from './error-log-handlers'
import { buildMcpProcessEnv } from './mcp-process-env'

const require = createRequire(import.meta.url)
type PackageManifest = {
  dependencies: Record<string, string>
  bin?: Record<string, string>
}

const mcpPackage = require('@playwright/mcp/package.json') as PackageManifest
const playwrightPackage = require('playwright/package.json') as PackageManifest
const BROWSER_VERSION = mcpPackage.dependencies.playwright
const RUNTIME_DIRECTORY = 'managed-playwright'
const BROWSER_DIRECTORY = `chromium-${BROWSER_VERSION.replace(/[^a-zA-Z0-9._-]/g, '_')}`

/** Abort a download that has produced no installer output for this long. */
const INSTALL_STALL_TIMEOUT_MS = 120_000

let installPromise: Promise<ManagedBrowserRuntimeStatus> | undefined
let installProgress: string | undefined
let cachedExecutableRelativePath: string | undefined
let runtimeFailure: string | undefined
let runtimeFailureLogId: string | undefined

function userDataPath(): string {
  return app.getPath('userData')
}

function browserRoot(): string {
  return join(userDataPath(), RUNTIME_DIRECTORY, BROWSER_DIRECTORY)
}

/**
 * electron-builder keeps the packages in app.asar and exposes their executable
 * files alongside it in app.asar.unpacked. Package exports intentionally block
 * resolving the CLI as a subpath, so resolve the exported manifest first and
 * derive the declared bin file from its package directory.
 */
function unpackedRuntimePath(path: string): string {
  const unpacked = path.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
  return unpacked !== path && existsSync(unpacked) ? unpacked : path
}

function packageBinPath(packageName: string, manifest: PackageManifest, binName: string): string {
  const bin = manifest.bin?.[binName]
  if (!bin) throw new Error(`The bundled ${packageName} package does not declare the ${binName} executable.`)
  return unpackedRuntimePath(join(dirname(require.resolve(`${packageName}/package.json`)), bin))
}

function mcpCliPath(): string {
  return packageBinPath('@playwright/mcp', mcpPackage, 'playwright-mcp')
}

function playwrightCliPath(): string {
  return packageBinPath('playwright', playwrightPackage, 'playwright')
}

/**
 * playwright-core reads PLAYWRIGHT_BROWSERS_PATH once, when the module is first
 * loaded, and caches the registry directory for the life of the process. Changing
 * the variable afterwards has no effect, so asking it about the staging directory
 * silently returned the path under the final runtime root instead. Resolve the
 * executable's location relative to the managed root once and apply that layout
 * to any root (staging or final).
 */
function chromiumExecutableRelativePath(): string {
  if (cachedExecutableRelativePath) return cachedExecutableRelativePath
  const root = browserRoot()
  const previous = process.env.PLAYWRIGHT_BROWSERS_PATH
  process.env.PLAYWRIGHT_BROWSERS_PATH = root
  let executable: string
  try {
    const playwright = require('playwright-core') as { chromium: { executablePath(): string } }
    executable = playwright.chromium.executablePath()
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previous
  }
  const relativePath = relative(root, executable)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`The bundled Playwright runtime resolved Chromium outside the managed directory (${executable}).`)
  }
  cachedExecutableRelativePath = relativePath
  return relativePath
}

/** Exported for tests: where Chromium lives inside a managed browsers root. */
export function executableAt(root: string): string {
  return join(root, chromiumExecutableRelativePath())
}

/** Turns Playwright's installer output into a one-line progress summary. */
export function summarizeInstallProgress(output: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const lines = output.replace(/\u001b\[[0-9;]*m/g, '').split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean)
  let label: string | undefined
  let percent: string | undefined
  for (const line of lines) {
    const downloading = /^Downloading (.+?) \(playwright /.exec(line)
    if (downloading) { label = downloading[1]; percent = undefined; continue }
    const progress = /(\d+)% of ([\d.]+ \w+)/.exec(line)
    if (progress) percent = `${progress[1]}% of ${progress[2]}`
  }
  if (!label) return lines.length ? 'Starting download…' : undefined
  return percent ? `Downloading ${label}: ${percent}` : `Downloading ${label}…`
}

export function getManagedBrowserStatus(): ManagedBrowserRuntimeStatus {
  if (installPromise) return { state: 'downloading', browser: 'chromium', version: BROWSER_VERSION, detail: installProgress }
  try {
    if (existsSync(executableAt(browserRoot()))) return { state: 'ready', browser: 'chromium', version: BROWSER_VERSION }
  } catch (error) {
    return {
      state: 'failed',
      browser: 'chromium',
      version: BROWSER_VERSION,
      detail: `Could not inspect the bundled Playwright runtime: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (runtimeFailure) return { state: 'failed', browser: 'chromium', version: BROWSER_VERSION, detail: runtimeFailure, errorLogId: runtimeFailureLogId }
  return { state: 'download-required', browser: 'chromium', version: BROWSER_VERSION }
}

/**
 * Downloads Chromium only when the operator has explicitly requested it. The
 * installation first lands in a private staging directory and is promoted only
 * after its executable is present; global Playwright/npm caches are never read.
 */
export async function installManagedBrowser(
  spawnInstaller: typeof spawn = spawn,
): Promise<ManagedBrowserRuntimeStatus> {
  if (installPromise) return installPromise
  if (getManagedBrowserStatus().state === 'ready') return getManagedBrowserStatus()

  // Resolves once the attempt is over. The final status is computed only after
  // installPromise is cleared, otherwise it would always report 'downloading'.
  const operation = new Promise<void>((resolve) => {
    let staging: string | undefined
    let completed = false
    let stallTimer: NodeJS.Timeout | undefined
    const finish = (error?: string) => {
      if (completed) return
      completed = true
      if (stallTimer) clearTimeout(stallTimer)
      if (error) {
        runtimeFailure = error
        runtimeFailureLogId = recordErrorLogEntry({
          source: 'main',
          level: 'error',
          message: `Managed Chromium download failed: ${error}`,
        }).id
      }
      if (staging && existsSync(staging)) {
        try {
          rmSync(staging, { recursive: true, force: true })
        } catch (cleanupError) {
          runtimeFailure = `${runtimeFailure || 'Chromium installation failed'}; could not remove temporary download files: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        }
      }
      resolve()
    }
    try {
      const parent = dirname(browserRoot())
      mkdirSync(parent, { recursive: true })
      staging = mkdtempSync(join(parent, '.staging-'))
      // Browser installation is provided by Playwright's CLI, not the MCP
      // server CLI. Keeping this separate also makes the download version match
      // the browser runtime used by the managed MCP server.
      const child = spawnInstaller(process.execPath, [playwrightCliPath(), 'install', 'chromium'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: staging },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      const armStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer)
        stallTimer = setTimeout(() => {
          child.kill()
          finish(`Chromium download stalled: no progress for ${INSTALL_STALL_TIMEOUT_MS / 1000} seconds. Check your internet connection or proxy, then retry.${output.trim() ? ` Last output: ${output.trim().slice(-1_000)}` : ''}`)
        }, INSTALL_STALL_TIMEOUT_MS)
      }
      armStallTimer()
      const appendOutput = (chunk: Buffer) => {
        output = `${output}${chunk.toString('utf8')}`.slice(-8_192)
        installProgress = summarizeInstallProgress(output) ?? installProgress
        armStallTimer()
      }
      child.stdout?.on('data', appendOutput)
      child.stderr?.on('data', appendOutput)
      child.once('error', (error) => finish(`Could not start Chromium download: ${error.message}`))
      child.once('close', (code, signal) => {
        if (code !== 0) {
          const diagnostic = output.trim()
          const reason = code === null ? `process ended${signal ? ` with signal ${signal}` : ''}` : `exit code ${code}`
          return finish(`Chromium download failed (${reason})${diagnostic ? `: ${diagnostic}` : ''}`)
        }
        try {
          if (!staging || !existsSync(executableAt(staging))) {
            const diagnostic = output.trim().slice(-1_000)
            return finish(`Chromium download completed but the expected executable was not found at ${staging ? executableAt(staging) : 'the staging directory'}.${diagnostic ? ` Installer output: ${diagnostic}` : ''}`)
          }
        } catch (error) {
          return finish(`Could not verify the downloaded Chromium executable: ${error instanceof Error ? error.message : String(error)}`)
        }
        try {
          // A non-ready target can only be an interrupted prior install. Removing it
          // before promotion keeps the visible runtime either old-and-ready or new-and-ready.
          rmSync(browserRoot(), { recursive: true, force: true })
          renameSync(staging, browserRoot())
          runtimeFailure = undefined
          runtimeFailureLogId = undefined
          finish()
        } catch (error) {
          finish(`Could not activate downloaded Chromium: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    } catch (error) {
      finish(`Could not prepare the managed Chromium download: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  const result = operation.then(() => {
    if (installPromise === result) installPromise = undefined
    installProgress = undefined
    return getManagedBrowserStatus()
  })
  installProgress = 'Starting download…'
  installPromise = result
  return result
}

export interface ManagedPlaywrightLaunch {
  request: McpSandboxLaunchRequest
  cleanup: () => void
}

/**
 * Node's CommonJS resolver stats every candidate `node_modules` directory before
 * looking inside it, and skips any it cannot stat. Granting only the package
 * folders therefore leaves sibling packages (`playwright-core` from
 * `@playwright/mcp`) unresolvable inside the AppContainer. Grant the enclosing
 * `node_modules` directories read-only; in packaged builds that is
 * app.asar.unpacked/node_modules, which holds only Nexy's unpacked runtimes.
 */
export function enclosingNodeModulesDirectories(packageDirectories: string[]): string[] {
  const roots = new Set<string>()
  for (const directory of packageDirectories) {
    let current = directory
    while (dirname(current) !== current) {
      if (basename(current).toLowerCase() === 'node_modules') { roots.add(current); break }
      current = dirname(current)
    }
  }
  return [...roots]
}

/**
 * Electron-as-Node flags required inside the Windows AppContainer. Without
 * them Node canonicalises the entry script and every module with
 * `realpathSync`, which walks up to and `lstat`s the drive root — a path an
 * AppContainer may not inspect — and aborts with EPERM before the server starts.
 */
export const MANAGED_NODE_FLAGS = ['--preserve-symlinks', '--preserve-symlinks-main'] as const

/** Builds the fixed sandbox descriptor used by Nexy's two managed browser cards. */
export function createManagedPlaywrightLaunch(launch: McpManagedLaunch): ManagedPlaywrightLaunch {
  const status = getManagedBrowserStatus()
  if (status.state !== 'ready') {
    throw new Error(status.state === 'downloading'
      ? 'Managed Chromium is downloading. Wait for it to finish, then retry.'
      : status.state === 'failed'
        ? `Managed Chromium is unavailable: ${status.detail || 'the browser installation failed'}. Open the MCP server settings, review the download details, and retry “Download Chromium”.`
        : `Managed Chromium is not installed. Open the MCP server settings and select “Download Chromium” to install version ${BROWSER_VERSION}.`)
  }
  const sessionDirectory = mkdtempSync(join(userDataPath(), `${RUNTIME_DIRECTORY}-session-`))
  const outputDirectory = join(sessionDirectory, 'output')
  mkdirSync(outputDirectory, { recursive: true })
  const mcpDirectory = dirname(mcpCliPath())
  const playwrightCoreDirectory = unpackedRuntimePath(dirname(require.resolve('playwright-core/package.json')))
  const playwrightDirectory = unpackedRuntimePath(dirname(require.resolve('playwright/package.json')))
  const packageDirectories = [mcpDirectory, playwrightCoreDirectory, playwrightDirectory]
  // `--isolated` keeps the browser profile in memory (it is mutually exclusive
  // with --user-data-dir in this @playwright/mcp release), the server is headed
  // by default (there is no --headed flag), and without `--browser chromium` it
  // looks for a system Google Chrome install instead of Nexy's managed Chromium.
  const args = launch.mode === 'cdp'
    ? ['--cdp-endpoint', 'http://127.0.0.1:9222', '--output-dir', outputDirectory]
    : ['--isolated', '--browser', 'chromium', '--output-dir', outputDirectory]
  return {
    request: {
      command: process.execPath,
      args: [...MANAGED_NODE_FLAGS, mcpCliPath(), ...args],
      // Start from the same secret-free allowlist as every other MCP server:
      // Windows cannot create the AppContainer process without e.g. SystemRoot.
      env: buildMcpProcessEnv({ ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: browserRoot() }),
      cwd: sessionDirectory,
      profile: {
        version: 1,
        network: 'allowed',
        childProcesses: 'allowed',
        filesystem: [
          ...enclosingNodeModulesDirectories(packageDirectories).map((path) => ({ path, access: 'read-only' as const })),
          ...packageDirectories.map((path) => ({ path, access: 'read-only' as const })),
          { path: browserRoot(), access: 'read-only' },
          { path: sessionDirectory, access: 'read-write' },
        ],
        memoryLimitMiB: 1024,
        maxProcesses: 16,
        startupTimeoutMs: 15000,
        gracefulShutdownTimeoutMs: 2000,
        hardTerminationTimeoutMs: 5000,
        maxDiagnosticBytes: 65536,
        managedRuntime: 'playwright',
      },
      diagnosticLabel: launch.mode === 'cdp' ? 'Nexy managed Playwright (CDP)' : 'Nexy managed Playwright',
    },
    cleanup: () => rmSync(sessionDirectory, { recursive: true, force: true }),
  }
}

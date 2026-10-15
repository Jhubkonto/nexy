import type { McpLaunchAction, McpLaunchFailure, McpLaunchStage } from '../shared/types'

/**
 * Turns what was observed while starting an MCP server into a user-facing
 * checklist and a plain-language failure explanation.
 *
 * The MCP SDK reports almost every start-up failure as the same generic
 * "MCP error -32000: Connection closed". The real cause is only in the sandbox
 * helper's stderr: its own `mcp-sandbox: …` failures, followed by the server's
 * buffered error output, which the helper flushes as the server exits.
 */

export interface LaunchObservation {
  /** Present for Nexy's managed Playwright runtime. */
  managedMode?: 'launch' | 'cdp'
  platform?: NodeJS.Platform
  /** Thrown before the helper ran: runtime not installed, helper unavailable, … */
  preflightError?: string
  /** Error from the MCP handshake (client.connect). */
  connectError?: string
  /** Helper + server error output (unredacted; redact before display). */
  stderr?: string
  toolCount?: number
  /** Managed launch mode only: outcome of opening a blank page. */
  browser?: { state: 'passed' | 'failed' | 'skipped'; detail?: string }
}

/** Kept in results shown to the user; the full tail goes to the error log. */
export const DISPLAY_STDERR_CHARS = 6_000

const HELPER_FAILURE_LINE = /^mcp-sandbox: (?!could not restore a temporary filesystem ACL)(.+)$/m

const WIN32_ERRORS: Record<string, string> = {
  '2': 'a required file was not found',
  '5': 'Windows denied access',
  '203': 'the process environment was missing variables Windows requires',
  '1314': 'a required Windows privilege is not held',
}

/**
 * Removes secrets the user configured (environment values) and common
 * credential shapes from diagnostic text before it is displayed or logged.
 */
export function redactDiagnostics(text: string, secrets: string[] = []): string {
  let result = text
  const values = [...new Set(secrets.filter((value) => value.length >= 4))].sort((a, b) => b.length - a.length)
  for (const value of values) result = result.split(value).join('[redacted]')
  return result
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]')
    .replace(/\b([A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[redacted]')
}

function helperFailure(stderr: string): string | undefined {
  const line = HELPER_FAILURE_LINE.exec(stderr)?.[1]?.replace(/^Windows sandbox:\s*/i, '').trim()
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : undefined
}

function win32Hint(text: string): string {
  const code = /Win32 error (\d+)/i.exec(text)?.[1]
  return code && WIN32_ERRORS[code] ? ` Windows reported error ${code}: ${WIN32_ERRORS[code]}.` : ''
}

/** The most informative single line of server error output, for the summary. */
export function keyErrorLine(stderr: string): string | undefined {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const preferred = lines.find((line) => /^(?:mcp-sandbox:|error\b|[A-Za-z]*Error:|fatal\b)/i.test(line))
  return preferred ?? lines.at(-1)
}

function withoutEditSetup(actions: McpLaunchAction[], managed: boolean): McpLaunchAction[] {
  // Nexy's managed runtime has no user-editable launch configuration.
  return managed ? actions.filter((action) => action !== 'edit-setup') : actions
}

export function classifyLaunchFailure(observation: LaunchObservation): McpLaunchFailure | undefined {
  const { preflightError = '', connectError = '', stderr = '', browser } = observation
  const managed = Boolean(observation.managedMode)
  const windows = (observation.platform ?? process.platform) === 'win32'
  const helperLine = helperFailure(stderr)
  const make = (failure: Omit<McpLaunchFailure, 'actions'> & { actions: McpLaunchAction[] }): McpLaunchFailure =>
    ({ ...failure, actions: withoutEditSetup(failure.actions, managed) })

  if (preflightError) {
    if (/Managed Chromium is downloading/i.test(preflightError)) {
      return make({ kind: 'runtime-downloading', title: 'Chromium is still downloading', explanation: 'Wait for the managed Chromium download to finish, then retry.', actions: ['retry'] })
    }
    if (/Managed Chromium is (?:not installed|unavailable)/i.test(preflightError)) {
      return make({ kind: 'runtime-missing', title: 'Managed Chromium is not installed', explanation: 'Download Nexy’s managed Chromium before starting the browser server.', actions: ['download-browser'] })
    }
    if (/sandbox helper is unavailable/i.test(preflightError)) {
      return make({ kind: 'helper-unavailable', title: 'Nexy’s sandbox helper is missing', explanation: 'The helper that isolates MCP servers could not be found or failed its integrity check, so Nexy refused to start the server unsandboxed. Reinstalling Nexy restores it.', actions: ['retry'] })
    }
    return make({ kind: 'unknown', title: 'The server could not be prepared', explanation: preflightError, actions: ['retry', 'edit-setup'] })
  }

  if (!connectError && browser?.state === 'failed') {
    const missing = /Executable doesn't exist|is not found at|Run "npx playwright install/i.test(browser.detail ?? '')
    return make({
      kind: 'browser-launch',
      title: windows ? 'Chromium could not start in the Windows sandbox' : 'Chromium could not start',
      explanation: missing
        ? 'The Playwright server started, but the browser it needs is missing. Re-download managed Chromium, then retry.'
        : `The Playwright server started and listed its tools, but opening a browser page failed. ${browser.detail ?? ''}`.trim(),
      // Repairing the AppContainer profile does not help here: the profile
      // already started the server; the browser's own process creation failed.
      actions: missing ? ['download-browser', 'retry'] : ['retry'],
    })
  }

  if (!connectError) return undefined

  if (helperLine) {
    if (/could not resolve MCP command/i.test(helperLine)) {
      return make({ kind: 'command-not-found', title: 'The launch command was not found', explanation: `${helperLine}. Check that it is installed and on PATH, or use its full path.`, actions: ['edit-setup', 'retry'] })
    }
    if (/filesystem path does not exist|ACL|grant AppContainer access/i.test(helperLine)) {
      return make({ kind: 'filesystem', title: 'A folder could not be shared with the sandbox', explanation: `${helperLine}. Check the working directory and filesystem access entries in Edit setup.`, actions: ['edit-setup', 'retry'] })
    }
    return make({
      kind: 'sandbox',
      title: windows ? 'The Windows sandbox could not start the server' : 'The sandbox could not start the server',
      explanation: `${helperLine}.${win32Hint(helperLine)}`,
      actions: windows ? ['repair-sandbox', 'retry'] : ['retry'],
    })
  }

  const keyLine = stderr ? keyErrorLine(stderr) : undefined
  if (/\b(?:EPERM|EACCES)\b|operation not permitted|access is denied/i.test(stderr)) {
    return make({
      kind: 'permission',
      title: 'The server was denied access inside the sandbox',
      explanation: `${keyLine ?? 'A file or folder the server needs is not shared with it.'} Grant the folder it needs under filesystem access in Edit setup.`,
      actions: ['edit-setup', 'retry'],
    })
  }
  if (/Cannot find module|MODULE_NOT_FOUND|SyntaxError|unknown option|Traceback \(most recent call last\)|panicked at/i.test(stderr)) {
    return make({
      kind: 'server-crashed',
      title: 'The server crashed during start-up',
      explanation: `${keyLine}. Check its arguments and installation; the output below is the server’s own error.`,
      actions: ['edit-setup', 'retry'],
    })
  }
  if (/timed out|timeout/i.test(connectError)) {
    return make({ kind: 'timeout', title: 'The server did not respond in time', explanation: 'The process started but never completed the MCP handshake. It may be waiting for input, still installing, or not be an MCP server.', actions: ['retry', 'edit-setup'] })
  }
  if (/connection closed|closed|EOF|exited/i.test(connectError)) {
    return make({
      kind: 'server-exited',
      title: 'The server exited before it finished starting',
      explanation: keyLine
        ? `Its last error output was: ${keyLine}`
        : 'It produced no error output. Check its arguments, required environment variables, and working directory, or run the command in a terminal to see its own output.',
      actions: ['edit-setup', 'retry'],
    })
  }
  return make({ kind: 'unknown', title: 'The server did not start', explanation: keyLine ?? connectError, actions: ['retry', 'edit-setup'] })
}

const SANDBOX_KINDS = new Set(['helper-unavailable', 'sandbox', 'filesystem', 'command-not-found'])

export function buildLaunchStages(observation: LaunchObservation, failure: McpLaunchFailure | undefined): McpLaunchStage[] {
  const stages: McpLaunchStage[] = []
  const managed = observation.managedMode
  const preflightFailed = Boolean(observation.preflightError)
  const runtimeFailed = failure?.kind === 'runtime-missing' || failure?.kind === 'runtime-downloading'

  if (managed) {
    stages.push({
      id: 'runtime',
      label: 'Managed Chromium installed',
      state: runtimeFailed ? 'failed' : preflightFailed ? 'not-run' : 'passed',
      ...(runtimeFailed ? { detail: failure.title } : {}),
    })
  }

  const sandboxFailed = Boolean(failure && SANDBOX_KINDS.has(failure.kind))
  const sandboxState = sandboxFailed ? 'failed' : preflightFailed ? 'not-run' : 'passed'
  stages.push({ id: 'sandbox', label: 'Sandbox started', state: sandboxState, ...(sandboxFailed ? { detail: failure!.title } : {}) })

  const serverReached = sandboxState === 'passed'
  const serverFailed = serverReached && Boolean(observation.connectError)
  stages.push({
    id: 'server',
    label: managed ? 'Playwright MCP server started' : 'MCP server started',
    state: !serverReached ? 'not-run' : serverFailed ? 'failed' : 'passed',
    ...(serverFailed && failure ? { detail: failure.title } : {}),
  })

  const connected = serverReached && !serverFailed
  stages.push({
    id: 'tools',
    label: 'Tools listed',
    state: connected ? 'passed' : 'not-run',
    ...(connected ? { detail: `${observation.toolCount ?? 0} tool${observation.toolCount === 1 ? '' : 's'}` } : {}),
  })

  if (managed === 'launch') {
    const browser = observation.browser
    stages.push({
      id: 'browser',
      label: 'Chromium opened a page',
      state: !connected || !browser ? 'not-run' : browser.state,
      ...(connected && browser?.detail ? { detail: browser.detail } : {}),
    })
  } else if (managed === 'cdp') {
    stages.push({ id: 'browser', label: 'Browser attached', state: 'skipped', detail: 'Attaches to Chrome on port 9222 when a browser tool is first used.' })
  }
  return stages
}

const STAGE_MARK: Record<McpLaunchStage['state'], string> = { passed: '[ok]', failed: '[FAILED]', skipped: '[skipped]', 'not-run': '[not run]' }

/** Full plain-text report stored in the error log behind "View logs". */
export function formatLaunchReport(input: {
  label: string
  command?: string
  failure: McpLaunchFailure
  stages: McpLaunchStage[]
  error?: string
  stderr?: string
}): string {
  const lines = [
    `Server: ${input.label}`,
    ...(input.command ? [`Command: ${input.command}`] : []),
    `Problem: ${input.failure.title} (${input.failure.kind})`,
    input.failure.explanation,
    '',
    'Start-up checklist:',
    ...input.stages.map((stage) => `  ${STAGE_MARK[stage.state]} ${stage.label}${stage.detail ? ` — ${stage.detail}` : ''}`),
  ]
  if (input.error) lines.push('', `Error: ${input.error}`)
  lines.push('', 'Error output (sandbox helper and server):', input.stderr?.trim() ? input.stderr.trim() : '(none captured)')
  return lines.join('\n')
}

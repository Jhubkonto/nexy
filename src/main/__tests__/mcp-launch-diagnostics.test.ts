import { describe, expect, it } from 'vitest'
import { buildLaunchStages, classifyLaunchFailure, formatLaunchReport, keyErrorLine, redactDiagnostics, type LaunchObservation } from '../mcp-launch-diagnostics'

const CLOSED = 'MCP error -32000: Connection closed'

function explain(observation: LaunchObservation) {
  const failure = classifyLaunchFailure({ platform: 'win32', ...observation })
  return { failure, stages: buildLaunchStages(observation, failure) }
}

function stageStates(stages: ReturnType<typeof buildLaunchStages>) {
  return Object.fromEntries(stages.map((stage) => [stage.id, stage.state]))
}

describe('classifyLaunchFailure', () => {
  it('reports success when the handshake and browser check pass', () => {
    const { failure, stages } = explain({ managedMode: 'launch', toolCount: 23, browser: { state: 'passed', detail: 'Opened and closed a blank page.' } })
    expect(failure).toBeUndefined()
    expect(stageStates(stages)).toEqual({ runtime: 'passed', sandbox: 'passed', server: 'passed', tools: 'passed', browser: 'passed' })
    expect(stages.find((stage) => stage.id === 'tools')?.detail).toBe('23 tools')
  })

  it('explains a Windows AppContainer creation failure instead of "Connection closed"', () => {
    // Exact helper output reproduced with the managed Playwright launch descriptor.
    const { failure, stages } = explain({
      managedMode: 'launch',
      connectError: CLOSED,
      stderr: 'mcp-sandbox: Windows sandbox: could not create the AppContainer process (Win32 error 203)\n',
    })
    expect(failure).toMatchObject({ kind: 'sandbox', title: 'The Windows sandbox could not start the server', actions: ['repair-sandbox', 'retry'] })
    expect(failure?.explanation).toContain('Could not create the AppContainer process (Win32 error 203)')
    expect(failure?.explanation).toContain('environment was missing variables')
    expect(stageStates(stages)).toEqual({ runtime: 'passed', sandbox: 'failed', server: 'not-run', tools: 'not-run', browser: 'not-run' })
  })

  it('attributes a Node permission error inside the sandbox to the server, not the sandbox', () => {
    const stderr = [
      "node:fs:2686",
      "Error: EPERM: operation not permitted, lstat 'C:\\'",
      '    at Object.realpathSync (node:fs:2686:25)',
    ].join('\n')
    const { failure, stages } = explain({ connectError: CLOSED, stderr })
    expect(failure).toMatchObject({ kind: 'permission', actions: ['edit-setup', 'retry'] })
    expect(failure?.explanation).toContain("EPERM: operation not permitted, lstat 'C:\\'")
    expect(stageStates(stages)).toMatchObject({ sandbox: 'passed', server: 'failed', tools: 'not-run' })
  })

  it('surfaces a server crash with its key error line and hides Edit setup for the managed runtime', () => {
    const { failure } = explain({ managedMode: 'launch', connectError: CLOSED, stderr: "error: unknown option '--headed'\n(Did you mean --headless?)" })
    expect(failure).toMatchObject({ kind: 'server-crashed', actions: ['retry'] })
    expect(failure?.explanation).toContain("unknown option '--headed'")
  })

  it('maps helper command resolution and filesystem failures to setup problems', () => {
    expect(explain({ connectError: CLOSED, stderr: "mcp-sandbox: Windows sandbox: could not resolve MCP command 'uvx' through PATH" }).failure)
      .toMatchObject({ kind: 'command-not-found', actions: ['edit-setup', 'retry'] })
    expect(explain({ connectError: CLOSED, stderr: 'mcp-sandbox: Windows sandbox: filesystem path does not exist: D:\\gone' }).failure)
      .toMatchObject({ kind: 'filesystem' })
  })

  it('ignores the post-run ACL restoration warning when looking for helper failures', () => {
    const { failure } = explain({ connectError: CLOSED, stderr: 'Traceback (most recent call last):\nValueError: bad\nmcp-sandbox: could not restore a temporary filesystem ACL (error 5)' })
    expect(failure?.kind).toBe('server-crashed')
  })

  it('explains a silent exit and a handshake timeout', () => {
    expect(explain({ connectError: CLOSED }).failure).toMatchObject({ kind: 'server-exited' })
    expect(explain({ connectError: CLOSED }).failure?.explanation).toMatch(/no error output/i)
    expect(explain({ connectError: 'MCP error -32001: Request timed out' }).failure).toMatchObject({ kind: 'timeout' })
  })

  it('reports a browser that cannot start after a successful handshake', () => {
    const { failure, stages } = explain({ managedMode: 'launch', toolCount: 23, browser: { state: 'failed', detail: 'Chromium did not open a page within 30 seconds.' } })
    expect(failure).toMatchObject({ kind: 'browser-launch', title: 'Chromium could not start in the Windows sandbox', actions: ['retry'] })
    expect(stageStates(stages)).toMatchObject({ server: 'passed', tools: 'passed', browser: 'failed' })
  })

  it('offers a re-download when the browser executable is missing', () => {
    const { failure } = explain({ managedMode: 'launch', toolCount: 23, browser: { state: 'failed', detail: "Chromium distribution 'chrome' is not found at C:\\x\\chrome.exe" } })
    expect(failure?.actions).toEqual(['download-browser', 'retry'])
  })

  it('handles preflight failures before the helper runs', () => {
    const missing = explain({ managedMode: 'launch', preflightError: 'Managed Chromium is not installed. Open the MCP server settings…' })
    expect(missing.failure).toMatchObject({ kind: 'runtime-missing', actions: ['download-browser'] })
    expect(stageStates(missing.stages)).toEqual({ runtime: 'failed', sandbox: 'not-run', server: 'not-run', tools: 'not-run', browser: 'not-run' })

    const helper = explain({ preflightError: 'MCP sandbox helper is unavailable; refusing to launch the server without isolation' })
    expect(helper.failure).toMatchObject({ kind: 'helper-unavailable' })
    expect(stageStates(helper.stages)).toEqual({ sandbox: 'failed', server: 'not-run', tools: 'not-run' })
  })

  it('does not offer a Windows repair on other platforms', () => {
    const failure = classifyLaunchFailure({ platform: 'darwin', connectError: CLOSED, stderr: 'mcp-sandbox: sandbox-exec failed' })
    expect(failure).toMatchObject({ kind: 'sandbox', title: 'The sandbox could not start the server', actions: ['retry'] })
  })

  it('marks the CDP browser stage as skipped', () => {
    const { stages } = explain({ managedMode: 'cdp', toolCount: 20 })
    expect(stages.find((stage) => stage.id === 'browser')).toMatchObject({ state: 'skipped', label: 'Browser attached' })
  })
})

describe('redactDiagnostics', () => {
  it('removes configured secret values and common credential shapes', () => {
    const text = 'auth failed for ghp_abcdef123456 Authorization: Bearer abc.def.ghijklmnop API_KEY=sk-123456 password: "hunter22"'
    const redacted = redactDiagnostics(text, ['ghp_abcdef123456', 'x'])
    expect(redacted).not.toContain('ghp_abcdef123456')
    expect(redacted).not.toContain('abc.def.ghijklmnop')
    expect(redacted).not.toContain('sk-123456')
    expect(redacted).not.toContain('hunter22')
    expect(redacted).toContain('API_KEY=[redacted]')
  })

  it('ignores very short secret values that would mangle ordinary output', () => {
    expect(redactDiagnostics('a b c', ['a'])).toBe('a b c')
  })
})

describe('report helpers', () => {
  it('prefers an explicit error line as the key line', () => {
    expect(keyErrorLine('at foo\nError: Cannot find module x\n   at bar')).toBe('Error: Cannot find module x')
    expect(keyErrorLine('just output\nlast line')).toBe('last line')
  })

  it('formats a complete plain-text report for the error log', () => {
    const observation: LaunchObservation = { connectError: CLOSED, stderr: 'mcp-sandbox: Windows sandbox: could not create the AppContainer process (Win32 error 203)' }
    const failure = classifyLaunchFailure({ platform: 'win32', ...observation })!
    const report = formatLaunchReport({ label: 'Playwright', command: 'node server.js', failure, stages: buildLaunchStages(observation, failure), error: CLOSED, stderr: observation.stderr })
    expect(report).toContain('Problem: The Windows sandbox could not start the server (sandbox)')
    expect(report).toContain('[FAILED] Sandbox started')
    expect(report).toContain('Win32 error 203')
    expect(report).toContain(`Error: ${CLOSED}`)
  })
})

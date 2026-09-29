import { describe, expect, it } from 'vitest'
import { DEFAULT_MCP_SANDBOX_PROFILE, normalizeMcpSandboxProfile } from '../mcp-sandbox'

describe('MCP sandbox profile', () => {
  it('normalizes legacy configurations to secure defaults', () => {
    expect(normalizeMcpSandboxProfile(undefined)).toEqual(DEFAULT_MCP_SANDBOX_PROFILE)
    expect(normalizeMcpSandboxProfile({ network: 'allowed', childProcesses: 'allowed' })).toMatchObject({
      network: 'allowed',
      childProcesses: 'allowed',
      maxProcesses: 8,
      memoryLimitMiB: 512,
    })
  })

  it('drops malformed grants and preserves only the supported access modes', () => {
    expect(normalizeMcpSandboxProfile({ filesystem: [
      { path: '  C:\\workspace  ', access: 'read-only' },
      { path: '', access: 'read-write' },
      { path: '/tmp', access: 'all' },
      null,
    ] }).filesystem).toEqual([{ path: 'C:\\workspace', access: 'read-only' }])
  })

  it('cannot be used to raise resource limits through persisted input', () => {
    expect(normalizeMcpSandboxProfile({ memoryLimitMiB: 999999, startupTimeoutMs: 1 })).toMatchObject({
      memoryLimitMiB: 512,
      startupTimeoutMs: 15000,
    })
  })
})

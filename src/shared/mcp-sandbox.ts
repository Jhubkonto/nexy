import type { McpSandboxFilesystemGrant, McpSandboxProfile } from './types'

export const DEFAULT_MCP_SANDBOX_PROFILE: McpSandboxProfile = {
  version: 1,
  network: 'blocked',
  childProcesses: 'blocked',
  filesystem: [],
  memoryLimitMiB: 512,
  maxProcesses: 1,
  startupTimeoutMs: 15_000,
  gracefulShutdownTimeoutMs: 2_000,
  hardTerminationTimeoutMs: 5_000,
  maxDiagnosticBytes: 65_536,
}

function isGrant(value: unknown): value is McpSandboxFilesystemGrant {
  if (!value || typeof value !== 'object') return false
  const grant = value as Record<string, unknown>
  return typeof grant.path === 'string' && grant.path.trim().length > 0 &&
    (grant.access === 'read-only' || grant.access === 'read-write')
}

/** Normalize persisted and remote input to the fail-closed sandbox contract. */
export function normalizeMcpSandboxProfile(value: unknown): McpSandboxProfile {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const childProcesses = input.childProcesses === 'allowed' ? 'allowed' : 'blocked'
  return {
    ...DEFAULT_MCP_SANDBOX_PROFILE,
    network: input.network === 'allowed' ? 'allowed' : 'blocked',
    childProcesses,
    maxProcesses: childProcesses === 'allowed' ? 8 : 1,
    filesystem: Array.isArray(input.filesystem)
      ? input.filesystem.filter(isGrant).map((grant) => ({ path: grant.path.trim(), access: grant.access }))
      : [],
  }
}

export function mergeMcpSandboxProfile(
  current: McpSandboxProfile | undefined,
  patch: Partial<McpSandboxProfile>,
): McpSandboxProfile {
  return normalizeMcpSandboxProfile({ ...normalizeMcpSandboxProfile(current), ...patch })
}

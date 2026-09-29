import type { CliAgentAdapter } from './types'
import { ClaudeAdapter } from './claude'
import { CodexAdapter } from './codex'
import { HermesAcpAdapterInstance } from './hermes-acp'
import { HermesAdapter } from './hermes'

let adapters: Map<string, CliAgentAdapter> | null = null

function getAdapters(): Map<string, CliAgentAdapter> {
  if (!adapters) {
    // Deliberate developer-only rollback for diagnosing an ACP incompatibility. It requires
    // both the development runtime and an explicit opt-in; packaged builds cannot silently
    // fall back to the legacy one-shot path.
    const hermes = process.env.NODE_ENV === 'development' && process.env.NEXY_DEV_HERMES_LEGACY === '1'
      ? HermesAdapter
      : HermesAcpAdapterInstance
    adapters = new Map<string, CliAgentAdapter>([
      ['claude-cli', ClaudeAdapter],
      ['codex-cli', CodexAdapter],
      ['hermes-cli', hermes],
    ])
  }
  return adapters
}

export function getAdapter(backend: string): CliAgentAdapter | undefined {
  return getAdapters().get(backend)
}

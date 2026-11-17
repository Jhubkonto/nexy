import { describe, expect, it, vi } from 'vitest'

vi.mock('../providers', () => ({
  PROVIDERS: [{ name: 'openai' }, { name: 'openrouter' }],
  getProviderCredential: vi.fn(() => null),
  getOpenRouterModels: vi.fn(() => ['gpt-5.5']),
}))
vi.mock('../cli-adapters/claude', () => ({ ClaudeAdapter: { isAvailable: () => true } }))
vi.mock('../cli-adapters/codex', () => ({ CodexAdapter: { isAvailable: () => true } }))
vi.mock('../cli-adapters/hermes', () => ({ HermesAdapter: { isAvailable: () => false } }))
vi.mock('../cli-detection', () => ({ getCliModels: () => [{ id: 'gpt-5.5' }], isHermesAcpReady: () => false }))
vi.mock('../cli-adapters/claude-model-probe', () => ({ isClaudeCliModelOrCandidate: () => false }))
vi.mock('../auth', () => ({ retrieveAuthMode: () => 'none' }))
vi.mock('../database', () => ({ getDatabase: vi.fn() }))

import { resolveEffectiveBackend } from '../backend-routing'

describe('qualified provider routing', () => {
  it('keeps an explicit provider choice when a stale CLI backend and fallback are present', () => {
    expect(resolveEffectiveBackend({
      selectedModel: 'openai:gpt-5.5', providerName: 'openai', convCliBackend: 'codex-cli',
    })).toBeUndefined()
  })

  it('still respects an agent locked to a CLI backend', () => {
    expect(resolveEffectiveBackend({
      selectedModel: 'openai:gpt-5.5', providerName: 'openai', agentBackend: 'codex-cli',
    })).toBe('codex-cli')
  })
})

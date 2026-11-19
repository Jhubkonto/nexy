import { describe, expect, it, vi } from 'vitest'

vi.mock('../providers', () => ({
  PROVIDERS: [{ name: 'openai' }, { name: 'openrouter' }],
  getProviderCredential: vi.fn(() => null),
  getOpenRouterModels: vi.fn(() => []),
}))
vi.mock('../cli-adapters/claude', () => ({ ClaudeAdapter: { isAvailable: () => false } }))
vi.mock('../cli-adapters/codex', () => ({ CodexAdapter: { isAvailable: () => false } }))
vi.mock('../cli-adapters/hermes', () => ({ HermesAdapter: { isAvailable: () => true } }))
vi.mock('../cli-detection', () => ({
  isHermesAcpReady: () => true,
  listHermesProfiles: () => [
    { name: 'default', isDefault: true },
    { name: 'localllm-iso', isDefault: false },
  ],
  getCliModels: (_backend: string, profile?: string) =>
    profile === 'localllm-iso' ? [{ id: 'ollama/qwen3-iso', label: 'Qwen3' }] : [{ id: 'openrouter/auto', label: 'Auto' }],
}))
vi.mock('../cli-adapters/claude-model-probe', () => ({ isClaudeCliModelOrCandidate: () => false }))
vi.mock('../auth', () => ({ retrieveAuthMode: () => 'api' }))
vi.mock('../database', () => ({ getDatabase: vi.fn() }))

import { inferCliBackendFromModel, resolveEffectiveBackend } from '../backend-routing'

describe('Hermes routing across profiles', () => {
  it('routes a model unique to a non-default profile to hermes-cli', () => {
    expect(inferCliBackendFromModel('ollama/qwen3-iso')).toBe('hermes-cli')
  })

  it('only consults the effective profile when one is supplied', () => {
    expect(inferCliBackendFromModel('ollama/qwen3-iso', 'localllm-iso')).toBe('hermes-cli')
    expect(inferCliBackendFromModel('ollama/qwen3-iso', 'default')).toBeUndefined()
  })

  it('threads the effective profile through resolveEffectiveBackend', () => {
    expect(resolveEffectiveBackend({ selectedModel: 'ollama/qwen3-iso', providerName: 'openai', hermesProfile: 'localllm-iso' })).toBe('hermes-cli')
  })

  it('leaves unrelated models alone', () => {
    expect(inferCliBackendFromModel('gpt-5.5')).toBeUndefined()
  })
})

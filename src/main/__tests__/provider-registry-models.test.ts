import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  getOpenRouterModelsMock,
  getCachedProviderModelsMock,
  retrieveApiKeyMock,
  getCachedAnthropicModelsMock,
} = vi.hoisted(() => ({
  getOpenRouterModelsMock: vi.fn<() => string[]>(() => []),
  getCachedProviderModelsMock: vi.fn<(key: string) => string[]>(() => []),
  retrieveApiKeyMock: vi.fn(() => null),
  getCachedAnthropicModelsMock: vi.fn<() => { id: string; label: string }[]>(() => []),
}))

vi.mock('../provider-secrets', () => ({
  getOpenRouterModels: getOpenRouterModelsMock,
  getCachedProviderModels: getCachedProviderModelsMock,
  retrieveApiKey: retrieveApiKeyMock,
}))
vi.mock('../anthropic-models', () => ({
  getCachedAnthropicModels: getCachedAnthropicModelsMock,
}))

import { getProviderForAgent, getProviderModelIds, PROVIDERS } from '../provider-registry'
import type { ProviderConfig } from '../provider-registry'

const providerByName = (name: string): ProviderConfig =>
  PROVIDERS.find((p) => p.name === name)!

afterEach(() => {
  getOpenRouterModelsMock.mockReset()
  getCachedProviderModelsMock.mockReset()
  getCachedAnthropicModelsMock.mockReset()
  getOpenRouterModelsMock.mockReturnValue([])
  getCachedProviderModelsMock.mockReturnValue([])
  getCachedAnthropicModelsMock.mockReturnValue([])
})

describe('getProviderModelIds', () => {
  it('preserves colons in source-qualified model IDs', () => {
    expect(getProviderForAgent('openrouter:vendor/model:variant')).toEqual({ provider: 'openrouter', model: 'vendor/model:variant' })
  })
  it('discovers and routes DeepSeek models', () => {
    getCachedProviderModelsMock.mockImplementation((key) => key === 'deepseek_models_cache' ? ['deepseek-flash', 'deepseek-new'] : [])
    expect(getProviderModelIds(providerByName('deepseek'))).toEqual(['deepseek-flash', 'deepseek-v4-pro', 'deepseek-new'])
    expect(getProviderForAgent('deepseek-v4-pro')).toEqual({ provider: 'deepseek', model: 'deepseek-v4-pro' })
    expect(getProviderForAgent('deepseek:deepseek-new')).toEqual({ provider: 'deepseek', model: 'deepseek-new' })
  })
  it('returns the live OpenRouter cache for openrouter', () => {
    getOpenRouterModelsMock.mockReturnValue(['anthropic/claude-sonnet-4-6', 'openai/gpt-5.5'])
    expect(getProviderModelIds(providerByName('openrouter'))).toEqual([
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-5.5',
    ])
  })

  it('merges live Anthropic models, deduping dotted/dashed/dated spellings', () => {
    getCachedAnthropicModelsMock.mockReturnValue([
      { id: 'claude-opus-4-8-20260515', label: 'x' }, // same model as static claude-opus-4.8
      { id: 'claude-sonnet-5-20260101', label: 'y' }, // genuinely new → surfaced
    ])
    const ids = getProviderModelIds(providerByName('anthropic'))
    // Static entries preserved, in order, with curated dotted spelling
    expect(ids.slice(0, providerByName('anthropic').models.length)).toEqual(
      providerByName('anthropic').models,
    )
    // The dated duplicate of opus-4.8 is not added again
    expect(ids).not.toContain('claude-opus-4-8-20260515')
    // The newly released model is appended (raw API id preserved)
    expect(ids).toContain('claude-sonnet-5-20260101')
  })

  it('merges live OpenAI models from the cache', () => {
    getCachedProviderModelsMock.mockImplementation((key: string) =>
      key === 'openai_models_cache' ? ['gpt-5.5', 'gpt-6-turbo'] : [],
    )
    const ids = getProviderModelIds(providerByName('openai'))
    expect(ids).toContain('gpt-6-turbo') // new model surfaced
    // gpt-5.5 already static → not duplicated
    expect(ids.filter((id) => id === 'gpt-5.5')).toHaveLength(1)
  })

  it('falls back to the static list when no cache exists', () => {
    expect(getProviderModelIds(providerByName('groq'))).toEqual(providerByName('groq').models)
  })
})

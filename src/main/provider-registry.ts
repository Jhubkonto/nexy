import type { ProviderName } from './provider-core-types'
import { getOpenRouterModels, getCachedProviderModels, retrieveApiKey } from './provider-secrets'
import { getCachedAnthropicModels } from './anthropic-models'

export const DEFAULT_PROVIDER_MODEL = 'gpt-5-mini'
export const OPENAI_COMPATIBLE_PROVIDERS: ProviderName[] = ['openrouter', 'groq', 'mistral', 'gemini', 'xai', 'deepseek']

export interface ProviderConfig {
  name: ProviderName
  label: string
  apiKeySettingKey: string
  models: string[]
  baseUrl?: string
}

export const PROVIDERS: ProviderConfig[] = [
  {
    name: 'deepseek', label: 'DeepSeek', apiKeySettingKey: 'byok_deepseek_key',
    baseUrl: 'https://api.deepseek.com', models: ['deepseek-flash', 'deepseek-v4-pro']
  },
  {
    name: 'openai',
    label: 'OpenAI',
    apiKeySettingKey: 'byok_openai_key',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini']
  },
  {
    name: 'anthropic',
    label: 'Anthropic',
    apiKeySettingKey: 'byok_anthropic_key',
    models: ['claude-opus-4.8', 'claude-opus-4.7', 'claude-opus-4.6', 'claude-opus-4.5', 'claude-sonnet-4.6', 'claude-sonnet-4.5', 'claude-sonnet-4', 'claude-haiku-4.5', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229']
  },
  {
    name: 'azure',
    label: 'Azure OpenAI',
    apiKeySettingKey: 'byok_azure_key',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
  },
  {
    name: 'gemini',
    label: 'Google Gemini',
    apiKeySettingKey: 'byok_gemini_key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']
  },
  {
    name: 'mistral',
    label: 'Mistral',
    apiKeySettingKey: 'byok_mistral_key',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'open-mistral-7b']
  },
  {
    name: 'groq',
    label: 'Groq',
    apiKeySettingKey: 'byok_groq_key',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it']
  },
  {
    name: 'xai',
    label: 'xAI (Grok)',
    apiKeySettingKey: 'byok_xai_key',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-3', 'grok-3-mini', 'grok-2-1212']
  },
  {
    name: 'openrouter',
    label: 'OpenRouter',
    apiKeySettingKey: 'byok_openrouter_key',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: []
  }
]

const MODEL_TO_PROVIDER = new Map<string, ProviderName>(
  PROVIDERS.flatMap((p) => p.models.map((m) => [m, p.name] as [string, ProviderName]))
)

// Providers whose live `/models` listing we cache and merge into the dropdowns.
// (Anthropic and OpenRouter have their own dedicated caches handled below.)
const PROVIDER_MODEL_CACHE_KEYS: Partial<Record<ProviderName, string>> = {
  openai: 'openai_models_cache',
  gemini: 'gemini_models_cache',
  azure: 'azure_models_cache',
  deepseek: 'deepseek_models_cache',
}

/**
 * Collapses ID spelling differences so the same model from the static registry
 * and from a live `/models` fetch dedupes to one entry. Handles Anthropic's
 * dotted-vs-dashed-vs-dated forms (`claude-opus-4.8` ⇔ `claude-opus-4-8` ⇔
 * `claude-opus-4-8-20260515`) and `-latest` aliases.
 */
function normalizeModelKey(id: string): string {
  return id
    .toLowerCase()
    .replace(/^~+/, '')
    .replace(/\./g, '-')
    .replace(/-latest$/, '')
    .replace(/-\d{8}$/, '')
}

/**
 * Merges the hand-maintained static list with live-fetched IDs, keeping the
 * static entries first (stable, human-readable) and appending any live model
 * not already represented. Deduped by {@link normalizeModelKey} so a freshly
 * released model surfaces once while known models keep their curated spelling.
 */
function mergeModelIds(staticIds: string[], liveIds: string[]): string[] {
  const merged = [...staticIds]
  const seen = new Set(staticIds.map(normalizeModelKey))
  for (const id of liveIds) {
    const key = normalizeModelKey(id)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(id)
  }
  return merged
}

/**
 * The authoritative list of model IDs to surface for a configured provider.
 * Shared by the desktop dropdowns (`model-availability.ts`) and the Android
 * companion (`ws-handlers.ts`) so both stay in sync. Merges live provider
 * `/models` caches into the static registry where available.
 */
export function getProviderModelIds(provider: ProviderConfig): string[] {
  if (provider.name === 'openrouter') return getOpenRouterModels()
  if (provider.name === 'anthropic') {
    return mergeModelIds(provider.models, getCachedAnthropicModels().map((m) => m.id))
  }
  const cacheKey = PROVIDER_MODEL_CACHE_KEYS[provider.name]
  if (cacheKey) return mergeModelIds(provider.models, getCachedProviderModels(cacheKey))
  return provider.models
}

export function getProviderForAgent(agentModel: string): { provider: ProviderName; model: string } {
  const cleanedModel = (agentModel || '').replace(/^~+/, '')
  const normalizedModel = !cleanedModel || cleanedModel === 'default' ? DEFAULT_PROVIDER_MODEL : cleanedModel

  if (normalizedModel.includes(':')) {
    const separator = normalizedModel.indexOf(':')
    const prefix = normalizedModel.slice(0, separator)
    const model = normalizedModel.slice(separator + 1)
    const provider = PROVIDERS.find((p) => p.name === prefix)
    if (provider) return { provider: provider.name, model }
  }

  if (normalizedModel.includes('/')) {
    return { provider: 'openrouter', model: normalizedModel }
  }

  const staticProvider = MODEL_TO_PROVIDER.get(normalizedModel)
  if (staticProvider) return { provider: staticProvider, model: normalizedModel }
  if (normalizedModel.startsWith('deepseek-')) return { provider: 'deepseek', model: normalizedModel }

  const orModels = getOpenRouterModels()
  if (orModels.includes(normalizedModel)) {
    return { provider: 'openrouter', model: normalizedModel }
  }

  if (normalizedModel.startsWith('claude')) {
    return { provider: 'anthropic', model: normalizedModel }
  }

  return { provider: 'openai', model: normalizedModel }
}

export function isProviderConfigured(provider: ProviderName): boolean {
  return !!retrieveApiKey(provider)
}

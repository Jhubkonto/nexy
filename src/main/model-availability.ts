import { detectCli, getCliModels, getHermesProfileDiscovery } from './cli-detection'
import { getClaudeCliModelChoices } from './cli-adapters/claude-model-probe'
import {
  PROVIDERS,
  isProviderConfigured,
  getProviderModelIds,
  getOpenRouterModels,
  fetchAndCacheOpenRouterModels,
  fetchAndCacheOpenAIModels,
  fetchAndCacheGeminiModels,
  fetchAndCacheDeepSeekModels,
  fetchAndCacheAzureModels,
  getCachedProviderModels,
  getAzureEndpoint,
  retrieveApiKey,
} from './providers'
import { fetchAndCacheAnthropicModels, getCachedAnthropicModels } from './anthropic-models'
import { MODEL_LABELS } from '../shared/models'
import { safeHandle } from './safe-handle'
import { debugTime, debugTimeEnd } from './debug-mode'
import { HERMES_DEFAULT_PROFILE, hermesProfileLabel, hermesSourceKey } from '../shared/hermes'
import type { AvailableModelGroup, AvailableModelGroupOptions, HermesProfileInfo } from '../shared/types'

/** `default` first, then named profiles alphabetically. */
function compareHermesProfiles(a: HermesProfileInfo, b: HermesProfileInfo): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
  return a.name.localeCompare(b.name)
}

/**
 * One picker group per discovered Hermes profile, keyed `hermes-cli:<profile>`. Model IDs stay
 * bare; the profile travels in the group key and is persisted beside the model. Each profile's
 * model list is read once per call.
 */
export function getHermesProfileModelGroups(): AvailableModelGroup[] {
  let profiles: HermesProfileInfo[]
  try {
    profiles = getHermesProfileDiscovery().profiles
  } catch {
    profiles = []
  }
  if (!profiles.some((profile) => profile.name === HERMES_DEFAULT_PROFILE)) {
    profiles = [{ name: HERMES_DEFAULT_PROFILE, isDefault: true }, ...profiles]
  }
  const seen = new Set<string>()
  const groups: AvailableModelGroup[] = []
  for (const profile of [...profiles].sort(compareHermesProfiles)) {
    if (seen.has(profile.name)) continue
    seen.add(profile.name)
    const models = getCliModels('hermes-cli', profile.isDefault ? undefined : profile.name)
    if (models.length === 0) continue
    const description = [profile.model, profile.description].filter((part): part is string => !!part?.trim()).join(' · ')
    groups.push({
      sourceKey: hermesSourceKey(profile.name),
      sourceLabel: hermesProfileLabel(profile.name, profile.isDefault),
      sourceType: 'cli',
      models,
      ...(description ? { description } : {}),
    })
  }
  return groups
}

/**
 * @param hermesProfile When the caller is scoped to a specific agent whose backend is Hermes,
 *   its profile name — so the Hermes group reflects that profile's own `config.yaml` model
 *   rather than the default profile's (a localllm-scoped agent otherwise shows the wrong model).
 */
export async function getAvailableModelGroups(hermesProfile?: string, options: AvailableModelGroupOptions = {}): Promise<AvailableModelGroup[]> {
  const groups: AvailableModelGroup[] = []
  const [claude, codex, hermes] = await Promise.all([
    detectCli('claude'),
    detectCli('codex'),
    detectCli('hermes'),
  ])

  if (claude.installed) {
    const models = getClaudeCliModelChoices()
    if (models.length > 0) {
      groups.push({ sourceKey: 'claude-cli', sourceLabel: 'Claude CLI', sourceType: 'cli', models })
    }
  }

  if (codex.installed) {
    const models = getCliModels('codex-cli')
    if (models.length > 0) {
      groups.push({ sourceKey: 'codex-cli', sourceLabel: 'Codex CLI', sourceType: 'cli', models })
    }
  }

  if (hermes.installed && options.hermesProfileGroups) {
    groups.push(...getHermesProfileModelGroups())
  } else if (hermes.installed) {
    const models = getCliModels('hermes-cli', hermesProfile)
    if (models.length > 0) {
      groups.push({ sourceKey: 'hermes-cli', sourceLabel: 'Hermes Agent', sourceType: 'cli', models })
    }
  }

  for (const provider of PROVIDERS) {
    if (!isProviderConfigured(provider.name)) continue
    const models = getProviderModelIds(provider).map((id) => ({
      id: provider.name === 'azure' ? `azure:${id}` : id,
      label: MODEL_LABELS[id] ?? id,
    }))
    if (models.length > 0) {
      groups.push({ sourceKey: provider.name, sourceLabel: provider.label, sourceType: 'provider', models })
    }
  }

  return groups
}

export function registerModelAvailabilityHandlers(): void {
  safeHandle('model:list-available', async (_event, hermesProfile?: string, options?: AvailableModelGroupOptions) => {
    debugTime('model:list-available')
    const r = await getAvailableModelGroups(hermesProfile, options && typeof options === 'object' ? { hermesProfileGroups: options.hermesProfileGroups === true } : {})
    debugTimeEnd('model:list-available')
    return r
  })

  // Backfill OpenRouter model cache if key exists but cache is empty (e.g. key was set before cache was introduced)
  if (isProviderConfigured('openrouter') && getOpenRouterModels().length === 0) {
    const key = retrieveApiKey('openrouter')
    if (key) fetchAndCacheOpenRouterModels(key).catch(() => {})
  }

  // Backfill Anthropic model cache if key exists but cache is empty (e.g. key was set before cache was introduced)
  if (isProviderConfigured('anthropic') && getCachedAnthropicModels().length === 0) {
    const key = retrieveApiKey('anthropic')
    if (key) fetchAndCacheAnthropicModels(key).catch(() => {})
  }

  // Backfill OpenAI-compatible provider caches (key set before live fetch existed)
  if (isProviderConfigured('openai') && getCachedProviderModels('openai_models_cache').length === 0) {
    const key = retrieveApiKey('openai')
    if (key) fetchAndCacheOpenAIModels(key).catch(() => {})
  }
  if (isProviderConfigured('gemini') && getCachedProviderModels('gemini_models_cache').length === 0) {
    const key = retrieveApiKey('gemini')
    if (key) fetchAndCacheGeminiModels(key).catch(() => {})
  }
  if (isProviderConfigured('deepseek') && getCachedProviderModels('deepseek_models_cache').length === 0) {
    const key = retrieveApiKey('deepseek')
    if (key) fetchAndCacheDeepSeekModels(key).catch(() => {})
  }
  if (isProviderConfigured('azure') && getCachedProviderModels('azure_models_cache').length === 0) {
    const key = retrieveApiKey('azure')
    const endpoint = getAzureEndpoint()
    if (key && endpoint) fetchAndCacheAzureModels(key, endpoint).catch(() => {})
  }
}

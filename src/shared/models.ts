import type { CatalogModel } from './types'

/**
 * Single canonical definition of the models Nexy knows about. Labels, billing
 * multipliers, and the static catalog seed are all derived from this list so
 * they cannot drift out of sync. `capabilities` defaults to tool-capable when
 * omitted (see {@link getStaticCatalogSeed}). Multipliers are sourced from the
 * GitHub Copilot billing docs.
 *
 * This is the label/billing catalog — NOT the per-provider offering list. Which
 * provider surfaces which model lives in `provider-registry.ts`; entries here
 * without a matching provider model simply provide labels/multipliers for IDs
 * that arrive from live provider `/models` fetches.
 */
export interface KnownModel {
  id: string
  name: string
  vendor: string
  capabilities?: string[]
  multiplier?: number
}

export const KNOWN_MODELS: KnownModel[] = [
  { id: 'deepseek-flash', name: 'DeepSeek Flash', vendor: 'DeepSeek', capabilities: ['tool_calls', 'vision'] },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', vendor: 'DeepSeek' },
  { id: 'gpt-5.5',            name: 'GPT-5.5',            vendor: 'OpenAI',    multiplier: 57 },
  { id: 'gpt-5.4',            name: 'GPT-5.4',            vendor: 'OpenAI',    multiplier: 6 },
  { id: 'gpt-5.4-mini',       name: 'GPT-5.4 mini',       vendor: 'OpenAI',    multiplier: 6 },
  { id: 'gpt-5.3-codex',      name: 'GPT-5.3-Codex',      vendor: 'OpenAI',    multiplier: 6 },
  { id: 'gpt-5.2-codex',      name: 'GPT-5.2-Codex',      vendor: 'OpenAI',    multiplier: 3 },
  { id: 'gpt-5.2',            name: 'GPT-5.2',            vendor: 'OpenAI',    multiplier: 3 },
  { id: 'gpt-5.1',            name: 'GPT-5.1',            vendor: 'OpenAI',    multiplier: 3 },
  { id: 'gpt-5.1-codex',      name: 'GPT-5.1-Codex',      vendor: 'OpenAI',    multiplier: 3 },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1-Codex mini', vendor: 'OpenAI',    multiplier: 0.33 },
  { id: 'gpt-5.1-codex-max',  name: 'GPT-5.1-Codex max',  vendor: 'OpenAI',    multiplier: 3 },
  { id: 'gpt-5-mini',         name: 'GPT-5 mini',         vendor: 'OpenAI',    multiplier: 0.33 },
  { id: 'gpt-4.1',            name: 'GPT-4.1',            vendor: 'OpenAI',    multiplier: 1 },
  { id: 'gpt-4o',             name: 'GPT-4o',             vendor: 'OpenAI',    multiplier: 0.33 },
  { id: 'gpt-4o-mini',        name: 'GPT-4o mini',        vendor: 'OpenAI',    multiplier: 0.33 },
  { id: 'claude-opus-4.8',    name: 'Claude Opus 4.8',    vendor: 'Anthropic', multiplier: 27 },
  { id: 'claude-opus-4.7',    name: 'Claude Opus 4.7',    vendor: 'Anthropic', multiplier: 27 },
  { id: 'claude-opus-4.6',    name: 'Claude Opus 4.6',    vendor: 'Anthropic', multiplier: 27 },
  { id: 'claude-opus-4.5',    name: 'Claude Opus 4.5',    vendor: 'Anthropic', multiplier: 15 },
  { id: 'claude-sonnet-4.6',  name: 'Claude Sonnet 4.6',  vendor: 'Anthropic', multiplier: 9 },
  { id: 'claude-sonnet-4.5',  name: 'Claude Sonnet 4.5',  vendor: 'Anthropic', multiplier: 6 },
  { id: 'claude-sonnet-4',    name: 'Claude Sonnet 4',    vendor: 'Anthropic', multiplier: 6 },
  { id: 'claude-haiku-4.5',   name: 'Claude Haiku 4.5',   vendor: 'Anthropic', multiplier: 0.33 },
]

export function resolveVisionSupported(providerName: string, modelId: string | null | undefined): boolean {
  if (providerName !== 'deepseek') return true
  return ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes((modelId ?? '').toLowerCase())
}

export const MODEL_LABELS: Record<string, string> = Object.fromEntries(
  KNOWN_MODELS.map((m) => [m.id, m.name])
)

// Multipliers keyed by model ID — derived from KNOWN_MODELS.
const MODEL_MULTIPLIERS: Record<string, number> = Object.fromEntries(
  KNOWN_MODELS.filter((m) => m.multiplier !== undefined).map((m) => [m.id, m.multiplier as number])
)

/**
 * Static catalog seed derived from {@link KNOWN_MODELS}. Consumed by the
 * main-process model catalog (`model-catalog.ts`) so the dropdown catalog and
 * the label/multiplier maps share one source of truth.
 */
export function getStaticCatalogSeed(): CatalogModel[] {
  return KNOWN_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    vendor: m.vendor,
    capabilities: m.capabilities ?? ['tool_calls'],
    ...(m.multiplier !== undefined ? { multiplier: m.multiplier } : {}),
  }))
}

// Fallback multipliers keyed by display name for models whose API IDs are not
// known in advance (e.g. Gemini models). The API may not return billing data
// for all models, so this covers the gap.
const MODEL_MULTIPLIERS_BY_NAME: Record<string, number> = {
  'Gemini 2.5 Pro':            1,
  'Gemini 3 Flash':            0.33,
  'Gemini 3 Flash (Preview)':  0.33,
  'Gemini 3 Pro':              6,
  'Gemini 3.1 Pro':            6,
  'Gemini 3.5 Flash':          14,
  'GPT-4o':                    0.33,
  'GPT-4o mini':               0.33,
  'Raptor mini':               0.33,
  'Raptor mini (Preview)':     0.33,
}

export function getModelLabel(model: string | null | undefined, catalog?: CatalogModel[], globalDefaultModel?: string): string {
  if (!model || model === 'default') {
    if (globalDefaultModel && globalDefaultModel !== 'default') {
      return `Global default (${getModelLabel(globalDefaultModel, catalog)})`
    }
    return 'Global default'
  }
  if (catalog?.length) {
    const entry = catalog.find((item) => item.id === model)
    if (entry) return entry.name
  }
  return MODEL_LABELS[model] ?? model
}

/** Preserve the chosen source while avoiding a second prefix for Azure deployments. */
export function sourceQualifiedModel(sourceKey: string, modelId: string): string {
  return modelId.startsWith(`${sourceKey}:`) ? modelId : `${sourceKey}:${modelId}`
}

export function getModelMultiplier(model: string | null | undefined, catalog?: CatalogModel[]): string | null {
  if (!model || model === 'default') return null

  // 1. Prefer live value from API catalog
  if (catalog?.length) {
    const entry = catalog.find((item) => item.id === model)
    if (entry?.multiplier !== undefined) return formatMultiplier(entry.multiplier)

    // 2. Name-based fallback for models the API doesn't include billing data for
    if (entry) {
      const byName = MODEL_MULTIPLIERS_BY_NAME[entry.name]
      if (byName !== undefined) return formatMultiplier(byName)
    }
  }

  // 3. Static ID-based map
  const byId = MODEL_MULTIPLIERS[model]
  if (byId !== undefined) return formatMultiplier(byId)

  return null
}

function formatMultiplier(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return `${rounded}x`
}

/**
 * Returns true if this model supports tool calling.
 * Models with an empty capabilities array are treated as tool-capable
 * (optimistic fallback for static/cached entries that predate capability data).
 */
export function modelSupportsTools(model: CatalogModel): boolean {
  return model.capabilities.length === 0 || model.capabilities.includes('tool_calls')
}

/**
 * Returns true if the given model ID supports tool calling.
 * Unknown or 'default' model IDs are treated as tool-capable (optimistic).
 */
export function modelIdSupportsTools(modelId: string | null | undefined, catalog?: CatalogModel[]): boolean {
  if (!modelId || modelId === 'default') return true
  const entry = catalog?.find((m) => m.id === modelId)
  if (!entry) return true // unknown model → optimistic
  return modelSupportsTools(entry)
}

const OPENROUTER_TOOL_CAPABLE_FAMILIES = ['claude', 'gpt-4', 'gpt-4o', 'gemini', 'mistral-large', 'llama-3', 'qwen']

/**
 * Resolves whether tool calling should be attempted for a given provider/model, accounting for
 * OpenRouter's mixed catalog: some models advertise accurate `capabilities` (used directly),
 * but many (e.g. Hermes/Nous-family models) have no catalog entry and, even when OpenRouter's
 * API accepts a `tools` payload for them without erroring, emit their own pretrained pseudo-tool-call
 * syntax as plain text instead of populating a structured tool-call response — silently producing
 * unusable output rather than a clear error. For OpenRouter models with no catalog hit, only a
 * known-capable family allowlist is treated as tool-capable; everything else is conservatively
 * treated as NOT tool-capable, matching the same heuristic chat dispatch already uses.
 */
export function resolveToolsSupported(
  providerName: string,
  modelId: string | null | undefined,
  catalog?: CatalogModel[],
): boolean {
  if (providerName !== 'openrouter') return modelIdSupportsTools(modelId, catalog)
  if (!modelId || modelId === 'default') return true
  const entry = catalog?.find((m) => m.id === modelId)
  if (entry) return modelSupportsTools(entry)
  const id = modelId.toLowerCase().replace(/^~/, '')
  return OPENROUTER_TOOL_CAPABLE_FAMILIES.some((family) => id.includes(family))
}

export function getAvailableModelIds(
  catalog?: CatalogModel[],
  currentModel?: string | null,
  requiresTools?: boolean,
): string[] {
  const filtered = requiresTools
    ? (catalog ?? []).filter(modelSupportsTools)
    : (catalog ?? [])

  const ids: string[] = filtered.length > 0 || catalog?.length
    ? ['default', ...filtered.map((model) => model.id)]
    : ['default']

  const seen = new Set(ids)

  // Always include the current selection even if it doesn't support tools so
  // the active model isn't silently hidden; callers should auto-fallback
  // separately when the model is incompatible.
  if (currentModel && currentModel !== 'default' && !seen.has(currentModel)) {
    ids.push(currentModel)
  }

  return ids
}

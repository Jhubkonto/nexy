import { randomUUID } from 'crypto'
import { app, type BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import {
  DEFAULT_PROVIDER_MODEL,
  PROVIDERS,
  getOpenRouterModels,
  getProviderForAgent,
  getProviderCredential,
  isProviderConfigured,
} from './providers'
import { dispatchToProvider } from './chat-provider-dispatch'
import { getAdapter } from './cli-adapters/registry'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { getCliModels } from './cli-detection'
import { isClaudeCliModelOrCandidate } from './cli-adapters/claude-model-probe'
import type { ProviderMessage } from './provider-core-types'
import type { SkillGeneratorMessage, SkillGeneratorSpec } from '../shared/types'
import { getDatabase } from './database'
import { broadcastToMobile } from './ws-server'
import { startActivity, endActivity } from './activity-tracker'
import { createSkillConfig } from './skills'

const SPEC_OPEN_TAG = '<skill-spec>'
const SPEC_CLOSE_TAG = '</skill-spec>'

const SKILL_GENERATOR_SYSTEM_PROMPT = `You are an expert skill configuration assistant for Nexy, an AI-powered desktop application.

Your job is to help the user create a reusable Agent Skills package. A skill contains activation metadata and reusable instructions. It may describe required capabilities, but it must never grant tools, approvals, or MCP trust; those belong to the agent and user permission policy.

## Conversation style
- Ask focused questions only when needed: task type, activation conditions, boundaries, references, and agents that may use it
- Be concise
- When enough context is available, emit the skill spec

## Skill instructions
Write instructions in second person, as reusable behavior guidance. Include:
1. When to use this skill
2. What process to follow
3. What to avoid
4. Expected output shape when helpful

When ready, emit a brief summary followed immediately by JSON wrapped in <skill-spec>…</skill-spec> tags. The JSON must match:

{
  "name": "Skill Name",
  "icon": "✨",
  "description": "Short summary",
  "instructions": "Reusable instructions...",
  "tools": { "fileEdit": false, "terminal": false, "webFetch": false },
  "toolInstructions": {},
  "approval": {},
  "mcpServers": [],
  "tags": [],
  "knowledge": [{ "title": "Optional note", "content": "..." }],
  "suggestedAgents": []
}`

let _skillGeneratorModel: string | null = null

export function getSkillGeneratorModel(): string {
  if (_skillGeneratorModel) return _skillGeneratorModel
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'default_model'").get() as { value: string } | undefined
  const savedModel = row?.value && row.value !== 'default' ? row.value : DEFAULT_PROVIDER_MODEL
  const savedProvider = getProviderForAgent(savedModel)
  if (isProviderConfigured(savedProvider.provider)) return savedModel

  if (ClaudeAdapter.isAvailable() && isClaudeCliModelOrCandidate(savedModel)) {
    return `claude-cli:${savedModel}`
  }
  if (CodexAdapter.isAvailable() && getCliModels('codex-cli').some((m) => m.id === savedModel)) {
    return `codex-cli:${savedModel}`
  }

  const fallbackProvider = PROVIDERS.find((p) => isProviderConfigured(p.name) && p.models.length > 0)
  if (fallbackProvider?.models[0]) {
    return fallbackProvider.name === 'openai'
      ? fallbackProvider.models[0]
      : `${fallbackProvider.name}:${fallbackProvider.models[0]}`
  }
  const openRouterModel = isProviderConfigured('openrouter') ? getOpenRouterModels()[0] : undefined
  if (openRouterModel) return `openrouter:${openRouterModel}`
  throw new Error('No provider is configured. Add an API key in Settings or select a specific model.')
}

function buildProviderMessages(messages: SkillGeneratorMessage[]): ProviderMessage[] {
  const filtered = messages[0]?.role === 'assistant' ? messages.slice(1) : messages
  return [
    { role: 'system', content: SKILL_GENERATOR_SYSTEM_PROMPT },
    ...filtered.map((m): ProviderMessage => ({ role: m.role, content: m.content })),
  ]
}

function extractSpec(text: string): SkillGeneratorSpec | null {
  const openIdx = text.lastIndexOf(SPEC_OPEN_TAG)
  if (openIdx === -1) return null
  const closeIdx = text.lastIndexOf(SPEC_CLOSE_TAG)
  if (closeIdx === -1 || closeIdx <= openIdx) return null
  const json = text.slice(openIdx + SPEC_OPEN_TAG.length, closeIdx).trim()
  try {
    return normalizeSpec(JSON.parse(json) as Record<string, unknown>)
  } catch {
    return null
  }
}

const TOOL_KEYS = ['fileEdit', 'terminal', 'webFetch'] as const
const VALID_APPROVALS = new Set(['auto', 'always-ask', 'disabled'])

function normalizeSpec(raw: Record<string, unknown>): SkillGeneratorSpec {
  const rawTools = (raw.tools && typeof raw.tools === 'object' ? raw.tools : {}) as Record<string, unknown>
  const rawToolInstructions = (raw.toolInstructions && typeof raw.toolInstructions === 'object' ? raw.toolInstructions : {}) as Record<string, unknown>
  const rawApproval = (raw.approval && typeof raw.approval === 'object' ? raw.approval : {}) as Record<string, unknown>
  const toolInstructions: SkillGeneratorSpec['toolInstructions'] = {}
  const approval: SkillGeneratorSpec['approval'] = {}

  for (const key of TOOL_KEYS) {
    if (typeof rawToolInstructions[key] === 'string') toolInstructions[key] = rawToolInstructions[key] as string
    approval[key] = VALID_APPROVALS.has(String(rawApproval[key]))
      ? rawApproval[key] as 'auto' | 'always-ask' | 'disabled'
      : 'always-ask'
  }

  return {
    name: String(raw.name || 'New Skill').trim().slice(0, 100),
    icon: typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim().slice(0, 8) : '✨',
    description: typeof raw.description === 'string' ? raw.description : '',
    instructions: typeof raw.instructions === 'string' ? raw.instructions : '',
    tools: {
      fileEdit: rawTools.fileEdit === true,
      terminal: rawTools.terminal === true,
      webFetch: rawTools.webFetch === true,
    },
    toolInstructions,
    approval,
    mcpServers: Array.isArray(raw.mcpServers) ? raw.mcpServers.filter((v): v is string => typeof v === 'string') : [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter((v): v is string => typeof v === 'string') : [],
    knowledge: Array.isArray(raw.knowledge) ? raw.knowledge.filter(isKnowledgeEntry) : [],
    suggestedAgents: Array.isArray(raw.suggestedAgents) ? raw.suggestedAgents.filter((v): v is string => typeof v === 'string') : [],
  }
}

function isKnowledgeEntry(value: unknown): value is { title: string; content: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).title === 'string' &&
    typeof (value as Record<string, unknown>).content === 'string'
  )
}

async function runSkillGeneratorProviderChat(
  win: BrowserWindow,
  providerMessages: ProviderMessage[],
  sessionId: string,
  webContents: Electron.WebContents,
  sendChunk: (chunk: string) => void,
  modelOverride?: string,
): Promise<string> {
  const selectedModel = modelOverride ?? getSkillGeneratorModel()

  let cliBackend: 'claude-cli' | 'codex-cli' | undefined
  let cliModel = selectedModel
  if (selectedModel.includes(':')) {
    const colonIdx = selectedModel.indexOf(':')
    const prefix = selectedModel.slice(0, colonIdx)
    if (prefix === 'claude-cli' || prefix === 'codex-cli') {
      cliBackend = prefix
      cliModel = selectedModel.slice(colonIdx + 1)
    }
  } else if (ClaudeAdapter.isAvailable() && isClaudeCliModelOrCandidate(selectedModel)) {
    cliBackend = 'claude-cli'
  } else if (CodexAdapter.isAvailable() && getCliModels('codex-cli').some((m) => m.id === selectedModel)) {
    cliBackend = 'codex-cli'
  }
  if (cliBackend) {
    const adapter = getAdapter(cliBackend)
    if (!adapter?.isAvailable()) throw new Error(`${cliBackend} is not available`)
    const systemMsg = typeof providerMessages[0]?.content === 'string' && providerMessages[0].role === 'system'
      ? providerMessages[0].content
      : SKILL_GENERATOR_SYSTEM_PROMPT
    const conversationMessages = providerMessages.filter((m) => m.role !== 'system')
    return adapter.send(
      win,
      { systemPrompt: systemMsg, messages: conversationMessages, cwd: app.getPath('temp'), model: cliModel, conversationId: sessionId },
      sendChunk,
    )
  }

  const { provider, model } = getProviderForAgent(selectedModel)
  const credential = getProviderCredential(provider)
  const systemPrompt = typeof providerMessages[0]?.content === 'string'
    ? providerMessages[0].content
    : SKILL_GENERATOR_SYSTEM_PROMPT

  return dispatchToProvider({
    providerName: provider,
    providerModel: model,
    credential: credential ?? undefined,
    byokKey: credential ?? undefined,
    chatMessages: providerMessages,
    toolDefs: [],
    toolMap: new Map(),
    effectiveAgentId: null,
    agenticMode: false,
    wikiInlineHandlers: new Map(),
    toolDirective: '',
    generationOptions: { maxTokens: 4096, temperature: 0.7 },
    conversationId: sessionId,
    webContents,
    sendChunk,
    sendActivity: () => {},
    systemPrompt,
  })
}

export async function runSkillGeneratorChat(
  win: BrowserWindow,
  messages: SkillGeneratorMessage[],
  modelOverride?: string,
): Promise<void> {
  const providerMessages = buildProviderMessages(messages)
  const sessionId = `skill-gen-${randomUUID()}`
  let accumulated = ''

  startActivity({ id: 'skill-generator', kind: 'skill-generator', label: 'Generating skill…' })
  try {
    const fullText = await runSkillGeneratorProviderChat(
      win,
      providerMessages,
      sessionId,
      win.webContents,
      (chunk) => {
        accumulated += chunk
        if (!win.isDestroyed()) win.webContents.send('skill-generator:token', chunk)
      },
      modelOverride,
    )

    accumulated = fullText || accumulated
    if (!accumulated.trim()) {
      throw new Error(`Skill generator returned no response from ${modelOverride ?? getSkillGeneratorModel()}. Check the selected model/provider or choose a different model.`)
    }

    const spec = extractSpec(accumulated)
    if (!win.isDestroyed()) {
      if (spec) win.webContents.send('skill-generator:spec-ready', spec)
      win.webContents.send('skill-generator:done', { hasSpec: spec !== null })
    }
  } catch (error) {
    if (!win.isDestroyed()) {
      win.webContents.send('skill-generator:error', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  } finally {
    endActivity('skill-generator')
  }
}

export async function runSkillGeneratorChatForAndroid(
  messages: SkillGeneratorMessage[],
  sessionId = `skill-gen-android-${randomUUID()}`,
  modelOverride?: string,
): Promise<void> {
  const providerMessages = buildProviderMessages(messages)
  const fakeWin = { isDestroyed: () => false, webContents: { send: () => {}, isDestroyed: () => false } } as unknown as BrowserWindow

  let accumulated = ''

  startActivity({ id: 'skill-generator', kind: 'skill-generator', label: 'Generating skill…' })
  try {
    const fullText = await runSkillGeneratorProviderChat(
      fakeWin,
      providerMessages,
      sessionId,
      fakeWin.webContents,
      (chunk) => {
        accumulated += chunk
        broadcastToMobile({ event: 'skill-generator:token', data: { sessionId, chunk } })
      },
      modelOverride,
    )

    accumulated = fullText || accumulated
    if (!accumulated.trim()) {
      broadcastToMobile({ event: 'skill-generator:error', data: { sessionId, message: 'Skill generator returned no response. Check the selected model/provider.' } })
      return
    }

    const spec = extractSpec(accumulated)
    const assistantText = accumulated.replace(/<skill-spec>[\s\S]*?<\/skill-spec>/g, '').trim()
    broadcastToMobile({ event: 'skill-generator:turn-complete', data: { sessionId, content: assistantText, hasSpec: spec !== null } })
    if (spec) {
      broadcastToMobile({ event: 'skill-generator:spec-ready', data: { sessionId, spec } })
    }
  } finally {
    endActivity('skill-generator')
  }
}

export async function createSkillFromSpec(spec: SkillGeneratorSpec): Promise<{ skillId: string; name: string }> {
  const result = await createSkillConfig({
    name: spec.name,
    icon: spec.icon,
    description: spec.description,
    instructions: spec.instructions,
    tags: spec.tags ?? [],
    knowledge: spec.knowledge ?? [],
  })
  return { skillId: result.id, name: spec.name }
}

export function registerSkillGeneratorHandlers(win?: BrowserWindow): void {
  safeHandle('skill-generator:chat', async (_event, messages: SkillGeneratorMessage[], modelOverride?: string) => {
    if (!win) throw new Error('No main window available')
    await runSkillGeneratorChat(win, messages, modelOverride)
    return { started: true }
  })

  safeHandle('skill-generator:get-model', () => getSkillGeneratorModel())

  safeHandle('skill-generator:set-model', (_event, modelId: string) => {
    _skillGeneratorModel = modelId || null
    return undefined
  })
}

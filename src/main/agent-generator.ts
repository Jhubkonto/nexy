import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
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
import { getCliModels } from './cli-detection'
import { isClaudeCliModelOrCandidate } from './cli-adapters/claude-model-probe'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import type { ProviderMessage } from './provider-core-types'
import type { AgentGeneratorMessage, AgentGeneratorSpec } from '../shared/types'
import { getDatabase } from './database'
import { broadcastToMobile } from './ws-server'
import { startActivity, endActivity } from './activity-tracker'

const SPEC_OPEN_TAG = '<agent-spec>'
const SPEC_CLOSE_TAG = '</agent-spec>'

const AGENT_GENERATOR_SYSTEM_PROMPT = `You are an expert agent configuration assistant for Nexy, an AI-powered multi-agent desktop application.

Your job is to help the user create a perfectly configured Nexy agent through a brief, focused conversation and then emit a complete agent configuration.

## Conversation style
- Ask 2–3 targeted questions per turn — purpose, domain, output style, codebase/file access, restrictions
- Be concise and friendly
- After 2–3 exchanges, emit the agent spec

## Tool guidance (set per agent purpose)
- Coding / file-editing agents: fileEdit: true, terminal: true, webFetch: false
- Research / web-browsing agents: fileEdit: false, terminal: false, webFetch: true
- Full-stack agents: fileEdit: true, terminal: true, webFetch: true
- Read-only review / Q&A agents: fileEdit: false, terminal: false, webFetch: false

## Temperature guidance
- 0.3 — coding assistants, precise structured tasks
- 0.7 — general-purpose, conversation
- 1.0 — creative writing, brainstorming

## Agentic mode
Enable agenticMode for agents that perform long autonomous multi-step tasks. Disable for single-turn Q&A helpers.

## System prompt writing
Write the agent's system prompt in second person ("You are…"). Include:
1. A clear persona statement
2. The primary responsibility
3. Tone / communication style
4. Any explicit constraints or out-of-scope rules
5. Example output format when helpful

## Generating the spec
When you have enough context, emit a brief conversational summary followed immediately by a JSON block wrapped in <agent-spec>…</agent-spec> tags. The JSON must match this exact shape:

{
  "name": "Agent Name",
  "icon": "🤖",
  "systemPrompt": "You are …",
  "temperature": 0.7,
  "responseFormat": "default",
  "agenticMode": false,
  "tools": { "fileEdit": false, "terminal": false, "webFetch": false },
  "contextDirectories": [],
  "memory": "",
  "customCommands": []
}

responseFormat must be one of: "default", "concise", "detailed", "code-only".
Only include rootDirectory if the user explicitly mentions a specific working directory path — never invent or guess one.
customCommands format: [{ "name": "cmd", "description": "...", "prompt": "..." }]
Emit the spec only once you have enough information (usually after 1–2 exchanges).`

let _agentGeneratorModel: string | null = null

export function getAgentGeneratorModel(): string {
  if (_agentGeneratorModel) return _agentGeneratorModel
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'default_model'").get() as { value: string } | undefined
  const savedModel = row?.value && row.value !== 'default' ? row.value : DEFAULT_PROVIDER_MODEL
  const savedProvider = getProviderForAgent(savedModel)
  if (isProviderConfigured(savedProvider.provider)) return savedModel

  // If the saved model ID matches a CLI model, route it via that CLI
  if (ClaudeAdapter.isAvailable() && isClaudeCliModelOrCandidate(savedModel)) {
    return `claude-cli:${savedModel}`
  }
  if (CodexAdapter.isAvailable() && getCliModels('codex-cli').some((m) => m.id === savedModel)) {
    return `codex-cli:${savedModel}`
  }

  const fallbackProvider = PROVIDERS.find((p) => isProviderConfigured(p.name) && p.models.length > 0)
  if (fallbackProvider?.models[0]) {
    const id = fallbackProvider.name === 'openai' ? fallbackProvider.models[0] : `${fallbackProvider.name}:${fallbackProvider.models[0]}`
    return id
  }
  const openRouterModel = isProviderConfigured('openrouter') ? getOpenRouterModels()[0] : undefined
  if (openRouterModel) return `openrouter:${openRouterModel}`

  throw new Error('No provider is configured. Add an API key in Settings or select a specific model.')
}

function buildProviderMessages(messages: AgentGeneratorMessage[]): ProviderMessage[] {
  // Strip the leading assistant greeting seeded in renderer state before forwarding
  const filtered = messages[0]?.role === 'assistant' ? messages.slice(1) : messages
  return [
    { role: 'system', content: AGENT_GENERATOR_SYSTEM_PROMPT },
    ...filtered.map((m): ProviderMessage => {
      if (m.images && m.images.length > 0 && m.role === 'user') {
        return {
          role: 'user',
          content: [
            ...m.images.map((img) => ({
              type: 'image_url' as const,
              image_url: { url: img.dataUrl },
            })),
            { type: 'text' as const, text: m.content },
          ],
        }
      }
      return { role: m.role, content: m.content }
    }),
  ]
}

function extractSpec(text: string): AgentGeneratorSpec | null {
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

const VALID_RESPONSE_FORMATS = new Set(['default', 'concise', 'detailed', 'code-only'])

function normalizeSpec(raw: Record<string, unknown>): AgentGeneratorSpec {
  const toolsRaw = (raw.tools && typeof raw.tools === 'object' ? raw.tools : {}) as Record<string, unknown>
  return {
    name: String(raw.name || 'New Agent').trim().slice(0, 100),
    icon: typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim() : '🤖',
    systemPrompt: String(raw.systemPrompt || ''),
    temperature: typeof raw.temperature === 'number' ? Math.min(2, Math.max(0, raw.temperature)) : 0.7,
    responseFormat: VALID_RESPONSE_FORMATS.has(String(raw.responseFormat))
      ? String(raw.responseFormat) as AgentGeneratorSpec['responseFormat']
      : 'default',
    agenticMode: raw.agenticMode === true,
    tools: {
      fileEdit: toolsRaw.fileEdit === true,
      terminal: toolsRaw.terminal === true,
      webFetch: toolsRaw.webFetch === true,
    },
    rootDirectory: typeof raw.rootDirectory === 'string' && raw.rootDirectory.trim()
      ? raw.rootDirectory.trim()
      : undefined,
    contextDirectories: Array.isArray(raw.contextDirectories)
      ? (raw.contextDirectories as unknown[]).filter((d): d is string => typeof d === 'string')
      : [],
    memory: typeof raw.memory === 'string' ? raw.memory : undefined,
    customCommands: Array.isArray(raw.customCommands)
      ? (raw.customCommands as unknown[]).filter(isCustomCommand)
      : [],
  }
}

function isCustomCommand(v: unknown): v is { name: string; description: string; prompt: string } {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as Record<string, unknown>).name === 'string' &&
    typeof (v as Record<string, unknown>).prompt === 'string'
  )
}

async function runAgentGeneratorProviderChat(
  win: BrowserWindow,
  providerMessages: ProviderMessage[],
  sessionId: string,
  webContents: Electron.WebContents,
  sendChunk: (chunk: string) => void,
  modelOverride?: string,
): Promise<string> {
  const selectedModel = modelOverride ?? getAgentGeneratorModel()

  // Resolve CLI backend: explicit prefix OR bare model ID that belongs to a CLI
  let cliBackend: 'claude-cli' | 'codex-cli' | undefined
  let cliModel = selectedModel
  if (selectedModel.includes(':')) {
    const colonIdx = selectedModel.indexOf(':')
    const prefix = selectedModel.slice(0, colonIdx)
    if (prefix === 'claude-cli' || prefix === 'codex-cli') {
      cliBackend = prefix
      cliModel = selectedModel.slice(colonIdx + 1)
    }
  } else {
    if (ClaudeAdapter.isAvailable() && isClaudeCliModelOrCandidate(selectedModel)) {
      cliBackend = 'claude-cli'
    } else if (CodexAdapter.isAvailable() && getCliModels('codex-cli').some((m) => m.id === selectedModel)) {
      cliBackend = 'codex-cli'
    }
  }
  if (cliBackend) {
    const adapter = getAdapter(cliBackend)
    if (!adapter?.isAvailable()) throw new Error(`${cliBackend} is not available`)
    const systemMsg = typeof providerMessages[0]?.content === 'string' && providerMessages[0].role === 'system'
      ? providerMessages[0].content
      : AGENT_GENERATOR_SYSTEM_PROMPT
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
    : AGENT_GENERATOR_SYSTEM_PROMPT

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

export async function runAgentGeneratorChat(
  win: BrowserWindow,
  messages: AgentGeneratorMessage[],
  modelOverride?: string,
): Promise<void> {
  const providerMessages = buildProviderMessages(messages)
  const sessionId = `agent-gen-${randomUUID()}`

  let accumulated = ''

  startActivity({ id: 'agent-generator', kind: 'agent-generator', label: 'Generating agent…' })
  try {
    const fullText = await runAgentGeneratorProviderChat(
      win,
      providerMessages,
      sessionId,
      win.webContents,
      (chunk) => {
        accumulated += chunk
        if (!win.isDestroyed()) win.webContents.send('agent-generator:token', chunk)
      },
      modelOverride,
    )

    accumulated = fullText || accumulated

    const spec = extractSpec(accumulated)
    if (!win.isDestroyed()) {
      if (spec) win.webContents.send('agent-generator:spec-ready', spec)
      win.webContents.send('agent-generator:done', { hasSpec: spec !== null })
    }
  } catch (error) {
    if (!win.isDestroyed()) {
      win.webContents.send('agent-generator:error', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  } finally {
    endActivity('agent-generator')
  }
}

export async function runAgentGeneratorChatForAndroid(
  messages: AgentGeneratorMessage[],
  sessionId = `agent-gen-android-${randomUUID()}`,
  modelOverride?: string,
): Promise<void> {
  const providerMessages = buildProviderMessages(messages)
  const fakeWin = { isDestroyed: () => false, webContents: { send: () => {}, isDestroyed: () => false } } as unknown as BrowserWindow

  let accumulated = ''

  startActivity({ id: 'agent-generator', kind: 'agent-generator', label: 'Generating agent…' })
  try {
    const fullText = await runAgentGeneratorProviderChat(
      fakeWin,
      providerMessages,
      sessionId,
      fakeWin.webContents,
      (chunk) => {
        accumulated += chunk
        broadcastToMobile({ event: 'agent-generator:token', data: { sessionId, chunk } })
      },
      modelOverride,
    )

    accumulated = fullText || accumulated

    if (!accumulated.trim()) {
      throw new Error('The model returned an empty response. Check that a provider API key is configured and the selected model is available.')
    }

    const spec = extractSpec(accumulated)
    const assistantText = accumulated.replace(/<agent-spec>[\s\S]*?<\/agent-spec>/g, '').trim()
    broadcastToMobile({ event: 'agent-generator:turn-complete', data: { sessionId, content: assistantText, hasSpec: spec !== null } })
    if (spec) {
      broadcastToMobile({ event: 'agent-generator:spec-ready', data: { sessionId, spec } })
    }
  } finally {
    endActivity('agent-generator')
  }
}

export async function createAgentFromSpec(spec: AgentGeneratorSpec): Promise<{ agentId: string; name: string }> {
  const db = getDatabase()
  const safeName = String(spec.name).trim().slice(0, 100) || 'New Agent'
  const agentId = randomUUID()
  const now = Date.now()

  const agentConfig = {
    name: safeName,
    icon: spec.icon,
    systemPrompt: spec.systemPrompt,
    temperature: spec.temperature,
    responseFormat: spec.responseFormat,
    maxTokens: 4096,
    agenticMode: spec.agenticMode,
    contextDirectories: spec.contextDirectories,
    contextFiles: [],
    mcpServers: [],
    rootDirectory: spec.rootDirectory ?? '',
    memory: spec.memory ?? '',
    customCommands: spec.customCommands ?? [],
    contextRules: { ignoredGlobs: [], autoInjectWorkspace: false, autoInjectGit: false },
    tools: {
      fileEdit: { enabled: spec.tools.fileEdit, approval: 'always-ask' as const, instructions: '' },
      terminal: { enabled: spec.tools.terminal, approval: 'always-ask' as const, instructions: '' },
      webFetch: { enabled: spec.tools.webFetch, approval: 'always-ask' as const, instructions: '' },
    },
  }

  db.prepare(
    'INSERT INTO agents (id, config_json, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
  ).run(agentId, JSON.stringify(agentConfig), now, now)

  // Auto-create scratchpad when rootDirectory is set and actually exists on disk
  if (spec.rootDirectory && existsSync(spec.rootDirectory)) {
    const kebabName = safeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const scratchpadPath = join(spec.rootDirectory, `${kebabName}-scratchpad.md`)
    if (!existsSync(scratchpadPath)) {
      writeFileSync(
        scratchpadPath,
        `# ${safeName} Scratchpad\n\nUse this file to store notes and context for the ${safeName} agent.\n`,
        'utf-8',
      )
    }
    const sfId = randomUUID()
    const maxRow = db
      .prepare('SELECT MAX(sort_order) as m FROM agent_knowledge_files WHERE agent_id = ?')
      .get(agentId) as { m: number | null }
    db.prepare(
      'INSERT INTO agent_knowledge_files (id, agent_id, file_path, inject_mode, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(sfId, agentId, scratchpadPath, 'on-demand', (maxRow.m ?? -1) + 1, now, now)
  }

  return { agentId, name: safeName }
}

export function registerAgentGeneratorHandlers(win?: BrowserWindow): void {
  safeHandle(
    'agent-generator:chat',
    async (_event, messages: AgentGeneratorMessage[], modelOverride?: string) => {
      if (!win) throw new Error('No main window available')
      await runAgentGeneratorChat(win, messages, modelOverride)
      return { started: true }
    },
  )

  safeHandle('agent-generator:get-model', () => getAgentGeneratorModel())

  safeHandle('agent-generator:set-model', (_event, modelId: string) => {
    _agentGeneratorModel = modelId || null
    return undefined
  })
}

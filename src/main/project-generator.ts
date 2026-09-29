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
import type { ProjectGeneratorMessage, ProjectGeneratorSpec, AgentConfig } from '../shared/types'
import { DEFAULT_PROJECT_CONFIG } from '../shared/types'
import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import { broadcastToMobile } from './ws-server'
import { startActivity, endActivity } from './activity-tracker'
import { normalizeProjectColor } from '../shared/project-colors'
import { addProjectSource, listProjectSources, primarySourcePath } from './project-sources'

const SPEC_OPEN_TAG = '<project-spec>'
const SPEC_CLOSE_TAG = '</project-spec>'

const PROJECT_GENERATOR_SYSTEM_PROMPT = `You are an expert project setup assistant for Nexy, an AI-powered multi-agent desktop application.

Your job is to help the user set up a new project by having a brief, focused conversation and then generating a complete project configuration.

## Conversation style
- Ask 2–3 targeted questions per turn — don't overwhelm with a wall of questions
- Aim to understand: what the project is, what kind of work it involves, where its repository folders live, any scope constraints, desired milestones
- A project may contain one repository, several repositories under one parent, or repositories in unrelated folders. Ask for the relevant source locations; do not force one root when there are several
- Treat the full conversation as authoritative. Never ask again for a detail the user already supplied and never replace it with details from another project
- If the user asks you to create the project with the information already provided, emit the best complete spec immediately. Do not restart discovery or require optional details
- Be concise and friendly
- When you have enough information (usually 2–3 exchanges), emit the project spec

## Generating the spec
When you have enough context, emit a plain conversational summary followed by a JSON block wrapped in <project-spec>…</project-spec> tags. The JSON must match this exact shape:

{
  "name": "Project Name",
  "color": "blue",      // one of: blue, green, red, purple, orange, pink, yellow, gray
  "instructions": "System-level instructions for agents in this project...",
  "rootDirectory": "/absolute/path/to/project",
  "version": 2,
  "sources": [{
    "key": "main-workspace",
    "label": "Main workspace",
    "mode": "attach-existing",
    "localPath": "/absolute/path/to/project",
    "discovery": "scan-children"
  }],
  "instructionMode": "prepend",   // one of: prepend, append, replace, standalone
  "variables": [{ "key": "VAR_NAME", "value": "value" }],
  "inScope": [{ "description": "What is in scope", "pathGlob": "src/**" }],
  "outOfScope": [{ "description": "What is out of scope" }],
  "milestones": [{ "title": "Milestone title", "description": "Optional description", "status": "active" }],
  "orchestrationEnabled": true,
  "defaultModel": null,
  "agents": [
    {
      "role": "Lead Architect",
      "description": "Owns the overall design and coordinates the team",
      "existingAgentId": null,
      "newAgent": {
        "name": "Lead Architect",
        "icon": "🏗️",
        "systemPrompt": "You are the lead architect for this project...",
        "temperature": 0.7,
        "responseFormat": "default",
        "tools": { "fileEdit": true, "terminal": true, "webFetch": false }
      },
      "isLeader": true
    }
  ]
}

## Tool enablement guidance
Set tool permissions per agent based on their role:
- Coding / file-editing agents: fileEdit: true, terminal: true, webFetch: false
- Research / web-browsing agents: fileEdit: false, terminal: false, webFetch: true
- Review / read-only agents: fileEdit: false, terminal: false, webFetch: false
- Full-stack agents: fileEdit: true, terminal: true, webFetch: true

## Agent matching
You will be given the user's existing agents. If an existing agent is a strong match for a role, set "existingAgentId" to their ID and omit "newAgent". Otherwise, propose a new specialist.

## Common specialist patterns by domain
- Software project: Lead Architect (leader), Code Reviewer, Test Engineer, Documentation Writer
- Research: Research Lead (leader), Literature Reviewer, Data Analyst, Report Writer
- Content/writing: Editor-in-Chief (leader), Content Writer, SEO Specialist, Proofreader
- Data pipeline: Pipeline Architect (leader), Data Engineer, Quality Checker, Reporting Analyst
- Generic: Project Manager (leader), General Specialist

Always designate exactly ONE agent as leader (isLeader: true). The leader is added as the primary agent with orchestration enabled.

Keep instructions concise but actionable. Make milestones reflect the user's actual goals.`

function buildProviderMessages(
  messages: ProjectGeneratorMessage[],
  existingAgents: { id: string; name: string; icon: string; systemPrompt: string }[],
  images?: { dataUrl: string }[],
): ProviderMessage[] {
  const agentsSummary = existingAgents.length > 0
    ? `\n\n## User's existing agents\n${existingAgents.map((a) =>
        `- ID: ${a.id} | Name: ${a.name} ${a.icon} | System prompt excerpt: ${a.systemPrompt.slice(0, 120)}...`
      ).join('\n')}`
    : '\n\n## User\'s existing agents\n(none — all specialists will be new agents)'

  // Strip the hardcoded assistant greeting that is pre-loaded into the renderer state.
  // It should not be forwarded to the provider — the system prompt already covers the intent.
  const filteredMessages = messages[0]?.role === 'assistant' ? messages.slice(1) : messages

  const providerMessages: ProviderMessage[] = filteredMessages.map((m): ProviderMessage => ({ role: m.role, content: m.content }))

  // Attach images to the last user message as vision content parts
  if (images && images.length > 0) {
    let lastUserIdx = -1
    for (let i = providerMessages.length - 1; i >= 0; i--) {
      if (providerMessages[i].role === 'user') { lastUserIdx = i; break }
    }
    if (lastUserIdx !== -1) {
      const lastUser = providerMessages[lastUserIdx]
      const textContent = typeof lastUser.content === 'string' ? lastUser.content : ''
      providerMessages[lastUserIdx] = {
        role: 'user',
        content: [
          { type: 'text', text: textContent },
          ...images.map((img) => ({ type: 'image_url' as const, image_url: { url: img.dataUrl } })),
        ],
      }
    }
  }

  return [
    { role: 'system', content: PROJECT_GENERATOR_SYSTEM_PROMPT + agentsSummary },
    ...providerMessages,
  ]
}

function extractSpec(text: string): ProjectGeneratorSpec | null {
  const openIdx = text.lastIndexOf(SPEC_OPEN_TAG)
  if (openIdx === -1) return null
  const closeIdx = text.lastIndexOf(SPEC_CLOSE_TAG)
  if (closeIdx === -1 || closeIdx <= openIdx) return null
  const json = text.slice(openIdx + SPEC_OPEN_TAG.length, closeIdx).trim()
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    return normalizeSpec(raw)
  } catch {
    return null
  }
}

const VALID_COLORS = new Set(['blue', 'green', 'red', 'purple', 'orange', 'pink', 'yellow', 'gray'])

const VALID_INSTRUCTION_MODES = new Set(['prepend', 'append', 'replace', 'standalone'])

function normalizeSpec(raw: Record<string, unknown>): ProjectGeneratorSpec {
  const sources = Array.isArray(raw.sources)
    ? raw.sources.filter((value): value is NonNullable<ProjectGeneratorSpec['sources']>[number] => {
        if (!value || typeof value !== 'object') return false
        const source = value as Record<string, unknown>
        return typeof source.key === 'string' && typeof source.label === 'string' && typeof source.discovery === 'string'
      })
    : undefined
  return {
    version: sources?.length ? 2 : 1,
    name: String(raw.name || 'New Project').trim().slice(0, 100),
    color: VALID_COLORS.has(String(raw.color)) ? String(raw.color) : 'blue',
    instructions: String(raw.instructions || ''),
    rootDirectory: typeof raw.rootDirectory === 'string' && raw.rootDirectory.trim() ? raw.rootDirectory.trim() : undefined,
    sources,
    instructionMode: VALID_INSTRUCTION_MODES.has(String(raw.instructionMode)) ? String(raw.instructionMode) as ProjectGeneratorSpec['instructionMode'] : 'prepend',
    variables: Array.isArray(raw.variables) ? raw.variables.filter(isKeyValue) : [],
    inScope: Array.isArray(raw.inScope) ? raw.inScope.filter(hasScopeDescription) : [],
    outOfScope: Array.isArray(raw.outOfScope) ? raw.outOfScope.filter(hasScopeDescription) : [],
    milestones: Array.isArray(raw.milestones) ? raw.milestones.filter(hasMilestoneTitle) : [],
    orchestrationEnabled: raw.orchestrationEnabled !== false,
    defaultModel: typeof raw.defaultModel === 'string' ? raw.defaultModel : undefined,
    agents: Array.isArray(raw.agents) ? raw.agents.filter(isAgentSpec) : [],
  }
}

function isKeyValue(v: unknown): v is { key: string; value: string } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).key === 'string'
}
function hasScopeDescription(v: unknown): v is { description: string; pathGlob?: string } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).description === 'string'
}
function hasMilestoneTitle(v: unknown): v is { title: string; description?: string; status: 'active' | 'upcoming' } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).title === 'string'
}
function isAgentSpec(v: unknown): boolean {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).role === 'string'
}

export function getProjectGeneratorModel(): string {
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

  const fallbackProvider = PROVIDERS.find((provider) => isProviderConfigured(provider.name) && provider.models.length > 0)
  if (fallbackProvider?.models[0]) {
    return fallbackProvider.name === 'openai'
      ? fallbackProvider.models[0]
      : `${fallbackProvider.name}:${fallbackProvider.models[0]}`
  }
  const openRouterModel = isProviderConfigured('openrouter') ? getOpenRouterModels()[0] : undefined
  if (openRouterModel) return `openrouter:${openRouterModel}`
  throw new Error('No provider is configured. Add an API key in Settings or select a specific model.')
}

async function runProjectGeneratorProviderChat(
  win: BrowserWindow,
  providerMessages: ProviderMessage[],
  sessionId: string,
  webContents: Electron.WebContents,
  sendChunk: (chunk: string) => void,
  modelOverride?: string,
): Promise<string> {
  const selectedModel = modelOverride ?? getProjectGeneratorModel()

  // ── CLI backend: explicit prefix OR bare model ID that belongs to a CLI ────────
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
      : PROJECT_GENERATOR_SYSTEM_PROMPT
    const conversationMessages = providerMessages.filter((m) => m.role !== 'system')
    // `codex exec --ephemeral` consumes only the final adapter message. Preserve this
    // generator's multi-turn discovery conversation by collapsing it into that message;
    // otherwise a final instruction such as "create it with the info above" arrives with
    // none of the previously supplied name, path, scope, or milestones.
    const cliMessages = cliBackend === 'codex-cli'
      ? [{ role: 'user' as const, content: formatProjectGeneratorTranscript(conversationMessages) }]
      : conversationMessages
    return adapter.send(
      win,
      { systemPrompt: systemMsg, messages: cliMessages, cwd: app.getPath('temp'), model: cliModel, conversationId: sessionId },
      sendChunk,
    )
  }

  // ── BYOK / provider path ─────────────────────────────────────────────────────
  const { provider, model } = getProviderForAgent(selectedModel)
  const credential = getProviderCredential(provider)
  const systemPrompt = typeof providerMessages[0]?.content === 'string'
    ? providerMessages[0].content
    : PROJECT_GENERATOR_SYSTEM_PROMPT

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

function formatProjectGeneratorTranscript(messages: ProviderMessage[]): string {
  return messages.map((message) => {
    const role = message.role === 'assistant' ? 'Assistant' : 'User'
    const content = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content)
    return `[${role}]: ${content}`
  }).join('\n\n')
}

export async function runProjectGeneratorChat(
  win: BrowserWindow,
  messages: ProjectGeneratorMessage[],
  existingAgents: { id: string; name: string; icon: string; systemPrompt: string }[],
  modelOverride?: string,
  images?: { dataUrl: string }[],
): Promise<void> {
  const providerMessages = buildProviderMessages(messages, existingAgents, images)
  const sessionId = `project-gen-${randomUUID()}`

  const sendChunk = (chunk: string) => {
    if (!win.isDestroyed()) win.webContents.send('project-generator:token', chunk)
  }

  let accumulated = ''

  startActivity({ id: 'project-generator', kind: 'project-generator', label: 'Generating project…' })
  try {
    const fullText = await runProjectGeneratorProviderChat(
      win,
      providerMessages,
      sessionId,
      win.webContents,
      (chunk) => {
        accumulated += chunk
        sendChunk(chunk)
      },
      modelOverride,
    )

    accumulated = fullText || accumulated

    const spec = extractSpec(accumulated)
    if (!win.isDestroyed()) {
      if (spec) win.webContents.send('project-generator:spec-ready', spec)
      win.webContents.send('project-generator:done', { hasSpec: spec !== null })
    }
  } catch (error) {
    if (!win.isDestroyed()) {
      win.webContents.send('project-generator:error', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  } finally {
    endActivity('project-generator')
  }
}

export async function runProjectGeneratorChatForAndroid(
  messages: ProjectGeneratorMessage[],
  existingAgents: { id: string; name: string; icon: string; systemPrompt: string }[],
  sessionId = `project-gen-android-${randomUUID()}`,
  modelOverride?: string,
): Promise<void> {
  const providerMessages = buildProviderMessages(messages, existingAgents)

  let accumulated = ''

  startActivity({ id: 'project-generator', kind: 'project-generator', label: 'Generating project…' })
  try {
    const fakeWin = { isDestroyed: () => false, webContents: { send: () => {}, isDestroyed: () => false } } as unknown as BrowserWindow
    const fullText = await runProjectGeneratorProviderChat(
      fakeWin,
      providerMessages,
      sessionId,
      fakeWin.webContents,
      (chunk) => {
        accumulated += chunk
        broadcastToMobile({ event: 'project-generator:token', data: { sessionId, chunk } })
      },
      modelOverride,
    )

    accumulated = fullText || accumulated

    const spec = extractSpec(accumulated)
    const assistantText = accumulated.replace(/<project-spec>[\s\S]*?<\/project-spec>/g, '').trim()
    broadcastToMobile({ event: 'project-generator:turn-complete', data: { sessionId, content: assistantText, hasSpec: spec !== null } })
    if (spec) {
      broadcastToMobile({ event: 'project-generator:spec-ready', data: { sessionId, spec } })
    }
  } finally {
    endActivity('project-generator')
  }
}

export function getProjectGeneratorAgentSummaries(): { id: string; name: string; icon: string; systemPrompt: string }[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT id, config_json FROM agents ORDER BY created_at ASC').all() as Array<{ id: string; config_json: string }>
  return rows.flatMap((row) => {
    try {
      const config = JSON.parse(row.config_json) as { name?: unknown; icon?: unknown; systemPrompt?: unknown }
      return [{
        id: row.id,
        name: typeof config.name === 'string' ? config.name : 'Agent',
        icon: typeof config.icon === 'string' ? config.icon : '',
        systemPrompt: typeof config.systemPrompt === 'string' ? config.systemPrompt : '',
      }]
    } catch {
      return []
    }
  })
}

export async function createProjectFromSpec(spec: ProjectGeneratorSpec): Promise<{ projectId: string; name: string }> {
  const db = getDatabase()
  const createdAgentIds: string[] = []
  let projectId: string | null = null

  try {
    // Step 1: create project
    const safeName = String(spec.name).trim().slice(0, 100) || 'New Project'
    const safeColor = normalizeProjectColor(spec.color) ?? 'blue'
    projectId = randomUUID()
    const now = Date.now()
    db.prepare(
      'INSERT INTO projects (id, name, color, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(projectId, safeName, safeColor, JSON.stringify(DEFAULT_PROJECT_CONFIG), now, now)

    // Step 2: update project config
    const sourceSpecs = spec.sources?.filter((source) => source.mode === 'attach-existing' && source.localPath?.trim()) ?? []
    const compatibilityRoot = spec.rootDirectory ?? sourceSpecs[0]?.localPath ?? ''
    const configPatch = {
      instructions: spec.instructions,
      rootDirectory: compatibilityRoot,
      instructionMode: spec.instructionMode ?? 'prepend',
      variables: spec.variables,
      inScope: spec.inScope.map((s, i) => ({ id: String(i), ...s })),
      outOfScope: spec.outOfScope.map((s, i) => ({ id: String(i), ...s })),
      milestones: spec.milestones.map((m, i) => ({ id: String(i), ...m })),
      instructionsEnabled: true,
      workflowMode: spec.orchestrationEnabled ? 'orchestrated' : 'single-agent',
      orchestrationEnabled: spec.orchestrationEnabled,
    }
    const existing = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(projectId) as { config_json: string | null } | undefined
    const current = existing?.config_json ? JSON.parse(existing.config_json) as Record<string, unknown> : {}
    db.prepare('UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify({ ...current, ...configPatch }),
      Date.now(),
      projectId,
    )

    for (const source of sourceSpecs) {
      await addProjectSource(db, projectId, { label: source.label, localPath: source.localPath!, scan: source.discovery !== 'manual' })
    }
    if (sourceSpecs.length === 0 && compatibilityRoot) {
      await addProjectSource(db, projectId, { label: 'Primary source', localPath: compatibilityRoot })
    }
    const hierarchy = listProjectSources(db, projectId)
    const hierarchyRow = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(projectId) as { config_json: string | null }
    const hierarchyConfig = JSON.parse(hierarchyRow.config_json ?? '{}') as Record<string, unknown>
    db.prepare('UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify({ ...hierarchyConfig, ...hierarchy, rootDirectory: primarySourcePath(hierarchy) || compatibilityRoot }),
      Date.now(),
      projectId,
    )

    // Step 3: create new agents
    const agentIdByRole: Record<string, string> = {}
    for (const agentSpec of spec.agents) {
      if (agentSpec.existingAgentId) {
        agentIdByRole[agentSpec.role] = agentSpec.existingAgentId
      } else if (agentSpec.newAgent) {
        const agentId = randomUUID()
        const agentNow = Date.now()
        const t = agentSpec.newAgent.tools
        const agentConfig = {
          ...agentSpec.newAgent,
          maxTokens: 4096,
          contextDirectories: [],
          contextFiles: [],
          mcpServers: [],
          agenticMode: false,
          tools: {
            fileEdit: { enabled: t?.fileEdit ?? false, approval: 'always-ask' as const, instructions: '' },
            terminal: { enabled: t?.terminal ?? false, approval: 'always-ask' as const, instructions: '' },
            webFetch: { enabled: t?.webFetch ?? false, approval: 'always-ask' as const, instructions: '' },
          },
        }
        db.prepare(
          'INSERT INTO agents (id, config_json, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
        ).run(agentId, JSON.stringify(agentConfig), agentNow, agentNow)
        agentIdByRole[agentSpec.role] = agentId
        createdAgentIds.push(agentId)
      }
    }

    // Step 4: add agents to project
    for (const agentSpec of spec.agents) {
      const agentId = agentIdByRole[agentSpec.role]
      if (agentId) {
        db.prepare(
          'INSERT OR IGNORE INTO project_agents (project_id, agent_id, is_primary, sort_order, added_at) VALUES (?, ?, 0, 0, ?)',
        ).run(projectId, agentId, Date.now())
      }
    }

    // Step 5: set primary agent (leader)
    const leaderSpec = spec.agents.find((a) => a.isLeader)
    if (leaderSpec) {
      const leaderId = agentIdByRole[leaderSpec.role]
      if (leaderId) {
        const setPrimary = db.transaction(() => {
          db.prepare('UPDATE project_agents SET is_primary = 0 WHERE project_id = ?').run(projectId)
          db.prepare('UPDATE project_agents SET is_primary = 1 WHERE project_id = ? AND agent_id = ?').run(projectId, leaderId)
        })
        setPrimary()
      }
    }

    // Step 6: enable orchestration
    const orchRow = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(projectId) as { config_json: string | null } | undefined
    const orchCurrent = orchRow?.config_json ? JSON.parse(orchRow.config_json) as Record<string, unknown> : {}
    db.prepare('UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify({
        ...orchCurrent,
        workflowMode: spec.orchestrationEnabled ? 'orchestrated' : 'single-agent',
        orchestrationEnabled: spec.orchestrationEnabled,
      }),
      Date.now(),
      projectId,
    )

    if (spec.defaultModel) {
      db.prepare('UPDATE projects SET default_model = ?, updated_at = ? WHERE id = ?').run(spec.defaultModel, Date.now(), projectId)
    }

    return { projectId, name: safeName }
  } catch (err) {
    for (const id of createdAgentIds) {
      try { db.prepare('DELETE FROM agents WHERE id = ?').run(id) } catch {
        // Best-effort rollback; preserve the original creation error.
      }
    }
    if (projectId) {
      try { db.prepare('DELETE FROM projects WHERE id = ?').run(projectId) } catch {
        // Best-effort rollback; preserve the original creation error.
      }
    }
    throw err
  }
}

export function registerProjectGeneratorHandlers(win?: BrowserWindow): void {
  safeHandle(
    'project-generator:chat',
    async (_event, messages: ProjectGeneratorMessage[], existingAgents: AgentConfig[], modelOverride?: string, images?: { dataUrl: string }[]) => {
      if (!win) throw new Error('No main window available')
      const agentSummaries = existingAgents.map((a) => ({
        id: a.id,
        name: a.name,
        icon: a.icon,
        systemPrompt: a.systemPrompt,
      }))
      await runProjectGeneratorChat(win, messages, agentSummaries, modelOverride, images)
      return { started: true }
    },
  )

  safeHandle('project-generator:get-model', () => getProjectGeneratorModel())

  // set-model is now session-only in the renderer; this handler is kept for
  // backwards-compat but no longer writes to the database.
  safeHandle('project-generator:set-model', (_event, _modelId: string) => undefined)
}

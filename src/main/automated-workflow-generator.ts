import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { safeHandle } from './safe-handle'
import {
  DEFAULT_PROVIDER_MODEL,
  NO_PROVIDER_CONFIGURED_MESSAGE,
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
import type {
  AutomatedWorkflowGeneratorMessage,
  AutomatedWorkflowSpec,
  AutomatedWorkflowStepKind,
  ProjectConfig,
  WorkflowArtifactBinding,
  WorkflowDeliverableDefinition,
  WorkflowPublishDestination,
  WorkflowReviewSource,
} from '../shared/types'
import { getDatabase } from './database'
import { broadcastToMobile } from './ws-server'
import { parseProjectConfig } from './project-handlers'
import { startActivity, endActivity } from './activity-tracker'

export const AUTOMATED_WORKFLOW_SPEC_OPEN_TAG = '<automated-workflow-spec>'
export const AUTOMATED_WORKFLOW_SPEC_CLOSE_TAG = '</automated-workflow-spec>'

const AUTOMATED_WORKFLOW_GENERATOR_SYSTEM_PROMPT = `You are an expert workflow planner for Nexy.

Your job is to turn a goal into a managed deliverable workflow. Prefer a transparent pipeline of
collect -> model -> review -> publish. Managed workflows snapshot explicit sources, create immutable
artifacts, pause on review, and publish only an approved exact version. Use legacy untyped model steps
only when the user is not asking to create a durable project deliverable.

Requirements:
- Produce a short assistant response that explains the plan.
- Then emit JSON wrapped in <automated-workflow-spec>...</automated-workflow-spec> tags.
- Each step should be a bounded, self-contained task that can be completed in one turn.
- Prefer 2-6 steps.
- Every step must include:
  - id
  - title
  - summary
  - prompt
  - expectedOutput
- A model step is fulfilled by EITHER an agent OR a model directly — never both, never neither:
  - If the available agents (project-attached, or the user's global agents for a standalone plan) include a
    matching agent, prefer assigning that step to it: include agentId and agentName. That agent's own configured
    skills apply automatically — you never need to think about skills.
  - Otherwise (no suitable agent for this step), include a "model" field naming a specific model instead of
    agentId/agentName. A model-only step runs as a plain, capable assistant with no skill augmentation — that is
    expected and fine, not a limitation to work around.
- Managed step kinds are collect, model, review, and publish.
- collect.inputBindings must contain project-files sources using a Project Source ID and explicit
  project-relative include paths. Do not invent source IDs or use absolute paths.
- collect/model steps declare exactly one Markdown deliverable in deliverables.
- model inputBindings refer to exact named step outputs.
- reviewSource and publish reviewSource refer to { stepId, outputName }.
- publishDestination is a declared project-file destination and always uses
  conflictPolicy: "require-new-preview".
- review and publish never include agentId/model and always remain human-gated.
- dependsOnStepIds is required for managed steps after collect.
- assumptions should be short and concrete.

JSON shape:
{
  "title": "Workflow title",
  "goalSummary": "Short summary of the user goal",
  "assumptions": ["Assumption 1"],
  "steps": [
    {
      "id": "step-1",
      "kind": "collect",
      "title": "Collect project notes",
      "summary": "Snapshot declared sources",
      "prompt": "Snapshot the selected sources",
      "expectedOutput": "Immutable source snapshot",
      "inputBindings": [{"bindingId":"notes","source":{"type":"project-files","projectSourceId":"source-id-from-context","include":["notes/*.md"]},"required":true}],
      "deliverables": [{"name":"source-notes","title":"Project notes snapshot","kind":"document","primaryPath":"sources.md","mediaType":"text/markdown"}],
      "dependsOnStepIds": []
    },
    {
      "id": "step-2",
      "title": "Draft the announcement",
      "kind": "model",
      "summary": "Create a bounded Markdown deliverable",
      "model": "optional-model-id",
      "prompt": "Prompt text to send",
      "expectedOutput": "Markdown draft",
      "inputBindings": [{"bindingId":"notes","source":{"type":"step-output","stepId":"step-1","outputName":"source-notes"},"required":true}],
      "deliverables": [{"name":"draft","title":"Announcement draft","kind":"document","primaryPath":"announcement.md","mediaType":"text/markdown"}],
      "dependsOnStepIds": ["step-1"]
    }
  ]
}`

let _automatedWorkflowGeneratorModel: string | null = null

interface ProjectWorkflowContext {
  projectId: string | null
  projectName: string
  config: ProjectConfig | null
  agents: Array<{
    agentId: string
    agentName: string
    agentIcon: string
    isPrimary: boolean
  }>
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function workflowStepKind(value: unknown): AutomatedWorkflowStepKind | undefined {
  return value === 'collect' || value === 'model' || value === 'review' || value === 'publish' ? value : undefined
}

function normalizeBindings(value: unknown): WorkflowArtifactBinding[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<WorkflowArtifactBinding>((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const bindingId = optionalString(raw.bindingId)
    const sourceRaw = raw.source && typeof raw.source === 'object' ? raw.source as Record<string, unknown> : null
    if (!bindingId || !sourceRaw) return []
    if (sourceRaw.type === 'project-files') {
      const projectSourceId = optionalString(sourceRaw.projectSourceId)
      const include = Array.isArray(sourceRaw.include)
        ? sourceRaw.include.filter((path): path is string => typeof path === 'string' && path.trim().length > 0).map((path) => path.trim())
        : []
      return projectSourceId && include.length > 0 ? [{ bindingId, source: { type: 'project-files' as const, projectSourceId, include }, required: raw.required !== false }] : []
    }
    if (sourceRaw.type === 'step-output') {
      const stepId = optionalString(sourceRaw.stepId)
      const outputName = optionalString(sourceRaw.outputName)
      return stepId && outputName ? [{ bindingId, source: { type: 'step-output' as const, stepId, outputName }, required: raw.required !== false }] : []
    }
    return []
  })
}

function normalizeDeliverables(value: unknown): WorkflowDeliverableDefinition[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const name = optionalString(raw.name)
    const title = optionalString(raw.title)
    const primaryPath = optionalString(raw.primaryPath)
    const mediaType = optionalString(raw.mediaType)
    const kind = optionalString(raw.kind)
    if (!name || !title || !primaryPath || !mediaType || !kind) return []
    return [{ name, title, primaryPath, mediaType, kind: kind as WorkflowDeliverableDefinition['kind'] }]
  })
}

function normalizeReviewSource(value: unknown): WorkflowReviewSource | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const stepId = optionalString(raw.stepId)
  const outputName = optionalString(raw.outputName)
  return stepId && outputName ? { stepId, outputName } : undefined
}

function normalizePublishDestination(value: unknown): WorkflowPublishDestination | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const projectSourceId = optionalString(raw.projectSourceId)
  const relativePath = optionalString(raw.relativePath)
  if (raw.type !== 'project-file' || !projectSourceId || !relativePath) return undefined
  return { type: 'project-file', projectSourceId, relativePath, conflictPolicy: 'require-new-preview' }
}

function getFallbackGeneratorModel(): string {
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

export function getAutomatedWorkflowGeneratorModel(): string {
  return _automatedWorkflowGeneratorModel ?? getFallbackGeneratorModel()
}

export function setAutomatedWorkflowGeneratorModel(modelId: string | null): void {
  _automatedWorkflowGeneratorModel = modelId || null
}

function loadProjectWorkflowContext(projectId: string | null): ProjectWorkflowContext {
  // A project-less plan has no project (scope, milestones, workspace) but agents are a global
  // entity (the `agents` table has no project_id column at all) — so a standalone plan can still
  // draw from the user's full agent library, exactly as freely as a project-scoped plan draws
  // from its attached team. There is no technical reason to withhold agents here; the executor's
  // agent-or-model resolution (automated-workflow-executor.ts) and runAgentTurn already work with
  // any global agentId regardless of project.
  if (!projectId) {
    const db = getDatabase()
    const rows = db.prepare('SELECT id, config_json, is_default FROM agents ORDER BY is_default DESC, created_at ASC').all() as Array<{
      id: string
      config_json: string
      is_default: number
    }>
    const agents = rows.map((row) => {
      const cfg = JSON.parse(row.config_json) as { name?: string; icon?: string }
      return {
        agentId: row.id,
        agentName: cfg.name ?? 'Unnamed agent',
        agentIcon: cfg.icon ?? '🤖',
        isPrimary: row.is_default === 1,
      }
    })
    return { projectId: null, projectName: '(no project)', config: null, agents }
  }

  const db = getDatabase()
  const projectRow = db.prepare('SELECT id, name, config_json FROM projects WHERE id = ?').get(projectId) as {
    id: string
    name: string
    config_json: string | null
  } | undefined
  if (!projectRow) throw new Error('Project not found')

  const config = parseProjectConfig(projectRow.config_json)
  const agents = db.prepare(`
    SELECT pa.agent_id, pa.is_primary, a.config_json
    FROM project_agents pa
    JOIN agents a ON a.id = pa.agent_id
    WHERE pa.project_id = ?
    ORDER BY pa.is_primary DESC, pa.sort_order ASC, pa.added_at ASC
  `).all(projectId) as Array<{
    agent_id: string
    is_primary: number
    config_json: string
  }>

  return {
    projectId: projectRow.id,
    projectName: projectRow.name,
    config,
    agents: agents.map((row) => {
      const cfg = JSON.parse(row.config_json) as { name?: string; icon?: string }
      return {
        agentId: row.agent_id,
        agentName: cfg.name ?? 'Unnamed agent',
        agentIcon: cfg.icon ?? '🤖',
        isPrimary: row.is_primary === 1,
      }
    }),
  }
}

function substituteVariables(text: string, variables: ProjectConfig['variables']): string {
  let result = text
  for (const { key, value } of variables) {
    result = result.replaceAll(`{{${key}}}`, value)
  }
  return result
}

function buildProjectContextBlock(project: ProjectWorkflowContext): string {
  if (!project.config) {
    const agentLines = project.agents.map((agent) => `${agent.agentId} | ${agent.agentName}${agent.isPrimary ? ' [default]' : ''}`)
    return [
      'This workflow has no project — it is a self-contained, standalone plan.',
      'Agents available (not tied to any project — these are the user\'s global agents):',
      ...(agentLines.length > 0 ? agentLines.map((line) => `- ${line}`) : ['- (no agents exist yet — assign steps a "model" field instead)']),
    ].join('\n')
  }

  const scopeLines = [
    ...project.config.inScope.map((rule) => `IN: ${rule.description}${rule.pathGlob ? ` (${rule.pathGlob})` : ''}`),
    ...project.config.outOfScope.map((rule) => `OUT: ${rule.description}${rule.pathGlob ? ` (${rule.pathGlob})` : ''}`),
  ]
  const milestoneLines = project.config.milestones.map((m) => `${m.status.toUpperCase()}: ${m.title}${m.description ? ` - ${m.description}` : ''}`)
  const agentLines = project.agents.map((agent) => `${agent.agentId} | ${agent.agentName}${agent.isPrimary ? ' [primary]' : ''}`)
  const instructions = substituteVariables(project.config.instructions || '', project.config.variables)
  const sourceRows = getDatabase().prepare(`SELECT id, label, local_path FROM project_sources
    WHERE project_id = ? AND enabled = 1 ORDER BY is_primary DESC, created_at`).all(project.projectId) as Array<{
      id: string; label: string; local_path: string
    }>

  return [
    `Project: ${project.projectName}`,
    `Project ID: ${project.projectId}`,
    `Workflow mode: ${project.config.workflowMode}`,
    `Root directory: ${project.config.rootDirectory || '(not set)'}`,
    'Project sources (use these stable IDs in managed project-files bindings):',
    ...(sourceRows.length > 0
      ? sourceRows.map((source) => `- ${source.id} | ${source.label} | ${source.local_path}`)
      : ['- (no project sources are configured; ask the user to configure one before proposing collect/publish steps)']),
    `Project instructions: ${instructions || '(none)'}`,
    `Agents:`,
    ...(agentLines.length > 0 ? agentLines.map((line) => `- ${line}`) : ['- (no project agents assigned — assign steps a "model" field instead)']),
    `Scope:`,
    ...(scopeLines.length > 0 ? scopeLines.map((line) => `- ${line}`) : ['- (no scope rules)']),
    `Milestones:`,
    ...(milestoneLines.length > 0 ? milestoneLines.map((line) => `- ${line}`) : ['- (no milestones)']),
  ].join('\n')
}

// Exported for testing — the seam through which project/agent context flows into the system
// prompt sent to the planner (see automated-workflow-generator.test.ts).
export function buildProviderMessages(projectId: string | null, messages: AutomatedWorkflowGeneratorMessage[]): { providerMessages: ProviderMessage[]; cwd: string } {
  const project = loadProjectWorkflowContext(projectId)
  const filtered = messages[0]?.role === 'assistant' ? messages.slice(1) : messages
  const providerMessages: ProviderMessage[] = [
    { role: 'system', content: `${AUTOMATED_WORKFLOW_GENERATOR_SYSTEM_PROMPT}\n\nContext:\n${buildProjectContextBlock(project)}` },
    ...filtered.map((message): ProviderMessage => ({
      role: message.role,
      content: project.config ? substituteVariables(message.content, project.config.variables) : message.content,
    })),
  ]
  const cwd = project.config?.rootDirectory?.trim() || app.getPath('temp')
  return { providerMessages, cwd }
}

export function normalizeAutomatedWorkflowSpec(raw: Record<string, unknown>): AutomatedWorkflowSpec {
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : []
  const steps = stepsRaw
    .map((step, index) => {
      const value = typeof step === 'object' && step !== null ? step as Record<string, unknown> : {}
      const id = optionalString(value.id) ?? `step-${index + 1}`
      const title = optionalString(value.title) ?? `Step ${index + 1}`
      const summary = optionalString(value.summary) ?? ''
      const kind = workflowStepKind(value.kind)
      const prompt = optionalString(value.prompt) ?? (kind ? `${kind} managed workflow step` : '')
      const expectedOutput = optionalString(value.expectedOutput) ?? ''
      if (!prompt) return null
      const dependsOnStepIds = Array.isArray(value.dependsOnStepIds)
        ? value.dependsOnStepIds.filter((dep): dep is string => typeof dep === 'string' && dep.trim().length > 0)
        : undefined
      return {
        id,
        title,
        summary,
        agentId: optionalString(value.agentId),
        agentName: optionalString(value.agentName),
        ...(optionalString(value.model) ? { model: optionalString(value.model) } : {}),
        prompt,
        expectedOutput,
        dependsOnStepIds: dependsOnStepIds && dependsOnStepIds.length > 0 ? dependsOnStepIds : undefined,
        ...(kind ? {
          kind,
          inputBindings: normalizeBindings(value.inputBindings),
          deliverables: normalizeDeliverables(value.deliverables),
          reviewSource: normalizeReviewSource(value.reviewSource),
          publishDestination: normalizePublishDestination(value.publishDestination),
          includeProjectInstructions: value.includeProjectInstructions === true,
        } : {}),
      }
    })
    .filter((step): step is NonNullable<typeof step> => step !== null)

  if (steps.length === 0) throw new Error('Automated workflow requires at least one step')

  const ids = new Set(steps.map((step) => step.id))
  if (ids.size !== steps.length) throw new Error('Automated workflow step IDs must be unique')
  const stepById = new Map(steps.map((step, index) => [step.id, { step, index }]))
  for (const [stepIndex, step] of steps.entries()) {
    for (const dependencyId of step.dependsOnStepIds ?? []) {
      if (!ids.has(dependencyId)) throw new Error(`Workflow step "${step.id}" has an unknown dependency "${dependencyId}"`)
      if (step.kind && (stepById.get(dependencyId)?.index ?? stepIndex) >= stepIndex) {
        throw new Error(`Managed step "${step.id}" must depend only on earlier steps`)
      }
    }
    if (!step.kind) continue
    if (step.kind === 'collect' && !step.inputBindings?.some((binding) => binding.source.type === 'project-files')) {
      throw new Error(`Collect step "${step.id}" requires a project-files input binding`)
    }
    if ((step.kind === 'collect' || step.kind === 'model') && step.deliverables?.length !== 1) {
      throw new Error(`${step.kind} step "${step.id}" requires exactly one deliverable`)
    }
    if ((step.kind === 'review' || step.kind === 'publish') && !step.reviewSource) {
      throw new Error(`${step.kind} step "${step.id}" requires a reviewSource`)
    }
    if (step.kind === 'publish' && !step.publishDestination) {
      throw new Error(`Publish step "${step.id}" requires a publishDestination`)
    }
    const references = [
      ...(step.inputBindings ?? []).flatMap((binding) => binding.source.type === 'step-output'
        ? [{ stepId: binding.source.stepId, outputName: binding.source.outputName }] : []),
      ...(step.reviewSource ? [step.reviewSource] : []),
    ]
    for (const reference of references) {
      const producer = stepById.get(reference.stepId)
      if (!producer || producer.index >= stepIndex) {
        throw new Error(`Managed step "${step.id}" must reference an earlier producer step "${reference.stepId}"`)
      }
      const outputNames = producer.step.kind === 'review'
        ? [producer.step.reviewSource?.outputName]
        : (producer.step.deliverables ?? []).map((deliverable) => deliverable.name)
      if (!outputNames.includes(reference.outputName)) {
        throw new Error(`Managed step "${step.id}" references unknown output "${reference.outputName}" from "${reference.stepId}"`)
      }
      if (!(step.dependsOnStepIds ?? []).includes(reference.stepId)) {
        throw new Error(`Managed step "${step.id}" must depend on referenced step "${reference.stepId}"`)
      }
    }
  }

  return {
    title: optionalString(raw.title) ?? 'Automated workflow',
    goalSummary: optionalString(raw.goalSummary) ?? '',
    assumptions: Array.isArray(raw.assumptions)
      ? raw.assumptions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    steps,
  }
}

export function extractAutomatedWorkflowSpec(text: string): AutomatedWorkflowSpec | null {
  const openIdx = text.lastIndexOf(AUTOMATED_WORKFLOW_SPEC_OPEN_TAG)
  if (openIdx === -1) return null
  const closeIdx = text.lastIndexOf(AUTOMATED_WORKFLOW_SPEC_CLOSE_TAG)
  if (closeIdx === -1 || closeIdx <= openIdx) return null
  const json = text.slice(openIdx + AUTOMATED_WORKFLOW_SPEC_OPEN_TAG.length, closeIdx).trim()
  try {
    return normalizeAutomatedWorkflowSpec(JSON.parse(json) as Record<string, unknown>)
  } catch {
    return null
  }
}

async function repairAutomatedWorkflowSpec(
  win: BrowserWindow,
  providerMessages: ProviderMessage[],
  candidate: string,
  sessionId: string,
  cwd: string,
  modelOverride?: string,
): Promise<AutomatedWorkflowSpec | null> {
  const boundedCandidate = candidate.slice(-20_000)
  const repairMessages: ProviderMessage[] = [
    providerMessages[0] ?? { role: 'system', content: AUTOMATED_WORKFLOW_GENERATOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `The proposed workflow below was not valid. Repair it once. Return only one complete
<automated-workflow-spec> JSON block that follows the schema and constraints. Do not add commentary.

Candidate:
${boundedCandidate}`,
    },
  ]
  const repaired = await runAutomatedWorkflowProviderChat(
    win,
    repairMessages,
    `${sessionId}-repair`,
    () => {},
    cwd,
    modelOverride,
  )
  return extractAutomatedWorkflowSpec(repaired)
}

export async function runAutomatedWorkflowProviderChat(
  win: BrowserWindow,
  providerMessages: ProviderMessage[],
  sessionId: string,
  sendChunk: (chunk: string) => void,
  cwd: string,
  modelOverride?: string,
): Promise<string> {
  const selectedModel = modelOverride ?? getAutomatedWorkflowGeneratorModel()

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
      : AUTOMATED_WORKFLOW_GENERATOR_SYSTEM_PROMPT
    const conversationMessages = providerMessages.filter((message) => message.role !== 'system')
    return adapter.send(
      win,
      { systemPrompt: systemMsg, messages: conversationMessages, cwd, model: cliModel, conversationId: sessionId },
      sendChunk,
    )
  }

  const { provider, model } = getProviderForAgent(selectedModel)
  const credential = getProviderCredential(provider)
  if (!credential) {
    throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
  }
  const systemPrompt = typeof providerMessages[0]?.content === 'string'
    ? providerMessages[0].content
    : AUTOMATED_WORKFLOW_GENERATOR_SYSTEM_PROMPT

  return dispatchToProvider({
    providerName: provider,
    providerModel: model,
    credential,
    byokKey: credential,
    chatMessages: providerMessages,
    toolDefs: [],
    toolMap: new Map(),
    effectiveAgentId: null,
    agenticMode: false,
    wikiInlineHandlers: new Map(),
    toolDirective: '',
    generationOptions: { maxTokens: 4096, temperature: 0.5 },
    conversationId: sessionId,
    webContents: win.webContents,
    sendChunk,
    sendActivity: () => {},
    systemPrompt,
  })
}

export async function runAutomatedWorkflowGeneratorChat(
  win: BrowserWindow,
  projectId: string | null,
  messages: AutomatedWorkflowGeneratorMessage[],
  modelOverride?: string,
): Promise<void> {
  const { providerMessages, cwd } = buildProviderMessages(projectId, messages)
  const sessionId = `automated-workflow-gen-${randomUUID()}`
  let accumulated = ''

  const activityId = `automated-workflow-generator:${projectId ?? 'global'}`
  startActivity({ id: activityId, kind: 'automated-workflow-generator', projectId: projectId ?? undefined, label: 'Generating workflow…' })
  try {
    const fullText = await runAutomatedWorkflowProviderChat(
      win,
      providerMessages,
      sessionId,
      (chunk) => {
        accumulated += chunk
        if (!win.isDestroyed()) win.webContents.send('automated-workflow-generator:token', chunk)
      },
      cwd,
      modelOverride,
    )

    accumulated = fullText || accumulated
    if (!accumulated.trim()) {
      throw new Error(`Automated workflow generator returned no response from ${modelOverride ?? getAutomatedWorkflowGeneratorModel()}. Check the selected model/provider or choose a different model.`)
    }

    let spec = extractAutomatedWorkflowSpec(accumulated)
    if (!spec) {
      spec = await repairAutomatedWorkflowSpec(win, providerMessages, accumulated, sessionId, cwd, modelOverride)
    }
    if (!win.isDestroyed()) {
      if (spec) win.webContents.send('automated-workflow-generator:spec-ready', spec)
      win.webContents.send('automated-workflow-generator:done', { hasSpec: spec !== null })
    }
  } catch (error) {
    if (!win.isDestroyed()) {
      win.webContents.send('automated-workflow-generator:error', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  } finally {
    endActivity(activityId)
  }
}

export async function runAutomatedWorkflowGeneratorChatForAndroid(
  projectId: string | null,
  messages: AutomatedWorkflowGeneratorMessage[],
  sessionId = `automated-workflow-gen-android-${randomUUID()}`,
  modelOverride?: string,
): Promise<void> {
  const { providerMessages, cwd } = buildProviderMessages(projectId, messages)
  const fakeWin = { isDestroyed: () => false, webContents: { send: () => {}, isDestroyed: () => false } } as unknown as BrowserWindow
  let accumulated = ''

  const activityId = `automated-workflow-generator:${projectId ?? 'global'}`
  startActivity({ id: activityId, kind: 'automated-workflow-generator', projectId: projectId ?? undefined, label: 'Generating workflow…' })
  try {
    const fullText = await runAutomatedWorkflowProviderChat(
      fakeWin,
      providerMessages,
      sessionId,
      (chunk) => {
        accumulated += chunk
        broadcastToMobile({ event: 'automated-workflow-generator:token', data: { sessionId, chunk } })
      },
      cwd,
      modelOverride,
    )

    accumulated = fullText || accumulated
    if (!accumulated.trim()) {
      broadcastToMobile({
        event: 'automated-workflow-generator:error',
        data: { sessionId, message: 'Automated workflow generator returned no response. Check the selected model/provider.' },
      })
      return
    }

    let spec = extractAutomatedWorkflowSpec(accumulated)
    if (!spec) {
      spec = await repairAutomatedWorkflowSpec(fakeWin, providerMessages, accumulated, sessionId, cwd, modelOverride)
    }
    const assistantText = accumulated.replace(/<automated-workflow-spec>[\s\S]*?<\/automated-workflow-spec>/g, '').trim()
    broadcastToMobile({ event: 'automated-workflow-generator:turn-complete', data: { sessionId, content: assistantText, hasSpec: spec !== null } })
    if (spec) {
      broadcastToMobile({ event: 'automated-workflow-generator:spec-ready', data: { sessionId, spec } })
    }
  } finally {
    endActivity(activityId)
  }
}

export function registerAutomatedWorkflowGeneratorHandlers(win?: BrowserWindow): void {
  safeHandle('automated-workflow-generator:chat', async (_event, projectId: string | null, messages: AutomatedWorkflowGeneratorMessage[], modelOverride?: string) => {
    if (!win) throw new Error('No main window available')
    await runAutomatedWorkflowGeneratorChat(win, projectId, messages, modelOverride)
    return { started: true }
  })

  safeHandle('automated-workflow-generator:get-model', () => getAutomatedWorkflowGeneratorModel())

  safeHandle('automated-workflow-generator:set-model', (_event, modelId: string) => {
    setAutomatedWorkflowGeneratorModel(modelId)
    return undefined
  })
}

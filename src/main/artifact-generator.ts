import { app } from 'electron'
import path from 'path'
import { mkdirSync, writeFileSync, statSync } from 'fs'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import { getProviderForAgent, getProviderCredential, DEFAULT_PROVIDER_MODEL, PROVIDERS, isProviderConfigured, getOpenRouterModels } from './providers'
import { dispatchToProvider } from './chat-provider-dispatch'
import { getAdapter } from './cli-adapters/registry'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { getCliModels } from './cli-detection'
import { isClaudeCliModelOrCandidate } from './cli-adapters/claude-model-probe'
import type { ProviderMessage } from './provider-core-types'
import type { ArtifactSpec, ArtifactGeneratorMessage, ArtifactGeneratorRun, ArtifactKind, ArtifactExportFormat } from '../shared/types'
import { getDatabase } from './database'
import { recordProjectAuditChange } from './project-audit'
import { broadcastToMobile } from './ws-server'
import { getProjectRootDirectory } from './project-handlers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPEC_OPEN_TAG = '<artifact-spec>'
const SPEC_CLOSE_TAG = '</artifact-spec>'

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const ARTIFACT_GENERATOR_SYSTEM_PROMPT = `You are an expert artifact creation assistant for Nexy.

Your job is to help a user create a versioned deliverable — a document, code file, prompt pack, plan, data file, UI spec, agent config, or any other tangible output.

## Conversation style
- Be decisive and action-oriented. Make reasonable assumptions rather than asking clarifying questions.
- If the user's request is clear enough to act on, emit the spec immediately without asking anything.
- Only ask a clarifying question if information is genuinely missing and you cannot make a reasonable assumption (e.g. you don't know what the deliverable is at all).
- Never ask more than one question per turn. Never ask the same question twice.
- After at most ONE exchange of clarification, emit the spec — do not continue asking questions.

## Artifact kinds
- document: PRDs, briefs, reports, plans, articles, specs
- code: scripts, components, config files, small libraries
- ui: page mockups, screen specs, component sets, HTML/CSS prototypes
- data: JSON, CSV, transformed datasets, analysis outputs
- prompt: prompt packs, system prompts, agent instructions
- agent-config: generated agent/team configuration files
- plan: milestone plans, test plans, launch plans
- bundle: multi-file deliverables that do not fit one category
- other: fallback for user-defined deliverables

## Generating the spec
When you have enough context (or when in doubt — just go ahead and make reasonable assumptions), emit a brief one-line acknowledgment followed by a JSON block wrapped in <artifact-spec>…</artifact-spec> tags. The JSON must match this exact shape:

{
  "title": "Short descriptive title",
  "kind": "document",
  "scope": { "type": "global" },
  "intendedUse": "What this artifact will be used for",
  "audience": "Who will read/use it (optional)",
  "outputFiles": [
    { "path": "output.md", "mediaType": "text/markdown", "role": "primary", "description": "Main document" }
  ],
  "sourceContext": {
    "useProjectInstructions": false,
    "useProjectWiki": false,
    "useConversationContext": false,
    "referencedFiles": []
  },
  "acceptanceCriteria": ["Covers X", "Includes Y section"],
  "exportFormats": ["markdown", "raw-files"]
}

Keep outputFiles specific — name each file with its path and media type. List acceptance criteria as concrete, checkable items.`

const GENERATION_SYSTEM_PROMPT = `You are an expert content creator generating a versioned artifact.

You will be given:
1. An approved artifact spec describing what to create
2. Instructions for each output file

For each output file listed in the spec, generate the complete file content wrapped in delimiters:
<<<FILE: relative/path/to/file>>>
... complete file content ...
<<<END_FILE>>>

Rules:
- Output COMPLETE file content — never partial or placeholder content
- Only output files listed in the spec's outputFiles array
- Match the media type and role of each file
- High quality, production-ready output only
- No meta-commentary outside the delimiters`

// ---------------------------------------------------------------------------
// Spec extraction and normalization
// ---------------------------------------------------------------------------

function extractArtifactSpec(text: string): ArtifactSpec | null {
  const openIdx = text.lastIndexOf(SPEC_OPEN_TAG)
  if (openIdx === -1) return null
  const closeIdx = text.lastIndexOf(SPEC_CLOSE_TAG)
  if (closeIdx === -1 || closeIdx <= openIdx) return null
  const json = text.slice(openIdx + SPEC_OPEN_TAG.length, closeIdx).trim()
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    return normalizeArtifactSpec(raw)
  } catch {
    return null
  }
}

const VALID_KINDS = new Set(['document', 'code', 'ui', 'data', 'prompt', 'agent-config', 'plan', 'bundle', 'other'])
const VALID_EXPORT_FORMATS = new Set(['markdown', 'html', 'json', 'zip', 'raw-files'])
const VALID_FILE_ROLES = new Set(['primary', 'supporting', 'preview', 'source'])

function normalizeArtifactSpec(raw: Record<string, unknown>): ArtifactSpec {
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []

  const rawScope = raw.scope as Record<string, unknown> | undefined
  const scope: ArtifactSpec['scope'] = {
    type: rawScope?.type === 'project' ? 'project' : 'global',
    projectId: rawScope?.projectId != null ? String(rawScope.projectId) : undefined,
  }

  const rawFiles = Array.isArray(raw.outputFiles) ? raw.outputFiles : []
  const outputFiles = rawFiles
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      path: String(f.path ?? 'output.txt'),
      mediaType: String(f.mediaType ?? 'text/plain'),
      role: VALID_FILE_ROLES.has(String(f.role)) ? (String(f.role) as ArtifactSpec['outputFiles'][0]['role']) : 'primary',
      description: f.description != null ? String(f.description) : undefined,
    }))

  const rawSrc = raw.sourceContext as Record<string, unknown> | undefined

  return {
    title: String(raw.title || 'New Artifact').trim().slice(0, 120),
    kind: VALID_KINDS.has(String(raw.kind)) ? (String(raw.kind) as ArtifactKind) : 'document',
    scope,
    intendedUse: String(raw.intendedUse || '').trim(),
    audience: raw.audience != null ? String(raw.audience).trim() : undefined,
    outputFiles: outputFiles.length > 0 ? outputFiles : [{ path: 'output.md', mediaType: 'text/markdown', role: 'primary' }],
    sourceContext: {
      useProjectInstructions: Boolean(rawSrc?.useProjectInstructions),
      useProjectWiki: Boolean(rawSrc?.useProjectWiki),
      useConversationContext: Boolean(rawSrc?.useConversationContext),
      referencedFiles: asStringArray(rawSrc?.referencedFiles),
    },
    acceptanceCriteria: asStringArray(raw.acceptanceCriteria),
    exportFormats: asStringArray(raw.exportFormats).filter((f) => VALID_EXPORT_FORMATS.has(f)) as ArtifactExportFormat[],
  }
}

// ---------------------------------------------------------------------------
// Parse generated file output (<<<FILE: path>>>…<<<END_FILE>>>)
// ---------------------------------------------------------------------------

function parseGenerationOutput(text: string): { relativePath: string; content: string }[] {
  const results: { relativePath: string; content: string }[] = []
  const regex = /<<<FILE:\s*([^\n>]+)>>>([\s\S]*?)<<<END_FILE>>>/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const relativePath = match[1].trim()
    const content = match[2].replace(/^\n/, '').replace(/\n$/, '')
    if (relativePath) results.push({ relativePath, content })
  }
  return results
}

// ---------------------------------------------------------------------------
// Provider messages builder
// ---------------------------------------------------------------------------

function buildChatMessages(messages: ArtifactGeneratorMessage[], projectContext?: string): ProviderMessage[] {
  const systemContent = projectContext
    ? `${ARTIFACT_GENERATOR_SYSTEM_PROMPT}\n\n## Project context\n${projectContext}`
    : ARTIFACT_GENERATOR_SYSTEM_PROMPT
  return [
    { role: 'system', content: systemContent },
    ...messages.map((m): ProviderMessage => ({ role: m.role, content: m.content })),
  ]
}

function buildGenerationMessages(spec: ArtifactSpec): ProviderMessage[] {
  return [
    { role: 'system', content: GENERATION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Generate the following artifact:\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\nOutput each file using the <<<FILE: path>>>…<<<END_FILE>>> delimiters.`,
    },
  ]
}

// ---------------------------------------------------------------------------
// LLM caller helper
// ---------------------------------------------------------------------------

export function getArtifactGeneratorModel(): string {
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

async function runProviderChat(
  win: BrowserWindow,
  providerMessages: ProviderMessage[],
  sessionId: string,
  sendChunk: (chunk: string) => void,
  cwd: string,
  modelOverride?: string,
): Promise<string> {
  const selectedModel = modelOverride ?? getArtifactGeneratorModel()

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
      : ARTIFACT_GENERATOR_SYSTEM_PROMPT
    const conversationMessages = providerMessages.filter((m) => m.role !== 'system')
    return adapter.send(
      win,
      { systemPrompt: systemMsg, messages: conversationMessages, cwd, model: cliModel, conversationId: sessionId },
      sendChunk,
    )
  }

  const { provider, model } = getProviderForAgent(selectedModel)
  const credential = getProviderCredential(provider)
  const systemPrompt = typeof providerMessages[0]?.content === 'string'
    ? providerMessages[0].content
    : ARTIFACT_GENERATOR_SYSTEM_PROMPT

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
    webContents: win.webContents,
    sendChunk,
    sendActivity: () => {},
    systemPrompt,
  })
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function getStorageRoot(): string {
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'artifact_storage_root'").get() as { value: string } | undefined
  return row?.value ?? path.join(app.getPath('userData'), 'artifacts')
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'artifact'
}

export function createArtifactGeneratorRunRecord(id: string, title: string): void {
  const db = getDatabase()
  const now = Date.now()
  db.prepare(
    `INSERT INTO artifact_generator_runs (id, title, status, created_at, updated_at) VALUES (?, ?, 'chatting', ?, ?)`,
  ).run(id, title, now, now)
}

export function updateArtifactGeneratorRunRecord(id: string, fields: Partial<{ status: string; specJson: string; artifactId: string }>): void {
  const db = getDatabase()
  const sets: string[] = ['updated_at = ?']
  const vals: unknown[] = [Date.now()]
  if (fields.status !== undefined) { sets.push('status = ?'); vals.push(fields.status) }
  if (fields.specJson !== undefined) { sets.push('spec_json = ?'); vals.push(fields.specJson) }
  if (fields.artifactId !== undefined) { sets.push('artifact_id = ?'); vals.push(fields.artifactId) }
  vals.push(id)
  db.prepare(`UPDATE artifact_generator_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

function rowToRun(row: Record<string, unknown>): ArtifactGeneratorRun {
  return {
    id: String(row.id),
    artifactId: row.artifact_id != null ? String(row.artifact_id) : null,
    title: String(row.title),
    status: String(row.status),
    specJson: row.spec_json != null ? String(row.spec_json) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

// ---------------------------------------------------------------------------
// Desktop streaming chat
// ---------------------------------------------------------------------------

export async function runArtifactGeneratorChat(
  win: BrowserWindow,
  messages: ArtifactGeneratorMessage[],
  projectId?: string,
  modelOverride?: string,
): Promise<void> {
  const providerMessages = buildChatMessages(messages)
  const sessionId = `artifact-gen-${randomUUID()}`
  const cwd = (projectId && getProjectRootDirectory(projectId)) || app.getPath('temp')

  let accumulated = ''
  const fullText = await runProviderChat(
    win,
    providerMessages,
    sessionId,
    (chunk) => {
      accumulated += chunk
      if (!win.isDestroyed()) win.webContents.send('artifact-generator:token', chunk)
    },
    cwd,
    modelOverride,
  )
  accumulated = fullText || accumulated

  const spec = extractArtifactSpec(accumulated)
  if (spec) {
    if (projectId) spec.scope = { type: 'project', projectId }
    if (!win.isDestroyed()) win.webContents.send('artifact-generator:spec-ready', spec)
  }
  if (!win.isDestroyed()) win.webContents.send('artifact-generator:done', { hasSpec: !!spec })
}

// ---------------------------------------------------------------------------
// Artifact generation runner
// ---------------------------------------------------------------------------

export async function runArtifactGeneration(
  win: BrowserWindow,
  runId: string,
  spec: ArtifactSpec,
  modelOverride?: string,
): Promise<string> {
  const db = getDatabase()
  const storageRoot = getStorageRoot()
  const projectId = spec.scope.type === 'project' ? spec.scope.projectId : undefined
  const slug = slugify(spec.title)

  // Determine version number
  let existingArtifactId: string | null = null
  const existingQ = projectId
    ? db.prepare('SELECT id FROM artifacts WHERE project_id = ? AND title = ?').get(projectId, spec.title) as { id: string } | undefined
    : db.prepare('SELECT id FROM artifacts WHERE project_id IS NULL AND title = ?').get(spec.title) as { id: string } | undefined

  if (existingQ) existingArtifactId = existingQ.id

  let versionNumber = 1
  if (existingArtifactId) {
    const maxV = db.prepare('SELECT MAX(version_number) AS v FROM artifact_versions WHERE artifact_id = ?').get(existingArtifactId) as { v: number | null } | undefined
    versionNumber = (maxV?.v ?? 0) + 1
  }

  const versionDir = projectId
    ? path.join(storageRoot, 'projects', projectId, slug, `v${versionNumber}`)
    : path.join(storageRoot, 'global', slug, `v${versionNumber}`)

  mkdirSync(versionDir, { recursive: true })
  updateArtifactGeneratorRunRecord(runId, { status: 'generating' })

  // Generate files via LLM
  const genMessages = buildGenerationMessages(spec)
  const genSessionId = `artifact-gen-files-${runId}`
  const genCwd = (projectId && getProjectRootDirectory(projectId)) || app.getPath('temp')
  let accumulated = ''
  const genFullText = await runProviderChat(
    win,
    genMessages,
    genSessionId,
    (chunk) => { accumulated += chunk },
    genCwd,
    modelOverride,
  )
  accumulated = genFullText || accumulated

  const parsed = parseGenerationOutput(accumulated)
  const writtenFiles: { relativePath: string; absolutePath: string; mediaType: string; role: string; sizeBytes: number }[] = []
  const auditSessionId = `artifact-generator:${runId}`

  const recordArtifactAudit = (relativePath: string) => {
    if (!projectId) return
    recordProjectAuditChange({
      sessionId: auditSessionId,
      projectId,
      title: spec.title,
      source: 'manual-apply',
      relativePath,
      status: 'created',
      lastOperation: 'create',
      diff: null,
    })
  }

  for (const f of parsed) {
    try {
      const dest = path.join(versionDir, f.relativePath)
      mkdirSync(path.dirname(dest), { recursive: true })
      writeFileSync(dest, f.content, 'utf8')
      recordArtifactAudit(f.relativePath)
      const size = statSync(dest).size
      const specFile = spec.outputFiles.find((sf) => sf.path === f.relativePath)
      writtenFiles.push({
        relativePath: f.relativePath,
        absolutePath: dest,
        mediaType: specFile?.mediaType ?? 'text/plain',
        role: specFile?.role ?? 'supporting',
        sizeBytes: size,
      })
      if (!win.isDestroyed()) win.webContents.send('artifact-generator:file-event', { file: f.relativePath, absolutePath: dest, status: 'done' })
    } catch {
      if (!win.isDestroyed()) win.webContents.send('artifact-generator:file-event', { file: f.relativePath, status: 'error' })
    }
  }

  // Fallback: if the model didn't use delimiters but returned text, write the whole response as a single file
  if (writtenFiles.length === 0 && accumulated.trim()) {
    const fallbackFile = spec.outputFiles[0] ?? { path: 'output.md', mediaType: 'text/markdown', role: 'primary' as const }
    const dest = path.join(versionDir, fallbackFile.path)
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(dest, accumulated, 'utf8')
    recordArtifactAudit(fallbackFile.path)
    const size = statSync(dest).size
    writtenFiles.push({ relativePath: fallbackFile.path, absolutePath: dest, mediaType: fallbackFile.mediaType, role: fallbackFile.role, sizeBytes: size })
    if (!win.isDestroyed()) win.webContents.send('artifact-generator:file-event', { file: fallbackFile.path, absolutePath: dest, status: 'done' })
  }

  if (writtenFiles.length === 0) {
    throw new Error('The model did not produce any files. Try again or refine your spec.')
  }

  // Persist to DB atomically
  const now = Date.now()
  const artifactId = existingArtifactId ?? randomUUID()
  const versionId = randomUUID()

  const manifestJson = JSON.stringify({
    artifactId,
    versionId,
    version: versionNumber,
    title: spec.title,
    kind: spec.kind,
    createdAt: now,
    files: writtenFiles.map((f) => ({ path: f.relativePath, mediaType: f.mediaType, role: f.role })),
  })

  db.transaction(() => {
    if (!existingArtifactId) {
      db.prepare(
        `INSERT INTO artifacts (id, project_id, title, kind, description, storage_root, current_version_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
      ).run(artifactId, projectId ?? null, spec.title, spec.kind, spec.intendedUse || null, storageRoot, versionId, now, now)
    } else {
      db.prepare('UPDATE artifacts SET current_version_id = ?, status = ?, updated_at = ? WHERE id = ?').run(versionId, 'ready', now, existingArtifactId)
    }
    db.prepare(
      `INSERT INTO artifact_versions (id, artifact_id, version_number, title, spec_json, manifest_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(versionId, artifactId, versionNumber, spec.title, JSON.stringify(spec), manifestJson, now)
    for (const f of writtenFiles) {
      db.prepare(
        `INSERT INTO artifact_files (id, version_id, relative_path, absolute_path, media_type, role, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), versionId, f.relativePath, f.absolutePath, f.mediaType, f.role, f.sizeBytes)
    }
  })()

  updateArtifactGeneratorRunRecord(runId, { status: 'ready', artifactId })
  return artifactId
}

// ---------------------------------------------------------------------------
// Android WS bridge
// ---------------------------------------------------------------------------

export async function runArtifactGeneratorChatForAndroid(
  messages: ArtifactGeneratorMessage[],
  sessionId: string,
  modelOverride?: string,
): Promise<void> {
  const fakeWin = {
    isDestroyed: () => false,
    webContents: {
      send: (_channel: string, _data: unknown) => {},
    },
  } as unknown as BrowserWindow

  const providerMessages = buildChatMessages(messages)
  let accumulated = ''
  const fullText = await runProviderChat(
    fakeWin,
    providerMessages,
    sessionId,
    (chunk) => {
      accumulated += chunk
      broadcastToMobile({ event: 'artifact-generator:token', data: { sessionId, chunk } })
    },
    app.getPath('temp'),
    modelOverride,
  )
  accumulated = fullText || accumulated

  const spec = extractArtifactSpec(accumulated)
  broadcastToMobile({
    event: 'artifact-generator:turn-complete',
    data: { sessionId, content: accumulated, hasSpec: !!spec },
  })
  if (spec) {
    broadcastToMobile({ event: 'artifact-generator:spec-ready', data: { sessionId, spec } })
  }
}

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

export function registerArtifactGeneratorHandlers(win?: BrowserWindow): void {
  safeHandle('artifact-generator:chat', async (_event, messages: ArtifactGeneratorMessage[], projectId?: string, modelOverride?: string) => {
    if (!win) throw new Error('No main window available')
    await runArtifactGeneratorChat(win, messages, projectId, modelOverride)
    return { started: true }
  })

  safeHandle('artifact-generator:generate', async (_event, runId: string, spec: ArtifactSpec, projectId?: string, modelOverride?: string) => {
    if (!win) throw new Error('No main window available')
    const db = getDatabase()
    const existing = db.prepare('SELECT id FROM artifact_generator_runs WHERE id = ?').get(runId)
    if (!existing) createArtifactGeneratorRunRecord(runId, spec.title)
    updateArtifactGeneratorRunRecord(runId, { specJson: JSON.stringify(spec) })
    await runArtifactGeneration(win, runId, spec, modelOverride)
    return { started: true }
  })

  safeHandle('artifact-generator:get-runs', async () => {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM artifact_generator_runs ORDER BY created_at DESC LIMIT 100').all() as Record<string, unknown>[]
    return rows.map(rowToRun)
  })

  safeHandle('artifact-generator:get-storage-root', async () => {
    return { path: getStorageRoot() }
  })

  safeHandle('artifact-generator:set-storage-root', async (_event, storagePath: string) => {
    const db = getDatabase()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('artifact_storage_root', ?)").run(storagePath)
    return { ok: true }
  })
}

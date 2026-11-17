import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import type { Debrief, DebriefArtifactResult, DebriefStory, DebriefStoryResult, DebriefStoryTone, StoryBeat, StoryMood } from '../shared/types'
import {
  DEFAULT_PROVIDER_MODEL,
  NO_PROVIDER_CONFIGURED_MESSAGE,
  getProviderForAgent,
  getProviderCredential,
  sendProviderNonStreaming,
} from './providers'
import type { ProviderMessage } from './providers'
import { ClaudeAdapter } from './cli-adapters/claude'
import { getAdapter } from './cli-adapters/registry'
import { broadcastToMobile, isMobileInForeground } from './ws-server'
import { broadcastConversationMessages } from './chat-handlers'
import { sendDebriefCompleteNotification } from './fcm-sender'
import { startActivity, endActivity } from './activity-tracker'
import {
  addSupportingFileToVersion,
  createPendingArtifactForConversation,
  findArtifactForConversation,
  insertPendingArtifactRefMessage,
  markArtifactGenerationFailed,
  readArtifactVersionFile,
  writeArtifactVersionForConversation,
} from './artifacts'

const HEAD = 4000
const HARD_LIMIT = 40_000

const DEBRIEF_SYSTEM_PROMPT = `You are a session debrief assistant. Analyze this AI chat conversation and return ONLY a JSON object (no markdown, no preamble) with this exact schema:
{
  "summary": "2-4 sentence summary of what was accomplished",
  "commandsAndTools": ["tool or command 1", ...],
  "reproductionGuide": "Step-by-step guide: 1. ... 2. ...",
  "mentalModel": "The reasoning approach / troubleshooting strategy used"
}
commandsAndTools: CLI commands, MCP tools, APIs, or techniques used.
reproductionGuide: numbered steps a reader can follow to reproduce from scratch.
mentalModel: the diagnostic or design thinking, not just the steps.`

const STORY_MOODS: StoryMood[] = ['problem', 'attempt', 'discovery', 'resolution']
const STORY_TONES: DebriefStoryTone[] = ['adventure', 'noir', 'fable', 'deadpan-technical']
const DEFAULT_STORY_TONE: DebriefStoryTone = 'adventure'
const DEFAULT_BEAT_COUNT = 5

const STORY_TONE_GUIDANCE: Record<DebriefStoryTone, string> = {
  adventure: 'Tell it as a swashbuckling adventure — stakes, momentum, a hero facing obstacles.',
  noir: 'Tell it as hardboiled noir — terse, atmospheric, world-weary narration.',
  fable: 'Tell it as a fable or fairy tale — simple, moralistic, once-upon-a-time framing.',
  'deadpan-technical': 'Tell it completely deadpan and dryly technical, as if narrating a nature documentary about a mundane office task — the humor comes from the contrast, not from jokes.',
}

/** Builds the story-generation system prompt for a given tone and beat count, clamped to the
 * 3-5 range the original hardcoded prompt always used. */
function buildStorySystemPrompt(tone: DebriefStoryTone = DEFAULT_STORY_TONE, beatCount: number = DEFAULT_BEAT_COUNT): string {
  const clampedCount = Math.min(5, Math.max(3, Math.round(beatCount)))
  const toneGuidance = STORY_TONE_GUIDANCE[tone] ?? STORY_TONE_GUIDANCE[DEFAULT_STORY_TONE]
  return `You are a storyteller who retells a technical debrief as a short narrative or analogy. Return ONLY a JSON object (no markdown, no preamble) with this exact schema:
{
  "title": "string",
  "beats": [
    { "caption": "<=200 chars", "mood": "problem|attempt|discovery|resolution", "svg": "<svg>...</svg>" }
  ]
}
Produce exactly ${clampedCount} beats. Preserve the causal chain from the source debrief (what went wrong, what was tried, what was discovered, what worked) reframed as a story or analogy — entertaining, but still technically accurate.

Tone: ${toneGuidance}

Each beat's "svg" is a small inline line-art icon illustrating that beat. Follow these rules exactly:
- The root element must be exactly <svg viewBox="0 0 100 100">...</svg> — no width or height attributes.
- Only these elements are allowed: svg, g, circle, rect, line, path, polygon, polyline.
- Never use: script, foreignObject, image, use, any "on*" event attribute, or a style/url(...) reference.
- Use at most 12 shape elements total — keep it a simple abstract icon, not a detailed illustration.
- Colors: only fill="currentColor" (primary), fill="var(--story-accent)" (secondary), or fill="none" with a stroke. Never use literal hex colors.

Example of a well-formed beat illustrating "a key turning in a lock":
{
  "caption": "The old config was a lock nobody still had the key for.",
  "mood": "discovery",
  "svg": "<svg viewBox=\\"0 0 100 100\\"><circle cx=\\"35\\" cy=\\"50\\" r=\\"18\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"6\\"/><rect x=\\"33\\" y=\\"46\\" width=\\"8\\" height=\\"8\\" fill=\\"currentColor\\"/><line x1=\\"53\\" y1=\\"50\\" x2=\\"85\\" y2=\\"50\\" stroke=\\"currentColor\\" stroke-width=\\"6\\"/><line x1=\\"70\\" y1=\\"50\\" x2=\\"70\\" y2=\\"62\\" stroke=\\"currentColor\\" stroke-width=\\"6\\"/><line x1=\\"80\\" y1=\\"50\\" x2=\\"80\\" y2=\\"58\\" stroke=\\"currentColor\\" stroke-width=\\"6\\"/></svg>"
}`
}

export interface DebriefSectionData {
  summary: string
  commandsAndTools: string[]
  reproductionGuide: string
  mentalModel: string
}

/**
 * Builds a plain-text User/Assistant transcript for a conversation, truncated to HARD_LIMIT
 * (head + tail) the same way debrief generation does. Shared so the quiz feature can read the
 * raw chat directly instead of only ever seeing a debrief. Returns '' when there are no
 * user/assistant messages.
 */
export function buildConversationTranscript(db: ReturnType<typeof getDatabase>, conversationId: string): string {
  const rows = db.prepare(
    "SELECT role, content FROM messages WHERE conversation_id = ? AND role IN ('user', 'assistant') ORDER BY timeline_order ASC, timestamp ASC, id ASC"
  ).all(conversationId) as { role: string; content: string }[]
  if (rows.length === 0) return ''
  const transcript = rows
    .map((r) => `${r.role === 'user' ? 'User' : 'Assistant'}: ${r.content}`)
    .join('\n\n')
  return transcript.length <= HARD_LIMIT
    ? transcript
    : transcript.slice(0, HEAD) + '\n\n[... conversation truncated ...]\n\n' + transcript.slice(-(HARD_LIMIT - HEAD))
}

/** Renders a debrief section as markdown, matching the format the old DebriefModal export produced. */
export function formatDebriefMarkdown(title: string, section: DebriefSectionData): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const toolLines = section.commandsAndTools.map((t) => `- ${t}`).join('\n') || '- None'
  return [
    `# Debrief: ${title}`,
    `Generated: ${date}`,
    '',
    '## Summary',
    section.summary,
    '',
    '## Commands & Tools Used',
    toolLines,
    '',
    '## How to Reproduce',
    section.reproductionGuide,
    '',
    '## Mental Model / Approach',
    section.mentalModel,
  ].join('\n')
}

function sectionToDebrief(section: DebriefSectionData, conversationId: string, projectId: string | null, versionId: string, timestamp: number): Debrief {
  return {
    id: versionId,
    conversationId,
    projectId,
    summary: section.summary,
    commandsTools: section.commandsAndTools,
    reproductionGuide: section.reproductionGuide,
    mentalModel: section.mentalModel,
    generatedAt: timestamp,
    createdAt: timestamp,
  }
}

export async function generateDebriefForWs(conversationId: string, projectId: string | null, model?: string): Promise<DebriefArtifactResult> {
  const db = getDatabase()
  const activityId = `debrief-generation:${conversationId}`
  const conversationTitleRow = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as { title: string } | undefined
  startActivity({ id: activityId, kind: 'debrief-generation', label: 'Generating debrief…', detail: conversationTitleRow?.title, projectId: projectId ?? undefined, conversationId })
  try {
    return await generateDebriefForWsInner(db, conversationId, projectId, model)
  } finally {
    endActivity(activityId)
  }
}

/** Resolves which BYOK provider/model to use for a debrief-family extraction call: an
 * explicit override, else the project's primary agent's model, else the app default. */
function resolveExtractionProvider(db: ReturnType<typeof getDatabase>, projectId: string | null, model?: string): ReturnType<typeof getProviderForAgent> {
  if (model) return getProviderForAgent(model)
  let agentModel = DEFAULT_PROVIDER_MODEL
  if (projectId) {
    const agentRow = db.prepare(
      'SELECT a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? AND pa.is_primary = 1 LIMIT 1'
    ).get(projectId) as { config_json: string } | undefined
    try {
      const cfg = JSON.parse(agentRow?.config_json ?? '{}') as Record<string, unknown>
      if (typeof cfg.model === 'string' && cfg.model) agentModel = cfg.model
    } catch { /* use default */ }
  }
  return getProviderForAgent(agentModel)
}

async function runExtraction(db: ReturnType<typeof getDatabase>, projectId: string | null, model: string | undefined, systemPrompt: string, userContent: string, temperature: number): Promise<string> {
  if (model === 'default') model = undefined
  const cli = /^(claude-cli|codex-cli|hermes-cli):(.*)$/.exec(model ?? '')
  if (cli) {
    const adapter = getAdapter(cli[1])
    if (!adapter?.isAvailable()) throw new Error(`${cli[1]} is not available`)
    return adapter.send(undefined, { systemPrompt, messages: [{ role: 'user', content: userContent }], cwd: '', model: cli[2], conversationId: randomUUID() }, () => {})
  }
  const resolved = resolveExtractionProvider(db, projectId, model)
  const credential = getProviderCredential(resolved.provider)
  if (credential) {
    const messages: ProviderMessage[] = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }]
    const result = await sendProviderNonStreaming(resolved.provider, credential, resolved.model, messages, { maxTokens: 2000, temperature })
    return result.content ?? ''
  }
  if (!model && ClaudeAdapter.isAvailable()) {
    return ClaudeAdapter.send(null as never, { systemPrompt, messages: [{ role: 'user', content: userContent }], cwd: '', model: 'default', conversationId: randomUUID() }, () => {})
  }
  throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
}

async function generateDebriefForWsInner(db: ReturnType<typeof getDatabase>, conversationId: string, projectId: string | null, model?: string): Promise<DebriefArtifactResult> {
  const truncatedTranscript = buildConversationTranscript(db, conversationId)
  if (!truncatedTranscript) throw new Error('Conversation has no messages to debrief')

  const userContent = `Here is the conversation to analyze:\n\n${truncatedTranscript}`

  const rawText = await runExtraction(db, projectId, model, DEBRIEF_SYSTEM_PROMPT, userContent, 0.3)

  const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  let parsed: { summary?: unknown; commandsAndTools?: unknown; reproductionGuide?: unknown; mentalModel?: unknown }
  try {
    parsed = JSON.parse(cleaned) as typeof parsed
  } catch {
    throw new Error('Failed to parse debrief JSON from AI response')
  }

  const section: DebriefSectionData = {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    commandsAndTools: Array.isArray(parsed.commandsAndTools) ? (parsed.commandsAndTools as unknown[]).map(String) : [],
    reproductionGuide: typeof parsed.reproductionGuide === 'string' ? parsed.reproductionGuide : '',
    mentalModel: typeof parsed.mentalModel === 'string' ? parsed.mentalModel : '',
  }

  const now = Date.now()
  const conversationRow = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as { title: string } | undefined
  const conversationTitle = conversationRow?.title ?? 'Conversation'
  const title = `Debrief: ${conversationTitle}`

  const { artifactId, versionId } = writeArtifactVersionForConversation({
    conversationId,
    projectId,
    kind: 'debrief',
    title,
    files: [
      { relativePath: 'debrief.json', mediaType: 'application/json', role: 'primary', content: JSON.stringify(section, null, 2) },
      { relativePath: 'debrief.md', mediaType: 'text/markdown', role: 'supporting', content: formatDebriefMarkdown(conversationTitle, section) },
    ],
  })

  const debrief = sectionToDebrief(section, conversationId, projectId, versionId, now)
  const result: DebriefArtifactResult = { debrief, artifactId, versionId }
  // The completed generation pins the existing pending `__artifact-ref` message row to this
  // version (writeArtifactVersionForConversation), but never re-syncs that row's updated
  // content to other devices on its own — without this, Android's synced pending card (or a
  // second desktop window) never learns the debrief finished and shows a stale spinner,
  // and previously fell back to inserting its own local "ready" card, producing a duplicate.
  broadcastConversationMessages(conversationId)
  broadcastToMobile({ event: 'debrief:ready', data: result })
  if (!isMobileInForeground()) {
    void sendDebriefCompleteNotification(db, { conversationId, title })
  }
  return result
}

/**
 * Creates the debrief artifact with status 'generating' immediately, then runs the actual
 * LLM generation in the background — the caller doesn't await completion, so the renderer
 * can attach a durable chat card right away instead of blocking on the round-trip. On
 * failure the artifact is flipped to 'failed' with the reason instead of spinning forever.
 *
 * `insertPendingMessage` is for trigger sources with no renderer of their own to attach a
 * chat card afterward (Android's WS trigger) — it inserts the pending `__artifact-ref` message
 * here instead, and broadcasts it so every connected device/window picks it up. Desktop's IPC
 * trigger leaves this false and keeps inserting its own card client-side (useChatWindowActions),
 * since that path also covers in-card "Regenerate" (reusing an existing artifact, which must NOT
 * get a second card) and re-running /debrief in the same conversation (which intentionally does).
 */
export function startDebriefGeneration(conversationId: string, projectId: string | null, model?: string, insertPendingMessage = false): { artifactId: string } {
  const db = getDatabase()
  const conversationRow = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as { title: string } | undefined
  const title = `Debrief: ${conversationRow?.title ?? 'Conversation'}`
  const isNewArtifact = !findArtifactForConversation(conversationId, 'debrief')
  const artifactId = createPendingArtifactForConversation({ conversationId, projectId, kind: 'debrief', title })
  if (insertPendingMessage && isNewArtifact) {
    insertPendingArtifactRefMessage(conversationId, artifactId, 'debrief')
    broadcastConversationMessages(conversationId)
  }
  void generateDebriefForWs(conversationId, projectId, model).catch((err) => {
    markArtifactGenerationFailed(artifactId, projectId, err instanceof Error ? err.message : String(err))
  })
  return { artifactId }
}

export function getDebriefForWs(conversationId: string): DebriefArtifactResult | null {
  const artifact = findArtifactForConversation(conversationId, 'debrief')
  const version = artifact?.currentVersion
  if (!artifact || !version) return null
  const content = readArtifactVersionFile(version.id, 'debrief.json')
  if (!content) return null
  let section: DebriefSectionData
  try {
    section = JSON.parse(content) as DebriefSectionData
  } catch {
    return null
  }
  const debrief = sectionToDebrief(section, conversationId, artifact.projectId, version.id, version.createdAt)
  return { debrief, artifactId: artifact.id, versionId: version.id }
}

/**
 * "Story mode" — a narrative/analogy retelling of an existing debrief, with small inline
 * line-art icons per beat. Generated lazily from the debrief's structured content (not the raw
 * transcript — cheaper, and keeps grounding tight) and cached as a supporting `story.json` file
 * on the debrief's current version, so repeat views don't re-call the model. Throws if no
 * debrief exists yet — the caller should offer to generate one first, same as quiz's Phase 1
 * "no debrief present" flow.
 */
export async function generateDebriefStoryForWs(
  conversationId: string,
  projectId: string | null,
  model?: string,
  forceRegenerate = false,
  tone?: DebriefStoryTone,
  beatCount?: number,
): Promise<DebriefStoryResult> {
  const db = getDatabase()
  const artifact = findArtifactForConversation(conversationId, 'debrief')
  const version = artifact?.currentVersion
  if (!artifact || !version) throw new Error('Generate a debrief first, then retell it as a story')
  const debriefContent = readArtifactVersionFile(version.id, 'debrief.json')
  if (!debriefContent) throw new Error('Debrief content not found')

  if (!forceRegenerate) {
    const cached = readArtifactVersionFile(version.id, 'story.json')
    if (cached) {
      try {
        return { story: JSON.parse(cached) as DebriefStory, artifactId: artifact.id, versionId: version.id }
      } catch { /* fall through and regenerate */ }
    }
  }

  let section: DebriefSectionData
  try {
    section = JSON.parse(debriefContent) as DebriefSectionData
  } catch {
    throw new Error('Failed to read debrief content')
  }
  const userContent = `Here is the debrief to retell as a story:\n\n${JSON.stringify(section, null, 2)}`

  const resolvedTone = tone && (STORY_TONES as string[]).includes(tone) ? tone : DEFAULT_STORY_TONE
  const resolvedBeatCount = typeof beatCount === 'number' && Number.isFinite(beatCount) ? beatCount : DEFAULT_BEAT_COUNT
  const storySystemPrompt = buildStorySystemPrompt(resolvedTone, resolvedBeatCount)
  const clampedBeatCount = Math.min(5, Math.max(3, Math.round(resolvedBeatCount)))

  const rawText = await runExtraction(db, projectId, model, storySystemPrompt, userContent, 0.7)

  const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  let parsed: { title?: unknown; beats?: unknown }
  try {
    parsed = JSON.parse(cleaned) as typeof parsed
  } catch {
    throw new Error('Failed to parse story JSON from AI response')
  }

  const rawBeats = Array.isArray(parsed.beats) ? parsed.beats : []
  const beats: StoryBeat[] = rawBeats
    .slice(0, clampedBeatCount)
    .map((b): StoryBeat => {
      const beat = (b ?? {}) as Record<string, unknown>
      const mood = typeof beat.mood === 'string' && (STORY_MOODS as string[]).includes(beat.mood)
        ? (beat.mood as StoryMood)
        : 'discovery'
      return {
        caption: typeof beat.caption === 'string' ? beat.caption.slice(0, 200) : '',
        mood,
        svg: typeof beat.svg === 'string' ? beat.svg : '',
      }
    })
    .filter((b) => b.caption.length > 0)

  if (beats.length === 0) throw new Error('Story generation returned no usable beats')

  const story: DebriefStory = {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : artifact.title,
    beats,
  }

  addSupportingFileToVersion(version.id, 'story.json', 'application/json', JSON.stringify(story, null, 2))

  return { story, artifactId: artifact.id, versionId: version.id }
}

export function markCompleteForWs(conversationId: string): { completedAt: number } | null {
  const db = getDatabase()
  const now = Date.now()
  const result = db.prepare(
    'UPDATE conversations SET completed_at = ? WHERE id = ?'
  ).run(now, conversationId)
  if (result.changes === 0) return null
  broadcastToMobile({ event: 'debrief:conversation-completed', data: { conversationId, completedAt: now } })
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('conversation:completed', { conversationId, completedAt: now })
  })
  return { completedAt: now }
}

export function markIncompleteForWs(conversationId: string): boolean {
  const db = getDatabase()
  const result = db.prepare(
    'UPDATE conversations SET completed_at = NULL WHERE id = ?'
  ).run(conversationId)
  if (result.changes === 0) return false
  broadcastToMobile({ event: 'debrief:conversation-incompleted', data: { conversationId } })
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('conversation:incompleted', { conversationId })
  })
  return true
}

export function registerDebriefHandlers(): void {
  safeHandle('conversation:generate-debrief', async (_event, conversationId: string, projectId: string | null, model?: string): Promise<DebriefArtifactResult> => {
    return generateDebriefForWs(conversationId, projectId, model)
  })

  safeHandle('conversation:start-debrief-generation', (_event, conversationId: string, projectId: string | null, model?: string) => {
    return startDebriefGeneration(conversationId, projectId, model)
  })

  safeHandle('conversation:get-debrief', (_event, conversationId: string): DebriefArtifactResult | null => {
    return getDebriefForWs(conversationId)
  })

  safeHandle('conversation:generate-debrief-story', async (_event, conversationId: string, projectId: string | null, model?: string, forceRegenerate?: boolean, tone?: DebriefStoryTone, beatCount?: number): Promise<DebriefStoryResult> => {
    return generateDebriefStoryForWs(conversationId, projectId, model, forceRegenerate, tone, beatCount)
  })

  safeHandle('conversation:mark-complete', (_event, conversationId: string): boolean => {
    return markCompleteForWs(conversationId) !== null
  })

  safeHandle('conversation:mark-incomplete', (_event, conversationId: string): boolean => {
    return markIncompleteForWs(conversationId)
  })
}

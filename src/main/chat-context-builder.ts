import { randomUUID } from 'crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from 'fs'
import { basename, relative, resolve, isAbsolute } from 'path'
import { spawn } from 'child_process'
import { nativeImage } from 'electron'
import type { WebContents } from 'electron'
import type { Database } from 'better-sqlite3'
import { getAgentConfig } from './agents'
import { listDirectoryEntries } from './file-handlers'
import { parseProjectConfig } from './project-handlers'
import { listProjectSources, rescanProjectSources } from './project-sources'
import { getRelevantWikiEntries, formatWikiSection } from './wiki-context'
import { applyWikiChangeProposal, listRecentWikiEntries, proposeWikiChange } from './wiki-handlers'
import { requestApproval } from './tools'
import { inferProjectAuditTarget, recordProjectAuditChange } from './project-audit'
import { computeLineDiff } from './diff-utils'
import { getSkillConfig, getSkillConfigsForAgent } from './skills'
import { EMPTY_CAPABILITY_PROFILE, getEffectiveCapabilityProfile, isBuiltInToolAllowed } from './capability-service'
import { persistSkillCapture, prepareSkillCapture, requestsSkillCapture } from './skill-service'
import { portableSkillName, readSkillResource, skillEntryMarkdown } from './skill-packages'
import type { ArtifactKind, SkillConfig } from '../shared/types'
import { extractKeywords } from './rating-handlers'
import { findSimilarRatedStrategies } from './rating-retrieval'
import type { ToolDefinition } from './provider-types'
import { debugLog } from './debug-mode'
import { NEXY_HELP_CONTENT } from './nexy-help'
import { broadcastToMobile } from './ws-server'
import { estimateTextTokens } from '../shared/token-estimate'
import { createArtifactFromPath } from './artifacts'
import { extractPdfText } from './pdf-text'

export type InlineHandler = (
  args: Record<string, unknown>
) => Promise<{ success: boolean; result?: string; error?: string }>

export type MobileChatActivity =
  | { state: 'thinking'; label: string }
  | { state: 'tool'; label: string; toolName?: string; serverName?: string }
  | { state: 'approval'; label: string; toolName?: string }
  | { state: 'complete'; label: string }
  | { state: 'error'; label: string }

export type ChatContextOptions = {
  attachments?: { id: string; name: string; path: string; size: number }[]
  images?: { id: string; name: string; dataUrl: string }[]
  agentId?: string
  projectId?: string
  conversationModel?: string
  fullAutoApprove?: boolean
  agenticMode?: boolean
  terminalSandboxBypass?: boolean
  toolPolicy?: { preApproved: string[]; alwaysAsk: string[]; neverAllow: string[] }
  /** When true, the chat is in plan mode: mutating tools (write/terminal) are withheld and an
   *  `exit_plan_mode` tool is exposed so the model can present a finalized plan for approval. */
  planMode?: boolean
  /** Receives the finalized plan so the chat lifecycle can persist it after the
   *  assistant response has a durable message ID. */
  onPlanFinalized?: (plan: string) => void
  /** Emits cheap, provider-neutral estimates while Nexy assembles the prompt. */
  onContextProgress?: (estimatedInputTokens: number, label: string) => void
}

export type BuiltContext = {
  augmentedContent: string
  attachedImages: { id: string; name: string; dataUrl: string }[]
  injectedRootDirectory: string | null
  /** Every enabled project source, refreshed at the beginning of the turn. */
  projectDirectories?: string[]
  wikiProjectId: string | null
  wikiToolDefs: ToolDefinition[]
  wikiInlineHandlers: Map<string, InlineHandler>
  fileToolDefs: ToolDefinition[]
  fileInlineHandlers: Map<string, InlineHandler>
  skillToolDefs: ToolDefinition[]
  skillInlineHandlers: Map<string, InlineHandler>
  planToolDefs: ToolDefinition[]
  planInlineHandlers: Map<string, InlineHandler>
}

/**
 * Resolves a model-supplied relative path against the project root and verifies the
 * result stays inside it, preventing a BYOK model from writing/reading files elsewhere
 * on disk (e.g. via "../../" traversal) using only the root directory as authorization.
 */
function resolveWithinRoots(rootDirectories: string[], requestedPath: string): string | null {
  for (const rootDirectory of rootDirectories) {
    const candidate = isAbsolute(requestedPath) ? requestedPath : resolve(rootDirectory, requestedPath)
    const resolved = resolve(candidate)
    const rel = relative(resolve(rootDirectory), resolved)
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return resolved
  }
  return null
}

// Session-scoped cache for directory listings. Keyed by project ID.
// Entries are invalidated when the project's rootDirectory changes.
const dirListingCache = new Map<string, { sourceKey: string; block: string }>()

export function clearDirListingCache(): void {
  dirListingCache.clear()
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])
const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

const ATTACHED_FOLDER_IGNORES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.gradle', '.idea', '.next', 'coverage',
])
const ATTACHED_FOLDER_FILE_LIMIT = 100
const ATTACHED_FOLDER_CHAR_LIMIT = 200_000

/**
 * A normal chat only receives the mutating skill tool when the user has clearly asked for a
 * skill to be kept somewhere. This avoids adding another callable tool to unrelated chats while
 * still allowing the natural "create this skill and save it in Nexy" workflow.
 */
function readAttachedFolder(folderPath: string, label: string): string {
  const blocks: string[] = []
  let fileCount = 0
  let charCount = 0
  let truncated = false

  const walk = (directory: string): void => {
    if (truncated) return
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (truncated || ATTACHED_FOLDER_IGNORES.has(entry.name)) continue
      const fullPath = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      if (fileCount >= ATTACHED_FOLDER_FILE_LIMIT || charCount >= ATTACHED_FOLDER_CHAR_LIMIT) {
        truncated = true
        break
      }
      try {
        const content = readFileSync(fullPath, 'utf8')
        const rel = relative(folderPath, fullPath).replace(/\\/g, '/')
        const remaining = ATTACHED_FOLDER_CHAR_LIMIT - charCount
        const included = content.slice(0, remaining)
        blocks.push(`File: ${label}/${rel}\n\`\`\`\n${included}\n\`\`\``)
        fileCount += 1
        charCount += included.length
        if (included.length < content.length) truncated = true
      } catch {
        // Binary and unreadable files stay represented by the folder name/tree omission.
      }
    }
  }
  walk(folderPath)
  const note = truncated
    ? `\nFolder attachment truncated after ${fileCount} readable files / ${charCount} characters.`
    : ''
  return `Folder: ${label}\n${blocks.join('\n\n')}${note}\n\n`
}

function generateThumbnail(dataUrl: string): string | undefined {
  try {
    const ni = nativeImage.createFromDataURL(dataUrl)
    if (ni.isEmpty()) return undefined
    const thumb = ni.resize({ width: 120 }).toJPEG(70)
    return `data:image/jpeg;base64,${thumb.toString('base64')}`
  } catch {
    return undefined
  }
}

function generateImagePreview(dataUrl: string): string | undefined {
  try {
    const ni = nativeImage.createFromDataURL(dataUrl)
    if (ni.isEmpty()) return undefined
    const { width } = ni.getSize()
    const preview = width > 1600
      ? ni.resize({ width: 1600, quality: 'best' })
      : ni
    return `data:image/jpeg;base64,${preview.toJPEG(90).toString('base64')}`
  } catch {
    return undefined
  }
}

function estimateDataUrlBytes(dataUrl: string): number {
  const payload = dataUrl.split(',', 2)[1] ?? ''
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

export type StoredAttachment = {
  id: string
  name: string
  size: number
  path?: string
  type?: 'file' | 'image'
  source?: 'desktop' | 'mobile' | 'pasted'
  thumbnailDataUrl?: string
  previewDataUrl?: string
}

function broadcastConversationMode(db: Database, conversationId: string): void {
  const row = db.prepare(
    'SELECT thinking_effort_override, full_auto_approve_override, agentic_mode_override, terminal_sandbox_override, cli_mode_override, codex_execution_mode_override FROM conversations WHERE id = ?',
  ).get(conversationId) as {
    thinking_effort_override: string | null
    full_auto_approve_override: number | null
    agentic_mode_override: number | null
    terminal_sandbox_override: number | null
    cli_mode_override: string | null
    codex_execution_mode_override: string | null
  } | undefined
  if (!row) return
  broadcastToMobile({
    event: 'conversation:mode-updated',
    data: {
      conversationId,
      thinkingEffortOverride: row.thinking_effort_override,
      fullAutoApproveOverride: row.full_auto_approve_override,
      agenticModeOverride: row.agentic_mode_override,
      terminalSandboxOverride: row.terminal_sandbox_override,
      cliModeOverride: row.cli_mode_override,
      codexExecutionModeOverride: row.codex_execution_mode_override,
    },
  })
}

export function buildStoredAttachments(
  attachments: ChatContextOptions['attachments'],
  images: ChatContextOptions['images'],
): StoredAttachment[] {
  return [
    ...(attachments ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      path: attachment.path,
      size: attachment.size,
      type: 'file' as const,
      source: 'desktop' as const,
    })),
    ...(images ?? []).map((image) => {
      const thumbnailDataUrl = generateThumbnail(image.dataUrl)
      const previewDataUrl = generateImagePreview(image.dataUrl)
      return {
        id: image.id,
        name: image.name,
        size: estimateDataUrlBytes(image.dataUrl),
        type: 'image' as const,
        source: 'mobile' as const,
        ...(thumbnailDataUrl !== undefined ? { thumbnailDataUrl } : {}),
        ...(previewDataUrl !== undefined ? { previewDataUrl } : {}),
      }
    }),
  ]
}

export async function buildChatContext(
  db: Database,
  conversationId: string,
  content: string,
  options: ChatContextOptions,
  webContents: WebContents | undefined,
  sendActivity: (a: MobileChatActivity) => void,
): Promise<BuiltContext> {
  const {
    attachments,
    images: pastedImages = [],
    agentId,
    projectId,
    fullAutoApprove,
    agenticMode,
    terminalSandboxBypass,
    planMode,
    onPlanFinalized,
  } = options
  const isPreApproved = (toolName: string) => options.toolPolicy?.preApproved.some(
    (allowed) => allowed === toolName || allowed.split('__').pop() === toolName,
  ) === true
  const scheduledAutoApprove = (toolName: string) => options.toolPolicy
    ? { autoApprove: isPreApproved(toolName) }
    : {}

  // ── Attachment and image processing ────────────────────────────────────────
  const attachedImages: { id: string; name: string; dataUrl: string }[] = [...pastedImages]
  let augmentedContent = content
  const reportContextProgress = (label: string) => {
    options.onContextProgress?.(estimateTextTokens(augmentedContent), label)
  }
  reportContextProgress('Collecting message context')

  if (attachments && attachments.length > 0) {
    let fileContext = ''
    for (const att of attachments) {
      if (!att.path) {
        fileContext += `File: ${att.name} (stored attachment metadata only)\n\n`
        continue
      }
      try {
        if (statSync(att.path).isDirectory()) {
          fileContext += readAttachedFolder(att.path, att.name)
          continue
        }
      } catch {
        fileContext += `File: ${att.name} (path is unavailable)\n\n`
        continue
      }
      const ext = att.name.split('.').pop()?.toLowerCase() ?? ''
      if (IMAGE_EXTENSIONS.has(ext)) {
        try {
          const buf = readFileSync(att.path)
          const mime = IMAGE_MIME[ext]
          attachedImages.push({
            id: att.id,
            name: att.name,
            dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
          })
        } catch {
          fileContext += `File: ${att.name} (could not read image)\n\n`
        }
      } else {
        try {
          if (ext === 'pdf') {
            const extracted = extractPdfText(readFileSync(att.path))
            fileContext += extracted.text
              ? `PDF: ${att.name} (locally extracted text)\n\`\`\`text\n${extracted.text}\n\`\`\`\n\n`
              : `PDF: ${att.name} (no selectable text was found; this may be a scanned/image-only PDF and needs page rendering or OCR)\n\n`
          } else {
            const fileContent = readFileSync(att.path, 'utf-8')
            fileContext += `File: ${att.name}\n\`\`\`\n${fileContent}\n\`\`\`\n\n`
          }
        } catch {
          fileContext += ext === 'pdf'
            ? `PDF: ${att.name} (could not extract text)\n\n`
            : `File: ${att.name} (could not read file)\n\n`
        }
      }
    }
    if (fileContext) augmentedContent = fileContext + content
    reportContextProgress('Collecting attachments')
  }

  // ── Baseline product grounding (unconditional — not gated on a custom agent having its own
  // system prompt) ────────────────────────────────────────────────────────────
  // The agent system-prompt block below only fires when the active agent has a configured
  // systemPrompt; a plain conversation with no custom agent gets none of that context. Observed
  // failure mode: asked "how do I change code from here?" or "is there a feature for X?", a chat
  // agent with no grounding hallucinated a generic Read/Edit/Write/Glob/Grep/Bash tool workflow
  // (Claude Code CLI's own tool names, not anything that exists in this app) and then couldn't
  // answer a basic "does this app have that feature" follow-up at all.
  //
  // Injected as plain text on the first message only (mirrors the wiki auto-injection below) —
  // it stays in the conversation's history for every later turn without being resent as fresh
  // input tokens every single turn. A callable tool was tried first and reverted: making a tool
  // unconditionally available flips every BYOK conversation's hasToolLoop check on globally
  // (chat-provider-dispatch.ts), routing even simple chats through the MCP tool-loop path instead
  // of plain streaming — a much bigger behavior change than intended, and it broke thinking-delta
  // streaming outright. Plain prepended text has no such side effect.
  // The current user message is already persisted by the time this runs (see chat-handlers.ts),
  // so the first-ever message in a conversation reads back as count === 1 — matching the wiki
  // auto-injection's own check below, not 0.
  const isFirstMessage = (
    db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?').get(conversationId) as { count: number }
  ).count === 1
  if (isFirstMessage) {
    augmentedContent = `[Nexy app reference — background context, not something to repeat verbatim to the user:\n\n${NEXY_HELP_CONTENT}]\n\n${augmentedContent}`
    reportContextProgress('Adding app context')
  }

  // ── Agent system prompt injection ──────────────────────────────────────────
  const convRow = db
    .prepare('SELECT agent_id FROM conversations WHERE id = ?')
    .get(conversationId) as { agent_id: string | null } | undefined

  const effectiveAgentId = agentId ?? convRow?.agent_id ?? null
  // Capability profiles are additive context. Keep direct/unit callers that provide a
  // minimal database stub working when there is no persisted conversation row yet.
  const chatCapabilityProfile = convRow
    ? getEffectiveCapabilityProfile(db, conversationId)
    : EMPTY_CAPABILITY_PROFILE
  const fileEditAllowed = isBuiltInToolAllowed(chatCapabilityProfile, 'fileEdit')
  const terminalAllowed = isBuiltInToolAllowed(chatCapabilityProfile, 'terminal')
  const agentSkills = effectiveAgentId ? getSkillConfigsForAgent(effectiveAgentId) : []
  const chatSkills = chatCapabilityProfile.skillIds
    .map((skillId) => getSkillConfig(skillId))
    .filter((skill): skill is SkillConfig => Boolean(skill))
  const availableSkills = [...new Map([...agentSkills, ...chatSkills].map((skill) => [skill.id, skill])).values()]
  const activatedSkillIds = new Set<string>()
  const recordSkillActivation = (skill: SkillConfig, trigger: 'explicit' | 'implicit') => {
    if (activatedSkillIds.has(skill.id)) return
    if (effectiveAgentId) {
      db.prepare(
        `INSERT OR IGNORE INTO conversation_skill_invocations
         (id, conversation_id, skill_id, agent_id, content_hash, trigger, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'activated', ?)`,
      ).run(randomUUID(), conversationId, skill.id, effectiveAgentId, skill.contentHash ?? null, trigger, Date.now())
    }
    db.prepare(
      `INSERT OR IGNORE INTO conversation_capability_invocations
       (id, conversation_id, skill_id, trigger, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(randomUUID(), conversationId, skill.id, trigger, Date.now())
    activatedSkillIds.add(skill.id)
  }
  const findAvailableSkill = (name: string) => {
    const slug = portableSkillName(name)
    return availableSkills.find((skill) => portableSkillName(String(skill.frontmatter?.name ?? skill.name)) === slug) ?? null
  }

  if (availableSkills.length > 0 || effectiveAgentId) {
    if (availableSkills.length > 0) {
      const catalog = availableSkills
        .map((skill) => `- ${portableSkillName(String(skill.frontmatter?.name ?? skill.name))}: ${skill.description}`)
        .join('\n')
      augmentedContent = `[Available skills — metadata only. Activate a skill only when its description clearly matches the task:\n${catalog}]\n\n${augmentedContent}`

      const explicit = content.trimStart().match(/^\$([a-z0-9]+(?:-[a-z0-9]+)*)\b/i)
      if (explicit) {
        const skill = findAvailableSkill(explicit[1])
        if (skill) {
          recordSkillActivation(skill, 'explicit')
          augmentedContent = `[Explicitly activated skill: ${portableSkillName(String(skill.frontmatter?.name ?? skill.name))}\n\n${skillEntryMarkdown(skill)}]\n\n${augmentedContent}`
        } else {
          augmentedContent = `[Skill activation failed: ${explicit[1]} is not available to this agent.]\n\n${augmentedContent}`
        }
      }
    }

    const agentCfg = effectiveAgentId ? getAgentConfig(effectiveAgentId) : null
    if (agentCfg?.systemPrompt) {
      let systemPromptText = agentCfg.systemPrompt as string

      if (systemPromptText.includes('{{scratchpad}}')) {
        const scratchpadRow = db
          .prepare(
            "SELECT file_path FROM agent_knowledge_files WHERE agent_id = ? AND file_path LIKE '%-scratchpad.md' LIMIT 1",
          )
          .get(effectiveAgentId) as { file_path: string } | undefined
        const scratchpadContent =
          scratchpadRow?.file_path && existsSync(scratchpadRow.file_path)
            ? readFileSync(scratchpadRow.file_path, 'utf-8')
            : ''
        systemPromptText = systemPromptText.replace(/\{\{scratchpad\}\}/g, scratchpadContent)
      }

      const memoryBlock = agentCfg.memory ? `\n\n## Agent Memory\n${agentCfg.memory}` : ''

      const knowledgeRows = db
        .prepare(
          "SELECT file_path FROM agent_knowledge_files WHERE agent_id = ? AND inject_mode = 'always' ORDER BY sort_order ASC",
        )
        .all(effectiveAgentId) as { file_path: string }[]
      const knowledgeBlocks: string[] = []
      for (const kf of knowledgeRows) {
        if (!existsSync(kf.file_path)) continue
        const raw = readFileSync(kf.file_path, 'utf-8')
        const fileName = basename(kf.file_path)
        if (raw.length > 32000) {
          const truncated = raw.split('\n').slice(0, 100).join('\n')
          knowledgeBlocks.push(
            `### ${fileName}\n${truncated}\n\n<!-- [Knowledge file truncated — ${Math.ceil(raw.length / 4)} tokens total] -->`,
          )
        } else {
          knowledgeBlocks.push(`### ${fileName}\n${raw}`)
        }
      }
      const knowledgeBlock =
        knowledgeBlocks.length > 0
          ? `\n\n## Knowledge Files\n${knowledgeBlocks.join('\n\n---\n\n')}`
          : ''

      const toolLines: string[] = []
      const tc = agentCfg?.tools as {
        fileEdit?: { enabled?: boolean; instructions?: string }
        terminal?: { enabled?: boolean; instructions?: string }
        webFetch?: { enabled?: boolean; instructions?: string }
      } | null
      if (tc?.fileEdit?.enabled && tc.fileEdit.instructions) {
        toolLines.push(`- **File Edit**: ${tc.fileEdit.instructions}`)
      }
      if (tc?.terminal?.enabled && tc.terminal.instructions) {
        toolLines.push(`- **Terminal**: ${tc.terminal.instructions}`)
      }
      if (tc?.webFetch?.enabled && tc.webFetch.instructions) {
        toolLines.push(`- **Web Fetch**: ${tc.webFetch.instructions}`)
      }
      const mcpOverrides = db
        .prepare(
          "SELECT tool_name, server_id, instructions FROM agent_mcp_tool_overrides WHERE agent_id=? AND enabled=1 AND instructions != ''",
        )
        .all(effectiveAgentId) as { tool_name: string; server_id: string; instructions: string }[]
      for (const o of mcpOverrides) {
        toolLines.push(`- **${o.tool_name}** (via ${o.server_id}): ${o.instructions}`)
      }
      const guidelinesBlock =
        toolLines.length > 0 ? `\n\n## Tool Usage Guidelines\n${toolLines.join('\n')}` : ''

      augmentedContent = `[System Instructions]\n${systemPromptText}${memoryBlock}${knowledgeBlock}${guidelinesBlock}\n[/System Instructions]\n\n${augmentedContent}`
      reportContextProgress('Adding agent knowledge')
    }
  }

  // ── Project context injection ──────────────────────────────────────────────
  let injectedRootDirectory: string | null = null
  let projectDirectories: string[] = []
  let wikiProjectId: string | null = null

  const convProjectId =
    projectId ??
    (
      db
        .prepare('SELECT project_id FROM conversations WHERE id = ?')
        .get(conversationId) as { project_id: string | null } | undefined
    )?.project_id ??
    null

  if (convProjectId) {
    wikiProjectId = convProjectId
    const projRow = db
      .prepare('SELECT config_json FROM projects WHERE id = ?')
      .get(convProjectId) as { config_json: string | null } | undefined
    const projCfg = parseProjectConfig(projRow?.config_json ?? null)

    // Sources can be added while a conversation is already open. Refresh the persisted
    // hierarchy before building context so BYOK and CLI-backed turns see the same project
    // locations without requiring a new conversation or app restart.
    try {
      await rescanProjectSources(db, convProjectId)
    } catch (error) {
      debugLog('chat', `context-builder: source rescan failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    const hierarchy = listProjectSources(db, convProjectId)
    projectDirectories = hierarchy.sources
      .filter((source) => source.enabled && existsSync(source.localPath))
      .map((source) => source.localPath)
    if (projectDirectories.length === 0 && projCfg.rootDirectory && existsSync(projCfg.rootDirectory)) {
      projectDirectories = [projCfg.rootDirectory]
    }

    if (projCfg.instructionsEnabled && projCfg.instructions.trim()) {
      let instructions = projCfg.instructions
      for (const { key, value } of projCfg.variables) {
        instructions = instructions.replaceAll(`{{${key}}}`, value)
      }
      for (const { key, value } of projCfg.variables) {
        augmentedContent = augmentedContent.replaceAll(`{{${key}}}`, value)
      }

      const projectBlock = `[Project Context]\n${instructions}\n[/Project Context]`
      switch (projCfg.instructionMode) {
        case 'prepend':
          augmentedContent = `${projectBlock}\n\n${augmentedContent}`
          break
        case 'append': {
          const splitMarker = '\n\n'
          const splitIdx = augmentedContent.indexOf(splitMarker)
          if (splitIdx !== -1) {
            augmentedContent =
              augmentedContent.slice(0, splitIdx) +
              splitMarker +
              projectBlock +
              splitMarker +
              augmentedContent.slice(splitIdx + splitMarker.length)
          } else {
            augmentedContent = `${augmentedContent}\n\n${projectBlock}`
          }
          break
        }
        case 'replace':
        case 'standalone':
          augmentedContent = `${projectBlock}\n\n${content}`
          break
      }
      reportContextProgress('Adding project context')
    }

    if (projCfg.strategyRetrievalEnabled) {
      const similarStrategies = findSimilarRatedStrategies({
        agentId: effectiveAgentId,
        model: options.conversationModel ?? null,
        projectId: convProjectId,
        keywords: extractKeywords(content),
      })
      if (similarStrategies.length > 0) {
        const strategyLines = similarStrategies.map((s) => {
          const agent = s.snapshot.agentName ? ` using ${s.snapshot.agentName}` : ''
          const tools = s.snapshot.toolNames.length > 0 ? ` — tools: ${s.snapshot.toolNames.join(', ')}` : ''
          const note = s.note ? ` — note: "${s.note}"` : ''
          return `- Rated ${s.rating}/5${agent}${tools}${note}`
        })
        const strategyBlock =
          `[Similar Past Strategies]\n` +
          `These past conversations in this project were rated highly for similar work:\n` +
          `${strategyLines.join('\n')}\n` +
          `[/Similar Past Strategies]`
      augmentedContent = `${strategyBlock}\n\n${augmentedContent}`
      reportContextProgress('Adding past strategies')
      }
    }

    if (projectDirectories.length > 0) {
      injectedRootDirectory = projectDirectories[0]
      const sourceKey = projectDirectories.join('\0')
      debugLog('chat', `context-builder: injecting directory listings for ${projectDirectories.join(', ')}`)
      const cached = dirListingCache.get(convProjectId)
      let structureBlock: string
      if (cached && cached.sourceKey === sourceKey) {
        structureBlock = cached.block
      } else {
        const sourceBlocks = projectDirectories.map((directory) => {
          const entries = listDirectoryEntries(directory, 3, '')
          const lines = entries.map((e) => (e.type === 'dir' ? `${e.relativePath}/` : e.relativePath))
          return `Source: ${directory}\n${lines.join('\n')}`
        })
        structureBlock =
          `[Project File Structure]\n` +
          `The following file trees have already been retrieved from all enabled project source directories. ` +
          `Use it to answer questions about the project structure — do NOT say you cannot access the file system.\n` +
          `\`\`\`\n${sourceBlocks.join('\n\n')}\n\`\`\`\n` +
          `[/Project File Structure]`
        dirListingCache.set(convProjectId, {
          sourceKey,
          block: structureBlock,
        })
      }
      augmentedContent = `${structureBlock}\n\n${augmentedContent}`
      reportContextProgress('Collecting project files')
    } else if (projCfg.rootDirectory) {
      debugLog('chat', `context-builder: rootDirectory set but path not found on disk: ${JSON.stringify(projCfg.rootDirectory)}`)
    } else {
      debugLog('chat', `context-builder: no rootDirectory configured for project ${convProjectId}`)
    }

    const inScopeRules = projCfg.inScope ?? []
    const outOfScopeRules = projCfg.outOfScope ?? []
    const milestonesArr = projCfg.milestones ?? []
    const activeMilestone = milestonesArr.find((m) => m.status === 'active')
    if (activeMilestone || inScopeRules.length > 0 || outOfScopeRules.length > 0) {
      const scopeLines: string[] = []
      if (activeMilestone) {
        const desc = activeMilestone.description ? ` — ${activeMilestone.description}` : ''
        scopeLines.push(`Active Milestone: ${activeMilestone.title}${desc}`)
      }
      if (inScopeRules.length > 0) {
        scopeLines.push('In Scope:')
        for (const r of inScopeRules) {
          scopeLines.push(`  - ${r.description}${r.pathGlob ? ` (${r.pathGlob})` : ''}`)
        }
      }
      if (outOfScopeRules.length > 0) {
        scopeLines.push('Out of Scope (do NOT work on these):')
        for (const r of outOfScopeRules) {
          scopeLines.push(`  - ${r.description}${r.pathGlob ? ` (${r.pathGlob})` : ''}`)
        }
      }
      const scopeBlock = `[Project Scope]\n${scopeLines.join('\n')}\n[/Project Scope]`
      augmentedContent = `${scopeBlock}\n\n${augmentedContent}`
      reportContextProgress('Adding project scope')
    }

    // Team awareness block — inject when project has ≥2 agents, orchestration disabled
    const projCfgRaw = projRow?.config_json
      ? (() => {
          try {
            return JSON.parse(projRow.config_json) as Record<string, unknown>
          } catch {
            return {}
          }
        })()
      : {}
    const orchAlreadyEnabled = projCfgRaw.orchestrationEnabled === true
    if (!orchAlreadyEnabled) {
      const teamRows = db
        .prepare(
          'SELECT pa.agent_id, pa.is_primary, a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? ORDER BY pa.is_primary DESC, pa.sort_order ASC',
        )
        .all(convProjectId) as { agent_id: string; is_primary: number; config_json: string }[]

      if (teamRows.length >= 2) {
        const projName =
          (
            db.prepare('SELECT name FROM projects WHERE id = ?').get(convProjectId) as
              | { name: string }
              | undefined
          )?.name ?? 'this project'
        const memberLines = teamRows.map((r) => {
          const cfg = (() => {
            try {
              return JSON.parse(r.config_json) as Record<string, unknown>
            } catch {
              return {}
            }
          })()
          const name = typeof cfg.name === 'string' ? cfg.name : 'Agent'
          const icon = typeof cfg.icon === 'string' ? cfg.icon : '🤖'
          const role = r.is_primary ? ' (primary — currently speaking)' : ''
          return `  - ${icon} ${name}${role}`
        })
        const teamBlock =
          `[Project Team — "${projName}"]\n` +
          `This conversation is part of a project with the following agents:\n` +
          memberLines.join('\n') +
          '\n' +
          `Orchestration is currently disabled, so you cannot autonomously delegate tasks.\n` +
          `If asked about delegation or other agents, be honest: the user can switch agents manually\n` +
          `or enable orchestration in the project settings to allow automatic delegation.\n` +
          `[/Project Team]`
        augmentedContent = `${teamBlock}\n\n${augmentedContent}`
        reportContextProgress('Adding project team')
      }
    }
  }

  // Auto-inject relevant wiki entries on every project turn. Including the last few user
  // messages keeps short follow-ups anchored to the current topic without flooding context.
  if (convProjectId) {
    const recentUserRows = db.prepare(
      `SELECT content FROM messages
       WHERE conversation_id = ? AND role = 'user'
       ORDER BY timeline_order DESC, timestamp DESC, id DESC
       LIMIT 3`,
    ).all(conversationId) as { content: string }[]
    const wikiSearchText = recentUserRows.length > 0
      ? recentUserRows.map((row) => row.content).reverse().join('\n\n')
      : content
    const wikiEntries = getRelevantWikiEntries(db, convProjectId, wikiSearchText, 4)
    if (wikiEntries.length > 0) {
      const wikiBlock = formatWikiSection(wikiEntries)
      augmentedContent = `${wikiBlock}\n\n${augmentedContent}`
      reportContextProgress('Collecting project wiki')
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('chat:wiki-injected', { count: wikiEntries.length })
      }
    }
  }

  // ── Wiki inline tools ──────────────────────────────────────────────────────
  const wikiToolDefs: ToolDefinition[] = []
  const wikiInlineHandlers = new Map<string, InlineHandler>()

  if (wikiProjectId) {
    wikiToolDefs.push(
      {
        type: 'function' as const,
        function: {
          name: 'search_project_wiki',
          description:
            'Search the project wiki for relevant knowledge, decisions, procedures, or facts. Use this whenever past project memory may help answer the user.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Keywords or question to search for in the project wiki',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'list_recent_wiki_entries',
          description:
            'List recently updated active project wiki entries. Use this to orient yourself when you need a quick view of available project memory.',
          parameters: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of entries to list (default 8, maximum 25)',
              },
            },
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'propose_wiki_entry',
          description:
            'Propose saving durable project knowledge to the wiki. Nexy will decide whether to create, update, or supersede an entry, and the user must explicitly approve before anything is saved.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short descriptive title for the wiki entry' },
              body: { type: 'string', description: 'Full content of the wiki entry in markdown' },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional tags to categorize the entry',
              },
            },
            required: ['title', 'body'],
          },
        },
      },
    )

    const capturedProjectId = wikiProjectId
    const capturedDb = db
    const capturedWebContents = webContents
    const capturedConversationId = conversationId

    wikiInlineHandlers.set('search_project_wiki', async (args) => {
      sendActivity({
        state: 'tool',
        label: 'Searching project wiki',
        toolName: 'search_project_wiki',
        serverName: 'Project Wiki',
      })
      const query = typeof args.query === 'string' ? args.query : String(args.query ?? '')
      const entries = getRelevantWikiEntries(capturedDb, capturedProjectId, query)
      if (entries.length === 0)
        return { success: true, result: 'No relevant wiki entries found for this query.' }
      return { success: true, result: formatWikiSection(entries) }
    })

    wikiInlineHandlers.set('list_recent_wiki_entries', async (args) => {
      sendActivity({
        state: 'tool',
        label: 'Listing recent wiki entries',
        toolName: 'list_recent_wiki_entries',
        serverName: 'Project Wiki',
      })
      const rawLimit = typeof args.limit === 'number' ? args.limit : Number(args.limit ?? 8)
      const entries = listRecentWikiEntries(capturedDb, capturedProjectId, Number.isFinite(rawLimit) ? rawLimit : 8)
      if (entries.length === 0) return { success: true, result: 'No active wiki entries exist for this project yet.' }
      const formatted = entries.map((entry) => {
        const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : ''
        return `### ${entry.title}${tags}\n${entry.body.slice(0, 800)}${entry.body.length > 800 ? '...' : ''}`
      }).join('\n\n')
      return { success: true, result: `[Recent Project Wiki Entries]\n${formatted}` }
    })

    wikiInlineHandlers.set('propose_wiki_entry', async (args) => {
      const title = typeof args.title === 'string' ? args.title : String(args.title ?? '')
      const body = typeof args.body === 'string' ? args.body : String(args.body ?? '')
      const tags = Array.isArray(args.tags) ? (args.tags as string[]).map(String) : []
      let proposal: ReturnType<typeof proposeWikiChange>
      try {
        proposal = proposeWikiChange(capturedDb, capturedProjectId, title, body, tags)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Invalid wiki proposal' }
      }
      sendActivity({
        state: 'approval',
        label: 'Waiting for wiki approval',
        toolName: 'propose_wiki_entry',
      })
      const actionLabel =
        proposal.action === 'create' ? 'Create wiki entry'
        : proposal.action === 'update' ? `Update wiki entry: "${proposal.matchingEntryTitle}"`
        : `Supersede wiki entry: "${proposal.supersededEntryTitle}"`
      const approved = await requestApproval(
        capturedWebContents,
        'propose_wiki_entry',
        proposal as unknown as Record<string, unknown>,
        `${actionLabel} with "${proposal.title}"`,
        { noRemember: true, conversationId: capturedConversationId, ...scheduledAutoApprove('propose_wiki_entry') },
      )
      if (!approved) return { success: false, error: 'User declined the wiki proposal' }
      const entry = applyWikiChangeProposal(capturedDb, proposal, { conversationId: capturedConversationId })
      const mobileEntry = {
        ...entry,
        projectId: entry.project_id,
        sourceConversationId: entry.source_conversation_id,
        sourceMessageId: entry.source_message_id,
        supersededBy: entry.superseded_by,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
      }
      broadcastToMobile({
        event: proposal.action === 'create' ? 'wiki:entry-created' : 'wiki:entry-updated',
        data: { entry: mobileEntry },
      })
      sendActivity({
        state: 'tool',
        label: 'Saved wiki entry',
        toolName: 'propose_wiki_entry',
        serverName: 'Project Wiki',
      })
      return { success: true, result: `${proposal.action === 'create' ? 'Created' : proposal.action === 'update' ? 'Updated' : 'Superseded'} wiki entry "${entry.title}".` }
    })
  }

  // ── Project file tools (read/write scoped to the project root) ─────────────
  const fileToolDefs: ToolDefinition[] = []
  const fileInlineHandlers = new Map<string, InlineHandler>()

  if (injectedRootDirectory) {
    const capturedRoots = projectDirectories.length > 0 ? projectDirectories : [injectedRootDirectory]
    const capturedWebContentsForFiles = webContents
    const capturedFullAutoApprove = fullAutoApprove
    const capturedAgenticMode = agenticMode

    if (fileEditAllowed) fileToolDefs.push({
      type: 'function' as const,
      function: {
        name: 'read_project_file',
        description:
          'Read the contents of a file within any enabled project source directory. Relative paths are resolved against the project sources in listed order.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path, relative to the project root' },
          },
          required: ['path'],
        },
      },
    })

    // In plan mode the chat is read-only: the mutating write tool is withheld so the model
    // researches and plans without editing, then presents its plan via exit_plan_mode.
    if (fileEditAllowed && !planMode) {
      fileToolDefs.push({
        type: 'function' as const,
        function: {
          name: 'write_project_file',
          description:
            'Create or overwrite a file within any enabled project source directory. Relative paths are resolved against the project sources in listed order. Always requires explicit user approval before writing.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path, relative to the project root' },
              content: { type: 'string', description: 'Full content to write to the file' },
            },
            required: ['path', 'content'],
          },
        },
      })
      fileToolDefs.push({
        type: 'function' as const,
        function: {
          name: 'copy_path_to_artifact',
          description:
            'Copy a file or folder you can access inside the current project into Nexy as a durable, versioned artifact. Use this when the user asks to keep, return, or save an existing file as an artifact. Requires user approval.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File or folder path, relative to the project root' },
              title: { type: 'string', description: 'Optional artifact title' },
              kind: {
                type: 'string',
                enum: ['document', 'code', 'ui', 'data', 'prompt', 'agent-config', 'plan', 'bundle', 'other'],
                description: 'Artifact kind; defaults to bundle for folders and other for files',
              },
            },
            required: ['path'],
          },
        },
      })
    }

    if (fileEditAllowed) fileInlineHandlers.set('read_project_file', async (args) => {
      const requestedPath = typeof args.path === 'string' ? args.path : String(args.path ?? '')
      const resolvedPath = resolveWithinRoots(capturedRoots, requestedPath)
      if (!resolvedPath) return { success: false, error: 'Path is outside the project directory' }
      sendActivity({ state: 'tool', label: `Reading ${requestedPath}`, toolName: 'read_project_file' })
      if (!existsSync(resolvedPath)) return { success: false, error: `File not found: ${requestedPath}` }
      try {
        const text = readFileSync(resolvedPath, 'utf-8')
        const truncated = text.length > 100000 ? text.slice(0, 100000) + '\n\n... (truncated, file too large)' : text
        return { success: true, result: truncated }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to read file' }
      }
    })

    if (fileEditAllowed && !planMode) fileInlineHandlers.set('write_project_file', async (args) => {
      const requestedPath = typeof args.path === 'string' ? args.path : String(args.path ?? '')
      const fileContent = typeof args.content === 'string' ? args.content : String(args.content ?? '')
      const resolvedPath = resolveWithinRoots(capturedRoots, requestedPath)
      if (!resolvedPath) return { success: false, error: 'Path is outside the project directory' }
      sendActivity({ state: 'approval', label: 'Waiting for file write approval', toolName: 'write_project_file' })
      const approved = await requestApproval(
        capturedWebContentsForFiles,
        'write_project_file',
        { path: requestedPath },
        `Write file: ${requestedPath}`,
        { noRemember: true, autoApprove: capturedFullAutoApprove || capturedAgenticMode || isPreApproved('write_project_file') },
      )
      if (!approved) return { success: false, error: 'User declined file write' }
      try {
        const existed = existsSync(resolvedPath)
        const beforeContent = existed ? readFileSync(resolvedPath, 'utf-8') : ''
        writeFileSync(resolvedPath, fileContent, 'utf-8')
        const auditTarget = inferProjectAuditTarget(resolvedPath)
        if (auditTarget) {
          recordProjectAuditChange({
            ...auditTarget,
            title: 'Tool file write',
            source: 'chat-tool',
            status: existed ? 'modified' : 'created',
            lastOperation: existed ? 'write' : 'create',
            diff: { hunks: computeLineDiff(beforeContent, fileContent) },
          })
        }
        sendActivity({ state: 'tool', label: `Wrote ${requestedPath}`, toolName: 'write_project_file' })
        return { success: true, result: `Successfully wrote ${fileContent.length} characters to ${requestedPath}` }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to write file' }
      }
    })

    if (fileEditAllowed && !planMode) fileInlineHandlers.set('copy_path_to_artifact', async (args) => {
      const requestedPath = typeof args.path === 'string' ? args.path : String(args.path ?? '')
      const resolvedPath = resolveWithinRoots(capturedRoots, requestedPath)
      if (!resolvedPath) return { success: false, error: 'Path is outside the project directory' }
      if (!existsSync(resolvedPath)) return { success: false, error: `Path not found: ${requestedPath}` }
      sendActivity({ state: 'approval', label: 'Waiting for artifact copy approval', toolName: 'copy_path_to_artifact' })
      const approved = await requestApproval(
        capturedWebContentsForFiles,
        'copy_path_to_artifact',
        { path: requestedPath, title: args.title, kind: args.kind },
        `Copy to Nexy artifact: ${requestedPath}`,
        { noRemember: true, conversationId, autoApprove: capturedFullAutoApprove || capturedAgenticMode || isPreApproved('copy_path_to_artifact') },
      )
      if (!approved) return { success: false, error: 'User declined artifact copy' }
      try {
        const validKinds = new Set(['document', 'code', 'ui', 'data', 'prompt', 'agent-config', 'plan', 'bundle', 'other'])
        const kind = typeof args.kind === 'string' && validKinds.has(args.kind)
          ? args.kind as ArtifactKind
          : undefined
        const artifact = createArtifactFromPath({
          sourcePath: resolvedPath,
          title: typeof args.title === 'string' ? args.title : undefined,
          kind,
          projectId: wikiProjectId,
          conversationId,
        })
        sendActivity({ state: 'tool', label: `Created artifact: ${artifact.title}`, toolName: 'copy_path_to_artifact' })
        return {
          success: true,
          result: `Created Nexy artifact "${artifact.title}" (artifactId: ${artifact.artifactId}, versionId: ${artifact.versionId}).`,
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to create artifact' }
      }
    })

    // ── Terminal tool (cwd scoped to the project root unless sandbox bypass is on) ──
    const terminalCfg = (effectiveAgentId ? getAgentConfig(effectiveAgentId) : null)?.tools as {
      terminal?: { enabled?: boolean; approval?: 'auto' | 'always-ask' | 'disabled' }
    } | null
    if (!planMode && terminalAllowed && terminalCfg?.terminal?.enabled && terminalCfg.terminal.approval !== 'disabled') {
      const capturedTerminalApprovalAuto = terminalCfg.terminal.approval === 'auto'
      const capturedTerminalSandboxBypass = terminalSandboxBypass === true

      fileToolDefs.push({
        type: 'function' as const,
        function: {
          name: 'run_terminal_command',
          description:
            'Run a shell command. By default the working directory is confined to the project root directory (or a subdirectory of it); commands targeting a directory outside the project root are rejected unless sandbox bypass has been enabled for this chat/project. Always requires explicit user approval before running, unless the tool is configured for auto-approval.',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'The shell command to execute' },
              cwd: {
                type: 'string',
                description: 'Working directory for the command, relative to the project root (defaults to the project root)',
              },
            },
            required: ['command'],
          },
        },
      })

      fileInlineHandlers.set('run_terminal_command', async (args) => {
        const command = typeof args.command === 'string' ? args.command : String(args.command ?? '')
        if (!command.trim()) return { success: false, error: 'No command provided' }
        const requestedCwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd : '.'

        const withinRoot = resolveWithinRoots(capturedRoots, requestedCwd)
        let resolvedCwd: string
        if (withinRoot) {
          resolvedCwd = withinRoot
        } else if (capturedTerminalSandboxBypass) {
          resolvedCwd = isAbsolute(requestedCwd) ? resolve(requestedCwd) : resolve(capturedRoots[0], requestedCwd)
        } else {
          return {
            success: false,
            error: `Working directory "${requestedCwd}" is outside the project root. Sandbox bypass is not enabled for this chat/project.`,
          }
        }
        if (!existsSync(resolvedCwd) || !statSync(resolvedCwd).isDirectory()) {
          return { success: false, error: `Working directory not found: ${requestedCwd}` }
        }

        sendActivity({ state: 'approval', label: 'Waiting for terminal command approval', toolName: 'run_terminal_command' })
        const approved = await requestApproval(
          capturedWebContentsForFiles,
          'run_terminal_command',
          { command, cwd: resolvedCwd },
          `Run command: ${command}`,
          { noRemember: true, autoApprove: capturedFullAutoApprove || capturedAgenticMode || capturedTerminalApprovalAuto || isPreApproved('run_terminal_command') },
        )
        if (!approved) return { success: false, error: 'User declined command execution' }
        sendActivity({ state: 'tool', label: `Running: ${command}`, toolName: 'run_terminal_command' })

        const MAX_OUTPUT_CHARS = 100_000
        const TIMEOUT_MS = 120_000
        return await new Promise<{ success: boolean; result?: string; error?: string }>((resolvePromise) => {
          let output = ''
          let truncated = false
          let settled = false
          const proc = spawn(command, { shell: true, cwd: resolvedCwd, windowsHide: true })
          const timer = setTimeout(() => {
            if (settled) return
            settled = true
            proc.kill()
            resolvePromise({
              success: false,
              error: `Command timed out after ${TIMEOUT_MS / 1000}s and was killed.\n\nOutput so far:\n${output}`,
            })
          }, TIMEOUT_MS)
          const appendOutput = (chunk: Buffer) => {
            if (truncated) return
            output += chunk.toString('utf-8')
            if (output.length > MAX_OUTPUT_CHARS) {
              output = output.slice(0, MAX_OUTPUT_CHARS) + '\n\n... (output truncated)'
              truncated = true
            }
          }
          proc.stdout?.on('data', appendOutput)
          proc.stderr?.on('data', appendOutput)
          proc.on('error', (err) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolvePromise({ success: false, error: err.message })
          })
          proc.on('close', (code) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolvePromise({ success: code === 0, result: `Exit code: ${code}\n\n${output || '(no output)'}` })
          })
        })
      })
    }
  }

  // ── Skill tools ────────────────────────────────────────────────────────────
  // Agent-backed chats get the complete skill activation/resource surface. A normal chat gets
  // only save_skill when the current request clearly asks to create/import and retain a skill.
  // Writing to the global library always requires explicit user approval, and captured skills are
  // tagged with their provenance so the library never silently fills with model-authored entries.
  const skillToolDefs: ToolDefinition[] = []
  const skillInlineHandlers = new Map<string, InlineHandler>()

  if (effectiveAgentId) {
    skillToolDefs.push({
      type: 'function' as const,
      function: {
        name: 'activate_skill',
        description: 'Load the complete SKILL.md for one available skill when its description clearly matches the current task.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string', description: 'The exact lowercase skill name from the available-skills catalog' } },
          required: ['name'],
        },
      },
    })

    skillToolDefs.push({
      type: 'function' as const,
      function: {
        name: 'read_skill_resource',
        description: 'Read a text reference or script from an already activated skill package. Paths are relative to that package.',
        parameters: {
          type: 'object',
          properties: {
            skill: { type: 'string', description: 'Activated skill name' },
            path: { type: 'string', description: 'Relative package path such as references/policy.md' },
          },
          required: ['skill', 'path'],
        },
      },
    })

    skillInlineHandlers.set('activate_skill', async (args) => {
      const name = typeof args.name === 'string' ? args.name : ''
      const skill = findAvailableSkill(name)
      if (!skill) return { success: false, error: `Skill "${name}" is not available to this agent` }
      if (skill.validationStatus === 'invalid') return { success: false, error: `Skill "${name}" has an invalid package` }
      recordSkillActivation(skill, 'implicit')
      return { success: true, result: skillEntryMarkdown(skill) }
    })

    skillInlineHandlers.set('read_skill_resource', async (args) => {
      const name = typeof args.skill === 'string' ? args.skill : ''
      const path = typeof args.path === 'string' ? args.path : ''
      const skill = findAvailableSkill(name)
      if (!skill || !activatedSkillIds.has(skill.id)) {
        return { success: false, error: 'Activate the skill before reading its resources' }
      }
      if (!skill.packagePath) return { success: false, error: 'This legacy skill has no package resources' }
      try {
        return { success: true, result: readSkillResource(skill.packagePath, path) }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    })

  }

  if (effectiveAgentId || requestsSkillCapture(content)) {
    const capturedWebContentsForSkill = webContents

    skillToolDefs.push({
      type: 'function' as const,
      function: {
        name: 'save_skill',
        description:
          "Save a reusable skill to the user's Nexy skill library so it can be attached to agents later. " +
          'Use this when you have authored a skill, or read a skill from an external SKILL.md file, that the user asked to keep. ' +
          'Provide EITHER a complete `markdown` SKILL.md document, OR the structured fields (`name` is required). ' +
          'Always requires explicit user approval before saving. Re-saving a skill with the same name updates it.',
        parameters: {
          type: 'object',
          properties: {
            markdown: {
              type: 'string',
              description:
                'A complete SKILL.md document (YAML frontmatter with name/description/allowed-tools + Markdown body). Use this when importing an external skill file. Takes precedence over the structured fields below.',
            },
            name: { type: 'string', description: 'Skill name (required unless provided via markdown)' },
            description: { type: 'string', description: 'Short one-line summary of what the skill does' },
            instructions: { type: 'string', description: 'The reusable behaviour guidance / body of the skill' },
            icon: { type: 'string', description: 'Optional emoji icon for the skill' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags to categorise the skill' },
          },
        },
      },
    })

    skillInlineHandlers.set('save_skill', async (args) => {
      // Parse and validate either the markdown document or the structured fields before asking.
      const prepared = prepareSkillCapture(args)
      if ('error' in prepared) return { success: false, error: prepared.error }
      const { name } = prepared

      sendActivity({ state: 'approval', label: `Waiting for approval to save skill: ${name}`, toolName: 'save_skill' })
      const approved = await requestApproval(
        capturedWebContentsForSkill,
        'save_skill',
        { name },
        `Save skill to library: ${name}`,
        { noRemember: true, conversationId, ...scheduledAutoApprove('save_skill') },
      )
      if (!approved) return { success: false, error: 'User declined saving the skill' }

      try {
        const { skill, created } = persistSkillCapture(prepared)

        if (capturedWebContentsForSkill && !capturedWebContentsForSkill.isDestroyed()) {
          capturedWebContentsForSkill.send('skill:library-updated')
        }
        broadcastToMobile({
          event: created ? 'skill:created' : 'skill:updated',
          data: { skill },
        })
        sendActivity({ state: 'tool', label: `Saved skill: ${name}`, toolName: 'save_skill' })
        return {
          success: true,
          result: `${created ? 'Created' : 'Updated'} skill "${name}" (id: ${skill.id}) in the Nexy skill library.`,
        }
      } catch (error) {
        return { success: false, error: `Could not save skill "${name}": ${error instanceof Error ? error.message : String(error)}` }
      }
    })
  }

  // ── Plan mode: exit_plan_mode tool ─────────────────────────────────────────
  // When the chat is in plan mode the model works read-only and, once it has a finalized plan,
  // calls exit_plan_mode to present it. The user approves before the chat leaves plan mode — this
  // is the "model decides when the plan is complete, user decides whether to proceed" handoff that
  // Claude Code's plan mode and Codex's Plan collaboration mode already have natively.
  const planToolDefs: ToolDefinition[] = []
  const planInlineHandlers = new Map<string, InlineHandler>()

  if (planMode) {
    const capturedWebContentsForPlan = webContents
    const capturedDbForPlan = db
    const capturedConversationId = conversationId

    planToolDefs.push({
      type: 'function' as const,
      function: {
        name: 'exit_plan_mode',
        description:
          'Call this ONLY when you have finished researching and have a complete, concrete implementation plan to present to the user. ' +
          'This chat is in plan mode (read-only): you cannot edit files or run commands until the user approves your plan. ' +
          'Pass the full plan as markdown. If the user approves, plan mode is turned off and you may implement it; if they decline, keep refining the plan.',
        parameters: {
          type: 'object',
          properties: {
            plan: { type: 'string', description: 'The finalized implementation plan, as markdown, for the user to review' },
          },
          required: ['plan'],
        },
      },
    })

    planInlineHandlers.set('exit_plan_mode', async (args) => {
      const plan = typeof args.plan === 'string' ? args.plan.trim() : ''
      if (!plan) return { success: false, error: 'Provide the finalized plan as the `plan` argument.' }

      onPlanFinalized?.(plan)
      sendActivity({ state: 'approval', label: 'Waiting for plan approval', toolName: 'exit_plan_mode' })
      const approved = await requestApproval(
        capturedWebContentsForPlan,
        'exit_plan_mode',
        { plan },
        'Approve this plan and start implementing?',
        { noRemember: true, conversationId, ...scheduledAutoApprove('exit_plan_mode') },
      )
      if (!approved) {
        return {
          success: true,
          result: 'The user did not approve the plan. Stay in plan mode: revise the plan based on their feedback and call exit_plan_mode again when ready. Do not attempt to edit files or run commands.',
        }
      }

      // Leave plan mode so the next turns can use the mutating tools.
      capturedDbForPlan.prepare('UPDATE conversations SET cli_mode_override = NULL, updated_at = ? WHERE id = ?')
        .run(Date.now(), capturedConversationId)
      broadcastConversationMode(capturedDbForPlan, capturedConversationId)
      sendActivity({ state: 'tool', label: 'Plan approved — leaving plan mode', toolName: 'exit_plan_mode' })
      return {
        success: true,
        result: 'The user approved the plan and plan mode is now off. You may proceed to implement the plan (file edits and commands are available from your next turn).',
      }
    })
  }

  return {
    augmentedContent,
    attachedImages,
    injectedRootDirectory,
    projectDirectories,
    wikiProjectId,
    wikiToolDefs,
    wikiInlineHandlers,
    fileToolDefs,
    fileInlineHandlers,
    skillToolDefs,
    skillInlineHandlers,
    planToolDefs,
    planInlineHandlers,
  }
}

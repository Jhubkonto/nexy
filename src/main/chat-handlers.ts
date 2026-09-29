import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { homedir } from 'os'
import { getDatabase } from './database'
import {
  DEFAULT_PROVIDER_MODEL,
  NO_PROVIDER_CONFIGURED_MESSAGE,
  getProviderForAgent,
  getProviderCredential,
  abortActiveStream,
  getOpenRouterModels,
  type MessageContentPart,
  type ProviderMessage,
} from './providers'
import { activeCliAbortControllers } from './provider-stream-state'
import { safeHandle } from './safe-handle'
import { runOrchestration, type OrchestratorAgent } from './orchestrator'
import { ensureMcpServersReady, getAvailableMcpTools, getMcpServerConfigsForCli, servers as mcpServers } from './mcp'
import { getConversationMcpServerIds, getEffectiveCapabilityProfile, isBuiltInToolAllowed } from './capability-service'
import { requestApproval, denyPendingApprovalsForConversation } from './tools'
import { cancelPendingUserInputsForConversation, requestUserInput, userInputQuestionsFromArgs } from './user-input'
import { getAdapter } from './cli-adapters/registry'
import { clarifyCliAuthError } from './cli-adapters/utils'
import { getSkillConfig, getSkillConfigsForAgent } from './skills'
import { bridgeSkillsForCliRun, releaseBridgedSkills, type BridgedSkill } from './cli-skill-bridge'
import { requestsSkillCapture } from './skill-service'
import { startSkillSaveMcpBridge, type SkillSaveMcpBridge } from './skill-save-mcp-bridge'
import { broadcastToMobile, isMobileInForeground } from './ws-server'
import { sendChatCompleteNotification } from './fcm-sender'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { HermesAdapter } from './cli-adapters/hermes'
import { getCachedHermesAcpReadiness, getCliModels, isHermesAcpReady } from './cli-detection'
import { isClaudeCliModelOrCandidate } from './cli-adapters/claude-model-probe'
import { retrieveAuthMode } from './auth'
import { resolveEffectiveBackend } from './backend-routing'
import { applyRollingContextCompression } from './context-compression'
import { getAgentConfig } from './agents'
import { isFullAutoApprove } from './agentic-policy'
import { buildChatContext, buildStoredAttachments } from './chat-context-builder'
import { parseProjectConfig } from './project-handlers'
import { getWorkingDirectory } from './file-handlers'
import { inferProjectAuditTarget, recordProjectAuditChange } from './project-audit'
import { computeLineDiff } from './diff-utils'
import { dispatchToProvider } from './chat-provider-dispatch'
import type { MobileChatActivity } from './chat-context-builder'
import { debugLog } from './debug-mode'
import { ChatTurnEmitter } from './chat-turn-emitter'
import type { ResolvedUserInput } from '../shared/chat-turn-types'
import type { SkillConfig } from '../shared/types'
import { endActivity } from './activity-tracker'
import { clearActiveChatTurn } from './active-chat-turns'
import { assertConversationStartsAllowed } from './emergency-stop'
import { formatWikiSection, getRelevantWikiEntries } from './wiki-context'
import { estimateInputTokens, formatEstimatedTokens } from '../shared/token-estimate'
import { saveFinalizedPlanArtifact } from './artifacts'
import { isLegacyPortableOperationalSummary } from '../shared/conversation-portability'
import type { Citation } from '../shared/citations'
import { mergeCitations } from '../shared/citations'
import { TurnUsageAccumulator, type TokenCount } from '../shared/token-usage'

export { clearDirListingCache } from './chat-context-builder'

type ThinkingBlockEntry = { blockId: string; content: string; done: boolean; firstSeenAt: number }

/**
 * Merges fields into a just-saved user message's context_snapshot — the client-side snapshot
 * only records what it *intended* to send, before compression, model routing, or the provider's
 * own tokenizer could tell us what actually happened.
 */
function patchContextSnapshot(
  db: ReturnType<typeof getDatabase>,
  messageId: string | null,
  patch: Record<string, unknown>,
): void {
  if (!messageId) return
  const row = db.prepare('SELECT context_snapshot FROM messages WHERE id = ?').get(messageId) as
    | { context_snapshot: string | null }
    | undefined
  if (!row?.context_snapshot) return
  let snapshot: Record<string, unknown>
  try {
    snapshot = JSON.parse(row.context_snapshot)
  } catch {
    return
  }
  Object.assign(snapshot, patch)
  db.prepare('UPDATE messages SET context_snapshot = ? WHERE id = ?').run(JSON.stringify(snapshot), messageId)
}

function recordServerContextFacts(
  db: ReturnType<typeof getDatabase>,
  messageId: string | null,
  model: string | null,
  compression: { compressedMessageCount: number; retainedMessageCount: number } | null,
): void {
  patchContextSnapshot(db, messageId, { serverModel: model, serverCompression: compression })
}

/** Real, provider-reported token usage for the request this user message triggered. */
function recordServerUsage(
  db: ReturnType<typeof getDatabase>,
  messageId: string | null,
  usage: ReturnType<TurnUsageAccumulator['snapshot']>,
): void {
  if (usage.inputTokens <= 0 && usage.outputTokens <= 0) return
  patchContextSnapshot(db, messageId, {
    serverInputTokens: usage.inputTokens,
    serverOutputTokens: usage.outputTokens,
    turnTotal: usage,
  })
}

function persistAssistantMessage(
  db: ReturnType<typeof getDatabase>,
  conversationId: string,
  content: string,
  model: string | null,
  thinkingBlocks?: Map<string, ThinkingBlockEntry>,
  textSegments?: Map<string, ThinkingBlockEntry>,
  timestamp: number = Date.now(),
  userInputs?: ResolvedUserInput[],
  citations?: Citation[],
): string {
  const msgId = randomUUID()
  const thinkingJson = thinkingBlocks && thinkingBlocks.size > 0
    ? JSON.stringify(Array.from(thinkingBlocks.values()))
    : null
  // Normally a single segment needs no separate storage because `content` already contains the
  // full response. Keep it when it was interrupted by a tool or reasoning block. Without this,
  // narration such as "I’m about to edit the file" disappears into the final assistant bubble
  // after reload even though it happened before the tool call.
  const hasInterruptedTextSegment = textSegments
    ? Array.from(textSegments.values()).some((segment) => segment.done)
    : false
  const textSegmentsJson = textSegments && textSegments.size > 0 && (textSegments.size > 1 || hasInterruptedTextSegment)
    ? JSON.stringify(Array.from(textSegments.values()))
    : null
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model, thinking_blocks, text_segments, user_inputs, citations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(msgId, conversationId, 'assistant', content, null, timestamp, model, thinkingJson, textSegmentsJson, userInputs?.length ? JSON.stringify(userInputs) : null, citations?.length ? JSON.stringify(citations) : null)
  return msgId
}

/**
 * Builds a compact, bounded digest of the tool calls already executed earlier in this conversation
 * (persisted as role='tool-call' rows) so a subsequent turn — e.g. "Continue from where you left
 * off" — knows what has already been done instead of re-investigating from scratch. Returns '' when
 * there are no tool-call rows. Capped to the most recent MAX_TOOL_DIGEST_ENTRIES actions.
 */
const MAX_TOOL_DIGEST_ENTRIES = 40
function buildToolHistoryDigest(historyMessages: { role: string; content: string }[]): string {
  const lines: string[] = []
  for (const m of historyMessages) {
    if (m.role !== 'tool-call') continue
    try {
      const parsed = JSON.parse(m.content) as {
        toolName?: string
        toolArgs?: Record<string, unknown>
        toolSuccess?: boolean
      }
      const name = parsed.toolName ?? 'tool'
      let argsPreview = ''
      if (parsed.toolArgs && Object.keys(parsed.toolArgs).length > 0) {
        argsPreview = JSON.stringify(parsed.toolArgs)
        if (argsPreview.length > 120) argsPreview = argsPreview.slice(0, 120) + '…'
      }
      lines.push(`- ${name}(${argsPreview}) → ${parsed.toolSuccess === false ? 'error' : 'ok'}`)
    } catch { /* skip malformed row */ }
  }
  if (lines.length === 0) return ''
  const shown = lines.slice(-MAX_TOOL_DIGEST_ENTRIES)
  const omitted = lines.length - shown.length
  const header = omitted > 0
    ? `\n\nTools already executed earlier in this conversation (most recent ${shown.length} of ${lines.length}):`
    : '\n\nTools already executed earlier in this conversation:'
  return `${header}\n${shown.join('\n')}\n(Do not redo completed work; continue from this state.)`
}

/** Notifies both Android (full message list, its existing sync shape) and any desktop window
 *  that has this conversation open (a lightweight "refetch if you care" ping — reloadMessages in
 *  useChat.ts already knows how to re-fetch from the DB, no need to duplicate that payload shape
 *  here) that this conversation's messages changed from outside whatever renderer/device
 *  originated the change. Exported for callers outside normal chat dispatch — e.g. a
 *  code-change plan landing while the investigation ran in the background — that also insert
 *  messages directly into the DB and need the same live-refresh. */
export function broadcastConversationMessages(conversationId: string): void {
  const db = getDatabase()
  const rows = (db.prepare(
    `SELECT id, role, content, model, attachments, timestamp, timeline_order, thinking_blocks, text_segments, user_inputs, citations FROM messages
       WHERE conversation_id = ? ORDER BY timeline_order DESC, timestamp DESC, id DESC LIMIT 20`,
  ).all(conversationId) as unknown[]).reverse()
  broadcastToMobile({
    event: 'conversation:messages',
    data: { conversationId, messages: rows, paged: true, hasMore: rows.length === 20 },
  })
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('chat:messages-updated', { conversationId })
  }
}

type ChatSendOptions = {
  attachments?: { id: string; name: string; path: string; size: number }[]
  images?: { id: string; name: string; dataUrl: string }[]
  regenerate?: boolean
  agentId?: string
  model?: string
  cliBackend?: 'claude-cli' | 'codex-cli' | 'hermes-cli'
  hermesProfile?: string | null
  messageId?: string
  projectId?: string
  contextSnapshot?: string
  displayContent?: string
  toolPolicy?: { preApproved: string[]; alwaysAsk: string[]; neverAllow: string[] }
  thinkingEffortOverride?: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null
  fullAutoApproveOverride?: boolean | null
  agenticModeOverride?: boolean | null
  terminalSandboxOverride?: boolean | null
  cliModeOverride?: string | null
  codexExecutionModeOverride?: 'plan' | null
}

type AgentToolPolicy = { enabled?: boolean; approval?: string }
type BuiltInToolKey = 'fileEdit' | 'terminal' | 'webFetch'

const CLAUDE_CLI_BUILT_IN_TOOLS: Array<{
  key: BuiltInToolKey
  label: string
  approvalTool: string
  claudeTools: string[]
  description: string
}> = [
  {
    key: 'fileEdit',
    label: 'File Edit',
    approvalTool: 'claude-cli:fileEdit',
    claudeTools: ['Read', 'Write', 'Edit', 'MultiEdit'],
    description: 'Allow Claude CLI to read and edit files for this message?',
  },
  {
    key: 'terminal',
    label: 'Terminal',
    approvalTool: 'claude-cli:terminal',
    // Claude Code reports its Windows-native shell as PowerShell in current releases;
    // older releases and non-Windows hosts use Bash. Both names must share one policy.
    claudeTools: ['Bash', 'PowerShell'],
    description: 'Allow Claude CLI to run terminal commands for this message?',
  },
  {
    key: 'webFetch',
    label: 'Web Fetch',
    approvalTool: 'claude-cli:webFetch',
    claudeTools: ['WebFetch', 'WebSearch'],
    description: 'Allow Claude CLI to fetch or search web content for this message?',
  },
]

// ---------------------------------------------------------------------------
// Project Audit for CLI-driven file edits (E4.x follow-up)
//
// Claude CLI / Codex CLI edit files directly inside their own subprocess — Nexy never sees the
// write, only the tool_start/tool_end events the adapter surfaces. Unlike BYOK chat's
// write_project_file (chat-context-builder.ts), which records recordProjectAuditChange itself
// at the point of writing, CLI-driven edits used to have no equivalent at all: they rendered as
// a plain ToolCallBlock with no diff or undo,
// fragmenting the audit trail depending on which backend a given chat happened to use.
// ---------------------------------------------------------------------------

// Mirrors CLAUDE_CLI_BUILT_IN_TOOLS's own 'fileEdit' entry (Read is excluded — it's not a
// mutation) rather than duplicating the literal list.
const CLAUDE_FILE_EDIT_TOOL_NAMES = new Set(
  CLAUDE_CLI_BUILT_IN_TOOLS.find((t) => t.key === 'fileEdit')!.claudeTools.filter((name) => name !== 'Read'),
)
// Codex's file-editing item types (file_change/patch_apply) reach chat-handlers.ts as this
// human-friendly label — see ITEM_TYPE_LABELS in cli-adapters/codex.ts; extractToolEvent there
// only falls back to it when the raw item has no explicit name/tool_name/tool field, which is
// the normal case for these built-in item types.
const CODEX_FILE_EDIT_TOOL_NAMES = new Set(['Edit File'])

function isFileEditToolCall(backend: 'claude-cli' | 'codex-cli' | 'hermes-cli', toolName: string): boolean {
  if (backend === 'claude-cli') return CLAUDE_FILE_EDIT_TOOL_NAMES.has(toolName)
  if (backend === 'codex-cli') return CODEX_FILE_EDIT_TOOL_NAMES.has(toolName)
  return false
}

function resolveMaybeRelativePath(cwd: string, candidate: string): string {
  return path.isAbsolute(candidate) ? candidate : path.join(cwd, candidate)
}

// Best-effort: a CLI tool call's input shape isn't a contract Nexy controls. Claude Code's
// Write/Edit/MultiEdit consistently use `file_path`; Codex's file-editing item fields aren't
// pinned down to one exact schema here, so this also checks common alternate field names and
// array-of-edits shapes rather than assuming a single fixed key. Never throws — returns [] when
// nothing recognizable is found, so an unrecognized shape just means that edit silently isn't
// audited (the same as before this existed), not a broken chat turn.
function extractCliEditedPaths(input: Record<string, unknown>, cwd: string): string[] {
  const paths = new Set<string>()
  const addCandidate = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) paths.add(resolveMaybeRelativePath(cwd, value.trim()))
  }
  addCandidate(input.file_path)
  addCandidate(input.path)
  addCandidate(input.filePath)
  for (const key of ['changes', 'edits', 'files']) {
    const entries = input[key]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      addCandidate(record.path)
      addCandidate(record.file_path)
      addCandidate(record.filePath)
    }
  }
  return [...paths]
}

function getClaudeCliToolDefinition(toolName: string): (typeof CLAUDE_CLI_BUILT_IN_TOOLS)[number] | null {
  const normalized = toolName.trim().toLowerCase()
  return CLAUDE_CLI_BUILT_IN_TOOLS.find((tool) =>
    tool.claudeTools.some((candidate) => candidate.toLowerCase() === normalized)
  ) ?? null
}

function getClaudeCliToolPolicies(
  agentConfig: Record<string, unknown> | null,
): Partial<Record<BuiltInToolKey, AgentToolPolicy>> {
  return (agentConfig?.tools && typeof agentConfig.tools === 'object'
    ? agentConfig.tools
    : {}) as Partial<Record<BuiltInToolKey, AgentToolPolicy>>
}

function getClaudeCliGlobalToolPreference(approvalTool: string): string | null {
  const row = getDatabase()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(`tool_pref:${approvalTool}`) as { value: string } | undefined
  return row?.value ?? null
}

function rememberClaudeCliAgentTool(agentId: string, key: BuiltInToolKey): void {
  const current = getAgentConfig(agentId)
  if (!current) return
  const currentTools = (current.tools && typeof current.tools === 'object'
    ? current.tools
    : {}) as Record<string, unknown>
  const updatedConfig = {
    ...current,
    tools: {
      ...currentTools,
      [key]: { ...(currentTools[key] as object ?? {}), enabled: true, approval: 'auto' },
    },
  }
  getDatabase()
    .prepare('UPDATE agents SET config_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(updatedConfig), Date.now(), agentId)
}

function getClaudeCliAllowedBuiltInTools(
  agentConfig: Record<string, unknown> | null,
  agentId: string | null,
  autoApprove = false,
  capabilityProfile?: import('../shared/types').ConversationCapabilityProfile,
): string[] {
  const tools = getClaudeCliToolPolicies(agentConfig)
  const allowedTools: string[] = []

  for (const tool of CLAUDE_CLI_BUILT_IN_TOOLS) {
    if (capabilityProfile && !isBuiltInToolAllowed(capabilityProfile, tool.key)) continue
    const policy = tools[tool.key]
    if (policy?.enabled === false) continue
    if (autoApprove || (policy?.enabled === true && policy.approval === 'auto')) {
      allowedTools.push(...tool.claudeTools)
      continue
    }
    // A remembered choice on an unconfigured/default chat is the equivalent of an
    // agent's approval=auto policy. Otherwise omit the tool from --allowedTools so the
    // CLI's PermissionRequest hook can ask at the exact moment it is attempted.
    if (!agentId && getClaudeCliGlobalToolPreference(tool.approvalTool) === 'always_allow') {
      allowedTools.push(...tool.claudeTools)
    }
  }

  return allowedTools
}

type ClaudeCliProjectTeam = {
  agents: Record<string, { description: string; prompt: string }>
  directive: string
}

/**
 * Materialise Nexy's current project roster as Claude CLI custom subagents. This is deliberately
 * rebuilt for every turn: project membership is mutable and a conversation must not retain the
 * roster that happened to exist when it was created.
 */
function buildClaudeCliProjectTeam(
  db: ReturnType<typeof getDatabase>,
  projectId: string,
  speakingAgentId: string | null,
): ClaudeCliProjectTeam | null {
  const project = db.prepare('SELECT name, config_json FROM projects WHERE id = ?').get(projectId) as
    | { name: string; config_json: string | null }
    | undefined
  if (!project) return null

  let config: Record<string, unknown> = {}
  try {
    config = project.config_json ? JSON.parse(project.config_json) as Record<string, unknown> : {}
  } catch { /* an invalid project config cannot safely enable orchestration */ }
  const workflowMode = config.workflowMode ?? (config.orchestrationEnabled === true ? 'orchestrated' : 'single-agent')
  if (workflowMode !== 'orchestrated') return null

  const rows = db.prepare(
    'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC',
  ).all(projectId) as Array<{ agent_id: string; is_primary: number; sort_order: number; config_json: string }>
  if (rows.length < 2) return null

  const primaryId = rows.find((row) => row.is_primary === 1)?.agent_id ?? null
  const leaderId = speakingAgentId ?? primaryId
  const agents: ClaudeCliProjectTeam['agents'] = {}
  const manifest: string[] = []

  for (const [index, row] of rows.entries()) {
    if (row.agent_id === leaderId) continue
    let agentConfig: Record<string, unknown> = {}
    try {
      agentConfig = JSON.parse(row.config_json) as Record<string, unknown>
    } catch { /* retain safe defaults below */ }
    const name = typeof agentConfig.name === 'string' && agentConfig.name.trim()
      ? agentConfig.name.trim()
      : 'Project Agent'
    const icon = typeof agentConfig.icon === 'string' ? agentConfig.icon : '🤖'
    const prompt = typeof agentConfig.systemPrompt === 'string' && agentConfig.systemPrompt.trim()
      ? agentConfig.systemPrompt.trim()
      : `You are ${name}, a specialist on the project team.`
    const baseKey = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'
    let key = baseKey
    if (agents[key]) key = `${baseKey}-${index + 1}`
    agents[key] = {
      description: prompt.split('\n')[0].slice(0, 200),
      prompt,
    }
    manifest.push(`- ${icon} ${name}: subagent_type "${key}"`)
  }
  if (manifest.length === 0) return null

  return {
    agents,
    directive:
      `[Live Nexy Project Team — ${project.name}]\n` +
      `This is the authoritative current roster for this turn; it replaces any older roster in the conversation history.\n` +
      manifest.join('\n') +
      `\nWhen the user asks for a team member's opinion or expertise, invoke the Agent tool with that member's exact subagent_type. ` +
      `Do not use SendMessage (that addresses Claude-native persistent teammates, not Nexy project agents), and do not claim a listed member is unavailable.\n` +
      `[/Live Nexy Project Team]`,
  }
}

async function requestClaudeCliToolPermission(
  window: BrowserWindow | undefined,
  agentConfig: Record<string, unknown> | null,
  agentId: string | null,
  sendActivity: (activity: MobileChatActivity) => void,
  autoApprove: boolean,
  permissionMode: string | undefined,
  toolName: string,
  input: Record<string, unknown>,
  conversationId: string,
  onPlanApproval?: (plan: string) => Promise<boolean>,
): Promise<boolean> {
  // The process-level flag is fixed at launch, but Nexy's HTTP permission hook remains live.
  // Re-read this conversation's mode so escalating a running turn to Bypass affects subsequent
  // tool calls instead of continuing with the mode captured when Claude started.
  const liveModeRow = getDatabase()
    .prepare('SELECT cli_mode_override FROM conversations WHERE id = ?')
    .get(conversationId) as { cli_mode_override: string | null } | undefined
  const livePermissionMode = liveModeRow
    ? liveModeRow.cli_mode_override ?? undefined
    : permissionMode
  if (livePermissionMode === 'bypassPermissions') return true

  // An explicit Claude Code Mode override (Plan / Accept edits / Bypass) governs this turn's
  // permission behavior. Auto-approve is a separate, coarser toggle meant for when no mode is
  // selected — letting it short-circuit here would silently defeat Plan's read-only guarantee
  // and Accept edits' scoping, so it only applies when the user hasn't picked an explicit mode.
  const autoApproveActive = autoApprove && !livePermissionMode

  // Claude Code owns the native ExitPlanMode tool, but Nexy owns the persisted
  // per-conversation mode override. Approving the native tool must clear that override or
  // the next turn would start Claude in Plan mode again.
  if (toolName.toLowerCase() === 'exitplanmode') {
    const plan = typeof input.plan === 'string' ? input.plan.trim() : ''
    // Newer interactive Claude CLIs can expose this native tool. Route it through the
    // same application-owned handoff as the --print MCP bridge, including the follow-up turn.
    if (plan && onPlanApproval) return onPlanApproval(plan)
    sendActivity({ state: 'approval', label: 'Waiting for plan approval', toolName: 'exit_plan_mode' })
    const approved = await requestApproval(
      window?.webContents,
      'exit_plan_mode',
      input,
      'Approve this plan and start implementing?',
      { noRemember: true, conversationId },
    )
    if (approved) {
      clearPersistedPlanMode(conversationId, 'claude')
      sendActivity({ state: 'tool', label: 'Plan approved — leaving plan mode', toolName: 'exit_plan_mode' })
    }
    return approved
  }

  const tool = getClaudeCliToolDefinition(toolName)
  if (!tool) {
    sendActivity({ state: 'approval', label: `Waiting for ${toolName} approval`, toolName })
    return requestApproval(
      window?.webContents,
      `claude-cli:${toolName}`,
      input,
      `Allow Claude CLI to use ${toolName}?`,
      { conversationId },
    )
  }

  const policy = getClaudeCliToolPolicies(agentConfig)[tool.key]
  if (policy?.enabled === false || policy?.approval === 'disabled') return false
  if (autoApproveActive || (policy?.enabled === true && policy.approval === 'auto')) return true
  if (!agentId) {
    const preference = getClaudeCliGlobalToolPreference(tool.approvalTool)
    if (preference === 'always_allow') return true
    if (preference === 'always_deny') return false
  }

  sendActivity({ state: 'approval', label: `Waiting for ${tool.label} approval`, toolName: tool.label })
  return requestApproval(
    window?.webContents,
    tool.approvalTool,
    input,
    tool.description,
    {
      conversationId,
      ...(agentId
        ? {
            onRemember: (wasApproved: boolean) => {
              if (wasApproved) rememberClaudeCliAgentTool(agentId, tool.key)
            },
          }
        : undefined),
    },
  )
}

const CODEX_APPROVAL_LABELS: Record<string, string> = {
  commandExecution: 'Run Command',
  fileChange: 'Edit File',
}

// Mirrors requestClaudeCliToolPermission's role for the Codex app-server Plan mode path:
// item/commandExecution/requestApproval and item/fileChange/requestApproval (codex.ts) block
// the turn until this resolves, so the user gets a live prompt instead of Codex silently
// auto-accepting/declining based on skipPermissions.
async function requestCodexToolPermission(
  window: BrowserWindow | undefined,
  sendActivity: (activity: MobileChatActivity) => void,
  autoApprove: boolean,
  toolName: string,
  input: Record<string, unknown>,
  conversationId: string,
): Promise<boolean> {
  if (autoApprove) return true
  const label = CODEX_APPROVAL_LABELS[toolName] ?? toolName
  sendActivity({ state: 'approval', label: `Waiting for ${label} approval`, toolName: label })
  return requestApproval(
    window?.webContents,
    `codex-cli:${toolName}`,
    input,
    label === 'Run Command' ? 'Allow Codex to run this command?' : `Allow Codex to ${label.toLowerCase()}?`,
    { conversationId },
  )
}

async function requestHermesToolPermission(
  window: BrowserWindow | undefined,
  sendActivity: (activity: MobileChatActivity) => void,
  toolName: string,
  input: Record<string, unknown>,
  conversationId: string,
): Promise<boolean> {
  sendActivity({ state: 'approval', label: `Waiting for ${toolName} approval`, toolName })
  return requestApproval(
    window?.webContents,
    `hermes-acp:${toolName}`,
    input,
    `Allow Hermes to use ${toolName}?`,
    { conversationId, noRemember: true },
  )
}

function clearPersistedPlanMode(conversationId: string, backend: 'claude' | 'codex'): void {
  const db = getDatabase()
  const column = backend === 'codex' ? 'codex_execution_mode_override' : 'cli_mode_override'
  db.prepare(`UPDATE conversations SET ${column} = NULL, updated_at = ? WHERE id = ?`).run(Date.now(), conversationId)
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

export async function dispatchChatSend(
  window: BrowserWindow | undefined,
  conversationId: string,
  content: string,
  options?: ChatSendOptions,
): Promise<{ assistantMsgId: string } | null> {
  assertConversationStartsAllowed()
  const db = getDatabase()

  const turnEmitter = new ChatTurnEmitter(conversationId, {
    sendDesktop: window
      ? (channel, ...args) => {
          if (!window.webContents.isDestroyed()) window.webContents.send(channel, ...args)
        }
      : undefined,
    broadcastMobile: broadcastToMobile,
  })
  const turnUsage = new TurnUsageAccumulator()
  let activeUserMessageId: string | null = null
  turnEmitter.started()
  const resolvedUserInputs: ResolvedUserInput[] = []
  const collectResolvedUserInput = (request: ResolvedUserInput['request'], answers: ResolvedUserInput['answers']) => {
    resolvedUserInputs.push({ request, answers })
  }

  let latestContextEstimate: number | null = null
  let showContextEstimate = true
  const sendActivity = (activity: MobileChatActivity) => {
    if (activity.state === 'tool' || activity.state === 'approval') showContextEstimate = false
    const displayActivity =
      activity.state === 'thinking' &&
      showContextEstimate &&
      latestContextEstimate !== null &&
      !activity.label.includes('~')
        ? { ...activity, label: `${activity.label} · ${formatEstimatedTokens(latestContextEstimate)}` }
        : activity
    turnEmitter.activity(displayActivity)
  }
  const sendContextProgress = (estimatedInputTokens: number, label: string) => {
    latestContextEstimate = estimatedInputTokens
    sendActivity({
      state: 'thinking',
      label: `${label} · ${formatEstimatedTokens(estimatedInputTokens)}`,
    })
  }
  const sendChunk = (chunk: string, blockId?: string) => {
    showContextEstimate = false
    turnEmitter.assistantTextDelta(chunk, blockId)
  }
  const sendStreamEnd = (options?: { suppressNotification?: boolean }) => {
    const finalUsage = turnUsage.markComplete()
    if (finalUsage.inputTokens > 0 || finalUsage.outputTokens > 0) {
      turnEmitter.cost(finalUsage.inputTokens, finalUsage.outputTokens, finalUsage.totalCostUsd, finalUsage)
      recordServerUsage(getDatabase(), activeUserMessageId, finalUsage)
    }
    turnEmitter.streamEnd()
    clearActiveChatTurn(conversationId, turnEmitter.turnId)
    sendActivity({ state: 'complete', label: 'Complete' })
    const db = getDatabase()
    const convRow = db.prepare('SELECT title, project_id FROM conversations WHERE id = ?').get(conversationId) as { title: string; project_id: string | null } | undefined
    const convTitle = convRow?.title ?? 'Chat'
    if (!options?.suppressNotification && !isMobileInForeground()) {
      void sendChatCompleteNotification(db, { conversationId, title: convTitle })
    }
  }

  // Wraps the entire dispatch body as a last-resort safety net. Most branches below
  // already have their own try/catch around the specific provider/CLI/orchestration call
  // (recoverable, expected failures with tailored error messages) — but the setup code
  // between here and the first of those inner try blocks (DB writes, buildChatContext's
  // file/git/wiki I/O, agent/model resolution) runs completely unguarded. An unexpected
  // throw there used to propagate straight out of dispatchChatSend, skipping every
  // turnEmitter.closeStream()/sendStreamEnd() call — which leaves the chat's background
  // activity entry (registered by turnEmitter.started() above) stuck "active" forever,
  // since nothing else ever clears it. This outer catch guarantees cleanup regardless of
  // where in the function something goes wrong.
  //
  // The `finally` below is a second, independent guarantee on top of that: rather than
  // relying on every branch (CLI success, CLI error, BYOK success, BYOK error, orchestration
  // success, orchestration error, and this outer catch) to each remember to clear the
  // sidebar's "Assistant is responding…" entry via sendStreamEnd()/closeStream(), it
  // unconditionally clears it once this function actually settles — so a future branch that
  // forgets, or any path not yet covered, can't leave it stuck. endActivity() is a no-op if
  // the entry was already cleared by one of those branches, so this is safe to call twice.
  try {
  const attachments = options?.attachments
  const pastedImages = options?.images ?? []
  const regenerate = options?.regenerate === true
  const agentId = options?.agentId
  const modelOverride = options?.model
  const cliBackend = options?.cliBackend
  const requestedHermesProfile = options?.hermesProfile === undefined
    ? undefined
    : options.hermesProfile?.trim() || null
  const projectId = options?.projectId
  const contextSnapshot = options?.contextSnapshot ?? null
  const toolPolicy = options?.toolPolicy ?? null
  const scheduledToolDecision = (toolName: string): boolean | null => {
    if (!toolPolicy) return null
    const shortName = toolName.split('__').pop() ?? toolName
    const matches = (candidate: string) => candidate === toolName || candidate === shortName || candidate.split('__').pop() === shortName
    if (toolPolicy.neverAllow.some(matches)) return false
    return toolPolicy.preApproved.some(matches)
  }
  let newUserMsgId: string | null = null

  debugLog('chat', `dispatch: conv=${conversationId} agent=${agentId ?? 'none'} regenerate=${regenerate} cliBackend=${cliBackend ?? 'none'} model=${options?.model ?? 'default'} content="${content.slice(0, 60)}${content.length > 60 ? '…' : ''}"`)
  sendActivity({ state: 'thinking', label: 'Preparing context' })

  if (!regenerate) {
    const convo = db
      .prepare('SELECT id FROM conversations WHERE id = ?')
      .get(conversationId) as { id: string } | undefined

    if (!convo) {
      const now = Date.now()
      const title = content.slice(0, 80) + (content.length > 80 ? '...' : '')
      const validProjectId = projectId
        ? ((db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as { id: string } | undefined)
            ? projectId
            : null)
        : null
      // When a project chat is opened without an explicit agent, bind the project's primary agent
      // (or the first by sort order) so its backend and settings actually take effect. The desktop
      // renderer resolves this client-side in `newChat`; Android's new-project-chat entry points
      // pass no agentId, so without this fallback a project's added agent would never be applied and
      // nothing would indicate which agent (or backend) is driving the chat. Only runs at creation,
      // so a later explicit "no agent" choice on an existing conversation is never overridden.
      const resolvedAgentId =
        agentId ??
        (validProjectId
          ? ((db.prepare(
              'SELECT agent_id FROM project_agents WHERE project_id = ? ORDER BY is_primary DESC, sort_order ASC, added_at ASC LIMIT 1',
            ).get(validProjectId) as { agent_id: string } | undefined)?.agent_id ?? null)
          : null)
      db.prepare(
        'INSERT INTO conversations (id, agent_id, project_id, title, cli_backend, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(conversationId, resolvedAgentId, validProjectId, title, cliBackend ?? null, now, now)

    }

    // A client may change a mode and immediately send. Turn-carried overrides are applied before
    // provider resolution, so the turn and persistence form one atomic operation.
    if (options?.thinkingEffortOverride !== undefined) {
      db.prepare('UPDATE conversations SET thinking_effort_override = ? WHERE id = ?')
        .run(options.thinkingEffortOverride, conversationId)
    }
    if (options?.fullAutoApproveOverride !== undefined) {
      db.prepare('UPDATE conversations SET full_auto_approve_override = ? WHERE id = ?')
        .run(options.fullAutoApproveOverride === null ? null : options.fullAutoApproveOverride ? 1 : 0, conversationId)
    }
    if (options?.agenticModeOverride !== undefined) {
      db.prepare('UPDATE conversations SET agentic_mode_override = ? WHERE id = ?')
        .run(options.agenticModeOverride === null ? null : options.agenticModeOverride ? 1 : 0, conversationId)
    }
    if (options?.terminalSandboxOverride !== undefined) {
      db.prepare('UPDATE conversations SET terminal_sandbox_override = ? WHERE id = ?')
        .run(options.terminalSandboxOverride === null ? null : options.terminalSandboxOverride ? 1 : 0, conversationId)
    }
    if (options?.cliModeOverride !== undefined) {
      db.prepare('UPDATE conversations SET cli_mode_override = ? WHERE id = ?')
        .run(options.cliModeOverride, conversationId)
    }
    if (options?.codexExecutionModeOverride !== undefined) {
      db.prepare('UPDATE conversations SET codex_execution_mode_override = ? WHERE id = ?')
        .run(options.codexExecutionModeOverride, conversationId)
    }

    const userMsgId = options?.messageId ?? randomUUID()
    newUserMsgId = userMsgId
    activeUserMessageId = newUserMsgId
    const storedAttachments = buildStoredAttachments(attachments, pastedImages)
    const attachmentsJson = storedAttachments.length > 0 ? JSON.stringify(storedAttachments) : null
    const persistedUserContent = options?.displayContent ?? content
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, attachments, context_snapshot, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(userMsgId, conversationId, 'user', persistedUserContent, attachmentsJson, contextSnapshot, Date.now(), null)

    const msgCount = db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
      .get(conversationId) as { count: number }
    if (msgCount.count === 1) {
      const title = persistedUserContent.slice(0, 80) + (persistedUserContent.length > 80 ? '...' : '')
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId)
    }
  }

  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), conversationId)

  // Keep the conversation's stored model in sync with the latest explicit selection.
  // conversations.model is the fallback used to resolve (and label) any later message
  // that arrives without its own model override — e.g. the Android companion omitting
  // it. When this only wrote while the column was NULL/'default', the desktop picker
  // and the stored model diverged after the first turn, so fallback messages were
  // generated by and labelled with a stale model. Sync unconditionally instead.
  const requestedModel = options?.model
  if (requestedModel && requestedModel !== 'default') {
    db.prepare('UPDATE conversations SET model = ? WHERE id = ?').run(requestedModel, conversationId)
  }
  if (requestedHermesProfile !== undefined) {
    try {
      db.prepare('UPDATE conversations SET conversation_hermes_profile = ? WHERE id = ?').run(requestedHermesProfile, conversationId)
    } catch { /* pre-migration/test databases do not have the optional column */ }
  }

  // ── Provider resolution ────────────────────────────────────────────────────
  const convRow = db
    .prepare('SELECT agent_id, model, cli_backend, thinking_effort_override, full_auto_approve_override, agentic_mode_override, terminal_sandbox_override, cli_mode_override, codex_execution_mode_override FROM conversations WHERE id = ?')
    .get(conversationId) as {
      agent_id: string | null
      model: string | null
      cli_backend: string | null
      thinking_effort_override: string | null
      full_auto_approve_override: number | null
      agentic_mode_override: number | null
      terminal_sandbox_override: number | null
      cli_mode_override: string | null
      codex_execution_mode_override: string | null
    } | undefined
  let conversationHermesProfile: string | null = null
  try {
    conversationHermesProfile = (db.prepare('SELECT conversation_hermes_profile FROM conversations WHERE id = ?').get(conversationId) as { conversation_hermes_profile: string | null } | undefined)?.conversation_hermes_profile ?? null
  } catch { /* pre-migration/test databases do not have the optional column */ }
  // Auto-heal: if cli_backend is missing but the stored model is a known CLI model, infer and persist it.
  // Skip healing if the model is in the OpenRouter cache — it's a BYOK model, not a CLI one.
  // Reverse-heal: if cli_backend was previously set by mistake for an OpenRouter model, clear it.
  if (convRow && convRow.model) {
    const orModels = getOpenRouterModels()
    const isOpenRouterModel = orModels.includes(convRow.model)
    if (isOpenRouterModel && convRow.cli_backend != null) {
      db.prepare('UPDATE conversations SET cli_backend = NULL WHERE id = ?').run(conversationId)
      convRow.cli_backend = null
      debugLog('chat', `reverse-healed cli_backend cleared for conv=${conversationId} model=${convRow.model} (OpenRouter model)`)
    } else if (!isOpenRouterModel && convRow.cli_backend == null) {
      let healedBackend: 'claude-cli' | 'codex-cli' | 'hermes-cli' | null = null
      if (ClaudeAdapter.isAvailable() && isClaudeCliModelOrCandidate(convRow.model)) {
        healedBackend = 'claude-cli'
      } else if (CodexAdapter.isAvailable() && getCliModels('codex-cli').some((m) => m.id === convRow.model)) {
        healedBackend = 'codex-cli'
      } else if (HermesAdapter.isAvailable() && isHermesAcpReady() && getCliModels('hermes-cli').some((m) => m.id === convRow.model)) {
        healedBackend = 'hermes-cli'
      }
      if (healedBackend) {
        db.prepare('UPDATE conversations SET cli_backend = ? WHERE id = ?').run(healedBackend, conversationId)
        convRow.cli_backend = healedBackend
        debugLog('chat', `auto-healed cli_backend=${healedBackend} for conv=${conversationId} model=${convRow.model}`)
      }
    }
  }
  const settingsRows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('default_model', 'temperature', 'max_tokens')")
    .all() as Array<{ key: string; value: string }>
  const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]))
  const defaultModel = settingsMap.get('default_model') || 'default'
  let globalDefaultHermesProfile: string | null = null
  try {
    globalDefaultHermesProfile = (db.prepare("SELECT value FROM settings WHERE key = 'global_default_hermes_profile'").get() as { value: string } | undefined)?.value || null
  } catch { /* optional setting */ }
  const temperatureSetting = Number.parseFloat(settingsMap.get('temperature') ?? '')
  const maxTokensSetting = Number.parseInt(settingsMap.get('max_tokens') ?? '', 10)
  const effectiveAgentId = agentId ?? convRow?.agent_id ?? null
  const agentCfg2 = effectiveAgentId ? getAgentConfig(effectiveAgentId) : null
  const effectiveFullAutoApprove =
    convRow?.full_auto_approve_override === 1 ? true
    : convRow?.full_auto_approve_override === 0 ? false
    : (agentCfg2 ? isFullAutoApprove(agentCfg2) : false)
  const terminalSandboxProjectId =
    projectId ??
    (db.prepare('SELECT project_id FROM conversations WHERE id = ?').get(conversationId) as { project_id: string | null } | undefined)?.project_id ??
    null
  const terminalSandboxProjectRow = terminalSandboxProjectId
    ? (db.prepare('SELECT config_json FROM projects WHERE id = ?').get(terminalSandboxProjectId) as { config_json: string | null } | undefined)
    : undefined
  const projectConfig = terminalSandboxProjectRow
    ? parseProjectConfig(terminalSandboxProjectRow.config_json ?? null)
    : null
  const terminalSandboxProjectDefault = terminalSandboxProjectRow
    ? parseProjectConfig(terminalSandboxProjectRow.config_json ?? null).terminalSandboxBypass
    : false
  const effectiveTerminalSandboxBypass =
    convRow?.terminal_sandbox_override === 1 ? true
    : convRow?.terminal_sandbox_override === 0 ? false
    : terminalSandboxProjectDefault
  const effectivePermissionMode =
    options?.cliModeOverride !== undefined
      ? options.cliModeOverride ?? undefined
      : convRow?.cli_mode_override ?? undefined
  const requestedCodexExecutionMode =
    options?.codexExecutionModeOverride !== undefined
      ? options.codexExecutionModeOverride
      : convRow?.codex_execution_mode_override
  const effectiveCodexExecutionMode =
    requestedCodexExecutionMode === 'plan'
      ? 'plan'
      : undefined
  let finalizedPlan: string | null = null
  const generationOptions = {
    temperature: Number.isFinite(temperatureSetting) ? Math.min(2, Math.max(0, temperatureSetting)) : 0.7,
    maxTokens: Number.isFinite(maxTokensSetting) ? Math.min(16384, Math.max(256, maxTokensSetting)) : 4096,
    thinkingEffort: (convRow?.thinking_effort_override ?? projectConfig?.defaultThinkingEffort ?? agentCfg2?.thinkingEffort) as string | undefined,
  }
  const agenticMode =
    convRow?.agentic_mode_override === 1 ? true
    : convRow?.agentic_mode_override === 0 ? false
    : agentCfg2?.agenticMode === true
  const conversationModel = typeof convRow?.model === 'string' ? convRow.model : undefined
  const isModelAvailable = (model: string, hermesProfile?: string | null): boolean => {
    if (ClaudeAdapter.isAvailable() && isClaudeCliModelOrCandidate(model)) return true
    if (CodexAdapter.isAvailable() && getCliModels('codex-cli').some((entry) => entry.id === model)) return true
    if (HermesAdapter.isAvailable() && isHermesAcpReady() && getCliModels('hermes-cli', hermesProfile ?? undefined).some((entry) => entry.id === model)) return true
    const { provider } = getProviderForAgent(model)
    return !!getProviderCredential(provider, { projectId: terminalSandboxProjectId, agentId: effectiveAgentId })
  }
  const conversationModelIsAvailable = !!conversationModel &&
    conversationModel !== 'default' &&
    isModelAvailable(conversationModel)
  const effectiveProjectId = terminalSandboxProjectId
  const projectDefault = effectiveProjectId
    ? (db.prepare('SELECT default_model FROM projects WHERE id = ?').get(effectiveProjectId) as { default_model: string | null } | undefined)
    : undefined
  const projectDefaultModel = projectDefault?.default_model ?? null
  let projectDefaultHermesProfile: string | null = null
  if (effectiveProjectId) {
    try {
      projectDefaultHermesProfile = (db.prepare('SELECT project_hermes_profile FROM projects WHERE id = ?').get(effectiveProjectId) as { project_hermes_profile: string | null } | undefined)?.project_hermes_profile ?? null
    } catch { /* optional column */ }
  }
  const projectModelIsAvailable = !!projectDefaultModel &&
    projectDefaultModel !== 'default' &&
    isModelAvailable(projectDefaultModel, projectDefaultHermesProfile)
  const selectedModel =
    modelOverride && modelOverride !== 'default'
      ? modelOverride
      : conversationModelIsAvailable
        ? conversationModel
        : projectModelIsAvailable
          ? projectDefaultModel!
        : defaultModel !== 'default'
          ? defaultModel
          : DEFAULT_PROVIDER_MODEL
  const selectedHermesProfile =
    agentCfg2?.backend === 'hermes-cli' && typeof agentCfg2.hermesProfile === 'string' && agentCfg2.hermesProfile
      ? agentCfg2.hermesProfile
      : requestedHermesProfile !== undefined
        ? requestedHermesProfile
      : modelOverride && modelOverride !== 'default'
        ? conversationHermesProfile
        : conversationModelIsAvailable && conversationModel === selectedModel
          ? conversationHermesProfile
          : projectModelIsAvailable && projectDefaultModel === selectedModel
            ? projectDefaultHermesProfile
            : defaultModel === selectedModel
              ? globalDefaultHermesProfile
              : null
  const { provider: providerName, model: providerModel } = getProviderForAgent(selectedModel)
  debugLog('chat', `model resolved: selectedModel=${selectedModel} provider=${providerName} providerModel=${providerModel} agent=${effectiveAgentId ?? 'none'}`)
  const modelIdentityInstruction =
    `Runtime model for this conversation: ${selectedModel}. ` +
    'If the user asks which model or language model is running this chat, answer with this exact value.'

  // ── Context augmentation ───────────────────────────────────────────────────
  const {
    augmentedContent,
    attachedImages,
    injectedRootDirectory,
    projectDirectories = [],
    wikiProjectId,
    wikiToolDefs,
    wikiInlineHandlers,
    fileToolDefs,
    fileInlineHandlers,
    skillToolDefs,
    skillInlineHandlers,
    planToolDefs,
    planInlineHandlers,
  } = await buildChatContext(
      db,
      conversationId,
      content,
      {
        attachments,
        images: pastedImages,
        agentId,
        projectId,
        conversationModel,
        fullAutoApprove: effectiveFullAutoApprove,
        agenticMode,
        terminalSandboxBypass: effectiveTerminalSandboxBypass,
        toolPolicy: toolPolicy ?? undefined,
        planMode: effectivePermissionMode === 'plan',
        onPlanFinalized: (plan) => { finalizedPlan = plan },
        onContextProgress: sendContextProgress,
      },
      window?.webContents,
      sendActivity,
    )

  // ── Multi-agent orchestration ──────────────────────────────────────────────
  const orchProjectId = projectId ?? convRow
    ? (db.prepare('SELECT project_id FROM conversations WHERE id = ?').get(conversationId) as { project_id: string | null } | undefined)
    : undefined
  const orchProjId =
    projectId ??
    (orchProjectId as { project_id?: string | null } | undefined)?.project_id ??
    null

  if (orchProjId) {
    const projRow = db
      .prepare('SELECT name, config_json FROM projects WHERE id = ?')
      .get(orchProjId) as { name: string; config_json: string | null } | undefined
    const projConfig = projRow?.config_json
      ? (() => {
          try {
            return JSON.parse(projRow.config_json) as Record<string, unknown>
          } catch {
            return {}
          }
        })()
      : {}
    const agentBackendForOrch = typeof agentCfg2?.backend === 'string' ? agentCfg2.backend : null
    const effectiveCli = cliBackend ?? convRow?.cli_backend ?? agentBackendForOrch
    const orchEnabled = projConfig.workflowMode === 'orchestrated' && !effectiveCli

    if (orchEnabled) {
      const agentRows = db
        .prepare(
          'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC',
        )
        .all(orchProjId) as {
        agent_id: string
        is_primary: number
        sort_order: number
        config_json: string
      }[]

      const primaryRow = agentRows.find((r) => r.is_primary === 1)

      if (primaryRow && agentRows.length >= 2) {
        debugLog('chat', `orchestration: project=${orchProjId} leader=${primaryRow.agent_id} teamSize=${agentRows.length} maxDepth=${typeof projConfig.maxDelegationDepth === 'number' ? projConfig.maxDelegationDepth : 5}`)
        const teamAgents: OrchestratorAgent[] = agentRows.map((r) => {
          const cfg = (() => {
            try {
              return JSON.parse(r.config_json) as Record<string, unknown>
            } catch {
              return {}
            }
          })()
          return {
            agentId: r.agent_id,
            agentName: typeof cfg.name === 'string' ? cfg.name : 'Agent',
            agentIcon: typeof cfg.icon === 'string' ? cfg.icon : '🤖',
            isPrimary: r.is_primary === 1,
            sortOrder: r.sort_order,
          }
        })

        const maxDepth =
          typeof projConfig.maxDelegationDepth === 'number' ? projConfig.maxDelegationDepth : 5
        const showActivity = projConfig.showTeamActivity !== false

        const buildVisionUserContent = (): MessageContentPart[] => {
          const parts: MessageContentPart[] = [{ type: 'text', text: augmentedContent }]
          for (const img of attachedImages) {
            parts.push({ type: 'image_url', image_url: { url: img.dataUrl } })
          }
          return parts
        }
        const userContent: ProviderMessage['content'] =
          attachedImages.length > 0 ? buildVisionUserContent() : augmentedContent

        let orchResult: { finalContent: string; teamActivity: import('./orchestrator').TeamActivityStep[] }
        try {
          orchResult = await runOrchestration(
            {
              projectId: orchProjId,
              projectName: projRow?.name ?? 'Project',
              leaderAgentId: primaryRow.agent_id,
              teamAgents,
              conversationId,
              window,
              selectedModel: selectedModel ?? 'default',
              generationOptions,
              maxDelegationDepth: maxDepth,
              showActivity,
            },
            userContent,
            [],
          )
        } catch (orchError) {
          const message = orchError instanceof Error ? orchError.message : 'Orchestration failed'
          debugLog('chat', `orchestration error: ${message}`)
          turnEmitter.streamError({
            type: 'api',
            message,
            retryable: message !== NO_PROVIDER_CONFIGURED_MESSAGE,
          })
          sendActivity({ state: 'error', label: message })
          turnEmitter.closeStream()
          const errMsgId = persistAssistantMessage(db, conversationId, message, selectedModel ?? null)
          broadcastConversationMessages(conversationId)
          return { assistantMsgId: errMsgId }
        }

        const { finalContent, teamActivity } = orchResult

        if (showActivity && teamActivity.length > 0) {
          const activityMsgId = randomUUID()
          db.prepare(
            'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ).run(
            activityMsgId,
            conversationId,
            'team-activity',
            JSON.stringify({ steps: teamActivity }),
            null,
            Date.now() - 1,
            selectedModel ?? null,
          )
        }

        if (teamActivity.length > 0) {
          const insertDelegation = db.prepare(
            'INSERT INTO agent_delegations (id, conversation_id, leader_agent_id, specialist_agent_id, task, result, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          for (const step of teamActivity) {
            insertDelegation.run(
              step.stepId,
              conversationId,
              primaryRow.agent_id,
              step.agentId,
              step.task,
              step.result ?? null,
              step.status === 'error' ? 'error' : 'done',
              step.durationMs ?? null,
              Date.now(),
            )
          }
        }

        const responseContent = finalContent
        const assistantMsgId = persistAssistantMessage(db, conversationId, responseContent, selectedModel ?? null)
        broadcastConversationMessages(conversationId)
        sendStreamEnd()
        return { assistantMsgId }
      }
    }
  }

  // ── CLI backend dispatch ───────────────────────────────────────────────────
  const agentBackend = typeof agentCfg2?.backend === 'string' ? agentCfg2.backend : undefined
  const assignedAgentMcpServerIds = Array.isArray(agentCfg2?.mcpServers)
    ? (agentCfg2.mcpServers as string[])
    : []
  const effectiveCapabilityProfile = getEffectiveCapabilityProfile(db, conversationId)
  const effectiveMcpTrust = Object.fromEntries(
    effectiveCapabilityProfile.mcp.map((entry) => [entry.serverId, entry.trust]),
  )
  const chatMcpServerIds = getConversationMcpServerIds(db, conversationId)
  const effectiveMcpServerIds = [...new Set([...assignedAgentMcpServerIds, ...chatMcpServerIds])]
    .filter((serverId) => effectiveMcpTrust[serverId] !== 'block')
  const mcpExecutionPolicy = {
    assignedServerIds: effectiveMcpServerIds,
    serverTrust: effectiveMcpTrust,
  } as const
  const agentHasAssignedMcpServers = effectiveMcpServerIds.length > 0
  const credentialForModel = getProviderCredential(providerName, { projectId: orchProjId, agentId: effectiveAgentId })
  const fallbackCliBackend = resolveEffectiveBackend({
    cliBackend,
    agentBackend,
    convCliBackend: convRow?.cli_backend,
    selectedModel,
    providerName,
    projectId: orchProjId,
    agentId: effectiveAgentId,
    hermesProfile: selectedHermesProfile,
  })
  const hermesWasRequested = cliBackend === 'hermes-cli' || agentBackend === 'hermes-cli' || convRow?.cli_backend === 'hermes-cli'
  if (hermesWasRequested && !isHermesAcpReady()) {
    const detail = getCachedHermesAcpReadiness()?.detail
    throw new Error(`Hermes Agent is not ready for ACP${detail ? `: ${detail}` : '. Run "hermes acp --check" in a terminal, then recheck Hermes in Nexy.'}`)
  }
  const effectiveBackend = fallbackCliBackend ?? agentBackend
  debugLog('chat', `routing: authMode=${retrieveAuthMode()} credential=${credentialForModel ? 'available' : 'missing'} agentBackend=${agentBackend ?? 'none'} fallbackCli=${fallbackCliBackend ?? 'none'} effectiveBackend=${effectiveBackend ?? 'byok'}`)

  if (effectiveBackend) {
    const adapter = getAdapter(effectiveBackend)
    if (adapter?.isAvailable()) {
      const baseCliSystemPrompt =
        typeof agentCfg2?.systemPrompt === 'string' && agentCfg2.systemPrompt.trim().length > 0
          ? agentCfg2.systemPrompt
          : undefined
      const claudeCliProjectTeam = effectiveBackend === 'claude-cli' && orchProjId
        ? buildClaudeCliProjectTeam(db, orchProjId, effectiveAgentId)
        : null
      const cliSystemPrompt = [baseCliSystemPrompt, claudeCliProjectTeam?.directive]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join('\n\n') || undefined

      const historyRows = db
        .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timeline_order ASC, timestamp ASC, id ASC')
        .all(conversationId) as { role: string; content: string }[]
      const historyMessages = historyRows.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
      const providerHistoryMessages = historyMessages.filter(
        (m) => m.role !== 'team-activity'
          && m.role !== 'tool-call'
          && !isLegacyPortableOperationalSummary(m.role, m.content),
      ) as ProviderMessage[]
      const contextMessages: ProviderMessage[] =
        regenerate && providerHistoryMessages.length > 0
          ? providerHistoryMessages.slice(0, -1)
          : providerHistoryMessages
      const compressedContext = applyRollingContextCompression(
        db,
        conversationId,
        contextMessages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
        selectedModel ?? null,
      )
      recordServerContextFacts(db, newUserMsgId, selectedModel ?? null, compressedContext.summary && {
        compressedMessageCount: compressedContext.summary.compressedMessageCount,
        retainedMessageCount: compressedContext.summary.retainedMessageCount,
      })
      const effectiveContextMessages = compressedContext.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })) as ProviderMessage[]

      const historyTurns = effectiveContextMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
        .map((m) => {
          const label =
            m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System context'
          const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          return `${label}: ${text}`
        })

      let cliUserContent = augmentedContent
      if (historyTurns.length > 0) {
        cliUserContent = `[Prior conversation — for context only, do not repeat]\n${historyTurns.join('\n\n')}\n\n[Current message]\n${augmentedContent}`
      }
      sendContextProgress(
        estimateInputTokens(cliUserContent) + estimateInputTokens(cliSystemPrompt),
        'Context ready',
      )
      const availableCodexModels = effectiveBackend === 'codex-cli' ? getCliModels('codex-cli') : []
      const availableHermesModels = effectiveBackend === 'hermes-cli' ? getCliModels('hermes-cli', selectedHermesProfile ?? undefined) : []
      // Per-conversation override (conversationModel) takes priority over the agent's default
      // cliModel so users can switch models within a backend for a single conversation.
      const requestedCliModel = (modelOverride || conversationModel || agentCfg2?.cliModel || '') as string
      let cliModelForRequest: string
      if (effectiveBackend === 'codex-cli') {
        if (!requestedCliModel) {
          cliModelForRequest = availableCodexModels[0]?.id ?? ''
        } else if (availableCodexModels.some((m) => m.id === requestedCliModel)) {
          cliModelForRequest = requestedCliModel
        } else {
          cliModelForRequest = availableCodexModels[0]?.id ?? ''
        }
      } else if (effectiveBackend === 'hermes-cli') {
        cliModelForRequest = availableHermesModels.some((m) => m.id === requestedCliModel)
          ? requestedCliModel
          : (availableHermesModels[0]?.id ?? requestedCliModel)
      } else {
        cliModelForRequest = requestedCliModel
      }
      const cliMcpServers =
        (effectiveBackend === 'claude-cli' || effectiveBackend === 'codex-cli' || effectiveBackend === 'hermes-cli') &&
        agentHasAssignedMcpServers
          ? getMcpServerConfigsForCli(effectiveMcpServerIds)
          : undefined

      type PendingTool = { name: string; input: Record<string, unknown>; startTime: number }
      const pendingTools = new Map<string, PendingTool>()
      const completedToolCalls: Array<PendingTool & { id: string; content: string; isError: boolean }> = []
      // Date.now() alone is not an ordering key: several text/tool/thinking starts commonly
      // arrive in the same millisecond. Allocate strictly increasing occurrence times for
      // this turn so persisted history reconstructs the exact event order deterministically.
      let lastOccurrenceAt = Date.now() - 1
      const nextOccurrenceAt = (): number => {
        lastOccurrenceAt = Math.max(Date.now(), lastOccurrenceAt + 1)
        return lastOccurrenceAt
      }
      const persistCompletedCliToolCalls = () => {
        for (const tc of completedToolCalls.splice(0)) {
          db.prepare(
            'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ).run(
            randomUUID(),
            conversationId,
            'tool-call',
            JSON.stringify({
              __type: 'tool-call',
              toolCallId: tc.id,
              toolName: tc.name,
              serverName: effectiveBackend,
              toolArgs: tc.input,
              toolResult: tc.content,
              toolSuccess: !tc.isError,
            }),
            null,
            tc.startTime,
            effectiveBackend,
          )
        }
      }
      const cliThinkingBuffer = new Map<string, ThinkingBlockEntry>()
      const cliCitations: Citation[] = []
      // Mirrors cliThinkingBuffer, but for the response text itself — the adapter tags
      // each chunk with which contiguous burst it belongs to (a burst ends whenever a
      // tool call interrupts it), so bursts can be persisted and later re-interleaved
      // with the tool calls that separated them instead of collapsing into one blob.
      const cliTextBuffer = new Map<string, ThinkingBlockEntry>()
      const codexPlanState: { completedPlan: string | null } = { completedPlan: null }
      let implementApprovedCodexPlan = false
      let implementApprovedClaudePlan = false
      const cliSendChunk = (chunk: string, blockId?: string) => {
        sendChunk(chunk, blockId)
        if (!blockId) return
        const existing = cliTextBuffer.get(blockId) ?? { blockId, content: '', done: false, firstSeenAt: nextOccurrenceAt() }
        cliTextBuffer.set(blockId, { ...existing, content: existing.content + chunk })
      }

      let bridgedSkills: BridgedSkill[] = []
      let skillSaveBridge: SkillSaveMcpBridge | null = null
      try {
        turnEmitter.model(cliModelForRequest || effectiveBackend)
        sendActivity({ state: 'thinking', label: 'Starting CLI agent' })
        if (cliMcpServers && cliMcpServers.length > 0) {
          sendActivity({ state: 'thinking', label: 'Preparing MCP tools' })
          await ensureMcpServersReady(effectiveMcpServerIds)
        }
        // Build the allowed-tools list for the CLI, respecting per-tool and server-level
        // trust settings. Tools whose server is set to 'always-ask' are excluded so the
        // CLI process cannot call them autonomously (it has no approval UI of its own).
        // Build the allowed-tools list for the CLI, respecting per-tool and server-level
        // trust settings. Tools on servers set to 'always-ask' are excluded — the CLI
        // process runs autonomously and has no approval UI. Servers with no remaining
        // allowed tools are also stripped from the mcpServers list so the CLI doesn't
        // connect to them at all (otherwise it connects but then emits its own
        // "permission not granted" message for every tool call attempt).
        const { cliAllowedMcpTools, cliMcpServersFiltered } = await (async () => {
          if (!cliMcpServers || cliMcpServers.length === 0) {
            return { cliAllowedMcpTools: undefined, cliMcpServersFiltered: cliMcpServers }
          }
          const agentIdForTrust = effectiveAgentId ?? 'default'
          // Server-level trust must come from the SAME effective profile (chat + project +
          // agent, merged) that decided which servers are even attached to this turn — see
          // getConversationMcpServerIds() above. Querying agent_mcp_server_trust directly here
          // was a bug: that table is only ever written when a capability is activated with
          // "This agent" scope (activateConversationCapabilities in capability-service.ts). MCP
          // servers turned on via "This chat" or "This project" scope store their trust in
          // capability_profile_json / project config_json instead, so this lookup always missed
          // for those, silently fell back to 'always-ask', and forced a requestApproval() call
          // that can never be answered in a non-interactive/headless CLI turn (60s timeout ->
          // silent deny -> server dropped from the CLI's mcpServers list with no error surfaced).
          const serverTrustMap = new Map(
            getEffectiveCapabilityProfile(db, conversationId).mcp.map((entry) => [entry.serverId, entry.trust]),
          )

          // For each assigned server, determine if it needs upfront approval. The CLI
          // runs autonomously so we can't pause mid-run — instead we ask once before
          // starting. Approved servers are included; denied servers are excluded entirely.
          const approvedServerIds = new Set<string>()
          const serverIds = [...new Set(
            getAvailableMcpTools(effectiveMcpServerIds).map((t) => t.serverId)
          )]
          for (const serverId of serverIds) {
            const server = cliMcpServers.find((s) => s.id === serverId)
            if (!server) continue

            // Determine the effective trust for this server: check if ALL its tools
            // are disabled/blocked, all are auto, or any require approval.
            const serverTools = getAvailableMcpTools(effectiveMcpServerIds).filter((t) => t.serverId === serverId)
            let serverNeedsApproval = false
            let serverFullyBlocked = false
            const toolStatuses = serverTools.map((tool) => {
              const serverTrust = serverTrustMap.get(serverId)
              if (serverTrust === 'block') return 'disabled'
              const override = db
                .prepare('SELECT enabled, approval FROM agent_mcp_tool_overrides WHERE agent_id=? AND server_id=? AND tool_name=?')
                .get(agentIdForTrust, serverId, tool.name) as { enabled: number; approval: string } | undefined
              if (override) {
                if (override.enabled === 0 || override.approval === 'disabled') return 'disabled'
                return override.approval // 'auto' or 'always-ask'
              }
              return serverTrust ?? 'always-ask'
            })

            const nonDisabled = toolStatuses.filter((s) => s !== 'disabled')
            if (nonDisabled.length === 0) {
              serverFullyBlocked = true
            } else if (nonDisabled.some((s) => s === 'always-ask')) {
              serverNeedsApproval = true
            }

            if (serverFullyBlocked) continue

            if (toolPolicy) {
              if (serverTools.some((tool) => scheduledToolDecision(tool.name) === true)) {
                approvedServerIds.add(serverId)
              }
              continue
            }

            if (serverNeedsApproval) {
              const cliFullAuto = effectiveFullAutoApprove
              const approved = await requestApproval(
              window?.webContents,
                `mcp__${server.key}`,
                {},
                `Allow agent to use ${mcpServers.get(serverId)?.config.name ?? server.key} tools for this message?`,
                { noRemember: true, autoApprove: cliFullAuto, conversationId }
              )
              if (approved) approvedServerIds.add(serverId)
              // denied → server excluded from CLI run
            } else {
              // all tools are 'auto' — include without asking
              approvedServerIds.add(serverId)
            }
          }

          const allowedTools = getAvailableMcpTools(effectiveMcpServerIds).flatMap((tool) => {
            if (!approvedServerIds.has(tool.serverId)) return []
            const server = cliMcpServers.find((s) => s.id === tool.serverId)
            if (!server) return []
            const qualifiedName = `mcp__${server.key}__${tool.name}`
            if (toolPolicy && scheduledToolDecision(qualifiedName) !== true) return []
            const override = db
              .prepare('SELECT enabled, approval FROM agent_mcp_tool_overrides WHERE agent_id=? AND server_id=? AND tool_name=?')
              .get(agentIdForTrust, tool.serverId, tool.name) as { enabled: number; approval: string } | undefined
            if (override && (override.enabled === 0 || override.approval === 'disabled')) return []
            return [qualifiedName]
          })

          const filteredServers = cliMcpServers.filter((s) => approvedServerIds.has(s.id))

          return {
            cliAllowedMcpTools: allowedTools.length > 0 ? allowedTools : undefined,
            cliMcpServersFiltered: filteredServers.length > 0 ? filteredServers : undefined,
          }
        })()
        const cliAllowedBuiltInTools = effectiveBackend === 'claude-cli'
          ? getClaudeCliAllowedBuiltInTools(agentCfg2, effectiveAgentId, effectiveFullAutoApprove, getEffectiveCapabilityProfile(db, conversationId))
              .filter((toolName) => scheduledToolDecision(toolName) !== false)
          : []
        if (requestsSkillCapture(content) && scheduledToolDecision('save_skill') !== false) {
          skillSaveBridge = await startSkillSaveMcpBridge(
            async (name) => {
              sendActivity({ state: 'approval', label: `Waiting for approval to save skill: ${name}`, toolName: 'save_skill' })
              // Skill persistence is a library write, so it remains approval-gated even when
              // the surrounding CLI turn is running in full-auto mode.
              return requestApproval(
                window?.webContents,
                'save_skill',
                { name },
                `Save skill to library: ${name}`,
                {
                  noRemember: true,
                  conversationId,
                  ...(toolPolicy ? { autoApprove: scheduledToolDecision('save_skill') === true } : {}),
                },
              )
            },
            ({ skill, created }) => {
              if (window && !window.webContents.isDestroyed()) window.webContents.send('skill:library-updated')
              broadcastToMobile({
                event: created ? 'skill:created' : 'skill:updated',
                data: { skill },
              })
              sendActivity({ state: 'tool', label: `Saved skill: ${skill.name}`, toolName: 'save_skill' })
            },
          )
          sendActivity({ state: 'thinking', label: 'Skill save approval is available' })
        }
        const cliMcpServersForRequest = skillSaveBridge
          ? [...(cliMcpServersFiltered ?? []), skillSaveBridge.server]
          : cliMcpServersFiltered
        const cliAllowedTools = [...new Set([
          ...cliAllowedBuiltInTools,
          ...(cliAllowedMcpTools ?? []),
          ...(skillSaveBridge ? [skillSaveBridge.allowedTool] : []),
          // Claude has renamed its subagent launcher across releases. Grant both aliases;
          // unsupported names are harmless, while the live system prompt targets Agent.
          ...(claudeCliProjectTeam ? ['Agent', 'Task'] : []),
        ])]
        debugLog('chat', `cli-adapter: starting ${effectiveBackend} model=${cliModelForRequest || 'default'} mcpServers=${cliMcpServersForRequest?.length ?? 0} builtInTools=${cliAllowedBuiltInTools.length} mcpTools=${cliAllowedMcpTools?.length ?? 0} skillSave=${skillSaveBridge ? 'yes' : 'no'}`)

        const cliProjectDirectories = projectDirectories.filter((directory) => existsSync(directory))
        const cliCwd = (() => {
          if (cliProjectDirectories.length > 0) return cliProjectDirectories[0]
          const agentRoot: string | undefined = typeof agentCfg2?.rootDirectory === 'string' ? agentCfg2.rootDirectory : undefined
          if (agentRoot && existsSync(agentRoot)) return agentRoot
          return getWorkingDirectory()
        })()
        // Groups every file this CLI turn touches into a single Project Audit session, rather
        // than one session per tool call — mirrors how Code Changes groups an entire apply under
        // one session (remote-edit:<reportId>) instead of fragmenting it per file.
        const cliAuditSessionId = `cli-tool:${conversationId}:${randomUUID()}`
        // Snapshot content BEFORE each edit tool actually runs (tool_start, not tool_end — by
        // tool_end the file is already mutated), keyed by resolved absolute path so it survives
        // multiple tool calls touching the same file within one turn.
        const cliFileContentBeforeEdit = new Map<string, string | null>()
        const userInputToolIds = new Set<string>()
        const recordCliFileEditAudit = (absPath: string, before: string | null) => {
          try {
            if (!existsSync(absPath)) return
            const after = readFileSync(absPath, 'utf8')
            if (before === after) return
            const auditTarget = inferProjectAuditTarget(absPath)
            if (!auditTarget) return
            recordProjectAuditChange({
              ...auditTarget,
              sessionId: cliAuditSessionId,
              conversationId,
              title: `${effectiveBackend === 'claude-cli' ? 'Claude CLI' : effectiveBackend === 'codex-cli' ? 'Codex CLI' : 'Hermes Agent'} edits`,
              source: 'cli-tool',
              status: before === null ? 'created' : 'modified',
              lastOperation: before === null ? 'create' : 'write',
              diff: { hunks: computeLineDiff(before ?? '', after) },
            })
          } catch { /* best-effort audit — never let this break the chat turn */ }
        }

        // Guard against a second CLI turn starting for a conversation that already has one
        // in flight (e.g. the user re-sends while a prior turn is still blocked waiting on
        // tool approval). Without this, Android's single-slot pending-approval UI gets
        // silently overwritten by the new turn's request while the old turn's permission-hook
        // HTTP call sits invisible until its 60s auto-deny timeout — see
        // roadmap/bugs/bug-in-progress/cli-approval-relay-concurrent-turns.md.
        if (activeCliAbortControllers.has(conversationId)) {
          abortActiveStream(conversationId)
          denyPendingApprovalsForConversation(conversationId)
          cancelPendingUserInputsForConversation(conversationId, 'Replaced by a new turn')
        }
        assertConversationStartsAllowed()
        const cliAbortController = new AbortController()
        activeCliAbortControllers.set(conversationId, cliAbortController)
        // Bridge the agent's attached skills into the CLI harness's on-disk skills directory so a
        // Claude/Codex-backed run can discover them. Nexy owns and reference-counts these copies;
        // they are removed in the finally below once no other in-flight run still needs them.
        if (effectiveBackend === 'claude-cli' || effectiveBackend === 'codex-cli') {
          const chatSkills = getEffectiveCapabilityProfile(db, conversationId).skillIds
            .map((skillId) => getSkillConfig(skillId))
            .filter((skill): skill is SkillConfig => Boolean(skill))
          const attachedSkills = [...new Map([
            ...getSkillConfigsForAgent(effectiveAgentId ?? 'default'),
            ...chatSkills,
          ].map((skill) => [skill.id, skill])).values()]
          bridgedSkills = bridgeSkillsForCliRun(effectiveBackend, attachedSkills)
          if (bridgedSkills.length > 0) {
            debugLog('chat', `cli-adapter: bridged ${bridgedSkills.length} skill(s) into ${effectiveBackend} skills dir`)
          }
        }
        const requestClaudePlanApproval = async (plan: string): Promise<boolean> => {
          finalizedPlan = plan
          sendActivity({ state: 'approval', label: 'Waiting for plan approval', toolName: 'exit_plan_mode' })
          const approved = await requestApproval(
            window?.webContents,
            'exit_plan_mode',
            { plan },
            'Approve this plan and start implementing?',
            { noRemember: true, conversationId },
          )
          if (approved) {
            clearPersistedPlanMode(conversationId, 'claude')
            implementApprovedClaudePlan = true
            sendActivity({ state: 'tool', label: 'Plan approved — leaving plan mode', toolName: 'exit_plan_mode' })
          } else {
            sendActivity({ state: 'thinking', label: 'Plan not approved — staying in plan mode' })
          }
          return approved
        }
        const cliResponseContent = await adapter.send(
          window,
          {
            systemPrompt: cliSystemPrompt,
            hermesProfile: effectiveBackend === 'hermes-cli' ? selectedHermesProfile ?? undefined : undefined,
            agents: claudeCliProjectTeam?.agents,
            messages: [{ role: 'user' as const, content: cliUserContent }],
            images: attachedImages.length > 0 ? attachedImages : undefined,
            cwd: cliCwd,
            model: cliModelForRequest,
            conversationId,
            mcpServers: cliMcpServersForRequest,
            allowedTools: cliAllowedTools.length > 0 ? cliAllowedTools : undefined,
            // Only Claude CLI turns get the nexy_defer bridge wired (see claude.ts) — the flag is
            // harmless for other backends' adapters, which simply don't read it.
            deferredJobsEnabled: effectiveBackend === 'claude-cli',
            thinkingEffort: generationOptions.thinkingEffort as 'low' | 'medium' | 'high' | 'max' | 'disabled' | undefined,
            skipPermissions: effectiveFullAutoApprove,
            permissionMode: effectivePermissionMode,
            executionMode: effectiveCodexExecutionMode,
            // Claude's cwd is the primary source. Explicitly grant every other source so a
            // repository added to an existing project is visible to its built-in tools too.
            extraAllowedDirs: effectiveBackend === 'claude-cli'
              ? [...new Set([
                  ...cliProjectDirectories.filter((directory) => directory !== cliCwd),
                  ...(effectiveTerminalSandboxBypass ? [path.parse(homedir()).root] : []),
                ])]
              : undefined,
            // Bypass is an explicit promise that this turn has no approval gates. Do not
            // create Nexy's PermissionRequest bridge in that mode; the adapter also guards
            // this invariant so direct callers cannot accidentally re-enable prompts.
            requestPermission: effectiveBackend === 'claude-cli' && effectivePermissionMode !== 'bypassPermissions'
              ? (toolName, input) => {
                  // ExitPlanMode is a conversation-lifecycle handoff, not a normal tool
                  // permission. It must never be short-circuited by a scheduled tool policy.
                  if (toolName.toLowerCase() === 'exitplanmode' && effectivePermissionMode === 'plan') {
                    return requestClaudeCliToolPermission(
                      window, agentCfg2, effectiveAgentId, sendActivity, effectiveFullAutoApprove,
                      effectivePermissionMode, toolName, input, conversationId, requestClaudePlanApproval,
                    )
                  }
                  const decision = scheduledToolDecision(toolName)
                  return decision === null
                    ? requestClaudeCliToolPermission(
                        window,
                        agentCfg2,
                        effectiveAgentId,
                        sendActivity,
                        effectiveFullAutoApprove,
                        effectivePermissionMode,
                        toolName,
                        input,
                        conversationId,
                        effectivePermissionMode === 'plan' ? requestClaudePlanApproval : undefined,
                      )
                    : Promise.resolve(decision)
                }
              : effectiveBackend === 'codex-cli' && effectiveCodexExecutionMode === 'plan'
              ? (toolName, input) => {
                  const decision = scheduledToolDecision(toolName)
                  return decision === null
                    ? requestCodexToolPermission(window, sendActivity, effectiveFullAutoApprove, toolName, input, conversationId)
                    : Promise.resolve(decision)
                }
              : effectiveBackend === 'hermes-cli' && !effectiveFullAutoApprove
              ? (toolName, input) => {
                  const decision = scheduledToolDecision(toolName)
                  return decision === null
                    ? requestHermesToolPermission(window, sendActivity, toolName, input, conversationId)
                    : Promise.resolve(decision)
                }
              : undefined,
            requestPlanApproval: effectiveBackend === 'claude-cli' && effectivePermissionMode === 'plan'
              ? requestClaudePlanApproval
              : undefined,
            requestUserInput: effectiveBackend === 'codex-cli' && effectiveCodexExecutionMode === 'plan'
              ? (questions) => requestUserInput(turnEmitter, 'codex', questions, collectResolvedUserInput)
              : effectiveBackend === 'claude-cli'
              ? (questions) => requestUserInput(turnEmitter, 'claude', questions, collectResolvedUserInput)
              : undefined,
          },
          cliSendChunk,
          (event) => {
            if (event.type === 'tool_start') {
              if (event.name === 'mcp__nexy_user_input__ask_user' || event.name.endsWith('nexy_user_input.ask_user')) {
                userInputToolIds.add(event.id)
                return
              }
              debugLog('chat', `cli-tool-start: id=${event.id} name=${event.name}`)
              pendingTools.set(event.id, { name: event.name, input: event.input, startTime: nextOccurrenceAt() })
              if (isFileEditToolCall(effectiveBackend as 'claude-cli' | 'codex-cli' | 'hermes-cli', event.name)) {
                for (const absPath of extractCliEditedPaths(event.input as Record<string, unknown>, cliCwd)) {
                  if (!cliFileContentBeforeEdit.has(absPath)) {
                    cliFileContentBeforeEdit.set(absPath, existsSync(absPath) ? readFileSync(absPath, 'utf8') : null)
                  }
                }
              }
              turnEmitter.cliToolStart(event.id, event.name, event.input as Record<string, unknown>)
              sendActivity({
                state: 'tool',
                label: `Running ${event.name}`,
                toolName: event.name,
                serverName: effectiveBackend,
              })
            } else if (event.type === 'tool_end') {
              if (userInputToolIds.delete(event.id)) return
              debugLog('chat', `cli-tool-end: id=${event.id} isError=${event.isError} resultLen=${event.content.length}`)
              const pending = pendingTools.get(event.id)
              if (pending) {
                completedToolCalls.push({ id: event.id, ...pending, content: event.content, isError: event.isError })
                pendingTools.delete(event.id)
                if (!event.isError && isFileEditToolCall(effectiveBackend as 'claude-cli' | 'codex-cli' | 'hermes-cli', pending.name)) {
                  for (const absPath of extractCliEditedPaths(pending.input, cliCwd)) {
                    recordCliFileEditAudit(absPath, cliFileContentBeforeEdit.get(absPath) ?? null)
                  }
                }
              }
              turnEmitter.cliToolEnd(event.id, event.content, event.isError, pending ? {
                name: pending.name,
                input: pending.input as Record<string, unknown>,
                serverName: effectiveBackend,
              } : undefined)
              sendActivity({ state: 'thinking', label: 'Processing tool result' })
            } else if (event.type === 'cost') {
              const usage = turnUsage.add({
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                totalCostUsd: event.totalCostUsd,
                quality: 'provider',
                source: effectiveBackend,
                requestId: event.requestId,
              })
              turnEmitter.cost(usage.inputTokens, usage.outputTokens, usage.totalCostUsd, usage)
              recordServerUsage(db, newUserMsgId, usage)
            } else if (event.type === 'thinking_chunk') {
              turnEmitter.thinkingDelta(event.blockId, event.chunk)
              const existing = cliThinkingBuffer.get(event.blockId) ?? { blockId: event.blockId, content: '', done: false, firstSeenAt: nextOccurrenceAt() }
              cliThinkingBuffer.set(event.blockId, { ...existing, content: existing.content + event.chunk })
            } else if (event.type === 'thinking_end') {
              turnEmitter.thinkingEnd(event.blockId)
              const existing = cliThinkingBuffer.get(event.blockId)
              if (existing) cliThinkingBuffer.set(event.blockId, { ...existing, done: true })
            } else if (event.type === 'text_end') {
              turnEmitter.textSegmentDone(event.blockId)
              const existing = cliTextBuffer.get(event.blockId)
              if (existing) cliTextBuffer.set(event.blockId, { ...existing, done: true })
            } else if (event.type === 'plan_ready') {
              codexPlanState.completedPlan = event.plan
              finalizedPlan = event.plan
            } else if (event.type === 'activity') {
              sendActivity({ state: 'thinking', label: event.label })
            } else if (event.type === 'citations') {
              mergeCitations(cliCitations, event.citations)
            }
          },
          cliAbortController.signal,
        )
        activeCliAbortControllers.delete(conversationId)

        // A native Codex `plan` item is its ExitPlanMode signal. Pause at that boundary,
        // ask the user to approve the completed plan, and only then clear Nexy's persisted
        // collaboration-mode override. Plain agent messages (for example a clarifying
        // question) do not emit plan_ready and therefore keep the conversation in Plan mode.
        if (effectiveBackend === 'codex-cli' && effectiveCodexExecutionMode === 'plan' && codexPlanState.completedPlan !== null) {
          const plan = codexPlanState.completedPlan.trim() || cliResponseContent.trim()
          if (plan) {
            finalizedPlan = plan
            sendActivity({ state: 'approval', label: 'Waiting for plan approval', toolName: 'exit_plan_mode' })
            const approved = await requestApproval(
              window?.webContents,
              'exit_plan_mode',
              { plan },
              'Review the completed plan and choose what Codex should do next.',
              {
                noRemember: true,
                conversationId,
                ...(toolPolicy ? { autoApprove: scheduledToolDecision('exit_plan_mode') === true } : {}),
              },
            )
            if (approved) {
              clearPersistedPlanMode(conversationId, 'codex')
              implementApprovedCodexPlan = true
              sendActivity({ state: 'tool', label: 'Plan approved — leaving plan mode', toolName: 'exit_plan_mode' })
            } else {
              sendActivity({ state: 'thinking', label: 'Plan not approved — staying in plan mode' })
            }
          }
        }

        debugLog('chat', `cli-adapter: stream done toolCallsPersisted=${completedToolCalls.length} thinkingBlocks=${cliThinkingBuffer.size}`)
        persistCompletedCliToolCalls()
        const assistantMsgId = persistAssistantMessage(
          db, conversationId, cliResponseContent,
          (cliModelForRequest || null) as string | null,
          cliThinkingBuffer,
          cliTextBuffer,
          nextOccurrenceAt(),
          resolvedUserInputs,
          cliCitations,
        )
        if (finalizedPlan) {
          saveFinalizedPlanArtifact({ conversationId, sourceMessageId: assistantMsgId, plan: finalizedPlan })
        }
        broadcastConversationMessages(conversationId)
        sendStreamEnd({ suppressNotification: implementApprovedCodexPlan || implementApprovedClaudePlan })
        if (implementApprovedCodexPlan) {
          // Let this turn settle before beginning the implementation turn. The explicit null
          // override prevents a stale conversation snapshot from re-entering Plan mode, while
          // the persisted plan remains in history for Codex to implement.
          setTimeout(() => {
            const implementationPrompt =
              'Implement the approved plan now. Continue until it is fully complete, then verify the result.'
            if (window && !window.webContents.isDestroyed()) {
              window.webContents.send('chat:remote-message', {
                conversationId,
                content: implementationPrompt,
              })
            }
            void dispatchChatSend(
              window,
              conversationId,
              implementationPrompt,
              {
                agentId: effectiveAgentId ?? undefined,
                model: cliModelForRequest || undefined,
                cliBackend: 'codex-cli',
                projectId: orchProjId ?? undefined,
                codexExecutionModeOverride: null,
              },
            ).catch((error) => {
              debugLog('chat', `approved Codex plan follow-up failed: ${error instanceof Error ? error.message : String(error)}`)
            })
          }, 0)
        }
        if (implementApprovedClaudePlan) {
          // Claude --print sessions cannot transition out of Plan mode in-process. Start a
          // new normal Claude turn after persisting the approved plan, just as Codex does.
          setTimeout(() => {
            const implementationPrompt =
              'Implement the approved plan now. Continue until it is fully complete, then verify the result.'
            if (window && !window.webContents.isDestroyed()) {
              window.webContents.send('chat:remote-message', {
                conversationId,
                content: implementationPrompt,
              })
            }
            void dispatchChatSend(
              window,
              conversationId,
              implementationPrompt,
              {
                agentId: effectiveAgentId ?? undefined,
                model: cliModelForRequest || undefined,
                cliBackend: 'claude-cli',
                projectId: orchProjId ?? undefined,
                cliModeOverride: null,
              },
            ).catch((error) => {
              debugLog('chat', `approved Claude plan follow-up failed: ${error instanceof Error ? error.message : String(error)}`)
            })
          }, 0)
        }
        return { assistantMsgId }
      } catch (err) {
        debugLog('chat', `cli-adapter error: ${effectiveBackend} failed — ${err instanceof Error ? err.message : String(err)}`)
        console.error(`[chat] cli-adapter ${effectiveBackend} failed:`, err)
        persistCompletedCliToolCalls()
        const rawMessage = err instanceof Error ? err.message : 'CLI backend failed'
        const message = clarifyCliAuthError(rawMessage, effectiveBackend)
        for (const [blockId, block] of cliThinkingBuffer) {
          if (!block.done) {
            cliThinkingBuffer.set(blockId, { ...block, done: true })
            turnEmitter.thinkingEnd(blockId)
          }
        }
        for (const [blockId, block] of cliTextBuffer) {
          if (!block.done) {
            cliTextBuffer.set(blockId, { ...block, done: true })
            turnEmitter.textSegmentDone(blockId)
          }
        }
        turnEmitter.streamError({ type: 'api', message, retryable: true })
        sendActivity({ state: 'error', label: message })
        turnEmitter.closeStream()
        const assistantMsgId = persistAssistantMessage(
          db, conversationId, message, effectiveBackend, cliThinkingBuffer, cliTextBuffer, nextOccurrenceAt(),
        )
        return { assistantMsgId }
      } finally {
        skillSaveBridge?.close()
        // Remove the skills this run bridged (unless another in-flight run still references them).
        if (bridgedSkills.length > 0) releaseBridgedSkills(bridgedSkills)
      }
    }
  }

  // ── BYOK provider dispatch ─────────────────────────────────────────────────
  const credential = credentialForModel

  const historyRows = db
    .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timeline_order ASC, timestamp ASC, id ASC')
    .all(conversationId) as { role: string; content: string }[]
  const historyMessages = historyRows.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
  const providerHistoryMessages = historyMessages.filter(
    (m) => m.role !== 'team-activity'
      && m.role !== 'tool-call'
      && !isLegacyPortableOperationalSummary(m.role, m.content),
  ) as ProviderMessage[]

  // Cross-turn tool memory: tool-call rows are filtered out of the provider message list above (a
  // bare replay would break OpenAI's assistant/tool pairing contract), so a follow-up like
  // "Continue from where you left off" would otherwise have zero record of what the previous turn
  // did and re-investigate from scratch. Fold a compact, bounded digest of recent tool actions into
  // the system prompt instead — enough for real continuity without the message-format pitfalls.
  const toolHistoryDigest = buildToolHistoryDigest(historyMessages)
  const contextMessages: ProviderMessage[] =
    regenerate && providerHistoryMessages.length > 0
      ? providerHistoryMessages.slice(0, -1)
      : providerHistoryMessages
  const compressedContext = applyRollingContextCompression(
    db,
    conversationId,
    contextMessages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
    selectedModel ?? null,
  )
  recordServerContextFacts(db, newUserMsgId, selectedModel ?? null, compressedContext.summary && {
    compressedMessageCount: compressedContext.summary.compressedMessageCount,
    retainedMessageCount: compressedContext.summary.retainedMessageCount,
  })
  const effectiveContextMessages = compressedContext.messages.map((m) => ({
    role: m.role,
    content: m.content,
  })) as ProviderMessage[]

  // CCMP.7: inject relevant wiki entries into restored context after compression
  if (compressedContext.summary !== null && wikiProjectId && effectiveContextMessages.length > 0) {
    const ss = compressedContext.summary.structuredSummary
    const wikiSearchQuery = [...ss.goals, ...ss.filesTouched, ...ss.decisions].join(' ')
    const wikiEntries = getRelevantWikiEntries(db, wikiProjectId, wikiSearchQuery, 3)
    if (wikiEntries.length > 0) {
      effectiveContextMessages[0] = {
        ...effectiveContextMessages[0],
        content: `${effectiveContextMessages[0].content}\n\n${formatWikiSection(wikiEntries)}`,
      }
    }
  }

  const buildVisionUserContent = (): MessageContentPart[] => {
    const parts: MessageContentPart[] = [{ type: 'text', text: augmentedContent }]
    for (const img of attachedImages) {
      parts.push({ type: 'image_url', image_url: { url: img.dataUrl } })
    }
    return parts
  }
  const userContent: ProviderMessage['content'] =
    attachedImages.length > 0 ? buildVisionUserContent() : augmentedContent

  const agentSystemPrompt =
    typeof agentCfg2?.systemPrompt === 'string' ? agentCfg2.systemPrompt : undefined
  const contextBoundaryNote =
    '\n\nProject/context blocks in the user message, including [Project Context], [Project Scope], [Project File Structure], and [Project Wiki], are reference material only. Use them to answer the current request, but never reproduce, dump, summarize as raw metadata, or quote these blocks unless the user explicitly asks to inspect the context itself.'
  const rootDirNote = injectedRootDirectory
    ? `\n\nThe project's enabled source directories (${projectDirectories.length > 0 ? projectDirectories.join(', ') : injectedRootDirectory}) have been scanned and their file trees are provided in the user message within [Project File Structure] tags. Treat them as real file system data — do NOT say you cannot access the file system.`
    : ''
  const systemPrompt = (agentSystemPrompt
    ? `${agentSystemPrompt}${contextBoundaryNote}${rootDirNote}\n\n${modelIdentityInstruction}`
    : `You are an AI programming assistant.${contextBoundaryNote}${rootDirNote}\n\n${modelIdentityInstruction}`)
    + toolHistoryDigest

  const chatMessages: ProviderMessage[] = [
    { role: 'system' as const, content: systemPrompt },
    ...effectiveContextMessages,
    { role: 'user' as const, content: userContent },
  ]

  const assignedServerIds = effectiveMcpServerIds
  if (assignedServerIds.length > 0) {
    sendActivity({ state: 'thinking', label: 'Preparing MCP tools' })
    await ensureMcpServersReady(assignedServerIds)
  }
  const mcpTools = assignedServerIds.length > 0 ? getAvailableMcpTools(assignedServerIds) : []
  if (assignedServerIds.length > 0 && mcpTools.length === 0) {
    throw new Error(
      'Assigned MCP server has no available tools. Restart the MCP server from Settings > MCP Servers and try again.',
    )
  }
  const toolMap = new Map<string, { serverId: string; toolName: string }>()
  const toolDefs = mcpTools.map((t) => {
    const namespacedName = `${t.serverId}__${t.name}`
    toolMap.set(namespacedName, { serverId: t.serverId, toolName: t.name })
    return {
      type: 'function' as const,
      function: {
        name: namespacedName,
        description: t.description ?? t.name,
        parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
      },
    }
  })
  const userInputToolDef = {
    type: 'function' as const,
    function: {
      name: 'nexy_ask_user',
      description: 'Ask the user one or more necessary clarification questions and wait for their answers before continuing.',
      parameters: {
        type: 'object',
        required: ['questions'],
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['id', 'prompt'],
              properties: {
                id: { type: 'string' },
                header: { type: 'string' },
                prompt: { type: 'string' },
                selection: { type: 'string', enum: ['single', 'multiple'] },
                allowFreeText: { type: 'boolean' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'label'],
                    properties: {
                      id: { type: 'string' },
                      label: { type: 'string' },
                      description: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
  toolDefs.push(...wikiToolDefs, ...fileToolDefs, ...skillToolDefs, ...planToolDefs, userInputToolDef)
  sendContextProgress(
    estimateInputTokens(chatMessages) + estimateInputTokens(toolDefs),
    'Context ready',
  )

  const inlineHandlers = new Map([...wikiInlineHandlers, ...fileInlineHandlers, ...skillInlineHandlers, ...planInlineHandlers])
  inlineHandlers.set('nexy_ask_user', async (args) => {
    const questions = userInputQuestionsFromArgs(args)
    if (questions.length === 0) return { success: false, error: 'At least one valid question is required.' }
    const answers = await requestUserInput(turnEmitter, 'byok', questions, collectResolvedUserInput)
    return { success: true, result: JSON.stringify({ answers }) }
  })

  const hasMcpTools = mcpTools.length > 0
  const hasWikiTools = wikiToolDefs.length > 0
  const hasFileTools = fileToolDefs.length > 0
  const hasFileWriteTool = fileToolDefs.some((tool) => tool.function.name === 'write_project_file')
  const browserDirective = hasMcpTools
    ? `You have browser automation tools available: ${mcpTools.map((t) => t.name).join(', ')}. ` +
      "CRITICAL: Only use these tools when the user's request explicitly requires interacting with a web browser or web page. " +
      'For conversational questions, general knowledge, or anything that does not require a browser, respond directly WITHOUT calling any tools. ' +
      'When a browser task IS required, call the tools immediately and completely — do NOT say you "will" do something, just do it. ' +
      'After any inspection step (e.g. browser_snapshot), take the next required action immediately — do NOT narrate your findings before acting. ' +
      'Continue calling tools until the task is fully finished, then give a brief summary.'
    : ''
  const wikiDirective = hasWikiTools
    ? 'You have access to project memory tools: search_project_wiki, list_recent_wiki_entries, and propose_wiki_entry. ' +
      'Use search_project_wiki whenever past project knowledge, decisions, conventions, or procedures may help answer the user. ' +
      'Use propose_wiki_entry when a durable fact, decision, convention, solution, or procedure emerges that would likely help future project chats. ' +
      'Wiki writes always require explicit user approval, even when auto-approve is enabled; do not ask separately before calling the proposal tool.'
    : ''
  const fileDirective = hasFileWriteTool
    ? 'You have access to read_project_file, write_project_file, and copy_path_to_artifact tools, scoped to the project root directory. ' +
      'When the user asks you to create, edit, inspect, or preserve a file in the project, immediately call the appropriate tool in the same turn — never respond with text asking permission first, and never claim you lack file access or that a prior write happened without approval. ' +
      'When the user asks to return, keep, or save an existing file/folder as a Nexy artifact, call copy_path_to_artifact. ' +
      'There is no separate approval step for you to perform: calling write_project_file IS the entire action. Do not describe, narrate, or ask about it beforehand.'
    : hasFileTools
      ? 'You have read-only access to project files through read_project_file. Use it to inspect the files needed for the plan, but do not claim that you can edit them while Plan mode is active.'
    : ''
  const hasSkillActivationTools = skillToolDefs.some((tool) =>
    tool.function.name === 'activate_skill' || tool.function.name === 'read_skill_resource',
  )
  const hasSkillCaptureTool = skillToolDefs.some((tool) => tool.function.name === 'save_skill')
  const skillDirective = [
    hasSkillActivationTools
      ? 'Available skills are advertised by name and description only. When one clearly matches the task, call activate_skill before following it; never treat availability as activation. ' +
        'After activation, read only the supporting files you actually need with read_skill_resource. Skill packages cannot grant tools or bypass the current permission policy.'
      : '',
    hasSkillCaptureTool
      ? 'You also have a save_skill tool that persists a reusable skill to the user\'s Nexy skill library. ' +
        'Use it only when the user asks to save/keep a skill, or when you have read an external SKILL.md the user wants imported — never spontaneously. ' +
        'You may pass either a complete SKILL.md `markdown` document or the structured fields (name is required). Saving always requires user approval.'
      : '',
  ].filter(Boolean).join(' ')
  const hasPlanTools = planToolDefs.length > 0
  const planDirective = hasPlanTools
    ? 'This chat is in PLAN MODE. You are read-only: you may read files and research, but you must NOT edit files or run commands. ' +
      'Investigate what the task requires, then write a concrete, step-by-step implementation plan. ' +
      'When the plan is complete, call the exit_plan_mode tool with the full plan as markdown to present it to the user for approval. ' +
      'Do not claim you have made changes — in plan mode you cannot. Only after the user approves your plan will editing tools become available.'
    : ''
  const userInputDirective = 'You can call nexy_ask_user when essential information is missing and the answer is required to continue this same turn. Use it only for genuine clarification, not for rhetorical questions or optional follow-up offers.'
  const toolDirective = [browserDirective, wikiDirective, fileDirective, skillDirective, planDirective, userInputDirective].filter(Boolean).join('\n\n')

  // Heuristic: when the user's message clearly asks for a file operation and file tools are
  // available, force the model to call a tool on the first iteration instead of leaving
  // toolChoice='auto' — small models otherwise tend to ask for permission in chat text rather
  // than invoking write_project_file, since a soft system-prompt directive alone doesn't compel
  // a tool call. Scoped narrowly to file-shaped requests so unrelated questions aren't affected.
  const looksLikeFileIntent =
    /\b(create|write|save|edit|update|make)\b[^.?!]{0,60}\.\w{1,8}\b/i.test(content) ||
    /\bfile\s+(called|named)\b/i.test(content)
  const forceFirstToolChoice = hasFileWriteTool && looksLikeFileIntent

  let capturedStreamModel: string | null = null
  const handleStreamModel = (m: string) => {
    capturedStreamModel = m
    turnEmitter.model(m)
  }

  const byokThinkingBuffer = new Map<string, ThinkingBlockEntry>()

  // Strictly-increasing occurrence timestamps for this turn so persisted tool-call rows sort
  // before the final assistant message deterministically (several events can share a millisecond).
  let byokLastOccurrenceAt = Date.now() - 1
  const byokNextOccurrenceAt = (): number => {
    byokLastOccurrenceAt = Math.max(Date.now(), byokLastOccurrenceAt + 1)
    return byokLastOccurrenceAt
  }
  const byokTextBuffer = new Map<string, ThinkingBlockEntry>()
  const byokCitations: Citation[] = []
  const closeByokTextSegments = () => {
    for (const [blockId, block] of byokTextBuffer) {
      if (!block.done) byokTextBuffer.set(blockId, { ...block, done: true })
    }
  }
  const byokSendChunk = (chunk: string, blockId?: string) => {
    const event = turnEmitter.assistantTextDelta(chunk, blockId)
    const resolvedBlockId = event.type === 'assistant_text_delta' ? event.blockId : undefined
    if (!resolvedBlockId) return
    const existing = byokTextBuffer.get(resolvedBlockId) ?? {
      blockId: resolvedBlockId,
      content: '',
      done: false,
      firstSeenAt: byokNextOccurrenceAt(),
    }
    byokTextBuffer.set(resolvedBlockId, {
      ...existing,
      content: existing.content + chunk,
    })
  }

  let responseContent: string
  let completionActivity: MobileChatActivity = { state: 'complete', label: 'Complete' }

  try {
    debugLog('chat', `byok: dispatching to ${providerName}/${providerModel} mcpTools=${mcpTools.length} wikiTools=${wikiToolDefs.length} contextMsgs=${effectiveContextMessages.length}`)
    sendActivity({ state: 'thinking', label: 'Contacting model' })

    if (!credential) {
      throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
    }

    responseContent = await dispatchToProvider({
      providerName,
      providerModel,
      credential,
      chatMessages,
      toolDefs,
      toolMap,
      effectiveAgentId,
      agenticMode,
      wikiInlineHandlers: inlineHandlers,
      toolDirective,
      generationOptions,
      conversationId,
      webContents: window?.webContents,
      sendChunk: byokSendChunk,
      sendActivity,
      onModel: handleStreamModel,
      onUsage: (usage) => {
        const total = turnUsage.add({
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          quality: 'provider',
          source: providerName,
        })
        turnEmitter.cost(total.inputTokens, total.outputTokens, total.totalCostUsd, total)
        recordServerUsage(db, newUserMsgId, total)
      },
      onPreflightUsage: (count: TokenCount) => {
        patchContextSnapshot(db, newUserMsgId, { nextRequest: count })
        turnEmitter.activity({
          state: 'thinking',
          label: `${count.inputTokens.toLocaleString('en-US')} input tokens · provider count`,
        })
      },
      onCitations: (citations) => mergeCitations(byokCitations, citations),
      systemPrompt,
      toolPolicy: toolPolicy ?? undefined,
      fullAutoApprove: effectiveFullAutoApprove,
      mcpPolicy: mcpExecutionPolicy,
      forceFirstToolChoice,
      onThinkingChunk: (blockId, chunk) => {
        // Reasoning starts a new chronological segment too. Date.now() alone can tie with a
        // text/tool event, which made the historical timeline depend on sort stability.
        closeByokTextSegments()
        const existing = byokThinkingBuffer.get(blockId) ?? { blockId, content: '', done: false, firstSeenAt: byokNextOccurrenceAt() }
        byokThinkingBuffer.set(blockId, { ...existing, content: existing.content + chunk })
        turnEmitter.thinkingDelta(blockId, chunk)
      },
      onThinkingEnd: (blockId) => {
        const existing = byokThinkingBuffer.get(blockId)
        if (existing) byokThinkingBuffer.set(blockId, { ...existing, done: true })
        turnEmitter.thinkingEnd(blockId)
      },
      onToolStarted: (event) => {
        // The user-input tool has its own normalized request card; showing a generic tool card as
        // well would duplicate it. All other BYOK tools get the same in-progress event as CLI
        // tools, before the potentially slow MCP call begins.
        if (event.toolName === 'nexy_ask_user') return
        turnEmitter.toolStarted({
          id: event.id,
          toolName: event.toolName,
          serverName: event.serverName,
          args: event.args,
        })
      },
      onToolFinished: (event) => {
        // The dedicated request/resolution events and cards are authoritative for this built-in;
        // do not also expose or persist its answer JSON as a generic tool-call card.
        if (event.toolName === 'nexy_ask_user') return
        turnEmitter.toolFinished({
          id: event.id,
          toolName: event.toolName,
          serverName: event.serverName,
          args: event.args,
          result: event.result,
          success: event.success,
          ...(event.resultImages?.length ? { resultImages: event.resultImages } : {}),
        })
        // toolFinished closes the current response-text segment in the emitter. Mirror that
        // boundary in the persisted buffer so the historical timeline can place narration
        // before/after each BYOK tool call instead of collapsing everything into the final bubble.
        closeByokTextSegments()
        // Persist a durable, renderable tool-call row (parity with the CLI path's
        // persistCompletedCliToolCalls). Without this the live tool events vanish the moment the
        // client reloads history from the DB at end-of-turn — the reported "toolcalls disappeared"
        // bug. Uses the same __type:'tool-call' JSON shape the CLI path and renderer expect.
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(
          randomUUID(),
          conversationId,
          'tool-call',
          JSON.stringify({
            __type: 'tool-call',
            toolCallId: event.id,
            toolName: event.toolName,
            serverName: event.serverName,
            toolArgs: event.args,
            toolResult: event.result,
            toolSuccess: event.success,
          }),
          null,
          byokNextOccurrenceAt(),
          capturedStreamModel ?? selectedModel ?? providerModel,
        )
      },
    })

    debugLog('chat', `byok: stream complete provider=${providerName} responseLen=${responseContent.length}`)
  } catch (error) {
    debugLog('chat', `byok error: ${providerName} — ${error instanceof Error ? error.message : String(error)}`)
    console.error(`[chat] ${providerName} error:`, error)
    const message = error instanceof Error ? error.message : 'Unexpected provider error'
    turnEmitter.streamError({
      type: 'api',
      message,
      retryable: message !== NO_PROVIDER_CONFIGURED_MESSAGE && message !== 'Azure endpoint not configured',
    })
    responseContent = message
    completionActivity = { state: 'error', label: message }
  }

  const assistantMsgId = persistAssistantMessage(
    db, conversationId, responseContent,
    capturedStreamModel ?? selectedModel ?? null,
    byokThinkingBuffer,
    byokTextBuffer,
    byokNextOccurrenceAt(),
    resolvedUserInputs,
    byokCitations,
  )
  if (finalizedPlan) {
    saveFinalizedPlanArtifact({ conversationId, sourceMessageId: assistantMsgId, plan: finalizedPlan })
  }

  broadcastConversationMessages(conversationId)

  if (completionActivity.state === 'complete') {
    sendStreamEnd()
  } else {
    sendActivity(completionActivity)
    turnEmitter.closeStream()
  }

  return { assistantMsgId }
  } catch (dispatchError) {
    // Last-resort handler — see the comment at the top of the try block. Anything that
    // reaches here bypassed every branch-specific error path above, so the activity
    // registered by turnEmitter.started() would otherwise never get closed.
    const message = dispatchError instanceof Error ? dispatchError.message : 'Unexpected error'
    console.error('[chat] dispatchChatSend unexpected error:', dispatchError)
    turnEmitter.streamError({ type: 'api', message, retryable: true })
    sendActivity({ state: 'error', label: message })
    turnEmitter.closeStream()
    const assistantMsgId = persistAssistantMessage(db, conversationId, message, null)
    broadcastConversationMessages(conversationId)
    return { assistantMsgId }
  } finally {
    endActivity(`chat:${conversationId}`)
  }
}

export function registerChatHandlers(): void {
  safeHandle(
    'chat:send-message',
    async (event, conversationId: string, content: string, options?: ChatSendOptions) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return null
      return dispatchChatSend(window, conversationId, content, options)
    },
  )

  safeHandle('chat:stop-generation', async (_event, conversationId?: string) => {
    abortActiveStream(conversationId)
    if (conversationId) {
      clearActiveChatTurn(conversationId)
      denyPendingApprovalsForConversation(conversationId)
      cancelPendingUserInputsForConversation(conversationId)
    }
    return true
  })
}

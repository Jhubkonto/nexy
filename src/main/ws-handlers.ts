import { BrowserWindow, ipcMain } from 'electron'
import { listConversationPage } from './conversation-pagination'
import type { ConversationPageRequest } from '../shared/types'
import type { CapabilityTrust } from '../shared/types'
import type { UserInputAnswer, UserInputRequest } from '../shared/chat-turn-types'
import { createHash, randomUUID } from 'crypto'
import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import {
  activateConversationCapabilities,
  assertCapabilityProfileValid,
  getConversationCapabilityProfile,
  getProjectCapabilityProfile,
  normalizeCapabilityProfile,
  resolveConversationCapabilities,
  setProjectCapabilityProfile,
} from './capability-service'
import { applyLifecycleSetting, isAutoStartEnabled, setAutoStartEnabled } from './app-lifecycle-settings'
import { abortActiveStream, PROVIDERS, getProviderModelIds, isProviderConfigured } from './providers'
import { dispatchChatSend, broadcastConversationMessages } from './chat-handlers'
import { activateEmergencyStop, getEmergencyStopStatus, resumeConversations } from './emergency-stop'
import { debugLog } from './debug-mode'
import { getCliModels } from './cli-detection'
import { getClaudeCliModelChoices, isClaudeCliModelOrCandidate } from './cli-adapters/claude-model-probe'
import { getCachedCatalog } from './model-catalog'
import { getAndroidUpdateManifest, getAndroidWorkspaceInfo, getSigningConfig, publishAndroidUpdate, restoreAndroidVersion, startAndroidBuildFromMobile, cancelAndroidBuildFromMobile } from './android-handlers'
import { getWorkspaceInfo, startBuildFromMobile, cancelMobileBuild, publishArtifactToFeed, runPublishedUpdateInstall } from './build-handlers'
import { dbListTasks, dbGetTask, dbCreateTask, dbUpdateTask, dbDeleteTask, dbSetTaskEnabled, dbListRuns, schedulerEngine } from './scheduler-engine'
import { existsSync as fsExistsSync } from 'fs'
import pathModule from 'path'
import { discoverReposInWorkspace, listRepoFiles } from './code-change/repo-discovery'
import {
  listBranches,
  checkoutBranch,
  createBranch,
  fetchRepo,
  mergeBranch,
  getChangedFiles,
  initRepo,
  detectGitCredentials,
  pullRepo,
  pushRepo,
  commitChanges,
  discardFileChanges,
  stashChanges,
  stashPop,
  getStashCount,
  deleteBranch,
  getFileDiff,
  stageFiles,
  unstageFiles,
} from './code-change/git-manager'
import { runProjectGeneratorChatForAndroid, createProjectFromSpec, getProjectGeneratorAgentSummaries, getProjectGeneratorModel } from './project-generator'
import { normalizeProjectColor } from '../shared/project-colors'
import { runAgentGeneratorChatForAndroid, createAgentFromSpec, getAgentGeneratorModel } from './agent-generator'
import { runSkillGeneratorChatForAndroid, createSkillFromSpec, getSkillGeneratorModel } from './skill-generator'
import {
  createScheduleFromSpec,
  getScheduleGeneratorModel,
  runScheduleGeneratorChatForAndroid,
  setScheduleGeneratorModel,
} from './scheduler-generator'
import {
  createArtifactGeneratorRunRecord,
  runArtifactGeneration,
  runArtifactGeneratorChatForAndroid,
  updateArtifactGeneratorRunRecord,
  getArtifactGeneratorModel,
} from './artifact-generator'
import { promoteConversationMessageToArtifact, deleteArtifactVersion } from './artifacts'
import { getActiveChatTurnSnapshot } from './active-chat-turns'
import {
  getAutomatedWorkflowGeneratorModel,
  runAutomatedWorkflowGeneratorChatForAndroid,
  setAutomatedWorkflowGeneratorModel,
  normalizeAutomatedWorkflowSpec,
} from './automated-workflow-generator'
import {
  saveAutomatedWorkflowRunFromSpec,
  listAutomatedWorkflowRuns,
  listAllAutomatedWorkflowRuns,
  getAutomatedWorkflowRun,
  updateAutomatedWorkflowRunStepStatus,
  discardAutomatedWorkflowRun,
  runAutomatedWorkflowTemplateAgain,
} from './automated-workflow-runs'
import {
  startAutomatedWorkflowRun,
  confirmAutomatedWorkflowStep,
  retryAutomatedWorkflowStep,
  skipAutomatedWorkflowStep,
  abortAutomatedWorkflowRun,
  setAutomatedWorkflowConfirmationMode,
  advanceAutomatedWorkflowRun,
} from './automated-workflow-executor'
import {
  confirmManagedPublish,
  createManagedPublishPreview,
  editManagedWorkflowVersion,
  getManagedArtifactVersionContent,
  getManagedBindings,
  listManagedWorkflowSources,
  recordManagedWorkflowReview,
  resetManagedWorkflowFromStep,
} from './automated-workflow-managed'
import type { ProjectGeneratorSpec, AgentGeneratorSpec, SkillConfig, SkillGeneratorSpec, ScheduleGeneratorMessage, ScheduleGeneratorSpec, ArtifactGeneratorMessage, ArtifactSpec, PromptLibraryEntry, PromptLibraryVersion, AutomatedWorkflowGeneratorMessage, AutomatedWorkflowStepStatus } from '../shared/types'
import { storeApiKey, removeApiKey, getAzureEndpoint, setAzureEndpoint } from './provider-secrets'
import { testProviderKey } from './providers'
import { detectAllClis, getHermesProfileDiscovery, listHermesProfiles, hermesAcpReadiness } from './cli-detection'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { HermesAdapter } from './cli-adapters/hermes'
import { insertWikiEntry, extractWikiLearningsForWs } from './wiki-handlers'
import { startDebriefGeneration, generateDebriefStoryForWs, getDebriefForWs, markCompleteForWs, markIncompleteForWs } from './debrief-handlers'
import { startQuizGeneration, getQuizForWs, getQuizByArtifactIdForWs } from './quiz-handlers'
import { generateTeachbackForWs, getTeachbackForWs, getTeachbackByArtifactIdForWs, gradeTeachbackForWs, listTeachbackAttempts } from './teachback-handlers'
import type { QuizSpec, QuizSource, QuizDifficulty, DebriefStoryTone } from '../shared/types'
import {
  submitRatingForConversation,
  getRatingForConversation,
  deleteRatingForConversation,
  listRatings,
  getRatingStats,
} from './rating-handlers'
import { getActivitySnapshot, endActivity } from './activity-tracker'
import { clearUnseenDestination, getNewContentConversations, markAllConversationsRead } from './activity-badge'
import { getMcpServersForCompanion, getMcpServerStatus, addMcpServer, updateMcpServer, removeMcpServer, restartMcpServer, listMcpTools, listMcpToolsForAgent, testMcpServer } from './mcp'
import { searchMcpRegistry } from './mcp-registry'
import { MCP_CATALOG } from '../shared/mcp-catalog'
import { normalizeMcpSandboxProfile } from '../shared/mcp-sandbox'
import {
  insertPromptLibraryEntry,
  isPromptVisibleForProject,
  listPromptLibraryVersions,
  rollbackPromptLibraryEntry,
  updatePromptLibraryEntry,
} from './prompt-handlers'
import { buildConversationExportPack, forkConversation, importConversationExport, getConversationCompressionPreview, prepareConversationCompressionSummary, saveConversationCompressionSummary } from './conversation-handlers'
import type { ContextInspectorSnapshot } from '../shared/types'
import { CLAUDE_CLI_MODES, CODEX_CLI_MODES } from '../shared/types'
import { getProjectAuditDiff, listProjectAuditFiles, listProjectAuditSessions } from './project-audit'
import {
  addProjectSource,
  ensureLegacyProjectSource,
  listProjectSources,
  primarySourcePath,
  removeProjectRepository,
  rescanProjectSources,
  setPrimarySourcePath,
} from './project-sources'
import { parseProjectConfig, detectProjectWorkspaceMetadata, readProjectConfig } from './project-handlers'
import { listDirectoryEntriesForRemote, readFileForRemote, readImageFileForRemote, readAssetFileForRemote, isRemoteImagePath, getFsStartRoots, getFsAuthorizedRoots } from './file-handlers'
import { listProjectPeekDirectory, resolveProjectPeekPath, type ProjectPeekFilter, type ProjectPeekSource } from './project-peek'
import {
  createSkillConfig,
  discoverSkills,
  deleteSkillConfig,
  duplicateSkillConfig,
  getSkillAgentLinks,
  getSkillAgentUsage,
  getSkillConfigForTransport,
  listSkillConfigsForTransport,
  reorderSkillsForAgent,
  setSkillAgentAttachment,
  updateSkillConfig,
} from './skills'
import { importDiscoveredSkill } from './skill-discovery'
import { skillForTransport } from './skill-packages'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { parseConversationExport } from './conversation-serialization'
import { app } from 'electron'
import { handleStandaloneSyncCommand } from './standalone-sync'
import { VoiceUploadSessionManager } from './voice-upload-sessions'
import {
  startWsServer,
  stopWsServer,
  getWsStatus,
  getQrDataUrl,
  regenerateToken,
  setWsCommandHandler,
  broadcastToMobile,
  getWakelockEnabled,
  setWakelockEnabled,
  setMobileInForeground,
} from './ws-server'

// Filled in by tools.ts after registration to avoid a circular import
let resolveApprovalFn: ((requestId: string, approved: boolean) => boolean) | null = null
let approveConversationApprovalsFn: ((conversationId: string) => void) | null = null
let resolveUserInputFn: ((requestId: string, answers: UserInputAnswer[]) => boolean) | null = null
let getPendingUserInputsFn: ((conversationId?: string) => UserInputRequest[]) | null = null
export function registerApprovalResolver(fn: (requestId: string, approved: boolean) => boolean): void {
  resolveApprovalFn = fn
}
export function registerConversationApprovalEscalator(fn: (conversationId: string) => void): void {
  approveConversationApprovalsFn = fn
}
export function registerUserInputResolver(fn: (requestId: string, answers: UserInputAnswer[]) => boolean): void {
  resolveUserInputFn = fn
}
export function registerPendingUserInputProvider(fn: (conversationId?: string) => UserInputRequest[]): void {
  getPendingUserInputsFn = fn
}

const MAX_MOBILE_ATTACHMENT_BYTES = 20 * 1024 * 1024

type MaterializedChatAttachment = { id: string; name: string; path: string; size: number }

export function decodeMobileAttachmentDataUrl(dataUrl: unknown): { mimeType: string; bytes: Buffer } | null {
  if (typeof dataUrl !== 'string') return null
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl)
  if (!match) return null
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length > MAX_MOBILE_ATTACHMENT_BYTES) return null
  return { mimeType: match[1], bytes }
}

/** Converts a mobile data URL into an app-owned file before chat dispatch. The resulting path is
 * durable across renderer/device disconnects and never trusts the sender's filename as a path. */
export function materializeMobileAttachment(
  conversationId: string,
  value: Record<string, unknown>,
): MaterializedChatAttachment | null {
  const id = typeof value.id === 'string' ? value.id : ''
  const name = typeof value.name === 'string' ? value.name : ''
  const decoded = decodeMobileAttachmentDataUrl(value.dataUrl)
  if (!id || !name || !decoded) return null
  const safeConversation = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'chat'
  // Intentionally strips control characters (\x00-\x1f) from the filename.
  // eslint-disable-next-line no-control-regex
  const safeName = pathModule.basename(name).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 120) || 'attachment'
  const extension = pathModule.extname(safeName).slice(0, 16)
  const directory = pathModule.join(app.getPath('userData'), 'mobile-attachments', safeConversation)
  mkdirSync(directory, { recursive: true })
  const target = pathModule.join(directory, `${randomUUID()}${extension}`)
  writeFileSync(target, decoded.bytes, { flag: 'wx' })
  return { id, name: safeName, path: target, size: decoded.bytes.length }
}

/** Defensively parses a QuizSpec from an untrusted WS payload (Android companion). */
function parseQuizSpec(raw: unknown): QuizSpec {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  const spec: QuizSpec = {}
  if (obj.source === 'conversation' || obj.source === 'debrief' || obj.source === 'project') spec.source = obj.source as QuizSource
  if (typeof obj.topic === 'string' && obj.topic.trim()) spec.topic = obj.topic.trim()
  if (obj.difficulty === 'easy' || obj.difficulty === 'medium' || obj.difficulty === 'hard') spec.difficulty = obj.difficulty as QuizDifficulty
  if (typeof obj.questionCount === 'number' && Number.isFinite(obj.questionCount)) spec.questionCount = obj.questionCount
  if (Array.isArray(obj.focusQuestions)) spec.focusQuestions = obj.focusQuestions.filter((q): q is string => typeof q === 'string')
  return spec
}

function mobilePromptEntry(entry: PromptLibraryEntry): Record<string, unknown> {
  return {
    id: entry.id,
    title: entry.title,
    body: entry.body,
    description: entry.description,
    category: entry.category,
    tags: entry.tags,
    scope: entry.scope,
    projectId: entry.project_id,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  }
}

function mobilePromptVersion(version: PromptLibraryVersion): Record<string, unknown> {
  return {
    id: version.id,
    promptId: version.prompt_id,
    version: version.version,
    title: version.title,
    body: version.body,
    description: version.description,
    category: version.category,
    tags: version.tags,
    variables: version.variables,
    scope: version.scope,
    projectId: version.project_id,
    source: version.source,
    createdAt: version.created_at,
    diff: version.diff,
  }
}

// Tracks conversationIds currently being dispatched from Android to prevent
// duplicate streams when the Android client reconnects mid-send (race-connect).
const activeAndroidDispatches = new Set<string>()
const voiceUploadSessions = new VoiceUploadSessionManager()

/**
 * Asks the focused renderer window for its live composer/draft state (system prompt,
 * @refs, attachments, current input) so the Android companion can render the same
 * "Context inspector" breakdown as the desktop app. Times out with null if no window
 * is open or the renderer doesn't reply (e.g. a different conversation is focused).
 */
function requestInspectorSnapshotFromRenderer(conversationId: string | null): Promise<ContextInspectorSnapshot | null> {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return Promise.resolve(null)

  const requestId = randomUUID()
  return new Promise((resolve) => {
    let settled = false
    const finish = (snapshot: ContextInspectorSnapshot | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ipcMain.off('context:inspector-snapshot-reply', replyHandler)
      resolve(snapshot)
    }
    const replyHandler = (_event: Electron.IpcMainEvent, incomingRequestId: string, snapshot: ContextInspectorSnapshot | null) => {
      if (incomingRequestId !== requestId) return
      finish(snapshot)
    }
    const timer = setTimeout(() => finish(null), 2000)
    ipcMain.on('context:inspector-snapshot-reply', replyHandler)
    win.webContents.send('context:request-inspector-snapshot', { requestId, conversationId })
  })
}

export function registerWsHandlers(): void {
  setWsCommandHandler(async (command, data, reply) => {
    const connectionId = typeof data.__connectionId === 'string' ? data.__connectionId : ''
    if (command === 'internal:client-disconnected') {
      voiceUploadSessions.disconnect(connectionId)
      return
    }
    if (command === 'voice:upload-start') {
      reply(voiceUploadSessions.start(connectionId, reply))
      return
    }
    if (command === 'voice:upload-chunk') {
      reply(voiceUploadSessions.append(connectionId, data.sessionId, data.sequence, data.dataBase64))
      return
    }
    if (command === 'voice:upload-finish') {
      reply(await voiceUploadSessions.finish(connectionId, data.sessionId))
      return
    }
    if (command === 'voice:upload-cancel') {
      reply(voiceUploadSessions.cancel(connectionId, data.sessionId))
      return
    }
    if (command === 'ping') return

    const retiredCodeChangeCommands = new Set([
      'code-change:submit-description',
      'code-change:accept-plan',
      'code-change:get-plan-revisions',
      'code-change:get-report-for-conversation',
      'code-change:get-status',
      'code-change:push',
      'code-change:undo',
    ])
    if (command.startsWith('self-heal:') || command.startsWith('error-report:') || retiredCodeChangeCommands.has(command)) {
      reply({
        event: 'code-change:removed',
        data: {
          code: 'feature-removed',
          message: 'Code Changes has been removed. Use a normal project conversation or the Git code panel.',
        },
      })
      return
    }

    if (command.startsWith('conversation-mode:')) {
      reply({
        event: 'conversation-mode:error',
        data: {
          code: 'feature-removed',
          message: 'Talk to Project has been removed. Use the microphone in standard chat.',
        },
      })
      return
    }

    debugLog('ws', `command: ${command}`)

    if (command.startsWith('sync:')) {
      try {
        if (handleStandaloneSyncCommand(command, data, reply)) return
      } catch (error) {
        reply({
          event: 'sync:error',
          data: {
            code: 'sync-failed',
            message: error instanceof Error ? error.message : String(error),
          },
        })
        return
      }
    }

    if (command === 'android:log') {
      const tag = typeof data.tag === 'string' ? data.tag : 'Android'
      const message = typeof data.message === 'string' ? data.message : ''
      const ts = typeof data.ts === 'number' ? data.ts : Date.now()
      debugLog('android', `[${tag}] ${message}`)
      console.log(`[android][${tag}] ${message}`)
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('android:log', { tag, message, ts })
      })
      return
    }

    if (command === 'mobile:fcm-token') {
      const deviceId = typeof data.deviceId === 'string' ? data.deviceId : null
      const token = typeof data.token === 'string' ? data.token : null
      if (deviceId && token) {
        const db = getDatabase()
        db.prepare(
          'INSERT OR REPLACE INTO mobile_clients (device_id, fcm_token, registered_at) VALUES (?, ?, ?)'
        ).run(deviceId, token, Date.now())
        // Enable auto-start on first successful pairing if not already set
        if (!isAutoStartEnabled()) {
          setAutoStartEnabled(true)
        }
      }
      return
    }

    if (command === 'mobile:app-foreground') {
      setMobileInForeground(true)
      return
    }

    if (command === 'mobile:app-background') {
      setMobileInForeground(false)
      return
    }

    if (command === 'tool:approve' || command === 'tool:reject') {
      const requestId = typeof data.requestId === 'string' ? data.requestId : ''
      resolveApprovalFn?.(requestId, command === 'tool:approve')
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('tool:approval-resolved', requestId)
      })
      return
    }

    if (command === 'agent:stop') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : undefined
      abortActiveStream(conversationId)
      return
    }

    if (command === 'project-git:list-repos') {
      try {
        const workspaceRoot = typeof data.workspaceRoot === 'string' ? data.workspaceRoot : ''
        if (!workspaceRoot) {
          reply({ event: 'project-git:error', data: { error: 'Missing workspaceRoot' } })
          return
        }
        debugLog('ws', `project-git:list-repos workspaceRoot=${workspaceRoot}`)
        void discoverReposInWorkspace(workspaceRoot).then((repos) => {
          reply({
            event: 'project-git:repos',
            data: { repos: repos.map(r => ({ relativePath: r.relativePath, branch: r.branch, dirty: r.dirty })) },
          })
        }).catch((error) => {
          reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
        })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'chat:user-input-response') {
      const requestId = typeof data.requestId === 'string' ? data.requestId : ''
      const answers = Array.isArray(data.answers) ? data.answers as UserInputAnswer[] : []
      const accepted = resolveUserInputFn?.(requestId, answers) ?? false
      reply({ event: 'chat:user-input-response-result', data: { requestId, accepted } })
      return
    }

    if (command === 'chat:get-pending-user-inputs') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : undefined
      reply({
        event: 'chat:pending-user-inputs',
        data: { requests: getPendingUserInputsFn?.(conversationId) ?? [] },
      })
      return
    }

    if (command === 'project-git:list-repo-files') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        if (!repoRoot) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot' } })
          return
        }
        debugLog('ws', `project-git:list-repo-files repoRoot=${repoRoot}`)
        void listRepoFiles(repoRoot).then((files) => {
          reply({ event: 'project-git:files', data: { files } })
        }).catch((error) => {
          reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
        })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:list-changed-files') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        // Echoed back verbatim — the WS protocol has no built-in request/reply correlation, so
        // async requests fired close together (e.g. a stage action's refresh landing right after
        // the initial repo-selection load) can resolve out of order. The client only trusts the
        // reply matching the most recent `seq` it sent, dropping older ones instead of letting a
        // slow stale reply clobber fresher state.
        const seq = typeof data.seq === 'number' ? data.seq : 0
        if (!repoRoot) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot' } })
          return
        }
        void getChangedFiles(repoRoot).then((files) => {
          reply({ event: 'project-git:changed-files', data: { files, seq } })
        }).catch((error) => {
          reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
        })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    // --- Git housekeeping (backs the Android /code panel) ---

    if (command === 'project-git:list-branches') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        // See the matching comment on 'project-git:list-changed-files' — same stale-reply guard.
        const seq = typeof data.seq === 'number' ? data.seq : 0
        if (!repoRoot) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot' } })
          return
        }
        const branches = await listBranches(repoRoot)
        reply({ event: 'project-git:branches', data: { ...branches, seq } })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:checkout-branch') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        const branchName = typeof data.branchName === 'string' ? data.branchName : ''
        if (!repoRoot || !branchName) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot or branchName' } })
          return
        }
        const result = await checkoutBranch(repoRoot, branchName)
        reply({ event: 'project-git:checked-out', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:new-branch') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        const branchName = typeof data.branchName === 'string' ? data.branchName : ''
        const fromRef = typeof data.fromRef === 'string' ? data.fromRef : undefined
        if (!repoRoot || !branchName) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot or branchName' } })
          return
        }
        const result = await createBranch(repoRoot, branchName, fromRef)
        reply({ event: 'project-git:branch-created', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:fetch') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        const remote = typeof data.remote === 'string' ? data.remote : undefined
        if (!repoRoot) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot' } })
          return
        }
        const result = await fetchRepo(repoRoot, remote)
        reply({ event: 'project-git:fetched', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:merge-branch') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        const sourceBranch = typeof data.sourceBranch === 'string' ? data.sourceBranch : ''
        if (!repoRoot || !sourceBranch) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot or sourceBranch' } })
          return
        }
        const result = await mergeBranch(repoRoot, sourceBranch)
        reply({ event: 'project-git:merged', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:init-repo') {
      try {
        const workspaceRoot = typeof data.workspaceRoot === 'string' ? data.workspaceRoot : ''
        const relativePath = typeof data.relativePath === 'string' ? data.relativePath : undefined
        if (!workspaceRoot) {
          reply({ event: 'project-git:error', data: { error: 'Missing workspaceRoot' } })
          return
        }
        const targetDir = relativePath ? pathModule.join(workspaceRoot, relativePath) : workspaceRoot
        const result = await initRepo(targetDir)
        reply({ event: 'project-git:repo-initialized', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:detect-credentials') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        if (!repoRoot) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot' } })
          return
        }
        const result = await detectGitCredentials(repoRoot)
        reply({ event: 'project-git:credentials', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:pull') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        const remote = typeof data.remote === 'string' ? data.remote : undefined
        if (!repoRoot) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot' } })
          return
        }
        const result = await pullRepo(repoRoot, remote)
        reply({ event: 'project-git:pulled', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:push-branch') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        if (!repoRoot) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot' } })
          return
        }
        const result = await pushRepo(repoRoot)
        reply({ event: 'project-git:branch-pushed', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:commit') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        const message = typeof data.message === 'string' ? data.message : ''
        if (!repoRoot || !message) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot or message' } })
          return
        }
        const result = await commitChanges(repoRoot, message)
        reply({ event: 'project-git:committed', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:discard-file') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        const relativePath = typeof data.relativePath === 'string' ? data.relativePath : ''
        if (!repoRoot || !relativePath) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot or relativePath' } })
          return
        }
        const result = await discardFileChanges(repoRoot, relativePath)
        reply({ event: 'project-git:file-discarded', data: { ...result, relativePath } })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:stash') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        const message = typeof data.message === 'string' ? data.message : undefined
        if (!repoRoot) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot' } })
          return
        }
        const result = await stashChanges(repoRoot, message)
        reply({ event: 'project-git:stashed', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:stash-pop') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        if (!repoRoot) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot' } })
          return
        }
        const result = await stashPop(repoRoot)
        reply({ event: 'project-git:stash-popped', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:stash-count') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        if (!repoRoot) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot' } })
          return
        }
        const count = await getStashCount(repoRoot)
        reply({ event: 'project-git:stash-count', data: { count } })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:delete-branch') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        const branchName = typeof data.branchName === 'string' ? data.branchName : ''
        const deleteRemote = data.deleteRemote === true
        const force = data.force === true
        if (!repoRoot || !branchName) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot or branchName' } })
          return
        }
        const result = await deleteBranch(repoRoot, branchName, { deleteRemote, force })
        reply({ event: 'project-git:branch-deleted', data: { ...result, branchName } })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:file-diff') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        const relativePath = typeof data.relativePath === 'string' ? data.relativePath : ''
        // See the matching comment on 'project-git:list-changed-files' — same stale-reply guard.
        const seq = typeof data.seq === 'number' ? data.seq : 0
        if (!repoRoot || !relativePath) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot or relativePath' } })
          return
        }
        const result = await getFileDiff(repoRoot, relativePath)
        reply({ event: 'project-git:file-diff', data: { ...result, relativePath, seq } })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:stage-files') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        const relativePaths = Array.isArray(data.relativePaths) ? data.relativePaths.filter((p): p is string => typeof p === 'string') : []
        if (!repoRoot || relativePaths.length === 0) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot or relativePaths' } })
          return
        }
        const result = await stageFiles(repoRoot, relativePaths)
        reply({ event: 'project-git:staged', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'project-git:unstage-files') {
      try {
        const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot : ''
        const relativePaths = Array.isArray(data.relativePaths) ? data.relativePaths.filter((p): p is string => typeof p === 'string') : []
        if (!repoRoot || relativePaths.length === 0) {
          reply({ event: 'project-git:error', data: { error: 'Missing repoRoot or relativePaths' } })
          return
        }
        const result = await unstageFiles(repoRoot, relativePaths)
        reply({ event: 'project-git:unstaged', data: result })
      } catch (error) {
        reply({ event: 'project-git:error', data: { error: error instanceof Error ? error.message : String(error) } })
      }
      return
    }

    if (command === 'model:list') {
      let backend = typeof data.backend === 'string' ? data.backend : undefined
      let hermesProfile = typeof data.hermesProfile === 'string' ? data.hermesProfile : undefined
      const agentId = typeof data.agentId === 'string' ? data.agentId : undefined
      if (agentId && (!backend || !hermesProfile)) {
        const db = getDatabase()
        const row = db.prepare(
          "SELECT json_extract(config_json, '$.backend') AS backend, json_extract(config_json, '$.hermesProfile') AS hermesProfile FROM agents WHERE id = ?",
        ).get(agentId) as { backend: string | null; hermesProfile: string | null } | undefined
        backend = backend ?? row?.backend ?? undefined
        hermesProfile = hermesProfile ?? row?.hermesProfile ?? undefined
      }
      const byId = new Map<string, {
        id: string
        label: string
        vendor?: string
        isCliSourced?: boolean
        backend?: string
      }>()
      byId.set('default', { id: 'default', label: 'Default model' })

      const catalogById = new Map(getCachedCatalog().map((model) => [model.id, model]))
      const configuredProviders = PROVIDERS.filter((provider) => isProviderConfigured(provider.name))

      const cliBackendLabels: Record<string, string> = {
        'codex-cli': 'Codex CLI',
        'claude-cli': 'Claude CLI',
        'hermes-cli': 'Hermes Agent',
      }

      if (backend) {
        // Explicit backend requested — return just that source (existing per-chat model picker behaviour)
        const resolvedBackend = backend
        const cliLabel = cliBackendLabels[resolvedBackend]
        const source = cliLabel
          ? { type: 'cli', label: `${cliLabel} models`, backend: resolvedBackend }
          : configuredProviders.length > 0
            ? {
                type: 'provider',
                label: `Configured ${configuredProviders.map((provider) => provider.label).join(', ')} models`,
              }
            : { type: 'none', label: 'No configured model backend' }

        const cliModels = resolvedBackend === 'claude-cli'
          ? getClaudeCliModelChoices().map(({ source: _source, ...model }) => model)
          : getCliModels(resolvedBackend, hermesProfile)
        const models = cliLabel
          ? cliModels.map((model) => ({
              ...model,
              vendor: cliLabel,
              isCliSourced: true,
              backend: resolvedBackend,
            }))
          : configuredProviders
              .flatMap((provider) => getProviderModelIds(provider).map((model) => ({
                id: provider.name === 'azure' ? `azure:${model}` : model,
                label: catalogById.get(model)?.name ?? (provider.name === 'azure' ? `Azure ${model}` : model),
                vendor: provider.label,
              })))

        for (const model of models) {
          if (!byId.has(model.id)) byId.set(model.id, model)
        }
        reply({ event: 'model:list', data: { models: [...byId.values()], source } })
        return
      }

      // No explicit backend — aggregate ALL available sources for the model picker
      if (ClaudeAdapter.isAvailable()) {
        for (const { source: _source, ...model } of getClaudeCliModelChoices()) {
          if (!byId.has(model.id)) byId.set(model.id, {
            ...model,
            vendor: 'Claude CLI',
            isCliSourced: true,
            backend: 'claude-cli',
          })
        }
      }
      if (CodexAdapter.isAvailable()) {
        for (const model of getCliModels('codex-cli')) {
          if (!byId.has(model.id)) byId.set(model.id, {
            ...model,
            vendor: 'Codex CLI',
            isCliSourced: true,
            backend: 'codex-cli',
          })
        }
      }
      if (HermesAdapter.isAvailable()) {
        for (const model of getCliModels('hermes-cli', hermesProfile)) {
          if (!byId.has(model.id)) byId.set(model.id, {
            ...model,
            vendor: 'Hermes Agent',
            isCliSourced: true,
            backend: 'hermes-cli',
          })
        }
      }
      for (const provider of configuredProviders) {
        for (const model of getProviderModelIds(provider)) {
          const id = provider.name === 'azure' ? `azure:${model}` : model
          if (!byId.has(id)) {
            byId.set(id, {
              id,
              label: catalogById.get(model)?.name ?? (provider.name === 'azure' ? `Azure ${model}` : model),
              vendor: provider.label,
            })
          }
        }
      }

      const hasAnySources =
        ClaudeAdapter.isAvailable() || CodexAdapter.isAvailable() || HermesAdapter.isAvailable() || configuredProviders.length > 0
      const sourceLabel = [
        ClaudeAdapter.isAvailable() ? 'Claude CLI' : null,
        CodexAdapter.isAvailable() ? 'Codex CLI' : null,
        HermesAdapter.isAvailable() ? 'Hermes Agent' : null,
        ...configuredProviders.map((p) => p.label),
      ]
        .filter(Boolean)
        .join(', ')
      const source = hasAnySources
        ? { type: 'provider', label: sourceLabel }
        : { type: 'none', label: 'No configured model backend' }

      reply({ event: 'model:list', data: { models: [...byId.values()], source } })
      return
    }

    if (command === 'chat:send-message') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const content = typeof data.content === 'string' ? data.content : ''
      const model = typeof data.model === 'string' ? data.model : undefined
      const agentId = typeof data.agentId === 'string' ? data.agentId : undefined
      const projectId = typeof data.projectId === 'string' ? data.projectId : undefined
      const rawImages = Array.isArray(data.images) ? data.images : []
      const rawAttachments = Array.isArray(data.attachments) ? data.attachments : []
      const pathAttachments = rawAttachments.filter(
        (attachment): attachment is { id: string; name: string; path: string; size: number } =>
          typeof attachment === 'object' && attachment !== null &&
          typeof (attachment as Record<string, unknown>).id === 'string' &&
          typeof (attachment as Record<string, unknown>).name === 'string' &&
          typeof (attachment as Record<string, unknown>).path === 'string' &&
          typeof (attachment as Record<string, unknown>).size === 'number'
      )
      const uploadedAttachments = rawAttachments
        .filter((attachment): attachment is Record<string, unknown> =>
          typeof attachment === 'object' && attachment !== null &&
          typeof (attachment as Record<string, unknown>).dataUrl === 'string'
        )
        .map((attachment) => materializeMobileAttachment(conversationId, attachment))
        .filter((attachment): attachment is MaterializedChatAttachment => attachment !== null)
      const attachments = [...pathAttachments, ...uploadedAttachments]
      const images = rawImages.filter(
        (img): img is { id: string; name: string; dataUrl: string } =>
          typeof img === 'object' && img !== null &&
          typeof (img as Record<string, unknown>).id === 'string' &&
          typeof (img as Record<string, unknown>).name === 'string' &&
          typeof (img as Record<string, unknown>).dataUrl === 'string'
      )
      if (!conversationId || (!content && images.length === 0 && attachments.length === 0)) return
      // Android carries any not-yet-confirmed mode values on the turn itself. This covers both a
      // draft row that does not exist yet and an existing chat whose separate set-mode command is
      // still in flight; dispatchChatSend applies them before resolving the CLI configuration.
      const validEfforts = ['low', 'medium', 'high', 'max', 'disabled']
      const thinkingEffortOverride = 'thinkingEffortOverride' in data
        ? (typeof data.thinkingEffortOverride === 'string' && validEfforts.includes(data.thinkingEffortOverride)
            ? data.thinkingEffortOverride as 'low' | 'medium' | 'high' | 'max' | 'disabled'
            : null)
        : undefined
      const fullAutoApproveOverride = 'fullAutoApproveOverride' in data
        ? (data.fullAutoApproveOverride === true ? true : data.fullAutoApproveOverride === false ? false : null)
        : undefined
      const agenticModeOverride = 'agenticModeOverride' in data
        ? (data.agenticModeOverride === true ? true : data.agenticModeOverride === false ? false : null)
        : undefined
      const terminalSandboxOverride = 'terminalSandboxOverride' in data
        ? (data.terminalSandboxOverride === true ? true : data.terminalSandboxOverride === false ? false : null)
        : undefined
      const validCliModes: string[] = [...CLAUDE_CLI_MODES, ...CODEX_CLI_MODES]
      const cliModeOverride = 'cliModeOverride' in data
        ? (typeof data.cliModeOverride === 'string' && validCliModes.includes(data.cliModeOverride) ? data.cliModeOverride : null)
        : undefined
      const codexExecutionModeOverride = 'codexExecutionModeOverride' in data
        ? (data.codexExecutionModeOverride === 'plan' ? 'plan' as const : null)
        : undefined
      // Deduplicate: Android race-connect can open multiple sockets simultaneously,
      // causing the same chat:send-message to arrive multiple times. Skip if we're
      // already dispatching this conversation.
      if (activeAndroidDispatches.has(conversationId)) {
        debugLog('ws', `chat:send-message duplicate ignored for conv=${conversationId}`)
        return
      }
      const wins = BrowserWindow.getAllWindows()
      if (wins.length === 0) return
      wins[0].webContents.send('chat:remote-message', {
        conversationId,
        content,
        images: images.length > 0 ? images : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      })
      // If the requested model belongs to a CLI backend, tell the dispatcher so it
      // routes through that CLI instead of falling through to a BYOK provider.
      // When Android sends no model or "default", resolve against the desktop's
      // default_model setting so CLI-default setups work correctly.
      let inferredCliBackend: 'codex-cli' | 'claude-cli' | 'hermes-cli' | undefined
      const effectiveModel = (model && model !== 'default')
        ? model
        : (() => {
            const row = getDatabase().prepare("SELECT value FROM settings WHERE key = 'default_model'").get() as { value: string } | undefined
            return row?.value || undefined
          })()
      const routeHermesProfile = typeof data.hermesProfile === 'string'
        ? data.hermesProfile.trim() || undefined
        : (() => {
            const routingDb = getDatabase()
            const row = routingDb.prepare(`
              SELECT c.conversation_hermes_profile, p.project_hermes_profile
              FROM conversations c LEFT JOIN projects p ON p.id = c.project_id
              WHERE c.id = ?
            `).get(conversationId) as { conversation_hermes_profile: string | null; project_hermes_profile: string | null } | undefined
            if (row?.conversation_hermes_profile) return row.conversation_hermes_profile
            if (row?.project_hermes_profile) return row.project_hermes_profile
            return (routingDb.prepare("SELECT value FROM settings WHERE key = 'global_default_hermes_profile'").get() as { value: string } | undefined)?.value || undefined
          })()
      const codexModels = CodexAdapter.isAvailable() ? getCliModels('codex-cli').map((m) => m.id) : []
      const claudeModels = ClaudeAdapter.isAvailable() ? getClaudeCliModelChoices().map((m) => m.id) : []
      const hermesModels = HermesAdapter.isAvailable() ? getCliModels('hermes-cli', routeHermesProfile).map((m) => m.id) : []
      const routeLog = (msg: string): void => {
        debugLog('ws', msg)
        broadcastToMobile({ event: 'android:log', data: { tag: 'WsRoute', message: msg, ts: Date.now() } })
      }
      routeLog(`chat:send model=${model ?? 'none'} effectiveModel=${effectiveModel ?? 'none'}`)
      routeLog(`codexAvail=${CodexAdapter.isAvailable()} codexModels=[${codexModels.join(',')}]`)
      routeLog(`claudeAvail=${ClaudeAdapter.isAvailable()} claudeModels=[${claudeModels.join(',')}]`)
      routeLog(`hermesAvail=${HermesAdapter.isAvailable()} hermesModels=[${hermesModels.join(',')}]`)
      if (effectiveModel && effectiveModel !== 'default') {
        if (CodexAdapter.isAvailable() && codexModels.some((id) => id === effectiveModel)) {
          inferredCliBackend = 'codex-cli'
        } else if (ClaudeAdapter.isAvailable() && isClaudeCliModelOrCandidate(effectiveModel)) {
          inferredCliBackend = 'claude-cli'
        } else if (HermesAdapter.isAvailable() && hermesModels.some((id) => id === effectiveModel)) {
          inferredCliBackend = 'hermes-cli'
        }
      }
      routeLog(`inferredCliBackend=${inferredCliBackend ?? 'none'}`)
      activeAndroidDispatches.add(conversationId)
      void dispatchChatSend(wins[0], conversationId, content, {
        model,
        hermesProfile: typeof data.hermesProfile === 'string' ? data.hermesProfile : undefined,
        agentId,
        projectId,
        images: images.length > 0 ? images : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        cliBackend: inferredCliBackend,
        thinkingEffortOverride,
        fullAutoApproveOverride,
        agenticModeOverride,
        terminalSandboxOverride,
        cliModeOverride,
        codexExecutionModeOverride,
      })
        ?.then(() => { activeAndroidDispatches.delete(conversationId) })
        ?.catch((err: unknown) => {
          activeAndroidDispatches.delete(conversationId)
          const message = err instanceof Error ? err.message : 'Unexpected error'
          broadcastToMobile({ event: 'chat:activity', data: { conversationId, state: 'error', label: message } })
          broadcastToMobile({ event: 'chat:stream-end', data: { conversationId } })
          // Notify the renderer so it clears the generating spinner for this conversation
          if (!wins[0].isDestroyed()) wins[0].webContents.send('chat:activity-global', { conversationId, state: 'error', label: message })
        })
      return
    }

    const db = getDatabase()

    if (command === 'android:update-manifest') {
      void getAndroidUpdateManifest(db).then((manifest) => reply({ event: 'android:update-manifest', data: manifest }))
      return
    }

    if (command === 'conversation:list') {
      const rows = db.prepare(`
          SELECT c.id, c.title, c.created_at, c.updated_at,
            c.agent_id,
            c.model,
            c.conversation_hermes_profile,
            c.pinned,
            c.archived,
            c.completed_at,
            c.thinking_effort_override,
            c.full_auto_approve_override,
            c.agentic_mode_override,
            c.terminal_sandbox_override,
            c.cli_mode_override,
            c.codex_execution_mode_override,
            c.kind,
            json_extract(a.config_json, '$.name') AS agent_name,
            json_extract(a.config_json, '$.icon') AS agent_icon,
            c.project_id,
            p.name AS project_name,
            cr.rating AS rating,
            (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) AS last_message
          FROM conversations c
          LEFT JOIN agents a ON c.agent_id = a.id
          LEFT JOIN projects p ON c.project_id = p.id
          LEFT JOIN conversation_ratings cr ON cr.conversation_id = c.id
          WHERE c.archived = 0 AND c.kind != 'project-conversation-mode'
          ORDER BY c.pinned DESC, c.updated_at DESC
          LIMIT 50
        `).all()
      reply({ event: 'conversation:list', data: rows })
      return
    }

    if (command === 'chat:get-emergency-stop') {
      reply({ event: 'chat:emergency-stop-changed', data: getEmergencyStopStatus() })
      return
    }

    if (command === 'chat:activate-emergency-stop') {
      reply({ event: 'chat:emergency-stop-changed', data: activateEmergencyStop() })
      return
    }

    if (command === 'chat:resume-conversations') {
      reply({ event: 'chat:emergency-stop-changed', data: resumeConversations() })
      return
    }

    if (command === 'conversation:list-page') {
      const page = listConversationPage(
        db,
        data as ConversationPageRequest,
        `c.id, c.title, c.created_at, c.updated_at,
          c.agent_id, c.model, c.pinned, c.archived, c.completed_at,
          c.conversation_hermes_profile,
          c.thinking_effort_override, c.full_auto_approve_override,
          c.agentic_mode_override, c.terminal_sandbox_override,
          c.cli_mode_override, c.codex_execution_mode_override, c.kind,
          json_extract(a.config_json, '$.name') AS agent_name,
          json_extract(a.config_json, '$.icon') AS agent_icon,
          c.project_id, p.name AS project_name, cr.rating AS rating,
          (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) AS last_message`,
      )
      reply({ event: 'conversation:list-page', data: page })
      return
    }

    if (command === 'conversation:set-model') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const model = typeof data.model === 'string' && data.model !== 'default' ? data.model : null
      const hermesProfile = model && data.cliBackend === 'hermes-cli' && typeof data.hermesProfile === 'string'
        ? data.hermesProfile.trim() || null
        : null
      if (!conversationId) return
      if ('cliBackend' in data || 'hermesProfile' in data) {
        db.prepare('UPDATE conversations SET model = ?, conversation_hermes_profile = ?, cli_backend = ?, updated_at = ? WHERE id = ?').run(model, hermesProfile, typeof data.cliBackend === 'string' && data.cliBackend ? data.cliBackend : null, Date.now(), conversationId)
      } else {
        db.prepare('UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?').run(model, Date.now(), conversationId)
      }
      reply({ event: 'conversation:model-updated', data: { conversationId, model, ...(('cliBackend' in data || 'hermesProfile' in data) ? { hermesProfile } : {}) } })
      return
    }

    if (command === 'conversation:set-mode') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      // Only the field(s) actually present in the payload are touched — see the matching
      // Electron-IPC handler in conversation-handlers.ts for why this can't just default to null.
      const existing = db
        .prepare('SELECT thinking_effort_override, full_auto_approve_override, agentic_mode_override, terminal_sandbox_override, cli_mode_override, codex_execution_mode_override FROM conversations WHERE id = ?')
        .get(conversationId) as { thinking_effort_override: string | null; full_auto_approve_override: number | null; agentic_mode_override: number | null; terminal_sandbox_override: number | null; cli_mode_override: string | null; codex_execution_mode_override: string | null } | undefined
      const validEfforts = ['low', 'medium', 'high', 'max', 'disabled']
      const thinkingEffortOverride = 'thinkingEffortOverride' in data
        ? (typeof data.thinkingEffortOverride === 'string' && validEfforts.includes(data.thinkingEffortOverride) ? data.thinkingEffortOverride : null)
        : (existing?.thinking_effort_override ?? null)
      const fullAutoApproveOverride = 'fullAutoApproveOverride' in data
        ? (data.fullAutoApproveOverride === true ? 1 : data.fullAutoApproveOverride === false ? 0 : null)
        : (existing?.full_auto_approve_override ?? null)
      const agenticModeOverride = 'agenticModeOverride' in data
        ? (data.agenticModeOverride === true ? 1 : data.agenticModeOverride === false ? 0 : null)
        : (existing?.agentic_mode_override ?? null)
      const terminalSandboxOverride = 'terminalSandboxOverride' in data
        ? (data.terminalSandboxOverride === true ? 1 : data.terminalSandboxOverride === false ? 0 : null)
        : (existing?.terminal_sandbox_override ?? null)
      // Untrusted Android payload — validate against the known CLI mode families (either backend's
      // values live in the single cli_mode_override column) before persisting; anything else clears it.
      const validCliModes: string[] = [...CLAUDE_CLI_MODES, ...CODEX_CLI_MODES]
      const cliModeOverride = 'cliModeOverride' in data
        ? (typeof data.cliModeOverride === 'string' && validCliModes.includes(data.cliModeOverride) ? data.cliModeOverride : null)
        : (existing?.cli_mode_override ?? null)
      const codexExecutionModeOverride = 'codexExecutionModeOverride' in data
        ? (data.codexExecutionModeOverride === 'plan' ? 'plan' : null)
        : (existing?.codex_execution_mode_override ?? null)
      db.prepare(
        'UPDATE conversations SET thinking_effort_override = ?, full_auto_approve_override = ?, agentic_mode_override = ?, terminal_sandbox_override = ?, cli_mode_override = ?, codex_execution_mode_override = ?, updated_at = ? WHERE id = ?'
      ).run(thinkingEffortOverride, fullAutoApproveOverride, agenticModeOverride, terminalSandboxOverride, cliModeOverride, codexExecutionModeOverride, Date.now(), conversationId)
      if (cliModeOverride === 'bypassPermissions') approveConversationApprovalsFn?.(conversationId)
      broadcastToMobile({ event: 'conversation:mode-updated', data: { conversationId, thinkingEffortOverride, fullAutoApproveOverride, agenticModeOverride, terminalSandboxOverride, cliModeOverride, codexExecutionModeOverride } })
      return
    }

    // Capability activation can target a chat, project, or agent. The profile contains IDs and
    // approval policy only; MCP secrets and desktop connection details never cross the WebSocket.
    if (command === 'conversation:get-capabilities') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      try {
        reply({ event: 'conversation:capabilities', data: { conversationId, profile: getConversationCapabilityProfile(db, conversationId) } })
      } catch (error) {
        reply({ event: 'capabilities:error', data: { conversationId, message: error instanceof Error ? error.message : 'Conversation not found' } })
      }
      return
    }

    if (command === 'capabilities:resolve') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      try {
        reply({ event: 'capabilities:preflight', data: resolveConversationCapabilities(db, conversationId, typeof data.modelId === 'string' ? data.modelId : null) })
      } catch (error) {
        reply({ event: 'capabilities:error', data: { conversationId, message: error instanceof Error ? error.message : 'Could not resolve capabilities' } })
      }
      return
    }

    if (command === 'capabilities:activate') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      try {
        const skillIds = Array.isArray(data.skillIds) ? data.skillIds.filter((id): id is string => typeof id === 'string') : []
        const mcp = Array.isArray(data.mcp)
          ? data.mcp.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return []
            const row = entry as { serverId?: unknown; trust?: unknown }
            if (typeof row.serverId !== 'string') return []
            const trust: CapabilityTrust = row.trust === 'auto' || row.trust === 'block' || row.trust === 'always-ask' ? row.trust : 'always-ask'
            return [{ serverId: row.serverId, trust }]
          })
          : []
        const scope = data.scope === 'project' || data.scope === 'agent' ? data.scope : 'chat'
        const targetId = typeof data.targetId === 'string' ? data.targetId : undefined
        const profile = activateConversationCapabilities(db, conversationId, { scope, targetId, skillIds, mcp })
        reply({ event: 'capabilities:activated', data: { conversationId, profile } })
      } catch (error) {
        reply({ event: 'capabilities:error', data: { conversationId, message: error instanceof Error ? error.message : 'Could not activate capabilities' } })
      }
      return
    }

    // Project settings is the authoritative editor for project-scoped capabilities. Unlike the
    // chat-sheet activation shortcut, this replaces the complete profile so an administrator can
    // revoke a skill or MCP grant for every chat in the project.
    if (command === 'project:get-capabilities') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : typeof data.id === 'string' ? data.id : ''
      if (!projectId) return
      try {
        reply({ event: 'project:capabilities', data: { projectId, profile: getProjectCapabilityProfile(db, projectId) } })
      } catch (error) {
        reply({ event: 'project:capabilities-error', data: { projectId, message: error instanceof Error ? error.message : 'Project not found' } })
      }
      return
    }

    if (command === 'project:set-capabilities') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : typeof data.id === 'string' ? data.id : ''
      if (!projectId) return
      try {
        const profile = normalizeCapabilityProfile(data.profile)
        assertCapabilityProfileValid(profile)
        const saved = setProjectCapabilityProfile(db, projectId, profile)
        reply({ event: 'project:capabilities-updated', data: { projectId, profile: saved } })
        broadcastToMobile({ event: 'project:config-changed', data: { id: projectId, config: readProjectConfig(db, projectId) } })
      } catch (error) {
        reply({ event: 'project:capabilities-error', data: { projectId, message: error instanceof Error ? error.message : 'Could not save project capabilities' } })
      }
      return
    }

    if (command === 'project:list') {
      const rows = db.prepare(`
          SELECT p.id, p.name, p.color, p.default_model, p.project_hermes_profile,
            (SELECT COUNT(*) FROM conversations
             WHERE project_id = p.id AND archived = 0 AND kind != 'project-conversation-mode') AS chat_count,
            (SELECT GROUP_CONCAT(NULLIF(json_extract(a.config_json, '$.icon'), ''), ',')
             FROM project_agents pa JOIN agents a ON pa.agent_id = a.id
             WHERE pa.project_id = p.id
             ORDER BY pa.sort_order ASC) AS agent_icons,
            NULLIF(json_extract(p.config_json, '$.rootDirectory'), '') AS root_directory
          FROM projects p ORDER BY p.name ASC
        `).all()
      reply({ event: 'project:list', data: { projects: rows } })
      return
    }

    if (command === 'conversation:get-messages') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const requestedLimit = typeof data.limit === 'number' ? Math.floor(data.limit) : null
      // Bounded history is opt-in, so desktop and older clients keep their full snapshot.
      if (requestedLimit != null && requestedLimit > 0) {
        const limit = Math.min(requestedLimit, 100)
        const beforeTimestamp = typeof data.beforeTimestamp === 'number' ? data.beforeTimestamp : null
        const beforeId = typeof data.beforeId === 'string' ? data.beforeId : null
        const descendingRows = beforeTimestamp != null && beforeId != null
          ? db.prepare(
`SELECT id, role, content, model, attachments, timestamp, timeline_order, thinking_blocks, text_segments, user_inputs, citations FROM messages
               WHERE conversation_id = ? AND (timestamp < ? OR (timestamp = ? AND id < ?))
               ORDER BY timestamp DESC, id DESC LIMIT ?`
          ).all(conversationId, beforeTimestamp, beforeTimestamp, beforeId, limit + 1)
          : db.prepare(
            `SELECT id, role, content, model, attachments, timestamp, timeline_order, thinking_blocks, text_segments, user_inputs, citations FROM messages
               WHERE conversation_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?`
          ).all(conversationId, limit + 1)
        const hasMore = descendingRows.length > limit
        const page = (hasMore ? descendingRows.slice(0, limit) : descendingRows).reverse()
        const oldest = page[0] as { id: string; timestamp: number } | undefined
        const requestId = typeof data.requestId === 'string' ? data.requestId : ''
        const historyVersion = createHash('sha256').update(JSON.stringify(page)).digest('hex')
        const responseMode = data.responseMode === 'chunked-v2' ? 'chunked-v2' : 'single'
        if (
          beforeTimestamp == null &&
          typeof data.historyVersion === 'string' &&
          data.historyVersion === historyVersion
        ) {
          reply({
            event: 'conversation:history-not-modified',
            data: { conversationId, requestId, historyVersion, hasMore },
          })
          return
        }
        if (responseMode === 'chunked-v2') {
          const chunks: unknown[][] = []
          let pending: unknown[] = []
          let pendingBytes = 0
          // Stream the newest content first. Older chunks are prepended by Android while
          // preserving the user's scroll position.
          for (let index = page.length - 1; index >= 0; index -= 1) {
            const row = page[index]
            const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8')
            if (pending.length > 0 && (pending.length >= 10 || pendingBytes + rowBytes > 128 * 1024)) {
              chunks.push(pending.reverse())
              pending = []
              pendingBytes = 0
            }
            pending.push(row)
            pendingBytes += rowBytes
          }
          if (pending.length > 0) chunks.push(pending.reverse())
          reply({
            event: 'conversation:history-start',
            data: {
              conversationId,
              requestId,
              totalItems: page.length,
              chunkCount: chunks.length,
              historyVersion,
            },
          })
          chunks.forEach((messages, chunkIndex) => {
            reply({
              event: 'conversation:history-chunk',
              data: {
                conversationId,
                requestId,
                messages,
                chunkIndex,
                chunkCount: chunks.length,
                paged: true,
              },
            })
          })
          reply({
            event: 'conversation:history-complete',
            data: {
              conversationId,
              requestId,
              historyVersion,
              hasMore,
              nextBeforeTimestamp: oldest?.timestamp ?? null,
              nextBeforeId: oldest?.id ?? null,
            },
          })
          return
        }
        reply({ event: 'conversation:messages', data: {
          conversationId, requestId, messages: page, paged: true, hasMore, historyVersion,
          nextBeforeTimestamp: oldest?.timestamp ?? null, nextBeforeId: oldest?.id ?? null,
        } })
        return
      }
      const rows = db.prepare(
        `SELECT id, role, content, model, attachments, timestamp, timeline_order, thinking_blocks, text_segments, user_inputs, citations FROM messages
           WHERE conversation_id = ? ORDER BY timeline_order ASC, timestamp ASC, id ASC`
      ).all(conversationId)
      reply({ event: 'conversation:messages', data: { conversationId, messages: rows } })
      return
    }

    if (command === 'agent:list') {
      const rows = db.prepare(
        `SELECT id,
          json_extract(config_json, '$.name') AS name,
          json_extract(config_json, '$.icon') AS icon,
          json_extract(config_json, '$.backend') AS backend,
          json_extract(config_json, '$.cliModel') AS cli_model
         FROM agents ORDER BY created_at ASC`
      ).all()
      reply({ event: 'agent:list', data: { agents: rows } })
      return
    }

    if (command === 'conversation:create') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : null
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const title = typeof data.title === 'string' ? data.title : 'New Chat'
      const id = randomUUID()
      const now = Date.now()
      db.prepare(
        `INSERT INTO conversations (id, agent_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, agentId, projectId, title, now, now)
      reply({ event: 'conversation:created', data: { id, agentId, projectId, title } })
      return
    }

    if (command === 'conversation:rename') {
      const id = typeof data.id === 'string' ? data.id : ''
      const title = typeof data.title === 'string' ? data.title : ''
      if (!id || !title) return
      db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id)
      broadcastToMobile({ event: 'conversation:renamed', data: { id, title } })
      return
    }

    if (command === 'conversation:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
      broadcastToMobile({ event: 'conversation:deleted', data: { id } })
      return
    }

    if (command === 'conversation:search') {
      const query = typeof data.query === 'string' ? data.query.trim() : ''
      const rows = query
        ? db.prepare(`
            SELECT DISTINCT c.id, c.title, c.created_at, c.updated_at,
              c.agent_id, c.model,
              json_extract(a.config_json, '$.name') AS agent_name,
              json_extract(a.config_json, '$.icon') AS agent_icon,
              c.project_id, p.name AS project_name,
              (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) AS last_message
            FROM conversations c
            LEFT JOIN messages m ON m.conversation_id = c.id
            LEFT JOIN agents a ON c.agent_id = a.id
            LEFT JOIN projects p ON c.project_id = p.id
            WHERE c.archived = 0 AND (c.title LIKE ? OR m.content LIKE ?)
            ORDER BY c.updated_at DESC
          `).all(`%${query}%`, `%${query}%`)
        : db.prepare(`
            SELECT c.id, c.title, c.created_at, c.updated_at,
              c.agent_id, c.model,
              json_extract(a.config_json, '$.name') AS agent_name,
              json_extract(a.config_json, '$.icon') AS agent_icon,
              c.project_id, p.name AS project_name,
              (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) AS last_message
            FROM conversations c
            LEFT JOIN agents a ON c.agent_id = a.id
            LEFT JOIN projects p ON c.project_id = p.id
            WHERE c.archived = 0
            ORDER BY c.updated_at DESC
          `).all()
      reply({ event: 'conversation:search-results', data: { conversations: rows } })
      return
    }

    if (command === 'message:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      db.prepare('DELETE FROM messages WHERE id = ?').run(id)
      reply({ event: 'message:deleted', data: { id } })
      return
    }

    if (command === 'project:create') {
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      const color = normalizeProjectColor(data.color) ?? 'blue'
      if (!name) return
      const id = randomUUID()
      const now = Date.now()
      db.prepare(
        'INSERT INTO projects (id, name, color, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, name, color, JSON.stringify({}), now, now)
      broadcastToMobile({ event: 'project:created', data: { project: { id, name, color, chat_count: 0, agent_icons: null } } })
      return
    }

    if (command === 'project:rename') {
      const id = typeof data.id === 'string' ? data.id : ''
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      const color = normalizeProjectColor(data.color)
      if (!id || !name) return
      if (color) {
        db.prepare('UPDATE projects SET name = ?, color = ?, updated_at = ? WHERE id = ?').run(name, color, Date.now(), id)
      } else {
        db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id)
      }
      broadcastToMobile({ event: 'project:renamed', data: { id, name, ...(color ? { color } : {}) } })
      return
    }

    if (command === 'project:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const deleteChats = data.deleteChats === true
      if (deleteChats) {
        db.prepare('DELETE FROM conversations WHERE project_id = ?').run(id)
      }
      db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      broadcastToMobile({ event: 'project:deleted', data: { id } })
      return
    }

    if (command === 'project:update-config') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const existing = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(id) as { config_json: string | null } | undefined
      const current = { ...parseProjectConfig(existing?.config_json ?? null) } as Record<string, unknown>
      const patch: Record<string, unknown> = {}
      if (typeof data.instructions === 'string') patch.instructions = data.instructions
      if (typeof data.rootDirectory === 'string') patch.rootDirectory = data.rootDirectory
      if (Array.isArray(data.variables)) patch.variables = data.variables
      if (typeof data.workflowMode === 'string' && ['single-agent', 'automated-delegation', 'manual-delegation', 'orchestrated'].includes(data.workflowMode)) {
        patch.workflowMode = data.workflowMode === 'manual-delegation' ? 'automated-delegation' : data.workflowMode
        patch.orchestrationEnabled = data.workflowMode === 'orchestrated'
      } else if (typeof data.orchestrationEnabled === 'boolean') {
        patch.orchestrationEnabled = data.orchestrationEnabled
        patch.workflowMode = data.orchestrationEnabled ? 'orchestrated' : 'single-agent'
      }
      if (typeof data.maxDelegationDepth === 'number') patch.maxDelegationDepth = Math.max(1, Math.min(10, data.maxDelegationDepth))
      if (typeof data.showTeamActivity === 'boolean') patch.showTeamActivity = data.showTeamActivity
      if (typeof data.defaultModel === 'string') {
        const defaultModel = data.defaultModel.trim() || null
        patch.defaultModel = defaultModel
        db.prepare('UPDATE projects SET default_model = ?, updated_at = ? WHERE id = ?')
          .run(defaultModel, Date.now(), id)
      }
      if ('projectHermesProfile' in data) {
        const projectHermesProfile = typeof data.projectHermesProfile === 'string' ? data.projectHermesProfile.trim() || null : null
        const targetModel = typeof data.defaultModel === 'string'
          ? data.defaultModel.trim() || null
          : (db.prepare('SELECT default_model FROM projects WHERE id = ?').get(id) as { default_model: string | null } | undefined)?.default_model
        patch.projectHermesProfile = projectHermesProfile
        db.prepare('UPDATE projects SET project_hermes_profile = ?, updated_at = ? WHERE id = ?')
          .run(targetModel ? projectHermesProfile : null, Date.now(), id)
      }
      if ('defaultThinkingEffort' in data) {
        const requestedThinkingEffort = typeof data.defaultThinkingEffort === 'string'
          ? data.defaultThinkingEffort.trim()
          : ''
        patch.defaultThinkingEffort = ['low', 'medium', 'high', 'max', 'disabled'].includes(requestedThinkingEffort)
          ? requestedThinkingEffort
          : null
      }
      if (typeof data.instructionMode === 'string') patch.instructionMode = data.instructionMode
      if (typeof data.instructionsEnabled === 'boolean') patch.instructionsEnabled = data.instructionsEnabled
      if (Array.isArray(data.inScope)) patch.inScope = data.inScope
      if (Array.isArray(data.outOfScope)) patch.outOfScope = data.outOfScope
      if (Array.isArray(data.milestones)) patch.milestones = data.milestones
      if (typeof data.terminalSandboxBypass === 'boolean') patch.terminalSandboxBypass = data.terminalSandboxBypass
      const merged = { ...current, ...patch }
      if (typeof patch.rootDirectory === 'string') {
        merged.workspaceInfo = detectProjectWorkspaceMetadata(patch.rootDirectory)
        setPrimarySourcePath(db, id, patch.rootDirectory)
      }
      const hierarchy = listProjectSources(db, id)
      Object.assign(merged, hierarchy, { rootDirectory: primarySourcePath(hierarchy) || merged.rootDirectory })
      db.prepare('UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), Date.now(), id)
      broadcastToMobile({ event: 'project:config-updated', data: { id, config: parseProjectConfig(JSON.stringify(merged)) } })
      return
    }

    if (command === 'project:remove-repository' || command === 'project:rescan-sources') {
      const id = typeof data.id === 'string' ? data.id : ''
      const repositoryId = typeof data.repositoryId === 'string' ? data.repositoryId : ''
      if (!id || (command === 'project:remove-repository' && !repositoryId)) return
      try {
        const hierarchy = command === 'project:remove-repository'
          ? removeProjectRepository(db, id, repositoryId)
          : await rescanProjectSources(db, id)
        const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(id) as
          { config_json: string | null } | undefined
        if (!row) throw new Error('Project not found')
        const config = {
          ...parseProjectConfig(row.config_json),
          ...hierarchy,
          rootDirectory: primarySourcePath(hierarchy),
        }
        db.prepare('UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(config), Date.now(), id)
        broadcastToMobile({ event: 'project:config-changed', data: { id, config } })
        reply({
          event: 'project:sources-updated',
          data: { id, action: command === 'project:remove-repository' ? 'remove' : 'rescan', config },
        })
      } catch (error) {
        reply({
          event: 'project:sources-error',
          data: {
            id,
            action: command === 'project:remove-repository' ? 'remove' : 'rescan',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      }
      return
    }

    if (command === 'project:add-source') {
      const id = typeof data.id === 'string' ? data.id : ''
      const localPath = typeof data.localPath === 'string' ? data.localPath.trim() : ''
      if (!id || !localPath) return
      try {
        const hierarchy = await addProjectSource(db, id, { localPath })
        const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(id) as
          { config_json: string | null } | undefined
        if (!row) throw new Error('Project not found')
        const config = {
          ...parseProjectConfig(row.config_json),
          ...hierarchy,
          rootDirectory: primarySourcePath(hierarchy),
        }
        db.prepare('UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(config), Date.now(), id)
        broadcastToMobile({ event: 'project:config-changed', data: { id, config } })
        reply({ event: 'project:sources-updated', data: { id, action: 'add', config } })
      } catch (error) {
        reply({
          event: 'project:sources-error',
          data: { id, action: 'add', message: error instanceof Error ? error.message : String(error) },
        })
      }
      return
    }

    if (command === 'fs:list-directory') {
      const path = typeof data.path === 'string' ? data.path : ''
      const result = listDirectoryEntriesForRemote(path, getFsAuthorizedRoots())
      reply({ event: 'fs:list-directory', data: { path, ...result } })
      return
    }

    if (command === 'fs:read-file') {
      const path = typeof data.path === 'string' ? data.path : ''
      const requestId = typeof data.requestId === 'string' ? data.requestId : undefined
      const result = readFileForRemote(path, getFsAuthorizedRoots())
      reply({ event: 'fs:file-content', data: { ...result, requestId } })
      return
    }

    // Image previews use a dedicated command so a stale or partially upgraded desktop cannot
    // accidentally route a raster request through the Markdown-only reader.
    if (command === 'fs:read-image') {
      const path = typeof data.path === 'string' ? data.path : ''
      const requestId = typeof data.requestId === 'string' ? data.requestId : undefined
      const result = isRemoteImagePath(path)
        ? readImageFileForRemote(path, getFsAuthorizedRoots())
        : {
            path,
            content: '',
            truncated: false,
            mimeType: 'application/octet-stream',
            encoding: 'base64' as const,
            error: 'Only raster image files can be viewed in the image viewer',
          }
      reply({ event: 'fs:file-content', data: { ...result, requestId } })
      return
    }

    if (command === 'fs:get-start-roots') {
      reply({ event: 'fs:get-start-roots', data: getFsStartRoots() })
      return
    }

    // Project Peek is intentionally separate from the generic remote explorer. Android sends
    // stable project/source identifiers and source-relative paths only; native desktop paths
    // never cross this protocol boundary.
    if (command === 'project-peek:get-sources') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      const hierarchy = projectId ? listProjectSources(db, projectId) : { sources: [] }
      const sources: ProjectPeekSource[] = hierarchy.sources
        .filter((source) => source.enabled)
        .map((source) => ({
          id: source.id, projectId: source.projectId, label: source.label,
          localPath: source.localPath, enabled: source.enabled, isPrimary: source.isPrimary,
        }))
      reply({ event: 'project-peek:sources', data: {
        projectId,
        // localPath is deliberately not part of the mobile payload.
        sources: sources.map(({ localPath: _localPath, ...source }) => source),
      } })
      return
    }

    if (command === 'project-peek:list-directory') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      const sourceId = typeof data.sourceId === 'string' ? data.sourceId : ''
      const relativePath = typeof data.relativePath === 'string' ? data.relativePath : ''
      const filter = ['all', 'documents', 'images', 'recent'].includes(String(data.filter))
        ? data.filter as ProjectPeekFilter : 'all'
      const source = projectId ? listProjectSources(db, projectId).sources
        .find((candidate) => candidate.id === sourceId && candidate.enabled) : undefined
      const result = source
        ? listProjectPeekDirectory(source, relativePath, filter)
        : { entries: [], truncated: false, error: 'This project source is not available' }
      reply({ event: 'project-peek:directory', data: { projectId, sourceId, relativePath, filter, ...result } })
      return
    }

    if (command === 'project-peek:read-file') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      const sourceId = typeof data.sourceId === 'string' ? data.sourceId : ''
      const relativePath = typeof data.relativePath === 'string' ? data.relativePath : ''
      const requestId = typeof data.requestId === 'string' ? data.requestId : undefined
      const source = projectId ? listProjectSources(db, projectId).sources
        .find((candidate) => candidate.id === sourceId && candidate.enabled) : undefined
      const path = source ? resolveProjectPeekPath(source.localPath, relativePath) : null
      const result = path && source
        ? readFileForRemote(path, [source.localPath])
        : { path: '', content: '', truncated: false, error: 'This project file is not available' }
      reply({ event: 'project-peek:file-content', data: {
        projectId, sourceId, relativePath, requestId,
        content: result.content, truncated: result.truncated, error: result.error,
        // Project Peek identifies images from the directory entry; the bounded file reader
        // deliberately keeps its text response contract narrow.
        encoding: isRemoteImagePath(relativePath) ? 'base64' : 'utf8',
      } })
      return
    }

    // Invisible sub-resource fetches issued by the HTML preview WebView's request interceptor
    // (shouldInterceptRequest) — never a user-initiated "open this file" action, so this is kept
    // as its own command rather than overloading project-peek:read-file (see file-handlers.ts's
    // readAssetFileForRemote for the tighter size cap and distinct extension allowlist).
    if (command === 'project-peek:read-asset') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      const sourceId = typeof data.sourceId === 'string' ? data.sourceId : ''
      const relativePath = typeof data.relativePath === 'string' ? data.relativePath : ''
      const requestId = typeof data.requestId === 'string' ? data.requestId : undefined
      const source = projectId ? listProjectSources(db, projectId).sources
        .find((candidate) => candidate.id === sourceId && candidate.enabled) : undefined
      const path = source ? resolveProjectPeekPath(source.localPath, relativePath) : null
      const result = path && source
        ? readAssetFileForRemote(path, [source.localPath])
        : { path: '', content: '', truncated: false, mimeType: '', encoding: 'base64' as const, error: 'This project asset is not available' }
      reply({ event: 'project-peek:asset-content', data: {
        projectId, sourceId, relativePath, requestId,
        content: result.content, truncated: result.truncated, error: result.error,
        mimeType: result.mimeType, encoding: result.encoding,
      } })
      return
    }

    if (command === 'chat:get-active-turn') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      reply({
        event: 'chat:active-turn-snapshot',
        data: {
          conversationId,
          snapshot: getActiveChatTurnSnapshot(conversationId),
        },
      })
      return
    }

    if (command === 'project:get-config') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(id) as
        { config_json: string | null } | undefined
      const defaultModelRow = db.prepare('SELECT default_model, project_hermes_profile FROM projects WHERE id = ?').get(id) as
        { default_model: string | null; project_hermes_profile: string | null } | undefined
      const parsed = parseProjectConfig(row?.config_json ?? null)
      ensureLegacyProjectSource(db, id, parsed.rootDirectory)
      const hierarchy = listProjectSources(db, id)
      const config = { ...parsed, ...hierarchy, rootDirectory: primarySourcePath(hierarchy) || parsed.rootDirectory, defaultModel: defaultModelRow?.default_model ?? null, projectHermesProfile: defaultModelRow?.project_hermes_profile ?? null }
      reply({ event: 'project:config', data: { id, config } })
      return
    }

    if (command === 'project-audit:list-sessions') {
      const projectId = typeof data.projectId === 'string'
        ? data.projectId
        : data.projectId === null
          ? null
          : undefined
      reply({ event: 'project-audit:sessions', data: { projectId: projectId ?? null, sessions: listProjectAuditSessions(projectId) } })
      return
    }

    if (command === 'project-audit:list-files') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : ''
      if (!sessionId) return
      reply({ event: 'project-audit:files', data: { sessionId, files: listProjectAuditFiles(sessionId) } })
      return
    }

    if (command === 'project-audit:get-diff') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : ''
      const relativePath = typeof data.relativePath === 'string' ? data.relativePath : ''
      const fileId = typeof data.fileId === 'string' ? data.fileId : null
      if (!sessionId || !relativePath) return
      reply({ event: 'project-audit:diff', data: { sessionId, fileId, diff: getProjectAuditDiff(sessionId, relativePath, fileId) } })
      return
    }

    if (command === 'project:list-agents') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const rows = db.prepare(
        'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC'
      ).all(id) as { agent_id: string; config_json: string; is_primary: number; sort_order: number }[]
      const agents = rows.map((r) => {
        const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string }
        return { agentId: r.agent_id, agentName: cfg.name ?? '', agentIcon: cfg.icon ?? '', isPrimary: r.is_primary === 1, sortOrder: r.sort_order }
      })
      reply({ event: 'project:agents', data: { id, agents } })
      return
    }

    if (command === 'project:add-agent') {
      const id = typeof data.id === 'string' ? data.id : ''
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!id || !agentId) return
      db.prepare('INSERT OR IGNORE INTO project_agents (project_id, agent_id, is_primary, sort_order, added_at) VALUES (?, ?, 0, 0, ?)').run(id, agentId, Date.now())
      const rows = db.prepare(
        'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC'
      ).all(id) as { agent_id: string; config_json: string; is_primary: number; sort_order: number }[]
      const agents = rows.map((r) => {
        const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string }
        return { agentId: r.agent_id, agentName: cfg.name ?? '', agentIcon: cfg.icon ?? '', isPrimary: r.is_primary === 1, sortOrder: r.sort_order }
      })
      reply({ event: 'project:agents', data: { id, agents } })
      return
    }

    if (command === 'project:remove-agent') {
      const id = typeof data.id === 'string' ? data.id : ''
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!id || !agentId) return
      db.prepare('DELETE FROM project_agents WHERE project_id = ? AND agent_id = ?').run(id, agentId)
      const rows = db.prepare(
        'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC'
      ).all(id) as { agent_id: string; config_json: string; is_primary: number; sort_order: number }[]
      const agents = rows.map((r) => {
        const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string }
        return { agentId: r.agent_id, agentName: cfg.name ?? '', agentIcon: cfg.icon ?? '', isPrimary: r.is_primary === 1, sortOrder: r.sort_order }
      })
      reply({ event: 'project:agents', data: { id, agents } })
      return
    }

    if (command === 'project:set-primary-agent') {
      const id = typeof data.id === 'string' ? data.id : ''
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!id || !agentId) return
      const setPrimary = db.transaction(() => {
        db.prepare('UPDATE project_agents SET is_primary = 0 WHERE project_id = ?').run(id)
        db.prepare('UPDATE project_agents SET is_primary = 1 WHERE project_id = ? AND agent_id = ?').run(id, agentId)
      })
      setPrimary()
      const rows = db.prepare(
        'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC'
      ).all(id) as { agent_id: string; config_json: string; is_primary: number; sort_order: number }[]
      const agents = rows.map((r) => {
        const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string }
        return { agentId: r.agent_id, agentName: cfg.name ?? '', agentIcon: cfg.icon ?? '', isPrimary: r.is_primary === 1, sortOrder: r.sort_order }
      })
      reply({ event: 'project:agents', data: { id, agents } })
      return
    }

    if (command === 'project:reorder-agents') {
      const id = typeof data.id === 'string' ? data.id : ''
      const agentIds = Array.isArray(data.agentIds) ? data.agentIds.filter((agentId): agentId is string => typeof agentId === 'string') : []
      if (!id || agentIds.length === 0) return
      const update = db.prepare('UPDATE project_agents SET sort_order = ? WHERE project_id = ? AND agent_id = ?')
      const reorder = db.transaction(() => {
        agentIds.forEach((agentId, index) => update.run(index, id, agentId))
      })
      reorder()
      const rows = db.prepare(
        'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC, pa.added_at ASC'
      ).all(id) as { agent_id: string; config_json: string; is_primary: number; sort_order: number }[]
      const agents = rows.map((r) => {
        const cfg = JSON.parse(r.config_json) as { name?: string; icon?: string }
        return { agentId: r.agent_id, agentName: cfg.name ?? '', agentIcon: cfg.icon ?? '', isPrimary: r.is_primary === 1, sortOrder: r.sort_order }
      })
      reply({ event: 'project:agents', data: { id, agents } })
      return
    }

    if (command === 'agent:create') {
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      const icon = typeof data.icon === 'string' ? data.icon : ''
      if (!name) return
      const id = randomUUID()
      const now = Date.now()
      const config = {
        id, name, icon, systemPrompt: '', temperature: 0.7, maxTokens: 8192,
        mcpServers: [], agenticMode: false, responseFormat: 'default',
        tools: {
          fileEdit: { enabled: true, approval: 'always-ask' },
          terminal: { enabled: false, approval: 'always-ask' },
          webFetch: { enabled: true, approval: 'auto' },
        },
      }
      db.prepare(
        'INSERT INTO agents (id, config_json, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)'
      ).run(id, JSON.stringify(config), now, now)
      broadcastToMobile({ event: 'agent:created', data: { agent: { id, name, icon } } })
      return
    }

    if (command === 'agent:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      const icon = typeof data.icon === 'string' ? data.icon : ''
      if (!id || !name) return
      const existing = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(id) as { config_json: string } | undefined
      if (!existing) return
      const prev = JSON.parse(existing.config_json) as Record<string, unknown>
      const patch: Record<string, unknown> = { name, icon }
      if (typeof data.systemPrompt === 'string') patch.systemPrompt = data.systemPrompt
      if (data.backend === '' || typeof data.backend === 'string') patch.backend = data.backend || undefined
      if (typeof data.cliModel === 'string') patch.cliModel = data.cliModel
      if (data.hermesProfile === '' || typeof data.hermesProfile === 'string') patch.hermesProfile = data.hermesProfile || undefined
      if (typeof data.temperature === 'number') patch.temperature = data.temperature
      if (typeof data.maxTokens === 'number') patch.maxTokens = data.maxTokens
      if (['default', 'concise', 'detailed', 'code-only'].includes(data.responseFormat as string)) patch.responseFormat = data.responseFormat
      if (typeof data.agenticMode === 'boolean') patch.agenticMode = data.agenticMode
      if (typeof data.memory === 'string') patch.memory = data.memory
      if (data.tools && typeof data.tools === 'object') patch.tools = { ...(prev.tools as object), ...(data.tools as object) }
      if (Array.isArray(data.mcpServers)) patch.mcpServers = data.mcpServers
      if (typeof data.thinkingEffort === 'string') patch.thinkingEffort = data.thinkingEffort || undefined
      if (typeof data.rootDirectory === 'string') patch.rootDirectory = data.rootDirectory || undefined
      if (Array.isArray(data.contextDirectories)) patch.contextDirectories = data.contextDirectories
      if (Array.isArray(data.contextFiles)) patch.contextFiles = data.contextFiles
      if (data.contextRules && typeof data.contextRules === 'object') patch.contextRules = data.contextRules
      if (Array.isArray(data.customCommands)) patch.customCommands = data.customCommands
      const config = { ...prev, ...patch }
      db.prepare('UPDATE agents SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(config), Date.now(), id)
      broadcastToMobile({ event: 'agent:updated', data: { agent: { id, name, icon } } })
      return
    }

    if (command === 'agent:get-full') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const row = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(id) as { config_json: string } | undefined
      if (!row) return
      const config = JSON.parse(row.config_json) as Record<string, unknown>
      reply({ event: 'agent:full', data: { agent: config } })
      return
    }

    if (command === 'agent:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      db.prepare('UPDATE conversations SET agent_id = NULL WHERE agent_id = ?').run(id)
      db.prepare('DELETE FROM agents WHERE id = ?').run(id)
      broadcastToMobile({ event: 'agent:deleted', data: { id } })
      return
    }

    if (command === 'provider:get-configured') {
      const providers = PROVIDERS.map((p) => ({
        id: p.name,
        label: p.label,
        configured: isProviderConfigured(p.name),
      }))
      reply({ event: 'provider:list', data: { providers } })
      return
    }

    if (command === 'provider:set-key') {
      const provider = typeof data.provider === 'string' ? data.provider : ''
      const key = typeof data.key === 'string' ? data.key : ''
      if (!provider || !key) return
      storeApiKey(provider, key)
      reply({ event: 'provider:key-set', data: { provider } })
      return
    }

    if (command === 'provider:remove-key') {
      const provider = typeof data.provider === 'string' ? data.provider : ''
      if (!provider) return
      removeApiKey(provider)
      reply({ event: 'provider:key-removed', data: { provider } })
      return
    }

    if (command === 'provider:key-handoff-request') {
      const provider = typeof data.provider === 'string' ? data.provider : ''
      if (!provider) return
      // Notify desktop's renderer windows so a human can approve or decline sending the
      // key — the value itself is never sent from here. Approval flows through the
      // 'provider:key-handoff-confirm' IPC handler in providers.ts, triggered only by an
      // explicit "Send Key" click in ProvidersTab.tsx.
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('provider:key-handoff-request', { provider })
      })
      return
    }

    if (command === 'app:cli-status') {
      // Android is a companion and cannot run `hermes` locally, so the profile list +
      // ACP readiness ride along with the CLI-status reply for the Hermes profile picker.
      const [readiness, clis] = await Promise.all([hermesAcpReadiness(), detectAllClis()])
      reply({
        event: 'app:cli-status',
        data: {
          clis,
          hermes: {
            profiles: listHermesProfiles(),
            profileDiscovery: getHermesProfileDiscovery(),
            acpReady: readiness.ready,
            version: readiness.version ?? null,
            acpStatus: readiness.status ?? null,
            acpDetail: readiness.detail ?? null,
          },
        },
      })
      return
    }

    if (command === 'app:set-setting') {
      const key = typeof data.key === 'string' ? data.key : ''
      const value = typeof data.value === 'string' ? data.value : ''
      if (!key) return
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
      applyLifecycleSetting(key, value)
      reply({ event: 'app:setting-set', data: { key, value } })
      return
    }

    if (command === 'app:get-setting') {
      const key = typeof data.key === 'string' ? data.key : ''
      if (!key) return
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
      reply({ event: 'app:setting-value', data: { key, value: row?.value ?? null } })
      return
    }

    // Compatibility aliases used by older Android builds for the desktop-owned model setting.
    // The canonical transport is app:get-setting/app:set-setting, but keeping these replies
    // makes the companion upgrade-safe while both clients are in the field.
    if (command === 'settings:get-default-desktop-model') {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'default_model'").get() as { value: string } | undefined
      reply({ event: 'app:setting-value', data: { key: 'defaultDesktopModel', value: row?.value ?? null } })
      return
    }

    if (command === 'settings:set-default-desktop-model') {
      const model = typeof data.modelId === 'string' ? data.modelId : ''
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('default_model', ?)").run(model)
      reply({ event: 'app:setting-set', data: { key: 'defaultDesktopModel', value: model } })
      return
    }

    if (command === 'mcp:list') {
      const servers = getMcpServersForCompanion()
      reply({ event: 'mcp:list', data: { servers } })
      return
    }

    if (command === 'mcp:catalog') {
      // This is deliberately the hand-curated catalog only. Registry results and user
      // credentials never cross the companion connection as part of this payload.
      reply({ event: 'mcp:catalog', data: { entries: MCP_CATALOG } })
      return
    }

    if (command === 'mcp:search-registry') {
      const query = typeof data.query === 'string' ? data.query : ''
      void searchMcpRegistry(query).then((result) => {
        reply({ event: 'mcp:registry-results', data: result })
      }).catch((error) => {
        reply({ event: 'mcp:registry-error', data: { message: error instanceof Error ? error.message : 'Could not reach the MCP Registry' } })
      })
      return
    }

    if (command === 'mcp:add') {
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      const description = typeof data.description === 'string' ? data.description.trim() : undefined
      const command2 = typeof data.command === 'string' ? data.command.trim() : ''
      if (!name || !command2) return
      const args = Array.isArray(data.args) ? (data.args as string[]) : []
      const cwd = typeof data.cwd === 'string' ? data.cwd : undefined
      const imageResponses = data.imageResponses === 'allow' || data.imageResponses === 'omit' ? data.imageResponses : undefined
      const enabled = typeof data.enabled === 'boolean' ? data.enabled : true
      const sandboxProfile = normalizeMcpSandboxProfile(data.sandboxProfile)
      // Environment secrets are desktop-owned. Android can create a server, but it
      // cannot inject or overwrite the encrypted env map through the companion link.
      void addMcpServer({ name, description, command: command2, args, env: {}, cwd, imageResponses, sandboxProfile, enabled }).then((server) => {
        const s = getMcpServerStatus(server.id)
        const safeServer = getMcpServersForCompanion().find((entry) => entry.id === server.id)
        if (!safeServer) return
        const payload = { ...safeServer, status: s.status, toolCount: s.tools.length }
        broadcastToMobile({ event: 'mcp:server-added', data: { server: payload } })
        reply({ event: 'mcp:server-added', data: { server: payload } })
      })
      return
    }

    if (command === 'mcp:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const updates: Record<string, unknown> = {}
      if (typeof data.name === 'string') updates.name = data.name
      if (typeof data.description === 'string') updates.description = data.description
      if (typeof data.command === 'string') updates.command = data.command
      if (Array.isArray(data.args)) updates.args = data.args
      if (typeof data.cwd === 'string') updates.cwd = data.cwd || undefined
      if (typeof data.enabled === 'boolean') updates.enabled = data.enabled
      if (data.imageResponses === 'allow' || data.imageResponses === 'omit') updates.imageResponses = data.imageResponses
      if (data.sandboxProfile && typeof data.sandboxProfile === 'object') updates.sandboxProfile = normalizeMcpSandboxProfile(data.sandboxProfile)
      void updateMcpServer(id, updates).then((server) => {
        if (!server) return
        const s = getMcpServerStatus(id)
        const safeServer = getMcpServersForCompanion().find((entry) => entry.id === server.id)
        if (!safeServer) return
        const payload = { ...safeServer, status: s.status, toolCount: s.tools.length }
        broadcastToMobile({ event: 'mcp:server-updated', data: { server: payload } })
        reply({ event: 'mcp:server-updated', data: { server: payload } })
      })
      return
    }

    if (command === 'mcp:remove') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      void removeMcpServer(id).then(() => {
        broadcastToMobile({ event: 'mcp:server-removed', data: { id } })
        reply({ event: 'mcp:server-removed', data: { id } })
      })
      return
    }

    if (command === 'mcp:restart') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      void restartMcpServer(id).then(() => {
        const s = getMcpServerStatus(id)
        reply({ event: 'mcp:server-status', data: { id, status: s.status, error: s.error ?? null, toolCount: s.tools.length, sandbox: s.sandbox ?? null } })
      })
      return
    }

    if (command === 'mcp:get-status') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const status = getMcpServerStatus(id)
      reply({ event: 'mcp:server-status', data: { id, status: status.status, error: status.error ?? null, toolCount: status.tools.length, sandbox: status.sandbox ?? null } })
      return
    }

    if (command === 'mcp:list-tools') {
      const serverIds = Array.isArray(data.serverIds) ? (data.serverIds as string[]) : undefined
      const tools = listMcpTools(serverIds)
      reply({ event: 'mcp:tools', data: { tools } })
      return
    }

    if (command === 'mcp:list-tools-for-agent') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!agentId) return
      const tools = listMcpToolsForAgent(agentId)
      reply({ event: 'mcp:tools', data: { agentId, tools } })
      return
    }

    if (command === 'mcp:test') {
      const command2 = typeof data.command === 'string' ? data.command.trim() : ''
      const args = Array.isArray(data.args) ? data.args as string[] : []
      const cwd = typeof data.cwd === 'string' ? data.cwd : undefined
      const imageResponses = data.imageResponses === 'allow' || data.imageResponses === 'omit' ? data.imageResponses : undefined
      const sandboxProfile = normalizeMcpSandboxProfile(data.sandboxProfile)
      void testMcpServer({ command: command2, args, env: {}, cwd, imageResponses, sandboxProfile }).then((result) => {
        reply({ event: 'mcp:test-result', data: result })
      })
      return
    }

    if (command === 'wiki:extract-from-conversation') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      if (!conversationId || !projectId) return
      void extractWikiLearningsForWs(conversationId, projectId)
        .then((result) => {
          reply({ event: 'wiki:extraction-candidates', data: { conversationId, candidates: result.candidates } })
        })
        .catch((err: unknown) => {
          reply({ event: 'wiki:extraction-error', data: { message: String(err) } })
        })
      return
    }

    if (command === 'agent:list-knowledge-files') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!agentId) return
      const files = db.prepare('SELECT * FROM agent_knowledge_files WHERE agent_id = ? ORDER BY sort_order ASC, created_at ASC').all(agentId)
      reply({ event: 'agent:knowledge-files', data: { agentId, files } })
      return
    }

    if (command === 'agent:add-knowledge-file') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const filePath = typeof data.filePath === 'string' ? data.filePath : ''
      const injectMode = typeof data.injectMode === 'string' ? data.injectMode : 'always'
      if (!agentId || !filePath) return
      const id = randomUUID()
      const now = Date.now()
      const maxRow = db.prepare('SELECT MAX(sort_order) as m FROM agent_knowledge_files WHERE agent_id = ?').get(agentId) as { m: number | null }
      db.prepare('INSERT INTO agent_knowledge_files (id, agent_id, file_path, inject_mode, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, agentId, filePath, injectMode, (maxRow.m ?? -1) + 1, now, now)
      const file = db.prepare('SELECT * FROM agent_knowledge_files WHERE id = ?').get(id)
      reply({ event: 'agent:knowledge-file-added', data: { agentId, file } })
      return
    }

    if (command === 'agent:remove-knowledge-file') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const id = typeof data.id === 'string' ? data.id : ''
      if (!agentId || !id) return
      db.prepare('DELETE FROM agent_knowledge_files WHERE id = ? AND agent_id = ?').run(id, agentId)
      reply({ event: 'agent:knowledge-file-removed', data: { agentId, id } })
      return
    }

    if (command === 'agent:read-knowledge-file') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const filePath = typeof data.filePath === 'string' ? data.filePath : ''
      if (!agentId || !filePath) return
      try {
        const row = db.prepare('SELECT id FROM agent_knowledge_files WHERE agent_id = ? AND file_path = ?').get(agentId, filePath)
        if (!row) { reply({ event: 'agent:knowledge-file-error', data: { message: 'File not registered for this agent' } }); return }
        if (!existsSync(filePath)) { reply({ event: 'agent:knowledge-file-error', data: { message: `File not found: ${filePath}` } }); return }
        const content = readFileSync(filePath, 'utf-8')
        reply({ event: 'agent:knowledge-file-content', data: { agentId, filePath, content } })
      } catch (err) {
        reply({ event: 'agent:knowledge-file-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'agent:write-knowledge-file') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const filePath = typeof data.filePath === 'string' ? data.filePath : ''
      const content = typeof data.content === 'string' ? data.content : ''
      if (!agentId || !filePath) return
      try {
        const row = db.prepare('SELECT id FROM agent_knowledge_files WHERE agent_id = ? AND file_path = ?').get(agentId, filePath)
        if (!row) { reply({ event: 'agent:knowledge-file-error', data: { message: 'File not registered for this agent' } }); return }
        writeFileSync(filePath, content, 'utf-8')
        db.prepare('UPDATE agent_knowledge_files SET updated_at = ? WHERE agent_id = ? AND file_path = ?').run(Date.now(), agentId, filePath)
        reply({ event: 'agent:knowledge-file-saved', data: { agentId, filePath } })
      } catch (err) {
        reply({ event: 'agent:knowledge-file-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'agent:get-mcp-tool-overrides') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!agentId) return
      const overrides = db.prepare('SELECT * FROM agent_mcp_tool_overrides WHERE agent_id = ?').all(agentId)
      reply({ event: 'agent:mcp-tool-overrides', data: { agentId, overrides } })
      return
    }

    if (command === 'agent:set-mcp-tool-override') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const serverId = typeof data.serverId === 'string' ? data.serverId : ''
      const toolName = typeof data.toolName === 'string' ? data.toolName : ''
      const enabled = typeof data.enabled === 'boolean' ? data.enabled : true
      const approval = typeof data.approval === 'string' ? data.approval : 'always-ask'
      const instructions = typeof data.instructions === 'string' ? data.instructions : ''
      if (!agentId || !serverId || !toolName) return
      db.prepare('INSERT OR REPLACE INTO agent_mcp_tool_overrides (agent_id, server_id, tool_name, enabled, approval, instructions) VALUES (?, ?, ?, ?, ?, ?)').run(agentId, serverId, toolName, enabled ? 1 : 0, approval, instructions)
      const overrides = db.prepare('SELECT * FROM agent_mcp_tool_overrides WHERE agent_id = ?').all(agentId)
      reply({ event: 'agent:mcp-tool-overrides', data: { agentId, overrides } })
      return
    }

    if (command === 'agent:get-mcp-server-trust') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!agentId) return
      const trust = db.prepare('SELECT server_id, trust FROM agent_mcp_server_trust WHERE agent_id = ?').all(agentId)
      reply({ event: 'agent:mcp-server-trust', data: { agentId, trust } })
      return
    }

    if (command === 'agent:set-mcp-server-trust') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const serverId = typeof data.serverId === 'string' ? data.serverId : ''
      const trust = typeof data.trust === 'string' ? data.trust : 'auto'
      if (!agentId || !serverId) return
      db.prepare('INSERT OR REPLACE INTO agent_mcp_server_trust (agent_id, server_id, trust) VALUES (?, ?, ?)').run(agentId, serverId, trust)
      const trustList = db.prepare('SELECT server_id, trust FROM agent_mcp_server_trust WHERE agent_id = ?').all(agentId)
      reply({ event: 'agent:mcp-server-trust', data: { agentId, trust: trustList } })
      return
    }

    if (command === 'skill:list') {
      reply({ event: 'skill:list', data: { skills: listSkillConfigsForTransport() } })
      return
    }

    if (command === 'skill:discover') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      reply({ event: 'skill:discover', data: { skills: await discoverSkills(projectId) } })
      return
    }

    if (command === 'skill:get') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      reply({ event: 'skill:detail', data: { skill: getSkillConfigForTransport(id) } })
      return
    }

    if (command === 'skill:create') {
      const skill = createSkillConfig(data as Partial<SkillConfig>)
      broadcastToMobile({ event: 'skill:created', data: { skill: skillForTransport(skill) } })
      return
    }

    if (command === 'skill:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const skill = updateSkillConfig(id, data as Partial<SkillConfig>)
      broadcastToMobile({ event: 'skill:updated', data: { skill: skillForTransport(skill) } })
      return
    }

    if (command === 'skill:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      deleteSkillConfig(id)
      broadcastToMobile({ event: 'skill:deleted', data: { id } })
      return
    }

    if (command === 'skill:duplicate') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const skill = duplicateSkillConfig(id)
      reply({ event: 'skill:duplicated', data: { skill: skill ? skillForTransport(skill) : null } })
      if (skill) broadcastToMobile({ event: 'skill:created', data: { skill: skillForTransport(skill) } })
      return
    }

    if (command === 'skill:export') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const skill = getSkillConfigForTransport(id)
      reply({ event: 'skill:exported', data: { skill } })
      return
    }

    if (command === 'skill:import') {
      const rawSkill = (typeof data.skill === 'object' && data.skill !== null ? data.skill : data) as Partial<SkillConfig>
      const skill = createSkillConfig(rawSkill)
      broadcastToMobile({ event: 'skill:created', data: { skill: skillForTransport(skill) } })
      return
    }

    if (command === 'skill:import-discovered') {
      const requested = typeof data.discovery === 'object' && data.discovery !== null
        ? data.discovery as { packagePath?: unknown }
        : null
      const packagePath = typeof requested?.packagePath === 'string' ? requested.packagePath : ''
      if (!packagePath) {
        reply({ event: 'skill:discovery-error', data: { message: 'The discovered skill package path is missing.' } })
        return
      }
      // Resolve the package from a fresh scan instead of trusting an arbitrary path supplied by
      // the companion. This also handles a package that was removed or changed after scanning.
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      const discovery = (await discoverSkills(projectId)).find((item) => item.packagePath === packagePath)
      if (!discovery || discovery.importable === false) {
        reply({ event: 'skill:discovery-error', data: { message: 'That skill is no longer available or cannot be read.' } })
        return
      }
      try {
        const skill = importDiscoveredSkill(discovery, {})
        if (!skill) {
          reply({ event: 'skill:discovery-error', data: { message: 'The skill could not be imported.' } })
          return
        }
        broadcastToMobile({ event: 'skill:created', data: { skill: skillForTransport(skill) } })
      } catch (error) {
        reply({ event: 'skill:discovery-error', data: { message: error instanceof Error ? error.message : 'The skill could not be imported.' } })
      }
      return
    }

    if (command === 'skill:get-agent-links') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      if (!agentId) return
      reply({ event: 'skill:agent-links', data: { agentId, links: getSkillAgentLinks(agentId) } })
      return
    }

    if (command === 'skill:attach-to-agent') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const skillId = typeof data.skillId === 'string' ? data.skillId : ''
      const attach = data.attach !== false
      if (!agentId || !skillId) return
      setSkillAgentAttachment(agentId, skillId, attach)
      broadcastToMobile({ event: 'skill:agent-links', data: { agentId, links: getSkillAgentLinks(agentId) } })
      return
    }

    if (command === 'skill:reorder-for-agent') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : ''
      const skillIds = Array.isArray(data.skillIds) ? (data.skillIds as unknown[]).filter((id): id is string => typeof id === 'string') : []
      if (!agentId) return
      reorderSkillsForAgent(agentId, skillIds)
      broadcastToMobile({ event: 'skill:agent-links', data: { agentId, links: getSkillAgentLinks(agentId) } })
      return
    }

    if (command === 'skill:get-agent-usage') {
      reply({ event: 'skill:agent-usage', data: { usage: getSkillAgentUsage() } })
      return
    }

    if (command === 'artifact:list') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const rows = projectId
        ? (db.prepare('SELECT id, project_id, title, kind, description, storage_root, status, current_version_id, created_at, updated_at FROM artifacts WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as Record<string, unknown>[])
        : (db.prepare('SELECT id, project_id, title, kind, description, storage_root, status, current_version_id, created_at, updated_at FROM artifacts ORDER BY updated_at DESC LIMIT 50').all() as Record<string, unknown>[])
      const artifacts = rows.map((r) => ({
        id: String(r.id),
        projectId: r.project_id != null ? String(r.project_id) : null,
        title: String(r.title),
        kind: String(r.kind),
        description: r.description != null ? String(r.description) : null,
        storageRoot: r.storage_root != null ? String(r.storage_root) : null,
        status: String(r.status),
        currentVersionId: r.current_version_id != null ? String(r.current_version_id) : null,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      }))
      reply({ event: 'artifact:list', data: { artifacts } })
      return
    }

    if (command === 'artifact:get') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const r = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!r) {
        reply({ event: 'artifact:detail', data: { artifactId: id, artifact: null } })
        return
      }
      const currentVersionId = r.current_version_id != null ? String(r.current_version_id) : null
      let currentVersion = null
      if (currentVersionId) {
        const vRow = db.prepare('SELECT * FROM artifact_versions WHERE id = ?').get(currentVersionId) as Record<string, unknown> | undefined
        if (vRow) {
          const fileRows = db.prepare('SELECT id, version_id, relative_path, media_type, absolute_path, role FROM artifact_files WHERE version_id = ?').all(currentVersionId) as Record<string, unknown>[]
          currentVersion = {
            id: String(vRow.id),
            artifactId: String(vRow.artifact_id),
            versionNumber: Number(vRow.version_number),
            title: String(vRow.title),
            notes: vRow.notes != null ? String(vRow.notes) : null,
            createdAt: Number(vRow.created_at),
            files: fileRows.map((f) => ({
              id: String(f.id),
              relativePath: String(f.relative_path),
              absolutePath: String(f.absolute_path),
              mediaType: String(f.media_type),
              role: String(f.role),
            })),
          }
        }
      }
      reply({
        event: 'artifact:detail',
        data: {
          artifactId: id,
          artifact: {
            id: String(r.id),
            projectId: r.project_id != null ? String(r.project_id) : null,
            title: String(r.title),
            kind: String(r.kind),
            description: r.description != null ? String(r.description) : null,
            storageRoot: r.storage_root != null ? String(r.storage_root) : null,
            status: String(r.status),
            currentVersionId,
            createdAt: Number(r.created_at),
            updatedAt: Number(r.updated_at),
            currentVersion,
          },
        },
      })
      return
    }

    if (command === 'artifact:list-versions') {
      const artifactId = typeof data.artifactId === 'string' ? data.artifactId : ''
      if (!artifactId) return
      const rows = db.prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version_number DESC').all(artifactId) as Record<string, unknown>[]
      const versions = rows.map((vRow) => {
        const versionId = String(vRow.id)
        const fileRows = db.prepare('SELECT id, version_id, relative_path, media_type, absolute_path, role FROM artifact_files WHERE version_id = ?').all(versionId) as Record<string, unknown>[]
        return {
          id: versionId,
          artifactId: String(vRow.artifact_id),
          versionNumber: Number(vRow.version_number),
          title: String(vRow.title),
          notes: vRow.notes != null ? String(vRow.notes) : null,
          createdAt: Number(vRow.created_at),
          files: fileRows.map((f) => ({
            id: String(f.id),
            relativePath: String(f.relative_path),
            absolutePath: String(f.absolute_path),
            mediaType: String(f.media_type),
            role: String(f.role),
          })),
        }
      })
      reply({ event: 'artifact:versions', data: { artifactId, versions } })
      return
    }

    if (command === 'artifact:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const info = db.prepare('DELETE FROM artifacts WHERE id = ?').run(id)
      broadcastToMobile({ event: 'artifact:deleted', data: { id, deleted: info.changes > 0 } })
      const rows = db.prepare('SELECT id, project_id, title, kind, description, storage_root, status, current_version_id, created_at, updated_at FROM artifacts ORDER BY updated_at DESC LIMIT 50').all() as Record<string, unknown>[]
      reply({
        event: 'artifact:list',
        data: {
          artifacts: rows.map((r) => ({
            id: String(r.id),
            projectId: r.project_id != null ? String(r.project_id) : null,
            title: String(r.title),
            kind: String(r.kind),
            description: r.description != null ? String(r.description) : null,
            storageRoot: r.storage_root != null ? String(r.storage_root) : null,
            status: String(r.status),
            currentVersionId: r.current_version_id != null ? String(r.current_version_id) : null,
            createdAt: Number(r.created_at),
            updatedAt: Number(r.updated_at),
          })),
        },
      })
      return
    }

    if (command === 'artifact:delete-version') {
      const versionId = typeof data.versionId === 'string' ? data.versionId : ''
      if (!versionId) return
      try {
        const result = deleteArtifactVersion(versionId)
        reply({ event: 'artifact:version-deleted', data: { versionId, deleted: result.deleted, artifactId: result.artifactId ?? null } })
        const artifactId = result.artifactId
        if (artifactId) {
          const versionRows = db.prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version_number DESC').all(artifactId) as Record<string, unknown>[]
          const versions = versionRows.map((vRow) => {
            const vId = String(vRow.id)
            const fileRows = db.prepare('SELECT id, version_id, relative_path, media_type, absolute_path, role FROM artifact_files WHERE version_id = ?').all(vId) as Record<string, unknown>[]
            return {
              id: vId,
              artifactId: String(vRow.artifact_id),
              versionNumber: Number(vRow.version_number),
              title: String(vRow.title),
              notes: vRow.notes != null ? String(vRow.notes) : null,
              createdAt: Number(vRow.created_at),
              files: fileRows.map((f) => ({
                id: String(f.id),
                relativePath: String(f.relative_path),
                absolutePath: String(f.absolute_path),
                mediaType: String(f.media_type),
                role: String(f.role),
              })),
            }
          })
          reply({ event: 'artifact:versions', data: { artifactId, versions } })

          const aRow = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId) as Record<string, unknown> | undefined
          if (aRow) {
            const currentVersionId = aRow.current_version_id != null ? String(aRow.current_version_id) : null
            let currentVersion = null
            if (currentVersionId) {
              const vRow = db.prepare('SELECT * FROM artifact_versions WHERE id = ?').get(currentVersionId) as Record<string, unknown> | undefined
              if (vRow) {
                const fileRows = db.prepare('SELECT id, version_id, relative_path, media_type, absolute_path, role FROM artifact_files WHERE version_id = ?').all(currentVersionId) as Record<string, unknown>[]
                currentVersion = {
                  id: String(vRow.id),
                  artifactId: String(vRow.artifact_id),
                  versionNumber: Number(vRow.version_number),
                  title: String(vRow.title),
                  notes: vRow.notes != null ? String(vRow.notes) : null,
                  createdAt: Number(vRow.created_at),
                  files: fileRows.map((f) => ({
                    id: String(f.id),
                    relativePath: String(f.relative_path),
                    absolutePath: String(f.absolute_path),
                    mediaType: String(f.media_type),
                    role: String(f.role),
                  })),
                }
              }
            }
            reply({
              event: 'artifact:detail',
              data: {
                artifactId,
                artifact: {
                  id: String(aRow.id),
                  projectId: aRow.project_id != null ? String(aRow.project_id) : null,
                  title: String(aRow.title),
                  kind: String(aRow.kind),
                  description: aRow.description != null ? String(aRow.description) : null,
                  storageRoot: aRow.storage_root != null ? String(aRow.storage_root) : null,
                  status: String(aRow.status),
                  currentVersionId,
                  createdAt: Number(aRow.created_at),
                  updatedAt: Number(aRow.updated_at),
                  currentVersion,
                },
              },
            })
          }
        }
      } catch (err) {
        reply({ event: 'artifact:version-delete-error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'artifact:export') {
      const versionId = typeof data.versionId === 'string' ? data.versionId : ''
      if (!versionId) return
      try {
        const vRow = db.prepare('SELECT * FROM artifact_versions WHERE id = ?').get(versionId) as Record<string, unknown> | undefined
        if (!vRow) { reply({ event: 'artifact:export-error', data: { message: 'Version not found' } }); return }
        const fileRows = db.prepare('SELECT id, relative_path, media_type, absolute_path, role FROM artifact_files WHERE version_id = ?').all(versionId) as Record<string, unknown>[]
        if (fileRows.length === 0) { reply({ event: 'artifact:export-error', data: { message: 'No files found for this version' } }); return }
        const files = fileRows
          .filter((f) => existsSync(String(f.absolute_path)))
          .map((f) => ({
            relativePath: String(f.relative_path),
            mediaType: String(f.media_type),
            contentBase64: readFileSync(String(f.absolute_path)).toString('base64'),
          }))
        if (files.length === 0) { reply({ event: 'artifact:export-error', data: { message: 'Artifact files not found on disk' } }); return }
        reply({ event: 'artifact:export-pack', data: { versionId, files } })
      } catch (err) {
        reply({ event: 'artifact:export-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'wiki:list') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      if (!projectId) return
      const rows = db.prepare('SELECT * FROM project_wiki_entries WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as Record<string, unknown>[]
      const entries = rows.map((r) => ({
        id: String(r.id),
        projectId: String(r.project_id),
        title: String(r.title),
        body: String(r.body),
        tags: (() => { try { return JSON.parse(String(r.tags)) as string[] } catch { return [] } })(),
        sourceConversationId: r.source_conversation_id != null ? String(r.source_conversation_id) : null,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      }))
      reply({ event: 'wiki:list', data: { entries } })
      return
    }

    if (command === 'wiki:create') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      const title = typeof data.title === 'string' ? data.title.trim() : ''
      const body = typeof data.body === 'string' ? data.body : ''
      const tags = Array.isArray(data.tags) ? (data.tags as string[]) : []
      if (!projectId || !title) return
      const entry = insertWikiEntry(db, projectId, title, body, tags)
      broadcastToMobile({ event: 'wiki:entry-created', data: { entry: { ...entry, projectId: entry.project_id, sourceConversationId: entry.source_conversation_id, createdAt: entry.created_at, updatedAt: entry.updated_at } } })
      return
    }

    if (command === 'wiki:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const fields: Record<string, unknown> = {}
      if (typeof data.title === 'string') fields.title = data.title
      if (typeof data.body === 'string') fields.body = data.body
      if (Array.isArray(data.tags)) fields.tags = data.tags as string[]
      const now = Date.now()
      const row = db.prepare('SELECT * FROM project_wiki_entries WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!row) return
      const title = fields.title !== undefined ? String(fields.title).slice(0, 200) : String(row.title)
      const body = fields.body !== undefined ? String(fields.body) : String(row.body)
      const tags = fields.tags !== undefined ? JSON.stringify(fields.tags) : String(row.tags)
      db.prepare('UPDATE project_wiki_entries SET title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?').run(title, body, tags, now, id)
      const updated = db.prepare('SELECT * FROM project_wiki_entries WHERE id = ?').get(id) as Record<string, unknown>
      broadcastToMobile({ event: 'wiki:entry-updated', data: { entry: { id: String(updated.id), projectId: String(updated.project_id), title: String(updated.title), body: String(updated.body), tags: (() => { try { return JSON.parse(String(updated.tags)) as string[] } catch { return [] } })(), sourceConversationId: updated.source_conversation_id != null ? String(updated.source_conversation_id) : null, createdAt: Number(updated.created_at), updatedAt: Number(updated.updated_at) } } })
      return
    }

    if (command === 'wiki:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      db.prepare('DELETE FROM project_wiki_entries WHERE id = ?').run(id)
      broadcastToMobile({ event: 'wiki:entry-deleted', data: { id } })
      return
    }

    if (command === 'prompt:list') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      type PromptRow = { id: string; title: string; body: string; description: string; category: string; tags: string; scope: string; project_id: string | null; created_at: number; updated_at: number }
      const rows = db.prepare(
        `SELECT * FROM prompt_library_entries ORDER BY category COLLATE NOCASE ASC, updated_at DESC`
      ).all() as PromptRow[]
      const visibleRows = rows.filter((row) => isPromptVisibleForProject(row, projectId))
      const entries = visibleRows.map((r) => ({
        id: r.id, title: r.title, body: r.body, description: r.description, category: r.category,
        tags: (() => { try { return JSON.parse(r.tags) as string[] } catch { return [] } })(),
        scope: r.scope, projectId: r.project_id, createdAt: r.created_at, updatedAt: r.updated_at,
      }))
      reply({ event: 'prompt:list', data: { entries } })
      return
    }

    if (command === 'prompt:list-versions') {
      const promptId = typeof data.promptId === 'string' ? data.promptId : ''
      if (!promptId) return
      const versions = listPromptLibraryVersions(db, promptId).map(mobilePromptVersion)
      reply({ event: 'prompt:versions', data: { promptId, versions } })
      return
    }

    if (command === 'prompt:create') {
      const title = typeof data.title === 'string' ? data.title.trim() : ''
      const body = typeof data.body === 'string' ? data.body : ''
      const description = typeof data.description === 'string' ? data.description : ''
      const category = typeof data.category === 'string' ? data.category : 'Custom'
      const tags = Array.isArray(data.tags) ? (data.tags as string[]) : []
      const scope = data.scope === 'project' ? 'project' : 'global'
      const projectId = typeof data.projectId === 'string' ? data.projectId : undefined
      if (!title || !body.trim()) return
      const entry = insertPromptLibraryEntry(db, { title, body, description, category, tags, scope, project_id: projectId })
      broadcastToMobile({ event: 'prompt:entry-created', data: { entry: mobilePromptEntry(entry) } })
      return
    }

    if (command === 'prompt:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      try {
        const updated = updatePromptLibraryEntry(db, id, {
          title: typeof data.title === 'string' ? data.title : undefined,
          body: typeof data.body === 'string' ? data.body : undefined,
          description: typeof data.description === 'string' ? data.description : undefined,
          category: typeof data.category === 'string' ? data.category : undefined,
          tags: Array.isArray(data.tags) ? data.tags.map(String) : undefined,
        })
        broadcastToMobile({ event: 'prompt:entry-updated', data: { entry: mobilePromptEntry(updated) } })
      } catch (err: unknown) {
        reply({ event: 'prompt:error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'prompt:rollback') {
      const promptId = typeof data.promptId === 'string' ? data.promptId : ''
      const version = typeof data.version === 'number' ? data.version : Number(data.version)
      if (!promptId || !Number.isFinite(version)) return
      try {
        const entry = rollbackPromptLibraryEntry(db, promptId, version)
        broadcastToMobile({ event: 'prompt:entry-updated', data: { entry: mobilePromptEntry(entry) } })
        const versions = listPromptLibraryVersions(db, promptId).map(mobilePromptVersion)
        reply({ event: 'prompt:versions', data: { promptId, versions } })
      } catch (err: unknown) {
        reply({ event: 'prompt:error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'prompt:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      db.prepare('DELETE FROM prompt_library_entries WHERE id = ?').run(id)
      broadcastToMobile({ event: 'prompt:entry-deleted', data: { id } })
      return
    }

    if (command === 'conversation:export-pack') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const format = typeof data.format === 'string' ? data.format : 'json'
      if (!conversationId) return
      try {
        const pack = buildConversationExportPack(db, conversationId, { format: format as 'json' | 'markdown' | 'context-bundle' })
        reply({ event: 'conversation:export-pack', data: { pack } })
      } catch (err) {
        reply({ event: 'conversation:export-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'conversation:fork') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const cutoffTimestamp = typeof data.cutoffTimestamp === 'number' ? data.cutoffTimestamp : null
      const projectId = typeof data.projectId === 'string'
        ? (data.projectId || null)
        : undefined
      try {
        const result = forkConversation(db, conversationId, { cutoffTimestamp, ...(projectId !== undefined ? { projectId } : {}) })
        broadcastToMobile({ event: 'conversation:forked', data: { conversationId: result.conversation.id, title: result.conversation.title, messageCount: result.message_count, projectId: result.conversation.project_id } })
      } catch (err) {
        reply({ event: 'conversation:fork-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'conversation:import-json') {
      const raw = typeof data.json === 'string' ? data.json : ''
      if (!raw) return
      try {
        const parsed = parseConversationExport(JSON.parse(raw))
        const result = importConversationExport(db, parsed, {})
        broadcastToMobile({ event: 'conversation:imported', data: { conversationId: result.conversation.id, title: result.conversation.title, messageCount: result.message_count } })
      } catch (err) {
        reply({ event: 'conversation:import-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'conversation:set-pinned') {
      const id = typeof data.id === 'string' ? data.id : ''
      const pinned = Boolean(data.pinned)
      if (!id) return
      db.prepare('UPDATE conversations SET pinned = ?, updated_at = ? WHERE id = ?').run(pinned ? 1 : 0, Date.now(), id)
      broadcastToMobile({ event: 'conversation:pinned', data: { id, pinned } })
      return
    }

    if (command === 'conversation:update-context') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const assignments: string[] = []
      const values: (string | number | null)[] = []
      if (Object.prototype.hasOwnProperty.call(data, 'projectId')) {
        assignments.push('project_id = ?')
        values.push(typeof data.projectId === 'string' ? data.projectId : null)
      }
      if (Object.prototype.hasOwnProperty.call(data, 'agentId')) {
        assignments.push('agent_id = ?')
        values.push(typeof data.agentId === 'string' ? data.agentId : null)
      }
      if (assignments.length === 0) return
      assignments.push('updated_at = ?')
      values.push(Date.now())
      values.push(conversationId)
      db.prepare(`UPDATE conversations SET ${assignments.join(', ')} WHERE id = ?`).run(...values)
      broadcastToMobile({ event: 'conversation:context-updated', data: { conversationId, projectId: data.projectId ?? null, agentId: data.agentId ?? null } })
      return
    }

    if (command === 'conversation:insert-message') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const role = typeof data.role === 'string' ? data.role : 'user'
      const content = typeof data.content === 'string' ? data.content : ''
      if (!conversationId || !content) return
      const id = randomUUID()
      const now = Date.now()
      db.prepare('INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)').run(id, conversationId, role, content, now)
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown>
      reply({ event: 'message:inserted', data: { conversationId, message: row } })
      return
    }

    if (command === 'artifact:promote-message') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const messageId = typeof data.messageId === 'string' ? data.messageId : ''
      const title = typeof data.title === 'string' ? data.title : ''
      const kind = typeof data.kind === 'string' ? data.kind : 'document'
      const filePath = typeof data.filePath === 'string' ? data.filePath : ''
      const scopeObj = typeof data.scope === 'object' && data.scope !== null ? data.scope as Record<string, unknown> : {}
      const scopeType = scopeObj.type === 'project' ? 'project' : 'global'
      const scopeProjectId = typeof scopeObj.projectId === 'string' ? scopeObj.projectId : undefined
      if (!conversationId || !messageId || !filePath) return
      try {
        const result = promoteConversationMessageToArtifact({
          conversationId,
          messageId,
          title,
          kind: (['document', 'prompt', 'plan', 'code', 'other'].includes(kind) ? kind : 'document') as 'document' | 'prompt' | 'plan' | 'code' | 'other',
          scope: scopeType === 'project' ? { type: 'project', projectId: scopeProjectId } : { type: 'global' },
          filePath,
        })
        reply({ event: 'artifact:promoted', data: { ...result, messageId } })
      } catch (error) {
        reply({ event: 'artifact:promote-error', data: { message: error instanceof Error ? error.message : String(error), messageId } })
      }
      return
    }

    if (command === 'message:delete-after') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const timestamp = typeof data.timestamp === 'number' ? data.timestamp : 0
      if (!conversationId || !timestamp) return
      db.prepare('DELETE FROM messages WHERE conversation_id = ? AND timestamp >= ?').run(conversationId, timestamp)
      reply({ event: 'message:deleted-after', data: { conversationId, timestamp } })
      broadcastConversationMessages(conversationId)
      return
    }

    if (command === 'conversation:compression-preview') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      try {
        const preview = getConversationCompressionPreview(db, conversationId)
        reply({ event: 'conversation:compression-preview', data: preview })
      } catch (err) {
        reply({ event: 'conversation:compression-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'conversation:prepare-compression-summary') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      try {
        const draft = prepareConversationCompressionSummary(db, conversationId)
        reply({ event: 'conversation:compression-draft', data: draft })
      } catch (err) {
        reply({ event: 'conversation:compression-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'conversation:save-compression-summary') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      try {
        const sections = (typeof data.sections === 'object' && data.sections !== null) ? data.sections as Record<string, string[]> : {}
        const input = {
          conversationId,
          sections: {
            goals: Array.isArray(sections.goals) ? sections.goals as string[] : [],
            decisions: Array.isArray(sections.decisions) ? sections.decisions as string[] : [],
            constraints: Array.isArray(sections.constraints) ? sections.constraints as string[] : [],
            filesTouched: Array.isArray(sections.filesTouched) ? sections.filesTouched as string[] : [],
            commandsRun: Array.isArray(sections.commandsRun) ? sections.commandsRun as string[] : [],
            openQuestions: Array.isArray(sections.openQuestions) ? sections.openQuestions as string[] : [],
            nextActions: Array.isArray(sections.nextActions) ? sections.nextActions as string[] : [],
            recentContextNotes: Array.isArray(sections.recentContextNotes) ? sections.recentContextNotes as string[] : [],
          },
          summarizedMessageCount: typeof data.summarizedMessageCount === 'number' ? data.summarizedMessageCount : 0,
          retainedMessageCount: typeof data.retainedMessageCount === 'number' ? data.retainedMessageCount : 0,
          omittedMessageCount: typeof data.omittedMessageCount === 'number' ? data.omittedMessageCount : 0,
          estimatedTokensBefore: typeof data.estimatedTokensBefore === 'number' ? data.estimatedTokensBefore : 0,
          targetBudget: typeof data.targetBudget === 'number' ? data.targetBudget : 0,
          strategy: typeof data.strategy === 'string' ? data.strategy : 'manual-structured-summary-plus-recent-turns',
        }
        const preview = saveConversationCompressionSummary(db, input)
        reply({ event: 'conversation:compression-saved', data: preview })
      } catch (err) {
        reply({ event: 'conversation:compression-error', data: { message: String(err) } })
      }
      return
    }

    if (command === 'context:inspector-snapshot') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : null
      requestInspectorSnapshotFromRenderer(conversationId)
        .then((snapshot) => {
          reply({ event: 'context:inspector-snapshot', data: snapshot })
        })
        .catch((err) => {
          reply({ event: 'context:inspector-snapshot-error', data: { message: String(err) } })
        })
      return
    }

    if (command === 'project-generator:start' || command === 'project-generator:message') {
      const messages = Array.isArray(data.messages) ? data.messages : []
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-${Date.now()}`
      const modelOverride = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
      const existingAgents = Array.isArray(data.existingAgents) && data.existingAgents.length > 0
        ? data.existingAgents
        : getProjectGeneratorAgentSummaries()
      if (command === 'project-generator:start') {
        try {
          const resolvedModel = modelOverride ?? getProjectGeneratorModel()
          broadcastToMobile({ event: 'project-generator:model', data: { sessionId, modelId: resolvedModel } })
        } catch { /* no configured provider — error will surface from runProjectGeneratorChatForAndroid */ }
      }
      void runProjectGeneratorChatForAndroid(messages, existingAgents, sessionId, modelOverride)
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'project-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'project-generator:confirm') {
      const spec = data.spec as ProjectGeneratorSpec
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      createProjectFromSpec(spec)
        .then((result) => {
          broadcastToMobile({ event: 'project-generator:created', data: { sessionId, ...result } })
        })
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'project-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'project-generator:cancel') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      broadcastToMobile({ event: 'project-generator:cancelled', data: { sessionId } })
      return
    }

    if (command === 'agent-generator:start' || command === 'agent-generator:message') {
      const messages = Array.isArray(data.messages) ? data.messages : []
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-agent-${Date.now()}`
      const modelOverride = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
      if (command === 'agent-generator:start') {
        try {
          const resolvedModel = modelOverride ?? getAgentGeneratorModel()
          broadcastToMobile({ event: 'agent-generator:model', data: { sessionId, modelId: resolvedModel } })
        } catch { /* no configured provider — error will surface from runAgentGeneratorChatForAndroid */ }
      }
      void runAgentGeneratorChatForAndroid(messages, sessionId, modelOverride)
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'agent-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'agent-generator:confirm') {
      const spec = data.spec as AgentGeneratorSpec
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      createAgentFromSpec(spec)
        .then((result) => {
          broadcastToMobile({ event: 'agent-generator:created', data: { sessionId, agentId: result.agentId, name: result.name } })
        })
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'agent-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'agent-generator:cancel') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      broadcastToMobile({ event: 'agent-generator:cancelled', data: { sessionId } })
      return
    }

    if (command === 'skill-generator:start' || command === 'skill-generator:message') {
      const messages = Array.isArray(data.messages) ? data.messages : []
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-skill-${Date.now()}`
      const modelOverride = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
      if (command === 'skill-generator:start') {
        try {
          const resolvedModel = modelOverride ?? getSkillGeneratorModel()
          broadcastToMobile({ event: 'skill-generator:model', data: { sessionId, modelId: resolvedModel } })
        } catch { /* no configured provider — error will surface from runSkillGeneratorChatForAndroid */ }
      }
      void runSkillGeneratorChatForAndroid(messages, sessionId, modelOverride)
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'skill-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'skill-generator:confirm') {
      const spec = data.spec as SkillGeneratorSpec
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      createSkillFromSpec(spec)
        .then((result) => {
          broadcastToMobile({ event: 'skill-generator:created', data: { sessionId, skillId: result.skillId, name: result.name } })
        })
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'skill-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'skill-generator:cancel') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      broadcastToMobile({ event: 'skill-generator:cancelled', data: { sessionId } })
      return
    }

    if (command === 'scheduler-generator:start' || command === 'scheduler-generator:message') {
      const rawMessages = Array.isArray(data.messages) ? data.messages : []
      const messages: ScheduleGeneratorMessage[] = rawMessages
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : '',
        }))
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-schedule-${Date.now()}`
      const modelOverride = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
      if (command === 'scheduler-generator:start') {
        try {
          const resolvedModel = modelOverride ?? getScheduleGeneratorModel()
          broadcastToMobile({ event: 'scheduler-generator:model', data: { sessionId, modelId: resolvedModel } })
        } catch { /* no configured provider; generator error will surface */ }
      }
      void runScheduleGeneratorChatForAndroid(messages, sessionId, modelOverride)
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'scheduler-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'scheduler-generator:confirm') {
      const spec = data.spec as ScheduleGeneratorSpec
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      createScheduleFromSpec(spec)
        .then((result) => {
          broadcastToMobile({ event: 'scheduler-generator:created', data: { sessionId, taskId: result.taskId, name: result.name } })
        })
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'scheduler-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'scheduler-generator:cancel') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      broadcastToMobile({ event: 'scheduler-generator:cancelled', data: { sessionId } })
      return
    }

    if (command === 'scheduler-generator:get-model') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      try {
        broadcastToMobile({ event: 'scheduler-generator:model', data: { sessionId, modelId: getScheduleGeneratorModel() } })
      } catch (err) {
        broadcastToMobile({ event: 'scheduler-generator:error', data: { sessionId, message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'scheduler-generator:set-model') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      const modelId = typeof data.modelId === 'string' ? data.modelId : ''
      setScheduleGeneratorModel(modelId)
      broadcastToMobile({ event: 'scheduler-generator:model', data: { sessionId, modelId: getScheduleGeneratorModel() } })
      return
    }

    if (command === 'artifact-generator:start' || command === 'artifact-generator:message') {
      const rawMessages = Array.isArray(data.messages) ? data.messages : []
      const messages: ArtifactGeneratorMessage[] = rawMessages
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : '',
        }))
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-artifact-${Date.now()}`
      const modelOverride = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
      if (command === 'artifact-generator:start') {
        try {
          const resolvedModel = modelOverride ?? getArtifactGeneratorModel()
          broadcastToMobile({ event: 'artifact-generator:model', data: { sessionId, modelId: resolvedModel } })
        } catch { /* no configured provider — error will surface from runArtifactGeneratorChatForAndroid */ }
      }
      void runArtifactGeneratorChatForAndroid(messages, sessionId, modelOverride)
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'artifact-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'artifact-generator:cancel') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      broadcastToMobile({ event: 'artifact-generator:cancelled', data: { sessionId } })
      return
    }

    if (command === 'automated-workflow-generator:start' || command === 'automated-workflow-generator:message') {
      // Project-optional, mirroring automated-workflow-runs:list/save-spec — a missing or blank
      // projectId means a standalone (global) workflow, not an error. An actual empty string is
      // never a valid project id, so trimming to '' and treating it as null is safe either way.
      const projectId = typeof data.projectId === 'string' && data.projectId.trim() ? data.projectId.trim() : null
      const rawMessages = Array.isArray(data.messages) ? data.messages : []
      const messages: AutomatedWorkflowGeneratorMessage[] = rawMessages
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : '',
        }))
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-automated-workflow-${Date.now()}`
      const modelOverride = typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined
      if (command === 'automated-workflow-generator:start') {
        try {
          const resolvedModel = modelOverride ?? getAutomatedWorkflowGeneratorModel()
          broadcastToMobile({ event: 'automated-workflow-generator:model', data: { sessionId, modelId: resolvedModel } })
        } catch { /* no configured provider; generator error will surface */ }
      }
      void runAutomatedWorkflowGeneratorChatForAndroid(projectId, messages, sessionId, modelOverride)
        .catch((err: unknown) => {
          broadcastToMobile({ event: 'automated-workflow-generator:error', data: { sessionId, message: String(err) } })
        })
      return
    }

    if (command === 'automated-workflow-generator:cancel') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      broadcastToMobile({ event: 'automated-workflow-generator:cancelled', data: { sessionId } })
      return
    }

    if (command === 'automated-workflow-generator:get-model') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      try {
        broadcastToMobile({ event: 'automated-workflow-generator:model', data: { sessionId, modelId: getAutomatedWorkflowGeneratorModel() } })
      } catch (err) {
        broadcastToMobile({ event: 'automated-workflow-generator:error', data: { sessionId, message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-generator:set-model') {
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      const modelId = typeof data.modelId === 'string' ? data.modelId : ''
      setAutomatedWorkflowGeneratorModel(modelId)
      broadcastToMobile({ event: 'automated-workflow-generator:model', data: { sessionId, modelId: getAutomatedWorkflowGeneratorModel() } })
      return
    }

    // Persisted automated workflow runs (distinct from the ephemeral generator chat above).
    // These mirror the desktop-only IPC surface in automated-workflow-runs.ts so a plan
    // saved from Android is the same durable entity desktop's Workflow tab shows. Each handler
    // below is wrapped in try/catch-with-reply (rather than relying on the outer command
    // dispatcher's swallow-on-error) so a bad spec or a DB error surfaces to the Android client
    // instead of leaving it stuck (e.g. a permanently-disabled "Saving…" button) with no signal.
    function notifyAutomatedWorkflowRunChanged(projectId: string | null, runId: string): void {
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('automated-workflow-runs:changed', { projectId, runId })
      })
    }

    if (command === 'automated-workflow-runs:list') {
      // projectId may be a real project id, or explicitly null/omitted to mean "project-less
      // runs" — distinct from ':list-all', which returns every run regardless of project.
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      try {
        reply({ event: 'automated-workflow-runs:list', data: { projectId, runs: listAutomatedWorkflowRuns(projectId) } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-runs:list-all') {
      try {
        reply({ event: 'automated-workflow-runs:list-all', data: { runs: listAllAutomatedWorkflowRuns() } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-runs:get') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      if (!runId) return
      try {
        reply({ event: 'automated-workflow-runs:detail', data: { run: getAutomatedWorkflowRun(runId) } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-managed:list-sources') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : ''
      try {
        reply({ event: 'automated-workflow-managed:sources', data: { projectId, sources: listManagedWorkflowSources(projectId) } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-managed:get-version') {
      const versionId = typeof data.versionId === 'string' ? data.versionId : ''
      try {
        reply({ event: 'automated-workflow-managed:version', data: { version: getManagedArtifactVersionContent(versionId) } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-managed:get-bindings') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      const stepDbId = typeof data.stepDbId === 'string' ? data.stepDbId : undefined
      reply({ event: 'automated-workflow-managed:bindings', data: { runId, stepDbId, bindings: getManagedBindings(runId, stepDbId) } })
      return
    }

    if (command === 'automated-workflow-managed:edit-version') {
      try {
        const detail = editManagedWorkflowVersion({
          runId: String(data.runId ?? ''), stepDbId: String(data.stepDbId ?? ''),
          expectedVersionId: String(data.expectedVersionId ?? ''), content: String(data.content ?? ''), client: 'android',
        })
        reply({ event: 'automated-workflow-runs:detail', data: { run: detail } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-managed:review') {
      const runId = String(data.runId ?? '')
      try {
        const decision = data.decision === 'rejected' ? 'rejected' : 'approved'
        let detail = recordManagedWorkflowReview({ runId, stepDbId: String(data.stepDbId ?? ''),
          artifactVersionId: String(data.artifactVersionId ?? ''), decision, client: 'android' })
        if (decision === 'approved' && detail.status !== 'done') detail = (await advanceAutomatedWorkflowRun(runId)) ?? detail
        reply({ event: 'automated-workflow-runs:detail', data: { run: detail } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-managed:regenerate') {
      const runId = String(data.runId ?? '')
      try {
        resetManagedWorkflowFromStep(runId, String(data.stepDbId ?? ''))
        const detail = await advanceAutomatedWorkflowRun(runId)
        reply({ event: 'automated-workflow-runs:detail', data: { run: detail } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-managed:create-preview') {
      try {
        const preview = createManagedPublishPreview({ runId: String(data.runId ?? ''),
          stepDbId: String(data.stepDbId ?? ''), artifactVersionId: String(data.artifactVersionId ?? '') })
        reply({ event: 'automated-workflow-managed:publish-preview', data: { preview } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-managed:confirm-publish') {
      const runId = String(data.runId ?? '')
      try {
        const action = confirmManagedPublish({ runId, stepDbId: String(data.stepDbId ?? ''),
          previewId: String(data.previewId ?? ''), idempotencyKey: String(data.idempotencyKey ?? ''), client: 'android' })
        if (action.status === 'published' && getAutomatedWorkflowRun(runId)?.status === 'pending') await advanceAutomatedWorkflowRun(runId)
        reply({ event: 'automated-workflow-managed:publish-action', data: { action } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-runs:save-spec') {
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const specRaw = data.spec
      if (!specRaw || typeof specRaw !== 'object') {
        reply({ event: 'automated-workflow-runs:error', data: { message: 'Missing spec' } })
        return
      }
      try {
        const spec = normalizeAutomatedWorkflowSpec(specRaw as Record<string, unknown>)
        const model = typeof data.model === 'string' ? data.model : null
        const existingRunId = typeof data.existingRunId === 'string' ? data.existingRunId : null
        const detail = saveAutomatedWorkflowRunFromSpec(projectId, spec, model, existingRunId)
        broadcastToMobile({ event: 'automated-workflow-runs:detail', data: { run: detail } })
        notifyAutomatedWorkflowRunChanged(projectId, detail.id)
        reply({ event: 'automated-workflow-runs:detail', data: { run: detail } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-runs:update-step-status') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      const stepDbId = typeof data.stepDbId === 'string' ? data.stepDbId : ''
      const status = data.status
      const validStatuses: AutomatedWorkflowStepStatus[] = ['pending', 'running', 'awaiting_confirmation', 'done', 'failed', 'skipped', 'cancelled']
      if (!runId || !stepDbId || typeof status !== 'string' || !validStatuses.includes(status as AutomatedWorkflowStepStatus)) {
        reply({ event: 'automated-workflow-runs:error', data: { message: 'Missing or invalid runId/stepDbId/status' } })
        return
      }
      try {
        const detail = updateAutomatedWorkflowRunStepStatus(runId, stepDbId, status as AutomatedWorkflowStepStatus)
        if (detail) {
          broadcastToMobile({ event: 'automated-workflow-runs:detail', data: { run: detail } })
          notifyAutomatedWorkflowRunChanged(detail.projectId, detail.id)
        }
        reply({ event: 'automated-workflow-runs:detail', data: { run: detail } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-runs:discard') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      if (!runId) return
      try {
        const existing = getAutomatedWorkflowRun(runId)
        const ok = discardAutomatedWorkflowRun(runId)
        if (ok && existing) {
          broadcastToMobile({ event: 'automated-workflow-runs:discarded', data: { runId } })
          notifyAutomatedWorkflowRunChanged(existing.projectId, runId)
        }
        reply({ event: 'automated-workflow-runs:discarded', data: { runId, ok } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-runs:start') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      if (!runId) { reply({ event: 'automated-workflow-runs:error', data: { message: 'Missing runId' } }); return }
      startAutomatedWorkflowRun(runId)
        .then((detail) => reply({ event: 'automated-workflow-runs:detail', data: { run: detail } }))
        .catch((err: unknown) => reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } }))
      return
    }

    if (command === 'automated-workflow-runs:confirm-step') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      const stepDbId = typeof data.stepDbId === 'string' ? data.stepDbId : ''
      const editedOutput = typeof data.editedOutput === 'string' ? data.editedOutput : undefined
      if (!runId || !stepDbId) { reply({ event: 'automated-workflow-runs:error', data: { message: 'Missing runId/stepDbId' } }); return }
      confirmAutomatedWorkflowStep(runId, stepDbId, editedOutput)
        .then((detail) => reply({ event: 'automated-workflow-runs:detail', data: { run: detail } }))
        .catch((err: unknown) => reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } }))
      return
    }

    if (command === 'automated-workflow-runs:retry-step') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      const stepDbId = typeof data.stepDbId === 'string' ? data.stepDbId : ''
      if (!runId || !stepDbId) { reply({ event: 'automated-workflow-runs:error', data: { message: 'Missing runId/stepDbId' } }); return }
      retryAutomatedWorkflowStep(runId, stepDbId)
        .then((detail) => reply({ event: 'automated-workflow-runs:detail', data: { run: detail } }))
        .catch((err: unknown) => reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } }))
      return
    }

    if (command === 'automated-workflow-runs:skip-step') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      const stepDbId = typeof data.stepDbId === 'string' ? data.stepDbId : ''
      if (!runId || !stepDbId) { reply({ event: 'automated-workflow-runs:error', data: { message: 'Missing runId/stepDbId' } }); return }
      skipAutomatedWorkflowStep(runId, stepDbId)
        .then((detail) => reply({ event: 'automated-workflow-runs:detail', data: { run: detail } }))
        .catch((err: unknown) => reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } }))
      return
    }

    if (command === 'automated-workflow-runs:abort') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      if (!runId) { reply({ event: 'automated-workflow-runs:error', data: { message: 'Missing runId' } }); return }
      try {
        const detail = abortAutomatedWorkflowRun(runId)
        reply({ event: 'automated-workflow-runs:detail', data: { run: detail } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-runs:run-again') {
      const templateId = typeof data.templateId === 'string' ? data.templateId : ''
      if (!templateId) { reply({ event: 'automated-workflow-runs:error', data: { message: 'Missing templateId' } }); return }
      try {
        const detail = runAutomatedWorkflowTemplateAgain(templateId)
        broadcastToMobile({ event: 'automated-workflow-runs:detail', data: { run: detail } })
        reply({ event: 'automated-workflow-runs:detail', data: { run: detail } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'automated-workflow-runs:set-confirmation-mode') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      const mode = data.mode
      if (!runId || (mode !== 'gated' && mode !== 'auto')) {
        reply({ event: 'automated-workflow-runs:error', data: { message: 'Missing runId or invalid mode' } })
        return
      }
      try {
        const detail = setAutomatedWorkflowConfirmationMode(runId, mode)
        reply({ event: 'automated-workflow-runs:detail', data: { run: detail } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'artifact:move-to-project') {
      const artifactId = typeof data.artifactId === 'string' ? data.artifactId : ''
      const projectId = typeof data.projectId === 'string' && data.projectId ? data.projectId : null
      if (!artifactId) {
        reply({ event: 'artifact:moved-to-project', data: { ok: false, artifactId, projectId } })
        return
      }
      const info = projectId
        ? db.prepare('UPDATE artifacts SET project_id = ?, updated_at = ? WHERE id = ?').run(projectId, Date.now(), artifactId)
        : db.prepare('UPDATE artifacts SET project_id = NULL, updated_at = ? WHERE id = ?').run(Date.now(), artifactId)
      broadcastToMobile({ event: 'artifact:moved-to-project', data: { ok: (info as { changes: number }).changes > 0, artifactId, projectId } })
      return
    }

    if (command === 'artifact-generator:generate') {
      const sessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
        ? data.sessionId.trim()
        : `android-artifact-generate-${Date.now()}`
      const spec = data.spec && typeof data.spec === 'object' ? data.spec as ArtifactSpec : null
      if (!spec) {
        broadcastToMobile({ event: 'artifact-generator:error', data: { sessionId, message: 'Missing artifact spec' } })
        return
      }
      const fakeWin = {
        isDestroyed: () => false,
        webContents: {
          send: () => {},
        },
      } as unknown as BrowserWindow
      void (async () => {
        try {
          createArtifactGeneratorRunRecord(sessionId, spec.title)
          updateArtifactGeneratorRunRecord(sessionId, { specJson: JSON.stringify(spec) })
          const artifactId = await runArtifactGeneration(fakeWin, sessionId, spec)
          broadcastToMobile({ event: 'artifact-generator:created', data: { sessionId, artifactId, title: spec.title } })
          broadcastToMobile({ event: 'artifact-generator:turn-complete', data: { sessionId, content: '', hasSpec: true } })
        } catch (err: unknown) {
          broadcastToMobile({ event: 'artifact-generator:error', data: { sessionId, message: String(err) } })
        }
      })()
      return
    }

    if (command === 'build:get-records') {
      const platform = typeof data.platform === 'string' ? data.platform : undefined
      const limit = typeof data.limit === 'number' ? Math.min(data.limit, 50) : 20
      const rows = platform
        ? db.prepare(`SELECT * FROM build_records WHERE platform = ? ORDER BY started_at DESC LIMIT ?`).all(platform, limit) as Record<string, unknown>[]
        : db.prepare(`SELECT * FROM build_records ORDER BY started_at DESC LIMIT ?`).all(limit) as Record<string, unknown>[]
      const records = rows.map((r) => ({
        id: r.id, workspacePath: r.workspace_path, commitSha: r.commit_sha ?? null,
        branch: r.branch ?? null, version: r.version ?? null, versionCode: r.version_code ?? null,
        platform: r.platform, command: r.command, status: r.status, exitCode: r.exit_code ?? null,
        artifactPaths: JSON.parse((r.artifact_paths as string | null) ?? '[]'),
        logTail: (r.log_tail as string | null) ?? '',
        startedAt: r.started_at, finishedAt: r.finished_at ?? null,
      }))
      reply({ event: 'build:records', data: { records } })
      return
    }

    if (command === 'build:get-workspace-info') {
      void getWorkspaceInfo(db)
        .then((info) => reply({ event: 'build:workspace-info', data: info }))
        .catch((err: unknown) => reply({ event: 'build:workspace-info', data: { error: String(err) } }))
      return
    }

    if (command === 'build:run-preflight') {
      const workspacePath = (db.prepare("SELECT value FROM settings WHERE key = 'build_workspace_path'").get() as { value: string } | undefined)?.value ?? process.cwd()
      void (async () => {
        const { execFile } = await import('child_process')
        const { promisify } = await import('util')
        const execFileAsync = promisify(execFile)
        const checks: { label: string; status: string; detail: string }[] = []
        try {
          const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: workspacePath, timeout: 5000, maxBuffer: 1024 * 1024 })
          const statusOut = stdout.trim()
          checks.push(statusOut.length > 0
            ? { label: 'Git working tree', status: 'warn', detail: `${statusOut.split('\n').length} modified or untracked file(s)` }
            : { label: 'Git working tree', status: 'ok', detail: 'Clean' })
        } catch { checks.push({ label: 'Git working tree', status: 'warn', detail: 'Could not run git status' }) }
        const { join } = pathModule
        checks.push(fsExistsSync(join(workspacePath, 'node_modules', '.package-lock.json'))
          ? { label: 'node_modules', status: 'ok', detail: 'Present' }
          : { label: 'node_modules', status: 'fail', detail: 'Missing — run npm install' })
        const signingKey = process.platform === 'win32' ? process.env['WIN_CSC_LINK'] : process.env['CSC_LINK']
        checks.push(signingKey
          ? { label: 'Code signing', status: 'ok', detail: 'Signing key configured' }
          : { label: 'Code signing', status: 'warn', detail: 'No signing key env var set — unsigned build only' })
        return checks
      })().then((checks) => reply({ event: 'build:preflight-result', data: { checks } }))
        .catch((err: unknown) => reply({ event: 'build:preflight-result', data: { checks: [{ label: 'Preflight', status: 'fail', detail: String(err) }] } }))
      return
    }

    if (command === 'build:start-from-mobile') {
      const command_ = typeof data.command === 'string' ? data.command as import('../shared/types').BuildCommandName : null
      const validCommands = ['typecheck', 'test', 'build', 'package'] as const
      if (!command_ || !validCommands.includes(command_ as typeof validCommands[number])) {
        reply({ event: 'build:command-done', data: { buildId: null, status: 'failed', exitCode: -1, error: 'Invalid command' } })
        return
      }
      const win = BrowserWindow.getAllWindows()[0]
      void startBuildFromMobile(command_, win ?? undefined)
        .then(({ buildId }) => reply({ event: 'build:started', data: { buildId, command: command_ } }))
        .catch((err: unknown) => reply({ event: 'build:command-done', data: { buildId: null, status: 'failed', exitCode: -1, error: String(err) } }))
      return
    }

    if (command === 'build:cancel-from-mobile') {
      const buildId = typeof data.buildId === 'string' ? data.buildId : ''
      const cancelled = buildId ? cancelMobileBuild(buildId) : false
      reply({ event: 'build:cancelled', data: { buildId, cancelled } })
      return
    }

    if (command === 'build:update-from-artifact') {
      void publishArtifactToFeed(db).then(async (result) => {
        if (!result.published) {
          reply({ event: 'update:restarting', data: { eta: null, version: null, error: result.error } })
          return
        }
        const install = await runPublishedUpdateInstall()
        if (install.mode === 'no-update' || install.mode === 'error') {
          reply({ event: 'update:restarting', data: { eta: null, version: result.version ?? null, error: install.error } })
          return
        }
        broadcastToMobile({ event: 'update:restarting', data: { eta: 15, version: result.version ?? null } })
        BrowserWindow.getAllWindows().forEach((w) => {
          if (!w.isDestroyed()) w.webContents.send('update:restarting', { eta: 15, version: result.version ?? null })
        })
      }).catch((err: unknown) => {
        reply({ event: 'update:restarting', data: { eta: null, version: null, error: String(err) } })
      })
      return
    }

    if (command === 'android:get-workspace-info') {
      void getAndroidWorkspaceInfo(db)
        .then((info) => reply({ event: 'android:workspace-info', data: info }))
        .catch((err: unknown) => reply({ event: 'android:workspace-info', data: { error: String(err) } }))
      return
    }

    if (command === 'android:set-workspace-path') {
      const workspacePath = typeof data.path === 'string' ? data.path : ''
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('android_workspace_path', ?)").run(workspacePath)
      void getAndroidWorkspaceInfo(db)
        .then((info) => reply({ event: 'android:workspace-info', data: info }))
        .catch((err: unknown) => reply({ event: 'android:workspace-info', data: { error: String(err) } }))
      return
    }

    if (command === 'android:start-build') {
      const cmd = typeof data.command === 'string' ? data.command as import('../shared/types').AndroidBuildCommandName : null
      const validCommands = ['assembleRelease', 'bundleRelease', 'assembleDebug'] as const
      if (!cmd || !validCommands.includes(cmd as typeof validCommands[number])) {
        reply({ event: 'build:command-done', data: { buildId: null, status: 'failed', exitCode: -1, error: 'Invalid Android build command' } })
        return
      }
      const win = BrowserWindow.getAllWindows()[0]
      void startAndroidBuildFromMobile(cmd, win ?? undefined)
        .then(({ buildId }) => reply({ event: 'build:started', data: { buildId, command: cmd } }))
        .catch((err: unknown) => reply({ event: 'build:command-done', data: { buildId: null, status: 'failed', exitCode: -1, error: String(err) } }))
      return
    }

    if (command === 'android:cancel-build') {
      const buildId = typeof data.buildId === 'string' ? data.buildId : ''
      const cancelled = buildId ? cancelAndroidBuildFromMobile(buildId) : false
      reply({ event: 'build:cancelled', data: { buildId, cancelled } })
      return
    }

    if (command === 'android:validate-signing') {
      const config = getSigningConfig(db)
      const checks: { label: string; status: string; detail: string }[] = []
      if (!config) {
        checks.push({ label: 'Signing config', status: 'fail', detail: 'No signing config saved' })
        reply({ event: 'android:signing-validation', data: { valid: false, checks } })
        return
      }
      checks.push({ label: 'Signing config', status: 'ok', detail: 'Config present' })
      checks.push(fsExistsSync(config.keystorePath)
        ? { label: 'Keystore file', status: 'ok', detail: 'File exists' }
        : { label: 'Keystore file', status: 'fail', detail: `Not found: ${config.keystorePath}` })
      reply({ event: 'android:signing-validation', data: { valid: checks.every((c) => c.status !== 'fail'), checks } })
      return
    }

    if (command === 'android:publish-update') {
      void publishAndroidUpdate(db)
        .then((result) => reply({ event: 'android:publish-result', data: result }))
        .catch((err: unknown) => reply({ event: 'android:publish-result', data: { published: false, error: String(err) } }))
      return
    }

    if (command === 'android:restore-version') {
      const versionCode = typeof data.versionCode === 'number' ? data.versionCode : parseInt(String(data.versionCode), 10)
      if (!Number.isFinite(versionCode)) { reply({ event: 'android:restore-result', data: { restored: false, error: 'Invalid version code' } }); return }
      void restoreAndroidVersion(db, versionCode)
        .then((result) => reply({ event: 'android:restore-result', data: result }))
        .catch((err: unknown) => reply({ event: 'android:restore-result', data: { restored: false, error: String(err) } }))
      return
    }

    if (command === 'provider:get-azure-endpoint') {
      reply({ event: 'provider:azure-endpoint', data: { endpoint: getAzureEndpoint() ?? '' } })
      return
    }

    if (command === 'provider:set-azure-endpoint') {
      const endpoint = typeof data.endpoint === 'string' ? data.endpoint : ''
      setAzureEndpoint(endpoint)
      reply({ event: 'provider:azure-endpoint-set', data: { endpoint } })
      return
    }

    if (command === 'provider:test-key') {
      const provider = typeof data.provider === 'string' ? data.provider : ''
      const key = typeof data.key === 'string' ? data.key : ''
      const endpoint = typeof data.endpoint === 'string' ? data.endpoint : undefined
      if (!provider || !key) {
        reply({ event: 'provider:test-result', data: { provider, valid: false, error: 'Missing provider or key' } })
        return
      }
      void testProviderKey(provider, key, endpoint)
        .then((result) => reply({ event: 'provider:test-result', data: { provider, valid: result.valid, error: result.error } }))
        .catch((err: unknown) => reply({ event: 'provider:test-result', data: { provider, valid: false, error: String(err) } }))
      return
    }

    // ─── Scheduler WebSocket commands ───────────────────────────────────────

    if (command === 'scheduler:list') {
      reply({ event: 'scheduler:list', data: { tasks: dbListTasks() } })
      return
    }

    if (command === 'scheduler:get') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      reply({ event: 'scheduler:get', data: { task: dbGetTask(id) } })
      return
    }

    if (command === 'scheduler:create') {
      const input = data as unknown as import('../shared/types').ScheduledTaskCreateInput
      if (!input?.name || !input?.scheduleType || !input?.localTime || !input?.timezone) return
      const task = dbCreateTask(input)
      schedulerEngine.scheduleTask(task)
      reply({ event: 'scheduler:task-updated', data: task })
      return
    }

    if (command === 'scheduler:update') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      const input = data.input as import('../shared/types').ScheduledTaskUpdateInput
      const task = dbUpdateTask(id, input)
      if (!task) return
      if (task.enabled) schedulerEngine.scheduleTask(task)
      else schedulerEngine.unscheduleTask(id)
      reply({ event: 'scheduler:task-updated', data: task })
      return
    }

    if (command === 'scheduler:delete') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      schedulerEngine.unscheduleTask(id)
      dbDeleteTask(id)
      reply({ event: 'scheduler:task-deleted', data: { taskId: id } })
      return
    }

    if (command === 'scheduler:set-enabled') {
      const id = typeof data.id === 'string' ? data.id : ''
      const enabled = typeof data.enabled === 'boolean' ? data.enabled : false
      if (!id) return
      const task = dbSetTaskEnabled(id, enabled)
      if (!task) return
      if (task.enabled) schedulerEngine.scheduleTask(task)
      else schedulerEngine.unscheduleTask(id)
      reply({ event: 'scheduler:task-updated', data: task })
      return
    }

    if (command === 'scheduler:run-now') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) return
      void schedulerEngine.triggerRun(id, 'manual')
        .then((run) => reply({ event: 'scheduler:run-updated', data: run }))
        .catch((err: unknown) => reply({ event: 'scheduler:run-error', data: { taskId: id, error: String(err) } }))
      return
    }

    if (command === 'scheduler:resume-run') {
      const runId = typeof data.runId === 'string' ? data.runId : ''
      if (!runId) return
      void schedulerEngine.resumeRun(runId)
        .then((run) => reply({ event: 'scheduler:run-updated', data: run }))
        .catch((err: unknown) => reply({ event: 'scheduler:run-error', data: { runId, error: String(err) } }))
      return
    }

    if (command === 'scheduler:list-runs') {
      const taskId = typeof data.taskId === 'string' ? data.taskId : ''
      const limit = typeof data.limit === 'number' ? data.limit : 50
      if (!taskId) return
      reply({ event: 'scheduler:runs', data: { taskId, runs: dbListRuns(taskId, limit) } })
      return
    }

    // Lightweight list of existing saved Automated Workflow runs, for the "attach an existing
    // workflow to this schedule" picker — Android has no direct DB access, so it must fetch
    // candidates over WS rather than reading listAllAutomatedWorkflowRuns() locally.
    if (command === 'scheduler:list-workflow-templates') {
      try {
        reply({ event: 'scheduler:list-workflow-templates', data: { runs: listAllAutomatedWorkflowRuns() } })
      } catch (err) {
        reply({ event: 'automated-workflow-runs:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'conversation:generate-debrief') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const model = typeof data.model === 'string' ? data.model : undefined
      if (!conversationId) return
      // Routed through startDebriefGeneration (not generateDebriefForWs directly) so an
      // Android-triggered debrief gets the same durable pending artifact + chat message row
      // desktop's trigger creates — without it, generation had nothing to pin its result onto
      // and the finished debrief showed up only as an orphan artifact, never as a chat card.
      // generateDebriefForWs (called inside startDebriefGeneration) already broadcasts
      // 'debrief:ready' to all mobile clients (including this requester) — replying here too
      // would deliver the event twice to the same device and produce a duplicate debrief card.
      try {
        startDebriefGeneration(conversationId, projectId, model, true)
      } catch (err) {
        reply({ event: 'debrief:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'debrief:generate-story') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const model = typeof data.model === 'string' ? data.model : undefined
      const forceRegenerate = data.forceRegenerate === true
      const tone = typeof data.tone === 'string' ? data.tone as DebriefStoryTone : undefined
      const beatCount = typeof data.beatCount === 'number' ? data.beatCount : undefined
      if (!conversationId) return
      void generateDebriefStoryForWs(conversationId, projectId, model, forceRegenerate, tone, beatCount)
        .then((result) => reply({ event: 'debrief:story-ready', data: { ...result, conversationId } }))
        .catch((err: unknown) => reply({ event: 'debrief:story-error', data: { message: err instanceof Error ? err.message : String(err) } }))
      return
    }

    if (command === 'conversation:get-debrief') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const result = getDebriefForWs(conversationId)
      reply({ event: 'debrief:loaded', data: { conversationId, debrief: result?.debrief ?? null, artifactId: result?.artifactId, versionId: result?.versionId } })
      return
    }

    if (command === 'conversation:mark-complete') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const result = markCompleteForWs(conversationId)
      if (result) {
        reply({ event: 'debrief:conversation-completed', data: { conversationId, completedAt: result.completedAt } })
      }
      return
    }

    if (command === 'conversation:mark-incomplete') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const ok = markIncompleteForWs(conversationId)
      if (ok) {
        reply({ event: 'debrief:conversation-incompleted', data: { conversationId } })
      }
      return
    }

    if (command === 'conversation:set-rating') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const rating = typeof data.rating === 'number' ? data.rating : NaN
      const note = typeof data.note === 'string' ? data.note : null
      if (!conversationId || !Number.isInteger(rating)) return
      try {
        const result = submitRatingForConversation(conversationId, rating, note)
        reply({ event: 'rating:updated', data: { conversationId, rating: result } })
      } catch (err) {
        reply({ event: 'rating:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'conversation:get-rating') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const rating = getRatingForConversation(conversationId)
      reply({ event: 'rating:loaded', data: { conversationId, rating } })
      return
    }

    if (command === 'conversation:delete-rating') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const ok = deleteRatingForConversation(conversationId)
      if (ok) reply({ event: 'rating:updated', data: { conversationId, rating: null } })
      return
    }

    if (command === 'conversation:list-ratings') {
      reply({ event: 'rating:list-loaded', data: { ratings: listRatings() } })
      return
    }

    if (command === 'conversation:rating-stats') {
      reply({ event: 'rating:stats-loaded', data: { stats: getRatingStats() } })
      return
    }

    if (command === 'conversation:generate-quiz') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const model = typeof data.model === 'string' ? data.model : undefined
      if (!conversationId) return
      const spec = parseQuizSpec(data.spec)
      // Routed through startQuizGeneration (not generateQuizForWs directly) so an
      // Android-triggered quiz gets the same durable pending artifact + chat message row
      // desktop's trigger creates — without it, generation had nothing to pin its result onto
      // and the finished quiz showed up only as an orphan artifact, never as a chat card, if
      // the requesting screen was gone by the time it finished.
      // generateQuizForWs (called inside startQuizGeneration) already broadcasts 'quiz:ready' to
      // all mobile clients (including this requester) — replying here too would deliver the
      // event twice to the same device and produce a duplicate quiz card.
      try {
        startQuizGeneration(conversationId, projectId, model, spec, undefined, true)
      } catch (err) {
        reply({ event: 'quiz:error', data: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (command === 'conversation:get-quiz') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const result = getQuizForWs(conversationId)
      reply({ event: 'quiz:loaded', data: { conversationId, questions: result?.questions ?? null, artifactId: result?.artifactId, versionId: result?.versionId } })
      return
    }

    if (command === 'quiz:get-by-artifact') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const artifactId = typeof data.artifactId === 'string' ? data.artifactId : ''
      if (!conversationId || !artifactId) return
      const result = getQuizByArtifactIdForWs(artifactId)
      reply({ event: 'quiz:loaded', data: { conversationId, questions: result?.questions ?? null, artifactId: result?.artifactId, versionId: result?.versionId } })
      return
    }

    if (command === 'conversation:generate-teachback') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const model = typeof data.model === 'string' ? data.model : undefined
      const topic = typeof data.topic === 'string' ? data.topic.trim() : ''
      if (!conversationId) return
      void generateTeachbackForWs(conversationId, projectId, model, topic ? { topic } : {})
        .then((result) => reply({ event: 'teachback:ready', data: { ...result, conversationId } }))
        .catch((err: unknown) => reply({ event: 'teachback:error', data: { message: err instanceof Error ? err.message : String(err) } }))
      return
    }

    if (command === 'conversation:get-teachback' || command === 'teachback:get-by-artifact') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const artifactId = typeof data.artifactId === 'string' ? data.artifactId : ''
      if (!conversationId) return
      const result = command === 'teachback:get-by-artifact' && artifactId
        ? getTeachbackByArtifactIdForWs(artifactId)
        : getTeachbackForWs(conversationId)
      reply({ event: 'teachback:loaded', data: { conversationId, ...result } })
      return
    }

    if (command === 'teachback:grade') {
      const artifactId = typeof data.artifactId === 'string' ? data.artifactId : ''
      const versionId = typeof data.versionId === 'string' ? data.versionId : ''
      const transcript = typeof data.transcript === 'string' ? data.transcript : ''
      const prompt = typeof data.prompt === 'string' ? data.prompt : undefined
      const parentAttemptId = typeof data.parentAttemptId === 'string' ? data.parentAttemptId : undefined
      const turnNumber = typeof data.turnNumber === 'number' ? data.turnNumber : 0
      if (!artifactId || !versionId || !transcript) return
      void gradeTeachbackForWs(artifactId, versionId, transcript, prompt, parentAttemptId, turnNumber)
        .then((feedback) => reply({ event: 'teachback:graded', data: { artifactId, versionId, feedback } }))
        .catch((err: unknown) => reply({ event: 'teachback:error', data: { message: err instanceof Error ? err.message : String(err) } }))
      return
    }

    if (command === 'teachback:get-attempts') {
      const artifactId = typeof data.artifactId === 'string' ? data.artifactId : ''
      if (!artifactId) return
      reply({ event: 'teachback:attempts', data: { artifactId, attempts: listTeachbackAttempts(artifactId) } })
      return
    }

    if (command === 'activity:list') {
      reply({ event: 'activity:changed', data: { activities: getActivitySnapshot() } })
      return
    }

    if (command === 'new-content:list') {
      reply({ event: 'new-content:changed', data: { conversations: getNewContentConversations() } })
      return
    }

    if (command === 'new-content:mark-read') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (conversationId) {
        clearUnseenDestination(`chat:${conversationId}`)
      }
      return
    }

    if (command === 'new-content:mark-all-read') {
      markAllConversationsRead()
      return
    }

    if (command === 'activity:dismiss') {
      const id = typeof data.id === 'string' ? data.id : ''
      if (id) endActivity(id)
      return
    }
  })

  safeHandle('ws:start', async () => {
    const result = await startWsServer()
    const status = getWsStatus()
    const qrDataUrl = await getQrDataUrl()
    return { ...result, qrDataUrl, pairingUrl: status.pairingUrl, secure: status.secure }
  })

  safeHandle('ws:stop', () => {
    stopWsServer()
    return true
  })

  safeHandle('ws:status', async () => {
    const status = getWsStatus()
    const qrDataUrl = status.enabled ? await getQrDataUrl() : null
    return { ...status, qrDataUrl }
  })

  safeHandle('ws:regenerate-token', async () => {
    const token = regenerateToken()
    const status = getWsStatus()
    const qrDataUrl = await getQrDataUrl()
    return { token, qrDataUrl, pairingUrl: status.pairingUrl, secure: status.secure }
  })

  safeHandle('ws:wakelock-enabled', () => {
    return getWakelockEnabled()
  })

  safeHandle('ws:set-wakelock-enabled', (_event, enabled: boolean) => {
    setWakelockEnabled(enabled)
    return getWakelockEnabled()
  })

  safeHandle('ws:auto-start-enabled', () => {
    return isAutoStartEnabled()
  })

  safeHandle('ws:set-auto-start-enabled', (_event, enabled: boolean) => {
    setAutoStartEnabled(enabled)
    return isAutoStartEnabled()
  })
}

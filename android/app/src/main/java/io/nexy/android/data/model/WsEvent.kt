package io.nexy.android.data.model

import org.json.JSONObject

/** One child of a remotely-browsed desktop directory (see WsEvent.FsDirectoryListing).
 *  [fullPath] is joined server-side with the desktop's own path separator — never construct
 *  it client-side, since Android has no idea whether the desktop is Windows or POSIX. */
data class FsEntry(
    val name: String,
    val fullPath: String,
    val isDirectory: Boolean,
)

/** A Project Peek source is an opaque desktop-owned source identity; it never includes a path. */
data class ProjectPeekSource(
    val id: String,
    val label: String,
    val isPrimary: Boolean,
)

data class ProjectPeekEntry(
    val name: String,
    val relativePath: String,
    val isDirectory: Boolean,
    val category: String,
    val sizeBytes: Long,
    val modifiedAt: Long,
    val gitState: String,
)

data class VoiceCapabilitiesWire(
    val protocolVersion: Int = 0,
    val audioUpload: Boolean = false,
    val localWhisperReady: Boolean = false,
    val maxAudioBytes: Long = 0,
    val maxRecordingSeconds: Int = 0,
)

sealed class WsEvent {
    data class Connected(
        val version: String,
        val macAddress: String? = null,
        val broadcastAddress: String? = null,
        val mDnsName: String? = null,
        /** Whether the desktop runs as the installed (packaged) app; null for older desktops. */
        val isPackaged: Boolean? = null,
        /** Absent on older desktops; conservative defaults preserve compatibility. */
        val voiceCapabilities: VoiceCapabilitiesWire = VoiceCapabilitiesWire(),
    ) : WsEvent()
    data class VoiceUploadStarted(
        val sessionId: String,
        val chunkBytes: Int,
        val maxBytes: Long,
    ) : WsEvent()
    data class VoiceUploadAck(
        val sessionId: String,
        val nextSequence: Int,
        val receivedBytes: Long,
    ) : WsEvent()
    data class VoiceTranscription(val sessionId: String, val text: String) : WsEvent()
    data class VoiceUploadCancelled(val sessionId: String) : WsEvent()
    data class VoiceUploadError(
        val sessionId: String?,
        val code: String,
        val message: String,
    ) : WsEvent()
    data class SyncWelcome(
        val protocolVersion: Int,
        val desktopDeviceId: String,
        val datasetId: String,
        val desktopSequence: Long = 0,
        val isDelta: Boolean = false,
        val snapshot: JSONObject,
    ) : WsEvent()
    data class SyncProbeAck(val probeId: String, val serverReceivedAt: Long) : WsEvent()
    data class SyncAck(
        val operationIds: List<String>,
        val lastReceivedSequence: Long,
        val desktopSequence: Long = 0,
        val isDelta: Boolean = false,
        val conflictsJson: String,
        val snapshot: JSONObject?,
    ) : WsEvent()
    data class SyncConflictResolved(val conflictId: String, val resolution: String?) : WsEvent()
    data class SyncError(val code: String, val message: String, val supportedProtocolVersion: Int?) : WsEvent()
    data class SyncAttachmentStatus(
        val contentHash: String,
        val nextOffset: Long,
        val complete: Boolean,
    ) : WsEvent()
    data class SyncAttachmentChunk(
        val contentHash: String,
        val displayName: String,
        val mimeType: String,
        val attachmentId: String?,
        val messageId: String?,
        val sizeBytes: Long,
        val offset: Long,
        val dataBase64: String,
        val complete: Boolean,
    ) : WsEvent()
    data class ToolApprovalRequest(
        val requestId: String,
        val toolName: String,
        val args: Map<String, Any>,
        val description: String = "",
        /** Conversation whose turn requested this approval; null for legacy desktops that don't send it. */
        val conversationId: String? = null,
    ) : WsEvent()
    /** Desktop denied/replaced this request (e.g. a new turn superseded it); drop it from the UI. */
    data class ToolApprovalCancel(
        val requestId: String,
    ) : WsEvent()
    data class ChatToolCallEvent(
        val conversationId: String,
        val id: String? = null,
        val toolName: String,
        val serverName: String?,
        val args: String?,
        val result: String,
        val success: Boolean,
    ) : WsEvent()
    data class ChatStreamChunk(val conversationId: String, val text: String) : WsEvent()
    data class ChatStreamEnd(val conversationId: String) : WsEvent()
    data class ChatThinkingDelta(val conversationId: String, val blockId: String, val chunk: String) : WsEvent()
    data class ChatThinkingEnd(val conversationId: String, val blockId: String) : WsEvent()
    data class ChatCost(val conversationId: String, val inputTokens: Int, val outputTokens: Int, val totalCostUsd: Double) : WsEvent()
    data class ChatActivity(
        val conversationId: String,
        val state: String,
        val label: String,
        val toolName: String?,
        val serverName: String?,
    ) : WsEvent()
    data class ChatTurnEvent(
        val conversationId: String,
        val turnId: String,
        val sequence: Long,
        val type: String,
        val timestamp: Long,
        val payloadJson: String,
    ) : WsEvent()
    data class ActiveTurnToolCall(
        val id: String?,
        val toolName: String,
        val serverName: String?,
        val argsJson: String?,
        val result: String,
        val success: Boolean,
        val inProgress: Boolean,
    )
    data class ActiveTurnActivity(
        val state: String,
        val label: String,
        val toolName: String?,
        val serverName: String?,
    )
    data class ChatActiveTurnSnapshot(
        val conversationId: String,
        val turnId: String,
        val latestSequence: Long,
        val assistantText: String,
        val status: String,
        // Tool calls that already ran (or are still running) as of this snapshot — lets a
        // client that re-fetches this after missing the live events (e.g. re-entering a
        // chat mid-generation) restore ones that already happened, not just the flat text.
        val toolCalls: List<ActiveTurnToolCall> = emptyList(),
        val activity: ActiveTurnActivity? = null,
        // Sequence-ordered replay of every event this turn has emitted so far — lets a
        // client that re-fetches this snapshot rebuild true chronological order (text vs.
        // thinking vs. tool calls) via reduceChatTurn, instead of the flattened buckets
        // above which only preserve within-kind order, not across kinds. Empty for
        // desktop builds older than this field.
        val events: List<ChatTurnEvent> = emptyList(),
    ) : WsEvent()
    data class ChatTeamActivity(
        val conversationId: String,
        val stepId: String,
        val agentName: String,
        val agentIcon: String,
        val task: String,
        val status: String,
        val result: String?,
        val durationMs: Long?,
    ) : WsEvent()
    data class ConversationList(val conversations: List<Conversation>) : WsEvent()
    /** Secret-free capability profile for a single chat. MCP execution remains desktop-hosted. */
    data class ConversationCapabilities(val conversationId: String, val profileJson: String) : WsEvent()
    data class CapabilityPreflight(val conversationId: String, val preflightJson: String) : WsEvent()
    data class CapabilitiesActivated(val conversationId: String, val profileJson: String) : WsEvent()
    data class CapabilitiesError(val conversationId: String, val message: String) : WsEvent()
    /** Secret-free, replaceable capability defaults for one project. */
    data class ProjectCapabilities(val projectId: String, val profile: CapabilityProfile) : WsEvent()
    data class ProjectCapabilitiesUpdated(val projectId: String, val profile: CapabilityProfile) : WsEvent()
    data class ProjectCapabilitiesError(val projectId: String, val message: String) : WsEvent()
    data class ConversationPage(
        val requestId: String,
        val conversations: List<Conversation>,
        val totalCount: Int,
        val nextCursor: String?,
        val hasMore: Boolean,
    ) : WsEvent()
    data class ConversationMessages(
        val conversationId: String,
        val messages: List<HistoryMessage>,
        val requestId: String = "",
        val paged: Boolean = false,
        val hasMore: Boolean = false,
        val nextBeforeTimestamp: Long? = null,
        val nextBeforeId: String? = null,
        val historyVersion: String? = null,
        val chunkIndex: Int? = null,
        val chunkCount: Int? = null,
    ) : WsEvent()
    data class ConversationHistoryStart(
        val conversationId: String,
        val requestId: String,
        val totalItems: Int,
        val chunkCount: Int,
        val historyVersion: String?,
    ) : WsEvent()
    data class ConversationHistoryComplete(
        val conversationId: String,
        val requestId: String,
        val historyVersion: String?,
        val hasMore: Boolean,
        val nextBeforeTimestamp: Long?,
        val nextBeforeId: String?,
    ) : WsEvent()
    data class ConversationHistoryNotModified(
        val conversationId: String,
        val requestId: String,
        val historyVersion: String?,
        val hasMore: Boolean,
    ) : WsEvent()
    data class AgentList(val agents: List<Agent>) : WsEvent()
    data class ProjectList(val projects: List<Project>) : WsEvent()
    data class ModelList(val models: List<ModelOption>, val source: ModelListSource?) : WsEvent()
    data class AndroidUpdateManifestResult(val manifest: AndroidUpdateManifest?) : WsEvent()
    data class CodeChangeError(val reportId: String?, val error: String) : WsEvent()
    data class CodeChangeRepoWire(val relativePath: String, val branch: String, val dirty: Boolean = false)
    data class CodeChangeRepos(val repos: List<CodeChangeRepoWire>) : WsEvent()
    data class CodeChangeFiles(val files: List<String>) : WsEvent()
    data class ChangedFileInfo(val relativePath: String, val staged: Boolean)
    data class CodeChangeChangedFiles(val files: List<ChangedFileInfo>, val seq: Int = 0) : WsEvent()
    data class CodeChangeBranches(val current: String, val local: List<String>, val remote: List<String>, val seq: Int = 0) : WsEvent()
    data class CodeChangeCheckedOut(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeBranchCreated(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeFetched(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeMergeConflictFile(val relativePath: String, val content: String)
    data class CodeChangeMerged(
        val ok: Boolean,
        val conflicted: Boolean,
        val conflictedFiles: List<CodeChangeMergeConflictFile>,
        val error: String?,
        val summary: String?,
    ) : WsEvent()
    data class CodeChangeRepoInitialized(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeCredentialMethod(val label: String, val detail: String)
    data class CodeChangeCredentials(
        val remoteUrl: String?,
        val host: String?,
        val methods: List<CodeChangeCredentialMethod>,
    ) : WsEvent()
    data class CodeChangePulled(
        val ok: Boolean,
        val conflicted: Boolean,
        val conflictedFiles: List<CodeChangeMergeConflictFile>,
        val error: String?,
        val summary: String?,
    ) : WsEvent()
    data class CodeChangeBranchPushed(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeCommitted(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeFileDiscarded(val ok: Boolean, val error: String?, val relativePath: String) : WsEvent()
    data class CodeChangeStashed(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeStashPopped(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeStashCount(val count: Int) : WsEvent()
    data class CodeChangeBranchDeleted(val ok: Boolean, val error: String?, val branchName: String) : WsEvent()
    data class CodeChangeFileDiff(val diff: String, val binary: Boolean, val relativePath: String, val seq: Int = 0) : WsEvent()
    data class CodeChangeStaged(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeUnstaged(val ok: Boolean, val error: String?) : WsEvent()
    data class ConversationModelUpdated(val conversationId: String, val model: String?, val hermesProfile: String? = null) : WsEvent()
    data class ConversationModeUpdated(
        val conversationId: String,
        val thinkingEffortOverride: String?,
        val fullAutoApproveOverride: Boolean?,
        val agenticModeOverride: Boolean?,
        val terminalSandboxOverride: Boolean?,
        val cliModeOverride: String? = null,
        val codexExecutionModeOverride: String? = null,
    ) : WsEvent()
    data class ConversationCreated(
        val id: String,
        val agentId: String?,
        val projectId: String?,
        val title: String,
    ) : WsEvent()
    data class ConversationRenamed(val id: String, val title: String) : WsEvent()
    data class ConversationDeleted(val id: String) : WsEvent()
    data class ConversationSearchResults(val conversations: List<Conversation>) : WsEvent()
    data class MessageDeleted(val id: String) : WsEvent()
    data class ProjectCreated(val project: Project) : WsEvent()
    data class ProjectRenamed(val id: String, val name: String, val color: String? = null) : WsEvent()
    data class ProjectDeleted(val id: String) : WsEvent()
    data class AgentCreated(val agent: Agent) : WsEvent()
    data class AgentUpdated(val agent: Agent) : WsEvent()
    data class AgentDeleted(val id: String) : WsEvent()
    data class AgentFull(val config: AgentFullConfig) : WsEvent()
    data class ProviderList(val providers: List<ProviderInfo>) : WsEvent()
    data class ProviderKeySet(val provider: String) : WsEvent()
    data class ProviderKeyRemoved(val provider: String) : WsEvent()
    data class CliStatus(val clis: Map<String, CliInstallInfo>) : WsEvent()
    data class SettingSet(val key: String, val value: String) : WsEvent()
    data class SettingValue(val key: String, val value: String?) : WsEvent()
    data class McpList(val servers: List<McpServerInfo>) : WsEvent()
    data class McpCatalog(val entries: List<McpCatalogEntry>) : WsEvent()
    data class McpRegistryResults(val result: McpRegistrySearchResult) : WsEvent()
    data class McpRegistryError(val message: String) : WsEvent()
    data class McpTestResult(val ok: Boolean, val toolNames: List<String> = emptyList(), val error: String? = null) : WsEvent()
    data class SkillList(val skills: List<SkillConfig>) : WsEvent()
    data class SkillDiscoveryList(val skills: List<DiscoveredSkill>) : WsEvent()
    data class SkillDiscoveryError(val message: String) : WsEvent()
    data class SkillDetail(val skill: SkillConfig?) : WsEvent()
    data class SkillCreated(val skill: SkillConfig) : WsEvent()
    data class SkillUpdated(val skill: SkillConfig) : WsEvent()
    data class SkillDeleted(val id: String) : WsEvent()
    data class SkillDuplicated(val skill: SkillConfig?) : WsEvent()
    data class SkillExported(val skill: SkillConfig?) : WsEvent()
    data class SkillAgentLinks(val agentId: String, val links: List<SkillAgentLink>) : WsEvent()
    data class SkillAgentUsageList(val usage: List<SkillAgentUsage>) : WsEvent()
    data class ArtifactList(val artifacts: List<ArtifactSummary>) : WsEvent()
    data class ArtifactDetail(val artifactId: String, val artifact: ArtifactDetail2?) : WsEvent()
    data class ArtifactVersions(val artifactId: String, val versions: List<ArtifactVersionSummary>) : WsEvent()
    data class ArtifactDeleted(val id: String, val deleted: Boolean) : WsEvent()
    data class ArtifactVersionDeleted(val versionId: String, val deleted: Boolean, val artifactId: String?) : WsEvent()
    data class ArtifactVersionDeleteError(val message: String) : WsEvent()
    data class ArtifactPromoted(val artifactId: String, val versionId: String, val title: String, val messageId: String?) : WsEvent()
    data class ArtifactPromoteError(val message: String, val messageId: String?) : WsEvent()
    data class ArtifactExportPack(val versionId: String, val files: List<ArtifactExportFile>) : WsEvent()
    data class ArtifactExportError(val message: String) : WsEvent()
    data class WikiList(val entries: List<WikiEntry>) : WsEvent()
    data class WikiEntryCreated(val entry: WikiEntry) : WsEvent()
    data class WikiEntryUpdated(val entry: WikiEntry) : WsEvent()
    data class WikiEntryDeleted(val id: String) : WsEvent()
    data class PromptList(val entries: List<PromptEntry>) : WsEvent()
    data class PromptVersions(val promptId: String, val versions: List<PromptVersion>) : WsEvent()
    data class PromptEntryCreated(val entry: PromptEntry) : WsEvent()
    data class PromptEntryUpdated(val entry: PromptEntry) : WsEvent()
    data class PromptEntryDeleted(val id: String) : WsEvent()
    data class PromptError(val message: String) : WsEvent()
    data class ConversationExportPackResult(val pack: ConversationExportPackData) : WsEvent()
    data class ConversationExportError(val message: String) : WsEvent()
    data class ConversationForked(
        val conversationId: String,
        val title: String,
        val messageCount: Int,
        val projectId: String? = null,
    ) : WsEvent()
    data class ConversationForkError(val message: String) : WsEvent()
    data class ConversationImported(val conversationId: String, val title: String, val messageCount: Int) : WsEvent()
    data class ConversationImportError(val message: String) : WsEvent()
    data class ConversationPinned(val id: String, val pinned: Boolean) : WsEvent()
    data class ConversationContextUpdated(val conversationId: String, val projectId: String?, val agentId: String?) : WsEvent()
    data class MessageInserted(val conversationId: String, val messageId: String, val role: String, val content: String, val timestamp: Long) : WsEvent()
    data class MessagesDeletedAfter(val conversationId: String, val timestamp: Long) : WsEvent()
    data class CompressionPreview(
        val conversationId: String,
        val hasSummary: Boolean,
        val summarizedMessageCount: Int,
        val retainedMessageCount: Int,
        val estimatedTokensBefore: Int,
        val targetBudget: Int,
        val strategy: String?,
        val updatedAt: Long?,
    ) : WsEvent()
    data class CompressionDraft(
        val conversationId: String,
        val summarizedMessageCount: Int,
        val retainedMessageCount: Int,
        val estimatedTokensBefore: Int,
        val targetBudget: Int,
        val strategy: String,
        val sections: CompressionSections,
    ) : WsEvent()
    data class CompressionSaved(val conversationId: String, val hasSummary: Boolean, val summarizedMessageCount: Int, val retainedMessageCount: Int) : WsEvent()
    data class CompressionError(val message: String) : WsEvent()
    data class InspectorSnapshot(val snapshot: ContextInspectorSnapshot?) : WsEvent()
    data class InspectorSnapshotError(val message: String) : WsEvent()
    data class ProjectGeneratorToken(val sessionId: String?, val chunk: String) : WsEvent()
    data class ProjectGeneratorTurnComplete(val sessionId: String?, val content: String, val hasSpec: Boolean = false) : WsEvent()
    data class ProjectGeneratorSpecReady(val sessionId: String?, val spec: ProjectGeneratorSpec) : WsEvent()
    data class ProjectGeneratorCreated(val sessionId: String?, val projectId: String, val name: String) : WsEvent()
    data class ProjectGeneratorError(val sessionId: String?, val message: String) : WsEvent()
    data class ProjectGeneratorCancelled(val sessionId: String?) : WsEvent()
    data class ProjectConfigUpdated(val id: String) : WsEvent()
    data class ProjectConfigChanged(
        val id: String,
        // Newer desktops include the authoritative config in this broadcast. Nullable keeps
        // older desktop versions compatible; Android can fall back to project:get-config.
        val config: ProjectSettingsConfig? = null,
    ) : WsEvent()
    data class ProjectConfig(val id: String, val config: ProjectSettingsConfig) : WsEvent()
    data class ProjectSourcesUpdated(val id: String, val action: String, val config: ProjectSettingsConfig) : WsEvent()
    data class ProjectSourcesError(val id: String, val action: String, val message: String) : WsEvent()
    data class ProjectAgents(val id: String, val agents: List<ProjectAgentEntry>) : WsEvent()
    data class ProjectAuditSessions(val projectId: String?, val sessions: List<ProjectAuditSession>) : WsEvent()
    data class ProjectAuditFiles(val sessionId: String, val files: List<ProjectAuditFile>) : WsEvent()
    data class ProjectAuditDiffLoaded(val sessionId: String, val fileId: String?, val diff: ProjectAuditDiff?) : WsEvent()
    data class ProjectGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()
    data class SkillGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()
    data class ArtifactGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()
    data class AgentGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()
    data class AgentGeneratorToken(val sessionId: String?, val chunk: String) : WsEvent()
    data class AgentGeneratorTurnComplete(val sessionId: String?, val content: String, val hasSpec: Boolean = false) : WsEvent()
    data class AgentGeneratorSpecReady(val sessionId: String?, val spec: AgentGeneratorSpec) : WsEvent()
    data class AgentGeneratorCreated(val sessionId: String?, val agentId: String, val name: String) : WsEvent()
    data class AgentGeneratorError(val sessionId: String?, val message: String) : WsEvent()
    data class AgentGeneratorCancelled(val sessionId: String?) : WsEvent()
    data class ArtifactGeneratorToken(val sessionId: String?, val chunk: String) : WsEvent()
    data class ArtifactGeneratorTurnComplete(val sessionId: String?, val content: String, val hasSpec: Boolean = false) : WsEvent()
    data class ArtifactGeneratorSpecReady(val sessionId: String?, val spec: ArtifactGeneratorSpec) : WsEvent()
    data class ArtifactGeneratorCreated(val sessionId: String?, val artifactId: String, val title: String) : WsEvent()
    data class ArtifactGeneratorError(val sessionId: String?, val message: String) : WsEvent()
    data class ArtifactGeneratorCancelled(val sessionId: String?) : WsEvent()
    data class ArtifactMoveToProject(val artifactId: String, val projectId: String?) : WsEvent()
    data class ArtifactMovedToProject(val artifactId: String, val projectId: String?) : WsEvent()
    data class SkillGeneratorToken(val sessionId: String?, val chunk: String) : WsEvent()
    data class SkillGeneratorTurnComplete(val sessionId: String?, val content: String, val hasSpec: Boolean = false) : WsEvent()
    data class SkillGeneratorSpecReady(val sessionId: String?, val spec: SkillGeneratorSpec) : WsEvent()
    data class SkillGeneratorCreated(val sessionId: String?, val skillId: String, val name: String) : WsEvent()
    data class SkillGeneratorError(val sessionId: String?, val message: String) : WsEvent()
    data class SkillGeneratorCancelled(val sessionId: String?) : WsEvent()
    data class SchedulerGeneratorToken(val sessionId: String?, val chunk: String) : WsEvent()
    data class SchedulerGeneratorTurnComplete(val sessionId: String?, val content: String, val hasSpec: Boolean = false) : WsEvent()
    data class SchedulerGeneratorSpecReady(val sessionId: String?, val spec: ScheduleGeneratorSpec) : WsEvent()
    data class SchedulerGeneratorCreated(val sessionId: String?, val taskId: String, val name: String) : WsEvent()
    data class SchedulerGeneratorError(val sessionId: String?, val message: String) : WsEvent()
    data class SchedulerGeneratorCancelled(val sessionId: String?) : WsEvent()
    data class SchedulerGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()
    data class ProviderAzureEndpoint(val endpoint: String) : WsEvent()
    data class ProviderAzureEndpointSet(val endpoint: String) : WsEvent()
    data class ProviderTestResult(val provider: String, val valid: Boolean, val error: String?) : WsEvent()
    data class AgentKnowledgeFiles(val agentId: String, val files: List<AgentKnowledgeFile>) : WsEvent()
    data class AgentKnowledgeFileAdded(val agentId: String, val file: AgentKnowledgeFile) : WsEvent()
    data class AgentKnowledgeFileRemoved(val agentId: String, val id: String) : WsEvent()
    data class AgentKnowledgeFileContent(val agentId: String, val filePath: String, val content: String) : WsEvent()
    data class AgentKnowledgeFileSaved(val agentId: String, val filePath: String) : WsEvent()
    data class AgentKnowledgeFileError(val message: String) : WsEvent()
    data class AgentMcpToolOverrides(val agentId: String, val overrides: List<AgentMcpToolOverride>) : WsEvent()
    data class AgentMcpServerTrustList(val agentId: String, val trust: List<AgentMcpServerTrust>) : WsEvent()
    data class McpServerAdded(val server: McpServerWithStatus) : WsEvent()
    data class McpServerUpdated(val server: McpServerWithStatus) : WsEvent()
    data class McpServerRemoved(val id: String) : WsEvent()
    data class McpServerStatus(val id: String, val status: String, val error: String?, val toolCount: Int, val sandbox: McpSandboxStatus? = null) : WsEvent()
    data class McpToolList(val agentId: String?, val tools: List<McpToolInfo>) : WsEvent()
    data class WikiMcpStatus(val status: ProjectWikiMcpStatus) : WsEvent()
    data class WikiMcpError(val projectId: String, val message: String) : WsEvent()
    data class WikiExtractionCandidates(val conversationId: String, val candidates: List<WikiExtractionCandidate>) : WsEvent()
    data class WikiExtractionError(val message: String) : WsEvent()
    data class BuildRecords(val records: List<BuildRecord>) : WsEvent()
    data class BuildWorkspaceInfo(val path: String, val branch: String?, val commitSha: String?, val dirty: Boolean, val version: String?, val isGitRepo: Boolean) : WsEvent()
    data class BuildPreflightResult(val checks: List<PreflightCheck>) : WsEvent()
    data class BuildStarted(val buildId: String, val command: String) : WsEvent()
    data class BuildLogChunk(val buildId: String, val line: String, val stream: String, val replace: Boolean = false) : WsEvent()
    data class BuildCommandDone(val buildId: String?, val status: String, val exitCode: Int?, val error: String? = null) : WsEvent()
    data class BuildCancelled(val buildId: String, val cancelled: Boolean) : WsEvent()
    data class UpdateRestarting(val eta: Int, val version: String?, val error: String? = null) : WsEvent()
    data class AndroidWorkspaceInfo(val path: String, val branch: String?, val commitSha: String?, val dirty: Boolean, val versionCode: Int?, val versionName: String?, val isGitRepo: Boolean, val hasGradleProject: Boolean) : WsEvent()
    data class AndroidSigningValidation(val valid: Boolean, val checks: List<PreflightCheck>) : WsEvent()
    data class AndroidPublishResult(val published: Boolean, val error: String?, val manifest: AndroidPublishManifest?) : WsEvent()
    data class AndroidRestoreResult(val restored: Boolean, val error: String?, val manifest: AndroidPublishManifest?) : WsEvent()
    // Scheduler
    data class SchedulerTaskList(val tasks: List<ScheduledTask>) : WsEvent()
    data class SchedulerTaskUpdated(val task: ScheduledTask) : WsEvent()
    data class SchedulerTaskDeleted(val taskId: String) : WsEvent()
    data class SchedulerRunUpdated(val run: ScheduledRun) : WsEvent()
    data class SchedulerRunList(val taskId: String, val runs: List<ScheduledRun>) : WsEvent()
    data class SchedulerRunError(val taskId: String, val error: String) : WsEvent()
    /** Candidate saved Automated Workflow runs for the "attach an existing workflow to this
     *  schedule" picker — fetched over WS since Android has no direct DB access. */
    data class SchedulerWorkflowTemplates(val runs: List<AutomatedWorkflowRunInfo>) : WsEvent()
    // Debrief
    // artifactId/versionId are the debrief's artifact-backed home (desktop Phase 2) — null when
    // talking to an older desktop build that hasn't migrated debrief off conversation_debriefs yet.
    data class DebriefReady(val debrief: ConversationDebrief, val artifactId: String? = null, val versionId: String? = null) : WsEvent()
    data class DebriefLoaded(val conversationId: String?, val debrief: ConversationDebrief?) : WsEvent()
    data class DebriefError(val message: String) : WsEvent()
    data class DebriefStoryReady(val conversationId: String, val story: DebriefStory, val artifactId: String? = null, val versionId: String? = null) : WsEvent()
    data class DebriefStoryError(val message: String) : WsEvent()
    data class DebriefConversationCompleted(val conversationId: String, val completedAt: Long) : WsEvent()
    data class DebriefConversationIncompleted(val conversationId: String) : WsEvent()
    // Ratings
    data class RatingUpdated(val conversationId: String, val rating: ConversationRating?) : WsEvent()
    data class RatingLoaded(val conversationId: String, val rating: ConversationRating?) : WsEvent()
    data class RatingError(val message: String) : WsEvent()
    data class RatingListLoaded(val ratings: List<ConversationRatingListItem>) : WsEvent()
    data class RatingStatsLoaded(val stats: ConversationRatingStats) : WsEvent()
    // Quiz
    data class QuizReady(val questions: List<QuizQuestion>, val artifactId: String? = null, val versionId: String? = null, val conversationId: String? = null) : WsEvent()
    data class QuizLoaded(val conversationId: String, val questions: List<QuizQuestion>?, val artifactId: String? = null, val versionId: String? = null) : WsEvent()
    data class QuizError(val message: String) : WsEvent()
    data class TeachbackReady(val conversationId: String, val artifactId: String, val versionId: String, val exercise: TeachbackExercise) : WsEvent()
    data class TeachbackLoaded(val conversationId: String, val artifactId: String?, val versionId: String?, val exercise: TeachbackExercise?) : WsEvent()
    data class TeachbackGraded(val artifactId: String, val versionId: String, val feedback: TeachbackFeedback) : WsEvent()
    data class TeachbackAttempts(val artifactId: String, val attempts: List<TeachbackAttempt>) : WsEvent()
    data class TeachbackError(val message: String) : WsEvent()

    data class ActivityChanged(val activities: List<io.nexy.android.data.BackgroundActivity>) : WsEvent()
    data class NewContentChanged(val conversations: List<NewContentConversation>) : WsEvent()
    // Provider Key Handoff (opt-in, consent-gated exception)
    data class ProviderKeyHandoffRequest(
        val providerId: String,
        val providerName: String,
    ) : WsEvent()
    data class ProviderKeyHandoffValue(
        val providerId: String,
        val keyValue: String,
    ) : WsEvent()
    // Automated Workflow Generator
    data class AutomatedWorkflowReady(
        val sessionId: String,
        val title: String,
        val goalSummary: String,
        val assumptions: String,
        val steps: List<AutomatedWorkflowStepInfo>,
        /** The raw spec JSON (title/goalSummary/assumptions/steps incl. agentId + dependsOnStepIds),
         *  kept verbatim so it can be forwarded as-is to automated-workflow-runs:save-spec without
         *  the friendlier [AutomatedWorkflowStepInfo] view's field loss. */
        val rawSpec: Map<String, Any> = emptyMap(),
    ) : WsEvent()
    data class AutomatedWorkflowModel(val sessionId: String, val modelId: String) : WsEvent()
    data class AutomatedWorkflowToken(val sessionId: String, val chunk: String) : WsEvent()
    data class AutomatedWorkflowMessage(val sessionId: String, val message: String) : WsEvent()
    data class AutomatedWorkflowError(val sessionId: String, val message: String) : WsEvent()
    data class AutomatedWorkflowCancelled(val sessionId: String) : WsEvent()
    // Persisted automated workflow runs
    data class AutomatedWorkflowRunsList(val projectId: String?, val runs: List<AutomatedWorkflowRunInfo>) : WsEvent()
    /** Every run regardless of project — backs the global, top-level Automated Workflows list screen. */
    data class AutomatedWorkflowRunsListAll(val runs: List<AutomatedWorkflowRunInfo>) : WsEvent()
    data class AutomatedWorkflowRunDetailReady(val run: AutomatedWorkflowRunInfo?) : WsEvent()
    data class AutomatedWorkflowRunDiscarded(val runId: String, val ok: Boolean) : WsEvent()
    /** Live token stream for a step actually being executed by the automated runner — distinct
     *  from AutomatedWorkflowToken, which streams the plan-generation chat, not a step's own run. */
    data class AutomatedWorkflowStepStream(val runId: String, val stepDbId: String, val chunk: String) : WsEvent()
    data class ManagedWorkflowSources(val projectId: String, val sources: List<ManagedWorkflowSourceOption>) : WsEvent()
    data class ManagedWorkflowVersionReady(val version: ManagedWorkflowVersionContent?) : WsEvent()
    data class ManagedWorkflowBindingsReady(val runId: String, val stepDbId: String?, val bindings: List<ManagedWorkflowBindingRecord>) : WsEvent()
    data class ManagedWorkflowPublishPreviewReady(val preview: ManagedWorkflowPublishPreview) : WsEvent()
    data class ManagedWorkflowPublishActionReady(val action: ManagedWorkflowPublishAction) : WsEvent()
    /** automated-workflow-runs:* commands reply with this on failure (a bad spec, a DB error) —
     *  see ws-handlers.ts's try/catch-with-reply — so the UI can surface it instead of a
     *  permanently-stuck "Saving…" button with no explanation. */
    data class AutomatedWorkflowRunsError(val message: String) : WsEvent()
    // Remote workspace file explorer — depth-1 per request, re-fetched lazily on each folder tap
    // rather than pre-fetched deep, to keep WS payloads small (see fs:list-directory on desktop).
    data class FsDirectoryListing(
        val path: String,
        val entries: List<FsEntry>,
        val truncated: Boolean,
        val error: String?,
    ) : WsEvent()
    data class FsStartRoots(val home: String, val recents: List<String>) : WsEvent()
    data class FsFileContent(
        val requestId: String?,
        val path: String,
        val content: String,
        val truncated: Boolean,
        val error: String?,
        val mimeType: String = "text/markdown",
        val encoding: String = "utf8",
    ) : WsEvent()
    data class ProjectPeekSources(val projectId: String, val sources: List<ProjectPeekSource>) : WsEvent()
    data class ProjectPeekDirectory(
        val projectId: String,
        val sourceId: String,
        val relativePath: String,
        val filter: String,
        val entries: List<ProjectPeekEntry>,
        val truncated: Boolean,
        val error: String?,
    ) : WsEvent()
    data class ProjectPeekFileContent(
        val projectId: String,
        val sourceId: String,
        val relativePath: String,
        val requestId: String?,
        val content: String,
        val truncated: Boolean,
        val error: String?,
        val mimeType: String?,
        val encoding: String?,
    ) : WsEvent()
    // Sub-resource replies for the HTML preview WebView's request interceptor — never surfaced
    // directly in the UI, consumed only by ProjectPeekAssetLoader.
    data class ProjectPeekAssetContent(
        val projectId: String,
        val sourceId: String,
        val relativePath: String,
        val requestId: String?,
        val content: String,
        val truncated: Boolean,
        val error: String?,
        val mimeType: String?,
        val encoding: String?,
    ) : WsEvent()
}

data class BuildRecord(
    val id: String,
    val workspacePath: String,
    val commitSha: String?,
    val branch: String?,
    val version: String?,
    val versionCode: Int?,
    val platform: String,
    val command: String,
    val status: String,
    val exitCode: Int?,
    val artifactPaths: List<String>,
    val logTail: String,
    val startedAt: Long,
    val finishedAt: Long?,
)

data class PreflightCheck(
    val label: String,
    val status: String,
    val detail: String,
)

data class AndroidPublishManifest(
    val versionCode: Int,
    val versionName: String,
    val commitSha: String?,
    val changelog: String,
    val checksum: String,
    val artifactUrl: String,
    val publishedAt: Long,
)

data class AgentKnowledgeFile(
    val id: String,
    val agentId: String,
    val filePath: String,
    val injectMode: String,
    val sortOrder: Int,
    val createdAt: Long,
    val updatedAt: Long,
)

data class AgentMcpToolOverride(
    val agentId: String,
    val serverId: String,
    val toolName: String,
    val enabled: Boolean,
    val approval: String,
    val instructions: String,
)

data class AgentMcpServerTrust(
    val serverId: String,
    val trust: String,
)

data class McpSandboxStatus(
    val status: String,
    val backend: String? = null,
    val helperVersion: String? = null,
    val helperPid: Int? = null,
    val serverPid: Int? = null,
    val diagnostics: String? = null,
)

data class McpSandboxGrant(
    val path: String,
    val access: String,
)

data class McpSandboxProfile(
    val version: Int = 1,
    val network: String = "blocked",
    val childProcesses: String = "blocked",
    val filesystem: List<McpSandboxGrant> = emptyList(),
)

data class McpServerWithStatus(
    val id: String,
    val name: String,
    val description: String = "",
    val command: String,
    val args: List<String> = emptyList(),
    val enabled: Boolean,
    val status: String,
    val error: String? = null,
    val toolCount: Int = 0,
    val managed: Boolean = false,
    val sandbox: McpSandboxStatus? = null,
    val sandboxProfile: McpSandboxProfile = McpSandboxProfile(),
)

data class McpToolInfo(
    val name: String,
    val description: String?,
    val serverId: String,
    val serverName: String,
)

data class WikiExtractionCandidate(
    val title: String,
    val body: String,
    val tags: List<String>,
)

data class CompressionSections(
    val goals: List<String> = emptyList(),
    val decisions: List<String> = emptyList(),
    val constraints: List<String> = emptyList(),
    val filesTouched: List<String> = emptyList(),
    val commandsRun: List<String> = emptyList(),
    val openQuestions: List<String> = emptyList(),
    val nextActions: List<String> = emptyList(),
    val recentContextNotes: List<String> = emptyList(),
)

typealias CompressionPreview = WsEvent.CompressionPreview
typealias CompressionDraft = WsEvent.CompressionDraft

data class ContextInspectorRefSnapshot(
    val token: String,
    val key: String,
    val estimatedTokens: Int,
)

data class ContextInspectorAttachmentSnapshot(
    val name: String,
    val size: Long,
    val estimatedTokens: Int,
)

data class ContextInspectorNextRequest(
    val inputTokens: Int,
    val quality: String,
    val source: String,
    val model: String? = null,
)

data class ContextInspectorTurnTotal(
    val inputTokens: Int,
    val outputTokens: Int,
    val requestCount: Int,
    val quality: String,
    val source: String,
    val complete: Boolean,
)

/** Mirrors the desktop's ContextInspectorSnapshot (src/shared/types.ts) relayed from the focused Electron window. */
data class ContextInspectorSnapshot(
    val conversationId: String?,
    val model: String,
    val systemPrompt: String,
    val systemPromptTokens: Int,
    val contextRefs: List<ContextInspectorRefSnapshot> = emptyList(),
    val attachments: List<ContextInspectorAttachmentSnapshot> = emptyList(),
    val imageCount: Int,
    val historyMessageCount: Int,
    val currentInputTokens: Int,
    val totalTokens: Int,
    val maxTokens: Int,
    val nextRequest: ContextInspectorNextRequest? = null,
    val turnTotal: ContextInspectorTurnTotal? = null,
)

data class ProjectAgentEntry(
    val agentId: String,
    val agentName: String,
    val agentIcon: String,
    val isPrimary: Boolean,
    val sortOrder: Int,
)

data class HistoryMessage(
    val id: String,
    val role: String,
    val content: String,
    val timestamp: Long,
    val timelineOrder: Long? = null,
    val attachments: List<AttachmentMeta> = emptyList(),
    val thinkingBlocks: List<ThinkingBlock> = emptyList(),
    // Ordered response-text bursts when the reply was interrupted by a tool call (e.g.
    // "I'll check X." -> tool call -> "Here's the answer.") — reuses ThinkingBlock's
    // shape (blockId/content/done) since the data is structurally identical. `content`
    // remains the full concatenated text regardless; this is purely a rendering aid for
    // interleaving with tool-call messages, mirroring desktop's text_segments column.
    val textSegments: List<ThinkingBlock> = emptyList(),
    val userInputs: List<io.nexy.android.ui.chat.ChatTurnUserInput> = emptyList(),
    val model: String? = null,
)

data class ThinkingBlock(
    val blockId: String,
    val content: String,
    val done: Boolean,
    // Wall-clock ms when this block's first chunk arrived — lets historical rendering
    // interleave thinking/text blocks with the tool-call rows that actually separated
    // them (via real timestamps) instead of always grouping every block together ahead
    // of the tool calls. Null for blocks persisted before this field existed.
    val firstSeenAt: Long? = null,
)

data class AttachmentMeta(
    val id: String,
    val name: String,
    val type: String?,
    val thumbnailDataUrl: String?,
)

/** Mirrors desktop's `AutomatedWorkflowStep` (src/shared/types.ts). Notably missing
 *  `dependsOnStepIds`: it's structurally dropped from this pre-save view — only the saved-run
 *  model ([AutomatedWorkflowRunStepData]) carries it. */
data class AutomatedWorkflowStepInfo(
    val id: String,
    val title: String,
    val summary: String,
    val agentName: String?,
    val prompt: String,
    val expectedOutput: String,
    // Alternative to agentName — a bare-model step (no agent) gets no skill augmentation at all.
    val model: String? = null,
    val kind: String? = null,
    val projectSourceId: String? = null,
    val includePaths: List<String> = emptyList(),
    val outputName: String? = null,
    val reviewOutputName: String? = null,
    val publishProjectSourceId: String? = null,
    val publishRelativePath: String? = null,
)

data class ManagedWorkflowBindingRecord(
    val id: String,
    val runId: String,
    val stepDbId: String,
    val stepAttempt: Int,
    val bindingName: String,
    val direction: String,
    val artifactId: String,
    val artifactVersionId: String,
    val sourceStepDbId: String?,
    val staleAt: Long?,
    val createdAt: Long,
)

data class ManagedWorkflowVersionSummary(
    val id: String,
    val artifactId: String,
    val versionNumber: Int,
    val title: String,
    val primaryPath: String,
    val mediaType: String,
    val sizeBytes: Long,
    val checksum: String?,
    val createdAt: Long,
)

data class ManagedWorkflowReviewRecord(
    val id: String,
    val runId: String,
    val stepDbId: String,
    val artifactVersionId: String,
    val decision: String,
    val reviewedByClient: String,
    val reviewedAt: Long,
    val supersededAt: Long?,
)

data class ManagedWorkflowPublishPreview(
    val id: String,
    val runId: String,
    val stepDbId: String,
    val artifactVersionId: String,
    val projectSourceId: String,
    val relativePath: String,
    val destinationChecksum: String?,
    val diffText: String,
    val createdAt: Long,
    val expiresAt: Long?,
    val invalidatedAt: Long?,
)

data class ManagedWorkflowPublishAction(
    val id: String,
    val previewId: String,
    val idempotencyKey: String,
    val status: String,
    val approvedByClient: String,
    val approvedAt: Long,
    val startedAt: Long?,
    val completedAt: Long?,
    val resultChecksum: String?,
    val error: String?,
)

data class ManagedWorkflowStepState(
    val isManaged: Boolean = true,
    val isStale: Boolean = false,
    val currentVersion: ManagedWorkflowVersionSummary? = null,
    val bindings: List<ManagedWorkflowBindingRecord> = emptyList(),
    val latestReview: ManagedWorkflowReviewRecord? = null,
    val publishPreview: ManagedWorkflowPublishPreview? = null,
    val publishAction: ManagedWorkflowPublishAction? = null,
)

data class ManagedWorkflowVersionContent(
    val version: ManagedWorkflowVersionSummary,
    val content: String,
    val manifestJson: String,
    val versions: List<ManagedWorkflowVersionSummary> = emptyList(),
)

data class ManagedWorkflowSourceOption(
    val projectSourceId: String,
    val projectId: String,
    val label: String,
    val relativePath: String,
    val sizeBytes: Long,
)

/** Mirrors desktop's `AutomatedWorkflowRunStep` (src/shared/types.ts). */
data class AutomatedWorkflowRunStepData(
    val id: String,
    val dbId: String,
    val runId: String,
    val stepIndex: Int,
    val title: String,
    val summary: String,
    val agentId: String?,
    val agentName: String?,
    val prompt: String,
    val expectedOutput: String,
    val dependsOnStepIds: List<String> = emptyList(),
    val status: String,
    val attempt: Int = 0,
    val output: String = "",
    val error: String? = null,
    val conversationId: String? = null,
    val startedAt: Long?,
    val completedAt: Long?,
    // Alternative to agentId, not additional to it — a step fulfilled by a bare model gets no
    // skill augmentation at all (skills are strictly agent-gated).
    val model: String? = null,
    val kind: String? = null,
    val managed: ManagedWorkflowStepState? = null,
)

/** Mirrors desktop's `AutomatedWorkflowRunDetail extends AutomatedWorkflowRunSummary` (src/shared/types.ts).
 *  Used for both list rows (steps/assumptions empty) and full detail (steps populated).
 *  projectId is nullable — an Automated Workflow run is project-optional, so it can be a
 *  self-contained, standalone entity (see src/roadmap-new/). */
data class AutomatedWorkflowRunInfo(
    val id: String,
    val projectId: String?,
    val title: String,
    val goalSummary: String,
    val model: String?,
    val status: String,
    val confirmationMode: String = "gated",
    val currentStepId: String? = null,
    val lastError: String? = null,
    val stepCounts: StepCounts,
    val createdAt: Long,
    val updatedAt: Long,
    val assumptions: List<String> = emptyList(),
    val steps: List<AutomatedWorkflowRunStepData> = emptyList(),
    // Back-link to the reusable spec this run was created from — null for runs created before
    // templates existed. Lets a terminal run offer "Run again" without re-describing the goal.
    val templateId: String? = null,
) {
    data class StepCounts(
        val total: Int,
        val pending: Int,
        val running: Int = 0,
        val awaitingConfirmation: Int = 0,
        val done: Int,
        val failed: Int = 0,
        val skipped: Int = 0,
    )
}

data class ProviderInfo(
    val id: String,
    val label: String,
    /** True only when a real, usable key exists on THIS device (local encrypted store). */
    val configured: Boolean,
    /** True when desktop reports this provider as configured but this device has no local
     *  key for it — the key value never syncs automatically, so it's not usable standalone
     *  without an explicit key handoff or manual entry. */
    val configuredOnDesktopOnly: Boolean = false,
)

data class CliInstallInfo(
    val installed: Boolean,
    val version: String?,
    val path: String?,
)

data class McpServerInfo(
    val id: String,
    val name: String,
    val description: String = "",
    val command: String,
    val args: List<String> = emptyList(),
    val enabled: Boolean,
    val status: String? = null,
    val error: String? = null,
    val toolCount: Int = 0,
    val managed: Boolean = false,
    val sandbox: McpSandboxStatus? = null,
    val sandboxProfile: McpSandboxProfile = McpSandboxProfile(),
)

data class McpCatalogRequiredEnv(
    val key: String,
    val label: String,
    val helpUrl: String? = null,
    val secret: Boolean = false,
)

data class McpCatalogEntry(
    val id: String,
    val name: String,
    val capability: String = name,
    val description: String,
    val category: String,
    val access: String = "",
    val impact: String = "read-only",
    val command: String,
    val args: List<String> = emptyList(),
    val env: Map<String, String> = emptyMap(),
    val imageResponses: String? = null,
    val requiredEnv: List<McpCatalogRequiredEnv> = emptyList(),
    val docsUrl: String? = null,
    val keywords: List<String> = emptyList(),
)

data class McpRegistryEnvRequirement(
    val key: String,
    val label: String,
    val helpUrl: String? = null,
    val secret: Boolean = false,
)

data class McpRegistryInstallConfig(
    val command: String,
    val args: List<String> = emptyList(),
    val requiredEnv: List<McpRegistryEnvRequirement> = emptyList(),
)

data class McpRegistryServer(
    val name: String,
    val title: String? = null,
    val description: String,
    val version: String,
    val docsUrl: String? = null,
    val repositoryUrl: String? = null,
    val status: String = "active",
    val statusMessage: String? = null,
    val transport: String = "unknown",
    val install: McpRegistryInstallConfig? = null,
)

data class McpRegistrySearchResult(
    val servers: List<McpRegistryServer> = emptyList(),
    val fetchedAt: Long = 0L,
    val stale: Boolean = false,
)

data class ProjectWikiMcpStdio(
    val command: String,
    val args: List<String> = emptyList(),
    val env: Map<String, String> = emptyMap(),
)

data class ProjectWikiMcpStatus(
    val projectId: String,
    val running: Boolean,
    val url: String? = null,
    val stdio: ProjectWikiMcpStdio? = null,
)

data class SkillConfig(
    val id: String,
    val name: String,
    val icon: String,
    val description: String,
    val instructions: String,
    val tags: List<String>,
    val tools: SkillTools,
    val mcpServers: List<String>,
    val mcpServerTrust: List<SkillMcpServerTrust>,
    val mcpToolOverrides: List<SkillMcpToolOverride>,
    val knowledge: List<SkillKnowledge>,
    val createdAt: Long?,
    val updatedAt: Long?,
    val packagePath: String? = null,
    val contentHash: String? = null,
    val scope: String = "user",
    val source: String = "nexy",
    val validationStatus: String = "valid",
    val packageFiles: List<SkillPackageFile> = emptyList(),
)

data class SkillPackageFile(
    val relativePath: String,
    val encoding: String,
    val content: String,
    val sizeBytes: Long,
)

data class DiscoveredSkill(
    val packagePath: String,
    val name: String,
    val description: String,
    val icon: String,
    val scope: String,
    val source: String,
    val rootLabel: String,
    val validationStatus: String,
    val validationErrors: List<String> = emptyList(),
    val validationWarnings: List<String> = emptyList(),
    val importable: Boolean = true,
    val contentHash: String? = null,
    val alreadyImported: Boolean = false,
)

data class SkillTools(
    val fileEdit: SkillToolConfig,
    val terminal: SkillToolConfig,
    val webFetch: SkillToolConfig,
)

data class SkillToolConfig(
    val enabled: Boolean,
    val approval: String,
    val instructions: String,
)

data class SkillKnowledge(
    val title: String,
    val content: String,
)

data class SkillMcpServerTrust(
    val serverId: String,
    val trust: String,
)

data class SkillMcpToolOverride(
    val serverId: String,
    val toolName: String,
    val enabled: Boolean,
    val approval: String,
    val instructions: String,
)

data class SkillAgentLink(
    val skillId: String,
    val sortOrder: Int,
)

data class SkillAgentUsage(
    val skillId: String,
    val agentCount: Int,
)

data class ArtifactSummary(
    val id: String,
    val projectId: String?,
    val title: String,
    val kind: String,
    val description: String?,
    val storageRoot: String?,
    val status: String,
    val currentVersionId: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

data class ArtifactVersionFile(
    val id: String,
    val relativePath: String,
    val absolutePath: String? = null,
    val mediaType: String,
    val role: String,
)

data class ArtifactExportFile(
    val relativePath: String,
    val mediaType: String,
    val contentBase64: String,
)

data class ArtifactVersionSummary(
    val id: String,
    val artifactId: String,
    val versionNumber: Int,
    val title: String,
    val notes: String?,
    val createdAt: Long,
    val files: List<ArtifactVersionFile>,
)

data class ArtifactDetail2(
    val id: String,
    val projectId: String?,
    val title: String,
    val kind: String,
    val description: String?,
    val storageRoot: String?,
    val status: String,
    val currentVersionId: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val currentVersion: ArtifactVersionSummary?,
)

data class WikiEntry(
    val id: String,
    val projectId: String,
    val title: String,
    val body: String,
    val tags: List<String>,
    val sourceConversationId: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

data class PromptEntry(
    val id: String,
    val title: String,
    val body: String,
    val description: String,
    val category: String,
    val tags: List<String>,
    val scope: String,
    val projectId: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

data class PromptVersionDiff(
    val titleChanged: Boolean,
    val descriptionChanged: Boolean,
    val categoryChanged: Boolean,
    val tagsChanged: Boolean,
    val scopeChanged: Boolean,
    val addedLines: List<String>,
    val removedLines: List<String>,
)

data class PromptVersion(
    val id: String,
    val promptId: String,
    val version: Int,
    val title: String,
    val body: String,
    val description: String,
    val category: String,
    val tags: List<String>,
    val variables: List<String>,
    val scope: String,
    val projectId: String?,
    val source: String,
    val createdAt: Long,
    val diff: PromptVersionDiff,
)

data class ProjectGeneratorSpec(
    val name: String,
    val color: String,
    val instructions: String,
    val rootDirectory: String?,
    val sources: List<ProjectGeneratorSourceSpec> = emptyList(),
    val instructionMode: String?,
    val variables: List<Map<String, String>>,
    val inScope: List<Map<String, String>>,
    val outOfScope: List<Map<String, String>>,
    val milestones: List<Map<String, String>>,
    val orchestrationEnabled: Boolean,
    val defaultModel: String?,
    val agents: List<ProjectGeneratorAgentSpec>,
)

data class ProjectGeneratorSourceSpec(
    val key: String,
    val label: String,
    val mode: String = "attach-existing",
    val localPath: String? = null,
    val remoteUrl: String? = null,
    val discovery: String = "scan-children",
)

data class ProjectSource(
    val id: String,
    val projectId: String,
    val label: String,
    val kind: String,
    val localPath: String,
    val enabled: Boolean,
    val isPrimary: Boolean,
)

data class ProjectRepositoryBinding(
    val id: String,
    val projectId: String,
    val sourceId: String,
    val label: String,
    val relativePath: String,
    val branch: String?,
    val dirty: Boolean?,
    val enabled: Boolean,
    val available: Boolean,
)

data class ProjectGeneratorAgentSpec(
    val role: String,
    val description: String,
    val existingAgentId: String?,
    val isLeader: Boolean,
    val newAgent: ProjectGeneratorNewAgent?,
)

data class ProjectGeneratorNewAgent(
    val name: String,
    val icon: String,
    val systemPrompt: String,
    val temperature: Double,
    val responseFormat: String,
    val tools: ProjectGeneratorAgentTools,
)

data class ProjectGeneratorAgentTools(
    val fileEdit: Boolean,
    val terminal: Boolean,
    val webFetch: Boolean,
)

data class ConversationExportPackData(
    val format: String,
    val conversationId: String,
    val fileName: String,
    val mimeType: String,
    val content: String,
)

data class ProjectSettingsConfig(
    val instructions: String,
    val rootDirectory: String?,
    val sources: List<ProjectSource> = emptyList(),
    val repositories: List<ProjectRepositoryBinding> = emptyList(),
    val variables: List<Map<String, String>> = emptyList(),
    val instructionMode: String,
    val instructionsEnabled: Boolean = true,
    val workflowMode: String = "single-agent",
    val orchestrationEnabled: Boolean,
    val maxDelegationDepth: Int = 5,
    val showTeamActivity: Boolean = true,
    val inScope: List<Map<String, String>> = emptyList(),
    val outOfScope: List<Map<String, String>> = emptyList(),
    val milestones: List<Map<String, String>> = emptyList(),
    val defaultModel: String?,
    val projectHermesProfile: String? = null,
    val defaultThinkingEffort: String? = null,
    /** IDs and approval policy only; MCP credentials never leave the desktop. */
    val capabilityProfile: CapabilityProfile = CapabilityProfile(),
)

data class CapabilityProfile(
    val version: Int = 1,
    val skillIds: List<String> = emptyList(),
    val mcp: List<CapabilityMcpGrant> = emptyList(),
    val builtInTools: Map<String, CapabilityBuiltInToolPolicy> = emptyMap(),
)

data class CapabilityMcpGrant(
    val serverId: String,
    val trust: String = "always-ask",
)

/** Project/chat policy for Nexy's desktop-hosted built-in tools. */
data class CapabilityBuiltInToolPolicy(
    val enabled: Boolean,
    val approval: String = "always-ask",
)

data class AgentGeneratorSpec(
    val name: String,
    val icon: String,
    val systemPrompt: String,
    val temperature: Double,
    val responseFormat: String,
    val agenticMode: Boolean,
    val tools: AgentGeneratorTools,
    val rootDirectory: String?,
    val contextDirectories: List<String>,
    val memory: String?,
)

data class AgentGeneratorTools(
    val fileEdit: Boolean,
    val terminal: Boolean,
    val webFetch: Boolean,
)

data class SkillGeneratorSpec(
    val name: String,
    val icon: String,
    val description: String,
    val instructions: String,
    val tools: SkillGeneratorTools,
    val toolInstructions: Map<String, String> = emptyMap(),
    val approval: Map<String, String> = emptyMap(),
    val mcpServers: List<String> = emptyList(),
    val tags: List<String> = emptyList(),
    val knowledge: List<SkillKnowledge> = emptyList(),
    val suggestedAgents: List<String> = emptyList(),
)

data class SkillGeneratorTools(
    val fileEdit: Boolean,
    val terminal: Boolean,
    val webFetch: Boolean,
)

data class ArtifactGeneratorSpec(
    val title: String,
    val kind: String,
    val scopeType: String,
    val scopeProjectId: String?,
    val intendedUse: String,
    val audience: String?,
    val outputFiles: List<ArtifactOutputFile>,
    val acceptanceCriteria: List<String>,
    val exportFormats: List<String>,
    val sourceContext: ArtifactSourceContext,
)

data class ArtifactOutputFile(
    val path: String,
    val mediaType: String,
    val role: String,
    val description: String?,
)

data class ArtifactSourceContext(
    val useProjectInstructions: Boolean,
    val useProjectWiki: Boolean,
    val useConversationContext: Boolean,
    val referencedFiles: List<String>,
)

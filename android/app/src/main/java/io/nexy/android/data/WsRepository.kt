package io.nexy.android.data

import android.app.Application
import io.nexy.android.BuildConfig
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.ScheduledTask
import io.nexy.android.data.model.ScheduledRun
import io.nexy.android.data.model.ConversationDebrief
import io.nexy.android.data.model.ConversationRating
import io.nexy.android.data.model.ConversationRatingListItem
import io.nexy.android.data.model.ConversationRatingStats
import io.nexy.android.data.model.AgentKnowledgeFile
import io.nexy.android.data.model.AgentMcpServerTrust
import io.nexy.android.data.model.AgentMcpToolOverride
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ArtifactGeneratorSpec
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.HermesCliInfo
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.isVisibleInProject
import io.nexy.android.data.model.normalizePromptProjectId
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.NewContentConversation
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.McpCatalogEntry
import io.nexy.android.data.model.McpToolInfo
import io.nexy.android.data.model.WikiExtractionCandidate
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.ManagedWorkflowSourceOption
import io.nexy.android.data.model.ManagedWorkflowVersionContent
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.ProjectSettingsConfig
import io.nexy.android.data.model.ScheduleGeneratorSpec
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.data.model.SkillPackageFile
import io.nexy.android.data.model.DiscoveredSkill
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WsEvent
import io.nexy.android.data.local.LocalDataRepository
import io.nexy.android.data.local.ConflictEntity
import io.nexy.android.data.local.OutboxEntity
import io.nexy.android.data.local.LocalSettingsStore
import io.nexy.android.data.repository.CapabilityState
import io.nexy.android.data.repository.InternetState
import io.nexy.android.notification.ApprovalNotificationManager
import io.nexy.android.notification.ChatCompleteNotificationManager
import io.nexy.android.notification.GenerationNotificationManager
import io.nexy.android.NexyApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

enum class ConnectionState { DISCONNECTED, CONNECTING, CONNECTED, POLLING }
enum class SyncProgressPhase { CONNECTING, RECEIVING, APPLYING, UPLOADING, COMPLETE }

// Requested connect-snapshot hydration mode (item B). "shell" asks the desktop for metadata only
// (conversation/project/agent/wiki/prompt/skill rows, including each conversation's `last_message`
// preview) and defers bulk message bodies to on-demand conversation:get-messages loads. Desktops
// that predate the field ignore it and return the full snapshot.
private const val STANDALONE_SYNC_HYDRATION_MODE = "shell"

// Bounded post-connect prefetch (item E). After a shell snapshot, warm the newest few
// conversations' latest messages into Room so the most-likely taps open from cache instead of
// costing a round-trip. Kept deliberately small so it never recreates the monolithic-snapshot cost.
private const val PREFETCH_CONVERSATION_COUNT = 5
private const val PREFETCH_MESSAGE_LIMIT = 5

/**
 * How long the app-wide sync signal may stay true without any observable progress before it is
 * treated as stalled and cleared.
 *
 * `syncInProgress` drives the animated content-sync indicator, and standalone sync is an
 * event-only protocol: `sync:hello` / `sync:push` set it true and only a matching desktop reply
 * ever sets it false. A reply that never arrives (half-open socket, a desktop that dies mid-batch,
 * a snapshot apply that is cancelled) therefore used to pin the indicator on forever. Progress
 * (a changed SyncProgress) re-arms the window, so a genuinely slow snapshot is never cut short.
 */
private const val SYNC_STALL_TIMEOUT_MS = 30_000L

/**
 * How long a `sync:push` may wait for its `sync:ack` before the outbox is considered drainable
 * again. Without this, a push whose reply is lost (half-open socket, desktop killed mid-batch)
 * would leave `pushInFlight` true forever and permanently suppress auto-draining — trading one
 * stuck-queue bug for another.
 */
private const val SYNC_PUSH_ACK_TIMEOUT_MS = 30_000L

/** Debounce for outbox-driven pushes, so a burst of enqueues in one turn becomes one batch. */
private const val OUTBOX_DRAIN_DEBOUNCE_MS = 250L

data class SyncProgress(
    val phase: SyncProgressPhase = SyncProgressPhase.COMPLETE,
    val completed: Int = 0,
    val total: Int = 0,
)

enum class StandaloneModeTransition { NONE, ENTERED_STANDALONE, EXITED_STANDALONE }

// Pure decision of what a Standalone-mode preference change means for the reconnect
// engine: turning it on should stop trying to reach the desktop; turning it off should
// resume trying immediately rather than waiting out whatever backoff was in progress.
fun standaloneModeTransition(prefer: Boolean, wasStandalone: Boolean): StandaloneModeTransition = when {
    prefer && !wasStandalone -> StandaloneModeTransition.ENTERED_STANDALONE
    !prefer && wasStandalone -> StandaloneModeTransition.EXITED_STANDALONE
    else -> StandaloneModeTransition.NONE
}

object WsRepository : WsClient {

    private const val WS_LOG_TAG = "NexyWs"
    // Desktop close-code protocol (ws-server.ts): unauthorized vs token regenerated / re-pair.
    private const val WS_CLOSE_UNAUTHORIZED = 4001
    private const val WS_CLOSE_TOKEN_REGENERATED = 4002

    private val STANDALONE_MODELS = listOf(
        ModelOption("claude-sonnet-4-6", "Claude Sonnet 4.6", "Anthropic"),
        ModelOption("claude-opus-4-6", "Claude Opus 4.6", "Anthropic"),
        ModelOption("gpt-5.4", "GPT-5.4", "OpenAI"),
        ModelOption("gpt-5.4-mini", "GPT-5.4 Mini", "OpenAI"),
    )

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(30_000, TimeUnit.MILLISECONDS)
        .build()

    private val scope = CoroutineScope(Dispatchers.IO)

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    private val _preferStandaloneMode = MutableStateFlow(false)
    val preferStandaloneMode: StateFlow<Boolean> = _preferStandaloneMode

    private val _effectiveMode = MutableStateFlow(EffectiveConnectionMode.DISCONNECTED)
    val effectiveMode: StateFlow<EffectiveConnectionMode> = _effectiveMode

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError

    private val _reconnectExhausted = MutableStateFlow(false)
    val reconnectExhausted: StateFlow<Boolean> = _reconnectExhausted

    private val _emergencyStopActive = MutableStateFlow(false)
    val emergencyStopActive: StateFlow<Boolean> = _emergencyStopActive

    fun activateEmergencyStop() {
        _emergencyStopActive.value = true
        app?.let { PreferenceStore.getInstance(it).setEmergencyStopActive(true) }
        if (_connectionState.value == ConnectionState.CONNECTED && !_preferStandaloneMode.value) {
            send("chat:activate-emergency-stop", emptyMap())
        } else {
            standaloneChat?.activateEmergencyStop()
        }
    }

    fun resumeConversations() {
        _emergencyStopActive.value = false
        app?.let { PreferenceStore.getInstance(it).setEmergencyStopActive(false) }
        if (_connectionState.value == ConnectionState.CONNECTED && !_preferStandaloneMode.value) {
            send("chat:resume-conversations", emptyMap())
        } else {
            standaloneChat?.resumeConversations()
        }
    }


    private val _serverVersion = MutableStateFlow<String?>(null)
    val serverVersion: StateFlow<String?> = _serverVersion

    private val _desktopIsPackaged = MutableStateFlow<Boolean?>(null)
    /** Whether the paired desktop runs as the installed app (vs a dev checkout); null until known. */
    val desktopIsPackaged: StateFlow<Boolean?> = _desktopIsPackaged

    private val _events = MutableSharedFlow<WsEvent>(extraBufferCapacity = 64)
    override val events: SharedFlow<WsEvent> = _events
    private val _remoteEvents = MutableSharedFlow<WsEvent>(extraBufferCapacity = 64)

    private val _conversations = MutableStateFlow<List<Conversation>>(emptyList())
    val conversations: StateFlow<List<Conversation>> = _conversations

    private val _agents = MutableStateFlow<List<Agent>>(emptyList())
    val agents: StateFlow<List<Agent>> = _agents

    val agentFullConfig = MutableStateFlow<AgentFullConfig?>(null)
    val agentKnowledgeFiles = MutableStateFlow<List<AgentKnowledgeFile>>(emptyList())
    val agentMcpToolOverrides = MutableStateFlow<List<AgentMcpToolOverride>>(emptyList())
    val agentMcpServerTrust = MutableStateFlow<List<AgentMcpServerTrust>>(emptyList())
    val mcpToolList = MutableStateFlow<List<McpToolInfo>>(emptyList())
    val wikiExtractionCandidates = MutableStateFlow<List<WikiExtractionCandidate>>(emptyList())

    private val _projects = MutableStateFlow<List<Project>>(emptyList())
    val projects: StateFlow<List<Project>> = _projects

    /**
     * Project id → the agent id a new chat in that project should inherit: the primary agent, or
     * the first by sort order if none is flagged primary. Mirrors desktop's `newChat()` resolution
     * (`find(isPrimary) ?? agents[0]`). Populated lazily from `project:list-agents` responses so a
     * freshly-opened project draft chat can display its inherited agent — and its chat backend —
     * *before* the first message is sent (the server binds the same agent on send). A project with
     * no agents maps to `null`.
     */
    private val _projectPrimaryAgents = MutableStateFlow<Map<String, String?>>(emptyMap())
    val projectPrimaryAgents: StateFlow<Map<String, String?>> = _projectPrimaryAgents

    /**
     * True once the Room cache holds any user content (conversations, agents, or projects). Sync UI
     * uses this to tell a first-time bulk load apart from a routine reconnect: with content already
     * cached, a delta-sync is applied silently over what's on screen, so surfacing a "N of M"
     * download-style counter would misrepresent it as a fresh full download.
     */
    val hasLocalContent: StateFlow<Boolean> =
        combine(_conversations, _agents, _projects) { conversations, agents, projects ->
            conversations.isNotEmpty() || agents.isNotEmpty() || projects.isNotEmpty()
        }.stateIn(scope, SharingStarted.Eagerly, false)

    private val _models = MutableStateFlow(STANDALONE_MODELS)
    val models: StateFlow<List<ModelOption>> = _models

    private val _modelSource = MutableStateFlow<ModelListSource?>(
        ModelListSource(type = "standalone", label = "On-device catalog"),
    )
    val modelSource: StateFlow<ModelListSource?> = _modelSource

    private val _androidUpdateManifest = MutableStateFlow<AndroidUpdateManifest?>(null)
    val androidUpdateManifest: StateFlow<AndroidUpdateManifest?> = _androidUpdateManifest


    data class DebugLogEntry(val tag: String, val message: String, val ts: Long)
    // Diagnostics persist for one week, then are swept on the next startup (parity with desktop).
    private const val DIAGNOSTIC_RETENTION_MS = 7L * 24 * 60 * 60 * 1000
    private val _debugLog = MutableStateFlow<List<DebugLogEntry>>(emptyList())
    val debugLog: StateFlow<List<DebugLogEntry>> = _debugLog

    private val _providers = MutableStateFlow<List<ProviderInfo>>(emptyList())
    val providers: StateFlow<List<ProviderInfo>> = _providers

    private val _mcpServers = MutableStateFlow<List<McpServerInfo>>(emptyList())
    val mcpServers: StateFlow<List<McpServerInfo>> = _mcpServers

    private val _mcpCatalog = MutableStateFlow<List<McpCatalogEntry>>(emptyList())
    val mcpCatalog: StateFlow<List<McpCatalogEntry>> = _mcpCatalog


    // One-shot highlight IDs set by config screens when saving a brand-new item
    val pendingHighlightProjectId = MutableStateFlow<String?>(null)
    val pendingHighlightAgentId = MutableStateFlow<String?>(null)

    // One-shot result set by FileExplorerScreen when the user picks a workspace folder,
    // consumed by the project config screen that launched it (no savedStateHandle result-passing
    // convention exists in this codebase — this mirrors the pendingHighlight* pattern above).
    val pendingSelectedDirectory = MutableStateFlow<String?>(null)
    val pendingSelectedAttachmentPath = MutableStateFlow<String?>(null)
    // Set after the add-source acknowledgment. The settings screen consumes this so it reloads
    // the authoritative hierarchy even if the picker covered the settings destination.
    val pendingProjectSourceRefresh = MutableStateFlow<String?>(null)

    // Emits requestIds resolved via notification (approve or reject) so HomeViewModel
    // can clear the in-app approval dialog immediately, before the tool finishes.
    val approvalResolvedViaNotification = MutableSharedFlow<String>(extraBufferCapacity = 4)

    private val _skills = MutableStateFlow<List<SkillConfig>>(emptyList())
    val skills: StateFlow<List<SkillConfig>> = _skills

    private val _discoveredSkills = MutableStateFlow<List<DiscoveredSkill>>(emptyList())
    val discoveredSkills: StateFlow<List<DiscoveredSkill>> = _discoveredSkills

    private val _skillAgentUsage = MutableStateFlow<Map<String, Int>>(emptyMap())
    val skillAgentUsage: StateFlow<Map<String, Int>> = _skillAgentUsage

    private val _artifacts = MutableStateFlow<List<ArtifactSummary>>(emptyList())
    val artifacts: StateFlow<List<ArtifactSummary>> = _artifacts

    private val _wikiEntries = MutableStateFlow<List<WikiEntry>>(emptyList())
    val wikiEntries: StateFlow<List<WikiEntry>> = _wikiEntries

    private val _promptEntries = MutableStateFlow<List<PromptEntry>>(emptyList())
    val promptEntries: StateFlow<List<PromptEntry>> = _promptEntries

    private val _cliStatus = MutableStateFlow<Map<String, CliInstallInfo>>(emptyMap())
    val cliStatus: StateFlow<Map<String, CliInstallInfo>> = _cliStatus

    private val _hermesInfo = MutableStateFlow(HermesCliInfo())
    val hermesInfo: StateFlow<HermesCliInfo> = _hermesInfo

    private val _scheduledTasks = MutableStateFlow<List<ScheduledTask>>(emptyList())
    val scheduledTasks: StateFlow<List<ScheduledTask>> = _scheduledTasks

    private val _scheduledRuns = MutableStateFlow<Map<String, List<ScheduledRun>>>(emptyMap())
    val scheduledRuns: StateFlow<Map<String, List<ScheduledRun>>> = _scheduledRuns

    private val _currentDebrief = MutableStateFlow<ConversationDebrief?>(null)
    val currentDebrief: StateFlow<ConversationDebrief?> = _currentDebrief

    private val _completedConversationIds = MutableStateFlow<Set<String>>(emptySet())
    val completedConversationIds: StateFlow<Set<String>> = _completedConversationIds

    private val _currentRating = MutableStateFlow<ConversationRating?>(null)
    val currentRating: StateFlow<ConversationRating?> = _currentRating

    private val _ratingsList = MutableStateFlow<List<ConversationRatingListItem>>(emptyList())
    val ratingsList: StateFlow<List<ConversationRatingListItem>> = _ratingsList

    private val _ratingStats = MutableStateFlow<ConversationRatingStats?>(null)
    val ratingStats: StateFlow<ConversationRatingStats?> = _ratingStats

    private val _profiles = MutableStateFlow<List<PairedServerProfile>>(emptyList())
    val profiles: StateFlow<List<PairedServerProfile>> = _profiles

    private val _activeProfileId = MutableStateFlow<String?>(null)
    val activeProfileId: StateFlow<String?> = _activeProfileId

    private val _activeConversationIds = MutableStateFlow<Set<String>>(emptySet())
    val activeConversationIds: StateFlow<Set<String>> = _activeConversationIds

    private val _pendingConversationIds = MutableStateFlow<Set<String>>(emptySet())
    val pendingConversationIds: StateFlow<Set<String>> = _pendingConversationIds

    fun markConversationPending(id: String) {
        _pendingConversationIds.value = _pendingConversationIds.value + id
    }

    data class LiveToolCall(
        val toolName: String,
        val serverName: String?,
        val args: String?,
        val result: String?,
        val success: Boolean,
    )

    data class ActiveChatSnapshot(
        val activityLabel: String = "Assistant is thinking",
        val liveThinkingBlocks: List<ThinkingBlock> = emptyList(),
        val completedToolCalls: List<LiveToolCall> = emptyList(),
        val isStreaming: Boolean = false,
        val generationStartedAt: Long = 0L,
    )

    private val _activeChatSnapshots = MutableStateFlow<Map<String, ActiveChatSnapshot>>(emptyMap())
    val activeChatSnapshots: StateFlow<Map<String, ActiveChatSnapshot>> = _activeChatSnapshots

    val activelyViewedConversationId = MutableStateFlow<String?>(null)

    private val _completedWhileAwayIds = MutableStateFlow<Set<String>>(emptySet())
    val completedWhileAwayIds: StateFlow<Set<String>> = _completedWhileAwayIds
    private val _newContentConversations = MutableStateFlow<List<NewContentConversation>>(emptyList())
    val newContentConversations: StateFlow<List<NewContentConversation>> = _newContentConversations
    fun clearCompletedAway(id: String) {
        _completedWhileAwayIds.value = _completedWhileAwayIds.value - id
        _newContentConversations.value = _newContentConversations.value.filterNot { it.conversationId == id }
        send("new-content:mark-read", mapOf("conversationId" to id))
    }

    fun markAllNewContentRead() {
        _completedWhileAwayIds.value = emptySet()
        _newContentConversations.value = emptyList()
        app?.let { io.nexy.android.notification.ActivityBadgeManager.markSeenWithPrefix(it, "chat:") }
        send("new-content:mark-all-read", emptyMap())
    }

    private var ws: WebSocket? = null
    private var currentUrl: String? = null
    private var currentToken: String? = null
    private var currentCertFingerprint: String? = null
    private var reconnectJob: Job? = null
    private var handshakeTimeoutJob: Job? = null
    private var foregroundProbeJob: Job? = null
    private var reconnectAttempts = 0
    private var activeMdnsDiscovery: MdnsDiscovery? = null
    @Volatile private var pendingForegroundProbeId: String? = null
    @Volatile private var foregroundProbeStartedAtMs: Long = 0L
    @Volatile private var connectionStartedAtMs: Long = 0L
    @Volatile private var syncStartedAtMs: Long = 0L
    @Volatile private var negotiatedSyncProtocolVersion: Int = 2

    // Set to true when the desktop sends update:restarting so that a 4001/4002
    // close code from the relaunch does not suppress auto-reconnect.
    private val _intentionalRestartExpected = MutableStateFlow(false)
    val intentionalRestartExpected: StateFlow<Boolean> = _intentionalRestartExpected

    private var app: Application? = null
    private var pairedServerStore: PairedServerStore? = null
    private var settingsStore: LocalSettingsStore? = null
    private var networkMonitor: NetworkReconnectMonitor? = null
    private var localData: LocalDataRepository? = null
    private var standaloneProviders: StandaloneProviderStore? = null
    private var standaloneChat: StandaloneChatService? = null

    private val _capabilities = MutableStateFlow(CapabilityState())
    val capabilities: StateFlow<CapabilityState> = _capabilities
    private val _voiceCapabilities = MutableStateFlow(io.nexy.android.data.model.VoiceCapabilitiesWire())
    val voiceCapabilities: StateFlow<io.nexy.android.data.model.VoiceCapabilitiesWire> = _voiceCapabilities
    private val _syncConflicts = MutableStateFlow<List<ConflictEntity>>(emptyList())
    val syncConflicts: StateFlow<List<ConflictEntity>> = _syncConflicts
    private val _syncOutbox = MutableStateFlow<List<OutboxEntity>>(emptyList())
    val syncOutbox: StateFlow<List<OutboxEntity>> = _syncOutbox
    private val _syncInProgress = MutableStateFlow(false)
    val syncInProgress: StateFlow<Boolean> = _syncInProgress
    private var syncWatchdogJob: Job? = null

    /**
     * True between sending a `sync:push` and settling its reply. Guards against pushing the same
     * batch twice when several operations are enqueued while one push is already awaiting its ack.
     */
    private var pushInFlight = false
    private var pushAckTimeoutJob: Job? = null
    private var outboxDrainJob: Job? = null
    private var outboxRetryJob: Job? = null

    /** Latest drain decision, exposed so the sync-status sheet can name why a queue is waiting. */
    private val _outboxDrainDecision = MutableStateFlow(OutboxDrainDecision.NOTHING_QUEUED)
    val outboxDrainDecision: StateFlow<OutboxDrainDecision> = _outboxDrainDecision

    private fun markPushInFlight() {
        pushInFlight = true
        pushAckTimeoutJob?.cancel()
        pushAckTimeoutJob = scope.launch {
            delay(SYNC_PUSH_ACK_TIMEOUT_MS)
            if (!pushInFlight) return@launch
            appendDebugLog("sync-timing", "push-ack-timeout")
            settlePushInFlight()
            scheduleOutboxDrain()
        }
    }

    private fun settlePushInFlight() {
        pushInFlight = false
        pushAckTimeoutJob?.cancel()
        pushAckTimeoutJob = null
    }

    /**
     * Re-evaluates the outbox after anything that could change its drainability (a new operation,
     * an ack, a reconnect) and pushes when it can.
     *
     * This is the fix for a change that stays "Waiting to sync" forever on a healthy connection:
     * draining previously required one of a handful of call sites to remember to flush, and the
     * paths that write messages were not among them.
     */
    private fun scheduleOutboxDrain() {
        outboxDrainJob?.cancel()
        outboxDrainJob = scope.launch {
            delay(OUTBOX_DRAIN_DEBOUNCE_MS)
            drainOutboxNow()
        }
    }

    private suspend fun drainOutboxNow() {
        val queue = _syncOutbox.value
        val now = System.currentTimeMillis()
        val decision = resolveOutboxDrain(
            connected = _connectionState.value == ConnectionState.CONNECTED,
            pushInFlight = pushInFlight,
            outbox = queue,
            now = now,
        )
        _outboxDrainDecision.value = decision
        // A backed-off operation is the only case nothing else will ever wake: the desktop sends
        // nothing and the user does nothing. Arm the retry explicitly rather than hoping an
        // unrelated event fires after the window elapses.
        outboxRetryJob?.cancel()
        outboxRetryJob = null
        if (decision == OutboxDrainDecision.WAITING_FOR_BACKOFF) {
            val delayMs = nextOutboxRetryDelayMs(queue, now) ?: return
            outboxRetryJob = scope.launch {
                delay(delayMs)
                drainOutboxNow()
            }
            return
        }
        if (decision != OutboxDrainDecision.PUSH) return
        flushStandaloneOutbox()
    }

    /**
     * Single entry point for the app-wide sync signal. Starting a sync also starts a stall
     * watchdog (see [SYNC_STALL_TIMEOUT_MS]) so the indicator can never outlive the work it
     * claims to represent; settling it cancels the watchdog.
     */
    private fun setSyncInProgress(active: Boolean) {
        syncWatchdogJob?.cancel()
        syncWatchdogJob = null
        _syncInProgress.value = active
        if (!active) return
        syncWatchdogJob = scope.launch {
            var lastObservedProgress = _syncProgress.value
            while (true) {
                delay(SYNC_STALL_TIMEOUT_MS)
                if (!_syncInProgress.value) return@launch
                val current = _syncProgress.value
                if (current != lastObservedProgress) {
                    lastObservedProgress = current
                    continue
                }
                appendDebugLog(
                    "sync-timing",
                    "sync-stalled phase=${current.phase} completed=${current.completed} total=${current.total}",
                )
                _syncInProgress.value = false
                _syncProgress.value = SyncProgress(SyncProgressPhase.COMPLETE)
                return@launch
            }
        }
    }

    private val _syncProgress = MutableStateFlow(SyncProgress())
    val syncProgress: StateFlow<SyncProgress> = _syncProgress

    // Provider key handoff consent tracking (pending requests and confirmed handoffs)
    private val _pendingKeyHandoffRequests = MutableStateFlow<Map<String, String>>(emptyMap())
    val pendingKeyHandoffRequests: StateFlow<Map<String, String>> = _pendingKeyHandoffRequests
    private val _confirmedKeyHandoffs = MutableStateFlow<Set<String>>(emptySet())
    val confirmedKeyHandoffs: StateFlow<Set<String>> = _confirmedKeyHandoffs

    // Automated Workflow Generator state tracking
    data class AutomatedWorkflowMessage(
        val role: String,
        val text: String,
        val isError: Boolean = false,
    )

    // Mirrors AutomatedWorkflowGeneratorMessage on desktop — resent in full on every
    // automated-workflow-generator:message call, matching the other Android generator screens.
    data class AutomatedWorkflowChatMessage(val role: String, val content: String)

    data class AutomatedWorkflowSession(
        val sessionId: String,
        // null generates a standalone, project-less workflow — mirrors desktop's project-optional
        // Automated Workflow runs.
        val projectId: String? = null,
        val title: String = "",
        val goalSummary: String = "",
        val assumptions: String = "",
        val steps: List<io.nexy.android.data.model.AutomatedWorkflowStepInfo> = emptyList(),
        val rawSpec: Map<String, Any>? = null,
        val savedRunId: String? = null,
        val saving: Boolean = false,
        val currentModel: String? = null,
        val isActive: Boolean = true,
        val isLoading: Boolean = false,
        val messages: List<AutomatedWorkflowMessage> = emptyList(),
        val chatHistory: List<AutomatedWorkflowChatMessage> = emptyList(),
        val streamingText: String = "",
    )
    private val _automatedWorkflowSession = MutableStateFlow<AutomatedWorkflowSession?>(null)
    val automatedWorkflowSession: StateFlow<AutomatedWorkflowSession?> = _automatedWorkflowSession

    // Live step-execution output for whichever step is currently 'running', keyed by stepDbId —
    // separate from the session above since it streams from the runner (automated-workflow-runs:*),
    // not the plan-generation chat (automated-workflow-generator:*). Cleared whenever the active
    // run detail changes so a re-run of the same step doesn't briefly show the previous attempt's
    // leftover text before new chunks arrive (mirrors the desktop AutomatedWorkflowTab.tsx pattern).
    private val _automatedWorkflowStepStreamText = MutableStateFlow<Map<String, String>>(emptyMap())
    val automatedWorkflowStepStreamText: StateFlow<Map<String, String>> = _automatedWorkflowStepStreamText
    private val _managedWorkflowVersions = MutableStateFlow<Map<String, ManagedWorkflowVersionContent>>(emptyMap())
    val managedWorkflowVersions: StateFlow<Map<String, ManagedWorkflowVersionContent>> = _managedWorkflowVersions
    private val _managedWorkflowSources = MutableStateFlow<List<ManagedWorkflowSourceOption>>(emptyList())
    val managedWorkflowSources: StateFlow<List<ManagedWorkflowSourceOption>> = _managedWorkflowSources

    fun pruneAutomatedWorkflowStepStreamText(runningStepDbIds: Set<String>) {
        _automatedWorkflowStepStreamText.value = _automatedWorkflowStepStreamText.value.filterKeys { it in runningStepDbIds }
    }

    private data class GeneratorActivityConfig(
        val label: String,
        val route: String,
    )

    private val generatorActivityConfigs = mapOf(
        "project-generator" to GeneratorActivityConfig("Generating project…", "project-generator"),
        "agent-generator" to GeneratorActivityConfig("Generating agent…", "agent-generator"),
        "skill-generator" to GeneratorActivityConfig("Generating skill…", "skill-generator"),
        "scheduler-generator" to GeneratorActivityConfig("Generating scheduled task…", "scheduled/generator"),
    )

    private fun generatorKindForCommand(command: String): String? =
        generatorActivityConfigs.keys.firstOrNull { command.startsWith("$it:") }

    private fun registerGeneratorActivityForCommand(command: String) {
        val kind = generatorKindForCommand(command) ?: return
        val action = command.substringAfter(':', missingDelimiterValue = "")
        if (action !in setOf("start", "message", "confirm")) return
        val config = generatorActivityConfigs.getValue(kind)
        BackgroundActivityTracker.register(kind, config.label, config.route)
    }

    private fun unregisterGeneratorActivity(kind: String) {
        BackgroundActivityTracker.unregister(kind)
    }

    // Extracted for testability: whether `model` ends up in the outgoing payload is the one bit
    // of real logic here (an explicit `null` must be omitted, not sent as a literal null, so the
    // desktop's own default-model resolution kicks in).
    internal fun buildAutomatedWorkflowStartPayload(
        projectId: String?,
        sessionId: String,
        initialMessage: String,
        model: String?,
    ): Map<String, Any> = buildMap {
        // Omitted (not null-valued) for a project-less workflow — ws-handlers.ts treats a
        // missing/non-string projectId as null either way.
        if (projectId != null) put("projectId", projectId)
        put("sessionId", sessionId)
        put("messages", listOf(mapOf("role" to "user", "content" to initialMessage)))
        if (model != null) put("model", model)
    }

    internal fun buildAutomatedWorkflowMessagePayload(
        projectId: String?,
        sessionId: String,
        history: List<AutomatedWorkflowChatMessage>,
        model: String?,
    ): Map<String, Any> = buildMap {
        if (projectId != null) put("projectId", projectId)
        put("sessionId", sessionId)
        put("messages", history.map { mapOf("role" to it.role, "content" to it.content) })
        if (model != null) put("model", model)
    }

    fun startAutomatedWorkflowGeneration(projectId: String?, initialMessage: String, model: String? = null): String {
        val sessionId = java.util.UUID.randomUUID().toString()
        _automatedWorkflowSession.value = AutomatedWorkflowSession(
            sessionId = sessionId,
            projectId = projectId,
            isLoading = true,
            messages = listOf(AutomatedWorkflowMessage("user", initialMessage)),
            chatHistory = listOf(AutomatedWorkflowChatMessage("user", initialMessage)),
        )
        send(
            "automated-workflow-generator:start",
            buildAutomatedWorkflowStartPayload(projectId, sessionId, initialMessage, model),
        )
        return sessionId
    }

    fun sendAutomatedWorkflowGeneratorMessage(text: String, model: String? = null) {
        val session = _automatedWorkflowSession.value ?: return
        val updatedHistory = session.chatHistory + AutomatedWorkflowChatMessage("user", text)
        _automatedWorkflowSession.value = session.copy(
            isLoading = true,
            chatHistory = updatedHistory,
            messages = session.messages + AutomatedWorkflowMessage("user", text),
        )
        send(
            "automated-workflow-generator:message",
            buildAutomatedWorkflowMessagePayload(session.projectId, session.sessionId, updatedHistory, model),
        )
    }

    fun cancelAutomatedWorkflowGeneration() {
        val session = _automatedWorkflowSession.value ?: return
        send("automated-workflow-generator:cancel", mapOf("sessionId" to session.sessionId))
        _automatedWorkflowSession.value = null
    }

    fun saveAutomatedWorkflowRun(projectId: String?, spec: Map<String, Any>, model: String?, existingRunId: String?) {
        val current = _automatedWorkflowSession.value
        if (current != null) _automatedWorkflowSession.value = current.copy(saving = true)
        send(
            "automated-workflow-runs:save-spec",
            buildMap {
                // Omitted (not null-valued) for a project-less run — ws-handlers.ts treats a
                // missing/non-string projectId as null either way.
                if (projectId != null) put("projectId", projectId)
                put("spec", spec)
                if (model != null) put("model", model)
                if (existingRunId != null) put("existingRunId", existingRunId)
            },
        )
    }

    fun listAutomatedWorkflowRuns(projectId: String?) {
        send("automated-workflow-runs:list", buildMap { if (projectId != null) put("projectId", projectId) })
    }

    /** Every run regardless of project — backs the global, top-level Automated Workflows screen. */
    fun listAllAutomatedWorkflowRuns() {
        send("automated-workflow-runs:list-all", emptyMap())
    }

    fun getAutomatedWorkflowRun(runId: String) {
        send("automated-workflow-runs:get", mapOf("runId" to runId))
    }

    fun updateAutomatedWorkflowRunStepStatus(runId: String, stepDbId: String, status: String) {
        send("automated-workflow-runs:update-step-status", mapOf("runId" to runId, "stepDbId" to stepDbId, "status" to status))
    }

    fun discardAutomatedWorkflowRun(runId: String) {
        send("automated-workflow-runs:discard", mapOf("runId" to runId))
    }

    fun startAutomatedWorkflowRun(runId: String) {
        send("automated-workflow-runs:start", mapOf("runId" to runId))
    }

    fun confirmAutomatedWorkflowStep(runId: String, stepDbId: String, editedOutput: String? = null) {
        send(
            "automated-workflow-runs:confirm-step",
            buildMap {
                put("runId", runId)
                put("stepDbId", stepDbId)
                if (editedOutput != null) put("editedOutput", editedOutput)
            },
        )
    }

    fun retryAutomatedWorkflowStep(runId: String, stepDbId: String) {
        send("automated-workflow-runs:retry-step", mapOf("runId" to runId, "stepDbId" to stepDbId))
    }

    fun skipAutomatedWorkflowStep(runId: String, stepDbId: String) {
        send("automated-workflow-runs:skip-step", mapOf("runId" to runId, "stepDbId" to stepDbId))
    }

    fun abortAutomatedWorkflowRun(runId: String) {
        send("automated-workflow-runs:abort", mapOf("runId" to runId))
    }

    fun setAutomatedWorkflowConfirmationMode(runId: String, mode: String) {
        send("automated-workflow-runs:set-confirmation-mode", mapOf("runId" to runId, "mode" to mode))
    }

    /** Creates a fresh `pending` run from a terminal run's saved template, bypassing the AI
     *  generator entirely — replies with the same automated-workflow-runs:detail/:error events
     *  as :start/:save-spec, so no new WsEvent parse case is needed. */
    fun runAgainAutomatedWorkflow(templateId: String) {
        send("automated-workflow-runs:run-again", mapOf("templateId" to templateId))
    }

    /** Updates the paired-mode authoring projection and its raw spec together, so Android can
     * configure managed sources/destinations without exposing artifact IDs or JSON. */
    fun updateManagedWorkflowDraftStep(
        stepId: String,
        projectSourceId: String? = null,
        includePaths: List<String>? = null,
        publishProjectSourceId: String? = null,
        publishRelativePath: String? = null,
    ) {
        val current = _automatedWorkflowSession.value ?: return
        val raw = current.rawSpec ?: return
        @Suppress("UNCHECKED_CAST")
        val rawSteps = raw["steps"] as? List<Any?> ?: return
        val updatedRawSteps = rawSteps.map { item ->
            @Suppress("UNCHECKED_CAST")
            val step = item as? Map<String, Any?> ?: return@map item
            if (step["id"] != stepId) return@map item
            val mutable = step.toMutableMap()
            if (projectSourceId != null || includePaths != null) {
                @Suppress("UNCHECKED_CAST")
                val bindings = (step["inputBindings"] as? List<Any?>).orEmpty().map { bindingItem ->
                    @Suppress("UNCHECKED_CAST")
                    val binding = bindingItem as? Map<String, Any?> ?: return@map bindingItem
                    @Suppress("UNCHECKED_CAST")
                    val source = binding["source"] as? Map<String, Any?> ?: return@map bindingItem
                    if (source["type"] != "project-files") return@map bindingItem
                    binding.toMutableMap().apply {
                        put("source", source.toMutableMap().apply {
                            if (projectSourceId != null) put("projectSourceId", projectSourceId)
                            if (includePaths != null) put("include", includePaths)
                        })
                    }
                }
                mutable["inputBindings"] = bindings
            }
            if (publishProjectSourceId != null || publishRelativePath != null) {
                @Suppress("UNCHECKED_CAST")
                val destination = (step["publishDestination"] as? Map<String, Any?>).orEmpty().toMutableMap()
                if (publishProjectSourceId != null) destination["projectSourceId"] = publishProjectSourceId
                if (publishRelativePath != null) destination["relativePath"] = publishRelativePath
                mutable["publishDestination"] = destination
            }
            mutable
        }
        val updatedRaw = raw.toMutableMap().apply { put("steps", updatedRawSteps) }
        val updatedSteps = current.steps.map { step ->
            if (step.id != stepId) step else step.copy(
                projectSourceId = projectSourceId ?: step.projectSourceId,
                includePaths = includePaths ?: step.includePaths,
                publishProjectSourceId = publishProjectSourceId ?: step.publishProjectSourceId,
                publishRelativePath = publishRelativePath ?: step.publishRelativePath,
            )
        }
        _automatedWorkflowSession.value = current.copy(rawSpec = updatedRaw, steps = updatedSteps, savedRunId = null)
    }

    fun listManagedWorkflowSources(projectId: String) {
        send("automated-workflow-managed:list-sources", mapOf("projectId" to projectId))
    }

    fun getManagedWorkflowVersion(versionId: String) {
        send("automated-workflow-managed:get-version", mapOf("versionId" to versionId))
    }

    fun editManagedWorkflowVersion(runId: String, stepDbId: String, expectedVersionId: String, content: String) {
        send("automated-workflow-managed:edit-version", mapOf(
            "runId" to runId, "stepDbId" to stepDbId, "expectedVersionId" to expectedVersionId, "content" to content,
        ))
    }

    fun reviewManagedWorkflowVersion(runId: String, stepDbId: String, artifactVersionId: String, decision: String) {
        send("automated-workflow-managed:review", mapOf(
            "runId" to runId, "stepDbId" to stepDbId, "artifactVersionId" to artifactVersionId, "decision" to decision,
        ))
    }

    fun regenerateManagedWorkflow(runId: String, stepDbId: String) {
        send("automated-workflow-managed:regenerate", mapOf("runId" to runId, "stepDbId" to stepDbId))
    }

    fun refreshManagedPublishPreview(runId: String, stepDbId: String, artifactVersionId: String) {
        send("automated-workflow-managed:create-preview", mapOf(
            "runId" to runId, "stepDbId" to stepDbId, "artifactVersionId" to artifactVersionId,
        ))
    }

    fun confirmManagedPublish(runId: String, stepDbId: String, previewId: String, idempotencyKey: String) {
        send("automated-workflow-managed:confirm-publish", mapOf(
            "runId" to runId, "stepDbId" to stepDbId, "previewId" to previewId, "idempotencyKey" to idempotencyKey,
        ))
    }

    private val pendingCommands = mutableListOf<Pair<String, Map<String, Any>>>()

    init {
        scope.launch {
            _remoteEvents.collect { event ->
                val receivedAtMs = android.os.SystemClock.elapsedRealtime()
                dispatchRemoteEvent(
                    event = event,
                    persist = {
                        val cache = localData
                        if (cache != null) {
                            cache.applyRemoteEvent(it)
                        }
                        if (cache != null && it is WsEvent.ConversationMessages) {
                            appendDebugLog(
                                "chat-history-timing",
                                "cache-committed conversationId=${it.conversationId} " +
                                    "count=${it.messages.size} elapsedMs=${elapsedSince(receivedAtMs)}",
                            )
                        }
                    },
                    publish = {
                        _events.emit(it)
                        if (it is WsEvent.ConversationMessages) {
                            appendDebugLog(
                                "chat-history-timing",
                                "ui-published conversationId=${it.conversationId} " +
                                    "count=${it.messages.size} elapsedMs=${elapsedSince(receivedAtMs)}",
                            )
                        }
                    },
                    onPersistError = { failedEvent, error ->
                        // A malformed or temporarily unwritable cache row must not bring down the
                        // process (or cancel the repository's event collectors). Chat history has
                        // already reached the UI; all other events are published immediately below.
                        appendDebugLog(
                            "sync-cache-error",
                            "${failedEvent.javaClass.simpleName}: ${error.javaClass.simpleName}: ${error.message.orEmpty()}",
                        )
                        android.util.Log.e(WS_LOG_TAG, "Unable to cache remote event", error)
                    },
                )
            }
        }
        scope.launch {
            // Per-project id (matches desktop's activity-tracker.ts: automated-workflow-generator
            // is keyed by project so two projects generating concurrently get separate activity
            // entries, and so this local-optimistic registration reconciles by id with the
            // server-confirmed snapshot entry instead of leaving a duplicate/orphaned one). A
            // project-less session is keyed "...:global", mirroring desktop's
            // `projectId ?? 'global'` activity id, and routes to the standalone generator screen
            // instead of a project-nested one.
            var registeredActivityId: String? = null
            _automatedWorkflowSession.collect { session ->
                if (session?.isLoading == true) {
                    val activityId = "automated-workflow-generator:${session.projectId ?: "global"}"
                    registeredActivityId = activityId
                    BackgroundActivityTracker.register(
                        activityId,
                        "Generating workflow…",
                        session.projectId?.let { "automated-workflow/${android.net.Uri.encode(it)}" } ?: "automated-workflow-generate",
                    )
                } else {
                    registeredActivityId?.let { BackgroundActivityTracker.unregister(it) }
                    registeredActivityId = null
                }
            }
        }
        scope.launch {
            events.collect { event ->
                when (event) {
                    // The main process pushes this on every activity mutation (activity-tracker.ts:
                    // broadcast(), called from startActivity/updateActivity/endActivity), so this
                    // real-time push — not the one-shot activity:list request sent on (re)connect
                    // — is what's supposed to clear a conversation's "Assistant is responding…"
                    // entry the moment the desktop's chat-turn-emitter ends it. It was parsed by
                    // WsEventParser but never wired to a handler, so the Activity tab only ever
                    // updated on reconnect or a manual pull-to-refresh, leaving finished chats
                    // stuck showing "in progress" until one of those happened to fire.
                    is WsEvent.ActivityChanged -> BackgroundActivityTracker.applySnapshot(event.activities)
                    is WsEvent.NewContentChanged -> {
                        val viewedId = activelyViewedConversationId.value
                        _newContentConversations.value = event.conversations.filterNot { it.conversationId == viewedId }
                        _completedWhileAwayIds.value = _newContentConversations.value.map { it.conversationId }.toSet()
                        if (viewedId != null && event.conversations.any { it.conversationId == viewedId }) {
                            send("new-content:mark-read", mapOf("conversationId" to viewedId))
                        }
                    }
                    is WsEvent.ChatActivity -> {
                        val activeStates = setOf("active", "thinking", "tool")
                        val doneStates = setOf("complete", "error")
                        _activeConversationIds.value = when (event.state) {
                            in activeStates -> _activeConversationIds.value + event.conversationId
                            in doneStates -> _activeConversationIds.value - event.conversationId
                            else -> _activeConversationIds.value
                        }
                        // Remove from pending once the desktop has acknowledged the conversation
                        if (_pendingConversationIds.value.contains(event.conversationId)) {
                            _pendingConversationIds.value = _pendingConversationIds.value - event.conversationId
                        }
                        // Track conversations that completed while not being viewed
                        if (event.state == "complete" && activelyViewedConversationId.value != event.conversationId) {
                            _completedWhileAwayIds.value = _completedWhileAwayIds.value + event.conversationId
                            val application = app
                            if (application != null && !NexyApp.isInForeground && _connectionState.value != ConnectionState.CONNECTED) {
                                val title = _conversations.value.firstOrNull { it.id == event.conversationId }?.title
                                    ?: "Chat"
                                ChatCompleteNotificationManager.show(application, event.conversationId, title)
                            }
                        }
                        // Maintain in-flight snapshot for re-entry restoration
                        if (event.state in doneStates) {
                            _activeChatSnapshots.value = _activeChatSnapshots.value - event.conversationId
                        } else {
                            val existing = _activeChatSnapshots.value[event.conversationId]
                            val startedAt = if (existing != null) existing.generationStartedAt else System.currentTimeMillis()
                            _activeChatSnapshots.value = _activeChatSnapshots.value + (event.conversationId to
                                (existing ?: ActiveChatSnapshot()).copy(
                                    activityLabel = event.label.ifBlank { "Assistant is thinking" },
                                    generationStartedAt = startedAt,
                                ))
                        }
                    }
                    is WsEvent.ChatThinkingDelta -> {
                        val snapshots = _activeChatSnapshots.value
                        val existing = snapshots[event.conversationId] ?: ActiveChatSnapshot()
                        val blocks = existing.liveThinkingBlocks.toMutableList()
                        val idx = blocks.indexOfFirst { it.blockId == event.blockId }
                        if (idx >= 0) {
                            blocks[idx] = blocks[idx].copy(content = blocks[idx].content + event.chunk)
                        } else {
                            blocks.add(ThinkingBlock(blockId = event.blockId, content = event.chunk, done = false))
                        }
                        _activeChatSnapshots.value = snapshots + (event.conversationId to existing.copy(liveThinkingBlocks = blocks))
                    }
                    is WsEvent.ChatThinkingEnd -> {
                        val snapshots = _activeChatSnapshots.value
                        val existing = snapshots[event.conversationId] ?: return@collect
                        val blocks = existing.liveThinkingBlocks.map {
                            if (it.blockId == event.blockId) it.copy(done = true) else it
                        }
                        _activeChatSnapshots.value = snapshots + (event.conversationId to existing.copy(liveThinkingBlocks = blocks))
                    }
                    is WsEvent.ChatToolCallEvent -> {
                        val snapshots = _activeChatSnapshots.value
                        val existing = snapshots[event.conversationId] ?: ActiveChatSnapshot()
                        val tc = LiveToolCall(
                            toolName = event.toolName,
                            serverName = event.serverName,
                            args = event.args,
                            result = event.result,
                            success = event.success,
                        )
                        _activeChatSnapshots.value = snapshots + (event.conversationId to
                            existing.copy(completedToolCalls = existing.completedToolCalls + tc))
                    }
                    is WsEvent.ChatStreamChunk -> {
                        val snapshots = _activeChatSnapshots.value
                        val existing = snapshots[event.conversationId] ?: ActiveChatSnapshot()
                        if (!existing.isStreaming) {
                            _activeChatSnapshots.value = snapshots + (event.conversationId to existing.copy(isStreaming = true))
                        }
                    }
                    is WsEvent.ChatStreamEnd -> {
                        _activeConversationIds.value = _activeConversationIds.value - event.conversationId
                        _pendingConversationIds.value = _pendingConversationIds.value - event.conversationId
                        if (activelyViewedConversationId.value != event.conversationId) {
                            _completedWhileAwayIds.value = _completedWhileAwayIds.value + event.conversationId
                        }
                        _activeChatSnapshots.value = _activeChatSnapshots.value - event.conversationId
                    }
                    is WsEvent.DebriefReady -> {
                        if (activelyViewedConversationId.value != event.debrief.conversationId) {
                            val application = app
                            if (application != null) {
                                val title = _conversations.value.firstOrNull { it.id == event.debrief.conversationId }?.title ?: "Chat"
                                GenerationNotificationManager.show(application, event.debrief.conversationId, "debrief", title)
                            }
                        }
                    }
                    is WsEvent.QuizReady -> {
                        val convId = event.conversationId
                        if (convId != null && activelyViewedConversationId.value != convId) {
                            val application = app
                            if (application != null) {
                                val title = _conversations.value.firstOrNull { it.id == convId }?.title ?: "Chat"
                                GenerationNotificationManager.show(application, convId, "quiz", title)
                            }
                        }
                    }
                    is WsEvent.ConversationList -> {
                        val knownIds = _conversations.value.map { it.id }.toSet()
                        _pendingConversationIds.value = _pendingConversationIds.value - knownIds
                        val completedIds = _conversations.value.filter { it.completed_at != null }.map { it.id }.toSet()
                        _completedConversationIds.value = completedIds
                    }
                    is WsEvent.ConversationCreated -> {
                        val knownIds = _conversations.value.map { it.id }.toSet()
                        _pendingConversationIds.value = _pendingConversationIds.value - knownIds
                    }
                    is WsEvent.UpdateRestarting -> {
                        _intentionalRestartExpected.value = true
                    }
                    is WsEvent.Connected -> {
                        // Desktop came back online — clear the restart-expected flag
                        _intentionalRestartExpected.value = false
                        _voiceCapabilities.value = event.voiceCapabilities
                        val connectedElapsed = elapsedSince(connectionStartedAtMs)
                        appendDebugLog("sync-timing", "connected-event elapsedMs=$connectedElapsed")
                        beginStandaloneSync()
                        getActivityFeed()
                        getNewContent()
                    }
                    is WsEvent.SyncProbeAck -> {
                        if (event.probeId == pendingForegroundProbeId) {
                            val elapsed = elapsedSince(foregroundProbeStartedAtMs)
                            pendingForegroundProbeId = null
                            foregroundProbeJob?.cancel()
                            foregroundProbeJob = null
                            appendDebugLog("sync-timing", "foreground-probe-ack elapsedMs=$elapsed")
                            flushPendingCommands()
                        }
                    }
                    is WsEvent.SyncWelcome -> {
                        negotiatedSyncProtocolVersion = event.protocolVersion.coerceAtLeast(1)
                        scope.launch {
                            applyStandaloneSnapshot(
                                event.snapshot,
                                acknowledgeTombstones = true,
                                desktopSequence = event.desktopSequence,
                                datasetId = event.datasetId,
                            )
                            // Room now holds the metadata shell; warm the top conversations so the
                            // most-likely taps open from cache rather than a round-trip.
                            prefetchTopConversations()
                        }
                    }
                    is WsEvent.SyncAck -> {
                        settlePushInFlight()
                        scope.launch {
                            try {
                                localData?.acknowledge(event.operationIds)
                                localData?.applySyncConflicts(event.conflictsJson)
                                event.snapshot?.let {
                                    applyStandaloneSnapshot(
                                        it,
                                        acknowledgeTombstones = false,
                                        desktopSequence = event.desktopSequence,
                                        datasetId = currentToken?.let(::syncDatasetId),
                                    )
                                } ?: flushStandaloneOutbox()
                            } catch (error: Exception) {
                                reportSyncFailure("ack", error)
                            }
                        }
                    }
                    is WsEvent.SyncAttachmentStatus -> scope.launch {
                        handleAttachmentStatus(event)
                    }
                    is WsEvent.SyncAttachmentChunk -> scope.launch {
                        handleAttachmentChunk(event)
                    }
                    is WsEvent.SyncConflictResolved -> {
                        if (event.conflictId.isNotBlank()) {
                            scope.launch {
                                localData?.resolveConflict(event.conflictId, event.resolution ?: "remote")
                                beginStandaloneSync()
                            }
                        }
                    }
                    is WsEvent.SyncError -> {
                        settlePushInFlight()
                        // Desktop builds from before the foreground probe was introduced answer
                        // with unknown-command. Reconnect through the legacy path without
                        // misclassifying queued user edits as failed synchronization operations.
                        if (event.code == "unknown-command" && pendingForegroundProbeId != null) {
                            pendingForegroundProbeId = null
                            foregroundProbeJob?.cancel()
                            foregroundProbeJob = null
                            appendDebugLog("sync-timing", "foreground-probe-unsupported")
                            reconnectAfterForegroundProbeFailure()
                        } else if (event.code == "unsupported-protocol" && event.supportedProtocolVersion == 1) {
                            appendDebugLog("sync-timing", "protocol-v2-unsupported fallback=v1")
                            beginStandaloneSync(protocolVersion = 1)
                        } else {
                            setSyncInProgress(false)
                            _syncProgress.value = SyncProgress(SyncProgressPhase.COMPLETE)
                            _lastError.value = event.message
                            scope.launch {
                                localData?.pendingBatch(100)?.forEach { operation ->
                                    localData?.markFailed(operation.operationId, event.message)
                                }
                                // A batch-wide failure marks everything pending as failed even though
                                // only one operation may actually be broken (e.g. it references a
                                // conversation the user already deleted locally). Tell them apart:
                                // discard the truly orphaned ones, retry the rest automatically.
                                localData?.discardOrphanedOperations()
                                if (_connectionState.value == ConnectionState.CONNECTED) flushStandaloneOutbox()
                            }
                        }
                    }
                    is WsEvent.ProjectAgents -> {
                        // Cache the inheritable agent for this project so project draft chats can
                        // show it before the first send. Resolve primary-first, else lowest sort
                        // order, matching desktop's newChat() (`find(isPrimary) ?? agents[0]`).
                        val resolved = event.agents.firstOrNull { it.isPrimary }
                            ?: event.agents.minByOrNull { it.sortOrder }
                        _projectPrimaryAgents.value = _projectPrimaryAgents.value +
                            (event.id to resolved?.agentId)
                    }
                    is WsEvent.ProjectGeneratorTurnComplete,
                    is WsEvent.ProjectGeneratorSpecReady,
                    is WsEvent.ProjectGeneratorCreated,
                    is WsEvent.ProjectGeneratorError,
                    is WsEvent.ProjectGeneratorCancelled -> unregisterGeneratorActivity("project-generator")
                    is WsEvent.AgentGeneratorTurnComplete,
                    is WsEvent.AgentGeneratorSpecReady,
                    is WsEvent.AgentGeneratorCreated,
                    is WsEvent.AgentGeneratorError,
                    is WsEvent.AgentGeneratorCancelled -> unregisterGeneratorActivity("agent-generator")
                    is WsEvent.SkillGeneratorTurnComplete,
                    is WsEvent.SkillGeneratorSpecReady,
                    is WsEvent.SkillGeneratorCreated,
                    is WsEvent.SkillGeneratorError,
                    is WsEvent.SkillGeneratorCancelled -> unregisterGeneratorActivity("skill-generator")
                    is WsEvent.SchedulerGeneratorTurnComplete,
                    is WsEvent.SchedulerGeneratorSpecReady,
                    is WsEvent.SchedulerGeneratorCreated,
                    is WsEvent.SchedulerGeneratorError,
                    is WsEvent.SchedulerGeneratorCancelled -> unregisterGeneratorActivity("scheduler-generator")
                    is WsEvent.ProviderKeyHandoffRequest -> {
                        // Desktop is requesting Android to accept a key handoff
                        _pendingKeyHandoffRequests.value = _pendingKeyHandoffRequests.value +
                            (event.providerId to event.providerName)
                    }
                    is WsEvent.ProviderKeyHandoffValue -> {
                        // Key value is being transmitted (only after explicit consent)
                        val providerId = event.providerId
                        if (_confirmedKeyHandoffs.value.contains(providerId)) {
                            // User has consented; store the key
                            scope.launch {
                                standaloneProviders?.let { store ->
                                    store.setKey(providerId, event.keyValue)
                                    // Mark as no longer pending
                                    _pendingKeyHandoffRequests.value =
                                        _pendingKeyHandoffRequests.value - providerId
                                    // Clear consent flag after successful store
                                    _confirmedKeyHandoffs.value =
                                        _confirmedKeyHandoffs.value - providerId
                                }
                            }
                        }
                    }
                    is WsEvent.AutomatedWorkflowReady -> {
                        val current = _automatedWorkflowSession.value
                        if (current != null && current.sessionId == event.sessionId) {
                            // savedRunId is intentionally kept across a regeneration: tapping Save
                            // again passes it as existingRunId so the server updates the same run
                            // in place (it only does so if no step has progressed; otherwise it
                            // transparently branches into a new run and returns a different id).
                            _automatedWorkflowSession.value = current.copy(
                                title = event.title,
                                goalSummary = event.goalSummary,
                                assumptions = event.assumptions,
                                steps = event.steps,
                                rawSpec = event.rawSpec,
                            )
                        }
                    }
                    is WsEvent.AutomatedWorkflowModel -> {
                        val current = _automatedWorkflowSession.value
                        if (current != null && current.sessionId == event.sessionId) {
                            _automatedWorkflowSession.value = current.copy(currentModel = event.modelId)
                        }
                    }
                    is WsEvent.AutomatedWorkflowToken -> {
                        val current = _automatedWorkflowSession.value
                        if (current != null && current.sessionId == event.sessionId) {
                            _automatedWorkflowSession.value = current.copy(
                                streamingText = current.streamingText + event.chunk,
                            )
                        }
                    }
                    is WsEvent.AutomatedWorkflowMessage -> {
                        val current = _automatedWorkflowSession.value
                        if (current != null && current.sessionId == event.sessionId) {
                            _automatedWorkflowSession.value = current.copy(
                                isLoading = false,
                                streamingText = "",
                                messages = current.messages + AutomatedWorkflowMessage("assistant", event.message),
                                chatHistory = current.chatHistory + AutomatedWorkflowChatMessage("assistant", event.message),
                            )
                        }
                    }
                    is WsEvent.AutomatedWorkflowError -> {
                        val current = _automatedWorkflowSession.value
                        if (current != null && current.sessionId == event.sessionId) {
                            _automatedWorkflowSession.value = current.copy(
                                isLoading = false,
                                isActive = false,
                                messages = current.messages + AutomatedWorkflowMessage("assistant", event.message, isError = true),
                            )
                        }
                    }
                    is WsEvent.AutomatedWorkflowCancelled -> {
                        val current = _automatedWorkflowSession.value
                        if (current != null && current.sessionId == event.sessionId) {
                            _automatedWorkflowSession.value = null
                        }
                    }
                    is WsEvent.AutomatedWorkflowRunDetailReady -> {
                        val current = _automatedWorkflowSession.value
                        if (current != null && current.saving && event.run != null && event.run.projectId == current.projectId) {
                            _automatedWorkflowSession.value = current.copy(saving = false, savedRunId = event.run.id)
                        }
                    }
                    is WsEvent.AutomatedWorkflowStepStream -> {
                        _automatedWorkflowStepStreamText.value = _automatedWorkflowStepStreamText.value.toMutableMap().apply {
                            this[event.stepDbId] = (this[event.stepDbId] ?: "") + event.chunk
                        }
                    }
                    is WsEvent.ManagedWorkflowSources -> {
                        _managedWorkflowSources.value = event.sources
                    }
                    is WsEvent.ManagedWorkflowVersionReady -> {
                        event.version?.let { version ->
                            _managedWorkflowVersions.value = _managedWorkflowVersions.value + (version.version.id to version)
                        }
                    }
                    else -> {}
                }
            }
        }
    }

    fun sendOrQueue(command: String, data: Map<String, Any>) {
        if (connectionState.value == ConnectionState.CONNECTED) {
            send(command, data)
        } else {
            synchronized(pendingCommands) { pendingCommands.add(command to data) }
            if (connectionState.value == ConnectionState.DISCONNECTED) {
                connectFromStore()
            }
        }
    }

    fun connectFromStore() {
        pairedServerStore?.load()?.let { connect(it) }
    }

    fun init(application: Application) {
        app = application
        settingsStore = LocalSettingsStore(application)
        localData = LocalDataRepository.get(application).also { local ->
            loadPersistedDiagnostics(local)
            scope.launch { local.recoverInterruptedTurns() }
            scope.launch { local.conversations.collect { _conversations.value = it } }
            scope.launch { local.agents.collect { _agents.value = it } }
            scope.launch { local.projects.collect { _projects.value = it } }
            scope.launch { local.skills.collect { _skills.value = it } }
            scope.launch { local.wikiEntries.collect { _wikiEntries.value = it } }
            scope.launch { local.promptEntries.collect { _promptEntries.value = it } }
            scope.launch { local.capabilities.collect { _capabilities.value = it } }
            scope.launch { local.conflicts.collect { _syncConflicts.value = it } }
            scope.launch {
                local.outbox.collect {
                    _syncOutbox.value = it
                    // Queued work drains itself. Every enqueue site used to have to remember to
                    // flush, and the message-write paths did not.
                    scheduleOutboxDrain()
                }
            }
            scope.launch {
                _connectionState.collect { state ->
                    local.setDesktopConnected(state == ConnectionState.CONNECTED)
                    if (state != ConnectionState.CONNECTED) settlePushInFlight()
                    scheduleOutboxDrain()
                }
            }
        }
        standaloneProviders = StandaloneProviderStore.get(application)
        scope.launch {
            standaloneProviders?.providers?.collect { localProviders ->
                if (_connectionState.value != ConnectionState.CONNECTED) _providers.value = localProviders
            }
        }
        standaloneChat = StandaloneChatService(
            localData = checkNotNull(localData),
            providerStore = checkNotNull(standaloneProviders),
            emit = { event -> _events.emit(event) },
        )
        pairedServerStore = runCatching { PairedServerStore(application) }
            .onFailure { _lastError.value = it.message ?: "Unable to open secure pairing storage" }
            .getOrNull()
        val preferenceStore = PreferenceStore.getInstance(application)
        _emergencyStopActive.value = preferenceStore.isEmergencyStopActive()
        if (_emergencyStopActive.value) standaloneChat?.activateEmergencyStop()
        scope.launch {
            preferenceStore.getPreferStandaloneMode().collect { prefer ->
                val wasStandalone = _preferStandaloneMode.value
                _preferStandaloneMode.value = prefer
                _effectiveMode.value = deriveEffectiveMode(_connectionState.value, prefer)
                when (standaloneModeTransition(prefer, wasStandalone)) {
                    StandaloneModeTransition.ENTERED_STANDALONE -> {
                        reconnectJob?.cancel()
                        activeMdnsDiscovery?.stopDiscovery()
                        activeMdnsDiscovery = null
                    }
                    StandaloneModeTransition.EXITED_STANDALONE -> {
                        if (_connectionState.value != ConnectionState.CONNECTED) {
                            reconnectAttempts = 0
                            scheduleReconnect()
                        }
                    }
                    StandaloneModeTransition.NONE -> {}
                }
            }
        }
        scope.launch {
            _connectionState.collect { state ->
                _effectiveMode.value = deriveEffectiveMode(state, _preferStandaloneMode.value)
            }
        }
        refreshProfiles()
        pairedServerStore?.load()?.let { config ->
            refreshProfiles()
            currentUrl = config.connectUrl
            currentToken = config.token
            currentCertFingerprint = config.certFingerprint
            if (runCatching { Request.Builder().url(config.connectUrl).build() }.isFailure) {
                pairedServerStore?.clear()
                refreshProfiles()
            } else {
                doConnectWithFallbacks(listOf(config.connectUrl))
            }
        }
        networkMonitor = NetworkReconnectMonitor(application).also { it.start() }
    }

    fun connect(config: PairedServerConfig) {
        reconnectJob?.cancel()
        handshakeTimeoutJob?.cancel()
        ws?.cancel()
        currentUrl = config.connectUrl
        currentToken = config.token
        currentCertFingerprint = config.certFingerprint
        reconnectAttempts = 0
        _reconnectExhausted.value = false
        val allUrls = listOf(config.connectUrl) + config.fallbackConnectUrls()
        doConnectWithFallbacks(allUrls)
    }

    private fun buildPinnedClient(fingerprint: String): OkHttpClient {
        val trustManager = object : javax.net.ssl.X509TrustManager {
            override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) {}
            override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) {
                val cert = chain.firstOrNull()
                    ?: throw java.security.cert.CertificateException("No certificate in chain")
                val digest = java.security.MessageDigest.getInstance("SHA-256").digest(cert.encoded)
                val fp = digest.joinToString("") { "%02x".format(it) }
                if (fp != fingerprint.lowercase())
                    throw java.security.cert.CertificateException("Certificate fingerprint mismatch")
            }
            override fun getAcceptedIssuers(): Array<java.security.cert.X509Certificate> = emptyArray()
        }
        val sslContext = javax.net.ssl.SSLContext.getInstance("TLS")
        sslContext.init(null, arrayOf(trustManager), null)
        @Suppress("CustomX509TrustManager")
        return client.newBuilder()
            .sslSocketFactory(sslContext.socketFactory, trustManager)
            .hostnameVerifier { _, _ -> true }
            .build()
    }

    // A manifest fetched during a prior session is only valid while connected — once the socket
    // drops, clear it so the Updates screen doesn't show a stale "published" status alongside a
    // "not connected" warning.
    private fun markDisconnected() {
        _connectionState.value = ConnectionState.DISCONNECTED
        _androidUpdateManifest.value = null
    }

    // Race all candidate URLs in parallel; the first to open wins and the others are cancelled.
    // Falls back to the single-URL path when there is only one candidate.
    private fun doConnectWithFallbacks(urls: List<String>) {
        if (urls.size <= 1) {
            doConnect(urls.firstOrNull() ?: return)
            return
        }
        _connectionState.value = ConnectionState.CONNECTING
        _syncProgress.value = SyncProgress(SyncProgressPhase.CONNECTING)
        connectionStartedAtMs = android.os.SystemClock.elapsedRealtime()
        appendDebugLog("sync-timing", "connection-start candidates=${urls.size}")
        val raceScope = CoroutineScope(Dispatchers.IO)
        val winner = java.util.concurrent.atomic.AtomicBoolean(false)
        // Track losing WebSockets so we ignore their subsequent callbacks.
        val losers = mutableListOf<WebSocket>()
        val loserLock = Any()
        // Count failures so we only scheduleReconnect once after all candidates fail.
        val failCount = java.util.concurrent.atomic.AtomicInteger(0)
        val candidateCount = urls.size

        for (wsUrl in urls) {
            val request = runCatching { Request.Builder().url(wsUrl).build() }.getOrNull() ?: run {
                if (failCount.incrementAndGet() == candidateCount && !winner.get()) {
                    markDisconnected()
                    scheduleReconnect()
                }
                continue
            }
            val fp = currentCertFingerprint
            val activeClient = fp?.takeIf { it.isNotBlank() }?.let { buildPinnedClient(it) } ?: client
            activeClient.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    if (!winner.compareAndSet(false, true)) {
                        // Another URL won the race — close this connection immediately.
                        synchronized(loserLock) { losers.add(webSocket) }
                        webSocket.cancel()
                        return
                    }
                    raceScope.cancel()
                    // Update currentUrl to the winning URL so reconnects reuse it.
                    currentUrl = wsUrl
                    onWsOpen(webSocket)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    synchronized(loserLock) { if (losers.contains(webSocket)) return }
                    onWsMessage(text)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    synchronized(loserLock) { if (losers.contains(webSocket)) return }
                    android.util.Log.w(WS_LOG_TAG, "candidate $wsUrl failed: ${t.message}", t)
                    _lastError.value = t.message
                    if (!winner.get() && failCount.incrementAndGet() == candidateCount) {
                        markDisconnected()
                        scheduleReconnect()
                    }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    synchronized(loserLock) { if (losers.contains(webSocket)) return }
                    if (!winner.get()) return
                    handleSocketClosed(code)
                }
            })
        }
    }

    private fun doConnect(wsUrl: String): Boolean {
        _connectionState.value = ConnectionState.CONNECTING
        _syncProgress.value = SyncProgress(SyncProgressPhase.CONNECTING)
        connectionStartedAtMs = android.os.SystemClock.elapsedRealtime()
        appendDebugLog("sync-timing", "connection-start candidates=1")
        val request = runCatching { Request.Builder().url(wsUrl).build() }
            .getOrElse {
                _lastError.value = it.message ?: "Invalid WebSocket URL"
                markDisconnected()
                return false
            }
        val activeClient = currentCertFingerprint?.takeIf { it.isNotBlank() }
            ?.let { buildPinnedClient(it) } ?: client
        ws = activeClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = onWsOpen(webSocket)
            override fun onMessage(webSocket: WebSocket, text: String) = onWsMessage(text)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                android.util.Log.w(WS_LOG_TAG, "connection to $wsUrl failed: ${t.message}", t)
                _lastError.value = t.message
                markDisconnected()
                scheduleReconnect()
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = handleSocketClosed(code)
        })
        return true
    }

    /**
     * Shared close-code policy for both connect paths: 4001 (unauthorized) and 4002
     * (token regenerated — re-pair required) must NOT auto-reconnect, except when the
     * close was part of an intentional desktop restart we were told to expect.
     */
    private fun handleSocketClosed(code: Int) {
        markDisconnected()
        val intentional = _intentionalRestartExpected.compareAndSet(expect = true, update = false)
        if ((code != WS_CLOSE_UNAUTHORIZED && code != WS_CLOSE_TOKEN_REGENERATED) || intentional) scheduleReconnect()
    }

    private fun onWsOpen(webSocket: WebSocket) {
        ws = webSocket
        reconnectAttempts = 0
        _reconnectExhausted.value = false
        _connectionState.value = ConnectionState.CONNECTED
        appendDebugLog("sync-timing", "socket-open elapsedMs=${elapsedSince(connectionStartedAtMs)}")
        _lastError.value = null
        _serverVersion.value = null
        _desktopIsPackaged.value = null
        val endpoint = currentUrl?.substringBefore("?token=")
        val token = currentToken
        if (!endpoint.isNullOrBlank() && !token.isNullOrBlank()) {
            pairedServerStore?.save(PairedServerConfig(endpoint, token, currentCertFingerprint))
            refreshProfiles()
        }
        flushPendingCommands()
        send("chat:get-emergency-stop", emptyMap())
        // If the desktop doesn't send the "connected" event within 15s, treat it as a failure.
        handshakeTimeoutJob?.cancel()
        handshakeTimeoutJob = scope.launch {
            var elapsed = 0
            while (_serverVersion.value == null && elapsed < 15_000) {
                delay(500L)
                elapsed += 500
            }
            if (_serverVersion.value == null) {
                _lastError.value = "Desktop did not respond — check that Nexy is open and on the same network."
                webSocket.cancel()
                markDisconnected()
                scheduleReconnect()
            }
        }
    }

    private fun onWsMessage(text: String) {
        // Cheap prefix guard before the full JSON parse: the emergency-stop event is small, but this
        // handler runs on the socket reader thread for EVERY frame — including the multi-MB
        // sync:welcome snapshot. Fully parsing that payload here just to check one string field
        // doubles allocation/GC on the largest message the app ever receives, so skip it unless the
        // event name is actually present.
        if (text.contains("\"chat:emergency-stop-changed\"")) {
            runCatching {
                val envelope = JSONObject(text)
                if (envelope.optString("event") == "chat:emergency-stop-changed") {
                    _emergencyStopActive.value = envelope.optJSONObject("data")?.optBoolean("active", false) == true
                    app?.let { PreferenceStore.getInstance(it).setEmergencyStopActive(_emergencyStopActive.value) }
                }
            }
        }
        val isSyncWelcome = text.take(160).contains("\"sync:welcome\"")
        val parseStartedAt = if (isSyncWelcome) android.os.SystemClock.elapsedRealtime() else 0L
        if (isSyncWelcome) {
            appendDebugLog(
                "sync-timing",
                "snapshot-received elapsedMs=${elapsedSince(syncStartedAtMs)} payloadChars=${text.length}",
            )
        }
        parseWsEvent(
            text = text,
            scope = scope,
            events = _remoteEvents,
            serverVersion = _serverVersion,
            desktopIsPackaged = _desktopIsPackaged,
            conversations = _conversations,
            projects = _projects,
            agents = _agents,
            agentFullConfig = agentFullConfig,
            models = _models,
            modelSource = _modelSource,
            androidUpdateManifest = _androidUpdateManifest,
            providers = _providers,
            mcpServers = _mcpServers,
            mcpCatalog = _mcpCatalog,
            skills = _skills,
            skillAgentUsage = _skillAgentUsage,
            discoveredSkills = _discoveredSkills,
            artifacts = _artifacts,
            wikiEntries = _wikiEntries,
            promptEntries = _promptEntries,
            cliStatus = _cliStatus,
            hermesInfo = _hermesInfo,
            scheduledTasks = _scheduledTasks,
            scheduledRuns = _scheduledRuns,
            currentDebrief = _currentDebrief,
            completedConversationIds = _completedConversationIds,
            currentRating = _currentRating,
            ratingsList = _ratingsList,
            ratingStats = _ratingStats,
            pairedServerStore = pairedServerStore,
        )
        if (isSyncWelcome) {
            appendDebugLog(
                "sync-timing",
                "snapshot-json-parsed elapsedMs=${elapsedSince(parseStartedAt)} payloadChars=${text.length}",
            )
        }
    }

    private fun scheduleReconnect() {
        if (_preferStandaloneMode.value) return
        val url = currentUrl ?: return
        if (currentToken == null) return
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val delayMs = reconnectDelayMs(reconnectAttempts)
            val isPolling = reconnectAttempts >= BACKOFF_DELAYS.size
            if (isPolling) {
                _connectionState.value = ConnectionState.POLLING
            }
            delay(delayMs)
            reconnectAttempts++

            // In slow-polling mode try mDNS first; if we find the service and
            // the token matches, use that URL — it may have a different IP.
            if (isPolling) {
                val appCtx = app
                val token = currentToken
                if (appCtx != null && !token.isNullOrBlank()) {
                    val mdns = MdnsDiscovery(appCtx)
                    activeMdnsDiscovery = mdns
                    mdns.startDiscovery()
                    delay(3_000L)
                    val hit = mdns.discovered.value.firstOrNull { it.token == token }
                    mdns.stopDiscovery()
                    activeMdnsDiscovery = null
                    if (hit != null) {
                        val mdnsUrl = "wss://${hit.host}:${hit.port}?token=${hit.token}"
                        doConnect(mdnsUrl)
                        return@launch
                    }
                }
            }

            doConnect(url)
        }
    }

    // Called by NetworkReconnectMonitor when a new network interface becomes available
    // (e.g. WireGuard VPN comes up, Wi-Fi switches). If we're not already connected,
    // cancel any pending retry and attempt immediately.
    fun onNetworkAvailable() {
        localData?.setInternetState(InternetState.AVAILABLE)
        if (_preferStandaloneMode.value) return
        if (currentUrl == null || currentToken == null) return
        val state = _connectionState.value
        if (state == ConnectionState.CONNECTED) return
        // Reset backoff so the retry is immediate (1 s) rather than waiting 60 s.
        reconnectAttempts = 0
        _reconnectExhausted.value = false
        reconnectJob?.cancel()
        ws?.cancel()
        markDisconnected()
        scheduleReconnect()
    }

    fun onNetworkUnavailable() {
        localData?.setInternetState(InternetState.UNAVAILABLE)
    }

    // Validate a socket that survived backgrounding before replacing it. A healthy connection
    // has already received desktop push events, so keeping it avoids a TLS/WebSocket handshake
    // and the full reconnect snapshot. A silent half-open socket falls back to the existing
    // reconnect path after a short application-level round trip timeout.
    fun onAppForegrounded() {
        if (_preferStandaloneMode.value) return
        if (currentUrl == null || currentToken == null) return
        if (_connectionState.value == ConnectionState.CONNECTING) return
        if (_connectionState.value == ConnectionState.CONNECTED && ws != null) {
            val probeId = UUID.randomUUID().toString()
            pendingForegroundProbeId = probeId
            foregroundProbeStartedAtMs = android.os.SystemClock.elapsedRealtime()
            foregroundProbeJob?.cancel()
            appendDebugLog("sync-timing", "foreground-probe-start")
            send(
                "sync:probe",
                mapOf(
                    "probeId" to probeId,
                    "clientSentAt" to System.currentTimeMillis(),
                ),
            )
            foregroundProbeJob = scope.launch {
                delay(FOREGROUND_PROBE_TIMEOUT_MS)
                if (pendingForegroundProbeId == probeId) {
                    pendingForegroundProbeId = null
                    appendDebugLog(
                        "sync-timing",
                        "foreground-probe-timeout elapsedMs=${elapsedSince(foregroundProbeStartedAtMs)}",
                    )
                    reconnectAfterForegroundProbeFailure()
                }
            }
            return
        }
        reconnectAfterForegroundProbeFailure()
    }

    private fun reconnectAfterForegroundProbeFailure() {
        reconnectAttempts = 0
        _reconnectExhausted.value = false
        reconnectJob?.cancel()
        ws?.cancel()
        markDisconnected()
        scheduleReconnect()
    }

    private fun beginStandaloneSync(protocolVersion: Int = 2) {
        val local = localData ?: return
        val token = currentToken ?: return
        val datasetId = syncDatasetId(token)
        if (!local.bindDataset(datasetId)) {
            setSyncInProgress(false)
            _syncProgress.value = SyncProgress(SyncProgressPhase.COMPLETE)
            _lastError.value = "This Android dataset belongs to a different paired desktop. Restore or clear local data before switching datasets."
            return
        }
        setSyncInProgress(true)
        negotiatedSyncProtocolVersion = protocolVersion
        _syncProgress.value = SyncProgress(SyncProgressPhase.RECEIVING)
        syncStartedAtMs = android.os.SystemClock.elapsedRealtime()
        appendDebugLog("sync-timing", "sync-hello-send")
        scope.launch {
            val lastDesktopSequence =
                if (protocolVersion >= 2) local.desktopSyncSequence(datasetId) else 0L
            send(
                "sync:hello",
                mapOf(
                    "deviceId" to local.deviceId,
                    "deviceName" to android.os.Build.MODEL,
                    "appVersion" to BuildConfig.VERSION_NAME,
                    "appVersionCode" to BuildConfig.VERSION_CODE,
                    "datasetId" to datasetId,
                    "protocolVersion" to protocolVersion,
                    "schemaVersion" to 2,
                    "supportedEntityTypes" to listOf("project", "agent", "conversation", "message", "wiki", "prompt", "skill"),
                    "attachmentSupport" to "metadata",
                    // Request the metadata-only connect snapshot (item B). Bulk message bodies are
                    // deferred and hydrate on demand via conversation:get-messages when a chat opens,
                    // keeping the connect frame small. Desktops that predate this field ignore it and
                    // send the full snapshot, which still applies correctly.
                    "hydrationMode" to STANDALONE_SYNC_HYDRATION_MODE,
                    "maxBatchSize" to 100,
                    "lastDesktopSequence" to lastDesktopSequence,
                ),
            )
        }
    }

    private suspend fun flushStandaloneOutbox() {
        // Nothing can be pushed from here. Returning while the signal is still true is what left
        // the indicator animating with no transfer behind it (queued changes remain visible as
        // ContentSyncState.PENDING, which is the honest state for work that cannot drain yet).
        if (_connectionState.value != ConnectionState.CONNECTED ||
            localData == null ||
            currentToken == null
        ) {
            setSyncInProgress(false)
            _syncProgress.value = SyncProgress(SyncProgressPhase.COMPLETE)
            return
        }
        val local = localData ?: return
        val token = currentToken ?: return
        val operations = local.pendingBatch(100)
        if (operations.isEmpty()) {
            setSyncInProgress(false)
            _syncProgress.value = SyncProgress(SyncProgressPhase.COMPLETE)
            if (syncStartedAtMs > 0L) {
                appendDebugLog("sync-timing", "sync-settled elapsedMs=${elapsedSince(syncStartedAtMs)}")
                syncStartedAtMs = 0L
            }
            return
        }
        setSyncInProgress(true)
        markPushInFlight()
        _syncProgress.value = SyncProgress(
            phase = SyncProgressPhase.UPLOADING,
            completed = 0,
            total = operations.size,
        )
        val datasetId = syncDatasetId(token)
        val protocolVersion = negotiatedSyncProtocolVersion
        val lastDesktopSequence =
            if (protocolVersion >= 2) local.desktopSyncSequence(datasetId) else 0L
        send(
            "sync:push",
            mapOf(
                "deviceId" to local.deviceId,
                "datasetId" to datasetId,
                "protocolVersion" to protocolVersion,
                "hydrationMode" to STANDALONE_SYNC_HYDRATION_MODE,
                "lastDesktopSequence" to lastDesktopSequence,
                "operations" to operations.map { operation ->
                    mapOf(
                        "operationId" to operation.operationId,
                        "deviceId" to operation.deviceId,
                        "deviceSequence" to operation.deviceSequence,
                        "entityType" to operation.entityType,
                        "entityId" to operation.entityId,
                        "operation" to operation.operation,
                        "payloadJson" to operation.payloadJson,
                        "baseRemoteVersion" to operation.baseRemoteVersion,
                    )
                },
            ),
        )
    }

    private suspend fun applyStandaloneSnapshot(
        snapshot: JSONObject,
        acknowledgeTombstones: Boolean,
        desktopSequence: Long = 0,
        datasetId: String? = null,
    ) {
        val applyStartedAt = android.os.SystemClock.elapsedRealtime()
        try {
            _syncProgress.value = SyncProgress(SyncProgressPhase.APPLYING)
            localData?.applySyncSnapshot(snapshot, activelyViewedConversationId.value) { completed, total ->
                _syncProgress.value = SyncProgress(SyncProgressPhase.APPLYING, completed, total)
            }
            if (datasetId != null) localData?.saveDesktopSyncSequence(datasetId, desktopSequence)
            appendDebugLog(
                "sync-timing",
                "snapshot-room-committed elapsedMs=${elapsedSince(applyStartedAt)}",
            )
            if (acknowledgeTombstones) acknowledgeStandaloneSnapshot(snapshot)
            resumeAttachmentTransfers(snapshot)
            flushStandaloneOutbox()
        } catch (error: Exception) {
            reportSyncFailure("snapshot", error)
        }
    }

    private var prefetchJob: Job? = null

    /**
     * Warms the newest [PREFETCH_CONVERSATION_COUNT] conversations' latest messages into Room after a
     * connect snapshot (item E). Responses arrive as paged `conversation:messages` and persist via the
     * existing remote-event collector, so opening one of these chats becomes a cache hit. Only
     * conversations with no cached bodies are requested, so this is a no-op after a full-mode snapshot
     * or for chats the user has already opened.
     */
    private fun prefetchTopConversations() {
        val local = localData ?: return
        if (_connectionState.value != ConnectionState.CONNECTED) return
        prefetchJob?.cancel()
        prefetchJob = scope.launch {
            val ids = runCatching { local.conversationsNeedingPrefetch(PREFETCH_CONVERSATION_COUNT) }
                .getOrNull()
                ?.takeIf { it.isNotEmpty() }
                ?: return@launch
            appendDebugLog("sync-timing", "prefetch-top-conversations count=${ids.size}")
            ids.forEach { conversationId ->
                if (_connectionState.value != ConnectionState.CONNECTED) return@launch
                send(
                    "conversation:get-messages",
                    mapOf(
                        "conversationId" to conversationId,
                        "limit" to PREFETCH_MESSAGE_LIMIT,
                        "requestId" to java.util.UUID.randomUUID().toString(),
                    ),
                )
            }
        }
    }

    private fun reportSyncFailure(stage: String, error: Exception) {
        setSyncInProgress(false)
        _syncProgress.value = SyncProgress(SyncProgressPhase.COMPLETE)
        val detail = error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
        _lastError.value = "Android sync failed during $stage: $detail"
        appendDebugLog("sync-$stage-error", "${error.javaClass.simpleName}: $detail")
        android.util.Log.e(WS_LOG_TAG, "Standalone sync failed during $stage", error)
    }

    private fun acknowledgeStandaloneSnapshot(snapshot: JSONObject) {
        val token = currentToken ?: return
        val tombstones = snapshot.optJSONArray("tombstones") ?: org.json.JSONArray()
        val items = (0 until tombstones.length()).mapNotNull { index ->
            val item = tombstones.optJSONObject(index) ?: return@mapNotNull null
            mapOf(
                "entityType" to item.optString("entityType"),
                "entityId" to item.optString("entityId"),
                "version" to item.optLong("version"),
            )
        }
        send(
            "sync:snapshot-ack",
            mapOf(
                "datasetId" to syncDatasetId(token),
                "tombstones" to items,
            ),
        )
    }

    private suspend fun resumeAttachmentTransfers(snapshot: JSONObject) {
        val local = localData ?: return
        local.pendingAttachmentUploads().forEach { attachment ->
            send(
                "sync:attachment-manifest",
                mapOf(
                    "contentHash" to attachment.contentHash,
                    "displayName" to attachment.displayName,
                    "mimeType" to attachment.mimeType,
                    "sizeBytes" to attachment.sizeBytes,
                    "attachmentId" to attachment.id,
                    "messageId" to (attachment.messageId ?: ""),
                ),
            )
        }
        local.prepareAttachmentDownloads(snapshot).forEach { download ->
            requestAttachmentChunk(download.contentHash, download.nextOffset)
        }
    }

    private suspend fun handleAttachmentStatus(event: WsEvent.SyncAttachmentStatus) {
        val local = localData ?: return
        if (event.complete) {
            local.markAttachmentTransferred(event.contentHash)
            return
        }
        val data = local.attachmentChunk(event.contentHash, event.nextOffset) ?: return
        send(
            "sync:attachment-chunk",
            mapOf(
                "contentHash" to event.contentHash,
                "offset" to event.nextOffset,
                "dataBase64" to data,
            ),
        )
    }

    private suspend fun handleAttachmentChunk(event: WsEvent.SyncAttachmentChunk) {
        val next = localData?.appendAttachmentChunk(
            hash = event.contentHash,
            expectedSize = event.sizeBytes,
            offset = event.offset,
            dataBase64 = event.dataBase64,
            complete = event.complete,
        ) ?: return
        requestAttachmentChunk(next.contentHash, next.nextOffset)
    }

    private fun requestAttachmentChunk(hash: String, offset: Long) {
        send("sync:attachment-pull", mapOf("contentHash" to hash, "offset" to offset))
    }

    private fun syncDatasetId(token: String): String {
        val bytes = java.security.MessageDigest.getInstance("SHA-256")
            .digest(token.toByteArray(Charsets.UTF_8))
        return bytes.take(12).joinToString("") { "%02x".format(it) }
    }

    fun retryStandaloneSync() {
        if (_connectionState.value == ConnectionState.CONNECTED) beginStandaloneSync()
    }

    fun retryStandaloneOperation(operationId: String) {
        scope.launch {
            localData?.retryOperation(operationId)
            if (_connectionState.value == ConnectionState.CONNECTED) flushStandaloneOutbox()
        }
    }

    fun discardStandaloneOperation(operationId: String) {
        scope.launch {
            localData?.discardOperation(operationId)
            if (_connectionState.value == ConnectionState.CONNECTED) beginStandaloneSync()
        }
    }

    // One-time safety-net sweep for failed operations left over from before the SyncError handler
    // started auto-remediating (or from any other path that could leave one stranded) — lets the
    // Connection screen self-heal on open instead of requiring the user to notice and retry.
    fun sweepOrphanedSyncOperations() {
        scope.launch {
            localData?.discardOrphanedOperations()
            if (_connectionState.value == ConnectionState.CONNECTED) flushStandaloneOutbox()
        }
    }

    fun resolveSyncConflict(conflictId: String, useAndroidVersion: Boolean) {
        // Desktop calls its own value "local"; the incoming Android operation is "remote".
        val resolution = if (useAndroidVersion) "remote" else "local"
        // Apply locally right away so the choice sticks offline / in standalone mode; the desktop's
        // later echo re-runs this on an already-resolved conflict and is a harmless no-op.
        scope.launch { localData?.resolveConflict(conflictId, resolution) }
        if (_connectionState.value == ConnectionState.CONNECTED) {
            send(
                "sync:resolve-conflict",
                mapOf(
                    "conflictId" to conflictId,
                    "resolution" to resolution,
                ),
            )
        }
    }

    private val BACKOFF_DELAYS = longArrayOf(1_000, 2_000, 4_000, 8_000, 16_000, 30_000)
    private const val FOREGROUND_PROBE_TIMEOUT_MS = 750L
    private const val POLLING_DELAY_MS = 60_000L

    private fun elapsedSince(startedAtMs: Long): Long =
        if (startedAtMs <= 0L) 0L else (android.os.SystemClock.elapsedRealtime() - startedAtMs).coerceAtLeast(0L)

    private fun reconnectDelayMs(attempt: Int): Long =
        if (attempt < BACKOFF_DELAYS.size) BACKOFF_DELAYS[attempt] else POLLING_DELAY_MS

    fun disconnect() {
        reconnectJob?.cancel()
        handshakeTimeoutJob?.cancel()
        foregroundProbeJob?.cancel()
        prefetchJob?.cancel()
        pendingForegroundProbeId = null
        currentUrl = null
        currentToken = null
        currentCertFingerprint = null
        ws?.close(1000, "User disconnected")
        ws = null
        _connectionState.value = ConnectionState.DISCONNECTED
        setSyncInProgress(false)
        _syncProgress.value = SyncProgress(SyncProgressPhase.COMPLETE)
        _models.value = STANDALONE_MODELS
        _modelSource.value = ModelListSource(type = "standalone", label = "On-device catalog")
        _androidUpdateManifest.value = null
        _serverVersion.value = null
        _desktopIsPackaged.value = null
        _providers.value = standaloneProviders?.providers?.value.orEmpty()
        _mcpServers.value = emptyList()
        _mcpCatalog.value = emptyList()
        _skillAgentUsage.value = emptyMap()
        _artifacts.value = emptyList()
        _cliStatus.value = emptyMap()
        _hermesInfo.value = HermesCliInfo()
        _scheduledTasks.value = emptyList()
        _scheduledRuns.value = emptyMap()
    }

    fun forgetServer() {
        disconnect()
        val fallback = pairedServerStore?.removeActive()
        refreshProfiles()
        if (fallback != null) {
            connect(fallback)
        }
    }

    fun setPreferStandaloneMode(prefer: Boolean, application: Application? = app) {
        if (application == null) return
        scope.launch {
            PreferenceStore.getInstance(application).setPreferStandaloneMode(prefer)
        }
    }

    fun forgetProfile(profileId: String) {
        if (profileId == _activeProfileId.value) {
            forgetServer()
            return
        }
        pairedServerStore?.removeProfile(profileId)
        refreshProfiles()
    }

    fun switchProfile(profileId: String) {
        val config = pairedServerStore?.setActive(profileId) ?: return
        refreshProfiles()
        disconnect()
        connect(config)
    }

    fun hasPairedServer(): Boolean = pairedServerStore?.profiles()?.isNotEmpty() == true

    fun localDataRepository(): LocalDataRepository? = localData

    fun standaloneProviderStore(): StandaloneProviderStore? = standaloneProviders

    suspend fun testStandaloneProvider(
        provider: String,
        key: String,
        endpoint: String? = null,
    ): Pair<Boolean, String?> = standaloneChat?.test(provider, key, endpoint)
        ?: (false to "Standalone providers are not initialized.")

    fun pairedServer(): PairedServerConfig? = pairedServerStore?.load()

    fun confirmProviderKeyHandoff(providerId: String) {
        // User has explicitly consented to receive this key.
        _confirmedKeyHandoffs.value = _confirmedKeyHandoffs.value + providerId
        // Ask desktop to send it — this only shows a "Send Key" approval banner on
        // desktop (ws-handlers.ts's `provider:key-handoff-request` handler); desktop
        // does not transmit the value until a human explicitly approves there.
        if (_connectionState.value == ConnectionState.CONNECTED) {
            send("provider:key-handoff-request", mapOf("provider" to providerId))
        }
    }

    fun rejectProviderKeyHandoff(providerId: String) {
        // User has rejected the key handoff
        _pendingKeyHandoffRequests.value = _pendingKeyHandoffRequests.value - providerId
        _confirmedKeyHandoffs.value = _confirmedKeyHandoffs.value - providerId
    }

    fun wakeDesktop() {
        val profile = pairedServerStore?.activeProfile() ?: return
        val mac = profile.macAddress ?: return
        val broadcast = profile.broadcastAddress ?: return
        scope.launch {
            runCatching { WakeOnLanHelper.sendMagicPacket(mac, broadcast) }
            reconnectAttempts = 0
            _reconnectExhausted.value = false
            _lastError.value = null
            connect(profile.toConfig())
        }
    }

    private fun refreshProfiles() {
        _profiles.value = pairedServerStore?.profiles().orEmpty()
        _activeProfileId.value = pairedServerStore?.activeProfile()?.id
    }

    override fun send(command: String, data: Map<String, Any>) {
        // Per-device local settings (settings:*) are Android-local preferences with no desktop
        // counterpart — they must resolve locally even while connected, or they silently vanish
        // since the desktop has no handler for them.
        if (_connectionState.value != ConnectionState.CONNECTED || command.startsWith("settings:")) {
            if (handleLocalCommand(command, data)) {
                // The local Room cache can be stale (e.g. a push notification landed while
                // this device was disconnected). If there's a paired desktop to resync
                // against, also queue the command for a real round-trip once reconnected,
                // so the cached answer gets superseded by the authoritative one.
                if (!command.startsWith("settings:") &&
                    _connectionState.value != ConnectionState.CONNECTED &&
                    hasPairedServer()
                ) {
                    android.util.Log.d(WS_LOG_TAG, "queuing '$command' to resync after local fallback")
                    synchronized(pendingCommands) { pendingCommands.add(command to data) }
                    if (_connectionState.value == ConnectionState.DISCONNECTED) connectFromStore()
                }
                return
            }
        }
        // While a foreground probe is outstanding, hold normal commands until the socket is
        // validated. This prevents a chat history refresh (or the foreground signal itself)
        // from being written into a silent half-open connection. Probe acknowledgement flushes
        // the queue immediately; timeout/reconnect flushes it from onWsOpen().
        if (pendingForegroundProbeId != null && command != "sync:probe") {
            synchronized(pendingCommands) { pendingCommands.add(command to data) }
            return
        }
        val socket = ws
        val token = currentToken
        // Queue-or-fail instead of silently dropping: a command fired during a brief
        // reconnect used to no-op here (ws == null), leaving generator UIs stuck in
        // isLoading forever. Queue it and kick a reconnect so it flushes on reopen.
        if (socket == null || token == null || _connectionState.value != ConnectionState.CONNECTED) {
            android.util.Log.d(WS_LOG_TAG, "queuing '$command' while disconnected")
            synchronized(pendingCommands) { pendingCommands.add(command to data) }
            if (_connectionState.value == ConnectionState.DISCONNECTED) connectFromStore()
            return
        }
        val obj = JSONObject()
        obj.put("token", token)
        obj.put("command", command)
        obj.put("data", mapToJson(data))
        registerGeneratorActivityForCommand(command)
        socket.send(obj.toString())
    }

    private fun flushPendingCommands() {
        val queued = synchronized(pendingCommands) {
            pendingCommands.toList().also { pendingCommands.clear() }
        }
        queued.forEach { (command, data) -> send(command, data) }
    }

    /**
     * Executes commands that have safe local semantics when the desktop is unavailable. Commands
     * that control a running desktop process intentionally return false and are not queued.
     */
    fun handleLocalCommand(command: String, data: Map<String, Any>): Boolean {
        val local = localData ?: return false
        when (command) {
            "conversation:list" -> {
                _events.tryEmit(WsEvent.ConversationList(local.conversations.value))
            }
            "conversation:list-page" -> {
                val scopeType = data["scopeType"] as? String ?: "all"
                val scopeId = data["scopeId"] as? String
                val query = (data["query"] as? String).orEmpty().trim()
                val offset = (data["cursor"] as? String)
                    ?.removePrefix("local:")?.toIntOrNull()?.coerceAtLeast(0) ?: 0
                val limit = ((data["limit"] as? Number)?.toInt() ?: 30).coerceIn(1, 100)
                val filtered = local.conversations.value
                    .asSequence()
                    .filter { conversation ->
                        when (scopeType) {
                            "project" -> conversation.project_id == scopeId
                            "agent" -> conversation.agent_id == scopeId
                            else -> true
                        }
                    }
                    .filter { conversation ->
                        query.isBlank() || listOfNotNull(
                            conversation.title,
                            conversation.last_message,
                            conversation.agent_name,
                            conversation.project_name,
                        ).any { it.contains(query, ignoreCase = true) }
                    }
                    .sortedWith(compareByDescending<Conversation> { it.pinned }
                        .thenByDescending { it.updated_at }.thenByDescending { it.id })
                    .toList()
                val items = filtered.drop(offset).take(limit)
                val nextOffset = offset + items.size
                _events.tryEmit(WsEvent.ConversationPage(
                    requestId = data["requestId"] as? String ?: "",
                    conversations = items,
                    totalCount = filtered.size,
                    nextCursor = if (nextOffset < filtered.size) "local:$nextOffset" else null,
                    hasMore = nextOffset < filtered.size,
                ))
            }
            "model:list" -> {
                _events.tryEmit(
                    WsEvent.ModelList(
                        _models.value,
                        ModelListSource(type = "standalone", label = "On-device catalog"),
                    ),
                )
                scope.launch {
                    val discovered = mutableListOf<ModelOption>()
                    for (config in standaloneProviders?.configured().orEmpty()) {
                        discovered += standaloneChat?.listModels(config).orEmpty()
                    }
                    val live = discovered.distinctBy { it.id }
                    if (live.isNotEmpty()) {
                        _models.value = live
                        _modelSource.value = ModelListSource(type = "standalone-live", label = "Provider APIs")
                        _events.emit(WsEvent.ModelList(live, _modelSource.value))
                    }
                }
            }
            "conversation:get-messages" -> {
                val conversationId = data["conversationId"] as? String ?: return true
                scope.launch {
                    val limit = (data["limit"] as? Number)?.toInt()
                    if (limit == null) {
                        // Preserve the legacy local command shape for non-paginated callers.
                        _events.emit(WsEvent.ConversationMessages(conversationId, local.list(conversationId)))
                    } else {
                        val page = local.listPage(
                            conversationId = conversationId,
                            limit = limit,
                            beforeTimestamp = (data["beforeTimestamp"] as? Number)?.toLong(),
                            beforeId = data["beforeId"] as? String,
                        )
                        _events.emit(
                            WsEvent.ConversationMessages(
                                conversationId = conversationId,
                                messages = page.messages,
                                paged = true,
                                hasMore = page.hasMore,
                                nextBeforeTimestamp = page.nextBeforeTimestamp,
                                nextBeforeId = page.nextBeforeId,
                            ),
                        )
                    }
                }
            }
            "conversation:search" -> {
                val query = data["query"] as? String ?: ""
                scope.launch {
                    _events.emit(WsEvent.ConversationSearchResults(local.searchConversations(query)))
                }
            }
            "conversation:rename" -> {
                val id = data["id"] as? String ?: return true
                val title = (data["title"] as? String)?.trim()?.take(120) ?: return true
                if (title.isBlank()) return true
                scope.launch {
                    local.renameConversation(id, title)
                    _events.emit(WsEvent.ConversationRenamed(id, title))
                }
            }
            "conversation:set-pinned" -> {
                val id = data["id"] as? String ?: return true
                val pinned = data["pinned"] as? Boolean ?: false
                scope.launch { local.setConversationPinned(id, pinned) }
            }
            "conversation:delete" -> {
                val id = data["id"] as? String ?: return true
                scope.launch {
                    local.deleteConversation(id)
                    _events.emit(WsEvent.ConversationDeleted(id))
                }
            }
            "message:delete" -> {
                val id = data["id"] as? String ?: return true
                scope.launch {
                    local.deleteMessage(id)
                    _events.emit(WsEvent.MessageDeleted(id))
                }
            }
            "message:delete-after" -> {
                val conversationId = data["conversationId"] as? String ?: return true
                val timestamp = (data["timestamp"] as? Number)?.toLong() ?: return true
                scope.launch {
                    local.deleteMessagesAfter(conversationId, timestamp)
                    _events.emit(WsEvent.MessagesDeletedAfter(conversationId, timestamp))
                }
            }
            "conversation:fork" -> {
                val conversationId = data["conversationId"] as? String ?: return true
                val cutoff = (data["cutoffTimestamp"] as? Number)?.toLong()
                val projectWasSelected = data.containsKey("projectId")
                val targetProjectId = (data["projectId"] as? String)?.takeIf { it.isNotBlank() }
                scope.launch {
                    try {
                        val fork = local.forkConversation(conversationId, cutoff, targetProjectId, projectWasSelected)
                        if (fork == null) {
                            _events.emit(WsEvent.ConversationForkError("Conversation is not available locally."))
                        } else {
                            _events.emit(WsEvent.ConversationForked(fork.first.id, fork.first.title, fork.second, fork.first.project_id))
                        }
                    } catch (error: Exception) {
                        _events.emit(WsEvent.ConversationForkError(error.message ?: "Fork failed."))
                    }
                }
            }
            "project:list" -> _events.tryEmit(WsEvent.ProjectList(local.projects.value))
            "project:create" -> {
                val name = data["name"] as? String ?: return true
                val color = data["color"] as? String ?: "blue"
                scope.launch {
                    val created = local.createProject(name, color)
                    _events.emit(WsEvent.ProjectCreated(created))
                }
            }
            "project:rename" -> {
                val id = data["id"] as? String ?: return true
                val name = data["name"] as? String ?: return true
                val color = data["color"] as? String
                scope.launch {
                    local.renameProject(id, name, color)
                    _events.emit(WsEvent.ProjectRenamed(id, name, color))
                }
            }
            "project:delete" -> {
                val id = data["id"] as? String ?: return true
                scope.launch {
                    local.deleteProject(id)
                    _events.emit(WsEvent.ProjectDeleted(id))
                }
            }
            "project:get-config" -> {
                val id = data["id"] as? String ?: return true
                scope.launch {
                    local.getProjectConfig(id)?.let { _events.emit(WsEvent.ProjectConfig(id, it)) }
                }
            }
            "project:update-config" -> {
                val id = data["id"] as? String ?: return true
                scope.launch {
                    local.updateProjectConfig(id, mapToJson(data))?.let {
                        _events.emit(WsEvent.ProjectConfig(id, it))
                        _events.emit(WsEvent.ProjectConfigUpdated(id))
                    }
                }
            }
            "agent:list" -> _events.tryEmit(WsEvent.AgentList(local.agents.value))
            "agent:get-full" -> {
                val id = data["id"] as? String ?: return true
                scope.launch {
                    local.getAgentFull(id)?.let { _events.emit(WsEvent.AgentFull(it)) }
                }
            }
            "agent:create" -> {
                val name = data["name"] as? String ?: return true
                val icon = data["icon"] as? String ?: ""
                scope.launch {
                    val created = local.createAgent(name, icon)
                    _events.emit(WsEvent.AgentCreated(created))
                }
            }
            "agent:update" -> {
                val id = data["id"] as? String ?: return true
                val name = data["name"] as? String ?: return true
                val icon = data["icon"] as? String ?: ""
                scope.launch {
                    if (data.containsKey("systemPrompt") || data.containsKey("tools")) {
                        local.updateAgentFull(id, mapToJson(data))?.let {
                            _events.emit(WsEvent.AgentFull(it))
                            _events.emit(WsEvent.AgentUpdated(Agent(it.id, it.name, it.icon, it.backend, it.cliModel)))
                        }
                    } else {
                        local.updateAgent(id, name, icon)
                        _events.emit(WsEvent.AgentUpdated(Agent(id, name, icon)))
                    }
                }
            }
            "agent:delete" -> {
                val id = data["id"] as? String ?: return true
                scope.launch {
                    local.deleteAgent(id)
                    _events.emit(WsEvent.AgentDeleted(id))
                }
            }
            "wiki:list" -> {
                val projectId = data["projectId"] as? String
                val entries = local.wikiEntries.value.filter { projectId == null || it.projectId == projectId }
                _events.tryEmit(WsEvent.WikiList(entries))
            }
            "wiki:create" -> {
                val projectId = data["projectId"] as? String ?: return true
                val title = data["title"] as? String ?: return true
                val body = data["body"] as? String ?: ""
                val tags = (data["tags"] as? List<*>)?.mapNotNull { it as? String }.orEmpty()
                scope.launch {
                    val created = local.createWiki(projectId, title, body, tags)
                    _events.emit(WsEvent.WikiEntryCreated(created))
                }
            }
            "wiki:update" -> {
                val id = data["id"] as? String ?: return true
                val title = data["title"] as? String ?: return true
                val body = data["body"] as? String ?: ""
                val tags = (data["tags"] as? List<*>)?.mapNotNull { it as? String }.orEmpty()
                scope.launch {
                    local.updateWiki(id, title, body, tags)?.let {
                        _events.emit(WsEvent.WikiEntryUpdated(it))
                    }
                }
            }
            "wiki:delete" -> {
                val id = data["id"] as? String ?: return true
                scope.launch {
                    local.deleteLibraryItem("wiki", id)
                    _events.emit(WsEvent.WikiEntryDeleted(id))
                }
            }
            "prompt:list" -> {
                val projectId = normalizePromptProjectId(data["projectId"] as? String)
                val entries = local.promptEntries.value.filter { it.isVisibleInProject(projectId) }
                _events.tryEmit(WsEvent.PromptList(entries))
            }
            "prompt:create" -> {
                val title = data["title"] as? String ?: return true
                val body = data["body"] as? String ?: ""
                val description = data["description"] as? String ?: ""
                val category = data["category"] as? String ?: ""
                val tags = (data["tags"] as? List<*>)?.mapNotNull { it as? String }.orEmpty()
                val promptScope = data["scope"] as? String ?: "global"
                val projectId = data["projectId"] as? String
                scope.launch {
                    val created = local.createPromptLocal(title, body, description, category, tags, promptScope, projectId)
                    _events.emit(WsEvent.PromptEntryCreated(created))
                }
            }
            "prompt:update" -> {
                val id = data["id"] as? String ?: return true
                val title = data["title"] as? String ?: return true
                val body = data["body"] as? String ?: ""
                val description = data["description"] as? String ?: ""
                val category = data["category"] as? String ?: ""
                val tags = (data["tags"] as? List<*>)?.mapNotNull { it as? String }.orEmpty()
                scope.launch {
                    local.updatePromptLocal(id, title, body, description, category, tags)?.let {
                        _events.emit(WsEvent.PromptEntryUpdated(it))
                    }
                }
            }
            "prompt:delete" -> {
                val id = data["id"] as? String ?: return true
                scope.launch {
                    local.deleteLibraryItem("prompt", id)
                    _events.emit(WsEvent.PromptEntryDeleted(id))
                }
            }
            "skill:list" -> _events.tryEmit(WsEvent.SkillList(local.skills.value))
            "skill:get" -> {
                val id = data["id"] as? String
                _events.tryEmit(WsEvent.SkillDetail(local.skills.value.firstOrNull { it.id == id }))
            }
            "skill:create", "skill:update", "skill:import" -> {
                val source = if (command == "skill:import") {
                    @Suppress("UNCHECKED_CAST")
                    data["skill"] as? Map<String, Any> ?: emptyMap()
                } else data
                val id = if (command == "skill:update") data["id"] as? String else null
                scope.launch {
                    val skill = local.upsertSkillLocal(mapToJson(source), id)
                    _events.emit(if (id == null) WsEvent.SkillCreated(skill) else WsEvent.SkillUpdated(skill))
                }
            }
            "skill:delete" -> {
                val id = data["id"] as? String ?: return true
                scope.launch {
                    local.deleteLibraryItem("skill", id)
                    _events.emit(WsEvent.SkillDeleted(id))
                }
            }
            "conversation:insert-message" -> {
                val conversationId = data["conversationId"] as? String ?: return true
                val role = data["role"] as? String ?: return true
                val content = data["content"] as? String ?: ""
                scope.launch {
                    val created = local.insertMessage(conversationId, role, content)
                    _events.emit(
                        WsEvent.MessageInserted(
                            conversationId,
                            created.id,
                            created.role,
                            created.content,
                            created.timestamp,
                        ),
                    )
                }
            }
            "chat:send-message" -> {
                if (_emergencyStopActive.value) {
                    _lastError.value = "Emergency stop is active. Resume conversations before sending."
                } else {
                    scope.launch { standaloneChat?.send(data) }
                }
            }
            "chat:get-emergency-stop" -> {
                // StateFlow is already authoritative for standalone mode.
            }
            "chat:activate-emergency-stop" -> {
                _emergencyStopActive.value = true
                app?.let { PreferenceStore.getInstance(it).setEmergencyStopActive(true) }
                standaloneChat?.activateEmergencyStop()
            }
            "chat:resume-conversations" -> {
                _emergencyStopActive.value = false
                app?.let { PreferenceStore.getInstance(it).setEmergencyStopActive(false) }
                standaloneChat?.resumeConversations()
            }
            "agent:stop" -> {
                val conversationId = data["conversationId"] as? String ?: return true
                standaloneChat?.stop(conversationId)
            }
            "settings:get-default-desktop-model" -> {
                scope.launch {
                    val model = settingsStore?.getDefaultDesktopModel()
                    _events.emit(WsEvent.SettingValue("defaultDesktopModel", model))
                }
            }
            "settings:set-default-desktop-model" -> {
                val modelId = data["modelId"] as? String
                scope.launch {
                    settingsStore?.setDefaultDesktopModel(modelId)
                    _events.emit(WsEvent.SettingValue("defaultDesktopModel", modelId))
                }
            }
            "settings:get-default-standalone-model" -> {
                scope.launch {
                    val model = settingsStore?.getDefaultStandaloneModel()
                    _events.emit(WsEvent.SettingValue("defaultStandaloneModel", model))
                }
            }
            "settings:set-default-standalone-model" -> {
                val modelId = data["modelId"] as? String
                scope.launch {
                    settingsStore?.setDefaultStandaloneModel(modelId)
                    _events.emit(WsEvent.SettingValue("defaultStandaloneModel", modelId))
                }
            }
            "settings:get-default-temperature" -> {
                scope.launch {
                    val temp = settingsStore?.getDefaultTemperature()
                    _events.emit(WsEvent.SettingValue("defaultTemperature", temp?.toString()))
                }
            }
            "settings:set-default-temperature" -> {
                val temp = (data["temperature"] as? Number)?.toDouble()
                scope.launch {
                    settingsStore?.setDefaultTemperature(temp)
                    _events.emit(WsEvent.SettingValue("defaultTemperature", temp?.toString()))
                }
            }
            "settings:get-default-max-tokens" -> {
                scope.launch {
                    val maxTokens = settingsStore?.getDefaultMaxTokens()
                    _events.emit(WsEvent.SettingValue("defaultMaxTokens", maxTokens?.toString()))
                }
            }
            "settings:set-default-max-tokens" -> {
                val maxTokens = (data["maxTokens"] as? Number)?.toInt()
                scope.launch {
                    settingsStore?.setDefaultMaxTokens(maxTokens)
                    _events.emit(WsEvent.SettingValue("defaultMaxTokens", maxTokens?.toString()))
                }
            }
            else -> return false
        }
        return true
    }

    fun sendLog(tag: String, message: String) {
        val safeMessage = redactDiagnostic(message)
        runCatching { android.util.Log.d("NexyDebug[$tag]", safeMessage) }
        val entry = DebugLogEntry(tag = tag, message = safeMessage, ts = System.currentTimeMillis())
        val current = _debugLog.value
        _debugLog.value = if (current.size >= 500) current.drop(1) + entry else current + entry
        persistDiagnostic(entry)
        send("android:log", mapOf("tag" to tag, "message" to safeMessage, "ts" to entry.ts))
    }

    fun appendDebugLog(tag: String, message: String) {
        val safeMessage = redactDiagnostic(message)
        runCatching { android.util.Log.d("NexyDebug[$tag]", safeMessage) }
        val entry = DebugLogEntry(tag = tag, message = safeMessage, ts = System.currentTimeMillis())
        val current = _debugLog.value
        _debugLog.value = if (current.size >= 500) current.drop(1) + entry else current + entry
        persistDiagnostic(entry)
    }

    fun clearDebugLog() {
        _debugLog.value = emptyList()
        localData?.let { local -> scope.launch { local.clearDiagnostics() } }
    }

    /** Mirror an in-memory debug entry into the persistent, retention-pruned diagnostic log. */
    private fun persistDiagnostic(entry: DebugLogEntry) {
        val local = localData ?: return
        scope.launch { local.recordDiagnostic(entry.tag, entry.message, entry.ts) }
    }

    /** Sweep diagnostics past the one-week window, then hydrate the debug log with what survives. */
    private fun loadPersistedDiagnostics(local: LocalDataRepository) {
        scope.launch {
            local.pruneDiagnostics(System.currentTimeMillis() - DIAGNOSTIC_RETENTION_MS)
            val persisted = local.recentDiagnostics(500)
                .map { DebugLogEntry(tag = it.tag, message = it.message, ts = it.ts) }
                .sortedBy { it.ts }
            if (persisted.isEmpty()) return@launch
            // Merge persisted history ahead of anything logged during this startup, dedupe, keep the cap.
            _debugLog.value = (persisted + _debugLog.value).distinct().takeLast(500)
        }
    }

    private fun redactDiagnostic(message: String): String = message
        .replace(Regex("(?i)(authorization\\s*[:=]\\s*bearer\\s+)[^\\s,}]+"), "${'$'}1[redacted]")
        .replace(Regex("(?i)((?:api[_-]?key|x-api-key|token|secret)\\s*[:=]\\s*)[^\\s,}]+"), "${'$'}1[redacted]")
        .replace(Regex("data:[^;,\\s]+;base64,[A-Za-z0-9+/=]+"), "data:[redacted]")
        .take(2_000)

    fun listConversations() { send("conversation:list", emptyMap()) }
    fun getConversationCapabilities(conversationId: String) {
        send("conversation:get-capabilities", mapOf("conversationId" to conversationId))
    }
    fun resolveCapabilities(conversationId: String, modelId: String? = null) {
        send("capabilities:resolve", buildMap {
            put("conversationId", conversationId)
            modelId?.let { put("modelId", it) }
        })
    }
    fun activateCapabilities(
        conversationId: String,
        skillIds: List<String> = emptyList(),
        mcp: List<Map<String, String>> = emptyList(),
        scope: String = "chat",
        targetId: String? = null,
    ) {
        send("capabilities:activate", buildMap {
            put("conversationId", conversationId)
            put("skillIds", skillIds)
            put("mcp", mcp)
            put("scope", scope)
            targetId?.let { put("targetId", it) }
        })
    }
    fun listConversationPage(
        scopeType: String,
        scopeId: String?,
        query: String,
        cursor: String?,
        requestId: String,
        limit: Int = 30,
    ) {
        val payload = mutableMapOf<String, Any>(
            "scopeType" to scopeType,
            "query" to query,
            "requestId" to requestId,
            "limit" to limit,
        )
        scopeId?.let { payload["scopeId"] = it }
        cursor?.let { payload["cursor"] = it }
        // The desktop contract nests scope; retain the flat fields for local-mode handling.
        payload["scope"] = buildMap<String, Any> {
            put("type", scopeType)
            scopeId?.let { put("id", it) }
        }
        send("conversation:list-page", payload)
    }
    fun renameConversation(id: String, title: String) { send("conversation:rename", mapOf("id" to id, "title" to title)) }
    fun deleteConversation(id: String) { send("conversation:delete", mapOf("id" to id)) }
    fun archiveConversation(id: String) {
        scope.launch {
            localData?.archiveConversation(id)
            if (_connectionState.value == ConnectionState.CONNECTED) flushStandaloneOutbox()
        }
    }
    fun clearConversationSnapshot(conversationId: String) {
        _activeChatSnapshots.value = _activeChatSnapshots.value - conversationId
    }
    /** For testing only: seed repository state as if a ChatActivity event had been received. */
    fun seedActiveConversationForTest(conversationId: String, snapshot: ActiveChatSnapshot) {
        _activeConversationIds.value = _activeConversationIds.value + conversationId
        _activeChatSnapshots.value = _activeChatSnapshots.value + (conversationId to snapshot)
    }
    fun clearConversationActiveState(conversationId: String) {
        _activeConversationIds.value = _activeConversationIds.value - conversationId
        _pendingConversationIds.value = _pendingConversationIds.value - conversationId
        _activeChatSnapshots.value = _activeChatSnapshots.value - conversationId
    }
    fun searchConversations(query: String) { send("conversation:search", mapOf("query" to query)) }
    fun setPinnedConversation(id: String, pinned: Boolean) {
        // Optimistic update so the pin icon and sort order reflect immediately,
        // before the desktop echoes conversation:pinned back.
        _conversations.value = _conversations.value.map { if (it.id == id) it.copy(pinned = pinned) else it }
        send("conversation:set-pinned", mapOf("id" to id, "pinned" to pinned))
    }
    fun updateConversationContext(conversationId: String, projectId: String?, agentId: String?) {
        val m = mutableMapOf<String, Any>("conversationId" to conversationId)
        if (projectId != null) m["projectId"] = projectId else m["projectId"] = ""
        if (agentId != null) m["agentId"] = agentId else m["agentId"] = ""
        send("conversation:update-context", m)
    }
    fun insertMessage(conversationId: String, role: String, content: String) {
        send("conversation:insert-message", mapOf("conversationId" to conversationId, "role" to role, "content" to content))
    }
    fun deleteMessagesAfter(conversationId: String, timestamp: Long) {
        send("message:delete-after", mapOf("conversationId" to conversationId, "timestamp" to timestamp))
    }
    fun getInspectorSnapshot(conversationId: String) { send("context:inspector-snapshot", mapOf("conversationId" to conversationId)) }
    fun getCompressionPreview(conversationId: String) { send("conversation:compression-preview", mapOf("conversationId" to conversationId)) }
    fun prepareCompressionSummary(conversationId: String) { send("conversation:prepare-compression-summary", mapOf("conversationId" to conversationId)) }
    fun saveCompressionSummary(conversationId: String, draft: Map<String, Any>) {
        send("conversation:save-compression-summary", mapOf("conversationId" to conversationId) + draft)
    }
    fun deleteMessage(id: String) { send("message:delete", mapOf("id" to id)) }
    fun editMessage(id: String, content: String) {
        scope.launch {
            localData?.updateMessageContent(id, content, partial = false, sendFailed = false)
            if (_connectionState.value == ConnectionState.CONNECTED) flushStandaloneOutbox()
        }
    }
    // --- Project Git workbench (backs the Android /code panel) ---
    fun listCodeChangeRepos(workspaceRoot: String) {
        send("project-git:list-repos", mapOf("workspaceRoot" to workspaceRoot))
    }

    fun respondToUserInput(requestId: String, answers: List<io.nexy.android.ui.chat.UserInputAnswer>) {
        sendOrQueue(
            "chat:user-input-response",
            mapOf(
                "requestId" to requestId,
                "answers" to answers.map { answer ->
                    buildMap<String, Any> {
                        put("questionId", answer.questionId)
                        put("selectedOptionIds", answer.selectedOptionIds)
                        answer.text?.takeIf { it.isNotBlank() }?.let { put("text", it) }
                    }
                },
            ),
        )
    }
    fun listCodeChangeChangedFiles(repoRoot: String, seq: Int = 0) {
        send("project-git:list-changed-files", mapOf("repoRoot" to repoRoot, "seq" to seq))
    }
    fun listCodeChangeBranches(repoRoot: String, seq: Int = 0) {
        send("project-git:list-branches", mapOf("repoRoot" to repoRoot, "seq" to seq))
    }
    fun checkoutCodeChangeBranch(repoRoot: String, branchName: String) {
        send("project-git:checkout-branch", mapOf("repoRoot" to repoRoot, "branchName" to branchName))
    }
    fun createCodeChangeBranch(repoRoot: String, branchName: String, fromRef: String? = null) {
        val payload = mutableMapOf<String, Any>("repoRoot" to repoRoot, "branchName" to branchName)
        if (!fromRef.isNullOrBlank()) payload["fromRef"] = fromRef
        send("project-git:new-branch", payload)
    }
    fun fetchCodeChangeRepo(repoRoot: String, remote: String? = null) {
        val payload = mutableMapOf<String, Any>("repoRoot" to repoRoot)
        if (!remote.isNullOrBlank()) payload["remote"] = remote
        send("project-git:fetch", payload)
    }
    fun mergeCodeChangeBranch(repoRoot: String, sourceBranch: String) {
        send("project-git:merge-branch", mapOf("repoRoot" to repoRoot, "sourceBranch" to sourceBranch))
    }
    fun initCodeChangeRepo(workspaceRoot: String, relativePath: String? = null) {
        val payload = mutableMapOf<String, Any>("workspaceRoot" to workspaceRoot)
        if (!relativePath.isNullOrBlank()) payload["relativePath"] = relativePath
        send("project-git:init-repo", payload)
    }
    fun detectCodeChangeCredentials(repoRoot: String) {
        send("project-git:detect-credentials", mapOf("repoRoot" to repoRoot))
    }
    fun pullCodeChangeRepo(repoRoot: String, remote: String? = null) {
        val payload = mutableMapOf<String, Any>("repoRoot" to repoRoot)
        if (!remote.isNullOrBlank()) payload["remote"] = remote
        send("project-git:pull", payload)
    }
    fun pushCodeChangeBranch(repoRoot: String) {
        send("project-git:push-branch", mapOf("repoRoot" to repoRoot))
    }
    fun commitCodeChangeFiles(repoRoot: String, message: String) {
        send("project-git:commit", mapOf("repoRoot" to repoRoot, "message" to message))
    }
    fun discardCodeChangeFile(repoRoot: String, relativePath: String) {
        send("project-git:discard-file", mapOf("repoRoot" to repoRoot, "relativePath" to relativePath))
    }
    fun stashCodeChanges(repoRoot: String, message: String? = null) {
        val payload = mutableMapOf<String, Any>("repoRoot" to repoRoot)
        if (!message.isNullOrBlank()) payload["message"] = message
        send("project-git:stash", payload)
    }
    fun stashPopCodeChanges(repoRoot: String) {
        send("project-git:stash-pop", mapOf("repoRoot" to repoRoot))
    }
    fun getCodeChangeStashCount(repoRoot: String) {
        send("project-git:stash-count", mapOf("repoRoot" to repoRoot))
    }
    fun deleteCodeChangeBranch(repoRoot: String, branchName: String, deleteRemote: Boolean = false, force: Boolean = false) {
        send(
            "project-git:delete-branch",
            mapOf("repoRoot" to repoRoot, "branchName" to branchName, "deleteRemote" to deleteRemote, "force" to force),
        )
    }
    fun getCodeChangeFileDiff(repoRoot: String, relativePath: String, seq: Int = 0) {
        send("project-git:file-diff", mapOf("repoRoot" to repoRoot, "relativePath" to relativePath, "seq" to seq))
    }
    fun stageCodeChangeFiles(repoRoot: String, relativePaths: List<String>) {
        send("project-git:stage-files", mapOf("repoRoot" to repoRoot, "relativePaths" to relativePaths))
    }
    fun unstageCodeChangeFiles(repoRoot: String, relativePaths: List<String>) {
        send("project-git:unstage-files", mapOf("repoRoot" to repoRoot, "relativePaths" to relativePaths))
    }

    fun createProject(name: String, color: String) { send("project:create", mapOf("name" to name, "color" to color)) }
    fun renameProject(id: String, name: String) { send("project:rename", mapOf("id" to id, "name" to name)) }
    fun updateProjectColor(id: String, name: String, color: String) {
        send("project:rename", mapOf("id" to id, "name" to name, "color" to color))
    }
    fun deleteProject(id: String, deleteChats: Boolean = false) {
        send("project:delete", mapOf("id" to id, "deleteChats" to deleteChats))
    }
    fun createAgent(name: String, icon: String) { send("agent:create", mapOf("name" to name, "icon" to icon)) }
    fun updateAgent(id: String, name: String, icon: String) {
        send("agent:update", mapOf("id" to id, "name" to name, "icon" to icon))
    }
    fun deleteAgent(id: String) { send("agent:delete", mapOf("id" to id)) }
    fun requestAgentFull(id: String) { send("agent:get-full", mapOf("id" to id)) }
    fun getProviders() { send("provider:get-configured", emptyMap()) }
    fun setProviderKey(provider: String, key: String) {
        send("provider:set-key", mapOf("provider" to provider, "key" to key))
    }
    fun removeProviderKey(provider: String) { send("provider:remove-key", mapOf("provider" to provider)) }
    fun getCliStatus() { send("app:cli-status", emptyMap()) }
    fun getSetting(key: String) { send("app:get-setting", mapOf("key" to key)) }
    fun setSetting(key: String, value: String) { send("app:set-setting", mapOf("key" to key, "value" to value)) }
    fun getMcpServers() { send("mcp:list", emptyMap()) }
    fun getMcpCatalog() { send("mcp:catalog", emptyMap()) }
    fun searchMcpRegistry(query: String) { send("mcp:search-registry", mapOf("query" to query)) }

    private fun skillPayload(
        name: String,
        icon: String,
        description: String,
        instructions: String,
        tags: List<String>,
        tools: Map<String, Any>,
        mcpServers: List<String>,
        mcpServerTrust: List<Map<String, String>>,
        mcpToolOverrides: List<Map<String, Any>>,
        knowledge: List<Map<String, String>>,
        packageFiles: List<SkillPackageFile> = emptyList(),
    ): Map<String, Any> = mapOf(
        "name" to name,
        "icon" to icon,
        "description" to description,
        "instructions" to instructions,
        "tags" to tags,
        "tools" to tools,
        "mcpServers" to mcpServers,
        "mcpServerTrust" to mcpServerTrust,
        "mcpToolOverrides" to mcpToolOverrides,
        "knowledge" to knowledge,
        "packageFiles" to packageFiles.map { file ->
            mapOf(
                "relativePath" to file.relativePath,
                "encoding" to file.encoding,
                "content" to file.content,
                "sizeBytes" to file.sizeBytes,
            )
        },
    )

    fun listSkills() { send("skill:list", emptyMap()) }
    fun discoverSkills(projectId: String? = null) {
        send("skill:discover", if (projectId.isNullOrBlank()) emptyMap() else mapOf("projectId" to projectId))
    }
    fun getSkill(id: String) { send("skill:get", mapOf("id" to id)) }
    fun createSkill(
        name: String,
        icon: String,
        description: String,
        instructions: String,
        tags: List<String>,
        tools: Map<String, Any>,
        mcpServers: List<String>,
        mcpServerTrust: List<Map<String, String>>,
        mcpToolOverrides: List<Map<String, Any>>,
        knowledge: List<Map<String, String>>,
    ) {
        send("skill:create", skillPayload(name, icon, description, instructions, tags, tools, mcpServers, mcpServerTrust, mcpToolOverrides, knowledge))
    }
    fun updateSkill(
        id: String,
        name: String,
        icon: String,
        description: String,
        instructions: String,
        tags: List<String>,
        tools: Map<String, Any>,
        mcpServers: List<String>,
        mcpServerTrust: List<Map<String, String>>,
        mcpToolOverrides: List<Map<String, Any>>,
        knowledge: List<Map<String, String>>,
        packageFiles: List<SkillPackageFile>,
    ) {
        val data = skillPayload(name, icon, description, instructions, tags, tools, mcpServers, mcpServerTrust, mcpToolOverrides, knowledge, packageFiles).toMutableMap()
        data["id"] = id
        send("skill:update", data)
    }
    fun deleteSkill(id: String) { send("skill:delete", mapOf("id" to id)) }
    fun duplicateSkill(id: String) { send("skill:duplicate", mapOf("id" to id)) }
    fun exportSkill(id: String) { send("skill:export", mapOf("id" to id)) }
    fun importSkill(skill: Map<String, Any>) { send("skill:import", mapOf("skill" to skill)) }
    fun importDiscoveredSkill(skill: DiscoveredSkill, projectId: String? = null) {
        val discovery = mapOf(
            "packagePath" to skill.packagePath,
            "name" to skill.name,
            "description" to skill.description,
            "icon" to skill.icon,
            "scope" to skill.scope,
            "source" to skill.source,
            "rootLabel" to skill.rootLabel,
            "validationStatus" to skill.validationStatus,
            "validationErrors" to skill.validationErrors,
            "validationWarnings" to skill.validationWarnings,
            "importable" to skill.importable,
            "contentHash" to (skill.contentHash ?: ""),
            "alreadyImported" to skill.alreadyImported,
        )
        val data = mutableMapOf<String, Any>("discovery" to discovery)
        if (!projectId.isNullOrBlank()) data["projectId"] = projectId
        send("skill:import-discovered", data)
    }
    fun getSkillAgentLinks(agentId: String) { send("skill:get-agent-links", mapOf("agentId" to agentId)) }
    fun attachSkillToAgent(agentId: String, skillId: String, attach: Boolean) {
        send("skill:attach-to-agent", mapOf("agentId" to agentId, "skillId" to skillId, "attach" to attach))
    }
    fun reorderSkillsForAgent(agentId: String, skillIds: List<String>) {
        send("skill:reorder-for-agent", mapOf("agentId" to agentId, "skillIds" to skillIds))
    }
    fun getSkillAgentUsage() { send("skill:get-agent-usage", emptyMap()) }
    fun listArtifacts(projectId: String? = null) {
        send("artifact:list", if (projectId != null) mapOf("projectId" to projectId) else emptyMap())
    }
    fun getArtifact(id: String) { send("artifact:get", mapOf("id" to id)) }
    fun listArtifactVersions(artifactId: String) { send("artifact:list-versions", mapOf("artifactId" to artifactId)) }
    fun deleteArtifact(id: String) { send("artifact:delete", mapOf("id" to id)) }
    fun deleteArtifactVersion(versionId: String) { send("artifact:delete-version", mapOf("versionId" to versionId)) }
    fun promoteArtifactMessage(
        conversationId: String,
        messageId: String,
        title: String,
        kind: String,
        scopeType: String,
        scopeProjectId: String?,
        filePath: String,
    ) {
        val scope = mutableMapOf<String, Any>("type" to scopeType)
        if (!scopeProjectId.isNullOrBlank()) scope["projectId"] = scopeProjectId
        send(
            "artifact:promote-message",
            mapOf(
                "conversationId" to conversationId,
                "messageId" to messageId,
                "title" to title,
                "kind" to kind,
                "scope" to scope,
                "filePath" to filePath,
            )
        )
    }
    fun exportArtifact(versionId: String) { send("artifact:export", mapOf("versionId" to versionId)) }

    fun listDirectory(path: String) { send("fs:list-directory", mapOf("path" to path)) }
    fun readFile(path: String, requestId: String) { send("fs:read-file", mapOf("path" to path, "requestId" to requestId)) }
    fun readImageFile(path: String, requestId: String) { send("fs:read-image", mapOf("path" to path, "requestId" to requestId)) }
    fun getFsStartRoots() { send("fs:get-start-roots", emptyMap()) }
    fun getProjectPeekSources(projectId: String) { send("project-peek:get-sources", mapOf("projectId" to projectId)) }
    fun listProjectPeekDirectory(projectId: String, sourceId: String, relativePath: String, filter: String) {
        send("project-peek:list-directory", mapOf(
            "projectId" to projectId, "sourceId" to sourceId, "relativePath" to relativePath, "filter" to filter,
        ))
    }
    fun readProjectPeekFile(projectId: String, sourceId: String, relativePath: String, requestId: String) {
        send("project-peek:read-file", mapOf(
            "projectId" to projectId, "sourceId" to sourceId, "relativePath" to relativePath, "requestId" to requestId,
        ))
    }
    fun readProjectPeekAsset(projectId: String, sourceId: String, relativePath: String, requestId: String) {
        send("project-peek:read-asset", mapOf(
            "projectId" to projectId, "sourceId" to sourceId, "relativePath" to relativePath, "requestId" to requestId,
        ))
    }

    fun getProjectConfig(id: String) { send("project:get-config", mapOf("id" to id)) }
    fun updateProjectConfig(id: String, config: ProjectSettingsConfig) {
        send("project:update-config", buildProjectConfigPayload(id, config))
    }
    fun getProjectCapabilities(projectId: String) {
        send("project:get-capabilities", mapOf("projectId" to projectId))
    }
    fun setProjectCapabilities(projectId: String, profile: io.nexy.android.data.model.CapabilityProfile) {
        send(
            "project:set-capabilities",
            mapOf(
                "projectId" to projectId,
                "profile" to mapOf(
                    "version" to 1,
                    "skillIds" to profile.skillIds,
                    "mcp" to profile.mcp.map { grant ->
                        mapOf("serverId" to grant.serverId, "trust" to grant.trust)
                    },
                    "builtInTools" to profile.builtInTools.mapValues { (_, policy) ->
                        mapOf("enabled" to policy.enabled, "approval" to policy.approval)
                    },
                ),
            ),
        )
    }
    fun addProjectSource(id: String, localPath: String) {
        send("project:add-source", mapOf("id" to id, "localPath" to localPath))
    }
    fun rescanProjectSources(id: String) { send("project:rescan-sources", mapOf("id" to id)) }
    fun removeProjectRepository(id: String, repositoryId: String) {
        send("project:remove-repository", mapOf("id" to id, "repositoryId" to repositoryId))
    }

    fun listProjectAgents(projectId: String) { send("project:list-agents", mapOf("id" to projectId)) }
    fun addProjectAgent(projectId: String, agentId: String) { send("project:add-agent", mapOf("id" to projectId, "agentId" to agentId)) }
    fun removeProjectAgent(projectId: String, agentId: String) { send("project:remove-agent", mapOf("id" to projectId, "agentId" to agentId)) }
    fun setPrimaryProjectAgent(projectId: String, agentId: String) { send("project:set-primary-agent", mapOf("id" to projectId, "agentId" to agentId)) }
    fun reorderProjectAgents(projectId: String, agentIds: List<String>) {
        send("project:reorder-agents", mapOf("id" to projectId, "agentIds" to agentIds))
    }
    fun listProjectAuditSessions(projectId: String) { send("project-audit:list-sessions", mapOf("projectId" to projectId)) }
    fun listProjectAuditFiles(sessionId: String) { send("project-audit:list-files", mapOf("sessionId" to sessionId)) }
    fun getProjectAuditDiff(sessionId: String, relativePath: String, fileId: String) {
        send("project-audit:get-diff", mapOf("sessionId" to sessionId, "relativePath" to relativePath, "fileId" to fileId))
    }

    fun listWikiEntries(projectId: String) { send("wiki:list", mapOf("projectId" to projectId)) }
    fun createWikiEntry(projectId: String, title: String, body: String, tags: List<String>) {
        send("wiki:create", mapOf("projectId" to projectId, "title" to title, "body" to body, "tags" to tags))
    }
    fun updateWikiEntry(id: String, title: String, body: String, tags: List<String>) {
        send("wiki:update", mapOf("id" to id, "title" to title, "body" to body, "tags" to tags))
    }
    fun deleteWikiEntry(id: String) { send("wiki:delete", mapOf("id" to id)) }

    fun listPrompts(projectId: String? = null) {
        val normalizedProjectId = normalizePromptProjectId(projectId)
        send("prompt:list", if (normalizedProjectId != null) mapOf("projectId" to normalizedProjectId) else emptyMap())
    }
    fun createPrompt(title: String, body: String, description: String, category: String, tags: List<String>, scope: String, projectId: String?) {
        val data = mutableMapOf<String, Any>("title" to title, "body" to body, "description" to description, "category" to category, "tags" to tags, "scope" to scope)
        if (projectId != null) data["projectId"] = projectId
        send("prompt:create", data)
    }
    fun updatePrompt(id: String, title: String, body: String, description: String, category: String, tags: List<String>) {
        send("prompt:update", mapOf("id" to id, "title" to title, "body" to body, "description" to description, "category" to category, "tags" to tags))
    }
    fun listPromptVersions(promptId: String) { send("prompt:list-versions", mapOf("promptId" to promptId)) }
    fun rollbackPrompt(promptId: String, version: Int) {
        send("prompt:rollback", mapOf("promptId" to promptId, "version" to version))
    }
    fun deletePrompt(id: String) { send("prompt:delete", mapOf("id" to id)) }

    fun startProjectGeneratorChat(sessionId: String, messages: List<Map<String, String>>) {
        send("project-generator:start", mapOf("sessionId" to sessionId, "messages" to messages))
    }
    fun sendProjectGeneratorMessage(sessionId: String, messages: List<Map<String, String>>) {
        send("project-generator:message", mapOf("sessionId" to sessionId, "messages" to messages))
    }
    fun confirmProjectSpec(sessionId: String, spec: io.nexy.android.data.model.ProjectGeneratorSpec) {
        val agentsList = spec.agents.map { a ->
            val m = mutableMapOf<String, Any>(
                "role" to a.role,
                "description" to a.description,
                "isLeader" to a.isLeader,
            )
            a.existingAgentId?.let { m["existingAgentId"] = it }
            if (a.existingAgentId == null) {
                val newAgent = a.newAgent
                m["newAgent"] = mapOf(
                    "name" to (newAgent?.name ?: a.role),
                    "icon" to (newAgent?.icon ?: ""),
                    "systemPrompt" to (newAgent?.systemPrompt ?: ""),
                    "temperature" to (newAgent?.temperature ?: 0.7),
                    "responseFormat" to (newAgent?.responseFormat ?: "default"),
                    "tools" to mapOf(
                        "fileEdit" to (newAgent?.tools?.fileEdit ?: false),
                        "terminal" to (newAgent?.tools?.terminal ?: false),
                        "webFetch" to (newAgent?.tools?.webFetch ?: false),
                    ),
                )
            }
            m
        }
        val specPayload = mutableMapOf<String, Any>(
            "name" to spec.name,
            "color" to spec.color,
            "instructions" to spec.instructions,
            "variables" to spec.variables,
            "inScope" to spec.inScope,
            "outOfScope" to spec.outOfScope,
            "milestones" to spec.milestones,
            "orchestrationEnabled" to spec.orchestrationEnabled,
            "agents" to agentsList,
        )
        spec.rootDirectory?.let { specPayload["rootDirectory"] = it }
        spec.instructionMode?.let { specPayload["instructionMode"] = it }
        spec.defaultModel?.let { specPayload["defaultModel"] = it }
        send("project-generator:confirm", mapOf(
            "sessionId" to sessionId,
            "spec" to specPayload,
        ))
    }
    fun cancelProjectGenerator(sessionId: String) { send("project-generator:cancel", mapOf("sessionId" to sessionId)) }

    fun startSkillGeneratorChat(sessionId: String, messages: List<Map<String, String>>) {
        send("skill-generator:start", mapOf("sessionId" to sessionId, "messages" to messages))
    }
    fun sendSkillGeneratorMessage(sessionId: String, messages: List<Map<String, String>>) {
        send("skill-generator:message", mapOf("sessionId" to sessionId, "messages" to messages))
    }
    fun confirmSkillSpec(sessionId: String, spec: io.nexy.android.data.model.SkillGeneratorSpec) {
        val specPayload = mutableMapOf<String, Any>(
            "name" to spec.name,
            "icon" to spec.icon,
            "description" to spec.description,
            "instructions" to spec.instructions,
            "tools" to mapOf("fileEdit" to spec.tools.fileEdit, "terminal" to spec.tools.terminal, "webFetch" to spec.tools.webFetch),
            "toolInstructions" to spec.toolInstructions,
            "approval" to spec.approval,
            "mcpServers" to spec.mcpServers,
            "tags" to spec.tags,
            "knowledge" to spec.knowledge.map { mapOf("title" to it.title, "content" to it.content) },
            "suggestedAgents" to spec.suggestedAgents,
        )
        send("skill-generator:confirm", mapOf("sessionId" to sessionId, "spec" to specPayload))
    }
    fun cancelSkillGenerator(sessionId: String) { send("skill-generator:cancel", mapOf("sessionId" to sessionId)) }

    fun startArtifactGeneratorChat(sessionId: String, messages: List<Map<String, String>>) {
        send("artifact-generator:start", mapOf("sessionId" to sessionId, "messages" to messages))
    }
    fun sendArtifactGeneratorMessage(sessionId: String, messages: List<Map<String, String>>) {
        send("artifact-generator:message", mapOf("sessionId" to sessionId, "messages" to messages))
    }
    fun generateArtifact(sessionId: String, spec: ArtifactGeneratorSpec) {
        send("artifact-generator:generate", mapOf("sessionId" to sessionId, "spec" to spec.toPayload()))
    }
    fun cancelArtifactGenerator(sessionId: String) { send("artifact-generator:cancel", mapOf("sessionId" to sessionId)) }

    fun getAzureEndpoint() { send("provider:get-azure-endpoint", emptyMap()) }
    fun setAzureEndpoint(endpoint: String) { send("provider:set-azure-endpoint", mapOf("endpoint" to endpoint)) }
    fun testProviderKey(provider: String, key: String, endpoint: String? = null) {
        val data = mutableMapOf<String, Any>("provider" to provider, "key" to key)
        if (endpoint != null) data["endpoint"] = endpoint
        send("provider:test-key", data)
    }

    fun exportConversationPack(conversationId: String, format: String = "json") {
        send("conversation:export-pack", mapOf("conversationId" to conversationId, "format" to format))
    }
    fun forkConversation(conversationId: String, cutoffTimestamp: Long? = null, projectId: String? = null, includeProject: Boolean = false) {
        val data = mutableMapOf<String, Any>("conversationId" to conversationId)
        if (cutoffTimestamp != null) data["cutoffTimestamp"] = cutoffTimestamp
        if (includeProject) data["projectId"] = projectId.orEmpty()
        send("conversation:fork", data)
    }
    fun importConversationJson(json: String) { send("conversation:import-json", mapOf("json" to json)) }

    fun listKnowledgeFiles(agentId: String) { send("agent:list-knowledge-files", mapOf("agentId" to agentId)) }
    fun addKnowledgeFile(agentId: String, filePath: String, injectMode: String = "always") {
        send("agent:add-knowledge-file", mapOf("agentId" to agentId, "filePath" to filePath, "injectMode" to injectMode))
    }
    fun removeKnowledgeFile(agentId: String, id: String) {
        send("agent:remove-knowledge-file", mapOf("agentId" to agentId, "id" to id))
    }
    fun readKnowledgeFile(agentId: String, filePath: String) {
        send("agent:read-knowledge-file", mapOf("agentId" to agentId, "filePath" to filePath))
    }
    fun writeKnowledgeFile(agentId: String, filePath: String, content: String) {
        send("agent:write-knowledge-file", mapOf("agentId" to agentId, "filePath" to filePath, "content" to content))
    }
    fun getMcpToolOverrides(agentId: String) { send("agent:get-mcp-tool-overrides", mapOf("agentId" to agentId)) }
    fun setMcpToolOverride(agentId: String, serverId: String, toolName: String, enabled: Boolean, approval: String, instructions: String) {
        send("agent:set-mcp-tool-override", mapOf(
            "agentId" to agentId,
            "serverId" to serverId,
            "toolName" to toolName,
            "enabled" to enabled,
            "approval" to approval,
            "instructions" to instructions,
        ))
    }
    fun getMcpServerTrust(agentId: String) { send("agent:get-mcp-server-trust", mapOf("agentId" to agentId)) }
    fun setMcpServerTrust(agentId: String, serverId: String, trust: String) {
        send("agent:set-mcp-server-trust", mapOf("agentId" to agentId, "serverId" to serverId, "trust" to trust))
    }

    fun addMcpServer(name: String, command: String, description: String = "", args: List<String> = emptyList(), env: Map<String, String> = emptyMap(), cwd: String? = null, imageResponses: String? = null, enabled: Boolean = true) {
        // MCP environment values are desktop-owned secrets and never cross the
        // companion connection, even when a caller supplies this legacy parameter.
        val payload = mutableMapOf<String, Any>("name" to name, "description" to description, "command" to command, "args" to args, "enabled" to enabled)
        if (cwd != null) payload["cwd"] = cwd
        if (imageResponses != null) payload["imageResponses"] = imageResponses
        send("mcp:add", payload)
    }
    fun updateMcpServer(id: String, name: String? = null, description: String? = null, command: String? = null, args: List<String>? = null, env: Map<String, String>? = null, cwd: String? = null, enabled: Boolean? = null) {
        val payload = mutableMapOf<String, Any>("id" to id)
        if (name != null) payload["name"] = name
        if (description != null) payload["description"] = description
        if (command != null) payload["command"] = command
        if (args != null) payload["args"] = args
        // Do not send env updates from Android; the desktop remains authoritative.
        if (cwd != null) payload["cwd"] = cwd
        if (enabled != null) payload["enabled"] = enabled
        send("mcp:update", payload)
    }
    fun testMcpServer(command: String, args: List<String>, env: Map<String, String> = emptyMap(), imageResponses: String? = null) {
        val payload = mutableMapOf<String, Any>("command" to command, "args" to args)
        if (imageResponses != null) payload["imageResponses"] = imageResponses
        send("mcp:test", payload)
    }
    fun removeMcpServer(id: String) { send("mcp:remove", mapOf("id" to id)) }
    fun restartMcpServer(id: String) { send("mcp:restart", mapOf("id" to id)) }
    fun getMcpServerStatus(id: String) { send("mcp:get-status", mapOf("id" to id)) }
    fun listMcpTools(serverIds: List<String>? = null) {
        val payload: Map<String, Any> = if (serverIds != null) mapOf("serverIds" to serverIds) else emptyMap()
        send("mcp:list-tools", payload)
    }
    fun listMcpToolsForAgent(agentId: String) { send("mcp:list-tools-for-agent", mapOf("agentId" to agentId)) }
    fun extractWikiFromConversation(conversationId: String, projectId: String) {
        send("wiki:extract-from-conversation", mapOf("conversationId" to conversationId, "projectId" to projectId))
    }

    val buildRecords = MutableStateFlow<List<io.nexy.android.data.model.BuildRecord>>(emptyList())

    fun getBuildRecords(platform: String? = null, limit: Int = 20) {
        val payload = mutableMapOf<String, Any>("limit" to limit)
        if (platform != null) payload["platform"] = platform
        send("build:get-records", payload)
    }
    fun getBuildWorkspaceInfo() { send("build:get-workspace-info", emptyMap()) }
    fun runBuildPreflight() { send("build:run-preflight", emptyMap()) }
    fun startDesktopBuild(command: String) { send("build:start-from-mobile", mapOf("command" to command)) }
    fun cancelDesktopBuild(buildId: String) { send("build:cancel-from-mobile", mapOf("buildId" to buildId)) }
    fun startUpdateFromArtifact() { send("build:update-from-artifact", emptyMap()) }
    fun getAndroidWorkspaceInfo() { send("android:get-workspace-info", emptyMap()) }
    fun setAndroidWorkspacePath(path: String) { send("android:set-workspace-path", mapOf("path" to path)) }
    fun startAndroidBuild(command: String) { send("android:start-build", mapOf("command" to command)) }
    fun cancelAndroidBuild(buildId: String) { send("android:cancel-build", mapOf("buildId" to buildId)) }
    fun validateAndroidSigning() { send("android:validate-signing", emptyMap()) }
    fun publishAndroidUpdate() { send("android:publish-update", emptyMap()) }
    fun restoreAndroidVersion(versionCode: Int) { send("android:restore-version", mapOf("versionCode" to versionCode)) }

    fun cancelApprovalNotification() {
        app?.let(ApprovalNotificationManager::cancel)
    }

    // ─── Scheduler ─────────────────────────────────────────────────────────────

    fun schedulerList() { send("scheduler:list", emptyMap()) }
    fun schedulerGet(taskId: String) { send("scheduler:get", mapOf("id" to taskId)) }
    fun schedulerCreate(input: Map<String, Any?>) { send("scheduler:create", input.filterValues { it != null }.mapValues { it.value!! }) }
    fun schedulerUpdate(taskId: String, input: Map<String, Any?>) { send("scheduler:update", mapOf("id" to taskId, "input" to input.filterValues { it != null }.mapValues { it.value!! })) }
    fun schedulerDelete(taskId: String) { send("scheduler:delete", mapOf("id" to taskId)) }
    fun schedulerSetEnabled(taskId: String, enabled: Boolean) { send("scheduler:set-enabled", mapOf("id" to taskId, "enabled" to enabled)) }
    fun schedulerRunNow(taskId: String) { send("scheduler:run-now", mapOf("id" to taskId)) }
    fun schedulerResumeRun(runId: String) { send("scheduler:resume-run", mapOf("runId" to runId)) }
    fun schedulerListRuns(taskId: String, limit: Int = 50) { send("scheduler:list-runs", mapOf("taskId" to taskId, "limit" to limit)) }
    /** Candidate saved Automated Workflow runs for the "attach an existing workflow" picker. */
    fun schedulerListWorkflowTemplates() { send("scheduler:list-workflow-templates", emptyMap()) }
    fun schedulerGeneratorStart(sessionId: String, messages: List<Map<String, String>>, modelId: String? = null) {
        val data = mutableMapOf<String, Any>("sessionId" to sessionId, "messages" to messages)
        if (modelId != null) data["model"] = modelId
        send("scheduler-generator:start", data)
    }
    fun schedulerGeneratorMessage(sessionId: String, messages: List<Map<String, String>>, modelId: String? = null) {
        val data = mutableMapOf<String, Any>("sessionId" to sessionId, "messages" to messages)
        if (modelId != null) data["model"] = modelId
        send("scheduler-generator:message", data)
    }
    fun schedulerGeneratorConfirm(sessionId: String, spec: ScheduleGeneratorSpec) {
        send("scheduler-generator:confirm", mapOf("sessionId" to sessionId, "spec" to spec.toPayload()))
    }
    fun schedulerGeneratorCancel(sessionId: String) { send("scheduler-generator:cancel", mapOf("sessionId" to sessionId)) }
    fun schedulerGeneratorGetModel(sessionId: String) { send("scheduler-generator:get-model", mapOf("sessionId" to sessionId)) }
    fun schedulerGeneratorSetModel(sessionId: String, modelId: String) {
        send("scheduler-generator:set-model", mapOf("sessionId" to sessionId, "modelId" to modelId))
    }

    // ─── Debrief ────────────────────────────────────────────────────────────────

    fun generateDebrief(conversationId: String, projectId: String? = null, model: String? = null) {
        send("conversation:generate-debrief", buildMap {
            put("conversationId", conversationId)
            if (projectId != null) put("projectId", projectId)
            if (model != null) put("model", model)
        })
    }
    fun getDebrief(conversationId: String) { send("conversation:get-debrief", mapOf("conversationId" to conversationId)) }

    // "Story mode" — narrative retelling of an existing debrief. Mirrors desktop's
    // conversation:generate-debrief-story IPC channel, exposed here over the same debrief:*
    // WS reply-event naming convention (debrief:story-ready / debrief:story-error).
    fun generateDebriefStory(
        conversationId: String,
        projectId: String? = null,
        model: String? = null,
        forceRegenerate: Boolean = false,
        tone: String? = null,
        beatCount: Int? = null,
    ) {
        send("debrief:generate-story", buildMap {
            put("conversationId", conversationId)
            if (projectId != null) put("projectId", projectId)
            if (model != null) put("model", model)
            put("forceRegenerate", forceRegenerate)
            if (tone != null) put("tone", tone)
            if (beatCount != null) put("beatCount", beatCount)
        })
    }
    fun markConversationComplete(conversationId: String) { send("conversation:mark-complete", mapOf("conversationId" to conversationId)) }
    fun markConversationIncomplete(conversationId: String) { send("conversation:mark-incomplete", mapOf("conversationId" to conversationId)) }

    // ─── Ratings ────────────────────────────────────────────────────────────────

    fun setConversationRating(conversationId: String, rating: Int, note: String? = null) {
        send("conversation:set-rating", buildMap {
            put("conversationId", conversationId)
            put("rating", rating)
            if (note != null) put("note", note)
        })
    }
    fun getConversationRating(conversationId: String) { send("conversation:get-rating", mapOf("conversationId" to conversationId)) }
    fun deleteConversationRating(conversationId: String) { send("conversation:delete-rating", mapOf("conversationId" to conversationId)) }
    fun listConversationRatings() { send("conversation:list-ratings", emptyMap()) }
    fun getConversationRatingStats() { send("conversation:rating-stats", emptyMap()) }

    // ─── Quiz ────────────────────────────────────────────────────────────────────
    // Quiz now persists its questions as a versioned artifact (desktop Phase 2) instead of a
    // score-only attempt row — conversation:save-quiz-attempt/list-quiz-attempts no longer exist
    // on desktop, so those wrappers were removed rather than left calling into nothing.

    fun generateQuiz(
        conversationId: String,
        projectId: String? = null,
        model: String? = null,
        source: String? = null,
        topic: String? = null,
        difficulty: String? = null,
        questionCount: Int? = null,
    ) {
        send("conversation:generate-quiz", buildMap {
            put("conversationId", conversationId)
            if (projectId != null) put("projectId", projectId)
            if (model != null) put("model", model)
            if (source != null || topic != null || difficulty != null || questionCount != null) {
                put("spec", buildMap {
                    if (source != null) put("source", source)
                    if (topic != null) put("topic", topic)
                    if (difficulty != null) put("difficulty", difficulty)
                    if (questionCount != null) put("questionCount", questionCount)
                })
            }
        })
    }
    fun getQuiz(conversationId: String) { send("conversation:get-quiz", mapOf("conversationId" to conversationId)) }

    // Loads quiz content by artifact id directly rather than re-deriving "the quiz for this
    // conversation" — the tapped chat card already knows its exact artifactId, and looking it
    // up that way sidesteps conversation_id/artifact_chat_refs linkage that can be missing for
    // older rows, which otherwise makes opening an existing quiz look like "no quiz found" and
    // silently trigger an unwanted regeneration.
    fun getQuizByArtifact(conversationId: String, artifactId: String) {
        send("quiz:get-by-artifact", mapOf("conversationId" to conversationId, "artifactId" to artifactId))
    }

    // ─── Teach-back practice ───────────────────────────────────────────────────
    fun generateTeachback(conversationId: String, projectId: String? = null, topic: String? = null, model: String? = null) {
        send("conversation:generate-teachback", buildMap {
            put("conversationId", conversationId)
            if (projectId != null) put("projectId", projectId)
            if (!topic.isNullOrBlank()) put("topic", topic)
            if (model != null) put("model", model)
        })
    }
    fun getTeachback(conversationId: String) = send("conversation:get-teachback", mapOf("conversationId" to conversationId))
    fun getTeachbackByArtifact(conversationId: String, artifactId: String) = send("teachback:get-by-artifact", mapOf("conversationId" to conversationId, "artifactId" to artifactId))
    fun gradeTeachback(artifactId: String, versionId: String, transcript: String, prompt: String, parentAttemptId: String?, turnNumber: Int) {
        send("teachback:grade", buildMap {
            put("artifactId", artifactId); put("versionId", versionId); put("transcript", transcript); put("prompt", prompt); put("turnNumber", turnNumber)
            if (parentAttemptId != null) put("parentAttemptId", parentAttemptId)
        })
    }
    fun getTeachbackAttempts(artifactId: String) = send("teachback:get-attempts", mapOf("artifactId" to artifactId))

    // ─── Activity feed ──────────────────────────────────────────────────────────
    fun getActivityFeed() { send("activity:list", emptyMap()) }
    fun getNewContent() { send("new-content:list", emptyMap()) }
    fun dismissActivity(id: String) {
        BackgroundActivityTracker.unregister(id)
        send("activity:dismiss", mapOf("id" to id))
    }
}

fun ScheduleGeneratorSpec.toPayload(): Map<String, Any> {
    val payload = mutableMapOf<String, Any>(
        "name" to name,
        "prompt" to prompt,
        "scheduleType" to scheduleType,
        "localTime" to localTime,
        "timezone" to timezone,
        "notificationPref" to notificationPref,
    )
    weekday?.let { payload["weekday"] = it }
    monthDay?.let { payload["monthDay"] = it }
    agentId?.let { payload["agentId"] = it }
    projectId?.let { payload["projectId"] = it }
    model?.let { payload["model"] = it }
    if (preApproved.isNotEmpty()) payload["preApproved"] = preApproved
    payload["targetType"] = targetType
    sourceRunId?.let { payload["sourceRunId"] = it }
    return payload
}

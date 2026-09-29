package io.nexy.android.ui.chat

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.Manifest
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.OpenableColumns
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.unit.IntOffset
import androidx.compose.material3.FloatingActionButton
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.rememberModalBottomSheetState
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import io.nexy.android.ui.theme.Blue500
import io.nexy.android.ui.theme.Green500
import io.nexy.android.ui.theme.Gray400
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.EffectiveConnectionMode
import io.nexy.android.data.PreferenceStore
import io.nexy.android.data.WsRepository
import io.nexy.android.data.repository.InternetState
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.isVisibleInProject
import io.nexy.android.data.model.normalizePromptProjectId
import io.nexy.android.data.model.WsEvent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.snapshotFlow
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tables.TableTheme
import io.noties.markwon.ext.tasklist.TaskListPlugin
import io.noties.markwon.linkify.LinkifyPlugin
import io.noties.markwon.syntax.Prism4jTheme
import io.noties.markwon.syntax.SyntaxHighlightPlugin
import io.noties.prism4j.Prism4j
import android.text.SpannableStringBuilder
import org.json.JSONArray
import org.json.JSONObject
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.prompts.CreatePromptSheet
import io.nexy.android.ui.model.agentBackendLockDetail
import io.nexy.android.ui.model.agentBackendLockLabel
import io.nexy.android.ui.model.activeModelDetail
import io.nexy.android.ui.model.activeModelLabel
import io.nexy.android.ui.model.resolveAvailableProjectDefault
import io.nexy.android.ui.model.emptyModelListDetail
import io.nexy.android.ui.model.modelSourceDetail
import io.nexy.android.ui.model.cliBackendForModel
import io.nexy.android.ui.model.filterModelsForBackend
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.runtime.withFrameNanos
import io.nexy.android.ui.voice.PcmRecorderStopReason
import io.nexy.android.ui.voice.PcmRecorderSnapshot
import io.nexy.android.ui.voice.PcmRecorderState
import io.nexy.android.ui.voice.VoiceDock
import io.nexy.android.ui.voice.VoiceDockController
import io.nexy.android.ui.voice.VoiceDockUiState
import io.nexy.android.share.ShareIntentRepository

/**
 * Snapshot key for the auto-follow re-pin effect. Value-equality across all fields is what makes
 * `snapshotFlow` emit only on a real change: [lastBottom] (the last visible item's bottom edge) and
 * [canScrollForward] catch a sibling segment's late height growth displacing the tail below the fold,
 * which [itemCount] + the last item's own size alone did not.
 */
private data class ScrollPinSignal(
    val follow: Boolean,
    val itemCount: Int,
    val lastIndex: Int,
    val lastBottom: Int,
    val canScrollForward: Boolean,
)

private fun decodeUtf8Text(bytes: ByteArray): String? = runCatching {
    Charsets.UTF_8.newDecoder()
        .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
        .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
        .decode(java.nio.ByteBuffer.wrap(bytes))
        .toString()
}.getOrNull()

/** Small "Completed" indicator shown in the chat header's title area when the open
 * conversation is marked complete — the in-chat counterpart to the checkmark already shown
 * for completed conversations in list screens (e.g. ScopedChatHistoryScreen). */
@Composable
fun ChatCompletedBadge() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        NexyIcon(
            NexyIconName.CheckedBox,
            contentDescription = null,
            modifier = Modifier.size(14.dp),
            tint = Green500,
        )
        Text(
            "Completed",
            maxLines = 1,
            style = MaterialTheme.typography.labelSmall,
            color = Green500,
        )
    }
}

/** Passive "N/5" star readout shown in the chat header once a conversation has been rated —
 * mutation happens via ConversationActionsSheet, mirroring how ChatCompletedBadge is a
 * read-only indicator for the /complete slash command's state. */
@Composable
fun ChatRatingBadge(rating: Int) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        Icon(
            Icons.Default.Star,
            contentDescription = null,
            modifier = Modifier.size(12.dp),
            tint = Color(0xFFF59E0B),
        )
        Text(
            "$rating/5",
            maxLines = 1,
            style = MaterialTheme.typography.labelSmall,
            color = Color(0xFFF59E0B),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(
    conversationId: String,
    agentId: String? = null,
    projectId: String? = null,
    onBack: () -> Unit,
    onOpenArtifacts: ((String?) -> Unit)? = null,
    onOpenDebrief: ((String) -> Unit)? = null,
    // (conversationId, artifactId) — artifactId is the specific quiz card tapped, so the
    // quiz screen can load that exact artifact instead of re-deriving "the quiz for this
    // conversation" (see ArtifactRefBubble's onOpenQuiz dispatch for why that matters).
    onOpenQuiz: ((String, String) -> Unit)? = null,
    onOpenTeachback: ((String, String) -> Unit)? = null,
    onOpenFork: ((String) -> Unit)? = null,
    onOpenCodePanel: ((String) -> Unit)? = null,
    onOpenProjectPeek: ((String) -> Unit)? = null,
    onOpenAutomatedWorkflow: ((String) -> Unit)? = null,
    onOpenDesktopPathPicker: (() -> Unit)? = null,
    onOpenMcpServers: (() -> Unit)? = null,
    initialMessageId: String? = null,
    sharedBatchId: String? = null,
    onNewChat: ((String?, String?) -> Unit)? = null,
    vm: ChatViewModel = viewModel(
        factory = remember(conversationId, agentId, projectId) {
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>) =
                    ChatViewModel(conversationId, agentId = agentId, projectId = projectId) as T
            }
        },
    ),
) {
    val messages by vm.messages.collectAsStateWithLifecycle()
    LaunchedEffect(messages.isNotEmpty()) {
        if (messages.isNotEmpty()) {
            withFrameNanos { }
            vm.reportFirstMessageFrameRendered(messages.size)
            withFrameNanos { }
            vm.reportVisibleRichContentSettled(messages.size)
        }
    }
    val isStreaming by vm.isStreaming.collectAsStateWithLifecycle()
    val isAwaitingResponse by vm.isAwaitingResponse.collectAsStateWithLifecycle()
    val isRefreshing by vm.isRefreshing.collectAsStateWithLifecycle()
    val isLoadingOlder by vm.isLoadingOlder.collectAsStateWithLifecycle()
    val isInitialHistoryLoading by vm.isInitialHistoryLoading.collectAsStateWithLifecycle()
    val isReconcilingHistory by vm.isReconcilingHistory.collectAsStateWithLifecycle()
    val activityLabel by vm.activityLabel.collectAsStateWithLifecycle()
    val liveActivity by vm.liveActivity.collectAsStateWithLifecycle()
    val liveThinkingBlocks by vm.liveThinkingBlocks.collectAsStateWithLifecycle()
    val liveTurnState by vm.liveTurnState.collectAsStateWithLifecycle()
    val generationStartedAt by vm.generationStartedAt.collectAsStateWithLifecycle()
    val selectedModel by vm.selectedModel.collectAsStateWithLifecycle()
    val selectedHermesProfile by vm.selectedHermesProfile.collectAsStateWithLifecycle()
    val userSelectedHermesProfile by vm.userSelectedHermesProfile.collectAsStateWithLifecycle()
    val attachments by vm.attachments.collectAsStateWithLifecycle()
    val conversations by WsRepository.conversations.collectAsStateWithLifecycle()
    val agents by WsRepository.agents.collectAsStateWithLifecycle()
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val projectPrimaryAgents by WsRepository.projectPrimaryAgents.collectAsStateWithLifecycle()
    val models by WsRepository.models.collectAsStateWithLifecycle()
    val modelSource by WsRepository.modelSource.collectAsStateWithLifecycle()
    val cliStatus by WsRepository.cliStatus.collectAsStateWithLifecycle()
    val hermesInfo by WsRepository.hermesInfo.collectAsStateWithLifecycle()
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val capabilities by WsRepository.capabilities.collectAsStateWithLifecycle()
    val availableSkills by WsRepository.skills.collectAsStateWithLifecycle()
    val mcpServers by WsRepository.mcpServers.collectAsStateWithLifecycle()
    val voiceCapabilities by WsRepository.voiceCapabilities.collectAsStateWithLifecycle()
    val lastError by WsRepository.lastError.collectAsStateWithLifecycle()
    val effectiveMode by WsRepository.effectiveMode.collectAsStateWithLifecycle()
    val emergencyStopActive by WsRepository.emergencyStopActive.collectAsStateWithLifecycle()
    val conversation = conversations.find { it.id == conversationId }
    val isCompleted = conversation?.completed_at != null
    val conversationRating = conversation?.rating
    val title = conversation?.title?.ifBlank { null } ?: "Chat"
    val chatThinkingEffortOverride by vm.thinkingEffortOverride.collectAsStateWithLifecycle()
    val chatFullAutoApproveOverride by vm.fullAutoApproveOverride.collectAsStateWithLifecycle()
    val chatAgenticModeOverride by vm.agenticModeOverride.collectAsStateWithLifecycle()
    val chatTerminalSandboxOverride by vm.terminalSandboxOverride.collectAsStateWithLifecycle()
    val chatCliModeOverride by vm.cliModeOverride.collectAsStateWithLifecycle()
    val chatCodexExecutionModeOverride by vm.codexExecutionModeOverride.collectAsStateWithLifecycle()
    // A project draft chat opens with no bound agent (nav-arg agentId is null); fall back to the
    // project's inherited primary so the header shows the agent — and its backend — before the
    // first send. The server binds the same agent on send (chat-handlers.ts).
    val chatAgentId = conversation?.agent_id ?: agentId
        ?: (conversation?.project_id ?: projectId)?.let { projectPrimaryAgents[it] }
    val chatAgent = chatAgentId?.let { id -> agents.find { it.id == id } }
    val fullAgentConfig by WsRepository.agentFullConfig.collectAsStateWithLifecycle()
    val forcedAgentBackend = chatAgent?.backend?.takeIf {
        it == "claude-cli" || it == "codex-cli" || it == "hermes-cli"
    }
    val chatModels = filterModelsForBackend(models, forcedAgentBackend)
    val activeCliBackend = (forcedAgentBackend ?: modelSource?.backend)
        ?.takeIf { it == "claude-cli" || it == "codex-cli" || it == "hermes-cli" }
        ?: cliBackendForModel(models.find { it.id == selectedModel })
    val chatBackend = chatAgent?.backend
    val statusProjectId = conversation?.project_id ?: projectId
    val chatProject = statusProjectId?.let { id -> projects.find { it.id == id } }
    var globalHermesProfile by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        WsRepository.getSetting("global_default_hermes_profile")
        WsRepository.events.collect { event ->
            if (event is WsEvent.SettingValue && event.key == "global_default_hermes_profile") {
                globalHermesProfile = event.value?.takeIf { it.isNotBlank() }
            }
        }
    }
    val inheritedHermesProfile = when {
        forcedAgentBackend == "hermes-cli" && fullAgentConfig?.id == chatAgentId -> fullAgentConfig?.hermesProfile
        !conversation?.model.isNullOrBlank() -> conversation?.conversationHermesProfile
        !chatProject?.defaultModel.isNullOrBlank() -> chatProject?.projectHermesProfile
        else -> globalHermesProfile
    }
    LaunchedEffect(inheritedHermesProfile) {
        vm.loadHermesProfile(inheritedHermesProfile)
    }
    val targetHermesProfile = if (userSelectedHermesProfile) selectedHermesProfile else inheritedHermesProfile
    val projectDefaultThinkingEffort = chatProject?.defaultThinkingEffort
    val availableProjectDefault = if (forcedAgentBackend == null) {
        resolveAvailableProjectDefault(chatProject?.defaultModel, models)
    } else {
        null
    }
    val projectDefaultApplied = conversation?.model.isNullOrBlank() &&
        availableProjectDefault != null &&
        selectedModel == availableProjectDefault
    var chatAgentFullAutoApprove by remember { mutableStateOf(false) }
    var chatProjectWorkflowMode by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(chatAgentId) {
        if (chatAgentId != null) WsRepository.requestAgentFull(chatAgentId) else chatAgentFullAutoApprove = false
    }
    LaunchedEffect(statusProjectId) {
        if (!statusProjectId.isNullOrBlank()) WsRepository.getProjectConfig(statusProjectId) else chatProjectWorkflowMode = null
    }
    LaunchedEffect(conversationId, selectedModel, conversation?.id) {
        // A new chat is a client-side draft until its first message reaches the desktop. The
        // capability service intentionally requires a persisted conversation row, so querying it
        // here used to show "Conversation not found" every time a fresh chat was opened.
        if (conversation != null) {
            WsRepository.getConversationCapabilities(conversationId)
            WsRepository.resolveCapabilities(conversationId, selectedModel)
        }
    }
    // Warm the project→primary-agent cache so a project draft chat (no bound agent yet) can show
    // its inherited agent before the first send. Only needed while the conversation itself carries
    // no agent_id; once bound, chatAgentId resolves directly from the conversation.
    LaunchedEffect(statusProjectId, conversation?.agent_id, connectionState) {
        if (conversation?.agent_id == null && !statusProjectId.isNullOrBlank() &&
            connectionState == ConnectionState.CONNECTED
        ) {
            WsRepository.listProjectAgents(statusProjectId)
        }
    }

    var activeWorkflowRun by remember { mutableStateOf<io.nexy.android.data.model.AutomatedWorkflowRunInfo?>(null) }
    var dismissedWorkflowStepId by remember { mutableStateOf<String?>(null) }

    // Keyed on connectionState too — not just statusProjectId — so a reconnect re-fetches
    // instead of leaving the banner showing whatever state it had before the phone disconnected
    // (a run can fully progress through several auto-executed steps while disconnected). Mirrors
    // RemoteEditReportDetailScreen.kt's established pattern. Not gated on workflowMode: Automated
    // Workflow is a fully independent, top-level feature, so a run started in any project mode
    // must still surface here, otherwise it executes with silent, invisible progress.
    LaunchedEffect(statusProjectId, connectionState) {
        dismissedWorkflowStepId = null
        if (!statusProjectId.isNullOrBlank() && connectionState == ConnectionState.CONNECTED) {
            WsRepository.listAutomatedWorkflowRuns(statusProjectId)
        } else if (statusProjectId.isNullOrBlank()) {
            activeWorkflowRun = null
        }
    }

    // "Current" means "needs a human's attention" — running (informational only),
    // awaiting_confirmation (needs approval), or failed (needs retry/skip) — rather than "the
    // next one a human would manually start" (steps auto-advance now).
    val currentWorkflowStep = remember(activeWorkflowRun) {
        activeWorkflowRun?.steps?.firstOrNull {
            it.status == "running" || it.status == "awaiting_confirmation" || it.status == "failed"
        }
    }

    val customSlashCommands by vm.customSlashCommands.collectAsStateWithLifecycle()
    val draftFromVm by vm.draft.collectAsStateWithLifecycle()
    var input by remember { mutableStateOf(draftFromVm) }
    var editingMessageId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(draftFromVm) {
        if (input.isBlank() && draftFromVm.isNotBlank()) input = draftFromVm
    }
    val restoredViewState = remember(conversationId) { ChatHistoryMemoryCache.getViewState(conversationId) }
    val listState = rememberLazyListState(
        initialFirstVisibleItemIndex = restoredViewState?.itemIndex ?: 0,
        initialFirstVisibleItemScrollOffset = restoredViewState?.itemOffset ?: 0,
    )
    var shouldAutoFollow by remember(conversationId) { mutableStateOf(restoredViewState?.shouldAutoFollow ?: true) }
    var hasInitiallyScrolled by remember(conversationId) { mutableStateOf(restoredViewState != null) }
    var programmaticScrollInProgress by remember { mutableStateOf(false) }
    var olderPageArmed by remember { mutableStateOf(true) }
    val context = LocalContext.current
    var showModelSheet by remember { mutableStateOf(false) }
    val modelSheetState = rememberModalBottomSheetState()
    var showModeSheet by remember { mutableStateOf(false) }
    val modeSheetState = rememberModalBottomSheetState()
    var showActionsSheet by remember { mutableStateOf(false) }
    var showForkFromHereProjectPicker by remember { mutableStateOf(false) }
    var showEmergencyStopConfirmation by remember { mutableStateOf(false) }
    var showPromptSheet by remember { mutableStateOf(false) }
    val promptSheetState = rememberModalBottomSheetState()
    var showInspectorSheet by remember { mutableStateOf(false) }
    val inspectorSheetState = rememberModalBottomSheetState()
    var showCapabilitiesSheet by remember { mutableStateOf(false) }
    val capabilitiesSheetState = rememberModalBottomSheetState()
    var capabilityProfileJson by remember { mutableStateOf("{}") }
    var capabilityPreflightJson by remember { mutableStateOf("{}") }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(sharedBatchId) {
        val batchId = sharedBatchId ?: return@LaunchedEffect
        val batch = withContext(Dispatchers.IO) { ShareIntentRepository.load(context, batchId) }
        if (batch == null) {
            snackbarHostState.showSnackbar("The shared files are no longer available.")
            return@LaunchedEffect
        }
        batch.text?.let { sharedText ->
            input = if (input.isBlank()) sharedText else "$input\n$sharedText"
            vm.setDraft(input)
        }
        var imported = 0
        for (attachment in batch.attachments) {
            val bytes = withContext(Dispatchers.IO) {
                runCatching { java.io.File(attachment.localPath).readBytes() }.getOrNull()
            } ?: continue
            val dataUrl = "data:${attachment.mimeType};base64," +
                android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            vm.addAttachment(
                name = attachment.name,
                mimeType = attachment.mimeType,
                dataUrl = dataUrl,
                textContent = decodeUtf8Text(bytes),
            )
            imported++
        }
        ShareIntentRepository.discard(context, batchId)
        if (batch.rejectedCount > 0) {
            snackbarHostState.showSnackbar("$imported attached · ${batch.rejectedCount} skipped because of size or access limits.")
        }
    }
    val preferenceStore = remember(context) { PreferenceStore.getInstance(context) }
    val voiceDockEnabled by preferenceStore.getVoiceDockV1().collectAsState(initial = true)
    val markdownViewMode by preferenceStore.getMarkdownViewMode().collectAsState(initial = MarkdownViewMode.Rendered)
    var voiceDockFloating by remember {
        mutableStateOf(voiceDockEnabled && preferenceStore.isVoiceDockFloating())
    }
    val transcriptHandler by rememberUpdatedState(newValue = { text: String ->
        input = if (input.isBlank()) text else "${input.trimEnd()} $text"
        vm.setDraft(input)
    })
    val voiceInput = rememberOnDeviceVoiceInput(
        onText = { transcriptHandler(it) },
        onError = { message -> scope.launch { snackbarHostState.showSnackbar(message) } },
    )
    val voiceDockController = remember(context, scope) {
        VoiceDockController(
            context = context,
            wsClient = WsRepository,
            scope = scope,
            onTranscript = { transcriptHandler(it) },
        )
    }
    val voiceDockState by voiceDockController.state.collectAsStateWithLifecycle()
    val usePairedVoice = connectionState == ConnectionState.CONNECTED &&
        voiceCapabilities.audioUpload &&
        voiceCapabilities.localWhisperReady
    val effectiveVoiceDockState = if (usePairedVoice) {
        voiceDockState
    } else {
        VoiceDockUiState(
            recorder = PcmRecorderSnapshot(
                state = if (voiceInput.listening) PcmRecorderState.RECORDING else PcmRecorderState.IDLE,
            ),
        )
    }
    var startAfterPermission by remember { mutableStateOf(false) }
    val voicePermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted && startAfterPermission) {
            voiceDockController.start()
        } else if (!granted) {
            scope.launch { snackbarHostState.showSnackbar("Microphone permission is required for Voice Dock.") }
        }
        startAfterPermission = false
    }
    val startVoiceDockRecording: () -> Unit = {
        when {
            !usePairedVoice -> voiceInput.start()
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> {
                voiceDockController.start()
            }
            else -> {
                startAfterPermission = true
                voicePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }
        }
    }
    val stopVoiceDockRecording: () -> Unit = {
        if (usePairedVoice) voiceDockController.stop() else voiceInput.stop()
    }
    val cancelVoiceDockRecording: () -> Unit = {
        if (usePairedVoice) voiceDockController.cancel() else voiceInput.cancel()
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(voiceDockController, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                voiceDockController.onAppBackgrounded()
                voiceInput.cancel()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            voiceDockController.close()
        }
    }
    LaunchedEffect(voiceDockEnabled) {
        if (voiceDockEnabled && preferenceStore.isVoiceDockFloating()) {
            voiceDockFloating = true
        } else if (!voiceDockEnabled) {
            voiceDockFloating = false
            preferenceStore.setVoiceDockFloating(false)
            voiceDockController.cancel(PcmRecorderStopReason.USER_CANCELLED)
        }
    }

    val sendError by vm.sendError.collectAsStateWithLifecycle()
    var deletingMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var deleteAfterMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var addToProjectMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var addToProjectTitle by remember { mutableStateOf("") }
    var branchPending by remember { mutableStateOf(false) }
    var forkFromHereTimestamp by remember { mutableStateOf<Long?>(null) }
    var forkFromHereProjectId by remember { mutableStateOf<String?>(null) }
    var promoteArtifactMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var promoteArtifactTitle by remember { mutableStateOf("") }
    var promoteArtifactKind by remember { mutableStateOf("document") }
    var promoteArtifactScopeType by remember { mutableStateOf("global") }
    var promoteArtifactFilePath by remember { mutableStateOf("output.md") }
    var pendingPromotedMessageId by remember { mutableStateOf<String?>(null) }
    var savePromptMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var savePromptTitle by remember { mutableStateOf("") }
    var savePromptBody by remember { mutableStateOf("") }
    var savePromptDescription by remember { mutableStateOf("") }
    var savePromptCategory by remember { mutableStateOf("Custom") }
    var savePromptTags by remember { mutableStateOf("") }
    var savePromptScope by remember { mutableStateOf("global") }
    var savePromptPending by remember { mutableStateOf(false) }
    var pendingApproval by remember { mutableStateOf<io.nexy.android.data.model.WsEvent.ToolApprovalRequest?>(null) }
    // A second CLI turn can broadcast its own approval request while one is already showing (e.g.
    // the user re-sends before approving). Queue rather than overwrite so the earlier request isn't
    // silently orphaned until its 60s server-side auto-deny — mirrors HomeViewModel.approvalQueue.
    val approvalQueue = remember { mutableStateListOf<io.nexy.android.data.model.WsEvent.ToolApprovalRequest>() }
    val enqueueApproval = { event: io.nexy.android.data.model.WsEvent.ToolApprovalRequest ->
        if (pendingApproval == null) pendingApproval = event else approvalQueue.add(event)
    }
    // Drop exactly one request (the visible one advances to the next queued; a queued one is pruned).
    val dismissApproval = { requestId: String ->
        if (pendingApproval?.requestId == requestId) {
            pendingApproval = approvalQueue.removeFirstOrNull()
        } else {
            approvalQueue.removeAll { it.requestId == requestId }
        }
    }
    // The current request resolved by an out-of-band signal (tool ran / turn ended); advance the queue.
    val advanceApproval = { pendingApproval = approvalQueue.removeFirstOrNull() }
    val promptEntries by WsRepository.promptEntries.collectAsStateWithLifecycle()
    val visiblePromptEntries = promptEntries.filter { it.isVisibleInProject(statusProjectId) }
    var relaunchFilePicker by remember { mutableStateOf(false) }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        // A few document providers repeat the same content URI in this result even when the
        // user selected it once. Avoid reading and enqueueing that duplicate in the first place.
        for (uri in uris.distinct()) {
            val cursor = context.contentResolver.query(uri, null, null, null, null) ?: continue
            val name = cursor.use { c ->
                val idx = c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)
                c.moveToFirst()
                c.getString(idx)
            } ?: "attachment"
            val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"
            val inputStream = context.contentResolver.openInputStream(uri)
            if (inputStream == null) {
                scope.launch { snackbarHostState.showSnackbar("$name could not be read.") }
                continue
            }
            val bytes = inputStream.use { it.readBytes() }
            if (bytes.size > 4 * 1024 * 1024) {
                scope.launch {
                    val result = snackbarHostState.showSnackbar(
                        message = "$name is larger than 4 MB and was not attached.",
                        actionLabel = "Choose another",
                    )
                    if (result == androidx.compose.material3.SnackbarResult.ActionPerformed) {
                        relaunchFilePicker = true
                    }
                }
                continue
            }
            if (mimeType.startsWith("image/")) {
                val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                vm.addAttachment(name, mimeType, "data:$mimeType;base64,$b64", null)
            } else {
                val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                vm.addAttachment(name, mimeType, "data:$mimeType;base64,$b64", decodeUtf8Text(bytes))
            }
        }
    }

    LaunchedEffect(Unit) {
        WsRepository.pendingSelectedAttachmentPath.collect { path ->
            if (!path.isNullOrBlank()) {
                vm.addDesktopPathAttachment(path)
                WsRepository.pendingSelectedAttachmentPath.value = null
            }
        }
    }

    LaunchedEffect(relaunchFilePicker) {
        if (relaunchFilePicker) {
            relaunchFilePicker = false
            filePicker.launch("*/*")
        }
    }

    val clipboardManager = context.getSystemService(ClipboardManager::class.java)

    // Expanding a persisted history into timeline items may involve hundreds of reasoning
    // blocks, tool calls, and timestamp sorts. Do it away from the Compose thread so the
    // app bar/composer can draw immediately when a conversation is opened. The cache retains
    // the settled prefix, so token reveal updates only expand the active tail.
    val renderTimelineCache = remember { ChatRenderTimelineCache() }
    val renderItems by produceState<List<ChatRenderItem>?>(
        initialValue = null,
        messages,
        isAwaitingResponse,
        isStreaming,
        liveThinkingBlocks,
        liveTurnState,
        liveActivity,
        generationStartedAt,
    ) {
        value = withContext(Dispatchers.Default) {
            renderTimelineCache.build(
                messages = messages,
                activeTurn = liveTurnState,
                liveThinkingBlocks = liveThinkingBlocks,
                isAwaitingResponse = isAwaitingResponse,
                isStreaming = isStreaming,
                activity = liveActivity,
                generationStartedAt = generationStartedAt,
            )
        }
    }
    val completedRenderItems = renderItems.orEmpty()
    val isBuildingInitialRenderItems = renderItems == null

    // Snapshot of where the last item sits relative to the viewport, for the truncated-tail hunt.
    // `tailBelowFold` alongside `canScrollFwd=false` is the contradiction that flags a clipped tail.
    fun logScrollGeometry(stage: String, extra: String = "") {
        val layout = listState.layoutInfo
        val last = layout.visibleItemsInfo.lastOrNull()
        val lastBottom = last?.let { it.offset + it.size } ?: 0
        val viewportEnd = layout.viewportEndOffset
        val tailBelowFold = lastBottom > viewportEnd + 1
        ChatLayoutDiagnostics.recordScroll(
            stage,
            "follow=$shouldAutoFollow items=${layout.totalItemsCount} lastIdx=${last?.index ?: -1} " +
                "lastBottom=$lastBottom viewportEnd=$viewportEnd tailBelowFold=$tailBelowFold " +
                "canScrollFwd=${listState.canScrollForward} scrolling=${listState.isScrollInProgress}" +
                if (extra.isBlank()) "" else " $extra",
        )
    }

    // Re-pin to the bottom every frame and keep going until the list is genuinely at rest, rather
    // than firing a fixed 1-2 passes and hoping the observer re-triggers. The log proved why a small
    // fixed count is not enough: a message ABOVE the tail can receive its real text (e.g. 135 -> 3143
    // chars) or finish its Markwon AndroidView measurement many frames AFTER the list first declared
    // "at-bottom", pushing the tail below the fold. A single settle pass cannot outlast content that
    // legitimately grows over several frames, and the re-pin snapshotFlow only re-emits on a discrete
    // signal change — so once geometry stalls at a wrong resting position nothing re-drives it.
    //
    // Loop until one of: (a) the true bottom is reached (canScrollForward == false); (b) the tail's
    // bottom edge has stopped moving for two consecutive frames while still below the fold — a genuine
    // row-measurement shortfall that more scrolling cannot fix, logged distinctly so it is unambiguous
    // in the next capture; or (c) the frame budget is spent (guards against streaming, where content
    // grows every frame — the content-signal effect re-invokes us on the next chunk anyway).
    suspend fun scrollToBottom(animated: Boolean = false, maxFrames: Int = 12) {
        if (!shouldAutoFollow) return
        programmaticScrollInProgress = true
        try {
            var lastBottomSeen = Int.MIN_VALUE
            var stableFrames = 0
            repeat(maxFrames.coerceAtLeast(1)) { pass ->
                if (!shouldAutoFollow) return
                val itemCount = listState.layoutInfo.totalItemsCount
                if (itemCount <= 0) return
                listState.scrollToItem(itemCount - 1, scrollOffset = Int.MAX_VALUE)
                // Markwon AndroidView content can report a larger measured height after it is first revealed.
                withFrameNanos {}
                if (!listState.canScrollForward) {
                    logScrollGeometry("settle-final", "pass=$pass reason=at-bottom")
                    return
                }
                val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()
                val bottom = last?.let { it.offset + it.size } ?: 0
                if (bottom == lastBottomSeen) {
                    // Height has stopped changing but canScrollForward is still true: content below
                    // the committed fold that re-pinning cannot reveal (the row itself is short).
                    if (++stableFrames >= 2) {
                        logScrollGeometry("settle-final", "pass=$pass reason=stable-below-fold")
                        return
                    }
                } else {
                    stableFrames = 0
                    lastBottomSeen = bottom
                }
            }
            logScrollGeometry("settle-final", "reason=frames-exhausted")
        } finally {
            programmaticScrollInProgress = false
        }
    }

    val isAtBottom by remember {
        derivedStateOf { !listState.canScrollForward }
    }

    // Initial entry: a single correction after the first layout is enough for the common case.
    // Further asynchronous height changes are handled by the layout observer below.
    LaunchedEffect(conversationId) {
        if (restoredViewState != null) return@LaunchedEffect
        snapshotFlow { renderItems != null && listState.layoutInfo.totalItemsCount > 0 }
            .first { it }
        shouldAutoFollow = true
        scrollToBottom()
        hasInitiallyScrolled = true
    }

    DisposableEffect(conversationId, listState) {
        onDispose {
            ChatHistoryMemoryCache.putViewState(
                conversationId,
                ChatHistoryMemoryCache.ViewState(
                    itemIndex = listState.firstVisibleItemIndex,
                    itemOffset = listState.firstVisibleItemScrollOffset,
                    shouldAutoFollow = shouldAutoFollow,
                ),
            )
        }
    }

    val streamingTextLength = remember(messages) { messages.lastOrNull { it.isStreaming }?.text?.length ?: 0 }
    val thinkingBlocksSize = liveThinkingBlocks.size
    val thinkingTotalChars = liveThinkingBlocks.sumOf { it.content.length }
    // Track tool-call content changes (e.g. Team activity, Codex CLI) — these mutate an existing
    // placeholder message in place on completion, so messages.size alone won't catch the update.
    val toolActivityResultLength = remember(messages) { messages.filter { it.serverName != null }.sumOf { (it.toolResult?.length ?: 0) + (it.toolArgs?.length ?: 0) } }

    // Content signal: new messages, streaming chunks, thinking bubbles, or busy state changes should
    // stay pinned only while auto-follow is enabled.
    LaunchedEffect(messages.size, isAwaitingResponse, isStreaming, streamingTextLength, thinkingBlocksSize, thinkingTotalChars, toolActivityResultLength) {
        if (!hasInitiallyScrolled || !shouldAutoFollow) return@LaunchedEffect
        scrollToBottom()
    }

    // Layout signal: AndroidView/Markwon content can change height after message data is already set.
    // A single assistant reply is split into several sibling lazy items (thinking blocks, tool calls,
    // text segments, then the tail AssistantMessage). Watching only the *last visible item's own size*
    // missed the dominant case: an AndroidView/Markwon TextView in a segment ABOVE the tail finishes
    // its StaticLayout a frame later and grows, pushing the tail below the fold WITHOUT changing the
    // tail's own size or the item count — so no re-pin fired and the last segment stayed clipped until
    // an unrelated relayout (tapping a bubble, a manual scroll) forced a re-measure. So the signal now
    // also tracks the last visible item's bottom edge (offset + size) and whether content still exists
    // below the fold (canScrollForward): any late height change that displaces the tail re-triggers the
    // pin. Still scroll-position-independent for normal reading — the collect guard requires auto-follow
    // to be on (disabled the moment the user scrolls up) and no in-progress gesture, and it self-
    // terminates because canScrollForward goes false once the true bottom is reached.
    LaunchedEffect(hasInitiallyScrolled) {
        if (!hasInitiallyScrolled) return@LaunchedEffect
        snapshotFlow {
            val layout = listState.layoutInfo
            val last = layout.visibleItemsInfo.lastOrNull()
            ScrollPinSignal(
                follow = shouldAutoFollow,
                itemCount = layout.totalItemsCount,
                lastIndex = last?.index ?: -1,
                lastBottom = last?.let { it.offset + it.size } ?: 0,
                canScrollForward = listState.canScrollForward,
            )
        }.collect {
            if (shouldAutoFollow && !listState.isScrollInProgress && listState.canScrollForward) {
                logScrollGeometry("repin-fire")
                scrollToBottom()
            } else {
                // Why we did NOT re-pin. If the tail is clipped yet this logs canScrollFwd=false,
                // the re-pin self-terminated while content was still below the committed fold.
                val reason = when {
                    !shouldAutoFollow -> "no-follow"
                    listState.isScrollInProgress -> "scrolling"
                    else -> "at-bottom"
                }
                logScrollGeometry("repin-skip", "reason=$reason")
            }
        }
    }

    // User scroll signal: once the user scrolls and leaves the bottom, stop auto-following until
    // they return to the bottom or press the arrow.
    LaunchedEffect(hasInitiallyScrolled) {
        if (!hasInitiallyScrolled) return@LaunchedEffect
        var wasScrolling = false
        snapshotFlow { listState.isScrollInProgress to listState.canScrollForward }
            .collect { (scrolling, canScrollForward) ->
                if (!programmaticScrollInProgress) {
                    if (scrolling && canScrollForward) {
                        shouldAutoFollow = false
                    } else if (wasScrolling && !scrolling && !canScrollForward) {
                        shouldAutoFollow = true
                    }
                }
                wasScrolling = scrolling
            }
    }

    LaunchedEffect(conversation?.model, availableProjectDefault, forcedAgentBackend, chatAgent?.cliModel, chatModels) {
        val storedModel = conversation?.model?.takeIf { modelId ->
            modelId.isNotBlank() && modelId != "default" && chatModels.any { it.id == modelId }
        }
        val agentModel = chatAgent?.cliModel?.takeIf { modelId ->
            modelId.isNotBlank() && modelId != "default" &&
                (chatModels.isEmpty() || chatModels.any { it.id == modelId })
        }
        vm.loadModel(storedModel ?: agentModel ?: availableProjectDefault)
    }

    val requestModelList = {
        WsRepository.send(
            "model:list",
            buildMap {
                if (!chatBackend.isNullOrBlank()) put("backend", chatBackend)
                if (!chatAgentId.isNullOrBlank()) put("agentId", chatAgentId)
                if (!targetHermesProfile.isNullOrBlank()) put("hermesProfile", targetHermesProfile)
            },
        )
    }

    LaunchedEffect(chatBackend, chatAgentId, targetHermesProfile) {
        requestModelList()
    }

    LaunchedEffect(sendError) {
        val error = sendError ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(error)
        vm.clearSendError()
    }

    val slashCommandMessage by vm.slashCommandMessage.collectAsStateWithLifecycle()
    LaunchedEffect(slashCommandMessage) {
        val message = slashCommandMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        vm.consumeSlashCommandMessage()
    }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            when (event) {
                is io.nexy.android.data.model.WsEvent.ConversationForked -> {
                    if (branchPending) {
                        branchPending = false
                        onOpenFork?.invoke(event.conversationId)
                    }
                }
                is io.nexy.android.data.model.WsEvent.ConversationForkError -> {
                    if (branchPending) {
                        branchPending = false
                        snackbarHostState.showSnackbar(event.message)
                    }
                }
                is io.nexy.android.data.model.WsEvent.ToolApprovalRequest -> {
                    // Only surface approvals for the conversation being viewed. A concurrent turn in
                    // another conversation broadcasts its own request; the Home-screen dialog owns
                    // those. null conversationId = legacy desktop that can't scope, so show it here.
                    if (event.conversationId == null || event.conversationId == conversationId) {
                        enqueueApproval(event)
                    }
                }
                is io.nexy.android.data.model.WsEvent.ToolApprovalCancel -> {
                    dismissApproval(event.requestId)
                }
                is io.nexy.android.data.model.WsEvent.ChatToolCallEvent -> {
                    if (event.conversationId == conversationId) {
                        advanceApproval()
                    }
                }
                is io.nexy.android.data.model.WsEvent.ChatActivity -> {
                    if (event.conversationId == conversationId &&
                        (event.state == "complete" || event.state == "error")) {
                        advanceApproval()
                    }
                }
                is io.nexy.android.data.model.WsEvent.ArtifactPromoted -> {
                    if (pendingPromotedMessageId != null && event.messageId == pendingPromotedMessageId) {
                        pendingPromotedMessageId = null
                        promoteArtifactMessage = null
                        val result = snackbarHostState.showSnackbar(
                            message = "Artifact saved",
                            actionLabel = "View",
                        )
                        if (result == androidx.compose.material3.SnackbarResult.ActionPerformed) {
                            onOpenArtifacts?.invoke(event.artifactId)
                        }
                    }
                }
                is io.nexy.android.data.model.WsEvent.ArtifactPromoteError -> {
                    if (pendingPromotedMessageId != null && event.messageId == pendingPromotedMessageId) {
                        pendingPromotedMessageId = null
                        snackbarHostState.showSnackbar(event.message)
                    }
                }
                is io.nexy.android.data.model.WsEvent.PromptEntryCreated -> {
                    if (savePromptPending) {
                        savePromptPending = false
                        savePromptMessage = null
                        snackbarHostState.showSnackbar("Prompt saved")
                    }
                }
                is io.nexy.android.data.model.WsEvent.PromptError -> {
                    if (savePromptPending) {
                        savePromptPending = false
                        snackbarHostState.showSnackbar(event.message)
                    }
                }
                is io.nexy.android.data.model.WsEvent.AgentFull -> {
                    if (event.config.id == chatAgentId) chatAgentFullAutoApprove = event.config.fullAutoApprove
                }
                is io.nexy.android.data.model.WsEvent.ProjectConfig -> {
                    if (event.id == statusProjectId) chatProjectWorkflowMode = event.config.workflowMode
                }
                is io.nexy.android.data.model.WsEvent.ConversationCapabilities -> {
                    if (event.conversationId == conversationId) capabilityProfileJson = event.profileJson
                }
                is io.nexy.android.data.model.WsEvent.CapabilityPreflight -> {
                    if (event.conversationId == conversationId) capabilityPreflightJson = event.preflightJson
                }
                is io.nexy.android.data.model.WsEvent.CapabilitiesActivated -> {
                    if (event.conversationId == conversationId) {
                        capabilityProfileJson = event.profileJson
                        WsRepository.resolveCapabilities(conversationId, selectedModel)
                        snackbarHostState.showSnackbar("Capabilities updated")
                    }
                }
                is io.nexy.android.data.model.WsEvent.CapabilitiesError -> {
                    if (event.conversationId == conversationId) snackbarHostState.showSnackbar(event.message)
                }
                is io.nexy.android.data.model.WsEvent.AutomatedWorkflowRunsList -> {
                    if (event.projectId == statusProjectId) {
                        val active = event.runs.firstOrNull { it.status != "done" && it.status != "cancelled" }
                        if (active != null) WsRepository.getAutomatedWorkflowRun(active.id) else activeWorkflowRun = null
                    }
                }
                is io.nexy.android.data.model.WsEvent.AutomatedWorkflowRunDetailReady -> {
                    val run = event.run
                    if (run != null && run.projectId == statusProjectId) {
                        activeWorkflowRun = run
                    }
                }
                is io.nexy.android.data.model.WsEvent.AutomatedWorkflowRunsError -> {
                    // Approve/Retry/Skip in the banner below send WS commands with no reply
                    // path other than this event — without surfacing it, a failed action (e.g. a
                    // race with another device that already resolved the step) looks identical to
                    // "still processing" and the user has no idea their tap did nothing.
                    snackbarHostState.showSnackbar(event.message)
                }
                else -> {}
            }
        }
    }

    // Compose retains the first visible item's keyed position when entries are prepended. Start
    // the request just before the hard top so the next page is ready without a blank boundary.
    LaunchedEffect(hasInitiallyScrolled) {
        if (!hasInitiallyScrolled) return@LaunchedEffect
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.firstOrNull()?.index ?: Int.MAX_VALUE }
            .collect { firstVisibleIndex ->
                if (firstVisibleIndex > 2) {
                    olderPageArmed = true
                } else if (olderPageArmed) {
                    olderPageArmed = false
                    vm.loadOlderMessages()
                }
            }
    }

    var highlightedMessageId by remember { mutableStateOf<String?>(null) }

    DisposableEffect(conversationId) {
        WsRepository.activelyViewedConversationId.value = conversationId
        WsRepository.clearCompletedAway(conversationId)
        io.nexy.android.notification.ActivityBadgeManager.markSeen(
            context,
            io.nexy.android.notification.ActivityBadgeManager.chatDestination(conversationId),
        )
        onDispose { WsRepository.activelyViewedConversationId.value = null }
    }

    val assistantBusy = isStreaming || isAwaitingResponse
    LaunchedEffect(emergencyStopActive) {
        if (emergencyStopActive && assistantBusy) vm.stopStream()
    }
    // Deferred behind derivedStateOf so the composer's per-keystroke `input` mutation is observed
    // only by whoever reads canSend.value — the bottom input bar — instead of being read in the
    // top-level ChatScreen scope. A direct read here subscribed the entire screen (message timeline
    // included) to `input`, so every character typed recomposed the whole conversation, which is the
    // keyboard lag on long chats. `assistantBusy` is inlined as (isStreaming || isAwaitingResponse)
    // so the remembered derived block re-reads those snapshot States rather than a stale captured Boolean.
    val canSend by remember {
        derivedStateOf {
            (input.isNotBlank() || attachments.isNotEmpty()) &&
                !emergencyStopActive &&
                !(isStreaming || isAwaitingResponse) &&
                (connectionState == ConnectionState.CONNECTED || capabilities.internetState != InternetState.UNAVAILABLE)
        }
    }
    val draftProject = projectId?.let { id -> projects.find { it.id == id } }
    val agentLabel = conversation?.agent_name?.let { name ->
        val icon = conversation.agent_icon
        if (!icon.isNullOrBlank()) "$icon  $name" else name
    } ?: chatAgent?.let { agent ->
        // chatAgent already resolves nav-arg agentId and, for a project draft, the inherited
        // primary — so the header names the agent even before the first send binds it.
        if (agent.icon.isNotBlank()) "${agent.icon}  ${agent.name}" else agent.name
    }
    val projectLabel = conversation?.project_name ?: draftProject?.name
    val activeModelId = selectedModel ?: "default"
    val activeModelLabel = activeModelLabel(selectedModel, models)
    val activeModelDetail = if (projectDefaultApplied) {
        "Project default"
    } else {
        activeModelDetail(selectedModel, chatAgent, modelSource)
    }
    val backendLockLabel = agentBackendLockLabel(chatAgent)
    val backendLockDetail = agentBackendLockDetail(chatAgent)
    val connectionBanner = connectionState != ConnectionState.CONNECTED

    fun suggestedArtifactTitle(text: String): String {
        val heading = Regex("""(?m)^\s{0,3}#{1,6}\s+(.+?)\s*$""").find(text)?.groupValues?.getOrNull(1)?.trim()
        return heading ?: conversation?.title?.takeIf { it.isNotBlank() } ?: "New Artifact"
    }

    fun suggestedArtifactFilePath(kind: String): String = when (kind) {
        "prompt" -> "prompt.md"
        "code" -> "output.ts"
        "other" -> "output.txt"
        else -> "output.md"
    }

    if (showModelSheet) {
        ModalBottomSheet(
            onDismissRequest = { showModelSheet = false },
            sheetState = modelSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ModelPickerSheet(
                title = "Chat model",
                models = chatModels,
                cliStatus = cliStatus,
                selectedModelId = activeModelId,
                hermesProfiles = if (activeCliBackend == "hermes-cli") hermesInfo.profiles else emptyList(),
                selectedHermesProfile = targetHermesProfile,
                onSelectHermesProfile = { profile ->
                    vm.setHermesProfile(profile)
                    selectedModel?.let { model -> vm.setModel(model, profile, "hermes-cli") }
                },
                subtitle = backendLockDetail,
                emptyStateText = emptyModelListDetail(modelSource),
                effectiveMode = effectiveMode,
            ) { modelId ->
                val selectedBackend = models.find { it.id == modelId }?.backend
                vm.setModel(modelId, if (selectedBackend == "hermes-cli") targetHermesProfile else null, selectedBackend)
                scope.launch { modelSheetState.hide() }.invokeOnCompletion { showModelSheet = false }
            }
        }
    }

    if (showModeSheet) {
        ModalBottomSheet(
            onDismissRequest = { showModeSheet = false },
            sheetState = modeSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ChatModeSheet(
                thinkingEffortOverride = chatThinkingEffortOverride,
                projectDefaultThinkingEffort = projectDefaultThinkingEffort,
                fullAutoApproveOverride = chatFullAutoApproveOverride,
                agenticModeOverride = chatAgenticModeOverride,
                terminalSandboxOverride = chatTerminalSandboxOverride,
                activeCliBackend = activeCliBackend,
                showAgenticMode = effectiveMode != EffectiveConnectionMode.STANDALONE_BY_CHOICE,
                cliModeOverride = chatCliModeOverride,
                codexExecutionModeOverride = chatCodexExecutionModeOverride,
                onSetThinkingEffort = { vm.setThinkingEffortOverride(it) },
                onSetFullAutoApprove = { vm.setFullAutoApproveOverride(it) },
                onSetAgenticMode = { vm.setAgenticModeOverride(it) },
                onSetTerminalSandboxOverride = { vm.setTerminalSandboxOverride(it) },
                onSetCliMode = { vm.setCliModeOverride(it) },
                onSetCodexExecutionMode = { vm.setCodexExecutionModeOverride(it) },
            )
        }
    }

    if (showCapabilitiesSheet) {
        ModalBottomSheet(
            onDismissRequest = { showCapabilitiesSheet = false },
            sheetState = capabilitiesSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            CapabilitySheet(
                skills = availableSkills,
                mcpServers = mcpServers,
                profileJson = capabilityProfileJson,
                preflightJson = capabilityPreflightJson,
                projectName = chatProject?.name,
                hasProject = statusProjectId != null,
                hasAgent = chatAgentId != null,
                desktopConnected = capabilities.desktopConnected,
                onOpenMcpServers = onOpenMcpServers,
                onRefresh = {
                    WsRepository.getConversationCapabilities(conversationId)
                    WsRepository.resolveCapabilities(conversationId, selectedModel)
                },
                onActivate = { selectedScope, skillIds, mcp ->
                    WsRepository.activateCapabilities(
                        conversationId = conversationId,
                        skillIds = skillIds,
                        mcp = mcp,
                        scope = selectedScope,
                        targetId = when (selectedScope) {
                            "project" -> statusProjectId
                            "agent" -> chatAgentId
                            else -> null
                        },
                    )
                },
            )
        }
    }

    if (showActionsSheet) {
        ConversationActionsSheet(
            conversationId = conversationId,
            markdownViewMode = markdownViewMode,
            onMarkdownViewModeChange = { preferenceStore.setMarkdownViewMode(it) },
            onDismiss = { showActionsSheet = false },
            onForkNavigate = { forkedId ->
                onOpenFork?.invoke(forkedId)
            },
            onImportNavigate = { importedId ->
                onOpenFork?.invoke(importedId)
            },
            emergencyStopActive = emergencyStopActive,
            onEmergencyStopClick = {
                if (emergencyStopActive) WsRepository.resumeConversations()
                else showEmergencyStopConfirmation = true
            },
        )
    }

    if (showForkFromHereProjectPicker) {
        ForkProjectPickerDialog(
            projects = projects,
            selectedProjectId = forkFromHereProjectId,
            onProjectSelected = { forkFromHereProjectId = it },
            onConfirm = {
                val cutoff = forkFromHereTimestamp
                showForkFromHereProjectPicker = false
                if (cutoff != null) {
                    branchPending = true
                    WsRepository.forkConversation(
                        conversationId = conversationId,
                        cutoffTimestamp = cutoff,
                        projectId = forkFromHereProjectId,
                        includeProject = true,
                    )
                }
            },
            onDismiss = { showForkFromHereProjectPicker = false },
        )
    }

    if (showEmergencyStopConfirmation) {
        AlertDialog(
            onDismissRequest = { showEmergencyStopConfirmation = false },
            title = { Text("Emergency stop all conversations?") },
            text = { Text("This immediately cancels every active response and blocks new messages until you explicitly resume.") },
            confirmButton = {
                TextButton(onClick = {
                    showEmergencyStopConfirmation = false
                    WsRepository.activateEmergencyStop()
                }) { Text("Emergency stop", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { showEmergencyStopConfirmation = false }) { Text("Cancel") }
            },
        )
    }

    if (showPromptSheet) {
        ModalBottomSheet(
            onDismissRequest = { showPromptSheet = false },
            sheetState = promptSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            PromptLibrarySheetContent(promptEntries = visiblePromptEntries, projectId = statusProjectId) { body ->
                val separator = if (input.isNotBlank() && !input.endsWith("\n")) "\n" else ""
                input += "$separator$body"
                vm.setDraft(input)
                scope.launch { promptSheetState.hide() }.invokeOnCompletion { showPromptSheet = false }
            }
            Spacer(Modifier.padding(bottom = 16.dp))
        }
    }

    if (showInspectorSheet) {
        ContextInspectorSheet(
            conversationId = conversationId,
            onDismiss = { showInspectorSheet = false },
            sheetState = inspectorSheetState,
        )
    }

    savePromptMessage?.let {
        val chatProjectId = conversation?.project_id ?: projectId
        CreatePromptSheet(
            title = savePromptTitle,
            body = savePromptBody,
            description = savePromptDescription,
            category = savePromptCategory,
            tags = savePromptTags,
            scope = savePromptScope,
            showProjectScope = !chatProjectId.isNullOrBlank(),
            onTitleChange = { savePromptTitle = it },
            onBodyChange = { savePromptBody = it },
            onDescriptionChange = { savePromptDescription = it },
            onCategoryChange = { savePromptCategory = it },
            onTagsChange = { savePromptTags = it },
            onScopeChange = { savePromptScope = it },
            onConfirm = {
                savePromptPending = true
                WsRepository.createPrompt(
                    title = savePromptTitle.trim(),
                    body = savePromptBody,
                    description = savePromptDescription.trim(),
                    category = savePromptCategory.trim().ifBlank { "Custom" },
                    tags = savePromptTags.split(",").map { tag -> tag.trim() }.filter { tag -> tag.isNotBlank() },
                    scope = savePromptScope,
                    projectId = if (savePromptScope == "project") chatProjectId else null,
                )
            },
            onDismiss = { if (!savePromptPending) savePromptMessage = null },
            sheetTitle = "Save as prompt",
            confirmLabel = if (savePromptPending) "Saving…" else "Save",
            saving = savePromptPending,
        )
    }

    deletingMessage?.let { message ->
        NexyConfirmDialog(
            title = "Delete message?",
            message = "This message will be removed from the paired desktop conversation.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                vm.deleteMessage(message.id)
                deletingMessage = null
            },
            onDismiss = { deletingMessage = null },
        )
    }

    deleteAfterMessage?.let { message ->
        NexyConfirmDialog(
            title = "Delete from here?",
            message = "This message and all messages after it will be removed from the conversation.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                vm.deleteMessagesAfter(conversationId, message.timestamp)
                deleteAfterMessage = null
            },
            onDismiss = { deleteAfterMessage = null },
        )
    }

    addToProjectMessage?.let { message ->
        val chatProjectId = conversation?.project_id ?: projectId
        if (chatProjectId != null) {
            AlertDialog(
                onDismissRequest = { addToProjectMessage = null; addToProjectTitle = "" },
                title = { Text("Save to wiki") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            "Save this message as a wiki entry in the project.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedTextField(
                            value = addToProjectTitle,
                            onValueChange = { addToProjectTitle = it },
                            label = { Text("Title") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            val title = addToProjectTitle.trim().ifBlank { "From chat" }
                            WsRepository.createWikiEntry(chatProjectId, title, message.text, emptyList())
                            scope.launch { snackbarHostState.showSnackbar("Added to project sources.") }
                            addToProjectMessage = null
                            addToProjectTitle = ""
                        },
                    ) { Text("Add") }
                },
                dismissButton = {
                    TextButton(onClick = { addToProjectMessage = null; addToProjectTitle = "" }) { Text("Cancel") }
                },
            )
        }
    }

    promoteArtifactMessage?.let { message ->
        val chatProjectId = conversation?.project_id ?: projectId
        AlertDialog(
            onDismissRequest = {
                if (pendingPromotedMessageId == null) {
                    promoteArtifactMessage = null
                }
            },
            title = { Text("Save as artifact") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Save this assistant response as a versioned artifact.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = promoteArtifactTitle,
                        onValueChange = { promoteArtifactTitle = it },
                        label = { Text("Title") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = promoteArtifactKind,
                        onValueChange = {
                            promoteArtifactKind = it
                            promoteArtifactFilePath = suggestedArtifactFilePath(it)
                        },
                        label = { Text("Kind") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = promoteArtifactScopeType,
                        onValueChange = { promoteArtifactScopeType = if (it == "project") "project" else "global" },
                        label = { Text("Scope (global or project)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = promoteArtifactFilePath,
                        onValueChange = { promoteArtifactFilePath = it },
                        label = { Text("File path") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (promoteArtifactScopeType == "project" && chatProjectId.isNullOrBlank()) {
                        Text(
                            "This chat is not attached to a project, so only global scope is available.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val scopeType = if (promoteArtifactScopeType == "project" && !chatProjectId.isNullOrBlank()) "project" else "global"
                        pendingPromotedMessageId = message.id
                        WsRepository.promoteArtifactMessage(
                            conversationId = conversationId,
                            messageId = message.id,
                            title = promoteArtifactTitle.trim(),
                            kind = promoteArtifactKind.trim().ifBlank { "document" },
                            scopeType = scopeType,
                            scopeProjectId = if (scopeType == "project") chatProjectId else null,
                            filePath = promoteArtifactFilePath.trim(),
                        )
                    },
                    enabled = pendingPromotedMessageId == null && promoteArtifactFilePath.isNotBlank(),
                ) { Text(if (pendingPromotedMessageId == null) "Save" else "Saving…") }
            },
            dismissButton = {
                TextButton(
                    onClick = { promoteArtifactMessage = null },
                    enabled = pendingPromotedMessageId == null,
                ) { Text("Cancel") }
            },
        )
    }

    val colorScheme = MaterialTheme.colorScheme
    val markwon = remember(context, colorScheme) {
        val prism4j = Prism4j(io.nexy.android.GrammarLocatorDef())
        // Custom theme: subtle tinted background with readable dark text instead of Darkula black
        val codeTheme = object : Prism4jTheme {
            override fun background(): Int = 0xFF1E1F2E.toInt() // deep navy, visible in both themes
            override fun textColor(): Int = 0xFFE8EAF6.toInt() // soft lavender-white
            override fun apply(language: String, syntax: io.noties.prism4j.Prism4j.Syntax, builder: SpannableStringBuilder, start: Int, end: Int) = Unit
        }
        val dip = io.noties.markwon.utils.Dip.create(context)
        val tableTheme = TableTheme.emptyBuilder()
            .tableBorderColor(colorScheme.outlineVariant.toArgb())
            .tableBorderWidth(dip.toPx(1))
            .tableCellPadding(dip.toPx(8))
            .tableHeaderRowBackgroundColor(colorScheme.surfaceVariant.toArgb())
            .tableEvenRowBackgroundColor(colorScheme.surface.toArgb())
            .tableOddRowBackgroundColor(colorScheme.surfaceVariant.copy(alpha = 0.3f).toArgb())
            .build()
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(tableTheme))
            .usePlugin(LinkifyPlugin.create())
            .usePlugin(SyntaxHighlightPlugin.create(prism4j, codeTheme))
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(
                TaskListPlugin.create(
                    colorScheme.primary.toArgb(),
                    colorScheme.onPrimary.toArgb(),
                    colorScheme.outline.toArgb(),
                ),
            )
            .usePlugin(object : AbstractMarkwonPlugin() {
                override fun configureTheme(builder: MarkwonTheme.Builder) {
                    builder
                        .linkColor(colorScheme.primary.toArgb())
                        .codeTextColor(colorScheme.onSurfaceVariant.toArgb())
                        .codeBackgroundColor(colorScheme.surfaceVariant.toArgb())
                        .blockQuoteColor(colorScheme.outline.toArgb())
                }
            })
            .build()
    }
    CompositionLocalProvider(LocalMarkwon provides markwon) {
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                contentSyncInProgress = isReconcilingHistory,
                titleContent = {
                    Column {
                        Text(title, maxLines = 1, style = MaterialTheme.typography.titleMedium)
                        val subtitle = when {
                            agentLabel != null && projectLabel != null -> "$agentLabel · $projectLabel"
                            agentLabel != null -> agentLabel
                            projectLabel != null -> projectLabel
                            else -> null
                        }
                        if (subtitle != null) {
                            Text(
                                subtitle,
                                maxLines = 1,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (backendLockLabel != null) {
                            Text(
                                backendLockLabel,
                                maxLines = 1,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                        if (chatProjectWorkflowMode == "automated-delegation" || chatProjectWorkflowMode == "orchestrated") {
                            Text(
                                if (chatProjectWorkflowMode == "orchestrated") "Orchestrated workflow" else "Automated workflow",
                                maxLines = 1,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                        if (chatAgentFullAutoApprove) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                Icon(
                                    Icons.Default.Warning,
                                    contentDescription = null,
                                    modifier = Modifier.size(12.dp),
                                    tint = MaterialTheme.colorScheme.error,
                                )
                                Text(
                                    "Auto-approve is on",
                                    maxLines = 1,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                        if (isCompleted) {
                            ChatCompletedBadge()
                        }
                        if (conversationRating != null) {
                            ChatRatingBadge(conversationRating)
                        }
                    }
                },
                onBack = onBack,
                actions = {
                    if (assistantBusy) {
                        IconButton(
                            onClick = { vm.stopStream() },
                        ) {
                            NexyIcon(NexyIconName.Stop, contentDescription = "Stop")
                        }
                    }
                    IconButton(onClick = {
                        WsRepository.getConversationCapabilities(conversationId)
                        WsRepository.resolveCapabilities(conversationId, selectedModel)
                        showCapabilitiesSheet = true
                    }) {
                        NexyIcon(NexyIconName.Tool, contentDescription = "Capabilities")
                    }
                    statusProjectId?.let { activeProjectId ->
                        IconButton(onClick = { onOpenProjectPeek?.invoke(activeProjectId) }) {
                            NexyIcon(NexyIconName.Folder, contentDescription = "Browse project files")
                        }
                    }
                    IconButton(onClick = { showActionsSheet = true }) {
                        NexyIcon(
                            NexyIconName.More,
                            contentDescription = "More actions",
                            tint = if (emergencyStopActive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
            )
        },
        bottomBar = {
            ChatInputBar(
                input = input,
                onInputChange = { input = it; vm.setDraft(it) },
                attachments = attachments,
                onRemoveAttachment = { vm.removeAttachment(it) },
                canSend = canSend,
                onSend = {
                    val chatProjectId = conversation?.project_id ?: projectId
                    val chatAgentId = conversation?.agent_id ?: agentId
                    if (editingMessageId == null && vm.trySlashCommand(
                            input,
                            chatProjectId,
                            onNewChat = { onNewChat?.invoke(chatAgentId, chatProjectId) },
                            onOpenCodePanel = { pid -> onOpenCodePanel?.invoke(pid) },
                        )) {
                        input = ""
                        vm.setDraft("")
                    } else {
                        editingMessageId?.let { vm.editMessage(it, input) } ?: vm.sendMessage(input)
                        editingMessageId = null
                        input = ""
                        vm.setDraft("")
                    }
                },
                onAttachFile = { filePicker.launch("*/*") },
                onAttachDesktopPath = onOpenDesktopPathPicker,
                onInsertPrompt = {
                    // Project prompts must be requested with the active project. Calling the
                    // unscoped list here replaces the repository flow with global prompts only,
                    // making a newly saved project prompt disappear from this picker.
                    WsRepository.listPrompts(normalizePromptProjectId(conversation?.project_id ?: projectId))
                    showPromptSheet = true
                },
                onShowInspector = { showInspectorSheet = true },
                isListening = if (usePairedVoice && voiceDockEnabled) voiceDockState.recording else voiceInput.listening,
                isTranscribing = if (usePairedVoice && voiceDockEnabled) {
                    voiceDockState.busy && !voiceDockState.recording
                } else {
                    voiceInput.processing
                },
                onVoiceInput = {
                    val listening = if (usePairedVoice && voiceDockEnabled) voiceDockState.recording else voiceInput.listening
                    if (usePairedVoice && voiceDockEnabled) {
                        if (voiceDockState.recording) stopVoiceDockRecording() else startVoiceDockRecording()
                    } else {
                        voiceInput.toggle()
                    }
                },
                onCancelVoiceInput = {
                    if (usePairedVoice && voiceDockEnabled) cancelVoiceDockRecording() else voiceInput.cancel()
                },
                voiceDockAvailable = voiceDockEnabled,
                voiceDockFloating = voiceDockFloating,
                onFloatVoiceDock = {
                    voiceDockFloating = true
                    preferenceStore.setVoiceDockFloating(true)
                },
                customSlashCommands = customSlashCommands,
                modelLabel = activeModelLabel,
                onModelClick = {
                    requestModelList()
                    WsRepository.getCliStatus()
                    showModelSheet = true
                },
                onOpenModeSettings = { showModeSheet = true },
                modeSettingsActive = chatThinkingEffortOverride != null || chatFullAutoApproveOverride != null || chatTerminalSandboxOverride != null || (activeCliBackend != null && chatCliModeOverride != null),
            )
        },
    ) { padding ->
        // LazyColumn item index offset: item 0 = ChatStartHeader, items 1..N = renderItems
        val lazyHeaderOffset = if (completedRenderItems.isNotEmpty()) 1 else 0

        val handleScrollToRequest: suspend (Int) -> Unit = { itemIdx ->
            programmaticScrollInProgress = true
            shouldAutoFollow = false
            val lazyIdx = itemIdx + lazyHeaderOffset
            try {
                listState.scrollToItem(lazyIdx)
            } finally {
                programmaticScrollInProgress = false
            }
            val msgId = (completedRenderItems.getOrNull(itemIdx) as? ChatRenderItem.UserMessage)?.message?.id
            if (msgId != null) {
                highlightedMessageId = msgId
                kotlinx.coroutines.delay(1600)
                highlightedMessageId = null
            }
        }

        var sourceAnchorHandled by remember(conversationId, initialMessageId) {
            mutableStateOf(false)
        }
        LaunchedEffect(initialMessageId, completedRenderItems) {
            val target = initialMessageId?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
            if (sourceAnchorHandled) return@LaunchedEffect
            val index = completedRenderItems.indexOfFirst { item ->
                when (item) {
                    is ChatRenderItem.UserMessage -> item.message.id == target
                    is ChatRenderItem.AssistantMessage -> item.message.id == target
                    is ChatRenderItem.ToolCall -> item.message.id == target
                    is ChatRenderItem.ThinkingBlockItem -> item.messageId == target
                    is ChatRenderItem.TextSegmentItem -> item.messageId == target
                    is ChatRenderItem.ArtifactCard -> item.messageId == target
                    else -> false
                }
            }
            if (index >= 0) {
                sourceAnchorHandled = true
                programmaticScrollInProgress = true
                shouldAutoFollow = false
                try {
                    listState.scrollToItem(index + lazyHeaderOffset)
                } finally {
                    programmaticScrollInProgress = false
                }
                highlightedMessageId = target
                kotlinx.coroutines.delay(1600)
                highlightedMessageId = null
            }
        }

        ChatRefreshableContent(
            isRefreshing = isRefreshing,
            onRefresh = { vm.refreshMessages() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Box(modifier = Modifier.fillMaxSize()) {
            // Height (px) of the in-flow banners below (connection + workflow step), measured so
            // the floating InReplyToBanner overlay can sit just beneath them without overlapping.
            var topBannersHeightPx by remember { mutableStateOf(0) }

            Column(modifier = Modifier.fillMaxSize()) {
                Column(modifier = Modifier.onGloballyPositioned { topBannersHeightPx = it.size.height }) {
                    if (connectionBanner) {
                        NexyConnectionBanner(connectionState, lastError)
                    }

                    val bannerRun = activeWorkflowRun
                    val bannerStep = currentWorkflowStep
                    // Keyed on status+attempt, not just the step's stable logical id: a retried step
                    // keeps the same id, so dismissing a failed-step banner must not permanently
                    // silence it once that same step fails again on a later attempt.
                    val bannerStepKey = bannerStep?.let { "${it.id}:${it.status}:${it.attempt}" }
                    if (bannerRun != null && bannerStep != null && bannerStepKey != dismissedWorkflowStepId) {
                        val gated = bannerRun.confirmationMode == "gated"
                        Surface(color = MaterialTheme.colorScheme.primaryContainer) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                val statusSuffix = when (bannerStep.status) {
                                    "running" -> " — running…"
                                    "awaiting_confirmation" -> if (gated) " — ready for your review" else " — advancing automatically…"
                                    "failed" -> " — failed" + (bannerStep.error?.let { ": $it" } ?: "")
                                    else -> ""
                                }
                                Text(
                                    "${bannerRun.title} — Step ${bannerStep.stepIndex + 1} of ${bannerRun.steps.size}: ${bannerStep.title}$statusSuffix",
                                    style = MaterialTheme.typography.labelSmall,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                if (bannerStep.status == "awaiting_confirmation" && gated) {
                                    TextButton(onClick = { WsRepository.confirmAutomatedWorkflowStep(bannerRun.id, bannerStep.dbId) }) {
                                        Text("Approve", style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                                if (bannerStep.status == "failed") {
                                    TextButton(onClick = { WsRepository.retryAutomatedWorkflowStep(bannerRun.id, bannerStep.dbId) }) {
                                        Text("Retry", style = MaterialTheme.typography.labelSmall)
                                    }
                                    TextButton(onClick = { WsRepository.skipAutomatedWorkflowStep(bannerRun.id, bannerStep.dbId) }) {
                                        Text("Skip", style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                                TextButton(onClick = { bannerRun.projectId?.let { onOpenAutomatedWorkflow?.invoke(it) } }) {
                                    Text("View", style = MaterialTheme.typography.labelSmall)
                                }
                                IconButton(onClick = { dismissedWorkflowStepId = bannerStepKey }, modifier = Modifier.size(28.dp)) {
                                    Icon(Icons.Default.Close, contentDescription = "Dismiss workflow step banner", modifier = Modifier.size(14.dp))
                                }
                            }
                        }
                    }
                }

                Box(modifier = Modifier.weight(1f)) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    if (isLoadingOlder) {
                        item(key = "older-history-loading") {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.Center,
                            ) {
                                Text(
                                    "Loading older messages…",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Gray400,
                                )
                            }
                        }
                    }
                    if (isBuildingInitialRenderItems) {
                        item(key = "chat-timeline-building") {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
                                horizontalArrangement = Arrangement.Center,
                            ) {
                                Text("Preparing conversation…", style = MaterialTheme.typography.labelSmall, color = Gray400)
                            }
                        }
                    } else if (completedRenderItems.isEmpty() && isInitialHistoryLoading) {
                        item(key = "chat-history-skeleton") {
                            ChatLoadingSkeleton()
                        }
                    } else if (completedRenderItems.isEmpty()) {
                        item {
                            EmptyChatContent(agentLabel = agentLabel, projectLabel = projectLabel)
                        }
                    } else {
                        item { ChatStartHeader() }
                    }
                    items(
                        completedRenderItems,
                        key = { item -> item.key },
                        contentType = { item ->
                            when (item) {
                                is ChatRenderItem.UserMessage -> 0
                                is ChatRenderItem.ToolCall -> 1
                                // Assistant/text-segment rows host Android TextView/WebView
                                // children. Do not recycle one message's embedded View holder as
                                // another message: a stale narrow measurement can otherwise
                                // survive while scrolling historical content. The LazyColumn
                                // still virtualizes off-screen rows, but these content types make
                                // each embedded-view row mount with its own width contract.
                                is ChatRenderItem.AssistantMessage -> "assistant:${item.key}"
                                is ChatRenderItem.LiveThinking -> 3
                                is ChatRenderItem.LiveActivity -> 4
                                is ChatRenderItem.ArtifactCard -> 5
                                is ChatRenderItem.ThinkingBlockItem -> 6
                                is ChatRenderItem.TextSegmentItem -> "text-segment:${item.key}"
                                is ChatRenderItem.UserInputCard -> 7
                            }
                        },
                    ) { item ->
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .onGloballyPositioned { coordinates ->
                                    ChatLayoutDiagnostics.record(
                                        messageKey = item.key,
                                        stage = "lazy-item-${item::class.simpleName}",
                                        widthPx = coordinates.size.width,
                                        heightPx = coordinates.size.height,
                                    )
                                    // Late-growth cross-check: did THIS lazy row re-measure taller?
                                    // Paired with the "holder" stream (Markwon AndroidView height),
                                    // a holder growth with no matching row growth = clipped tail.
                                    ChatLayoutDiagnostics.noteHeight(item.key, "row", coordinates.size.height)
                                },
                        ) {
                        when (item) {
                            is ChatRenderItem.ToolCall -> {
                                val inProgress = item.message.isStreaming
                                if (isCodexToolCall(item.message.serverName)) {
                                    ChatTimelineGroup {
                                        ChatTimelineEntry(
                                            beadColor = toolCallBeadColor(inProgress = inProgress, success = item.message.toolSuccess),
                                            pulse = inProgress,
                                        ) {
                                            CodexToolActionLine(item.message, inProgress = inProgress)
                                        }
                                    }
                                } else {
                                    ChatTimelineGroup { ToolCallBubble(item.message, inProgress = inProgress) }
                                }
                            }
                            is ChatRenderItem.ThinkingBlockItem -> {
                                if (isPlainNarrationReasoning(listOf(item.block))) {
                                    ChatTimelineGroup {
                                        ChatTimelineEntry(beadColor = thinkingBeadColor(streaming = !item.block.done), pulse = !item.block.done) {
                                            CliReasoningActionLine(listOf(item.block))
                                        }
                                    }
                                } else {
                                    ChatTimelineGroup { ThinkingHistoryBubble(listOf(item.block), isLive = false) }
                                }
                            }
                            is ChatRenderItem.TextSegmentItem -> {
                                ChatTimelineGroup {
                                    ChatTimelineEntry(beadColor = Gray400) {
                                        ExpandedResponseTextSegment(
                                            content = item.block.content,
                                            debugKey = item.key,
                                            viewMode = markdownViewMode,
                                        )
                                    }
                                }
                            }
                            is ChatRenderItem.LiveThinking -> {
                                ChatTimelineGroup {
                                    item.blocks.forEachIndexed { index, block ->
                                        key("${block.blockId}:$index") {
                                            if (isPlainNarrationReasoning(listOf(block))) {
                                                ChatTimelineEntry(beadColor = thinkingBeadColor(streaming = !block.done), pulse = !block.done) {
                                                    CliReasoningActionLine(listOf(block))
                                                }
                                            } else {
                                                ThinkingHistoryBubble(listOf(block), isLive = true)
                                            }
                                        }
                                    }
                                }
                            }
                            is ChatRenderItem.LiveActivity -> {
                                val isTool = item.activity.state == "tool"
                                ChatTimelineGroup {
                                    ChatTimelineEntry(beadColor = if (isTool) Blue500 else Gray400, pulse = true) {
                                        ThinkingBubble(item.activity, item.generationStartedAt)
                                    }
                                }
                            }
                            is ChatRenderItem.UserInputCard -> {
                                ChatTimelineGroup {
                                    ChatTimelineEntry(beadColor = Blue500, pulse = item.input.status == "pending") {
                                        UserInputCard(item.input)
                                    }
                                }
                            }
                            is ChatRenderItem.ArtifactCard -> {
                                val targetConversationId = item.ref.conversationId ?: conversationId
                                ArtifactRefBubble(
                                    ref = item.ref,
                                    onOpenDebrief = { onOpenDebrief?.invoke(targetConversationId) },
                                    onOpenQuiz = { onOpenQuiz?.invoke(targetConversationId, item.ref.artifactId) },
                                    onOpenTeachback = { onOpenTeachback?.invoke(targetConversationId, item.ref.artifactId) },
                                    onOpenArtifact = { onOpenArtifacts?.invoke(item.ref.artifactId) },
                                )
                            }
                            is ChatRenderItem.UserMessage -> {
                                val msg = item.message
                                val sourceText = msg.rawText ?: msg.text
                                val chatProjectId = conversation?.project_id ?: projectId
                                MessageBubble(
                                    msg = msg,
                                    markdownViewMode = markdownViewMode,
                                    onCopy = { copyMessage(clipboardManager, sourceText) },
                                    onEdit = {
                                        editingMessageId = msg.id.takeIf { it.isNotBlank() }
                                        input = msg.text
                                        vm.setDraft(msg.text)
                                    },
                                    onResend = { vm.retryMessage(msg.id, msg.text) },
                                    onDelete = if (msg.id.isNotBlank()) { { deletingMessage = msg } } else null,
                                    onDeleteAfter = if (msg.id.isNotBlank() && msg.timestamp > 0L) { { deleteAfterMessage = msg } } else null,
                                    onBranch = if (msg.timestamp > 0L) {
                                        {
                                            forkFromHereTimestamp = msg.timestamp
                                            forkFromHereProjectId = chatProjectId
                                            showForkFromHereProjectPicker = true
                                        }
                                    } else null,
                                    onSaveAsPrompt = if (msg.text.isNotBlank()) {
                                        {
                                            val body = stripInjectedContextBlocks(msg.text).trim()
                                            savePromptMessage = msg
                                            savePromptBody = body
                                            savePromptTitle = body.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty().take(64)
                                            savePromptDescription = ""
                                            savePromptCategory = "Custom"
                                            savePromptTags = ""
                                            savePromptScope = if (!chatProjectId.isNullOrBlank()) "project" else "global"
                                        }
                                    } else null,
                                    isHighlighted = msg.id == highlightedMessageId,
                                    onRetry = null,
                                    onEditAssistant = null,
                                    onAddToProject = null,
                                    onShare = null,
                                )
                            }
                            is ChatRenderItem.AssistantMessage -> {
                                val msg = item.message
                                val sourceText = msg.rawText ?: msg.text
                                val precedingUserMessage = item.precedingUserMessage
                                val chatProjectId = conversation?.project_id ?: projectId
                                androidx.compose.foundation.layout.Column {
                                    // Historical (settled) thinking blocks no longer render here — they're
                                    // emitted as their own top-level ChatRenderItem.ThinkingBlockItem entries
                                    // by buildChatRenderItems, immediately preceding this item (see its doc
                                    // for why: avoids bursting a reasoning-heavy turn's composition/measure
                                    // work into a single LazyColumn item). Only still-live thinking blocks and
                                    // this turn's tool calls render inline here.
                                    val hasTimelineContent = item.liveThinkingBlocks.isNotEmpty() ||
                                        msg.toolCalls.isNotEmpty()
                                    if (hasTimelineContent) {
                                        ChatTimelineGroup {
                                            // Live thinking blocks pre-filtered by buildChatRenderItems (C1 guard).
                                            // Each block is its own bubble — desktop shows each reasoning phase
                                            // separately (ThinkingBlock.tsx renders once per block), so joining
                                            // every block's content into one combined bubble here (the old
                                            // behavior) collapsed a multi-phase turn into a single "> 2k chars"
                                            // blob instead of one bubble per phase.
                                            item.liveThinkingBlocks.forEachIndexed { index, block ->
                                                key("${block.blockId}:$index") {
                                                    if (isPlainNarrationReasoning(listOf(block))) {
                                                        ChatTimelineEntry(beadColor = thinkingBeadColor(streaming = !block.done), pulse = !block.done) {
                                                            CliReasoningActionLine(listOf(block))
                                                        }
                                                    } else {
                                                        ThinkingHistoryBubble(listOf(block), isLive = true)
                                                    }
                                                }
                                            }
                                            // Tool calls grouped inline above the response text.
                                            msg.toolCalls.forEach { tc ->
                                                if (isCodexToolCall(tc.serverName)) {
                                                    ChatTimelineEntry(beadColor = toolCallBeadColor(inProgress = tc.isStreaming, success = tc.toolSuccess), pulse = tc.isStreaming) {
                                                        CodexToolActionLine(tc, inProgress = tc.isStreaming)
                                                    }
                                                } else {
                                                    ToolCallBubble(tc, inProgress = tc.isStreaming)
                                                }
                                            }
                                        }
                                    }
                                    MessageBubble(
                                        msg = msg,
                                        displayText = item.displayText,
                                        markdownViewMode = markdownViewMode,
                                        onCopy = { copyMessage(clipboardManager, sourceText) },
                                        onEdit = null,
                                        onResend = null,
                                        onDelete = if (msg.id.isNotBlank()) { { deletingMessage = msg } } else null,
                                    onDeleteAfter = if (msg.id.isNotBlank() && msg.timestamp > 0L) { { deleteAfterMessage = msg } } else null,
                                    isHighlighted = false,
                                    onRetry = if (precedingUserMessage != null) {
                                        { vm.retryMessage(precedingUserMessage.id, precedingUserMessage.text) }
                                    } else null,
                                        onEditAssistant = if (msg.text.isNotBlank()) {
                                            {
                                                editingMessageId = msg.id.takeIf { it.isNotBlank() }
                                                input = msg.text
                                                vm.setDraft(msg.text)
                                            }
                                        } else null,
                                        onBranch = if (msg.timestamp > 0L) {
                                            {
                                                forkFromHereTimestamp = msg.timestamp
                                                forkFromHereProjectId = chatProjectId
                                                showForkFromHereProjectPicker = true
                                            }
                                        } else null,
                                        onAddToProject = if (chatProjectId != null && msg.text.isNotBlank()) {
                                            { addToProjectMessage = msg; addToProjectTitle = "" }
                                        } else null,
                                        onSaveAsArtifact = if (msg.text.isNotBlank()) {
                                            {
                                                promoteArtifactMessage = msg
                                                promoteArtifactTitle = suggestedArtifactTitle(msg.text)
                                                promoteArtifactKind = "document"
                                                promoteArtifactScopeType = if (!chatProjectId.isNullOrBlank()) "project" else "global"
                                                promoteArtifactFilePath = suggestedArtifactFilePath("document")
                                            }
                                        } else null,
                                        onSaveAsPrompt = if (msg.text.isNotBlank()) {
                                            {
                                                val body = msg.text.trim()
                                                savePromptMessage = msg
                                                savePromptBody = body
                                                savePromptTitle = body.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty().take(64)
                                                savePromptDescription = ""
                                                savePromptCategory = "Custom"
                                                savePromptTags = ""
                                                savePromptScope = if (!chatProjectId.isNullOrBlank()) "project" else "global"
                                            }
                                        } else null,
                                        onShare = if (msg.text.isNotBlank()) {
                                            {
                                                val intent = Intent(Intent.ACTION_SEND).apply {
                                                    type = "text/plain"
                                                    putExtra(Intent.EXTRA_TEXT, sourceText)
                                                }
                                                context.startActivity(Intent.createChooser(intent, "Share message"))
                                            }
                                        } else null,
                                    )
                                }
                            }
                        }
                        }
                    }
                    pendingApproval?.let { approval ->
                        item(key = "approval-${approval.requestId}") {
                            ToolApprovalCard(
                                approval = approval,
                                onApprove = {
                                    WsRepository.send("tool:approve", mapOf("requestId" to approval.requestId))
                                    advanceApproval()
                                },
                                onKeepPlanning = {
                                    WsRepository.send("tool:reject", mapOf("requestId" to approval.requestId))
                                    advanceApproval()
                                },
                                onDeny = {
                                    WsRepository.send("tool:reject", mapOf("requestId" to approval.requestId))
                                    advanceApproval()
                                },
                            )
                        }
                    }
                }
                ChatScrollbar(
                    listState = listState,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .fillMaxHeight()
                        .padding(vertical = 4.dp, horizontal = 2.dp),
                )
                }
            }
            // Floating overlay, not in-flow: an in-flow banner here previously resized the
            // Column's weighted LazyColumn area every time this scroll-position-driven banner
            // mounted/unmounted, which shifted the visible items and read as a jitter right as
            // the user scrolled past the point where the banner's target crossed the viewport
            // edge. Offsetting by topBannersHeightPx keeps it below the connection/workflow
            // banners instead of stacking on top of them (the reason it was made in-flow before).
            InReplyToBanner(
                listState = listState,
                renderItems = completedRenderItems,
                lazyHeaderOffset = lazyHeaderOffset,
                onScrollToRequest = { itemIdx -> scope.launch { handleScrollToRequest(itemIdx) } },
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .offset { IntOffset(0, topBannersHeightPx) },
            )
            // Scroll-to-bottom button shown whenever the user is scrolled above the bottom
            if (hasInitiallyScrolled && !isAtBottom) {
                FloatingActionButton(
                    onClick = {
                        scope.launch {
                            shouldAutoFollow = true
                            scrollToBottom(animated = false)
                        }
                    },
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp).size(40.dp),
                ) {
                    Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Scroll to bottom", modifier = Modifier.size(20.dp))
                }
            }
            if (voiceDockEnabled && voiceDockFloating) {
                VoiceDock(
                    state = effectiveVoiceDockState,
                    preferences = preferenceStore,
                    onStartRecording = startVoiceDockRecording,
                    onStopRecording = stopVoiceDockRecording,
                    onCancelRecording = cancelVoiceDockRecording,
                    onDock = { voiceDockFloating = false },
                )
            }
            } // Box
        }
    }
    } // CompositionLocalProvider
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun CapabilitySheet(
    skills: List<io.nexy.android.data.model.SkillConfig>,
    mcpServers: List<io.nexy.android.data.model.McpServerInfo>,
    profileJson: String,
    preflightJson: String,
    projectName: String?,
    hasProject: Boolean,
    hasAgent: Boolean,
    desktopConnected: Boolean,
    onOpenMcpServers: (() -> Unit)?,
    onRefresh: () -> Unit,
    onActivate: (scope: String, skillIds: List<String>, mcp: List<Map<String, String>>) -> Unit,
) {
    var selectedScope by remember { mutableStateOf("chat") }
    val scopeSelection = remember(profileJson, preflightJson, selectedScope) {
        capabilitySelectionForScope(profileJson, preflightJson, selectedScope)
    }
    var selectedSkills by remember(profileJson, preflightJson, selectedScope) { mutableStateOf(scopeSelection.skillIds) }
    var selectedMcp by remember(profileJson, preflightJson, selectedScope) { mutableStateOf(scopeSelection.mcpTrustByServer) }
    var skillSearch by remember { mutableStateOf("") }
    val preflight = remember(preflightJson) { runCatching { JSONObject(preflightJson) }.getOrDefault(JSONObject()) }
    val ready = preflight.optBoolean("ready", false)
    val desktopOnly = preflight.optBoolean("desktopOnly", selectedMcp.isNotEmpty())
    val filteredSkills = remember(skills, skillSearch) {
        val query = skillSearch.trim()
        if (query.isBlank()) skills
        else skills.filter {
            it.name.contains(query, ignoreCase = true) ||
                it.description.contains(query, ignoreCase = true)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NexyIcon(NexyIconName.Tool, contentDescription = null, modifier = Modifier.size(20.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("Capabilities", style = MaterialTheme.typography.titleMedium)
                Text("Use skills and tools without creating an agent.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = onRefresh) { Text("Check") }
        }
        Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium) {
            Text(
                when {
                    !desktopConnected && desktopOnly -> "This setup needs the connected desktop. MCP credentials and browser sessions stay there."
                    ready -> "Ready. Approval modes are saved for the selected scope."
                    else -> "Choose a skill or MCP capability, then check readiness before sending your task."
                },
                modifier = Modifier.padding(12.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text("Use this setup", style = MaterialTheme.typography.labelLarge)
        CapabilityScopeOption("This chat", "One-off use (recommended)", selectedScope == "chat") { selectedScope = "chat" }
        if (hasProject) CapabilityScopeOption("This project", projectName ?: "Available to future project chats", selectedScope == "project") { selectedScope = "project" }
        if (hasAgent) CapabilityScopeOption("This agent", "Reusable defaults for this agent", selectedScope == "agent") { selectedScope = "agent" }

        Text("Skills", style = MaterialTheme.typography.labelLarge)
        if (skills.isEmpty()) Text("No imported skills yet. Import one from the Skills screen.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        else {
            OutlinedTextField(
                value = skillSearch,
                onValueChange = { skillSearch = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Search skills") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                singleLine = true,
            )
        }
        if (skills.isNotEmpty() && filteredSkills.isEmpty()) {
            Text("No skills match \"$skillSearch\".", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        filteredSkills.forEach { skill ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Checkbox(checked = selectedSkills.contains(skill.id), onCheckedChange = { checked -> selectedSkills = if (checked) selectedSkills + skill.id else selectedSkills - skill.id })
                Column(modifier = Modifier.weight(1f)) {
                    Text("${skill.icon} ${skill.name}", style = MaterialTheme.typography.bodyMedium)
                    if (skill.description.isNotBlank()) Text(skill.description, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Text("MCP tools", style = MaterialTheme.typography.labelLarge)
        if (mcpServers.isEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("No MCP servers configured yet.", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (onOpenMcpServers != null) TextButton(onClick = onOpenMcpServers) { Text("Open MCP setup") }
            }
        }
        mcpServers.forEach { server ->
            val trust = selectedMcp[server.id]
            var approvalExpanded by remember(server.id, selectedScope) { mutableStateOf(false) }
            Column(modifier = Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Checkbox(
                        checked = trust != null,
                        onCheckedChange = { checked ->
                            selectedMcp = if (checked) selectedMcp + (server.id to "always-ask") else selectedMcp - server.id
                        },
                    )
                    Text(server.name, style = MaterialTheme.typography.bodyMedium)
                }
                if (trust != null) {
                    val trustLabel = capabilityTrustOptions.find { it.first == trust }?.second ?: "Ask every time"
                    ExposedDropdownMenuBox(
                        expanded = approvalExpanded,
                        onExpandedChange = { approvalExpanded = it },
                        modifier = Modifier.padding(start = 48.dp),
                    ) {
                        OutlinedTextField(
                            value = trustLabel,
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Approval") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = approvalExpanded) },
                            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                        )
                        ExposedDropdownMenu(
                            expanded = approvalExpanded,
                            onDismissRequest = { approvalExpanded = false },
                        ) {
                            capabilityTrustOptions.forEach { (value, label) ->
                                DropdownMenuItem(
                                    text = { Text(label) },
                                    onClick = {
                                        selectedMcp = selectedMcp + (server.id to value)
                                        approvalExpanded = false
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
        if (mcpServers.isNotEmpty() && onOpenMcpServers != null) {
            TextButton(onClick = onOpenMcpServers) { Text("Manage or add MCP capabilities") }
        }
        val activateEnabled = desktopConnected && (selectedSkills.isNotEmpty() || selectedMcp.isNotEmpty())
        Button(
            onClick = {
                onActivate(
                    selectedScope,
                    selectedSkills.toList(),
                    selectedMcp.map { (serverId, trust) -> mapOf("serverId" to serverId, "trust" to trust) },
                )
            },
            enabled = activateEnabled,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (!desktopConnected) "Connect desktop to activate" else when (selectedScope) {
                "project" -> "Add to project"
                "agent" -> "Attach to agent"
                else -> "Use in this chat"
            })
        }
        Spacer(Modifier.padding(bottom = 12.dp))
    }
}

@Composable
private fun CapabilityScopeOption(label: String, detail: String, selected: Boolean, onSelect: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable(onClick = onSelect)) {
        RadioButton(selected = selected, onClick = onSelect)
        Column {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun InReplyToBanner(
    listState: androidx.compose.foundation.lazy.LazyListState,
    renderItems: List<ChatRenderItem>,
    lazyHeaderOffset: Int,
    modifier: Modifier = Modifier,
    onScrollToRequest: (Int) -> Unit,
) {
    // derivedStateOf is scoped here so only this composable recomposes on every scroll frame,
    // not the parent Box/Column/LazyColumn.
    val bannerRequest by remember(renderItems, lazyHeaderOffset) {
        derivedStateOf {
            val visibleItems = listState.layoutInfo.visibleItemsInfo
            val firstVisibleIdx = visibleItems.firstOrNull()?.index ?: return@derivedStateOf null
            val topAssistantRenderIdx = visibleItems
                .map { it.index - lazyHeaderOffset }
                .filter { ri -> ri >= 0 && ri < renderItems.size && renderItems[ri] is ChatRenderItem.AssistantMessage }
                .firstOrNull() ?: return@derivedStateOf null
            // Never show the banner for the latest exchange — while the user scrolls down
            // through the final turn to reach the true bottom of the conversation, this
            // condition would otherwise flip true/false on nearly every scroll frame as the
            // preceding user message crosses the viewport's top edge, and the banner
            // appearing/disappearing shrinks and grows the LazyColumn's available height out
            // from under an in-progress drag, which was stranding users mid-scroll unable to
            // reach the bottom. There's also no value in "in reply to" for the message you
            // just sent — it's the one on screen.
            val lastAssistantRenderIdx = renderItems.indexOfLast { it is ChatRenderItem.AssistantMessage }
            if (topAssistantRenderIdx == lastAssistantRenderIdx) return@derivedStateOf null
            // Find the preceding user message
            val precedingUserRenderIdx = (topAssistantRenderIdx - 1 downTo 0)
                .firstOrNull { renderItems[it] is ChatRenderItem.UserMessage } ?: return@derivedStateOf null
            val userLazyIdx = precedingUserRenderIdx + lazyHeaderOffset
            if (visibleItems.any { it.index == userLazyIdx }) return@derivedStateOf null
            if (userLazyIdx >= firstVisibleIdx) return@derivedStateOf null
            val userMsg = (renderItems[precedingUserRenderIdx] as ChatRenderItem.UserMessage).message
            val preview = userMsg.text.replace('\n', ' ').trim()
            if (preview.isBlank()) null else Pair(precedingUserRenderIdx, if (preview.length > 120) preview.take(117) + "…" else preview)
        }
    }
    bannerRequest?.let { (groupIdx, preview) ->
        Surface(
            modifier = modifier
                .fillMaxWidth()
                .clickable { onScrollToRequest(groupIdx) },
            color = MaterialTheme.colorScheme.surfaceVariant,
            shadowElevation = 2.dp,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    "In reply to",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    preview,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

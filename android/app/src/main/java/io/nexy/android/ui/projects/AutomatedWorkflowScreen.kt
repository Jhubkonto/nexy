package io.nexy.android.ui.projects

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.content.ClipData
import android.content.ClipboardManager
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.AutomatedWorkflowRunInfo
import io.nexy.android.data.model.AutomatedWorkflowRunStepData
import io.nexy.android.data.model.AutomatedWorkflowStepInfo
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.chat.ChatInputBar
import io.nexy.android.ui.chat.ModelPickerSheet
import io.nexy.android.ui.chat.rememberOnDeviceVoiceInput
import io.nexy.android.ui.components.GeneratorChatBubble
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyGhostButton
import io.nexy.android.ui.components.NexyStepIndicator
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.model.activeModelLabel
import kotlinx.coroutines.launch
import java.util.UUID

private enum class AutomatedWorkflowView { Workspace, List, Detail }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AutomatedWorkflowScreen(
    // null generates a standalone, project-less workflow — mirrors desktop's project-optional
    // Automated Workflow runs.
    projectId: String?,
    onBack: () -> Unit,
    onOpenConversation: (String) -> Unit = {},
) {
    val session by WsRepository.automatedWorkflowSession.collectAsStateWithLifecycle()
    val activeSession = session
    val models by WsRepository.models.collectAsStateWithLifecycle()
    val cliStatus by WsRepository.cliStatus.collectAsStateWithLifecycle()
    val effectiveMode by WsRepository.effectiveMode.collectAsStateWithLifecycle()
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val disconnected = connectionState != ConnectionState.CONNECTED
    val snackbarHostState = remember { SnackbarHostState() }
    var messageInput by remember { mutableStateOf("") }
    var confirmReset by remember { mutableStateOf(false) }
    var selectedModel by remember { mutableStateOf<String?>(null) }
    var showModelSheet by remember { mutableStateOf(false) }
    val modelSheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val voiceInput = rememberOnDeviceVoiceInput(
        onText = { text -> messageInput = if (messageInput.isBlank()) text else "${messageInput.trimEnd()} $text" },
        onError = { message -> scope.launch { snackbarHostState.showSnackbar(message) } },
    )

    var view by remember { mutableStateOf(AutomatedWorkflowView.Workspace) }
    val savedRuns = remember { mutableStateListOf<AutomatedWorkflowRunInfo>() }
    var activeRun by remember { mutableStateOf<AutomatedWorkflowRunInfo?>(null) }
    var discardTarget by remember { mutableStateOf<String?>(null) }
    // Set when "Run again" is tapped — the reply is a normal AutomatedWorkflowRunDetailReady for
    // a brand-new run id, so it's matched back here by templateId rather than by run id (which
    // wouldn't exist yet client-side) to know when to navigate into the freshly spawned run.
    var pendingRunAgainTemplateId by remember { mutableStateOf<String?>(null) }
    val stepStreamText by WsRepository.automatedWorkflowStepStreamText.collectAsStateWithLifecycle()
    val managedSources by WsRepository.managedWorkflowSources.collectAsStateWithLifecycle()

    // Mirrors the TopAppBar's onBack step-back logic below — without this, the system/gesture
    // back button skips past Detail/List and exits the screen in one tap instead of stepping
    // back one internal view at a time.
    BackHandler(enabled = view != AutomatedWorkflowView.Workspace) {
        when (view) {
            AutomatedWorkflowView.Detail -> { activeRun = null; view = AutomatedWorkflowView.List }
            AutomatedWorkflowView.List -> view = AutomatedWorkflowView.Workspace
            AutomatedWorkflowView.Workspace -> Unit
        }
    }

    // Discard any workflow session left over from a different project.
    LaunchedEffect(projectId) {
        if (session != null && session?.projectId != projectId) {
            WsRepository.cancelAutomatedWorkflowGeneration()
        }
    }

    LaunchedEffect(Unit) { WsRepository.send("model:list", emptyMap()) }

    // Re-fetches on reconnect too (not just on first composition) — a saved run's steps can
    // fully progress through several auto-executed steps while the phone was disconnected, so a
    // plain LaunchedEffect(projectId) alone would leave this screen showing stale state after
    // the phone reconnects. Mirrors RemoteEditReportDetailScreen.kt's established pattern.
    LaunchedEffect(projectId, disconnected) {
        if (!disconnected) {
            WsRepository.listAutomatedWorkflowRuns(projectId)
            if (projectId != null) WsRepository.listManagedWorkflowSources(projectId)
            activeRun?.let { WsRepository.getAutomatedWorkflowRun(it.id) }
        }
    }

    LaunchedEffect(projectId) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.AutomatedWorkflowRunsList -> if (event.projectId == projectId) {
                    savedRuns.clear()
                    savedRuns.addAll(event.runs)
                }
                is WsEvent.AutomatedWorkflowRunDetailReady -> {
                    val run = event.run
                    if (run != null && run.projectId == projectId) {
                        val idx = savedRuns.indexOfFirst { it.id == run.id }
                        if (idx >= 0) savedRuns[idx] = run else savedRuns.add(0, run)
                        if (activeRun?.id == run.id) {
                            activeRun = run
                            WsRepository.pruneAutomatedWorkflowStepStreamText(
                                run.steps.filter { it.status == "running" }.map { it.dbId }.toSet(),
                            )
                        } else if (pendingRunAgainTemplateId != null && run.templateId == pendingRunAgainTemplateId) {
                            pendingRunAgainTemplateId = null
                            activeRun = run
                            view = AutomatedWorkflowView.Detail
                        }
                    }
                }
                is WsEvent.AutomatedWorkflowRunDiscarded -> if (event.ok) {
                    savedRuns.removeAll { it.id == event.runId }
                    if (activeRun?.id == event.runId) {
                        activeRun = null
                        view = AutomatedWorkflowView.List
                    }
                }
                is WsEvent.AutomatedWorkflowRunsError -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                else -> {}
            }
        }
    }

    LaunchedEffect(activeSession?.savedRunId) {
        if (activeSession?.savedRunId != null) {
            snackbarHostState.showSnackbar("Workflow saved")
        }
    }

    fun sendMessage() {
        val text = messageInput.trim()
        if (text.isBlank()) return
        if (session == null) {
            WsRepository.startAutomatedWorkflowGeneration(projectId, text, model = selectedModel)
        } else {
            WsRepository.sendAutomatedWorkflowGeneratorMessage(text, model = selectedModel)
        }
        messageInput = ""
    }

    if (confirmReset) {
        NexyConfirmDialog(
            title = "Start over?",
            message = "The current Automated Workflow session will be cleared.",
            confirmLabel = "Start over",
            destructive = true,
            onConfirm = {
                confirmReset = false
                WsRepository.cancelAutomatedWorkflowGeneration()
            },
            onDismiss = { confirmReset = false },
        )
    }

    discardTarget?.let { runId ->
        NexyConfirmDialog(
            title = "Discard this workflow?",
            message = "This plan and its step progress will be permanently removed.",
            confirmLabel = "Discard",
            destructive = true,
            onConfirm = {
                discardTarget = null
                WsRepository.discardAutomatedWorkflowRun(runId)
            },
            onDismiss = { discardTarget = null },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(
                        when (view) {
                            AutomatedWorkflowView.Workspace -> "Automated Workflow"
                            AutomatedWorkflowView.List -> "Saved Workflows"
                            AutomatedWorkflowView.Detail -> activeRun?.title?.takeIf(String::isNotBlank) ?: "Workflow"
                        },
                    )
                },
                onBack = {
                    when (view) {
                        AutomatedWorkflowView.Detail -> { activeRun = null; view = AutomatedWorkflowView.List }
                        AutomatedWorkflowView.List -> view = AutomatedWorkflowView.Workspace
                        AutomatedWorkflowView.Workspace -> onBack()
                    }
                },
                actions = {
                    if (view == AutomatedWorkflowView.Workspace) {
                        TextButton(onClick = { showModelSheet = true }) {
                            Icon(
                                Icons.Default.Tune,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                activeModelLabel(selectedModel, models),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.widthIn(max = 100.dp),
                            )
                        }
                        if (session != null) {
                            NexyGhostButton(text = "Reset", onClick = { confirmReset = true })
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        when (view) {
            AutomatedWorkflowView.List -> SavedWorkflowRunListView(
                modifier = Modifier.fillMaxSize().padding(padding),
                runs = savedRuns,
                onOpen = { run -> activeRun = run; WsRepository.getAutomatedWorkflowRun(run.id); view = AutomatedWorkflowView.Detail },
                onDiscard = { run -> discardTarget = run.id },
                onNewWorkflow = { view = AutomatedWorkflowView.Workspace },
            )
            AutomatedWorkflowView.Detail -> {
                val run = activeRun
                if (run == null) {
                    view = AutomatedWorkflowView.List
                } else {
                    SavedWorkflowRunDetailView(
                        modifier = Modifier.fillMaxSize().padding(padding),
                        run = run,
                        stepStreamText = stepStreamText,
                        onStart = { WsRepository.startAutomatedWorkflowRun(run.id) },
                        onModeChange = { mode -> WsRepository.setAutomatedWorkflowConfirmationMode(run.id, mode) },
                        onAbort = { WsRepository.abortAutomatedWorkflowRun(run.id) },
                        onApprove = { step, output -> WsRepository.confirmAutomatedWorkflowStep(run.id, step.dbId, output.takeIf { it != step.output }) },
                        onRetry = { step -> WsRepository.retryAutomatedWorkflowStep(run.id, step.dbId) },
                        onSkip = { step -> WsRepository.skipAutomatedWorkflowStep(run.id, step.dbId) },
                        onOpenConversation = onOpenConversation,
                        onRunAgain = { templateId ->
                            pendingRunAgainTemplateId = templateId
                            WsRepository.runAgainAutomatedWorkflow(templateId)
                        },
                    )
                }
            }
            AutomatedWorkflowView.Workspace -> Column(modifier = Modifier.fillMaxSize().padding(padding)) {
                NexyStepIndicator(
                    steps = listOf("Describe", "Review", "Saved"),
                    currentStep = when {
                        session == null -> 0
                        activeSession?.savedRunId == null -> 1
                        else -> 2
                    },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                if (savedRuns.isNotEmpty()) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        TextButton(onClick = { view = AutomatedWorkflowView.List }) {
                            Text("My workflows (${savedRuns.size})", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .padding(horizontal = 16.dp),
                ) {
                    if (activeSession == null) {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                "Describe the workflow you want to generate — the assistant will propose a goal, assumptions, and a step-by-step plan. Each step is assigned to one of your agents (that agent's own skills apply) or a plain model, whichever fits best.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                "Once a plan comes back, tap Save — it syncs to the desktop app and stays saved until you're ready, with no time limit. When you do start it, each step runs in its own conversation, either pausing for your review after each one or running straight through automatically, depending on the mode you choose. A saved plan can also be repeated later via \"Run again\" without describing the goal again.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (projectId != null) {
                                Text("Start from a managed deliverable", style = MaterialTheme.typography.labelMedium)
                                Row(
                                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    listOf(
                                        "Weekly report" to "Create a weekly report workflow from selected project notes. Let me review the Markdown draft, then publish it to reports/weekly.md.",
                                        "Release notes" to "Create release notes from selected changelog and project files. Let me edit and approve the Markdown, then publish it to RELEASE_NOTES.md.",
                                        "Design draft" to "Create a design document from selected requirements. Include a review step, then publish the approved Markdown to docs/design.md.",
                                    ).forEach { (label, prompt) ->
                                        TextButton(onClick = { messageInput = prompt }) { Text(label) }
                                    }
                                }
                            }
                        }
                    } else {
                        // Plan header, step cards, and the chat log all live in this single scrollable
                        // LazyColumn (rather than the plan/steps block being a separate unbounded
                        // Column) so a workflow with many steps scrolls fully into view instead of
                        // squeezing the chat log toward zero height — mirrors ChatScreen.kt's pattern
                        // of one weighted LazyColumn with no competing unbounded sibling.
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f)
                                .padding(vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (activeSession.title.isNotEmpty() || activeSession.goalSummary.isNotEmpty() || activeSession.steps.isNotEmpty()) {
                                item {
                                    Surface(
                                        modifier = Modifier.fillMaxWidth(),
                                        color = MaterialTheme.colorScheme.surfaceVariant,
                                        shape = MaterialTheme.shapes.medium,
                                    ) {
                                        Column(modifier = Modifier.padding(12.dp)) {
                                            if (activeSession.title.isNotEmpty()) {
                                                Text(activeSession.title, style = MaterialTheme.typography.labelLarge)
                                            }
                                            if (activeSession.goalSummary.isNotEmpty()) {
                                                Text(
                                                    "Goal: ${activeSession.goalSummary}",
                                                    style = MaterialTheme.typography.bodySmall,
                                                    modifier = Modifier.padding(top = 4.dp),
                                                )
                                            }
                                            if (activeSession.assumptions.isNotEmpty()) {
                                                Text(
                                                    "Assumptions: ${activeSession.assumptions}",
                                                    style = MaterialTheme.typography.bodySmall,
                                                    modifier = Modifier.padding(top = 4.dp),
                                                )
                                            }
                                            if (activeSession.steps.isNotEmpty()) {
                                                Text(
                                                    "Steps:",
                                                    style = MaterialTheme.typography.labelSmall,
                                                    modifier = Modifier.padding(top = 8.dp),
                                                )
                                            }
                                            if (activeSession.currentModel != null) {
                                                Text(
                                                    "Model: ${activeSession.currentModel}",
                                                    style = MaterialTheme.typography.labelSmall,
                                                    modifier = Modifier.padding(top = 8.dp),
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                            itemsIndexed(activeSession.steps) { index, step ->
                                AutomatedWorkflowStepPreviewCard(index = index, step = step, sourceOptions = managedSources)
                            }
                            if (activeSession.steps.isNotEmpty() && activeSession.rawSpec != null) {
                                item {
                                    Button(
                                        onClick = {
                                            WsRepository.saveAutomatedWorkflowRun(
                                                projectId,
                                                activeSession.rawSpec,
                                                activeSession.currentModel,
                                                activeSession.savedRunId,
                                            )
                                        },
                                        enabled = !activeSession.saving,
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Text(
                                            when {
                                                activeSession.saving -> "Saving…"
                                                activeSession.savedRunId != null -> "Update saved workflow"
                                                else -> "Save workflow"
                                            },
                                        )
                                    }
                                }
                            }
                            items(activeSession.messages) { message ->
                                GeneratorChatBubble(role = message.role, text = message.text, isError = message.isError)
                            }
                            if (activeSession.streamingText.isNotEmpty()) {
                                item {
                                    GeneratorChatBubble(role = "assistant", text = activeSession.streamingText, streaming = true)
                                }
                            }
                        }

                        if (activeSession.isLoading && activeSession.streamingText.isEmpty()) {
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        }

                        if (!activeSession.isActive) {
                            Box(
                                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text("Workflow ended", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }

                if (session == null || activeSession?.isActive == true) {
                    ChatInputBar(
                        input = messageInput,
                        onInputChange = { messageInput = it },
                        attachments = emptyList(),
                        onRemoveAttachment = {},
                        canSend = messageInput.isNotBlank(),
                        onSend = { sendMessage() },
                        onAttachFile = {},
                        placeholder = if (session == null) "Describe the workflow you want…" else "Send message…",
                        showAttachOptions = false,
                        isListening = voiceInput.listening,
                        onVoiceInput = voiceInput.toggle,
                    )
                }
            }
        }
    }

    if (showModelSheet) {
        ModalBottomSheet(
            onDismissRequest = { showModelSheet = false },
            sheetState = modelSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ModelPickerSheet(
                qualifyCli = true,
                title = "Workflow generator model",
                models = models,
                cliStatus = cliStatus,
                selectedModelId = selectedModel,
                effectiveMode = effectiveMode,
                onSelect = { modelId ->
                    selectedModel = modelId
                    showModelSheet = false
                },
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AutomatedWorkflowStepPreviewCard(
    index: Int,
    step: AutomatedWorkflowStepInfo,
    sourceOptions: List<io.nexy.android.data.model.ManagedWorkflowSourceOption> = emptyList(),
) {
    val context = LocalContext.current
    val clipboardManager = context.getSystemService(ClipboardManager::class.java)
    // Exactly one of agentName/model applies — a step is fulfilled by EITHER an agent (its own
    // attached skills apply) OR a bare model (no skills at all). Never show both, never neither.
    val metaLine = buildString {
        if (step.kind != null) append("${step.kind.replaceFirstChar { it.uppercase() }} · ")
        append(step.agentName ?: step.model?.let { "Model: $it" } ?: if (step.kind != null) "Nexy managed step" else "Unassigned")
        if (step.expectedOutput.isNotBlank()) append(" · Output: ${step.expectedOutput}")
    }
    var showSourcePicker by remember(step.id) { mutableStateOf(false) }
    val distinctSources = sourceOptions.distinctBy { it.projectSourceId }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.small,
    ) {
        Column(modifier = Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("${index + 1}. ${step.title}", style = MaterialTheme.typography.labelMedium)
            Text(metaLine, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (step.summary.isNotBlank()) {
                Text(step.summary, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 2.dp))
            }
            if (step.kind == "collect") {
                Text(
                    if (step.includePaths.isEmpty()) "No source files selected" else step.includePaths.joinToString("\n"),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (step.includePaths.isEmpty()) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = { showSourcePicker = true }, enabled = sourceOptions.isNotEmpty()) {
                    Text(if (sourceOptions.isEmpty()) "No desktop project sources" else "Choose source files")
                }
            }
            if (step.kind == "publish") {
                Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    distinctSources.forEach { source ->
                        TextButton(onClick = {
                            WsRepository.updateManagedWorkflowDraftStep(step.id, publishProjectSourceId = source.projectSourceId)
                        }) { Text(if (source.projectSourceId == step.publishProjectSourceId) "✓ ${source.label}" else source.label) }
                    }
                }
                OutlinedTextField(
                    value = step.publishRelativePath.orEmpty(),
                    onValueChange = { WsRepository.updateManagedWorkflowDraftStep(step.id, publishRelativePath = it) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Project-relative destination") },
                )
            }
            if (step.prompt.isNotBlank()) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(
                        onClick = {
                            clipboardManager?.setPrimaryClip(ClipData.newPlainText("Workflow step prompt", step.prompt))
                        },
                    ) {
                        Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                        Text("Copy prompt")
                    }
                }
            }
        }
    }

    if (showSourcePicker) {
        ModalBottomSheet(onDismissRequest = { showSourcePicker = false }) {
            Text("Choose files to snapshot", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 520.dp)) {
                items(sourceOptions, key = { "${it.projectSourceId}:${it.relativePath}" }) { option ->
                    val selected = option.projectSourceId == step.projectSourceId && option.relativePath in step.includePaths
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = selected, onCheckedChange = { checked ->
                            val paths = if (option.projectSourceId != step.projectSourceId) {
                                if (checked) listOf(option.relativePath) else emptyList()
                            } else if (checked) (step.includePaths + option.relativePath).distinct() else step.includePaths - option.relativePath
                            WsRepository.updateManagedWorkflowDraftStep(
                                step.id, projectSourceId = option.projectSourceId, includePaths = paths,
                            )
                        })
                        Column(modifier = Modifier.weight(1f)) {
                            Text(option.relativePath, style = MaterialTheme.typography.bodySmall)
                            Text(option.label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            Button(onClick = { showSourcePicker = false }, modifier = Modifier.fillMaxWidth().padding(16.dp)) { Text("Done") }
        }
    }
}

@Composable
private fun SavedWorkflowRunListView(
    modifier: Modifier = Modifier,
    runs: List<AutomatedWorkflowRunInfo>,
    onOpen: (AutomatedWorkflowRunInfo) -> Unit,
    onDiscard: (AutomatedWorkflowRunInfo) -> Unit,
    onNewWorkflow: () -> Unit,
) {
    Column(modifier = modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = onNewWorkflow, modifier = Modifier.fillMaxWidth()) {
            Text("Start a new workflow")
        }
        if (runs.isEmpty()) {
            Text(
                "No saved workflows yet.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 16.dp),
            )
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(runs, key = { it.id }) { run ->
                    SavedWorkflowRunRow(run = run, onOpen = { onOpen(run) }, onDiscard = { onDiscard(run) })
                }
            }
        }
    }
}

@Composable
private fun SavedWorkflowRunRow(run: AutomatedWorkflowRunInfo, onOpen: () -> Unit, onDiscard: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.medium,
        onClick = onOpen,
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(run.title.ifBlank { "Untitled workflow" }, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                IconButton(onClick = onDiscard) {
                    Icon(Icons.Default.Delete, contentDescription = "Discard workflow", modifier = Modifier.size(18.dp))
                }
            }
            if (run.goalSummary.isNotBlank()) {
                Text(run.goalSummary, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            val inProgress = run.stepCounts.running + run.stepCounts.awaitingConfirmation
            Text(
                "${run.stepCounts.done}/${run.stepCounts.total} steps done" +
                    (if (inProgress > 0) " · $inProgress in progress" else "") +
                    (when (run.status) {
                        "done" -> " · Completed"
                        "failed" -> " · Failed"
                        else -> ""
                    }),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// Not private — reused by AutomatedWorkflowListScreen.kt's detail view for the global,
// top-level run list (same package, no export needed).
@Composable
internal fun SavedWorkflowRunDetailView(
    modifier: Modifier = Modifier,
    run: AutomatedWorkflowRunInfo,
    stepStreamText: Map<String, String>,
    onStart: () -> Unit,
    onModeChange: (String) -> Unit,
    onAbort: () -> Unit,
    onApprove: (AutomatedWorkflowRunStepData, String) -> Unit,
    onRetry: (AutomatedWorkflowRunStepData) -> Unit,
    onSkip: (AutomatedWorkflowRunStepData) -> Unit,
    onOpenConversation: (String) -> Unit,
    onRunAgain: (String) -> Unit = {},
) {
    val byStepKey = run.steps.associateBy { it.id }
    fun isSatisfied(key: String) = byStepKey[key]?.status.let { it == "done" || it == "skipped" }
    val runInProgress = run.status == "running" || run.status == "awaiting_confirmation"

    LazyColumn(modifier = modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (run.goalSummary.isNotBlank() || run.assumptions.isNotEmpty()) {
            item {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (run.goalSummary.isNotBlank()) Text("Goal: ${run.goalSummary}", style = MaterialTheme.typography.bodySmall)
                        if (run.assumptions.isNotEmpty()) {
                            Text("Assumptions: ${run.assumptions.joinToString(" • ")}", style = MaterialTheme.typography.bodySmall)
                        }
                        Text("${run.stepCounts.done}/${run.stepCounts.total} steps done", style = MaterialTheme.typography.labelSmall)
                        if (run.status == "failed" && !run.lastError.isNullOrBlank()) {
                            Text(run.lastError, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }
        if (run.status == "pending") {
            item {
                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                    listOf("gated" to "Confirm each step", "auto" to "Run automatically").forEachIndexed { i, (value, label) ->
                        SegmentedButton(
                            selected = run.confirmationMode == value,
                            onClick = { onModeChange(value) },
                            shape = SegmentedButtonDefaults.itemShape(index = i, count = 2),
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(
                                label,
                                style = MaterialTheme.typography.labelSmall,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
            item {
                Text(
                    "Choose how each step should run, then press Start. Each step's output appears below and also lives in its own conversation.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item {
                Button(onClick = onStart, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                    Text("Start workflow")
                }
            }
        } else {
            item {
                Text(
                    if (run.confirmationMode == "auto") "Ran automatically" else "Ran with step-by-step confirmation",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (runInProgress) {
            item {
                TextButton(onClick = onAbort) { Text("Abort run") }
            }
        }
        if (run.status == "done" || run.status == "failed" || run.status == "cancelled") {
            val templateId = run.templateId
            if (templateId != null) {
                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "This run has finished.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = { onRunAgain(templateId) }) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp).padding(end = 2.dp))
                            Text("Run again")
                        }
                    }
                }
            } else {
                item {
                    Text(
                        "This run has finished. To do this again, generate a new workflow from the list.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        itemsIndexed(run.steps) { _, step ->
            val waitingOn = step.dependsOnStepIds.filterNot(::isSatisfied).map { byStepKey[it]?.title ?: it }
            AutomatedWorkflowRunStepCard(
                step = step,
                waitingOn = waitingOn,
                streamingText = stepStreamText[step.dbId],
                onApprove = onApprove,
                onRetry = onRetry,
                onSkip = onSkip,
                onOpenConversation = onOpenConversation,
            )
        }
    }
}

@Composable
private fun AutomatedWorkflowRunStepCard(
    step: AutomatedWorkflowRunStepData,
    waitingOn: List<String>,
    streamingText: String?,
    onApprove: (AutomatedWorkflowRunStepData, String) -> Unit,
    onRetry: (AutomatedWorkflowRunStepData) -> Unit,
    onSkip: (AutomatedWorkflowRunStepData) -> Unit,
    onOpenConversation: (String) -> Unit,
) {
    var draftOutput by remember(step.dbId, step.output) { mutableStateOf(step.output) }

    Surface(modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.small) {
        Column(modifier = Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("${step.stepIndex + 1}. ${step.title}", style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                if (step.status == "running") {
                    CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                } else {
                    Text(
                        stepStatusLabel(step.status),
                        style = MaterialTheme.typography.labelSmall,
                        color = stepStatusColor(step.status),
                    )
                }
                if (step.conversationId != null) {
                    IconButton(onClick = { onOpenConversation(step.conversationId) }, modifier = Modifier.size(24.dp)) {
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = "Expand step in conversation",
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
            Text(
                // Exactly one of agentName/model applies — see AutomatedWorkflowStepPreviewCard's
                // comment for why a step never shows both or neither.
                buildString {
                    if (step.kind != null) append("${step.kind.replaceFirstChar { it.uppercase() }} · ")
                    append(step.agentName ?: step.model?.let { "Model: $it" } ?: if (step.kind != null) "Nexy managed step" else "Unassigned")
                },
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (waitingOn.isNotEmpty()) {
                Text(
                    "Waiting on: ${waitingOn.joinToString(", ")}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (step.status == "pending") {
                StepContentPreview(step.summary.ifBlank { "No details yet." })
            }

            when (step.status) {
                "running" -> {
                    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.extraSmall) {
                        StepContentPreview(
                            streamingText?.takeIf(String::isNotBlank) ?: "Starting…",
                            modifier = Modifier.padding(8.dp),
                        )
                    }
                }
                "awaiting_confirmation" -> {
                    when (step.kind) {
                        "review" -> ManagedWorkflowReviewControls(step)
                        "publish" -> ManagedWorkflowPublishControls(step)
                        else -> {
                            OutlinedTextField(
                                value = draftOutput,
                                onValueChange = { draftOutput = it },
                                modifier = Modifier.fillMaxWidth(),
                                minLines = 3,
                                maxLines = 8,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Button(onClick = { onApprove(step, draftOutput) }) { Text("Approve & continue") }
                                if (step.conversationId != null) {
                                    TextButton(onClick = { onOpenConversation(step.conversationId) }) {
                                        Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null, modifier = Modifier.padding(end = 4.dp).size(16.dp))
                                        Text("Open conversation")
                                    }
                                }
                            }
                        }
                    }
                }
                "failed" -> {
                    if (!step.error.isNullOrBlank()) {
                        StepContentPreview(step.error, color = MaterialTheme.colorScheme.error)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = { onRetry(step) }) { Text("Retry") }
                        if (step.kind == null || step.kind == "model") TextButton(onClick = { onSkip(step) }) { Text("Skip") }
                        if (step.conversationId != null) {
                            TextButton(onClick = { onOpenConversation(step.conversationId) }) { Text("Open conversation") }
                        }
                    }
                }
                "done" -> {
                    if (step.output.isNotBlank() || step.conversationId != null) {
                        var expanded by remember(step.dbId) { mutableStateOf(false) }
                        TextButton(onClick = { expanded = !expanded }) {
                            Text(if (expanded) "Hide output" else "View output", style = MaterialTheme.typography.labelSmall)
                        }
                        if (expanded) {
                            if (step.output.isNotBlank()) {
                                StepContentPreview(step.output)
                            }
                            if (step.conversationId != null) {
                                TextButton(onClick = { onOpenConversation(step.conversationId) }) { Text("Open conversation") }
                            }
                        }
                    }
                }
                "skipped" -> {
                    Text("You skipped this step.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                "cancelled" -> {
                    Text("This step was cancelled.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun ManagedWorkflowReviewControls(step: AutomatedWorkflowRunStepData) {
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val connected = connectionState == ConnectionState.CONNECTED
    val versions by WsRepository.managedWorkflowVersions.collectAsStateWithLifecycle()
    val currentVersionId = step.managed?.currentVersion?.id
    var selectedVersionId by remember(currentVersionId) { mutableStateOf(currentVersionId) }
    val selected = selectedVersionId?.let(versions::get)
    var draft by remember(selectedVersionId) { mutableStateOf("") }
    var loadedContent by remember(selectedVersionId) { mutableStateOf<String?>(null) }

    LaunchedEffect(selectedVersionId, connected) {
        if (connected && selectedVersionId != null && versions[selectedVersionId] == null) {
            WsRepository.getManagedWorkflowVersion(selectedVersionId!!)
        }
    }
    LaunchedEffect(selected?.content) {
        val content = selected?.content ?: return@LaunchedEffect
        if (loadedContent == null) {
            draft = content
            loadedContent = content
        }
    }

    if (!connected) {
        Text("Connect to your paired desktop to manage this workflow.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
    if (step.managed?.isStale == true) {
        Text("This deliverable is out of date and cannot be approved.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
    selected?.let { content ->
        Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            content.versions.forEach { version ->
                TextButton(onClick = { selectedVersionId = version.id; loadedContent = null }, enabled = connected) {
                    Text("v${version.versionNumber}")
                }
            }
        }
        Text("${content.version.title} · v${content.version.versionNumber}", style = MaterialTheme.typography.labelSmall)
    }
    OutlinedTextField(
        value = draft,
        onValueChange = { draft = it },
        modifier = Modifier.fillMaxWidth(),
        minLines = 6,
        maxLines = 14,
        enabled = connected && selected != null,
        label = { Text("Markdown") },
    )
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(
                onClick = {
                    if (currentVersionId != null) WsRepository.editManagedWorkflowVersion(step.runId, step.dbId, currentVersionId, draft)
                },
                enabled = connected && currentVersionId != null && draft != selected?.content,
            ) { Text("Save version") }
            Button(
                onClick = {
                    if (currentVersionId != null) WsRepository.reviewManagedWorkflowVersion(step.runId, step.dbId, currentVersionId, "approved")
                },
                enabled = connected && currentVersionId != null && selectedVersionId == currentVersionId &&
                    draft == selected?.content && step.managed?.isStale != true,
            ) { Text("Approve") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(
                onClick = {
                    if (currentVersionId != null) WsRepository.reviewManagedWorkflowVersion(step.runId, step.dbId, currentVersionId, "rejected")
                },
                enabled = connected && currentVersionId != null,
            ) { Text("Reject") }
            TextButton(onClick = { WsRepository.regenerateManagedWorkflow(step.runId, step.dbId) }, enabled = connected) {
                Text("Regenerate affected")
            }
        }
    }
    if (!step.managed?.bindings.isNullOrEmpty()) {
        Text("Provenance", style = MaterialTheme.typography.labelSmall)
        step.managed?.bindings?.forEach { binding ->
            Text(
                "${binding.direction} · ${binding.bindingName} · ${binding.artifactVersionId.take(12)}${if (binding.staleAt != null) " · stale" else ""}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ManagedWorkflowPublishControls(step: AutomatedWorkflowRunStepData) {
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val connected = connectionState == ConnectionState.CONNECTED
    val preview = step.managed?.publishPreview
    val idempotencyKey = remember(preview?.id) { "android:${step.runId}:${step.dbId}:${preview?.id}:${UUID.randomUUID()}" }
    if (!connected) {
        Text("Connect to your paired desktop to manage this workflow.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
    if (preview != null) {
        Text("Write approved version to ${preview.relativePath}", style = MaterialTheme.typography.bodySmall)
        Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.extraSmall) {
            SelectionContainer {
                Text(
                    preview.diffText.ifBlank { "No content changes." },
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(8.dp),
                )
            }
        }
        if (preview.invalidatedAt != null) {
            Text("The destination changed. Refresh the preview before publishing.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        }
        step.managed?.publishAction?.let { action ->
            Text("Publish status: ${action.status}${action.error?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.labelSmall)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(
                onClick = { WsRepository.refreshManagedPublishPreview(step.runId, step.dbId, preview.artifactVersionId) },
                enabled = connected,
            ) { Text("Refresh preview") }
            Button(
                onClick = { WsRepository.confirmManagedPublish(step.runId, step.dbId, preview.id, idempotencyKey) },
                enabled = connected && preview.invalidatedAt == null,
            ) { Text("Confirm file write") }
        }
    } else {
        Text("Preparing publish preview…", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun StepContentPreview(
    text: String,
    modifier: Modifier = Modifier,
    color: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified,
) {
    // Every step card reserves the same 5-line block for its body text regardless of
    // status, so cards don't jump around in height as a step's content streams in —
    // longer content truncates with an ellipsis rather than growing the card.
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = color,
        minLines = 5,
        maxLines = 5,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun stepStatusLabel(status: String): String = when (status) {
    "pending" -> "Not started"
    "running" -> "Running…"
    "awaiting_confirmation" -> "Needs review"
    "done" -> "Done"
    "failed" -> "Failed"
    "skipped" -> "Skipped"
    "cancelled" -> "Cancelled"
    else -> status.replace('_', ' ')
}

@Composable
private fun stepStatusColor(status: String) = when (status) {
    "awaiting_confirmation" -> MaterialTheme.colorScheme.tertiary
    "done" -> MaterialTheme.colorScheme.primary
    "failed" -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

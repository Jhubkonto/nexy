package io.nexy.android.ui.schedulegenerator

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import io.nexy.android.ui.chat.ChatAutoScrollEffect
import io.nexy.android.ui.chat.rememberChatAutoScrollState
import io.nexy.android.ui.chat.rememberRevealedText
import io.nexy.android.ui.chat.rememberStreamFadeAlpha
import io.nexy.android.ui.chat.streamFade
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.activity.ComponentActivity
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ScheduleGeneratorSpec
import io.nexy.android.ui.chat.ChatInputBar
import io.nexy.android.ui.chat.rememberOnDeviceVoiceInput
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyGhostButton
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyStepIndicator
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.components.NexyStaticProgressRecord
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import io.nexy.android.ui.model.activeModelLabel
import kotlinx.coroutines.launch

private val scheduleTypes = listOf("one-time", "daily", "weekdays", "weekly", "monthly")
private val notificationPrefs = listOf("always", "failures_only", "off")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleGeneratorScreen(
    onBack: () -> Unit,
    // Scoped to the hosting Activity (not the nav back-stack entry) so an in-progress
    // generation survives leaving and re-entering this screen instead of losing all state.
    viewModel: ScheduleGeneratorViewModel = viewModel(LocalContext.current as ComponentActivity),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val models by WsRepository.models.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var input by remember { mutableStateOf("") }
    var confirmReset by remember { mutableStateOf(false) }
    var showModelSheet by remember { mutableStateOf(false) }
    val voiceInput = rememberOnDeviceVoiceInput(
        onText = { text -> input = if (input.isBlank()) text else "${input.trimEnd()} $text" },
        onError = { message -> scope.launch { snackbarHostState.showSnackbar(message) } },
    )
    val displayModelId = uiState.selectedModel ?: uiState.resolvedModel
    val activeModelLabel = if (displayModelId != null) activeModelLabel(displayModelId, models) else "Default model"

    LaunchedEffect(Unit) {
        WsRepository.send("model:list", emptyMap())
    }

    LaunchedEffect(uiState.promptInsert) {
        val (_, text) = uiState.promptInsert ?: return@LaunchedEffect
        input = if (input.isBlank()) text else "$input\n$text"
    }

    LaunchedEffect(uiState.error) {
        val err = uiState.error ?: return@LaunchedEffect
        val result = snackbarHostState.showSnackbar(message = err, actionLabel = "Retry", withDismissAction = true)
        if (result == androidx.compose.material3.SnackbarResult.ActionPerformed) viewModel.retryLastMessage()
        viewModel.dismissError()
    }

    // The toolbar's onBack below now steps out of SPEC_REVIEW back to CHAT instead of always
    // exiting the screen; this catches the system/gesture back button the same way.
    BackHandler(enabled = uiState.phase == ScheduleGenPhase.SPEC_REVIEW) { viewModel.backToChat() }

    if (confirmReset) {
        NexyConfirmDialog(
            title = "Start over?",
            message = "The current Schedule Generator session will be cleared.",
            confirmLabel = "Start over",
            destructive = true,
            onConfirm = {
                confirmReset = false
                viewModel.reset()
            },
            onDismiss = { confirmReset = false },
        )
    }

    if (showModelSheet) {
        androidx.compose.material3.ModalBottomSheet(onDismissRequest = { showModelSheet = false }) {
            io.nexy.android.ui.chat.ModelPickerSheet(
                qualifyCli = true,
                title = "Generation model", models = models, cliStatus = emptyMap(),
                selectedModelId = uiState.selectedModel,
                onSelect = { model -> viewModel.setModel(model); showModelSheet = false },
            )
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Schedule Generator", style = MaterialTheme.typography.titleMedium) },
                onBack = if (uiState.phase == ScheduleGenPhase.SPEC_REVIEW) { { viewModel.backToChat() } } else onBack,
                actions = {
                    TextButton(onClick = {
                        WsRepository.send("model:list", emptyMap())
                        showModelSheet = true
                    }) {
                        NexyIcon(NexyIconName.Settings, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.size(4.dp))
                        Text(activeModelLabel, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (uiState.phase != ScheduleGenPhase.CHAT || uiState.messages.size > 1 || uiState.streamingText.isNotBlank()) {
                        NexyGhostButton(text = "Start over", onClick = { confirmReset = true })
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            NexyStepIndicator(
                steps = listOf("Describe", "Review", "Done"),
                currentStep = uiState.phase.ordinal,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            when (uiState.phase) {
                ScheduleGenPhase.CHAT -> ChatPhase(uiState = uiState, modifier = Modifier.weight(1f))
                ScheduleGenPhase.SPEC_REVIEW -> SpecReviewPhase(
                    spec = uiState.pendingSpec,
                    isLoading = uiState.isLoading,
                    onSpecChange = { viewModel.updateSpec(it) },
                    onConfirm = { viewModel.confirmSpec() },
                    onBack = { viewModel.backToChat() },
                    modifier = Modifier.weight(1f),
                )
                ScheduleGenPhase.DONE -> DonePhase(
                    taskName = uiState.createdTaskName.orEmpty(),
                    onDone = onBack,
                    modifier = Modifier.weight(1f),
                )
            }
            if (uiState.phase == ScheduleGenPhase.CHAT) {
                ChatInputBar(
                    input = input,
                    onInputChange = { input = it },
                    attachments = emptyList(),
                    onRemoveAttachment = {},
                    canSend = input.isNotBlank() && !uiState.isLoading,
                    onSend = { viewModel.sendMessage(input.trim()); input = "" },
                    onAttachFile = {},
                    onInsertPrompt = { WsRepository.listPrompts() },
                    placeholder = "Describe your schedule...",
                    onSetupManually = { viewModel.setupManually() },
                    showAttachOptions = false,
                    isListening = voiceInput.listening,
                    onVoiceInput = voiceInput.toggle,
                )
            }
        }
    }
}

@Composable
private fun ChatPhase(uiState: ScheduleGeneratorUiState, modifier: Modifier = Modifier) {
    val autoScroll = rememberChatAutoScrollState()
    ChatAutoScrollEffect(autoScroll, uiState.messages.size to uiState.streamingText)

    LazyColumn(
        state = autoScroll.listState,
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(uiState.messages) { message ->
            Text(
                text = message.content.replace(Regex("<schedule-spec>[\\s\\S]*?</schedule-spec>"), "").trim(),
                style = MaterialTheme.typography.bodyMedium,
                color = if (message.role == "user") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            )
        }
        if (uiState.streamingText.isNotBlank()) {
            item {
                val fullText = uiState.streamingText.replace(Regex("<schedule-spec>[\\s\\S]*?</schedule-spec>"), "").trim()
                val displayText = rememberRevealedText(fullText)
                val fadeAlpha = rememberStreamFadeAlpha(displayText.length)
                Text(
                    displayText,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.streamFade(fadeAlpha),
                )
            }
        } else if (uiState.isLoading) {
            item { NexyStaticProgressRecord(modifier = Modifier.fillMaxWidth()) }
        }
    }
}

@Composable
private fun SpecReviewPhase(
    spec: ScheduleGeneratorSpec?,
    isLoading: Boolean,
    onSpecChange: (ScheduleGeneratorSpec) -> Unit,
    onConfirm: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val current = spec ?: return
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Review scheduled task", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        OutlinedTextField(
            value = current.name,
            onValueChange = { onSpecChange(current.copy(name = it)) },
            label = { Text("Name") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
        )
        OutlinedTextField(
            value = current.prompt,
            onValueChange = { onSpecChange(current.copy(prompt = it)) },
            label = { Text("Prompt") },
            modifier = Modifier.fillMaxWidth(),
            minLines = 4,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
        )
        ChoiceRow("Schedule type", scheduleTypes, current.scheduleType) { onSpecChange(current.copy(scheduleType = it)) }
        OutlinedTextField(
            value = current.localTime,
            onValueChange = { onSpecChange(current.copy(localTime = it)) },
            label = { Text("Local time (HH:MM)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        OutlinedTextField(
            value = current.timezone,
            onValueChange = { onSpecChange(current.copy(timezone = it)) },
            label = { Text("Timezone") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        if (current.scheduleType == "weekly") {
            OutlinedTextField(
                value = (current.weekday ?: 1).toString(),
                onValueChange = { onSpecChange(current.copy(weekday = it.toIntOrNull())) },
                label = { Text("Weekday (0-6)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
        }
        if (current.scheduleType == "monthly") {
            OutlinedTextField(
                value = (current.monthDay ?: 1).toString(),
                onValueChange = { onSpecChange(current.copy(monthDay = it.toIntOrNull())) },
                label = { Text("Month day") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
        }
        ChoiceRow("Notifications", notificationPrefs, current.notificationPref) { onSpecChange(current.copy(notificationPref = it)) }
        OutlinedTextField(
            value = current.agentId.orEmpty(),
            onValueChange = { onSpecChange(current.copy(agentId = it.ifBlank { null })) },
            label = { Text("Agent ID (optional)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        OutlinedTextField(
            value = current.projectId.orEmpty(),
            onValueChange = { onSpecChange(current.copy(projectId = it.ifBlank { null })) },
            label = { Text("Project ID (optional)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            NexySecondaryButton(text = "Back to chat", onClick = onBack, modifier = Modifier.weight(1f))
            NexyPrimaryButton(
                text = if (isLoading) "Creating..." else "Create task",
                onClick = onConfirm,
                enabled = !isLoading && current.name.isNotBlank() && current.prompt.isNotBlank(),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun ChoiceRow(label: String, choices: List<String>, selected: String, onSelect: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
            choices.forEach { choice ->
                OutlinedButton(
                    onClick = { onSelect(choice) },
                    modifier = Modifier.weight(1f),
                    enabled = selected != choice,
                ) {
                    Text(choice.replace("_", " "), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun DonePhase(taskName: String, onDone: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        NexyIcon(NexyIconName.Scheduled, contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(12.dp))
        Text("Scheduled task created", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(taskName.ifBlank { "Your task" }, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(20.dp))
        NexyPrimaryButton(text = "Done", onClick = onDone, modifier = Modifier.fillMaxWidth())
    }
}

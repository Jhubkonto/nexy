package io.nexy.android.ui.artifactgenerator

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import io.nexy.android.ui.chat.ChatInputBar
import io.nexy.android.ui.chat.rememberOnDeviceVoiceInput
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.activity.ComponentActivity
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.isVisibleInProject
import io.nexy.android.data.model.ArtifactGeneratorSpec
import io.nexy.android.data.model.Project
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArtifactGeneratorScreen(
    onBack: () -> Unit,
    onViewArtifacts: () -> Unit = {},
    // Scoped to the hosting Activity (not the nav back-stack entry) so an in-progress
    // generation survives leaving and re-entering this screen instead of losing all state.
    vm: ArtifactGeneratorViewModel = viewModel(LocalContext.current as ComponentActivity),
) {
    val uiState by vm.uiState.collectAsStateWithLifecycle()
    val models by WsRepository.models.collectAsStateWithLifecycle()
    var confirmReset by remember { mutableStateOf(false) }
    var showPromptSheet by remember { mutableStateOf(false) }
    var showModelSheet by remember { mutableStateOf(false) }
    var modelQuery by remember { mutableStateOf("") }
    val promptSheetState = rememberModalBottomSheetState()
    val modelSheetState = rememberModalBottomSheetState()
    val promptEntries by WsRepository.promptEntries.collectAsStateWithLifecycle()
    val globalPromptEntries = promptEntries.filter { it.isVisibleInProject(null) }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    var input by remember { mutableStateOf("") }
    val voiceInput = rememberOnDeviceVoiceInput(
        onText = { text -> input = if (input.isBlank()) text else "${input.trimEnd()} $text" },
        onError = { message -> scope.launch { snackbarHostState.showSnackbar(message) } },
    )

    val displayModelId = uiState.selectedModel ?: uiState.resolvedModel
    val activeModelLabel = if (displayModelId != null) activeModelLabel(displayModelId, models) else "Default model"

    LaunchedEffect(uiState.promptInsert) {
        val (_, text) = uiState.promptInsert ?: return@LaunchedEffect
        input = if (input.isBlank()) text else "$input\n$text"
    }

    LaunchedEffect(Unit) {
        WsRepository.send("model:list", emptyMap())
    }

    LaunchedEffect(uiState.error) {
        val err = uiState.error ?: return@LaunchedEffect
        val result = snackbarHostState.showSnackbar(
            message = err,
            actionLabel = "Retry",
            withDismissAction = true,
        )
        if (result == SnackbarResult.ActionPerformed) {
            vm.retryLastMessage()
        }
        vm.dismissError()
    }

    // The toolbar's onBack below now steps out of SPEC_REVIEW back to CHAT instead of always
    // exiting the screen; this catches the system/gesture back button the same way.
    BackHandler(enabled = uiState.phase == ArtifactGenPhase.SPEC_REVIEW) { vm.backToChat() }

    if (confirmReset) {
        NexyConfirmDialog(
            title = "Start over?",
            message = "The current Artifact Generator session will be cleared.",
            confirmLabel = "Start over",
            destructive = true,
            onConfirm = {
                confirmReset = false
                vm.reset()
            },
            onDismiss = { confirmReset = false },
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Artifact Generator", style = MaterialTheme.typography.titleMedium) },
                onBack = if (uiState.phase == ArtifactGenPhase.SPEC_REVIEW) { { vm.backToChat() } } else onBack,
                actions = {
                    TextButton(onClick = { WsRepository.send("model:list", emptyMap()); showModelSheet = true }) {
                        NexyIcon(
                            NexyIconName.Settings,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            activeModelLabel,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 100.dp),
                        )
                    }
                    if (uiState.phase != ArtifactGenPhase.CHAT || uiState.messages.size > 1 || uiState.streamingText.isNotBlank()) {
                        NexyGhostButton(text = "Reset", onClick = { confirmReset = true })
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
                ArtifactGenPhase.CHAT -> ChatPhase(
                    uiState = uiState,
                    modifier = Modifier.weight(1f),
                )
                ArtifactGenPhase.SPEC_REVIEW -> SpecReviewPhase(
                    spec = uiState.pendingSpec,
                    isLoading = uiState.isLoading,
                    onSpecChange = { vm.updateSpec(it) },
                    onConfirm = { vm.confirmSpec() },
                    onBack = { vm.backToChat() },
                    modifier = Modifier.weight(1f),
                )
                ArtifactGenPhase.DONE -> DonePhase(
                    uiState = uiState,
                    onReset = { vm.reset() },
                    onViewArtifacts = onViewArtifacts,
                    onMoveToProject = { projectId -> vm.moveToProject(projectId) },
                    modifier = Modifier.weight(1f),
                )
            }
            if (uiState.phase == ArtifactGenPhase.CHAT) {
                ChatInputBar(
                    input = input,
                    onInputChange = { input = it },
                    attachments = emptyList(),
                    onRemoveAttachment = {},
                    canSend = input.isNotBlank() && !uiState.isLoading,
                    onSend = { vm.sendMessage(input.trim()); input = "" },
                    onAttachFile = {},
                    onInsertPrompt = { WsRepository.listPrompts(); showPromptSheet = true },
                    placeholder = "Describe your artifact…",
                    showAttachOptions = false,
                    isListening = voiceInput.listening,
                    onVoiceInput = voiceInput.toggle,
                )
            }
        }
    }

    if (showPromptSheet) {
        ModalBottomSheet(
            onDismissRequest = { showPromptSheet = false },
            sheetState = promptSheetState,
        ) {
            Text(
                "Insert prompt",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            if (globalPromptEntries.isEmpty()) {
                Text(
                    "No prompts saved yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp),
                )
            } else {
                LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                    items(globalPromptEntries) { prompt ->
                        ListItem(
                            headlineContent = { Text(prompt.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            supportingContent = {
                                Text(prompt.body, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                    style = MaterialTheme.typography.bodySmall)
                            },
                            modifier = Modifier.clickable {
                                vm.insertPromptText(prompt.body)
                                showPromptSheet = false
                            },
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }

    if (showModelSheet) {
        ModalBottomSheet(
            onDismissRequest = { showModelSheet = false; modelQuery = "" },
            sheetState = modelSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            data class ModelItem(val model: io.nexy.android.data.model.ModelOption)
            data class HeaderItem(val vendor: String)

            val query = modelQuery.trim().lowercase()
            val showDefault = query.isEmpty() || "default model".contains(query)
            val sheetItems: List<Any> = buildList {
                val grouped = models.filterNot { it.id == "default" }.groupBy { it.vendor ?: "" }
                val hasVendorGroups = grouped.any { it.key.isNotBlank() }
                if (hasVendorGroups) {
                    grouped.forEach { (vendor, vendorModels) ->
                        val filtered = if (query.isEmpty()) vendorModels
                                       else vendorModels.filter { it.label.lowercase().contains(query) }
                        if (filtered.isNotEmpty()) {
                            if (vendor.isNotBlank()) add(HeaderItem(vendor))
                            filtered.forEach { add(ModelItem(it)) }
                        }
                    }
                } else {
                    models.filterNot { it.id == "default" }.forEach { model ->
                        if (query.isEmpty() || model.label.lowercase().contains(query)) {
                            add(ModelItem(model))
                        }
                    }
                }
            }

            LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                item {
                    Text(
                        "Generation model",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                    )
                    OutlinedTextField(
                        value = modelQuery,
                        onValueChange = { modelQuery = it },
                        placeholder = { Text("Search models…", style = MaterialTheme.typography.bodyMedium) },
                        leadingIcon = { NexyIcon(NexyIconName.Search, contentDescription = null, modifier = Modifier.size(20.dp)) },
                        trailingIcon = {
                            if (modelQuery.isNotEmpty()) {
                                IconButton(onClick = { modelQuery = "" }) {
                                    NexyIcon(NexyIconName.Close, contentDescription = "Clear", modifier = Modifier.size(18.dp))
                                }
                            }
                        },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        shape = MaterialTheme.shapes.medium,
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(top = 4.dp))
                }
                if (showDefault) {
                    item {
                        ListItem(
                            headlineContent = { Text("Default model") },
                            modifier = Modifier.clickable {
                                vm.setModel(null)
                                modelQuery = ""
                                scope.launch { modelSheetState.hide() }.invokeOnCompletion { showModelSheet = false }
                            },
                            trailingContent = if (uiState.selectedModel == null) ({ Text("✓", color = MaterialTheme.colorScheme.primary) }) else null,
                        )
                    }
                }
                items(sheetItems) { item ->
                    when (item) {
                        is HeaderItem -> Text(
                            item.vendor,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                        )
                        is ModelItem -> ListItem(
                            headlineContent = { Text(item.model.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            modifier = Modifier.clickable {
                                vm.setModel(item.model.id)
                                modelQuery = ""
                                scope.launch { modelSheetState.hide() }.invokeOnCompletion { showModelSheet = false }
                            },
                            trailingContent = if (item.model.id == uiState.selectedModel) ({ Text("✓", color = MaterialTheme.colorScheme.primary) }) else null,
                        )
                    }
                }
                if (sheetItems.isEmpty() && !showDefault) {
                    item {
                        Text(
                            "No models match \"$modelQuery\"",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatPhase(
    uiState: ArtifactGeneratorUiState,
    modifier: Modifier = Modifier,
) {
    val autoScroll = rememberChatAutoScrollState()
    val listState = autoScroll.listState
    ChatAutoScrollEffect(autoScroll, uiState.messages.size to uiState.streamingText)

    Column(modifier = modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(uiState.messages) { msg ->
                ChatBubble(role = msg.role, text = msg.content)
            }
            if (uiState.streamingText.isNotBlank()) {
                item { ChatBubble(role = "assistant", text = uiState.streamingText, streaming = true) }
            }
        }

        if (uiState.isLoading) {
            NexyStaticProgressRecord(modifier = Modifier.fillMaxWidth())
        }

        if (uiState.missedSpec) {
            Surface(color = MaterialTheme.colorScheme.tertiaryContainer, modifier = Modifier.fillMaxWidth()) {
                Text(
                    "No spec was generated — try describing the artifact in more detail.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun ChatBubble(role: String, text: String, streaming: Boolean = false) {
    val isUser = role == "user"
    val displayText = if (streaming) rememberRevealedText(text) else text
    val fadeAlpha = if (streaming) rememberStreamFadeAlpha(displayText.length) else 1f
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            shape = MaterialTheme.shapes.extraSmall,
            border = BorderStroke(2.dp, MaterialTheme.colorScheme.outline),
            color = if (isUser) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.fillMaxWidth(0.85f),
        ) {
            Text(
                text = displayText + if (streaming) "▍" else "",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(12.dp).streamFade(fadeAlpha),
                color = if (isUser) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun SpecReviewPhase(
    spec: ArtifactGeneratorSpec?,
    isLoading: Boolean,
    onSpecChange: (ArtifactGeneratorSpec) -> Unit,
    onConfirm: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
    ) {
        Text("Review Artifact Spec", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))

        if (spec == null) {
            Text("No spec generated yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            OutlinedTextField(
                value = spec.title,
                onValueChange = { onSpecChange(spec.copy(title = it)) },
                label = { Text("Title") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            SpecField("Kind", spec.kind)
            SpecField("Intended use", spec.intendedUse.ifBlank { "—" })
            if (!spec.audience.isNullOrBlank()) SpecField("Audience", spec.audience)
            Spacer(Modifier.height(8.dp))
            if (spec.outputFiles.isNotEmpty()) {
                Text("Output files", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                spec.outputFiles.forEach { f ->
                    Text(
                        "• ${f.path} (${f.mediaType}, ${f.role})",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(start = 8.dp, top = 2.dp),
                    )
                }
                Spacer(Modifier.height(8.dp))
            }
            if (spec.acceptanceCriteria.isNotEmpty()) {
                Text("Acceptance criteria", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                spec.acceptanceCriteria.forEach { c ->
                    Text(
                        "• $c",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(start = 8.dp, top = 2.dp),
                    )
                }
                Spacer(Modifier.height(8.dp))
            }
            if (spec.exportFormats.isNotEmpty()) {
                SpecField("Export formats", spec.exportFormats.joinToString(", "))
            }
        }

        Spacer(Modifier.height(24.dp))

        if (isLoading) {
            NexyStaticProgressRecord(modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            Text("Preparing…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                NexySecondaryButton(text = "Back", onClick = onBack)
                NexyPrimaryButton(text = "Generate artifact", onClick = onConfirm, enabled = spec != null)
            }
        }
    }
}

@Composable
private fun SpecField(label: String, value: String) {
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DonePhase(
    uiState: ArtifactGeneratorUiState,
    onReset: () -> Unit,
    onViewArtifacts: () -> Unit,
    onMoveToProject: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    var showProjectPicker by remember { mutableStateOf(false) }
    val projectSheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()

    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Artifact Created!", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        if (!uiState.createdArtifactTitle.isNullOrBlank()) {
            Text(
                uiState.createdArtifactTitle,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(8.dp))
        }
        if (uiState.movedToProjectId != null) {
            val projectName = projects.find { it.id == uiState.movedToProjectId }?.name ?: "project"
            Text(
                "Added to $projectName",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(8.dp))
        }
        Text(
            "The artifact has been generated and saved.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        NexyPrimaryButton(text = "View artifacts", onClick = onViewArtifacts, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        NexySecondaryButton(
            text = if (uiState.movedToProjectId != null) "Change project" else "Add to project",
            onClick = { showProjectPicker = true },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        NexySecondaryButton(text = "Generate another artifact", onClick = onReset, modifier = Modifier.fillMaxWidth())
    }

    if (showProjectPicker) {
        ModalBottomSheet(
            onDismissRequest = { showProjectPicker = false },
            sheetState = projectSheetState,
        ) {
            Text(
                "Add to project",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            if (projects.isEmpty()) {
                Text(
                    "No projects available.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp),
                )
            } else {
                LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                    items(projects) { project ->
                        ListItem(
                            headlineContent = { Text(project.name) },
                            modifier = Modifier.clickable {
                                onMoveToProject(project.id)
                                scope.launch { projectSheetState.hide() }.invokeOnCompletion { showProjectPicker = false }
                            },
                            trailingContent = if (uiState.movedToProjectId == project.id) ({
                                Text("✓", color = MaterialTheme.colorScheme.primary)
                            }) else null,
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }
}

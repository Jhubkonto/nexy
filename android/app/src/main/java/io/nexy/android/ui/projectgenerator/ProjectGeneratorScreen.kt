package io.nexy.android.ui.projectgenerator

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
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
import io.nexy.android.data.model.ProjectGeneratorSpec
import io.nexy.android.ui.components.GeneratorChatBubble
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyGhostButton
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyStepIndicator
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.model.activeModelLabel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectGeneratorScreen(
    onBack: () -> Unit,
    // Scoped to the hosting Activity (not the nav back-stack entry) so an in-progress
    // generation survives leaving and re-entering this screen instead of losing all state.
    vm: ProjectGeneratorViewModel = viewModel(LocalContext.current as ComponentActivity),
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
    BackHandler(enabled = uiState.phase == ProjectGenPhase.SPEC_REVIEW) { vm.backToChat() }

    if (confirmReset) {
        NexyConfirmDialog(
            title = "Start over?",
            message = "The current Project Generator session will be cleared.",
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
                titleContent = { Text("Project Generator", style = MaterialTheme.typography.titleMedium) },
                onBack = if (uiState.phase == ProjectGenPhase.SPEC_REVIEW) { { vm.backToChat() } } else onBack,
                actions = {
                    TextButton(onClick = { WsRepository.send("model:list", emptyMap()); showModelSheet = true }) {
                        Icon(
                            Icons.Default.Tune,
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
                    if (uiState.phase != ProjectGenPhase.CHAT || uiState.messages.size > 1 || uiState.streamingText.isNotBlank()) {
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
                ProjectGenPhase.CHAT -> ChatPhase(
                    uiState = uiState,
                    modifier = Modifier.weight(1f),
                )
                ProjectGenPhase.SPEC_REVIEW -> SpecReviewPhase(
                    spec = uiState.pendingSpec,
                    isLoading = uiState.isLoading,
                    onSpecChange = { vm.updateSpec(it) },
                    onConfirm = { vm.confirmSpec() },
                    onBack = { vm.backToChat() },
                    modifier = Modifier.weight(1f),
                )
                ProjectGenPhase.DONE -> DonePhase(
                    projectName = uiState.createdProjectName.orEmpty(),
                    onReset = { vm.reset() },
                    modifier = Modifier.weight(1f),
                )
            }
            if (uiState.phase == ProjectGenPhase.CHAT) {
                ChatInputBar(
                    input = input,
                    onInputChange = { input = it },
                    attachments = emptyList(),
                    onRemoveAttachment = {},
                    canSend = input.isNotBlank() && !uiState.isLoading,
                    onSend = { vm.sendMessage(input.trim()); input = "" },
                    onAttachFile = {},
                    onInsertPrompt = { WsRepository.listPrompts(); showPromptSheet = true },
                    placeholder = "Describe your project…",
                    onSetupManually = { vm.setupManually() },
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
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(20.dp)) },
                        trailingIcon = {
                            if (modelQuery.isNotEmpty()) {
                                IconButton(onClick = { modelQuery = "" }) {
                                    Icon(Icons.Default.Close, contentDescription = "Clear", modifier = Modifier.size(18.dp))
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
    uiState: ProjectGeneratorUiState,
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
                GeneratorChatBubble(role = msg.role, text = msg.content)
            }
            if (uiState.streamingText.isNotBlank()) {
                item {
                    GeneratorChatBubble(role = "assistant", text = uiState.streamingText, streaming = true)
                }
            }
        }

        if (uiState.isLoading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }

        if (uiState.missedSpec) {
            Surface(
                color = MaterialTheme.colorScheme.tertiaryContainer,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    "No spec was generated — try asking me to set up the project.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun SpecReviewPhase(
    spec: ProjectGeneratorSpec?,
    isLoading: Boolean,
    onSpecChange: (ProjectGeneratorSpec) -> Unit,
    onConfirm: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
    ) {
        Text("Review Project Spec", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))

        if (spec == null) {
            Text("No spec generated yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            OutlinedTextField(
                value = spec.name,
                onValueChange = { onSpecChange(spec.copy(name = it)) },
                label = { Text("Name") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
            )
            Spacer(Modifier.height(8.dp))
            SpecField("Color", spec.color)
            OutlinedTextField(
                value = spec.rootDirectory.orEmpty(),
                onValueChange = { onSpecChange(spec.copy(rootDirectory = it.ifBlank { null })) },
                label = { Text("Primary desktop source (optional)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Text(
                if (spec.sources.isEmpty() && spec.rootDirectory.isNullOrBlank())
                    "You can create an unbound project now and attach repository folders from Nexy Desktop later."
                else "Source paths are resolved and validated by Nexy Desktop.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (spec.sources.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text("Sources", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                spec.sources.forEach { source ->
                    val location = source.localPath ?: source.remoteUrl ?: "Desktop setup required"
                    Text("• ${source.label}: $location", style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = spec.instructions,
                onValueChange = { onSpecChange(spec.copy(instructions = it)) },
                label = { Text("Instructions") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                maxLines = 6,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
            )
            Spacer(Modifier.height(8.dp))
            InstructionModePicker(
                selected = spec.instructionMode ?: "prepend",
                onChange = { onSpecChange(spec.copy(instructionMode = it)) },
            )
            if (!spec.defaultModel.isNullOrBlank()) SpecField("Default model", spec.defaultModel)
            if (spec.variables.isNotEmpty()) {
                SpecListField("Variables", spec.variables.map { v -> "${v["key"].orEmpty()}=${v["value"].orEmpty()}" })
            }
            if (spec.inScope.isNotEmpty()) {
                SpecListField("In scope", spec.inScope.map { scope ->
                    val glob = scope["pathGlob"].orEmpty()
                    if (glob.isBlank()) scope["description"].orEmpty() else "${scope["description"].orEmpty()} ($glob)"
                })
            }
            if (spec.outOfScope.isNotEmpty()) {
                SpecListField("Out of scope", spec.outOfScope.mapNotNull { it["description"] })
            }
            if (spec.milestones.isNotEmpty()) {
                SpecListField("Milestones", spec.milestones.mapNotNull { it["title"] })
            }
            if (spec.agents.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text("Agents", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                spec.agents.forEach { agent ->
                    val label = buildString {
                        append(if (agent.existingAgentId != null) "Existing " else agent.newAgent?.icon?.let { "$it " }.orEmpty())
                        append(agent.newAgent?.name ?: agent.role)
                        if (agent.isLeader) append(" (leader)")
                    }
                    Text("• $label", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        if (isLoading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            Text("Creating project…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            val canCreate = spec?.name?.isNotBlank() == true
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                NexySecondaryButton(text = "Back", onClick = onBack)
                NexyPrimaryButton(text = "Create project", onClick = onConfirm, enabled = canCreate)
            }
        }
    }
}

@Composable
private fun InstructionModePicker(
    selected: String,
    onChange: (String) -> Unit,
) {
    val options = listOf("prepend", "append", "replace", "standalone")
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Text("Instruction mode", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            options.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    row.forEach { option ->
                        if (selected == option) {
                            Button(onClick = { onChange(option) }, modifier = Modifier.weight(1f)) { Text(option, maxLines = 1) }
                        } else {
                            OutlinedButton(onClick = { onChange(option) }, modifier = Modifier.weight(1f)) { Text(option, maxLines = 1) }
                        }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
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

@Composable
private fun SpecListField(label: String, items: List<String>) {
    if (items.isEmpty()) return
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        items.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
    }
}

@Composable
private fun DonePhase(
    projectName: String,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Project Created!", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        if (projectName.isNotBlank()) {
            Text(
                "\"$projectName\" is ready. Head to the Projects tab to start chatting.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(24.dp))
        NexyPrimaryButton(text = "Generate another project", onClick = onReset)
    }
}

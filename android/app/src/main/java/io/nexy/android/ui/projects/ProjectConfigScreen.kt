package io.nexy.android.ui.projects

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.ProjectAgentEntry
import io.nexy.android.data.model.ProjectSettingsConfig
import io.nexy.android.data.model.ProjectSource
import io.nexy.android.data.model.ProjectRepositoryBinding
import io.nexy.android.data.model.CapabilityMcpGrant
import io.nexy.android.data.model.CapabilityProfile
import io.nexy.android.data.model.CapabilityBuiltInToolPolicy
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NewChatItem
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.components.NexyExpandableSection
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.settings.SettingsNavRow
import io.nexy.android.ui.chat.ModelPickerSheet
import io.nexy.android.ui.chat.capabilityTrustOptions
import io.nexy.android.ui.model.activeModelLabel
import io.nexy.android.ui.home.projectColor
import io.nexy.android.ui.home.projectColorOptions
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import kotlinx.coroutines.launch

private val instructionModeOptions = listOf(
    "prepend" to "Prepend",
    "append" to "Append",
    "replace" to "Replace",
    "standalone" to "Standalone",
)

private val workflowModeOptions = listOf(
    "single-agent" to "Single",
    "automated-delegation" to "Automated",
    "orchestrated" to "Orchestrated",
)

private val instructionModeDescriptions = mapOf(
    "prepend" to "Project instructions come first, before the agent's own system instructions and your message.",
    "append" to "Project instructions are inserted right after the agent's own system instructions, before your message.",
    "replace" to "Project instructions take the place of the agent's own system instructions for chats in this project.",
    "standalone" to "Currently behaves the same as Replace: project instructions take the place of the agent's own system instructions.",
)

private val thinkingEffortOptions = listOf(
    null to "Agent default",
    "disabled" to "Disabled",
    "low" to "Low",
    "medium" to "Medium",
    "high" to "High",
    "max" to "Max",
)

private val milestoneStatuses = listOf("upcoming", "active", "completed")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectConfigScreen(
    projectId: String,
    onBack: () -> Unit,
    isNew: Boolean = false,
    onOpenFileExplorer: (String) -> Unit = {},
    onAddSourceFolder: () -> Unit = {},
    onOpenMcpServers: () -> Unit = {},
) {
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val allAgents by WsRepository.agents.collectAsStateWithLifecycle()
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val models by WsRepository.models.collectAsStateWithLifecycle()
    val cliStatus by WsRepository.cliStatus.collectAsStateWithLifecycle()
    val hermesInfo by WsRepository.hermesInfo.collectAsStateWithLifecycle()
    val effectiveMode by WsRepository.effectiveMode.collectAsStateWithLifecycle()
    val availableSkills by WsRepository.skills.collectAsStateWithLifecycle()
    val availableMcpServers by WsRepository.mcpServers.collectAsStateWithLifecycle()
    val project = projects.find { it.id == projectId }

    var color by remember(projectId) { mutableStateOf(project?.color ?: "blue") }
    var customColorHex by remember(projectId) { mutableStateOf("") }
    var instructions by remember { mutableStateOf("") }
    var rootDirectory by rememberSaveable(projectId) { mutableStateOf("") }
    var projectSources by remember { mutableStateOf<List<ProjectSource>>(emptyList()) }
    var projectRepositories by remember { mutableStateOf<List<ProjectRepositoryBinding>>(emptyList()) }
    var instructionMode by remember { mutableStateOf("prepend") }
    var instructionsEnabled by remember { mutableStateOf(true) }
    var workflowMode by remember { mutableStateOf("single-agent") }
    var maxDelegationDepth by remember { mutableStateOf("5") }
    var showTeamActivity by remember { mutableStateOf(true) }
    var instructionModeExpanded by remember { mutableStateOf(false) }
    var defaultModel by remember { mutableStateOf<String?>(null) }
    var projectHermesProfile by remember { mutableStateOf("") }
    var defaultThinkingEffort by remember { mutableStateOf<String?>(null) }
    var defaultThinkingEffortExpanded by remember { mutableStateOf(false) }
    var showModelSheet by remember { mutableStateOf(false) }
    val modelSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // Snapshot variables for dirty-check
    var loadedColor by remember(projectId) { mutableStateOf(project?.color ?: "blue") }
    var loadedInstructions by remember { mutableStateOf("") }
    var loadedRootDirectory by rememberSaveable(projectId) { mutableStateOf("") }
    var loadedInstructionMode by remember { mutableStateOf("prepend") }
    var loadedInstructionsEnabled by remember { mutableStateOf(true) }
    var loadedWorkflowMode by remember { mutableStateOf("single-agent") }
    var loadedMaxDelegationDepth by remember { mutableStateOf("5") }
    var loadedShowTeamActivity by remember { mutableStateOf(true) }
    var loadedDefaultModel by remember { mutableStateOf<String?>(null) }
    var loadedProjectHermesProfile by remember { mutableStateOf("") }
    var loadedDefaultThinkingEffort by remember { mutableStateOf<String?>(null) }
    var savedCapabilityProfile by remember(projectId) { mutableStateOf(CapabilityProfile()) }
    var capabilityProfileDraft by remember(projectId) { mutableStateOf(CapabilityProfile()) }
    var capabilitiesSaving by remember { mutableStateOf(false) }
    var mcpGrantToRevoke by remember { mutableStateOf<CapabilityMcpGrant?>(null) }
    val variables = remember { mutableStateListOf<Map<String, String>>() }
    val inScope = remember { mutableStateListOf<Map<String, String>>() }
    val outOfScope = remember { mutableStateListOf<Map<String, String>>() }
    val milestones = remember { mutableStateListOf<Map<String, String>>() }
    val projectAgents = remember { mutableStateListOf<ProjectAgentEntry>() }
    var showAddAgentSheet by remember { mutableStateOf(false) }

    var loaded by rememberSaveable(projectId) { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var showDiscardDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var deleteDialogDeleteChats by remember { mutableStateOf(false) }
    var repositoryToRemove by remember { mutableStateOf<ProjectRepositoryBinding?>(null) }
    var sourcesUpdating by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    // The settings destination can remain composed underneath the picker, and navigation does
    // not necessarily produce an Activity ON_RESUME transition. Observe the durable marker
    // directly so both the kept-alive and recreated destination cases refresh the source cards.
    LaunchedEffect(projectId) {
        WsRepository.pendingProjectSourceRefresh.collect { pendingProjectId ->
            if (shouldRefreshProjectConfigOnResume(pendingProjectId, projectId)) {
                WsRepository.pendingProjectSourceRefresh.value = null
                WsRepository.getProjectConfig(projectId)
            }
        }
    }

    // Section expand state
    var coreExpanded by rememberSaveable { mutableStateOf(true) }
    var pathsExpanded by rememberSaveable { mutableStateOf(false) }
    var variablesExpanded by rememberSaveable { mutableStateOf(false) }
    var scopeExpanded by rememberSaveable { mutableStateOf(false) }
    var milestonesExpanded by rememberSaveable { mutableStateOf(false) }
    var orchestrationExpanded by rememberSaveable { mutableStateOf(false) }
    var capabilitiesExpanded by rememberSaveable { mutableStateOf(false) }
    var agentsExpanded by rememberSaveable { mutableStateOf(true) }

    val hasUnsavedChanges = loaded && (
        color != loadedColor ||
        instructions != loadedInstructions ||
        rootDirectory != loadedRootDirectory ||
        instructionMode != loadedInstructionMode ||
        instructionsEnabled != loadedInstructionsEnabled ||
        workflowMode != loadedWorkflowMode ||
        maxDelegationDepth != loadedMaxDelegationDepth ||
        showTeamActivity != loadedShowTeamActivity ||
        defaultModel != loadedDefaultModel ||
        projectHermesProfile != loadedProjectHermesProfile ||
        defaultThinkingEffort != loadedDefaultThinkingEffort
    )
    val capabilityProfileDirty = !sameCapabilityProfile(capabilityProfileDraft, savedCapabilityProfile)
    val currentCapabilityProfileDirty by rememberUpdatedState(capabilityProfileDirty)

    // Navigating to the file explorer (from "Project files" or the "Choose folder…" picker)
    // disposes and recreates this composable; `loaded` is rememberSaveable so it survives that
    // round trip and this skips re-fetching, which would otherwise overwrite the just-picked
    // rootDirectory with the stale persisted value before the user can hit Save.
    LaunchedEffect(projectId) {
        if (!loaded) {
            WsRepository.getProjectConfig(projectId)
        }
        WsRepository.listProjectAgents(projectId)
    }

    LaunchedEffect(projectId, connectionState) {
        if (connectionState == ConnectionState.CONNECTED) {
            WsRepository.getProjectCapabilities(projectId)
            WsRepository.listSkills()
            WsRepository.getMcpServers()
        }
    }

    LaunchedEffect(projectId) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.ProjectConfig -> if (event.id == projectId) {
                    color = project?.color ?: color
                    instructions = event.config.instructions
                    rootDirectory = event.config.rootDirectory.orEmpty()
                    projectSources = event.config.sources
                    projectRepositories = event.config.repositories
                    instructionMode = event.config.instructionMode
                    instructionsEnabled = event.config.instructionsEnabled
                    workflowMode = event.config.workflowMode
                    maxDelegationDepth = event.config.maxDelegationDepth.toString()
                    showTeamActivity = event.config.showTeamActivity
                    defaultModel = event.config.defaultModel
                    projectHermesProfile = event.config.projectHermesProfile.orEmpty()
                    defaultThinkingEffort = event.config.defaultThinkingEffort
                    if (!currentCapabilityProfileDirty) {
                        savedCapabilityProfile = event.config.capabilityProfile
                        capabilityProfileDraft = event.config.capabilityProfile
                    }
                    variables.replaceWith(event.config.variables)
                    inScope.replaceWith(event.config.inScope)
                    outOfScope.replaceWith(event.config.outOfScope)
                    milestones.replaceWith(event.config.milestones)
                    // Sync snapshots
                    loadedColor = project?.color ?: color
                    loadedInstructions = event.config.instructions
                    loadedRootDirectory = event.config.rootDirectory.orEmpty()
                    loadedInstructionMode = event.config.instructionMode
                    loadedInstructionsEnabled = event.config.instructionsEnabled
                    loadedWorkflowMode = event.config.workflowMode
                    loadedMaxDelegationDepth = event.config.maxDelegationDepth.toString()
                    loadedShowTeamActivity = event.config.showTeamActivity
                    loadedDefaultModel = event.config.defaultModel
                    loadedProjectHermesProfile = event.config.projectHermesProfile.orEmpty()
                    loadedDefaultThinkingEffort = event.config.defaultThinkingEffort
                    loaded = true
                }
                is WsEvent.ProjectConfigUpdated -> if (event.id == projectId) {
                    saving = false
                    loadedColor = color
                    loadedInstructions = instructions
                    loadedRootDirectory = rootDirectory
                    loadedInstructionMode = instructionMode
                    loadedInstructionsEnabled = instructionsEnabled
                    loadedWorkflowMode = workflowMode
                    loadedMaxDelegationDepth = maxDelegationDepth
                    loadedShowTeamActivity = showTeamActivity
                    loadedDefaultModel = defaultModel
                    loadedProjectHermesProfile = projectHermesProfile
                    loadedDefaultThinkingEffort = defaultThinkingEffort
                    if (isNew) {
                        WsRepository.pendingHighlightProjectId.value = projectId
                        onBack()
                    } else {
                        scope.launch {
                            snackbarHostState.showSnackbar("Settings saved", duration = SnackbarDuration.Short)
                            delay(500)
                            onBack()
                        }
                    }
                }
                is WsEvent.ProjectConfigChanged -> if (event.id == projectId) {
                    if (event.config != null) {
                        // This broadcast is the authoritative post-mutation hierarchy. Apply it
                        // directly instead of issuing a second get-config request, which can
                        // race the add-source command and overwrite the new source with stale
                        // settings data.
                        projectSources = event.config.sources
                        projectRepositories = event.config.repositories
                        rootDirectory = event.config.rootDirectory.orEmpty()
                        loadedRootDirectory = event.config.rootDirectory.orEmpty()
                        if (!currentCapabilityProfileDirty) {
                            savedCapabilityProfile = event.config.capabilityProfile
                            capabilityProfileDraft = event.config.capabilityProfile
                        }
                    } else if (loaded && !hasUnsavedChanges) {
                        // Compatibility with older desktops that only broadcast the project id.
                        WsRepository.getProjectConfig(projectId)
                    }
                }
                is WsEvent.ProjectSourcesUpdated -> if (event.id == projectId) {
                    projectSources = event.config.sources
                    projectRepositories = event.config.repositories
                    rootDirectory = event.config.rootDirectory.orEmpty()
                    loadedRootDirectory = event.config.rootDirectory.orEmpty()
                    sourcesUpdating = false
                    scope.launch {
                        snackbarHostState.showSnackbar(
                            when (event.action) {
                                "add" -> "Folder added to project sources"
                                "remove" -> "Repository removed from project"
                                else -> "Project sources rescanned"
                            },
                            duration = SnackbarDuration.Short,
                        )
                    }
                }
                is WsEvent.ProjectSourcesError -> if (event.id == projectId) {
                    sourcesUpdating = false
                    scope.launch { snackbarHostState.showSnackbar(event.message, duration = SnackbarDuration.Long) }
                }
                is WsEvent.ProjectAgents -> if (event.id == projectId) {
                    projectAgents.clear()
                    projectAgents.addAll(event.agents)
                }
                is WsEvent.ProjectCapabilities -> if (event.projectId == projectId && !currentCapabilityProfileDirty) {
                    savedCapabilityProfile = event.profile
                    capabilityProfileDraft = event.profile
                }
                is WsEvent.ProjectCapabilitiesUpdated -> if (event.projectId == projectId) {
                    capabilitiesSaving = false
                    savedCapabilityProfile = event.profile
                    capabilityProfileDraft = event.profile
                    scope.launch { snackbarHostState.showSnackbar("Capabilities saved", duration = SnackbarDuration.Short) }
                }
                is WsEvent.ProjectCapabilitiesError -> if (event.projectId == projectId) {
                    capabilitiesSaving = false
                    scope.launch { snackbarHostState.showSnackbar(event.message, duration = SnackbarDuration.Long) }
                }
                else -> {}
            }
        }
    }

    // Picked up after returning from the remote file explorer (see WsRepository.pendingSelectedDirectory)
    // — just fills the field; the user still reviews and taps Save like any other edit here.
    LaunchedEffect(Unit) {
        WsRepository.pendingSelectedDirectory.collect { picked ->
            if (picked != null) {
                rootDirectory = picked
                WsRepository.pendingSelectedDirectory.value = null
            }
        }
    }

    BackHandler(enabled = hasUnsavedChanges && !showDiscardDialog) {
        showDiscardDialog = true
    }

    if (showModelSheet) {
        ModalBottomSheet(
            onDismissRequest = { showModelSheet = false },
            sheetState = modelSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ModelPickerSheet(
                title = "Project default model",
                models = models,
                cliStatus = cliStatus,
                selectedModelId = defaultModel,
                subtitle = "Pre-selected for new chats in this project",
                showDefaultModel = true,
                effectiveMode = effectiveMode,
            ) { modelId ->
                defaultModel = modelId
                scope.launch { modelSheetState.hide() }.invokeOnCompletion { showModelSheet = false }
            }
        }
    }

    if (showDiscardDialog) {
        NexyConfirmDialog(
            title = "Discard changes?",
            message = "You have unsaved changes. Leaving now will discard them.",
            confirmLabel = "Discard",
            onConfirm = { showDiscardDialog = false; onBack() },
            onDismiss = { showDiscardDialog = false },
            destructive = true,
        )
    }

    if (showDeleteDialog) {
        NexyConfirmDialog(
            title = "Delete project?",
            message = "\"${project?.name}\" and its project settings will be deleted locally and synchronized when the desktop is available.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                showDeleteDialog = false
                WsRepository.deleteProject(projectId, deleteDialogDeleteChats)
                onBack()
            },
            onDismiss = { showDeleteDialog = false },
            extraContent = {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { deleteDialogDeleteChats = !deleteDialogDeleteChats },
                ) {
                    Checkbox(checked = deleteDialogDeleteChats, onCheckedChange = { deleteDialogDeleteChats = it })
                    Text("Also delete conversations in this project")
                }
            },
        )
    }

    repositoryToRemove?.let { repository ->
        NexyConfirmDialog(
            title = "Remove repository?",
            message = "Remove \"${repository.label}\" from this project? Files on the desktop will not be deleted. A later rescan can discover it again if it is still inside a source folder.",
            confirmLabel = "Remove",
            destructive = true,
            onConfirm = {
                repositoryToRemove = null
                sourcesUpdating = true
                WsRepository.removeProjectRepository(projectId, repository.id)
            },
            onDismiss = { repositoryToRemove = null },
        )
    }

    mcpGrantToRevoke?.let { grant ->
        NexyConfirmDialog(
            title = "Revoke MCP capability?",
            message = "Remove this MCP capability from every chat in this project? Existing chats will no longer inherit it.",
            confirmLabel = "Revoke",
            destructive = true,
            onConfirm = {
                capabilityProfileDraft = capabilityProfileDraft.copy(
                    mcp = capabilityProfileDraft.mcp.filterNot { it.serverId == grant.serverId },
                )
                mcpGrantToRevoke = null
            },
            onDismiss = { mcpGrantToRevoke = null },
        )
    }

    // Project configuration is persisted locally and synchronized later. Team membership still
    // requires the desktop because it controls desktop orchestration identities.
    val disconnected = false
    val desktopDisconnected = connectionState != ConnectionState.CONNECTED
    val instructionModeLabel = instructionModeOptions.find { it.first == instructionMode }?.second ?: "Prepend"

    if (showAddAgentSheet) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        val assignedIds = projectAgents.map { it.agentId }.toSet()
        val available = allAgents.filter { it.id !in assignedIds }
        ModalBottomSheet(
            onDismissRequest = { showAddAgentSheet = false },
            sheetState = sheetState,
        ) {
            AddAgentToProjectSheetContent(
                available = available,
                onSelectAgent = { agent ->
                    showAddAgentSheet = false
                    WsRepository.addProjectAgent(projectId, agent.id)
                },
                onCancel = { showAddAgentSheet = false },
            )
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(
                        project?.name?.let { "Configure: $it" } ?: "Project Settings",
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                    )
                },
                onBack = { if (hasUnsavedChanges) showDiscardDialog = true else onBack() },
            )
        },
        bottomBar = {
            if (project != null && loaded) {
                Surface(shadowElevation = 0.dp, tonalElevation = 0.dp, modifier = Modifier.navigationBarsPadding()) {
                    Button(
                        onClick = {
                            if (saving || disconnected) return@Button
                            saving = true
                            if (color != project.color) {
                                WsRepository.updateProjectColor(projectId, project.name, color)
                            }
                            WsRepository.updateProjectConfig(
                                projectId,
                                ProjectSettingsConfig(
                                    instructions = instructions.trim(),
                                    rootDirectory = rootDirectory.trim().ifBlank { null },
                                    variables = variables.toList(),
                                    instructionMode = instructionMode,
                                    instructionsEnabled = instructionsEnabled,
                                    workflowMode = workflowMode,
                                    orchestrationEnabled = workflowMode == "orchestrated",
                                    maxDelegationDepth = maxDelegationDepth.toIntOrNull()?.coerceIn(1, 10) ?: 5,
                                    showTeamActivity = showTeamActivity,
                                    inScope = inScope.toList(),
                                    outOfScope = outOfScope.toList(),
                                    milestones = milestones.toList(),
                                    defaultModel = defaultModel,
                                    projectHermesProfile = projectHermesProfile.takeIf { defaultModel != null },
                                    defaultThinkingEffort = defaultThinkingEffort,
                                ),
                            )
                        },
                        enabled = !saving && !disconnected,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Text(if (saving) "Saving…" else "Save settings")
                    }
                }
            }
        },
    ) { padding ->
        if (project == null) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("Project not found.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onBack) { Text("Go back") }
            }
            return@Scaffold
        }

        if (!loaded) {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                NexyIcon(
                    name = NexyIconName.Busy,
                    contentDescription = "Loading project configuration",
                    modifier = Modifier.size(24.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            NexyConnectionBanner(connectionState)

            // — Core Settings —
            NexyExpandableSection(
                title = "Core Settings",
                expanded = coreExpanded,
                onToggle = { coreExpanded = !coreExpanded },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Project color", style = MaterialTheme.typography.labelMedium)
                        projectColorOptions.chunked(4).forEach { rowColors ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                rowColors.forEach { option ->
                                    FilterChip(
                                        selected = color == option,
                                        onClick = { if (!saving && !disconnected) { color = option; customColorHex = "" } },
                                        label = { Text(option.replaceFirstChar { it.uppercase() }) },
                                        leadingIcon = {
                                            Box(
                                                modifier = Modifier
                                                    .size(16.dp)
                                                    .background(projectColor(option), RoundedCornerShape(4.dp)),
                                            )
                                        },
                                        enabled = !saving && !disconnected,
                                    )
                                }
                            }
                        }
                        OutlinedTextField(
                            value = customColorHex,
                            onValueChange = { value ->
                                val normalized = value.uppercase()
                                if (normalized.matches(Regex("^#?[0-9A-F]{0,6}$"))) {
                                    customColorHex = if (normalized.isEmpty() || normalized.startsWith("#")) normalized else "#$normalized"
                                    if (customColorHex.length == 7) color = customColorHex
                                }
                            },
                            label = { Text("Custom hex (optional)") },
                            placeholder = { Text("#3478D4") },
                            singleLine = true,
                            enabled = !saving && !disconnected,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    OutlinedTextField(
                        value = instructions,
                        onValueChange = { instructions = it },
                        label = { Text("Project instructions") },
                        placeholder = { Text("Guidelines appended to every chat in this project") },
                        enabled = !saving && !disconnected,
                        minLines = 4,
                        maxLines = 12,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Enable instructions", style = MaterialTheme.typography.bodyMedium)
                            Text(
                                "Include these instructions in project chats",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = instructionsEnabled,
                            onCheckedChange = { if (!saving && !disconnected) instructionsEnabled = it },
                            enabled = !saving && !disconnected,
                        )
                    }
                    ExposedDropdownMenuBox(
                        expanded = instructionModeExpanded,
                        onExpandedChange = { if (!saving && !disconnected) instructionModeExpanded = it },
                    ) {
                        OutlinedTextField(
                            value = instructionModeLabel,
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Instruction mode") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = instructionModeExpanded) },
                            enabled = !saving && !disconnected,
                            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                        )
                        ExposedDropdownMenu(
                            expanded = instructionModeExpanded,
                            onDismissRequest = { instructionModeExpanded = false },
                        ) {
                            instructionModeOptions.forEach { (value, label) ->
                                DropdownMenuItem(
                                    text = { Text(label) },
                                    onClick = { instructionMode = value; instructionModeExpanded = false },
                                )
                            }
                        }
                    }
                    Text(
                        instructionModeDescriptions[instructionMode].orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    SettingsNavRow(
                        title = "Default model",
                        detail = if (defaultModel == null) {
                            "Nexy default"
                        } else {
                            "${activeModelLabel(defaultModel, models)} · New project chats"
                        },
                        onClick = {
                            WsRepository.send("model:list", emptyMap())
                            WsRepository.getCliStatus()
                            showModelSheet = true
                        },
                    )
                    Text(
                        "If this model becomes unavailable, new chats fall back to the Nexy default.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (models.any { it.id == defaultModel && it.backend == "hermes-cli" }) {
                        OutlinedTextField(
                            value = projectHermesProfile,
                            onValueChange = { projectHermesProfile = it },
                            label = { Text("Hermes profile") },
                            placeholder = { Text("Default profile") },
                            supportingText = { Text("Available: ${hermesInfo.profiles.joinToString(", ") { it.name }}") },
                            singleLine = true,
                            enabled = !saving && !disconnected,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    ExposedDropdownMenuBox(
                        expanded = defaultThinkingEffortExpanded,
                        onExpandedChange = { if (!saving && !disconnected) defaultThinkingEffortExpanded = it },
                    ) {
                        OutlinedTextField(
                            value = thinkingEffortOptions.find { it.first == defaultThinkingEffort }?.second ?: "Agent default",
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Default thinking effort") },
                            supportingText = { Text("Used for new chats in this project unless the chat overrides it") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = defaultThinkingEffortExpanded) },
                            enabled = !saving && !disconnected,
                            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                        )
                        ExposedDropdownMenu(
                            expanded = defaultThinkingEffortExpanded,
                            onDismissRequest = { defaultThinkingEffortExpanded = false },
                        ) {
                            thinkingEffortOptions.forEach { (value, label) ->
                                DropdownMenuItem(
                                    text = { Text(label) },
                                    onClick = {
                                        defaultThinkingEffort = value
                                        defaultThinkingEffortExpanded = false
                                    },
                                )
                            }
                        }
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Paths —
            NexyExpandableSection(
                title = "Sources & repositories",
                expanded = pathsExpanded,
                onToggle = { pathsExpanded = !pathsExpanded },
                badge = projectRepositories.size.takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "A project can use multiple desktop folders and Git repositories. Choose the primary folder, rescan desktop sources, or remove repositories from this project without deleting their files. To read files, open Project files from the project's home screen.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = rootDirectory,
                        onValueChange = { rootDirectory = it },
                        label = { Text("Primary desktop source (optional)") },
                        placeholder = { Text("e.g. /home/user/my-project") },
                        singleLine = true,
                        enabled = !saving && !disconnected,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (!desktopDisconnected) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TextButton(onClick = { onOpenFileExplorer(rootDirectory) }, enabled = !saving && !sourcesUpdating) {
                                Text("Choose folder…")
                            }
                            if (!isNew) {
                                TextButton(onClick = onAddSourceFolder, enabled = !saving && !sourcesUpdating) {
                                    Text("Add folder…")
                                }
                            }
                            TextButton(
                                onClick = {
                                    sourcesUpdating = true
                                    WsRepository.rescanProjectSources(projectId)
                                },
                                enabled = !saving && !sourcesUpdating,
                            ) {
                                NexyIcon(NexyIconName.Scan, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.size(6.dp))
                                Text(if (sourcesUpdating) "Rescanning…" else "Rescan")
                            }
                        }
                    }
                    projectSources.forEach { source ->
                        val repositories = projectRepositories.filter { it.sourceId == source.id }
                        Surface(
                            color = MaterialTheme.colorScheme.surface,
                            shape = RoundedCornerShape(14.dp),
                            tonalElevation = 1.dp,
                            border = androidx.compose.foundation.BorderStroke(
                                1.dp,
                                MaterialTheme.colorScheme.outlineVariant,
                            ),
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        ) {
                            Column(
                                modifier = Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                // Source header: folder glyph, name, path, primary pill.
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(34.dp)
                                            .background(
                                                MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                                                RoundedCornerShape(9.dp),
                                            ),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        NexyIcon(
                                            NexyIconName.Folder,
                                            contentDescription = null,
                                            modifier = Modifier.size(18.dp),
                                            tint = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                    Column(
                                        modifier = Modifier.weight(1f),
                                        verticalArrangement = Arrangement.spacedBy(2.dp),
                                    ) {
                                        Text(
                                            source.label,
                                            style = MaterialTheme.typography.titleSmall,
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                        Text(
                                            source.localPath,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                    if (source.isPrimary) {
                                        SourcePill(
                                            text = "Primary",
                                            container = MaterialTheme.colorScheme.primaryContainer,
                                            content = MaterialTheme.colorScheme.onPrimaryContainer,
                                        )
                                    }
                                }

                                if (repositories.isNotEmpty() || source.isPrimary) {
                                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
                                }

                                if (repositories.isEmpty()) {
                                    Text(
                                        "No Git repositories discovered",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                } else repositories.forEach { repository ->
                                    val branchLabel = if (!repository.available) "unavailable" else repository.branch ?: "Git"
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    ) {
                                        NexyIcon(
                                            NexyIconName.Fork,
                                            contentDescription = null,
                                            modifier = Modifier.size(16.dp),
                                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                        Column(
                                            modifier = Modifier.weight(1f),
                                            verticalArrangement = Arrangement.spacedBy(4.dp),
                                        ) {
                                            Text(
                                                repository.label,
                                                style = MaterialTheme.typography.bodyMedium,
                                                fontWeight = FontWeight.Medium,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                            )
                                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                                SourcePill(
                                                    text = branchLabel,
                                                    container = MaterialTheme.colorScheme.surfaceVariant,
                                                    content = MaterialTheme.colorScheme.onSurfaceVariant,
                                                )
                                                if (repository.dirty == true) {
                                                    SourcePill(
                                                        text = "changes",
                                                        container = MaterialTheme.colorScheme.tertiaryContainer,
                                                        content = MaterialTheme.colorScheme.onTertiaryContainer,
                                                    )
                                                }
                                            }
                                        }
                                        IconButton(
                                            onClick = { repositoryToRemove = repository },
                                            enabled = !saving && !sourcesUpdating && !desktopDisconnected,
                                            modifier = Modifier.size(36.dp),
                                        ) {
                                            NexyIcon(
                                                NexyIconName.Delete,
                                                contentDescription = "Remove ${repository.label} from project",
                                                modifier = Modifier.size(18.dp),
                                                tint = MaterialTheme.colorScheme.error,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Capabilities —
            NexyExpandableSection(
                title = "Capabilities",
                expanded = capabilitiesExpanded,
                onToggle = { capabilitiesExpanded = !capabilitiesExpanded },
                badge = (capabilityProfileDraft.skillIds.size + capabilityProfileDraft.mcp.size)
                    .takeIf { it > 0 }
                    ?.toString(),
            ) {
                ProjectCapabilitiesSection(
                    profile = capabilityProfileDraft,
                    savedProfile = savedCapabilityProfile,
                    skills = availableSkills,
                    mcpServers = availableMcpServers,
                    desktopConnected = !desktopDisconnected,
                    saving = capabilitiesSaving,
                    onProfileChange = { capabilityProfileDraft = it },
                    onRevokeMcp = { mcpGrantToRevoke = it },
                    onDiscard = { capabilityProfileDraft = savedCapabilityProfile },
                    onSave = {
                        capabilitiesSaving = true
                        WsRepository.setProjectCapabilities(projectId, capabilityProfileDraft)
                    },
                    onOpenMcpServers = onOpenMcpServers,
                )
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Variables —
            NexyExpandableSection(
                title = "Variables",
                expanded = variablesExpanded,
                onToggle = { variablesExpanded = !variablesExpanded },
                badge = variables.size.takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "Reusable values you can reference as {{key}} anywhere in this project — in your chat messages, in the project instructions above, and in the automated workflow generator. Nexy substitutes the value automatically before sending.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    EditableKeyValueList(
                        rows = variables,
                        keyLabel = "Key",
                        valueLabel = "Value",
                        addLabel = "Add variable",
                        enabled = !saving && !disconnected,
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Scope —
            NexyExpandableSection(
                title = "Scope",
                expanded = scopeExpanded,
                onToggle = { scopeExpanded = !scopeExpanded },
                badge = (inScope.size + outOfScope.size).takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "Sent to the agent with every chat message in this project. \"In scope\" tells it what to focus on; \"Out of scope\" is a hard instruction not to touch those files or areas.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    EditableScopeList(
                        title = "In scope",
                        rows = inScope,
                        addLabel = "Add in-scope rule",
                        enabled = !saving && !disconnected,
                    )
                    EditableScopeList(
                        title = "Out of scope",
                        rows = outOfScope,
                        addLabel = "Add out-of-scope rule",
                        enabled = !saving && !disconnected,
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Milestones —
            NexyExpandableSection(
                title = "Milestones",
                expanded = milestonesExpanded,
                onToggle = { milestonesExpanded = !milestonesExpanded },
                badge = milestones.size.takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "Track project phases here. Whichever milestone is marked \"active\" is sent to the agent with every chat message, so it stays focused on the current phase.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    EditableMilestonesList(
                        rows = milestones,
                        enabled = !saving && !disconnected,
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Workflow mode —
            NexyExpandableSection(
                title = "Workflow mode",
                expanded = orchestrationExpanded,
                onToggle = { orchestrationExpanded = !orchestrationExpanded },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Workflow mode", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "Choose whether the project runs as a single agent, automated delegation workflow, or full orchestration.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        val canOrchestrate = projectAgents.size >= 2
                        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                            workflowModeOptions.forEachIndexed { i, (value, label) ->
                                val optionDisabled = value == "orchestrated" && !canOrchestrate
                                SegmentedButton(
                                    selected = workflowMode == value,
                                    onClick = { if (!saving && !disconnected && !optionDisabled) workflowMode = value },
                                    shape = SegmentedButtonDefaults.itemShape(index = i, count = workflowModeOptions.size),
                                    enabled = !saving && !disconnected && !optionDisabled,
                                ) {
                                    Text(label, style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                        if (!canOrchestrate) {
                            Text(
                                "Add at least two agents to enable orchestration.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                        if (workflowMode == "automated-delegation") {
                            Text(
                                "Use the Automated workflow generator (Workflows on the project's home screen) to turn a goal into a reusable delegation plan that runs itself.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (workflowMode == "orchestrated") {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            OutlinedTextField(
                                value = maxDelegationDepth,
                                onValueChange = { maxDelegationDepth = it.filter(Char::isDigit).take(2) },
                                label = { Text("Max delegation depth") },
                                singleLine = true,
                                enabled = !saving && !disconnected,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text(
                                "How many levels deep the leader agent can delegate a task before it must be handled directly (1–10). Higher values allow more sub-delegation but take longer and cost more.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text("Show team activity", style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    "Show delegated agent activity in chat",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Switch(
                                checked = showTeamActivity,
                                onCheckedChange = { if (!saving && !disconnected) showTeamActivity = it },
                                enabled = !saving && !disconnected,
                            )
                        }
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Agents —
            NexyExpandableSection(
                title = "Agents",
                expanded = agentsExpanded,
                onToggle = { agentsExpanded = !agentsExpanded },
                badge = projectAgents.size.takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "Agents assigned to this project. When Orchestration is on, the \"Primary\" agent is the leader that delegates to the others — use \"Set primary\" to change which one leads.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (projectAgents.isEmpty()) {
                        Text(
                            "No agents assigned to this project.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        projectAgents.forEachIndexed { entryIndex, entry ->
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(56.dp)
                                    .background(
                                        if (entry.isPrimary) MaterialTheme.colorScheme.primaryContainer
                                        else MaterialTheme.colorScheme.surface
                                    ),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(
                                    modifier = Modifier
                                        .weight(1f)
                                        .padding(start = 12.dp),
                                    verticalArrangement = Arrangement.Center,
                                ) {
                                    Text(
                                        if (entry.agentIcon.isNotBlank()) "${entry.agentIcon}  ${entry.agentName}" else entry.agentName,
                                        style = MaterialTheme.typography.bodyMedium,
                                        maxLines = 1,
                                    )
                                    if (entry.isPrimary) {
                                        Text(
                                            "Primary",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                }
                                if (!entry.isPrimary && !desktopDisconnected) {
                                    TextButton(
                                        onClick = { WsRepository.setPrimaryProjectAgent(projectId, entry.agentId) },
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                                    ) {
                                        Text("Set primary", style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                                if (!desktopDisconnected) {
                                    IconButton(
                                        onClick = {
                                            if (entryIndex > 0) {
                                                projectAgents.move(entryIndex, entryIndex - 1)
                                                WsRepository.reorderProjectAgents(projectId, projectAgents.map { it.agentId })
                                            }
                                        },
                                        enabled = entryIndex > 0,
                                        modifier = Modifier.size(36.dp),
                                    ) {
                                        NexyIcon(NexyIconName.ChevronUp, "Move up", Modifier.size(18.dp))
                                    }
                                    IconButton(
                                        onClick = {
                                            if (entryIndex < projectAgents.lastIndex) {
                                                projectAgents.move(entryIndex, entryIndex + 1)
                                                WsRepository.reorderProjectAgents(projectId, projectAgents.map { it.agentId })
                                            }
                                        },
                                        enabled = entryIndex < projectAgents.lastIndex,
                                        modifier = Modifier.size(36.dp),
                                    ) {
                                        NexyIcon(NexyIconName.ChevronDown, "Move down", Modifier.size(18.dp))
                                    }
                                    IconButton(
                                        onClick = { WsRepository.removeProjectAgent(projectId, entry.agentId) },
                                        modifier = Modifier.size(36.dp),
                                    ) {
                                        NexyIcon(NexyIconName.Close, "Remove ${entry.agentName}", Modifier.size(18.dp))
                                    }
                                }
                            }
                        }
                    }

                    if (!desktopDisconnected) {
                        TextButton(
                            onClick = { showAddAgentSheet = true },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            NexyIcon(NexyIconName.Add, null, Modifier.padding(end = 4.dp).size(18.dp))
                            Text("Add agent")
                        }
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.error.copy(alpha = 0.3f))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
            ) {
                NexyIcon(NexyIconName.Warning, null, Modifier.size(14.dp), MaterialTheme.colorScheme.error)
                Text("Danger Zone", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Delete project", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "Permanently delete this project and its settings.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                    TextButton(onClick = { showDeleteDialog = true }, enabled = !desktopDisconnected) {
                        Text("Delete", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}

@Composable
internal fun AddAgentToProjectSheetContent(
    available: List<Agent>,
    onSelectAgent: (Agent) -> Unit,
    onCancel: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val filtered = available.filter { query.isBlank() || it.name.contains(query, ignoreCase = true) }
    Text(
        "Add agent to project",
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
    )
    NexySearchField(query = query, onQueryChange = { query = it }, placeholder = "Search agents…")
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    LazyColumn(modifier = Modifier.fillMaxWidth()) {
        if (filtered.isEmpty()) {
            item {
                Text(
                    if (available.isEmpty()) "All agents are already in this project." else "No results for \"$query\"",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp),
                )
            }
        } else {
            items(filtered, key = { it.id }) { agent ->
                NewChatItem(label = if (agent.icon.isNotBlank()) "${agent.icon}  ${agent.name}" else agent.name) {
                    onSelectAgent(agent)
                }
            }
        }
        item {
            TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
                Text("Cancel")
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable
private fun SourcePill(text: String, container: Color, content: Color) {
    Box(
        modifier = Modifier
            .background(container, RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            color = content,
            maxLines = 1,
        )
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

private fun MutableList<Map<String, String>>.replaceWith(next: List<Map<String, String>>) {
    clear()
    addAll(next)
}

private fun <T> MutableList<T>.move(from: Int, to: Int) {
    val item = removeAt(from)
    add(to, item)
}

private fun sameCapabilityProfile(left: CapabilityProfile, right: CapabilityProfile): Boolean =
    left.skillIds.toSet() == right.skillIds.toSet() &&
        left.mcp.associate { it.serverId to it.trust } == right.mcp.associate { it.serverId to it.trust } &&
        left.builtInTools == right.builtInTools

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProjectCapabilitiesSection(
    profile: CapabilityProfile,
    savedProfile: CapabilityProfile,
    skills: List<SkillConfig>,
    mcpServers: List<McpServerInfo>,
    desktopConnected: Boolean,
    saving: Boolean,
    onProfileChange: (CapabilityProfile) -> Unit,
    onRevokeMcp: (CapabilityMcpGrant) -> Unit,
    onDiscard: () -> Unit,
    onSave: () -> Unit,
    onOpenMcpServers: () -> Unit,
) {
    var skillQuery by remember { mutableStateOf("") }
    val filteredSkills = skills.filter { skill ->
        skillQuery.isBlank() || skill.name.contains(skillQuery, ignoreCase = true) ||
            skill.description.contains(skillQuery, ignoreCase = true)
    }
    val skillIds = skills.mapTo(mutableSetOf()) { it.id }
    val serverIds = mcpServers.mapTo(mutableSetOf()) { it.id }
    val unavailableSkills = if (desktopConnected) profile.skillIds.filterNot(skillIds::contains) else emptyList()
    val unavailableMcp = if (desktopConnected) profile.mcp.filterNot { it.serverId in serverIds } else emptyList()
    val hasUnavailableReferences = unavailableSkills.isNotEmpty() || unavailableMcp.isNotEmpty()
    val canEdit = desktopConnected && !saving

    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(bottom = 12.dp)) {
        Text(
            "Every chat in this project inherits these defaults. Chat and agent setup can add capabilities, but cannot relax a project restriction.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!desktopConnected) {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium) {
                Text(
                    "Showing the saved profile. Connect the paired desktop to change capabilities; MCP credentials and browser sessions stay on that desktop.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }
        if (hasUnavailableReferences) {
            Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.medium) {
                Text(
                    "Remove unavailable capabilities before saving: " +
                        (unavailableSkills + unavailableMcp.map { it.serverId }).joinToString(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }

        Text("Built-in tools", style = MaterialTheme.typography.labelLarge)
        Text(
            "Turning a tool off blocks it in every project chat. Turning it on still uses each agent's own approval settings.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        listOf(
            Triple("fileEdit", "File Edit", "Read and edit project files"),
            Triple("terminal", "Terminal", "Run command-line commands"),
            Triple("webFetch", "Web Fetch", "Fetch pages and search the web"),
        ).forEach { (key, label, detail) ->
            // Projects created before this policy are permissive until the user changes a toggle.
            val enabled = profile.builtInTools[key]?.let { it.enabled && it.approval != "disabled" } ?: true
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = enabled,
                    onCheckedChange = { checked ->
                        onProfileChange(profile.copy(builtInTools = profile.builtInTools + (
                            key to CapabilityBuiltInToolPolicy(
                                enabled = checked,
                                approval = if (checked) "auto" else "disabled",
                            )
                        )))
                    },
                    enabled = canEdit,
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(label, style = MaterialTheme.typography.bodyMedium)
                    Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        Text("Skills", style = MaterialTheme.typography.labelLarge)
        if (skills.isNotEmpty()) {
            OutlinedTextField(
                value = skillQuery,
                onValueChange = { skillQuery = it },
                label = { Text("Search skills") },
                singleLine = true,
                enabled = canEdit,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (skills.isEmpty() && desktopConnected) {
            Text("No imported skills yet. Add skills from the Skills screen.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        filteredSkills.forEach { skill ->
            val selected = skill.id in profile.skillIds
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = selected,
                    onCheckedChange = { checked ->
                        onProfileChange(profile.copy(skillIds = if (checked) profile.skillIds + skill.id else profile.skillIds - skill.id))
                    },
                    enabled = canEdit,
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(if (skill.icon.isBlank()) skill.name else "${skill.icon} ${skill.name}", style = MaterialTheme.typography.bodyMedium)
                    if (skill.description.isNotBlank()) {
                        Text(skill.description, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        unavailableSkills.forEach { skillId ->
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = true, onCheckedChange = { onProfileChange(profile.copy(skillIds = profile.skillIds - skillId)) }, enabled = canEdit)
                Text("$skillId (unavailable)", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
            }
        }

        Text("MCP tools", style = MaterialTheme.typography.labelLarge)
        if (mcpServers.isEmpty() && desktopConnected) {
            Text("No MCP servers configured yet.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        mcpServers.forEach { server ->
            val grant = profile.mcp.firstOrNull { it.serverId == server.id }
            var approvalExpanded by remember(server.id) { mutableStateOf(false) }
            Column(modifier = Modifier.fillMaxWidth()) {
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = grant != null,
                        onCheckedChange = { checked ->
                            if (checked) onProfileChange(profile.copy(mcp = profile.mcp + CapabilityMcpGrant(server.id)))
                            else grant?.let(onRevokeMcp)
                        },
                        enabled = canEdit,
                    )
                    Column(modifier = Modifier.weight(1f)) {
                        Text(server.name, style = MaterialTheme.typography.bodyMedium)
                        if (server.description.isNotBlank()) Text(server.description, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (grant != null) {
                    ExposedDropdownMenuBox(
                        expanded = approvalExpanded,
                        onExpandedChange = { if (canEdit) approvalExpanded = it },
                        modifier = Modifier.padding(start = 48.dp),
                    ) {
                        OutlinedTextField(
                            value = capabilityTrustOptions.find { it.first == grant.trust }?.second ?: "Ask every time",
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Approval") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = approvalExpanded) },
                            enabled = canEdit,
                            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                        )
                        ExposedDropdownMenu(expanded = approvalExpanded, onDismissRequest = { approvalExpanded = false }) {
                            capabilityTrustOptions.forEach { (trust, label) ->
                                DropdownMenuItem(
                                    text = { Text(label) },
                                    onClick = {
                                        onProfileChange(profile.copy(mcp = profile.mcp.map {
                                            if (it.serverId == server.id) it.copy(trust = trust) else it
                                        }))
                                        approvalExpanded = false
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
        unavailableMcp.forEach { grant ->
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = true, onCheckedChange = { onRevokeMcp(grant) }, enabled = canEdit)
                Text("${grant.serverId} (unavailable)", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
            }
        }
        if (desktopConnected) {
            TextButton(onClick = onOpenMcpServers, enabled = !saving) { Text("Manage or add MCP capabilities") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            TextButton(
                onClick = onDiscard,
                enabled = canEdit && !sameCapabilityProfile(profile, savedProfile),
                modifier = Modifier.weight(1f),
            ) { Text("Discard") }
            Button(
                onClick = onSave,
                enabled = canEdit && !hasUnavailableReferences && !sameCapabilityProfile(profile, savedProfile),
                modifier = Modifier.weight(1f),
            ) { Text(if (saving) "Saving…" else "Save capabilities") }
        }
    }
}

@Composable
private fun EditableKeyValueList(
    rows: MutableList<Map<String, String>>,
    keyLabel: String,
    valueLabel: String,
    addLabel: String,
    enabled: Boolean,
) {
    if (rows.isEmpty()) {
        Text(
            "No entries.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 4.dp),
        )
    }
    rows.forEachIndexed { index, row ->
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = row["key"].orEmpty(),
                onValueChange = { rows[index] = row + ("key" to it) },
                label = { Text(keyLabel) },
                singleLine = true,
                enabled = enabled,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                value = row["value"].orEmpty(),
                onValueChange = { rows[index] = row + ("value" to it) },
                label = { Text(valueLabel) },
                singleLine = true,
                enabled = enabled,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.weight(1f),
            )
            IconButton(
                onClick = { rows.removeAt(index) },
                enabled = enabled,
                modifier = Modifier.size(36.dp),
            ) {
                NexyIcon(NexyIconName.Close, "Remove", Modifier.size(18.dp), MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    TextButton(
        onClick = { rows.add(mapOf("key" to "", "value" to "")) },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
    ) {
        NexyIcon(NexyIconName.Add, null, Modifier.padding(end = 4.dp).size(18.dp))
        Text(addLabel)
    }
}

@Composable
private fun EditableScopeList(
    title: String,
    rows: MutableList<Map<String, String>>,
    addLabel: String,
    enabled: Boolean,
) {
    Text(title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (rows.isEmpty()) {
        Text(
            "No rules.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 4.dp),
        )
    }
    rows.forEachIndexed { index, row ->
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = row["description"].orEmpty(),
                onValueChange = { rows[index] = row + ("description" to it) },
                label = { Text("Description") },
                singleLine = true,
                enabled = enabled,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                value = row["pathGlob"].orEmpty(),
                onValueChange = { rows[index] = row + ("pathGlob" to it) },
                label = { Text("Glob") },
                singleLine = true,
                enabled = enabled,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.weight(1f),
            )
            IconButton(
                onClick = { rows.removeAt(index) },
                enabled = enabled,
                modifier = Modifier.size(36.dp),
            ) {
                NexyIcon(NexyIconName.Close, "Remove", Modifier.size(18.dp), MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    TextButton(
        onClick = { rows.add(mapOf("id" to rows.size.toString(), "description" to "", "pathGlob" to "")) },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
    ) {
        NexyIcon(NexyIconName.Add, null, Modifier.padding(end = 4.dp).size(18.dp))
        Text(addLabel)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditableMilestonesList(
    rows: MutableList<Map<String, String>>,
    enabled: Boolean,
) {
    if (rows.isEmpty()) {
        Text(
            "No milestones.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 4.dp),
        )
    }
    rows.forEachIndexed { index, row ->
        val currentStatus = row["status"].orEmpty().ifBlank { "upcoming" }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(
                    value = row["title"].orEmpty(),
                    onValueChange = { rows[index] = row + ("title" to it) },
                    label = { Text("Title") },
                    singleLine = true,
                    enabled = enabled,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true, imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = row["description"].orEmpty(),
                    onValueChange = { rows[index] = row + ("description" to it) },
                    label = { Text("Description (optional)") },
                    singleLine = true,
                    enabled = enabled,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true, imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth(),
                )
                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                    milestoneStatuses.forEachIndexed { i, status ->
                        SegmentedButton(
                            selected = currentStatus == status,
                            onClick = { rows[index] = row + ("status" to status) },
                            shape = SegmentedButtonDefaults.itemShape(index = i, count = milestoneStatuses.size),
                            enabled = enabled,
                        ) {
                            Text(status, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
            IconButton(
                onClick = { rows.removeAt(index) },
                enabled = enabled,
                modifier = Modifier.size(36.dp).align(Alignment.Top),
            ) {
                NexyIcon(NexyIconName.Close, "Remove milestone", Modifier.size(18.dp), MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    TextButton(
        onClick = { rows.add(mapOf("id" to rows.size.toString(), "title" to "", "description" to "", "status" to "upcoming")) },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
    ) {
        NexyIcon(NexyIconName.Add, null, Modifier.padding(end = 4.dp).size(18.dp))
        Text("Add milestone")
    }
}

package io.nexy.android.ui.home

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.nexy.android.data.EffectiveConnectionMode
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.AgentContextRules
import io.nexy.android.data.model.AgentCustomCommand
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AgentKnowledgeFile
import io.nexy.android.data.model.AgentMcpServerTrust
import io.nexy.android.data.model.AgentMcpToolOverride
import io.nexy.android.data.model.AgentTools
import io.nexy.android.data.model.HermesProfileInfo
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.data.model.ToolConfig
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.chat.ModelPickerSheet
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.components.NexyExpandableSection
import io.nexy.android.ui.components.NexyInfoIcon
import io.nexy.android.ui.components.NexyInputValidation
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.model.activeModelLabel
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private val backendOptions = listOf(
    null to "Default (BYOK providers)",
    "claude-cli" to "Claude CLI",
    "codex-cli" to "Codex CLI",
    "hermes-cli" to "Hermes Agent",
)

private val responseFormatOptions = listOf(
    "default" to "Default",
    "concise" to "Concise",
    "detailed" to "Detailed",
    "code-only" to "Code only",
)

private val approvalOptions = listOf(
    "auto" to "Auto",
    "always-ask" to "Always ask",
    "disabled" to "Disabled",
)

private val thinkingEffortOptions = listOf(
    null to "Provider default",
    "disabled" to "Disabled",
    "low" to "Low",
    "medium" to "Medium",
    "high" to "High",
    "max" to "Max",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentConfigScreen(
    agentId: String,
    onBack: () -> Unit,
    isNew: Boolean = false,
) {
    val agents by WsRepository.agents.collectAsStateWithLifecycle()
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val fullConfig by WsRepository.agentFullConfig.collectAsStateWithLifecycle()
    val skills by WsRepository.skills.collectAsStateWithLifecycle()
    val availableMcpServers by WsRepository.mcpServers.collectAsStateWithLifecycle()
    val models by WsRepository.models.collectAsStateWithLifecycle()
    val cliStatus by WsRepository.cliStatus.collectAsStateWithLifecycle()
    val hermesInfo by WsRepository.hermesInfo.collectAsStateWithLifecycle()
    val effectiveMode by WsRepository.effectiveMode.collectAsStateWithLifecycle()
    val agent = agents.find { it.id == agentId }

    // Identity
    var name by remember { mutableStateOf("") }
    var icon by remember { mutableStateOf("") }
    // Behaviour
    var systemPrompt by remember { mutableStateOf("") }
    var memory by remember { mutableStateOf("") }
    var agenticMode by remember { mutableStateOf(false) }
    var fullAutoApprove by remember { mutableStateOf(false) }
    var showFullAutoApproveDialog by remember { mutableStateOf(false) }
    // Backend
    var backend by remember { mutableStateOf<String?>(null) }
    var cliModel by remember { mutableStateOf("") }
    var hermesProfile by remember { mutableStateOf("") }
    var hermesProfileMenuExpanded by remember { mutableStateOf(false) }
    var backendMenuExpanded by remember { mutableStateOf(false) }
    var showCliModelSheet by remember { mutableStateOf(false) }
    val cliModelSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    // Generation
    var responseFormat by remember { mutableStateOf("default") }
    var responseFormatMenuExpanded by remember { mutableStateOf(false) }
    var temperature by remember { mutableFloatStateOf(0.7f) }
    var maxTokensText by remember { mutableStateOf("8192") }
    var thinkingEffort by remember { mutableStateOf<String?>(null) }
    var thinkingEffortMenuExpanded by remember { mutableStateOf(false) }
    // Tools
    var fileEditEnabled by remember { mutableStateOf(true) }
    var fileEditApproval by remember { mutableStateOf("always-ask") }
    var fileEditApprovalExpanded by remember { mutableStateOf(false) }
    var fileEditInstructions by remember { mutableStateOf("") }
    var terminalEnabled by remember { mutableStateOf(false) }
    var terminalApproval by remember { mutableStateOf("always-ask") }
    var terminalApprovalExpanded by remember { mutableStateOf(false) }
    var terminalInstructions by remember { mutableStateOf("") }
    var webFetchEnabled by remember { mutableStateOf(true) }
    var webFetchApproval by remember { mutableStateOf("never-ask") }
    var webFetchApprovalExpanded by remember { mutableStateOf(false) }
    var webFetchInstructions by remember { mutableStateOf("") }
    // Skills
    var attachedSkillIds by remember { mutableStateOf<List<String>>(emptyList()) }
    // Context
    var rootDirectory by remember { mutableStateOf("") }
    var contextDirectories by remember { mutableStateOf<List<String>>(emptyList()) }
    var contextFiles by remember { mutableStateOf<List<String>>(emptyList()) }
    // Context rules
    var ignoredGlobs by remember { mutableStateOf<List<String>>(emptyList()) }
    var autoInjectWorkspace by remember { mutableStateOf(true) }
    var autoInjectGit by remember { mutableStateOf(true) }
    // Custom commands
    var customCommands by remember { mutableStateOf<List<AgentCustomCommand>>(emptyList()) }
    // MCP servers
    var mcpServers by remember { mutableStateOf<List<String>>(emptyList()) }
    // Knowledge files
    var knowledgeFiles by remember { mutableStateOf<List<AgentKnowledgeFile>>(emptyList()) }
    var editingKnowledgeFile by remember { mutableStateOf<AgentKnowledgeFile?>(null) }
    var editingKnowledgeContent by remember { mutableStateOf("") }
    var knowledgeFileLoading by remember { mutableStateOf(false) }
    // MCP tool overrides and server trust
    var mcpToolOverrides by remember { mutableStateOf<List<AgentMcpToolOverride>>(emptyList()) }
    var mcpServerTrust by remember { mutableStateOf<List<AgentMcpServerTrust>>(emptyList()) }

    // Snapshot of loaded values for dirty-check
    var loadedName by remember { mutableStateOf("") }
    var loadedIcon by remember { mutableStateOf("") }
    var loadedSystemPrompt by remember { mutableStateOf("") }
    var loadedMemory by remember { mutableStateOf("") }
    var loadedAgenticMode by remember { mutableStateOf(false) }
    var loadedFullAutoApprove by remember { mutableStateOf(false) }
    var loadedBackend by remember { mutableStateOf<String?>(null) }
    var loadedCliModel by remember { mutableStateOf("") }
    var loadedHermesProfile by remember { mutableStateOf("") }
    var loadedResponseFormat by remember { mutableStateOf("default") }
    var loadedTemperature by remember { mutableFloatStateOf(0.7f) }
    var loadedMaxTokensText by remember { mutableStateOf("8192") }
    var loadedThinkingEffort by remember { mutableStateOf<String?>(null) }

    // Section expand state (persisted across config changes)
    var identityExpanded by rememberSaveable { mutableStateOf(true) }
    var behaviourExpanded by rememberSaveable { mutableStateOf(true) }
    var backendExpanded by rememberSaveable { mutableStateOf(false) }
    var generationExpanded by rememberSaveable { mutableStateOf(false) }
    var toolsExpanded by rememberSaveable { mutableStateOf(false) }
    var skillsExpanded by rememberSaveable { mutableStateOf(false) }
    var contextExpanded by rememberSaveable { mutableStateOf(false) }
    var contextRulesExpanded by rememberSaveable { mutableStateOf(false) }
    var customCommandsExpanded by rememberSaveable { mutableStateOf(false) }
    var mcpExpanded by rememberSaveable { mutableStateOf(false) }
    var knowledgeExpanded by rememberSaveable { mutableStateOf(false) }

    // Validation errors
    var nameError by remember { mutableStateOf<String?>(null) }
    var maxTokensError by remember { mutableStateOf<String?>(null) }
    var temperatureError by remember { mutableStateOf<String?>(null) }

    // Unsaved changes guard
    var showDiscardDialog by remember { mutableStateOf(false) }

    var saving by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    val hasUnsavedChanges = fullConfig != null && (
        name != loadedName ||
        icon != loadedIcon ||
        systemPrompt != loadedSystemPrompt ||
        memory != loadedMemory ||
        agenticMode != loadedAgenticMode ||
        fullAutoApprove != loadedFullAutoApprove ||
        backend != loadedBackend ||
        cliModel != loadedCliModel ||
        hermesProfile != loadedHermesProfile ||
        responseFormat != loadedResponseFormat ||
        temperature != loadedTemperature ||
        maxTokensText != loadedMaxTokensText ||
        thinkingEffort != loadedThinkingEffort
    )

    BackHandler(enabled = hasUnsavedChanges && !showDiscardDialog) {
        showDiscardDialog = true
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

    if (showFullAutoApproveDialog) {
        NexyConfirmDialog(
            title = "Enable auto-approve?",
            message = "This agent will execute all tool calls, including file edits, shell commands, and web requests, without asking for confirmation.",
            confirmLabel = "Enable auto-approve",
            onConfirm = {
                fullAutoApprove = true
                showFullAutoApproveDialog = false
            },
            onDismiss = { showFullAutoApproveDialog = false },
            destructive = true,
        )
    }

    if (showCliModelSheet) {
        ModalBottomSheet(
            onDismissRequest = { showCliModelSheet = false },
            sheetState = cliModelSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ModelPickerSheet(
                title = "CLI model (optional)",
                models = models,
                cliStatus = cliStatus,
                selectedModelId = cliModel.ifBlank { null },
                effectiveMode = effectiveMode,
            ) { modelId ->
                cliModel = modelId ?: ""
                scope.launch { cliModelSheetState.hide() }.invokeOnCompletion { showCliModelSheet = false }
            }
        }
    }

    LaunchedEffect(agentId) {
        WsRepository.agentFullConfig.value = null
        WsRepository.requestAgentFull(agentId)
        WsRepository.listSkills()
        WsRepository.getSkillAgentLinks(agentId)
        WsRepository.getMcpServers()
        WsRepository.listKnowledgeFiles(agentId)
        WsRepository.getMcpToolOverrides(agentId)
        WsRepository.getMcpServerTrust(agentId)
        // Hermes profile list + ACP readiness ride along with the CLI-status reply.
        WsRepository.getCliStatus()
    }

    LaunchedEffect(backend) {
        WsRepository.send("model:list", backend?.let { mapOf("backend" to it) } ?: emptyMap())
    }

    LaunchedEffect(fullConfig) {
        val c = fullConfig ?: return@LaunchedEffect
        name = c.name; loadedName = c.name
        icon = c.icon; loadedIcon = c.icon
        systemPrompt = c.systemPrompt; loadedSystemPrompt = c.systemPrompt
        memory = c.memory; loadedMemory = c.memory
        agenticMode = c.agenticMode; loadedAgenticMode = c.agenticMode
        fullAutoApprove = c.fullAutoApprove; loadedFullAutoApprove = c.fullAutoApprove
        backend = c.backend; loadedBackend = c.backend
        cliModel = c.cliModel ?: ""; loadedCliModel = c.cliModel ?: ""
        hermesProfile = c.hermesProfile ?: ""; loadedHermesProfile = c.hermesProfile ?: ""
        responseFormat = c.responseFormat; loadedResponseFormat = c.responseFormat
        temperature = c.temperature; loadedTemperature = c.temperature
        maxTokensText = c.maxTokens.toString(); loadedMaxTokensText = c.maxTokens.toString()
        thinkingEffort = c.thinkingEffort; loadedThinkingEffort = c.thinkingEffort
        fileEditEnabled = c.tools.fileEdit.enabled
        fileEditApproval = c.tools.fileEdit.approval
        fileEditInstructions = c.tools.fileEdit.instructions
        terminalEnabled = c.tools.terminal.enabled
        terminalApproval = c.tools.terminal.approval
        terminalInstructions = c.tools.terminal.instructions
        webFetchEnabled = c.tools.webFetch.enabled
        webFetchApproval = c.tools.webFetch.approval
        webFetchInstructions = c.tools.webFetch.instructions
        rootDirectory = c.rootDirectory ?: ""
        contextDirectories = c.contextDirectories
        contextFiles = c.contextFiles
        ignoredGlobs = c.contextRules?.ignoredGlobs ?: emptyList()
        autoInjectWorkspace = c.contextRules?.autoInjectWorkspace ?: true
        autoInjectGit = c.contextRules?.autoInjectGit ?: true
        customCommands = c.customCommands
        mcpServers = c.mcpServers
    }

    LaunchedEffect(agentId) {
        WsRepository.events.collect { event ->
            when {
                // Only react to the save THIS screen initiated. `agent:updated` is a broadcast:
                // a duplicate delivery (two live sockets after a reconnect) or a concurrent edit
                // from another client would otherwise call onBack() again and pop the back stack
                // past `home` into an empty NavHost — a persistent white screen needing a restart.
                // Gating on `saving` makes the navigate-back fire exactly once, for our own save.
                event is WsEvent.AgentUpdated && event.agent.id == agentId && saving -> {
                    saving = false
                    loadedName = name; loadedIcon = icon
                    loadedSystemPrompt = systemPrompt; loadedMemory = memory
                    loadedAgenticMode = agenticMode; loadedFullAutoApprove = fullAutoApprove
                    loadedBackend = backend
                    loadedCliModel = cliModel; loadedHermesProfile = hermesProfile
                    loadedResponseFormat = responseFormat
                    loadedTemperature = temperature; loadedMaxTokensText = maxTokensText
                    loadedThinkingEffort = thinkingEffort
                    if (isNew) WsRepository.pendingHighlightAgentId.value = agentId
                    onBack()
                }
                event is WsEvent.SkillAgentLinks && event.agentId == agentId -> {
                    attachedSkillIds = event.links.sortedBy { it.sortOrder }.map { it.skillId }
                }
                event is WsEvent.AgentKnowledgeFiles && event.agentId == agentId -> {
                    knowledgeFiles = event.files
                }
                event is WsEvent.AgentKnowledgeFileAdded && event.agentId == agentId -> {
                    knowledgeFiles = knowledgeFiles + event.file
                }
                event is WsEvent.AgentKnowledgeFileRemoved && event.agentId == agentId -> {
                    knowledgeFiles = knowledgeFiles.filter { it.id != event.id }
                }
                event is WsEvent.AgentKnowledgeFileContent && event.agentId == agentId -> {
                    knowledgeFileLoading = false
                    editingKnowledgeContent = event.content
                }
                event is WsEvent.AgentKnowledgeFileSaved && event.agentId == agentId -> {
                    editingKnowledgeFile = null
                    scope.launch { snackbarHostState.showSnackbar("File saved.") }
                }
                event is WsEvent.AgentKnowledgeFileError -> {
                    knowledgeFileLoading = false
                    scope.launch { snackbarHostState.showSnackbar(event.message) }
                }
                event is WsEvent.AgentMcpToolOverrides && event.agentId == agentId -> {
                    mcpToolOverrides = event.overrides
                }
                event is WsEvent.AgentMcpServerTrustList && event.agentId == agentId -> {
                    mcpServerTrust = event.trust
                }
            }
        }
    }

    // Core agent configuration is local-first. Desktop-only integrations remain inert until
    // synchronization/reconnection, but their configuration can still be prepared offline.
    val disconnected = false
    val loaded = fullConfig != null
    val backendLabel = backendOptions.find { it.first == backend }?.second ?: "Default (BYOK providers)"
    val responseFormatLabel = responseFormatOptions.find { it.first == responseFormat }?.second ?: "Default"
    val thinkingEffortLabel = thinkingEffortOptions.find { it.first == thinkingEffort }?.second ?: "Provider default"

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(
                        agent?.let {
                            if (it.icon.isNotBlank()) "${it.icon}  ${it.name}" else it.name
                        } ?: "Agent Config",
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                    )
                },
                onBack = { if (hasUnsavedChanges) showDiscardDialog = true else onBack() },
            )
        },
        bottomBar = {
            if (agent != null && loaded) {
                Surface(shadowElevation = 0.dp, tonalElevation = 0.dp, modifier = Modifier.navigationBarsPadding()) {
                    Button(
                        onClick = {
                            var valid = true
                            if (name.isBlank()) { nameError = "Name is required"; valid = false }
                            val maxTokensParsed = maxTokensText.trim().toIntOrNull()
                            if (maxTokensParsed == null || maxTokensParsed !in 256..128000) {
                                maxTokensError = "Enter a number between 256 and 128000"
                                valid = false
                            }
                            if (!valid || saving || disconnected) return@Button
                            saving = true
                            val data = buildAgentUpdatePayload(
                                AgentFullConfig(
                                    id = agentId,
                                    name = name.trim(),
                                    icon = icon.trim(),
                                    systemPrompt = systemPrompt.trim(),
                                    backend = backend,
                                    cliModel = cliModel.trim(),
                                    hermesProfile = hermesProfile.trim().ifBlank { null },
                                    temperature = temperature,
                                    maxTokens = maxTokensParsed!!.coerceIn(256, 128000),
                                    responseFormat = responseFormat,
                                    agenticMode = agenticMode,
                                    fullAutoApprove = fullAutoApprove,
                                    memory = memory.trim(),
                                    tools = AgentTools(
                                        fileEdit = ToolConfig(enabled = fileEditEnabled, approval = fileEditApproval, instructions = fileEditInstructions),
                                        terminal = ToolConfig(enabled = terminalEnabled, approval = terminalApproval, instructions = terminalInstructions),
                                        webFetch = ToolConfig(enabled = webFetchEnabled, approval = webFetchApproval, instructions = webFetchInstructions),
                                    ),
                                    mcpServers = mcpServers,
                                    thinkingEffort = thinkingEffort,
                                    rootDirectory = rootDirectory.trim(),
                                    contextDirectories = contextDirectories,
                                    contextFiles = contextFiles,
                                    contextRules = AgentContextRules(
                                        ignoredGlobs = ignoredGlobs,
                                        autoInjectWorkspace = autoInjectWorkspace,
                                        autoInjectGit = autoInjectGit,
                                    ),
                                    customCommands = customCommands,
                                )
                            )
                            WsRepository.send("agent:update", data)
                        },
                        enabled = !saving && !disconnected,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Text(if (saving) "Saving…" else "Save changes")
                    }
                }
            }
        },
    ) { padding ->
        if (agent == null) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("Agent not found.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onBack) { Text("Go back") }
            }
            return@Scaffold
        }

        if (!loaded) {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                NexyIcon(
                    name = NexyIconName.Busy,
                    contentDescription = "Loading agent configuration",
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
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            NexyConnectionBanner(connectionState)

            // — Identity —
            NexyExpandableSection(
                title = "Identity",
                expanded = identityExpanded,
                onToggle = { identityExpanded = !identityExpanded },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                        NexyInputValidation(
                            value = icon,
                            onValueChange = { icon = it },
                            label = "Icon",
                            singleLine = true,
                            enabled = !saving && !disconnected,
                            helperText = "An emoji shown next to this agent everywhere it appears",
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                            modifier = Modifier.weight(0.28f),
                        )
                        NexyInputValidation(
                            value = name,
                            onValueChange = { name = it; if (it.isNotBlank()) nameError = null },
                            label = "Name",
                            singleLine = true,
                            enabled = !saving && !disconnected,
                            errorMessage = nameError,
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true, imeAction = ImeAction.Done),
                            modifier = Modifier.weight(0.72f),
                        )
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Behaviour —
            NexyExpandableSection(
                title = "Behaviour",
                expanded = behaviourExpanded,
                onToggle = { behaviourExpanded = !behaviourExpanded },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    OutlinedTextField(
                        value = systemPrompt,
                        onValueChange = { systemPrompt = it },
                        label = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("System prompt")
                                NexyInfoIcon("Defines this agent's role and behavior. Sent as instructions before every message it handles.")
                            }
                        },
                        enabled = !saving && !disconnected,
                        minLines = 4,
                        maxLines = 12,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    OutlinedTextField(
                        value = memory,
                        onValueChange = { memory = it },
                        label = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Memory")
                                NexyInfoIcon("Always appended to the system prompt in every message — use it for facts or preferences that should persist across chats.")
                            }
                        },
                        placeholder = { Text("Notes this agent should always remember") },
                        enabled = !saving && !disconnected,
                        minLines = 3,
                        maxLines = 8,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text("Agentic mode", style = MaterialTheme.typography.bodyMedium)
                            Text("Allow autonomous multi-step actions", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(checked = agenticMode, onCheckedChange = { if (!saving && !disconnected) agenticMode = it }, enabled = !saving && !disconnected)
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Backend —
            NexyExpandableSection(
                title = "Backend",
                expanded = backendExpanded,
                onToggle = { backendExpanded = !backendExpanded },
                badge = backendOptions.find { it.first == backend }?.second?.takeIf { backend != null },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "Choose which engine runs this agent's chats: a BYOK provider (API key), or an installed CLI tool. A CLI backend must already be installed and authenticated.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    ExposedDropdownMenuBox(
                        expanded = backendMenuExpanded,
                        onExpandedChange = { if (!saving && !disconnected) backendMenuExpanded = it },
                    ) {
                        OutlinedTextField(
                            value = backendLabel,
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Backend") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = backendMenuExpanded) },
                            enabled = !saving && !disconnected,
                            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                        )
                        ExposedDropdownMenu(
                            expanded = backendMenuExpanded,
                            onDismissRequest = { backendMenuExpanded = false },
                        ) {
                            backendOptions.forEach { (value, label) ->
                                DropdownMenuItem(
                                    text = { Text(label) },
                                    onClick = {
                                        backend = value
                                        backendMenuExpanded = false
                                    },
                                )
                            }
                        }
                    }

                    if (backend != null) {
                        Box(modifier = Modifier.fillMaxWidth()) {
                            OutlinedTextField(
                                value = if (cliModel.isBlank()) "" else activeModelLabel(cliModel, models),
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("CLI model (optional)") },
                                placeholder = { Text("e.g. claude-sonnet-4-6") },
                                supportingText = { Text("Leave blank to use the CLI tool's own default model.") },
                                singleLine = true,
                                enabled = !saving && !disconnected,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            if (!saving && !disconnected) {
                                Box(
                                    modifier = Modifier
                                        .matchParentSize()
                                        .clickable { showCliModelSheet = true },
                                )
                            }
                        }
                    }

                    if (backend == "hermes-cli") {
                        HermesProfileField(
                            connected = effectiveMode == EffectiveConnectionMode.CONNECTED,
                            profiles = hermesInfo.profiles,
                            acpReady = hermesInfo.acpReady,
                            acpVersion = hermesInfo.version,
                            acpDetail = hermesInfo.acpDetail,
                            profileRoot = hermesInfo.profileRoot,
                            profilesDirectory = hermesInfo.profilesDirectory,
                            namedProfileCount = hermesInfo.namedProfileCount,
                            profileDiscoveryError = hermesInfo.profileDiscoveryError,
                            selected = hermesProfile,
                            expanded = hermesProfileMenuExpanded,
                            disabled = saving || disconnected,
                            onExpandedChange = { hermesProfileMenuExpanded = it },
                            onSelect = { hermesProfile = it },
                        )
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Generation —
            NexyExpandableSection(
                title = "Generation",
                expanded = generationExpanded,
                onToggle = { generationExpanded = !generationExpanded },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Response format", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            NexyInfoIcon("A label for this agent's intended response style, for your own reference — it doesn't currently change the model's actual output.")
                        }
                        ExposedDropdownMenuBox(
                            expanded = responseFormatMenuExpanded,
                            onExpandedChange = { if (!saving && !disconnected) responseFormatMenuExpanded = it },
                        ) {
                            OutlinedTextField(
                                value = responseFormatLabel,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("Response format") },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = responseFormatMenuExpanded) },
                                enabled = !saving && !disconnected,
                                modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                            )
                            ExposedDropdownMenu(
                                expanded = responseFormatMenuExpanded,
                                onDismissRequest = { responseFormatMenuExpanded = false },
                            ) {
                                responseFormatOptions.forEach { (value, label) ->
                                    DropdownMenuItem(
                                        text = { Text(label) },
                                        onClick = {
                                            responseFormat = value
                                            responseFormatMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Temperature", style = MaterialTheme.typography.bodyMedium)
                                NexyInfoIcon("Controls how much randomness the model uses when generating a response. Lower is more focused and repeatable; higher is more varied.")
                            }
                            Text("%.2f".format(temperature), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
                        }
                        Slider(
                            value = temperature,
                            onValueChange = { if (!saving && !disconnected) temperature = (it * 20).roundToInt() / 20f },
                            valueRange = 0f..1f,
                            steps = 19,
                            enabled = !saving && !disconnected,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Precise", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Creative", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }

                    NexyInputValidation(
                        value = maxTokensText,
                        onValueChange = { maxTokensText = it; maxTokensError = null },
                        label = "Max tokens",
                        placeholder = "256 – 128000",
                        singleLine = true,
                        enabled = !saving && !disconnected,
                        errorMessage = maxTokensError,
                        helperText = "The maximum length of the model's response. Higher values allow longer answers but cost more and take longer to generate.",
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Thinking effort", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            NexyInfoIcon("Extended reasoning before responding — supported on Claude CLI, Anthropic, and o-series models. Higher effort can improve complex answers but is slower.")
                        }
                        ExposedDropdownMenuBox(
                            expanded = thinkingEffortMenuExpanded,
                            onExpandedChange = { if (!saving && !disconnected) thinkingEffortMenuExpanded = it },
                        ) {
                            OutlinedTextField(
                                value = thinkingEffortLabel,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("Thinking effort") },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = thinkingEffortMenuExpanded) },
                                enabled = !saving && !disconnected,
                                modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                            )
                            ExposedDropdownMenu(
                                expanded = thinkingEffortMenuExpanded,
                                onDismissRequest = { thinkingEffortMenuExpanded = false },
                            ) {
                                thinkingEffortOptions.forEach { (value, label) ->
                                    DropdownMenuItem(
                                        text = { Text(label) },
                                        onClick = {
                                            thinkingEffort = value
                                            thinkingEffortMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Tools —
            NexyExpandableSection(
                title = "Tools",
                expanded = toolsExpanded,
                onToggle = { toolsExpanded = !toolsExpanded },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    ToolCard(
                        name = "File Edit",
                        description = "Read and modify files",
                        enabled = fileEditEnabled,
                        approval = fileEditApproval,
                        approvalExpanded = fileEditApprovalExpanded,
                        instructions = fileEditInstructions,
                        disabled = saving || disconnected,
                        onEnabledChange = { fileEditEnabled = it },
                        onApprovalChange = { fileEditApproval = it },
                        onApprovalExpandedChange = { fileEditApprovalExpanded = it },
                        onInstructionsChange = { fileEditInstructions = it },
                    )
                    ToolCard(
                        name = "Terminal",
                        description = "Run shell commands",
                        enabled = terminalEnabled,
                        approval = terminalApproval,
                        approvalExpanded = terminalApprovalExpanded,
                        instructions = terminalInstructions,
                        disabled = saving || disconnected,
                        onEnabledChange = { terminalEnabled = it },
                        onApprovalChange = { terminalApproval = it },
                        onApprovalExpandedChange = { terminalApprovalExpanded = it },
                        onInstructionsChange = { terminalInstructions = it },
                    )
                    ToolCard(
                        name = "Web Fetch",
                        description = "Fetch URLs and browse the web",
                        enabled = webFetchEnabled,
                        approval = webFetchApproval,
                        approvalExpanded = webFetchApprovalExpanded,
                        instructions = webFetchInstructions,
                        disabled = saving || disconnected,
                        onEnabledChange = { webFetchEnabled = it },
                        onApprovalChange = { webFetchApproval = it },
                        onApprovalExpandedChange = { webFetchApprovalExpanded = it },
                        onInstructionsChange = { webFetchInstructions = it },
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Skills —
            NexyExpandableSection(
                title = "Skills",
                expanded = skillsExpanded,
                onToggle = { skillsExpanded = !skillsExpanded },
                badge = attachedSkillIds.size.takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "Reusable instruction sets attached to this agent. Each one's instructions and knowledge are appended to the system prompt in the order shown below.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    SkillAttachmentsSection(
                        skills = skills,
                        attachedSkillIds = attachedSkillIds,
                        disabled = saving || disconnected,
                        onToggleSkill = { skillId, attach ->
                            WsRepository.attachSkillToAgent(agentId, skillId, attach)
                        },
                        onMoveSkill = { skillId, direction ->
                            val current = attachedSkillIds.toMutableList()
                            val index = current.indexOf(skillId)
                            val target = index + direction
                            if (index >= 0 && target in current.indices) {
                                current.removeAt(index)
                                current.add(target, skillId)
                                attachedSkillIds = current
                                WsRepository.reorderSkillsForAgent(agentId, current)
                            }
                        },
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Context —
            NexyExpandableSection(
                title = "Context",
                expanded = contextExpanded,
                onToggle = { contextExpanded = !contextExpanded },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    OutlinedTextField(
                        value = rootDirectory,
                        onValueChange = { rootDirectory = it },
                        label = { Text("Root directory") },
                        placeholder = { Text("Absolute path (optional)") },
                        supportingText = { Text("Working directory for CLI tool execution. Overrides the global default. If this agent runs inside a project, the project's own root directory takes priority.") },
                        singleLine = true,
                        enabled = !saving && !disconnected,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        StringListEditor(
                            label = "Context directories",
                            items = contextDirectories,
                            placeholder = "e.g. /path/to/dir",
                            disabled = saving || disconnected,
                            onItemsChange = { contextDirectories = it },
                        )
                        Text(
                            "Extra directories always included as context, in addition to the root directory above.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        StringListEditor(
                            label = "Context files",
                            items = contextFiles,
                            placeholder = "e.g. /path/to/file.txt",
                            disabled = saving || disconnected,
                            onItemsChange = { contextFiles = it },
                        )
                        Text(
                            "Specific files always included as context for this agent, regardless of which directory it's working in.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Context rules —
            NexyExpandableSection(
                title = "Context Rules",
                expanded = contextRulesExpanded,
                onToggle = { contextRulesExpanded = !contextRulesExpanded },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text("Auto-inject workspace", style = MaterialTheme.typography.bodyMedium)
                            Text("Include workspace file tree in context", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(checked = autoInjectWorkspace, onCheckedChange = { if (!saving && !disconnected) autoInjectWorkspace = it }, enabled = !saving && !disconnected)
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text("Auto-inject git status", style = MaterialTheme.typography.bodyMedium)
                            Text("Include git status summary in context", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(checked = autoInjectGit, onCheckedChange = { if (!saving && !disconnected) autoInjectGit = it }, enabled = !saving && !disconnected)
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        StringListEditor(
                            label = "Ignored globs",
                            items = ignoredGlobs,
                            placeholder = "e.g. **/*.log",
                            disabled = saving || disconnected,
                            onItemsChange = { ignoredGlobs = it },
                        )
                        Text(
                            "Files and paths matching these patterns are excluded from the auto-injected workspace file tree above.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Custom commands —
            NexyExpandableSection(
                title = "Custom Commands",
                expanded = customCommandsExpanded,
                onToggle = { customCommandsExpanded = !customCommandsExpanded },
                badge = customCommands.size.takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "Reusable slash commands for this agent — type /name in chat to insert the saved prompt instead of retyping it.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    CustomCommandsEditor(
                        commands = customCommands,
                        disabled = saving || disconnected,
                        onCommandsChange = { customCommands = it },
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — MCP servers —
            NexyExpandableSection(
                title = "MCP Servers",
                expanded = mcpExpanded,
                onToggle = { mcpExpanded = !mcpExpanded },
                badge = mcpServers.size.takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "MCP servers give this agent extra tools (e.g. a database or API integration). Assign a server, then set how much it's trusted to run without confirmation.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    McpServerAssignmentSection(
                        availableServers = availableMcpServers,
                        assignedServerIds = mcpServers,
                        mcpToolOverrides = mcpToolOverrides,
                        mcpServerTrust = mcpServerTrust,
                        disabled = saving || disconnected,
                        onToggleServer = { serverId, assign ->
                            mcpServers = if (assign) mcpServers + serverId else mcpServers.filter { it != serverId }
                        },
                        onSetTrust = { serverId, trust ->
                            WsRepository.setMcpServerTrust(agentId, serverId, trust)
                        },
                        onSetToolOverride = { serverId, toolName, enabled, approval, instructions ->
                            WsRepository.setMcpToolOverride(agentId, serverId, toolName, enabled, approval, instructions)
                        },
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Knowledge files —
            NexyExpandableSection(
                title = "Knowledge Files",
                expanded = knowledgeExpanded,
                onToggle = { knowledgeExpanded = !knowledgeExpanded },
                badge = knowledgeFiles.size.takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "Files this agent can read for extra context, edited directly from this device and synced to desktop.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    run {
                        val editing = editingKnowledgeFile
                        if (editing != null) {
                            KnowledgeFileEditorSection(
                                file = editing,
                                content = editingKnowledgeContent,
                                loading = knowledgeFileLoading,
                                disabled = saving || disconnected,
                                onContentChange = { editingKnowledgeContent = it },
                                onSave = {
                                    WsRepository.writeKnowledgeFile(agentId, editing.filePath, editingKnowledgeContent)
                                },
                                onCancel = { editingKnowledgeFile = null },
                            )
                        } else {
                            KnowledgeFilesSection(
                                files = knowledgeFiles,
                                disabled = saving || disconnected,
                                onAdd = { filePath ->
                                    WsRepository.addKnowledgeFile(agentId, filePath)
                                },
                                onRemove = { id ->
                                    WsRepository.removeKnowledgeFile(agentId, id)
                                },
                                onEdit = { file ->
                                    editingKnowledgeFile = file
                                    editingKnowledgeContent = ""
                                    knowledgeFileLoading = true
                                    WsRepository.readKnowledgeFile(agentId, file.filePath)
                                },
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            HorizontalDivider(color = MaterialTheme.colorScheme.error.copy(alpha = 0.3f))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
            ) {
                NexyIcon(NexyIconName.Warning, null, Modifier.size(14.dp), MaterialTheme.colorScheme.error)
                Text("Danger Zone", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "Auto-approve all actions",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        Text(
                            "All tool calls execute immediately without confirmation. Use only for fully trusted agents.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                    Switch(
                        checked = fullAutoApprove,
                        onCheckedChange = { checked ->
                            if (saving || disconnected) return@Switch
                            if (checked) showFullAutoApproveDialog = true else fullAutoApprove = false
                        },
                        enabled = !saving && !disconnected,
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
        }
    }
}

/**
 * Hermes profile picker for the Backend section, shown only when the Hermes backend is
 * selected. Android is a companion: the live profile list arrives over WebSocket from
 * desktop (`hermesInfo`), so the picker is meaningful only in connected mode. In
 * standalone/disconnected mode there is no desktop and no Hermes, so we surface a muted
 * note instead of a dropdown. Selecting a profile stores its name; blank means the
 * implicit `default` profile (no `--profile` flag).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HermesProfileField(
    connected: Boolean,
    profiles: List<HermesProfileInfo>,
    acpReady: Boolean,
    acpVersion: String?,
    acpDetail: String?,
    profileRoot: String?,
    profilesDirectory: String?,
    namedProfileCount: Int,
    profileDiscoveryError: String?,
    selected: String,
    expanded: Boolean,
    disabled: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Hermes profile", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            NexyInfoIcon("Each profile is a separate Hermes home with its own model, skills, and memory. Changing it starts a fresh Hermes session.")
        }

        if (!connected) {
            Text(
                "Connect to your desktop to choose a Hermes profile — the profile list comes from the machine that runs Hermes.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@Column
        }

        val knownNames = profiles.map { it.name }.toSet()
        val isUnknown = selected.isNotBlank() && selected !in knownNames
        val fieldLabel = when {
            selected.isBlank() -> "Default (normal Hermes profile)"
            isUnknown -> "⚠ $selected — unknown profile, will fall back to default"
            else -> selected
        }

        when {
            profileDiscoveryError != null -> Text(
                "Profile discovery failed: $profileDiscoveryError",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
            namedProfileCount == 0 -> Text(
                "Only the default profile was found. On the connected desktop, open Settings → CLI Tools and choose the Hermes home containing profiles. Current location: ${profilesDirectory ?: profileRoot ?: "the Hermes home"}.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { if (!disabled) onExpandedChange(it) },
        ) {
            OutlinedTextField(
                value = fieldLabel,
                onValueChange = {},
                readOnly = true,
                label = { Text("Profile") },
                isError = isUnknown,
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                enabled = !disabled,
                modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
            )
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { onExpandedChange(false) },
            ) {
                DropdownMenuItem(
                    text = { Text("Default (normal Hermes profile)") },
                    onClick = { onSelect(""); onExpandedChange(false) },
                )
                profiles.filterNot { it.isDefault }.forEach { profile ->
                    val subtitle = listOfNotNull(profile.model, profile.description)
                        .joinToString(" · ")
                        .takeIf { it.isNotBlank() }
                    DropdownMenuItem(
                        text = {
                            Column {
                                Text(profile.name)
                                if (subtitle != null) {
                                    Text(
                                        subtitle,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        },
                        onClick = { onSelect(profile.name); onExpandedChange(false) },
                    )
                }
                if (isUnknown) {
                    DropdownMenuItem(
                        text = {
                            Text(
                                "⚠ $selected — unknown, falls back to default",
                                color = MaterialTheme.colorScheme.error,
                            )
                        },
                        onClick = { onExpandedChange(false) },
                    )
                }
            }
        }

        // D1 inheritance disclosure — mirrors desktop SettingsTab so users understand the
        // picked profile brings its own memory/skills/SOUL.md into every session (not a sandbox).
        Text(
            "Nexy runs Hermes with this profile's own home — its memory, skills, and SOUL.md carry into every session. Profiles are managed in the Hermes CLI.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            if (acpReady) "Hermes ACP is ready${acpVersion?.let { " ($it)" } ?: ""}."
            else "Hermes ACP is not ready${acpDetail?.let { " — $it" } ?: " — run Hermes setup/auth on the desktop, then reconnect."}",
            style = MaterialTheme.typography.bodySmall,
            color = if (acpReady) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ToolCard(
    name: String,
    description: String,
    enabled: Boolean,
    approval: String,
    approvalExpanded: Boolean,
    instructions: String,
    disabled: Boolean,
    onEnabledChange: (Boolean) -> Unit,
    onApprovalChange: (String) -> Unit,
    onApprovalExpandedChange: (Boolean) -> Unit,
    onInstructionsChange: (String) -> Unit,
) {
    val approvalLabel = approvalOptions.find { it.first == approval }?.second ?: "Always ask"
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(name, style = MaterialTheme.typography.bodyMedium)
                    Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = enabled, onCheckedChange = { if (!disabled) onEnabledChange(it) }, enabled = !disabled)
            }
            if (enabled) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Approval", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        NexyInfoIcon("Auto runs this tool without asking; Always ask prompts you to confirm each use; Disabled blocks it entirely even though it's enabled above.")
                    }
                    ExposedDropdownMenuBox(
                        expanded = approvalExpanded,
                        onExpandedChange = { if (!disabled) onApprovalExpandedChange(it) },
                    ) {
                        OutlinedTextField(
                            value = approvalLabel,
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Approval") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = approvalExpanded) },
                            enabled = !disabled,
                            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                        )
                        ExposedDropdownMenu(
                            expanded = approvalExpanded,
                            onDismissRequest = { onApprovalExpandedChange(false) },
                        ) {
                            approvalOptions.forEach { (value, label) ->
                                DropdownMenuItem(
                                    text = { Text(label) },
                                    onClick = {
                                        onApprovalChange(value)
                                        onApprovalExpandedChange(false)
                                    },
                                )
                            }
                        }
                    }
                }
                OutlinedTextField(
                    value = instructions,
                    onValueChange = { if (!disabled) onInstructionsChange(it) },
                    label = { Text("Instructions (optional)") },
                    placeholder = { Text("Additional guidance for this tool") },
                    supportingText = { Text("Extra guidance the agent sees only when deciding how to use this specific tool.") },
                    enabled = !disabled,
                    minLines = 2,
                    maxLines = 5,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun StringListEditor(
    label: String,
    items: List<String>,
    placeholder: String,
    disabled: Boolean,
    onItemsChange: (List<String>) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            IconButton(
                onClick = { onItemsChange(items + "") },
                enabled = !disabled,
            ) {
                NexyIcon(NexyIconName.Add, "Add $label", Modifier.size(18.dp))
            }
        }
        items.forEachIndexed { index, item ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                OutlinedTextField(
                    value = item,
                    onValueChange = { newVal ->
                        val updated = items.toMutableList()
                        updated[index] = newVal
                        onItemsChange(updated)
                    },
                    placeholder = { Text(placeholder) },
                    singleLine = true,
                    enabled = !disabled,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = {
                        val updated = items.toMutableList()
                        updated.removeAt(index)
                        onItemsChange(updated)
                    },
                    enabled = !disabled,
                ) {
                    NexyIcon(NexyIconName.Delete, "Remove", Modifier.size(18.dp), MaterialTheme.colorScheme.error)
                }
            }
        }
        if (items.isEmpty()) {
            Text("None", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun CustomCommandsEditor(
    commands: List<AgentCustomCommand>,
    disabled: Boolean,
    onCommandsChange: (List<AgentCustomCommand>) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (commands.isEmpty()) "No custom commands" else "${commands.size} command(s)",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            IconButton(
                onClick = { onCommandsChange(commands + AgentCustomCommand(name = "", description = "", prompt = "")) },
                enabled = !disabled,
            ) {
                NexyIcon(NexyIconName.Add, "Add command", Modifier.size(18.dp))
            }
        }
        commands.forEachIndexed { index, cmd ->
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            ) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Command ${index + 1}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        IconButton(
                            onClick = {
                                val updated = commands.toMutableList()
                                updated.removeAt(index)
                                onCommandsChange(updated)
                            },
                            enabled = !disabled,
                        ) {
                            NexyIcon(NexyIconName.Delete, "Remove command", Modifier.size(18.dp), MaterialTheme.colorScheme.error)
                        }
                    }
                    OutlinedTextField(
                        value = cmd.name,
                        onValueChange = { newVal ->
                            val updated = commands.toMutableList()
                            updated[index] = cmd.copy(name = newVal)
                            onCommandsChange(updated)
                        },
                        label = { Text("Name") },
                        placeholder = { Text("e.g. /review") },
                        singleLine = true,
                        enabled = !disabled,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = cmd.description,
                        onValueChange = { newVal ->
                            val updated = commands.toMutableList()
                            updated[index] = cmd.copy(description = newVal)
                            onCommandsChange(updated)
                        },
                        label = { Text("Description") },
                        singleLine = true,
                        enabled = !disabled,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true, imeAction = ImeAction.Next),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = cmd.prompt,
                        onValueChange = { newVal ->
                            val updated = commands.toMutableList()
                            updated[index] = cmd.copy(prompt = newVal)
                            onCommandsChange(updated)
                        },
                        label = { Text("Prompt") },
                        enabled = !disabled,
                        minLines = 3,
                        maxLines = 8,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

@Composable
private fun SkillAttachmentsSection(
    skills: List<SkillConfig>,
    attachedSkillIds: List<String>,
    disabled: Boolean,
    onToggleSkill: (skillId: String, attach: Boolean) -> Unit,
    onMoveSkill: (skillId: String, direction: Int) -> Unit,
) {
    var skillSearch by remember { mutableStateOf("") }

    if (skills.isEmpty()) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = MaterialTheme.shapes.extraSmall,
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("No skills available.", style = MaterialTheme.typography.bodyMedium)
                Text(
                    "Create skills from the Skills screen, then attach them here.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        return
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        NexySearchField(
            query = skillSearch,
            onQueryChange = { skillSearch = it },
            placeholder = "Search skills",
            debounceMs = 200L,
        )

        Text(
            if (attachedSkillIds.isEmpty()) "No skills attached." else "${attachedSkillIds.size} skill(s) attached.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        val orderedSkills = skills.sortedWith(compareBy<SkillConfig> {
            val index = attachedSkillIds.indexOf(it.id)
            if (index == -1) Int.MAX_VALUE else index
        }.thenBy { it.name.lowercase() })

        val filteredSkills = remember(orderedSkills, skillSearch) {
            if (skillSearch.isBlank()) orderedSkills
            else orderedSkills.filter {
                it.name.contains(skillSearch, ignoreCase = true) ||
                it.description.contains(skillSearch, ignoreCase = true)
            }
        }

        if (filteredSkills.isEmpty()) {
            Text(
                "No skills match \"$skillSearch\".",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            filteredSkills.forEach { skill ->
                SkillAttachmentRow(
                    skill = skill,
                    attached = attachedSkillIds.contains(skill.id),
                    canMoveUp = attachedSkillIds.indexOf(skill.id) > 0,
                    canMoveDown = attachedSkillIds.indexOf(skill.id).let { it >= 0 && it < attachedSkillIds.lastIndex },
                    disabled = disabled,
                    onToggle = { onToggleSkill(skill.id, it) },
                    onMoveUp = { onMoveSkill(skill.id, -1) },
                    onMoveDown = { onMoveSkill(skill.id, 1) },
                )
            }
        }
    }
}

@Composable
private fun SkillAttachmentRow(
    skill: SkillConfig,
    attached: Boolean,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    disabled: Boolean,
    onToggle: (Boolean) -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (attached) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(skill.icon.ifBlank { "*" }, style = MaterialTheme.typography.titleMedium)
                    Column(modifier = Modifier.weight(1f)) {
                        Text(skill.name, style = MaterialTheme.typography.bodyMedium)
                        if (skill.description.isNotBlank()) {
                            Text(
                                skill.description,
                                style = MaterialTheme.typography.bodySmall,
                                color = if (attached) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                            )
                        }
                    }
                }
                Switch(
                    checked = attached,
                    onCheckedChange = { if (!disabled) onToggle(it) },
                    enabled = !disabled,
                )
            }
            if (attached) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(
                        onClick = onMoveUp,
                        enabled = !disabled && canMoveUp,
                        modifier = Modifier.size(48.dp),
                    ) {
                        NexyIcon(
                            name = NexyIconName.ChevronUp,
                            contentDescription = "Move ${skill.name} up",
                            modifier = Modifier.size(18.dp),
                            tint = if (canMoveUp) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.38f),
                        )
                    }
                    IconButton(
                        onClick = onMoveDown,
                        enabled = !disabled && canMoveDown,
                        modifier = Modifier.size(48.dp),
                    ) {
                        NexyIcon(
                            name = NexyIconName.ChevronDown,
                            contentDescription = "Move ${skill.name} down",
                            modifier = Modifier.size(18.dp),
                            tint = if (canMoveDown) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.38f),
                        )
                    }
                }
            }
        }
    }
}

private val mcpTrustOptions = listOf(
    "auto" to "Auto (inherit server default)",
    "always-ask" to "Always ask",
    "block" to "Block",
)

private val mcpApprovalOptions = listOf(
    "auto" to "Auto",
    "always-ask" to "Always ask",
    "disabled" to "Disabled",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun McpServerAssignmentSection(
    availableServers: List<McpServerInfo>,
    assignedServerIds: List<String>,
    mcpToolOverrides: List<AgentMcpToolOverride>,
    mcpServerTrust: List<AgentMcpServerTrust>,
    disabled: Boolean,
    onToggleServer: (serverId: String, assign: Boolean) -> Unit,
    onSetTrust: (serverId: String, trust: String) -> Unit,
    onSetToolOverride: (serverId: String, toolName: String, enabled: Boolean, approval: String, instructions: String) -> Unit,
) {
    if (availableServers.isEmpty()) {
        Text(
            "No MCP servers configured. Add servers in the MCP Servers settings.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        availableServers.forEach { server ->
            val assigned = assignedServerIds.contains(server.id)
            val trust = mcpServerTrust.find { it.serverId == server.id }?.trust ?: "auto"
            var trustExpanded by remember { mutableStateOf(false) }
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = if (assigned) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                ),
            ) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(server.name, style = MaterialTheme.typography.bodyMedium)
                            Text(server.command, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        }
                        Switch(
                            checked = assigned,
                            onCheckedChange = { if (!disabled) onToggleServer(server.id, it) },
                            enabled = !disabled,
                        )
                    }
                    if (assigned) {
                        val trustLabel = mcpTrustOptions.find { it.first == trust }?.second ?: "Auto"
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            ExposedDropdownMenuBox(
                                expanded = trustExpanded,
                                onExpandedChange = { if (!disabled) trustExpanded = it },
                            ) {
                                OutlinedTextField(
                                    value = trustLabel,
                                    onValueChange = {},
                                    readOnly = true,
                                    label = { Text("Trust") },
                                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = trustExpanded) },
                                    enabled = !disabled,
                                    modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                                )
                                ExposedDropdownMenu(expanded = trustExpanded, onDismissRequest = { trustExpanded = false }) {
                                    mcpTrustOptions.forEach { (value, label) ->
                                        DropdownMenuItem(
                                            text = { Text(label) },
                                            onClick = {
                                                onSetTrust(server.id, value)
                                                trustExpanded = false
                                            },
                                        )
                                    }
                                }
                            }
                            Text(
                                "How much this agent can use this server's tools without your confirmation each time.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun KnowledgeFilesSection(
    files: List<AgentKnowledgeFile>,
    disabled: Boolean,
    onAdd: (filePath: String) -> Unit,
    onRemove: (id: String) -> Unit,
    onEdit: (file: AgentKnowledgeFile) -> Unit,
) {
    var addingPath by remember { mutableStateOf("") }
    var showAddField by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (files.isEmpty()) {
            Text(
                "No knowledge files. Add file paths to inject into context.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            files.forEach { file ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                file.filePath.substringAfterLast('/').substringAfterLast('\\'),
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 1,
                            )
                            Text(
                                "Inject: ${file.injectMode}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Row {
                            TextButton(onClick = { onEdit(file) }, enabled = !disabled) { Text("Edit") }
                            IconButton(onClick = { onRemove(file.id) }, enabled = !disabled) {
                                NexyIcon(NexyIconName.Delete, "Remove knowledge file", Modifier.size(18.dp), MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        }
        if (showAddField) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = addingPath,
                    onValueChange = { addingPath = it },
                    label = { Text("File path") },
                    placeholder = { Text("/absolute/path/to/file.md") },
                    singleLine = true,
                    enabled = !disabled,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    onClick = {
                        if (addingPath.isNotBlank()) {
                            onAdd(addingPath.trim())
                            addingPath = ""
                            showAddField = false
                        }
                    },
                    enabled = !disabled && addingPath.isNotBlank(),
                ) { Text("Add") }
                TextButton(onClick = { showAddField = false; addingPath = "" }) { Text("Cancel") }
            }
        } else {
            TextButton(onClick = { showAddField = true }, enabled = !disabled) {
                NexyIcon(NexyIconName.Add, null, Modifier.size(18.dp))
                Text("Add file")
            }
        }
    }
}

@Composable
private fun KnowledgeFileEditorSection(
    file: AgentKnowledgeFile,
    content: String,
    loading: Boolean,
    disabled: Boolean,
    onContentChange: (String) -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                file.filePath.substringAfterLast('/').substringAfterLast('\\'),
                style = MaterialTheme.typography.bodyMedium,
            )
            Row {
                TextButton(onClick = onSave, enabled = !disabled && !loading) { Text("Save") }
                TextButton(onClick = onCancel) { Text("Cancel") }
            }
        }
        if (loading) {
            NexyIcon(
                name = NexyIconName.Busy,
                contentDescription = "Loading knowledge file",
                modifier = Modifier.align(Alignment.CenterHorizontally).size(24.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
        } else {
            OutlinedTextField(
                value = content,
                onValueChange = onContentChange,
                label = { Text("Content") },
                enabled = !disabled,
                minLines = 6,
                maxLines = 20,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

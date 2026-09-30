package io.nexy.android.ui.settings

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Surface
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.nexy.android.ui.theme.NexySurfaceShape as RectangleShape
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.McpServerWithStatus
import io.nexy.android.data.model.McpToolInfo
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyFormSheet
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun McpAndCliScreen(onBack: () -> Unit) {
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val mcpServers by WsRepository.mcpServers.collectAsStateWithLifecycle()
    val cliStatus by WsRepository.cliStatus.collectAsStateWithLifecycle()
    val disconnected = connectionState != ConnectionState.CONNECTED

    var showAddSheet by remember { mutableStateOf(false) }
    var editingServer by remember { mutableStateOf<McpServerInfo?>(null) }
    var deleteTarget by remember { mutableStateOf<McpServerInfo?>(null) }
    var serverToStatus by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var tools by remember { mutableStateOf<List<McpToolInfo>>(emptyList()) }
    var showTools by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        WsRepository.getMcpServers()
        WsRepository.getCliStatus()
    }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.McpServerAdded -> WsRepository.getMcpServers()
                is WsEvent.McpServerUpdated -> {
                    serverToStatus = serverToStatus + (event.server.id to event.server.status)
                    WsRepository.getMcpServers()
                }
                is WsEvent.McpServerRemoved -> Unit
                is WsEvent.McpServerStatus -> serverToStatus = serverToStatus + (event.id to event.status)
                is WsEvent.McpToolList -> tools = event.tools
                else -> {}
            }
        }
    }

    if (showAddSheet) {
        McpServerWizard(
            onConfirm = { name, command, args, enabled ->
                WsRepository.addMcpServer(name = name, command = command, args = args, enabled = enabled)
                showAddSheet = false
            },
            onDismiss = { showAddSheet = false },
        )
    }
    if (editingServer != null) {
        McpServerFormSheet(
            server = editingServer,
            onConfirm = { name, command, args, enabled ->
                val existing = editingServer!!
                WsRepository.updateMcpServer(existing.id, name = name, command = command, args = args.split(" ").filter { it.isNotBlank() }, enabled = enabled)
                editingServer = null
            },
            onDismiss = { editingServer = null },
        )
    }

    val dt = deleteTarget
    if (dt != null) {
        NexyConfirmDialog(
            title = "Remove MCP server?",
            message = "\"${dt.name}\" will be removed from the desktop.",
            confirmLabel = "Remove",
            destructive = true,
            onConfirm = { WsRepository.removeMcpServer(dt.id); deleteTarget = null },
            onDismiss = { deleteTarget = null },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("MCP Servers & CLI Models", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Configuration",
            )
        },
        floatingActionButton = {
            if (!disconnected) {
                FloatingActionButton(onClick = { showAddSheet = true }) {
                    NexyIcon(NexyIconName.Add, contentDescription = "Add MCP server")
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            McpCliSectionHeader("CLI Models")

            if (disconnected) {
                Text("Not connected to desktop.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (cliStatus.isEmpty()) {
                Text("Loading…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                cliStatus.entries.toList().sortedBy { it.key }.forEach { (name, info) ->
                    CliStatusCard(name = name, info = info)
                }
            }

            McpCliSectionHeader("MCP Servers")

            if (disconnected) {
                Text("Not connected to desktop.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (mcpServers.isEmpty()) {
                Text("No MCP servers configured on the desktop.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                mcpServers.forEach { server ->
                    McpServerCard(
                        server = server,
                        status = serverToStatus[server.id] ?: server.status,
                        onEdit = { editingServer = server },
                        onDelete = { deleteTarget = server },
                        onRestart = { WsRepository.restartMcpServer(server.id); WsRepository.getMcpServerStatus(server.id) },
                    )
                }
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
                TextButton(onClick = { WsRepository.listMcpTools(); showTools = !showTools }, enabled = !disconnected) {
                    Text(if (showTools) "Hide tools" else "Show all tools")
                }
            }

            if (showTools) {
                if (tools.isEmpty()) {
                    Text("No tools available (servers may be disconnected).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    McpCliSectionHeader("Available Tools (${tools.size})")
                    tools.forEach { tool ->
                        McpToolRow(tool)
                    }
                }
            }
        }
    }
}

@Composable
private fun CliStatusCard(name: String, info: CliInstallInfo) {
    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                Text(name, style = MaterialTheme.typography.bodyMedium)
                if (info.version != null) Text("v${info.version}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (info.path != null) Text(info.path, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            }
            Text(
                if (info.installed) "Installed" else "Not installed",
                style = MaterialTheme.typography.labelSmall,
                color = if (info.installed) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun McpServerCard(
    server: McpServerInfo,
    status: String?,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onRestart: () -> Unit,
) {
    val statusColor = when (status) {
        "connected" -> MaterialTheme.colorScheme.primary
        "error" -> MaterialTheme.colorScheme.error
        "connecting" -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f).padding(end = 4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(server.name, style = MaterialTheme.typography.bodyMedium)
                    if (!server.enabled) {
                        Text("disabled", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (server.command.isNotBlank()) Text(server.command, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                if (status != null) Text(status, style = MaterialTheme.typography.labelSmall, color = statusColor)
            }
            if (!server.managed) {
                Row {
                    IconButton(onClick = onRestart) { NexyIcon(NexyIconName.Tool, contentDescription = "Restart", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                    IconButton(onClick = onEdit) { NexyIcon(NexyIconName.Edit, contentDescription = "Edit") }
                    IconButton(onClick = onDelete) { NexyIcon(NexyIconName.Delete, contentDescription = "Delete", tint = MaterialTheme.colorScheme.error) }
                }
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun McpToolRow(tool: McpToolInfo) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(tool.name, style = MaterialTheme.typography.bodySmall)
            Text(tool.serverName, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!tool.description.isNullOrBlank()) {
            Text(tool.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

private enum class McpServerType(val label: String, val description: String) {
    Npm("npm package", "Run an MCP server published as an npm package via npx"),
    LocalScript("Local script", "Run a script or binary already installed on the desktop"),
    Docker("Docker container", "Run an MCP server inside a Docker container"),
    Manual("Manual / advanced", "Enter the command and arguments yourself"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun McpServerWizard(
    onConfirm: (name: String, command: String, args: List<String>, enabled: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var step by remember { mutableIntStateOf(0) }
    var selectedType by remember { mutableStateOf<McpServerType?>(null) }

    // Step 2 fields
    var name by remember { mutableStateOf("") }
    var npmPackage by remember { mutableStateOf("") }
    var npmExtraArgs by remember { mutableStateOf("") }
    var scriptPath by remember { mutableStateOf("") }
    var scriptArgs by remember { mutableStateOf("") }
    var dockerImage by remember { mutableStateOf("") }
    var dockerArgs by remember { mutableStateOf("") }
    var manualCommand by remember { mutableStateOf("") }
    var manualArgs by remember { mutableStateOf("") }
    var enabled by remember { mutableStateOf(true) }

    fun buildCommandAndArgs(): Pair<String, List<String>> = when (selectedType) {
        McpServerType.Npm -> {
            val pkg = npmPackage.trim()
            val extra = npmExtraArgs.trim().split(" ").filter { it.isNotBlank() }
            "npx" to (listOf("-y", pkg) + extra)
        }
        McpServerType.LocalScript -> {
            val parts = scriptPath.trim().split(" ").filter { it.isNotBlank() }
            val cmd = parts.firstOrNull() ?: ""
            val scriptArgList = (parts.drop(1) + scriptArgs.trim().split(" ").filter { it.isNotBlank() })
            cmd to scriptArgList
        }
        McpServerType.Docker -> {
            val extra = dockerArgs.trim().split(" ").filter { it.isNotBlank() }
            "docker" to (listOf("run", "--rm", "-i", dockerImage.trim()) + extra)
        }
        McpServerType.Manual -> {
            manualCommand.trim() to manualArgs.trim().split(" ").filter { it.isNotBlank() }
        }
        null -> "" to emptyList()
    }

    val (previewCommand, previewArgs) = buildCommandAndArgs()
    val previewFull = if (previewCommand.isBlank()) "" else (listOf(previewCommand) + previewArgs).joinToString(" ")

    val step2Valid = when (selectedType) {
        McpServerType.Npm -> name.isNotBlank() && npmPackage.isNotBlank()
        McpServerType.LocalScript -> name.isNotBlank() && scriptPath.isNotBlank()
        McpServerType.Docker -> name.isNotBlank() && dockerImage.isNotBlank()
        McpServerType.Manual -> name.isNotBlank() && manualCommand.isNotBlank()
        null -> false
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Step indicator
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = when (step) {
                        0 -> "Step 1 of 3 — Choose type"
                        1 -> "Step 2 of 3 — Configure"
                        else -> "Step 3 of 3 — Review"
                    },
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    "Cancel",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clickable(onClick = onDismiss),
                )
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            when (step) {
                // ── Step 1: type picker ──────────────────────────────────────
                0 -> {
                    McpServerType.entries.forEach { type ->
                        val selected = selectedType == type
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { selectedType = type },
                            border = BorderStroke(
                                width = if (selected) 2.dp else 1.dp,
                                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                            ),
                            colors = CardDefaults.cardColors(
                                containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                            ),
                            shape = RectangleShape,
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(type.label, style = MaterialTheme.typography.bodyMedium)
                                    Text(type.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                if (selected) {
                                    NexyIcon(NexyIconName.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        Button(onClick = { step = 1 }, enabled = selectedType != null) { Text("Next") }
                    }
                }

                // ── Step 2: type-specific config ─────────────────────────────
                1 -> {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Server name") },
                        placeholder = { Text("e.g. Filesystem") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    when (selectedType) {
                        McpServerType.Npm -> {
                            OutlinedTextField(
                                value = npmPackage,
                                onValueChange = { npmPackage = it },
                                label = { Text("npm package") },
                                placeholder = { Text("e.g. @modelcontextprotocol/server-filesystem") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            OutlinedTextField(
                                value = npmExtraArgs,
                                onValueChange = { npmExtraArgs = it },
                                label = { Text("Extra arguments (optional)") },
                                placeholder = { Text("e.g. /Users/me/projects") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text(
                                "Command will run: npx -y <package> [extra args]",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        McpServerType.LocalScript -> {
                            OutlinedTextField(
                                value = scriptPath,
                                onValueChange = { scriptPath = it },
                                label = { Text("Script or binary path") },
                                placeholder = { Text("e.g. /usr/local/bin/mcp-server or python3") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            OutlinedTextField(
                                value = scriptArgs,
                                onValueChange = { scriptArgs = it },
                                label = { Text("Arguments (optional)") },
                                placeholder = { Text("e.g. /path/to/script.py") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        McpServerType.Docker -> {
                            OutlinedTextField(
                                value = dockerImage,
                                onValueChange = { dockerImage = it },
                                label = { Text("Docker image") },
                                placeholder = { Text("e.g. mcp/filesystem:latest") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            OutlinedTextField(
                                value = dockerArgs,
                                onValueChange = { dockerArgs = it },
                                label = { Text("Extra docker run arguments (optional)") },
                                placeholder = { Text("e.g. -v /host:/container") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text(
                                "Command will run: docker run --rm -i <image> [extra args]",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        McpServerType.Manual -> {
                            OutlinedTextField(
                                value = manualCommand,
                                onValueChange = { manualCommand = it },
                                label = { Text("Command") },
                                placeholder = { Text("e.g. npx") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            OutlinedTextField(
                                value = manualArgs,
                                onValueChange = { manualArgs = it },
                                label = { Text("Arguments (space-separated)") },
                                placeholder = { Text("e.g. -y @modelcontextprotocol/server-github") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        null -> {}
                    }
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Enable on save", style = MaterialTheme.typography.bodyMedium)
                        Switch(checked = enabled, onCheckedChange = { enabled = it })
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton(onClick = { step = 0 }) { Text("Back") }
                        Button(onClick = { step = 2 }, enabled = step2Valid) { Text("Review") }
                    }
                }

                // ── Step 3: review & confirm ─────────────────────────────────
                else -> {
                    Text("Review your MCP server configuration:", style = MaterialTheme.typography.bodyMedium)
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RectangleShape,
                    ) {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Row {
                                Text("Name: ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(name, style = MaterialTheme.typography.bodySmall)
                            }
                            Row {
                                Text("Type: ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(selectedType?.label ?: "", style = MaterialTheme.typography.bodySmall)
                            }
                            Row {
                                Text("Enabled: ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(if (enabled) "Yes" else "No", style = MaterialTheme.typography.bodySmall)
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(vertical = 4.dp))
                            Text("Full command:", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                previewFull.ifBlank { "(none)" },
                                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                            )
                        }
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton(onClick = { step = 1 }) { Text("Back") }
                        Button(
                            onClick = { onConfirm(name.trim(), previewCommand, previewArgs, enabled) },
                            enabled = previewCommand.isNotBlank(),
                        ) { Text("Add server") }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun McpServerFormSheet(
    server: McpServerInfo?,
    onConfirm: (name: String, command: String, args: String, enabled: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(server?.name ?: "") }
    var command by remember { mutableStateOf(server?.command ?: "") }
    var args by remember { mutableStateOf("") }
    var enabled by remember { mutableStateOf(server?.enabled ?: true) }

    NexyFormSheet(
        title = if (server != null) "Edit MCP Server" else "Add MCP Server",
        confirmLabel = if (server != null) "Save" else "Add",
        onConfirm = { onConfirm(name.trim(), command.trim(), args.trim(), enabled) },
        onDismiss = onDismiss,
        confirmEnabled = name.isNotBlank() && command.isNotBlank(),
    ) {
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Server name") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true))
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = command, onValueChange = { command = it }, label = { Text("Command") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = args, onValueChange = { args = it }, label = { Text("Arguments (space-separated)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Spacer(Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Enabled", style = MaterialTheme.typography.bodyMedium)
            Switch(checked = enabled, onCheckedChange = { enabled = it })
        }
    }
}

@Composable
private fun McpCliSectionHeader(title: String) {
    Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

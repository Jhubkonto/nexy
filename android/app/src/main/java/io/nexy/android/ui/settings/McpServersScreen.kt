package io.nexy.android.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.platform.LocalContext
import io.nexy.android.ui.theme.NexySurfaceShape as RectangleShape
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.McpToolInfo
import io.nexy.android.data.model.McpCatalogEntry
import io.nexy.android.data.model.McpCatalogRequiredEnv
import io.nexy.android.data.model.McpRegistryEnvRequirement
import io.nexy.android.data.model.McpRegistrySearchResult
import io.nexy.android.data.model.McpRegistryServer
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyFormSheet
import io.nexy.android.ui.components.NexyGhostButton
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexyStatusBadge
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName

private val McpServerCardHeight = 136.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun McpServersScreen(onBack: () -> Unit) {
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val mcpServers by WsRepository.mcpServers.collectAsStateWithLifecycle()
    val mcpCatalog by WsRepository.mcpCatalog.collectAsStateWithLifecycle()
    val disconnected = connectionState != ConnectionState.CONNECTED

    var showAddSheet by remember { mutableStateOf(false) }
    var editingServer by remember { mutableStateOf<McpServerInfo?>(null) }
    var deleteTarget by remember { mutableStateOf<McpServerInfo?>(null) }
    var detailServer by remember { mutableStateOf<McpServerInfo?>(null) }
    var serverToStatus by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var serverToError by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var tools by remember { mutableStateOf<List<McpToolInfo>>(emptyList()) }
    var refreshing by remember { mutableStateOf(false) }
    var testingConnection by remember { mutableStateOf(false) }
    var testResult by remember { mutableStateOf<WsEvent.McpTestResult?>(null) }
    var registryResult by remember { mutableStateOf<McpRegistrySearchResult?>(null) }
    var registryLoading by remember { mutableStateOf(false) }
    var registryError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        WsRepository.getMcpServers()
        WsRepository.getMcpCatalog()
        WsRepository.listMcpTools()
        WsRepository.send("project:list")
    }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.McpList -> {
                    refreshing = false
                    serverToStatus = event.servers.mapNotNull { server -> server.status?.let { server.id to it } }.toMap()
                    serverToError = event.servers.mapNotNull { server -> server.error?.let { server.id to it } }.toMap()
                }
                is WsEvent.McpServerAdded -> {
                    refreshing = false
                    serverToStatus = serverToStatus + (event.server.id to event.server.status)
                    serverToError = event.server.error?.let { serverToError + (event.server.id to it) } ?: (serverToError - event.server.id)
                    WsRepository.getMcpServers()
                }
                is WsEvent.McpServerUpdated -> {
                    serverToStatus = serverToStatus + (event.server.id to event.server.status)
                    serverToError = event.server.error?.let { serverToError + (event.server.id to it) } ?: (serverToError - event.server.id)
                    refreshing = false
                    WsRepository.getMcpServers()
                }
                is WsEvent.McpServerRemoved -> Unit
                is WsEvent.McpServerStatus -> {
                    serverToStatus = serverToStatus + (event.id to event.status)
                    serverToError = event.error?.let { serverToError + (event.id to it) } ?: (serverToError - event.id)
                }
                is WsEvent.McpToolList -> tools = event.tools
                is WsEvent.McpTestResult -> { testingConnection = false; testResult = event }
                is WsEvent.McpRegistryResults -> {
                    registryResult = event.result
                    registryLoading = false
                    registryError = null
                }
                is WsEvent.McpRegistryError -> {
                    registryLoading = false
                    registryError = event.message
                }
                else -> {}
            }
        }
    }

    if (showAddSheet) {
        McpAddWizard(
            catalog = mcpCatalog,
            registry = registryResult,
            registryLoading = registryLoading,
            registryError = registryError,
            onSearchRegistry = { query ->
                registryLoading = true
                registryError = null
                WsRepository.searchMcpRegistry(query)
            },
            onConfirm = { name, description, command, args, env, imageResponses, enabled ->
                WsRepository.addMcpServer(name = name, description = description, command = command, args = args, env = env, imageResponses = imageResponses, enabled = enabled)
                showAddSheet = false
            },
            onTest = { command, args, env, imageResponses ->
                testingConnection = true
                testResult = null
                WsRepository.testMcpServer(command, args, env, imageResponses)
            },
            testingConnection = testingConnection,
            testResult = testResult,
            onDismiss = { showAddSheet = false },
        )
    }
    if (editingServer != null) {
        McpEditSheet(
            server = editingServer!!,
            initialDescription = editingServer!!.description.ifBlank { catalogDescription(editingServer!!, mcpCatalog) },
            onConfirm = { name, description, command, args, enabled ->
                val existing = editingServer!!
                WsRepository.updateMcpServer(existing.id, name = name, description = description, command = command, args = args.split(" ").filter { it.isNotBlank() }, enabled = enabled)
                editingServer = null
            },
            onDismiss = { editingServer = null },
        )
    }
    detailServer?.let { server ->
        McpServerDetailSheet(
            server = server,
            description = server.description.ifBlank { catalogDescription(server, mcpCatalog) },
            status = serverToStatus[server.id] ?: server.status,
            error = serverToError[server.id] ?: server.error,
            tools = tools.filter { it.serverId == server.id },
            managed = isManagedMcpServer(server),
            onDismiss = { detailServer = null },
        )
    }
    deleteTarget?.let { dt ->
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
                titleContent = { Text("MCP Servers", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Configuration",
            )
        },
        floatingActionButton = {
            if (!disconnected) {
                FloatingActionButton(
                    onClick = {
                        testResult = null
                        testingConnection = false
                        showAddSheet = true
                    },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    NexyIcon(NexyIconName.Add, contentDescription = "Add MCP server")
                }
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                WsRepository.getMcpServers()
                WsRepository.getMcpCatalog()
                WsRepository.listMcpTools()
                WsRepository.send("project:list")
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
            contentPadding = PaddingValues(top = 16.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (disconnected) {
                item {
                    NexyEmptyState(
                        title = "Not connected to desktop",
                        detail = "Connect to manage MCP servers.",
                        modifier = Modifier.padding(vertical = 32.dp),
                    )
                }
            } else {
                item {
                    McpOverviewCard(
                        serverCount = mcpServers.size,
                        connectedCount = mcpServers.count { serverToStatus[it.id] == "connected" },
                        toolCount = tools.size,
                    )
                }

            item {
                    McpSectionHeader(
                        title = "Configured servers",
                        detail = if (mcpServers.isEmpty()) "Add a server to give agents more capabilities." else "Open a server for its description, tools, and details.",
                    )
                }

                if (mcpServers.isEmpty()) {
                    item {
                        NexyEmptyState(
                            title = "No MCP servers yet",
                            detail = "Tap + to start with a curated server or add your own.",
                            modifier = Modifier.padding(vertical = 16.dp),
                        )
                    }
                } else {
                    items(mcpServers, key = { it.id }) { server ->
                        McpServerRow(
                            server = server,
                            status = serverToStatus[server.id] ?: server.status,
                            toolCount = tools.count { it.serverId == server.id },
                            description = server.description.ifBlank { catalogDescription(server, mcpCatalog) },
                            onOpen = { WsRepository.listMcpTools(listOf(server.id)); detailServer = server },
                            onEdit = { editingServer = server },
                            onDelete = { deleteTarget = server },
                            onRestart = { WsRepository.restartMcpServer(server.id); WsRepository.getMcpServerStatus(server.id) },
                        )
                    }
                }

            }
        }
        }
    }
}

@Composable
private fun McpOverviewCard(
    serverCount: Int,
    connectedCount: Int,
    toolCount: Int,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RectangleShape,
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("MCP workspace", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(
                        "Servers add capabilities that agents can use.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                NexyStatusBadge(
                    label = if (connectedCount > 0) "Online" else "Ready",
                    containerColor = if (connectedCount > 0) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = if (connectedCount > 0) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                McpMetric(value = serverCount.toString(), label = "servers", modifier = Modifier.weight(1f))
                McpMetric(value = connectedCount.toString(), label = "connected", modifier = Modifier.weight(1f))
                McpMetric(value = toolCount.toString(), label = "tools", modifier = Modifier.weight(1f))
            }

        }
    }
}

@Composable
private fun McpMetric(value: String, label: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RectangleShape,
    ) {
        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun McpSectionHeader(title: String, detail: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun McpToolsLauncher(toolCount: Int, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        shape = RectangleShape,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = RectangleShape,
                modifier = Modifier.size(40.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    NexyIcon(NexyIconName.Tool, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                }
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Tool library", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(
                    if (toolCount > 0) "$toolCount available tools, grouped by server" else "Discover tools exposed by your servers",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            NexyIcon(NexyIconName.ChevronRight, contentDescription = "Browse tools", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun McpStatusBadge(status: String) {
    val (label, color) = when (status) {
        "connected" -> "Connected" to MaterialTheme.colorScheme.primary
        "error" -> "Error" to MaterialTheme.colorScheme.error
        "connecting" -> "Connecting…" to MaterialTheme.colorScheme.tertiary
        else -> status.replaceFirstChar { it.uppercase() } to MaterialTheme.colorScheme.onSurfaceVariant
    }
    NexyStatusBadge(label = label, containerColor = color.copy(alpha = 0.15f), contentColor = color)
}

@Composable
internal fun McpServerRow(
    server: McpServerInfo,
    status: String?,
    toolCount: Int = 0,
    description: String = "",
    onOpen: () -> Unit = {},
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onRestart: () -> Unit,
) {
    var showMenu by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .height(McpServerCardHeight)
            .clickable(onClick = onOpen),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RectangleShape,
    ) {
        Column(
            modifier = Modifier.padding(start = 16.dp, top = 12.dp, end = 8.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        server.name,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (description.isNotBlank()) {
                        Text(
                            description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (status != null) McpStatusBadge(status)
                        if (!server.enabled) {
                            NexyStatusBadge(
                                label = "Off",
                                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (toolCount > 0) {
                            Text(
                                "$toolCount tools",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (isManagedMcpServer(server)) {
                            NexyStatusBadge(
                                label = "Built in",
                                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                if (!isManagedMcpServer(server)) {
                    Box {
                        IconButton(onClick = { showMenu = true }) {
                            NexyIcon(NexyIconName.More, contentDescription = "Server options", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                            DropdownMenuItem(
                                text = { Text("Edit") },
                                leadingIcon = { NexyIcon(NexyIconName.Edit, contentDescription = null) },
                                onClick = { showMenu = false; onEdit() },
                            )
                            DropdownMenuItem(
                                text = { Text("Restart") },
                                leadingIcon = { NexyIcon(NexyIconName.Tool, contentDescription = null) },
                                onClick = { showMenu = false; onRestart() },
                            )
                            DropdownMenuItem(
                                text = { Text("Remove", color = MaterialTheme.colorScheme.error) },
                                leadingIcon = { NexyIcon(NexyIconName.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                                onClick = { showMenu = false; onDelete() },
                            )
                        }
                    }
                }
            }
            if (fullServerCommand(server).isNotBlank()) {
                Text(
                    fullServerCommand(server),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
    }
}

private fun catalogDescription(server: McpServerInfo, catalog: List<McpCatalogEntry>): String =
    catalog.firstOrNull { entry -> entry.name.equals(server.name, ignoreCase = true) }?.description.orEmpty()

private fun isManagedMcpServer(server: McpServerInfo): Boolean =
    server.managed || server.id == "__desktop-navigator__"

private fun fullServerCommand(server: McpServerInfo): String =
    (listOf(server.command) + server.args).filter { it.isNotBlank() }.joinToString(" ")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun McpServerDetailSheet(
    server: McpServerInfo,
    description: String,
    status: String?,
    error: String?,
    tools: List<McpToolInfo>,
    managed: Boolean,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxWidth().heightIn(max = 720.dp),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(server.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        if (description.isNotBlank()) {
                            Text(description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    status?.let { McpStatusBadge(it) }
                }
            }
            item {
                Surface(
                    color = if (status == "error") MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant,
                    shape = RectangleShape,
                ) {
                    Column(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (status == "error") {
                            Text("Startup error", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onErrorContainer)
                            Text(
                                error ?: "The desktop could not start this MCP server and returned no diagnostic details.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                        } else if (managed) {
                            Text("Managed by Nexy", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                            Text(
                                "This server is built into the desktop app. Its tools are available automatically; no command or arguments are required.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
                            Text("Launch configuration", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(fullServerCommand(server), style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace))
                        }
                    }
                }
            }
            item {
                Text(
                    "${tools.size} tool${if (tools.size == 1) "" else "s"} available from this server",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            if (tools.isEmpty()) {
                item {
                    NexyEmptyState(
                        title = "No tools available",
                        detail = when {
                            status == "error" -> "The server could not start, so no tools were discovered."
                            status == "connected" -> "This server is connected but did not expose any tools."
                            else -> "Connect the server to discover its tools."
                        },
                    )
                }
            } else {
                items(tools, key = { "detail-tool:${server.id}:${it.name}" }) { tool ->
                    Card(
                        modifier = Modifier.fillMaxWidth().height(76.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                        shape = RectangleShape,
                    ) { McpToolEntry(tool) }
                }
            }
        }
    }
}

@Composable
internal fun McpToolEntry(tool: McpToolInfo) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RectangleShape,
            modifier = Modifier.size(32.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                NexyIcon(NexyIconName.Tool, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                tool.name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            tool.description?.takeIf { it.isNotBlank() }?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Text(
            tool.serverName,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun McpToolsSheet(
    tools: List<McpToolInfo>,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var query by remember { mutableStateOf("") }
    val filteredTools = remember(tools, query) {
        val normalizedQuery = query.trim()
        if (normalizedQuery.isBlank()) tools else tools.filter { tool ->
            listOf(tool.name, tool.description.orEmpty(), tool.serverName)
                .any { value -> value.contains(normalizedQuery, ignoreCase = true) }
        }
    }
    val groupedTools = remember(filteredTools) {
        filteredTools.groupBy { it.serverId to it.serverName }.toList()
    }
    var expandedServerId by remember(groupedTools) {
        mutableStateOf(groupedTools.singleOrNull()?.first?.first)
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 300.dp, max = 680.dp)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Tool library", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        "Browse tools by server, or search across all connections.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text("${filteredTools.size}", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
            }

            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Search tools") },
                placeholder = { Text("e.g. screenshot, read, browser") },
                singleLine = true,
                leadingIcon = { NexyIcon(NexyIconName.Search, contentDescription = null) },
                modifier = Modifier.fillMaxWidth(),
            )

            if (filteredTools.isEmpty()) {
                NexyEmptyState(
                    title = if (tools.isEmpty()) "No tools available" else "No matching tools",
                    detail = if (tools.isEmpty()) "Connect a server to discover its tools." else "Try a different name or server.",
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    groupedTools.forEach { (serverKey, serverTools) ->
                        val (serverId, serverName) = serverKey
                        val expanded = expandedServerId == serverId || query.isNotBlank()
                        item(key = "header:$serverId") {
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        expandedServerId = if (expandedServerId == serverId) null else serverId
                                    },
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                                shape = RectangleShape,
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 14.dp, vertical = 11.dp),
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Surface(
                                        color = MaterialTheme.colorScheme.primaryContainer,
                                        shape = RectangleShape,
                                        modifier = Modifier.size(30.dp),
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            NexyIcon(NexyIconName.Tool, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                                        }
                                    }
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(serverName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                        Text(
                                            "${serverTools.size} tool${if (serverTools.size == 1) "" else "s"}",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    NexyIcon(
                                        if (expanded) NexyIconName.ChevronDown else NexyIconName.ChevronRight,
                                        contentDescription = if (expanded) "Collapse $serverName" else "Expand $serverName",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                        if (expanded) {
                            items(serverTools, key = { "tool:$serverId:${it.name}" }) { tool ->
                                Card(
                                    modifier = Modifier.fillMaxWidth().height(76.dp),
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                                    shape = RectangleShape,
                                ) {
                                    McpToolEntry(tool)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private enum class McpAddType(val label: String, val description: String) {
    Npm("npm package", "Run an MCP server published as an npm package via npx"),
    LocalScript("Local script", "Run a script or binary already installed on the desktop"),
    Docker("Docker container", "Run an MCP server inside a Docker container"),
    Manual("Manual / advanced", "Enter the command and arguments yourself"),
}

@Composable
private fun McpCatalogCard(entry: McpCatalogEntry, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RectangleShape,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(entry.capability, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    Text("Server: ${entry.name}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (entry.requiredEnv.isNotEmpty()) {
                    NexyStatusBadge(
                        label = "Requires credential",
                        containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                    )
                }
            }
            Text(entry.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                NexyStatusBadge(
                    label = if (entry.impact == "can-change") "Can make changes" else "Read-only",
                    containerColor = if (entry.impact == "can-change") MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = if (entry.impact == "can-change") MaterialTheme.colorScheme.onTertiaryContainer else MaterialTheme.colorScheme.onSecondaryContainer,
                )
                Text(entry.category.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
            if (entry.access.isNotBlank()) Text("Access: ${entry.access}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun McpRegistryCard(entry: McpRegistryServer, onInstall: () -> Unit) {
    val context = LocalContext.current
    Card(
        modifier = Modifier.fillMaxWidth(),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RectangleShape,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(entry.title ?: entry.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text("v${entry.version}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(entry.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                when {
                    entry.install != null -> "Supported ${entry.transport} install"
                    entry.transport == "remote" -> "Remote server — configuration not supported yet"
                    else -> "Metadata only — no supported install package"
                },
                style = MaterialTheme.typography.labelSmall,
                color = if (entry.install != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.tertiary,
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                entry.docsUrl?.let { url ->
                    TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }) { Text("Docs") }
                }
                if (entry.install != null) {
                    NexyPrimaryButton(text = "Review install", onClick = onInstall)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun McpAddWizard(
    catalog: List<McpCatalogEntry>,
    registry: McpRegistrySearchResult?,
    registryLoading: Boolean,
    registryError: String?,
    onSearchRegistry: (String) -> Unit,
    onConfirm: (name: String, description: String, command: String, args: List<String>, env: Map<String, String>, imageResponses: String?, enabled: Boolean) -> Unit,
    onTest: (command: String, args: List<String>, env: Map<String, String>, imageResponses: String?) -> Unit,
    testingConnection: Boolean,
    testResult: WsEvent.McpTestResult?,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current
    var step by remember { mutableIntStateOf(0) }
    var catalogBrowse by remember { mutableStateOf(true) }
    var registryBrowse by remember { mutableStateOf(false) }
    var catalogQuery by remember { mutableStateOf("") }
    var catalogCategory by remember { mutableStateOf("all") }
    var selectedCatalog by remember { mutableStateOf<McpCatalogEntry?>(null) }
    var selectedType by remember { mutableStateOf<McpAddType?>(null) }
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var npmPackage by remember { mutableStateOf("") }
    var npmExtraArgs by remember { mutableStateOf("") }
    var scriptPath by remember { mutableStateOf("") }
    var scriptArgs by remember { mutableStateOf("") }
    var dockerImage by remember { mutableStateOf("") }
    var dockerArgs by remember { mutableStateOf("") }
    var manualCommand by remember { mutableStateOf("") }
    var manualArgs by remember { mutableStateOf("") }
    var requiredEnvValues by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var registryRequiredEnv by remember { mutableStateOf<List<McpRegistryEnvRequirement>>(emptyList()) }
    var enabled by remember { mutableStateOf(true) }

    fun chooseCatalog(entry: McpCatalogEntry) {
        registryBrowse = false
        selectedCatalog = entry
        registryRequiredEnv = emptyList()
        name = entry.name
        description = entry.description
        requiredEnvValues = entry.requiredEnv.associate { it.key to entry.env[it.key].orEmpty() }
        enabled = true
        val packageIndex = if (entry.args.firstOrNull() == "-y") 1 else 0
        val packageName = entry.args.getOrNull(packageIndex).orEmpty()
        if (entry.command == "npx" && packageName.isNotBlank()) {
            selectedType = McpAddType.Npm
            npmPackage = packageName
            npmExtraArgs = entry.args.drop(packageIndex + 1).joinToString(" ")
        } else {
            selectedType = McpAddType.Manual
            manualCommand = entry.command
            manualArgs = entry.args.joinToString(" ")
        }
        step = 1
    }

    fun chooseRegistry(entry: McpRegistryServer) {
        val install = entry.install ?: return
        selectedCatalog = null
        registryRequiredEnv = install.requiredEnv
        requiredEnvValues = emptyMap()
        name = entry.title ?: entry.name
        description = entry.description
        enabled = true
        selectedType = if (install.command == "npx") McpAddType.Npm else McpAddType.Manual
        if (selectedType == McpAddType.Npm) {
            val packageIndex = if (install.args.firstOrNull() == "-y") 1 else 0
            npmPackage = install.args.getOrNull(packageIndex).orEmpty()
            npmExtraArgs = install.args.drop(packageIndex + 1).joinToString(" ")
        } else {
            manualCommand = install.command
            manualArgs = install.args.joinToString(" ")
        }
        step = 1
    }

    fun buildCommandAndArgs(): Pair<String, List<String>> = when (selectedType) {
        McpAddType.Npm -> {
            val extra = npmExtraArgs.trim().split(" ").filter { it.isNotBlank() }
            "npx" to (listOf("-y", npmPackage.trim()) + extra)
        }
        McpAddType.LocalScript -> {
            val parts = scriptPath.trim().split(" ").filter { it.isNotBlank() }
            val cmd = parts.firstOrNull() ?: ""
            cmd to (parts.drop(1) + scriptArgs.trim().split(" ").filter { it.isNotBlank() })
        }
        McpAddType.Docker -> {
            val extra = dockerArgs.trim().split(" ").filter { it.isNotBlank() }
            "docker" to (listOf("run", "--rm", "-i", dockerImage.trim()) + extra)
        }
        McpAddType.Manual -> {
            manualCommand.trim() to manualArgs.trim().split(" ").filter { it.isNotBlank() }
        }
        null -> "" to emptyList()
    }

    val (previewCommand, previewArgs) = buildCommandAndArgs()
    val previewFull = if (previewCommand.isBlank()) "" else (listOf(previewCommand) + previewArgs).joinToString(" ")

    // Without this, system/gesture back dismisses the whole sheet (losing the in-progress form)
    // from any step instead of stepping back one wizard page like the sheet's own "Back" button.
    BackHandler(enabled = step > 0) { step -= 1 }

    val activeRequiredEnv = selectedCatalog?.requiredEnv ?: registryRequiredEnv.map {
        McpCatalogRequiredEnv(key = it.key, label = it.label, helpUrl = it.helpUrl, secret = it.secret)
    }
    val step2Valid = when (selectedType) {
        McpAddType.Npm -> name.isNotBlank() && npmPackage.isNotBlank()
        McpAddType.LocalScript -> name.isNotBlank() && scriptPath.isNotBlank()
        McpAddType.Docker -> name.isNotBlank() && dockerImage.isNotBlank()
        McpAddType.Manual -> name.isNotBlank() && manualCommand.isNotBlank()
        null -> false
    } && activeRequiredEnv.all { requiredEnvValues[it.key].orEmpty().isNotBlank() }

    val filteredCatalog = catalog.filter { entry ->
        val query = catalogQuery.trim().lowercase()
        val matchesCategory = catalogCategory == "all" || entry.category == catalogCategory
        matchesCategory && if (query.isBlank()) true else {
            val haystack = listOf(entry.name, entry.description, entry.category) + entry.keywords
            query.split(Regex("\\s+")).all { term -> haystack.any { it.contains(term, ignoreCase = true) } }
        }
    }
    val filteredRegistry = registry?.servers.orEmpty().filter { entry ->
        val query = catalogQuery.trim()
        if (query.isBlank()) true else {
            val haystack = listOf(entry.name, entry.title.orEmpty(), entry.description, entry.transport)
            query.split(Regex("\\s+")).all { term -> haystack.any { it.contains(term, ignoreCase = true) } }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 720.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = when (step) {
                        0 -> if (catalogBrowse) "Add server — Choose a capability" else "Add server — Custom server"
                        1 -> "Add server — Configure"
                        else -> "Add server — Review"
                    },
                    style = MaterialTheme.typography.titleSmall,
                )
                NexyGhostButton(text = "Cancel", onClick = onDismiss)
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            when (step) {
                0 -> {
                    if (catalogBrowse) {
                        if (registryBrowse) {
                            Text(
                                "Search the official MCP Registry. Nexy checks the server metadata and only offers supported stdio packages for installation.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            OutlinedTextField(
                                value = catalogQuery,
                                onValueChange = { catalogQuery = it },
                                label = { Text("Search official registry") },
                                placeholder = { Text("e.g. GitHub, calendar, filesystem") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                NexyPrimaryButton(
                                    text = if (registryLoading) "Searching…" else "Search",
                                    onClick = { onSearchRegistry(catalogQuery) },
                                    enabled = !registryLoading,
                                )
                            }
                            registryError?.let { message ->
                                Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                            }
                            registry?.stale?.takeIf { it }?.let {
                                Text("Showing the last cached result because the registry is temporarily unavailable.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary)
                            }
                            if (registry != null && filteredRegistry.isEmpty() && !registryLoading) {
                                Text("No registry servers matched that search.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            filteredRegistry.forEach { entry ->
                                McpRegistryCard(entry = entry, onInstall = { chooseRegistry(entry) })
                            }
                            NexyGhostButton(text = "Back to curated catalog", onClick = { registryBrowse = false })
                                    } else {
                            Text(
                                "Start with a capability below whenever possible. Nexy fills in a known-good launch command and shows the required credentials before saving.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            OutlinedTextField(
                                value = catalogQuery,
                                onValueChange = { catalogQuery = it },
                                label = { Text("Search capabilities") },
                                placeholder = { Text("e.g. GitHub, browser, files") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                listOf("all", "browser", "files", "dev", "web", "data", "productivity").forEach { category ->
                                    val selected = catalogCategory == category
                                    NexyStatusBadge(
                                        label = if (category == "all") "All" else category.replaceFirstChar { it.uppercase() },
                                        containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                                        contentColor = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.clickable { catalogCategory = category },
                                    )
                                }
                            }
                            if (filteredCatalog.isEmpty()) {
                                Text("No curated servers match that search.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            } else {
                                filteredCatalog.forEach { entry ->
                                    McpCatalogCard(entry = entry, onClick = { chooseCatalog(entry) })
                                }
                            }
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { registryBrowse = true },
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                                shape = RectangleShape,
                            ) {
                                Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text("Official MCP Registry", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                    Text("Search externally published MCP servers and review supported installs.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        selectedCatalog = null
                                        selectedType = null
                                        catalogBrowse = false
                                    },
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                                shape = RectangleShape,
                            ) {
                                Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text("Custom server", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                    Text("Use this only when the server documentation gives you a command, local script, or Docker image.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    } else {
                        Text("Choose how your custom server runs. If you are unsure which command to use, go back and choose a curated capability or search the official MCP Registry.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        McpAddType.entries.forEach { type ->
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
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 16.dp, vertical = 12.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Text(type.label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                        Text(type.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    if (selected) NexyIcon(NexyIconName.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            NexyGhostButton(text = "Back to catalog", onClick = { catalogBrowse = true })
                            NexyPrimaryButton(text = "Next", onClick = { step = 1 }, enabled = selectedType != null)
                        }
                    }
                }

                1 -> {
                    OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Server name") }, placeholder = { Text("e.g. Filesystem") }, singleLine = true, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true), modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = description, onValueChange = { description = it }, label = { Text("Description") }, placeholder = { Text("Shown on the server card and details view") }, modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 3)
                    when (selectedType) {
                        McpAddType.Npm -> {
                            OutlinedTextField(value = npmPackage, onValueChange = { npmPackage = it }, label = { Text("npm package") }, placeholder = { Text("e.g. @modelcontextprotocol/server-filesystem") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(value = npmExtraArgs, onValueChange = { npmExtraArgs = it }, label = { Text("Extra arguments (optional)") }, placeholder = { Text("e.g. /Users/me/projects") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            Text("Runs: npx -y <package> [args]", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        McpAddType.LocalScript -> {
                            OutlinedTextField(value = scriptPath, onValueChange = { scriptPath = it }, label = { Text("Script or binary path") }, placeholder = { Text("e.g. /usr/local/bin/mcp-server") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(value = scriptArgs, onValueChange = { scriptArgs = it }, label = { Text("Arguments (optional)") }, placeholder = { Text("e.g. /path/to/script.py") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        }
                        McpAddType.Docker -> {
                            OutlinedTextField(value = dockerImage, onValueChange = { dockerImage = it }, label = { Text("Docker image") }, placeholder = { Text("e.g. mcp/filesystem:latest") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(value = dockerArgs, onValueChange = { dockerArgs = it }, label = { Text("Extra docker run arguments (optional)") }, placeholder = { Text("e.g. -v /host:/container") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            Text("Runs: docker run --rm -i <image> [args]", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        McpAddType.Manual -> {
                            OutlinedTextField(value = manualCommand, onValueChange = { manualCommand = it }, label = { Text("Command") }, placeholder = { Text("e.g. npx") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(value = manualArgs, onValueChange = { manualArgs = it }, label = { Text("Arguments (space-separated)") }, placeholder = { Text("e.g. -y @modelcontextprotocol/server-github") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            Text("Copy these values from the server's installation documentation. The next step lets you test the connection before adding it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        null -> {}
                    }
                    activeRequiredEnv.takeIf { it.isNotEmpty() }?.let { requirements ->
                        Text("Credentials", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text("These values are sent to the desktop only as server environment variables.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        requirements.forEach { requirement ->
                            OutlinedTextField(
                                value = requiredEnvValues[requirement.key].orEmpty(),
                                onValueChange = { value -> requiredEnvValues = requiredEnvValues + (requirement.key to value) },
                                label = { Text(requirement.label) },
                                placeholder = { Text(requirement.key) },
                                singleLine = true,
                                visualTransformation = if (requirement.secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            requirement.helpUrl?.let { helpUrl ->
                                Text(
                                    "How to get one",
                                    modifier = Modifier.clickable {
                                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(helpUrl)))
                                    },
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                    }
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Enable on save", style = MaterialTheme.typography.bodyMedium)
                        Switch(checked = enabled, onCheckedChange = { enabled = it })
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        NexyGhostButton(text = "Back", onClick = { step = 0 })
                        NexyPrimaryButton(text = "Review", onClick = { step = 2 }, enabled = step2Valid)
                    }
                }

                else -> {
                    Text("Review your configuration:", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RectangleShape,
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            ReviewRow("Name", name)
                            ReviewRow("Type", selectedType?.label ?: "")
                            ReviewRow("Enabled", if (enabled) "Yes" else "No")
                            activeRequiredEnv.takeIf { it.isNotEmpty() }?.let {
                                ReviewRow("Credentials", "${it.size} value(s) provided")
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(vertical = 4.dp))
                            Text("Command:", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                previewFull.ifBlank { "(none)" },
                                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                    testResult?.let { result ->
                        Text(
                            if (result.ok) "Connection succeeded — ${result.toolNames.size} tool${if (result.toolNames.size == 1) "" else "s"} discovered." else "Connection failed: ${result.error ?: "The server did not start."}",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (result.ok) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                        )
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        NexyGhostButton(text = "Back", onClick = { step = 1 })
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            NexyGhostButton(
                                text = if (testingConnection) "Testing…" else "Test connection",
                                onClick = {
                                    val env = (selectedCatalog?.env.orEmpty() + requiredEnvValues).filterValues { it.isNotBlank() }
                                    onTest(previewCommand, previewArgs, env, selectedCatalog?.imageResponses)
                                },
                                enabled = !testingConnection && previewCommand.isNotBlank() && step2Valid,
                            )
                            NexyPrimaryButton(
                                text = "Add server",
                                onClick = {
                                    val env = (selectedCatalog?.env.orEmpty() + requiredEnvValues).filterValues { it.isNotBlank() }
                                    onConfirm(name.trim(), description.trim(), previewCommand, previewArgs, env, selectedCatalog?.imageResponses, enabled)
                                },
                                enabled = previewCommand.isNotBlank() && step2Valid,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ReviewRow(label: String, value: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("$label:", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodySmall)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun McpEditSheet(
    server: McpServerInfo,
    initialDescription: String,
    onConfirm: (name: String, description: String, command: String, args: String, enabled: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(server.name) }
    var description by remember { mutableStateOf(initialDescription) }
    var command by remember { mutableStateOf(server.command) }
    var args by remember { mutableStateOf(server.args.joinToString(" ")) }
    var enabled by remember { mutableStateOf(server.enabled) }

    NexyFormSheet(
        title = "Edit MCP Server",
        confirmLabel = "Save",
        onConfirm = { onConfirm(name.trim(), description.trim(), command.trim(), args.trim(), enabled) },
        onDismiss = onDismiss,
        confirmEnabled = name.isNotBlank() && command.isNotBlank(),
    ) {
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Server name") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true))
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = description, onValueChange = { description = it }, label = { Text("Description") }, supportingText = { Text("Shown on the server card and details view") }, modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 3)
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

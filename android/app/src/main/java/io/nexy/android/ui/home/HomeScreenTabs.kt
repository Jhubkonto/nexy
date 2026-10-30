package io.nexy.android.ui.home

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Difference
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyPaginationFooter
import kotlinx.coroutines.launch

private sealed class ChatFilter {
    object All : ChatFilter()
    data class ByAgent(val agentId: String, val agentName: String) : ChatFilter()
    data class ByProject(val projectId: String, val projectName: String) : ChatFilter()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatsTab(
    conversations: List<Conversation>,
    agents: List<Agent>,
    projects: List<Project>,
    isRefreshing: Boolean,
    isPullRefreshing: Boolean,
    searchQuery: String,
    searchResults: List<Conversation>?,
    onSearchQueryChange: (String) -> Unit,
    completionFilter: String = "ongoing",
    onCompletionFilterChange: (String) -> Unit = {},
    onScopeChange: (String, String?) -> Unit = { _, _ -> },
    onOpenChat: (String) -> Unit,
    onRefresh: () -> Unit,
    onDisconnect: () -> Unit,
    onRenameConversation: (id: String, title: String) -> Unit,
    onDeleteConversation: (id: String) -> Unit,
    onTogglePinConversation: (id: String, pinned: Boolean) -> Unit = { _, _ -> },
    onMarkComplete: (String) -> Unit = {},
    onMarkIncomplete: (String) -> Unit = {},
    activeConversationIds: Set<String> = emptySet(),
    pendingConversationIds: Set<String> = emptySet(),
    completedWhileAwayIds: Set<String> = emptySet(),
    totalCount: Int = conversations.size,
    hasMore: Boolean = false,
    onLoadMore: () -> Unit = {},
) {
    var activeFilter by remember { mutableStateOf<ChatFilter>(ChatFilter.All) }
    var showFilterSheet by remember { mutableStateOf(false) }
    var renamingConversation by remember { mutableStateOf<Conversation?>(null) }
    var deletingConversation by remember { mutableStateOf<Conversation?>(null) }
    var renameText by remember { mutableStateOf("") }
    val filterSheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val uniqueAgents = remember(agents) { agents.sortedBy { it.name } }
    val uniqueProjectsWithChats = remember(projects) { projects.sortedBy { it.name } }

    // Scope, completion and search are all applied by the desktop's paginated query.
    val displayList: List<Conversation> = if (searchQuery.isNotBlank()) searchResults ?: emptyList() else conversations

    val showFilters = uniqueAgents.isNotEmpty() || uniqueProjectsWithChats.isNotEmpty()
    val activeFilterLabel = when (val f = activeFilter) {
        is ChatFilter.All -> "All chats"
        is ChatFilter.ByAgent -> "Agent: ${f.agentName}"
        is ChatFilter.ByProject -> "Project: ${f.projectName}"
    }

    // Rename dialog
    renamingConversation?.let { conv ->
        AlertDialog(
            onDismissRequest = { renamingConversation = null },
            title = { Text("Rename chat") },
            text = {
                OutlinedTextField(
                    value = renameText,
                    onValueChange = { renameText = it },
                    singleLine = true,
                    label = { Text("Title") },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val trimmed = renameText.trim()
                    if (trimmed.isNotBlank()) onRenameConversation(conv.id, trimmed)
                    renamingConversation = null
                }) { Text("Rename") }
            },
            dismissButton = {
                TextButton(onClick = { renamingConversation = null }) { Text("Cancel") }
            },
        )
    }

    deletingConversation?.let { conv ->
        NexyConfirmDialog(
            title = "Delete chat?",
            message = "\"${conv.title.ifBlank { "Untitled" }}\" will be removed from the paired desktop.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                onDeleteConversation(conv.id)
                deletingConversation = null
            },
            onDismiss = { deletingConversation = null },
        )
    }

    if (showFilterSheet) {
        ModalBottomSheet(
            onDismissRequest = { showFilterSheet = false },
            sheetState = filterSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Text(
                "Filter chats",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            FilterSheetItem(label = "All chats", selected = activeFilter is ChatFilter.All) {
                activeFilter = ChatFilter.All
                onScopeChange("all", null)
                scope.launch { filterSheetState.hide() }.invokeOnCompletion { showFilterSheet = false }
            }
            Text(
                "Status",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
            )
            listOf("ongoing" to "Ongoing", "completed" to "Completed", "all" to "All statuses").forEach { (value, label) ->
                FilterSheetItem(label = label, prefix = "Status", selected = completionFilter == value) {
                    onCompletionFilterChange(value)
                    scope.launch { filterSheetState.hide() }.invokeOnCompletion { showFilterSheet = false }
                }
            }
            if (uniqueAgents.isNotEmpty()) {
                Text(
                    "Agents",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
                uniqueAgents.forEach { agent ->
                    FilterSheetItem(
                        label = agent.name,
                        prefix = "Agent",
                        selected = activeFilter == ChatFilter.ByAgent(agent.id, agent.name),
                    ) {
                        activeFilter = ChatFilter.ByAgent(agent.id, agent.name)
                        onScopeChange("agent", agent.id)
                        scope.launch { filterSheetState.hide() }.invokeOnCompletion { showFilterSheet = false }
                    }
                }
            }
            if (uniqueProjectsWithChats.isNotEmpty()) {
                Text(
                    "Projects",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
                uniqueProjectsWithChats.forEach { project ->
                    FilterSheetItem(
                        label = project.name,
                        prefix = "Project",
                        selected = activeFilter == ChatFilter.ByProject(project.id, project.name),
                    ) {
                        activeFilter = ChatFilter.ByProject(project.id, project.name)
                        onScopeChange("project", project.id)
                        scope.launch { filterSheetState.hide() }.invokeOnCompletion { showFilterSheet = false }
                    }
                }
            }
            Spacer(Modifier.padding(bottom = 16.dp))
        }
    }

    RefreshableContent(isRefreshing = isPullRefreshing, onRefresh = onRefresh) {
        if (conversations.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                NexyEmptyState(
                    title = "No conversations yet.",
                    action = {
                        TextButton(onClick = onDisconnect) { Text("Disconnect") }
                    },
                )
            }
        } else {
            Column(modifier = Modifier.fillMaxSize()) {
                if (displayList.isEmpty()) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedTextField(
                            value = searchQuery,
                            onValueChange = { onSearchQueryChange(it) },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp)) },
                            trailingIcon = {
                                if (searchQuery.isNotBlank()) {
                                    IconButton(onClick = { onSearchQueryChange("") }, modifier = Modifier.size(36.dp)) {
                                        Icon(Icons.Default.Close, contentDescription = "Clear search", modifier = Modifier.size(16.dp))
                                    }
                                }
                            },
                            placeholder = { Text("Search chats", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            shape = RoundedCornerShape(12.dp),
                            textStyle = MaterialTheme.typography.bodyMedium,
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                        )
                        FilterChip(
                            selected = activeFilter !is ChatFilter.All || completionFilter != "ongoing",
                            onClick = { if (showFilters) showFilterSheet = true },
                            label = {
                                Text(
                                    activeFilterLabel,
                                    style = MaterialTheme.typography.labelMedium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            },
                            leadingIcon = {
                                Icon(
                                    Icons.Default.FilterList,
                                    contentDescription = "Filter chats",
                                    modifier = Modifier.size(16.dp),
                                )
                            },
                            enabled = showFilters,
                            modifier = Modifier.heightIn(min = 56.dp),
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Column(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(
                            if (searchQuery.isNotBlank()) "No results for \"$searchQuery\"." else "No matching chats.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = { onSearchQueryChange(""); activeFilter = ChatFilter.All }) {
                            Text("Clear filters")
                        }
                    }
                } else {
                    val knownIds = remember(displayList) { displayList.map { it.id }.toSet() }
                    val pendingNew = remember(pendingConversationIds, knownIds) {
                        pendingConversationIds.filter { it !in knownIds }
                    }
                    LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
                        stickyHeader {
                            Column(modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    OutlinedTextField(
                                        value = searchQuery,
                                        onValueChange = { onSearchQueryChange(it) },
                                        modifier = Modifier.weight(1f),
                                        singleLine = true,
                                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp)) },
                                        trailingIcon = {
                                            if (searchQuery.isNotBlank()) {
                                                IconButton(onClick = { onSearchQueryChange("") }, modifier = Modifier.size(36.dp)) {
                                                    Icon(Icons.Default.Close, contentDescription = "Clear search", modifier = Modifier.size(16.dp))
                                                }
                                            }
                                        },
                                        placeholder = { Text("Search chats", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                        shape = RoundedCornerShape(12.dp),
                                        textStyle = MaterialTheme.typography.bodyMedium,
                                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                                    )
                                    FilterChip(
                                        selected = activeFilter !is ChatFilter.All || completionFilter != "ongoing",
                                        onClick = { if (showFilters) showFilterSheet = true },
                                        label = {
                                            Text(
                                                activeFilterLabel,
                                                style = MaterialTheme.typography.labelMedium,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                            )
                                        },
                                        leadingIcon = {
                                            Icon(
                                                Icons.Default.FilterList,
                                                contentDescription = "Filter chats",
                                                modifier = Modifier.size(16.dp),
                                            )
                                        },
                                        enabled = showFilters,
                                        modifier = Modifier.heightIn(min = 56.dp),
                                    )
                                }
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            }
                        }
                        if (pendingNew.isNotEmpty()) {
                            items(pendingNew) {
                                PendingConversationRow()
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            }
                        }
                        itemsIndexed(displayList, key = { _, conv -> conv.id }) { index, conv ->
                            ConversationRow(
                                conv = conv,
                                index = index,
                                projects = projects,
                                onOpenChat = onOpenChat,
                                isActive = conv.id in activeConversationIds,
                                hasNewContent = conv.id in completedWhileAwayIds,
                                isCompleted = conv.completed_at != null,
                                onRename = { _, _ ->
                                    renameText = conv.title
                                    renamingConversation = conv
                                },
                                onDelete = { deletingConversation = conv },
                                onTogglePin = { id, pinned -> onTogglePinConversation(id, pinned) },
                                onMarkComplete = onMarkComplete,
                                onMarkIncomplete = onMarkIncomplete,
                            )
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                        item(key = "pagination-footer") {
                            NexyPaginationFooter(
                                loadedCount = conversations.size,
                                totalCount = totalCount,
                                hasMore = hasMore,
                                isLoading = isRefreshing,
                                error = null,
                                onLoadMore = onLoadMore,
                                onRetry = onRefresh,
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ProjectsTab(
    projects: List<Project>,
    isRefreshing: Boolean,
    isPullRefreshing: Boolean,
    showCreateSheet: Boolean,
    highlightProjectId: String? = null,
    onHighlightConsumed: () -> Unit = {},
    onDismissCreateSheet: () -> Unit,
    onRefresh: () -> Unit,
    onOpenProjectHistory: (String) -> Unit,
    onOpenProjectConfig: (String) -> Unit = {},
    onOpenProjectGenerator: () -> Unit,
    onOpenCodePanel: (String) -> Unit = {},
    connectionState: ConnectionState = ConnectionState.CONNECTED,
    onCreateProject: (name: String, color: String) -> Unit,
    onRenameProject: (id: String, name: String) -> Unit,
    onDeleteProject: (id: String, deleteChats: Boolean) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    var renameTarget by remember { mutableStateOf<Project?>(null) }
    var deleteTarget by remember { mutableStateOf<Project?>(null) }
    var renameText by remember { mutableStateOf("") }
    var projectSearch by remember { mutableStateOf("") }
    var setupPromptProject by remember { mutableStateOf<Project?>(null) }

    val filteredProjects = remember(projects, projectSearch) {
        val q = projectSearch.trim()
        if (q.isBlank()) projects else projects.filter { it.name.contains(q, ignoreCase = true) }
    }

    if (showCreateSheet) {
        var newName by remember { mutableStateOf("") }
        var newColor by remember { mutableStateOf("blue") }
        var newColorHex by remember { mutableStateOf("") }
        var sending by remember { mutableStateOf(false) }
        ModalBottomSheet(
            onDismissRequest = { if (!sending) onDismissCreateSheet() },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Column(modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("New Project", style = MaterialTheme.typography.titleMedium)
                OutlinedTextField(
                    value = newName,
                    onValueChange = { if (!sending) newName = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !sending,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    projectColorOptions.forEach { color ->
                        FilterChip(
                            selected = newColor == color,
                            onClick = { if (!sending) { newColor = color; newColorHex = "" } },
                            label = {},
                            leadingIcon = {
                                Box(modifier = Modifier.size(16.dp).background(projectColor(color), RoundedCornerShape(4.dp)))
                            },
                        )
                    }
                }
                OutlinedTextField(
                    value = newColorHex,
                    onValueChange = { value ->
                        val normalized = value.uppercase()
                        if (normalized.matches(Regex("^#?[0-9A-F]{0,6}$"))) {
                            newColorHex = if (normalized.isEmpty() || normalized.startsWith("#")) normalized else "#$normalized"
                            if (newColorHex.length == 7) newColor = newColorHex
                        }
                    },
                    label = { Text("Custom hex (optional)") },
                    placeholder = { Text("#3478D4") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !sending,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = {
                        if (!sending) scope.launch { sheetState.hide() }.invokeOnCompletion { onDismissCreateSheet() }
                    }, enabled = !sending) { Text("Cancel") }
                    TextButton(
                        onClick = {
                            if (newName.isNotBlank() && !sending) {
                                sending = true
                                onCreateProject(newName.trim(), newColor)
                            }
                        },
                        enabled = newName.isNotBlank() && !sending,
                    ) { Text(if (sending) "Creating…" else "Create") }
                }
            }
        }
    }

    renameTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("Rename Project") },
            text = {
                OutlinedTextField(
                    value = renameText,
                    onValueChange = { renameText = it },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (renameText.isNotBlank()) onRenameProject(target.id, renameText.trim())
                    renameTarget = null
                }) { Text("Rename") }
            },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text("Cancel") } },
        )
    }

    deleteTarget?.let { target ->
        var deleteChats by remember(target.id) { mutableStateOf(false) }
        NexyConfirmDialog(
            title = "Delete project?",
            message = "\"${target.name}\" and its project settings will be deleted locally and synchronized when the desktop is available.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                onDeleteProject(target.id, deleteChats)
                deleteTarget = null
            },
            onDismiss = { deleteTarget = null },
            extraContent = {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { deleteChats = !deleteChats },
                ) {
                    Checkbox(checked = deleteChats, onCheckedChange = { deleteChats = it })
                    Text("Also delete conversations in this project")
                }
            },
        )
    }

    setupPromptProject?.let { target ->
        NexyConfirmDialog(
            title = "Set up this project for code changes",
            message = "\"${target.name}\" needs a root directory before you can create code changes.",
            confirmLabel = "Set up project",
            onConfirm = {
                val projectId = target.id
                setupPromptProject = null
                onOpenProjectConfig(projectId)
            },
            onDismiss = { setupPromptProject = null },
        )
    }

    RefreshableContent(isRefreshing = isPullRefreshing, onRefresh = onRefresh) {
        if (projects.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                NexyEmptyState(title = "No projects yet.", detail = "Use the + button to create or generate a project.")
            }
        } else {
            Column(modifier = Modifier.fillMaxSize()) {
            LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
                stickyHeader {
                    Column(modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            OutlinedTextField(
                                value = projectSearch,
                                onValueChange = { projectSearch = it },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp)) },
                                trailingIcon = {
                                    if (projectSearch.isNotBlank()) {
                                        IconButton(onClick = { projectSearch = "" }, modifier = Modifier.size(36.dp)) {
                                            Icon(Icons.Default.Close, contentDescription = "Clear search", modifier = Modifier.size(16.dp))
                                        }
                                    }
                                },
                                placeholder = { Text("Search projects", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                shape = RoundedCornerShape(12.dp),
                                textStyle = MaterialTheme.typography.bodyMedium,
                            )
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
                itemsIndexed(filteredProjects, key = { _, p -> p.id }) { index, project ->
                    val accentColor = projectColor(project.color)
                    var menuExpanded by remember { mutableStateOf(false) }
                    val rowColor = if (index % 2 == 0) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant
                    val isHighlighted = project.id == highlightProjectId
                    val flashAlpha = if (isHighlighted) 1f else 0f
                    LaunchedEffect(isHighlighted) {
                        if (isHighlighted) {
                            onHighlightConsumed()
                        }
                    }
                    val primaryColor = MaterialTheme.colorScheme.primary
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(
                                width = 2.dp,
                                color = primaryColor.copy(alpha = flashAlpha),
                            )
                            .combinedClickable(
                                onClick = { onOpenProjectHistory(project.id) },
                                onLongClick = {
                                    renameText = project.name
                                    renameTarget = project
                                },
                            ),
                        color = rowColor,
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().height(72.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // Left color accent bar
                            Box(modifier = Modifier.width(4.dp).fillMaxHeight().background(accentColor))

                            // Center: two-line content
                            val agentCount = project.agentIcons.size
                            val chatCount = project.chatCount
                            Column(
                                modifier = Modifier
                                    .weight(1f)
                                    .padding(start = 14.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                // Line 1: project name
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(
                                        text = project.name,
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f, fill = false),
                                    )
                                }
                                // Line 2: emojis (if any) then counts
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    if (project.agentIcons.isNotEmpty()) {
                                        project.agentIcons.take(4).forEach { emoji ->
                                            Text(text = emoji, style = MaterialTheme.typography.labelMedium)
                                        }
                                        if (project.agentIcons.size > 4) {
                                            Text(
                                                text = "+${project.agentIcons.size - 4}",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                        Text(
                                            text = "·",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    Text(
                                        text = buildString {
                                            append(if (chatCount == 0) "No chats" else "$chatCount chat${if (chatCount != 1) "s" else ""}")
                                            if (agentCount > 0 && project.agentIcons.isEmpty()) {
                                                append("  ·  $agentCount agent${if (agentCount != 1) "s" else ""}")
                                            }
                                        },
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }

                            // Git code panel entry point, gated on the project's workspace.
                            IconButton(
                                enabled = connectionState == ConnectionState.CONNECTED,
                                onClick = {
                                    if (project.rootDirectory.isNullOrBlank()) {
                                        setupPromptProject = project
                                    } else {
                                        onOpenCodePanel(project.id)
                                    }
                                },
                                modifier = Modifier.size(36.dp),
                            ) {
                                Icon(
                                    Icons.Default.Difference,
                                    contentDescription = "Code panel",
                                    modifier = Modifier.size(18.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }

                            // Right: ⋮ menu
                            Box(modifier = Modifier.padding(end = 4.dp)) {
                                IconButton(
                                    onClick = { menuExpanded = true },
                                    modifier = Modifier.size(36.dp),
                                ) {
                                    Icon(
                                        Icons.Default.MoreVert,
                                        contentDescription = "Project actions",
                                        modifier = Modifier.size(18.dp),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                                    DropdownMenuItem(
                                        text = { Text("Open") },
                                        leadingIcon = { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null) },
                                        onClick = {
                                            menuExpanded = false
                                            onOpenProjectConfig(project.id)
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Rename") },
                                        leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                                        onClick = {
                                            menuExpanded = false
                                            renameText = project.name
                                            renameTarget = project
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Delete") },
                                        leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
                                        onClick = {
                                            menuExpanded = false
                                            deleteTarget = project
                                        },
                                    )
                                }
                            }
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
            } // end Column (search + list)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun AgentsTab(
    agents: List<Agent>,
    isRefreshing: Boolean,
    isPullRefreshing: Boolean,
    showCreateSheet: Boolean,
    highlightAgentId: String? = null,
    onHighlightConsumed: () -> Unit = {},
    onDismissCreateSheet: () -> Unit,
    onRefresh: () -> Unit,
    onOpenAgentHistory: (String) -> Unit,
    onOpenAgentConfig: (String) -> Unit = {},
    onOpenAgentGenerator: () -> Unit = {},
    onCreateAgent: (name: String, icon: String) -> Unit,
    onRenameAgent: (id: String, name: String, icon: String) -> Unit,
    onDeleteAgent: (id: String) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    var renameTarget by remember { mutableStateOf<Agent?>(null) }
    var deleteTarget by remember { mutableStateOf<Agent?>(null) }
    var renameText by remember { mutableStateOf("") }
    var renameIcon by remember { mutableStateOf("") }
    var agentSearch by remember { mutableStateOf("") }

    val filteredAgents = remember(agents, agentSearch) {
        val q = agentSearch.trim()
        if (q.isBlank()) agents else agents.filter { it.name.contains(q, ignoreCase = true) }
    }

    if (showCreateSheet) {
        var newName by remember { mutableStateOf("") }
        var newIcon by remember { mutableStateOf("") }
        var sending by remember { mutableStateOf(false) }
        ModalBottomSheet(
            onDismissRequest = { if (!sending) onDismissCreateSheet() },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Column(modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("New Agent", style = MaterialTheme.typography.titleMedium)
                OutlinedTextField(
                    value = newName,
                    onValueChange = { if (!sending) newName = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !sending,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                )
                OutlinedTextField(
                    value = newIcon,
                    onValueChange = { if (!sending) newIcon = it },
                    label = { Text("Icon (emoji)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !sending,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = {
                        if (!sending) scope.launch { sheetState.hide() }.invokeOnCompletion { onDismissCreateSheet() }
                    }, enabled = !sending) { Text("Cancel") }
                    TextButton(
                        onClick = {
                            if (newName.isNotBlank() && !sending) {
                                sending = true
                                onCreateAgent(newName.trim(), newIcon.trim())
                            }
                        },
                        enabled = newName.isNotBlank() && !sending,
                    ) { Text(if (sending) "Creating…" else "Create") }
                }
            }
        }
    }

    renameTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("Edit Agent") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = renameText,
                        onValueChange = { renameText = it },
                        label = { Text("Name") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                    )
                    OutlinedTextField(
                        value = renameIcon,
                        onValueChange = { renameIcon = it },
                        label = { Text("Icon (emoji)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (renameText.isNotBlank()) onRenameAgent(target.id, renameText.trim(), renameIcon.trim())
                    renameTarget = null
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text("Cancel") } },
        )
    }

    deleteTarget?.let { target ->
        NexyConfirmDialog(
            title = "Delete agent?",
            message = "\"${target.name}\" will be deleted locally and synchronized when the desktop is available.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                onDeleteAgent(target.id)
                deleteTarget = null
            },
            onDismiss = { deleteTarget = null },
        )
    }

    RefreshableContent(isRefreshing = isPullRefreshing, onRefresh = onRefresh) {
        if (agents.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                NexyEmptyState(title = "No agents yet.", detail = "Use the + button to create or generate an agent.")
            }
        } else {
            Column(modifier = Modifier.fillMaxSize()) {
            LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
                stickyHeader {
                    Column(modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            OutlinedTextField(
                                value = agentSearch,
                                onValueChange = { agentSearch = it },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp)) },
                                trailingIcon = {
                                    if (agentSearch.isNotBlank()) {
                                        IconButton(onClick = { agentSearch = "" }, modifier = Modifier.size(36.dp)) {
                                            Icon(Icons.Default.Close, contentDescription = "Clear search", modifier = Modifier.size(16.dp))
                                        }
                                    }
                                },
                                placeholder = { Text("Search agents", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                shape = RoundedCornerShape(12.dp),
                                textStyle = MaterialTheme.typography.bodyMedium,
                            )
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
                itemsIndexed(filteredAgents, key = { _, a -> a.id }) { index, agent ->
                    var menuExpanded by remember { mutableStateOf(false) }
                    val rowColor = if (index % 2 == 0) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant
                    val isHighlighted = agent.id == highlightAgentId
                    val flashAlpha = if (isHighlighted) 1f else 0f
                    LaunchedEffect(isHighlighted) {
                        if (isHighlighted) {
                            onHighlightConsumed()
                        }
                    }
                    val primaryColor = MaterialTheme.colorScheme.primary
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(
                                width = 2.dp,
                                color = primaryColor.copy(alpha = flashAlpha),
                            )
                            .combinedClickable(
                                onClick = { onOpenAgentHistory(agent.id) },
                                onLongClick = {
                                    renameText = agent.name
                                    renameIcon = agent.icon
                                    renameTarget = agent
                                },
                            ),
                        color = rowColor,
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(72.dp)
                                .padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            // Icon badge or placeholder dot
                            if (agent.icon.isNotBlank()) {
                                Text(
                                    text = agent.icon,
                                    style = MaterialTheme.typography.titleSmall,
                                )
                            } else {
                                Box(
                                    modifier = Modifier
                                        .size(28.dp)
                                        .background(
                                            MaterialTheme.colorScheme.primaryContainer,
                                            RoundedCornerShape(6.dp),
                                        ),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        text = agent.name.take(1).uppercase(),
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                                    )
                                }
                            }

                            // Two-line content
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(3.dp),
                            ) {
                                Text(
                                    text = agent.name,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                val meta = listOfNotNull(
                                    agent.backend?.takeIf { it.isNotBlank() },
                                    agent.cliModel?.takeIf { it.isNotBlank() },
                                ).joinToString("  ·  ").ifBlank { "No model configured" }
                                Text(
                                    text = meta,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }

                            // ⋮ menu
                            Box {
                                IconButton(
                                    onClick = { menuExpanded = true },
                                    modifier = Modifier.size(36.dp),
                                ) {
                                    Icon(
                                        Icons.Default.MoreVert,
                                        contentDescription = "Agent actions",
                                        modifier = Modifier.size(18.dp),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                                    DropdownMenuItem(
                                        text = { Text("Configure") },
                                        leadingIcon = { Icon(Icons.Default.Settings, contentDescription = null) },
                                        onClick = {
                                            menuExpanded = false
                                            onOpenAgentConfig(agent.id)
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Edit name/icon") },
                                        leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                                        onClick = {
                                            menuExpanded = false
                                            renameText = agent.name
                                            renameIcon = agent.icon
                                            renameTarget = agent
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Delete") },
                                        leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
                                        onClick = {
                                            menuExpanded = false
                                            deleteTarget = agent
                                        },
                                    )
                                }
                            }
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
            } // end Column (search + list)
        }
    }
}

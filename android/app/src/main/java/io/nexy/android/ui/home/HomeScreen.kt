package io.nexy.android.ui.home

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import io.nexy.android.ui.components.NewChatItem
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import io.nexy.android.ui.theme.NexyViolet
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.components.ApprovalDialog
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import io.nexy.android.ui.theme.NexyTextStyles
import io.nexy.android.ui.theme.LocalNexyEightBit
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import kotlinx.coroutines.launch
import java.util.UUID

private val tabTitles = listOf("Chats", "Projects", "Agents")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onOpenChat: (String) -> Unit,
    onOpenDraftChat: (String, String?, String?) -> Unit,
    onOpenAgentHistory: (String) -> Unit,
    onOpenAgentConfig: (String) -> Unit,
    onOpenAgentConfigNew: (String) -> Unit = onOpenAgentConfig,
    onOpenAgentGenerator: () -> Unit,
    onOpenProjectHistory: (String) -> Unit,
    onOpenProjectConfig: (String) -> Unit,
    onOpenProjectConfigNew: (String) -> Unit = onOpenProjectConfig,
    onOpenProjectGenerator: () -> Unit,
    onOpenCodePanel: (String) -> Unit,
    onOpenArtifacts: () -> Unit,
    onOpenSkills: () -> Unit,
    onOpenScheduled: () -> Unit,
    onOpenAutomatedWorkflows: () -> Unit,
    onOpenRatings: () -> Unit,
    onOpenWorkHistory: () -> Unit = {},
    onOpenSkillGenerator: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenNewContent: () -> Unit,
    onNavigateRoute: (String) -> Unit = {},
    vm: HomeViewModel = viewModel(),
) {
    val connectionState by vm.connectionState.collectAsStateWithLifecycle()
    val conversations by vm.conversations.collectAsStateWithLifecycle()
    val conversationTotalCount by vm.conversationTotalCount.collectAsStateWithLifecycle()
    val conversationHasMore by vm.conversationHasMore.collectAsStateWithLifecycle()
    val agents by vm.agents.collectAsStateWithLifecycle()
    val projects by vm.projects.collectAsStateWithLifecycle()
    val isRefreshingConversations by vm.isRefreshingConversations.collectAsStateWithLifecycle()
    val isRefreshingAgents by vm.isRefreshingAgents.collectAsStateWithLifecycle()
    val isRefreshingProjects by vm.isRefreshingProjects.collectAsStateWithLifecycle()
    val isPullRefreshingConversations by vm.isPullRefreshingConversations.collectAsStateWithLifecycle()
    val isPullRefreshingAgents by vm.isPullRefreshingAgents.collectAsStateWithLifecycle()
    val isPullRefreshingProjects by vm.isPullRefreshingProjects.collectAsStateWithLifecycle()
    val pendingApproval by vm.pendingApproval.collectAsStateWithLifecycle()
    val searchQuery by vm.searchQuery.collectAsStateWithLifecycle()
    val searchResults by vm.searchResults.collectAsStateWithLifecycle()
    val highlightProjectId by vm.highlightProjectId.collectAsStateWithLifecycle()
    val highlightAgentId by vm.highlightAgentId.collectAsStateWithLifecycle()
    val activeConversationIds by vm.activeConversationIds.collectAsStateWithLifecycle()
    val pendingConversationIds by vm.pendingConversationIds.collectAsStateWithLifecycle()
    val completedWhileAwayIds by vm.completedWhileAwayIds.collectAsStateWithLifecycle()
    val completionFilter by vm.completionFilter.collectAsStateWithLifecycle()
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }
    var showNewChatSheet by remember { mutableStateOf(false) }
    var newChatQuery by remember { mutableStateOf("") }
    var showCreateProjectSheet by remember { mutableStateOf(false) }
    var showCreateAgentSheet by remember { mutableStateOf(false) }
    var showOverflowMenu by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val haptic = LocalHapticFeedback.current

    RefreshConversationsOnResume {
        vm.refreshConversations()
    }

    LaunchedEffect(Unit) {
        vm.projectCreated.collect { projectId ->
            showCreateProjectSheet = false
            onOpenProjectConfigNew(projectId)
        }
    }
    LaunchedEffect(Unit) {
        vm.agentCreated.collect { agentId ->
            showCreateAgentSheet = false
            onOpenAgentConfigNew(agentId)
        }
    }

    LaunchedEffect(connectionState) {
        when (connectionState) {
            ConnectionState.CONNECTED -> {
                vm.refreshConversations()
                vm.requestAgents()
                vm.requestProjects()
            }
            else -> {}
        }
    }

    LaunchedEffect(selectedTab) {
        when (selectedTab) {
            0 -> vm.refreshConversations()
            1 -> vm.requestProjects()
            2 -> vm.requestAgents()
        }
    }

    BackHandler(enabled = selectedTab != 0) {
        selectedTab = 0
    }

    if (pendingApproval != null) {
        ApprovalDialog(
            request = pendingApproval!!,
            onApprove = { vm.approveRequest(pendingApproval!!.requestId) },
            onKeepPlanning = { vm.rejectRequest(pendingApproval!!.requestId) },
            onReject = { vm.rejectRequest(pendingApproval!!.requestId) },
        )
    }

    if (showNewChatSheet) {
        val filteredAgents = agents.filter { a ->
            newChatQuery.isBlank() || a.name.contains(newChatQuery, ignoreCase = true)
        }
        val filteredProjects = projects.filter { p ->
            newChatQuery.isBlank() || p.name.contains(newChatQuery, ignoreCase = true)
        }
        ModalBottomSheet(
            onDismissRequest = { showNewChatSheet = false; newChatQuery = "" },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Text(
                "New Chat",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            NexySearchField(
                query = newChatQuery,
                onQueryChange = { newChatQuery = it },
                placeholder = "Search agents or projects…",
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            val consumeDownScroll = remember {
                object : NestedScrollConnection {
                    override fun onPostScroll(
                        consumed: Offset,
                        available: Offset,
                        source: NestedScrollSource,
                    ): Offset = available.copy(y = available.y.coerceAtMost(0f))
                }
            }
            LazyColumn(modifier = Modifier.fillMaxHeight(0.85f).nestedScroll(consumeDownScroll)) {
                if (newChatQuery.isBlank()) {
                    item {
                        NewChatItem(label = "No agent / No project") {
                            scope.launch { sheetState.hide() }.invokeOnCompletion {
                                showNewChatSheet = false; newChatQuery = ""
                            }
                            onOpenDraftChat(UUID.randomUUID().toString(), null, null)
                        }
                    }
                }
                if (filteredAgents.isNotEmpty()) {
                    item {
                        Text(
                            "Agents",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                        )
                    }
                    items(filteredAgents, key = { it.id }) { agent ->
                        NewChatItem(label = if (agent.icon.isNotBlank()) "${agent.icon}  ${agent.name}" else agent.name) {
                            scope.launch { sheetState.hide() }.invokeOnCompletion {
                                showNewChatSheet = false; newChatQuery = ""
                            }
                            onOpenDraftChat(UUID.randomUUID().toString(), agent.id, null)
                        }
                    }
                }
                if (filteredProjects.isNotEmpty()) {
                    item {
                        Text(
                            "Projects",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                        )
                    }
                    items(filteredProjects, key = { it.id }) { project ->
                        NewChatItem(
                            label = project.name,
                            dotColor = projectColor(project.color),
                        ) {
                            scope.launch { sheetState.hide() }.invokeOnCompletion {
                                showNewChatSheet = false; newChatQuery = ""
                            }
                            onOpenDraftChat(UUID.randomUUID().toString(), null, project.id)
                        }
                    }
                }
                if (filteredAgents.isEmpty() && filteredProjects.isEmpty() && newChatQuery.isNotBlank()) {
                    item {
                        Text(
                            "No results for \"$newChatQuery\"",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp),
                        )
                    }
                }
                item { Spacer(Modifier.padding(bottom = 16.dp)) }
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Box(
                        modifier = Modifier
                            .background(Color(0xFF1F2937), RoundedCornerShape(6.dp))
                            .padding(horizontal = 10.dp, vertical = 5.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = buildAnnotatedString {
                                withStyle(SpanStyle(color = NexyViolet)) { append("N") }
                                withStyle(SpanStyle(color = Color.White)) { append("exy") }
                            },
                            style = if (LocalNexyEightBit.current) NexyTextStyles.Brand else MaterialTheme.typography.titleMedium,
                            fontWeight = if (LocalNexyEightBit.current) FontWeight.Normal else FontWeight.Bold,
                            fontStyle = if (LocalNexyEightBit.current) FontStyle.Normal else FontStyle.Italic,
                        )
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = onOpenNewContent) {
                            NexyIcon(NexyIconName.Inbox, contentDescription = "Open new content")
                        }
                        if (completedWhileAwayIds.isNotEmpty()) {
                            Box(
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .background(MaterialTheme.colorScheme.error, RoundedCornerShape(8.dp))
                                    .padding(horizontal = 4.dp, vertical = 1.dp),
                            ) {
                                Text(
                                    if (completedWhileAwayIds.size > 9) "9+" else completedWhileAwayIds.size.toString(),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onError,
                                )
                            }
                        }
                    }
                    IconButton(onClick = onOpenSettings) {
                        NexyIcon(NexyIconName.Settings, contentDescription = "Settings")
                    }
                    Box {
                        IconButton(onClick = { showOverflowMenu = true }) {
                            NexyIcon(NexyIconName.More, contentDescription = "More options")
                        }
                        DropdownMenu(
                            expanded = showOverflowMenu,
                            onDismissRequest = { showOverflowMenu = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text("Skills") },
                                leadingIcon = { NexyIcon(NexyIconName.Skill, contentDescription = null) },
                                onClick = { showOverflowMenu = false; onOpenSkills() },
                            )
                            DropdownMenuItem(
                                text = { Text("Artifacts") },
                                leadingIcon = { NexyIcon(NexyIconName.Artifact, contentDescription = null) },
                                onClick = { showOverflowMenu = false; onOpenArtifacts() },
                                enabled = connectionState == ConnectionState.CONNECTED,
                            )
                            DropdownMenuItem(
                                text = { Text(if (connectionState == ConnectionState.CONNECTED) "Scheduled" else "Scheduled · desktop required") },
                                leadingIcon = { NexyIcon(NexyIconName.Scheduled, contentDescription = null) },
                                onClick = { showOverflowMenu = false; onOpenScheduled() },
                                enabled = connectionState == ConnectionState.CONNECTED,
                            )
                            DropdownMenuItem(
                                text = { Text(if (connectionState == ConnectionState.CONNECTED) "Automated Workflows" else "Automated Workflows · desktop required") },
                                leadingIcon = { NexyIcon(NexyIconName.Workflow, contentDescription = null) },
                                onClick = { showOverflowMenu = false; onOpenAutomatedWorkflows() },
                                enabled = connectionState == ConnectionState.CONNECTED,
                            )
                            DropdownMenuItem(
                                text = { Text(if (connectionState == ConnectionState.CONNECTED) "Work history" else "Work history · desktop required") },
                                onClick = { showOverflowMenu = false; onOpenWorkHistory() },
                                enabled = connectionState == ConnectionState.CONNECTED,
                            )
                            DropdownMenuItem(
                                text = { Text(if (connectionState == ConnectionState.CONNECTED) "Ratings" else "Ratings · desktop required") },
                                leadingIcon = { NexyIcon(NexyIconName.Rating, contentDescription = null) },
                                onClick = { showOverflowMenu = false; onOpenRatings() },
                                enabled = connectionState == ConnectionState.CONNECTED,
                            )
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            var showFabMenu by remember { mutableStateOf(false) }
            Box(modifier = Modifier.padding(end = 20.dp)) {
                FloatingActionButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        when (selectedTab) {
                            0 -> showNewChatSheet = true
                            1 -> showFabMenu = true
                            2 -> showFabMenu = true
                        }
                    },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    NexyIcon(
                        NexyIconName.Add,
                        contentDescription = when (selectedTab) {
                            0 -> "New Chat"; 1 -> "New Project"; else -> "New Agent"
                        },
                    )
                }
                DropdownMenu(
                    expanded = showFabMenu,
                    onDismissRequest = { showFabMenu = false },
                ) {
                    when (selectedTab) {
                        1 -> {
                            DropdownMenuItem(
                                text = { Text("Add project") },
                                onClick = { showFabMenu = false; showCreateProjectSheet = true },
                            )
                            DropdownMenuItem(
                                text = { Text(if (connectionState == ConnectionState.CONNECTED) "Generate project" else "Generate project · desktop required") },
                                onClick = { showFabMenu = false; onOpenProjectGenerator() },
                                enabled = connectionState == ConnectionState.CONNECTED,
                            )
                        }
                        2 -> {
                            DropdownMenuItem(
                                text = { Text("Add agent") },
                                onClick = { showFabMenu = false; showCreateAgentSheet = true },
                            )
                            DropdownMenuItem(
                                text = { Text(if (connectionState == ConnectionState.CONNECTED) "Generate agent" else "Generate agent · desktop required") },
                                onClick = { showFabMenu = false; onOpenAgentGenerator() },
                                enabled = connectionState == ConnectionState.CONNECTED,
                            )
                        }
                    }
                }
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            PrimaryTabRow(selectedTabIndex = selectedTab) {
                tabTitles.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(title, style = MaterialTheme.typography.labelLarge) },
                    )
                }
            }

            when (selectedTab) {
                0 -> ChatsTab(
                    conversations = conversations,
                    agents = agents,
                    projects = projects,
                    isRefreshing = isRefreshingConversations,
                    isPullRefreshing = isPullRefreshingConversations,
                    searchQuery = searchQuery,
                    searchResults = searchResults,
                    onSearchQueryChange = { vm.setSearchQuery(it) },
                    completionFilter = completionFilter,
                    onCompletionFilterChange = { vm.setCompletionFilter(it) },
                    onScopeChange = { type, id -> vm.setConversationScope(type, id) },
                    onOpenChat = onOpenChat,
                    onRefresh = { vm.pullRefreshConversations() },
                    onDisconnect = { vm.disconnect() },
                    onRenameConversation = { id, title -> vm.renameConversation(id, title) },
                    onDeleteConversation = { id -> vm.deleteConversation(id) },
                    onTogglePinConversation = { id, pinned -> vm.setPinnedConversation(id, pinned) },
                    onMarkComplete = { vm.markConversationComplete(it) },
                    onMarkIncomplete = { vm.markConversationIncomplete(it) },
                    activeConversationIds = activeConversationIds,
                    pendingConversationIds = pendingConversationIds,
                    completedWhileAwayIds = completedWhileAwayIds,
                    totalCount = conversationTotalCount,
                    hasMore = conversationHasMore,
                    onLoadMore = { vm.loadMoreConversations() },
                )
                1 -> ProjectsTab(
                    projects = projects,
                    isRefreshing = isRefreshingProjects,
                    isPullRefreshing = isPullRefreshingProjects,
                    showCreateSheet = showCreateProjectSheet,
                    highlightProjectId = highlightProjectId,
                    onHighlightConsumed = { vm.clearHighlightProject() },
                    onDismissCreateSheet = { showCreateProjectSheet = false },
                    onRefresh = { vm.pullRefreshProjects() },
                    onOpenProjectHistory = onOpenProjectHistory,
                    onOpenProjectConfig = onOpenProjectConfig,
                    onOpenProjectGenerator = onOpenProjectGenerator,
                    onOpenCodePanel = onOpenCodePanel,
                    connectionState = connectionState,
                    onCreateProject = { name, color -> vm.createProject(name, color) },
                    onRenameProject = { id, name -> vm.renameProject(id, name) },
                    onDeleteProject = { id, deleteChats -> vm.deleteProject(id, deleteChats) },
                )
                2 -> AgentsTab(
                    agents = agents,
                    isRefreshing = isRefreshingAgents,
                    isPullRefreshing = isPullRefreshingAgents,
                    showCreateSheet = showCreateAgentSheet,
                    highlightAgentId = highlightAgentId,
                    onHighlightConsumed = { vm.clearHighlightAgent() },
                    onDismissCreateSheet = { showCreateAgentSheet = false },
                    onRefresh = { vm.pullRefreshAgents() },
                    onOpenAgentHistory = onOpenAgentHistory,
                    onOpenAgentConfig = onOpenAgentConfig,
                    onOpenAgentGenerator = onOpenAgentGenerator,
                    onCreateAgent = { name, icon -> vm.createAgent(name, icon) },
                    onRenameAgent = { id, name, icon -> vm.updateAgent(id, name, icon) },
                    onDeleteAgent = { id -> vm.deleteAgent(id) },
                )
            }
        }
    }
}

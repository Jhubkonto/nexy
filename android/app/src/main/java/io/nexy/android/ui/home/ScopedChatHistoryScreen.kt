package io.nexy.android.ui.home

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.components.NexyPaginationFooter
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.Conversation
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.WsRepository
import java.util.UUID

enum class HistoryScope {
    Agent,
    Project,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScopedChatHistoryScreen(
    scopeType: HistoryScope,
    scopeId: String,
    onBack: () -> Unit,
    onOpenChat: (String) -> Unit,
    onOpenDraftChat: (String, String?, String?) -> Unit,
    onOpenDebrief: ((String) -> Unit)? = null,
    onOpenQuiz: ((String) -> Unit)? = null,
    vm: ScopedChatHistoryViewModel = viewModel(),
) {
    val agents by WsRepository.agents.collectAsStateWithLifecycle()
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val activeConversationIds by WsRepository.activeConversationIds.collectAsStateWithLifecycle()
    val completedConversationIds by WsRepository.completedConversationIds.collectAsStateWithLifecycle()
    val completedWhileAwayIds by WsRepository.completedWhileAwayIds.collectAsStateWithLifecycle()

    val conversations by vm.conversations.collectAsStateWithLifecycle()
    val totalCount by vm.totalCount.collectAsStateWithLifecycle()
    val hasMore by vm.hasMore.collectAsStateWithLifecycle()
    val isRefreshing by vm.isRefreshing.collectAsStateWithLifecycle()
    val isLoadingMore by vm.isLoadingMore.collectAsStateWithLifecycle()
    val isPullRefreshing by vm.isPullRefreshing.collectAsStateWithLifecycle()
    val searchQuery by vm.searchQuery.collectAsStateWithLifecycle()
    val completionFilter by vm.completionFilter.collectAsStateWithLifecycle()
    val freshPageGeneration by vm.freshPageGeneration.collectAsStateWithLifecycle()

    var deletingConversation by remember { mutableStateOf<Conversation?>(null) }
    val listState = rememberLazyListState()

    LaunchedEffect(scopeType, scopeId) { vm.start(scopeType, scopeId) }

    RefreshConversationsOnResume { vm.onResume() }

    // A navigation entry keeps its LazyListState while a chat is open above it. Every fresh
    // history page represents entering/resuming this destination (or starting a new search), so
    // explicitly return to the newest conversation. Appended pagination pages intentionally keep
    // the user's position. Guarded on `> 0` so the initial composition (generation 0) is a no-op.
    LaunchedEffect(freshPageGeneration) {
        if (freshPageGeneration > 0 && conversations.isNotEmpty()) listState.scrollToItem(0)
    }

    val title = when (scopeType) {
        HistoryScope.Agent -> agents.find { it.id == scopeId }?.let { agent ->
            if (agent.icon.isNotBlank()) "${agent.icon}  ${agent.name}" else agent.name
        } ?: "Agent chats"
        HistoryScope.Project -> projects.find { it.id == scopeId }?.name ?: "Project chats"
    }

    deletingConversation?.let { conv ->
        NexyConfirmDialog(
            title = "Delete chat?",
            message = "\"${conv.title.ifBlank { "Untitled" }}\" will be permanently deleted.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                WsRepository.deleteConversation(conv.id)
                deletingConversation = null
            },
            onDismiss = { deletingConversation = null },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Column {
                        Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            "$totalCount chat${if (totalCount == 1) "" else "s"}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                onBack = onBack,
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = {
                    val id = UUID.randomUUID().toString()
                    when (scopeType) {
                        HistoryScope.Agent -> onOpenDraftChat(id, scopeId, null)
                        HistoryScope.Project -> onOpenDraftChat(id, null, scopeId)
                    }
                },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                NexyIcon(NexyIconName.Add, contentDescription = "New Chat")
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isPullRefreshing,
            onRefresh = { vm.pullRefresh() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
        Column(modifier = Modifier.fillMaxSize()) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { vm.setSearchQuery(it) },
                modifier = Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 12.dp),
                singleLine = true,
                leadingIcon = { NexyIcon(NexyIconName.Search, contentDescription = null) },
                trailingIcon = {
                    if (searchQuery.isNotBlank()) {
                        IconButton(onClick = { vm.setSearchQuery("") }) {
                            NexyIcon(NexyIconName.Close, contentDescription = "Clear search")
                        }
                    }
                },
                placeholder = { Text("Search chats", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                shape = MaterialTheme.shapes.small,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
            )
            androidx.compose.foundation.layout.Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf("ongoing" to "Ongoing", "completed" to "Completed", "all" to "All").forEach { (value, label) ->
                    FilterChip(
                        selected = completionFilter == value,
                        onClick = { vm.setCompletionFilter(value) },
                        label = { Text(label) },
                    )
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(top = 8.dp))
            // Non-destructive refresh affordance: while refreshing over already-cached rows, show a
            // thin progress bar instead of blanking to the skeleton, matching the global Chats tab.
            if (isRefreshing && conversations.isNotEmpty()) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
            if (conversations.isEmpty() && isRefreshing) {
                ConversationListSkeleton()
            } else if (conversations.isEmpty() && !isRefreshing) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        if (searchQuery.isBlank()) "No chats yet." else "No matching chats.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (searchQuery.isNotBlank()) {
                        TextButton(onClick = { vm.setSearchQuery("") }) { Text("Clear search") }
                    }
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(conversations, key = { it.id }) { conversation ->
                        ConversationRow(
                            conv = conversation,
                            projects = projects,
                            onOpenChat = onOpenChat,
                            isActive = conversation.id in activeConversationIds,
                            hasNewContent = conversation.id in completedWhileAwayIds,
                            // Derive completion from the conversation's own completed_at (as the
                            // all-chats list and in-chat header badge both do). The
                            // completedConversationIds set is only ever hydrated from the *global*
                            // conversation list, so a project/agent-scoped conversation that isn't on
                            // that list would never show its checkmark. OR in the set so an optimistic
                            // mark-complete still reflects immediately before the next page refresh.
                            isCompleted = conversation.completed_at != null || conversation.id in completedConversationIds,
                            onDelete = { _ -> deletingConversation = conversation },
                            onTogglePin = { id, pinned ->
                                WsRepository.setPinnedConversation(id, pinned)
                                vm.updatePinned(id, pinned)
                            },
                            onDebrief = if (onOpenDebrief != null) { id -> onOpenDebrief(id) } else null,
                            onMarkComplete = { id ->
                                WsRepository.markConversationComplete(id)
                                vm.updateCompletedAt(id, System.currentTimeMillis())
                                vm.onResume()
                            },
                            onMarkIncomplete = { id ->
                                WsRepository.markConversationIncomplete(id)
                                vm.updateCompletedAt(id, null)
                                vm.onResume()
                            },
                            onQuiz = if (onOpenQuiz != null) { id -> onOpenQuiz(id) } else null,
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    item(key = "pagination-footer") {
                        NexyPaginationFooter(
                            loadedCount = conversations.size,
                            totalCount = totalCount,
                            hasMore = hasMore,
                            isLoading = isLoadingMore,
                            error = null,
                            onLoadMore = { vm.loadMore() },
                            onRetry = { vm.retry() },
                        )
                    }
                }
            }
        }
        }
    }
}

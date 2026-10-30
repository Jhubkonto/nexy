package io.nexy.android.ui.home

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Backs [ScopedChatHistoryScreen]. Mirrors [HomeViewModel]'s conversation-paging behaviour so the
 * scoped (per-agent / per-project) history surface has UI parity with the global Chats tab.
 *
 * The key difference from the previous in-composable state: a non-append refresh (initial load,
 * ON_RESUME, or a settled search) updates the list **in place** and never blanks it. The loading
 * skeleton is therefore only reachable on a genuine cold start (nothing cached yet); a refresh over
 * existing rows keeps them on screen and surfaces progress through [isRefreshing] instead. This is
 * what eliminates the double-load skeleton flash when entering a chat history from a project/agent.
 */
class ScopedChatHistoryViewModel(
    app: Application,
    private val wsClient: WsClient,
) : AndroidViewModel(app) {

    constructor(app: Application) : this(app, WsRepository)

    private var scopeType: HistoryScope? = null
    private var scopeId: String = ""
    private var started = false

    private val _conversations = MutableStateFlow<List<Conversation>>(emptyList())
    val conversations: StateFlow<List<Conversation>> = _conversations.asStateFlow()

    private val _totalCount = MutableStateFlow(0)
    val totalCount: StateFlow<Int> = _totalCount.asStateFlow()

    private val _hasMore = MutableStateFlow(false)
    val hasMore: StateFlow<Boolean> = _hasMore.asStateFlow()

    private val _nextCursor = MutableStateFlow<String?>(null)

    // A non-append request (initial load, resume, or settled search) is in flight. Drives the
    // skeleton only while there's nothing cached to show; otherwise the existing rows stay put.
    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    // An append (pagination) request is in flight — drives the footer spinner only.
    private val _isLoadingMore = MutableStateFlow(false)
    val isLoadingMore: StateFlow<Boolean> = _isLoadingMore.asStateFlow()

    // Set only by an explicit pull-to-refresh gesture, so the pull spinner doesn't fire redundantly
    // alongside the initial-load skeleton or an ON_RESUME refresh.
    private val _isPullRefreshing = MutableStateFlow(false)
    val isPullRefreshing: StateFlow<Boolean> = _isPullRefreshing.asStateFlow()

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()
    private val _completionFilter = MutableStateFlow("ongoing")
    val completionFilter: StateFlow<String> = _completionFilter.asStateFlow()

    // Bumped whenever a fresh (non-append) page replaces the list, so the screen can return the
    // LazyColumn to the newest conversation. Appended pages leave the user's scroll position alone.
    private val _freshPageGeneration = MutableStateFlow(0)
    val freshPageGeneration: StateFlow<Int> = _freshPageGeneration.asStateFlow()

    private val pendingRequests = mutableMapOf<String, Boolean>()
    private var searchJob: Job? = null

    init {
        viewModelScope.launch {
            wsClient.events.collect { event ->
                if (event is WsEvent.ConversationPage) {
                    val append = pendingRequests.remove(event.requestId) ?: return@collect
                    _conversations.value = if (append) {
                        (_conversations.value + event.conversations).distinctBy { it.id }
                    } else {
                        _freshPageGeneration.value += 1
                        event.conversations
                    }
                    _totalCount.value = event.totalCount
                    _nextCursor.value = event.nextCursor
                    _hasMore.value = event.hasMore
                    _isRefreshing.value = false
                    _isLoadingMore.value = false
                    _isPullRefreshing.value = false
                }
                if (event is WsEvent.DebriefConversationCompleted) {
                    updateCompletedAt(event.conversationId, event.completedAt)
                    if (_completionFilter.value == "ongoing") {
                        _conversations.value = _conversations.value.filterNot { it.id == event.conversationId }
                    }
                    requestPage(append = false)
                }
                if (event is WsEvent.DebriefConversationIncompleted) {
                    updateCompletedAt(event.conversationId, null)
                    if (_completionFilter.value == "completed") {
                        _conversations.value = _conversations.value.filterNot { it.id == event.conversationId }
                    }
                    requestPage(append = false)
                }
            }
        }
    }

    /** Idempotent — the first call (or a scope change) triggers the initial page load. */
    fun start(scopeType: HistoryScope, scopeId: String) {
        if (started && this.scopeType == scopeType && this.scopeId == scopeId) return
        this.scopeType = scopeType
        this.scopeId = scopeId
        started = true
        requestPage(append = false)
    }

    /** Called when the destination resumes — refreshes in place without blanking the list. */
    fun onResume() {
        if (started) requestPage(append = false)
    }

    fun pullRefresh() {
        _isPullRefreshing.value = true
        requestPage(append = false)
    }

    fun loadMore() {
        if (_isLoadingMore.value || !_hasMore.value) return
        requestPage(append = true)
    }

    fun retry() {
        requestPage(append = _conversations.value.isNotEmpty())
    }

    /**
     * Eagerly reflects a mark-complete/incomplete action in the loaded page so the checkmark
     * updates immediately, matching [completedConversationIds] rather than waiting for the next
     * page refresh to pick up a fresh `completed_at`.
     */
    fun updateCompletedAt(conversationId: String, completedAt: Long?) {
        _conversations.value = _conversations.value.map { conversation ->
            if (conversation.id == conversationId) conversation.copy(completed_at = completedAt) else conversation
        }
    }

    /**
     * Eagerly reflects a pin/unpin action in the loaded page so the pin icon updates immediately.
     * [WsRepository.setPinnedConversation] only mutates the global conversation list, so this
     * scoped page needs its own optimistic copy before the desktop echoes `conversation:pinned`.
     */
    fun updatePinned(conversationId: String, pinned: Boolean) {
        _conversations.value = _conversations.value.map { conversation ->
            if (conversation.id == conversationId) conversation.copy(pinned = pinned) else conversation
        }
    }

    fun setSearchQuery(query: String) {
        if (_searchQuery.value == query) return
        _searchQuery.value = query
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(if (query.isBlank()) 0L else SEARCH_DEBOUNCE_MS)
            requestPage(append = false)
        }
    }

    fun setCompletionFilter(filter: String) {
        if (filter !in setOf("ongoing", "completed", "all") || _completionFilter.value == filter) return
        _completionFilter.value = filter
        requestPage(append = false)
    }

    private fun requestPage(append: Boolean) {
        val type = scopeType ?: return
        val requestId = UUID.randomUUID().toString()
        if (append) {
            _isLoadingMore.value = true
        } else {
            // Supersede any in-flight non-append request; the visible rows stay until the new page
            // lands, so a second trigger (e.g. ON_RESUME right after the initial load) is a harmless
            // in-place refresh rather than a visible reset.
            pendingRequests.entries.removeAll { !it.value }
            _isRefreshing.value = true
        }
        pendingRequests[requestId] = append

        val payload = mutableMapOf<String, Any>(
            "scopeType" to type.name.lowercase(),
            "scopeId" to scopeId,
            "query" to _searchQuery.value.trim(),
            "completion" to _completionFilter.value,
            "requestId" to requestId,
            "limit" to PAGE_LIMIT,
            "scope" to mapOf("type" to type.name.lowercase(), "id" to scopeId),
        )
        if (append) _nextCursor.value?.let { payload["cursor"] = it }
        wsClient.send("conversation:list-page", payload)
    }

    companion object {
        private const val SEARCH_DEBOUNCE_MS = 250L
        private const val PAGE_LIMIT = 30
    }
}

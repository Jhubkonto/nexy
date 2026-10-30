package io.nexy.android.ui.home

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.PairedServerProfile
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class HomeViewModel(
    app: Application,
    private val wsClient: WsClient,
    private val approvalEffects: ApprovalEffects,
) : AndroidViewModel(app) {

    constructor(app: Application) : this(app, WsRepository, AndroidApprovalEffects(app))

    val connectionState: StateFlow<ConnectionState> = WsRepository.connectionState
    val preferStandaloneMode: StateFlow<Boolean> = WsRepository.preferStandaloneMode
    val effectiveMode: StateFlow<io.nexy.android.data.EffectiveConnectionMode> = WsRepository.effectiveMode
    val reconnectExhausted: StateFlow<Boolean> = WsRepository.reconnectExhausted
    val intentionalRestartExpected: StateFlow<Boolean> = WsRepository.intentionalRestartExpected
    private val _conversations = MutableStateFlow<List<Conversation>>(emptyList())
    val conversations: StateFlow<List<Conversation>> = _conversations.asStateFlow()
    private val _conversationTotalCount = MutableStateFlow(0)
    val conversationTotalCount: StateFlow<Int> = _conversationTotalCount.asStateFlow()
    private val _conversationHasMore = MutableStateFlow(false)
    val conversationHasMore: StateFlow<Boolean> = _conversationHasMore.asStateFlow()
    private val _conversationNextCursor = MutableStateFlow<String?>(null)
    private var conversationScopeType = "all"
    private var conversationScopeId: String? = null
    private val _completionFilter = MutableStateFlow("ongoing")
    val completionFilter: StateFlow<String> = _completionFilter.asStateFlow()
    private val pendingConversationPages = mutableMapOf<String, Boolean>()
    val agents: StateFlow<List<Agent>> = WsRepository.agents
    val projects: StateFlow<List<Project>> = WsRepository.projects
    val profiles: StateFlow<List<PairedServerProfile>> = WsRepository.profiles
    val activeProfileId: StateFlow<String?> = WsRepository.activeProfileId
    val activeConversationIds: StateFlow<Set<String>> = WsRepository.activeConversationIds
    val pendingConversationIds: StateFlow<Set<String>> = WsRepository.pendingConversationIds
    val completedWhileAwayIds: StateFlow<Set<String>> = WsRepository.completedWhileAwayIds

    fun clearCompletedAway(id: String) = WsRepository.clearCompletedAway(id)

    fun setPreferStandaloneMode(prefer: Boolean) {
        WsRepository.setPreferStandaloneMode(prefer, getApplication())
    }

    private val _pendingApproval = MutableStateFlow<WsEvent.ToolApprovalRequest?>(null)
    val pendingApproval: StateFlow<WsEvent.ToolApprovalRequest?> = _pendingApproval

    // A second CLI turn can start (e.g. the user re-sends before approving) and broadcast its
    // own approval request while one is already showing. Queue rather than overwrite so an
    // earlier request isn't silently orphaned until its 60s server-side auto-deny timeout.
    private val approvalQueue = ArrayDeque<WsEvent.ToolApprovalRequest>()

    private fun enqueueApproval(event: WsEvent.ToolApprovalRequest) {
        if (_pendingApproval.value == null) {
            _pendingApproval.value = event
            approvalEffects.showApproval(event)
        } else {
            approvalQueue.addLast(event)
        }
    }

    private fun clearCurrentApproval() {
        _pendingApproval.value = null
        approvalEffects.cancelApproval()
        val next = approvalQueue.removeFirstOrNull()
        if (next != null) {
            _pendingApproval.value = next
            approvalEffects.showApproval(next)
        }
    }

    // Desktop denied/superseded a specific request. Drop exactly that one — advancing to the next
    // queued request if it was the visible one, or pruning it from the backlog otherwise — instead
    // of clearing whatever happens to be showing.
    private fun cancelApprovalById(requestId: String) {
        if (_pendingApproval.value?.requestId == requestId) {
            clearCurrentApproval()
        } else {
            approvalQueue.removeAll { it.requestId == requestId }
        }
    }

    private val _isRefreshingConversations = MutableStateFlow(false)
    val isRefreshingConversations: StateFlow<Boolean> = _isRefreshingConversations

    private val _isRefreshingAgents = MutableStateFlow(false)
    val isRefreshingAgents: StateFlow<Boolean> = _isRefreshingAgents

    private val _isRefreshingProjects = MutableStateFlow(false)
    val isRefreshingProjects: StateFlow<Boolean> = _isRefreshingProjects

    // Distinct from the flags above: only set by an explicit pull-to-refresh gesture, never by
    // initial load, ON_RESUME, reconnect, tab-switch, search, or pagination — so the pull spinner
    // doesn't fire redundantly alongside the top sync indicator / list skeleton.
    private val _isPullRefreshingConversations = MutableStateFlow(false)
    val isPullRefreshingConversations: StateFlow<Boolean> = _isPullRefreshingConversations

    private val _isPullRefreshingAgents = MutableStateFlow(false)
    val isPullRefreshingAgents: StateFlow<Boolean> = _isPullRefreshingAgents

    private val _isPullRefreshingProjects = MutableStateFlow(false)
    val isPullRefreshingProjects: StateFlow<Boolean> = _isPullRefreshingProjects

    private val _newConversationId = MutableStateFlow<String?>(null)
    val newConversationId: StateFlow<String?> = _newConversationId

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _searchResults = MutableStateFlow<List<Conversation>?>(null)
    val searchResults: StateFlow<List<Conversation>?> = _searchResults.asStateFlow()
    private var searchJob: Job? = null

    // One-shot signals emitted when the desktop confirms creation — carries the new item's ID
    private val _projectCreated = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val projectCreated: SharedFlow<String> = _projectCreated

    private val _agentCreated = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val agentCreated: SharedFlow<String> = _agentCreated

    // ID to flash-highlight in the list after returning from a new-item config save
    val highlightProjectId: StateFlow<String?> = WsRepository.pendingHighlightProjectId
    val highlightAgentId: StateFlow<String?> = WsRepository.pendingHighlightAgentId

    fun clearHighlightProject() { WsRepository.pendingHighlightProjectId.value = null }
    fun clearHighlightAgent() { WsRepository.pendingHighlightAgentId.value = null }

    init {
        viewModelScope.launch {
            WsRepository.approvalResolvedViaNotification.collect { _ ->
                if (_pendingApproval.value != null) {
                    clearCurrentApproval()
                }
            }
        }
        viewModelScope.launch {
            wsClient.events.collect { event ->
                when (event) {
                    is WsEvent.ToolApprovalRequest -> enqueueApproval(event)
                    is WsEvent.ToolApprovalCancel -> cancelApprovalById(event.requestId)
                    is WsEvent.ChatToolCallEvent -> {
                        // Tool ran — means any pending approval was resolved (possibly via
                        // notification while the app was backgrounded). Clear the dialog.
                        if (_pendingApproval.value != null) {
                            clearCurrentApproval()
                        }
                    }
                    is WsEvent.ChatActivity -> {
                        // A complete/error state also means the tool approval request is stale.
                        if (event.state == "complete" || event.state == "error") {
                            if (_pendingApproval.value != null) {
                                clearCurrentApproval()
                            }
                        }
                    }
                    is WsEvent.ConversationList -> {
                        _conversations.value = event.conversations
                        _conversationTotalCount.value = event.conversations.size
                        _isRefreshingConversations.value = false
                        _isPullRefreshingConversations.value = false
                    }
                    is WsEvent.ConversationPage -> {
                        val append = pendingConversationPages.remove(event.requestId) ?: return@collect
                        _conversations.value = if (append) {
                            (_conversations.value + event.conversations).distinctBy { it.id }
                        } else event.conversations
                        _conversationTotalCount.value = event.totalCount
                        _conversationHasMore.value = event.hasMore
                        _conversationNextCursor.value = event.nextCursor
                        _isRefreshingConversations.value = false
                        _isPullRefreshingConversations.value = false
                        _searchResults.value = if (_searchQuery.value.isBlank()) null else _conversations.value
                    }
                    is WsEvent.DebriefConversationCompleted -> {
                        _conversations.value = _conversations.value.map {
                            if (it.id == event.conversationId) it.copy(completed_at = event.completedAt) else it
                        }
                        if (_completionFilter.value == "ongoing") {
                            _conversations.value = _conversations.value.filterNot { it.id == event.conversationId }
                        }
                        refreshConversations()
                    }
                    is WsEvent.DebriefConversationIncompleted -> {
                        _conversations.value = _conversations.value.map {
                            if (it.id == event.conversationId) it.copy(completed_at = null) else it
                        }
                        if (_completionFilter.value == "completed") {
                            _conversations.value = _conversations.value.filterNot { it.id == event.conversationId }
                        }
                        refreshConversations()
                    }
                    is WsEvent.AgentList -> {
                        _isRefreshingAgents.value = false
                        _isPullRefreshingAgents.value = false
                    }
                    is WsEvent.ProjectList -> {
                        _isRefreshingProjects.value = false
                        _isPullRefreshingProjects.value = false
                    }
                    is WsEvent.ConversationCreated -> _newConversationId.value = event.id
                    is WsEvent.ConversationSearchResults -> _searchResults.value = event.conversations
                    is WsEvent.ProjectCreated -> _projectCreated.tryEmit(event.project.id)
                    is WsEvent.AgentCreated -> _agentCreated.tryEmit(event.agent.id)
                    else -> {}
                }
            }
        }
        refreshConversations()
    }

    fun refreshConversations() {
        _isRefreshingConversations.value = true
        requestConversationPage(append = false)
    }

    /** Call from a user pull-to-refresh gesture only — shows the pull spinner. */
    fun pullRefreshConversations() {
        _isPullRefreshingConversations.value = true
        refreshConversations()
    }

    fun loadMoreConversations() {
        if (!_isRefreshingConversations.value && _conversationHasMore.value) {
            _isRefreshingConversations.value = true
            requestConversationPage(append = true)
        }
    }

    private fun requestConversationPage(append: Boolean, query: String = _searchQuery.value.trim()) {
        val requestId = java.util.UUID.randomUUID().toString()
        if (!append) pendingConversationPages.clear()
        pendingConversationPages[requestId] = append
        val payload = mutableMapOf<String, Any>(
            "requestId" to requestId,
            "scopeType" to conversationScopeType,
            "scope" to buildMap<String, Any> {
                put("type", conversationScopeType)
                conversationScopeId?.let { put("id", it) }
            },
            "completion" to _completionFilter.value,
            "query" to query,
            "limit" to 30,
        )
        conversationScopeId?.let { payload["scopeId"] = it }
        if (append) _conversationNextCursor.value?.let { payload["cursor"] = it }
        wsClient.send("conversation:list-page", payload)
    }

    fun requestAgents() {
        _isRefreshingAgents.value = true
        wsClient.send("agent:list", emptyMap())
    }

    /** Call from a user pull-to-refresh gesture only — shows the pull spinner. */
    fun pullRefreshAgents() {
        _isPullRefreshingAgents.value = true
        requestAgents()
    }

    fun requestProjects() {
        _isRefreshingProjects.value = true
        wsClient.send("project:list", emptyMap())
    }

    /** Call from a user pull-to-refresh gesture only — shows the pull spinner. */
    fun pullRefreshProjects() {
        _isPullRefreshingProjects.value = true
        requestProjects()
    }

    fun approveRequest(requestId: String) {
        wsClient.send("tool:approve", mapOf("requestId" to requestId))
        approvalEffects.vibrateDecision(approved = true)
        clearCurrentApproval()
    }

    fun rejectRequest(requestId: String) {
        wsClient.send("tool:reject", mapOf("requestId" to requestId))
        approvalEffects.vibrateDecision(approved = false)
        clearCurrentApproval()
    }

    fun clearNewConversation() {
        _newConversationId.value = null
    }

    fun setSearchQuery(q: String) {
        if (_searchQuery.value == q) return

        _searchQuery.value = q
        searchJob?.cancel()
        pendingConversationPages.clear()

        if (q.isBlank()) {
            _searchResults.value = null
            _isRefreshingConversations.value = true
            requestConversationPage(append = false, query = "")
            return
        }

        // Keep the current rows visible while the replacement search is pending.
        if (_searchResults.value == null) _searchResults.value = _conversations.value
        _isRefreshingConversations.value = false
        searchJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            _isRefreshingConversations.value = true
            requestConversationPage(append = false, query = q.trim())
        }
    }

    /** Scope and completion are server-side query inputs, never a filter over loaded pages. */
    fun setConversationScope(type: String, id: String? = null) {
        if (conversationScopeType == type && conversationScopeId == id) return
        conversationScopeType = type
        conversationScopeId = id
        refreshConversations()
    }

    fun setCompletionFilter(filter: String) {
        if (filter !in setOf("ongoing", "completed", "all") || _completionFilter.value == filter) return
        _completionFilter.value = filter
        refreshConversations()
    }

    fun markConversationComplete(id: String) {
        WsRepository.markConversationComplete(id)
        _conversations.value = _conversations.value.map { if (it.id == id) it.copy(completed_at = System.currentTimeMillis()) else it }
        if (_completionFilter.value == "ongoing") _conversations.value = _conversations.value.filterNot { it.id == id }
        refreshConversations()
    }

    fun markConversationIncomplete(id: String) {
        WsRepository.markConversationIncomplete(id)
        _conversations.value = _conversations.value.map { if (it.id == id) it.copy(completed_at = null) else it }
        if (_completionFilter.value == "completed") _conversations.value = _conversations.value.filterNot { it.id == id }
        refreshConversations()
    }

    fun renameConversation(id: String, title: String) = WsRepository.renameConversation(id, title)

    fun deleteConversation(id: String) = WsRepository.deleteConversation(id)

    fun setPinnedConversation(id: String, pinned: Boolean) = WsRepository.setPinnedConversation(id, pinned)

    fun createProject(name: String, color: String) = WsRepository.createProject(name, color)
    fun renameProject(id: String, name: String) = WsRepository.renameProject(id, name)
    fun deleteProject(id: String, deleteChats: Boolean = false) = WsRepository.deleteProject(id, deleteChats)
    fun createAgent(name: String, icon: String) = WsRepository.createAgent(name, icon)
    fun updateAgent(id: String, name: String, icon: String) = WsRepository.updateAgent(id, name, icon)
    fun deleteAgent(id: String) = WsRepository.deleteAgent(id)

    fun wakeDesktop() {
        WsRepository.wakeDesktop()
    }

    fun disconnect() {
        WsRepository.disconnect()
    }

    fun switchProfile(profileId: String) {
        WsRepository.switchProfile(profileId)
    }
}

private const val SEARCH_DEBOUNCE_MS = 250L

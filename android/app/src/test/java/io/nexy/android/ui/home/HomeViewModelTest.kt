package io.nexy.android.ui.home

import android.app.Application
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun requestsFirstConversationPageOnInit() = runTest {
        val fakeWs = FakeWsClient()
        val vm = HomeViewModel(Application(), fakeWs, FakeApprovalEffects())

        val command = fakeWs.sentCommands.single()
        assertEquals("conversation:list-page", command.command)
        assertEquals(mapOf("type" to "all"), command.data["scope"])
        assertEquals("ongoing", command.data["completion"])
        assertEquals(30, command.data["limit"])
        assertTrue((command.data["requestId"] as? String).orEmpty().isNotBlank())
        assertTrue(vm.isRefreshingConversations.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun refreshFlagsClearWhenListsArrive() = runTest {
        val fakeWs = FakeWsClient()
        val vm = HomeViewModel(Application(), fakeWs, FakeApprovalEffects())
        advanceUntilIdle()

        vm.refreshConversations()
        vm.requestAgents()
        vm.requestProjects()

        assertTrue(vm.isRefreshingConversations.value)
        assertTrue(vm.isRefreshingAgents.value)
        assertTrue(vm.isRefreshingProjects.value)

        fakeWs.emit(WsEvent.ConversationList(listOf(Conversation("conv-1", "Chat", "1", "1"))))
        fakeWs.emit(WsEvent.AgentList(listOf(Agent("agent-1", "Agent", ""))))
        fakeWs.emit(WsEvent.ProjectList(listOf(Project("project-1", "Project", "blue", 0, emptyList()))))
        advanceUntilIdle()

        assertFalse(vm.isRefreshingConversations.value)
        assertFalse(vm.isRefreshingAgents.value)
        assertFalse(vm.isRefreshingProjects.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun toolApprovalEventSetsPendingApprovalAndShowsNotification() = runTest {
        val fakeWs = FakeWsClient()
        val fakeEffects = FakeApprovalEffects()
        val vm = HomeViewModel(Application(), fakeWs, fakeEffects)
        advanceUntilIdle()

        val request = WsEvent.ToolApprovalRequest(
            requestId = "req-1",
            toolName = "browser_click",
            args = mapOf("selector" to "#submit"),
        )
        fakeWs.emit(request)
        advanceUntilIdle()

        assertEquals(request, vm.pendingApproval.value)
        assertEquals(listOf(request), fakeEffects.shownApprovals)

        vm.viewModelScope.cancel()
    }

    @Test
    fun approveRequestSendsCommandClearsPendingAndRunsApproveEffects() = runTest {
        val fakeWs = FakeWsClient()
        val fakeEffects = FakeApprovalEffects()
        val vm = HomeViewModel(Application(), fakeWs, fakeEffects)
        advanceUntilIdle()

        fakeWs.emit(WsEvent.ToolApprovalRequest("req-1", "fileWrite", emptyMap()))
        advanceUntilIdle()

        vm.approveRequest("req-1")

        assertEquals(SentCommand("tool:approve", mapOf("requestId" to "req-1")), fakeWs.sentCommands.last())
        assertNull(vm.pendingApproval.value)
        assertEquals(listOf(true), fakeEffects.vibrations)
        assertEquals(1, fakeEffects.cancelCount)

        vm.viewModelScope.cancel()
    }

    @Test
    fun rejectRequestSendsCommandClearsPendingAndRunsRejectEffects() = runTest {
        val fakeWs = FakeWsClient()
        val fakeEffects = FakeApprovalEffects()
        val vm = HomeViewModel(Application(), fakeWs, fakeEffects)
        advanceUntilIdle()

        fakeWs.emit(WsEvent.ToolApprovalRequest("req-2", "shellExec", emptyMap()))
        advanceUntilIdle()

        vm.rejectRequest("req-2")

        assertEquals(SentCommand("tool:reject", mapOf("requestId" to "req-2")), fakeWs.sentCommands.last())
        assertNull(vm.pendingApproval.value)
        assertEquals(listOf(false), fakeEffects.vibrations)
        assertEquals(1, fakeEffects.cancelCount)

        vm.viewModelScope.cancel()
    }

    @Test
    fun secondApprovalRequestIsQueuedNotOverwrittenAndShownAfterFirstResolves() = runTest {
        val fakeWs = FakeWsClient()
        val fakeEffects = FakeApprovalEffects()
        val vm = HomeViewModel(Application(), fakeWs, fakeEffects)
        advanceUntilIdle()

        val first = WsEvent.ToolApprovalRequest("req-1", "fileWrite", emptyMap())
        val second = WsEvent.ToolApprovalRequest("req-2", "fileWrite", emptyMap())
        fakeWs.emit(first)
        advanceUntilIdle()
        fakeWs.emit(second)
        advanceUntilIdle()

        // The second request must not silently overwrite the first while it's unresolved.
        assertEquals(first, vm.pendingApproval.value)
        assertEquals(listOf(first), fakeEffects.shownApprovals)

        vm.approveRequest("req-1")
        advanceUntilIdle()

        // Resolving the first reveals the queued second request instead of leaving it orphaned.
        assertEquals(second, vm.pendingApproval.value)
        assertEquals(listOf(first, second), fakeEffects.shownApprovals)

        vm.viewModelScope.cancel()
    }

    @Test
    fun approvalCancelDismissesTheVisibleRequestAndAdvancesTheQueue() = runTest {
        val fakeWs = FakeWsClient()
        val fakeEffects = FakeApprovalEffects()
        val vm = HomeViewModel(Application(), fakeWs, fakeEffects)
        advanceUntilIdle()

        val first = WsEvent.ToolApprovalRequest("req-1", "fileWrite", emptyMap())
        val second = WsEvent.ToolApprovalRequest("req-2", "fileWrite", emptyMap())
        fakeWs.emit(first)
        fakeWs.emit(second)
        advanceUntilIdle()
        assertEquals(first, vm.pendingApproval.value)

        // Desktop superseded the visible request: it should be dropped and the queued one shown.
        fakeWs.emit(WsEvent.ToolApprovalCancel("req-1"))
        advanceUntilIdle()
        assertEquals(second, vm.pendingApproval.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun approvalCancelForAQueuedRequestPrunesItWithoutDisturbingTheVisibleOne() = runTest {
        val fakeWs = FakeWsClient()
        val fakeEffects = FakeApprovalEffects()
        val vm = HomeViewModel(Application(), fakeWs, fakeEffects)
        advanceUntilIdle()

        val first = WsEvent.ToolApprovalRequest("req-1", "fileWrite", emptyMap())
        val second = WsEvent.ToolApprovalRequest("req-2", "fileWrite", emptyMap())
        fakeWs.emit(first)
        fakeWs.emit(second)
        advanceUntilIdle()
        assertEquals(first, vm.pendingApproval.value)

        // Cancelling the queued (not visible) request leaves the current dialog untouched...
        fakeWs.emit(WsEvent.ToolApprovalCancel("req-2"))
        advanceUntilIdle()
        assertEquals(first, vm.pendingApproval.value)

        // ...and it is gone from the backlog, so resolving the first surfaces nothing.
        vm.approveRequest("req-1")
        advanceUntilIdle()
        assertNull(vm.pendingApproval.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun conversationCreatedEventSetsAndClearsNewConversationId() = runTest {
        val fakeWs = FakeWsClient()
        val vm = HomeViewModel(Application(), fakeWs, FakeApprovalEffects())
        advanceUntilIdle()

        fakeWs.emit(WsEvent.ConversationCreated("conv-new", "agent-1", "proj-1", "New Chat"))
        advanceUntilIdle()

        assertEquals("conv-new", vm.newConversationId.value)

        vm.clearNewConversation()

        assertNull(vm.newConversationId.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun rapidSearchTypingSendsOnlyTheSettledQuery() = runTest {
        val fakeWs = FakeWsClient()
        val vm = HomeViewModel(Application(), fakeWs, FakeApprovalEffects())

        vm.setSearchQuery("n")
        vm.setSearchQuery("ne")
        vm.setSearchQuery("nexy")

        dispatcher.scheduler.advanceTimeBy(249)
        assertEquals(1, fakeWs.sentCommands.size)

        dispatcher.scheduler.advanceTimeBy(1)
        dispatcher.scheduler.runCurrent()
        assertEquals(2, fakeWs.sentCommands.size)
        assertEquals("nexy", fakeWs.sentCommands.last().data["query"])

        vm.viewModelScope.cancel()
    }

    @Test
    fun clearingSearchRequestsTheUnfilteredPageImmediately() = runTest {
        val fakeWs = FakeWsClient()
        val vm = HomeViewModel(Application(), fakeWs, FakeApprovalEffects())

        vm.setSearchQuery("nexy")
        vm.setSearchQuery("")

        assertEquals(2, fakeWs.sentCommands.size)
        assertEquals("", fakeWs.sentCommands.last().data["query"])
        assertNull(vm.searchResults.value)

        dispatcher.scheduler.advanceTimeBy(250)
        dispatcher.scheduler.runCurrent()
        assertEquals(2, fakeWs.sentCommands.size)

        vm.viewModelScope.cancel()
    }

    @Test
    fun completionAndScopeChangesRequestServerFilteredPages() = runTest {
        val fakeWs = FakeWsClient()
        val vm = HomeViewModel(Application(), fakeWs, FakeApprovalEffects())

        vm.setConversationScope("project", "project-1")
        vm.setCompletionFilter("completed")

        val command = fakeWs.sentCommands.last()
        assertEquals(mapOf("type" to "project", "id" to "project-1"), command.data["scope"])
        assertEquals("completed", command.data["completion"])
        vm.viewModelScope.cancel()
    }

    private data class SentCommand(val command: String, val data: Map<String, Any>)

    private class FakeWsClient : WsClient {
        private val mutableEvents = MutableSharedFlow<WsEvent>(extraBufferCapacity = 16)
        override val events: SharedFlow<WsEvent> = mutableEvents
        val sentCommands = mutableListOf<SentCommand>()

        override fun send(command: String, data: Map<String, Any>) {
            sentCommands += SentCommand(command, data)
        }

        suspend fun emit(event: WsEvent) {
            mutableEvents.emit(event)
        }
    }

    private class FakeApprovalEffects : ApprovalEffects {
        val shownApprovals = mutableListOf<WsEvent.ToolApprovalRequest>()
        val vibrations = mutableListOf<Boolean>()
        var cancelCount = 0

        override fun showApproval(request: WsEvent.ToolApprovalRequest) {
            shownApprovals += request
        }

        override fun vibrateDecision(approved: Boolean) {
            vibrations += approved
        }

        override fun cancelApproval() {
            cancelCount += 1
        }
    }
}

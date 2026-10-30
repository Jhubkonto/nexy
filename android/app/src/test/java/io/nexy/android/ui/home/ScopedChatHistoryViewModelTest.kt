package io.nexy.android.ui.home

import android.app.Application
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.model.Conversation
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ScopedChatHistoryViewModelTest {
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
    fun startRequestsScopedPageAndSetsRefreshing() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ScopedChatHistoryViewModel(Application(), fakeWs)

        vm.start(HistoryScope.Project, "proj-1")

        val command = fakeWs.sentCommands.single()
        assertEquals("conversation:list-page", command.command)
        assertEquals("project", command.data["scopeType"])
        assertEquals("proj-1", command.data["scopeId"])
        assertEquals(mapOf("type" to "project", "id" to "proj-1"), command.data["scope"])
        assertEquals("ongoing", command.data["completion"])
        assertTrue(vm.isRefreshing.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun startIsIdempotentForTheSameScope() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ScopedChatHistoryViewModel(Application(), fakeWs)

        vm.start(HistoryScope.Agent, "agent-1")
        vm.start(HistoryScope.Agent, "agent-1")

        assertEquals(1, fakeWs.sentCommands.size)

        vm.viewModelScope.cancel()
    }

    @Test
    fun conversationPagePopulatesListClearsRefreshingAndBumpsGeneration() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ScopedChatHistoryViewModel(Application(), fakeWs)
        vm.start(HistoryScope.Project, "proj-1")
        advanceUntilIdle()

        fakeWs.emitPage(fakeWs.lastRequestId(), listOf(conversation("c1"), conversation("c2")), totalCount = 2)
        advanceUntilIdle()

        assertEquals(listOf("c1", "c2"), vm.conversations.value.map { it.id })
        assertEquals(2, vm.totalCount.value)
        assertFalse(vm.isRefreshing.value)
        assertEquals(1, vm.freshPageGeneration.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun resumeRefreshKeepsExistingRowsVisibleUntilNewPageArrives() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ScopedChatHistoryViewModel(Application(), fakeWs)
        vm.start(HistoryScope.Project, "proj-1")
        advanceUntilIdle()
        fakeWs.emitPage(fakeWs.lastRequestId(), listOf(conversation("c1")), totalCount = 1)
        advanceUntilIdle()

        // A second non-append load (ON_RESUME) must NOT blank the list — this is the flicker fix.
        vm.onResume()
        advanceUntilIdle()

        assertTrue(vm.isRefreshing.value)
        assertEquals(listOf("c1"), vm.conversations.value.map { it.id })

        fakeWs.emitPage(fakeWs.lastRequestId(), listOf(conversation("c1"), conversation("c2")), totalCount = 2)
        advanceUntilIdle()

        assertFalse(vm.isRefreshing.value)
        assertEquals(listOf("c1", "c2"), vm.conversations.value.map { it.id })

        vm.viewModelScope.cancel()
    }

    @Test
    fun loadMoreAppendsAndDedupesAcrossPages() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ScopedChatHistoryViewModel(Application(), fakeWs)
        vm.start(HistoryScope.Project, "proj-1")
        advanceUntilIdle()
        fakeWs.emitPage(fakeWs.lastRequestId(), listOf(conversation("c1")), totalCount = 3, nextCursor = "cur-1", hasMore = true)
        advanceUntilIdle()

        vm.loadMore()
        val appendCommand = fakeWs.sentCommands.last()
        assertEquals("cur-1", appendCommand.data["cursor"])
        assertTrue(vm.isLoadingMore.value)

        fakeWs.emitPage(fakeWs.lastRequestId(), listOf(conversation("c1"), conversation("c2")), totalCount = 3)
        advanceUntilIdle()

        assertEquals(listOf("c1", "c2"), vm.conversations.value.map { it.id })
        assertFalse(vm.isLoadingMore.value)
        // An append page must not bump the scroll-to-top generation.
        assertEquals(1, vm.freshPageGeneration.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun rapidSearchTypingSendsOnlyTheSettledQuery() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ScopedChatHistoryViewModel(Application(), fakeWs)
        vm.start(HistoryScope.Project, "proj-1")
        advanceUntilIdle()
        val initialCount = fakeWs.sentCommands.size

        vm.setSearchQuery("n")
        vm.setSearchQuery("ne")
        vm.setSearchQuery("nexy")

        dispatcher.scheduler.advanceTimeBy(249)
        assertEquals(initialCount, fakeWs.sentCommands.size)

        dispatcher.scheduler.advanceTimeBy(1)
        dispatcher.scheduler.runCurrent()
        assertEquals(initialCount + 1, fakeWs.sentCommands.size)
        assertEquals("nexy", fakeWs.sentCommands.last().data["query"])

        vm.viewModelScope.cancel()
    }

    @Test
    fun completionFilterReplacesTheCursorPage() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ScopedChatHistoryViewModel(Application(), fakeWs)
        vm.start(HistoryScope.Agent, "agent-1")
        advanceUntilIdle()

        vm.setCompletionFilter("completed")

        assertEquals("completed", fakeWs.sentCommands.last().data["completion"])
        assertEquals("agent", fakeWs.sentCommands.last().data["scopeType"])
        vm.viewModelScope.cancel()
    }

    private fun conversation(id: String) = Conversation(id = id, title = id, created_at = "1", updated_at = "1")

    private data class SentCommand(val command: String, val data: Map<String, Any>)

    private class FakeWsClient : WsClient {
        private val mutableEvents = MutableSharedFlow<WsEvent>(extraBufferCapacity = 16)
        override val events: SharedFlow<WsEvent> = mutableEvents
        val sentCommands = mutableListOf<SentCommand>()

        override fun send(command: String, data: Map<String, Any>) {
            sentCommands += SentCommand(command, data)
        }

        fun lastRequestId(): String = sentCommands.last().data["requestId"] as String

        suspend fun emitPage(
            requestId: String,
            conversations: List<Conversation>,
            totalCount: Int,
            nextCursor: String? = null,
            hasMore: Boolean = false,
        ) {
            mutableEvents.emit(
                WsEvent.ConversationPage(
                    requestId = requestId,
                    conversations = conversations,
                    totalCount = totalCount,
                    nextCursor = nextCursor,
                    hasMore = hasMore,
                ),
            )
        }
    }
}

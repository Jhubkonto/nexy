package io.nexy.android.ui.chat

import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.AttachmentMeta
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
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
    fun requestsHistoryOnInit() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)

        assertEquals(
            SentCommand("conversation:get-messages", mapOf("conversationId" to "conv-1")),
            fakeWs.sentCommands.single(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun loadsHistoryOnceForCurrentConversation() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage("m1", "user", "Hello", 1),
                    HistoryMessage("m2", "assistant", "Hi", 2),
                ),
            ),
        )
        advanceUntilIdle()

        assertEquals(
            listOf(
                ChatMessage(id = "m1", text = "Hello", isUser = true, isStreaming = false, rawText = "Hello", timestamp = 1),
                ChatMessage(id = "m2", text = "Hi", isUser = false, isStreaming = false, rawText = "Hi", timestamp = 2),
            ),
            vm.messages.value,
        )

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(HistoryMessage("m3", "user", "Ignored reload", 3)),
            ),
        )
        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "other-conv",
                messages = listOf(HistoryMessage("m4", "user", "Ignored other", 4)),
            ),
        )
        advanceUntilIdle()

        assertEquals(2, vm.messages.value.size)
        assertEquals("Hello", vm.messages.value.first().text)

        vm.viewModelScope.cancel()
    }

    @Test
    fun settlesInitialReconciliationWhenHistoryCompletesSynchronouslyWithRequest() = runTest {
        val fakeWs = FakeWsClient()
        fakeWs.onSend = { command, _ ->
            if (command == "conversation:get-messages") {
                fakeWs.emitNow(
                    WsEvent.ConversationHistoryComplete(
                        conversationId = "conv-1",
                        requestId = "",
                        historyVersion = null,
                        hasMore = false,
                        nextBeforeTimestamp = null,
                        nextBeforeId = null,
                    ),
                )
            }
        }

        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        assertFalse(vm.isReconcilingHistory.value)
        vm.viewModelScope.cancel()
    }

    @Test
    fun settlesEmptyChunkedHistoryFromStartWhenNoChunksFollow() = runTest {
        val fakeWs = FakeWsClient()
        fakeWs.onSend = { command, _ ->
            if (command == "conversation:get-messages") {
                fakeWs.emitNow(
                    WsEvent.ConversationHistoryStart(
                        conversationId = "conv-1",
                        requestId = "",
                        totalItems = 0,
                        chunkCount = 0,
                        historyVersion = "empty-v1",
                    ),
                )
            }
        }

        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        assertFalse(vm.isReconcilingHistory.value)
        vm.viewModelScope.cancel()
    }

    @Test
    fun settlesChunkedHistoryAfterAllChunksEvenIfCompletionEventIsLost() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationHistoryStart(
                conversationId = "conv-1",
                requestId = "",
                totalItems = 2,
                chunkCount = 2,
                historyVersion = "v1",
            ),
        )
        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(HistoryMessage("m2", "assistant", "New", 2)),
                paged = true,
                chunkIndex = 0,
                chunkCount = 2,
            ),
        )
        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(HistoryMessage("m1", "user", "Old", 1)),
                paged = true,
                chunkIndex = 1,
                chunkCount = 2,
            ),
        )
        advanceUntilIdle()

        assertFalse(vm.isReconcilingHistory.value)
        vm.viewModelScope.cancel()
    }

    @Test
    fun `progressively prepends streamed history chunks and settles on completion`() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        // runCurrent, not advanceUntilIdle: draining virtual time here would burn the whole
        // reconciliation window before the response this test is about even starts arriving.
        runCurrent()

        fakeWs.emit(
            WsEvent.ConversationHistoryStart(
                conversationId = "conv-1",
                requestId = "",
                totalItems = 3,
                chunkCount = 2,
                historyVersion = "v1",
            ),
        )
        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage("m2", "user", "Newest question", 2),
                    HistoryMessage("m3", "assistant", "Newest answer", 3),
                ),
                paged = true,
                chunkIndex = 0,
                chunkCount = 2,
            ),
        )
        // runCurrent (not advanceUntilIdle) so virtual time does not jump past the
        // reconciliation watchdog while a legitimate chunked response is still streaming.
        runCurrent()
        assertEquals(listOf("m2", "m3"), vm.messages.value.map { it.id })
        assertTrue(vm.isReconcilingHistory.value)

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(HistoryMessage("m1", "assistant", "Older", 1)),
                paged = true,
                chunkIndex = 1,
                chunkCount = 2,
            ),
        )
        fakeWs.emit(
            WsEvent.ConversationHistoryComplete(
                conversationId = "conv-1",
                requestId = "",
                historyVersion = "v1",
                hasMore = false,
                nextBeforeTimestamp = 1,
                nextBeforeId = "m1",
            ),
        )
        advanceUntilIdle()

        assertEquals(listOf("m1", "m2", "m3"), vm.messages.value.map { it.id })
        assertFalse(vm.isReconcilingHistory.value)
        vm.viewModelScope.cancel()
    }

    @Test
    fun prependsOlderPagedHistoryWithoutReplacingLatestMessages() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage("m3", "user", "Latest", 3),
                    HistoryMessage("m4", "assistant", "Current reply", 4),
                ),
                paged = true,
                hasMore = true,
                nextBeforeTimestamp = 3,
                nextBeforeId = "m3",
            ),
        )
        advanceUntilIdle()

        vm.loadOlderMessages()
        val olderRequest = fakeWs.sentCommands.last()
        assertEquals(
            mapOf(
                "conversationId" to "conv-1",
                "limit" to 60,
                "beforeTimestamp" to 3L,
                "beforeId" to "m3",
            ),
            olderRequest.data - setOf("requestId", "responseMode"),
        )
        assertEquals("conversation:get-messages", olderRequest.command)
        assertEquals("chunked-v2", olderRequest.data["responseMode"])
        assertTrue((olderRequest.data["requestId"] as String).isNotBlank())

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage("m1", "user", "Older", 1),
                    HistoryMessage("m2", "assistant", "Earlier reply", 2),
                ),
                paged = true,
                hasMore = false,
                nextBeforeTimestamp = 1,
                nextBeforeId = "m1",
            ),
        )
        advanceUntilIdle()

        assertEquals(listOf("m1", "m2", "m3", "m4"), vm.messages.value.map { it.id })
        vm.viewModelScope.cancel()
    }

    @Test
    fun tracksNormalizedChatTurnEventsForCurrentConversation() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(chatTurnEvent("turn_started", 1))
        fakeWs.emit(chatTurnEvent("assistant_text_delta", 2, """"chunk":"Hello""""))
        fakeWs.emit(chatTurnEvent("assistant_text_delta", 1, """"chunk":" stale"""", conversationId = "conv-2"))
        advanceUntilIdle()

        assertEquals("conv-1", vm.liveTurnState.value.conversationId)
        assertEquals("turn-1", vm.liveTurnState.value.turnId)
        assertEquals(ChatTurnStatus.Streaming, vm.liveTurnState.value.status)
        assertEquals("Hello", vm.liveTurnState.value.text)
        assertEquals(2L, vm.liveTurnState.value.lastSequence)

        vm.viewModelScope.cancel()
    }

    @Test
    fun restoresAttachmentNamesFromHistory() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage(
                        id = "m1",
                        role = "user",
                        content = "",
                        timestamp = 1,
                        attachments = listOf(AttachmentMeta(id = "m1", name = "photo.png", type = "image", thumbnailDataUrl = null)),
                    ),
                ),
            ),
        )
        advanceUntilIdle()

        assertEquals(
            ChatMessage(
                id = "m1",
                text = "",
                isUser = true,
                isStreaming = false,
                rawText = "",
                timestamp = 1,
                attachments = listOf(AttachmentMeta(id = "m1", name = "photo.png", type = "image", thumbnailDataUrl = null)),
            ),
            vm.messages.value.single(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun restoresPersistedThinkingBlocksFromHistoryReload() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage(
                        id = "m1",
                        role = "assistant",
                        content = "Done",
                        timestamp = 1,
                        thinkingBlocks = listOf(ThinkingBlock("codex-activity", "Ran tests", done = true)),
                    ),
                ),
            ),
        )
        advanceUntilIdle()

        assertEquals(
            listOf(ThinkingBlock("codex-activity", "Ran tests", done = true)),
            vm.messages.value.single().thinkingBlocks,
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun appendsStreamChunksAndFinalizesAssistantMessage() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.sendMessage("Hello")
        assertTrue(vm.isAwaitingResponse.value)

        fakeWs.emit(WsEvent.ChatStreamChunk("conv-1", "Hello"))
        fakeWs.emit(WsEvent.ChatStreamChunk("conv-1", " world"))
        advanceUntilIdle()

        assertFalse(vm.isAwaitingResponse.value)
        assertTrue(vm.isStreaming.value)
        assertEquals(
            ChatMessage(text = "Hello world", isUser = false, isStreaming = true),
            vm.messages.value.last(),
        )

        fakeWs.emit(WsEvent.ChatStreamEnd("conv-1"))
        advanceUntilIdle()

        assertFalse(vm.isAwaitingResponse.value)
        assertFalse(vm.isStreaming.value)
        assertEquals(
            ChatMessage(text = "Hello world", isUser = false, isStreaming = false),
            vm.messages.value.last(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun completedHistoryClearsAwaitingStateEvenWithoutStreamEnd() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.sendMessage("Hello")
        assertTrue(vm.isAwaitingResponse.value)

        vm.refreshMessages()
        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage("m1", "user", "Hello", 1),
                    HistoryMessage("m2", "assistant", "Done", 2),
                ),
            ),
        )
        advanceUntilIdle()

        assertFalse(vm.isAwaitingResponse.value)
        assertFalse(vm.isStreaming.value)
        assertTrue(vm.liveThinkingBlocks.value.isEmpty())
        assertEquals(
            listOf(
                ChatMessage(id = "m1", text = "Hello", isUser = true, isStreaming = false, rawText = "Hello", timestamp = 1),
                ChatMessage(id = "m2", text = "Done", isUser = false, isStreaming = false, rawText = "Done", timestamp = 2),
            ),
            vm.messages.value,
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun accumulatesLiveThinkingBlocksAndClearsThemOnStreamEnd() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(chatTurnEvent("turn_started", 1))
        fakeWs.emit(chatTurnEvent("thinking_delta", 2, """"blockId":"codex-activity","chunk":"Planning""""))
        fakeWs.emit(chatTurnEvent("thinking_delta", 3, """"blockId":"codex-activity","chunk":" steps""""))
        fakeWs.emit(chatTurnEvent("thinking_done", 4, """"blockId":"codex-activity""""))
        advanceUntilIdle()

        assertTrue(vm.isAwaitingResponse.value)
        assertEquals(
            listOf(ThinkingBlock("codex-activity", "Planning steps", done = true)),
            vm.liveThinkingBlocks.value,
        )

        fakeWs.emit(WsEvent.ChatStreamChunk("conv-1", "Done"))
        fakeWs.emit(WsEvent.ChatStreamEnd("conv-1"))
        advanceUntilIdle()

        assertTrue(vm.liveThinkingBlocks.value.isEmpty())

        vm.viewModelScope.cancel()
    }

    @Test
    fun ignoresLiveThinkingEventsForOtherConversations() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(chatTurnEvent("thinking_delta", 1, """"blockId":"codex-activity","chunk":"Ignored"""", conversationId = "other-conv"))
        fakeWs.emit(chatTurnEvent("thinking_done", 2, """"blockId":"codex-activity"""", conversationId = "other-conv"))
        advanceUntilIdle()

        assertTrue(vm.liveThinkingBlocks.value.isEmpty())
        assertFalse(vm.isAwaitingResponse.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun clearsLiveThinkingBlocksOnStopRefreshAndErrorActivity() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(chatTurnEvent("turn_started", 1))
        fakeWs.emit(chatTurnEvent("thinking_delta", 2, """"blockId":"codex-activity","chunk":"Working""""))
        advanceUntilIdle()
        assertTrue(vm.liveThinkingBlocks.value.isNotEmpty())

        vm.stopStream()
        assertTrue(vm.liveThinkingBlocks.value.isEmpty())

        fakeWs.emit(chatTurnEvent("turn_started", 3))
        fakeWs.emit(chatTurnEvent("thinking_delta", 4, """"blockId":"codex-activity","chunk":"Working""""))
        advanceUntilIdle()
        vm.refreshMessages()
        assertTrue(vm.liveThinkingBlocks.value.isEmpty())

        fakeWs.emit(chatTurnEvent("turn_started", 5))
        fakeWs.emit(chatTurnEvent("thinking_delta", 6, """"blockId":"codex-activity","chunk":"Working""""))
        fakeWs.emit(
            WsEvent.ChatActivity(
                conversationId = "conv-1",
                state = "error",
                label = "Failed",
                toolName = null,
                serverName = null,
            ),
        )
        advanceUntilIdle()
        assertTrue(vm.liveThinkingBlocks.value.isEmpty())

        vm.viewModelScope.cancel()
    }

    @Test
    fun ignoresStreamEventsForOtherConversations() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(WsEvent.ChatStreamChunk("other-conv", "Nope"))
        fakeWs.emit(WsEvent.ChatStreamEnd("other-conv"))
        advanceUntilIdle()

        assertFalse(vm.isStreaming.value)
        assertFalse(vm.isAwaitingResponse.value)
        assertTrue(vm.messages.value.isEmpty())

        vm.viewModelScope.cancel()
    }

    @Test
    fun activityEventsUpdateAndClearAwaitingStatus() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ChatActivity(
                conversationId = "conv-1",
                state = "tool",
                label = "Running browser_snapshot",
                toolName = "browser_snapshot",
                serverName = "Browser",
            ),
        )
        advanceUntilIdle()

        assertTrue(vm.isAwaitingResponse.value)
        assertEquals("Running browser_snapshot", vm.activityLabel.value)

        fakeWs.emit(
            WsEvent.ChatActivity(
                conversationId = "other-conv",
                state = "tool",
                label = "Ignored",
                toolName = null,
                serverName = null,
            ),
        )
        advanceUntilIdle()

        assertEquals("Running browser_snapshot", vm.activityLabel.value)

        fakeWs.emit(
            WsEvent.ChatActivity(
                conversationId = "conv-1",
                state = "complete",
                label = "Complete",
                toolName = null,
                serverName = null,
            ),
        )
        advanceUntilIdle()

        assertFalse(vm.isAwaitingResponse.value)
        assertEquals("Assistant is thinking", vm.activityLabel.value)
        assertEquals(
            SentCommand("conversation:get-messages", mapOf("conversationId" to "conv-1")),
            fakeWs.sentCommands.last(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun completeActivityReloadsPersistedAssistantWhenNoStreamChunksArrive() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(HistoryMessage("m1", "user", "Hello", 1)),
            ),
        )
        advanceUntilIdle()

        vm.sendMessage("Follow up")
        assertTrue(vm.isAwaitingResponse.value)

        fakeWs.emit(
            WsEvent.ChatActivity(
                conversationId = "conv-1",
                state = "complete",
                label = "Complete",
                toolName = null,
                serverName = null,
            ),
        )
        advanceUntilIdle()

        assertFalse(vm.isAwaitingResponse.value)
        assertFalse(vm.isStreaming.value)
        assertEquals(
            SentCommand("conversation:get-messages", mapOf("conversationId" to "conv-1")),
            fakeWs.sentCommands.last(),
        )

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage("m1", "user", "Hello", 1),
                    HistoryMessage("m2", "user", "Follow up", 2),
                    HistoryMessage("m3", "assistant", "Done from history", 3),
                ),
            ),
        )
        advanceUntilIdle()

        assertEquals(
            listOf(
                ChatMessage(id = "m1", text = "Hello", isUser = true, isStreaming = false, rawText = "Hello", timestamp = 1),
                ChatMessage(id = "m2", text = "Follow up", isUser = true, isStreaming = false, rawText = "Follow up", timestamp = 2),
                ChatMessage(id = "m3", text = "Done from history", isUser = false, isStreaming = false, rawText = "Done from history", timestamp = 3),
            ),
            vm.messages.value,
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun authoritativeHistoryPushUpdatesLoadedChatWhileAwaitingResponse() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(HistoryMessage("m1", "user", "Hello", 1)),
            ),
        )
        advanceUntilIdle()

        vm.sendMessage("Follow up")
        assertTrue(vm.isAwaitingResponse.value)

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage("m1", "user", "Hello", 1),
                    HistoryMessage("m2", "user", "Follow up", 2),
                    HistoryMessage("m3", "assistant", "Persisted answer", 3),
                ),
            ),
        )
        advanceUntilIdle()

        assertFalse(vm.isAwaitingResponse.value)
        assertFalse(vm.isStreaming.value)
        assertEquals("Persisted answer", vm.messages.value.last().text)

        vm.viewModelScope.cancel()
    }

    @Test
    fun teamActivityEventsRenderAsLiveToolActivity() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ChatTeamActivity(
                conversationId = "conv-1",
                stepId = "step-1",
                agentName = "Builder",
                agentIcon = "B",
                task = "Review the plan",
                status = "delegating",
                result = null,
                durationMs = null,
            ),
        )
        advanceUntilIdle()

        assertEquals(1, vm.messages.value.size)
        assertTrue(vm.messages.value.single().isToolCall)
        assertTrue(vm.messages.value.single().isStreaming)
        assertEquals("B Builder", vm.messages.value.single().toolName)

        fakeWs.emit(
            WsEvent.ChatTeamActivity(
                conversationId = "conv-1",
                stepId = "step-1",
                agentName = "Builder",
                agentIcon = "B",
                task = "Review the plan",
                status = "done",
                result = "Looks good.",
                durationMs = 100,
            ),
        )
        advanceUntilIdle()

        assertEquals(1, vm.messages.value.size)
        assertFalse(vm.messages.value.single().isStreaming)
        assertEquals("Looks good.", vm.messages.value.single().toolResult)

        vm.viewModelScope.cancel()
    }

    @Test
    fun activeHistoryPollingRecoversWhenStreamEventsAreMissed() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(HistoryMessage("m1", "user", "Hello", 1)),
            ),
        )
        advanceUntilIdle()

        val commandsBeforeSend = fakeWs.sentCommands.size
        vm.sendMessage("Follow up")

        advanceTimeBy(2_500)
        runCurrent()

        assertEquals(
            SentCommand("conversation:get-messages", mapOf("conversationId" to "conv-1")),
            fakeWs.sentCommands.last(),
        )
        assertEquals(commandsBeforeSend + 2, fakeWs.sentCommands.size)

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage("m1", "user", "Hello", 1),
                    HistoryMessage("m2", "user", "Follow up", 2),
                    HistoryMessage("m3", "assistant", "Recovered answer", 3),
                ),
            ),
        )
        advanceUntilIdle()

        assertFalse(vm.isAwaitingResponse.value)
        assertFalse(vm.isStreaming.value)
        assertEquals("Recovered answer", vm.messages.value.last().text)

        vm.viewModelScope.cancel()
    }

    @Test
    fun sendMessageAddsOptimisticUserMessageAndSendsCommand() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.sendMessage("Hello")

        assertEquals(
            ChatMessage(text = "Hello", isUser = true, isStreaming = false),
            vm.messages.value.single(),
        )
        assertTrue(vm.isAwaitingResponse.value)
        assertEquals(
            SentCommand("chat:send-message", mapOf("conversationId" to "conv-1", "content" to "Hello")),
            fakeWs.sentCommands.last(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun immediateSendCarriesUnconfirmedModeOverrides() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.setCliModeOverride("workspace-write")
        vm.setFullAutoApproveOverride(true)
        vm.sendMessage("Apply the fix")

        assertEquals(
            SentCommand(
                "chat:send-message",
                mapOf(
                    "conversationId" to "conv-1",
                    "content" to "Apply the fix",
                    "cliModeOverride" to "workspace-write",
                    "fullAutoApproveOverride" to true,
                ),
            ),
            fakeWs.sentCommands.last(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun sendMessageIncludesImageAttachments() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.addAttachment("photo.png", "image/png", "data:image/png;base64,abc123", null)
        vm.sendMessage("")

        assertTrue(vm.attachments.value.isEmpty())
        val actualMsg = vm.messages.value.single()
        val attId = actualMsg.attachments.firstOrNull()?.id.orEmpty()
        assertEquals(
            ChatMessage(
                text = "",
                isUser = true,
                isStreaming = false,
                attachments = listOf(
                    AttachmentMeta(
                        id = attId,
                        name = "photo.png",
                        type = "image",
                        thumbnailDataUrl = "data:image/png;base64,abc123",
                    ),
                ),
            ),
            actualMsg,
        )

        val sent = fakeWs.sentCommands.last()
        assertEquals("chat:send-message", sent.command)
        assertEquals("conv-1", sent.data["conversationId"])
        assertEquals("", sent.data["content"])
        @Suppress("UNCHECKED_CAST")
        val images = sent.data["images"] as List<Map<String, String>>
        assertEquals(1, images.size)
        assertEquals("photo.png", images[0]["name"])
        assertEquals("data:image/png;base64,abc123", images[0]["dataUrl"])

        vm.viewModelScope.cancel()
    }

    @Test
    fun duplicateImagePayloadIsOnlyAttachedOnce() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        val dataUrl = "data:image/png;base64,abc123"
        vm.addAttachment("photo.png", "image/png", dataUrl, null)
        vm.addAttachment("photo.png", "image/png", dataUrl, null)

        assertEquals(1, vm.attachments.value.size)

        vm.sendMessage("Review this")

        assertEquals(1, vm.messages.value.single().attachments.size)
        @Suppress("UNCHECKED_CAST")
        val images = fakeWs.sentCommands.last().data["images"] as List<Map<String, String>>
        assertEquals(1, images.size)
        assertEquals(dataUrl, images.single()["dataUrl"])

        vm.viewModelScope.cancel()
    }

    @Test
    fun sendMessageRetainsBinaryFilesAsFirstClassAttachments() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.addAttachment("brief.pdf", "application/pdf", "data:application/pdf;base64,JVBERg==", null)
        vm.sendMessage("Summarize this")

        val optimistic = vm.messages.value.single()
        assertEquals("Summarize this", optimistic.text)
        assertEquals("file", optimistic.attachments.single().type)
        assertEquals("brief.pdf", optimistic.attachments.single().name)

        @Suppress("UNCHECKED_CAST")
        val sent = fakeWs.sentCommands.last().data["attachments"] as List<Map<String, Any>>
        assertEquals("application/pdf", sent.single()["mimeType"])
        assertEquals("data:application/pdf;base64,JVBERg==", sent.single()["dataUrl"])
        assertEquals(4L, sent.single()["size"])

        vm.viewModelScope.cancel()
    }

    @Test
    fun sendMessageIncludesDraftAgentAndProjectIds() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("draft-conv", fakeWs, agentId = "agent-1", projectId = "project-1")
        advanceUntilIdle()

        vm.sendMessage("Use the browser")

        assertEquals(
            SentCommand(
                "chat:send-message",
                mapOf(
                    "conversationId" to "draft-conv",
                    "content" to "Use the browser",
                    "agentId" to "agent-1",
                    "projectId" to "project-1",
                ),
            ),
            fakeWs.sentCommands.last(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun setModelPersistsSelectionAndSendMessageIncludesModel() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.setModel("gpt-5.5")
        vm.sendMessage("Hello")

        assertEquals("gpt-5.5", vm.selectedModel.value)
        assertEquals(
            SentCommand(
                "conversation:set-model",
                mapOf(
                    "conversationId" to "conv-1",
                    "model" to "gpt-5.5",
                    "cliBackend" to "",
                    "hermesProfile" to "",
                ),
            ),
            fakeWs.sentCommands[fakeWs.sentCommands.size - 2],
        )
        assertEquals(
            SentCommand(
                "chat:send-message",
                mapOf("conversationId" to "conv-1", "content" to "Hello", "model" to "gpt-5.5"),
            ),
            fakeWs.sentCommands.last(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun draftHermesProfileIsIncludedWithFirstMessage() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("draft-conv", fakeWs)
        advanceUntilIdle()

        vm.setHermesProfile("localllm-iso")
        vm.sendMessage("Hello")

        assertEquals(
            "localllm-iso",
            fakeWs.sentCommands.last().data["hermesProfile"],
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun refreshMessagesRequestsHistoryAgain() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.refreshMessages()

        assertTrue(vm.isRefreshing.value)
        assertEquals(
            SentCommand("conversation:get-messages", mapOf("conversationId" to "conv-1")),
            fakeWs.sentCommands.last(),
        )
        assertEquals(2, fakeWs.sentCommands.count { it.command == "conversation:get-messages" })

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(HistoryMessage("m1", "assistant", "Hi", 1)),
            ),
        )
        advanceUntilIdle()

        assertFalse(vm.isRefreshing.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun mapsPersistedToolCallHistoryMessages() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage(
                        "tool-1",
                        "tool-call",
                        """{"__type":"tool-call","toolName":"browser_type","serverName":"claude-cli","toolArgs":{"target":"search-box","text":"poodle"},"toolResult":"Search submitted","toolSuccess":true}""",
                        1,
                    ),
                ),
            ),
        )
        advanceUntilIdle()

        val msg = vm.messages.value.single()
        assertTrue(msg.isToolCall)
        assertEquals("browser_type", msg.toolName)
        assertEquals("claude-cli", msg.serverName)
        assertEquals("Search submitted", msg.toolResult)
        assertTrue(msg.toolSuccess)

        vm.viewModelScope.cancel()
    }

    @Test
    fun stopStreamSendsStopCommandAndClearsStreamingState() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.sendMessage("Hello")
        assertTrue(vm.isAwaitingResponse.value)

        vm.stopStream()

        assertFalse(vm.isAwaitingResponse.value)
        assertFalse(vm.isStreaming.value)
        assertEquals(
            SentCommand("agent:stop", mapOf("conversationId" to "conv-1")),
            fakeWs.sentCommands.last(),
        )

        fakeWs.emit(WsEvent.ChatStreamChunk("conv-1", "Working"))
        advanceUntilIdle()
        assertTrue(vm.isStreaming.value)

        vm.stopStream()

        assertFalse(vm.isAwaitingResponse.value)
        assertFalse(vm.isStreaming.value)
        assertEquals(
            SentCommand("agent:stop", mapOf("conversationId" to "conv-1")),
            fakeWs.sentCommands.last(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun reEnteringActiveBackgroundConversationRestoresLiveState() = runTest {
        // Simulate: user was on another screen while conv-1 was streaming. They navigate back.
        // WsRepository already holds a snapshot from the ongoing turn.
        val snapshot = WsRepository.ActiveChatSnapshot(
            activityLabel = "Running browser_snapshot",
            liveThinkingBlocks = listOf(ThinkingBlock("block-1", "Planned steps", done = true)),
            completedToolCalls = listOf(
                WsRepository.LiveToolCall(
                    toolName = "browser_snapshot",
                    serverName = "Browser",
                    args = null,
                    result = "Screenshot taken",
                    success = true,
                ),
            ),
            generationStartedAt = 1_000L,
        )
        WsRepository.seedActiveConversationForTest("conv-1", snapshot)

        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        // History arrives: only user message, no assistant response yet
        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(HistoryMessage("m1", "user", "Hello", 1)),
            ),
        )
        advanceUntilIdle()

        // VM should surface the active state from the snapshot
        assertTrue(vm.isAwaitingResponse.value)
        assertEquals("Running browser_snapshot", vm.activityLabel.value)
        assertEquals(
            listOf(ThinkingBlock("block-1", "Planned steps", done = true)),
            vm.liveThinkingBlocks.value,
        )

        // Tool calls from the snapshot should be appended to messages
        val msgs = vm.messages.value
        assertEquals(2, msgs.size)
        assertEquals("m1", msgs[0].id)
        assertTrue(msgs[1].isToolCall)
        assertEquals("browser_snapshot", msgs[1].toolName)
        assertEquals("Screenshot taken", msgs[1].toolResult)

        // Cleanup singleton state so other tests are not affected
        WsRepository.clearConversationActiveState("conv-1")

        vm.viewModelScope.cancel()
    }

    @Test
    fun stripsInjectedContextFromUserFacingHistoryMessages() = runTest {
        assertEquals(
            "Hello",
            stripInjectedContextBlocks("[Project Context]\nsecret\n[/Project Context]\nHello"),
        )
        assertEquals(
            "Hello",
            stripInjectedContextBlocks("""{"projectId":"p1","sourceContext":{"useProjectWiki":true}}""" + "\nHello"),
        )
        val msg = HistoryMessage(
            id = "team-1",
            role = "team-activity",
            content = """{"steps":[{"agentName":"Builder","task":"Review the plan"}]}""",
            timestamp = 1,
        ).toChatMessage()
        assertTrue(msg.isToolCall)
        assertEquals("🤝 1 step", msg.toolName)
        assertTrue(msg.toolResult.orEmpty().contains("Builder"))
    }

    private data class SentCommand(val command: String, val data: Map<String, Any>)

    private fun chatTurnEvent(
        type: String,
        sequence: Long,
        payload: String = "",
        conversationId: String = "conv-1",
        turnId: String = "turn-1",
    ): WsEvent.ChatTurnEvent {
        val payloadJson = buildString {
            append("""{"type":"$type","conversationId":"$conversationId","turnId":"$turnId","sequence":$sequence,"timestamp":${1000 + sequence}""")
            if (payload.isNotBlank()) append(",").append(payload)
            append("}")
        }
        return WsEvent.ChatTurnEvent(
            conversationId = conversationId,
            turnId = turnId,
            sequence = sequence,
            type = type,
            timestamp = 1000 + sequence,
            payloadJson = payloadJson,
        )
    }

    @Test
    fun `settles reconciliation when the desktop never answers the history request`() = runTest {
        // The chat app-bar spinner is driven by isReconcilingHistory. A request that is never
        // answered - dropped by a half-open socket, or a desktop that never replies - used to
        // leave it true for the entire life of the screen, so the indicator span forever.
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        runCurrent()

        assertTrue(vm.isReconcilingHistory.value)

        advanceTimeBy(HISTORY_RECONCILE_TIMEOUT_MS + 1)
        runCurrent()

        assertFalse(vm.isReconcilingHistory.value)
        assertFalse(vm.isRefreshing.value)
        assertFalse(vm.isInitialHistoryLoading.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun `streaming history chunks keep the reconciliation watchdog armed`() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        runCurrent()

        fakeWs.emit(
            WsEvent.ConversationHistoryStart(
                conversationId = "conv-1",
                requestId = "",
                totalItems = 3,
                chunkCount = 3,
                historyVersion = "v1",
            ),
        )
        runCurrent()

        // A slow but progressing response must not be cut short: each chunk re-arms the watchdog.
        repeat(2) { index ->
            advanceTimeBy(HISTORY_RECONCILE_TIMEOUT_MS - 1_000)
            runCurrent()
            assertTrue(vm.isReconcilingHistory.value)
            fakeWs.emit(
                WsEvent.ConversationMessages(
                    conversationId = "conv-1",
                    messages = listOf(HistoryMessage("m$index", "user", "chunk $index", index.toLong() + 1)),
                    paged = true,
                    chunkIndex = index,
                    chunkCount = 3,
                ),
            )
            runCurrent()
            assertTrue(vm.isReconcilingHistory.value)
        }

        // ...but silence after the last chunk still settles the indicator.
        advanceTimeBy(HISTORY_RECONCILE_TIMEOUT_MS + 1)
        runCurrent()
        assertFalse(vm.isReconcilingHistory.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun `manual refresh re-arms and then bounds the reconciliation indicator`() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        runCurrent()

        fakeWs.emit(
            WsEvent.ConversationHistoryComplete(
                conversationId = "conv-1",
                requestId = "",
                historyVersion = "v1",
                hasMore = false,
                nextBeforeTimestamp = null,
                nextBeforeId = null,
            ),
        )
        runCurrent()
        assertFalse(vm.isReconcilingHistory.value)

        // A watchdog that fired (or was cancelled) once must not leave later refreshes unbounded.
        vm.refreshMessages()
        runCurrent()
        assertTrue(vm.isReconcilingHistory.value)

        advanceTimeBy(HISTORY_RECONCILE_TIMEOUT_MS + 1)
        runCurrent()
        assertFalse(vm.isReconcilingHistory.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun `a completed response cancels the watchdog instead of leaving it pending`() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        runCurrent()

        fakeWs.emit(
            WsEvent.ConversationHistoryComplete(
                conversationId = "conv-1",
                requestId = "",
                historyVersion = "v1",
                hasMore = false,
                nextBeforeTimestamp = null,
                nextBeforeId = null,
            ),
        )
        runCurrent()

        // Nothing re-sets the flag when the (already cancelled) watchdog deadline passes.
        advanceTimeBy(HISTORY_RECONCILE_TIMEOUT_MS * 3)
        runCurrent()
        assertFalse(vm.isReconcilingHistory.value)

        vm.viewModelScope.cancel()
    }

    private class FakeWsClient : WsClient {
        private val mutableEvents = MutableSharedFlow<WsEvent>(extraBufferCapacity = 16)
        override val events: SharedFlow<WsEvent> = mutableEvents
        val sentCommands = mutableListOf<SentCommand>()
        var onSend: ((String, Map<String, Any>) -> Unit)? = null

        override fun send(command: String, data: Map<String, Any>) {
            sentCommands += SentCommand(command, data)
            onSend?.invoke(command, data)
        }

        fun emitNow(event: WsEvent) {
            mutableEvents.tryEmit(event)
        }

        suspend fun emit(event: WsEvent) {
            mutableEvents.emit(event)
        }
    }
}

package io.nexy.android.data.local

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.parseWsEvent
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.ConversationDebrief
import io.nexy.android.data.model.ConversationRating
import io.nexy.android.data.model.ConversationRatingListItem
import io.nexy.android.data.model.ConversationRatingStats
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.model.ScheduledRun
import io.nexy.android.data.model.ScheduledTask
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.chat.ChatRenderItem
import io.nexy.android.ui.chat.buildChatRenderItems
import io.nexy.android.ui.chat.toChatMessage
import java.util.UUID
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TextSegmentPersistenceTest {
    @Test
    fun websocketHistoryRetainsSegmentOrderThroughRoomAndRendering() = runBlocking {
        val conversationId = "text-segment-test-${UUID.randomUUID()}"
        val context = ApplicationProvider.getApplicationContext<Context>()
        NexyDatabase.get(context).conversations().upsert(
            ConversationEntity(
                id = conversationId,
                title = "Text segment persistence",
                createdAt = 1_000L,
                updatedAt = 1_000L,
            ),
        )

        val events = MutableSharedFlow<WsEvent>(replay = 1, extraBufferCapacity = 1)
        parseWsEvent(
            text = """
                {
                  "event": "conversation:messages",
                  "data": {
                    "conversationId": "$conversationId",
                    "requestId": "request-1",
                    "messages": [{
                      "id": "assistant-1",
                      "role": "assistant",
                      "content": "I'll investigate.The complete answer.",
                      "timestamp": 300,
                      "text_segments": "[{\"blockId\":\"text-0\",\"content\":\"I'll investigate.\",\"done\":true,\"firstSeenAt\":100},{\"blockId\":\"text-1\",\"content\":\"The complete answer.\",\"done\":true,\"firstSeenAt\":250}]"
                    }]
                  }
                }
            """.trimIndent(),
            scope = this,
            events = events,
            serverVersion = MutableStateFlow(null),
            conversations = MutableStateFlow<List<Conversation>>(emptyList()),
            projects = MutableStateFlow<List<Project>>(emptyList()),
            agents = MutableStateFlow<List<Agent>>(emptyList()),
            agentFullConfig = MutableStateFlow<AgentFullConfig?>(null),
            models = MutableStateFlow<List<ModelOption>>(emptyList()),
            modelSource = MutableStateFlow<ModelListSource?>(null),
            androidUpdateManifest = MutableStateFlow<AndroidUpdateManifest?>(null),
            providers = MutableStateFlow<List<ProviderInfo>>(emptyList()),
            mcpServers = MutableStateFlow<List<McpServerInfo>>(emptyList()),
            skills = MutableStateFlow<List<SkillConfig>>(emptyList()),
            skillAgentUsage = MutableStateFlow(emptyMap()),
            artifacts = MutableStateFlow<List<ArtifactSummary>>(emptyList()),
            wikiEntries = MutableStateFlow<List<WikiEntry>>(emptyList()),
            promptEntries = MutableStateFlow<List<PromptEntry>>(emptyList()),
            cliStatus = MutableStateFlow<Map<String, CliInstallInfo>>(emptyMap()),
            scheduledTasks = MutableStateFlow<List<ScheduledTask>>(emptyList()),
            scheduledRuns = MutableStateFlow<Map<String, List<ScheduledRun>>>(emptyMap()),
            currentDebrief = MutableStateFlow<ConversationDebrief?>(null),
            completedConversationIds = MutableStateFlow(emptySet()),
            currentRating = MutableStateFlow<ConversationRating?>(null),
            ratingsList = MutableStateFlow<List<ConversationRatingListItem>>(emptyList()),
            ratingStats = MutableStateFlow<ConversationRatingStats?>(null),
        )
        yield()

        val wireEvent = events.replayCache.single() as WsEvent.ConversationMessages
        val repository = LocalDataRepository.get(context)
        repository.applyRemoteEvent(wireEvent)

        val cached = repository.list(conversationId).single()
        assertEquals(listOf(100L, 250L), cached.textSegments.map { it.firstSeenAt })

        val rendered = buildChatRenderItems(
            messages = listOf(cached.toChatMessage()),
            liveThinkingBlocks = emptyList(),
            isAwaitingResponse = false,
            isStreaming = false,
            activity = null,
            generationStartedAt = null,
        )
        assertEquals(
            "The complete answer.",
            (rendered.last() as ChatRenderItem.AssistantMessage).displayText,
        )
    }
}

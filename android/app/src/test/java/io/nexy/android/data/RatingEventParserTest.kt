package io.nexy.android.data

import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.ConversationRating
import io.nexy.android.data.model.ConversationRatingListItem
import io.nexy.android.data.model.ConversationRatingStats
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RatingEventParserTest {

    @Test
    fun parsesRatingUpdatedAndPatchesTheConversationsList() = runTest {
        val conversations = MutableStateFlow(
            listOf(Conversation(id = "conv-1", title = "Chat", created_at = "0", updated_at = "0", rating = null)),
        )
        val currentRating = MutableStateFlow<ConversationRating?>(null)

        val event = parseEvent(
            """
            {
              "event": "rating:updated",
              "data": {
                "conversationId": "conv-1",
                "rating": {
                  "id": "r1",
                  "conversationId": "conv-1",
                  "rating": 5,
                  "note": "Nailed it",
                  "snapshot": {
                    "agentId": "agent-1",
                    "agentName": "Research Agent",
                    "model": "claude-sonnet-4-6",
                    "backend": null,
                    "projectId": "proj-1",
                    "projectName": "Nexy",
                    "workflowMode": "single-agent",
                    "toolNames": ["search_project_wiki"],
                    "serverNames": ["Project Wiki"],
                    "skillIds": ["skill-1"],
                    "skillNames": ["Deep Research"],
                    "keywords": ["login", "flaky"]
                  },
                  "createdAt": 1000,
                  "updatedAt": 2000
                }
              }
            }
            """.trimIndent(),
            conversations = conversations,
            currentRating = currentRating,
        ) as WsEvent.RatingUpdated

        assertEquals("conv-1", event.conversationId)
        assertEquals(5, event.rating?.rating)
        assertEquals("Nailed it", event.rating?.note)
        assertEquals("Research Agent", event.rating?.snapshot?.agentName)
        assertEquals(listOf("search_project_wiki"), event.rating?.snapshot?.toolNames)
        assertEquals(5, currentRating.value?.rating)
        assertEquals(5, conversations.value.first { it.id == "conv-1" }.rating)
    }

    @Test
    fun parsesRatingUpdatedWithNullRatingAsAClear() = runTest {
        val conversations = MutableStateFlow(
            listOf(Conversation(id = "conv-1", title = "Chat", created_at = "0", updated_at = "0", rating = 5)),
        )

        val event = parseEvent(
            """{"event":"rating:updated","data":{"conversationId":"conv-1","rating":null}}""",
            conversations = conversations,
        ) as WsEvent.RatingUpdated

        assertNull(event.rating)
        assertNull(conversations.value.first { it.id == "conv-1" }.rating)
    }

    @Test
    fun parsesRatingListLoaded() = runTest {
        val ratingsList = MutableStateFlow<List<ConversationRatingListItem>>(emptyList())

        val event = parseEvent(
            """
            {
              "event": "rating:list-loaded",
              "data": {
                "ratings": [
                  {
                    "id": "r1", "conversationId": "conv-1", "conversationTitle": "Chat",
                    "projectId": null, "projectName": null, "rating": 4, "note": null,
                    "agentName": null, "model": null, "toolNames": [], "skillNames": [],
                    "createdAt": 1, "updatedAt": 1
                  }
                ]
              }
            }
            """.trimIndent(),
            ratingsList = ratingsList,
        ) as WsEvent.RatingListLoaded

        assertEquals(1, event.ratings.size)
        assertEquals("conv-1", event.ratings.first().conversationId)
        assertEquals(1, ratingsList.value.size)
    }

    @Test
    fun parsesRatingStatsLoaded() = runTest {
        val ratingStats = MutableStateFlow<ConversationRatingStats?>(null)

        val event = parseEvent(
            """
            {
              "event": "rating:stats-loaded",
              "data": {
                "stats": {
                  "averageByAgent": [{"label": "Research Agent", "average": 4.5, "count": 2}],
                  "averageByModel": [],
                  "averageBySkill": [],
                  "averageByServer": [],
                  "averageByProject": [],
                  "trend": [{"date": "2024-01-01", "average": 4.5, "count": 2}]
                }
              }
            }
            """.trimIndent(),
            ratingStats = ratingStats,
        ) as WsEvent.RatingStatsLoaded

        assertEquals(1, event.stats.averageByAgent.size)
        assertEquals(4.5, event.stats.averageByAgent.first().average, 0.001)
        assertEquals(1, event.stats.trend.size)
        assertEquals(4.5, ratingStats.value?.averageByAgent?.first()?.average ?: 0.0, 0.001)
    }

    @Test
    fun parsesRatingError() = runTest {
        val event = parseEvent(
            """{"event":"rating:error","data":{"message":"rating must be an integer between 1 and 5"}}""",
        )
        assertTrue((event as WsEvent.RatingError).message.contains("integer"))
    }

    @Test
    fun parsesWorkHistoryResponses() = runTest {
        val success = parseEvent("""{"event":"work-history:result","data":{"requestId":"a","operation":"work-history:preview","result":[{"id":"chat"}]}}""") as WsEvent.WorkHistoryResult
        assertEquals("a", success.requestId)
        assertEquals("work-history:preview", success.operation)
        assertEquals("chat", (success.result as org.json.JSONArray).getJSONObject(0).getString("id"))
        val failure = parseEvent("""{"event":"work-history:result","data":{"requestId":"b","operation":"work-history:start","error":"Invalid date range"}}""") as WsEvent.WorkHistoryResult
        assertEquals("Invalid date range", failure.error)
        assertEquals(null, failure.result)
    }

    private suspend fun TestScope.parseEvent(
        raw: String,
        conversations: MutableStateFlow<List<Conversation>> = MutableStateFlow(emptyList()),
        currentRating: MutableStateFlow<ConversationRating?> = MutableStateFlow(null),
        ratingsList: MutableStateFlow<List<ConversationRatingListItem>> = MutableStateFlow(emptyList()),
        ratingStats: MutableStateFlow<ConversationRatingStats?> = MutableStateFlow(null),
    ): WsEvent {
        val events = MutableSharedFlow<WsEvent>(replay = 1, extraBufferCapacity = 8)
        parseWsEvent(
            text = raw,
            scope = this,
            events = events,
            serverVersion = MutableStateFlow(null),
            conversations = conversations,
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
            scheduledTasks = MutableStateFlow(emptyList()),
            scheduledRuns = MutableStateFlow(emptyMap()),
            currentDebrief = MutableStateFlow(null),
            completedConversationIds = MutableStateFlow(emptySet()),
            currentRating = currentRating,
            ratingsList = ratingsList,
            ratingStats = ratingStats,
        )
        testScheduler.advanceUntilIdle()
        return events.replayCache.lastOrNull() ?: throw AssertionError("No websocket event parsed from: $raw")
    }
}

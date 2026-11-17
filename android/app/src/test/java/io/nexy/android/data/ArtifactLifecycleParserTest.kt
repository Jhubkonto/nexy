package io.nexy.android.data

import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.Conversation
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
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ArtifactLifecycleParserTest {
    @Test
    fun parsesModelBackendForCliConversationModeRouting() = runTest {
        val event = parseEvent(
            """
            {
              "event": "model:list",
              "data": {
                "models": [
                  {
                    "id": "claude-sonnet-4-6",
                    "label": "Claude Sonnet 4.6",
                    "vendor": "Claude CLI",
                    "isCliSourced": true,
                    "backend": "claude-cli"
                  }
                ],
                "source": { "type": "provider", "label": "Claude CLI" }
              }
            }
            """.trimIndent()
        ) as WsEvent.ModelList

        assertEquals("claude-cli", event.models.single().backend)
        assertTrue(event.models.single().isCliSourced)
    }

    @Test
    fun preservesDuplicateModelsAcrossSourceGroups() = runTest {
        val event = parseEvent(
            """{"event":"model:list","data":{"models":[],"groups":[
              {"sourceKey":"openai","sourceLabel":"OpenAI","sourceType":"provider","models":[{"id":"gpt-5","label":"GPT-5"}]},
              {"sourceKey":"openrouter","sourceLabel":"OpenRouter","sourceType":"provider","models":[{"id":"gpt-5","label":"GPT-5"}]},
              {"sourceKey":"codex-cli","sourceLabel":"Codex CLI","sourceType":"cli","models":[{"id":"gpt-5","label":"GPT-5"}]}
            ]}}"""
        ) as WsEvent.ModelList
        assertEquals(listOf("openai:gpt-5", "openrouter:gpt-5", "gpt-5"), event.models.map { it.id })
        assertEquals("codex-cli", event.models.last().backend)
    }

    @Test
    fun parsesArtifactDetailWithStorageRootAndVersionFiles() = runTest {
        val event = parseEvent(
            """
            {
              "event": "artifact:detail",
              "data": {
                "artifactId": "artifact-1",
                "artifact": {
                  "id": "artifact-1",
                  "projectId": "project-1",
                  "title": "Release notes",
                  "kind": "document",
                  "description": "Public release notes",
                  "storageRoot": "C:/repo/.nexy/artifacts/artifact-1",
                  "status": "ready",
                  "currentVersionId": "version-2",
                  "createdAt": 100,
                  "updatedAt": 200,
                  "currentVersion": {
                    "id": "version-2",
                    "artifactId": "artifact-1",
                    "versionNumber": 2,
                    "title": "Release notes v2",
                    "notes": "Updated",
                    "createdAt": 180,
                    "files": [
                      { "id": "file-1", "relativePath": "release.md", "mediaType": "text/markdown", "role": "primary" }
                    ]
                  }
                }
              }
            }
            """.trimIndent()
        ) as WsEvent.ArtifactDetail

        assertEquals("artifact-1", event.artifactId)
        val artifact = event.artifact!!
        assertEquals("C:/repo/.nexy/artifacts/artifact-1", artifact.storageRoot)
        assertEquals("version-2", artifact.currentVersion?.id)
        assertEquals("release.md", artifact.currentVersion?.files?.single()?.relativePath)
    }

    @Test
    fun preservesRequestedIdWhenArtifactDetailIsMissing() = runTest {
        val event = parseEvent(
            """{"event":"artifact:detail","data":{"artifactId":"deleted-quiz","artifact":null}}"""
        ) as WsEvent.ArtifactDetail

        assertEquals("deleted-quiz", event.artifactId)
        assertEquals(null, event.artifact)
    }

    @Test
    fun parsesArtifactVersionsDeleteAndExportEvents() = runTest {
        val versions = parseEvent(
            """
            {
              "event": "artifact:versions",
              "data": {
                "artifactId": "artifact-1",
                "versions": [
                  {
                    "id": "version-2",
                    "artifactId": "artifact-1",
                    "versionNumber": 2,
                    "title": "Second",
                    "notes": null,
                    "createdAt": 200,
                    "files": [
                      { "id": "file-2", "relativePath": "second.md", "mediaType": "text/markdown", "role": "primary" }
                    ]
                  }
                ]
              }
            }
            """.trimIndent()
        ) as WsEvent.ArtifactVersions
        assertEquals("artifact-1", versions.artifactId)
        assertEquals(2, versions.versions.single().versionNumber)

        val deleted = parseEvent("""{"event":"artifact:deleted","data":{"id":"artifact-1","deleted":true}}""") as WsEvent.ArtifactDeleted
        assertEquals("artifact-1", deleted.id)
        assertTrue(deleted.deleted)

        val export = parseEvent(
            """
            {
              "event": "artifact:export-pack",
              "data": {
                "versionId": "version-2",
                "files": [{ "relativePath": "second.md", "mediaType": "text/markdown", "contentBase64": "SGVsbG8=" }]
              }
            }
            """.trimIndent()
        ) as WsEvent.ArtifactExportPack
        assertEquals("second.md", export.files.single().relativePath)
    }

    @Test
    fun parsesPromptVersionsAndErrorEvents() = runTest {
        val versions = parseEvent(
            """
            {
              "event": "prompt:versions",
              "data": {
                "promptId": "prompt-1",
                "versions": [
                  {
                    "id": "version-2",
                    "promptId": "prompt-1",
                    "version": 2,
                    "title": "Updated",
                    "body": "Line one\nLine two",
                    "description": "",
                    "category": "Coding",
                    "tags": ["review"],
                    "variables": ["repository"],
                    "scope": "global",
                    "projectId": null,
                    "source": "manual-edit",
                    "createdAt": 200,
                    "diff": {
                      "titleChanged": true,
                      "descriptionChanged": false,
                      "categoryChanged": false,
                      "tagsChanged": true,
                      "scopeChanged": false,
                      "addedLines": ["Line two"],
                      "removedLines": []
                    }
                  }
                ]
              }
            }
            """.trimIndent()
        ) as WsEvent.PromptVersions
        assertEquals("prompt-1", versions.promptId)
        assertEquals(2, versions.versions.single().version)
        assertTrue(versions.versions.single().diff.titleChanged)
        assertEquals(listOf("Line two"), versions.versions.single().diff.addedLines)

        val error = parseEvent("""{"event":"prompt:error","data":{"message":"Prompt version not found"}}""") as WsEvent.PromptError
        assertEquals("Prompt version not found", error.message)
    }

    private suspend fun TestScope.parseEvent(raw: String): WsEvent {
        val events = MutableSharedFlow<WsEvent>(replay = 1, extraBufferCapacity = 8)
        parseWsEvent(
            text = raw,
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
            scheduledTasks = MutableStateFlow(emptyList()),
            scheduledRuns = MutableStateFlow(emptyMap()),
            currentDebrief = MutableStateFlow(null),
            completedConversationIds = MutableStateFlow(emptySet()),
            currentRating = MutableStateFlow(null),
            ratingsList = MutableStateFlow(emptyList()),
            ratingStats = MutableStateFlow(null),
        )
        testScheduler.advanceUntilIdle()
        return events.replayCache.lastOrNull() ?: throw AssertionError("No websocket event parsed from: $raw")
    }
}

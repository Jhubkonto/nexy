package io.nexy.android.data

import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentContextRules
import io.nexy.android.data.model.AgentCustomCommand
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AgentKnowledgeFile
import io.nexy.android.data.model.AgentMcpServerTrust
import io.nexy.android.data.model.AgentMcpToolOverride
import io.nexy.android.data.model.AgentTools
import io.nexy.android.data.model.ToolConfig
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.AgentGeneratorSpec
import io.nexy.android.data.model.AgentGeneratorTools
import io.nexy.android.data.model.ArtifactGeneratorSpec
import io.nexy.android.data.model.DebriefStory
import io.nexy.android.data.model.StoryBeat
import io.nexy.android.data.model.StoryMood
import io.nexy.android.data.model.ArtifactOutputFile
import io.nexy.android.data.model.ArtifactSourceContext
import io.nexy.android.data.model.ScheduleGeneratorSpec
import io.nexy.android.data.model.SkillGeneratorSpec
import io.nexy.android.data.model.SkillGeneratorTools
import io.nexy.android.data.model.ProjectSettingsConfig
import io.nexy.android.data.model.CapabilityMcpGrant
import io.nexy.android.data.model.CapabilityProfile
import io.nexy.android.data.model.ArtifactDetail2
import io.nexy.android.data.model.ProjectGeneratorSpec
import io.nexy.android.data.model.ProjectGeneratorAgentSpec
import io.nexy.android.data.model.ProjectGeneratorAgentTools
import io.nexy.android.data.model.ProjectGeneratorNewAgent
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.ArtifactExportFile
import io.nexy.android.data.model.ArtifactVersionFile
import io.nexy.android.data.model.ArtifactVersionSummary
import io.nexy.android.data.model.TeachbackAttempt
import io.nexy.android.data.model.TeachbackExercise
import io.nexy.android.data.model.TeachbackFeedback
import io.nexy.android.data.model.TeachbackRubricDimension
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.HermesCliInfo
import io.nexy.android.data.model.HermesProfileInfo
import io.nexy.android.data.model.ConversationExportPackData
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.PromptVersion
import io.nexy.android.data.model.PromptVersionDiff
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.CompressionSections
import io.nexy.android.data.model.ContextInspectorAttachmentSnapshot
import io.nexy.android.data.model.ContextInspectorRefSnapshot
import io.nexy.android.data.model.ContextInspectorSnapshot
import io.nexy.android.data.model.ContextInspectorNextRequest
import io.nexy.android.data.model.ContextInspectorTurnTotal
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.NewContentConversation
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.McpCatalogEntry
import io.nexy.android.data.model.McpCatalogRequiredEnv
import io.nexy.android.data.model.McpRegistryEnvRequirement
import io.nexy.android.data.model.McpRegistryInstallConfig
import io.nexy.android.data.model.McpRegistrySearchResult
import io.nexy.android.data.model.McpRegistryServer
import io.nexy.android.data.model.McpServerWithStatus
import io.nexy.android.data.model.McpSandboxGrant
import io.nexy.android.data.model.McpSandboxProfile
import io.nexy.android.data.model.McpSandboxStatus
import io.nexy.android.data.model.McpToolInfo
import io.nexy.android.data.model.WikiExtractionCandidate
import io.nexy.android.data.model.BuildRecord
import io.nexy.android.data.model.PreflightCheck
import io.nexy.android.data.model.AndroidPublishManifest
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.FsEntry
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.ManagedWorkflowBindingRecord
import io.nexy.android.data.model.ManagedWorkflowPublishAction
import io.nexy.android.data.model.ManagedWorkflowPublishPreview
import io.nexy.android.data.model.ManagedWorkflowReviewRecord
import io.nexy.android.data.model.ManagedWorkflowSourceOption
import io.nexy.android.data.model.ManagedWorkflowStepState
import io.nexy.android.data.model.ManagedWorkflowVersionContent
import io.nexy.android.data.model.ManagedWorkflowVersionSummary
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.ProjectAuditDiff
import io.nexy.android.data.model.ProjectAuditFile
import io.nexy.android.data.model.ProjectAuditSession
import io.nexy.android.data.model.ProjectAgentEntry
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.model.SkillAgentLink
import io.nexy.android.data.model.SkillAgentUsage
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.data.model.DiscoveredSkill
import io.nexy.android.data.model.SkillKnowledge
import io.nexy.android.data.model.SkillMcpServerTrust
import io.nexy.android.data.model.SkillMcpToolOverride
import io.nexy.android.data.model.SkillPackageFile
import io.nexy.android.data.model.SkillToolConfig
import io.nexy.android.data.model.ScheduledTask
import io.nexy.android.data.model.ScheduledRun
import io.nexy.android.data.model.SkillTools
import io.nexy.android.data.model.WsEvent
import io.nexy.android.data.model.ConversationDebrief
import io.nexy.android.data.model.ConversationRating
import io.nexy.android.data.model.ConversationRatingListItem
import io.nexy.android.data.model.ConversationRatingSnapshot
import io.nexy.android.data.model.ConversationRatingStats
import io.nexy.android.data.model.RatingAggregate
import io.nexy.android.data.model.RatingTrendPoint
import io.nexy.android.data.model.QuizQuestion
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private const val MAX_SYNC_EVENT_CHARS = 8_000_000

internal fun mergeConversationPage(
    existing: List<Conversation>,
    incoming: List<Conversation>,
): List<Conversation> {
    if (incoming.isEmpty()) return existing
    val incomingById = incoming.associateBy { it.id }
    val existingIds = existing.mapTo(mutableSetOf()) { it.id }
    return existing.map { incomingById[it.id] ?: it } + incoming.filterNot { it.id in existingIds }
}

private fun parseResolvedUserInputs(raw: String?): List<io.nexy.android.ui.chat.ChatTurnUserInput> {
    if (raw.isNullOrBlank()) return emptyList()
    return runCatching {
        val entries = JSONArray(raw)
        (0 until entries.length()).mapNotNull { index ->
            val entry = entries.optJSONObject(index) ?: return@mapNotNull null
            val request = entry.optJSONObject("request") ?: return@mapNotNull null
            val requestId = request.optString("requestId")
            val rawQuestions = request.optJSONArray("questions") ?: JSONArray()
            val questions = (0 until rawQuestions.length()).mapNotNull questions@{ questionIndex ->
                val question = rawQuestions.optJSONObject(questionIndex) ?: return@questions null
                val id = question.optString("id")
                val prompt = question.optString("prompt")
                if (id.isBlank() || prompt.isBlank()) return@questions null
                val rawOptions = question.optJSONArray("options") ?: JSONArray()
                io.nexy.android.ui.chat.UserInputQuestion(
                    id = id,
                    header = question.nullableString("header"),
                    prompt = prompt,
                    options = (0 until rawOptions.length()).mapNotNull options@{ optionIndex ->
                        val option = rawOptions.optJSONObject(optionIndex) ?: return@options null
                        val optionId = option.optString("id")
                        val label = option.optString("label")
                        if (optionId.isBlank() || label.isBlank()) null else io.nexy.android.ui.chat.UserInputOption(
                            optionId, label, option.nullableString("description"),
                        )
                    },
                    selection = question.optString("selection", "single"),
                    allowFreeText = question.optBoolean("allowFreeText", true),
                )
            }
            val rawAnswers = entry.optJSONArray("answers") ?: JSONArray()
            val answers = (0 until rawAnswers.length()).mapNotNull answers@{ answerIndex ->
                val answer = rawAnswers.optJSONObject(answerIndex) ?: return@answers null
                val questionId = answer.optString("questionId")
                if (questionId.isBlank()) return@answers null
                val rawSelected = answer.optJSONArray("selectedOptionIds") ?: JSONArray()
                io.nexy.android.ui.chat.UserInputAnswer(
                    questionId,
                    (0 until rawSelected.length()).mapNotNull { rawSelected.optString(it).takeIf(String::isNotBlank) },
                    answer.nullableString("text"),
                )
            }
            if (requestId.isBlank() || questions.isEmpty()) null else io.nexy.android.ui.chat.ChatTurnUserInput(
                requestId = requestId,
                questions = questions,
                status = "resolved",
                answers = answers,
            )
        }
    }.getOrDefault(emptyList())
}

internal fun isOversizedSyncEvent(text: String, maxChars: Int = MAX_SYNC_EVENT_CHARS): Boolean {
    if (text.length <= maxChars) return false
    val envelopePrefix = text.take(512)
    return envelopePrefix.contains("\"sync:welcome\"") || envelopePrefix.contains("\"sync:ack\"")
}

@Suppress("UNCHECKED_CAST")
fun parseWsEvent(
    text: String,
    scope: CoroutineScope,
    events: MutableSharedFlow<WsEvent>,
    serverVersion: MutableStateFlow<String?>,
    conversations: MutableStateFlow<List<Conversation>>,
    projects: MutableStateFlow<List<Project>>,
    agents: MutableStateFlow<List<Agent>>,
    agentFullConfig: MutableStateFlow<AgentFullConfig?>,
    models: MutableStateFlow<List<ModelOption>>,
    modelSource: MutableStateFlow<ModelListSource?>,
    androidUpdateManifest: MutableStateFlow<AndroidUpdateManifest?>,
    providers: MutableStateFlow<List<ProviderInfo>>,
    mcpServers: MutableStateFlow<List<McpServerInfo>>,
    skills: MutableStateFlow<List<SkillConfig>>,
    skillAgentUsage: MutableStateFlow<Map<String, Int>>,
    artifacts: MutableStateFlow<List<ArtifactSummary>>,
    wikiEntries: MutableStateFlow<List<WikiEntry>>,
    promptEntries: MutableStateFlow<List<PromptEntry>>,
    pairedServerStore: PairedServerStore? = null,
    cliStatus: MutableStateFlow<Map<String, CliInstallInfo>>,
    hermesInfo: MutableStateFlow<HermesCliInfo> = MutableStateFlow(HermesCliInfo()),
    scheduledTasks: MutableStateFlow<List<ScheduledTask>>,
    scheduledRuns: MutableStateFlow<Map<String, List<ScheduledRun>>>,
    currentDebrief: MutableStateFlow<ConversationDebrief?>,
    completedConversationIds: MutableStateFlow<Set<String>>,
    currentRating: MutableStateFlow<ConversationRating?>,
    ratingsList: MutableStateFlow<List<ConversationRatingListItem>>,
    ratingStats: MutableStateFlow<ConversationRatingStats?>,
    desktopIsPackaged: MutableStateFlow<Boolean?> = MutableStateFlow(null),
    mcpCatalog: MutableStateFlow<List<McpCatalogEntry>> = MutableStateFlow(emptyList()),
    discoveredSkills: MutableStateFlow<List<DiscoveredSkill>> = MutableStateFlow(emptyList()),
) {
    // Older desktop builds can send the entire message database in one reconnect frame. Refuse
    // that frame before JSONObject expands it into a much larger object graph; connected chat
    // remains usable and the emitted error tells the user to update the desktop.
    if (isOversizedSyncEvent(text)) {
        WsRepository.appendDebugLog("WsParse", "Rejected oversized sync event payloadChars=${text.length}")
        scope.launch {
            events.emit(
                WsEvent.SyncError(
                    code = "snapshot-too-large",
                    message = "The desktop sent an oversized sync snapshot. Update Nexy Desktop and reconnect.",
                    supportedProtocolVersion = null,
                ),
            )
        }
        return
    }
    try {
        val obj = JSONObject(text)
        val event = obj.optString("event")
        val data = obj.optJSONObject("data")

        val wsEvent: WsEvent = when (event) {
            "connected" -> {
                val version = data?.optString("version") ?: ""
                serverVersion.value = version.takeIf { it.isNotBlank() }
                val macAddress = data?.optString("macAddress")?.takeIf { it.isNotBlank() }
                val broadcastAddress = data?.optString("broadcastAddress")?.takeIf { it.isNotBlank() }
                val mDnsName = data?.optString("mDnsName")?.takeIf { it.isNotBlank() }
                if (macAddress != null || broadcastAddress != null) {
                    pairedServerStore?.updateActiveProfileWolInfo(macAddress, broadcastAddress)
                }
                if (mDnsName != null) {
                    pairedServerStore?.updateActiveProfileMdnsName(mDnsName)
                }
                val isPackaged = if (data?.has("isPackaged") == true) data.optBoolean("isPackaged") else null
                desktopIsPackaged.value = isPackaged
                val voice = data?.optJSONObject("voiceCapabilities")
                val voiceCapabilities = io.nexy.android.data.model.VoiceCapabilitiesWire(
                    protocolVersion = voice?.optInt("protocolVersion", 0) ?: 0,
                    audioUpload = voice?.optBoolean("audioUpload", false) ?: false,
                    localWhisperReady = voice?.optBoolean("localWhisperReady", false) ?: false,
                    maxAudioBytes = voice?.optLong("maxAudioBytes", 0) ?: 0,
                    maxRecordingSeconds = voice?.optInt("maxRecordingSeconds", 0) ?: 0,
                )
                WsEvent.Connected(
                    version,
                    macAddress,
                    broadcastAddress,
                    mDnsName,
                    isPackaged,
                    voiceCapabilities,
                )
            }

            "voice:upload-started" -> WsEvent.VoiceUploadStarted(
                sessionId = data?.optString("sessionId") ?: return,
                chunkBytes = data.optInt("chunkBytes", 0),
                maxBytes = data.optLong("maxBytes", 0),
            )

            "voice:upload-ack" -> WsEvent.VoiceUploadAck(
                sessionId = data?.optString("sessionId") ?: return,
                nextSequence = data.optInt("nextSequence", 0),
                receivedBytes = data.optLong("receivedBytes", 0),
            )

            "voice:transcription" -> WsEvent.VoiceTranscription(
                sessionId = data?.optString("sessionId") ?: return,
                text = data.optString("text", ""),
            )

            "voice:upload-cancelled" -> WsEvent.VoiceUploadCancelled(
                sessionId = data?.optString("sessionId") ?: return,
            )

            "voice:upload-error" -> WsEvent.VoiceUploadError(
                sessionId = data?.nullableString("sessionId"),
                code = data?.optString("code", "upload-failed") ?: "upload-failed",
                message = data?.optString("message", "Voice upload failed.") ?: "Voice upload failed.",
            )

            "sync:welcome" -> WsEvent.SyncWelcome(
                protocolVersion = data?.optInt("protocolVersion", 0) ?: 0,
                desktopDeviceId = data?.optString("desktopDeviceId") ?: "",
                datasetId = data?.optString("datasetId") ?: "",
                desktopSequence = data?.optLong("desktopSequence", 0L) ?: 0L,
                isDelta = data?.optBoolean("isDelta", false) == true,
                snapshot = data?.optJSONObject("snapshot") ?: JSONObject(),
            )

            "sync:probe-ack" -> WsEvent.SyncProbeAck(
                probeId = data?.optString("probeId") ?: "",
                serverReceivedAt = data?.optLong("serverReceivedAt", 0L) ?: 0L,
            )

            "sync:ack" -> {
                val ids = data?.optJSONArray("operationIds")
                WsEvent.SyncAck(
                    operationIds = if (ids == null) emptyList() else (0 until ids.length()).map(ids::optString),
                    lastReceivedSequence = data?.optLong("lastReceivedSequence", 0L) ?: 0L,
                    desktopSequence = data?.optLong("desktopSequence", 0L) ?: 0L,
                    isDelta = data?.optBoolean("isDelta", false) == true,
                    conflictsJson = data?.optJSONArray("conflicts")?.toString() ?: "[]",
                    snapshot = data?.optJSONObject("snapshot"),
                )
            }

            "sync:conflict-resolved" -> WsEvent.SyncConflictResolved(
                conflictId = data?.optString("conflictId") ?: "",
                resolution = data?.nullableString("resolution"),
            )

            "sync:error" -> WsEvent.SyncError(
                code = data?.optString("code") ?: "sync-failed",
                message = data?.optString("message") ?: "Synchronization failed",
                supportedProtocolVersion = data?.takeIf { it.has("supportedProtocolVersion") }
                    ?.optInt("supportedProtocolVersion"),
            )

            "sync:attachment-status" -> WsEvent.SyncAttachmentStatus(
                contentHash = data?.optString("contentHash") ?: "",
                nextOffset = data?.optLong("nextOffset", 0L) ?: 0L,
                complete = data?.optBoolean("complete", false) ?: false,
            )

            "sync:attachment-chunk" -> WsEvent.SyncAttachmentChunk(
                contentHash = data?.optString("contentHash") ?: "",
                displayName = data?.optString("displayName") ?: "attachment",
                mimeType = data?.optString("mimeType") ?: "application/octet-stream",
                attachmentId = data?.nullableString("attachmentId"),
                messageId = data?.nullableString("messageId"),
                sizeBytes = data?.optLong("sizeBytes", 0L) ?: 0L,
                offset = data?.optLong("offset", 0L) ?: 0L,
                dataBase64 = data?.optString("dataBase64") ?: "",
                complete = data?.optBoolean("complete", false) ?: false,
            )

            "tool:approval-request" -> WsEvent.ToolApprovalRequest(
                requestId = data?.optString("requestId") ?: "",
                toolName = data?.optString("toolName") ?: "",
                args = jsonObjectToMap(data?.optJSONObject("args")),
                description = data?.optString("description") ?: "",
                conversationId = data?.optString("conversationId")?.takeIf { it.isNotEmpty() },
            )

            "tool:approval-cancel" -> WsEvent.ToolApprovalCancel(
                requestId = data?.optString("requestId") ?: "",
            )

            "chat:tool-call-event" -> WsEvent.ChatToolCallEvent(
                conversationId = data?.optString("conversationId") ?: "",
                id = data?.nullableString("id"),
                toolName = data?.optString("toolName") ?: "Tool call",
                serverName = data?.nullableString("serverName"),
                args = data?.optJSONObject("args")?.toString(),
                result = data?.optString("result") ?: "",
                success = data?.optBoolean("success", true) ?: true,
            )

            "chat:stream-chunk" -> WsEvent.ChatStreamChunk(
                conversationId = data?.optString("conversationId") ?: "",
                text = data?.optString("chunk") ?: "",
            )

            "chat:stream-end" -> WsEvent.ChatStreamEnd(
                conversationId = data?.optString("conversationId") ?: "",
            )

            "chat:thinking-delta" -> WsEvent.ChatThinkingDelta(
                conversationId = data?.optString("conversationId") ?: "",
                blockId = data?.optString("blockId") ?: "",
                chunk = data?.optString("chunk") ?: "",
            )

            "chat:thinking-end" -> WsEvent.ChatThinkingEnd(
                conversationId = data?.optString("conversationId") ?: "",
                blockId = data?.optString("blockId") ?: "",
            )

            "chat:activity" -> WsEvent.ChatActivity(
                conversationId = data?.optString("conversationId") ?: "",
                state = data?.optString("state") ?: "thinking",
                label = data?.optString("label") ?: "Assistant is thinking",
                toolName = data?.nullableString("toolName"),
                serverName = data?.nullableString("serverName"),
            )

            "chat:turn-event" -> WsEvent.ChatTurnEvent(
                conversationId = data?.optString("conversationId") ?: "",
                turnId = data?.optString("turnId") ?: "",
                sequence = data?.optLong("sequence", 0L) ?: 0L,
                type = data?.optString("type") ?: "",
                timestamp = data?.optLong("timestamp", 0L) ?: 0L,
                payloadJson = data?.toString() ?: "{}",
            )

            "chat:team-activity" -> WsEvent.ChatTeamActivity(
                conversationId = data?.optString("conversationId") ?: "",
                stepId = data?.optString("stepId") ?: "",
                agentName = data?.optString("agentName") ?: "Agent",
                agentIcon = data?.optString("agentIcon") ?: "",
                task = data?.optString("task") ?: "",
                status = data?.optString("status") ?: "",
                result = data?.nullableString("result"),
                durationMs = data?.takeIf { it.has("durationMs") }?.optLong("durationMs"),
            )

            "conversation:list" -> {
                val rows = when {
                    data != null && data.has("rows") -> data.optJSONArray("rows") ?: JSONArray()
                    data != null && data.has("id") -> JSONArray().put(data)
                    else -> obj.optJSONArray("data") ?: JSONArray()
                }
                val list = parseConversationArray(rows)
                conversations.value = list
                WsEvent.ConversationList(list)
            }

            "conversation:list-page" -> {
                val rows = data?.optJSONArray("items") ?: JSONArray()
                val page = parseConversationArray(rows)
                // The home screen consumes paginated results from its own ViewModel, while
                // cross-screen features (pinned chats, chat headers, notifications) observe the
                // repository-level list. Keep both views coherent without discarding rows from
                // pages that are not part of this response.
                conversations.value = mergeConversationPage(conversations.value, page)
                WsEvent.ConversationPage(
                    requestId = data?.optString("requestId") ?: "",
                    conversations = page,
                    totalCount = data?.optInt("totalCount", 0) ?: 0,
                    nextCursor = data?.nullableString("nextCursor"),
                    hasMore = data?.optBoolean("hasMore", false) ?: false,
                )
            }

            "conversation:capabilities" -> WsEvent.ConversationCapabilities(
                conversationId = data?.optString("conversationId") ?: "",
                profileJson = data?.optJSONObject("profile")?.toString() ?: "{}",
            )

            "capabilities:preflight" -> WsEvent.CapabilityPreflight(
                conversationId = data?.optString("conversationId") ?: "",
                preflightJson = data?.toString() ?: "{}",
            )

            "capabilities:activated" -> WsEvent.CapabilitiesActivated(
                conversationId = data?.optString("conversationId") ?: "",
                profileJson = data?.optJSONObject("profile")?.toString() ?: "{}",
            )

            "capabilities:error" -> WsEvent.CapabilitiesError(
                conversationId = data?.optString("conversationId") ?: "",
                message = data?.optString("message") ?: "Capability setup failed",
            )

            "project:capabilities" -> WsEvent.ProjectCapabilities(
                projectId = data?.optString("projectId") ?: "",
                profile = parseCapabilityProfile(data?.optJSONObject("profile") ?: JSONObject()),
            )

            "project:capabilities-updated" -> WsEvent.ProjectCapabilitiesUpdated(
                projectId = data?.optString("projectId") ?: "",
                profile = parseCapabilityProfile(data?.optJSONObject("profile") ?: JSONObject()),
            )

            "project:capabilities-error" -> WsEvent.ProjectCapabilitiesError(
                projectId = data?.optString("projectId") ?: "",
                message = data?.optString("message") ?: "Could not save project capabilities",
            )

            "project:list" -> {
                val projectsArray = data?.optJSONArray("projects") ?: JSONArray()
                val list = (0 until projectsArray.length()).map { i ->
                    val p = projectsArray.getJSONObject(i)
                    val iconsRaw = p.nullableString("agent_icons")
                    val agentIcons = iconsRaw?.split(",")?.filter { it.isNotBlank() } ?: emptyList()
                    Project(
                        id = p.optString("id"),
                        name = p.optString("name"),
                        color = p.optString("color", "blue"),
                        chatCount = p.optInt("chat_count", 0),
                        agentIcons = agentIcons,
                        rootDirectory = p.nullableString("root_directory"),
                        defaultModel = p.nullableString("default_model"),
                        projectHermesProfile = p.nullableString("project_hermes_profile"),
                        // `project:list` does not include the thinking default. Preserve the
                        // value hydrated from the full sync snapshot until project:config is
                        // requested, rather than replacing it with null.
                        defaultThinkingEffort = projects.value.firstOrNull { it.id == p.optString("id") }?.defaultThinkingEffort,
                    )
                }
                projects.value = list
                WsEvent.ProjectList(list)
            }

            "model:list" -> {
                val modelsArray = data?.optJSONArray("models") ?: JSONArray()
                val sourceObject = data?.optJSONObject("source")
                val list = (0 until modelsArray.length()).map { i ->
                    val model = modelsArray.getJSONObject(i)
                    ModelOption(
                        id = model.optString("id"),
                        label = model.optString("label"),
                        vendor = model.nullableString("vendor"),
                        isCliSourced = model.optBoolean("isCliSourced", false),
                        backend = model.nullableString("backend"),
                    )
                }
                models.value = list
                val source = sourceObject?.let {
                    ModelListSource(
                        type = it.optString("type"),
                        label = it.optString("label"),
                        backend = it.nullableString("backend"),
                    )
                }
                modelSource.value = source
                WsEvent.ModelList(list, source)
            }

            "android:log" -> {
                val tag = data?.optString("tag") ?: "Desktop"
                val message = data?.optString("message") ?: ""
                WsRepository.appendDebugLog(tag, message)
                return
            }

            "android:update-manifest" -> {
                val manifest = data?.let {
                    AndroidUpdateManifest(
                        versionCode = it.optInt("versionCode", 0),
                        versionName = it.optString("versionName"),
                        commitSha = it.nullableString("commitSha"),
                        buildId = it.nullableString("buildId"),
                        sourceDirty = it.optBoolean("sourceDirty", false),
                        builtAt = it.optLong("builtAt", 0L).takeIf { timestamp -> timestamp > 0L },
                        changelog = it.optString("changelog"),
                        checksum = it.optString("checksum"),
                        artifactUrl = it.optString("artifactUrl"),
                        artifactUrls = it.optJSONArray("artifactUrls")?.let { arr ->
                            (0 until arr.length()).map { i -> arr.optString(i) }
                        } ?: emptyList(),
                        publishedAt = it.optLong("publishedAt", 0L),
                    )
                }
                androidUpdateManifest.value = manifest
                WsEvent.AndroidUpdateManifestResult(manifest)
            }

            "project-git:error" -> WsEvent.CodeChangeError(
                reportId = data?.nullableString("reportId"),
                error = data?.optString("error") ?: "Unknown error",
            )

            "project-git:repos" -> {
                val reposArr = data?.optJSONArray("repos")
                val repos = if (reposArr != null) (0 until reposArr.length()).mapNotNull { i ->
                    val row = reposArr.optJSONObject(i) ?: return@mapNotNull null
                    WsEvent.CodeChangeRepoWire(
                        relativePath = row.optString("relativePath"),
                        branch = row.optString("branch"),
                        dirty = row.optBoolean("dirty", false),
                    )
                } else emptyList()
                WsEvent.CodeChangeRepos(repos)
            }

            "project-git:files" -> {
                val filesArr = data?.optJSONArray("files")
                val files = if (filesArr != null) (0 until filesArr.length()).map { filesArr.optString(it) } else emptyList()
                WsEvent.CodeChangeFiles(files)
            }

            "project-git:changed-files" -> {
                val filesArr = data?.optJSONArray("files")
                val files = if (filesArr != null) (0 until filesArr.length()).mapNotNull { i ->
                    val row = filesArr.optJSONObject(i) ?: return@mapNotNull null
                    WsEvent.ChangedFileInfo(
                        relativePath = row.optString("relativePath"),
                        staged = row.optBoolean("staged", false),
                    )
                } else emptyList()
                WsEvent.CodeChangeChangedFiles(files, seq = data?.optInt("seq", 0) ?: 0)
            }

            "project-git:branches" -> {
                val localArr = data?.optJSONArray("local")
                val remoteArr = data?.optJSONArray("remote")
                WsEvent.CodeChangeBranches(
                    current = data?.optString("current") ?: "",
                    local = if (localArr != null) (0 until localArr.length()).map { localArr.optString(it) } else emptyList(),
                    remote = if (remoteArr != null) (0 until remoteArr.length()).map { remoteArr.optString(it) } else emptyList(),
                    seq = data?.optInt("seq", 0) ?: 0,
                )
            }

            "project-git:checked-out" -> WsEvent.CodeChangeCheckedOut(
                ok = data?.optBoolean("ok", false) ?: false,
                error = data?.nullableString("error"),
            )

            "project-git:branch-created" -> WsEvent.CodeChangeBranchCreated(
                ok = data?.optBoolean("ok", false) ?: false,
                error = data?.nullableString("error"),
            )

            "project-git:fetched" -> WsEvent.CodeChangeFetched(
                ok = data?.optBoolean("ok", false) ?: false,
                error = data?.nullableString("error"),
            )

            "project-git:merged" -> {
                val filesArr = data?.optJSONArray("conflictedFiles")
                val files = if (filesArr != null) (0 until filesArr.length()).mapNotNull { i ->
                    val row = filesArr.optJSONObject(i) ?: return@mapNotNull null
                    WsEvent.CodeChangeMergeConflictFile(
                        relativePath = row.optString("relativePath"),
                        content = row.optString("content"),
                    )
                } else emptyList()
                WsEvent.CodeChangeMerged(
                    ok = data?.optBoolean("ok", false) ?: false,
                    conflicted = data?.optBoolean("conflicted", false) ?: false,
                    conflictedFiles = files,
                    error = data?.nullableString("error"),
                    summary = data?.nullableString("summary"),
                )
            }

            "project-git:repo-initialized" -> WsEvent.CodeChangeRepoInitialized(
                ok = data?.optBoolean("ok", false) ?: false,
                error = data?.nullableString("error"),
            )

            "project-git:credentials" -> {
                val methodsArr = data?.optJSONArray("methods")
                val methods = if (methodsArr != null) (0 until methodsArr.length()).mapNotNull { i ->
                    val row = methodsArr.optJSONObject(i) ?: return@mapNotNull null
                    WsEvent.CodeChangeCredentialMethod(
                        label = row.optString("label"),
                        detail = row.optString("detail"),
                    )
                } else emptyList()
                WsEvent.CodeChangeCredentials(
                    remoteUrl = data?.nullableString("remoteUrl"),
                    host = data?.nullableString("host"),
                    methods = methods,
                )
            }

            "project-git:pulled" -> {
                val filesArr = data?.optJSONArray("conflictedFiles")
                val files = if (filesArr != null) (0 until filesArr.length()).mapNotNull { i ->
                    val row = filesArr.optJSONObject(i) ?: return@mapNotNull null
                    WsEvent.CodeChangeMergeConflictFile(
                        relativePath = row.optString("relativePath"),
                        content = row.optString("content"),
                    )
                } else emptyList()
                WsEvent.CodeChangePulled(
                    ok = data?.optBoolean("ok", false) ?: false,
                    conflicted = data?.optBoolean("conflicted", false) ?: false,
                    conflictedFiles = files,
                    error = data?.nullableString("error"),
                    summary = data?.nullableString("summary"),
                )
            }

            "project-git:branch-pushed" -> WsEvent.CodeChangeBranchPushed(
                ok = data?.optBoolean("ok", false) ?: false,
                error = data?.nullableString("error"),
            )

            "project-git:committed" -> WsEvent.CodeChangeCommitted(
                ok = data?.optBoolean("ok", false) ?: false,
                error = data?.nullableString("error"),
            )

            "project-git:file-discarded" -> WsEvent.CodeChangeFileDiscarded(
                ok = data?.optBoolean("ok", false) ?: false,
                error = data?.nullableString("error"),
                relativePath = data?.optString("relativePath") ?: "",
            )

            "project-git:stashed" -> WsEvent.CodeChangeStashed(
                ok = data?.optBoolean("ok", false) ?: false,
                error = data?.nullableString("error"),
            )

            "project-git:stash-popped" -> WsEvent.CodeChangeStashPopped(
                ok = data?.optBoolean("ok", false) ?: false,
                error = data?.nullableString("error"),
            )

            "project-git:stash-count" -> WsEvent.CodeChangeStashCount(
                count = data?.optInt("count", 0) ?: 0,
            )

            "project-git:branch-deleted" -> WsEvent.CodeChangeBranchDeleted(
                ok = data?.optBoolean("ok", false) ?: false,
                error = data?.nullableString("error"),
                branchName = data?.optString("branchName") ?: "",
            )

            "project-git:file-diff" -> WsEvent.CodeChangeFileDiff(
                diff = data?.optString("diff") ?: "",
                binary = data?.optBoolean("binary", false) ?: false,
                relativePath = data?.optString("relativePath") ?: "",
                seq = data?.optInt("seq", 0) ?: 0,
            )

            "project-git:staged" -> WsEvent.CodeChangeStaged(
                ok = data?.optBoolean("ok", false) ?: false,
                error = data?.nullableString("error"),
            )

            "project-git:unstaged" -> WsEvent.CodeChangeUnstaged(
                ok = data?.optBoolean("ok", false) ?: false,
                error = data?.nullableString("error"),
            )
            "conversation:model-updated" -> {
                val conversationId = data?.optString("conversationId") ?: ""
                val model = data?.nullableString("model")
                conversations.value = conversations.value.map { conversation ->
                    if (conversation.id == conversationId) conversation.copy(model = model) else conversation
                }
                val hermesProfile = data?.nullableString("hermesProfile")
                conversations.value = conversations.value.map { conversation ->
                    if (conversation.id == conversationId) conversation.copy(conversationHermesProfile = hermesProfile) else conversation
                }
                WsEvent.ConversationModelUpdated(conversationId, model, hermesProfile)
            }

            "conversation:mode-updated" -> {
                val conversationId = data?.optString("conversationId") ?: ""
                val thinkingEffortOverride = data?.nullableString("thinkingEffortOverride")
                val fullAutoApproveOverride = if (data != null && data.has("fullAutoApproveOverride") && !data.isNull("fullAutoApproveOverride")) {
                    data.optInt("fullAutoApproveOverride") != 0
                } else null
                val agenticModeOverride = if (data != null && data.has("agenticModeOverride") && !data.isNull("agenticModeOverride")) {
                    data.optInt("agenticModeOverride") != 0
                } else null
                val terminalSandboxOverride = if (data != null && data.has("terminalSandboxOverride") && !data.isNull("terminalSandboxOverride")) {
                    data.optInt("terminalSandboxOverride") != 0
                } else null
                val cliModeOverride = data?.nullableString("cliModeOverride")
                val codexExecutionModeOverride = data?.nullableString("codexExecutionModeOverride")
                conversations.value = conversations.value.map { conversation ->
                    if (conversation.id == conversationId) {
                        conversation.copy(
                            thinking_effort_override = thinkingEffortOverride,
                            full_auto_approve_override = fullAutoApproveOverride,
                            agentic_mode_override = agenticModeOverride,
                            terminal_sandbox_override = terminalSandboxOverride,
                            cli_mode_override = cliModeOverride,
                            codex_execution_mode_override = codexExecutionModeOverride,
                        )
                    } else conversation
                }
                WsEvent.ConversationModeUpdated(conversationId, thinkingEffortOverride, fullAutoApproveOverride, agenticModeOverride, terminalSandboxOverride, cliModeOverride, codexExecutionModeOverride)
            }

            "conversation:messages" -> {
                val conversationId = data?.optString("conversationId") ?: ""
                val messagesArray = data?.optJSONArray("messages") ?: JSONArray()
                val messages = (0 until messagesArray.length()).map { i ->
                    val m = messagesArray.getJSONObject(i)
                    HistoryMessage(
                        id = m.optString("id"),
                        role = m.optString("role"),
                        content = m.optString("content"),
                        timestamp = m.optLong("timestamp"),
                        timelineOrder = m.takeUnless { it.isNull("timeline_order") }?.optLong("timeline_order"),
                        attachments = attachmentsFromJson(m.nullableString("attachments")),
                        thinkingBlocks = parseThinkingBlocks(m.nullableString("thinking_blocks")),
                        textSegments = parseThinkingBlocks(m.nullableString("text_segments")),
                        userInputs = parseResolvedUserInputs(m.nullableString("user_inputs")),
                        model = m.nullableString("model"),
                    )
                }
                WsEvent.ConversationMessages(
                    conversationId = conversationId,
                    messages = messages,
                    requestId = data?.optString("requestId") ?: "",
                    paged = data?.optBoolean("paged", false) == true,
                    hasMore = data?.optBoolean("hasMore", false) == true,
                    nextBeforeTimestamp = data?.takeUnless { it.isNull("nextBeforeTimestamp") }?.optLong("nextBeforeTimestamp"),
                    nextBeforeId = data?.nullableString("nextBeforeId"),
                    historyVersion = data?.nullableString("historyVersion"),
                )
            }

            "conversation:history-start" -> WsEvent.ConversationHistoryStart(
                conversationId = data?.optString("conversationId") ?: "",
                requestId = data?.optString("requestId") ?: "",
                totalItems = data?.optInt("totalItems", 0) ?: 0,
                chunkCount = data?.optInt("chunkCount", 0) ?: 0,
                historyVersion = data?.nullableString("historyVersion"),
            )

            "conversation:history-chunk" -> {
                val conversationId = data?.optString("conversationId") ?: ""
                val messagesArray = data?.optJSONArray("messages") ?: JSONArray()
                val messages = (0 until messagesArray.length()).map { i ->
                    val m = messagesArray.getJSONObject(i)
                    HistoryMessage(
                        id = m.optString("id"),
                        role = m.optString("role"),
                        content = m.optString("content"),
                        timestamp = m.optLong("timestamp"),
                        timelineOrder = m.takeUnless { it.isNull("timeline_order") }?.optLong("timeline_order"),
                        attachments = attachmentsFromJson(m.nullableString("attachments")),
                        thinkingBlocks = parseThinkingBlocks(m.nullableString("thinking_blocks")),
                        textSegments = parseThinkingBlocks(m.nullableString("text_segments")),
                        userInputs = parseResolvedUserInputs(m.nullableString("user_inputs")),
                        model = m.nullableString("model"),
                    )
                }
                WsEvent.ConversationMessages(
                    conversationId = conversationId,
                    messages = messages,
                    requestId = data?.optString("requestId") ?: "",
                    paged = true,
                    chunkIndex = data?.optInt("chunkIndex", 0),
                    chunkCount = data?.optInt("chunkCount", 0),
                )
            }

            "conversation:history-complete" -> WsEvent.ConversationHistoryComplete(
                conversationId = data?.optString("conversationId") ?: "",
                requestId = data?.optString("requestId") ?: "",
                historyVersion = data?.nullableString("historyVersion"),
                hasMore = data?.optBoolean("hasMore", false) == true,
                nextBeforeTimestamp = data?.takeUnless { it.isNull("nextBeforeTimestamp") }?.optLong("nextBeforeTimestamp"),
                nextBeforeId = data?.nullableString("nextBeforeId"),
            )

            "conversation:history-not-modified" -> WsEvent.ConversationHistoryNotModified(
                conversationId = data?.optString("conversationId") ?: "",
                requestId = data?.optString("requestId") ?: "",
                historyVersion = data?.nullableString("historyVersion"),
                hasMore = data?.optBoolean("hasMore", false) == true,
            )

            "chat:cost" -> WsEvent.ChatCost(
                conversationId = data?.optString("conversationId") ?: "",
                inputTokens = data?.optInt("inputTokens", 0) ?: 0,
                outputTokens = data?.optInt("outputTokens", 0) ?: 0,
                totalCostUsd = data?.optDouble("totalCostUsd", 0.0) ?: 0.0,
            )

            "agent:list" -> {
                val agentsArray = data?.optJSONArray("agents") ?: JSONArray()
                val list = (0 until agentsArray.length()).map { i ->
                    val a = agentsArray.getJSONObject(i)
                    Agent(
                        id = a.optString("id"),
                        name = a.optString("name"),
                        icon = a.optString("icon", ""),
                        backend = a.nullableString("backend"),
                        cliModel = a.nullableString("cli_model"),
                    )
                }
                agents.value = list
                WsEvent.AgentList(list)
            }

            "conversation:created" -> WsEvent.ConversationCreated(
                id = data?.optString("id") ?: "",
                agentId = data?.nullableString("agentId"),
                projectId = data?.nullableString("projectId"),
                title = data?.optString("title") ?: "New Chat",
            )

            "conversation:renamed" -> {
                val id = data?.optString("id") ?: ""
                val title = data?.optString("title") ?: ""
                conversations.value = conversations.value.map { if (it.id == id) it.copy(title = title) else it }
                WsEvent.ConversationRenamed(id, title)
            }

            "conversation:deleted" -> {
                val id = data?.optString("id") ?: ""
                conversations.value = conversations.value.filter { it.id != id }
                WsEvent.ConversationDeleted(id)
            }

            "conversation:search-results" -> WsEvent.ConversationSearchResults(
                conversations = parseConversationArray(data?.optJSONArray("conversations") ?: JSONArray())
            )

            "message:deleted" -> WsEvent.MessageDeleted(id = data?.optString("id") ?: "")

            "conversation:pinned" -> {
                val id = data?.optString("id") ?: ""
                val pinned = data?.optBoolean("pinned", false) ?: false
                conversations.value = conversations.value.map { if (it.id == id) it.copy(pinned = pinned) else it }
                WsEvent.ConversationPinned(id, pinned)
            }

            "conversation:context-updated" -> WsEvent.ConversationContextUpdated(
                conversationId = data?.optString("conversationId") ?: "",
                projectId = data?.nullableString("projectId"),
                agentId = data?.nullableString("agentId"),
            )

            "message:inserted" -> {
                val msg = data?.optJSONObject("message")
                WsEvent.MessageInserted(
                    conversationId = data?.optString("conversationId") ?: "",
                    messageId = msg?.optString("id") ?: "",
                    role = msg?.optString("role") ?: "user",
                    content = msg?.optString("content") ?: "",
                    timestamp = msg?.optLong("timestamp") ?: 0L,
                )
            }

            "message:deleted-after" -> WsEvent.MessagesDeletedAfter(
                conversationId = data?.optString("conversationId") ?: "",
                timestamp = data?.optLong("timestamp") ?: 0L,
            )

            "conversation:compression-preview" -> WsEvent.CompressionPreview(
                conversationId = data?.optString("conversation_id") ?: "",
                hasSummary = data?.optBoolean("has_summary", false) ?: false,
                summarizedMessageCount = data?.optInt("summarized_message_count") ?: 0,
                retainedMessageCount = data?.optInt("retained_message_count") ?: 0,
                estimatedTokensBefore = data?.optInt("estimated_tokens_before") ?: 0,
                targetBudget = data?.optInt("target_budget") ?: 0,
                strategy = data?.nullableString("strategy"),
                updatedAt = if (data?.isNull("updated_at") == false) data.optLong("updated_at") else null,
            )

            "conversation:compression-draft" -> {
                val s = data?.optJSONObject("sections")
                fun strList(key: String) = s?.optJSONArray(key)?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
                WsEvent.CompressionDraft(
                    conversationId = data?.optString("conversation_id") ?: "",
                    summarizedMessageCount = data?.optInt("summarized_message_count") ?: 0,
                    retainedMessageCount = data?.optInt("retained_message_count") ?: 0,
                    estimatedTokensBefore = data?.optInt("estimated_tokens_before") ?: 0,
                    targetBudget = data?.optInt("target_budget") ?: 0,
                    strategy = data?.optString("strategy") ?: "manual-structured-summary-plus-recent-turns",
                    sections = CompressionSections(
                        goals = strList("goals"),
                        decisions = strList("decisions"),
                        constraints = strList("constraints"),
                        filesTouched = strList("filesTouched"),
                        commandsRun = strList("commandsRun"),
                        openQuestions = strList("openQuestions"),
                        nextActions = strList("nextActions"),
                        recentContextNotes = strList("recentContextNotes"),
                    ),
                )
            }

            "conversation:compression-saved" -> WsEvent.CompressionSaved(
                conversationId = data?.optString("conversation_id") ?: "",
                hasSummary = data?.optBoolean("has_summary", false) ?: false,
                summarizedMessageCount = data?.optInt("summarized_message_count") ?: 0,
                retainedMessageCount = data?.optInt("retained_message_count") ?: 0,
            )

            "conversation:compression-error" -> WsEvent.CompressionError(data?.optString("message") ?: "Compression failed")

            "context:inspector-snapshot" -> {
                val snapshot = if (data == null) null else {
                    val refsArray = data.optJSONArray("contextRefs") ?: JSONArray()
                    val refs = (0 until refsArray.length()).map { i ->
                        val r = refsArray.getJSONObject(i)
                        ContextInspectorRefSnapshot(
                            token = r.optString("token"),
                            key = r.optString("key"),
                            estimatedTokens = r.optInt("estimatedTokens"),
                        )
                    }
                    val attachmentsArray = data.optJSONArray("attachments") ?: JSONArray()
                    val attachments = (0 until attachmentsArray.length()).map { i ->
                        val a = attachmentsArray.getJSONObject(i)
                        ContextInspectorAttachmentSnapshot(
                            name = a.optString("name"),
                            size = a.optLong("size"),
                            estimatedTokens = a.optInt("estimatedTokens"),
                        )
                    }
                    ContextInspectorSnapshot(
                        conversationId = data.nullableString("conversationId"),
                        model = data.optString("model"),
                        systemPrompt = data.optString("systemPrompt"),
                        systemPromptTokens = data.optInt("systemPromptTokens"),
                        contextRefs = refs,
                        attachments = attachments,
                        imageCount = data.optInt("imageCount"),
                        historyMessageCount = data.optInt("historyMessageCount"),
                        currentInputTokens = data.optInt("currentInputTokens"),
                        totalTokens = data.optInt("totalTokens"),
                        maxTokens = data.optInt("maxTokens", 16000),
                        nextRequest = data.optJSONObject("nextRequest")?.let { next ->
                            ContextInspectorNextRequest(
                                inputTokens = next.optInt("inputTokens"),
                                quality = next.optString("quality", "estimate"),
                                source = next.optString("source", "heuristic"),
                                model = next.nullableString("model"),
                            )
                        },
                        turnTotal = data.optJSONObject("turnTotal")?.let { total ->
                            ContextInspectorTurnTotal(
                                inputTokens = total.optInt("inputTokens"),
                                outputTokens = total.optInt("outputTokens"),
                                requestCount = total.optInt("requestCount"),
                                quality = total.optString("quality", "estimate"),
                                source = total.optString("source", "heuristic"),
                                complete = total.optBoolean("complete", false),
                            )
                        },
                    )
                }
                WsEvent.InspectorSnapshot(snapshot)
            }

            "context:inspector-snapshot-error" -> WsEvent.InspectorSnapshotError(data?.optString("message") ?: "Unable to load context inspector")
            "project:created" -> {
                val p = data?.optJSONObject("project") ?: return
                val project = Project(
                    id = p.optString("id"),
                    name = p.optString("name"),
                    color = p.optString("color", "blue"),
                    chatCount = 0,
                    agentIcons = emptyList(),
                    defaultModel = p.nullableString("default_model"),
                    projectHermesProfile = p.nullableString("project_hermes_profile"),
                )
                projects.value = projects.value + project
                WsEvent.ProjectCreated(project)
            }

            "project:renamed" -> {
                val id = data?.optString("id") ?: ""
                val name = data?.optString("name") ?: ""
                val color = data?.nullableString("color")
                projects.value = projects.value.map { if (it.id == id) it.copy(name = name, color = color ?: it.color) else it }
                WsEvent.ProjectRenamed(id, name, color)
            }

            "project:deleted" -> {
                val id = data?.optString("id") ?: ""
                projects.value = projects.value.filter { it.id != id }
                WsEvent.ProjectDeleted(id)
            }

            "agent:created" -> {
                val a = data?.optJSONObject("agent") ?: return
                val agent = Agent(
                    id = a.optString("id"),
                    name = a.optString("name"),
                    icon = a.optString("icon", ""),
                )
                agents.value = agents.value + agent
                WsEvent.AgentCreated(agent)
            }

            "agent:updated" -> {
                val a = data?.optJSONObject("agent") ?: return
                val id = a.optString("id")
                val updated = Agent(id = id, name = a.optString("name"), icon = a.optString("icon", ""))
                agents.value = agents.value.map { if (it.id == id) updated else it }
                WsEvent.AgentUpdated(updated)
            }

            "agent:deleted" -> {
                val id = data?.optString("id") ?: ""
                agents.value = agents.value.filter { it.id != id }
                WsEvent.AgentDeleted(id)
            }

            "agent:full" -> {
                val a = data?.optJSONObject("agent") ?: return
                val config = parseAgentFullConfig(a)
                agentFullConfig.value = config
                WsEvent.AgentFull(config)
            }

            "provider:list" -> {
                val arr = data?.optJSONArray("providers") ?: return
                val list = (0 until arr.length()).map { i ->
                    val p = arr.getJSONObject(i)
                    ProviderInfo(
                        id = p.optString("id"),
                        label = p.optString("label"),
                        configured = p.optBoolean("configured", false),
                    )
                }
                providers.value = list
                WsEvent.ProviderList(list)
            }

            "provider:key-set" -> {
                val provider = data?.optString("provider") ?: ""
                providers.value = providers.value.map {
                    if (it.id == provider) it.copy(configured = true) else it
                }
                WsEvent.ProviderKeySet(provider)
            }

            "provider:key-removed" -> {
                val provider = data?.optString("provider") ?: ""
                providers.value = providers.value.map {
                    if (it.id == provider) it.copy(configured = false) else it
                }
                WsEvent.ProviderKeyRemoved(provider)
            }

            "app:cli-status" -> {
                val clisObj = data?.optJSONObject("clis") ?: return
                val map = mutableMapOf<String, CliInstallInfo>()
                clisObj.keys().forEach { key ->
                    val c = clisObj.optJSONObject(key) ?: return@forEach
                    map[key] = CliInstallInfo(
                        installed = c.optBoolean("installed", false),
                        version = c.nullableString("version"),
                        path = c.nullableString("path"),
                    )
                }
                cliStatus.value = map
                data?.optJSONObject("hermes")?.let { h ->
                    val profilesArr = h.optJSONArray("profiles")
                    val profiles = if (profilesArr == null) emptyList() else (0 until profilesArr.length()).mapNotNull { i ->
                        profilesArr.optJSONObject(i)?.let { p ->
                            HermesProfileInfo(
                                name = p.optString("name"),
                                isDefault = p.optBoolean("isDefault", false),
                                model = p.nullableString("model"),
                                provider = p.nullableString("provider"),
                                description = p.nullableString("description"),
                            )
                        }
                    }.filter { it.name.isNotBlank() }
                    hermesInfo.value = HermesCliInfo(
                        profiles = profiles,
                        acpReady = h.optBoolean("acpReady", false),
                        version = h.nullableString("version"),
                        acpStatus = h.nullableString("acpStatus"),
                        acpDetail = h.nullableString("acpDetail"),
                        profileRoot = h.optJSONObject("profileDiscovery")?.nullableString("root"),
                        profilesDirectory = h.optJSONObject("profileDiscovery")?.nullableString("profilesDirectory"),
                        namedProfileCount = h.optJSONObject("profileDiscovery")?.optInt("namedProfileCount", 0) ?: 0,
                        profileDiscoveryError = h.optJSONObject("profileDiscovery")?.nullableString("error"),
                    )
                }
                WsEvent.CliStatus(map)
            }

            "app:setting-set" -> {
                val key = data?.optString("key") ?: ""
                val value = data?.optString("value") ?: ""
                WsEvent.SettingSet(key, value)
            }

            "app:setting-value" -> {
                val key = data?.optString("key") ?: ""
                val value = data?.nullableString("value")
                WsEvent.SettingValue(key, value)
            }

            "mcp:list" -> {
                val arr = data?.optJSONArray("servers") ?: return
                val list = (0 until arr.length()).map { i ->
                    val s = arr.getJSONObject(i)
                    val args = s.optJSONArray("args")?.let { values ->
                        (0 until values.length()).map { values.optString(it) }
                    } ?: emptyList()
                    McpServerInfo(
                        id = s.optString("id"),
                        name = s.optString("name"),
                        description = s.optString("description"),
                        command = s.optString("command"),
                        args = args,
                        enabled = s.optBoolean("enabled", false),
                        status = s.nullableString("status"),
                        error = s.nullableString("error"),
                        toolCount = s.optInt("toolCount", 0),
                        managed = s.optBoolean("managed", false),
                        sandbox = parseMcpSandboxStatus(s.optJSONObject("sandbox")),
                        sandboxProfile = parseMcpSandboxProfile(s.optJSONObject("sandboxProfile")),
                    )
                }
                mcpServers.value = list
                WsEvent.McpList(list)
            }

            "mcp:catalog" -> {
                val arr = data?.optJSONArray("entries") ?: JSONArray()
                val list = (0 until arr.length()).mapNotNull { i ->
                    val entry = arr.optJSONObject(i) ?: return@mapNotNull null
                    val args = entry.optJSONArray("args")?.let { values ->
                        (0 until values.length()).map { values.optString(it) }
                    } ?: emptyList()
                    val env = entry.optJSONObject("env")?.let { envObject ->
                        buildMap {
                            envObject.keys().forEach { key -> put(key, envObject.optString(key)) }
                        }
                    } ?: emptyMap()
                    val required = entry.optJSONArray("requiredEnv")?.let { values ->
                        (0 until values.length()).mapNotNull { index ->
                            val req = values.optJSONObject(index) ?: return@mapNotNull null
                            val key = req.optString("key")
                            val label = req.optString("label")
                            if (key.isBlank() || label.isBlank()) null else McpCatalogRequiredEnv(
                                key = key,
                                label = label,
                                helpUrl = req.nullableString("helpUrl"),
                                secret = req.optBoolean("secret", false),
                            )
                        }
                    } ?: emptyList()
                    val id = entry.optString("id")
                    val name = entry.optString("name")
                    if (id.isBlank() || name.isBlank()) null else McpCatalogEntry(
                        id = id,
                        name = name,
                        capability = entry.optString("capability", name),
                        description = entry.optString("description"),
                        category = entry.optString("category", "productivity"),
                        access = entry.optString("access"),
                        impact = entry.optString("impact", "read-only"),
                        command = entry.optString("command"),
                        args = args,
                        env = env,
                        imageResponses = entry.nullableString("imageResponses"),
                        requiredEnv = required,
                        docsUrl = entry.nullableString("docsUrl"),
                        keywords = entry.optJSONArray("keywords")?.let { values ->
                            (0 until values.length()).map { values.optString(it) }
                        } ?: emptyList(),
                    )
                }
                mcpCatalog.value = list
                WsEvent.McpCatalog(list)
            }

            "mcp:registry-results" -> {
                val arr = data?.optJSONArray("servers") ?: JSONArray()
                val servers = (0 until arr.length()).mapNotNull { index ->
                    val raw = arr.optJSONObject(index) ?: return@mapNotNull null
                    val name = raw.optString("name")
                    val description = raw.optString("description")
                    if (name.isBlank() || description.isBlank()) return@mapNotNull null
                    val install = raw.optJSONObject("install")?.let { config ->
                        val command = config.optString("command")
                        if (command.isBlank()) return@let null
                        val args = config.optJSONArray("args")?.let { values ->
                            (0 until values.length()).map { values.optString(it) }
                        } ?: emptyList()
                        val requiredEnv = config.optJSONArray("requiredEnv")?.let { values ->
                            (0 until values.length()).mapNotNull { envIndex ->
                                val requirement = values.optJSONObject(envIndex) ?: return@mapNotNull null
                                val key = requirement.optString("key")
                                val label = requirement.optString("label")
                                if (key.isBlank() || label.isBlank()) null else McpRegistryEnvRequirement(
                                    key = key,
                                    label = label,
                                    helpUrl = requirement.nullableString("helpUrl"),
                                    secret = requirement.optBoolean("secret", false),
                                )
                            }
                        } ?: emptyList()
                        McpRegistryInstallConfig(command = command, args = args, requiredEnv = requiredEnv)
                    }
                    McpRegistryServer(
                        name = name,
                        title = raw.nullableString("title"),
                        description = description,
                        version = raw.optString("version"),
                        docsUrl = raw.nullableString("docsUrl"),
                        repositoryUrl = raw.nullableString("repositoryUrl"),
                        status = raw.optString("status", "active"),
                        statusMessage = raw.nullableString("statusMessage"),
                        transport = raw.optString("transport", "unknown"),
                        install = install,
                    )
                }
                WsEvent.McpRegistryResults(
                    McpRegistrySearchResult(
                        servers = servers,
                        fetchedAt = data?.optLong("fetchedAt", 0L) ?: 0L,
                        stale = data?.optBoolean("stale", false) ?: false,
                    ),
                )
            }

            "mcp:registry-error" -> WsEvent.McpRegistryError(
                data?.optString("message") ?: "Could not reach the MCP Registry",
            )

            "mcp:test-result" -> {
                val tools = data?.optJSONArray("tools")?.let { values ->
                    (0 until values.length()).mapNotNull { index -> values.optJSONObject(index)?.optString("name")?.takeIf { it.isNotBlank() } }
                } ?: emptyList()
                WsEvent.McpTestResult(
                    ok = data?.optBoolean("ok", false) ?: false,
                    toolNames = tools,
                    error = data?.nullableString("error"),
                )
            }

            "mcp:server-added" -> {
                val s = data?.optJSONObject("server") ?: return
                val server = parseMcpServerWithStatus(s)
                mcpServers.value = mcpServers.value + McpServerInfo(id = server.id, name = server.name, description = server.description, command = server.command, args = server.args, enabled = server.enabled, status = server.status, error = server.error, toolCount = server.toolCount, managed = server.managed, sandbox = server.sandbox, sandboxProfile = server.sandboxProfile)
                WsEvent.McpServerAdded(server)
            }

            "mcp:server-updated" -> {
                val s = data?.optJSONObject("server") ?: return
                val server = parseMcpServerWithStatus(s)
                mcpServers.value = mcpServers.value.map { if (it.id == server.id) McpServerInfo(id = server.id, name = server.name, description = server.description, command = server.command, args = server.args, enabled = server.enabled, status = server.status, error = server.error, toolCount = server.toolCount, managed = server.managed, sandbox = server.sandbox, sandboxProfile = server.sandboxProfile) else it }
                WsEvent.McpServerUpdated(server)
            }

            "mcp:server-removed" -> {
                val id = data?.optString("id") ?: ""
                mcpServers.value = mcpServers.value.filter { it.id != id }
                WsEvent.McpServerRemoved(id)
            }

            "mcp:server-status" -> {
                val id = data?.optString("id") ?: ""
                val status = data?.optString("status") ?: "disconnected"
                val error = data?.nullableString("error")
                val toolCount = data?.optInt("toolCount", 0) ?: 0
                WsEvent.McpServerStatus(id, status, error, toolCount, parseMcpSandboxStatus(data?.optJSONObject("sandbox")))
            }

            "mcp:tools" -> {
                val agentId = data?.nullableString("agentId")
                val arr = data?.optJSONArray("tools") ?: JSONArray()
                val tools = (0 until arr.length()).map { i ->
                    val t = arr.getJSONObject(i)
                    McpToolInfo(
                        name = t.optString("name"),
                        description = t.nullableString("description"),
                        serverId = t.optString("serverId"),
                        serverName = t.optString("serverName"),
                    )
                }
                WsEvent.McpToolList(agentId, tools)
            }

            "wiki:extraction-candidates" -> {
                val conversationId = data?.optString("conversationId") ?: ""
                val arr = data?.optJSONArray("candidates") ?: JSONArray()
                val candidates = (0 until arr.length()).map { i ->
                    val c = arr.getJSONObject(i)
                    WikiExtractionCandidate(
                        title = c.optString("title"),
                        body = c.optString("body"),
                        tags = run { val ta = c.optJSONArray("tags"); if (ta != null) (0 until ta.length()).map { ta.optString(it) } else emptyList() },
                    )
                }
                WsEvent.WikiExtractionCandidates(conversationId, candidates)
            }

            "wiki:extraction-error" -> {
                WsEvent.WikiExtractionError(data?.optString("message") ?: "Extraction failed")
            }

            "skill:list" -> {
                val arr = data?.optJSONArray("skills") ?: JSONArray()
                val list = (0 until arr.length()).map { i -> parseSkillConfig(arr.getJSONObject(i)) }
                skills.value = list
                WsEvent.SkillList(list)
            }

            "skill:discover" -> {
                val arr = data?.optJSONArray("skills") ?: JSONArray()
                val list = (0 until arr.length()).mapNotNull { i ->
                    arr.optJSONObject(i)?.let(::parseDiscoveredSkill)
                }
                discoveredSkills.value = list
                WsEvent.SkillDiscoveryList(list)
            }

            "skill:discovery-error" -> WsEvent.SkillDiscoveryError(
                data?.optString("message")?.takeIf { it.isNotBlank() } ?: "Skill discovery failed.",
            )

            "skill:detail" -> WsEvent.SkillDetail(
                skill = data?.optJSONObject("skill")?.let { parseSkillConfig(it) }
            )

            "skill:created" -> {
                val skill = parseSkillConfig(data?.optJSONObject("skill") ?: return)
                skills.value = skills.value + skill
                WsEvent.SkillCreated(skill)
            }

            "skill:updated" -> {
                val skill = parseSkillConfig(data?.optJSONObject("skill") ?: return)
                skills.value = skills.value.map { if (it.id == skill.id) skill else it }
                WsEvent.SkillUpdated(skill)
            }

            "skill:deleted" -> {
                val id = data?.optString("id") ?: ""
                skills.value = skills.value.filter { it.id != id }
                WsEvent.SkillDeleted(id)
            }

            "skill:duplicated" -> WsEvent.SkillDuplicated(
                skill = data?.optJSONObject("skill")?.let { parseSkillConfig(it) }
            )

            "skill:exported" -> WsEvent.SkillExported(
                skill = data?.optJSONObject("skill")?.let { parseSkillConfig(it) }
            )

            "skill:agent-links" -> {
                val agentId = data?.optString("agentId") ?: ""
                val arr = data?.optJSONArray("links") ?: JSONArray()
                val links = (0 until arr.length()).map { i ->
                    val link = arr.getJSONObject(i)
                    SkillAgentLink(
                        skillId = link.optString("skill_id"),
                        sortOrder = link.optInt("sort_order", 0),
                    )
                }
                WsEvent.SkillAgentLinks(agentId, links)
            }

            "skill:agent-usage" -> {
                val arr = data?.optJSONArray("usage") ?: JSONArray()
                val usage = (0 until arr.length()).map { i ->
                    val row = arr.getJSONObject(i)
                    SkillAgentUsage(
                        skillId = row.optString("skill_id"),
                        agentCount = row.optInt("agent_count", 0),
                    )
                }
                skillAgentUsage.value = usage.associate { it.skillId to it.agentCount }
                WsEvent.SkillAgentUsageList(usage = usage)
            }

            "artifact:list" -> {
                val arr = data?.optJSONArray("artifacts") ?: return
                val list = (0 until arr.length()).map { i ->
                    val a = arr.getJSONObject(i)
                    ArtifactSummary(
                        id = a.optString("id"),
                        projectId = a.nullableString("projectId"),
                        title = a.optString("title"),
                        kind = a.optString("kind"),
                        description = a.nullableString("description"),
                        storageRoot = a.nullableString("storageRoot"),
                        status = a.optString("status"),
                        currentVersionId = a.nullableString("currentVersionId"),
                        createdAt = a.optLong("createdAt", 0L),
                        updatedAt = a.optLong("updatedAt", 0L),
                    )
                }
                artifacts.value = list
                WsEvent.ArtifactList(list)
            }

            "artifact:detail" -> {
                val a = data?.optJSONObject("artifact")
                // A null detail means the artifact has been deleted. Keep the requested ID so
                // each inline chat reference can correlate that response with its own lookup.
                val artifactId = data?.optString("artifactId")?.takeIf { it.isNotBlank() }
                    ?: a?.optString("id").orEmpty()
                if (a == null) {
                    WsEvent.ArtifactDetail(artifactId = artifactId, artifact = null)
                } else {
                    val cvObj = a.optJSONObject("currentVersion")
                    val currentVersion = cvObj?.let {
                        val filesArr = it.optJSONArray("files") ?: org.json.JSONArray()
                        ArtifactVersionSummary(
                            id = it.optString("id"),
                            artifactId = it.optString("artifactId"),
                            versionNumber = it.optInt("versionNumber", 1),
                            title = it.optString("title"),
                            notes = it.nullableString("notes"),
                            createdAt = it.optLong("createdAt", 0L),
                            files = (0 until filesArr.length()).map { fi ->
                                val f = filesArr.getJSONObject(fi)
                                ArtifactVersionFile(
                                    id = f.optString("id"),
                                    relativePath = f.optString("relativePath"),
                                    absolutePath = f.nullableString("absolutePath"),
                                    mediaType = f.optString("mediaType"),
                                    role = f.optString("role"),
                                )
                            },
                        )
                    }
                    WsEvent.ArtifactDetail(
                        artifactId = artifactId,
                        artifact = ArtifactDetail2(
                            id = a.optString("id"),
                            projectId = a.nullableString("projectId"),
                            title = a.optString("title"),
                            kind = a.optString("kind"),
                            description = a.nullableString("description"),
                            storageRoot = a.nullableString("storageRoot"),
                            status = a.optString("status"),
                            currentVersionId = a.nullableString("currentVersionId"),
                            createdAt = a.optLong("createdAt", 0L),
                            updatedAt = a.optLong("updatedAt", 0L),
                            currentVersion = currentVersion,
                        ),
                    )
                }
            }

            "artifact:versions" -> {
                val artifactId = data?.optString("artifactId") ?: ""
                val arr = data?.optJSONArray("versions") ?: org.json.JSONArray()
                WsEvent.ArtifactVersions(
                    artifactId = artifactId,
                    versions = (0 until arr.length()).map { i -> parseArtifactVersion(arr.getJSONObject(i)) },
                )
            }

            "artifact:deleted" -> WsEvent.ArtifactDeleted(
                id = data?.optString("id") ?: "",
                deleted = data?.optBoolean("deleted", false) ?: false,
            )

            "artifact:version-deleted" -> WsEvent.ArtifactVersionDeleted(
                versionId = data?.optString("versionId") ?: "",
                deleted = data?.optBoolean("deleted", false) ?: false,
                artifactId = data?.nullableString("artifactId"),
            )

            "artifact:version-delete-error" -> WsEvent.ArtifactVersionDeleteError(
                message = data?.optString("message") ?: "Failed to delete version",
            )

            "chat:active-turn-snapshot" -> {
                val snapshot = data?.optJSONObject("snapshot")
                if (snapshot == null) {
                    WsEvent.ChatActiveTurnSnapshot(
                        conversationId = data?.optString("conversationId") ?: "",
                        turnId = "",
                        latestSequence = 0L,
                        assistantText = "",
                        status = "completed",
                    )
                } else {
                    val toolCallsJson = snapshot.optJSONArray("toolCalls")
                    val toolCalls = mutableListOf<WsEvent.ActiveTurnToolCall>()
                    if (toolCallsJson != null) {
                        for (i in 0 until toolCallsJson.length()) {
                            val tc = toolCallsJson.optJSONObject(i) ?: continue
                            toolCalls.add(
                                WsEvent.ActiveTurnToolCall(
                                    id = tc.nullableString("id"),
                                    toolName = tc.optString("toolName", "Tool call"),
                                    serverName = tc.nullableString("serverName"),
                                    argsJson = tc.optJSONObject("args")?.toString(),
                                    result = tc.optString("result"),
                                    success = tc.optBoolean("success", true),
                                    inProgress = tc.optBoolean("inProgress", false),
                                ),
                            )
                        }
                    }
                    val activityJson = snapshot.optJSONObject("activity")
                    val activity = activityJson?.let {
                        WsEvent.ActiveTurnActivity(
                            state = it.optString("state", "thinking"),
                            label = it.optString("label", "Assistant is thinking"),
                            toolName = it.nullableString("toolName"),
                            serverName = it.nullableString("serverName"),
                        )
                    }
                    // The full sequence-ordered event replay for this turn, in the same
                    // flattened shape a live "chat:turn-event" message uses (each element's
                    // own toString() becomes that event's payloadJson) — lets a re-entering
                    // client rebuild true chronological order via reduceChatTurn instead of
                    // relying on the flattened toolCalls/assistantText buckets above.
                    val eventsJson = snapshot.optJSONArray("events")
                    val events = mutableListOf<WsEvent.ChatTurnEvent>()
                    if (eventsJson != null) {
                        for (i in 0 until eventsJson.length()) {
                            val ev = eventsJson.optJSONObject(i) ?: continue
                            events.add(
                                WsEvent.ChatTurnEvent(
                                    conversationId = ev.optString("conversationId"),
                                    turnId = ev.optString("turnId"),
                                    sequence = ev.optLong("sequence", 0L),
                                    type = ev.optString("type"),
                                    timestamp = ev.optLong("timestamp", 0L),
                                    payloadJson = ev.toString(),
                                ),
                            )
                        }
                    }
                    WsEvent.ChatActiveTurnSnapshot(
                        conversationId = snapshot.optString("conversationId"),
                        turnId = snapshot.optString("turnId"),
                        latestSequence = snapshot.optLong("latestSequence"),
                        assistantText = snapshot.optString("assistantText"),
                        status = snapshot.optString("status", "active"),
                        toolCalls = toolCalls,
                        activity = activity,
                        events = events,
                    )
                }
            }

            "artifact:promoted" -> WsEvent.ArtifactPromoted(
                artifactId = data?.optString("artifactId") ?: "",
                versionId = data?.optString("versionId") ?: "",
                title = data?.optString("title") ?: "",
                messageId = data?.nullableString("messageId"),
            )

            "artifact:promote-error" -> WsEvent.ArtifactPromoteError(
                message = data?.optString("message") ?: "Artifact promotion failed",
                messageId = data?.nullableString("messageId"),
            )

            "artifact:export-pack" -> {
                val versionId = data?.optString("versionId") ?: ""
                val arr = data?.optJSONArray("files") ?: org.json.JSONArray()
                val files = (0 until arr.length()).map { i ->
                    val f = arr.getJSONObject(i)
                    ArtifactExportFile(
                        relativePath = f.optString("relativePath"),
                        mediaType = f.optString("mediaType"),
                        contentBase64 = f.optString("contentBase64"),
                    )
                }
                WsEvent.ArtifactExportPack(versionId, files)
            }

            "artifact:export-error" -> {
                WsEvent.ArtifactExportError(data?.optString("message") ?: "Export failed")
            }

            "wiki:list" -> {
                val arr = data?.optJSONArray("entries") ?: return
                val list = (0 until arr.length()).map { i -> parseWikiEntry(arr.getJSONObject(i)) }
                wikiEntries.value = list
                WsEvent.WikiList(list)
            }

            "wiki:entry-created" -> {
                val entry = parseWikiEntry(data?.optJSONObject("entry") ?: return)
                wikiEntries.value = wikiEntries.value + entry
                WsEvent.WikiEntryCreated(entry)
            }

            "wiki:entry-updated" -> {
                val entry = parseWikiEntry(data?.optJSONObject("entry") ?: return)
                wikiEntries.value = wikiEntries.value.map { if (it.id == entry.id) entry else it }
                WsEvent.WikiEntryUpdated(entry)
            }

            "wiki:entry-deleted" -> {
                val id = data?.optString("id") ?: ""
                wikiEntries.value = wikiEntries.value.filter { it.id != id }
                WsEvent.WikiEntryDeleted(id)
            }

            "prompt:list" -> {
                val arr = data?.optJSONArray("entries") ?: return
                val list = (0 until arr.length()).map { i -> parsePromptEntry(arr.getJSONObject(i)) }
                promptEntries.value = list
                WsEvent.PromptList(list)
            }

            "prompt:versions" -> {
                val promptId = data?.optString("promptId") ?: ""
                val arr = data?.optJSONArray("versions") ?: JSONArray()
                val versions = (0 until arr.length()).map { i -> parsePromptVersion(arr.getJSONObject(i)) }
                WsEvent.PromptVersions(promptId, versions)
            }

            "prompt:entry-created" -> {
                val entry = parsePromptEntry(data?.optJSONObject("entry") ?: return)
                promptEntries.value = promptEntries.value + entry
                WsEvent.PromptEntryCreated(entry)
            }

            "prompt:entry-updated" -> {
                val entry = parsePromptEntry(data?.optJSONObject("entry") ?: return)
                promptEntries.value = promptEntries.value.map { if (it.id == entry.id) entry else it }
                WsEvent.PromptEntryUpdated(entry)
            }

            "prompt:entry-deleted" -> {
                val id = data?.optString("id") ?: ""
                promptEntries.value = promptEntries.value.filter { it.id != id }
                WsEvent.PromptEntryDeleted(id)
            }

            "prompt:error" -> WsEvent.PromptError(
                message = data?.optString("message") ?: "Prompt operation failed"
            )

            "conversation:export-pack" -> {
                val p = data?.optJSONObject("pack") ?: return
                WsEvent.ConversationExportPackResult(
                    ConversationExportPackData(
                        format = p.optString("format"),
                        conversationId = p.optString("conversation_id"),
                        fileName = p.optString("file_name"),
                        mimeType = p.optString("mime_type"),
                        content = p.optString("content"),
                    )
                )
            }

            "conversation:export-error" -> WsEvent.ConversationExportError(
                message = data?.optString("message") ?: "Export failed"
            )

            "conversation:forked" -> WsEvent.ConversationForked(
                conversationId = data?.optString("conversationId") ?: "",
                title = data?.optString("title") ?: "",
                messageCount = data?.optInt("messageCount", 0) ?: 0,
                projectId = data?.nullableString("projectId"),
            )

            "conversation:fork-error" -> WsEvent.ConversationForkError(
                message = data?.optString("message") ?: "Fork failed"
            )

            "conversation:imported" -> WsEvent.ConversationImported(
                conversationId = data?.optString("conversationId") ?: "",
                title = data?.optString("title") ?: "",
                messageCount = data?.optInt("messageCount", 0) ?: 0,
            )

            "conversation:import-error" -> WsEvent.ConversationImportError(
                message = data?.optString("message") ?: "Import failed"
            )

            "project-generator:token" -> WsEvent.ProjectGeneratorToken(
                sessionId = data?.nullableString("sessionId"),
                chunk = data?.optString("chunk") ?: "",
            )

            "project-generator:turn-complete" -> WsEvent.ProjectGeneratorTurnComplete(
                sessionId = data?.nullableString("sessionId"),
                content = data?.optString("content") ?: "",
                hasSpec = data?.optBoolean("hasSpec", false) ?: false,
            )

            "project-generator:spec-ready" -> {
                val specData = data?.optJSONObject("spec") ?: data
                val spec = parseProjectGeneratorSpec(specData) ?: return
                WsEvent.ProjectGeneratorSpecReady(data?.nullableString("sessionId"), spec)
            }

            "project-generator:created" -> WsEvent.ProjectGeneratorCreated(
                sessionId = data?.nullableString("sessionId"),
                projectId = data?.optString("projectId") ?: "",
                name = data?.optString("name") ?: "",
            )

            "project-generator:error" -> WsEvent.ProjectGeneratorError(
                sessionId = data?.nullableString("sessionId"),
                message = data?.optString("message") ?: "Unknown error",
            )

            "project-generator:cancelled" -> WsEvent.ProjectGeneratorCancelled(data?.nullableString("sessionId"))

            "project:config-updated" -> {
                val id = data?.optString("id") ?: ""
                data?.optJSONObject("config")?.let { config ->
                    val defaultModel = config.nullableString("defaultModel")
                    val defaultThinkingEffort = config.nullableString("defaultThinkingEffort")?.takeIf {
                        it in setOf("low", "medium", "high", "max", "disabled")
                    }
                    projects.value = projects.value.map { project ->
                        if (project.id == id) project.copy(defaultModel = defaultModel, projectHermesProfile = config.nullableString("projectHermesProfile"), defaultThinkingEffort = defaultThinkingEffort) else project
                    }
                }
                WsEvent.ProjectConfigUpdated(id = id)
            }

            "project:config-changed" -> {
                val id = data?.optString("id") ?: ""
                // A few older desktop handlers broadcast a settings-only config object. Do not
                // turn its absent hierarchy into empty lists: that would erase Android's visible
                // source cards. Only expose a config when both hierarchy arrays are present.
                val configObject = data?.optJSONObject("config")
                val defaultModel = configObject?.nullableString("defaultModel")
                val defaultThinkingEffort = configObject?.nullableString("defaultThinkingEffort")?.takeIf {
                    it in setOf("low", "medium", "high", "max", "disabled")
                }
                val config = configObject
                    ?.takeIf { it.has("sources") && it.has("repositories") }
                    ?.let(::parseProjectSettingsConfig)
                if (configObject != null) {
                    projects.value = projects.value.map { project ->
                        if (project.id == id) project.copy(defaultModel = defaultModel, projectHermesProfile = configObject.nullableString("projectHermesProfile"), defaultThinkingEffort = defaultThinkingEffort) else project
                    }
                }
                WsEvent.ProjectConfigChanged(id = id, config = config)
            }

            "project:config" -> {
                val c = data?.optJSONObject("config") ?: JSONObject()
                WsEvent.ProjectConfig(
                    id = data?.optString("id") ?: "",
                    config = parseProjectSettingsConfig(c),
                )
            }

            "project:sources-updated" -> {
                val c = data?.optJSONObject("config") ?: JSONObject()
                WsEvent.ProjectSourcesUpdated(
                    id = data?.optString("id") ?: "",
                    action = data?.optString("action") ?: "rescan",
                    config = parseProjectSettingsConfig(c),
                )
            }

            "project:sources-error" -> WsEvent.ProjectSourcesError(
                id = data?.optString("id") ?: "",
                action = data?.optString("action") ?: "rescan",
                message = data?.optString("message") ?: "Could not update project sources",
            )

            "project:agents" -> {
                val id = data?.optString("id") ?: ""
                val arr = data?.optJSONArray("agents") ?: JSONArray()
                val agents = (0 until arr.length()).map { i ->
                    val a = arr.optJSONObject(i) ?: JSONObject()
                    ProjectAgentEntry(
                        agentId = a.optString("agentId"),
                        agentName = a.optString("agentName"),
                        agentIcon = a.optString("agentIcon"),
                        isPrimary = a.optBoolean("isPrimary", false),
                        sortOrder = a.optInt("sortOrder", 0),
                    )
                }
                WsEvent.ProjectAgents(id = id, agents = agents)
            }

            "project-audit:sessions" -> {
                val projectId = data?.nullableString("projectId")
                val arr = data?.optJSONArray("sessions") ?: JSONArray()
                val sessions = (0 until arr.length()).map { i ->
                    val item = arr.optJSONObject(i) ?: JSONObject()
                    ProjectAuditSession(
                        id = item.optString("id"),
                        projectId = item.optString("projectId"),
                        conversationId = item.nullableString("conversationId"),
                        agentId = item.nullableString("agentId"),
                        title = item.optString("title"),
                        source = item.optString("source"),
                        createdAt = item.optLong("createdAt", 0L),
                        updatedAt = item.optLong("updatedAt", 0L),
                        fileCount = item.optInt("fileCount", 0),
                    )
                }
                WsEvent.ProjectAuditSessions(projectId = projectId, sessions = sessions)
            }

            "project-audit:files" -> {
                val sessionId = data?.optString("sessionId") ?: ""
                val arr = data?.optJSONArray("files") ?: JSONArray()
                val files = (0 until arr.length()).map { i ->
                    val item = arr.optJSONObject(i) ?: JSONObject()
                    ProjectAuditFile(
                        id = item.optString("id"),
                        sessionId = item.optString("sessionId"),
                        sourceId = item.nullableString("sourceId"),
                        sourceLabel = item.nullableString("sourceLabel"),
                        repositoryId = item.nullableString("repositoryId"),
                        repositoryLabel = item.nullableString("repositoryLabel"),
                        repositoryAvailable = if (item.isNull("repositoryAvailable")) null else item.optBoolean("repositoryAvailable"),
                        relativePath = item.optString("relativePath"),
                        displayPath = item.optString("displayPath", item.optString("relativePath")),
                        status = item.optString("status"),
                        lastOperation = item.optString("lastOperation"),
                        branch = item.nullableString("branch"),
                        commitHash = item.nullableString("commitHash"),
                        legacyRepositoryUnknown = item.optBoolean("legacyRepositoryUnknown", false),
                        firstTouchedAt = item.optLong("firstTouchedAt", 0L),
                        lastTouchedAt = item.optLong("lastTouchedAt", 0L),
                        diffAvailable = item.optBoolean("diffAvailable", false),
                    )
                }
                WsEvent.ProjectAuditFiles(sessionId = sessionId, files = files)
            }

            "project-audit:diff" -> {
                val sessionId = data?.optString("sessionId") ?: ""
                val diffObj = data?.optJSONObject("diff")
                WsEvent.ProjectAuditDiffLoaded(
                    sessionId = sessionId,
                    fileId = data?.nullableString("fileId"),
                    diff = diffObj?.let {
                        ProjectAuditDiff(
                            fileId = data?.nullableString("fileId"),
                            relativePath = it.optString("relativePath"),
                            hunksJson = it.optJSONArray("hunks")?.toString(),
                        )
                    },
                )
            }

            "project-generator:model" -> WsEvent.ProjectGeneratorModel(
                sessionId = data?.nullableString("sessionId"),
                modelId = data?.optString("modelId") ?: "",
            )

            "skill-generator:model" -> WsEvent.SkillGeneratorModel(
                sessionId = data?.nullableString("sessionId"),
                modelId = data?.optString("modelId") ?: "",
            )

            "artifact-generator:model" -> WsEvent.ArtifactGeneratorModel(
                sessionId = data?.nullableString("sessionId"),
                modelId = data?.optString("modelId") ?: "",
            )

            "agent-generator:model" -> WsEvent.AgentGeneratorModel(
                sessionId = data?.nullableString("sessionId"),
                modelId = data?.optString("modelId") ?: "",
            )

            "agent-generator:token" -> WsEvent.AgentGeneratorToken(
                sessionId = data?.nullableString("sessionId"),
                chunk = data?.optString("chunk") ?: "",
            )

            "agent-generator:turn-complete" -> WsEvent.AgentGeneratorTurnComplete(
                sessionId = data?.nullableString("sessionId"),
                content = data?.optString("content") ?: "",
                hasSpec = data?.optBoolean("hasSpec", false) ?: false,
            )

            "agent-generator:spec-ready" -> {
                val specData = data?.optJSONObject("spec") ?: data
                val spec = parseAgentGeneratorSpec(specData) ?: return
                WsEvent.AgentGeneratorSpecReady(data?.nullableString("sessionId"), spec)
            }

            "agent-generator:created" -> WsEvent.AgentGeneratorCreated(
                sessionId = data?.nullableString("sessionId"),
                agentId = data?.optString("agentId") ?: "",
                name = data?.optString("name") ?: "",
            )

            "agent-generator:error" -> WsEvent.AgentGeneratorError(
                sessionId = data?.nullableString("sessionId"),
                message = data?.optString("message") ?: "Unknown error",
            )

            "agent-generator:cancelled" -> WsEvent.AgentGeneratorCancelled(data?.nullableString("sessionId"))

            "artifact-generator:token" -> WsEvent.ArtifactGeneratorToken(
                sessionId = data?.nullableString("sessionId"),
                chunk = data?.optString("chunk") ?: "",
            )

            "artifact-generator:turn-complete" -> WsEvent.ArtifactGeneratorTurnComplete(
                sessionId = data?.nullableString("sessionId"),
                content = data?.optString("content") ?: "",
                hasSpec = data?.optBoolean("hasSpec", false) ?: false,
            )

            "artifact-generator:spec-ready" -> {
                val specData = data?.optJSONObject("spec") ?: data
                val spec = parseArtifactGeneratorSpec(specData) ?: return
                WsEvent.ArtifactGeneratorSpecReady(data?.nullableString("sessionId"), spec)
            }

            "artifact-generator:created" -> WsEvent.ArtifactGeneratorCreated(
                sessionId = data?.nullableString("sessionId"),
                artifactId = data?.optString("artifactId") ?: "",
                title = data?.optString("title") ?: "",
            )

            "artifact-generator:error" -> WsEvent.ArtifactGeneratorError(
                sessionId = data?.nullableString("sessionId"),
                message = data?.optString("message") ?: "Unknown error",
            )

            "artifact-generator:cancelled" -> WsEvent.ArtifactGeneratorCancelled(data?.nullableString("sessionId"))

            "artifact:moved-to-project" -> WsEvent.ArtifactMovedToProject(
                artifactId = data?.optString("artifactId") ?: "",
                projectId = data?.nullableString("projectId"),
            )

            "skill-generator:token" -> WsEvent.SkillGeneratorToken(
                sessionId = data?.nullableString("sessionId"),
                chunk = data?.optString("chunk") ?: "",
            )

            "skill-generator:turn-complete" -> WsEvent.SkillGeneratorTurnComplete(
                sessionId = data?.nullableString("sessionId"),
                content = data?.optString("content") ?: "",
                hasSpec = data?.optBoolean("hasSpec", false) ?: false,
            )

            "skill-generator:spec-ready" -> {
                val specData = data?.optJSONObject("spec") ?: data
                val spec = parseSkillGeneratorSpec(specData) ?: return
                WsEvent.SkillGeneratorSpecReady(data?.nullableString("sessionId"), spec)
            }

            "skill-generator:created" -> WsEvent.SkillGeneratorCreated(
                sessionId = data?.nullableString("sessionId"),
                skillId = data?.optString("skillId") ?: "",
                name = data?.optString("name") ?: "",
            )

            "skill-generator:error" -> WsEvent.SkillGeneratorError(
                sessionId = data?.nullableString("sessionId"),
                message = data?.optString("message") ?: "Unknown error",
            )

            "skill-generator:cancelled" -> WsEvent.SkillGeneratorCancelled(data?.nullableString("sessionId"))

            "scheduler-generator:model" -> WsEvent.SchedulerGeneratorModel(
                sessionId = data?.nullableString("sessionId"),
                modelId = data?.optString("modelId") ?: "",
            )

            "scheduler-generator:token" -> WsEvent.SchedulerGeneratorToken(
                sessionId = data?.nullableString("sessionId"),
                chunk = data?.optString("chunk") ?: "",
            )

            "scheduler-generator:turn-complete" -> WsEvent.SchedulerGeneratorTurnComplete(
                sessionId = data?.nullableString("sessionId"),
                content = data?.optString("content") ?: "",
                hasSpec = data?.optBoolean("hasSpec", false) ?: false,
            )

            "scheduler-generator:spec-ready" -> {
                val specData = data?.optJSONObject("spec") ?: data
                val spec = parseScheduleGeneratorSpec(specData) ?: return
                WsEvent.SchedulerGeneratorSpecReady(data?.nullableString("sessionId"), spec)
            }

            "scheduler-generator:created" -> WsEvent.SchedulerGeneratorCreated(
                sessionId = data?.nullableString("sessionId"),
                taskId = data?.optString("taskId") ?: "",
                name = data?.optString("name") ?: "",
            )

            "scheduler-generator:error" -> WsEvent.SchedulerGeneratorError(
                sessionId = data?.nullableString("sessionId"),
                message = data?.optString("message") ?: "Unknown error",
            )

            "scheduler-generator:cancelled" -> WsEvent.SchedulerGeneratorCancelled(data?.nullableString("sessionId"))

            "provider:azure-endpoint" -> WsEvent.ProviderAzureEndpoint(
                endpoint = data?.optString("endpoint") ?: "",
            )

            "provider:azure-endpoint-set" -> WsEvent.ProviderAzureEndpointSet(
                endpoint = data?.optString("endpoint") ?: "",
            )

            "provider:test-result" -> WsEvent.ProviderTestResult(
                provider = data?.optString("provider") ?: "",
                valid = data?.optBoolean("valid", false) ?: false,
                error = data?.nullableString("error"),
            )

            "agent:knowledge-files" -> {
                val agentId = data?.optString("agentId") ?: ""
                val arr = data?.optJSONArray("files") ?: JSONArray()
                val files = (0 until arr.length()).mapNotNull { i ->
                    val f = arr.optJSONObject(i) ?: return@mapNotNull null
                    AgentKnowledgeFile(
                        id = f.optString("id"),
                        agentId = f.optString("agent_id"),
                        filePath = f.optString("file_path"),
                        injectMode = f.optString("inject_mode", "always"),
                        sortOrder = f.optInt("sort_order", 0),
                        createdAt = f.optLong("created_at", 0L),
                        updatedAt = f.optLong("updated_at", 0L),
                    )
                }
                WsEvent.AgentKnowledgeFiles(agentId, files)
            }

            "agent:knowledge-file-added" -> {
                val agentId = data?.optString("agentId") ?: ""
                val f = data?.optJSONObject("file")
                if (f != null) {
                    WsEvent.AgentKnowledgeFileAdded(
                        agentId = agentId,
                        file = AgentKnowledgeFile(
                            id = f.optString("id"),
                            agentId = f.optString("agent_id"),
                            filePath = f.optString("file_path"),
                            injectMode = f.optString("inject_mode", "always"),
                            sortOrder = f.optInt("sort_order", 0),
                            createdAt = f.optLong("created_at", 0L),
                            updatedAt = f.optLong("updated_at", 0L),
                        ),
                    )
                } else return
            }

            "agent:knowledge-file-removed" -> {
                val agentId = data?.optString("agentId") ?: ""
                val id = data?.optString("id") ?: ""
                WsEvent.AgentKnowledgeFileRemoved(agentId, id)
            }

            "agent:knowledge-file-content" -> {
                val agentId = data?.optString("agentId") ?: ""
                val filePath = data?.optString("filePath") ?: ""
                val content = data?.optString("content") ?: ""
                WsEvent.AgentKnowledgeFileContent(agentId, filePath, content)
            }

            "agent:knowledge-file-saved" -> {
                val agentId = data?.optString("agentId") ?: ""
                val filePath = data?.optString("filePath") ?: ""
                WsEvent.AgentKnowledgeFileSaved(agentId, filePath)
            }

            "agent:knowledge-file-error" -> {
                WsEvent.AgentKnowledgeFileError(data?.optString("message") ?: "Unknown error")
            }

            "agent:mcp-tool-overrides" -> {
                val agentId = data?.optString("agentId") ?: ""
                val arr = data?.optJSONArray("overrides") ?: JSONArray()
                val overrides = (0 until arr.length()).mapNotNull { i ->
                    val o = arr.optJSONObject(i) ?: return@mapNotNull null
                    AgentMcpToolOverride(
                        agentId = agentId,
                        serverId = o.optString("server_id"),
                        toolName = o.optString("tool_name"),
                        enabled = o.optInt("enabled", 1) != 0,
                        approval = o.optString("approval", "always-ask"),
                        instructions = o.optString("instructions", ""),
                    )
                }
                WsEvent.AgentMcpToolOverrides(agentId, overrides)
            }

            "agent:mcp-server-trust" -> {
                val agentId = data?.optString("agentId") ?: ""
                val arr = data?.optJSONArray("trust") ?: JSONArray()
                val trust = (0 until arr.length()).mapNotNull { i ->
                    val t = arr.optJSONObject(i) ?: return@mapNotNull null
                    AgentMcpServerTrust(
                        serverId = t.optString("server_id"),
                        trust = t.optString("trust", "auto"),
                    )
                }
                WsEvent.AgentMcpServerTrustList(agentId, trust)
            }

            "build:records" -> {
                val arr = data?.optJSONArray("records") ?: JSONArray()
                val list = (0 until arr.length()).map { i ->
                    val r = arr.getJSONObject(i)
                    val pathsArr = r.optJSONArray("artifactPaths") ?: JSONArray()
                    BuildRecord(
                        id = r.optString("id"),
                        workspacePath = r.optString("workspacePath"),
                        commitSha = r.nullableString("commitSha"),
                        branch = r.nullableString("branch"),
                        version = r.nullableString("version"),
                        versionCode = if (r.isNull("versionCode")) null else r.optInt("versionCode"),
                        platform = r.optString("platform"),
                        command = r.optString("command"),
                        status = r.optString("status"),
                        exitCode = if (r.isNull("exitCode")) null else r.optInt("exitCode"),
                        artifactPaths = (0 until pathsArr.length()).map { pathsArr.optString(it) },
                        logTail = r.optString("logTail", ""),
                        startedAt = r.optLong("startedAt", 0L),
                        finishedAt = if (r.isNull("finishedAt")) null else r.optLong("finishedAt"),
                    )
                }
                WsEvent.BuildRecords(list)
            }

            "build:workspace-info" -> WsEvent.BuildWorkspaceInfo(
                path = data?.optString("path") ?: "",
                branch = data?.nullableString("branch"),
                commitSha = data?.nullableString("commitSha"),
                dirty = data?.optBoolean("dirty", false) ?: false,
                version = data?.nullableString("version"),
                isGitRepo = data?.optBoolean("isGitRepo", false) ?: false,
            )

            "build:preflight-result" -> {
                val arr = data?.optJSONArray("checks") ?: JSONArray()
                WsEvent.BuildPreflightResult((0 until arr.length()).map { i ->
                    val c = arr.getJSONObject(i)
                    PreflightCheck(label = c.optString("label"), status = c.optString("status"), detail = c.optString("detail"))
                })
            }

            "build:started" -> WsEvent.BuildStarted(
                buildId = data?.optString("buildId") ?: "",
                command = data?.optString("command") ?: "",
            )

            "build:log-chunk" -> WsEvent.BuildLogChunk(
                buildId = data?.optString("buildId") ?: "",
                line = data?.optString("line") ?: "",
                stream = data?.optString("stream") ?: "stdout",
                replace = data?.optBoolean("replace", false) ?: false,
            )

            "build:command-done" -> WsEvent.BuildCommandDone(
                buildId = data?.nullableString("buildId"),
                status = data?.optString("status") ?: "failed",
                exitCode = if (data?.isNull("exitCode") != false) null else data.optInt("exitCode"),
                error = data?.nullableString("error"),
            )

            "build:cancelled" -> WsEvent.BuildCancelled(
                buildId = data?.optString("buildId") ?: "",
                cancelled = data?.optBoolean("cancelled", false) ?: false,
            )

            "update:restarting" -> WsEvent.UpdateRestarting(
                eta = data?.optInt("eta") ?: 10,
                version = data?.nullableString("version"),
                error = data?.nullableString("error"),
            )

            "android:workspace-info" -> WsEvent.AndroidWorkspaceInfo(
                path = data?.optString("path") ?: "",
                branch = data?.nullableString("branch"),
                commitSha = data?.nullableString("commitSha"),
                dirty = data?.optBoolean("dirty", false) ?: false,
                versionCode = if (data?.isNull("versionCode") != false) null else data.optInt("versionCode"),
                versionName = data?.nullableString("versionName"),
                isGitRepo = data?.optBoolean("isGitRepo", false) ?: false,
                hasGradleProject = data?.optBoolean("hasGradleProject", false) ?: false,
            )

            "android:signing-validation" -> {
                val arr = data?.optJSONArray("checks") ?: JSONArray()
                WsEvent.AndroidSigningValidation(
                    valid = data?.optBoolean("valid", false) ?: false,
                    checks = (0 until arr.length()).map { i ->
                        val c = arr.getJSONObject(i)
                        PreflightCheck(label = c.optString("label"), status = c.optString("status"), detail = c.optString("detail"))
                    }
                )
            }

            "android:publish-result" -> WsEvent.AndroidPublishResult(
                published = data?.optBoolean("published", false) ?: false,
                error = data?.nullableString("error"),
                manifest = data?.optJSONObject("manifest")?.let { parseAndroidPublishManifest(it) },
            )

            "android:restore-result" -> WsEvent.AndroidRestoreResult(
                restored = data?.optBoolean("restored", false) ?: false,
                error = data?.nullableString("error"),
                manifest = data?.optJSONObject("manifest")?.let { parseAndroidPublishManifest(it) },
            )

            // ── Scheduler ──────────────────────────────────────────────────
            "scheduler:list" -> {
                val arr = data?.optJSONArray("tasks") ?: return
                val tasks = (0 until arr.length()).map { parseScheduledTask(arr.getJSONObject(it)) }
                scheduledTasks.value = tasks
                WsEvent.SchedulerTaskList(tasks)
            }

            "scheduler:get" -> {
                val taskObj = data?.optJSONObject("task") ?: return
                val task = parseScheduledTask(taskObj)
                scheduledTasks.value = scheduledTasks.value
                    .map { if (it.id == task.id) task else it }
                    .let { list -> if (list.none { it.id == task.id }) list + task else list }
                WsEvent.SchedulerTaskUpdated(task)
            }

            "scheduler:task-updated" -> {
                val taskObj = data?.optJSONObject("task") ?: return
                val task = parseScheduledTask(taskObj)
                scheduledTasks.value = scheduledTasks.value
                    .map { if (it.id == task.id) task else it }
                    .let { list -> if (list.none { it.id == task.id }) list + task else list }
                WsEvent.SchedulerTaskUpdated(task)
            }

            "scheduler:task-deleted" -> {
                val taskId = data?.optString("taskId") ?: return
                scheduledTasks.value = scheduledTasks.value.filter { it.id != taskId }
                scheduledRuns.value = scheduledRuns.value - taskId
                WsEvent.SchedulerTaskDeleted(taskId)
            }

            "scheduler:run-updated" -> {
                val runObj = data?.optJSONObject("run") ?: return
                val run = parseScheduledRun(runObj)
                scheduledRuns.value = scheduledRuns.value.toMutableMap().apply {
                    val existing = getOrDefault(run.taskId, emptyList())
                    val updated = existing.map { if (it.id == run.id) run else it }
                    put(run.taskId, if (updated.none { it.id == run.id }) listOf(run) + updated else updated)
                }
                WsEvent.SchedulerRunUpdated(run)
            }

            "scheduler:runs" -> {
                val taskId = data?.optString("taskId") ?: return
                val arr = data.optJSONArray("runs") ?: return
                val runs = (0 until arr.length()).map { parseScheduledRun(arr.getJSONObject(it)) }
                scheduledRuns.value = scheduledRuns.value.toMutableMap().apply { put(taskId, runs) }
                WsEvent.SchedulerRunList(taskId, runs)
            }

            "scheduler:run-error" -> {
                val taskId = data?.optString("taskId") ?: return
                val errorMsg = data.optString("error")
                WsEvent.SchedulerRunError(taskId, errorMsg)
            }

            "scheduler:list-workflow-templates" -> {
                val arr = data?.optJSONArray("runs") ?: return
                val runs = (0 until arr.length()).map { parseAutomatedWorkflowRun(arr.getJSONObject(it)) }
                WsEvent.SchedulerWorkflowTemplates(runs)
            }

            "debrief:ready" -> {
                val debriefObj = data?.optJSONObject("debrief") ?: return
                val debrief = parseConversationDebrief(debriefObj)
                currentDebrief.value = debrief
                WsEvent.DebriefReady(
                    debrief,
                    artifactId = data.nullableString("artifactId"),
                    versionId = data.nullableString("versionId"),
                )
            }

            "debrief:loaded" -> {
                val debriefObj = data?.optJSONObject("debrief")
                val debrief = debriefObj?.let { parseConversationDebrief(it) }
                currentDebrief.value = debrief
                WsEvent.DebriefLoaded(data?.nullableString("conversationId"), debrief)
            }

            "debrief:error" -> WsEvent.DebriefError(data?.optString("message") ?: "Unknown error")

            "debrief:story-ready" -> {
                val conversationId = data?.optString("conversationId") ?: return
                val storyObj = data.optJSONObject("story") ?: return
                WsEvent.DebriefStoryReady(
                    conversationId = conversationId,
                    story = parseDebriefStory(storyObj),
                    artifactId = data.nullableString("artifactId"),
                    versionId = data.nullableString("versionId"),
                )
            }

            "debrief:story-error" -> WsEvent.DebriefStoryError(data?.optString("message") ?: "Unknown error")

            "debrief:conversation-completed" -> {
                val conversationId = data?.optString("conversationId") ?: return
                val completedAt = data.optLong("completedAt", 0L)
                completedConversationIds.value = completedConversationIds.value + conversationId
                WsEvent.DebriefConversationCompleted(conversationId, completedAt)
            }

            "debrief:conversation-incompleted" -> {
                val conversationId = data?.optString("conversationId") ?: return
                completedConversationIds.value = completedConversationIds.value - conversationId
                WsEvent.DebriefConversationIncompleted(conversationId)
            }

            "rating:updated" -> {
                val conversationId = data?.optString("conversationId") ?: return
                val rating = data.optJSONObject("rating")?.let { parseConversationRating(it) }
                currentRating.value = rating
                conversations.value = conversations.value.map {
                    if (it.id == conversationId) it.copy(rating = rating?.rating) else it
                }
                WsEvent.RatingUpdated(conversationId, rating)
            }

            "rating:loaded" -> {
                val conversationId = data?.optString("conversationId") ?: return
                val rating = data.optJSONObject("rating")?.let { parseConversationRating(it) }
                currentRating.value = rating
                WsEvent.RatingLoaded(conversationId, rating)
            }

            "rating:error" -> WsEvent.RatingError(data?.optString("message") ?: "Unknown error")

            "rating:list-loaded" -> {
                val arr = data?.optJSONArray("ratings") ?: return
                val list = (0 until arr.length()).map { parseConversationRatingListItem(arr.getJSONObject(it)) }
                ratingsList.value = list
                WsEvent.RatingListLoaded(list)
            }

            "rating:stats-loaded" -> {
                val statsObj = data?.optJSONObject("stats") ?: return
                val stats = parseConversationRatingStats(statsObj)
                ratingStats.value = stats
                WsEvent.RatingStatsLoaded(stats)
            }

            "quiz:ready" -> {
                val arr = data?.optJSONArray("questions") ?: return
                val questions = (0 until arr.length()).map { parseQuizQuestion(arr.getJSONObject(it)) }
                WsEvent.QuizReady(
                    questions,
                    artifactId = data.nullableString("artifactId"),
                    versionId = data.nullableString("versionId"),
                    conversationId = data.nullableString("conversationId"),
                )
            }

            "quiz:loaded" -> {
                val conversationId = data?.optString("conversationId") ?: return
                val arr = data.optJSONArray("questions")
                val questions = arr?.let { (0 until it.length()).map { i -> parseQuizQuestion(it.getJSONObject(i)) } }
                WsEvent.QuizLoaded(
                    conversationId,
                    questions,
                    artifactId = data.nullableString("artifactId"),
                    versionId = data.nullableString("versionId"),
                )
            }

            "quiz:error" -> WsEvent.QuizError(data?.optString("message") ?: "Unknown error")

            "teachback:ready" -> {
                val exercise = data?.optJSONObject("teachback") ?: return
                WsEvent.TeachbackReady(data.optString("conversationId"), data.optString("artifactId"), data.optString("versionId"), parseTeachbackExercise(exercise))
            }
            "teachback:loaded" -> {
                val conversationId = data?.optString("conversationId") ?: return
                WsEvent.TeachbackLoaded(conversationId, data.nullableString("artifactId"), data.nullableString("versionId"), data.optJSONObject("teachback")?.let(::parseTeachbackExercise))
            }
            "teachback:graded" -> {
                val feedback = data?.optJSONObject("feedback") ?: return
                WsEvent.TeachbackGraded(data.optString("artifactId"), data.optString("versionId"), parseTeachbackFeedback(feedback))
            }
            "teachback:attempts" -> {
                val artifactId = data?.optString("artifactId") ?: return
                val arr = data.optJSONArray("attempts")
                val attempts = arr?.let { (0 until it.length()).map { i -> parseTeachbackAttempt(it.getJSONObject(i)) } } ?: emptyList()
                WsEvent.TeachbackAttempts(artifactId, attempts)
            }
            "teachback:error" -> WsEvent.TeachbackError(data?.optString("message") ?: "Unknown error")

            "activity:changed" -> {
                val arr = data?.optJSONArray("activities")
                val list = arr?.let { array ->
                    (0 until array.length()).mapNotNull { i ->
                        val obj = array.optJSONObject(i) ?: return@mapNotNull null
                        val id = obj.optString("id")
                        val kind = obj.optString("kind")
                        val label = obj.optString("label")
                        val conversationId = obj.nullableString("conversationId")
                        val projectId = obj.nullableString("projectId")
                        val route = routeForServerActivity(id, kind, conversationId, projectId) ?: return@mapNotNull null
                        BackgroundActivity(
                            id = id,
                            label = label,
                            route = route,
                            conversationId = conversationId,
                            conversationTitle = obj.nullableString("conversationTitle"),
                            projectId = projectId,
                            projectName = obj.nullableString("projectName"),
                            agentId = obj.nullableString("agentId"),
                            agentName = obj.nullableString("agentName"),
                            model = obj.nullableString("model"),
                            detail = obj.nullableString("detail"),
                            startedAt = obj.optLong("startedAt").takeIf { obj.has("startedAt") },
                        )
                    }
                } ?: emptyList()
                BackgroundActivityTracker.applySnapshot(list)
                WsEvent.ActivityChanged(list)
            }

            "new-content:changed" -> {
                val arr = data?.optJSONArray("conversations")
                val conversations = arr?.let { array ->
                    (0 until array.length()).mapNotNull { i ->
                        val obj = array.optJSONObject(i) ?: return@mapNotNull null
                        val conversationId = obj.optString("conversationId")
                        if (conversationId.isBlank()) return@mapNotNull null
                        NewContentConversation(
                            conversationId = conversationId,
                            title = obj.optString("title", "Chat"),
                            projectId = obj.nullableString("projectId"),
                            projectName = obj.nullableString("projectName"),
                            agentId = obj.nullableString("agentId"),
                            agentName = obj.nullableString("agentName"),
                            preview = obj.nullableString("preview"),
                            newContentAt = obj.optLong("newContentAt"),
                        )
                    }
                } ?: emptyList()
                WsEvent.NewContentChanged(conversations)
            }

            "settings:value" -> {
                val key = data?.optString("key") ?: return
                val value = data.optString("value").takeIf { it.isNotEmpty() }
                WsEvent.SettingValue(key, value)
            }
            "provider:key-handoff-request" -> {
                // Desktop (ws-handlers.ts) sends only "provider" — no separate display name.
                val providerId = data?.optString("provider") ?: return
                WsEvent.ProviderKeyHandoffRequest(providerId, providerId)
            }
            "provider:key-handoff-value" -> {
                // Field names must match ws-handlers.ts's `reply({ event: 'provider:key-handoff-value', data: { provider, value } })`.
                val providerId = data?.optString("provider") ?: return
                val keyValue = data?.optString("value") ?: return
                WsEvent.ProviderKeyHandoffValue(providerId, keyValue)
            }
            "automated-workflow-generator:spec-ready" -> {
                val sessionId = data?.optString("sessionId") ?: return
                val spec = data.optJSONObject("spec") ?: return
                val title = spec.optString("title", "")
                val goalSummary = spec.optString("goalSummary", "")
                val assumptionsArr = spec.optJSONArray("assumptions") ?: JSONArray()
                val assumptions = (0 until assumptionsArr.length()).joinToString("\n") { assumptionsArr.getString(it) }
                val stepsArr = spec.optJSONArray("steps") ?: JSONArray()
                val steps = (0 until stepsArr.length()).map { i ->
                    val step = stepsArr.getJSONObject(i)
                    val projectBinding = step.optJSONArray("inputBindings")?.let { bindings ->
                        (0 until bindings.length()).mapNotNull { bindings.optJSONObject(it) }
                            .firstOrNull { it.optJSONObject("source")?.optString("type") == "project-files" }
                            ?.optJSONObject("source")
                    }
                    val deliverable = step.optJSONArray("deliverables")?.optJSONObject(0)
                    val reviewSource = step.optJSONObject("reviewSource")
                    val publishDestination = step.optJSONObject("publishDestination")
                    io.nexy.android.data.model.AutomatedWorkflowStepInfo(
                        id = step.optString("id", i.toString()),
                        title = step.optString("title", ""),
                        summary = step.optString("summary", ""),
                        agentName = step.optString("agentName").takeIf(String::isNotBlank),
                        prompt = step.optString("prompt", ""),
                        expectedOutput = step.optString("expectedOutput", ""),
                        model = step.optString("model").takeIf(String::isNotBlank),
                        kind = step.optString("kind").takeIf(String::isNotBlank),
                        projectSourceId = projectBinding?.nullableString("projectSourceId"),
                        includePaths = projectBinding?.optJSONArray("include")?.let { includes ->
                            (0 until includes.length()).map { includes.optString(it) }
                        } ?: emptyList(),
                        outputName = deliverable?.nullableString("name"),
                        reviewOutputName = reviewSource?.nullableString("outputName"),
                        publishProjectSourceId = publishDestination?.nullableString("projectSourceId"),
                        publishRelativePath = publishDestination?.nullableString("relativePath"),
                    )
                }
                WsEvent.AutomatedWorkflowReady(sessionId, title, goalSummary, assumptions, steps, rawSpec = jsonObjectToMap(spec))
            }
            "automated-workflow-generator:model" -> {
                val sessionId = data?.optString("sessionId") ?: return
                val modelId = data?.optString("modelId") ?: return
                WsEvent.AutomatedWorkflowModel(sessionId, modelId)
            }
            "automated-workflow-generator:token" -> {
                val sessionId = data?.optString("sessionId") ?: return
                val chunk = data.optString("chunk", "")
                WsEvent.AutomatedWorkflowToken(sessionId, chunk)
            }
            "automated-workflow-generator:turn-complete" -> {
                val sessionId = data?.optString("sessionId") ?: return
                val content = data.optString("content", "")
                WsEvent.AutomatedWorkflowMessage(sessionId, content)
            }
            "automated-workflow-generator:error" -> {
                val sessionId = data?.optString("sessionId") ?: return
                val message = data?.optString("message") ?: return
                WsEvent.AutomatedWorkflowError(sessionId, message)
            }
            "automated-workflow-generator:cancelled" -> {
                val sessionId = data?.optString("sessionId") ?: return
                WsEvent.AutomatedWorkflowCancelled(sessionId)
            }

            "automated-workflow-runs:list" -> {
                if (data == null) return
                // nullableString, not optString — a project-less listing's projectId is a real
                // JSON null, which optString would otherwise silently coerce to "".
                val projectId = data.nullableString("projectId")
                val arr = data.optJSONArray("runs") ?: JSONArray()
                val runs = (0 until arr.length()).map { parseAutomatedWorkflowRun(arr.getJSONObject(it)) }
                WsEvent.AutomatedWorkflowRunsList(projectId, runs)
            }

            "automated-workflow-runs:list-all" -> {
                val arr = data?.optJSONArray("runs") ?: return
                val runs = (0 until arr.length()).map { parseAutomatedWorkflowRun(arr.getJSONObject(it)) }
                WsEvent.AutomatedWorkflowRunsListAll(runs)
            }

            "automated-workflow-runs:detail" -> {
                val runObj = data?.optJSONObject("run")
                WsEvent.AutomatedWorkflowRunDetailReady(if (runObj != null) parseAutomatedWorkflowRun(runObj) else null)
            }

            "automated-workflow-runs:discarded" -> {
                val runId = data?.optString("runId") ?: return
                WsEvent.AutomatedWorkflowRunDiscarded(runId, data.optBoolean("ok", false))
            }

            "automated-workflow-runs:step-stream" -> {
                val runId = data?.optString("runId") ?: return
                val stepDbId = data.optString("stepDbId") ?: return
                val chunk = data.optString("chunk", "")
                WsEvent.AutomatedWorkflowStepStream(runId, stepDbId, chunk)
            }

            "automated-workflow-runs:error" -> {
                val message = data?.optString("message") ?: return
                WsEvent.AutomatedWorkflowRunsError(message)
            }

            "automated-workflow-managed:sources" -> {
                val sources = data?.optJSONArray("sources") ?: JSONArray()
                WsEvent.ManagedWorkflowSources(
                    projectId = data?.optString("projectId").orEmpty(),
                    sources = (0 until sources.length()).mapNotNull { index ->
                        sources.optJSONObject(index)?.let { source ->
                            ManagedWorkflowSourceOption(
                                projectSourceId = source.optString("projectSourceId"),
                                projectId = source.optString("projectId"),
                                label = source.optString("label"),
                                relativePath = source.optString("relativePath"),
                                sizeBytes = source.optLong("sizeBytes", 0L),
                            )
                        }
                    },
                )
            }

            "automated-workflow-managed:version" -> {
                WsEvent.ManagedWorkflowVersionReady(data?.optJSONObject("version")?.let(::parseManagedWorkflowVersionContent))
            }

            "automated-workflow-managed:bindings" -> {
                val bindings = data?.optJSONArray("bindings") ?: JSONArray()
                WsEvent.ManagedWorkflowBindingsReady(
                    runId = data?.optString("runId").orEmpty(),
                    stepDbId = data?.nullableString("stepDbId"),
                    bindings = (0 until bindings.length()).mapNotNull { bindings.optJSONObject(it)?.let(::parseManagedWorkflowBinding) },
                )
            }

            "automated-workflow-managed:publish-preview" -> {
                val preview = data?.optJSONObject("preview") ?: return
                WsEvent.ManagedWorkflowPublishPreviewReady(parseManagedWorkflowPreview(preview))
            }

            "automated-workflow-managed:publish-action" -> {
                val action = data?.optJSONObject("action") ?: return
                WsEvent.ManagedWorkflowPublishActionReady(parseManagedWorkflowAction(action))
            }

            "fs:list-directory" -> {
                val path = data?.optString("path") ?: ""
                val entriesArray = data?.optJSONArray("entries") ?: JSONArray()
                val entries = (0 until entriesArray.length()).map { i ->
                    val e = entriesArray.getJSONObject(i)
                    FsEntry(
                        name = e.optString("name"),
                        fullPath = e.optString("fullPath"),
                        isDirectory = e.optString("type") == "dir",
                    )
                }
                WsEvent.FsDirectoryListing(
                    path = path,
                    entries = entries,
                    truncated = data?.optBoolean("truncated", false) ?: false,
                    error = data?.nullableString("error"),
                )
            }

            "fs:get-start-roots" -> {
                val home = data?.optString("home") ?: ""
                val recentsArray = data?.optJSONArray("recents") ?: JSONArray()
                val recents = (0 until recentsArray.length()).map { recentsArray.getString(it) }
                WsEvent.FsStartRoots(home, recents)
            }

            "fs:file-content" -> WsEvent.FsFileContent(
                requestId = data?.nullableString("requestId"),
                path = data?.optString("path") ?: "",
                content = data?.optString("content") ?: "",
                truncated = data?.optBoolean("truncated", false) ?: false,
                error = data?.nullableString("error"),
                mimeType = data?.optString("mimeType", "text/markdown") ?: "text/markdown",
                encoding = data?.optString("encoding", "utf8") ?: "utf8",
            )

            "project-peek:sources" -> {
                val sources = data?.optJSONArray("sources") ?: JSONArray()
                WsEvent.ProjectPeekSources(
                    projectId = data?.optString("projectId").orEmpty(),
                    sources = (0 until sources.length()).map { index ->
                        val source = sources.getJSONObject(index)
                        io.nexy.android.data.model.ProjectPeekSource(
                            id = source.optString("id"),
                            label = source.optString("label"),
                            isPrimary = source.optBoolean("isPrimary", false),
                        )
                    },
                )
            }

            "project-peek:directory" -> {
                val entries = data?.optJSONArray("entries") ?: JSONArray()
                WsEvent.ProjectPeekDirectory(
                    projectId = data?.optString("projectId").orEmpty(),
                    sourceId = data?.optString("sourceId").orEmpty(),
                    relativePath = data?.optString("relativePath").orEmpty(),
                    filter = data?.optString("filter", "all") ?: "all",
                    entries = (0 until entries.length()).map { index ->
                        val entry = entries.getJSONObject(index)
                        io.nexy.android.data.model.ProjectPeekEntry(
                            name = entry.optString("name"),
                            relativePath = entry.optString("relativePath"),
                            isDirectory = entry.optString("type") == "dir",
                            category = entry.optString("category"),
                            sizeBytes = entry.optLong("sizeBytes", 0L),
                            modifiedAt = entry.optLong("modifiedAt", 0L),
                            gitState = entry.optString("gitState", "unknown"),
                        )
                    },
                    truncated = data?.optBoolean("truncated", false) ?: false,
                    error = data?.nullableString("error"),
                )
            }

            "project-peek:file-content" -> WsEvent.ProjectPeekFileContent(
                projectId = data?.optString("projectId").orEmpty(),
                sourceId = data?.optString("sourceId").orEmpty(),
                relativePath = data?.optString("relativePath").orEmpty(),
                requestId = data?.nullableString("requestId"),
                content = data?.optString("content").orEmpty(),
                truncated = data?.optBoolean("truncated", false) ?: false,
                error = data?.nullableString("error"),
                mimeType = data?.nullableString("mimeType"),
                encoding = data?.nullableString("encoding"),
            )

            "project-peek:asset-content" -> WsEvent.ProjectPeekAssetContent(
                projectId = data?.optString("projectId").orEmpty(),
                sourceId = data?.optString("sourceId").orEmpty(),
                relativePath = data?.optString("relativePath").orEmpty(),
                requestId = data?.nullableString("requestId"),
                content = data?.optString("content").orEmpty(),
                truncated = data?.optBoolean("truncated", false) ?: false,
                error = data?.nullableString("error"),
                mimeType = data?.nullableString("mimeType"),
                encoding = data?.nullableString("encoding"),
            )

            else -> return
        }
        scope.launch { events.emit(wsEvent) }
    } catch (error: Exception) {
        val eventName = runCatching { JSONObject(text).optString("event", "unknown") }.getOrDefault("unknown")
        WsRepository.appendDebugLog(
            "WsParse",
            "Dropped event=$eventName error=${error.javaClass.simpleName}: ${error.message.orEmpty()} payloadChars=${text.length}",
        )
    }
}

private fun parseAndroidPublishManifest(m: JSONObject) = AndroidPublishManifest(
    versionCode = m.optInt("versionCode", 0),
    versionName = m.optString("versionName", ""),
    commitSha = m.nullableString("commitSha"),
    changelog = m.optString("changelog", ""),
    checksum = m.optString("checksum", ""),
    artifactUrl = m.optString("artifactUrl", ""),
    publishedAt = m.optLong("publishedAt", 0L),
)

private fun parseMcpServerWithStatus(s: JSONObject): McpServerWithStatus {
    val argsArr = s.optJSONArray("args")
    val args = if (argsArr != null) (0 until argsArr.length()).map { argsArr.optString(it) } else emptyList()
    return McpServerWithStatus(
        id = s.optString("id"),
        name = s.optString("name"),
        description = s.optString("description"),
        command = s.optString("command"),
        args = args,
        enabled = s.optBoolean("enabled", false),
        status = s.optString("status", "disconnected"),
        error = s.nullableString("error"),
        toolCount = s.optInt("toolCount", 0),
        managed = s.optBoolean("managed", false),
        sandbox = parseMcpSandboxStatus(s.optJSONObject("sandbox")),
        sandboxProfile = parseMcpSandboxProfile(s.optJSONObject("sandboxProfile")),
    )
}

private fun parseMcpSandboxStatus(s: JSONObject?): McpSandboxStatus? {
    if (s == null) return null
    return McpSandboxStatus(
        status = s.optString("status", "unavailable"),
        backend = s.nullableString("backend"),
        helperVersion = s.nullableString("helperVersion"),
        helperPid = s.optInt("helperPid", 0).takeIf { it > 0 },
        serverPid = s.optInt("serverPid", 0).takeIf { it > 0 },
        diagnostics = s.nullableString("diagnostics"),
    )
}

private fun parseMcpSandboxProfile(s: JSONObject?): McpSandboxProfile {
    if (s == null) return McpSandboxProfile()
    val grants = s.optJSONArray("filesystem")?.let { arr ->
        (0 until arr.length()).mapNotNull { index ->
            val grant = arr.optJSONObject(index) ?: return@mapNotNull null
            val path = grant.optString("path").trim()
            val access = grant.optString("access")
            if (path.isBlank() || access !in setOf("read-only", "read-write")) null else McpSandboxGrant(path, access)
        }
    } ?: emptyList()
    return McpSandboxProfile(
        version = s.optInt("version", 1),
        network = if (s.optString("network") == "allowed") "allowed" else "blocked",
        childProcesses = if (s.optString("childProcesses") == "allowed") "allowed" else "blocked",
        filesystem = grants,
    )
}

internal fun parseWikiEntry(obj: JSONObject): WikiEntry {
    fun strList(key: String): List<String> {
        val arr = obj.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    return WikiEntry(
        id = obj.optString("id"),
        projectId = obj.optString("projectId"),
        title = obj.optString("title"),
        body = obj.optString("body"),
        tags = strList("tags"),
        sourceConversationId = obj.nullableString("sourceConversationId"),
        createdAt = obj.optLong("createdAt", 0L),
        updatedAt = obj.optLong("updatedAt", 0L),
    )
}

private fun parseArtifactVersion(obj: JSONObject): ArtifactVersionSummary {
    val filesArr = obj.optJSONArray("files") ?: JSONArray()
    return ArtifactVersionSummary(
        id = obj.optString("id"),
        artifactId = obj.optString("artifactId"),
        versionNumber = obj.optInt("versionNumber", 1),
        title = obj.optString("title"),
        notes = obj.nullableString("notes"),
        createdAt = obj.optLong("createdAt", 0L),
        files = (0 until filesArr.length()).map { i ->
            val f = filesArr.getJSONObject(i)
            ArtifactVersionFile(
                id = f.optString("id"),
                relativePath = f.optString("relativePath"),
                absolutePath = f.nullableString("absolutePath"),
                mediaType = f.optString("mediaType"),
                role = f.optString("role"),
            )
        },
    )
}

internal fun parseSkillConfig(obj: JSONObject): SkillConfig {
    fun strList(key: String): List<String> {
        val arr = obj.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    fun parseTool(tool: JSONObject?) = SkillToolConfig(
        enabled = tool?.optBoolean("enabled", false) ?: false,
        approval = tool?.optString("approval", "always-ask") ?: "always-ask",
        instructions = tool?.optString("instructions", "") ?: "",
    )
    val toolsObj = obj.optJSONObject("tools")
    val knowledgeArr = obj.optJSONArray("knowledge") ?: JSONArray()
    val trustArr = obj.optJSONArray("mcpServerTrust") ?: JSONArray()
    val overridesArr = obj.optJSONArray("mcpToolOverrides") ?: JSONArray()
    val packageFilesArr = obj.optJSONArray("packageFiles") ?: JSONArray()
    return SkillConfig(
        id = obj.optString("id"),
        name = obj.optString("name", "New Skill"),
        icon = obj.optString("icon", "*"),
        description = obj.optString("description", ""),
        instructions = obj.optString("instructions", ""),
        tags = strList("tags"),
        tools = SkillTools(
            fileEdit = parseTool(toolsObj?.optJSONObject("fileEdit")),
            terminal = parseTool(toolsObj?.optJSONObject("terminal")),
            webFetch = parseTool(toolsObj?.optJSONObject("webFetch")),
        ),
        mcpServers = strList("mcpServers"),
        mcpServerTrust = (0 until trustArr.length()).map { i ->
            val item = trustArr.optJSONObject(i) ?: JSONObject()
            SkillMcpServerTrust(
                serverId = item.optString("serverId"),
                trust = item.optString("trust", "always-ask"),
            )
        },
        mcpToolOverrides = (0 until overridesArr.length()).map { i ->
            val item = overridesArr.optJSONObject(i) ?: JSONObject()
            SkillMcpToolOverride(
                serverId = item.optString("serverId"),
                toolName = item.optString("toolName"),
                enabled = item.optBoolean("enabled", true),
                approval = item.optString("approval", "always-ask"),
                instructions = item.optString("instructions", ""),
            )
        },
        knowledge = (0 until knowledgeArr.length()).map { i ->
            val item = knowledgeArr.optJSONObject(i) ?: JSONObject()
            SkillKnowledge(
                title = item.optString("title"),
                content = item.optString("content"),
            )
        },
        createdAt = if (obj.has("created_at")) obj.optLong("created_at") else null,
        updatedAt = if (obj.has("updated_at")) obj.optLong("updated_at") else null,
        packagePath = obj.optString("packagePath").takeIf { it.isNotBlank() },
        contentHash = obj.optString("contentHash").takeIf { it.isNotBlank() },
        scope = obj.optString("scope", "user"),
        source = obj.optString("source", "nexy"),
        validationStatus = obj.optString("validationStatus", "valid"),
        packageFiles = (0 until packageFilesArr.length()).mapNotNull { i ->
            val item = packageFilesArr.optJSONObject(i) ?: return@mapNotNull null
            val relativePath = item.optString("relativePath")
            if (relativePath.isBlank()) return@mapNotNull null
            SkillPackageFile(
                relativePath = relativePath,
                encoding = item.optString("encoding", "utf8"),
                content = item.optString("content", ""),
                sizeBytes = item.optLong("sizeBytes", 0L),
            )
        },
    )
}

internal fun parseDiscoveredSkill(obj: JSONObject): DiscoveredSkill {
    fun strList(key: String): List<String> {
        val arr = obj.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    return DiscoveredSkill(
        packagePath = obj.optString("packagePath"),
        name = obj.optString("name", "Unnamed skill"),
        description = obj.optString("description", ""),
        icon = obj.optString("icon", "✨"),
        scope = obj.optString("scope", "user"),
        source = obj.optString("source", "filesystem"),
        rootLabel = obj.optString("rootLabel", "External skill store"),
        validationStatus = obj.optString("validationStatus", "valid"),
        validationErrors = strList("validationErrors"),
        validationWarnings = strList("validationWarnings"),
        importable = !obj.has("importable") || obj.optBoolean("importable", true),
        contentHash = obj.optString("contentHash").takeIf { it.isNotBlank() },
        alreadyImported = obj.optBoolean("alreadyImported", false),
    )
}

internal fun parsePromptEntry(obj: JSONObject): PromptEntry {
    fun strList(key: String): List<String> {
        val arr = obj.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    return PromptEntry(
        id = obj.optString("id"),
        title = obj.optString("title"),
        body = obj.optString("body"),
        description = obj.optString("description"),
        category = obj.optString("category"),
        tags = strList("tags"),
        scope = obj.optString("scope", "global"),
        projectId = obj.nullableString("projectId"),
        createdAt = obj.optLong("createdAt", 0L),
        updatedAt = obj.optLong("updatedAt", 0L),
    )
}

private fun parsePromptVersion(obj: JSONObject): PromptVersion {
    fun strList(key: String): List<String> {
        val arr = obj.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    val diff = obj.optJSONObject("diff") ?: JSONObject()
    fun diffLines(key: String): List<String> {
        val arr = diff.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    return PromptVersion(
        id = obj.optString("id"),
        promptId = obj.optString("promptId"),
        version = obj.optInt("version", 1),
        title = obj.optString("title"),
        body = obj.optString("body"),
        description = obj.optString("description"),
        category = obj.optString("category"),
        tags = strList("tags"),
        variables = strList("variables"),
        scope = obj.optString("scope", "global"),
        projectId = obj.nullableString("projectId"),
        source = obj.optString("source"),
        createdAt = obj.optLong("createdAt", 0L),
        diff = PromptVersionDiff(
            titleChanged = diff.optBoolean("titleChanged", false),
            descriptionChanged = diff.optBoolean("descriptionChanged", false),
            categoryChanged = diff.optBoolean("categoryChanged", false),
            tagsChanged = diff.optBoolean("tagsChanged", false),
            scopeChanged = diff.optBoolean("scopeChanged", false),
            addedLines = diffLines("addedLines"),
            removedLines = diffLines("removedLines"),
        ),
    )
}

private fun parseProjectGeneratorSpec(data: org.json.JSONObject?): ProjectGeneratorSpec? {
    val d = data ?: return null
    fun strMap(obj: JSONObject): Map<String, String> {
        val m = mutableMapOf<String, String>()
        obj.keys().forEach { k -> m[k] = obj.optString(k) }
        return m
    }
    fun objList(key: String): List<Map<String, String>> {
        val arr = d.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { strMap(arr.optJSONObject(it) ?: JSONObject()) }
    }
    val agentsArr = d.optJSONArray("agents") ?: JSONArray()
    val sourcesArr = d.optJSONArray("sources") ?: JSONArray()
    val sources = (0 until sourcesArr.length()).mapNotNull { index ->
        sourcesArr.optJSONObject(index)?.let { source ->
            io.nexy.android.data.model.ProjectGeneratorSourceSpec(
                key = source.optString("key", "source-$index"),
                label = source.optString("label", "Source ${index + 1}"),
                mode = source.optString("mode", "attach-existing"),
                localPath = source.nullableString("localPath"),
                remoteUrl = source.nullableString("remoteUrl"),
                discovery = source.optString("discovery", "scan-children"),
            )
        }
    }
    val agents = (0 until agentsArr.length()).map { i ->
        val a = agentsArr.getJSONObject(i)
        val na = a.optJSONObject("newAgent")
        val tools = na?.optJSONObject("tools")
        ProjectGeneratorAgentSpec(
            role = a.optString("role"),
            description = a.optString("description"),
            existingAgentId = a.nullableString("existingAgentId"),
            isLeader = a.optBoolean("isLeader", false),
            newAgent = na?.let {
                ProjectGeneratorNewAgent(
                    name = it.optString("name"),
                    icon = it.optString("icon"),
                    systemPrompt = it.optString("systemPrompt"),
                    temperature = it.optDouble("temperature", 0.7),
                    responseFormat = it.optString("responseFormat", "default"),
                    tools = ProjectGeneratorAgentTools(
                        fileEdit = tools?.optBoolean("fileEdit", false) ?: false,
                        terminal = tools?.optBoolean("terminal", false) ?: false,
                        webFetch = tools?.optBoolean("webFetch", false) ?: false,
                    ),
                )
            },
        )
    }
    return ProjectGeneratorSpec(
        name = d.optString("name", "New Project"),
        color = d.optString("color", "blue"),
        instructions = d.optString("instructions", ""),
        rootDirectory = d.nullableString("rootDirectory"),
        sources = sources,
        instructionMode = d.nullableString("instructionMode"),
        variables = objList("variables"),
        inScope = objList("inScope"),
        outOfScope = objList("outOfScope"),
        milestones = objList("milestones"),
        orchestrationEnabled = d.optBoolean("orchestrationEnabled", true),
        defaultModel = d.nullableString("defaultModel"),
        agents = agents,
    )
}

internal fun parseAgentFullConfig(a: JSONObject): AgentFullConfig {
    fun stringList(key: String): List<String> {
        val array = a.optJSONArray(key) ?: return emptyList()
        return (0 until array.length()).map(array::optString).filter(String::isNotBlank)
    }
    val contextRules = a.optJSONObject("contextRules")?.let { rules ->
        val globs = rules.optJSONArray("ignoredGlobs")
        AgentContextRules(
            ignoredGlobs = if (globs == null) emptyList() else (0 until globs.length()).map(globs::optString),
            autoInjectWorkspace = rules.optBoolean("autoInjectWorkspace", true),
            autoInjectGit = rules.optBoolean("autoInjectGit", true),
        )
    }
    val commands = a.optJSONArray("customCommands")
    return AgentFullConfig(
        id = a.optString("id"),
        name = a.optString("name"),
        icon = a.optString("icon", ""),
        systemPrompt = a.optString("systemPrompt", ""),
        backend = a.nullableString("backend"),
        cliModel = a.nullableString("cliModel"),
        hermesProfile = a.nullableString("hermesProfile"),
        temperature = a.optDouble("temperature", 0.7).toFloat(),
        maxTokens = a.optInt("maxTokens", 8192),
        responseFormat = a.optString("responseFormat", "default"),
        agenticMode = a.optBoolean("agenticMode", false),
        fullAutoApprove = a.optBoolean("fullAutoApprove", false),
        memory = a.optString("memory", ""),
        tools = parseAgentTools(a.optJSONObject("tools")),
        mcpServers = stringList("mcpServers"),
        thinkingEffort = a.nullableString("thinkingEffort"),
        rootDirectory = a.nullableString("rootDirectory"),
        contextDirectories = stringList("contextDirectories"),
        contextFiles = stringList("contextFiles"),
        contextRules = contextRules,
        customCommands = if (commands == null) emptyList() else (0 until commands.length()).mapNotNull { index ->
            commands.optJSONObject(index)?.let {
                AgentCustomCommand(
                    name = it.optString("name"),
                    description = it.optString("description"),
                    prompt = it.optString("prompt"),
                )
            }
        },
    )
}

internal fun parseProjectSettingsConfig(config: JSONObject): ProjectSettingsConfig {
    fun stringMap(obj: JSONObject): Map<String, String> =
        obj.keys().asSequence()
            .filterNot(obj::isNull)
            .associateWith(obj::optString)
    fun objectList(key: String): List<Map<String, String>> {
        val array = config.optJSONArray(key) ?: return emptyList()
        return (0 until array.length()).map { stringMap(array.optJSONObject(it) ?: JSONObject()) }
    }
    val orchestrationEnabled = config.optBoolean("orchestrationEnabled", false)
    val workflowMode = config.optString("workflowMode", "").let {
        // "manual-delegation" is the pre-rename value (self-heals to "automated-delegation" on
        // the desktop side too, see project-handlers.ts's parseProjectConfig).
        when {
            it == "manual-delegation" -> "automated-delegation"
            it == "automated-delegation" || it == "orchestrated" || it == "single-agent" -> it
            orchestrationEnabled -> "orchestrated"
            else -> "single-agent"
        }
    }
    val sourcesArray = config.optJSONArray("sources") ?: JSONArray()
    val sources = (0 until sourcesArray.length()).mapNotNull { index ->
        sourcesArray.optJSONObject(index)?.let { source ->
            io.nexy.android.data.model.ProjectSource(
                id = source.optString("id"),
                projectId = source.optString("projectId"),
                label = source.optString("label", "Source"),
                kind = source.optString("kind", "workspace-root"),
                localPath = source.optString("localPath"),
                enabled = source.optBoolean("enabled", true),
                isPrimary = source.optBoolean("isPrimary", false),
            )
        }
    }
    val repositoriesArray = config.optJSONArray("repositories") ?: JSONArray()
    val repositories = (0 until repositoriesArray.length()).mapNotNull { index ->
        repositoriesArray.optJSONObject(index)?.let { repository ->
            io.nexy.android.data.model.ProjectRepositoryBinding(
                id = repository.optString("id"),
                projectId = repository.optString("projectId"),
                sourceId = repository.optString("sourceId"),
                label = repository.optString("label", "Repository"),
                relativePath = repository.optString("relativePath"),
                branch = repository.nullableString("branch"),
                dirty = if (repository.has("dirty") && !repository.isNull("dirty")) repository.optBoolean("dirty") else null,
                enabled = repository.optBoolean("enabled", true),
                available = repository.optBoolean("available", true),
            )
        }
    }
    return ProjectSettingsConfig(
        instructions = config.optString("instructions", ""),
        rootDirectory = config.nullableString("rootDirectory"),
        sources = sources,
        repositories = repositories,
        variables = objectList("variables"),
        instructionMode = config.optString("instructionMode", "prepend"),
        instructionsEnabled = config.optBoolean("instructionsEnabled", true),
        workflowMode = workflowMode,
        orchestrationEnabled = workflowMode == "orchestrated",
        maxDelegationDepth = config.optInt("maxDelegationDepth", 5).coerceIn(1, 10),
        showTeamActivity = config.optBoolean("showTeamActivity", true),
        inScope = objectList("inScope"),
        outOfScope = objectList("outOfScope"),
        milestones = objectList("milestones"),
        defaultModel = config.nullableString("defaultModel"),
        projectHermesProfile = config.nullableString("projectHermesProfile"),
        defaultThinkingEffort = config.nullableString("defaultThinkingEffort")?.takeIf {
            it in setOf("low", "medium", "high", "max", "disabled")
        },
        capabilityProfile = parseCapabilityProfile(config.optJSONObject("capabilityProfile") ?: JSONObject()),
    )
}

internal fun parseCapabilityProfile(profile: JSONObject): CapabilityProfile {
    val validTrust = setOf("always-ask", "auto", "block")
    val skillIds = profile.optJSONArray("skillIds")?.let { array ->
        (0 until array.length()).mapNotNull { index ->
            array.optString(index).trim().takeIf(String::isNotBlank)
        }.distinct()
    } ?: emptyList()
    val mcp = profile.optJSONArray("mcp")?.let { array ->
        (0 until array.length()).mapNotNull { index ->
            val entry = array.optJSONObject(index) ?: return@mapNotNull null
            val serverId = entry.optString("serverId").trim().takeIf(String::isNotBlank) ?: return@mapNotNull null
            CapabilityMcpGrant(serverId, entry.optString("trust").takeIf { it in validTrust } ?: "always-ask")
        }.distinctBy(CapabilityMcpGrant::serverId)
    } ?: emptyList()
    val validApproval = setOf("auto", "always-ask", "disabled")
    val builtInToolsObject = profile.optJSONObject("builtInTools")
    val builtInTools = listOf("fileEdit", "terminal", "webFetch").mapNotNull { key ->
        val entry = builtInToolsObject?.optJSONObject(key) ?: return@mapNotNull null
        if (!entry.has("enabled")) return@mapNotNull null
        key to io.nexy.android.data.model.CapabilityBuiltInToolPolicy(
            enabled = entry.optBoolean("enabled"),
            approval = entry.optString("approval").takeIf { it in validApproval } ?: "always-ask",
        )
    }.toMap()
    return CapabilityProfile(version = 1, skillIds = skillIds, mcp = mcp, builtInTools = builtInTools)
}

private fun parseManagedWorkflowBinding(obj: JSONObject) = ManagedWorkflowBindingRecord(
    id = obj.optString("id"), runId = obj.optString("runId"), stepDbId = obj.optString("stepDbId"),
    stepAttempt = obj.optInt("stepAttempt", 0), bindingName = obj.optString("bindingName"),
    direction = obj.optString("direction"), artifactId = obj.optString("artifactId"),
    artifactVersionId = obj.optString("artifactVersionId"), sourceStepDbId = obj.nullableString("sourceStepDbId"),
    staleAt = if (obj.isNull("staleAt")) null else obj.optLong("staleAt"), createdAt = obj.optLong("createdAt", 0L),
)

private fun parseManagedWorkflowVersionSummary(obj: JSONObject) = ManagedWorkflowVersionSummary(
    id = obj.optString("id"), artifactId = obj.optString("artifactId"), versionNumber = obj.optInt("versionNumber", 0),
    title = obj.optString("title"), primaryPath = obj.optString("primaryPath"), mediaType = obj.optString("mediaType"),
    sizeBytes = obj.optLong("sizeBytes", 0L), checksum = obj.nullableString("checksum"), createdAt = obj.optLong("createdAt", 0L),
)

private fun parseManagedWorkflowReview(obj: JSONObject) = ManagedWorkflowReviewRecord(
    id = obj.optString("id"), runId = obj.optString("runId"), stepDbId = obj.optString("stepDbId"),
    artifactVersionId = obj.optString("artifactVersionId"), decision = obj.optString("decision"),
    reviewedByClient = obj.optString("reviewedByClient"), reviewedAt = obj.optLong("reviewedAt", 0L),
    supersededAt = if (obj.isNull("supersededAt")) null else obj.optLong("supersededAt"),
)

private fun parseManagedWorkflowPreview(obj: JSONObject) = ManagedWorkflowPublishPreview(
    id = obj.optString("id"), runId = obj.optString("runId"), stepDbId = obj.optString("stepDbId"),
    artifactVersionId = obj.optString("artifactVersionId"), projectSourceId = obj.optString("projectSourceId"),
    relativePath = obj.optString("relativePath"), destinationChecksum = obj.nullableString("destinationChecksum"),
    diffText = obj.optString("diffText"), createdAt = obj.optLong("createdAt", 0L),
    expiresAt = if (obj.isNull("expiresAt")) null else obj.optLong("expiresAt"),
    invalidatedAt = if (obj.isNull("invalidatedAt")) null else obj.optLong("invalidatedAt"),
)

private fun parseManagedWorkflowAction(obj: JSONObject) = ManagedWorkflowPublishAction(
    id = obj.optString("id"), previewId = obj.optString("previewId"), idempotencyKey = obj.optString("idempotencyKey"),
    status = obj.optString("status"), approvedByClient = obj.optString("approvedByClient"), approvedAt = obj.optLong("approvedAt", 0L),
    startedAt = if (obj.isNull("startedAt")) null else obj.optLong("startedAt"),
    completedAt = if (obj.isNull("completedAt")) null else obj.optLong("completedAt"),
    resultChecksum = obj.nullableString("resultChecksum"), error = obj.nullableString("error"),
)

private fun parseManagedWorkflowStepState(obj: JSONObject): ManagedWorkflowStepState {
    val bindings = obj.optJSONArray("bindings") ?: JSONArray()
    return ManagedWorkflowStepState(
        isManaged = obj.optBoolean("isManaged", true), isStale = obj.optBoolean("isStale", false),
        currentVersion = obj.optJSONObject("currentVersion")?.let(::parseManagedWorkflowVersionSummary),
        bindings = (0 until bindings.length()).mapNotNull { bindings.optJSONObject(it)?.let(::parseManagedWorkflowBinding) },
        latestReview = obj.optJSONObject("latestReview")?.let(::parseManagedWorkflowReview),
        publishPreview = obj.optJSONObject("publishPreview")?.let(::parseManagedWorkflowPreview),
        publishAction = obj.optJSONObject("publishAction")?.let(::parseManagedWorkflowAction),
    )
}

private fun parseManagedWorkflowVersionContent(obj: JSONObject): ManagedWorkflowVersionContent {
    val versions = obj.optJSONArray("versions") ?: JSONArray()
    return ManagedWorkflowVersionContent(
        version = parseManagedWorkflowVersionSummary(obj.optJSONObject("version") ?: JSONObject()),
        content = obj.optString("content"), manifestJson = obj.optString("manifestJson", "{}"),
        versions = (0 until versions.length()).mapNotNull { versions.optJSONObject(it)?.let(::parseManagedWorkflowVersionSummary) },
    )
}

private fun parseAutomatedWorkflowRunStep(obj: JSONObject): io.nexy.android.data.model.AutomatedWorkflowRunStepData {
    val dependsArr = obj.optJSONArray("dependsOnStepIds")
    val dependsOn = if (dependsArr != null) (0 until dependsArr.length()).map { dependsArr.optString(it) } else emptyList()
    return io.nexy.android.data.model.AutomatedWorkflowRunStepData(
        id = obj.optString("id"),
        dbId = obj.optString("dbId"),
        runId = obj.optString("runId"),
        stepIndex = obj.optInt("stepIndex", 0),
        title = obj.optString("title", ""),
        summary = obj.optString("summary", ""),
        agentId = obj.nullableString("agentId"),
        agentName = obj.nullableString("agentName"),
        prompt = obj.optString("prompt", ""),
        expectedOutput = obj.optString("expectedOutput", ""),
        dependsOnStepIds = dependsOn,
        status = obj.optString("status", "pending"),
        attempt = obj.optInt("attempt", 0),
        output = obj.optString("output", ""),
        error = obj.nullableString("error"),
        conversationId = obj.nullableString("conversationId"),
        startedAt = if (obj.isNull("startedAt")) null else obj.optLong("startedAt"),
        completedAt = if (obj.isNull("completedAt")) null else obj.optLong("completedAt"),
        model = obj.nullableString("model"),
        kind = obj.nullableString("kind"),
        managed = obj.optJSONObject("managed")?.let(::parseManagedWorkflowStepState),
    )
}

private fun parseAutomatedWorkflowRun(obj: JSONObject): io.nexy.android.data.model.AutomatedWorkflowRunInfo {
    val stepCounts = obj.optJSONObject("stepCounts")
    val assumptionsArr = obj.optJSONArray("assumptions")
    val assumptions = if (assumptionsArr != null) (0 until assumptionsArr.length()).map { assumptionsArr.optString(it) } else emptyList()
    val stepsArr = obj.optJSONArray("steps")
    val steps = if (stepsArr != null) (0 until stepsArr.length()).map { parseAutomatedWorkflowRunStep(stepsArr.getJSONObject(it)) } else emptyList()
    return io.nexy.android.data.model.AutomatedWorkflowRunInfo(
        id = obj.optString("id"),
        // nullableString, not optString — a project-less run's JSON `projectId` is a real `null`,
        // which optString would otherwise silently coerce to "" (indistinguishable from an
        // actual empty-string project id, which should never happen, but is a different bug than
        // "no project" if it ever did).
        projectId = obj.nullableString("projectId"),
        title = obj.optString("title", ""),
        goalSummary = obj.optString("goalSummary", ""),
        model = obj.nullableString("model"),
        status = obj.optString("status", "pending"),
        confirmationMode = obj.optString("confirmationMode", "gated"),
        currentStepId = obj.nullableString("currentStepId"),
        lastError = obj.nullableString("lastError"),
        stepCounts = io.nexy.android.data.model.AutomatedWorkflowRunInfo.StepCounts(
            total = stepCounts?.optInt("total", 0) ?: 0,
            pending = stepCounts?.optInt("pending", 0) ?: 0,
            running = stepCounts?.optInt("running", 0) ?: 0,
            awaitingConfirmation = stepCounts?.optInt("awaitingConfirmation", 0) ?: 0,
            done = stepCounts?.optInt("done", 0) ?: 0,
            failed = stepCounts?.optInt("failed", 0) ?: 0,
            skipped = stepCounts?.optInt("skipped", 0) ?: 0,
        ),
        createdAt = obj.optLong("createdAt", 0L),
        updatedAt = obj.optLong("updatedAt", 0L),
        assumptions = assumptions,
        steps = steps,
        templateId = obj.nullableString("templateId"),
    )
}

private fun parseAgentTools(obj: JSONObject?): AgentTools {
    fun parseToolConfig(tool: JSONObject?, defaultEnabled: Boolean, defaultApproval: String) = ToolConfig(
        enabled = tool?.optBoolean("enabled", defaultEnabled) ?: defaultEnabled,
        approval = tool?.optString("approval", defaultApproval) ?: defaultApproval,
        instructions = tool?.optString("instructions", "") ?: "",
    )
    return AgentTools(
        fileEdit = parseToolConfig(obj?.optJSONObject("fileEdit"), defaultEnabled = true, defaultApproval = "always-ask"),
        terminal = parseToolConfig(obj?.optJSONObject("terminal"), defaultEnabled = false, defaultApproval = "always-ask"),
        webFetch = parseToolConfig(obj?.optJSONObject("webFetch"), defaultEnabled = true, defaultApproval = "never-ask"),
    )
}

private fun parseAgentGeneratorSpec(data: JSONObject?): AgentGeneratorSpec? {
    val d = data ?: return null
    val toolsObj = d.optJSONObject("tools")
    val ctxArr = d.optJSONArray("contextDirectories")
    val contextDirectories = if (ctxArr != null) (0 until ctxArr.length()).map { ctxArr.optString(it) } else emptyList()
    return AgentGeneratorSpec(
        name = d.optString("name", ""),
        icon = d.optString("icon", ""),
        systemPrompt = d.optString("systemPrompt", ""),
        temperature = d.optDouble("temperature", 0.7),
        responseFormat = d.optString("responseFormat", "default"),
        agenticMode = d.optBoolean("agenticMode", false),
        tools = AgentGeneratorTools(
            fileEdit = toolsObj?.optBoolean("fileEdit", true) ?: true,
            terminal = toolsObj?.optBoolean("terminal", false) ?: false,
            webFetch = toolsObj?.optBoolean("webFetch", true) ?: true,
        ),
        rootDirectory = d.nullableString("rootDirectory"),
        contextDirectories = contextDirectories,
        memory = d.nullableString("memory"),
    )
}

private fun parseSkillGeneratorSpec(data: JSONObject?): SkillGeneratorSpec? {
    val d = data ?: return null
    val toolsObj = d.optJSONObject("tools")
    val toolInstrObj = d.optJSONObject("toolInstructions")
    val approvalObj = d.optJSONObject("approval")
    val toolInstructions = mutableMapOf<String, String>()
    val approval = mutableMapOf<String, String>()
    listOf("fileEdit", "terminal", "webFetch").forEach { key ->
        toolInstrObj?.nullableString(key)?.let { toolInstructions[key] = it }
        approvalObj?.nullableString(key)?.let { approval[key] = it }
    }
    fun strList(key: String): List<String> {
        val arr = d.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    val knowledgeArr = d.optJSONArray("knowledge")
    val knowledge = if (knowledgeArr != null) {
        (0 until knowledgeArr.length()).mapNotNull { i ->
            val k = knowledgeArr.optJSONObject(i) ?: return@mapNotNull null
            SkillKnowledge(title = k.optString("title"), content = k.optString("content"))
        }
    } else emptyList()
    return SkillGeneratorSpec(
        name = d.optString("name", ""),
        icon = d.optString("icon", ""),
        description = d.optString("description", ""),
        instructions = d.optString("instructions", ""),
        tools = SkillGeneratorTools(
            fileEdit = toolsObj?.optBoolean("fileEdit", false) ?: false,
            terminal = toolsObj?.optBoolean("terminal", false) ?: false,
            webFetch = toolsObj?.optBoolean("webFetch", false) ?: false,
        ),
        toolInstructions = toolInstructions,
        approval = approval,
        mcpServers = strList("mcpServers"),
        tags = strList("tags"),
        knowledge = knowledge,
        suggestedAgents = strList("suggestedAgents"),
    )
}

private fun parseScheduleGeneratorSpec(data: JSONObject?): ScheduleGeneratorSpec? {
    val d = data ?: return null
    return ScheduleGeneratorSpec(
        name = d.optString("name", ""),
        prompt = d.optString("prompt", ""),
        scheduleType = d.optString("scheduleType", "daily"),
        localTime = d.optString("localTime", "09:00"),
        weekday = if (d.has("weekday") && !d.isNull("weekday")) d.optInt("weekday") else null,
        monthDay = if (d.has("monthDay") && !d.isNull("monthDay")) d.optInt("monthDay") else null,
        timezone = d.optString("timezone", "UTC"),
        agentId = d.nullableString("agentId"),
        projectId = d.nullableString("projectId"),
        model = d.nullableString("model"),
        notificationPref = d.optString("notificationPref", "failures_only"),
        preApproved = d.optJSONArray("preApproved").toStringList(),
        targetType = d.optString("targetType", "chat"),
        sourceRunId = d.nullableString("sourceRunId"),
    )
}

private fun parseArtifactGeneratorSpec(data: JSONObject?): ArtifactGeneratorSpec? {
    val d = data ?: return null
    fun strList(key: String): List<String> {
        val arr = d.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    val scopeObj = d.optJSONObject("scope")
    val filesArr = d.optJSONArray("outputFiles") ?: JSONArray()
    val outputFiles = (0 until filesArr.length()).map { i ->
        val f = filesArr.optJSONObject(i) ?: JSONObject()
        ArtifactOutputFile(
            path = f.optString("path", "output.md"),
            mediaType = f.optString("mediaType", "text/plain"),
            role = f.optString("role", "primary"),
            description = f.nullableString("description"),
        )
    }
    val srcObj = d.optJSONObject("sourceContext")
    fun srcStrList(key: String): List<String> {
        val arr = srcObj?.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    return ArtifactGeneratorSpec(
        title = d.optString("title", "New Artifact"),
        kind = d.optString("kind", "document"),
        scopeType = scopeObj?.optString("type") ?: "global",
        scopeProjectId = scopeObj?.nullableString("projectId"),
        intendedUse = d.optString("intendedUse", ""),
        audience = d.nullableString("audience"),
        outputFiles = outputFiles,
        acceptanceCriteria = strList("acceptanceCriteria"),
        exportFormats = strList("exportFormats"),
        sourceContext = ArtifactSourceContext(
            useProjectInstructions = srcObj?.optBoolean("useProjectInstructions", false) ?: false,
            useProjectWiki = srcObj?.optBoolean("useProjectWiki", false) ?: false,
            useConversationContext = srcObj?.optBoolean("useConversationContext", false) ?: false,
            referencedFiles = srcStrList("referencedFiles"),
        ),
    )
}

private fun parseThinkingBlocks(json: String?): List<ThinkingBlock> {
    if (json.isNullOrBlank()) return emptyList()
    return try {
        val arr = JSONArray(json)
        (0 until arr.length()).mapNotNull { i ->
            val obj = arr.optJSONObject(i) ?: return@mapNotNull null
            ThinkingBlock(
                blockId = obj.optString("blockId"),
                content = obj.optString("content"),
                done = obj.optBoolean("done", true),
                firstSeenAt = if (obj.has("firstSeenAt") && !obj.isNull("firstSeenAt")) obj.optLong("firstSeenAt") else null,
            )
        }
    } catch (_: Exception) { emptyList() }
}

private fun parseConversationArray(arr: JSONArray): List<Conversation> =
    (0 until arr.length()).map { i ->
        val row = arr.getJSONObject(i)
        Conversation(
            id = row.optString("id"),
            title = row.optString("title"),
            created_at = row.optString("created_at"),
            updated_at = row.optString("updated_at"),
            agent_id = row.nullableString("agent_id"),
            agent_name = row.nullableString("agent_name"),
            agent_icon = row.nullableString("agent_icon"),
            project_id = row.nullableString("project_id"),
            project_name = row.nullableString("project_name"),
            model = row.nullableString("model"),
            conversationHermesProfile = row.nullableString("conversation_hermes_profile"),
            last_message = row.nullableString("last_message"),
            pinned = row.optInt("pinned", 0) != 0,
            completed_at = if (row.has("completed_at") && !row.isNull("completed_at")) row.optLong("completed_at") else null,
            thinking_effort_override = row.nullableString("thinking_effort_override"),
            full_auto_approve_override = if (row.has("full_auto_approve_override") && !row.isNull("full_auto_approve_override")) row.optInt("full_auto_approve_override") != 0 else null,
            agentic_mode_override = if (row.has("agentic_mode_override") && !row.isNull("agentic_mode_override")) row.optInt("agentic_mode_override") != 0 else null,
            terminal_sandbox_override = if (row.has("terminal_sandbox_override") && !row.isNull("terminal_sandbox_override")) row.optInt("terminal_sandbox_override") != 0 else null,
            cli_mode_override = row.nullableString("cli_mode_override"),
            codex_execution_mode_override = row.nullableString("codex_execution_mode_override"),
            rating = if (row.has("rating") && !row.isNull("rating")) row.optInt("rating") else null,
            kind = row.nullableString("kind"),
        )
    }

private fun parseConversationDebrief(obj: JSONObject): ConversationDebrief {
    val toolsArr = obj.optJSONArray("commandsTools")
    val commandsTools = if (toolsArr != null) (0 until toolsArr.length()).map { toolsArr.optString(it) } else emptyList()
    return ConversationDebrief(
        id = obj.optString("id"),
        conversationId = obj.optString("conversationId"),
        projectId = obj.nullableString("projectId"),
        summary = obj.optString("summary"),
        commandsTools = commandsTools,
        reproductionGuide = obj.optString("reproductionGuide"),
        mentalModel = obj.optString("mentalModel"),
        generatedAt = obj.optLong("generatedAt", 0L),
        createdAt = obj.optLong("createdAt", 0L),
    )
}

private fun parseDebriefStory(obj: JSONObject): DebriefStory {
    val beatsArr = obj.optJSONArray("beats")
    val beats = if (beatsArr != null) {
        (0 until beatsArr.length()).mapNotNull { i ->
            val beatObj = beatsArr.optJSONObject(i) ?: return@mapNotNull null
            StoryBeat(
                caption = beatObj.optString("caption"),
                mood = StoryMood.fromRaw(beatObj.optString("mood")),
                svg = beatObj.optString("svg"),
            )
        }
    } else emptyList()
    return DebriefStory(title = obj.optString("title"), beats = beats)
}

private fun JSONObject.optStringList(key: String): List<String> {
    val arr = optJSONArray(key) ?: return emptyList()
    return (0 until arr.length()).map { arr.optString(it) }
}

private fun parseConversationRatingSnapshot(obj: JSONObject): ConversationRatingSnapshot = ConversationRatingSnapshot(
    agentId = obj.nullableString("agentId"),
    agentName = obj.nullableString("agentName"),
    model = obj.nullableString("model"),
    backend = obj.nullableString("backend"),
    projectId = obj.nullableString("projectId"),
    projectName = obj.nullableString("projectName"),
    workflowMode = obj.nullableString("workflowMode"),
    toolNames = obj.optStringList("toolNames"),
    serverNames = obj.optStringList("serverNames"),
    skillIds = obj.optStringList("skillIds"),
    skillNames = obj.optStringList("skillNames"),
    keywords = obj.optStringList("keywords"),
)

private fun parseConversationRating(obj: JSONObject): ConversationRating = ConversationRating(
    id = obj.optString("id"),
    conversationId = obj.optString("conversationId"),
    rating = obj.optInt("rating", 0),
    note = obj.nullableString("note"),
    snapshot = obj.optJSONObject("snapshot")?.let { parseConversationRatingSnapshot(it) }
        ?: parseConversationRatingSnapshot(JSONObject()),
    createdAt = obj.optLong("createdAt", 0L),
    updatedAt = obj.optLong("updatedAt", 0L),
)

private fun parseConversationRatingListItem(obj: JSONObject): ConversationRatingListItem = ConversationRatingListItem(
    id = obj.optString("id"),
    conversationId = obj.optString("conversationId"),
    conversationTitle = obj.optString("conversationTitle"),
    projectId = obj.nullableString("projectId"),
    projectName = obj.nullableString("projectName"),
    rating = obj.optInt("rating", 0),
    note = obj.nullableString("note"),
    agentName = obj.nullableString("agentName"),
    model = obj.nullableString("model"),
    toolNames = obj.optStringList("toolNames"),
    skillNames = obj.optStringList("skillNames"),
    createdAt = obj.optLong("createdAt", 0L),
    updatedAt = obj.optLong("updatedAt", 0L),
)

private fun parseRatingAggregateList(arr: JSONArray?): List<RatingAggregate> {
    if (arr == null) return emptyList()
    return (0 until arr.length()).map { i ->
        val obj = arr.getJSONObject(i)
        RatingAggregate(label = obj.optString("label"), average = obj.optDouble("average", 0.0), count = obj.optInt("count", 0))
    }
}

private fun parseConversationRatingStats(obj: JSONObject): ConversationRatingStats {
    val trendArr = obj.optJSONArray("trend")
    val trend = if (trendArr != null) (0 until trendArr.length()).map { i ->
        val t = trendArr.getJSONObject(i)
        RatingTrendPoint(date = t.optString("date"), average = t.optDouble("average", 0.0), count = t.optInt("count", 0))
    } else emptyList()
    return ConversationRatingStats(
        averageByAgent = parseRatingAggregateList(obj.optJSONArray("averageByAgent")),
        averageByModel = parseRatingAggregateList(obj.optJSONArray("averageByModel")),
        averageBySkill = parseRatingAggregateList(obj.optJSONArray("averageBySkill")),
        averageByServer = parseRatingAggregateList(obj.optJSONArray("averageByServer")),
        averageByProject = parseRatingAggregateList(obj.optJSONArray("averageByProject")),
        trend = trend,
    )
}

private fun parseQuizQuestion(obj: JSONObject): QuizQuestion {
    val optArr = obj.optJSONArray("options")
    val options = if (optArr != null) (0 until optArr.length()).map { optArr.optString(it) } else emptyList()
    return QuizQuestion(
        id = obj.optString("id"),
        question = obj.optString("question"),
        options = options,
        correctIndex = obj.optInt("correctIndex", 0),
        explanation = obj.optString("explanation"),
        category = obj.optString("category"),
    )
}

private fun parseTeachbackExercise(obj: JSONObject) = TeachbackExercise(
    prompt = obj.optString("prompt"),
    keyPoints = obj.optStringList("keyPoints"),
    sourceLabel = obj.optString("sourceLabel"),
)

private fun parseTeachbackDimension(obj: JSONObject?) = TeachbackRubricDimension(
    score = obj?.optInt("score", 0) ?: 0,
    feedback = obj?.optString("feedback").orEmpty(),
)

private fun parseTeachbackFeedback(obj: JSONObject): TeachbackFeedback {
    val rubric = obj.optJSONObject("rubric")
    return TeachbackFeedback(
        accuracy = parseTeachbackDimension(rubric?.optJSONObject("accuracy")),
        completeness = parseTeachbackDimension(rubric?.optJSONObject("completeness")),
        clarity = parseTeachbackDimension(rubric?.optJSONObject("clarity")),
        strengths = obj.optStringList("strengths"),
        corrections = obj.optStringList("corrections"),
        followUpQuestions = obj.optStringList("followUpQuestions"),
        attemptId = obj.nullableString("attemptId"),
        prompt = obj.nullableString("prompt"),
        turnNumber = obj.optInt("turnNumber", 0),
        attemptedAt = if (obj.has("attemptedAt") && !obj.isNull("attemptedAt")) obj.optLong("attemptedAt") else null,
    )
}

private fun parseTeachbackAttempt(obj: JSONObject) = TeachbackAttempt(
    id = obj.optString("id"), artifactId = obj.optString("artifactId"), versionId = obj.optString("versionId"),
    parentAttemptId = obj.nullableString("parentAttemptId"), turnNumber = obj.optInt("turnNumber", 0),
    prompt = obj.optString("prompt"), transcript = obj.optString("transcript"),
    feedback = parseTeachbackFeedback(obj.optJSONObject("feedback") ?: JSONObject()), attemptedAt = obj.optLong("attemptedAt", 0L),
)

/** Mirrors desktop's openBackgroundActivity kind-dispatch (backgroundActivitySlice.ts) — maps a
 *  server-tracked activity kind to the Android nav route that shows it. Returns null for kinds
 *  with no reachable Android destination. */
private fun routeForServerActivity(id: String, kind: String, conversationId: String?, projectId: String?): String? = when (kind) {
    // Code Changes runs entirely inside a normal conversation via slash commands now (no
    // dedicated wizard/screen) — "chat/$conversationId" is the right target, same as any other
    // conversation-scoped activity above. This used to route to "remote-edit/{reportId}", a
    // screen that was deleted along with the wizard; navigating there crashed the app since
    // that destination no longer exists in NavGraph.
    "chat", "debrief-generation", "quiz-generation", "teachback-generation", "orchestration", "automated-workflow-run", "remote-edit" ->
        conversationId?.let { "chat/$it" }
    "project-generator" -> "project-generator"
    "agent-generator" -> "agent-generator"
    "skill-generator" -> "skill-generator"
    "scheduler-generator" -> "scheduled/generator"
    "automated-workflow-generator" -> projectId?.let { "automated-workflow/${android.net.Uri.encode(it)}" }
    "build" -> if (id.startsWith("android-build:")) "settings/build-dashboard?tab=android" else "settings/build-dashboard?tab=desktop"
    else -> null
}

private fun parseScheduledTaskWorkflowSpec(obj: JSONObject) = io.nexy.android.data.model.ScheduledTaskWorkflowSpec(
    workflowSpecJson = obj.optString("workflowSpecJson", "{}"),
    sourceRunId = obj.nullableString("sourceRunId"),
    confirmationMode = obj.optString("confirmationMode", "auto"),
)

private fun parseScheduledTask(obj: JSONObject) = ScheduledTask(
    id = obj.optString("id"),
    name = obj.optString("name"),
    prompt = obj.optString("prompt"),
    enabled = obj.optBoolean("enabled", true),
    agentId = obj.nullableString("agentId"),
    projectId = obj.nullableString("projectId"),
    model = obj.nullableString("model"),
    conversationId = obj.nullableString("conversationId"),
    scheduleType = obj.optString("scheduleType", "daily"),
    localTime = obj.optString("localTime", "09:00"),
    weekday = if (obj.has("weekday") && !obj.isNull("weekday")) obj.optInt("weekday") else null,
    monthDay = if (obj.has("monthDay") && !obj.isNull("monthDay")) obj.optInt("monthDay") else null,
    timezone = obj.optString("timezone", "UTC"),
    notificationPref = obj.optString("notificationPref", "failures_only"),
    nextRunAt = if (obj.has("nextRunAt") && !obj.isNull("nextRunAt")) obj.optLong("nextRunAt") else null,
    lastRunAt = if (obj.has("lastRunAt") && !obj.isNull("lastRunAt")) obj.optLong("lastRunAt") else null,
    createdAt = obj.optLong("createdAt"),
    updatedAt = obj.optLong("updatedAt"),
    targetType = obj.optString("targetType", "chat"),
    workflowSpecs = obj.optJSONArray("workflowSpecs")?.let { arr ->
        (0 until arr.length()).map { parseScheduledTaskWorkflowSpec(arr.getJSONObject(it)) }
    } ?: emptyList(),
    toolPolicy = obj.optJSONObject("toolPolicy")?.let { tp ->
        io.nexy.android.data.model.ScheduledTaskToolPolicy(
            preApproved = tp.optJSONArray("preApproved").toStringList(),
            alwaysAsk = tp.optJSONArray("alwaysAsk").toStringList(),
            neverAllow = tp.optJSONArray("neverAllow").toStringList(),
        )
    } ?: io.nexy.android.data.model.ScheduledTaskToolPolicy(),
)

private fun JSONArray?.toStringList(): List<String> =
    this?.let { arr -> (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() } } ?: emptyList()

private fun parseScheduledRun(obj: JSONObject) = ScheduledRun(
    id = obj.optString("id"),
    taskId = obj.optString("taskId"),
    scheduledAt = if (obj.has("scheduledAt") && !obj.isNull("scheduledAt")) obj.optLong("scheduledAt") else null,
    startedAt = if (obj.has("startedAt") && !obj.isNull("startedAt")) obj.optLong("startedAt") else null,
    finishedAt = if (obj.has("finishedAt") && !obj.isNull("finishedAt")) obj.optLong("finishedAt") else null,
    status = obj.optString("status", "pending"),
    error = obj.nullableString("error"),
    conversationId = obj.nullableString("conversationId"),
    messageId = obj.nullableString("messageId"),
    triggerSource = obj.optString("triggerSource", "scheduled"),
    createdAt = obj.optLong("createdAt"),
    workflowRunIds = obj.optJSONArray("workflowRunIds")?.let { arr ->
        (0 until arr.length()).map { arr.getString(it) }
    },
)

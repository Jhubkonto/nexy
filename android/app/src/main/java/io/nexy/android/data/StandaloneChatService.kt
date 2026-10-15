package io.nexy.android.data

import io.nexy.android.data.local.LocalDataRepository
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WsEvent
import io.nexy.android.data.model.AttachmentMeta
import io.nexy.android.data.model.ModelOption
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class StandaloneChatService(
    private val localData: LocalDataRepository,
    private val providerStore: StandaloneProviderStore,
    private val emit: suspend (WsEvent) -> Unit,
) {
    @Volatile private var emergencyStopped = false
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()
    private val activeCalls = ConcurrentHashMap<String, Call>()
    private val protocols: Map<String, LlmProvider> by lazy {
        mapOf(
            "anthropic" to LambdaLlmProvider(
                providerId = "anthropic",
                requestFactory = {
                    anthropicRequest(it.config, it.history, it.images, it.agentConfig, it.conversationSummary)
                },
                eventHandler = ::parseAnthropicStreamEvent,
            ),
            "openai-compatible" to LambdaLlmProvider(
                providerId = "openai-compatible",
                requestFactory = {
                    openAiRequest(it.config, it.history, it.images, it.agentConfig, it.conversationSummary)
                },
                eventHandler = ::parseOpenAiStreamEvent,
            ),
        )
    }

    suspend fun send(data: Map<String, Any>) {
        if (emergencyStopped) {
            emit(WsEvent.ChatActivity(data["conversationId"] as? String ?: "", "error", "Emergency stop is active", null, null))
            return
        }
        val conversationId = data["conversationId"] as? String ?: return
        val content = data["content"] as? String ?: ""
        val agentId = data["agentId"] as? String
        val projectId = data["projectId"] as? String
        val modelOverride = data["model"] as? String
        val retryMessageId = data["retryMessageId"] as? String
        val images = (data["images"] as? List<*>).orEmpty().mapNotNull { it as? Map<*, *> }
        val files = (data["attachments"] as? List<*>).orEmpty()
            .mapNotNull { it as? Map<*, *> }
            .filter { (it["dataUrl"] as? String).orEmpty().isNotBlank() }
        val turn = TurnEmitter(conversationId, emit)
        var assistantMessageId: String? = null
        try {
            localData.ensureConversation(
                id = conversationId,
                title = content.lineSequence().firstOrNull()?.take(80).orEmpty().ifBlank { "New Chat" },
                agentId = agentId,
                projectId = projectId,
            )
            turn.event("turn_started")
            validateImages(images)
            validateDataUrlAttachments(files)
            val attachmentMetadata = (images + files).map {
                AttachmentMeta(
                    id = it["id"] as? String ?: UUID.randomUUID().toString(),
                    name = it["name"] as? String ?: "attachment",
                    type = if ((it["mimeType"] as? String)?.startsWith("image/") == true || it in images) "image" else "file",
                    thumbnailDataUrl = (it["dataUrl"] as? String).takeIf { _ -> it in images },
                )
            }
            val user = retryMessageId?.let { localData.getRetryableUserMessage(it, conversationId) }
                ?: localData.insertMessage(
                    conversationId = conversationId,
                    role = "user",
                    content = content,
                    attachments = attachmentMetadata,
                )
            localData.markMessageFailed(user.id, false)
            if (retryMessageId == null) localData.persistDataUrlAttachments(user.id, images + files)
            turn.event("user_message_committed", JSONObject().put("messageId", user.id))
            val provider = providerStore.resolve(modelOverride, projectId, agentId, conversationId)
            if (provider == null) {
                localData.markMessageFailed(user.id, true)
                failTurn(
                    conversationId,
                    turn,
                    "No standalone API key is configured. Add an Anthropic, OpenAI, or OpenRouter key in Settings.",
                )
                emitHistory(conversationId)
                return
            }
            turn.event("model_changed", JSONObject().put("model", provider.defaultModel))
            turn.event(
                "activity_changed",
                JSONObject().put("state", "thinking").put("label", "Contacting ${provider.provider.displayName()}"),
            )
            emit(WsEvent.ChatActivity(conversationId, "thinking", "Assistant is thinking", null, null))
            emitHistory(conversationId)

            val fullHistory = localData.listForProvider(conversationId, user.id).map { message ->
                if (message.id == user.id && files.isNotEmpty()) {
                    message.copy(content = inlineFileContext(files) + message.content)
                } else message
            }
            val agentConfig = agentId?.let { localData.getAgentFull(it) }
            val context = prepareContext(conversationId, fullHistory, provider)
            val history = context.messages
            val assistant = localData.insertMessage(conversationId, "assistant", "", partial = true)
            assistantMessageId = assistant.id
            val accumulator = ResponseAccumulator(conversationId, assistant.id, turn)
            val protocol = protocols.getValue(
                if (provider.provider == "anthropic") "anthropic" else "openai-compatible",
            )
            val request = protocol.createStreamingRequest(
                LlmRequestContext(provider, history, images, agentConfig, context.summary),
            )
            val call = client.newCall(request)
            activeCalls[conversationId] = call
            // Close the small race where the latch flips while this turn is preparing its request.
            if (emergencyStopped) call.cancel()
            withContext(Dispatchers.IO) {
                call.execute().use { response ->
                    if (!response.isSuccessful) {
                        val detail = response.body?.string()?.take(2_000).orEmpty()
                        throw ProviderException(response.code, providerError(detail, response.message))
                    }
                    val source = response.body?.source() ?: throw IOException("Provider returned an empty response")
                    while (!source.exhausted()) {
                        val line = source.readUtf8Line() ?: break
                        if (!line.startsWith("data:")) continue
                        val payload = line.removePrefix("data:").trim()
                        if (payload.isBlank() || payload == "[DONE]") continue
                        val json = runCatching { JSONObject(payload) }.getOrNull() ?: continue
                        protocol.handleStreamingEvent(json, accumulator)
                    }
                }
            }
            accumulator.finish()
            localData.finalizeAssistantMessage(
                id = assistant.id,
                content = accumulator.text,
                thinkingBlocks = accumulator.completedThinkingBlocks(),
                inputTokens = accumulator.inputTokens,
                outputTokens = accumulator.outputTokens,
                provider = provider.provider,
                model = provider.defaultModel,
                finishReason = accumulator.finishReason,
            )
            val totalCost = estimateCostUsd(
                provider = provider.provider,
                model = provider.defaultModel,
                inputTokens = accumulator.inputTokens,
                outputTokens = accumulator.outputTokens,
            )
            turn.event(
                "cost_updated",
                JSONObject()
                    .put("inputTokens", accumulator.inputTokens)
                    .put("outputTokens", accumulator.outputTokens)
                    .put("totalCostUsd", totalCost),
            )
            emit(WsEvent.ChatCost(conversationId, accumulator.inputTokens, accumulator.outputTokens, totalCost))
            turn.event("turn_completed")
            emit(WsEvent.ChatStreamEnd(conversationId))
            emit(WsEvent.ChatActivity(conversationId, "complete", "Complete", null, null))
            emitHistory(conversationId)
        } catch (cancelled: IOException) {
            val cancelledByUser = activeCalls[conversationId]?.isCanceled() == true
            assistantMessageId?.let {
                localData.updateMessageContent(it, "", partial = false, sendFailed = !cancelledByUser)
            }
            if (cancelledByUser) {
                turn.event("turn_completed")
                emit(WsEvent.ChatActivity(conversationId, "complete", "Stopped", null, null))
            } else {
                failTurn(conversationId, turn, cancelled.message ?: "The provider connection was interrupted.")
            }
            emitHistory(conversationId)
        } catch (error: Exception) {
            assistantMessageId?.let { localData.markMessageFailed(it, true) }
            failTurn(conversationId, turn, error.message ?: "Standalone chat failed.")
            emitHistory(conversationId)
        } finally {
            activeCalls.remove(conversationId)
        }
    }

    fun stop(conversationId: String) {
        activeCalls.remove(conversationId)?.cancel()
    }

    fun activateEmergencyStop() {
        emergencyStopped = true
        activeCalls.values.forEach { it.cancel() }
    }

    fun resumeConversations() {
        emergencyStopped = false
    }

    suspend fun test(provider: String, key: String, endpoint: String? = null): Pair<Boolean, String?> =
        withContext(Dispatchers.IO) {
            val baseUrl = endpoint?.trimEnd('/') ?: when (provider) {
                "anthropic" -> "https://api.anthropic.com/v1"
                "openrouter" -> "https://openrouter.ai/api/v1"
                else -> "https://api.openai.com/v1"
            }
            val request = if (provider == "anthropic") {
                Request.Builder()
                    .url("$baseUrl/models?limit=1")
                    .header("x-api-key", key)
                    .header("anthropic-version", "2023-06-01")
                    .get()
                    .build()
            } else {
                Request.Builder()
                    .url("$baseUrl/models")
                    .header("Authorization", "Bearer $key")
                    .get()
                    .build()
            }
            runCatching {
                client.newCall(request).execute().use {
                    if (it.isSuccessful) true to null
                    else false to providerError(it.body?.string().orEmpty(), it.message)
                }
            }.getOrElse { false to (it.message ?: "Connection failed") }
        }

    suspend fun listModels(config: StandaloneProviderConfig): List<ModelOption> =
        withContext(Dispatchers.IO) {
            val apiKey = providerStore.resolveCredential(config) ?: return@withContext emptyList()
            val request = Request.Builder()
                .url("${config.baseUrl}/models")
                .apply {
                    if (config.provider == "anthropic") {
                        header("x-api-key", apiKey)
                        header("anthropic-version", "2023-06-01")
                    } else {
                        header("Authorization", "Bearer $apiKey")
                    }
                }
                .get()
                .build()
            runCatching {
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@use emptyList()
                    val data = JSONObject(response.body?.string().orEmpty()).optJSONArray("data") ?: JSONArray()
                    (0 until data.length()).mapNotNull { index ->
                        val item = data.optJSONObject(index) ?: return@mapNotNull null
                        val id = item.optString("id")
                        if (id.isBlank()) return@mapNotNull null
                        ModelOption(
                            id = id,
                            label = item.optString("display_name").takeIf(String::isNotBlank) ?: id,
                            vendor = config.provider.replaceFirstChar { it.uppercase() },
                        )
                    }
                }
            }.getOrDefault(emptyList())
        }

    private suspend fun emitHistory(conversationId: String) {
        emit(WsEvent.ConversationMessages(conversationId, localData.list(conversationId)))
    }

    private suspend fun failTurn(conversationId: String, turn: TurnEmitter?, message: String) {
        val current = turn ?: TurnEmitter(conversationId, emit).also { it.event("turn_started") }
        current.event(
            "turn_failed",
            JSONObject()
                .put("errorType", "provider")
                .put("message", message)
                .put("retryable", true),
        )
        emit(WsEvent.ChatActivity(conversationId, "error", message, null, null))
    }

    private fun anthropicRequest(
        config: StandaloneProviderConfig,
        history: List<HistoryMessage>,
        images: List<Map<*, *>>,
        agentConfig: AgentFullConfig?,
        conversationSummary: String?,
    ): Request {
        val apiKey = providerStore.resolveCredential(config)
            ?: throw IOException("Standalone provider credential is unavailable")
        val messages = JSONArray()
        history.filter { it.role == "user" || it.role == "assistant" }.forEachIndexed { index, message ->
            val body = JSONObject().put("role", message.role)
            val isLastUser = index == history.lastIndex && message.role == "user"
            if (isLastUser && images.isNotEmpty()) {
                val blocks = JSONArray()
                images.forEach { image ->
                    parseDataUrl(image["dataUrl"] as? String)?.let { parsed ->
                        blocks.put(
                            JSONObject()
                                .put("type", "image")
                                .put(
                                    "source",
                                    JSONObject()
                                        .put("type", "base64")
                                        .put("media_type", parsed.first)
                                        .put("data", parsed.second),
                                ),
                        )
                    }
                }
                if (message.content.isNotBlank()) {
                    blocks.put(JSONObject().put("type", "text").put("text", message.content))
                }
                body.put("content", blocks)
            } else {
                body.put("content", message.content)
            }
            messages.put(body)
        }
        val payload = JSONObject()
            .put("model", config.defaultModel)
            .put("stream", true)
            .put("messages", messages)
        combineSystemPrompt(agentConfig?.systemPrompt, conversationSummary)?.let { payload.put("system", it) }
        val thinkingBudget = when (agentConfig?.thinkingEffort) {
            "low" -> 1_024
            "medium" -> 4_096
            "high" -> 8_192
            "max" -> 16_000
            else -> null
        }
        payload.put("max_tokens", maxOf(agentConfig?.maxTokens ?: 8_192, (thinkingBudget ?: 0) + 2_048))
        thinkingBudget?.let {
            payload.put("thinking", JSONObject().put("type", "enabled").put("budget_tokens", it))
        }
        return Request.Builder()
            .url("${config.baseUrl}/messages")
            .header("x-api-key", apiKey)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .post(payload.toString().toRequestBody(JSON))
            .build()
    }

    private fun validateImages(images: List<Map<*, *>>) {
        var total = 0L
        images.forEach { image ->
            val value = image["dataUrl"] as? String ?: throw IllegalArgumentException("Image data is missing.")
            val comma = value.indexOf(',')
            if (comma <= 5 || !value.substring(0, comma).endsWith(";base64")) {
                throw IllegalArgumentException("Unsupported image encoding.")
            }
            val mime = value.substring(5, comma).removeSuffix(";base64")
            if (!mime.startsWith("image/")) throw IllegalArgumentException("Only image attachments can be sent inline.")
            val estimatedBytes = ((value.length - comma - 1) * 3L) / 4L
            require(estimatedBytes <= 10L * 1024L * 1024L) { "Each image must be 10 MB or smaller." }
            total += estimatedBytes
        }
        require(total <= 20L * 1024L * 1024L) { "Combined image attachments must be 20 MB or smaller." }
    }

    private fun validateDataUrlAttachments(files: List<Map<*, *>>) {
        var total = 0L
        require(files.size <= 20) { "At most 20 files can be attached at once." }
        files.forEach { file ->
            val value = file["dataUrl"] as? String ?: throw IllegalArgumentException("Attachment data is missing.")
            val comma = value.indexOf(',')
            require(comma > 5 && value.substring(0, comma).endsWith(";base64")) { "Unsupported attachment encoding." }
            val estimatedBytes = ((value.length - comma - 1) * 3L) / 4L
            require(estimatedBytes <= 20L * 1024L * 1024L) { "Each file must be 20 MB or smaller." }
            total += estimatedBytes
        }
        require(total <= 50L * 1024L * 1024L) { "Combined file attachments must be 50 MB or smaller." }
    }

    private fun inlineFileContext(files: List<Map<*, *>>): String = buildString {
        files.forEach { file ->
            val name = file["name"] as? String ?: "attachment"
            val dataUrl = file["dataUrl"] as? String
            val decoded = dataUrl?.substringAfter(',', "")?.let { payload ->
                runCatching { android.util.Base64.decode(payload, android.util.Base64.DEFAULT) }.getOrNull()
            }
            val text = decoded?.let { bytes ->
                runCatching {
                    Charsets.UTF_8.newDecoder()
                        .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                        .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                        .decode(java.nio.ByteBuffer.wrap(bytes))
                        .toString()
                }.getOrNull()
            }
            if (text != null) {
                append("File: $name\n```\n$text\n```\n\n")
            } else {
                append("Attached binary file: $name (retained with this message; its contents are not directly readable by this provider).\n\n")
            }
        }
    }

    private fun openAiRequest(
        config: StandaloneProviderConfig,
        history: List<HistoryMessage>,
        images: List<Map<*, *>>,
        agentConfig: AgentFullConfig?,
        conversationSummary: String?,
    ): Request {
        val apiKey = providerStore.resolveCredential(config)
            ?: throw IOException("Standalone provider credential is unavailable")
        val messages = JSONArray()
        combineSystemPrompt(agentConfig?.systemPrompt, conversationSummary)?.let {
            messages.put(JSONObject().put("role", "system").put("content", it))
        }
        history.filter { it.role == "user" || it.role == "assistant" }.forEachIndexed { index, message ->
            val body = JSONObject().put("role", message.role)
            val isLastUser = index == history.lastIndex && message.role == "user"
            if (isLastUser && images.isNotEmpty()) {
                val parts = JSONArray()
                if (message.content.isNotBlank()) {
                    parts.put(JSONObject().put("type", "text").put("text", message.content))
                }
                images.forEach { image ->
                    val dataUrl = image["dataUrl"] as? String
                    if (!dataUrl.isNullOrBlank()) {
                        parts.put(
                            JSONObject()
                                .put("type", "image_url")
                                .put("image_url", JSONObject().put("url", dataUrl)),
                        )
                    }
                }
                body.put("content", parts)
            } else {
                body.put("content", message.content)
            }
            messages.put(body)
        }
        val payload = JSONObject()
            .put("model", config.defaultModel)
            .put("stream", true)
            .put("stream_options", JSONObject().put("include_usage", true))
            .put("messages", messages)
        return Request.Builder()
            .url("${config.baseUrl}/chat/completions")
            .header("Authorization", "Bearer $apiKey")
            .header("content-type", "application/json")
            .apply {
                if (config.provider == "openrouter") {
                    header("HTTP-Referer", "https://nexy.io")
                    header("X-Title", "Nexy Android")
                }
            }
            .post(payload.toString().toRequestBody(JSON))
            .build()
    }

    private suspend fun prepareContext(
        conversationId: String,
        history: List<HistoryMessage>,
        provider: StandaloneProviderConfig,
    ): ContextSelection {
        if (history.sumOf { it.content.length } <= 120_000) return ContextSelection(null, history)
        val recent = truncateHistory(history, maximumCharacters = 80_000)
        val sourceCount = (history.size - recent.size).coerceAtLeast(0)
        val existing = localData.getConversationSummary(conversationId)
        val summary = if (existing != null && existing.sourceMessageCount >= sourceCount) {
            existing.summary
        } else {
            val source = history.take(sourceCount)
            runCatching { summarizeHistory(provider, source, existing?.summary) }
                .getOrElse { deterministicSummary(source) }
                .also { localData.saveConversationSummary(conversationId, it, sourceCount) }
        }
        return ContextSelection(summary, recent)
    }

    private fun summarizeHistory(
        provider: StandaloneProviderConfig,
        history: List<HistoryMessage>,
        previousSummary: String?,
    ): String {
        val apiKey = providerStore.resolveCredential(provider)
            ?: throw IOException("Standalone provider credential is unavailable")
        val transcript = history.joinToString("\n\n") { "${it.role.uppercase()}:\n${it.content}" }
            .takeLast(90_000)
        val instruction = """
            Summarize this older conversation context for continuation. Preserve decisions,
            requirements, names, identifiers, unresolved questions, and factual results. Do not
            add commentary. Return only the compact summary.
        """.trimIndent()
        val prompt = listOfNotNull(
            previousSummary?.takeIf(String::isNotBlank)?.let { "Previous rolling summary:\n$it" },
            "Conversation segment:\n$transcript",
        ).joinToString("\n\n")
        val request = if (provider.provider == "anthropic") {
            val body = JSONObject()
                .put("model", provider.defaultModel)
                .put("max_tokens", 1_500)
                .put("system", instruction)
                .put(
                    "messages",
                    JSONArray().put(JSONObject().put("role", "user").put("content", prompt)),
                )
            Request.Builder()
                .url("${provider.baseUrl}/messages")
                .header("x-api-key", apiKey)
                .header("anthropic-version", "2023-06-01")
                .post(body.toString().toRequestBody(JSON))
                .build()
        } else {
            val body = JSONObject()
                .put("model", provider.defaultModel)
                .put(
                    "messages",
                    JSONArray()
                        .put(JSONObject().put("role", "system").put("content", instruction))
                        .put(JSONObject().put("role", "user").put("content", prompt)),
                )
            Request.Builder()
                .url("${provider.baseUrl}/chat/completions")
                .header("Authorization", "Bearer $apiKey")
                .post(body.toString().toRequestBody(JSON))
                .build()
        }
        return client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Context summarization failed with HTTP ${response.code}")
            val json = JSONObject(response.body?.string().orEmpty())
            if (provider.provider == "anthropic") {
                val content = json.optJSONArray("content") ?: JSONArray()
                (0 until content.length()).joinToString("") { content.optJSONObject(it)?.optString("text").orEmpty() }
            } else {
                json.optJSONArray("choices")?.optJSONObject(0)
                    ?.optJSONObject("message")
                    ?.optString("content")
                    .orEmpty()
            }.ifBlank { throw IOException("Context summarization returned no text") }
        }
    }

    private fun deterministicSummary(history: List<HistoryMessage>): String =
        history.takeLast(20).joinToString("\n") {
            "${it.role}: ${it.content.replace(Regex("\\s+"), " ").take(500)}"
        }

    private inner class ResponseAccumulator(
        private val conversationId: String,
        private val messageId: String,
        private val turn: TurnEmitter,
    ) : LlmEventSink {
        val buffer = StringBuilder()
        val thinkingBlocks = linkedMapOf<String, StringBuilder>()
        override var inputTokens: Int = 0
        override var outputTokens: Int = 0
        override var finishReason: String? = null
        private var lastCheckpointLength = 0

        val text: String get() = buffer.toString()

        override suspend fun text(chunk: String) {
            if (chunk.isEmpty()) return
            buffer.append(chunk)
            turn.event("assistant_text_delta", JSONObject().put("chunk", chunk))
            emit(WsEvent.ChatStreamChunk(conversationId, chunk))
            if (buffer.length - lastCheckpointLength >= 256) {
                localData.updateMessageContent(messageId, buffer.toString(), partial = true)
                lastCheckpointLength = buffer.length
            }
        }

        override fun startThinking(blockId: String) {
            thinkingBlocks.getOrPut(blockId) { StringBuilder() }
        }

        override suspend fun thinking(blockId: String, chunk: String) {
            if (chunk.isEmpty()) return
            thinkingBlocks.getOrPut(blockId) { StringBuilder() }.append(chunk)
            turn.event("thinking_delta", JSONObject().put("blockId", blockId).put("chunk", chunk))
            emit(WsEvent.ChatThinkingDelta(conversationId, blockId, chunk))
        }

        override suspend fun endThinking(blockId: String) {
            if (blockId !in thinkingBlocks) return
            turn.event("thinking_done", JSONObject().put("blockId", blockId))
            emit(WsEvent.ChatThinkingEnd(conversationId, blockId))
        }

        suspend fun finish() {
            thinkingBlocks.keys.forEach { endThinking(it) }
        }

        fun completedThinkingBlocks(): List<ThinkingBlock> =
            thinkingBlocks.map { (id, content) -> ThinkingBlock(id, content.toString(), done = true) }
    }

    private class TurnEmitter(
        private val conversationId: String,
        private val emit: suspend (WsEvent) -> Unit,
    ) {
        private val turnId = UUID.randomUUID().toString()
        private var sequence = 0L

        suspend fun event(type: String, payload: JSONObject = JSONObject()) {
            sequence += 1
            emit(
                WsEvent.ChatTurnEvent(
                    conversationId = conversationId,
                    turnId = turnId,
                    sequence = sequence,
                    type = type,
                    timestamp = System.currentTimeMillis(),
                    payloadJson = payload.toString(),
                ),
            )
        }
    }

    private class ProviderException(status: Int, message: String) :
        IOException(if (status > 0) "Provider returned HTTP $status: $message" else message)

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()

        private fun String.displayName() = when (this) {
            "anthropic" -> "Anthropic"
            "openrouter" -> "OpenRouter"
            else -> "OpenAI"
        }

        private fun parseDataUrl(value: String?): Pair<String, String>? {
            if (value.isNullOrBlank() || !value.startsWith("data:")) return null
            val comma = value.indexOf(',')
            if (comma <= 5) return null
            val metadata = value.substring(5, comma)
            if (!metadata.endsWith(";base64")) return null
            return metadata.removeSuffix(";base64") to value.substring(comma + 1)
        }

        private fun providerError(body: String, fallback: String): String = runCatching {
            val json = JSONObject(body)
            json.optJSONObject("error")?.optString("message")
                ?: json.optString("message")
        }.getOrNull()?.takeIf(String::isNotBlank) ?: fallback

        // Standalone chat never offers any tool schema to the provider, for any model — unlike
        // the desktop's noToolSupportNotice (chat-provider-dispatch.ts), which only fires when
        // tools *were* configured but the specific model can't call them. Here no model, however
        // capable, has a way to actually touch the filesystem, so the guardrail must be
        // unconditional or a confident model will "helpfully" narrate a fake file-write and claim
        // success, matching desktop's HermesHallucination failure mode but without ever having
        // been offered a tool to hallucinate about in the first place.
        private const val STANDALONE_CAPABILITY_NOTICE =
            "\n\nIMPORTANT: This is a standalone chat session with no file system, workspace, or tool " +
                "access of any kind. You cannot read, write, or modify files, run code, browse the " +
                "project, or perform any action outside this conversation. If the user asks for something " +
                "that would require file or workspace access, say plainly that standalone mode does not " +
                "support that and suggest connecting to the paired desktop app. Do NOT claim to have " +
                "created, read, or modified any file, and do NOT invent a result as if such an action had " +
                "been performed."

        private fun combineSystemPrompt(agentPrompt: String?, summary: String?): String? {
            val sections = buildList {
                agentPrompt?.takeIf(String::isNotBlank)?.let(::add)
                summary?.takeIf(String::isNotBlank)?.let {
                    add("Earlier conversation summary:\n$it")
                }
            }
            val base = sections.joinToString("\n\n")
            return base + STANDALONE_CAPABILITY_NOTICE
        }

        /**
         * A conservative, deterministic budget until provider-specific tokenizers are available.
         * Four UTF-16 characters per token is intentionally pessimistic for prose and keeps the
         * request well below the smallest supported standalone context window.
         */
        internal fun truncateHistory(
            history: List<HistoryMessage>,
            maximumCharacters: Int = 120_000,
        ): List<HistoryMessage> {
            if (history.sumOf { it.content.length } <= maximumCharacters) return history
            var remaining = maximumCharacters
            val retained = ArrayDeque<HistoryMessage>()
            for (message in history.asReversed()) {
                if (retained.isNotEmpty() && message.content.length > remaining) break
                retained.addFirst(message)
                remaining -= message.content.length
                if (remaining <= 0) break
            }
            return retained.toList()
        }

        /**
         * Versioned standard API rates, USD per million tokens, reviewed 2026-07-04.
         * Unknown and OpenRouter-routed models intentionally return zero rather than presenting
         * an inaccurate charge; token usage remains visible.
         */
        internal fun estimateCostUsd(
            provider: String,
            model: String,
            inputTokens: Int,
            outputTokens: Int,
        ): Double {
            if (provider == "openrouter") return 0.0
            val rates = when {
                model.startsWith("claude-sonnet-4-6") -> 3.0 to 15.0
                model == "gpt-5.4" -> 2.5 to 15.0
                model == "gpt-5.4-mini" -> 0.75 to 4.5
                else -> return 0.0
            }
            return inputTokens * rates.first / 1_000_000.0 +
                outputTokens * rates.second / 1_000_000.0
        }
    }

    private data class ContextSelection(
        val summary: String?,
        val messages: List<HistoryMessage>,
    )
}

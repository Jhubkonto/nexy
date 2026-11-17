package io.nexy.android.data

import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.HistoryMessage
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException

data class LlmRequestContext(
    val config: StandaloneProviderConfig,
    val history: List<HistoryMessage>,
    val images: List<Map<*, *>>,
    val agentConfig: AgentFullConfig?,
    val conversationSummary: String?,
    val thinkingEffort: String? = null,
)

interface LlmEventSink {
    var inputTokens: Int
    var outputTokens: Int
    var finishReason: String?

    suspend fun text(chunk: String)
    fun startThinking(blockId: String)
    suspend fun thinking(blockId: String, chunk: String)
    suspend fun endThinking(blockId: String)
}

/**
 * Provider-neutral boundary used by standalone chat orchestration. Implementations own request
 * encoding and stream-event normalization; persistence and UI events remain provider-independent.
 */
interface LlmProvider {
    val providerId: String
    fun createStreamingRequest(context: LlmRequestContext): Request
    suspend fun handleStreamingEvent(event: JSONObject, sink: LlmEventSink)
}

internal class LambdaLlmProvider(
    override val providerId: String,
    private val requestFactory: (LlmRequestContext) -> Request,
    private val eventHandler: suspend (JSONObject, LlmEventSink) -> Unit,
) : LlmProvider {
    override fun createStreamingRequest(context: LlmRequestContext): Request = requestFactory(context)
    override suspend fun handleStreamingEvent(event: JSONObject, sink: LlmEventSink) = eventHandler(event, sink)
}

internal suspend fun parseAnthropicStreamEvent(event: JSONObject, sink: LlmEventSink) {
    when (event.optString("type")) {
        "message_start" -> sink.inputTokens =
            event.optJSONObject("message")?.optJSONObject("usage")?.optInt("input_tokens", 0) ?: 0
        "content_block_start" -> if (
            event.optJSONObject("content_block")?.optString("type") == "thinking"
        ) sink.startThinking(event.optInt("index", 0).toString())
        "content_block_delta" -> {
            val delta = event.optJSONObject("delta") ?: return
            when (delta.optString("type")) {
                "text_delta" -> sink.text(delta.optString("text"))
                "thinking_delta" -> sink.thinking(
                    event.optInt("index", 0).toString(),
                    delta.optString("thinking"),
                )
            }
        }
        "content_block_stop" -> sink.endThinking(event.optInt("index", 0).toString())
        "message_delta" -> {
            sink.finishReason = event.optJSONObject("delta")?.optString("stop_reason")
                ?.takeIf(String::isNotBlank)
            sink.outputTokens = event.optJSONObject("usage")?.optInt("output_tokens", 0)
                ?: sink.outputTokens
        }
        "error" -> throw IOException(
            event.optJSONObject("error")?.optString("message") ?: "Anthropic stream error",
        )
    }
}

internal suspend fun parseOpenAiStreamEvent(event: JSONObject, sink: LlmEventSink) {
    event.optJSONObject("usage")?.let {
        sink.inputTokens = it.optInt("prompt_tokens", sink.inputTokens)
        sink.outputTokens = it.optInt("completion_tokens", sink.outputTokens)
    }
    val choice = event.optJSONArray("choices")?.optJSONObject(0) ?: return
    sink.finishReason = choice.optString("finish_reason").takeIf(String::isNotBlank) ?: sink.finishReason
    val delta = choice.optJSONObject("delta") ?: return
    delta.optString("reasoning_content").takeIf(String::isNotEmpty)
        ?.let { sink.thinking("reasoning", it) }
    delta.optString("content").takeIf(String::isNotEmpty)?.let { sink.text(it) }
}

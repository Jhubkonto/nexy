package io.nexy.android.data

import io.nexy.android.data.model.HistoryMessage
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

/** Same version-one wire record as desktop. Display text remains independent. */
internal object ConversationContinuity {
    fun submitted(text: String, images: List<Map<*, *>>, backend: String): String {
        val content: Any = if (images.isEmpty()) text else JSONArray().apply {
            put(JSONObject().put("type", "text").put("text", text))
            images.forEach { image ->
                put(JSONObject().put("type", "image_url").put("image_url", JSONObject().put("url", image["dataUrl"])))
            }
        }
        return JSONObject().put("version", 1).put("backend", backend).put("status", "complete")
            .put("submitted", content).put("exchange", JSONArray()).toString()
    }

    fun assistant(text: String, backend: String, interrupted: Boolean = false): String =
        JSONObject().put("version", 1).put("backend", backend).put("status", if (interrupted) "interrupted" else "complete")
            .put("exchange", JSONArray().put(JSONObject().put("role", "assistant").put("content", text))).toString()

    private fun record(message: HistoryMessage): JSONObject? = runCatching {
        JSONObject(message.continuationJson ?: return null).takeIf {
            it.optInt("version") == 1 && it.optJSONArray("exchange") != null && validExchange(it.getJSONArray("exchange"))
        }
    }.getOrNull()

    private fun validExchange(exchange: JSONArray): Boolean {
        val pending = mutableSetOf<String>()
        val seen = mutableSetOf<String>()
        for (index in 0 until exchange.length()) {
            val message = exchange.optJSONObject(index) ?: return false
            when (message.optString("role")) {
                "tool" -> if (!pending.remove(message.optString("tool_call_id"))) return false
                "assistant", "user" -> {
                    if (pending.isNotEmpty()) return false
                    val calls = message.optJSONArray("tool_calls") ?: JSONArray()
                    for (callIndex in 0 until calls.length()) {
                        val call = calls.optJSONObject(callIndex) ?: return false
                        val id = call.optString("id")
                        if (id.isBlank() || !seen.add(id) || call.optJSONObject("function") == null) return false
                        pending.add(id)
                    }
                }
                else -> return false
            }
        }
        return pending.isEmpty()
    }

    private fun text(content: Any?): String = when (content) {
        is String -> content
        is JSONArray -> (0 until content.length()).mapNotNull { index ->
            content.optJSONObject(index)?.takeIf { it.optString("type") == "text" }?.optString("text")
        }.joinToString("\n")
        else -> ""
    }

    private fun images(content: Any?): List<Map<*, *>> {
        if (content !is JSONArray) return emptyList()
        return (0 until content.length()).mapNotNull { index ->
            val url = content.optJSONObject(index)?.optJSONObject("image_url")?.optString("url")
            url?.takeIf { it.startsWith("data:image/") }?.let { mapOf("dataUrl" to it) }
        }
    }

    fun restore(history: List<HistoryMessage>): List<HistoryMessage> = history.mapNotNull { message ->
        if (message.role == "team-activity") return@mapNotNull null
        val saved = record(message)
        if (message.role == "user" && saved?.has("submitted") == true) {
            val content = saved.get("submitted")
            val checkpoint = saved.optJSONArray("exchange")
            val interrupted = if (checkpoint != null && checkpoint.length() > 0)
                restore(listOf(message.copy(role = "assistant", content = "", continuationJson = saved.toString()))).singleOrNull() else null
            message.copy(content = text(content) + (interrupted?.let { "\n${it.content}" } ?: ""),
                requestImages = images(content) + interrupted?.requestImages.orEmpty())
        } else if (message.role == "assistant") {
            val exchange = saved?.optJSONArray("exchange") ?: runCatching {
                JSONObject(message.providerHistory ?: "").optJSONArray("messages")?.takeIf(::validExchange)
            }.getOrNull()
            if (exchange == null || exchange.length() == 0) message else {
                val restoredImages = mutableListOf<Map<*, *>>()
                val transcript = (0 until exchange.length()).joinToString("\n\n") { index ->
                    val entry = exchange.getJSONObject(index)
                    restoredImages.addAll(images(entry.opt("content")))
                    val toolImages = entry.optJSONArray("images") ?: JSONArray()
                    for (i in 0 until toolImages.length()) {
                        toolImages.optJSONObject(i)?.optString("dataUrl")?.let { restoredImages.add(mapOf("dataUrl" to it)) }
                    }
                    val calls = entry.optJSONArray("tool_calls") ?: JSONArray()
                    val callText = (0 until calls.length()).joinToString("\n") { callIndex ->
                        val call = calls.getJSONObject(callIndex)
                        val function = call.getJSONObject("function")
                        "Historical tool call (${call.optString("id")}): ${function.optString("name")}(${function.optString("arguments")})"
                    }
                    "${entry.optString("role")}: ${text(entry.opt("content"))}" + if (callText.isEmpty()) "" else "\n$callText"
                }
                message.copy(content = "[Historical exchange, already executed]\n$transcript", requestImages = restoredImages)
            }
        } else if (message.role == "tool-call") {
            // Exact replay already covers modern traces. Keep recoverable legacy results as text.
            val position = history.indexOf(message)
            val nextUser = history.drop(position + 1).indexOfFirst { it.role == "user" }.let { if (it < 0) history.size else position + 1 + it }
            val previousUser = history.take(position).indexOfLast { it.role == "user" }.coerceAtLeast(0)
            val covered = history.subList(previousUser, nextUser).any { record(it)?.optJSONArray("exchange")?.length()?.let { n -> n > 0 } == true || it.providerHistory != null }
            if (covered) null else message.copy(role = "assistant", content = "[Historical tool activity]\n${message.content}")
        } else message
    }

    fun revision(history: List<HistoryMessage>): String {
        val source = JSONArray().apply { history.forEach { put(JSONArray().put(it.id).put(it.content).put(it.continuationJson)) } }
        return MessageDigest.getInstance("SHA-256").digest(source.toString().toByteArray())
            .joinToString("") { "%02x".format(it) }
    }

    fun estimatedTokens(message: HistoryMessage): Int = (message.content.length + 3) / 4 + message.requestImages.size * 1000 + 12

    fun imageDescription(url: String, history: List<HistoryMessage>): String {
        val key = MessageDigest.getInstance("SHA-256").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
        for (message in history.asReversed()) {
            val text = record(message)?.optJSONObject("imageDescriptions")?.optString(key)
            if (!text.isNullOrBlank()) return text
        }
        return "[Image attached — OCR unavailable]"
    }
}

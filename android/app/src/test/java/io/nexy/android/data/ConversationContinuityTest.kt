package io.nexy.android.data

import io.nexy.android.data.model.HistoryMessage
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ConversationContinuityTest {
    @Test fun restoresSubmittedContentAndImagesWithoutSourceFiles() {
        val saved = ConversationContinuity.submitted("expanded reference and attachment contents", listOf(mapOf("dataUrl" to "data:image/png;base64,c2F2ZWQ=")), "openai")
        val restored = ConversationContinuity.restore(listOf(HistoryMessage("u", "user", "display text", 1, continuationJson = saved))).single()
        assertEquals("expanded reference and attachment contents", restored.content)
        assertEquals("data:image/png;base64,c2F2ZWQ=", restored.requestImages.single()["dataUrl"])
        assertTrue(ConversationContinuity.estimatedTokens(restored) > 1000)
    }

    @Test fun replaysDesktopToolResultsAsHistoryWithoutProviderReasoning() {
        val calls = JSONArray().put(JSONObject().put("id", "read").put("type", "function").put("function", JSONObject().put("name", "read_file").put("arguments", "{}")))
        val exchange = JSONArray()
            .put(JSONObject().put("role", "assistant").put("content", "Inspecting").put("reasoning_content", "private reasoning").put("tool_calls", calls))
            .put(JSONObject().put("role", "tool").put("tool_call_id", "read").put("content", "the file says forty-two"))
            .put(JSONObject().put("role", "assistant").put("content", "Done"))
        val saved = JSONObject().put("version", 1).put("backend", "deepseek").put("status", "complete").put("exchange", exchange).toString()
        val restored = ConversationContinuity.restore(listOf(HistoryMessage("a", "assistant", "Done", 2, continuationJson = saved))).single()
        assertTrue(restored.content.contains("the file says forty-two"))
        assertTrue(restored.content.contains("Historical tool call"))
        assertFalse(restored.content.contains("private reasoning"))
    }

    @Test fun changesSummaryCoverageAfterAnEditWithTheSameLength() {
        val first = listOf(HistoryMessage("u", "user", "first", 1))
        val edited = listOf(HistoryMessage("u", "user", "other", 1))
        assertNotEquals(ConversationContinuity.revision(first), ConversationContinuity.revision(edited))
    }

    @Test fun reusesDesktopImageDescriptionsForTextOnlyModels() {
        val url = "data:image/png;base64,c2F2ZWQ="
        val hash = java.security.MessageDigest.getInstance("SHA-256").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
        val saved = JSONObject(ConversationContinuity.submitted("image", emptyList(), "openai"))
            .put("imageDescriptions", JSONObject().put(hash, "[OCR text: original label]")).toString()
        val history = listOf(HistoryMessage("u", "user", "image", 1, continuationJson = saved))
        assertEquals("[OCR text: original label]", ConversationContinuity.imageDescription(url, history))
        assertEquals("[Image attached — OCR unavailable]", ConversationContinuity.imageDescription("other", history))
    }
}

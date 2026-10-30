package io.nexy.android.data

import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkHistoryClientTest {
    private class FakeWs : WsClient {
        override val events = MutableSharedFlow<WsEvent>(extraBufferCapacity = 8)
        val sent = mutableListOf<Pair<String, Map<String, Any>>>()
        override fun send(command: String, data: Map<String, Any>) { sent.add(command to data) }
    }

    @Test
    fun matchesConcurrentResponsesAndPropagatesErrors() = runTest {
        val ws = FakeWs()
        val client = WorkHistoryClient(ws)
        val first = async { client.request("list") }
        val second = async { runCatching { client.request("get", mapOf("id" to "run")) } }
        runCurrent()
        val firstId = ws.sent[0].second.getValue("requestId") as String
        val secondId = ws.sent[1].second.getValue("requestId") as String
        assertNotEquals(firstId, secondId)
        ws.events.emit(WsEvent.WorkHistoryResult(secondId, "work-history:get", null, "missing"))
        ws.events.emit(WsEvent.WorkHistoryResult(firstId, "work-history:list", "reports", null))
        assertEquals("reports", first.await())
        assertEquals("missing", second.await().exceptionOrNull()?.message)
        assertTrue(ws.sent[1].second["id"] == "run")
    }
}

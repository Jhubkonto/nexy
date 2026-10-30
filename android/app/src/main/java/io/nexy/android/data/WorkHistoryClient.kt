package io.nexy.android.data

import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import java.util.UUID

/** A single response belongs to a single request, even when operations overlap. */
class WorkHistoryClient(private val ws: WsClient) {
    suspend fun request(operation: String, payload: Map<String, Any> = emptyMap()): Any? = coroutineScope {
        require(operation in setOf("preview", "start", "list", "get", "cancel", "capabilities"))
        val command = "work-history:$operation"
        val requestId = UUID.randomUUID().toString()
        // Subscribe before sending: a local or test transport may answer immediately.
        val response = async(start = CoroutineStart.UNDISPATCHED) {
            ws.events.filterIsInstance<WsEvent.WorkHistoryResult>().first {
                it.requestId == requestId && it.operation == command
            }
        }
        ws.send(command, payload + ("requestId" to requestId))
        val result = response.await()
        if (result.error != null) throw IllegalStateException(result.error)
        result.result
    }
}

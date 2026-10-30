package io.nexy.android.ui.home

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WorkHistoryClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.workHistoryDateRange
import io.nexy.android.ui.components.NexyTopAppBar
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters
import java.time.DayOfWeek
import java.text.DateFormat
import java.util.Date
import java.util.UUID

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
private fun JSONObject.label(key: String, fallback: String): String = optString(key).takeIf { it.isNotBlank() && it != "null" } ?: fallback

@Composable
private fun HistoryChoice(label: String, value: String, options: List<Pair<String, String>>, onChange: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { expanded = true }) { Text("$label: ${options.find { it.first == value }?.second ?: value}") }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (id, name) ->
                DropdownMenuItem(text = { Text(name) }, onClick = { expanded = false; onChange(id) })
            }
        }
    }
}

@Composable
fun WorkHistoryScreen(onBack: () -> Unit, onOpenChat: (String) -> Unit) {
    val connection by WsRepository.connectionState.collectAsStateWithLifecycle()
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val agents by WsRepository.agents.collectAsStateWithLifecycle()
    val client = remember { WorkHistoryClient(WsRepository) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var from by remember { mutableStateOf(LocalDate.now().toString()) }
    var through by remember { mutableStateOf(from) }
    var model by remember { mutableStateOf("gpt-5-mini") }
    var grouping by remember { mutableStateOf("project") }
    var instructions by remember { mutableStateOf("") }
    var project by remember { mutableStateOf("all") }
    var agent by remember { mutableStateOf("all") }
    var sources by remember { mutableStateOf<List<JSONObject>?>(null) }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var runs by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var activeId by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var capabilities by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var pendingStart by remember { mutableStateOf<Pair<String, Map<String, Any>>?>(null) }

    suspend fun call(operation: String, payload: Map<String, Any> = emptyMap()): Any? {
        check(WsRepository.connectionState.value == ConnectionState.CONNECTED) { "Connect to the desktop to use work history." }
        return try { withTimeout(15000) { client.request(operation, payload) } }
        catch (_: TimeoutCancellationException) { throw IllegalStateException("Desktop did not respond. Reconnect and try again.") }
    }
    fun request(): Map<String, Any> {
        val range = workHistoryDateRange(LocalDate.parse(from), LocalDate.parse(through), ZoneId.systemDefault())
        return buildMap {
            put("start", range.start); put("end", range.end); put("model", model)
            put("grouping", grouping); put("instructions", instructions)
            if (project != "all") put("projectId", if (project == "none") JSONObject.NULL else project)
            if (agent != "all") put("agentId", if (agent == "none") JSONObject.NULL else agent)
        }
    }
    fun action(block: suspend () -> Unit) {
        scope.launch {
            busy = true; error = null
            try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) {
                error = e.message ?: "Request failed. Check the date format and desktop connection."
            } finally { busy = false }
        }
    }
    LaunchedEffect(connection) {
        if (connection == ConnectionState.CONNECTED) {
            try { capabilities = (call("capabilities") as? JSONArray)?.objects() ?: emptyList() }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "Could not load backend availability." }
            while (true) {
                try {
                    runs = (call("list") as? JSONArray)?.objects() ?: emptyList()
                    if (pendingStart != null && runs.any { it.optString("id") == pendingStart?.first }) pendingStart = null
                }
                catch (e: CancellationException) { throw e }
                catch (e: Exception) { error = e.message ?: "Could not load reports." }
                delay(3000)
            }
        }
    }
    LaunchedEffect(from, through, project, agent) { sources = null; selected = emptySet() }
    val active = runs.find { it.optString("id") == activeId }
    Scaffold(topBar = { NexyTopAppBar(titleContent = { Text("Work history") }, onBack = onBack) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Reports use the connected desktop's chats. Android changes not yet synchronized are absent.", style = MaterialTheme.typography.bodySmall)
            if (connection != ConnectionState.CONNECTED) Text("Connect to the desktop to continue.", color = MaterialTheme.colorScheme.error)
            OutlinedTextField(value = from, onValueChange = { from = it }, label = { Text("From (YYYY-MM-DD)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = through, onValueChange = { through = it }, label = { Text("Through (YYYY-MM-DD)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            TextButton(onClick = {
                try { val monday = LocalDate.parse(from).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)); from = monday.toString(); through = monday.plusDays(6).toString() }
                catch (_: Exception) { error = "Enter a valid start date (YYYY-MM-DD)." }
            }) { Text("Select Monday–Sunday week") }
            HistoryChoice("Project", project, listOf("all" to "All", "none" to "Unassigned") + projects.map { it.id to it.name }) { project = it }
            HistoryChoice("Agent", agent, listOf("all" to "All", "none" to "Unassigned") + agents.map { it.id to it.name }) { agent = it }
            OutlinedTextField(value = model, onValueChange = { model = it }, label = { Text("API model or Claude CLI") }, supportingText = { Text("Use claude-cli or claude-cli:sonnet for Claude Code.") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            HistoryChoice("Backend", if (model.startsWith("claude-cli")) "claude" else "api", capabilities.filter { it.optBoolean("available") }.map { it.optString("id") to it.optString("id") }) {
                model = if (it == "claude") "claude-cli" else "gpt-5-mini"
            }
            capabilities.forEach { backend -> Text("${backend.optString("id")}: ${backend.optString("reason")}", style = MaterialTheme.typography.bodySmall) }
            HistoryChoice("Group by", grouping, listOf("project" to "Project", "chat" to "Chat", "agent" to "Agent", "custom" to "Custom")) { grouping = it }
            OutlinedTextField(value = instructions, onValueChange = { instructions = it }, label = { Text("Instructions (optional)") }, modifier = Modifier.fillMaxWidth())
            Button(enabled = !busy && connection == ConnectionState.CONNECTED, onClick = { action {
                val result = (call("preview", mapOf("request" to request())) as? JSONArray)?.objects() ?: emptyList()
                sources = result; selected = result.map { it.optString("id") }.toSet()
            } }) { Text("Preview matching chats") }
            sources?.let { items ->
                Text("${items.size} matching chats · approximately ${items.filter { it.optString("id") in selected }.sumOf { it.optInt("estimatedCharacters") }} characters selected")
                items.forEach { source ->
                    val id = source.optString("id")
                    Row(Modifier.fillMaxWidth()) {
                        Checkbox(checked = id in selected, onCheckedChange = { selected = if (it) selected + id else selected - id })
                        Text("${source.label("title", "Untitled")} · ${source.label("projectName", "No project")} · ${source.label("agentName", "No agent")} · ${source.optInt("messageCount")} messages${if (source.optBoolean("archived")) " · archived" else ""}", modifier = Modifier.padding(top = 12.dp))
                    }
                }
                Button(enabled = selected.isNotEmpty() && pendingStart == null && !busy && connection == ConnectionState.CONNECTED, onClick = { action {
                    val pending = UUID.randomUUID().toString() to (request() + ("conversationIds" to selected.sorted()))
                    pendingStart = pending
                    activeId = pending.first
                    call("start", mapOf("runId" to pending.first, "request" to pending.second))
                    pendingStart = null
                    runs = (call("list") as? JSONArray)?.objects() ?: emptyList()
                } }) { Text("Generate report") }
            }
            pendingStart?.let { pending ->
                Text("Start acknowledgement was not received. Retry the same request or check saved reports after reconnecting.")
                TextButton(enabled = !busy && connection == ConnectionState.CONNECTED, onClick = { action {
                    call("start", mapOf("runId" to pending.first, "request" to pending.second))
                    pendingStart = null
                    activeId = pending.first
                    runs = (call("list") as? JSONArray)?.objects() ?: emptyList()
                } }) { Text("Retry start") }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            HorizontalDivider()
            Text("Saved reports", style = MaterialTheme.typography.titleMedium)
            runs.forEach { run ->
                TextButton(onClick = { activeId = run.optString("id") }) {
                    Text("${DateFormat.getDateTimeInstance().format(Date(run.optLong("createdAt")))} · ${run.optString("status")}")
                }
            }
            active?.let { run ->
                Text(run.optString("progress") + run.label("error", "").let { if (it.isEmpty()) "" else ": $it" })
                if (run.optString("status") == "running") TextButton(enabled = !busy && connection == ConnectionState.CONNECTED, onClick = { action { call("cancel", mapOf("id" to run.optString("id"))) } }) { Text("Cancel") }
                val report = run.label("report", "")
                if (report.isNotEmpty()) {
                    Text(report)
                    Row {
                        TextButton(onClick = { clipboard.setText(AnnotatedString(report)) }) { Text("Copy") }
                        TextButton(onClick = { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, report), "Share report")) }) { Text("Share") }
                    }
                }
                Text("Sources", style = MaterialTheme.typography.titleSmall)
                run.optJSONArray("sources")?.objects()?.forEach { source ->
                    val available = source.optBoolean("available", false)
                    TextButton(enabled = available, onClick = { onOpenChat(source.optString("id")) }) { Text(source.label("title", "Untitled") + if (available) "" else " (unavailable)") }
                }
            }
        }
    }
}

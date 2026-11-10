package io.nexy.android.ui.home

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WorkHistoryClient
import io.nexy.android.data.WorkHistoryPreset
import io.nexy.android.data.WorkHistoryRemoteException
import io.nexy.android.data.WsRepository
import io.nexy.android.data.cleanWorkHistoryTitle
import io.nexy.android.data.workHistoryDateRange
import io.nexy.android.data.workHistoryModelValue
import io.nexy.android.data.workHistoryPresetDates
import io.nexy.android.data.workHistoryRangeLabel
import io.nexy.android.data.workHistoryReportModels
import io.nexy.android.data.workHistoryReportWithTitles
import io.nexy.android.ui.chat.ChatMarkdownText
import io.nexy.android.ui.chat.LocalMarkwon
import io.nexy.android.ui.chat.rememberChatMarkwon
import io.nexy.android.ui.chat.ModelPickerSheet
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyStatusBadge
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import io.nexy.android.ui.model.activeModelLabel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Date
import java.util.UUID

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
private fun JSONObject.text(key: String): String? = optString(key).takeIf { it.isNotBlank() && it != "null" }

/** The request reached the desktop, but no reply arrived in time — the outcome is unknown. */
private class WorkHistoryNoReply : Exception("The desktop did not respond. Check the connection and try again.")

private val GROUPINGS = listOf("project" to "Project", "chat" to "Chat", "agent" to "Agent", "custom" to "Custom")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkHistoryScreen(onBack: () -> Unit, onOpenChat: (String) -> Unit, initialRunId: String? = null) {
    val connection by WsRepository.connectionState.collectAsStateWithLifecycle()
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val agents by WsRepository.agents.collectAsStateWithLifecycle()
    val allModels by WsRepository.models.collectAsStateWithLifecycle()
    val cliStatus by WsRepository.cliStatus.collectAsStateWithLifecycle()
    val effectiveMode by WsRepository.effectiveMode.collectAsStateWithLifecycle()
    val models = remember(allModels) { workHistoryReportModels(allModels) }
    val client = remember { WorkHistoryClient(WsRepository) }
    val scope = rememberCoroutineScope()
    val connected = connection == ConnectionState.CONNECTED
    val zone = remember { ZoneId.systemDefault() }

    var tab by rememberSaveable { mutableIntStateOf(if (initialRunId != null) 1 else 0) }
    var preset by rememberSaveable { mutableStateOf(WorkHistoryPreset.TODAY) }
    var customFirst by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    var customLast by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    var project by rememberSaveable { mutableStateOf("all") }
    var agent by rememberSaveable { mutableStateOf("all") }
    var modelId by rememberSaveable { mutableStateOf<String?>(null) }
    var grouping by rememberSaveable { mutableStateOf("project") }
    var instructions by rememberSaveable { mutableStateOf("") }
    var activeId by rememberSaveable { mutableStateOf(initialRunId) }

    var sources by remember { mutableStateOf<List<JSONObject>?>(null) }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var previewing by remember { mutableStateOf(false) }
    var runs by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var starting by remember { mutableStateOf(false) }
    var pendingStart by remember { mutableStateOf<Pair<String, Map<String, Any>>?>(null) }
    var showModelSheet by remember { mutableStateOf(false) }
    var showDatePicker by remember { mutableStateOf(false) }

    val (first, last) = workHistoryPresetDates(preset, LocalDate.now())
        ?: (LocalDate.parse(customFirst) to LocalDate.parse(customLast))

    suspend fun call(operation: String, payload: Map<String, Any> = emptyMap()): Any? {
        check(WsRepository.connectionState.value == ConnectionState.CONNECTED) { "Connect to the desktop to use work history." }
        return try {
            withTimeout(15_000) { client.request(operation, payload) }
        } catch (_: TimeoutCancellationException) {
            throw WorkHistoryNoReply()
        }
    }

    fun request(): Map<String, Any> {
        val range = workHistoryDateRange(first, last, zone)
        return buildMap {
            put("start", range.start); put("end", range.end)
            put("model", workHistoryModelValue(modelId, models))
            put("grouping", grouping); put("instructions", instructions.trim())
            if (project != "all") put("projectId", if (project == "none") JSONObject.NULL else project)
            if (agent != "all") put("agentId", if (agent == "none") JSONObject.NULL else agent)
        }
    }

    suspend fun refreshRuns() {
        runs = (call("list") as? JSONArray)?.objects() ?: emptyList()
        pendingStart?.let { pending -> if (runs.any { it.optString("id") == pending.first }) { pendingStart = null; activeId = pending.first } }
    }

    fun start(runId: String, payload: Map<String, Any>) {
        scope.launch {
            starting = true; error = null
            try {
                call("start", mapOf("runId" to runId, "request" to payload))
                pendingStart = null
                activeId = runId
                tab = 1
                refreshRuns()
            } catch (e: CancellationException) {
                throw e
            } catch (_: WorkHistoryNoReply) {
                // The desktop may still have started the run; retrying with the same ID is safe.
                pendingStart = runId to payload
            } catch (e: Exception) {
                pendingStart = null
                error = e.message ?: "The report could not be started."
            } finally {
                starting = false
            }
        }
    }

    LaunchedEffect(connected) {
        if (!connected) return@LaunchedEffect
        WsRepository.send("model:list", emptyMap())
        while (true) {
            try { refreshRuns() } catch (e: CancellationException) { throw e } catch (_: Exception) { /* next poll retries */ }
            delay(if (runs.any { it.optString("status") == "running" }) 2_000 else 8_000)
        }
    }

    // Preview automatically whenever the period or filters change.
    LaunchedEffect(first, last, project, agent, connected) {
        sources = null; selected = emptySet()
        if (!connected) return@LaunchedEffect
        delay(250)
        previewing = true
        try {
            val result = (call("preview", mapOf("request" to request())) as? JSONArray)?.objects() ?: emptyList()
            sources = result
            selected = result.map { it.optString("id") }.toSet()
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: "Could not load matching chats."
        } finally {
            previewing = false
        }
    }

    val active = runs.find { it.optString("id") == activeId }
    BackHandler(enabled = activeId != null) { activeId = null }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Work history") },
                subtitle = active?.let { runRangeLabel(it, zone) },
                onBack = { if (activeId != null) activeId = null else onBack() },
            )
        },
        bottomBar = {
            if (activeId == null && tab == 0) {
                Surface(tonalElevation = 3.dp) {
                    Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp)) {
                        NexyPrimaryButton(
                            text = if (starting) "Starting…" else if (selected.isEmpty()) "Generate report" else "Generate report · ${selected.size} chat${if (selected.size == 1) "" else "s"}",
                            onClick = { start(UUID.randomUUID().toString(), request() + ("conversationIds" to selected.sorted())) },
                            enabled = connected && selected.isNotEmpty() && !starting && pendingStart == null,
                            leadingNexyIcon = NexyIconName.Spark,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            NexyConnectionBanner(connection)
            if (active != null) {
                ReportDetail(
                    run = active,
                    connected = connected,
                    onCancel = { scope.launch { try { call("cancel", mapOf("id" to active.optString("id"))); refreshRuns() } catch (e: CancellationException) { throw e } catch (e: Exception) { error = e.message } } },
                    onOpenChat = onOpenChat,
                )
                return@Column
            }
            PrimaryTabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("New report") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text(if (runs.isEmpty()) "Saved" else "Saved (${runs.size})") })
            }
            if (tab == 1) {
                SavedReports(runs = runs, zone = zone, onOpen = { activeId = it })
                return@Column
            }
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                item {
                    Section("Period") {
                        PresetChips(preset) { chosen ->
                            preset = chosen
                            if (chosen == WorkHistoryPreset.CUSTOM) showDatePicker = true
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                workHistoryRangeLabel(first, last),
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.weight(1f),
                            )
                            if (preset == WorkHistoryPreset.CUSTOM) TextButton(onClick = { showDatePicker = true }) { Text("Change dates") }
                        }
                    }
                }
                item {
                    Section("Filter") {
                        ChoiceField("Project", project, listOf("all" to "All projects", "none" to "No project") + projects.map { it.id to it.name }) { project = it }
                        ChoiceField("Agent", agent, listOf("all" to "All agents", "none" to "No agent") + agents.map { it.id to it.name }) { agent = it }
                    }
                }
                item {
                    Section("Report") {
                        ModelField(label = activeModelLabel(modelId, models), onClick = { WsRepository.send("model:list", emptyMap()); showModelSheet = true })
                        Text("Group by", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        ChipRow(GROUPINGS, grouping) { grouping = it }
                        OutlinedTextField(
                            value = instructions,
                            onValueChange = { if (it.length <= 4000) instructions = it },
                            label = { Text("Instructions (optional)") },
                            placeholder = { Text("e.g. Focus on decisions and open questions") },
                            minLines = 2,
                            maxLines = 5,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                error?.let { message -> item { Notice(message, isError = true) } }
                pendingStart?.let { pending ->
                    item {
                        Notice("The desktop didn't confirm the report started. It may still be running — check Saved, or retry safely.", isError = false) {
                            TextButton(enabled = connected && !starting, onClick = { start(pending.first, pending.second) }) { Text("Retry") }
                        }
                    }
                }
                item {
                    val chosen = sources?.filter { it.optString("id") in selected }.orEmpty()
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Chats", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            Text(
                                when {
                                    previewing -> "Finding chats with activity in this period…"
                                    sources == null -> "Connect to the desktop to see matching chats."
                                    sources!!.isEmpty() -> "No chat activity in this period."
                                    else -> "${chosen.size} of ${sources!!.size} selected · about ${"%,d".format(chosen.sumOf { it.optInt("estimatedCharacters") } / 5)} words"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        val all = sources.orEmpty()
                        if (all.isNotEmpty()) {
                            TextButton(onClick = { selected = if (selected.size == all.size) emptySet() else all.map { it.optString("id") }.toSet() }) {
                                Text(if (selected.size == all.size) "Select none" else "Select all")
                            }
                        }
                    }
                    if (previewing) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp))
                }
                items(sources.orEmpty(), key = { it.optString("id") }) { source ->
                    val id = source.optString("id")
                    SourceRow(source, checked = id in selected) { selected = if (id in selected) selected - id else selected + id }
                }
                item {
                    Text(
                        "Reports use the desktop's chats. Changes made on Android that haven't synced yet won't be included. Codex and Hermes can write reports from a chat with the Work history capability enabled.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }

    if (showModelSheet) {
        ModalBottomSheet(onDismissRequest = { showModelSheet = false }, sheetState = rememberModalBottomSheetState(), containerColor = MaterialTheme.colorScheme.surface) {
            ModelPickerSheet(
                title = "Report model",
                subtitle = "API models need a key on the desktop. Claude CLI models run without tools.",
                models = models,
                cliStatus = cliStatus,
                selectedModelId = modelId,
                effectiveMode = effectiveMode,
                onSelect = { modelId = it; showModelSheet = false },
            )
        }
    }

    if (showDatePicker) {
        val toUtcMillis = { date: LocalDate -> date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }
        val pickerState = rememberDateRangePickerState(
            initialSelectedStartDateMillis = toUtcMillis(first),
            initialSelectedEndDateMillis = toUtcMillis(last),
        )
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(
                    enabled = pickerState.selectedStartDateMillis != null,
                    onClick = {
                        val toDate = { ms: Long -> Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate() }
                        val startDate = toDate(pickerState.selectedStartDateMillis!!)
                        val endDate = pickerState.selectedEndDateMillis?.let(toDate) ?: startDate
                        customFirst = startDate.toString(); customLast = endDate.toString()
                        preset = WorkHistoryPreset.CUSTOM
                        showDatePicker = false
                    },
                ) { Text("Apply") }
            },
            dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text("Cancel") } },
        ) {
            DateRangePicker(state = pickerState, modifier = Modifier.weight(1f), title = { Text("Choose dates", modifier = Modifier.padding(start = 24.dp, top = 16.dp)) })
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
        content()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PresetChips(selected: WorkHistoryPreset, onSelect: (WorkHistoryPreset) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        WorkHistoryPreset.entries.forEach { preset ->
            FilterChip(selected = preset == selected, onClick = { onSelect(preset) }, label = { Text(preset.label) })
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChipRow(options: List<Pair<String, String>>, value: String, onSelect: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        options.forEach { (id, label) -> FilterChip(selected = id == value, onClick = { onSelect(id) }, label = { Text(label) }) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChoiceField(label: String, value: String, options: List<Pair<String, String>>, onChange: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = options.find { it.first == value }?.second ?: value,
            onValueChange = {},
            readOnly = true,
            singleLine = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (id, name) ->
                DropdownMenuItem(text = { Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis) }, onClick = { expanded = false; onChange(id) })
            }
        }
    }
}

/** Looks like the other dropdowns but opens the shared, searchable model picker sheet. */
@Composable
private fun ModelField(label: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = MaterialTheme.shapes.extraSmall,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        color = Color.Transparent,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Model", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(label, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            NexyIcon(NexyIconName.ChevronDown, contentDescription = "Choose model", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SourceRow(source: JSONObject, checked: Boolean, onToggle: () -> Unit) {
    val meta = listOfNotNull(
        source.text("projectName") ?: "No project",
        source.text("agentName"),
        "${source.optInt("messageCount")} messages",
        if (source.optBoolean("archived")) "archived" else null,
    ).joinToString(" · ")
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = checked, onCheckedChange = { onToggle() })
        Column(Modifier.weight(1f)) {
            Text(cleanWorkHistoryTitle(source.text("title")), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun Notice(message: String, isError: Boolean, action: (@Composable () -> Unit)? = null) {
    Surface(
        shape = MaterialTheme.shapes.extraSmall,
        color = if (isError) MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f) else MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.5f),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            NexyIcon(if (isError) NexyIconName.Error else NexyIconName.Warning, contentDescription = null, modifier = Modifier.size(18.dp), tint = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSecondaryContainer)
            Text(message, style = MaterialTheme.typography.bodySmall, color = if (isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.weight(1f))
            action?.invoke()
        }
    }
}

private fun runDates(run: JSONObject, zone: ZoneId): Pair<LocalDate, LocalDate>? {
    val request = run.optJSONObject("request") ?: return null
    val start = request.optLong("start", -1).takeIf { it >= 0 } ?: return null
    val end = request.optLong("end", -1).takeIf { it > start } ?: return null
    return Instant.ofEpochMilli(start).atZone(zone).toLocalDate() to Instant.ofEpochMilli(end - 1).atZone(zone).toLocalDate()
}

private fun runRangeLabel(run: JSONObject, zone: ZoneId): String =
    runDates(run, zone)?.let { (a, b) -> workHistoryRangeLabel(a, b) } ?: "Work history report"

@Composable
private fun StatusBadge(status: String) {
    val scheme = MaterialTheme.colorScheme
    val (label, color) = when (status) {
        "completed" -> "Completed" to scheme.primary
        "running" -> "Running" to scheme.tertiary
        "cancelled" -> "Cancelled" to scheme.outline
        else -> "Failed" to scheme.error
    }
    NexyStatusBadge(label = label, containerColor = color.copy(alpha = 0.12f), contentColor = color)
}

@Composable
private fun SavedReports(runs: List<JSONObject>, zone: ZoneId, onOpen: (String) -> Unit) {
    if (runs.isEmpty()) {
        NexyEmptyState(title = "No reports yet", detail = "Generated reports appear here and on the desktop.", modifier = Modifier.padding(top = 48.dp))
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(runs, key = { it.optString("id") }) { run ->
            val request = run.optJSONObject("request")
            val chats = run.optJSONArray("sources")?.length() ?: 0
            val grouping = GROUPINGS.find { it.first == request?.optString("grouping") }?.second ?: "Project"
            Row(
                Modifier.fillMaxWidth().clickable { onOpen(run.optString("id")) }.padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                NexyIcon(NexyIconName.History, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f)) {
                    Text(runRangeLabel(run, zone), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    Text(
                        "$chats chat${if (chats == 1) "" else "s"} · by ${grouping.lowercase()} · ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(run.optLong("createdAt")))}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                StatusBadge(run.optString("status"))
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

@Composable
private fun ReportDetail(run: JSONObject, connected: Boolean, onCancel: () -> Unit, onOpenChat: (String) -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val status = run.optString("status")
    val sources = remember(run) { run.optJSONArray("sources")?.objects().orEmpty().distinctBy { it.optString("id") } }
    val titles = remember(sources) { sources.associate { it.optString("id") to (it.text("title") ?: "Untitled chat") } }
    val report = remember(run.text("report"), titles) { run.text("report")?.let { workHistoryReportWithTitles(it, titles) } }
    val markwon = rememberChatMarkwon()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusBadge(status)
                Text(
                    "${sources.size} chat${if (sources.size == 1) "" else "s"} · ${run.optJSONObject("request")?.text("model") ?: "default model"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        when (status) {
            "running" -> item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text(run.text("progress") ?: "Working…", style = MaterialTheme.typography.bodyMedium)
                    NexySecondaryButton(text = "Cancel", onClick = onCancel, enabled = connected, leadingNexyIcon = NexyIconName.Stop)
                }
            }
            "failed", "cancelled" -> item { Notice(run.text("error") ?: if (status == "cancelled") "The report was cancelled." else "The report failed.", isError = status == "failed") }
        }
        if (report != null) {
            item {
                // ChatMarkdownText reads the Markwon instance from a composition local that only the
                // chat screen provides; without this the report view crashes on open.
                CompositionLocalProvider(LocalMarkwon provides markwon) {
                    ChatMarkdownText(markdown = report, streaming = false, debugKey = "work-history-${run.optString("id")}")
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NexySecondaryButton(text = "Copy", onClick = { clipboard.setText(AnnotatedString(report)) }, leadingNexyIcon = NexyIconName.Copy, modifier = Modifier.weight(1f))
                    NexySecondaryButton(
                        text = "Share",
                        onClick = { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, report), "Share report")) },
                        leadingNexyIcon = NexyIconName.Share,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
        if (sources.isNotEmpty()) {
            item { Text("SOURCES", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(sources, key = { it.optString("id") }) { source ->
                val available = source.optBoolean("available", false)
                Row(
                    Modifier.fillMaxWidth().clickable(enabled = available) { onOpenChat(source.optString("id")) }.padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    NexyIcon(NexyIconName.Inbox, contentDescription = null, modifier = Modifier.size(16.dp), tint = if (available) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline)
                    Text(
                        cleanWorkHistoryTitle(source.text("title")) + if (available) "" else " (deleted)",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (available) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (available) NexyIcon(NexyIconName.ChevronRight, contentDescription = "Open chat", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}

package io.nexy.android.ui.chat

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import io.nexy.android.ui.theme.NexyChatSurfaceShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.local.ConversationSummaryEntity
import io.nexy.android.data.model.ContextInspectorAttachmentSnapshot
import io.nexy.android.data.model.ContextInspectorRefSnapshot
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import java.text.DateFormat
import java.util.Date
import kotlin.math.min

private fun fmtTokens(n: Int): String = if (n >= 1000) "~${"%.1f".format(n / 1000.0)}k" else "~$n"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContextInspectorSheet(
    conversationId: String,
    onDismiss: () -> Unit,
    sheetState: SheetState,
    vm: ContextInspectorViewModel = viewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()

    LaunchedEffect(conversationId) {
        vm.load(conversationId)
    }

    ModalBottomSheet(
        onDismissRequest = { vm.reset(); onDismiss() },
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Text(
            "Context Inspector",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (state.isStandalone) {
                item { StandaloneCompressionCard(loading = state.loading, summary = state.localSummary) }
                item { Spacer(Modifier.height(8.dp)) }
                return@LazyColumn
            }

            item {
                if (state.loading && state.snapshot == null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        NexyIcon(NexyIconName.Busy, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                        Text("Loading context from desktop…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else if (state.snapshot == null) {
                    Text(
                        state.error ?: "Context detail is unavailable. Make sure the desktop app is running and connected.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            state.snapshot?.let { snapshot ->
                item { TokenBudgetCard(snapshot.totalTokens, snapshot.maxTokens) }

                snapshot.nextRequest?.let { next ->
                    item {
                        InfoRow(
                            label = "Next request",
                            detail = "${next.quality} · ${next.source}",
                            value = "${next.inputTokens} input tok",
                        )
                    }
                }
                snapshot.turnTotal?.let { total ->
                    item {
                        InfoRow(
                            label = "Turn total",
                            detail = "${total.quality} · ${total.source} · ${total.requestCount} request${if (total.requestCount == 1) "" else "s"}",
                            value = "${total.inputTokens}↑ ${total.outputTokens}↓",
                        )
                    }
                }

                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatCard("System", fmtTokens(snapshot.systemPromptTokens), Modifier.weight(1f))
                        StatCard("@refs", "${snapshot.contextRefs.size}", Modifier.weight(1f))
                        StatCard("Files", "${snapshot.attachments.size}", Modifier.weight(1f))
                        StatCard("Images", "${snapshot.imageCount}", Modifier.weight(1f))
                        StatCard("History", "${snapshot.historyMessageCount}", Modifier.weight(1f))
                    }
                }

                if (snapshot.systemPrompt.isNotBlank()) {
                    item { ExpandableTextSection(label = "System prompt", tokenLabel = fmtTokens(snapshot.systemPromptTokens), body = snapshot.systemPrompt) }
                }

                if (snapshot.contextRefs.isNotEmpty()) {
                    item { PayloadSourcesLabel("@refs") }
                    items(snapshot.contextRefs) { ref -> RefRow(ref) }
                } else {
                    item { InfoRow(label = "@refs", detail = "No explicit context references attached.") }
                }

                if (snapshot.attachments.isNotEmpty()) {
                    item { PayloadSourcesLabel("File attachments") }
                    items(snapshot.attachments) { att -> AttachmentRow(att) }
                } else {
                    item { InfoRow(label = "File attachments", detail = "No files attached to the draft message.") }
                }

                item {
                    Card(
                        shape = NexyChatSurfaceShape,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    ) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Current chat", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                            LabelValueRow("History", "${snapshot.historyMessageCount} messages")
                            LabelValueRow("Draft input", fmtTokens(snapshot.currentInputTokens) + " tok")
                            LabelValueRow("Images", if (snapshot.imageCount > 0) "${snapshot.imageCount}" else "None")
                            LabelValueRow("Model", snapshot.model)
                        }
                    }
                }
            }

            item {
                CompressionCard(
                    conversationId = conversationId,
                    state = state,
                    vm = vm,
                )
            }

            item { Spacer(Modifier.height(8.dp)) }
        }
    }
}

@Composable
private fun TokenBudgetCard(totalTokens: Int, maxTokens: Int) {
    val pct = if (maxTokens > 0) min(1f, totalTokens.toFloat() / maxTokens.toFloat()) else 0f
    val color = when {
        pct >= 0.8f -> Color(0xFFEF4444)
        pct >= 0.5f -> Color(0xFFF59E0B)
        else -> Color(0xFF10B981)
    }
    Card(shape = NexyChatSurfaceShape, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LinearProgressIndicator(
                    progress = { pct },
                    modifier = Modifier
                        .weight(1f)
                        .height(6.dp)
                        .clip(NexyChatSurfaceShape),
                    color = color,
                    trackColor = MaterialTheme.colorScheme.outlineVariant,
                )
                Text(
                    "${fmtTokens(totalTokens)} / ${fmtTokens(maxTokens)} tokens",
                    style = MaterialTheme.typography.labelSmall,
                    color = color,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier, shape = NexyChatSurfaceShape, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(modifier = Modifier.padding(vertical = 8.dp, horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun PayloadSourcesLabel(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun InfoRow(label: String, detail: String? = null, value: String? = null) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
            detail?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        value?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun RefRow(ref: ContextInspectorRefSnapshot) {
    InfoRow(label = ref.token, detail = "Resolved when the next message is dispatched.", value = "${fmtTokens(ref.estimatedTokens)} tok")
}

@Composable
private fun AttachmentRow(att: ContextInspectorAttachmentSnapshot) {
    InfoRow(label = att.name, detail = "${att.size} bytes", value = "${fmtTokens(att.estimatedTokens)} tok")
}

@Composable
private fun LabelValueRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun ExpandableTextSection(label: String, tokenLabel: String, body: String) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        InfoRow(label = label, value = "$tokenLabel tok")
        TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(0.dp)) {
            NexyIcon(
                if (expanded) NexyIconName.ChevronDown else NexyIconName.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text(if (expanded) "Hide prompt" else "Show prompt", style = MaterialTheme.typography.labelSmall)
        }
        if (expanded) {
            Card(shape = NexyChatSurfaceShape, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Text(
                    body,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }
    }
}

/**
 * Standalone-mode equivalent of [CompressionCard]. There's no desktop to ask for a snapshot or
 * preview from, so this reads whatever [io.nexy.android.data.StandaloneChatService] already
 * wrote to the local `conversation_summaries` Room table — the same rolling summary it feeds
 * back into future requests. Compression there runs automatically (character-threshold trigger,
 * LLM-authored summary) rather than on demand, so there's no "Compress now" action to offer.
 */
@Composable
private fun StandaloneCompressionCard(loading: Boolean, summary: ConversationSummaryEntity?) {
    Card(shape = NexyChatSurfaceShape, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                NexyIcon(NexyIconName.Compress, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Compression (standalone)", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
            }
            when {
                loading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NexyIcon(NexyIconName.Busy, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                    Text("Loading…", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                summary == null -> Text(
                    "No summary yet. Standalone mode summarizes older turns automatically once this chat's " +
                        "history grows past ~120k characters.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                else -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatCard("Summarized", "${summary.sourceMessageCount}", Modifier.weight(1f))
                        StatCard("Updated", DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(summary.updatedAt)), Modifier.weight(1f))
                    }
                    ExpandableTextSection(label = "Rolling summary", tokenLabel = "${summary.summary.length / 4}", body = summary.summary)
                }
            }
        }
    }
}

@Composable
private fun CompressionCard(
    conversationId: String,
    state: ContextInspectorState,
    vm: ContextInspectorViewModel,
) {
    Card(shape = NexyChatSurfaceShape, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                NexyIcon(NexyIconName.Compress, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Compression", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
            }

            val preview = state.compressionPreview
            if (preview != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatCard("Summary", if (preview.hasSummary) "${preview.summarizedMessageCount}" else "Off", Modifier.weight(1f))
                    StatCard("Retained", "${preview.retainedMessageCount}", Modifier.weight(1f))
                    StatCard("Budget", fmtTokens(preview.targetBudget), Modifier.weight(1f))
                }
                if (!preview.hasSummary) {
                    Text(
                        "No rolling summary yet. Recent history will be sent until compression starts.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else if (state.compressionPreviewLoading) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NexyIcon(NexyIconName.Busy, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                    Text("Loading…", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                Text("Compression preview is unavailable for this conversation.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            TextButton(
                onClick = { vm.prepareCompression(conversationId) },
                enabled = !state.compressionDraftLoading,
                contentPadding = PaddingValues(0.dp),
            ) {
                if (state.compressionDraftLoading) {
                    NexyIcon(NexyIconName.Busy, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(6.dp))
                }
                Text(if (state.compressionDraftLoading) "Preparing…" else "Compress now")
            }
        }
    }

    state.compressionDraft?.let { draft ->
        AlertDialog(
            onDismissRequest = { vm.dismissCompressionDraft() },
            title = { Text("Compress conversation") },
            text = {
                Column {
                    Text(
                        "Will summarise ${draft.summarizedMessageCount} messages, keeping ${draft.retainedMessageCount} recent turns (${fmtTokens(draft.estimatedTokensBefore)} tok before).",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { vm.saveCompression(conversationId) }, enabled = !state.compressionSaving) {
                    if (state.compressionSaving) {
                        NexyIcon(NexyIconName.Busy, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                    } else {
                        Text("Save summary")
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { vm.dismissCompressionDraft() }) { Text("Cancel") }
            },
        )
    }
}

package io.nexy.android.ui.chat

import android.animation.ValueAnimator
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import io.nexy.android.ui.components.nexyDither
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.HERMES_DEFAULT_PROFILE
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.isVisibleInProject
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyDangerButton
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import io.nexy.android.ui.theme.LocalNexyEightBit
import io.nexy.android.ui.theme.NexyChatSurfaceShape
import kotlin.math.roundToInt

@Composable
fun AttachmentChip(attachment: PendingAttachment, onRemove: () -> Unit) {
    val thumbnail = remember(attachment.dataUrl) {
        if (attachment.isImage && attachment.dataUrl != null) decodeDataUrl(attachment.dataUrl) else null
    }
    Surface(
        shape = RoundedCornerShape(2.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (thumbnail != null) {
                PreviewableImage(
                    bitmap = thumbnail.asImageBitmap(),
                    contentDescription = attachment.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(28.dp)
                        .clip(RoundedCornerShape(10.dp)),
                )
            } else {
                NexyIcon(
                    if (attachment.isImage) NexyIconName.Image else NexyIconName.Attach,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp).padding(start = 4.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                attachment.name,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 120.dp),
            )
            IconButton(onClick = onRemove, modifier = Modifier.size(20.dp)) {
                NexyIcon(
                    NexyIconName.Close,
                    contentDescription = "Remove",
                    modifier = Modifier.size(12.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
fun ModelSheetItem(
    label: String,
    vendor: String?,
    selected: Boolean,
    unavailable: Boolean = false,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    label,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (selected) MaterialTheme.colorScheme.onPrimaryContainer
                            else if (unavailable) MaterialTheme.colorScheme.onSurfaceVariant
                            else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!vendor.isNullOrBlank()) {
                    Text(
                        vendor,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (unavailable) {
                Surface(
                    shape = RoundedCornerShape(4.dp),
                    color = MaterialTheme.colorScheme.errorContainer,
                ) {
                    Text(
                        "Unavailable",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            } else if (selected) {
                Text(
                    "Selected",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

/**
 * Reusable model-picker bottom sheet content â€” extracted from ChatScreen's inline model sheet so
 * non-chat screens (e.g. Revise Plan on a Code Changes request) can offer the same searchable,
 * vendor-grouped model list instead of a plain text field for the model id.
 */
@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun ModelPickerSheet(
    title: String,
    models: List<ModelOption>,
    cliStatus: Map<String, CliInstallInfo>,
    selectedModelId: String?,
    subtitle: String? = null,
    emptyStateText: String = "No models available yet.",
    showDefaultModel: Boolean = true,
    effectiveMode: io.nexy.android.data.EffectiveConnectionMode = io.nexy.android.data.EffectiveConnectionMode.CONNECTED,
    /** Disambiguates the active entry when the same bare model is offered by several Hermes profiles. */
    selectedHermesProfile: String? = null,
    qualifyCli: Boolean = false,
    unavailableBackends: Set<String> = emptySet(),
    /** When set, receives the full option (including its Hermes profile) instead of [onSelect]. */
    onSelectOption: ((ModelOption?) -> Unit)? = null,
    onSelect: (String?) -> Unit,
) {
    val selectedProfileKey = selectedHermesProfile?.trim()?.takeIf { it.isNotEmpty() } ?: HERMES_DEFAULT_PROFILE
    fun isSelected(model: ModelOption): Boolean {
        val idMatches = model.id == selectedModelId || (model.isCliSourced && "${model.backend}:${model.id}" == selectedModelId)
        return idMatches && (model.hermesProfile == null || model.hermesProfile == selectedProfileKey)
    }
    var modelQuery by remember { mutableStateOf("") }

    val query = modelQuery.trim().lowercase()
    var selectedVendor by remember { mutableStateOf<String?>(null) }
    BackHandler(enabled = selectedVendor != null) { selectedVendor = null }
    val allItems = io.nexy.android.ui.model.buildModelSheetItems(models, cliStatus, effectiveMode, "")
    val modelItems = allItems.filterIsInstance<io.nexy.android.ui.model.ModelSheetEntry.Item>().filterNot { it.model.id == "default" }
    val groups = modelItems.groupBy { it.model.vendor?.takeIf { vendor -> vendor.isNotBlank() } ?: "Other" }
    val matchingGroups = groups.mapValues { (vendor, entries) ->
        if (query.isEmpty() || vendor.lowercase().contains(query)) entries
        else entries.filter { it.model.label.lowercase().contains(query) || it.model.id.lowercase().contains(query) }
    }.filterValues { it.isNotEmpty() }
    val sheetItems = selectedVendor?.let { matchingGroups[it] }.orEmpty()

    val showDefault = showDefaultModel && (query.isEmpty() || "default model".contains(query))

    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            if (selectedVendor != null) {
                Text("‹  $selectedVendor", style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.fillMaxWidth().clickable { selectedVendor = null }.padding(horizontal = 20.dp, vertical = 12.dp))
            } else {
                Text(title, style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp))
            }
            val activeModel = models.firstOrNull { isSelected(it) }
                ?: models.firstOrNull { it.id == selectedModelId || (it.isCliSourced && "${it.backend}:${it.id}" == selectedModelId) }
            Text("Active: ${activeModel?.let { listOfNotNull(it.label, it.vendor).joinToString(" · ") } ?: if (selectedModelId.isNullOrBlank() || selectedModelId == "default") "Default model" else selectedModelId}",
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp),
                )
            }
            OutlinedTextField(
                value = modelQuery,
                onValueChange = { modelQuery = it },
                placeholder = { Text("Search modelsâ€¦", style = MaterialTheme.typography.bodyMedium) },
                leadingIcon = { NexyIcon(NexyIconName.Search, contentDescription = null, modifier = Modifier.size(20.dp)) },
                trailingIcon = {
                    if (modelQuery.isNotEmpty()) {
                        IconButton(onClick = { modelQuery = "" }) {
                            NexyIcon(NexyIconName.Close, contentDescription = "Clear", modifier = Modifier.size(18.dp))
                        }
                    }
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                shape = MaterialTheme.shapes.medium,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(top = 4.dp))
        }

        if (showDefault && selectedVendor == null) {
            item {
                ModelSheetItem(
                    label = "Default model",
                    vendor = null,
                    selected = selectedModelId == null || selectedModelId == "default" || selectedModelId.isBlank(),
                ) {
                    if (onSelectOption != null) onSelectOption(null) else onSelect(null)
                }
            }
        }

        if (models.isEmpty()) {
            item {
                Text(
                    emptyStateText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                )
            }
        } else {
            if (selectedVendor == null) {
                items(matchingGroups.keys.toList()) { vendor ->
                    Text("$vendor  ›", style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.fillMaxWidth().clickable { selectedVendor = vendor }.padding(horizontal = 20.dp, vertical = 14.dp))
                }
            } else {
                items(sheetItems) { item ->
                    val unavailable = item.unavailable || (item.model.backend?.let { it in unavailableBackends } == true)
                    ModelSheetItem(label = item.model.label, vendor = null,
                        selected = isSelected(item.model), unavailable = unavailable) {
                        if (!unavailable) {
                            if (onSelectOption != null) onSelectOption(item.model)
                            else onSelect(if (qualifyCli && item.model.isCliSourced && item.model.backend != null) "${item.model.backend}:${item.model.id}" else item.model.id)
                        }
                    }
                }
            }

            if (matchingGroups.isEmpty() && !showDefault) {
                item {
                    Text(
                        "No models match \"$modelQuery\"",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                    )
                }
            }
        }
    }
}

/**
 * Reusable prompt-library bottom sheet content â€” extracted from ChatScreen's inline "Insert
 * Prompt" sheet so non-chat screens (e.g. Revise Plan) can offer the same saved-prompt insertion
 * instead of missing the feature entirely.
 */
@Composable
fun PromptLibrarySheetContent(
    promptEntries: List<PromptEntry>,
    projectId: String? = null,
    onInsert: (body: String) -> Unit,
) {
    Text(
        "Insert Prompt",
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
    )
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    if (promptEntries.isEmpty()) {
        Text(
            "No saved prompts. Create some in the Prompt Library.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
        )
    } else {
        promptEntries.forEach { prompt ->
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onInsert(prompt.body) },
                color = MaterialTheme.colorScheme.surface,
            ) {
                Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp)) {
                    Text(prompt.title, style = MaterialTheme.typography.bodyLarge)
                    Text(
                        if (prompt.scope == "project" && prompt.isVisibleInProject(projectId)) "This project" else "Global",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    if (prompt.description.isNotBlank()) {
                        Text(
                            prompt.description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

@Composable
fun EmptyChatContent(agentLabel: String?, projectLabel: String?) {
    val detail = when {
        agentLabel != null && projectLabel != null -> "$agentLabel Â· $projectLabel"
        agentLabel != null -> agentLabel
        projectLabel != null -> projectLabel
        else -> null
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 96.dp, start = 24.dp, end = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "Start a new conversation",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        if (detail != null) {
            Text(
                detail,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            "Ask a question or attach a file to begin.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
        )
    }
}

// Placeholder rows shown while an existing conversation's history is still loading from disk â€”
// alternating alignment/width to loosely echo the user/assistant bubble shapes so the swap to
// real content doesn't jump the layout around. Classic retains its original shared pulse;
// the 8-bit style uses a slower pulse over its dithered loading record.
private data class SkeletonRow(val alignEnd: Boolean, val widthFraction: Float)

private val chatSkeletonRows = listOf(
    SkeletonRow(alignEnd = true, widthFraction = 0.45f),
    SkeletonRow(alignEnd = false, widthFraction = 0.8f),
    SkeletonRow(alignEnd = false, widthFraction = 0.55f),
    SkeletonRow(alignEnd = true, widthFraction = 0.3f),
    SkeletonRow(alignEnd = false, widthFraction = 0.65f),
)

@Composable
fun ChatLoadingSkeleton() {
    if (LocalNexyEightBit.current) {
        val motionEnabled = !LocalInspectionMode.current && ValueAnimator.areAnimatorsEnabled()
        val transition = rememberInfiniteTransition(label = "retro-chat-skeleton-pulse")
        val pulseAlpha by transition.animateFloat(
            initialValue = 1f,
            targetValue = if (motionEnabled) 0.62f else 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 1_400),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "retro-chat-skeleton-pulse-alpha",
        )
        ChatSkeletonRows(
            shape = RoundedCornerShape(2.dp),
            modifier = Modifier
                .graphicsLayer(alpha = pulseAlpha)
                .nexyDither(
                    background = MaterialTheme.colorScheme.surfaceVariant,
                    foreground = MaterialTheme.colorScheme.outlineVariant,
                ),
        )
        return
    }

    val transition = rememberInfiniteTransition(label = "chat-skeleton-pulse")
    val pulseAlpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.9f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 700),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "chat-skeleton-pulse-alpha",
    )
    ChatSkeletonRows(
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.background(
            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = pulseAlpha * 0.25f),
        ),
    )
}

@Composable
private fun ChatSkeletonRows(
    shape: RoundedCornerShape,
    modifier: Modifier,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp, start = 12.dp, end = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        chatSkeletonRows.forEach { row ->
            Box(modifier = Modifier.fillMaxWidth()) {
                Box(
                    modifier = Modifier
                        .align(if (row.alignEnd) Alignment.CenterEnd else Alignment.CenterStart)
                        .fillMaxWidth(row.widthFraction)
                        .height(16.dp)
                        .clip(shape)
                        .then(modifier),
                )
            }
        }
    }
}

@Composable
fun ToolApprovalCard(
    approval: WsEvent.ToolApprovalRequest,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
    onKeepPlanning: () -> Unit = onDeny,
) {
    val isPlanDecision = approval.toolName == "exit_plan_mode"
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        shape = NexyChatSurfaceShape,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                if (isPlanDecision) "Plan ready" else "Tool approval requested",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Text(
                if (isPlanDecision) {
                    "Choose whether Codex should implement this plan or continue planning."
                } else {
                    approval.description.ifBlank { approval.toolName }
                },
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            if (approval.args.isNotEmpty()) {
                val argsText = approval.args.entries
                    .take(6)
                    .joinToString("\n") { (k, v) -> "$k: $v" }
                Text(
                    argsText,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.8f),
                    maxLines = 8,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (isPlanDecision) {
                    NexySecondaryButton(
                        text = "Keep planning",
                        onClick = onKeepPlanning,
                        modifier = Modifier.weight(1f),
                    )
                    NexyDangerButton(
                        text = "Cancel",
                        onClick = onDeny,
                    )
                    NexyPrimaryButton(
                        text = "Implement plan",
                        onClick = onApprove,
                        modifier = Modifier.weight(1f),
                    )
                } else {
                    NexyDangerButton(
                        text = "Deny",
                        onClick = onDeny,
                        modifier = Modifier.weight(1f),
                    )
                    NexyPrimaryButton(
                        text = "Approve",
                        onClick = onApprove,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

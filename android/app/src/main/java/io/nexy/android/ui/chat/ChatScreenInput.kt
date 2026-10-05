package io.nexy.android.ui.chat

import android.content.ClipboardManager
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.model.AgentCustomCommand
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatInputBar(
    input: String,
    onInputChange: (String) -> Unit,
    attachments: List<PendingAttachment>,
    onRemoveAttachment: (String) -> Unit,
    canSend: Boolean,
    onSend: () -> Unit,
    onAttachFile: () -> Unit,
    onAttachDesktopPath: (() -> Unit)? = null,
    onInsertPrompt: () -> Unit = {},
    onShowInspector: () -> Unit = {},
    isListening: Boolean = false,
    isTranscribing: Boolean = false,
    onVoiceInput: () -> Unit = {},
    onCancelVoiceInput: () -> Unit = {},
    voiceDockAvailable: Boolean = false,
    voiceDockFloating: Boolean = false,
    onFloatVoiceDock: () -> Unit = {},
    placeholder: String = "Message…",
    onSetupManually: (() -> Unit)? = null,
    showAttachOptions: Boolean = true,
    customSlashCommands: List<AgentCustomCommand> = emptyList(),
    modelLabel: String? = null,
    onModelClick: () -> Unit = {},
    onOpenModeSettings: () -> Unit = {},
    modeSettingsActive: Boolean = false,
) {
    val attachSheetState = rememberModalBottomSheetState()
    var showAttachSheet by remember { mutableStateOf(false) }
    val slashSheetState = rememberModalBottomSheetState()
    var showSlashSheet by remember { mutableStateOf(false) }
    val inputFocusRequester = remember { FocusRequester() }
    val context = LocalContext.current

    // Markdown is the only draft format, so a formatted clipboard payload is
    // converted rather than flattened to plain text by the system paste.
    val pasteFormattedText = {
        val clipboard = context.getSystemService(ClipboardManager::class.java)
        val clip = clipboard?.primaryClip
        val pasted = clip?.let { data ->
            buildString {
                repeat(data.itemCount) { index ->
                    val item = data.getItemAt(index)
                    val html = item.coerceToHtmlText(context)
                    val value = html?.takeIf { it.isNotBlank() }?.let { HtmlToMarkdown.convert(it) }
                        ?: item.coerceToText(context)?.toString().orEmpty()
                    if (value.isNotBlank()) {
                        if (isNotEmpty()) appendLine()
                        append(value)
                    }
                }
            }
        }.orEmpty()
        if (pasted.isNotBlank()) {
            val separator = if (input.endsWith("\n")) "" else "\n"
            onInputChange(if (input.isBlank()) pasted else input + separator + pasted)
        }
    }

    if (showSlashSheet) {
        val query = input.removePrefix("/")
        val filteredBuiltins = MOBILE_SLASH_COMMANDS.filter {
            query.isBlank() || it.name.removePrefix("/").startsWith(query, ignoreCase = true)
        }
        val filteredCustom = customSlashCommands.filter {
            query.isBlank() || it.name.removePrefix("/").startsWith(query, ignoreCase = true)
        }
        ModalBottomSheet(
            onDismissRequest = { showSlashSheet = false },
            sheetState = slashSheetState,
        ) {
            LazyColumn {
                items(filteredBuiltins) { command ->
                    ListItem(
                        headlineContent = { Text(command.name, fontFamily = FontFamily.Monospace) },
                        supportingContent = { Text(command.description) },
                        modifier = Modifier.clickable {
                            showSlashSheet = false
                            onInputChange("${command.name} ")
                        },
                    )
                }
                if (filteredCustom.isNotEmpty()) {
                    items(filteredCustom) { command ->
                        ListItem(
                            headlineContent = { Text(command.name, fontFamily = FontFamily.Monospace) },
                            supportingContent = { Text(command.description.ifBlank { "Custom command" }) },
                            modifier = Modifier.clickable {
                                showSlashSheet = false
                                // Expands the full prompt into the input for the user to review/send,
                                // matching desktop's slash-commands.ts custom-command behavior.
                                onInputChange(command.prompt)
                            },
                        )
                    }
                }
                if (filteredBuiltins.isEmpty() && filteredCustom.isEmpty()) {
                    item {
                        ListItem(headlineContent = { Text("No matching commands") })
                    }
                }
            }
            Spacer(Modifier.padding(bottom = 8.dp))
        }
    }

    if (showAttachSheet) {
        ModalBottomSheet(
            onDismissRequest = { showAttachSheet = false },
            sheetState = attachSheetState,
        ) {
            if (showAttachOptions) {
                ListItem(
                    headlineContent = { Text("Attach File") },
                    leadingContent = { NexyIcon(NexyIconName.Attach, contentDescription = null) },
                    modifier = Modifier.clickable { showAttachSheet = false; onAttachFile() },
                )
                onAttachDesktopPath?.let { attachDesktopPath ->
                    ListItem(
                        headlineContent = { Text("Attach from connected desktop") },
                        supportingContent = { Text("Choose a desktop file or folder") },
                        leadingContent = { NexyIcon(NexyIconName.Expand, contentDescription = null) },
                        modifier = Modifier.clickable { showAttachSheet = false; attachDesktopPath() },
                    )
                }
            }
            ListItem(
                headlineContent = { Text("Insert Prompt") },
                leadingContent = { NexyIcon(NexyIconName.Prompt, contentDescription = null) },
                modifier = Modifier.clickable { showAttachSheet = false; onInsertPrompt() },
            )
            ListItem(
                headlineContent = { Text("Paste formatted text") },
                supportingContent = { Text("Converts rich clipboard content to Markdown") },
                leadingContent = { NexyIcon(NexyIconName.Prompt, contentDescription = null) },
                modifier = Modifier.clickable { showAttachSheet = false; pasteFormattedText() },
            )
            if (showAttachOptions) {
                ListItem(
                    headlineContent = { Text("Context Inspector") },
                    leadingContent = { NexyIcon(NexyIconName.Inspect, contentDescription = null) },
                    modifier = Modifier.clickable { showAttachSheet = false; onShowInspector() },
                )
            }
            Spacer(Modifier.padding(bottom = 8.dp))
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .imePadding()
            .navigationBarsPadding()
            .padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
    ) {
        if (onSetupManually != null) {
            TextButton(
                onClick = onSetupManually,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 2.dp),
            ) {
                Text("Set up manually")
            }
        }
        Surface(
            shape = RoundedCornerShape(4.dp),
            border = BorderStroke(2.dp, MaterialTheme.colorScheme.outline),
            tonalElevation = 0.dp,
            color = MaterialTheme.colorScheme.surfaceVariant,
        ) {
            Column {
                if (attachments.isNotEmpty()) {
                    LazyRow(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(attachments, key = { it.id }) { att ->
                            AttachmentChip(att, onRemove = { onRemoveAttachment(att.id) })
                        }
                    }
                }

                val textColor = MaterialTheme.colorScheme.onSurface
                val hintColor = MaterialTheme.colorScheme.onSurfaceVariant
                val cursorColor = MaterialTheme.colorScheme.primary
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 4.dp),
                ) {
                    if (input.isEmpty()) {
                        Text(placeholder, style = MaterialTheme.typography.bodyMedium, color = hintColor)
                    }
                    BasicTextField(
                        value = input,
                        onValueChange = onInputChange,
                        modifier = Modifier.fillMaxWidth().focusRequester(inputFocusRequester),
                        textStyle = MaterialTheme.typography.bodyMedium.copy(color = textColor),
                        maxLines = 5,
                        keyboardOptions = KeyboardOptions(
                            imeAction = ImeAction.Default,
                            capitalization = KeyboardCapitalization.Sentences,
                            autoCorrectEnabled = true,
                        ),
                        cursorBrush = SolidColor(cursorColor),
                    )
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 8.dp, end = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(
                        onClick = { showAttachSheet = true },
                        modifier = Modifier.size(36.dp),
                    ) {
                        NexyIcon(
                            NexyIconName.Add,
                            contentDescription = "Attach or insert",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(
                        onClick = { showSlashSheet = true },
                        modifier = Modifier.size(36.dp),
                    ) {
                        Text(
                            "/",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (modelLabel != null) {
                        Spacer(Modifier.size(4.dp))
                        // Model picker pill — mirrors the Claude app's bottom-of-composer model
                        // selector so the top app bar can be reclaimed for space.
                        Surface(
                            shape = RoundedCornerShape(4.dp),
                            border = BorderStroke(2.dp, MaterialTheme.colorScheme.primary),
                            color = Color.Transparent,
                            modifier = Modifier.clickable(onClick = onModelClick),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(start = 10.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                            ) {
                                Text(
                                    modelLabel,
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.primary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.widthIn(max = 128.dp),
                                )
                                Icon(
                                    Icons.Default.KeyboardArrowDown,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                        // Chat mode settings — kept a separate control from the model pill.
                        IconButton(
                            onClick = onOpenModeSettings,
                            modifier = Modifier.size(36.dp),
                        ) {
                            NexyIcon(
                                NexyIconName.Settings,
                                contentDescription = "Chat mode settings",
                                tint = if (modeSettingsActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    if (!voiceDockFloating) {
                        if (isListening) {
                            IconButton(
                                onClick = onCancelVoiceInput,
                                modifier = Modifier.size(36.dp),
                            ) {
                                NexyIcon(
                                    NexyIconName.Close,
                                    contentDescription = "Cancel voice recording",
                                    tint = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                        IconButton(
                            onClick = onVoiceInput,
                            enabled = !isTranscribing,
                            modifier = Modifier.size(36.dp),
                        ) {
                            if (isTranscribing) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            } else {
                                NexyIcon(
                                    NexyIconName.Microphone,
                                    contentDescription = if (isListening) "Stop voice input" else "Start voice input",
                                    tint = if (isListening) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    if (voiceDockAvailable && !voiceDockFloating) {
                        IconButton(onClick = onFloatVoiceDock, modifier = Modifier.size(36.dp)) {
                            NexyIcon(
                                NexyIconName.Expand,
                                contentDescription = "Float microphone",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .alpha(if (canSend) 1f else 0.38f)
                            .background(
                                color = if (canSend) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f),
                                shape = RoundedCornerShape(2.dp),
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        IconButton(
                            onClick = { if (canSend) onSend() },
                            enabled = canSend,
                            modifier = Modifier.size(40.dp),
                        ) {
                            NexyIcon(
                                NexyIconName.Send,
                                contentDescription = "Send",
                                tint = if (canSend) MaterialTheme.colorScheme.onPrimary
                                else MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatRefreshableContent(
    isRefreshing: Boolean,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit,
    content: @Composable () -> Unit,
) {
    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = onRefresh,
        modifier = modifier,
    ) {
        content()
    }
}

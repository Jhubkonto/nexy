package io.nexy.android.ui.settings

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.EffectiveConnectionMode
import io.nexy.android.data.StandaloneProviderStore
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.chat.ModelPickerSheet
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.model.activeModelLabel
import io.nexy.android.ui.model.filterModelsByConfiguredProviders
import io.nexy.android.ui.model.hasResolvableDefaultModel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GlobalSettingsScreen(onBack: () -> Unit, onOpenProviders: () -> Unit = {}) {
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val effectiveMode by WsRepository.effectiveMode.collectAsStateWithLifecycle()
    val disconnected = connectionState != ConnectionState.CONNECTED
    val modelOptions by WsRepository.models.collectAsStateWithLifecycle()
    val cliStatus by WsRepository.cliStatus.collectAsStateWithLifecycle()
    val hermesInfo by WsRepository.hermesInfo.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val standaloneProviderStore = remember { StandaloneProviderStore.get(context) }
    val standaloneProviders by standaloneProviderStore.providers.collectAsStateWithLifecycle()
    val configuredProviderIds = standaloneProviders.filter { it.configured }.map { it.id }.toSet()
    val standaloneModelOptions = filterModelsByConfiguredProviders(modelOptions, configuredProviderIds)

    var defaultDesktopModel by remember { mutableStateOf("") }
    var defaultDesktopHermesProfile by remember { mutableStateOf("") }
    var defaultStandaloneModel by remember { mutableStateOf("") }
    var showDesktopModelSheet by remember { mutableStateOf(false) }
    var showStandaloneModelSheet by remember { mutableStateOf(false) }
    val desktopModelSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val standaloneModelSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var temperature by remember { mutableStateOf("") }
    var maxTokens by remember { mutableStateOf("") }
    var autoStart by remember { mutableStateOf(false) }
    var runInBackground by remember { mutableStateOf(false) }
    var autoClipboard by remember { mutableStateOf(false) }

    val hasResolvableDefaultModel = hasResolvableDefaultModel(
        effectiveMode = effectiveMode,
        hasModelOptions = modelOptions.isNotEmpty(),
        hasConfiguredProvider = configuredProviderIds.isNotEmpty(),
    )

    LaunchedEffect(Unit) {
        WsRepository.send("model:list", emptyMap())
        WsRepository.send("settings:get-default-desktop-model", emptyMap())
        WsRepository.getSetting("global_default_hermes_profile")
        WsRepository.send("settings:get-default-standalone-model", emptyMap())
        WsRepository.send("settings:get-default-temperature", emptyMap())
        WsRepository.send("settings:get-default-max-tokens", emptyMap())
        WsRepository.getSetting("autoStart")
        WsRepository.getSetting("runInBackground")
        WsRepository.getSetting("autoClipboard")
    }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.SettingValue -> when (event.key) {
                    "defaultDesktopModel" -> defaultDesktopModel = event.value.orEmpty()
                    "global_default_hermes_profile" -> defaultDesktopHermesProfile = event.value.orEmpty()
                    "defaultStandaloneModel" -> defaultStandaloneModel = event.value.orEmpty()
                    "defaultTemperature" -> temperature = event.value.orEmpty()
                    "defaultMaxTokens" -> maxTokens = event.value.orEmpty()
                    "autoStart" -> autoStart = event.value == "true"
                    "runInBackground" -> runInBackground = event.value == "true"
                    "autoClipboard" -> autoClipboard = event.value == "true"
                    else -> {}
                }
                is WsEvent.SettingSet -> when (event.key) {
                    "autoStart" -> autoStart = event.value == "true"
                    "runInBackground" -> runInBackground = event.value == "true"
                    "autoClipboard" -> autoClipboard = event.value == "true"
                    else -> {}
                }
                else -> {}
            }
        }
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Global Settings", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Configuration",
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            // — Model —
            GlobalSettingsSectionHeader("Model")

            Box(modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = if (defaultDesktopModel.isBlank()) "" else activeModelLabel(defaultDesktopModel, modelOptions),
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Default model (Desktop)") },
                    placeholder = { Text("e.g. claude-sonnet-4-6") },
                    enabled = modelOptions.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth(),
                )
            if (modelOptions.isNotEmpty()) {
                    Box(modifier = Modifier.matchParentSize().clickable { showDesktopModelSheet = true })
                }
            }

            if (modelOptions.any { it.id == defaultDesktopModel && it.backend == "hermes-cli" }) {
                OutlinedTextField(
                    value = defaultDesktopHermesProfile,
                    onValueChange = { value ->
                        defaultDesktopHermesProfile = value
                        WsRepository.setSetting("global_default_hermes_profile", value)
                    },
                    label = { Text("Hermes profile") },
                    placeholder = { Text("Default profile") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (hermesInfo.profiles.isNotEmpty()) {
                    Text(
                        "Available: ${hermesInfo.profiles.joinToString(", ") { it.name }}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Box(modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = if (defaultStandaloneModel.isBlank()) "" else activeModelLabel(defaultStandaloneModel, standaloneModelOptions),
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Default model (Standalone)") },
                    placeholder = { Text("e.g. claude-sonnet-4-6") },
                    enabled = configuredProviderIds.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (configuredProviderIds.isNotEmpty()) {
                    Box(modifier = Modifier.matchParentSize().clickable { showStandaloneModelSheet = true })
                }
            }
            if (configuredProviderIds.isEmpty()) {
                Column {
                    Text(
                        "No provider has a usable key on this device yet, so there's no standalone default model to pick. A provider configured only on your desktop doesn't count here — its key never syncs to this device automatically.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    TextButton(
                        onClick = onOpenProviders,
                        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 4.dp),
                    ) {
                        Text("Open API Providers")
                    }
                }
            }

            // — Generation —
            GlobalSettingsSectionHeader("Generation")

            OutlinedTextField(
                value = temperature,
                onValueChange = { v ->
                    temperature = v
                    v.toDoubleOrNull()?.let { WsRepository.send("settings:set-default-temperature", mapOf("temperature" to it)) }
                },
                label = { Text("Default temperature") },
                placeholder = { Text("0.0 – 1.0") },
                singleLine = true,
                enabled = hasResolvableDefaultModel,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = maxTokens,
                onValueChange = { v ->
                    maxTokens = v
                    v.toIntOrNull()?.let { WsRepository.send("settings:set-default-max-tokens", mapOf("maxTokens" to it)) }
                },
                label = { Text("Default max tokens") },
                placeholder = { Text("256 – 128000") },
                singleLine = true,
                enabled = hasResolvableDefaultModel,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )

            if (!hasResolvableDefaultModel) {
                Column {
                    Text(
                        if (effectiveMode == EffectiveConnectionMode.STANDALONE_BY_CHOICE) {
                            "Add a usable API provider key on this device to set generation defaults in standalone mode. A key configured only on your desktop isn't enough — it never syncs here automatically."
                        } else {
                            "Connect to desktop at least once to load models before setting generation defaults."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (effectiveMode == EffectiveConnectionMode.STANDALONE_BY_CHOICE) {
                        TextButton(
                            onClick = onOpenProviders,
                            contentPadding = PaddingValues(horizontal = 0.dp, vertical = 4.dp),
                        ) {
                            Text("Open API Providers")
                        }
                    }
                }
            }

            // — Behaviour —
            GlobalSettingsSectionHeader("Behaviour")

            GlobalSettingsToggleRow(
                title = "Start Nexy desktop on login",
                subtitle = "Launch Nexy in the desktop tray when you sign in on the computer",
                checked = autoStart,
                enabled = !disconnected,
                onCheckedChange = {
                    autoStart = it
                    WsRepository.setSetting("autoStart", it.toString())
                },
            )

            GlobalSettingsToggleRow(
                title = "Run Nexy desktop in background",
                subtitle = "Closing its window keeps the desktop scheduler running in the tray",
                checked = runInBackground,
                enabled = !disconnected,
                onCheckedChange = {
                    runInBackground = it
                    WsRepository.setSetting("runInBackground", it.toString())
                },
            )

            if (runInBackground && !autoStart) {
                Text(
                    "Enable Start Nexy desktop on login too if schedules should be armed automatically after you sign in.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.tertiary,
                )
            }

            GlobalSettingsToggleRow(
                title = "Auto-clipboard",
                subtitle = "Paste clipboard content into the composer on focus",
                checked = autoClipboard,
                enabled = !disconnected,
                onCheckedChange = {
                    autoClipboard = it
                    WsRepository.setSetting("autoClipboard", it.toString())
                },
            )

            if (disconnected) {
                Text(
                    "Connect to the desktop to change its startup, background, or clipboard settings.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }

    if (showDesktopModelSheet) {
        ModalBottomSheet(
            onDismissRequest = { showDesktopModelSheet = false },
            sheetState = desktopModelSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ModelPickerSheet(
                title = "Default model (Desktop)",
                models = modelOptions,
                cliStatus = cliStatus,
                selectedModelId = defaultDesktopModel.ifBlank { null },
                effectiveMode = EffectiveConnectionMode.CONNECTED,
            ) { modelId ->
                defaultDesktopModel = modelId ?: ""
                WsRepository.send("settings:set-default-desktop-model", mapOf("modelId" to (modelId ?: "")))
                val isHermes = modelOptions.any { it.id == modelId && it.backend == "hermes-cli" }
                if (!isHermes) {
                    defaultDesktopHermesProfile = ""
                    WsRepository.setSetting("global_default_hermes_profile", "")
                }
                scope.launch { desktopModelSheetState.hide() }.invokeOnCompletion { showDesktopModelSheet = false }
            }
        }
    }

    if (showStandaloneModelSheet) {
        ModalBottomSheet(
            onDismissRequest = { showStandaloneModelSheet = false },
            sheetState = standaloneModelSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ModelPickerSheet(
                title = "Default model (Standalone)",
                models = standaloneModelOptions,
                cliStatus = cliStatus,
                selectedModelId = defaultStandaloneModel.ifBlank { null },
                emptyStateText = "Add an API provider key to see standalone models here.",
                effectiveMode = EffectiveConnectionMode.STANDALONE_BY_CHOICE,
            ) { modelId ->
                defaultStandaloneModel = modelId ?: ""
                WsRepository.send("settings:set-default-standalone-model", mapOf("modelId" to (modelId ?: "")))
                scope.launch { standaloneModelSheetState.hide() }.invokeOnCompletion { showStandaloneModelSheet = false }
            }
        }
    }
}

@Composable
private fun GlobalSettingsSectionHeader(title: String) {
    Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun GlobalSettingsToggleRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(
            checked = checked,
            onCheckedChange = { if (enabled) onCheckedChange(it) },
            enabled = enabled,
            colors = SwitchDefaults.colors(
                uncheckedTrackColor = MaterialTheme.colorScheme.surfaceVariant,
                uncheckedBorderColor = MaterialTheme.colorScheme.outline,
                uncheckedThumbColor = MaterialTheme.colorScheme.outline,
            ),
        )
    }
}

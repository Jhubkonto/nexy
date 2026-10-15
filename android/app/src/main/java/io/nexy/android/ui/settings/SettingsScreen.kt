package io.nexy.android.ui.settings

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onForgetServer: () -> Unit,
    onOpenAppearance: () -> Unit = {},
    onOpenConnection: () -> Unit = {},
    onOpenModels: () -> Unit = {},
    onOpenNotifications: () -> Unit = {},
    onOpenVoiceAudio: () -> Unit = {},
    onOpenUpdates: () -> Unit = {},
    onOpenDiagnostics: () -> Unit = {},
    onOpenProviders: () -> Unit = {},
    onOpenCredentials: () -> Unit = {},
    onOpenPromptLibrary: () -> Unit = {},
    onOpenGlobalSettings: () -> Unit = {},
    onOpenMcpServers: () -> Unit = {},
    onOpenCliModels: () -> Unit = {},
    onOpenBuildDashboard: () -> Unit = {},
    onOpenDebugLog: () -> Unit = {},
    onOpenBackupRecovery: () -> Unit = {},
) {
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val desktopConnected = connectionState == ConnectionState.CONNECTED
    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Settings", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            // — General —
            SettingsSectionHeader("General")
            SettingsNavRow(
                title = "Appearance",
                detail = "Light, Dark, or System theme",
                onClick = onOpenAppearance,
            )
            SettingsNavRow(
                title = "Connection",
                detail = "Server profiles and connection status",
                onClick = onOpenConnection,
            )
            SettingsNavRow(
                title = "Notifications",
                detail = "Tool approval push notifications",
                onClick = onOpenNotifications,
            )
            SettingsNavRow(
                title = "Voice & audio",
                detail = "Voice Dock and microphone input",
                onClick = onOpenVoiceAudio,
            )
            SettingsNavRow(
                title = "Updates",
                detail = "App version and OTA install",
                onClick = onOpenUpdates,
            )
            SettingsNavRow(
                title = "Backup and recovery",
                detail = "Encrypted export and restore of standalone data",
                onClick = onOpenBackupRecovery,
            )

            // — Configuration —
            SettingsSectionHeader("Configuration")
            SettingsNavRow(
                title = "Global Settings",
                detail = "Default model, temperature, auto-start, clipboard",
                onClick = onOpenGlobalSettings,
            )
            SettingsNavRow(
                title = "Models",
                detail = "Available standalone and desktop models",
                onClick = onOpenModels,
            )
            SettingsNavRow(
                title = "MCP Servers",
                detail = if (desktopConnected) "Manage MCP servers connected to your desktop" else "Requires a connected desktop",
                onClick = onOpenMcpServers,
                enabled = desktopConnected,
            )
            SettingsNavRow(
                title = "CLI Models",
                detail = if (desktopConnected) "Claude CLI, Codex CLI and other installed backends" else "Requires a connected desktop",
                onClick = onOpenCliModels,
                enabled = desktopConnected,
            )
            SettingsNavRow(
                title = "API Providers",
                detail = "Encrypted keys for standalone and desktop chat",
                onClick = onOpenProviders,
            )
            SettingsNavRow(
                title = "Credential Manager",
                detail = "Store reusable credentials and manage access grants",
                onClick = onOpenCredentials,
            )
            SettingsNavRow(
                title = "Prompt Library",
                detail = "Browse and manage reusable prompt templates",
                onClick = onOpenPromptLibrary,
            )

            // — Developer —
            SettingsSectionHeader("Developer")
            SettingsNavRow(
                title = "Build Dashboard",
                detail = if (desktopConnected) "Build records, preflight, and APK publish/restore" else "Requires a connected desktop",
                onClick = onOpenBuildDashboard,
                enabled = desktopConnected,
            )
            SettingsNavRow(
                title = "Diagnostics",
                detail = "Connection info and bug reports",
                onClick = onOpenDiagnostics,
            )
            SettingsNavRow(
                title = "Debug Log",
                detail = "Live diagnostic messages from the app",
                onClick = onOpenDebugLog,
            )

            HorizontalDivider(
                color = MaterialTheme.colorScheme.outlineVariant,
                modifier = Modifier.padding(bottom = 24.dp),
            )
        }
    }
}

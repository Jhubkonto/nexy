package io.nexy.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.CredentialBindingMetadata
import io.nexy.android.data.CredentialMetadata
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.Project
import io.nexy.android.ui.components.NexyTopAppBar
import kotlinx.coroutines.launch

private data class CredentialKindOption(val value: String, val label: String)

private val credentialKinds = listOf(
    CredentialKindOption("password", "Website login"),
    CredentialKindOption("token", "Access token"),
    CredentialKindOption("env-bundle", "Environment secret"),
    CredentialKindOption("secret-file", "Secret file"),
    CredentialKindOption("api-key", "Generic API key"),
)

@Composable
fun CredentialManagerScreen(
    onBack: () -> Unit,
    vm: CredentialManagerViewModel = viewModel(),
) {
    val credentials by vm.credentials.collectAsStateWithLifecycle()
    val bindings by vm.bindings.collectAsStateWithLifecycle()
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val managedCredentials = credentials.filter { it.provider == null }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf<CredentialMetadata?>(null) }
    var adding by remember { mutableStateOf(false) }
    var bindingCredential by remember { mutableStateOf<CredentialMetadata?>(null) }
    var deleting by remember { mutableStateOf<CredentialMetadata?>(null) }

    if (adding || editing != null) {
        CredentialEditDialog(
            credential = editing,
            onDismiss = { adding = false; editing = null },
            onSave = { name, kind, value, targetOrigin, username ->
                scope.launch {
                    vm.saveCredential(editing, name, kind, editing?.provider.orEmpty(), value, targetOrigin, username)
                        .onSuccess {
                            adding = false
                            editing = null
                            snackbar.showSnackbar("Credential saved securely on this device.")
                        }
                        .onFailure { snackbar.showSnackbar(it.message ?: "Could not save credential.") }
                }
            },
        )
    }

    bindingCredential?.let { credential ->
        CredentialBindingDialog(
            credential = credential,
            projects = projects,
            onDismiss = { bindingCredential = null },
            onCreate = { projectId, agentId, capability, approvalMode ->
                scope.launch {
                    vm.createBinding(credential.id, projectId, agentId, capability, approvalMode)
                        .onSuccess {
                            bindingCredential = null
                            snackbar.showSnackbar("Access grant saved.")
                        }
                        .onFailure { snackbar.showSnackbar(it.message ?: "Could not create access grant.") }
                }
            },
        )
    }

    deleting?.let { credential ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete credential?") },
            text = { Text("\"${credential.name}\" and all of its access grants will be removed from this device.") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        vm.deleteCredential(credential)
                            .onSuccess { snackbar.showSnackbar("Credential deleted.") }
                            .onFailure { snackbar.showSnackbar(it.message ?: "Could not delete credential.") }
                        deleting = null
                    }
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Credential Manager", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Configuration",
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            item {
                Surface(color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            "Secrets are encrypted in this device's Android Keystore-backed vault. Secret values are never displayed after saving or included in sync metadata.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                        Text(
                            "Generic API keys and access tokens can be granted to Android direct chat with provider:anthropic, provider:openai, or provider:openrouter. MCP and workspace capabilities still run on the paired desktop.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                    }
                }
            }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("Credentials (${managedCredentials.size})", style = MaterialTheme.typography.titleSmall)
                    TextButton(onClick = { adding = true }) { Text("Add credential") }
                }
            }
            if (managedCredentials.isEmpty()) {
                item {
                    Text(
                        "No credentials saved yet.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    )
                }
            }
            items(managedCredentials, key = { it.id }) { credential ->
                CredentialRow(
                    credential = credential,
                    bindings = bindings.filter { it.credentialId == credential.id },
                    onEdit = { editing = credential },
                    onDelete = { deleting = credential },
                    onBind = { bindingCredential = credential },
                    onToggleRevoked = { revoked ->
                        scope.launch {
                            vm.setRevoked(credential, revoked)
                                .onFailure { snackbar.showSnackbar(it.message ?: "Could not update credential.") }
                        }
                    },
                    onDeleteBinding = { binding ->
                        scope.launch {
                            vm.deleteBinding(binding)
                                .onSuccess { snackbar.showSnackbar("Access grant removed.") }
                                .onFailure { snackbar.showSnackbar(it.message ?: "Could not remove access grant.") }
                        }
                    },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

@Composable
private fun CredentialRow(
    credential: CredentialMetadata,
    bindings: List<CredentialBindingMetadata>,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onBind: () -> Unit,
    onToggleRevoked: (Boolean) -> Unit,
    onDeleteBinding: (CredentialBindingMetadata) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(credential.name, style = MaterialTheme.typography.titleSmall)
                Text(
                    "${credentialKinds.firstOrNull { it.value == credential.kind }?.label ?: credential.kind} · ${if (credential.revokedAt == null) "Active" else "Revoked"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (credential.revokedAt == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                )
                credential.targetOrigin?.let { Text("Website: $it · ${credential.username.orEmpty()}", style = MaterialTheme.typography.bodySmall) }
                Text(
                    "Fingerprint ${credential.fingerprint.take(8)}… · ${credential.lastUsedAt?.let { "Used ${java.text.DateFormat.getDateInstance().format(java.util.Date(it))}" } ?: "Not used yet"}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Column {
                TextButton(onClick = onEdit) { Text("Edit") }
                TextButton(onClick = { onToggleRevoked(credential.revokedAt == null) }) {
                    Text(if (credential.revokedAt == null) "Revoke" else "Restore")
                }
                TextButton(onClick = onDelete) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Access grants (${bindings.size})", style = MaterialTheme.typography.labelMedium)
            TextButton(onClick = onBind) { Text("Add grant") }
        }
        bindings.forEach { binding ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    bindingDescription(binding),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = { onDeleteBinding(binding) }) { Text("Remove") }
            }
        }
    }
}

private fun bindingDescription(binding: CredentialBindingMetadata): String = buildString {
    append(binding.capability)
    val scope = listOfNotNull(binding.projectId?.let { "project $it" }, binding.agentId?.let { "agent $it" }, binding.conversationId?.let { "chat $it" })
    append(" · ")
    append(if (scope.isEmpty()) "all projects" else scope.joinToString(", "))
    append(" · ")
    append(if (binding.approvalMode == "always-ask") "always ask" else "automatic")
    binding.expiresAt?.let { append(" · expires ${java.text.DateFormat.getDateInstance().format(java.util.Date(it))}") }
}

@Composable
private fun CredentialEditDialog(
    credential: CredentialMetadata?,
    onDismiss: () -> Unit,
    onSave: (String, String, String, String?, String?) -> Unit,
) {
    var name by remember(credential?.id) { mutableStateOf(credential?.name.orEmpty()) }
    var kind by remember(credential?.id) { mutableStateOf(credential?.kind ?: "token") }
    var value by remember(credential?.id) { mutableStateOf("") }
    var origin by remember(credential?.id) { mutableStateOf(credential?.targetOrigin.orEmpty()) }
    var username by remember(credential?.id) { mutableStateOf(credential?.username.orEmpty()) }
    var kindMenuExpanded by remember { mutableStateOf(false) }
    val selectedKind = credentialKinds.firstOrNull { it.value == kind }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (credential == null) "Add credential" else "Edit credential") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (credential == null) {
                    Column {
                        TextButton(onClick = { kindMenuExpanded = true }) {
                            Text("Type: ${selectedKind?.label ?: kind}")
                        }
                        DropdownMenu(expanded = kindMenuExpanded, onDismissRequest = { kindMenuExpanded = false }) {
                            credentialKinds.forEach { option ->
                                DropdownMenuItem(
                                    text = { Text(option.label) },
                                    onClick = { kind = option.value; kindMenuExpanded = false },
                                )
                            }
                        }
                    }
                }
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Name") }, singleLine = true)
                if (credential == null && kind == "password") {
                    OutlinedTextField(value = origin, onValueChange = { origin = it }, label = { Text("Website HTTPS origin") }, placeholder = { Text("https://example.com") }, singleLine = true)
                    OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text("Username") }, singleLine = true)
                    Text("The login is restricted to this exact HTTPS origin.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it },
                    label = { Text(if (credential == null) "Secret value" else "Replace secret (optional)") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = false,
                )
                if (credential != null) {
                    Text("Leave the secret blank to keep the current encrypted value.", style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = name.isNotBlank() && (credential != null || value.isNotEmpty()) &&
                    (credential != null || kind != "password" || (origin.isNotBlank() && username.isNotBlank())),
                onClick = { onSave(name, kind, value, origin.takeIf { kind == "password" }, username.takeIf { kind == "password" }) },
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun CredentialBindingDialog(
    credential: CredentialMetadata,
    projects: List<Project>,
    onDismiss: () -> Unit,
    onCreate: (String?, String?, String, String) -> Unit,
) {
    var projectId by remember(credential.id) { mutableStateOf("") }
    var agentId by remember(credential.id) { mutableStateOf("") }
    var capability by remember(credential.id) { mutableStateOf("") }
    var approvalMode by remember(credential.id) { mutableStateOf("auto") }
    var projectMenuExpanded by remember(credential.id) { mutableStateOf(false) }
    val selectedProject = projects.firstOrNull { it.id == projectId }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Grant access") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Grant ${credential.name} to a specific Nexy capability.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(value = capability, onValueChange = { capability = it }, label = { Text("Capability ID") }, placeholder = { Text("e.g. provider:openai") }, singleLine = true)
                Column {
                    TextButton(onClick = { projectMenuExpanded = true }) {
                        Text("Project: ${selectedProject?.name ?: if (projectId.isBlank()) "All projects" else projectId}")
                    }
                    DropdownMenu(expanded = projectMenuExpanded, onDismissRequest = { projectMenuExpanded = false }) {
                        DropdownMenuItem(text = { Text("All projects") }, onClick = { projectId = ""; projectMenuExpanded = false })
                        projects.forEach { project ->
                            DropdownMenuItem(text = { Text(project.name) }, onClick = { projectId = project.id; projectMenuExpanded = false })
                        }
                    }
                }
                OutlinedTextField(value = agentId, onValueChange = { agentId = it }, label = { Text("Agent ID (optional)") }, singleLine = true)
                Text("Approval policy", style = MaterialTheme.typography.labelMedium)
                Row {
                    TextButton(onClick = { approvalMode = "auto" }) { Text(if (approvalMode == "auto") "✓ Automatic" else "Automatic") }
                    TextButton(onClick = { approvalMode = "always-ask" }) { Text(if (approvalMode == "always-ask") "✓ Always ask" else "Always ask") }
                }
                Text("For Android direct provider chat, use provider:anthropic, provider:openai, or provider:openrouter. Automatic grants are usable immediately; Always ask grants are not resolved automatically. Leave project and agent blank to apply across all projects and agents.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = {
            TextButton(enabled = capability.isNotBlank(), onClick = {
                onCreate(projectId.trim().takeIf(String::isNotEmpty), agentId.trim().takeIf(String::isNotEmpty), capability.trim(), approvalMode)
            }) { Text("Grant") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

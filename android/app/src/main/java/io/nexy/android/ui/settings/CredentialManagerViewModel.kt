package io.nexy.android.ui.settings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import io.nexy.android.data.CredentialBindingMetadata
import io.nexy.android.data.CredentialMetadata
import io.nexy.android.data.CredentialVault
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/** Screen-local state for the device credential vault. Secrets never enter this state. */
class CredentialManagerViewModel(app: Application) : AndroidViewModel(app) {
    private val vault = CredentialVault.get(app)

    private val _credentials = MutableStateFlow(emptyList<CredentialMetadata>())
    val credentials: StateFlow<List<CredentialMetadata>> = _credentials.asStateFlow()

    private val _bindings = MutableStateFlow(emptyList<CredentialBindingMetadata>())
    val bindings: StateFlow<List<CredentialBindingMetadata>> = _bindings.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _credentials.value = vault.listMetadata()
        _bindings.value = vault.listBindings()
    }

    suspend fun saveCredential(
        existing: CredentialMetadata?,
        name: String,
        kind: String,
        provider: String,
        value: String,
        targetOrigin: String? = null,
        username: String? = null,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            if (existing == null) {
                vault.createCredential(name, kind, provider, value, targetOrigin, username)
            } else {
                vault.updateCredential(
                    id = existing.id,
                    name = name,
                    // A blank edit field deliberately preserves the existing encrypted secret.
                    value = value.takeIf { it.isNotBlank() },
                )
            }
            refresh()
        }
    }

    suspend fun setRevoked(credential: CredentialMetadata, revoked: Boolean): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            vault.updateCredential(credential.id, revoked = revoked)
            refresh()
        }
    }

    suspend fun deleteCredential(credential: CredentialMetadata): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            check(vault.deleteCredential(credential.id)) { "Credential not found" }
            refresh()
        }
    }

    suspend fun createBinding(
        credentialId: String,
        projectId: String?,
        agentId: String?,
        capability: String,
        approvalMode: String,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            vault.createBinding(
                credentialId = credentialId,
                projectId = projectId,
                agentId = agentId,
                capability = capability,
                approvalMode = approvalMode,
            )
            refresh()
        }
    }

    suspend fun deleteBinding(binding: CredentialBindingMetadata): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            check(vault.deleteBinding(binding.id)) { "Binding not found" }
            refresh()
        }
    }
}

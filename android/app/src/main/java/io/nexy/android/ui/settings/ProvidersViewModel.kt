package io.nexy.android.ui.settings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.StandaloneProviderStore
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ProvidersViewModel(app: Application) : AndroidViewModel(app) {

    private val localStore = StandaloneProviderStore.get(app)
    private val _providers = MutableStateFlow(localStore.providers.value)
    val providers: StateFlow<List<ProviderInfo>> = _providers.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _azureEndpoint = MutableStateFlow("")
    val azureEndpoint: StateFlow<String> = _azureEndpoint.asStateFlow()

    private val _testResult = MutableStateFlow<Pair<String, Boolean>?>(null)
    val testResult: StateFlow<Pair<String, Boolean>?> = _testResult.asStateFlow()

    private val _testError = MutableStateFlow<String?>(null)
    val testError: StateFlow<String?> = _testError.asStateFlow()

    private val _isTesting = MutableStateFlow(false)
    val isTesting: StateFlow<Boolean> = _isTesting.asStateFlow()

    private var timeoutJob: Job? = null

    init {
        viewModelScope.launch {
            localStore.providers.collect { local ->
                _providers.value = mergeProviders(local, WsRepository.providers.value)
            }
        }
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.ProviderList -> {
                        _providers.value = mergeProviders(localStore.providers.value, WsRepository.providers.value)
                        timeoutJob?.cancel()
                        _isLoading.value = false
                        _error.value = null
                    }
                    is WsEvent.ProviderAzureEndpoint -> {
                        _azureEndpoint.value = event.endpoint
                    }
                    is WsEvent.ProviderAzureEndpointSet -> {
                        _azureEndpoint.value = event.endpoint
                    }
                    is WsEvent.ProviderTestResult -> {
                        _isTesting.value = false
                        _testResult.value = event.provider to event.valid
                        _testError.value = event.error
                    }
                    else -> {}
                }
            }
        }
        viewModelScope.launch {
            WsRepository.connectionState.collect { state ->
                if (state == ConnectionState.CONNECTED) {
                    refresh()
                    WsRepository.getAzureEndpoint()
                }
            }
        }
    }

    fun refresh() {
        if (WsRepository.connectionState.value != ConnectionState.CONNECTED) {
            _isLoading.value = false
            _error.value = null
            _providers.value = localStore.providers.value
            return
        }
        _isLoading.value = true
        _error.value = null
        WsRepository.getProviders()
        timeoutJob?.cancel()
        timeoutJob = viewModelScope.launch {
            delay(10_000)
            if (_isLoading.value) {
                _isLoading.value = false
                _error.value = "Request timed out. Check desktop connection."
            }
        }
    }

    fun dismissError() { _error.value = null }

    fun setKey(provider: String, key: String) {
        if (provider in setOf("anthropic", "openai", "openrouter", "deepseek")) {
            localStore.setKey(provider, key)
        }
        if (WsRepository.connectionState.value == ConnectionState.CONNECTED) {
            WsRepository.setProviderKey(provider, key)
        }
    }

    fun removeKey(provider: String) {
        if (provider in setOf("anthropic", "openai", "openrouter", "deepseek")) {
            localStore.removeKey(provider)
        }
        if (WsRepository.connectionState.value == ConnectionState.CONNECTED) {
            WsRepository.removeProviderKey(provider)
        }
    }

    fun saveAzureEndpoint(endpoint: String) {
        WsRepository.setAzureEndpoint(endpoint)
    }

    fun testKey(provider: String, key: String, endpoint: String? = null) {
        _isTesting.value = true
        _testResult.value = null
        _testError.value = null
        viewModelScope.launch {
            val result = WsRepository.testStandaloneProvider(provider, key, endpoint)
            _isTesting.value = false
            _testResult.value = provider to result.first
            _testError.value = result.second
        }
    }

    fun dismissTestResult() {
        _testResult.value = null
        _testError.value = null
    }

    private fun mergeProviders(
        local: List<ProviderInfo>,
        remote: List<ProviderInfo>,
    ): List<ProviderInfo> = mergeProviderLists(local, remote)
}

/**
 * Merges local (device-encrypted) and desktop-reported provider state. `configured`
 * always reflects whether THIS device has a real, usable key — never desktop's flag alone
 * — so standalone mode never claims a provider is usable when only desktop has the key.
 * `configuredOnDesktopOnly` distinguishes that "known but not usable here yet" state so
 * the UI can offer a key handoff or manual entry instead of a plain "Connected" badge.
 */
internal fun mergeProviderLists(
    local: List<ProviderInfo>,
    remote: List<ProviderInfo>,
): List<ProviderInfo> {
    val byId = remote.associateBy { it.id }.toMutableMap()
    local.forEach { item ->
        val desktop = byId[item.id]
        byId[item.id] = item.copy(
            configured = item.configured,
            configuredOnDesktopOnly = !item.configured && desktop?.configured == true,
        )
    }
    return byId.values.sortedBy { it.label }
}

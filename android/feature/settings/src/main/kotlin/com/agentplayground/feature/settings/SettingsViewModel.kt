package com.agentplayground.feature.settings

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.agentplayground.domain.repository.PreferencesRepository
import com.agentplayground.domain.repository.ServerRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel(assistedFactory = SettingsViewModel.Factory::class)
internal class SettingsViewModel
@AssistedInject
constructor(
    private val store: PreferencesRepository,
    private val savedState: SavedStateHandle,
    @Assisted serverUrl: String,
    private val server: ServerRepository,
) : ViewModel() {
    @AssistedFactory
    interface Factory {
        fun create(serverUrl: String): SettingsViewModel
    }

    private val mutableState =
        MutableStateFlow(SettingsState(server = savedState["server"] ?: serverUrl))
    val state = mutableState.asStateFlow()

    private var savedServerUrl = serverUrl
    private var connectionJob: Job? = null

    fun savedServerChanged(serverUrl: String) {
        if (serverUrl == savedServerUrl) {
            return
        }

        savedServerUrl = serverUrl
        savedState["server"] = serverUrl
        mutableState.update { it.copy(server = serverUrl) }
    }

    fun editServer(value: String) {
        savedState["server"] = value
        mutableState.update {
            it.copy(server = value, status = null, error = null, permissionDenied = false)
        }
    }

    fun showNetworkBlocked() {
        mutableState.update {
            it.copy(permissionDenied = true, status = null, connectedServerUrl = null)
        }
    }

    fun connect() {
        if (state.value.pending) {
            return
        }

        try {
            val server = server.normalizeUrl(state.value.server)

            mutableState.update {
                it.copy(pending = true, permissionRequest = server, error = null, status = null)
            }
        } catch (cause: Exception) {
            connectionFailed(cause)
        }
    }

    fun networkAccessResult(serverUrl: String, allowed: Boolean) {
        if (state.value.permissionRequest != serverUrl) {
            return
        }

        mutableState.update {
            it.copy(permissionRequest = null, permissionDenied = !allowed, pending = allowed)
        }

        if (!allowed) {
            return
        }

        // Install ownership before starting, including checks that complete without suspending.
        val job =
            viewModelScope.launch(start = CoroutineStart.LAZY) {
                val activeJob = coroutineContext[Job]

                try {
                    val model = server.checkConnection(serverUrl)

                    coroutineContext.ensureActive()
                    store.updateServerUrl(serverUrl)

                    if (connectionJob === activeJob) {
                        mutableState.update {
                            it.copy(status = "Connected · $model", connectedServerUrl = serverUrl)
                        }
                    }
                } catch (cause: Exception) {
                    if (cause is CancellationException) {
                        throw cause
                    }

                    if (connectionJob === activeJob) {
                        connectionFailed(cause)
                    }
                } finally {
                    if (connectionJob === activeJob) {
                        connectionJob = null
                        mutableState.update { it.copy(pending = false) }
                    }
                }
            }

        connectionJob = job
        job.start()
    }

    fun cancelConnection() {
        val job = connectionJob

        connectionJob = null
        job?.cancel()
        mutableState.update {
            it.copy(pending = false, permissionRequest = null, connectedServerUrl = null)
        }
    }

    fun networkAccessFailed(serverUrl: String, cause: Exception) {
        if (state.value.permissionRequest == serverUrl) {
            connectionFailed(cause)
        }
    }

    fun connectedHandled(serverUrl: String) {
        mutableState.update {
            if (it.connectedServerUrl == serverUrl) {
                it.copy(connectedServerUrl = null)
            } else {
                it
            }
        }
    }

    fun updateTheme(value: String) = save { store.updateTheme(value) }

    fun updateReplyAnimation(value: Boolean) = save { store.updateReplyAnimation(value) }

    fun updateSendShortcut(value: String) = save { store.updateSendShortcut(value) }

    fun resetAppearanceAndKeyboard() = save { store.resetAppearanceAndKeyboard() }

    private fun save(update: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                update()
            } catch (cause: Exception) {
                if (cause is CancellationException) {
                    throw cause
                }

                mutableState.update {
                    it.copy(error = cause.message ?: "Settings could not be saved.")
                }
            }
        }
    }

    private fun connectionFailed(cause: Exception) {
        if (cause is CancellationException) {
            throw cause
        }

        mutableState.update {
            it.copy(
                pending = false,
                permissionRequest = null,
                error = cause.message ?: "Connection failed.",
            )
        }
    }
}

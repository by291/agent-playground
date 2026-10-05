package com.agentplayground.app.features.knowledge

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.agentplayground.app.files.*
import com.agentplayground.core.*
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

class KnowledgeViewModel(val api: PlaygroundApi, private val files: DocumentAccess) : ViewModel() {
    private val mutable = MutableStateFlow(KnowledgeUiState())
    val state = mutable.asStateFlow()
    private var polling: Job? = null
    private var refreshing = false

    fun setVisible(visible: Boolean) {
        polling?.cancel()
        if (!visible) {
            return
        }
        polling = viewModelScope.launch {
            refresh()
            while (isActive) {
                delay(3_000.milliseconds)
                if (
                    state.value.documents.any {
                        it.status in setOf("queued", "indexing", "uploading")
                    }
                ) {
                    refresh()
                }
            }
        }
    }

    fun reload() {
        viewModelScope.launch { refresh() }
    }

    private suspend fun refresh() {
        if (refreshing) {
            return
        }
        refreshing = true
        mutable.update { it.copy(loading = true) }
        try {
            val documents = api.documents()
            mutable.update {
                it.copy(
                    documents = documents,
                    error =
                        if (it.pendingUploads.isEmpty()) {
                            null
                        } else {
                            it.error
                        },
                )
            }
        } catch (error: Exception) {
            if (error is CancellationException) {
                throw error
            }
            mutable.update { it.copy(error = error.message ?: "Could not load documents.") }
        } finally {
            refreshing = false
            mutable.update { it.copy(loading = false) }
        }
    }

    fun upload(uris: List<Uri>) {
        if (mutable.value.busy || mutable.value.pendingUploads.isNotEmpty()) {
            return
        }

        mutable.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            action {
                val picked = uris.map { files.inspect(it) }
                mutable.update { it.copy(pendingUploads = picked) }
                sendUploads()
            }
        }
    }

    fun retryUploads() {
        if (mutable.value.pendingUploads.isEmpty()) {
            return
        }

        mutate("Retrying documents…") { sendUploads() }
    }

    fun discardUploads() {
        if (!mutable.value.busy) {
            mutable.update { it.copy(pendingUploads = emptyList(), error = null) }
        }
    }

    private suspend fun sendUploads() {
        for (file in state.value.pendingUploads) {
            mutable.update { it.copy(operation = "Uploading ${file.name}…") }
            api.uploadDocument(file.id, file.name, files.read(file))
            mutable.update {
                it.copy(
                    pendingUploads =
                        it.pendingUploads.filterNot { pending -> pending.id == file.id }
                )
            }
            refresh()
        }
    }

    fun reindex(id: String) {
        mutate("Reindexing document…") {
            api.reindex(id)
            refresh()
        }
    }

    fun delete(id: String, completed: () -> Unit) {
        mutate("Deleting document…") {
            api.deleteDocument(id)
            refresh()
            completed()
        }
    }

    fun save(download: Download, uri: Uri) {
        mutate("Saving ${download.name}…") { files.save(api, download, uri) }
    }

    private fun mutate(label: String, block: suspend () -> Unit) {
        if (mutable.value.busy) {
            return
        }
        mutable.update { it.copy(busy = true, error = null, operation = label) }
        viewModelScope.launch { action(block) }
    }

    private suspend fun action(block: suspend () -> Unit) {
        try {
            block()
        } catch (error: Exception) {
            if (error is CancellationException) {
                throw error
            }
            mutable.update { it.copy(error = error.message ?: "Document operation failed.") }
        } finally {
            mutable.update { it.copy(busy = false, operation = null) }
        }
    }

    override fun onCleared() {
        api.close()
    }
}

data class KnowledgeUiState(
    val documents: List<KnowledgeDocument> = emptyList(),
    val loading: Boolean = false,
    val busy: Boolean = false,
    val operation: String? = null,
    val error: String? = null,
    val pendingUploads: List<PickedFile> = emptyList(),
)

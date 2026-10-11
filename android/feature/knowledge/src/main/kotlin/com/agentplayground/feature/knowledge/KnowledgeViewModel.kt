package com.agentplayground.feature.knowledge

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.KnowledgeDocument
import com.agentplayground.domain.repository.KnowledgeRepository
import com.agentplayground.domain.repository.RepositoryProvider
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Coordinates visible-page polling and uploads; failed transfers retain their selected file IDs.
 */
@HiltViewModel(assistedFactory = KnowledgeViewModel.Factory::class)
class KnowledgeViewModel(private val repository: KnowledgeRepository) : ViewModel() {
    private val mutable = MutableStateFlow(KnowledgeUiState())
    val state = mutable.asStateFlow()

    private var polling: Job? = null
    private val refreshMutex = Mutex()

    @AssistedInject
    constructor(
        repositories: RepositoryProvider,
        @Assisted serverUrl: String,
    ) : this(repositories.knowledge(serverUrl))

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

    private suspend fun refresh(preserveError: Boolean = false) = refreshMutex.withLock {
        mutable.update { it.copy(loading = true) }

        try {
            val documents = repository.documents()

            mutable.update {
                it.copy(
                    documents = documents,
                    error =
                        if (preserveError || it.pendingUploads.isNotEmpty()) {
                            it.error
                        } else {
                            null
                        },
                )
            }
        } catch (error: Exception) {
            if (error is CancellationException) {
                throw error
            }

            mutable.update {
                it.copy(
                    error =
                        if (preserveError && it.error != null) {
                            it.error
                        } else {
                            error.message ?: "Could not load documents."
                        }
                )
            }
        } finally {
            mutable.update { it.copy(loading = false) }
        }
    }

    fun upload(uris: List<Uri>) {
        uploadSelection(uris)
    }

    fun beginResume(id: String): Boolean {
        if (state.value.busy || state.value.pendingUploads.isNotEmpty()) {
            return false
        }

        val document =
            state.value.documents.find { it.id == id && it.status == "uploading" } ?: return false

        mutable.update { it.copy(resumeDocument = document, error = null) }

        return true
    }

    fun resumeUpload(uri: Uri?) {
        val document = state.value.resumeDocument ?: return

        mutable.update { it.copy(resumeDocument = null) }

        if (uri != null) {
            uploadSelection(listOf(uri), document)
        }
    }

    private fun uploadSelection(uris: List<Uri>, resumed: KnowledgeDocument? = null) {
        if (uris.isEmpty() || mutable.value.busy || mutable.value.pendingUploads.isNotEmpty()) {
            return
        }

        mutable.update { it.copy(busy = true, error = null) }

        viewModelScope.launch {
            action(refreshOnFailure = false) {
                val picked = repository.inspectUploads(uris.map { it.toString() }, resumed)

                mutable.update { it.copy(pendingUploads = picked) }

                sendUploads()
            }
        }
    }

    fun retryUploads() {
        if (mutable.value.pendingUploads.isEmpty()) {
            return
        }

        mutate("Retrying documents…", refreshOnFailure = false) { sendUploads() }
    }

    fun discardUploads() {
        if (!mutable.value.busy) {
            mutable.update { it.copy(pendingUploads = emptyList(), error = null) }
        }
    }

    private suspend fun sendUploads() {
        for (file in state.value.pendingUploads) {
            mutable.update { it.copy(operation = "Uploading ${file.name}…") }

            // A local read failure cannot have admitted a server resource and needs no refresh.
            val upload = repository.prepareUpload(file)

            try {
                repository.upload(upload)
            } catch (error: Exception) {
                if (error is CancellationException) {
                    throw error
                }

                mutable.update { it.copy(error = error.message ?: "Document upload failed.") }

                // A failed response can follow successful server admission. Reconcile it while
                // retaining the original error and file ID for an explicit retry.
                refresh(preserveError = true)

                throw error
            }

            mutable.update {
                it.copy(
                    pendingUploads =
                        it.pendingUploads.filterNot { pending -> pending.id == file.id }
                )
            }

            refresh()
        }
    }

    fun reindex(id: String, textEncoding: String? = null, completed: () -> Unit = {}) {
        mutate("Reindexing document…") {
            repository.reindex(id, textEncoding)

            refresh()
            completed()
        }
    }

    fun clearError() {
        mutable.update { it.copy(error = null) }
    }

    fun delete(id: String, completed: () -> Unit) {
        mutate("Deleting document…") {
            repository.delete(id)

            refresh()
            completed()
        }
    }

    fun save(download: Download, uri: Uri) {
        mutate("Saving ${download.name}…", refreshOnFailure = false) {
            repository.save(download, uri.toString())
        }
    }

    fun documentDownload(document: KnowledgeDocument): Download =
        repository.documentDownload(document)

    private fun mutate(label: String, refreshOnFailure: Boolean = true, block: suspend () -> Unit) {
        if (mutable.value.busy) {
            return
        }

        mutable.update { it.copy(busy = true, error = null, operation = label) }

        viewModelScope.launch { action(refreshOnFailure, block) }
    }

    private suspend fun action(refreshOnFailure: Boolean = true, block: suspend () -> Unit) {
        try {
            block()
        } catch (error: Exception) {
            if (error is CancellationException) {
                throw error
            }

            mutable.update { it.copy(error = error.message ?: "Document operation failed.") }

            if (refreshOnFailure) {
                refresh(preserveError = true)
            }
        } finally {
            mutable.update { it.copy(busy = false, operation = null) }
        }
    }

    override fun onCleared() {
        repository.close()
    }

    @AssistedFactory
    interface Factory {
        fun create(serverUrl: String): KnowledgeViewModel
    }
}

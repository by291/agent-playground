package com.agentplayground.app.features.knowledge

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.agentplayground.app.files.*
import com.agentplayground.core.*
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class KnowledgeViewModel(val api: PlaygroundApi, private val files: DocumentAccess) : ViewModel() {
    private val mutable = MutableStateFlow(KnowledgeUiState())
    val state = mutable.asStateFlow()
    private var polling: Job? = null
    private val refreshMutex = Mutex()

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
            val documents = api.documents()
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
                val picked = uris.map { uri ->
                    val file = files.inspect(uri)
                    validateKnowledgeFile(file.name, file.size)
                    val size =
                        if (file.size == null) {
                            val data = files.read(file)
                            validateKnowledgeFile(file.name, data.size.toLong())
                            data.size.toLong()
                        } else {
                            file.size
                        }
                    if (resumed != null) {
                        require(file.name == resumed.name && size == resumed.size) {
                            "Choose the original ${resumed.name} (${resumed.size} bytes) to resume this upload."
                        }
                        file.copy(id = resumed.id)
                    } else {
                        file
                    }
                }
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
            val data = files.read(file)
            validateKnowledgeFile(file.name, data.size.toLong())

            try {
                api.uploadDocument(file.id, file.name, data)
            } catch (error: Exception) {
                if (error is CancellationException) {
                    throw error
                }
                mutable.update { it.copy(error = error.message ?: "Document upload failed.") }
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
        mutate("Saving ${download.name}…", refreshOnFailure = false) {
            files.save(api, download, uri)
        }
    }

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
    val resumeDocument: KnowledgeDocument? = null,
)

private fun validateKnowledgeFile(name: String, size: Long?) {
    validateFile(name, size ?: 0)
    require(name.substringAfterLast('.', "").lowercase() in setOf("txt", "md", "pdf")) {
        "Use a nonempty TXT, Markdown or PDF file up to 10 MiB."
    }
    require(size == null || size > 0) {
        "Use a nonempty TXT, Markdown or PDF file up to 10 MiB."
    }
}

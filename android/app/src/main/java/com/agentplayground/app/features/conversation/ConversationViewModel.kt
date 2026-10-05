package com.agentplayground.app.features.conversation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.agentplayground.app.data.PreferenceStore
import com.agentplayground.app.files.*
import com.agentplayground.core.*
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

class ConversationViewModel(
    val api: PlaygroundApi,
    private val journal: PreferenceStore.ConversationJournal,
    private val files: DocumentAccess,
) : ViewModel() {
    private var session: ConversationSession? = null
    private var sessionCollector: Job? = null
    private var selectionJob: Job? = null
    private var draftSaveJob: Job? = null
    private var visible = false
    private var historyJob: Job? = null
    private val mutable = MutableStateFlow(ConversationUiState())
    val state = mutable.asStateFlow()

    init {
        selectionJob = viewModelScope.launch {
            try {
                selectSaved(journal.read() ?: SavedConversation(UUID.randomUUID().toString()))
            } catch (error: Exception) {
                if (error is CancellationException) {
                    throw error
                }
                mutable.update {
                    it.copy(error = "Local conversation could not be restored: ${error.message}")
                }
                selectSaved(SavedConversation(UUID.randomUUID().toString()))
            }
        }
        refreshHistory()
        viewModelScope.launch {
            runCatching { api.info() }
                .getOrNull()
                ?.let { info -> mutable.update { it.copy(model = info.model) } }
        }
    }

    fun setVisible(value: Boolean) {
        visible = value
        if (value) {
            session?.observe()
            refreshHistory()
        } else {
            session?.stopObserving()
            viewModelScope.launch { action { session?.saveDraft() } }
        }
    }

    fun select(threadId: String?) {
        selectionJob?.cancel()
        selectionJob = viewModelScope.launch {
            try {
                session?.saveDraft()
                val saved =
                    if (threadId == null) {
                        SavedConversation(UUID.randomUUID().toString())
                    } else {
                        journal.find(threadId) ?: SavedConversation(threadId, empty = false)
                    }
                selectSaved(saved)
            } catch (error: Exception) {
                if (error is CancellationException) {
                    throw error
                }
                mutable.update { it.copy(error = error.message) }
            }
        }
    }

    private suspend fun selectSaved(saved: SavedConversation) {
        session?.close()
        sessionCollector?.cancel()
        draftSaveJob?.cancel()
        journal.write(saved)
        journal.select(saved.threadId)
        val next = ConversationSession(api, journal, viewModelScope, saved)
        session = next
        mutable.update {
            it.copy(session = next.state.value, attachments = emptyList(), error = null)
        }
        sessionCollector = viewModelScope.launch {
            next.state.collect { nextState -> mutable.update { it.copy(session = nextState) } }
        }
        if (!visible) {
            next.stopObserving()
        }
        next.restore()
        if (visible) {
            next.observe()
        }
    }

    fun editDraft(text: String) {
        session?.editDraft(text)
        draftSaveJob?.cancel()
        val current = session
        draftSaveJob = viewModelScope.launch {
            delay(300)
            try {
                current?.saveDraft()
            } catch (error: Exception) {
                if (error is CancellationException) {
                    throw error
                }
                mutable.update { it.copy(error = "Draft could not be saved: ${error.message}") }
            }
        }
    }

    fun attach(uris: List<android.net.Uri>) {
        if (mutable.value.uploading || mutable.value.session?.canSend != true) {
            return
        }
        viewModelScope.launch {
            action {
                val added = uris.map { files.inspect(it) }
                require(mutable.value.attachments.size + added.size <= 4) {
                    "Attach up to four files."
                }
                mutable.update { it.copy(attachments = it.attachments + added) }
            }
        }
    }

    fun removeAttachment(id: String) {
        mutable.update { it.copy(attachments = it.attachments.filterNot { file -> file.id == id }) }
    }

    fun send() {
        val current = session ?: return
        val state = mutable.value
        if (
            !current.state.value.canSend || state.uploading || current.state.value.draft.isBlank()
        ) {
            return
        }
        mutable.update { it.copy(uploading = true, error = null) }
        draftSaveJob?.cancel()
        viewModelScope.launch {
            try {
                val text = current.state.value.draft
                val uploaded =
                    state.attachments.map { file ->
                        api.uploadFile(current.threadId, file.id, file.name, files.read(file))
                    }
                val content =
                    if (uploaded.isEmpty()) {
                        text
                    } else {
                        val references =
                            uploaded.joinToString("\n") {
                                "${protocolJson.encodeToString(kotlinx.serialization.serializer<String>(), it.name)} — File ID: ${it.id}"
                            }
                        "$text\n\nUploaded files:\n$references"
                    }
                current.send(content)
                if (session === current && current.state.value.draft.isEmpty()) {
                    mutable.update { it.copy(attachments = emptyList()) }
                }
                refreshHistory()
            } catch (error: Exception) {
                if (error is CancellationException) {
                    throw error
                }
                mutable.update {
                    it.copy(error = error.message ?: "File upload failed. Please retry.")
                }
            } finally {
                mutable.update { it.copy(uploading = false) }
            }
        }
    }

    fun editPlan(id: String, draft: PlanDraft) {
        session?.editPlan(id, draft)
    }

    fun review(id: String, decision: String, plan: PlanDraft?) {
        viewModelScope.launch { action { session?.review(id, decision, plan) } }
    }

    fun recover() {
        viewModelScope.launch { action { session?.recoverPending() } }
    }

    fun refreshHistory() {
        if (historyJob?.isActive == true) {
            return
        }
        historyJob = viewModelScope.launch {
            mutable.update { it.copy(historyLoading = true) }
            try {
                // Re-fetch every loaded page to preserve the head/tail boundary after updates.
                val pages = mutableListOf<ConversationSummary>()
                var cursor: String? = null
                val desired = mutable.value.history.size.coerceAtLeast(30)
                do {
                    val page = api.conversations(cursor)
                    pages += page.conversations
                    cursor = page.nextCursor
                } while (cursor != null && pages.size < desired)
                mutable.update {
                    it.copy(
                        history = pages.distinctBy { row -> row.threadId },
                        nextCursor = cursor,
                        historyError = null,
                    )
                }
            } catch (error: Exception) {
                if (error is CancellationException) {
                    throw error
                }
                mutable.update { it.copy(historyError = error.message) }
            } finally {
                mutable.update { it.copy(historyLoading = false) }
            }
        }
    }

    fun loadMore() {
        val cursor = mutable.value.nextCursor ?: return
        if (historyJob?.isActive == true) {
            return
        }
        historyJob = viewModelScope.launch {
            mutable.update { it.copy(historyLoading = true) }
            try {
                val page = api.conversations(cursor)
                mutable.update {
                    it.copy(
                        history =
                            (it.history + page.conversations).distinctBy { row -> row.threadId },
                        nextCursor = page.nextCursor,
                        historyError = null,
                    )
                }
            } catch (error: Exception) {
                if (error is CancellationException) {
                    throw error
                }
                mutable.update { it.copy(historyError = error.message) }
            } finally {
                mutable.update { it.copy(historyLoading = false) }
            }
        }
    }

    fun rename(thread: String, title: String, completed: () -> Unit) {
        viewModelScope.launch {
            action {
                api.rename(thread, title)
                val current = session
                if (current?.threadId == thread) {
                    current.refresh()
                }
                refreshHistory()
                completed()
            }
        }
    }

    fun delete(thread: String, completed: () -> Unit) {
        viewModelScope.launch {
            action {
                api.deleteConversation(thread)
                val selected = session?.threadId == thread
                if (selected) {
                    forgetSession()
                }
                journal.remove(thread)
                if (selected) {
                    select(null)
                }
                refreshHistory()
                completed()
            }
        }
    }

    fun clear(completed: () -> Unit) {
        viewModelScope.launch {
            action {
                api.clearConversations()
                forgetSession()
                journal.clear()
                select(null)
                refreshHistory()
                completed()
            }
        }
    }

    private fun forgetSession() {
        draftSaveJob?.cancel()
        sessionCollector?.cancel()
        session?.close()
        session = null
    }

    fun save(download: Download, uri: android.net.Uri) {
        viewModelScope.launch { action { files.save(api, download, uri) } }
    }

    private suspend fun action(block: suspend () -> Unit) {
        mutable.update { it.copy(error = null) }
        try {
            block()
        } catch (error: Exception) {
            if (error is CancellationException) {
                throw error
            }
            mutable.update { it.copy(error = error.message ?: "Request failed.") }
        }
    }

    override fun onCleared() {
        session?.close()
        api.close()
    }
}

data class ConversationUiState(
    val session: SessionState? = null,
    val history: List<ConversationSummary> = emptyList(),
    val nextCursor: String? = null,
    val historyLoading: Boolean = false,
    val historyError: String? = null,
    val model: String? = null,
    val attachments: List<PickedFile> = emptyList(),
    val uploading: Boolean = false,
    val error: String? = null,
)

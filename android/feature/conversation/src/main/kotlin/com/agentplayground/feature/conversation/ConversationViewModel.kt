package com.agentplayground.feature.conversation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.agentplayground.domain.conversation.ConversationHistoryLoader
import com.agentplayground.domain.conversation.ConversationSession
import com.agentplayground.domain.conversation.InteractionDraft
import com.agentplayground.domain.conversation.PlanDraft
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.MessageAttachment
import com.agentplayground.domain.model.SavedConversation
import com.agentplayground.domain.model.SkillFile
import com.agentplayground.domain.presentation.UploadedAttachment
import com.agentplayground.domain.presentation.messageWithAttachments
import com.agentplayground.domain.repository.ConversationRepository
import com.agentplayground.domain.repository.RepositoryProvider
import com.agui.core.types.Interrupt
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

/** Owns the selected session, local file selection and background jobs for one server. */
@HiltViewModel(assistedFactory = ConversationViewModel.Factory::class)
class ConversationViewModel(private val repository: ConversationRepository) : ViewModel() {
    private var session: ConversationSession? = null
    private var visible = false

    private var sessionCollector: Job? = null
    private var selectionJob: Job? = null
    private var draftSaveJob: Job? = null
    private var metadataJob: Job? = null
    private var modelSelectionJob: Job? = null

    private val mutable = MutableStateFlow(ConversationUiState())
    val state = mutable.asStateFlow()

    private val history = ConversationHistoryLoader(viewModelScope, repository::conversations)

    init {
        viewModelScope.launch {
            history.state.collect { snapshot ->
                mutable.update {
                    it.copy(
                        history = snapshot.conversations,
                        nextCursor = snapshot.nextCursor,
                        historyLoading = snapshot.loading,
                        historyError = snapshot.error,
                    )
                }
            }
        }

        selectionJob = viewModelScope.launch {
            try {
                selectSaved(
                    repository.selectedConversation()
                        ?: SavedConversation(UUID.randomUUID().toString())
                )
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
        refreshMetadata()
    }

    @AssistedInject
    constructor(
        repositories: RepositoryProvider,
        @Assisted serverUrl: String,
    ) : this(repositories.conversation(serverUrl))

    fun setVisible(value: Boolean) {
        visible = value

        if (value) {
            session?.observe()
            refreshHistory()
            refreshMetadata()
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
                        repository.savedConversation(threadId)
                            ?: SavedConversation(threadId, empty = false)
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
        modelSelectionJob?.cancel()
        session?.close()
        sessionCollector?.cancel()
        draftSaveJob?.cancel()

        repository.select(saved)

        val next = repository.createSession(viewModelScope, saved)
        session = next
        next.setDefaultModel(mutable.value.agentInfo?.defaultModelId)

        mutable.update {
            it.copy(session = next.state.value, attachments = emptyList(), error = null)
        }

        sessionCollector = viewModelScope.launch {
            next.state.collect { nextState ->
                val previous = mutable.value.session
                mutable.update { it.copy(session = nextState) }

                if (
                    !nextState.loading &&
                        (previous?.title != nextState.title || previous.runs != nextState.runs)
                ) {
                    refreshHistory()
                }
            }
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
        updateDraft(text, external = true)
    }

    fun editInput(text: String) {
        updateDraft(text, external = false)
    }

    private fun updateDraft(text: String, external: Boolean) {
        session?.editDraft(text)

        // Only external replacements reset the text field; ordinary edits retain IME composition.
        mutable.update {
            it.copy(
                session = session?.state?.value ?: it.session,
                draftRevision = it.draftRevision + if (external) 1 else 0,
            )
        }

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
                val added = repository.inspectAttachments(uris.map { it.toString() })

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

                // Selected files retain their IDs after failure, so retries reuse server resources.
                val uploaded = repository.uploadAttachments(current.threadId, state.attachments)

                current.send(messageWithAttachments(text, uploaded))

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

    fun editInteraction(expected: Interrupt, draft: InteractionDraft) {
        session?.editInteraction(expected, draft)
    }

    fun respondToInteraction(expected: Interrupt) {
        viewModelScope.launch { action { session?.respondToInteraction(expected) } }
    }

    fun review(
        id: String,
        decision: String,
        plan: PlanDraft?,
        planInterruptIds: Set<String>? = null,
    ) {
        viewModelScope.launch { action { session?.review(id, decision, plan, planInterruptIds) } }
    }

    fun submitPlanReviews(planInterruptIds: Set<String>? = null) {
        viewModelScope.launch { action { session?.submitPlanReviews(planInterruptIds) } }
    }

    fun submitExternalTaskInput(taskId: String, input: String) {
        session?.submitExternalTaskInput(taskId, input)
    }

    fun cancelExternalTask(taskId: String) {
        session?.cancelExternalTask(taskId)
    }

    fun selectModel(modelId: String) {
        val current = session ?: return
        val state = mutable.value

        if (
            !state.canSelectModel ||
                state.agentInfo?.models?.any { it.id == modelId && it.available } != true
        ) {
            return
        }

        modelSelectionJob = viewModelScope.launch { current.selectModel(modelId) }
    }

    fun clearActivity() {
        session?.clearActivity()
    }

    fun clearError() {
        mutable.update { it.copy(error = null) }
    }

    private fun refreshMetadata() {
        if (metadataJob?.isActive == true) {
            return
        }

        metadataJob = viewModelScope.launch {
            try {
                val info = repository.agentInfo()

                session?.setDefaultModel(info.defaultModelId)
                mutable.update { it.copy(model = info.model, agentInfo = info) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // A transient metadata failure does not prevent conversation recovery.
            }
        }
    }

    fun recover() {
        viewModelScope.launch { action { session?.recoverPending() } }
    }

    fun refreshHistory() {
        history.refresh()
    }

    fun loadMore() {
        history.loadMore()
    }

    fun rename(thread: String, title: String, completed: () -> Unit) {
        mutateHistory(HistoryMutation("rename", thread)) {
            repository.rename(thread, title)

            val current = session

            if (current?.threadId == thread) {
                current.refresh()
            }

            refreshHistory()
            completed()
        }
    }

    fun delete(thread: String, completed: () -> Unit) {
        if (mutable.value.deletionBlocked(thread)) {
            return
        }

        mutateHistory(HistoryMutation("delete", thread)) {
            repository.deleteConversation(thread)

            val selected = session?.threadId == thread

            if (selected) {
                forgetSession()
            }

            repository.removeSavedConversation(thread)

            if (selected) {
                select(null)
            }

            refreshHistory()
            completed()
        }
    }

    fun clear(completed: () -> Unit) {
        if (mutable.value.clearBlocked) {
            return
        }

        mutateHistory(HistoryMutation("clear", null)) {
            repository.clearConversations()

            forgetSession()
            repository.clearSavedConversations()

            select(null)
            refreshHistory()
            completed()
        }
    }

    private fun mutateHistory(operation: HistoryMutation, block: suspend () -> Unit) {
        if (mutable.value.historyMutation != null) {
            return
        }

        mutable.update { it.copy(historyMutation = operation, error = null) }

        viewModelScope.launch {
            try {
                action(block)
            } finally {
                mutable.update { it.copy(historyMutation = null) }
            }
        }
    }

    private fun forgetSession() {
        modelSelectionJob?.cancel()
        draftSaveJob?.cancel()
        sessionCollector?.cancel()
        session?.close()
        session = null
    }

    fun save(download: Download, uri: android.net.Uri) {
        viewModelScope.launch { action { repository.save(download, uri.toString()) } }
    }

    fun fileDownload(file: SkillFile): Download = repository.fileDownload(file)

    fun attachmentPresentation(
        threadId: String,
        attachment: UploadedAttachment,
    ): MessageAttachment = repository.attachmentPresentation(threadId, attachment)

    suspend fun attachmentBytes(source: String): ByteArray = repository.attachmentBytes(source)

    fun documentDownload(id: String, name: String): Download = repository.documentDownload(id, name)

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
        history.close()
        session?.close()
        repository.close()
    }

    @AssistedFactory
    interface Factory {
        fun create(serverUrl: String): ConversationViewModel
    }
}

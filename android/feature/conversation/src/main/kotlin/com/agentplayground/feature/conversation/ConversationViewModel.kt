package com.agentplayground.feature.conversation

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.agentplayground.core.conversation.ConversationSession
import com.agentplayground.core.conversation.PlanDraft
import com.agentplayground.core.conversation.SessionState
import com.agentplayground.core.model.AgentInfo
import com.agentplayground.core.model.AgentModel
import com.agentplayground.core.model.ConversationSummary
import com.agentplayground.core.model.Download
import com.agentplayground.core.model.MessageAttachment
import com.agentplayground.core.model.SavedConversation
import com.agentplayground.core.model.SkillFile
import com.agentplayground.core.model.isActiveRun
import com.agentplayground.core.model.protocolJson
import com.agentplayground.core.presentation.UploadedAttachment
import com.agentplayground.data.conversation.ConversationHistoryRepository
import com.agentplayground.data.conversation.ConversationRepository
import com.agentplayground.data.files.PickedFile
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

class ConversationViewModel(private val repository: ConversationRepository) : ViewModel() {
    private var session: ConversationSession? = null
    private var sessionCollector: Job? = null
    private var selectionJob: Job? = null
    private var draftSaveJob: Job? = null
    private var visible = false
    private var metadataJob: Job? = null
    private var modelSelectionJob: Job? = null
    private val mutable = MutableStateFlow(ConversationUiState())
    val state = mutable.asStateFlow()

    private val history = ConversationHistoryRepository(viewModelScope, repository::conversations)

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
                val added = repository.inspectAttachments(uris)

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

                current.send(attachmentMessage(text, uploaded))

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
        viewModelScope.launch { action { repository.save(download, uri) } }
    }

    fun fileDownload(file: SkillFile): Download = repository.fileDownload(file)

    fun attachmentPresentation(
        threadId: String,
        attachment: UploadedAttachment,
    ): MessageAttachment = repository.attachmentPresentation(threadId, attachment)

    suspend fun loadAttachmentImage(source: String, maxDimension: Int): ImageBitmap? =
        repository.loadAttachmentImage(source, maxDimension)?.asImageBitmap()

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
}

private fun attachmentMessage(text: String, files: List<SkillFile>): String {
    if (files.isEmpty()) {
        return text
    }

    val references =
        files.joinToString("\n") {
            "${protocolJson.encodeToString(kotlinx.serialization.serializer<String>(), it.name)} — File ID: ${it.id}"
        }

    return "$text\n\nUploaded files:\n$references"
}

data class ConversationUiState(
    val draftRevision: Long = 0,
    val session: SessionState? = null,
    val history: List<ConversationSummary> = emptyList(),
    val nextCursor: String? = null,
    val historyLoading: Boolean = false,
    val historyError: String? = null,
    val model: String? = null,
    val agentInfo: AgentInfo? = null,
    val attachments: List<PickedFile> = emptyList(),
    val uploading: Boolean = false,
    val error: String? = null,
    val historyMutation: HistoryMutation? = null,
) {
    val selectedModel: AgentModel?
        get() = agentInfo?.models?.find { it.id == (session?.modelId ?: agentInfo.defaultModelId) }

    val currentModel: String?
        get() =
            selectedModel?.model
                ?: if (session?.modelId == null) agentInfo?.model ?: model else session.modelId

    val modelLabel: String?
        get() = selectedModel?.label ?: currentModel

    val canSelectModel: Boolean
        get() = session?.canSelectModel == true && !uploading

    fun deletionBlocked(threadId: String): Boolean =
        history.any { it.threadId == threadId && isActiveRun(it.status) } ||
            (session?.threadId == threadId && (session.busy || session.loading || uploading))

    val clearBlocked: Boolean
        get() =
            uploading ||
                session?.busy == true ||
                session?.loading == true ||
                history.any { isActiveRun(it.status) } ||
                historyMutation != null
}

data class HistoryMutation(val kind: String, val threadId: String?)

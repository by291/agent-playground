package com.agentplayground.feature.conversation

import com.agentplayground.domain.conversation.SessionState
import com.agentplayground.domain.files.PickedFile
import com.agentplayground.domain.model.AgentInfo
import com.agentplayground.domain.model.AgentModel
import com.agentplayground.domain.model.ConversationSummary
import com.agentplayground.domain.model.isActiveRun

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

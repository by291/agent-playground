package com.agentplayground.domain.model

import com.agui.core.types.Interrupt
import com.agui.core.types.Message
import com.agui.core.types.RunAgentInput
import kotlinx.serialization.Serializable

@Serializable
data class ConversationSummary(
    val threadId: String,
    val title: String,
    val createdAt: String,
    val updatedAt: String,
    val status: String? = null,
)

@Serializable
data class ConversationPage(
    val conversations: List<ConversationSummary>,
    val nextCursor: String? = null,
)

@Serializable data class RenamedConversation(val threadId: String, val title: String)

@Serializable
data class RunRecord(
    val runId: String,
    val messageId: String? = null,
    val status: String,
    val modelId: String? = null,
)

@Serializable
data class ConversationSnapshot(
    val title: String? = null,
    val messages: List<Message>,
    val interrupts: List<Interrupt>,
    val outputs: List<WorkflowOutput>,
    val runs: List<RunRecord>,
    val contextUsage: ContextUsage? = null,
    val externalTasks: List<ExternalTask> = emptyList(),
    val modelId: String? = null,
    val messageTimestamps: Map<String, String> = emptyMap(),
)

@Serializable
data class ContextUsage(
    val model: String,
    val usedTokens: Int,
    val contextWindow: Int,
    val triggerTokens: Int,
    val breakdown: Map<String, Int>,
    val lastInputTokens: Int? = null,
    val compactions: Int,
    val lastCompaction: Map<String, Int>? = null,
    val revision: Int,
)

@Serializable
data class AgentInfo(
    val model: String,
    val defaultModelId: String? = null,
    val models: List<AgentModel> = emptyList(),
)

@Serializable
data class AgentModel(val id: String, val label: String, val model: String, val available: Boolean)

@Serializable data class ConversationModel(val threadId: String, val modelId: String)

/** Persisted before dispatch; retries reuse this input's run and message identities. */
@Serializable
data class PendingSubmission(
    val input: RunAgentInput,
    val messageId: String,
    val submittedAt: String? = null,
)

/** Local recovery metadata and draft; the server remains the owner of the conversation history. */
@Serializable
data class SavedConversation(
    val threadId: String,
    val draft: String = "",
    val pending: PendingSubmission? = null,
    val empty: Boolean = true,
    val modelId: String? = null,
    val modelSelectionLocal: Boolean = false,
)

interface ConversationPersistence {
    suspend fun read(): SavedConversation?

    suspend fun write(value: SavedConversation?)
}

fun isActiveRun(status: String?) =
    status in setOf("prepared", "dispatching", "running", "submission_unknown")

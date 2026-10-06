package com.agentplayground.core

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
data class RunRecord(val runId: String, val messageId: String? = null, val status: String)

@Serializable
data class ConversationSnapshot(
    val title: String? = null,
    val messages: List<Message>,
    val interrupts: List<Interrupt>,
    val outputs: List<WorkflowOutput>,
    val runs: List<RunRecord>,
    val contextUsage: ContextUsage? = null,
    val externalTasks: List<ExternalTask> = emptyList(),
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

@Serializable data class AgentInfo(val model: String)

@Serializable data class PendingSubmission(val input: RunAgentInput, val messageId: String)

@Serializable
data class SavedConversation(
    val threadId: String,
    val draft: String = "",
    val pending: PendingSubmission? = null,
    val empty: Boolean = true,
)

interface ConversationPersistence {
    suspend fun read(): SavedConversation?

    suspend fun write(value: SavedConversation?)
}

fun isActiveRun(status: String?) =
    status in setOf("prepared", "dispatching", "running", "submission_unknown")

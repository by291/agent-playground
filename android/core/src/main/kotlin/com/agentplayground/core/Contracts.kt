package com.agentplayground.core

import com.agui.core.types.Interrupt
import com.agui.core.types.Message
import com.agui.core.types.RunAgentInput
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

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

@Serializable
data class ExternalTask(
    val taskId: String,
    val workflowCallId: String,
    val label: String,
    val revision: Int,
    val status: String,
    val stage: String,
    val message: String,
    val progress: Double? = null,
    val error: String? = null,
    val history: List<JsonObject>,
    val continuationStatus: String? = null,
)

@Serializable
data class WorkflowOutput(
    val id: String,
    val outputSeq: Int,
    val messages: JsonElement,
    val toolCallId: String? = null,
    val workflow: WorkflowMetadata? = null,
)

@Serializable
data class WorkflowMetadata(
    val reply: WorkflowReply? = null,
    val presentation: WorkflowPresentation? = null,
)

@Serializable data class WorkflowReply(val id: String, val content: String)

@Serializable
data class WorkflowPresentation(
    val surfaceId: String,
    val groupId: String,
    val anchorMessageId: String? = null,
)

@Serializable
data class SkillFile(val id: String, val threadId: String, val name: String, val size: Long)

@Serializable
data class KnowledgeDocument(
    val id: String,
    val name: String,
    val size: Long,
    val status: String,
    val error: String? = null,
    val chunkCount: Int,
    val createdAt: String,
    val updatedAt: String,
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

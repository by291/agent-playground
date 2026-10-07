package com.agentplayground.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

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
    val kind: String? = null,
    val outputs: List<AgentOutput> = emptyList(),
)

@Serializable
data class AgentOutput(
    val agent: String,
    val step: String,
    val taskId: String,
    val contextId: String,
    val status: String,
    val text: String,
)

enum class ExternalTaskAction {
    Input,
    Cancel,
}

data class ExternalTaskControl(
    val pending: ExternalTaskAction? = null,
    val error: String? = null,
)

fun isExternalTaskActive(status: String) = status in setOf("queued", "running", "input_required")

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

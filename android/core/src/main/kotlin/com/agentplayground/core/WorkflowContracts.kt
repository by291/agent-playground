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

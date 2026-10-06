package com.agentplayground.core

import com.agui.core.types.*
import kotlinx.serialization.json.*

fun newSubmission(
    threadId: String,
    runId: String,
    message: UserMessage? = null,
    resume: List<ResumeEntry>? = null,
): RunAgentInput =
    RunAgentInput(
        threadId = threadId,
        runId = runId,
        messages =
            if (resume.isNullOrEmpty() && message != null) {
                listOf(message)
            } else {
                emptyList()
            },
        resume = resume,
    )

internal fun pendingMessage(pending: PendingSubmission?): UserMessage? {
    val normal = pending?.input?.messages?.filterIsInstance<UserMessage>()?.lastOrNull()

    if (normal != null) {
        return normal
    }

    val feedback =
        pending
            ?.input
            ?.resume
            ?.mapNotNull { it.payload as? JsonObject }
            ?.find { it.string("action") == "message" } ?: return null
    val id = feedback.string("messageId") ?: return null
    val content = feedback.string("message") ?: return null

    return UserMessage(id, content)
}

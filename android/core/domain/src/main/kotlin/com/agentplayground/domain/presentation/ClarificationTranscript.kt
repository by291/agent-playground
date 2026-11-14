package com.agentplayground.domain.presentation

import com.agentplayground.domain.conversation.InteractionQuestion
import com.agentplayground.domain.conversation.parseInteractionQuestions
import com.agentplayground.domain.model.isReasoning
import com.agui.core.types.AssistantMessage
import com.agui.core.types.ToolMessage
import kotlinx.serialization.json.*

enum class ClarificationStatus {
    Pending,
    Answered,
    Declined,
    Failed,
    Unavailable,
}

data class ClarificationAnswer(val question: InteractionQuestion, val answer: String)

sealed interface AssistantTranscriptPart {
    data class Reply(val message: AssistantMessage) : AssistantTranscriptPart

    data class Question(
        val callId: String,
        val questions: List<InteractionQuestion>,
        val status: ClarificationStatus,
    ) : AssistantTranscriptPart

    data class Answer(
        val callId: String,
        val resultId: String,
        val answers: List<ClarificationAnswer>,
    ) : AssistantTranscriptPart
}

/**
 * Restores clarification exchanges from canonical tool history without inventing persisted users.
 * Questions follow their assistant call, while human answers appear only at a unique committed
 * result. Reused call identities or malformed payloads cannot become attributed human speech.
 */
fun assistantTranscript(turn: ConversationTurn): List<AssistantTranscriptPart> {
    val asks = turn.toolCalls.filter { it.call.function.name == "ask_user" }.groupBy { it.call.id }
    val results = turn.messages.filterIsInstance<ToolMessage>().groupBy { it.toolCallId }
    val questionsSeen = mutableSetOf<String>()
    val answersSeen = mutableSetOf<String>()
    val parts = mutableListOf<AssistantTranscriptPart>()

    for (message in turn.messages) {
        when (message) {
            is AssistantMessage -> {
                if (!isReasoning(message) && !message.content.isNullOrBlank()) {
                    parts.add(AssistantTranscriptPart.Reply(message))
                }

                for (call in message.toolCalls.orEmpty()) {
                    if (call.function.name != "ask_user" || !questionsSeen.add(call.id)) {
                        continue
                    }

                    val step = asks[call.id]?.singleOrNull()
                    val questions =
                        step?.let { parseArguments(it.call.function.arguments) }.orEmpty()
                    val result = results[call.id]?.singleOrNull()?.takeIf { it == step?.result }
                    val status = clarificationStatus(step, questions, result)

                    parts.add(AssistantTranscriptPart.Question(call.id, questions, status))
                }
            }

            is ToolMessage -> {
                val step = asks[message.toolCallId]?.singleOrNull() ?: continue
                val result = results[message.toolCallId]?.singleOrNull() ?: continue
                val questions = parseArguments(step.call.function.arguments) ?: continue

                if (
                    result != message ||
                        result != step.result ||
                        step.status != ToolStatus.Completed ||
                        !result.error.isNullOrEmpty() ||
                        !questionsSeen.contains(message.toolCallId) ||
                        !answersSeen.add(message.toolCallId)
                ) {
                    continue
                }

                val answers = parseAnswers(result.content, questions) ?: continue
                parts.add(AssistantTranscriptPart.Answer(message.toolCallId, message.id, answers))
            }

            else -> Unit
        }
    }

    return parts
}

private fun clarificationStatus(
    step: ToolStep?,
    questions: List<InteractionQuestion>,
    result: ToolMessage?,
): ClarificationStatus {
    if (step == null) {
        return ClarificationStatus.Unavailable
    }

    if (result != null && !result.error.isNullOrEmpty()) {
        val rejectedWithReason =
            result.content.startsWith("User rejected the tool call for `ask_user` with reason: ")
        val rejectedWithoutReason =
            result.content ==
                "User rejected the tool call for `ask_user` with id ${step.call.id}. The tool was not executed. Do not retry this tool call unless the user explicitly requests it."

        return if (rejectedWithReason || rejectedWithoutReason) {
            ClarificationStatus.Declined
        } else {
            ClarificationStatus.Failed
        }
    }

    if (result != null) {
        val committed =
            step.status == ToolStatus.Completed &&
                questions.isNotEmpty() &&
                parseAnswers(result.content, questions) != null

        return if (committed) ClarificationStatus.Answered else ClarificationStatus.Unavailable
    }

    return when (step.status) {
        ToolStatus.Failed -> ClarificationStatus.Failed
        ToolStatus.Running,
        ToolStatus.Paused,
        ToolStatus.Waiting -> ClarificationStatus.Pending
        else -> ClarificationStatus.Unavailable
    }
}

private fun parseArguments(arguments: String): List<InteractionQuestion>? {
    val fields =
        runCatching { Json.parseToJsonElement(arguments) as? JsonObject }.getOrNull() ?: return null

    return parseInteractionQuestions(fields)
}

private fun parseAnswers(
    content: String,
    questions: List<InteractionQuestion>,
): List<ClarificationAnswer>? {
    val fields =
        runCatching { Json.parseToJsonElement(content) as? JsonObject }.getOrNull() ?: return null
    val values = fields["answers"] as? JsonArray ?: return null

    if (fields.keys != setOf("answers") || values.size != questions.size) {
        return null
    }

    val answers = linkedMapOf<String, String>()

    for (value in values) {
        val answer = value as? JsonObject ?: return null
        val id = (answer["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val text =
            (answer["answer"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null

        if (
            answer.keys != setOf("id", "answer") ||
                text.isBlank() ||
                text.length > 4000 ||
                id in answers
        ) {
            return null
        }

        answers[id] = text
    }

    if (answers.keys.toList() != questions.map { it.id }) {
        return null
    }

    return questions.map { ClarificationAnswer(it, answers.getValue(it.id)) }
}

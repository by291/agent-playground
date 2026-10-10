package com.agentplayground.core.conversation

import com.agentplayground.core.model.ContextUsage
import com.agentplayground.core.model.WorkflowOutput
import com.agentplayground.core.model.isReasoning
import com.agentplayground.core.model.protocolJson
import com.agentplayground.core.model.reasoningMessage
import com.agui.core.types.*
import kotlinx.serialization.json.*

/** Projects official protocol events without changing admission or recovery ownership. */
internal fun reduceConversationEvent(
    current: SessionState,
    event: BaseEvent,
    receivedAt: String? = null,
): SessionState =
    when (event) {
        is RunStartedEvent ->
            current.copy(streaming = true, busy = true, executionStatus = "running")

        is ReasoningMessageStartEvent ->
            current.copy(messages = upsert(current.messages, reasoningMessage(event.messageId)))

        is ReasoningMessageContentEvent ->
            current.copy(
                messages =
                    current.messages.map {
                        if (isReasoning(it) && it.id == event.messageId) {
                            (it as AssistantMessage).copy(
                                content = it.content.orEmpty() + event.delta
                            )
                        } else {
                            it
                        }
                    }
            )

        is TextMessageStartEvent ->
            current.copy(
                messages = upsert(current.messages, AssistantMessage(event.messageId, "")),
                messageTimestamps =
                    if (receivedAt != null && event.messageId !in current.messageTimestamps) {
                        current.messageTimestamps + (event.messageId to receivedAt)
                    } else {
                        current.messageTimestamps
                    },
            )

        is TextMessageContentEvent ->
            current.copy(
                messages =
                    current.messages.map {
                        if (it is AssistantMessage && it.id == event.messageId) {
                            it.copy(content = it.content.orEmpty() + event.delta)
                        } else {
                            it
                        }
                    }
            )

        is MessagesSnapshotEvent -> current.copy(messages = event.messages)

        is ToolCallStartEvent -> {
            val owner = event.parentMessageId ?: "tool-${event.toolCallId}"
            val previous =
                current.messages.find { it.id == owner } as? AssistantMessage
                    ?: AssistantMessage(owner)
            val calls =
                previous.toolCalls.orEmpty().filterNot { it.id == event.toolCallId } +
                    ToolCall(event.toolCallId, FunctionCall(event.toolCallName, ""))

            current.copy(messages = upsert(current.messages, previous.copy(toolCalls = calls)))
        }

        is ToolCallArgsEvent ->
            current.copy(
                messages =
                    current.messages.map { message ->
                        if (message is AssistantMessage) {
                            message.copy(
                                toolCalls =
                                    message.toolCalls?.map { call ->
                                        if (call.id == event.toolCallId) {
                                            call.copy(
                                                function =
                                                    call.function.copy(
                                                        arguments =
                                                            call.function.arguments + event.delta
                                                    )
                                            )
                                        } else {
                                            call
                                        }
                                    }
                            )
                        } else {
                            message
                        }
                    }
            )

        is ToolCallResultEvent ->
            current.copy(
                messages =
                    upsert(
                        current.messages,
                        ToolMessage(event.messageId, event.content, event.toolCallId),
                    )
            )

        is StateSnapshotEvent -> {
            val snapshot = event.snapshot as? JsonObject
            val usage = snapshot?.get("context_usage")?.let(::decodeContextUsage)
            val errors =
                (snapshot?.get("toolErrors") as? JsonArray).orEmpty().mapNotNull {
                    runCatching { protocolJson.decodeFromJsonElement<Message>(it) }.getOrNull()
                }

            current.copy(
                contextUsage = latestContextUsage(current.contextUsage, usage),
                messages =
                    errors.fold(current.messages) { messages, error -> upsert(messages, error) },
            )
        }

        is RunFinishedEvent ->
            current.copy(
                streaming = false,
                executionStatus =
                    if (event.outcome is RunFinishedInterruptOutcome) {
                        "interrupted"
                    } else {
                        "completed"
                    },
                interrupts = (event.outcome as? RunFinishedInterruptOutcome)?.interrupts.orEmpty(),
            )

        is RunErrorEvent ->
            current.copy(streaming = false, executionStatus = "failed", error = event.message)

        is CustomEvent ->
            if (event.name == "context_usage") {
                current.copy(
                    contextUsage =
                        latestContextUsage(current.contextUsage, decodeContextUsage(event.value))
                )
            } else {
                current
            }

        else -> current
    }

// Decoding is pure; the session owns ordered delivery and records malformed output errors.
internal fun decodeWorkflowOutput(event: BaseEvent): WorkflowOutput? {
    if (event !is CustomEvent || event.name != "a2ui") {
        return null
    }

    return protocolJson.decodeFromJsonElement<WorkflowOutput>(event.value)
}

internal fun latestContextUsage(current: ContextUsage?, incoming: ContextUsage?): ContextUsage? =
    incoming?.takeIf { it.revision >= (current?.revision ?: 0) } ?: current

internal fun addOutputReplies(
    messages: List<Message>,
    outputs: List<WorkflowOutput>,
): List<Message> =
    outputs.fold(messages) { result, output ->
        val reply = output.workflow?.reply

        if (reply != null && result.none { it.id == reply.id }) {
            result + AssistantMessage(reply.id, reply.content)
        } else {
            result
        }
    }

private fun decodeContextUsage(value: JsonElement): ContextUsage? =
    runCatching { protocolJson.decodeFromJsonElement<ContextUsage>(value) }.getOrNull()

private fun upsert(messages: List<Message>, message: Message): List<Message> =
    if (messages.any { it.id == message.id }) {
        messages.map {
            if (it.id == message.id) {
                message
            } else {
                it
            }
        }
    } else {
        messages + message
    }

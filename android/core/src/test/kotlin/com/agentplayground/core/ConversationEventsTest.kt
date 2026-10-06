package com.agentplayground.core

import com.agui.core.types.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ConversationEventsTest {
    @Test
    fun `streamed tools preserve message owners and replace results by identity`() {
        val original =
            SessionState(
                "thread",
                messages =
                    listOf(
                        UserMessage("user", "Execute"),
                        AssistantMessage(
                            "owner",
                            "Working",
                            toolCalls =
                                listOf(ToolCall("other", FunctionCall("other_tool", "fixed"))),
                        ),
                    ),
            )
        val events =
            listOf(
                ToolCallStartEvent("call", "calculate", "owner"),
                ToolCallArgsEvent("call", "{\"value\":"),
                ToolCallArgsEvent("call", "2}"),
                ToolCallResultEvent("result", "call", "Old result"),
                ToolCallResultEvent("result", "call", "Current result"),
            )

        val reduced = events.fold(original, ::reduceConversationEvent)
        val owner = reduced.messages[1] as AssistantMessage
        val result = reduced.messages[2] as ToolMessage

        assertEquals(listOf("user", "owner", "result"), reduced.messages.map { it.id })
        assertEquals("Working", owner.content)
        assertEquals("fixed", owner.toolCalls!![0].function.arguments)
        assertEquals("{\"value\":2}", owner.toolCalls!![1].function.arguments)
        assertEquals("Current result", result.content)
        assertEquals("call", result.toolCallId)
        assertEquals(2, original.messages.size)
        assertEquals(1, (original.messages[1] as AssistantMessage).toolCalls!!.size)
    }

    @Test
    fun `state snapshots merge valid tool errors without regressing context usage`() {
        val original =
            SessionState(
                "thread",
                messages =
                    listOf(
                        AssistantMessage("answer", "Keep"),
                        ToolMessage("failure", "Old", "call"),
                    ),
                contextUsage = usage(3),
            )
        val event =
            StateSnapshotEvent(
                buildJsonObject {
                    put("context_usage", protocolJson.encodeToJsonElement(usage(2)))
                    put(
                        "toolErrors",
                        JsonArray(
                            listOf(
                                protocolJson.encodeToJsonElement<Message>(
                                    ToolMessage("failure", "Failed", "call")
                                ),
                                JsonPrimitive("malformed"),
                            )
                        ),
                    )
                }
            )

        val reduced = reduceConversationEvent(original, event)

        assertEquals(original.contextUsage, reduced.contextUsage)
        assertEquals(listOf("answer", "failure"), reduced.messages.map { it.id })
        assertEquals("Keep", reduced.messages[0].content)
        assertEquals("Failed", reduced.messages[1].content)
    }

    @Test
    fun `custom usage ignores malformed and older payloads but accepts equal revisions`() {
        val original = SessionState("thread", contextUsage = usage(3), busy = true)
        val older = CustomEvent("context_usage", protocolJson.encodeToJsonElement(usage(2)))
        val malformed = CustomEvent("context_usage", JsonPrimitive("invalid"))
        val equalRevision = usage(3).copy(usedTokens = 75)
        val newer = CustomEvent("context_usage", protocolJson.encodeToJsonElement(equalRevision))

        val reduced = reduceConversationEvent(original, newer)

        assertEquals(original, reduceConversationEvent(original, older))
        assertEquals(original, reduceConversationEvent(original, malformed))
        assertEquals(equalRevision, reduced.contextUsage)
        assertTrue(reduced.busy)
    }

    @Test
    fun `terminal events publish official outcomes while keeping settlement admission locked`() {
        val original =
            SessionState("thread", busy = true, streaming = true, executionStatus = "running")
        val interrupt = Interrupt("pause", "human_approval")
        val finished =
            RunFinishedEvent(
                "thread",
                "run",
                outcome = RunFinishedInterruptOutcome(listOf(interrupt)),
            )

        val interrupted = reduceConversationEvent(original, finished)
        val completed = reduceConversationEvent(interrupted, RunFinishedEvent("thread", "run"))
        val failed = reduceConversationEvent(original, RunErrorEvent("Failed"))

        assertEquals("interrupted", interrupted.executionStatus)
        assertEquals(listOf(interrupt), interrupted.interrupts)
        assertFalse(interrupted.streaming)
        assertTrue(interrupted.busy)
        assertEquals("completed", completed.executionStatus)
        assertTrue(completed.interrupts.isEmpty())
        assertTrue(completed.busy)
        assertEquals("failed", failed.executionStatus)
        assertEquals("Failed", failed.error)
        assertFalse(failed.streaming)
        assertTrue(failed.busy)
    }

    @Test
    fun `workflow custom decoding preserves admission metadata and rejects malformed payloads`() {
        val output = WorkflowOutput("second", 2, JsonArray(emptyList()))
        val event = CustomEvent("a2ui", protocolJson.encodeToJsonElement(output))
        val unrelated = CustomEvent("other", event.value)

        assertEquals(output, decodeWorkflowOutput(event))
        assertNull(decodeWorkflowOutput(unrelated))
        assertThrows(Exception::class.java) { decodeWorkflowOutput(CustomEvent("a2ui", JsonNull)) }
    }

    @Test
    fun `output replies append once without replacing existing streamed content`() {
        val messages = listOf<Message>(AssistantMessage("existing", "Streamed"))
        val outputs =
            listOf(
                WorkflowOutput(
                    "one",
                    1,
                    JsonArray(emptyList()),
                    workflow = WorkflowMetadata(WorkflowReply("existing", "Durable")),
                ),
                WorkflowOutput(
                    "two",
                    2,
                    JsonArray(emptyList()),
                    workflow = WorkflowMetadata(WorkflowReply("new", "New reply")),
                ),
            )

        val reduced = addOutputReplies(messages, outputs)

        assertEquals(listOf("existing", "new"), reduced.map { it.id })
        assertEquals("Streamed", reduced[0].content)
        assertEquals("New reply", reduced[1].content)
        assertEquals(reduced, addOutputReplies(reduced, outputs))
    }

    private fun usage(revision: Int) =
        ContextUsage(
            model = "model",
            usedTokens = 50,
            contextWindow = 100,
            triggerTokens = 80,
            breakdown = emptyMap(),
            compactions = 0,
            revision = revision,
        )
}

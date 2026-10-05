package com.agentplayground.core

import com.agui.core.types.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ProtocolTest {
    @Test
    fun `normal submission sends only newest user message and no model history`() {
        val input = newSubmission("thread", "run", UserMessage("user", "Hello"))
        val wire = protocolJson.encodeToJsonElement(RunAgentInput.serializer(), input).jsonObject
        assertEquals(
            listOf("user"),
            wire.getValue("messages").jsonArray.map {
                it.jsonObject.getValue("id").jsonPrimitive.content
            },
        )
        assertEquals(JsonObject(emptyMap()), wire.getValue("state"))
        assertFalse(wire.containsKey("resume"))
    }

    @Test
    fun `workflow feedback carries revision and round without replaying user history`() {
        val interrupt =
            Interrupt(
                "pause",
                "human_approval",
                metadata =
                    protocolJson.parseToJsonElement(
                        """{"langgraph":{"raw":{"kind":"workflow_review","workflowCallId":"sql","revision":3,"round":2,"outputStepId":"review:2","canAccept":false}}}"""
                    ),
            )
        val review = Review.from(interrupt)!!
        assertNull(review.respond("accept"))
        val entry = review.respond("message", "Explain", "user")!!
        val payload = entry.payload!!.jsonObject
        assertEquals(3, payload.getValue("revision").jsonPrimitive.int)
        assertEquals(2, payload.getValue("round").jsonPrimitive.int)
        assertEquals("user", payload.getValue("messageId").jsonPrimitive.content)
        assertEquals("pause", entry.interruptId)
        assertEquals(
            emptyList<Message>(),
            newSubmission("thread", "run", resume = listOf(entry)).messages,
        )
    }

    @Test
    fun `ordered output delivery waits for gaps and rejects conflicting replay`() {
        val buffer = OutputBuffer()
        val first = WorkflowOutput("one", 1, JsonArray(emptyList()))
        val second = WorkflowOutput("two", 2, JsonArray(emptyList()))
        assertTrue(buffer.ingest(listOf(second)).ready.isEmpty())
        assertEquals(1, buffer.missingSequence)
        assertEquals(listOf(first, second), buffer.ingest(listOf(first)).ready)
        assertTrue(buffer.ingest(listOf(first)).ready.isEmpty())
        assertNotNull(buffer.ingest(listOf(first.copy(id = "conflict"))).error)
    }

    @Test
    fun `late checkpoint cannot erase a submitted message or claim idle`() {
        val pending =
            PendingSubmission(newSubmission("thread", "run", UserMessage("user", "Hello")), "user")
        val snapshot =
            ConversationSnapshot(
                messages = emptyList(),
                interrupts = emptyList(),
                outputs = emptyList(),
                runs = emptyList(),
            )
        val result = reconcile(snapshot, pending, listOf(UserMessage("user", "Hello")))
        assertEquals("Hello", result.messages.single().content)
        assertFalse(result.confirmed)
        assertTrue(result.needsRecovery)
    }

    @Test
    fun `confirmed run prevents automatic resubmission even before checkpoint contains message`() {
        val pending =
            PendingSubmission(newSubmission("thread", "run", UserMessage("user", "Hello")), "user")
        val snapshot =
            ConversationSnapshot(
                messages = emptyList(),
                interrupts = emptyList(),
                outputs = emptyList(),
                runs = listOf(RunRecord("run", "user", "running")),
            )
        assertEquals(RecoveryDecision.Observe, recoveryDecision(snapshot, pending))
        assertEquals(RecoveryDecision.Retry, recoveryDecision(null, pending))
    }

    @Test
    fun `prepared admission must be dispatched with its original identity`() {
        val pending =
            PendingSubmission(newSubmission("thread", "run", UserMessage("user", "Hello")), "user")
        val snapshot =
            ConversationSnapshot(
                messages = emptyList(),
                interrupts = emptyList(),
                outputs = emptyList(),
                runs = listOf(RunRecord("run", "user", "prepared")),
            )
        assertEquals(RecoveryDecision.Retry, recoveryDecision(snapshot, pending))
    }

    @Test
    fun `unfinished checkpoint keeps newer local content with the same ID`() {
        val pending =
            PendingSubmission(newSubmission("thread", "run", UserMessage("user", "Hello")), "user")
        val snapshot =
            ConversationSnapshot(
                messages = listOf(AssistantMessage("reply", "Old")),
                interrupts = emptyList(),
                outputs = emptyList(),
                runs = listOf(RunRecord("run", "user", "running")),
            )
        assertEquals(
            "Old and new",
            reconcile(snapshot, pending, listOf(AssistantMessage("reply", "Old and new")))
                .messages
                .single()
                .content,
        )
    }

    @Test
    fun `Unicode names accepted while paths and excessive files rejected`() {
        validateFile("报告.pdf", 10 * 1024 * 1024L)
        listOf("../file", "a/b", "a\\b", "\u0000file", ".").forEach { name ->
            assertThrows(IllegalArgumentException::class.java) { validateFile(name, 1) }
        }
        assertThrows(IllegalArgumentException::class.java) {
            validateFile("large.pdf", 10 * 1024 * 1024L + 1)
        }
    }
}

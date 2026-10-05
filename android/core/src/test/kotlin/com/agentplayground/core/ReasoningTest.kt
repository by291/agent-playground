package com.agentplayground.core

import com.agui.core.types.*
import kotlinx.serialization.decodeFromString
import org.junit.Assert.*
import org.junit.Test

class ReasoningTest {
    @Test
    fun `snapshot preserves public reasoning with the published SDK`() {
        val snapshot =
            protocolJson.decodeFromString<ConversationSnapshot>(
                """{
            "messages":[{"id":"reason","role":"reasoning","content":"Compare the constraints."},{"id":"answer","role":"assistant","content":"The answer."}],
            "interrupts":[],"outputs":[],"runs":[]
        }"""
            )
        assertTrue(isReasoning(snapshot.messages[0]))
        assertEquals("Compare the constraints.", snapshot.messages[0].content)
        assertFalse(isReasoning(snapshot.messages[1]))
    }

    @Test
    fun `messages snapshot event can decode reasoning and answers together`() {
        val event =
            protocolJson.decodeFromString<BaseEvent>(
                """{"type":"MESSAGES_SNAPSHOT","messages":[{"id":"reason","role":"reasoning","content":"Compare."},{"id":"answer","role":"assistant","content":"Done."}]}"""
            ) as MessagesSnapshotEvent
        assertTrue(isReasoning(event.messages[0]))
        assertEquals("Done.", event.messages[1].content)
    }
}

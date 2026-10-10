package com.agentplayground.domain.presentation

import com.agentplayground.domain.conversation.SessionState
import com.agentplayground.domain.model.ActivityEntry
import com.agentplayground.domain.model.protocolJson
import com.agui.core.types.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ActivityPresentationTest {
    @Test
    fun `merged interleaved streams keep their identities and original events`() {
        val events =
            listOf(
                ActivityEntry(1, 100, "run", TextMessageStartEvent("a")),
                ActivityEntry(2, 101, "run", TextMessageContentEvent("a", "Hello ")),
                ActivityEntry(3, 102, "run", ToolCallStartEvent("tool", "calculate_sum", "owner")),
                ActivityEntry(4, 103, "run", TextMessageContentEvent("a", "world")),
                ActivityEntry(5, 104, "run", TextMessageEndEvent("a")),
                ActivityEntry(6, 105, "other", TextMessageContentEvent("a", "New run")),
            )

        val rows = activityRows(events, true)

        assertEquals(3, rows.size)
        assertEquals("Hello world", rows[0].content)
        assertEquals("Complete", rows[0].status)
        assertEquals(listOf(1L, 2L, 4L, 5L), rows[0].events.map { it.sequence })
        assertEquals("New run", rows[2].content)
        assertEquals(events, activityRows(events, false).map { it.entry })
    }

    @Test
    fun `export keeps complete event payloads and reports received versus retained counts`() {
        val content = "x".repeat(5000)
        val state =
            SessionState(
                "thread",
                receivedEventCount = 301,
                activity =
                    listOf(
                        ActivityEntry(301, 1234, "run", TextMessageContentEvent("message", content))
                    ),
            )

        val exported = protocolJson.parseToJsonElement(activityExport(state, 4321)).jsonObject

        assertEquals(301, exported["received"]!!.jsonPrimitive.int)
        assertEquals(1, exported["retained"]!!.jsonPrimitive.int)
        assertEquals(
            content,
            exported["events"]!!
                .jsonArray
                .single()
                .jsonObject["event"]!!
                .jsonObject["delta"]!!
                .jsonPrimitive
                .content,
        )
    }
}

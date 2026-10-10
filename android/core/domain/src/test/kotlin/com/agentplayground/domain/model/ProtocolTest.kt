package com.agentplayground.domain.model

import com.agui.core.types.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ProtocolTest {

    @Test
    fun `snapshot preserves message timestamps separately from official message fields`() {
        val snapshot =
            protocolJson.decodeFromString<ConversationSnapshot>(
                """{"messages":[{"id":"user","role":"user","content":"Hello"}],"interrupts":[],"outputs":[],"runs":[],"messageTimestamps":{"user":"2026-10-11T02:30:00Z"}}"""
            )
        val wire =
            protocolJson.encodeToJsonElement(ConversationSnapshot.serializer(), snapshot).jsonObject

        assertEquals(
            "2026-10-11T02:30:00Z",
            wire["messageTimestamps"]?.jsonObject?.get("user")?.jsonPrimitive?.content,
        )
        assertFalse(
            wire.getValue("messages").jsonArray.single().jsonObject.containsKey("createdAt")
        )
    }

    @Test
    fun `model metadata and saved selection survive serialization without exposing configuration`() {
        val info =
            protocolJson.decodeFromString<AgentInfo>(
                """{"model":"deepseek-flash","defaultModelId":"deepseek","models":[{"id":"deepseek","label":"DeepSeek","model":"deepseek-flash","available":true},{"id":"qwen","label":"Qwen3.8-Flash","model":"qwen3.8-flash","available":false}]}"""
            )
        val wire = protocolJson.encodeToJsonElement(AgentInfo.serializer(), info).jsonObject
        val saved =
            protocolJson.decodeFromString<SavedConversation>(
                """{"threadId":"new","draft":"Keep this","modelId":"qwen","modelSelectionLocal":true}"""
            )
        val journal =
            protocolJson.encodeToJsonElement(SavedConversation.serializer(), saved).jsonObject

        assertEquals("deepseek", wire["defaultModelId"]?.jsonPrimitive?.content)
        assertEquals(
            false,
            wire["models"]?.jsonArray?.last()?.jsonObject?.get("available")?.jsonPrimitive?.boolean,
        )
        assertEquals("qwen", journal["modelId"]?.jsonPrimitive?.content)
        assertEquals(true, journal["modelSelectionLocal"]?.jsonPrimitive?.boolean)
        assertEquals("Keep this", saved.draft)
    }

    @Test
    fun `canonical snapshot and admitted run retain separate model selections`() {
        val snapshot =
            protocolJson.decodeFromString<ConversationSnapshot>(
                """{"messages":[],"interrupts":[],"outputs":[],"runs":[{"runId":"old","status":"completed","modelId":"deepseek"}],"modelId":"qwen"}"""
            )
        val wire =
            protocolJson.encodeToJsonElement(ConversationSnapshot.serializer(), snapshot).jsonObject

        assertEquals("qwen", wire["modelId"]?.jsonPrimitive?.content)
        assertEquals(
            "deepseek",
            wire.getValue("runs").jsonArray.single().jsonObject["modelId"]?.jsonPrimitive?.content,
        )
        assertEquals(
            "deepseek-flash",
            protocolJson.decodeFromString<AgentInfo>("""{"model":"deepseek-flash"}""").model,
        )
        assertEquals(
            "",
            protocolJson.decodeFromString<SavedConversation>("""{"threadId":"legacy"}""").draft,
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

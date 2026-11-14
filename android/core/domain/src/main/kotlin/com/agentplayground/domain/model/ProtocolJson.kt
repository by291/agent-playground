package com.agentplayground.domain.model

import com.agui.core.types.AgUiJson
import com.agui.core.types.Message
import com.agui.core.types.ReasoningMessage
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Decode application payloads with the SDK's protocol configuration. */
val protocolJson = AgUiJson

/** Create a public reasoning message for a live event. */
fun reasoningMessage(id: String, content: String = "") = ReasoningMessage(id, content)

/** Identify reasoning in both streamed messages and server snapshots. */
fun isReasoning(message: Message) = message is ReasoningMessage

fun JsonObject.string(key: String): String? = (get(key) as? JsonPrimitive)?.contentOrNull

package com.agentplayground.core

import com.agui.core.types.*
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.*
import kotlinx.serialization.modules.*

// The published SDK has reasoning events but not a reasoning Message subtype. Keep
// official message models and bridge the server's public reasoning discriminator here.
private const val REASONING_NAME = "agent-playground:public-reasoning"

val protocolJson =
    Json(AgUiJson) {
        serializersModule =
            AgUiSerializersModule.overwriteWith(
                SerializersModule {
                    polymorphic(Message::class) {
                        defaultDeserializer { role ->
                            if (role == "reasoning") {
                                ReasoningMessageAdapter
                            } else {
                                null
                            }
                        }
                    }
                }
            )
    }

fun reasoningMessage(id: String, content: String = "") =
    AssistantMessage(id, content, name = REASONING_NAME)

fun isReasoning(message: Message) = message is AssistantMessage && message.name == REASONING_NAME

private object ReasoningMessageAdapter : KSerializer<Message> {
    override val descriptor: SerialDescriptor = AssistantMessage.serializer().descriptor

    override fun deserialize(decoder: Decoder): Message {
        val jsonDecoder = decoder as JsonDecoder
        val fields = jsonDecoder.decodeJsonElement().jsonObject.toMutableMap()
        fields.remove("role")
        fields["name"] = JsonPrimitive(REASONING_NAME)

        return jsonDecoder.json.decodeFromJsonElement(
            AssistantMessage.serializer(),
            JsonObject(fields),
        )
    }

    override fun serialize(encoder: Encoder, value: Message) {
        encoder.encodeSerializableValue(AssistantMessage.serializer(), value as AssistantMessage)
    }
}

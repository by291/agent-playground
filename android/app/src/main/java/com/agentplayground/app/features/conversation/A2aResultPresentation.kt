package com.agentplayground.app.features.conversation

import com.agentplayground.app.features.workflow.workflowCatalog
import com.agentplayground.core.SessionState
import kotlinx.serialization.json.*

/** Identify only archived numbered results whose full revision is already owned by an A2A task. */
internal fun duplicateA2aResultSurfaces(state: SessionState): Set<Pair<String, String?>> {
    val duplicates = mutableSetOf<Pair<String, String?>>()

    for (output in state.outputs) {
        val task =
            state.externalTasks.find {
                it.kind == "a2a" && it.workflowCallId == output.toolCallId
            } ?: continue
        val revision =
            task.outputs.find {
                it.step == "revise" && it.status == "succeeded" && it.text.isNotBlank()
            } ?: continue
        val surfaceId = "a2a-${task.workflowCallId}-result"
        val key = surfaceId to output.toolCallId
        val messages =
            when (val value = output.messages) {
                is JsonArray -> value
                is JsonObject -> value["messages"] as? JsonArray
                else -> null
            }

        if (messages == null) {
            duplicates.remove(key)
            continue
        }

        val targetsResult = messages.any { message ->
            val envelope = message as? JsonObject

            listOf("createSurface", "updateComponents", "deleteSurface").any { command ->
                (envelope?.get(command) as? JsonObject)?.literalString("surfaceId") == surfaceId
            }
        }

        if (!targetsResult) {
            continue
        }

        // Complete output batches can replace a previous result with a compact receipt.
        duplicates.remove(key)
        val text = numberedResultText(messages, surfaceId)

        if (text != null && normalizeResultText(text) == normalizeResultText(revision.text)) {
            duplicates.add(key)
        }
    }

    return duplicates
}

private fun numberedResultText(messages: JsonArray, surfaceId: String): String? {
    var catalogId: String? = null
    val components = mutableMapOf<String, JsonObject>()

    for (message in messages) {
        val envelope = message as? JsonObject ?: return null

        if (envelope.literalString("version") != "v0.9") {
            return null
        }

        val create = envelope["createSurface"] as? JsonObject

        if (create?.literalString("surfaceId") == surfaceId) {
            catalogId = create.literalString("catalogId")
            components.clear()
        }

        val update = envelope["updateComponents"] as? JsonObject

        if (update?.literalString("surfaceId") == surfaceId) {
            if (catalogId == null) {
                return null
            }

            val batch = update["components"] as? JsonArray ?: return null

            for (value in batch) {
                val component = value as? JsonObject ?: return null
                val id = component.literalString("id") ?: return null

                if (component.literalString("component") == null) {
                    return null
                }

                components[id] = component
            }
        }

        val delete = envelope["deleteSurface"] as? JsonObject

        if (delete?.literalString("surfaceId") == surfaceId) {
            catalogId = null
            components.clear()
        }
    }

    if (catalogId != workflowCatalog.id) {
        return null
    }

    val steps = components["steps"] ?: return null
    val children = steps["children"] as? JsonArray ?: return null

    if (steps.literalString("component") != "WorkflowSteps") {
        return null
    }

    val lines = mutableListOf<String>()

    for (child in children) {
        val childId = child.literalString() ?: return null
        val component = components[childId] ?: return null

        if (
            component.literalString("component") != "WorkflowText" ||
                component.literalString("role") != "step"
        ) {
            return null
        }

        lines.add(component.literalString("text") ?: return null)
    }

    return lines.joinToString("\n")
}

private fun JsonElement.literalString(): String? =
    (this as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.literalString(key: String): String? = get(key)?.literalString()

private fun normalizeResultText(text: String): String =
    text.replace("\r\n", "\n").replace('\r', '\n').trim()

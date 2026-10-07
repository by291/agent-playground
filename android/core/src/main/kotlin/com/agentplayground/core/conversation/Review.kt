package com.agentplayground.core.conversation

import com.agentplayground.core.model.string
import com.agui.core.types.*
import java.time.Instant
import kotlinx.serialization.json.*

data class PlanDraft(val title: String, val steps: List<String>) {
    val canApprove
        get() = title.isNotBlank() && steps.any { it.isNotBlank() }

    fun normalized() = PlanDraft(title.trim(), steps.map(String::trim).filter(String::isNotBlank))
}

data class Review(val interrupt: Interrupt, val raw: JsonObject) {
    val kind
        get() = raw.string("kind")

    val title
        get() = raw.string("title") ?: "Workflow decision"

    val steps
        get() =
            (raw["steps"] as? JsonArray)
                ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                .orEmpty()

    val canAccept
        get() = raw["canAccept"]?.jsonPrimitive?.booleanOrNull == true

    val acceptLabel
        get() = raw.string("acceptLabel") ?: "Accept"

    val placeholder
        get() = raw.string("messagePlaceholder") ?: "Ask a question or describe a change…"

    val blockedReason
        get() = raw.string("blockedReason")

    val expired
        get() = expiredAt(Instant.now())

    fun expiredAt(now: Instant) =
        interrupt.expiresAt?.let {
            runCatching { !Instant.parse(it).isAfter(now) }.getOrDefault(true)
        } == true

    fun respond(
        action: String,
        message: String? = null,
        messageId: String? = null,
        plan: PlanDraft? = null,
        now: Instant = Instant.now(),
    ): ResumeEntry? {
        if (expiredAt(now)) {
            return null
        }

        val payload =
            when (kind) {
                "workflow_review" -> {
                    if (
                        action !in setOf("accept", "abandon", "message") ||
                            (action == "accept" && !canAccept)
                    ) {
                        return null
                    }

                    if (
                        action == "message" &&
                            (message.isNullOrBlank() ||
                                message.length > 10_000 ||
                                messageId.isNullOrBlank())
                    ) {
                        return null
                    }

                    buildJsonObject {
                        put("action", action)
                        put("workflowCallId", raw.getValue("workflowCallId"))
                        put("revision", raw.getValue("revision"))
                        put("round", raw.getValue("round"))

                        if (action == "message") {
                            put("message", message!!.trim())
                            put("messageId", messageId)
                        }
                    }
                }

                "experiment_plan_review" -> {
                    if (action !in setOf("approve", "reject")) {
                        return null
                    }

                    val replacement = (plan ?: PlanDraft(title, steps)).normalized()

                    if (action == "approve" && !replacement.canApprove) {
                        return null
                    }

                    buildJsonObject {
                        put("decision", action)
                        put("title", replacement.title)
                        put("steps", JsonArray(replacement.steps.map(::JsonPrimitive)))
                    }
                }

                else -> return null
            }

        return ResumeEntry(interrupt.id, ResumeStatus.RESOLVED, payload)
    }

    companion object {
        fun from(interrupt: Interrupt): Review? {
            val raw =
                (interrupt.metadata as? JsonObject)
                    ?.get("langgraph")
                    ?.let { it as? JsonObject }
                    ?.get("raw") as? JsonObject ?: return null
            val kind = raw.string("kind")

            if (kind == "workflow_review") {
                if (
                    raw.string("workflowCallId").isNullOrBlank() ||
                        raw.string("outputStepId").isNullOrBlank() ||
                        (raw["revision"] as? JsonPrimitive)?.intOrNull?.let { it > 0 } != true ||
                        (raw["round"] as? JsonPrimitive)?.intOrNull?.let { it > 0 } != true ||
                        (raw["canAccept"] as? JsonPrimitive)?.booleanOrNull == null
                ) {
                    return null
                }
            } else if (
                kind != "experiment_plan_review" ||
                    raw["steps"] !is JsonArray ||
                    raw.string("title") == null
            ) {
                return null
            }

            return Review(interrupt, raw)
        }
    }
}

fun externalWaitCallId(interrupt: Interrupt): String? {
    val metadata = interrupt.metadata as? JsonObject
    val langgraph = metadata?.get("langgraph") as? JsonObject
    val raw = langgraph?.get("raw") as? JsonObject

    return raw?.takeIf { it.string("kind") == "workflow_external_wait" }?.string("workflowCallId")
}

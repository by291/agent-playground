package com.agentplayground.domain.conversation

import com.agui.core.types.Interrupt
import com.agui.core.types.ResumeEntry
import com.agui.core.types.ResumeStatus
import java.time.Instant
import kotlinx.serialization.json.*

enum class InteractionDecisionType(val wireName: String) {
    Approve("approve"),
    Reject("reject"),
    Respond("respond"),
}

data class InteractionOption(val label: String, val description: String? = null)

data class InteractionQuestion(
    val id: String,
    val question: String,
    val options: List<InteractionOption>,
)

data class InteractionAction(
    val name: String,
    val arguments: JsonObject,
    val description: String?,
    val allowedDecisions: Set<InteractionDecisionType>,
    val questions: List<InteractionQuestion>,
)

/** UI selection is independent of answer text, including custom text equal to a suggested label. */
sealed interface InteractionAnswerMode {
    data class Suggested(val optionIndex: Int) : InteractionAnswerMode

    data object Custom : InteractionAnswerMode
}

data class InteractionDecisionDraft(
    val type: InteractionDecisionType? = null,
    val answers: Map<String, String> = emptyMap(),
    val message: String = "",
    val answerModes: Map<String, InteractionAnswerMode> = emptyMap(),
    val customAnswers: Map<String, String> = emptyMap(),
)

data class InteractionDraft(val decisions: List<InteractionDecisionDraft>)

/** One LangChain HITL interrupt is an atomic batch, identified by its full current envelope. */
data class InteractionRequest(val interrupt: Interrupt, val actions: List<InteractionAction>) {
    fun initialDraft() =
        InteractionDraft(
            actions.map { action ->
                val initialType =
                    InteractionDecisionType.Respond.takeIf { it in action.allowedDecisions }

                InteractionDecisionDraft(initialType)
            }
        )

    fun expiredAt(now: Instant): Boolean =
        interrupt.expiresAt?.let {
            runCatching { !Instant.parse(it).isAfter(now) }.getOrDefault(true)
        } == true

    fun respond(draft: InteractionDraft, now: Instant): ResumeEntry? {
        if (expiredAt(now) || draft.decisions.size != actions.size) {
            return null
        }

        val decisions =
            actions.zip(draft.decisions).map { (action, decision) ->
                val type = decision.type ?: return null

                if (type !in action.allowedDecisions) {
                    return null
                }

                when (type) {
                    InteractionDecisionType.Approve -> buildJsonObject { put("type", "approve") }

                    InteractionDecisionType.Reject -> {
                        if (decision.message.length > 4000) {
                            return null
                        }

                        buildJsonObject {
                            put("type", "reject")

                            if (decision.message.isNotBlank()) {
                                put("message", decision.message)
                            }
                        }
                    }

                    InteractionDecisionType.Respond -> {
                        val ids = action.questions.map { it.id }.toSet()

                        if (
                            decision.answers.keys != ids ||
                                decision.answers.values.any { !validText(it, 4000) }
                        ) {
                            return null
                        }

                        val response = buildJsonObject {
                            put(
                                "answers",
                                buildJsonArray {
                                    action.questions.forEach { question ->
                                        add(
                                            buildJsonObject {
                                                put("id", question.id)
                                                put(
                                                    "answer",
                                                    decision.answers.getValue(question.id),
                                                )
                                            }
                                        )
                                    }
                                },
                            )
                        }

                        buildJsonObject {
                            put("type", "respond")
                            put("message", response.toString())
                        }
                    }
                }
            }
        val payload = buildJsonObject { put("decisions", JsonArray(decisions)) }

        return ResumeEntry(interrupt.id, ResumeStatus.RESOLVED, payload)
    }

    companion object {
        fun from(interrupt: Interrupt): InteractionRequest? {
            val metadata = interrupt.metadata as? JsonObject ?: return null
            val langgraph = metadata["langgraph"] as? JsonObject ?: return null
            val raw = langgraph["raw"] as? JsonObject ?: return null
            val requests = raw["action_requests"] as? JsonArray ?: return null
            val configs = raw["review_configs"] as? JsonArray ?: return null

            if (requests.isEmpty() || requests.size != configs.size) {
                return null
            }

            val actions =
                requests.zip(configs).map { (requestValue, configValue) ->
                    val request = requestValue as? JsonObject ?: return null
                    val config = configValue as? JsonObject ?: return null
                    val name =
                        request.stringField("name")?.takeIf { it.isNotBlank() } ?: return null
                    val arguments = request["args"] as? JsonObject ?: return null
                    val description =
                        request["description"]?.let {
                            request.stringField("description") ?: return null
                        }
                    val allowed = config["allowed_decisions"] as? JsonArray ?: return null

                    if (config.stringField("action_name") != name || allowed.isEmpty()) {
                        return null
                    }

                    val decisions = allowed.map { value ->
                        val text = (value as? JsonPrimitive)?.takeIf { it.isString }?.content

                        InteractionDecisionType.entries.find { it.wireName == text } ?: return null
                    }
                    val permitted =
                        if (name == "ask_user") {
                            setOf(InteractionDecisionType.Respond, InteractionDecisionType.Reject)
                        } else {
                            setOf(InteractionDecisionType.Approve, InteractionDecisionType.Reject)
                        }

                    if (
                        decisions.distinct().size != decisions.size ||
                            decisions.any { it !in permitted }
                    ) {
                        return null
                    }

                    val questions =
                        if (name == "ask_user") {
                            parseInteractionQuestions(arguments) ?: return null
                        } else {
                            emptyList()
                        }

                    InteractionAction(name, arguments, description, decisions.toSet(), questions)
                }

            return InteractionRequest(interrupt, actions)
        }
    }
}

/** Revalidates the exact visible interrupt before allowing an atomic response. */
internal fun resolveInteraction(
    current: SessionState,
    expected: Interrupt,
    draft: InteractionDraft,
    now: Instant,
): ResumeEntry? {
    val currentInterrupt =
        current.interrupts.filter { it.id == expected.id }.singleOrNull() ?: return null

    // IDs can be reused by a newer checkpoint. Match its entire envelope, not only the label.
    if (currentInterrupt != expected) {
        return null
    }

    return InteractionRequest.from(currentInterrupt)?.respond(draft, now)
}

/** Validates clarification questions identically for live interrupts and restored tool history. */
fun parseInteractionQuestions(arguments: JsonObject): List<InteractionQuestion>? {
    val values = arguments["questions"] as? JsonArray ?: return null

    if (values.size !in 1..3) {
        return null
    }

    val questions = values.map { value ->
        val fields = value as? JsonObject ?: return null
        val id = fields.stringField("id")?.takeIf { validText(it, 64) } ?: return null
        val question = fields.stringField("question")?.takeIf { validText(it, 1000) } ?: return null
        val options =
            if ("options" in fields) {
                val optionValues = fields["options"] as? JsonArray ?: return null

                if (optionValues.size !in 2..4) {
                    return null
                }

                optionValues.map { optionValue ->
                    val option = optionValue as? JsonObject ?: return null
                    val label =
                        option.stringField("label")?.takeIf { validText(it, 200) } ?: return null
                    val description =
                        option["description"]?.let {
                            option.stringField("description")?.takeIf { it.length <= 500 }
                                ?: return null
                        }

                    InteractionOption(label, description)
                }
            } else {
                emptyList()
            }

        if (options.map { it.label }.distinct().size != options.size) {
            return null
        }

        InteractionQuestion(id, question, options)
    }

    return questions.takeIf { it.map(InteractionQuestion::id).distinct().size == it.size }
}

private fun JsonObject.stringField(name: String): String? =
    (get(name) as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun validText(value: String, maximum: Int): Boolean =
    value.isNotBlank() && value.length <= maximum

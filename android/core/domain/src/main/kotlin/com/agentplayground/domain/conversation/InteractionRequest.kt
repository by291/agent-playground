package com.agentplayground.domain.conversation

import com.agui.core.types.Interrupt
import com.agui.core.types.ResumeEntry
import com.agui.core.types.ResumeStatus
import java.time.Instant
import kotlinx.serialization.json.*

private const val MAX_DECISION_TEXT_LENGTH = 4000
private const val MAX_QUESTION_COUNT = 3
private const val MIN_OPTION_COUNT = 2
private const val MAX_OPTION_COUNT = 4
private const val MAX_QUESTION_ID_LENGTH = 64
private const val MAX_QUESTION_LENGTH = 1000
private const val MAX_OPTION_LABEL_LENGTH = 200
private const val MAX_OPTION_DESCRIPTION_LENGTH = 500

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
    /** Defaults clarification decisions to responding and leaves approvals unselected. */
    fun initialDraft() =
        InteractionDraft(
            actions.map { action ->
                val initialType =
                    InteractionDecisionType.Respond.takeIf { it in action.allowedDecisions }

                InteractionDecisionDraft(initialType)
            }
        )

    /** Treats an invalid server expiration as expired so it cannot authorize a stale response. */
    fun expiredAt(now: Instant): Boolean =
        interrupt.expiresAt?.let {
            runCatching { !Instant.parse(it).isAfter(now) }.getOrDefault(true)
        } == true

    /** Encodes a complete batch with decisions in the original action order. */
    fun respond(draft: InteractionDraft, now: Instant): ResumeEntry? {
        if (expiredAt(now) || draft.decisions.size != actions.size) {
            return null
        }

        val decisions =
            actions.zip(draft.decisions).map { (action, decision) ->
                encodeDecision(action, decision) ?: return null
            }
        val payload = buildJsonObject { put("decisions", JsonArray(decisions)) }

        return ResumeEntry(interrupt.id, ResumeStatus.RESOLVED, payload)
    }

    companion object {
        /** Parses the LangGraph envelope carried by the official AG-UI interrupt. */
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

                    parseAction(request, config) ?: return null
                }

            return InteractionRequest(interrupt, actions)
        }
    }
}

private fun encodeDecision(
    action: InteractionAction,
    draft: InteractionDecisionDraft,
): JsonObject? {
    val type = draft.type ?: return null

    if (type !in action.allowedDecisions) {
        return null
    }

    return when (type) {
        InteractionDecisionType.Approve -> buildJsonObject { put("type", type.wireName) }

        InteractionDecisionType.Reject -> {
            if (draft.message.length > MAX_DECISION_TEXT_LENGTH) {
                return null
            }

            buildJsonObject {
                put("type", type.wireName)

                if (draft.message.isNotBlank()) {
                    put("message", draft.message)
                }
            }
        }

        InteractionDecisionType.Respond -> {
            val message = encodeAnswers(action.questions, draft.answers) ?: return null

            buildJsonObject {
                put("type", type.wireName)
                put("message", message)
            }
        }
    }
}

private fun encodeAnswers(
    questions: List<InteractionQuestion>,
    answers: Map<String, String>,
): String? {
    val expectedIds = questions.map { it.id }.toSet()

    val hasInvalidAnswer = answers.values.any { !validText(it, MAX_DECISION_TEXT_LENGTH) }

    if (answers.keys != expectedIds || hasInvalidAnswer) {
        return null
    }

    // The upstream validator matches each answer to its question by position.
    val orderedAnswers = questions.map { question ->
        buildJsonObject {
            put("id", question.id)
            put("answer", answers.getValue(question.id))
        }
    }

    return buildJsonObject { put("answers", JsonArray(orderedAnswers)) }.toString()
}

private fun parseAction(request: JsonObject, config: JsonObject): InteractionAction? {
    val name = request.stringField("name")?.takeIf { it.isNotBlank() } ?: return null
    val arguments = request["args"] as? JsonObject ?: return null
    val description =
        request["description"]?.let { request.stringField("description") ?: return null }
    val allowed = config["allowed_decisions"] as? JsonArray ?: return null

    if (config.stringField("action_name") != name || allowed.isEmpty()) {
        return null
    }

    val isClarification = name == "ask_user"
    val permitted =
        if (isClarification) {
            setOf(InteractionDecisionType.Respond, InteractionDecisionType.Reject)
        } else {
            setOf(InteractionDecisionType.Approve, InteractionDecisionType.Reject)
        }
    val decisions = mutableSetOf<InteractionDecisionType>()

    for (value in allowed) {
        val text = (value as? JsonPrimitive)?.takeIf { it.isString }?.content
        val decision = permitted.find { it.wireName == text } ?: return null

        if (!decisions.add(decision)) {
            return null
        }
    }

    val questions =
        if (isClarification) parseInteractionQuestions(arguments) ?: return null else emptyList()

    return InteractionAction(
        name = name,
        arguments = arguments,
        description = description,
        allowedDecisions = decisions,
        questions = questions,
    )
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

    if (values.size !in 1..MAX_QUESTION_COUNT) {
        return null
    }

    val questions = values.map { value ->
        val question = value as? JsonObject ?: return null

        parseQuestion(question) ?: return null
    }

    return questions.takeIf { it.map(InteractionQuestion::id).distinct().size == it.size }
}

private fun parseQuestion(fields: JsonObject): InteractionQuestion? {
    val id =
        fields.stringField("id")?.takeIf { validText(it, MAX_QUESTION_ID_LENGTH) } ?: return null
    val question =
        fields.stringField("question")?.takeIf { validText(it, MAX_QUESTION_LENGTH) } ?: return null
    val values = fields["options"] ?: return InteractionQuestion(id, question, emptyList())
    val options = parseOptions(values as? JsonArray ?: return null) ?: return null

    return InteractionQuestion(id, question, options)
}

private fun parseOptions(values: JsonArray): List<InteractionOption>? {
    if (values.size !in MIN_OPTION_COUNT..MAX_OPTION_COUNT) {
        return null
    }

    val options = values.map { value ->
        val option = value as? JsonObject ?: return null
        val label =
            option.stringField("label")?.takeIf { validText(it, MAX_OPTION_LABEL_LENGTH) }
                ?: return null
        val description =
            option["description"]?.let {
                option.stringField("description")?.takeIf {
                    it.length <= MAX_OPTION_DESCRIPTION_LENGTH
                } ?: return null
            }

        InteractionOption(label, description)
    }

    return options.takeIf { it.map(InteractionOption::label).distinct().size == it.size }
}

private fun JsonObject.stringField(name: String): String? =
    (get(name) as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun validText(value: String, maximum: Int): Boolean =
    value.isNotBlank() && value.length <= maximum

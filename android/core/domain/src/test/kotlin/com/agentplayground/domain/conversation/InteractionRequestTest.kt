package com.agentplayground.domain.conversation

import com.agentplayground.domain.model.protocolJson
import com.agui.core.types.Interrupt
import com.agui.core.types.ResumeStatus
import java.time.Instant
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class InteractionRequestTest {
    @Test
    fun `paired actions parse in order with plain questions and allowed decisions`() {
        val request = InteractionRequest.from(interrupt(batch()))

        assertNotNull(request)
        assertEquals(listOf("ask_user", "forget_memory"), request!!.actions.map { it.name })
        assertEquals(listOf("goal"), request.actions.first().questions.map { it.id })
        assertEquals(
            listOf("Fast", "Thorough"),
            request.actions.first().questions.single().options.map { it.label },
        )
        assertEquals(
            setOf(InteractionDecisionType.Respond, InteractionDecisionType.Reject),
            request.actions.first().allowedDecisions,
        )
        assertEquals(
            listOf(InteractionDecisionType.Respond, null),
            request.initialDraft().decisions.map { it.type },
        )
    }

    @Test
    fun `invalid pairing and decision grants are rejected`() {
        val raw = batch()
        val actions = raw.getValue("action_requests").jsonArray
        val configs = raw.getValue("review_configs").jsonArray
        val invalid =
            listOf(
                raw.with("action_requests", JsonArray(emptyList())),
                raw.with("review_configs", JsonArray(configs.take(1))),
                raw.with("review_configs", JsonArray(configs.reversed())),
                raw.with(
                    "review_configs",
                    JsonArray(listOf(config("ask_user", "approve"), configs[1])),
                ),
                raw.with(
                    "review_configs",
                    JsonArray(listOf(configs[0], config("forget_memory", "respond"))),
                ),
                raw.with(
                    "review_configs",
                    JsonArray(listOf(configs[0], config("forget_memory", "approve", "edit"))),
                ),
                raw.with(
                    "review_configs",
                    JsonArray(listOf(configs[0], config("forget_memory", "approve", "approve"))),
                ),
                raw.with("review_configs", JsonArray(listOf(configs[0], config("forget_memory")))),
                raw.with(
                    "action_requests",
                    JsonArray(
                        listOf(actions[0], actions[1].jsonObject.with("name", JsonPrimitive(3)))
                    ),
                ),
                raw.with(
                    "action_requests",
                    JsonArray(
                        listOf(actions[0], actions[1].jsonObject.with("args", JsonPrimitive("{}")))
                    ),
                ),
            )

        invalid.forEach { fields ->
            assertNull(fields.toString(), InteractionRequest.from(interrupt(fields)))
        }
        assertNotNull(
            InteractionRequest.from(
                interrupt(
                    raw.with(
                        "review_configs",
                        JsonArray(
                            listOf(config("ask_user", "respond"), config("forget_memory", "reject"))
                        ),
                    )
                )
            )
        )
    }

    @Test
    fun `question limits duplicate ids and duplicate option labels are validated strictly`() {
        val question = question()
        val badQuestions =
            listOf(
                emptyList(),
                List(4) { question.with("id", JsonPrimitive("q$it")) },
                listOf(question, question),
                listOf(question.with("id", JsonPrimitive(" "))),
                listOf(question.with("id", JsonPrimitive("a".repeat(65)))),
                listOf(question.with("question", JsonPrimitive(" "))),
                listOf(question.with("question", JsonPrimitive("a".repeat(1001)))),
                listOf(question.with("question", JsonPrimitive(42))),
                listOf(question.with("options", JsonArray(listOf(option("Only"))))),
                listOf(question.with("options", JsonArray(List(5) { option("Option $it") }))),
                listOf(question.with("options", JsonArray(listOf(option("Same"), option("Same"))))),
                listOf(question.with("options", JsonArray(listOf(option(" "), option("Valid"))))),
                listOf(
                    question.with(
                        "options",
                        JsonArray(listOf(option("a".repeat(201)), option("Valid"))),
                    )
                ),
                listOf(
                    question.with(
                        "options",
                        JsonArray(listOf(option("First", "a".repeat(501)), option("Second"))),
                    )
                ),
            )

        for (questions in badQuestions) {
            assertNull(questions.toString(), InteractionRequest.from(interrupt(batch(questions))))
        }

        val boundary =
            question
                .with("id", JsonPrimitive("i".repeat(64)))
                .with("question", JsonPrimitive("q".repeat(1000)))
                .with(
                    "options",
                    JsonArray(listOf(option("a".repeat(200), "d".repeat(500)), option("Other"))),
                )
        val withoutOptions = question - "options"

        assertNotNull(InteractionRequest.from(interrupt(batch(listOf(boundary)))))
        assertNotNull(InteractionRequest.from(interrupt(batch(listOf(JsonObject(withoutOptions))))))
    }

    @Test
    fun `atomic response preserves order exact answer ids and safe decision shapes`() {
        val request = InteractionRequest.from(interrupt(batch()))!!
        val draft =
            InteractionDraft(
                listOf(
                    InteractionDecisionDraft(
                        InteractionDecisionType.Respond,
                        mapOf("goal" to "Fast\nwith safeguards"),
                    ),
                    InteractionDecisionDraft(
                        InteractionDecisionType.Reject,
                        message = "Keep the existing memory",
                    ),
                )
            )

        val entry = request.respond(draft, now)

        assertEquals("request", entry?.interruptId)
        assertEquals(ResumeStatus.RESOLVED, entry?.status)
        val decisions = entry!!.payload!!.jsonObject.getValue("decisions").jsonArray
        assertEquals(setOf("type", "message"), decisions[0].jsonObject.keys)
        assertEquals("respond", decisions[0].jsonObject.getValue("type").jsonPrimitive.content)
        assertEquals(
            protocolJson.parseToJsonElement(
                """{"answers":[{"id":"goal","answer":"Fast\nwith safeguards"}]}"""
            ),
            protocolJson.parseToJsonElement(
                decisions[0].jsonObject.getValue("message").jsonPrimitive.content
            ),
        )
        assertEquals(
            protocolJson.parseToJsonElement(
                """{"type":"reject","message":"Keep the existing memory"}"""
            ),
            decisions[1],
        )
    }

    @Test
    fun `incomplete duplicate extra or overlong responses never submit part of a batch`() {
        val request = InteractionRequest.from(interrupt(batch()))!!
        val valid =
            InteractionDecisionDraft(InteractionDecisionType.Respond, mapOf("goal" to "Answer"))
        val approve = InteractionDecisionDraft(InteractionDecisionType.Approve)
        val invalid =
            listOf(
                InteractionDraft(listOf(valid)),
                InteractionDraft(listOf(valid, approve, approve)),
                InteractionDraft(
                    listOf(valid.copy(type = InteractionDecisionType.Approve), approve)
                ),
                InteractionDraft(listOf(valid.copy(answers = emptyMap()), approve)),
                InteractionDraft(listOf(valid.copy(answers = mapOf("goal" to " ")), approve)),
                InteractionDraft(
                    listOf(valid.copy(answers = mapOf("goal" to "a".repeat(4001))), approve)
                ),
                InteractionDraft(listOf(valid.copy(answers = mapOf("other" to "Answer")), approve)),
                InteractionDraft(
                    listOf(
                        valid.copy(answers = mapOf("goal" to "Answer", "extra" to "Answer")),
                        approve,
                    )
                ),
                InteractionDraft(
                    listOf(valid, approve.copy(type = InteractionDecisionType.Respond))
                ),
                InteractionDraft(
                    listOf(
                        valid,
                        InteractionDecisionDraft(
                            InteractionDecisionType.Reject,
                            message = "a".repeat(4001),
                        ),
                    )
                ),
                request.initialDraft(),
            )

        invalid.forEach { draft -> assertNull(draft.toString(), request.respond(draft, now)) }

        val accepted =
            request.respond(
                InteractionDraft(
                    listOf(
                        valid.copy(answers = mapOf("goal" to "a".repeat(4000))),
                        approve.copy(message = "Ignored"),
                    )
                ),
                now,
            )!!
        assertEquals(
            protocolJson.parseToJsonElement("""{"type":"approve"}"""),
            accepted.payload!!.jsonObject.getValue("decisions").jsonArray[1],
        )
    }

    @Test
    fun `stale duplicated and expired interrupt identities cannot be resumed`() {
        val expected = interrupt(batch())
        val draft =
            InteractionDraft(
                listOf(
                    InteractionDecisionDraft(InteractionDecisionType.Reject),
                    InteractionDecisionDraft(InteractionDecisionType.Approve),
                )
            )
        val current = SessionState("thread", interrupts = listOf(expected))
        val changed =
            expected.copy(
                metadata =
                    interrupt(batch(listOf(question().with("question", JsonPrimitive("Changed")))))
                        .metadata
            )

        assertNotNull(resolveInteraction(current, expected, draft, now))
        assertNull(
            resolveInteraction(current.copy(interrupts = listOf(changed)), expected, draft, now)
        )
        assertNull(
            resolveInteraction(
                current.copy(interrupts = listOf(expected, expected)),
                expected,
                draft,
                now,
            )
        )
        assertNull(resolveInteraction(current.copy(interrupts = emptyList()), expected, draft, now))
        assertNull(
            InteractionRequest.from(expected.copy(expiresAt = now.toString()))!!.respond(draft, now)
        )
        assertNull(InteractionRequest.from(expected.copy(expiresAt = "bad"))!!.respond(draft, now))
    }

    private val now = Instant.parse("2030-01-01T00:00:00Z")

    private fun interrupt(raw: JsonObject) =
        Interrupt(
            "request",
            "human_approval",
            metadata = buildJsonObject { put("langgraph", buildJsonObject { put("raw", raw) }) },
        )

    private fun batch(questions: List<JsonObject> = listOf(question())) = buildJsonObject {
        put(
            "action_requests",
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("name", "ask_user")
                        put("args", buildJsonObject { put("questions", JsonArray(questions)) })
                    }
                )
                add(
                    buildJsonObject {
                        put("name", "forget_memory")
                        put("args", buildJsonObject { put("id", "memory") })
                        put("description", "Delete the selected memory")
                    }
                )
            },
        )
        put(
            "review_configs",
            JsonArray(
                listOf(
                    config("ask_user", "respond", "reject"),
                    config("forget_memory", "approve", "reject"),
                )
            ),
        )
    }

    private fun config(name: String, vararg decisions: String) = buildJsonObject {
        put("action_name", name)
        put("allowed_decisions", JsonArray(decisions.map(::JsonPrimitive)))
    }

    private fun question() = buildJsonObject {
        put("id", "goal")
        put("question", "Which approach?")
        put("options", JsonArray(listOf(option("Fast"), option("Thorough", "Check each boundary"))))
    }

    private fun option(label: String, description: String? = null) = buildJsonObject {
        put("label", label)
        description?.let { put("description", it) }
    }

    private fun JsonObject.with(name: String, value: JsonElement) =
        JsonObject(this + (name to value))
}

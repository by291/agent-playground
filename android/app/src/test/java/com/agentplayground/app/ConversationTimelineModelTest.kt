package com.agentplayground.app

import com.agentplayground.app.features.conversation.conversationTimelineModel
import com.agentplayground.core.*
import com.agui.core.types.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ConversationTimelineModelTest {
    @Test
    fun `latest presentation follows feedback while previous surfaces stay with the original tool`() {
        val earlier = presentation(1, "earlier", "workflow", "first-reply")
        val repeated = presentation(2, "earlier", "workflow", "first-reply")
        val latest = presentation(3, "latest", "workflow", "latest-reply")
        val state = twoTurns().copy(outputs = listOf(earlier, repeated, latest))

        val timeline =
            conversationTimelineModel(
                state,
                listOf(
                    LegacyWorkflowSurface("earlier", "workflow"),
                    LegacyWorkflowSurface("latest", "workflow"),
                ),
            )

        val original = timeline.turns[0]
        val feedback = timeline.turns[1]

        assertEquals(listOf("first-user", "feedback"), timeline.turns.map { it.turn.id })
        assertEquals(listOf("earlier"), original.previousSurfaceIds)
        assertTrue(original.presentations.isEmpty())
        assertEquals(listOf(latest), feedback.presentations)
        assertTrue(feedback.previousSurfaceIds.isEmpty())
        assertTrue(timeline.turns.all { it.legacySurfaces.isEmpty() })
        assertTrue(timeline.standalonePresentations.isEmpty())
        assertFalse(timeline.empty)
    }

    @Test
    fun `missing anchors fall back to tool ownership and unattached artifacts remain standalone`() {
        val attached = presentation(1, "attached", "workflow", "missing-anchor")
        val standalone = presentation(2, "standalone", "missing-call", null)
        val attachedTask = task("attached-task", "workflow")
        val standaloneTask = task("standalone-task", "missing-call")
        val state =
            twoTurns()
                .copy(
                    outputs = listOf(attached, standalone),
                    externalTasks = listOf(attachedTask, standaloneTask),
                )

        val timeline =
            conversationTimelineModel(state, listOf(LegacyWorkflowSurface("unattached", null)))

        assertEquals(listOf(attached), timeline.turns[0].presentations)
        assertEquals(listOf(attachedTask), timeline.turns[0].tasks)
        assertTrue(timeline.turns[1].presentations.isEmpty())
        assertEquals(listOf(standalone), timeline.standalonePresentations)
        assertEquals(listOf("unattached"), timeline.standaloneLegacySurfaces.map { it.id })
        assertEquals(listOf(standaloneTask), timeline.standaloneTasks)
    }

    @Test
    fun `completed legacy stages hide only their own review and retain original process history`() {
        val completedReview = planReview("completed", "workflow")
        val pendingReview = planReview("pending", "other")
        val state =
            twoTurns("run_experiment_workflow")
                .copy(interrupts = listOf(completedReview, pendingReview))
        val surfaces =
            listOf(
                LegacyWorkflowSurface("experiment-workflow-idea", "workflow"),
                LegacyWorkflowSurface("experiment-workflow-review", "workflow"),
                LegacyWorkflowSurface("experiment-workflow-reviewed", "workflow"),
            )

        val timeline = conversationTimelineModel(state, surfaces)

        assertEquals(listOf(pendingReview), timeline.visibleInterrupts)
        assertEquals(listOf(pendingReview), timeline.pendingPlans)
        assertEquals(listOf(surfaces.last()), timeline.turns[0].legacySurfaces)
        assertEquals(surfaces.take(2).map { it.id }, timeline.turns[0].previousSurfaceIds)
        assertFalse(timeline.turns[0].hasReviews)
        assertTrue(timeline.turns[1].hasReviews)
    }

    @Test
    fun `an active legacy review replaces its card but keeps the card in process details`() {
        val review = planReview("review", "workflow")
        val state = twoTurns("run_experiment_workflow").copy(interrupts = listOf(review))
        val surface = LegacyWorkflowSurface("experiment-workflow-review", "workflow")

        val timeline = conversationTimelineModel(state, listOf(surface))

        assertTrue(timeline.turns[0].legacySurfaces.isEmpty())
        assertEquals(listOf(surface.id), timeline.turns[0].previousSurfaceIds)
        assertEquals(listOf(review), timeline.visibleInterrupts)
        assertTrue(timeline.turns.last().hasReviews)
    }

    @Test
    fun `pending reviews create a reply for a user-only turn and suppress the welcome state`() {
        val review = planReview("review")
        val state =
            SessionState(
                "thread",
                messages = listOf(UserMessage("user", "Plan")),
                interrupts = listOf(review),
            )

        val timeline = conversationTimelineModel(state, emptyList())
        val blank = conversationTimelineModel(SessionState("blank"), emptyList())
        val restoring =
            conversationTimelineModel(SessionState("restoring", loading = true), emptyList())

        assertTrue(timeline.turns.single().showReply)
        assertTrue(timeline.turns.single().hasReviews)
        assertFalse(timeline.empty)
        assertTrue(blank.empty)
        assertFalse(restoring.empty)
    }

    @Test
    fun `duplicate A2A revision hides numbered presentation and preserves archived outputs`() {
        val earlier = presentation(1, "earlier", "workflow", "first-reply")
        val duplicate = a2aResult(2, text = revisedProposal.replace("\n", "\r\n"))
        val completed = completedA2aTask()
        val outputs = listOf(earlier, duplicate)
        val state =
            twoTurns("run_a2a_workflow").copy(outputs = outputs, externalTasks = listOf(completed))

        val timeline =
            conversationTimelineModel(
                state,
                listOf(
                    LegacyWorkflowSurface("earlier", "workflow"),
                    LegacyWorkflowSurface("a2a-workflow-result", "workflow"),
                ),
            )

        assertEquals(listOf("earlier"), timeline.turns[0].previousSurfaceIds)
        assertTrue(timeline.turns.all { it.presentations.isEmpty() })
        assertTrue(timeline.turns.all { it.legacySurfaces.isEmpty() })
        assertEquals(listOf(completed), timeline.turns[0].tasks)
        assertTrue(timeline.standalonePresentations.isEmpty())
        assertSame(outputs, state.outputs)
        assertEquals(duplicate.messages, state.outputs.last().messages)
        assertFalse(timeline.empty)
    }

    @Test
    fun `duplicate A2A legacy surfaces are omitted from attached and standalone cards`() {
        val duplicate = a2aResult(1).copy(workflow = null)
        val surface = LegacyWorkflowSurface("a2a-workflow-result", "workflow")
        val state =
            twoTurns("run_a2a_workflow")
                .copy(outputs = listOf(duplicate), externalTasks = listOf(completedA2aTask()))

        val attached = conversationTimelineModel(state, listOf(surface))
        val standalone =
            conversationTimelineModel(
                state.copy(messages = emptyList(), runs = emptyList()),
                listOf(surface),
            )

        assertTrue(attached.turns.all { it.legacySurfaces.isEmpty() })
        assertTrue(standalone.standaloneLegacySurfaces.isEmpty())
        assertEquals(state.externalTasks, standalone.standaloneTasks)
        assertEquals(listOf(duplicate), state.outputs)
    }

    @Test
    fun `A2A compatibility keeps receipts and unmatched or malformed cards`() {
        val completed = completedA2aTask()
        val revision = completed.outputs.single()
        val standard = a2aResult(1)
        val cases =
            listOf(
                Triple("compact receipt", a2aResult(1, includeSteps = false), completed),
                Triple("unknown kind", standard, completed.copy(kind = null)),
                Triple("different kind", standard, completed.copy(kind = "report")),
                Triple("different workflow", standard, completed.copy(workflowCallId = "other")),
                Triple("different output owner", standard.copy(toolCallId = "other"), completed),
                Triple("missing output", standard, completed.copy(outputs = emptyList())),
                Triple(
                    "blank revision",
                    standard,
                    completed.copy(outputs = listOf(revision.copy(text = " \n"))),
                ),
                Triple(
                    "failed revision",
                    standard,
                    completed.copy(outputs = listOf(revision.copy(status = "failed"))),
                ),
                Triple(
                    "draft output",
                    standard,
                    completed.copy(outputs = listOf(revision.copy(step = "plan"))),
                ),
                Triple("different surface", a2aResult(1, surface = "other-result"), completed),
                Triple("different catalog", a2aResult(1, catalog = "other-catalog"), completed),
                Triple("different text", a2aResult(1, text = "Independent conclusion"), completed),
                Triple("missing steps", a2aResult(1, stepsType = "WorkflowPanel"), completed),
                Triple("wrong child type", a2aResult(1, textType = "WorkflowPanel"), completed),
                Triple("wrong child role", a2aResult(1, textRole = "body"), completed),
                Triple(
                    "non-string child id",
                    a2aResult(1, children = buildJsonArray { add(1) }),
                    completed,
                ),
                Triple(
                    "dynamic child text",
                    a2aResult(1, textValue = buildJsonObject { put("path", "/revision") }),
                    completed,
                ),
                Triple("malformed envelope", standard.copy(messages = JsonNull), completed),
            )

        for ((name, output, externalTask) in cases) {
            val state =
                twoTurns().copy(outputs = listOf(output), externalTasks = listOf(externalTask))
            val timeline = conversationTimelineModel(state, emptyList())
            val standalone =
                conversationTimelineModel(
                    state.copy(messages = emptyList(), runs = emptyList()),
                    emptyList(),
                )

            assertEquals(name, listOf(output), timeline.turns[1].presentations)
            assertEquals(name, listOf(output), standalone.standalonePresentations)
        }
    }

    @Test
    fun `feedback ownership survives omitted duplicate history`() {
        val first = presentation(1, "first", "workflow", "first-reply")
        val duplicate = a2aResult(2)
        val receipt = a2aResult(3, surface = "receipt", includeSteps = false)
        val outputs = listOf(first, duplicate, receipt)
        val state = twoTurns().copy(outputs = outputs, externalTasks = listOf(completedA2aTask()))

        val timeline = conversationTimelineModel(state, emptyList())

        assertEquals(listOf("first"), timeline.turns[0].previousSurfaceIds)
        assertTrue(timeline.turns[0].presentations.isEmpty())
        assertEquals(listOf(receipt), timeline.turns[1].presentations)
        assertTrue(timeline.turns[1].previousSurfaceIds.isEmpty())
        assertSame(outputs, state.outputs)
        assertEquals(listOf(first, duplicate, receipt), state.outputs)
    }

    @Test
    fun `compact A2A receipt replaces an archived duplicate with the same surface`() {
        val duplicate = a2aResult(1)
        val receipt =
            a2aResult(2, includeSteps = false).let { output ->
                output.copy(messages = buildJsonObject { put("messages", output.messages) })
            }
        val outputs = listOf(duplicate, receipt)
        val state = twoTurns().copy(outputs = outputs, externalTasks = listOf(completedA2aTask()))

        val timeline = conversationTimelineModel(state, emptyList())

        assertEquals(listOf(receipt), timeline.turns[1].presentations)
        assertTrue(timeline.turns[0].previousSurfaceIds.isEmpty())
        assertSame(outputs, state.outputs)
    }

    private fun twoTurns(tool: String = "run_sql_workflow") =
        SessionState(
            "thread",
            messages =
                listOf(
                    UserMessage("first-user", "Create a result"),
                    AssistantMessage(
                        "caller",
                        toolCalls = listOf(ToolCall("workflow", FunctionCall(tool, "{}"))),
                    ),
                    ToolMessage("tool-result", "Completed", "workflow"),
                    AssistantMessage("first-reply", "First result"),
                    UserMessage("feedback", "Revise it"),
                    AssistantMessage("latest-reply", "Revised result"),
                ),
            runs =
                listOf(
                    RunRecord("first-run", "first-user", "completed"),
                    RunRecord("second-run", "feedback", "completed"),
                ),
        )

    private fun presentation(sequence: Int, surface: String, call: String, anchor: String?) =
        WorkflowOutput(
            "output-$sequence",
            sequence,
            JsonArray(emptyList()),
            toolCallId = call,
            workflow = WorkflowMetadata(presentation = WorkflowPresentation(surface, call, anchor)),
        )

    private fun task(id: String, call: String) =
        ExternalTask(id, call, "Task", 1, "running", "work", "Working", history = emptyList())

    private val revisedProposal = "## Revised proposal\n\n| Owner | Action |\n| Ada | Prepare |\n"

    private fun completedA2aTask() =
        task("collaboration", "workflow")
            .copy(
                kind = "a2a",
                status = "succeeded",
                outputs =
                    listOf(
                        AgentOutput(
                            "Planner",
                            "revise",
                            "remote-revision",
                            "planner-context",
                            "succeeded",
                            revisedProposal,
                        )
                    ),
            )

    private fun a2aResult(
        sequence: Int,
        text: String = revisedProposal,
        surface: String = "a2a-workflow-result",
        catalog: String = "urn:agent-playground:workflow:v1",
        includeSteps: Boolean = true,
        stepsType: String = "WorkflowSteps",
        textType: String = "WorkflowText",
        textRole: String = "step",
        children: JsonArray? = null,
        textValue: JsonElement? = null,
    ): WorkflowOutput {
        val lines = text.split('\n')
        val components = buildJsonArray {
            addJsonObject {
                put("id", "root")
                put("component", "WorkflowPanel")
                putJsonArray("children") { add(if (includeSteps) "steps" else "body") }
            }

            if (includeSteps) {
                addJsonObject {
                    put("id", "steps")
                    put("component", stepsType)
                    put(
                        "children",
                        children ?: buildJsonArray { lines.indices.forEach { add("step-$it") } },
                    )
                }

                lines.forEachIndexed { index, line ->
                    addJsonObject {
                        put("id", "step-$index")
                        put("component", textType)
                        put("role", textRole)
                        put("text", textValue ?: JsonPrimitive(line))
                    }
                }
            } else {
                addJsonObject {
                    put("id", "body")
                    put("component", "WorkflowText")
                    put("role", "body")
                    put("text", "The full revision is available in the agent output.")
                }
            }
        }
        val messages = buildJsonArray {
            addJsonObject {
                put("version", "v0.9")
                putJsonObject("createSurface") {
                    put("surfaceId", surface)
                    put("catalogId", catalog)
                }
            }
            addJsonObject {
                put("version", "v0.9")
                putJsonObject("updateComponents") {
                    put("surfaceId", surface)
                    put("components", components)
                }
            }
        }

        return presentation(sequence, surface, "workflow", "latest-reply").copy(messages = messages)
    }

    private fun planReview(id: String, call: String? = null) =
        Interrupt(
            id,
            "human_approval",
            metadata =
                buildJsonObject {
                    putJsonObject("langgraph") {
                        putJsonObject("raw") {
                            put("kind", "experiment_plan_review")
                            put("title", "Plan")
                            putJsonArray("steps") { add("Step") }

                            if (call != null) {
                                put("workflowCallId", call)
                            }
                        }
                    }
                },
        )
}

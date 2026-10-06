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

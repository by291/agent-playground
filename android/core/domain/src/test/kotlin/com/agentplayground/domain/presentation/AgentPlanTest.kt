package com.agentplayground.domain.presentation

import com.agentplayground.domain.model.RunRecord
import com.agui.core.types.*
import org.junit.Assert.*
import org.junit.Test

class AgentPlanTest {
    @Test
    fun `latest executed valid replacement owns the plan and completed count`() {
        val first = step("first", """{"todos":[{"content":"Old task","status":"pending"}]}""")
        val latest = step("latest", planArguments)

        val plan = latestAgentPlan(listOf(first, latest))

        assertNotNull(plan)
        assertEquals(
            listOf("Inspect the request", "  Build the change  ", "Verify the result"),
            plan!!.items.map { it.content },
        )
        assertEquals(
            listOf(AgentPlanStatus.Completed, AgentPlanStatus.InProgress, AgentPlanStatus.Pending),
            plan.items.map { it.status },
        )
        assertEquals(1, plan.completedCount)
    }

    @Test
    fun `only committed matching successful write todos results can replace the plan`() {
        val committed = step("committed", planArguments)
        val update =
            step("update", """{"todos":[{"content":"Uncommitted","status":"completed"}]}""")
        val ignored =
            listOf(
                update.copy(
                    call =
                        update.call.copy(function = update.call.function.copy(name = "other_tool"))
                ),
                update.copy(result = null),
                update.copy(result = ToolMessage("wrong", "Updated", "other-call")),
                update.copy(
                    result = ToolMessage("failed", "Updated", "update", error = "Rejected")
                ),
                update.copy(status = ToolStatus.Failed),
                update.copy(status = ToolStatus.Paused),
                update.copy(status = ToolStatus.Running),
            )

        for (invalid in ignored) {
            val plan = latestAgentPlan(listOf(committed, invalid))

            assertEquals(invalid.toString(), "Inspect the request", plan?.items?.first()?.content)
            assertEquals(3, plan?.items?.size)
        }

        assertNull(latestAgentPlan(ignored))
    }

    @Test
    fun `malformed and partial arguments never partially replace a committed list`() {
        val committed = step("committed", planArguments)
        val malformed =
            listOf(
                "{",
                "[]",
                "{}",
                """{"todos":null}""",
                """{"todos":{}}""",
                """{"todos":[null]}""",
                """{"todos":[{"content":"Task"}]}""",
                """{"todos":[{"status":"pending"}]}""",
                """{"todos":[{"content":"Task","status":"unknown"}]}""",
                """{"todos":[{"content":12,"status":"pending"}]}""",
                """{"todos":[{"content":"Task","status":null}]}""",
                """{"todos":[{"content":" \n ","status":"pending"}]}""",
                """{"todos":[{"content":"Valid task","status":"completed"},{"content":"Invalid task","status":"started"}]}""",
            )

        for ((index, arguments) in malformed.withIndex()) {
            val plan = latestAgentPlan(listOf(committed, step("invalid-$index", arguments)))

            assertEquals(arguments, 3, plan?.items?.size)
            assertEquals(arguments, "Inspect the request", plan?.items?.first()?.content)
        }

        assertNull(latestAgentPlan(listOf(step("invalid", "{"))))
    }

    @Test
    fun `successful empty list clears prior plan but a pending or malformed clear cannot`() {
        val committed = step("committed", planArguments)
        val clear = step("clear", """{"todos":[]}""")

        assertNotNull(latestAgentPlan(listOf(committed, clear.copy(result = null))))
        assertNotNull(latestAgentPlan(listOf(committed, step("invalid", """{"todos":null}"""))))
        assertNull(latestAgentPlan(listOf(committed, clear)))
        assertNull(latestAgentPlan(emptyList()))
    }

    @Test
    fun `restored plans stay with their originating turn when results arrive after feedback`() {
        val original = step("original", planArguments)
        val feedback =
            step("feedback", """{"todos":[{"content":"Follow up","status":"pending"}]}""")
        val messages =
            listOf(
                UserMessage("first-user", "Start"),
                AssistantMessage("original-call", toolCalls = listOf(original.call)),
                UserMessage("feedback-user", "Continue"),
                AssistantMessage("feedback-call", toolCalls = listOf(feedback.call)),
                original.result!!,
                feedback.result!!,
            )

        for (status in listOf("running", "interrupted", "failed", "completed")) {
            val turns =
                conversationTurns(
                    messages,
                    listOf(
                        RunRecord("original-run", "first-user", "interrupted"),
                        RunRecord("feedback-run", "feedback-user", status),
                    ),
                )
            val originalPlan = latestAgentPlan(turns.first().toolCalls)
            val feedbackPlan = latestAgentPlan(turns.last().toolCalls)

            assertEquals(3, originalPlan?.items?.size)
            assertEquals(1, originalPlan?.completedCount)
            assertEquals(AgentPlanStatus.InProgress, originalPlan?.items?.get(1)?.status)
            assertEquals(listOf("Follow up"), feedbackPlan?.items?.map { it.content })
            assertEquals(0, feedbackPlan?.completedCount)
        }
    }

    private fun step(id: String, arguments: String) =
        ToolStep(
            ToolCall(id, FunctionCall("write_todos", arguments)),
            ToolMessage("result-$id", "Updated todo list", id),
            ToolStatus.Completed,
        )

    private val planArguments =
        """{"todos":[{"content":"Inspect the request","status":"completed"},{"content":"  Build the change  ","status":"in_progress"},{"content":"Verify the result","status":"pending"}]}"""
}

package com.agentplayground.core.presentation

import com.agentplayground.core.model.RunRecord
import com.agentplayground.core.model.reasoningMessage
import com.agui.core.types.*
import org.junit.Assert.*
import org.junit.Test

class ConversationPresentationTest {
    private fun call(id: String, name: String = "search_knowledge", arguments: String = "{}") =
        ToolCall(id, FunctionCall(name, arguments))

    private fun caller(vararg calls: ToolCall) =
        AssistantMessage("caller", toolCalls = calls.toList())

    @Test
    fun `late tool results remain with original turn through feedback and resume`() {
        val turns =
            conversationTurns(
                listOf(
                    UserMessage("first", "Start"),
                    caller(call("original")),
                    UserMessage("feedback", "Continue"),
                    ToolMessage("result", "Done", "original"),
                ),
                listOf(
                    RunRecord("run", "first", "interrupted"),
                    RunRecord("feedback-run", "feedback", "running"),
                    RunRecord("resume", null, "completed"),
                ),
            )

        assertEquals(listOf("caller", "result"), turns.first().messages.map { it.id })
        assertEquals("completed", turns.last().status)
        assertEquals(ToolStatus.Completed, turns.first().toolCalls.single().status)
    }

    @Test
    fun `tool status reflects waiting paused active failed and missing results`() {
        val messages = listOf(UserMessage("user", "Start"), caller(call("wait"), call("pause")))

        fun statuses(status: String) =
            conversationTurns(messages, listOf(RunRecord("run", "user", status)), setOf("wait"))
                .single()
                .toolCalls
                .map { it.status }

        assertEquals(listOf(ToolStatus.Waiting, ToolStatus.Paused), statuses("interrupted"))
        assertEquals(listOf(ToolStatus.Running, ToolStatus.Running), statuses("submission_unknown"))
        assertEquals(listOf(ToolStatus.Failed, ToolStatus.Failed), statuses("failed"))
        assertEquals(listOf(ToolStatus.Unavailable, ToolStatus.Unavailable), statuses("completed"))

        val failed =
            conversationTurns(
                    messages + ToolMessage("error", "{}", "wait", error = "Unavailable"),
                    emptyList(),
                )
                .single()

        assertEquals(ToolStatus.Failed, failed.toolCalls.first().status)
    }

    @Test
    fun `live status owns fresh turn before canonical runs snapshot arrives`() {
        val messages =
            listOf(
                UserMessage("prior", "Old"),
                UserMessage("fresh", "Start"),
                caller(call("wait"), call("pause")),
            )
        val runs = listOf(RunRecord("old-run", "prior", "completed"))

        val active = conversationTurns(messages, runs, latestStatus = "running")

        assertEquals("completed", active.first().status)
        assertEquals("running", active.last().status)
        assertEquals(
            listOf(ToolStatus.Running, ToolStatus.Running),
            active.last().toolCalls.map { it.status },
        )

        val interrupted =
            conversationTurns(messages, runs, setOf("wait"), latestStatus = "interrupted")

        assertEquals(
            listOf(ToolStatus.Waiting, ToolStatus.Paused),
            interrupted.last().toolCalls.map { it.status },
        )
    }

    @Test
    fun `ordinary tools share one group across assistant messages within their own turn`() {
        val turns =
            conversationTurns(
                listOf(
                    UserMessage("first", "Calculate and search"),
                    caller(call("sum-one", "calculate_sum"), call("sum-two", "calculate_sum")),
                    ToolMessage("one-result", "2", "sum-one"),
                    ToolMessage("two-result", "4", "sum-two"),
                    AssistantMessage("follow-up", toolCalls = listOf(call("search"))),
                    ToolMessage("search-result", "Found", "search"),
                    UserMessage("second", "Search again"),
                    AssistantMessage("next", toolCalls = listOf(call("next-search"))),
                ),
                emptyList(),
            )
        val group = executionGroups(turns.first().toolCalls).single()

        assertNull(group.skill)
        assertEquals(listOf("sum-one", "sum-two", "search"), group.steps.map { it.call.id })
        assertEquals(listOf("2", "4", "Found"), group.steps.map { it.result?.content })
        assertEquals(
            listOf("next-search"),
            executionGroups(turns.last().toolCalls).single().steps.map { it.call.id },
        )
    }

    @Test
    fun `ordinary tools remain grouped separately from each named skill`() {
        val steps =
            listOf(
                    call("search"),
                    call("reports-load", "load_skill", """{"skill_name":"reports"}"""),
                    call("sum", "calculate_sum"),
                    call("review-load", "load_skill", """{"skill_name":"review"}"""),
                    call("reports-run", "run_skill_script", """{"skill_name":"reports"}"""),
                )
                .map { ToolStep(it, null, ToolStatus.Running) }

        val groups = executionGroups(steps)

        assertEquals(3, groups.size)
        assertEquals(
            listOf("search", "sum"),
            groups.single { it.skill == null }.steps.map { it.call.id },
        )
        assertEquals(
            listOf("reports-load", "reports-run"),
            groups.single { it.skill?.name == "reports" }.steps.map { it.call.id },
        )
        assertEquals(
            listOf("review-load"),
            groups.single { it.skill?.name == "review" }.steps.map { it.call.id },
        )
    }

    @Test
    fun `memory operations form a distinct group beside tools and a skill named Memory`() {
        val steps =
            listOf(
                    call("search", "search_memory", "{"),
                    call("clock", "get_current_time"),
                    call("remember", "remember_memory"),
                    call("skill", "load_skill", """{"skill_name":"Memory"}"""),
                    call("forget", "forget_memory"),
                )
                .map { ToolStep(it, null, ToolStatus.Running) }

        val groups = executionGroups(steps)

        assertEquals(3, groups.size)
        assertEquals(
            listOf("search", "remember", "forget"),
            groups
                .single { it.steps.any { step -> step.call.id == "search" } }
                .steps
                .map { it.call.id },
        )
        assertEquals(
            listOf("clock"),
            groups
                .single { it.steps.any { step -> step.call.id == "clock" } }
                .steps
                .map { it.call.id },
        )
        assertEquals("Memory", groups.single { it.skill != null }.skill?.name)
    }

    @Test
    fun `skill groups retain paths and output files deduplicate by file identity`() {
        val load = call("load", "load_skill", """{"skill_name":"reports"}""")
        val script =
            call(
                "script",
                "run_skill_script",
                """{"skill_name":"reports","script_path":"scripts/report.py"}""",
            )
        val result =
            """{"kind":"skill_script_result","files":[{"id":"file","threadId":"thread","name":"report.csv","size":1234},{"id":"file","threadId":"thread","name":"report.csv","size":1234}]}"""
        val steps =
            listOf(
                ToolStep(load, null, ToolStatus.Completed),
                ToolStep(script, ToolMessage("result", result, "script"), ToolStatus.Completed),
            )

        assertEquals(1, executionGroups(steps).size)
        assertEquals("scripts/report.py", skillIdentity(steps.last())?.path)
        assertEquals(1234L, skillFiles(steps).single().size)
        assertEquals(
            "Loading…",
            skillIdentity(ToolStep(call("partial", "load_skill", "{"), null, ToolStatus.Running))
                ?.name,
        )
    }

    @Test
    fun `source citations are exact deduplicated and scoped to their reply`() {
        val chunk = "11111111-1111-4111-8111-111111111111"
        val doc = "22222222-2222-4222-8222-222222222222"
        val source =
            """{"chunkId":"$chunk","documentId":"$doc","name":"Guide","page":2,"excerpt":"Use receipts."}"""
        val result =
            """{"kind":"knowledge_search_result","sources":[$source,$source],"error":null}"""
        val sources =
            replySources(
                listOf(
                    ToolStep(
                        call("search"),
                        ToolMessage("result", result, "search"),
                        ToolStatus.Completed,
                    )
                )
            )

        assertEquals(1, sources.sources.size)
        assertEquals(1, sources.documents.size)
        assertEquals("Use receipts.", sources.citation("#knowledge-source-$chunk")?.excerpt)
        assertNull(sources.citation("#knowledge-source-$chunk?extra"))
        assertNull(ReplySources().citation("#knowledge-source-$chunk"))
    }

    @Test
    fun `reasoning choices survive snapshot identity changes until rendered answer phase`() {
        val live =
            listOf(reasoningMessage("live", "Compare."), AssistantMessage("answer", "```kotlin"))
        val restored =
            listOf(
                reasoningMessage("snapshot", "Compare."),
                AssistantMessage("snapshot-answer", "```kotlin"),
            )
        val fold = ReasoningFold(reasoningPhase(live, false), false)

        assertEquals(fold, fold.update(reasoningPhase(restored, false), true))

        val answered = fold.update(reasoningPhase(restored, true), false)

        assertFalse(answered.open)

        val userOpened = answered.copy(open = true)

        assertTrue(userOpened.update(reasoningPhase(restored, true), false).open)
    }

    @Test
    fun `legacy stages show latest result and hide duplicate review editor card`() {
        val calls = listOf(call("experiment", "run_experiment_workflow"))
        val stages =
            listOf("idea", "draft", "review").map {
                LegacyWorkflowSurface("experiment-experiment-$it", "experiment")
            }

        val reviewing = legacyWorkflowArtifacts(calls, stages, setOf("experiment"))

        assertTrue(reviewing.current.isEmpty())
        assertEquals(3, reviewing.history.size)

        val completed =
            legacyWorkflowArtifacts(
                calls,
                stages + LegacyWorkflowSurface("experiment-experiment-reviewed", "experiment"),
                setOf("experiment"),
            )

        assertEquals("experiment-experiment-reviewed", completed.current.single().id)
        assertEquals(setOf("experiment"), completed.completedCallIds)
    }
}

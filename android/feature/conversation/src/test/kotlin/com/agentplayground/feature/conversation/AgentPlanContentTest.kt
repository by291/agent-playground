package com.agentplayground.feature.conversation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.agentplayground.design.PlaygroundTheme
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.RunRecord
import com.agentplayground.domain.presentation.ConversationTurn
import com.agentplayground.domain.presentation.conversationTurns
import com.agentplayground.feature.conversation.ui.timeline.AssistantTurnContent
import com.agui.core.types.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w412dp-h892dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AgentPlanContentTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `latest committed plan appears above intact execution details`() {
        val first = call("first", """{"todos":[{"content":"Old task","status":"pending"}]}""")
        val latest = call("latest", planArguments)
        val turn = turn(listOf(first, latest), listOf(result(first), result(latest)), "running")

        render { turn }

        compose.onAllNodesWithText("Agent plan").assertCountEquals(1)
        compose.onNodeWithText("1 of 3 completed").assertIsDisplayed()
        compose.onNodeWithText("Old task").assertDoesNotExist()
        compose.onNodeWithText("Inspect the request").assertIsDisplayed()
        compose
            .onNode(hasText("Completed") and hasAnyAncestor(hasTestTag("agent-plan-user")))
            .assertExists()
        compose.onNodeWithText("In progress").assertIsDisplayed()
        compose.onNodeWithText("Pending").assertIsDisplayed()
        compose.onNodeWithText("Inspect the request").assertHasNoClickAction()

        val plan = compose.onNodeWithTag("agent-plan-user").getUnclippedBoundsInRoot()
        val details = compose.onNodeWithTag("tool-group-first").getUnclippedBoundsInRoot()
        assertTrue(plan.bottom <= details.top)

        compose.onNodeWithTag("tool-group-first").performClick()
        compose.onNodeWithTag("tool-step-first").assertExists()
        compose.onNodeWithTag("tool-step-latest").assertExists()
    }

    @Test
    fun `pending updates retain committed plan and an executed empty list removes it`() {
        val committed = call("committed", planArguments)
        val pending =
            call("pending", """{"todos":[{"content":"Uncommitted","status":"pending"}]}""")
        var current by mutableStateOf(turn(listOf(committed), listOf(result(committed))))

        render { current }
        compose.onNodeWithText("1 of 3 completed").assertIsDisplayed()

        compose.runOnIdle {
            current = turn(listOf(committed, pending), listOf(result(committed)))
        }

        compose.onNodeWithText("1 of 3 completed").assertIsDisplayed()
        compose.onNodeWithText("Uncommitted").assertDoesNotExist()

        compose.runOnIdle {
            val clear = call("clear", """{"todos":[]}""")
            current = turn(listOf(committed, clear), listOf(result(committed), result(clear)))
        }

        compose.onNodeWithText("Agent plan").assertDoesNotExist()
        compose.onNodeWithTag("tool-group-committed").assertExists()
    }

    @Test
    fun `active runs show the in progress task label`() {
        val plan = call("plan", planArguments)
        var current by mutableStateOf(turn(listOf(plan), listOf(result(plan)), "running"))

        render { current }

        for (status in listOf("prepared", "dispatching", "running", "submission_unknown")) {
            compose.runOnIdle { current = turn(listOf(plan), listOf(result(plan)), status) }

            compose.onNodeWithText("1 of 3 completed").assertIsDisplayed()
            compose.onNodeWithText("In progress").assertIsDisplayed()
            compose.onNodeWithText("Paused").assertDoesNotExist()
            compose.onNodeWithText("Not completed").assertDoesNotExist()
        }
    }

    @Test
    fun `interrupted runs label the in progress task as paused without completing it`() {
        val plan = call("plan", planArguments)
        var current by mutableStateOf(turn(listOf(plan), listOf(result(plan)), "running"))

        render { current }

        compose.runOnIdle { current = turn(listOf(plan), listOf(result(plan)), "interrupted") }

        compose.onNodeWithText("1 of 3 completed").assertIsDisplayed()
        compose.onNodeWithText("Paused").assertIsDisplayed()
        compose.onNodeWithText("In progress").assertDoesNotExist()
        compose.onNodeWithText("Pending").assertIsDisplayed()
        compose
            .onNode(hasText("Completed") and hasAnyAncestor(hasTestTag("agent-plan-user")))
            .assertExists()
        compose
            .onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo))
            .assertCountEquals(0)

        compose.runOnIdle { current = turn(listOf(plan), listOf(result(plan)), "running") }

        compose.onNodeWithText("In progress").assertIsDisplayed()
        compose.onNodeWithText("Paused").assertDoesNotExist()
    }

    @Test
    fun `settled or missing runs label the in progress task as not completed`() {
        val plan = call("plan", planArguments)
        var current by mutableStateOf(turn(listOf(plan), listOf(result(plan)), "running"))

        render { current }

        for (status in listOf("failed", "completed", "cancelled", null)) {
            compose.runOnIdle { current = turn(listOf(plan), listOf(result(plan)), status) }

            compose.onNodeWithText("1 of 3 completed").assertIsDisplayed()
            compose.onNodeWithText("Not completed").assertIsDisplayed()
            compose.onNodeWithText("In progress").assertDoesNotExist()
            compose.onNodeWithText("Pending").assertIsDisplayed()
            compose
                .onNode(hasText("Completed") and hasAnyAncestor(hasTestTag("agent-plan-user")))
                .assertExists()
            compose
                .onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo))
                .assertCountEquals(0)
        }
    }

    @Test
    fun `plan task text wraps at large font scale in both themes`() {
        val content =
            "Inspect the complete conversation history and verify each required boundary before continuing"
        val plan = call("plan", """{"todos":[{"content":"$content","status":"in_progress"}]}""")
        val current = turn(listOf(plan), listOf(result(plan)), "running")
        var theme by mutableStateOf("light")

        compose.setContent {
            PlaygroundTheme(theme) {
                val density = LocalDensity.current

                CompositionLocalProvider(LocalDensity provides Density(density.density, 1.8f)) {
                    Column(Modifier.width(280.dp).verticalScroll(rememberScrollState())) {
                        Reply(current)
                    }
                }
            }
        }

        for (mode in listOf("light", "dark")) {
            compose.runOnIdle { theme = mode }

            val layouts = mutableListOf<TextLayoutResult>()
            val text = compose.onNodeWithText(content).fetchSemanticsNode()
            text.config[SemanticsActions.GetTextLayoutResult].action!!.invoke(layouts)

            assertTrue(layouts.single().lineCount > 1)
            assertFalse(layouts.single().didOverflowWidth)
            assertFalse(layouts.single().didOverflowHeight)
            compose.onNodeWithText("In progress").assertExists()
        }
    }

    private fun render(current: () -> ConversationTurn) {
        compose.setContent {
            PlaygroundTheme("light") {
                Column(Modifier.verticalScroll(rememberScrollState())) { Reply(current()) }
            }
        }
    }

    @Composable
    private fun Reply(turn: ConversationTurn) {
        AssistantTurnContent(
            turn,
            { Download("/file/${it.id}", it.name) },
            { id, name -> Download("/document/$id", name) },
            {},
            {},
        )
    }

    private fun call(id: String, arguments: String) =
        ToolCall(id, FunctionCall("write_todos", arguments))

    private fun result(call: ToolCall) =
        ToolMessage("result-${call.id}", "Updated todo list", call.id)

    private fun turn(
        calls: List<ToolCall>,
        results: List<ToolMessage>,
        status: String? = "completed",
    ) =
        conversationTurns(
                listOf(
                    UserMessage("user", "Complete this task"),
                    AssistantMessage("assistant", toolCalls = calls),
                ) + results,
                status?.let { listOf(RunRecord("run", "user", it)) } ?: emptyList(),
            )
            .single()

    private val planArguments =
        """{"todos":[{"content":"Inspect the request","status":"completed"},{"content":"Build the change","status":"in_progress"},{"content":"Verify the result","status":"pending"}]}"""
}

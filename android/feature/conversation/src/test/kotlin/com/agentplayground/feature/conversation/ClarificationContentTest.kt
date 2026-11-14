package com.agentplayground.feature.conversation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
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
class ClarificationContentTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `pending clarification is plain assistant conversation without technical tool rows`() {
        val ask = call("ask")
        val current =
            turn(
                listOf(AssistantMessage("intro", "I need one detail", toolCalls = listOf(ask))),
                "interrupted",
            )

        render { current }

        compose.onNodeWithText("I need one detail").assertIsDisplayed()
        compose.onNodeWithText("**Choose an approach**").assertIsDisplayed()
        compose.onNodeWithText("Waiting for your answer").assertIsDisplayed()
        compose.onNodeWithTag("clarification-answer-ask").assertDoesNotExist()
        compose.onNodeWithTag("tool-group-ask").assertDoesNotExist()
        compose.onNodeWithText("ask_user").assertDoesNotExist()
        compose.onNodeWithText("Tool").assertDoesNotExist()
        compose.onNodeWithText(ask.function.arguments).assertDoesNotExist()
    }

    @Test
    fun `successive exchanges stay interleaved and ordinary tools retain their details`() {
        val first = call("first")
        val second = call("second", "scope", "What is the scope?")
        val ordinary = ToolCall("sum", FunctionCall("calculate_sum", "{}"))
        val current =
            turn(
                listOf(
                    AssistantMessage("intro", "First context", toolCalls = listOf(first, ordinary)),
                    ToolMessage("sum-result", "2", "sum"),
                    result(first),
                    AssistantMessage("follow", "Second context", toolCalls = listOf(second)),
                    result(second, "scope", "Only the client"),
                    AssistantMessage("final", "Ready to proceed"),
                )
            )

        render { current }

        compose.onNodeWithTag("tool-group-sum").assertExists()
        compose.onNodeWithTag("tool-group-first").assertDoesNotExist()
        compose.onNodeWithTag("tool-group-second").assertDoesNotExist()
        val intro = compose.onNodeWithText("First context").getUnclippedBoundsInRoot()
        val question =
            compose.onNodeWithTag("clarification-question-first").getUnclippedBoundsInRoot()
        val answer = compose.onNodeWithTag("clarification-answer-first").getUnclippedBoundsInRoot()
        val follow = compose.onNodeWithText("Second context").getUnclippedBoundsInRoot()
        val secondQuestion =
            compose.onNodeWithTag("clarification-question-second").getUnclippedBoundsInRoot()
        val secondAnswer =
            compose.onNodeWithTag("clarification-answer-second").getUnclippedBoundsInRoot()
        val final = compose.onNodeWithText("Ready to proceed").getUnclippedBoundsInRoot()
        assertTrue(intro.bottom <= question.top)
        assertTrue(question.bottom <= answer.top)
        assertTrue(answer.bottom <= follow.top)
        assertTrue(follow.bottom <= secondQuestion.top)
        assertTrue(secondQuestion.bottom <= secondAnswer.top)
        assertTrue(secondAnswer.bottom <= final.top)
        assertTrue(answer.left > 0.dp)
        compose.onNodeWithText("Fast").assertExists()
        compose.onNodeWithText("Only the client").assertExists()
    }

    @Test
    fun `recovery projects one human bubble with each question beside its committed answer`() {
        val ask =
            ToolCall(
                "ask",
                FunctionCall(
                    "ask_user",
                    """{"questions":[{"id":"goal","question":"First question?"},{"id":"scope","question":"Second question?"}]}""",
                ),
            )
        val caller = AssistantMessage("caller", toolCalls = listOf(ask))
        var current by mutableStateOf(turn(listOf(caller), "interrupted"))

        render { current }
        compose.onNodeWithTag("clarification-answer-ask").assertDoesNotExist()
        val response =
            ToolMessage(
                "response",
                """{"answers":[{"id":"goal","answer":"Suggested answer"},{"id":"scope","answer":"Custom answer"}]}""",
                "ask",
            )
        compose.runOnIdle { current = turn(listOf(caller, response)) }

        compose.onAllNodesWithTag("clarification-answer-ask").assertCountEquals(1)
        compose
            .onNode(
                hasText("First question?") and
                    hasAnyAncestor(hasTestTag("clarification-answer-ask"))
            )
            .assertExists()
        compose
            .onNode(
                hasText("Second question?") and
                    hasAnyAncestor(hasTestTag("clarification-answer-ask"))
            )
            .assertExists()
        compose.onNodeWithText("Suggested answer").assertIsDisplayed()
        compose.onNodeWithText("Custom answer").assertIsDisplayed()
        compose.runOnIdle {
            current =
                turn(
                    listOf(
                        caller.copy(id = "restored-caller"),
                        response.copy(id = "restored-response"),
                    )
                )
        }

        compose.onAllNodesWithTag("clarification-answer-ask").assertCountEquals(1)
        compose.onAllNodesWithText("First question?").assertCountEquals(2)
        compose.onNodeWithText(response.content).assertDoesNotExist()
    }

    @Test
    fun `malformed pending asks remain legible without raw technical payloads`() {
        val ask = ToolCall("ask", FunctionCall("ask_user", "{\"questions\":"))
        var current by
            mutableStateOf(
                turn(listOf(AssistantMessage("ask", toolCalls = listOf(ask))), "interrupted")
            )

        render { current }

        compose.onNodeWithText("Preparing a question…").assertIsDisplayed()
        compose.onNodeWithText("ask_user").assertDoesNotExist()
        compose.onNodeWithText(ask.function.arguments).assertDoesNotExist()
        compose.onNodeWithTag("tool-group-ask").assertDoesNotExist()
        compose.runOnIdle {
            current = turn(listOf(AssistantMessage("ask", toolCalls = listOf(ask)), result(ask)))
        }

        compose.onNodeWithText("Question unavailable").assertIsDisplayed()
        compose.onNodeWithTag("clarification-answer-ask").assertDoesNotExist()
    }

    @Test
    fun `declined and failed asks never display generic tool errors as human answers`() {
        val ask = call("ask")
        val caller = AssistantMessage("ask", toolCalls = listOf(ask))
        val rejection = "User rejected the tool call for `ask_user` with reason: Private reason"
        var current by
            mutableStateOf(
                turn(listOf(caller, ToolMessage("rejected", rejection, "ask", error = rejection)))
            )

        render { current }

        compose.onNodeWithText("Question skipped").assertIsDisplayed()
        compose.onNodeWithText(rejection).assertDoesNotExist()
        compose.onNodeWithTag("clarification-answer-ask").assertDoesNotExist()
        compose.runOnIdle {
            current =
                turn(
                    listOf(
                        caller,
                        ToolMessage("failed", "Raw execution trace", "ask", error = "Failure"),
                    )
                )
        }

        compose.onNodeWithText("Question could not be completed").assertIsDisplayed()
        compose.onNodeWithText("Raw execution trace").assertDoesNotExist()
        compose.onNodeWithTag("clarification-answer-ask").assertDoesNotExist()
    }

    private fun render(current: () -> ConversationTurn) {
        compose.setContent {
            PlaygroundTheme("light") {
                Column(Modifier.width(412.dp).verticalScroll(rememberScrollState())) {
                    AssistantTurnContent(
                        current(),
                        { Download("/files/${it.id}", it.name) },
                        { id, name -> Download("/documents/$id", name) },
                        {},
                        {},
                    )
                }
            }
        }
    }

    private fun turn(messages: List<Message>, status: String = "completed") =
        conversationTurns(
                listOf(UserMessage("user", "Start")) + messages,
                listOf(RunRecord("run", "user", status)),
            )
            .single()

    private fun call(
        id: String,
        questionId: String = "goal",
        question: String = "**Choose an approach**",
    ) =
        ToolCall(
            id,
            FunctionCall(
                "ask_user",
                """{"questions":[{"id":"$questionId","question":"$question"}]}""",
            ),
        )

    private fun result(call: ToolCall, questionId: String = "goal", answer: String = "Fast") =
        ToolMessage(
            "result-${call.id}",
            """{"answers":[{"id":"$questionId","answer":"$answer"}]}""",
            call.id,
        )
}

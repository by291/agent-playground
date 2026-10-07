package com.agentplayground.app

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import com.agentplayground.app.features.conversation.TimelineNotices
import com.agentplayground.core.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ConversationProgressTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `completed child stages show normal workflow continuation until the final reply arrives`() {
        var state by mutableStateOf(continuing("prepared"))

        compose.setContent {
            MaterialTheme { TimelineNotices(state, emptyList(), true, {}) }
        }

        for (status in listOf("prepared", "dispatching", "running")) {
            compose.runOnIdle { state = continuing(status) }

            compose.onNodeWithText("Agent is completing the workflow…").assertExists()
            compose.onNodeWithText("Recovering agent progress…").assertDoesNotExist()
        }

        compose.runOnIdle {
            state = continuing("completed").copy(busy = false)
        }

        compose.onNodeWithText("Agent is completing the workflow…").assertDoesNotExist()
        compose.onNodeWithText("Recovering agent progress…").assertDoesNotExist()
    }

    @Test
    fun `healthy observed server execution is working even without a direct output stream`() {
        val state =
            SessionState("thread", busy = true, runs = listOf(RunRecord("run", status = "running")))

        compose.setContent {
            MaterialTheme { TimelineNotices(state, emptyList(), true, {}) }
        }

        compose.onNodeWithText("Agent is working…").assertExists()
        compose.onNodeWithText("Recovering agent progress…").assertDoesNotExist()
    }

    @Test
    fun `direct response and healthy stream settlement do not imply recovery`() {
        var state by mutableStateOf(SessionState("thread", busy = true, streaming = true))

        compose.setContent {
            MaterialTheme { TimelineNotices(state, emptyList(), true, {}) }
        }

        compose.onNodeWithText("Agent is responding…").assertExists()

        compose.runOnIdle { state = state.copy(streaming = false) }

        compose.onNodeWithText("Agent is working…").assertExists()
        compose.onNodeWithText("Recovering agent progress…").assertDoesNotExist()
    }

    @Test
    fun `missing output uncertain admission and connection errors retain recovery feedback`() {
        val base = SessionState("thread", busy = true)
        var state by mutableStateOf(base.copy(missingOutputSequence = 2))

        compose.setContent {
            MaterialTheme {
                TimelineNotices(state, listOfNotNull(state.error, state.outputError), true, {})
            }
        }

        for (recovering in
            listOf(
                base.copy(missingOutputSequence = 2),
                base.copy(runs = listOf(RunRecord("run", status = "submission_unknown"))),
                base.copy(error = "Connection interrupted"),
                continuing("running").copy(outputError = "Invalid workflow output"),
            )) {
            compose.runOnIdle { state = recovering }

            compose.onNodeWithText("Recovering agent progress…").assertExists()
            compose.onNodeWithText("Agent is completing the workflow…").assertDoesNotExist()
        }
    }

    private fun continuing(status: String) =
        SessionState(
            "thread",
            busy = true,
            runs =
                listOf(
                    RunRecord("original", status = "interrupted"),
                    RunRecord("continuation", status = status),
                ),
            externalTasks =
                listOf(
                    ExternalTask(
                        "task",
                        "call",
                        "A2A collaboration",
                        4,
                        "succeeded",
                        "done",
                        "Completed",
                        history = emptyList(),
                        kind = "a2a",
                        continuationStatus = status,
                        outputs =
                            listOf("plan", "review", "revise").map { step ->
                                AgentOutput(
                                    if (step == "review") "Reviewer" else "Planner",
                                    step,
                                    step,
                                    "context",
                                    "succeeded",
                                    "Complete $step",
                                )
                            },
                    )
                ),
        )
}

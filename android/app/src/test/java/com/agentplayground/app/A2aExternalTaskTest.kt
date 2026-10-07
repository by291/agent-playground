package com.agentplayground.app

import android.text.Spanned
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import com.agentplayground.app.data.AppPreferences
import com.agentplayground.app.design.PlaygroundTheme
import com.agentplayground.app.features.conversation.ConversationTimeline
import com.agentplayground.app.features.conversation.ExternalTaskPanel
import com.agentplayground.app.files.Download
import com.agentplayground.core.*
import com.agui.core.types.AssistantMessage
import com.agui.core.types.FunctionCall
import com.agui.core.types.ToolCall
import io.noties.markwon.core.spans.StrongEmphasisSpan
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
class A2aExternalTaskTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `input and cancellation dispatch the task identity and disable together while pending`() {
        var control by mutableStateOf(ExternalTaskControl())
        var input: Pair<String, String>? = null
        var cancelled: String? = null

        compose.setContent {
            PlaygroundTheme("light") {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    ExternalTaskPanel(
                        task("input_required"),
                        control = control,
                        onSubmitInput = { id, value -> input = id to value },
                        onCancel = { cancelled = it },
                    )
                }
            }
        }

        compose.onNodeWithText("Continue agents").assertIsNotEnabled()
        compose.onNodeWithText("Additional information").performTextReplacement("  Last quarter  ")
        compose.onNodeWithText("Continue agents").performScrollTo().performClick()
        compose.onNodeWithText("Cancel agents").performScrollTo().performClick()

        assertEquals("job-1" to "Last quarter", input)
        assertEquals("job-1", cancelled)

        compose.runOnIdle { control = ExternalTaskControl(pending = ExternalTaskAction.Input) }

        compose.onNodeWithText("Continue agents").assertIsNotEnabled()
        compose.onNodeWithText("Cancel agents").assertIsNotEnabled()
        compose.onNodeWithText("Additional information").assertIsNotEnabled()

        compose.runOnIdle {
            control = ExternalTaskControl(error = "The coordinator is temporarily unavailable.")
        }

        compose.onNodeWithText("Continue agents").assertIsEnabled()
        compose.onNodeWithText("Cancel agents").assertIsEnabled()
        compose.onNodeWithText("The coordinator is temporarily unavailable.").assertExists()
    }

    @Test
    fun `input accepts the backend boundary and rejects blank or oversized drafts`() {
        var submitted: String? = null

        compose.setContent {
            PlaygroundTheme("light") {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    ExternalTaskPanel(
                        task("input_required"),
                        onSubmitInput = { _, input -> submitted = input },
                    )
                }
            }
        }

        val input = compose.onNodeWithText("Additional information")

        input.performTextReplacement("   ")
        compose.onNodeWithText("Continue agents").assertIsNotEnabled()
        input.performTextReplacement("a".repeat(4001))
        compose.onNodeWithText("Continue agents").assertIsNotEnabled()
        input.performTextReplacement("a".repeat(4000))
        compose.onNodeWithText("Continue agents").performScrollTo().performClick()

        assertEquals("a".repeat(4000), submitted)
    }

    @Test
    fun `controls follow A2A statuses and leave generic task behavior unchanged`() {
        var current by mutableStateOf(task("queued"))

        compose.setContent {
            PlaygroundTheme("light") {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    ExternalTaskPanel(current)
                }
            }
        }

        listOf("queued", "running", "input_required").forEach { status ->
            compose.runOnIdle { current = current.copy(status = status) }

            compose.onNodeWithText("Cancel agents").assertExists()

            if (status == "input_required") {
                compose.onNodeWithText("Additional information").assertExists()
            } else {
                compose.onNodeWithText("Additional information").assertDoesNotExist()
            }
        }

        listOf("succeeded", "failed", "cancelled").forEach { status ->
            compose.runOnIdle { current = current.copy(status = status) }

            compose.onNodeWithText("Cancel agents").assertDoesNotExist()
            compose.onNodeWithText("Additional information").assertDoesNotExist()
        }

        compose.runOnIdle { current = current.copy(kind = null, status = "running") }

        compose.onNodeWithText("Cancel agents").assertDoesNotExist()
        compose.onNodeWithText("1. Draft · Planner").assertDoesNotExist()
        compose.onNodeWithText("Task history").assertExists()
    }

    @Test
    fun `streamed snapshots replace rendered Markdown while showing all handoff purposes`() {
        var current by
            mutableStateOf(task(outputs = listOf(output("plan", "running", "**First draft**"))))

        compose.setContent {
            PlaygroundTheme("light") {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    ExternalTaskPanel(current)
                }
            }
        }

        compose.onNodeWithText("Coordinator → Planner").assertExists()
        compose.onNodeWithText("Planner → Reviewer").assertExists()
        compose.onNodeWithText("Reviewer → Planner").assertExists()
        compose.onNodeWithText("Create the first draft.").assertExists()
        compose.onNodeWithText("Review Planner's draft.").assertExists()
        compose.onNodeWithText("Revise using Reviewer's feedback.").assertExists()
        compose.runOnIdle {
            val rendered =
                markdownViews().single { it.text.toString() == "First draft" }.text as Spanned

            assertTrue(
                rendered.getSpans(0, rendered.length, StrongEmphasisSpan::class.java).isNotEmpty()
            )
            current =
                current.copy(
                    revision = 2,
                    outputs = listOf(output("plan", "running", "**Updated draft**")),
                )
        }

        compose.runOnIdle {
            assertEquals(1, markdownViews().count { it.text.toString() == "Updated draft" })
            assertFalse(markdownViews().any { it.text.contains("First draft") })
            assertFalse(markdownViews().any { it.text.contains("**Updated draft**") })
        }
    }

    @Test
    fun `completion collapses intermediate stages and keeps the final revision expanded`() {
        var current by
            mutableStateOf(task(outputs = listOf(output("plan", "running", "Draft body"))))

        compose.setContent {
            PlaygroundTheme("light") {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    ExternalTaskPanel(current)
                }
            }
        }

        compose.runOnIdle {
            current =
                current.copy(
                    status = "succeeded",
                    revision = 2,
                    outputs =
                        listOf(
                            output("plan", "succeeded", "Draft body"),
                            output("review", "succeeded", "Review body"),
                            output("revise", "succeeded", "**Corrected revision**"),
                        ),
                )
        }

        compose.onNodeWithText("1. Draft · Planner").assertExists()
        compose.onNodeWithText("2. Review · Reviewer").assertExists()
        compose.onNodeWithText("3. Revision · Planner").assertExists()
        compose.runOnIdle {
            assertFalse(
                markdownViews().any { it.text.toString() in setOf("Draft body", "Review body") }
            )
            assertEquals(1, markdownViews().count { it.text.toString() == "Corrected revision" })
        }
    }

    @Test
    fun `manual disclosure survives newer snapshots and completed intermediate output`() {
        var current by
            mutableStateOf(task(outputs = listOf(output("plan", "running", "Draft body"))))

        compose.setContent {
            PlaygroundTheme("light") {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    ExternalTaskPanel(current)
                }
            }
        }

        compose.onNodeWithText("1. Draft · Planner").performClick()
        compose.runOnIdle {
            current =
                current.copy(revision = 2, outputs = listOf(output("plan", "running", "New draft")))
        }
        compose.runOnIdle { assertFalse(markdownViews().any { it.text.toString() == "New draft" }) }

        compose.onNodeWithText("1. Draft · Planner").performClick()
        compose.runOnIdle {
            current =
                current.copy(
                    revision = 3,
                    outputs =
                        listOf(
                            output("plan", "succeeded", "Finished draft"),
                            output("review", "running", "Reviewing"),
                        ),
                )
        }

        compose.runOnIdle {
            assertTrue(markdownViews().any { it.text.toString() == "Finished draft" })
        }
    }

    @Test
    fun `failed and cancelled jobs keep the last partial output visible`() {
        var current by
            mutableStateOf(
                task(
                    "failed",
                    listOf(
                        output("plan", "succeeded", "Earlier draft"),
                        output("review", "failed", "**Partial review**"),
                    ),
                )
            )

        compose.setContent {
            PlaygroundTheme("light") {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    ExternalTaskPanel(current)
                }
            }
        }

        compose.runOnIdle {
            assertFalse(markdownViews().any { it.text.toString() == "Earlier draft" })
            assertTrue(markdownViews().any { it.text.toString() == "Partial review" })
            current = current.copy(status = "cancelled", revision = 2)
        }

        compose.runOnIdle {
            assertTrue(markdownViews().any { it.text.toString() == "Partial review" })
        }
    }

    @Test
    fun `timeline forwards controls and renders Markdown for attached and standalone tasks`() {
        val currentTask =
            task(
                "input_required",
                listOf(output("plan", "input_required", "**Need a date range**")),
            )
        var state by
            mutableStateOf(
                SessionState(
                    "thread",
                    messages =
                        listOf(
                            AssistantMessage(
                                "caller",
                                toolCalls =
                                    listOf(
                                        ToolCall("workflow", FunctionCall("run_a2a_workflow", "{}"))
                                    ),
                            )
                        ),
                    externalTasks = listOf(currentTask),
                )
            )
        val inputs = mutableListOf<Pair<String, String>>()
        val cancellations = mutableListOf<String>()

        compose.setContent {
            PlaygroundTheme("light") {
                ConversationTimeline(
                    state = state,
                    issue = null,
                    preferences = AppPreferences(replyAnimation = false),
                    modifier = Modifier,
                    onRecover = {},
                    onEditPlan = { _, _ -> },
                    onReview = { _, _, _, _ -> },
                    onContinueReviews = {},
                    onDownload = {},
                    onLink = {},
                    fileDownload = { Download("unused", "unused") },
                    documentDownload = { _, _ -> Download("unused", "unused") },
                    onSuggestion = {},
                    compactHeight = false,
                    onSubmitExternalTaskInput = { id, input -> inputs.add(id to input) },
                    onCancelExternalTask = { cancellations.add(it) },
                )
            }
        }

        listOf(true, false).forEach { attached ->
            compose.runOnIdle {
                if (!attached) {
                    state = state.copy(messages = emptyList())
                }
            }

            compose.onNodeWithText("Additional information").performTextReplacement("January")
            compose.onNodeWithText("Continue agents").performClick()
            compose.onNodeWithText("Cancel agents").performClick()
            compose.runOnIdle {
                assertEquals(1, markdownViews().count { it.text.toString() == "Need a date range" })
            }
        }

        assertEquals(listOf("job-1" to "January", "job-1" to "January"), inputs)
        assertEquals(listOf("job-1", "job-1"), cancellations)

        compose.runOnIdle {
            state =
                state.copy(
                    externalTaskControls =
                        mapOf(
                            "job-1" to
                                ExternalTaskControl(
                                    pending = ExternalTaskAction.Cancel,
                                    error = "Cancellation failed.",
                                )
                        )
                )
        }

        compose.onNodeWithText("Continue agents").assertIsNotEnabled()
        compose.onNodeWithText("Cancel agents").assertIsNotEnabled()
        compose.onNodeWithText("Cancellation failed.").assertExists()
    }

    private fun task(status: String = "running", outputs: List<AgentOutput> = emptyList()) =
        ExternalTask(
            taskId = "job-1",
            workflowCallId = "workflow",
            label = "A2A collaboration",
            revision = 1,
            status = status,
            stage = "plan",
            message = "Agents are collaborating.",
            history = emptyList(),
            kind = "a2a",
            outputs = outputs,
        )

    private fun output(step: String, status: String, text: String) =
        AgentOutput(
            agent = if (step == "review") "Reviewer" else "Planner",
            step = step,
            taskId = "child-$step",
            contextId = "context-$step",
            status = status,
            text = text,
        )

    private fun markdownViews(): List<TextView> = textViews(compose.activity.window.decorView)

    private fun textViews(view: View): List<TextView> {
        if (view is TextView) {
            return listOf(view)
        }

        if (view !is ViewGroup) {
            return emptyList()
        }

        return (0 until view.childCount).flatMap { textViews(view.getChildAt(it)) }
    }
}

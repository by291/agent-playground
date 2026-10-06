package com.agentplayground.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.agentplayground.app.features.conversation.ExternalTaskPanel
import com.agentplayground.app.features.conversation.PlanReviewPanel
import com.agentplayground.app.features.conversation.ReviewPanel
import com.agentplayground.core.*
import com.agui.core.types.Interrupt
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ReviewPanelTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `task progress interpolates server updates while the reported percentage is immediate`() {
        var task by
            mutableStateOf(
                ExternalTask(
                    "task",
                    "call",
                    "Report",
                    1,
                    "running",
                    "processing",
                    "Working",
                    10.0,
                    history = emptyList(),
                )
            )
        compose.mainClock.autoAdvance = false
        compose.setContent { MaterialTheme { ExternalTaskPanel(task) } }
        val progress =
            compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo))
        compose.onNodeWithText("10%").assertIsDisplayed()
        compose.runOnIdle {
            task = task.copy(progress = 80.0)
            androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()
        }
        compose.mainClock.advanceTimeBy(96)
        compose.onNodeWithText("80%").assertExists()
        val during =
            progress.fetchSemanticsNode().config[SemanticsProperties.ProgressBarRangeInfo].current
        assertTrue(during > 0.1f && during < 0.8f)
        compose.mainClock.advanceTimeBy(400)
        assertEquals(
            0.8f,
            progress.fetchSemanticsNode().config[SemanticsProperties.ProgressBarRangeInfo].current,
            0.001f,
        )
        compose.runOnIdle {
            task = task.copy(progress = null)
            androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()
        }
        compose.mainClock.advanceTimeBy(300)
        progress.assertDoesNotExist()
    }

    @Test
    fun `edited plan is passed to the specific review decision`() {
        val interrupt =
            Interrupt(
                "plan",
                "human_approval",
                metadata =
                    protocolJson.parseToJsonElement(
                        """{"langgraph":{"raw":{"kind":"experiment_plan_review","title":"Original title","steps":["Original step"]}}}"""
                    ),
            )
        var submitted: PlanDraft? = null
        var submittedId: String? = null
        compose.setContent {
            var draft by remember { mutableStateOf<PlanDraft?>(null) }
            MaterialTheme {
                ReviewPanel(interrupt, false, null, draft, { _, value -> draft = value }) {
                    id,
                    _,
                    draft ->
                    submittedId = id
                    submitted = draft
                }
            }
        }
        compose.onNodeWithText("Plan title").performTextReplacement("Edited title")
        compose.onNodeWithText("Original step").performTextReplacement("First step\nSecond step")
        compose.onNodeWithText("Approve").performClick()
        assertEquals("plan", submittedId)
        assertEquals(PlanDraft("Edited title", listOf("First step", "Second step")), submitted)
    }

    @Test
    fun `batch decisions wait for explicit continue and edits disable continuation`() {
        val interrupts =
            listOf("first", "second").map { id ->
                Interrupt(
                    id,
                    "human_approval",
                    metadata =
                        protocolJson.parseToJsonElement(
                            """{"langgraph":{"raw":{"kind":"experiment_plan_review","title":"Plan","steps":["Step"]}}}"""
                        ),
                )
            }
        var continued = 0
        compose.setContent {
            var decisions by remember { mutableStateOf(emptyMap<String, String>()) }
            var drafts by remember { mutableStateOf(emptyMap<String, PlanDraft>()) }
            MaterialTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    PlanReviewPanel(
                        interrupts = interrupts,
                        busy = false,
                        decisions = decisions,
                        drafts = drafts,
                        onEdit = { id, draft ->
                            drafts = drafts + (id to draft)
                            decisions = decisions - id
                        },
                        onReview = { id, action, draft ->
                            decisions = decisions + (id to action)
                            drafts = drafts + (id to draft!!)
                        },
                        onContinue = { continued++ },
                    )
                }
            }
        }
        compose.onNodeWithText("Continue workflow").assertIsNotEnabled()
        compose.onAllNodesWithText("Approve plan")[0].performScrollTo().performClick()
        compose.onAllNodesWithText("Reject")[1].performScrollTo().performClick()
        assertEquals(0, continued)
        compose.onNodeWithText("Continue workflow").assertIsEnabled()
        compose
            .onAllNodesWithText("Plan title")[0]
            .performScrollTo()
            .performTextReplacement("Edited")
        compose.onNodeWithText("Continue workflow").assertIsNotEnabled()
        compose.onAllNodesWithText("Approve plan")[0].performScrollTo().performClick()
        compose.onNodeWithText("Continue workflow").performScrollTo().performClick()
        assertEquals(1, continued)
    }

    @Test
    fun `blank plan fields show errors but empty lines between steps can be approved`() {
        val interrupt =
            Interrupt(
                "single",
                "human_approval",
                metadata =
                    protocolJson.parseToJsonElement(
                        """{"langgraph":{"raw":{"kind":"experiment_plan_review","title":"Plan","steps":["Step"]}}}"""
                    ),
            )
        compose.setContent {
            var draft by remember { mutableStateOf<PlanDraft?>(null) }
            MaterialTheme {
                ReviewPanel(interrupt, false, null, draft, { _, value -> draft = value }) { _, _, _
                    ->
                }
            }
        }
        compose.onNodeWithText("Steps (one per line)").performTextReplacement("First\n\n  \nSecond")
        compose.onNodeWithText("Approve").assertIsEnabled()
        compose.onNodeWithText("Plan title").performTextReplacement(" ")
        compose.onNodeWithText("Enter a title to approve this plan.").assertExists()
        compose.onNodeWithText("Approve").assertIsNotEnabled()
        compose.onNodeWithText("Steps (one per line)").performTextReplacement(" ")
        compose.onNodeWithText("Enter at least one step to approve this plan.").assertExists()
        compose.onNodeWithText("Reject").assertIsEnabled()
    }
}

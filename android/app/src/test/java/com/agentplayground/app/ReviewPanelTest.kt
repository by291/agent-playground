package com.agentplayground.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
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
}

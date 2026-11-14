package com.agentplayground.feature.conversation

import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import com.agentplayground.design.BackPreview
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class BackPreviewTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `cancelling an in-progress back gesture restores the preview without navigating`() {
        var navigations = 0

        compose.setContent {
            BackPreview(onBack = { navigations++ }) { preview ->
                Box(preview.size(120.dp).testTag("back-preview"))
            }
        }

        val preview = compose.onNodeWithTag("back-preview")
        val initialBounds = preview.fetchSemanticsNode().boundsInRoot

        compose.runOnIdle {
            val dispatcher = compose.activity.onBackPressedDispatcher
            dispatcher.dispatchOnBackStarted(
                BackEventCompat(
                    touchX = 0f,
                    touchY = 0f,
                    progress = 0f,
                    swipeEdge = BackEventCompat.EDGE_LEFT,
                )
            )
            dispatcher.dispatchOnBackProgressed(
                BackEventCompat(
                    touchX = 0f,
                    touchY = 0f,
                    progress = 0.5f,
                    swipeEdge = BackEventCompat.EDGE_LEFT,
                )
            )
        }

        assertTrue(preview.fetchSemanticsNode().boundsInRoot.left > initialBounds.left)

        compose.runOnIdle { compose.activity.onBackPressedDispatcher.dispatchOnBackCancelled() }

        assertEquals(initialBounds, preview.fetchSemanticsNode().boundsInRoot)
        assertEquals(0, navigations)
    }
}

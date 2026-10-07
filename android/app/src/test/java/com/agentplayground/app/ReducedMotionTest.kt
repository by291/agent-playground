package com.agentplayground.app

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.agentplayground.app.design.Details
import com.agentplayground.app.design.PlaygroundTheme
import com.agentplayground.app.features.conversation.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ReducedMotionTest {
    @get:Rule
    val compose =
        createComposeRule(
            ComposeUiTestConfig(
                effectContext =
                    object : MotionDurationScale {
                        override val scaleFactor = 0f
                    }
            )
        )

    @Test
    fun `system zero duration reaches disclosure final states without a timed transition`() {
        compose.mainClock.autoAdvance = false
        compose.setContent { PlaygroundTheme("light") { Details("Details") { Text("Body") } } }

        compose.onNodeWithText("Details").performClick()
        compose.mainClock.advanceTimeBy(48)

        compose.onNodeWithText("Body").assertIsDisplayed()

        compose.onNodeWithText("Hide Details").performClick()
        compose.mainClock.advanceTimeBy(48)

        compose.onNodeWithText("Body").assertDoesNotExist()
    }

    @Test
    fun `system zero duration settles image zoom and reset without timed transitions`() {
        compose.mainClock.autoAdvance = false
        val image =
            MessageAttachment("photo.png", preview = ImagePreview("photo.png", "content://photo"))
        compose.setContent {
            PlaygroundTheme("light") {
                AttachmentImageViewer(listOf(image), 0, {}, { _, _ -> ImageBitmap(600, 300) }, {})
            }
        }

        compose.onNodeWithTag("image-viewer-page:0").performTouchInput { doubleClick(center) }
        compose.mainClock.advanceTimeBy(48)

        compose
            .onNodeWithTag("image-viewer-page:0")
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.StateDescription,
                    "Zoom 250 percent",
                )
            )

        compose.onNodeWithTag("image-viewer-page:0").performTouchInput { doubleClick(center) }
        compose.mainClock.advanceTimeBy(48)

        compose
            .onNodeWithTag("image-viewer-page:0")
            .assert(
                SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Fit to screen")
            )
    }
}

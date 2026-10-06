package com.agentplayground.app

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.agentplayground.app.design.Details
import com.agentplayground.app.design.PlaygroundTheme
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
}

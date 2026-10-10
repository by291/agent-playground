package com.agentplayground.feature.conversation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.agentplayground.design.PlaygroundTheme
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.presentation.KnowledgeSource
import com.agentplayground.domain.presentation.ReplySources
import com.agentplayground.feature.conversation.ui.timeline.SourcesSheet
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
class SourcesSheetTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `a citation opens partially and drag gestures expand and dismiss its reader`() {
        var visible by mutableStateOf(true)
        var dismissals = 0

        compose.setContent {
            PlaygroundTheme("light") {
                Box(Modifier.fillMaxSize().testTag("reader-window")) {
                    if (visible) {
                        SourcesSheet(
                            sources(),
                            "two",
                            ::download,
                            {},
                            {
                                dismissals += 1
                                visible = false
                            },
                        )
                    }
                }
            }
        }

        val windowBounds = compose.onNodeWithTag("reader-window").getUnclippedBoundsInRoot()
        val windowHeight = windowBounds.bottom - windowBounds.top
        val initialTop =
            compose.onNodeWithContentDescription("Close sources").getUnclippedBoundsInRoot().top

        assertTrue(
            "The reader should initially leave the answer visible",
            initialTop > windowHeight / 3,
        )
        compose.onNodeWithText("Second passage").assertIsDisplayed()
        compose.onNodeWithContentDescription("Save original").assertIsDisplayed()
        compose
            .onNodeWithTag("source-sheet-drag-handle", useUnmergedTree = true)
            .performTouchInput {
                swipe(center, Offset(center.x, center.y - windowHeight.toPx() * 0.65f))
            }

        val expandedTop =
            compose.onNodeWithContentDescription("Close sources").getUnclippedBoundsInRoot().top

        assertTrue("Dragging up should expand the reader", expandedTop < windowHeight / 4)
        compose.onNodeWithText("Second passage").assertIsDisplayed()
        compose
            .onNodeWithTag("source-sheet-drag-handle", useUnmergedTree = true)
            .performTouchInput {
                swipe(center, Offset(center.x, center.y + windowHeight.toPx() * 0.85f))
            }

        compose.onNodeWithTag("source-sheet").assertDoesNotExist()
        compose.runOnIdle { assertEquals(1, dismissals) }
    }

    @Test
    @Config(qualifiers = "w320dp-h640dp-xxhdpi")
    fun `a small reader keeps the selected passage and original download accessible`() {
        var saved: Download? = null
        var visible by mutableStateOf(true)

        compose.setContent {
            PlaygroundTheme("light") {
                if (visible) {
                    SourcesSheet(sources(), "two", ::download, { saved = it }, { visible = false })
                }
            }
        }

        compose.onNodeWithText("Second passage").assertIsDisplayed()
        compose.onNodeWithText("Source [2] · Page 4").assertIsDisplayed()
        compose.onNodeWithContentDescription("Save original").performClick()
        compose.runOnIdle { assertEquals(Download("/original/doc", "Guide.pdf"), saved) }
        compose.onNodeWithContentDescription("Close sources").performClick()
        compose.onNodeWithTag("source-sheet").assertDoesNotExist()
    }

    private fun sources() =
        ReplySources(
            true,
            listOf(
                KnowledgeSource("one", "doc", "Guide.pdf", 3, "First passage", 1),
                KnowledgeSource("two", "doc", "Guide.pdf", 4, "Second passage", 2),
            ),
        )

    private fun download(id: String, name: String) = Download("/original/$id", name)
}

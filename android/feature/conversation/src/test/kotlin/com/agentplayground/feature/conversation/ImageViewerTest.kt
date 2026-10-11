package com.agentplayground.feature.conversation

import androidx.activity.ComponentDialog
import androidx.compose.runtime.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.agentplayground.design.PlaygroundTheme
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.ImagePreview
import com.agentplayground.domain.model.MessageAttachment
import com.agentplayground.feature.conversation.ui.attachments.AttachmentImageLoader
import com.agentplayground.feature.conversation.ui.attachments.AttachmentImageViewer
import com.agentplayground.feature.conversation.ui.attachments.MessageAttachments
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w412dp-h892dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ImageViewerTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `opening an image selects its place in the message gallery`() {
        compose.setContent {
            PlaygroundTheme("light") {
                MessageAttachments(images(), {}, { _, _ -> ImageBitmap(600, 300) })
            }
        }

        compose.onNodeWithContentDescription("Preview second.png").performClick()

        compose.onNodeWithText("2 of 2").assertIsDisplayed()
        compose.onNodeWithContentDescription("second.png").assertIsDisplayed()
        compose.onNodeWithContentDescription("Download original").assertIsDisplayed()
    }

    @Test
    fun `single tap hides controls and double tap zooms after asynchronous loading`() {
        val loaded = CompletableDeferred<ImageBitmap?>()
        showViewer(loader = { _, _ -> loaded.await() })

        compose.onNodeWithContentDescription("Close image preview").assertIsDisplayed()
        compose.runOnIdle { loaded.complete(ImageBitmap(600, 300)) }
        compose.onNodeWithContentDescription("first.png").assertIsDisplayed()

        page().performTouchInput { doubleClick(center) }
        compose.mainClock.advanceTimeBy(400)

        page()
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.StateDescription,
                    "Zoom 250 percent",
                )
            )
        compose.onNodeWithContentDescription("Close image preview").assertIsDisplayed()

        page().performTouchInput { click(center) }
        compose.mainClock.advanceTimeBy(500)

        compose.onNodeWithContentDescription("Close image preview").assertDoesNotExist()
        page()
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.StateDescription,
                    "Zoom 250 percent",
                )
            )

        page().performTouchInput {
            advanceEventTime(500)
            doubleClick(center)
        }

        compose.mainClock.advanceTimeBy(400)

        page()
            .assert(
                SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Fit to screen")
            )
        compose.onNodeWithContentDescription("Close image preview").assertDoesNotExist()

        page().performTouchInput { click(center) }
        compose.mainClock.advanceTimeBy(500)

        compose.onNodeWithContentDescription("Close image preview").assertIsDisplayed()
    }

    @Test
    fun `horizontal swipes page images at fit scale and pan instead while zoomed`() {
        var downloaded: Download? = null
        showViewer(onDownload = { downloaded = it })

        page().performTouchInput { doubleClick(center) }
        compose.mainClock.advanceTimeBy(400)
        page().performTouchInput { swipeLeft() }

        compose.onNodeWithText("1 of 2").assertIsDisplayed()
        page()
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.StateDescription,
                    "Zoom 250 percent",
                )
            )

        page().performTouchInput { doubleClick(center) }
        compose.mainClock.advanceTimeBy(400)
        page().performTouchInput { swipeLeft() }

        compose.onNodeWithText("2 of 2").assertIsDisplayed()
        page(1)
            .assert(
                SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Fit to screen")
            )
        compose.onNodeWithContentDescription("Download original").performClick()

        assertEquals("https://server/original/second.png", downloaded?.url)

        page(1).performTouchInput { swipeRight() }

        compose.onNodeWithText("1 of 2").assertIsDisplayed()
        page()
            .assert(
                SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Fit to screen")
            )
    }

    @Test
    fun `pinch zoom consumes multi pointer movement without paging or hiding controls`() {
        showViewer()

        page().performTouchInput {
            down(0, center - Offset(60f, 0f))
            down(1, center + Offset(60f, 0f))

            for (step in 1..12) {
                updatePointerTo(0, center - Offset(60f + step * 5, 0f))
                updatePointerTo(1, center + Offset(60f + step * 5, 0f))
                move(delayMillis = 16)
            }

            up(0)
            up(1)
        }

        page()
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.StateDescription,
                    "Zoom 200 percent",
                )
            )
        compose.onNodeWithText("1 of 2").assertIsDisplayed()
        compose.onNodeWithContentDescription("Close image preview").assertIsDisplayed()
    }

    @Test
    fun `short downward drags return to rest and longer drags dismiss only unzoomed media`() {
        showViewer()
        val original = page().getUnclippedBoundsInRoot()

        page().performTouchInput {
            swipe(Offset(centerX, height * 0.4f), Offset(centerX, height * 0.49f), 300)
        }

        compose.mainClock.advanceTimeBy(400)

        page().assertIsDisplayed()
        assertEquals(original.top, page().getUnclippedBoundsInRoot().top)

        page().performTouchInput { doubleClick(center) }
        compose.mainClock.advanceTimeBy(400)
        page().performTouchInput {
            swipe(Offset(centerX, height * 0.4f), Offset(centerX, height * 0.85f), 300)
        }

        page().assertIsDisplayed()

        page().performTouchInput { doubleClick(center) }
        compose.mainClock.advanceTimeBy(400)
        page().performTouchInput {
            swipe(Offset(centerX, height * 0.4f), Offset(centerX, height * 0.85f), 300)
        }

        compose.onNodeWithTag("image-viewer").assertDoesNotExist()
    }

    @Test
    fun `hardware back closes the viewer even when controls are hidden`() {
        showViewer()

        page().performTouchInput { click(center) }
        compose.mainClock.advanceTimeBy(500)
        compose.runOnIdle {
            (ShadowDialog.getLatestDialog() as ComponentDialog)
                .onBackPressedDispatcher
                .onBackPressed()
        }

        compose.onNodeWithTag("image-viewer").assertDoesNotExist()
    }

    @Test
    fun `a new touch during snap back cannot leave the gallery translated or locked`() {
        compose.mainClock.autoAdvance = false
        showViewer()
        compose.mainClock.advanceTimeBy(48)

        page().performTouchInput {
            swipe(Offset(centerX, height * 0.4f), Offset(centerX, height * 0.49f), 300)
        }

        compose.mainClock.advanceTimeBy(32)
        page().performTouchInput { click(center) }
        compose.mainClock.advanceTimeBy(500)
        page().performTouchInput { swipeLeft() }
        compose.mainClock.advanceTimeBy(500)

        compose.onNodeWithText("2 of 2").assertIsDisplayed()
        page(1)
            .assert(
                SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Fit to screen")
            )
    }

    @Test
    fun `adding a second finger to a downward drag cancels dismissal`() {
        showViewer()

        page().performTouchInput {
            val start = Offset(centerX, height * 0.4f)
            val dragged = start + Offset(0f, height * 0.24f)
            down(0, start)
            updatePointerTo(0, dragged)
            move(delayMillis = 16)
            down(1, dragged + Offset(60f, 0f))
            up(0)
            up(1)
        }

        page().assertIsDisplayed()
        compose.onNodeWithText("1 of 2").assertIsDisplayed()
        compose.onNodeWithContentDescription("Close image preview").assertIsDisplayed()
    }

    @Test
    fun `paging and closing cancel pending full size loads`() {
        val started = mutableListOf<String>()
        val cancelled = mutableListOf<String>()
        showViewer(
            loader = { source, _ ->
                started.add(source)

                try {
                    awaitCancellation()
                } finally {
                    cancelled.add(source)
                }
            }
        )

        compose.onNodeWithContentDescription("Close image preview").assertIsDisplayed()
        compose.onNodeWithContentDescription("Download original").assertIsDisplayed()
        page().performTouchInput {
            down(0, center - Offset(60f, 0f))
            down(1, center + Offset(60f, 0f))
            updatePointerTo(0, center - Offset(120f, 0f))
            updatePointerTo(1, center + Offset(120f, 0f))
            move(delayMillis = 16)
            up(0)
            up(1)
        }

        page()
            .assert(
                SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Fit to screen")
            )
        page().performTouchInput { swipeLeft() }

        compose.onNodeWithText("2 of 2").assertIsDisplayed()
        assertEquals(listOf("https://server/preview/first.png"), cancelled)

        compose.onNodeWithContentDescription("Close image preview").performClick()
        compose.waitForIdle()

        assertEquals(
            listOf("https://server/preview/first.png", "https://server/preview/second.png"),
            started,
        )
        assertEquals(started, cancelled)
    }

    @Test
    fun `failed full size previews keep close and original download available`() {
        var downloaded: Download? = null
        showViewer(loader = { _, _ -> null }, onDownload = { downloaded = it })

        compose.onNodeWithText("Image preview unavailable").assertIsDisplayed()
        compose.onNodeWithContentDescription("Close image preview").assertIsDisplayed()
        compose.onNodeWithContentDescription("Download original").performClick()

        assertEquals("https://server/original/first.png", downloaded?.url)
    }

    private fun page(index: Int = 0) = compose.onNodeWithTag("image-viewer-page:$index")

    private fun showViewer(
        loader: AttachmentImageLoader = { _, _ -> ImageBitmap(600, 300) },
        onDownload: (Download) -> Unit = {},
    ) {
        var visible by mutableStateOf(true)

        compose.setContent {
            PlaygroundTheme("light") {
                if (visible) {
                    AttachmentImageViewer(
                        images(),
                        0,
                        onDownload,
                        loader,
                        onDismiss = { visible = false },
                    )
                }
            }
        }
    }

    private fun images() =
        listOf("first.png", "second.png").map { name ->
            MessageAttachment(
                name,
                Download("https://server/original/$name", name),
                ImagePreview(
                    name,
                    "https://server/thumbnail/$name",
                    "https://server/preview/$name",
                ),
            )
        }
}

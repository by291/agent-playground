package com.agentplayground.feature.conversation

import androidx.compose.runtime.*
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.core.net.toUri
import com.agentplayground.core.model.Download
import com.agentplayground.core.model.ImagePreview
import com.agentplayground.core.model.MessageAttachment
import com.agentplayground.data.files.PickedFile
import com.agentplayground.feature.conversation.ui.attachments.MessageAttachments
import com.agentplayground.feature.conversation.ui.attachments.SelectedAttachments
import com.agentplayground.feature.conversation.ui.timeline.MessageContent
import com.agentplayground.ui.PlaygroundTheme
import com.agui.core.types.UserMessage
import kotlinx.coroutines.awaitCancellation
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
class AttachmentContentTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `uploaded attachment references do not leak into the user bubble`() {
        val content =
            "Please review this.\n\nUploaded files:\n" +
                "\"notes.txt\" — File ID: 019cd216-3624-7ad4-8f90-894fe76411ca"

        compose.setContent {
            PlaygroundTheme("light") { MessageContent(UserMessage("user", content), {}) }
        }

        compose.onNodeWithText("Please review this.").assertIsDisplayed()
        compose.onNodeWithText(content).assertDoesNotExist()
        compose.onNodeWithText("notes.txt").assertIsDisplayed()
    }

    @Test
    fun `malformed upload prose remains visible without attachment controls`() {
        val content = "Keep this.\n\nUploaded files:\n\"notes.txt\" — File ID: incomplete"

        compose.setContent {
            PlaygroundTheme("light") { MessageContent(UserMessage("user", content), {}) }
        }

        compose.onNodeWithText(content).assertIsDisplayed()
        compose.onNodeWithContentDescription("Download notes.txt").assertDoesNotExist()
    }

    @Test
    fun `ordinary attachment cards use the existing download descriptor`() {
        val file = Download("https://server/conversations/thread/files/file", "notes.txt")
        var selected: Download? = null

        compose.setContent {
            PlaygroundTheme("light") {
                MessageAttachments(
                    listOf(MessageAttachment(file.name, file)),
                    { selected = it },
                    { _, _ -> null },
                )
            }
        }

        compose.onNodeWithText("notes.txt").performClick()

        assertEquals(file, selected)
        compose.onNodeWithContentDescription("Close image preview").assertDoesNotExist()
    }

    @Test
    fun `image cards show thumbnails and open the full preview with original download`() {
        val file = Download("https://server/original", "photo.png")
        val preview = ImagePreview(file.name, "https://server/thumbnail", "https://server/preview")
        val requests = mutableListOf<Pair<String, Int>>()
        var downloaded: Download? = null

        compose.setContent {
            PlaygroundTheme("light") {
                MessageAttachments(
                    listOf(MessageAttachment(file.name, file, preview)),
                    { downloaded = it },
                    { source, size ->
                        requests.add(source to size)
                        ImageBitmap(12, 6)
                    },
                )
            }
        }

        compose.onNodeWithContentDescription("Preview photo.png").assertIsDisplayed().performClick()
        compose.onNodeWithContentDescription("photo.png").assertIsDisplayed()
        compose.onNodeWithContentDescription("Download original").performClick()

        assertEquals(file, downloaded)
        assertEquals(
            listOf("https://server/thumbnail" to 320, "https://server/preview" to 2048),
            requests,
        )

        compose.onNodeWithContentDescription("Close image preview").performClick()

        compose.onNodeWithContentDescription("photo.png").assertDoesNotExist()
        compose.onNodeWithContentDescription("Preview photo.png").assertIsDisplayed()
    }

    @Test
    fun `unavailable image previews preserve original downloads`() {
        val file = Download("https://server/original", "broken.jpg")
        var downloaded: Download? = null

        compose.setContent {
            PlaygroundTheme("light") {
                MessageAttachments(
                    listOf(
                        MessageAttachment(
                            file.name,
                            file,
                            ImagePreview(file.name, "https://server/invalid"),
                        )
                    ),
                    { downloaded = it },
                    { _, _ -> null },
                )
            }
        }

        compose.onNodeWithContentDescription("Image preview unavailable").assertIsDisplayed()
        compose.onNodeWithContentDescription("Download broken.jpg").performClick()

        assertEquals(file, downloaded)
    }

    @Test
    fun `selected local images stay visible and removal uses the original file identity`() {
        val file =
            PickedFile("content://documents/photo".toUri(), "photo.webp", 120, "selected-file")
        var files by mutableStateOf(listOf(file))
        var removed: String? = null

        compose.setContent {
            PlaygroundTheme("light") {
                SelectedAttachments(
                    files,
                    false,
                    { id ->
                        removed = id
                        files = files.filterNot { it.id == id }
                    },
                    { _, _ -> ImageBitmap(12, 6) },
                )
            }
        }

        compose
            .onNodeWithContentDescription("Preview photo.webp")
            .assertIsDisplayed()
            .performClick()
        compose.onNodeWithContentDescription("photo.webp").assertIsDisplayed()
        compose.onNodeWithContentDescription("Close image preview").performClick()
        compose.onNodeWithContentDescription("Remove photo.webp").performClick()

        assertEquals("selected-file", removed)
        compose.onNodeWithText("photo.webp").assertDoesNotExist()
    }

    @Test
    fun `removal remains available for ordinary files and is disabled during upload`() {
        val file =
            PickedFile("content://documents/notes".toUri(), "notes.txt", 120, "selected-file")
        var uploading by mutableStateOf(false)
        var removed: String? = null

        compose.setContent {
            PlaygroundTheme("light") {
                SelectedAttachments(listOf(file), uploading, { removed = it }, { _, _ -> null })
            }
        }

        compose.onNodeWithContentDescription("Remove notes.txt").performClick()
        assertEquals("selected-file", removed)

        compose.runOnIdle { uploading = true }

        compose.onNodeWithContentDescription("Remove notes.txt").assertIsNotEnabled()
    }

    @Test
    fun `leaving the attachment composition cancels its pending image request`() {
        var visible by mutableStateOf(true)
        var started = false
        var cancelled = false

        compose.setContent {
            PlaygroundTheme("light") {
                if (visible) {
                    MessageAttachments(
                        listOf(
                            MessageAttachment(
                                "photo.png",
                                preview = ImagePreview("photo.png", "content://photo"),
                            )
                        ),
                        {},
                        { _, _ ->
                            started = true
                            try {
                                awaitCancellation()
                            } finally {
                                cancelled = true
                            }
                        },
                    )
                }
            }
        }

        compose.runOnIdle {
            assertTrue(started)
            visible = false
        }
        compose.runOnIdle { assertTrue(cancelled) }
    }
}

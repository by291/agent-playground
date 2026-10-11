package com.agentplayground.feature.conversation

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuItem
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuSession
import androidx.compose.foundation.text.contextmenu.provider.LocalTextContextMenuToolbarProvider
import androidx.compose.foundation.text.contextmenu.provider.TextContextMenuDataProvider
import androidx.compose.foundation.text.contextmenu.provider.TextContextMenuProvider
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import com.agentplayground.design.PlaygroundTheme
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.RunRecord
import com.agentplayground.domain.presentation.conversationTurns
import com.agentplayground.feature.conversation.ui.markdown.Markdown
import com.agentplayground.feature.conversation.ui.timeline.AssistantTurnContent
import com.agui.core.types.AssistantMessage
import com.agui.core.types.UserMessage
import kotlinx.coroutines.channels.Channel
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
// API 26 exercises native selection without Robolectric's unsupported Magnifier surface.
@Config(sdk = [26], qualifiers = "w412dp-h892dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MarkdownSelectionTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `select all copies original Markdown including code fences and table syntax`() {
        val toolbar = SelectionToolbar()
        val markdown =
            "**First paragraph.**\n\n```kotlin\nval answer = 42\n```\n\n" +
                "| Name | Value |\n| --- | --- |\n| Ada | 42 |\n\nLast paragraph."

        compose.setContent {
            PlaygroundTheme("light") {
                CompositionLocalProvider(LocalTextContextMenuToolbarProvider provides toolbar) {
                    Column(Modifier.width(320.dp)) {
                        Markdown(markdown, {})
                    }
                }
            }
        }

        compose.onNodeWithText("First paragraph.").performTouchInput {
            longClick(Offset(10f, centerY))
        }

        compose.waitUntil { toolbar.ready }
        compose.runOnIdle { toolbar.click("Select all") }
        compose.waitForIdle()
        compose.runOnIdle { toolbar.click("Copy") }
        compose.waitForIdle()

        val clipboard =
            RuntimeEnvironment.getApplication().getSystemService(Context.CLIPBOARD_SERVICE)
                as ClipboardManager
        val copied = clipboard.primaryClip!!.getItemAt(0).text.toString()

        assertEquals(markdown, copied)
    }

    @Test
    fun `select all includes every answer message in the same reply`() {
        val toolbar = SelectionToolbar()
        val turn =
            conversationTurns(
                    listOf(
                        UserMessage("user", "Show the answer"),
                        AssistantMessage("first", "First answer."),
                        AssistantMessage("last", "Last answer."),
                    ),
                    listOf(RunRecord("run", "user", "completed")),
                )
                .single()

        compose.setContent {
            PlaygroundTheme("light") {
                CompositionLocalProvider(LocalTextContextMenuToolbarProvider provides toolbar) {
                    Column(Modifier.width(320.dp)) {
                        AssistantTurnContent(
                            turn,
                            { Download("/files/${it.name}", it.name) },
                            { id, name -> Download("/documents/$id", name) },
                            {},
                            {},
                            messageTimestamps =
                                mapOf(
                                    "first" to "2026-10-11T02:30:00Z",
                                    "last" to "2026-10-11T02:31:00Z",
                                ),
                        )
                    }
                }
            }
        }

        compose.onNodeWithText("First answer.").performTouchInput {
            longClick(Offset(10f, centerY))
        }

        compose.waitUntil { toolbar.ready }
        compose.runOnIdle { toolbar.click("Select all") }
        compose.waitForIdle()
        compose.runOnIdle { toolbar.click("Copy") }
        compose.waitForIdle()

        val clipboard =
            RuntimeEnvironment.getApplication().getSystemService(Context.CLIPBOARD_SERVICE)
                as ClipboardManager

        assertEquals(
            "First answer.\n\nLast answer.",
            clipboard.primaryClip!!.getItemAt(0).text.toString(),
        )
    }

    @Test
    fun `dragging from prose past code and a table keeps a continuous selection`() {
        val toolbar = SelectionToolbar()

        compose.setContent {
            PlaygroundTheme("light") {
                CompositionLocalProvider(LocalTextContextMenuToolbarProvider provides toolbar) {
                    Column(Modifier.width(320.dp)) {
                        Markdown(
                            "Start\n\n```text\ncode\n```\n\n" +
                                "| Header |\n| --- |\n| Cell |\n\nFinish",
                            {},
                        )
                    }
                }
            }
        }

        val first = compose.onNodeWithText("Start").fetchSemanticsNode()
        val last = compose.onNodeWithText("Finish").fetchSemanticsNode()
        val layouts = mutableListOf<TextLayoutResult>()
        last.config[SemanticsActions.GetTextLayoutResult].action!!.invoke(layouts)
        val finalCharacter = layouts.single().getBoundingBox(5)
        val start = first.boundsInRoot.topLeft + Offset(5f, first.boundsInRoot.height / 2)
        val end = last.boundsInRoot.topLeft + Offset(finalCharacter.right, finalCharacter.center.y)

        compose.onRoot().performTouchInput {
            down(start)
            advanceEventTime(600)
            moveTo(end, delayMillis = 200)
            up()
        }

        compose.waitUntil { toolbar.ready }
        compose.runOnIdle { toolbar.click("Copy") }
        compose.waitForIdle()

        val clipboard =
            RuntimeEnvironment.getApplication().getSystemService(Context.CLIPBOARD_SERVICE)
                as ClipboardManager

        assertEquals(
            "Start\n\n```text\ncode\n```\n\n| Header |\n| --- |\n| Cell |\n\nFinish",
            clipboard.primaryClip!!.getItemAt(0).text.toString(),
        )
    }

    @Test
    fun `copying a selected bold word keeps its markup without surrounding prose`() {
        assertEquals(
            "**chosen**",
            copyWord("Before **chosen** after.", "Before chosen after.", "chosen"),
        )
    }

    @Test
    fun `copying part of a code block adds fences without unselected code`() {
        assertEquals(
            "```kotlin\nchosen\n```",
            copyWord(
                "Before\n\n```kotlin\nval chosen = 42\n```\n\nAfter",
                "val chosen = 42",
                "chosen",
            ),
        )
    }

    @Test
    fun `copying a table cell retains table syntax without other cell contents`() {
        assertEquals(
            "|  |  |\n| --- | --- |\n| chosen |  |",
            copyWord("| Name | Value |\n| --- | --- |\n| chosen | 42 |", "chosen", "chosen"),
        )
    }

    @Test
    fun `select all preserves headings lists quotes empty cells and reference definitions`() {
        val toolbar = SelectionToolbar()
        val markdown =
            "# Title\n\n- **First**\n- Second\n\n> Quote\n\n" +
                "| Name | Value |\n| :--- | ---: |\n| Ada | |\n\n" +
                "Read [docs][api].\n\n[api]: https://example.com\n"

        compose.setContent {
            PlaygroundTheme("light") {
                CompositionLocalProvider(LocalTextContextMenuToolbarProvider provides toolbar) {
                    Column(Modifier.width(320.dp)) { Markdown(markdown, {}) }
                }
            }
        }

        compose.onNodeWithText("Title").performTouchInput { longClick(Offset(10f, centerY)) }
        compose.waitUntil { toolbar.ready }
        compose.runOnIdle { toolbar.click("Select all") }
        compose.waitForIdle()
        compose.runOnIdle { toolbar.click("Copy") }
        compose.waitForIdle()

        val clipboard =
            RuntimeEnvironment.getApplication().getSystemService(Context.CLIPBOARD_SERVICE)
                as ClipboardManager

        assertEquals(markdown, clipboard.primaryClip!!.getItemAt(0).text.toString())
    }

    private fun copyWord(markdown: String, rendered: String, word: String): String {
        val toolbar = SelectionToolbar()

        compose.setContent {
            PlaygroundTheme("light") {
                CompositionLocalProvider(LocalTextContextMenuToolbarProvider provides toolbar) {
                    Column(Modifier.width(320.dp)) { Markdown(markdown, {}) }
                }
            }
        }

        val target = compose.onNodeWithText(rendered)
        val layouts = mutableListOf<TextLayoutResult>()
        target
            .fetchSemanticsNode()
            .config[SemanticsActions.GetTextLayoutResult]
            .action!!
            .invoke(layouts)
        val character = layouts.single().getBoundingBox(rendered.indexOf(word) + 1)

        target.performTouchInput { longClick(character.center) }
        compose.waitUntil { toolbar.ready }
        compose.runOnIdle { toolbar.click("Copy") }
        compose.waitForIdle()

        val clipboard =
            RuntimeEnvironment.getApplication().getSystemService(Context.CLIPBOARD_SERVICE)
                as ClipboardManager

        return clipboard.primaryClip!!.getItemAt(0).text.toString()
    }

    private class SelectionToolbar : TextContextMenuProvider, TextContextMenuSession {
        private var data: TextContextMenuDataProvider? = null
        private val closed = Channel<Unit>(Channel.CONFLATED)
        val ready: Boolean
            get() = data != null

        override suspend fun showTextContextMenu(dataProvider: TextContextMenuDataProvider) {
            data = dataProvider
            closed.receive()
        }

        fun click(label: String) {
            data!!
                .data()
                .components
                .filterIsInstance<TextContextMenuItem>()
                .single { it.label.equals(label, ignoreCase = true) }
                .onClick(this)
        }

        override fun close() {
            closed.trySend(Unit)
        }
    }
}

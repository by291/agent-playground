package com.agentplayground.app

import android.content.ClipboardManager
import android.content.Context
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.agentplayground.app.design.PlaygroundTheme
import com.agentplayground.app.features.conversation.*
import com.agentplayground.app.files.Download
import com.agentplayground.core.*
import com.agui.core.types.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w412dp-h892dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MessageContentTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `CommonMark code and tables copy parsed content without markdown punctuation`() {
        val content =
            """
            ```kotlin
            val name = "Ada"
            ```

            | Name | Note |
            | --- | --- |
            | **Ada** | pipe \| symbol |
            """
                .trimIndent()
        val blocks = markdownBlocks(content)
        assertEquals("val name = \"Ada\"\n", copyableMarkdown(blocks.first()))
        assertEquals("Name\tNote\nAda\tpipe | symbol", copyableMarkdown(blocks.last()))
        compose.setContent { PlaygroundTheme("light") { Markdown(content, {}) } }
        compose.onNodeWithText("Copy code").performClick()
        val clipboard =
            RuntimeEnvironment.getApplication().getSystemService(Context.CLIPBOARD_SERVICE)
                as ClipboardManager
        assertEquals("val name = \"Ada\"\n", clipboard.primaryClip!!.getItemAt(0).text.toString())
        compose.onNodeWithText("Copy table").performClick()
        assertEquals(
            "Name\tNote\nAda\tpipe | symbol",
            clipboard.primaryClip!!.getItemAt(0).text.toString(),
        )
    }

    @Test
    fun `table-only answers retain rendered rows and count as visible content`() {
        val content = "| Name | Value |\n| --- | --- |\n| Ada | 42 |\n| Bob | 7 |"
        val renderer =
            io.noties.markwon.Markwon.builder(RuntimeEnvironment.getApplication())
                .usePlugin(
                    io.noties.markwon.ext.tables.TablePlugin.create(
                        RuntimeEnvironment.getApplication()
                    )
                )
                .build()
        val rendered = renderMarkdownBlock(renderer, markdownBlocks(content).single())
        assertEquals(
            3,
            rendered
                .getSpans(0, rendered.length, io.noties.markwon.ext.tables.TableRowSpan::class.java)
                .size,
        )
        assertTrue(hasVisibleMarkdown(rendered))
        var visible = false
        compose.setContent {
            PlaygroundTheme("light") { Markdown(content, {}, onTextVisible = { visible = true }) }
        }
        compose.runOnIdle { assertTrue(visible) }
    }

    @Test
    fun `nested code controls and strikethrough retain CommonMark structure`() {
        val block = markdownBlocks("> ~~Old~~\n>\n> ```kotlin\n> val value = 1\n> ```").single()
        assertEquals("val value = 1\n", copyableMarkdown(markdownCopyTargets(block).single()))
        var strikethrough = false
        block.accept(
            object : org.commonmark.node.AbstractVisitor() {
                override fun visit(node: org.commonmark.node.CustomNode) {
                    if (node is org.commonmark.ext.gfm.strikethrough.Strikethrough) {
                        strikethrough = true
                    }
                    visitChildren(node)
                }
            }
        )
        assertTrue(strikethrough)
        compose.setContent {
            PlaygroundTheme("light") { Markdown("> ```kotlin\n> val value = 1\n> ```", {}) }
        }
        compose.onNodeWithText("Copy code").assertIsDisplayed()
    }

    @Test
    fun `streaming copy controls wait for settled reply and unknown code remains plain`() {
        compose.setContent {
            PlaygroundTheme("light") { Markdown("```kotlin\nval x = 1\n```", {}, settled = false) }
        }
        compose.onNodeWithText("Copy code").assertIsNotEnabled()
        assertEquals("unchanged", highlightCode("unknown", "unchanged", false))
        val highlighted = highlightCode("kotlin", "val x = 1", false) as Spanned
        assertTrue(
            highlighted
                .getSpans(0, highlighted.length, ForegroundColorSpan::class.java)
                .isNotEmpty()
        )
        assertEquals("val x = 1", highlighted.toString())
    }

    @Test
    fun `reasoning user fold survives recovery and waits for visible code before collapsing`() {
        fun turn(reasonId: String, answer: String? = null): ConversationTurn {
            val messages =
                listOf(
                    UserMessage("user", "Explain"),
                    reasoningMessage(reasonId, "Compare constraints."),
                ) + if (answer != null) listOf(AssistantMessage("answer", answer)) else emptyList()
            return conversationTurns(messages, listOf(RunRecord("run", "user", "running"))).single()
        }
        var current by mutableStateOf(turn("live"))
        PlaygroundApi("http://localhost/").use { api ->
            compose.setContent {
                PlaygroundTheme("light") { AssistantTurnContent(current, api, {}, {}) }
            }
            compose.onNodeWithTag("reasoning-content-user").assertExists()
            compose.onNodeWithText("Thinking").performClick()
            compose.onNodeWithTag("reasoning-content-user").assertDoesNotExist()
            compose.runOnIdle { current = turn("restored") }
            compose.onNodeWithTag("reasoning-content-user").assertDoesNotExist()
            compose.onNodeWithText("Thinking").performClick()
            compose.runOnIdle { current = turn("restored", "```kotlin") }
            compose.onNodeWithTag("reasoning-content-user").assertExists()
            compose.runOnIdle { current = turn("restored", "```kotlin\nval answer = 42") }
            compose.onNodeWithTag("reasoning-content-user").assertDoesNotExist()
            compose.onNodeWithText("Reasoning").performClick()
            compose.onNodeWithTag("reasoning-content-user").assertExists()
        }
    }

    @Test
    fun `changing passages resets the reader to the beginning of the excerpt`() {
        val sources =
            ReplySources(
                true,
                listOf(
                    KnowledgeSource(
                        "one",
                        "doc",
                        "Guide",
                        null,
                        (1..150).joinToString("\n") { "First excerpt line $it" },
                        1,
                    ),
                    KnowledgeSource(
                        "two",
                        "doc",
                        "Guide",
                        null,
                        (1..150).joinToString("\n") { "Second excerpt line $it" },
                        2,
                    ),
                ),
            )
        PlaygroundApi("http://localhost/").use { api ->
            compose.setContent {
                PlaygroundTheme("light") { SourcesSheet(sources, "one", api, {}, {}) }
            }
            compose.onNodeWithTag("source-excerpt").performTouchInput { swipeUp() }
            compose.waitForIdle()
            val before =
                compose
                    .onNodeWithTag("source-excerpt")
                    .fetchSemanticsNode()
                    .config[
                        androidx.compose.ui.semantics.SemanticsProperties.VerticalScrollAxisRange]
                    .value()
            assertTrue(before > 0f)
            compose.onNodeWithText("Next excerpt").performClick()
            val after =
                compose
                    .onNodeWithTag("source-excerpt")
                    .fetchSemanticsNode()
                    .config[
                        androidx.compose.ui.semantics.SemanticsProperties.VerticalScrollAxisRange]
                    .value()
            assertEquals(0f, after)
        }
    }

    @Test
    fun `source reader navigates documents passages and saves original file`() {
        val sources =
            ReplySources(
                true,
                listOf(
                    KnowledgeSource("one", "doc-a", "Guide A", 1, "First passage", 1),
                    KnowledgeSource("two", "doc-a", "Guide A", 2, "Second passage", 2),
                    KnowledgeSource("three", "doc-b", "Guide B", null, "Other document", 3),
                ),
            )
        var download: Download? = null
        PlaygroundApi("http://localhost/").use { api ->
            compose.setContent {
                PlaygroundTheme("light") {
                    SourcesSheet(sources, "one", api, { download = it }, {})
                }
            }
            compose.onNodeWithText("First passage").assertIsDisplayed()
            compose.onNodeWithText("Next excerpt").performClick()
            compose.onNodeWithText("Second passage").assertIsDisplayed()
            compose.onNodeWithText("Document: Guide A").performClick()
            compose.onNodeWithText("Guide B").performClick()
            compose.onNodeWithText("Other document").assertIsDisplayed()
            compose.onNodeWithText("Save original").performClick()
            assertEquals("Guide B", download?.name)
            assertEquals(api.documentPath("doc-b"), download?.url)
        }
    }
}

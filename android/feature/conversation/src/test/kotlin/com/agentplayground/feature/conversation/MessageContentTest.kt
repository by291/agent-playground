package com.agentplayground.feature.conversation

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.core.graphics.ColorUtils
import com.agentplayground.design.Details
import com.agentplayground.design.PlaygroundTheme
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.RunRecord
import com.agentplayground.domain.model.SkillFile
import com.agentplayground.domain.model.reasoningMessage
import com.agentplayground.domain.presentation.ConversationTurn
import com.agentplayground.domain.presentation.ExecutionGroup
import com.agentplayground.domain.presentation.KnowledgeSource
import com.agentplayground.domain.presentation.ReplySources
import com.agentplayground.domain.presentation.SkillIdentity
import com.agentplayground.domain.presentation.ToolStatus
import com.agentplayground.domain.presentation.ToolStep
import com.agentplayground.domain.presentation.conversationTurns
import com.agentplayground.domain.presentation.executionGroups
import com.agentplayground.feature.conversation.ui.markdown.Markdown
import com.agentplayground.feature.conversation.ui.markdown.copyableMarkdown
import com.agentplayground.feature.conversation.ui.markdown.hasVisibleMarkdown
import com.agentplayground.feature.conversation.ui.markdown.highlightCode
import com.agentplayground.feature.conversation.ui.markdown.markdownBlocks
import com.agentplayground.feature.conversation.ui.markdown.markdownCopyTargets
import com.agentplayground.feature.conversation.ui.markdown.markdownTableRows
import com.agentplayground.feature.conversation.ui.timeline.AssistantTurnContent
import com.agentplayground.feature.conversation.ui.timeline.SourcesSheet
import com.agentplayground.feature.conversation.ui.timeline.ToolGroupContent
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
    fun `inline code scales with headings and table cell typography`() {
        compose.setContent {
            PlaygroundTheme("light") {
                Markdown("# Heading `code`\n\n| Name |\n| --- |\n| Cell `code` |", {})
            }
        }

        listOf("Heading code", "Cell code").forEach { label ->
            val text =
                compose
                    .onNodeWithText(label)
                    .fetchSemanticsNode()
                    .config[SemanticsProperties.Text]
                    .single()
            val code = text.spanStyles.single { it.item.fontFamily == FontFamily.Monospace }

            assertEquals(0.9.em, code.item.fontSize)
        }
    }

    @Test
    fun `disclosure expands gradually and a rapid reversal ends fully collapsed`() {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            PlaygroundTheme("light") {
                Column(Modifier.testTag("fold-container")) {
                    Details("Payload") {
                        androidx.compose.material3.Text("Payload body", Modifier.height(200.dp))
                    }
                }
            }
        }

        compose.onNodeWithText("Payload").performClick()
        compose.mainClock.advanceTimeBy(80)

        val during =
            compose.onNodeWithTag("fold-container").getUnclippedBoundsInRoot().let {
                it.bottom - it.top
            }

        compose.mainClock.advanceTimeBy(300)

        val expanded =
            compose.onNodeWithTag("fold-container").getUnclippedBoundsInRoot().let {
                it.bottom - it.top
            }

        assertTrue("Expansion should have an intermediate height", during < expanded)

        compose.onNodeWithText("Hide Payload").performClick()
        compose.mainClock.advanceTimeBy(64)
        compose.onNodeWithText("Payload").performClick()
        compose.mainClock.advanceTimeBy(64)
        compose.onNodeWithText("Hide Payload").performClick()
        compose.mainClock.advanceTimeBy(500)

        compose.onNodeWithText("Payload body").assertDoesNotExist()
    }

    @Test
    fun `inline code preserves adjacency literal escapes and CommonMark whitespace`() {
        compose.setContent {
            PlaygroundTheme("light") {
                Markdown("file`.txt` `a\\b &amp;` ` x `", {})
            }
        }

        compose.onNodeWithText("file.txt a\\b &amp; x").assertIsDisplayed()
    }

    @Test
    fun `quoted tab content survives different parser block classifications`() {
        compose.setContent { PlaygroundTheme("light") { Markdown("> \tx", {}) } }

        compose.onNodeWithText("x").assertIsDisplayed()
    }

    @Test
    fun `angle bracket link destinations open their actual URL`() {
        var opened: String? = null

        compose.setContent {
            PlaygroundTheme("light") {
                Markdown("See [website](<https://example.com>).", { opened = it })
            }
        }

        val text =
            compose
                .onNodeWithText("See website.")
                .fetchSemanticsNode()
                .config[SemanticsProperties.Text]
                .single()
        val link = text.getLinkAnnotations(0, text.length).single().item
        compose.runOnIdle { link.linkInteractionListener!!.onClick(link) }
        compose.runOnIdle { assertEquals("https://example.com", opened) }
    }

    @Test
    fun `prose and table cells decode entities while inline code stays literal`() {
        compose.setContent {
            PlaygroundTheme("light") {
                Markdown(
                    "A &amp; B &#x3c; C\n\n" +
                        "| Name | Literal |\n| --- | --- |\n" +
                        "| D &amp; E &#x1f600; | file`.txt` and `&amp;` |\n" +
                        "| &#160;kept&#160; | `  code  ` |",
                    {},
                )
            }
        }

        compose.onNodeWithText("A & B < C").assertIsDisplayed()
        compose.onNodeWithText("D & E 😀").assertIsDisplayed()
        compose.onNodeWithText("file.txt and &amp;").assertIsDisplayed()
        compose.onNodeWithText("\u00a0kept\u00a0").assertIsDisplayed()
        compose.onNodeWithText(" code ").assertIsDisplayed()
    }

    @Test
    fun `reference citations resolve their saved passage and number`() {
        val id = "11111111-1111-4111-8111-111111111111"
        val sources =
            ReplySources(true, listOf(KnowledgeSource(id, "doc", "Guide.pdf", 3, "Passage", 1)))
        var opened: String? = null

        compose.setContent {
            PlaygroundTheme("light") {
                Markdown(
                    "See [source][r].\n\n[r]: <#knowledge-source-$id>",
                    { opened = it },
                    citations = sources,
                )
            }
        }

        val text =
            compose
                .onNodeWithText("See [1].")
                .fetchSemanticsNode()
                .config[SemanticsProperties.Text]
                .single()
        val link = text.getLinkAnnotations(0, text.length).single().item
        compose.runOnIdle { link.linkInteractionListener!!.onClick(link) }

        assertEquals("#knowledge-source-$id", opened)
    }

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
        assertTrue(hasVisibleMarkdown(markdownBlocks(content).single()))

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
        assertEquals("unchanged", highlightCode("unknown", "unchanged", false).text)

        val highlighted = highlightCode("kotlin", "val x = 1", false)

        assertTrue(highlighted.spanStyles.isNotEmpty())
        assertEquals("val x = 1", highlighted.text)
    }

    @Test
    fun `wide code and tables scroll within the reply and code copy shows feedback`() {
        val code = "val values = listOf(" + (1..40).joinToString(", ") + ")\n"
        val content =
            "```kotlin\n$code```\n\n| One | Two | Three | Four |\n| --- | --- | --- | --- |\n| A | B | C | D |"

        compose.setContent {
            PlaygroundTheme("light") {
                Column(Modifier.width(320.dp)) { Markdown(content, {}) }
            }
        }

        listOf("markdown-code-scroll", "markdown-table-scroll").forEach { tag ->
            val node = compose.onNodeWithTag(tag)
            val range =
                node.fetchSemanticsNode().config[SemanticsProperties.HorizontalScrollAxisRange]

            assertTrue(
                "$tag should expose overflow without widening the reply",
                range.maxValue() > 0,
            )

            node.performTouchInput { swipeLeft() }
            assertTrue(range.value() > 0)
        }

        compose.onNodeWithText("Copy code").performClick()
        compose.onNodeWithText("Copied").assertIsDisplayed()

        val clipboard =
            RuntimeEnvironment.getApplication().getSystemService(Context.CLIPBOARD_SERVICE)
                as ClipboardManager

        assertEquals(code, clipboard.primaryClip!!.getItemAt(0).text.toString())
    }

    @Test
    fun `table cells retain emphasis links alignment and escaped pipe content`() {
        var opened: String? = null
        val content =
            "| Name | Reference |\n| :--- | ---: |\n| **Ada** | [guide](https://example.com) and pipe \\| symbol |"
        val table = markdownBlocks(content).single() as org.commonmark.ext.gfm.tables.TableBlock
        val rows = markdownTableRows(table)

        assertEquals(2, rows.size)
        assertTrue(rows.first().all { it.isHeader })
        assertEquals(
            org.commonmark.ext.gfm.tables.TableCell.Alignment.RIGHT,
            rows.last()[1].alignment,
        )

        compose.setContent { PlaygroundTheme("light") { Markdown(content, { opened = it }) } }
        val name =
            compose
                .onNodeWithText("Ada")
                .fetchSemanticsNode()
                .config[SemanticsProperties.Text]
                .single()
        val reference =
            compose
                .onNodeWithText("guide and pipe | symbol")
                .fetchSemanticsNode()
                .config[SemanticsProperties.Text]
                .single()

        assertTrue(name.spanStyles.any { it.item.fontWeight == FontWeight.Bold })
        val link = reference.getLinkAnnotations(0, reference.length).single().item
        compose.runOnIdle { link.linkInteractionListener!!.onClick(link) }

        assertEquals("https://example.com", opened)
    }

    @Test
    fun `syntax colors stay readable on light and dark code panels`() {
        var preference by mutableStateOf("light")
        var background = 0

        compose.setContent {
            PlaygroundTheme(preference) {
                val surface = MaterialTheme.colorScheme.surfaceContainerLow.toArgb()

                SideEffect { background = surface }
            }
        }

        listOf("light", "dark").forEach { theme ->
            compose.runOnIdle { preference = theme }
            compose.runOnIdle {
                val text =
                    highlightCode(
                        "kotlin",
                        "// Note\nval value = 42\nval name = \"Ada\"",
                        theme == "dark",
                    )
                val spans = text.spanStyles

                assertTrue(spans.isNotEmpty())
                spans.forEach { span ->
                    assertTrue(
                        "$theme syntax color should meet normal text contrast",
                        ColorUtils.calculateContrast(span.item.color.toArgb(), background) >= 4.5,
                    )
                }
            }
        }
    }

    @Test
    fun `empty table headers do not render a panel or report visible answer content`() {
        var visible = false

        compose.setContent {
            PlaygroundTheme("light") {
                Markdown("|\n|---|", {}, onTextVisible = { visible = true })
            }
        }

        compose.onNodeWithText("Copy table").assertDoesNotExist()
        compose.runOnIdle { assertFalse(visible) }
    }

    @Test
    fun `multiple ordinary tools reveal individual calls beneath one collapsed summary`() {
        val turn =
            conversationTurns(
                    listOf(
                        UserMessage("user", "Calculate twice"),
                        AssistantMessage(
                            "caller",
                            toolCalls =
                                listOf(
                                    ToolCall(
                                        "one",
                                        FunctionCall("calculate_sum", "{\"a\":1,\"b\":1}"),
                                    ),
                                    ToolCall(
                                        "two",
                                        FunctionCall("calculate_sum", "{\"a\":1,\"b\":3}"),
                                    ),
                                ),
                        ),
                        ToolMessage("one-result", "2", "one"),
                        ToolMessage("two-result", "4", "two"),
                    ),
                    listOf(RunRecord("run", "user", "completed")),
                )
                .single()

        compose.setContent {
            PlaygroundTheme("light") {
                AssistantTurnContent(turn, ::fileDownload, ::documentDownload, {}, {})
            }
        }

        compose.onNodeWithText("2 tools").assertIsDisplayed()
        compose.onNodeWithTag("tool-group-two").assertDoesNotExist()
        compose.onNodeWithTag("tool-step-one").assertDoesNotExist()
        compose.onNodeWithTag("tool-step-two").assertDoesNotExist()

        compose.onNodeWithTag("tool-group-one").performClick()
        compose.onNodeWithTag("tool-step-one").assertIsDisplayed()
        compose.onNodeWithTag("tool-step-two").assertIsDisplayed()
        compose.onNodeWithText("Parameters").assertDoesNotExist()

        compose.onNodeWithTag("tool-step-one").performClick()
        compose.onAllNodesWithText("Parameters").assertCountEquals(1)
        compose.onNodeWithText("2").assertIsDisplayed()
        compose.onNodeWithText("4").assertDoesNotExist()

        compose.onNodeWithTag("tool-step-two").performClick()
        compose.onAllNodesWithText("Parameters").assertCountEquals(2)
        compose.onNodeWithText("4").assertIsDisplayed()

        compose.onNodeWithTag("tool-step-one").performClick()
        compose.onAllNodesWithText("Parameters").assertCountEquals(1)
        compose.onNodeWithText("2").assertDoesNotExist()
        compose.onNodeWithText("4").assertIsDisplayed()
    }

    @Test
    fun `memory has its own badge and preserves expansion through tool completion`() {
        val call = ToolCall("remember", FunctionCall("remember_memory", "{"))
        var step by mutableStateOf(ToolStep(call, null, ToolStatus.Running))

        compose.setContent {
            PlaygroundTheme("light") { ToolGroupContent(executionGroups(listOf(step)).single()) }
        }

        compose.onNodeWithText("Memory").assertIsDisplayed()
        compose.onNodeWithText("Tool").assertDoesNotExist()
        compose.onNodeWithTag("tool-group-remember").performClick()
        compose.onNodeWithText("Remember a fact").assertIsDisplayed()

        compose.runOnIdle {
            step =
                step.copy(
                    result = ToolMessage("result", "Saved", "remember"),
                    status = ToolStatus.Completed,
                )
        }
        compose.onNodeWithText("Memory").assertIsDisplayed()
        compose.onNodeWithText("Remember a fact").assertIsDisplayed()
        compose.onNodeWithTag("tool-group-remember").performClick()

        compose.runOnIdle {
            step =
                step.copy(
                    result = ToolMessage("result", "", "remember", error = "Memory unavailable"),
                    status = ToolStatus.Failed,
                )
        }
        compose.onNodeWithText("Memory unavailable").assertIsDisplayed()
        compose.onNodeWithText("Remember a fact").assertDoesNotExist()
    }

    @Test
    fun `tool disclosure keeps user expansion while a skill adds calls and exposes failures`() {
        val completed =
            ToolStep(
                ToolCall("load", FunctionCall("load_skill", "{\"skill_name\":\"review\"}")),
                ToolMessage("loaded", "Ready", "load"),
                ToolStatus.Completed,
            )
        val running =
            ToolStep(
                ToolCall(
                    "execute",
                    FunctionCall(
                        "run_skill_script",
                        "{\"skill_name\":\"review\",\"path\":\"review.py\"}",
                    ),
                ),
                null,
                ToolStatus.Running,
            )
        var group by mutableStateOf(ExecutionGroup(SkillIdentity("review"), listOf(completed)))

        compose.setContent { PlaygroundTheme("light") { ToolGroupContent(group) } }

        compose.onNodeWithText("Parameters").assertDoesNotExist()

        compose.onNodeWithTag("tool-group-load").performClick()
        compose.onNodeWithText("Load a Skill").assertIsDisplayed()
        compose.onNodeWithText("Parameters").assertDoesNotExist()

        compose.onNodeWithTag("tool-step-load").performClick()
        compose.onNodeWithText("Parameters").assertIsDisplayed()

        compose.runOnIdle { group = group.copy(steps = listOf(completed, running)) }
        compose.onAllNodesWithText("Parameters").assertCountEquals(1)

        compose.onNodeWithTag("tool-step-execute").performClick()
        compose.onAllNodesWithText("Parameters").assertCountEquals(2)
        compose.onAllNodesWithText("Running").assertCountEquals(2)

        compose.runOnIdle {
            group =
                group.copy(
                    steps =
                        listOf(
                            completed,
                            running.copy(
                                status = ToolStatus.Failed,
                                result =
                                    ToolMessage(
                                        "failed",
                                        "",
                                        "execute",
                                        error = "The script failed.",
                                    ),
                            ),
                        )
                )
        }

        compose.onNodeWithText("The script failed.").assertIsDisplayed()
        compose.onAllNodesWithText("Failed").assertCountEquals(2)

        compose.onNodeWithTag("tool-group-load").performClick()
        compose.onNodeWithText("Parameters").assertDoesNotExist()
        compose.onNodeWithText("The script failed.").assertIsDisplayed()
        compose.onNodeWithText("Failed").assertIsDisplayed()
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

        compose.setContent {
            PlaygroundTheme("light") {
                AssistantTurnContent(current, ::fileDownload, ::documentDownload, {}, {})
            }
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
        compose.waitUntilDoesNotExist(hasTestTag("reasoning-content-user"))
        compose.onNodeWithTag("reasoning-content-user").assertDoesNotExist()

        compose.onNodeWithText("Reasoning").performClick()
        compose.onNodeWithTag("reasoning-content-user").assertExists()
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

        compose.setContent {
            PlaygroundTheme("light") { SourcesSheet(sources, "one", ::documentDownload, {}, {}) }
        }

        compose.onNodeWithTag("source-excerpt").performTouchInput { swipeUp() }
        compose.waitForIdle()

        val before =
            compose
                .onNodeWithTag("source-excerpt")
                .fetchSemanticsNode()
                .config[androidx.compose.ui.semantics.SemanticsProperties.VerticalScrollAxisRange]
                .value()

        assertTrue(before > 0f)

        compose.onNodeWithContentDescription("Next excerpt").performClick()

        val after =
            compose
                .onNodeWithTag("source-excerpt")
                .fetchSemanticsNode()
                .config[androidx.compose.ui.semantics.SemanticsProperties.VerticalScrollAxisRange]
                .value()

        assertEquals(0f, after)
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

        compose.setContent {
            PlaygroundTheme("light") {
                SourcesSheet(sources, "one", ::documentDownload, { download = it }, {})
            }
        }

        compose.onNodeWithText("First passage").assertIsDisplayed()

        compose.onNodeWithContentDescription("Next excerpt").performClick()
        compose.onNodeWithText("Second passage").assertIsDisplayed()

        compose.onNodeWithContentDescription("Choose document").performClick()
        compose.onNodeWithText("Guide B").performClick()
        compose.onNodeWithText("Other document").assertIsDisplayed()

        compose.onNodeWithContentDescription("Save original").performClick()

        assertEquals("Guide B", download?.name)
        assertEquals("/original/doc-b", download?.url)
    }

    private fun fileDownload(file: SkillFile): Download = Download("/file/${file.id}", file.name)

    private fun documentDownload(id: String, name: String): Download =
        Download("/original/$id", name)
}

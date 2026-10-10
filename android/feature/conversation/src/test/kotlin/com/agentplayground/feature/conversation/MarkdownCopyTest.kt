package com.agentplayground.feature.conversation

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import com.agentplayground.feature.conversation.ui.markdown.MarkdownCopyRegistry
import com.agentplayground.feature.conversation.ui.markdown.MarkdownCopySource
import com.agentplayground.feature.conversation.ui.markdown.fencedMarkdown
import com.agentplayground.feature.conversation.ui.markdown.inlineMarkdown
import com.agentplayground.feature.conversation.ui.markdown.markdownBlocks
import org.commonmark.node.FencedCodeBlock
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.flavours.gfm.GFMElementTypes
import org.intellij.markdown.flavours.gfm.GFMFlavourDescriptor
import org.intellij.markdown.flavours.gfm.GFMTokenTypes
import org.intellij.markdown.parser.MarkdownParser
import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownCopyTest {
    @Test
    fun `a complete selected paragraph carries its referenced definition only`() {
        val markdown =
            "Read [docs][api].\n\nUnselected paragraph.\n\n" +
                "[api]: https://example.com \"Documentation\"\n" +
                "[other]: https://other.example.com\n"
        val root = MarkdownParser(GFMFlavourDescriptor()).buildMarkdownTreeFromString(markdown)
        val source = MarkdownCopySource(markdown, root)
        val paragraphs = root.children.filter { it.type == MarkdownElementTypes.PARAGRAPH }
        val first = source.annotate(AnnotatedString("Read docs."), paragraphs[0])
        val last = source.annotate(AnnotatedString("Unselected paragraph."), paragraphs[1])
        val registry = MarkdownCopyRegistry().apply { add(source) }

        val copied = registry.copy(listOf(first), listOf(first, last))

        assertEquals(
            "Read [docs][api].\n\n[api]: https://example.com \"Documentation\"",
            copied,
        )
    }

    @Test
    fun `nested inline formatting closes at selection boundaries`() {
        val text = buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                append("bold ")
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append("both") }
                append(" bold")
            }
        }

        assertEquals("**bold *both* bold**", inlineMarkdown(text))
        assertEquals("***ot***", inlineMarkdown(text.subSequence(6, 8)))
    }

    @Test
    fun `a clipped link retains its destination`() {
        val text = buildAnnotatedString {
            withLink(LinkAnnotation.Url("https://example.com/a_(b)")) { append("documentation") }
        }

        assertEquals(
            "[doc](https://example.com/a_\\(b\\))",
            inlineMarkdown(text.subSequence(0, 3)),
        )
    }

    @Test
    fun `a link destination containing whitespace remains valid Markdown`() {
        val text = buildAnnotatedString {
            withLink(LinkAnnotation.Url("https://example.com/a b")) { append("doc") }
        }

        assertEquals("[doc](https://example.com/a%20b)", inlineMarkdown(text))
    }

    @Test
    fun `an entity shaped query parameter retains its literal value`() {
        val text = buildAnnotatedString {
            withLink(LinkAnnotation.Url("https://example.com/?q=&amp;")) { append("doc") }
        }

        assertEquals("[doc](https://example.com/?q=&amp;amp;)", inlineMarkdown(text))
    }

    @Test
    fun `inline code backticks are padded within surrounding prose`() {
        val text = buildAnnotatedString {
            append("Before ")
            withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append("`literal`") }
            append(" after")
        }

        assertEquals("Before `` `literal` `` after", inlineMarkdown(text))
    }

    @Test
    fun `inline code retains its meaningful surrounding spaces`() {
        val text = buildAnnotatedString {
            withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append(" padded ") }
        }

        assertEquals("`  padded  `", inlineMarkdown(text))
    }

    @Test
    fun `literal entity text stays literal when pasted as Markdown`() {
        assertEquals("&amp;amp;", inlineMarkdown(AnnotatedString("&amp;")))
    }

    @Test
    fun `rendered hard breaks remain hard breaks in partial copies`() {
        assertEquals("first  \nsecond", inlineMarkdown(AnnotatedString("first\nsecond")))
    }

    @Test
    fun `intraword emphasis remains emphasis`() {
        val text = buildAnnotatedString {
            append("a")
            withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append("b") }
            append("c")
        }

        assertEquals("a*b*c", inlineMarkdown(text))
    }

    @Test
    fun `a pipe in a selected table code span remains inside its cell`() {
        val markdown = "| Header |\n| --- |\n| `left\\|right` |"
        val root = MarkdownParser(GFMFlavourDescriptor()).buildMarkdownTreeFromString(markdown)
        val source = MarkdownCopySource(markdown, root)
        val table = root.children.single { it.type == GFMElementTypes.TABLE }
        val cells =
            table.children
                .filter {
                    it.type == GFMElementTypes.HEADER || it.type == GFMElementTypes.ROW
                }
                .flatMap { row -> row.children.filter { it.type == GFMTokenTypes.CELL } }
        val header = source.annotate(AnnotatedString("Header"), cells[0])
        val code = buildAnnotatedString {
            withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append("left|right") }
        }
        val body = source.annotate(code, cells[1])
        val registry = MarkdownCopyRegistry().apply { add(source) }

        assertEquals(
            "|  |\n| --- |\n| `left\\|right` |",
            registry.copy(listOf(body), listOf(header, body)),
        )
    }

    @Test
    fun `copied code allows backticks in its info without changing the code`() {
        val markdown = fencedMarkdown("chosen", "lang`extra")
        val code = markdownBlocks(markdown).single() as FencedCodeBlock

        assertEquals("lang`extra", code.info)
        assertEquals("chosen\n", code.literal)
    }

    @Test
    fun `a selected cell inside a quote retains its table and quote structure`() {
        val markdown = "> | Header |\n> | --- |\n> | chosen |\n\nAfter"
        val root = MarkdownParser(GFMFlavourDescriptor()).buildMarkdownTreeFromString(markdown)
        val source = MarkdownCopySource(markdown, root)
        val quote = root.children.single { it.type == MarkdownElementTypes.BLOCK_QUOTE }
        val table = quote.children.single { it.type == GFMElementTypes.TABLE }
        val cells =
            table.children
                .filter {
                    it.type == GFMElementTypes.HEADER || it.type == GFMElementTypes.ROW
                }
                .flatMap { row -> row.children.filter { it.type == GFMTokenTypes.CELL } }
        val header = source.annotate(AnnotatedString("Header"), cells[0])
        val body = source.annotate(AnnotatedString("chosen"), cells[1])
        val after =
            source.annotate(
                AnnotatedString("After"),
                root.children.single { it.type == MarkdownElementTypes.PARAGRAPH },
            )
        val registry = MarkdownCopyRegistry().apply { add(source) }

        assertEquals(
            "> |  |\n> | --- |\n> | chosen |",
            registry.copy(listOf(body), listOf(header, body, after)),
        )
    }

    @Test
    fun `a partial quoted code block retains its quote context`() {
        val markdown = "> ```kotlin\n> hello chosen\n> ```"
        val root = MarkdownParser(GFMFlavourDescriptor()).buildMarkdownTreeFromString(markdown)
        val source = MarkdownCopySource(markdown, root)
        val quote = root.children.single { it.type == MarkdownElementTypes.BLOCK_QUOTE }
        val code = quote.children.single { it.type == MarkdownElementTypes.CODE_FENCE }
        val full = source.annotate(AnnotatedString("hello chosen"), code)
        val registry = MarkdownCopyRegistry().apply { add(source) }

        assertEquals(
            "> ```kotlin\n> chosen\n> ```",
            registry.copy(listOf(full.subSequence(6, 12)), listOf(full)),
        )
    }
}

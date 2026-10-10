package com.agentplayground.feature.conversation

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.BaselineShift
import com.agentplayground.core.presentation.KnowledgeSource
import com.agentplayground.core.presentation.ReplySources
import com.agentplayground.feature.conversation.ui.markdown.replyMarkdownAnnotator
import com.mikepenz.markdown.annotator.DefaultAnnotatorSettings
import com.mikepenz.markdown.annotator.buildMarkdownAnnotatedString
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class KnowledgeCitationsTest {
    private val first = "11111111-1111-4111-8111-111111111111"
    private val second = "22222222-2222-4222-8222-222222222222"
    private val missing = "99999999-9999-4999-8999-999999999999"
    private val sources =
        ReplySources(
            true,
            listOf(
                KnowledgeSource(first, "doc", "Guide.pdf", 3, "Return within 30 days.", 1),
                KnowledgeSource(second, "doc", "Guide.pdf", 4, "Bring a receipt.", 2),
            ),
        )

    @Test
    fun `a URL used as a link label opens the outer destination`() {
        var opened: String? = null
        val rendered =
            render("See [https://label.example](https://target.example).") { opened = it }
        val link = rendered.getLinkAnnotations(0, rendered.length).single().item
        link.linkInteractionListener!!.onClick(link)

        assertEquals("https://target.example", opened)
    }

    @Test
    fun `code spans normalize line endings and trim one padded space around a tab`() {
        val rendered = render("`first\r\nsecond` and ` \t `") {}

        assertEquals("first second and \t", rendered.toString())
    }

    @Test
    fun `ordinary angle bracket links retain a clickable annotation`() {
        val rendered = render("See [website](<https://example.com>).") {}

        assertEquals(1, rendered.getLinkAnnotations(0, rendered.length).size)
    }

    @Test
    fun `numbered citations keep their exact targets and reuse a passage number`() {
        var opened: String? = null
        val markdown =
            "Receipt [source](#knowledge-source-$second). Returns [source](#knowledge-source-$first). Keep it [source](#knowledge-source-$second)."
        val rendered = render(markdown) { opened = it }

        assertEquals("Receipt [2]. Returns [1]. Keep it [2].", rendered.toString())
        val links = rendered.getLinkAnnotations(0, rendered.length).map { it.item }

        assertEquals(3, links.size)
        links.first().linkInteractionListener!!.onClick(links.first())
        assertEquals("#knowledge-source-$second", opened)
        val citation = links.first() as LinkAnnotation.Clickable

        assertEquals("Source 2: Guide.pdf, page 4", citation.tag)
        assertNull(citation.styles!!.style!!.textDecoration)
        assertEquals(0.8f, citation.styles!!.style!!.fontSize.value)
        assertEquals(BaselineShift.Superscript, citation.styles!!.style!!.baselineShift)
    }

    @Test
    fun `angle bracket citations keep numbering and open the saved passage`() {
        var opened: String? = null
        val rendered = render("See [source](<#knowledge-source-$second>).") { opened = it }

        assertEquals("See [2].", rendered.toString())
        val link = rendered.getLinkAnnotations(0, rendered.length).single().item
        link.linkInteractionListener!!.onClick(link)
        assertEquals("#knowledge-source-$second", opened)
    }

    @Test
    fun `unavailable citations stay explicit while normal links and code retain Markdown rendering`() {
        var opened: String? = null
        val literal = "[source](#knowledge-source-$first)"
        val markdown =
            "Missing [source](#knowledge-source-$missing). See [website](https://example.com). Literal: `$literal`. Invalid [source](#knowledge-source-$first?extra)."
        val rendered = render(markdown) { opened = it }
        val links = rendered.getLinkAnnotations(0, rendered.length).map { it.item }

        assertTrue(rendered.toString().startsWith("Missing [?]. See website."))
        assertTrue(rendered.toString().contains(literal))
        assertTrue(rendered.toString().endsWith("Invalid source."))
        assertEquals(3, links.size)
        links[1].linkInteractionListener!!.onClick(links[1])
        assertEquals("https://example.com", opened)
    }

    private fun render(content: String, onLink: (String) -> Unit) =
        content.buildMarkdownAnnotatedString(
            style = TextStyle.Default,
            annotatorSettings =
                DefaultAnnotatorSettings(
                    linkTextSpanStyle = TextLinkStyles(),
                    codeSpanStyle = SpanStyle(),
                    annotator =
                        replyMarkdownAnnotator(sources, Color.Blue, SpanStyle(), onLink = onLink),
                    linkInteractionListener = { onLink((it as LinkAnnotation.Url).url) },
                ),
        )
}

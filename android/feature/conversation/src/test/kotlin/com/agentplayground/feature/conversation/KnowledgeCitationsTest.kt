package com.agentplayground.feature.conversation

import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.ClickableSpan
import android.widget.TextView
import com.agentplayground.core.presentation.KnowledgeSource
import com.agentplayground.core.presentation.ReplySources
import com.agentplayground.feature.conversation.ui.markdown.KnowledgeCitationsPlugin
import com.agentplayground.feature.conversation.ui.markdown.markdownBlocks
import com.agentplayground.feature.conversation.ui.markdown.renderMarkdownBlock
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.MarkwonConfiguration
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
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
    fun `numbered citations keep their exact targets and reuse a passage number`() {
        var opened: String? = null
        val renderer = renderer { opened = it }
        val markdown =
            "Receipt [source](#knowledge-source-$second). Returns [source](#knowledge-source-$first). Keep it [source](#knowledge-source-$second)."
        val rendered = renderMarkdownBlock(renderer, markdownBlocks(markdown).single())

        assertEquals("Receipt [2]. Returns [1]. Keep it [2].", rendered.toString())
        val links = rendered.getSpans(0, rendered.length, ClickableSpan::class.java)

        assertEquals(3, links.size)
        links.first().onClick(TextView(RuntimeEnvironment.getApplication()))
        assertEquals("#knowledge-source-$second", opened)
        val start = rendered.getSpanStart(links.first())
        val end = rendered.getSpanEnd(links.first())
        val paint = TextPaint().apply { textSize = 16f }

        rendered.getSpans(start, end, CharacterStyle::class.java).forEach {
            it.updateDrawState(paint)
        }
        assertFalse("Citations should not look like ordinary links", paint.isUnderlineText)
        assertTrue(paint.textSize < 16f)
        assertTrue(paint.baselineShift < 0)
    }

    @Test
    fun `unavailable citations stay explicit while normal links and code retain Markdown rendering`() {
        var opened: String? = null
        val renderer = renderer { opened = it }
        val literal = "[source](#knowledge-source-$first)"
        val markdown =
            "Missing [source](#knowledge-source-$missing). See [website](https://example.com). Literal: `$literal`. Invalid [source](#knowledge-source-$first?extra)."
        val rendered = renderMarkdownBlock(renderer, markdownBlocks(markdown).single())
        val links = rendered.getSpans(0, rendered.length, ClickableSpan::class.java)

        assertTrue(rendered.toString().startsWith("Missing [?]. See website."))
        assertTrue(rendered.toString().contains(literal))
        assertTrue(rendered.toString().endsWith("Invalid source."))
        assertEquals(3, links.size)
        links[1].onClick(TextView(RuntimeEnvironment.getApplication()))
        assertEquals("https://example.com", opened)
    }

    private fun renderer(onLink: (String) -> Unit): Markwon =
        Markwon.builder(RuntimeEnvironment.getApplication())
            .usePlugin(
                object : AbstractMarkwonPlugin() {
                    override fun configureConfiguration(builder: MarkwonConfiguration.Builder) {
                        builder.linkResolver { _, link -> onLink(link) }
                    }
                }
            )
            .usePlugin(KnowledgeCitationsPlugin(sources, 0xFF3355AA.toInt()))
            .build()
}

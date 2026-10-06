package com.agentplayground.app.features.conversation

import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.RelativeSizeSpan
import android.text.style.SuperscriptSpan
import android.text.style.TtsSpan
import com.agentplayground.core.ReplySources
import com.agentplayground.core.knowledgeCitationId
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.MarkwonSpansFactory
import io.noties.markwon.MarkwonVisitor
import io.noties.markwon.core.CoreProps
import org.commonmark.node.Link

/** Keep citation IDs in links while presenting the reply's saved passage numbers. */
internal class KnowledgeCitationsPlugin(
    private val sources: ReplySources,
    private val foreground: Int,
) : AbstractMarkwonPlugin() {
    override fun configureVisitor(builder: MarkwonVisitor.Builder) {
        builder.on(Link::class.java) { visitor, link ->
            val start = visitor.length()

            if (knowledgeCitationId(link.destination) != null) {
                val number = sources.citation(link.destination)?.number

                visitor.builder().append("[${number ?: "?"}]")
            } else {
                visitor.visitChildren(link)
            }

            CoreProps.LINK_DESTINATION.set(visitor.renderProps(), link.destination)
            visitor.setSpansForNodeOptional(link, start)
        }
    }

    override fun configureSpansFactory(builder: MarkwonSpansFactory.Builder) {
        // Append to Markwon's link factory so its click resolution and ordinary links survive.
        builder.appendFactory(Link::class.java) { _, props ->
            val link = CoreProps.LINK_DESTINATION.require(props)

            if (knowledgeCitationId(link) == null) {
                null
            } else {
                val source = sources.citation(link)
                val spokenLabel =
                    if (source == null) {
                        "Source unavailable"
                    } else {
                        "Source ${source.number}: ${source.name}" +
                            source.page?.let { ", page $it" }.orEmpty()
                    }

                arrayOf(
                    RelativeSizeSpan(0.8f),
                    SuperscriptSpan(),
                    TtsSpan.TextBuilder(spokenLabel).build(),
                    object : CharacterStyle() {
                        override fun updateDrawState(paint: TextPaint) {
                            paint.isUnderlineText = false
                            paint.color = foreground
                        }
                    },
                )
            }
        }
    }
}

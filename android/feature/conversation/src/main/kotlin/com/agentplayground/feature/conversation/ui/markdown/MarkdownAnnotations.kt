package com.agentplayground.feature.conversation.ui.markdown

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.VerbatimTtsAnnotation
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.em
import com.agentplayground.domain.presentation.ReplySources
import com.agentplayground.domain.presentation.knowledgeCitationId
import com.mikepenz.markdown.annotator.DefaultAnnotatorSettings
import com.mikepenz.markdown.annotator.buildMarkdownAnnotatedString
import com.mikepenz.markdown.model.MarkdownAnnotator
import com.mikepenz.markdown.model.ReferenceLinkHandler
import com.mikepenz.markdown.model.markdownAnnotator
import com.mikepenz.markdown.utils.getUnescapedTextInNode
import com.mikepenz.markdown.utils.mapAutoLinkToType
import org.commonmark.internal.util.Escaping
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.MarkdownTokenTypes
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.ast.findChildOfType
import org.intellij.markdown.ast.getTextInNode

/** Preserve CommonMark text and saved passage targets when using the Compose renderer. */
internal fun replyMarkdownAnnotator(
    sources: ReplySources?,
    foreground: Color,
    codeStyle: SpanStyle,
    referenceLinks: ReferenceLinkHandler? = null,
    onLink: (String) -> Unit,
): MarkdownAnnotator {
    val linkStyles =
        TextLinkStyles(
            style = SpanStyle(color = foreground, textDecoration = TextDecoration.Underline)
        )
    lateinit var annotator: MarkdownAnnotator

    annotator = markdownAnnotator { content, node ->
        if (node.type == MarkdownElementTypes.CODE_SPAN) {
            val first = node.children.first()
            val last = node.children.last()
            val literal =
                content
                    .substring(first.endOffset, last.startOffset)
                    .replace("\r\n", "\n")
                    .replace('\r', '\n')
                    .replace('\n', ' ')
            val code =
                if (literal.startsWith(' ') && literal.endsWith(' ') && literal.any { it != ' ' }) {
                    literal.substring(1, literal.length - 1)
                } else {
                    literal
                }

            withStyle(codeStyle) { append(code) }
            true
        } else if (node.type == MarkdownTokenTypes.TEXT) {
            append(Escaping.unescapeString(node.getTextInNode(content).toString()))
            true
        } else {
            val destination = citationDestination(content, node, referenceLinks)

            if (
                sources != null && destination != null && knowledgeCitationId(destination) != null
            ) {
                val source = sources.citation(destination)
                val label =
                    if (source == null) {
                        "Source unavailable"
                    } else {
                        "Source ${source.number}: ${source.name}" +
                            source.page?.let { ", page $it" }.orEmpty()
                    }

                val start = length
                pushTtsAnnotation(VerbatimTtsAnnotation(label))
                withLink(
                    LinkAnnotation.Clickable(
                        tag = label,
                        styles =
                            TextLinkStyles(
                                style =
                                    SpanStyle(
                                        color = foreground,
                                        fontSize = 0.8.em,
                                        baselineShift = BaselineShift.Superscript,
                                    )
                            ),
                        linkInteractionListener = { onLink(destination) },
                    )
                ) {
                    append("[${source?.number ?: "?"}]")
                }
                pop()
                addStringAnnotation(MarkdownCopyLinkTag, destination, start, length)

                true
            } else if (node.type == MarkdownElementTypes.INLINE_LINK && destination != null) {
                val linkText = node.findChildOfType(MarkdownElementTypes.LINK_TEXT)!!
                val settings =
                    DefaultAnnotatorSettings(linkStyles, codeStyle, annotator, referenceLinks)

                withLink(LinkAnnotation.Url(destination, linkStyles) { onLink(destination) }) {
                    buildMarkdownAnnotatedString(
                        content,
                        linkText.children.drop(1).dropLast(1).mapAutoLinkToType(),
                        settings,
                    )
                }

                true
            } else {
                false
            }
        }
    }

    return annotator
}

internal fun normalizeMarkdownDestination(destination: String): String =
    Escaping.unescapeString(destination.removeSurrounding("<", ">"))

private fun citationDestination(
    content: String,
    node: ASTNode,
    referenceLinks: ReferenceLinkHandler?,
): String? {
    val destination =
        when (node.type) {
            MarkdownElementTypes.INLINE_LINK ->
                (node.findChildOfType(MarkdownElementTypes.LINK_DESTINATION)
                        ?: node.findChildOfType(MarkdownElementTypes.AUTOLINK))
                    ?.getTextInNode(content)
                    ?.toString()

            MarkdownElementTypes.FULL_REFERENCE_LINK,
            MarkdownElementTypes.SHORT_REFERENCE_LINK -> {
                val label =
                    node
                        .findChildOfType(MarkdownElementTypes.LINK_LABEL)
                        ?.getUnescapedTextInNode(content)

                label?.let { referenceLinks?.find(it) }?.takeIf { it.isNotEmpty() }
            }

            else -> null
        }

    return destination?.let(::normalizeMarkdownDestination)
}

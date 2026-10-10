package com.agentplayground.feature.conversation.ui.markdown

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import java.util.UUID
import org.commonmark.internal.util.Escaping
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.MarkdownTokenTypes
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.ast.findChildOfType
import org.intellij.markdown.ast.getTextInNode
import org.intellij.markdown.flavours.gfm.GFMElementTypes
import org.intellij.markdown.flavours.gfm.GFMTokenTypes

private const val MarkdownCopyTag = "reply-markdown-source"
internal const val MarkdownCopyLinkTag = "reply-markdown-link"

/** Source identities survive AnnotatedString slicing, including repeated text and table cells. */
internal class MarkdownCopySource(
    val content: String,
    private val root: ASTNode,
    val id: String = UUID.randomUUID().toString(),
) {
    private val nodes = buildMap {
        fun collect(node: ASTNode) {
            put(key(node), node)
            node.children.forEach(::collect)
        }

        collect(root)
    }

    fun annotate(text: AnnotatedString, node: ASTNode): AnnotatedString =
        AnnotatedString.Builder(text)
            .apply {
                addStringAnnotation(MarkdownCopyTag, key(node), 0, text.length)
            }
            .toAnnotatedString()

    fun node(key: String): ASTNode? = nodes[key]

    fun block(node: ASTNode): ASTNode {
        var block = node

        while (block.parent != null && block.parent !== root) {
            block = block.parent!!
        }

        return block
    }

    fun raw(node: ASTNode): String = node.getTextInNode(content).toString().trimEnd('\r', '\n')

    fun definitionsFor(blocks: List<ASTNode>): List<String> {
        val labels = mutableSetOf<String>()

        fun collect(node: ASTNode) {
            if (
                node.type == MarkdownElementTypes.FULL_REFERENCE_LINK ||
                    node.type == MarkdownElementTypes.SHORT_REFERENCE_LINK
            ) {
                node.findChildOfType(MarkdownElementTypes.LINK_LABEL)?.let {
                    labels.add(referenceLabel(it))
                }
            }

            node.children.forEach(::collect)
        }

        blocks.forEach(::collect)

        return nodes.values
            .filter { node ->
                node.type == MarkdownElementTypes.LINK_DEFINITION &&
                    node.findChildOfType(MarkdownElementTypes.LINK_LABEL)?.let(::referenceLabel) in
                        labels
            }
            .map(::raw)
    }

    private fun referenceLabel(node: ASTNode): String =
        Escaping.normalizeLabelContent(
            node.getTextInNode(content).toString().removeSurrounding("[", "]")
        )

    private fun key(node: ASTNode): String =
        "$id:${node.type}:${node.startOffset}:${node.endOffset}"
}

internal class MarkdownCopyRegistry {
    private val sources = mutableMapOf<String, MarkdownCopySource>()

    fun add(source: MarkdownCopySource) {
        sources[source.id] = source
    }

    fun remove(source: MarkdownCopySource) {
        sources.remove(source.id, source)
    }

    fun copy(selected: List<AnnotatedString>, all: List<AnnotatedString>): String? {
        val selectedFragments = selected.mapNotNull(::fragment)
        val allFragments = all.mapNotNull(::fragment)

        if (selectedFragments.isEmpty()) {
            return null
        }

        return selectedFragments
            .groupBy { it.source }
            .map { (source, fragments) ->
                val available = allFragments.filter { it.source === source }

                if (fullySelected(fragments, available)) {
                    source.content
                } else {
                    val rawBlocks = mutableListOf<ASTNode>()
                    val blocks =
                        fragments
                            .groupBy { source.block(it.node) }
                            .map { (block, parts) ->
                                val blockFragments = available.filter {
                                    source.block(it.node) === block
                                }

                                if (fullySelected(parts, blockFragments)) {
                                    rawBlocks.add(block)
                                    source.raw(block)
                                } else {
                                    copyPartialBlock(parts)
                                }
                            }
                    (blocks + source.definitionsFor(rawBlocks)).joinToString("\n\n")
                }
            }
            .joinToString("\n\n")
    }

    private fun fragment(text: AnnotatedString): MarkdownCopyFragment? {
        val annotation =
            text.getStringAnnotations(MarkdownCopyTag, 0, text.length).singleOrNull() ?: return null
        val source = sources[annotation.item.substringBefore(':')] ?: return null
        val node = source.node(annotation.item) ?: return null

        return MarkdownCopyFragment(
            source,
            node,
            text.subSequence(annotation.start, annotation.end),
        )
    }
}

private data class MarkdownCopyFragment(
    val source: MarkdownCopySource,
    val node: ASTNode,
    val text: AnnotatedString,
)

private fun fullySelected(
    selected: List<MarkdownCopyFragment>,
    available: List<MarkdownCopyFragment>,
): Boolean =
    available.isNotEmpty() &&
        selected.size == available.size &&
        selected.zip(available).all { (part, full) ->
            part.node === full.node && part.text.text == full.text.text
        }

private fun copyPartialBlock(parts: List<MarkdownCopyFragment>): String =
    parts
        .groupBy { part ->
            generateSequence(part.node) { it.parent }
                .firstOrNull { it.type == GFMElementTypes.TABLE } ?: part.node
        }
        .map { (node, fragments) ->
            if (node.type == GFMElementTypes.TABLE) {
                withBlockContext(node, fragments.first().source.content, copyTable(node, fragments))
            } else {
                copyFragment(fragments.single())
            }
        }
        .joinToString("\n\n")

private fun copyFragment(fragment: MarkdownCopyFragment): String {
    val node = fragment.node
    val content = fragment.source.content

    if (
        node.type == MarkdownElementTypes.CODE_FENCE || node.type == MarkdownElementTypes.CODE_BLOCK
    ) {
        val language =
            if (node.type == MarkdownElementTypes.CODE_FENCE) {
                // Preserve the entire info string, including attributes after the language name.
                Regex("^[ \\t]*(`{3,}|~{3,})[ \\t]*(.*)$")
                    .matchEntire(
                        node.getTextInNode(content).toString().substringBefore('\n').trimEnd('\r')
                    )
                    ?.groupValues
                    ?.get(2)
                    ?.trim()
                    .orEmpty()
            } else {
                ""
            }
        return withBlockContext(node, content, fencedMarkdown(fragment.text.text, language))
    }

    val heading =
        when (node.type) {
            MarkdownElementTypes.ATX_1,
            MarkdownElementTypes.SETEXT_1 -> "# "
            MarkdownElementTypes.ATX_2,
            MarkdownElementTypes.SETEXT_2 -> "## "
            MarkdownElementTypes.ATX_3 -> "### "
            MarkdownElementTypes.ATX_4 -> "#### "
            MarkdownElementTypes.ATX_5 -> "##### "
            MarkdownElementTypes.ATX_6 -> "###### "
            else -> ""
        }
    return withBlockContext(node, content, heading + inlineMarkdown(fragment.text))
}

private fun withBlockContext(node: ASTNode, content: String, markdown: String): String {
    val ancestors = generateSequence(node.parent) { it.parent }.toList().asReversed()
    val quote = "> ".repeat(ancestors.count { it.type == MarkdownElementTypes.BLOCK_QUOTE })
    val item = ancestors.lastOrNull { it.type == MarkdownElementTypes.LIST_ITEM }
    val marker =
        item
            ?.children
            ?.firstOrNull {
                it.type == MarkdownTokenTypes.LIST_BULLET ||
                    it.type == MarkdownTokenTypes.LIST_NUMBER
            }
            ?.getTextInNode(content)
            ?.toString()
            ?.plus(" ")
            .orEmpty()
    val continuation = quote + " ".repeat(marker.length)

    return quote + marker + markdown.replace("\n", "\n$continuation")
}

private fun copyTable(
    table: ASTNode,
    selected: List<MarkdownCopyFragment>,
): String {
    val rows =
        table.children
            .filter {
                it.type == GFMElementTypes.HEADER || it.type == GFMElementTypes.ROW
            }
            .map { row -> row.children.filter { it.type == GFMTokenTypes.CELL } }
    val columns = rows.maxOfOrNull { it.size } ?: return ""
    val parts = selected.associateBy { it.node }

    fun row(cells: List<ASTNode>): String =
        (0 until columns).joinToString(" | ", prefix = "| ", postfix = " |") { column ->
            val cell = cells.getOrNull(column)
            val part = parts[cell]

            if (part == null) {
                ""
            } else {
                inlineMarkdown(part.text, tableCell = true)
            }
        }

    val header = row(rows.first())
    val separator = List(columns) { "---" }.joinToString(" | ", prefix = "| ", postfix = " |")
    val body = rows.drop(1).filter { cells -> cells.any { it in parts } }.map(::row)

    return (listOf(header, separator) + body).joinToString("\n")
}

private data class MarkdownDelimiter(val open: String, val close: String = open)

internal fun fencedMarkdown(code: String, info: String): String {
    // CommonMark forbids backticks in a backtick fence's info string.
    val marker = if ('`' in info) '~' else '`'
    val fence = marker.toString().repeat(maxOf(3, longestRun(code, marker) + 1))

    return "$fence$info\n${code.trimEnd('\n')}\n$fence"
}

/** Serialize clipped inline formatting without pulling unselected words from the source. */
internal fun inlineMarkdown(text: AnnotatedString, tableCell: Boolean = false): String {
    val codeDelimiters =
        text.spanStyles
            .filter { it.item.fontFamily == FontFamily.Monospace }
            .map { span ->
                val code = text.text.substring(span.start, span.end)
                val fence = "`".repeat(longestRun(code, '`') + 1)
                val needsPadding =
                    code.startsWith('`') ||
                        code.endsWith('`') ||
                        (code.startsWith(' ') && code.endsWith(' ') && code.any { it != ' ' })
                val padding = if (needsPadding) " " else ""

                span to MarkdownDelimiter(fence + padding, padding + fence)
            }
    val links = text.getLinkAnnotations(0, text.length)
    val citations = text.getStringAnnotations(MarkdownCopyLinkTag, 0, text.length)
    val delimiters =
        (text.indices).map { offset ->
            buildList {
                val link = links.firstOrNull { offset >= it.start && offset < it.end }?.item
                val destination =
                    if (link is LinkAnnotation.Url) link.url
                    else citations.firstOrNull { offset >= it.start && offset < it.end }?.item

                if (destination != null) {
                    val escapedDestination =
                        Escaping.percentEncodeUrl(destination)
                            .replace("&", "&amp;")
                            .replace("(", "\\(")
                            .replace(")", "\\)")
                    add(MarkdownDelimiter("[", "]($escapedDestination)"))
                }

                val styles =
                    text.spanStyles.filter { offset >= it.start && offset < it.end }.map { it.item }

                if (styles.any { (it.fontWeight ?: FontWeight.Normal) >= FontWeight.Bold }) {
                    add(MarkdownDelimiter("**"))
                }

                if (styles.any { it.fontStyle == FontStyle.Italic }) {
                    add(MarkdownDelimiter("*"))
                }

                if (
                    styles.any { it.textDecoration?.contains(TextDecoration.LineThrough) == true }
                ) {
                    add(MarkdownDelimiter("~~"))
                }

                codeDelimiters
                    .firstOrNull { (span, _) -> offset >= span.start && offset < span.end }
                    ?.let { add(it.second) }
            }
        }
    val result = StringBuilder()
    var open = emptyList<MarkdownDelimiter>()

    for (offset in text.indices) {
        var next = delimiters[offset]

        val inCode = next.lastOrNull()?.open?.startsWith('`') == true

        if (text[offset].isWhitespace() && !inCode) {
            val before = (offset - 1 downTo 0).firstOrNull { !text[it].isWhitespace() }
            val after = (offset + 1 until text.length).firstOrNull { !text[it].isWhitespace() }
            next =
                if (before == null || after == null) emptyList()
                else commonDelimiters(delimiters[before], delimiters[after])
        }

        val common = commonDelimiters(open, next).size
        open.drop(common).asReversed().forEach { result.append(it.close) }
        next.drop(common).forEach { result.append(it.open) }
        open = next

        val character = text[offset]
        val code = next.lastOrNull()?.open?.startsWith('`') == true

        if ((tableCell && character == '|') || (!code && character in "\\`*_{}[]<>|#+-.!()")) {
            result.append('\\')
        }

        if (!code && character == '\n') {
            result.append(if (tableCell) "<br>" else "  \n")
        } else if (!code && character == '&') {
            result.append("&amp;")
        } else {
            result.append(character)
        }
    }

    open.asReversed().forEach { result.append(it.close) }

    return result.toString()
}

private fun commonDelimiters(
    first: List<MarkdownDelimiter>,
    second: List<MarkdownDelimiter>,
): List<MarkdownDelimiter> = first.zip(second).takeWhile { (a, b) -> a == b }.map { it.first }

private fun longestRun(text: String, marker: Char): Int =
    Regex("$marker+").findAll(text).maxOfOrNull { it.value.length } ?: 0

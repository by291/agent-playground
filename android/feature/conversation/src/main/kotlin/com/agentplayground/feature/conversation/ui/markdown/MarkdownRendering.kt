package com.agentplayground.feature.conversation.ui.markdown

import android.text.SpannableString
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.SpannedString
import android.text.style.ForegroundColorSpan
import com.agentplayground.ui.codeSyntaxTheme
import dev.snipme.highlights.Highlights
import dev.snipme.highlights.model.ColorHighlight
import dev.snipme.highlights.model.SyntaxLanguage
import io.noties.markwon.Markwon
import io.noties.markwon.ext.tables.TableRowSpan
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.*
import org.commonmark.node.*
import org.commonmark.parser.Parser

/** Render each cell's inline children without TablePlugin's canvas-only row spans. */
internal fun renderMarkdownCell(renderer: Markwon, cell: TableCell): Spanned {
    val result = SpannableStringBuilder()
    var child = cell.firstChild

    while (child != null) {
        result.append(renderer.render(child))
        child = child.next
    }

    return SpannedString(result)
}

internal fun markdownTableRows(table: TableBlock): List<List<TableCell>> {
    val rows = mutableListOf<List<TableCell>>()

    table.accept(
        object : AbstractVisitor() {
            override fun visit(node: CustomNode) {
                if (node is TableRow) {
                    val cells = mutableListOf<TableCell>()
                    var cell = node.firstChild

                    while (cell != null) {
                        if (cell is TableCell) {
                            cells.add(cell)
                        }

                        cell = cell.next
                    }

                    rows.add(cells)
                } else {
                    visitChildren(node)
                }
            }
        }
    )

    return rows
}

/** Markdown structure comes from CommonMark, including escaped pipes and inline table content. */
internal fun markdownBlocks(content: String): List<Node> {
    val document =
        Parser.builder()
            .extensions(listOf(TablesExtension.create(), StrikethroughExtension.create()))
            .build()
            .parse(content)
    val blocks = mutableListOf<Node>()
    var child = document.firstChild

    while (child != null) {
        blocks.add(child)
        child = child.next
    }

    return blocks
}

internal fun markdownCopyTargets(node: Node): List<Node> {
    val targets = mutableListOf<Node>()

    fun collect(current: Node) {
        if (copyableMarkdown(current) != null) {
            targets.add(current)
            return
        }

        var child = current.firstChild

        while (child != null) {
            collect(child)
            child = child.next
        }
    }

    collect(node)

    return targets
}

internal fun copyableMarkdown(node: Node): String? =
    when (node) {
        is FencedCodeBlock -> node.literal
        is IndentedCodeBlock -> node.literal
        is TableBlock -> {
            val rows = mutableListOf<String>()

            node.accept(
                object : AbstractVisitor() {
                    override fun visit(customBlock: CustomNode) {
                        if (customBlock is TableRow) {
                            val cells = mutableListOf<String>()
                            var cell = customBlock.firstChild

                            while (cell != null) {
                                cells.add(plainMarkdown(cell).replace("\t", " ").replace("\n", " "))
                                cell = cell.next
                            }

                            rows.add(cells.joinToString("\t"))
                        } else {
                            visitChildren(customBlock)
                        }
                    }
                }
            )

            rows.joinToString("\n")
        }

        else -> null
    }

private fun plainMarkdown(node: Node): String {
    val text = StringBuilder()

    node.accept(
        object : AbstractVisitor() {
            override fun visit(node: org.commonmark.node.Text) {
                text.append(node.literal)
            }

            override fun visit(node: Code) {
                text.append(node.literal)
            }

            override fun visit(node: SoftLineBreak) {
                text.append(' ')
            }

            override fun visit(node: HardLineBreak) {
                text.append(' ')
            }
        }
    )

    return text.toString()
}

internal fun highlightCode(info: String?, code: String, dark: Boolean): CharSequence {
    val name = info?.trim()?.substringBefore(' ')?.lowercase() ?: return code
    val alias =
        when (name) {
            "js" -> "JAVASCRIPT"
            "ts" -> "TYPESCRIPT"
            "py" -> "PYTHON"
            "kt",
            "kts" -> "KOTLIN"
            "sh",
            "bash",
            "zsh" -> "SHELL"
            "c++",
            "cpp" -> "CPP"
            "c#",
            "cs" -> "CSHARP"
            else -> name.uppercase()
        }
    val language = SyntaxLanguage.entries.find { it.name == alias } ?: return code

    return runCatching {
            val result = SpannableString(code)
            val highlights =
                Highlights.Builder()
                    .code(code)
                    .language(language)
                    .theme(codeSyntaxTheme(dark))
                    .build()
                    .getHighlights()

            highlights.filterIsInstance<ColorHighlight>().forEach { range ->
                if (
                    range.location.start >= 0 &&
                        range.location.end <= code.length &&
                        range.location.start < range.location.end
                ) {
                    result.setSpan(
                        ForegroundColorSpan(range.rgb or (0xFF shl 24)),
                        range.location.start,
                        range.location.end,
                        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                    )
                }
            }

            result
        }
        .getOrDefault(code)
}

internal fun renderMarkdownBlock(renderer: Markwon, block: Node): Spanned {
    val parsed = renderer.render(block)

    // Table rows draw through spans on non-breaking spaces; retain their placeholders.
    return if (block is TableBlock) parsed else SpannedString(parsed.trimEnd('\n'))
}

internal fun hasVisibleMarkdown(rendered: Spanned): Boolean =
    rendered.toString().isNotBlank() ||
        rendered.getSpans(0, rendered.length, TableRowSpan::class.java).isNotEmpty()

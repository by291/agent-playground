package com.agentplayground.feature.conversation.ui.markdown

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import com.agentplayground.ui.codeSyntaxTheme
import dev.snipme.highlights.Highlights
import dev.snipme.highlights.model.ColorHighlight
import dev.snipme.highlights.model.SyntaxLanguage
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.*
import org.commonmark.node.*
import org.commonmark.parser.IncludeSourceSpans
import org.commonmark.parser.Parser

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
            .includeSourceSpans(IncludeSourceSpans.BLOCKS)
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

internal fun plainMarkdown(node: Node): String {
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

internal fun highlightCode(info: String?, code: String, dark: Boolean): AnnotatedString {
    val plain = AnnotatedString(code)
    val name = info?.trim()?.substringBefore(' ')?.lowercase() ?: return plain
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
    val language = SyntaxLanguage.entries.find { it.name == alias } ?: return plain

    return runCatching {
            val result = AnnotatedString.Builder(code)
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
                    result.addStyle(
                        SpanStyle(color = Color(range.rgb or (0xFF shl 24))),
                        range.location.start,
                        range.location.end,
                    )
                }
            }

            result.toAnnotatedString()
        }
        .getOrDefault(plain)
}

internal fun markdownLine(content: String, offset: Int): Int =
    content.take(offset).count { it == '\n' }

internal fun hasVisibleMarkdown(node: Node): Boolean {
    var visible = false

    node.accept(
        object : AbstractVisitor() {
            override fun visit(node: org.commonmark.node.Text) {
                visible = visible || node.literal.isNotBlank()
            }

            override fun visit(node: Code) {
                visible = visible || node.literal.isNotBlank()
            }

            override fun visit(node: FencedCodeBlock) {
                visible = visible || node.literal.isNotBlank()
            }

            override fun visit(node: IndentedCodeBlock) {
                visible = visible || node.literal.isNotBlank()
            }
        }
    )

    return visible
}

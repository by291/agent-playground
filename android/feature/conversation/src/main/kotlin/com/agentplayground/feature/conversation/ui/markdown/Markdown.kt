package com.agentplayground.feature.conversation.ui.markdown

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.agentplayground.core.presentation.ReplySources
import com.agentplayground.ui.ChangingContent
import com.mikepenz.markdown.annotator.annotatorSettings
import com.mikepenz.markdown.annotator.buildMarkdownAnnotatedString
import com.mikepenz.markdown.compose.Markdown as ComposeMarkdown
import com.mikepenz.markdown.compose.MarkdownElement
import com.mikepenz.markdown.compose.components.MarkdownComponent
import com.mikepenz.markdown.compose.components.markdownComponents
import com.mikepenz.markdown.compose.elements.MarkdownBlockQuote
import com.mikepenz.markdown.compose.elements.MarkdownCodeBlock
import com.mikepenz.markdown.compose.elements.MarkdownCodeFence
import com.mikepenz.markdown.compose.elements.MarkdownTable as ComposeMarkdownTable
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.State as MarkdownParseState
import com.mikepenz.markdown.model.markdownAnimations
import com.mikepenz.markdown.model.markdownPadding
import com.mikepenz.markdown.model.rememberMarkdownState
import kotlinx.coroutines.delay
import org.commonmark.ext.gfm.tables.*
import org.commonmark.node.*
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.MarkdownTokenTypes
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.flavours.gfm.GFMElementTypes
import org.intellij.markdown.flavours.gfm.GFMTokenTypes

@Composable
internal fun Markdown(
    content: String,
    onLink: (String) -> Unit,
    settled: Boolean = true,
    onTextVisible: (() -> Unit)? = null,
    subdued: Boolean = false,
    citations: ReplySources? = null,
) {
    val colors = MaterialTheme.colorScheme
    val dark = colors.surface.luminance() < 0.5f
    val callback by rememberUpdatedState(onLink)
    val state by
        rememberMarkdownState(content, retainState = true, immediate = true).state.collectAsState()
    val renderedContent = (state as? MarkdownParseState.Success)?.content.orEmpty()
    val blocks = remember(renderedContent) { markdownBlocks(renderedContent) }
    val panels =
        remember(blocks) {
            blocks.flatMap(::markdownCopyTargets).associateBy { it.sourceSpans.first().lineIndex }
        }
    val body =
        MaterialTheme.typography.bodyLarge.copy(
            fontSize = if (subdued) 14.sp else 16.sp,
            lineHeight = if (subdued) 21.sp else 24.sp,
            color = if (subdued) colors.onSurfaceVariant else colors.onSurface,
        )
    val typography =
        markdownTypography(
            h1 = body.copy(fontSize = 24.sp, lineHeight = 36.sp, fontWeight = FontWeight.Bold),
            h2 = body.copy(fontSize = 21.sp, lineHeight = 31.sp, fontWeight = FontWeight.Bold),
            h3 = body.copy(fontSize = 18.sp, lineHeight = 27.sp, fontWeight = FontWeight.Bold),
            h4 = body.copy(fontWeight = FontWeight.Bold),
            h5 = body.copy(fontWeight = FontWeight.Bold),
            h6 = body.copy(fontWeight = FontWeight.Bold),
            text = body,
            paragraph = body,
            ordered = body,
            bullet = body,
            list = body,
            quote = body,
            inlineCode =
                TextStyle(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 0.9.em,
                    color = colors.onSurfaceVariant,
                ),
            textLink =
                TextLinkStyles(
                    style =
                        SpanStyle(color = colors.primary, textDecoration = TextDecoration.Underline)
                ),
        )
    val uriHandler = remember {
        object : UriHandler {
            override fun openUri(uri: String) {
                callback(normalizeMarkdownDestination(uri))
            }
        }
    }
    val annotator =
        remember(citations, colors.primary, typography.inlineCode, state.referenceLinkHandler) {
            replyMarkdownAnnotator(
                citations,
                colors.primary,
                typography.inlineCode.toSpanStyle(),
                state.referenceLinkHandler,
            ) {
                callback(it)
            }
        }
    val codeComponent: MarkdownComponent = { model ->
        when (val panel = panels[markdownLine(model.content, model.node.startOffset)]) {
            is FencedCodeBlock -> CodeBlock(panel.literal, panel.info, dark, settled)
            is IndentedCodeBlock -> CodeBlock(panel.literal, null, dark, settled)
            else -> {
                // Parser dialects can classify the same source differently; never discard text.
                if (model.node.type == MarkdownElementTypes.CODE_FENCE) {
                    MarkdownCodeFence(model.content, model.node) { code, info, _ ->
                        CodeBlock(code, info, dark, settled)
                    }
                } else {
                    MarkdownCodeBlock(model.content, model.node) { code, info, _ ->
                        CodeBlock(code, info, dark, settled)
                    }
                }
            }
        }
    }
    val components =
        markdownComponents(
            codeFence = codeComponent,
            codeBlock = codeComponent,
            blockQuote = { model ->
                Surface(shape = RoundedCornerShape(8.dp), color = colors.surfaceContainerLow) {
                    Box(Modifier.padding(12.dp)) {
                        MarkdownBlockQuote(model.content, model.node, style = body)
                    }
                }
            },
            table = { model ->
                val panel =
                    panels[markdownLine(model.content, model.node.startOffset)] as? TableBlock

                if (panel != null) {
                    MarkdownTable(model.content, model.node, panel, settled)
                } else {
                    ComposeMarkdownTable(model.content, model.node, body)
                }
            },
        )

    LaunchedEffect(renderedContent) {
        if (blocks.any(::hasVisibleMarkdown)) {
            onTextVisible?.invoke()
        }
    }

    CompositionLocalProvider(LocalUriHandler provides uriHandler) {
        // All reply text must register with one owner; Android TextViews cannot share a selection.
        MarkdownSelection {
            ComposeMarkdown(
                state = state,
                modifier = Modifier.fillMaxWidth(),
                colors =
                    markdownColor(
                        text = body.color,
                        inlineCodeBackground = Color.Transparent,
                        dividerColor = colors.outlineVariant,
                    ),
                typography = typography,
                padding = markdownPadding(block = 0.dp, blockQuote = PaddingValues(start = 16.dp)),
                annotator = annotator,
                components = components,
                animations = markdownAnimations(animateTextSize = { this }),
                success = { parsed, components, modifier ->
                    val nodes =
                        remember(parsed.node) {
                            parsed.node.children.filter {
                                it.type != MarkdownTokenTypes.EOL &&
                                    it.type != MarkdownTokenTypes.WHITE_SPACE &&
                                    it.type != MarkdownElementTypes.LINK_DEFINITION
                            }
                        }

                    // Space rendered blocks, not syntax nodes or the reply's first paragraph.
                    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        nodes.forEach { node ->
                            MarkdownElement(node, components, parsed.content, includeSpacer = false)
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun BlockHeader(label: String, copy: String, action: String, settled: Boolean) {
    DisableSelection {
        Row(
            Modifier.fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .padding(start = 16.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            CopyAction(copy, action, settled)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}

@Composable
private fun CopyAction(copy: String, label: String, settled: Boolean) {
    val context = LocalContext.current
    var copied by remember(copy) { mutableStateOf(false) }

    LaunchedEffect(copied) {
        if (copied) {
            delay(1800)
            copied = false
        }
    }

    TextButton(
        onClick = {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

            clipboard.setPrimaryClip(ClipData.newPlainText("Assistant reply", copy))
            copied = true
        },
        enabled = settled,
        colors =
            ButtonDefaults.textButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant
            ),
        contentPadding = PaddingValues(horizontal = 12.dp),
        modifier = Modifier.heightIn(min = 48.dp),
    ) {
        ChangingContent(copied) { complete ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (complete) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
                    null,
                    Modifier.size(16.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    if (complete) "Copied" else label,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

@Composable
private fun CodeBlock(
    code: String,
    info: String?,
    dark: Boolean,
    settled: Boolean,
) {
    val colors = MaterialTheme.colorScheme
    val highlighted = remember(code, info, dark) { highlightCode(info, code.trimEnd('\n'), dark) }

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = colors.surfaceContainerLow,
        border = BorderStroke(1.dp, colors.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            BlockHeader(
                info?.trim()?.substringBefore(' ')?.takeIf { it.isNotBlank() } ?: "Code",
                code,
                "Copy code",
                settled,
            )
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val minimumWidth = maxWidth

                Box(
                    Modifier.horizontalScroll(rememberScrollState()).testTag("markdown-code-scroll")
                ) {
                    Text(
                        highlighted,
                        modifier = Modifier.widthIn(min = minimumWidth).padding(16.dp),
                        style =
                            MaterialTheme.typography.bodyMedium.copy(
                                fontFamily = FontFamily.Monospace,
                                fontSize = 14.sp,
                                lineHeight = 21.sp,
                            ),
                        color = colors.onSurface,
                        softWrap = false,
                    )
                }
            }
        }
    }
}

@Composable
private fun MarkdownTable(
    content: String,
    node: ASTNode,
    table: TableBlock,
    settled: Boolean,
) {
    val colors = MaterialTheme.colorScheme
    val rows = remember(table) { markdownTableRows(table) }
    val cellNodes =
        remember(node) {
            node.children
                .filter { it.type == GFMElementTypes.HEADER || it.type == GFMElementTypes.ROW }
                .map { row -> row.children.filter { it.type == GFMTokenTypes.CELL } }
        }
    val columns = rows.maxOfOrNull { it.size } ?: return
    val settings = annotatorSettings()
    val cellStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp, lineHeight = 20.sp)

    if (columns == 0) {
        return
    }

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = colors.surface,
        border = BorderStroke(1.dp, colors.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            BlockHeader("Table", copyableMarkdown(table).orEmpty(), "Copy table", settled)
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val cellWidth = (maxWidth / columns).coerceAtLeast(140.dp)
                val cellWidthPx = with(LocalDensity.current) { cellWidth.toPx() }

                Column(
                    Modifier.horizontalScroll(rememberScrollState())
                        .testTag("markdown-table-scroll")
                        .width(cellWidth * columns)
                ) {
                    rows.forEachIndexed { index, row ->
                        val header = row.any { it.isHeader }
                        val background =
                            when {
                                header -> colors.surfaceContainerLow
                                index % 2 == 0 -> colors.surfaceContainerLow.copy(alpha = 0.6f)
                                else -> colors.surface
                            }

                        Row(
                            Modifier.fillMaxWidth().background(background).drawBehind {
                                for (column in 1 until columns) {
                                    val x = cellWidthPx * column

                                    drawLine(
                                        colors.outlineVariant,
                                        Offset(x, 0f),
                                        Offset(x, size.height),
                                        1.dp.toPx(),
                                    )
                                }
                            }
                        ) {
                            row.forEachIndexed { column, cell ->
                                val alignment =
                                    when (cell.alignment) {
                                        TableCell.Alignment.CENTER -> TextAlign.Center
                                        TableCell.Alignment.RIGHT -> TextAlign.End
                                        else -> TextAlign.Start
                                    }
                                val cellNode = cellNodes.getOrNull(index)?.getOrNull(column)
                                val text =
                                    if (cellNode == null) {
                                        AnnotatedString(plainMarkdown(cell))
                                    } else {
                                        // Trim cell syntax, preserving whitespace inside code and
                                        // entities.
                                        val children =
                                            cellNode.children
                                                .dropWhile {
                                                    it.type == MarkdownTokenTypes.WHITE_SPACE
                                                }
                                                .dropLastWhile {
                                                    it.type == MarkdownTokenTypes.WHITE_SPACE
                                                }

                                        buildAnnotatedString {
                                            withStyle(cellStyle.toSpanStyle()) {
                                                buildMarkdownAnnotatedString(
                                                    content,
                                                    children,
                                                    settings,
                                                )
                                            }
                                        }
                                    }

                                Text(
                                    text,
                                    modifier =
                                        Modifier.width(cellWidth)
                                            .padding(horizontal = 12.dp, vertical = 14.dp)
                                            .semantics { if (header) heading() },
                                    style = cellStyle,
                                    fontWeight = if (header) FontWeight.Bold else FontWeight.Normal,
                                    textAlign = alignment,
                                    color = colors.onSurface,
                                )
                            }
                        }

                        if (index < rows.lastIndex) {
                            HorizontalDivider(color = colors.outlineVariant)
                        }
                    }
                }
            }
        }
    }
}

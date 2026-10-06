package com.agentplayground.app.features.conversation

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Typeface
import android.text.Spanned
import android.text.method.LinkMovementMethod
import android.view.Gravity
import android.widget.TextView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.ViewCompat
import com.agentplayground.app.design.ChangingContent
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.MarkwonConfiguration
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tables.TableTheme
import kotlinx.coroutines.delay
import org.commonmark.ext.gfm.tables.*
import org.commonmark.node.*

@Composable
fun Markdown(
    content: String,
    onLink: (String) -> Unit,
    settled: Boolean = true,
    onTextVisible: (() -> Unit)? = null,
    subdued: Boolean = false,
) {
    val colors = MaterialTheme.colorScheme
    val density = LocalDensity.current
    val dark = colors.surface.luminance() < 0.5f
    val callback by rememberUpdatedState(onLink)
    val context = LocalContext.current
    val blocks = remember(content) { markdownBlocks(content) }
    val renderer =
        remember(context, colors, density) {
            val margin = with(density) { 20.dp.roundToPx() }
            val codeSize = with(density) { 14.sp.roundToPx() }
            val tableTheme =
                TableTheme.Builder()
                    .tableBorderColor(colors.outlineVariant.toArgb())
                    .tableBorderWidth(with(density) { 1.dp.roundToPx() })
                    .tableCellPadding(with(density) { 12.dp.roundToPx() })
                    .tableHeaderRowBackgroundColor(colors.surfaceContainer.toArgb())
                    .tableEvenRowBackgroundColor(colors.surfaceContainerLow.toArgb())
                    .tableOddRowBackgroundColor(colors.surface.toArgb())
                    .build()

            Markwon.builder(context)
                .usePlugin(TablePlugin.create(tableTheme))
                .usePlugin(StrikethroughPlugin.create())
                .usePlugin(
                    object : AbstractMarkwonPlugin() {
                        override fun configureTheme(builder: MarkwonTheme.Builder) {
                            builder
                                .linkColor(colors.primary.toArgb())
                                .blockMargin(margin)
                                .blockQuoteWidth(with(density) { 3.dp.roundToPx() })
                                .blockQuoteColor(colors.primary.copy(alpha = 0.55f).toArgb())
                                .bulletWidth(with(density) { 4.dp.roundToPx() })
                                .listItemColor(colors.onSurfaceVariant.toArgb())
                                .codeTextColor(colors.onSurface.toArgb())
                                .codeBackgroundColor(colors.surfaceContainer.toArgb())
                                .codeBlockTextColor(colors.onSurface.toArgb())
                                .codeBlockBackgroundColor(colors.surfaceContainerLow.toArgb())
                                .codeTextSize(codeSize)
                                .codeBlockTextSize(codeSize)
                                .headingTextSizeMultipliers(
                                    floatArrayOf(1.5f, 1.3f, 1.15f, 1f, 1f, 1f)
                                )
                                .headingBreakHeight(0)
                                .thematicBreakColor(colors.outlineVariant.toArgb())
                                .thematicBreakHeight(with(density) { 1.dp.roundToPx() })
                        }

                        override fun configureConfiguration(builder: MarkwonConfiguration.Builder) {
                            builder.linkResolver { _, link -> callback(link) }
                            builder.syntaxHighlight { info, code ->
                                highlightCode(info, code, dark)
                            }
                        }
                    }
                )
                .build()
        }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        blocks.forEachIndexed { index, block ->
            when (block) {
                is FencedCodeBlock ->
                    CodeBlock(block.literal, block.info, dark, settled, onTextVisible)

                is IndentedCodeBlock -> CodeBlock(block.literal, null, dark, settled, onTextVisible)
                is TableBlock -> MarkdownTable(block, renderer, settled, onTextVisible)

                else ->
                    Column(Modifier.fillMaxWidth()) {
                        val rendered =
                            remember(renderer, block) { renderMarkdownBlock(renderer, block) }
                        val modifier =
                            if (block is Heading && index > 0) {
                                Modifier.padding(top = 10.dp)
                            } else {
                                Modifier
                            }

                        if (block is BlockQuote) {
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = colors.surfaceContainerLow,
                            ) {
                                MarkdownText(
                                    rendered,
                                    renderer,
                                    Modifier.fillMaxWidth().padding(12.dp),
                                    onTextVisible = onTextVisible,
                                    subdued = subdued,
                                )
                            }
                        } else {
                            MarkdownText(
                                rendered,
                                renderer,
                                modifier.fillMaxWidth(),
                                heading = block is Heading,
                                onTextVisible = onTextVisible,
                                subdued = subdued,
                            )
                        }

                        // Nested blocks stay with Markwon so list numbering and quote structure
                        // survive.
                        markdownCopyTargets(block).forEach { target ->
                            CopyAction(
                                copyableMarkdown(target).orEmpty(),
                                if (target is TableBlock) "Copy table" else "Copy code",
                                settled,
                            )
                        }
                    }
            }
        }
    }
}

@Composable
private fun MarkdownText(
    rendered: Spanned,
    renderer: Markwon,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    heading: Boolean = false,
    gravity: Int = Gravity.START,
    onTextVisible: (() -> Unit)? = null,
    subdued: Boolean = false,
) {
    val colors = MaterialTheme.colorScheme

    AndroidView(
        factory = { context ->
            TextView(context).apply {
                textSize = if (compact || subdued) 14f else 16f
                includeFontPadding = false
                setTextIsSelectable(true)
                movementMethod = LinkMovementMethod.getInstance()
                setLineSpacing(0f, if (compact) 1.45f else 1.5f)
            }
        },
        modifier = modifier,
        update = { view ->
            view.setTextColor((if (subdued) colors.onSurfaceVariant else colors.onSurface).toArgb())
            view.setLinkTextColor(colors.primary.toArgb())
            view.typeface = if (heading && compact) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            view.gravity = gravity
            ViewCompat.setAccessibilityHeading(view, heading)
            renderer.setParsedMarkdown(view, rendered)

            if (hasVisibleMarkdown(rendered)) {
                onTextVisible?.invoke()
            }
        },
    )
}

@Composable
private fun BlockHeader(label: String, copy: String, action: String, settled: Boolean) {
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
    onTextVisible: (() -> Unit)?,
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
                    AndroidView(
                        factory = { context ->
                            TextView(context).apply {
                                typeface = Typeface.MONOSPACE
                                textSize = 14f
                                includeFontPadding = false
                                setLineSpacing(0f, 1.5f)
                                setHorizontallyScrolling(true)
                                setTextIsSelectable(true)
                            }
                        },
                        modifier = Modifier.widthIn(min = minimumWidth).padding(16.dp),
                        update = { view ->
                            view.setTextColor(colors.onSurface.toArgb())
                            view.text = highlighted

                            if (code.isNotBlank()) {
                                onTextVisible?.invoke()
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun MarkdownTable(
    table: TableBlock,
    renderer: Markwon,
    settled: Boolean,
    onTextVisible: (() -> Unit)?,
) {
    val colors = MaterialTheme.colorScheme
    val rows = remember(table) { markdownTableRows(table) }
    val rendered =
        remember(table, renderer) {
            rows.map { row -> row.map { renderMarkdownCell(renderer, it) } }
        }
    val columns = rows.maxOfOrNull { it.size } ?: return

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
                                val gravity =
                                    when (cell.alignment) {
                                        TableCell.Alignment.CENTER -> Gravity.CENTER_HORIZONTAL
                                        TableCell.Alignment.RIGHT -> Gravity.END
                                        else -> Gravity.START
                                    }

                                MarkdownText(
                                    rendered[index][column],
                                    renderer,
                                    Modifier.width(cellWidth)
                                        .padding(horizontal = 12.dp, vertical = 14.dp),
                                    compact = true,
                                    heading = header,
                                    gravity = gravity,
                                    onTextVisible = onTextVisible,
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

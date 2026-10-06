package com.agentplayground.app.features.conversation

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.text.SpannableString
import android.text.Spanned
import android.text.SpannedString
import android.text.method.LinkMovementMethod
import android.text.style.ForegroundColorSpan
import android.widget.TextView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.agentplayground.app.design.Details
import com.agentplayground.app.design.StatusTag
import com.agentplayground.app.files.Download
import com.agentplayground.core.*
import com.agui.core.types.*
import dev.snipme.highlights.Highlights
import dev.snipme.highlights.model.ColorHighlight
import dev.snipme.highlights.model.SyntaxLanguage
import dev.snipme.highlights.model.SyntaxThemes
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.MarkwonConfiguration
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tables.TableRowSpan
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.*
import org.commonmark.node.AbstractVisitor
import org.commonmark.node.Code
import org.commonmark.node.CustomNode
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.HardLineBreak
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Node
import org.commonmark.node.SoftLineBreak
import org.commonmark.parser.Parser

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
                    .theme(SyntaxThemes.atom(dark))
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

@Composable
fun Markdown(
    content: String,
    onLink: (String) -> Unit,
    settled: Boolean = true,
    onTextVisible: (() -> Unit)? = null,
) {
    val color = MaterialTheme.colorScheme.onSurface.toArgb()
    val linkColor = MaterialTheme.colorScheme.primary.toArgb()
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val callback by rememberUpdatedState(onLink)
    val context = LocalContext.current
    val blocks = remember(content) { markdownBlocks(content) }
    val renderer =
        remember(context, dark) {
            Markwon.builder(context)
                .usePlugin(TablePlugin.create(context))
                .usePlugin(StrikethroughPlugin.create())
                .usePlugin(
                    object : AbstractMarkwonPlugin() {
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
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        blocks.forEach { block ->
            Column(Modifier.fillMaxWidth()) {
                AndroidView(
                    factory = { viewContext ->
                        TextView(viewContext).apply {
                            textSize = 16f
                            setTextIsSelectable(true)
                            movementMethod = LinkMovementMethod.getInstance()
                            setLineSpacing(0f, 1.3f)
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    update = { view ->
                        view.setTextColor(color)
                        view.setLinkTextColor(linkColor)
                        val rendered = renderMarkdownBlock(renderer, block)
                        renderer.setParsedMarkdown(view, rendered)
                        if (hasVisibleMarkdown(rendered)) {
                            onTextVisible?.invoke()
                        }
                    },
                )
                val targets = remember(block) { markdownCopyTargets(block) }
                targets.forEach { target ->
                    val copy = copyableMarkdown(target).orEmpty()
                    TextButton(
                        onClick = {
                            val clipboard =
                                context.getSystemService(Context.CLIPBOARD_SERVICE)
                                    as ClipboardManager
                            clipboard.setPrimaryClip(ClipData.newPlainText("Assistant reply", copy))
                        },
                        enabled = settled,
                    ) {
                        Text(if (target is TableBlock) "Copy table" else "Copy code")
                    }
                }
            }
        }
    }
}

@Composable
fun MessageContent(
    message: Message,
    api: PlaygroundApi,
    onDownload: (Download) -> Unit,
    onLink: (String) -> Unit,
) {
    when (message) {
        is UserMessage ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Surface(
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.widthIn(max = 560.dp),
                ) {
                    SelectionContainer {
                        Text(
                            message.content,
                            Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
                }
            }
        is AssistantMessage -> {
            if (isReasoning(message)) {
                Details("Reasoning") { Markdown(message.content.orEmpty(), onLink) }
            } else {
                Markdown(message.content.orEmpty(), onLink)
            }
        }
        is ToolMessage -> Details("Tool result") { ToolResult(message) }
        else ->
            if (!message.content.isNullOrBlank()) {
                Details(message.messageRole.name.lowercase()) { Text(message.content.orEmpty()) }
            }
    }
}

@Composable
fun AssistantTurnContent(
    turn: ConversationTurn,
    api: PlaygroundApi,
    onDownload: (Download) -> Unit,
    onLink: (String) -> Unit,
    children: @Composable () -> Unit = {},
) {
    val active = isActiveRun(turn.status)
    val reasoning = turn.messages.filter { isReasoning(it) && !it.content.isNullOrBlank() }
    var visibleAnswerPhase by rememberSaveable(turn.id) { mutableStateOf<Int?>(null) }
    val lastReasoningIndex =
        turn.messages.indexOfLast { isReasoning(it) && !it.content.isNullOrBlank() }
    var showSources by rememberSaveable(turn.id) { mutableStateOf(false) }
    var selectedSource by rememberSaveable(turn.id) { mutableStateOf<String?>(null) }
    var sourceUnavailable by rememberSaveable(turn.id) { mutableStateOf(false) }
    val replyLink: (String) -> Unit = { link ->
        if (link.startsWith("#knowledge-source-", ignoreCase = true)) {
            val source = turn.sources.citation(link)
            if (source == null) {
                sourceUnavailable = true
            } else {
                selectedSource = source.chunkId
                showSources = true
            }
        } else {
            onLink(link)
        }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (reasoning.isNotEmpty()) {
            ReasoningContent(turn, active, visibleAnswerPhase == reasoning.size, replyLink)
        }
        executionGroups(turn.toolCalls).forEach { group ->
            val name =
                group.skill?.let { "Skill · ${it.name}" }
                    ?: "Tool · ${group.steps.first().call.function.name.replace('_', ' ')}"
            val statuses = group.steps.map { it.status.name }.distinct().joinToString(" / ")
            Details("$name · $statuses") {
                group.steps.forEach { step ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(
                            step.call.function.name.replace('_', ' '),
                            style = MaterialTheme.typography.labelLarge,
                        )
                        StatusTag(step.status.name, step.status == ToolStatus.Running)
                    }
                    skillIdentity(step)?.path?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall)
                    }
                    Text("Parameters", style = MaterialTheme.typography.labelMedium)
                    Text(
                        step.call.function.arguments,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    step.result?.let { result ->
                        Text("Result", style = MaterialTheme.typography.labelMedium)
                        ToolResult(result)
                    }
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                }
            }
        }
        skillFiles(turn.toolCalls).forEach { file ->
            OutlinedButton(onClick = { onDownload(Download(api.filePath(file), file.name)) }) {
                Text("Save ${file.name} · ${displayFileSize(file.size)}")
            }
        }
        children()
        turn.messages
            .filterIsInstance<AssistantMessage>()
            .filter { !isReasoning(it) && !it.content.isNullOrBlank() }
            .forEach { message ->
                Markdown(
                    message.content.orEmpty(),
                    replyLink,
                    settled = !active,
                    onTextVisible = {
                        if (
                            turn.messages.indexOf(message) > lastReasoningIndex &&
                                message.toolCalls.isNullOrEmpty()
                        ) {
                            visibleAnswerPhase = reasoning.size
                        }
                    },
                )
            }
        if (turn.sources.searched) {
            val label =
                when {
                    turn.sources.sources.isNotEmpty() ->
                        "Sources · ${turn.sources.documents.size} documents"
                    turn.sources.errors.isNotEmpty() -> "Sources unavailable"
                    else -> "Sources · No matches"
                }
            OutlinedButton(
                onClick = {
                    selectedSource = null
                    showSources = true
                }
            ) {
                Text(label)
            }
        }
    }
    if (showSources) {
        SourcesSheet(turn.sources, selectedSource, api, onDownload) { showSources = false }
    }
    if (sourceUnavailable) {
        AlertDialog(
            onDismissRequest = { sourceUnavailable = false },
            title = { Text("Source unavailable") },
            text = { Text("This citation has no matching retrieved passage in this reply.") },
            confirmButton = {
                TextButton(onClick = { sourceUnavailable = false }) { Text("Close") }
            },
        )
    }
}

@Composable
private fun ReasoningContent(
    turn: ConversationTurn,
    active: Boolean,
    answerVisible: Boolean,
    onLink: (String) -> Unit,
) {
    val phase = reasoningPhase(turn.messages, answerVisible)
    val automaticOpen = active && phase.startsWith("reasoning-")
    var savedPhase by rememberSaveable(turn.id) { mutableStateOf(phase) }
    var open by rememberSaveable(turn.id) { mutableStateOf(automaticOpen) }
    if (savedPhase != phase) {
        savedPhase = phase
        open = automaticOpen
    }
    val thinking = active && turn.messages.lastOrNull()?.let(::isReasoning) == true
    Column {
        TextButton(onClick = { open = !open }) {
            Text(if (thinking) "Thinking" else "Reasoning")
            Text(if (open) " · Hide" else " · Show")
        }
        if (open) {
            Column(Modifier.testTag("reasoning-content-${turn.id}")) {
                turn.messages
                    .filter { isReasoning(it) && !it.content.isNullOrBlank() }
                    .forEach { Markdown(it.content.orEmpty(), onLink, settled = !active) }
            }
        }
    }
}

@Composable
private fun ToolResult(message: ToolMessage) {
    if (!message.error.isNullOrEmpty()) {
        Text(message.error.orEmpty(), color = MaterialTheme.colorScheme.error)
    }
    Text(
        message.content,
        fontFamily = FontFamily.Monospace,
        style = MaterialTheme.typography.bodySmall,
    )
}

private fun displayFileSize(size: Long): String =
    when {
        size >= 1_048_576 -> "${size / 1_048_576} MB"
        size >= 1024 -> "${size / 1024} KB"
        else -> "$size B"
    }

package com.agentplayground.app.features.conversation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.agentplayground.app.design.Details
import com.agentplayground.app.design.StatusTag
import com.agentplayground.app.files.Download
import com.agentplayground.core.*
import com.agui.core.types.*

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

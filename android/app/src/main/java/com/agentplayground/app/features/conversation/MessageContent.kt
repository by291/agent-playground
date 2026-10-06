package com.agentplayground.app.features.conversation

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.agentplayground.app.design.Details
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
                    shape =
                        RoundedCornerShape(
                            topStart = 18.dp,
                            topEnd = 18.dp,
                            bottomStart = 18.dp,
                            bottomEnd = 6.dp,
                        ),
                    color = MaterialTheme.colorScheme.surfaceContainerHighest,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
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

        is ToolMessage -> Details("Tool result") { ToolResultContent(message) }
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
    processDetails: @Composable () -> Unit = {},
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
            ToolGroupContent(group) {
                if (group.skill == null) {
                    processDetails()
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

private fun displayFileSize(size: Long): String =
    when {
        size >= 1_048_576 -> "${size / 1_048_576} MB"
        size >= 1024 -> "${size / 1024} KB"
        else -> "$size B"
    }

package com.agentplayground.feature.conversation.ui.timeline

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.agentplayground.design.Details
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.MessageAttachment
import com.agentplayground.domain.model.SkillFile
import com.agentplayground.domain.model.isActiveRun
import com.agentplayground.domain.model.isReasoning
import com.agentplayground.domain.presentation.ConversationTurn
import com.agentplayground.domain.presentation.ExecutionKind
import com.agentplayground.domain.presentation.UploadedAttachment
import com.agentplayground.domain.presentation.executionGroups
import com.agentplayground.domain.presentation.skillFiles
import com.agentplayground.domain.presentation.userMessagePresentation
import com.agentplayground.feature.conversation.ui.attachments.MessageAttachments
import com.agentplayground.feature.conversation.ui.markdown.Markdown
import com.agentplayground.feature.conversation.ui.markdown.MarkdownSelection
import com.agui.core.types.*

@Composable
internal fun MessageContent(
    message: Message,
    onLink: (String) -> Unit,
    attachmentPresentation: (UploadedAttachment) -> MessageAttachment = {
        MessageAttachment(it.name)
    },
    onDownload: (Download) -> Unit = {},
    loadImage: suspend (String, Int) -> androidx.compose.ui.graphics.ImageBitmap? = { _, _ ->
        null
    },
    timestamp: String? = null,
) {
    when (message) {
        is UserMessage ->
            Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
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
                        val presentation =
                            remember(message.content) { userMessagePresentation(message.content) }

                        Column(
                            Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            if (presentation.text.isNotEmpty()) {
                                SelectionContainer {
                                    Text(
                                        presentation.text,
                                        style = MaterialTheme.typography.bodyLarge,
                                    )
                                }
                            }

                            if (presentation.attachments.isNotEmpty()) {
                                MessageAttachments(
                                    presentation.attachments.map(attachmentPresentation),
                                    onDownload,
                                    loadImage,
                                )
                            }
                        }
                    }
                }

                MessageTimestamp(timestamp, Modifier.padding(end = 6.dp))
            }

        is AssistantMessage -> {
            if (isReasoning(message)) {
                Details("Reasoning") { Markdown(message.content.orEmpty(), onLink) }
            } else {
                Column {
                    Markdown(message.content.orEmpty(), onLink)
                    AssistantMessageFooter(message.id, message.content.orEmpty(), timestamp, true)
                }
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
internal fun AssistantTurnContent(
    turn: ConversationTurn,
    fileDownload: (SkillFile) -> Download,
    documentDownload: (String, String) -> Download,
    onDownload: (Download) -> Unit,
    onLink: (String) -> Unit,
    processDetails: @Composable () -> Unit = {},
    messageTimestamps: Map<String, String> = emptyMap(),
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
    val toolGroups = executionGroups(turn.toolCalls)

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
        if (reasoning.isNotEmpty() || toolGroups.isNotEmpty()) {
            Column(Modifier.fillMaxWidth()) {
                if (reasoning.isNotEmpty()) {
                    ReasoningContent(turn, active, visibleAnswerPhase == reasoning.size, replyLink)
                }

                toolGroups.forEach { group ->
                    ToolGroupContent(group) {
                        if (group.kind == ExecutionKind.Tool) {
                            processDetails()
                        }
                    }
                }
            }
        }

        skillFiles(turn.toolCalls).forEach { file ->
            OutlinedButton(onClick = { onDownload(fileDownload(file)) }) {
                Text("Save ${file.name} · ${displayFileSize(file.size)}")
            }
        }

        children()
        val answers =
            turn.messages.filterIsInstance<AssistantMessage>().filter {
                !isReasoning(it) && !it.content.isNullOrBlank()
            }

        if (answers.isNotEmpty()) {
            MarkdownSelection {
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    answers.forEach { message ->
                        Column {
                            Markdown(
                                message.content.orEmpty(),
                                replyLink,
                                settled = !active,
                                citations = turn.sources,
                                onTextVisible = {
                                    if (
                                        turn.messages.indexOf(message) > lastReasoningIndex &&
                                            message.toolCalls.isNullOrEmpty()
                                    ) {
                                        visibleAnswerPhase = reasoning.size
                                    }
                                },
                            )
                            AssistantMessageFooter(
                                message.id,
                                message.content.orEmpty(),
                                messageTimestamps[message.id],
                                !active,
                            )
                        }
                    }
                }
            }
        }

        if (turn.sources.searched) {
            val documents = turn.sources.documents
            val label =
                when {
                    documents.size == 1 -> "Sources · ${documents.values.first().first().name}"
                    documents.size > 1 -> "Sources · ${documents.size} documents"

                    turn.sources.errors.isNotEmpty() -> "Sources unavailable"
                    else -> "Sources · No matches"
                }

            OutlinedButton(
                onClick = {
                    selectedSource = null
                    showSources = true
                }
            ) {
                Icon(Icons.Outlined.Description, null, Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }

    if (showSources) {
        SourcesSheet(turn.sources, selectedSource, documentDownload, onDownload) {
            showSources = false
        }
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

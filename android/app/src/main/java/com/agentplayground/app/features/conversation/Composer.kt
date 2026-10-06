package com.agentplayground.app.features.conversation

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.*
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.agentplayground.app.data.AppPreferences
import com.agentplayground.core.Review
import com.agentplayground.core.externalWaitCallId

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Composer(
    state: ConversationUiState,
    vm: ConversationViewModel,
    preferences: AppPreferences,
    onAttach: () -> Unit,
) {
    val session = state.session ?: return
    var context by remember { mutableStateOf(false) }
    var field by remember(session.threadId) { mutableStateOf(TextFieldValue(session.draft)) }
    var pendingInput by remember(session.threadId) { mutableStateOf<String?>(null) }
    LaunchedEffect(state.draftRevision, session.threadId) {
        pendingInput = null
        val draft = vm.state.value.session?.draft.orEmpty()
        if (field.text != draft) {
            field = TextFieldValue(draft, selection = TextRange(draft.length))
        }
    }
    LaunchedEffect(session.draft, session.busy) {
        // A previously emitted journal snapshot must not replace newer in-flight IME input.
        if (session.busy && session.draft.isEmpty()) {
            pendingInput = null
            field = TextFieldValue()
        } else if (pendingInput == session.draft) {
            pendingInput = null
        } else if (pendingInput == null && field.text != session.draft) {
            field = TextFieldValue(session.draft, selection = TextRange(session.draft.length))
        }
    }
    val metadata = modelContext(state.model, session.contextUsage)
    val enabled = session.canSend && !state.uploading
    val review = session.interrupts.singleOrNull()?.let(Review::from)
    val placeholder =
        when {
            state.uploading -> "Uploading files…"
            session.loading -> "Restoring conversation…"
            session.busy -> "Agent is working…"
            review?.kind == "workflow_review" -> review.placeholder
            session.interrupts.any { externalWaitCallId(it) != null } ->
                "The external task is running. You can return later."
            session.interrupts.isNotEmpty() -> "Complete the review above to continue"
            else -> "Describe a task or ask a question…"
        }
    Surface(color = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier.fillMaxWidth()
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Surface(
                Modifier.widthIn(max = 760.dp).fillMaxWidth(),
                shape = RoundedCornerShape(22.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            ) {
                Column(Modifier.padding(8.dp)) {
                    if (state.attachments.isNotEmpty()) {
                        FlowRow(
                            Modifier.padding(horizontal = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            state.attachments.forEach { file ->
                                InputChip(
                                    selected = false,
                                    enabled = !state.uploading,
                                    onClick = { vm.removeAttachment(file.id) },
                                    label = {
                                        Text(
                                            file.name,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    },
                                    trailingIcon = {
                                        Icon(Icons.Outlined.Close, "Remove ${file.name}")
                                    },
                                )
                            }
                        }
                    }
                    BasicTextField(
                        value = field,
                        onValueChange = {
                            field = it
                            pendingInput = it.text
                            vm.editInput(it.text)
                        },
                        enabled = enabled,
                        textStyle =
                            MaterialTheme.typography.bodyLarge.copy(
                                color = MaterialTheme.colorScheme.onSurface
                            ),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        maxLines = 7,
                        modifier =
                            Modifier.fillMaxWidth()
                                .heightIn(min = 52.dp)
                                .padding(horizontal = 12.dp, vertical = 10.dp)
                                .semantics { contentDescription = "Message" }
                                .onPreviewKeyEvent { event ->
                                    val shouldSend =
                                        sendsFromKeyboard(
                                            preferences.sendShortcut,
                                            event,
                                            field.composition,
                                        )
                                    if (shouldSend && enabled && session.draft.isNotBlank()) {
                                        vm.send()
                                        true
                                    } else {
                                        false
                                    }
                                },
                        decorationBox = { innerField ->
                            Box {
                                if (field.text.isEmpty()) {
                                    Text(
                                        placeholder,
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                innerField()
                            }
                        },
                    )
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = onAttach, enabled = enabled) {
                            Icon(
                                Icons.Outlined.Add,
                                "Attach files",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(
                            onClick = { context = true },
                            modifier = Modifier.weight(1f),
                            colors =
                                ButtonDefaults.textButtonColors(
                                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant
                                ),
                            contentPadding = PaddingValues(horizontal = 4.dp),
                        ) {
                            Text(
                                metadata.model ?: "Model unavailable",
                                style = MaterialTheme.typography.labelMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            metadata.usage?.let {
                                Text(
                                    " · ${if (it.usedTokens > 0 && it.usedTokens * 100L < it.contextWindow) "<1" else it.usedTokens * 100L / it.contextWindow.coerceAtLeast(1)}%",
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            }
                        }
                        FilledIconButton(
                            onClick = vm::send,
                            enabled = enabled && session.draft.isNotBlank(),
                            shape = MaterialTheme.shapes.medium,
                            colors =
                                IconButtonDefaults.filledIconButtonColors(
                                    containerColor = MaterialTheme.colorScheme.onSurface,
                                    contentColor = MaterialTheme.colorScheme.surface,
                                ),
                        ) {
                            if (state.uploading || session.busy) {
                                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(
                                    Icons.Outlined.ArrowUpward,
                                    "Send message",
                                    Modifier.size(22.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
    if (context) {
        ModalBottomSheet(
            onDismissRequest = { context = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            Column(
                Modifier.fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Model context", style = MaterialTheme.typography.titleLarge)
                Text(metadata.model ?: "Metadata is currently unavailable.")
                val usage = metadata.usage
                if (usage == null) {
                    Text(
                        "Context usage appears after a model call for the current model.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Text("Approximately ${usage.usedTokens} / ${usage.contextWindow} tokens")
                    LinearProgressIndicator(
                        progress = {
                            (usage.usedTokens.toFloat() / usage.contextWindow.coerceAtLeast(1))
                                .coerceIn(0f, 1f)
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text("Auto-compacts at ${usage.triggerTokens} tokens.")
                    if (usage.usedTokens >= usage.triggerTokens) {
                        Text(
                            "Context is near the compaction threshold.",
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                    mapOf(
                            "system" to "System instructions",
                            "tools" to "Tool definitions",
                            "conversation" to "Conversation",
                            "toolResults" to "Tool results",
                            "summary" to "Compacted summary",
                        )
                        .forEach { (key, label) ->
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(label, style = MaterialTheme.typography.bodySmall)
                                Text(
                                    "${usage.breakdown[key] ?: 0}",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    Text("Compactions: ${usage.compactions}")
                    usage.lastCompaction?.let {
                        Text("Last compaction: ${it["beforeTokens"]} → ${it["afterTokens"]} tokens")
                    }
                    usage.lastInputTokens?.let {
                        Text("Last request input: $it tokens, reported by the provider.")
                    }
                    Text(
                        "The model uses a summary of older messages. Your full chat stays available.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                TextButton(
                    onClick = { context = false },
                    modifier = Modifier.align(Alignment.End),
                ) {
                    Text("Close")
                }
            }
        }
    }
}

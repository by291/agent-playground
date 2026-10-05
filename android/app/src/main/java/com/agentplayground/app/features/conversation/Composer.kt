package com.agentplayground.app.features.conversation

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.agentplayground.app.data.AppPreferences
import com.agentplayground.core.Review

@Composable
fun Composer(
    state: ConversationUiState,
    vm: ConversationViewModel,
    preferences: AppPreferences,
    onAttach: () -> Unit,
) {
    val session = state.session ?: return
    var context by remember { mutableStateOf(false) }
    val enabled = session.canSend && !state.uploading
    val review = session.interrupts.singleOrNull()?.let(Review::from)
    val placeholder =
        when {
            state.uploading -> "Uploading files…"
            session.loading -> "Restoring conversation…"
            session.busy -> "Agent is working…"
            review?.kind == "workflow_review" -> review.placeholder
            session.interrupts.isNotEmpty() -> "Complete the review above to continue"
            else -> "Describe a task or ask a question…"
        }
    Surface(color = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier.fillMaxWidth().imePadding().padding(horizontal = 16.dp, vertical = 12.dp),
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
                        value = session.draft,
                        onValueChange = vm::editDraft,
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
                                    val modifier = event.isCtrlPressed || event.isMetaPressed
                                    val shouldSend =
                                        event.key == Key.Enter &&
                                            event.type == KeyEventType.KeyDown &&
                                            !event.isShiftPressed &&
                                            (preferences.sendShortcut == "enter" || modifier)
                                    if (shouldSend && enabled && session.draft.isNotBlank()) {
                                        vm.send()
                                        true
                                    } else {
                                        false
                                    }
                                },
                        decorationBox = { field ->
                            Box {
                                if (session.draft.isEmpty()) {
                                    Text(
                                        placeholder,
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                field()
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
                                session.contextUsage?.model ?: state.model ?: "Model unavailable",
                                style = MaterialTheme.typography.labelMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            session.contextUsage?.let {
                                Text(
                                    " · ${it.usedTokens * 100L / it.contextWindow.coerceAtLeast(1)}%",
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
        AlertDialog(
            onDismissRequest = { context = false },
            title = { Text("Model context") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        session.contextUsage?.model
                            ?: state.model
                            ?: "Metadata is currently unavailable."
                    )
                    session.contextUsage?.let { usage ->
                        Text("${usage.usedTokens} / ${usage.contextWindow} tokens")
                        Text("Compaction threshold: ${usage.triggerTokens}")
                        usage.breakdown.forEach { (name, count) ->
                            Text("$name: $count", style = MaterialTheme.typography.bodySmall)
                        }
                        Text("Compactions: ${usage.compactions}")
                        usage.lastInputTokens?.let { Text("Last input: $it tokens") }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { context = false }) { Text("Close") } },
        )
    }
}

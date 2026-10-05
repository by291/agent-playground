package com.agentplayground.app.features.conversation

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.*
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
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (state.attachments.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.attachments.forEach { file ->
                        InputChip(
                            selected = false,
                            enabled = !state.uploading,
                            onClick = { vm.removeAttachment(file.id) },
                            label = { Text(file.name) },
                            trailingIcon = { Icon(Icons.Outlined.Close, "Remove ${file.name}") },
                        )
                    }
                }
            }
            OutlinedTextField(
                session.draft,
                vm::editDraft,
                enabled = enabled,
                label = { Text("Message") },
                placeholder = { Text(placeholder) },
                maxLines = 7,
                modifier =
                    Modifier.fillMaxWidth().onPreviewKeyEvent { event ->
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
            )
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            ) {
                IconButton(onClick = onAttach, enabled = enabled) {
                    Icon(Icons.Outlined.AttachFile, "Attach files")
                }
                TextButton(onClick = { context = true }) {
                    Column {
                        Text(
                            session.contextUsage?.model ?: state.model ?: "Model unavailable",
                            style = MaterialTheme.typography.labelMedium,
                        )
                        session.contextUsage?.let {
                            Text(
                                "Context ${it.usedTokens * 100L / it.contextWindow.coerceAtLeast(1)}%",
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }
                }
                FilledIconButton(
                    onClick = vm::send,
                    enabled = enabled && session.draft.isNotBlank(),
                ) {
                    if (state.uploading || session.busy) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.AutoMirrored.Outlined.Send, "Send message")
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

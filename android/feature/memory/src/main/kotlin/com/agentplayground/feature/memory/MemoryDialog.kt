package com.agentplayground.feature.memory

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import com.agentplayground.design.ErrorNotice
import com.agentplayground.domain.model.MemoryRecord

@Composable
internal fun MemoryDialog(
    dialog: MemoryDialogState,
    latest: MemoryRecord?,
    busy: Boolean,
    mutating: Boolean,
    refreshError: String?,
    onDraftChanged: (String) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    onReviewLatest: () -> Unit,
    onRefresh: () -> Unit,
) {
    // Reserve dialog margins and keep editor measurement stable as text wraps.
    val windowSize = LocalWindowInfo.current.containerSize
    val dialogWidth =
        with(LocalDensity.current) { (windowSize.width.toDp() - 48.dp).coerceIn(1.dp, 560.dp) }
    val correcting = dialog.action == MemoryAction.Correct
    val needsReview = dialog.conflict || latest == null || latest.revision != dialog.memory.revision
    val validText = dialog.draft.trim().let { it.isNotEmpty() && it.length <= 1000 }

    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = Modifier.width(dialogWidth),
        properties = DialogProperties(dismissOnBackPress = !busy, dismissOnClickOutside = !busy),
        title = { Text(if (correcting) "Correct memory" else "Forget memory?") },
        text = {
            Column(
                Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    if (correcting) {
                        "Update the saved text while keeping its scope and source."
                    } else {
                        "This memory will stop being used in future replies. Existing conversation history will remain."
                    }
                )

                if (correcting) {
                    OutlinedTextField(
                        value = dialog.draft,
                        onValueChange = onDraftChanged,
                        label = { Text("Memory text") },
                        supportingText = { Text("${dialog.draft.length} / 1,000 characters") },
                        isError = !validText,
                        enabled = !busy,
                        minLines = 3,
                        maxLines = 6,
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    SelectionContainer { Text(dialog.memory.text) }
                }

                dialog.error?.let { ErrorNotice(it) }

                if (needsReview) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Review the latest saved memory before trying again.")

                        if (latest != null && latest.revision > dialog.memory.revision) {
                            Text("Latest saved text", style = MaterialTheme.typography.labelLarge)
                            SelectionContainer {
                                Text(latest.text, Modifier.testTag("latest-memory-text"))
                            }
                            OutlinedButton(onClick = onReviewLatest, enabled = !busy) {
                                Text("Review latest memory")
                            }
                        } else {
                            Text(
                                "The latest version is unavailable. Refresh to review it while keeping this dialog open."
                            )
                            refreshError?.let { ErrorNotice(it) }
                            OutlinedButton(onClick = onRefresh, enabled = !busy) {
                                Text(if (busy) "Refreshing…" else "Refresh latest memory")
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                enabled = !busy && !needsReview && (!correcting || validText),
                colors =
                    ButtonDefaults.textButtonColors(
                        contentColor =
                            if (correcting) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.error
                            }
                    ),
            ) {
                val label =
                    when {
                        mutating && correcting -> "Saving…"
                        mutating -> "Forgetting…"
                        correcting -> "Save correction"
                        else -> "Forget memory"
                    }

                Text(label)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )
}

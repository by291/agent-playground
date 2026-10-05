package com.agentplayground.app.features.conversation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.agentplayground.app.design.*
import com.agentplayground.core.*

@Composable
fun ConversationHistory(
    state: ConversationUiState,
    vm: ConversationViewModel,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    var rename by remember { mutableStateOf<ConversationSummary?>(null) }
    var delete by remember { mutableStateOf<ConversationSummary?>(null) }
    var title by remember { mutableStateOf("") }
    Column(modifier.padding(12.dp)) {
        Text("Conversations", Modifier.padding(12.dp), style = MaterialTheme.typography.titleMedium)
        Button(
            onClick = { onSelect(null) },
            enabled = !state.uploading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Outlined.Add, null)
            Spacer(Modifier.width(8.dp))
            Text("New conversation")
        }
        TextButton(onClick = vm::refreshHistory, enabled = !state.historyLoading) {
            Text("Refresh history")
        }
        state.historyError?.let { ErrorNotice(it, vm::refreshHistory) }
        if (state.historyLoading) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items(state.history, key = { it.threadId }) { row ->
                var menu by remember { mutableStateOf(false) }
                val selected = state.session?.threadId == row.threadId
                val blocked =
                    isActiveRun(row.status) ||
                        (selected && (state.session?.busy == true || state.uploading))
                Surface(
                    shape = MaterialTheme.shapes.medium,
                    color =
                        if (selected) {
                            MaterialTheme.colorScheme.secondaryContainer
                        } else {
                            MaterialTheme.colorScheme.surface
                        },
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                    ) {
                        Column(
                            Modifier.weight(1f)
                                .clickable(enabled = !state.uploading) { onSelect(row.threadId) }
                                .padding(12.dp)
                        ) {
                            Text(
                                row.title,
                                maxLines = 2,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            row.status?.let {
                                Text(
                                    it.replace('_', ' '),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        Box {
                            IconButton(onClick = { menu = true }) {
                                Icon(Icons.Outlined.MoreVert, "Conversation actions")
                            }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(
                                    text = { Text("Rename") },
                                    onClick = {
                                        menu = false
                                        title = row.title
                                        rename = row
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Delete") },
                                    enabled = !blocked,
                                    onClick = {
                                        menu = false
                                        delete = row
                                    },
                                )
                            }
                        }
                    }
                }
            }
            if (state.nextCursor != null) {
                item {
                    TextButton(onClick = vm::loadMore, enabled = !state.historyLoading) {
                        Text("Load more")
                    }
                }
            }
            if (state.history.isEmpty() && !state.historyLoading) {
                item {
                    Text(
                        "Your conversations will appear here.",
                        Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
    rename?.let { row ->
        AlertDialog(
            onDismissRequest = { rename = null },
            title = { Text("Rename conversation") },
            text = {
                Column {
                    OutlinedTextField(
                        title,
                        { title = it },
                        label = { Text("Title") },
                        singleLine = true,
                    )
                    state.error?.let { ErrorNotice(it) }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { vm.rename(row.threadId, title) { rename = null } },
                    enabled =
                        title.trim().isNotBlank() && title.codePointCount(0, title.length) <= 100,
                ) {
                    Text("Save")
                }
            },
            dismissButton = { TextButton(onClick = { rename = null }) { Text("Cancel") } },
        )
    }
    delete?.let { row ->
        ConfirmDelete(
            "Delete conversation?",
            "${row.title} and its files will be permanently deleted.",
            error = state.error,
            onConfirm = { vm.delete(row.threadId) { delete = null } },
            onDismiss = { delete = null },
        )
    }
}

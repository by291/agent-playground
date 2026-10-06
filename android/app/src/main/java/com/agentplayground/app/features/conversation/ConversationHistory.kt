package com.agentplayground.app.features.conversation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
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
    val list = rememberLazyListState()
    val pending = state.historyMutation != null
    val current = state.session
    val rows =
        if (
            current != null &&
                state.history.none { it.threadId == current.threadId } &&
                (current.messages.isNotEmpty() ||
                    current.outputs.isNotEmpty() ||
                    current.busy ||
                    current.interrupts.isNotEmpty())
        ) {
            listOf(
                ConversationSummary(
                    current.threadId,
                    current.title,
                    "",
                    "",
                    current.runs.lastOrNull()?.status,
                )
            ) + state.history
        } else {
            state.history
        }
    LaunchedEffect(list, rows.size, state.nextCursor, state.historyLoading, state.historyError) {
        if (state.nextCursor != null && !state.historyLoading && state.historyError == null) {
            snapshotFlow { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 }
                .collect { index ->
                    if (index >= rows.lastIndex && index >= 0) {
                        vm.loadMore()
                    }
                }
        }
    }
    Column(modifier.padding(horizontal = 16.dp, vertical = 20.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(bottom = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            AgentMark()
            Column(Modifier.weight(1f)) {
                Text("Playground", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Your workspace",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        FilledTonalButton(
            onClick = { onSelect(null) },
            enabled = !state.uploading && !pending,
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
        ) {
            Icon(Icons.Outlined.Add, null, Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("New conversation")
        }
        Row(
            Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "RECENT",
                Modifier.weight(1f),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            IconButton(onClick = vm::refreshHistory, enabled = !state.historyLoading) {
                Icon(
                    Icons.Outlined.Refresh,
                    "Refresh history",
                    Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        state.historyError?.let { ErrorNotice(it, vm::refreshHistory) }
        if (state.historyLoading) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        LazyColumn(
            Modifier.weight(1f),
            state = list,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            items(rows, key = { it.threadId }) { row ->
                var menu by remember { mutableStateOf(false) }
                val selected = state.session?.threadId == row.threadId
                val blocked = state.deletionBlocked(row.threadId)
                Surface(
                    shape = MaterialTheme.shapes.medium,
                    color =
                        if (selected) {
                            MaterialTheme.colorScheme.primaryContainer
                        } else {
                            MaterialTheme.colorScheme.background
                        },
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                    ) {
                        Column(
                            Modifier.weight(1f)
                                .clickable(enabled = !state.uploading && !pending) {
                                    onSelect(row.threadId)
                                }
                                .heightIn(min = 60.dp)
                                .padding(horizontal = 14.dp, vertical = 12.dp)
                        ) {
                            Text(
                                row.title,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodyMedium,
                                color =
                                    if (selected) MaterialTheme.colorScheme.onPrimaryContainer
                                    else MaterialTheme.colorScheme.onSurface,
                            )
                            row.status
                                ?.takeIf { isActiveRun(it) }
                                ?.let {
                                    Text(
                                        it.replace('_', ' '),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                        }
                        Box {
                            IconButton(onClick = { menu = true }, enabled = !pending) {
                                Icon(
                                    Icons.Outlined.MoreHoriz,
                                    "Conversation actions",
                                    Modifier.size(20.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(
                                    text = { Text("Rename") },
                                    onClick = {
                                        menu = false
                                        vm.clearError()
                                        title = row.title
                                        rename = row
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Delete") },
                                    enabled = !blocked,
                                    onClick = {
                                        menu = false
                                        vm.clearError()
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
                    TextButton(
                        onClick = vm::loadMore,
                        enabled = !state.historyLoading && !pending,
                    ) {
                        Text("Load more")
                    }
                }
            }
            if (rows.isEmpty() && !state.historyLoading) {
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
            onDismissRequest = { if (!pending) rename = null },
            title = { Text("Rename conversation") },
            text = {
                Column {
                    OutlinedTextField(
                        title,
                        { title = it },
                        label = { Text("Title") },
                        singleLine = true,
                        enabled = !pending,
                    )
                    state.error?.let { ErrorNotice(it) }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { vm.rename(row.threadId, title) { rename = null } },
                    enabled =
                        !pending &&
                            title.trim().isNotBlank() &&
                            title.trim().codePointCount(0, title.trim().length) <= 100,
                ) {
                    Text(if (pending) "Saving…" else "Save")
                }
            },
            dismissButton = {
                TextButton(onClick = { rename = null }, enabled = !pending) { Text("Cancel") }
            },
        )
    }
    delete?.let { row ->
        ConfirmDelete(
            "Delete conversation?",
            "${row.title} and its files will be permanently deleted.",
            error = state.error,
            busy = pending,
            confirmEnabled = !state.deletionBlocked(row.threadId),
            onConfirm = { vm.delete(row.threadId) { delete = null } },
            onDismiss = { delete = null },
        )
    }
}

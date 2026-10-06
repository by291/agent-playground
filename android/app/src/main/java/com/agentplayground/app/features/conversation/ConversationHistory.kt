package com.agentplayground.app.features.conversation

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.agentplayground.app.design.*
import com.agentplayground.core.*

@Composable
fun ConversationHistory(
    state: ConversationUiState,
    vm: ConversationViewModel,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
    destination: String = "chat",
    serverUrl: String = "",
    onKnowledge: () -> Unit = {},
    onSettings: () -> Unit = {},
) {
    var rename by remember { mutableStateOf<ConversationSummary?>(null) }
    var delete by remember { mutableStateOf<ConversationSummary?>(null) }
    var title by remember { mutableStateOf("") }
    val list = rememberLazyListState()

    val pending = state.historyMutation != null
    val current = state.session
    val currentHasContent =
        current != null &&
            (current.messages.isNotEmpty() ||
                current.outputs.isNotEmpty() ||
                current.busy ||
                current.interrupts.isNotEmpty())
    val rows =
        if (
            current != null &&
                state.history.none { it.threadId == current.threadId } &&
                current.threadId.isNotEmpty()
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
    val lastRowKey = rows.lastOrNull()?.let { "history:${it.threadId}" }

    LaunchedEffect(list, lastRowKey, state.nextCursor, state.historyLoading, state.historyError) {
        if (state.nextCursor != null && !state.historyLoading && state.historyError == null) {
            snapshotFlow { list.layoutInfo.visibleItemsInfo.any { it.key == lastRowKey } }
                .collect { lastRowVisible ->
                    if (lastRowVisible) {
                        vm.loadMore()
                    }
                }
        }
    }

    Column(modifier.padding(horizontal = 16.dp, vertical = 20.dp)) {
        LazyColumn(
            Modifier.weight(1f),
            state = list,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            item("history-header") {
                Column {
                    Row(
                        Modifier.fillMaxWidth().padding(bottom = 24.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        AgentMark()
                        Column(Modifier.weight(1f)) {
                            Text("Agent Playground", style = MaterialTheme.typography.titleSmall)
                            Text(
                                "Workspace",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    OutlinedButton(
                        onClick = { onSelect(null) },
                        enabled = !state.uploading && !pending,
                        shape = MaterialTheme.shapes.small,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        colors =
                            ButtonDefaults.outlinedButtonColors(
                                containerColor = MaterialTheme.colorScheme.surface,
                                contentColor = MaterialTheme.colorScheme.onSurface,
                            ),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) {
                        Icon(Icons.Outlined.Add, null, Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("New conversation")
                    }
                    Surface(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        shape = MaterialTheme.shapes.small,
                        color =
                            animateColorAsState(
                                    if (destination == "knowledge") {
                                        MaterialTheme.colorScheme.secondaryContainer
                                    } else {
                                        androidx.compose.ui.graphics.Color.Transparent
                                    },
                                    Motion.feedback(),
                                    label = "knowledge-selection",
                                )
                                .value,
                    ) {
                        Row(
                            Modifier.fillMaxWidth()
                                .semantics { selected = destination == "knowledge" }
                                .clickable(role = Role.Button, onClick = onKnowledge)
                                .heightIn(min = 48.dp)
                                .padding(horizontal = 12.dp, vertical = 8.dp)
                                .testTag("navigation-knowledge"),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Icon(
                                Icons.AutoMirrored.Outlined.MenuBook,
                                null,
                                Modifier.size(20.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text("Knowledge", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    Row(
                        Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "CONVERSATIONS",
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
                    Reveal(state.historyLoading) {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                    }
                }
            }
            items(rows, key = { "history:${it.threadId}" }) { row ->
                var menu by remember { mutableStateOf(false) }
                val selected = destination == "chat" && state.session?.threadId == row.threadId
                val blocked = state.deletionBlocked(row.threadId)
                val hasActions =
                    state.history.any { it.threadId == row.threadId } ||
                        (current?.threadId == row.threadId && currentHasContent)
                val selection by
                    animateColorAsState(
                        if (selected) {
                            MaterialTheme.colorScheme.secondaryContainer
                        } else {
                            androidx.compose.ui.graphics.Color.Transparent
                        },
                        Motion.feedback(),
                        label = "history-selection",
                    )
                val iconTint by
                    animateColorAsState(
                        if (selected) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        Motion.feedback(),
                        label = "history-icon",
                    )

                Surface(
                    modifier =
                        Modifier.animateItem(
                            fadeInSpec = tween(Motion.Feedback),
                            fadeOutSpec = tween(Motion.Exit),
                            placementSpec = tween(Motion.Expand),
                        ),
                    shape = MaterialTheme.shapes.small,
                    color = selection,
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Outlined.ChatBubbleOutline,
                            null,
                            Modifier.padding(start = 12.dp).size(18.dp),
                            tint = iconTint,
                        )
                        Column(
                            Modifier.weight(1f)
                                .testTag("history-${row.threadId}")
                                .semantics { this.selected = selected }
                                .clickable(
                                    enabled = !state.uploading && !pending,
                                    role = Role.Button,
                                ) {
                                    onSelect(row.threadId)
                                }
                                .heightIn(min = 48.dp)
                                .padding(horizontal = 10.dp, vertical = 10.dp)
                        ) {
                            Text(
                                row.title,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface,
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
                        if (hasActions) {
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
        WorkspaceFooter(serverUrl, destination == "settings", onSettings)
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

@Composable
private fun WorkspaceFooter(serverUrl: String, settingsSelected: Boolean, onSettings: () -> Unit) {
    val server =
        remember(serverUrl) {
            val uri = serverUrl.toUri()
            val host = uri.host.orEmpty()

            if (uri.port > 0) "$host:${uri.port}" else host
        }

    Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            Modifier.fillMaxWidth().padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.Outlined.Dns,
                null,
                Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(Modifier.weight(1f)) {
                Text(
                    "Server",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    server,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Surface(
                color =
                    animateColorAsState(
                            if (settingsSelected) {
                                MaterialTheme.colorScheme.secondaryContainer
                            } else {
                                androidx.compose.ui.graphics.Color.Transparent
                            },
                            Motion.feedback(),
                            label = "settings-selection",
                        )
                        .value,
                shape = MaterialTheme.shapes.small,
            ) {
                IconButton(
                    onClick = onSettings,
                    modifier =
                        Modifier.testTag("navigation-settings").semantics {
                            selected = settingsSelected
                        },
                ) {
                    Icon(
                        Icons.Outlined.Settings,
                        "Open settings",
                        Modifier.size(20.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

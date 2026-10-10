package com.agentplayground.feature.memory

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.agentplayground.design.SectionCard
import com.agentplayground.design.StatusTag
import com.agentplayground.domain.model.MemoryRecord

@Composable
internal fun MemoryRow(
    memory: MemoryRecord,
    busy: Boolean,
    modifier: Modifier,
    onCorrect: () -> Unit,
    onForget: () -> Unit,
    onOpenSource: (String) -> Unit,
) {
    var menu by remember { mutableStateOf(false) }

    SectionCard(modifier) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.weight(1f)) {
                StatusTag(
                    if (memory.category == "preference") {
                        "Preference"
                    } else {
                        "Project · ${memory.project}"
                    }
                )
            }
            Box {
                IconButton(onClick = { menu = true }, enabled = !busy) {
                    Icon(Icons.Outlined.MoreHoriz, "Memory actions: ${memory.text}")
                }
                DropdownMenu(menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("Correct") },
                        leadingIcon = { Icon(Icons.Outlined.Edit, null) },
                        enabled = !busy,
                        modifier =
                            Modifier.semantics {
                                contentDescription = "Correct memory: ${memory.text}"
                            },
                        onClick = {
                            menu = false
                            onCorrect()
                        },
                    )
                    memory.sourceThreadId?.let { threadId ->
                        DropdownMenuItem(
                            text = { Text("Source conversation") },
                            leadingIcon = { Icon(Icons.Outlined.Forum, null) },
                            enabled = !busy,
                            onClick = {
                                menu = false
                                onOpenSource(threadId)
                            },
                        )
                    }
                    DropdownMenuItem(
                        text = { Text("Forget") },
                        leadingIcon = { Icon(Icons.Outlined.DeleteOutline, null) },
                        colors =
                            MenuDefaults.itemColors(
                                textColor = MaterialTheme.colorScheme.error,
                                leadingIconColor = MaterialTheme.colorScheme.error,
                            ),
                        enabled = !busy,
                        modifier =
                            Modifier.semantics {
                                contentDescription = "Forget memory: ${memory.text}"
                            },
                        onClick = {
                            menu = false
                            onForget()
                        },
                    )
                }
            }
        }
        SelectionContainer { Text(memory.text, style = MaterialTheme.typography.bodyLarge) }
        Text(
            "Updated ${memory.updatedAt.take(10)}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

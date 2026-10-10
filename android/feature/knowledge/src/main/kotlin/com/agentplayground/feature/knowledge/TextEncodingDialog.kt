package com.agentplayground.feature.knowledge

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.agentplayground.design.ErrorNotice
import com.agentplayground.domain.model.KnowledgeDocument

private val textEncodings =
    listOf(
        "auto" to "Automatic detection",
        "utf-8" to "UTF-8",
        "gb18030" to "GB18030",
        "gbk" to "GBK",
        "big5" to "Big5",
        "utf-16-le" to "UTF-16 LE",
        "utf-16-be" to "UTF-16 BE",
        "utf-32-le" to "UTF-32 LE",
        "utf-32-be" to "UTF-32 BE",
        "cp1252" to "Windows-1252",
        "shift_jis" to "Shift JIS",
    )

@Composable
fun TextEncodingDialog(
    document: KnowledgeDocument,
    busy: Boolean,
    error: String?,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var encoding by
        rememberSaveable(document.id) {
            mutableStateOf(document.textEncoding ?: "auto")
        }
    var expanded by remember { mutableStateOf(false) }
    val selected = textEncodings.firstOrNull { it.first == encoding }?.second ?: encoding

    AlertDialog(
        onDismissRequest = {
            if (!busy) {
                onDismiss()
            }
        },
        title = { Text("Text encoding") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(
                    "Choose how to read ${document.name}. Reindexing replaces its searchable text."
                )
                Box {
                    OutlinedButton(
                        onClick = { expanded = true },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(selected, Modifier.weight(1f))
                        Icon(Icons.Outlined.ExpandMore, "Choose text encoding")
                    }
                    DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
                        textEncodings.forEach { (value, label) ->
                            DropdownMenuItem(
                                text = { Text(label) },
                                onClick = {
                                    encoding = value
                                    expanded = false
                                },
                            )
                        }
                    }
                }
                error?.let { ErrorNotice(it) }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(encoding) }, enabled = !busy) {
                Text(if (busy) "Queuing index…" else "Reindex document")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") }
        },
    )
}

package com.agentplayground.app.features.knowledge

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.agentplayground.app.design.*
import com.agentplayground.app.files.Download
import com.agentplayground.app.files.DownloadSaver
import com.agentplayground.core.KnowledgeDocument

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KnowledgeScreen(vm: KnowledgeViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    var deleting by remember { mutableStateOf<KnowledgeDocument?>(null) }
    var download by rememberSaveable(stateSaver = DownloadSaver) { mutableStateOf<Download?>(null) }
    val picker =
        rememberLauncherForActivityResult(
            ActivityResultContracts.OpenMultipleDocuments(),
            vm::upload,
        )
    val saver =
        rememberLauncherForActivityResult(
            ActivityResultContracts.CreateDocument("application/octet-stream")
        ) { uri ->
            download?.let {
                if (uri != null) {
                    vm.save(it, uri)
                }
            }
            download = null
        }
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = { Text("Knowledge") },
                actions = {
                    IconButton(onClick = vm::reload, enabled = !state.loading) {
                        Icon(Icons.Outlined.Refresh, "Refresh documents")
                    }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = {
                    if (!state.busy && state.pendingUploads.isEmpty()) {
                        picker.launch(arrayOf("text/plain", "text/markdown", "application/pdf"))
                    }
                },
                icon = { Icon(Icons.Outlined.UploadFile, null) },
                text = { Text("Upload documents") },
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding =
                PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 100.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                Text(
                    "Shared across conversations. Upload UTF-8 TXT, Markdown or text PDF files, up to 10 MiB each.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            state.error?.let {
                item {
                    ErrorNotice(
                        it,
                        if (state.pendingUploads.isNotEmpty()) {
                            vm::retryUploads
                        } else {
                            vm::reload
                        },
                    )
                }
            }
            if (state.pendingUploads.isNotEmpty() && !state.busy) {
                item {
                    Column {
                        Text("Pending uploads: ${state.pendingUploads.joinToString { it.name }}")
                        Row {
                            TextButton(onClick = vm::retryUploads) { Text("Retry uploads") }
                            TextButton(onClick = vm::discardUploads) { Text("Discard selection") }
                        }
                    }
                }
            }
            if (state.loading || state.busy) {
                item {
                    Column {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                        state.operation?.let { Text(it, Modifier.padding(top = 8.dp)) }
                    }
                }
            }
            if (state.documents.isEmpty() && !state.loading) {
                item { Text("No documents yet", style = MaterialTheme.typography.titleMedium) }
            }
            items(state.documents, key = { it.id }) { document ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(document.name, style = MaterialTheme.typography.titleMedium)
                        Text(
                            "${document.status} · ${document.size / 1024} KiB · ${document.chunkCount} chunks",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        document.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(
                                onClick = {
                                    download =
                                        Download(vm.api.documentPath(document.id), document.name)
                                    saver.launch(document.name)
                                },
                                enabled = !state.busy && document.status != "uploading",
                            ) {
                                Text("Save original")
                            }
                            TextButton(
                                onClick = { vm.reindex(document.id) },
                                enabled =
                                    !state.busy &&
                                        document.status !in
                                            setOf("uploading", "indexing", "queued"),
                            ) {
                                Text("Reindex")
                            }
                            TextButton(onClick = { deleting = document }, enabled = !state.busy) {
                                Text("Delete", color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        }
    }
    deleting?.let { document ->
        ConfirmDelete(
            "Delete shared document?",
            "${document.name} will be removed from the shared knowledge base.",
            busy = state.busy,
            error = state.error,
            onConfirm = { vm.delete(document.id) { deleting = null } },
            onDismiss = { deleting = null },
        )
    }
}

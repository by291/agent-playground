package com.agentplayground.app.features.knowledge

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.agentplayground.app.design.*
import com.agentplayground.app.files.Download
import com.agentplayground.app.files.DownloadSaver
import com.agentplayground.core.KnowledgeDocument

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KnowledgeScreen(vm: KnowledgeViewModel, onOpenNavigation: (() -> Unit)? = null) {
    val state by vm.state.collectAsStateWithLifecycle()
    var deleting by remember { mutableStateOf<KnowledgeDocument?>(null) }
    var download by rememberSaveable(stateSaver = DownloadSaver) { mutableStateOf<Download?>(null) }

    val picker =
        rememberLauncherForActivityResult(
            ActivityResultContracts.OpenMultipleDocuments(),
            vm::upload,
        )
    val resumePicker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument(), vm::resumeUpload)
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
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background
                    ),
                title = { Text("Knowledge", style = MaterialTheme.typography.titleLarge) },
                navigationIcon = {
                    if (onOpenNavigation != null) {
                        IconButton(onClick = onOpenNavigation) {
                            Icon(Icons.Outlined.Menu, "Open navigation menu")
                        }
                    }
                },
                actions = {
                    IconButton(onClick = vm::reload, enabled = !state.loading) {
                        Icon(Icons.Outlined.Refresh, "Refresh documents")
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding).navigationBarsPadding(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item {
                Column(
                    Modifier.widthIn(max = 760.dp).fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            "Your shared library.",
                            style = MaterialTheme.typography.headlineMedium,
                        )
                        Text(
                            "Give your agent a shared library to draw from in every conversation.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    SectionCard {
                        SectionHeading(
                            "Add to your library",
                            "TXT, Markdown or text PDF · up to 10 MiB each",
                            Icons.Outlined.UploadFile,
                        )
                        Button(
                            onClick = {
                                picker.launch(
                                    arrayOf("text/plain", "text/markdown", "application/pdf")
                                )
                            },
                            enabled = !state.busy && state.pendingUploads.isEmpty(),
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                            shape = MaterialTheme.shapes.small,
                        ) {
                            Icon(Icons.Outlined.Add, null, Modifier.size(20.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Upload documents")
                        }
                    }

                    Row(
                        Modifier.fillMaxWidth().padding(top = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "YOUR DOCUMENTS",
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "${state.documents.size}",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    RevealValue(state.error) { error ->
                        ErrorNotice(
                            error,
                            if (state.pendingUploads.isNotEmpty()) {
                                vm::retryUploads
                            } else {
                                vm::reload
                            },
                        )
                    }

                    Reveal(state.pendingUploads.isNotEmpty() && !state.busy) {
                        Column {
                            Text(
                                "Pending uploads: ${state.pendingUploads.joinToString { it.name }}"
                            )
                            Row {
                                TextButton(onClick = vm::retryUploads) { Text("Retry uploads") }
                                TextButton(onClick = vm::discardUploads) {
                                    Text("Discard selection")
                                }
                            }
                        }
                    }

                    Reveal(state.loading || state.busy) {
                        Column {
                            LinearProgressIndicator(Modifier.fillMaxWidth())
                            state.operation?.let { Text(it, Modifier.padding(top = 8.dp)) }
                        }
                    }

                    Reveal(state.documents.isEmpty() && !state.loading) {
                        SectionCard(Modifier.widthIn(max = 760.dp)) {
                            SectionHeading(
                                "No documents yet",
                                "Upload a source to make it available to your agent.",
                                Icons.Outlined.FolderOpen,
                            )
                        }
                    }
                }
            }

            items(state.documents, key = { it.id }) { document ->
                SectionCard(
                    Modifier.widthIn(max = 760.dp)
                        .animateItem(
                            fadeInSpec = tween(Motion.Feedback),
                            fadeOutSpec = tween(Motion.Exit),
                            placementSpec = tween(Motion.Expand),
                        )
                ) {
                    var menu by remember { mutableStateOf(false) }

                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.Top,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        IconTile(Icons.Outlined.Description)
                        Column(
                            Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text(
                                document.name,
                                style = MaterialTheme.typography.titleSmall,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                "${document.size / 1024} KiB · ${document.chunkCount} chunks",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Box {
                            IconButton(onClick = { menu = true }) {
                                Icon(Icons.Outlined.MoreHoriz, "Document actions")
                            }
                            DropdownMenu(menu, onDismissRequest = { menu = false }) {
                                if (document.status == "uploading") {
                                    DropdownMenuItem(
                                        text = { Text("Resume upload") },
                                        leadingIcon = { Icon(Icons.Outlined.UploadFile, null) },
                                        enabled = !state.busy && state.pendingUploads.isEmpty(),
                                        onClick = {
                                            menu = false

                                            if (vm.beginResume(document.id)) {
                                                resumePicker.launch(
                                                    arrayOf(
                                                        "text/plain",
                                                        "text/markdown",
                                                        "application/pdf",
                                                    )
                                                )
                                            }
                                        },
                                    )
                                }

                                DropdownMenuItem(
                                    text = { Text("Save original") },
                                    leadingIcon = { Icon(Icons.Outlined.FileDownload, null) },
                                    enabled = !state.busy && document.status != "uploading",
                                    onClick = {
                                        menu = false
                                        download =
                                            Download(
                                                vm.api.documentPath(document.id),
                                                document.name,
                                            )

                                        saver.launch(document.name)
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Reindex") },
                                    leadingIcon = { Icon(Icons.Outlined.Refresh, null) },
                                    enabled =
                                        !state.busy &&
                                            document.status !in
                                                setOf("uploading", "indexing", "queued"),
                                    onClick = {
                                        menu = false
                                        vm.reindex(document.id)
                                    },
                                )
                                DropdownMenuItem(
                                    text = {
                                        Text("Delete", color = MaterialTheme.colorScheme.error)
                                    },
                                    leadingIcon = {
                                        Icon(
                                            Icons.Outlined.DeleteOutline,
                                            null,
                                            tint = MaterialTheme.colorScheme.error,
                                        )
                                    },
                                    enabled = !state.busy,
                                    onClick = {
                                        menu = false
                                        deleting = document
                                    },
                                )
                            }
                        }
                    }

                    StatusTag(
                        document.status.replaceFirstChar { it.uppercase() },
                        emphasis = document.status == "ready",
                    )
                    RevealValue(document.error) { error ->
                        Text(
                            error,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
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

package com.agentplayground.app.features.conversation

import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.agentplayground.app.design.Motion
import com.agentplayground.app.files.Download
import com.agentplayground.core.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SourcesSheet(
    sources: ReplySources,
    selectedChunkId: String?,
    documentDownload: (String, String) -> Download,
    onDownload: (Download) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    val scope = rememberCoroutineScope()
    var closing by remember { mutableStateOf(false) }
    var forward by remember { mutableStateOf(true) }
    var chooseDocument by remember { mutableStateOf(false) }
    var selection by
        remember(selectedChunkId) {
            mutableStateOf(selectedChunkId ?: sources.sources.firstOrNull()?.chunkId)
        }

    val documents = sources.documents.values.toList()
    val source = sources.sources.find { it.chunkId == selection } ?: sources.sources.firstOrNull()
    val passages = sources.documents[source?.documentId].orEmpty()
    val passageIndex = passages.indexOfFirst { it.chunkId == source?.chunkId }.coerceAtLeast(0)

    val dismiss: () -> Unit = {
        if (!closing) {
            closing = true
            scope.launch {
                try {
                    sheetState.hide()

                    if (!sheetState.isVisible) {
                        onDismiss()
                    }
                } finally {
                    closing = false
                }
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        sheetMaxWidth = 840.dp,
        containerColor = MaterialTheme.colorScheme.surface,
        modifier =
            Modifier.fillMaxHeight().testTag("source-sheet").semantics { paneTitle = "Sources" },
        dragHandle = {
            BottomSheetDefaults.DragHandle(Modifier.testTag("source-sheet-drag-handle"))
        },
    ) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        source?.name ?: "Sources",
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )

                    if (source != null) {
                        Text(
                            "Source [${source.number}]" +
                                source.page?.let { " · Page $it" }.orEmpty(),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                if (documents.size > 1) {
                    Box {
                        IconButton(onClick = { chooseDocument = true }) {
                            Icon(Icons.Outlined.ExpandMore, "Choose document")
                        }
                        DropdownMenu(
                            chooseDocument,
                            onDismissRequest = { chooseDocument = false },
                        ) {
                            documents.forEach { excerpts ->
                                DropdownMenuItem(
                                    text = { Text(excerpts.first().name) },
                                    onClick = {
                                        selection = excerpts.first().chunkId
                                        chooseDocument = false
                                    },
                                )
                            }
                        }
                    }
                }

                if (source != null) {
                    IconButton(
                        onClick = {
                            onDownload(documentDownload(source.documentId, source.name))
                        }
                    ) {
                        Icon(Icons.Outlined.FileDownload, "Save original")
                    }
                }

                IconButton(onClick = dismiss, enabled = !closing) {
                    Icon(Icons.Outlined.Close, "Close sources")
                }
            }

            if (passages.size > 1) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    IconButton(
                        onClick = {
                            forward = false
                            selection = passages[passageIndex - 1].chunkId
                        },
                        enabled = passageIndex > 0,
                    ) {
                        Icon(Icons.Outlined.ChevronLeft, "Previous excerpt")
                    }
                    Text(
                        "Passage ${passageIndex + 1} of ${passages.size}",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    IconButton(
                        onClick = {
                            forward = true
                            selection = passages[passageIndex + 1].chunkId
                        },
                        enabled = passageIndex < passages.lastIndex,
                    ) {
                        Icon(Icons.Outlined.ChevronRight, "Next excerpt")
                    }
                }
            }

            HorizontalDivider(Modifier.padding(top = 8.dp))

            if (source == null) {
                Column(
                    Modifier.weight(1f)
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    if (sources.errors.isEmpty()) {
                        Text("No matching sources in the current index.")
                    } else {
                        sources.errors.forEach { Text(it, color = MaterialTheme.colorScheme.error) }
                    }
                }
            } else {
                AnimatedContent(
                    targetState = source,
                    contentKey = { it.chunkId },
                    modifier = Modifier.weight(1f),
                    transitionSpec = {
                        (fadeIn(tween(Motion.Feedback)) +
                            slideInHorizontally(tween(Motion.Feedback)) {
                                if (forward) it / 24 else -it / 24
                            }) togetherWith
                            (fadeOut(tween(Motion.Feedback)) +
                                slideOutHorizontally(tween(Motion.Feedback)) {
                                    if (forward) -it / 24 else it / 24
                                })
                    },
                    label = "source-passage",
                ) { passage ->
                    // Every new passage starts at the top; nested scroll first expands the sheet.
                    key(passage.chunkId) {
                        SelectionContainer(
                            Modifier.fillMaxSize()
                                .testTag("source-excerpt")
                                .verticalScroll(rememberScrollState())
                                .padding(20.dp)
                        ) {
                            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                                sources.errors.forEach {
                                    Text(it, color = MaterialTheme.colorScheme.error)
                                }

                                Text(passage.excerpt, style = MaterialTheme.typography.bodyLarge)
                            }
                        }
                    }
                }
            }
        }
    }
}

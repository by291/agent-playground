package com.agentplayground.app.features.conversation

import androidx.compose.animation.*
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.agentplayground.app.design.*
import com.agentplayground.app.files.Download
import com.agentplayground.core.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SourcesSheet(
    sources: ReplySources,
    selectedChunkId: String?,
    documentDownload: (String, String) -> Download,
    onDownload: (Download) -> Unit,
    onDismiss: () -> Unit,
) {
    val windowWidth =
        with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() }
    val fullScreen = windowWidth < 600.dp
    val visibility = remember { MutableTransitionState(false).apply { targetState = true } }
    var closing by remember { mutableStateOf(false) }
    var forward by remember { mutableStateOf(true) }

    val dismiss: () -> Unit = {
        if (fullScreen) {
            closing = true
            visibility.targetState = false
        } else {
            onDismiss()
        }
    }

    LaunchedEffect(closing, visibility.isIdle) {
        if (closing && visibility.isIdle && !visibility.currentState) {
            onDismiss()
        }
    }

    val documents = sources.documents.values.toList()
    var selection by
        remember(selectedChunkId) {
            mutableStateOf(selectedChunkId ?: sources.sources.firstOrNull()?.chunkId)
        }
    val source = sources.sources.find { it.chunkId == selection } ?: sources.sources.firstOrNull()
    val passages = sources.documents[source?.documentId].orEmpty()
    val passageIndex = passages.indexOfFirst { it.chunkId == source?.chunkId }.coerceAtLeast(0)

    val content: @Composable () -> Unit = {
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Knowledge sources",
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.titleLarge,
                )
                IconButton(onClick = dismiss, enabled = !closing) {
                    Icon(Icons.Outlined.Close, "Close sources")
                }
            }
            sources.errors.forEach { Text(it, color = MaterialTheme.colorScheme.error) }

            if (source == null) {
                Text(
                    if (sources.errors.isEmpty()) {
                        "No matching sources in the current index."
                    } else {
                        "Sources are unavailable."
                    }
                )
            } else {
                var chooseDocument by remember { mutableStateOf(false) }

                Box {
                    OutlinedButton(
                        onClick = { chooseDocument = true },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Document: ${source.name}")
                    }
                    DropdownMenu(chooseDocument, onDismissRequest = { chooseDocument = false }) {
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
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    TextButton(
                        onClick = {
                            forward = false
                            selection = passages[passageIndex - 1].chunkId
                        },
                        enabled = passageIndex > 0,
                    ) {
                        Text("Previous excerpt")
                    }
                    Text(
                        "${passageIndex + 1} / ${passages.size}",
                        style = MaterialTheme.typography.labelMedium,
                    )
                    TextButton(
                        onClick = {
                            forward = true
                            selection = passages[passageIndex + 1].chunkId
                        },
                        enabled = passageIndex < passages.lastIndex,
                    ) {
                        Text("Next excerpt")
                    }
                }
                Text(
                    "Source ${source.number}${source.page?.let { " · Page $it" }.orEmpty()}",
                    style = MaterialTheme.typography.labelLarge,
                )
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
                    key(passage.chunkId) {
                        SelectionContainer(
                            Modifier.fillMaxSize()
                                .testTag("source-excerpt")
                                .verticalScroll(rememberScrollState())
                        ) {
                            Text(passage.excerpt, style = MaterialTheme.typography.bodyLarge)
                        }
                    }
                }
                OutlinedButton(
                    onClick = {
                        onDownload(documentDownload(source.documentId, source.name))
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Save original")
                }
            }
        }
    }

    if (fullScreen) {
        Dialog(
            onDismissRequest = dismiss,
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            AnimatedVisibility(
                visibleState = visibility,
                enter =
                    slideInHorizontally(tween(Motion.Page)) { it / 8 } +
                        fadeIn(tween(Motion.Expand)),
                exit =
                    slideOutHorizontally(tween(Motion.Page)) { it / 8 } +
                        fadeOut(tween(Motion.Exit)),
            ) {
                BackPreview(enabled = !closing, onBack = dismiss) { backModifier ->
                    Surface(
                        backModifier.fillMaxSize().systemBarsPadding(),
                        color = MaterialTheme.colorScheme.surface,
                    ) {
                        content()
                    }
                }
            }
        }
    } else {
        ModalBottomSheet(
            onDismissRequest = onDismiss,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            sheetMaxWidth = 840.dp,
        ) {
            Box(Modifier.fillMaxWidth().heightIn(max = 680.dp)) { content() }
        }
    }
}

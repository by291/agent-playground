package com.agentplayground.feature.memory

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.agentplayground.core.model.MemoryRecord
import com.agentplayground.ui.ErrorNotice
import com.agentplayground.ui.SectionCard

@Composable
fun MemoryRoute(
    vm: MemoryViewModel,
    onOpenSource: (String) -> Unit,
    onOpenNavigation: (() -> Unit)? = null,
) {
    val state by vm.state.collectAsStateWithLifecycle()

    MemoryScreen(
        state,
        vm::reload,
        vm::loadMore,
        vm::beginCorrection,
        vm::beginForget,
        onOpenSource,
        onOpenNavigation,
    )

    state.dialog?.let { dialog ->
        MemoryDialog(
            dialog = dialog,
            latest = state.memories.find { it.id == dialog.memory.id },
            busy = state.busy,
            mutating = state.mutating,
            refreshError = state.error,
            onDraftChanged = vm::updateDraft,
            onConfirm = vm::confirm,
            onDismiss = vm::dismissDialog,
            onReviewLatest = vm::reviewLatest,
            onRefresh = vm::reload,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MemoryScreen(
    state: MemoryUiState,
    onReload: () -> Unit,
    onLoadMore: () -> Unit,
    onCorrect: (MemoryRecord) -> Unit,
    onForget: (MemoryRecord) -> Unit,
    onOpenSource: (String) -> Unit,
    onOpenNavigation: (() -> Unit)?,
) {
    val contentWidth = Modifier.widthIn(max = 760.dp).fillMaxWidth()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background
                    ),
                title = {
                    Text("Memory", style = MaterialTheme.typography.titleLarge)
                },
                navigationIcon = {
                    if (onOpenNavigation != null) {
                        IconButton(onClick = onOpenNavigation) {
                            Icon(Icons.Outlined.Menu, "Open navigation menu")
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onReload, enabled = !state.busy) {
                        Icon(Icons.Outlined.Refresh, "Refresh memories")
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
            item("memory-introduction") {
                Column(contentWidth, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Shared memories.", style = MaterialTheme.typography.headlineMedium)
                    Text(
                        "Preferences and project facts remembered across conversations. Memories are shared by everyone using this workspace.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Memory is enabled automatically in normal chat. Project facts apply when you ask the agent to work on that project.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (state.loading) {
                item("memory-loading") { LinearProgressIndicator(contentWidth) }
            }
            state.error?.let { error ->
                item("memory-error") {
                    Box(contentWidth) { ErrorNotice(error, if (state.busy) null else onReload) }
                }
            }
            if (state.loaded && state.memories.isEmpty() && state.error == null) {
                item("memory-empty") {
                    SectionCard(contentWidth) {
                        Text("No memories yet", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "Ask the agent to remember a preference or a project fact during a conversation."
                        )
                    }
                }
            }
            items(state.memories, key = { it.id }) { memory ->
                MemoryRow(
                    memory,
                    state.busy,
                    contentWidth,
                    { onCorrect(memory) },
                    { onForget(memory) },
                    onOpenSource,
                )
            }
            state.moreError?.let { error ->
                item("memory-page-error") {
                    Box(contentWidth) { ErrorNotice(error, if (state.busy) null else onLoadMore) }
                }
            }
            if (state.nextOffset != null && state.moreError == null) {
                item("memory-load-more") {
                    OutlinedButton(
                        onClick = onLoadMore,
                        enabled = !state.busy && state.error == null,
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) {
                        Text(if (state.loadingMore) "Loading more…" else "Load more")
                    }
                }
            }
        }
    }
}

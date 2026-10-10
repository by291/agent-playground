package com.agentplayground.feature.memory

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle

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

package com.agentplayground.feature.conversation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.agentplayground.feature.conversation.ui.history.ConversationHistory

@Composable
fun ConversationHistoryRoute(
    state: ConversationUiState,
    vm: ConversationViewModel,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
    destination: String = "chat",
    serverUrl: String = "",
    onKnowledge: () -> Unit = {},
    onSettings: () -> Unit = {},
) {
    ConversationHistory(
        state = state,
        onRefresh = vm::refreshHistory,
        onLoadMore = vm::loadMore,
        onClearError = vm::clearError,
        onRename = vm::rename,
        onDelete = vm::delete,
        onSelect = onSelect,
        modifier = modifier,
        destination = destination,
        serverUrl = serverUrl,
        onKnowledge = onKnowledge,
        onSettings = onSettings,
    )
}

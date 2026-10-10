package com.agentplayground.app.di

import androidx.compose.runtime.Composable
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.hilt.lifecycle.viewmodel.compose.rememberHiltViewModelFactory
import androidx.lifecycle.defaultViewModelCreationExtras
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.agentplayground.feature.conversation.ConversationViewModel
import com.agentplayground.feature.knowledge.KnowledgeViewModel
import com.agentplayground.feature.memory.MemoryViewModel
import dagger.hilt.android.lifecycle.withCreationCallback

internal data class WorkspaceModels(
    val conversation: ConversationViewModel,
    val knowledge: KnowledgeViewModel,
    val memory: MemoryViewModel,
)

@Composable
internal fun rememberWorkspaceModels(serverUrl: String): WorkspaceModels {
    val graph: ServerGraph = hiltViewModel()
    val owner = graph.owner(serverUrl)
    val factory = rememberHiltViewModelFactory()
    val extras = checkNotNull(LocalViewModelStoreOwner.current).defaultViewModelCreationExtras
    // The child store owns the resources; Hilt's saved-state extras come from the Activity.

    val conversation =
        viewModel<ConversationViewModel>(
            viewModelStoreOwner = owner,
            factory = factory,
            extras =
                extras.withCreationCallback<ConversationViewModel.Factory> { it.create(serverUrl) },
        )
    val knowledge =
        viewModel<KnowledgeViewModel>(
            viewModelStoreOwner = owner,
            factory = factory,
            extras =
                extras.withCreationCallback<KnowledgeViewModel.Factory> { it.create(serverUrl) },
        )
    val memory =
        viewModel<MemoryViewModel>(
            viewModelStoreOwner = owner,
            factory = factory,
            extras = extras.withCreationCallback<MemoryViewModel.Factory> { it.create(serverUrl) },
        )

    return WorkspaceModels(conversation, knowledge, memory)
}

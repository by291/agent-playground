package com.agentplayground.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.agentplayground.app.features.conversation.ConversationViewModel
import com.agentplayground.app.features.knowledge.KnowledgeViewModel
import com.agentplayground.app.files.DocumentAccess
import com.agentplayground.core.PlaygroundApi

internal data class WorkspaceModels(
    val conversation: ConversationViewModel,
    val knowledge: KnowledgeViewModel,
)

@Composable
internal fun rememberWorkspaceModels(
    application: PlaygroundApplication,
    serverUrl: String,
): WorkspaceModels {
    val graph: ServerGraph = viewModel()
    val owner = graph.owner(serverUrl)
    val files = remember(application) { DocumentAccess(application.contentResolver) }
    val conversationFactory =
        remember(application, serverUrl, files) {
            viewModelFactory {
                initializer {
                    ConversationViewModel(
                        PlaygroundApi(serverUrl),
                        application.preferences.conversations(serverUrl),
                        files,
                    )
                }
            }
        }
    val knowledgeFactory =
        remember(serverUrl, files) {
            viewModelFactory { initializer { KnowledgeViewModel(PlaygroundApi(serverUrl), files) } }
        }
    val conversation: ConversationViewModel =
        viewModel(viewModelStoreOwner = owner, factory = conversationFactory)
    val knowledge: KnowledgeViewModel =
        viewModel(viewModelStoreOwner = owner, factory = knowledgeFactory)

    return WorkspaceModels(conversation, knowledge)
}

// The Activity retains this graph across recreation; replacing its server disposes all child
// jobs/clients.
class ServerGraph : ViewModel() {
    private var serverUrl: String? = null
    private var store = ViewModelStore()
    private var currentOwner = ownerFor(store)

    fun owner(url: String): ViewModelStoreOwner {
        if (url != serverUrl) {
            store.clear()
            store = ViewModelStore()
            currentOwner = ownerFor(store)
            serverUrl = url
        }

        return currentOwner
    }

    private fun ownerFor(value: ViewModelStore) =
        object : ViewModelStoreOwner {
            override val viewModelStore = value
        }

    override fun onCleared() {
        store.clear()
    }
}

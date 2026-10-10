package com.agentplayground.app.di

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.agentplayground.app.PlaygroundApplication
import com.agentplayground.core.network.PlaygroundApi
import com.agentplayground.data.conversation.ConversationRepository
import com.agentplayground.data.files.AttachmentImages
import com.agentplayground.data.files.DocumentAccess
import com.agentplayground.data.knowledge.KnowledgeRepository
import com.agentplayground.data.memory.MemoryRepository
import com.agentplayground.feature.conversation.ConversationViewModel
import com.agentplayground.feature.knowledge.KnowledgeViewModel
import com.agentplayground.feature.memory.MemoryViewModel

internal data class WorkspaceModels(
    val conversation: ConversationViewModel,
    val knowledge: KnowledgeViewModel,
    val memory: MemoryViewModel,
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
                        ConversationRepository(
                            PlaygroundApi(serverUrl),
                            application.preferences.conversations(serverUrl),
                            files,
                            AttachmentImages(application),
                        )
                    )
                }
            }
        }
    val knowledgeFactory =
        remember(serverUrl, files) {
            viewModelFactory {
                initializer {
                    KnowledgeViewModel(KnowledgeRepository(PlaygroundApi(serverUrl), files))
                }
            }
        }
    val memoryFactory =
        remember(serverUrl) {
            viewModelFactory {
                initializer { MemoryViewModel(MemoryRepository(PlaygroundApi(serverUrl))) }
            }
        }

    val conversation: ConversationViewModel =
        viewModel(viewModelStoreOwner = owner, factory = conversationFactory)
    val knowledge: KnowledgeViewModel =
        viewModel(viewModelStoreOwner = owner, factory = knowledgeFactory)
    val memory: MemoryViewModel = viewModel(viewModelStoreOwner = owner, factory = memoryFactory)

    return WorkspaceModels(conversation, knowledge, memory)
}

// The Activity retains this graph across recreation; replacing its server disposes all child
// jobs/clients.
internal class ServerGraph : ViewModel() {
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

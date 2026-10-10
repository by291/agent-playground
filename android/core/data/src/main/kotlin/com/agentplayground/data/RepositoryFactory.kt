package com.agentplayground.data

import android.content.Context
import com.agentplayground.data.conversation.DefaultConversationRepository
import com.agentplayground.data.files.DocumentAccess
import com.agentplayground.data.knowledge.DefaultKnowledgeRepository
import com.agentplayground.data.memory.DefaultMemoryRepository
import com.agentplayground.data.network.PlaygroundApi
import com.agentplayground.data.preferences.DataStorePreferencesRepository
import com.agentplayground.data.server.DefaultServerRepository
import com.agentplayground.domain.repository.ConversationRepository
import com.agentplayground.domain.repository.KnowledgeRepository
import com.agentplayground.domain.repository.MemoryRepository
import com.agentplayground.domain.repository.PreferencesRepository
import com.agentplayground.domain.repository.RepositoryProvider
import com.agentplayground.domain.repository.ServerRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** Composition entry point. Each created remote repository transfers ownership to its ViewModel. */
@Singleton
class RepositoryFactory @Inject constructor(@ApplicationContext context: Context) :
    RepositoryProvider {
    private val application = context.applicationContext
    private val files = DocumentAccess(application.contentResolver)

    val preferences: PreferencesRepository by lazy { DataStorePreferencesRepository(application) }
    val server: ServerRepository = DefaultServerRepository()

    override fun conversation(serverUrl: String): ConversationRepository =
        DefaultConversationRepository(
            PlaygroundApi(serverUrl),
            preferences.conversations(serverUrl),
            files,
        )

    override fun knowledge(serverUrl: String): KnowledgeRepository =
        DefaultKnowledgeRepository(PlaygroundApi(serverUrl), files)

    override fun memory(serverUrl: String): MemoryRepository =
        DefaultMemoryRepository(PlaygroundApi(serverUrl))
}

package com.agentplayground.domain.repository

/** Creates owned repositories for a normalized server; each caller releases its repository. */
interface RepositoryProvider {
    fun conversation(serverUrl: String): ConversationRepository

    fun knowledge(serverUrl: String): KnowledgeRepository

    fun memory(serverUrl: String): MemoryRepository
}

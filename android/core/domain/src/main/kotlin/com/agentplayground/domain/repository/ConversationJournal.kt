package com.agentplayground.domain.repository

import com.agentplayground.domain.model.ConversationPersistence
import com.agentplayground.domain.model.SavedConversation

interface ConversationJournal : ConversationPersistence {
    suspend fun find(thread: String): SavedConversation?

    suspend fun select(thread: String)

    suspend fun remove(thread: String)

    suspend fun clear()
}

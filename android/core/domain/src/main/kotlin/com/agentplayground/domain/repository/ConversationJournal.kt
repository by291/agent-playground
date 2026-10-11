package com.agentplayground.domain.repository

import com.agentplayground.domain.model.ConversationPersistence
import com.agentplayground.domain.model.SavedConversation

/** Local recovery records and selection for one server; [clear] leaves other servers untouched. */
interface ConversationJournal : ConversationPersistence {
    suspend fun find(thread: String): SavedConversation?

    /** Selects an existing record without creating it; callers persist it before selecting. */
    suspend fun select(thread: String)

    suspend fun remove(thread: String)

    suspend fun clear()
}

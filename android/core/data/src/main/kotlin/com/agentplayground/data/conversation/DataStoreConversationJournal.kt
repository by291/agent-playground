package com.agentplayground.data.conversation

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import com.agentplayground.domain.model.SavedConversation
import com.agentplayground.domain.model.protocolJson
import com.agentplayground.domain.repository.ConversationJournal
import kotlinx.coroutines.flow.first
import kotlinx.serialization.encodeToString

/** Stores recovery records under the existing server/thread keys for upgrade compatibility. */
internal class DataStoreConversationJournal(
    private val store: DataStore<Preferences>,
    private val server: String,
) : ConversationJournal {
    private val currentKey = stringPreferencesKey("selected:$server")

    private fun threadKey(thread: String) = stringPreferencesKey("thread:$server:$thread")

    override suspend fun read(): SavedConversation? {
        val values = store.data.first()
        val id = values[currentKey] ?: return null

        return values[threadKey(id)]?.let { protocolJson.decodeFromString<SavedConversation>(it) }
    }

    override suspend fun find(thread: String): SavedConversation? =
        store.data.first()[threadKey(thread)]?.let {
            protocolJson.decodeFromString<SavedConversation>(it)
        }

    override suspend fun write(value: SavedConversation?) {
        if (value == null) {
            return
        }

        store.edit { it[threadKey(value.threadId)] = protocolJson.encodeToString(value) }
    }

    override suspend fun select(thread: String) {
        store.edit { it[currentKey] = thread }
    }

    override suspend fun remove(thread: String) {
        store.edit {
            it.remove(threadKey(thread))

            if (it[currentKey] == thread) {
                it.remove(currentKey)
            }
        }
    }

    override suspend fun clear() {
        store.edit { values ->
            values
                .asMap()
                .keys
                .filter { it.name.startsWith("thread:$server:") || it.name == currentKey.name }
                .forEach { values.remove(it) }
        }
    }
}

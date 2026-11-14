package com.agentplayground.data.conversation

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import com.agentplayground.domain.model.SavedConversation
import com.agentplayground.domain.model.protocolJson
import com.agentplayground.domain.model.string
import com.agentplayground.domain.repository.ConversationJournal
import kotlinx.coroutines.flow.first
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.jsonObject

/** Stores server-scoped recovery records and reads legacy keys for upgrade compatibility. */
internal class DataStoreConversationJournal(
    private val store: DataStore<Preferences>,
    private val server: String,
) : ConversationJournal {
    private val currentKey = stringPreferencesKey("selected:$server")
    private val threadPrefix = "thread-v2:${server.length}:$server:"
    private val legacyThreadPrefix = "thread:$server:"

    private fun threadKey(thread: String) = stringPreferencesKey("$threadPrefix$thread")

    private fun legacyThreadKey(thread: String) = stringPreferencesKey("$legacyThreadPrefix$thread")

    private fun storedThreadId(value: String): String? =
        runCatching { protocolJson.parseToJsonElement(value).jsonObject.string("threadId") }
            .getOrNull()

    private fun ownsLegacyRecord(key: Preferences.Key<*>, value: Any): Boolean {
        if (!key.name.startsWith(legacyThreadPrefix) || value !is String) {
            return false
        }

        // A legacy prefix can match a different server because paths and IDs can contain colons.
        val threadId = storedThreadId(value)

        return threadId != null && key == legacyThreadKey(threadId)
    }

    private fun findIn(values: Preferences, thread: String): SavedConversation? {
        val encoded = values[threadKey(thread)]
        val record = encoded ?: values[legacyThreadKey(thread)] ?: return null
        val saved = protocolJson.decodeFromString<SavedConversation>(record)

        return saved.takeIf { it.threadId == thread }
    }

    override suspend fun read(): SavedConversation? {
        val values = store.data.first()
        val id = values[currentKey] ?: return null

        return findIn(values, id)
    }

    override suspend fun find(thread: String): SavedConversation? =
        findIn(store.data.first(), thread)

    private fun removeLegacyRecord(values: MutablePreferences, thread: String) {
        val key = legacyThreadKey(thread)
        val encoded = values[key] ?: return

        if (storedThreadId(encoded) == thread) {
            values.remove(key)
        }
    }

    override suspend fun write(value: SavedConversation?) {
        if (value == null) {
            return
        }

        store.edit { values ->
            values[threadKey(value.threadId)] = protocolJson.encodeToString(value)
            removeLegacyRecord(values, value.threadId)
        }
    }

    override suspend fun select(thread: String) {
        store.edit { it[currentKey] = thread }
    }

    override suspend fun remove(thread: String) {
        store.edit { values ->
            values.remove(threadKey(thread))
            removeLegacyRecord(values, thread)

            if (values[currentKey] == thread) {
                values.remove(currentKey)
            }
        }
    }

    override suspend fun clear() {
        store.edit { values ->
            val threadRecords =
                values.asMap().filter { (key, value) ->
                    key.name.startsWith(threadPrefix) || ownsLegacyRecord(key, value)
                }

            values.remove(currentKey)

            for (key in threadRecords.keys) {
                values.remove(key)
            }
        }
    }
}

package com.agentplayground.app.data

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import com.agentplayground.core.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

private val Context.playgroundStore by preferencesDataStore("agent_playground")

@Serializable
data class AppPreferences(
    val serverUrl: String = "http://10.0.2.2:3000/",
    val theme: String = "light",
    val replyAnimation: Boolean = true,
    val sendShortcut: String = "enter",
)

class PreferenceStore(context: Context) {
    private val store = context.applicationContext.playgroundStore
    private val preferencesKey = stringPreferencesKey("preferences")
    val preferences: Flow<AppPreferences> =
        store.data.map {
            it[preferencesKey]?.let { value ->
                runCatching { protocolJson.decodeFromString<AppPreferences>(value) }.getOrNull()
            } ?: AppPreferences()
        }

    suspend fun update(value: AppPreferences) {
        store.edit { it[preferencesKey] = protocolJson.encodeToString(value) }
    }

    fun conversations(server: String): ConversationJournal =
        ConversationJournal(normalizeServerUrl(server))

    inner class ConversationJournal(private val server: String) : ConversationPersistence {
        private val currentKey = stringPreferencesKey("selected:$server")

        private fun threadKey(thread: String) = stringPreferencesKey("thread:$server:$thread")

        override suspend fun read(): SavedConversation? {
            val values = store.data.first()
            val id = values[currentKey] ?: return null
            return values[threadKey(id)]?.let {
                protocolJson.decodeFromString<SavedConversation>(it)
            }
        }

        suspend fun find(thread: String): SavedConversation? =
            store.data.first()[threadKey(thread)]?.let {
                protocolJson.decodeFromString<SavedConversation>(it)
            }

        override suspend fun write(value: SavedConversation?) {
            if (value == null) {
                return
            }
            store.edit { it[threadKey(value.threadId)] = protocolJson.encodeToString(value) }
        }

        suspend fun select(thread: String) {
            store.edit { it[currentKey] = thread }
        }

        suspend fun remove(thread: String) {
            store.edit {
                it.remove(threadKey(thread))
                if (it[currentKey] == thread) {
                    it.remove(currentKey)
                }
            }
        }

        suspend fun clear() {
            store.edit { values ->
                values
                    .asMap()
                    .keys
                    .filter { it.name.startsWith("thread:$server:") || it.name == currentKey.name }
                    .forEach { values.remove(it) }
            }
        }
    }
}

package com.agentplayground.data

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import com.agentplayground.core.model.ConversationPersistence
import com.agentplayground.core.model.SavedConversation
import com.agentplayground.core.model.protocolJson
import com.agentplayground.core.network.normalizeServerUrl
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

class PreferencesRepository(context: Context) {
    private val store = context.applicationContext.playgroundStore
    private val preferencesKey = stringPreferencesKey("preferences")

    val preferences: Flow<AppPreferences> = store.data.map { decodePreferences(it[preferencesKey]) }

    suspend fun updateServerUrl(value: String) = update {
        it.copy(serverUrl = normalizeServerUrl(value))
    }

    suspend fun updateTheme(value: String) = update { it.copy(theme = value) }

    suspend fun updateReplyAnimation(value: Boolean) = update { it.copy(replyAnimation = value) }

    suspend fun updateSendShortcut(value: String) = update { it.copy(sendShortcut = value) }

    suspend fun resetAppearanceAndKeyboard() = update {
        it.copy(theme = "light", replyAnimation = true, sendShortcut = "enter")
    }

    private suspend fun update(transform: (AppPreferences) -> AppPreferences) {
        // Read inside the transaction so delayed connection checks cannot overwrite newer edits.
        store.edit { values ->
            val latest = decodePreferences(values[preferencesKey])
            val updated = transform(latest)

            values[preferencesKey] = protocolJson.encodeToString(updated)
        }
    }

    private fun decodePreferences(value: String?): AppPreferences =
        value?.let {
            runCatching { protocolJson.decodeFromString<AppPreferences>(it) }.getOrNull()
        } ?: AppPreferences()

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

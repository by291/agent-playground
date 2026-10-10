package com.agentplayground.data.preferences

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import com.agentplayground.data.conversation.DataStoreConversationJournal
import com.agentplayground.data.network.normalizeServerUrl
import com.agentplayground.domain.model.protocolJson
import com.agentplayground.domain.repository.ConversationJournal
import com.agentplayground.domain.repository.PreferencesRepository
import com.agentplayground.domain.settings.AppPreferences
import kotlinx.coroutines.flow.*
import kotlinx.serialization.encodeToString

private val Context.playgroundStore by preferencesDataStore("agent_playground")

internal class DataStorePreferencesRepository(context: Context) : PreferencesRepository {
    private val store = context.applicationContext.playgroundStore
    private val preferencesKey = stringPreferencesKey("preferences")

    override val preferences: Flow<AppPreferences> =
        store.data.map {
            decodePreferences(it[preferencesKey])
        }

    override suspend fun updateServerUrl(value: String) = update {
        it.copy(serverUrl = normalizeServerUrl(value))
    }

    override suspend fun updateTheme(value: String) = update { it.copy(theme = value) }

    override suspend fun updateReplyAnimation(value: Boolean) = update {
        it.copy(replyAnimation = value)
    }

    override suspend fun updateSendShortcut(value: String) = update {
        it.copy(sendShortcut = value)
    }

    override suspend fun resetAppearanceAndKeyboard() = update {
        it.copy(theme = "light", replyAnimation = true, sendShortcut = "enter")
    }

    private suspend fun update(transform: (AppPreferences) -> AppPreferences) {
        // Read inside the transaction so delayed connection checks cannot overwrite newer edits.
        store.edit { values ->
            val latest = decodePreferences(values[preferencesKey])
            values[preferencesKey] = protocolJson.encodeToString(transform(latest))
        }
    }

    private fun decodePreferences(value: String?): AppPreferences =
        value?.let {
            runCatching { protocolJson.decodeFromString<AppPreferences>(it) }.getOrNull()
        } ?: AppPreferences()

    override fun conversations(server: String): ConversationJournal =
        DataStoreConversationJournal(store, normalizeServerUrl(server))
}

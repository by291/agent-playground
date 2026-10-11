package com.agentplayground.domain.repository

import com.agentplayground.domain.settings.AppPreferences
import kotlinx.coroutines.flow.Flow

/** Application preferences; each update transforms the latest stored value atomically. */
interface PreferencesRepository {
    val preferences: Flow<AppPreferences>

    suspend fun updateServerUrl(value: String)

    suspend fun updateTheme(value: String)

    suspend fun updateReplyAnimation(value: Boolean)

    suspend fun updateSendShortcut(value: String)

    /** Resets presentation preferences while preserving the configured server and journals. */
    suspend fun resetAppearanceAndKeyboard()

    fun conversations(server: String): ConversationJournal
}

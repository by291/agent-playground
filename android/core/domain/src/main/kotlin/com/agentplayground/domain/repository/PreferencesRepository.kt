package com.agentplayground.domain.repository

import com.agentplayground.domain.settings.AppPreferences
import kotlinx.coroutines.flow.Flow

interface PreferencesRepository {
    val preferences: Flow<AppPreferences>

    suspend fun updateServerUrl(value: String)

    suspend fun updateTheme(value: String)

    suspend fun updateReplyAnimation(value: Boolean)

    suspend fun updateSendShortcut(value: String)

    suspend fun resetAppearanceAndKeyboard()

    fun conversations(server: String): ConversationJournal
}

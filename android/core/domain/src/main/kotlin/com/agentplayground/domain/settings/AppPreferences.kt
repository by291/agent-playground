package com.agentplayground.domain.settings

import kotlinx.serialization.Serializable

@Serializable
data class AppPreferences(
    val serverUrl: String = "http://10.0.2.2:3000/",
    val theme: String = "light",
    val replyAnimation: Boolean = true,
    val sendShortcut: String = "enter",
)

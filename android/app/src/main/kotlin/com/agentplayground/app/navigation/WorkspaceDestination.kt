package com.agentplayground.app.navigation

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

@Serializable
internal enum class WorkspaceDestination(val route: String) : NavKey {
    Chat("chat"),
    Activity("activity"),
    Knowledge("knowledge"),
    Memory("memory"),
    Settings("settings");

    val observesConversation: Boolean
        get() = this == Chat || this == Activity
}

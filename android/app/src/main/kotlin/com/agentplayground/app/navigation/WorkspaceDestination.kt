package com.agentplayground.app.navigation

import androidx.compose.runtime.saveable.Saver

internal enum class WorkspaceDestination(val route: String) {
    Chat("chat"),
    Activity("activity"),
    Knowledge("knowledge"),
    Memory("memory"),
    Settings("settings");

    val observesConversation: Boolean
        get() = this == Chat || this == Activity

    companion object {
        val saver =
            Saver<WorkspaceDestination, String>(
                save = { it.route },
                restore = { route -> entries.firstOrNull { it.route == route } },
            )
    }
}

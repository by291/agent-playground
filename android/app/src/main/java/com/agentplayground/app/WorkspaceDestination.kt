package com.agentplayground.app

import androidx.compose.runtime.saveable.Saver

internal enum class WorkspaceDestination(val route: String) {
    Chat("chat"),
    Activity("activity"),
    Knowledge("knowledge"),
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

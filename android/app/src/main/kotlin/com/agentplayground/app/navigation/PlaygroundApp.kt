package com.agentplayground.app.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.agentplayground.app.PlaygroundApplication
import com.agentplayground.app.di.rememberWorkspaceModels
import com.agentplayground.data.AppPreferences
import com.agentplayground.feature.settings.SettingsRoute
import com.agentplayground.ui.network.ServerNetworkAccess
import com.agentplayground.ui.network.rememberServerNetworkAccess
import kotlinx.coroutines.launch

@Composable
internal fun PlaygroundApp(application: PlaygroundApplication, preferences: AppPreferences) {
    val networkAccess = rememberServerNetworkAccess()

    ServerConnectionGate(application, preferences, networkAccess) {
        val models = rememberWorkspaceModels(application, preferences.serverUrl)

        PlaygroundWorkspace(application.preferences, preferences, networkAccess, models)
    }
}

@Composable
internal fun ServerConnectionGate(
    application: PlaygroundApplication,
    preferences: AppPreferences,
    networkAccess: ServerNetworkAccess,
    content: @Composable () -> Unit,
) {
    var allowed by remember(preferences.serverUrl) { mutableStateOf<Boolean?>(null) }

    LaunchedEffect(networkAccess, preferences.serverUrl) {
        allowed = networkAccess.request(preferences.serverUrl)
    }

    val scope = rememberCoroutineScope()

    LifecycleResumeEffect(networkAccess, preferences.serverUrl) {
        if (allowed == true) {
            scope.launch { allowed = networkAccess.isAllowed(preferences.serverUrl) }
        }

        onPauseOrDispose {}
    }

    when (allowed) {
        true -> content()

        false ->
            SettingsRoute(
                preferences = preferences,
                store = application.preferences,
                onClear = null,
                conversationBusy = false,
                conversationError = null,
                networkAccess = networkAccess,
                localNetworkBlocked = true,
                onConnected = { url ->
                    if (url == preferences.serverUrl) {
                        allowed = true
                    }
                },
            )

        null ->
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
    }
}

package com.agentplayground.feature.settings

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.agentplayground.domain.settings.AppPreferences
import com.agentplayground.ui.network.ServerNetworkAccess
import kotlinx.coroutines.CancellationException

@Composable
fun SettingsRoute(
    preferences: AppPreferences,
    onClear: ((completed: () -> Unit) -> Unit)?,
    conversationBusy: Boolean,
    conversationError: String?,
    onOpenNavigation: (() -> Unit)? = null,
    networkAccess: ServerNetworkAccess,
    localNetworkBlocked: Boolean = false,
    onConnected: (String) -> Unit = {},
) {
    val model =
        hiltViewModel<SettingsViewModel, SettingsViewModel.Factory>(
            creationCallback = { it.create(preferences.serverUrl) }
        )
    SettingsRoute(
        model,
        preferences,
        onClear,
        conversationBusy,
        conversationError,
        onOpenNavigation,
        networkAccess,
        localNetworkBlocked,
        onConnected,
    )
}

@Composable
internal fun SettingsRoute(
    model: SettingsViewModel,
    preferences: AppPreferences,
    onClear: ((completed: () -> Unit) -> Unit)?,
    conversationBusy: Boolean,
    conversationError: String?,
    onOpenNavigation: (() -> Unit)? = null,
    networkAccess: ServerNetworkAccess,
    localNetworkBlocked: Boolean = false,
    onConnected: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val connection by model.state.collectAsStateWithLifecycle()
    val connected by rememberUpdatedState(onConnected)

    LaunchedEffect(model, preferences.serverUrl) { model.savedServerChanged(preferences.serverUrl) }

    DisposableEffect(model) {
        // Leaving settings cancels its connection transaction before another screen can start work.
        onDispose { model.cancelConnection() }
    }

    LaunchedEffect(model, localNetworkBlocked) {
        if (localNetworkBlocked) {
            model.showNetworkBlocked()
        }
    }

    // Permission launchers belong to the UI; connection checking and persistence belong to its
    // model.
    LaunchedEffect(model, networkAccess, connection.permissionRequest) {
        val serverUrl = connection.permissionRequest ?: return@LaunchedEffect

        try {
            model.networkAccessResult(serverUrl, networkAccess.request(serverUrl))
        } catch (cause: Exception) {
            if (cause is CancellationException) {
                throw cause
            }

            model.networkAccessFailed(serverUrl, cause)
        }
    }

    LaunchedEffect(model, connection.connectedServerUrl) {
        connection.connectedServerUrl?.let {
            connected(it)
            model.connectedHandled(it)
        }
    }

    SettingsScreen(
        preferences = preferences,
        connection = connection,
        onServerChanged = model::editServer,
        onConnect = model::connect,
        onThemeChanged = model::updateTheme,
        onReplyAnimationChanged = model::updateReplyAnimation,
        onSendShortcutChanged = model::updateSendShortcut,
        onResetPreferences = model::resetAppearanceAndKeyboard,
        onOpenPermissions = {
            context.startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", context.packageName, null),
                )
            )
        },
        onClear = onClear,
        conversationBusy = conversationBusy,
        conversationError = conversationError,
        onOpenNavigation = onOpenNavigation,
    )
}

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

/** Supplies workspace controls and the local-network gate for the settings destination. */
data class SettingsRouteOptions(
    val preferences: AppPreferences,
    val onClear: ((completed: () -> Unit) -> Unit)?,
    val conversationBusy: Boolean,
    val conversationError: String?,
    val onOpenNavigation: (() -> Unit)? = null,
    val networkAccess: ServerNetworkAccess,
    val localNetworkBlocked: Boolean = false,
    val onConnected: (String) -> Unit = {},
)

/** Binds the retained connection model and the system permission flow for settings. */
@Composable
fun SettingsRoute(options: SettingsRouteOptions) {
    val model =
        hiltViewModel<SettingsViewModel, SettingsViewModel.Factory>(
            creationCallback = { it.create(options.preferences.serverUrl) }
        )

    SettingsRoute(model, options)
}

@Composable
internal fun SettingsRoute(
    model: SettingsViewModel,
    options: SettingsRouteOptions,
) {
    val preferences = options.preferences
    val networkAccess = options.networkAccess
    val context = LocalContext.current
    val connection by model.state.collectAsStateWithLifecycle()
    val connected by rememberUpdatedState(options.onConnected)

    LaunchedEffect(model, preferences.serverUrl) { model.savedServerChanged(preferences.serverUrl) }

    DisposableEffect(model) {
        // Leaving settings cancels its connection transaction before another screen can start work.
        onDispose { model.cancelConnection() }
    }

    LaunchedEffect(model, options.localNetworkBlocked) {
        if (options.localNetworkBlocked) {
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
        onClear = options.onClear,
        conversationBusy = options.conversationBusy,
        conversationError = options.conversationError,
        onOpenNavigation = options.onOpenNavigation,
    )
}

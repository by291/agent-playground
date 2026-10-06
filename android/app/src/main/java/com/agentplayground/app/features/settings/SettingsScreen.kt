package com.agentplayground.app.features.settings

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.agentplayground.app.data.*
import com.agentplayground.app.design.*
import com.agentplayground.app.network.ServerNetworkAccess
import kotlinx.coroutines.CancellationException

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SettingsScreen(
    preferences: AppPreferences,
    store: PreferenceStore,
    onClear: ((completed: () -> Unit) -> Unit)?,
    conversationBusy: Boolean,
    conversationError: String?,
    onOpenNavigation: (() -> Unit)? = null,
    networkAccess: ServerNetworkAccess,
    localNetworkBlocked: Boolean = false,
    onConnected: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val model: SettingsViewModel =
        viewModel(
            factory =
                remember(store) {
                    viewModelFactory {
                        initializer {
                            SettingsViewModel(
                                store,
                                createSavedStateHandle(),
                                preferences.serverUrl,
                            )
                        }
                    }
                }
        )
    val connection by model.state.collectAsStateWithLifecycle()
    val connected by rememberUpdatedState(onConnected)
    var clearing by rememberSaveable { mutableStateOf(false) }

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

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                title = { Text("Settings", style = MaterialTheme.typography.titleLarge) },
                navigationIcon = {
                    if (onOpenNavigation != null) {
                        IconButton(onClick = onOpenNavigation) {
                            Icon(Icons.Outlined.Menu, "Open navigation menu")
                        }
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background
                    ),
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize()
                .padding(padding)
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier.widthIn(max = 760.dp).fillMaxWidth().padding(bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Make it yours.", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "Your connection, your preferences.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            SectionCard(Modifier.widthIn(max = 760.dp)) {
                SectionHeading(
                    "Connection",
                    "Connect to your Playground server",
                    Icons.Outlined.Dns,
                )
                OutlinedTextField(
                    connection.server,
                    model::editServer,
                    label = { Text("Backend URL") },
                    supportingText = {
                        Text("Use your server address. Emulator default: http://10.0.2.2:3000")
                    },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    enabled = !connection.pending,
                )

                Button(
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    shape = MaterialTheme.shapes.small,
                    onClick = model::connect,
                    enabled = !connection.pending && !conversationBusy,
                ) {
                    ChangingContent(connection.pending) { connecting ->
                        Text(
                            if (connecting) {
                                "Connecting…"
                            } else {
                                "Connect and save"
                            }
                        )
                    }
                }

                RevealValue(connection.status) {
                    Text(it, color = MaterialTheme.colorScheme.primary)
                }
                RevealValue(connection.error) { ErrorNotice(it) }

                if (connection.permissionDenied) {
                    ErrorNotice(
                        "Local network access is required to connect to this server. Allow Nearby devices in Android app permissions, then connect again."
                    )
                    TextButton(
                        onClick = {
                            context.startActivity(
                                Intent(
                                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.fromParts("package", context.packageName, null),
                                )
                            )
                        }
                    ) {
                        Text("Open app permissions")
                    }
                }
            }

            SectionCard(Modifier.widthIn(max = 760.dp)) {
                SectionHeading(
                    "Appearance",
                    "Choose how your workspace looks",
                    Icons.Outlined.Palette,
                )

                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("light", "dark", "system").forEach { theme ->
                        FilterChip(
                            selected = preferences.theme == theme,
                            onClick = { model.updateTheme(theme) },
                            label = { Text(theme.replaceFirstChar { it.uppercase() }) },
                        )
                    }
                }

                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Reply animation")
                        Text(
                            "Animate new messages and the jump to latest",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = preferences.replyAnimation,
                        onCheckedChange = model::updateReplyAnimation,
                    )
                }
            }

            SectionCard(Modifier.widthIn(max = 760.dp)) {
                SectionHeading(
                    "Keyboard",
                    "Send shortcut for a hardware keyboard",
                    Icons.Outlined.Keyboard,
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = preferences.sendShortcut == "enter",
                        onClick = { model.updateSendShortcut("enter") },
                        label = { Text("Enter to send") },
                    )
                    FilterChip(
                        selected = preferences.sendShortcut == "modifier-enter",
                        onClick = { model.updateSendShortcut("modifier-enter") },
                        label = { Text("Ctrl / Cmd + Enter") },
                    )
                }
            }

            if (onClear != null) {
                SectionCard(Modifier.widthIn(max = 760.dp)) {
                    SectionHeading(
                        "Conversation data",
                        "Manage history on the connected server",
                        Icons.Outlined.FolderOpen,
                    )
                    Text(
                        "Clear conversation history and its files on the connected server. Shared knowledge documents are retained.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedButton(
                        onClick = { clearing = true },
                        enabled = !conversationBusy,
                        modifier = Modifier.fillMaxWidth(),
                        shape = MaterialTheme.shapes.small,
                    ) {
                        Text("Clear all conversations", color = MaterialTheme.colorScheme.error)
                    }
                }
            }

            TextButton(onClick = model::resetAppearanceAndKeyboard) {
                Text("Reset appearance and keyboard")
            }
        }
    }

    if (clearing && onClear != null) {
        ConfirmDelete(
            "Clear all conversations?",
            "All conversation history and conversation files on this server will be permanently deleted.",
            busy = conversationBusy,
            error = conversationError,
            onConfirm = { onClear { clearing = false } },
            onDismiss = { clearing = false },
        )
    }
}

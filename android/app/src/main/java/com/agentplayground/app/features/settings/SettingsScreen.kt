package com.agentplayground.app.features.settings

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
import androidx.compose.ui.unit.dp
import com.agentplayground.app.data.*
import com.agentplayground.app.design.*
import com.agentplayground.core.*
import kotlinx.coroutines.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    preferences: AppPreferences,
    store: PreferenceStore,
    onClear: (completed: () -> Unit) -> Unit,
    conversationBusy: Boolean,
    conversationError: String?,
    onOpenNavigation: (() -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    var server by rememberSaveable(preferences.serverUrl) { mutableStateOf(preferences.serverUrl) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var clearing by remember { mutableStateOf(false) }
    fun update(value: AppPreferences) {
        scope.launch {
            try {
                store.update(value)
            } catch (cause: Exception) {
                if (cause is CancellationException) {
                    throw cause
                }
                error = cause.message ?: "Settings could not be saved."
            }
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
                    server,
                    {
                        server = it
                        status = null
                        error = null
                    },
                    label = { Text("Backend URL") },
                    supportingText = {
                        Text("Use your server address. Emulator default: http://10.0.2.2:3000")
                    },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    enabled = !pending,
                )
                Button(
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    shape = MaterialTheme.shapes.small,
                    onClick = {
                        pending = true
                        error = null
                        status = null
                        scope.launch {
                            var api: PlaygroundApi? = null
                            try {
                                val normalized = normalizeServerUrl(server)
                                api = PlaygroundApi(normalized)
                                require(api.health()) { "The server health check failed." }
                                val info = api.info()
                                store.update(preferences.copy(serverUrl = normalized))
                                status = "Connected · ${info.model}"
                            } catch (cause: Exception) {
                                if (cause is CancellationException) {
                                    throw cause
                                }
                                error = cause.message ?: "Connection failed."
                            } finally {
                                api?.close()
                                pending = false
                            }
                        }
                    },
                    enabled = !pending && !conversationBusy,
                ) {
                    Text(
                        if (pending) {
                            "Connecting…"
                        } else {
                            "Connect and save"
                        }
                    )
                }
                status?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
                error?.let { ErrorNotice(it) }
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
                            onClick = { update(preferences.copy(theme = theme)) },
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
                            "Animate movement to new replies",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = preferences.replyAnimation,
                        onCheckedChange = { update(preferences.copy(replyAnimation = it)) },
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
                        onClick = { update(preferences.copy(sendShortcut = "enter")) },
                        label = { Text("Enter to send") },
                    )
                    FilterChip(
                        selected = preferences.sendShortcut == "modifier-enter",
                        onClick = { update(preferences.copy(sendShortcut = "modifier-enter")) },
                        label = { Text("Ctrl / Cmd + Enter") },
                    )
                }
            }
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
            TextButton(
                onClick = {
                    update(
                        preferences.copy(
                            theme = "light",
                            replyAnimation = true,
                            sendShortcut = "enter",
                        )
                    )
                }
            ) {
                Text("Reset appearance and keyboard")
            }
        }
    }
    if (clearing) {
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

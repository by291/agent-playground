package com.agentplayground.feature.settings

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
import com.agentplayground.design.ChangingContent
import com.agentplayground.design.ConfirmDelete
import com.agentplayground.design.ErrorNotice
import com.agentplayground.design.RevealValue
import com.agentplayground.design.SectionCard
import com.agentplayground.design.SectionHeading
import com.agentplayground.domain.settings.AppPreferences

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SettingsScreen(
    preferences: AppPreferences,
    connection: SettingsState,
    onServerChanged: (String) -> Unit,
    onConnect: () -> Unit,
    onThemeChanged: (String) -> Unit,
    onReplyAnimationChanged: (Boolean) -> Unit,
    onSendShortcutChanged: (String) -> Unit,
    onResetPreferences: () -> Unit,
    onOpenPermissions: () -> Unit,
    onClear: ((completed: () -> Unit) -> Unit)?,
    conversationBusy: Boolean,
    conversationError: String?,
    onOpenNavigation: (() -> Unit)?,
) {
    var clearing by rememberSaveable { mutableStateOf(false) }

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
                    onServerChanged,
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
                    onClick = onConnect,
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
                    TextButton(onClick = onOpenPermissions) {
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
                            onClick = { onThemeChanged(theme) },
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
                        onCheckedChange = onReplyAnimationChanged,
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
                        onClick = { onSendShortcutChanged("enter") },
                        label = { Text("Enter to send") },
                    )
                    FilterChip(
                        selected = preferences.sendShortcut == "modifier-enter",
                        onClick = { onSendShortcutChanged("modifier-enter") },
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

            TextButton(onClick = onResetPreferences) {
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

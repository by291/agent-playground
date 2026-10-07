package com.agentplayground.feature.conversation

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.agentplayground.core.model.Download
import com.agentplayground.data.AppPreferences
import com.agentplayground.feature.conversation.ui.composer.Composer
import com.agentplayground.feature.conversation.ui.timeline.ConversationTimeline
import com.agentplayground.ui.DownloadSaver

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationRoute(
    vm: ConversationViewModel,
    preferences: AppPreferences,
    onOpenNavigation: (() -> Unit)? = null,
    onActivity: () -> Unit = {},
) {
    val state by vm.state.collectAsStateWithLifecycle()
    var menu by remember { mutableStateOf(false) }
    var download by rememberSaveable(stateSaver = DownloadSaver) { mutableStateOf<Download?>(null) }

    val filePicker =
        rememberLauncherForActivityResult(
            ActivityResultContracts.OpenMultipleDocuments(),
            vm::attach,
        )
    val savePicker =
        rememberLauncherForActivityResult(
            ActivityResultContracts.CreateDocument("application/octet-stream")
        ) { uri ->
            val selected = download

            if (uri != null && selected != null) {
                vm.save(selected, uri)
            }

            download = null
        }

    val onDownload: (Download) -> Unit = {
        download = it
        savePicker.launch(it.name)
    }

    val uriHandler = LocalUriHandler.current
    val onLink: (String) -> Unit = { link ->
        if (link.startsWith("https://") || link.startsWith("http://")) {
            runCatching { uriHandler.openUri(link) }
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compactHeight = maxHeight < 600.dp
        val onSelect: (String?) -> Unit = vm::select

        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = MaterialTheme.colorScheme.surface,
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            topBar = {
                TopAppBar(
                    colors =
                        TopAppBarDefaults.topAppBarColors(
                            containerColor = MaterialTheme.colorScheme.surface
                        ),
                    title = {
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                state.session?.title ?: "Agent Playground",
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.testTag("conversation-title"),
                            )
                            Text(
                                "Agent Playground",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    },
                    navigationIcon = {
                        if (onOpenNavigation != null) {
                            IconButton(onClick = onOpenNavigation) {
                                Icon(Icons.Outlined.Menu, "Open conversation history")
                            }
                        }
                    },
                    actions = {
                        IconButton(
                            onClick = { onSelect(null) },
                            enabled = !state.uploading,
                        ) {
                            Icon(Icons.Outlined.Add, "New conversation")
                        }
                        Box {
                            IconButton(onClick = { menu = true }) {
                                Icon(Icons.Outlined.MoreHoriz, "Conversation options")
                            }
                            DropdownMenu(menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(
                                    text = { Text("Agent activity") },
                                    leadingIcon = { Icon(Icons.Outlined.Timeline, null) },
                                    onClick = {
                                        menu = false
                                        onActivity()
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Refresh conversation") },
                                    leadingIcon = { Icon(Icons.Outlined.Refresh, null) },
                                    onClick = {
                                        menu = false
                                        vm.recover()
                                    },
                                )
                            }
                        }
                    },
                )
            },
            bottomBar = {
                Composer(
                    state = state,
                    preferences = preferences,
                    currentDraft = { vm.state.value.session?.draft.orEmpty() },
                    onEditInput = vm::editInput,
                    onSend = vm::send,
                    onRemoveAttachment = vm::removeAttachment,
                    loadImage = vm::loadAttachmentImage,
                    onAttach = { filePicker.launch(arrayOf("*/*")) },
                )
            },
        ) { padding ->
            val session = state.session

            if (session == null) {
                Box(
                    Modifier.fillMaxSize().padding(padding),
                    contentAlignment = androidx.compose.ui.Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
            } else {
                key(session.threadId) {
                    ConversationTimeline(
                        session,
                        state.error,
                        preferences,
                        Modifier.padding(padding),
                        vm::recover,
                        vm::editPlan,
                        { id, action, plan, ids -> vm.review(id, action, plan, ids) },
                        vm::submitPlanReviews,
                        onDownload,
                        onLink,
                        vm::fileDownload,
                        vm::documentDownload,
                        vm::editDraft,
                        compactHeight,
                        vm::attachmentPresentation,
                        vm::loadAttachmentImage,
                        onSubmitExternalTaskInput = vm::submitExternalTaskInput,
                        onCancelExternalTask = vm::cancelExternalTask,
                    )
                }
            }
        }
    }
}

package com.agentplayground.feature.conversation

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.agentplayground.domain.conversation.PlanDraft
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.MessageAttachment
import com.agentplayground.domain.model.SkillFile
import com.agentplayground.domain.presentation.UploadedAttachment
import com.agentplayground.domain.settings.AppPreferences
import com.agentplayground.feature.conversation.ui.attachments.AttachmentImageLoader
import com.agentplayground.feature.conversation.ui.composer.Composer
import com.agentplayground.feature.conversation.ui.timeline.ConversationTimeline

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ConversationScreen(
    state: ConversationUiState,
    preferences: AppPreferences,
    currentDraft: () -> String,
    onSelect: (String?) -> Unit,
    onRecover: () -> Unit,
    onEditInput: (String) -> Unit,
    onSend: () -> Unit,
    onRemoveAttachment: (String) -> Unit,
    onAttach: () -> Unit,
    onSelectModel: (String) -> Unit,
    onEditPlan: (String, PlanDraft) -> Unit,
    onReview: (String, String, PlanDraft?, Set<String>) -> Unit,
    onContinueReviews: (Set<String>) -> Unit,
    onDownload: (Download) -> Unit,
    onLink: (String) -> Unit,
    fileDownload: (SkillFile) -> Download,
    documentDownload: (String, String) -> Download,
    onSuggestion: (String) -> Unit,
    attachmentPresentation: (String, UploadedAttachment) -> MessageAttachment,
    loadImage: AttachmentImageLoader,
    onSubmitExternalTaskInput: (String, String) -> Unit,
    onCancelExternalTask: (String) -> Unit,
    onOpenNavigation: (() -> Unit)?,
    onActivity: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compactHeight = maxHeight < 600.dp

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
                                        onRecover()
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
                    currentDraft = currentDraft,
                    onEditInput = onEditInput,
                    onSend = onSend,
                    onRemoveAttachment = onRemoveAttachment,
                    loadImage = loadImage,
                    onAttach = onAttach,
                    onSelectModel = onSelectModel,
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
                        onRecover,
                        onEditPlan,
                        onReview,
                        onContinueReviews,
                        onDownload,
                        onLink,
                        fileDownload,
                        documentDownload,
                        onSuggestion,
                        compactHeight,
                        attachmentPresentation,
                        loadImage,
                        onSubmitExternalTaskInput = onSubmitExternalTaskInput,
                        onCancelExternalTask = onCancelExternalTask,
                    )
                }
            }
        }
    }
}

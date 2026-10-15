package com.agentplayground.feature.conversation

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalUriHandler
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.settings.AppPreferences
import com.agentplayground.ui.DownloadSaver
import com.agentplayground.ui.files.rememberAttachmentImageLoader

@Composable
fun ConversationRoute(
    vm: ConversationViewModel,
    preferences: AppPreferences,
    onOpenNavigation: (() -> Unit)? = null,
    onActivity: () -> Unit = {},
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val loadImage = rememberAttachmentImageLoader(preferences.serverUrl, vm::attachmentBytes)
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

    ConversationScreen(
        state = state,
        preferences = preferences,
        currentDraft = { vm.state.value.session?.draft.orEmpty() },
        onSelect = vm::select,
        onRecover = vm::recover,
        onEditInput = vm::editInput,
        onSend = vm::send,
        onRemoveAttachment = vm::removeAttachment,
        onAttach = { filePicker.launch(arrayOf("*/*")) },
        onSelectModel = vm::selectModel,
        onEditPlan = vm::editPlan,
        onReview = vm::review,
        onContinueReviews = vm::submitPlanReviews,
        onDownload = onDownload,
        onLink = onLink,
        fileDownload = vm::fileDownload,
        documentDownload = vm::documentDownload,
        onSuggestion = vm::editDraft,
        attachmentPresentation = vm::attachmentPresentation,
        loadImage = loadImage,
        onSubmitExternalTaskInput = vm::submitExternalTaskInput,
        onCancelExternalTask = vm::cancelExternalTask,
        onOpenNavigation = onOpenNavigation,
        onActivity = onActivity,
        onEditInteraction = vm::editInteraction,
        onSubmitInteraction = vm::respondToInteraction,
    )
}

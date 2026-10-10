package com.agentplayground.feature.knowledge

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.agentplayground.domain.model.Download
import com.agentplayground.ui.DownloadSaver

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KnowledgeRoute(vm: KnowledgeViewModel, onOpenNavigation: (() -> Unit)? = null) {
    val state by vm.state.collectAsStateWithLifecycle()
    var download by rememberSaveable(stateSaver = DownloadSaver) { mutableStateOf<Download?>(null) }

    val picker =
        rememberLauncherForActivityResult(
            ActivityResultContracts.OpenMultipleDocuments(),
            vm::upload,
        )
    val resumePicker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument(), vm::resumeUpload)
    val saver =
        rememberLauncherForActivityResult(
            ActivityResultContracts.CreateDocument("application/octet-stream")
        ) { uri ->
            download?.let {
                if (uri != null) {
                    vm.save(it, uri)
                }
            }

            download = null
        }

    KnowledgeScreen(
        state = state,
        onReload = vm::reload,
        onUpload = { picker.launch(arrayOf("text/plain", "text/markdown", "application/pdf")) },
        onResumeUpload = { document ->
            if (vm.beginResume(document.id)) {
                resumePicker.launch(arrayOf("text/plain", "text/markdown", "application/pdf"))
            }
        },
        onDownload = { document ->
            download = vm.documentDownload(document)
            saver.launch(document.name)
        },
        onRetryUploads = vm::retryUploads,
        onDiscardUploads = vm::discardUploads,
        onClearError = vm::clearError,
        onReindex = vm::reindex,
        onDelete = vm::delete,
        onOpenNavigation = onOpenNavigation,
    )
}

package com.agentplayground.app.features.conversation

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.agentplayground.app.files.Download
import com.agentplayground.app.files.PickedFile
import com.agentplayground.core.isPreviewImage
import kotlinx.coroutines.CancellationException

data class ImagePreview(val name: String, val thumbnail: String, val full: String = thumbnail)

data class MessageAttachment(
    val name: String,
    val download: Download? = null,
    val preview: ImagePreview? = null,
)

internal typealias AttachmentImageLoader = suspend (String, Int) -> ImageBitmap?

@Composable
internal fun MessageAttachments(
    attachments: List<MessageAttachment>,
    onDownload: (Download) -> Unit,
    loadImage: AttachmentImageLoader,
) {
    var selected by remember(attachments) { mutableStateOf<Int?>(null) }
    val images = attachments.filter { it.preview != null }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        attachments.forEachIndexed { index, attachment ->
            OutlinedCard(
                onClick = {
                    if (attachment.preview != null) {
                        selected = attachments.take(index).count { it.preview != null }
                    } else {
                        attachment.download?.let(onDownload)
                    }
                },
                enabled = attachment.preview != null || attachment.download != null,
                colors =
                    CardDefaults.outlinedCardColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    ),
                modifier = Modifier.widthIn(max = 320.dp).fillMaxWidth(),
            ) {
                Row(
                    Modifier.padding(10.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (attachment.preview != null) {
                        AttachmentImage(
                            attachment.preview.thumbnail,
                            320,
                            "Preview ${attachment.name}",
                            loadImage,
                            Modifier.size(64.dp),
                        )
                    } else {
                        Icon(
                            Icons.AutoMirrored.Outlined.InsertDriveFile,
                            null,
                            Modifier.size(24.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            attachment.name,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            if (attachment.preview != null) "View image" else "Download file",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    attachment.download?.let { download ->
                        IconButton(onClick = { onDownload(download) }) {
                            Icon(Icons.Outlined.Download, "Download ${attachment.name}")
                        }
                    }
                }
            }
        }
    }

    selected?.let { index ->
        AttachmentImageViewer(
            images,
            index,
            onDownload,
            loadImage,
            onDismiss = { selected = null },
        )
    }
}

@Composable
internal fun SelectedAttachments(
    files: List<PickedFile>,
    uploading: Boolean,
    onRemove: (String) -> Unit,
    loadImage: AttachmentImageLoader,
) {
    var selected by remember(files) { mutableStateOf<String?>(null) }
    val images = files.filter { isPreviewImage(it.name) }

    FlowRow(
        Modifier.padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        files.forEach { file ->
            key(file.id) {
                val preview =
                    if (isPreviewImage(file.name)) {
                        ImagePreview(file.name, file.uri.toString())
                    } else {
                        null
                    }

                Surface(
                    onClick = { selected = file.id },
                    enabled = preview != null,
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    color = MaterialTheme.colorScheme.surfaceContainerLow,
                    modifier = Modifier.widthIn(max = 260.dp),
                ) {
                    Row(
                        Modifier.padding(start = 10.dp, top = 6.dp, bottom = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (preview != null) {
                            AttachmentImage(
                                preview.thumbnail,
                                320,
                                "Preview ${file.name}",
                                loadImage,
                                Modifier.size(56.dp),
                            )
                        } else {
                            Icon(
                                Icons.AutoMirrored.Outlined.InsertDriveFile,
                                null,
                                Modifier.size(20.dp),
                            )
                        }

                        Text(
                            file.name,
                            Modifier.weight(1f, fill = false),
                            style = MaterialTheme.typography.labelMedium,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        IconButton(onClick = { onRemove(file.id) }, enabled = !uploading) {
                            Icon(Icons.Outlined.Close, "Remove ${file.name}")
                        }
                    }
                }
            }
        }
    }

    selected?.let { id ->
        AttachmentImageViewer(
            images.map { file ->
                MessageAttachment(file.name, preview = ImagePreview(file.name, file.uri.toString()))
            },
            images.indexOfFirst { it.id == id },
            {},
            loadImage,
            onDismiss = { selected = null },
        )
    }
}

internal sealed interface AttachmentImageState {
    data object Loading : AttachmentImageState

    data object Unavailable : AttachmentImageState

    data class Loaded(val bitmap: ImageBitmap) : AttachmentImageState
}

@Composable
internal fun rememberAttachmentImage(
    source: String,
    maxDimension: Int,
    loadImage: AttachmentImageLoader,
    active: Boolean = true,
): State<AttachmentImageState> {
    val currentLoader by rememberUpdatedState(loadImage)

    return produceState<AttachmentImageState>(
        AttachmentImageState.Loading,
        source,
        maxDimension,
        active,
    ) {
        if (!active) {
            return@produceState
        }

        value = AttachmentImageState.Loading

        try {
            val bitmap = currentLoader(source, maxDimension)
            value =
                if (bitmap == null) AttachmentImageState.Unavailable
                else AttachmentImageState.Loaded(bitmap)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            value = AttachmentImageState.Unavailable
        }
    }
}

@Composable
private fun AttachmentImage(
    source: String,
    maxDimension: Int,
    description: String,
    loadImage: AttachmentImageLoader,
    modifier: Modifier,
) {
    val image by rememberAttachmentImage(source, maxDimension, loadImage)

    Box(modifier, contentAlignment = Alignment.Center) {
        when (val state = image) {
            AttachmentImageState.Loading ->
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            AttachmentImageState.Unavailable ->
                Icon(
                    Icons.Outlined.BrokenImage,
                    "Image preview unavailable",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            is AttachmentImageState.Loaded ->
                Image(
                    state.bitmap,
                    description,
                    Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
        }
    }
}

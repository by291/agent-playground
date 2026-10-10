package com.agentplayground.ui.files

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext

/** Decoding lives with the visible UI; private remote bytes still pass through the repository. */
@Composable
fun rememberAttachmentImageLoader(
    serverUrl: String,
    remoteBytes: suspend (String) -> ByteArray,
): suspend (String, Int) -> ImageBitmap? {
    val application = LocalContext.current.applicationContext
    val currentBytes = rememberUpdatedState(remoteBytes)
    val images = remember(application, serverUrl) { AttachmentImages(application) }

    DisposableEffect(images) { onDispose { images.close() } }

    return remember(images) {
        { source, dimension ->
            images.load(source, dimension) { currentBytes.value(it) }?.asImageBitmap()
        }
    }
}

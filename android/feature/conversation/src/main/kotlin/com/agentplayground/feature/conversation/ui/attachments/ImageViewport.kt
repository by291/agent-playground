package com.agentplayground.feature.conversation.ui.attachments

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import kotlin.math.min

internal data class ImageTransform(val scale: Float = 1f, val offset: Offset = Offset.Zero)

internal fun imagePanBounds(viewport: Size, image: Size, scale: Float): Offset {
    if (viewport.isEmpty() || image.isEmpty()) {
        return Offset.Zero
    }

    val fit = min(viewport.width / image.width, viewport.height / image.height)

    return Offset(
        ((image.width * fit * scale - viewport.width) / 2).coerceAtLeast(0f),
        ((image.height * fit * scale - viewport.height) / 2).coerceAtLeast(0f),
    )
}

internal fun transformImage(
    current: ImageTransform,
    zoomChange: Float,
    pan: Offset,
    centroid: Offset,
    viewport: Size,
    image: Size,
): ImageTransform {
    val scale = (current.scale * zoomChange).coerceIn(1f, 5f)

    if (scale == 1f) {
        return ImageTransform()
    }

    // Keep the image point beneath the gesture's focal point stationary while zooming.
    val ratio = scale / current.scale
    val focalPoint = centroid - Offset(viewport.width / 2, viewport.height / 2)
    val offset = current.offset * ratio + focalPoint * (1 - ratio) + pan
    val bounds = imagePanBounds(viewport, image, scale)

    return ImageTransform(
        scale,
        Offset(offset.x.coerceIn(-bounds.x, bounds.x), offset.y.coerceIn(-bounds.y, bounds.y)),
    )
}

internal fun interpolateImageTransform(
    start: ImageTransform,
    end: ImageTransform,
    fraction: Float,
): ImageTransform =
    ImageTransform(
        start.scale + (end.scale - start.scale) * fraction,
        start.offset + (end.offset - start.offset) * fraction,
    )

package com.agentplayground.app.features.conversation

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animate
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.BrokenImage
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import com.agentplayground.app.design.Motion
import com.agentplayground.app.files.Download
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

private val viewerBackground = Color(0xFF0B0D10)

@Composable
internal fun AttachmentImageViewer(
    images: List<MessageAttachment>,
    initialIndex: Int,
    onDownload: (Download) -> Unit,
    loadImage: AttachmentImageLoader,
    onDismiss: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties =
            DialogProperties(
                usePlatformDefaultWidth = false,
                decorFitsSystemWindows = false,
                dismissOnClickOutside = false,
            ),
    ) {
        val view = LocalView.current

        SideEffect {
            (view.parent as? DialogWindowProvider)?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = false
                    isAppearanceLightNavigationBars = false
                }
            }
        }

        ImageViewerContent(images, initialIndex, onDownload, loadImage, onDismiss)
    }
}

@Composable
private fun ImageViewerContent(
    images: List<MessageAttachment>,
    initialIndex: Int,
    onDownload: (Download) -> Unit,
    loadImage: AttachmentImageLoader,
    onDismiss: () -> Unit,
) {
    val pager =
        rememberPagerState(initialPage = initialIndex.coerceIn(images.indices)) { images.size }
    val scope = rememberCoroutineScope()
    var chromeVisible by remember { mutableStateOf(true) }
    var viewport by remember { mutableStateOf(Size.Zero) }
    var transform by remember(pager.currentPage) { mutableStateOf(ImageTransform()) }
    var imageSize by remember(pager.currentPage) { mutableStateOf(Size.Zero) }
    var dismissalOffset by remember { mutableFloatStateOf(0f) }
    var motionJob by remember { mutableStateOf<Job?>(null) }
    val current = images[pager.currentPage]
    val dismissalProgress = (dismissalOffset / viewport.height.coerceAtLeast(1f)).coerceIn(0f, 1f)

    fun animateTransform(target: ImageTransform) {
        motionJob?.cancel()
        val start = transform

        motionJob = scope.launch {
            animate(0f, 1f, animationSpec = Motion.expansion()) { fraction, _ ->
                transform = interpolateImageTransform(start, target, fraction)
            }
        }
    }

    fun zoomAt(point: Offset) {
        val targetScale = if (transform.scale > 1f) 1f else 2.5f
        animateTransform(
            transformImage(
                transform,
                targetScale / transform.scale,
                Offset.Zero,
                point,
                viewport,
                imageSize,
            )
        )
    }

    fun settleDismissal() {
        if (dismissalOffset >= viewport.height * 0.18f) {
            onDismiss()
        } else {
            val start = dismissalOffset

            motionJob = scope.launch {
                animate(start, 0f, animationSpec = Motion.feedback()) { value, _ ->
                    dismissalOffset = value
                }
            }
        }
    }

    LaunchedEffect(pager.currentPage) {
        motionJob?.cancel()
        chromeVisible = true
        dismissalOffset = 0f
    }

    Box(
        Modifier.fillMaxSize()
            .testTag("image-viewer")
            .semantics { paneTitle = "Image viewer" }
            .background(viewerBackground.copy(alpha = 1f - dismissalProgress * 0.65f))
            .onSizeChanged { size ->
                val next = Size(size.width.toFloat(), size.height.toFloat())

                if (viewport != next) {
                    motionJob?.cancel()
                    viewport = next
                    // Insets and control visibility can shift the viewport slightly. Retain zoom
                    // and clamp to its new bounds instead of resetting the reader's gesture.
                    transform =
                        transformImage(
                            transform,
                            1f,
                            Offset.Zero,
                            Offset(next.width / 2f, next.height / 2f),
                            next,
                            imageSize,
                        )
                    dismissalOffset = 0f
                }
            }
    ) {
        HorizontalPager(
            state = pager,
            userScrollEnabled = transform.scale == 1f && dismissalOffset == 0f,
            key = { page -> "$page:${images[page].preview!!.full}" },
            modifier =
                Modifier.fillMaxSize().graphicsLayer {
                    translationY = dismissalOffset
                    scaleX = 1f - dismissalProgress * 0.15f
                    scaleY = scaleX
                },
        ) { page ->
            val active = page == pager.currentPage
            val attachment = images[page]
            val preview = attachment.preview!!
            val state by rememberAttachmentImage(preview.full, 2048, loadImage, active)
            val bitmap = (state as? AttachmentImageState.Loaded)?.bitmap
            val ready by rememberUpdatedState(bitmap != null)

            if (active && bitmap != null) {
                SideEffect { imageSize = Size(bitmap.width.toFloat(), bitmap.height.toFloat()) }
            }

            val gesture by
                rememberUpdatedState<(Float, Offset, Offset) -> Unit> { zoom, pan, centroid ->
                    transform = transformImage(transform, zoom, pan, centroid, viewport, imageSize)
                }
            val zoomed by rememberUpdatedState(transform.scale > 1f)
            val mayDismiss by
                rememberUpdatedState(!pager.isScrollInProgress && transform.scale == 1f)

            Box(
                Modifier.fillMaxSize()
                    .clipToBounds()
                    .testTag("image-viewer-page:$page")
                    .semantics {
                        stateDescription =
                            if (transform.scale == 1f) {
                                "Fit to screen"
                            } else {
                                "Zoom ${(transform.scale * 100).roundToInt()} percent"
                            }
                        onClick("Show or hide image controls") {
                            chromeVisible = !chromeVisible
                            true
                        }
                        customActions = buildList {
                            add(
                                CustomAccessibilityAction("Close image viewer") {
                                    onDismiss()
                                    true
                                }
                            )
                            if (ready) {
                                add(
                                    CustomAccessibilityAction(
                                        if (zoomed) "Reset zoom" else "Zoom image"
                                    ) {
                                        zoomAt(Offset(viewport.width / 2f, viewport.height / 2f))
                                        true
                                    }
                                )
                            }

                            if (page > 0) {
                                add(
                                    CustomAccessibilityAction("Previous image") {
                                        scope.launch { pager.animateScrollToPage(page - 1) }
                                        true
                                    }
                                )
                            }

                            if (page < images.lastIndex) {
                                add(
                                    CustomAccessibilityAction("Next image") {
                                        scope.launch { pager.animateScrollToPage(page + 1) }
                                        true
                                    }
                                )
                            }
                        }
                    }
                    .pointerInput(preview.full, active) {
                        if (active) {
                            detectTapGestures(
                                onTap = { chromeVisible = !chromeVisible },
                                onDoubleTap = { point ->
                                    if (ready) {
                                        zoomAt(point)
                                    }
                                },
                            )
                        }
                    }
                    .pointerInput(preview.full, active) {
                        if (active) {
                            detectImageInteractions(
                                isZoomed = { zoomed },
                                canDismiss = { mayDismiss },
                                onStart = {
                                    motionJob?.cancel()
                                    // A new touch interrupts snap-back at fit rather than leaving a
                                    // translated page with paging disabled.
                                    dismissalOffset = 0f
                                },
                                onTransform = { zoom, pan, centroid ->
                                    if (ready) {
                                        gesture(zoom, pan, centroid)
                                    }
                                },
                                onDismissDrag = { delta ->
                                    dismissalOffset = (dismissalOffset + delta).coerceAtLeast(0f)
                                },
                                onDismissEnd = ::settleDismissal,
                            )
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                when (val image = state) {
                    AttachmentImageState.Loading ->
                        CircularProgressIndicator(
                            Modifier.size(32.dp),
                            color = Color.White,
                            strokeWidth = 2.dp,
                        )
                    AttachmentImageState.Unavailable ->
                        ViewerImageError(attachment.download, onDownload)
                    is AttachmentImageState.Loaded ->
                        Image(
                            image.bitmap,
                            if (active) preview.name else null,
                            Modifier.fillMaxSize().graphicsLayer {
                                scaleX = transform.scale
                                scaleY = transform.scale
                                translationX = transform.offset.x
                                translationY = transform.offset.y
                            },
                            contentScale = ContentScale.Fit,
                        )
                }
            }
        }

        AnimatedVisibility(
            visible = chromeVisible,
            modifier = Modifier.align(Alignment.TopCenter),
            enter = fadeIn(Motion.feedback()),
            exit = fadeOut(Motion.feedback()),
        ) {
            ViewerChrome(
                current.name,
                pager.currentPage,
                images.size,
                current.download,
                onDownload,
                onDismiss,
            )
        }

        if (images.size > 1) {
            AnimatedVisibility(
                visible = chromeVisible,
                modifier = Modifier.align(Alignment.BottomCenter),
                enter = fadeIn(Motion.feedback()),
                exit = fadeOut(Motion.feedback()),
            ) {
                Row(
                    Modifier.navigationBarsPadding().padding(bottom = 22.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    images.indices.forEach { page ->
                        Box(
                            Modifier.size(6.dp)
                                .background(
                                    Color.White.copy(
                                        alpha = if (page == pager.currentPage) 0.95f else 0.3f
                                    ),
                                    CircleShape,
                                )
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ViewerChrome(
    name: String,
    index: Int,
    count: Int,
    download: Download?,
    onDownload: (Download) -> Unit,
    onDismiss: () -> Unit,
) {
    Box(
        Modifier.fillMaxWidth()
            .background(
                Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.75f), Color.Transparent))
            )
            .padding(bottom = 38.dp)
    ) {
        Row(
            Modifier.statusBarsPadding().padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onDismiss) {
                Icon(
                    Icons.AutoMirrored.Outlined.ArrowBack,
                    "Close image preview",
                    tint = Color.White,
                )
            }

            Column(
                Modifier.weight(1f).padding(horizontal = 8.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    name,
                    color = Color.White,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${index + 1} of $count",
                    color = Color.White.copy(alpha = 0.65f),
                    style = MaterialTheme.typography.labelSmall,
                )
            }

            if (download != null) {
                IconButton(onClick = { onDownload(download) }) {
                    Icon(Icons.Outlined.Download, "Download original", tint = Color.White)
                }
            }
        }
    }
}

@Composable
private fun ViewerImageError(download: Download?, onDownload: (Download) -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            Icons.Outlined.BrokenImage,
            null,
            Modifier.size(36.dp),
            tint = Color.White.copy(alpha = 0.7f),
        )
        Text(
            "Image preview unavailable",
            color = Color.White.copy(alpha = 0.85f),
            style = MaterialTheme.typography.bodyMedium,
        )

        if (download != null) {
            TextButton(onClick = { onDownload(download) }) {
                Text("Download original", color = Color.White)
            }
        }
    }
}

private suspend fun PointerInputScope.detectImageInteractions(
    isZoomed: () -> Boolean,
    canDismiss: () -> Boolean,
    onStart: () -> Unit,
    onTransform: (Float, Offset, Offset) -> Unit,
    onDismissDrag: (Float) -> Unit,
    onDismissEnd: () -> Unit,
) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false)
        onStart()
        var accumulatedPan = Offset.Zero
        var transforming = false
        var dismissing = false
        var dismissalDistance = 0f
        var hadMultiplePointers = false

        do {
            val event = awaitPointerEvent()
            val pressed = event.changes.count { it.pressed }
            val alreadyDragging =
                event.changes.any { it.isConsumed && it.position != it.previousPosition }

            if (alreadyDragging) {
                break
            }

            val pan = event.calculatePan()
            accumulatedPan += pan

            if (pressed > 1) {
                if (dismissing) {
                    onDismissDrag(-dismissalDistance)
                    dismissing = false
                }

                hadMultiplePointers = true
                transforming = true
            } else if (isZoomed() && accumulatedPan.getDistance() > viewConfiguration.touchSlop) {
                transforming = true
            }

            if (transforming && pressed > 0) {
                onTransform(event.calculateZoom(), pan, event.calculateCentroid(useCurrent = false))
                event.changes.forEach { it.consume() }
            } else if (!hadMultiplePointers && canDismiss()) {
                // Unzoomed horizontal drags stay unconsumed for HorizontalPager. Only a downward
                // single-pointer gesture owns dismissal; pinch/pan cannot become dismissal later.
                if (
                    !dismissing &&
                        accumulatedPan.y > viewConfiguration.touchSlop &&
                        accumulatedPan.y > abs(accumulatedPan.x)
                ) {
                    dismissing = true
                    dismissalDistance = accumulatedPan.y
                    onDismissDrag(dismissalDistance)
                } else if (dismissing) {
                    val nextDistance = (dismissalDistance + pan.y).coerceAtLeast(0f)
                    onDismissDrag(nextDistance - dismissalDistance)
                    dismissalDistance = nextDistance
                }

                if (dismissing) {
                    event.changes.forEach { it.consume() }
                }
            }
        } while (event.changes.any { it.pressed })

        if (dismissing) {
            onDismissEnd()
        }
    }
}

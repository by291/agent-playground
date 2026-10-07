package com.agentplayground.ui

import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException

/** Compose animations inherit the system duration scale, including the zero-duration setting. */
object Motion {
    const val Feedback = 140
    const val Expand = 220
    const val Exit = 160
    const val Page = 260
    const val Progress = 300

    fun <T> feedback(): TweenSpec<T> = tween(Feedback)

    fun <T> expansion(): TweenSpec<T> = tween(Expand, easing = FastOutSlowInEasing)
}

@Composable
fun Reveal(visible: Boolean, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    AnimatedVisibility(
        visible,
        modifier,
        enter =
            fadeIn(tween(Motion.Feedback)) +
                expandVertically(Motion.expansion(), expandFrom = Alignment.Top),
        exit =
            fadeOut(tween(Motion.Exit)) +
                shrinkVertically(tween(Motion.Exit), shrinkTowards = Alignment.Top),
    ) {
        content()
    }
}

@Composable
fun <T : Any> RevealValue(value: T?, content: @Composable (T) -> Unit) {
    var retained by remember { mutableStateOf(value) }

    if (value != null) {
        retained = value
    }

    Reveal(value != null) { retained?.let { content(it) } }
}

@Composable
fun <T> ChangingContent(
    value: T,
    modifier: Modifier = Modifier,
    content: @Composable (T) -> Unit,
) {
    Crossfade(value, modifier, animationSpec = Motion.feedback(), label = "status") {
        content(it)
    }
}

@Composable
fun DisclosureChevron(expanded: Boolean, size: Dp = 16.dp) {
    val rotation by
        animateFloatAsState(if (expanded) 180f else 0f, Motion.expansion(), label = "disclosure")

    Icon(
        Icons.Outlined.ExpandMore,
        null,
        Modifier.size(size).rotate(rotation),
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** Only an admitted new item gets an entrance; streaming updates keep the same composition. */
@Composable
fun EntryAppearance(
    animate: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val progress = remember { Animatable(if (animate) 0f else 1f) }

    LaunchedEffect(animate) {
        if (animate) {
            progress.animateTo(1f, Motion.expansion())
        } else {
            progress.snapTo(1f)
        }
    }

    Box(
        modifier.graphicsLayer {
            alpha = progress.value
            translationY = (1f - progress.value) * 8.dp.toPx()
        }
    ) {
        content()
    }
}

@Composable
fun reportedProgress(value: Float): State<Float> =
    animateFloatAsState(value.coerceIn(0f, 1f), tween(Motion.Progress), label = "reported-progress")

/** The gesture previews the return without changing navigation; cancellation restores this page. */
@Composable
fun BackPreview(
    enabled: Boolean = true,
    onBack: () -> Unit,
    content: @Composable (Modifier) -> Unit,
) {
    val progress = remember { Animatable(0f) }

    PredictiveBackHandler(enabled) { events ->
        try {
            events.collect { progress.snapTo(it.progress) }

            onBack()
            progress.snapTo(0f)
        } catch (_: CancellationException) {
            progress.animateTo(0f, Motion.expansion())
        }
    }

    content(
        Modifier.graphicsLayer {
            translationX = progress.value * 64.dp.toPx()
            scaleX = 1f - progress.value * 0.04f
            scaleY = scaleX
        }
    )
}

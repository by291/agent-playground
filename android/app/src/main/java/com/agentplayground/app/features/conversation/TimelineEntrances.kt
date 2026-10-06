package com.agentplayground.app.features.conversation

import androidx.compose.runtime.*
import com.agentplayground.app.design.EntryAppearance

internal val LocalTimelineEntrances = staticCompositionLocalOf<TimelineEntrances?> { null }
internal val LocalReplyAnimation = staticCompositionLocalOf { false }

@Composable
internal fun ReplyEntrance(id: String, content: @Composable () -> Unit) {
    val entrances = LocalTimelineEntrances.current
    val admitted = remember(id) { entrances?.consume(id) == true }
    EntryAppearance(admitted && LocalReplyAnimation.current, content = content)
}

/** A snapshot establishes the baseline; only subsequent additions receive one entrance. */
internal class TimelineEntrances {
    private var initialized = false
    private var restoring = false
    private val seen = mutableSetOf<String>()
    private val pending = mutableSetOf<String>()

    fun observe(keys: Set<String>, loading: Boolean) {
        if (initialized && !loading && !restoring) {
            pending.addAll(keys - seen)
        } else {
            pending.clear()
        }
        seen.addAll(keys)
        pending.retainAll(keys)
        initialized = true
        restoring = loading
    }

    fun consume(key: String): Boolean = pending.remove(key)
}

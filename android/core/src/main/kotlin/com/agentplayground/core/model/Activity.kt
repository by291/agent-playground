package com.agentplayground.core.model

import com.agui.core.types.BaseEvent

/** Retains the official event for complete inspection and export in the native client. */
data class ActivityEntry(
    val sequence: Long,
    val receivedAt: Long,
    val runId: String?,
    val event: BaseEvent,
)

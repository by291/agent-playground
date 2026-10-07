package com.agentplayground.core

import com.agui.core.types.Interrupt
import com.agui.core.types.Message

data class SessionState(
    val threadId: String,
    val title: String = "New conversation",
    val draft: String = "",
    val messages: List<Message> = emptyList(),
    val interrupts: List<Interrupt> = emptyList(),
    val outputs: List<WorkflowOutput> = emptyList(),
    val externalTasks: List<ExternalTask> = emptyList(),
    val externalTaskControls: Map<String, ExternalTaskControl> = emptyMap(),
    val runs: List<RunRecord> = emptyList(),
    val contextUsage: ContextUsage? = null,
    val activity: List<ActivityEntry> = emptyList(),
    val receivedEventCount: Long = 0,
    val busy: Boolean = false,
    val loading: Boolean = false,
    val streaming: Boolean = false,
    val executionStatus: String? = null,
    val error: String? = null,
    val outputError: String? = null,
    val missingOutputSequence: Int? = null,
    val planDecisions: Map<String, String> = emptyMap(),
    val planDrafts: Map<String, PlanDraft> = emptyMap(),
) {
    val canSend
        get() =
            !busy &&
                !loading &&
                externalTasks.none { it.kind == "a2a" && isExternalTaskActive(it.status) } &&
                (interrupts.isEmpty() ||
                    interrupts.singleOrNull()?.let(Review::from)?.let {
                        it.kind == "workflow_review" && !it.expired
                    } == true)
}

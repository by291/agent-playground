package com.agentplayground.core.conversation

import com.agentplayground.core.model.ActivityEntry
import com.agentplayground.core.model.ContextUsage
import com.agentplayground.core.model.ExternalTask
import com.agentplayground.core.model.ExternalTaskControl
import com.agentplayground.core.model.RunRecord
import com.agentplayground.core.model.WorkflowOutput
import com.agentplayground.core.model.isActiveRun
import com.agentplayground.core.model.isExternalTaskActive
import com.agui.core.types.Interrupt
import com.agui.core.types.Message

data class SessionState(
    val threadId: String,
    val title: String = "New conversation",
    val draft: String = "",
    val messages: List<Message> = emptyList(),
    val messageTimestamps: Map<String, String> = emptyMap(),
    val interrupts: List<Interrupt> = emptyList(),
    val outputs: List<WorkflowOutput> = emptyList(),
    val externalTasks: List<ExternalTask> = emptyList(),
    val externalTaskControls: Map<String, ExternalTaskControl> = emptyMap(),
    val runs: List<RunRecord> = emptyList(),
    val contextUsage: ContextUsage? = null,
    val modelId: String? = null,
    val modelSelectionLocal: Boolean = false,
    val modelSelectionPending: Boolean = false,
    val modelSelectionError: String? = null,
    val pendingSubmission: Boolean = false,
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
    val canSelectModel
        get() =
            !busy &&
                !loading &&
                !modelSelectionPending &&
                !pendingSubmission &&
                interrupts.isEmpty() &&
                runs.lastOrNull()?.let { isActiveRun(it.status) || it.status == "interrupted" } !=
                    true &&
                externalTasks.none { isExternalTaskActive(it.status) }

    val canSend
        get() =
            !busy &&
                !modelSelectionPending &&
                !loading &&
                externalTasks.none { it.kind == "a2a" && isExternalTaskActive(it.status) } &&
                (interrupts.isEmpty() ||
                    interrupts.singleOrNull()?.let(Review::from)?.let {
                        it.kind == "workflow_review" && !it.expired
                    } == true)
}

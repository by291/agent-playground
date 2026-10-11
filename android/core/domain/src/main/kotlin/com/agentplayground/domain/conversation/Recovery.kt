package com.agentplayground.domain.conversation

import com.agentplayground.domain.model.ConversationSnapshot
import com.agentplayground.domain.model.PendingSubmission
import com.agentplayground.domain.model.isActiveRun
import com.agui.core.types.Message

sealed interface RecoveryDecision {
    data object Retry : RecoveryDecision

    data object Observe : RecoveryDecision

    data object Confirmed : RecoveryDecision
}

/** Chooses how to recover the original admission identity without creating a replacement run. */
fun recoveryDecision(
    snapshot: ConversationSnapshot?,
    pending: PendingSubmission,
): RecoveryDecision {
    val run = snapshot?.runs?.find { it.runId == pending.input.runId }
    val messagePresent = snapshot?.messages?.any { it.id == pending.messageId } == true

    if (run == null) {
        return if (messagePresent) {
            RecoveryDecision.Observe
        } else {
            RecoveryDecision.Retry
        }
    }

    if (run.status == "prepared") {
        // Prepared reserves admission but still needs dispatch. Retry the persisted input with its
        // original run/message identities; creating a new request would admit a second run.
        return RecoveryDecision.Retry
    }

    if (isActiveRun(run.status)) {
        return RecoveryDecision.Observe
    }

    if (run.status == "failed" || messagePresent || !pending.input.resume.isNullOrEmpty()) {
        return RecoveryDecision.Confirmed
    }

    return RecoveryDecision.Observe
}

data class ReconciledConversation(
    val messages: List<Message>,
    val confirmed: Boolean,
    val needsRecovery: Boolean,
)

/** Keeps optimistic messages until the snapshot confirms the pending admission. */
fun reconcile(
    snapshot: ConversationSnapshot?,
    pending: PendingSubmission?,
    local: List<Message>,
): ReconciledConversation {
    val decision = pending?.let { recoveryDecision(snapshot, it) }
    val canonical = decision == RecoveryDecision.Confirmed || pending == null
    val messages =
        if (canonical) {
            snapshot?.messages.orEmpty()
        } else {
            val serverMessages = snapshot?.messages.orEmpty()
            val localById = local.associateBy { it.id }
            val ids = serverMessages.map { it.id }.toSet()

            serverMessages.map { localById[it.id] ?: it } + local.filter { it.id !in ids }
        }

    return ReconciledConversation(
        messages = messages,
        confirmed = decision == RecoveryDecision.Confirmed,
        needsRecovery =
            (pending != null && !canonical) ||
                snapshot?.runs?.any { isActiveRun(it.status) } == true,
    )
}

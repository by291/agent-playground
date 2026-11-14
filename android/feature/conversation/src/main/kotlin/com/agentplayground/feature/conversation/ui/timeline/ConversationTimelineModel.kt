package com.agentplayground.feature.conversation.ui.timeline

import com.agentplayground.domain.conversation.InteractionRequest
import com.agentplayground.domain.conversation.Review
import com.agentplayground.domain.conversation.SessionState
import com.agentplayground.domain.conversation.externalWaitCallId
import com.agentplayground.domain.model.ExternalTask
import com.agentplayground.domain.model.WorkflowOutput
import com.agentplayground.domain.model.string
import com.agentplayground.domain.presentation.ConversationTurn
import com.agentplayground.domain.presentation.LegacyWorkflowSurface
import com.agentplayground.domain.presentation.conversationTurns
import com.agentplayground.domain.presentation.legacyWorkflowArtifacts
import com.agui.core.types.Interrupt

internal data class ConversationTimelineModel(
    val turns: List<ConversationTimelineTurn>,
    val standalonePresentations: List<WorkflowOutput>,
    val standaloneLegacySurfaces: List<LegacyWorkflowSurface>,
    val standaloneTasks: List<ExternalTask>,
    val visibleInterrupts: List<Interrupt>,
    val pendingPlans: List<Interrupt>,
    val empty: Boolean,
)

internal data class ConversationTimelineTurn(
    val turn: ConversationTurn,
    val presentations: List<WorkflowOutput>,
    val legacySurfaces: List<LegacyWorkflowSurface>,
    val tasks: List<ExternalTask>,
    val previousSurfaceIds: List<String>,
    val hasReviews: Boolean,
    val showReply: Boolean,
)

/**
 * Project session state and renderer surface identities without depending on Compose or transport.
 */
internal fun conversationTimelineModel(
    state: SessionState,
    surfaces: List<LegacyWorkflowSurface>,
): ConversationTimelineModel {
    val waits = state.interrupts.mapNotNull(::externalWaitCallId).toSet()
    val latestStatus =
        state.executionStatus ?: if (state.interrupts.isNotEmpty()) "interrupted" else null
    val turns = conversationTurns(state.messages, state.runs, waits, latestStatus)

    // Session outputs are already ordered by server sequence. The last presentation in each group
    // owns the current card; its anchor can move that card to a later feedback reply.
    val presentations =
        state.outputs
            .filter { it.workflow?.presentation != null }
            .groupBy { it.workflow!!.presentation!!.groupId }
            .values
            .map { it.last() }
    val currentSurfaceIds = presentations.map { it.workflow!!.presentation!!.surfaceId }.toSet()
    val presentationHistory =
        state.outputs
            .filter {
                val presentation = it.workflow?.presentation

                presentation != null && presentation.surfaceId !in currentSurfaceIds
            }
            .distinctBy { it.workflow!!.presentation!!.surfaceId }
    val owners = mutableMapOf<String, String>()

    for (output in state.outputs) {
        val presentation = output.workflow?.presentation ?: continue
        val owner =
            turns.find { turn -> turn.messages.any { it.id == presentation.anchorMessageId } }
                ?: turns.find { turn -> turn.toolCalls.any { it.call.id == output.toolCallId } }

        if (owner != null) {
            owners[presentation.groupId] = owner.id
        }
    }

    val groupedSurfaces = state.outputs.mapNotNull { it.workflow?.presentation?.surfaceId }.toSet()
    val calls = turns.flatMap { it.toolCalls }.map { it.call }
    val reviewCalls =
        state.interrupts.mapNotNull { Review.from(it)?.raw?.string("workflowCallId") }.toSet()
    val legacy =
        legacyWorkflowArtifacts(
            calls,
            surfaces.filter { it.id !in groupedSurfaces },
            reviewCalls,
            state.interrupts.any {
                Review.from(it)?.kind == "experiment_plan_review" &&
                    Review.from(it)?.raw?.string("workflowCallId") == null
            },
        )
    val visibleInterrupts =
        state.interrupts.filter {
            Review.from(it)?.raw?.string("workflowCallId") !in legacy.completedCallIds &&
                InteractionRequest.from(it) == null
        }
    val pendingPlans = visibleInterrupts.filter {
        Review.from(it)?.kind == "experiment_plan_review"
    }

    val duplicateA2aResults = duplicateA2aResultSurfaces(state)

    val timelineTurns = turns.mapIndexed { index, turn ->
        val ownedCards = presentations.filter {
            owners[it.workflow!!.presentation!!.groupId] == turn.id
        }

        val callIds = turn.toolCalls.map { it.call.id }.toSet()
        val tasks = state.externalTasks.filter { it.workflowCallId in callIds }
        val legacyCards = legacy.current.filter { it.toolCallId in callIds }
        val legacyHistory = legacy.history.filter { it.toolCallId in callIds }

        // History stays with the originating tool process even when feedback owns the current card.
        val previousSurfaces =
            (presentationHistory
                    .filter { it.toolCallId in callIds }
                    .map { it.workflow!!.presentation!!.surfaceId } + legacyHistory.map { it.id })
                .distinct()
        val duplicateTurnSurfaces =
            duplicateA2aResults.filter { it.second in callIds }.map { it.first }.toSet()
        val hasReviews = index == turns.lastIndex && visibleInterrupts.isNotEmpty()
        val showReply =
            turn.messages.isNotEmpty() ||
                ownedCards.isNotEmpty() ||
                legacyCards.isNotEmpty() ||
                legacyHistory.isNotEmpty() ||
                tasks.isNotEmpty() ||
                hasReviews

        // Compatibility affects composition only; ownership and archived output identities stay
        // intact.
        ConversationTimelineTurn(
            turn,
            ownedCards.filter {
                (it.workflow!!.presentation!!.surfaceId to it.toolCallId) !in duplicateA2aResults
            },
            legacyCards.filter { (it.id to it.toolCallId) !in duplicateA2aResults },
            tasks,
            previousSurfaces.filter { it !in duplicateTurnSurfaces },
            hasReviews,
            showReply,
        )
    }

    val attachedCalls = calls.map { it.id }.toSet()
    val empty =
        turns.isEmpty() &&
            state.outputs.isEmpty() &&
            state.interrupts.isEmpty() &&
            state.externalTasks.isEmpty() &&
            !state.loading &&
            !state.busy

    return ConversationTimelineModel(
        timelineTurns,
        presentations.filter {
            it.workflow!!.presentation!!.groupId !in owners &&
                (it.workflow!!.presentation!!.surfaceId to it.toolCallId) !in duplicateA2aResults
        },
        legacy.current.filter {
            it.toolCallId !in attachedCalls && (it.id to it.toolCallId) !in duplicateA2aResults
        },
        state.externalTasks.filter { it.workflowCallId !in attachedCalls },
        visibleInterrupts,
        pendingPlans,
        empty,
    )
}

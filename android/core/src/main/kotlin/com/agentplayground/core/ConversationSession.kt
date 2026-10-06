package com.agentplayground.core

import com.agui.core.types.*
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * One instance owns one thread. Android lifecycle and navigation release its jobs.
 *
 * Calls and collected events must share the scope's serialized owner context (Android uses Main).
 * The mutexes serialize suspendable snapshot/journal work, not access from multiple dispatchers.
 */
class ConversationSession(
    private val api: ConversationApi,
    private val persistence: ConversationPersistence,
    scope: CoroutineScope,
    saved: SavedConversation,
    private val now: () -> java.time.Instant = java.time.Instant::now,
) {
    private val lifetime = SupervisorJob(scope.coroutineContext[Job])
    private val scope = CoroutineScope(scope.coroutineContext + lifetime)

    private var closed = false
    private var admitting = false
    // A terminal event does not release admission until EOF and snapshot reconciliation finish.
    private var settling = false
    private var attached = true
    private var streamGeneration = 0

    val threadId = saved.threadId
    private var saved = saved
    private var pending = saved.pending

    private var streamJob: Job? = null
    private var changeJob: Job? = null
    private var recoveryJob: Job? = null
    private val snapshotMutex = Mutex()
    private val journalMutex = Mutex()

    private val outputBuffer = OutputBuffer()
    // A snapshot may replace streamed messages only when no event arrived during its fetch.
    private var eventRevision = 0L
    private var activitySequence = 0L
    private var activityRunId: String? = null
    private var observing = false

    private val mutableState =
        MutableStateFlow(
            SessionState(
                threadId,
                draft = saved.draft,
                messages = pendingMessage(saved.pending)?.let { listOf(it) }.orEmpty(),
                loading = !saved.empty || saved.pending != null,
            )
        )
    val state: StateFlow<SessionState> = mutableState.asStateFlow()

    suspend fun restore() {
        val snapshot = refresh()

        if (
            mutableState.value.error == null &&
                pending?.let { recoveryDecision(snapshot, it) } == RecoveryDecision.Retry
        ) {
            startRun(pending!!)
        }
    }

    fun editDraft(text: String) {
        mutableState.update { it.copy(draft = text) }
    }

    suspend fun saveDraft() {
        if (closed) {
            return
        }

        updateSaved { it.copy(draft = state.value.draft) }
    }

    fun observe() {
        if (observing) {
            return
        }

        if (closed) {
            return
        }

        attached = true
        observing = true
        scope.launch { recoverPending() }
        changeJob = scope.launch {
            while (isActive) {
                try {
                    api.changes(threadId).collect { event ->
                        if (event.name in setOf("ready", "changed")) {
                            refresh()
                        }
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    // The snapshot polling below covers stream disconnects and new empty threads.
                }

                delay(3_000)
            }
        }

        recoveryJob = scope.launch {
            while (isActive) {
                if (
                    state.value.busy ||
                        state.value.error != null ||
                        state.value.externalTasks.any { it.status in setOf("queued", "running") } ||
                        outputBuffer.missingSequence != null
                ) {
                    recoverPending()
                }

                delay(4_000)
            }
        }
    }

    fun stopObserving() {
        observing = false
        attached = false
        streamGeneration += 1

        changeJob?.cancel()
        recoveryJob?.cancel()
        streamJob?.cancel()
        streamJob = null
        settling = false

        mutableState.update { it.copy(streaming = false) }
    }

    suspend fun send(text: String) {
        if (closed || admitting || settling || !state.value.canSend || text.isBlank()) {
            return
        }

        val message = UserMessage(UUID.randomUUID().toString(), text.trim())
        val interrupts = state.value.interrupts
        val resume =
            if (interrupts.isEmpty()) {
                null
            } else {
                val review = interrupts.singleOrNull()?.let(Review::from)
                val response = review?.respond("message", message.content, message.id) ?: return

                listOf(response)
            }

        submit(
            PendingSubmission(
                newSubmission(threadId, UUID.randomUUID().toString(), message, resume),
                message.id,
            ),
            message,
        )
    }

    suspend fun review(
        interruptId: String,
        action: String,
        plan: PlanDraft? = null,
        planInterruptIds: Set<String>? = null,
    ) {
        if (closed || admitting || settling || state.value.busy || state.value.loading) {
            return
        }

        val resolution =
            resolveReview(state.value, interruptId, action, plan, planInterruptIds, now()) ?: return

        applyReviewResolution(resolution)
    }

    suspend fun submitPlanReviews(planInterruptIds: Set<String>? = null) {
        if (closed || admitting || settling || state.value.busy || state.value.loading) {
            return
        }

        val resolution = resolvePlanReviews(state.value, planInterruptIds, now()) ?: return

        applyReviewResolution(resolution)
    }

    private suspend fun applyReviewResolution(resolution: ReviewResolution) {
        when (resolution) {
            is ReviewResolution.SelectPlan ->
                mutableState.update {
                    it.copy(
                        planDecisions =
                            it.planDecisions + (resolution.interruptId to resolution.action),
                        planDrafts = it.planDrafts + (resolution.interruptId to resolution.draft),
                        error = null,
                    )
                }

            is ReviewResolution.Submit -> {
                val runId = UUID.randomUUID().toString()

                submit(
                    PendingSubmission(
                        newSubmission(threadId, runId, resume = resolution.entries),
                        runId,
                    ),
                    null,
                )
            }

            ReviewResolution.InvalidPlans ->
                mutableState.update {
                    it.copy(
                        planDecisions = emptyMap(),
                        error = "A plan is no longer valid. Refresh before deciding again.",
                    )
                }
        }
    }

    fun editPlan(interruptId: String, draft: PlanDraft) {
        if (closed || admitting || settling || state.value.busy || state.value.loading) {
            return
        }

        if (!canEditPlanReview(state.value, interruptId, now())) {
            return
        }

        mutableState.update {
            it.copy(
                planDrafts = it.planDrafts + (interruptId to draft),
                planDecisions = it.planDecisions - interruptId,
            )
        }
    }

    private suspend fun submit(submission: PendingSubmission, message: UserMessage?) {
        admitting = true
        // Lock the UI before the first suspension so rapid taps cannot create two admissions.
        mutableState.update { it.copy(busy = true, executionStatus = "running", error = null) }

        try {
            updateSaved { it.copy(pending = submission, empty = false, draft = "") }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            admitting = false
            mutableState.update {
                it.copy(
                    busy = false,
                    executionStatus = null,
                    error = "Could not save the pending request: ${error.message}",
                )
            }

            return
        }

        admitting = false
        pending = submission

        if (closed) {
            return
        }

        mutableState.update {
            it.copy(
                draft = "",
                messages =
                    if (message != null) {
                        it.messages + message
                    } else {
                        it.messages
                    },
                interrupts = emptyList(),
                planDecisions = emptyMap(),
                planDrafts = emptyMap(),
            )
        }

        startRun(submission)
    }

    private fun startRun(submission: PendingSubmission) {
        if (closed || !attached || settling || streamJob?.isActive == true) {
            return
        }

        mutableState.update {
            it.copy(busy = true, executionStatus = "running", loading = false, error = null)
        }
        settling = true
        activityRunId = submission.input.runId
        val generation = ++streamGeneration

        streamJob = scope.launch {
            try {
                api.run(submission.input).collect { event -> receive(event) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                mutableState.update {
                    it.copy(
                        error = error.message ?: "Agent connection failed. Recover before retrying."
                    )
                }
            } finally {
                // Detaching invalidates this generation. An old stream cannot settle or unlock
                // a replacement stream, including when its snapshot finishes after reattachment.
                if (generation == streamGeneration && currentCoroutineContext().isActive) {
                    mutableState.update { it.copy(streaming = false) }
                    refresh(settlement = true)

                    if (generation == streamGeneration) {
                        // Release request ownership before publishing an idle UI.
                        streamJob = null
                        settling = false

                        mutableState.update {
                            it.copy(
                                busy =
                                    pending != null ||
                                        it.runs.any { run -> isActiveRun(run.status) } ||
                                        it.missingOutputSequence != null ||
                                        it.outputError != null
                            )
                        }
                    }
                }
            }
        }
    }

    suspend fun recoverPending() {
        val snapshot = refresh()
        val current = pending

        if (
            state.value.error == null &&
                !state.value.streaming &&
                streamJob?.isActive != true &&
                current != null &&
                recoveryDecision(snapshot, current) == RecoveryDecision.Retry
        ) {
            startRun(current)
        }
    }

    suspend fun refresh(settlement: Boolean = false): ConversationSnapshot? =
        snapshotMutex.withLock {
            val before = eventRevision

            try {
                val snapshot = api.snapshot(threadId)
                val locallyActive = admitting || (settling && !settlement)
                val result = reconcile(snapshot, pending, state.value.messages)
                // Only a quiet owner can accept canonical messages/interrupts. Settlement is the
                // stream owner's final reconciliation; polling cannot release that ownership.
                val useCanonicalMessages = !locallyActive && before == eventRevision

                ingestOutputs(snapshot?.outputs.orEmpty())

                if (result.confirmed && !locallyActive) {
                    updateSaved {
                        it.copy(
                            pending = null,
                            empty =
                                snapshot?.messages.isNullOrEmpty() &&
                                    snapshot?.outputs.isNullOrEmpty(),
                        )
                    }
                    pending = null
                }

                if (
                    useCanonicalMessages && snapshot?.interrupts.orEmpty() != state.value.interrupts
                ) {
                    mutableState.update {
                        it.copy(planDecisions = emptyMap(), planDrafts = emptyMap())
                    }
                }

                mutableState.update { current ->
                    val usage = latestContextUsage(current.contextUsage, snapshot?.contextUsage)

                    current.copy(
                        title = snapshot?.title ?: current.title,
                        messages =
                            if (useCanonicalMessages) {
                                addOutputReplies(result.messages, current.outputs)
                            } else {
                                current.messages
                            },
                        interrupts =
                            if (useCanonicalMessages) {
                                snapshot?.interrupts.orEmpty()
                            } else {
                                current.interrupts
                            },
                        externalTasks = snapshot?.externalTasks ?: current.externalTasks,
                        runs = snapshot?.runs ?: current.runs,
                        executionStatus =
                            if (useCanonicalMessages) null else current.executionStatus,
                        contextUsage = usage,
                        busy =
                            admitting ||
                                settling ||
                                result.needsRecovery ||
                                outputBuffer.missingSequence != null ||
                                current.outputError != null,
                        loading = false,
                        error =
                            if (snapshot?.runs?.lastOrNull()?.status == "failed") {
                                current.error ?: "The agent run failed. You can send a new message."
                            } else {
                                null
                            },
                    )
                }

                snapshot
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                mutableState.update {
                    it.copy(
                        loading = false,
                        error = error.message ?: "Conversation recovery failed.",
                    )
                }

                null
            }
        }

    private fun receive(event: BaseEvent) {
        eventRevision += 1

        if (event is RunStartedEvent) {
            activityRunId = event.runId
        }

        val activityEntry =
            ActivityEntry(++activitySequence, now().toEpochMilli(), activityRunId, event)

        mutableState.update { reduceConversationEvent(it, event) }

        try {
            val output = decodeWorkflowOutput(event)

            if (output != null) {
                ingestOutputs(listOf(output))
            }
        } catch (error: Exception) {
            mutableState.update {
                it.copy(outputError = "Invalid workflow output: ${error.message}")
            }
        }

        mutableState.update {
            it.copy(
                activity = (it.activity + activityEntry).takeLast(300),
                receivedEventCount = it.receivedEventCount + 1,
            )
        }
    }

    fun clearActivity() {
        mutableState.update { it.copy(activity = emptyList(), receivedEventCount = 0) }
    }

    private fun ingestOutputs(outputs: List<WorkflowOutput>) {
        val delivery = outputBuffer.ingest(outputs)

        mutableState.update {
            val combined = it.outputs + delivery.ready

            it.copy(
                outputs = combined,
                messages = addOutputReplies(it.messages, combined),
                outputError = delivery.error,
                missingOutputSequence = outputBuffer.missingSequence,
            )
        }
    }

    private suspend fun updateSaved(transform: (SavedConversation) -> SavedConversation) =
        journalMutex.withLock {
            // Transform the latest journal under the lock, then persist before publishing memory.
            // A delayed draft save must neither erase a pending identity nor acknowledge a failed
            // write.
            val next = transform(saved)

            persistence.write(next)
            saved = next
        }

    fun close() {
        closed = true
        stopObserving()
        lifetime.cancel()
    }
}

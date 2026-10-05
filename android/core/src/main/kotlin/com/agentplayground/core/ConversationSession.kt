package com.agentplayground.core

import com.agui.core.types.*
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

/** One instance owns one thread. Android lifecycle and navigation release its jobs. */
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
    private var eventRevision = 0L
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

    suspend fun review(interruptId: String, action: String, plan: PlanDraft? = null) {
        if (closed || admitting || settling || state.value.busy || state.value.loading) {
            return
        }

        val review =
            state.value.interrupts.find { it.id == interruptId }?.let(Review::from) ?: return
        val entries =
            if (review.kind == "experiment_plan_review") {
                val draft =
                    plan
                        ?: state.value.planDrafts[interruptId]
                        ?: PlanDraft(review.title, review.steps)
                review.respond(action, plan = draft, now = now()) ?: return
                mutableState.update {
                    it.copy(
                        planDecisions = it.planDecisions + (interruptId to action),
                        planDrafts = it.planDrafts + (interruptId to draft),
                    )
                }
                val plans =
                    state.value.interrupts.mapNotNull(Review::from).filter {
                        it.kind == "experiment_plan_review"
                    }
                if (plans.any { it.interrupt.id !in state.value.planDecisions }) {
                    return
                }

                val responses = plans.map { current ->
                    current.respond(
                        state.value.planDecisions.getValue(current.interrupt.id),
                        plan = state.value.planDrafts[current.interrupt.id],
                        now = now(),
                    )
                }
                if (responses.any { it == null }) {
                    mutableState.update { current ->
                        current.copy(
                            planDecisions = emptyMap(),
                            error = "A plan is no longer valid. Refresh before deciding again.",
                        )
                    }
                    return
                }

                responses.filterNotNull()
            } else {
                listOf(review.respond(action, now = now()) ?: return)
            }
        val runId = UUID.randomUUID().toString()

        submit(PendingSubmission(newSubmission(threadId, runId, resume = entries), runId), null)
    }

    fun editPlan(interruptId: String, draft: PlanDraft) {
        if (closed || state.value.busy || state.value.loading) {
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
        mutableState.update { it.copy(busy = true, error = null) }
        try {
            updateSaved { it.copy(pending = submission, empty = false, draft = "") }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            admitting = false
            mutableState.update {
                it.copy(
                    busy = false,
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

        mutableState.update { it.copy(busy = true, loading = false, error = null) }
        settling = true
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
                    val usage =
                        snapshot?.contextUsage?.takeIf {
                            it.revision >= (current.contextUsage?.revision ?: 0)
                        } ?: current.contextUsage
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
        mutableState.update { current ->
            when (event) {
                is RunStartedEvent -> current.copy(streaming = true, busy = true)
                is ReasoningMessageStartEvent ->
                    current.copy(
                        messages = upsert(current.messages, reasoningMessage(event.messageId))
                    )
                is ReasoningMessageContentEvent ->
                    current.copy(
                        messages =
                            current.messages.map {
                                if (isReasoning(it) && it.id == event.messageId) {
                                    (it as AssistantMessage).copy(
                                        content = it.content.orEmpty() + event.delta
                                    )
                                } else {
                                    it
                                }
                            }
                    )
                is TextMessageStartEvent ->
                    current.copy(
                        messages = upsert(current.messages, AssistantMessage(event.messageId, ""))
                    )
                is TextMessageContentEvent ->
                    current.copy(
                        messages =
                            current.messages.map {
                                if (it is AssistantMessage && it.id == event.messageId) {
                                    it.copy(content = it.content.orEmpty() + event.delta)
                                } else {
                                    it
                                }
                            }
                    )
                is MessagesSnapshotEvent -> current.copy(messages = event.messages)
                is ToolCallStartEvent -> {
                    val owner = event.parentMessageId ?: "tool-${event.toolCallId}"
                    val previous =
                        current.messages.find { it.id == owner } as? AssistantMessage
                            ?: AssistantMessage(owner)
                    val calls =
                        previous.toolCalls.orEmpty().filterNot { it.id == event.toolCallId } +
                            ToolCall(event.toolCallId, FunctionCall(event.toolCallName, ""))
                    current.copy(
                        messages = upsert(current.messages, previous.copy(toolCalls = calls))
                    )
                }
                is ToolCallArgsEvent ->
                    current.copy(
                        messages =
                            current.messages.map { message ->
                                if (message is AssistantMessage) {
                                    message.copy(
                                        toolCalls =
                                            message.toolCalls?.map { call ->
                                                if (call.id == event.toolCallId) {
                                                    call.copy(
                                                        function =
                                                            call.function.copy(
                                                                arguments =
                                                                    call.function.arguments +
                                                                        event.delta
                                                            )
                                                    )
                                                } else {
                                                    call
                                                }
                                            }
                                    )
                                } else {
                                    message
                                }
                            }
                    )
                is ToolCallResultEvent ->
                    current.copy(
                        messages =
                            upsert(
                                current.messages,
                                ToolMessage(event.messageId, event.content, event.toolCallId),
                            )
                    )
                is StateSnapshotEvent -> {
                    val snapshot = event.snapshot as? JsonObject
                    val usage =
                        snapshot?.get("context_usage")?.let {
                            runCatching { protocolJson.decodeFromJsonElement<ContextUsage>(it) }
                                .getOrNull()
                        }
                    val errors =
                        (snapshot?.get("toolErrors") as? JsonArray).orEmpty().mapNotNull {
                            runCatching { protocolJson.decodeFromJsonElement<Message>(it) }
                                .getOrNull()
                        }
                    current.copy(
                        contextUsage =
                            usage?.takeIf { it.revision >= (current.contextUsage?.revision ?: 0) }
                                ?: current.contextUsage,
                        messages =
                            errors.fold(current.messages) { messages, error ->
                                upsert(messages, error)
                            },
                    )
                }
                is RunFinishedEvent ->
                    current.copy(
                        streaming = false,
                        interrupts =
                            (event.outcome as? RunFinishedInterruptOutcome)?.interrupts.orEmpty(),
                    )
                is RunErrorEvent -> current.copy(streaming = false, error = event.message)
                else -> current
            }
        }
        if (event is CustomEvent && event.name == "a2ui") {
            try {
                ingestOutputs(listOf(protocolJson.decodeFromJsonElement(event.value)))
            } catch (error: Exception) {
                mutableState.update {
                    it.copy(outputError = "Invalid workflow output: ${error.message}")
                }
            }
        }
        if (event is CustomEvent && event.name == "context_usage") {
            runCatching { protocolJson.decodeFromJsonElement<ContextUsage>(event.value) }
                .getOrNull()
                ?.let { usage ->
                    mutableState.update {
                        if (usage.revision >= (it.contextUsage?.revision ?: 0)) {
                            it.copy(contextUsage = usage)
                        } else {
                            it
                        }
                    }
                }
        }
        mutableState.update {
            it.copy(
                activity =
                    (it.activity +
                            "${event.eventType.name}\n${protocolJson.encodeToString(BaseEvent.serializer(), event).take(4_000)}")
                        .takeLast(300)
            )
        }
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

data class SessionState(
    val threadId: String,
    val title: String = "New conversation",
    val draft: String = "",
    val messages: List<Message> = emptyList(),
    val interrupts: List<Interrupt> = emptyList(),
    val outputs: List<WorkflowOutput> = emptyList(),
    val externalTasks: List<ExternalTask> = emptyList(),
    val runs: List<RunRecord> = emptyList(),
    val contextUsage: ContextUsage? = null,
    val activity: List<String> = emptyList(),
    val busy: Boolean = false,
    val loading: Boolean = false,
    val streaming: Boolean = false,
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
                (interrupts.isEmpty() ||
                    interrupts.singleOrNull()?.let(Review::from)?.let {
                        it.kind == "workflow_review" && !it.expired
                    } == true)
}

private fun upsert(messages: List<Message>, message: Message): List<Message> =
    if (messages.any { it.id == message.id }) {
        messages.map {
            if (it.id == message.id) {
                message
            } else {
                it
            }
        }
    } else {
        messages + message
    }

private fun addOutputReplies(
    messages: List<Message>,
    outputs: List<WorkflowOutput>,
): List<Message> =
    outputs.fold(messages) { result, output ->
        val reply = output.workflow?.reply
        if (reply != null && result.none { it.id == reply.id }) {
            result + AssistantMessage(reply.id, reply.content)
        } else {
            result
        }
    }

private fun pendingMessage(pending: PendingSubmission?): UserMessage? {
    val normal = pending?.input?.messages?.filterIsInstance<UserMessage>()?.lastOrNull()
    if (normal != null) {
        return normal
    }

    val feedback =
        pending
            ?.input
            ?.resume
            ?.mapNotNull { it.payload as? JsonObject }
            ?.find { it.string("action") == "message" } ?: return null
    val id = feedback.string("messageId") ?: return null
    val content = feedback.string("message") ?: return null

    return UserMessage(id, content)
}

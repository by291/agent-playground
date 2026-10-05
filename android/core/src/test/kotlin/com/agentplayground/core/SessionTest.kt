package com.agentplayground.core

import com.agui.core.types.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SessionTest {
    @Test
    fun `rapid sends admit once and persist the exact input before network execution`() = runTest {
        val persistence = MemoryPersistence()
        val api = ControlledApi()
        val session =
            ConversationSession(api, persistence, backgroundScope, SavedConversation("thread"))
        session.restore()
        session.editDraft("Hello")
        session.send("Hello")
        session.send("Duplicate")
        runCurrent()
        assertEquals(1, api.inputs.size)
        assertEquals(persistence.saved!!.pending!!.input, api.inputs.single())
        assertEquals("Hello", session.state.value.messages.single().content)
        assertTrue(session.state.value.busy)
        session.close()
    }

    @Test
    fun `failed persistence keeps draft and never starts network admission`() = runTest {
        val persistence = MemoryPersistence(failWrite = true)
        val api = ControlledApi()
        val session =
            ConversationSession(api, persistence, backgroundScope, SavedConversation("thread"))
        session.restore()
        session.editDraft("Hello")
        session.send("Hello")
        runCurrent()
        assertTrue(api.inputs.isEmpty())
        assertEquals("Hello", session.state.value.draft)
        assertFalse(session.state.value.busy)
        assertNotNull(session.state.value.error)
    }

    @Test
    fun `restored server admission observes without repeating the run`() = runTest {
        val pending =
            PendingSubmission(
                newSubmission("thread", "original", UserMessage("message", "Hello")),
                "message",
            )
        val api =
            ControlledApi().apply {
                snapshot =
                    emptySnapshot.copy(runs = listOf(RunRecord("original", "message", "running")))
            }
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread", pending = pending, empty = false),
            )
        session.restore()
        runCurrent()
        assertTrue(api.inputs.isEmpty())
        assertTrue(session.state.value.busy)
        session.close()
    }

    @Test
    fun `restored unconfirmed request reuses its original run ID`() = runTest {
        val pending =
            PendingSubmission(
                newSubmission("thread", "original", UserMessage("message", "Hello")),
                "message",
            )
        val persistence =
            MemoryPersistence(SavedConversation("thread", pending = pending, empty = false))
        val api = ControlledApi()
        val session = ConversationSession(api, persistence, backgroundScope, persistence.saved!!)
        session.restore()
        runCurrent()
        assertEquals("original", api.inputs.single().runId)
        assertEquals("message", api.inputs.single().messages.single().id)
        session.close()
    }

    @Test
    fun `stream text survives a concurrently fetched stale snapshot`() = runTest {
        val api = ControlledApi()
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread"),
            )
        session.restore()
        session.send("Hello")
        runCurrent()
        api.events.emit(TextMessageStartEvent("reply"))
        runCurrent()
        val snapshotGate = CompletableDeferred<Unit>()
        api.beforeSnapshot = { snapshotGate.await() }
        val refresh = backgroundScope.launch { session.refresh() }
        runCurrent()
        api.events.emit(TextMessageContentEvent("reply", "New text"))
        runCurrent()
        snapshotGate.complete(Unit)
        runCurrent()
        assertEquals("New text", session.state.value.messages.find { it.id == "reply" }?.content)
        refresh.cancel()
        session.close()
    }

    @Test
    fun `refresh cannot release an admission whose persistence is still pending`() = runTest {
        val persistence = MemoryPersistence()
        val gate = CompletableDeferred<Unit>()
        persistence.beforeWrite = { gate.await() }
        val api = ControlledApi()
        val session =
            ConversationSession(api, persistence, backgroundScope, SavedConversation("thread"))
        session.restore()
        val sending = backgroundScope.launch { session.send("First") }
        runCurrent()
        session.refresh()
        assertTrue(session.state.value.busy)
        session.send("Second")
        gate.complete(Unit)
        runCurrent()
        assertEquals(1, api.inputs.size)
        sending.cancel()
        session.close()
    }

    @Test
    fun `finished event keeps admission locked until stream settlement`() = runTest {
        val api = ControlledApi()
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread"),
            )
        session.restore()
        session.send("Hello")
        runCurrent()
        val input = api.inputs.single()
        api.events.emit(RunFinishedEvent("thread", input.runId))
        runCurrent()
        api.snapshot =
            emptySnapshot.copy(
                messages = input.messages,
                runs = listOf(RunRecord(input.runId, input.messages.single().id, "completed")),
            )
        session.refresh()
        assertTrue(session.state.value.busy)
        session.send("Next")
        assertEquals(1, api.inputs.size)
        session.close()
    }

    @Test
    fun `close during persistence never starts an orphan request`() = runTest {
        val persistence = MemoryPersistence()
        val gate = CompletableDeferred<Unit>()
        persistence.beforeWrite = { gate.await() }
        val api = ControlledApi()
        val session =
            ConversationSession(api, persistence, backgroundScope, SavedConversation("thread"))
        val sending = backgroundScope.launch { session.send("Hello") }
        runCurrent()
        session.close()
        gate.complete(Unit)
        runCurrent()
        assertTrue(api.inputs.isEmpty())
        sending.cancel()
    }

    @Test
    fun `separate plan decisions preserve edited values and submit only once complete`() = runTest {
        fun plan(id: String) =
            Interrupt(
                id,
                "human_approval",
                metadata =
                    protocolJson.parseToJsonElement(
                        """{"langgraph":{"raw":{"kind":"experiment_plan_review","title":"Original","steps":["Original step"]}}}"""
                    ),
            )
        val api =
            ControlledApi().apply {
                snapshot = emptySnapshot.copy(interrupts = listOf(plan("first"), plan("second")))
            }
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread"),
            )
        session.restore()
        session.review("first", "approve", PlanDraft("Edited", listOf("Edited step")))
        runCurrent()
        assertTrue(api.inputs.isEmpty())
        assertEquals("approve", session.state.value.planDecisions["first"])
        session.review("second", "reject", PlanDraft("Original", listOf("Original step")))
        runCurrent()
        val responses = api.inputs.single().resume!!
        assertEquals("approve", responses[0].payload!!.jsonObject.string("decision"))
        assertEquals("Edited", responses[0].payload!!.jsonObject.string("title"))
        assertEquals("reject", responses[1].payload!!.jsonObject.string("decision"))
        session.close()
    }

    @Test
    fun `output gaps block decisions until missing predecessors arrive`() = runTest {
        val api =
            ControlledApi().apply {
                snapshot =
                    emptySnapshot.copy(
                        outputs =
                            listOf(
                                WorkflowOutput(
                                    "second",
                                    2,
                                    kotlinx.serialization.json.JsonArray(emptyList()),
                                )
                            )
                    )
            }
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread"),
            )
        session.restore()
        assertTrue(session.state.value.busy)
        assertEquals(1, session.state.value.missingOutputSequence)
        api.snapshot =
            emptySnapshot.copy(
                outputs =
                    listOf(
                        WorkflowOutput(
                            "first",
                            1,
                            kotlinx.serialization.json.JsonArray(emptyList()),
                        ),
                        WorkflowOutput(
                            "second",
                            2,
                            kotlinx.serialization.json.JsonArray(emptyList()),
                        ),
                    )
            )
        session.refresh()
        assertFalse(session.state.value.busy)
        session.close()
    }

    @Test
    fun `draft persistence cannot erase a concurrent pending identity`() = runTest {
        val persistence = MemoryPersistence()
        val gate = CompletableDeferred<Unit>()
        persistence.beforeWrite = { gate.await() }
        val api = ControlledApi()
        val session =
            ConversationSession(api, persistence, backgroundScope, SavedConversation("thread"))
        session.editDraft("Hello")
        val sending = backgroundScope.launch { session.send("Hello") }
        runCurrent()
        val saving = backgroundScope.launch { session.saveDraft() }
        runCurrent()
        gate.complete(Unit)
        runCurrent()
        assertEquals(api.inputs.single(), persistence.saved!!.pending!!.input)
        sending.cancel()
        saving.cancel()
        session.close()
    }

    @Test
    fun `hidden conversation detaches streaming and observes server progress on return`() =
        runTest {
            val api = ControlledApi()
            val session =
                ConversationSession(
                    api,
                    MemoryPersistence(),
                    backgroundScope,
                    SavedConversation("thread"),
                )
            session.send("Hello")
            runCurrent()
            assertEquals(1, api.events.subscriptionCount.value)
            val input = api.inputs.single()
            session.stopObserving()
            runCurrent()
            assertEquals(0, api.events.subscriptionCount.value)
            api.snapshot =
                emptySnapshot.copy(runs = listOf(RunRecord(input.runId, null, "running")))
            session.observe()
            runCurrent()
            assertEquals(1, api.inputs.size)
            assertTrue(session.state.value.busy)
            session.close()
        }

    @Test
    fun `live public reasoning is kept separate from assistant answers`() = runTest {
        val api = ControlledApi()
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread"),
            )
        session.send("Hello")
        runCurrent()
        api.events.emit(ReasoningMessageStartEvent("reason"))
        api.events.emit(ReasoningMessageContentEvent("reason", "Compare constraints."))
        api.events.emit(TextMessageStartEvent("answer"))
        api.events.emit(TextMessageContentEvent("answer", "Done."))
        runCurrent()
        assertTrue(isReasoning(session.state.value.messages.find { it.id == "reason" }!!))
        assertEquals("Done.", session.state.value.messages.find { it.id == "answer" }!!.content)
        session.close()
    }

    @Test
    fun `overlapping snapshot and EOF keep ownership until final reconciliation`() = runTest {
        val api = ControlledApi().apply { closeRunOnFinished = true }
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread"),
            )
        session.send("Hello")
        runCurrent()
        val input = api.inputs.single()
        api.snapshot =
            emptySnapshot.copy(
                messages = input.messages,
                runs = listOf(RunRecord(input.runId, input.messages.single().id, "completed")),
            )
        val first = CompletableDeferred<Unit>()
        val final = CompletableDeferred<Unit>()
        var fetches = 0
        api.beforeSnapshot = {
            if (++fetches == 1) {
                first.await()
            } else {
                final.await()
            }
        }
        val refresh = backgroundScope.launch { session.refresh() }
        runCurrent()
        api.events.emit(RunFinishedEvent("thread", input.runId))
        runCurrent()
        first.complete(Unit)
        runCurrent()
        assertTrue(session.state.value.busy)
        session.send("Dropped before fix")
        assertEquals(1, api.inputs.size)
        final.complete(Unit)
        runCurrent()
        assertFalse(session.state.value.busy)
        session.send("Next")
        runCurrent()
        assertEquals(2, api.inputs.size)
        refresh.cancel()
        session.close()
    }

    @Test
    fun `editing a selected plan invalidates its decision and preserves the new draft`() = runTest {
        fun plan(id: String) =
            Interrupt(
                id,
                "human_approval",
                metadata =
                    protocolJson.parseToJsonElement(
                        """{"langgraph":{"raw":{"kind":"experiment_plan_review","title":"Original","steps":["Original step"]}}}"""
                    ),
            )
        val api =
            ControlledApi().apply {
                snapshot = emptySnapshot.copy(interrupts = listOf(plan("first"), plan("second")))
            }
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread"),
            )
        session.restore()
        session.review("first", "approve")
        session.editPlan("first", PlanDraft("Latest", listOf("New step")))
        assertFalse(session.state.value.planDecisions.containsKey("first"))
        session.review("second", "approve")
        runCurrent()
        assertTrue(api.inputs.isEmpty())
        session.review("first", "approve")
        runCurrent()
        assertEquals(
            "Latest",
            api.inputs.single().resume!!.first().payload!!.jsonObject.string("title"),
        )
        session.close()
    }

    @Test
    fun `final plan batch revalidates decisions that expired while choosing siblings`() = runTest {
        val raw =
            protocolJson.parseToJsonElement(
                """{"langgraph":{"raw":{"kind":"experiment_plan_review","title":"Plan","steps":["Step"]}}}"""
            )
        val first =
            Interrupt("first", "human_approval", expiresAt = "2030-01-01T00:00:01Z", metadata = raw)
        val second = Interrupt("second", "human_approval", metadata = raw)
        val api =
            ControlledApi().apply {
                snapshot = emptySnapshot.copy(interrupts = listOf(first, second))
            }
        var now = java.time.Instant.parse("2030-01-01T00:00:00Z")
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread"),
                now = { now },
            )
        session.restore()
        session.review("first", "approve")
        now = java.time.Instant.parse("2030-01-01T00:00:02Z")
        session.review("second", "approve")
        runCurrent()
        assertTrue(api.inputs.isEmpty())
        assertTrue(session.state.value.planDecisions.isEmpty())
        assertNotNull(session.state.value.error)
        session.close()
    }

    private val emptySnapshot =
        ConversationSnapshot(
            messages = emptyList(),
            interrupts = emptyList(),
            outputs = emptyList(),
            runs = emptyList(),
        )

    private class MemoryPersistence(
        var saved: SavedConversation? = null,
        val failWrite: Boolean = false,
    ) : ConversationPersistence {
        var beforeWrite: suspend () -> Unit = {}

        override suspend fun read() = saved

        override suspend fun write(value: SavedConversation?) {
            beforeWrite()
            if (failWrite) {
                error("Disk full")
            }
            saved = value
        }
    }

    private class ControlledApi : ConversationApi {
        val inputs = mutableListOf<RunAgentInput>()
        val events = MutableSharedFlow<BaseEvent>(extraBufferCapacity = 16)
        var snapshot: ConversationSnapshot? = null
        var beforeSnapshot: suspend () -> Unit = {}
        var closeRunOnFinished = false

        override suspend fun snapshot(threadId: String): ConversationSnapshot? {
            beforeSnapshot()
            return snapshot
        }

        override fun run(input: RunAgentInput): Flow<BaseEvent> = flow {
            inputs += input
            emit(RunStartedEvent(input.threadId, input.runId))
            emitAll(events.takeWhile { !(closeRunOnFinished && it is RunFinishedEvent) })
        }

        override fun changes(threadId: String): Flow<ServerEvent> = emptyFlow()
    }
}

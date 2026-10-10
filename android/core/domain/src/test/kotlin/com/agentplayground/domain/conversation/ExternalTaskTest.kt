package com.agentplayground.domain.conversation

import com.agentplayground.domain.model.AgentOutput
import com.agentplayground.domain.model.ApiException
import com.agentplayground.domain.model.ConversationPersistence
import com.agentplayground.domain.model.ConversationSnapshot
import com.agentplayground.domain.model.ExternalTask
import com.agentplayground.domain.model.ExternalTaskAction
import com.agentplayground.domain.model.SavedConversation
import com.agentplayground.domain.model.protocolJson
import com.agui.core.types.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ExternalTaskTest {
    @Test
    fun `snapshot retains child output identities and legacy tasks remain compatible`() {
        val task =
            protocolJson.decodeFromString<ExternalTask>(
                """{"taskId":"parent","workflowCallId":"call","label":"Agents","revision":2,
                "status":"running","stage":"draft","message":"Drafting","history":[],
                "kind":"a2a","outputs":[{"agent":"Planner","step":"draft","taskId":"child",
                "contextId":"context","status":"running","text":"## Proposal\nLive"}]}"""
            )
        val legacy =
            protocolJson.decodeFromString<ExternalTask>(
                """{"taskId":"report","workflowCallId":"call","label":"Report","revision":1,
                "status":"running","stage":"work","message":"Working","history":[]}"""
            )

        assertEquals("a2a", task.kind)
        assertEquals(
            AgentOutput("Planner", "draft", "child", "context", "running", "## Proposal\nLive"),
            task.outputs.single(),
        )
        assertNull(legacy.kind)
        assertTrue(legacy.outputs.isEmpty())
    }

    @Test
    fun `duplicate control taps admit once without optimistic task completion`() = runTest {
        val api = TaskApi()
        val session = newSession(api, backgroundScope)
        session.restore()

        session.submitExternalTaskInput("task", "  Engineers  ")
        session.submitExternalTaskInput("task", "Duplicate")
        session.cancelExternalTask("task")
        assertEquals(
            ExternalTaskAction.Input,
            session.state.value.externalTaskControls["task"]?.pending,
        )
        runCurrent()

        assertEquals(listOf("task" to "Engineers"), api.inputs)
        assertTrue(api.cancellations.isEmpty())
        assertEquals("input_required", session.state.value.externalTasks.single().status)

        api.gate.complete(Unit)
        runCurrent()

        assertNull(session.state.value.externalTaskControls["task"]?.pending)
        assertEquals("input_required", session.state.value.externalTasks.single().status)
        session.close()
    }

    @Test
    fun `task rejection stays local and can be retried`() = runTest {
        val api = TaskApi().apply { failure = ApiException(502, "Planner unavailable") }
        val session = newSession(api, backgroundScope)
        session.restore()

        session.submitExternalTaskInput("task", "Engineers")
        api.gate.complete(Unit)
        runCurrent()

        assertEquals("Planner unavailable", session.state.value.externalTaskControls["task"]?.error)
        assertNull(session.state.value.error)
        assertNull(session.state.value.externalTaskControls["task"]?.pending)

        api.failure = null
        session.cancelExternalTask("task")
        runCurrent()

        assertEquals(listOf("task"), api.cancellations)
        assertNull(session.state.value.externalTaskControls["task"]?.error)
        assertEquals("input_required", session.state.value.externalTasks.single().status)
        session.close()
    }

    @Test
    fun `unavailable actions do not send requests and active A2A tasks lock the composer`() =
        runTest {
            val api =
                TaskApi().apply {
                    snapshot = snapshot.copy(externalTasks = listOf(task(status = "running")))
                }
            val session = newSession(api, backgroundScope)
            session.restore()

            assertFalse(session.state.value.canSend)
            session.submitExternalTaskInput("task", "Premature")
            session.cancelExternalTask("missing")
            runCurrent()

            assertTrue(api.inputs.isEmpty())
            assertTrue(api.cancellations.isEmpty())

            api.snapshot =
                api.snapshot.copy(externalTasks = listOf(task(status = "succeeded", revision = 2)))
            session.refresh()
            session.cancelExternalTask("task")
            runCurrent()

            assertTrue(api.cancellations.isEmpty())
            assertTrue(session.state.value.canSend)
            session.close()
        }

    @Test
    fun `closing a conversation cancels its in-flight control request`() = runTest {
        val api = TaskApi()
        val session = newSession(api, backgroundScope)
        session.restore()
        session.cancelExternalTask("task")
        runCurrent()

        session.close()
        runCurrent()

        assertTrue(api.requestCancelled)
        session.cancelExternalTask("task")
        runCurrent()
        assertEquals(1, api.cancellations.size)
    }

    @Test
    fun `stale snapshots cannot replace final child text or continuation status`() = runTest {
        val output =
            AgentOutput("Planner", "revise", "child", "context", "succeeded", "Final proposal")
        val final =
            task("succeeded", 3).copy(outputs = listOf(output), continuationStatus = "completed")
        val api = TaskApi().apply { snapshot = snapshot.copy(externalTasks = listOf(final)) }
        val session = newSession(api, backgroundScope)
        session.restore()

        api.snapshot = api.snapshot.copy(externalTasks = listOf(task("running", 2)))
        session.refresh()
        assertEquals(final, session.state.value.externalTasks.single())

        api.snapshot =
            api.snapshot.copy(externalTasks = listOf(final.copy(continuationStatus = null)))
        session.refresh()
        assertEquals(final, session.state.value.externalTasks.single())

        api.snapshot = api.snapshot.copy(externalTasks = emptyList())
        session.refresh()
        assertEquals(final, session.state.value.externalTasks.single())
        session.close()
    }

    @Test
    fun `clarification waits keep polling when the change stream is disconnected`() = runTest {
        val api = TaskApi()
        val session = newSession(api, backgroundScope)
        session.restore()
        session.observe()
        runCurrent()
        val before = api.snapshotReads

        advanceTimeBy(4001)
        runCurrent()

        assertTrue(api.snapshotReads > before)
        session.close()
    }

    @Test
    fun `conversation changes replace accumulated child text and reject stale output`() = runTest {
        val changes = MutableSharedFlow<ServerEvent>()
        val partial = AgentOutput("Planner", "draft", "child", "context", "running", "## Proposal")
        val api =
            TaskApi().apply {
                snapshot =
                    snapshot.copy(
                        externalTasks = listOf(task("running").copy(outputs = listOf(partial)))
                    )
                changeEvents = changes
            }
        val session = newSession(api, backgroundScope)
        session.restore()
        session.observe()
        runCurrent()

        val live = partial.copy(text = "## Proposal\n\nAudience: engineers")
        api.snapshot =
            api.snapshot.copy(
                externalTasks = listOf(task("running", 2).copy(outputs = listOf(live)))
            )
        changes.emit(ServerEvent("changed", "{}"))
        runCurrent()

        assertEquals(listOf(live), session.state.value.externalTasks.single().outputs)

        api.snapshot =
            api.snapshot.copy(
                externalTasks = listOf(task("running").copy(outputs = listOf(partial)))
            )
        changes.emit(ServerEvent("changed", "{}"))
        runCurrent()

        assertEquals(listOf(live), session.state.value.externalTasks.single().outputs)
        session.close()
    }

    private fun newSession(api: TaskApi, scope: CoroutineScope) =
        ConversationSession(
            api,
            object : ConversationPersistence {
                override suspend fun read(): SavedConversation? = null

                override suspend fun write(value: SavedConversation?) {}
            },
            scope,
            SavedConversation("thread"),
        )

    private class TaskApi : ConversationApi {
        var snapshot =
            ConversationSnapshot(
                messages = emptyList(),
                interrupts = emptyList(),
                outputs = emptyList(),
                runs = emptyList(),
                externalTasks = listOf(task()),
            )
        var snapshotReads = 0
        val inputs = mutableListOf<Pair<String, String>>()
        val cancellations = mutableListOf<String>()
        val gate = CompletableDeferred<Unit>()
        var failure: Exception? = null
        var requestCancelled = false
        var changeEvents: Flow<ServerEvent> = emptyFlow()

        override suspend fun snapshot(threadId: String): ConversationSnapshot {
            snapshotReads += 1
            return snapshot
        }

        override suspend fun selectModel(
            threadId: String,
            modelId: String,
        ): com.agentplayground.domain.model.ConversationModel {
            error("Unexpected model change")
        }

        override fun run(input: RunAgentInput): Flow<BaseEvent> = emptyFlow()

        override fun changes(threadId: String): Flow<ServerEvent> = changeEvents

        override suspend fun submitExternalTaskInput(taskId: String, input: String) {
            inputs += taskId to input
            control()
        }

        override suspend fun cancelExternalTask(taskId: String) {
            cancellations += taskId
            control()
        }

        private suspend fun control() {
            try {
                gate.await()
                failure?.let { throw it }
            } catch (cancelled: CancellationException) {
                requestCancelled = true
                throw cancelled
            }
        }
    }

    companion object {
        private fun task(status: String = "input_required", revision: Int = 1) =
            ExternalTask(
                "task",
                "call",
                "Agents",
                revision,
                status,
                "draft",
                "Who is the audience?",
                history = emptyList(),
                kind = "a2a",
            )
    }
}

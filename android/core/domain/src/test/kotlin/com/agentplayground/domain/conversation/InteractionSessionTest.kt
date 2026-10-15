package com.agentplayground.domain.conversation

import com.agentplayground.domain.model.*
import com.agui.core.types.*
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class InteractionSessionTest {
    @Test
    fun `definitively rejected admission releases only after the snapshot confirms its run is absent`() =
        runTest {
            for (status in listOf(400, 404, 409, 413)) {
                val original = interaction("original")
                val replacement = interaction("replacement")
                val api =
                    Api(snapshot(listOf(original))).apply {
                        failure = ApiException(status, "The request is no longer current")
                        beforeRun = { current = snapshot(listOf(replacement)) }
                    }
                val saved = SavedConversation("thread", draft = "Keep this draft", empty = false)
                val journal = Journal(saved)
                val session = ConversationSession(api, journal, backgroundScope, saved)
                session.restore()
                session.editInteraction(original, approved(original))

                session.respondToInteraction(original)
                runCurrent()

                assertNull("HTTP $status", journal.saved!!.pending)
                assertFalse(session.state.value.pendingSubmission)
                assertFalse(session.state.value.busy)
                assertEquals(listOf(replacement), session.state.value.interrupts)
                assertEquals("Keep this draft", session.state.value.draft)
                session.recoverPending()
                runCurrent()
                assertEquals(1, api.inputs.size)

                api.failure = null
                api.beforeRun = {}
                session.editInteraction(replacement, approved(replacement))
                session.respondToInteraction(replacement)
                runCurrent()

                assertEquals(
                    listOf("original", "replacement"),
                    api.inputs.map { it.resume!!.single().interruptId },
                )
                session.close()
            }
        }

    @Test
    fun `network server and accepted run failures preserve the exact pending admission`() =
        runTest {
            val cases =
                listOf(
                    Triple(IOException("Response lost"), false, false),
                    Triple(ApiException(503, "Unavailable"), false, false),
                    Triple(ApiException(409, "Stream failed"), true, false),
                    Triple(ApiException(409, "Conflict"), false, true),
                )

            for ((failure, accepted, savedRun) in cases) {
                val request = interaction("request")
                val api =
                    Api(snapshot(listOf(request))).apply {
                        this.failure = failure
                        startedBeforeFailure = accepted
                        beforeRun = { input ->
                            if (savedRun) {
                                current =
                                    current.copy(
                                        runs = listOf(RunRecord(input.runId, status = "running"))
                                    )
                            }
                        }
                    }
                val saved = SavedConversation("thread", draft = "Preserved", empty = false)
                val journal = Journal(saved)
                val session = ConversationSession(api, journal, backgroundScope, saved)
                session.restore()
                session.editInteraction(request, approved(request))

                session.respondToInteraction(request)
                runCurrent()

                assertEquals(api.inputs.single(), journal.saved!!.pending!!.input)
                assertTrue(session.state.value.pendingSubmission)
                assertTrue(session.state.value.busy)
                assertEquals("Preserved", session.state.value.draft)
                session.close()
            }
        }

    @Test
    fun `one batch submits atomically once while separate pending requests remain independent`() =
        runTest {
            val first = interaction("first")
            val second = interaction("second")
            val api = Api(snapshot(listOf(first, second)))
            val saved = SavedConversation("thread", draft = "Keep my message", empty = false)
            val journal = Journal(saved)
            val session = ConversationSession(api, journal, backgroundScope, saved)
            session.restore()
            val draft = approved(first)

            session.editInteraction(first, draft)
            session.respondToInteraction(first)
            session.respondToInteraction(first)
            runCurrent()

            val input = api.inputs.single()
            assertEquals(listOf("first"), input.resume!!.map { it.interruptId })
            assertTrue(input.messages.isEmpty())
            assertEquals("Keep my message", session.state.value.draft)
            assertEquals("Keep my message", journal.saved!!.draft)
            assertEquals(draft, session.state.value.interactionDrafts[first])

            api.current =
                snapshot(listOf(second))
                    .copy(runs = listOf(RunRecord(input.runId, status = "completed")))
            api.finish.complete(Unit)
            runCurrent()

            assertEquals(listOf(second), session.state.value.interrupts)
            session.editInteraction(second, approved(second))
            session.respondToInteraction(second)
            runCurrent()

            assertEquals(
                listOf("first", "second"),
                api.inputs.map { it.resume!!.single().interruptId },
            )
            assertEquals("Keep my message", session.state.value.draft)
            session.close()
        }

    @Test
    fun `journal failure retains answers choices and the main composer draft for retry`() =
        runTest {
            val request = interaction("first")
            val api = Api(snapshot(listOf(request)))
            val saved = SavedConversation("thread", draft = "Unsent message", empty = false)
            val journal = Journal(saved)
            val session = ConversationSession(api, journal, backgroundScope, saved)
            session.restore()
            val draft = approved(request)
            session.editInteraction(request, draft)
            journal.fail = true

            session.respondToInteraction(request)
            runCurrent()

            assertTrue(api.inputs.isEmpty())
            assertEquals(draft, session.state.value.interactionDrafts[request])
            assertEquals("Unsent message", session.state.value.draft)
            assertEquals(listOf(request), session.state.value.interrupts)
            assertTrue(session.state.value.error!!.contains("Disk full"))

            journal.fail = false
            session.respondToInteraction(request)
            runCurrent()

            assertEquals(1, api.inputs.size)
            assertEquals("Unsent message", journal.saved!!.draft)
            session.close()
        }

    @Test
    fun `reload retries the exact journaled response and retains the unrelated composer draft`() =
        runTest {
            val request = interaction("first")
            val api =
                Api(snapshot(listOf(request))).apply { failure = IOException("Response lost") }
            val saved = SavedConversation("thread", draft = "Unsent message", empty = false)
            val journal = Journal(saved)
            val session = ConversationSession(api, journal, backgroundScope, saved)
            session.restore()
            val draft = approved(request)
            session.editInteraction(request, draft)

            session.respondToInteraction(request)
            runCurrent()
            val original = api.inputs.single()
            assertEquals(draft, session.state.value.interactionDrafts[request])
            assertEquals(original, journal.saved!!.pending!!.input)
            session.close()

            val restoredApi = Api(snapshot(listOf(request)))
            val restored =
                ConversationSession(restoredApi, journal, backgroundScope, journal.saved!!)
            restored.restore()
            runCurrent()

            assertEquals(original, restoredApi.inputs.single())
            assertEquals("Unsent message", restored.state.value.draft)
            val response =
                original.resume!!.single().payload!!.jsonObject.getValue("decisions").jsonArray
            assertEquals(
                "Approved answer",
                Json.parseToJsonElement(
                        response[0].jsonObject.getValue("message").jsonPrimitive.content
                    )
                    .jsonObject
                    .getValue("answers")
                    .jsonArray
                    .single()
                    .jsonObject
                    .getValue("answer")
                    .jsonPrimitive
                    .content,
            )
            restored.close()
        }

    @Test
    fun `stale duplicate and incomplete interaction submissions cannot dispatch`() = runTest {
        val request = interaction("first")
        val changed = request.copy(message = "New checkpoint")
        val api = Api(snapshot(listOf(request)))
        val session =
            ConversationSession(
                api,
                Journal(),
                backgroundScope,
                SavedConversation("thread", empty = false),
            )
        session.restore()

        session.editInteraction(changed, approved(changed))
        session.respondToInteraction(changed)
        session.respondToInteraction(request)
        runCurrent()

        assertTrue(api.inputs.isEmpty())
        assertTrue(session.state.value.interactionDrafts.isEmpty())

        api.current = snapshot(listOf(request, request))
        session.refresh()
        session.editInteraction(request, approved(request))
        session.respondToInteraction(request)
        runCurrent()

        assertTrue(api.inputs.isEmpty())
        session.close()
    }

    private fun approved(interrupt: Interrupt) =
        InteractionDraft(
            listOf(
                InteractionDecisionDraft(
                    InteractionDecisionType.Respond,
                    mapOf("answer" to "Approved answer"),
                ),
                InteractionDecisionDraft(InteractionDecisionType.Approve),
            )
        )

    private fun interaction(id: String) =
        Interrupt(
            id,
            "human_approval",
            metadata =
                Json.parseToJsonElement(
                    """{"langgraph":{"raw":{"action_requests":[{"name":"ask_user","args":{"questions":[{"id":"answer","question":"Clarify the task"}]}},{"name":"forget_memory","args":{"id":"memory"}}],"review_configs":[{"action_name":"ask_user","allowed_decisions":["respond","reject"]},{"action_name":"forget_memory","allowed_decisions":["approve","reject"]}]}}}"""
                ),
        )

    private fun snapshot(interrupts: List<Interrupt>) =
        ConversationSnapshot(
            messages = emptyList(),
            interrupts = interrupts,
            outputs = emptyList(),
            runs = listOf(RunRecord("original", status = "interrupted")),
        )

    private class Journal(var saved: SavedConversation? = null) : ConversationPersistence {
        var fail = false

        override suspend fun read() = saved

        override suspend fun write(value: SavedConversation?) {
            if (fail) {
                error("Disk full")
            }

            saved = value
        }
    }

    private class Api(var current: ConversationSnapshot) : ConversationApi {
        val inputs = mutableListOf<RunAgentInput>()
        val finish = CompletableDeferred<Unit>()
        var failure: Exception? = null
        var startedBeforeFailure = false
        var beforeRun: (RunAgentInput) -> Unit = {}

        override suspend fun snapshot(threadId: String) = current

        override fun run(input: RunAgentInput): Flow<BaseEvent> = flow {
            inputs += input
            beforeRun(input)

            if (startedBeforeFailure) {
                emit(RunStartedEvent(input.threadId, input.runId))
            }

            failure?.let { throw it }
            emit(RunStartedEvent(input.threadId, input.runId))
            finish.await()
            emit(RunFinishedEvent(input.threadId, input.runId))
        }

        override fun changes(threadId: String): Flow<ServerEvent> = emptyFlow()

        override suspend fun selectModel(threadId: String, modelId: String): ConversationModel =
            error("Unexpected model change")

        override suspend fun submitExternalTaskInput(taskId: String, input: String) =
            error("Unexpected external input")

        override suspend fun cancelExternalTask(taskId: String) = error("Unexpected cancellation")
    }
}

package com.agentplayground.core.conversation

import com.agentplayground.core.model.ConversationModel
import com.agentplayground.core.model.ConversationPersistence
import com.agentplayground.core.model.ConversationSnapshot
import com.agentplayground.core.model.ExternalTask
import com.agentplayground.core.model.PendingSubmission
import com.agentplayground.core.model.RunRecord
import com.agentplayground.core.model.SavedConversation
import com.agentplayground.core.model.WorkflowOutput
import com.agentplayground.core.model.isReasoning
import com.agentplayground.core.model.protocolJson
import com.agentplayground.core.model.string
import com.agentplayground.core.network.ConversationApi
import com.agentplayground.core.network.ServerEvent
import com.agentplayground.core.presentation.ToolStatus
import com.agentplayground.core.presentation.conversationTurns
import com.agui.core.types.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SessionTest {
    @Test
    fun `restored workflow replies without timestamp metadata do not acquire reload times`() =
        runTest {
            val api =
                ControlledApi().apply {
                    snapshot =
                        emptySnapshot.copy(
                            outputs =
                                listOf(
                                    protocolJson.decodeFromString<WorkflowOutput>(
                                        """{"id":"old-output","outputSeq":1,"messages":[],"workflow":{"reply":{"id":"old-reply","content":"Archived answer"}}}"""
                                    )
                                )
                        )
                }
            val session =
                ConversationSession(
                    api,
                    MemoryPersistence(),
                    backgroundScope,
                    SavedConversation("thread", empty = false),
                )

            session.restore()

            assertEquals("Archived answer", session.state.value.messages.single().content)
            assertFalse(session.state.value.messageTimestamps.containsKey("old-reply"))
            session.close()
        }

    @Test
    fun `message times survive replay and restore with canonical server timestamps`() = runTest {
        var clock = java.time.Instant.parse("2026-10-11T02:30:00Z")
        val api = ControlledApi()
        val persistence = MemoryPersistence()
        val session =
            ConversationSession(
                api,
                persistence,
                backgroundScope,
                SavedConversation("thread"),
                now = { clock },
            )

        session.send("Hello")
        runCurrent()
        val user = session.state.value.messages.single()
        assertEquals("2026-10-11T02:30:00Z", session.state.value.messageTimestamps[user.id])
        assertEquals("2026-10-11T02:30:00Z", persistence.saved?.pending?.submittedAt)

        clock = java.time.Instant.parse("2026-10-11T02:31:00Z")
        api.events.emit(TextMessageStartEvent("answer", timestamp = clock.toEpochMilli()))
        runCurrent()
        clock = java.time.Instant.parse("2026-10-11T02:32:00Z")
        api.events.emit(TextMessageStartEvent("answer"))
        runCurrent()
        assertEquals("2026-10-11T02:31:00Z", session.state.value.messageTimestamps["answer"])
        session.close()

        val pendingRestore =
            ConversationSession(api, MemoryPersistence(), backgroundScope, persistence.saved!!)
        assertEquals("2026-10-11T02:30:00Z", pendingRestore.state.value.messageTimestamps[user.id])
        pendingRestore.close()

        api.snapshot =
            emptySnapshot.copy(
                messages = listOf(user, AssistantMessage("answer", "Hi")),
                messageTimestamps =
                    mapOf(user.id to "2026-10-11T02:30:02Z", "answer" to "2026-10-11T02:31:03Z"),
            )
        val restored =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread", empty = false),
            )
        restored.restore()
        assertEquals("2026-10-11T02:30:02Z", restored.state.value.messageTimestamps[user.id])
        assertEquals("2026-10-11T02:31:03Z", restored.state.value.messageTimestamps["answer"])
        restored.refresh()
        assertEquals("2026-10-11T02:31:03Z", restored.state.value.messageTimestamps["answer"])
        restored.close()
    }

    @Test
    fun `completed review resume releases model selection despite historical interrupted run`() =
        runTest {
            val api =
                ControlledApi().apply {
                    snapshot =
                        emptySnapshot.copy(
                            modelId = "deepseek",
                            runs =
                                listOf(
                                    RunRecord("old", status = "interrupted", modelId = "deepseek"),
                                    RunRecord("resume", status = "completed", modelId = "deepseek"),
                                ),
                        )
                }
            val session =
                ConversationSession(
                    api,
                    MemoryPersistence(),
                    backgroundScope,
                    SavedConversation("thread", empty = false),
                )
            session.restore()

            session.selectModel("qwen")

            assertEquals(listOf("qwen"), api.modelChanges)
            assertEquals("qwen", session.state.value.modelId)
            assertTrue(session.state.value.canSelectModel)
            session.close()
        }

    @Test
    fun `lost model response reconciles committed selection before releasing admission`() =
        runTest {
            val saved =
                SavedConversation("thread", empty = false, modelId = "deepseek", draft = "Draft")
            val persistence = MemoryPersistence(saved)
            val api = ControlledApi().apply { snapshot = emptySnapshot.copy(modelId = "deepseek") }
            val session = ConversationSession(api, persistence, backgroundScope, saved)
            session.restore()
            val committed = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            api.beforeModelChange = {
                api.snapshot = emptySnapshot.copy(modelId = "qwen")
                committed.complete(Unit)
                release.await()
                throw java.io.IOException("Response lost")
            }
            val changing = launch { session.selectModel("qwen") }
            committed.await()
            session.refresh()
            assertEquals("deepseek", session.state.value.modelId)
            session.send("Too early")
            release.complete(Unit)
            changing.join()

            assertEquals("qwen", session.state.value.modelId)
            assertEquals("qwen", persistence.saved!!.modelId)
            assertEquals("Draft", session.state.value.draft)
            assertTrue(api.inputs.isEmpty())
            assertTrue(session.state.value.canSend)
            assertFalse(session.state.value.modelSelectionPending)
            session.close()
        }

    @Test
    fun `ambiguous model failure stays blocked until later canonical recovery succeeds`() =
        runTest {
            val saved =
                SavedConversation("thread", empty = false, modelId = "deepseek", draft = "Draft")
            val persistence = MemoryPersistence(saved)
            val api = ControlledApi().apply { snapshot = emptySnapshot.copy(modelId = "deepseek") }
            val session = ConversationSession(api, persistence, backgroundScope, saved)
            session.restore()
            api.beforeModelChange = {
                api.snapshot = emptySnapshot.copy(modelId = "qwen")
                api.beforeSnapshot = { error("Recovery temporarily unavailable") }
                throw java.io.IOException("Response lost")
            }

            session.selectModel("qwen")
            session.send("Must wait")
            runCurrent()

            assertFalse(session.state.value.canSend)
            assertFalse(session.state.value.canSelectModel)
            assertTrue(session.state.value.modelSelectionPending)
            assertEquals("deepseek", session.state.value.modelId)
            assertEquals("Draft", session.state.value.draft)
            assertTrue(api.inputs.isEmpty())

            api.beforeSnapshot = {}
            session.recoverPending()

            assertEquals("qwen", session.state.value.modelId)
            assertEquals("qwen", persistence.saved!!.modelId)
            assertTrue(session.state.value.canSend)
            assertFalse(session.state.value.modelSelectionPending)
            session.close()
        }

    @Test
    fun `review without a current interrupted run omits unverified model selection`() = runTest {
        val api =
            ControlledApi().apply {
                snapshot =
                    emptySnapshot.copy(modelId = "qwen", interrupts = listOf(workflowReview()))
            }
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread", empty = false, modelId = "qwen"),
            )
        session.setDefaultModel("qwen")
        session.restore()

        session.review("pause", "accept")
        runCurrent()

        assertFalse(api.inputs.single().forwardedProps.jsonObject.containsKey("modelId"))
        session.close()
    }

    @Test
    fun `closed session cannot publish or journal a late model response`() = runTest {
        val saved = SavedConversation("thread", empty = false, modelId = "deepseek")
        val persistence = MemoryPersistence(saved)
        val api = ControlledApi().apply { snapshot = emptySnapshot.copy(modelId = "deepseek") }
        val session = ConversationSession(api, persistence, backgroundScope, saved)
        session.restore()
        val requested = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        api.beforeModelChange = {
            requested.complete(Unit)
            release.await()
        }
        val changing = launch { session.selectModel("qwen") }
        requested.await()

        session.close()
        release.complete(Unit)
        changing.join()

        assertEquals("deepseek", persistence.saved!!.modelId)
        assertEquals("deepseek", session.state.value.modelId)
    }

    @Test
    fun `review and feedback inherit the interrupted run model after selection and default drift`() =
        runTest {
            for (feedback in listOf(false, true)) {
                val api =
                    ControlledApi().apply {
                        snapshot =
                            emptySnapshot.copy(
                                modelId = "qwen",
                                interrupts = listOf(workflowReview()),
                                runs =
                                    listOf(
                                        RunRecord(
                                            "paused",
                                            status = "interrupted",
                                            modelId = "deepseek",
                                        )
                                    ),
                            )
                    }
                val session =
                    ConversationSession(
                        api,
                        MemoryPersistence(),
                        backgroundScope,
                        SavedConversation("thread", empty = false, modelId = "qwen"),
                    )
                session.setDefaultModel("qwen")
                session.restore()

                if (feedback) {
                    session.send("Clarify this plan")
                } else {
                    session.review("pause", "accept")
                }
                runCurrent()

                assertEquals(
                    "deepseek",
                    api.inputs.single().forwardedProps.jsonObject.string("modelId"),
                )
                assertEquals("pause", api.inputs.single().resume!!.single().interruptId)
                assertEquals("qwen", session.state.value.modelId)
                session.close()
            }
        }

    @Test
    fun `legacy interrupted run omits explicit model instead of adopting the new default`() =
        runTest {
            val api =
                ControlledApi().apply {
                    snapshot =
                        emptySnapshot.copy(
                            modelId = "qwen",
                            interrupts = listOf(workflowReview()),
                            runs = listOf(RunRecord("paused", status = "interrupted")),
                        )
                }
            val session =
                ConversationSession(
                    api,
                    MemoryPersistence(),
                    backgroundScope,
                    SavedConversation("thread", empty = false, modelId = "qwen"),
                )
            session.setDefaultModel("qwen")
            session.restore()

            session.review("pause", "accept")
            runCurrent()

            assertFalse(api.inputs.single().forwardedProps.jsonObject.containsKey("modelId"))
            session.close()
        }

    @Test
    fun `snapshot model journal failure does not discard active recovery observations`() = runTest {
        val api =
            ControlledApi().apply {
                snapshot =
                    emptySnapshot.copy(
                        modelId = "qwen",
                        runs = listOf(RunRecord("remote", status = "running", modelId = "qwen")),
                    )
            }
        val saved = SavedConversation("thread", empty = false, modelId = "deepseek")
        val session =
            ConversationSession(
                api,
                MemoryPersistence(saved, failWrite = true),
                backgroundScope,
                saved,
            )

        session.restore()

        assertEquals("qwen", session.state.value.modelId)
        assertTrue(session.state.value.busy)
        assertFalse(session.state.value.canSelectModel)
        assertEquals("remote", session.state.value.runs.single().runId)
        session.close()
    }

    @Test
    fun `attachment placeholder snapshot cannot replace unsent local selection`() = runTest {
        val saved =
            SavedConversation(
                "thread",
                draft = "Draft",
                modelId = "qwen",
                modelSelectionLocal = true,
            )
        val api = ControlledApi().apply { snapshot = emptySnapshot.copy(modelId = "deepseek") }
        val persistence = MemoryPersistence(saved)
        val session = ConversationSession(api, persistence, backgroundScope, saved)

        session.restore()

        assertEquals("qwen", session.state.value.modelId)
        assertEquals("qwen", persistence.saved!!.modelId)
        session.selectModel("deepseek")
        assertTrue(api.modelChanges.isEmpty())
        assertEquals("deepseek", persistence.saved!!.modelId)
        session.close()
    }

    @Test
    fun `accepted remote selection remains canonical when saving the journal fails`() = runTest {
        val api = ControlledApi().apply { snapshot = emptySnapshot.copy(modelId = "deepseek") }
        val saved = SavedConversation("thread", empty = false, modelId = "deepseek")
        val persistence = MemoryPersistence(saved, failWrite = true)
        val session = ConversationSession(api, persistence, backgroundScope, saved)
        session.restore()

        session.selectModel("qwen")

        assertEquals("qwen", session.state.value.modelId)
        assertNotNull(session.state.value.modelSelectionError)
        assertFalse(session.state.value.modelSelectionPending)
        session.close()
    }

    @Test
    fun `new conversation model choice is journaled with draft before selected admission`() =
        runTest {
            val api = ControlledApi()
            val persistence = MemoryPersistence()
            val session =
                ConversationSession(api, persistence, backgroundScope, SavedConversation("thread"))
            session.restore()
            session.editDraft("Keep my draft")

            session.selectModel("qwen")
            assertEquals("qwen", persistence.saved!!.modelId)
            assertTrue(persistence.saved!!.modelSelectionLocal)
            assertEquals("Keep my draft", persistence.saved!!.draft)
            assertTrue(api.modelChanges.isEmpty())

            session.send("Keep my draft")
            runCurrent()

            assertEquals("qwen", api.inputs.single().forwardedProps.jsonObject.string("modelId"))
            assertEquals(api.inputs.single(), persistence.saved!!.pending!!.input)
            assertFalse(persistence.saved!!.modelSelectionLocal)
            assertFalse(session.state.value.canSelectModel)
            session.close()
        }

    @Test
    fun `restored unsent model choice survives an absent snapshot`() = runTest {
        val saved =
            SavedConversation(
                "thread",
                draft = "Draft",
                modelId = "qwen",
                modelSelectionLocal = true,
            )
        val persistence = MemoryPersistence(saved)
        val session = ConversationSession(ControlledApi(), persistence, backgroundScope, saved)

        session.restore()

        assertEquals("qwen", session.state.value.modelId)
        assertEquals("Draft", session.state.value.draft)
        assertEquals("qwen", persistence.saved!!.modelId)
        session.close()
    }

    @Test
    fun `existing model change uses canonical response without losing the draft`() = runTest {
        val api = ControlledApi().apply { snapshot = emptySnapshot.copy(modelId = "deepseek") }
        val persistence = MemoryPersistence()
        val session =
            ConversationSession(
                api,
                persistence,
                backgroundScope,
                SavedConversation("thread", empty = false),
            )
        session.restore()
        session.editDraft("Draft")

        session.selectModel("qwen")

        assertEquals(listOf("qwen"), api.modelChanges)
        assertEquals("qwen", session.state.value.modelId)
        assertEquals("qwen", persistence.saved!!.modelId)
        assertFalse(persistence.saved!!.modelSelectionLocal)
        assertEquals("Draft", session.state.value.draft)
        assertEquals("Draft", persistence.saved!!.draft)
        session.close()
    }

    @Test
    fun `snapshot started before a model mutation cannot revert the selection`() = runTest {
        val api = ControlledApi().apply { snapshot = emptySnapshot.copy(modelId = "deepseek") }
        val persistence = MemoryPersistence()
        val session =
            ConversationSession(
                api,
                persistence,
                backgroundScope,
                SavedConversation("thread", empty = false),
            )
        session.restore()
        val fetched = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        api.beforeSnapshot = {
            fetched.complete(Unit)
            release.await()
        }
        val refresh = launch { session.refresh() }
        fetched.await()

        session.selectModel("qwen")
        release.complete(Unit)
        refresh.join()

        assertEquals("qwen", session.state.value.modelId)
        assertEquals("qwen", persistence.saved!!.modelId)
        session.close()
    }

    @Test
    fun `restored request retries its original selected model even when snapshot choice differs`() =
        runTest {
            val original =
                newSubmission("thread", "original", UserMessage("message", "Hello"))
                    .copy(forwardedProps = buildJsonObject { put("modelId", "qwen") })
            val saved =
                SavedConversation(
                    "thread",
                    pending = PendingSubmission(original, "message"),
                    empty = false,
                    modelId = "qwen",
                )
            val persistence = MemoryPersistence(saved)
            val api = ControlledApi().apply { snapshot = emptySnapshot.copy(modelId = "deepseek") }
            val session = ConversationSession(api, persistence, backgroundScope, saved)

            session.restore()
            session.selectModel("deepseek")
            runCurrent()

            assertEquals(original, api.inputs.single())
            assertEquals("qwen", session.state.value.modelId)
            assertTrue(api.modelChanges.isEmpty())
            session.close()
        }

    @Test
    fun `model mutations block sends and another selection until persistence finishes`() = runTest {
        val api = ControlledApi()
        val persistence = MemoryPersistence()
        val session =
            ConversationSession(api, persistence, backgroundScope, SavedConversation("thread"))
        session.restore()
        val writing = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        persistence.beforeWrite = {
            writing.complete(Unit)
            release.await()
        }
        val selection = launch { session.selectModel("qwen") }
        writing.await()

        session.send("Too early")
        session.selectModel("deepseek")
        assertFalse(session.state.value.canSelectModel)
        assertFalse(session.state.value.canSend)
        release.complete(Unit)
        selection.join()

        assertTrue(api.inputs.isEmpty())
        assertEquals("qwen", persistence.saved!!.modelId)
        assertTrue(session.state.value.canSelectModel)
        session.close()
    }

    @Test
    fun `loading interrupted active and unknown states block model selection`() = runTest {
        val blocked =
            listOf(
                emptySnapshot.copy(interrupts = listOf(Interrupt("pause", "human_approval"))),
                emptySnapshot.copy(runs = listOf(RunRecord("running", status = "running"))),
                emptySnapshot.copy(
                    runs = listOf(RunRecord("uncertain", status = "submission_unknown"))
                ),
                emptySnapshot.copy(runs = listOf(RunRecord("paused", status = "interrupted"))),
                emptySnapshot.copy(
                    externalTasks =
                        listOf(
                            protocolJson.decodeFromString<ExternalTask>(
                                """{"taskId":"report","workflowCallId":"call","label":"Report","revision":1,"status":"running","stage":"work","message":"Working","history":[]}"""
                            )
                        )
                ),
            )
        for (snapshot in blocked) {
            val api = ControlledApi().apply { this.snapshot = snapshot }
            val session =
                ConversationSession(
                    api,
                    MemoryPersistence(),
                    backgroundScope,
                    SavedConversation("thread", empty = false),
                )
            session.selectModel("qwen")
            session.restore()
            session.selectModel("qwen")

            assertFalse(session.state.value.canSelectModel)
            assertTrue(api.modelChanges.isEmpty())
            session.close()
        }
    }

    @Test
    fun `failed model persistence keeps previous choice and draft`() = runTest {
        val persistence = MemoryPersistence(failWrite = true)
        val session =
            ConversationSession(
                ControlledApi(),
                persistence,
                backgroundScope,
                SavedConversation("thread", modelId = "deepseek"),
            )
        session.restore()
        session.editDraft("Draft")

        session.selectModel("qwen")

        assertEquals("deepseek", session.state.value.modelId)
        assertEquals("Draft", session.state.value.draft)
        assertTrue(session.state.value.canSelectModel)
        assertNotNull(session.state.value.modelSelectionError)
        session.close()
    }

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
    fun `separate plan decisions preserve edits and wait for explicit final confirmation`() =
        runTest {
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
                    snapshot =
                        emptySnapshot.copy(interrupts = listOf(plan("first"), plan("second")))
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

            assertTrue(api.inputs.isEmpty())

            session.submitPlanReviews()
            session.submitPlanReviews()
            runCurrent()

            val responses = api.inputs.single().resume!!

            assertEquals("approve", responses[0].payload!!.jsonObject.string("decision"))
            assertEquals("Edited", responses[0].payload!!.jsonObject.string("title"))
            assertEquals("reject", responses[1].payload!!.jsonObject.string("decision"))

            session.close()
        }

    @Test
    fun `single plan remains immediate alongside an external wait`() = runTest {
        val plan =
            Interrupt(
                "plan",
                "human_approval",
                metadata =
                    protocolJson.parseToJsonElement(
                        """{"langgraph":{"raw":{"kind":"experiment_plan_review","title":"Original","steps":["Step"]}}}"""
                    ),
            )

        val wait =
            Interrupt(
                "wait",
                "human_approval",
                metadata =
                    protocolJson.parseToJsonElement(
                        """{"langgraph":{"raw":{"kind":"workflow_external_wait","workflowCallId":"task"}}}"""
                    ),
            )
        val api =
            ControlledApi().apply { snapshot = emptySnapshot.copy(interrupts = listOf(plan, wait)) }
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread"),
            )

        session.restore()
        session.review("plan", "approve")
        runCurrent()

        assertEquals("plan", api.inputs.single().resume!!.single().interruptId)
        assertTrue(session.state.value.planDecisions.isEmpty())

        session.close()
    }

    @Test
    fun `multiple plans have an explicit submission path alongside another interrupt`() = runTest {
        fun plan(id: String) =
            Interrupt(
                id,
                "human_approval",
                metadata =
                    protocolJson.parseToJsonElement(
                        """{"langgraph":{"raw":{"kind":"experiment_plan_review","title":"Original","steps":["Step"]}}}"""
                    ),
            )
        val wait =
            Interrupt(
                "wait",
                "human_approval",
                metadata =
                    protocolJson.parseToJsonElement(
                        """{"langgraph":{"raw":{"kind":"workflow_external_wait","workflowCallId":"task"}}}"""
                    ),
            )
        val api =
            ControlledApi().apply {
                snapshot =
                    emptySnapshot.copy(interrupts = listOf(plan("first"), wait, plan("second")))
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
        session.review("second", "reject")

        assertTrue(api.inputs.isEmpty())

        session.submitPlanReviews()
        runCurrent()

        assertEquals(listOf("first", "second"), api.inputs.single().resume!!.map { it.interruptId })

        session.close()
    }

    @Test
    fun `a presented single plan submits without requiring a replaced legacy sibling`() = runTest {
        fun plan(id: String) =
            Interrupt(
                id,
                "human_approval",
                metadata =
                    protocolJson.parseToJsonElement(
                        """{"langgraph":{"raw":{"kind":"experiment_plan_review","title":"Plan","steps":["Step"]}}}"""
                    ),
            )

        val api =
            ControlledApi().apply {
                snapshot =
                    emptySnapshot.copy(interrupts = listOf(plan("replaced"), plan("pending")))
            }
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread"),
            )

        session.restore()
        session.review("replaced", "approve", planInterruptIds = setOf("pending"))

        assertTrue(api.inputs.isEmpty())

        session.review("pending", "approve", planInterruptIds = setOf("pending"))
        runCurrent()

        assertEquals("pending", api.inputs.single().resume!!.single().interruptId)

        session.close()
    }

    @Test
    fun `terminal tool failure remains terminal while missing output locks recovery`() = runTest {
        val api =
            ControlledApi().apply {
                snapshot =
                    emptySnapshot.copy(
                        messages =
                            listOf(
                                UserMessage("user", "Execute"),
                                AssistantMessage(
                                    "answer",
                                    toolCalls =
                                        listOf(ToolCall("call", FunctionCall("tool", "{}"))),
                                ),
                            ),
                        runs = listOf(RunRecord("run", "user", "failed")),
                        outputs =
                            listOf(
                                WorkflowOutput(
                                    "second",
                                    2,
                                    kotlinx.serialization.json.JsonArray(emptyList()),
                                )
                            ),
                    )
            }
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread", empty = false),
            )

        session.restore()
        val state = session.state.value

        assertTrue(state.busy)
        assertEquals(1, state.missingOutputSequence)
        assertNull(state.executionStatus)
        assertEquals(
            ToolStatus.Failed,
            conversationTurns(state.messages, state.runs, latestStatus = state.executionStatus)
                .single()
                .toolCalls
                .single()
                .status,
        )

        session.close()
    }

    @Test
    fun `official run error ends live execution before canonical settlement`() = runTest {
        val api = ControlledApi()
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread"),
            )

        session.restore()
        session.send("Execute")
        runCurrent()

        assertEquals("running", session.state.value.executionStatus)

        api.events.emit(RunErrorEvent("Agent failed"))
        runCurrent()

        assertEquals("failed", session.state.value.executionStatus)
        assertTrue(session.state.value.busy)
        assertFalse(session.state.value.streaming)

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

        assertTrue(api.inputs.isEmpty())

        session.submitPlanReviews()
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
        session.submitPlanReviews()
        runCurrent()

        assertTrue(api.inputs.isEmpty())
        assertTrue(session.state.value.planDecisions.isEmpty())
        assertNotNull(session.state.value.error)

        session.close()
    }

    @Test
    fun `single plan review submits immediately with normalized approval`() = runTest {
        val plan = planInterrupt("single")
        val api = ControlledApi().apply { snapshot = emptySnapshot.copy(interrupts = listOf(plan)) }
        val session =
            ConversationSession(
                api,
                MemoryPersistence(),
                backgroundScope,
                SavedConversation("thread"),
            )

        session.restore()
        session.review(
            "single",
            "approve",
            PlanDraft("  Edited  ", listOf("  First  ", "", "  ", "Second ")),
        )
        runCurrent()

        val payload = api.inputs.single().resume!!.single().payload!!.jsonObject

        assertEquals("Edited", payload.string("title"))
        assertEquals(protocolJson.parseToJsonElement("[\"First\",\"Second\"]"), payload["steps"])

        session.close()
    }

    @Test
    fun `changed interrupt batch invalidates selected decisions before continuing`() = runTest {
        val first = planInterrupt("first")
        val second = planInterrupt("second")
        val api =
            ControlledApi().apply {
                snapshot = emptySnapshot.copy(interrupts = listOf(first, second))
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
        session.review("second", "reject")

        api.snapshot =
            emptySnapshot.copy(
                interrupts = listOf(first, second.copy(expiresAt = "2031-01-01T00:00:00Z"))
            )
        session.refresh()
        session.submitPlanReviews()
        runCurrent()

        assertTrue(api.inputs.isEmpty())
        assertTrue(session.state.value.planDecisions.isEmpty())

        session.close()
    }

    @Test
    fun `review edits and repeated continuation cannot change pending admission`() = runTest {
        val api =
            ControlledApi().apply {
                snapshot =
                    emptySnapshot.copy(
                        interrupts = listOf(planInterrupt("first"), planInterrupt("second"))
                    )
            }
        val persistence = MemoryPersistence()
        val session =
            ConversationSession(api, persistence, backgroundScope, SavedConversation("thread"))

        session.restore()
        session.review("first", "approve")
        session.review("second", "reject")

        val gate = CompletableDeferred<Unit>()
        persistence.beforeWrite = { gate.await() }
        val submitting = backgroundScope.launch { session.submitPlanReviews() }
        runCurrent()
        session.editPlan("first", PlanDraft("Ignored", listOf("Ignored")))
        session.submitPlanReviews()

        assertEquals("Plan", session.state.value.planDrafts["first"]?.title)

        gate.complete(Unit)
        runCurrent()

        assertEquals(1, api.inputs.size)
        assertEquals(
            "Plan",
            api.inputs.single().resume!!.first().payload!!.jsonObject.string("title"),
        )

        submitting.cancel()
        session.close()
    }

    @Test
    fun `activity retains complete events bounds rows counts received and clears locally`() =
        runTest {
            val api = ControlledApi()
            val instant = java.time.Instant.parse("2030-01-01T00:00:00Z")
            val session =
                ConversationSession(
                    api,
                    MemoryPersistence(),
                    backgroundScope,
                    SavedConversation("thread"),
                    now = { instant },
                )

            session.send("Hello")
            runCurrent()

            val run = api.inputs.single().runId
            val started = session.state.value.activity.single()

            assertTrue(started.event is RunStartedEvent)
            assertEquals(run, started.runId)
            assertEquals(instant.toEpochMilli(), started.receivedAt)

            repeat(301) {
                api.events.emit(TextMessageContentEvent("reply", "Delta $it"))
                runCurrent()
            }

            assertEquals(302L, session.state.value.receivedEventCount)
            assertEquals(300, session.state.value.activity.size)

            val previous = session.state.value.activity.last().sequence
            session.clearActivity()

            assertTrue(session.state.value.activity.isEmpty())
            assertEquals(0L, session.state.value.receivedEventCount)

            val event = TextMessageContentEvent("reply", "x".repeat(5_000))
            api.events.emit(event)
            runCurrent()

            val retained = session.state.value.activity.single()

            assertEquals(event, retained.event)
            assertEquals(run, retained.runId)
            assertEquals(previous + 1, retained.sequence)
            assertEquals(1L, session.state.value.receivedEventCount)
            assertTrue(session.state.value.busy)

            session.close()
        }

    private fun planInterrupt(id: String) =
        Interrupt(
            id,
            "human_approval",
            metadata =
                protocolJson.parseToJsonElement(
                    """{"langgraph":{"raw":{"kind":"experiment_plan_review","title":"Plan","steps":["Step"]}}}"""
                ),
        )

    private fun workflowReview() =
        Interrupt(
            "pause",
            "human_approval",
            metadata =
                protocolJson.parseToJsonElement(
                    """{"langgraph":{"raw":{"kind":"workflow_review","workflowCallId":"workflow","revision":1,"round":1,"outputStepId":"review","canAccept":true}}}"""
                ),
        )

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
        val modelChanges = mutableListOf<String>()
        var beforeModelChange: suspend () -> Unit = {}

        override suspend fun selectModel(threadId: String, modelId: String): ConversationModel {
            modelChanges += modelId
            beforeModelChange()

            return ConversationModel(threadId, modelId)
        }

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

        override suspend fun submitExternalTaskInput(taskId: String, input: String) {
            error("Unexpected external input")
        }

        override suspend fun cancelExternalTask(taskId: String) {
            error("Unexpected external cancellation")
        }
    }
}

package com.agentplayground.feature.conversation

import android.os.Looper
import androidx.core.net.toUri
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.agentplayground.data.RepositoryFactory
import com.agentplayground.domain.conversation.ConversationApi
import com.agentplayground.domain.conversation.ConversationSession
import com.agentplayground.domain.conversation.ServerEvent
import com.agentplayground.domain.files.PickedFile
import com.agentplayground.domain.model.AgentInfo
import com.agentplayground.domain.model.ConversationPage
import com.agentplayground.domain.model.ConversationPersistence
import com.agentplayground.domain.model.ConversationSnapshot
import com.agentplayground.domain.model.SavedConversation
import com.agentplayground.domain.repository.ConversationRepository
import com.agui.core.types.BaseEvent
import com.agui.core.types.RunAgentInput
import com.agui.core.types.UserMessage
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

private const val INITIAL_THREAD = "initial"
private const val TARGET_THREAD = "target"
private const val DISK_FAILURE = "Could not select conversation"

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ConversationSelectionTest {
    @Test
    fun `failed selection leaves the current conversation able to send`() =
        withConversation { model, repository ->
            repository.failSelection = true

            model.select(TARGET_THREAD)
            idleMain()

            assertEquals(DISK_FAILURE, model.state.value.error)
            assertEquals(INITIAL_THREAD, model.state.value.session?.threadId)

            model.editDraft("Keep chatting")
            model.send()
            idleMain()

            val submission = repository.inputs.single()
            assertEquals(INITIAL_THREAD, submission.threadId)
            assertEquals("Keep chatting", (submission.messages.single() as UserMessage).content)
        }

    @Test
    fun `a picker result and delayed inspection stay with their original conversation`() =
        withConversation { model, repository ->
            val uri = "content://documents/report.txt".toUri()
            model.attach(INITIAL_THREAD, listOf(uri))
            idleMain()

            model.select(TARGET_THREAD)
            idleMain()
            repository.inspection.complete(listOf(PickedFile(uri.toString(), "report.txt", 10)))
            idleMain()

            assertEquals(TARGET_THREAD, model.state.value.session?.threadId)
            assertTrue(model.state.value.attachments.isEmpty())

            model.attach(INITIAL_THREAD, listOf(uri))
            idleMain()

            assertTrue(model.state.value.attachments.isEmpty())

            model.attach(TARGET_THREAD, listOf(uri))
            idleMain()

            assertEquals("report.txt", model.state.value.attachments.single().name)
        }

    private fun withConversation(block: (ConversationViewModel, Repository) -> Unit) {
        val store = ViewModelStore()
        val fallback =
            RepositoryFactory(RuntimeEnvironment.getApplication())
                .conversation("https://fixture.example/")
        val repository = Repository(fallback)
        val model =
            ViewModelProvider(
                store,
                viewModelFactory { initializer { ConversationViewModel(repository) } },
            )[ConversationViewModel::class.java]

        try {
            model.setVisible(true)
            idleMain()
            block(model, repository)
        } finally {
            store.clear()
        }
    }

    private fun idleMain() = Shadows.shadowOf(Looper.getMainLooper()).idle()

    private class Repository(fallback: ConversationRepository) :
        ConversationRepository by fallback {
        val inputs = mutableListOf<RunAgentInput>()
        val inspection = CompletableDeferred<List<PickedFile>>()
        var failSelection = false

        override suspend fun selectedConversation() = SavedConversation(INITIAL_THREAD)

        override suspend fun savedConversation(threadId: String) = SavedConversation(threadId)

        override suspend fun select(saved: SavedConversation) {
            if (failSelection) {
                error(DISK_FAILURE)
            }
        }

        override fun createSession(scope: CoroutineScope, saved: SavedConversation) =
            ConversationSession(
                api = sessionApi(),
                persistence =
                    object : ConversationPersistence {
                        override suspend fun read() = saved

                        override suspend fun write(value: SavedConversation?) = Unit
                    },
                scope = scope,
                saved = saved,
            )

        override suspend fun conversations(cursor: String?) = ConversationPage(emptyList())

        override suspend fun agentInfo() = AgentInfo("fixture")

        override suspend fun inspectAttachments(uris: List<String>) = inspection.await()

        private fun sessionApi() =
            object : ConversationApi {
                override suspend fun snapshot(threadId: String): ConversationSnapshot? = null

                override fun run(input: RunAgentInput): Flow<BaseEvent> = flow { inputs.add(input) }

                override fun changes(threadId: String): Flow<ServerEvent> = emptyFlow()

                override suspend fun selectModel(threadId: String, modelId: String) =
                    error("Unexpected model selection")

                override suspend fun submitExternalTaskInput(taskId: String, input: String) =
                    error("Unexpected task input")

                override suspend fun cancelExternalTask(taskId: String) =
                    error("Unexpected task cancellation")
            }
    }
}

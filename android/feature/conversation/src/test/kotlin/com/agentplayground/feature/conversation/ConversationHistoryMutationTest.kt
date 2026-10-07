package com.agentplayground.feature.conversation

import android.os.Looper
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.agentplayground.core.model.ConversationSnapshot
import com.agentplayground.core.model.SavedConversation
import com.agentplayground.core.model.protocolJson
import com.agentplayground.core.network.PlaygroundApi
import com.agentplayground.data.PreferencesRepository
import com.agentplayground.data.conversation.ConversationRepository
import com.agentplayground.data.files.DocumentAccess
import com.agui.core.types.UserMessage
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ConversationHistoryMutationTest {
    @Test
    fun `repeated history actions send one request while preserving failed dialogs`() {
        MockWebServer().use { server ->
            val renames = AtomicInteger()
            val deletes = AtomicInteger()

            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse =
                        when {
                            request.method == "PATCH" -> {
                                renames.incrementAndGet()

                                MockResponse()
                                    .setResponseCode(503)
                                    .setBody("{\"error\":\"Try again later\"}")
                                    .setBodyDelay(100, TimeUnit.MILLISECONDS)
                            }
                            request.method == "DELETE" -> {
                                deletes.incrementAndGet()

                                MockResponse()
                                    .setResponseCode(503)
                                    .setBody("{\"error\":\"Try again later\"}")
                                    .setBodyDelay(100, TimeUnit.MILLISECONDS)
                            }
                            request.path == "/agent-info" ->
                                MockResponse().setBody("{\"model\":\"fixture\"}")
                            request.path == "/conversations" ->
                                MockResponse().setBody("{\"conversations\":[]}")
                            request.path == "/conversations/thread" ->
                                MockResponse()
                                    .setBody(
                                        protocolJson.encodeToString(
                                            ConversationSnapshot.serializer(),
                                            ConversationSnapshot(
                                                "History",
                                                listOf(UserMessage("user", "Hello")),
                                                emptyList(),
                                                emptyList(),
                                                emptyList(),
                                            ),
                                        )
                                    )
                            else -> MockResponse().setResponseCode(404)
                        }
                }
            server.start()

            val context = RuntimeEnvironment.getApplication()
            val journal = PreferencesRepository(context).conversations(server.url("/").toString())

            runBlocking {
                journal.write(SavedConversation("thread", empty = false))
                journal.select("thread")
            }

            val store = ViewModelStore()
            val vm =
                ViewModelProvider(
                    store,
                    object : ViewModelProvider.Factory {
                        @Suppress("UNCHECKED_CAST")
                        override fun <T : androidx.lifecycle.ViewModel> create(
                            modelClass: Class<T>
                        ): T =
                            ConversationViewModel(
                                ConversationRepository(
                                    PlaygroundApi(server.url("/").toString()),
                                    journal,
                                    DocumentAccess(context.contentResolver),
                                )
                            )
                                as T
                    },
                )[ConversationViewModel::class.java]

            try {
                await { vm.state.value.session?.loading == false }

                var completed = false

                vm.rename("thread", "New title") { completed = true }
                vm.rename("thread", "Other title") { completed = true }
                assertNotNull(vm.state.value.historyMutation)
                await { vm.state.value.historyMutation == null }

                assertEquals(1, renames.get())
                assertFalse(completed)
                assertEquals("Try again later", vm.state.value.error)

                vm.delete("thread") { completed = true }
                vm.delete("thread") { completed = true }
                await { vm.state.value.historyMutation == null }

                assertEquals(1, deletes.get())
                assertFalse(completed)
                assertNotNull(runBlocking { journal.find("thread") })
            } finally {
                store.clear()
            }
        }
    }

    private fun await(condition: () -> Boolean) {
        val deadline = System.nanoTime() + 10_000_000_000L

        while (!condition() && System.nanoTime() < deadline) {
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }

        assertTrue("Operation did not finish", condition())
    }
}

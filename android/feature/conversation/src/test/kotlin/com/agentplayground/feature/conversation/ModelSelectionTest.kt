package com.agentplayground.feature.conversation

import android.os.Looper
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.agentplayground.data.RepositoryFactory
import com.agentplayground.domain.model.SavedConversation
import com.agentplayground.domain.repository.ConversationJournal
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ModelSelectionTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `server model choice survives metadata refresh and restores from the journal`() {
        withConversation { server, vm, journal, metadataRequests, modelRequests ->
            waitReady(vm)
            vm.editInput("Preserved draft")
            vm.selectModel("qwen")
            vm.selectModel("qwen")
            compose.waitUntil(10_000) {
                idle()
                vm.state.value.session?.modelId == "qwen" &&
                    vm.state.value.session?.modelSelectionPending == false
            }
            val before = metadataRequests.get()
            vm.setVisible(true)
            compose.waitUntil(10_000) {
                idle()
                metadataRequests.get() > before && vm.state.value.session?.modelId == "qwen"
            }

            assertEquals(1, modelRequests.get())
            assertEquals("Qwen", vm.state.value.modelLabel)
            assertEquals("Preserved draft", vm.state.value.session!!.draft)
            val saved = runBlocking { journal.find("thread") }!!
            assertEquals("qwen", saved.modelId)
            assertEquals("Preserved draft", saved.draft)

            vm.select(null)
            compose.waitUntil(10_000) {
                idle()
                vm.state.value.session?.threadId != "thread"
            }
            vm.select("thread")
            compose.waitUntil(10_000) {
                idle()
                vm.state.value.session?.threadId == "thread" &&
                    vm.state.value.session?.loading == false
            }
            assertEquals("qwen", vm.state.value.session!!.modelId)
            assertEquals("Preserved draft", vm.state.value.session!!.draft)
            assertTrue(server.requestCount > 0)
        }
    }

    @Test
    fun `server rejection keeps model and draft and releases the selector`() {
        withConversation(reject = true) { _, vm, _, _, modelRequests ->
            waitReady(vm)
            vm.editInput("Draft after rejection")
            vm.selectModel("qwen")
            compose.waitUntil(10_000) {
                idle()
                vm.state.value.session?.modelSelectionError != null &&
                    vm.state.value.session?.modelSelectionPending == false
            }

            assertEquals(1, modelRequests.get())
            assertEquals("deepseek", vm.state.value.session!!.modelId)
            assertEquals("Draft after rejection", vm.state.value.session!!.draft)
            assertEquals(
                "Complete the current run before changing models.",
                vm.state.value.session!!.modelSelectionError,
            )
            assertTrue(vm.state.value.canSelectModel)
        }
    }

    private fun waitReady(vm: ConversationViewModel) {
        compose.waitUntil(10_000) {
            idle()
            vm.state.value.session?.loading == false && vm.state.value.agentInfo?.models?.size == 2
        }
    }

    private fun idle() = Shadows.shadowOf(Looper.getMainLooper()).idle()

    private fun withConversation(
        reject: Boolean = false,
        block:
            (
                MockWebServer,
                ConversationViewModel,
                ConversationJournal,
                AtomicInteger,
                AtomicInteger,
            ) -> Unit,
    ) {
        MockWebServer().use { server ->
            val model = AtomicReference("deepseek")
            val metadataRequests = AtomicInteger()
            val modelRequests = AtomicInteger()
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse =
                        when {
                            request.path == "/agent-info" -> {
                                metadataRequests.incrementAndGet()
                                MockResponse()
                                    .setBody(
                                        """{"model":"deepseek-flash","defaultModelId":"deepseek","models":[{"id":"deepseek","label":"DeepSeek","model":"deepseek-flash","available":true},{"id":"qwen","label":"Qwen","model":"qwen3.8-flash","available":true}]}"""
                                    )
                            }
                            request.path == "/conversations/thread/model" -> {
                                modelRequests.incrementAndGet()
                                if (reject) {
                                    MockResponse()
                                        .setResponseCode(409)
                                        .setBody(
                                            """{"error":"Complete the current run before changing models."}"""
                                        )
                                } else {
                                    assertEquals("PATCH", request.method)
                                    assertEquals("""{"modelId":"qwen"}""", request.body.readUtf8())
                                    model.set("qwen")
                                    MockResponse()
                                        .setBody("""{"threadId":"thread","modelId":"qwen"}""")
                                }
                            }
                            request.path == "/conversations/thread" ->
                                MockResponse()
                                    .setBody(
                                        """{"messages":[],"interrupts":[],"outputs":[],"runs":[],"modelId":"${model.get()}"}"""
                                    )
                            request.path == "/conversations" ->
                                MockResponse().setBody("""{"conversations":[]}""")
                            else -> MockResponse().setResponseCode(404)
                        }
                }
            server.start()
            val context = RuntimeEnvironment.getApplication()
            val journal =
                RepositoryFactory(context).preferences.conversations(server.url("/").toString())
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
                                RepositoryFactory(context).conversation(server.url("/").toString())
                            )
                                as T
                    },
                )[ConversationViewModel::class.java]

            try {
                block(server, vm, journal, metadataRequests, modelRequests)
            } finally {
                vm.setVisible(false)
                store.clear()
            }
        }
    }
}

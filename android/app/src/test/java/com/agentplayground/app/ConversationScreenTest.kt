package com.agentplayground.app

import android.os.Looper
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.agentplayground.app.data.AppPreferences
import com.agentplayground.app.data.PreferenceStore
import com.agentplayground.app.design.PlaygroundTheme
import com.agentplayground.app.features.conversation.ConversationScreen
import com.agentplayground.app.features.conversation.ConversationViewModel
import com.agentplayground.app.files.DocumentAccess
import com.agentplayground.core.*
import com.agui.core.types.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w412dp-h892dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ConversationScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `native conversation restores history and sends through real HTTP SSE`() {
        MockWebServer().use { server ->
            var messages: List<Message> =
                listOf(
                    UserMessage("initial-user", "Review our next experiment."),
                    AssistantMessage(
                        "initial-answer",
                        "The client is connected. What should we validate?",
                    ),
                )
            var runs = emptyList<RunRecord>()
            var submitted: RunAgentInput? = null
            var deleted = false

            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse =
                        when {
                            request.method == "DELETE" &&
                                request.path == "/conversations/fixture" -> {
                                deleted = true

                                MockResponse().setResponseCode(204)
                            }
                            request.path == "/conversations/fixture" && deleted ->
                                MockResponse().setResponseCode(404)
                            request.path == "/conversations" && deleted ->
                                MockResponse().setBody("{\"conversations\":[]}")
                            request.path == "/agent-info" ->
                                MockResponse().setBody("{\"model\":\"deepseek-flash\"}")
                            request.path == "/conversations" ->
                                MockResponse()
                                    .setBody(
                                        """{"conversations":[{"threadId":"fixture","title":"Android integration","createdAt":"now","updatedAt":"now"}]}"""
                                    )
                            request.path == "/conversations/fixture" ->
                                MockResponse()
                                    .setBody(
                                        protocolJson.encodeToString(
                                            ConversationSnapshot.serializer(),
                                            ConversationSnapshot(
                                                "Android integration",
                                                messages,
                                                emptyList(),
                                                emptyList(),
                                                runs,
                                            ),
                                        )
                                    )
                            request.path == "/agent" -> {
                                val input =
                                    protocolJson.decodeFromString<RunAgentInput>(
                                        request.body.readUtf8()
                                    )

                                submitted = input
                                messages =
                                    messages +
                                        input.messages +
                                        AssistantMessage("new-reply", "Validation completed.")
                                runs =
                                    listOf(
                                        RunRecord(
                                            input.runId,
                                            input.messages.single().id,
                                            "completed",
                                        )
                                    )

                                val events =
                                    listOf(
                                        RunStartedEvent(input.threadId, input.runId),
                                        TextMessageStartEvent("new-reply"),
                                        TextMessageContentEvent(
                                            "new-reply",
                                            "Validation completed.",
                                        ),
                                        RunFinishedEvent(input.threadId, input.runId),
                                    )

                                MockResponse()
                                    .setHeader("Content-Type", "text/event-stream")
                                    .setBody(
                                        events.joinToString("") {
                                            "data: ${protocolJson.encodeToString(BaseEvent.serializer(), it)}\n\n"
                                        }
                                    )
                            }
                            else -> MockResponse().setResponseCode(404)
                        }
                }
            server.start()

            val context = RuntimeEnvironment.getApplication()
            val journal = PreferenceStore(context).conversations(server.url("/").toString())

            runBlocking {
                journal.write(SavedConversation("fixture", empty = false))
                journal.select("fixture")
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
                                PlaygroundApi(server.url("/").toString()),
                                journal,
                                DocumentAccess(context.contentResolver),
                            )
                                as T
                    },
                )[ConversationViewModel::class.java]

            try {
                compose.setContent {
                    PlaygroundTheme("light") { ConversationScreen(vm, AppPreferences()) }
                }
                compose.waitUntil(10_000) {
                    Shadows.shadowOf(Looper.getMainLooper()).idle()
                    vm.state.value.session?.loading == false
                }

                compose
                    .onNodeWithTag("conversation-title")
                    .assertTextEquals("Android integration")
                    .assertIsDisplayed()
                compose.onNodeWithText("Review our next experiment.").assertIsDisplayed()

                compose
                    .onNodeWithContentDescription("Message")
                    .performTextInput("Check recovery and ordering.")
                // This standalone screen fixture has no Activity lifecycle effect.
                vm.setVisible(true)
                compose.onNodeWithContentDescription("Send message").performClick()
                compose.waitUntil(10_000) {
                    Shadows.shadowOf(Looper.getMainLooper()).idle()
                    vm.state.value.session?.messages?.any {
                        it.id == "new-reply" && it.content == "Validation completed."
                    } == true && vm.state.value.session?.busy == false
                }

                assertEquals(1, submitted!!.messages.size)
                assertEquals("Check recovery and ordering.", submitted!!.messages.single().content)
                assertNull(submitted!!.resume)
                compose.onNodeWithText("Check recovery and ordering.").assertIsDisplayed()

                var deletionCompleted = false

                vm.delete("fixture") { deletionCompleted = true }
                compose.waitUntil(10_000) {
                    Shadows.shadowOf(Looper.getMainLooper()).idle()
                    deletionCompleted && vm.state.value.session?.threadId != "fixture"
                }

                assertNull(runBlocking { journal.find("fixture") })
            } finally {
                vm.setVisible(false)
                store.clear()
            }
        }
    }
}

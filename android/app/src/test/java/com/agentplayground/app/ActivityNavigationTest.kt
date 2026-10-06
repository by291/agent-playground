package com.agentplayground.app

import android.os.Looper
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.agentplayground.app.data.AppPreferences
import com.agentplayground.app.design.PlaygroundTheme
import com.agentplayground.core.*
import com.agui.core.types.*
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = PlaygroundApplication::class, qualifiers = "w360dp-h740dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ActivityNavigationTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `event page observes the running reply and back preserves reading position and draft`() {
        MockWebServer().use { server ->
            var messages: List<Message> =
                (0..19).flatMap { index ->
                    listOf(
                        UserMessage("user-$index", "Question $index"),
                        AssistantMessage("answer-$index", "Answer $index.\n\nAnother paragraph."),
                    )
                }
            var runs = emptyList<RunRecord>()

            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse =
                        when (request.path) {
                            "/agent-info" -> MockResponse().setBody("{\"model\":\"fixture\"}")
                            "/conversations" -> MockResponse().setBody("{\"conversations\":[]}")
                            "/conversations/fixture" ->
                                MockResponse()
                                    .setBody(
                                        protocolJson.encodeToString(
                                            ConversationSnapshot.serializer(),
                                            ConversationSnapshot(
                                                "Fixture",
                                                messages,
                                                emptyList(),
                                                emptyList(),
                                                runs,
                                            ),
                                        )
                                    )
                            "/agent" -> {
                                val input =
                                    protocolJson.decodeFromString(
                                        RunAgentInput.serializer(),
                                        request.body.readUtf8(),
                                    )

                                messages =
                                    messages +
                                        input.messages +
                                        AssistantMessage("live", "Live reply completed.")
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
                                        TextMessageStartEvent("live"),
                                        TextMessageContentEvent("live", "Live reply completed."),
                                        RunFinishedEvent(input.threadId, input.runId),
                                    )

                                MockResponse()
                                    .setHeader("Content-Type", "text/event-stream")
                                    .setBodyDelay(2, TimeUnit.SECONDS)
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

            val application = RuntimeEnvironment.getApplication() as PlaygroundApplication
            val preferences =
                AppPreferences(serverUrl = server.url("/").toString(), replyAnimation = false)
            val journal = application.preferences.conversations(preferences.serverUrl)

            runBlocking {
                journal.write(SavedConversation("fixture", empty = false))
                journal.select("fixture")
            }

            compose.setContent {
                PlaygroundTheme("light") { PlaygroundApp(application, preferences) }
            }

            await {
                compose
                    .onAllNodesWithTag("conversation-timeline")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
            await { compose.onAllNodesWithText("Question 19").fetchSemanticsNodes().isNotEmpty() }

            compose.onNodeWithContentDescription("Message").performTextInput("Observe this run")
            compose.onNodeWithContentDescription("Send message").performClick()
            compose.onNodeWithTag("conversation-timeline").performScrollToIndex(12)
            compose.onNodeWithContentDescription("Conversation options").performClick()
            compose.onNodeWithText("Agent activity").performClick()

            compose.onNodeWithText("Run activity").assertIsDisplayed()
            compose.onNodeWithText("Chat").assertDoesNotExist()

            await {
                compose
                    .onAllNodesWithText("4 received · 4 retained")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
            compose.onNodeWithContentDescription("Back to chat").performClick()

            compose.onNodeWithContentDescription("Jump to latest message").assertIsDisplayed()
            compose.onNodeWithText("Observe this run").assertDoesNotExist()

            compose.onNodeWithContentDescription("Message").performTextInput("Preserved draft")
            compose.onNodeWithContentDescription("Conversation options").performClick()
            compose.onNodeWithText("Agent activity").performClick()
            compose.onNodeWithText("Clear log").performClick()
            compose.onNodeWithText("0 received · 0 retained").assertIsDisplayed()

            compose.onNodeWithContentDescription("Back to chat").performClick()
            compose.onNodeWithContentDescription("Message").assertTextContains("Preserved draft")

            compose.onNodeWithContentDescription("Jump to latest message").performClick()
            compose.onNodeWithText("Observe this run").assertIsDisplayed()
        }
    }

    private fun await(condition: () -> Boolean) {
        compose.waitUntil(10_000) {
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            condition()
        }

        compose.waitForIdle()
    }
}

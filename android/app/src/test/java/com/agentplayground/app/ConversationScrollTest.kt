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
@Config(sdk = [35], qualifiers = "w360dp-h740dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ConversationScrollTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `opening and switching a long conversation shows its latest turn`() {
        fixture { vm ->
            compose.onNodeWithText("Latest A").assertIsDisplayed()
            compose.onNodeWithTag("conversation-timeline").performScrollToIndex(12)
            vm.select("b")
            await {
                vm.state.value.session?.threadId == "b" && vm.state.value.session?.loading == false
            }
            compose.onNodeWithText("Latest B").assertIsDisplayed()
        }
    }

    @Test
    fun `reading earlier turns exposes an action that returns to the latest turn`() {
        fixture { _ ->
            compose.onNodeWithTag("conversation-timeline").performScrollToIndex(12)
            compose
                .onNodeWithContentDescription("Jump to latest message")
                .assertIsDisplayed()
                .performClick()
            compose.waitForIdle()
            compose.onNodeWithText("Latest A").assertIsDisplayed()
        }
    }

    private fun fixture(check: (ConversationViewModel) -> Unit) {
        MockWebServer().use { server ->
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        val id = request.path?.removePrefix("/conversations/")
                        return when {
                            request.path == "/agent-info" ->
                                MockResponse().setBody("{\"model\":\"fixture\"}")
                            request.path == "/conversations" ->
                                MockResponse().setBody("{\"conversations\":[]}")
                            id in setOf("a", "b") -> {
                                val messages =
                                    (0..19).flatMap { index ->
                                        listOf<Message>(
                                            UserMessage(
                                                "$id-user-$index",
                                                if (index == 19) "Latest ${id!!.uppercase()}"
                                                else "Earlier $id $index",
                                            ),
                                            AssistantMessage(
                                                "$id-answer-$index",
                                                "A reply with enough content to form a real conversation.\n\nHere is another paragraph.",
                                            ),
                                        )
                                    }
                                MockResponse()
                                    .setBody(
                                        protocolJson.encodeToString(
                                            ConversationSnapshot.serializer(),
                                            ConversationSnapshot(
                                                id,
                                                messages,
                                                emptyList(),
                                                emptyList(),
                                                emptyList(),
                                            ),
                                        )
                                    )
                            }
                            else -> MockResponse().setResponseCode(404)
                        }
                    }
                }
            server.start()
            val context = RuntimeEnvironment.getApplication()
            val journal = PreferenceStore(context).conversations(server.url("/").toString())
            runBlocking {
                journal.write(SavedConversation("a", empty = false))
                journal.select("a")
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
                    PlaygroundTheme("light") {
                        ConversationScreen(vm, AppPreferences(replyAnimation = false))
                    }
                }
                await { vm.state.value.session?.loading == false }
                check(vm)
            } finally {
                vm.setVisible(false)
                store.clear()
            }
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

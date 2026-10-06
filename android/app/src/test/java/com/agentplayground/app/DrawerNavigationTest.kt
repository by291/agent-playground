package com.agentplayground.app

import android.os.Looper
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.agentplayground.app.data.AppPreferences
import com.agentplayground.app.design.PlaygroundTheme
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
@Config(sdk = [35], application = PlaygroundApplication::class, qualifiers = "w360dp-h740dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class DrawerNavigationTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `history pushes the entire chat page and tapping the exposed page restores it`() {
        fixture {
            val titleBefore = compose.onNodeWithTag("conversation-title").getUnclippedBoundsInRoot()
            val tabBefore = compose.onNodeWithText("Chat").getUnclippedBoundsInRoot()
            compose.onNodeWithContentDescription("Open conversation history").performClick()
            val titleOpen = compose.onNodeWithTag("conversation-title").getUnclippedBoundsInRoot()
            val tabOpen = compose.onNodeWithText("Chat").getUnclippedBoundsInRoot()
            val displacement = titleOpen.left.value - titleBefore.left.value
            assertTrue("Chat should slide away to reveal history", displacement > 240f)
            assertEquals(displacement, tabOpen.left.value - tabBefore.left.value, 1f)
            compose.onNodeWithText("Your workspace").assertIsDisplayed()
            compose.onRoot().performTouchInput { click(Offset(width - 12f, height / 2f)) }
            compose.onNodeWithTag("conversation-title").assertIsDisplayed()
            assertEquals(
                titleBefore.left,
                compose.onNodeWithTag("conversation-title").getUnclippedBoundsInRoot().left,
            )
            compose.onNodeWithContentDescription("Message").assertTextContains("Preserved draft")
        }
    }

    @Test
    fun `history remains swipe dismissible and selecting a thread closes the shifted page`() {
        fixture {
            compose.onNodeWithContentDescription("Open conversation history").performClick()
            compose.onRoot().performTouchInput { swipeLeft() }
            compose.onNodeWithTag("conversation-title").assertIsDisplayed()
            compose.onNodeWithContentDescription("Open conversation history").performClick()
            compose.onNodeWithText("Other conversation").performClick()
            await {
                compose
                    .onAllNodesWithTag("conversation-title")
                    .fetchSemanticsNodes()
                    .singleOrNull()
                    ?.config
                    ?.get(androidx.compose.ui.semantics.SemanticsProperties.Text)
                    ?.firstOrNull()
                    ?.text == "Other conversation"
            }
            compose.onNodeWithTag("conversation-title").assertIsDisplayed()
            compose.onNodeWithText("Your workspace").assertIsNotDisplayed()
        }
    }

    private fun fixture(check: () -> Unit) {
        MockWebServer().use { server ->
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse =
                        when (request.path) {
                            "/agent-info" -> MockResponse().setBody("{\"model\":\"fixture\"}")
                            "/conversations" ->
                                MockResponse()
                                    .setBody(
                                        """{"conversations":[{"threadId":"fixture","title":"Drawer fixture","createdAt":"now","updatedAt":"now"},{"threadId":"other","title":"Other conversation","createdAt":"now","updatedAt":"now"}]}"""
                                    )
                            "/conversations/fixture",
                            "/conversations/other" ->
                                MockResponse()
                                    .setBody(
                                        protocolJson.encodeToString(
                                            ConversationSnapshot.serializer(),
                                            ConversationSnapshot(
                                                if (request.path!!.endsWith("other"))
                                                    "Other conversation"
                                                else "Drawer fixture",
                                                listOf(
                                                    UserMessage("user", "Question"),
                                                    AssistantMessage("answer", "Answer"),
                                                ),
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
            val application = RuntimeEnvironment.getApplication() as PlaygroundApplication
            val preferences =
                AppPreferences(serverUrl = server.url("/").toString(), replyAnimation = false)
            val journal = application.preferences.conversations(preferences.serverUrl)
            runBlocking {
                journal.write(
                    SavedConversation("fixture", draft = "Preserved draft", empty = false)
                )
                journal.select("fixture")
            }
            compose.setContent {
                PlaygroundTheme("light") { PlaygroundApp(application, preferences) }
            }
            await {
                compose
                    .onAllNodesWithTag("conversation-title")
                    .fetchSemanticsNodes()
                    .singleOrNull()
                    ?.config
                    ?.get(androidx.compose.ui.semantics.SemanticsProperties.Text)
                    ?.firstOrNull()
                    ?.text == "Drawer fixture"
            }
            check()
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

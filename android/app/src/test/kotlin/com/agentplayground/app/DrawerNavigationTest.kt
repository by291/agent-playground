package com.agentplayground.app

import android.os.Looper
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import com.agentplayground.app.navigation.PlaygroundApp
import com.agentplayground.core.model.ConversationSnapshot
import com.agentplayground.core.model.SavedConversation
import com.agentplayground.core.model.protocolJson
import com.agentplayground.data.AppPreferences
import com.agentplayground.ui.PlaygroundTheme
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
    fun `destination is installed before the drawer finishes closing`() {
        fixture {
            compose.onNodeWithContentDescription("Open conversation history").performClick()
            compose.onNodeWithTag("navigation-settings").assertIsDisplayed()

            compose.mainClock.autoAdvance = false
            compose.onNodeWithTag("navigation-settings").performClick()
            compose.mainClock.advanceTimeBy(32)

            compose.onNodeWithTag("navigation-settings").assertIsSelected()
            compose.onNodeWithText("Make it yours.").assertExists()

            compose.mainClock.advanceTimeBy(600)
            compose.onNodeWithText("Make it yours.").assertIsDisplayed()
            compose.mainClock.autoAdvance = true
        }
    }

    @Test
    fun `history pushes the entire chat page and tapping the exposed page restores it`() {
        fixture {
            val titleBefore = compose.onNodeWithTag("conversation-title").getUnclippedBoundsInRoot()
            val composerBefore =
                compose.onNodeWithContentDescription("Message").getUnclippedBoundsInRoot()

            compose.onNodeWithText("Settings").assertIsNotDisplayed()

            compose.onNodeWithContentDescription("Open conversation history").performClick()

            val titleOpen = compose.onNodeWithTag("conversation-title").getUnclippedBoundsInRoot()
            val composerOpen =
                compose.onNodeWithContentDescription("Message").getUnclippedBoundsInRoot()
            val displacement = titleOpen.left.value - titleBefore.left.value

            assertTrue("Chat should slide away to reveal history", displacement > 240f)
            assertEquals(displacement, composerOpen.left.value - composerBefore.left.value, 1f)
            compose.onNodeWithText("Workspace").assertIsDisplayed()

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
    fun `drawer navigation remains reachable in a short landscape window`() {
        fixture(compact = true) {
            compose.onNodeWithContentDescription("Open conversation history").performClick()

            compose.onNodeWithText("New conversation").assertIsDisplayed()
            compose.onNodeWithTag("navigation-knowledge").assertIsDisplayed()
            compose.onNodeWithTag("navigation-settings").assertIsDisplayed().performClick()
            compose.onNodeWithText("Make it yours.").assertIsDisplayed()
        }
    }

    @Test
    fun `drawer destinations stay reachable across pages and returning keeps the chat draft`() {
        fixture {
            compose.onNodeWithContentDescription("Open conversation history").performClick()

            val knowledge = compose.onNodeWithTag("navigation-knowledge").getUnclippedBoundsInRoot()
            val current = compose.onNodeWithTag("history-fixture").getUnclippedBoundsInRoot()
            val settings = compose.onNodeWithTag("navigation-settings").getUnclippedBoundsInRoot()

            assertTrue("Knowledge belongs above conversations", knowledge.top < current.top)
            assertTrue("Settings belongs in the workspace footer", settings.top > current.bottom)
            compose.onNodeWithText("Chat").assertDoesNotExist()

            compose.onNodeWithTag("navigation-settings").performClick()
            compose.onNodeWithText("Make it yours.").assertIsDisplayed()
            compose.onNodeWithContentDescription("Open navigation menu").performClick()
            compose.onNodeWithTag("navigation-settings").assertIsSelected()

            compose.onNodeWithText("Knowledge").performClick()
            compose.onNodeWithText("Your shared library.").assertIsDisplayed()
            compose.onNodeWithContentDescription("Open navigation menu").performClick()
            compose.onNodeWithTag("navigation-knowledge").assertIsSelected()

            compose.onNodeWithTag("history-fixture").performClick()

            compose.onNodeWithTag("conversation-title").assertTextEquals("Drawer fixture")
            compose.onNodeWithContentDescription("Message").assertTextContains("Preserved draft")
            compose.onNodeWithText("Settings").assertIsNotDisplayed()
        }
    }

    @Test
    fun `an unsent conversation remains reachable from the library without creating a new draft`() {
        fixture(empty = true) {
            compose.onNodeWithContentDescription("Open conversation history").performClick()
            compose.onNodeWithTag("navigation-knowledge").performClick()
            compose.onNodeWithContentDescription("Open navigation menu").performClick()
            compose.onNodeWithTag("history-fixture").assertIsDisplayed().performClick()

            compose.onNodeWithTag("conversation-title").assertTextEquals("New conversation")
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
            compose.onNodeWithText("Workspace").assertIsNotDisplayed()
        }
    }

    private fun fixture(compact: Boolean = false, empty: Boolean = false, check: () -> Unit) {
        MockWebServer().use { server ->
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse =
                        when (request.path) {
                            "/agent-info" -> MockResponse().setBody("{\"model\":\"fixture\"}")
                            "/conversations" ->
                                MockResponse()
                                    .setBody(
                                        if (empty) {
                                            """{"conversations":[]}"""
                                        } else {
                                            """{"conversations":[{"threadId":"fixture","title":"Drawer fixture","createdAt":"now","updatedAt":"now"},{"threadId":"other","title":"Other conversation","createdAt":"now","updatedAt":"now"}]}"""
                                        }
                                    )
                            "/conversations/fixture",
                            "/conversations/other" ->
                                if (empty && request.path == "/conversations/fixture") {
                                    MockResponse().setResponseCode(404)
                                } else {
                                    MockResponse()
                                        .setBody(
                                            protocolJson.encodeToString(
                                                ConversationSnapshot.serializer(),
                                                ConversationSnapshot(
                                                    if (request.path!!.endsWith("other")) {
                                                        "Other conversation"
                                                    } else {
                                                        "Drawer fixture"
                                                    },
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
                journal.write(
                    SavedConversation("fixture", draft = "Preserved draft", empty = empty)
                )
                journal.select("fixture")
            }

            compose.setContent {
                PlaygroundTheme("light") {
                    if (compact) {
                        Box(Modifier.width(700.dp).height(360.dp)) {
                            PlaygroundApp(application, preferences)
                        }
                    } else {
                        PlaygroundApp(application, preferences)
                    }
                }
            }

            await {
                compose
                    .onAllNodesWithTag("conversation-title")
                    .fetchSemanticsNodes()
                    .singleOrNull()
                    ?.config
                    ?.get(androidx.compose.ui.semantics.SemanticsProperties.Text)
                    ?.firstOrNull()
                    ?.text == if (empty) "New conversation" else "Drawer fixture"
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

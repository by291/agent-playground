package com.agentplayground.feature.conversation

import android.os.Looper
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.agentplayground.data.RepositoryFactory
import com.agentplayground.design.PlaygroundTheme
import com.agentplayground.domain.model.ConversationSnapshot
import com.agentplayground.domain.model.RunRecord
import com.agentplayground.domain.model.SavedConversation
import com.agentplayground.domain.model.WorkflowMetadata
import com.agentplayground.domain.model.WorkflowOutput
import com.agentplayground.domain.model.WorkflowPresentation
import com.agentplayground.domain.model.protocolJson
import com.agentplayground.domain.settings.AppPreferences
import com.agui.core.types.*
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
@Config(sdk = [35], qualifiers = "w412dp-h892dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WorkflowHistoryTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `history follows its original tool while the current card follows the latest reply`() {
        fixture(presentationMetadata = true) { verifyHistory() }
    }

    @Test
    fun `earlier experiment stages are also contained in collapsed execution details`() {
        fixture(presentationMetadata = false) { verifyHistory() }
    }

    private fun verifyHistory() {
        compose.onNodeWithText("Current result").assertIsDisplayed()
        compose.onNodeWithText("Earlier workflow results (1)").assertDoesNotExist()
        compose.onNodeWithText("Previous workflow steps").assertDoesNotExist()
        compose.onNodeWithText("Earlier result").assertDoesNotExist()

        compose.onNodeWithTag("tool-group-other").performScrollTo().performClick()
        compose.onNodeWithText("Previous workflow steps").assertDoesNotExist()
        compose.onNodeWithText("Earlier result").assertDoesNotExist()
        compose.onNodeWithTag("tool-group-other").performClick()

        compose.onNodeWithTag("tool-group-workflow").performScrollTo().performClick()
        compose.onNodeWithText("Previous workflow steps").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Earlier result").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("tool-group-workflow").performScrollTo().performClick()
        compose.onNodeWithText("Previous workflow steps").assertDoesNotExist()
        compose.onNodeWithText("Earlier result").assertDoesNotExist()
        compose.onNodeWithText("Current result").performScrollTo().assertIsDisplayed()
    }

    private fun fixture(presentationMetadata: Boolean, check: () -> Unit) {
        val workflowTool =
            if (presentationMetadata) "run_sql_workflow" else "run_experiment_workflow"
        val messages =
            listOf(
                UserMessage("initial-user", "Create a result"),
                AssistantMessage(
                    "caller",
                    toolCalls = listOf(ToolCall("workflow", FunctionCall(workflowTool, "{}"))),
                ),
                ToolMessage("workflow-result", "Completed", "workflow"),
                AssistantMessage("initial-reply", "Initial review."),
                UserMessage("feedback", "Revise the result"),
                AssistantMessage(
                    "other-caller",
                    toolCalls = listOf(ToolCall("other", FunctionCall("calculate_sum", "{}"))),
                ),
                ToolMessage("other-result", "2", "other"),
                AssistantMessage("latest-reply", "Updated review."),
            )
        val outputs =
            listOf(
                output(1, "idea", "Earlier result", "initial-reply", presentationMetadata),
                output(2, "reviewed", "Current result", "latest-reply", presentationMetadata),
            )
        val snapshot =
            ConversationSnapshot(
                "Workflow history",
                messages,
                emptyList(),
                outputs,
                listOf(
                    RunRecord("first-run", "initial-user", "completed"),
                    RunRecord("second-run", "feedback", "completed"),
                ),
            )

        MockWebServer().use { server ->
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
                                            snapshot,
                                        )
                                    )
                            else -> MockResponse().setResponseCode(404)
                        }
                }
            server.start()

            val context = RuntimeEnvironment.getApplication()
            val journal =
                RepositoryFactory(context).preferences.conversations(server.url("/").toString())

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
                                RepositoryFactory(context).conversation(server.url("/").toString())
                            )
                                as T
                    },
                )[ConversationViewModel::class.java]

            try {
                compose.setContent {
                    PlaygroundTheme("light") {
                        ConversationRoute(vm, AppPreferences(replyAnimation = false))
                    }
                }

                compose.waitUntil(10_000) {
                    Shadows.shadowOf(Looper.getMainLooper()).idle()
                    vm.state.value.session?.loading == false &&
                        compose
                            .onAllNodesWithText("Current result")
                            .fetchSemanticsNodes()
                            .isNotEmpty()
                }

                check()
            } finally {
                vm.setVisible(false)
                store.clear()
            }
        }
    }

    private fun output(
        sequence: Int,
        stage: String,
        text: String,
        anchor: String,
        presentationMetadata: Boolean,
    ): WorkflowOutput {
        val surface = "experiment-workflow-$stage"
        val messages =
            protocolJson.parseToJsonElement(
                """[
                    {"version":"v0.9","createSurface":{"surfaceId":"$surface","catalogId":"urn:agent-playground:workflow:v1"}},
                    {"version":"v0.9","updateComponents":{"surfaceId":"$surface","components":[
                        {"id":"root","component":"WorkflowText","text":"$text","role":"title"}
                    ]}}
                ]"""
            )

        return WorkflowOutput(
            "output-$sequence",
            sequence,
            messages,
            toolCallId = "workflow",
            workflow =
                if (presentationMetadata) {
                    WorkflowMetadata(
                        presentation = WorkflowPresentation(surface, "workflow", anchor)
                    )
                } else {
                    null
                },
        )
    }
}

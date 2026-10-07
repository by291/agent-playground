package com.agentplayground.feature.conversation

import androidx.a2ui.compose.runtime.A2uiMessageParser
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.agentplayground.core.model.WorkflowOutput
import com.agentplayground.core.model.protocolJson
import com.agentplayground.feature.conversation.ui.workflow.WorkflowSurface
import com.agentplayground.feature.conversation.ui.workflow.rememberWorkflowRenderer
import kotlinx.serialization.json.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WorkflowRendererTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `official renderer presents the existing v09 workflow catalog`() {
        val messages =
            protocolJson.parseToJsonElement(
                """[
            {"version":"v0.9","createSurface":{"surfaceId":"experiment","catalogId":"urn:agent-playground:workflow:v1"}},
            {"version":"v0.9","updateComponents":{"surfaceId":"experiment","components":[
                {"id":"root","component":"WorkflowPanel","children":["title","steps"]},
                {"id":"title","component":"WorkflowText","role":"title","text":"Experiment result"},
                {"id":"steps","component":"WorkflowSteps","children":["step"]},
                {"id":"step","component":"WorkflowText","role":"step","text":"Validation passed"}
            ]}}
        ]"""
            )

        compose.setContent {
            MaterialTheme {
                val renderer =
                    rememberWorkflowRenderer(
                        "thread",
                        listOf(WorkflowOutput("output", 1, messages)),
                    )

                WorkflowSurface(renderer, "experiment")
            }
        }
        compose.waitUntil(10_000) {
            compose.onAllNodesWithText("Validation passed").fetchSemanticsNodes().isNotEmpty()
        }

        compose.onNodeWithText("Experiment result").assertIsDisplayed()
        compose.onNodeWithText("Validation passed").assertIsDisplayed()
    }

    @Test
    fun `SQL renderer shows check issues and submitted receipt`() {
        val messages =
            protocolJson.parseToJsonElement(
                """[
            {"version":"v0.9","createSurface":{"surfaceId":"sql","catalogId":"urn:agent-playground:workflow:v1"}},
            {"version":"v0.9","updateComponents":{"surfaceId":"sql","components":[
                {"id":"root","component":"WorkflowSql","workflowCallId":"call","sql":"SELECT id FROM orders;","originalSql":"SELECT * FROM orders;","revision":2,"round":1,"status":"submitted","check":{"passed":true,"issues":[]},"receiptId":"receipt-1"}
            ]}}
        ]"""
            )

        compose.setContent {
            MaterialTheme {
                val renderer =
                    rememberWorkflowRenderer(
                        "thread",
                        listOf(WorkflowOutput("output", 1, messages)),
                    )

                WorkflowSurface(renderer, "sql")
            }
        }
        compose.waitUntil(10_000) {
            compose.onAllNodesWithText("Receipt: receipt-1").fetchSemanticsNodes().isNotEmpty()
        }

        compose.onNodeWithText("Version 2 · SQL submitted").assertIsDisplayed()
        compose.onNodeWithText("SELECT id FROM orders;").assertIsDisplayed()
    }

    @Test
    fun `malformed A2UI is rejected by official parser before it reaches rendering`() {
        org.junit.Assert.assertThrows(androidx.a2ui.model.protocol.A2uiException::class.java) {
            A2uiMessageParser()
                .parse("""{"version":"unsupported","updateComponents":{"surfaceId":"sql"}}""")
        }
    }
}

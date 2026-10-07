package com.agentplayground.feature.conversation

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.agentplayground.core.conversation.SessionState
import com.agentplayground.core.model.AgentInfo
import com.agentplayground.core.model.AgentModel
import com.agentplayground.core.model.ContextUsage
import com.agentplayground.data.AppPreferences
import com.agentplayground.feature.conversation.ui.composer.Composer
import com.agentplayground.ui.PlaygroundTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w412dp-h892dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ModelPickerTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `picker changes only the model and retains draft input and context access`() {
        var state by
            mutableStateOf(
                ConversationUiState(session = SessionState("new"), agentInfo = catalog())
            )
        compose.setContent {
            PlaygroundTheme("light") {
                Composer(
                    state,
                    AppPreferences(),
                    { state.session!!.draft },
                    { state = state.copy(session = state.session!!.copy(draft = it)) },
                    {},
                    {},
                    { _, _ -> null },
                    {},
                    onSelectModel = {
                        state = state.copy(session = state.session!!.copy(modelId = it))
                    },
                )
            }
        }
        val input = compose.onNodeWithContentDescription("Message")
        input.performClick().performTextInput("Preserve this draft")
        compose.onNodeWithContentDescription("Choose conversation model").performClick()
        compose.onNodeWithText("qwen3.8-flash").assertIsDisplayed()
        compose.onNodeWithText("Qwen3.8-Flash").performClick()

        input.assertTextEquals("Preserve this draft").assertIsFocused()
        assertEquals("qwen", state.session!!.modelId)
        compose.onNodeWithText("Qwen3.8-Flash").assertIsDisplayed()
        compose.onNodeWithContentDescription("Choose conversation model").performClick()
        compose.onNodeWithText("Context details").performClick()
        compose.onNodeWithText("Model context").assertIsDisplayed()
        compose
            .onNodeWithText("Context usage appears after a model call for the current model.")
            .assertIsDisplayed()
    }

    @Test
    fun `unavailable model stays visible disabled and cannot replace the selected option`() {
        val state =
            ConversationUiState(
                session = SessionState("thread", modelId = "deepseek"),
                agentInfo = catalog(qwenAvailable = false),
            )
        var selected: String? = null
        compose.setContent {
            PlaygroundTheme("light") {
                Composer(
                    state,
                    AppPreferences(),
                    { "" },
                    {},
                    {},
                    {},
                    { _, _ -> null },
                    {},
                    onSelectModel = { selected = it },
                )
            }
        }

        compose.onNodeWithContentDescription("Choose conversation model").performClick()
        compose.onNodeWithText("qwen3.8-flash").assertIsDisplayed()
        compose.onNodeWithText("Not configured").assertIsDisplayed()
        compose.onNodeWithTag("model-option-qwen").assertIsNotEnabled().performClick()

        assertNull(selected)
    }

    @Test
    fun `uploads and paused sessions block picker actions while context stays available`() {
        var state by
            mutableStateOf(
                ConversationUiState(
                    session = SessionState("thread"),
                    agentInfo = catalog(),
                    uploading = true,
                )
            )
        var selected: String? = null
        compose.setContent {
            PlaygroundTheme("light") {
                Composer(
                    state,
                    AppPreferences(),
                    { "" },
                    {},
                    {},
                    {},
                    { _, _ -> null },
                    {},
                    onSelectModel = { selected = it },
                )
            }
        }
        compose.onNodeWithContentDescription("Choose conversation model").performClick()
        compose.onNodeWithTag("model-option-qwen").assertIsNotEnabled()
        compose.runOnIdle {
            state =
                state.copy(
                    uploading = false,
                    session = state.session!!.copy(modelSelectionPending = true),
                )
        }
        compose.onNodeWithTag("model-option-qwen").assertIsNotEnabled()
        compose.runOnIdle {
            state =
                state.copy(
                    session =
                        state.session!!.copy(
                            modelSelectionPending = false,
                            pendingSubmission = true,
                        )
                )
        }
        compose.onNodeWithTag("model-option-qwen").assertIsNotEnabled().performClick()
        compose.onNodeWithText("Context details").performClick()
        compose.onNodeWithText("Model context").assertIsDisplayed()

        assertNull(selected)
    }

    @Test
    fun `selected model hides earlier usage and metadata refresh cannot change selection`() {
        val usage =
            ContextUsage(
                "deepseek-flash",
                500,
                1000,
                800,
                emptyMap(),
                compactions = 0,
                revision = 1,
            )
        var state by
            mutableStateOf(
                ConversationUiState(
                    session = SessionState("thread", modelId = "qwen", contextUsage = usage),
                    agentInfo = catalog(),
                )
            )
        compose.setContent {
            PlaygroundTheme("light") {
                Composer(
                    state,
                    AppPreferences(),
                    { "" },
                    {},
                    {},
                    {},
                    { _, _ -> null },
                    {},
                    onSelectModel = {},
                )
            }
        }

        compose.runOnIdle {
            state = state.copy(agentInfo = catalog().copy(defaultModelId = "deepseek"))
        }
        compose.onNodeWithText("Qwen3.8-Flash").assertIsDisplayed()
        compose.onNodeWithText(" · 50%").assertDoesNotExist()
        compose.onNodeWithContentDescription("Choose conversation model").performClick()
        compose.onNodeWithText("Context details").performClick()
        compose
            .onNodeWithText("Context usage appears after a model call for the current model.")
            .assertIsDisplayed()
    }

    private fun catalog(qwenAvailable: Boolean = true) =
        AgentInfo(
            "deepseek-flash",
            "deepseek",
            listOf(
                AgentModel("deepseek", "DeepSeek", "deepseek-flash", true),
                AgentModel("qwen", "Qwen3.8-Flash", "qwen3.8-flash", qwenAvailable),
            ),
        )
}

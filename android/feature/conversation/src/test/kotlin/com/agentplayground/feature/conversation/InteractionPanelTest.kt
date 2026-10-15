package com.agentplayground.feature.conversation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.agentplayground.design.PlaygroundTheme
import com.agentplayground.domain.conversation.*
import com.agentplayground.domain.files.PickedFile
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.MessageAttachment
import com.agentplayground.domain.settings.AppPreferences
import com.agui.core.types.*
import kotlinx.serialization.json.*
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
class InteractionPanelTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `interaction is the only visible composer state with normal text and bottom actions`() {
        val state = mutableStateOf(session(interaction(includeTool = false)))

        render(state)

        compose.onNodeWithText("**Choose approach**").assertIsDisplayed()
        compose.onNodeWithText("Agent needs your input").assertDoesNotExist()
        compose.onNodeWithText("Provide missing information to continue").assertDoesNotExist()
        compose.onNodeWithText("Answer").assertDoesNotExist()
        compose.onNodeWithText("Generic interrupt fallback").assertDoesNotExist()
        compose.onNodeWithTag("interaction-answer-goal").assertDoesNotExist()
        compose.onNodeWithContentDescription("Message").assertDoesNotExist()
        compose.onNodeWithTag("conversation-composer").assertIsNotDisplayed()
        compose.onNodeWithTag("conversation-composer-compact").assertIsDisplayed()
        compose.onAllNodes(isFocused()).assertCountEquals(0)

        val panel = compose.onNodeWithTag("interaction-panel").getUnclippedBoundsInRoot()
        val footer = compose.onNodeWithTag("interaction-footer").getUnclippedBoundsInRoot()
        val lastChoice = compose.onNodeWithTag("interaction-other-goal").getUnclippedBoundsInRoot()

        assertTrue(panel.bottom >= footer.bottom)
        assertTrue(footer.top >= lastChoice.bottom)
        assertTrue(lastChoice.bottom - lastChoice.top >= 56.dp)
        assertTrue(footer.bottom - footer.top >= 48.dp)
        assertFontSize("**Choose approach**", 16.sp)
        assertFontSize("Fast", 16.sp)
        assertFontSize("Verify each boundary", 14.sp)
        compose.onNodeWithText("Question").assertIsDisplayed()
        compose.onNodeWithText("1").assertIsDisplayed()
        compose.onNodeWithText("2").assertIsDisplayed()
        compose.onNodeWithText("Something else").assertDoesNotExist()
        compose.onNodeWithText("Write your own answer").assertIsDisplayed()
        compose.onNodeWithContentDescription("Skip question").assertIsDisplayed()
        compose.onNodeWithText("Skip").assertIsDisplayed()
        compose.onNodeWithText("Send").assertIsNotEnabled()
    }

    @Test
    fun `something else retains custom selection and text equal to a suggested option through failure`() {
        val request = interaction(includeTool = false)
        val state = mutableStateOf(session(request))
        var submissions = 0

        render(
            state,
            onSubmit = {
                submissions++
                state.value = state.value.copy(error = "Submission failed. Try again.")
            },
        )

        compose.onNodeWithTag("interaction-answer-goal").assertDoesNotExist()
        compose.onNodeWithTag("interaction-other-goal").performClick().assertIsSelected()
        compose
            .onNodeWithTag("interaction-answer-goal")
            .assertIsNotFocused()
            .performTextReplacement("Fast")
        compose.onNodeWithTag("interaction-other-goal").assertIsSelected()
        compose.onNodeWithTag("interaction-option-goal-0").assertIsNotSelected()
        compose.onNodeWithTag("interaction-option-goal-0").performClick().assertIsSelected()
        compose.onNodeWithTag("interaction-answer-goal").assertDoesNotExist()
        compose.onNodeWithTag("interaction-other-goal").performClick().assertIsSelected()
        compose.onNodeWithTag("interaction-answer-goal").assertTextContains("Fast")
        assertEquals(0, submissions)

        compose.onNodeWithText("Send").performClick()

        assertEquals(1, submissions)
        assertEquals(
            "Fast",
            state.value.interactionDrafts.getValue(request).decisions.single().answers["goal"],
        )
        compose.onNodeWithTag("interaction-other-goal").assertIsSelected()
        compose.onNodeWithTag("interaction-answer-goal").assertTextContains("Fast")
        compose.onNodeWithContentDescription("Message").assertDoesNotExist()

        compose.runOnIdle { state.value = state.value.copy(interrupts = emptyList()) }

        compose.onNodeWithContentDescription("Message").assertTextEquals("Preserve the main draft")
        compose.onNodeWithTag("conversation-composer-compact").assertDoesNotExist()
    }

    @Test
    fun `one question per page preserves answers and mixed batch waits for explicit tool approval`() {
        val request =
            interaction(
                questions =
                    listOf(question(), question("scope", "What is the scope?", choices = false))
            )
        val state = mutableStateOf(session(request))
        var submitted: InteractionDraft? = null

        render(state, onSubmit = { submitted = state.value.interactionDrafts[it] })

        compose.onNodeWithText("What is the scope?").assertDoesNotExist()
        compose.onNodeWithTag("interaction-other-goal").performClick()
        compose.onNodeWithTag("interaction-answer-goal").performTextReplacement("Fast")
        compose.onNodeWithText("Next").performClick()
        compose.onNodeWithText("**Choose approach**").assertDoesNotExist()
        compose.onNodeWithText("What is the scope?").assertIsDisplayed()
        compose.onNodeWithTag("interaction-answer-scope").performTextReplacement("Bounded scope")
        compose.onNodeWithText("Next").performClick()

        compose.onNodeWithText("Allow once").assertIsDisplayed()
        assertNull(submitted)
        assertNull(state.value.interactionDrafts.getValue(request).decisions[1].type)
        compose.onNodeWithContentDescription("Previous").performClick()
        compose.onNodeWithTag("interaction-answer-scope").assertTextContains("Bounded scope")
        compose.onNodeWithContentDescription("Previous").performClick()
        compose.onNodeWithTag("interaction-other-goal").assertIsSelected()
        compose.onNodeWithTag("interaction-answer-goal").assertTextContains("Fast")
        compose.onNodeWithText("Next").performClick()
        compose.onNodeWithText("Next").performClick()
        compose.onNodeWithText("Allow once").performClick()

        assertEquals(2, submitted!!.decisions.size)
        assertEquals(
            mapOf("goal" to "Fast", "scope" to "Bounded scope"),
            submitted!!.decisions[0].answers,
        )
        assertEquals(InteractionDecisionType.Approve, submitted!!.decisions[1].type)
    }

    @Test
    fun `rejecting clarification skips remaining questions without approving the following tool`() {
        val request =
            interaction(questions = listOf(question(), question("second", "Do not ask this next")))
        val state = mutableStateOf(session(request))
        var submitted: InteractionDraft? = null

        render(state, onSubmit = { submitted = state.value.interactionDrafts[it] })
        compose.onNodeWithText("Skip").performClick()

        compose.onNodeWithText("Do not ask this next").assertDoesNotExist()
        compose.onNodeWithText("Allow once").assertIsDisplayed()
        assertNull(submitted)
        assertEquals(
            InteractionDecisionType.Reject,
            state.value.interactionDrafts.getValue(request).decisions[0].type,
        )
        assertNull(state.value.interactionDrafts.getValue(request).decisions[1].type)
        compose.onNodeWithText("Allow once").performClick()

        assertEquals(
            listOf(InteractionDecisionType.Reject, InteractionDecisionType.Approve),
            submitted!!.decisions.map { it.type },
        )
    }

    @Test
    fun `question close declines its entire action while leaving hidden approvals undecided`() {
        val request =
            interaction(questions = listOf(question(), question("second", "Do not show this next")))
        val state = mutableStateOf(session(request))
        var submissions = 0

        render(state, onSubmit = { submissions++ })
        compose.onNodeWithContentDescription("Skip question").performClick()

        compose.onNodeWithText("Do not show this next").assertDoesNotExist()
        compose.onNodeWithText("Approval").assertIsDisplayed()
        assertEquals(
            InteractionDecisionType.Reject,
            state.value.interactionDrafts.getValue(request).decisions[0].type,
        )
        assertNull(state.value.interactionDrafts.getValue(request).decisions[1].type)
        assertEquals(0, submissions)
    }

    @Test
    fun `single tool allow once is an actual footer action and immediately submits approval`() {
        val request = interaction(questions = emptyList())
        val state = mutableStateOf(session(request))
        var submitted: InteractionDraft? = null

        render(state, onSubmit = { submitted = state.value.interactionDrafts[it] })

        compose.onNodeWithText("Approve").assertDoesNotExist()
        compose.onNodeWithText("Answer").assertDoesNotExist()
        compose.onNodeWithText("Approval").assertIsDisplayed()
        compose.onNodeWithText("Allow forget memory?").assertIsDisplayed()
        compose.onNodeWithText("Allow forget_memory?").assertDoesNotExist()
        compose.onNodeWithText("Delete the selected memory").assertIsDisplayed()
        compose.onNodeWithText("Tool arguments").assertIsDisplayed()
        compose.onNodeWithTag("conversation-composer-compact").assertIsDisplayed()
        compose.onNodeWithContentDescription("Send message").assertIsNotEnabled()
        assertTrue(state.value.interactionDrafts.isEmpty())
        compose.onNodeWithText("Allow once").performClick()

        assertEquals(InteractionDecisionType.Approve, submitted!!.decisions.single().type)
    }

    @Test
    fun `footer respects response only and rejection only allowed decisions`() {
        val state =
            mutableStateOf(
                session(interaction(includeTool = false, askDecisions = listOf("respond")))
            )
        var submitted: InteractionDraft? = null

        render(state, onSubmit = { submitted = state.value.interactionDrafts[it] })
        compose.onNodeWithText("Skip").assertDoesNotExist()
        compose.onNodeWithContentDescription("Skip question").assertDoesNotExist()
        compose.onNodeWithTag("interaction-option-goal-1").performClick()
        compose.onNodeWithText("Send").performClick()
        assertEquals(InteractionDecisionType.Respond, submitted!!.decisions.single().type)

        val rejectOnly = interaction(questions = emptyList(), toolDecisions = listOf("reject"))
        compose.runOnIdle { state.value = session(rejectOnly) }

        compose.onNodeWithText("Allow once").assertDoesNotExist()
        compose.onNodeWithText("Reject").performClick()
        assertEquals(InteractionDecisionType.Reject, submitted!!.decisions.single().type)
    }

    @Test
    fun `tool arguments start collapsed and can be inspected without granting approval`() {
        val state = mutableStateOf(session(interaction(questions = emptyList())))
        var submissions = 0

        render(state, onSubmit = { submissions++ })

        compose.onNodeWithText("record-123", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Tool arguments").performClick()
        compose.onNodeWithText("record-123", substring = true).assertIsDisplayed()
        assertTrue(state.value.interactionDrafts.isEmpty())
        assertEquals(0, submissions)
    }

    @Test
    fun `revisiting an action displays its recorded allowed or rejected decision`() {
        val state = mutableStateOf(session(interaction(toolFirst = true)))
        var submissions = 0

        render(state, onSubmit = { submissions++ })
        compose.onNodeWithText("Allow once").performClick()
        compose.onNodeWithText("**Choose approach**").assertIsDisplayed()
        compose.onNodeWithContentDescription("Previous").performClick()

        compose.onNodeWithText("Allowed").assertIsDisplayed()
        assertEquals(0, submissions)
        compose.onNodeWithText("Reject").performClick()
        compose.onNodeWithContentDescription("Previous").performClick()

        compose.onNodeWithText("Rejected").assertIsDisplayed()
        assertEquals(0, submissions)
    }

    @Test
    fun `short narrow screen keeps interaction footer visible with custom input and no autofocus`() {
        val state =
            mutableStateOf(
                session(
                    interaction(
                        questions = listOf(question(text = "Long question ".repeat(50))),
                        includeTool = false,
                    )
                )
            )

        render(state, width = 320.dp, height = 440.dp)

        compose.onNodeWithContentDescription("Message").assertDoesNotExist()
        compose.onNodeWithText("Send").assertIsDisplayed()
        val footer = compose.onNodeWithTag("interaction-footer").getUnclippedBoundsInRoot()
        assertTrue(footer.bottom <= 440.dp)

        compose.onNodeWithTag("interaction-other-goal").performScrollTo().performClick()
        compose
            .onNodeWithTag("interaction-answer-goal")
            .performScrollTo()
            .assertIsDisplayed()
            .assertIsNotFocused()
        compose.onNodeWithContentDescription("Message").assertDoesNotExist()
        compose.onNodeWithText("Send").assertIsDisplayed()
    }

    @Test
    fun `composer stays mounted and restores unsent local editor text without taking focus`() {
        val request = interaction(includeTool = false)
        val state = mutableStateOf(session(request).copy(interrupts = emptyList()))

        render(state)
        compose.onNodeWithContentDescription("Message").performTextReplacement("Unsent local draft")
        compose.runOnIdle { state.value = state.value.copy(interrupts = listOf(request)) }

        compose.onNodeWithContentDescription("Message").assertDoesNotExist()
        compose.onNodeWithText("**Choose approach**").assertIsDisplayed()
        compose.onAllNodes(isFocused()).assertCountEquals(0)
        compose.runOnIdle { state.value = state.value.copy(interrupts = emptyList()) }

        compose.onNodeWithContentDescription("Message").assertTextEquals("Unsent local draft")
        compose.onNodeWithContentDescription("Message").assertIsNotFocused()
    }

    @Test
    fun `interaction dismisses attachment preview while selected files survive until composer returns`() {
        val request = interaction(includeTool = false)
        val state = mutableStateOf(session(request).copy(interrupts = emptyList()))
        val files =
            listOf(PickedFile("content://documents/photo", "photo.png", 120, "selected-file"))

        render(state, attachments = files)
        compose.onNodeWithContentDescription("Preview photo.png").performClick()
        compose.onNodeWithContentDescription("Close image preview").assertIsDisplayed()
        compose.runOnIdle { state.value = state.value.copy(interrupts = listOf(request)) }

        compose.onNodeWithContentDescription("Close image preview").assertDoesNotExist()
        compose.onNodeWithText("**Choose approach**").assertIsDisplayed()
        compose.runOnIdle { state.value = state.value.copy(interrupts = emptyList()) }

        compose.onNodeWithContentDescription("Close image preview").assertDoesNotExist()
        compose.onNodeWithContentDescription("Preview photo.png").assertIsDisplayed()
        compose.onNodeWithContentDescription("Remove photo.png").assertIsDisplayed()
    }

    private fun assertFontSize(text: String, size: androidx.compose.ui.unit.TextUnit) {
        val layouts = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(text, useUnmergedTree = true).performSemanticsAction(
            SemanticsActions.GetTextLayoutResult
        ) {
            it(layouts)
        }

        assertEquals(size, layouts.single().layoutInput.style.fontSize)
    }

    private fun render(
        state: MutableState<SessionState>,
        onSubmit: (Interrupt) -> Unit = {},
        width: Dp = 412.dp,
        height: Dp = 892.dp,
        attachments: List<PickedFile> = emptyList(),
    ) {
        compose.setContent {
            PlaygroundTheme("light") {
                Column(Modifier.width(width).height(height)) {
                    Screen(
                        state.value,
                        { interrupt, draft ->
                            state.value =
                                state.value.copy(
                                    interactionDrafts =
                                        state.value.interactionDrafts + (interrupt to draft)
                                )
                        },
                        onSubmit,
                        attachments,
                    )
                }
            }
        }
    }

    @Composable
    private fun Screen(
        session: SessionState,
        onEdit: (Interrupt, InteractionDraft) -> Unit,
        onSubmit: (Interrupt) -> Unit,
        attachments: List<PickedFile>,
    ) {
        ConversationScreen(
            state = ConversationUiState(session = session, attachments = attachments),
            preferences = AppPreferences(),
            currentDraft = { session.draft },
            onSelect = {},
            onRecover = {},
            onEditInput = {},
            onSend = {},
            onRemoveAttachment = {},
            onAttach = {},
            onSelectModel = {},
            onEditPlan = { _, _ -> },
            onReview = { _, _, _, _ -> },
            onContinueReviews = {},
            onDownload = {},
            onLink = {},
            fileDownload = { Download("/file/${it.id}", it.name) },
            documentDownload = { id, name -> Download("/document/$id", name) },
            onSuggestion = {},
            attachmentPresentation = { _, file -> MessageAttachment(file.name) },
            loadImage = { _, _ -> ImageBitmap(12, 6) },
            onSubmitExternalTaskInput = { _, _ -> },
            onCancelExternalTask = {},
            onOpenNavigation = null,
            onActivity = {},
            onEditInteraction = onEdit,
            onSubmitInteraction = onSubmit,
        )
    }

    private fun session(request: Interrupt) =
        SessionState(
            "thread",
            draft = "Preserve the main draft",
            messages = listOf(UserMessage("user", "Perform the task")),
            interrupts = listOf(request),
        )

    private fun interaction(
        questions: List<JsonObject> = listOf(question()),
        includeTool: Boolean = true,
        askDecisions: List<String> = listOf("respond", "reject"),
        toolDecisions: List<String> = listOf("approve", "reject"),
        toolFirst: Boolean = false,
    ): Interrupt {
        val actions = mutableListOf<JsonElement>()
        val configs = mutableListOf<JsonElement>()

        if (questions.isNotEmpty()) {
            actions.add(
                buildJsonObject {
                    put("name", "ask_user")
                    put("description", "Provide missing information to continue")
                    put("args", buildJsonObject { put("questions", JsonArray(questions)) })
                }
            )
            configs.add(config("ask_user", askDecisions))
        }

        if (includeTool) {
            actions.add(
                buildJsonObject {
                    put("name", "forget_memory")
                    put("args", buildJsonObject { put("id", "record-123") })
                    put("description", "Delete the selected memory")
                }
            )
            configs.add(config("forget_memory", toolDecisions))
        }

        return Interrupt(
            "generic",
            "human_approval",
            message = "Generic interrupt fallback",
            metadata =
                buildJsonObject {
                    put(
                        "langgraph",
                        buildJsonObject {
                            put(
                                "raw",
                                buildJsonObject {
                                    put(
                                        "action_requests",
                                        JsonArray(if (toolFirst) actions.reversed() else actions),
                                    )
                                    put(
                                        "review_configs",
                                        JsonArray(if (toolFirst) configs.reversed() else configs),
                                    )
                                },
                            )
                        },
                    )
                },
        )
    }

    private fun config(name: String, decisions: List<String>) = buildJsonObject {
        put("action_name", name)
        put("allowed_decisions", JsonArray(decisions.map(::JsonPrimitive)))
    }

    private fun question(
        id: String = "goal",
        text: String = "**Choose approach**",
        choices: Boolean = true,
    ) = buildJsonObject {
        put("id", id)
        put("question", text)

        if (choices) {
            put(
                "options",
                buildJsonArray {
                    add(buildJsonObject { put("label", "Fast") })
                    add(
                        buildJsonObject {
                            put("label", "Thorough")
                            put("description", "Verify each boundary")
                        }
                    )
                },
            )
        }
    }
}

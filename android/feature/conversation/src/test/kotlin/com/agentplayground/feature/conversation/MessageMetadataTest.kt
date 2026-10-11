package com.agentplayground.feature.conversation

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.agentplayground.design.PlaygroundTheme
import com.agentplayground.domain.conversation.SessionState
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.RunRecord
import com.agentplayground.domain.model.SkillFile
import com.agentplayground.domain.presentation.conversationTurns
import com.agentplayground.domain.settings.AppPreferences
import com.agentplayground.feature.conversation.ui.timeline.AssistantTurnContent
import com.agentplayground.feature.conversation.ui.timeline.ConversationTimeline
import com.agui.core.types.*
import java.util.TimeZone
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w412dp-h892dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MessageMetadataTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `user and agent times use the local timezone and stay outside message content`() {
        val previous = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"))

        try {
            val state =
                SessionState(
                    "thread",
                    messages =
                        listOf(
                            UserMessage("user", "Question"),
                            AssistantMessage("answer", "Answer"),
                        ),
                    messageTimestamps =
                        mapOf("user" to "2026-10-11T02:30:00Z", "answer" to "2026-10-11T02:31:00Z"),
                )
            compose.setContent {
                PlaygroundTheme("light") {
                    ConversationTimeline(
                        state,
                        null,
                        AppPreferences(),
                        Modifier,
                        {},
                        { _, _ -> },
                        { _, _, _, _ -> },
                        {},
                        {},
                        {},
                        ::fileDownload,
                        ::documentDownload,
                        {},
                        false,
                    )
                }
            }

            compose.onNodeWithText("10-11 10:30").assertIsDisplayed()
            compose.onNodeWithText("10-11 10:31").assertIsDisplayed()
            compose.onNodeWithTag("copy-message-answer").performClick()
            val clipboard =
                RuntimeEnvironment.getApplication().getSystemService(Context.CLIPBOARD_SERVICE)
                    as ClipboardManager
            assertEquals("Answer", clipboard.primaryClip?.getItemAt(0)?.text?.toString())
        } finally {
            TimeZone.setDefault(previous)
        }
    }

    @Test
    fun `each answer copies its original Markdown without copying adjacent answers`() {
        val first =
            "**First answer**\n\n```kotlin\nval count = 2\n```\n\n| Name | Value |\n| --- | --- |\n| A | 2 |"
        val turn =
            conversationTurns(
                    listOf(
                        UserMessage("user", "Explain"),
                        AssistantMessage("first", first),
                        AssistantMessage("second", "Second answer"),
                    ),
                    listOf(RunRecord("run", "user", "completed")),
                )
                .single()

        compose.setContent {
            PlaygroundTheme("light") {
                AssistantTurnContent(turn, ::fileDownload, ::documentDownload, {}, {})
            }
        }

        compose.onNodeWithTag("copy-message-first").performClick()
        val clipboard =
            RuntimeEnvironment.getApplication().getSystemService(Context.CLIPBOARD_SERVICE)
                as ClipboardManager
        assertEquals(first, clipboard.primaryClip?.getItemAt(0)?.text?.toString())

        compose.onNodeWithTag("copy-message-second").performClick()
        assertEquals("Second answer", clipboard.primaryClip?.getItemAt(0)?.text?.toString())
    }

    @Test
    fun `copy becomes available when the reply finishes`() {
        var status by mutableStateOf("running")
        compose.setContent {
            val turn =
                conversationTurns(
                        listOf(
                            UserMessage("user", "Explain"),
                            AssistantMessage("answer", "Streaming answer"),
                        ),
                        listOf(RunRecord("run", "user", status)),
                    )
                    .single()
            PlaygroundTheme("dark") {
                AssistantTurnContent(turn, ::fileDownload, ::documentDownload, {}, {})
            }
        }

        compose.onNodeWithTag("copy-message-answer").assertIsNotEnabled()
        compose.runOnIdle { status = "completed" }
        compose.onNodeWithTag("copy-message-answer").assertIsEnabled().performClick()

        val clipboard =
            RuntimeEnvironment.getApplication().getSystemService(Context.CLIPBOARD_SERVICE)
                as ClipboardManager
        assertEquals("Streaming answer", clipboard.primaryClip?.getItemAt(0)?.text?.toString())
    }

    private fun fileDownload(file: SkillFile) = Download("/file/${file.id}", file.name)

    private fun documentDownload(id: String, name: String) = Download("/original/$id", name)
}

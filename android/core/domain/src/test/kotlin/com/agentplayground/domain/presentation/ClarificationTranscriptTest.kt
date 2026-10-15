package com.agentplayground.domain.presentation

import com.agentplayground.domain.model.RunRecord
import com.agui.core.types.*
import org.junit.Assert.*
import org.junit.Test

class ClarificationTranscriptTest {
    @Test
    fun `commentary questions committed answers and continuation keep message order after reload`() {
        val first = call("first")
        val second = call("second", arguments("scope", "What is the scope?"))
        val messages =
            listOf(
                AssistantMessage("intro", "A little context", toolCalls = listOf(first)),
                result(first),
                AssistantMessage("follow", "One more detail", toolCalls = listOf(second)),
                result(second, """{"answers":[{"id":"scope","answer":"Only the client"}]}"""),
                AssistantMessage("final", "I can continue now"),
            )

        val original = transcript(messages)
        val restored = transcript(messages.toList())

        assertEquals(original, restored)
        assertEquals(
            listOf(
                "reply:intro",
                "question:first",
                "answer:first",
                "reply:follow",
                "question:second",
                "answer:second",
                "reply:final",
            ),
            original.map { part ->
                when (part) {
                    is AssistantTranscriptPart.Reply -> "reply:${part.message.id}"
                    is AssistantTranscriptPart.Question -> "question:${part.callId}"
                    is AssistantTranscriptPart.Answer -> "answer:${part.callId}"
                }
            },
        )
        assertEquals(
            "Fast",
            original
                .filterIsInstance<AssistantTranscriptPart.Answer>()
                .first()
                .answers
                .single()
                .answer,
        )
    }

    @Test
    fun `interrupted complete arguments expose questions without inventing an answer`() {
        val parts =
            transcript(
                listOf(AssistantMessage("ask", toolCalls = listOf(call("ask")))),
                "interrupted",
            )

        val question = parts.single() as AssistantTranscriptPart.Question
        assertEquals("Choose an approach", question.questions.single().question)
        assertEquals(ClarificationStatus.Pending, question.status)
    }

    @Test
    fun `only exact successful committed answers create a human bubble`() {
        val ask = call("ask")
        val invalid =
            listOf(
                "{}",
                "{",
                "[]",
                """{"answers":[]}""",
                """{"answers":[{"id":"other","answer":"Fast"}]}""",
                """{"answers":[{"id":"goal","answer":"Fast"},{"id":"goal","answer":"Fast"}]}""",
                """{"answers":[{"id":"goal","answer":" "}]}""",
                """{"answers":[{"id":"goal","answer":3}]}""",
                """{"answers":[{"id":"goal","answer":"Fast","extra":true}]}""",
                """{"answers":[{"id":"goal","answer":"Fast"}],"extra":true}""",
                """{"answers":[{"id":"goal","answer":"${"x".repeat(4001)}"}]}""",
            )

        for (content in invalid) {
            val parts =
                transcript(
                    listOf(AssistantMessage("ask", toolCalls = listOf(ask)), result(ask, content))
                )
            assertTrue(content, parts.none { it is AssistantTranscriptPart.Answer })
            assertEquals(
                ClarificationStatus.Unavailable,
                (parts.single() as AssistantTranscriptPart.Question).status,
            )
        }

        val failed = result(ask).copy(error = "Execution failed")
        val parts = transcript(listOf(AssistantMessage("ask", toolCalls = listOf(ask)), failed))
        assertTrue(parts.none { it is AssistantTranscriptPart.Answer })
        assertEquals(
            ClarificationStatus.Failed,
            (parts.single() as AssistantTranscriptPart.Question).status,
        )
    }

    @Test
    fun `official rejected tool messages are declined without echoing generic error content`() {
        val ask = call("ask")
        val rejections =
            listOf(
                "User rejected the tool call for `ask_user` with reason: Not now",
                "User rejected the tool call for `ask_user` with id ask. The tool was not executed. Do not retry this tool call unless the user explicitly requests it.",
            )

        for (content in rejections) {
            val parts =
                transcript(
                    listOf(
                        AssistantMessage("ask", toolCalls = listOf(ask)),
                        result(ask, content).copy(error = content),
                    )
                )
            assertEquals(
                ClarificationStatus.Declined,
                (parts.single() as AssistantTranscriptPart.Question).status,
            )
            assertTrue(parts.none { it is AssistantTranscriptPart.Answer })
        }

        val wrongCall = rejections.last().replace("with id ask.", "with id other.")
        val parts =
            transcript(
                listOf(
                    AssistantMessage("ask", toolCalls = listOf(ask)),
                    result(ask, wrongCall).copy(error = wrongCall),
                )
            )
        assertEquals(
            ClarificationStatus.Failed,
            (parts.single() as AssistantTranscriptPart.Question).status,
        )
    }

    @Test
    fun `partial malformed and duplicate question ids stay readable without raw arguments`() {
        val malformed =
            listOf(
                "{",
                "{}",
                """{"questions":[{"id":"goal","question":"Visible"},{"id":"goal","question":"Duplicate"}]}""",
            )

        for (arguments in malformed) {
            val ask = call("ask", arguments)
            val pending =
                transcript(listOf(AssistantMessage("ask", toolCalls = listOf(ask))), "interrupted")
                    .single() as AssistantTranscriptPart.Question
            assertTrue(pending.questions.isEmpty())
            assertEquals(ClarificationStatus.Pending, pending.status)
            val finished =
                transcript(listOf(AssistantMessage("ask", toolCalls = listOf(ask)), result(ask)))
                    .single() as AssistantTranscriptPart.Question
            assertTrue(finished.questions.isEmpty())
            assertEquals(ClarificationStatus.Unavailable, finished.status)
        }
    }

    @Test
    fun `multi question answers preserve the exact question order and ids`() {
        val ask =
            call(
                "ask",
                """{"questions":[{"id":"goal","question":"First?"},{"id":"scope","question":"Second?"}]}""",
            )
        val response =
            result(
                ask,
                """{"answers":[{"id":"goal","answer":"Fast"},{"id":"scope","answer":"Custom answer"}]}""",
            )

        val answer =
            transcript(listOf(AssistantMessage("ask", toolCalls = listOf(ask)), response))
                .filterIsInstance<AssistantTranscriptPart.Answer>()
                .single()

        assertEquals(listOf("goal", "scope"), answer.answers.map { it.question.id })
        assertEquals(listOf("Fast", "Custom answer"), answer.answers.map { it.answer })
    }

    @Test
    fun `reordered result ids cannot become attributed human answers or expose raw payloads`() {
        val ask =
            call(
                "ask",
                """{"questions":[{"id":"goal","question":"First?"},{"id":"scope","question":"Second?"}]}""",
            )
        val response =
            result(
                ask,
                """{"answers":[{"id":"scope","answer":"Private custom answer"},{"id":"goal","answer":"Fast"}]}""",
            )

        val parts = transcript(listOf(AssistantMessage("ask", toolCalls = listOf(ask)), response))

        assertTrue(parts.none { it is AssistantTranscriptPart.Answer })
        val question = parts.single() as AssistantTranscriptPart.Question
        assertEquals(ClarificationStatus.Unavailable, question.status)
        assertEquals(listOf("First?", "Second?"), question.questions.map { it.question })
        assertFalse(parts.toString().contains("Private custom answer"))
        assertFalse(parts.toString().contains(response.content))
    }

    @Test
    fun `ask calls never enter ordinary execution summaries even with invalid arguments`() {
        val ask = call("ask", "{")
        val ordinary = ToolCall("sum", FunctionCall("calculate_sum", "{}"))
        val turn = turn(listOf(AssistantMessage("caller", toolCalls = listOf(ask, ordinary))))

        assertEquals(
            listOf("sum"),
            executionGroups(turn.toolCalls).single().steps.map { it.call.id },
        )
        assertEquals(
            1,
            assistantTranscript(turn).filterIsInstance<AssistantTranscriptPart.Question>().size,
        )
    }

    @Test
    fun `duplicate results and reused call identities cannot fabricate or duplicate answers`() {
        val ask = call("ask")
        val response = result(ask)
        val caller = AssistantMessage("caller", toolCalls = listOf(ask))
        val duplicates =
            listOf(
                listOf(caller, response, response.copy(id = "second-result")),
                listOf(caller, caller.copy(id = "duplicate-caller"), response),
                listOf(caller, response.copy(toolCallId = "other")),
            )

        for (messages in duplicates) {
            val parts = transcript(messages)
            assertEquals(1, parts.filterIsInstance<AssistantTranscriptPart.Question>().size)
            assertTrue(parts.none { it is AssistantTranscriptPart.Answer })
        }
    }

    private fun transcript(messages: List<Message>, status: String = "completed") =
        assistantTranscript(turn(messages, status))

    private fun turn(messages: List<Message>, status: String = "completed") =
        conversationTurns(
                listOf(UserMessage("user", "Start")) + messages,
                listOf(RunRecord("run", "user", status)),
            )
            .last()

    private fun call(id: String, args: String = arguments()) =
        ToolCall(id, FunctionCall("ask_user", args))

    private fun result(
        call: ToolCall,
        content: String = """{"answers":[{"id":"goal","answer":"Fast"}]}""",
    ) = ToolMessage("result-${call.id}", content, call.id)

    private fun arguments(id: String = "goal", question: String = "Choose an approach") =
        """{"questions":[{"id":"$id","question":"$question"}]}"""
}

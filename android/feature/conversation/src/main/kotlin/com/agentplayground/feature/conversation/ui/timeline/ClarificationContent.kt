package com.agentplayground.feature.conversation.ui.timeline

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.agentplayground.domain.presentation.AssistantTranscriptPart
import com.agentplayground.domain.presentation.ClarificationStatus

@Composable
internal fun ClarificationQuestionContent(part: AssistantTranscriptPart.Question) {
    val status =
        when (part.status) {
            ClarificationStatus.Pending ->
                if (part.questions.isEmpty()) "Preparing a question…" else "Waiting for your answer"
            ClarificationStatus.Declined -> "Question skipped"
            ClarificationStatus.Failed -> "Question could not be completed"
            ClarificationStatus.Unavailable -> "Question unavailable"
            ClarificationStatus.Answered -> null
        }

    SelectionContainer {
        Column(
            Modifier.fillMaxWidth().testTag("clarification-question-${part.callId}"),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            part.questions.forEach { question ->
                Text(question.question, style = MaterialTheme.typography.bodyLarge)
            }
            status?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
internal fun ClarificationAnswerContent(part: AssistantTranscriptPart.Answer, timestamp: String?) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Surface(
            Modifier.widthIn(max = 560.dp).testTag("clarification-answer-${part.callId}"),
            shape =
                RoundedCornerShape(
                    topStart = 18.dp,
                    topEnd = 18.dp,
                    bottomStart = 18.dp,
                    bottomEnd = 6.dp,
                ),
            color = MaterialTheme.colorScheme.surfaceContainerHighest,
            contentColor = MaterialTheme.colorScheme.onSurface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            SelectionContainer {
                Column(
                    Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    part.answers.forEach { answer ->
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                answer.question.question,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                answer.answer,
                                style =
                                    MaterialTheme.typography.bodyLarge.copy(
                                        fontWeight = FontWeight.Medium
                                    ),
                            )
                        }
                    }
                }
            }
        }
        MessageTimestamp(timestamp, Modifier.padding(end = 6.dp))
    }
}

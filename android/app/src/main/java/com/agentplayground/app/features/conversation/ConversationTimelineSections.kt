package com.agentplayground.app.features.conversation

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.agentplayground.app.design.*
import com.agentplayground.app.features.workflow.*
import com.agentplayground.app.files.Download
import com.agentplayground.core.*

@Composable
internal fun TimelineTurnContent(
    row: ConversationTimelineTurn,
    renderer: WorkflowRenderer,
    fileDownload: (SkillFile) -> Download,
    documentDownload: (String, String) -> Download,
    onDownload: (Download) -> Unit,
    onLink: (String) -> Unit,
    reviews: @Composable () -> Unit,
    externalTaskControls: Map<String, ExternalTaskControl> = emptyMap(),
    onSubmitExternalTaskInput: (String, String) -> Unit = { _, _ -> },
    onCancelExternalTask: (String) -> Unit = {},
) {
    AssistantTurnContent(
        row.turn,
        fileDownload,
        documentDownload,
        onDownload,
        onLink,
        processDetails = {
            if (row.previousSurfaceIds.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        "Previous workflow steps",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    row.previousSurfaceIds.forEach { WorkflowSurface(renderer, it) }
                }
            }
        },
    ) {
        row.tasks.forEach { task ->
            key(task.taskId) {
                ExternalTaskPanel(
                    task,
                    control = externalTaskControls[task.taskId] ?: ExternalTaskControl(),
                    onSubmitInput = onSubmitExternalTaskInput,
                    onCancel = onCancelExternalTask,
                    onLink = onLink,
                )
            }
        }
        row.presentations.forEach { WorkflowPresentation(it, renderer) }
        row.legacySurfaces.forEach { WorkflowSurface(renderer, it.id) }

        if (row.hasReviews) {
            reviews()
        }
    }
}

@Composable
internal fun TimelineNotices(
    state: SessionState,
    errors: List<String>,
    visible: Boolean,
    onRecover: () -> Unit,
) {
    val completingWorkflow =
        state.externalTasks.any {
            it.status in setOf("succeeded", "failed", "cancelled") &&
                it.continuationStatus in setOf("prepared", "dispatching", "running")
        }
    val needsRecovery =
        errors.isNotEmpty() ||
            state.missingOutputSequence != null ||
            state.runs.lastOrNull()?.status == "submission_unknown"
    // Server-owned continuations have no client output stream. That alone is normal execution,
    // not evidence of a disconnected request or an uncertain submission.
    val progress =
        when {
            state.streaming -> "Agent is responding…"
            needsRecovery -> "Recovering agent progress…"
            completingWorkflow -> "Agent is completing the workflow…"
            else -> "Agent is working…"
        }

    Reveal(visible) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Reveal(state.loading) { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            RevealValue(state.missingOutputSequence) { sequence ->
                Text(
                    "Recovering missing workflow output $sequence…",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            RevealValue(errors.takeIf { it.isNotEmpty() }) { visibleErrors ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    visibleErrors.forEach { ErrorNotice(it, onRecover) }
                }
            }
            Reveal(state.busy) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    ChangingContent(progress) { label ->
                        Text(
                            label,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun TimelineWelcome(compactHeight: Boolean, onSuggestion: (String) -> Unit) {
    Column(
        Modifier.widthIn(max = 560.dp)
            .fillMaxWidth()
            .padding(top = if (compactHeight) 0.dp else 44.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        if (!compactHeight) {
            AgentMark()
        }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                if (compactHeight) {
                    "What can I help with today?"
                } else {
                    "What can I help\nwith today?"
                },
                style =
                    if (compactHeight) {
                        MaterialTheme.typography.headlineSmall
                    } else {
                        MaterialTheme.typography.headlineLarge
                    },
            )
            Text(
                "Explore an idea, work with your documents, or turn a task into a plan.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyLarge,
            )
        }
        Column(
            Modifier.padding(top = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SuggestionRow(
                Icons.Outlined.Lightbulb,
                "Explore an idea",
                "Help me think through an idea and its next steps.",
                onSuggestion,
            )
            SuggestionRow(
                Icons.Outlined.Description,
                "Ask your knowledge base",
                "Search my knowledge base and summarize the key points.",
                onSuggestion,
            )
            SuggestionRow(
                Icons.Outlined.Checklist,
                "Make a plan",
                "Create an experiment plan for a task I describe.",
                onSuggestion,
            )
            SuggestionRow(
                Icons.Outlined.GroupWork,
                "Collaborate with agents",
                "Use run_a2a_workflow to have agents plan, review, and revise an order analysis proposal.",
                onSuggestion,
            )
        }
    }
}

@Composable
internal fun WorkflowPresentation(
    current: WorkflowOutput,
    renderer: WorkflowRenderer,
) {
    val presentation = current.workflow!!.presentation!!

    ChangingContent(presentation.surfaceId) { surface -> WorkflowSurface(renderer, surface) }
}

@Composable
private fun SuggestionRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    prompt: String,
    onSelect: (String) -> Unit,
) {
    OutlinedCard(
        onClick = { onSelect(prompt) },
        modifier = Modifier.fillMaxWidth(),
        colors =
            CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
        border =
            androidx.compose.foundation.BorderStroke(
                1.dp,
                MaterialTheme.colorScheme.outlineVariant,
            ),
    ) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                icon,
                null,
                Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Icon(
                Icons.Outlined.NorthEast,
                null,
                Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

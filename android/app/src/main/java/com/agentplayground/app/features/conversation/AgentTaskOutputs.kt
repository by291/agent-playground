package com.agentplayground.app.features.conversation

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.agentplayground.app.design.DisclosureChevron
import com.agentplayground.app.design.Reveal
import com.agentplayground.app.design.StatusTag
import com.agentplayground.core.AgentOutput
import com.agentplayground.core.ExternalTask
import com.agentplayground.core.isExternalTaskActive

private data class CollaborationStep(
    val id: String,
    val title: String,
    val agent: String,
    val handoff: String,
    val purpose: String,
)

private val collaborationSteps =
    listOf(
        CollaborationStep(
            "plan",
            "Draft",
            "Planner",
            "Coordinator → Planner",
            "Create the first draft.",
        ),
        CollaborationStep(
            "review",
            "Review",
            "Reviewer",
            "Planner → Reviewer",
            "Review Planner's draft.",
        ),
        CollaborationStep(
            "revise",
            "Revision",
            "Planner",
            "Reviewer → Planner",
            "Revise using Reviewer's feedback.",
        ),
    )

@Composable
internal fun AgentTaskOutputs(task: ExternalTask, onLink: (String) -> Unit) {
    val lastPartial = task.outputs.lastOrNull { it.text.isNotBlank() }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "Coordinator dispatches each handoff between the agents.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        collaborationSteps.forEachIndexed { index, step ->
            key(task.taskId, step.id) {
                AgentStepOutput(
                    task,
                    step,
                    index,
                    task.outputs.lastOrNull { it.step == step.id },
                    lastPartial,
                    onLink,
                )
            }
        }
    }
}

@Composable
private fun AgentStepOutput(
    task: ExternalTask,
    step: CollaborationStep,
    index: Int,
    output: AgentOutput?,
    lastPartial: AgentOutput?,
    onLink: (String) -> Unit,
) {
    var chosenExpanded by rememberSaveable(task.taskId, step.id) { mutableStateOf<Boolean?>(null) }
    val terminal = !isExternalTaskActive(task.status)
    val active = output != null && isExternalTaskActive(output.status)
    val showResult = output != null && (step.id == "revise" || (terminal && output == lastPartial))
    val expanded = chosenExpanded ?: (active || showResult)
    val agent = output?.agent ?: step.agent
    val label =
        output?.let { agentStatusLabel(it.status) } ?: if (terminal) "Not started" else "Pending"
    val heading: @Composable RowScope.() -> Unit = {
        Text(
            "${index + 1}. ${step.title} · $agent",
            Modifier.weight(1f),
            style = MaterialTheme.typography.titleSmall,
        )
        StatusTag(label, emphasis = output?.status == "succeeded")

        if (output != null) {
            DisclosureChevron(expanded)
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (output != null) {
            TextButton(
                onClick = { chosenExpanded = !expanded },
                modifier =
                    Modifier.fillMaxWidth().semantics {
                        stateDescription = if (expanded) "Expanded" else "Collapsed"
                    },
                contentPadding = PaddingValues(vertical = 8.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    content = heading,
                )
            }
        } else {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                content = heading,
            )
        }

        Text(
            step.handoff,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            step.purpose,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (output != null) {
            Reveal(expanded) {
                if (output.text.isNotEmpty()) {
                    Markdown(output.text, onLink, settled = terminal || !active)
                } else {
                    Text(
                        "Waiting for agent output…",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private fun agentStatusLabel(status: String) =
    when (status) {
        "queued" -> "Queued"
        "running" -> "Working"
        "input_required" -> "Needs input"
        "succeeded" -> "Completed"
        "failed" -> "Failed"
        "cancelled" -> "Cancelled"
        else -> status
    }

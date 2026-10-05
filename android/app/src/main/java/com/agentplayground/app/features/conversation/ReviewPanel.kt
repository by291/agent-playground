package com.agentplayground.app.features.conversation

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.agentplayground.core.*
import com.agui.core.types.Interrupt

@Composable
fun ReviewPanel(
    interrupt: Interrupt,
    busy: Boolean,
    decision: String?,
    draft: PlanDraft?,
    onEdit: (String, PlanDraft) -> Unit,
    onReview: (String, String, PlanDraft?) -> Unit,
) {
    val review = Review.from(interrupt)
    if (review == null) {
        val raw =
            (interrupt.metadata as? kotlinx.serialization.json.JsonObject)?.get("langgraph")
                as? kotlinx.serialization.json.JsonObject
        val external =
            (raw?.get("raw") as? kotlinx.serialization.json.JsonObject)?.string("kind") ==
                "workflow_external_wait"
        Text(
            if (external) {
                "Waiting for an external task. You can return later."
            } else {
                interrupt.message
                    ?: "This conversation is paused. This response type is not supported."
            },
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }

    val plan = draft ?: PlanDraft(review.title, review.steps)
    val title = plan.title
    val steps = plan.steps.joinToString("\n")

    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(review.title, style = MaterialTheme.typography.titleMedium)
            if (review.kind == "experiment_plan_review") {
                OutlinedTextField(
                    title,
                    { onEdit(interrupt.id, plan.copy(title = it)) },
                    label = { Text("Plan title") },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy,
                )
                OutlinedTextField(
                    steps,
                    { onEdit(interrupt.id, plan.copy(steps = it.lines())) },
                    label = { Text("Steps (one per line)") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    enabled = !busy,
                )
                decision?.let {
                    Text(
                        "Decision: $it. Waiting for the remaining plans.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            } else {
                review.steps.forEachIndexed { index, step -> Text("${index + 1}. $step") }
            }
            review.blockedReason?.let {
                Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (review.expired) {
                Text(
                    "This review has expired. Refresh the conversation.",
                    color = MaterialTheme.colorScheme.error,
                )
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (review.kind == "workflow_review") {
                    Button(
                        onClick = { onReview(interrupt.id, "accept", null) },
                        enabled = !busy && review.canAccept && !review.expired,
                    ) {
                        Text(review.acceptLabel)
                    }
                    OutlinedButton(
                        onClick = { onReview(interrupt.id, "abandon", null) },
                        enabled = !busy && !review.expired,
                    ) {
                        Text("Abandon")
                    }
                } else {
                    Button(
                        onClick = { onReview(interrupt.id, "approve", plan) },
                        enabled =
                            !busy &&
                                !review.expired &&
                                title.isNotBlank() &&
                                plan.steps.isNotEmpty() &&
                                plan.steps.none { it.isBlank() },
                    ) {
                        Text("Approve")
                    }
                    OutlinedButton(
                        onClick = { onReview(interrupt.id, "reject", plan) },
                        enabled = !busy && !review.expired,
                    ) {
                        Text("Reject")
                    }
                }
            }
            if (review.kind == "workflow_review") {
                Text(
                    "Use the message field to ask questions or request changes.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
fun ExternalTaskPanel(task: ExternalTask) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(task.label, style = MaterialTheme.typography.titleSmall)
            Text(
                "${task.status} · ${task.stage}",
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.labelMedium,
            )
            Text(task.message)
            task.progress?.let { progress ->
                LinearProgressIndicator(
                    progress = { (progress / 100).toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("${progress.toInt()}%", style = MaterialTheme.typography.labelMedium)
            }
            task.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (task.continuationStatus in setOf("submission_unknown", "failed")) {
                Text("The task finished, but workflow continuation requires reconciliation.")
            }
            com.agentplayground.app.design.Details("Task history") {
                task.history.forEach { Text(it.string("message").orEmpty()) }
            }
        }
    }
}

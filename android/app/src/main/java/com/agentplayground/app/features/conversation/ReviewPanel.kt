package com.agentplayground.app.features.conversation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.agentplayground.app.design.SectionCard
import com.agentplayground.app.design.StatusTag
import com.agentplayground.core.*
import com.agui.core.types.Interrupt

@Composable
fun PlanReviewPanel(
    interrupts: List<Interrupt>,
    busy: Boolean,
    decisions: Map<String, String>,
    drafts: Map<String, PlanDraft>,
    onEdit: (String, PlanDraft) -> Unit,
    onReview: (String, String, PlanDraft?) -> Unit,
    onContinue: () -> Unit,
) {
    val reviews = interrupts.mapNotNull(Review::from)
    val canContinue =
        reviews.size == interrupts.size &&
            reviews.size > 1 &&
            reviews.all { review ->
                val draft = drafts[review.interrupt.id] ?: PlanDraft(review.title, review.steps)
                val decision = decisions[review.interrupt.id]
                review.kind == "experiment_plan_review" &&
                    !review.expired &&
                    (decision == "reject" || (decision == "approve" && draft.canApprove))
            }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        interrupts.forEach { interrupt ->
            ReviewContent(
                interrupt,
                busy,
                decisions[interrupt.id],
                drafts[interrupt.id],
                onEdit,
                onReview,
                multiple = true,
            )
        }
        Text(
            "Choose a decision for every plan before continuing.",
            style = MaterialTheme.typography.bodySmall,
        )
        Button(onClick = onContinue, enabled = !busy && canContinue) {
            Text(if (busy) "Continuing…" else "Continue workflow")
        }
    }
}

@Composable
fun ReviewPanel(
    interrupt: Interrupt,
    busy: Boolean,
    decision: String?,
    draft: PlanDraft?,
    onEdit: (String, PlanDraft) -> Unit,
    onReview: (String, String, PlanDraft?) -> Unit,
) {
    ReviewContent(interrupt, busy, decision, draft, onEdit, onReview, multiple = false)
}

@Composable
private fun ReviewContent(
    interrupt: Interrupt,
    busy: Boolean,
    decision: String?,
    draft: PlanDraft?,
    onEdit: (String, PlanDraft) -> Unit,
    onReview: (String, String, PlanDraft?) -> Unit,
    multiple: Boolean,
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

    SectionCard {
        StatusTag("Your review", emphasis = true)
        Text(review.title, style = MaterialTheme.typography.titleMedium)
        if (review.kind == "experiment_plan_review") {
            OutlinedTextField(
                title,
                { onEdit(interrupt.id, plan.copy(title = it)) },
                label = { Text("Plan title") },
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && !review.expired,
                isError = title.isBlank(),
                supportingText = {
                    if (title.isBlank()) {
                        Text("Enter a title to approve this plan.")
                    }
                },
            )
            OutlinedTextField(
                steps,
                { onEdit(interrupt.id, plan.copy(steps = it.lines())) },
                label = { Text("Steps (one per line)") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                enabled = !busy && !review.expired,
                isError = plan.steps.none { it.isNotBlank() },
                supportingText = {
                    if (plan.steps.none { it.isNotBlank() }) {
                        Text("Enter at least one step to approve this plan.")
                    }
                },
            )
            decision?.let {
                Text(
                    if (it == "approve") "Approval selected" else "Rejection selected",
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
            } else if (multiple) {
                Row(
                    modifier =
                        Modifier.selectable(
                            selected = decision == "approve",
                            enabled = !busy && !review.expired && plan.canApprove,
                            role = Role.RadioButton,
                            onClick = { onReview(interrupt.id, "approve", plan) },
                        ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(
                        selected = decision == "approve",
                        onClick = null,
                        enabled = !busy && !review.expired && plan.canApprove,
                    )
                    Text("Approve plan")
                }
                Row(
                    modifier =
                        Modifier.selectable(
                            selected = decision == "reject",
                            enabled = !busy && !review.expired,
                            role = Role.RadioButton,
                            onClick = { onReview(interrupt.id, "reject", plan) },
                        ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(
                        selected = decision == "reject",
                        onClick = null,
                        enabled = !busy && !review.expired,
                    )
                    Text("Reject")
                }
            } else {
                Button(
                    onClick = { onReview(interrupt.id, "approve", plan) },
                    enabled = !busy && !review.expired && plan.canApprove,
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

@Composable
fun ExternalTaskPanel(task: ExternalTask) {
    SectionCard {
        Text(task.label, style = MaterialTheme.typography.titleMedium)
        StatusTag("${task.status} · ${task.stage}", emphasis = task.status == "succeeded")
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

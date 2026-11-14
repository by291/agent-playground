package com.agentplayground.feature.conversation.ui.timeline

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.agentplayground.domain.model.isActiveRun
import com.agentplayground.domain.presentation.AgentPlan
import com.agentplayground.domain.presentation.AgentPlanItem
import com.agentplayground.domain.presentation.AgentPlanStatus

/** Read-only committed plan; lifecycle changes activity labels, never canonical task statuses. */
@Composable
internal fun AgentPlanContent(plan: AgentPlan, runStatus: String?, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme

    OutlinedCard(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.outlinedCardColors(containerColor = colors.surface),
        border = BorderStroke(1.dp, colors.outlineVariant),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    "Agent plan",
                    Modifier.semantics { heading() },
                    style = MaterialTheme.typography.labelLarge,
                )
                Text(
                    "${plan.completedCount} of ${plan.items.size} completed",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.onSurfaceVariant,
                )
            }

            plan.items.forEach { item -> PlanItemContent(item, runStatus) }
        }
    }
}

@Composable
private fun PlanItemContent(item: AgentPlanItem, runStatus: String?) {
    val icon =
        when (item.status) {
            AgentPlanStatus.Completed -> Icons.Outlined.Check
            AgentPlanStatus.InProgress -> Icons.Outlined.MoreHoriz
            AgentPlanStatus.Pending -> Icons.Outlined.RadioButtonUnchecked
        }
    val status =
        when (item.status) {
            AgentPlanStatus.Completed -> "Completed"
            // An unfinished item is only actively executing while its enclosing run is active.
            AgentPlanStatus.InProgress ->
                when {
                    isActiveRun(runStatus) -> "In progress"
                    runStatus == "interrupted" -> "Paused"
                    else -> "Not completed"
                }

            AgentPlanStatus.Pending -> "Pending"
        }
    val colors = MaterialTheme.colorScheme

    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(icon, null, Modifier.size(20.dp), tint = colors.onSurfaceVariant)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            SelectionContainer {
                Text(item.content, style = MaterialTheme.typography.bodyMedium)
            }
            Text(
                status,
                style = MaterialTheme.typography.labelSmall,
                color = colors.onSurfaceVariant,
            )
        }
    }
}

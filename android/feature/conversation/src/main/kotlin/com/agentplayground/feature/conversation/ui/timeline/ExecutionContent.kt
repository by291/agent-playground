package com.agentplayground.feature.conversation.ui.timeline

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.agentplayground.core.model.isReasoning
import com.agentplayground.core.model.protocolJson
import com.agentplayground.core.presentation.ConversationTurn
import com.agentplayground.core.presentation.ExecutionGroup
import com.agentplayground.core.presentation.ToolStatus
import com.agentplayground.core.presentation.ToolStep
import com.agentplayground.core.presentation.reasoningPhase
import com.agentplayground.core.presentation.skillIdentity
import com.agentplayground.feature.conversation.ui.markdown.Markdown
import com.agentplayground.ui.ChangingContent
import com.agentplayground.ui.DisclosureChevron
import com.agentplayground.ui.Motion
import com.agentplayground.ui.R
import com.agentplayground.ui.Reveal
import com.agentplayground.ui.RevealValue
import com.agui.core.types.*
import kotlinx.serialization.json.Json

@Composable
internal fun ReasoningContent(
    turn: ConversationTurn,
    active: Boolean,
    answerVisible: Boolean,
    onLink: (String) -> Unit,
) {
    val phase = reasoningPhase(turn.messages, answerVisible)
    val automaticOpen = active && phase.startsWith("reasoning-")
    var savedPhase by rememberSaveable(turn.id) { mutableStateOf(phase) }
    var open by rememberSaveable(turn.id) { mutableStateOf(automaticOpen) }

    if (savedPhase != phase) {
        savedPhase = phase
        open = automaticOpen
    }

    val thinking = active && turn.messages.lastOrNull()?.let(::isReasoning) == true

    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.disclosure(open) { open = !open },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ChangingContent(thinking, Modifier.size(18.dp)) { isThinking ->
                if (isThinking) {
                    ProcessSpinner()
                } else {
                    Icon(
                        Icons.Outlined.Psychology,
                        null,
                        Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            ChangingContent(thinking) { isThinking ->
                Text(
                    if (isThinking) "Thinking" else "Reasoning",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DisclosureChevron(open)
        }
        Reveal(open) {
            ProcessBody(Modifier.testTag("reasoning-content-${turn.id}")) {
                turn.messages
                    .filter { isReasoning(it) && !it.content.isNullOrBlank() }
                    .forEach {
                        Markdown(it.content.orEmpty(), onLink, settled = !active, subdued = true)
                    }
            }
        }
    }
}

@Composable
internal fun ToolGroupContent(
    group: ExecutionGroup,
    processDetails: @Composable () -> Unit = {},
) {
    val identity = group.steps.first().call.id
    var expanded by rememberSaveable(identity) { mutableStateOf(false) }

    val states = group.steps.map { it.status }.toSet()
    val status =
        when {
            ToolStatus.Failed in states -> ToolStatus.Failed
            ToolStatus.Waiting in states -> ToolStatus.Waiting
            ToolStatus.Paused in states -> ToolStatus.Paused
            ToolStatus.Running in states -> ToolStatus.Running
            ToolStatus.Unavailable in states -> ToolStatus.Unavailable
            else -> ToolStatus.Completed
        }
    val name =
        group.skill?.name
            ?: if (group.steps.size == 1) {
                group.steps.first().call.function.name
            } else {
                "${group.steps.size} tools"
            }
    val error = group.steps.firstNotNullOfOrNull { it.result?.error?.takeIf(String::isNotBlank) }
    val colors = MaterialTheme.colorScheme

    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.disclosure(expanded) { expanded = !expanded }.testTag("tool-group-$identity"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ChangingContent(status to (ToolStatus.Running in states), Modifier.size(18.dp)) {
                (currentStatus, running) ->
                when {
                    running -> ProcessSpinner()
                    currentStatus == ToolStatus.Failed ->
                        Icon(
                            Icons.Outlined.ErrorOutline,
                            null,
                            Modifier.size(18.dp),
                            tint = colors.error,
                        )

                    group.skill != null ->
                        Icon(
                            painterResource(R.drawable.ic_agent_mark),
                            null,
                            Modifier.size(18.dp),
                            tint = colors.onSurfaceVariant,
                        )

                    else ->
                        Icon(
                            Icons.Outlined.Build,
                            null,
                            Modifier.size(18.dp),
                            tint = colors.onSurfaceVariant,
                        )
                }
            }
            Surface(
                shape = MaterialTheme.shapes.extraSmall,
                color = androidx.compose.ui.graphics.Color.Transparent,
                border = BorderStroke(1.dp, colors.outlineVariant),
            ) {
                Text(
                    if (group.skill == null) "Tool" else "Skill",
                    Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.onSurfaceVariant,
                )
            }
            FlowRow(
                Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                Text(name, style = MaterialTheme.typography.labelLarge)
                ExecutionStatus(status)
            }
            DisclosureChevron(expanded)
        }
        // Failures remain visible even when diagnostic payloads are folded away.
        RevealValue(error) { ExecutionError(it) }
        Reveal(expanded) {
            ProcessBody {
                group.steps.forEach { step -> key(step.call.id) { ToolDetails(step) } }
                processDetails()
            }
        }
    }
}

@Composable
private fun ToolDetails(step: ToolStep) {
    var expanded by rememberSaveable(step.call.id) { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.disclosure(expanded) { expanded = !expanded }
                .testTag("tool-step-${step.call.id}"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ToolStatusIcon(step.status)
            Text(
                skillIdentity(step)?.path ?: toolLabel(step.call.function.name),
                Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
            )
            ExecutionStatus(step.status, Modifier.widthIn(max = 100.dp))
            DisclosureChevron(expanded)
        }
        Reveal(expanded) {
            Column(
                Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        "Tool",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    SelectionContainer {
                        Text(
                            step.call.function.name,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                }
                PayloadPanel(
                    "Parameters",
                    step.call.function.arguments.ifBlank { "Waiting for parameters…" },
                )
                PayloadPanel(
                    "Result",
                    step.result?.content?.ifBlank { "Empty result" } ?: statusLabel(step.status),
                )
            }
        }
    }
}

private fun Modifier.disclosure(expanded: Boolean, onToggle: () -> Unit): Modifier =
    this.fillMaxWidth()
        .semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" }
        .clickable(role = Role.Button, onClick = onToggle)
        .heightIn(min = 48.dp)
        .padding(horizontal = 8.dp, vertical = 8.dp)

@Composable
private fun ProcessBody(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val line = MaterialTheme.colorScheme.outlineVariant

    Column(
        modifier
            .fillMaxWidth()
            .padding(start = 8.dp)
            .drawBehind { drawLine(line, Offset.Zero, Offset(0f, size.height), 1.dp.toPx()) }
            .padding(start = 12.dp, top = 4.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

@Composable
private fun ProcessSpinner() {
    CircularProgressIndicator(
        Modifier.size(16.dp),
        strokeWidth = 1.5.dp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun ToolStatusIcon(status: ToolStatus) {
    ChangingContent(status, Modifier.size(16.dp)) { current ->
        val icon: ImageVector =
            when (current) {
                ToolStatus.Completed -> Icons.Outlined.Check
                ToolStatus.Paused,
                ToolStatus.Waiting -> Icons.Outlined.Schedule
                else -> Icons.Outlined.ErrorOutline
            }

        if (current == ToolStatus.Running) {
            ProcessSpinner()
        } else {
            Icon(
                icon,
                null,
                Modifier.size(16.dp),
                tint =
                    if (current == ToolStatus.Failed) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
            )
        }
    }
}

@Composable
private fun ExecutionStatus(status: ToolStatus, modifier: Modifier = Modifier) {
    val color by
        animateColorAsState(
            if (status == ToolStatus.Failed) {
                MaterialTheme.colorScheme.error
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            Motion.feedback(),
            label = "execution-status",
        )

    ChangingContent(status, modifier) { current ->
        Text(statusLabel(current), style = MaterialTheme.typography.bodySmall, color = color)
    }
}

private fun statusLabel(status: ToolStatus): String =
    when (status) {
        ToolStatus.Paused -> "Waiting for review"
        ToolStatus.Waiting -> "Waiting for external task"
        ToolStatus.Unavailable -> "Result unavailable"
        else -> status.name
    }

private fun toolLabel(name: String): String =
    when (name) {
        "search_knowledge" -> "Search knowledge"
        "load_skill" -> "Load a Skill"
        "read_skill_file" -> "Read a Skill file"
        "run_skill_script" -> "Run a Skill script"
        "get_current_time" -> "Check the time"
        "calculate_sum" -> "Calculate a sum"
        "run_experiment_workflow" -> "Build an experiment plan"
        "run_sql_workflow" -> "Review SQL"
        "run_report_workflow" -> "Generate report"
        "run_a2a_workflow" -> "A2A collaboration"
        else -> name.replace('_', ' ').replaceFirstChar { it.uppercase() }
    }

@Composable
private fun ExecutionError(message: String) {
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        shape = MaterialTheme.shapes.extraSmall,
    ) {
        SelectionContainer {
            Text(
                message,
                Modifier.fillMaxWidth().padding(10.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
        }
    }
}

@Composable
internal fun ToolResultContent(message: ToolMessage) {
    message.error?.takeIf(String::isNotBlank)?.let { ExecutionError(it) }

    if (message.content.isNotEmpty()) {
        PayloadPanel("Result", message.content)
    }
}

private val payloadJson = Json(protocolJson) { prettyPrint = true }

@Composable
private fun PayloadPanel(label: String, value: String) {
    val formatted =
        remember(value) {
            runCatching {
                    payloadJson.encodeToString(
                        kotlinx.serialization.json.JsonElement.serializer(),
                        protocolJson.parseToJsonElement(value),
                    )
                }
                .getOrDefault(value)
        }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Surface(
            Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.extraSmall,
            color = MaterialTheme.colorScheme.surfaceContainer,
        ) {
            SelectionContainer {
                Text(
                    formatted,
                    Modifier.fillMaxWidth()
                        .heightIn(max = 240.dp)
                        .verticalScroll(rememberScrollState())
                        .padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
    }
}

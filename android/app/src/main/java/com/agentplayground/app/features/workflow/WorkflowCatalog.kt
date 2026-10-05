package com.agentplayground.app.features.workflow

import androidx.a2ui.compose.runtime.*
import androidx.a2ui.compose.ui.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.agentplayground.app.design.Details
import com.agentplayground.app.design.SectionCard
import com.agentplayground.app.design.StatusTag

private val childrenProperty = A2uiProperty.childList("children", required = true)

val workflowCatalog by lazy {
    A2uiCatalog(
        catalogId = "urn:agent-playground:workflow:v1",
        components = listOf(WorkflowPanel, WorkflowText, WorkflowSteps, WorkflowSql),
    )
}

private object WorkflowPanel : A2uiComponent {
    override val name = "WorkflowPanel"
    override val description = "Workflow result panel"
    override val properties = listOf(childrenProperty)

    @Composable
    override fun A2uiComponentScope.Content(
        properties: A2uiComponentProperties,
        modifier: Modifier,
    ) {
        SectionCard(modifier) {
            properties.bindChildReferences(childrenProperty).orEmpty().forEach {
                RenderComponent(observeA2uiComponentState(it))
            }
        }
    }
}

private object WorkflowSteps : A2uiComponent {
    override val name = "WorkflowSteps"
    override val description = "Numbered workflow steps"
    override val properties = listOf(childrenProperty)

    @Composable
    override fun A2uiComponentScope.Content(
        properties: A2uiComponentProperties,
        modifier: Modifier,
    ) {
        Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            properties.bindChildReferences(childrenProperty).orEmpty().forEachIndexed {
                index,
                reference ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("${index + 1}.", color = MaterialTheme.colorScheme.primary)
                    Box(Modifier.weight(1f)) {
                        RenderComponent(observeA2uiComponentState(reference))
                    }
                }
            }
        }
    }
}

private object WorkflowText : A2uiComponent {
    private val text = A2uiProperty.dynamicString("text", required = true)
    private val role =
        A2uiProperty.stringEnum("role", listOf("eyebrow", "title", "body", "step"), required = true)
    override val name = "WorkflowText"
    override val description = "Workflow text"
    override val properties = listOf(text, role)

    @Composable
    override fun A2uiComponentScope.Content(
        properties: A2uiComponentProperties,
        modifier: Modifier,
    ) {
        val type = properties[role]
        val style =
            when (type) {
                "title" -> MaterialTheme.typography.titleMedium
                "eyebrow" -> MaterialTheme.typography.labelMedium
                else -> MaterialTheme.typography.bodyMedium
            }
        Text(
            properties.bind(text).orEmpty(),
            modifier,
            style = style,
            color =
                if (type == "eyebrow") {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
        )
    }
}

private object WorkflowSql : A2uiComponent {
    private val call = A2uiProperty.string("workflowCallId", required = true)
    private val sql = A2uiProperty.string("sql", required = true)
    private val original = A2uiProperty.string("originalSql", required = true)
    private val revision = A2uiProperty.number("revision", required = true)
    private val round = A2uiProperty.number("round", required = true)
    private val status =
        A2uiProperty.stringEnum(
            "status",
            listOf("review", "submitted", "abandoned"),
            required = true,
        )
    private val passed = A2uiProperty.boolean("passed", required = true)
    private val issues = A2uiProperty.stringList("issues", required = true)
    private val check = A2uiProperty.nested("check", listOf(passed, issues), required = true)
    private val receipt = A2uiProperty.string("receiptId")
    override val name = "WorkflowSql"
    override val description = "Checked SQL with revision and demo submission state"
    override val properties = listOf(call, sql, original, revision, round, status, check, receipt)

    @Composable
    override fun A2uiComponentScope.Content(
        properties: A2uiComponentProperties,
        modifier: Modifier,
    ) {
        val checked = properties[check]
        val label =
            when (properties[status]) {
                "submitted" -> "SQL submitted"
                "abandoned" -> "SQL abandoned"
                else ->
                    if (checked?.get(passed) == true) {
                        "Check passed"
                    } else {
                        "Changes required"
                    }
            }
        SectionCard(modifier) {
            Text("SQL review", style = MaterialTheme.typography.titleMedium)
            StatusTag(
                "Version ${properties[revision]?.toInt()} · $label",
                emphasis = checked?.get(passed) == true,
            )
            Surface(
                shape = MaterialTheme.shapes.small,
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                SelectionContainer {
                    Text(
                        properties[sql].orEmpty(),
                        Modifier.fillMaxWidth().padding(12.dp),
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
            checked?.get(issues).orEmpty().forEach {
                Text(it, color = MaterialTheme.colorScheme.error)
            }
            Details("Original SQL") {
                Text(properties[original].orEmpty(), fontFamily = FontFamily.Monospace)
            }
            properties[receipt]?.let {
                Text("Receipt: $it", style = MaterialTheme.typography.bodySmall)
            }
            Text(
                "Demo checks only. Submission records SQL without executing it.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun RenderComponent(state: A2uiComponentState) {
    when (state) {
        is A2uiComponentState.Success -> A2uiComponent(state.component)
        is A2uiComponentState.Error ->
            Text(
                "Workflow content unavailable: ${state.exception.message}",
                color = MaterialTheme.colorScheme.error,
            )
        A2uiComponentState.Loading -> LinearProgressIndicator(Modifier.fillMaxWidth())
    }
}

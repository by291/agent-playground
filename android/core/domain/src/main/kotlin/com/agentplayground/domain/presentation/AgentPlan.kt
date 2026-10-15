package com.agentplayground.domain.presentation

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

enum class AgentPlanStatus {
    Pending,
    InProgress,
    Completed,
}

data class AgentPlanItem(val content: String, val status: AgentPlanStatus)

/** The latest committed task list for one conversation turn, independent of run settlement. */
data class AgentPlan(val items: List<AgentPlanItem>) {
    val completedCount: Int
        get() = items.count { it.status == AgentPlanStatus.Completed }
}

/**
 * Projects successful write_todos updates without changing the original execution history.
 * Uncommitted or invalid replacements preserve the last list; an executed empty list clears it.
 */
fun latestAgentPlan(steps: List<ToolStep>): AgentPlan? {
    var plan: AgentPlan? = null

    for (step in steps) {
        if (step.call.function.name != "write_todos" || step.status != ToolStatus.Completed) {
            continue
        }

        val result = step.result ?: continue

        if (result.toolCallId != step.call.id || !result.error.isNullOrEmpty()) {
            continue
        }

        val items = parsePlanItems(step.call.function.arguments) ?: continue

        // A valid empty replacement is a committed clear, unlike malformed streamed arguments.
        plan = items.takeIf { it.isNotEmpty() }?.let(::AgentPlan)
    }

    return plan
}

private fun parsePlanItems(arguments: String): List<AgentPlanItem>? {
    val fields =
        runCatching { Json.parseToJsonElement(arguments) as? JsonObject }.getOrNull() ?: return null
    val todos = fields["todos"] as? JsonArray ?: return null
    val items = mutableListOf<AgentPlanItem>()

    for (todo in todos) {
        val item = todo as? JsonObject ?: return null
        val content =
            (item["content"] as? JsonPrimitive)
                ?.takeIf { it.isString }
                ?.content
                ?.takeIf { it.isNotBlank() } ?: return null
        val statusText = (item["status"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val status =
            when (statusText) {
                "pending" -> AgentPlanStatus.Pending
                "in_progress" -> AgentPlanStatus.InProgress
                "completed" -> AgentPlanStatus.Completed
                else -> return null
            }

        items.add(AgentPlanItem(content, status))
    }

    return items
}

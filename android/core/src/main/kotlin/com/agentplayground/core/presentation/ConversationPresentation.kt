package com.agentplayground.core.presentation

import com.agentplayground.core.model.RunRecord
import com.agentplayground.core.model.SkillFile
import com.agentplayground.core.model.isActiveRun
import com.agentplayground.core.model.isReasoning
import com.agentplayground.core.model.protocolJson
import com.agentplayground.core.model.string
import com.agui.core.types.*
import kotlinx.serialization.json.*

data class ConversationTurn(
    val id: String,
    val user: UserMessage?,
    val messages: List<Message>,
    val status: String?,
    val toolCalls: List<ToolStep>,
    val sources: ReplySources,
)

enum class ToolStatus {
    Running,
    Completed,
    Failed,
    Paused,
    Waiting,
    Unavailable,
}

data class ToolStep(val call: ToolCall, val result: ToolMessage?, val status: ToolStatus)

data class SkillIdentity(val name: String, val path: String? = null)

enum class ExecutionKind {
    Tool,
    Skill,
    Memory,
}

data class ExecutionGroup(
    val skill: SkillIdentity?,
    val steps: List<ToolStep>,
    val kind: ExecutionKind = if (skill == null) ExecutionKind.Tool else ExecutionKind.Skill,
)

data class KnowledgeSource(
    val chunkId: String,
    val documentId: String,
    val name: String,
    val page: Int?,
    val excerpt: String,
    val number: Int,
)

data class ReplySources(
    val searched: Boolean = false,
    val sources: List<KnowledgeSource> = emptyList(),
    val errors: List<String> = emptyList(),
) {
    val documents: Map<String, List<KnowledgeSource>>
        get() = sources.groupBy { it.documentId }

    fun citation(link: String): KnowledgeSource? {
        val chunkId = knowledgeCitationId(link) ?: return null

        return sources.find { it.chunkId.equals(chunkId, ignoreCase = true) }
    }
}

fun knowledgeCitationId(link: String): String? =
    citationPattern.matchEntire(link)?.groupValues?.get(1)

private val citationPattern =
    Regex(
        "#knowledge-source-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
        RegexOption.IGNORE_CASE,
    )
private val uuidPattern =
    Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", RegexOption.IGNORE_CASE)
private val skillTools = setOf("load_skill", "read_skill_file", "run_skill_script")
private val memoryTools = setOf("search_memory", "remember_memory", "forget_memory")

fun isMemoryTool(name: String): Boolean = name in memoryTools

fun conversationTurns(
    messages: List<Message>,
    runs: List<RunRecord>,
    externalWaitCallIds: Set<String> = emptySet(),
    latestStatus: String? = null,
): List<ConversationTurn> {
    data class Draft(
        val id: String,
        val user: UserMessage?,
        val messages: MutableList<Message> = mutableListOf(),
        var status: String? = null,
    )

    val turns = mutableListOf<Draft>()
    val callOwners = mutableMapOf<String, Draft>()
    var current: Draft? = null

    for (message in messages) {
        if (message is UserMessage) {
            val turn = Draft(message.id, message)
            current = turn
            turns.add(turn)
        } else if (message is AssistantMessage || message is ToolMessage) {
            val latest =
                current
                    ?: Draft(message.id, null).also {
                        current = it
                        turns.add(it)
                    }
            val owner =
                if (message is ToolMessage) callOwners[message.toolCallId] ?: latest else latest

            owner.messages.add(message)

            if (message is AssistantMessage) {
                message.toolCalls.orEmpty().forEach { callOwners[it.id] = latest }
            }
        }
    }

    val byUser = turns.associateBy { it.id }
    var owner: Draft? = null

    for (run in runs) {
        owner = run.messageId?.let(byUser::get) ?: owner
        owner?.status = run.status
    }

    if (owner == null && turns.isNotEmpty() && runs.isNotEmpty()) {
        turns.last().status = runs.last().status
    }

    if (latestStatus != null) {
        turns.lastOrNull()?.status = latestStatus
    }

    return turns.map { turn ->
        val results = turn.messages.filterIsInstance<ToolMessage>().associateBy { it.toolCallId }
        val steps =
            turn.messages.filterIsInstance<AssistantMessage>().flatMap { message ->
                message.toolCalls.orEmpty().map { call ->
                    val result = results[call.id]
                    val status =
                        when {
                            result != null ->
                                if (!result.error.isNullOrEmpty()) {
                                    ToolStatus.Failed
                                } else {
                                    ToolStatus.Completed
                                }

                            turn.status == "interrupted" ->
                                if (call.id in externalWaitCallIds) {
                                    ToolStatus.Waiting
                                } else {
                                    ToolStatus.Paused
                                }

                            turn.status == "failed" -> ToolStatus.Failed
                            isActiveRun(turn.status) -> ToolStatus.Running
                            else -> ToolStatus.Unavailable
                        }

                    ToolStep(call, result, status)
                }
            }

        ConversationTurn(
            turn.id,
            turn.user,
            turn.messages.toList(),
            turn.status,
            steps,
            replySources(steps),
        )
    }
}

fun skillIdentity(step: ToolStep): SkillIdentity? {
    if (step.call.function.name !in skillTools) {
        return null
    }

    val arguments = jsonObject(step.call.function.arguments)
    val name = arguments?.string("skill_name")?.takeIf { it.isNotBlank() } ?: "Loading…"
    val path = arguments?.string("script_path") ?: arguments?.string("path")

    return SkillIdentity(name, path)
}

fun executionGroups(steps: List<ToolStep>): List<ExecutionGroup> {
    val groups = mutableListOf<ExecutionGroup>()

    for (step in steps) {
        val skill = skillIdentity(step)
        val kind =
            when {
                isMemoryTool(step.call.function.name) -> ExecutionKind.Memory
                skill != null -> ExecutionKind.Skill
                else -> ExecutionKind.Tool
            }
        val index = groups.indexOfFirst { it.kind == kind && it.skill?.name == skill?.name }

        if (index < 0) {
            groups.add(ExecutionGroup(skill, listOf(step), kind))
        } else {
            groups[index] = groups[index].copy(steps = groups[index].steps + step)
        }
    }

    return groups
}

fun skillFiles(steps: List<ToolStep>): List<SkillFile> {
    val files = linkedMapOf<String, SkillFile>()

    for (step in steps) {
        val payload = step.result?.let { jsonObject(it.content) } ?: continue

        if (payload.string("kind") != "skill_script_result") {
            continue
        }

        for (item in (payload["files"] as? JsonArray).orEmpty()) {
            val file =
                runCatching { protocolJson.decodeFromJsonElement<SkillFile>(item) }.getOrNull()
                    ?: continue

            files[file.id] = file
        }
    }

    return files.values.toList()
}

fun replySources(steps: List<ToolStep>): ReplySources {
    val sources = linkedMapOf<String, KnowledgeSource>()
    val errors = linkedSetOf<String>()
    var searched = false

    for (step in steps) {
        if (step.call.function.name != "search_knowledge") {
            continue
        }

        val payload = step.result?.let { jsonObject(it.content) } ?: continue

        if (payload.string("kind") != "knowledge_search_result") {
            continue
        }

        searched = true
        payload.string("error")?.takeIf { it.isNotBlank() }?.let(errors::add)

        for (item in (payload["sources"] as? JsonArray).orEmpty()) {
            val fields = item as? JsonObject ?: continue
            val chunkId = fields.string("chunkId") ?: continue
            val documentId = fields.string("documentId") ?: continue
            val name = fields.string("name") ?: continue
            val excerpt = fields.string("excerpt") ?: continue

            if (!uuidPattern.matches(chunkId) || !uuidPattern.matches(documentId)) {
                continue
            }

            val key = chunkId.lowercase()

            sources[key] =
                KnowledgeSource(
                    chunkId,
                    documentId,
                    name,
                    (fields["page"] as? JsonPrimitive)?.intOrNull,
                    excerpt,
                    sources[key]?.number ?: sources.size + 1,
                )
        }
    }

    return ReplySources(searched, sources.values.toList(), errors.toList())
}

private fun jsonObject(content: String): JsonObject? =
    runCatching { protocolJson.parseToJsonElement(content) as? JsonObject }.getOrNull()

/**
 * A phase follows reasoning/answer order, so recovery may replace message IDs without resetting a
 * user's choice.
 */
data class ReasoningFold(val phase: String, val open: Boolean) {
    fun update(nextPhase: String, automaticOpen: Boolean): ReasoningFold =
        if (phase == nextPhase) this else ReasoningFold(nextPhase, automaticOpen)
}

fun reasoningPhase(messages: List<Message>, renderedAnswer: Boolean? = null): String {
    val reasoningIndex = messages.indexOfLast { isReasoning(it) && !it.content.isNullOrBlank() }
    val answered =
        messages.drop(reasoningIndex + 1).any {
            it is AssistantMessage &&
                !isReasoning(it) &&
                it.toolCalls.isNullOrEmpty() &&
                !it.content.isNullOrBlank()
        }
    val count = messages.count { isReasoning(it) && !it.content.isNullOrBlank() }

    return if (renderedAnswer ?: answered) "answer-$count" else "reasoning-$count"
}

data class LegacyWorkflowSurface(val id: String, val toolCallId: String?)

data class LegacyWorkflowArtifacts(
    val current: List<LegacyWorkflowSurface>,
    val history: List<LegacyWorkflowSurface>,
    val completedCallIds: Set<String>,
)

/** Durable experiment stage outputs precede the shared presentation metadata contract. */
fun legacyWorkflowArtifacts(
    calls: List<ToolCall>,
    surfaces: List<LegacyWorkflowSurface>,
    reviewCallIds: Set<String> = emptySet(),
    legacyReview: Boolean = false,
): LegacyWorkflowArtifacts {
    val experimentCalls =
        calls.filter { it.function.name == "run_experiment_workflow" }.map { it.id }.toSet()
    val current = mutableListOf<LegacyWorkflowSurface>()
    val history = mutableListOf<LegacyWorkflowSurface>()
    val positions = mutableMapOf<String, Int>()

    fun stage(surface: LegacyWorkflowSurface): String? {
        val callId = surface.toolCallId ?: return null
        val prefix = "experiment-$callId-"

        if (callId !in experimentCalls || !surface.id.startsWith(prefix)) {
            return null
        }

        return surface.id.removePrefix(prefix).takeIf {
            it in setOf("idea", "draft", "review", "reviewed")
        }
    }

    for (surface in surfaces) {
        val callId = surface.toolCallId

        if (callId == null || stage(surface) == null) {
            current.add(surface)
            continue
        }

        val index = positions[callId]

        if (index == null) {
            positions[callId] = current.size
            current.add(surface)
        } else {
            history.add(current[index])
            current[index] = surface
        }
    }

    val completed = current.filter { stage(it) == "reviewed" }.mapNotNull { it.toolCallId }.toSet()
    val visible = current.filter { surface ->
        val replaced =
            stage(surface) == "review" && (legacyReview || surface.toolCallId in reviewCallIds)

        if (replaced) {
            history.add(surface)
        }

        !replaced
    }

    return LegacyWorkflowArtifacts(visible, history, completed)
}

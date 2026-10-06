package com.agentplayground.core

import com.agui.core.types.*
import kotlinx.serialization.json.*

data class ActivityRow(
    val entry: ActivityEntry,
    val events: List<ActivityEntry>,
    val content: String? = null,
    val status: String? = null,
)

/** Merging affects presentation only; inspection and export retain each official event. */
fun activityRows(entries: List<ActivityEntry>, merge: Boolean): List<ActivityRow> {
    if (!merge) {
        return entries.map { ActivityRow(it, listOf(it)) }
    }
    val rows = mutableListOf<ActivityRow>()
    val streams = mutableMapOf<Pair<String?, String>, Int>()
    for (entry in entries) {
        val event = entry.event
        val key =
            when (event) {
                is TextMessageStartEvent -> "text:${event.messageId}"
                is TextMessageContentEvent -> "text:${event.messageId}"
                is TextMessageEndEvent -> "text:${event.messageId}"
                is ReasoningMessageStartEvent -> "reasoning:${event.messageId}"
                is ReasoningMessageContentEvent -> "reasoning:${event.messageId}"
                is ReasoningMessageEndEvent -> "reasoning:${event.messageId}"
                is ToolCallStartEvent -> "arguments:${event.toolCallId}"
                is ToolCallArgsEvent -> "arguments:${event.toolCallId}"
                is ToolCallEndEvent -> "arguments:${event.toolCallId}"
                else -> null
            }
        if (key == null) {
            rows += ActivityRow(entry, listOf(entry))
            continue
        }
        val identity = entry.runId to key
        val delta =
            when (event) {
                is TextMessageContentEvent -> event.delta
                is ReasoningMessageContentEvent -> event.delta
                is ToolCallArgsEvent -> event.delta
                else -> ""
            }
        val ended =
            event is TextMessageEndEvent ||
                event is ReasoningMessageEndEvent ||
                event is ToolCallEndEvent
        val started =
            event is TextMessageStartEvent ||
                event is ReasoningMessageStartEvent ||
                event is ToolCallStartEvent
        val index = streams[identity]
        if (index == null || started) {
            streams[identity] = rows.size
            rows +=
                ActivityRow(entry, listOf(entry), delta, if (ended) "End received" else "Receiving")
        } else {
            val row = rows[index]
            val beginsWithStart =
                row.events.first().event is TextMessageStartEvent ||
                    row.events.first().event is ReasoningMessageStartEvent ||
                    row.events.first().event is ToolCallStartEvent
            rows[index] =
                row.copy(
                    events = row.events + entry,
                    content = row.content.orEmpty() + delta,
                    status =
                        if (ended) {
                            if (beginsWithStart) "Complete" else "End received"
                        } else row.status,
                )
        }
    }
    val settled =
        entries
            .filter { it.event is RunFinishedEvent || it.event is RunErrorEvent }
            .map { it.runId }
            .toSet()
    return rows.map { row ->
        if (row.status == "Receiving" && row.entry.runId in settled)
            row.copy(status = "End not received")
        else row
    }
}

fun activityExport(state: SessionState, exportedAt: Long): String =
    buildJsonObject {
            put("threadId", state.threadId)
            put("exportedAt", exportedAt)
            put("received", state.receivedEventCount)
            put("retained", state.activity.size)
            put("source", "Decoded AG-UI SDK events")
            state.runs.lastOrNull()?.let {
                put("latestRun", protocolJson.encodeToJsonElement(RunRecord.serializer(), it))
            }
            put(
                "clientIssues",
                buildJsonObject {
                    state.error?.let { put("conversation", it) }
                    state.outputError?.let { put("output", it) }
                    state.missingOutputSequence?.let { put("missingOutputSequence", it) }
                },
            )
            put(
                "events",
                JsonArray(
                    state.activity.map { entry ->
                        buildJsonObject {
                            put("sequence", entry.sequence)
                            put("receivedAt", entry.receivedAt)
                            entry.runId?.let { put("runId", it) }
                            put(
                                "event",
                                protocolJson.encodeToJsonElement(
                                    BaseEvent.serializer(),
                                    entry.event,
                                ),
                            )
                        }
                    }
                ),
            )
        }
        .let { protocolJson.encodeToString(JsonObject.serializer(), it) }

package com.agentplayground.app.features.conversation

import android.content.ClipData
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.agentplayground.app.design.*
import com.agentplayground.core.*
import com.agui.core.types.BaseEvent
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivityScreen(state: SessionState?, onBack: () -> Unit, onClear: () -> Unit) {
    var merge by rememberSaveable { mutableStateOf(true) }
    var copied by remember { mutableStateOf(false) }
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val rows = remember(state?.activity, merge) { activityRows(state?.activity.orEmpty(), merge) }
    BackPreview(onBack = onBack) { backModifier ->
        Scaffold(
            modifier = backModifier,
            topBar = {
                TopAppBar(
                    title = { Text("Run activity", style = MaterialTheme.typography.titleLarge) },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to chat")
                        }
                    },
                    colors =
                        TopAppBarDefaults.topAppBarColors(
                            containerColor = MaterialTheme.colorScheme.surface
                        ),
                )
            },
            containerColor = MaterialTheme.colorScheme.background,
        ) { padding ->
            LazyColumn(
                Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                item {
                    Column(
                        Modifier.widthIn(max = 840.dp).fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(
                            "${state?.receivedEventCount ?: 0} received · ${state?.activity?.size ?: 0} retained",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            "Live events received by this client. Restored conversations do not include past events.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(
                                selected = merge,
                                onClick = { merge = !merge },
                                label = { Text("Merge streaming events") },
                            )
                            OutlinedButton(
                                enabled =
                                    state != null &&
                                        (rows.isNotEmpty() ||
                                            state.error != null ||
                                            state.outputError != null),
                                onClick = {
                                    scope.launch {
                                        clipboard.setClipEntry(
                                            ClipEntry(
                                                ClipData.newPlainText(
                                                    "AG-UI activity",
                                                    activityExport(
                                                        state!!,
                                                        System.currentTimeMillis(),
                                                    ),
                                                )
                                            )
                                        )
                                        copied = true
                                    }
                                },
                            ) {
                                Icon(Icons.Outlined.ContentCopy, null, Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                ChangingContent(copied) { Text(if (it) "Copied" else "Copy log") }
                            }
                            TextButton(
                                enabled = rows.isNotEmpty(),
                                onClick = {
                                    onClear()
                                    copied = false
                                },
                            ) {
                                Text("Clear log")
                            }
                        }
                        SelectionContainer {
                            Text(
                                "Thread: ${state?.threadId ?: "Not started"}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        listOfNotNull(state?.error, state?.outputError).distinct().forEach {
                            ErrorNotice(it)
                        }
                    }
                }
                if (rows.isEmpty()) {
                    item {
                        SectionCard(Modifier.widthIn(max = 840.dp)) {
                            Text("No activity yet")
                            Text(
                                "Send a message to capture its live events.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                rows
                    .asReversed()
                    .groupBy { it.entry.runId }
                    .forEach { (runId, events) ->
                        item(key = "run:$runId") {
                            Text(
                                "Run ${runId ?: "unavailable"}",
                                Modifier.widthIn(max = 840.dp).fillMaxWidth().padding(top = 8.dp),
                                style = MaterialTheme.typography.titleSmall,
                            )
                        }
                        items(events, key = { it.entry.sequence }) { row ->
                            ActivityEventCard(
                                row,
                                Modifier.animateItem(
                                    fadeInSpec = null,
                                    fadeOutSpec = null,
                                    placementSpec = tween(Motion.Expand),
                                ),
                            )
                        }
                    }
            }
        }
    }
}

@Composable
private fun ActivityEventCard(row: ActivityRow, modifier: Modifier = Modifier) {
    val entry = row.entry
    val type = entry.event.eventType.name
    val time =
        remember(entry.receivedAt) {
            DateTimeFormatter.ofPattern("HH:mm:ss.SSS", Locale.ROOT)
                .format(Instant.ofEpochMilli(entry.receivedAt).atZone(ZoneId.systemDefault()))
        }
    SectionCard(modifier.widthIn(max = 840.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                type,
                Modifier.weight(1f),
                style = MaterialTheme.typography.labelLarge,
                color =
                    if (type == "RUN_ERROR") MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.onSurface,
            )
            Text(
                time,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text("Run ${entry.runId ?: "unavailable"}", style = MaterialTheme.typography.bodySmall)
        row.status?.let { StatusTag("${row.events.size} events · $it") }
        Details("Event details") {
            row.content
                ?.takeIf { it.isNotEmpty() }
                ?.let {
                    Text(
                        it,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            row.events.forEach { raw ->
                Text(
                    "${raw.sequence} · ${raw.event.eventType.name}",
                    style = MaterialTheme.typography.labelMedium,
                )
                Text(
                    protocolJson.encodeToString(BaseEvent.serializer(), raw.event),
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

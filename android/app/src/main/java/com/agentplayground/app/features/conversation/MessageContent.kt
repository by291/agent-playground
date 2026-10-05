package com.agentplayground.app.features.conversation

import android.text.method.LinkMovementMethod
import android.widget.TextView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.agentplayground.app.design.Details
import com.agentplayground.app.files.Download
import com.agentplayground.core.*
import com.agui.core.types.*
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.MarkwonConfiguration
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import kotlinx.serialization.json.*

@Composable
fun Markdown(content: String, onLink: (String) -> Unit) {
    val color = MaterialTheme.colorScheme.onSurface.toArgb()
    val callback by rememberUpdatedState(onLink)
    AndroidView(
        factory = { context ->
            TextView(context).apply {
                textSize = 16f
                setTextIsSelectable(true)
                movementMethod = LinkMovementMethod.getInstance()
                setLineSpacing(0f, 1.2f)
            }
        },
        modifier = Modifier.fillMaxWidth(),
        update = { view ->
            view.setTextColor(color)
            val renderer =
                view.tag as? Markwon
                    ?: Markwon.builder(view.context)
                        .usePlugin(TablePlugin.create(view.context))
                        .usePlugin(StrikethroughPlugin.create())
                        .usePlugin(
                            object : AbstractMarkwonPlugin() {
                                override fun configureConfiguration(
                                    builder: MarkwonConfiguration.Builder
                                ) {
                                    builder.linkResolver { _, link -> callback(link) }
                                }
                            }
                        )
                        .build()
                        .also { view.tag = it }
            renderer.setMarkdown(view, content)
        },
    )
}

@Composable
fun MessageContent(
    message: Message,
    api: PlaygroundApi,
    onDownload: (Download) -> Unit,
    onLink: (String) -> Unit,
) {
    when (message) {
        is UserMessage ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Surface(
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.widthIn(max = 560.dp),
                ) {
                    SelectionContainer { Text(message.content, Modifier.padding(16.dp)) }
                }
            }
        is AssistantMessage ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!message.content.isNullOrBlank()) {
                    if (isReasoning(message)) {
                        Details("Thinking") { Markdown(message.content.orEmpty(), onLink) }
                    } else {
                        Markdown(message.content.orEmpty(), onLink)
                    }
                }
                message.toolCalls.orEmpty().forEach { call ->
                    Details("Tool: ${call.function.name}") {
                        Text(
                            call.function.arguments,
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        is ToolMessage -> ToolResult(message, api, onDownload)
        else ->
            if (!message.content.isNullOrBlank()) {
                Details(message.messageRole.name.lowercase()) { Text(message.content.orEmpty()) }
            }
    }
}

@Composable
private fun ToolResult(message: ToolMessage, api: PlaygroundApi, onDownload: (Download) -> Unit) {
    val payload =
        remember(message.content) {
            runCatching { protocolJson.parseToJsonElement(message.content) as? JsonObject }
                .getOrNull()
        }
    if (message.error != null) {
        Text(message.error.orEmpty(), color = MaterialTheme.colorScheme.error)
    }
    val sources = (payload?.get("sources") as? JsonArray).orEmpty()
    if (payload?.string("kind") == "knowledge_search_result") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Knowledge sources", style = MaterialTheme.typography.labelLarge)
            payload.string("error")?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            sources.forEach { source ->
                val item = source.jsonObject
                OutlinedCard {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            item.string("name").orEmpty(),
                            style = MaterialTheme.typography.titleSmall,
                        )
                        item["page"]
                            ?.takeIf { it != JsonNull }
                            ?.let { Text("Page $it", style = MaterialTheme.typography.bodySmall) }
                        Details("Excerpt") { Text(item.string("excerpt").orEmpty()) }
                        item.string("documentId")?.let { id ->
                            TextButton(
                                onClick = {
                                    onDownload(
                                        Download(
                                            api.documentPath(id),
                                            item.string("name") ?: "document",
                                        )
                                    )
                                }
                            ) {
                                Text("Save document")
                            }
                        }
                    }
                }
            }
        }
    }
    if (payload?.string("kind") == "skill_script_result") {
        val files =
            (payload["files"] as? JsonArray).orEmpty().mapNotNull {
                runCatching { protocolJson.decodeFromJsonElement<SkillFile>(it) }.getOrNull()
            }
        files.forEach { file ->
            TextButton(onClick = { onDownload(Download(api.filePath(file), file.name)) }) {
                Text("Save ${file.name}")
            }
        }
    }
    Details("Tool result") {
        Text(
            message.content,
            fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

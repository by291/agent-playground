package com.agentplayground.app.features.workflow

import androidx.a2ui.compose.runtime.A2uiMessageParser
import androidx.a2ui.compose.runtime.observeA2uiComponentState
import androidx.a2ui.compose.ui.A2uiMessageProcessor
import androidx.a2ui.model.protocol.A2uiCreateSurfaceMessage
import androidx.a2ui.model.protocol.A2uiDeleteSurfaceMessage
import androidx.compose.runtime.*
import com.agentplayground.core.WorkflowOutput
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

/** Replay complete, ordered envelopes into a renderer whose actors are composition-owned. */
@Composable
fun rememberWorkflowRenderer(threadId: String, outputs: List<WorkflowOutput>): WorkflowRenderer {
    val processor = remember(threadId) { A2uiMessageProcessor(listOf(workflowCatalog)) }
    val parser = remember { A2uiMessageParser() }
    var ingested by remember(threadId) { mutableIntStateOf(0) }
    var surfaceCalls by remember(threadId) { mutableStateOf<Map<String, String?>>(emptyMap()) }
    var error by remember(threadId) { mutableStateOf<String?>(null) }
    val surfaces by processor.activeSurfaces.collectAsState()

    LaunchedEffect(processor) {
        launch { processor.collectMessages() }
        launch {
            processor.outboundEvents.collect { event ->
                error = "Workflow renderer reported: $event"
            }
        }
    }

    LaunchedEffect(processor, outputs) {
        while (ingested < outputs.size && error == null) {
            val output = outputs[ingested]

            try {
                val messages =
                    when (val value = output.messages) {
                        is JsonArray -> value
                        is JsonObject -> value.getValue("messages").jsonArray
                        else -> error("Expected A2UI message list")
                    }

                // Parse the full batch before sending any part to the processor.
                val parsed = messages.map { parser.parse(it.toString()) }

                for (message in parsed) {
                    when (message) {
                        is A2uiCreateSurfaceMessage ->
                            surfaceCalls = surfaceCalls + (message.surfaceId to output.toolCallId)

                        is A2uiDeleteSurfaceMessage ->
                            surfaceCalls = surfaceCalls - message.surfaceId

                        else -> Unit
                    }

                    processor.processMessage(message)
                }

                ingested += 1
            } catch (cause: Exception) {
                error = "Could not render workflow output ${output.id}: ${cause.message}"
            }
        }
    }

    return WorkflowRenderer(
        if (error == null) {
            surfaces.associateBy { it.id }
        } else {
            emptyMap()
        },
        error,
        surfaceCalls,
    )
}

data class WorkflowRenderer(
    val surfaces: Map<String, androidx.a2ui.model.processor.A2uiSurfaceModel>,
    val error: String?,
    val surfaceCalls: Map<String, String?> = emptyMap(),
)

@Composable
fun WorkflowSurface(renderer: WorkflowRenderer, id: String) {
    renderer.surfaces[id]?.let { RenderComponent(observeA2uiComponentState(it)) }
}

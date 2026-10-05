package com.agentplayground.app.features.conversation

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.agentplayground.app.data.AppPreferences
import com.agentplayground.app.design.*
import com.agentplayground.app.features.workflow.*
import com.agentplayground.app.files.Download
import com.agentplayground.app.files.DownloadSaver
import com.agentplayground.core.*
import com.agui.core.types.ToolMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(vm: ConversationViewModel, preferences: AppPreferences) {
    val state by vm.state.collectAsStateWithLifecycle()
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    BackHandler(enabled = drawer.isOpen) {
        scope.launch { drawer.close() }
    }
    var activity by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var download by rememberSaveable(stateSaver = DownloadSaver) { mutableStateOf<Download?>(null) }
    var source by remember { mutableStateOf<JsonObject?>(null) }
    var sourceUnavailable by remember { mutableStateOf(false) }
    val filePicker =
        rememberLauncherForActivityResult(
            ActivityResultContracts.OpenMultipleDocuments(),
            vm::attach,
        )
    val savePicker =
        rememberLauncherForActivityResult(
            ActivityResultContracts.CreateDocument("application/octet-stream")
        ) { uri ->
            val selected = download
            if (uri != null && selected != null) {
                vm.save(selected, uri)
            }
            download = null
        }
    val onDownload: (Download) -> Unit = {
        download = it
        savePicker.launch(it.name)
    }
    val uriHandler = LocalUriHandler.current
    val onLink: (String) -> Unit = { link ->
        if (link.startsWith("#knowledge-source-")) {
            val id = link.removePrefix("#knowledge-source-")
            val sources =
                state.session?.messages.orEmpty().filterIsInstance<ToolMessage>().flatMap { message
                    ->
                    (runCatching {
                                protocolJson
                                    .parseToJsonElement(message.content)
                                    .jsonObject["sources"]
                                    as? JsonArray
                            }
                            .getOrNull())
                        .orEmpty()
                }
            source = sources.mapNotNull { it as? JsonObject }.find { it.string("chunkId") == id }
            sourceUnavailable = source == null
        } else if (link.startsWith("https://") || link.startsWith("http://")) {
            runCatching { uriHandler.openUri(link) }
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val expanded = maxWidth >= 840.dp
        val compactHeight = maxHeight < 600.dp
        val onSelect: (String?) -> Unit = { id ->
            vm.select(id)
            scope.launch { drawer.close() }
        }
        val body: @Composable () -> Unit = {
            Row(Modifier.fillMaxSize()) {
                if (expanded) {
                    Surface(
                        Modifier.width(280.dp).fillMaxHeight(),
                        color = MaterialTheme.colorScheme.surface,
                    ) {
                        ConversationHistory(
                            state,
                            vm,
                            onSelect,
                            Modifier.fillMaxSize().statusBarsPadding(),
                        )
                    }
                    VerticalDivider()
                }
                Scaffold(
                    modifier = Modifier.weight(1f),
                    containerColor = MaterialTheme.colorScheme.surface,
                    contentWindowInsets = WindowInsets(0, 0, 0, 0),
                    topBar = {
                        TopAppBar(
                            colors =
                                TopAppBarDefaults.topAppBarColors(
                                    containerColor = MaterialTheme.colorScheme.surface
                                ),
                            title = {
                                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(
                                        state.session?.title ?: "Agent Playground",
                                        style = MaterialTheme.typography.titleMedium,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.testTag("conversation-title"),
                                    )
                                    Text(
                                        "Agent Playground",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            },
                            navigationIcon = {
                                if (!expanded) {
                                    IconButton(onClick = { scope.launch { drawer.open() } }) {
                                        Icon(Icons.Outlined.Menu, "Open conversation history")
                                    }
                                }
                            },
                            actions = {
                                IconButton(
                                    onClick = { onSelect(null) },
                                    enabled = !state.uploading,
                                ) {
                                    Icon(Icons.Outlined.Add, "New conversation")
                                }
                                Box {
                                    IconButton(onClick = { menu = true }) {
                                        Icon(Icons.Outlined.MoreHoriz, "Conversation options")
                                    }
                                    DropdownMenu(menu, onDismissRequest = { menu = false }) {
                                        DropdownMenuItem(
                                            text = { Text("Agent activity") },
                                            leadingIcon = { Icon(Icons.Outlined.Timeline, null) },
                                            onClick = {
                                                menu = false
                                                activity = true
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("Refresh conversation") },
                                            leadingIcon = { Icon(Icons.Outlined.Refresh, null) },
                                            onClick = {
                                                menu = false
                                                vm.recover()
                                            },
                                        )
                                    }
                                }
                            },
                        )
                    },
                    bottomBar = {
                        Composer(state, vm, preferences) { filePicker.launch(arrayOf("*/*")) }
                    },
                ) { padding ->
                    val session = state.session
                    if (session == null) {
                        Box(
                            Modifier.fillMaxSize().padding(padding),
                            contentAlignment = androidx.compose.ui.Alignment.Center,
                        ) {
                            CircularProgressIndicator()
                        }
                    } else {
                        ConversationTimeline(
                            session,
                            state.error,
                            preferences,
                            Modifier.padding(padding),
                            vm::recover,
                            vm::editPlan,
                            { id, action, plan -> vm.review(id, action, plan) },
                            onDownload,
                            onLink,
                            vm.api,
                            vm::editDraft,
                            compactHeight,
                        )
                    }
                }
            }
        }
        if (expanded) {
            body()
        } else {
            ModalNavigationDrawer(
                drawerState = drawer,
                drawerContent = {
                    ModalDrawerSheet(drawerContainerColor = MaterialTheme.colorScheme.background) {
                        ConversationHistory(
                            state,
                            vm,
                            onSelect,
                            Modifier.width(300.dp).fillMaxHeight(),
                        )
                    }
                },
                content = body,
            )
        }
    }
    if (activity) {
        AlertDialog(
            onDismissRequest = { activity = false },
            title = { Text("Agent activity") },
            text = {
                LazyColumn(
                    Modifier.heightIn(max = 480.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.session?.activity.orEmpty().asReversed()) {
                        Text(it, style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { activity = false }) { Text("Close") } },
        )
    }
    if (sourceUnavailable) {
        AlertDialog(
            onDismissRequest = { sourceUnavailable = false },
            title = { Text("Source unavailable") },
            text = {
                Text("This citation has no matching retrieved passage in this conversation.")
            },
            confirmButton = {
                TextButton(onClick = { sourceUnavailable = false }) { Text("Close") }
            },
        )
    }
    source?.let { item ->
        AlertDialog(
            onDismissRequest = { source = null },
            title = { Text(item.string("name") ?: "Knowledge source") },
            text = {
                Column {
                    item["page"]?.takeIf { it != JsonNull }?.let { Text("Page $it") }
                    androidx.compose.foundation.text.selection.SelectionContainer {
                        Text(item.string("excerpt").orEmpty())
                    }
                }
            },
            confirmButton = { TextButton(onClick = { source = null }) { Text("Close") } },
            dismissButton = {
                item.string("documentId")?.let { id ->
                    TextButton(
                        onClick = {
                            onDownload(
                                Download(vm.api.documentPath(id), item.string("name") ?: "document")
                            )
                        }
                    ) {
                        Text("Save original")
                    }
                }
            },
        )
    }
}

@Composable
private fun ConversationTimeline(
    state: SessionState,
    issue: String?,
    preferences: AppPreferences,
    modifier: Modifier,
    onRecover: () -> Unit,
    onEditPlan: (String, PlanDraft) -> Unit,
    onReview: (String, String, PlanDraft?) -> Unit,
    onDownload: (Download) -> Unit,
    onLink: (String) -> Unit,
    api: PlaygroundApi,
    onSuggestion: (String) -> Unit,
    compactHeight: Boolean,
) {
    val list = rememberLazyListState()
    val renderer = rememberWorkflowRenderer(state.threadId, state.outputs)
    // Replace prior presentations in the same group, retaining their current anchor ownership.
    val presentations =
        state.outputs
            .filter { it.workflow?.presentation != null }
            .groupBy { it.workflow!!.presentation!!.groupId }
            .values
            .map { it.last() }
    val anchored = presentations.groupBy { it.workflow!!.presentation!!.anchorMessageId }
    val unanchored =
        renderer.surfaces.keys
            .filter { id ->
                presentations.none {
                    val presentation = it.workflow!!.presentation!!
                    presentation.surfaceId == id &&
                        presentation.anchorMessageId != null &&
                        state.messages.any { message -> message.id == presentation.anchorMessageId }
                }
            }
            .filter { id ->
                val group =
                    state.outputs
                        .find { it.workflow?.presentation?.surfaceId == id }
                        ?.workflow
                        ?.presentation
                        ?.groupId
                group == null || presentations.any { it.workflow!!.presentation!!.surfaceId == id }
            }
    val stickToBottom by remember { derivedStateOf { !list.canScrollForward } }
    LaunchedEffect(
        state.threadId,
        state.messages.lastOrNull()?.content,
        state.busy,
        renderer.surfaces.size,
    ) {
        if (stickToBottom && list.layoutInfo.totalItemsCount > 0) {
            if (preferences.replyAnimation) {
                list.animateScrollToItem(list.layoutInfo.totalItemsCount - 1)
            } else {
                list.scrollToItem(list.layoutInfo.totalItemsCount - 1)
            }
        }
    }
    LazyColumn(
        modifier.fillMaxSize().wrapContentSize(Alignment.TopCenter).widthIn(max = 808.dp),
        state = list,
        contentPadding =
            PaddingValues(horizontal = 24.dp, vertical = if (compactHeight) 12.dp else 28.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (state.loading) {
            item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        }
        issue?.let { item { ErrorNotice(it, onRecover) } }
        state.error?.let { item { ErrorNotice(it, onRecover) } }
        state.missingOutputSequence?.let {
            item {
                Text(
                    "Recovering missing workflow output $it…",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        state.outputError?.let { item { ErrorNotice(it, onRecover) } }
        renderer.error?.let { item { ErrorNotice(it, onRecover) } }
        if (state.messages.isEmpty() && !state.loading && !state.busy) {
            item {
                Column(
                    Modifier.widthIn(max = 560.dp)
                        .fillMaxWidth()
                        .padding(top = if (compactHeight) 0.dp else 44.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    if (!compactHeight) {
                        AgentMark()
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            if (compactHeight) "What can I help with today?"
                            else "What can I help\nwith today?",
                            style =
                                if (compactHeight) MaterialTheme.typography.headlineSmall
                                else MaterialTheme.typography.headlineLarge,
                        )
                        Text(
                            "Explore an idea, work with your documents, or turn a task into a plan.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
                    Column(
                        Modifier.padding(top = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        SuggestionRow(
                            Icons.Outlined.Lightbulb,
                            "Explore an idea",
                            "Help me think through an idea and its next steps.",
                            onSuggestion,
                        )
                        SuggestionRow(
                            Icons.Outlined.Description,
                            "Ask your knowledge base",
                            "Search my knowledge base and summarize the key points.",
                            onSuggestion,
                        )
                        SuggestionRow(
                            Icons.Outlined.Checklist,
                            "Make a plan",
                            "Create an experiment plan for a task I describe.",
                            onSuggestion,
                        )
                    }
                }
            }
        }
        items(state.messages, key = { it.id }) { message ->
            Column(
                Modifier.widthIn(max = 760.dp).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                MessageContent(message, api, onDownload, onLink)
                anchored[message.id].orEmpty().forEach { output ->
                    WorkflowPresentation(output, state.outputs, renderer)
                }
            }
        }
        items(unanchored, key = { "surface:$it" }) { surfaceId ->
            val current = presentations.find { it.workflow!!.presentation!!.surfaceId == surfaceId }
            if (current != null) {
                WorkflowPresentation(current, state.outputs, renderer)
            } else {
                WorkflowSurface(renderer, surfaceId)
            }
        }
        items(state.externalTasks, key = { "task:${it.taskId}" }) { ExternalTaskPanel(it) }
        items(state.interrupts, key = { "review:${it.id}" }) {
            ReviewPanel(
                it,
                state.busy || renderer.error != null,
                state.planDecisions[it.id],
                state.planDrafts[it.id],
                onEditPlan,
                onReview,
            )
        }
        if (state.busy) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text(
                        if (state.streaming) {
                            "Agent is responding…"
                        } else {
                            "Recovering agent progress…"
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun WorkflowPresentation(
    current: WorkflowOutput,
    outputs: List<WorkflowOutput>,
    renderer: WorkflowRenderer,
) {
    val presentation = current.workflow!!.presentation!!
    WorkflowSurface(renderer, presentation.surfaceId)
    val older =
        outputs
            .filter {
                val previous = it.workflow?.presentation
                it.outputSeq < current.outputSeq &&
                    previous?.groupId == presentation.groupId &&
                    previous.surfaceId != presentation.surfaceId
            }
            .distinctBy { it.workflow!!.presentation!!.surfaceId }
    if (older.isNotEmpty()) {
        Details("Earlier workflow results (${older.size})") {
            older.forEach { WorkflowSurface(renderer, it.workflow!!.presentation!!.surfaceId) }
        }
    }
}

@Composable
private fun SuggestionRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    prompt: String,
    onSelect: (String) -> Unit,
) {
    OutlinedCard(
        onClick = { onSelect(prompt) },
        modifier = Modifier.fillMaxWidth(),
        colors =
            CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
        border =
            androidx.compose.foundation.BorderStroke(
                1.dp,
                MaterialTheme.colorScheme.outlineVariant,
            ),
    ) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                icon,
                null,
                Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Icon(
                Icons.Outlined.NorthEast,
                null,
                Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

package com.agentplayground.app.features.conversation

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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
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
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(
    vm: ConversationViewModel,
    preferences: AppPreferences,
    onOpenNavigation: (() -> Unit)? = null,
    onActivity: () -> Unit = {},
) {
    val state by vm.state.collectAsStateWithLifecycle()
    var menu by remember { mutableStateOf(false) }
    var download by rememberSaveable(stateSaver = DownloadSaver) { mutableStateOf<Download?>(null) }
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
        if (link.startsWith("https://") || link.startsWith("http://")) {
            runCatching { uriHandler.openUri(link) }
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compactHeight = maxHeight < 600.dp
        val onSelect: (String?) -> Unit = vm::select
        Scaffold(
            modifier = Modifier.fillMaxSize(),
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
                        if (onOpenNavigation != null) {
                            IconButton(onClick = onOpenNavigation) {
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
                                        onActivity()
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
                key(session.threadId) {
                    ConversationTimeline(
                        session,
                        state.error,
                        preferences,
                        Modifier.padding(padding),
                        vm::recover,
                        vm::editPlan,
                        { id, action, plan, ids -> vm.review(id, action, plan, ids) },
                        vm::submitPlanReviews,
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
}

@Composable
private fun ConversationTimeline(
    state: SessionState,
    issue: String?,
    preferences: AppPreferences,
    modifier: Modifier,
    onRecover: () -> Unit,
    onEditPlan: (String, PlanDraft) -> Unit,
    onReview: (String, String, PlanDraft?, Set<String>) -> Unit,
    onContinueReviews: (Set<String>) -> Unit,
    onDownload: (Download) -> Unit,
    onLink: (String) -> Unit,
    api: PlaygroundApi,
    onSuggestion: (String) -> Unit,
    compactHeight: Boolean,
) {
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var following by rememberSaveable(state.threadId) { mutableStateOf(true) }
    val atBottom by remember {
        derivedStateOf { list.firstVisibleItemIndex == 0 && list.firstVisibleItemScrollOffset == 0 }
    }
    val renderer = rememberWorkflowRenderer(state.threadId, state.outputs)
    val waits = state.interrupts.mapNotNull(::externalWaitCallId).toSet()
    val latestStatus =
        state.executionStatus ?: if (state.interrupts.isNotEmpty()) "interrupted" else null
    val turns = conversationTurns(state.messages, state.runs, waits, latestStatus)
    val presentations =
        state.outputs
            .filter { it.workflow?.presentation != null }
            .groupBy { it.workflow!!.presentation!!.groupId }
            .values
            .map { it.last() }
    val owners = mutableMapOf<String, String>()
    for (output in state.outputs) {
        val presentation = output.workflow?.presentation ?: continue
        val owner =
            turns.find { turn -> turn.messages.any { it.id == presentation.anchorMessageId } }
                ?: turns.find { turn -> turn.toolCalls.any { it.call.id == output.toolCallId } }
        if (owner != null) {
            owners[presentation.groupId] = owner.id
        }
    }
    val groupedSurfaces = state.outputs.mapNotNull { it.workflow?.presentation?.surfaceId }.toSet()
    val calls = turns.flatMap { it.toolCalls }.map { it.call }
    val legacySurfaces =
        renderer.surfaces.keys
            .filter { it !in groupedSurfaces }
            .map { LegacyWorkflowSurface(it, renderer.surfaceCalls[it]) }
    val reviewCalls =
        state.interrupts.mapNotNull { Review.from(it)?.raw?.string("workflowCallId") }.toSet()
    val legacy =
        legacyWorkflowArtifacts(
            calls,
            legacySurfaces,
            reviewCalls,
            state.interrupts.any {
                Review.from(it)?.kind == "experiment_plan_review" &&
                    Review.from(it)?.raw?.string("workflowCallId") == null
            },
        )
    val visibleInterrupts =
        state.interrupts.filter {
            Review.from(it)?.raw?.string("workflowCallId") !in legacy.completedCallIds
        }
    val pendingPlans = visibleInterrupts.filter {
        Review.from(it)?.kind == "experiment_plan_review"
    }
    val planIds = pendingPlans.map { it.id }.toSet()
    val reviewBusy = state.busy || state.loading || renderer.error != null
    val reviews: @Composable () -> Unit = {
        if (pendingPlans.size > 1) {
            PlanReviewPanel(
                pendingPlans,
                reviewBusy,
                state.planDecisions,
                state.planDrafts,
                onEditPlan,
                { id, action, plan -> onReview(id, action, plan, planIds) },
                { onContinueReviews(planIds) },
            )
        }
        visibleInterrupts
            .filter { pendingPlans.size <= 1 || it !in pendingPlans }
            .forEach { interrupt ->
                ReviewPanel(
                    interrupt,
                    reviewBusy,
                    state.planDecisions[interrupt.id],
                    state.planDrafts[interrupt.id],
                    onEditPlan,
                    { id, action, plan -> onReview(id, action, plan, planIds) },
                )
            }
    }
    val empty =
        turns.isEmpty() &&
            state.outputs.isEmpty() &&
            state.interrupts.isEmpty() &&
            state.externalTasks.isEmpty() &&
            !state.loading &&
            !state.busy
    val entries =
        buildList<TimelineEntry> {
            if (empty) {
                add(
                    TimelineEntry("welcome") {
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
                )
            }
            turns.forEachIndexed { index, turn ->
                turn.user?.let { message ->
                    add(
                        TimelineEntry("user:${turn.id}") {
                            MessageContent(message, api, onDownload, onLink)
                        }
                    )
                }
                val ownedCards = presentations.filter {
                    owners[it.workflow!!.presentation!!.groupId] == turn.id
                }
                val callIds = turn.toolCalls.map { it.call.id }.toSet()
                val tasks = state.externalTasks.filter { it.workflowCallId in callIds }
                val legacyCards = legacy.current.filter { it.toolCallId in callIds }
                val legacyHistory = legacy.history.filter { it.toolCallId in callIds }
                val hasReviews = index == turns.lastIndex && visibleInterrupts.isNotEmpty()
                if (
                    turn.messages.isNotEmpty() ||
                        ownedCards.isNotEmpty() ||
                        legacyCards.isNotEmpty() ||
                        legacyHistory.isNotEmpty() ||
                        tasks.isNotEmpty() ||
                        hasReviews
                ) {
                    add(
                        TimelineEntry("reply:${turn.id}") {
                            AssistantTurnContent(turn, api, onDownload, onLink) {
                                tasks.forEach { ExternalTaskPanel(it) }
                                ownedCards.forEach {
                                    WorkflowPresentation(it, state.outputs, renderer)
                                }
                                legacyCards.forEach { WorkflowSurface(renderer, it.id) }
                                if (legacyHistory.isNotEmpty()) {
                                    Details("Earlier workflow results (${legacyHistory.size})") {
                                        legacyHistory.forEach { WorkflowSurface(renderer, it.id) }
                                    }
                                }
                                if (hasReviews) {
                                    reviews()
                                }
                            }
                        }
                    )
                }
            }
            presentations
                .filter { it.workflow!!.presentation!!.groupId !in owners }
                .forEach { output ->
                    add(
                        TimelineEntry("surface:${output.workflow!!.presentation!!.surfaceId}") {
                            WorkflowPresentation(output, state.outputs, renderer)
                        }
                    )
                }
            val attachedCalls = calls.map { it.id }.toSet()
            legacy.current
                .filter { it.toolCallId !in attachedCalls }
                .forEach { surface ->
                    add(
                        TimelineEntry("surface:${surface.id}") {
                            WorkflowSurface(renderer, surface.id)
                        }
                    )
                }
            state.externalTasks
                .filter { it.workflowCallId !in attachedCalls }
                .forEach { task ->
                    add(TimelineEntry("task:${task.taskId}") { ExternalTaskPanel(task) })
                }
            if (turns.isEmpty() && visibleInterrupts.isNotEmpty()) {
                add(TimelineEntry("reviews") { reviews() })
            }
            if (state.loading) {
                add(TimelineEntry("loading") { LinearProgressIndicator(Modifier.fillMaxWidth()) })
            }
            state.missingOutputSequence?.let { sequence ->
                add(
                    TimelineEntry("missing-output") {
                        Text(
                            "Recovering missing workflow output $sequence…",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                )
            }
            listOfNotNull(issue, state.error, state.outputError, renderer.error)
                .distinct()
                .forEachIndexed { index, error ->
                    add(TimelineEntry("error:$index") { ErrorNotice(error, onRecover) })
                }
            if (state.busy) {
                add(
                    TimelineEntry("progress") {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            Text(
                                if (state.streaming) "Agent is responding…"
                                else "Recovering agent progress…",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                )
            }
        }
    // A reversed list starts at the newest content and also anchors tall, growing
    // replies by their bottom edge. Following is suspended when the reader scrolls.
    LaunchedEffect(list) {
        snapshotFlow { list.isScrollInProgress }
            .collect { scrolling ->
                if (!scrolling) {
                    following = atBottom
                }
            }
    }
    LaunchedEffect(
        state.messages,
        state.outputs,
        state.interrupts,
        state.externalTasks,
        state.busy,
        state.loading,
    ) {
        if (following && !list.isScrollInProgress && entries.isNotEmpty()) {
            list.requestScrollToItem(0)
        }
    }
    val scrollConnection =
        remember(list) {
            object : NestedScrollConnection {
                override fun onPostScroll(
                    consumed: Offset,
                    available: Offset,
                    source: NestedScrollSource,
                ): Offset {
                    if (source == NestedScrollSource.UserInput && consumed.y != 0f) {
                        following = atBottom
                    }
                    return Offset.Zero
                }
            }
        }
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(
            Modifier.fillMaxSize()
                .widthIn(max = 808.dp)
                .testTag("conversation-timeline")
                .nestedScroll(scrollConnection),
            state = list,
            reverseLayout = !empty,
            contentPadding =
                PaddingValues(horizontal = 24.dp, vertical = if (compactHeight) 12.dp else 28.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            items(if (empty) entries else entries.asReversed(), key = { it.id }) { entry ->
                Column(
                    Modifier.widthIn(max = 760.dp).fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    entry.content()
                }
            }
        }
        if (!empty && !atBottom) {
            FilledTonalIconButton(
                onClick = {
                    following = true
                    scope.launch {
                        if (preferences.replyAnimation) list.animateScrollToItem(0)
                        else list.scrollToItem(0)
                    }
                },
                modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp).size(48.dp),
            ) {
                Icon(Icons.Outlined.ArrowDownward, "Jump to latest message")
            }
        }
    }
}

private data class TimelineEntry(val id: String, val content: @Composable () -> Unit)

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

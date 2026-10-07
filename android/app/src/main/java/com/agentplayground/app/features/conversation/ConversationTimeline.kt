package com.agentplayground.app.features.conversation

import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.agentplayground.app.data.AppPreferences
import com.agentplayground.app.design.*
import com.agentplayground.app.features.workflow.*
import com.agentplayground.app.files.Download
import com.agentplayground.core.*
import kotlinx.coroutines.launch

@Composable
internal fun ConversationTimeline(
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
    fileDownload: (SkillFile) -> Download,
    documentDownload: (String, String) -> Download,
    onSuggestion: (String) -> Unit,
    compactHeight: Boolean,
    attachmentPresentation: (String, UploadedAttachment) -> MessageAttachment = { _, attachment ->
        MessageAttachment(attachment.name)
    },
    loadImage: AttachmentImageLoader = { _, _ -> null },
) {
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var following by rememberSaveable(state.threadId) { mutableStateOf(true) }
    val atBottom by remember {
        derivedStateOf { list.firstVisibleItemIndex == 0 && list.firstVisibleItemScrollOffset == 0 }
    }

    val renderer = rememberWorkflowRenderer(state.threadId, state.outputs)
    val timeline =
        conversationTimelineModel(
            state,
            renderer.surfaces.keys.map { LegacyWorkflowSurface(it, renderer.surfaceCalls[it]) },
        )
    val visibleInterrupts = timeline.visibleInterrupts
    val pendingPlans = timeline.pendingPlans
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

    val empty = timeline.empty

    val entries =
        buildList<TimelineEntry> {
            if (empty) {
                add(
                    TimelineEntry("welcome") {
                        TimelineWelcome(compactHeight, onSuggestion)
                    }
                )
            }

            timeline.turns.forEach { row ->
                val turn = row.turn

                turn.user?.let { message ->
                    add(
                        TimelineEntry("user:${turn.id}") {
                            MessageContent(
                                message,
                                onLink,
                                { attachment ->
                                    attachmentPresentation(state.threadId, attachment)
                                },
                                onDownload,
                                loadImage,
                            )
                        }
                    )
                }

                if (row.showReply) {
                    add(
                        TimelineEntry("reply:${turn.id}") {
                            TimelineTurnContent(
                                row,
                                renderer,
                                fileDownload,
                                documentDownload,
                                onDownload,
                                onLink,
                                reviews,
                            )
                        }
                    )
                }
            }

            timeline.standalonePresentations.forEach { output ->
                add(
                    TimelineEntry("surface:${output.workflow!!.presentation!!.surfaceId}") {
                        WorkflowPresentation(output, renderer)
                    }
                )
            }
            timeline.standaloneLegacySurfaces.forEach { surface ->
                add(
                    TimelineEntry("surface:${surface.id}") { WorkflowSurface(renderer, surface.id) }
                )
            }
            timeline.standaloneTasks.forEach { task ->
                add(TimelineEntry("task:${task.taskId}") { ExternalTaskPanel(task) })
            }

            if (timeline.turns.isEmpty() && visibleInterrupts.isNotEmpty()) {
                add(TimelineEntry("reviews") { reviews() })
            }

            if (isEmpty()) {
                add(TimelineEntry("status") {})
            }
        }

    val noticeErrors =
        listOfNotNull(issue, state.error, state.outputError, renderer.error).distinct()
    val hasNotices =
        state.loading ||
            state.busy ||
            state.missingOutputSequence != null ||
            noticeErrors.isNotEmpty()

    val notices: @Composable () -> Unit = {
        TimelineNotices(state, noticeErrors, hasNotices, onRecover)
    }

    val entrances = remember(state.threadId) { TimelineEntrances() }
    val entranceKeys =
        entries.map { it.id }.toSet() +
            state.interrupts.map { "review:${it.id}" } +
            state.externalTasks.map { "task:${it.taskId}" }

    entrances.observe(entranceKeys, state.loading)

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

    CompositionLocalProvider(
        LocalTimelineEntrances provides entrances,
        LocalReplyAnimation provides preferences.replyAnimation,
    ) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            LazyColumn(
                Modifier.fillMaxSize()
                    .widthIn(max = 808.dp)
                    .testTag("conversation-timeline")
                    .nestedScroll(scrollConnection),
                state = list,
                reverseLayout = !empty,
                contentPadding =
                    PaddingValues(
                        horizontal = 24.dp,
                        vertical = if (compactHeight) 12.dp else 28.dp,
                    ),
                verticalArrangement = Arrangement.spacedBy(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                items(if (empty) entries else entries.asReversed(), key = { it.id }) { entry ->
                    val admitted = remember(entry.id) { entrances.consume(entry.id) }

                    EntryAppearance(
                        animate = admitted && preferences.replyAnimation,
                        modifier =
                            Modifier.animateItem(
                                fadeInSpec = null,
                                fadeOutSpec =
                                    if (preferences.replyAnimation) tween(Motion.Exit) else null,
                                placementSpec = null,
                            ),
                    ) {
                        Column(
                            Modifier.widthIn(max = 760.dp).fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            entry.content()

                            if (entry.id == entries.last().id) {
                                notices()
                            }
                        }
                    }
                }
            }
            AnimatedVisibility(
                visible = !empty && !atBottom,
                modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp),
                enter =
                    fadeIn(tween(Motion.Feedback)) +
                        scaleIn(tween(Motion.Feedback), initialScale = 0.9f),
                exit =
                    fadeOut(tween(Motion.Exit)) + scaleOut(tween(Motion.Exit), targetScale = 0.9f),
            ) {
                FilledTonalIconButton(
                    onClick = {
                        following = true
                        scope.launch {
                            if (preferences.replyAnimation) {
                                list.animateScrollToItem(0)
                            } else {
                                list.scrollToItem(0)
                            }
                        }
                    },
                    modifier = Modifier.size(48.dp),
                ) {
                    Icon(Icons.Outlined.ArrowDownward, "Jump to latest message")
                }
            }
        }
    }
}

private data class TimelineEntry(val id: String, val content: @Composable () -> Unit)

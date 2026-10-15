package com.agentplayground.feature.conversation.ui.review

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.agentplayground.domain.conversation.*
import com.agui.core.types.Interrupt
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

private data class InteractionPage(
    val request: InteractionRequest,
    val actionIndex: Int,
    val questionIndex: Int? = null,
)

/** The active composer input state; only explicit footer actions can submit a complete batch. */
@Composable
internal fun InteractionPanel(
    state: SessionState,
    onEdit: (Interrupt, InteractionDraft) -> Unit,
    onSubmit: (Interrupt) -> Unit,
    modifier: Modifier = Modifier,
) {
    val requests = state.interrupts.mapNotNull(InteractionRequest::from).distinctBy { it.interrupt }

    if (requests.isEmpty()) {
        return
    }

    val pages = requests.flatMap { request ->
        interactionPages(
            request,
            state.interactionDrafts[request.interrupt] ?: request.initialDraft(),
        )
    }
    var savedPageIndex by rememberSaveable(state.threadId) { mutableIntStateOf(0) }
    var selectedPage by remember(state.threadId) { mutableStateOf<InteractionPage?>(null) }
    val selectedIndex = selectedPage?.let(pages::indexOf)
    val pageIndex = selectedIndex?.coerceAtLeast(0) ?: savedPageIndex.coerceIn(0, pages.lastIndex)
    val page = pages[pageIndex]
    val request = page.request
    val action = request.actions[page.actionIndex]
    val question = page.questionIndex?.let(action.questions::get)
    val initialDraft = request.initialDraft()
    val draft = state.interactionDrafts[request.interrupt] ?: initialDraft
    val decision =
        draft.decisions.getOrElse(page.actionIndex) { initialDraft.decisions[page.actionIndex] }
    val now = Instant.now()
    val unique = state.interrupts.count { it.id == request.interrupt.id } == 1
    val expired = request.expiredAt(now)
    val enabled = !state.busy && !state.loading && !state.pendingSubmission && unique && !expired
    val canReject = InteractionDecisionType.Reject in action.allowedDecisions
    val canRespond = InteractionDecisionType.Respond in action.allowedDecisions
    val canApprove = InteractionDecisionType.Approve in action.allowedDecisions
    var noteExpanded by
        rememberSaveable(request.interrupt, page.actionIndex) { mutableStateOf(false) }
    var argumentsExpanded by
        rememberSaveable(request.interrupt, page.actionIndex) { mutableStateOf(false) }

    val replaceDecision: (InteractionDecisionDraft) -> InteractionDraft = { next ->
        InteractionDraft(
            request.actions.indices.map { index ->
                if (index == page.actionIndex) {
                    next
                } else {
                    draft.decisions.getOrElse(index) { initialDraft.decisions[index] }
                }
            }
        )
    }
    val updateDecision: (InteractionDecisionDraft) -> Unit = {
        onEdit(request.interrupt, replaceDecision(it))
    }
    val navigate: (InteractionPage) -> Unit = { target ->
        selectedPage = target
        savedPageIndex = pages.indexOf(target).coerceAtLeast(0)
    }
    val completeOrAdvance: (InteractionDraft) -> Unit = { next ->
        onEdit(request.interrupt, next)

        if (request.respond(next, now) != null) {
            onSubmit(request.interrupt)
        } else {
            firstUnfinishedPage(request, next, now)?.let(navigate)
        }
    }
    val rejectAction: () -> Unit = {
        val rejected =
            decision.copy(
                type = InteractionDecisionType.Reject,
                message = if (question != null) "" else decision.message,
            )
        completeOrAdvance(replaceDecision(rejected))
    }

    val otherActionsReady =
        request.actions.indices
            .filter { it != page.actionIndex }
            .all { actionComplete(request, draft, it, now) }
    val lastQuestion = page.questionIndex == action.questions.lastIndex
    val otherQuestionsReady =
        action.questions
            .filterIndexed { index, _ -> index != page.questionIndex }
            .all { answerReady(decision.answers[it.id]) }
    val answerLabel =
        if (lastQuestion && otherQuestionsReady && otherActionsReady) "Send" else "Next"

    Surface(
        modifier.fillMaxWidth().testTag("interaction-panel"),
        shape = RoundedCornerShape(22.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Column(Modifier.fillMaxWidth().padding(vertical = 16.dp)) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(start = 16.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    if (question != null) Icons.AutoMirrored.Outlined.HelpOutline
                    else Icons.Outlined.PanTool,
                    null,
                    Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    if (question != null) "Question" else "Approval",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.weight(1f))
                if (pages.size > 1) {
                    Text(
                        "${pageIndex + 1}/${pages.size}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (question != null && canReject) {
                    IconButton(
                        onClick = rejectAction,
                        enabled = enabled,
                        modifier = Modifier.size(40.dp),
                    ) {
                        Icon(Icons.Outlined.Close, "Skip question", Modifier.size(20.dp))
                    }
                }
            }
            Spacer(Modifier.height(8.dp))

            key(request.interrupt, page.actionIndex, page.questionIndex) {
                Column(
                    Modifier.weight(1f, fill = false)
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            question?.question
                                ?: "Allow ${action.name.replace('_', ' ').replace('-', ' ')}?",
                            Modifier.weight(1f).semantics { heading() },
                            style =
                                MaterialTheme.typography.titleMedium.copy(
                                    fontWeight = FontWeight.SemiBold
                                ),
                        )
                        when (decision.type) {
                            InteractionDecisionType.Approve ->
                                Text("Allowed", style = MaterialTheme.typography.labelSmall)
                            InteractionDecisionType.Reject ->
                                Text("Rejected", style = MaterialTheme.typography.labelSmall)
                            else -> Unit
                        }
                    }

                    if (question != null) {
                        InteractionQuestionContent(
                            question,
                            decision,
                            enabled && canRespond,
                            updateDecision,
                        )
                    } else {
                        action.description?.let {
                            Text(it, style = MaterialTheme.typography.bodyMedium)
                        }
                        TextButton(onClick = { argumentsExpanded = !argumentsExpanded }) {
                            Text(if (argumentsExpanded) "Hide tool arguments" else "Tool arguments")
                        }
                        if (argumentsExpanded) {
                            SelectionContainer {
                                Text(
                                    remember(action.arguments) {
                                        argumentJson.encodeToString(
                                            JsonObject.serializer(),
                                            action.arguments,
                                        )
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    fontFamily = FontFamily.Monospace,
                                )
                            }
                        }

                        if (canReject) {
                            TextButton(
                                onClick = { noteExpanded = !noteExpanded },
                                enabled = enabled,
                            ) {
                                Text(
                                    if (noteExpanded) "Hide rejection note"
                                    else "Add rejection note"
                                )
                            }

                            if (noteExpanded) {
                                OutlinedTextField(
                                    decision.message,
                                    { updateDecision(decision.copy(message = it)) },
                                    label = { Text("Reason (optional)") },
                                    enabled = enabled,
                                    isError = decision.message.length > 4000,
                                    maxLines = 2,
                                    modifier =
                                        Modifier.fillMaxWidth().testTag("interaction-reason"),
                                )
                            }
                        }
                    }

                    if (expired) {
                        Text(
                            "This request has expired. Refresh the conversation.",
                            color = MaterialTheme.colorScheme.error,
                        )
                    }

                    if (!unique) {
                        Text(
                            "This request is duplicated. Refresh the conversation.",
                            color = MaterialTheme.colorScheme.error,
                        )
                    }

                    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            }

            Row(
                Modifier.fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .padding(top = 12.dp)
                    .heightIn(min = 48.dp)
                    .testTag("interaction-footer"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (pages.size > 1) {
                    IconButton(
                        onClick = { navigate(pages[pageIndex - 1]) },
                        enabled = pageIndex > 0,
                    ) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Previous")
                    }
                }

                Spacer(Modifier.weight(1f))

                if (canReject) {
                    if (question != null) {
                        TextButton(
                            modifier = Modifier.heightIn(min = 40.dp),
                            onClick = rejectAction,
                            enabled = enabled,
                        ) {
                            Text("Skip")
                        }
                    } else {
                        OutlinedButton(
                            onClick = rejectAction,
                            enabled = enabled && decision.message.length <= 4000,
                            modifier = Modifier.heightIn(min = 40.dp),
                            contentPadding = PaddingValues(horizontal = 16.dp),
                        ) {
                            Text("Reject")
                        }
                    }
                }

                if (question != null && canRespond) {
                    Button(
                        modifier = Modifier.widthIn(min = 96.dp).heightIn(min = 40.dp),
                        contentPadding = PaddingValues(horizontal = 16.dp),
                        onClick = {
                            val next =
                                replaceDecision(
                                    decision.copy(type = InteractionDecisionType.Respond)
                                )

                            if (!lastQuestion) {
                                onEdit(request.interrupt, next)
                                navigate(
                                    InteractionPage(
                                        request,
                                        page.actionIndex,
                                        page.questionIndex + 1,
                                    )
                                )
                            } else {
                                completeOrAdvance(next)
                            }
                        },
                        enabled = enabled && answerReady(decision.answers[question.id]),
                    ) {
                        Text(if (state.busy) "Submitting…" else answerLabel)
                    }
                } else if (question == null && canApprove) {
                    Button(
                        modifier = Modifier.widthIn(min = 96.dp).heightIn(min = 40.dp),
                        contentPadding = PaddingValues(horizontal = 16.dp),
                        onClick = {
                            completeOrAdvance(
                                replaceDecision(
                                    decision.copy(type = InteractionDecisionType.Approve)
                                )
                            )
                        },
                        enabled = enabled,
                    ) {
                        Text(if (state.busy) "Submitting…" else "Allow once")
                    }
                }
            }
        }
    }
}

private val argumentJson = Json { prettyPrint = true }

private fun interactionPages(
    request: InteractionRequest,
    draft: InteractionDraft,
): List<InteractionPage> =
    request.actions.flatMapIndexed { actionIndex, action ->
        if (action.questions.isEmpty()) {
            listOf(InteractionPage(request, actionIndex))
        } else {
            val rejected =
                draft.decisions.getOrNull(actionIndex)?.type == InteractionDecisionType.Reject
            val indices = if (rejected) listOf(0) else action.questions.indices.toList()

            indices.map { InteractionPage(request, actionIndex, it) }
        }
    }

private fun actionComplete(
    request: InteractionRequest,
    draft: InteractionDraft,
    index: Int,
    now: Instant,
): Boolean {
    val decision = draft.decisions.getOrNull(index) ?: return false
    val singleAction = request.copy(actions = listOf(request.actions[index]))

    return singleAction.respond(InteractionDraft(listOf(decision)), now) != null
}

private fun firstUnfinishedPage(
    request: InteractionRequest,
    draft: InteractionDraft,
    now: Instant,
): InteractionPage? {
    for ((index, action) in request.actions.withIndex()) {
        if (actionComplete(request, draft, index, now)) {
            continue
        }

        val questionIndex =
            if (action.questions.isEmpty()) {
                null
            } else {
                action.questions
                    .indexOfFirst {
                        !answerReady(draft.decisions.getOrNull(index)?.answers?.get(it.id))
                    }
                    .coerceAtLeast(0)
            }

        return InteractionPage(request, index, questionIndex)
    }

    return null
}

private fun answerReady(answer: String?): Boolean = !answer.isNullOrBlank() && answer.length <= 4000

@Composable
private fun InteractionQuestionContent(
    question: InteractionQuestion,
    decision: InteractionDecisionDraft,
    enabled: Boolean,
    onEdit: (InteractionDecisionDraft) -> Unit,
) {
    val answer = decision.answers[question.id].orEmpty()
    val mode =
        decision.answerModes[question.id]
            ?: InteractionAnswerMode.Custom.takeIf { answer.isNotEmpty() }
    val customText =
        decision.customAnswers[question.id]
            ?: answer.takeIf { mode == InteractionAnswerMode.Custom }.orEmpty()

    if (question.options.isNotEmpty()) {
        Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            question.options.forEachIndexed { index, option ->
                InteractionChoice(
                    option.label,
                    option.description,
                    mode == InteractionAnswerMode.Suggested(index),
                    enabled,
                    Modifier.testTag("interaction-option-${question.id}-$index"),
                    number = index + 1,
                ) {
                    onEdit(
                        decision.copy(
                            type = InteractionDecisionType.Respond,
                            answers = decision.answers + (question.id to option.label),
                            answerModes =
                                decision.answerModes +
                                    (question.id to InteractionAnswerMode.Suggested(index)),
                            customAnswers = decision.customAnswers + (question.id to customText),
                        )
                    )
                }
            }

            InteractionChoice(
                "Write your own answer",
                null,
                mode == InteractionAnswerMode.Custom,
                enabled,
                Modifier.testTag("interaction-other-${question.id}"),
            ) {
                onEdit(
                    decision.copy(
                        type = InteractionDecisionType.Respond,
                        answers = decision.answers + (question.id to customText),
                        answerModes =
                            decision.answerModes + (question.id to InteractionAnswerMode.Custom),
                        customAnswers = decision.customAnswers + (question.id to customText),
                    )
                )
            }
        }
    }

    if (question.options.isEmpty() || mode == InteractionAnswerMode.Custom) {
        OutlinedTextField(
            answer,
            { text ->
                onEdit(
                    decision.copy(
                        type = InteractionDecisionType.Respond,
                        answers = decision.answers + (question.id to text),
                        answerModes =
                            decision.answerModes + (question.id to InteractionAnswerMode.Custom),
                        customAnswers = decision.customAnswers + (question.id to text),
                    )
                )
            },
            label = { Text("Your answer") },
            enabled = enabled,
            isError = answer.length > 4000,
            supportingText = {
                if (answer.length > 4000) {
                    Text("Use 4000 characters or fewer.")
                }
            },
            maxLines = 3,
            modifier = Modifier.fillMaxWidth().testTag("interaction-answer-${question.id}"),
        )
    }
}

@Composable
private fun InteractionChoice(
    label: String,
    description: String?,
    selected: Boolean,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    number: Int? = null,
    onSelect: () -> Unit,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(
                if (selected) MaterialTheme.colorScheme.surfaceContainerHighest
                else androidx.compose.ui.graphics.Color.Transparent
            )
            .selectable(selected, enabled = enabled, role = Role.RadioButton, onClick = onSelect)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (number != null) {
            Surface(
                Modifier.size(28.dp),
                shape = RoundedCornerShape(6.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(number.toString(), style = MaterialTheme.typography.bodyMedium)
                }
            }
        } else {
            Icon(
                Icons.Outlined.Edit,
                null,
                Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            description?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

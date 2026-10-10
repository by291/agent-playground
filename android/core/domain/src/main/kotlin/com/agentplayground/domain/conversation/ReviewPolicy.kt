package com.agentplayground.domain.conversation

import com.agui.core.types.ResumeEntry
import java.time.Instant

/** Validates review intent without admitting a run or mutating the session. */
internal sealed interface ReviewResolution {
    data class Submit(val entries: List<ResumeEntry>) : ReviewResolution

    data class SelectPlan(val interruptId: String, val action: String, val draft: PlanDraft) :
        ReviewResolution

    data object InvalidPlans : ReviewResolution
}

internal fun resolveReview(
    current: SessionState,
    interruptId: String,
    action: String,
    plan: PlanDraft?,
    planInterruptIds: Set<String>?,
    now: Instant,
): ReviewResolution? {
    val review = current.interrupts.find { it.id == interruptId }?.let(Review::from) ?: return null

    if (review.kind != "experiment_plan_review") {
        val response = review.respond(action, now = now) ?: return null

        return ReviewResolution.Submit(listOf(response))
    }

    val draft = plan ?: current.planDrafts[interruptId] ?: PlanDraft(review.title, review.steps)
    val response = review.respond(action, plan = draft, now = now) ?: return null

    if (planInterruptIds != null && interruptId !in planInterruptIds) {
        return null
    }

    if (pendingPlanReviews(current, planInterruptIds).size > 1) {
        return ReviewResolution.SelectPlan(interruptId, action, draft)
    }

    return ReviewResolution.Submit(listOf(response))
}

internal fun resolvePlanReviews(
    current: SessionState,
    planInterruptIds: Set<String>?,
    now: Instant,
): ReviewResolution? {
    val plans = pendingPlanReviews(current, planInterruptIds)

    if (plans.size < 2 || plans.any { it.interrupt.id !in current.planDecisions }) {
        return null
    }

    val responses = plans.map { review ->
        review.respond(
            current.planDecisions.getValue(review.interrupt.id),
            plan = current.planDrafts[review.interrupt.id],
            now = now,
        )
    }

    if (responses.any { it == null }) {
        return ReviewResolution.InvalidPlans
    }

    return ReviewResolution.Submit(responses.filterNotNull())
}

internal fun canEditPlanReview(current: SessionState, interruptId: String, now: Instant): Boolean {
    val review = current.interrupts.find { it.id == interruptId }?.let(Review::from)

    return review?.kind == "experiment_plan_review" && !review.expiredAt(now)
}

// The renderer can replace old plan editors with durable completed workflow outputs.
// Only explicitly presented plan IDs participate; each response is revalidated above.
private fun pendingPlanReviews(
    current: SessionState,
    planInterruptIds: Set<String>?,
): List<Review> =
    current.interrupts.mapNotNull(Review::from).filter {
        it.kind == "experiment_plan_review" &&
            (planInterruptIds == null || it.interrupt.id in planInterruptIds)
    }

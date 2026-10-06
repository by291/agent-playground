package com.agentplayground.core

import com.agui.core.types.Interrupt
import java.time.Instant
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

class ReviewPolicyTest {
    @Test
    fun `multiple plans select a draft without admitting a response or mutating state`() {
        val current = SessionState("thread", interrupts = listOf(plan("first"), plan("second")))
        val draft = PlanDraft("Edited", listOf("Edited step"))

        val resolution = resolveReview(current, "first", "approve", draft, null, now)

        assertEquals(ReviewResolution.SelectPlan("first", "approve", draft), resolution)
        assertTrue(current.planDecisions.isEmpty())
        assertTrue(current.planDrafts.isEmpty())
    }

    @Test
    fun `presented plan IDs determine immediate normalized submission`() {
        val current = SessionState("thread", interrupts = listOf(plan("old"), plan("presented")))
        val draft = PlanDraft("  Edited  ", listOf("  First  ", "", "Second "))

        val resolution =
            resolveReview(current, "presented", "approve", draft, setOf("presented"), now)
                as ReviewResolution.Submit
        val entry = resolution.entries.single()
        val payload = entry.payload!!.jsonObject

        assertEquals("presented", entry.interruptId)
        assertEquals("Edited", payload.string("title"))
        assertEquals(protocolJson.parseToJsonElement("[\"First\",\"Second\"]"), payload["steps"])
        assertNull(resolveReview(current, "old", "approve", null, setOf("presented"), now))
    }

    @Test
    fun `batch requires all presented decisions and validates expiry again`() {
        val current =
            SessionState(
                "thread",
                interrupts =
                    listOf(plan("first", "2030-01-01T00:00:01Z"), plan("second"), plan("old")),
                planDecisions = mapOf("first" to "approve"),
            )
        val presented = setOf("first", "second")
        val selected = current.copy(planDecisions = current.planDecisions + ("second" to "reject"))

        val ready = resolvePlanReviews(selected, presented, now) as ReviewResolution.Submit
        val expired = resolvePlanReviews(selected, presented, now.plusSeconds(2))

        assertNull(resolvePlanReviews(current, presented, now))
        assertEquals(listOf("first", "second"), ready.entries.map { it.interruptId })
        assertEquals(ReviewResolution.InvalidPlans, expired)
        assertEquals(mapOf("first" to "approve", "second" to "reject"), selected.planDecisions)
    }

    @Test
    fun `invalid approval draft blocks submission while rejection remains valid`() {
        val current =
            SessionState(
                "thread",
                interrupts = listOf(plan("first"), plan("second")),
                planDecisions = mapOf("first" to "approve", "second" to "reject"),
                planDrafts = mapOf("first" to PlanDraft(" ", listOf(" "))),
            )

        val invalid = resolvePlanReviews(current, null, now)
        val rejected =
            resolvePlanReviews(
                current.copy(planDecisions = mapOf("first" to "reject", "second" to "reject")),
                null,
                now,
            )

        assertEquals(ReviewResolution.InvalidPlans, invalid)
        assertTrue(rejected is ReviewResolution.Submit)
        assertTrue(canEditPlanReview(current, "first", now))
        assertFalse(canEditPlanReview(current, "missing", now))
    }

    private val now = Instant.parse("2030-01-01T00:00:00Z")

    private fun plan(id: String, expiresAt: String? = null) =
        Interrupt(
            id,
            "human_approval",
            expiresAt = expiresAt,
            metadata =
                protocolJson.parseToJsonElement(
                    """{"langgraph":{"raw":{"kind":"experiment_plan_review","title":"Plan","steps":["Step"]}}}"""
                ),
        )
}

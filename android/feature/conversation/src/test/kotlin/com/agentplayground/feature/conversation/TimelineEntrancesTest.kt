package com.agentplayground.feature.conversation

import com.agentplayground.feature.conversation.ui.timeline.TimelineEntrances
import org.junit.Assert.*
import org.junit.Test

class TimelineEntrancesTest {
    @Test
    fun `initial history and recovery never replay reply entrances`() {
        val entrances = TimelineEntrances()

        entrances.observe(setOf("history"), loading = false)
        assertFalse(entrances.consume("history"))

        entrances.observe(setOf("history"), loading = true)
        entrances.observe(setOf("history", "restored"), loading = false)
        assertFalse(entrances.consume("restored"))

        entrances.observe(setOf("history", "restored", "new"), loading = false)
        assertTrue(entrances.consume("new"))
    }

    @Test
    fun `new entries animate once and streaming recomposition does not replay them`() {
        val entrances = TimelineEntrances()

        entrances.observe(emptySet(), loading = false)
        entrances.observe(setOf("user", "reply"), loading = false)

        assertTrue(entrances.consume("user"))
        assertTrue(entrances.consume("reply"))

        entrances.observe(setOf("user", "reply"), loading = false)

        assertFalse(entrances.consume("reply"))
        assertFalse(entrances.consume("user"))
    }
}

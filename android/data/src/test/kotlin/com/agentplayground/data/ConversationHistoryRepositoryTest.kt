package com.agentplayground.data

import com.agentplayground.core.model.ConversationPage
import com.agentplayground.core.model.ConversationSummary
import com.agentplayground.data.conversation.ConversationHistoryRepository
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test

class ConversationHistoryRepositoryTest {
    @Test
    fun `refresh replaces every loaded page after a new conversation shifts the boundary`() =
        runBlocking {
            var shifted = false
            val history =
                ConversationHistoryRepository(this) { cursor ->
                    val start = if (cursor == null) 1 else 31
                    val offset = if (shifted) -1 else 0
                    ConversationPage(
                        rows(start + offset, start + offset + 29),
                        if (cursor == null) "tail" else "end",
                    )
                }

            history.refresh()
            yield()
            history.loadMore()
            yield()
            assertEquals(60, history.state.value.conversations.size)

            shifted = true
            history.refresh()
            yield()

            assertEquals("thread-0", history.state.value.conversations.first().threadId)
            assertEquals("thread-59", history.state.value.conversations.last().threadId)
            assertEquals(1, history.state.value.conversations.count { it.threadId == "thread-30" })
            assertFalse(history.state.value.conversations.any { it.threadId == "thread-60" })
            assertEquals("end", history.state.value.nextCursor)
            history.close()
        }

    @Test
    fun `refresh requested during append preserves the loaded window and coalesces requests`() =
        runBlocking {
            val append = CompletableDeferred<ConversationPage>()
            var headRequests = 0
            var tailRequests = 0
            val history =
                ConversationHistoryRepository(this) { cursor ->
                    if (cursor == null) {
                        headRequests += 1
                        ConversationPage(rows(1, 30), "tail")
                    } else {
                        tailRequests += 1
                        if (tailRequests == 1) append.await() else ConversationPage(rows(31, 60))
                    }
                }

            history.refresh()
            yield()
            history.loadMore()
            yield()
            history.refresh()
            history.refresh()

            assertTrue(history.state.value.loading)
            assertEquals(1, headRequests)
            append.complete(ConversationPage(rows(31, 60)))
            yield()
            yield()

            assertEquals(2, headRequests)
            assertEquals(2, tailRequests)
            assertEquals(60, history.state.value.conversations.size)
            assertFalse(history.state.value.loading)
            history.close()
        }

    @Test
    fun `retrying a failed append clears its error without losing earlier conversations`() =
        runBlocking {
            var failAppend = true
            val history =
                ConversationHistoryRepository(this) { cursor ->
                    if (cursor == null) {
                        ConversationPage(rows(1, 30), "tail")
                    } else if (failAppend) {
                        throw java.io.IOException("Page unavailable")
                    } else {
                        ConversationPage(rows(31, 31))
                    }
                }

            history.refresh()
            yield()
            history.loadMore()
            yield()
            assertEquals("Page unavailable", history.state.value.error)
            assertEquals(30, history.state.value.conversations.size)

            failAppend = false
            history.loadMore()
            yield()

            assertNull(history.state.value.error)
            assertEquals("thread-1", history.state.value.conversations.first().threadId)
            assertEquals("thread-31", history.state.value.conversations.last().threadId)
            assertNull(history.state.value.nextCursor)
            history.close()
        }

    @Test
    fun `closing cancels a pending page without replacing the loaded history`() = runBlocking {
        val pending = CompletableDeferred<ConversationPage>()
        val history = ConversationHistoryRepository(this) { pending.await() }

        history.refresh()
        yield()
        assertTrue(history.state.value.loading)
        history.close()
        yield()
        pending.complete(ConversationPage(rows(1, 30)))
        yield()

        assertTrue(history.state.value.conversations.isEmpty())
        assertNull(history.state.value.error)
        assertFalse(history.state.value.loading)
    }

    private fun rows(first: Int, last: Int): List<ConversationSummary> =
        (first..last).map { ConversationSummary("thread-$it", "Conversation $it", "now", "now") }
}

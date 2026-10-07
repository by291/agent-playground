package com.agentplayground.data.conversation

import com.agentplayground.core.model.ConversationPage
import com.agentplayground.core.model.ConversationSummary
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Server-scoped history loading; the ViewModel still owns selection and journal mutations. */
class ConversationHistoryRepository(
    private val scope: CoroutineScope,
    private val fetchPage: suspend (String?) -> ConversationPage,
) : AutoCloseable {
    private val mutable = MutableStateFlow(ConversationHistoryState())
    val state = mutable.asStateFlow()

    private var request: Job? = null
    private var refreshRequested = false
    private var closed = false

    fun refresh() {
        if (request?.isActive == true) {
            refreshRequested = true
            return
        }

        load {
            // Re-read the entire loaded window: changes at the head shift every later cursor
            // boundary.
            val conversations = mutableListOf<ConversationSummary>()
            val desired = mutable.value.conversations.size.coerceAtLeast(30)
            var cursor: String? = null

            do {
                val page = fetchPage(cursor)
                conversations += page.conversations
                cursor = page.nextCursor
            } while (cursor != null && conversations.size < desired)

            mutable.update {
                it.copy(
                    conversations = conversations.distinctBy { row -> row.threadId },
                    nextCursor = cursor,
                    error = null,
                )
            }
        }
    }

    fun loadMore() {
        val cursor = mutable.value.nextCursor ?: return

        if (request?.isActive == true) {
            return
        }

        load {
            val page = fetchPage(cursor)

            mutable.update {
                it.copy(
                    conversations =
                        (it.conversations + page.conversations).distinctBy { row -> row.threadId },
                    nextCursor = page.nextCursor,
                    error = null,
                )
            }
        }
    }

    private fun load(block: suspend () -> Unit) {
        if (closed) {
            return
        }

        request = scope.launch {
            mutable.update { it.copy(loading = true) }

            try {
                block()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                mutable.update { it.copy(error = error.message) }
            } finally {
                mutable.update { it.copy(loading = false) }
                request = null

                if (refreshRequested) {
                    refreshRequested = false
                    refresh()
                }
            }
        }
    }

    override fun close() {
        closed = true
        refreshRequested = false
        request?.cancel()
    }
}

data class ConversationHistoryState(
    val conversations: List<ConversationSummary> = emptyList(),
    val nextCursor: String? = null,
    val loading: Boolean = false,
    val error: String? = null,
)

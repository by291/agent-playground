package com.agentplayground.domain.repository

import com.agentplayground.domain.model.MemoryPage
import com.agentplayground.domain.model.MemoryRecord

/**
 * Server-scoped memory access, owned and closed by the creating ViewModel.
 *
 * Corrections and deletions use the supplied record's revision. A conflict requires reviewing the
 * latest record before another write; a failed response may still follow a committed mutation.
 */
interface MemoryRepository : AutoCloseable {
    suspend fun page(offset: Int = 0): MemoryPage

    suspend fun correct(memory: MemoryRecord, text: String): MemoryRecord

    suspend fun forget(memory: MemoryRecord)
}

package com.agentplayground.domain.repository

import com.agentplayground.domain.model.MemoryPage
import com.agentplayground.domain.model.MemoryRecord

interface MemoryRepository : AutoCloseable {
    suspend fun page(offset: Int = 0): MemoryPage

    suspend fun correct(memory: MemoryRecord, text: String): MemoryRecord

    suspend fun forget(memory: MemoryRecord)
}

package com.agentplayground.data.memory

import com.agentplayground.core.model.MemoryPage
import com.agentplayground.core.model.MemoryRecord
import com.agentplayground.core.network.PlaygroundApi

/** Owns memory management transactions and its HTTP client for one server. */
class MemoryRepository(private val api: PlaygroundApi) : AutoCloseable {
    suspend fun page(offset: Int = 0): MemoryPage = api.memories(offset)

    suspend fun correct(memory: MemoryRecord, text: String): MemoryRecord =
        api.correctMemory(memory, text)

    suspend fun forget(memory: MemoryRecord) = api.forgetMemory(memory)

    override fun close() {
        api.close()
    }
}

package com.agentplayground.data.memory

import com.agentplayground.data.network.PlaygroundApi
import com.agentplayground.domain.model.MemoryPage
import com.agentplayground.domain.model.MemoryRecord
import com.agentplayground.domain.repository.MemoryRepository

/** Owns memory management transactions and its HTTP client for one server. */
internal class DefaultMemoryRepository(private val api: PlaygroundApi) : MemoryRepository {
    override suspend fun page(offset: Int): MemoryPage = api.memories(offset)

    override suspend fun correct(memory: MemoryRecord, text: String): MemoryRecord =
        api.correctMemory(memory, text)

    override suspend fun forget(memory: MemoryRecord) = api.forgetMemory(memory)

    override fun close() {
        api.close()
    }
}

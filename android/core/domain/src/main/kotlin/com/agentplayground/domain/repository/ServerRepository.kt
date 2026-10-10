package com.agentplayground.domain.repository

interface ServerRepository {
    fun normalizeUrl(value: String): String

    suspend fun checkConnection(serverUrl: String): String
}

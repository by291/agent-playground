package com.agentplayground.domain.repository

/** URL validation and short-lived connection checks, independent of conversation resources. */
interface ServerRepository {
    fun normalizeUrl(value: String): String

    /** Verifies health and agent metadata, returning the configured model name on success. */
    suspend fun checkConnection(serverUrl: String): String
}

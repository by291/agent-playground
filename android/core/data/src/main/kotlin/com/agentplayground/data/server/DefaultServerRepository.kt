package com.agentplayground.data.server

import com.agentplayground.data.network.PlaygroundApi
import com.agentplayground.data.network.normalizeServerUrl
import com.agentplayground.domain.repository.ServerRepository

internal class DefaultServerRepository : ServerRepository {
    override fun normalizeUrl(value: String): String = normalizeServerUrl(value)

    override suspend fun checkConnection(serverUrl: String): String =
        PlaygroundApi(serverUrl).use { api ->
            require(api.health()) { "The server health check failed." }

            api.info().model
        }
}

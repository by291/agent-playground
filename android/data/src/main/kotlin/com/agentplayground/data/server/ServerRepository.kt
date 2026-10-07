package com.agentplayground.data.server

import com.agentplayground.core.network.PlaygroundApi

class ServerRepository {
    suspend fun checkConnection(serverUrl: String): String =
        PlaygroundApi(serverUrl).use { api ->
            require(api.health()) { "The server health check failed." }

            api.info().model
        }
}

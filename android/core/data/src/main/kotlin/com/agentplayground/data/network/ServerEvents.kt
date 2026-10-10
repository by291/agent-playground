package com.agentplayground.data.network

import com.agentplayground.domain.conversation.ServerEvent
import com.agentplayground.domain.model.ApiException
import java.io.IOException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

/** Bridges the library's SSE callback lifecycle to a bounded Flow. */
internal class ServerEvents(client: OkHttpClient) {
    private val sources = EventSources.createFactory(client)

    fun events(request: Request): Flow<ServerEvent> = callbackFlow {
        val source =
            sources.newEventSource(
                request.newBuilder().header("Accept", "text/event-stream").build(),
                object : EventSourceListener() {
                    override fun onEvent(
                        eventSource: EventSource,
                        id: String?,
                        type: String?,
                        data: String,
                    ) {
                        if (trySend(ServerEvent(type, data)).isFailure) {
                            close(
                                IOException(
                                    "Event delivery overflow; recover the conversation snapshot."
                                )
                            )
                            eventSource.cancel()
                        }
                    }

                    override fun onClosed(eventSource: EventSource) {
                        close()
                    }

                    override fun onFailure(
                        eventSource: EventSource,
                        t: Throwable?,
                        response: Response?,
                    ) {
                        close(
                            response?.let {
                                ApiException(it.code, "Event stream failed (${it.code}).")
                            } ?: t ?: IOException("Event stream disconnected.")
                        )
                    }
                },
            )

        awaitClose { source.cancel() }
    }
}

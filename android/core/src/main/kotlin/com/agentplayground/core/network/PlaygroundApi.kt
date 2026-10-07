package com.agentplayground.core.network

import com.agentplayground.core.model.AgentInfo
import com.agentplayground.core.model.ConversationPage
import com.agentplayground.core.model.ConversationSnapshot
import com.agentplayground.core.model.KnowledgeDocument
import com.agentplayground.core.model.RenamedConversation
import com.agentplayground.core.model.SkillFile
import com.agentplayground.core.model.protocolJson
import com.agentplayground.core.model.string
import com.agentplayground.core.model.validateFile
import com.agui.core.types.BaseEvent
import com.agui.core.types.RunAgentInput
import java.io.IOException
import java.io.OutputStream
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

class ApiException(val status: Int, message: String) : IOException(message)

data class ServerEvent(val name: String?, val data: String)

interface ConversationApi {
    suspend fun snapshot(threadId: String): ConversationSnapshot?

    fun run(input: RunAgentInput): Flow<BaseEvent>

    fun changes(threadId: String): Flow<ServerEvent>

    suspend fun submitExternalTaskInput(taskId: String, input: String)

    suspend fun cancelExternalTask(taskId: String)
}

class PlaygroundApi(baseUrl: String) : ConversationApi, AutoCloseable {
    val baseUrl = normalizeServerUrl(baseUrl)
    private val root = this.baseUrl.toHttpUrl()
    private val client =
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .callTimeout(45, TimeUnit.SECONDS)
            .build()
    private val streaming =
        client
            .newBuilder()
            .callTimeout(0, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build()

    private fun url(vararg segments: String, cursor: String? = null): HttpUrl {
        val builder = root.newBuilder()
        segments.forEach { builder.addPathSegment(it) }

        if (cursor != null) {
            builder.addQueryParameter("cursor", cursor)
        }

        return builder.build()
    }

    suspend fun health(): Boolean =
        request(Request.Builder().url(url("health")).build()).use { it.isSuccessful }

    suspend fun info(): AgentInfo = get(url("agent-info"))

    suspend fun conversations(cursor: String? = null): ConversationPage =
        get(url("conversations", cursor = cursor))

    override suspend fun snapshot(threadId: String): ConversationSnapshot? {
        val response = request(Request.Builder().url(url("conversations", threadId)).build())

        return response.use {
            if (it.code == 404) {
                null
            } else {
                decode<ConversationSnapshot>(it)
            }
        }
    }

    suspend fun rename(threadId: String, title: String): RenamedConversation {
        val trimmed = title.trim()

        require(trimmed.isNotEmpty() && trimmed.codePointCount(0, trimmed.length) <= 100) {
            "Enter a title between 1 and 100 characters."
        }

        val body = buildJsonObject { put("title", trimmed) }.toString().toRequestBody(JSON)

        return request(Request.Builder().url(url("conversations", threadId)).patch(body).build())
            .use { decode(it) }
    }

    override suspend fun submitExternalTaskInput(taskId: String, input: String) {
        val trimmed = input.trim()

        require(input.length <= 4000 && trimmed.isNotEmpty()) {
            "Provide additional information up to 4000 characters."
        }

        val body = buildJsonObject { put("input", trimmed) }.toString().toRequestBody(JSON)

        request(Request.Builder().url(url("external-tasks", taskId, "input")).post(body).build())
            .use { checkResponse(it) }
    }

    override suspend fun cancelExternalTask(taskId: String) {
        request(
                Request.Builder()
                    .url(url("external-tasks", taskId, "cancel"))
                    .post(ByteArray(0).toRequestBody())
                    .build()
            )
            .use { checkResponse(it) }
    }

    suspend fun deleteConversation(threadId: String) = delete(url("conversations", threadId))

    suspend fun clearConversations() = delete(url("conversations"))

    suspend fun documents(): List<KnowledgeDocument> = get(url("api", "knowledge", "documents"))

    suspend fun deleteDocument(id: String) = delete(url("api", "knowledge", "documents", id))

    suspend fun reindex(id: String, textEncoding: String? = null): KnowledgeDocument {
        val requestBuilder =
            Request.Builder()
                .url(url("api", "knowledge", "documents", id, "reindex"))
                .post(ByteArray(0).toRequestBody())

        if (textEncoding != null) {
            requestBuilder.header("X-Text-Encoding", textEncoding)
        }

        return request(requestBuilder.build()).use { decode(it) }
    }

    suspend fun uploadFile(threadId: String, id: String, name: String, data: ByteArray): SkillFile {
        validateFile(name, data.size.toLong())

        val file =
            upload<SkillFile>(url("conversations", threadId, "files"), "X-File-Id", id, name, data)

        require(file.id == id && file.threadId == threadId && file.name == name) {
            "File upload returned an unexpected identity."
        }

        return file
    }

    suspend fun uploadDocument(id: String, name: String, data: ByteArray): KnowledgeDocument {
        validateFile(name, data.size.toLong())

        val document =
            upload<KnowledgeDocument>(
                url("api", "knowledge", "documents"),
                "X-Document-Id",
                id,
                name,
                data,
            )

        require(document.id == id && document.name == name) {
            "Document upload returned an unexpected identity."
        }

        return document
    }

    fun filePath(file: SkillFile): String = filePath(file.threadId, file.id)

    fun filePath(threadId: String, fileId: String): String =
        url("conversations", threadId, "files", fileId).toString()

    fun filePreviewPath(threadId: String, fileId: String, thumbnail: Boolean): String {
        val preview = url("conversations", threadId, "files", fileId, "preview").newBuilder()

        if (thumbnail) {
            preview.addQueryParameter("size", "thumbnail")
        }

        return preview.build().toString()
    }

    fun documentPath(id: String): String =
        url("api", "knowledge", "documents", id, "file").toString()

    suspend fun download(address: String, target: OutputStream) {
        val requested = address.toHttpUrl()

        require(
            requested.scheme == root.scheme &&
                requested.host == root.host &&
                requested.port == root.port
        ) {
            "Download must belong to the configured server."
        }

        request(Request.Builder().url(requested).build()).use { response ->
            checkResponse(response)

            response.body!!.byteStream().use { it.copyTo(target) }
        }
    }

    override fun run(input: RunAgentInput): Flow<BaseEvent> {
        val body = protocolJson.encodeToString(input).toRequestBody(JSON)

        return events(Request.Builder().url(url("agent")).post(body).build()).map {
            protocolJson.decodeFromString<BaseEvent>(it.data)
        }
    }

    override fun changes(threadId: String): Flow<ServerEvent> =
        events(Request.Builder().url(url("conversations", threadId, "events")).build())

    private fun events(request: Request): Flow<ServerEvent> = callbackFlow {
        val source =
            EventSources.createFactory(streaming)
                .newEventSource(
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

    private suspend fun request(request: Request): Response =
        suspendCancellableCoroutine { continuation ->
            val call = client.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }

            call.enqueue(
                object : Callback {
                    override fun onFailure(call: Call, e: IOException) {
                        if (continuation.isActive) {
                            continuation.resumeWith(Result.failure(e))
                        }
                    }

                    override fun onResponse(call: Call, response: Response) {
                        try {
                            // Buffer bounded application responses on OkHttp's thread, never the
                            // main thread.
                            val buffered = response.use {
                                val body = it.body

                                it.newBuilder()
                                    .body(body?.bytes()?.toResponseBody(body.contentType()))
                                    .build()
                            }

                            continuation.resume(buffered) { _, value, _ -> value.close() }
                        } catch (error: IOException) {
                            if (continuation.isActive) {
                                continuation.resumeWith(Result.failure(error))
                            }
                        }
                    }
                }
            )
        }

    private suspend inline fun <reified T> get(url: HttpUrl): T =
        request(Request.Builder().url(url).build()).use { decode(it) }

    private suspend inline fun <reified T> upload(
        url: HttpUrl,
        header: String,
        id: String,
        name: String,
        bytes: ByteArray,
    ): T {
        val request =
            Request.Builder()
                .url(url)
                .header(header, id)
                .header("X-Filename", URLEncoder.encode(name, "UTF-8").replace("+", "%20"))
                .post(bytes.toRequestBody("application/octet-stream".toMediaType()))
                .build()

        return request(request).use { decode(it) }
    }

    private suspend fun delete(url: HttpUrl) {
        request(Request.Builder().url(url).delete().build()).use { checkResponse(it) }
    }

    private inline fun <reified T> decode(response: Response): T {
        checkResponse(response)

        return protocolJson.decodeFromString(response.body!!.string())
    }

    private fun checkResponse(response: Response) {
        if (!response.isSuccessful) {
            val detail =
                runCatching {
                        protocolJson
                            .parseToJsonElement(response.body?.string().orEmpty())
                            .jsonObject
                            .string("error")
                    }
                    .getOrNull()

            throw ApiException(response.code, detail ?: "Server request failed (${response.code}).")
        }
    }

    override fun close() {
        client.dispatcher.cancelAll()
        client.connectionPool.evictAll()
        client.dispatcher.executorService.shutdown()
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}

fun normalizeServerUrl(value: String): String {
    val url = value.trim().toHttpUrl()

    require(
        url.username.isEmpty() &&
            url.password.isEmpty() &&
            url.query == null &&
            url.fragment == null
    ) {
        "Use a server URL without credentials, query or fragment."
    }

    return url.newBuilder().encodedPath(url.encodedPath.trimEnd('/') + "/").build().toString()
}

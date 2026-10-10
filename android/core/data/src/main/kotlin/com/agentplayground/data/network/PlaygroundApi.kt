package com.agentplayground.data.network

import com.agentplayground.domain.conversation.ConversationApi
import com.agentplayground.domain.conversation.ServerEvent
import com.agentplayground.domain.model.AgentInfo
import com.agentplayground.domain.model.ConversationModel
import com.agentplayground.domain.model.ConversationPage
import com.agentplayground.domain.model.ConversationSnapshot
import com.agentplayground.domain.model.KnowledgeDocument
import com.agentplayground.domain.model.MemoryPage
import com.agentplayground.domain.model.MemoryRecord
import com.agentplayground.domain.model.RenamedConversation
import com.agentplayground.domain.model.SkillFile
import com.agentplayground.domain.model.protocolJson
import com.agentplayground.domain.model.validateFile
import com.agentplayground.domain.model.validateMemoryText
import com.agui.core.types.BaseEvent
import com.agui.core.types.RunAgentInput
import java.io.IOException
import java.io.OutputStream
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Retrofit
import retrofit2.awaitResponse
import retrofit2.converter.kotlinx.serialization.asConverterFactory

internal class PlaygroundApi(baseUrl: String) : ConversationApi, AutoCloseable {
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

    private val events = ServerEvents(streaming)
    private val service =
        Retrofit.Builder()
            .baseUrl(root)
            .client(client)
            .addConverterFactory(protocolJson.asConverterFactory(JSON))
            .build()
            .create(PlaygroundService::class.java)

    private fun url(vararg segments: String, cursor: String? = null): HttpUrl {
        val builder = root.newBuilder()
        segments.forEach { builder.addPathSegment(it) }

        if (cursor != null) {
            builder.addQueryParameter("cursor", cursor)
        }

        return builder.build()
    }

    suspend fun health(): Boolean =
        service.health().let { response ->
            response.errorBody()?.close()
            response.isSuccessful
        }

    suspend fun info(): AgentInfo = service.info().requireBody()

    suspend fun conversations(cursor: String? = null): ConversationPage =
        service.conversations(cursor).requireBody()

    override suspend fun snapshot(threadId: String): ConversationSnapshot? {
        val response = service.snapshot(threadId)
        if (response.code() == 404) {
            response.errorBody()?.close()
            return null
        }

        return response.requireBody()
    }

    override suspend fun selectModel(threadId: String, modelId: String): ConversationModel {
        val body = buildJsonObject { put("modelId", modelId) }
        val selected = service.selectModel(threadId, body).requireBody()

        require(selected.threadId == threadId && selected.modelId == modelId) {
            "Model selection returned an unexpected identity."
        }

        return selected
    }

    suspend fun rename(threadId: String, title: String): RenamedConversation {
        val trimmed = title.trim()

        require(trimmed.isNotEmpty() && trimmed.codePointCount(0, trimmed.length) <= 100) {
            "Enter a title between 1 and 100 characters."
        }

        val body = buildJsonObject { put("title", trimmed) }

        return service.rename(threadId, body).requireBody()
    }

    override suspend fun submitExternalTaskInput(taskId: String, input: String) {
        val trimmed = input.trim()

        require(input.length <= 4000 && trimmed.isNotEmpty()) {
            "Provide additional information up to 4000 characters."
        }

        val body = buildJsonObject { put("input", trimmed) }

        service.submitExternalTaskInput(taskId, body).checkResponse()
    }

    override suspend fun cancelExternalTask(taskId: String) {
        service.cancelExternalTask(taskId).checkResponse()
    }

    suspend fun deleteConversation(threadId: String) =
        service.deleteConversation(threadId).checkResponse()

    suspend fun clearConversations() = service.clearConversations().checkResponse()

    suspend fun documents(): List<KnowledgeDocument> = service.documents().requireBody()

    suspend fun memories(offset: Int = 0): MemoryPage {
        require(offset in 0..1_000_000) { "Invalid memory offset." }

        val page = service.memories(offset).requireBody()
        val nextOffset = page.nextOffset

        require(nextOffset == null || nextOffset > offset && nextOffset <= 1_000_000) {
            "Memory pagination did not advance."
        }

        return page
    }

    suspend fun correctMemory(memory: MemoryRecord, text: String): MemoryRecord {
        val trimmed = validateMemoryText(text)
        val updated =
            service.correctMemory(memory.id, memoryMutation(memory, trimmed)).requireBody()

        require(
            updated.id == memory.id &&
                updated.category == memory.category &&
                updated.project == memory.project
        ) {
            "Memory correction returned an unexpected identity."
        }

        return updated
    }

    suspend fun forgetMemory(memory: MemoryRecord) {
        service.forgetMemory(memory.id, memoryMutation(memory)).checkResponse()
    }

    private fun memoryMutation(memory: MemoryRecord, text: String? = null) = buildJsonObject {
        put("category", memory.category)
        put("project", memory.project?.let(::JsonPrimitive) ?: JsonNull)
        put("revision", memory.revision)

        if (text != null) {
            put("text", text)
        }
    }

    suspend fun deleteDocument(id: String) = service.deleteDocument(id).checkResponse()

    suspend fun reindex(id: String, textEncoding: String? = null): KnowledgeDocument =
        service.reindex(id, textEncoding).requireBody()

    suspend fun uploadFile(threadId: String, id: String, name: String, data: ByteArray): SkillFile {
        validateFile(name, data.size.toLong())

        val file =
            service
                .uploadFile(threadId, id, encodedFilename(name), data.toRequestBody(BINARY))
                .requireBody()

        require(file.id == id && file.threadId == threadId && file.name == name) {
            "File upload returned an unexpected identity."
        }

        return file
    }

    suspend fun uploadDocument(id: String, name: String, data: ByteArray): KnowledgeDocument {
        validateFile(name, data.size.toLong())

        val document =
            service
                .uploadDocument(id, encodedFilename(name), data.toRequestBody(BINARY))
                .requireBody()

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

        val call = service.download(requested.toString())
        var responseBody: ResponseBody? = null

        try {
            coroutineScope {
                try {
                    val body = call.awaitResponse().requireBody()
                    responseBody = body
                    // The cancellable await can abort a socket while its child is blocked in IO.
                    async(Dispatchers.IO) {
                            try {
                                body.byteStream().use { it.copyTo(target) }
                            } catch (cause: IOException) {
                                // Socket cancellation remains coroutine cancellation to callers.
                                coroutineContext.ensureActive()
                                throw cause
                            }
                        }
                        .await()
                } finally {
                    // Header delivery does not end ownership of the streaming call.
                    call.cancel()
                }
            }
        } finally {
            // Join the reader before closing its source; Okio timeouts cannot be used concurrently.
            responseBody?.close()
        }
    }

    override fun run(input: RunAgentInput): Flow<BaseEvent> {
        val body = protocolJson.encodeToString(input).toRequestBody(JSON)

        return events.events(Request.Builder().url(url("agent")).post(body).build()).map {
            protocolJson.decodeFromString<BaseEvent>(it.data)
        }
    }

    override fun changes(threadId: String): Flow<ServerEvent> =
        events.events(Request.Builder().url(url("conversations", threadId, "events")).build())

    private fun encodedFilename(name: String): String =
        URLEncoder.encode(name, "UTF-8").replace("+", "%20")

    override fun close() {
        client.dispatcher.cancelAll()
        client.connectionPool.evictAll()
        client.dispatcher.executorService.shutdown()
    }

    companion object {
        private val BINARY = "application/octet-stream".toMediaType()
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}

package com.agentplayground.data.network

import com.agentplayground.domain.model.*
import kotlinx.serialization.json.JsonObject
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Call
import retrofit2.Response
import retrofit2.http.*

/** REST transport. Coroutine cancellation and JSON conversion are owned by Retrofit. */
internal interface PlaygroundService {
    @GET("health") suspend fun health(): Response<Unit>

    @GET("agent-info") suspend fun info(): Response<AgentInfo>

    @GET("conversations")
    suspend fun conversations(@Query("cursor") cursor: String?): Response<ConversationPage>

    @GET("conversations/{thread}")
    suspend fun snapshot(@Path("thread") thread: String): Response<ConversationSnapshot>

    @PATCH("conversations/{thread}/model")
    suspend fun selectModel(
        @Path("thread") thread: String,
        @Body body: JsonObject,
    ): Response<ConversationModel>

    @PATCH("conversations/{thread}")
    suspend fun rename(
        @Path("thread") thread: String,
        @Body body: JsonObject,
    ): Response<RenamedConversation>

    @POST("external-tasks/{task}/input")
    suspend fun submitExternalTaskInput(
        @Path("task") task: String,
        @Body body: JsonObject,
    ): Response<Unit>

    @POST("external-tasks/{task}/cancel")
    suspend fun cancelExternalTask(@Path("task") task: String): Response<Unit>

    @DELETE("conversations/{thread}")
    suspend fun deleteConversation(@Path("thread") thread: String): Response<Unit>

    @DELETE("conversations") suspend fun clearConversations(): Response<Unit>

    @GET("api/knowledge/documents") suspend fun documents(): Response<List<KnowledgeDocument>>

    @DELETE("api/knowledge/documents/{id}")
    suspend fun deleteDocument(@Path("id") id: String): Response<Unit>

    @POST("api/knowledge/documents/{id}/reindex")
    suspend fun reindex(
        @Path("id") id: String,
        @Header("X-Text-Encoding") encoding: String?,
    ): Response<KnowledgeDocument>

    @GET("api/memories")
    suspend fun memories(
        @Query("offset") offset: Int,
        @Query("limit") limit: Int = 50,
    ): Response<MemoryPage>

    @PATCH("api/memories/{id}")
    suspend fun correctMemory(
        @Path("id") id: String,
        @Body body: JsonObject,
    ): Response<MemoryRecord>

    @HTTP(method = "DELETE", path = "api/memories/{id}", hasBody = true)
    suspend fun forgetMemory(@Path("id") id: String, @Body body: JsonObject): Response<Unit>

    @POST("conversations/{thread}/files")
    suspend fun uploadFile(
        @Path("thread") thread: String,
        @Header("X-File-Id") id: String,
        @Header("X-Filename") filename: String,
        @Body bytes: RequestBody,
    ): Response<SkillFile>

    @POST("api/knowledge/documents")
    suspend fun uploadDocument(
        @Header("X-Document-Id") id: String,
        @Header("X-Filename") filename: String,
        @Body bytes: RequestBody,
    ): Response<KnowledgeDocument>

    @Streaming @GET fun download(@Url address: String): Call<ResponseBody>
}

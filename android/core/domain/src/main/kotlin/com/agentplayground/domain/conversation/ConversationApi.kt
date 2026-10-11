package com.agentplayground.domain.conversation

import com.agentplayground.domain.model.ConversationModel
import com.agentplayground.domain.model.ConversationSnapshot
import com.agui.core.types.BaseEvent
import com.agui.core.types.RunAgentInput
import kotlinx.coroutines.flow.Flow

data class ServerEvent(val name: String?, val data: String)

/** Transport port borrowed by a session; the repository owns and releases its implementation. */
interface ConversationApi {
    suspend fun selectModel(threadId: String, modelId: String): ConversationModel

    /** Returns null for an unpersisted thread; transport failures remain exceptions. */
    suspend fun snapshot(threadId: String): ConversationSnapshot?

    /** Streams official events; stopping collection releases the local connection. */
    fun run(input: RunAgentInput): Flow<BaseEvent>

    fun changes(threadId: String): Flow<ServerEvent>

    suspend fun submitExternalTaskInput(taskId: String, input: String)

    suspend fun cancelExternalTask(taskId: String)
}

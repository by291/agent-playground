package com.agentplayground.domain.conversation

import com.agentplayground.domain.model.ConversationModel
import com.agentplayground.domain.model.ConversationSnapshot
import com.agui.core.types.BaseEvent
import com.agui.core.types.RunAgentInput
import kotlinx.coroutines.flow.Flow

data class ServerEvent(val name: String?, val data: String)

/** Transport port borrowed by a session; the repository owns and releases its implementation. */
interface ConversationApi {
    /** Stores the conversation model and returns the canonical selection. */
    suspend fun selectModel(threadId: String, modelId: String): ConversationModel

    /** Returns null for an unpersisted thread; transport failures remain exceptions. */
    suspend fun snapshot(threadId: String): ConversationSnapshot?

    /** Streams official events; stopping collection releases the local connection. */
    fun run(input: RunAgentInput): Flow<BaseEvent>

    /** Emits snapshot invalidations until collection ends; the caller owns reconnects. */
    fun changes(threadId: String): Flow<ServerEvent>

    /** Requests continuation with extra input; a subsequent snapshot confirms task state. */
    suspend fun submitExternalTaskInput(taskId: String, input: String)

    /** Requests cancellation; a subsequent snapshot confirms task state. */
    suspend fun cancelExternalTask(taskId: String)
}

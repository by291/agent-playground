package com.agentplayground.domain.repository

import com.agentplayground.domain.conversation.ConversationSession
import com.agentplayground.domain.files.PickedFile
import com.agentplayground.domain.model.AgentInfo
import com.agentplayground.domain.model.ConversationPage
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.MessageAttachment
import com.agentplayground.domain.model.SavedConversation
import com.agentplayground.domain.model.SkillFile
import com.agentplayground.domain.presentation.UploadedAttachment
import kotlinx.coroutines.CoroutineScope

/** The ViewModel owns this server-scoped repository and closes each selected session first. */
interface ConversationRepository : AutoCloseable {
    suspend fun selectedConversation(): SavedConversation?

    suspend fun savedConversation(threadId: String): SavedConversation?

    suspend fun select(saved: SavedConversation)

    fun createSession(scope: CoroutineScope, saved: SavedConversation): ConversationSession

    suspend fun removeSavedConversation(threadId: String)

    suspend fun clearSavedConversations()

    suspend fun conversations(cursor: String?): ConversationPage

    suspend fun agentInfo(): AgentInfo

    suspend fun rename(threadId: String, title: String)

    suspend fun deleteConversation(threadId: String)

    suspend fun clearConversations()

    suspend fun inspectAttachments(uris: List<String>): List<PickedFile>

    suspend fun uploadAttachments(threadId: String, attachments: List<PickedFile>): List<SkillFile>

    suspend fun save(download: Download, target: String)

    fun fileDownload(file: SkillFile): Download

    fun documentDownload(id: String, name: String): Download

    fun attachmentPresentation(threadId: String, attachment: UploadedAttachment): MessageAttachment

    suspend fun attachmentBytes(source: String): ByteArray
}

package com.agentplayground.data.conversation

import com.agentplayground.data.files.DocumentAccess
import com.agentplayground.data.network.PlaygroundApi
import com.agentplayground.domain.conversation.ConversationSession
import com.agentplayground.domain.files.PickedFile
import com.agentplayground.domain.model.AgentInfo
import com.agentplayground.domain.model.ConversationPage
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.ImagePreview
import com.agentplayground.domain.model.MessageAttachment
import com.agentplayground.domain.model.SavedConversation
import com.agentplayground.domain.model.SkillFile
import com.agentplayground.domain.presentation.UploadedAttachment
import com.agentplayground.domain.repository.ConversationJournal
import com.agentplayground.domain.repository.ConversationRepository
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CoroutineScope

/** Server-scoped data access; the screen owns selection and the lifetime of each session. */
internal class DefaultConversationRepository(
    private val api: PlaygroundApi,
    private val journal: ConversationJournal,
    private val files: DocumentAccess,
) : ConversationRepository {
    override suspend fun selectedConversation(): SavedConversation? = journal.read()

    override suspend fun savedConversation(threadId: String): SavedConversation? =
        journal.find(threadId)

    override suspend fun select(saved: SavedConversation) {
        journal.write(saved)
        journal.select(saved.threadId)
    }

    override fun createSession(
        scope: CoroutineScope,
        saved: SavedConversation,
    ): ConversationSession = ConversationSession(api, journal, scope, saved)

    override suspend fun removeSavedConversation(threadId: String) = journal.remove(threadId)

    override suspend fun clearSavedConversations() = journal.clear()

    override suspend fun conversations(cursor: String?): ConversationPage =
        api.conversations(cursor)

    override suspend fun agentInfo(): AgentInfo = api.info()

    override suspend fun rename(threadId: String, title: String) {
        api.rename(threadId, title)
    }

    override suspend fun deleteConversation(threadId: String) = api.deleteConversation(threadId)

    override suspend fun clearConversations() = api.clearConversations()

    override suspend fun inspectAttachments(uris: List<String>): List<PickedFile> = uris.map {
        files.inspect(it)
    }

    override suspend fun uploadAttachments(
        threadId: String,
        attachments: List<PickedFile>,
    ): List<SkillFile> = attachments.map { file ->
        // Retain the selected admission identity across response failures and retries.
        api.uploadFile(threadId, file.id, file.name, files.read(file))
    }

    override suspend fun save(download: Download, target: String) =
        files.save(api, download, target)

    override fun fileDownload(file: SkillFile): Download = Download(api.filePath(file), file.name)

    override fun documentDownload(id: String, name: String): Download =
        Download(api.documentPath(id), name)

    override fun attachmentPresentation(
        threadId: String,
        attachment: UploadedAttachment,
    ): MessageAttachment =
        MessageAttachment(
            attachment.name,
            Download(api.filePath(threadId, attachment.id), attachment.name),
            if (attachment.isImage) {
                ImagePreview(
                    attachment.name,
                    api.filePreviewPath(threadId, attachment.id, thumbnail = true),
                    api.filePreviewPath(threadId, attachment.id, thumbnail = false),
                )
            } else {
                null
            },
        )

    override suspend fun attachmentBytes(source: String): ByteArray {
        val bytes = ByteArrayOutputStream()
        api.download(source, bytes)

        return bytes.toByteArray()
    }

    override fun close() {
        api.close()
    }
}

package com.agentplayground.data.conversation

import android.graphics.Bitmap
import android.net.Uri
import com.agentplayground.core.conversation.ConversationSession
import com.agentplayground.core.model.AgentInfo
import com.agentplayground.core.model.ConversationPage
import com.agentplayground.core.model.Download
import com.agentplayground.core.model.ImagePreview
import com.agentplayground.core.model.MessageAttachment
import com.agentplayground.core.model.SavedConversation
import com.agentplayground.core.model.SkillFile
import com.agentplayground.core.network.PlaygroundApi
import com.agentplayground.core.presentation.UploadedAttachment
import com.agentplayground.data.PreferencesRepository
import com.agentplayground.data.files.AttachmentImages
import com.agentplayground.data.files.DocumentAccess
import com.agentplayground.data.files.PickedFile
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CoroutineScope

/** Server-scoped data access; the screen owns selection and the lifetime of each session. */
class ConversationRepository(
    private val api: PlaygroundApi,
    private val journal: PreferencesRepository.ConversationJournal,
    private val files: DocumentAccess,
    private val images: AttachmentImages? = null,
) : AutoCloseable {
    suspend fun selectedConversation(): SavedConversation? = journal.read()

    suspend fun savedConversation(threadId: String): SavedConversation? = journal.find(threadId)

    suspend fun select(saved: SavedConversation) {
        journal.write(saved)
        journal.select(saved.threadId)
    }

    fun createSession(scope: CoroutineScope, saved: SavedConversation): ConversationSession =
        ConversationSession(api, journal, scope, saved)

    suspend fun removeSavedConversation(threadId: String) = journal.remove(threadId)

    suspend fun clearSavedConversations() = journal.clear()

    suspend fun conversations(cursor: String?): ConversationPage = api.conversations(cursor)

    suspend fun agentInfo(): AgentInfo = api.info()

    suspend fun rename(threadId: String, title: String) {
        api.rename(threadId, title)
    }

    suspend fun deleteConversation(threadId: String) = api.deleteConversation(threadId)

    suspend fun clearConversations() = api.clearConversations()

    suspend fun inspectAttachments(uris: List<Uri>): List<PickedFile> = uris.map {
        files.inspect(it)
    }

    suspend fun uploadAttachments(
        threadId: String,
        attachments: List<PickedFile>,
    ): List<SkillFile> = attachments.map { file ->
        // Retain the selected admission identity across response failures and retries.
        api.uploadFile(threadId, file.id, file.name, files.read(file))
    }

    suspend fun save(download: Download, uri: Uri) = files.save(api, download, uri)

    fun fileDownload(file: SkillFile): Download = Download(api.filePath(file), file.name)

    fun documentDownload(id: String, name: String): Download = Download(api.documentPath(id), name)

    fun attachmentPresentation(
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

    suspend fun loadAttachmentImage(source: String, maxDimension: Int): Bitmap? =
        images?.load(source, maxDimension) { address ->
            val bytes = ByteArrayOutputStream()
            api.download(address, bytes)

            bytes.toByteArray()
        }

    override fun close() {
        images?.close()
        api.close()
    }
}

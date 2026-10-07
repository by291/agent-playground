package com.agentplayground.data.knowledge

import android.net.Uri
import com.agentplayground.core.model.Download
import com.agentplayground.core.model.KnowledgeDocument
import com.agentplayground.core.model.validateFile
import com.agentplayground.core.network.PlaygroundApi
import com.agentplayground.data.files.DocumentAccess
import com.agentplayground.data.files.PickedFile

/** Owns remote document transactions and local document-provider access for one server. */
class KnowledgeRepository(private val api: PlaygroundApi, private val files: DocumentAccess) :
    AutoCloseable {
    suspend fun documents(): List<KnowledgeDocument> = api.documents()

    suspend fun inspectUploads(
        uris: List<Uri>,
        resumed: KnowledgeDocument? = null,
    ): List<PickedFile> = uris.map { uri ->
        val file = files.inspect(uri)
        validateKnowledgeFile(file.name, file.size)

        val size =
            if (file.size == null) {
                val data = files.read(file)
                validateKnowledgeFile(file.name, data.size.toLong())

                data.size.toLong()
            } else {
                file.size
            }

        if (resumed != null) {
            require(file.name == resumed.name && size == resumed.size) {
                "Choose the original ${resumed.name} (${resumed.size} bytes) to resume this upload."
            }

            // Resume the admitted document; a new ID would create a second server resource.
            file.copy(id = resumed.id)
        } else {
            file
        }
    }

    suspend fun prepareUpload(file: PickedFile): PreparedDocumentUpload {
        val data = files.read(file)
        validateKnowledgeFile(file.name, data.size.toLong())

        return PreparedDocumentUpload(file, data)
    }

    suspend fun upload(upload: PreparedDocumentUpload) {
        api.uploadDocument(upload.file.id, upload.file.name, upload.data)
    }

    suspend fun reindex(id: String, textEncoding: String?) {
        api.reindex(id, textEncoding)
    }

    suspend fun delete(id: String) = api.deleteDocument(id)

    suspend fun save(download: Download, uri: Uri) = files.save(api, download, uri)

    fun documentDownload(document: KnowledgeDocument): Download =
        Download(api.documentPath(document.id), document.name)

    override fun close() {
        api.close()
    }
}

class PreparedDocumentUpload
internal constructor(
    internal val file: PickedFile,
    internal val data: ByteArray,
)

private fun validateKnowledgeFile(name: String, size: Long?) {
    validateFile(name, size ?: 0)

    require(name.substringAfterLast('.', "").lowercase() in setOf("txt", "md", "pdf")) {
        "Use a nonempty TXT, Markdown or PDF file up to 10 MiB."
    }

    require(size == null || size > 0) {
        "Use a nonempty TXT, Markdown or PDF file up to 10 MiB."
    }
}

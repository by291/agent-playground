package com.agentplayground.data.knowledge

import com.agentplayground.data.files.DocumentAccess
import com.agentplayground.data.network.PlaygroundApi
import com.agentplayground.domain.files.PickedFile
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.KnowledgeDocument
import com.agentplayground.domain.model.validateFile
import com.agentplayground.domain.repository.KnowledgeRepository
import com.agentplayground.domain.repository.PreparedDocumentUpload

private val SUPPORTED_FILE_EXTENSIONS = setOf("txt", "md", "pdf")
private const val INVALID_DOCUMENT_MESSAGE =
    "Use a nonempty TXT, Markdown or PDF file up to 10 MiB."

/** Owns remote document transactions and local document-provider access for one server. */
internal class DefaultKnowledgeRepository(
    private val api: PlaygroundApi,
    private val files: DocumentAccess,
) : KnowledgeRepository {
    override suspend fun documents(): List<KnowledgeDocument> = api.documents()

    override suspend fun inspectUploads(
        uris: List<String>,
        resumed: KnowledgeDocument?,
    ): List<PickedFile> = uris.map { uri ->
        val file = files.inspect(uri)
        validateKnowledgeFile(file.name, file.size)

        val size =
            if (file.size == null) {
                val contents = files.read(file)
                val actualSize = contents.size.toLong()
                validateKnowledgeFile(file.name, actualSize)

                actualSize
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

    override suspend fun prepareUpload(file: PickedFile): PreparedDocumentUpload {
        val contents = files.read(file)
        validateKnowledgeFile(file.name, contents.size.toLong())

        return PreparedUpload(file, contents)
    }

    override suspend fun upload(upload: PreparedDocumentUpload) {
        require(upload is PreparedUpload) { "Upload was not prepared by this repository." }

        api.uploadDocument(upload.file.id, upload.file.name, upload.contents)
    }

    override suspend fun reindex(id: String, textEncoding: String?) {
        api.reindex(id, textEncoding)
    }

    override suspend fun delete(id: String) = api.deleteDocument(id)

    override suspend fun save(download: Download, target: String) =
        files.save(api, download, target)

    override fun documentDownload(document: KnowledgeDocument): Download =
        Download(api.documentPath(document.id), document.name)

    override fun close() {
        api.close()
    }
}

private class PreparedUpload(val file: PickedFile, val contents: ByteArray) : PreparedDocumentUpload

private fun validateKnowledgeFile(name: String, size: Long?) {
    validateFile(name, size ?: 0)

    val extension = name.substringAfterLast('.', "").lowercase()
    val isSupported = extension in SUPPORTED_FILE_EXTENSIONS
    val isNonempty = size == null || size > 0

    require(isSupported && isNonempty) {
        INVALID_DOCUMENT_MESSAGE
    }
}

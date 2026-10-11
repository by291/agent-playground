package com.agentplayground.domain.repository

import com.agentplayground.domain.files.PickedFile
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.KnowledgeDocument

/** Server-scoped document access, owned and closed by the creating ViewModel. */
interface KnowledgeRepository : AutoCloseable {
    suspend fun documents(): List<KnowledgeDocument>

    suspend fun inspectUploads(
        uris: List<String>,
        resumed: KnowledgeDocument? = null,
    ): List<PickedFile>

    /** Reads and validates local content without admitting a remote document. */
    suspend fun prepareUpload(file: PickedFile): PreparedDocumentUpload

    /**
     * Transfers prepared content with its original file ID; a failed response may need recovery.
     */
    suspend fun upload(upload: PreparedDocumentUpload)

    suspend fun reindex(id: String, textEncoding: String?)

    suspend fun delete(id: String)

    suspend fun save(download: Download, target: String)

    fun documentDownload(document: KnowledgeDocument): Download
}

/** An opaque prepared transfer; only the repository implementation reads its payload. */
interface PreparedDocumentUpload

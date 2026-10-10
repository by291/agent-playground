package com.agentplayground.domain.repository

import com.agentplayground.domain.files.PickedFile
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.KnowledgeDocument

interface KnowledgeRepository : AutoCloseable {
    suspend fun documents(): List<KnowledgeDocument>

    suspend fun inspectUploads(
        uris: List<String>,
        resumed: KnowledgeDocument? = null,
    ): List<PickedFile>

    suspend fun prepareUpload(file: PickedFile): PreparedDocumentUpload

    suspend fun upload(upload: PreparedDocumentUpload)

    suspend fun reindex(id: String, textEncoding: String?)

    suspend fun delete(id: String)

    suspend fun save(download: Download, target: String)

    fun documentDownload(document: KnowledgeDocument): Download
}

/** An opaque prepared transfer; only the repository implementation reads its payload. */
interface PreparedDocumentUpload

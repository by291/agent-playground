package com.agentplayground.feature.knowledge

import com.agentplayground.domain.files.PickedFile
import com.agentplayground.domain.model.KnowledgeDocument

data class KnowledgeUiState(
    val documents: List<KnowledgeDocument> = emptyList(),
    val loading: Boolean = false,
    val busy: Boolean = false,
    val operation: String? = null,
    val error: String? = null,
    val pendingUploads: List<PickedFile> = emptyList(),
    val resumeDocument: KnowledgeDocument? = null,
)

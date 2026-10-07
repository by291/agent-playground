package com.agentplayground.core.model

import kotlinx.serialization.Serializable

@Serializable
data class SkillFile(val id: String, val threadId: String, val name: String, val size: Long)

@Serializable
data class KnowledgeDocument(
    val id: String,
    val name: String,
    val size: Long,
    val status: String,
    val error: String? = null,
    val textEncoding: String? = null,
    val chunkCount: Int,
    val createdAt: String,
    val updatedAt: String,
)

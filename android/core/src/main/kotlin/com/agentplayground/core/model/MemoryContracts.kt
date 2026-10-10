package com.agentplayground.core.model

import kotlinx.serialization.Serializable

@Serializable
data class MemoryRecord(
    val id: String,
    val category: String,
    val project: String?,
    val text: String,
    val sourceThreadId: String?,
    val sourceMessageId: String?,
    val revision: Long,
    val createdAt: String,
    val updatedAt: String,
) {
    init {
        val preference = category == "preference" && project == null
        val projectFact = category == "project" && !project.isNullOrBlank() && project.length <= 100

        require(preference || projectFact) { "Invalid memory scope." }
        require(revision > 0) { "Invalid memory revision." }
    }
}

@Serializable data class MemoryPage(val items: List<MemoryRecord>, val nextOffset: Int?)

fun validateMemoryText(text: String): String {
    val trimmed = text.trim()

    require(trimmed.isNotEmpty() && trimmed.length <= 1000) {
        "Enter memory text between 1 and 1,000 characters."
    }

    return trimmed
}

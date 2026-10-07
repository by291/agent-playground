package com.agentplayground.core.presentation

import com.agentplayground.core.model.protocolJson
import com.agentplayground.core.model.validateFile
import kotlinx.serialization.decodeFromString

data class UploadedAttachment(val id: String, val name: String) {
    val isImage: Boolean
        get() = isPreviewImage(name)
}

data class UserMessagePresentation(
    val text: String,
    val attachments: List<UploadedAttachment> = emptyList(),
)

private const val ATTACHMENT_MARKER = "\n\nUploaded files:\n"
private const val FILE_ID_SEPARATOR = " — File ID: "
private val attachmentId =
    Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

fun userMessagePresentation(content: String): UserMessagePresentation {
    val marker = content.lastIndexOf(ATTACHMENT_MARKER)

    if (marker < 0) {
        return UserMessagePresentation(content)
    }

    // Only consume the complete trailing envelope created by the sender. Partial references or
    // prose that resembles the marker must remain visible rather than silently losing text.
    val attachments = mutableListOf<UploadedAttachment>()

    for (line in content.substring(marker + ATTACHMENT_MARKER.length).split('\n')) {
        val separator = line.lastIndexOf(FILE_ID_SEPARATOR)

        if (separator < 0) {
            return UserMessagePresentation(content)
        }

        val id = line.substring(separator + FILE_ID_SEPARATOR.length)
        val encodedName = line.substring(0, separator)

        if (
            !attachmentId.matches(id) || !encodedName.startsWith('"') || !encodedName.endsWith('"')
        ) {
            return UserMessagePresentation(content)
        }

        val name = runCatching { protocolJson.decodeFromString<String>(encodedName) }.getOrNull()

        if (name == null || runCatching { validateFile(name, 0) }.isFailure) {
            return UserMessagePresentation(content)
        }

        attachments.add(UploadedAttachment(id, name))
    }

    return UserMessagePresentation(content.substring(0, marker), attachments)
}

fun isPreviewImage(name: String): Boolean =
    name.substringAfterLast('.', "").lowercase() in setOf("jpg", "jpeg", "png", "gif", "webp")

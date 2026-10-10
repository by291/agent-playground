package com.agentplayground.domain.presentation

import com.agentplayground.domain.model.SkillFile
import com.agentplayground.domain.model.protocolJson

fun messageWithAttachments(text: String, files: List<SkillFile>): String {
    if (files.isEmpty()) {
        return text
    }

    val references =
        files.joinToString("\n") {
            "${protocolJson.encodeToString(kotlinx.serialization.serializer<String>(), it.name)} — File ID: ${it.id}"
        }

    return "$text\n\nUploaded files:\n$references"
}

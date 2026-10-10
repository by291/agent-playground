package com.agentplayground.domain.model

data class Download(val url: String, val name: String)

data class ImagePreview(val name: String, val thumbnail: String, val full: String = thumbnail)

data class MessageAttachment(
    val name: String,
    val download: Download? = null,
    val preview: ImagePreview? = null,
)

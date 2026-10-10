package com.agentplayground.domain.files

import java.util.UUID

data class PickedFile(
    val uri: String,
    val name: String,
    val size: Long?,
    val id: String = UUID.randomUUID().toString(),
)

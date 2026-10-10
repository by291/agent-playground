package com.agentplayground.domain.model

const val MAX_FILE_BYTES = 10 * 1024 * 1024L

fun validateFile(name: String, size: Long) {
    require(
        name.isNotBlank() &&
            name.length <= 200 &&
            name !in setOf(".", "..") &&
            name.none { it == '/' || it == '\\' || it.code < 32 || it.code == 127 }
    ) {
        "Use a filename without separators or control characters (up to 200 characters)."
    }

    require(size in 0..MAX_FILE_BYTES) { "Each file must be at most 10 MiB." }
}

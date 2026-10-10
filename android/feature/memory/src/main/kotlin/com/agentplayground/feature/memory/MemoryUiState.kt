package com.agentplayground.feature.memory

import com.agentplayground.domain.model.MemoryRecord

enum class MemoryAction {
    Correct,
    Forget,
}

data class MemoryDialogState(
    val action: MemoryAction,
    val memory: MemoryRecord,
    val draft: String = memory.text,
    val conflict: Boolean = false,
    val error: String? = null,
)

data class MemoryUiState(
    val memories: List<MemoryRecord> = emptyList(),
    val nextOffset: Int? = null,
    val loaded: Boolean = false,
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val mutating: Boolean = false,
    val error: String? = null,
    val moreError: String? = null,
    val dialog: MemoryDialogState? = null,
) {
    val busy: Boolean
        get() = loading || loadingMore || mutating
}

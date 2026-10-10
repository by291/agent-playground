package com.agentplayground.feature.memory

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.agentplayground.domain.model.ApiException
import com.agentplayground.domain.model.MemoryRecord
import com.agentplayground.domain.model.validateMemoryText
import com.agentplayground.domain.repository.MemoryRepository
import com.agentplayground.domain.repository.RepositoryProvider
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

@HiltViewModel(assistedFactory = MemoryViewModel.Factory::class)
class MemoryViewModel(private val repository: MemoryRepository) : ViewModel() {
    @AssistedInject
    constructor(
        repositories: RepositoryProvider,
        @Assisted serverUrl: String,
    ) : this(repositories.memory(serverUrl))

    @AssistedFactory
    interface Factory {
        fun create(serverUrl: String): MemoryViewModel
    }

    private val mutable = MutableStateFlow(MemoryUiState())
    val state = mutable.asStateFlow()
    private var loadedPages = 1

    fun setVisible(visible: Boolean) {
        if (visible) {
            reload()
        }
    }

    fun reload() {
        if (state.value.busy) {
            return
        }

        mutable.update { it.copy(loading = true) }
        viewModelScope.launch { refreshLoadedPages() }
    }

    private suspend fun refreshLoadedPages() {
        mutable.update { it.copy(loading = true, error = null, moreError = null) }

        try {
            val records = linkedMapOf<String, MemoryRecord>()
            var offset = 0
            var next: Int? = null
            var pages = 0

            for (pageNumber in 0 until loadedPages) {
                val page = repository.page(offset)
                page.items.forEach { records[it.id] = it }
                next = page.nextOffset
                pages++

                if (next == null) {
                    break
                }

                offset = next
            }

            loadedPages = pages
            mutable.update {
                it.copy(memories = records.values.toList(), nextOffset = next, loaded = true)
            }
        } catch (error: Exception) {
            if (error is CancellationException) {
                throw error
            }

            // Preserve committed mutations and loaded pages when reconciliation is unavailable.
            mutable.update { it.copy(error = error.message ?: "Could not load memories.") }
        } finally {
            mutable.update { it.copy(loading = false) }
        }
    }

    fun loadMore() {
        val current = state.value
        val offset = current.nextOffset ?: return

        if (current.busy || current.error != null) {
            return
        }

        mutable.update { it.copy(loadingMore = true, moreError = null) }
        viewModelScope.launch {
            try {
                val page = repository.page(offset)
                val records = current.memories.associateByTo(linkedMapOf()) { it.id }
                page.items.forEach { records[it.id] = it }
                loadedPages++

                mutable.update {
                    it.copy(memories = records.values.toList(), nextOffset = page.nextOffset)
                }
            } catch (error: Exception) {
                if (error is CancellationException) {
                    throw error
                }

                mutable.update {
                    it.copy(moreError = error.message ?: "Could not load more memories.")
                }
            } finally {
                mutable.update { it.copy(loadingMore = false) }
            }
        }
    }

    fun beginCorrection(memory: MemoryRecord) = begin(MemoryAction.Correct, memory)

    fun beginForget(memory: MemoryRecord) = begin(MemoryAction.Forget, memory)

    private fun begin(action: MemoryAction, memory: MemoryRecord) {
        if (state.value.busy) {
            return
        }

        val current = state.value.memories.find { it.id == memory.id } ?: return

        mutable.update { it.copy(dialog = MemoryDialogState(action, current)) }
    }

    fun updateDraft(text: String) {
        if (!state.value.busy) {
            mutable.update { it.copy(dialog = it.dialog?.copy(draft = text, error = null)) }
        }
    }

    fun dismissDialog() {
        if (!state.value.busy) {
            mutable.update { it.copy(dialog = null) }
        }
    }

    fun reviewLatest() {
        val current = state.value
        val dialog = current.dialog ?: return
        val latest = current.memories.find { it.id == dialog.memory.id } ?: return

        if (current.busy || latest.revision <= dialog.memory.revision) {
            return
        }

        // Reviewing advances the mutation revision without replacing the user's correction draft.
        mutable.update {
            it.copy(dialog = dialog.copy(memory = latest, conflict = false, error = null))
        }
    }

    fun confirm() {
        val current = state.value
        val dialog = current.dialog ?: return

        if (current.busy) {
            return
        }

        val latest = current.memories.find { it.id == dialog.memory.id }

        if (dialog.conflict || latest == null || latest.revision != dialog.memory.revision) {
            mutable.update {
                it.copy(
                    dialog =
                        dialog.copy(
                            conflict = true,
                            error = "Review the latest saved memory before trying again.",
                        )
                )
            }
            return
        }

        val text =
            try {
                if (dialog.action == MemoryAction.Correct) validateMemoryText(dialog.draft) else ""
            } catch (error: IllegalArgumentException) {
                mutable.update { it.copy(dialog = dialog.copy(error = error.message)) }
                return
            }

        // Reserve the operation before launching: repeated clicks cannot admit a second write.
        mutable.update { it.copy(mutating = true, dialog = dialog.copy(error = null)) }
        viewModelScope.launch {
            try {
                performMutation(dialog, text)
                // Both success and ambiguous failures reconcile against server state.
                refreshLoadedPages()
            } finally {
                mutable.update { it.copy(mutating = false) }
            }
        }
    }

    private suspend fun performMutation(dialog: MemoryDialogState, text: String) {
        try {
            val updated =
                if (dialog.action == MemoryAction.Correct) {
                    repository.correct(dialog.memory, text)
                } else {
                    repository.forget(dialog.memory)
                    null
                }

            mutable.update { value ->
                value.copy(
                    memories =
                        value.memories.flatMap { memory ->
                            if (memory.id != dialog.memory.id) {
                                listOf(memory)
                            } else {
                                listOfNotNull(updated)
                            }
                        },
                    dialog = null,
                )
            }
        } catch (error: Exception) {
            if (error is CancellationException) {
                throw error
            }

            mutable.update { value ->
                value.copy(
                    dialog =
                        value.dialog?.copy(
                            conflict = error is ApiException && error.status == 409,
                            error = error.message ?: "Memory operation failed.",
                        )
                )
            }
        }
    }

    override fun onCleared() {
        repository.close()
    }
}

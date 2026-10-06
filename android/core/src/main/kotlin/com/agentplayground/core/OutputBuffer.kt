package com.agentplayground.core

/** Admission ordering is application metadata around the official A2UI messages. */
class OutputBuffer {
    private val bySequence = sortedMapOf<Int, WorkflowOutput>()
    private val byId = mutableMapOf<String, WorkflowOutput>()
    private var nextSequence = 1
    private var failure: String? = null

    val missingSequence: Int?
        get() =
            if (bySequence.lastKeyOrNull()?.let { it >= nextSequence } == true) {
                nextSequence
            } else {
                null
            }

    data class Delivery(val ready: List<WorkflowOutput>, val error: String?)

    fun ingest(incoming: List<WorkflowOutput>): Delivery {
        for (output in incoming) {
            val previous = byId[output.id] ?: bySequence[output.outputSeq]

            if (
                output.outputSeq < 1 ||
                    output.id.isBlank() ||
                    (previous != null && previous != output)
            ) {
                failure = "Conflicting workflow output: ${output.id}"
                break
            }

            byId[output.id] = output
            bySequence[output.outputSeq] = output
        }

        val ready = mutableListOf<WorkflowOutput>()

        while (failure == null) {
            val output = bySequence[nextSequence] ?: break

            ready += output
            nextSequence += 1
        }

        return Delivery(ready, failure)
    }

    private fun <K, V> java.util.SortedMap<K, V>.lastKeyOrNull(): K? =
        if (isEmpty()) {
            null
        } else {
            lastKey()
        }
}

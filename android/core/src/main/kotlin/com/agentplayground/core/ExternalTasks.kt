package com.agentplayground.core

/** Tasks survive an older replica snapshot or a lagging continuation mapping. */
fun mergeExternalTasks(
    currentTasks: List<ExternalTask>,
    incomingTasks: List<ExternalTask>,
): List<ExternalTask> {
    val tasks = currentTasks.associateBy { it.taskId }.toMutableMap()

    for (incoming in incomingTasks) {
        val current = tasks[incoming.taskId]
        val staleContinuation =
            incoming.revision == current?.revision &&
                current.continuationStatus != null &&
                (incoming.continuationStatus == null ||
                    (isFinishedRun(current.continuationStatus) &&
                        !isFinishedRun(incoming.continuationStatus)))
        val regressedTerminal =
            current != null &&
                !isExternalTaskActive(current.status) &&
                isExternalTaskActive(incoming.status)

        if (
            !staleContinuation &&
                !regressedTerminal &&
                (current == null || incoming.revision >= current.revision)
        ) {
            tasks[incoming.taskId] = incoming
        }
    }

    return tasks.values.toList()
}

private fun isFinishedRun(status: String?) = status in setOf("completed", "failed", "interrupted")

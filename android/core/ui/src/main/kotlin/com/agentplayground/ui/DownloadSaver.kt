package com.agentplayground.ui

import androidx.compose.runtime.saveable.listSaver
import com.agentplayground.domain.model.Download

val DownloadSaver =
    listSaver<Download?, String>(
        save = {
            if (it == null) {
                emptyList()
            } else {
                listOf(it.url, it.name)
            }
        },
        restore = {
            if (it.size == 2) {
                Download(it[0], it[1])
            } else {
                null
            }
        },
    )

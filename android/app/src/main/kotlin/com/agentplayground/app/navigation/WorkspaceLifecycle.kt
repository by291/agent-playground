package com.agentplayground.app.navigation

import androidx.compose.runtime.Composable
import androidx.lifecycle.compose.LifecycleStartEffect
import com.agentplayground.app.di.WorkspaceModels

@Composable
internal fun ObserveWorkspace(destination: WorkspaceDestination, models: WorkspaceModels) {
    LifecycleStartEffect(models.conversation, destination.observesConversation) {
        models.conversation.setVisible(destination.observesConversation)

        onStopOrDispose { models.conversation.setVisible(false) }
    }

    LifecycleStartEffect(models.knowledge, destination == WorkspaceDestination.Knowledge) {
        models.knowledge.setVisible(destination == WorkspaceDestination.Knowledge)

        onStopOrDispose { models.knowledge.setVisible(false) }
    }
}

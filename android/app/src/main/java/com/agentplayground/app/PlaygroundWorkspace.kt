package com.agentplayground.app

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.agentplayground.app.data.AppPreferences
import com.agentplayground.app.data.PreferenceStore
import com.agentplayground.app.design.Motion
import com.agentplayground.app.design.RevealNavigationDrawer
import com.agentplayground.app.features.conversation.*
import com.agentplayground.app.features.knowledge.KnowledgeScreen
import com.agentplayground.app.features.settings.SettingsScreen
import com.agentplayground.app.network.ServerNetworkAccess
import kotlinx.coroutines.launch

@Composable
internal fun PlaygroundWorkspace(
    store: PreferenceStore,
    preferences: AppPreferences,
    networkAccess: ServerNetworkAccess,
    models: WorkspaceModels,
) {
    var destination by
        rememberSaveable(stateSaver = WorkspaceDestination.saver) {
            mutableStateOf(WorkspaceDestination.Chat)
        }
    val savedScreens = rememberSaveableStateHolder()

    BackHandler(enabled = destination != WorkspaceDestination.Chat) {
        destination = WorkspaceDestination.Chat
    }

    val chat = models.conversation
    val knowledge = models.knowledge
    val chatState by chat.state.collectAsStateWithLifecycle()

    ObserveWorkspace(destination, models)

    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current

    BackHandler(enabled = drawer.isOpen) { scope.launch { drawer.close() } }

    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
        BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
            val expanded = maxWidth >= 840.dp

            LaunchedEffect(expanded, destination) {
                if (expanded || destination == WorkspaceDestination.Activity) {
                    drawer.close()
                }
            }

            val openNavigation: (() -> Unit)? =
                if (expanded) {
                    null
                } else {
                    {
                        keyboard?.hide()
                        scope.launch { drawer.open() }
                    }
                }
            val navigate: (WorkspaceDestination) -> Unit = { route ->
                // Install the destination before drawer settlement so the new page is revealed
                // underneath.
                destination = route
                scope.launch { drawer.close() }
            }
            val sidebar: @Composable () -> Unit = {
                ConversationHistory(
                    chatState,
                    chat,
                    onSelect = { id ->
                        if (id != chatState.session?.threadId) {
                            chat.select(id)
                        }

                        navigate(WorkspaceDestination.Chat)
                    },
                    modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
                    destination = destination.route,
                    serverUrl = preferences.serverUrl,
                    onKnowledge = { navigate(WorkspaceDestination.Knowledge) },
                    onSettings = { navigate(WorkspaceDestination.Settings) },
                )
            }

            val screen: @Composable (WorkspaceDestination) -> Unit = { route ->
                savedScreens.SaveableStateProvider("${preferences.serverUrl}:${route.route}") {
                    when (route) {
                        WorkspaceDestination.Activity ->
                            ActivityScreen(
                                chatState.session,
                                { destination = WorkspaceDestination.Chat },
                                chat::clearActivity,
                            )

                        WorkspaceDestination.Knowledge -> KnowledgeScreen(knowledge, openNavigation)

                        WorkspaceDestination.Settings ->
                            SettingsScreen(
                                preferences,
                                store,
                                chat::clear,
                                chatState.clearBlocked,
                                chatState.error,
                                openNavigation,
                                networkAccess,
                            )

                        WorkspaceDestination.Chat ->
                            ConversationScreen(chat, preferences, openNavigation) {
                                keyboard?.hide()
                                destination = WorkspaceDestination.Activity
                            }
                    }
                }
            }

            AnimatedContent(
                targetState = destination,
                modifier = Modifier.fillMaxSize(),
                transitionSpec = {
                    when {
                        targetState == WorkspaceDestination.Activity ->
                            (slideInHorizontally(tween(Motion.Page)) { it / 8 } +
                                fadeIn(tween(Motion.Expand))) togetherWith
                                (slideOutHorizontally(tween(Motion.Page)) { -it / 12 } +
                                    fadeOut(tween(Motion.Exit)))

                        initialState == WorkspaceDestination.Activity ->
                            (slideInHorizontally(tween(Motion.Page)) { -it / 12 } +
                                fadeIn(tween(Motion.Expand))) togetherWith
                                (slideOutHorizontally(tween(Motion.Page)) { it / 8 } +
                                    fadeOut(tween(Motion.Exit)))

                        !expanded && (drawer.isOpen || drawer.targetValue == DrawerValue.Open) ->
                            EnterTransition.None togetherWith ExitTransition.None

                        else ->
                            fadeIn(tween(Motion.Feedback)) togetherWith
                                fadeOut(tween(Motion.Feedback))
                    }
                },
                label = "workspace-page",
            ) { route ->
                when {
                    route == WorkspaceDestination.Activity -> screen(route)

                    expanded ->
                        Row(Modifier.fillMaxSize()) {
                            Surface(
                                Modifier.width(280.dp).fillMaxHeight(),
                                color = MaterialTheme.colorScheme.surface,
                            ) {
                                sidebar()
                            }
                            VerticalDivider()
                            Box(Modifier.weight(1f)) { screen(route) }
                        }

                    else ->
                        RevealNavigationDrawer(
                            drawerState = drawer,
                            drawerContent = sidebar,
                            content = { screen(route) },
                        )
                }
            }
        }
    }
}

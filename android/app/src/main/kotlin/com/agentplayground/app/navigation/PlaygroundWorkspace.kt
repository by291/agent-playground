package com.agentplayground.app.navigation

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.rememberDecoratedNavEntries
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.agentplayground.app.di.WorkspaceModels
import com.agentplayground.design.Motion
import com.agentplayground.design.RevealNavigationDrawer
import com.agentplayground.domain.settings.AppPreferences
import com.agentplayground.feature.conversation.ConversationHistoryRoute
import com.agentplayground.feature.conversation.ConversationRoute
import com.agentplayground.feature.conversation.ui.activity.ActivityScreen
import com.agentplayground.feature.knowledge.KnowledgeRoute
import com.agentplayground.feature.memory.MemoryRoute
import com.agentplayground.feature.settings.SettingsRoute
import com.agentplayground.ui.network.ServerNetworkAccess
import kotlinx.coroutines.launch

@Composable
internal fun PlaygroundWorkspace(
    preferences: AppPreferences,
    networkAccess: ServerNetworkAccess,
    models: WorkspaceModels,
) {
    val chatStack = rememberNavBackStack(WorkspaceDestination.Chat)
    val knowledgeStack = rememberNavBackStack(WorkspaceDestination.Knowledge)
    val memoryStack = rememberNavBackStack(WorkspaceDestination.Memory)
    val settingsStack = rememberNavBackStack(WorkspaceDestination.Settings)
    val stacks = listOf(chatStack, knowledgeStack, memoryStack, settingsStack)
    val primaryDestinations =
        listOf(
            WorkspaceDestination.Chat,
            WorkspaceDestination.Knowledge,
            WorkspaceDestination.Memory,
            WorkspaceDestination.Settings,
        )
    var selected by rememberSaveable { mutableIntStateOf(0) }
    val stack = stacks[selected]
    val destination = stack.last() as WorkspaceDestination
    val back: () -> Unit = {
        if (stack.size > 1) {
            stack.removeLastOrNull()
        } else {
            selected = 0
        }
    }

    // NavDisplay owns nested back navigation; primary destinations return to chat.
    BackHandler(enabled = stack.size == 1 && selected != 0, onBack = back)

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
                selected = primaryDestinations.indexOf(route)
                if (route == WorkspaceDestination.Chat) {
                    while (chatStack.size > 1) {
                        chatStack.removeLastOrNull()
                    }
                }
                scope.launch { drawer.close() }
            }
            val sidebar: @Composable () -> Unit = {
                ConversationHistoryRoute(
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
                    onMemory = { navigate(WorkspaceDestination.Memory) },
                    onSettings = { navigate(WorkspaceDestination.Settings) },
                )
            }

            val screen: @Composable (WorkspaceDestination) -> Unit = { route ->
                when (route) {
                    WorkspaceDestination.Activity ->
                        ActivityScreen(
                            chatState.session,
                            back,
                            chat::clearActivity,
                        )

                    WorkspaceDestination.Knowledge -> KnowledgeRoute(knowledge, openNavigation)

                    WorkspaceDestination.Memory ->
                        MemoryRoute(
                            models.memory,
                            onOpenSource = { threadId ->
                                if (threadId != chatState.session?.threadId) {
                                    chat.select(threadId)
                                }

                                navigate(WorkspaceDestination.Chat)
                            },
                            onOpenNavigation = openNavigation,
                        )

                    WorkspaceDestination.Settings ->
                        SettingsRoute(
                            preferences,
                            chat::clear,
                            chatState.clearBlocked,
                            chatState.error,
                            openNavigation,
                            networkAccess,
                        )

                    WorkspaceDestination.Chat ->
                        ConversationRoute(chat, preferences, openNavigation) {
                            keyboard?.hide()
                            if (chatStack.last() != WorkspaceDestination.Activity) {
                                chatStack.add(WorkspaceDestination.Activity)
                            }
                        }
                }
            }

            val decoratedStacks = stacks.mapIndexed { index, backStack ->
                key(preferences.serverUrl, index) {
                    rememberDecoratedNavEntries(
                        backStack = backStack,
                        entryDecorators =
                            listOf(
                                rememberSaveableStateHolderNavEntryDecorator(),
                                rememberViewModelStoreNavEntryDecorator(),
                            ),
                        entryProvider = { route ->
                            NavEntry(route, contentKey = "${preferences.serverUrl}:$index:$route") {
                                screen(it as WorkspaceDestination)
                            }
                        },
                    )
                }
            }
            val display: @Composable () -> Unit = {
                NavDisplay(
                    entries = decoratedStacks[selected],
                    onBack = back,
                    modifier = Modifier.fillMaxSize(),
                    transitionSpec = {
                        if (
                            !expanded && (drawer.isOpen || drawer.targetValue == DrawerValue.Open)
                        ) {
                            EnterTransition.None togetherWith ExitTransition.None
                        } else {
                            fadeIn(tween(Motion.Feedback)) togetherWith
                                fadeOut(tween(Motion.Feedback))
                        }
                    },
                    popTransitionSpec = {
                        fadeIn(tween(Motion.Feedback)) togetherWith fadeOut(tween(Motion.Feedback))
                    },
                    predictivePopTransitionSpec = { _ ->
                        slideInHorizontally { -it / 12 } togetherWith
                            slideOutHorizontally { it / 8 }
                    },
                )
            }

            when {
                destination == WorkspaceDestination.Activity -> display()
                expanded ->
                    Row(Modifier.fillMaxSize()) {
                        Surface(
                            Modifier.width(280.dp).fillMaxHeight(),
                            color = MaterialTheme.colorScheme.surface,
                        ) {
                            sidebar()
                        }
                        VerticalDivider()
                        Box(Modifier.weight(1f)) { display() }
                    }
                else ->
                    RevealNavigationDrawer(
                        drawerState = drawer,
                        drawerContent = sidebar,
                        content = display,
                    )
            }
        }
    }
}

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
import com.agentplayground.feature.settings.SettingsRouteOptions
import com.agentplayground.ui.network.ServerNetworkAccess
import kotlinx.coroutines.launch

private val ExpandedWorkspaceWidth = 840.dp
private val WorkspaceSidebarWidth = 280.dp
private const val PredictiveEnterOffsetDivisor = 12
private const val PredictiveExitOffsetDivisor = 8
private const val ChatDestinationIndex = 0

private val primaryDestinations =
    listOf(
        WorkspaceDestination.Chat,
        WorkspaceDestination.Knowledge,
        WorkspaceDestination.Memory,
        WorkspaceDestination.Settings,
    )

/** Retains page navigation while the server-scoped models own live work. */
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

    val stacks =
        listOf(
            chatStack,
            knowledgeStack,
            memoryStack,
            settingsStack,
        )

    var selectedIndex by rememberSaveable { mutableIntStateOf(ChatDestinationIndex) }
    val stack = stacks[selectedIndex]
    val destination = stack.last() as WorkspaceDestination

    val chat = models.conversation
    val knowledge = models.knowledge
    val chatState by chat.state.collectAsStateWithLifecycle()

    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current

    val back: () -> Unit = {
        if (stack.size > 1) {
            stack.removeLastOrNull()
        } else {
            selectedIndex = ChatDestinationIndex
        }
    }

    // NavDisplay owns nested back navigation; primary destinations return to chat.
    BackHandler(enabled = stack.size == 1 && selectedIndex != ChatDestinationIndex, onBack = back)
    BackHandler(enabled = drawer.isOpen) { scope.launch { drawer.close() } }

    ObserveWorkspace(destination, models)

    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
        BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
            val expanded = maxWidth >= ExpandedWorkspaceWidth

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
                // Change the route first so the drawer reveals the destination as it closes.
                selectedIndex = primaryDestinations.indexOf(route)

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
                            options =
                                SettingsRouteOptions(
                                    preferences = preferences,
                                    networkAccess = networkAccess,
                                    onClear = chat::clear,
                                    conversationBusy = chatState.clearBlocked,
                                    conversationError = chatState.error,
                                    onOpenNavigation = openNavigation,
                                )
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

            // Decorate every stack so inactive pages retain entry state and ViewModels as well.
            // Server-owned conversation resources live outside these navigation entries.
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
                    entries = decoratedStacks[selectedIndex],
                    onBack = back,
                    modifier = Modifier.fillMaxSize(),
                    transitionSpec = {
                        val drawerRevealsPage =
                            !expanded && (drawer.isOpen || drawer.targetValue == DrawerValue.Open)

                        if (drawerRevealsPage) {
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
                        slideInHorizontally { -it / PredictiveEnterOffsetDivisor } togetherWith
                            slideOutHorizontally { it / PredictiveExitOffsetDivisor }
                    },
                )
            }

            when {
                destination == WorkspaceDestination.Activity -> display()

                expanded ->
                    Row(Modifier.fillMaxSize()) {
                        Surface(
                            Modifier.width(WorkspaceSidebarWidth).fillMaxHeight(),
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

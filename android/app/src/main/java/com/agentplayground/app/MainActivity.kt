package com.agentplayground.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.lifecycle.*
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.agentplayground.app.data.AppPreferences
import com.agentplayground.app.design.Motion
import com.agentplayground.app.design.PlaygroundTheme
import com.agentplayground.app.design.RevealNavigationDrawer
import com.agentplayground.app.features.conversation.*
import com.agentplayground.app.features.knowledge.*
import com.agentplayground.app.features.settings.SettingsScreen
import com.agentplayground.app.files.DocumentAccess
import com.agentplayground.core.PlaygroundApi
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val application = application as PlaygroundApplication
        setContent {
            val preferences by
                application.preferences.preferences.collectAsStateWithLifecycle(initialValue = null)
            preferences?.let { value ->
                PlaygroundTheme(value.theme) {
                    val lightBars = MaterialTheme.colorScheme.surface.luminance() > 0.5f
                    SideEffect {
                        WindowCompat.getInsetsController(window, window.decorView).apply {
                            isAppearanceLightStatusBars = lightBars
                            isAppearanceLightNavigationBars = lightBars
                        }
                    }
                    PlaygroundApp(application, value)
                }
            }
        }
    }
}

@Composable
internal fun PlaygroundApp(application: PlaygroundApplication, preferences: AppPreferences) {
    var destination by rememberSaveable { mutableStateOf("chat") }
    val savedScreens = rememberSaveableStateHolder()
    BackHandler(enabled = destination != "chat") { destination = "chat" }
    // Activity-owned graph survives configuration recreation and releases the old
    // server's clients/jobs when the connection setting changes.
    val graph: ServerGraph = viewModel()
    val owner = graph.owner(preferences.serverUrl)
    val files = remember(application) { DocumentAccess(application.contentResolver) }
    val chat: ConversationViewModel =
        viewModel(
            viewModelStoreOwner = owner,
            factory =
                factory {
                    ConversationViewModel(
                        PlaygroundApi(preferences.serverUrl),
                        application.preferences.conversations(preferences.serverUrl),
                        files,
                    )
                },
        )
    val knowledge: KnowledgeViewModel =
        viewModel(
            viewModelStoreOwner = owner,
            factory = factory { KnowledgeViewModel(PlaygroundApi(preferences.serverUrl), files) },
        )
    val chatState by chat.state.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val observesChat = destination in setOf("chat", "activity")
    DisposableEffect(lifecycle, observesChat, chat) {
        fun sync() {
            val started = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
            chat.setVisible(started && observesChat)
        }
        val observer = LifecycleEventObserver { _, _ -> sync() }
        lifecycle.addObserver(observer)
        sync()
        onDispose {
            lifecycle.removeObserver(observer)
            chat.setVisible(false)
        }
    }
    val observesKnowledge = destination == "knowledge"
    DisposableEffect(lifecycle, observesKnowledge, knowledge) {
        fun sync() {
            knowledge.setVisible(
                lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) && observesKnowledge
            )
        }
        val observer = LifecycleEventObserver { _, _ -> sync() }
        lifecycle.addObserver(observer)
        sync()
        onDispose {
            lifecycle.removeObserver(observer)
            knowledge.setVisible(false)
        }
    }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    BackHandler(enabled = drawer.isOpen) { scope.launch { drawer.close() } }
    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
        BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
            val expanded = maxWidth >= 840.dp
            LaunchedEffect(expanded, destination) {
                if (expanded || destination == "activity") {
                    drawer.close()
                }
            }
            val openNavigation: (() -> Unit)? =
                if (expanded) null
                else {
                    {
                        keyboard?.hide()
                        scope.launch { drawer.open() }
                    }
                }
            val navigate: (String) -> Unit = { route ->
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
                        navigate("chat")
                    },
                    modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
                    destination = destination,
                    serverUrl = preferences.serverUrl,
                    onKnowledge = { navigate("knowledge") },
                    onSettings = { navigate("settings") },
                )
            }
            val screen: @Composable (String) -> Unit = { route ->
                savedScreens.SaveableStateProvider("${preferences.serverUrl}:$route") {
                    when (route) {
                        "activity" ->
                            ActivityScreen(
                                chatState.session,
                                { destination = "chat" },
                                chat::clearActivity,
                            )
                        "knowledge" -> KnowledgeScreen(knowledge, openNavigation)
                        "settings" ->
                            SettingsScreen(
                                preferences,
                                application.preferences,
                                chat::clear,
                                chatState.clearBlocked,
                                chatState.error,
                                openNavigation,
                            )
                        else ->
                            ConversationScreen(chat, preferences, openNavigation) {
                                keyboard?.hide()
                                destination = "activity"
                            }
                    }
                }
            }
            AnimatedContent(
                targetState = destination,
                modifier = Modifier.fillMaxSize(),
                transitionSpec = {
                    when {
                        targetState == "activity" ->
                            (slideInHorizontally(tween(Motion.Page)) { it / 8 } +
                                fadeIn(tween(Motion.Expand))) togetherWith
                                (slideOutHorizontally(tween(Motion.Page)) { -it / 12 } +
                                    fadeOut(tween(Motion.Exit)))
                        initialState == "activity" ->
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
                    route == "activity" -> screen(route)
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

private fun <T : ViewModel> factory(create: () -> T): ViewModelProvider.Factory =
    object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <V : ViewModel> create(modelClass: Class<V>): V = create() as V
    }

class ServerGraph : ViewModel() {
    private var serverUrl: String? = null
    private var store = ViewModelStore()
    private var currentOwner = ownerFor(store)

    fun owner(url: String): ViewModelStoreOwner {
        if (url != serverUrl) {
            store.clear()
            store = ViewModelStore()
            currentOwner = ownerFor(store)
            serverUrl = url
        }

        return currentOwner
    }

    private fun ownerFor(value: ViewModelStore) =
        object : ViewModelStoreOwner {
            override val viewModelStore = value
        }

    override fun onCleared() {
        store.clear()
    }
}

package com.agentplayground.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.lifecycle.*
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.agentplayground.app.data.AppPreferences
import com.agentplayground.app.design.PlaygroundTheme
import com.agentplayground.app.features.conversation.*
import com.agentplayground.app.features.knowledge.*
import com.agentplayground.app.features.settings.SettingsScreen
import com.agentplayground.app.files.DocumentAccess
import com.agentplayground.core.PlaygroundApi

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
    BackHandler(enabled = destination == "activity") { destination = "chat" }
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
    Scaffold(
        bottomBar = {
            if (
                destination != "activity" && WindowInsets.ime.getBottom(LocalDensity.current) == 0
            ) {
                Surface(color = MaterialTheme.colorScheme.surface) {
                    Column {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Row(
                            Modifier.fillMaxWidth()
                                .navigationBarsPadding()
                                .padding(horizontal = 20.dp, vertical = 6.dp)
                        ) {
                            listOf(
                                    Triple("chat", "Chat", Icons.Outlined.ChatBubbleOutline),
                                    Triple("knowledge", "Knowledge", Icons.Outlined.FolderOpen),
                                    Triple("settings", "Settings", Icons.Outlined.Settings),
                                )
                                .forEach { (route, label, icon) ->
                                    val selected = destination == route
                                    val color =
                                        if (selected) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.onSurfaceVariant
                                    Column(
                                        Modifier.weight(1f)
                                            .selectable(
                                                selected,
                                                role = Role.Tab,
                                                onClick = { destination = route },
                                            )
                                            .padding(vertical = 8.dp)
                                            .heightIn(min = 48.dp),
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                        verticalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        Icon(icon, null, Modifier.size(22.dp), tint = color)
                                        Text(
                                            label,
                                            style = MaterialTheme.typography.labelMedium,
                                            color = color,
                                        )
                                    }
                                }
                        }
                    }
                }
            }
        },
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            savedScreens.SaveableStateProvider("${preferences.serverUrl}:$destination") {
                when (destination) {
                    "activity" ->
                        ActivityScreen(
                            chatState.session,
                            { destination = "chat" },
                            chat::clearActivity,
                        )
                    "knowledge" -> KnowledgeScreen(knowledge)
                    "settings" ->
                        SettingsScreen(
                            preferences,
                            application.preferences,
                            chat::clear,
                            chatState.clearBlocked,
                            chatState.error,
                        )
                    else -> ConversationScreen(chat, preferences) { destination = "activity" }
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

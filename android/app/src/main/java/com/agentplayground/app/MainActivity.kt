package com.agentplayground.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
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
                PlaygroundTheme(value.theme) { PlaygroundApp(application, value) }
            }
        }
    }
}

@Composable
private fun PlaygroundApp(application: PlaygroundApplication, preferences: AppPreferences) {
    var destination by rememberSaveable { mutableStateOf("chat") }
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
    DisposableEffect(lifecycle, destination, chat, knowledge) {
        fun sync() {
            val started = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
            chat.setVisible(started && destination == "chat")
            knowledge.setVisible(started && destination == "knowledge")
        }
        val observer = LifecycleEventObserver { _, _ -> sync() }
        lifecycle.addObserver(observer)
        sync()
        onDispose {
            lifecycle.removeObserver(observer)
            chat.setVisible(false)
            knowledge.setVisible(false)
        }
    }
    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = destination == "chat",
                    onClick = { destination = "chat" },
                    icon = { Icon(Icons.Outlined.ChatBubbleOutline, null) },
                    label = { Text("Chat") },
                )
                NavigationBarItem(
                    selected = destination == "knowledge",
                    onClick = { destination = "knowledge" },
                    icon = { Icon(Icons.Outlined.FolderOpen, null) },
                    label = { Text("Knowledge") },
                )
                NavigationBarItem(
                    selected = destination == "settings",
                    onClick = { destination = "settings" },
                    icon = { Icon(Icons.Outlined.Settings, null) },
                    label = { Text("Settings") },
                )
            }
        },
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (destination) {
                "knowledge" -> KnowledgeScreen(knowledge)
                "settings" ->
                    SettingsScreen(
                        preferences,
                        application.preferences,
                        chat::clear,
                        chatState.uploading || chatState.session?.busy == true,
                        chatState.error,
                    )
                else -> ConversationScreen(chat, preferences)
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

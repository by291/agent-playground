package com.agentplayground.feature.settings

import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.agentplayground.data.AppPreferences
import com.agentplayground.data.PreferencesRepository
import com.agentplayground.ui.PlaygroundTheme
import com.agentplayground.ui.network.ServerNetworkAccess
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h740dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SettingsConnectionTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `delayed connection preserves theme and shortcut changes saved during health check`() {
        val healthStarted = CountDownLatch(1)
        val releaseHealth = CountDownLatch(1)
        val connected = AtomicReference<String?>(null)

        MockWebServer().use { server ->
            server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse =
                        when (request.path) {
                            "/health" -> {
                                healthStarted.countDown()
                                check(releaseHealth.await(30, TimeUnit.SECONDS))

                                MockResponse().setBody("{}")
                            }
                            "/agent-info" -> MockResponse().setBody("{\"model\":\"fixture\"}")
                            else -> MockResponse().setResponseCode(404)
                        }
                }
            server.start()

            val application = RuntimeEnvironment.getApplication()
            val store = PreferencesRepository(application)
            val initial = AppPreferences(serverUrl = "https://old.example/")
            val access = ServerNetworkAccess(35, { true }, { error("No permission needed") })

            runBlocking {
                store.resetAppearanceAndKeyboard()
                store.updateServerUrl(initial.serverUrl)
            }

            compose.setContent {
                val preferences by store.preferences.collectAsStateWithLifecycle(initial)

                PlaygroundTheme("light") {
                    SettingsRoute(
                        preferences,
                        store,
                        onClear = null,
                        conversationBusy = false,
                        conversationError = null,
                        networkAccess = access,
                        onConnected = connected::set,
                    )
                }
            }

            try {
                compose
                    .onNodeWithText("Backend URL")
                    .performTextReplacement(server.url("/").toString())
                compose.onNodeWithText("Connect and save").performClick()
                await { healthStarted.count == 0L }

                compose.onNodeWithText("Dark").performScrollTo().performClick()
                await { runBlocking { store.preferences.first().theme == "dark" } }
                compose.onNodeWithText("Ctrl / Cmd + Enter").performScrollTo().performClick()
                await {
                    runBlocking { store.preferences.first().sendShortcut == "modifier-enter" }
                }

                assertEquals(
                    "Shortcut save retains theme before health completes",
                    "dark",
                    runBlocking { store.preferences.first().theme },
                )

                releaseHealth.countDown()
                await { connected.get() != null }

                val saved = runBlocking { store.preferences.first() }

                assertEquals(server.url("/").toString(), saved.serverUrl)
                assertEquals("dark", saved.theme)
                assertEquals("modifier-enter", saved.sendShortcut)
            } finally {
                releaseHealth.countDown()
            }
        }
    }

    @Test
    fun `leaving settings cancels a delayed connection without switching the saved server`() {
        val application = RuntimeEnvironment.getApplication()
        val store = PreferencesRepository(application)
        val initial = AppPreferences(serverUrl = "https://old.example/")
        val access = ServerNetworkAccess(35, { true }, { error("No permission needed") })
        val visible = mutableStateOf(true)
        val started = CompletableDeferred<Unit>()
        val released = CompletableDeferred<Unit>()
        val finish = CompletableDeferred<String>()
        val connected = AtomicReference<String?>(null)

        runBlocking {
            store.resetAppearanceAndKeyboard()
            store.updateServerUrl(initial.serverUrl)
        }

        val model =
            ViewModelProvider(
                compose.activity,
                viewModelFactory {
                    initializer {
                        SettingsViewModel(store, SavedStateHandle(), initial.serverUrl) {
                            started.complete(Unit)

                            try {
                                finish.await()
                            } finally {
                                released.complete(Unit)
                            }
                        }
                    }
                },
            )[SettingsViewModel::class.java]

        compose.setContent {
            val preferences by store.preferences.collectAsStateWithLifecycle(initial)

            PlaygroundTheme("light") {
                if (visible.value) {
                    SettingsRoute(
                        preferences,
                        store,
                        onClear = null,
                        conversationBusy = false,
                        conversationError = null,
                        networkAccess = access,
                        onConnected = connected::set,
                    )
                }
            }
        }

        compose.onNodeWithText("Backend URL").performTextReplacement("https://next.example/")
        compose.onNodeWithText("Connect and save").performClick()
        await { started.isCompleted }
        compose.runOnIdle { visible.value = false }

        // Apply the removal before waiting for the model's cancellation callback on another
        // scheduler.
        compose.waitForIdle()
        compose.onNodeWithText("Settings").assertDoesNotExist()
        await { released.isCompleted }
        finish.complete("fixture")

        assertFalse(model.state.value.pending)
        assertEquals("https://next.example/", model.state.value.server)
        assertEquals(initial.serverUrl, runBlocking { store.preferences.first().serverUrl })
        assertNull(connected.get())
    }

    private fun await(condition: () -> Boolean) {
        compose.waitUntil(10_000) {
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            condition()
        }

        compose.waitForIdle()
    }
}

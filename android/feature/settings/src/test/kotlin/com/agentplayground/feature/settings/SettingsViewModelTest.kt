package com.agentplayground.feature.settings

import android.os.Looper
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.agentplayground.data.AppPreferences
import com.agentplayground.data.PreferencesRepository
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SettingsViewModelTest {
    @Test
    fun `denied permission never checks the server and retry saves only after successful check`() {
        val preferences = PreferencesRepository(RuntimeEnvironment.getApplication())
        val models = ViewModelStore()
        var checks = 0
        val model =
            createModel(models, preferences) {
                checks++
                "fixture"
            }
        val serverUrl = "https://playground.example/"

        try {
            model.editServer("  https://playground.example  ")
            model.connect()
            model.networkAccessResult(serverUrl, false)

            assertEquals(0, checks)
            assertFalse(model.state.value.pending)
            assertTrue(model.state.value.permissionDenied)
            assertEquals(
                AppPreferences().serverUrl,
                runBlocking { preferences.preferences.first().serverUrl },
            )

            model.connect()
            model.networkAccessResult(serverUrl, true)
            await { !model.state.value.pending }

            assertEquals(1, checks)
            assertEquals(serverUrl, runBlocking { preferences.preferences.first().serverUrl })
            assertEquals("Connected · fixture", model.state.value.status)
            assertFalse(model.state.value.permissionDenied)
        } finally {
            models.clear()
        }
    }

    @Test
    fun `failed connection retains stored server and allows another attempt`() {
        val preferences = PreferencesRepository(RuntimeEnvironment.getApplication())
        val models = ViewModelStore()
        var attempts = 0
        val model =
            createModel(models, preferences) {
                attempts++

                error("Server unavailable")
            }
        val serverUrl = "https://unavailable.example/"

        try {
            model.editServer(serverUrl)
            model.connect()
            model.networkAccessResult(serverUrl, true)
            await { !model.state.value.pending }

            assertEquals(
                AppPreferences().serverUrl,
                runBlocking { preferences.preferences.first().serverUrl },
            )
            assertEquals("Server unavailable", model.state.value.error)
            assertNull(model.state.value.status)

            model.connect()
            model.networkAccessResult(serverUrl, true)
            await { !model.state.value.pending }

            assertEquals(2, attempts)
        } finally {
            models.clear()
        }
    }

    @Test
    fun `draft survives saved state and disposing the model cancels the connection check`() {
        val preferences = PreferencesRepository(RuntimeEnvironment.getApplication())
        val savedState = SavedStateHandle()
        val models = ViewModelStore()
        val started = AtomicBoolean()
        val released = AtomicBoolean()
        val result = CompletableDeferred<String>()
        val model =
            createModel(models, preferences, savedState) {
                started.set(true)

                try {
                    result.await()
                } finally {
                    released.set(true)
                }
            }
        val serverUrl = "https://playground.example/"

        try {
            model.editServer(serverUrl)
            model.connect()
            model.networkAccessResult(serverUrl, true)
            await { started.get() }

            val restoredState =
                SavedStateHandle(mapOf("server" to savedState.get<String>("server")))
            val restored = SettingsViewModel(preferences, restoredState, AppPreferences().serverUrl)

            assertEquals(serverUrl, restored.state.value.server)
            assertFalse(restored.state.value.pending)

            models.clear()
            await { released.get() }

            assertEquals(
                AppPreferences().serverUrl,
                runBlocking { preferences.preferences.first().serverUrl },
            )
        } finally {
            models.clear()
        }
    }

    @Test
    fun `leaving settings cancels an outstanding permission request and allows a fresh attempt`() {
        val preferences = PreferencesRepository(RuntimeEnvironment.getApplication())
        val models = ViewModelStore()
        var checks = 0
        val model =
            createModel(models, preferences) {
                checks++
                "fixture"
            }
        val serverUrl = "https://playground.example/"

        try {
            model.editServer(serverUrl)
            model.connect()
            model.cancelConnection()
            model.networkAccessResult(serverUrl, true)

            assertFalse(model.state.value.pending)
            assertNull(model.state.value.permissionRequest)
            assertEquals(0, checks)
            assertEquals(serverUrl, model.state.value.server)

            model.connect()
            model.networkAccessResult(serverUrl, true)
            await { !model.state.value.pending }

            assertEquals(1, checks)
            assertEquals(serverUrl, runBlocking { preferences.preferences.first().serverUrl })
        } finally {
            models.clear()
        }
    }

    @Test
    fun `cancelled checker finishing after a retry cannot save or finalize the new attempt`() {
        val preferences = PreferencesRepository(RuntimeEnvironment.getApplication())
        val models = ViewModelStore()
        val oldResult = CompletableDeferred<String>()
        val oldCleanup = CompletableDeferred<Unit>()
        val oldFinished = AtomicBoolean()
        val nextResult = CompletableDeferred<String>()
        var checks = 0
        val model =
            createModel(models, preferences) {
                checks++

                if (checks == 1) {
                    // Model a checker whose cleanup returns a result even after its caller was
                    // cancelled.
                    withContext(NonCancellable) {
                        oldResult.await()
                        oldCleanup.await()
                        oldFinished.set(true)

                        "stale model"
                    }
                } else {
                    nextResult.await()
                }
            }
        val oldServer = "https://old.example/"
        val nextServer = "https://next.example/"

        try {
            model.editServer(oldServer)
            model.connect()
            model.networkAccessResult(oldServer, true)
            await { checks == 1 }
            model.cancelConnection()

            model.editServer(nextServer)
            model.connect()
            model.networkAccessResult(nextServer, true)
            await { checks == 2 }
            oldResult.complete("unused")
            oldCleanup.complete(Unit)
            await { oldFinished.get() }

            assertTrue(model.state.value.pending)
            assertNull(model.state.value.error)
            assertNull(model.state.value.status)
            assertEquals(
                AppPreferences().serverUrl,
                runBlocking { preferences.preferences.first().serverUrl },
            )

            nextResult.complete("current model")
            await { !model.state.value.pending }

            assertEquals(nextServer, runBlocking { preferences.preferences.first().serverUrl })
            assertEquals("Connected · current model", model.state.value.status)
        } finally {
            oldResult.complete("unused")
            oldCleanup.complete(Unit)
            models.clear()
        }
    }

    private fun createModel(
        models: ViewModelStore,
        preferences: PreferencesRepository,
        savedState: SavedStateHandle = SavedStateHandle(),
        checkConnection: suspend (String) -> String,
    ): SettingsViewModel {
        runBlocking {
            preferences.updateServerUrl(AppPreferences().serverUrl)
            preferences.resetAppearanceAndKeyboard()
        }

        return ViewModelProvider(
            models,
            viewModelFactory {
                initializer {
                    SettingsViewModel(
                        preferences,
                        savedState,
                        AppPreferences().serverUrl,
                        checkConnection,
                    )
                }
            },
        )[SettingsViewModel::class.java]
    }

    private fun await(condition: () -> Boolean) {
        val deadline = System.nanoTime() + 5_000_000_000L

        while (System.nanoTime() < deadline) {
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            if (condition()) {
                return
            }

            Thread.sleep(10)
        }

        assertTrue("Timed out waiting for settings state", condition())
    }
}

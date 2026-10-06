package com.agentplayground.app

import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import com.agentplayground.app.data.AppPreferences
import com.agentplayground.app.design.PlaygroundTheme
import com.agentplayground.app.network.ServerNetworkAccess
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = PlaygroundApplication::class, qualifiers = "w360dp-h740dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ServerConnectionGateTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `first launch waits for permission before creating the connected workspace`() {
        val result = CompletableDeferred<Boolean>()
        var requests = 0
        val access =
            ServerNetworkAccess(
                sdkInt = 37,
                isGranted = { false },
                requestPermission = {
                    requests++
                    result.await()
                },
            )

        fixture(access)

        compose.waitUntil { requests == 1 }
        compose.onNodeWithText("Connected workspace").assertDoesNotExist()

        compose.runOnIdle { result.complete(true) }
        compose.onNodeWithText("Connected workspace").assertIsDisplayed()
    }

    @Test
    fun `denial keeps settings available and connecting retries permission without starting HTTP`() {
        var requests = 0
        val access =
            ServerNetworkAccess(
                sdkInt = 37,
                isGranted = { false },
                requestPermission = {
                    requests++
                    false
                },
            )

        fixture(access)

        compose.onNodeWithText("Open app permissions").assertIsDisplayed()
        compose.onNodeWithText("Connected workspace").assertDoesNotExist()
        compose.onNodeWithText("Clear all conversations").assertDoesNotExist()

        compose.onNodeWithText("Connect and save").performClick()
        compose.waitUntil { requests == 2 }

        compose.onNodeWithText("Connect and save").assertIsEnabled()
        compose.onNodeWithText("Open app permissions").assertIsDisplayed()
        compose.runOnIdle { assertEquals(2, requests) }
    }

    @Test
    fun `returning to the app after permission revocation gates the workspace again`() {
        var granted = true
        val access =
            ServerNetworkAccess(
                sdkInt = 37,
                isGranted = { granted },
                requestPermission = { error("Resume checks do not launch permission dialogs") },
            )

        fixture(access)

        compose.onNodeWithText("Connected workspace").assertIsDisplayed()
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        granted = false
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)

        compose.onNodeWithText("Connected workspace").assertDoesNotExist()
        compose.onNodeWithText("Open app permissions").assertIsDisplayed()
    }

    private fun fixture(access: ServerNetworkAccess) {
        val application = RuntimeEnvironment.getApplication() as PlaygroundApplication

        compose.setContent {
            PlaygroundTheme("light") {
                ServerConnectionGate(application, AppPreferences(), access) {
                    Text("Connected workspace")
                }
            }
        }
    }
}

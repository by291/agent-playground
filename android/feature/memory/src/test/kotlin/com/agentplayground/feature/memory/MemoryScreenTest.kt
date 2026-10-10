package com.agentplayground.feature.memory

import android.os.Looper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.agentplayground.core.network.PlaygroundApi
import com.agentplayground.data.memory.MemoryRepository
import com.agentplayground.ui.PlaygroundTheme
import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MemoryScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `correction is editable and commits from a narrow large-text screen`() {
        fixture(largeText = true) { fixture ->
            openActions()
            compose
                .onNodeWithContentDescription("Correct memory: Use concise replies.")
                .performClick()
            compose.onNodeWithText("Memory text").performTextReplacement("Use concrete examples.")
            fixture.server.enqueue(MockResponse().setBody(record("Use concrete examples.", 2)))
            fixture.server.enqueue(page("Use concrete examples.", 2))

            compose.onNodeWithText("Save correction").assertIsDisplayed().performClick()
            await { !fixture.vm.state.value.busy }

            assertNull(fixture.vm.state.value.dialog)
            compose.onNodeWithText("Use concrete examples.").performScrollTo().assertIsDisplayed()
            assertEquals("PATCH", fixture.server.takeRequest(1, TimeUnit.SECONDS)!!.method)
        }
    }

    @Test
    fun `conflict shows current saved text and requires review while preserving the draft`() {
        fixture { fixture ->
            openActions()
            compose
                .onNodeWithContentDescription("Correct memory: Use concise replies.")
                .performClick()
            compose.onNodeWithText("Memory text").performTextReplacement("My correction.")
            fixture.server.enqueue(
                MockResponse().setResponseCode(409).setBody("""{"error":"Memory changed"}""")
            )
            fixture.server.enqueue(page("Another instance changed this.", 2))
            compose.onNodeWithText("Save correction").performClick()
            await { !fixture.vm.state.value.busy }

            compose
                .onNodeWithTag("latest-memory-text")
                .assertTextEquals("Another instance changed this.")
            compose.onNodeWithText("Memory text").assertTextContains("My correction.")
            compose.onNodeWithText("Save correction").assertIsNotEnabled()
            compose.onNodeWithText("Review latest memory").performClick()

            compose.onNodeWithText("Memory text").assertTextContains("My correction.")
            compose.onNodeWithText("Save correction").assertIsEnabled()
        }
    }

    @Test
    fun `forget asks for confirmation and keeps a failed operation open for retry`() {
        fixture { fixture ->
            openActions()
            compose
                .onNodeWithContentDescription("Forget memory: Use concise replies.")
                .performClick()
            compose.onNodeWithText("Forget memory?").assertIsDisplayed()
            assertEquals(1, fixture.server.requestCount)
            fixture.server.enqueue(
                MockResponse().setResponseCode(503).setBody("""{"error":"Memory unavailable"}""")
            )
            fixture.server.enqueue(page())

            compose.onNodeWithText("Forget memory", useUnmergedTree = true).performClick()
            await { !fixture.vm.state.value.busy }

            compose.onNodeWithText("Memory unavailable").assertIsDisplayed()
            compose.onNodeWithText("Forget memory?").assertIsDisplayed()
            compose.onNodeWithText("Cancel").performClick()
            assertNull(fixture.vm.state.value.dialog)
            compose.onNodeWithText("Use concise replies.").performScrollTo().assertIsDisplayed()
        }
    }

    private fun openActions() {
        compose.onNodeWithText("Correct").assertDoesNotExist()
        compose.onNodeWithText("Forget").assertDoesNotExist()
        compose
            .onNodeWithContentDescription("Memory actions: Use concise replies.")
            .performScrollTo()
            .performClick()
        compose.onNodeWithText("Correct").assertIsDisplayed()
        compose.onNodeWithText("Source conversation").assertIsDisplayed()
        compose.onNodeWithText("Forget").assertIsDisplayed()
    }

    private fun fixture(largeText: Boolean = false, check: (Fixture) -> Unit) {
        Fixture().use { fixture ->
            fixture.server.enqueue(page())
            fixture.vm.reload()
            await { !fixture.vm.state.value.busy }
            fixture.server.takeRequest(1, TimeUnit.SECONDS)

            compose.setContent {
                CompositionLocalProvider(
                    LocalDensity provides Density(1f, fontScale = if (largeText) 1.6f else 1f)
                ) {
                    PlaygroundTheme(if (largeText) "dark" else "light") {
                        MemoryRoute(fixture.vm, onOpenSource = {})
                    }
                }
            }

            check(fixture)
        }
    }

    private fun record(text: String = "Use concise replies.", revision: Int = 1) =
        """{"id":"first","category":"preference","project":null,"text":"$text","sourceThreadId":"thread","sourceMessageId":"message","revision":$revision,"createdAt":"2026-10-10T00:00:00Z","updatedAt":"2026-10-10T00:00:00Z"}"""

    private fun page(text: String = "Use concise replies.", revision: Int = 1) =
        MockResponse().setBody("""{"items":[${record(text, revision)}],"nextOffset":null}""")

    private fun await(condition: () -> Boolean) {
        compose.waitUntil(10_000) {
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            condition()
        }
        compose.waitForIdle()
    }

    private class Fixture : AutoCloseable {
        val server = MockWebServer()
        private val store = ViewModelStore()
        val vm: MemoryViewModel

        init {
            server.start()
            val repository = MemoryRepository(PlaygroundApi(server.url("/").toString()))
            vm =
                ViewModelProvider(
                    store,
                    object : ViewModelProvider.Factory {
                        @Suppress("UNCHECKED_CAST")
                        override fun <T : ViewModel> create(modelClass: Class<T>): T =
                            MemoryViewModel(repository) as T
                    },
                )[MemoryViewModel::class.java]
        }

        override fun close() {
            store.clear()
            server.close()
        }
    }
}

package com.agentplayground.feature.memory

import android.os.Looper
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.agentplayground.data.RepositoryFactory
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MemoryViewModelTest {
    @Test
    fun `load-more failure retains entries and retries the same offset without duplicates`() {
        Fixture().use { fixture ->
            fixture.load(page(record(), next = 50))
            fixture.server.enqueue(unavailable())
            fixture.vm.loadMore()
            fixture.awaitIdle()

            assertEquals("Use concise replies.", fixture.vm.state.value.memories.single().text)
            assertEquals(50, fixture.vm.state.value.nextOffset)
            assertNotNull(fixture.vm.state.value.moreError)

            fixture.server.enqueue(
                page(record(revision = 2), record(id = "second", text = "Use pnpm."))
            )
            fixture.vm.loadMore()
            fixture.awaitIdle()

            assertEquals(listOf("first", "second"), fixture.vm.state.value.memories.map { it.id })
            assertEquals(2L, fixture.vm.state.value.memories.first().revision)
            assertNull(fixture.vm.state.value.moreError)
            assertNull(fixture.vm.state.value.nextOffset)
            assertEquals("/api/memories?offset=0&limit=50", fixture.request().path)
            assertEquals("/api/memories?offset=50&limit=50", fixture.request().path)
            assertEquals("/api/memories?offset=50&limit=50", fixture.request().path)
        }
    }

    @Test
    fun `a conflicting correction keeps its draft until the latest revision is reviewed`() {
        Fixture().use { fixture ->
            fixture.load(page(record()))
            fixture.vm.beginCorrection(fixture.vm.state.value.memories.single())
            fixture.vm.updateDraft("My correction.")
            fixture.server.enqueue(conflict())
            fixture.server.enqueue(
                page(record(revision = 2, text = "Another instance changed this."))
            )

            fixture.vm.confirm()
            fixture.awaitIdle()

            assertEquals("My correction.", fixture.vm.state.value.dialog!!.draft)
            assertTrue(fixture.vm.state.value.dialog!!.conflict)
            assertEquals(2L, fixture.vm.state.value.memories.single().revision)
            val admitted = fixture.server.requestCount

            fixture.vm.confirm()
            assertEquals(admitted, fixture.server.requestCount)
            fixture.vm.reviewLatest()
            assertFalse(fixture.vm.state.value.dialog!!.conflict)
            assertEquals(2L, fixture.vm.state.value.dialog!!.memory.revision)
            assertEquals("My correction.", fixture.vm.state.value.dialog!!.draft)

            fixture.server.enqueue(
                MockResponse().setBody(record(revision = 3, text = "My correction."))
            )
            fixture.server.enqueue(unavailable())
            fixture.vm.confirm()
            fixture.awaitIdle()

            assertNull(fixture.vm.state.value.dialog)
            assertEquals("My correction.", fixture.vm.state.value.memories.single().text)
            assertEquals(3L, fixture.vm.state.value.memories.single().revision)
            assertNotNull(fixture.vm.state.value.error)
            fixture.request()
            val first = fixture.request()
            fixture.request()
            val retried = fixture.request()
            assertEquals(1L, body(first)["revision"]!!.jsonPrimitive.long)
            assertEquals(2L, body(retried)["revision"]!!.jsonPrimitive.long)
        }
    }

    @Test
    fun `forget uses the reviewed revision and keeps removal visible after a refresh failure`() {
        Fixture().use { fixture ->
            fixture.load(page(record()))
            fixture.vm.beginForget(fixture.vm.state.value.memories.single())
            fixture.server.enqueue(conflict())
            fixture.server.enqueue(page(record(revision = 2, text = "Updated preference.")))
            fixture.vm.confirm()
            fixture.awaitIdle()

            assertNotNull(fixture.vm.state.value.dialog)
            assertEquals(1L, fixture.vm.state.value.dialog!!.memory.revision)
            fixture.vm.reviewLatest()
            assertEquals("Updated preference.", fixture.vm.state.value.dialog!!.memory.text)
            fixture.server.enqueue(MockResponse().setResponseCode(204))
            fixture.server.enqueue(unavailable())
            fixture.vm.confirm()
            fixture.awaitIdle()

            assertNull(fixture.vm.state.value.dialog)
            assertTrue(fixture.vm.state.value.memories.isEmpty())
            fixture.request()
            assertEquals("DELETE", fixture.request().method)
            fixture.request()
            val deletion = fixture.request()
            val scope = body(deletion)
            assertEquals("DELETE", deletion.method)
            assertEquals(2L, scope["revision"]!!.jsonPrimitive.long)
            assertTrue(scope["project"] is JsonNull)
        }
    }

    @Test
    fun `a pending mutation blocks dismissal and duplicate submission`() {
        Fixture().use { fixture ->
            fixture.load(page(record()))
            fixture.vm.beginCorrection(fixture.vm.state.value.memories.single())
            fixture.vm.updateDraft("Updated preference.")
            fixture.server.enqueue(
                MockResponse()
                    .setBody(record(revision = 2, text = "Updated preference."))
                    .setHeadersDelay(200, TimeUnit.MILLISECONDS)
            )
            fixture.server.enqueue(page(record(revision = 2, text = "Updated preference.")))

            fixture.vm.confirm()
            assertTrue(fixture.vm.state.value.busy)
            fixture.vm.dismissDialog()
            fixture.vm.confirm()
            fixture.vm.reload()
            assertNotNull(fixture.vm.state.value.dialog)
            fixture.awaitIdle()

            assertNull(fixture.vm.state.value.dialog)
            assertEquals(3, fixture.server.requestCount)
        }
    }

    @Test
    fun `conflict refresh can fail and retry without replacing the correction draft`() {
        Fixture().use { fixture ->
            fixture.load(page(record()))
            fixture.vm.beginCorrection(fixture.vm.state.value.memories.single())
            fixture.vm.updateDraft("My correction.")
            fixture.server.enqueue(conflict())
            fixture.server.enqueue(unavailable())

            fixture.vm.confirm()
            fixture.awaitIdle()

            assertTrue(fixture.vm.state.value.dialog!!.conflict)
            assertNotNull(fixture.vm.state.value.error)
            fixture.vm.reviewLatest()
            fixture.vm.confirm()
            assertEquals(3, fixture.server.requestCount)
            assertEquals(1L, fixture.vm.state.value.dialog!!.memory.revision)

            fixture.server.enqueue(page(record(revision = 2, text = "Latest saved text.")))
            fixture.vm.reload()
            fixture.awaitIdle()
            fixture.vm.reviewLatest()

            assertNull(fixture.vm.state.value.error)
            assertFalse(fixture.vm.state.value.dialog!!.conflict)
            assertEquals(2L, fixture.vm.state.value.dialog!!.memory.revision)
            assertEquals("My correction.", fixture.vm.state.value.dialog!!.draft)
        }
    }

    @Test
    fun `refresh reloads every loaded page after a deletion changes page boundaries`() {
        Fixture().use { fixture ->
            fixture.load(page(record(), next = 50))
            fixture.server.enqueue(page(record(id = "second"), next = 100))
            fixture.vm.loadMore()
            fixture.awaitIdle()
            fixture.vm.beginForget(fixture.vm.state.value.memories.first())
            fixture.server.enqueue(MockResponse().setResponseCode(204))
            fixture.server.enqueue(page(record(id = "second"), next = 50))
            fixture.server.enqueue(page(record(id = "third"), next = 100))

            fixture.vm.confirm()
            fixture.awaitIdle()

            assertEquals(listOf("second", "third"), fixture.vm.state.value.memories.map { it.id })
            assertEquals(100, fixture.vm.state.value.nextOffset)
            fixture.request()
            fixture.request()
            assertEquals("DELETE", fixture.request().method)
            assertEquals("/api/memories?offset=0&limit=50", fixture.request().path)
            assertEquals("/api/memories?offset=50&limit=50", fixture.request().path)
        }
    }

    @Test
    fun `releasing the server graph cancels a pending mutation without another refresh`() {
        Fixture().use { fixture ->
            fixture.load(page(record()))
            fixture.request()
            fixture.vm.beginForget(fixture.vm.state.value.memories.single())
            fixture.server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))

            fixture.vm.confirm()
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            assertEquals("DELETE", fixture.request().method)
            fixture.releaseViewModel()
            fixture.awaitIdle()

            assertEquals(2, fixture.server.requestCount)
            assertNull(fixture.vm.state.value.error)
        }
    }

    @Test
    fun `invalid text is rejected before a memory write`() {
        Fixture().use { fixture ->
            fixture.load(page(record()))
            fixture.vm.beginCorrection(fixture.vm.state.value.memories.single())

            for (text in listOf("   ", "x".repeat(1001))) {
                fixture.vm.updateDraft(text)
                fixture.vm.confirm()
                assertFalse(fixture.vm.state.value.busy)
                assertNotNull(fixture.vm.state.value.dialog!!.error)
            }

            assertEquals(1, fixture.server.requestCount)
        }
    }

    private fun record(
        id: String = "first",
        revision: Int = 1,
        text: String = "Use concise replies.",
    ) =
        """{"id":"$id","category":"preference","project":null,"text":"$text","sourceThreadId":"thread","sourceMessageId":"message","revision":$revision,"createdAt":"2026-10-10T00:00:00Z","updatedAt":"2026-10-10T00:00:00Z"}"""

    private fun page(vararg records: String, next: Int? = null) =
        MockResponse().setBody("""{"items":[${records.joinToString(",")}],"nextOffset":$next}""")

    private fun unavailable() =
        MockResponse().setResponseCode(503).setBody("""{"error":"Memory service unavailable"}""")

    private fun conflict() =
        MockResponse().setResponseCode(409).setBody("""{"error":"Memory changed"}""")

    private fun body(request: RecordedRequest) =
        Json.parseToJsonElement(request.body.readUtf8()).jsonObject

    private class Fixture : AutoCloseable {
        val server = MockWebServer()
        private val store = ViewModelStore()
        val vm: MemoryViewModel

        init {
            server.start()
            val repository =
                RepositoryFactory(RuntimeEnvironment.getApplication())
                    .memory(server.url("/").toString())
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

        fun load(response: MockResponse) {
            server.enqueue(response)
            vm.reload()
            awaitIdle()
        }

        fun awaitIdle() {
            val deadline = System.nanoTime() + 10_000_000_000L

            while (vm.state.value.busy && System.nanoTime() < deadline) {
                Shadows.shadowOf(Looper.getMainLooper()).idle()
                Thread.sleep(5)
            }

            assertFalse("Memory request did not settle", vm.state.value.busy)
        }

        fun request() = requireNotNull(server.takeRequest(1, TimeUnit.SECONDS))

        fun releaseViewModel() {
            store.clear()
        }

        override fun close() {
            releaseViewModel()
            server.close()
        }
    }
}

package com.agentplayground.app

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Looper
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.core.net.toUri
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.agentplayground.app.features.knowledge.KnowledgeViewModel
import com.agentplayground.app.files.DocumentAccess
import com.agentplayground.core.PlaygroundApi
import java.io.ByteArrayInputStream
import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class KnowledgeUploadTest {
    @Test
    fun `failed upload retry uses the same document identity and selection`() {
        Fixture().use { fixture ->
            fixture.server.enqueue(unavailable())
            fixture.server.enqueue(MockResponse().setBody("[]"))

            fixture.vm.upload(listOf(fixture.uri))
            await { !fixture.vm.state.value.busy }

            val retained = fixture.vm.state.value.pendingUploads.single()

            assertNotNull(fixture.vm.state.value.error)

            fixture.server.enqueue(MockResponse().setBody(document(retained.id, "queued")))
            fixture.server.enqueue(MockResponse().setBody("[]"))

            fixture.vm.retryUploads()
            await { !fixture.vm.state.value.busy }

            assertNull(fixture.vm.state.value.error)
            assertTrue(fixture.vm.state.value.pendingUploads.isEmpty())

            val first = fixture.request()
            assertEquals("GET", fixture.request().method)
            val second = fixture.request()

            assertEquals(retained.id, first.getHeader("X-Document-Id"))
            assertEquals(first.getHeader("X-Document-Id"), second.getHeader("X-Document-Id"))
            assertEquals("Hello", second.body.readUtf8())
        }
    }

    @Test
    fun `ambiguous upload failure refreshes server documents and preserves retry selection`() {
        Fixture().use { fixture ->
            fixture.server.enqueue(unavailable())

            fixture.vm.upload(listOf(fixture.uri))
            await { fixture.server.requestCount > 0 }

            val upload = fixture.request()
            val id = requireNotNull(upload.getHeader("X-Document-Id"))

            fixture.server.enqueue(MockResponse().setBody("[${document(id, "uploading")}]"))
            await { !fixture.vm.state.value.busy }

            assertEquals(id, fixture.vm.state.value.documents.single().id)
            assertEquals(id, fixture.vm.state.value.pendingUploads.single().id)
            assertEquals(fixture.uri, fixture.vm.state.value.pendingUploads.single().uri)
            assertTrue(fixture.vm.state.value.error!!.contains("Response unavailable"))
            assertEquals("POST", upload.method)
            assertEquals("GET", fixture.request().method)
        }
    }

    @Test
    fun `unsupported knowledge file is rejected before upload`() {
        Fixture(name = "notes.png").use { fixture ->
            fixture.server.enqueue(MockResponse().setBody("[]"))

            fixture.vm.upload(listOf(fixture.uri))
            await { !fixture.vm.state.value.busy }

            assertTrue(fixture.vm.state.value.error!!.contains("TXT, Markdown or PDF"))
            assertTrue(fixture.vm.state.value.pendingUploads.isEmpty())
            assertNoUpload(fixture)
        }
    }

    @Test
    fun `known empty knowledge file is rejected before upload`() {
        Fixture(size = 0L, content = byteArrayOf()).use { fixture ->
            fixture.server.enqueue(MockResponse().setBody("[]"))

            fixture.vm.upload(listOf(fixture.uri))
            await { !fixture.vm.state.value.busy }

            assertTrue(fixture.vm.state.value.error!!.contains("nonempty"))
            assertTrue(fixture.vm.state.value.pendingUploads.isEmpty())
            assertNoUpload(fixture)
        }
    }

    @Test
    fun `unknown size empty knowledge file is rejected after bounded read`() {
        Fixture(size = null, content = byteArrayOf()).use { fixture ->
            fixture.server.enqueue(MockResponse().setBody("[]"))

            fixture.vm.upload(listOf(fixture.uri))
            await { !fixture.vm.state.value.busy }

            assertTrue(fixture.vm.state.value.error!!.contains("nonempty"))
            assertNoUpload(fixture)
        }
    }

    @Test
    fun `server unfinished upload resumes its original identity after picker recreation`() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()

        try {
            Fixture(store = controller.get().viewModelStore).use { fixture ->
                fixture.server.enqueue(
                    MockResponse().setBody("[${document("original-id", "uploading")}]")
                )

                fixture.vm.reload()
                await { fixture.vm.state.value.documents.isNotEmpty() }

                assertTrue(fixture.vm.state.value.pendingUploads.isEmpty())
                assertTrue(fixture.vm.beginResume("original-id"))

                controller.configurationChange()
                val restored = ViewModelProvider(controller.get())[KnowledgeViewModel::class.java]

                assertEquals("original-id", restored.state.value.resumeDocument?.id)

                fixture.server.enqueue(MockResponse().setBody(document("original-id", "queued")))
                fixture.server.enqueue(
                    MockResponse().setBody("[${document("original-id", "queued")}]")
                )

                restored.resumeUpload(fixture.uri)
                await { !restored.state.value.busy }

                assertNull(restored.state.value.error)
                assertNull(restored.state.value.resumeDocument)
                assertTrue(restored.state.value.pendingUploads.isEmpty())
                assertEquals("GET", fixture.request().method)
                val upload = fixture.request()

                assertEquals("original-id", upload.getHeader("X-Document-Id"))
                assertEquals("Hello", upload.body.readUtf8())
                assertEquals("queued", restored.state.value.documents.single().status)
            }
        } finally {
            controller.pause().stop().destroy()
        }
    }

    @Test
    fun `resume rejects a different original file without uploading`() {
        Fixture(name = "different.md").use { fixture ->
            fixture.server.enqueue(
                MockResponse().setBody("[${document("original-id", "uploading")}]")
            )

            fixture.vm.reload()
            await { fixture.vm.state.value.documents.isNotEmpty() }

            assertTrue(fixture.vm.beginResume("original-id"))

            fixture.vm.resumeUpload(fixture.uri)
            await { !fixture.vm.state.value.busy }

            assertTrue(fixture.vm.state.value.error!!.contains("Choose the original notes.txt"))
            assertTrue(fixture.vm.state.value.pendingUploads.isEmpty())
            assertNull(fixture.vm.state.value.resumeDocument)
            assertNoUpload(fixture)
        }
    }

    @Test
    fun `cancelled resume picker releases target and does not create an upload`() {
        Fixture().use { fixture ->
            fixture.server.enqueue(
                MockResponse().setBody("[${document("original-id", "uploading")}]")
            )

            fixture.vm.reload()
            await { fixture.vm.state.value.documents.isNotEmpty() }

            assertTrue(fixture.vm.beginResume("original-id"))

            fixture.vm.resumeUpload(null)

            assertNull(fixture.vm.state.value.resumeDocument)
            assertTrue(fixture.vm.state.value.pendingUploads.isEmpty())
            assertFalse(fixture.vm.state.value.busy)
            assertNoUpload(fixture)
        }
    }

    @Test
    fun `unknown size supported file is accepted after bounded read`() {
        Fixture(size = null).use { fixture ->
            fixture.server.enqueue(unavailable())
            fixture.server.enqueue(MockResponse().setBody("[]"))

            fixture.vm.upload(listOf(fixture.uri))
            await { !fixture.vm.state.value.busy }

            val upload = fixture.request()

            assertEquals("POST", upload.method)
            assertEquals("Hello", upload.body.readUtf8())
            assertEquals(
                fixture.vm.state.value.pendingUploads.single().id,
                upload.getHeader("X-Document-Id"),
            )
        }
    }

    @Test
    fun `unknown size oversized document is rejected without uploading`() {
        Fixture(size = null, content = ByteArray(10 * 1024 * 1024 + 1)).use { fixture ->
            fixture.vm.upload(listOf(fixture.uri))
            await { !fixture.vm.state.value.busy }

            assertTrue(fixture.vm.state.value.error!!.contains("at most 10 MiB"))
            assertTrue(fixture.vm.state.value.pendingUploads.isEmpty())
            assertEquals(0, fixture.server.requestCount)
        }
    }

    @Test
    fun `failed refresh preserves original upload failure and retry selection`() {
        Fixture().use { fixture ->
            fixture.server.enqueue(unavailable())
            fixture.server.enqueue(
                MockResponse().setResponseCode(500).setBody("{\"error\":\"List unavailable\"}")
            )

            fixture.vm.upload(listOf(fixture.uri))
            await { !fixture.vm.state.value.busy }

            assertTrue(fixture.vm.state.value.error!!.contains("Response unavailable"))
            assertEquals(fixture.uri, fixture.vm.state.value.pendingUploads.single().uri)
            assertEquals("POST", fixture.request().method)
            assertEquals("GET", fixture.request().method)
        }
    }

    @Test
    fun `failed reindex refreshes server status while keeping its error`() {
        Fixture().use { fixture ->
            fixture.server.enqueue(unavailable())
            fixture.server.enqueue(
                MockResponse().setBody("[${document("original-id", "indexing")}]")
            )

            fixture.vm.reindex("original-id")
            await { !fixture.vm.state.value.busy }

            assertEquals("indexing", fixture.vm.state.value.documents.single().status)
            assertTrue(fixture.vm.state.value.error!!.contains("Response unavailable"))
            assertEquals("/api/knowledge/documents/original-id/reindex", fixture.request().path)
            assertEquals("GET", fixture.request().method)
        }
    }

    private fun assertNoUpload(fixture: Fixture) {
        repeat(fixture.server.requestCount) { assertNotEquals("POST", fixture.request().method) }
    }

    private fun unavailable() =
        MockResponse().setResponseCode(503).setBody("{\"error\":\"Response unavailable\"}")

    private fun document(id: String, status: String) =
        """{"id":"$id","name":"notes.txt","size":5,"status":"$status","chunkCount":0,"createdAt":"now","updatedAt":"now"}"""

    private fun await(condition: () -> Boolean) {
        val deadline = System.nanoTime() + 10_000_000_000L

        while (!condition() && System.nanoTime() < deadline) {
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }

        assertTrue("Operation did not finish", condition())
    }

    private class Fixture(
        name: String = "notes.txt",
        size: Long? = 5L,
        content: ByteArray = "Hello".toByteArray(),
        private val store: ViewModelStore = ViewModelStore(),
    ) : AutoCloseable {
        val server = MockWebServer()
        val uri = "content://upload-fixture/notes".toUri()
        val vm: KnowledgeViewModel

        init {
            server.start()

            val resolver = RuntimeEnvironment.getApplication().contentResolver

            ShadowContentResolver.registerProviderInternal(
                "upload-fixture",
                MetadataProvider(name, size),
            )
            Shadows.shadowOf(resolver).registerInputStreamSupplier(uri) {
                ByteArrayInputStream(content)
            }

            val api = PlaygroundApi(server.url("/").toString())

            vm =
                ViewModelProvider(
                    store,
                    object : ViewModelProvider.Factory {
                        @Suppress("UNCHECKED_CAST")
                        override fun <T : androidx.lifecycle.ViewModel> create(
                            modelClass: Class<T>
                        ): T = KnowledgeViewModel(api, DocumentAccess(resolver)) as T
                    },
                )[KnowledgeViewModel::class.java]
        }

        fun request() = requireNotNull(server.takeRequest(1, TimeUnit.SECONDS))

        override fun close() {
            store.clear()
            server.close()
        }
    }

    class MetadataProvider(private val name: String = "notes.txt", private val size: Long? = 5L) :
        ContentProvider() {
        override fun onCreate() = true

        override fun query(
            uri: Uri,
            projection: Array<out String>?,
            selection: String?,
            selectionArgs: Array<out String>?,
            sortOrder: String?,
        ): Cursor =
            MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)).apply {
                addRow(arrayOf<Any?>(name, size))
            }

        override fun getType(uri: Uri) = "text/plain"

        override fun insert(uri: Uri, values: ContentValues?): Uri? = null

        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0

        override fun update(
            uri: Uri,
            values: ContentValues?,
            selection: String?,
            selectionArgs: Array<out String>?,
        ) = 0
    }
}

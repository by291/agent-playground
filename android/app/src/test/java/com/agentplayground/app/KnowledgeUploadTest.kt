package com.agentplayground.app

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Looper
import android.provider.OpenableColumns
import androidx.core.net.toUri
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.agentplayground.app.features.knowledge.KnowledgeViewModel
import com.agentplayground.app.files.DocumentAccess
import com.agentplayground.core.PlaygroundApi
import java.io.ByteArrayInputStream
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
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
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setResponseCode(503).setBody("{\"error\":\"Response unavailable\"}")
            )
            server.start()
            val context = RuntimeEnvironment.getApplication()
            val resolver = context.contentResolver
            val uri = "content://upload-fixture/notes".toUri()
            ShadowContentResolver.registerProviderInternal("upload-fixture", MetadataProvider())
            Shadows.shadowOf(resolver).registerInputStreamSupplier(uri) {
                ByteArrayInputStream("Hello".toByteArray())
            }
            val api = PlaygroundApi(server.url("/").toString())
            val store = ViewModelStore()
            val vm =
                ViewModelProvider(
                    store,
                    object : ViewModelProvider.Factory {
                        @Suppress("UNCHECKED_CAST")
                        override fun <T : androidx.lifecycle.ViewModel> create(
                            modelClass: Class<T>
                        ): T = KnowledgeViewModel(api, DocumentAccess(resolver)) as T
                    },
                )[KnowledgeViewModel::class.java]
            try {
                vm.upload(listOf(uri))
                await { !vm.state.value.busy }
                assertNotNull(vm.state.value.error)
                val retained = vm.state.value.pendingUploads.single()
                server.enqueue(
                    MockResponse()
                        .setBody(
                            """{"id":"${retained.id}","name":"notes.txt","size":5,"status":"queued","chunkCount":0,"createdAt":"now","updatedAt":"now"}"""
                        )
                )
                server.enqueue(MockResponse().setBody("[]"))
                vm.retryUploads()
                await { !vm.state.value.busy }
                assertNull(vm.state.value.error)
                assertTrue(vm.state.value.pendingUploads.isEmpty())
                val first = server.takeRequest()
                val second = server.takeRequest()
                assertEquals(retained.id, first.getHeader("X-Document-Id"))
                assertEquals(first.getHeader("X-Document-Id"), second.getHeader("X-Document-Id"))
                assertEquals("Hello", second.body.readUtf8())
            } finally {
                store.clear()
            }
        }
    }

    private fun await(condition: () -> Boolean) {
        val deadline = System.nanoTime() + 10_000_000_000L
        while (!condition() && System.nanoTime() < deadline) {
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }
        assertTrue("Operation did not finish", condition())
    }

    class MetadataProvider : ContentProvider() {
        override fun onCreate() = true

        override fun query(
            uri: Uri,
            projection: Array<out String>?,
            selection: String?,
            selectionArgs: Array<out String>?,
            sortOrder: String?,
        ): Cursor =
            MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)).apply {
                addRow(arrayOf<Any>("notes.txt", 5L))
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

package com.agentplayground.app

import android.content.ContentProvider
import android.content.ContentValues
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.graphics.Bitmap
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.core.graphics.createBitmap
import com.agentplayground.app.files.AttachmentImages
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AttachmentImagesTest {
    @Test
    fun `remote image bytes decode to bounded thumbnails and reuse the memory cache`() =
        runBlocking {
            val bitmap = createBitmap(1200, 600)
            val output = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
            bitmap.recycle()
            var transfers = 0

            AttachmentImages(RuntimeEnvironment.getApplication()).use { images ->
                val thumbnail =
                    images.load("https://server/thumbnail", 320) {
                        transfers += 1
                        output.toByteArray()
                    }
                val repeated =
                    images.load("https://server/thumbnail", 320) {
                        transfers += 1
                        output.toByteArray()
                    }

                assertNotNull(thumbnail)
                assertTrue(thumbnail!!.width in 1..320)
                assertTrue(thumbnail.height in 1..320)
                assertEquals(thumbnail.width, thumbnail.height * 2)
                assertSame(thumbnail.asAndroidBitmap(), repeated!!.asAndroidBitmap())
                assertEquals(1, transfers)
            }
        }

    @Test
    fun `invalid image bytes produce an unavailable preview`() = runBlocking {
        AttachmentImages(RuntimeEnvironment.getApplication()).use { images ->
            val image = images.load("https://server/invalid", 320) { "ordinary text".toByteArray() }

            assertNull(image)
        }
    }

    @Test
    // Native Robolectric ImageDecoder does not support content file descriptors. Exercise the
    // oldest supported Android decoder against a real document-provider descriptor instead.
    @Config(sdk = [26])
    fun `local selected images decode without a remote request`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val file = java.io.File.createTempFile("attachment-preview", ".png", context.cacheDir)
        val bitmap = createBitmap(600, 300)

        try {
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()

            ShadowContentResolver.registerProviderInternal(
                "attachment-preview",
                PreviewProvider(file).apply {
                    attachInfo(context, ProviderInfo().apply { authority = "attachment-preview" })
                },
            )

            AttachmentImages(context).use { images ->
                val image =
                    images.load("content://attachment-preview/photo", 320) {
                        error("Local previews must not request remote bytes.")
                    }

                assertNotNull(image)
                assertTrue(image!!.width in 1..320)
                assertEquals(image.width, image.height * 2)
            }
        } finally {
            file.delete()
        }
    }

    private class PreviewProvider(private val file: java.io.File) : ContentProvider() {
        override fun onCreate() = true

        override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)

        override fun getType(uri: Uri) = "image/png"

        override fun query(
            uri: Uri,
            projection: Array<out String>?,
            selection: String?,
            selectionArgs: Array<out String>?,
            sortOrder: String?,
        ): Cursor? = null

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

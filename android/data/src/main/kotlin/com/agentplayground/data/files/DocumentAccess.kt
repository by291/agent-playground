package com.agentplayground.data.files

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import com.agentplayground.core.model.Download
import com.agentplayground.core.model.MAX_FILE_BYTES
import com.agentplayground.core.model.validateFile
import com.agentplayground.core.network.PlaygroundApi
import java.io.ByteArrayOutputStream
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class PickedFile(
    val uri: Uri,
    val name: String,
    val size: Long?,
    val id: String = UUID.randomUUID().toString(),
)

class DocumentAccess(private val resolver: ContentResolver) {
    suspend fun inspect(uri: Uri): PickedFile =
        withContext(Dispatchers.IO) {
            resolver
                .query(
                    uri,
                    arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                    null,
                    null,
                    null,
                )
                ?.use { cursor ->
                    require(cursor.moveToFirst()) { "Document is unavailable." }

                    val name =
                        cursor.getString(cursor.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME))
                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                    val size =
                        if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                            cursor.getLong(sizeIndex)
                        } else {
                            null
                        }

                    validateFile(name, size ?: 0)

                    PickedFile(uri, name, size)
                } ?: error("Document details are unavailable.")
        }

    suspend fun read(file: PickedFile): ByteArray =
        withContext(Dispatchers.IO) {
            resolver.openInputStream(file.uri)?.use { stream ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(16 * 1024)
                var total = 0L

                while (true) {
                    val count = stream.read(buffer)

                    if (count < 0) {
                        break
                    }

                    total += count
                    require(total <= MAX_FILE_BYTES) { "Each file must be at most 10 MiB." }
                    output.write(buffer, 0, count)
                }

                validateFile(file.name, total)

                output.toByteArray()
            } ?: error("Could not open ${file.name}.")
        }

    suspend fun save(api: PlaygroundApi, download: Download, uri: Uri) =
        withContext(Dispatchers.IO) {
            resolver.openOutputStream(uri, "wt")?.use { api.download(download.url, it) }
                ?: error("Could not save ${download.name}.")
        }
}

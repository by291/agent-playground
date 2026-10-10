package com.agentplayground.data.files

import android.content.ContentResolver
import android.provider.OpenableColumns
import androidx.core.net.toUri
import com.agentplayground.data.network.PlaygroundApi
import com.agentplayground.domain.files.PickedFile
import com.agentplayground.domain.model.Download
import com.agentplayground.domain.model.MAX_FILE_BYTES
import com.agentplayground.domain.model.validateFile
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal class DocumentAccess(private val resolver: ContentResolver) {
    suspend fun inspect(source: String): PickedFile =
        withContext(Dispatchers.IO) {
            val uri = source.toUri()

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

                    PickedFile(source, name, size)
                } ?: error("Document details are unavailable.")
        }

    suspend fun read(file: PickedFile): ByteArray =
        withContext(Dispatchers.IO) {
            resolver.openInputStream(file.uri.toUri())?.use { stream ->
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

    suspend fun save(api: PlaygroundApi, download: Download, target: String) =
        withContext(Dispatchers.IO) {
            resolver.openOutputStream(target.toUri(), "wt")?.use {
                api.download(download.url, it)
            } ?: error("Could not save ${download.name}.")
        }
}

package com.agentplayground.data.files

import android.content.Context
import android.graphics.Bitmap
import androidx.core.net.toUri
import coil3.ImageLoader
import coil3.memory.MemoryCache
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.size.Scale
import coil3.toBitmap

/** Server-scoped decoding and bounded memory caching, owned by the conversation repository. */
class AttachmentImages(context: Context) : AutoCloseable {
    private val application = context.applicationContext
    private val loader =
        ImageLoader.Builder(application)
            .memoryCache { MemoryCache.Builder().maxSizeBytes(16L * 1024 * 1024).build() }
            .diskCache(null)
            .diskCachePolicy(CachePolicy.DISABLED)
            .build()

    suspend fun load(
        source: String,
        maxDimension: Int,
        remoteBytes: suspend (String) -> ByteArray,
    ): Bitmap? {
        val cacheKey = "$source:$maxDimension"
        val cached = loader.memoryCache?.get(MemoryCache.Key(cacheKey))

        if (cached != null) {
            return cached.image.toBitmap()
        }

        val uri = source.toUri()
        val data =
            if (uri.scheme == "http" || uri.scheme == "https") {
                // Remote requests use the API owner's same-server validation and cancellation.
                // Private previews are decoded in memory and never written to a disk cache.
                remoteBytes(source)
            } else {
                uri
            }
        val result =
            loader.execute(
                ImageRequest.Builder(application)
                    .data(data)
                    .memoryCacheKey(cacheKey)
                    .size(maxDimension, maxDimension)
                    .scale(Scale.FIT)
                    .allowHardware(false)
                    .build()
            )

        return (result as? SuccessResult)?.image?.toBitmap()
    }

    override fun close() {
        loader.shutdown()
    }
}

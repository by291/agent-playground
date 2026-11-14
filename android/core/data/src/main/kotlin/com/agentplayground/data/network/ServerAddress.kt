package com.agentplayground.data.network

import java.net.ProtocolException
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.Response

/** Carries the configured server origin across a download's redirect hops. */
internal class DownloadOrigin(private val server: HttpUrl) {
    /** Compares the scheme, host and effective port. */
    fun matches(address: HttpUrl): Boolean =
        server.scheme == address.scheme &&
            server.host == address.host &&
            server.port == address.port
}

internal fun normalizeServerUrl(value: String): String {
    val url = value.trim().toHttpUrl()

    require(
        url.username.isEmpty() &&
            url.password.isEmpty() &&
            url.query == null &&
            url.fragment == null
    ) {
        "Use a server URL without credentials, query or fragment."
    }

    return url.newBuilder().encodedPath(url.encodedPath.trimEnd('/') + "/").build().toString()
}

/** Checks a download redirect before OkHttp opens the next connection. */
internal fun guardDownloadRedirect(chain: Interceptor.Chain): Response {
    val request = chain.request()
    val response = chain.proceed(request)
    val origin = request.tag(DownloadOrigin::class.java)

    if (origin == null || !response.isRedirect) {
        return response
    }

    val destination = response.header("Location")?.let(request.url::resolve)

    if (destination != null && !origin.matches(destination)) {
        response.close()
        throw ProtocolException("Download redirect must belong to the configured server.")
    }

    return response
}

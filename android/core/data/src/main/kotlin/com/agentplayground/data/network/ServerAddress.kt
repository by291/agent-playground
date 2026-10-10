package com.agentplayground.data.network

import okhttp3.HttpUrl.Companion.toHttpUrl

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

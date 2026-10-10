package com.agentplayground.data.network

import com.agentplayground.domain.model.ApiException
import com.agentplayground.domain.model.protocolJson
import com.agentplayground.domain.model.string
import java.io.IOException
import kotlinx.serialization.json.jsonObject
import retrofit2.Response

internal fun Response<*>.checkResponse() {
    if (isSuccessful) {
        return
    }

    val detail =
        errorBody()?.use { body ->
            runCatching {
                    protocolJson.parseToJsonElement(body.string()).jsonObject.string("error")
                }
                .getOrNull()
        }
    throw ApiException(code(), detail ?: "Server request failed (${code()}).")
}

internal fun <T> Response<T>.requireBody(): T {
    checkResponse()

    return body() ?: throw IOException("The server returned an empty response.")
}

package com.agentplayground.data.network

import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.ResponseBody
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

/** Transfers a streaming response body to the caller, or closes it if delivery is cancelled. */
internal suspend fun Call<ResponseBody>.awaitStreamingBody(): ResponseBody {
    val response =
        suspendCancellableCoroutine<Response<ResponseBody>> { continuation ->
            continuation.invokeOnCancellation { cancel() }

            enqueue(
                object : Callback<ResponseBody> {
                    override fun onResponse(
                        call: Call<ResponseBody>,
                        response: Response<ResponseBody>,
                    ) {
                        // Cancellation can discard the queued resume before the caller takes
                        // ownership.
                        continuation.resume(response) { _, undelivered, _ ->
                            undelivered.body()?.close()
                            undelivered.errorBody()?.close()
                        }
                    }

                    override fun onFailure(call: Call<ResponseBody>, failure: Throwable) {
                        continuation.resumeWithException(failure)
                    }
                }
            )
        }

    return response.requireBody()
}

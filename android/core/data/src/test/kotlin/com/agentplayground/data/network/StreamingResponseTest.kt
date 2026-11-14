package com.agentplayground.data.network

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType
import okhttp3.Request
import okhttp3.ResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.Timeout
import okio.buffer
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

@OptIn(ExperimentalCoroutinesApi::class)
class StreamingResponseTest {
    @Test
    fun `cancellation during delivery closes an unreceived streaming body`() = runTest {
        val body = TrackedBody()
        val call = ControlledCall()
        val receiver = launch { call.awaitStreamingBody().close() }
        runCurrent()

        call.deliver(Response.success(body))
        receiver.cancel()
        runCurrent()

        assertTrue(call.isCanceled)
        assertTrue(body.isClosed)
    }

    @Test
    fun `cancellation during delivery closes an unreceived error body`() = runTest {
        val body = TrackedBody()
        val call = ControlledCall()
        val receiver = launch { call.awaitStreamingBody().close() }
        runCurrent()

        call.deliver(Response.error(404, body))
        receiver.cancel()
        runCurrent()

        assertTrue(call.isCanceled)
        assertTrue(body.isClosed)
    }

    private class TrackedBody : ResponseBody() {
        var isClosed = false
            private set

        private val content =
            object : ForwardingSource(Buffer()) {
                    override fun close() {
                        isClosed = true
                        super.close()
                    }
                }
                .buffer()

        override fun contentType(): MediaType? = null

        override fun contentLength(): Long = 0

        override fun source(): BufferedSource = content
    }

    private class ControlledCall : Call<ResponseBody> {
        private var callback: Callback<ResponseBody>? = null
        private var isCancelled = false

        fun deliver(response: Response<ResponseBody>) {
            checkNotNull(callback).onResponse(this, response)
        }

        override fun enqueue(callback: Callback<ResponseBody>) {
            this.callback = callback
        }

        override fun execute(): Response<ResponseBody> = error("Expected asynchronous execution.")

        override fun isExecuted(): Boolean = callback != null

        override fun cancel() {
            isCancelled = true
        }

        override fun isCanceled(): Boolean = isCancelled

        override fun clone(): Call<ResponseBody> = ControlledCall()

        override fun request(): Request = Request.Builder().url("https://example.test/").build()

        override fun timeout(): Timeout = Timeout.NONE
    }
}

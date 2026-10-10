package com.agentplayground.data.network

import com.agentplayground.domain.conversation.newSubmission
import com.agentplayground.domain.model.ApiException
import com.agentplayground.domain.model.protocolJson
import com.agui.core.types.*
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test

class TransportTest {
    @Test
    fun `model changes use the conversation endpoint and preserve conflicts`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"threadId":"thread","modelId":"qwen"}"""))
            server.enqueue(
                MockResponse()
                    .setResponseCode(409)
                    .setBody("""{"error":"Complete the current run before changing models."}""")
            )
            PlaygroundApi(server.url("/workspace/").toString()).use { api ->
                val selected = api.selectModel("thread", "qwen")
                val request = server.takeRequest(2, TimeUnit.SECONDS)!!

                assertEquals("qwen", selected.modelId)
                assertEquals("PATCH", request.method)
                assertEquals("/workspace/conversations/thread/model", request.path)
                assertEquals("""{"modelId":"qwen"}""", request.body.readUtf8())

                try {
                    api.selectModel("thread", "deepseek")
                    fail("Expected model conflict")
                } catch (error: ApiException) {
                    assertEquals(409, error.status)
                    assertEquals("Complete the current run before changing models.", error.message)
                }
            }
        }
    }

    @Test
    fun `file previews preserve server prefixes and choose thumbnail or full resources`() =
        runBlocking {
            MockWebServer().use { server ->
                server.enqueue(MockResponse().setBody("thumbnail"))
                server.enqueue(MockResponse().setBody("preview"))

                PlaygroundApi(server.url("/workspace/").toString()).use { api ->
                    val thumbnail = java.io.ByteArrayOutputStream()
                    val preview = java.io.ByteArrayOutputStream()

                    api.download(api.filePreviewPath("thread", "file", thumbnail = true), thumbnail)
                    api.download(api.filePreviewPath("thread", "file", thumbnail = false), preview)

                    assertEquals(
                        "/workspace/conversations/thread/files/file/preview?size=thumbnail",
                        server.takeRequest().path,
                    )
                    assertEquals(
                        "/workspace/conversations/thread/files/file/preview",
                        server.takeRequest().path,
                    )
                    assertEquals("thumbnail", thumbnail.toString("UTF-8"))
                    assertEquals("preview", preview.toString("UTF-8"))
                }
            }
        }

    @Test
    fun `canceling a download after headers closes the active body promptly`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setBody("x".repeat(100_000))
                    .throttleBody(1024, 100, TimeUnit.MILLISECONDS)
            )
            val received = CompletableDeferred<Unit>()
            val target =
                object : java.io.OutputStream() {
                    override fun write(value: Int) {
                        received.complete(Unit)
                    }

                    override fun write(bytes: ByteArray, offset: Int, count: Int) {
                        received.complete(Unit)
                    }
                }

            PlaygroundApi(server.url("/").toString()).use { api ->
                val transfer = launch { api.download(api.documentPath("document"), target) }
                withTimeout(3000) { received.await() }

                withTimeout(1000) { transfer.cancelAndJoin() }

                assertTrue(transfer.isCancelled)
            }
        }
    }

    @Test
    fun `rename accepts the title response without list metadata`() = runBlocking {
        val server = MockWebServer()
        server.start()

        PlaygroundApi(server.url("/").toString()).use { api ->
            try {
                server.enqueue(
                    MockResponse().setBody("""{"threadId":"thread","title":"Smoke test"}""")
                )

                val renamed = api.rename("thread", "  Smoke test  ")

                assertEquals("thread", renamed.threadId)
                assertEquals("Smoke test", renamed.title)

                val request = server.takeRequest(2, TimeUnit.SECONDS)!!

                assertEquals("PATCH", request.method)
                assertEquals("/conversations/thread", request.path)
                assertEquals("""{"title":"Smoke test"}""", request.body.readUtf8())
            } finally {
                server.shutdown()
            }
        }
    }

    @Test
    fun `HTTP adapter encodes Unicode filename and uploads raw bytes`() = runBlocking {
        val server = MockWebServer()
        server.start()

        PlaygroundApi(server.url("/").toString()).use { api ->
            try {
                server.enqueue(
                    MockResponse()
                        .setBody("""{"id":"file","threadId":"thread","name":"报告 1.txt","size":3}""")
                )

                assertEquals(
                    "报告 1.txt",
                    api.uploadFile("thread", "file", "报告 1.txt", byteArrayOf(1, 2, 3)).name,
                )

                val request = server.takeRequest(2, TimeUnit.SECONDS)!!

                assertEquals("/conversations/thread/files", request.path)
                assertEquals("%E6%8A%A5%E5%91%8A%201.txt", request.getHeader("X-Filename"))
                assertArrayEquals(byteArrayOf(1, 2, 3), request.body.readByteArray())
            } finally {
                server.shutdown()
            }
        }
    }

    @Test
    fun `SSE adapter delivers official protocol types and posts the original run identity`() =
        runBlocking {
            val server = MockWebServer()
            server.start()

            PlaygroundApi(server.url("/").toString()).use { api ->
                try {
                    server.enqueue(
                        MockResponse()
                            .setHeader("Content-Type", "text/event-stream")
                            .setBody(
                                "data: {\"type\":\"TEXT_MESSAGE_START\",\"messageId\":\"reply\",\"role\":\"assistant\"}\n\n" +
                                    "data: {\"type\":\"TEXT_MESSAGE_CONTENT\",\"messageId\":\"reply\",\"delta\":\"你好\"}\n\n" +
                                    "data: {\"type\":\"RUN_FINISHED\",\"threadId\":\"thread\",\"runId\":\"original\"}\n\n"
                            )
                    )

                    val events =
                        api.run(
                                newSubmission("thread", "original", UserMessage("message", "Hello"))
                            )
                            .toList()

                    assertEquals("你好", (events[1] as TextMessageContentEvent).delta)
                    assertTrue(events.last() is RunFinishedEvent)

                    val request = server.takeRequest(2, TimeUnit.SECONDS)!!
                    val input =
                        protocolJson.decodeFromString<RunAgentInput>(request.body.readUtf8())

                    assertEquals("original", input.runId)
                    assertEquals(1, input.messages.size)
                } finally {
                    server.shutdown()
                }
            }
        }

    @Test
    fun `snapshot 404 is absence while server rejection preserves its message`() = runBlocking {
        val server = MockWebServer()
        server.start()

        PlaygroundApi(server.url("/").toString()).use { api ->
            try {
                server.enqueue(MockResponse().setResponseCode(404))
                assertNull(api.snapshot("missing"))

                server.enqueue(
                    MockResponse()
                        .setResponseCode(409)
                        .setBody("""{"error":"Conversation is running"}""")
                )

                try {
                    api.deleteConversation("thread")
                    fail("Expected conflict")
                } catch (error: ApiException) {
                    assertEquals(409, error.status)
                    assertEquals("Conversation is running", error.message)
                }
            } finally {
                server.shutdown()
            }
        }
    }
}

package com.agentplayground.core.network

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class MemoryApiTest {
    @Test
    fun `memory mutations retain scope and revision behind a server prefix`() = runBlocking {
        MockWebServer().use { server ->
            val record =
                """{"id":"00000000-0000-4000-8000-000000000001","category":"project","project":"Playground","text":"Use PostgreSQL.","sourceThreadId":"thread","sourceMessageId":"message","revision":7,"createdAt":"2026-10-10T00:00:00Z","updatedAt":"2026-10-10T00:00:00Z"}"""
            server.enqueue(MockResponse().setBody("""{"items":[$record],"nextOffset":50}"""))
            server.enqueue(
                MockResponse()
                    .setBody(
                        record
                            .replace("Use PostgreSQL.", "Use pnpm.")
                            .replace("\"revision\":7", "\"revision\":8")
                    )
            )
            server.enqueue(MockResponse().setResponseCode(204))

            PlaygroundApi(server.url("/workspace/").toString()).use { api ->
                val page = api.memories()
                val saved = api.correctMemory(page.items.single(), "  Use pnpm.  ")
                api.forgetMemory(saved)

                assertEquals(50, page.nextOffset)
                assertEquals("Use pnpm.", saved.text)
                assertEquals(8L, saved.revision)
                assertEquals(
                    "/workspace/api/memories?offset=0&limit=50",
                    server.takeRequest(1, TimeUnit.SECONDS)!!.path,
                )

                val edit = server.takeRequest(1, TimeUnit.SECONDS)!!
                val body = Json.parseToJsonElement(edit.body.readUtf8()).jsonObject
                assertEquals("PATCH", edit.method)
                assertEquals(
                    "/workspace/api/memories/00000000-0000-4000-8000-000000000001",
                    edit.path,
                )
                assertEquals("project", body["category"]!!.jsonPrimitive.content)
                assertEquals("Playground", body["project"]!!.jsonPrimitive.content)
                assertEquals(7L, body["revision"]!!.jsonPrimitive.long)
                assertEquals("Use pnpm.", body["text"]!!.jsonPrimitive.content)

                val deletion = server.takeRequest(1, TimeUnit.SECONDS)!!
                val scope = Json.parseToJsonElement(deletion.body.readUtf8()).jsonObject
                assertEquals("DELETE", deletion.method)
                assertEquals(8L, scope["revision"]!!.jsonPrimitive.long)
                assertEquals("Playground", scope["project"]!!.jsonPrimitive.content)
                assertFalse(scope.containsKey("text"))
            }
        }
    }

    @Test
    fun `memory pagination rejects a nonadvancing cursor`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"items":[],"nextOffset":50}"""))

            PlaygroundApi(server.url("/").toString()).use { api ->
                try {
                    api.memories(50)
                    fail("A repeated offset must not create an endless load-more loop")
                } catch (_: IllegalArgumentException) {
                    assertEquals("/api/memories?offset=50&limit=50", server.takeRequest().path)
                }
            }
        }
    }
}

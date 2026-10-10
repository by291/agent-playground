package com.agentplayground.data.network

import com.agentplayground.domain.model.ApiException
import com.agui.core.types.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ExternalTaskApiTest {
    @Test
    fun `controls use existing prefixed HTTP endpoints and preserve server errors`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(202).setBody("{\"status\":\"accepted\"}"))
            server.enqueue(MockResponse().setResponseCode(202).setBody("{\"status\":\"accepted\"}"))
            server.enqueue(
                MockResponse().setResponseCode(409).setBody("{\"error\":\"Task is complete\"}")
            )

            PlaygroundApi(server.url("/workspace/").toString()).use { api ->
                api.submitExternalTaskInput("task/child", "  Audience: engineers  ")
                api.cancelExternalTask("task/child")

                val input = server.takeRequest()
                val cancel = server.takeRequest()

                assertEquals("POST", input.method)
                assertEquals("/workspace/external-tasks/task%2Fchild/input", input.path)
                assertEquals("{\"input\":\"Audience: engineers\"}", input.body.readUtf8())
                assertEquals("POST", cancel.method)
                assertEquals("/workspace/external-tasks/task%2Fchild/cancel", cancel.path)

                try {
                    api.cancelExternalTask("task")
                    fail("Expected the server conflict")
                } catch (error: ApiException) {
                    assertEquals(409, error.status)
                    assertEquals("Task is complete", error.message)
                }
            }
        }
    }

    @Test
    fun `additional input validates the existing server contract before network admission`() =
        runBlocking {
            MockWebServer().use { server ->
                PlaygroundApi(server.url("/").toString()).use { api ->
                    for (input in listOf("  ", "a".repeat(4001))) {
                        try {
                            api.submitExternalTaskInput("task", input)
                            fail("Expected invalid input")
                        } catch (_: IllegalArgumentException) {
                            assertEquals(0, server.requestCount)
                        }
                    }
                }
            }
        }
}

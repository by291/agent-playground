package com.agentplayground.app

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.agentplayground.app.di.ServerGraph
import com.agentplayground.feature.conversation.ConversationViewModel
import dagger.hilt.android.lifecycle.withCreationCallback
import kotlinx.coroutines.isActive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = PlaygroundApplication::class)
class HiltGraphTest {
    @Test
    fun `Hilt assisted model is retained across recreation and cleared when its server changes`() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{\"model\":\"fixture\"}"))
            server.enqueue(MockResponse().setBody("{\"conversations\":[]}"))
            val address = server.url("/").toString()
            val controller = Robolectric.buildActivity(ArchitectureTestActivity::class.java).setup()

            try {
                val graph = ViewModelProvider(controller.get())[ServerGraph::class.java]
                val model = conversation(controller.get(), graph, address)

                controller.configurationChange()

                val restoredGraph = ViewModelProvider(controller.get())[ServerGraph::class.java]
                assertSame(graph, restoredGraph)
                assertSame(model, conversation(controller.get(), restoredGraph, address))
                assertTrue(model.viewModelScope.isActive)

                restoredGraph.owner("https://other.example/")

                assertFalse(model.viewModelScope.isActive)
            } finally {
                controller.pause().stop().destroy()
            }
        }
    }

    private fun conversation(
        activity: ArchitectureTestActivity,
        graph: ServerGraph,
        address: String,
    ): ConversationViewModel =
        ViewModelProvider(
            graph.owner(address).viewModelStore,
            activity.defaultViewModelProviderFactory,
            activity.defaultViewModelCreationExtras.withCreationCallback<
                ConversationViewModel.Factory
            > {
                it.create(address)
            },
        )[ConversationViewModel::class.java]
}

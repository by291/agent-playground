package com.agentplayground.app

import androidx.activity.ComponentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.agentplayground.app.di.ServerGraph
import com.agentplayground.app.navigation.WorkspaceDestination
import com.agentplayground.core.model.Download
import com.agentplayground.ui.DownloadSaver
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LifecycleTest {
    @Test
    fun `configuration recreation retains server graph and attachment owner`() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        val graph = ViewModelProvider(controller.get())[ServerGraph::class.java]
        val child =
            ViewModelProvider(graph.owner("http://localhost:3000/"))[ResourceModel::class.java]

        controller.configurationChange()

        val restored = ViewModelProvider(controller.get())[ServerGraph::class.java]

        assertSame(graph, restored)
        assertSame(
            child,
            ViewModelProvider(restored.owner("http://localhost:3000/"))[ResourceModel::class.java],
        )
        assertFalse(child.released)

        restored.owner("https://other.example/")
        assertTrue(child.released)

        val replacement =
            ViewModelProvider(restored.owner("https://other.example/"))[ResourceModel::class.java]

        controller.pause().stop().destroy()

        assertTrue(replacement.released)
    }

    @Test
    fun `pending save target survives saved state serialization`() {
        val pending = Download("/conversations/thread/files/file", "report.pdf")
        val scope = androidx.compose.runtime.saveable.SaverScope { true }

        with(DownloadSaver) {
            val saved = with(scope) { save(pending) }!!

            assertEquals(pending, restore(saved))
        }
    }

    @Test
    fun `workspace destinations survive saved state serialization`() {
        val scope = androidx.compose.runtime.saveable.SaverScope { true }

        with(WorkspaceDestination.saver) {
            WorkspaceDestination.entries.forEach { destination ->
                val saved = with(scope) { save(destination) }!!

                assertEquals(destination, restore(saved))
            }
        }
    }

    class ResourceModel : ViewModel() {
        var released = false

        override fun onCleared() {
            released = true
        }
    }
}

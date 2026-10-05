package com.agentplayground.app

import androidx.activity.ComponentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.agentplayground.app.files.Download
import com.agentplayground.app.files.DownloadSaver
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
        controller.pause().stop().destroy()
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

    class ResourceModel : ViewModel() {
        var released = false

        override fun onCleared() {
            released = true
        }
    }
}

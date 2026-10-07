package com.agentplayground.feature.conversation

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import com.agentplayground.feature.conversation.ui.attachments.ImageTransform
import com.agentplayground.feature.conversation.ui.attachments.imagePanBounds
import com.agentplayground.feature.conversation.ui.attachments.transformImage
import org.junit.Assert.*
import org.junit.Test

class ImageViewportTest {
    @Test
    fun `pan bounds use the fitted image instead of its empty letterbox`() {
        val viewport = Size(400f, 800f)
        val image = Size(1200f, 600f)

        assertEquals(Offset(300f, 0f), imagePanBounds(viewport, image, 2.5f))
        assertEquals(Offset(800f, 100f), imagePanBounds(viewport, image, 5f))
    }

    @Test
    fun `zoom keeps its focal image point fixed and clamps out of bounds panning`() {
        val viewport = Size(400f, 800f)
        val image = Size(1200f, 600f)

        val focused =
            transformImage(ImageTransform(), 2.5f, Offset.Zero, Offset(100f, 400f), viewport, image)
        val panned =
            transformImage(focused, 1f, Offset(2000f, -2000f), Offset(200f, 400f), viewport, image)

        assertEquals(2.5f, focused.scale)
        assertEquals(Offset(150f, 0f), focused.offset)
        assertEquals(300f, panned.offset.x, 0.001f)
        assertEquals(0f, panned.offset.y, 0.001f)
    }

    @Test
    fun `scale caps at five and returning to fit resets every pan offset`() {
        val viewport = Size(400f, 800f)
        val image = Size(1200f, 600f)
        val current = ImageTransform(2f, Offset(120f, 0f))

        val maximum = transformImage(current, 20f, Offset.Zero, Offset(200f, 400f), viewport, image)
        val reset =
            transformImage(maximum, 0.1f, Offset(100f, 100f), Offset(0f, 0f), viewport, image)

        assertEquals(5f, maximum.scale)
        assertEquals(ImageTransform(), reset)
    }

    @Test
    fun `a moving pinch keeps the previous focal image point beneath the moving fingers`() {
        val viewport = Size(400f, 400f)
        val image = Size(400f, 400f)

        val transformed =
            transformImage(
                ImageTransform(2f),
                2f,
                Offset(50f, 0f),
                Offset(200f, 200f),
                viewport,
                image,
            )

        assertEquals(4f, transformed.scale)
        assertEquals(Offset(50f, 0f), transformed.offset)
    }
}

package com.agentplayground.feature.conversation

import android.view.KeyEvent as NativeKeyEvent
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.text.TextRange
import com.agentplayground.domain.model.ContextUsage
import com.agentplayground.feature.conversation.ui.composer.modelContext
import com.agentplayground.feature.conversation.ui.composer.sendsFromKeyboard
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ComposerInputTest {
    @Test
    fun `a model change hides context usage from the previous model`() {
        val usage = ContextUsage("old", 50, 1000, 800, emptyMap(), compactions = 0, revision = 1)

        assertEquals("current", modelContext("current", usage).model)
        assertNull(modelContext("current", usage).usage)
        assertSame(usage, modelContext(null, usage).usage)
        assertSame(usage, modelContext("old", usage).usage)
    }

    @Test
    fun `keyboard send preserves composition and newline shortcuts`() {
        fun enter(modifiers: Int = 0, flags: Int = 0) =
            KeyEvent(
                NativeKeyEvent(
                    0,
                    0,
                    NativeKeyEvent.ACTION_DOWN,
                    NativeKeyEvent.KEYCODE_ENTER,
                    0,
                    modifiers,
                    0,
                    0,
                    flags,
                )
            )

        assertTrue(sendsFromKeyboard("enter", enter(), null))
        assertFalse(sendsFromKeyboard("enter", enter(), TextRange(0, 2)))
        assertFalse(sendsFromKeyboard("enter", enter(NativeKeyEvent.META_SHIFT_ON), null))
        assertFalse(sendsFromKeyboard("enter", enter(NativeKeyEvent.META_ALT_ON), null))
        assertFalse(
            sendsFromKeyboard("enter", enter(flags = NativeKeyEvent.FLAG_SOFT_KEYBOARD), null)
        )

        assertFalse(sendsFromKeyboard("modifier-enter", enter(), null))
        assertTrue(sendsFromKeyboard("modifier-enter", enter(NativeKeyEvent.META_CTRL_ON), null))
        assertTrue(sendsFromKeyboard("modifier-enter", enter(NativeKeyEvent.META_META_ON), null))
    }
}

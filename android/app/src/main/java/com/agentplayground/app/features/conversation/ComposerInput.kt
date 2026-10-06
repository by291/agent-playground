package com.agentplayground.app.features.conversation

import androidx.compose.ui.input.key.*
import androidx.compose.ui.text.TextRange
import com.agentplayground.core.ContextUsage

data class ModelContext(val model: String?, val usage: ContextUsage?)

fun modelContext(currentModel: String?, reported: ContextUsage?): ModelContext {
    val model = currentModel ?: reported?.model
    return ModelContext(model, reported?.takeIf { it.model == model })
}

fun sendsFromKeyboard(shortcut: String, event: KeyEvent, composition: TextRange?): Boolean =
    event.key == Key.Enter &&
        event.type == KeyEventType.KeyDown &&
        !event.isShiftPressed &&
        !event.isAltPressed &&
        composition == null &&
        event.nativeKeyEvent.flags and android.view.KeyEvent.FLAG_SOFT_KEYBOARD == 0 &&
        (shortcut == "enter" || event.isCtrlPressed || event.isMetaPressed)

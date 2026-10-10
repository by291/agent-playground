package com.agentplayground.feature.conversation.ui.markdown

import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf

private val LocalReplySelection = staticCompositionLocalOf { false }

/** Answer fragments share the turn's selection owner; standalone Markdown owns its selection. */
@Composable
internal fun MarkdownSelection(content: @Composable () -> Unit) {
    if (LocalReplySelection.current) {
        content()
    } else {
        SelectionContainer {
            CompositionLocalProvider(LocalReplySelection provides true, content = content)
        }
    }
}

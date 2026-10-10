package com.agentplayground.feature.conversation.ui.markdown

import android.content.ClipData
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.text.selection.rememberSelectionState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.Clipboard
import androidx.compose.ui.platform.LocalClipboard

private val LocalReplySelection = staticCompositionLocalOf<MarkdownCopyRegistry?> { null }

/** Answer fragments share the turn's selection owner; standalone Markdown owns its selection. */
@Composable
internal fun MarkdownSelection(
    source: MarkdownCopySource? = null,
    content: @Composable () -> Unit,
) {
    val owner = LocalReplySelection.current

    if (owner != null) {
        MarkdownSelectionContent(owner, source, content)
    } else {
        val registry = remember { MarkdownCopyRegistry() }
        val selection = rememberSelectionState()
        val clipboard = LocalClipboard.current
        val markdownClipboard =
            remember(clipboard, selection, registry) {
                object : Clipboard by clipboard {
                    override suspend fun setClipEntry(clipEntry: ClipEntry?) {
                        // Read the public selection state before native Copy clears the handles.
                        val markdown =
                            if (clipEntry == null) null
                            else
                                registry.copy(
                                    selection.selectedTexts,
                                    selection.getSelectableTexts(),
                                )
                        val entry =
                            if (markdown == null) clipEntry
                            else ClipEntry(ClipData.newPlainText("Assistant reply", markdown))

                        clipboard.setClipEntry(entry)
                    }
                }
            }

        CompositionLocalProvider(
            LocalReplySelection provides registry,
            LocalClipboard provides markdownClipboard,
        ) {
            SelectionContainer(selection) { MarkdownSelectionContent(registry, source, content) }
        }
    }
}

@Composable
private fun MarkdownSelectionContent(
    registry: MarkdownCopyRegistry,
    source: MarkdownCopySource?,
    content: @Composable () -> Unit,
) {
    DisposableEffect(registry, source) {
        source?.let(registry::add)
        onDispose { source?.let(registry::remove) }
    }

    content()
}

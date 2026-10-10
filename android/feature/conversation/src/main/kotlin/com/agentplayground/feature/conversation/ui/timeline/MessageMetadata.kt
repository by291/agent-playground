package com.agentplayground.feature.conversation.ui.timeline

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.agentplayground.feature.conversation.R
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.delay

@Composable
internal fun AssistantMessageFooter(
    messageId: String,
    markdown: String,
    timestamp: String?,
    settled: Boolean,
) {
    val context = LocalContext.current
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    var copied by remember(markdown) { mutableStateOf(false) }

    LaunchedEffect(copied) {
        if (copied) {
            delay(1800)
            copied = false
        }
    }

    DisableSelection {
        Row(Modifier.heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            // Compact visual bounds retain Compose's automatic 48dp touch target.
            CompositionLocalProvider(
                LocalMinimumInteractiveComponentSize provides 0.dp,
                LocalRippleConfiguration provides null,
            ) {
                IconButton(
                    onClick = {
                        val clipboard =
                            context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.setPrimaryClip(ClipData.newPlainText("Assistant reply", markdown))
                        copied = true
                    },
                    enabled = settled,
                    colors =
                        IconButtonDefaults.iconButtonColors(
                            contentColor =
                                if (pressed) MaterialTheme.colorScheme.onSurface
                                else MaterialTheme.colorScheme.onSurfaceVariant
                        ),
                    modifier =
                        Modifier.size(24.dp).testTag("copy-message-$messageId").semantics {
                            liveRegion = LiveRegionMode.Polite
                        },
                    interactionSource = interactionSource,
                ) {
                    Icon(
                        painterResource(
                            if (copied) R.drawable.ic_message_copied else R.drawable.ic_message_copy
                        ),
                        if (copied) "Copied" else "Copy all",
                        Modifier.size(20.dp),
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            MessageTimestamp(timestamp)
        }
    }
}

@Composable
internal fun MessageTimestamp(timestamp: String?, modifier: Modifier = Modifier) {
    val label =
        timestamp?.let {
            runCatching {
                    DateTimeFormatter.ofPattern("MM-dd HH:mm", Locale.getDefault())
                        .format(Instant.parse(it).atZone(ZoneId.systemDefault()))
                }
                .getOrNull()
        } ?: return

    DisableSelection {
        Text(
            label,
            modifier,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

package com.agentplayground.app.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/** Keep Material's gesture/settlement behavior while moving the foreground page with the sheet. */
@Composable
fun RevealNavigationDrawer(
    drawerState: DrawerState,
    modifier: Modifier = Modifier,
    drawerContent: @Composable () -> Unit,
    content: @Composable () -> Unit,
) {
    BoxWithConstraints(
        modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).clipToBounds()
    ) {
        val drawerWidth = (maxWidth - 72.dp).coerceAtMost(360.dp)
        val widthPx = with(LocalDensity.current) { drawerWidth.toPx() }
        val offset = drawerState.currentOffset
        val reveal =
            if (offset.isNaN()) {
                if (drawerState.isOpen) widthPx else 0f
            } else {
                (widthPx + offset).coerceIn(0f, widthPx)
            }
        val progress = reveal / widthPx

        ModalNavigationDrawer(
            drawerState = drawerState,
            scrimColor = Color.Transparent,
            drawerContent = {
                ModalDrawerSheet(
                    modifier = Modifier.width(drawerWidth).fillMaxHeight(),
                    drawerShape = RectangleShape,
                    // The sheet is drawn above content by Material. A transparent surface lets
                    // the shifted page's shadow remain visible in the drawer's outer gutter.
                    drawerContainerColor = Color.Transparent,
                    drawerTonalElevation = 0.dp,
                    windowInsets = WindowInsets(0, 0, 0, 0),
                ) {
                    drawerContent()
                }
            },
        ) {
            Surface(
                modifier =
                    Modifier.fillMaxSize()
                        .offset { IntOffset(reveal.roundToInt(), 0) }
                        .padding(vertical = 12.dp * progress),
                shape = RoundedCornerShape(28.dp * progress),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 0.dp,
                shadowElevation = 12.dp * progress,
            ) {
                content()
            }
        }
    }
}

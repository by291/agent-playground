package com.agentplayground.app.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val light =
    lightColorScheme(
        primary = Color(0xFF315FD1),
        onPrimary = Color.White,
        primaryContainer = Color(0xFFEAF0FF),
        onPrimaryContainer = Color(0xFF173B8D),
        background = Color(0xFFF5F6F8),
        onBackground = Color(0xFF20232A),
        surface = Color.White,
        onSurface = Color(0xFF20232A),
        surfaceVariant = Color(0xFFF0F2F5),
        onSurfaceVariant = Color(0xFF555D6D),
        outline = Color(0xFF727A89),
        outlineVariant = Color(0xFFDCE1E9),
        secondaryContainer = Color(0xFFE8EBF1),
        onSecondaryContainer = Color(0xFF313B4C),
    )
private val dark =
    darkColorScheme(
        primary = Color(0xFFA9C1FF),
        onPrimary = Color(0xFF123571),
        primaryContainer = Color(0xFF213D70),
        onPrimaryContainer = Color(0xFFD9E4FF),
        background = Color(0xFF14161B),
        onBackground = Color(0xFFE8EBF2),
        surface = Color(0xFF1B1E25),
        onSurface = Color(0xFFE8EBF2),
        surfaceVariant = Color(0xFF252A34),
        onSurfaceVariant = Color(0xFFBBC3D1),
        outline = Color(0xFF939DAC),
        outlineVariant = Color(0xFF414957),
    )

@Composable
fun PlaygroundTheme(preference: String, content: @Composable () -> Unit) {
    val isDark = preference == "dark" || preference == "system" && isSystemInDarkTheme()
    MaterialTheme(
        colorScheme =
            if (isDark) {
                dark
            } else {
                light
            },
        content = content,
    )
}

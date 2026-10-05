package com.agentplayground.app.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val light =
    lightColorScheme(
        primary = Color(0xFF315FD1),
        onPrimary = Color.White,
        primaryContainer = Color(0xFFEBF1FF),
        onPrimaryContainer = Color(0xFF254EA8),
        secondary = Color(0xFF535D6A),
        onSecondary = Color.White,
        secondaryContainer = Color(0xFFEDF0F4),
        onSecondaryContainer = Color(0xFF20252D),
        tertiary = Color(0xFF535D6A),
        background = Color(0xFFF7F8FA),
        onBackground = Color(0xFF20252D),
        surface = Color.White,
        onSurface = Color(0xFF20252D),
        surfaceVariant = Color(0xFFF1F3F6),
        onSurfaceVariant = Color(0xFF606A78),
        surfaceTint = Color.Transparent,
        surfaceDim = Color(0xFFE9ECF1),
        surfaceBright = Color.White,
        surfaceContainerLowest = Color.White,
        surfaceContainerLow = Color(0xFFF7F8FA),
        surfaceContainer = Color(0xFFF1F3F6),
        surfaceContainerHigh = Color(0xFFEBEEF2),
        surfaceContainerHighest = Color(0xFFE4E8EE),
        outline = Color(0xFF7A8492),
        outlineVariant = Color(0xFFE1E5EB),
        error = Color(0xFFBA303B),
        onError = Color.White,
        errorContainer = Color(0xFFFFECEE),
        onErrorContainer = Color(0xFF85232C),
    )

private val dark =
    darkColorScheme(
        primary = Color(0xFFA9C1FF),
        onPrimary = Color(0xFF123571),
        primaryContainer = Color(0xFF243A61),
        onPrimaryContainer = Color(0xFFDCE6FF),
        secondary = Color(0xFFB7C0CD),
        onSecondary = Color(0xFF20252D),
        secondaryContainer = Color(0xFF2B3039),
        onSecondaryContainer = Color(0xFFE7EBF2),
        tertiary = Color(0xFFB7C0CD),
        background = Color(0xFF14171C),
        onBackground = Color(0xFFE7EBF2),
        surface = Color(0xFF1B1F26),
        onSurface = Color(0xFFE7EBF2),
        surfaceVariant = Color(0xFF282E38),
        onSurfaceVariant = Color(0xFFAEB8C7),
        surfaceTint = Color.Transparent,
        surfaceDim = Color(0xFF14171C),
        surfaceBright = Color(0xFF343A45),
        surfaceContainerLowest = Color(0xFF111419),
        surfaceContainerLow = Color(0xFF1B1F26),
        surfaceContainer = Color(0xFF222730),
        surfaceContainerHigh = Color(0xFF2A303A),
        surfaceContainerHighest = Color(0xFF343B47),
        outline = Color(0xFF8692A3),
        outlineVariant = Color(0xFF39414E),
        error = Color(0xFFFFB3BA),
        onError = Color(0xFF681921),
        errorContainer = Color(0xFF43242B),
        onErrorContainer = Color(0xFFFFDADD),
    )

private val typography =
    Typography(
        headlineLarge =
            TextStyle(
                fontSize = 32.sp,
                lineHeight = 39.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.8).sp,
            ),
        headlineMedium =
            TextStyle(
                fontSize = 28.sp,
                lineHeight = 35.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.6).sp,
            ),
        headlineSmall =
            TextStyle(
                fontSize = 24.sp,
                lineHeight = 31.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.4).sp,
            ),
        titleLarge =
            TextStyle(
                fontSize = 20.sp,
                lineHeight = 26.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.2).sp,
            ),
        titleMedium =
            TextStyle(fontSize = 16.sp, lineHeight = 23.sp, fontWeight = FontWeight.SemiBold),
        titleSmall =
            TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge =
            TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 16.sp, lineHeight = 25.sp),
        bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 22.sp),
        bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 18.sp),
        labelLarge =
            TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
        labelMedium =
            TextStyle(fontSize = 12.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
        labelSmall =
            TextStyle(fontSize = 11.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
    )

@Composable
fun PlaygroundTheme(preference: String, content: @Composable () -> Unit) {
    val isDark = preference == "dark" || preference == "system" && isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = if (isDark) dark else light,
        typography = typography,
        shapes =
            Shapes(
                extraSmall = RoundedCornerShape(6.dp),
                small = RoundedCornerShape(10.dp),
                medium = RoundedCornerShape(16.dp),
                large = RoundedCornerShape(20.dp),
                extraLarge = RoundedCornerShape(24.dp),
            ),
        content = content,
    )
}

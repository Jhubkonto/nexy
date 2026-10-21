package io.nexy.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp

data class NexyExtendedColors(val success: Color, val onSuccess: Color, val isDark: Boolean = false)

val LocalNexyColors = staticCompositionLocalOf {
    NexyExtendedColors(success = Green500, onSuccess = Color.White, isDark = false)
}

val LocalNexyEightBit = staticCompositionLocalOf { false }

val NexySurfaceShape: Shape
    @Composable
    @ReadOnlyComposable
    get() = if (LocalNexyEightBit.current) RectangleShape else MaterialTheme.shapes.medium

/** The compact radius used by interactive chat surfaces. */
val NexyChatSurfaceShape: Shape
    @Composable
    @ReadOnlyComposable
    get() = MaterialTheme.shapes.small

val NexyNotificationDotShape: Shape
    @Composable
    @ReadOnlyComposable
    get() = if (LocalNexyEightBit.current) RectangleShape else CircleShape

private val EightBitDarkColorScheme = darkColorScheme(
    primary = GeneratedNexyColors.DarkAccent,
    onPrimary = GeneratedNexyColors.DarkOnAccent,
    primaryContainer = GeneratedNexyColors.ProjectPurpleDark,
    onPrimaryContainer = GeneratedNexyColors.ProjectPurpleLight,
    secondary = GeneratedNexyColors.SemanticInfoMain,
    onSecondary = GeneratedNexyColors.DarkBackground,
    secondaryContainer = GeneratedNexyColors.SemanticInfoDark,
    onSecondaryContainer = GeneratedNexyColors.SemanticInfoLight,
    tertiary = GeneratedNexyColors.SemanticActivityMain,
    onTertiary = GeneratedNexyColors.DarkBackground,
    tertiaryContainer = GeneratedNexyColors.SemanticActivityDark,
    onTertiaryContainer = GeneratedNexyColors.SemanticActivityLight,
    background = GeneratedNexyColors.DarkBackground,
    onBackground = GeneratedNexyColors.DarkText,
    surface = GeneratedNexyColors.DarkSurface,
    onSurface = GeneratedNexyColors.DarkText,
    surfaceVariant = GeneratedNexyColors.DarkRaisedSurface,
    onSurfaceVariant = GeneratedNexyColors.DarkMutedText,
    surfaceContainer = GeneratedNexyColors.DarkSurface,
    surfaceContainerHigh = GeneratedNexyColors.DarkRaisedSurface,
    surfaceContainerHighest = GeneratedNexyColors.DarkRaisedSurface,
    outline = GeneratedNexyColors.DarkBorder,
    outlineVariant = GeneratedNexyColors.DarkSoftBorder,
    error = GeneratedNexyColors.SemanticErrorLight,
    onError = GeneratedNexyColors.SemanticErrorDark,
    errorContainer = GeneratedNexyColors.SemanticErrorDark,
    onErrorContainer = GeneratedNexyColors.SemanticErrorLight,
    inverseSurface = GeneratedNexyColors.LightRaisedSurface,
    inverseOnSurface = GeneratedNexyColors.LightText,
    inversePrimary = GeneratedNexyColors.LightAccent,
    scrim = Color.Black,
)

private val EightBitLightColorScheme = lightColorScheme(
    primary = GeneratedNexyColors.LightAccent,
    onPrimary = GeneratedNexyColors.LightOnAccent,
    primaryContainer = GeneratedNexyColors.ProjectPurpleLight,
    onPrimaryContainer = GeneratedNexyColors.ProjectPurpleDark,
    secondary = GeneratedNexyColors.SemanticInfoDark,
    onSecondary = Color.White,
    secondaryContainer = GeneratedNexyColors.SemanticInfoLight,
    onSecondaryContainer = GeneratedNexyColors.SemanticInfoDark,
    tertiary = GeneratedNexyColors.SemanticActivityDark,
    onTertiary = Color.White,
    tertiaryContainer = GeneratedNexyColors.SemanticActivityLight,
    onTertiaryContainer = GeneratedNexyColors.SemanticActivityDark,
    background = GeneratedNexyColors.LightBackground,
    onBackground = GeneratedNexyColors.LightText,
    surface = GeneratedNexyColors.LightRaisedSurface,
    onSurface = GeneratedNexyColors.LightText,
    surfaceVariant = GeneratedNexyColors.LightRecessedSurface,
    onSurfaceVariant = GeneratedNexyColors.LightMutedText,
    surfaceContainer = GeneratedNexyColors.LightSurface,
    surfaceContainerHigh = GeneratedNexyColors.LightRecessedSurface,
    surfaceContainerHighest = GeneratedNexyColors.LightRecessedSurface,
    outline = GeneratedNexyColors.LightBorder,
    outlineVariant = GeneratedNexyColors.LightSoftBorder,
    error = GeneratedNexyColors.SemanticErrorDark,
    onError = Color.White,
    errorContainer = GeneratedNexyColors.SemanticErrorLight,
    onErrorContainer = GeneratedNexyColors.SemanticErrorDark,
    inverseSurface = GeneratedNexyColors.DarkRaisedSurface,
    inverseOnSurface = GeneratedNexyColors.DarkText,
    inversePrimary = GeneratedNexyColors.DarkAccent,
    scrim = Color.Black,
)

private val EightBitShapes = Shapes(
    extraSmall = RoundedCornerShape(2.dp),
    small = RoundedCornerShape(4.dp),
    medium = RoundedCornerShape(4.dp),
    large = RoundedCornerShape(8.dp),
    extraLarge = RoundedCornerShape(8.dp),
)

private val ClassicDarkColorScheme = darkColorScheme(
    primary = Color(0xFF3B82F6), onPrimary = Color.White,
    primaryContainer = Color(0xFF1D4ED8), onPrimaryContainer = Color(0xFFBFDBFE),
    secondary = Color(0xFF9CA3AF), onSecondary = Color(0xFF111827),
    secondaryContainer = Color(0xFF374151), onSecondaryContainer = Color(0xFFE5E7EB),
    tertiary = Color(0xFF9CA3AF), onTertiary = Color(0xFF111827),
    tertiaryContainer = Color(0xFF374151), onTertiaryContainer = Color(0xFFE5E7EB),
    background = Color(0xFF111827), onBackground = Color(0xFFF3F4F6),
    surface = Color(0xFF1F2937), onSurface = Color(0xFFF3F4F6),
    surfaceVariant = Color(0xFF374151), onSurfaceVariant = Color(0xFF9CA3AF),
    surfaceContainer = Color(0xFF1F2937), surfaceContainerHigh = Color(0xFF374151),
    surfaceContainerHighest = Color(0xFF4B5563), outline = Color(0xFF4B5563),
    outlineVariant = Color(0xFF374151), error = Color(0xFFF87171),
    onError = Color(0xFF111827), errorContainer = Color(0xFF7F1D1D),
    onErrorContainer = Color(0xFFF87171), inverseSurface = Color(0xFFF3F4F6),
    inverseOnSurface = Color(0xFF111827), inversePrimary = Color(0xFF1D4ED8),
)

private val ClassicLightColorScheme = lightColorScheme(
    primary = Color(0xFF3B82F6), onPrimary = Color.White,
    primaryContainer = Color(0xFFDBEAFE), onPrimaryContainer = Color(0xFF1E3A8A),
    secondary = Color(0xFF6B7280), onSecondary = Color.White,
    secondaryContainer = Color(0xFFF3F4F6), onSecondaryContainer = Color(0xFF1F2937),
    tertiary = Color(0xFF6B7280), onTertiary = Color.White,
    tertiaryContainer = Color(0xFFF3F4F6), onTertiaryContainer = Color(0xFF1F2937),
    background = Color(0xFFF9FAFB), onBackground = Color(0xFF111827),
    surface = Color.White, onSurface = Color(0xFF1F2937),
    surfaceVariant = Color(0xFFF3F4F6), onSurfaceVariant = Color(0xFF6B7280),
    surfaceContainer = Color(0xFFF3F4F6), surfaceContainerHigh = Color(0xFFE5E7EB),
    surfaceContainerHighest = Color(0xFFE5E7EB), outline = Color(0xFFD1D5DB),
    outlineVariant = Color(0xFFE5E7EB), error = Color(0xFFDC2626),
    onError = Color.White, errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFFDC2626), inverseSurface = Color(0xFF1F2937),
    inverseOnSurface = Color(0xFFF3F4F6), inversePrimary = Color(0xFF60A5FA),
)

private val ClassicShapes = Shapes(
    // Material text fields use extraSmall by default; match the overview filter's 8 dp radius.
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

@Composable
fun NexyTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    eightBit: Boolean = false,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        eightBit && darkTheme -> EightBitDarkColorScheme
        eightBit -> EightBitLightColorScheme
        darkTheme -> ClassicDarkColorScheme
        else -> ClassicLightColorScheme
    }
    val extendedColors = if (eightBit && darkTheme) {
        NexyExtendedColors(
            success = GeneratedNexyColors.SemanticSuccessMain,
            onSuccess = GeneratedNexyColors.DarkBackground,
            isDark = true,
        )
    } else if (eightBit) {
        NexyExtendedColors(
            success = GeneratedNexyColors.SemanticSuccessDark,
            onSuccess = Color.White,
            isDark = false,
        )
    } else if (darkTheme) {
        NexyExtendedColors(success = Color(0xFF22C55E), onSuccess = Color.White, isDark = true)
    } else {
        NexyExtendedColors(success = Color(0xFF15803D), onSuccess = Color.White, isDark = false)
    }

    CompositionLocalProvider(
        LocalNexyColors provides extendedColors,
        LocalNexyEightBit provides eightBit,
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = Typography,
            shapes = if (eightBit) EightBitShapes else ClassicShapes,
            content = content,
        )
    }
}

package com.bucks.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.bucks.app.R

val Purple = Color(0xFF5B21B6)
val PurpleDeep = Color(0xFF3B0F8A)
val PurpleTint = Color(0xFFF1ECFB)
val Ink = Color(0xFF15111C)
val Good = Color(0xFF117A47)
val GoodTint = Color(0xFFE6F4EC)
val Bad = Color(0xFFB42323)
val BadTint = Color(0xFFFBEAEA)
val Warn = Color(0xFF9A6A12)
val WarnTint = Color(0xFFFBF3E2)

/** Manrope variable font; weight is selected through the wght axis. */
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun manrope(weight: FontWeight) = Font(R.font.manrope, weight, variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)))
val Manrope = FontFamily(manrope(FontWeight.Normal), manrope(FontWeight.Medium), manrope(FontWeight.SemiBold), manrope(FontWeight.Bold), manrope(FontWeight.ExtraBold))

private val Light = lightColorScheme(
    primary = Purple, onPrimary = Color.White, primaryContainer = PurpleTint, onPrimaryContainer = PurpleDeep,
    secondary = Ink, onSecondary = Color.White, secondaryContainer = Color(0xFFEDEAF3), onSecondaryContainer = Ink,
    background = Color(0xFFFAF9FC), onBackground = Ink, surface = Color.White, onSurface = Ink,
    surfaceVariant = Color(0xFFF3F1F7), onSurfaceVariant = Color(0xFF5F586C), outline = Color(0xFFE4E0EB), outlineVariant = Color(0xFFEDEAF1),
    surfaceContainer = Color(0xFFF6F4F9), surfaceContainerHigh = Color(0xFFF0EDF4), surfaceContainerLow = Color(0xFFFBFAFD),
    error = Bad, onError = Color.White, errorContainer = BadTint, onErrorContainer = Bad,
)
private val Dark = darkColorScheme(
    primary = Color(0xFFB39DFF), onPrimary = Color(0xFF2A0F6A), primaryContainer = Color(0xFF2E1F55), onPrimaryContainer = Color(0xFFE2D8FF),
    secondary = Color(0xFFEFEBF6), onSecondary = Ink, secondaryContainer = Color(0xFF2A2533), onSecondaryContainer = Color(0xFFEFEBF6),
    background = Color(0xFF0F0C14), onBackground = Color(0xFFEFEBF6), surface = Color(0xFF15111C), onSurface = Color(0xFFEFEBF6),
    surfaceVariant = Color(0xFF1E1926), onSurfaceVariant = Color(0xFFB2ABBF), outline = Color(0xFF2E2838), outlineVariant = Color(0xFF241F2D),
    surfaceContainer = Color(0xFF1B1723), surfaceContainerHigh = Color(0xFF221D2C), surfaceContainerLow = Color(0xFF17131F),
    error = Color(0xFFF09393), onError = Ink, errorContainer = Color(0xFF3A1717), onErrorContainer = Color(0xFFF09393),
)

val BucksType = Typography(
    displaySmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.ExtraBold, fontSize = 34.sp, lineHeight = 38.sp, letterSpacing = (-1).sp),
    headlineMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 26.sp, lineHeight = 31.sp, letterSpacing = (-0.6).sp),
    headlineSmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 27.sp, letterSpacing = (-0.4).sp),
    titleLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 18.sp, lineHeight = 23.sp, letterSpacing = (-0.2).sp),
    titleMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp),
    titleSmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 18.sp),
    bodyLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.Bold, fontSize = 15.sp),
    labelMedium = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 12.sp),
    labelSmall = TextStyle(fontFamily = Manrope, fontWeight = FontWeight.SemiBold, fontSize = 11.sp),
)

@Composable
fun BucksTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) Dark else Light, typography = BucksType, content = content)
}

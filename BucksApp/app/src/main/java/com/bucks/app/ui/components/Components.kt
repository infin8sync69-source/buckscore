package com.bucks.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.bucks.app.data.Provider
import com.bucks.app.data.ProviderType
import com.bucks.app.data.Trust
import com.bucks.app.data.VehicleKind
import com.bucks.app.ui.theme.*

fun initials(n: String) = n.split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }

/* ---------- icons for domain objects (no emojis anywhere) ---------- */
val VehicleKind.icon: ImageVector get() = when (this) { VehicleKind.BIKE -> Icons.Outlined.TwoWheeler; VehicleKind.AUTO -> Icons.Outlined.ElectricRickshaw; VehicleKind.CAB -> Icons.Outlined.LocalTaxi }
val Provider.icon: ImageVector get() = if (type == ProviderType.BUSINESS) Icons.Outlined.Storefront else Icons.Outlined.Handyman
fun categoryIcon(c: String): ImageVector = when (c.lowercase()) {
    "restaurant", "bakery" -> Icons.Outlined.Restaurant; "grocery" -> Icons.Outlined.ShoppingBasket; "vegetables" -> Icons.Outlined.Eco
    "plumber" -> Icons.Outlined.Plumbing; "electrician" -> Icons.Outlined.ElectricalServices; "doctor", "nurse", "pharmacy" -> Icons.Outlined.MedicalServices
    "gym trainer", "yoga instructor" -> Icons.Outlined.FitnessCenter; "photographer", "videographer" -> Icons.Outlined.PhotoCamera; "software developer", "data analyst" -> Icons.Outlined.Code
    "it firm", "design agency", "ux designer" -> Icons.Outlined.DesignServices; "taxi" -> Icons.Outlined.LocalTaxi; "electronics", "mobile repair" -> Icons.Outlined.Devices
    "furniture", "hardware" -> Icons.Outlined.Chair; "clothing", "tailor" -> Icons.Outlined.Checkroom; "salon", "beautician" -> Icons.Outlined.ContentCut
    else -> Icons.Outlined.Handyman
}

/* ---------- layout helpers for phones, tablets and foldables ---------- */
enum class Width { COMPACT, MEDIUM, EXPANDED }
@Composable fun windowWidth(): Width { val w = LocalConfiguration.current.screenWidthDp; return when { w < 600 -> Width.COMPACT; w < 840 -> Width.MEDIUM; else -> Width.EXPANDED } }
/** Keeps reading width comfortable on wide screens. */
@Composable fun ContentColumn(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) = Box(modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) { Column(Modifier.widthIn(max = 720.dp).fillMaxWidth(), content = content) }

/* ---------- top bar ---------- */
@Composable
fun BucksTopBar(title: String? = null, onMenu: (() -> Unit)? = null, onBack: (() -> Unit)? = null, unread: Int = 0, onChat: (() -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        when {
            onBack != null -> IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") }
            onMenu != null -> IconButton(onClick = onMenu) { Icon(Icons.Outlined.Menu, "Menu") }
            else -> Spacer(Modifier.width(48.dp))
        }
        if (title == null) Text("bucks", style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-1).sp), color = MaterialTheme.colorScheme.primary, modifier = Modifier.weight(1f).padding(start = 4.dp))
        else Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).padding(start = 4.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
        actions()
        if (onChat != null) BadgedBox(badge = { if (unread > 0) Badge { Text("$unread") } }) { IconButton(onClick = onChat) { Icon(Icons.Outlined.ChatBubbleOutline, "Messages") } }
    }
}

enum class BottomTab(val label: String, val icon: ImageVector) {
    HOME("Home", Icons.Outlined.Explore), FEED("Feed", Icons.Outlined.Article), SERVICES("Services", Icons.Outlined.GridView), RECOMMENDED("For you", Icons.Outlined.ThumbUp), ACCOUNT("Account", Icons.Outlined.Person)
}
@Composable
fun BucksBottomBar(current: BottomTab, onSelect: (BottomTab) -> Unit) {
    NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
        BottomTab.entries.forEach { t -> NavigationBarItem(selected = t == current, onClick = { onSelect(t) }, icon = { Icon(t.icon, t.label) }, label = { Text(t.label, style = MaterialTheme.typography.labelSmall) },
            colors = NavigationBarItemDefaults.colors(selectedIconColor = MaterialTheme.colorScheme.primary, selectedTextColor = MaterialTheme.colorScheme.primary, indicatorColor = MaterialTheme.colorScheme.primaryContainer)) }
    }
}
@Composable
fun BucksRail(current: BottomTab, onSelect: (BottomTab) -> Unit) {
    NavigationRail(containerColor = MaterialTheme.colorScheme.surface, header = { Text("b", style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold), color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 12.dp)) }) {
        Spacer(Modifier.height(12.dp))
        BottomTab.entries.forEach { t -> NavigationRailItem(selected = t == current, onClick = { onSelect(t) }, icon = { Icon(t.icon, t.label) }, label = { Text(t.label, style = MaterialTheme.typography.labelSmall) }) }
    }
}

/* ---------- buttons ---------- */
private val BtnShape = RoundedCornerShape(14.dp)
@Composable fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) = Button(onClick, modifier.fillMaxWidth().height(52.dp), enabled = enabled, shape = BtnShape) { Text(text, style = MaterialTheme.typography.labelLarge) }
@Composable fun DarkButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) = Button(onClick, modifier.fillMaxWidth().height(52.dp), shape = BtnShape, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary, contentColor = MaterialTheme.colorScheme.onSecondary)) { Text(text, style = MaterialTheme.typography.labelLarge) }
@Composable fun GhostButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) = OutlinedButton(onClick, modifier.fillMaxWidth().height(52.dp), enabled = enabled, shape = BtnShape, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) { Text(text, style = MaterialTheme.typography.labelLarge) }
@Composable fun TintButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) = Button(onClick, modifier.fillMaxWidth().height(52.dp), shape = BtnShape, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer)) { Text(text, style = MaterialTheme.typography.labelLarge) }
@Composable fun GoodButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) = Button(onClick, modifier.fillMaxWidth().height(52.dp), shape = BtnShape, colors = ButtonDefaults.buttonColors(containerColor = Good, contentColor = Color.White)) { Text(text, style = MaterialTheme.typography.labelLarge) }
@Composable fun BadButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) = TextButton(onClick, modifier.fillMaxWidth().height(48.dp), shape = BtnShape, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text(text, style = MaterialTheme.typography.labelLarge) }
@Composable fun SmallButton(text: String, modifier: Modifier = Modifier, tonal: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) =
    if (tonal) FilledTonalButton(onClick, modifier.height(38.dp), enabled = enabled, shape = RoundedCornerShape(10.dp), contentPadding = PaddingValues(horizontal = 14.dp)) { Text(text, style = MaterialTheme.typography.labelMedium) }
    else Button(onClick, modifier.height(38.dp), enabled = enabled, shape = RoundedCornerShape(10.dp), contentPadding = PaddingValues(horizontal = 14.dp)) { Text(text, style = MaterialTheme.typography.labelMedium) }
@Composable fun IconAction(icon: ImageVector, label: String, onClick: () -> Unit) = Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable(onClick = onClick).padding(6.dp)) {
    Box(Modifier.size(46.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) { Icon(icon, label, tint = MaterialTheme.colorScheme.onSurface) }
    Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
}

/* ---------- inputs ---------- */
@Composable
fun BucksField(value: String, onChange: (String) -> Unit, label: String? = null, placeholder: String = "", modifier: Modifier = Modifier, singleLine: Boolean = true, minLines: Int = 1, readOnly: Boolean = false, keyboard: androidx.compose.foundation.text.KeyboardOptions = androidx.compose.foundation.text.KeyboardOptions.Default, trailing: @Composable (() -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(bottom = 14.dp)) {
        if (label != null) FieldLabel(label)
        OutlinedTextField(value = value, onValueChange = onChange, placeholder = { Text(placeholder, color = MaterialTheme.colorScheme.onSurfaceVariant) }, singleLine = singleLine, minLines = minLines, readOnly = readOnly, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth(), keyboardOptions = keyboard, trailingIcon = trailing,
            colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = MaterialTheme.colorScheme.outline, focusedBorderColor = MaterialTheme.colorScheme.primary, unfocusedContainerColor = MaterialTheme.colorScheme.surface, focusedContainerColor = MaterialTheme.colorScheme.surface))
    }
}
@Composable fun FieldLabel(text: String) = Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 6.dp))

/* ---------- surfaces ---------- */
@Composable
fun BucksCard(modifier: Modifier = Modifier, tint: Boolean = false, onClick: (() -> Unit)? = null, padding: Int = 16, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(18.dp)
    val bg = if (tint) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer
    var m = modifier.fillMaxWidth().clip(shape).background(bg)
    if (onClick != null) m = m.clickable(onClick = onClick)
    Column(m.padding(padding.dp), content = content)
}
/** A bottom panel floating over a map. */
@Composable
fun Sheet(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) = Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp), color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp, shadowElevation = 12.dp) {
    Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) { Box(Modifier.align(Alignment.CenterHorizontally).width(36.dp).height(4.dp).clip(CircleShape).background(MaterialTheme.colorScheme.outline)); Spacer(Modifier.height(14.dp)); content() }
}
@Composable fun Rule() = HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

@Composable
fun Avatar(text: String? = null, icon: ImageVector? = null, size: Int = 44, tinted: Boolean = true) {
    Box(Modifier.size(size.dp).clip(CircleShape).background(if (tinted) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
        if (icon != null) Icon(icon, null, tint = if (tinted) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size((size * 0.5).dp))
        else Text(text ?: "?", color = if (tinted) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface, style = if (size >= 64) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleSmall)
    }
}

@Composable
fun TrustBadge(t: Trust, compact: Boolean = false) {
    val pct = t.pct
    if (pct == null) { Text("No votes yet", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant); return }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.ThumbUp, null, tint = if (pct >= 85) Good else Warn, modifier = Modifier.size(13.dp))
        Text(" $pct%", style = MaterialTheme.typography.labelMedium, color = if (pct >= 85) Good else Warn)
        if (!compact) Text(" · ${t.total} votes", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun Pill(text: String, bg: Color, fg: Color) = Box(Modifier.clip(CircleShape).background(bg).padding(horizontal = 9.dp, vertical = 3.dp)) { Text(text, style = MaterialTheme.typography.labelSmall, color = fg) }
@Composable fun PillPurple(text: String) = Pill(text, MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
@Composable fun PillGrey(text: String) = Pill(text, MaterialTheme.colorScheme.surfaceContainerHigh, MaterialTheme.colorScheme.onSurfaceVariant)
@Composable fun PillGood(text: String) = Pill(text, GoodTint, Good)
@Composable fun PillBad(text: String) = Pill(text, BadTint, Bad)
@Composable fun PillWarn(text: String) = Pill(text, WarnTint, Warn)

@Composable
fun Chip(text: String, selected: Boolean = false, purple: Boolean = false, icon: ImageVector? = null, onClick: () -> Unit) {
    val bg = when { selected -> MaterialTheme.colorScheme.secondary; purple -> MaterialTheme.colorScheme.primaryContainer; else -> MaterialTheme.colorScheme.surfaceContainer }
    val fg = when { selected -> MaterialTheme.colorScheme.onSecondary; purple -> MaterialTheme.colorScheme.onPrimaryContainer; else -> MaterialTheme.colorScheme.onSurface }
    Row(Modifier.clip(CircleShape).background(bg).clickable(onClick = onClick).padding(horizontal = 13.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) { Icon(icon, null, tint = fg, modifier = Modifier.size(15.dp)); Spacer(Modifier.width(6.dp)) }
        Text(text, style = MaterialTheme.typography.labelMedium, color = fg)
    }
}
@Composable
fun ChipRow(items: List<String>, selected: String? = null, modifier: Modifier = Modifier, onClick: (String) -> Unit) = Row(modifier.horizontalScrollIfNeeded(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { items.forEach { Chip(it, selected = it == selected) { onClick(it) } } }
@Composable fun Modifier.horizontalScrollIfNeeded(): Modifier = this.then(Modifier.horizontalScroll(rememberScrollState()))
@Composable
fun FlowChips(items: List<String>, selected: Set<String> = emptySet(), onClick: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { items.chunked(3).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { row.forEach { Chip(it, selected = it in selected) { onClick(it) } } } } }
}

@Composable
fun Notice(text: String, modifier: Modifier = Modifier) = Row(modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.primaryContainer).padding(12.dp), verticalAlignment = Alignment.Top) {
    Icon(Icons.Outlined.Info, null, tint = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.size(16.dp).padding(top = 1.dp)); Spacer(Modifier.width(8.dp))
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
}

@Composable
fun VoteButton(text: String, active: Boolean, up: Boolean, icon: ImageVector? = if (up) Icons.Outlined.ThumbUp else Icons.Outlined.ThumbDown, onClick: () -> Unit) {
    val bg = if (!active) MaterialTheme.colorScheme.surfaceContainer else if (up) GoodTint else BadTint
    val fg = if (!active) MaterialTheme.colorScheme.onSurface else if (up) Good else Bad
    Row(Modifier.clip(CircleShape).background(bg).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) { if (icon != null) { Icon(icon, null, tint = fg, modifier = Modifier.size(15.dp)); Spacer(Modifier.width(6.dp)) }; Text(text, color = fg, style = MaterialTheme.typography.labelMedium) }
}

@Composable
fun StatusLine(text: String, detail: String? = null, done: Boolean, now: Boolean, last: Boolean = false) {
    Row(verticalAlignment = Alignment.Top) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(12.dp).clip(CircleShape).background(if (done) Good else if (now) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline))
            if (!last) Box(Modifier.width(2.dp).height(30.dp).background(if (done) Good else MaterialTheme.colorScheme.outlineVariant))
        }
        Column(Modifier.padding(start = 14.dp).offset(y = (-3).dp)) {
            Text(text, style = MaterialTheme.typography.titleSmall, color = if (done || now) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
            if (now && detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun ListRow(title: String, subtitle: String? = null, leading: @Composable () -> Unit, trailing: @Composable (() -> Unit)? = null, onClick: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        leading()
        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) { Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis); if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        trailing?.invoke()
    }
}

data class MapPin(val x: Float, val y: Float, val label: String, val color: Color, val big: Boolean = false)

/** Simulated map. Swap for Google Maps Compose once an API key exists; pins use 0–100 percent coordinates. */
@Composable
fun SimMap(modifier: Modifier = Modifier, pins: List<MapPin>, radiusAt: Offset? = null, route: Pair<Offset, Offset>? = null) {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val bg = if (dark) Color(0xFF1A1622) else Color(0xFFEFEFF3); val road = if (dark) Color(0xFF262130) else Color.White
    val water = if (dark) Color(0xFF1E2836) else Color(0xFFD6E4F3); val park = if (dark) Color(0xFF1E281F) else Color(0xFFDDEBD5)
    val primary = MaterialTheme.colorScheme.primary
    Box(modifier.background(bg)) {
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width; val h = size.height
            fun px(x: Float): Float = w * x / 100f
            fun py(y: Float): Float = h * y / 100f
            drawOval(water, topLeft = Offset(px(6f), py(13f)), size = Size(px(24f), py(14f)))
            drawOval(water, topLeft = Offset(px(75f), py(72f)), size = Size(px(20f), py(12f)))
            drawRoundRect(park, topLeft = Offset(px(62f), py(6f)), size = Size(px(22f), py(14f)), cornerRadius = CornerRadius(12f))
            drawRoundRect(park, topLeft = Offset(px(8f), py(72f)), size = Size(px(18f), py(16f)), cornerRadius = CornerRadius(12f))
            listOf(35f, 68f).forEach { y -> drawLine(road, Offset(0f, py(y)), Offset(w, py(y)), strokeWidth = 10f) }
            listOf(30f, 58f).forEach { x -> drawLine(road, Offset(px(x), 0f), Offset(px(x), h), strokeWidth = 10f) }
            drawLine(road, Offset(0f, py(10f)), Offset(w, py(30f)), strokeWidth = 10f)
            drawLine(road, Offset(px(75f), 0f), Offset(px(60f), h), strokeWidth = 10f)
            listOf(50f, 85f).forEach { y -> drawLine(road, Offset(0f, py(y)), Offset(w, py(y)), strokeWidth = 4f) }
            listOf(15f, 45f, 88f).forEach { x -> drawLine(road, Offset(px(x), 0f), Offset(px(x), h), strokeWidth = 4f) }
            radiusAt?.let { c -> drawCircle(primary.copy(alpha = 0.07f), radius = px(30f), center = Offset(px(c.x), py(c.y))); drawCircle(primary.copy(alpha = 0.6f), radius = px(30f), center = Offset(px(c.x), py(c.y)), style = Stroke(width = 3f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(14f, 10f)))) }
            route?.let { (a, b) -> val p = Path(); p.moveTo(px(a.x), py(a.y)); p.quadraticBezierTo(px((a.x + b.x) / 2 + 8), py((a.y + b.y) / 2 - 10), px(b.x), py(b.y)); drawPath(p, primary, style = Stroke(width = 7f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(18f, 12f)))) }
            pins.forEach { pin -> val c = Offset(px(pin.x), py(pin.y)); val r = if (pin.big) 20f else 13f
                drawCircle(pin.color.copy(alpha = 0.18f), radius = r + 14f, center = c); drawCircle(Color.White, radius = r + 4f, center = c); drawCircle(pin.color, radius = r, center = c) }
        }
        BoxWithConstraints(Modifier.fillMaxSize()) {
            pins.filter { it.label.isNotBlank() }.forEach { pin ->
                Surface(Modifier.offset(x = maxWidth * (pin.x / 100f) - 28.dp, y = maxHeight * (pin.y / 100f) + 12.dp), shape = RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 2.dp) { Text(pin.label, style = MaterialTheme.typography.labelSmall, maxLines = 1, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)) }
            }
        }
    }
}
private fun Color.luminance(): Float = 0.2126f * red + 0.7152f * green + 0.0722f * blue

@Composable fun SectionTitle(text: String, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) = Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f)); if (action != null && onAction != null) TextButton(onClick = onAction, contentPadding = PaddingValues(0.dp)) { Text(action, style = MaterialTheme.typography.labelMedium) } }
@Composable fun Muted(text: String, modifier: Modifier = Modifier, align: TextAlign? = null, maxLines: Int = Int.MAX_VALUE) = Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier, textAlign = align, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
@Composable fun Headline(text: String, modifier: Modifier = Modifier) = Text(text, style = MaterialTheme.typography.headlineMedium, modifier = modifier)

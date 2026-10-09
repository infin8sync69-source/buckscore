package com.bucks.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.bucks.app.data.*
import com.bucks.app.ui.BucksViewModel
import com.bucks.app.ui.Role
import com.bucks.app.ui.components.*
import com.bucks.app.ui.theme.Good
import androidx.compose.ui.platform.LocalContext
import com.bucks.app.data.DriverLocationService

val MeColor = Color(0xFF1D4ED8)

@Composable
fun AskBar(hint: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Surface(modifier.fillMaxWidth().height(50.dp).clickable(onClick = onClick), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Search, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(12.dp)); Text(hint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

data class ServiceTile(val name: String, val icon: ImageVector, val query: String)
val HOME_SERVICES = listOf(ServiceTile("Ride", Icons.Outlined.LocalTaxi, "ride"), ServiceTile("Food", Icons.Outlined.Restaurant, "biriyani"), ServiceTile("Grocery", Icons.Outlined.ShoppingBasket, "sugar"), ServiceTile("Plumber", Icons.Outlined.Plumbing, "plumber"),
    ServiceTile("Doctor", Icons.Outlined.MedicalServices, "doctor"), ServiceTile("Electric", Icons.Outlined.ElectricalServices, "electrician"), ServiceTile("Fitness", Icons.Outlined.FitnessCenter, "gym trainer"), ServiceTile("All", Icons.Outlined.GridView, "services"))

@Composable
fun HomeScreen(vm: BucksViewModel, onMenu: () -> Unit, onMessages: () -> Unit, onSearch: () -> Unit, onRide: () -> Unit, onQuery: (String) -> Unit, onServices: () -> Unit, onProCreate: () -> Unit, onEarnings: () -> Unit, onListings: () -> Unit, onChatWith: (String, String) -> Unit) {
    val s by vm.state.collectAsState(); val drivers by vm.repo.drivers.collectAsState(); val providers by vm.repo.providers.collectAsState(); val chats by vm.repo.chats.collectAsState()
    if (s.role == Role.PROVIDER) { ProviderHome(vm, onMenu, onMessages, onProCreate, onEarnings, onListings, onChatWith); return }
    val wide = windowWidth() != Width.COMPACT
    Column(Modifier.fillMaxSize()) {
        BucksTopBar(onMenu = onMenu, unread = chats.sumOf { it.unread }, onChat = onMessages)
        val pins = listOf(MapPin(s.meX, s.meY, "You", MeColor, big = true)) + providers.filter { it.scope == Scope.LOCAL }.take(6).map { MapPin(it.x, it.y, it.name, MaterialTheme.colorScheme.primary) } + drivers.filter { it.online }.map { MapPin(it.x, it.y, "", Good) }
        val panel: @Composable ColumnScope.() -> Unit = {
            AskBar("Search or ask · sugar, doctor, bike to MG Road", onClick = onSearch)
            Row(Modifier.padding(top = 18.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) { SectionTitle("Near you", Modifier.weight(1f)); Muted("${drivers.count { it.online }} riders online") }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { HOME_SERVICES.take(4).forEach { ServiceCell(it, Modifier.weight(1f)) { when (it.query) { "ride" -> onRide(); "services" -> onServices(); else -> onQuery(it.query) } } } }
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { HOME_SERVICES.drop(4).forEach { ServiceCell(it, Modifier.weight(1f)) { when (it.query) { "ride" -> onRide(); "services" -> onServices(); else -> onQuery(it.query) } } } }
        }
        if (wide) Row(Modifier.weight(1f)) { SimMap(Modifier.weight(1.2f).fillMaxHeight(), pins); Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), content = panel) }
        else { SimMap(Modifier.weight(1f).fillMaxWidth(), pins); Sheet(content = panel) }
    }
}

@Composable
fun ServiceCell(t: ServiceTile, modifier: Modifier = Modifier, onClick: () -> Unit) = Column(modifier.clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
    Box(Modifier.size(54.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) { Icon(t.icon, t.name, tint = MaterialTheme.colorScheme.onSurface) }
    Text(t.name, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
}

@Composable
fun ServicesScreen(vm: BucksViewModel, onMenu: () -> Unit, onMessages: () -> Unit, onSearch: () -> Unit, onRide: () -> Unit, onQuery: (String) -> Unit) {
    val providers by vm.repo.providers.collectAsState(); val chats by vm.repo.chats.collectAsState()
    val cats = providers.map { it.category }.distinct()
    ContentColumn { BucksTopBar("Services", onMenu = onMenu, unread = chats.sumOf { it.unread }, onChat = onMessages)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
            AskBar("Search or ask anything", onClick = onSearch)
            BucksCard(Modifier.padding(vertical = 16.dp), tint = true) { Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.LocalTaxi, null, tint = MaterialTheme.colorScheme.onPrimaryContainer); Column(Modifier.weight(1f).padding(horizontal = 14.dp)) { Text("Book a ride", style = MaterialTheme.typography.titleMedium); Muted("Bike, auto or cab. The nearest online rider who accepts first.") }; SmallButton("Book", onClick = onRide) } }
            SectionTitle("Categories", Modifier.padding(bottom = 10.dp))
            cats.chunked(2).forEach { row -> Row(Modifier.padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) { row.forEach { c -> BucksCard(Modifier.weight(1f), onClick = { onQuery(c.lowercase()) }) { Icon(categoryIcon(c), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(bottom = 10.dp)); Text(c, style = MaterialTheme.typography.titleMedium); Muted("${providers.count { it.category == c }} providers") } }; if (row.size == 1) Spacer(Modifier.weight(1f)) } }
            SectionTitle("Skills A to Z", Modifier.padding(top = 10.dp, bottom = 10.dp))
            FlowChips(Seed.SKILLS.take(18)) { onQuery(it.lowercase()) }
        }
    }
}

@Composable
fun ProviderHome(vm: BucksViewModel, onMenu: () -> Unit, onMessages: () -> Unit, onProCreate: () -> Unit, onEarnings: () -> Unit, onListings: () -> Unit, onChatWith: (String, String) -> Unit) {
    val s by vm.state.collectAsState(); val drivers by vm.repo.drivers.collectAsState(); val chats by vm.repo.chats.collectAsState()
    val veh = s.pro?.vehicle; val dr = s.driverRide
    var pin by remember { mutableStateOf("") }; var showCancel by remember { mutableStateOf(false) }; var showRate by remember { mutableStateOf(false) }
    val ctx = LocalContext.current
    LaunchedEffect(s.online) { if (s.online) DriverLocationService.start(ctx) else DriverLocationService.stop(ctx) }
    val livePos by DriverLocationService.position.collectAsState(); val liveMock by DriverLocationService.mocked.collectAsState()
    LaunchedEffect(livePos, liveMock) { livePos?.let { vm.onLocation(it, liveMock) } }
    Column(Modifier.fillMaxSize()) {
        Surface(color = MaterialTheme.colorScheme.secondary) { Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(if (s.online) Good else MaterialTheme.colorScheme.outline)); Spacer(Modifier.width(8.dp))
            Text("Provider mode · ${if (s.online) "Online" else "Offline"}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSecondary, modifier = Modifier.weight(1f))
            TextButton(onClick = { vm.switchRole(Role.CUSTOMER) }) { Text("Customer view", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primaryContainer) } } }
        BucksTopBar(onMenu = onMenu, unread = chats.sumOf { it.unread }, onChat = onMessages)
        SimMap(Modifier.weight(1f).fillMaxWidth(), listOf(MapPin(s.meX, s.meY, "You", MeColor, true)) + drivers.filter { it.online }.map { MapPin(it.x, it.y, "", Good) }, radiusAt = if (s.online) Offset(s.meX, s.meY) else null)
        Sheet {
            if (dr == null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text(if (s.online) "You're online" else "You're offline", style = MaterialTheme.typography.titleLarge); Muted(veh?.let { "${it.model} · ${it.plate}" } ?: "Attach a vehicle to receive ride requests") }
                    Switch(checked = s.online, onCheckedChange = { vm.setOnline(it) }, enabled = veh != null)
                }
                if (s.mockLocation) Notice("Mock location is on. Turn it off to go online.", Modifier.padding(top = 12.dp))
                if (veh == null) PrimaryButton("Attach vehicle", Modifier.padding(top = 14.dp), onClick = onProCreate)
                else if (s.online) TintButton("Simulate a nearby request", Modifier.padding(top = 14.dp)) { vm.simulateRing() }
                Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    BucksCard(Modifier.weight(1f), onClick = onEarnings, padding = 14) { Text("₹${s.earnings}", style = MaterialTheme.typography.titleLarge); Muted("Today") }
                    BucksCard(Modifier.weight(1f), onClick = onListings, padding = 14) { s.user?.let { TrustBadge(it.trust, compact = true) }; Muted("My trust") }
                    BucksCard(Modifier.weight(1f), onClick = onListings, padding = 14) { Icon(Icons.Outlined.ListAlt, null, tint = MaterialTheme.colorScheme.primary); Muted("Listings") }
                }
            } else when (dr.status) {
                DriverRideStatus.RINGING -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text("New ride · ₹${dr.fare}", style = MaterialTheme.typography.titleLarge); Muted("${dr.pickupKm} km to pick-up · ${dr.km} km trip") }
                        Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(progress = { dr.secondsLeft / 15f }, modifier = Modifier.fillMaxSize(), strokeWidth = 4.dp, trackColor = MaterialTheme.colorScheme.surfaceContainerHigh); Text("${dr.secondsLeft}", style = MaterialTheme.typography.titleMedium) }
                    }
                    Row(Modifier.padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) { Avatar(initials(dr.customer), size = 36); Column(Modifier.padding(start = 12.dp)) { Text(dr.customer, style = MaterialTheme.typography.titleMedium); TrustBadge(dr.customerTrust) } }
                    Muted("${dr.pickupAt}  →  ${dr.dropAt}")
                    Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) { GhostButton("Decline", Modifier.weight(1f)) { vm.driverDecline() }; GoodButton("Accept", Modifier.weight(1f)) { vm.driverAccept() } }
                }
                else -> {
                    val (title, detail, cta) = when (dr.status) {
                        DriverRideStatus.TO_PICKUP -> Triple("Heading to pick-up", "Navigate to ${dr.pickupAt}", "I've arrived")
                        DriverRideStatus.ARRIVED -> Triple("At pick-up", "Ask ${dr.customer.substringBefore(' ')} for the 4-digit PIN", "Confirm PIN")
                        DriverRideStatus.IN_RIDE -> Triple("Trip in progress", "Drop at ${dr.dropAt} · ${dr.km} km", "Complete trip")
                        else -> Triple("Collect payment", "₹${dr.fare} · cash or scan QR", "Payment received")
                    }
                    Text(title, style = MaterialTheme.typography.titleLarge); Muted(detail)
                    Row(Modifier.padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) { Avatar(initials(dr.customer), size = 36); Text(dr.customer, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 12.dp).weight(1f)); SmallButton("Message", tonal = true) { onChatWith(dr.customer, "Customer") } }
                    if (dr.status == DriverRideStatus.ARRIVED) BucksField(pin, { pin = it.filter { ch -> ch.isDigit() }.take(4) }, placeholder = "PIN (${dr.pin} in this build)")
                    if (dr.status == DriverRideStatus.DONE) BucksCard(Modifier.padding(bottom = 12.dp)) { Icon(Icons.Outlined.QrCode2, null, modifier = Modifier.size(96.dp).align(Alignment.CenterHorizontally)); Muted("Customer scans to pay ₹${dr.fare}", Modifier.align(Alignment.CenterHorizontally)) }
                    PrimaryButton(cta) { if (dr.status == DriverRideStatus.DONE) { vm.driverNext(); showRate = true } else if (vm.driverNext(pin)) pin = "" }
                    if (dr.status == DriverRideStatus.TO_PICKUP) BadButton("Cancel ride", Modifier.padding(top = 6.dp)) { showCancel = true }
                }
            }
        }
    }
    if (showCancel) AlertDialog(onDismissRequest = { showCancel = false }, title = { Text("Cancel this ride?") }, text = { Text("Cancelling after accepting affects your trust. The customer will be re-rung.") }, confirmButton = { TextButton(onClick = { showCancel = false; vm.driverCancel() }) { Text("Cancel ride") } }, dismissButton = { TextButton(onClick = { showCancel = false }) { Text("Keep") } })
    if (showRate && dr != null) AlertDialog(onDismissRequest = {}, title = { Text("How was ${dr.customer}?") }, text = { Text("Riders vote on customers too. Both sides build trust.") }, confirmButton = { TextButton(onClick = { showRate = false; vm.driverRateCustomer(true) }) { Text("Good") } }, dismissButton = { TextButton(onClick = { showRate = false; vm.driverRateCustomer(false) }) { Text("Bad") } })
}

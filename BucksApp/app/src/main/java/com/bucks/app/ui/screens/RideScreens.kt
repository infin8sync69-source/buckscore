package com.bucks.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.bucks.app.data.*
import com.bucks.app.ui.BucksViewModel
import com.bucks.app.ui.components.*
import com.bucks.app.ui.theme.Bad
import com.bucks.app.ui.theme.Good

@Composable
fun DestinationScreen(vm: BucksViewModel, onBack: () -> Unit, onChosen: () -> Unit) {
    val s by vm.state.collectAsState(); var f by remember { mutableStateOf("") }
    val list = Seed.PLACES.filter { it.contains(f, ignoreCase = true) }
    ContentColumn { BucksTopBar("Where to?", onBack = onBack)
        Column(Modifier.padding(20.dp)) {
            BucksField(s.user?.area ?: "", {}, "Pickup", readOnly = true)
            BucksField(f, { f = it }, "Drop", "Search a place")
            Muted(if (f.isBlank()) "Frequently visited" else "Matches", Modifier.padding(bottom = 6.dp))
        }
        list.forEach { p -> ListRow(p, leading = { Avatar(icon = Icons.Outlined.Place, size = 36, tinted = false) }, onClick = { vm.chooseDest(p); onChosen() }); Rule() }
        if (list.isEmpty()) Muted("No match", Modifier.padding(20.dp))
    }
}

@Composable
fun ChooseRideScreen(vm: BucksViewModel, onBack: () -> Unit) {
    val s by vm.state.collectAsState(); val drivers by vm.repo.drivers.collectAsState()
    val dest = s.rideDest ?: return
    Column(Modifier.fillMaxSize()) {
        BucksTopBar("Choose ride", onBack = onBack)
        SimMap(Modifier.weight(1f).fillMaxWidth(), listOf(MapPin(s.meX, s.meY, "You", MeColor, true), MapPin(dest.x, dest.y, dest.name, Bad)) + drivers.filter { it.online }.map { MapPin(it.x, it.y, "", Good) }, radiusAt = Offset(s.meX, s.meY), route = Offset(s.meX, s.meY) to Offset(dest.x, dest.y))
        Sheet {
            Muted("${s.user?.area} → ${dest.name} · ${dest.km} km", Modifier.padding(bottom = 10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { VehicleKind.entries.forEach { k -> val on = s.rideKind == k
                Column(Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).background(if (on) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer).clickable { vm.setRideKind(k) }.padding(14.dp)) {
                    Icon(k.icon, k.label, tint = if (on) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface); Text(k.label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)); Muted("₹${vm.fare(k, dest.km)}"); Muted("${vm.onlineCount(k)} online") } } }
            Notice("Every online rider within 5 km gets a ring. The first to accept picks you up. Their trust score is shown before they arrive.", Modifier.padding(vertical = 14.dp))
            val n = vm.onlineCount(s.rideKind)
            PrimaryButton(if (n > 0) "Ring $n rider${if (n > 1) "s" else ""} · ₹${vm.fare(s.rideKind, dest.km)}" else "No riders online for this type", enabled = n > 0) { vm.requestRide() }
        }
    }
}

@Composable
fun SearchingScreen(vm: BucksViewModel, onChangeType: () -> Unit) {
    val s by vm.state.collectAsState(); val drivers by vm.repo.drivers.collectAsState(); val r = s.ride ?: return
    val n = vm.onlineCount(r.kind)
    Column(Modifier.fillMaxSize()) {
        BucksTopBar()
        SimMap(Modifier.weight(1f).fillMaxWidth(), listOf(MapPin(s.meX, s.meY, "You", MeColor, true), MapPin(r.dest.x, r.dest.y, r.dest.name, Bad)) + drivers.filter { it.online && it.vehicle == r.kind }.map { MapPin(it.x, it.y, "", MaterialTheme.colorScheme.primary) }, radiusAt = Offset(s.meX, s.meY))
        Sheet {
            if (r.status == RideStatus.SEARCHING) {
                Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(40.dp), strokeWidth = 3.dp); Column(Modifier.padding(start = 16.dp)) { Text("Ringing $n rider${if (n > 1) "s" else ""}", style = MaterialTheme.typography.titleLarge); Muted("${r.kind.label} · within 5 km · first to accept gets the ride") } }
                BadButton("Cancel request", Modifier.padding(top = 14.dp)) { vm.cancelRide("Changed my mind") }
            } else {
                Text("No rider accepted", style = MaterialTheme.typography.titleLarge); Muted(if (n > 0) "All nearby riders were busy. Try again or switch vehicle type." else "Nobody is online nearby.")
                PrimaryButton("Ring again", Modifier.padding(top = 14.dp)) { vm.requestRide() }; GhostButton("Change ride type", Modifier.padding(top = 10.dp), onClick = onChangeType)
            }
        }
    }
}

@Composable
fun DriverFoundScreen(vm: BucksViewModel, onChatWith: (String, String) -> Unit, onCall: (String, String) -> Unit, showToast: (String) -> Unit) {
    val s by vm.state.collectAsState(); val r = s.ride ?: return; val d = r.driver ?: return
    val arrived = r.status == RideStatus.ARRIVED; var cancel by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        BucksTopBar()
        SimMap(Modifier.weight(1f).fillMaxWidth(), listOf(MapPin(s.meX, s.meY, "You", MeColor, true), MapPin(r.dest.x, r.dest.y, r.dest.name, Bad), MapPin(r.driverX, r.driverY, d.name.substringBefore(' '), Good)), route = Offset(r.driverX, r.driverY) to Offset(s.meX, s.meY))
        Sheet {
            Row(verticalAlignment = Alignment.CenterVertically) { Text(if (arrived) "Your rider is here" else "Pick-up in ${r.etaMin} min", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f)); PillPurple("PIN ${r.pin}") }
            Row(Modifier.padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) { Avatar(initials(d.name), size = 48); Column(Modifier.padding(start = 14.dp).weight(1f)) { Text(d.name, style = MaterialTheme.typography.titleMedium); Muted("${d.model} · ${d.plate}"); TrustBadge(d.trust) }; Icon(d.vehicle.icon, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) { IconAction(Icons.Outlined.ChatBubbleOutline, "Message") { onChatWith(d.name, "Rider") }; IconAction(Icons.Outlined.Call, "Call") { onCall(d.name, "+91 98450 12345") }; IconAction(Icons.Outlined.Share, "Share trip") { showToast("Live trip link copied") } }
            if (arrived) PrimaryButton("I've shared the PIN · Start", Modifier.padding(top = 14.dp)) { vm.startTrip() } else BadButton("Cancel ride", Modifier.padding(top = 10.dp)) { cancel = true }
        }
    }
    if (cancel) AlertDialog(onDismissRequest = { cancel = false }, title = { Text("Why are you cancelling?") }, text = { Column { listOf("Rider is taking too long", "Booked by mistake", "Found another ride", "Rider asked me to cancel").forEach { reason -> TextButton(onClick = { cancel = false; vm.cancelRide(reason) }, modifier = Modifier.fillMaxWidth()) { Text(reason) } } } }, confirmButton = {}, dismissButton = { TextButton(onClick = { cancel = false }) { Text("Keep ride") } })
}

@Composable
fun InRideScreen(vm: BucksViewModel, showToast: (String) -> Unit) {
    val s by vm.state.collectAsState(); val r = s.ride ?: return; val d = r.driver ?: return
    Column(Modifier.fillMaxSize()) {
        BucksTopBar()
        SimMap(Modifier.weight(1f).fillMaxWidth(), listOf(MapPin(r.dest.x, r.dest.y, r.dest.name, Bad), MapPin(r.driverX, r.driverY, "You", Good, true)), route = Offset(r.driverX, r.driverY) to Offset(r.dest.x, r.dest.y))
        Sheet {
            Text("On the way to ${r.dest.name}", style = MaterialTheme.typography.titleLarge)
            Muted("${"%.1f".format((1 - r.progress) * r.dest.km)} km left · ${d.name} · ${d.plate}")
            LinearProgressIndicator(progress = { r.progress }, modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp).height(6.dp).clip(RoundedCornerShape(3.dp)), trackColor = MaterialTheme.colorScheme.surfaceContainerHigh)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) { IconAction(Icons.Outlined.Sos, "SOS") { showToast("Emergency contacts notified with live location") }; IconAction(Icons.Outlined.Share, "Share trip") { showToast("Live trip link copied") } }
        }
    }
}

@Composable
fun PayScreen(vm: BucksViewModel) {
    val s by vm.state.collectAsState(); val r = s.ride ?: return; val d = r.driver ?: return
    ContentColumn { BucksTopBar()
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp).padding(top = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Avatar(icon = Icons.Outlined.Flag, size = 64)
            Headline("Arrived at ${r.dest.name}", Modifier.padding(top = 16.dp)); Muted("${r.dest.km} km with ${d.name}", align = TextAlign.Center)
            BucksCard(Modifier.padding(vertical = 22.dp), tint = true) { Muted("Total payable", Modifier.align(Alignment.CenterHorizontally)); Text("₹${r.fare}", style = MaterialTheme.typography.displaySmall, modifier = Modifier.align(Alignment.CenterHorizontally)) }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { DarkButton("Pay cash") { vm.payRide("Cash") }; GhostButton("Google Pay") { vm.payRide("Google Pay") }; GhostButton("Amazon Pay") { vm.payRide("Amazon Pay") }; GhostButton("Scan rider's QR") { vm.payRide("Rider QR") } }
        }
    }
}

@Composable
fun RateRideScreen(vm: BucksViewModel) {
    val s by vm.state.collectAsState(); val r = s.ride ?: return; val d = r.driver ?: return
    var vote by remember { mutableStateOf<Int?>(null) }; var comment by remember { mutableStateOf("") }
    ContentColumn { BucksTopBar()
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp).padding(top = 24.dp)) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) { Avatar(initials(d.name), size = 76); Headline("How was ${d.name.substringBefore(' ')}?", Modifier.padding(top = 12.dp)); Muted("Paid ₹${r.fare} by ${r.paidWith}. Your vote changes who gets rides next.", align = TextAlign.Center) }
            Row(Modifier.fillMaxWidth().padding(vertical = 22.dp), horizontalArrangement = Arrangement.Center) { VoteButton("Good ride", vote == 1, true) { vote = 1 }; Spacer(Modifier.width(10.dp)); VoteButton("Bad ride", vote == -1, false) { vote = -1 } }
            BucksField(comment, { comment = it }, "Comment (required)", "Safe driving, on time", singleLine = false, minLines = 2)
            PrimaryButton("Submit") { vm.finishRide(vote, comment, false) }
            TextButton(onClick = { vm.finishRide(null, "", true) }, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 6.dp)) { Text("Skip") }
        }
    }
}

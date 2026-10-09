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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.bucks.app.data.*
import com.bucks.app.ui.BucksViewModel
import com.bucks.app.ui.ProKind
import com.bucks.app.ui.Role
import com.bucks.app.ui.components.*

@Composable
private fun Steps(step: Int) = Row(Modifier.fillMaxWidth().padding(bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) { (1..3).forEach { i -> Box(Modifier.weight(1f).height(4.dp).clip(CircleShape).background(if (i <= step) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh)) } }

@Composable
private fun OptionRow(icon: ImageVector, title: String, detail: String, selected: Boolean, onClick: () -> Unit) =
    Row(Modifier.fillMaxWidth().padding(bottom = 10.dp).clip(RoundedCornerShape(16.dp)).background(if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer).clickable(onClick = onClick).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface); Column(Modifier.padding(start = 14.dp)) { Text(title, style = MaterialTheme.typography.titleMedium); Muted(detail) } }

@Composable
fun ProCreateScreen(vm: BucksViewModel, onBack: () -> Unit, onHome: () -> Unit, onListings: () -> Unit) {
    val s by vm.state.collectAsState()
    var kind by remember { mutableStateOf(VehicleKind.BIKE) }; var model by remember { mutableStateOf("") }; var plate by remember { mutableStateOf("") }
    var skillFilter by remember { mutableStateOf("") }; val skills = remember { mutableStateListOf<String>() }; var rate by remember { mutableStateOf("") }
    var bizName by remember { mutableStateOf("") }; var bizCat by remember { mutableStateOf("") }; var bizScope by remember { mutableStateOf(Scope.LOCAL) }; var item by remember { mutableStateOf("") }; var price by remember { mutableStateOf("") }; var detail by remember { mutableStateOf("") }; var tag by remember { mutableStateOf("") }; val items = remember { mutableStateListOf<Item>() }
    ContentColumn { BucksTopBar("Pro profile", onBack = onBack)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
            Steps(s.proStep)
            when {
                s.proStep == 1 -> {
                    Headline("How will you earn on Bucks?"); Muted("You can add more later.", Modifier.padding(top = 6.dp, bottom = 20.dp))
                    OptionRow(Icons.Outlined.TwoWheeler, "I have a vehicle", "Bike, auto or cab. Receive ride requests when online.", s.proKind == ProKind.VEHICLE) { vm.setProKind(ProKind.VEHICLE) }
                    OptionRow(Icons.Outlined.Handyman, "I have skills", "Plumber, doctor, developer. A to Z. Get service requests.", s.proKind == ProKind.SKILLS) { vm.setProKind(ProKind.SKILLS) }
                    OptionRow(Icons.Outlined.Storefront, "I run a business", "Grocery, restaurant, IT firm. Sell locally and globally.", s.proKind == ProKind.BUSINESS) { vm.setProKind(ProKind.BUSINESS) }
                    PrimaryButton("Continue", Modifier.padding(top = 10.dp), enabled = s.proKind != null) { vm.setProStep(2) }
                }
                s.proStep == 2 && s.proKind == ProKind.VEHICLE -> {
                    Headline("Attach your vehicle")
                    Row(Modifier.padding(vertical = 18.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) { VehicleKind.entries.forEach { k -> val on = kind == k
                        Column(Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).background(if (on) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer).clickable { kind = k }.padding(14.dp)) { Icon(k.icon, k.label, tint = if (on) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface); Text(k.label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)); Muted("${k.wheels} wheels") } } }
                    BucksField(model, { model = it }, "Model", "Honda Activa"); BucksField(plate, { plate = it }, "Number plate", "KA 05 AB 1234")
                    Notice("Documents (RC, insurance, licence) are verified by the community: three trusted members within 5 km confirm your vehicle before you can go online. In this build it's instant.")
                    PrimaryButton("Attach vehicle", Modifier.padding(top = 18.dp)) { vm.saveVehicle(kind, model.trim(), plate.trim()) }
                }
                s.proStep == 2 && s.proKind == ProKind.SKILLS -> {
                    Headline("Add your skills"); Muted("Pick everything you can do. Each becomes searchable.", Modifier.padding(top = 6.dp))
                    BucksField(skillFilter, { skillFilter = it }, placeholder = "Filter skills", modifier = Modifier.padding(top = 14.dp))
                    FlowChips(Seed.SKILLS.filter { skillFilter.isBlank() || it.contains(skillFilter, true) }, skills.toSet()) { if (it in skills) skills.remove(it) else skills.add(it) }
                    BucksField(rate, { rate = it }, "Rate", "₹300 visit + parts", Modifier.padding(top = 16.dp))
                    PrimaryButton("Publish ${skills.size} skill${if (skills.size == 1) "" else "s"}", enabled = skills.isNotEmpty()) { vm.saveSkills(skills.toList(), rate.trim()) }
                }
                s.proStep == 2 && s.proKind == ProKind.BUSINESS -> {
                    Headline("Create a business profile")
                    BucksField(bizName, { bizName = it }, "Business name", "Sri Lakshmi Stores", Modifier.padding(top = 14.dp))
                    FieldLabel("Category"); FlowChips(Seed.BIZ_CATS, setOf(bizCat)) { bizCat = it }
                    Spacer(Modifier.height(16.dp)); FieldLabel("Reach")
                    Row(Modifier.padding(bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { Chip("Local, within 5 km", purple = bizScope == Scope.LOCAL) { bizScope = Scope.LOCAL }; Chip("Global, ships anywhere", purple = bizScope == Scope.GLOBAL) { bizScope = Scope.GLOBAL } }
                    val variant = variantFor(bizCat)
                    FieldLabel(when (variant) { BusinessVariant.RESTAURANT -> "Menu items"; BusinessVariant.SUPERMARKET -> "Items and pack sizes"; BusinessVariant.FURNITURE -> "Catalogue"; BusinessVariant.ELECTRONICS -> "Products"; else -> "Items or services" })
                    items.forEachIndexed { i, it -> BucksCard(Modifier.padding(bottom = 8.dp), padding = 12) { Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(it.name, style = MaterialTheme.typography.titleSmall); Muted(listOf("₹${it.price}", it.tag, it.detail).filter { d -> d.isNotBlank() }.joinToString(" · ")) }; IconButton(onClick = { items.removeAt(i) }) { Icon(Icons.Outlined.Close, "Remove") } } } }
                    Row(Modifier.padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { OutlinedTextField(item, { item = it }, placeholder = { Text(when (variant) { BusinessVariant.RESTAURANT -> "Chicken biriyani"; BusinessVariant.SUPERMARKET -> "Sugar"; BusinessVariant.FURNITURE -> "Teak dining table"; BusinessVariant.ELECTRONICS -> "Wireless earbuds"; else -> "Item or service" }) }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(14.dp), singleLine = true); OutlinedTextField(price, { price = it.filter { ch -> ch.isDigit() } }, placeholder = { Text("₹") }, modifier = Modifier.width(96.dp), shape = RoundedCornerShape(14.dp), singleLine = true) }
                    if (variant == BusinessVariant.RESTAURANT) ChipRow(listOf("Veg", "Non-veg"), tag.ifBlank { null }, Modifier.padding(bottom = 8.dp)) { tag = it }
                    else OutlinedTextField(detail, { detail = it }, placeholder = { Text(when (variant) { BusinessVariant.SUPERMARKET -> "Pack size, e.g. 1 kg"; BusinessVariant.FURNITURE -> "Material and size"; BusinessVariant.ELECTRONICS -> "Brand and warranty"; else -> "Detail (optional)" }) }, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), shape = RoundedCornerShape(14.dp), singleLine = true)
                    SmallButton("Add item", Modifier.padding(bottom = 16.dp), tonal = true, enabled = item.isNotBlank() && price.isNotBlank()) { items.add(Item(item.trim(), price.toIntOrNull() ?: 0, tag, detail.trim(), "")); item = ""; price = ""; detail = ""; tag = "" }
                    PrimaryButton("Create business", enabled = items.isNotEmpty() || item.isNotBlank()) { val all = items.toList() + if (item.isNotBlank()) listOf(Item(item.trim(), price.toIntOrNull() ?: 0, tag, detail.trim())) else emptyList(); vm.saveBusiness(bizName.trim(), bizCat, bizScope, all) }
                }
                s.proStep == 3 -> Column(Modifier.fillMaxWidth().padding(top = 30.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Avatar(icon = Icons.Outlined.Check, size = 72); Headline("You're a provider now", Modifier.padding(top = 16.dp)); Muted(s.proMessage, Modifier.padding(top = 6.dp), TextAlign.Center)
                    Spacer(Modifier.height(24.dp))
                    if (s.proKind == ProKind.VEHICLE) PrimaryButton("Go to provider mode") { vm.switchRole(Role.PROVIDER); vm.startPro(null, 1); onHome() } else PrimaryButton("Manage my listings") { vm.startPro(null, 1); onListings() }
                    TextButton(onClick = { vm.startPro(null, 1); onHome() }, modifier = Modifier.padding(top = 6.dp)) { Text("Back to home") }
                }
            }
        }
    }
}

@Composable
fun ListingsScreen(vm: BucksViewModel, onBack: () -> Unit, onEdit: (ProKind) -> Unit) {
    val s by vm.state.collectAsState()
    ContentColumn { BucksTopBar("My listings", onBack = onBack)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf(Triple("Vehicle", s.pro?.vehicle?.let { "${it.model} · ${it.plate}" }, ProKind.VEHICLE), Triple("Skills", s.pro?.skills?.takeIf { it.isNotEmpty() }?.joinToString(", "), ProKind.SKILLS), Triple("Business", s.biz?.let { "${it.name} · ${it.category} · ${it.scope.name.lowercase()}" }, ProKind.BUSINESS)).forEach { row ->
                val t = row.first; val d = row.second; val k = row.third
                BucksCard { Row(verticalAlignment = Alignment.CenterVertically) { Icon(when (k) { ProKind.VEHICLE -> Icons.Outlined.TwoWheeler; ProKind.SKILLS -> Icons.Outlined.Handyman; ProKind.BUSINESS -> Icons.Outlined.Storefront }, null, tint = MaterialTheme.colorScheme.primary); Column(Modifier.weight(1f).padding(horizontal = 14.dp)) { Text(t, style = MaterialTheme.typography.titleMedium); Muted(d ?: "None yet") }; SmallButton(if (d == null) "Add" else "Edit", tonal = true) { onEdit(k) } } } }
            SectionTitle("Incoming", Modifier.padding(top = 10.dp))
            if (s.incoming.isEmpty()) Muted("Orders and service requests from customers appear here.")
            s.incoming.forEach { i -> BucksCard { Row(verticalAlignment = Alignment.CenterVertically) { Avatar(initials(i.who), size = 36); Column(Modifier.weight(1f).padding(horizontal = 12.dp)) { Text(i.who, style = MaterialTheme.typography.titleMedium); Muted(i.text) }; SmallButton("Accept") { vm.acceptIncoming(i) } } } }
            TintButton("Simulate an incoming request") { vm.simulateIncoming() }
            s.user?.let { u -> Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) { Muted("Your trust "); TrustBadge(u.trust); Muted(" moves only when customers vote after a completed job.") } }
        }
    }
}

@Composable
fun EarningsScreen(vm: BucksViewModel, onBack: () -> Unit) {
    val s by vm.state.collectAsState()
    ContentColumn { BucksTopBar("Earnings", onBack = onBack)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
            BucksCard(tint = true) { Muted("Today"); Text("₹${s.earnings}", style = MaterialTheme.typography.displaySmall); Muted("Bucks takes no cut in this build. The fee model is a product decision.") }
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) { BucksCard(Modifier.weight(1f)) { Text("${s.rides.size}", style = MaterialTheme.typography.titleLarge); Muted("Trips") }; BucksCard(Modifier.weight(1f)) { Text("${s.user?.up ?: 0}", style = MaterialTheme.typography.titleLarge); Muted("Upvotes") }; BucksCard(Modifier.weight(1f)) { Text("${s.user?.down ?: 0}", style = MaterialTheme.typography.titleLarge); Muted("Downvotes") } }
            SectionTitle("Vehicle documents", Modifier.padding(top = 22.dp, bottom = 10.dp))
            listOf("Registration certificate" to true, "Insurance" to true, "Driving licence" to false, "Permit (autos and cabs)" to false).forEach { doc -> BucksCard(Modifier.padding(bottom = 10.dp)) { Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Description, null, tint = MaterialTheme.colorScheme.onSurfaceVariant); Text(doc.first, Modifier.weight(1f).padding(start = 12.dp), style = MaterialTheme.typography.bodyMedium); if (doc.second) PillGood("Approved") else PillWarn("Upload") } } }
        }
    }
}

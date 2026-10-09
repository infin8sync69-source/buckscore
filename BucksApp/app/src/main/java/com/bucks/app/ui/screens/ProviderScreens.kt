package com.bucks.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.Chair
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.ShoppingBasket
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.bucks.app.data.*
import com.bucks.app.ui.BucksViewModel
import com.bucks.app.ui.components.*
import com.bucks.app.ui.theme.Bad
import com.bucks.app.ui.theme.Good

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProviderScreen(vm: BucksViewModel, id: String, initialTab: String, onBack: () -> Unit, onRequest: () -> Unit, onChatWith: (String, String) -> Unit, onCall: (String, String) -> Unit, onCart: () -> Unit, onMessages: () -> Unit) {
    val s by vm.state.collectAsState(); val providers by vm.repo.providers.collectAsState(); val chats by vm.repo.chats.collectAsState()
    val p = providers.firstOrNull { it.id == id } ?: return
    var tab by remember { mutableStateOf(initialTab) }
    var voteSheet by remember { mutableStateOf<Boolean?>(null) }; var comment by remember { mutableStateOf("") }; var howRanked by remember { mutableStateOf(false) }
    val lensTrust = vm.trustFor(p)
    val variant = variantFor(p.category)
    val tabs = if (p.type == ProviderType.BUSINESS) listOf("about" to "About", "items" to variant.productsLabel, "feed" to "Feed", "votes" to "Votes") else listOf("about" to "About", "services" to "Services", "votes" to "Votes")
    val cartCount = s.cart.values.sum()
    ContentColumn(Modifier.fillMaxHeight()) { BucksTopBar(p.name, onBack = onBack, unread = chats.sumOf { it.unread }, onChat = onMessages)
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) { Avatar(icon = p.icon, size = 72); Column(Modifier.padding(start = 16.dp)) { Text(p.name, style = MaterialTheme.typography.headlineSmall); Muted("${p.category} · ${p.distanceKm} km · ${if (p.scope == Scope.LOCAL) "Local" else "Global"}"); Spacer(Modifier.height(4.dp)); Row(verticalAlignment = Alignment.CenterVertically) { TrustBadge(lensTrust); TextButton(onClick = { howRanked = true }, contentPadding = PaddingValues(horizontal = 8.dp)) { Text("How is this ranked?", style = MaterialTheme.typography.labelSmall) } } } }
                Text(p.bio, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    DarkButton(if (p.type == ProviderType.BUSINESS) "Order" else "Request service", Modifier.weight(1f)) { if (p.type == ProviderType.BUSINESS) tab = "items" else onRequest() }
                    GhostButton("Message", Modifier.weight(1f)) { onChatWith(p.name, p.category) }
                }
                TextButton(onClick = { onCall(p.name, "+91 98450 ${(10000 + p.id.hashCode().mod(90000))}") }, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 4.dp)) { Text("Call ${p.name.substringBefore(' ')}") }
            }
            PrimaryTabRow(selectedTabIndex = tabs.indexOfFirst { it.first == tab }.coerceAtLeast(0), containerColor = MaterialTheme.colorScheme.surface, divider = { Rule() }) { tabs.forEach { (k, l) -> Tab(selected = tab == k, onClick = { tab = k }, text = { Text(l, style = MaterialTheme.typography.labelLarge) }) } }
            Column(Modifier.padding(20.dp)) {
                when (tab) {
                    "about" -> {
                        BucksCard { Stat("Trust · ${s.lens.label.lowercase()}", lensTrust.pct?.let { "$it%" } ?: "—"); Stat("Upvotes", "${lensTrust.up}", Good); Stat("Downvotes", "${lensTrust.down}", Bad); Stat("Signed votes on record", "${p.comments.size}"); Stat("Ranking", "Published formula, no hidden model") }
                        p.rate?.let { BucksCard(Modifier.padding(top = 10.dp)) { Muted("Rate"); Text(it, style = MaterialTheme.typography.titleMedium) } }
                        Notice("Only people who completed an order or service with ${p.name} can vote. Every vote needs a comment.", Modifier.padding(top = 10.dp))
                    }
                    "items" -> {
                        ProductsTab(p, variant, s.cart, onAdd = { i, d -> vm.cartAdd(p.id, i, d) })
                        if (cartCount > 0) PrimaryButton("View cart · $cartCount item${if (cartCount > 1) "s" else ""}", Modifier.padding(top = 4.dp), onClick = onCart)
                    }
                    "feed" -> { val posts by vm.repo.posts.collectAsState(); val mine = posts.filter { it.who == p.name }
                        if (mine.isEmpty()) Muted("${p.name} hasn't posted yet.") else mine.forEach { post -> BucksCard(Modifier.padding(bottom = 10.dp)) { Muted(post.ago); Text(post.text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)); Muted("${post.up} upvotes · ${post.comments.size} comments", Modifier.padding(top = 6.dp)) } } }
                    "services" -> { BucksCard { Text(p.category, style = MaterialTheme.typography.titleMedium); Muted(p.rate ?: "Rate on request"); Muted(p.bio, Modifier.padding(top = 6.dp)) }; Notice("Describe the job when you request; ${p.name.substringBefore(' ')} confirms the price before starting.", Modifier.padding(top = 10.dp)); PrimaryButton("Request service", Modifier.padding(top = 14.dp), onClick = onRequest) }
                    "votes" -> {
                        val mine = s.myVotes[p.id]
                        Row(Modifier.padding(bottom = 12.dp).horizontalScrollIfNeeded(), horizontalArrangement = Arrangement.spacedBy(6.dp)) { Lens.entries.forEach { l -> Chip(l.label, selected = s.lens == l) { vm.setLens(l) } } }
                        if (vm.canVote(p.id)) BucksCard(Modifier.padding(bottom = 12.dp), tint = true) { Text("Your vote", style = MaterialTheme.typography.titleMedium); Muted("You've completed a transaction here, so you can vote once.")
                            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { VoteButton("Upvote", mine == 1, true) { if (mine == null) voteSheet = true }; VoteButton("Downvote", mine == -1, false) { if (mine == null) voteSheet = false } } }
                        else Notice("Complete an order or service first to unlock voting.", Modifier.padding(bottom = 12.dp))
                        p.comments.filter { c -> when (s.lens) { Lens.ALL -> true; Lens.VERIFIED -> c.verified; Lens.FOLLOWING -> true } }.forEach { c -> Column(Modifier.padding(vertical = 10.dp)) { Row(verticalAlignment = Alignment.CenterVertically) { Text(c.who, style = MaterialTheme.typography.titleSmall); if (c.verified) { Spacer(Modifier.width(6.dp)); PillGrey("ID verified") }; Spacer(Modifier.weight(1f)); if (c.vote > 0) PillGood("Upvoted") else PillBad("Downvoted") }; Text(c.text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 2.dp)) }; Rule() }
                    }
                }
            }
        }
    }
    if (howRanked) ModalBottomSheet(onDismissRequest = { howRanked = false }) { Column(Modifier.padding(20.dp).padding(bottom = 24.dp)) {
        Text("How ${p.name} is ranked", style = MaterialTheme.typography.titleLarge)
        Muted("Bucks has no recommendation algorithm. Lists are sorted by this published formula, the same for everyone:", Modifier.padding(top = 8.dp))
        BucksCard(Modifier.padding(vertical = 12.dp)) { Text("1. Upvote share = upvotes ÷ (upvotes + downvotes)", style = MaterialTheme.typography.bodyMedium); Text("2. Ties broken by number of votes", style = MaterialTheme.typography.bodyMedium); Text("3. Only votes tied to a completed, signed transaction count", style = MaterialTheme.typography.bodyMedium); Text("4. Your lens (${s.lens.label}) chooses whose votes are counted: ${s.lens.explain.lowercase()}", style = MaterialTheme.typography.bodyMedium) }
        Stat("Votes counted", "${lensTrust.total}"); Stat("Upvote share", lensTrust.pct?.let { "$it%" } ?: "—"); Stat("Distance", "${p.distanceKm} km (used only when you sort by Nearest)")
        Muted("Fraud checks (rings of accounts voting for each other, one device with many accounts) put votes on hold with a public reason; they never silently demote anyone.", Modifier.padding(top = 10.dp)) } }
    voteSheet?.let { up -> ModalBottomSheet(onDismissRequest = { voteSheet = null }) { Column(Modifier.padding(20.dp).padding(bottom = 24.dp)) {
        Text(if (up) "Upvote ${p.name}" else "Downvote ${p.name}", style = MaterialTheme.typography.titleLarge); Muted("Say why, in a line. Your comment is public and tied to a real transaction.")
        BucksField(comment, { comment = it }, placeholder = if (up) "On time, fair price" else "Late, overcharged", modifier = Modifier.padding(top = 14.dp), singleLine = false, minLines = 2)
        PrimaryButton("Submit vote") { if (vm.vote(p.id, up, comment.trim())) { voteSheet = null; comment = "" } } } } }
}

/** Product list whose layout follows the business type, matching Figma's Restaurant / Supermarket / Furniture / Electronics variants. */
@Composable
private fun ProductsTab(p: Provider, variant: BusinessVariant, cart: Map<String, Int>, onAdd: (Int, Int) -> Unit) {
    var group by remember { mutableStateOf("All") }
    val groups = listOf("All") + p.items.map { it.group }.filter { it.isNotBlank() }.distinct()
    if (groups.size > 2) ChipRow(groups, group, Modifier.padding(bottom = 12.dp)) { group = it }
    val indexed = p.items.withIndex().filter { group == "All" || it.value.group == group }
    when (variant) {
        BusinessVariant.RESTAURANT -> indexed.forEach { (i, it) -> BucksCard(Modifier.padding(bottom = 10.dp), padding = 14) { Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(14.dp).border(1.5.dp, if (it.tag == "Veg") Good else Bad, RoundedCornerShape(3.dp)), contentAlignment = Alignment.Center) { Box(Modifier.size(7.dp).background(if (it.tag == "Veg") Good else Bad, CircleShape)) }
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) { Text(it.name, style = MaterialTheme.typography.titleMedium); Muted("₹${it.price} · ${it.detail}") }
            QtyControl(cart["${p.id}:$i"] ?: 0, { onAdd(i, -1) }, { onAdd(i, 1) }) } } }
        BusinessVariant.SUPERMARKET -> indexed.chunked(2).forEach { row -> Row(Modifier.padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) { row.forEach { (i, it) ->
            BucksCard(Modifier.weight(1f), padding = 14) { Box(Modifier.fillMaxWidth().height(72.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.ShoppingBasket, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                Text(it.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 10.dp), maxLines = 1); Muted(it.detail); Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) { Text("₹${it.price}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f)); QtyControl(cart["${p.id}:$i"] ?: 0, { onAdd(i, -1) }, { onAdd(i, 1) }, small = true) } } }
            if (row.size == 1) Spacer(Modifier.weight(1f)) } }
        BusinessVariant.FURNITURE, BusinessVariant.ELECTRONICS -> indexed.forEach { (i, it) -> BucksCard(Modifier.padding(bottom = 10.dp), padding = 0) {
            Box(Modifier.fillMaxWidth().height(150.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) { Icon(if (variant == BusinessVariant.FURNITURE) Icons.Outlined.Chair else Icons.Outlined.Devices, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(40.dp)) }
            Column(Modifier.padding(16.dp)) { Row(verticalAlignment = Alignment.CenterVertically) { Text(it.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f)); PillGrey(it.tag) }
                Muted(it.detail, Modifier.padding(top = 2.dp)); Muted(if (variant == BusinessVariant.FURNITURE) "Free delivery and assembly within 10 km" else "Home setup included · GST invoice", Modifier.padding(top = 2.dp))
                Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) { Text("₹${"%,d".format(it.price)}", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f)); QtyControl(cart["${p.id}:$i"] ?: 0, { onAdd(i, -1) }, { onAdd(i, 1) }, label = "Add to cart") } } } }
        BusinessVariant.GENERAL -> indexed.forEach { (i, it) -> BucksCard(Modifier.padding(bottom = 10.dp), padding = 14) { Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(it.name, style = MaterialTheme.typography.titleMedium); Muted(listOf("₹${it.price}", it.detail).filter { d -> d.isNotBlank() }.joinToString(" · ")) }; QtyControl(cart["${p.id}:$i"] ?: 0, { onAdd(i, -1) }, { onAdd(i, 1) }) } } }
    }
    if (indexed.isEmpty()) Muted("Nothing listed yet.")
}

@Composable
private fun QtyControl(q: Int, onMinus: () -> Unit, onPlus: () -> Unit, small: Boolean = false, label: String = "Add") {
    val sz = if (small) 30.dp else 36.dp
    if (q == 0) { if (small) FilledIconButton(onClick = onPlus, modifier = Modifier.size(sz)) { Icon(Icons.Outlined.Add, "Add", modifier = Modifier.size(16.dp)) } else SmallButton(label, onClick = onPlus) }
    else Row(verticalAlignment = Alignment.CenterVertically) { FilledTonalIconButton(onClick = onMinus, modifier = Modifier.size(sz)) { Icon(Icons.Outlined.Remove, "Remove", modifier = Modifier.size(16.dp)) }; Text(" $q ", style = MaterialTheme.typography.titleMedium); FilledIconButton(onClick = onPlus, modifier = Modifier.size(sz)) { Icon(Icons.Outlined.Add, "Add", modifier = Modifier.size(16.dp)) } }
}

@Composable
private fun Stat(label: String, value: String, color: androidx.compose.ui.graphics.Color? = null) = Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) { Muted(label, Modifier.weight(1f)); Text(value, style = MaterialTheme.typography.titleMedium, color = color ?: MaterialTheme.colorScheme.onSurface) }

@Composable
fun CartScreen(vm: BucksViewModel, onBack: () -> Unit, onPlaced: (String) -> Unit) {
    val s by vm.state.collectAsState()
    val cl = vm.cartLines(); val p = cl.first; val lines = cl.second; val total = cl.third
    ContentColumn { BucksTopBar("Cart", onBack = onBack)
        if (p == null) Muted("Your cart is empty.", Modifier.fillMaxWidth().padding(top = 80.dp), TextAlign.Center)
        else {
            val fee = if (p.scope == Scope.LOCAL && p.distanceKm <= 3) 0 else 30
            Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
                ListRow(p.name, "${p.distanceKm} km", leading = { Avatar(icon = p.icon, tinted = false) }, trailing = { TrustBadge(vm.trustFor(p), compact = true) })
                BucksCard(Modifier.padding(top = 10.dp)) {
                    lines.forEach { ln -> Row(Modifier.padding(vertical = 4.dp)) { Text("${ln.first} × ${ln.third}", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium); Text("₹${ln.second * ln.third}", style = MaterialTheme.typography.titleMedium) } }
                    Row(Modifier.padding(vertical = 4.dp)) { Muted("Delivery", Modifier.weight(1f)); Muted(if (fee == 0) "Free (local, under 3 km)" else "₹$fee") }
                    Rule(); Row(Modifier.padding(top = 8.dp)) { Text("Total", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f)); Text("₹$total", style = MaterialTheme.typography.titleLarge) }
                }
                BucksField(s.user?.area ?: "", {}, "Deliver to", modifier = Modifier.padding(top = 16.dp), readOnly = true)
                FieldLabel("Pay with"); ChipRow(listOf("Cash on delivery", "UPI"), "Cash on delivery", Modifier.padding(bottom = 20.dp)) {}
                PrimaryButton("Review order · ₹$total") { vm.placeOrder() }
            }
        }
    }
}

@Composable
fun OrderScreen(vm: BucksViewModel, id: String, onBack: () -> Unit, onVote: (String) -> Unit, onChatWith: (String, String) -> Unit, onHome: () -> Unit) {
    val s by vm.state.collectAsState(); val o = s.orders.firstOrNull { it.id == id } ?: return
    val i = OrderStatus.entries.indexOf(o.status)
    ContentColumn { BucksTopBar("Order", onBack = onBack)
        Column(Modifier.padding(20.dp)) {
            Text(o.providerName, style = MaterialTheme.typography.headlineSmall); Muted(o.items.joinToString(", ") + " · ₹${o.total}")
            Column(Modifier.padding(vertical = 22.dp)) { OrderStatus.entries.forEachIndexed { k, st -> StatusLine(st.label, if (k == 4) "Vote to help the next person." else "The vendor updates this live", done = k < i, now = k == i, last = k == 4) } }
            if (o.status == OrderStatus.DELIVERED) PrimaryButton("Vote and comment") { onVote(o.providerId) } else GhostButton("Message vendor") { onChatWith(o.providerName, "Vendor") }
            TextButton(onClick = onHome, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 6.dp)) { Text("Back to home") }
        }
    }
}

@Composable
fun RequestScreen(vm: BucksViewModel, providerId: String, onBack: () -> Unit, onSent: (String) -> Unit) {
    val s by vm.state.collectAsState(); val p = vm.provider(providerId) ?: return
    var text by remember { mutableStateOf("") }; var whenSel by remember { mutableStateOf("Now") }
    ContentColumn { BucksTopBar("Request service", onBack = onBack)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
            ListRow(p.name, "${p.category} · ${p.rate ?: ""}", leading = { Avatar(icon = p.icon, tinted = false) })
            BucksField(text, { text = it }, "What do you need?", "e.g. Kitchen tap leaking, need it fixed today", Modifier.padding(top = 12.dp), singleLine = false, minLines = 3)
            FieldLabel("When"); ChipRow(listOf("Now", "Today evening", "Tomorrow"), whenSel, Modifier.padding(bottom = 14.dp)) { whenSel = it }
            BucksField(s.user?.area ?: "", {}, "Where", readOnly = true)
            PrimaryButton("Send request") { onSent(vm.sendRequest(p.id, text.trim())) }
            Muted("${p.name} gets a ring. If they don't respond in 5 minutes you can send it to the next most trusted ${p.category.lowercase()}.", Modifier.padding(top = 14.dp).fillMaxWidth(), TextAlign.Center)
        }
    }
}

@Composable
fun RequestStatusScreen(vm: BucksViewModel, id: String, onBack: () -> Unit, onVote: (String) -> Unit, onChatWith: (String, String) -> Unit) {
    val s by vm.state.collectAsState(); val r = s.requests.firstOrNull { it.id == id } ?: return
    val i = RequestStatus.entries.indexOf(r.status)
    ContentColumn { BucksTopBar("Request", onBack = onBack)
        Column(Modifier.padding(20.dp)) {
            Text(r.providerName, style = MaterialTheme.typography.headlineSmall); Muted("${r.category} · \"${r.text}\"")
            Column(Modifier.padding(vertical = 22.dp)) { RequestStatus.entries.forEachIndexed { k, st -> StatusLine(st.label, null, done = k < i, now = k == i, last = k == 3) } }
            when (r.status) {
                RequestStatus.ACCEPTED -> DarkButton("Provider has arrived") { vm.setRequestStatus(r.id, RequestStatus.IN_PROGRESS) }
                RequestStatus.IN_PROGRESS -> GoodButton("Mark as completed") { vm.setRequestStatus(r.id, RequestStatus.COMPLETED) }
                RequestStatus.COMPLETED -> PrimaryButton("Vote and comment") { onVote(r.providerId) }
                else -> {}
            }
            GhostButton("Message", Modifier.padding(top = 10.dp)) { onChatWith(r.providerName, r.category) }
        }
    }
}

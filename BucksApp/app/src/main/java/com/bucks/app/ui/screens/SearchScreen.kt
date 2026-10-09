package com.bucks.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.bucks.app.data.*
import com.bucks.app.ui.AskMode
import com.bucks.app.ui.BucksViewModel
import com.bucks.app.ui.ScopeFilter
import com.bucks.app.ui.SortMode
import com.bucks.app.ui.components.*
import com.bucks.app.ui.VOICE_LANGS
import com.bucks.app.ui.rememberVoiceInput
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.GraphicEq

@Composable
fun ProviderRow(p: Provider, trust: Trust = p.trust, onClick: () -> Unit) {
    ListRow(p.name, "${p.category} · ${p.distanceKm} km" + (p.rate?.let { " · $it" } ?: "") + (if (p.items.isNotEmpty()) " · from ₹${p.minPrice}" else ""), leading = { Avatar(icon = p.icon, tinted = false) },
        trailing = { Column(horizontalAlignment = Alignment.End) { TrustBadge(trust, compact = true); Spacer(Modifier.height(4.dp)); if (p.scope == Scope.LOCAL) PillPurple("Local") else PillGrey("Global") } }, onClick = onClick)
    Rule()
}

@Composable
fun SearchScreen(vm: BucksViewModel, onBack: () -> Unit, onProvider: (String, String) -> Unit, onRequest: (String) -> Unit, onMessages: () -> Unit, showToast: (String) -> Unit = {}) {
    val s by vm.state.collectAsState(); val chats by vm.repo.chats.collectAsState()
    var input by remember { mutableStateOf(s.query) }
    val chat = s.askMode == AskMode.CHAT
    val results = if (chat) emptyList() else vm.results()
    fun submit(q: String) { vm.submitQuery(q); input = if (vm.isAgentQuery(q) || s.pending != null) "" else q }
    val (voice, listen) = rememberVoiceInput(s.voiceLang, onResult = { heard -> input = heard; submit(heard) }, onError = { msg -> showToast(msg) })
    ContentColumn(Modifier.fillMaxHeight()) { BucksTopBar("Search or ask", onBack = onBack, unread = chats.sumOf { it.unread }, onChat = onMessages)
        Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(input, { input = it }, placeholder = { Text(if (voice.listening) voice.partial.ifBlank { "Listening…" } else "sugar · doctor · bike to MG Road") }, singleLine = true, modifier = Modifier.weight(1f), shape = RoundedCornerShape(14.dp),
                trailingIcon = { IconButton(onClick = listen) { Icon(if (voice.listening) Icons.Outlined.GraphicEq else Icons.Outlined.Mic, "Speak", tint = if (voice.listening) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant) } })
            Spacer(Modifier.width(8.dp)); Button(onClick = { submit(input) }, shape = RoundedCornerShape(12.dp), modifier = Modifier.height(52.dp)) { Text("Go") }
        }
        Row(Modifier.padding(horizontal = 20.dp, vertical = 6.dp).horizontalScrollIfNeeded(), horizontalArrangement = Arrangement.spacedBy(6.dp)) { VOICE_LANGS.forEach { (tag, label) -> Chip(label, purple = s.voiceLang == tag) { vm.setVoiceLang(tag) } }; if (vm.cloudEnabled) Chip("Cloud AI on", selected = true) {} }
        if (s.thinking) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 20.dp))
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(top = 12.dp, bottom = 24.dp)) {
            if (chat) items(s.agent) { m -> AgentBubble(m, onAction = { submit(it) }, onCard = { c -> when (val a = c.action) { is AgentAction.OpenProvider -> onProvider(a.id, a.tab); is AgentAction.Request -> onRequest(a.providerId) } }) }
            else {
                if (s.query.isNotBlank()) item { Column(Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) {
                    Muted("${results.size} results · ranked by ${s.lens.label.lowercase()}")
                    Row(Modifier.padding(top = 8.dp).horizontalScrollIfNeeded(), horizontalArrangement = Arrangement.spacedBy(6.dp)) { Lens.entries.forEach { l -> Chip(l.label, selected = s.lens == l) { vm.setLens(l) } } }
                    Row(Modifier.padding(top = 10.dp).horizontalScrollIfNeeded(), horizontalArrangement = Arrangement.spacedBy(6.dp)) { SortMode.entries.forEach { m -> Chip(m.label, selected = s.sort == m) { vm.setSort(m) } }; Spacer(Modifier.width(6.dp)); ScopeFilter.entries.forEach { f -> Chip(f.label, purple = s.scope == f) { vm.setScope(f) } } }
                } }
                else item { Column(Modifier.padding(20.dp)) { SectionTitle("Try", Modifier.padding(bottom = 10.dp)); FlowChips(listOf("sugar", "biriyani", "plumber", "doctor", "Bike to Koramangala", "Compare grocery for sugar", "Show my orders")) { submit(it) } } }
                items(results) { p -> ProviderRow(p, vm.trustFor(p)) { onProvider(p.id, "about") } }
                if (s.query.isNotBlank() && results.isEmpty()) item { Column(Modifier.fillMaxWidth().padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) { Muted("No one offers \"${s.query}\" yet.", align = TextAlign.Center); TextButton(onClick = { submit("post a request for ${s.query}") }) { Text("Ask the community") } } }
            }
        }
    }
}

@Composable
fun AgentBubble(m: AgentMessage, onAction: (String) -> Unit, onCard: (AgentCard) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp), horizontalArrangement = if (m.mine) Arrangement.End else Arrangement.Start) {
        Column(Modifier.widthIn(max = 420.dp).clip(RoundedCornerShape(18.dp)).background(if (m.mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainer).padding(14.dp)) {
            Text(m.text, style = MaterialTheme.typography.bodyMedium, color = if (m.mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface)
            m.cards.forEach { c -> Surface(onClick = { onCard(c) }, modifier = Modifier.padding(top = 8.dp).fillMaxWidth(), shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surface) { Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(c.title, style = MaterialTheme.typography.titleMedium); Muted(c.detail) }; PillPurple(c.cta) } } }
            if (m.actions.isNotEmpty()) Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { m.actions.chunked(2).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { row.forEach { a -> Chip(a, purple = true) { onAction(a) } } } } }
        }
    }
}

package com.bucks.app.ui

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.bucks.app.ai.IntentRouter
import com.bucks.app.ai.ParsedIntent
import com.bucks.app.ai.Tools
import com.bucks.app.data.*
import com.bucks.app.ui.nav.Routes
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.random.Random

enum class Role { CUSTOMER, PROVIDER }
enum class SortMode(val label: String) { TRUST("Most trusted"), NEAR("Nearest"), PRICE("Lowest price") }
enum class ScopeFilter(val label: String) { ALL("All"), LOCAL("Local"), GLOBAL("Global") }
enum class AskMode { RESULTS, CHAT }
enum class ProKind { VEHICLE, SKILLS, BUSINESS }
data class CallState(val name: String, val phone: String, val startedAt: Long = System.currentTimeMillis(), val muted: Boolean = false, val speaker: Boolean = false)

data class UiState(
    val user: User? = null, val pro: ProProfile? = null, val biz: Business? = null,
    val role: Role = Role.CUSTOMER, val online: Boolean = false, val earnings: Int = 0,
    val tempPhone: String = "", val tempEmail: String = "",
    val cart: Map<String, Int> = emptyMap(),
    val orders: List<Order> = emptyList(), val requests: List<ServiceRequest> = emptyList(), val rides: List<Ride> = emptyList(),
    val ride: Ride? = null, val driverRide: DriverRide? = null,
    val rideKind: VehicleKind = VehicleKind.BIKE, val rideDest: Place? = null,
    val query: String = "", val sort: SortMode = SortMode.TRUST, val scope: ScopeFilter = ScopeFilter.ALL, val askMode: AskMode = AskMode.RESULTS, val lens: Lens = Lens.ALL,
    val agent: List<AgentMessage> = listOf(AgentMessage(false, "Tell me what you need — a ride, food, a plumber, a comparison — by typing or speaking.")),
    val thinking: Boolean = false, val voiceLang: String = "en-IN",
    val myVotes: Map<String, Int> = emptyMap(), val postVotes: Map<String, Int> = emptyMap(),
    val incoming: List<Incoming> = emptyList(),
    val proKind: ProKind? = null, val proStep: Int = 1, val proMessage: String = "",
    val pendingDest: String? = null, val pending: PendingAction? = null,
    val syncStatus: SyncStatus = SyncStatus.SYNCED, val lastSynced: String = "Just now", val devices: List<LinkedDevice> = emptyList(),
    val call: CallState? = null,
    val me: LatLng? = null, val meX: Float = Seed.ME_X, val meY: Float = Seed.ME_Y, val locationGranted: Boolean = false, val mockLocation: Boolean = false,
)

class BucksViewModel(val repo: BucksRepository) : ViewModel() {
    private val _s = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _s.asStateFlow()
    private val _toasts = MutableSharedFlow<String>(extraBufferCapacity = 8); val toasts = _toasts.asSharedFlow()
    private val _nav = MutableSharedFlow<String>(extraBufferCapacity = 8); val nav = _nav.asSharedFlow()
    private val router = IntentRouter()
    val cloudEnabled get() = router.cloudEnabled
    private var ringJob: Job? = null; private var driveJob: Job? = null; private var drvRingJob: Job? = null

    init {
        runCatching { Identity.ensureKey() }
        repo.loadSession()?.let { s -> _s.update { it.copy(user = s.user.copy(id = s.user.id.ifBlank { safeId() }), pro = s.pro, biz = s.biz) } }
        _s.update { it.copy(devices = listOf(LinkedDevice(repo.deviceId(), Build.MODEL ?: "This device", "Now", true))) }
    }
    private fun safeId() = runCatching { Identity.userId() }.getOrDefault("local-" + repo.deviceId())
    private fun sign(payload: String) = runCatching { Identity.sign(payload) }.getOrDefault("")
    val s get() = _s.value
    private fun toast(t: String) { _toasts.tryEmit(t) }
    private fun navTo(route: String) { _nav.tryEmit(route) }
    private fun persist() { s.user?.let { repo.saveSession(Session(it, s.pro, s.biz)) } }
    val isLoggedIn get() = s.user != null

    // ---------- auth & verification ----------
    fun setPhone(p: String) = _s.update { it.copy(tempPhone = p) }
    fun verifyOtp(code: String): Boolean { if (code != "1234") return false; _s.update { it.copy(user = it.user?.copy(phone = it.tempPhone.ifBlank { it.user.phone }, verified = it.user.verified + VerificationLevel.PHONE)) }; persist(); return true }
    fun createProfile(name: String, area: String, bio: String, gender: String = "", interests: List<String> = emptyList()) {
        val base = s.user ?: User(name, area, bio, s.tempPhone, email = s.tempEmail, id = safeId(), verified = if (s.tempPhone.isNotBlank()) setOf(VerificationLevel.PHONE) else emptySet())
        val dev = deviceLooksGenuine()
        _s.update { it.copy(user = base.copy(name = name, area = area, bio = bio, gender = gender, interests = interests, verified = if (dev) base.verified + VerificationLevel.DEVICE else base.verified)) }; persist(); toast("Welcome to Bucks, ${name.substringBefore(' ')}")
    }
    /** Basic genuineness heuristic until Play Integrity is wired (needs a Play Console project). */
    private fun deviceLooksGenuine() = !(Build.TAGS?.contains("test-keys") == true || Build.FINGERPRINT.contains("generic") || Build.MODEL.contains("Emulator"))
    fun grantVerification(level: VerificationLevel) { _s.update { it.copy(user = it.user?.copy(verified = it.user.verified + level)) }; persist(); toast("${level.label} added to your identity") }
    fun signUpEmail(email: String, password: String, confirm: String): Boolean {
        val e = email.trim().lowercase()
        if (!Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(e)) { toast("Enter a valid email address"); return false }
        if (password.length < 8) { toast("Password needs at least 8 characters"); return false }
        if (password != confirm) { toast("Passwords don't match"); return false }
        if (repo.hasCredentials(e)) { toast("That email already has an account. Sign in instead."); return false }
        repo.saveCredentials(e, password); _s.update { it.copy(tempEmail = e) }; return true
    }
    fun signInEmail(email: String, password: String): Boolean {
        val e = email.trim().lowercase()
        if (!repo.checkCredentials(e, password)) { toast("Email or password is wrong"); return false }
        val saved = repo.loadSession()
        if (saved != null && saved.user.email == e) { _s.update { it.copy(user = saved.user, pro = saved.pro, biz = saved.biz) }; return true }
        _s.update { it.copy(tempEmail = e) }; return true
    }
    fun logout() { repo.clearSession(); _s.value = UiState() }
    fun switchRole(role: Role) = _s.update { it.copy(role = role, online = false) }
    fun setOnline(v: Boolean) { if (v && s.mockLocation) { toast("Turn off mock location to go online"); return }; _s.update { it.copy(online = v) }; toast(if (v) "Online. Nearby ride requests will ring you." else "Offline") }

    // ---------- location ----------
    fun onLocation(p: LatLng, mocked: Boolean) { val (x, y) = Geo.toPercent(p); _s.update { it.copy(me = p, meX = x, meY = y, locationGranted = true, mockLocation = mocked) }; repo.updateDistances(p); if (mocked) toast("Mock location detected. Rides are disabled until it's off.") }
    fun onLocationDenied() = _s.update { it.copy(locationGranted = false) }
    val mePos: LatLng get() = s.me ?: Geo.fromPercent(s.meX, s.meY)

    // ---------- search / ask (intent router) ----------
    fun setQuery(q: String) = _s.update { it.copy(query = q, askMode = AskMode.RESULTS) }
    fun setSort(m: SortMode) = _s.update { it.copy(sort = m) }
    fun setScope(f: ScopeFilter) = _s.update { it.copy(scope = f) }
    fun setLens(l: Lens) = _s.update { it.copy(lens = l) }
    fun setVoiceLang(l: String) = _s.update { it.copy(voiceLang = l) }
    /** Trust as seen through the current lens. ALL uses the aggregate; other lenses count only matching vote records. */
    fun trustFor(p: Provider): Trust = when (s.lens) {
        Lens.ALL -> p.trust
        Lens.FOLLOWING -> { val ids = repo.people.value.filter { it.following }.map { "u-" + it.name.lowercase().replace(" ", "-") }.toSet(); val v = p.comments.filter { it.voterId in ids }; Trust(v.count { it.vote > 0 }, v.count { it.vote < 0 }) }
        Lens.VERIFIED -> { val v = p.comments.filter { it.verified }; Trust(v.count { it.vote > 0 }, v.count { it.vote < 0 }) }
    }
    fun sorted(list: List<Provider>): List<Provider> = when (s.sort) {
        SortMode.TRUST -> list.sortedWith(compareByDescending<Provider> { trustFor(it).pct ?: -1 }.thenByDescending { trustFor(it).total })
        SortMode.NEAR -> list.sortedBy { it.distanceKm }
        SortMode.PRICE -> list.sortedBy { it.minPrice }
    }
    fun results(): List<Provider> = sorted(repo.search(s.query)).filter { s.scope == ScopeFilter.ALL || it.scope.name == s.scope.name }
    fun isAgentQuery(q: String): Boolean { val l = q.lowercase(); return Regex("\\b(bike|scooter|taxi|cab|auto|ride|car|compare|cheapest|best|sort|my orders|my rides|history|post a request|go online|become|provider|pro profile|yes|confirm|cancel|show the map|book|take me|drop me)\\b").containsMatchIn(l) }

    /** Every typed or spoken command enters here. */
    fun submitQuery(raw: String) {
        val q = raw.trim(); if (q.isEmpty()) return
        if (!isAgentQuery(q) && s.pending == null) { _s.update { it.copy(query = q, askMode = AskMode.RESULTS) }; return }
        _s.update { it.copy(query = "", askMode = AskMode.CHAT, thinking = true, agent = (it.agent + AgentMessage(true, q)).takeLast(14)) }
        viewModelScope.launch {
            val ctx = "user area=${s.user?.area}; pending=${s.pending?.title ?: "none"}; online riders=${repo.drivers.value.count { it.online }}"
            val intent = router.parse(q, ctx)
            val reply = execute(intent, q)
            _s.update { it.copy(thinking = false, agent = (it.agent + reply.first).takeLast(14)) }
            reply.second?.let { then -> delay(700); then() }
        }
    }
    fun agentSend(text: String) = submitQuery(text)

    private fun execute(i: ParsedIntent, raw: String): Pair<AgentMessage, (() -> Unit)?> {
        val onlineFor = { k: VehicleKind -> Geo.ring(mePos, repo.drivers.value, k).size }
        val via = if (i.source == "gemini") " (understood by cloud AI)" else ""
        return when (i.tool) {
            Tools.CONFIRM -> { val p = s.pending; when { p == null -> AgentMessage(false, "Nothing is waiting for confirmation.") to null; p.needsBiometric -> AgentMessage(false, "This one needs your fingerprint or PIN — tap Confirm on the card.") to null; else -> AgentMessage(false, "Confirmed. ${p.title}.") to { confirmPending() } } }
            Tools.CANCEL -> { cancelPending(); AgentMessage(false, "Cancelled.") to null }
            Tools.SHOW_MAP -> { s.pendingDest?.let { d -> _s.update { it.copy(pendingDest = null, rideDest = randomPlace(d)) } }; AgentMessage(false, "Opening the ride screen.") to { navTo(Routes.CHOOSE_RIDE) } }
            Tools.RIDE -> {
                val k = runCatching { VehicleKind.valueOf(i.args["vehicle"] ?: "BIKE") }.getOrDefault(VehicleKind.BIKE)
                val dest = i.args["destination"]?.takeIf { it.isNotBlank() }?.let { d -> Seed.PLACES.firstOrNull { it.equals(d, true) || it.lowercase().contains(d.lowercase().substringBefore(' ')) } }
                _s.update { it.copy(rideKind = k) }
                if (s.mockLocation) return AgentMessage(false, "Mock location is on, so I can't book a ride. Turn it off in developer settings.") to null
                val n = onlineFor(k)
                if (dest != null) { val place = randomPlace(dest); _s.update { it.copy(rideDest = place) }; proposeRide(place, k)
                    AgentMessage(false, "$n ${k.label.lowercase()} rider${if (n == 1) "" else "s"} within 5 km. ${k.label} to $dest, about ₹${fare(k, place.km)}, cash or UPI after the trip. Confirm?$via", actions = listOf("Yes, ring them", "Show the map first", "Cancel")) to null }
                else AgentMessage(false, "Where to? $n ${k.label.lowercase()} riders are online near you.", actions = Seed.PLACES.take(3).map { "${k.label} to ${it.substringBefore(',')}" }) to null
            }
            Tools.COMPARE -> { val res = sorted(repo.search(i.args["query"] ?: raw)); if (res.isEmpty()) return AgentMessage(false, "I couldn't find anyone for that.") to null
                AgentMessage(false, "Ranked by community trust (${s.lens.label.lowercase()}), then price:$via", cards = res.take(4).map { p -> AgentCard(p.name, "${trustFor(p).pct ?: "—"}% trust · ${p.distanceKm} km · ${if (p.items.isNotEmpty()) "from ₹${p.minPrice}" else p.rate}", "Open", AgentAction.OpenProvider(p.id)) }) to null }
            Tools.SORT -> { val m = runCatching { SortMode.valueOf(i.args["by"] ?: "TRUST") }.getOrDefault(SortMode.TRUST); _s.update { it.copy(sort = m) }; AgentMessage(false, "Sorted by ${m.label.lowercase()}. Type a search term and I'll show results that way.") to null }
            Tools.ACTIVITY -> AgentMessage(false, "You have ${s.orders.size} orders, ${s.requests.size} service requests and ${s.rides.size} rides.") to { navTo(Routes.ACTIVITY) }
            Tools.POST_REQUEST -> { val what = i.args["what"]?.ifBlank { null } ?: raw; repo.addPost(Post("f${System.currentTimeMillis()}", s.user?.name ?: "You", "now", "Looking for $what near ${s.user?.area}. Any recommendations?", up = 0, down = 0)); AgentMessage(false, "Posted to your neighbourhood feed.") to { navTo(Routes.FEED) } }
            Tools.GO_ONLINE -> if (s.pro?.vehicle != null) { _s.update { it.copy(role = Role.PROVIDER) }; setOnline(true); AgentMessage(false, "You're online.") to { navTo(Routes.HOME) } } else AgentMessage(false, "Attach a vehicle first and I'll put you online.") to { navTo(Routes.PRO_CREATE) }
            Tools.BECOME_PRO -> AgentMessage(false, "Let's set up your pro profile.") to { navTo(Routes.PRO_CREATE) }
            Tools.SEARCH -> { val q = i.args["query"]?.ifBlank { null } ?: raw; val res = sorted(repo.search(q))
                if (res.isEmpty()) AgentMessage(false, "No one offers \"$q\" yet. Want me to ask the community?", actions = listOf("Post a request for $q")) to null
                else AgentMessage(false, "Here's who the community trusts for that near you:$via", cards = res.take(3).map { p -> AgentCard(p.name, "${trustFor(p).pct ?: "—"}% · ${trustFor(p).total} votes · ${p.distanceKm} km", if (p.type == ProviderType.BUSINESS) "Order" else "Request", if (p.type == ProviderType.BUSINESS) AgentAction.OpenProvider(p.id, "items") else AgentAction.Request(p.id)) }) to null }
            else -> AgentMessage(false, if (cloudEnabled) "I didn't get that. Try 'auto to MG Road', 'order sugar' or 'compare biriyani'." else "I didn't get that. Try one of these (add a Gemini key to understand free-form commands):", actions = listOf("Auto to MG Road", "Order sugar", "Find a doctor", "Compare biriyani", "Show my orders")) to null
        }
    }

    // ---------- confirmation gate (every money-moving action passes here) ----------
    private fun propose(p: PendingAction) = _s.update { it.copy(pending = p) }
    fun cancelPending() = _s.update { it.copy(pending = null) }
    /** Called by the UI after the user tapped Confirm and (when required) passed BiometricPrompt. */
    fun confirmPending() { val p = s.pending ?: return; _s.update { it.copy(pending = null) }; p.run() }
    private fun firstTimeWith(counterparty: String) = s.orders.none { it.providerName == counterparty } && s.requests.none { it.providerName == counterparty }
    private fun proposeRide(place: Place, k: VehicleKind) { val f = fare(k, place.km); propose(PendingAction("Book a ${k.label.lowercase()}", "${s.user?.area} → ${place.name} · ${place.km} km · about ₹$f, pay after the trip", f, "Nearest online rider", null, needsBiometric = false) { doRequestRide() }) }
    fun requestRide() { val d = s.rideDest ?: return; proposeRide(d, s.rideKind) }
    fun placeOrder(): Boolean { val cl = cartLines(); val p = cl.first ?: return false; val total = cl.third
        propose(PendingAction("Place order with ${p.name}", cl.second.joinToString(", ") { "${it.first} × ${it.third}" } + " · ₹$total", total, p.name, p.trust, needsBiometric = total >= 500 || firstTimeWith(p.name)) { doPlaceOrder() }); return true }

    // ---------- providers, cart, orders, requests ----------
    fun provider(id: String) = repo.providers.value.firstOrNull { it.id == id }
    fun canVote(pid: String) = s.orders.any { it.providerId == pid && it.status == OrderStatus.DELIVERED } || s.requests.any { it.providerId == pid && it.status == RequestStatus.COMPLETED }
    fun vote(pid: String, up: Boolean, comment: String): Boolean {
        if (s.myVotes.containsKey(pid)) { toast("You already voted here"); return false }
        if (comment.isBlank()) { toast("A short comment is required"); return false }
        val txn = s.orders.firstOrNull { it.providerId == pid && it.status == OrderStatus.DELIVERED }?.id ?: s.requests.firstOrNull { it.providerId == pid && it.status == RequestStatus.COMPLETED }?.id ?: ""
        val u = s.user; val at = System.currentTimeMillis()
        repo.voteProvider(pid, up, u?.name ?: "You", comment, u?.id ?: "", VerificationLevel.DOCUMENT in (u?.verified ?: emptySet()), txn, sign(Identity.txnPayload("vote", txn, u?.id ?: "", pid, if (up) 1 else -1, at)))
        _s.update { it.copy(myVotes = it.myVotes + (pid to if (up) 1 else -1)) }; toast("Vote recorded and signed."); return true
    }
    fun cartAdd(pid: String, index: Int, delta: Int) = _s.update { st -> val key = "$pid:$index"; val next = max(0, (st.cart[key] ?: 0) + delta); val cleaned = st.cart.filterKeys { it.startsWith("$pid:") }.toMutableMap(); if (next == 0) cleaned.remove(key) else cleaned[key] = next; st.copy(cart = cleaned) }
    fun cartLines(): Triple<Provider?, List<Triple<String, Int, Int>>, Int> {
        val pid = s.cart.keys.firstOrNull()?.substringBefore(':') ?: return Triple(null, emptyList(), 0)
        val p = provider(pid) ?: return Triple(null, emptyList(), 0)
        val lines = s.cart.map { (k, q) -> val it = p.items[k.substringAfter(':').toInt()]; Triple(it.name, it.price, q) }
        val fee = if (p.scope == Scope.LOCAL && p.distanceKm <= 3) 0 else 30
        return Triple(p, lines, lines.sumOf { it.second * it.third } + fee)
    }
    private fun doPlaceOrder() {
        val cl = cartLines(); val p = cl.first ?: return; val lines = cl.second; val total = cl.third
        val id = "o${System.currentTimeMillis()}"; val at = System.currentTimeMillis()
        val o = Order(id, p.id, p.name, total, lines.map { "${it.first} × ${it.third}" }, OrderStatus.REQUESTED, sign(Identity.txnPayload("order", id, s.user?.id ?: "", p.id, total, at)))
        _s.update { it.copy(orders = listOf(o) + it.orders, cart = emptyMap()) }; navTo(Routes.order(id))
        viewModelScope.launch { for (st in OrderStatus.entries.drop(1)) { delay(2600); _s.update { u -> u.copy(orders = u.orders.map { if (it.id == o.id) it.copy(status = st) else it }) } }; toast("Delivered. You can now vote for ${p.name}.") }
    }
    fun sendRequest(pid: String, text: String): String {
        val p = provider(pid)!!; val id = "r${System.currentTimeMillis()}"
        val r = ServiceRequest(id, p.id, p.name, p.category, text.ifBlank { "Service request" }, RequestStatus.SENT, sign(Identity.txnPayload("request", id, s.user?.id ?: "", p.id, 0, System.currentTimeMillis())))
        _s.update { it.copy(requests = listOf(r) + it.requests) }
        viewModelScope.launch { delay(2500); setRequestStatus(r.id, RequestStatus.ACCEPTED); toast("${p.name} accepted. They'll message you."); val cid = repo.openChat(p.name, p.category); repo.sendMessage(cid, "Got your request: \"${r.text}\". I'll be there.", false) }
        return r.id
    }
    fun setRequestStatus(id: String, st: RequestStatus) { _s.update { u -> u.copy(requests = u.requests.map { if (it.id == id) it.copy(status = st) else it }) }; if (st == RequestStatus.COMPLETED) toast("Done. You can vote now.") }

    // ---------- ride (customer) ----------
    private fun randomPlace(name: String): Place { val ll = Geo.PLACES[name]; return if (ll != null) { val (x, y) = Geo.toPercent(ll); Place(name, x, y, (Geo.distanceKm(mePos, ll) * 10).roundToInt() / 10.0) } else Place(name, 20 + Random.nextFloat() * 60, 15 + Random.nextFloat() * 30, ((1.5 + Random.nextDouble() * 7) * 10).roundToInt() / 10.0) }
    fun startRide() = _s.update { it.copy(rideDest = null, pending = null) }
    fun chooseDest(name: String) = _s.update { it.copy(rideDest = randomPlace(name)) }
    fun setRideKind(k: VehicleKind) = _s.update { it.copy(rideKind = k) }
    fun fare(k: VehicleKind, km: Double) = (k.farePerKm * km + 20).roundToInt()
    fun onlineCount(k: VehicleKind) = Geo.ring(mePos, repo.drivers.value, k).size
    private fun doRequestRide() {
        val dest = s.rideDest ?: return; val k = s.rideKind; val id = "ride${System.currentTimeMillis()}"; val f = fare(k, dest.km)
        val ride = Ride(id, k, dest, f, RideStatus.SEARCHING, (1000 + Random.nextInt(9000)).toString(), signature = sign(Identity.txnPayload("ride", id, s.user?.id ?: "", "", f, System.currentTimeMillis())))
        _s.update { it.copy(ride = ride) }; navTo(Routes.SEARCHING)
        ringJob?.cancel(); ringJob = viewModelScope.launch {
            delay(4500); val cand = Geo.ring(mePos, repo.drivers.value, k).firstOrNull()
            if (cand != null) acceptRide(cand.id) else { delay(15000); _s.update { if (it.ride?.status == RideStatus.SEARCHING) it.copy(ride = it.ride.copy(status = RideStatus.NO_DRIVER)) else it } }
        }
    }
    fun acceptRide(driverId: String) {
        ringJob?.cancel(); val d = repo.drivers.value.first { it.id == driverId }
        _s.update { it.copy(ride = it.ride?.copy(driver = d, driverX = d.x, driverY = d.y, status = RideStatus.MATCHED, etaMin = max(1, (d.distanceKm * 2.5).roundToInt()))) }
        navTo(Routes.DRIVER_FOUND)
        driveJob?.cancel(); driveJob = viewModelScope.launch {
            val steps = 6; val mx = s.meX; val my = s.meY
            for (k in 1..steps) { delay(1200); val r = s.ride ?: return@launch
                _s.update { it.copy(ride = r.copy(driverX = d.x + (mx - d.x) * k / steps, driverY = d.y + (my - d.y) * k / steps - 2, etaMin = max(0, (d.distanceKm * 2.5 * (1 - k.toDouble() / steps)).roundToInt()))) } }
            _s.update { it.copy(ride = it.ride?.copy(status = RideStatus.ARRIVED)) }; toast("Your rider has arrived. Share PIN ${s.ride?.pin}")
        }
    }
    fun cancelRide(reason: String) { ringJob?.cancel(); driveJob?.cancel(); s.ride?.let { r -> _s.update { it.copy(rides = listOf(r.copy(status = RideStatus.CANCELLED, reason = reason)) + it.rides, ride = null) } }; toast("Ride cancelled"); navTo(Routes.HOME) }
    fun startTrip() {
        _s.update { it.copy(ride = it.ride?.copy(status = RideStatus.IN_RIDE)) }; navTo(Routes.IN_RIDE)
        driveJob?.cancel(); driveJob = viewModelScope.launch { val mx = s.meX; val my = s.meY
            for (k in 1..5) { delay(1300); val r = s.ride ?: return@launch; _s.update { it.copy(ride = r.copy(progress = k / 5f, driverX = mx + (r.dest.x - mx) * k / 5, driverY = my + (r.dest.y - my) * k / 5)) } }
            _s.update { it.copy(ride = it.ride?.copy(status = RideStatus.COMPLETED)) }; navTo(Routes.PAY) }
    }
    fun payRide(method: String) { _s.update { it.copy(ride = it.ride?.copy(status = RideStatus.PAID, paidWith = method)) }; navTo(Routes.RATE_RIDE) }
    fun finishRide(vote: Int?, comment: String, skip: Boolean): Boolean {
        val r = s.ride ?: return true
        if (!skip) { if (vote == null || comment.isBlank()) { toast("Pick a vote and add a comment"); return false }; r.driver?.let { repo.voteDriver(it.id, vote > 0) } }
        _s.update { it.copy(rides = listOf(r.copy(status = RideStatus.COMPLETED)) + it.rides, ride = null) }; toast("Trip saved to your rides"); navTo(Routes.HOME); return true
    }

    // ---------- provider side ----------
    fun simulateRing() {
        if (s.driverRide != null) return
        val k = s.pro?.vehicle?.kind ?: VehicleKind.BIKE; val km = ((1 + Random.nextDouble() * 6) * 10).roundToInt() / 10.0
        val dr = DriverRide("dr${System.currentTimeMillis()}", DriverRideStatus.RINGING, listOf("Deepa N", "Arjun R", "Meera S", "Vikram J").random(), Trust(40 + Random.nextInt(200), Random.nextInt(8)), s.user?.area ?: "Jayanagar", Seed.PLACES.random(), km, fare(k, km), (1000 + Random.nextInt(9000)).toString(), 15, ((0.4 + Random.nextDouble() * 3) * 10).roundToInt() / 10.0)
        _s.update { it.copy(driverRide = dr, role = Role.PROVIDER, online = true) }; navTo(Routes.HOME)
        drvRingJob?.cancel(); drvRingJob = viewModelScope.launch { while (true) { delay(1000); val cur = s.driverRide ?: return@launch; if (cur.status != DriverRideStatus.RINGING) return@launch
            if (cur.secondsLeft <= 1) { _s.update { it.copy(driverRide = null) }; toast("Another rider accepted first"); return@launch }; _s.update { it.copy(driverRide = cur.copy(secondsLeft = cur.secondsLeft - 1)) } } }
    }
    fun driverDecline() { drvRingJob?.cancel(); _s.update { it.copy(driverRide = null) }; toast("Declined") }
    fun driverAccept() { drvRingJob?.cancel(); _s.update { it.copy(driverRide = it.driverRide?.copy(status = DriverRideStatus.TO_PICKUP)) }; toast("You got it. Head to pick-up.") }
    fun driverNext(pin: String = ""): Boolean {
        val d = s.driverRide ?: return true
        val next = when (d.status) { DriverRideStatus.TO_PICKUP -> DriverRideStatus.ARRIVED
            DriverRideStatus.ARRIVED -> { if (pin != d.pin) { toast("Wrong PIN. Ask the customer again."); return false }; DriverRideStatus.IN_RIDE }
            DriverRideStatus.IN_RIDE -> DriverRideStatus.DONE
            else -> { _s.update { it.copy(earnings = it.earnings + d.fare) }; return true } }
        _s.update { it.copy(driverRide = d.copy(status = next)) }; return true
    }
    fun driverRateCustomer(up: Boolean) { _s.update { it.copy(user = it.user?.copy(up = it.user.up + if (up) 1 else 0, down = it.user.down + if (up) 0 else 1), driverRide = null) }; persist(); toast("Trip closed. Fare added to today's earnings.") }
    fun driverCancel() { _s.update { it.copy(user = it.user?.copy(down = it.user.down + 1), driverRide = null) }; persist(); toast("Cancelled. One downvote recorded.") }
    fun setProKind(k: ProKind) = _s.update { it.copy(proKind = k) }
    fun setProStep(n: Int) = _s.update { it.copy(proStep = n) }
    fun startPro(kind: ProKind?, step: Int) = _s.update { it.copy(proKind = kind, proStep = step) }
    fun saveVehicle(kind: VehicleKind, model: String, plate: String) { val v = Vehicle(kind, model.ifBlank { "My vehicle" }, plate.ifBlank { "KA 00 XX 0000" }.uppercase()); _s.update { it.copy(pro = (it.pro ?: ProProfile()).copy(vehicle = v), proStep = 3, proMessage = "${v.model} (${v.plate}) is attached. Verify your licence and RC to go online.") }; persist() }
    fun saveSkills(skills: List<String>, rate: String) { val u = s.user ?: return
        skills.forEach { sk -> if (repo.providers.value.none { it.id == "me-$sk" }) repo.addProvider(Provider("me-$sk", ProviderType.SKILL, sk, u.name, listOf(sk.lowercase()), s.meX, s.meY, 0.0, u.up, u.down, Scope.LOCAL, u.bio.ifBlank { "New on Bucks." }, rate = rate.ifBlank { "On request" })) }
        _s.update { it.copy(pro = (it.pro ?: ProProfile()).copy(skills = skills, rate = rate), proStep = 3, proMessage = "${skills.size} skills published. You'll appear in searches, ranked by votes you earn.") }; persist() }
    fun saveBusiness(name: String, cat: String, scope: Scope, items: List<Item>): Boolean { val u = s.user ?: return false
        if (name.isBlank() || cat.isBlank()) { toast("Name and category are required"); return false }
        val biz = Business(name, cat, scope, items)
        if (repo.providers.value.none { it.id == "biz-me" }) repo.addProvider(Provider("biz-me", ProviderType.BUSINESS, cat, name, listOf(cat.lowercase()) + items.flatMap { it.name.lowercase().split(" ") }.filter { it.isNotBlank() }, s.meX, s.meY, 0.0, 0, 0, scope, "New business on Bucks.", items))
        _s.update { it.copy(biz = biz, proStep = 3, proMessage = "$name is live. Customers searching \"${cat.lowercase()}\" will find you.") }; persist(); return true }
    fun simulateIncoming() { val inc = when { s.biz != null -> Incoming("Arjun R", "Order: ${s.biz!!.items.firstOrNull()?.name ?: "1 item"} × 2 · deliver to Jayanagar"); !s.pro?.skills.isNullOrEmpty() -> Incoming("Meera S", "Request: ${s.pro!!.skills.first()} needed today evening"); else -> { toast("Create a business or skills profile first"); navTo(Routes.PRO_CREATE); return } }
        _s.update { it.copy(incoming = listOf(inc) + it.incoming, role = Role.PROVIDER) }; toast("New incoming request"); navTo(Routes.LISTINGS) }
    fun acceptIncoming(i: Incoming) { _s.update { it.copy(incoming = it.incoming - i) }; toast("Accepted. Customer notified.") }

    // ---------- feed / chat / social ----------
    fun votePost(id: String, v: Int) { val prev = s.postVotes[id] ?: 0; val next = if (prev == v) 0 else v; repo.votePost(id, next, prev); _s.update { it.copy(postVotes = if (next == 0) it.postVotes - id else it.postVotes + (id to next)) } }
    fun addPost(text: String) { if (text.isBlank()) { toast("Write something first"); return }; repo.addPost(Post("f${System.currentTimeMillis()}", s.user?.name ?: "You", "now", text, up = 0, down = 0)); toast("Posted") }
    fun addComment(postId: String, text: String) { if (text.isNotBlank()) repo.addPostComment(postId, s.user?.name ?: "You", text) }
    fun openChat(name: String, role: String): String = repo.openChat(name, role).also { repo.markRead(it) }
    fun sendChat(chatId: String, text: String) { if (text.isBlank()) return; repo.sendMessage(chatId, text, true); viewModelScope.launch { delay(1200); repo.sendMessage(chatId, listOf("Sure.", "On it.", "Give me 10 minutes.", "Yes, that works.").random(), false); repo.markRead(chatId) } }
    fun markRead(chatId: String) = repo.markRead(chatId)
    fun sendAttachment(chatId: String, a: Attachment) { repo.sendMessage(chatId, if (a.isImage) "Photo" else a.name, true, a) }
    fun follow(id: String, f: Boolean) { repo.follow(id, f); toast(if (f) "Following. Their votes now count in the 'People I follow' lens." else "Unfollowed") }
    fun join(id: String, j: Boolean) { repo.join(id, j); toast(if (j) "Joined" else "Left community") }
    fun toggleDriverOnline(id: String) { val d = repo.drivers.value.first { it.id == id }; repo.setDriverOnline(id, !d.online) }

    // ---------- calls ----------
    fun startCall(name: String, phone: String) = _s.update { it.copy(call = CallState(name, phone)) }
    fun toggleMute() = _s.update { it.copy(call = it.call?.copy(muted = !it.call.muted)) }
    fun toggleSpeaker() = _s.update { it.copy(call = it.call?.copy(speaker = !it.call.speaker)) }
    fun endCall() { val c = s.call ?: return; val secs = (System.currentTimeMillis() - c.startedAt) / 1000; _s.update { it.copy(call = null) }; toast("Call with ${c.name} ended · ${secs / 60}m ${secs % 60}s") }

    // ---------- devices & backup ----------
    fun syncNow() { viewModelScope.launch { _s.update { it.copy(syncStatus = SyncStatus.SYNCING) }; delay(1400); _s.update { it.copy(syncStatus = SyncStatus.SYNCED, lastSynced = java.text.SimpleDateFormat("h:mm a", java.util.Locale.getDefault()).format(java.util.Date())) }; toast("Up to date on ${s.devices.size} device${if (s.devices.size > 1) "s" else ""}") } }
    fun exportSnapshot(): String = repo.exportSnapshot(s.user?.let { Session(it, s.pro, s.biz) })
    fun importSnapshot(json: String): Boolean { val se = repo.importSnapshot(json) ?: run { toast("That file isn't a Bucks backup"); return false }; _s.update { it.copy(user = se.user, pro = se.pro, biz = se.biz) }; toast("Restored ${se.user.name}'s profile on this device"); return true }
    fun linkDevice(code: String): Boolean { if (code.trim().length < 6) { toast("Enter the 6-character code shown on the other device"); return false }; _s.update { it.copy(devices = it.devices + LinkedDevice("dev-${code.trim().lowercase()}", "Device ${code.trim().uppercase()}", "Linked just now", false)) }; toast("Device linked."); return true }
    fun unlinkDevice(id: String) = _s.update { it.copy(devices = it.devices.filterNot { d -> d.id == id && !d.thisDevice }) }

    class Factory(private val repo: BucksRepository) : ViewModelProvider.Factory { @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = BucksViewModel(repo) as T }
}

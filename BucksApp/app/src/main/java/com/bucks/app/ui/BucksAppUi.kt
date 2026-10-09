package com.bucks.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.bucks.app.ui.components.*
import com.bucks.app.ui.nav.Routes
import com.bucks.app.ui.screens.*
import com.bucks.app.ui.theme.BucksTheme
import kotlinx.coroutines.launch
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.bucks.app.data.LatLng
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

private val TAB_ROUTES = mapOf(BottomTab.HOME to Routes.HOME, BottomTab.FEED to Routes.FEED, BottomTab.SERVICES to Routes.SERVICES, BottomTab.RECOMMENDED to Routes.RECOMMENDED, BottomTab.ACCOUNT to "account")

@Composable
fun BucksAppUi(vm: BucksViewModel) {
    var dark by remember { mutableStateOf<Boolean?>(null) }
    BucksTheme(dark = dark ?: isSystemInDarkTheme()) {
        val nav = rememberNavController(); val snack = remember { SnackbarHostState() }; val scope = rememberCoroutineScope()
        val drawer = rememberDrawerState(DrawerValue.Closed)
        val s by vm.state.collectAsState()
        val width = windowWidth()
        val toast: (String) -> Unit = { msg -> scope.launch { snack.currentSnackbarData?.dismiss(); snack.showSnackbar(msg, duration = SnackbarDuration.Short) } }
        LaunchedEffect(Unit) { vm.toasts.collect { toast(it) } }
        // Real position for the customer side: one fix on start and whenever the app returns to the foreground.
        val ctx = LocalContext.current
        @Suppress("MissingPermission") fun fetchLocation() { runCatching { LocationServices.getFusedLocationProviderClient(ctx).getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null).addOnSuccessListener { l -> if (l != null) vm.onLocation(LatLng(l.latitude, l.longitude), Build.VERSION.SDK_INT >= 31 && l.isMock) } } }
        val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
        val locPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { g -> if (g.values.any { it }) fetchLocation() else vm.onLocationDenied() }
        LaunchedEffect(s.user != null) { if (s.user != null) { if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) fetchLocation() else locPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) } }
        LaunchedEffect(s.user != null) { if (s.user != null && Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
        LaunchedEffect(Unit) { vm.nav.collect { route -> if (route == Routes.HOME || route == Routes.FEED || route == Routes.ACTIVITY) nav.navigate(route) { popUpTo(Routes.HOME) { inclusive = route == Routes.HOME } } else nav.navigate(route) } }
        val backEntry by nav.currentBackStackEntryAsState(); val current = backEntry?.destination?.route ?: Routes.SPLASH
        val currentTab = when { current.startsWith("feed") -> BottomTab.FEED; current.startsWith("services") -> BottomTab.SERVICES; current.startsWith("recommended") -> BottomTab.RECOMMENDED; current.startsWith("account") -> BottomTab.ACCOUNT; else -> BottomTab.HOME }
        val loggedIn = s.user != null && current !in listOf(Routes.SPLASH, Routes.LOGIN, Routes.OTP, Routes.SIGNUP_EMAIL, Routes.PROFILE) || (s.user != null && current == Routes.PROFILE)
        val showBottomBar = width == Width.COMPACT && (current in listOf(Routes.HOME, Routes.FEED, Routes.SERVICES, Routes.RECOMMENDED) || current.startsWith("account"))
        val showRail = width != Width.COMPACT && loggedIn
        fun tab(t: BottomTab) { nav.navigate(TAB_ROUTES[t]!!) { popUpTo(Routes.HOME) { inclusive = t == BottomTab.HOME }; launchSingleTop = true } }
        val openMenu: () -> Unit = { scope.launch { drawer.open() } }
        val closeMenu: () -> Unit = { scope.launch { drawer.close() } }
        val messages: () -> Unit = { nav.navigate(Routes.MESSAGES) }
        val chatWith: (String, String) -> Unit = { n, r -> nav.navigate(Routes.chat(vm.openChat(n, r))) }
        val call: (String, String) -> Unit = { n, p -> vm.startCall(n, p) }
        val home: () -> Unit = { nav.navigate(Routes.HOME) { popUpTo(Routes.HOME) { inclusive = true } } }
        val query: (String) -> Unit = { q -> vm.setQuery(q); nav.navigate(Routes.SEARCH) }
        val ride: () -> Unit = { vm.startRide(); nav.navigate(Routes.DESTINATION) }
        val logout: () -> Unit = { vm.logout(); nav.navigate(Routes.LOGIN) { popUpTo(0) } }

        ModalNavigationDrawer(drawerState = drawer, gesturesEnabled = loggedIn, drawerContent = {
            ModalDrawerSheet(drawerContainerColor = MaterialTheme.colorScheme.surface) { s.user?.let { u ->
                Column(Modifier.padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) { Avatar(initials(u.name), size = 48); Column(Modifier.padding(start = 14.dp)) { Text(u.name, style = MaterialTheme.typography.titleMedium); TrustBadge(u.trust) } }
                    Spacer(Modifier.height(18.dp))
                    val isPro = s.pro != null || s.biz != null
                    DrawerItem(Icons.Outlined.Person, "My profile") { closeMenu(); nav.navigate("account?tab=profile") }
                    DrawerItem(Icons.Outlined.WorkspacePremium, if (isPro) "Add to pro profile" else "Create pro profile") { closeMenu(); vm.startPro(null, 1); nav.navigate(Routes.PRO_CREATE) }
                    if (isPro) DrawerItem(Icons.Outlined.ListAlt, "My listings") { closeMenu(); nav.navigate(Routes.LISTINGS) }
                    if (s.pro?.vehicle != null) DrawerItem(Icons.Outlined.SwapHoriz, if (s.role == Role.PROVIDER) "Customer view" else "Provider mode") { closeMenu(); vm.switchRole(if (s.role == Role.PROVIDER) Role.CUSTOMER else Role.PROVIDER); home() }
                    HorizontalDivider(Modifier.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    DrawerItem(Icons.Outlined.History, "Rides, orders and requests") { closeMenu(); nav.navigate(Routes.ACTIVITY) }
                    DrawerItem(Icons.Outlined.ChatBubbleOutline, "Messages") { closeMenu(); messages() }
                    DrawerItem(Icons.Outlined.Search, "Search or ask") { closeMenu(); nav.navigate(Routes.SEARCH) }
                    DrawerItem(Icons.Outlined.Devices, "Devices and sync") { closeMenu(); nav.navigate("account?tab=settings") }
                    DrawerItem(Icons.Outlined.Settings, "Settings") { closeMenu(); nav.navigate("account?tab=settings") }
                    HorizontalDivider(Modifier.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    DrawerItem(Icons.Outlined.Logout, "Log out") { closeMenu(); logout() }
                    Text("Trust is community-only. There is no ranking algorithm.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 16.dp))
                }
            } }
        }) {
            Scaffold(containerColor = MaterialTheme.colorScheme.surface, snackbarHost = { SnackbarHost(snack) }, bottomBar = { if (showBottomBar) BucksBottomBar(currentTab) { tab(it) } }) { pad ->
                Row(Modifier.padding(pad).fillMaxSize()) {
                    if (showRail) BucksRail(currentTab) { tab(it) }
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                        NavHost(nav, startDestination = if (vm.isLoggedIn) Routes.HOME else Routes.SPLASH) {
                            composable(Routes.SPLASH) { SplashScreen { nav.navigate(Routes.LOGIN) } }
                            composable(Routes.LOGIN) { LoginScreen(vm, onSent = { if (s.tempEmail.isNotBlank() && s.tempPhone.isBlank()) nav.navigate(Routes.PROFILE) else nav.navigate(Routes.OTP) }, onSignedIn = { nav.navigate(Routes.HOME) { popUpTo(0) } }, onSignUp = { nav.navigate(Routes.SIGNUP_EMAIL) }, showToast = toast) }
                            composable(Routes.SIGNUP_EMAIL) { SignUpEmailScreen(vm, onBack = { nav.popBackStack() }, onCreated = { nav.navigate(Routes.PROFILE) }, onUseMobile = { nav.popBackStack() }) }
                            composable(Routes.OTP) { OtpScreen(vm, s.tempPhone, onBack = { nav.popBackStack() }, onVerified = { if (vm.isLoggedIn) nav.navigate(Routes.HOME) { popUpTo(0) } else nav.navigate(Routes.PROFILE) }, showToast = toast) }
                            composable(Routes.PROFILE) { CreateProfileScreen(vm, onDone = { nav.navigate(Routes.HOME) { popUpTo(0) } }, showToast = toast) }
                            composable(Routes.HOME) { HomeScreen(vm, openMenu, messages, onSearch = { nav.navigate(Routes.SEARCH) }, onRide = ride, onQuery = query, onServices = { tab(BottomTab.SERVICES) }, onProCreate = { vm.startPro(ProKind.VEHICLE, 2); nav.navigate(Routes.PRO_CREATE) }, onEarnings = { nav.navigate(Routes.EARNINGS) }, onListings = { nav.navigate(Routes.LISTINGS) }, onChatWith = chatWith) }
                            composable(Routes.SERVICES) { ServicesScreen(vm, openMenu, messages, onSearch = { nav.navigate(Routes.SEARCH) }, onRide = ride, onQuery = query) }
                            composable(Routes.FEED) { FeedScreen(vm, openMenu, messages, toast) }
                            composable(Routes.RECOMMENDED) { RecommendedScreen(vm, openMenu, messages, onProvider = { nav.navigate(Routes.provider(it)) }, onRide = { k -> vm.setRideKind(k); ride() }, onChatWith = chatWith) }
                            composable("account?tab={tab}", arguments = listOf(navArgument("tab") { type = NavType.StringType; defaultValue = "profile" })) { e ->
                                AccountScreen(vm, e.arguments?.getString("tab") ?: "profile", openMenu, messages, onProCreate = { vm.startPro(null, 1); nav.navigate(Routes.PRO_CREATE) }, onOrder = { nav.navigate(Routes.order(it)) }, onRequest = { nav.navigate(Routes.requestStatus(it)) }, onEditProfile = { nav.navigate(Routes.PROFILE) }, onToggleTheme = { dark = !(dark ?: false) }, onLogout = logout, showToast = toast) }
                            composable(Routes.SEARCH) { SearchScreen(vm, onBack = { nav.popBackStack() }, onProvider = { id, t -> nav.navigate(Routes.provider(id, t)) }, onRequest = { nav.navigate(Routes.request(it)) }, onMessages = messages, showToast = toast) }
                            composable("provider/{id}?tab={tab}", arguments = listOf(navArgument("id") { type = NavType.StringType }, navArgument("tab") { type = NavType.StringType; defaultValue = "about" })) { e ->
                                val id = e.arguments!!.getString("id")!!
                                ProviderScreen(vm, id, e.arguments?.getString("tab") ?: "about", onBack = { nav.popBackStack() }, onRequest = { nav.navigate(Routes.request(id)) }, onChatWith = chatWith, onCall = call, onCart = { nav.navigate(Routes.CART) }, onMessages = messages) }
                            composable(Routes.CART) { CartScreen(vm, onBack = { nav.popBackStack() }, onPlaced = { }) }
                            composable(Routes.ORDER, arguments = listOf(navArgument("id") { type = NavType.StringType })) { e -> OrderScreen(vm, e.arguments!!.getString("id")!!, onBack = { nav.popBackStack() }, onVote = { nav.navigate(Routes.provider(it, "votes")) }, onChatWith = chatWith, onHome = home) }
                            composable(Routes.REQUEST, arguments = listOf(navArgument("id") { type = NavType.StringType })) { e -> RequestScreen(vm, e.arguments!!.getString("id")!!, onBack = { nav.popBackStack() }, onSent = { nav.navigate(Routes.requestStatus(it)) { popUpTo(Routes.HOME) } }) }
                            composable(Routes.REQUEST_STATUS, arguments = listOf(navArgument("id") { type = NavType.StringType })) { e -> RequestStatusScreen(vm, e.arguments!!.getString("id")!!, onBack = { nav.popBackStack() }, onVote = { nav.navigate(Routes.provider(it, "votes")) }, onChatWith = chatWith) }
                            composable(Routes.DESTINATION) { DestinationScreen(vm, onBack = { nav.popBackStack() }, onChosen = { nav.navigate(Routes.CHOOSE_RIDE) }) }
                            composable(Routes.CHOOSE_RIDE) { ChooseRideScreen(vm, onBack = { nav.popBackStack() }) }
                            composable(Routes.SEARCHING) { SearchingScreen(vm, onChangeType = { nav.navigate(Routes.CHOOSE_RIDE) { popUpTo(Routes.HOME) } }) }
                            composable(Routes.DRIVER_FOUND) { DriverFoundScreen(vm, chatWith, call, toast) }
                            composable(Routes.IN_RIDE) { InRideScreen(vm, toast) }
                            composable(Routes.PAY) { PayScreen(vm) }
                            composable(Routes.RATE_RIDE) { RateRideScreen(vm) }
                            composable(Routes.PRO_CREATE) { ProCreateScreen(vm, onBack = { nav.popBackStack() }, onHome = home, onListings = { nav.navigate(Routes.LISTINGS) { popUpTo(Routes.HOME) } }) }
                            composable(Routes.LISTINGS) { ListingsScreen(vm, onBack = { nav.popBackStack() }, onEdit = { k -> vm.startPro(k, 2); nav.navigate(Routes.PRO_CREATE) }) }
                            composable(Routes.EARNINGS) { EarningsScreen(vm, onBack = { nav.popBackStack() }) }
                            composable(Routes.MESSAGES) { MessagesScreen(vm, onBack = { nav.popBackStack() }, onOpen = { nav.navigate(Routes.chat(it)) }, onCall = call) }
                            composable(Routes.CHAT, arguments = listOf(navArgument("id") { type = NavType.StringType })) { e -> ChatScreen(vm, e.arguments!!.getString("id")!!, onBack = { nav.popBackStack() }, onCall = call) }
                        }
                        if (s.call != null) CallOverlay(vm)
                        ConfirmationSheet(vm, toast)
                    }
                }
            }
        }
    }
}

@Composable
private fun DrawerItem(icon: ImageVector, label: String, onClick: () -> Unit) = NavigationDrawerItem(icon = { Icon(icon, null) }, label = { Text(label, style = MaterialTheme.typography.bodyLarge) }, selected = false, onClick = onClick, modifier = Modifier.padding(vertical = 1.dp))

package com.bucks.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.bucks.app.ui.BucksViewModel
import com.bucks.app.ui.components.*
import com.bucks.app.ui.theme.Purple
import com.bucks.app.ui.theme.PurpleDeep

@Composable
fun SplashScreen(onStart: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Purple).padding(32.dp), horizontalAlignment = Alignment.Start, verticalArrangement = Arrangement.Bottom) {
        Text("bucks", style = MaterialTheme.typography.displaySmall, color = Color.White)
        Text("Rides, food, skilled people and local shops — ranked only by the people who used them.", style = MaterialTheme.typography.bodyLarge, color = Color.White.copy(alpha = .85f), modifier = Modifier.padding(top = 12.dp, bottom = 40.dp))
        Button(onClick = onStart, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(14.dp), colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = PurpleDeep)) { Text("Get started", style = MaterialTheme.typography.labelLarge) }
    }
}

@Composable
fun PasswordField(value: String, onChange: (String) -> Unit, label: String, placeholder: String = "At least 8 characters") {
    var show by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(bottom = 14.dp)) { FieldLabel(label)
        OutlinedTextField(value, onChange, placeholder = { Text(placeholder) }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            trailingIcon = { IconButton(onClick = { show = !show }) { Icon(if (show) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (show) "Hide" else "Show") } }) }
}

/** Sign-in with either a mobile number (OTP) or email + password; links to email sign-up. */
@Composable
fun LoginScreen(vm: BucksViewModel, onSent: () -> Unit, onSignedIn: () -> Unit, onSignUp: () -> Unit, showToast: (String) -> Unit) {
    var mode by remember { mutableStateOf("Mobile number") }
    var phone by remember { mutableStateOf("") }; var email by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }
    ContentColumn { BucksTopBar()
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
            Headline("Sign in")
            Muted("Use your mobile number for a one-time code, or your email and password.", Modifier.padding(top = 8.dp, bottom = 20.dp))
            Row(Modifier.padding(bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { Chip("Mobile number", selected = mode == "Mobile number") { mode = "Mobile number" }; Chip("Email", selected = mode == "Email") { mode = "Email" } }
            if (mode == "Mobile number") {
                FieldLabel("Mobile number")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField("+91", {}, readOnly = true, modifier = Modifier.width(80.dp), shape = RoundedCornerShape(14.dp))
                    Spacer(Modifier.width(10.dp))
                    OutlinedTextField(phone, { phone = it.filter { ch -> ch.isDigit() }.take(10) }, placeholder = { Text("98765 43210") }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(14.dp), singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
                }
                PrimaryButton("Send code", Modifier.padding(top = 20.dp)) { if (phone.length < 10) showToast("Enter a 10-digit number") else { vm.setPhone(phone); onSent() } }
            } else {
                BucksField(email, { email = it }, "Email", "you@example.com", keyboard = KeyboardOptions(keyboardType = KeyboardType.Email))
                PasswordField(password, { password = it }, "Password", "Your password")
                PrimaryButton("Sign in", Modifier.padding(top = 6.dp)) { if (vm.signInEmail(email, password)) { if (vm.isLoggedIn) onSignedIn() else onSent() } }
                TextButton(onClick = { showToast("Reset link sent to $email") }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Forgot password?") }
            }
            Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) { Muted("New to Bucks?"); TextButton(onClick = onSignUp) { Text("Create an account") } }
            Muted("By continuing you agree to the community rules: vote honestly, one account per person.", Modifier.padding(top = 8.dp).fillMaxWidth(), TextAlign.Center)
        }
    }
}

@Composable
fun SignUpEmailScreen(vm: BucksViewModel, onBack: () -> Unit, onCreated: () -> Unit, onUseMobile: () -> Unit) {
    var email by remember { mutableStateOf("") }; var pw by remember { mutableStateOf("") }; var confirm by remember { mutableStateOf("") }
    ContentColumn { BucksTopBar(onBack = onBack)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
            Headline("Create an account")
            Muted("Email and password. You can add your mobile number later for ride PINs and calls.", Modifier.padding(top = 8.dp, bottom = 24.dp))
            BucksField(email, { email = it }, "Email", "you@example.com", keyboard = KeyboardOptions(keyboardType = KeyboardType.Email))
            PasswordField(pw, { pw = it }, "Password")
            PasswordField(confirm, { confirm = it }, "Confirm password", "Type it again")
            PrimaryButton("Continue") { if (vm.signUpEmail(email, pw, confirm)) onCreated() }
            TextButton(onClick = onUseMobile, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp)) { Text("Use my mobile number instead") }
        }
    }
}

@Composable
fun OtpScreen(vm: BucksViewModel, phone: String, onBack: () -> Unit, onVerified: () -> Unit, showToast: (String) -> Unit) {
    var code by remember { mutableStateOf("") }
    ContentColumn { BucksTopBar(onBack = onBack)
        Column(Modifier.padding(20.dp)) {
            Headline("Enter the code")
            Muted("Sent to +91 $phone. In this build the code is 1234.", Modifier.padding(top = 8.dp, bottom = 28.dp))
            OutlinedTextField(code, { code = it.filter { ch -> ch.isDigit() }.take(4) }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), textStyle = MaterialTheme.typography.headlineMedium.copy(textAlign = TextAlign.Center, letterSpacing = androidx.compose.ui.unit.TextUnit(8f, androidx.compose.ui.unit.TextUnitType.Sp)))
            PrimaryButton("Verify", Modifier.padding(top = 20.dp)) { if (vm.verifyOtp(code)) onVerified() else showToast("Wrong code. Try 1234.") }
            TextButton(onClick = { showToast("Code resent") }, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp)) { Text("Resend code") }
        }
    }
}

private val INTERESTS = listOf("Food", "Rides", "Home services", "Fitness", "Tech", "Design", "Jobs", "Kids", "Pets", "Shopping", "Events", "Health")

/** Three-step profile setup, matching Figma's Profile Step 1–3. Editing an existing profile starts on step 1 with values filled in. */
@Composable
fun CreateProfileScreen(vm: BucksViewModel, onDone: () -> Unit, showToast: (String) -> Unit) {
    val s by vm.state.collectAsState(); val u = s.user
    var step by remember { mutableIntStateOf(1) }
    var name by remember { mutableStateOf(u?.name ?: "") }; var bio by remember { mutableStateOf(u?.bio ?: "") }
    val areas = listOf("Jayanagar", "Koramangala", "Indiranagar", "Whitefield", "JP Nagar", "HSR Layout"); var area by remember { mutableStateOf(u?.area?.substringBefore(',') ?: areas[0]) }
    var gender by remember { mutableStateOf(u?.gender ?: "") }; val interests = remember { mutableStateListOf<String>().apply { addAll(u?.interests ?: emptyList()) } }
    ContentColumn { BucksTopBar(onBack = if (step > 1) ({ step -= 1 }) else null)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
            Row(Modifier.fillMaxWidth().padding(bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) { (1..3).forEach { i -> Box(Modifier.weight(1f).height(4.dp).clip(CircleShape).background(if (i <= step) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh)) } }
            when (step) {
                1 -> {
                    Headline(if (u == null) "What should we call you?" else "Edit your profile"); Muted("This is what neighbours and providers see.", Modifier.padding(top = 8.dp, bottom = 24.dp))
                    Box(Modifier.fillMaxWidth().padding(bottom = 20.dp), contentAlignment = Alignment.Center) { Avatar(if (name.isBlank()) "?" else initials(name), size = 84) }
                    BucksField(name, { name = it }, "Full name", "e.g. Deepa Nair")
                    PrimaryButton("Continue") { if (name.isBlank()) showToast("Add your name") else step = 2 }
                }
                2 -> {
                    Headline("Where are you based?"); Muted("Used for distance, ride pick-ups and local rankings. Only your area is shown, never your address.", Modifier.padding(top = 8.dp, bottom = 24.dp))
                    FieldLabel("Your area"); FlowChips(areas, setOf(area)) { area = it }
                    Spacer(Modifier.height(20.dp)); FieldLabel("Gender (optional)"); ChipRow(listOf("Woman", "Man", "Non-binary", "Prefer not to say"), gender.ifBlank { null }) { gender = it }
                    PrimaryButton("Continue", Modifier.padding(top = 24.dp)) { step = 3 }
                }
                else -> {
                    Headline("A little about you"); Muted("Trust starts at zero and is earned from votes. Interests only shape what you see in Discover.", Modifier.padding(top = 8.dp, bottom = 24.dp))
                    BucksField(bio, { bio = it }, "One line about you (optional)", "Product designer, biriyani enthusiast")
                    FieldLabel("Interests"); FlowChips(INTERESTS, interests.toSet()) { if (it in interests) interests.remove(it) else interests.add(it) }
                    PrimaryButton(if (u == null) "Finish" else "Save changes", Modifier.padding(top = 24.dp)) { vm.createProfile(name.trim(), "$area, Bengaluru", bio.trim(), gender, interests.toList()); onDone() }
                }
            }
        }
    }
}

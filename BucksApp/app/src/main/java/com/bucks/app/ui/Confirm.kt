package com.bucks.app.ui

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.bucks.app.ui.components.*

/**
 * The gate every money-moving action passes through. The agent (rules or cloud) can only propose;
 * this sheet is where the person says yes — and, above ₹500 or with a first-time counterparty,
 * proves it's them with BiometricPrompt (fingerprint/face/device PIN).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfirmationSheet(vm: BucksViewModel, showToast: (String) -> Unit) {
    val s by vm.state.collectAsState(); val p = s.pending ?: return
    val ctx = LocalContext.current
    val speaker = remember { Speaker(ctx) }
    DisposableEffect(Unit) { onDispose { speaker.shutdown() } }
    LaunchedEffect(p) { speaker.say("${p.title}. ${p.summary}. Say confirm or tap.", s.voiceLang) }
    fun authenticateThenRun() {
        val activity = ctx as? FragmentActivity ?: return vm.confirmPending()
        val can = BiometricManager.from(ctx).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
        if (can != BiometricManager.BIOMETRIC_SUCCESS) { vm.confirmPending(); return }
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(ctx), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(r: BiometricPrompt.AuthenticationResult) { vm.confirmPending() }
            override fun onAuthenticationError(code: Int, msg: CharSequence) { showToast("Not confirmed: $msg") }
        })
        prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle("Confirm ₹${p.amount}").setSubtitle(p.title).setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL).build())
    }
    ModalBottomSheet(onDismissRequest = { vm.cancelPending() }) {
        Column(Modifier.padding(20.dp).padding(bottom = 28.dp)) {
            Text(p.title, style = MaterialTheme.typography.headlineSmall)
            Muted(p.summary, Modifier.padding(top = 6.dp))
            BucksCard(Modifier.padding(vertical = 16.dp), tint = true) {
                Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Muted("Amount"); Text("₹${p.amount}", style = MaterialTheme.typography.headlineMedium) }; Column(horizontalAlignment = Alignment.End) { Muted("With"); Text(p.counterparty, style = MaterialTheme.typography.titleMedium); p.counterpartyTrust?.let { TrustBadge(it, compact = true) } } }
            }
            if (p.needsBiometric) Notice("This needs your fingerprint, face or device PIN because it's over ₹500 or your first time with this provider.", Modifier.padding(bottom = 12.dp))
            PrimaryButton(if (p.needsBiometric) "Confirm with biometrics" else "Confirm") { if (p.needsBiometric) authenticateThenRun() else vm.confirmPending() }
            GhostButton("Cancel", Modifier.padding(top = 10.dp)) { vm.cancelPending() }
            Muted("Nothing is booked or ordered until you confirm. The assistant can only propose.", Modifier.padding(top = 12.dp).fillMaxWidth(), align = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

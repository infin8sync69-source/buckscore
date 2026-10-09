package com.bucks.app.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature

/**
 * Hardware-backed identity. The user's ID is the SHA-256 of a P-256 public key that never leaves
 * the Android Keystore. Every ride, order and vote is signed with it, which is what makes
 * "votes only after a completed transaction" enforceable later on the server.
 */
object Identity {
    private const val ALIAS = "bucks-identity"
    private val ks: KeyStore by lazy { KeyStore.getInstance("AndroidKeyStore").apply { load(null) } }

    fun ensureKey() {
        if (ks.containsAlias(ALIAS)) return
        val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        kpg.initialize(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
            .setDigests(KeyProperties.DIGEST_SHA256).build())
        kpg.generateKeyPair()
    }
    fun publicKeyBase64(): String { ensureKey(); return Base64.encodeToString(ks.getCertificate(ALIAS).publicKey.encoded, Base64.NO_WRAP) }
    /** Stable user identifier derived from the public key ("UUID-verified user"). */
    fun userId(): String { ensureKey(); return sha256(ks.getCertificate(ALIAS).publicKey.encoded).take(32) }
    fun sign(payload: String): String { ensureKey()
        val sig = Signature.getInstance("SHA256withECDSA"); sig.initSign((ks.getEntry(ALIAS, null) as KeyStore.PrivateKeyEntry).privateKey); sig.update(payload.toByteArray())
        return Base64.encodeToString(sig.sign(), Base64.NO_WRAP) }
    fun verify(payload: String, signature: String): Boolean = runCatching { val sig = Signature.getInstance("SHA256withECDSA"); sig.initVerify(ks.getCertificate(ALIAS).publicKey); sig.update(payload.toByteArray()); sig.verify(Base64.decode(signature, Base64.NO_WRAP)) }.getOrDefault(false)
    fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
    /** Canonical string that both parties sign for a transaction. */
    fun txnPayload(type: String, txnId: String, actor: String, counterparty: String, amount: Int, at: Long) = "$type|$txnId|$actor|$counterparty|$amount|$at"
}

enum class VerificationLevel(val label: String, val detail: String) {
    PHONE("Phone verified", "One mobile number is bound to this key"),
    DEVICE("Genuine device", "Play Integrity / key attestation passed"),
    DOCUMENT("ID verified", "Driving licence or vehicle RC checked via DigiLocker partner"),
    COMMUNITY("Community vouched", "10+ completed, well-rated transactions"),
}

package com.bucks.app.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import java.util.Locale

/** Languages offered in the voice picker. Offline packs depend on the device; Bhashini/IndicConformer can replace this later. */
val VOICE_LANGS = listOf("en-IN" to "English", "hi-IN" to "हिन्दी", "kn-IN" to "ಕನ್ನಡ", "ta-IN" to "தமிழ்", "te-IN" to "తెలుగు")

class VoiceState { var listening by mutableStateOf(false); var partial by mutableStateOf("") }

/** Push-to-talk speech recognition using the platform recogniser (free, on-device where a language pack exists). */
@Composable
fun rememberVoiceInput(lang: String, onResult: (String) -> Unit, onError: (String) -> Unit): Pair<VoiceState, () -> Unit> {
    val ctx = LocalContext.current
    val state = remember { VoiceState() }
    val recognizer = remember { if (SpeechRecognizer.isRecognitionAvailable(ctx)) SpeechRecognizer.createSpeechRecognizer(ctx) else null }
    DisposableEffect(recognizer) { onDispose { recognizer?.destroy() } }
    fun start() {
        val r = recognizer ?: return onError("Speech recognition isn't available on this device")
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(p: Bundle?) { state.listening = true; state.partial = "" }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(v: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEndOfSpeech() { state.listening = false }
            override fun onError(e: Int) { state.listening = false; onError(when (e) { SpeechRecognizer.ERROR_NO_MATCH -> "Didn't catch that, try again"; SpeechRecognizer.ERROR_NETWORK -> "No network for speech"; SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission needed"; else -> "Couldn't hear you" }) }
            override fun onResults(b: Bundle?) { state.listening = false; b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onResult) }
            override fun onPartialResults(b: Bundle?) { b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { state.partial = it } }
            override fun onEvent(t: Int, p: Bundle?) {}
        })
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM); putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true); putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false) })
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) start() else onError("Microphone permission needed for voice") }
    val trigger: () -> Unit = { if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) start() else permission.launch(Manifest.permission.RECORD_AUDIO) }
    return state to trigger
}

/** Reads confirmations aloud so a voice-first booking can be done hands-free. */
class Speaker(ctx: Context) {
    private var ready = false
    private val tts = TextToSpeech(ctx) { if (it == TextToSpeech.SUCCESS) { ready = true } }
    fun say(text: String, lang: String = "en-IN") { if (!ready) return; tts.language = Locale.forLanguageTag(lang); tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "bucks") }
    fun shutdown() = tts.shutdown()
}

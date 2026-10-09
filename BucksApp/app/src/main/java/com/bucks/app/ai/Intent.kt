package com.bucks.app.ai

import com.bucks.app.BuildConfig
import com.bucks.app.data.Seed
import com.bucks.app.data.VehicleKind
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The single tool catalogue every intent engine must produce. The model only proposes an action;
 * Kotlin validates it, fills defaults and asks for confirmation before anything moves money.
 */
data class ParsedIntent(val tool: String, val args: Map<String, String> = emptyMap(), val confidence: Float = 1f, val source: String = "rules")

object Tools {
    const val RIDE = "request_ride"; const val SEARCH = "search_marketplace"; const val COMPARE = "compare"; const val SORT = "sort_results"
    const val ACTIVITY = "show_activity"; const val POST_REQUEST = "post_request"; const val GO_ONLINE = "go_online"; const val BECOME_PRO = "become_provider"
    const val CONFIRM = "confirm_pending"; const val SHOW_MAP = "show_map"; const val CANCEL = "cancel_pending"; const val HELP = "help"
    /** JSON schema handed to the cloud model; keep in sync with the constants above. */
    val schema: String = """
        {"tools":[
          {"name":"$RIDE","description":"Book a ride","args":{"vehicle":"BIKE|AUTO|CAB","destination":"place name or empty"}},
          {"name":"$SEARCH","description":"Find providers, shops, food or skilled people","args":{"query":"free text, e.g. sugar, plumber, biriyani"}},
          {"name":"$COMPARE","description":"Compare providers for something","args":{"query":"free text"}},
          {"name":"$SORT","description":"Change result ordering","args":{"by":"TRUST|NEAR|PRICE"}},
          {"name":"$ACTIVITY","description":"Show my rides, orders and requests","args":{}},
          {"name":"$POST_REQUEST","description":"Ask the community for something not listed","args":{"what":"free text"}},
          {"name":"$GO_ONLINE","description":"Driver goes online","args":{}},
          {"name":"$BECOME_PRO","description":"Start provider onboarding","args":{}},
          {"name":"$CONFIRM","description":"User confirms the pending action","args":{}},
          {"name":"$CANCEL","description":"User cancels the pending action","args":{}},
          {"name":"$HELP","description":"Anything else","args":{}}
        ]}""".trimIndent()
}

interface IntentEngine { suspend fun parse(text: String, context: String): ParsedIntent? }

/** Tier 0: deterministic grammar. Free, instant, offline; handles the common phrasings. */
class RuleIntentEngine : IntentEngine {
    private fun placeIn(l: String) = Seed.PLACES.firstOrNull { l.contains(it.substringBefore(',').lowercase().substringBefore(' ')) }
    override suspend fun parse(text: String, context: String): ParsedIntent? {
        val l = text.lowercase().trim()
        if (l.isBlank()) return null
        if (Regex("^(yes|confirm|ok|okay|book it|go ahead|haan|sari|yes, ring them)\\b").containsMatchIn(l)) return ParsedIntent(Tools.CONFIRM)
        if (Regex("^(no|cancel|stop|nahi|beda|never mind)\\b").containsMatchIn(l)) return ParsedIntent(Tools.CANCEL)
        if (l.contains("show the map")) return ParsedIntent(Tools.SHOW_MAP)
        val kind = when { Regex("\\b(bike|scooter|scooty|two wheeler)\\b").containsMatchIn(l) -> VehicleKind.BIKE; Regex("\\b(auto|rickshaw)\\b").containsMatchIn(l) -> VehicleKind.AUTO; Regex("\\b(cab|taxi|car)\\b").containsMatchIn(l) -> VehicleKind.CAB; else -> null }
        if (kind != null || Regex("\\b(ride|drop me|take me|pick me)\\b").containsMatchIn(l)) return ParsedIntent(Tools.RIDE, mapOf("vehicle" to (kind ?: VehicleKind.BIKE).name, "destination" to (placeIn(l) ?: "")))
        if (Regex("\\b(compare|cheapest|best|which is better)\\b").containsMatchIn(l)) return ParsedIntent(Tools.COMPARE, mapOf("query" to l.replace(Regex("\\b(compare|cheapest|best|which is better|for|the|near me|me)\\b"), "").trim()))
        if (l.startsWith("sort")) return ParsedIntent(Tools.SORT, mapOf("by" to when { Regex("price|cheap").containsMatchIn(l) -> "PRICE"; Regex("near|close|distance").containsMatchIn(l) -> "NEAR"; else -> "TRUST" }))
        if (Regex("\\b(my orders|my rides|my requests|history|activity)\\b").containsMatchIn(l)) return ParsedIntent(Tools.ACTIVITY)
        if (l.startsWith("post a request")) return ParsedIntent(Tools.POST_REQUEST, mapOf("what" to text.replace(Regex("(?i)post a request for"), "").trim()))
        if (Regex("\\b(go online|start duty|i'm online)\\b").containsMatchIn(l)) return ParsedIntent(Tools.GO_ONLINE)
        if (Regex("\\b(become|provider|pro profile|add (my )?(vehicle|skill|business)|earn)\\b").containsMatchIn(l)) return ParsedIntent(Tools.BECOME_PRO)
        val q = l.replace(Regex("\\b(order|find|get|book|need|want|i|a|an|some|near|nearby|please|me|the|for)\\b"), "").trim()
        return if (q.length >= 3) ParsedIntent(Tools.SEARCH, mapOf("query" to q), confidence = 0.6f) else null
    }
}

/**
 * Tier 2: Gemini via REST with a strict JSON contract. Enabled only when GEMINI_API_KEY is set in
 * local.properties. Never receives PINs, payment details or documents — only the command text
 * and a short context line. Swap for Firebase AI Logic (App Check) before shipping to production.
 */
class GeminiIntentEngine(private val apiKey: String = BuildConfig.GEMINI_API_KEY, private val model: String = "gemini-2.5-flash-lite") : IntentEngine {
    val enabled get() = apiKey.isNotBlank()
    override suspend fun parse(text: String, context: String): ParsedIntent? {
        if (!enabled) return null
        return withContext(Dispatchers.IO) {
            runCatching {
                val prompt = "You convert a user command for a Bengaluru super app into exactly one tool call. Tools:\n${Tools.schema}\nContext: $context\nKnown places: ${Seed.PLACES.joinToString()}\nReply with JSON only: {\"tool\":..., \"args\":{...}, \"confidence\":0-1}. Command: \"$text\""
                val body = JSONObject().put("contents", JSONArray().put(JSONObject().put("parts", JSONArray().put(JSONObject().put("text", prompt))))).put("generationConfig", JSONObject().put("responseMimeType", "application/json").put("temperature", 0))
                val url = URL("https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent?key=$apiKey")
                val c = (url.openConnection() as HttpURLConnection).apply { requestMethod = "POST"; setRequestProperty("Content-Type", "application/json"); connectTimeout = 8000; readTimeout = 12000; doOutput = true }
                c.outputStream.use { it.write(body.toString().toByteArray()) }
                val res = c.inputStream.bufferedReader().readText()
                val txt = JSONObject(res).getJSONArray("candidates").getJSONObject(0).getJSONObject("content").getJSONArray("parts").getJSONObject(0).getString("text")
                val j = JSONObject(txt.trim().removePrefix("```json").removePrefix("```").removeSuffix("```"))
                val args = j.optJSONObject("args")?.let { a -> a.keys().asSequence().associateWith { a.optString(it) } } ?: emptyMap()
                ParsedIntent(j.getString("tool"), args, j.optDouble("confidence", 0.8).toFloat(), source = "gemini")
            }.getOrNull()
        }
    }
}

/** Rules first, cloud only when rules are unsure. */
class IntentRouter(private val rules: IntentEngine = RuleIntentEngine(), private val cloud: GeminiIntentEngine = GeminiIntentEngine()) {
    val cloudEnabled get() = cloud.enabled
    suspend fun parse(text: String, context: String): ParsedIntent {
        val r = rules.parse(text, context)
        if (r != null && r.confidence >= 0.9f) return r
        if (cloud.enabled) cloud.parse(text, context)?.let { if (it.tool != Tools.HELP) return it }
        return r ?: ParsedIntent(Tools.HELP)
    }
}

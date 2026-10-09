# Bucks — Android (Kotlin, Jetpack Compose)

Mobility + social core with community-only trust. Runs standalone against an in-memory fake backend
(`FakeBucksRepository`); swap it for a real/P2P implementation of `BucksRepository` without touching screens.

## Run it
1. Install Android Studio (Ladybug or newer, JDK 17 bundled).
2. File → Open → this folder. Let Gradle sync (first sync downloads dependencies).
3. Pick an emulator or a phone with USB debugging, press Run.
4. Sign in with any 10-digit number; OTP is **1234**.

## Where things live
- `data/Models.kt` — every entity (Provider, Driver, Ride, Order, Trust…)
- `data/SeedData.kt` — demo providers, drivers, posts, chats (Bengaluru)
- `data/BucksRepository.kt` — the contract + fake implementation + session persistence
- `ui/BucksViewModel.kt` — all app logic: search/ask agent, cart/orders/requests, ride dispatch & state machine, driver mode, voting
- `ui/BucksAppUi.kt` — navigation graph, drawer, bottom bar, snackbars
- `ui/screens/*` — one file per area (Auth, Home, Search, Provider, Ride, Pro, Social, Account)
- `ui/components/Components.kt` — buttons, chips, trust badge, simulated map

## Next steps to make it real
1. Backend: implement `BucksRepository` over your API/P2P layer (ride dispatch events, votes, chats).
2. Maps: replace `SimMap` with Google Maps Compose (needs an API key in `local.properties`).
3. Auth: Firebase phone OTP replaces `verifyOtp("1234")`.
4. Driver location: a foreground service with `FOREGROUND_SERVICE_LOCATION` when online.
5. Push: FCM high-priority messages for ride rings.

## What's new in this revision
- Premium visual pass: Manrope typeface, tonal surfaces instead of borders, Material icons throughout (no emojis), calmer spacing.
- Multi-device: adaptive layout (bottom bar on phones, navigation rail and side-by-side panes on tablets/foldables), state survives rotation, and Settings → Devices lets you link devices, back up and restore your profile as a JSON snapshot.
- Social discovery: "For you" tab shows people near you (follow, message) and communities (join) above the vote-based recommendations.
- Calls: in-app call screen with mute/speaker and a fallback to the phone dialer.
- Messages: photo and file attachments (Android photo picker and document picker), inline image previews, tap to open.
- Sign-in with mobile OTP or email + password; email sign-up with confirm; password shown/hidden. Credentials are hashed locally (swap for Firebase/your auth).
- Three-step profile setup (name → area & gender → bio & interests); "Edit profile" reuses it with values filled.
- Business profiles now have About / Menu-Aisles-Catalogue-Products / Feed / Votes tabs; the products layout follows the business type (restaurant veg/non-veg rows with course filter, supermarket grid with pack sizes, furniture and electronics catalogue cards with specs). Two new seed vendors: Woodcraft Studio, Volt Electronics.
- Business creation collects a full item list with type-specific fields.

## Revision 3 — realistic build (no decentralisation)
- **Intent engine, three tiers.** `ai/Intent.kt`: a deterministic rule grammar runs first (free, offline); when unsure and `GEMINI_API_KEY` is set in `local.properties`, Gemini (`gemini-2.5-flash-lite`, JSON-only, temperature 0) maps the command to one tool from a fixed catalogue. The model can only *propose*; Kotlin validates and executes.
- **Confirmation gate.** Every money-moving action (ride, order) opens a confirmation sheet; over ₹500 or with a first-time provider it requires BiometricPrompt (fingerprint/face/device PIN). Voice "confirm" cannot bypass biometrics.
- **Voice.** Push-to-talk mic in the search bar via Android `SpeechRecognizer` (English, Hindi, Kannada, Tamil, Telugu tags); confirmations are read aloud with `TextToSpeech`. Replace with Bhashini/IndicConformer for better Kannada.
- **Identity.** `data/Identity.kt`: P-256 key in Android Keystore; the user's ID is the hash of the public key; rides, orders, requests and votes carry an ECDSA signature. Verification levels: phone (OTP), device (basic genuineness check until Play Integrity is wired), ID document (placeholder upload until a DigiLocker/KYC partner is integrated), community.
- **Location.** Fused Location for the customer; `DriverLocationService` (foreground service, type=location, notification) while a driver is online; mock-location detection blocks rides; distances recomputed from real coordinates; `Geo.ring()` implements the published "everyone online within 5 km, nearest first" rule on a coarse grid (swap for H3 on the server).
- **Lenses instead of hidden ranking.** `Lens` = All verified votes / People I follow / ID-verified voters. Same counting formula over a user-chosen voter set; "How is this ranked?" shows the formula and counts.
- Manifest adds RECORD_AUDIO, USE_BIOMETRIC, FOREGROUND_SERVICE(_LOCATION), POST_NOTIFICATIONS. `MainActivity` is a `FragmentActivity` (needed by BiometricPrompt).

### Next: the server
Everything above talks to `BucksRepository`. The next milestone is a small backend (Ktor/Supabase) implementing it: FCM high-priority ring + WebSocket for on-duty drivers, H3 index, vote validation of the signed records, DigiLocker partner and Play Integrity verification, Firebase AI Logic with App Check replacing the raw Gemini key.

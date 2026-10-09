# 04. Sovereignty map: every corporate dependency and what replaces it

"Not dependent on any corporate conglomerate for digital services" is achievable for everything except two things Apple controls. Be precise about what is a **hard** dependency (service down → Bucks down), a **soft** one (service down → degraded), and a **distribution** one (needed to reach users, not to run).

Legend: ✅ replace now · 🟡 replace in phase 3-4 · ⛔ cannot be removed, contain it.

| Dependency | Used for today | Type | Replacement | Phase |
|---|---|---|---|---|
| **Supabase** (3 projects) | Mobile DB/RPC/realtime/storage; Bucks-global DB; Soul Engine session store | Hard | Self-hosted Postgres inside the Bucks node (same schema, same RPCs). Realtime → iroh streams from the node. Storage → IPFS pins on the node | 🟡 3 |
| **Firebase Auth** | Phone OTP, the JWT Supabase trusts | Hard | Bucks ID signed challenge; OTP (where still wanted) via a node-run SMS gateway (any SMS provider is swappable; the identity no longer depends on it) | 🟡 3 |
| **FCM** | Ride rings, chat notifications, Android | Hard | UnifiedPush with a self-hosted ntfy server run by the Bucks node; the mobile app embeds a UnifiedPush distributor fallback so users do not need a separate app. F-Droid build uses this only | 🟡 3 |
| **APNs** | iOS push | ⛔ | None. Apple permits no other wake-up path. Contain it: the node sends only an opaque "wake" via APNs; all content is fetched over iroh. Apple sees that a user got *a* notification, nothing else | — |
| **App Store / Play Store** | Distribution | ⛔ / 🟡 | iOS: App Store is mandatory (EU alt-stores aside). Android: publish on Play **and** F-Droid **and** a signed APK on bucks.global with the in-app self-updater that already exists (`AppUpdate.kt`) | 1 |
| **Google Gemini** | Mobile intent fallback; key in APK | Soft | On-device GGUF model behind the existing `IntentEngine` interface; remove the key | ✅ 1 |
| **Google Play services** | Fused location, code scanner | Soft | Android `LocationManager` + ZXing (already a dep). Keep Play services as an optional flavour for Play builds | 🟡 2 |
| **Play Integrity / App Attest** | Not yet wired | — | Use them as *attestations* (03 §verification), never as a login gate, so a de-Googled phone can still join with a lower trust level | 3 |
| **NVIDIA NIM / Lightning.ai** | Default LLM provider in the desktop app | Soft, but default | Local llama.cpp default; Bucks inference nodes; NIM only as opt-in BYOK | ✅ 0 |
| **Hugging Face** | GGUF downloads | Soft | Mirror the 3-4 blessed models on IPFS, pinned by Bucks nodes; HF as a fallback mirror | 🟡 2 |
| **Vercel** | bucks.global hosting; the Next.js identity-generation route | Hard for the site | Static site served by a Bucks node behind Caddy **and** published to IPFS with DNSLink (`_dnslink.bucks.global`), so the site resolves via any gateway or the app itself. Delete the identity route outright | ✅ 1 |
| **Railway** | FastAPI backend, Soul Engine lite | Hard | Bucks node | 🟡 3 |
| **GitHub** | Source, CI, releases, the 6-hourly data cron, the mobile self-updater | Hard for process | Mirror to a self-hosted Forgejo on a Bucks node; Woodpecker CI for the cron and builds; releases pinned on IPFS and signed (the `cluster-updater.js` design, enabled). GitHub stays as a public mirror. | 🟡 2 |
| **Tailscale** | IPFS cluster bootstrap between your machines | Soft | iroh relays you run; or WireGuard directly | 🟡 2 |
| **Protocol Labs bootstrap nodes** | Default libp2p bootstrap | Soft | Signed bootstrap list of Bucks nodes shipped in the app | ✅ 1 |
| **Public IPFS gateways** (ipfs.io, dweb.link, cloudflare-ipfs, Pinata) | Installer download, media rendering | Soft | Bucks node gateways first (`gw.bucks.global`, community nodes), public gateways last. The installer incident in this repo happened because the release was pinned only on a NAT'd laptop | ✅ 0 |
| **corsproxy.io / allorigins / cors-anywhere** | Image/media fetch workarounds in the Electron UI | Soft, leaks every URL a user views to a third party | Fetch via the local Rust side (Tauri command), no proxy | ✅ 2 |
| **Mapbox** | Optional tiles | Soft | OSM tiles are already primary; run a tile server on a node for your cities (OpenMapTiles) | 🟡 3 |
| **OSM / Nominatim / OSRM / Open-Meteo** | Maps, geocoding, routing, weather | Soft | These are non-profit/open; self-host Nominatim + OSRM for India on a node when traffic warrants | 4 |
| **Google Fonts / unpkg** | Site and UI fonts, a globe texture | Soft | Bundle the fonts (Manrope, Syne, JetBrains Mono are all open) | ✅ 1 |
| **ICANN registrar / DNS for bucks.global** | The domain | ⛔-ish | Keep it (users type it), and add a name that cannot be seized: publish the site and the bootstrap list under an IPNS key and a `.eth`/Handshake name as secondary | 2 |
| **UPI** | Payments | ⛔ | It is the national rail, not a conglomerate; keep | — |
| **Codesigning (Apple Developer, Windows EV cert)** | Shipping desktop binaries without warnings | ⛔ | Pay for them; also ship unsigned builds + Sigstore/minisign signatures for users who prefer that | 2 |

## What "sovereign" looks like when done

- Everything a user does works with **only Bucks nodes** reachable (one of which can be the user's own desktop).
- Every node is one binary with a config file, deployable on a ₹500/month VPS, a home server, or the desktop app itself ("become a node" toggle).
- The company-shaped survivors are APNs, the iOS App Store, code-signing certificates and the domain registrar. Each is contained so that losing it degrades one platform's convenience, not the network.

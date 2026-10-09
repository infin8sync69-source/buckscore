# 01. Current state

The uncomfortable summary first: there is no single Bucks product today. There are **five independent code bases, four incompatible identity schemes, two desktop apps, two social backends, and a blockchain that cannot enforce its own money supply**. The thing users install from bucks.global is a macOS-only Electron snapshot whose source is not in git. Several secrets are committed in public repositories.

None of that is unusual for a one-to-two person project moving fast. It is listed here so the plan starts from what is, not from what the READMEs claim.

## 1.1 Inventory

| Code base | What it really is | State | Size |
|---|---|---|---|
| `bucks.global` (this repo) | Static site (Vercel), `install`/`install.ps1`, a 34 MB Electron tarball in git, a gold-supply-chain dashboard fed by a 6-hourly GitHub Action | Live. Installer ships the tarball below | 40 MB |
| `bucks-Mobile` | Android (Kotlin, Compose, SDK 26-36) and iOS (SwiftUI, iOS 17) with a 1,273-line Supabase schema, 19 migrations, ~120 SQL RPCs, Firebase phone OTP, FCM | **The most mature code you own.** Real dispatch, commerce, chat, feed, jobs, studio. CI builds APK/AAB and runs SQL tests | 11 MB |
| `Bucks-browser` | Tauri 2 + Svelte 5 shell (`bucks-app/`), plus Electron-era Node scripts at root that nothing runs, `legacy_v1/` (Electron, Next.js, Qt), and `ui/` (committed Next.js export) | Shell works: tabs, Kubo-managed IPFS, wallet UI. No feed, no messages. Two 94 MB zips committed | 288 MB |
| `Bucks-global` | FastAPI (3,194-line `main.py`) + Next.js 16 social app on Railway/Vercel/Supabase, a diverged fork of the Tauri app with a Helia/OrbitDB social layer, `apps/chat`, orphan `src/lib`, planning docs | Backend signs messages with **server-held user private keys**. Frontend/backend signature schemes do not match [Likely all protected routes 401] | 185 MB |
| `bucks` (C++ chain) | PoW/UTXO chain, "BIP-8192" wallet, REST on :8080, vendored copy of Bucks-global | Educational prototype. See 1.4 | 201 MB |
| `buckscore` | One README line | Empty | 0 |
| **Electron tarball** (`dl/`) | "Bucks Core" v1.1.0: Electron 42 shell (9,440-line `renderer.js`), Python Soul Engine on :8765, MCP server on :9999, Helia node, Go chain node on :8192, C++ node fallback, bundled arm64 binaries | **The real desktop app.** Newer than everything in `Bucks-browser`. macOS arm64 only. Source outside git | 73 MB unpacked |

## 1.2 Identity today: four schemes, zero links

| Where | Scheme | Key | Stored | Linked to anything? |
|---|---|---|---|---|
| Mobile (`data/Identity.kt`, `Identity.swift`) | `userId = sha256(P-256 SPKI)[0:32]` | P-256, Android Keystore / Secure Enclave | Device | **No.** Never sent to the server. [Certain] |
| Mobile cloud (`supabase/schema.sql`) | `profiles.id uuid_v7`, `auth_uid` = Firebase uid, `short_code` 8-char Crockford | None (Firebase phone OTP) | Supabase | Only to Firebase |
| Bucks-global backend | `did:key` Ed25519 + a second `uuid7` handle + a libp2p PeerId | Ed25519 **generated on the server or on Vercel, private key stored in `users.secret_key`** | Server DB + localStorage | UUID7 can be re-bound to a new DID by anyone who posts it |
| Tauri app login | `did:key:z` + random hex. Comment: "stub" | None | localStorage | No |
| Tauri/Electron wallet | secp256k1, "BIP-8192" mnemonic, path `m/0` | secp256k1 | **plaintext localStorage** | No |
| Electron Soul Engine | `did:bucks:<ed25519 pubkey hex>` | Ed25519 PKCS8 in `~/.bucks/agent_soul_key.pem` | Disk, unencrypted | Device links are mutual attestations; "laptop and phone are two different souls" (its own comment) |
| Electron chat | X25519 + ML-KEM-768 + ML-DSA-65 Signal-style | Several | `safeStorage` with plaintext fallback | No |

The mobile `profiles.auth_uid` column comment says "Firebase uid today; any auth later". That is the one deliberate hook for the plan in `03-identity.md`.

## 1.3 What is real vs. simulated

**Real and used by people today [Certain]:** mobile dispatch/commerce/chat/feed against Supabase; Tauri IPFS add/cat/pin via managed Kubo; Electron shell with local-LLM chat, agent browser control, P2P gossip chat, app store launcher; the gold-intelligence dashboard.

**Simulated or stubbed [Certain]:** Tauri `start_tor_node` (returns a string), `init_swarm_agent`, `handle_feedback`; taxi `MOCK_DRIVERS` in the ephemeral widget; "Chain 8192" contracts at `0x8192…0001-4` hardcoded as `verified: true`; mobile demo mode (OTP `1234`, `SimMap`); Play Integrity and DigiLocker (comments only); guardians in Tauri recover (`mock_guardian_n`); the C++ node WebSocket (commented out).

**Claimed in docs but absent in code:** Ethereum/MongoDB/Express (`Bucks-global/ARCHITECTURE.md`); Base58 addresses, WebSockets, "production hardening" (`bucks/NEXT_STEPS.md`); 90% E2E, code signing, Windows/Linux builds (`PUBLISHING.md` in the tarball). The honest one is `IMPLEMENTATION_COMPLETE.md` in the tarball, which retracts the earlier "production ready" claim.

**Mesh / offline-first:** no Bluetooth, WebRTC or mDNS in the Tauri app or mobile. The Electron Helia node has mDNS and gossipsub, but with the default cluster secret every install shares the same public topics and bootstraps from `bootstrap.libp2p.io`. "Offline" in the Tauri code means the keyword fallback when the AI server is down.

## 1.4 The blockchain, plainly

[Certain, from `validation.cpp`, `blockchain.cpp`, `server.cpp`, `crypto.cpp`, `bip_8192.cpp`]

- Coinbase amount is never validated: `if (tx.isCoinbase()) return true;`. Anyone mining can mint any amount.
- Duplicate inputs in one transaction are not rejected: double counting creates coins.
- Ownership is checked only for 25-byte P2PKH scripts. Any key spends anything else, including the genesis output.
- Fork choice is by height, not cumulative work. Fork blocks are not PoW-checked on reorg.
- Transactions never relay over P2P (no `TX` case in the message handler).
- P2P "encryption" is unauthenticated ECDH + AES-CBC with no MAC, same key both directions, no sequence numbers.
- The 8,192-word Arabic wordlist collapses to 7,124 unique words after the diacritic stripper runs, so `loadWordlist` rejects it; the wallet then derives from an empty mnemonic. [Likely: every wallet gets the same private key.]
- `/api/wallets/sign` is an unauthenticated signing oracle; `/api/wallets/primary` returns the mnemonic; keys sit in `wallets.json` in plaintext.
- The "Chain 8192" in the Electron UI is the Go node's RPC port. The Go node source (`github.com/bucks-core/node`) is not in any repo you have. Only an arm64 binary exists.

Decision in [adr/0001-no-custom-chain.md](adr/0001-no-custom-chain.md): freeze it.

## 1.5 Secrets and privacy exposures found [Certain, values not reproduced here]

| Where | What | Action |
|---|---|---|
| Tarball `agent/memory/session_store.py:29` | Supabase Postgres URL **with password**. When `psycopg2` is present, user prompts/responses are written to that cloud DB | Rotate DB password; delete the code path |
| Tarball `ipfs/cluster-config.env` | Real `CLUSTER_SECRET` and Tailscale bootstrap peer. The file itself says it leaked on public IPFS | Rotate cluster secret; new bootstrap |
| `Bucks-browser/legacy_v1/next-shell/{test_gemini,test_quotas,test_quotas2,list_models}.js` | Google API key | Revoke; rewrite git history |
| `bucks-Mobile/firebase/google-services.json` | Firebase project config and API key (restricted keys, but public) | Restrict by package/SHA; move to CI secret |
| `bucks-Mobile/.github/workflows/*.yml`, `SUPABASE_SETUP.md`, `docs/PUSH_SETUP.md` | Supabase project ref + anon JWT as fallback literals | Acceptable only because RLS exists; still move to secrets |
| `Bucks-global` DB (`users.secret_key`) and `/api/recovery/restore` (no auth, returns the secret) | Custodial user private keys, readable by anyone who knows a DID | Take the endpoint down; see `07-security-triage.md` |
| Tarball `electron/bin/*`, `get_dimensions.py` | Personal paths (`/Users/mikado/...`) baked into binaries and scripts | Cosmetic; fix at rebuild |
| Tarball MCP server :9999 and Soul Engine :8765 | No auth, `allow_origins=["*"]`, file write across `$HOME`, shell allowlist bypass (`ls ; anything`) | Bind-token auth before next release |

## 1.6 Corporate dependencies in the running code (summary; full map in 04)

GitHub (code, releases, cron), Vercel (site, Next.js identity route), Railway (Soul Engine lite, FastAPI), Supabase ×3 projects (mobile, Bucks-global, Soul Engine sessions), Firebase Auth + FCM, Google Gemini (mobile intent fallback, key ships in app), Google Play services (location, scanner), Apple APNs/App Store, NVIDIA NIM (**default** LLM in the Electron app), Lightning.ai, Hugging Face (weights), Tailscale (cluster bootstrap), Protocol Labs public bootstrap nodes, public IPFS gateways (ipfs.io, dweb.link, cloudflare-ipfs, Pinata), corsproxy.io / allorigins, Mapbox token (unused by default; OSM is primary), Google Fonts, unpkg.

## 1.7 Repo hygiene

- 94 MB `ipfs_node.zip` committed in three places (`Bucks-browser/ui`, `Bucks-browser/legacy_v1/next-shell/public`, `Bucks-global/frontend/public`); 34 MB tarball here; 3.3 MB of Windows DLLs in `bucks/tools/mingw64`; Qt build objects with a Mach-O binary in `legacy_v1`.
- Broken gitlinks with no `.gitmodules`: `Bucks-browser/Blockchain/bucks`, `Bucks-global/tmp-bucks-browser`, `Bucks-global/.claude/worktrees/*`.
- A symlink to `/Users/sandeep/...node_modules` committed in `Bucks-global/apps/chat`.
- `bucks-crypto.ts` is byte-identical in three places; `apps/chat/lib` ≡ `bucks-app/src/lib`.
- Only `bucks-Mobile` has working CI. `Bucks-browser` CI is the untouched "Makefile" template and always fails.
- Four of five repos have one squashed commit each; history is already gone, which makes the secret purge cheaper.

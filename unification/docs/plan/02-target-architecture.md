# 02. Target architecture

## 2.1 The one-sentence version

**Bucks is a local-first app that runs on your phone, your desktop and on community-run nodes, where every person has one self-certifying Bucks ID, every piece of data is a signed event the user owns, content is addressed by hash, and no single company can switch it off.**

Everything below follows from four constraints you set: one global ID per user, interconnected devices, no dependence on a corporate conglomerate, and "bit by bit" (nothing here requires a rewrite before shipping).

## 2.2 Layers

```
┌───────────────────────────────────────────────────────────────────┐
│ Apps        Android (Kotlin)   iOS (Swift)   Desktop (Tauri 2)   Web (bucks.global, read-mostly) │
├───────────────────────────────────────────────────────────────────┤
│ bucks-core (one Rust crate, bound into every app via UniFFI / Tauri commands)                     │
│   identity ─ event log ─ local store (SQLite) ─ sync ─ transport ─ content (CID) ─ policy          │
├───────────────────────────────────────────────────────────────────┤
│ Transport   iroh (QUIC, dial-by-key, NAT traversal, relays you run)  +  IPFS/libp2p for content   │
├───────────────────────────────────────────────────────────────────┤
│ Nodes       "Bucks node": one binary, run by you, by communities, by anyone.                       │
│             Roles: relay · identity directory mirror · content pin · locality index · dispatch     │
│             · inference (optional GPU) · push gateway (UnifiedPush/ntfy) · web gateway             │
├───────────────────────────────────────────────────────────────────┤
│ Anchoring   Signed receipts now; OpenTimestamps on Bitcoin for proof-of-existence; no own chain   │
└───────────────────────────────────────────────────────────────────┘
```

### bucks-core (Rust)

One crate, one source of truth for the things that must be identical on every device:

- **identity**: Bucks ID derivation, key hierarchy, device delegation, rotation, recovery (spec in `03-identity.md`).
- **events**: the signed event envelope from `Bucks-browser/PHASED_IMPLEMENTATION_SETUP.md` phase 1, which is the right design and was never built: `{id, type, author, device, prev, ts, payload_cid, sig}`. Every ride, order, post, vote, message, follow, listing is an event.
- **store**: SQLite (already on both mobiles and in the chain) with CRDT-merged materialised views per domain. Mobile keeps Room/CoreData out; the Rust store is the store.
- **sync**: per-user log replication between the user's own devices (iroh direct) and to nodes the user chooses (home nodes), with outbox/inbox semantics so everything works offline.
- **content**: CID computation (UnixFS raw-leaves, CIDv1) so every app produces the same CID for the same bytes. Today Helia and Kubo produce different CIDs for the same release tarball; the incident report in this repo documents that.
- **policy**: the money-movement confirmation gate and biometric rule that mobile already implements, moved to the shared layer so desktop gets the same rule.

Why Rust and not TypeScript: it binds natively into Kotlin, Swift and Tauri; iroh and the IPFS stack are Rust; the chain remnant worth keeping (secp256k1/P-256 signing) is trivial in Rust. [Likely: UniFFI bindings for Kotlin/Swift cost ~2 weeks once; it is the standard path.]

### Transport

- **iroh** for device-to-device and device-to-node streams. 1.0 shipped June 2026, bindings for Android/iOS/Kotlin exist, dials by public key, handles NAT and relays. You run the relays (they are stateless and cheap). Sources: iroh.computer blog "The road to iroh 1.0", `iroh_flutter` 1.0.1 on pub.dev.
- **IPFS** stays for content: Kubo on desktop and nodes (the Tauri app already manages a Kubo binary); mobile does not run a full IPFS node, it fetches via its home node or any gateway and verifies the CID locally. Helia stays only inside the web page at bucks.global.
- **No public bootstrap by default.** Bucks nodes are the bootstrap list, signed and shipped in the app, overridable.

### Nodes replace Supabase, Firebase, Railway and Vercel one role at a time

The mobile app's ~120 Supabase RPCs are the real business logic of Bucks. They do not need to be thrown away. They need a different host and a different identity column:

1. Package the current Postgres schema + RPCs as the **dispatch/commerce module of the Bucks node** (Postgres is fine; it is open source and runs anywhere). This is a repackaging, not a rewrite.
2. Replace `auth_uid = Firebase uid` with `auth_uid = Bucks ID`, verified by a signed challenge instead of a Firebase JWT.
3. Replace FCM with UnifiedPush (ntfy, self-hosted) on Android; APNs stays on iOS because Apple allows nothing else (see `04-sovereignty-map.md`).
4. Make nodes **federated by locality**: one node can serve Bengaluru; another community can run Kochi; a user's Bucks ID works on all of them because the ID is not issued by the node. This is the Matrix/Mastodon shape and it is the honest answer to "ride dispatch needs a coordinator with a geo index": it does, and it should be a coordinator anyone can run, not a pure DHT.

### AI

Local first, by default, with no cloud default:

- Desktop: llama.cpp via the existing `node-llama-cpp`/`llama-cpp-python` path, or Ollama if installed. The Electron app already has this ("edge" provider); it is just not the default.
- Mobile: the deterministic rule grammar already in `ai/Intent.kt` stays first; small on-device model (Qwen2.5-0.5B/1.5B GGUF) replaces the Gemini fallback. The Gemini key currently ships inside the APK.
- **Inference nodes**: a Bucks node with a GPU can advertise an OpenAI-compatible endpoint; the user picks one (a friend's, a community's, yours). NIM/Lightning become "bring your own key" options, never defaults, and never silently.

### The "Soul"

The tarball's Soul Engine prefixes every LLM call with a constitution derived from the Quran and only trusts peers whose frozen-memory hash matches. Two consequences you should decide with eyes open:

- Technically, it makes a text hash the network admission rule. Every time the constitution text changes, the whole network partitions. [Certain from `p2p/` trust check]
- Product-wise, it makes a religious text a precondition for joining a network described as "every user, one global ID". That contradicts the global goal.

Recommendation: keep "Soul" as the agent's persona/values layer, user-selectable and versioned, and make network trust depend on signatures and the invite tree only. The invite tree (`cluster-membership.js`) is a good admission mechanism; the hash match is not.

## 2.3 Data ownership model

- A user's data is their event log. It lives on their devices first, replicated to nodes they choose.
- Nodes hold copies and indexes; they are replaceable. Leaving a node means pointing your ID at another one. This is the single property that makes "not dependent on any conglomerate" true at the user level, not just at the operator level.
- Public content (posts, listings) is content-addressed on IPFS and pinned by the author's node(s); private content (messages) never touches IPFS unencrypted.
- Money: UPI QR and cash on delivery today (mobile). That stays. No Bucks token until there is a reason (ADR 0001).

## 2.4 What this is not

- Not a new L1. Not an EVM. Not a token launch.
- Not a full rewrite of mobile. Mobile is the best code you have; it gets a core library underneath it and a different backend host.
- Not Tauri-mobile. Native mobile stays (ADR 0003).
- Not an ideology-gated network.

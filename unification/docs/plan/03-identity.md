# 03. Identity: one Bucks ID per person, globally

## 3.1 The constraint and the trap

You asked for "every user will have one UUID globally". The trap is that a UUID by itself is just a random number: someone has to issue it, and whoever issues it owns the users. Firebase issues the mobile uid today. The Bucks-global server issues DIDs and even holds the private keys. Both are the dependency you want to remove.

The fix is a UUID that nobody issues: **derive it from the user's own first key event, so the ID is self-certifying, and keep it stable across key rotation.** This is what AT Protocol's `did:plc` and KERI do; the only Bucks-specific choice is to present the result in UUID form so every existing `uuid` column, QR code and short code keeps working.

## 3.2 Specification (normative)

### Keys

| Key | Algorithm | Where it lives | Purpose |
|---|---|---|---|
| **Root (rotation) keys**, 1 to 3 | P-256 (ES256) or secp256k1 | Hardware-backed where possible: Android Keystore/StrongBox, iOS Secure Enclave, desktop OS keychain or a YubiKey. One of them is a paper/mnemonic backup | Sign identity-log operations only. Never used for app traffic |
| **Device keys**, one per install | P-256 | Hardware-backed on mobile (this is exactly the key mobile already generates in `Identity.kt` / `Identity.swift`) | Sign events, authenticate to nodes, open iroh connections |
| **Messaging keys** | X25519 (+ ML-KEM-768 optional) | Device | Double-ratchet sessions; the Electron `signal-store.js` design survives, minus the plaintext fallback |
| **Wallet key** (optional) | secp256k1 | Device or hardware wallet | Only if/when money moves on a ledger; bound to the ID by a signed `wallet_bind` operation |

P-256 is the only curve hardware-backed on both Android and iOS (Apple's Secure Enclave is P-256 only; Android Ed25519 support is software on most devices). `did:plc` also restricts rotation keys to P-256 and secp256k1, so staying inside that set keeps a later migration or bridge to the AT Protocol ecosystem possible. [Certain for Apple; Likely for Android hardware coverage]

### Inception and the Bucks ID

1. The client creates the first root key(s) and the first device key locally.
2. It builds an **inception operation**:
   ```
   {
     "type": "bucks/identity/inception",
     "v": 1,
     "rotation_keys": ["did:key:zDn...", "did:key:zDn..."],   // priority order
     "devices": [{ "id": "<device-uuid>", "key": "did:key:zDn...", "name": "Pixel 9", "caps": ["sign","message"] }],
     "handle": "shafeeq",                                      // optional, not unique globally
     "services": { "home": ["https://node.bucks.global"] },    // user-chosen nodes
     "prev": null,
     "sig": "<ES256 signature by a rotation key>"
   }
   ```
3. Canonicalise with deterministic CBOR (DAG-CBOR subset: shortest-form integers, text-keyed maps ordered by encoded key length then bytes, no floats or tags). The decoder rejects anything that is not byte-identical to its own re-encoding, so each operation has exactly one valid wire form.
4. **Bucks ID = UUID formed from `blake3(cbor(inception without sig and without signer))`**: take the first 128 bits, set the version nibble to `8` (RFC 9562 custom format) and the variant bits to `10`. Hashing the *unsigned* body matters: ECDSA signatures are malleable, so an ID that included the signature could be changed by a third party without the key. The implementation also rejects high-S signatures. Result looks like `3f9a6c2e-1b47-8d3c-9e21-7a4b0c5d8e1f`.
5. DID form: `did:bucks:3f9a6c2e-1b47-8d3c-9e21-7a4b0c5d8e1f`. Short code: the existing 8-character Crockford base32 from mobile, now derived as `base32(blake3(bucks_id))[0:8]` so every app computes the same code. QR payload: `bucks:<uuid>`.

Properties this buys, each one directly answering a requirement:

- **Global and unique** without an issuer: collision needs a blake3 collision.
- **Stable** across key rotation, device loss and node moves, because the ID is the hash of the *first* event, not of any key.
- **Fits every existing system**: Postgres `uuid`, Kotlin `UUID`, Swift `UUID`, the mobile `profiles.id`, QR scanners.
- **Verifiable offline**: anyone holding the log can check that the current keys descend from the inception by a valid signature chain.

### The identity log

Every later change is an operation signed by a rotation key, pointing at `prev` (the CID of the last operation): add/remove device, rotate root keys, change handle, change home nodes, bind wallet, set recovery. The ordered list is the user's **identity log**.

Where the log lives:

- On the user's devices (always).
- On the user's home node(s) (the `services.home` list).
- On any Bucks node that mirrors the **identity directory**: an append-only, gossip-replicated set of logs keyed by Bucks ID. Nodes verify every operation before storing it; a bad operation is simply dropped. This is the `did:plc` directory model without the single operator: there is no plc.directory, there are N nodes and the client accepts the longest valid chain.
- Later, optional: anchor the directory's Merkle root to Bitcoin via OpenTimestamps daily, so nobody (including you) can rewrite history. No own chain needed.

Resolution: `GET /id/<uuid>` on any node returns the log; the client verifies it locally. Mobile today only needs this to turn a scanned QR into a public key.

### Multi-device

Linking a phone and a laptop is `add_device` signed by a rotation key the user holds on the first device. The flow the user sees: scan a QR on device B with device A, approve with biometrics. Device B's key is now in the log and every node and peer accepts its signatures. This replaces three different things that exist now: mobile's "Settings → Devices JSON export", Electron's mutual `devicelink|from|to|ts` attestations, and the Bucks-global `POST /api/users` DID re-binding (which anyone can do and must be removed).

Device sync (data, not identity) runs over iroh between keys listed in the log; the Electron `device-sync.js` idea of syncing pins and follows generalises to syncing the whole event log.

### Rotation and recovery

- **Pre-rotation**: the inception lists 2 to 3 rotation keys in priority order. Losing the phone is `rotate` signed by the backup key. The 72-hour window in which a higher-priority key can override a lower one, from `did:plc`, is adopted as is.
- **Social recovery**: the Bucks-global guardians + Shamir idea stays, but the shares are made **on the client** from a rotation key and sent to guardians over end-to-end messaging. The server never sees a secret. Today's `/api/recovery/*` does it backwards and must go.
- **Mnemonic**: standard BIP-39 English (and the user's language where a vetted list exists) for the paper backup key. "BIP-8192" is retired: its wordlist cannot load and its checksum cannot round-trip.

### Verification levels (what mobile calls PHONE / DEVICE / DOCUMENT / COMMUNITY)

These become **attestations in the log**, signed by someone other than the user:

- `device_attested`: hardware key attestation (Android Key Attestation, Apple App Attest) verified by a node and countersigned. Replaces the `deviceLooksGenuine()` heuristic.
- `phone_verified`: a node that did an OTP countersigns. The phone number itself never goes in the log, only the hash of a salted number.
- `community_vouched`: the existing in-person recommendation rule (7 recommendations within 3 km) produces signed vouches from other Bucks IDs. This is the invite tree from the Electron app and the `recommendations` table from mobile, unified.
- `document_verified`: a KYC partner's signature, if and when one is integrated.

Nodes and apps then compute the same trust "Lenses" mobile already has, from the same signed facts.

## 3.2a Implementation status

Implemented in `core/bucks-core` with 8 tests and cross-implementation vectors in `protocol/test-vectors/identity-v1.json`: inception, `add_device`, `remove_device`, `rotate_keys`, ID derivation, short code, `did:key` for P-256, canonical encoding, full-log verification, low-S enforcement, and the signed **event envelope** (`core/bucks-core/src/event.rs`, vectors in `protocol/test-vectors/events-v1.json`).

Event rules: authored by a Bucks ID, signed by one of its device keys, chained per device by `seq` and `prev`, with `ctx` recording the identity-log position the signer had seen. An event verifies only if its device was authorised at `ctx` **and is still authorised in the latest state**. This is deliberately strict: events from a device that was later removed stop verifying, because without trusted timestamps a stolen-then-removed device could backdate events. The cost is that history signed by retired devices needs an archival policy (for example, a removal op that carries an explicit cutoff). That is an open design question, not a solved one.

Not implemented yet, and the spec above is ahead of the code on these: the 72-hour higher-priority override window (needs trusted timestamps from the directory), `set_services`/handle ops, attestation entries, social-recovery shares, the directory gossip, UniFFI bindings, and hardware-backed `OpSigner` implementations for Android Keystore and the Secure Enclave. Until the override window exists, **any** current rotation key can rotate all others, so a stolen backup key is as powerful as the primary. Treat that as a known gap, not a feature.

## 3.3 Migration from what exists

| Today | Becomes | How |
|---|---|---|
| Mobile `profiles.id` (uuid_v7) | Bucks ID | New column `bucks_id uuid unique`; backfill by having each logged-in device perform inception and post the log; `auth_uid` switches from Firebase uid to Bucks ID; RPCs read `me()` from a signed challenge instead of a JWT |
| Mobile device key (P-256, Keystore) | The first device key in the log | No new key needed; it is already there |
| Mobile `short_code` | Derived from Bucks ID | Regenerate once; old codes map in a table for a year |
| Bucks-global `did:key` + `uuid7` + PeerId | Bucks ID; the Ed25519 key becomes a device key if the user still has it client-side; server-held keys are **revoked**, not migrated | Users re-create identity; the existing social data is small |
| Electron `did:bucks:<hex>` soul | Bucks ID; the soul key becomes a device key via `add_device` | One-time migration in the app |
| Tauri stub DID | Dropped | |
| Wallet secp256k1 | Optional `wallet_bind` operation | Only when a ledger exists |
| libp2p PeerId / iroh node id | Per-device transport keys, listed in the device entry | Not an identity |

## 3.4 Non-goals

- Global unique handles/usernames. Handles are hints; the UUID is the identity. A name registry is a market and a governance problem; defer it.
- Putting personal data in the log. Keys, devices, services, attestations only.
- Making the ID human-memorable. The short code and QR cover that.

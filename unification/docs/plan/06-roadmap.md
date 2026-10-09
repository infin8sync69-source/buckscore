# 06. Roadmap: bit by bit

Each phase ships something users can touch and leaves the previous things working. Estimates assume 1-2 engineers plus you; they are [Guessing] by nature and should be re-cut after phase 0.

## Phase 0 — Stop the bleeding (1 week)

See `07-security-triage.md`. Rotate secrets, take down custodial-key endpoints, remove the NIM default, fix the installer. **Exit:** no live secret in any public repo; `curl -fsSL https://bucks.global/install | bash` works on a clean macOS and Linux machine.

## Phase 1 — Identity core and monorepo (6-8 weeks)

- `core/bucks-core`: Bucks ID inception, identity log, device add/rotate, event envelope, SQLite store, CID rules. `bucks-cli` to exercise it. Test vectors committed in `protocol/`.
- `bucks-ffi` → Kotlin and Swift. Mobile replaces `Identity.kt`/`Identity.swift` internals with core calls (same public API, so no screen changes).
- Mobile: `bucks_id` column, inception on first login, log posted to Supabase (still Supabase; the node does not exist yet), QR/short code from Bucks ID.
- Desktop (Tauri): login screen does inception or `add_device` by scanning the phone's QR. The stub DID goes away.
- Monorepo created per `05`. Secrets purged, old repos archived.
- Site: fonts bundled, identity route deleted, DNSLink published, static site also served from one Bucks node (phase 2 ships the node; a plain Caddy box is fine here).

**Exit:** the same person has one Bucks ID visible on their phone and their desktop, each device holds its own hardware-backed key, and a third party can verify both signatures from the log alone.

## Phase 2 — Desktop convergence and sovereign releases (6-10 weeks)

- Port Electron "Bucks Core" features into the Tauri app in this order: Soul Engine chat with **local** model default → agent browser control → messages (Double Ratchet over iroh, keys from the log, no plaintext fallback) → app launcher → universe/map. Drop: NIM panel as default, the fake chain contracts, orphan modules, `kill -9` supervisors, home-wide file access (scoped to a Bucks folder, user-grantable).
- Rust side owns IPFS (managed Kubo, as now) and iroh. The Python Soul Engine is retained as a sidecar for phase 2 and moved to Rust-called processes with a token-authenticated localhost API; MCP server bound with a per-launch token.
- Release pipeline per `05 §5.3`: signed, pinned, three OS builds, in-app updater enabled with your release public key.
- `bucks-node` v0: relay + identity directory + pin service + web gateway. Deploy two (your VPS, your desktop). Bootstrap list signed into the apps.

**Exit:** a Windows or Linux user can install Bucks from bucks.global, get the same app as macOS, chat with a local model offline, message a phone user end-to-end, and the release they downloaded resolves from a Bucks node without any public gateway.

## Phase 3 — Nodes replace Supabase and Firebase (8-12 weeks)

- `bucks-node` gains the dispatch/commerce/social module: the existing Postgres schema + RPCs, with `auth_uid` = Bucks ID and signed-challenge auth. Realtime over iroh streams. Storage on the node's IPFS.
- Mobile cloud mode points at a node URL (user-selectable; default from the signed bootstrap list). Supabase project becomes one more node host during cutover, then is retired.
- Push: ntfy/UnifiedPush on the node for Android; APNs wake-only for iOS.
- Attestations: Android Key Attestation and App Attest verified by nodes → `device_attested`; the recommendation rule → `community_vouched`.
- Mobile removes the Gemini key; on-device intent model.

**Exit:** a fresh node run by someone else (a community in another city) serves rides, orders, chat and feed to Bucks users with no Supabase, no Firebase, no Google key anywhere in the build.

## Phase 4 — Federation and local-first data (ongoing)

- User event log is the source of truth on devices; nodes become replicas and indexes. Moving home node = one `services` operation.
- Node-to-node federation for feed and discovery (locality topics from the phased plan: `/bucks/providers/{locality}/{category}` etc.).
- Self-hosted tiles/geocoding/routing for India regions; model mirrors on IPFS; Forgejo + Woodpecker mirror; OpenTimestamps anchoring of the directory root.
- Desktop "become a node" toggle.

## Phase 5 — Economy, only with a reason (not scheduled)

Revisit ADR 0001 when there is a concrete need a signed receipt cannot meet (cross-node escrow, staking for dispatch slashing). If so: Cosmos SDK or an existing L2, never the C++ chain. Until then, UPI and cash.

## Cross-cutting, every phase

- Tests before ports: the Android app has zero unit tests today; core gets them from day one and mobile gets contract tests against core.
- Docs that match code: delete the claims in `ARCHITECTURE.md`/`NEXT_STEPS.md`/`PUBLISHING.md` that the audit found false; keep the style of `IMPLEMENTATION_COMPLETE.md`.
- Privacy policy, terms and moderation/reporting (mobile `LAUNCH_READINESS` P0-2/3) are still unbuilt and gate any store release.

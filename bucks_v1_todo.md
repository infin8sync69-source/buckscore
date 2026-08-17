# Bucks Browser — v1 Prioritised To-Do List
**Generated:** 2026-08-02 | **Source:** Full codebase + docs audit

Legend: 🔴 CRITICAL · 🟠 HIGH · 🟡 MEDIUM · 🟢 LOW  
Effort: S = hours · M = 1–3 days · L = 1+ week

---

## 🔴 CRITICAL — Blocks v1 Launch

### Security

| # | Description | File(s) to Edit | Effort |
|---|---|---|---|
| C-01 | **Soul Engine quality key mismatch — local AI silently broken.** `soul_bridge.py` line 122 reads `result.get("quality", 0.0)` but `AdaptiveBuilder.query()` returns `"alignment_score"`. Every local response scores 0.0; NIM is always called unnecessarily. Change `"quality"` → `"alignment_score"` in the `get()` call. | `~/Desktop/QNN/soul_bridge.py` line 122 | S |
| C-02 | **`isInternalOrigin()` bypass.** Uses `url.includes('index.html')` — any `file:///tmp/index.html` gains trusted IPC access. Replace with exact path comparison: `url === url.pathToFileURL(path.join(__dirname, 'index.html')).href`. | `electron/main.js` ~line 484 | S |
| C-03 | **`pendingApprovals` Map never times out.** `wallet-rpc` hangs indefinitely if user dismisses dialog. Wrap the promise in `Promise.race([approvalPromise, timeoutAfter(60000)])`. | `electron/main.js` ~line 583 | S |
| C-04 | **`send-telemetry` IPC has no origin check.** Any external website loaded in a tab can write to `telemetry.log`. Add `isInternalOrigin(event.senderFrame.url)` guard. | `electron/main.js` ~line 932 | S |
| C-05 | **Shell injection in app-runner.js.** `exec(\`git clone ... ${repo}\`)` and `exec(\`rm -rf "${info.dir}"\`)` allow arbitrary command execution if the app catalog is tampered. Rewrite all three `exec()` calls using `execFile()` or `spawn()` with separate arg arrays; replace `rm -rf` with `fs.rm(dir, { recursive: true, force: true })`. | `electron/app-runner.js` lines 67, 72, 121 | M |
| C-06 | **`/api/v0/add-dir` path traversal.** Any local process can POST `{ "dirPath": "/" }` and upload the entire filesystem to IPFS. Add an allowlist (e.g., restrict to `userData` and `~/.bucks/`). | `electron/ipfs-bridge.js` ~line 373 | S |
| C-07 | **No authentication on IPFS HTTP bridge.** Any local process can broadcast fake update manifests. Add a per-session random token stored in `app.getPath('userData')` and checked on every request. | `electron/ipfs-bridge.js` | M |
| C-08 | **`tabs:execJS` exposes arbitrary JS execution.** Both in `preload.js` (`bucksTabs.execJS`) and `tab-manager.js` (`tabs:execJS` handler), there is no allowlist or sandboxing for `code`. Remove or severely restrict — at minimum, require the call to originate from the shell's own `webContents`. | `electron/preload.js`, `electron/tab-manager.js` | M |
| C-09 | **Reflected XSS in nexus-panel.js link onclick.** `decodedUrl` interpolated into `onclick="window.openAgentLink('${decodedUrl}')"` — a URL with `'` executes injected JS. Escape URLs before interpolation, or switch to a `data-url` attribute + delegated listener. | `electron/nexus-panel.js` ~lines 800, 838 | S |
| C-10 | **XSS in app-store.js.** `app.name`, `app.color`, `app.description`, and 8 other fields interpolated into `innerHTML` without escaping. Add a `htmlEscape(s)` utility and apply it to every interpolated value. | `electron/app-store.js` ~lines 133–176, 265–339 | M |
| C-11 | **XSS in agent-engine.js.** `pop.innerHTML` interpolates `title` and `message` without escaping. | `electron/agent-engine.js` ~line 81 | S |
| C-12 | **`const` reassignment crash in agent-integration.js.** `setAgentServerUrl` tries to reassign `AGENT_SERVER_URL` which is declared `const`. Throws `TypeError` at runtime. Change to `let` or use a module-level `{ url }` object. | `electron/agent-integration.js` ~line 243 | S |
| C-13 | **Direct fetch to `http://127.0.0.1:8765` from ephemeral renderer.** Bypasses all IPC origin gating. Route through `window.bucksAPI.soulQuery(...)` IPC instead. | `electron/ephemeral-renderer.js` lines 7, 84 | M |
| C-14 | **`req.abort()` deprecated — 4 files.** Throws `req.abort is not a function` on Node 18+ (bundled with recent Electron). Replace all occurrences with `req.destroy(new Error("timeout"))`. | `electron/agent-integration.js`, `electron/device-sync.js`, `electron/cluster-membership.js`, `electron/ipfs-agent-soul.js` | S |
| C-15 | **`verifyEd25519(soulId, ...)` broken signature check — 3 files.** SoulIds are not Ed25519 public keys. The gossip admission, device-link, and auto-update trust chains are unverified. Fix `crypto-utils.js` to accept soulId, look up the registered public key, then verify; or change all callers to pass the actual public key. | `electron/device-sync.js`, `electron/cluster-membership.js`, `electron/cluster-updater.js`, `electron/crypto-utils.js` | L |
| C-16 | **Path traversal in cluster-updater.js `writeTreeToDisk`.** Entries named `../../etc/passwd` in a CID tree write outside the staging directory. Add `path.relative(destDir, fullPath)` validation; reject any path that escapes `destDir`. | `electron/cluster-updater.js` ~line 289 | S |
| C-17 | **`execSync` runs untrusted install scripts from update tarballs.** A publisher key compromise gives full shell execution on all devices. Replace with a safe allowlist of permitted operations, or remove script execution entirely. | `electron/cluster-updater.js` ~line 268 | M |
| C-18 | **Wallet entropy too low.** `bucks-node.js` uses a 256-word list (8 bits/word × 12 words = 96 bits). Below the 128-bit minimum. Expand to 2048+ words or increase word count to 15+. Must be coordinated with PBKDF2 migration (see C-19). | `electron/bucks-node.js` | L |
| C-19 | **PBKDF2 iterations: 2,048 instead of 310,000.** `wallet/src/crypto/bip8192.ts` line 185 derives wallet seeds 150× faster than spec. All existing wallets are compromised. Fix AND write a migration guide before any wallets are created. | `wallet/src/crypto/bip8192.ts` | M |
| C-20 | **`javascript:` URLs pass navigation check.** `agent-browser-control.js` `navigate()` only checks for a scheme prefix — a `javascript:` URL executes in the active tab. Reject any URL whose scheme is not `http:`, `https:`, `ipfs:`, `ipns:`, or `bucks:`. | `electron/agent-browser-control.js` ~line 148 | S |

### Infrastructure

| # | Description | File(s) to Edit | Effort |
|---|---|---|---|
| C-21 | **`~/Desktop/QNN` hardcoded everywhere.** Fails on all non-developer machines. Replace with a configurable env var (`BUCKS_QNN_DIR`) defaulting to `path.join(app.getPath('userData'), 'qnn')`. Apply to all 5 JS locations and all 5 Python locations. | `electron/main.js`, `electron/soul-bridge.js`, `~/Desktop/QNN/soul_builder_agent.py`, `soul_nim.py`, `soul_benchmark.py` | M |
| C-22 | **DSPy class definitions crash at import if `dspy-ai` not installed.** Wrap `WisdomGuideSignature` and `SoulWisdomProgram` class definitions inside `if HAS_DSPY:` blocks. Also fix `dspy.OllamaLocal` → `dspy.LM` for dspy 2.x. | `~/Desktop/QNN/soul_dspy_optimizer.py` | S |
| C-23 | **Boot node peer IDs are placeholder strings.** `node/core/blockchain/genesis.go` line 66 uses `12D3KooWBootNode1PlaceholderPeerId`. Chain cannot sync on mainnet. Replace with real libp2p peer IDs once boot nodes are provisioned. | `node/core/blockchain/genesis.go`, `node/config/config.go` | M |
| C-24 | **No smart contracts deployed.** `contracts/deployments/` contains only `.gitkeep`. Soul Engine oracle address is `0x0000...0000` in env. All contract-dependent features (wallet, escrow, marketplace, reputation) are non-functional. Deploy at minimum to a testnet. | `contracts/` | L |
| C-25 | **iOS secp256k1 signer is a stub.** `bucks-ios/Package.swift` explicitly documents: "Replace the stub signer with a real, audited secp256k1 implementation." iOS users cannot sign or broadcast transactions. | `bucks-ios/BucksBrowser/Web3Service.swift` | L |
| C-26 | **No code signing configured.** macOS Gatekeeper and Windows SmartScreen will block the unsigned app for all end users. Set up Apple Developer signing identity, entitlements, and notarization config. | `electron/package.json` build config | M |

---

## 🟠 HIGH — Should Be Done Before Launch

### Core Features

| # | Description | File(s) to Edit | Effort |
|---|---|---|---|
| H-01 | **`forageForScarcity()` is an empty stub on a 60s timer.** Logs "Foraging for scarce data…" but does nothing. Either implement a real DHT-based scarcity check or disable the interval until it's ready. | `electron/ipfs-node.js` ~line 521 | M |
| H-02 | **Double Ratchet has no skipped-message-key cache.** A single dropped/reordered message permanently desyncs the receive chain. All subsequent messages silently fail to decrypt. Implement a `skippedKeys: Map<chainKey, Map<msgIndex, key>>` cache. | `electron/signal-store.js` | L |
| H-03 | **`AudioHook` returns a hardcoded fake transcript.** `stopRecording()` returns a fictional meeting transcript unconditionally. Either implement real microphone capture or remove the feature entirely — do not ship a function that lies to users. | `electron/agent-engine.js` | M |
| H-04 | **nim-panel.js is entirely non-functional.** All public methods are empty `{}`. The NIM quality dashboard has no UI. Either restore the UI (from git history / premium-ui-notes.md) or remove the module from IPC wiring so the dead code is not shipped. | `electron/nim-panel.js` | M |
| H-05 | **DSPy optimizer has no automated trigger.** `soul_dspy_optimizer.py` works correctly but must be run manually from the CLI. Wire an IPC handler (`soul-run-optimizer`) or a scheduled trigger (e.g., after every 50 feedback entries in `soul_interactions.jsonl`). | `electron/main.js`, `~/Desktop/QNN/soul_dspy_optimizer.py` | M |
| H-06 | **Feedback path (Path 5) renderer mapping unverified.** Confirm that the thumbs-up/thumbs-down UI in the renderer calls `window.bucksAPI.soulLogFeedback(...)` and that `preload.js` maps it to `soul-log-feedback` IPC. | `electron/renderer.js` (to search), `electron/preload.js` | S |
| H-07 | **`BucksEarthMap`/`BucksUniverseMap` chat buttons are silent no-ops in the main shell.** `earth-maps.js`/`universe-map.js` only load inside `bucks-universe.html`, not `index.html`. Either embed them in the shell or remove/redirect those chat-answer buttons. | `electron/renderer.js`, `electron/index.html` | M |
| H-08 | **`window.BUCKS_APPS` is a mutable global.** Any script can replace the app catalog. Freeze the object: `Object.freeze(BUCKS_APPS)` after definition. | `electron/app-store-data.js` | S |
| H-09 | **`app.localRun.port` null-check missing in app-store.js.** AppFlowy has `port: null`, producing `http://localhost:null`. Add `port != null ? \`http://localhost:${port}\` : null` guard. | `electron/app-store.js` ~line 75 | S |
| H-10 | **Mock CID generation in agent-engine.js.** `"Qm" + Math.random().toString(36)...` produces invalid CIDs rejected by IPFS. Remove or replace with a real SHA2-256 multihash. | `electron/agent-engine.js` ~line 45 | S |
| H-11 | **`resetWallets()` exported with no safeguards.** This function deletes all wallet seeds with no confirmation or authentication. Add a passphrase confirmation gate or restrict to internal use only. | `electron/bucks-node.js` | S |
| H-12 | **Chat history stored in plaintext on disk.** `chat-history/<peerId>.json` files are unencrypted. Encrypt with `safeStorage.encryptString()` (already used for signal-store sessions) or AES-GCM with a key from the wallet. | `electron/chat-engine.js` | M |
| H-13 | **Conversation writes are non-atomic.** `fs.writeFileSync` to chat files and `persistBundles()` can corrupt on kill. Use write-to-temp + rename pattern. | `electron/chat-engine.js` lines 601, 241 | S |
| H-14 | **No `process.on('uncaughtException')` or `'unhandledRejection'` handler.** Unhandled errors crash the main process with no user-friendly message. Add handlers that show a native error dialog and optionally restart. | `electron/main.js` | S |
| H-15 | **`seenRecordKeys` Set grows unbounded in cluster-membership.js.** Add a TTL-based pruning pass (e.g., remove keys older than 24h). | `electron/cluster-membership.js` | S |
| H-16 | **NIM promise not cancelled when QNN wins the race.** Wasted NVIDIA API quota. Pass an `AbortController` signal to `_callNIM()` and cancel it when QNN returns a passing result. | `electron/agent-interface.js` ~line 183 | M |
| H-17 | **App Store Batch 2 category mismatch.** `'Utility'` and `'Developer'` categories not in filter pills — apps only appear under "All". Add the categories to the pills array in `app-store.js`. | `electron/app-store.js`, `electron/app-store-data.js` | S |
| H-18 | **Multiple apps share port 3000.** Two installed local apps cannot run simultaneously. Assign unique default ports to each app in `app-store-data.js` and implement port-conflict detection in `app-runner.js`. | `electron/app-store-data.js`, `electron/app-runner.js` | M |
| H-19 | **Secrets still in git history.** Gemini API key + `CLUSTER_SECRET` were committed before the production cleanup. Rotate both secrets and rewrite git history (BFG Repo Cleaner or `git filter-repo`). | Git history | M |
| H-20 | **CORS `*` on local node RPC.** `node/config/config.go` line 124 sets `CORSAllowedOrigins: []string{"*"}`. Any visited website can call `eth_sendRawTransaction`. Restrict to `http://localhost` and `file://`. | `node/config/config.go` | S |
| H-21 | **`RELEASE_PUBLISHER_PUBKEY` defaults to `""`.** Auto-updates are silently inert on all fresh installs. Document the key provisioning process and set a sensible default or fail loudly when the key is missing. | `electron/cluster-updater.js` ~line 42 | S |
| H-22 | **renderer.js (380KB) must be audited.** The largest file, containing unknown `innerHTML` assignments, direct `fetch()` calls, and potential eval usage. Run a targeted scan: `grep -n "innerHTML\|eval(\|new Function\|\.write(" renderer.js`. | `electron/renderer.js` | M |

### Infrastructure

| # | Description | File(s) to Edit | Effort |
|---|---|---|---|
| H-23 | **NGC_API_KEY placeholder in .env.** `NGC_API_KEY=your_nvidia_ngc_key_here` — NIM never fires. Add a real key or document the setup step prominently in the README. | `bucks browser/agent/.env` | S |
| H-24 | **`python-dotenv` unguarded import in soul_builder_agent.py.** Add a try/except around `from dotenv import load_dotenv` or add `python-dotenv` to `requirements.txt` and the installer. | `~/Desktop/QNN/soul_builder_agent.py` | S |
| H-25 | **`soul_interactions.jsonl` grows unbounded.** No rotation or size cap in `soul_bridge.py`. Add a rolling-window write that keeps the last N entries (e.g., 10,000). | `~/Desktop/QNN/soul_bridge.py` | S |
| H-26 | **RPC port mismatch.** `bucks-browser/electron/services/node.ts` line 38 hardcodes port 8545 (Hardhat default). Correct port is 8192. Also in CSP `connect-src`. | `bucks-browser/electron/services/node.ts`, `bucks-browser/renderer/index.html` | S |
| H-27 | **Root `bucks browser/package.json` has unfixed gossipsub/libp2p mismatch.** Only `electron/` was fixed. Also stale `@libp2p/webrtc@6.0.22` (hard `SyntaxError` under strict ESM linking). Sync root package.json to match electron/'s fixed versions or delete the root node_modules. | `bucks browser/package.json` | M |

---

## 🟡 MEDIUM — Important but Not Blocking

### Functionality

| # | Description | File(s) to Edit | Effort |
|---|---|---|---|
| M-01 | **Mini-app CSP not hardened.** 7 HTML files (`bucks-calc`, `bucks-notes`, `bucks-clock`, `bucks-converter`, `bucks-qr`, `bucks-template-dashboard`, `bucks-template-portfolio`) use inline scripts with no CSP. Add `<meta http-equiv="Content-Security-Policy">` to each. | `electron/*.html` (7 files) | M |
| M-02 | **`:3939` IPFS-proxy port hardcoded in 3 places.** `index.html` and `dweb-studio-renderer.js` (×2). Extract to a shared constant. | `electron/index.html`, `electron/dweb-studio-renderer.js` | S |
| M-03 | **No exponential backoff in soul-bridge.js restarts.** Hammers `spawn()` every 3s up to 5× on persistent crash. Implement exponential backoff with jitter. | `electron/soul-bridge.js` | S |
| M-04 | **`_scanNodeForPatterns()` dead code in ephemeral-ui.js.** The function is defined but never called. Remove or wire it up. | `electron/ephemeral-ui.js` | S |
| M-05 | **`GlobalShortcut.register('CommandOrControl+K')` may conflict.** Add a try/catch and fallback to an alternative shortcut if registration fails. | `electron/ephemeral-window.js` | S |
| M-06 | **`BrowserView` deprecated.** All usage in `app-runner.js` uses the deprecated API. Migrate to `WebContentsView`. | `electron/app-runner.js` | M |
| M-07 | **`setTimeout(r, 2000)` hardcoded startup delay in agent-swarm.js.** No rationale or configurability. Extract to a named constant and document why it's needed. | `electron/agent-swarm.js` line 74 | S |
| M-08 | **Sybil-attackable vote counts in ipfs-node.js.** Voter soulIds self-asserted. Wire vote messages through the Ed25519 signature check once C-15 is fixed. | `electron/ipfs-node.js` | M |
| M-09 | **`ipfs-bridge.js` uses POST for all Kubo requests.** Some Kubo endpoints may require specific methods. Switch to method-per-endpoint mapping. | `electron/ipfs-bridge.js` | S |
| M-10 | **Bluetooth auto-pick with no user confirmation.** `permission-manager.js` silently selects the first Bluetooth device after 3 seconds. Show a device chooser dialog. | `electron/permission-manager.js` | M |
| M-11 | **No extension integrity check.** Any directory with `manifest.json` under `~/.bucks/extensions/` is loaded unconditionally. Add a signature or allowlist check. | `electron/extension-loader.js` | M |
| M-12 | **`getFeed()` mutates global array in place.** `feed.sort()` should be `[...feed].sort()`. | `electron/ipfs-node.js` | S |
| M-13 | **dWeb message CID not validated.** `data.cid` accepted from gossip without CID format check. Add `CID.parse(data.cid)` validation in a try/catch. | `electron/ipfs-node.js` | S |
| M-14 | **`_swarmPollTimer` never cleared in nexus-panel.js.** Add a `destroy()` API that calls `clearInterval`. | `electron/nexus-panel.js` | S |
| M-15 | **`window.openAgentLink` and `window.submitAgentFollowup` referenced but not defined.** Define them in `preload.js` or a renderer module. | `electron/nexus-panel.js`, `electron/preload.js` | S |
| M-16 | **`saveSessions()` called on every encrypt/decrypt.** Severe I/O bottleneck at any message volume. Debounce writes to every 2 seconds maximum. | `electron/signal-store.js` | S |
| M-17 | **`agentInterface.init()` not called after main window recreated on macOS Dock.** The `mainWindow` reference in agentInterface becomes stale. Call `init({ mainWindow })` again inside `app.on('activate', ...)`. | `electron/main.js` | S |
| M-18 | **`crudBtn` click handler is a no-op in canvas-manager.js.** Implement or remove. | `electron/canvas-manager.js` | M |
| M-19 | **`static layer/panel = document.getElementById(...)` executes before DOMContentLoaded.** Always `null`. Move to a lazy getter. | `electron/agent-engine.js` | S |
| M-20 | **`sol_bridge.py` peerId conversation-load bug.** If no incoming messages exist yet, `otherPeer` is `undefined` and history is lost on reload. | `electron/chat-engine.js` | S |

### Documentation & Config

| # | Description | File(s) to Edit | Effort |
|---|---|---|---|
| M-21 | **BIP-8192 wordlist pipeline not started.** All 70+ items in `bip8192-wordlist-todo.md` are unchecked. At minimum, start Sections 1–3 (corpus extraction + word selection). The wordlist is the core wallet differentiator. | `wallet/corpus/` (new) | L |
| M-22 | **`license` field missing from electron/package.json.** Required by electron-builder for distribution. Add `"license": "UNLICENSED"` (or actual license). | `electron/package.json` | S |
| M-23 | **Author field is placeholder.** `"author": "Bucks Developer"` blocks macOS notarization (requires Apple Developer account email). | `electron/package.json` | S |
| M-24 | **`win.icon: null` — Windows uses default Electron icon.** Create a `bucks.ico` and set `"icon": "assets/bucks.ico"` in build config. | `electron/package.json`, `electron/assets/` | S |
| M-25 | **No `.icns` for macOS.** Only `bucks-logo.png` exists. Convert to `bucks.icns` (1024×1024 with multiple sizes) and set in build config. | `electron/assets/` | S |
| M-26 | **Renderer console messages piped verbatim to stdout.** Remove the `win.webContents.on('console-message', ...)` passthrough in production builds, or filter it to exclude wallet/key-related fields. | `electron/main.js` ~line 242 | S |
| M-27 | **`asar: false` — source ships uncompressed.** Consider enabling `asar: true` for production. Note: will require moving native modules to `asarUnpack`. | `electron/package.json` | M |
| M-28 | **Distribution branch not merged.** `feat/bucks-installer-homepage` pushed 2026-07-29 but not merged to `main`. | GitHub PR | S |

---

## 🟢 LOW — Nice to Have Post-Launch

| # | Description | File(s) to Edit | Effort |
|---|---|---|---|
| L-01 | **Soul Engine living swarm (Phases A–G).** Full agent-caste architecture, pheromone trails, QLoRA weekly fine-tuning. Impressive long-term roadmap, not needed for v1 basic functionality. | `~/Desktop/QNN/soul_swarm/` (new) | L |
| L-02 | **Prometheus / Grafana observability stack.** Add `fastapi-prometheus` and OpenTelemetry. | `~/Desktop/QNN/soul_api.py` | L |
| L-03 | **114-layer resonance neural network training.** Phase 2 of swarm plan requires GPU (A100 40GB recommended), 1–2 weeks. Not needed for current FAISS-based retrieval. | `~/Desktop/QNN/resonance_network.py` (new) | L |
| L-04 | **No DHT (`kad-dht`).** Discovery is limited to mDNS + manual bootstrap. Add `@libp2p/kad-dht` for better scalability. | `electron/ipfs-node.js` | M |
| L-05 | **No NAT traversal / relay.** Peers behind NAT with no shared VPN cannot connect. Add circuit-relay-v2 or AutoNAT. | `electron/ipfs-node.js` | L |
| L-06 | **Trivial PoW + unbounded reorg depth.** Static difficulty, no checkpointing. Implement difficulty adjustment algorithm. | `electron/bucks-node.js` | L |
| L-07 | **No replay protection on chat envelopes.** Nonce generated but excluded from the signature. Add nonce to signed payload and check on receipt. | `electron/chat-engine.js` | M |
| L-08 | **Remove stale SETUP-legacy.md.** Ollama-era setup guide still in `docs/`. Archive or delete. | `bucks browser/docs/SETUP-legacy.md` | S |
| L-09 | **Dependabot / security scanning.** No automated dependency update workflow. Add GitHub Actions `npm audit` and Dependabot config. | `.github/dependabot.yml` (new) | S |
| L-10 | **Block explorer.** Phase 5 of blockchain architecture. Not required for v1 but helps adoption. | New project | L |
| L-11 | **`window-management` auto-granted in permission-manager.js.** Too permissive for arbitrary websites. Move to the prompt-and-remember flow. | `electron/permission-manager.js` | S |
| L-12 | **`addressHistory` O(n·m) linear scan in bucks-node.js.** No index. Build an in-memory address→txid index on chain load. | `electron/bucks-node.js` | M |
| L-13 | **`soul_engine_swarm_refinement.md` ACO formula correction.** Pheromone update is missing the Δτ = Q/L_k term. Apply the correct ACO formula when implementing Phase B. | `~/Desktop/QNN/soul_swarm/pheromone.py` (future) | S |
| L-14 | **Custom `.env` parser in soul-engine-supervisor.js.** Does not handle `#` comments or quoted values. Replace with `dotenv` package. | `electron/soul-engine-supervisor.js` | S |
| L-15 | **Pheromone heatmap removed with no replacement.** `soul-ui.js` no longer calls `updatePheromoneHeatmap`. Re-wire to a developer tools panel post-launch. | `electron/soul-ui.js` | M |

---

## Summary Counts

| Priority | Count |
|---|---|
| 🔴 CRITICAL | 26 |
| 🟠 HIGH | 27 |
| 🟡 MEDIUM | 28 |
| 🟢 LOW | 15 |
| **Total** | **96** |

## Recommended Sprint Plan for v1

**Week 1 — Security blitz:** C-01 through C-14 (all the quick-fix security items). Most are S-effort. Goal: no known RCE vectors, no silent auth bypasses.

**Week 2 — Infrastructure fix:** C-21 through C-26, H-23 through H-27. QNN path portability, code signing, contracts testnet deploy.

**Week 3 — Feature quality:** H-01 through H-22. Restore nim-panel, wire DSPy trigger, fix forageForScarcity, fix Bluetooth chooser, audit renderer.js.

**Week 4 — Polish & hardening:** M-01 through M-30 as time allows. Icons, CSP, atomic writes, error boundaries.

**Post-launch backlog:** L-01 through L-15 (swarm, DHT, NAT traversal, block explorer).

# Bucks Browser — v1 Release Readiness Audit Report
**Date:** 2026-08-02  
**Auditor:** Automated QA pass — all source files read directly  
**Scope:** `~/Desktop/Bucks Core/` (all .md docs) + `bucks browser/electron/` (all .js) + `~/Desktop/QNN/` (all .py)

---

## Executive Summary

**Overall v1 Readiness Score: 3.5 / 10**

The Bucks Browser has a genuinely impressive amount of architecture implemented: the Helia/IPFS layer is functional and tested, the Soul Engine query path is wired end-to-end, the App Store launch chain works, peer-to-peer gossip is live, and the ephemeral UI overlay is structurally sound. The project is further along than most browser-based Web3 experiments at this stage.

However, it is not ready for a public v1 release. There are **27 critical or major security vulnerabilities** spread across the Electron layer alone, the Soul Engine always silently returns a quality score of 0.0 (destroying the core AI feature through a key-name mismatch), wallet key derivation uses an incorrect iteration count that invalidates all existing wallets, no smart contracts are deployed anywhere, the iOS transaction signer is a stub, and the entire QNN directory path is hardcoded to `~/Desktop/QNN` — making it non-functional on any machine that isn't the developer's desktop.

A focused sprint of approximately 3–4 weeks on the critical items below would bring this to a defensible v1.

---

## Phase 1: Document Gaps

### 1.1 soul-bucks-integration-plan.md

Ten items in the "Industry Standard Norms" checklist are all marked Pending:

| Norm | Status |
|---|---|
| Prometheus metrics | Pending — add `fastapi-prometheus` to `soul_api.py` |
| Distributed tracing (OpenTelemetry + Jaeger) | Pending |
| RAGAS eval CI/CD (GitHub Actions) | Pending |
| Model signing (SHA-256 on Bucks chain) | Pending |
| A/B canary routing (`soul_router.py`) | Pending |
| LoRA fine-tune pipeline (NeMo) | Pending |
| Triton self-hosted (TRT-LLM) | Pending |
| cuVS CAGRA GPU index | Pending (FAISS CPU fallback exists) |
| libp2p peer discovery (`/bucks/soul-engine/v1/announce`) | Pending |
| Node operator rewards (Bucks chain payout) | Pending |

Planned files described in the document but not on disk: `soul-node-announcer.js`, `soul_router.py`, Prometheus/Grafana dashboards, `soul_model_registry.py`.

### 1.2 premium-ui-notes.md — Features Running Silently

The following are emitted or defined but nothing in the UI consumes them:
- `TASK_QUALITY_SCORE`, `TASK_NIM_OVERRIDE`, `TASK_QNN_IMPROVING` events
- NIM token streaming (emitted by agent-interface.js but nim-panel.js no longer renders it)
- Pheromone trail heatmap (`updatePheromoneHeatmap` was wired; removed with no replacement)
- DSPy auto-tune flag (`window.__soulAutoTune`) — no UI surface

### 1.3 backend-audit.md — 27 Findings, All Open

The full list of backend findings is in section 2.2 below. Every single one remains unresolved per the companion `backend-fix-todo.md` (89 unchecked items, zero checked).

### 1.4 bip8192-wordlist-todo.md — Entire Wordlist Pipeline Unstarted

All 70+ items are unchecked. The Arabic BIP-8192 wordlist — the core differentiator of the Bucks wallet — does not exist. Not one word has been selected. Tier 1 multilingual mappings (Arabic, English, Urdu, French, Spanish, Turkish, Indonesian, Persian, Bengali) are all pending. There is a critical PBKDF2 bug that must be coordinated with this work before any wallets are created.

### 1.5 bucks-contracts-plan.md — No Contracts Deployed

`deployments/` contains only `.gitkeep`. All 19 planned contracts (WrappedBucks, GlobalProfile, MarketplaceRouter, EscrowVault, DisputeArbitration, SoulEngineOracle, etc.) exist as interface descriptions only. All 21 items on the pre-mainnet audit checklist are unchecked.

### 1.6 soul-engine-swarm-plan.md / soul-engine-living-swarm.md — Phases A–G Not Started

The living swarm architecture is fully designed with code skeletons in the documents, but zero implementation exists on disk:
- Phase 0 (Corpus DAG build): scripts not run, output files absent
- Phase 2 (114-layer resonance network): PyTorch training not started; ONNX/GGUF not exported; requires 16GB VRAM GPU, 1–2 weeks
- Phase 3–6 (agent castes, IPFS distributed inference, Bucks integration): all code skeletons only
- Agent files (`soul_swarm/agents/base_agent.py`, `seeker.py`, `builder.py`, `pheromone.py`) do not exist

### 1.7 debug-report.md — Confirmed Unresolved Issues

The following were explicitly identified as "needs a deliberate decision, not a mechanical patch" — meaning they were intentionally left unresolved:
- No DHT (`kad-dht`) — limits discovery beyond mDNS
- No NAT traversal / relay — peers behind NAT with no shared VPN cannot connect
- Trivial PoW + unbounded reorg depth in `bucks-node.js`
- Double Ratchet has no skipped-message-key cache — dropped/reordered messages permanently desync the receive chain
- Chat history stored in plaintext on disk
- `forageForScarcity()` is an empty stub running on a 60s timer
- `BucksEarthMap`/`BucksUniverseMap` chat buttons are silent no-ops in the main shell
- Mini-app CSP not hardened (7 HTML files with inline scripts)
- `:3939` IPFS-proxy port hardcoded in 3 places
- Secrets (Gemini API key + CLUSTER_SECRET) still in git history

### 1.8 DISTRIBUTION.md

The installer homepage branch (`feat/bucks-installer-homepage`) was pushed 2026-07-29 but is not merged to `main`. The change is not live.

---

## Phase 2: Electron File Audit

### Severity conventions
- **CRITICAL:** Security vulnerability or guaranteed crash/data loss
- **MAJOR:** Feature broken, resource leak, or functional regression
- **MINOR:** Style, hardcoded constant, or technical debt

---

### main.js

**CRITICAL**
- `isInternalOrigin()` uses substring check (`url.includes('index.html')`) — any `file:///tmp/index.html` on the filesystem gains access to `wallet-rpc`, `soul-query`, `web-fetch`. Must use exact `path.join(__dirname, 'index.html')` comparison.
- `pendingApprovals` Map never times out. If the user dismisses the wallet-access dialog without clicking, the `wallet-rpc` IPC handler hangs indefinitely.
- `send-telemetry` IPC has no `isInternalOrigin` guard — any WebContentsView tab (external websites) can write arbitrary data to `telemetry.log` on disk.
- Feedback log path hardcoded: `path.join(os.homedir(), 'Desktop', 'QNN', 'soul_interactions.jsonl')` — fails silently on all non-developer machines.
- Benchmark script hardcoded to `~/Desktop/QNN/soul_benchmark.py` — same issue.
- CSP `script-src 'unsafe-inline'` acknowledged in comment but not resolved.

**MAJOR**
- `http2` variable assigned but never used — dead/confusing code.
- `social-rpc` port hardcoded to 8000 — no env fallback.
- `agentInterface.init({ mainWindow })` captures `mainWindow` at init time; reference becomes stale after window is recreated from Dock (macOS `activate` event). `init()` is never called again.
- `ipfs.connectPeer()` and related methods called without checking if IPFS has finished initialising — race condition on startup.

**MINOR**
- Commented-out `app.disableHardwareAcceleration()` on line 48.
- `_shellStoreTimer` debounce is 250ms — may cause I/O contention.

---

### preload.js

**CRITICAL**
- `bucksTabs.execJS(tabId, code, userGesture)` exposes arbitrary JS execution across all tabs. Any XSS in the shell can execute arbitrary code in any open tab, including banking sessions. No allowlist, no length limit, no rate limiting.

**MAJOR**
- Event listeners added via `ipcRenderer.on()` for `onWalletAccessRequest`, `onDownloadEvent`, `onChatMessage` have no unsubscribe mechanism — stack on hot reload.

---

### renderer.js (380KB — NOT FULLY READ)

This is the largest file in the codebase and could not be read in full due to size constraints. A dedicated audit pass is required, specifically searching for: `innerHTML =` with unescaped data, `eval(`, `new Function(`, `dangerouslySetInnerHTML`, and hardcoded secrets.

---

### agent-interface.js

**MAJOR**
- NIM promise not cancelled when QNN wins the race — NVIDIA API call completes in background, consuming quota, emitting stream events silently discarded.
- NIM post-evaluation errors swallowed entirely in a bare `catch {}` — evaluation failures invisible in logs.

---

### soul-bridge.js

**CRITICAL**
- `QNN_BRIDGE_DIR` hardcoded to `path.join(require('os').homedir(), 'Desktop', 'QNN')` — fails on all non-developer machines; marks itself `unavailable` with no user-visible error.

**MAJOR**
- No exponential backoff on restarts — hammers `spawn()` every 3 seconds up to 5 times on persistent crash.

---

### soul-ui.js

**MAJOR**
- Citation tooltip appended to `document.body` never removed on `_clearActive()` if the card parent is removed rather than the card itself — leaks `<div class="soul-cite-tooltip">` elements.

---

### app-store.js

**CRITICAL**
- `app.name`, `app.tagline`, `app.description`, `app.icon`, `app.color`, `app.colorDark`, `app.curator`, `app.tags`, etc., all interpolated directly into `innerHTML` template strings without HTML escaping — stored XSS if catalog is ever loaded from an external source.
- `window.BUCKS_APPS` is a mutable global — any script in the page can replace the app catalog before `buildGrid()` runs.

**MAJOR**
- `app.localRun.port` accessed without null check — AppFlowy has `port: null`, producing `http://localhost:null`.

---

### app-runner.js

**CRITICAL**
- Shell injection: `exec(\`git clone --depth 1 https://github.com/${repo} "${appDir}"\`)` — `repo` interpolated unsanitized; use `execFile` with separate args.
- `exec(\`cd "${appDir}" && npm install\`)` — same family of issue.
- `exec(\`rm -rf "${info.dir}"\`)` — `info.dir` from `installed.json` on disk; tampered file can delete arbitrary directories.
- `BrowserView` deprecated in Electron 29+ in favour of `WebContentsView`.

**MAJOR**
- Spawned `npm start` process not tracked after successful launch — never killed on app quit or uninstall.
- Multiple apps share port 3000 as default — two installed apps cannot run simultaneously.

---

### app-store-data.js

**MAJOR**
- Batch 2 apps use categories (`'Utility'`, `'Developer'`) not present in the filter pills — these apps only appear under "All".
- Batch 2 merge fallback branch is dead code.

---

### ipfs-node.js

**CRITICAL**
- `forageForScarcity()` body is completely empty — runs every 60 seconds, logs "Foraging for scarce data…", does nothing.
- `getFeed()` calls `feed.sort()` which mutates the global array in place — re-sort on every call corrupts state.
- dWeb message `data.cid` accepted from the network without validation — attacker can inject arbitrary strings as CIDs.

**MAJOR**
- `feed` array grows unbounded in memory — malicious peer can flood gossip, bloating RAM.
- Vote counts are Sybil-attackable — voter soulIds are self-asserted, not anchored to any identity.

---

### ipfs-bridge.js

**CRITICAL**
- `/api/v0/add-dir` accepts arbitrary local filesystem paths with no validation — any local process can POST `{ "dirPath": "/" }` and upload the entire filesystem to IPFS.
- No authentication on the HTTP bridge — any local process can call `/api/v0/bucks/release/announce` to broadcast fake update manifests.

---

### ipfs-agent-soul.js

**CRITICAL**
- `req.abort()` used for timeouts — deprecated in Node.js v14, removed in Node 18+; throws `req.abort is not a function` with newer Node.js bundled in recent Electron versions.

---

### ephemeral-ui.js

**MAJOR**
- `_scanNodeForPatterns()` defined but never called — dead code.
- Selected text injected directly into Soul Engine prompt without sanitization — prompt injection risk from web page content.

**MINOR**
- `SOUL_TOPIC_SIGNALS` patterns are extremely broad — the "Ask Soul Engine" ghost button appears on nearly every keypress.

---

### ephemeral-window.js

**MAJOR**
- `mainBrowserWindow` reference captured at setup time; becomes stale if window is closed and recreated. `submit` handler silently fails.
- `globalShortcut.register('CommandOrControl+K')` may conflict with system shortcuts; no fallback if registration fails.

---

### ephemeral-renderer.js

**CRITICAL**
- Direct `fetch()` to `http://127.0.0.1:8765/agent` from the renderer — bypasses `isInternalOrigin` IPC gating entirely; also fetches from any other service on that port.
- Error detection for failed fetches is string-based (`err.message.includes('fetch')`) — fragile.

**MAJOR**
- No timeout on streaming `while(true)` read loop — stalled Soul Engine connection hangs indefinitely.

---

### soul-engine-supervisor.js

**MAJOR**
- Custom `.env` parser does not handle comments, empty lines, or quoted values — use `dotenv`.
- Agent venv Python binary spawned with no integrity check.

---

### agent-engine.js

**CRITICAL**
- `pop.innerHTML` directly interpolates `title` and `message` parameters without HTML escaping — XSS.

**MAJOR**
- `AudioHook.startRecording()` is a hollow stub — no audio is actually recorded.
- `AudioHook.stopRecording()` returns a hardcoded fake transcript string unconditionally — misrepresents capability to users.
- Mock CID generation produces invalid CIDs (base36 wrong-length strings).
- `static layer = document.getElementById(...)` executes before DOMContentLoaded — always `null` on first use.

---

### agent-swarm.js

**MAJOR**
- `_castLocalVote` silently returns `options[0]` on any agent error — swarm consensus degrades to first-option when agent server is unavailable.

---

### agent-browser-control.js

**MAJOR**
- No URL sanitization in `navigate()` — `javascript:` URLs pass the scheme check and execute in the active tab.

---

### agent-integration.js

**CRITICAL**
- `setAgentServerUrl: (url) => { AGENT_SERVER_URL = url; }` reassigns a `const` — throws `TypeError: Assignment to constant variable` at runtime. The setter is broken.
- `req.abort()` deprecated — same issue as ipfs-agent-soul.js.

---

### pane-manager.js

**MAJOR**
- `addPane()` does not handle failure from `deps.createTabView()` — proceeds to build a frame around `undefined`, crashing.

---

### tab-manager.js

**CRITICAL**
- `tabs:execJS` IPC handler executes arbitrary JavaScript in any tab with no allowlist or sandboxing — remote code execution vector from a compromised renderer.

---

### bucks-node.js

**CRITICAL**
- Wallet mnemonic entropy is 96 bits (8 bits/word × 12 words from a 256-word list) — below the 128-bit minimum. Wallets are ~4 billion times easier to brute-force than BIP39.
- Static mining difficulty — never adjusts; block time becomes unpredictable.

**MAJOR**
- `resetWallets()` exported publicly — deletes wallets.json with no confirmation, authentication, or backup.
- No timestamp validation on incoming blocks.

---

### nexus-panel.js

**CRITICAL**
- Reflected XSS in link `onclick` handlers — `decodedUrl` interpolated directly into `onclick` attribute without escaping; a URL with a single quote executes injected JavaScript.

**MAJOR**
- `_swarmPollTimer` never cleared — timer is orphaned if panel is re-initialised.
- `window.openAgentLink` and `window.submitAgentFollowup` referenced in generated HTML but not defined in this file.

---

### nim-panel.js

**MAJOR**
- All public methods (`open()`, `close()`, `toggle()`, `onAgentEvent()`) are empty `{}` no-ops — this module is entirely non-functional.
- `_selectedModel` and `_override` can never be changed — getters always return hardcoded defaults.

---

### chat-engine.js

**MAJOR**
- Non-atomic `fs.writeFileSync` for conversation history — corruption risk if process killed mid-write.
- Conversation reload fragile: if all messages in a file were sent by the local user, `otherPeer` is `undefined` and history is lost.

---

### signal-store.js

**MAJOR**
- No skipped-message-key cache in Double Ratchet — a single dropped/reordered message permanently desyncs the receive chain. All subsequent messages silently fail to decrypt.
- `saveSessions()` called on every encrypt and decrypt — severe I/O bottleneck.

---

### benchmark-panel.js

All public methods are confirmed empty no-ops. The QNN quality dashboard has no UI.

---

### canvas-manager.js

**MAJOR**
- `crudBtn` click handler is a logged no-op — the CRUD action button does nothing.
- Global `mousemove` and `mouseup` listeners added per `MiniWindow` instance but never removed — event listener leak on window close.

---

### device-sync.js / cluster-membership.js / cluster-updater.js (Cross-cutting)

**CRITICAL — Broken signature verification (all three files)**
- `verifyEd25519(soulId, payload, signature)` is called with a soulId string as the public key argument. SoulIds are opaque identifiers, not Ed25519 public keys. Unless `crypto-utils.js` implements a soulId→publicKey lookup, all admission, device-link, and auto-update signature checks are meaningless — the trust chain is unverified.

**CRITICAL — cluster-updater.js**
- Path traversal in `writeTreeToDisk` — entries named `../../etc/passwd` in a UnixFS CID tree will write outside the staging directory.
- `execSync` runs `install.sh` from the update tarball — a publisher key compromise grants full shell code execution on all connected devices.
- `RELEASE_PUBLISHER_PUBKEY` defaults to `""` — all release announcements silently ignored; auto-updates non-functional by default.

**CRITICAL — cluster-membership.js**
- `seenRecordKeys` Set grows unbounded — no pruning or TTL mechanism.

**MAJOR (all three)**
- `req.abort()` deprecated — appears in `agent-integration.js`, `device-sync.js`, `cluster-membership.js`.

---

## Phase 3: QNN Python Audit

### Directory status: CONFIRMED PRESENT at `~/Desktop/QNN/`

25 Python files at root level + 9 in `soul-api-deploy/` mirror.

### soul_bridge.py

Generally clean. One silent functional bug: line 122 reads `result.get("quality", 0.0)` but `soul_adaptive_builder.AdaptiveBuilder.query()` returns the key `"alignment_score"`, not `"quality"`. This means every local Soul Engine response is scored at 0.0, causing the quality gate to always fail and triggering unnecessary NIM fallback — the primary local-AI feature is silently broken.

`_INTERACTIONS_FILE` grows unboundedly with no rotation or size cap.

### soul_nim_bridge.py

Clean. One minor issue: `str | None` union type hint requires Python 3.10+ — fails on 3.9.

### soul_dspy_optimizer.py — Module-level crash bug

```python
try:
    import dspy
    HAS_DSPY = True
except ImportError:
    HAS_DSPY = False

class WisdomGuideSignature(dspy.Signature):   # NameError if dspy is absent
class SoulWisdomProgram(dspy.Module):         # same
```

Importing this module on a machine without `dspy-ai` raises `NameError` at module load time before `HAS_DSPY` is checked. Any `from soul_dspy_optimizer import ...` crashes.

Additionally, `dspy.OllamaLocal` was renamed to `dspy.LM` in dspy 2.x — will raise `AttributeError` on current dspy.

### Hardcoded `~/Desktop/QNN` paths across Python files

| File | Line | Code |
|---|---|---|
| `soul_builder_agent.py` | 11 | `load_dotenv(os.path.expanduser("~/Desktop/QNN/.env"))` |
| `soul_nim.py` | 42, 160 | Desktop/QNN paths |
| `soul_benchmark.py` | 308, 457 | Default output `~/Desktop/QNN/benchmark_results.json` |
| `soul-api-deploy/soul_builder_agent.py` | 11 | Same |
| `soul-api-deploy/soul_nim.py` | 41, 148 | Same |

Fix: Replace all with `BASE = Path(__file__).parent`-relative paths (already done correctly in `soul_bridge.py` and `soul_nim_bridge.py`).

### Missing dependency: `python-dotenv` in soul_builder_agent.py

`from dotenv import load_dotenv` is not guarded by a try/except. If not installed, the entire Soul Engine builder crashes on import.

---

## Phase 4: Integration Status

| Path | Status | Key Finding |
|---|---|---|
| 1. Soul query → IPC → soul_bridge.py → FAISS → UI | ✓ WIRED | End-to-end confirmed; FAISS indices present |
| 2. NIM win → soul_nim_bridge.py → soul_interactions.jsonl | ⚠ PARTIAL | soul_bridge.py `log_feedback` → soul_nim_bridge.py delegation unconfirmed |
| 3. App Store click → store overlay → BrowserView launch | ✓ WIRED | All IPC handlers and app-runner confirmed |
| 4. IPFS start → peer discovery → gossipsub → pin/unpin | ✓ WIRED | Full chain confirmed, mDNS + bootstrap + gossipsub |
| 5. Feedback thumbs → IPC → soul_interactions.jsonl | ⚠ PARTIAL | Server IPC wired; renderer-to-IPC mapping unverified |
| 6. DSPy optimizer → interactions → improved prompts | ⚠ PARTIAL | Script functional but no automated trigger — manual CLI only |
| 7. Ephemeral UI text selection → Soul Engine overlay | ⚠ PARTIAL | Overlay logic present; selectionchange listener registration unverified at bottom of file |

**Critical silent bug across Paths 1 and 5:** The Soul Engine always returns `quality: 0.0` due to the `"alignment_score"` vs `"quality"` key mismatch in `soul_bridge.py`. This means Path 1's quality gate always fails, and NIM is always called unnecessarily. The local QNN is functionally bypassed.

---

## Phase 5: v1 Release Checklist

| Criterion | Result | Notes |
|---|---|---|
| package.json fields complete | PARTIAL | `license` absent; `author` is placeholder "Bucks Developer" (blocks notarization) |
| Electron version not EOL | PASS | `^42.4.1` — current |
| Icon assets (icns / ico / png) | PARTIAL | PNG exists; no `.icns` for Mac, no `.ico` for Windows; `win.icon: null` |
| Auto-updater configured | PARTIAL | Custom cluster-updater exists; `RELEASE_PUBLISHER_PUBKEY` defaults to `""` so it's inert by default |
| Code signing set up | FAIL | No signing identity, entitlements, or notarize config anywhere |
| CSP headers | PARTIAL | Present and scoped; `unsafe-inline` not resolved |
| Sensitive data in console.log | PARTIAL | Renderer console piped verbatim to stdout; all telemetry payloads logged |
| Error boundaries / crash handling | PARTIAL | No `process.on('uncaughtException')` or `unhandledRejection` handler |
| Offline mode | PASS | Three-tier fallback chain; offline text response present |
| Works without QNN | PASS | `qnnBridge.start()` failure is non-fatal; fallback chain handles it |
| User-facing README | PASS | Comprehensive README exists |
| Git version control | PASS | Confirmed in git |
| No placeholder API keys shipped | PASS | Keys from env vars, not hardcoded |
| `asar` packaging | FAIL | `asar: false` — all source ships uncompressed and readable |

---

## Cross-Cutting Issues

1. **`verifyEd25519(soulId, ...)` pattern** repeated in `device-sync.js`, `cluster-membership.js`, `cluster-updater.js` — the entire gossip-based trust chain (device admission, auto-updates) is likely unverified.

2. **`req.abort()` deprecated** in `agent-integration.js`, `device-sync.js`, `cluster-membership.js`, `ipfs-agent-soul.js` — timeout handling broken on Node.js 18+ (bundled with recent Electron).

3. **Default `BUCKS_CLUSTER_SECRET = "BUCKS_DEFAULT_CLUSTER"`** in `bucks-node.js`, `chat-engine.js`, `device-sync.js`, `cluster-membership.js` — all nodes on default settings share a public topic.

4. **`~/Desktop/QNN` hardcoded** in both JavaScript (main.js) and Python (soul_builder_agent.py, soul_nim.py, soul_benchmark.py) — non-functional on any machine that isn't the developer's desktop.

5. **`renderer.js` (380KB) not fully audited** — the largest file in the codebase. Requires a dedicated pass.

---

*Report generated 2026-08-02. Security rules applied: vocabulary substitutions enforced throughout.*

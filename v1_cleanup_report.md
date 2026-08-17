# Bucks Browser v1 Cleanup Report
Generated: 2026-08-02

## Summary

Cleaned the `bucks browser/electron/` codebase for v1 public release by removing all blockchain/wallet features (deferred to v2), archiving mobile/OS sub-projects, and deleting dead files. All modified JS files pass `node --check` syntax validation.

---

## Files Moved to `_v2_deferred/`

### Blockchain/wallet backend
| File | Reason |
|------|--------|
| `bucks browser/electron/bucks-node.js` | Embedded blockchain node — full account-model chain with Ed25519, PoW mining, mempool, gossipsub sync. Entire wallet/transaction/mining API. |
| `bucks-browser/` (entire folder) | Separate TypeScript reimplementation of the browser. Contains `CreateWallet.tsx`, `ImportWallet.tsx`, `WalletPill.tsx`, `SigningModal.tsx`, `chain.ts`, `wallet.ts`, `ipc-handlers.ts` — all wallet-first. |

### Dead files (removed from codebase, preserved in `_v2_deferred/` as `_dead_*`)
| File | Reason |
|------|--------|
| `_dead_llama_smoke.mjs` | Test smoke file for llama inference — not imported anywhere |
| `_dead_strip_styles.py` | One-off Python utility script — not needed for v1 |
| `_dead_benchmark-panel.js` | No-op shim confirmed not imported anywhere in source |

---

## Files Archived to `_archive/`

| Folder | Reason |
|--------|--------|
| `bucks-android/` | Android app — deferred to v2 |
| `bucks-ios/` | iOS app — deferred to v2 |
| `bucks-os/` | Bucks OS (Linux distro) — deferred to v2 |

---

## IPC Handlers Commented Out in `main.js`

All commented with `// V2: deferred to next release`.

| Handler / Block | Lines (approx) | Description |
|-----------------|----------------|-------------|
| `ipcMain.handle('wallet-reset', ...)` | ~448–451 | Deletes stored wallets via bucks-node |
| `ALLOWED_WALLET_METHODS` constant | ~455 | `['GET', 'POST']` — wallet endpoint allowlist |
| `ALLOWED_WALLET_ENDPOINTS` array | ~456–472 | 15 wallet/blockchain/mining API endpoints |
| `ALLOWED_WALLET_PREFIXES` array | ~474–477 | `/api/address/` prefix routing |
| `validateWalletSchema()` function | ~508–565 | Request schema enforcement for wallet RPC |
| `const pendingApprovals = new Map()` | ~567 | Wallet access approval promise registry |
| `ipcMain.handle('wallet-rpc', ...)` | ~569–615 | Full wallet RPC proxy with origin gating, schema validation, and bucks-node dispatch |
| `ipcMain.on('wallet-access-response', ...)` | ~649–655 | Resolves pending wallet access approvals |
| `const bucksNode = require('./bucks-node')` + init block | ~1418–1425 | Blockchain node startup at app launch |

**Kept intact** (used by `social-rpc` and other non-wallet features):
- `originAllowlist` setup
- `isInternalOrigin()` function
- `validateOriginAccess()` function

---

## Imports / APIs Commented Out in `preload.js`

| API | Description |
|-----|-------------|
| `onWalletAccessRequest(callback)` | IPC listener for wallet access approval modal |
| `respondToWalletAccess(requestId, approved)` | IPC sender for wallet access response |
| `walletRPC(params)` | Invokes `wallet-rpc` IPC handler |
| `walletReset()` | Invokes `wallet-reset` IPC handler |

---

## Syntax Validation

```
node --check main.js    → OK
node --check preload.js → OK
node --check renderer.js → OK
```

(Node.js v22.22.3)

---

## Notes

- `renderer.js` has wallet UI code (wallet sidebar, wallet state, `refreshWallet()`). These are left in place — with `walletRPC` commented out in preload.js, wallet calls fail gracefully and the wallet panel shows as "disconnected". A full UI purge is optional cleanup for v2 prep.
- `crypto-utils.js` was **kept** — it only contains Ed25519 signature verification (`verifyEd25519`), used for release publisher key checking, not wallet operations.
- `nim-panel.js` was **kept** — it's a no-op shim with internal state used by `agent-interface.js` for NIM model routing.
- `bucks-template-*.html` files were **kept** — they are referenced in `main.js` by the DWeb Studio feature.
- `bucks-blockchain-architecture.md` and `bucks-contracts-plan.md` in the root were **kept** as reference documents per spec.
- The duplicate `bucks-browser/` folder (TypeScript reimplementation) has been moved to `_v2_deferred/`. The canonical v1 codebase is `bucks browser/`.

---

## v1 Clean File List (`bucks browser/electron/`)

```
agent-browser-control.js     agent-engine.js
agent-integration.js         agent-interface.js
agent-swarm.js               app-runner.js
app-store-data.js            app-store.js
background-animation.js      bootstrap.js
bucks-calc.html              bucks-clock.html
bucks-converter.html         bucks-logo.png
bucks-notes.html             bucks-qr.html
bucks-template-blog.html     bucks-template-dashboard.html
bucks-template-landing.html  bucks-template-portfolio.html
bucks-template-store.html    bucks-universe.html
canvas-manager.js            chat-engine.js
cluster-membership.js        cluster-updater.js
crypto-utils.js              device-sync.js
doc-factory.js               dweb-studio-renderer.js
dweb-studio.html             earth-maps.js
ephemeral-preload.js         ephemeral-renderer.js
ephemeral-ui.js              ephemeral-window.js
ephemeral.html               extension-loader.js
file-manager-ui.js           index.html
ipfs-agent-soul.js           ipfs-bridge.js
ipfs-node.js                 main.js  ← wallet IPC commented out
messages-ui.js               move_chat_panel.js
nexus-ipc-bridge.js          nexus-panel.js
nim-panel.js                 package.json
pane-manager.js              permission-manager.js
preload.js  ← wallet APIs commented out
renderer.js                  signal-store.js
soul-bridge.js               soul-engine-supervisor.js
soul-ui.js                   styles.css
tab-manager.js               tab-view.js
three.min.js                 universe-data.js
universe-map.js              web-security.js
```

**Removed from electron/**: `bucks-node.js`, `llama_smoke.mjs`, `strip_styles.py`, `benchmark-panel.js`

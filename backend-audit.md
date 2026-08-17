# Bucks Project — Backend Configuration Audit

**Date:** 2026-07-19  
**Scope:** bucks-browser, bucks-mobile (Android + iOS), bucks-browser (Electron legacy), wallet extension, node, miner, contracts  
**Chain:** Chain 8192 · Token: BUCKS  

---

## Summary Table

| # | Area | Issue | Severity |
|---|------|-------|----------|
| 1 | Crypto / Wallet | PBKDF2 iteration count mismatch in mnemonicToSeed (2,048 vs 310,000) | **Critical** |
| 2 | Chain Config | Boot node peer IDs are placeholders — chain cannot sync | **Critical** |
| 3 | Contracts | Soul Engine oracle address is zero — contracts non-functional on mainnet | **Critical** |
| 4 | iOS | secp256k1 signer is a stub (`StubSecp256k1Signer`) — no real tx signing on iOS | **High** |
| 5 | Node RPC | Default CORS is wildcard `"*"` — exposes RPC to any origin | **High** |
| 6 | Electron (new) | Local RPC fallback hardcoded to port 8545, not 8192 — local node never detected | **High** |
| 7 | Electron (new) | CSP `connect-src` references `http://localhost:8545`, not `:8192` | **High** |
| 8 | IPFS | Public gateway `ipfs.io` hardcoded — single point of failure, leaks user queries | **High** |
| 9 | Electron (legacy) | No CSP headers set at the session layer | **High** |
| 10 | Contracts | No deployed contract addresses in `deployments/` — registry is empty | **High** |
| 11 | Electron (legacy) | `webviewTag: true` with no per-webview sandbox enforcement | **Medium** |
| 12 | Electron (new) | `sandbox: false` on main window required for keytar | **Medium** |
| 13 | Android | No release `signingConfig` in either Android `build.gradle.kts` | **Medium** |
| 14 | Android | Missing `FOREGROUND_SERVICE` + `WAKE_LOCK` permissions for background mining | **Medium** |
| 15 | Android | `security-crypto:1.1.0-alpha06` — alpha library in production | **Medium** |
| 16 | iOS | No `.entitlements` file — keychain groups, push, associated domains unconfigured | **Medium** |
| 17 | Contracts | Testnet RPC URL defaults to same address as mainnet | **Medium** |
| 18 | Node | IPFS cluster secret has a hardcoded default value | **Medium** |
| 19 | Dependencies | `electron` 28.x is EOL; `electron-rebuild` is deprecated | **Low** |
| 20 | Dependencies | `accompanist-systemuicontroller` is deprecated by Google | **Low** |
| 21 | Dependencies | `web3j` 4.10.3 (mid-2023) — check for CVEs | **Low** |
| 22 | iOS | BGTaskScheduler identifier mismatch risk between Info.plist and code | **Low** |
| 23 | Git | Wallet `.gitignore` missing `wordlist.stub.ts` coverage in bucks-browser repo | **Low** |
| 24 | Missing config | Production pool mining endpoint not set | **Info** |
| 25 | Missing config | `components.bucks.network` CDN not verified to be live | **Info** |
| 26 | Missing config | Android release keystore / Play signing not configured | **Info** |
| 27 | Agent config | Cloud AI keys are placeholders — cloud fallback non-functional | **Info** |

---

## Detailed Findings

---

### 1 · PBKDF2 Iteration Count Mismatch in `mnemonicToSeed`

**File:** `wallet/src/crypto/bip8192.ts` — line 185  
**Severity:** Critical

`mnemonicToSeed()` derives the HD wallet seed from the mnemonic using PBKDF2-SHA512 with only **2,048 iterations**. The spec (and `keystore.ts`) mandates **310,000 iterations**. This means the conversion from mnemonic → 64-byte seed — the root of all key derivation — is ~150× faster than designed, making it orders of magnitude more susceptible to offline brute-force attacks.

```ts
// CURRENT (bip8192.ts line 181-186) — WRONG
{
  name:       'PBKDF2',
  hash:       'SHA-512',
  salt:       saltBytes,
  iterations: 2048,   // ← should be 310_000
}
```

**Fix:** Change the `iterations` value in `mnemonicToSeed` to `310_000` (matching the `KDF_ITERATIONS` constant in `keystore.ts`). Extract a shared `KDF_ITERATIONS = 310_000` constant used in both files.

---

### 2 · Boot Node Peer IDs Are Placeholders

**Files:** `node/core/blockchain/genesis.go` line 66, `node/config/config.go` line 112  
**Severity:** Critical

Both files contain identical placeholder peer IDs:
```
/dns4/boot1.bucks.net/tcp/30300/p2p/12D3KooWBootNode1PlaceholderPeerId
/dns4/boot2.bucks.net/tcp/30300/p2p/12D3KooWBootNode2PlaceholderPeerId
```
These are not valid libp2p peer IDs. Nodes will fail DHT bootstrap and never connect to peers on mainnet.

**Fix:** Replace with real Ed25519-derived peer IDs generated from production boot node key pairs. The DNS hostnames (`boot1.bucks.net`, `boot2.bucks.net`) also need to be provisioned.

---

### 3 · Soul Engine Oracle Address Is Zero Address

**Files:** `contracts/.env.example` line 17, `contracts/scripts/deploy.ts` line 26  
**Severity:** Critical

```env
SOUL_ENGINE_ADDRESS=0x0000000000000000000000000000000000000000
```

All five deployed contracts (`BucksTransfer`, `BucksEscrow`, `CommunityTreasury`, `BusinessAgreement`, `SoulVerified`) accept a `soulEngine` constructor parameter. With the zero address, any Solidity call into the oracle will either silently fail or call a non-contract address. The `deployments/` folder contains only a `.gitkeep` — no contracts have been deployed anywhere.

**Fix:** Deploy the Soul Engine oracle contract first, record its address, then populate `SOUL_ENGINE_ADDRESS` before running the main deploy script. The zero-address should throw in constructor validation.

---

### 4 · iOS secp256k1 Signer Is a Stub

**File:** `bucks-ios/Package.swift` lines 14–17  
**Severity:** High

`Package.swift` explicitly documents:
> "secp256k1 elliptic-curve signing is NOT implemented from scratch in this scaffold (see Web3Service.swift's `StubSecp256k1Signer`). Before shipping to mainnet, replace the stub signer with a real, audited secp256k1 implementation."

The `Boilertalk/secp256k1.swift` package (v0.1.4) is declared as a dependency but the stub has not been replaced. iOS users cannot sign or broadcast transactions.

**Fix:** Wire in the `secp256k1` product from the declared dependency, implement the `Secp256k1Signing` protocol with a real signer, and remove `StubSecp256k1Signer` before any public release.

---

### 5 · Node RPC Default CORS Is Wildcard

**File:** `node/config/config.go` line 124  
**Severity:** High

```go
CORSAllowedOrigins: []string{"*"},
```

The default node configuration allows any origin to make cross-origin RPC calls. Any website a user visits while running a local node can call `eth_sendRawTransaction`, `eth_sign`, etc.

**Fix:** Default to `["http://localhost:3000", "bucks://"]` or similar. Document how operators set production origins. Never ship with `"*"`.

---

### 6 · Local RPC Fallback Uses Wrong Port (8545 vs 8192)

**File:** `bucks-browser/electron/services/node.ts` line 38  
**Severity:** High

```ts
const LOCAL_RPC = 'http://127.0.0.1:8545'
```

The Bucks node listens on port **8192** (its chain ID). Port 8545 is Hardhat/Anvil's default. The `initialize()` method probes `LOCAL_RPC` first; it will never match a real local Bucks node, so the browser always falls back to `rpc.bucks.network` even when a local node is running.

**Fix:** Change to `http://127.0.0.1:8192`.

---

### 7 · CSP `connect-src` References Wrong Local Port

**File:** `bucks-browser/renderer/index.html` line 6  
**Severity:** High

```html
connect-src 'self' https://rpc.bucks.network http://localhost:8545 https://ipfs.io
```

Consistent with finding #6: `http://localhost:8545` in the CSP will block any fetch to the correct local RPC port 8192.

**Fix:** Replace `http://localhost:8545` with `http://localhost:8192 http://127.0.0.1:8192`.

---

### 8 · IPFS Public Gateway Hardcoded to `ipfs.io`

**File:** `bucks-browser/electron/main.ts` lines 183, 202  
**Severity:** High

```ts
const gatewayUrl = `https://ipfs.io/ipfs/${cid}${subpath}`
```

Every `ipfs://` and `ipns://` request in the browser proxies through Cloudflare's public `ipfs.io` gateway. Issues:
- Privacy: all IPFS content requests are logged by a third party.
- Reliability: single point of failure (ipfs.io is sometimes rate-limited or blocked).
- Phase 2 comment says "use embedded Helia node" — this fallback should use the Helia node already embedded via `electron/ipfs-node.js`.

**Fix:** Route `ipfs://` through the embedded Helia node (already wired in the legacy browser under `electron/ipfs-node.js`). Fall back to a configurable gateway list, not a hardcoded single gateway.

---

### 9 · No CSP Set at Session Layer in Legacy Electron Browser

**File:** `bucks browser/electron/main.js`  
**Severity:** High

The newer `bucks-browser` correctly sets a CSP via `<meta http-equiv>` in `renderer/index.html`. The legacy `bucks browser` does not use `session.defaultSession.webRequest.onHeadersReceived` to inject a `Content-Security-Policy` header for the shell or for loaded web content. The shell has no effective CSP.

**Fix:**
```js
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'; script-src 'self'; ..."]
    }
  });
});
```

---

### 10 · No Deployed Contract Addresses

**File:** `contracts/deployments/` (only `.gitkeep`)  
**Severity:** High

No contracts have been deployed to any network. The wallet, browser dApp, and escrow flows all depend on on-chain contracts (`ContractRegistry`, `BucksTransfer`, `BucksEscrow`, etc.). Until these are deployed and their addresses wired into the frontends, none of the contract-dependent features work.

**Fix:** Complete findings #2 and #3 first (boot nodes + Soul Engine oracle). Then run `npx hardhat run scripts/deploy.ts --network bucks` against the live chain and store the resulting `deployments/bucks.json`. Wire contract addresses into the browser/mobile via env vars or a published registry.

---

### 11 · `webviewTag: true` Without Per-Webview Sandbox Enforcement

**File:** `bucks browser/electron/main.js` line 185  
**Severity:** Medium

`<webview>` tags are enabled. While `nodeIntegration: false` and `contextIsolation: true` are set on the main window, `<webview>` elements inherit their own `webPreferences`. Electron's security recommendations say to avoid `webviewTag: true` entirely and prefer `BrowserView`/`WebContentsView` instead.

**Fix:** Audit all `<webview>` usages in `renderer.js` and HTML files. Either migrate to `BrowserView` (already used in `bucks-browser/electron/main.ts`) or enforce `<webview nodeintegration="false" disablewebsecurity="false">` attributes at creation time and listen for the `will-attach-webview` event to validate options.

---

### 12 · `sandbox: false` on Main Window

**File:** `bucks-browser/electron/main.ts` line 70  
**Severity:** Medium

```ts
sandbox: false,  // needed for keytar native module
```

Disabling the renderer sandbox is required for `keytar`'s native bindings but removes the Chromium sandbox from the main UI window. This is a known trade-off; it's documented inline. Consider moving keytar calls exclusively to the main process and keeping the renderer sandboxed.

**Fix (preferred):** Move all keytar access into the main process IPC handlers. Set `sandbox: true` on the renderer window. The IPC bridge is already in place (`ipc-handlers.ts`).

---

### 13 · No Release Signing Config in Android Gradle

**Files:** `bucks-mobile/app/build.gradle.kts`, `bucks-android/app/build.gradle.kts`  
**Severity:** Medium

Neither `build.gradle.kts` defines a `signingConfigs` block for the release build type. Without it, release APKs/AABs are unsigned and cannot be distributed via Google Play.

```kotlin
// Missing from both files:
signingConfigs {
    create("release") {
        storeFile = file(System.getenv("KEYSTORE_PATH") ?: "")
        storePassword = System.getenv("KEYSTORE_PASSWORD") ?: ""
        keyAlias = System.getenv("KEY_ALIAS") ?: ""
        keyPassword = System.getenv("KEY_PASSWORD") ?: ""
    }
}
buildTypes {
    release {
        signingConfig = signingConfigs.getByName("release")
        // ...existing config
    }
}
```

**Fix:** Add the above, source signing credentials from environment variables (never hardcode), and ensure the CI/CD pipeline injects them at build time.

---

### 14 · Missing Android Permissions for Background Mining / Sync

**File:** `bucks-mobile/app/src/main/AndroidManifest.xml`  
**Severity:** Medium

The `AndroidManifest.xml` declares `INTERNET`, `ACCESS_NETWORK_STATE`, and `POST_NOTIFICATIONS` only. If background mining (via WorkManager), persistent WebSocket connections, or wake-lock-based sync are planned:

- `FOREGROUND_SERVICE` — required to run a foreground service
- `FOREGROUND_SERVICE_DATA_SYNC` or `FOREGROUND_SERVICE_CONNECTED_DEVICE` — required on API 34+ for specific foreground service types
- `WAKE_LOCK` — required to keep CPU awake during mining tasks

**Fix:** Add the appropriate permissions and declare any foreground service components in the manifest. Also add the `<service>` declaration for any WorkManager `ListenableWorker` running as a foreground service.

---

### 15 · Alpha Security Crypto Library in Production

**File:** `bucks-mobile/gradle/libs.versions.toml` line 13  
**Severity:** Medium

```toml
securityCrypto = "1.1.0-alpha06"
```

`androidx.security:security-crypto` is in alpha. Alpha libraries have no API stability guarantees and may have unfixed security issues. The stable series is `1.0.0`.

**Fix:** Downgrade to `security-crypto:1.0.0` (stable) or evaluate whether the alpha APIs being used are actually needed.

---

### 16 · No iOS Entitlements File

**File:** `bucks-ios/` (none found)  
**Severity:** Medium

No `.entitlements` file exists. Without it, capabilities such as:
- **Keychain Sharing** (for storing wallet keys between app restarts)
- **Push Notifications** (for transaction alerts)
- **Associated Domains** (for universal link deep linking from `bucks.network`)
- **App Groups** (for sharing data with extensions)

…cannot be enabled via Xcode signing. The `ExportOptions.plist` exists but entitlements are missing.

**Fix:** Create `BucksBrowser/BucksBrowser.entitlements`, add `keychain-access-groups`, and configure in the Xcode target's Signing & Capabilities tab.

---

### 17 · Testnet RPC Defaults to Mainnet Address

**File:** `contracts/.env.example` line 14, `contracts/hardhat.config.ts` line 43  
**Severity:** Medium

```env
BUCKS_TESTNET_RPC_URL=http://127.0.0.1:8192
```

The testnet network (`chainId: 81920`) and mainnet network (`chainId: 8192`) share the same default RPC URL. A deployment to `--network bucks-testnet` with defaults will hit the mainnet node — or fail with a chain ID mismatch.

**Fix:** Set a distinct testnet RPC URL (e.g. `http://127.0.0.1:8193` for a local testnet node, or a hosted testnet endpoint). Ensure `genesis.go → TestnetGenesis()` chain ID of `81920` matches the hardhat config.

---

### 18 · Hardcoded Default IPFS Cluster Secret

**File:** `bucks browser/electron/main.js` line 129  
**Severity:** Medium

```js
clusterSecret: 'BUCKS_DEFAULT_CLUSTER',
```

All users running the browser with default settings share the same IPFS cluster secret. Anyone who knows this string can join the cluster and pin/unpin content.

**Fix:** Generate a random 32-byte hex secret per-installation on first run and store it in the user data directory. Remove the hardcoded default.

---

### 19 · Electron 28.x Is EOL; `electron-rebuild` Is Deprecated

**File:** `bucks-browser/package.json`  
**Severity:** Low

- `"electron": "^28.2.0"` — Electron 28 reached end of life in June 2024. It no longer receives security patches. Current stable is Electron 32+.
- `"electron-rebuild": "^3.2.9"` — This package is deprecated and superseded by `@electron/rebuild`.

**Fix:**
```json
"electron": "^32.0.0",
"@electron/rebuild": "^3.7.0"
```
Update `package.json` scripts to use `electron-rebuild` → `@electron/rebuild` and test native module (`keytar`) compatibility after upgrade.

---

### 20 · `accompanist-systemuicontroller` Is Deprecated

**File:** `bucks-mobile/gradle/libs.versions.toml` line 14  
**Severity:** Low

```toml
accompanistSystemUiController = "0.34.0"
```

Google deprecated the Accompanist `SystemUiController` in 2023. The recommended replacement is `activity.enableEdgeToEdge()` + `WindowInsets` in Compose.

**Fix:** Remove the dependency and migrate to `androidx.activity:activity-compose` with `enableEdgeToEdge()`.

---

### 21 · `web3j` 4.10.3 — Verify for CVEs

**File:** `bucks-mobile/gradle/libs.versions.toml` line 11  
**Severity:** Low

`org.web3j:core:4.10.3` was released in mid-2023. As of the audit date it is ~2.5 years old. CVE databases should be checked; newer versions (5.x) include fixes and API improvements.

**Fix:** Check the [web3j releases](https://github.com/web3j/web3j/releases) and NIST NVD for known CVEs. Upgrade to the latest stable 4.x or 5.x.

---

### 22 · BGTaskScheduler Identifier Consistency

**File:** `bucks-ios/BucksBrowser/Resources/Info.plist` line 89  
**Severity:** Low

```xml
<string>network.bucks.miner.refresh</string>
```

The identifier `network.bucks.miner.refresh` must be registered in code via `BGTaskScheduler.shared.register(forTaskWithIdentifier:...)` during `application(_:didFinishLaunchingWithOptions:)`. If the registration call uses a different string, iOS will silently ignore scheduling requests. Verify the identifier matches in `BucksBrowserApp.swift` / `MinerService.swift`.

---

### 23 · `wordlist.stub.ts` Gitignore Gap in bucks-browser Repo

**File:** `bucks-browser/.gitignore`  
**Severity:** Low

The `.gitignore` correctly excludes `wordlist.txt` and `bip8192-wordlist.txt` but does not explicitly exclude `src/crypto/wordlist.ts` or `src/crypto/wordlist.private.ts`. The wallet repo's `.gitignore` does cover these paths, but the `bucks-browser` repo (separate git) does not. If the production wordlist is ever placed in `bucks-browser/` at those paths, it could be accidentally committed.

**Fix:** Add the following to `bucks-browser/.gitignore`:
```
src/crypto/wordlist.ts
src/crypto/wordlist.private.ts
renderer/src/crypto/wordlist.ts
```

---

## Info / Missing Backend Config

| Item | Detail |
|------|--------|
| **Production pool mining endpoint** | `miner/config/config.go`: `Pool.URL = ""` — no default stratum endpoint. Solo mining only works if a local node is running. Set `stratum+tcp://pool.bucks.network:3333` once pool is operational. |
| **`components.bucks.network` CDN** | Dozens of `fallbackUrl` references in `bucks-mobile` and `bucks-ios` point to `https://components.bucks.network/models/...` and `.../miner/...`. These CDN paths must be provisioned and populated with binaries before the mobile apps ship. |
| **Android Play/keystore signing** | `.gitignore` correctly excludes `*.keystore` and `*.jks`. A CI secret for signing must be configured in the build pipeline before submitting to Google Play. |
| **iOS App Store provisioning** | `ExportOptions.plist` exists but no provisioning profile or Distribution certificate is present. Required for TestFlight or App Store distribution. |
| **Cloud AI keys in agent** | `bucks browser/agent/.env`: `LITAI_API_KEY=your_lightning_ai_key_here`, `NGC_API_KEY=your_nvidia_ngc_key_here`. Cloud AI fallback is non-functional until real keys are set. |
| **Smart contract addresses** | No production addresses exist. The wallet `src/rpc/client.ts` calls `bucks_getChainParams` but contract addresses for `BucksTransfer`, `BucksEscrow`, `ContractRegistry` are not wired into any frontend config. |

---

## Top 10 Punch List Before Mainnet Launch

These must all be resolved before going live on Chain 8192 mainnet. Ordered by risk:

1. **Fix `mnemonicToSeed` iteration count** (`wallet/src/crypto/bip8192.ts` line 185) — change `2048` to `310_000`. This is a cryptographic correctness bug. Any wallet seeded under the current code will derive different keys than expected under the spec.

2. **Replace placeholder boot node peer IDs** — Generate real peer IDs for `boot1.bucks.net` and `boot2.bucks.net`, provision the DNS records and servers, update `genesis.go` and `node/config/config.go`. Without this the chain cannot bootstrap.

3. **Deploy Soul Engine oracle; set `SOUL_ENGINE_ADDRESS`** — All five smart contracts are non-functional without the oracle. Deploy it first, then re-run the main deploy script with the real address.

4. **Fix iOS secp256k1 stub** — Wire `Boilertalk/secp256k1.swift` (already declared in `Package.swift`) into the `Secp256k1Signing` protocol implementation. iOS cannot sign transactions until this is done.

5. **Fix local RPC port everywhere** — Change `bucks-browser/electron/services/node.ts` `LOCAL_RPC` from `:8545` to `:8192`, and update the CSP `connect-src` in `renderer/index.html` to match. Wallet balance and tx broadcasting are broken against a local node as-is.

6. **Tighten RPC CORS** — Change `node/config/config.go` default `CORSAllowedOrigins` from `["*"]` to an explicit allow-list before the public node release.

7. **Add Android release signing config** — Add `signingConfigs` to both `build.gradle.kts` files, sourcing credentials from CI environment variables. Required for Play Store submission.

8. **Set IPFS gateway to embedded Helia node** — Remove the `ipfs.io` hardcoded fallback in `bucks-browser/electron/main.ts`. Route through the local Helia instance already in the codebase (`electron/ipfs-node.js`).

9. **Add iOS entitlements file** — Create `BucksBrowser.entitlements` with at minimum `keychain-access-groups` for secure key storage between app restarts.

10. **Upgrade Electron 28 → 32+** — Electron 28 is EOL and receives no security patches. Upgrade before public release, and switch from deprecated `electron-rebuild` to `@electron/rebuild`.

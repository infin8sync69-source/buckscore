# Bucks Backend Infrastructure — Fix Todo List

**Generated:** 2026-07-19  
**Source:** `backend-audit.md` (27 findings) + broader infrastructure hardening  
**Chain:** Chain 8192 · Token: BUCKS · AI Engine: Soul Engine

---

## Summary Table

| Metric | Value |
|--------|-------|
| Total tasks | 89 |
| 🔴 Critical | 14 |
| 🟠 High | 24 |
| 🟡 Medium | 28 |
| 🟢 Low | 23 |
| Estimated total effort | ~47 person-weeks |

### Priority Breakdown by Section

| Section | Tasks | Priority | Est. Effort |
|---------|-------|----------|-------------|
| A — Critical Fixes | 14 | 🔴 Critical | 3.5 weeks |
| B — High Priority Fixes | 10 | 🟠 High | 2 weeks |
| C — Smart Contract Infrastructure | 15 | 🔴🟠🟡 Mixed | 8 weeks |
| D — Mobile Backend | 12 | 🟠🟡 Mixed | 3 weeks |
| E — API / RPC Layer | 12 | 🟠🟡 Mixed | 5 weeks |
| F — DevOps & CI/CD | 12 | 🟠🟡 Mixed | 4 weeks |
| G — Security Hardening | 11 | 🔴🟠🟡 Mixed | 4 weeks |
| H — Monitoring & Observability | 13 | 🟡🟢 Mixed | 3.5 weeks |

### Recommended Sprint Order

**Sprint 1 — Unblock the chain (Weeks 1–2)**  
A1 (PBKDF2 fix) → A2 (boot nodes) → A3-a (Soul Engine oracle deploy) → B1+B2 (RPC port + CORS) → B4 (chain ID audit)

**Sprint 2 — Make contracts functional (Weeks 3–5)**  
A3-b (full contract deployment) → C1 (architecture) → C2 (test suite) → E1 (RPC node infra)

**Sprint 3 — Mobile unblock (Weeks 6–7)**  
A4 (iOS secp256k1) → D1 (Android) → D2 (iOS entitlements + BGTask)

**Sprint 4 — Security hardening (Weeks 8–10)**  
G1–G3 → B3 (env vars) → F1 (git hygiene) → H1–H3 (monitoring)

**Sprint 5 — Distribution & CI/CD (Weeks 11–13)**  
F2 (CI pipeline) → F3 (release pipeline) → E2 (IPFS) → E3 (CDN)

**Sprint 6 — Polish & observability (Weeks 14–15)**  
Remaining 🟡 Medium + 🟢 Low items, dependency updates

---

## SECTION A — Critical Fixes
*Must be resolved before any mainnet activity on Chain 8192.*

---

### A1. PBKDF2 Iterations Bug

**Root cause:** `wallet/src/crypto/bip8192.ts` (also referenced as `bucks-browser/src/services/bip8192.ts`) uses 2,048 iterations for PBKDF2-SHA512 in `mnemonicToSeed()`. The spec and `keystore.ts` mandate 310,000 iterations, making the seed derivation ~150× weaker than designed.

- [ ] 🔴 **[DEV]** Fix `mnemonicToSeed()` iteration count: change `iterations: 2048` → `iterations: 310_000` in `bip8192.ts` line ~185.
  *Effort: 0.5h | No dependencies*

- [ ] 🔴 **[DEV]** Extract a shared constant `KDF_ITERATIONS = 310_000` into a shared crypto constants file (e.g. `src/crypto/constants.ts`) and import it in both `bip8192.ts` and `keystore.ts`. Eliminate the divergence at the source.
  *Effort: 1h | Depends on task above*

- [ ] 🔴 **[DEV]** Write a migration warning UI: on wallet import/unlock, detect if the stored wallet was created with 2,048-iteration derivation (could use a version field in the keystore JSON), display a prominent warning asking the user to re-derive and re-export their wallet.
  *Effort: 1 day | Depends on keystore versioning*

- [ ] 🔴 **[DEV]** Add keystore version field (`"kdfVersion": 2`) to all new keystores created after the fix, and a legacy detector for `"kdfVersion": 1` or missing version (treat as weak derivation).
  *Effort: 2h | Depends on constant extraction*

- [ ] 🔴 **[DEV]** Write a re-derive migration script: given a mnemonic, re-derive the HD seed at 310,000 iterations and confirm the new root key. Provide this as a CLI tool (`scripts/migrate-wallet.ts`) for users who need to migrate programmatically.
  *Effort: 3h | Depends on iteration fix*

- [ ] 🔴 **[DEV]** Test: sign a known test vector (mnemonic → seed → root xprv) against the BIP-8192 spec at 310,000 iterations. Add this as a deterministic unit test to prevent regression.
  *Effort: 2h | Depends on fix*

- [ ] 🔴 **[DEV]** Audit all other PBKDF2/KDF calls in the codebase (keystore encryption, password-protected exports) to ensure they all use 310,000 iterations. Grep for `iterations:` and `PBKDF2` across all packages.
  *Effort: 2h | Independent*

---

### A2. Boot Node Configuration

**Root cause:** `node/core/blockchain/genesis.go` line 66 and `node/config/config.go` line 112 contain placeholder peer IDs (`12D3KooWBootNode1PlaceholderPeerId`) that are not valid libp2p peer IDs. The chain cannot bootstrap peers.

- [ ] 🔴 **[INFRA]** Provision at least 3 dedicated boot node servers with static IPs, geographically distributed (e.g. US-East, EU-West, Asia-Pacific).
  *Effort: 1 day | Blocked by: infrastructure budget/provider*

- [ ] 🔴 **[INFRA]** Generate real Ed25519 libp2p keypairs for each boot node using `go-libp2p`'s keygen tooling. Store private keys in HSM or encrypted secrets manager — never commit them.
  *Effort: 2h | Depends on server provisioning*

- [ ] 🔴 **[INFRA]** Provision DNS records: `boot1.bucks.net`, `boot2.bucks.net`, `boot3.bucks.net` pointing to the provisioned IPs.
  *Effort: 1h | Depends on server provisioning*

- [ ] 🔴 **[DEV]** Replace both placeholder multiaddrs in `genesis.go` and `node/config/config.go` with real peer IDs derived from generated keypairs. Format: `/dns4/boot1.bucks.net/tcp/30300/p2p/<real-peer-id>`.
  *Effort: 1h | Depends on keypair generation and DNS*

- [ ] 🔴 **[INFRA]** Deploy and run the Bucks node binary on each boot node server. Confirm libp2p DHT bootstrap succeeds between all three nodes before opening to public peers.
  *Effort: 4h | Depends on real peer IDs*

- [ ] 🔴 **[DEVOPS]** Add boot node peer IDs to `genesis.json` and commit. Tag the genesis commit — this is the canonical chain genesis.
  *Effort: 1h | Depends on confirmed DHT*

---

### A3. Smart Contract Deployment

**Root cause:** All contracts have a zero-address Soul Engine oracle (`SOUL_ENGINE_ADDRESS=0x000...000`). The `deployments/` folder is empty. No contracts are live on any network.

- [ ] 🔴 **[CONTRACTS]** Design and implement the Soul Engine oracle contract (`SoulEngineOracle.sol`): minimal interface that the five core contracts call for identity verification. Must include owner-only address update and circuit-breaker pause.
  *Effort: 3 days | Blocked by: Soul Engine oracle architecture decision*

- [ ] 🔴 **[CONTRACTS]** Deploy Soul Engine oracle to Chain 8192 testnet (chainId 81920). Record deployed address. Update `contracts/.env` with real `SOUL_ENGINE_ADDRESS`.
  *Effort: 2h | Depends on oracle contract + working testnet (A2)*

- [ ] 🔴 **[CONTRACTS]** Add constructor input validation: if `soulEngine == address(0)`, revert with a descriptive error. This prevents silent failure if the zero address slips through again.
  *Effort: 1h | Depends on oracle contract*

- [ ] 🔴 **[CONTRACTS]** Write Hardhat deploy scripts for all 7 contracts in correct dependency order:
  1. `SoulEngineOracle.sol`
  2. `GlobalProfile.sol`
  3. `PersonalProfile.sol`
  4. `SkillsetProfile.sol`
  5. `AgentRegistry.sol`
  6. `EscrowVault.sol`
  7. `PinningRewards.sol` / `SlashingPool.sol`

  Save scripts to `contracts/scripts/deploy/` (one file per contract).
  *Effort: 2 days | Depends on oracle deploy + working boot nodes*

- [ ] 🔴 **[CONTRACTS]** Create `deployments/chain-8192/` directory structure. After each deployment run, save a JSON file per contract: `{ "address": "0x...", "deployedAt": <block>, "txHash": "0x...", "deployer": "0x..." }`.
  *Effort: 2h | Depends on deploy scripts*

- [ ] 🔴 **[DEV]** Wire deployed contract addresses into frontend config. Create `bucks-browser/src/config/contracts.ts` and corresponding mobile config files. Load addresses from `deployments/chain-8192/*.json` at build time.
  *Effort: 4h | Depends on completed deployments*

- [ ] 🔴 **[CONTRACTS]** Testnet smoke test: after testnet deployment, manually call each contract's key functions (transfer, escrow, profile create) to confirm they work end-to-end with the real Soul Engine oracle address.
  *Effort: 4h | Depends on testnet deployment*

---

### A4. iOS secp256k1 Signing

**Root cause:** `bucks-ios/Package.swift` declares `Boilertalk/secp256k1.swift` as a dependency but `Web3Service.swift` still uses `StubSecp256k1Signer`. iOS cannot sign or broadcast any transactions.

- [ ] 🔴 **[MOBILE]** Remove `StubSecp256k1Signer` from `Web3Service.swift`. Implement the `Secp256k1Signing` protocol using the `secp256k1` product from `Boilertalk/secp256k1.swift` v0.1.4 (already declared in `Package.swift`).
  *Effort: 1 day | No dependencies*

- [ ] 🔴 **[MOBILE]** Implement EVM-compatible signature production: ECDSA on secp256k1, DER-encoded output, recovery bit (v = 27 or 28). Verify the `v` recovery byte convention matches what the Chain 8192 RPC expects.
  *Effort: 4h | Depends on task above*

- [ ] 🔴 **[MOBILE]** Write a deterministic sign/verify test: sign a known 32-byte hash with a known private key, verify the resulting `(r, s, v)` matches the expected EVM signature. Add as a Swift unit test.
  *Effort: 2h | Depends on implementation*

- [ ] 🔴 **[MOBILE]** End-to-end test: on-device or simulator, sign and broadcast a test transaction to the Chain 8192 testnet. Confirm it lands in a block.
  *Effort: 3h | Depends on testnet being live (A2 + A3)*

---

## SECTION B — High Priority Fixes

---

### B1. Electron RPC Port

**Root cause:** `bucks-browser/electron/services/node.ts` line 38 hardcodes `http://127.0.0.1:8545` (Hardhat/Anvil default). Bucks node listens on port 8192. Local node detection always fails.

- [ ] 🟠 **[DEV]** Change `LOCAL_RPC` in `node.ts` from `http://127.0.0.1:8545` to `http://127.0.0.1:8192`.
  *Effort: 15 min | No dependencies*

- [ ] 🟠 **[DEV]** Make the local RPC URL configurable via env var `BUCKS_RPC_PORT`. Default to `8192`. Update `node.ts` to read `process.env.BUCKS_RPC_PORT ?? '8192'`.
  *Effort: 30 min | Depends on task above*

- [ ] 🟠 **[DEV]** Update CSP `connect-src` in `bucks-browser/renderer/index.html` line 6: replace `http://localhost:8545` with `http://localhost:8192 http://127.0.0.1:8192`. Also remove the hardcoded `https://ipfs.io` (see B3 / E2).
  *Effort: 15 min | No dependencies*

---

### B2. RPC CORS

**Root cause:** `node/config/config.go` line 124 defaults `CORSAllowedOrigins: []string{"*"}`. Any website a user visits can call `eth_sendRawTransaction` against a locally running node.

- [ ] 🟠 **[DEV]** Change default `CORSAllowedOrigins` in `config.go` from `["*"]` to `["http://localhost:3000", "http://localhost:8080", "bucks://", "app://bucks"]`.
  *Effort: 30 min | No dependencies*

- [ ] 🟠 **[DEV]** Add an optional auth token requirement for non-localhost RPC callers: if `--rpc-auth-token` flag is set, require an `Authorization: Bearer <token>` header on all non-loopback requests. Log and reject unauthorized calls.
  *Effort: 1 day | Depends on CORS fix*

- [ ] 🟠 **[DEV]** Document the CORS and auth token configuration in the node operator guide. Include examples for production deployments (e.g. exchange running a full node).
  *Effort: 2h | Depends on implementation*

---

### B3. Environment Variables

**Root cause:** Hardcoded endpoints scattered across all three packages. No `.env.example` files documenting required configuration.

- [ ] 🟠 **[DEV]** Create `bucks-browser/.env.example` documenting all required and optional env vars:
  - `BUCKS_RPC_PORT` (default: 8192)
  - `BUCKS_RPC_URL` (default: https://rpc.bucks.network)
  - `BUCKS_IPFS_GATEWAY` (default: self-hosted)
  - `BUCKS_COMPONENTS_CDN` (default: https://components.bucks.network)
  - Contract addresses for each deployed contract
  *Effort: 2h | No dependencies*

- [ ] 🟠 **[MOBILE]** Create `bucks-android/.env.example` and `bucks-ios/.env.example` (or equivalent `BuildConfig`/`Info.plist` key documents) listing all environment-specific values.
  *Effort: 2h | No dependencies*

- [ ] 🟠 **[DEV]** Add startup validation: on app launch, check all required env vars are present and non-empty. If any are missing, log a descriptive error and fail fast (throw / show error screen). Do not silently use a bad default.
  *Effort: 4h | Depends on .env.example files*

- [ ] 🟠 **[DEV]** Migrate all remaining hardcoded endpoints to env vars. Grep for `bucks.network`, `ipfs.io`, `8192`, `8545` across all source files and replace with config reads.
  *Effort: 1 day | Depends on .env.example files*

---

### B4. Chain ID Consistency

**Root cause:** Chain ID 8192 and testnet ID 81920 appear hardcoded in multiple files across multiple packages, with no single source of truth.

- [ ] 🟠 **[DEV]** Audit every source file across all packages for hardcoded chain IDs. Produce a list of every file and line number (can grep for `8192`, `81920`, `0x2000`, `chainId`).
  *Effort: 2h | No dependencies*

- [ ] 🟠 **[DEV]** Centralize chain configuration in one file per platform:
  - Browser/Electron: `src/config/chains.ts`
  - Android: `app/src/main/java/.../config/ChainConfig.kt`
  - iOS: `BucksBrowser/Config/ChainConfig.swift`
  - Node: `node/config/chain_constants.go`
  Each file exports `CHAIN_8192_ID`, `CHAIN_8192_TESTNET_ID`, `CHAIN_8192_RPC`, etc.
  *Effort: 1 day | Depends on audit*

- [ ] 🟠 **[DEV]** Fix testnet RPC URL collision: `contracts/.env.example` and `contracts/hardhat.config.ts` both default testnet RPC to `http://127.0.0.1:8192` (same as mainnet). Set testnet to a distinct port (`http://127.0.0.1:8193`) or a hosted testnet endpoint. Ensure `chainId: 81920` in Hardhat config matches `genesis.go`'s `TestnetGenesis()`.
  *Effort: 1h | Depends on centralization*

---

## SECTION C — Smart Contract Infrastructure

---

### C1. Contract Architecture

- [ ] 🔴 **[CONTRACTS]** Produce a contract architecture document (`contracts/docs/architecture.md`) listing all 7 contracts, their interfaces, events, and cross-contract dependencies. Define the canonical deployment order.
  *Effort: 1 day | No dependencies*

- [ ] 🟠 **[CONTRACTS]** Choose and document the upgrade strategy for each contract:
  - Immutable + migration path (simpler, safer), or
  - OpenZeppelin UUPS/Transparent proxy (upgradeable)
  For financial contracts (`EscrowVault`, `SlashingPool`), prefer immutable with formal migration procedures.
  *Effort: 1 day | Depends on architecture doc*

- [ ] 🟠 **[CONTRACTS]** Implement proxy pattern for contracts that need upgradeability (`AgentRegistry`, `GlobalProfile`). Use OpenZeppelin's `UUPSUpgradeable` with a Gnosis Safe as upgrade admin.
  *Effort: 3 days | Depends on upgrade strategy decision*

- [ ] 🟠 **[CONTRACTS]** Define and implement role-based access control (OpenZeppelin `AccessControl`) for each contract. At minimum: `DEFAULT_ADMIN_ROLE`, `ORACLE_ROLE` (Soul Engine), `OPERATOR_ROLE`.
  *Effort: 2 days | Depends on architecture doc*

- [ ] 🟡 **[CONTRACTS]** Write a deployment runbook (`contracts/docs/deploy-runbook.md`): step-by-step instructions for testnet and mainnet deployments, including pre-flight checklist, gas estimation, and rollback procedures.
  *Effort: 4h | Depends on architecture and deploy scripts (A3)*

---

### C2. Testing

- [ ] 🟠 **[CONTRACTS]** Write Hardhat test suite for `SoulEngineOracle.sol`: test address update, pause/unpause, access control, zero-address guard.
  *Effort: 1 day | Depends on oracle contract (A3)*

- [ ] 🟠 **[CONTRACTS]** Write Hardhat test suite for `EscrowVault.sol`: test deposit, release, dispute, refund, reentrancy guard, fee calculation.
  *Effort: 2 days | Depends on contract*

- [ ] 🟠 **[CONTRACTS]** Write Hardhat test suite for `GlobalProfile.sol`, `PersonalProfile.sol`, `SkillsetProfile.sol`: CRUD operations, soul identity verification, duplicate prevention.
  *Effort: 2 days | Depends on contracts*

- [ ] 🟠 **[CONTRACTS]** Write Hardhat test suite for `AgentRegistry.sol` and `PinningRewards.sol` / `SlashingPool.sol`: registration, slashing logic, reward distribution, edge cases (zero stake, self-slash attempt).
  *Effort: 2 days | Depends on contracts*

- [ ] 🟡 **[CONTRACTS]** Achieve >90% line and branch coverage. Use `hardhat-coverage` and enforce the threshold in CI — fail the build if coverage drops below 90%.
  *Effort: 1 day | Depends on all test suites*

- [ ] 🟡 **[CONTRACTS]** Add fuzz testing for numeric operations: use Foundry's `forge fuzz` or Echidna to fuzz `EscrowVault` fee math and `SlashingPool` proportional slash calculations.
  *Effort: 2 days | Depends on test suites*

---

### C3. Audit Prep

- [ ] 🟡 **[SECURITY]** Complete internal audit checklist for every contract. Check: reentrancy (use checks-effects-interactions), integer overflow (Solidity 0.8+ auto-reverts, but verify), access control on all state-changing functions, event emission for all state changes, front-running risks, denial-of-service vectors.
  *Effort: 3 days | Depends on test suite*

- [ ] 🟡 **[SECURITY]** Scope and engage a third-party smart contract auditor. Prepare audit package: contract source, NatSpec docs, test suite, architecture doc, known issues list.
  *Effort: 1 week (coordination) + 2–4 weeks (audit timeline) | Depends on internal audit*

- [ ] 🟡 **[SECURITY]** Remediate all findings from third-party audit. Re-test. Re-audit if critical or high findings were found.
  *Effort: 1–2 weeks | Depends on audit*

- [ ] 🟢 **[SECURITY]** Set up a bug bounty program (e.g. Immunefi) with scope limited to deployed Chain 8192 contracts. Define payout tiers: Critical ($10k+), High ($5k), Medium ($1k), Low ($250).
  *Effort: 3 days | Depends on mainnet deployment*

---

## SECTION D — Mobile Backend

---

### D1. Android

- [ ] 🟠 **[MOBILE]** Add missing permissions to `bucks-mobile/app/src/main/AndroidManifest.xml`:
  - `FOREGROUND_SERVICE`
  - `FOREGROUND_SERVICE_DATA_SYNC` (API 34+)
  - `WAKE_LOCK`
  Add `<service>` declarations for any WorkManager `ListenableWorker` running as a foreground service.
  *Effort: 2h | No dependencies*

- [ ] 🟠 **[MOBILE]** Add release `signingConfigs` to both `bucks-mobile/app/build.gradle.kts` and `bucks-android/app/build.gradle.kts`. Source all credentials from environment variables (`KEYSTORE_PATH`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`). Wire into release build type.
  *Effort: 2h | Blocked by: keystore generation*

- [ ] 🟡 **[MOBILE]** Generate and securely store the Android release keystore. Store in a password manager and as a CI secret (base64-encoded). Document the recovery procedure if the keystore is lost.
  *Effort: 2h | No dependencies*

- [ ] 🟡 **[MOBILE]** Add network security config (`res/xml/network_security_config.xml`): pin TLS certificates for `*.bucks.network` domains. Reference it in `AndroidManifest.xml` via `android:networkSecurityConfig`.
  *Effort: 4h | Depends on TLS certs being stable*

- [ ] 🟡 **[MOBILE]** Downgrade `androidx.security:security-crypto` from `1.1.0-alpha06` to stable `1.0.0` in `libs.versions.toml`. Test that all encrypted SharedPreferences usages still compile and function.
  *Effort: 2h | No dependencies*

- [ ] 🟡 **[MOBILE]** Add WorkManager constraints for background mining tasks: require `NetworkType.CONNECTED`, `requiresBatteryNotLow(true)`, and `requiresStorageNotLow(true)`. Document rationale in code comments.
  *Effort: 2h | Depends on foreground service declaration*

- [ ] 🟡 **[MOBILE]** Add ProGuard/R8 rules for release builds: keep rules for web3j, kotlinx.serialization, and any reflection-heavy libraries. Test that a release build runs correctly (not just debug).
  *Effort: 4h | Depends on signing config*

---

### D2. iOS

- [ ] 🟠 **[MOBILE]** Create `bucks-ios/BucksBrowser/BucksBrowser.entitlements` with at minimum:
  - `keychain-access-groups`: for wallet key persistence
  - `aps-environment`: `development` / `production` for push notifications
  - `com.apple.developer.associated-domains`: `applinks:bucks.network` for universal links
  Add the entitlements file to the Xcode target's Signing & Capabilities tab.
  *Effort: 2h | No dependencies*

- [ ] 🟠 **[MOBILE]** Register all BGTaskScheduler identifiers in `Info.plist` under `BGTaskSchedulerPermittedIdentifiers`. Verify that every `BGTaskScheduler.shared.register(forTaskWithIdentifier:...)` call in `BucksBrowserApp.swift` / `MinerService.swift` uses an identifier that exactly matches an entry in `Info.plist`. Add a unit test that asserts the match.
  *Effort: 3h | No dependencies*

- [ ] 🟡 **[MOBILE]** Configure App Transport Security in `Info.plist`: allow `localhost` for local RPC (`NSAllowsLocalNetworking: true`), and set `NSExceptionDomains` for `bucks.network` if certificate pinning is in use.
  *Effort: 2h | No dependencies*

- [ ] 🟡 **[MOBILE]** Set up iOS distribution: create a Distribution certificate and provisioning profile in the Apple Developer portal. Configure `ExportOptions.plist` with the correct team ID and provisioning profile UUID. Document the process for CI.
  *Effort: 4h | Blocked by: Apple Developer account setup*

- [ ] 🟢 **[MOBILE]** Replace deprecated `accompanist-systemuicontroller` on Android with `activity.enableEdgeToEdge()` + `WindowInsets` API from `androidx.activity:activity-compose`. Remove the dependency from `libs.versions.toml`.
  *Effort: 4h | No dependencies*

---

## SECTION E — API / RPC Layer

---

### E1. RPC Node Setup

- [ ] 🟠 **[INFRA]** Provision at least 3 full nodes for `rpc.bucks.network`. Configure DNS load balancing (round-robin or geo-based). Each node should run the Bucks node binary with RPC exposed on port 8192.
  *Effort: 2 days | Depends on boot nodes (A2)*

- [ ] 🟠 **[INFRA]** Set up WebSocket RPC endpoint at `wss://rpc.bucks.network`. This is required for `eth_subscribe` (new blocks, pending txs) used by the wallet and mobile apps.
  *Effort: 4h | Depends on RPC nodes*

- [ ] 🟠 **[INFRA]** Configure rate limiting on the public RPC: max 100 requests/second per IP, with burst allowance of 200. Use nginx or a reverse proxy (Caddy, HAProxy) in front of the nodes.
  *Effort: 4h | Depends on RPC nodes*

- [ ] 🟡 **[INFRA]** Add a health check endpoint: `GET https://rpc.bucks.network/health` returns `{ "status": "ok", "blockNumber": <n>, "chainId": 8192 }`. Used by monitoring (Section H).
  *Effort: 2h | Depends on RPC nodes*

- [ ] 🟡 **[INFRA]** Configure TLS termination with auto-renewing Let's Encrypt certificates for all public endpoints. Set up cert renewal alerts (see H3).
  *Effort: 4h | Depends on RPC nodes*

- [ ] 🟡 **[INFRA]** Set production pool mining endpoint: update `miner/config/config.go` `Pool.URL` default to `stratum+tcp://pool.bucks.network:3333`. Ensure pool server is live before pointing miners at it.
  *Effort: 1h (config) + pool setup time | Blocked by: pool server infrastructure*

---

### E2. IPFS Infrastructure

- [ ] 🟠 **[INFRA]** Replace hardcoded `https://ipfs.io` gateway in `bucks-browser/electron/main.ts` (lines 183, 202) with the embedded Helia node already present in `electron/ipfs-node.js`. Route all `ipfs://` and `ipns://` requests through the local Helia instance.
  *Effort: 4h | No dependencies*

- [ ] 🟠 **[INFRA]** Stand up a self-hosted IPFS gateway at `ipfs.bucks.network` as a fallback when the embedded node is not available. Configure as a read-only public gateway with rate limiting.
  *Effort: 1 day | No dependencies*

- [ ] 🟠 **[INFRA]** Replace hardcoded IPFS cluster secret (`'BUCKS_DEFAULT_CLUSTER'` in `bucks browser/electron/main.js` line 129) with a randomly generated 32-byte hex secret per installation. Generate on first run, store in the user data directory (`app.getPath('userData')/cluster.secret`).
  *Effort: 3h | No dependencies*

- [ ] 🟡 **[INFRA]** Set up a pinning service for Soul Identity profiles. All profile CIDs must be pinned to ensure availability. Evaluate: self-hosted IPFS cluster, Pinata, or web3.storage as a backend.
  *Effort: 2 days | Depends on IPFS gateway*

- [ ] 🟡 **[INFRA]** Configure a CDN layer (Cloudflare or CloudFront) in front of the IPFS gateway for frequently accessed content (profile avatars, component manifests). Cache TTL: 1 hour for profiles, 24 hours for static assets.
  *Effort: 4h | Depends on IPFS gateway*

---

### E3. Component Distribution CDN

- [ ] 🟠 **[INFRA]** Provision `components.bucks.network` CDN for serving Soul Engine model files and miner binaries. Confirm all paths referenced in `bucks-mobile` and `bucks-ios` `fallbackUrl` fields are populated with actual binaries.
  *Effort: 1 day | Blocked by: model and binary build pipeline*

- [ ] 🟠 **[SECURITY]** Implement signed downloads: for every binary served from `components.bucks.network`, publish a SHA-256 checksum and Ed25519 signature in the component manifest. Verify signatures client-side before executing any downloaded binary.
  *Effort: 2 days | Depends on CDN setup*

- [ ] 🟡 **[INFRA]** Publish a version manifest at `components.bucks.network/manifest.json` listing all available components, their versions, download URLs, checksums, and Ed25519 signatures. Update on every release.
  *Effort: 4h | Depends on signed downloads*

- [ ] 🟢 **[INFRA]** Set up S3-compatible fallback (AWS S3 or Cloudflare R2) for large model files (>500 MB). Reference from the manifest's `fallbackUrl` field. Ensure the same signing/verification applies to fallback downloads.
  *Effort: 4h | Depends on manifest*

---

## SECTION F — DevOps & CI/CD

---

### F1. Git Configuration

- [ ] 🟠 **[DEVOPS]** Audit all three `.gitignore` files (`bucks-browser/`, `bucks-mobile/`, `bucks-ios/`). Add missing patterns:
  - `bucks-browser/.gitignore`: add `src/crypto/wordlist.ts`, `src/crypto/wordlist.private.ts`, `renderer/src/crypto/wordlist.ts`, `.env`, `.env.local`, `deployments/chain-8192/*.json` (except `.gitkeep`)
  - `bucks-android/.gitignore`: add `*.keystore`, `*.jks`, `.env`, `local.properties` (if not already)
  - `bucks-ios/.gitignore`: add `*.p12`, `*.mobileprovision`, `.env`, `Secrets.swift`
  *Effort: 2h | No dependencies*

- [ ] 🟠 **[DEVOPS]** Install and configure `git-secrets` or `truffleHog` as a pre-commit hook across all repos. Add patterns for: private keys (0x + 64 hex chars), mnemonics (12/24 word patterns), API key formats.
  *Effort: 4h | No dependencies*

- [ ] 🟡 **[DEVOPS]** Set up branch protection rules on `main` and `release/*` branches in all three repos:
  - Require PR reviews (at least 1 approver)
  - Require all CI checks to pass
  - No direct pushes to main
  - Require linear history (no merge commits)
  *Effort: 1h | No dependencies*

---

### F2. CI Pipeline

- [ ] 🟠 **[DEVOPS]** Create GitHub Actions workflow for `bucks-browser`: `lint → type-check → unit-test → build → security-scan`. Run on every PR and push to main. Cache `node_modules` between runs.
  *Effort: 1 day | No dependencies*

- [ ] 🟠 **[DEVOPS]** Create GitHub Actions workflow for `bucks-mobile` (Android): `lint → ktlint → unit-test → build APK`. Use a `ubuntu-latest` runner. Cache Gradle dependencies.
  *Effort: 1 day | Depends on signing config (D1)*

- [ ] 🟠 **[DEVOPS]** Create GitHub Actions workflow for `bucks-ios`: `lint (SwiftLint) → unit-test → build archive`. Requires a `macos-latest` runner. Cache Swift Package Manager dependencies.
  *Effort: 1 day | Depends on iOS entitlements (D2)*

- [ ] 🟡 **[DEVOPS]** Add Electron-specific CI jobs: build for macOS, Windows, and Linux on each PR. Use `electron-builder` and verify the output binary runs (smoke test: launch and check version).
  *Effort: 1 day | Depends on browser workflow*

- [ ] 🟡 **[DEVOPS]** Add security scan step to all CI pipelines:
  - Browser: `npm audit --audit-level=high` fails CI on high/critical CVEs
  - Android: `./gradlew dependencyCheckAnalyze` (OWASP Dependency-Check)
  - iOS: `swift package audit` or Snyk
  *Effort: 1 day | Depends on CI workflows*

- [ ] 🟡 **[CONTRACTS]** Add Hardhat CI workflow: `compile → lint (solhint) → test → coverage-check (>90%)`. Run on every PR touching `contracts/`.
  *Effort: 4h | Depends on test suite (C2)*

---

### F3. Release Pipeline

- [ ] 🟠 **[DEVOPS]** Enforce semantic versioning: use `standard-version` or `semantic-release` to auto-bump versions and generate changelogs from conventional commits. Block releases that don't follow the convention.
  *Effort: 4h | Depends on CI pipelines*

- [ ] 🟡 **[DEVOPS]** Electron release pipeline: on tag push (`v*`), build signed installers for all three platforms:
  - macOS: code sign with Apple Developer cert + notarize via `electron-notarize`
  - Windows: sign with Windows Authenticode cert (EV cert preferred)
  - Linux: build `.AppImage` and `.deb`
  *Effort: 2 days | Depends on code signing certs*

- [ ] 🟡 **[DEVOPS]** Android release pipeline: on tag push, build signed release AAB and upload to Google Play internal track via Fastlane or the Google Play API.
  *Effort: 1 day | Depends on signing config and Play Store account*

- [ ] 🟡 **[DEVOPS]** iOS release pipeline: on tag push, build signed archive and upload to TestFlight via `fastlane deliver` or Xcode Cloud.
  *Effort: 1 day | Depends on iOS distribution setup (D2)*

- [ ] 🟢 **[DEVOPS]** Auto-generate release notes from conventional commit history. Publish to GitHub Releases and pin to the `#releases` channel (if Slack/Discord is set up).
  *Effort: 2h | Depends on semantic versioning*

---

## SECTION G — Security Hardening

---

### G1. Secrets Management

- [ ] 🔴 **[SECURITY]** Replace all placeholder API keys in `bucks browser/agent/.env` (`LITAI_API_KEY=your_lightning_ai_key_here`, `NGC_API_KEY=your_nvidia_ngc_key_here`) with real keys sourced from a secrets manager (AWS Secrets Manager, HashiCorp Vault, or 1Password Secrets Automation). Never commit real keys.
  *Effort: 2h | Blocked by: API key procurement*

- [ ] 🟠 **[SECURITY]** Define and document a secrets rotation schedule: API keys (90 days), RPC auth tokens (180 days), contract owner keys (annual + on staff change), TLS certificates (auto-renew via Let's Encrypt).
  *Effort: 4h | No dependencies*

- [ ] 🟠 **[SECURITY]** For contract owner/deployer keys, use a hardware security module (HSM) or MPC key management service (e.g. Fireblocks, Dfns) rather than a raw private key in a `.env` file. The contract admin key controls upgrades and oracle address changes — it must never exist on a server disk in plaintext.
  *Effort: 1 week | Blocked by: vendor selection and budget*

- [ ] 🟡 **[SECURITY]** Implement a dead man's switch for the contract admin role: if the admin address has not submitted a transaction in 180 days, allow a secondary multisig to reclaim control. Prevents permanent lock-out.
  *Effort: 2 days | Depends on contract architecture (C1)*

---

### G2. Electron Security Checklist

- [ ] 🟠 **[SECURITY]** Verify `bucks-browser` main window `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`. Confirm `sandbox: false` comment is accurate (needed for keytar) and tracked as a known risk.
  *Effort: 1h | No dependencies*

- [ ] 🟠 **[SECURITY]** Implement the keytar isolation fix: move all keytar calls to the main process IPC handlers (they're already behind IPC in `ipc-handlers.ts`). Set `sandbox: true` on the renderer window. Test that wallet unlock still works.
  *Effort: 1 day | No dependencies*

- [ ] 🟠 **[SECURITY]** Fix legacy `bucks browser` CSP: add `session.defaultSession.webRequest.onHeadersReceived` in `main.js` to inject a `Content-Security-Policy` header. Use: `default-src 'self'; script-src 'self'; connect-src 'self' https://rpc.bucks.network http://localhost:8192; img-src 'self' data:; style-src 'self' 'unsafe-inline'`.
  *Effort: 2h | No dependencies*

- [ ] 🟠 **[SECURITY]** Address `webviewTag: true` in legacy `bucks browser/electron/main.js` line 185: either migrate all `<webview>` usages to `BrowserView` (already used in `bucks-browser`) or add a `will-attach-webview` handler that enforces `nodeIntegration=false`, `contextIsolation=true`, `disablewebsecurity=false` on every webview.
  *Effort: 1 day | No dependencies*

- [ ] 🟡 **[SECURITY]** Disable the Electron `remote` module if it is in use anywhere. Audit all renderer-side IPC calls and confirm they go through the `contextBridge` preload only. No direct `ipcRenderer.send` without a corresponding whitelisted handler.
  *Effort: 4h | No dependencies*

- [ ] 🟡 **[SECURITY]** Upgrade Electron from `28.x` (EOL June 2024) to `32.x` (current stable). Replace deprecated `electron-rebuild` with `@electron/rebuild`. Test native module (`keytar`) compatibility after upgrade. This is a security fix — Electron 28 receives no CVE patches.
  *Effort: 1 day | No dependencies*

---

### G3. Dependency Audit

- [ ] 🟠 **[SECURITY]** Run `npm audit --audit-level=moderate` on `bucks-browser`. Fix or document all high and critical findings. Set up Dependabot on the GitHub repo for automatic security PRs.
  *Effort: 4h | No dependencies*

- [ ] 🟠 **[SECURITY]** Run OWASP Dependency-Check (`./gradlew dependencyCheckAnalyze`) on `bucks-mobile` / `bucks-android`. Check `web3j:4.10.3` specifically — upgrade to latest stable 4.x or 5.x after reviewing release notes and CVE database.
  *Effort: 4h | No dependencies*

- [ ] 🟡 **[SECURITY]** Run `swift package show-dependencies` and check all iOS dependencies for known CVEs. Pay special attention to `Boilertalk/secp256k1.swift` — crypto libraries must be pinned to exact versions and audited.
  *Effort: 2h | No dependencies*

- [ ] 🟡 **[SECURITY]** Set up Dependabot on all three repos with separate configs for npm, Gradle, and Swift PM. Configure weekly update PRs for patch/minor, manual review for major.
  *Effort: 2h | No dependencies*

---

## SECTION H — Monitoring & Observability

---

### H1. Chain Monitoring

- [ ] 🟡 **[INFRA]** Deploy a block explorer for Chain 8192. Options: Blockscout (open source, self-hostable) at `explorer.bucks.network`. Configure to index from genesis block.
  *Effort: 3 days | Depends on boot nodes (A2) and RPC nodes (E1)*

- [ ] 🟡 **[INFRA]** Set up alerting: if no new block is produced for >60 seconds, fire a PagerDuty / OpsGenie alert to the on-call engineer. Use a simple polling script against the health endpoint (E1).
  *Effort: 4h | Depends on health endpoint and RPC nodes*

- [ ] 🟡 **[INFRA]** Set up alerting: if any of the 3 RPC nodes goes down (health check fails for >30 seconds), fire an alert. Also alert if the load balancer detects all nodes are unhealthy.
  *Effort: 2h | Depends on health endpoint*

- [ ] 🟢 **[INFRA]** Configure block explorer to expose a public API at `explorer.bucks.network/api`. Document the API for third-party developers wanting to build on Chain 8192.
  *Effort: 2h | Depends on block explorer*

---

### H2. Application Monitoring

- [ ] 🟡 **[DEVOPS]** Integrate Sentry error tracking into `bucks-browser` (both Electron main and renderer processes). Configure PII scrubbing rules: never log private keys, seed phrases, or wallet addresses in error reports.
  *Effort: 4h | No dependencies*

- [ ] 🟡 **[DEVOPS]** Integrate Sentry into `bucks-mobile` (Android) and `bucks-ios`. Configure `beforeSend` hooks to strip any sensitive fields from error events before they leave the device.
  *Effort: 4h | No dependencies*

- [ ] 🟡 **[DEVOPS]** Set up performance monitoring for the Electron renderer: track time-to-interactive, wallet unlock duration, and transaction signing latency. Alert if p99 exceeds 2× baseline.
  *Effort: 4h | Depends on Sentry integration*

- [ ] 🟢 **[DEVOPS]** Implement crash reporting for mobile: ensure Sentry captures unhandled exceptions and ANRs (Android) / app crashes (iOS). Review crash reports weekly during beta.
  *Effort: 2h | Depends on Sentry integration*

- [ ] 🟢 **[DEVOPS]** Set up a dashboard (Grafana or Datadog) aggregating: chain block rate, RPC request volume, error rate, p95 latency, and IPFS gateway response time.
  *Effort: 1 day | Depends on all monitoring integrations*

---

### H3. Infrastructure Monitoring

- [ ] 🟡 **[INFRA]** Set up uptime monitoring for all public endpoints using UptimeRobot, Checkly, or self-hosted Uptime Kuma:
  - `https://rpc.bucks.network/health`
  - `wss://rpc.bucks.network`
  - `https://ipfs.bucks.network`
  - `https://components.bucks.network/manifest.json`
  - `https://explorer.bucks.network`
  Alert on 2 consecutive failures (< 1 min downtime detection).
  *Effort: 2h | Depends on all endpoints being live*

- [ ] 🟡 **[INFRA]** Configure SSL certificate expiry alerts: alert 30 days before expiry for all `*.bucks.network` certificates. Use Checkly, a cron job calling `openssl`, or Cloudflare's cert monitoring.
  *Effort: 2h | Depends on endpoints*

- [ ] 🟡 **[INFRA]** Monitor IPFS node health: confirm the embedded Helia node in Electron successfully connects to peers on startup. Log peer count and alert if it drops to 0 for >5 minutes.
  *Effort: 3h | Depends on IPFS fix (E2)*

- [ ] 🟢 **[INFRA]** Set up log aggregation: ship structured logs from all RPC nodes, boot nodes, and the IPFS gateway to a central store (Loki + Grafana, or Elasticsearch). Retain 30 days of logs minimum.
  *Effort: 1 day | Depends on all infrastructure being live*

---

## Appendix: Audit Finding Cross-Reference

| Audit Finding | Section(s) | Status |
|---------------|-----------|--------|
| #1 PBKDF2 2,048 iterations | A1 | All tasks defined |
| #2 Boot node placeholder peer IDs | A2 | All tasks defined |
| #3 Soul Engine oracle zero address | A3 | All tasks defined |
| #4 iOS secp256k1 stub | A4 | All tasks defined |
| #5 RPC CORS wildcard | B2 | All tasks defined |
| #6 Electron wrong RPC port (8545) | B1 | All tasks defined |
| #7 CSP wrong local port | B1 | All tasks defined |
| #8 IPFS hardcoded to ipfs.io | E2 | All tasks defined |
| #9 Legacy Electron no CSP | G2 | All tasks defined |
| #10 No deployed contract addresses | A3, C1 | All tasks defined |
| #11 webviewTag without sandbox | G2 | All tasks defined |
| #12 sandbox: false on main window | G2 | All tasks defined |
| #13 No Android release signingConfig | D1 | All tasks defined |
| #14 Missing Android permissions | D1 | All tasks defined |
| #15 Alpha security-crypto library | D1 | All tasks defined |
| #16 No iOS entitlements file | D2 | All tasks defined |
| #17 Testnet RPC same as mainnet | B4 | All tasks defined |
| #18 Hardcoded IPFS cluster secret | E2 | All tasks defined |
| #19 Electron 28 EOL | G2 | All tasks defined |
| #20 accompanist-systemuicontroller deprecated | D2 | All tasks defined |
| #21 web3j 4.10.3 CVE check | G3 | All tasks defined |
| #22 BGTaskScheduler identifier mismatch | D2 | All tasks defined |
| #23 .gitignore wordlist gap | F1 | All tasks defined |
| #24 Production pool endpoint missing | E1 | All tasks defined |
| #25 components.bucks.network not verified | E3 | All tasks defined |
| #26 Android Play signing not configured | D1 | All tasks defined |
| #27 Cloud AI keys are placeholders | G1 | All tasks defined |

---

*All 27 audit findings are addressed. 62 additional hardening tasks are included beyond the audit scope.*

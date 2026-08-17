# Bucks Browser — Full Architecture Specification
> A full-fledged Chromium browser with Web3 native at every layer  
> Chain ID: 8192 · Soul Engine · 114-layer resonance architecture

---

## Table of Contents
1. [Product Vision](#1-product-vision)
2. [Chromium Embedding Strategy](#2-chromium-embedding-strategy)
3. [Native Web3 Service Layer](#3-native-web3-service-layer)
4. [UI Surface Map](#4-ui-surface-map)
5. [Protocol Handlers](#5-protocol-handlers)
6. [Security Architecture](#6-security-architecture)
7. [Developer API — dApp Integration](#7-developer-api--dapp-integration)
8. [Component Integration Map](#8-component-integration-map)
9. [Build & Distribution](#9-build--distribution)
10. [Phased Delivery Plan](#10-phased-delivery-plan)

---

## 1. Product Vision

Bucks Browser is not a wallet extension added to a browser.  
**It is the browser — with Web3, AI, and decentralized infrastructure built into the engine.**

| Comparison | MetaMask + Chrome | Brave Browser | **Bucks Browser** |
|---|---|---|---|
| Wallet | Extension (injected) | Built-in | **Native browser service** |
| dApp connection | Manual "Connect Wallet" | Semi-auto | **Always connected — zero friction** |
| IPFS | Via gateway redirect | Basic support | **Native node, native protocol** |
| AI | None | None | **Soul Engine on-device inference** |
| Mining | Separate app | None | **Integrated sidebar panel** |
| Identity | None | None | **GlobalProfile in browser chrome** |
| Smart contracts | Via dApp UI | Via dApp UI | **Native signing UI + contract browser** |
| App Store | Chrome Web Store | None | **IPFS-pinned decentralized store** |

The result: a user opens Bucks Browser and their entire Web3 identity, wallet, AI assistant, and marketplace are immediately available — on every tab, on every site, with one-tap signing.

---

## 2. Chromium Embedding Strategy

### 2.1 Recommended Stack: Electron + Chromium + Node.js Services

Rather than a full Chromium fork (which requires maintaining a chromium patch set — extremely costly), Bucks Browser uses **Electron** as the Chromium shell with privileged Node.js background services. This is the same approach as:
- VS Code (Microsoft)
- Slack desktop
- **Brave Browser** (before they moved to full fork)

The architecture separates concerns cleanly:

```
┌─────────────────────────────────────────────────────────────┐
│                    Bucks Browser Process                     │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Electron Main Process (Node.js)          │  │
│  │                                                      │  │
│  │  BucksWalletService    ← key management, signing     │  │
│  │  BucksNodeService      ← light/full chain node       │  │
│  │  IPFSService           ← local IPFS node (Helia)     │  │
│  │  SoulEngineService     ← on-device AI inference      │  │
│  │  MinerService          ← optional background miner   │  │
│  │  ProfileService        ← reads chain, caches profile │  │
│  │  AppStoreService       ← resolves IPFS app manifests │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │ IPC (contextBridge)              │
│  ┌───────────────────────▼──────────────────────────────┐  │
│  │           Chromium Renderer (BrowserView)             │  │
│  │                                                      │  │
│  │  window.bucks          ← injected Web3 provider      │  │
│  │  window.ipfs           ← IPFS API bridge             │  │
│  │  window.soulEngine     ← AI query API                │  │
│  │                                                      │  │
│  │  [Web content rendered here — dApps, websites]       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Browser Chrome UI (React)                │  │
│  │  Toolbar · Sidebar · New Tab · Settings · Panels     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Why Not a Full Chromium Fork?

| Factor | Full Chromium Fork | Electron Shell |
|---|---|---|
| Dev effort | 6–12 months initial, ongoing patch maintenance | 4–8 weeks to production |
| Security updates | Manual cherry-pick from Chromium upstream | Electron auto-updates Chromium |
| Web compatibility | 100% (you control it) | 100% (uses same Chromium) |
| Native protocol handlers | Easier (C++ level) | Possible via Electron protocol API |
| Distribution | Self-managed | electron-builder → .dmg/.exe/.deb |

**Decision: Electron shell for v1.0.** Migrate to full Chromium fork only if custom protocol handling or performance demands it (v3.0+).

### 2.3 Electron Configuration

```javascript
// main.js — core configuration
const { app, BrowserWindow, BrowserView, protocol, ipcMain } = require('electron');

app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');
app.commandLine.appendSwitch('disable-web-security', 'false'); // keep security ON
app.commandLine.appendSwitch('enable-blink-features', 'WebBluetooth');

// Register custom protocols
protocol.registerSchemesAsPrivileged([
  { scheme: 'bucks',  privileges: { secure: true, standard: true, supportFetchAPI: true } },
  { scheme: 'ipfs',   privileges: { secure: true, standard: true, supportFetchAPI: true } },
  { scheme: 'ipns',   privileges: { secure: true, standard: true, supportFetchAPI: true } },
]);
```

---

## 3. Native Web3 Service Layer

Seven background services run in the main Electron process. Each is a singleton with a defined IPC API.

### 3.1 BucksWalletService

Responsibilities: key storage, account management, transaction signing, BIP-8192 mnemonic.

```typescript
interface WalletServiceAPI {
  // Account management
  createWallet(password: string): Promise<{ mnemonic: string; address: string }>;
  importWallet(mnemonic: string, password: string): Promise<{ address: string }>;
  unlock(password: string): Promise<boolean>;
  lock(): void;
  getAccounts(): Promise<string[]>;
  getActiveAccount(): Promise<string | null>;

  // Signing
  signTransaction(tx: TransactionRequest): Promise<string>;
  signMessage(message: string): Promise<string>;
  signTypedData(domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, unknown>): Promise<string>;

  // Balance
  getBalance(address?: string): Promise<string>; // in grains (wei equivalent)
  getFormattedBalance(address?: string): Promise<string>; // "12.50 BUCKS"

  // Status
  isLocked(): boolean;
  isCreated(): boolean;
}
```

Key management:
- Keys stored in OS keychain (macOS Keychain, Windows Credential Store, Linux Secret Service) via `keytar`
- In-memory session key with 15-minute auto-lock
- BIP-8192 derivation path: `m/44'/8192'/0'/0/n`
- Biometric unlock: Touch ID on macOS, Windows Hello on Windows

### 3.2 BucksNodeService

Runs a light client (SPV) by default. Power users can enable full node mode.

```typescript
interface NodeServiceAPI {
  getMode(): 'light' | 'full' | 'remote';
  setRpcEndpoint(url: string): void;
  getRpcEndpoint(): string;

  // Chain state
  getBlockNumber(): Promise<number>;
  getChainId(): Promise<number>; // always 8192
  getNetworkStatus(): Promise<{ connected: boolean; peers: number; synced: boolean }>;

  // RPC passthrough
  call(method: string, params: unknown[]): Promise<unknown>;

  // Events
  onNewBlock(cb: (block: BlockHeader) => void): void;
  onNetworkChange(cb: (network: Network) => void): void;
}
```

Default RPC: `https://rpc.bucks.network` (public node cluster). Users who run `bucksnode` locally connect to `http://localhost:8545`.

### 3.3 IPFSService

Runs a local Helia (IPFS) node. Handles IPFS content fetching, pinning, and publishing.

```typescript
interface IPFSServiceAPI {
  // Fetch
  cat(cid: string): Promise<Uint8Array>;
  catJSON<T>(cid: string): Promise<T>;
  catText(cid: string): Promise<string>;

  // Publish
  add(data: string | Uint8Array): Promise<string>; // returns CID
  addJSON(obj: Record<string, unknown>): Promise<string>;

  // Pin
  pin(cid: string): Promise<void>;
  unpin(cid: string): Promise<void>;
  isPinned(cid: string): Promise<boolean>;

  // Status
  getNodeId(): Promise<string>;
  getPeers(): Promise<string[]>;
  getBandwidth(): Promise<{ in: number; out: number }>;
}
```

Content routing: connects to Bucks IPFS cluster bootstrap nodes on startup. All app store artifacts, profile metadata CIDs, and contract terms documents are fetched through this service.

### 3.4 SoulEngineService

On-device AI inference using the Soul Engine — a proprietary neural architecture trained on an ancient corpus of human wisdom (114-layer resonance architecture). Runs GGUF-quantized models via `llama.cpp` bindings.

```typescript
interface SoulEngineServiceAPI {
  // Query
  query(prompt: string, options?: QueryOptions): Promise<string>;
  stream(prompt: string, onToken: (token: string) => void): Promise<void>;

  // Attestation (reads from chain oracle)
  getAttestation(address: string, claimType: string): Promise<Attestation>;
  isVerified(address: string): Promise<boolean>;

  // Context-aware assistance
  analyzeContract(contractABI: string, calldata: string): Promise<ContractAnalysis>;
  reviewTransaction(tx: TransactionRequest): Promise<TransactionReview>;

  // Status
  getModelInfo(): Promise<{ name: string; layers: number; quantization: string }>;
  isReady(): Promise<boolean>;
}
```

Models are downloaded from the IPFS App Store on first run. Smallest model (1B, ~800MB) is bundled with the installer. Larger models are optional downloads.

### 3.5 MinerService

Background mining — optional, user-controlled.

```typescript
interface MinerServiceAPI {
  start(walletAddress: string, threads?: number): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;

  getStatus(): MinerStatus; // idle | mining | paused | error
  getHashrate(): number;    // H/s
  getShares(): { accepted: number; rejected: number };
  getEarnings(): Promise<string>; // BUCKS earned this session

  setThreads(n: number): void;
  setPoolMode(enabled: boolean, poolUrl?: string): void;
}
```

Mining runs as a child process (the `bucksminer` Go binary from Phase 3). The browser controls start/stop via IPC. A toolbar indicator shows mining status (green dot = active).

### 3.6 ProfileService

Caches and serves the user's on-chain profile data.

```typescript
interface ProfileServiceAPI {
  getMyProfile(): Promise<GlobalProfile>;
  getProfile(address: string): Promise<GlobalProfile>;
  getReputation(address: string): Promise<number>;
  isVerified(address: string): Promise<boolean>;

  // Sub-profiles
  getBusinessProfile(address: string): Promise<BusinessProfile | null>;
  getSkillsets(address: string): Promise<SkillsetProfile | null>;
  getAssets(address: string): Promise<AssetSummary>;

  // Sync
  refresh(): Promise<void>; // re-reads from chain
  onProfileUpdate(cb: (profile: GlobalProfile) => void): void;
}
```

### 3.7 AppStoreService

Resolves the decentralized App Store — reads from `AppRegistry` contract, fetches manifests from IPFS.

```typescript
interface AppStoreServiceAPI {
  listApps(category?: string): Promise<AppManifest[]>;
  getApp(name: string): Promise<AppManifest>;
  download(name: string, platform: Platform): Promise<string>; // returns local path
  install(name: string): Promise<void>;
  checkUpdates(): Promise<AppUpdate[]>;
}
```

---

## 4. UI Surface Map

### 4.1 Browser Toolbar

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ← → ↺  🔒 bucks://marketplace/listings          [Search / Command]  ⚙  │
│                                                                         │
│ [W] [●] [Ξ]  ←──── Web3 toolbar pills                    [☰] sidebar  │
│  │   │   │                                                              │
│  │   │   └── Soul Engine AI toggle (pulse when thinking)               │
│  │   └────── Network status: ● green=connected, ● red=offline          │
│  └────────── Wallet pill: "12.50 BUCKS · 0xA3f2..." click to expand    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Wallet pill** (click → dropdown):
- Balance in BUCKS (and mithqal equivalent)
- Active account address (truncated, copy on click)
- Quick Send / Receive buttons
- Pending transactions badge
- Switch account

**Network pill**: shows node connection status, block height, peer count

**Soul Engine toggle**: enables/disables AI sidebar on current page

### 4.2 Right Sidebar (Web3 Panel)

Slides in from right. Five tabs:

```
┌──────────────────────────┐
│  [👤][💼][🛒][⛏][🧠]   │ ← tab bar
│──────────────────────────│
│                          │
│  PROFILE tab:            │
│  Avatar  Name  Score     │
│  ████████████████        │
│  Tier badge  Verified ✓  │
│                          │
│  Business Profile        │
│  Skills (top 3)          │
│  Assets (count)          │
│                          │
│  [View Full Profile]     │
│  [Edit Profile]          │
│──────────────────────────│
│  WALLET tab:             │
│  Balance: 12.50 BUCKS    │
│  ≈ 12.50 mithqal         │
│                          │
│  Recent transactions     │
│  ─────────────────────   │
│  + 2.50 BUCKS  mining    │
│  - 0.50 BUCKS  escrow    │
│                          │
│  [Send] [Receive] [Swap] │
│──────────────────────────│
│  MARKETPLACE tab:        │
│  Active contracts: 2     │
│  Pending offers: 1       │
│  Reputation: 8,420/10k   │
│                          │
│  [Browse Marketplace]    │
│  [My Listings]           │
│──────────────────────────│
│  MINER tab:              │
│  Status: ● Mining        │
│  4 threads · 142 KH/s    │
│  Earned today: 0.25 BUCKS│
│  ████████░░ Difficulty   │
│                          │
│  [Pause] [Settings]      │
│──────────────────────────│
│  SOUL ENGINE tab:        │
│  [Ask anything...]       │
│                          │
│  Context: this page      │
│  ─────────────────────   │
│  Summarize · Translate   │
│  Analyze contract        │
│  Review transaction      │
└──────────────────────────┘
```

### 4.3 New Tab Page

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│              ✦ B U C K S                                               │
│         Soul of the World Browser                                       │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  🔍  Search or enter address / bucks:// / ipfs://               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Your Balance                Network               Mining               │
│  ┌───────────────┐  ┌────────────────────┐  ┌───────────────────────┐ │
│  │ 12.50 BUCKS   │  │ Block #482,340      │  │ ● Active  142 KH/s   │ │
│  │ ≈ 12.50 mithq │  │ 24 peers · synced  │  │ 0.25 BUCKS today     │ │
│  │ [Send][Recv]  │  │ Chain ID: 8192      │  │ [Pause Mining]        │ │
│  └───────────────┘  └────────────────────┘  └───────────────────────┘ │
│                                                                         │
│  Quick Access                                                           │
│  [🛒 Marketplace]  [📦 App Store]  [🏛 DAO]  [📊 Explorer]            │
│                                                                         │
│  Recent dApps                    Soul Engine                            │
│  · bucks://marketplace           [Ask Soul Engine...]                   │
│  · bucks://dao/community-1       ─────────────────────────────────     │
│  · ipfs://Qm...                  "What contracts do I have pending?"    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Transaction Signing Modal

Replaces the MetaMask popup. Appears as an in-browser modal (not a new window):

```
┌─────────────────────────────────┐
│  ✦ Sign Transaction             │
│─────────────────────────────────│
│  To:  BucksEscrow contract      │
│       0x4f3a...d9e2             │
│                                 │
│  Action: Lock payment in escrow │
│                                 │
│  Amount:  5.00 BUCKS            │
│  Gas:     0.0003 BUCKS          │
│  Total:   5.0003 BUCKS          │
│                                 │
│  Counterparty                   │
│  0xB2c1...  ✓ Soul Verified     │
│  Reputation: 9,120 / 10,000     │
│                                 │
│  Soul Engine Analysis:          │
│  ✓ Standard escrow pattern      │
│  ✓ No unusual permissions       │
│  ✓ Funds recoverable on dispute │
│                                 │
│  [Cancel]         [Confirm →]   │
│         [Use Biometric]         │
└─────────────────────────────────┘
```

Key UX decisions:
- Soul Engine auto-analyzes every transaction before signing
- Counterparty reputation shown inline
- Biometric signing available (Touch ID / Windows Hello)
- Never shows raw hex — always human-readable action description

### 4.5 Settings Panels

```
Settings
├── 🔐 Wallet & Security
│     Change password · Biometric · Auto-lock timer · Backup mnemonic
├── 👤 My Profile
│     Edit GlobalProfile · Business Profile · Skills · Assets
├── ⛏ Mining
│     Enable/disable · Thread count · Pool vs solo · Reward address
├── 🧠 Soul Engine
│     Model selection · Download larger model · Context permissions
├── 🌐 Network
│     RPC endpoint · Chain ID · Run local node · Peer connections
├── 📦 App Store
│     Installed apps · Auto-update · IPFS pinning
├── 🔒 Privacy & Permissions
│     Site permissions · Soul Engine data · IPFS sharing
└── 🎨 Appearance
      Theme · Font size · Sidebar position
```

---

## 5. Protocol Handlers

### 5.1 `bucks://` — Native Blockchain URLs

```
bucks://0xContractAddress               → Opens contract interaction UI
bucks://marketplace                     → Opens decentralized marketplace
bucks://marketplace/listings            → Listings browser
bucks://marketplace/listing/0x...       → Single listing detail
bucks://profile/0xAddress              → View any user's GlobalProfile
bucks://dao/community-name             → Community DAO page
bucks://app-store                      → Decentralized App Store
bucks://explorer                       → Block + transaction explorer
bucks://explorer/tx/0xhash             → Transaction detail
bucks://explorer/block/482340          → Block detail
```

### 5.2 `ipfs://` and `ipns://` — Decentralized Content

```
ipfs://QmCID...                        → Fetches content from local IPFS node
ipns://name.bucks                      → Resolves mutable IPNS pointer → IPFS content
```

IPFS resolution: local node first, then IPFS cluster, then public gateway as fallback. Content is pinned locally on first access if < 10MB.

### 5.3 Protocol Handler Implementation

```javascript
// In Electron main process
protocol.handle('bucks', async (request) => {
  const url = new URL(request.url);
  // Route to appropriate renderer page
  if (url.hostname === 'marketplace') {
    return new Response(marketplaceHTML, { headers: { 'content-type': 'text/html' } });
  }
  if (url.hostname.startsWith('0x')) {
    // Contract interaction UI
    const contract = await ContractRegistry.resolve(url.hostname);
    return renderContractUI(contract);
  }
});

protocol.handle('ipfs', async (request) => {
  const cid = request.url.replace('ipfs://', '');
  const content = await ipfsService.cat(cid);
  const mimeType = detectMimeType(content);
  return new Response(content, { headers: { 'content-type': mimeType } });
});
```

---

## 6. Security Architecture

### 6.1 Context Isolation

Every web page runs in a sandboxed renderer with `contextIsolation: true` and `nodeIntegration: false`. The `window.bucks` provider is injected via a preload script that uses `contextBridge` — web content can only call explicitly exposed methods.

```javascript
// preload.js
contextBridge.exposeInMainWorld('bucks', {
  request: (args) => ipcRenderer.invoke('bucks:request', args),
  on: (event, cb) => {
    ipcRenderer.on(`bucks:event:${event}`, (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners(`bucks:event:${event}`);
  }
});
// window.ethereum also mapped for MetaMask-compatible dApps
contextBridge.exposeInMainWorld('ethereum', window.bucks);
```

No Node.js APIs are ever exposed to web content. All privileged operations go through IPC.

### 6.2 Permission System

dApps must request permission before accessing wallet:

| Permission | What it allows | User prompt? |
|---|---|---|
| `bucks_accounts` | Read wallet address | Yes — one-time per site |
| `bucks_sign` | Sign messages | Yes — per message |
| `bucks_sendTransaction` | Send transactions | Yes — per transaction |
| `bucks_getProfile` | Read public profile | Yes — one-time per site |
| `soul_query` | Query Soul Engine | Yes — one-time per site |
| `ipfs_read` | Fetch IPFS content | Silent (public content) |
| `ipfs_pin` | Pin content locally | Yes — per CID |

Permissions stored per origin in encrypted local storage. Can be revoked from Settings → Privacy.

### 6.3 Transaction Security

Before any transaction is presented to the user for signing:
1. Soul Engine analyzes the contract call (detects common exploit patterns)
2. Counterparty reputation is fetched from chain
3. Contract is checked against ContractRegistry (known/unknown flag)
4. Gas estimate is shown in BUCKS (not gwei)
5. Human-readable description is generated from ABI + calldata
6. Warning shown for: unverified contracts, new counterparties, large amounts

High-risk transactions (> 100 BUCKS or Soul Engine flags concern) require biometric re-auth even if session is unlocked.

### 6.4 Key Security

- Private keys NEVER leave the main process
- Keys stored in OS keychain (not localStorage, not files)
- In-memory key cleared after 15-minute idle
- Mnemonic shown only during wallet creation — never recoverable from UI after that (user must back up)
- Clipboard cleared 30 seconds after copying address or mnemonic words

---

## 7. Developer API — dApp Integration

Any website can interact with Bucks Browser using standard Web3 APIs:

```javascript
// Standard EIP-1193 — same as MetaMask
const accounts = await window.bucks.request({ method: 'eth_requestAccounts' });
const chainId = await window.bucks.request({ method: 'eth_chainId' }); // '0x2000' (8192)

// Send transaction
const txHash = await window.bucks.request({
  method: 'eth_sendTransaction',
  params: [{ from: accounts[0], to: CONTRACT, value: '0xDE0B6B3A7640000', data: '0x...' }]
});

// Bucks-specific extensions
const profile = await window.bucks.request({ method: 'bucks_getProfile' });
const verified = await window.bucks.request({ method: 'bucks_isVerified', params: [address] });
const aiResult = await window.bucks.request({ method: 'soul_query', params: ['Summarize this contract'] });

// Events
window.bucks.on('accountsChanged', (accounts) => console.log('Account changed:', accounts));
window.bucks.on('chainChanged', (chainId) => console.log('Chain:', chainId));
window.bucks.on('connect', ({ chainId }) => console.log('Connected'));
window.bucks.on('disconnect', (error) => console.log('Disconnected'));
```

MetaMask compatibility: `window.ethereum` is aliased to `window.bucks` — existing dApps built for Ethereum work on Bucks with no code changes (they just need to switch to Chain ID 8192).

---

## 8. Component Integration Map

```
Existing Build                    Bucks Browser Role
─────────────────────────────────────────────────────────────────

node/ (Go blockchain node)
  └─ bucksnode binary          →  BucksNodeService spawns it (full node mode)
                                  OR connects to remote RPC (light mode)

wallet/ (Browser extension)
  └─ src/crypto/bip8192.ts    →  BucksWalletService uses same crypto primitives
  └─ src/background/vault.ts  →  Merged into BucksWalletService (native, not extension)
  └─ src/popup/ UI            →  Replaces sidebar Wallet tab UI
  └─ src/inpage/index.ts      →  Replaced by preload.js contextBridge (no extension needed)

miner/ (Go miner binary)
  └─ bucksminer binary         →  MinerService spawns as child process
  └─ stats API (:8194)         →  MinerService reads via HTTP, feeds sidebar panel

miner-gui/ (Electron GUI)
  └─ React components          →  Mining sidebar tab (merged into browser UI)
  └─ electron/main.js          →  Merged into browser main process

contracts/ (Hardhat project)
  └─ SoulVerified.sol         →  Base for all profile contracts
  └─ ContractRegistry.sol     →  AppStoreService + protocol handler use it
  └─ BucksEscrow.sol          →  Marketplace escrow (no change needed)
  └─ CommunityTreasury.sol    →  DAO tab + governance UI
  └─ BusinessAgreement.sol    →  Marketplace B2B flows

bucks-contracts-plan.md
  └─ GlobalProfile.sol        →  Phase A — ProfileService reads this
  └─ AssetRegistry.sol        →  Phase B — sidebar Assets panel
  └─ MarketplaceRouter.sol    →  Phase B — Marketplace tab
  └─ AppRegistry.sol          →  AppStoreService
```

---

## 9. Build & Distribution

### 9.1 Repository Structure

```
bucks-browser/
├── electron/
│   ├── main.js              ← Electron entry, service orchestration
│   ├── preload.js           ← contextBridge — window.bucks injection
│   └── services/
│       ├── wallet.ts
│       ├── node.ts
│       ├── ipfs.ts
│       ├── soul-engine.ts
│       ├── miner.ts
│       ├── profile.ts
│       └── app-store.ts
├── renderer/                ← Browser chrome UI (React + Tailwind)
│   ├── toolbar/
│   ├── sidebar/
│   ├── new-tab/
│   ├── settings/
│   ├── signing-modal/
│   └── pages/              ← bucks:// protocol pages
│       ├── marketplace/
│       ├── profile/
│       ├── explorer/
│       └── app-store/
├── binaries/               ← Bundled Go binaries (platform-specific)
│   ├── bucksminer-darwin-arm64
│   ├── bucksminer-darwin-x64
│   ├── bucksminer-linux-x64
│   └── bucksminer-win32-x64.exe
├── models/                 ← Soul Engine model (bundled 1B stub, others downloaded)
│   └── soul-engine-1b.gguf
├── electron-builder.yml
├── package.json
└── vite.config.ts
```

### 9.2 Distribution Targets

| Platform | Format | Size estimate |
|---|---|---|
| macOS (Apple Silicon) | .dmg (arm64) | ~180MB |
| macOS (Intel) | .dmg (x64) | ~185MB |
| Windows | .exe (NSIS installer) | ~200MB |
| Linux | .AppImage + .deb | ~175MB |

Auto-update: Electron's built-in auto-updater polls `updates.bucks.network` (IPFS-backed). Update packages are signed and hash-verified before install.

---

## 10. Phased Delivery Plan

### Phase 1 — Browser Shell + Wallet (Weeks 1–4)
- Electron window with BrowserView for web content
- Toolbar with wallet pill + network status
- Sidebar with Wallet tab
- BucksWalletService (migrated from wallet/ extension)
- BucksNodeService (connects to remote RPC)
- `bucks://` protocol handler (basic routing)
- Transaction signing modal with Soul Engine stub
- New tab page (static)
- macOS + Windows build

### Phase 2 — IPFS + Soul Engine + Miner (Weeks 5–8)
- IPFSService (Helia node embedded)
- `ipfs://` and `ipns://` protocol handlers
- SoulEngineService (1B model, basic query)
- MinerService (wraps bucksminer binary)
- Sidebar: IPFS, Soul Engine, Miner tabs
- Soul Engine transaction analysis (live)
- Biometric unlock (Touch ID + Windows Hello)

### Phase 3 — Profile + Marketplace (Weeks 9–14)
- ProfileService (reads GlobalProfile from chain)
- Sidebar: Profile tab with reputation, skills, assets
- `bucks://marketplace` pages (listing browser, offer flow, escrow tracker)
- `bucks://profile/address` pages
- Contract signing with full Soul Engine analysis
- Dispute filing UI

### Phase 4 — App Store + DAO + Explorer (Weeks 15–20)
- AppStoreService + `bucks://app-store`
- `bucks://dao/community` governance UI
- `bucks://explorer` block + transaction browser
- Auto-update system
- Public beta release
- Full audit + mainnet launch

---

*Bucks Browser Architecture Specification v1.0*  
*A full-fledged Chromium browser with Web3 native at every layer*  
*Chain ID: 8192 · Soul Engine · 114-layer resonance architecture*

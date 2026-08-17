# Bucks Blockchain — System Architecture

> **Classification:** Internal Engineering Reference  
> **Version:** 0.1.0 — Phase 1 (Node Foundation)  
> **Status:** Active Scaffold

---

## 1. Executive Summary

The Bucks Blockchain is a sovereign, EVM-compatible distributed ledger whose native coin is **BUCKS**. Every denomination of BUCKS is anchored to the classical gold standard weight (mithqal) — a physical, fungible unit of value predating modern monetary systems. The network combines a Proof-of-Work consensus layer with a full Ethereum Virtual Machine runtime, enabling Solidity smart contracts, a browser extension wallet, and a plug-and-play mining client to operate as a single, cohesive ecosystem.

The oracle and identity layer is powered by the **Soul Engine** — a proprietary neural architecture trained on an ancient corpus of human wisdom — which provides a 114-layer resonance model for contract verification, anomaly detection, and community governance scoring.

---

## 2. Four-Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        BUCKS NETWORK                            │
│                                                                 │
│  ┌────────────┐   ┌──────────────┐   ┌──────────────────────┐  │
│  │  Bucks     │   │  Browser     │   │   Plugin Mining      │  │
│  │  Node      │◄──│  Wallet      │   │   Client             │  │
│  │  (Go)      │   │  (TS/React)  │   │   (Electron/Go)      │  │
│  └─────┬──────┘   └──────┬───────┘   └──────────┬───────────┘  │
│        │                 │                       │              │
│  ┌─────▼──────────────────▼───────────────────────▼──────────┐  │
│  │              EVM Smart Contract Runtime                    │  │
│  │         (Solidity · user↔user · user↔community            │  │
│  │          community↔business · Soul Engine hooks)          │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Component 1 — Bucks Node (Blockchain Core)

### 3.1 Language & Runtime
- **Language:** Go 1.22+
- **Build target:** Linux / macOS / Windows (cross-compiled via `GOARCH` / `GOOS`)

### 3.2 Chain Parameters

| Parameter | Value |
|---|---|
| Chain ID | `8192` |
| Native coin | `BUCKS` |
| Base denomination | grain (10⁻¹⁸ BUCKS) |
| 1 BUCKS | = the classical gold standard weight (mithqal) |
| Block time target | 60 seconds |
| Block reward | 50 BUCKS (halving every 210,000 blocks) |
| Max supply | 21,000,000 BUCKS |
| Consensus | Proof-of-Work (SHA-3 / Keccak-256) |
| Seed phrase standard | BIP-8192 (11-bit encoding, 2048-word ancient corpus list) |
| VM | EVM (Berlin hard-fork baseline) |

### 3.3 Internal Packages

```
node/
├── cmd/
│   └── bucksnode/
│       └── main.go          # CLI entry point
├── core/
│   ├── types/
│   │   ├── block.go         # Block, BlockHeader, BlockBody
│   │   └── transaction.go   # Transaction, Receipt, Log
│   ├── blockchain/
│   │   ├── blockchain.go    # Chain manager, head tracking, validation
│   │   └── genesis.go       # Genesis block + initial state allocation
│   ├── consensus/
│   │   └── pow.go           # PoW engine, difficulty retarget, seal/verify
│   ├── state/
│   │   └── statedb.go       # Account-state trie (Merkle Patricia)
│   ├── evm/
│   │   └── evm.go           # EVM integration shim (go-ethereum core)
│   └── p2p/
│       └── node.go          # libp2p peer discovery, gossip protocols
├── api/
│   └── rpc.go               # Ethereum-compatible JSON-RPC (eth_*, net_*)
└── config/
    └── config.go            # TOML config loader + defaults
```

### 3.4 Consensus — Proof-of-Work

The PoW algorithm is a double-Keccak-256 variant (Keccak-256(Keccak-256(header_rlp || nonce))). The output must be numerically less than the current target. Difficulty adjusts every 2016 blocks to maintain the 60-second block-time target.

```
Target = MaxTarget / Difficulty
Valid block: hash(header, nonce) < Target
```

Difficulty retarget formula:
```
new_difficulty = old_difficulty * (expected_time / actual_time)
Clamp: max ±25% change per adjustment window
```

### 3.5 Storage
- **Block / header store:** LevelDB (`blocks/` prefix key-space)
- **State trie:** LevelDB (`state/` prefix), Merkle Patricia Trie
- **Transaction index:** LevelDB (`txindex/` prefix)
- **Default data dir:** `~/.bucks/data/`

### 3.6 JSON-RPC API Surface
The node exposes Ethereum-compatible JSON-RPC on `localhost:8192` (HTTP) and `localhost:8193` (WebSocket). Supported namespaces:

| Namespace | Key methods |
|---|---|
| `eth_` | `getBalance`, `sendRawTransaction`, `getTransactionByHash`, `getBlockByNumber`, `call`, `estimateGas` |
| `net_` | `version` → `"8192"`, `peerCount`, `listening` |
| `web3_` | `clientVersion`, `sha3` |
| `bucks_` | `getMithqalBalance`, `getChainParams`, `getSoulEngineStatus` |

---

## 4. Component 2 — Bucks Browser Wallet

### 4.1 Language & Framework
- **Language:** TypeScript 5+
- **UI:** React 18, Vite build
- **Target:** Chrome Manifest V3 extension; Firefox WebExtension compatible

### 4.2 Architecture

```
wallet/
├── src/
│   ├── background/      # Service worker: key vault, tx signing, RPC proxy
│   ├── popup/           # React UI: balance, send, receive, history
│   ├── content/         # Injected window.bucks provider (MetaMask-compatible)
│   ├── crypto/
│   │   ├── bip8192.ts   # BIP-8192 mnemonic generation / seed derivation
│   │   └── keystore.ts  # AES-256-GCM encrypted keystore
│   └── rpc/
│       └── client.ts    # JSON-RPC client targeting Bucks Node
├── manifest.json
└── vite.config.ts
```

### 4.3 Key Features
- **BIP-8192 seed phrases** — 24-word mnemonics from the ancient corpus word list; 11-bit entropy encoding; 264-bit seed
- **HD key derivation** — `m/44'/8192'/0'/0/n` derivation path
- **Account model** — Ethereum-compatible 20-byte addresses (0x-prefixed)
- **Transaction flow** — construct → sign (ECDSA secp256k1) → broadcast via `eth_sendRawTransaction`
- **dApp connector** — `window.bucks.request()` API mirrors EIP-1193; dApps using MetaMask SDK can target Bucks Wallet by switching the provider
- **Balance display** — shown in BUCKS (mithqal) with grain sub-unit toggle

### 4.4 Security Model
- Private keys never leave the background service worker
- Keystore encrypted with AES-256-GCM; password-derived key via Argon2id
- Content script → background communication via chrome.runtime.sendMessage (no direct key access from content scripts)
- Auto-lock after 15 minutes of inactivity (configurable)

---

## 5. Component 3 — Plugin Mining Client

### 5.1 Language & Runtime
- **Core mining engine:** Go binary (cross-platform: Windows .exe, macOS .app, Linux binary)
- **Desktop shell:** Electron wrapper (optional — ships as both headless CLI and GUI)

### 5.2 Architecture

```
miner/
├── engine/
│   ├── miner.go        # PoW mining loop (multi-threaded via goroutines)
│   ├── worker.go       # Per-core worker: nonce search in assigned range
│   └── stratum.go      # Stratum v2 pool protocol client
├── gui/                # Electron + React frontend
│   ├── src/
│   │   ├── App.tsx     # Dashboard: hashrate, earnings, config
│   │   └── setup/      # Wizard: enter wallet address, pick pool/solo
│   └── electron.js
├── config/
│   └── miner.toml      # Wallet address, node RPC URL, thread count
└── build/              # Cross-platform build scripts
```

### 5.3 User Flow
1. **Download** — single installer for OS (no dependencies required)
2. **Launch** — GUI wizard opens on first run
3. **Configure** — enter BUCKS wallet address, choose solo vs. pool, set thread count
4. **Mine** — click Start; hashrate and estimated earnings in BUCKS/mithqal displayed live
5. **Earn** — mined rewards deposited directly to configured wallet address

### 5.4 Mining Protocol
- **Solo mode:** connects directly to local or remote Bucks Node via `bucks_getWork` / `bucks_submitWork` RPC calls
- **Pool mode:** Stratum v2 protocol over TCP (pool URL configurable)
- **Thread model:** one goroutine per logical CPU core; nonce space partitioned evenly; atomic result channel

---

## 6. Component 4 — Smart Contract Runtime

### 6.1 VM Compatibility
The Bucks Node embeds the Ethereum Virtual Machine (EVM) at the Berlin hard-fork baseline. All Solidity contracts (pragma ^0.8.0) compile and deploy without modification. Standard toolchains (Hardhat, Foundry, Remix) work against the Bucks JSON-RPC endpoint.

### 6.2 Contract Archetypes

| Contract | Parties | Use Case |
|---|---|---|
| `BucksTransfer.sol` | user ↔ user | Conditional payment release, escrow |
| `CommunityTreasury.sol` | user ↔ community | Membership dues, community fund governance |
| `BusinessAgreement.sol` | community ↔ business | Service-level agreements, revenue sharing |
| `SoulVerified.sol` | any | Soul Engine attestation hook for identity/KYC |

### 6.3 Folder Structure

```
contracts/
├── src/
│   ├── core/
│   │   ├── BucksTransfer.sol
│   │   ├── CommunityTreasury.sol
│   │   └── BusinessAgreement.sol
│   ├── soul/
│   │   └── SoulVerified.sol     # Soul Engine oracle interface
│   └── interfaces/
│       ├── IBucksToken.sol
│       └── ISoulEngine.sol
├── test/
│   └── *.test.ts                # Hardhat / Foundry tests
├── hardhat.config.ts
└── foundry.toml
```

### 6.4 Soul Engine Integration
The Soul Engine oracle sits off-chain. Its 114-layer resonance architecture produces attestations that on-chain contracts verify via an oracle callback pattern:

```solidity
interface ISoulEngine {
    function attest(address subject, bytes32 claim) external returns (bool verified, uint256 confidence);
}
```

Contracts call `ISoulEngine.attest()` to gate high-value transfers, verify community membership, or validate business credentials. The Soul Engine node signs responses with its own secp256k1 key; contracts verify the signature on-chain.

---

## 7. Network Topology

```
                ┌─────────────────────────┐
                │    Boot Nodes (3)        │
                │  bucks-boot.bucks.net    │
                └──────────┬──────────────┘
                           │ libp2p Kademlia DHT
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   ┌──────────┐     ┌──────────┐     ┌──────────┐
   │  Full    │     │  Full    │     │  Mining  │
   │  Node    │◄───►│  Node    │◄───►│  Node    │
   └──────────┘     └──────────┘     └──────────┘
         ▲
         │ JSON-RPC
   ┌──────────┐
   │  Browser │
   │  Wallet  │
   └──────────┘
```

- **Full nodes** maintain complete chain history + state
- **Light nodes** (planned Phase 3) use Merkle proofs for header sync
- **Boot nodes** are hardcoded in the genesis config; DNS-based discovery also supported

---

## 8. Security & Cryptography Summary

| Primitive | Usage |
|---|---|
| secp256k1 ECDSA | Transaction signing, wallet keys |
| Keccak-256 | Block hashing (PoW), address derivation |
| SHA-3 | Secondary hash utility |
| AES-256-GCM | Wallet keystore encryption |
| Argon2id | Password-to-key derivation (wallet unlock) |
| Merkle Patricia Trie | State root commitment |
| BIP-8192 | Seed phrase generation (11-bit, 2048-word ancient corpus list) |

---

## 9. Development Phases

| Phase | Scope | Status |
|---|---|---|
| **Phase 1 (current)** | Node scaffold — types, genesis, PoW, P2P skeleton, RPC | 🟡 In progress |
| **Phase 2** | Browser wallet (popup UI, BIP-8192, key vault, EIP-1193 provider) | Pending |
| **Phase 3** | Plugin mining client (Go engine + Electron GUI, Stratum v2) | Pending |
| **Phase 4** | Smart contract suite + Hardhat deploy scripts + Soul Engine oracle stub | Pending |
| **Phase 5** | Testnet launch, boot nodes, faucet, block explorer | Pending |

---

## 10. Repository Layout

```
Bucks Core/
├── bucks-blockchain-architecture.md   ← this document
├── node/                              ← Phase 1: Go blockchain node
├── wallet/                            ← Phase 2: Browser extension wallet
├── miner/                             ← Phase 3: Plugin mining client
├── contracts/                         ← Phase 4: Solidity smart contracts
├── soul-engine/                       ← Soul Engine oracle stub & interface
└── docs/
    ├── api-reference.md
    ├── mining-setup.md
    └── contract-guide.md
```

---

*Bucks Blockchain — all denominations expressed in the classical gold standard weight (mithqal).*

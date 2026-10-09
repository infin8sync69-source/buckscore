# Bucks Project Map

*Last updated: 2026-08-15. This is the single navigable index for the whole Bucks ecosystem across every folder on the Desktop. Read this before any other doc — it tells you what's canonical, what's experimental, and what's stale.*

---

## 1. The whole ecosystem, at a glance

```
Desktop/
├── Bucks Core/                  ★ MAIN DEV WORKSPACE — canonical source
│   ├── bucks browser/            → ACTIVE. Electron + agent source for the browser (pre-package)
│   ├── node/                     → ACTIVE/CANONICAL CHAIN. Go, EVM-compatible, chain ID 8192
│   ├── contracts/                → ACTIVE. Hardhat/Solidity — only runs against node/ (EVM)
│   ├── wallet/                   → ACTIVE. Browser-extension wallet — hardcoded to node/'s EVM JSON-RPC
│   ├── miner/                    → ACTIVE. Go miner — solo mode talks JSON-RPC to node/
│   ├── miner-gui/                → ACTIVE. Electron GUI wrapper around miner/
│   ├── soul-engine/               → ACTIVE. AI runtime (model + oracle) behind the agent
│   ├── bucks.global/              → git clone of the deployed marketing/installer site — has UNPUSHED local commits + uncommitted WIP (see §4)
│   ├── buck-global-site/          → SOURCE for the site above; synced into bucks.global/ manually
│   ├── _archive/                  → DEPRECATED. Old mac-cleanup scripts + shelved bucks-android/bucks-ios/bucks-os platform ports
│   ├── _v2_deferred/               → DEFERRED. Dead files + a shelved v2 browser/node exploration — not on any active path
│   ├── docs/                      → EMPTY
│   └── *.md (20+ files)           → Planning/audit/report docs, mixed vintage (see §5)
│
├── Bucks Blockchain/             ⚠ EXPERIMENTAL / NOT WIRED IN — parallel C++ chain, see §3
│   ├── src/, include/             → 63,939 lines: full UTXO chain, wallet, HD derivation ("BIP-8192"), mempool, P2P encryption, SQLite storage
│   ├── build/                     → Compiles; binary is bundled into Bucks-App (electron/bin/bucks-cpp) but not exercised by the shipped wallet
│   └── *.md (README, ARCHITECTURE, GOLD_STANDARD, BITCOIN_COMPARISON, QUICK_REFERENCE, DATA_FLOW, NEXT_STEPS)
│       → Confirms 21,000,000 supply / 50 BUCKS reward / 210,000-block halving — consistent with node/'s tokenomics
│
├── Bucks-App/                     ★ PACKAGED RELEASE — built from Bucks Core
│   ├── electron/bin/               → Contains BOTH bucks-go and bucks-cpp binaries (built 2026-08-13); app prefers Go, falls back to C++
│   ├── electron/bucks-node-manager.js → The dual-engine launcher/bridge — see §3 for what's actually wired up
│   ├── agent/                     → Packaged Soul Engine (Python) backend
│   └── RELEASE_SUMMARY.md, AGENT_DIAGNOSTIC_REPORT.md, DISTRIBUTION.md, PUBLISHING.md → release-process docs, see §4
│
├── BUCKS_REFERENCE/               ⚠ REFERENCE-ONLY SNAPSHOT — stale copy, see §5
│   └── Architecture/, Blockchain/, Browser/, Files/, Global/, Mobile/, QNN/, Vision/
│       → Vision/BUCKS_MASTER_VISION.md is the closest thing to a single vision doc; contains BOTH the correct 21M tokenomics AND the (unrelated) 114-surah QNN architecture — see §2
│
├── Bucks-Windows-Setup/            → ACTIVE, PLATFORM-SPECIFIC. Prebuilt Windows .exe + PowerShell installer/launcher scripts for the same browser+agent stack
│
├── BucksFiles-Peer/                → ACTIVE, SEPARATE UTILITY. IPFS-cluster + Tailscale file-sync tool ("Bucks Files") — not the blockchain, not the browser; a peer file-sharing feature/tool on its own track
│
└── PROJECT_MAP.md (this file)     → lives in Bucks Core/
```

---

## 2. Tokenomics — RESOLVED (was inconsistent, now fixed)

**Canonical figure: 21,000,000 BUCKS max supply**, 50 BUCKS initial block reward, halving every 210,000 blocks (Bitcoin-style geometric schedule). The math is self-consistent: `50 × 210,000 × 2 = 21,000,000` (sum of the infinite halving series).

This is what `BUCKS_REFERENCE/Vision/BUCKS_MASTER_VISION.md`, `BUCKS_REFERENCE/Blockchain/QUICK_REFERENCE.md`, `Bucks Blockchain/GOLD_STANDARD.md`, `Bucks Blockchain/BITCOIN_COMPARISON.md`, and `Bucks Core/bucks-blockchain-architecture.md` all independently state.

**The conflict:** `Bucks Core/bucks-contracts-plan.md` (§1.2, "Token Economics") stated **114,000,000 BUCKS**, citing the *identical* 50-BUCKS/210,000-block halving schedule — which is mathematically impossible to reconcile with 114M under that schedule. Tracing it down: the "114" is a narrative borrowing from an *entirely different* subsystem — the Soul Engine / QNN AI model has a 114-layer architecture, one layer per Quranic surah (114 surahs), documented in `BUCKS_MASTER_VISION.md` §"The architectural insight — 114 layers." That AI-architecture theming ("114-layer resonance architecture") leaked into the tokenomics section of `bucks-contracts-plan.md` as "one layer per million," which isn't a real derivation — it's a coincidental reuse of the number 114.

I checked every other file that mentions "114" in this project (14 files total) — all of them use it exclusively for the QNN/Soul Engine layer count, never for token supply. `bucks-contracts-plan.md` was the only file with the erroneous 114,000,000 supply figure.

**Fix applied:** `Bucks Core/bucks-contracts-plan.md`, line 33, changed from:
```
Total supply:     114,000,000 BUCKS  (114-layer resonance architecture — one layer per million)
```
to:
```
Total supply:     21,000,000 BUCKS  (Bitcoin-style geometric halving: 50 × 210,000 × 2)
```
No other numeric or narrative changes were made to that document. No other files needed correction.

**Single source of truth going forward:** treat `BUCKS_REFERENCE/Vision/BUCKS_MASTER_VISION.md` §(tokenomics block, "MAX_MONEY = 21,000,000 BUCKS") as canonical for this number. Any new doc should cite it from there rather than restating it.

---

## 3. Two blockchain codebases — investigated, not merged

There are two real, independent implementations, and the situation is more nuanced than "one is deprecated":

| | `Bucks Core/node/` (Go) | `Bucks Blockchain/` (C++) |
|---|---|---|
| Model | Account-based, EVM-compatible | UTXO, Bitcoin-style |
| Size | 2,241 lines, 9 files — thin/skeletal | 63,939 lines, 42 files — full-featured (wallet, mempool, P2P encryption, HD derivation, SQLite, web UI, tests) |
| Chain ID | 8192 (hardcoded default in `config.go`, `genesis.go`) | Uses "BIP-8192" as its own HD-derivation scheme name, not a network chain ID field |
| Protocol | JSON-RPC 2.0, Ethereum-style (`eth_chainId`, `eth_getBalance`, etc.) on port 8192 | Custom HTTP REST API on port 8088 |
| Last real code changes | 2026-08-13 (recent) | 2026-06-16/17, one header touched 2026-08-13 |
| What actually depends on it today | **`wallet/`** (browser extension) does client-side EIP-155 signing and calls `eth_chainId`/`eth_getBalance` directly — only works against this. **`miner/`**'s solo-mining backend is an explicit "Ethereum-compatible JSON-RPC" client. **`contracts/`** is a Hardhat/Solidity project — Solidity contracts only run on an EVM chain, i.e. this one. | Nothing in the live wallet/miner/contracts stack calls it. `Bucks-App/electron/bucks-node-manager.js` has a partial REST bridge, but it only maps 5 read-only/monitoring methods (`eth_blockNumber`, `bucks_getInfo`, recent blocks, wallets list, mine-block) — it does **not** map balance queries, transaction sending, or signing. Switching the app's active engine to C++ today would leave the wallet extension non-functional. |
| Documented release status | `Bucks-App/DISTRIBUTION.md`'s `versions.json` labels this **v1.0.0, channel "legacy"** | Same file labels this **v1.1.0, channel "stable"/"latest"** — but `Bucks-App/RELEASE_SUMMARY.md` (dated 2026-08-14, the actual E2E test log) lists **"Blockchain (bucks-go) — Running on devnet"** as the tested/working component, not bucks-cpp |

**What this means:** the C++ chain is the more mature *standalone blockchain engine* by a wide margin, and there's a real, documented intent (`versions.json`, the "v1.1.0 latest" labeling, `switchEngine()` in `bucks-node-manager.js`) to make it the primary engine going forward. But **that migration is incomplete** — the wallet, the one component end users actually touch to hold/send BUCKS, is still hard-wired to Ethereum JSON-RPC semantics that only the Go node speaks, and the C++ REST bridge doesn't yet cover wallet operations. The two docs (`DISTRIBUTION.md` calling C++ "latest/stable" vs. `RELEASE_SUMMARY.md` showing Go as what was actually tested and running) also disagree with each other about which engine is production-ready right now — that's a live inconsistency, not just an old one.

**Recommendation:**
- **Canonical for today's shipping product: `node/` (Go/EVM).** It's what the wallet, miner, and Solidity contracts actually run against, and it's what was in the last tested release build.
- **`Bucks Blockchain/` (C++) should be treated as the in-progress next-generation engine, not archived or deprecated.** It's clearly the target of an active migration (recent binary rebuild, "v1.1.0 latest" release labeling, a partial API bridge already written). It should stay exactly where it is.
- **Before promoting C++ to default:** the REST↔JSON-RPC bridge in `bucks-node-manager.js` needs to cover wallet-critical methods (balance, send, sign, nonce/UTXO lookups), and either the wallet extension needs a UTXO-aware code path or the C++ side needs an EVM-compatible RPC shim. Until one of those exists, don't flip the default engine or the `versions.json` "stable" label — doing so today would ship a wallet that can't read balances or send transactions.
- Flag directly to whoever owns release labeling: `DISTRIBUTION.md` and `RELEASE_SUMMARY.md` currently contradict each other on which engine is production-ready. Pick one framing and update both.

No files were moved, merged, or deleted for this investigation, per instructions.

---

## 4. Install reliability — mostly fixed, but the fixes aren't fully live

Checked `Bucks Core/DISTRIBUTION.md`, `Bucks-App/RELEASE_SUMMARY.md`, `Bucks-App/AGENT_DIAGNOSTIC_REPORT.md`, and the git history of the `bucks.global` site clone.

**Real bugs found and fixed (all dated 2026-07-29 to 2026-07-30, in `Bucks Core/bucks.global/` git history):**
- A dead `cloudflare-ipfs.com` gateway was still first in the fallback list — removed.
- Gateway failures returning an HTML error page with HTTP 200 were being accepted as a valid download, only failing later at `tar` with a confusing "Unrecognized archive format" — fixed by validating gzip magic bytes (`1f8b`) before accepting a download.
- A Google Drive fallback was silently broken (redirected to a sign-in page instead of the file) — removed entirely rather than fixed, in favor of 4 working IPFS gateways.
- Unsigned `.app` bundle triggered macOS Gatekeeper — replaced with a Gatekeeper-safe CLI launcher.
- Root cause found for garbled "cho"/"shot" prompt text during install: the script was reading the auto-launch prompt from stdin instead of `/dev/tty` — fixed.
- Installer now detects and auto-heals a broken existing installation instead of just skipping it.
- `npm install`'s automatic audit step (slow, noisy) disabled during install.
- A cold-start auto-update mechanism was added.

**Current status: fixed in a local clone, not confirmed live.** As of this pass, `Bucks Core/bucks.global/` (the git clone of the deployed site) is:
- **1 commit ahead of `origin/main`**, not yet pushed (`feat: add cold-start auto-update mechanism`).
- Has **uncommitted working-tree changes** to `index.html`, `install`, `install.ps1`, and `version.json` — these bump the installer's CID/version pointer from 1.0.0 to 1.1.0.

Per `DISTRIBUTION.md`, the live site deploys via Vercel auto-deploy on push to `main` of `github.com/shafeeqduddiyanda/bucks.global`. Since this clone has unpushed and uncommitted changes, **it's not safe to assume the live `bucks.global` install command reflects these fixes** — that needs to be verified directly (check the live site / GitHub) and, if confirmed stale, the local commit needs pushing and the working-tree changes need reviewing and committing.

**Recommendation:** before any marketing push that drives traffic to the install command, confirm (a) whether commit `0432807` is on GitHub `main`, and (b) whether the uncommitted `index.html`/`install`/`install.ps1`/`version.json` changes are intentional and ready to ship — they look like an in-progress v1.1.0 promotion that was left mid-edit.

---

## 5. Docs landscape — duplication and staleness to know about

- **`BUCKS_REFERENCE/`** is a separate, manually-maintained snapshot — not a symlink or generated copy. Diffed its `Blockchain/` docs against `Bucks Blockchain/`'s own docs: `ARCHITECTURE.md`, `BITCOIN_COMPARISON.md`, `QUICK_REFERENCE.md`, and `README.md` all differ between the two locations, and `BUCKS_REFERENCE/Blockchain/` is missing `GOLD_STANDARD.md` and `DATA_FLOW.md` entirely. Timestamps confirm `BUCKS_REFERENCE`'s copy (2026-06-15) predates later edits in `Bucks Blockchain/` (through 2026-06-17). **Treat `BUCKS_REFERENCE/` as a point-in-time reference snapshot, not a live source — always check the actual project folder (`Bucks Core/`, `Bucks Blockchain/`) for current docs.** `BUCKS_REFERENCE/Vision/BUCKS_MASTER_VISION.md` is the exception worth keeping authoritative for the tokenomics constant (§2), since nothing in the active folders restates it more currently.
- **`Bucks Core/` top level has 20+ loose `.md` files** (audit reports, todo lists, debug reports, nim test results, soul-engine planning docs) of very mixed vintage — some are point-in-time snapshots (e.g. `debug-report.md`, `critical_fixes_report.md`) rather than living docs. None of these conflict with each other on facts as far as this pass found, but they're not indexed anywhere — this file is now that index.
- **`Bucks Core/_archive/`** holds genuinely deprecated material: shelved `bucks-android`/`bucks-ios`/`bucks-os` platform ports and old Mac cleanup scripts. **`Bucks Core/_v2_deferred/`** holds dead/unused files plus a shelved v2 exploration of the browser and node — neither directory is on any active code path; both are correctly named and don't need action.
- **`docs/`** inside `Bucks Core/` is empty — not currently used for anything.

---

## 6. What each top-level folder is for

| Folder | Purpose | Status |
|---|---|---|
| `Bucks Core/` | Main development workspace — browser, wallet, miner, contracts, Go node, Soul Engine, site source, planning docs | Active, canonical |
| `Bucks-App/` | Packaged/built production release of the browser (built *from* Bucks Core) | Active, canonical release artifact |
| `Bucks Blockchain/` | Standalone C++/UTXO chain implementation, more feature-complete than `node/` but not wired into the live wallet | Active development, experimental/not-yet-integrated |
| `BUCKS_REFERENCE/` | Manually maintained documentation snapshot/mirror covering architecture, blockchain, browser, files, global site, mobile, QNN, vision | Reference-only, partially stale — see §5 |
| `Bucks-Windows-Setup/` | Prebuilt Windows installer (.exe) + PowerShell scripts for the same browser/agent stack, Windows-specific packaging | Active, platform-specific companion to Bucks-App |
| `BucksFiles-Peer/` | A private IPFS-cluster + Tailscale-based file-sharing tool ("Bucks Files") for syncing files across machines/peers | Active, but a separate utility/feature track — not the blockchain or the browser |

---

## 7. Single source of truth per decision

| Decision | Value | Source of truth |
|---|---|---|
| Max token supply | 21,000,000 BUCKS | `BUCKS_REFERENCE/Vision/BUCKS_MASTER_VISION.md` (tokenomics block) |
| Block reward / halving | 50 BUCKS, halving every 210,000 blocks | Same as above |
| Chain ID | 8192 | `Bucks Core/node/core/blockchain/genesis.go`, `Bucks Core/node/config/config.go` |
| Canonical blockchain engine (today) | `Bucks Core/node/` (Go/EVM) | This file, §3 — wallet/miner/contracts all depend on it |
| Next-gen blockchain engine (in progress, not yet default) | `Bucks Blockchain/` (C++/UTXO) | This file, §3 |
| Live install command state | Needs verification against GitHub `main` — local clone has unpushed/uncommitted changes | This file, §4; `Bucks Core/bucks.global/` git status |

---

## 8. Open issues — unresolved, flagged explicitly

1. **C++ engine promotion is incomplete.** `versions.json` labels C++ (v1.1.0) "latest/stable" while the wallet extension can't function against it yet (no balance/send/sign bridge). `DISTRIBUTION.md` and `RELEASE_SUMMARY.md` disagree with each other about which engine is actually production-ready.
2. **`bucks.global` install fixes may not be live.** The local git clone has 1 unpushed commit and uncommitted changes to `index.html`/`install`/`install.ps1`/`version.json`. Needs verification against the deployed site and GitHub before relying on it for a marketing push.
3. **No literal duplication conflicts found between `BUCKS_REFERENCE/` and `Bucks Core/`'s own docs on facts checked (tokenomics, chain ID)**, but the two Blockchain doc sets have drifted apart structurally (different content, missing files) — worth a deliberate reconciliation or clearly marking `BUCKS_REFERENCE/` as archival if it's not going to be kept in sync.
4. **`bucks-contracts-plan.md`'s smart-contract layer (marketplace, profiles, Soul Engine oracle attestation) is written entirely against the EVM/Solidity model** — meaning if the C++/UTXO chain is ever promoted to canonical, this entire contracts design either needs a rethink or the two chains need to coexist by design (EVM for contracts, UTXO for base transfers) rather than one replacing the other. This wasn't flagged anywhere in the docs reviewed and is worth a deliberate decision rather than letting it fall out of the migration by default.

---

## 9. Architecture audit & refactor (2026-08-18) — node/, contracts/, wallet/, miner/, miner-gui/

A full senior-engineer architecture audit of the five backend/client subsystems was completed 2026-08-18. Full writeup: **`~/Desktop/Bucks-Core-Architecture-Audit.docx`**. Refactor branch: **`refactor/architecture-audit`** (one commit ahead of `main` @ `0309226`, built in an isolated `git worktree` so it never touched the live synthetic-user-simulation session's checkout). `bucks browser/` was read-only for this pass (82 dirty files, concurrent agent work) — not refactored, not part of the audit's problem list.

**New findings not previously captured in this file:**
- `soul-engine/` at the repo root is empty (two empty subdirectories, zero source) — the real Soul Engine Python runtime is `bucks browser/agent/`, not this path. Confirmed by direct listing + repo-wide grep.
- `node/`, `contracts/`, `wallet/`, `miner/`, and `miner-gui/` had **no git history at all** before commit `0309226` ("Baseline snapshot…") — that commit is now the earliest recoverable state for any of them; nothing before it exists.
- `node/`'s RPC layer is a shell around a real-looking API: `eth_getBalance`/`eth_getTransactionCount`/`eth_sendRawTransaction` are stubs (no mempool, no state trie, no EVM), block storage is JSON despite comments claiming RLP, and P2P transaction propagation (`BroadcastTransaction`) is a complete no-op.
- `wallet/`'s transaction signing path (`background/wallet.ts`) produces a JSON-in-hex payload, not real RLP, despite a docblock claiming full RLP+EIP-155 support — it only "works" today because `node/`'s `eth_sendRawTransaction` is equally non-standard. This is the single highest-priority correctness fix surfaced by the audit.
- `miner/` and `node/` independently reimplement the identical PoW hash/target math in two separately-versioned Go modules with no shared code — a drift risk for chain consensus.
- `contracts/` implements a small, non-upgradeable, single-EOA-admin fraction of `bucks-contracts-plan.md`; `BucksEscrow.sol` (the one contract holding user funds via deposit/dispute/claim) has zero test coverage; nothing has ever been deployed (`contracts/deployments/` is empty).

**What was refactored (mechanical, behavior-preserving only — verified via build/test/benchmark, no functionality changed):** centralized the `ChainID` constant in `node/`; extracted a shared `Fees.split()` library in `contracts/` (50/50 tests still pass); deduped `bytesToHex`/`hexToBytes`/`uuid` helpers and centralized the chain-ID display literal in `wallet/`; fixed a per-hash-attempt buffer allocation in `miner/`'s hot mining loop (new test+benchmark added, `miner/` previously had zero tests); centralized default addresses in `miner/`'s config. Full before/after detail, the complete problem list with file:line citations, and a prioritized roadmap are in the docx above.

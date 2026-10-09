# Bucks unification plan

Date: 2026-10-09. Scope: every Bucks code base reachable from this account, plus the release tarball shipped by `bucks.global/install`.

| Doc | What it answers |
|---|---|
| [01-current-state.md](01-current-state.md) | What actually exists, what works, what is fake, where the secrets leaked |
| [02-target-architecture.md](02-target-architecture.md) | The one system everything folds into |
| [03-identity.md](03-identity.md) | One global Bucks ID per user: exact derivation, keys, devices, recovery |
| [04-sovereignty-map.md](04-sovereignty-map.md) | Every corporate dependency, its replacement, and the ones that cannot be removed |
| [05-repo-consolidation.md](05-repo-consolidation.md) | Six repos and a desktop folder into one monorepo, step by step |
| [06-roadmap.md](06-roadmap.md) | Phased delivery, bit by bit, with exit criteria |
| [07-security-triage.md](07-security-triage.md) | Things to do this week before anything else |
| [08-product-and-ux.md](08-product-and-ux.md) | One product surface, one design system, what to cut |
| [adr/](adr/) | Decision records (chain, desktop shell, mobile, transport, AI, data layer) |

Confidence tags used throughout: **[Certain]** read directly from code, **[Likely]** strong inference from code, **[Guessing]** filling a gap.

Where a doc says "the audit", it means the read-only review done on 2026-10-09 of:

- `shafeeqduddiyanda/bucks.global` (this repo, the website and installer)
- `infin8sync69-source/bucks-Mobile` (Android Kotlin + iOS Swift + Supabase)
- `infin8sync69-source/Bucks-browser` (Tauri 2 + Svelte shell, Electron leftovers, legacy Qt and Next.js)
- `infin8sync69-source/Bucks-global` (FastAPI + Next.js social app, forked Tauri app, Supabase)
- `infin8sync69-source/bucks` (C++ blockchain)
- `infin8sync69-source/buckscore` (empty)
- `dl/bucks-browser-dist.tar.gz` in this repo: the Electron "Bucks Core" app that users actually install. Its source is not in any repository.

Not covered: the folders on your desktop that are not in git (`Bucks Core`, `QNN`, `miner`, the Go node source). The tarball references them, so they exist. Section 5 of `05-repo-consolidation.md` says what to do with them.

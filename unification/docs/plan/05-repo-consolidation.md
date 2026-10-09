# 05. Repository consolidation

## 5.1 Target: one monorepo, `bucks`

```
bucks/
├── core/                 Rust workspace
│   ├── bucks-core/       identity, events, store, sync, content, policy
│   ├── bucks-node/       the node binary (relay, directory, pins, dispatch, push, gateway, inference)
│   ├── bucks-ffi/        UniFFI bindings → Kotlin, Swift
│   └── bucks-cli/        dev/ops CLI (inception, device link, node admin, release signing)
├── apps/
│   ├── android/          from bucks-Mobile/app (as is, then core underneath)
│   ├── ios/              from bucks-Mobile/ios
│   ├── desktop/          Tauri 2 + Svelte 5, from Bucks-browser/bucks-app; Electron features ported in
│   └── web/              bucks.global static site + the gold-intelligence dashboard
├── node-modules/         SQL schema + RPCs from bucks-Mobile/supabase, repackaged for bucks-node
├── protocol/             the specs: identity log, event envelope, node HTTP/iroh API, CID rules
├── docs/                 this plan, ADRs, runbooks
├── infra/                node docker-compose, Caddy, ntfy, Forgejo/Woodpecker, DNSLink publish
└── archive/              nothing executable; pointers to the frozen repos
```

Rule: **one place for each thing.** `bucks-crypto.ts` exists in three repos today; after this it exists once, in Rust, with generated bindings.

## 5.2 Step by step (each step leaves everything still working)

1. **Create `bucks` from `bucks-Mobile`.** It has the only working CI, the real schema and the most users. `git subtree`/history import of the other repos is not worth it: four of them are single squashed commits.
2. **Add `apps/desktop` from `Bucks-browser/bucks-app` only.** Do not bring `legacy_v1`, `ui/`, root Node scripts, `Blockchain/` or the zips.
3. **Add `apps/web` from this repo** (`index.html`, `intelligence/`, `install`, `install.ps1`, `sync_all.py`, workflow). The tarball moves out of git to release storage (IPFS pin + node gateway + GitHub Release asset as mirror). `version.json` gains `sha256`, `cid` and a minisign signature.
4. **Add `node-modules/sql` from `bucks-Mobile/supabase`** unchanged. It is the backend.
5. **Import the Electron source** from your desktop `Bucks Core` folder into `archive/electron-core/` *once*, so it is in version control and the port in phase 2 has a reference. Scrub secrets first (`07-security-triage.md`). Also import `miner/`, the Go node source and `QNN/` into `archive/` if you intend to keep any of it; today the Go node ships as a binary with no source anywhere in git, which is a supply-chain problem for a project claiming sovereignty.
6. **Freeze** `bucks` (C++), `Bucks-global`, `Bucks-browser`, `buckscore`: README banner "archived, see monorepo", repos set to archived on GitHub. Keep them public; the audit history is useful. Purge the committed secrets first (history rewrite with `git filter-repo`, force push, then archive).
7. **Delete, do not migrate:** `Bucks-global/backend` (custodial keys, mismatched auth), `Bucks-global/frontend` (identity on Vercel), `apps/chat`, `src/lib`, `prototype/`, `Bucks-browser/legacy_v1`, `Bucks-browser/ui`, all `ipfs_node.zip`, `tools/mingw64`, the `.claude/.claire` worktree gitlinks, the `node_modules` symlink. The social UX ideas in the Next.js app (feed, messages, recover, QR) are already better implemented in mobile; desktop ports from mobile, not from Next.js.

## 5.3 Monorepo conventions (short)

- Trunk-based, as `bucks-Mobile/CONTRIBUTING.md` already says. One `main`, PRs, required CI.
- CI matrix: `cargo test` + clippy for core; Android debug/release; iOS swift test + simulator build; `cargo tauri build` for Linux/macOS/Windows; SQL tests on Postgres; `svelte-check`.
- Secrets only via CI secrets. A pre-commit hook with gitleaks. The workflows currently carry fallback Supabase literals; remove them.
- Releases: tag → build → sign (minisign; Apple/Windows signing when certs exist) → pin to IPFS on ≥2 Bucks nodes → publish `version.json` → mirror to GitHub Releases. Automate the three-place hash/CID update the incident report calls out.
- Large files: never in git. Models, binaries and tarballs go to release storage.

## 5.4 The `bucks.global` repo during the transition

This repo keeps serving the site and installer until `apps/web` in the monorepo is wired to deploy. Two changes are worth doing here now, independent of the monorepo:

- Move `dl/bucks-browser-dist.tar.gz` out of git (GitHub Release asset + IPFS pin on a reachable node), and point `install` at the release asset URL as the HTTPS mirror.
- Fill `version.json.cid` (it is empty) and have `install` use it; the whole four-gateway loop in `install` is skipped today because `BUCKS_CID=""`.

## 5.5 Naming

The products are "Bucks" (the app, one name on every platform), "Bucks ID" (the identity), "Bucks Node" (what communities run). "Soul Engine" stays the name of the agent inside the app. "Bucks Browser", "Bucks Core", "Bucks Global", "Bucks Chat" as separate product names end.

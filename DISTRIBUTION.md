# Bucks Distribution — bucks.global

## One-command install

```bash
curl -fsSL https://bucks.global/install | bash
```

Detects macOS/Linux, installs Node if missing, downloads the release from IPFS (four gateways tried in order, no other fallback — see below), extracts it to `~/.bucks/bucks-browser`, installs dependencies, and creates a launcher (`~/Applications/Bucks.app` on macOS, `~/.bucks/launch-bucks.sh` everywhere).

## IPFS

Root CID (directory, `cid-version=1`, wraps both files):

```
bafybeifdjsptd56c5gt4pcsx5w7soo2opoylcdcpoyipdk2ynaybdtklgy
```

Pinned on the local Kubo node (`kubo/0.41.0`, peer ID `12D3KooWAZ83vBQhEuxPBnVQJ9NtvWC11zce14FSdDH2kT1241PT`). Contents:

| File | CID |
|---|---|
| `install.sh` | `bafkreifnwi5lun52aeljdg5dktsmelbgebemeadcvvasdsmz2xlpqdxjnm` |
| `bucks-browser-dist.tar.gz` | `bafybeicvrcadmmtckkyajga4qf623cfikottihgesdqy7di6ivtrwoa3hy` |

Gateway URLs (any of these serve the tarball once the local node has propagated it to the network — pinning locally does **not** by itself make it fetchable from public gateways; see "Keeping it seedable" below). `cloudflare-ipfs.com` is deliberately **not** listed — that hostname no longer resolves at all (confirmed 2026-07-29), and was still in `install.sh`'s gateway list until this fix:

```
https://ipfs.io/ipfs/bafybeifdjsptd56c5gt4pcsx5w7soo2opoylcdcpoyipdk2ynaybdtklgy/bucks-browser-dist.tar.gz
https://dweb.link/ipfs/bafybeifdjsptd56c5gt4pcsx5w7soo2opoylcdcpoyipdk2ynaybdtklgy/bucks-browser-dist.tar.gz
https://w3s.link/ipfs/bafybeifdjsptd56c5gt4pcsx5w7soo2opoylcdcpoyipdk2ynaybdtklgy/bucks-browser-dist.tar.gz
https://nftstorage.link/ipfs/bafybeifdjsptd56c5gt4pcsx5w7soo2opoylcdcpoyipdk2ynaybdtklgy/bucks-browser-dist.tar.gz
```

`install.sh`/`install.ps1` verify the gzip magic bytes (`1f8b`) of whatever a gateway returns before accepting it — a blocked/misconfigured gateway can return an HTML error page with HTTP 200, which used to be accepted as "downloaded" and only fail later at `tar` with a confusing "Unrecognized archive format". Confirmed and fixed 2026-07-29 after a real install hit exactly that — the failure chain that day was `ipfs.io` failing on that network, a dead `cloudflare-ipfs.com` gateway, then a Google Drive fallback that turned out to redirect to a sign-in page rather than the file. Drive has since been dropped entirely (below) in favor of just having more working IPFS gateways.

Local verification:

```bash
curl -s http://127.0.0.1:8080/ipfs/bafybeifdjsptd56c5gt4pcsx5w7soo2opoylcdcpoyipdk2ynaybdtklgy/install.sh | head -5
```

### Keeping it seedable

A CID pinned only on a laptop that's asleep or offline isn't reachable by public gateways or `install.sh`'s own IPFS attempt. For durability, do one of:
- Keep this Mac's Kubo daemon running and reachable (it already has a public relay address via libp2p.direct, so it doesn't strictly need a static IP/port-forward).
- Additionally pin the CID on a pinning service (web3.storage, Pinata, Filebase) so it survives this machine being off.
- `ipfs-cluster-service` is already running locally (`pid 746` at last check) — if this machine participates in a Bucks IPFS cluster, add the CID to that cluster's pinset instead of relying on a single node.

## Google Drive fallback — removed

Briefly used as a last-resort fallback, then found to be broken (the shared file redirected to a Google **sign-in page**, not the file itself — it was never actually shared as "anyone with the link"). Rather than fix the sharing setting, the Drive fallback and `DRIVE_ID` have been removed entirely from `install.sh`/`install.ps1` (2026-07-29) — solely IPFS-hosted now, across four gateways (`ipfs.io`, `dweb.link`, `w3s.link`, `nftstorage.link`) for redundancy. If every gateway fails, the script prints a manual `curl`/`Invoke-WebRequest` command against `ipfs.io` instead of a dead fallback.

## Deploying — routed through the bucks.global git repo

`bucks.global` is a Vercel deployment of **`github.com/shafeeqduddiyanda/bucks.global`** (confirmed: the apex serves that repo's `index.html` byte-for-byte, `server: Vercel`). So the installer ships by committing to that repo — no `vercel` CLI login to the domain owner's account required, and no DNS work.

`buck-global-site/` remains the source folder for the landing page and scripts. Its contents are merged into the repo root:

| Repo path | Serves at | Source |
|---|---|---|
| `index.html` | `/` | `buck-global-site/index.html` (+ nav/footer links to `/intelligence`) |
| `install` | `/install` | `buck-global-site/install` |
| `install.ps1` | `/install.ps1` | `buck-global-site/install.ps1` |
| `vercel.json` | — | content-type rules for both scripts |
| `_headers` | — | same rules, only if ever moved to Cloudflare Pages |
| `intelligence/index.html` | `/intelligence` | the pre-existing gold-intelligence site, moved off the root |

**The gold-intelligence site is displaced, not deleted.** It is fully self-contained (only external call is `gold-api.com` for the live price) and has no internal `href`s, so relocating it to `/intelligence` breaks nothing. `.github/workflows/sync.yml` writes only to `data/`, so the 6-hourly data sync is unaffected.

A clone is at `bucks.global/` in this folder. Branch `feat/bucks-installer-homepage` **was pushed 2026-07-29** (`infin8sync69-source` was granted collaborator rights; the earlier 403 is resolved). `main` is deliberately untouched — the change is not live until it is merged.

**Two Vercel projects build this repo**, both under the `shafeeqduddiyanda-9860s-projects` team — `bucks.global` and `bucks-global`. Each produced a successful preview for the branch, and a merge to `main` will redeploy **both**. (An earlier note in this file guessed `bucks-global` was an unrelated Next.js app under a different account — that is wrong; it builds this repo.)

Preview deployments are behind **Vercel SSO deployment protection** (`/install` and every other path 302 to `Login – Vercel`), so previews are only viewable while logged into that Vercel team, and `curl | bash` cannot be tested against a preview URL — only against production once merged.

## Serving host note

`https://bucks.global/` 307-redirects to `https://www.bucks.global/`; `www` is canonical. The install one-liner is unaffected because `curl -fsSL` includes `-L` and follows the redirect.

**Cloudflare Pages** alternative: connect the repo as a Pages project; `_headers` is picked up automatically for the content-type rules. DNS would need to move off Vercel's nameservers, which is a bigger change than staying on the current deployment.

## Re-pinning after an update

1. Build the new release tarball (replace `bucks-browser-dist.tar.gz`).
2. Re-run the Kubo add:
   ```bash
   mkdir -p /tmp/bucks-dist
   cp bucks-browser-dist.tar.gz install.sh /tmp/bucks-dist/
   curl -s -X POST "http://127.0.0.1:5001/api/v0/add?recursive=true&wrap-with-directory=true&cid-version=1" \
     -F "file=@/tmp/bucks-dist/install.sh;filename=install.sh" \
     -F "file=@/tmp/bucks-dist/bucks-browser-dist.tar.gz;filename=bucks-browser-dist.tar.gz"
   ```
3. Take the new root CID from the last (empty-`Name`) line of the response.
4. Update `BUCKS_CID` in `install.sh`, `buck-global-site/install`, and the CID shown in `buck-global-site/index.html`.
5. Old CID stays pinned unless explicitly unpinned (`ipfs pin rm <old-cid>`) — safe to leave both pinned during a transition window.
6. Copy `buck-global-site/{index.html,install,install.ps1}` into the `bucks.global` repo root, commit, and push — Vercel redeploys on push to `main`.

## Version Control & Multi-Release Distribution Architecture

The Bucks base application supports side-by-side version storage and dynamic runtime version selection via the **Bucks Version Controller**.

### 1. Multi-Release Storage Layout (`~/.bucks/versions/`)

Instead of replacing the installed application during an update, new releases are installed in version-tagged directories under `~/.bucks/versions/`:

```
~/.bucks/
├── versions/
│   ├── v1.0.0/             # Previous release (Go EVM Engine, Chain 8192)
│   │   └── electron/
│   └── v1.1.0/             # Latest release (C++ PoW Engine + UI 1.1)
│       └── electron/
├── current -> versions/v1.1.0 # Symlink pointing to active active version
├── bucks                   # CLI launcher supporting version commands
└── launch-bucks.sh
```

### 2. Multi-Version IPFS Release Manifest (`versions.json`)

The `https://bucks.global/versions.json` endpoint (and IPFS pinned directory) maintains the full release history:

```json
{
  "latest": "1.1.0",
  "versions": [
    {
      "version": "1.1.0",
      "cid": "bafybeicvrcadmmtckkyajga4qf623cfikottihgesdqy7di6ivtrwoa3hy",
      "engine": "cpp",
      "channel": "stable",
      "releaseDate": "2026-08-13"
    },
    {
      "version": "1.0.0",
      "cid": "bafybeibnpppmcznux44cazoyc7dnokpwie2d6mrybdzszjxlhacn3hc6x4",
      "engine": "go",
      "channel": "legacy",
      "releaseDate": "2026-07-01"
    }
  ]
}
```

### 3. Version Controller CLI Commands

The `bucks` CLI tool allows users to list, install, and switch between current and previous app versions:

- `bucks versions` — Lists installed and available versions on IPFS.
- `bucks use <v1.0.0|v1.1.0>` — Switches active version symlink and launches target release.
- `bucks install <version>` — Downloads and verifies a specific release version tarball from IPFS without overwriting existing versions.

---

## Summary

| Item | Value |
|---|---|
| Install command | `curl -fsSL https://bucks.global/install \| bash` |
| Version Storage | `~/.bucks/versions/v<version>/` |
| Active Symlink | `~/.bucks/current` |
| Root CID | `bafybeifdjsptd56c5gt4pcsx5w7soo2opoylcdcpoyipdk2ynaybdtklgy` |
| Fallback chain | IPFS gateways only (`ipfs.io`, `dweb.link`, `w3s.link`, `nftstorage.link`) — no Drive |
| Deploy source | `github.com/shafeeqduddiyanda/bucks.global` → Vercel (auto-deploys on push to `main`) |
| Staged branch | `feat/bucks-installer-homepage` — pushed 2026-07-29, previews green, **not yet merged** |
| Vercel projects | `bucks.global` **and** `bucks-global` both build this repo; merging deploys both |
| Gold-intelligence site | preserved, moves from `/` to `/intelligence` |

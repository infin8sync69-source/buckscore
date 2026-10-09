# Bucks Files — Cluster Setup Guide

Share files across multiple Macs over a private network. No Apple Developer
account needed — everything installs from Homebrew (already notarized) and the
UI runs in your browser.

## What you get
- A private IPFS **cluster**: add/pin a file on any machine, it's available on all.
- A web **file manager** at `http://localhost:3939`.
- A **Tailscale** private network so peers connect from anywhere (any Wi‑Fi, any
  location) — no port forwarding, no firewall config.

---

## 1. On the HOST (the machine that owns the cluster) — do this ONCE

```sh
bash setup-host.sh
```
- Installs Homebrew + Tailscale + IPFS if missing.
- A browser window opens → **log into Tailscale** (free; Google/GitHub/email).
- It auto-writes the bootstrap address into `cluster-config.env`.

When it finishes it prints the host's Tailscale IP and the bootstrap address.

---

## 2. Share the folder with each peer

Send the **whole `IPFS` folder** (now containing the filled-in
`cluster-config.env`) — AirDrop, USB, zip, Google Drive, etc.

> The secret lives in `cluster-config.env`. Anyone with it can join the cluster,
> so share it only with people you trust.

---

## 3. On each PEER machine — one command

```sh
bash join-cluster.sh
```
- Installs Homebrew + Tailscale + IPFS automatically.
- Browser opens → **log into Tailscale using the SAME account/tailnet as the host.**
- Joins the cluster and opens the UI at `http://localhost:3939`.

---

## Verify it worked
On any machine:
```sh
ipfs-cluster-ctl peers ls     # lists every connected machine
ipfs-cluster-ctl status       # pin status across peers
```

## Day-to-day
- Drag a file into the UI on any machine → it pins and appears on all peers.
- Restart later: just re-run `bash join-cluster.sh` (or `setup-host.sh` on the
  host). The scripts skip anything already installed/running.

## Troubleshooting
- **Peer doesn't show up:** confirm both machines are logged into the *same*
  Tailscale account (`tailscale status`), and that the host is online.
- **`BOOTSTRAP is empty`:** run `setup-host.sh` on the host first, then re-share
  the folder so peers get the updated `cluster-config.env`.
- **Logs:** `/tmp/ipfs.log`, `/tmp/ipfs-cluster.log`, `/tmp/bucks-ui.log`.

# IPFS Cluster + File Manager

A local IPFS cluster with a web file manager UI for adding, pinning, previewing, downloading, and unpinning files across cluster peers.

## Components

- **kubo** (`ipfs daemon`) — the IPFS node (API :5001, gateway :8080)
- **ipfs-cluster-service** — cluster peer that coordinates pinning (REST API :9094)
- **server.js** — zero-dependency Node server: serves the UI and proxies the cluster API + gateway
- **public/index.html** — the file manager UI

## Run (native, macOS)

```sh
ipfs daemon &              # if not already running
ipfs-cluster-service daemon &
node server.js             # → http://localhost:3939
```

## Run (Docker, 3-node cluster)

Requires Docker Desktop:

```sh
export CLUSTER_SECRET=$(od -vN 32 -An -tx1 /dev/urandom | tr -d ' \n')
docker compose up -d
node server.js             # UI talks to localhost:9094 / :8080 as before
```

## Useful commands

```sh
ipfs-cluster-ctl peers ls          # list cluster peers
ipfs-cluster-ctl status            # pin status across peers
ipfs-cluster-ctl add <file>        # add + pin from the CLI
ipfs-cluster-ctl pin rm <cid>      # unpin
```

## Adding more peers (native)

On another machine: install kubo + ipfs-cluster, copy the `secret` from
`~/.ipfs-cluster/service.json`, then run
`ipfs-cluster-service daemon --bootstrap /ip4/<this-host>/tcp/9096/p2p/<cluster-peer-id>`.

# Bucks Core

This repository holds the Bucks back-end pieces (the Go chain node in `node/`, Solidity
`contracts/`, the browser-extension `wallet/`, the `miner/` and `miner-gui/`), the packaged
Electron "Bucks Core" app in `Bucks-App/` (v1.1.0, the one bucks.global installed), and the
project's planning and audit notes. [PROJECT_MAP.md](PROJECT_MAP.md) is the index.

## Where the browser lives

The **Bucks Browser** source is
[infin8sync69-source/Bucks-browser](https://github.com/infin8sync69-source/Bucks-browser): the
Electron rewrite with `ipfs://` tabs on a supervised Kubo node, a security layer, device pairing,
installers for Linux, Windows and macOS, and tests. Its branch
[`claude/browser-repos-alignment-aew07f`](https://github.com/infin8sync69-source/Bucks-browser/tree/claude/browser-repos-alignment-aew07f)
(2026-10-18, based on `electron-main`) adds the Soul Engine agent from `Bucks-App/agent/`, run as
a token-protected sidecar with an on-device model by default, and
[`docs/ALIGNMENT.md`](https://github.com/infin8sync69-source/Bucks-browser/blob/claude/browser-repos-alignment-aew07f/docs/ALIGNMENT.md),
which maps every `Bucks-App` module to what has moved, what is planned and what was left out on
purpose.

`Bucks-App/` stays here as the shipped v1.1.0 and as the reference for features not ported yet.
Its `agent/` has the same code as the browser's `agent/` on that branch (the browser leaves out
the Railway deploy files), so a fix in one belongs in the other.

## Running Bucks-App (v1.1.0)

```bash
cd Bucks-App
npm --prefix electron install
./agent/start_soul_engine.sh   # first time: creates agent/.venv, then serves on :8765 (Ctrl+C)
npm start
```

The app starts the Soul Engine itself on `127.0.0.1:8765`. Its launcher defaults to NVIDIA NIM,
which needs your own key in `Bucks-App/agent/.env` (see `agent/.env.example`):

```dotenv
MODEL_PROVIDER=nim
NGC_API_KEY=nvapi-your-real-key
NIM_BASE_URL=https://integrate.api.nvidia.com/v1
```

Without a key, choose the on-device model (Qwen) in the app's model selector, or put
`MODEL_PROVIDER=edge` in `agent/.env`. Check the engine with `curl http://127.0.0.1:8765/health`.

Bucks-App starts the engine without the token the browser uses, so the engine logs that it
accepts any caller, as it always has. Bucks Browser does not have this gap.

## Security notice

Until 2026-10-18, `Bucks-App/agent/memory/session_store.py` contained a Supabase Postgres
connection string **with its password** as a default, and copied prompts to that database
whenever `psycopg2` was installed. The default is gone (cloud sync now needs `DATABASE_URL`), but
the password is still in this repository's git history: **rotate it in Supabase**. Removing it
from history needs a rewrite (`git filter-repo`) and a force push, which is a separate decision.

## Project guides

- [Project map](PROJECT_MAP.md)
- [Bucks Browser README](https://github.com/infin8sync69-source/Bucks-browser#readme)
- [App Store summary](app-store-summary.md)
- [Distribution guide](DISTRIBUTION.md)

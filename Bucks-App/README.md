# Bucks Production Application Launch Folder

> **Note (2026-10-18):** this is the shipped v1.1.0. The browser's source now lives in
> [infin8sync69-source/Bucks-browser](https://github.com/infin8sync69-source/Bucks-browser), which
> is taking over this app's features module by module, starting with the Soul Engine (`agent/`).
> See `PROJECT_MAP.md` §10 and `docs/ALIGNMENT.md` in that repository. Fixes to `agent/` belong in
> both places.

This is the clean, production-ready release folder for **Bucks Agentic AI Web3 Browser**. All unnecessary documentation drafts, temporary logs, and experimental scratch files have been excluded.

---

## Quick Start (How to Launch)

Open your terminal and run:

```bash
cd ~/Desktop/Bucks-App && npm start
```

*or run the 1-click launcher script:*

```bash
~/Desktop/Bucks-App/start.sh
```

---

## Included Essential Components

1. **`electron/`**: Electron application containing the latest **Nexus Intelligence UI**, **`+ New Chat`**, **`History`**, and **A2UI Generative Cards**. Prebuilt with production `node_modules`.
2. **`agent/`**: Python Soul Engine backend (`soul_engine.py`) with prebuilt `.venv`, model registry, and automatic port-conflict resolution.
3. **`start.sh`**: Single launcher script.

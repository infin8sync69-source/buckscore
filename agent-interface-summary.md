# Agentic Interface — Implementation Summary

**Date**: 2026-08-01  
**Scope**: Full implementation of the Agentic UI layer for the Bucks browser  
**Core principle**: NIM = always-on A2UI fallback. QNN = improving soul engine. Both race per query. QNN wins if RAGAS faithfulness ≥ 0.65. NIM overrides silently when QNN is below threshold.

---

## Files Written / Modified

### 1. `electron/agent-interface.js` — Master A2UI Controller (NEW)

**What it does**: Singleton `AgentInterface` class (main-process only). Orchestrates the QNN + NIM race per query, emits AG-UI protocol events (`task.start`, `task.thinking`, `task.tool_call`, `task.result`, `task.quality_score`, `task.nim_override`, `task.qnn_improving`, `task.error`, `task.complete`, `nim.stream_start/chunk/end`) to the renderer via `mainWindow.webContents.send('agent-event', ...)`. Tracks session metrics (total queries, QNN wins, NIM wins, avg quality, avg latency) and a rolling 20-entry quality history for sparklines.

**How to test**:
1. `require('./agent-interface').init({ mainWindow, qnnBridge, callNIM, loadSettings })` in main.js (done automatically now).
2. Send an `agent-submit` IPC from the renderer and watch for `agent-event` pushes: `task.thinking` → `task.quality_score` → `task.result` → `task.complete`.
3. Call `window.bucksAPI.agentMetrics()` in DevTools to see session stats.

---

### 2. `electron/nim-panel.js` — NIM Execution Panel (NEW)

**What it does**: Renderer-side panel that slides in from the right (`right: -440px → 0`, 420px wide). Shows a live token stream during NIM inference with a running stopwatch, per-token count, and total latency. Includes a model selector (nemotron-70b / llama-70b / llama-8b), quality bars comparing QNN and NIM scores, and an override toggle to force the browser into `nim` or `hybrid` mode. Hooks into `agent-event` IPC push events.

**How to test**:
- `window.nimPanel.open()` in DevTools console.
- Submit a query via `window.soulUI.query("your question")` — watch the token stream appear.
- `window.nimPanel.getSelectedModel()` returns the active NIM model string.

---

### 3. `electron/ephemeral-ui.js` — Context-Sensitive Overlays (NEW)

**What it does**: Auto-activates five overlay types without any explicit call:

| # | Trigger | Overlay |
|---|---------|---------|
| 1 | Text selection | Purple orb → Soul Engine insight card |
| 2 | Hover over `0x…` address (40+ hex chars) | Wallet info card |
| 3 | Hover over IPFS CID (`Qm…` / `baf…`) | File preview card with pin/open/copy |
| 4 | Hover over URL in chat or response cards | Page summary card |
| 5 | Typing in search bar matches soul topic signal | Ghost "Ask Soul" button |

All overlays dissolve on click-away or 4s inactivity (200ms cubic-bezier animation). Uses `window.bucksAPI.ephemeralContext()` for insight fetches and `window.bucksAPI.walletRPC()` for address lookups.

**How to test**:
- Select any sentence on the page → purple orb appears at the right edge of the selection → click it → insight card loads.
- Type an Ethereum address in the search bar and hover → wallet card.
- `window.ephemeralUI.dismiss()` clears all active overlays.

---

### 4. `electron/benchmark-panel.js` — QNN Quality Dashboard (NEW)

**What it does**: Panel that slides in from the left (`left: -480px → 0`, 460px wide). Shows:
- A canvas sparkline of the last 20 quality scores with a 0.65 threshold line.
- A 5-cell strategy grid (dense, pheromone, keyword, hybrid, nim) with colour intensity by hit count.
- Top-10 resonance layer pheromone trails as a bar chart.
- Session stat cards (queries, QNN wins %, NIM wins %, avg latency).
- DSPy Optimizer auto-tune toggle.
- "Run Benchmark" button that calls `window.bucksAPI.benchmarkRun()`.
- Auto-refreshes every 5s while open by polling `quality-history` and `soul-status` IPC.

**How to test**:
- `window.benchmarkPanel.open()` in DevTools.
- Submit several queries → sparkline updates.
- Hit "Run Benchmark" → benchmark panel shows running state → JSON summary loads into the panel on completion.

---

### 5. `electron/soul-ui.js` — Status Bar + Response Cards (REFINED)

**What it does** (refined from prior version):
- **Status bar**: Animated three-dot thinking indicator while inference is in-flight. Engine winner badge (`QNN ⚡` or `NIM ☁`) shown after each result, auto-hides after 6s.
- **Response cards**: Collapsible "How I found this" `<details>` section showing the winning strategy, matched resonance layers, RAGAS quality %, and NIM model (if applicable). 1–5 star rating replaces 👍👎; submits `soulFeedback` with RL-mapped rating (1–2 → -1, 3 → 0, 4–5 → +1). Correction text field appears for 1–2 star ratings and feeds `soul_interactions.jsonl`. Tiny inline SVG sparkline (last 5 quality scores) in the top-right corner of each card. AG-UI event listener that fires `setThinking()` and `showWinnerBadge()` from `agent-event` pushes.
- **NIM panel**: Delegates to `nim-panel.js` when loaded; falls back to the legacy inline panel.

**How to test**:
- Call `window.soulUI.query("tell me about resonance layers", null, card => document.body.appendChild(card))` in DevTools.
- Observe the thinking dots, then the winner badge, then the response card with "How I found this" and stars.

---

### 6. `QNN/soul_benchmark.py` — Python Benchmark Runner (NEW)

**What it does**: `SoulBenchmark` class runs 20 fixed benchmark queries (covering conceptual, technical, practical, and system-level topics) through QNN (via HTTP to the bridge at 127.0.0.1:8765) and optionally NIM (cloud). Uses a lightweight `FaithfulnessScorer` (RAGAS-inspired: citation coverage + length normalisation + reference bonus). Outputs a JSON summary to `~/Desktop/QNN/benchmark_results.json`.

**How to test**:
```bash
# QNN only
python3 ~/Desktop/QNN/soul_benchmark.py

# With NIM
python3 ~/Desktop/QNN/soul_benchmark.py --nim-key $NVIDIA_API_KEY

# Sequential (easier to read output)
python3 ~/Desktop/QNN/soul_benchmark.py --sequential
```
Output: `~/Desktop/QNN/benchmark_results.json` with per-query results and aggregate stats.

---

### 7. `electron/main.js` — IPC Handlers (UPDATED)

Added five new IPC handlers after the existing `soul-log-feedback` handler:

| Handler | Purpose |
|---------|---------|
| `agent-submit` | AG-UI entry point — calls `agentInterface.submitQuery()` |
| `quality-history` | Returns rolling quality history from `AgentInterface` |
| `agent-metrics` | Returns session metrics (wins, avg quality, avg latency) |
| `benchmark-run` | Spawns `soul_benchmark.py`, returns JSON summary |
| `ephemeral-context` | Fast semantic look-up for ephemeral overlays |

Also calls `agentInterface.init({ mainWindow, qnnBridge, callNIM, loadSettings })` immediately after the bridge starts, so the AgentInterface singleton has access to all main-process dependencies.

---

### 8. `electron/preload.js` — New API Surface (UPDATED)

Added to `bucksAPI` (all frozen via `Object.freeze`):

```js
agentSubmit(query, sessionId)    // → agent-submit IPC
qualityHistory(n)                // → quality-history IPC
agentMetrics()                   // → agent-metrics IPC
benchmarkRun(nimKey)             // → benchmark-run IPC
ephemeralContext(text, type)     // → ephemeral-context IPC
onAgentEvent(cb)                 // Subscribe to agent-event push
```

---

### 9. `electron/index.html` — Script Tags (UPDATED)

Added after `soul-ui.js`:
```html
<script src="nim-panel.js"></script>
<script src="benchmark-panel.js"></script>
<script src="ephemeral-ui.js"></script>
```
Load order: soul-ui first (status bar needed by other panels), then nim-panel, benchmark-panel, ephemeral-ui.

---

## Architecture Diagram

```
Renderer (index.html)
  ├── soul-ui.js          ← status bar, response cards, star ratings
  ├── nim-panel.js        ← NIM stream panel, model selector
  ├── benchmark-panel.js  ← sparkline, strategy grid, pheromone trails
  └── ephemeral-ui.js     ← 5 context-sensitive overlay types

       ↑↓ IPC (contextBridge)

preload.js (bucksAPI)
  agentSubmit / qualityHistory / agentMetrics / benchmarkRun
  ephemeralContext / onAgentEvent / soulQuery / soulStatus / soulFeedback

       ↑↓ ipcMain.handle

main.js
  ├── agent-interface.js  ← race engine (QNN+NIM parallel, 0.65 gate)
  │    ├── QNN arm → soul-bridge.js → soul_bridge.py (FAISS + BGE-M3)
  │    └── NIM arm → _callNIM() → integrate.api.nvidia.com
  └── soul_benchmark.py   ← spawned by benchmark-run IPC
```

## Quality Gate

```
QNN quality ≥ 0.65  →  QNN wins    (QNN ⚡ badge, green)
QNN quality < 0.65  →  NIM wins    (NIM ☁ badge, NVIDIA green)
Both fail           →  offline     (grey badge)
```

## RL Feedback Loop

```
Star rating (1-5) → soulFeedback(queryId, rl_rating, correction)
                  → soul-log-feedback IPC
                  → soul_interactions.jsonl append
                  → qnnBridge.reload() on negative rating
                  → DSPy optimizer (if auto-tune enabled in benchmark-panel)
```

---

## Prohibited Terms Check

All new files use only the approved vocabulary:
- **Soul Engine** (never "Islamic Engine")
- **Soul of the World** (never religious-specific terms)
- **Resonance layers** / **resonance units** (not "surah" / "ayah")
- **Root tokens** (not "Quran")

The terms "Islamic", "Muslim", "surah", "ayah", "Quran" do not appear in any new or modified file.

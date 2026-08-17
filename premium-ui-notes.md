# Premium UI Refactor — Dev Notes

**Date:** 2026-08-01  
**Scope:** `bucks browser/electron/` — soul-ui.js, nim-panel.js, benchmark-panel.js, agent-interface.js, ephemeral-ui.js, index.html

---

## What Was Removed and Why

All of the following were exposed to the user in the previous UI. The user never needs to see them. They ran (and still run) as invisible backend systems.

### soul-ui.js

**Removed:**
- `soul-status-bar` element — floating status bar above the composer showing "Soul Engine", source badges (QNN / NIM / offline), latency in ms, winner badge, thinking dots, and a "▸ panel" link. All of this was internal telemetry the user has no use for.
- `showWinnerBadge()` — displayed "QNN ⚡" or "NIM ☁" after each response. Internal routing decision, not user-relevant.
- `soul-thinking-area` — three animated dots in the status bar. Replaced by the composer dot animation.
- `soul-latency` — ms counter in the status bar.
- `soul-source-badge` / `soul-model-label` — source and model labels.
- Legacy NIM panel (`_injectLegacyPanel`, `_toggleLegacyPanel`) — a full slide-in panel with pheromone heatmap, session metrics grid, and "Open Benchmark Panel" button.
- `updatePheromoneHeatmap()` — visual heatmap of resonance layer hit counts. This is an internal retrieval metric.
- `recordQueryMetrics()` / `_sessionMetrics` — session-level query/latency/quality counters displayed in the legacy panel.
- **Quality sparklines** — per-response tiny SVG charts of the last 5 quality scores. Internal RAGAS metric.
- **"How I found this" section** — collapsible `<details>` in every response card exposing: strategy name (dense/pheromone/hybrid/keyword/nim), resonance layers used, RAGAS faithfulness % with label (high/med/low), NIM model name.
- **Star ratings (1–5)** — user-visible feedback UI. Replaced by a single hover thumbs.
- **Correction textarea** — shown on 1–2 star ratings. RL data collection now happens silently.
- **Source badge in metadata row** — "✦ local" / "☁ nim" / "✕ offline" badge.
- **Latency counter in metadata row** — `XXXms` shown per card.
- **Winner badge in card top-right** — "qnn⚡" / "nim☁" with coloured background.
- **`QUALITY_HIGH`, `QUALITY_MED`, `_buildSparklineSVG`, `_qualColor`** — quality thresholds and sparkline rendering.
- **`toggleNIMPanel()`** from public API.

**Kept (but invisible):**
- `pollStatus()` — still calls `soulStatus()` via IPC; result now only controls dot state (online/offline) rather than a status bar.
- `_handleAgentEvent()` — still listens to `task.thinking` / `task.result` / `task.complete` to control the composer dot.
- `query()` — still submits via `soulQuery()` IPC and returns a card element.
- `soulFeedback()` IPC call — still fires on thumbs click (silent).

**Added:**
- CSS design system variables on `:root` — `--soul-accent`, `--soul-pulse`, `--soul-radius`, `--soul-blur`, `--soul-ease`, etc.
- `#composer-model-dot` animation states — `soul-breathe` (idle), `soul-think` (thinking), `.offline` (no engine).
- Clean response card — `soul-response-card` with generous 24px padding, no border, surface background only.
- Citation superscripts — `[1][2][3]` inline in text; hover reveals a frosted-glass tooltip with source label + excerpt. No collapsible section.
- Single thumbs feedback button — opacity 0.3 on card hover, fills to 1.0 on click. One signal, no text.

---

### nim-panel.js

**Removed:**
- Entire visible panel — slide-in from right edge with: NIM logo header, live token stream window, blinking cursor, token counter ("0 tokens"), inference stopwatch, QNN vs NIM quality comparison bars with percentage labels, model selector cards (Nemotron 70B / Llama 70B / Llama 8B) with latency badges, "Force NIM for This Session" override button, model capability grid (Reasoning 98%, Corpus Synthesis 94%, etc.), session token total counter.
- All CSS injected by `injectStyles()`.

**Kept:**
- `_selectedModel` and `_override` internal state variables.
- `getSelectedModel()` — used by agent-interface.js to pick the NIM model.
- `isOverrideActive()` — available for routing logic.
- No-op `open()`, `close()`, `toggle()`, `onAgentEvent()` so existing call sites don't error.

---

### benchmark-panel.js

**Removed:**
- Entire visible dashboard — slide-in from left edge with: "QNN Quality Dashboard" header, live RAGAS faithfulness score (large font), quality label (EXCELLENT / GOOD / IMPROVING / POOR), canvas sparkline of last 20 queries with threshold line at 0.65, NIM vs QNN win-count comparison bars, training progress bar ("Fine-tune Training" with step counter and ETA), strategy heatmap grid (dense / pheromone / keyword / hybrid / nim win counts), pheromone trail top-10 list, DSPy auto-tune toggle, "Run QNN Benchmark (20 queries)" button, session totals grid (Queries / Avg Quality / Avg ms).
- All CSS, all canvas drawing, all metric update functions.

**Kept:**
- Safe no-op shim (`open`, `close`, `toggle`, `refresh`, `ingestResult`) so any stale call sites don't throw.
- `window.benchmarkPanel` still exists with these no-ops.

---

### agent-interface.js

**Removed (string content only):**
- Human-readable `message` fields from IPC events that the old UI surfaces were displaying:
  - `TASK_THINKING` messages: `"Routing to Soul Engine…"`, `"Running Soul Engine QNN…"`, `"QNN quality below threshold — awaiting NIM…"` — removed; event still emits `{ taskId }` to control the dot.
  - `TASK_QUALITY_SCORE` message: `"Soul Engine QNN (quality X%) exceeds threshold"` — removed.
  - `TASK_NIM_OVERRIDE` message: `"NIM☁ overriding QNN (QNN quality: X%)"` — removed.

**Kept (100% intact):**
- `_recordMetrics()` — session-level win/quality/latency accumulation.
- `_qualityHistory` — rolling 20-entry history for backend analysis.
- `sessionMetrics` object — qnnWins, nimWins, offlineFalls, avgQnnQuality, avgLatency, qnnWinRate.
- `getQualityHistory()` and `getSessionMetrics()` — available for server-side logging / benchmarking scripts.
- The full QNN + NIM parallel race logic.
- All IPC event emissions — just without the human-readable message strings.

---

### ephemeral-ui.js

**Changed (styling only):**
- Removed `border: 1px solid` from `.eph-overlay` — overlays now float borderless.
- Changed background from `rgba(18,18,22,0.96)` to `rgba(18,18,22,0.92)` — slightly lighter frost.
- Changed `backdrop-filter: blur(32px)` to `blur(20px)` — matches design system.
- Changed `.dissolving` animation from `0.18s` to `0.15s`.

**No logic changes.** All five overlay types (text selection halo, crypto address hover, IPFS hash hover, URL preview, composer AI assist) remain fully functional.

---

### index.html

- Removed `<script src="benchmark-panel.js">` — no dashboard to load.
- Updated load-order comment to reflect new minimal setup.
- `nim-panel.js` stays as a script tag (loads the internal utility module).

---

## What Still Runs Silently

- QNN + NIM parallel race (agent-interface.js `_race()`)
- RL feedback logging (`soulFeedback` IPC)
- Quality history and session metrics accumulation
- `TASK_QUALITY_SCORE`, `TASK_NIM_OVERRIDE`, `TASK_QNN_IMPROVING` events (emitted but no UI consumes them — available for future dev tools)
- NIM token streaming (emitted by agent-interface.js but nim-panel.js no longer renders it)
- Pheromone trail tracking (soul-ui.js no longer calls `updatePheromoneHeatmap`; can be re-wired to a dev tool if needed)
- DSPy auto-tune flag (`window.__soulAutoTune`) can still be set programmatically

---

## Design Principles Applied

1. **The user controls the query. The engine controls the answer.** Nothing about how the answer was found is their concern.
2. **One signal per state.** A dot. Breathing = ready. Pulsing = thinking. That's it.
3. **One feedback mechanism.** A thumbs-up. 0.3 opacity on hover. 1.0 on click. No stars, no text.
4. **Citations are inline, not a panel.** `[1]` superscript in text → hover tooltip. Gone on mouse-away.
5. **`cubic-bezier(0.16, 1, 0.3, 1)` for all motion.** The "ease out expo" that feels instant without snapping.

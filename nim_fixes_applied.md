# NIM Integration Fixes — Applied 2026-08-02

## Fix 1 — Raise max_tokens to 3000

**Files changed:**
- `bucks browser/electron/main.js` line 1539: `max_tokens: 1024` → `3000`
- `~/Desktop/QNN/soul_nim.py` line 100: `max_tokens: int = 512` → `3000` (default parameter of `generate()`)
- `~/Desktop/QNN/soul-api-deploy/soul_nim.py` line 99: same change

The `max_tokens=5` value in `_probe_models()` was intentionally left unchanged — it's a connectivity probe, not a generation call.

---

## Fix 2 — Soul Engine system prompt in every NIM call

**Files changed:**
- `bucks browser/electron/main.js` (`_callNIM`): the `messages` array now starts with a `role: "system"` entry before the user message.
- `~/Desktop/QNN/soul_nim.py`: added module-level `_SOUL_ENGINE_SYSTEM` constant; changed `generate()` default for `system` from `""` to `_SOUL_ENGINE_SYSTEM`.
- `~/Desktop/QNN/soul-api-deploy/soul_nim.py`: same changes as above.

The system prompt identifies the assistant as the Soul Engine inside Bucks, describes the dual-engine architecture (local semantic retrieval + cloud reasoning), and instructs the model to favour self-hosted/open-source answers and never disclose underlying model identity.

---

## Fix 3 — Wire NIM responses through the evaluator

**Files changed:**

### `bucks browser/electron/agent-interface.js`
After NIM wins the race (inside `_race()`), a `setImmediate` block fires asynchronously (non-blocking). It calls `_bridge.evaluate(query, response, 'nim')` and, on success, calls `_bridge.logFeedback(...)` to write the rated interaction to `soul_interactions.jsonl`. Errors are swallowed so the main response path is never affected.

### `bucks browser/electron/soul-bridge.js`
Two new public methods added:
- `evaluate(query, response, source)` — sends `evaluate` JSON-RPC to `soul_bridge.py`
- `logFeedback(data)` — sends `log_feedback` JSON-RPC to `soul_bridge.py`

Both are exported in `module.exports`.

### `~/Desktop/QNN/soul_bridge.py`
Two new RPC handlers registered in `_DISPATCH`:
- `evaluate` — imports `SoulEvaluator`, calls `evaluator.score(query, response)`, returns `{score, source}`. Falls back to `score: 0.75` if the evaluator is unavailable.
- `log_feedback` — calls `_append_interaction(params)` to write the NIM result into `soul_interactions.jsonl` for RL training.

---

## Verification (post-apply)

```
grep max_tokens main.js              → 3000 ✓
grep max_tokens soul_nim.py          → 3000 ✓ (default param)
grep "Soul Engine" main.js           → role: 'system' at line 1534 ✓
grep "evaluate" agent-interface.js   → line 265 ✓
node --check main.js                 → OK ✓
node --check agent-interface.js      → OK ✓
node --check soul-bridge.js          → OK ✓
```

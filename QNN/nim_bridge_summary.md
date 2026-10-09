# NIM→QNN Feedback Bridge

**Created:** 2026-08-02  
**Status:** Active — wired into soul_nim.py  

---

## What the bridge does

Every time NIM's `generate()` method returns a response, `soul_nim_bridge.py` intercepts it and writes a training entry to `soul_interactions.jsonl`. This means QNN now learns from two sources simultaneously:

| Source | File | Quality signal |
|--------|------|----------------|
| User thumbs feedback | soul_interactions.jsonl (`user_signal`) | Direct human rating |
| **NIM responses** *(new)* | soul_interactions.jsonl (`source="nim"`) | Estimated 0.80 corpus_alignment_score |
| Bucks architecture docs | bucks_knowledge.jsonl | Reference only (not yet indexed) |

---

## How NIM examples flow into DSPy training

```
User query
    │
    ├─── QNN swarm ─── response ─── logged by LearningLogger
    │
    └─── NIM generate() ─── text
              │
              └─── capture_nim_response()  [soul_nim_bridge.py]
                        │
                        ├── dedup check (query_hash)
                        ├── length filter (≥ 100 chars)
                        └── write to soul_interactions.jsonl
                                  │
                                  corpus_alignment_score = 0.80
                                  source = "nim"
                                  learning_eligible = True
                                  │
                        soul_dspy_optimizer._load_examples()
                                  │
                                  filters: score ≥ 0.50  ✓
                                  context: "Reference answer from NIM (model-name)"
                                  │
                        DSPy BootstrapFewShot compile
                                  │
                        soul_dspy_compiled.json
                                  │
                        QNN uses optimized prompts  ←── loop closed
```

---

## What bucks_knowledge.jsonl is

An append-only log of architectural facts about Bucks. Written by `capture_bucks_knowledge()` whenever Claude builds a new component. Format:

```json
{
  "timestamp": 1722470400,
  "type": "bucks_architecture",
  "component": "app-store",
  "description": "...",
  "code_snippet": null,
  "source": "claude_build"
}
```

Currently seeded with 6 entries covering: app-store, soul-bridge, agent-interface, nim-fallback, qnn-swarm, nim-bridge.

**To add entries after building something new:**
```python
from soul_nim_bridge import capture_bucks_knowledge
capture_bucks_knowledge(
    component="new-component-name",
    description="What it does and why it exists.",
    code_snippet="# optional key pattern"
)
```

---

## Files changed

| File | Change |
|------|--------|
| `soul_nim_bridge.py` | **New** — capture + dedup + stats + Bucks knowledge logger |
| `soul_nim.py` | **Patched** — import + non-blocking `capture_nim_response()` call in `generate()` |
| `soul_dspy_optimizer.py` | **Patched** — `_load_examples()` handles NIM entries: `estimated_quality` fallback, `response_full` preference, NIM context string |
| `bucks_knowledge.jsonl` | **New** — seeded with 6 architecture entries |
| `nim_bridge_log.jsonl` | **Auto-created** — audit log of bridge activity |

---

## Current stats

At time of writing (2026-08-02):

```
NIM examples captured : 0   (bridge just deployed — will fill on first real queries)
DSPy ready            : False (need 5+ examples)
```

---

## Next steps

1. **Use Bucks normally.** Every NIM call auto-captures. After ~20 queries you'll have enough examples.

2. **Check bridge health anytime:**
   ```bash
   cd ~/Desktop/QNN && python3 soul_nim_bridge.py
   ```

3. **Once you have 5+ NIM examples, compile DSPy:**
   ```bash
   cd ~/Desktop/QNN && python3 soul_dspy_optimizer.py --compile
   ```
   This rewrites `soul_dspy_compiled.json` with prompts optimized against real NIM+swarm examples.

4. **Force-log a specific NIM response** (e.g. to seed before natural accumulation):
   ```python
   from soul_nim_bridge import capture_nim_response
   capture_nim_response(
       query="your query here",
       nim_response="NIM's response (≥100 chars) ...",
       nim_model="nvidia/llama-3.1-nemotron-70b-instruct"
   )
   ```

5. **Quality signal improves over time.** When users rate responses via the thumbs UI, `user_signal` is set on swarm entries. NIM entries start at 0.80 — the DSPy optimizer will eventually learn which types of queries NIM handles better vs. QNN.

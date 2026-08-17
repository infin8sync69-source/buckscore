# Soul Engine QNN — Bucks Browser Integration Plan

**Date:** 2026-08-01  
**Status:** Implementation complete — ready for testing

---

## 1. Current Architecture (before integration)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Bucks Browser                            │
│                                                                 │
│  index.html ──── renderer.js ──── nexus-panel.js               │
│       │               │                                         │
│  soul-ui.js      composer-bar                                   │
│  (NEW ✦)         #model-selector                                │
│                  #nt-search-input                               │
│                       │                                         │
│                   preload.js (contextBridge)                    │
│                       │                                         │
│                    main.js (IPC handlers)                       │
│                       │                                         │
│          ┌────────────┴─────────────────┐                       │
│          │                              │                       │
│   soul-engine-supervisor.js      bucks-node.js                  │
│          │                        (blockchain)                  │
│          ▼                                                       │
│   Python soul_engine.py                                         │
│   HTTP :8765  (existing, unchanged)                             │
│          │                                                       │
│   Ollama / local LLM                                            │
│                                                                 │
│  IPFS node (Helia) ──── agent-swarm.js ──── cluster-membership │
└─────────────────────────────────────────────────────────────────┘
```

**Key existing IPC channels:**
- `nexus:start-goal` / `nexus:approve-action` / `nexus:deny-action` / `nexus:cancel-goal`  
- `soul-engine-status` (push from supervisor + pull via invoke)  
- `web-search` / `web-fetch` / `web-fetch-summary`  
- `wallet-rpc` / `social-rpc`  
- `chat-send` / `chat-history` / `chat-conversations`  
- `cluster-*` / `device-*` / `ipfs-*`

**Existing agent interface:**
- `#composer-bar` with `#nt-search-input` + `#model-selector` + `#composer-model-dot` + `#composer-send-btn`
- `#nav-chat-panel` with `#nav-chat-messages-container` + `#nav-chat-model-select`
- `#nt-card-agent` status card (shows Soul Agent state at :8765)
- `const SOUL_ENGINE = 'http://127.0.0.1:8765'` — renderer fetches directly

---

## 2. New Architecture (after integration)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Bucks Browser                            │
│                                                                 │
│  index.html ─── renderer.js ─── nexus-panel.js                 │
│       │              │                                          │
│  soul-ui.js (NEW ✦)  │  ← injects status bar + NIM panel       │
│  #soul-status-bar    │    + response cards with citations       │
│  #soul-nim-panel     │                                          │
│                  composer-bar                                   │
│                  #nt-search-input                               │
│                       │                                         │
│               preload.js (contextBridge)                        │
│               + soulQuery / soulStatus / soulFeedback (NEW ✦)  │
│                       │                                         │
│                    main.js (IPC)                                │
│          ┌────────────┼────────────┬──────────────┐            │
│          │            │            │              │            │
│  soul-engine-     soul-query   soul-status  soul-log-feedback  │
│  supervisor.js    (NEW ✦)      (NEW ✦)      (NEW ✦)           │
│  :8765 HTTP       │                          │                 │
│                   │                          ▼                 │
│              soul-bridge.js (NEW ✦)   soul_interactions.jsonl  │
│              Node subprocess mgr      RL training log          │
│                   │                                            │
│              stdin/stdout JSON-RPC                             │
│                   │                                            │
│  ~/Desktop/QNN/soul_bridge.py (NEW ✦)                         │
│  ├─ AdaptiveBuilder (loads once)                               │
│  │   ├─ FAISS index (quran_bge_m3.faiss)                      │
│  │   ├─ BGE-M3 encoder                                         │
│  │   ├─ SwarmCore (4 parallel retrieval strategies)            │
│  │   │   dense | pheromone | layer | keyword                   │
│  │   ├─ SoulEvaluator (quality scoring)                        │
│  │   └─ LearningLogger → soul_interactions.jsonl               │
│  └─ NIMClient (fallback via NVIDIA API)                        │
│                                                                 │
│  ┌──── NIM Fallback Chain ────────────────────────────────────┐ │
│  │  1. Local QNN (quality > 0.15)  → return with source:local │ │
│  │  2. NIM API (NVIDIA_API_KEY)    → return with source:nim   │ │
│  │  3. Offline message             → return with source:offline│ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──── Reinforced Learning Loop ──────────────────────────────┐  │
│  │  query → response → user rates (👍/👎) → soul-log-feedback  │  │
│  │  → appendFileSync soul_interactions.jsonl                   │  │
│  │  → soul_dspy_optimizer.py reads JSONL → fine-tunes model   │  │
│  │  → soul-bridge.js.reload() → AdaptiveBuilder hot-reloads   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. IPC Channels — Payload Shapes

### `soul-query`
```javascript
// Renderer → Main
{ query: string, sessionId: string | null }

// Main → Renderer
{
  query_id        : string,           // e.g. "1722528000000-3f4a"
  response        : string,           // generated answer
  citations       : [{
    ref   : string,                   // "Al-Baqarah 2:255"
    text  : string,                   // passage text
    cid   : string,                   // IPFS CID
    score : number,                   // cosine similarity 0–1
  }],
  quality         : number | null,    // 0–1 alignment score; null from NIM
  strategy        : string,           // "dense" | "pheromone" | "hybrid" | "nim"
  resonance_layers: string[],         // activated layer names
  latency_ms      : number,
  source          : "local" | "nim" | "offline",
  model?          : string,           // only present for NIM responses
}
```

### `soul-status`
```javascript
// No payload in.

// Out:
{
  local       : boolean,       // QNN subprocess connected
  nim         : boolean,       // NVIDIA_API_KEY is set
  activeModel : string,        // "local-qnn" | "nim-cloud" | "offline"
  bridgeStatus: {
    connected : boolean,
    pid       : number | null,
    uptime    : number,        // seconds
    pendingRpc: number,
    restarts  : number,
  },
  soulEngine  : object,        // existing soul-engine-supervisor status
}
```

### `soul-log-feedback`
```javascript
// In:
{ queryId: string, rating: 1 | -1, correction: string | null }

// Out:
{ ok: boolean, error?: string }
```

---

## 4. Reinforced Learning Data Flow

```
User query
    │
    ▼
soul_bridge.py::_handle_query()
    │
    ├─ AdaptiveBuilder.query() → result dict
    │   ├─ SwarmCore parallel retrieval
    │   ├─ Prompt construction
    │   ├─ Soul Engine generation
    │   ├─ SoulEvaluator quality scoring
    │   └─ Pheromone trail update
    │
    ├─ LearningLogger appends to soul_interactions.jsonl
    │   { query_id, query, response, strategy, quality, latency_ms, rating:null }
    │
    └─ Returns result → JSON-RPC → soul-bridge.js → IPC → renderer
         │
         ▼
    soul-ui.js renders response card with 👍/👎 buttons
         │
         ▼ (user rates)
    window.bucksAPI.soulFeedback(queryId, rating)
         │
         ▼
    main.js soul-log-feedback handler
    fs.appendFileSync(soul_interactions.jsonl,
      { query_id, rating, correction, feedback_ts })
         │
         ▼
    soul_dspy_optimizer.py  (run periodically or on-demand)
    ├─ Reads JSONL, filters rated entries
    ├─ DSPy optimisation pass
    └─ LoRA fine-tune → updated weights
         │
         ▼
    qnnBridge.reload() → soul_bridge.py _handle_reload()
    → AdaptiveBuilder re-instantiated with new weights
    → Hot swap in-process (zero downtime)
         │
         ▼
    Improved responses on next query ♻
```

---

## 5. UI Component Changes

### Added by soul-ui.js (injected at runtime — no index.html edits needed except script tag)

| Component | ID | Position | Purpose |
|---|---|---|---|
| Soul Status Bar | `#soul-status-bar` | Fixed, above composer | Shows local/NIM/offline + latency |
| NIM Playground Panel | `#soul-nim-panel` | Fixed, slides from right | Engine mode, metrics, heatmap, API key |
| Response Card | `.soul-response-card` | Inside chat container | Response + citations + feedback |

### Modified in index.html
- Added `<script src="soul-ui.js"></script>` before `</body>`

### Modified in preload.js
- Added `soulQuery`, `soulStatus`, `soulFeedback` to `bucksAPI` object

### Modified in main.js
- Added `soul-query` IPC handler with 3-tier fallback
- Added `soul-status` IPC handler
- Added `soul-log-feedback` IPC handler
- Added QNN bridge startup in `app.whenReady()`
- Added `qnnBridge.shutdown()` in `before-quit`
- Added `https://integrate.api.nvidia.com` to CSP `connect-src`

---

## 6. New Files Checklist

```
~/Desktop/QNN/
  ✅ soul_bridge.py          — Python JSON-RPC bridge (NEW)

~/Desktop/Bucks Core/bucks browser/electron/
  ✅ soul-bridge.js          — Node.js subprocess manager (NEW)
  ✅ soul-ui.js              — Frontend UI controller (NEW)
  ✅ main.js                 — +3 IPC handlers, +bridge init/shutdown (MODIFIED)
  ✅ preload.js              — +soulQuery / soulStatus / soulFeedback (MODIFIED)
  ✅ index.html              — +<script src="soul-ui.js"> (MODIFIED)

~/Desktop/Bucks Core/
  ✅ soul-bucks-integration-plan.md  — this document (NEW)
```

---

## 7. Implementation Order (what to test first)

### Phase 1 — Verify the Python bridge standalone
```bash
cd ~/Desktop/QNN
python3 soul_bridge.py
# In another terminal, send a test RPC:
echo '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}' | python3 soul_bridge.py
# Expected: {"jsonrpc": "2.0", "id": 1, "result": "pong"}
```

### Phase 2 — Start Bucks and check console logs
```
[SoulBridge] Spawning python3 ~/Desktop/QNN/soul_bridge.py
[SoulBridge] Loading Soul Engine (AdaptiveBuilder)…
[SoulBridge] Connected (pid XXXXX)
```
Check: Menu → Dev Tools → Console for `[SoulBridge]` lines.

### Phase 3 — Check status bar
The thin pill bar should appear above the composer reading  
`✦ Soul Engine [local QNN] Xms` with a green dot.  
If green: local QNN is alive. If NVIDIA green: NIM fallback. If grey: offline.

### Phase 4 — Send a test query via bucksAPI
In Dev Tools console:
```javascript
await window.bucksAPI.soulQuery("What is the meaning of patience?", null)
// Should return { response: "...", citations: [...], quality: 0.XX, source: "local" }
```

### Phase 5 — Rate a response
```javascript
await window.bucksAPI.soulFeedback("your-query-id", 1, null)
// Check ~/Desktop/QNN/soul_interactions.jsonl for the appended line
```

### Phase 6 — NIM fallback test
Temporarily stop the Python bridge:
```javascript
// Dev Tools: disconnect is impossible externally, so test by calling with the
// bridge offline (kill the Python process), then:
await window.bucksAPI.soulQuery("test query")
// If NVIDIA_API_KEY is set → source: "nim"
// If not set → source: "offline" with explanation message
```

### Phase 7 — NIM panel
Click the `▸ panel` text on the status bar. The NIM panel should slide in from
the right showing mode buttons, session metrics, and the pheromone heatmap
(populated after at least one query).

### Phase 8 — RL loop end-to-end
After several rated queries, run:
```bash
cd ~/Desktop/QNN
python3 soul_dspy_optimizer.py
# Then reload:
echo '{"jsonrpc":"2.0","id":99,"method":"reload","params":{}}' > /dev/stdin
# Or call via Electron: qnnBridge.reload() in a main-process script
```

---

## 8. Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `NVIDIA_API_KEY` | NIM cloud fallback | (none — NIM disabled) |
| `NIM_MODEL` | Override NIM model | `nvidia/llama-3.1-nemotron-70b-instruct` |
| `BUCKS_SOUL_PORT` | Soul Engine HTTP port | `8765` |

Set in `~/.bashrc` / `~/.zshrc` or in a `.env` file in `~/Desktop/QNN/`.

---

## 9. Security Notes

- All new IPC handlers gate on `isInternalOrigin()` — external webview content cannot call them.
- The Python bridge runs under the current user account with no network access (stdin/stdout only).
- NIM API key is stored in `settings.json` (userData) via `save-settings`, not in localStorage.
- `soul_interactions.jsonl` contains user queries — treat as private user data.
- The bridge subprocess is killed cleanly on `before-quit`; no orphan Python processes.

---

---

## 10. NVIDIA Inception Infrastructure — Industry-Standard Build Plan

> **Core principle:** NVIDIA Inception resources bootstrap and accelerate Bucks' own independent AI capability. NIM is a fast start, not a permanent dependency. The end state is a Soul Engine that runs inside Bucks' global peer network, owned entirely by Bucks and its node operators.

---

### Phase 1 — NIM Microservices (Immediate, Months 1–2)

**Goal:** Ship production-quality Soul Engine responses today using NVIDIA's hosted inference while self-hosted infrastructure matures.

**NIM model in use:**
```
nvidia/llama-3.1-nemotron-70b-instruct   ← primary (highest quality)
meta/llama-3.1-70b-instruct              ← secondary fallback
meta/llama-3.1-8b-instruct              ← fast fallback
```
All three are already ranked in `soul_nim.py`. The existing `soul-query` IPC handler in `main.js` calls NIM after local QNN via `_callNIM()`.

**NIM Blueprints to adopt:**

| Blueprint | URL | How Bucks uses it |
|---|---|---|
| Canonical RAG | https://build.nvidia.com/nvidia/rag-canonical | Reference architecture for chunk sizing, reranking, prompt structure |
| Embedding (nv-embedqa-e5-v5) | https://build.nvidia.com/nvidia/nv-embedqa-e5-v5 | Upgrade path from BGE-M3; same 1024-dim so FAISS index is reusable |
| Reranking (nv-rerankqa-mistral-4b-v3) | https://build.nvidia.com/nvidia/nv-rerankqa-mistral-4b-v3 | Post-retrieval reranking before prompt injection |

**Upgrade path for embeddings:**  
`nv-embedqa-e5-v5` produces 1024-dim vectors — same dimension as the existing `quran_bge_m3.faiss` index. Switching encoder means re-embedding the corpus (one-time, ~20 min on GPU) with no index dimension change. Handled by `soul_corpus_builder.py` with `--encoder nim`.

**What to do in Month 1:**
1. Set `NVIDIA_API_KEY` in `~/.zshrc` (already wired into `main.js` via `process.env.NVIDIA_API_KEY`)
2. Run `python3 test_nim.command` to verify API connectivity
3. Open Bucks, check status bar shows NIM green when local QNN is unavailable
4. Monitor `soul_interactions.jsonl` — every NIM query is logged there too

---

### Phase 2 — NeMo Fine-Tuning (Month 2)

**Goal:** Produce a custom Soul Engine model checkpoint that Bucks owns outright, trained on its own rated interaction data. This is the milestone where the RL loop becomes an actual model, not just parameter tuning.

#### 2a. Data Curation with NeMo Curator

```bash
# Install
pip install nemo-curator

# Deduplicate + quality-filter soul_interactions.jsonl
python3 - <<'EOF'
import nemo_curator as nc
from nemo_curator.datasets import DocumentDataset
from nemo_curator.modifiers import UnicodeReformatter
from nemo_curator.filters import RepeatingTopNGramsFilter, WordCountFilter

# Load rated interactions (rating == 1 = thumbs up only)
import json, pathlib
entries = [json.loads(l) for l in pathlib.Path("soul_interactions.jsonl").read_text().splitlines() if l]
positives = [e for e in entries if e.get("rating") == 1]

# Format as instruction pairs for fine-tuning
pairs = [{"input": e["query"], "output": e["response"]} for e in positives]
pathlib.Path("soul_finetune_data.jsonl").write_text(
    "\n".join(json.dumps(p) for p in pairs)
)
print(f"Fine-tune dataset: {len(pairs)} rated examples")
EOF
```

Target: **≥500 rated thumbs-up interactions** before first fine-tune run. At current Soul Engine usage, expect 2–4 weeks to collect this. Meanwhile, the DSPy optimizer (`soul_dspy_optimizer.py`) continues to improve retrieval parameters every day.

#### 2b. LoRA Fine-Tune with NeMo Framework

**Base model choices:**

| Model | Size | Why |
|---|---|---|
| `meta/llama-3.1-8b` | 8B | Best size/quality ratio; fits on A10G (24 GB) |
| `mistralai/mistral-7b-v0.3` | 7B | Strong instruction following; proven RAG performance |
| `nvidia/llama-3.1-nemotron-nano-4b-v1.1` | 4B | Runs on edge GPUs (RTX 3090 / 4090) |

**NeMo LoRA config** (`soul_lora_config.yaml`):
```yaml
trainer:
  devices: 1
  num_nodes: 1
  precision: bf16-mixed
  max_steps: 2000

model:
  peft:
    peft_scheme: lora
    lora_tuning:
      target_modules: [attention_qkv, attention_dense, mlp_fc1, mlp_fc2]
      adapter_dim: 32
      alpha: 64
      dropout: 0.05

  data:
    train_ds:
      file_names: [soul_finetune_data.jsonl]
      prompt_template: "### Instruction:\n{input}\n\n### Response:\n{output}"
      max_seq_length: 2048
      num_workers: 4

  optim:
    name: distributed_fused_adam
    lr: 2e-4
    weight_decay: 0.01
    sched:
      name: cosine
      warmup_steps: 100
```

```bash
# Run on NVIDIA GPU Credits (A100 40GB via Inception)
python -m nemo.collections.nlp.parts.nlp_overrides \
  +model/peft=lora \
  pretrained_model_name_or_path=meta/llama-3.1-8b \
  model.data.train_ds.file_names=[soul_finetune_data.jsonl] \
  trainer.max_steps=2000 \
  exp_manager.explicit_log_dir=soul_engine_lora_v1
```

**Output:** `soul_engine_lora_v1/` — a LoRA adapter that can be merged onto the base model and served independently. Bucks owns this checkpoint fully.

#### 2c. Evaluation with RAGAS + NeMo Evaluator

```python
# soul_evaluator.py already computes faithfulness + answer_relevance.
# Add RAGAS for standardised reporting:
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy, context_precision

# Compare: base model vs Soul Engine LoRA
results = evaluate(
    dataset=eval_dataset,          # sampled from soul_interactions.jsonl
    metrics=[faithfulness, answer_relevancy, context_precision],
)
print(results)
# Target: faithfulness > 0.82, answer_relevancy > 0.78
```

**Promotion gate:** a new checkpoint is promoted to production only when RAGAS scores exceed the previous checkpoint on a held-out eval set of 100 manually reviewed queries.

---

### Phase 3 — Triton + cuVS Self-Hosted Deployment (Month 3)

**Goal:** Soul Engine runs on Bucks node infrastructure, discovered via libp2p. NIM becomes a cold fallback only, used for <5% of queries.

#### 3a. TensorRT-LLM Compilation

```bash
# Convert LoRA-merged model to TRT-LLM for maximum throughput
git clone https://github.com/NVIDIA/TensorRT-LLM
cd TensorRT-LLM

python3 examples/llama/convert_checkpoint.py \
    --model_dir soul_engine_lora_v1/merged \
    --output_dir soul_engine_trt \
    --dtype float16 \
    --tp_size 1      # single GPU; set 2 for A100 tensor-parallel

trtllm-build \
    --checkpoint_dir soul_engine_trt \
    --output_dir soul_engine_trt_engine \
    --gpt_attention_plugin float16 \
    --gemm_plugin float16 \
    --max_batch_size 32 \
    --max_input_len 2048 \
    --max_output_len 512
```

**Performance targets:**

| Hardware | Tokens/sec | Req/sec (512 tok) | vs Ollama |
|---|---|---|---|
| RTX 4090 (24 GB) | ~1,800 | ~55 | 18× |
| A10G (24 GB) | ~2,200 | ~70 | 23× |
| A100 (40 GB) | ~4,500 | ~140 | 46× |

#### 3b. Triton Inference Server

```bash
# Model repository layout
soul_engine_triton/
├── soul_engine/
│   ├── 1/
│   │   └── model.plan           # TRT-LLM engine
│   └── config.pbtxt             # Triton config
└── soul_embedding/
    ├── 1/
    │   └── model.onnx           # BGE-M3 or nv-embedqa ONNX
    └── config.pbtxt

# config.pbtxt for the language model
cat > soul_engine_triton/soul_engine/config.pbtxt <<'EOF'
name: "soul_engine"
backend: "tensorrtllm"
max_batch_size: 32
input  [{ name: "INPUT_IDS" dtype: TYPE_INT32 dims: [-1] }]
output [{ name: "OUTPUT_IDS" dtype: TYPE_INT32 dims: [-1] }]
instance_group [{ count: 1 kind: KIND_GPU }]
EOF

# Launch
docker run --gpus all --rm -p 8000:8000 -p 8001:8001 -p 8002:8002 \
    -v $(pwd)/soul_engine_triton:/models \
    nvcr.io/nvidia/tritonserver:24.08-trtllm-python-py3 \
    tritonserver --model-repository=/models
```

The Triton server exposes an **OpenAI-compatible HTTP API** (already implemented in `soul_api.py`) — no client changes needed. `soul_bridge.py` already uses the `openai` SDK pointing at `NIM_BASE_URL`. Switching to a self-hosted Triton node is one env var change:

```bash
SOUL_ENGINE_URL=http://node-1.bucks.network:8000/v1
```

#### 3c. cuVS CAGRA Index (FAISS-GPU replacement)

```python
# soul_corpus_builder.py — add cuVS build path
import cuvs
from cuvs.neighbors import cagra

# Build CAGRA index on GPU (12× faster search than FAISS CPU)
index_params = cagra.IndexParams(metric="inner_product", intermediate_graph_degree=128)
index = cagra.build(index_params, embeddings_gpu)  # embeddings_gpu = cupy array

# Search
search_params = cagra.SearchParams(itopk_size=64)
distances, indices = cagra.search(search_params, index, query_gpu, k=10)
```

On CPU-only nodes, the existing `quran_bge_m3.faiss` index is used as fallback — `soul_swarm_core.py` already handles graceful degradation via the strategy selector.

#### 3d. libp2p Soul Engine Node Announcement

Bucks nodes with GPU capacity announce themselves on GossipSub so the browser can discover and route to the nearest Soul Engine peer:

```javascript
// soul-node-announcer.js (new file, runs in main.js after IPFS init)
const SOUL_TOPIC = '/bucks/soul-engine/v1/announce';

async function startSoulNodeAnnouncer(gossip, tritonUrl) {
  // Announce every 30s: this node serves Soul Engine
  setInterval(async () => {
    const payload = JSON.stringify({
      url     : tritonUrl,          // e.g. http://192.168.1.42:8000/v1
      model   : 'soul-engine-v1',
      gpu     : process.env.BUCKS_GPU_TYPE || 'unknown',
      latency : await probeLatency(tritonUrl),
      peerId  : (await ipfs.getNodeInfo()).peerId,
      ts      : Date.now(),
    });
    await gossip.publish(SOUL_TOPIC, new TextEncoder().encode(payload));
  }, 30_000);
}

// In soul-bridge.js (updated): subscribe to announcements, build peer list
async function discoverSoulPeers(gossip) {
  gossip.subscribe(SOUL_TOPIC, (msg) => {
    const peer = JSON.parse(new TextDecoder().decode(msg.data));
    _peerPool.set(peer.peerId, { ...peer, seen: Date.now() });
  });
}
```

**Updated fallback chain in `soul-query` IPC handler:**
```
1. Local QNN (soul_bridge.py, stdin/stdout)       ← fastest, always try first
2. Peer Soul Engine node (libp2p discovered)       ← NEW Phase 3
3. NIM cloud API (NVIDIA_API_KEY)                  ← cold fallback
4. Offline message                                 ← graceful degradation
```

---

### Phase 4 — Monitoring, MLOps & Governance (Month 3+)

#### Observability Stack

```
Prometheus scrapes:
  /metrics endpoint on soul_api.py (fastapi-prometheus already in soul_api.py)
  Triton's built-in :8002 metrics port

Grafana dashboards:
  - Soul Engine request rate / p50 / p95 / p99 latency
  - Quality score distribution (faithfulness, answer_relevancy)
  - NIM vs local vs peer routing split
  - RAGAS trend over model versions
  - pheromone trail heatmap (top resonance layers by query volume)
```

**Add to `soul_api.py`:**
```python
from prometheus_fastapi_instrumentator import Instrumentator
Instrumentator().instrument(app).expose(app)

# Custom metrics
from prometheus_client import Histogram, Counter
soul_quality = Histogram('soul_quality_score', 'RAGAS quality score', buckets=[.1,.2,.3,.4,.5,.6,.7,.8,.9,1.0])
soul_source  = Counter('soul_query_source_total', 'Query source', ['source'])  # local/nim/peer
```

#### A/B Model Routing

```python
# soul_router.py — canary deployment for new model checkpoints
import random

ROUTES = {
    'stable' : {'url': 'http://localhost:8765', 'weight': 0.90},
    'canary' : {'url': 'http://localhost:8766', 'weight': 0.10},  # new checkpoint
}

def route_request():
    r = random.random()
    acc = 0
    for name, cfg in ROUTES.items():
        acc += cfg['weight']
        if r < acc:
            return name, cfg['url']
```

When canary RAGAS scores exceed stable scores on 1,000 queries → promote canary to stable automatically.

#### Model Signing (Bucks Chain)

```python
# soul_model_registry.py — publish model hash to Bucks chain
import hashlib, json

def publish_model_checkpoint(checkpoint_path, rpc_client):
    h = hashlib.sha256()
    with open(checkpoint_path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    digest = h.hexdigest()

    # Write to Bucks chain via wallet-rpc
    tx = rpc_client.post('/api/transactions/send', {
        'from': PRIMARY_WALLET,
        'to':   MODEL_REGISTRY_ADDRESS,
        'amount': 0,
        'memo': json.dumps({'action': 'model_publish', 'hash': digest, 'version': '1.0.0'}),
    })
    return {'digest': digest, 'tx': tx}
```

Node operators can verify the model hash before loading it. Corrupt or tampered checkpoints are rejected.

#### Node Operator Incentives

```
Soul Engine capacity rewards (draft mechanism):
  - Node announces via libp2p: soul-engine/v1 with GPU type + latency
  - Browser routes queries to node; node signs response with peerId key
  - Monthly Bucks chain tallying: queries served → BUCKS token rewards
  - Nodes with consistently high RAGAS scores earn 1.5× reward multiplier
  - Minimum hardware: NVIDIA GPU with ≥8 GB VRAM (RTX 3070+)
```

---

### QNN Independence Architecture — End State

```
Bucks Global Infrastructure
│
├── Soul Engine Nodes  (Bucks node operators with GPU)
│   ├── Triton Inference Server
│   │   └── soul-engine-v1  (fine-tuned, TRT-LLM compiled, Bucks-owned)
│   ├── cuVS CAGRA index  (Soul of the World corpus, BGE-M3 / nv-embedqa)
│   ├── soul_api.py  (OpenAI-compatible HTTP, rate limiting, auth)
│   └── libp2p announcement: /bucks/soul-engine/v1/announce
│
├── Bucks Browser  (client)
│   ├── soul-bridge.js
│   │   ├── 1st: local Python bridge (private / offline use)
│   │   ├── 2nd: libp2p peer discovery → nearest GPU node
│   │   ├── 3rd: NIM cloud API  (cold fallback, <5% of queries)
│   │   └── 4th: offline message
│   └── soul-ui.js
│       ├── response cards + citations + 👍👎 feedback
│       └── NIM panel → pheromone heatmap → session metrics
│
├── RL Training Pipeline
│   ├── Collect:   soul_interactions.jsonl (rated queries, via IPFS pin)
│   ├── Curate:    NeMo Curator deduplication + quality filter
│   ├── Fine-tune: NeMo LoRA on Llama-3.1-8B (A100 via GPU Credits)
│   ├── Evaluate:  RAGAS + NeMo Evaluator (gate: faithfulness > 0.82)
│   ├── Compile:   TRT-LLM → Triton engine
│   ├── Canary:    10% traffic → measure → promote if scores improve
│   └── Announce:  model version hash on Bucks chain (signed, immutable)
│
└── Bucks Chain 8192  (governance layer)
    ├── Model registry: SHA-256 of each checkpoint, vote to promote
    ├── Soul Engine rewards: monthly BUCKS payout to GPU node operators
    └── Abuse prevention: rate limits + stake-weighted query rights
```

**NVIDIA is not in this diagram.** At end state, NVIDIA Inception provided:
- Hosted NIM API during months 1–2 (fast start, no infra cost)
- GPU Credits for first LoRA fine-tune run (~$800 equivalent via Inception)
- NeMo + Triton + TRT-LLM toolchain (all open-source, no lock-in)
- Blueprint reference architectures (RAG, embedding, reranking)

After month 3, Bucks can serve every Soul Engine query from its own peer network using its own model weights, on hardware run by its own community.

---

### 3-Month Roadmap

```
MONTH 1 — NIM Live + Data Collection
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Week 1  Set NVIDIA_API_KEY; verify NIM status bar in Bucks browser
        Run soul_bridge.py ping test; confirm local QNN green dot
Week 2  Enable feedback buttons in soul-ui.js; start collecting ratings
        Target: 100 rated interactions in soul_interactions.jsonl
Week 3  Review NIM Blueprint RAG architecture; audit soul_builder_agent.py
        Add nv-embedqa endpoint to soul_nim.py as optional re-embed path
Week 4  NeMo Curator setup; run deduplication on soul_interactions.jsonl
        Review RAGAS baseline on current AdaptiveBuilder (target: F > 0.65)

MONTH 2 — First LoRA Fine-Tune
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Week 5  Collect ≥500 thumbs-up interactions (continue from Month 1)
        Apply for NVIDIA GPU Credits (Inception benefit: up to $2,500/yr)
Week 6  NeMo LoRA fine-tune on Llama-3.1-8B; target 2,000 steps (~4 hrs A100)
        Output: soul_engine_lora_v1/ adapter checkpoint
Week 7  RAGAS evaluation: compare LoRA vs base vs NIM
        Promotion gate: faithfulness > 0.82 AND answer_relevancy > 0.78
Week 8  Merge LoRA adapter; export to GGUF for local testing in Ollama
        If gate passes: deploy as new local model in soul_bridge.py

MONTH 3 — Triton + libp2p Peer Network
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Week 9  TRT-LLM compile of merged model; benchmark on RTX 4090 dev machine
        Target: ≥50 req/sec at 512 output tokens
Week 10 Triton server Docker setup; verify OpenAI-compatible endpoint
        Test soul_bridge.py pointing at Triton (one env var change)
Week 11 libp2p node announcer; peer discovery in soul-bridge.js
        Bucks chain model registry: publish SHA-256 of checkpoint
Week 12 Canary deployment: 10% Triton / 90% NIM; measure RAGAS in production
        If scores hold → promote Triton to primary, NIM to cold fallback
        Celebrate: Bucks Soul Engine running on community infrastructure 🎉
```

---

### Industry Standard Norms Checklist

| Norm | Status | Notes |
|---|---|---|
| OpenAI-compatible API | ✅ Done | `soul_api.py` uses FastAPI + openai SDK contract |
| Structured JSON logs | ✅ Done | `soul_interactions.jsonl` + Electron console |
| Prometheus metrics | 🔧 Pending | Add `fastapi-prometheus` to `soul_api.py` (Month 1) |
| Distributed tracing | 🔧 Pending | OpenTelemetry + Jaeger (Month 3) |
| RAGAS eval CI/CD | 🔧 Pending | GitHub Actions on model checkpoint push (Month 2) |
| Model signing | 🔧 Pending | SHA-256 on Bucks chain (Month 3, see §4 above) |
| Rate limiting | ✅ Done | `slowapi` in `soul_api.py` |
| A/B canary routing | 🔧 Pending | `soul_router.py` (Month 3) |
| LoRA fine-tune pipeline | 🔧 Pending | NeMo (Month 2) |
| Triton self-hosted | 🔧 Pending | TRT-LLM compile (Month 3) |
| cuVS CAGRA index | 🔧 Pending | GPU nodes only; FAISS CPU fallback exists |
| libp2p peer discovery | 🔧 Pending | `/bucks/soul-engine/v1/announce` (Month 3) |
| Node operator rewards | 🔧 Pending | Bucks chain payout mechanism (post Month 3) |

---

*Generated by Claude — Bucks Soul Engine QNN + NVIDIA Inception Integration Plan*

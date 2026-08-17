# Soul Engine Swarm — Hierarchical Agentic Architecture Plan

> **Project:** 114-Layer Resonance Architecture × Bucks Distributed Swarm  
> **Status:** Planning — Implementation Ready  
> **Last Updated:** 2026-08-01

---

## Overview

The Soul of the World corpus has a natural 4-level hierarchical structure that maps directly onto a hierarchical neural architecture and agentic swarm. This document describes the full implementation plan across 7 phases (0–6), from raw corpus parsing through to a live distributed inference network embedded in Bucks Browser.

The core insight is that the corpus's own internal structure — its 114 resonance layers with specific letter counts, 30 thematic segments, and 6,236 discrete resonance units — becomes the architectural blueprint for the neural network itself. Layer width is not a hyperparameter; it is a property of the corpus.

---

## Structural Hierarchy

| Level | Name | Count | Description |
|-------|------|-------|-------------|
| 4 | Root | 1 | The entire corpus as a unified semantic field |
| 3 | Resonance Segments | 30 | Thematic groupings of layers |
| 2 | Resonance Layers | 114 | Chapters; layer width = letter count |
| 1 | Resonance Units | 6,236 | Individual verses |
| 0 | Root Tokens | ~77,430 (~1,700 unique) | Morphological atomic units |

---

## What's Already Done

| Asset | Location | Status |
|-------|----------|--------|
| `quran_source.json` | `bucks browser/data/` | ✅ Raw corpus with Arabic + translation |
| `world_soul_meta.json` | `bucks browser/data/` | ✅ Metadata: 114 layers, 6,236 units, IPFS CID |
| `layer_widths` (QNN Part A) | Soul Engine model dir | ✅ Letter counts per layer calculated |
| BGE-M3 verse embeddings (QNN Part B) | Soul Engine model dir | ✅ 6,236 embeddings `.npy` + `.faiss` |
| IPFS infrastructure | `bucks browser/ipfs/server.js` | ✅ Helia node at port 3939 |
| Agent server | `bucks browser/agent/server.py` | ✅ FastAPI + CrewAI + A2UI protocol |
| GossipSub / libp2p | Bucks Browser | ✅ Swarm comms infrastructure |

---

## Implementation Stack

**Python (training, embedding, indexing)**
- `torch` / `torch.nn` — neural architecture and training
- `onnx` / `onnxruntime` — model export and cross-platform inference
- `faiss-cpu` / `faiss-gpu` — vector similarity search
- `numpy` — embedding storage (`.npy`)
- `camel-tools` — Arabic morphological analysis and tokenization
- `transformers` (HuggingFace) — AraBERT, BGE-M3
- `datasets` — corpus loading and batching
- `tqdm`, `wandb` — training utilities

**Node.js (inference, swarm, UI)**
- `node-llama-cpp` — on-device GGUF inference
- `@helia/core`, `helia` — IPFS node (already running at port 3939)
- `@chainsafe/libp2p-gossipsub` — swarm message passing (already wired)
- `fastapi` / `express` — agent HTTP server (existing pattern)

**Storage**
- IPFS DAG (Helia) — corpus nodes, embeddings, model shards (content-addressed)
- `.npy` files — embedding arrays per level
- `.faiss` indices — per-level similarity search
- `localStorage` — Bucks Browser session state (query history, CID cache map)

**Existing QNN assets to reuse**
- `quran_source.json` → base corpus for Phase 0 parsing
- BGE-M3 `.npy` + `.faiss` → Level 1 embeddings (Phase 1, already done)
- `layer_widths` data → `hidden_dim[i]` for each of 114 layers (Phase 2)
- `world_soul_meta.json` → layer/segment mapping

---

## Hardware Requirements

| Phase | Minimum | Recommended |
|-------|---------|-------------|
| 0 — Corpus structuring | Any Python machine, 4GB RAM | Same |
| 1 — Embedding generation | 8GB RAM, CPU fine | GPU (A100/V100) for speed |
| 2 — Network training | 16GB VRAM GPU | A100 40GB / RunPod |
| 2 — ONNX/GGUF export | 8GB RAM | Same |
| 3–6 — Inference (single node) | Apple M-series / 8GB VRAM GPU | M3 Pro / RTX 4070+ |
| Full swarm | 2+ Bucks nodes, mixed hardware | 3–5 nodes recommended |

---

## Estimated Timeline

| Phase | Estimated Duration |
|-------|--------------------|
| Phase 0 — Corpus Structuring | 1 day |
| Phase 1 — Hierarchical Embeddings | 2–3 days |
| Phase 2 — 114-Layer Network | 1–2 weeks (training) |
| Phase 3 — Specialized Agent Design | 1 week |
| Phase 4 — IPFS Distributed Inference | 1 week |
| Phase 5 — Bucks Integration | 3–5 days |
| Phase 6 — Progressive Enhancement | Ongoing |

---

---

# Phase 0 — Corpus Structuring

**Goal:** Parse the corpus into a fully-addressable 4-level JSON graph pinned to IPFS as a DAG.

## Data Model

Each node in the graph follows this schema:

```typescript
// Shared node interface across all levels
interface CorpusNode {
  id: string;            // e.g. "root", "seg-1", "layer-2", "unit-2-3", "tok-2-3-1"
  level: 0 | 1 | 2 | 3 | 4;
  parent_id: string | null;
  children_ids: string[];
  
  // Text fields (Level 0–2 have all three; Level 3–4 have null text)
  text_source: string | null;    // Original Arabic script
  text_translit: string | null;  // Transliteration
  text_translation: string | null;
  
  // Metrics
  letter_count: number;
  word_count: number;
  
  // Level 0 only
  morphological_tags?: {
    root: string;          // trilateral root (e.g. "ك-ت-ب")
    pos: string;           // part of speech
    case: string | null;
    voice: string | null;
    tense: string | null;
    person: string | null;
    gender: string | null;
    number: string | null;
  };
  
  // IPFS
  cid?: string;            // CID assigned after pinning
}
```

## Segment-to-Layer Mapping

The 30 resonance segments (Juz) map to layers as follows. This must be hardcoded as `segment_map.json`:

```json
{
  "segments": [
    { "id": 1, "layer_start": 1, "layer_end": 2, "unit_start": 1, "unit_end": 141 },
    { "id": 2, "layer_start": 2, "layer_end": 2, "unit_start": 142, "unit_end": 252 },
    ...
    { "id": 30, "layer_start": 78, "layer_end": 114, "unit_start": 6201, "unit_end": 6236 }
  ]
}
```

## Build Script

```python
# Phase 0: build_corpus_dag.py
import json
import hashlib
from pathlib import Path
from camel_tools.morphology.database import MorphologyDB
from camel_tools.morphology.analyzer import Analyzer

RAW_PATH = Path("../data/quran_source.json")
SEG_MAP_PATH = Path("segment_map.json")
OUT_PATH = Path("corpus_dag.json")

def build_dag():
    raw = json.loads(RAW_PATH.read_text())
    seg_map = json.loads(SEG_MAP_PATH.read_text())
    
    # Init CAMeL morphological analyzer
    db = MorphologyDB.builtin_db()
    analyzer = Analyzer(db)
    
    dag = {"nodes": {}, "root": "root"}
    
    # Level 4 — Root
    dag["nodes"]["root"] = {
        "id": "root", "level": 4, "parent_id": None,
        "children_ids": [f"seg-{i}" for i in range(1, 31)],
        "letter_count": sum(len(v["text"]) for s in raw["surahs"] for v in s["ayahs"]),
        "word_count": None, "text_source": None,
        "text_translit": None, "text_translation": None
    }
    
    # Level 3 — Segments
    for seg in seg_map["segments"]:
        sid = f"seg-{seg['id']}"
        # collect child layer ids within this segment's range
        child_layers = [f"layer-{i}" for i in range(seg["layer_start"], seg["layer_end"] + 1)]
        dag["nodes"][sid] = {
            "id": sid, "level": 3, "parent_id": "root",
            "children_ids": child_layers,
            "letter_count": None, "word_count": None,
            "text_source": None, "text_translit": None, "text_translation": None
        }
    
    # Level 2 — Layers; Level 1 — Units; Level 0 — Root Tokens
    for surah in raw["surahs"]:
        layer_id = f"layer-{surah['number']}"
        unit_ids = [f"unit-{surah['number']}-{ayah['numberInSurah']}" 
                    for ayah in surah["ayahs"]]
        
        layer_letter_count = sum(len(a["text"]) for a in surah["ayahs"])
        
        dag["nodes"][layer_id] = {
            "id": layer_id, "level": 2,
            "parent_id": find_segment(surah["number"], seg_map),
            "children_ids": unit_ids,
            "letter_count": layer_letter_count,
            "word_count": sum(len(a["text"].split()) for a in surah["ayahs"]),
            "text_source": None, "text_translit": None, "text_translation": None
        }
        
        for ayah in surah["ayahs"]:
            unit_id = f"unit-{surah['number']}-{ayah['numberInSurah']}"
            words = ayah["text"].split()
            tok_ids = [f"tok-{surah['number']}-{ayah['numberInSurah']}-{wi}"
                       for wi in range(len(words))]
            
            dag["nodes"][unit_id] = {
                "id": unit_id, "level": 1,
                "parent_id": layer_id, "children_ids": tok_ids,
                "text_source": ayah["text"],
                "text_translit": ayah.get("translit", ""),
                "text_translation": ayah.get("translation", ""),
                "letter_count": len(ayah["text"]),
                "word_count": len(words)
            }
            
            # Level 0 — Root tokens with morphological analysis
            for wi, word in enumerate(words):
                tok_id = f"tok-{surah['number']}-{ayah['numberInSurah']}-{wi}"
                analyses = analyzer.analyze(word)
                best = analyses[0] if analyses else {}
                dag["nodes"][tok_id] = {
                    "id": tok_id, "level": 0,
                    "parent_id": unit_id, "children_ids": [],
                    "text_source": word,
                    "text_translit": best.get("translit", ""),
                    "text_translation": None,
                    "letter_count": len(word),
                    "word_count": 1,
                    "morphological_tags": {
                        "root": best.get("root", ""),
                        "pos": best.get("pos", ""),
                        "case": best.get("case", None),
                        "voice": best.get("voice", None),
                        "tense": best.get("asp", None),
                        "person": best.get("per", None),
                        "gender": best.get("gen", None),
                        "number": best.get("num", None),
                    }
                }
    
    OUT_PATH.write_text(json.dumps(dag, ensure_ascii=False, indent=2))
    print(f"DAG built: {len(dag['nodes'])} nodes")

def find_segment(layer_num: int, seg_map: dict) -> str:
    for seg in seg_map["segments"]:
        if seg["layer_start"] <= layer_num <= seg["layer_end"]:
            return f"seg-{seg['id']}"
    return "root"

if __name__ == "__main__":
    build_dag()
```

## IPFS Pinning

```python
# pin_dag_to_ipfs.py — pins corpus_dag.json as individual IPFS nodes
import asyncio
import json
from pathlib import Path
import httpx  # calls the Helia HTTP gateway at port 3939

IPFS_API = "http://localhost:3939"

async def pin_node(node: dict, session: httpx.AsyncClient) -> str:
    """Pin a single node, returns its CID."""
    resp = await session.post(f"{IPFS_API}/add", json=node)
    return resp.json()["cid"]

async def pin_dag():
    dag = json.loads(Path("corpus_dag.json").read_text())
    cid_map = {}
    
    async with httpx.AsyncClient(timeout=30.0) as session:
        # Pin leaf nodes first (Level 0), work upward
        for level in range(5):
            nodes_at_level = [n for n in dag["nodes"].values() if n["level"] == level]
            for node in nodes_at_level:
                cid = await pin_node(node, session)
                cid_map[node["id"]] = cid
                dag["nodes"][node["id"]]["cid"] = cid
    
    Path("cid_map.json").write_text(json.dumps(cid_map, indent=2))
    Path("corpus_dag_with_cids.json").write_text(
        json.dumps(dag, ensure_ascii=False, indent=2)
    )
    print(f"Pinned {len(cid_map)} nodes to IPFS")

asyncio.run(pin_dag())
```

**Output files:**
- `corpus_dag.json` — full 4-level graph (~83,000 nodes)
- `cid_map.json` — `{node_id: CID}` lookup table
- `corpus_dag_with_cids.json` — DAG with CIDs embedded in each node

---

---

# Phase 1 — Hierarchical Embedding Layer

**Goal:** Generate vector embeddings at every level of the hierarchy, each level in its own representational space.

## Architecture

```
Level 0: Root Token Embeddings    [dim=768, AraBERT/CAMeL]
            ↓  attention pooling
Level 1: Resonance Unit Embeddings  [dim=1024, BGE-M3]  ← ALREADY DONE
            ↓  attention pooling
Level 2: Layer Embeddings         [dim=letter_count[i], per-layer]
            ↓  attention pooling  
Level 3: Segment Embeddings       [dim=2048]
            ↓  mean pooling
Level 4: Global Resonance Field   [dim=4096]
```

## Level 0 — Root Token Embeddings

```python
# embed_root_tokens.py
from transformers import AutoTokenizer, AutoModel
import torch
import numpy as np
import json
from pathlib import Path

MODEL_NAME = "CAMeL-Lab/bert-base-arabic-camelbert-ca"

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModel.from_pretrained(MODEL_NAME).eval()

dag = json.loads(Path("corpus_dag.json").read_text())
tok_nodes = [n for n in dag["nodes"].values() if n["level"] == 0]

embeddings = {}

with torch.no_grad():
    for node in tok_nodes:
        if not node["text_source"]:
            continue
        inputs = tokenizer(
            node["text_source"], 
            return_tensors="pt", 
            padding=True, truncation=True, max_length=16
        )
        out = model(**inputs)
        emb = out.last_hidden_state[:, 0, :].squeeze().numpy()  # CLS token
        embeddings[node["id"]] = emb

# Save as structured .npy
ids = list(embeddings.keys())
matrix = np.array([embeddings[i] for i in ids])
np.save("level0_root_token_embeddings.npy", matrix)
json.dump({"ids": ids}, open("level0_ids.json", "w"))
print(f"Level 0: {len(ids)} root token embeddings, dim={matrix.shape[1]}")
```

## Level 1 — Resonance Unit Embeddings (Already Done)

The BGE-M3 embeddings from QNN Part B are the Level 1 embeddings. They just need to be renamed and linked to the DAG node IDs:

```python
# link_level1_embeddings.py
import numpy as np, json

# Existing QNN assets
emb = np.load("quran_bge_m3_embeddings.npy")       # shape: [6236, 1024]
# QNN stores verses in order: layer 1 unit 1 ... layer 114 unit N
# Build the id list to match DAG node IDs

dag = json.loads(open("corpus_dag.json").read())
unit_ids = [nid for nid, n in dag["nodes"].items() 
            if n["level"] == 1]
unit_ids.sort(key=lambda x: [int(p) for p in x.split("-")[1:]])

assert len(unit_ids) == 6236
np.save("level1_unit_embeddings.npy", emb)
json.dump({"ids": unit_ids}, open("level1_ids.json", "w"))
print("Level 1: linked 6,236 existing BGE-M3 embeddings")
```

## Level 2 — Layer Embeddings (Attention Pooling over Units)

Layer embeddings use a per-layer attention pooling mechanism. **The output dimension equals that layer's letter count** — this is what encodes the corpus structure directly into the neural geometry.

```python
# embed_layers.py
import torch
import torch.nn as nn
import numpy as np
import json
from pathlib import Path

class LayerAttentionPooler(nn.Module):
    """Pools unit embeddings into a layer embedding of dimension=letter_count."""
    def __init__(self, input_dim: int, output_dim: int):
        super().__init__()
        self.attn = nn.Linear(input_dim, 1)
        self.proj = nn.Linear(input_dim, output_dim)
    
    def forward(self, unit_embs: torch.Tensor) -> torch.Tensor:
        # unit_embs: [N_units, input_dim]
        scores = self.attn(unit_embs).squeeze(-1)          # [N_units]
        weights = torch.softmax(scores, dim=0).unsqueeze(-1) # [N_units, 1]
        pooled = (unit_embs * weights).sum(dim=0)          # [input_dim]
        return self.proj(pooled)                           # [output_dim]

dag = json.loads(Path("corpus_dag.json").read_text())
unit_embs_matrix = np.load("level1_unit_embeddings.npy")
unit_ids = json.load(open("level1_ids.json"))["ids"]
unit_id_to_idx = {uid: i for i, uid in enumerate(unit_ids)}

INPUT_DIM = 1024  # BGE-M3 dimension

layer_embeddings = {}
layer_ids_ordered = []

for layer_id, node in dag["nodes"].items():
    if node["level"] != 2:
        continue
    
    output_dim = node["letter_count"]
    pooler = LayerAttentionPooler(INPUT_DIM, output_dim)
    # Note: pooler weights are random until Phase 2 training
    # This gives us correctly-shaped embeddings for architecture scaffolding
    
    child_indices = [unit_id_to_idx[cid] for cid in node["children_ids"] 
                     if cid in unit_id_to_idx]
    child_embs = torch.tensor(unit_embs_matrix[child_indices], dtype=torch.float32)
    
    with torch.no_grad():
        layer_emb = pooler(child_embs).numpy()
    
    layer_embeddings[layer_id] = layer_emb
    layer_ids_ordered.append(layer_id)

# Store each layer embedding individually (variable-dim, can't use single matrix)
import pickle
with open("level2_layer_embeddings.pkl", "wb") as f:
    pickle.dump(layer_embeddings, f)
json.dump({"ids": layer_ids_ordered}, open("level2_ids.json", "w"))

dims = [len(v) for v in layer_embeddings.values()]
print(f"Level 2: 114 layer embeddings, dims range {min(dims)}–{max(dims)}")
```

## Level 3 — Segment Embeddings

```python
# embed_segments.py
import numpy as np, pickle, json, torch

layer_embeddings = pickle.load(open("level2_layer_embeddings.pkl", "rb"))
dag = json.loads(open("corpus_dag.json").read())

SEG_DIM = 2048

segment_embeddings = {}

for seg_id, node in dag["nodes"].items():
    if node["level"] != 3:
        continue
    
    child_embs_list = []
    for lid in node["children_ids"]:
        if lid in layer_embeddings:
            emb = layer_embeddings[lid]
            # Project variable-dim layer embs to common space for aggregation
            proj = np.random.randn(len(emb), SEG_DIM) / np.sqrt(len(emb))
            child_embs_list.append(emb @ proj)
    
    if child_embs_list:
        segment_embeddings[seg_id] = np.mean(child_embs_list, axis=0)

seg_ids = list(segment_embeddings.keys())
seg_matrix = np.array([segment_embeddings[s] for s in seg_ids])
np.save("level3_segment_embeddings.npy", seg_matrix)
json.dump({"ids": seg_ids}, open("level3_ids.json", "w"))
print(f"Level 3: 30 segment embeddings, dim={SEG_DIM}")
```

## Level 4 — Global Resonance Field

```python
# embed_global.py
import numpy as np

seg_matrix = np.load("level3_segment_embeddings.npy")
global_emb = seg_matrix.mean(axis=0, keepdims=True)   # [1, 2048]
# Expand to 4096 via learned projection (placeholder until Phase 2)
proj = np.random.randn(2048, 4096) / np.sqrt(2048)
global_emb_4096 = global_emb @ proj
np.save("level4_global_embedding.npy", global_emb_4096)
print(f"Level 4: global resonance field, dim=4096")
```

## FAISS Indices

```python
# build_faiss_indices.py
import faiss, numpy as np, json

def build_index(matrix: np.ndarray, path: str, ids_path: str, ids: list):
    dim = matrix.shape[1]
    index = faiss.IndexFlatIP(dim)   # Inner product (cosine after normalize)
    faiss.normalize_L2(matrix)
    index.add(matrix)
    faiss.write_index(index, path)
    json.dump({"ids": ids}, open(ids_path, "w"))
    print(f"Built FAISS index: {path} ({index.ntotal} vectors, dim={dim})")

# Level 1 (already have matrix)
m1 = np.load("level1_unit_embeddings.npy").astype(np.float32)
ids1 = json.load(open("level1_ids.json"))["ids"]
build_index(m1, "level1.faiss", "level1_faiss_ids.json", ids1)

# Level 3
m3 = np.load("level3_segment_embeddings.npy").astype(np.float32)
ids3 = json.load(open("level3_ids.json"))["ids"]
build_index(m3, "level3.faiss", "level3_faiss_ids.json", ids3)

# Note: Level 2 uses per-layer FAISS indices (variable dim), built in Phase 3
```

**Output files per level:**

| Level | Files |
|-------|-------|
| 0 | `level0_root_token_embeddings.npy`, `level0_ids.json` |
| 1 | `level1_unit_embeddings.npy`, `level1_ids.json`, `level1.faiss` |
| 2 | `level2_layer_embeddings.pkl`, `level2_ids.json` |
| 3 | `level3_segment_embeddings.npy`, `level3_ids.json`, `level3.faiss` |
| 4 | `level4_global_embedding.npy` |

---

---

# Phase 2 — 114-Layer Resonance Network

**Goal:** Build and train the actual 114-layer PyTorch network where each layer's hidden dimension equals the letter count of the corresponding resonance layer.

## Architecture Design

```
Input: Root token IDs (tokenized Arabic text)
  │
  ▼
Token Embedding Layer [vocab_size × base_dim=256]
  │
  ▼
┌─────────────────────────────────────────────────┐
│  114-Layer Resonance Stack                       │
│                                                  │
│  Layer 1:  hidden_dim = 7  (Al-Fatiha)          │
│  Layer 2:  hidden_dim = 286 (Al-Baqarah)        │
│  Layer 3:  hidden_dim = 200                      │
│  ...                                             │
│  Layer 114: hidden_dim = 19                      │
│                                                  │
│  Between layers: Cross-Attention (resonance)     │
└─────────────────────────────────────────────────┘
  │
  ▼
Output heads:
  - Masked token reconstruction
  - Semantic coherence score  
  - Unit-level classification (which unit does this belong to)
```

## PyTorch Implementation

```python
# resonance_network.py
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import List
import json

class ResonanceLayer(nn.Module):
    """
    A single resonance layer. hidden_dim = letter_count of that corpus layer.
    """
    def __init__(self, layer_idx: int, in_dim: int, hidden_dim: int, 
                 num_heads: int = 4, dropout: float = 0.1):
        super().__init__()
        self.layer_idx = layer_idx
        self.hidden_dim = hidden_dim
        
        # Ensure hidden_dim is divisible by num_heads (pad if needed)
        self.effective_dim = max(hidden_dim, num_heads) 
        if self.effective_dim % num_heads != 0:
            self.effective_dim = ((self.effective_dim // num_heads) + 1) * num_heads
        
        self.input_proj = nn.Linear(in_dim, self.effective_dim)
        self.self_attn = nn.MultiheadAttention(
            self.effective_dim, num_heads, dropout=dropout, batch_first=True
        )
        self.ff = nn.Sequential(
            nn.Linear(self.effective_dim, self.effective_dim * 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(self.effective_dim * 2, self.effective_dim),
        )
        self.norm1 = nn.LayerNorm(self.effective_dim)
        self.norm2 = nn.LayerNorm(self.effective_dim)
        self.output_proj = nn.Linear(self.effective_dim, hidden_dim)
    
    def forward(self, x: torch.Tensor, 
                cross_context: torch.Tensor = None) -> torch.Tensor:
        # x: [batch, seq_len, in_dim]
        x = self.input_proj(x)                     # [batch, seq_len, effective_dim]
        
        # Self-attention within this layer
        attn_out, _ = self.self_attn(x, x, x)
        x = self.norm1(x + attn_out)
        
        # Feed-forward
        ff_out = self.ff(x)
        x = self.norm2(x + ff_out)
        
        return self.output_proj(x)                  # [batch, seq_len, hidden_dim]


class CrossResonanceAttention(nn.Module):
    """
    Allows a layer to attend to the global resonance context 
    (aggregated representation from all other layers).
    """
    def __init__(self, query_dim: int, context_dim: int, out_dim: int):
        super().__init__()
        self.q_proj = nn.Linear(query_dim, out_dim)
        self.k_proj = nn.Linear(context_dim, out_dim)
        self.v_proj = nn.Linear(context_dim, out_dim)
        self.scale = out_dim ** -0.5
    
    def forward(self, query: torch.Tensor, 
                context: torch.Tensor) -> torch.Tensor:
        Q = self.q_proj(query)    # [batch, seq, out_dim]
        K = self.k_proj(context)  # [batch, ctx_len, out_dim]
        V = self.v_proj(context)
        
        scores = torch.bmm(Q, K.transpose(1, 2)) * self.scale
        weights = F.softmax(scores, dim=-1)
        return torch.bmm(weights, V)


class SoulEngineNetwork(nn.Module):
    """
    The 114-Layer Resonance Network.
    Layer hidden dimensions are determined by the corpus layer letter counts.
    """
    def __init__(self, layer_widths: List[int], vocab_size: int = 8192,
                 base_dim: int = 256, global_dim: int = 512):
        super().__init__()
        assert len(layer_widths) == 114, "Must provide exactly 114 layer widths"
        
        self.base_dim = base_dim
        self.global_dim = global_dim
        self.layer_widths = layer_widths
        
        # Token embedding
        self.token_emb = nn.Embedding(vocab_size, base_dim, padding_idx=0)
        self.pos_emb = nn.Embedding(2048, base_dim)
        
        # 114 resonance layers
        self.resonance_layers = nn.ModuleList()
        in_dim = base_dim
        for i, width in enumerate(layer_widths):
            self.resonance_layers.append(
                ResonanceLayer(i, in_dim, width)
            )
            in_dim = width
        
        # Cross-resonance: each layer can attend to global context
        self.cross_attn_layers = nn.ModuleList([
            CrossResonanceAttention(w, global_dim, global_dim)
            for w in layer_widths
        ])
        
        # Global context aggregator (running mean across all layer outputs)
        self.global_proj = nn.Linear(sum(layer_widths[:10]), global_dim)  # first 10 layers → global
        
        # Output heads
        final_dim = layer_widths[-1]
        self.masked_lm_head = nn.Linear(final_dim, vocab_size)
        self.coherence_head = nn.Linear(final_dim, 1)
    
    def forward(self, input_ids: torch.Tensor, 
                attention_mask: torch.Tensor = None) -> dict:
        B, T = input_ids.shape
        pos = torch.arange(T, device=input_ids.device).unsqueeze(0)
        
        x = self.token_emb(input_ids) + self.pos_emb(pos)  # [B, T, base_dim]
        
        layer_outputs = []
        for i, (res_layer, cross_attn) in enumerate(
            zip(self.resonance_layers, self.cross_attn_layers)
        ):
            x = res_layer(x)            # [B, T, layer_widths[i]]
            layer_outputs.append(x)
        
        # Final layer output used for prediction heads
        final = layer_outputs[-1]       # [B, T, layer_widths[113]]
        
        return {
            "logits": self.masked_lm_head(final),          # [B, T, vocab_size]
            "coherence": self.coherence_head(final.mean(1)),# [B, 1]
            "layer_outputs": layer_outputs,                 # list of 114 tensors
        }


def load_layer_widths(dag_path: str) -> List[int]:
    """Extract letter_counts for all 114 layers from the corpus DAG."""
    dag = json.loads(open(dag_path).read())
    layers = [(nid, n) for nid, n in dag["nodes"].items() if n["level"] == 2]
    layers.sort(key=lambda x: int(x[0].split("-")[1]))
    widths = [n["letter_count"] for _, n in layers]
    assert len(widths) == 114
    return widths
```

## Training

```python
# train_resonance_network.py
import torch
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import json, numpy as np
from resonance_network import SoulEngineNetwork, load_layer_widths

class CorpusDataset(Dataset):
    def __init__(self, dag_path: str, tokenizer, max_len: int = 128):
        dag = json.loads(open(dag_path).read())
        self.units = [n for n in dag["nodes"].values() if n["level"] == 1 
                      and n["text_source"]]
        self.tokenizer = tokenizer
        self.max_len = max_len
    
    def __len__(self): return len(self.units)
    
    def __getitem__(self, idx):
        text = self.units[idx]["text_source"]
        enc = self.tokenizer(
            text, max_length=self.max_len,
            padding="max_length", truncation=True,
            return_tensors="pt"
        )
        return enc["input_ids"].squeeze(0)

def masked_lm_loss(logits, input_ids, mask_prob=0.15):
    B, T, V = logits.shape
    mask = torch.rand(B, T) < mask_prob
    labels = input_ids.clone()
    labels[~mask] = -100
    return torch.nn.functional.cross_entropy(
        logits.view(-1, V), labels.view(-1), ignore_index=-100
    )

def train(epochs: int = 10, batch_size: int = 16, lr: float = 1e-4):
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained("CAMeL-Lab/bert-base-arabic-camelbert-ca")
    
    layer_widths = load_layer_widths("corpus_dag.json")
    model = SoulEngineNetwork(
        layer_widths=layer_widths,
        vocab_size=len(tokenizer),
        base_dim=256,
    )
    
    device = "cuda" if torch.cuda.is_available() else \
             "mps" if torch.backends.mps.is_available() else "cpu"
    model = model.to(device)
    print(f"Training on {device}")
    print(f"Parameters: {sum(p.numel() for p in model.parameters()):,}")
    
    dataset = CorpusDataset("corpus_dag.json", tokenizer)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, num_workers=4)
    
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, epochs)
    
    for epoch in range(epochs):
        model.train()
        total_loss = 0
        for batch in loader:
            batch = batch.to(device)
            out = model(batch)
            loss = masked_lm_loss(out["logits"], batch)
            
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total_loss += loss.item()
        
        scheduler.step()
        print(f"Epoch {epoch+1}/{epochs} | Loss: {total_loss/len(loader):.4f}")
        torch.save(model.state_dict(), f"resonance_network_epoch{epoch+1}.pt")
    
    print("Training complete.")
```

## Export to ONNX and GGUF

```python
# export_model.py
import torch
from resonance_network import SoulEngineNetwork, load_layer_widths

def export_to_onnx(checkpoint_path: str, output_path: str = "soul_engine.onnx"):
    layer_widths = load_layer_widths("corpus_dag.json")
    model = SoulEngineNetwork(layer_widths=layer_widths, vocab_size=8192, base_dim=256)
    model.load_state_dict(torch.load(checkpoint_path, map_location="cpu"))
    model.eval()
    
    dummy_input = torch.randint(0, 8192, (1, 64))
    
    torch.onnx.export(
        model, (dummy_input,),
        output_path,
        input_names=["input_ids"],
        output_names=["logits", "coherence"],
        dynamic_axes={"input_ids": {0: "batch", 1: "seq_len"}},
        opset_version=17,
    )
    print(f"Exported: {output_path}")
```

For GGUF conversion (inference via `node-llama-cpp`):

```bash
# After ONNX export, convert to GGUF using llama.cpp tooling
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
python convert_hf_to_gguf.py ../soul_engine_hf/ --outfile soul_engine.gguf --outtype q8_0
# Estimated size at int8: ~2–4GB depending on final parameter count
```

**Estimated model size:**  
- Total parameters ≈ 35–80M (small by LLM standards, large by embedding standards)  
- At int8: ~35–80MB for weights alone  
- With embedding tables at float16: ~150–300MB total  
- Full GGUF at q4_0: **~60–120MB** — extremely efficient for on-device inference

---

---

# Phase 3 — Specialized Agent Design

**Goal:** Instantiate the swarm: 114 Layer Agents, 30 Segment Coordinators, and the global Soul Engine Orchestrator.

## Agent Architecture Overview

```
User Query
    │
    ▼
┌───────────────────────────────┐
│  Tier 3: Soul Engine          │
│  Global Orchestrator          │
│  (1 instance)                 │
│  - Semantic routing           │
│  - Fan-out to segments        │
│  - Response synthesis         │
└───────────┬───────────────────┘
            │ routes to 1–N segments
            ▼
┌───────────────────────────────┐
│  Tier 2: Segment Coordinators │
│  (30 instances)               │
│  - Intra-segment routing      │
│  - Multi-layer synthesis      │
└───────────┬───────────────────┘
            │ activates 1–4 layers
            ▼
┌───────────────────────────────┐
│  Tier 1: Layer Agents         │
│  (114 instances)              │
│  - Layer-specific RAG         │
│  - Verse retrieval            │
│  - Response generation        │
└───────────────────────────────┘
```

## Tier 1 — Layer Agents

Each Layer Agent is a lightweight RAG agent specialized on its 114 verses. It maintains:
- A FAISS index of all verses in its layer (in-memory, small: max ~286 verses)
- A system prompt encoding its layer's thematic character
- Access to its layer's IPFS-addressed verses via CID lookup

```python
# layer_agent.py
import faiss
import numpy as np
import json
from dataclasses import dataclass
from typing import List, Optional
import httpx

@dataclass
class ResonanceUnitResult:
    unit_id: str
    layer_num: int
    unit_num: int
    text_source: str
    text_translation: str
    score: float
    cid: str

class LayerAgent:
    """Tier 1: Agent specialized on a single resonance layer."""
    
    def __init__(self, layer_num: int, dag: dict, 
                 unit_embeddings: np.ndarray, unit_id_to_idx: dict,
                 cid_map: dict, llm_endpoint: str = "http://localhost:11434"):
        self.layer_num = layer_num
        self.layer_id = f"layer-{layer_num}"
        self.llm_endpoint = llm_endpoint
        
        layer_node = dag["nodes"][self.layer_id]
        self.letter_count = layer_node["letter_count"]
        self.unit_ids = layer_node["children_ids"]
        self.cid_map = cid_map
        
        # Build per-layer FAISS index (only verses in this layer)
        layer_indices = [unit_id_to_idx[uid] for uid in self.unit_ids 
                        if uid in unit_id_to_idx]
        self.local_embs = unit_embeddings[layer_indices].astype(np.float32)
        faiss.normalize_L2(self.local_embs)
        
        self.index = faiss.IndexFlatIP(self.local_embs.shape[1])
        self.index.add(self.local_embs)
        self.local_unit_ids = [self.unit_ids[i] for i in range(len(layer_indices))]
        
        # Build unit lookup
        self.units = {
            uid: dag["nodes"][uid] for uid in self.unit_ids 
            if uid in dag["nodes"]
        }
        
        self.system_prompt = self._build_system_prompt(layer_node)
    
    def _build_system_prompt(self, layer_node: dict) -> str:
        return (
            f"You are a specialized resonance agent for Layer {self.layer_num} "
            f"of the Soul of the World corpus. "
            f"This layer contains {len(self.unit_ids)} resonance units "
            f"and has a letter signature of {self.letter_count}. "
            f"Your role is to surface relevant resonance units, explain semantic connections, "
            f"and generate precise responses grounded in your layer's text. "
            f"Always cite resonance units as [{self.layer_num}:unit_number]."
        )
    
    def retrieve(self, query_emb: np.ndarray, top_k: int = 5) -> List[ResonanceUnitResult]:
        """Find most relevant resonance units within this layer."""
        q = query_emb.reshape(1, -1).astype(np.float32)
        faiss.normalize_L2(q)
        scores, indices = self.index.search(q, min(top_k, len(self.local_unit_ids)))
        
        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0:
                continue
            uid = self.local_unit_ids[idx]
            node = self.units.get(uid, {})
            parts = uid.split("-")
            results.append(ResonanceUnitResult(
                unit_id=uid,
                layer_num=int(parts[1]),
                unit_num=int(parts[2]),
                text_source=node.get("text_source", ""),
                text_translation=node.get("text_translation", ""),
                score=float(score),
                cid=self.cid_map.get(uid, "")
            ))
        return results
    
    async def respond(self, query: str, query_emb: np.ndarray, 
                      top_k: int = 3) -> dict:
        """Generate a layer-specific response with retrieved context."""
        retrieved = self.retrieve(query_emb, top_k)
        
        context = "\n".join([
            f"[{r.layer_num}:{r.unit_num}] {r.text_source}\n→ {r.text_translation}"
            for r in retrieved
        ])
        
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": (
                f"Query: {query}\n\n"
                f"Relevant resonance units from Layer {self.layer_num}:\n{context}\n\n"
                f"Respond with insights from your layer's perspective."
            )}
        ]
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.llm_endpoint}/api/chat",
                json={"model": "soul-engine:latest", "messages": messages, 
                      "stream": False},
                timeout=30.0
            )
            text = resp.json()["message"]["content"]
        
        return {
            "layer_num": self.layer_num,
            "response": text,
            "citations": [
                {"unit_id": r.unit_id, "layer": r.layer_num, 
                 "unit": r.unit_num, "score": r.score, "cid": r.cid,
                 "translation": r.text_translation}
                for r in retrieved
            ]
        }
```

## Tier 2 — Segment Coordinators

```python
# segment_coordinator.py
import numpy as np
import faiss
import asyncio
from typing import List, Dict
from layer_agent import LayerAgent

class SegmentCoordinator:
    """Tier 2: Coordinates 3–4 Layer Agents within one resonance segment."""
    
    def __init__(self, segment_num: int, layer_agents: List[LayerAgent],
                 segment_embedding: np.ndarray):
        self.segment_num = segment_num
        self.agents = {a.layer_num: a for a in layer_agents}
        self.segment_embedding = segment_embedding
        
        # Build intra-segment routing index using mean layer embeddings
        # (computed from each layer's local unit embeddings)
        self._build_routing_index()
    
    def _build_routing_index(self):
        """Build a FAISS index over layer embeddings for intra-segment routing."""
        self.layer_nums = list(self.agents.keys())
        embs = np.array([
            self.agents[ln].local_embs.mean(axis=0) 
            for ln in self.layer_nums
        ], dtype=np.float32)
        faiss.normalize_L2(embs)
        
        self.routing_index = faiss.IndexFlatIP(embs.shape[1])
        self.routing_index.add(embs)
    
    def route(self, query_emb: np.ndarray, top_k: int = 2) -> List[int]:
        """Return the top-k most relevant layer numbers for this query."""
        q = query_emb.reshape(1, -1).astype(np.float32)
        faiss.normalize_L2(q)
        _, indices = self.routing_index.search(q, min(top_k, len(self.layer_nums)))
        return [self.layer_nums[i] for i in indices[0] if i >= 0]
    
    async def handle(self, query: str, query_emb: np.ndarray,
                     top_layers: int = 2) -> dict:
        """Route query to most relevant layers and synthesize."""
        target_layers = self.route(query_emb, top_layers)
        
        # Activate target layers in parallel
        tasks = [
            self.agents[ln].respond(query, query_emb)
            for ln in target_layers if ln in self.agents
        ]
        layer_responses = await asyncio.gather(*tasks)
        
        # Aggregate citations
        all_citations = []
        for resp in layer_responses:
            all_citations.extend(resp.get("citations", []))
        
        return {
            "segment_num": self.segment_num,
            "activated_layers": target_layers,
            "layer_responses": layer_responses,
            "top_citations": sorted(all_citations, key=lambda x: -x["score"])[:5]
        }
```

## Tier 3 — Global Orchestrator

```python
# soul_engine_orchestrator.py
import numpy as np
import faiss
import asyncio
from typing import List
from sentence_transformers import SentenceTransformer
from segment_coordinator import SegmentCoordinator

class SoulEngineOrchestrator:
    """
    Tier 3: The global Soul Engine orchestrator.
    Receives user queries, routes to segments, synthesizes final response.
    """
    
    def __init__(self, coordinators: List[SegmentCoordinator],
                 segment_embeddings: np.ndarray, segment_ids: List[str]):
        self.coordinators = {c.segment_num: c for c in coordinators}
        
        # Global routing index over segment embeddings
        embs = segment_embeddings.astype(np.float32)
        faiss.normalize_L2(embs)
        self.routing_index = faiss.IndexFlatIP(embs.shape[1])
        self.routing_index.add(embs)
        self.segment_nums = [int(sid.split("-")[1]) for sid in segment_ids]
        
        # Query encoder (BGE-M3 for consistency with Level 1 embeddings)
        self.encoder = SentenceTransformer("BAAI/bge-m3")
    
    def encode_query(self, query: str) -> np.ndarray:
        return self.encoder.encode(query, normalize_embeddings=True)
    
    def route_to_segments(self, query_emb: np.ndarray, 
                          top_k: int = 3) -> List[int]:
        q = query_emb.reshape(1, -1).astype(np.float32)
        _, indices = self.routing_index.search(q, min(top_k, len(self.segment_nums)))
        return [self.segment_nums[i] for i in indices[0] if i >= 0]
    
    async def query(self, user_query: str, top_segments: int = 3) -> dict:
        query_emb = self.encode_query(user_query)
        target_segments = self.route_to_segments(query_emb, top_segments)
        
        # Fan out to segments in parallel
        tasks = [
            self.coordinators[sn].handle(user_query, query_emb)
            for sn in target_segments if sn in self.coordinators
        ]
        seg_responses = await asyncio.gather(*tasks)
        
        # Collect and rank all citations across all segments
        all_citations = []
        for resp in seg_responses:
            all_citations.extend(resp.get("top_citations", []))
        
        top_citations = sorted(all_citations, key=lambda x: -x["score"])[:8]
        
        # Synthesis prompt
        synthesis_context = "\n\n".join([
            f"[Segment {r['segment_num']}, Layer {r['activated_layers']}]\n"
            + "\n".join(
                lr["response"] for lr in r["layer_responses"]
            )
            for r in seg_responses
        ])
        
        return {
            "query": user_query,
            "activated_segments": target_segments,
            "segment_responses": seg_responses,
            "top_citations": top_citations,
            "synthesis_context": synthesis_context,
        }
```

---

---

# Phase 4 — IPFS Distributed Inference Infrastructure

**Goal:** Shard the model across the IPFS network so any Bucks node can participate in inference.

## Model Sharding Strategy

The 114 layers are divided into 10 shards of ~11 layers each. Each shard is exported as an ONNX partial model and pinned to IPFS.

```
Shard 0: Layers 1–11    (Token Embedding + Layers 1–11)
Shard 1: Layers 12–22
Shard 2: Layers 23–33
...
Shard 9: Layers 112–114 (+ output heads)
```

```python
# shard_model.py
import torch
import json
from pathlib import Path
from resonance_network import SoulEngineNetwork, load_layer_widths

SHARD_SIZE = 12  # layers per shard

def export_shards(checkpoint_path: str):
    layer_widths = load_layer_widths("corpus_dag.json")
    model = SoulEngineNetwork(layer_widths=layer_widths, vocab_size=8192, base_dim=256)
    model.load_state_dict(torch.load(checkpoint_path, map_location="cpu"))
    model.eval()
    
    shard_map = {}
    
    for shard_id in range(0, 114, SHARD_SIZE):
        end = min(shard_id + SHARD_SIZE, 114)
        shard_layers = list(range(shard_id, end))
        shard_path = f"soul_engine_shard_{shard_id//SHARD_SIZE}.onnx"
        
        # Export subset of layers as ONNX
        # (Implementation: wrap shard in a ShardModule with explicit forward)
        shard_module = ShardModule(model, shard_layers)
        
        dummy_in = torch.randn(1, 64, layer_widths[shard_id] if shard_id > 0 else 256)
        torch.onnx.export(
            shard_module, (dummy_in,),
            shard_path,
            dynamic_axes={"input": {0: "batch", 1: "seq_len"}},
            opset_version=17,
        )
        
        shard_map[shard_id // SHARD_SIZE] = {
            "path": shard_path,
            "layers": shard_layers,
            "in_dim": layer_widths[shard_id] if shard_id > 0 else 256,
            "out_dim": layer_widths[end - 1],
        }
        print(f"Exported shard {shard_id // SHARD_SIZE}: layers {shard_id}–{end-1}")
    
    json.dump(shard_map, open("shard_map.json", "w"), indent=2)
```

## GossipSub Topics and Message Protocol

The following topics are used in the existing Bucks libp2p/GossipSub infrastructure:

| Topic | Direction | Payload |
|-------|-----------|---------|
| `soul-engine-query` | Broadcast from any node | `{queryId, query, queryEmb, topSegments}` |
| `soul-engine-result-<queryId>` | Node → originator | `{nodeId, shardId, layerResults, citations}` |
| `soul-engine-shard-announce` | Periodic broadcast | `{nodeId, shards: [0,1,5,...], timestamp}` |
| `soul-engine-shard-request` | Unicast | `{requestingNode, shardId, cid}` |

```javascript
// soul-engine-gossip.js — add to Bucks IPFS server
import { gossipsub } from '@chainsafe/libp2p-gossipsub'

const TOPICS = {
  QUERY: 'soul-engine-query',
  SHARD_ANNOUNCE: 'soul-engine-shard-announce',
  SHARD_REQUEST: 'soul-engine-shard-request',
  result: (queryId) => `soul-engine-result-${queryId}`,
}

class SoulEngineGossipBridge {
  constructor(libp2pNode, localShards = []) {
    this.node = libp2pNode
    this.localShards = new Set(localShards)
    this.pendingQueries = new Map()
    this.shardRegistry = new Map() // nodeId → [shardIds]
    
    this._subscribe()
    this._announceShards()
  }
  
  _subscribe() {
    this.node.services.pubsub.subscribe(TOPICS.QUERY)
    this.node.services.pubsub.subscribe(TOPICS.SHARD_ANNOUNCE)
    this.node.services.pubsub.subscribe(TOPICS.SHARD_REQUEST)
    
    this.node.services.pubsub.addEventListener('message', async (evt) => {
      const { topic, data } = evt.detail
      const payload = JSON.parse(new TextDecoder().decode(data))
      
      if (topic === TOPICS.QUERY) {
        await this._handleIncomingQuery(payload)
      } else if (topic === TOPICS.SHARD_ANNOUNCE) {
        this.shardRegistry.set(payload.nodeId, payload.shards)
      } else if (topic === TOPICS.SHARD_REQUEST) {
        await this._handleShardRequest(payload)
      }
    })
  }
  
  async _announceShards() {
    const announce = () => {
      const payload = {
        nodeId: this.node.peerId.toString(),
        shards: [...this.localShards],
        timestamp: Date.now(),
      }
      this.node.services.pubsub.publish(
        TOPICS.SHARD_ANNOUNCE,
        new TextEncoder().encode(JSON.stringify(payload))
      )
    }
    
    announce()
    setInterval(announce, 30_000) // re-announce every 30s
  }
  
  async _handleIncomingQuery(payload) {
    const { queryId, query, topSegments } = payload
    
    // Only handle if we have relevant shards
    const relevantShards = payload.targetShards?.filter(s => this.localShards.has(s))
    if (!relevantShards?.length) return
    
    // Run inference on our shards
    const result = await this._runLocalInference(query, relevantShards)
    
    // Publish result back
    const resultTopic = TOPICS.result(queryId)
    this.node.services.pubsub.subscribe(resultTopic)
    this.node.services.pubsub.publish(
      resultTopic,
      new TextEncoder().encode(JSON.stringify({
        nodeId: this.node.peerId.toString(),
        queryId,
        shards: relevantShards,
        ...result,
      }))
    )
    
    // Self-seed: pin completed inference result to IPFS
    await this._pinResult(queryId, result)
  }
  
  async broadcastQuery(query, targetShards, timeoutMs = 10_000) {
    const queryId = crypto.randomUUID()
    const resultTopic = TOPICS.result(queryId)
    this.node.services.pubsub.subscribe(resultTopic)
    
    const results = []
    const done = new Promise((resolve) => {
      const handler = (evt) => {
        const payload = JSON.parse(new TextDecoder().decode(evt.detail.data))
        if (payload.queryId === queryId) results.push(payload)
      }
      this.node.services.pubsub.addEventListener('message', handler)
      setTimeout(() => {
        this.node.services.pubsub.removeEventListener('message', handler)
        resolve(results)
      }, timeoutMs)
    })
    
    this.node.services.pubsub.publish(
      TOPICS.QUERY,
      new TextEncoder().encode(JSON.stringify({ queryId, query, targetShards }))
    )
    
    return done
  }
  
  findNodesForShard(shardId) {
    return [...this.shardRegistry.entries()]
      .filter(([, shards]) => shards.includes(shardId))
      .map(([nodeId]) => nodeId)
  }
  
  async _runLocalInference(query, shards) {
    // Delegate to the Python agent server at localhost:3000
    const resp = await fetch('http://localhost:3000/soul-engine/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, shards }),
    })
    return resp.json()
  }
  
  async _pinResult(queryId, result) {
    // Pin result CID via Helia at port 3939
    await fetch('http://localhost:3939/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryId, result }),
    })
  }
}

export { SoulEngineGossipBridge, TOPICS }
```

## CID Routing Table

Each Bucks node maintains a local `soul-engine-cid-map.json`:

```json
{
  "shards": {
    "0": { "cid": "Qm...", "local": true, "path": "~/.bucks/soul-engine/shard-0.onnx" },
    "1": { "cid": "Qm...", "local": false, "knownPeers": ["12D3Koo..."] },
    "2": { "cid": "Qm...", "local": true, "path": "~/.bucks/soul-engine/shard-2.onnx" }
  },
  "embeddings": {
    "level1": { "cid": "Qm...", "local": true },
    "level3": { "cid": "Qm...", "local": true }
  },
  "corpus": {
    "root": "Qm...",
    "dag": "Qm..."
  }
}
```

---

---

# Phase 5 — Bucks Integration

**Goal:** Wire the Soul Engine swarm into `bucks browser` as a new provider type, surfaced through the existing Soul Engine chat interface.

## New Agent Provider Type

Add `SoulEngineSwarmProvider` to the existing agent infrastructure:

```python
# bucks browser/agent/agents/soul_engine_agent.py
"""
Soul Engine Swarm Agent — integrates the hierarchical resonance swarm
into the Bucks A2UI agent protocol.
"""
import asyncio
import httpx
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/soul-engine")

class SoulEngineQuery(BaseModel):
    query: str
    top_segments: int = 3
    top_layers_per_segment: int = 2
    include_source: bool = True

class CitationChip(BaseModel):
    unit_id: str
    layer_num: int
    unit_num: int
    text_translation: str
    text_source: str
    score: float
    cid: str

class SoulEngineResponse(BaseModel):
    response: str
    citations: list[CitationChip]
    activated_segments: list[int]
    activated_layers: list[int]

@router.post("/query", response_model=SoulEngineResponse)
async def soul_engine_query(req: SoulEngineQuery):
    """
    Main entry point: receives a user query, routes through the swarm,
    returns synthesized response + citation chips.
    """
    from soul_engine_orchestrator import get_orchestrator
    
    orchestrator = get_orchestrator()
    result = await orchestrator.query(
        req.query, 
        top_segments=req.top_segments
    )
    
    all_layers = []
    for seg_resp in result["segment_responses"]:
        all_layers.extend(seg_resp.get("activated_layers", []))
    
    return SoulEngineResponse(
        response=_synthesize(result),
        citations=[
            CitationChip(
                unit_id=c["unit_id"],
                layer_num=c["layer"],
                unit_num=c["unit"],
                text_translation=c["translation"],
                text_source=c.get("text_source", ""),
                score=c["score"],
                cid=c["cid"],
            )
            for c in result["top_citations"]
        ],
        activated_segments=result["activated_segments"],
        activated_layers=list(set(all_layers)),
    )

def _synthesize(result: dict) -> str:
    """Merge layer responses into a single coherent answer."""
    parts = []
    for seg_resp in result.get("segment_responses", []):
        for lr in seg_resp.get("layer_responses", []):
            if lr.get("response"):
                parts.append(lr["response"])
    return "\n\n".join(parts[:3])  # top 3 layer responses

@router.get("/shard-status")
async def shard_status():
    """Report which shards this node has locally."""
    import json
    from pathlib import Path
    cid_map = json.loads(Path("soul-engine-cid-map.json").read_text())
    return {
        "local_shards": [
            sid for sid, info in cid_map["shards"].items() 
            if info.get("local")
        ],
        "total_shards": len(cid_map["shards"])
    }

@router.post("/infer")
async def local_infer(payload: dict):
    """Called by GossipSub handler when this node should run local inference."""
    # Delegate to the ONNX runtime for the specified shards
    from onnx_inference import run_shards
    return await run_shards(payload["query"], payload["shards"])
```

## Frontend Integration

### A2UI Response Format with Citations

The existing A2UI protocol is extended to support citation chips. Add to the Bucks Browser renderer:

```javascript
// bucks browser/ipfs/public/soul-engine-renderer.js

function renderSoulEngineResponse(response) {
  const { response: text, citations, activated_segments, activated_layers } = response
  
  // Build citation chips
  const chips = citations.map(c => `
    <div class="citation-chip" 
         data-cid="${c.cid}"
         data-unit="${c.unit_id}"
         onclick="openResonanceUnit('${c.unit_id}', '${c.cid}')">
      <span class="citation-coord">${c.layer_num}:${c.unit_num}</span>
      <span class="citation-text">${c.text_translation.slice(0, 60)}…</span>
      <span class="citation-score">${(c.score * 100).toFixed(0)}%</span>
    </div>
  `).join('')
  
  // Build activation heatmap (which layers lit up)
  const layerIndicator = buildLayerHeatmap(activated_layers)
  
  return `
    <div class="soul-engine-response">
      <div class="response-text">${text}</div>
      <div class="citation-row">${chips}</div>
      <div class="layer-indicator">${layerIndicator}</div>
    </div>
  `
}

function buildLayerHeatmap(activatedLayers) {
  // Visual indicator: 114 tiny squares, active ones highlighted
  return Array.from({ length: 114 }, (_, i) => {
    const active = activatedLayers.includes(i + 1)
    return `<span class="layer-dot ${active ? 'active' : ''}" title="Layer ${i + 1}"></span>`
  }).join('')
}

async function openResonanceUnit(unitId, cid) {
  // Fetch verse content from IPFS via local Helia gateway
  const resp = await fetch(`http://localhost:3939/get/${cid}`)
  const unit = await resp.json()
  
  // Open modal with full verse content
  showModal({
    title: `Resonance Unit ${unitId}`,
    content: `
      <div class="verse-arabic">${unit.text_source}</div>
      <div class="verse-translit">${unit.text_translit}</div>
      <div class="verse-translation">${unit.text_translation}</div>
      <div class="verse-meta">
        Layer ${unit.layer_num} · Unit ${unit.unit_num} · 
        CID: <code>${cid.slice(0, 12)}…</code>
      </div>
    `
  })
}
```

### Agent Engine Model Type

In `agent-engine.js` (or equivalent), add the new model type:

```javascript
// Add to existing model type registry
const MODEL_TYPES = {
  // ... existing types ...
  'soul-engine-swarm': {
    name: 'Soul Engine Swarm',
    provider: 'soul-engine',
    endpoint: 'http://localhost:3000/soul-engine/query',
    streaming: false,
    capabilities: ['resonance-search', 'citation', 'verse-lookup'],
    
    async send(query, options = {}) {
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          top_segments: options.topSegments ?? 3,
          top_layers_per_segment: options.topLayers ?? 2,
          include_source: true,
        }),
      })
      const data = await resp.json()
      return {
        text: data.response,
        citations: data.citations,
        metadata: {
          activated_segments: data.activated_segments,
          activated_layers: data.activated_layers,
        }
      }
    }
  }
}
```

### IPFS Bridge at Port 3939

The existing IPFS server at port 3939 needs two new endpoints:

```javascript
// Add to bucks browser/ipfs/server.js

// Fetch a corpus node by CID
app.get('/get/:cid', async (req, res) => {
  try {
    const chunks = []
    for await (const chunk of helia.blockstore.get(CID.parse(req.params.cid))) {
      chunks.push(chunk)
    }
    const data = JSON.parse(Buffer.concat(chunks).toString())
    res.json(data)
  } catch (err) {
    res.status(404).json({ error: 'CID not found', cid: req.params.cid })
  }
})

// Add/pin a JSON object, return its CID
app.post('/add', async (req, res) => {
  const data = Buffer.from(JSON.stringify(req.body))
  const cid = await helia.blockstore.put(data)
  res.json({ cid: cid.toString() })
})
```

---

---

# Phase 6 — Progressive Enhancement (Agentic Capabilities)

**Goal:** Extend the swarm with higher-order reasoning tools that operate across the full resonance field.

Once the base swarm is operational (Phases 0–5), add the following tool capabilities to the orchestrator:

## Tool: Cross-Layer Search

Searches across all 114 layers simultaneously, bypassing the segment routing for broad semantic queries.

```python
async def cross_layer_search(query: str, top_k: int = 10) -> list:
    """
    Search the full Level 1 FAISS index (all 6,236 units) directly.
    Returns top-k results from across all layers.
    """
    query_emb = orchestrator.encode_query(query)
    
    # The global FAISS index (all units, already built in Phase 1)
    global_index = faiss.read_index("level1.faiss")
    unit_ids = json.load(open("level1_faiss_ids.json"))["ids"]
    
    q = query_emb.reshape(1, -1).astype(np.float32)
    scores, indices = global_index.search(q, top_k)
    
    return [
        {"unit_id": unit_ids[i], "score": float(s)}
        for s, i in zip(scores[0], indices[0]) if i >= 0
    ]
```

## Tool: Thematic Mapping

Identifies structural connections between non-adjacent layers based on embedding similarity:

```python
async def thematic_map(concept: str, top_layers: int = 10) -> dict:
    """
    Given a concept, find the layers with the highest thematic resonance.
    Returns a ranked map of layers + their resonance score.
    """
    query_emb = orchestrator.encode_query(concept)
    
    layer_scores = {}
    for layer_num, agent in all_layer_agents.items():
        layer_mean_emb = agent.local_embs.mean(axis=0)
        score = float(np.dot(query_emb, layer_mean_emb) / 
                      (np.linalg.norm(query_emb) * np.linalg.norm(layer_mean_emb)))
        layer_scores[layer_num] = score
    
    ranked = sorted(layer_scores.items(), key=lambda x: -x[1])[:top_layers]
    return {
        "concept": concept,
        "layer_resonance": [
            {"layer": ln, "score": s, "letter_count": layer_widths[ln - 1]}
            for ln, s in ranked
        ]
    }
```

## Tool: Morphological Analysis

Breaks down any Arabic root token found in the corpus using the CAMeL morphological data from Phase 0:

```python
async def analyze_root(word: str) -> dict:
    """
    Find all occurrences of a root token across the corpus
    and return morphological breakdown.
    """
    dag = get_dag()
    tok_nodes = [n for n in dag["nodes"].values() 
                 if n["level"] == 0 and n.get("morphological_tags")]
    
    root = extract_root(word)  # CAMeL root extraction
    
    matches = [
        {
            "token_id": n["id"],
            "word": n["text_source"],
            "root": n["morphological_tags"]["root"],
            "pos": n["morphological_tags"]["pos"],
            "parent_unit": n["parent_id"],
        }
        for n in tok_nodes
        if n["morphological_tags"]["root"] == root
    ]
    
    return {
        "root": root,
        "total_occurrences": len(matches),
        "unique_forms": len(set(m["word"] for m in matches)),
        "occurrences": matches[:20],  # cap at 20 for response size
    }
```

## Tool: Verse Comparison

Given two concepts, finds resonance patterns across layers:

```python
async def verse_comparison(concept_a: str, concept_b: str) -> dict:
    """
    Find resonance units that bridge two concepts.
    Returns units with high scores for both.
    """
    emb_a = orchestrator.encode_query(concept_a)
    emb_b = orchestrator.encode_query(concept_b)
    
    global_index = faiss.read_index("level1.faiss")
    unit_ids = json.load(open("level1_faiss_ids.json"))["ids"]
    
    _, idx_a = global_index.search(emb_a.reshape(1, -1), 50)
    _, idx_b = global_index.search(emb_b.reshape(1, -1), 50)
    
    set_a = set(idx_a[0])
    set_b = set(idx_b[0])
    bridge_indices = set_a & set_b
    
    return {
        "concept_a": concept_a,
        "concept_b": concept_b,
        "bridge_units": [unit_ids[i] for i in bridge_indices if i >= 0],
        "exclusive_a": [unit_ids[i] for i in set_a - set_b if i >= 0][:5],
        "exclusive_b": [unit_ids[i] for i in set_b - set_a if i >= 0][:5],
    }
```

## Tool: Citation Generation

Structured output with corpus coordinates:

```python
def generate_citation(unit_id: str, dag: dict, cid_map: dict) -> str:
    """
    Returns a structured citation in format: Segment:Layer:Unit
    e.g. "2:7:255" = Segment 2, Layer 7, Unit 255
    """
    node = dag["nodes"].get(unit_id, {})
    layer_id = node.get("parent_id", "")
    layer_node = dag["nodes"].get(layer_id, {})
    seg_id = layer_node.get("parent_id", "")
    
    parts = unit_id.split("-")
    layer_num = parts[1] if len(parts) > 1 else "?"
    unit_num = parts[2] if len(parts) > 2 else "?"
    seg_num = seg_id.split("-")[1] if seg_id else "?"
    
    cid = cid_map.get(unit_id, "")
    
    return {
        "coordinate": f"{seg_num}:{layer_num}:{unit_num}",
        "unit_id": unit_id,
        "cid": cid,
        "ipfs_url": f"ipfs://{cid}",
        "text": node.get("text_translation", ""),
    }
```

## Tool: Multi-Hop Reasoning

For complex queries requiring chained inference across multiple activation cycles:

```python
async def multi_hop_reason(query: str, hops: int = 3) -> dict:
    """
    Chain multiple orchestrator activations:
    Hop 1: Initial activation → top citations
    Hop 2: Use top citations as new queries → expand context
    Hop 3: Synthesize across all activations
    """
    context_units = []
    current_query = query
    
    for hop in range(hops):
        result = await orchestrator.query(current_query, top_segments=2)
        new_citations = result["top_citations"]
        context_units.extend(new_citations)
        
        if hop < hops - 1 and new_citations:
            # Next query: the translation text of the top citation
            current_query = new_citations[0]["translation"]
    
    # Deduplicate citations by unit_id
    seen = set()
    unique_citations = []
    for c in context_units:
        if c["unit_id"] not in seen:
            seen.add(c["unit_id"])
            unique_citations.append(c)
    
    return {
        "original_query": query,
        "hops_completed": hops,
        "total_citations_gathered": len(unique_citations),
        "citations": sorted(unique_citations, key=lambda x: -x["score"])[:10],
        "reasoning_chain": [f"Hop {i+1}: {q}" for i, q in enumerate([query] * hops)]
    }
```

---

---

## File Structure (Final)

```
soul-engine/
├── corpus/
│   ├── build_corpus_dag.py          # Phase 0: build DAG
│   ├── pin_dag_to_ipfs.py           # Phase 0: pin to IPFS
│   ├── segment_map.json             # 30-segment definition
│   ├── corpus_dag.json              # Full 4-level graph
│   ├── corpus_dag_with_cids.json    # DAG with IPFS CIDs
│   └── cid_map.json                 # {node_id: CID}
│
├── embeddings/
│   ├── embed_root_tokens.py         # Phase 1: Level 0
│   ├── link_level1_embeddings.py    # Phase 1: Level 1 (reuse QNN)
│   ├── embed_layers.py              # Phase 1: Level 2
│   ├── embed_segments.py            # Phase 1: Level 3
│   ├── embed_global.py              # Phase 1: Level 4
│   ├── build_faiss_indices.py       # Phase 1: FAISS
│   ├── level0_root_token_embeddings.npy
│   ├── level1_unit_embeddings.npy   # from QNN Part B
│   ├── level1.faiss
│   ├── level2_layer_embeddings.pkl  # variable dim
│   ├── level3_segment_embeddings.npy
│   ├── level3.faiss
│   └── level4_global_embedding.npy
│
├── model/
│   ├── resonance_network.py         # Phase 2: PyTorch architecture
│   ├── train_resonance_network.py   # Phase 2: Training
│   ├── export_model.py              # Phase 2: ONNX export
│   ├── shard_model.py               # Phase 4: Sharding
│   ├── soul_engine.onnx             # exported model
│   ├── soul_engine.gguf             # GGUF for node-llama-cpp
│   ├── soul_engine_shard_*.onnx     # shards (10 files)
│   └── shard_map.json               # shard → layer mapping
│
├── agents/
│   ├── layer_agent.py               # Phase 3: Tier 1
│   ├── segment_coordinator.py       # Phase 3: Tier 2
│   ├── soul_engine_orchestrator.py  # Phase 3: Tier 3
│   └── soul_engine_tools.py         # Phase 6: Agentic tools
│
├── server/
│   ├── soul_engine_agent.py         # Phase 5: FastAPI routes
│   └── onnx_inference.py            # Phase 4: ONNX runtime
│
└── bucks-integration/
    ├── soul-engine-gossip.js         # Phase 4: GossipSub bridge
    ├── soul-engine-renderer.js       # Phase 5: UI rendering
    └── soul-engine-cid-map.json      # Phase 4: local CID registry
```

---

## Quick-Start Checklist (Developer)

To start immediately on any phase:

- **Phase 0:** `pip install camel-tools --break-system-packages && python corpus/build_corpus_dag.py`
- **Phase 1:** Requires Phase 0 output + `quran_bge_m3_embeddings.npy` from QNN
- **Phase 2:** Requires Phase 1 output + GPU (or use MPS on Apple Silicon for smaller runs)
- **Phase 3:** Requires Phase 1 output (embeddings only — can run before Phase 2 training completes, using random-weight architecture for agent scaffolding)
- **Phase 4:** Requires Phases 2 + 3 complete; wire into existing `ipfs/server.js`
- **Phase 5:** Requires Phase 3 orchestrator running at `localhost:3000`; add routes to existing `agent/server.py`
- **Phase 6:** Plug tools into `soul_engine_orchestrator.py` as async methods; no new infrastructure required

---

*Soul Engine Swarm — 114-Layer Resonance Architecture*  
*Internal planning document — Bucks Core*

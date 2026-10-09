# Quran Neural Net

A two-part project that treats the 114 chapters of the Quran as the structural
blueprint of a deep neural network.

---

## What this is

### Part A — The Skeleton (sculpture)

A 114-layer PyTorch architecture where **each layer's width equals the number
of Arabic letters in the corresponding Quran chapter**. The network is not
trained on anything — it is a literal monument: a 2.21-billion-parameter
architecture whose shape was determined entirely by the text of the Quran.

- Al-Baqarah (chapter 2, 26,118 letters) becomes the widest hidden layer.
- Al-Kawthar (chapter 108, 61 letters) becomes the narrowest.
- The overall architecture mirrors the Quran's own structure: large, weighty
  early chapters tapering down to short, concentrated final ones.

**Total parameters: 2,210,453,812**

### Part B — The Working System

A fully functional semantic search and Q&A engine over all 6,236 Quran verses:

- **Sentence embeddings** (all-MiniLM-L6-v2, 384 dimensions) for every verse
- **FAISS cosine-similarity index** for millisecond nearest-neighbour lookup
- **Thematic clustering** — K-Means (30 clusters) with a UMAP 2D projection
- **RAG Q&A** — retrieves top-5 relevant verses and passes them to an LLM

---

## Setup

```bash
cd ~/Desktop/Quran-Neural-Net

pip3 install torch torchvision --break-system-packages -q
pip3 install sentence-transformers faiss-cpu matplotlib numpy requests \
             scikit-learn --break-system-packages -q
pip3 install umap-learn --break-system-packages -q
```

Or use the requirements file:

```bash
pip3 install -r requirements.txt --break-system-packages -q
```

---

## Running Part A

```bash
python3 part_a_skeleton.py
```

Downloads the Uthmani Quran text, counts Arabic letters per chapter, builds
the QuranNet architecture with meta-tensors (no RAM needed for 2.2B weights),
and saves two visualisation PNGs.

**Output files:** `layer_widths_bar.png`, `layer_widths_line.png`, `chapter_data.json`

---

## Running Part B

```bash
python3 part_b_embeddings.py
```

Downloads Arabic + English (Sahih International) verse data, generates
sentence embeddings (~7 s on Apple Silicon), builds a FAISS index, runs
K-Means clustering, renders a UMAP scatter plot, and executes 5 demo queries.

**Output files:** `quran_verses.json`, `quran_embeddings.npy`, `quran.faiss`,
`cluster_labels.npy`, `kmeans_centroids.npy`, `theme_clusters.png`,
`demo_output.txt`

---

## Interactive CLI

The search CLI uses **local Ollama** for RAG Q&A — no API key required.

### 1. Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.ai/install.sh | sh

# macOS via Homebrew
brew install ollama
```

Or download from [https://ollama.ai](https://ollama.ai).

### 2. Pull a model

```bash
ollama pull llama3        # recommended (~4 GB)
# alternatives
ollama pull mistral       # faster on older hardware
ollama pull phi3          # lightweight (~2 GB)
ollama pull gemma2        # Google's open model
```

### 3. Start the CLI

```bash
python3 quran_search.py
```

```
🤖  Ollama: 1 model(s) available — using 'llama3'

🕌  Quran Semantic Search & RAG  (local Ollama — no API key needed)
============================================================
Commands:
  search <query>    — find verses by meaning
  ask <question>    — RAG answer via local Ollama
  cluster           — show 30 thematic clusters
  models            — list available Ollama models
  quit              — exit

> search mercy and compassion
> search Day of Judgment
> ask What does the Quran say about forgiveness?
> ask What are the qualities of a true believer?
> models
> cluster
```

If Ollama is not running, `search` and `cluster` still work — only `ask`
degrades gracefully (it shows the top-5 source verses and instructions to
start Ollama).

### Environment overrides

```bash
export OLLAMA_HOST="http://192.168.1.10:11434"   # remote Ollama server
export OLLAMA_MODEL="mistral"                    # force a specific model
python3 quran_search.py
```

---

## Example queries

| Command | What it finds |
|---------|---------------|
| `search patience in hardship` | Al-Ma'aarij 70:5, An-Nahl 16:127 … |
| `search light and guidance` | An-Nur 24:35, Al-Baqara 2:2 … |
| `search creation of the universe` | Al-Anbiyaa 21:30, Al-A'raaf 7:54 … |
| `ask What is the greatest sin?` | RAG answer with citations |
| `ask How does the Quran describe paradise?` | RAG answer with citations |

---

## Architecture details (Part A)

| Metric | Value |
|--------|-------|
| Layers | 114 (113 Linear+ReLU blocks) |
| Input width | 139 neurons (Al-Fatihah) |
| Max width | 26,118 neurons (Al-Baqarah, ch. 2) |
| Min width | 61 neurons (Al-Kawthar, ch. 108) |
| Output width | 99 neurons (An-Nas) |
| **Total parameters** | **2,210,453,812** |

---

---

## Running the Swarm (Phase B — Adaptive Ecosystem)

The swarm replaces the sequential `embed → search → generate` pipeline with a
**parallel adaptive ecosystem**: four retrieval strategies race simultaneously,
the fastest high-quality result wins, pheromone trails accumulate over time,
and the Builder self-tunes its own parameters after every query.

### Components

`soul_swarm.py` — single entry point that boots all components:

- **SwarmCore** (`soul_swarm_core.py`) — fans out to four strategies in parallel
  via `ThreadPoolExecutor`. First to return results above the quality threshold wins.
  Strategies: `dense` (BGE-M3 FAISS), `pheromone` (ACO-boosted re-rank),
  `layer` (topic-routed to specific resonance layers), `keyword` (BM25 fallback).

- **GuardianAgent** (`soul_guardian.py`) — daemon thread monitoring builder
  heartbeats, scheduling pheromone evaporation, gating response quality.

- **AdaptiveBuilder** (`soul_adaptive_builder.py`) — extends BuilderAgent with
  PSO-inspired self-tuning. After every query it adjusts retrieval depth `k`,
  generation temperature, and strategy weights based on rolling quality scores.
  State persists to `soul_agent_params.json` so it survives restarts.

- **LearningLogger** (`soul_learning_log.py`) — appends every interaction to
  `soul_interactions.jsonl` in a format ready for LoRA fine-tuning.

### Quickstart

```bash
cd ~/Desktop/QNN

# Conversational mode — talks to the full corpus
python soul_swarm.py --interactive

# Single query
python soul_swarm.py --query "What brings peace to the heart?"

# Show adaptive parameters (k, temperature, strategy weights, rolling quality)
python soul_swarm.py --status

# Show learning statistics from soul_interactions.jsonl
python soul_swarm.py --stats
```

### Interactive commands

Inside `--interactive` mode:

```
Query › What brings peace to the heart?
Query › /status      # show current adaptive params
Query › /stats       # show learning stats
Query › /trails      # show top 10 pheromone trails with τ values
Query › /quit        # exit (state is auto-saved)
```

### Self-tuning behaviour

After every query the Builder adapts automatically:

| Condition | Action |
|-----------|--------|
| quality > 0.70 | decrease `k` (exploit), allow temperature to drift up |
| quality < 0.40 | increase `k` (explore), lower temperature for focus |
| strategy wins accumulate | strategy weights shift toward winner over time |

All params are saved to `soul_agent_params.json` after every query.

### Learning log

Every interaction is appended to `soul_interactions.jsonl`. Run weekly to
export high-quality pairs for LoRA fine-tuning:

```python
from soul_learning_log import LearningLogger
LearningLogger().generate_training_dataset(min_alignment=0.50)
# writes soul_training_data.jsonl
```

### Graceful offline mode

If Ollama is not running, the Builder returns retrieved source units with a
`[Soul Engine offline]` prefix instead of a generated response. All other
swarm components (retrieval, pheromones, logging, adaptation) continue normally.

---

## File reference

| File | Description |
|------|-------------|
| `part_a_skeleton.py` | Downloads Quran, builds architecture, generates plots |
| `part_b_embeddings.py` | Full pipeline: data → embeddings → FAISS → clusters → RAG |
| `quran_search.py` | Interactive CLI (search / ask / cluster) |
| `quran_verses.json` | 6,236 verses with Arabic text and English translation |
| `quran_embeddings.npy` | Float32 matrix, shape (6236, 384) |
| `quran.faiss` | FAISS IndexFlatIP (cosine similarity, normalised) |
| `cluster_labels.npy` | K-Means cluster assignment for each verse (0–29) |
| `kmeans_centroids.npy` | 30 cluster centroids, shape (30, 384) |
| `layer_widths_bar.png` | Bar chart of all 114 layer widths |
| `layer_widths_line.png` | Line chart of layer widths, top-7 labelled |
| `theme_clusters.png` | 2-D UMAP scatter plot of all verse embeddings |
| `demo_output.txt` | Semantic search demo output: 4 queries × top-3 results (patience, gratitude, knowledge, mercy) |
| `chapter_data.json` | Letter counts and metadata for all 114 chapters |
| `quran_uthmani_raw.json` | Raw API response cache (Arabic text) |
| `param_count.txt` | Parameter count for programmatic use |
| **Phase B — Swarm** | |
| `soul_swarm.py` | Entry point: `--interactive`, `--query`, `--status`, `--stats` |
| `soul_swarm_core.py` | Parallel fan-out engine (4 strategies, ThreadPoolExecutor race) |
| `soul_adaptive_builder.py` | Self-tuning Builder with PSO-style param adaptation |
| `soul_guardian.py` | Daemon thread: heartbeat, evaporation, quality gate |
| `soul_learning_log.py` | JSONL interaction logger + LoRA training dataset generator |
| `soul_builder_agent.py` | Base Builder Agent (sequential pipeline, Phase A) |
| `soul_pheromone.py` | ACO pheromone trail manager |
| `soul_pheromones.json` | Live trail state (evaporates automatically) |
| `soul_agent_params.json` | Adaptive Builder params — persists across restarts |
| `soul_interactions.jsonl` | Interaction log — seed data for future fine-tuning |
| `soul_corpus_dag.json` | 6,381-node content-addressed corpus hierarchy |
| `soul_cid_map.json` | CID lookup for all 6,236 corpus units |
| `quran_bge_m3.faiss` | BGE-M3 FAISS index (1024-dim, cosine similarity) |
| `quran_bge_m3_embeddings.npy` | Precomputed BGE-M3 embeddings, shape (6236, 1024) |

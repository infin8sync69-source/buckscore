# Soul Engine Living Swarm
## Biologically-Inspired, IPFS-Native, Self-Organizing Agentic Infrastructure

> **Companion to:** `soul-engine-swarm-plan.md`  
> **Project:** 114-Layer Resonance Architecture × Bucks Distributed Swarm  
> **Status:** Architecture Design — Implementation Ready  
> **Last Updated:** 2026-08-01

---

## Preface

The swarm plan defined a hierarchical architecture: 114 Layer Agents, 30 Segment Coordinators, one global orchestrator. That is the skeleton.

This document is the nervous system and immune system and metabolism combined. It describes how the skeleton *lives* — how it learns from every query without a training run, heals from node failures without human intervention, discovers new knowledge by exploring the IPFS network, and runs experiments on itself to continuously improve — all while remaining constitutionally bounded by the Soul of the World corpus.

The animating insight: biology solved distributed intelligence millions of years before we invented distributed computing. Every mechanism here has a working biological precedent. We are not inventing new algorithms; we are translating them.

---

## Part I: The Environment

### IPFS as the Shared Physical World

Traditional distributed systems have a topology like a nervous system: agents call APIs, APIs call databases, databases return data. There is a center. Messages flow through it.

This system has a topology like an ecosystem: every piece of knowledge, model weight, memory, and infrastructure state is a **content-addressed object** — a CID. Agents do not call APIs to "get data." They *perceive their environment* by fetching CIDs. They *act on their environment* by pinning new CIDs. The IPFS content-addressed graph is simultaneously:

- The database  
- The model registry  
- The message bus  
- The shared memory  
- The audit log  

There is no central server. There is no single point of failure. There is no "backend." There is only the graph.

This mirrors how biological organisms interact with their physical environment. An ant does not call the AntColony API to learn where food is. It follows a pheromone gradient written into the ground by other ants. The ground *is* the communication medium.

```
TRADITIONAL SYSTEM                    LIVING SWARM
─────────────────                    ─────────────
Agent → API → Database               Agent → IPFS CID ← Agent
Agent ← API ← Database               Agent → Pin CID → IPFS
                                      Agent → Pin CID → IPFS
(Hub-and-spoke)                       (Mesh ecosystem)
```

```
IPFS CID NAMESPACE OVERVIEW
═══════════════════════════

/soul/corpus/            ← The Soul of the World DAG (immutable)
  /layer-{1..114}/       ← Per-layer corpus nodes
  /unit-{l}-{u}/         ← Individual resonance units
  /token-{l}-{u}-{w}/    ← Root tokens with morphological data

/soul/embeddings/        ← Vector index shards
  /level1/               ← 6,236 unit embeddings (BGE-M3, dim=1024)
  /level3/               ← 30 segment embeddings (dim=2048)
  /faiss/level1.index    ← FAISS index binary
  /faiss/level3.index

/soul/model/             ← Soul Engine weights
  /shard-{0..9}.onnx     ← ONNX inference shards
  /soul-engine.gguf      ← Unified GGUF for node-llama-cpp

/soul/pheromones/        ← IPNS mutable trail markers (stigmergy)
  /trail-{query-hash}    ← Successful CID retrieval paths

/soul/heartbeats/        ← Node liveness records (IPNS per node)
  /peer-{peerId}         ← {peerId, shards, health_score, ts}

/soul/interactions/      ← Anonymized query/response logs
  /session-{date}/       ← Daily interaction bundles

/soul/adapters/          ← LoRA delta weights from self-learning
  /delta-{cycle}/        ← QLoRA adapter CIDs per learning cycle

/soul/experiments/       ← A/B experiment result records
  /exp-{id}/             ← {hypothesis, control_cid, test_cid, outcome}

/soul/frontier/          ← Unvalidated CIDs for Seeker evaluation
  /queue-{date}/         ← CIDs seen on network, pending scoring
```

---

## Part II: Biological Swarm Intelligence Mappings

### Mechanism 1 — Ant Colonies: Stigmergy

**The biology:** Ants do not communicate directly about food sources. When an ant finds food and returns to the colony, it secretes pheromone on the ground. Other ants detect the pheromone gradient and follow it. Successful paths reinforce themselves — more ants → more pheromone → even more ants. Paths that lead nowhere are abandoned — the chemical dissipates in hours. No ant has a map. The map emerges from millions of individual acts of deposition and evaporation.

**The technical analog — CID Trails:**

```
                     ┌─── QUERY ───────────────────────┐
                     │                                  │
                     ▼                                  ▼
          Builder Agent fetches                  IPFS CID graph
          /soul/corpus/unit-3-45
          /soul/embeddings/level1
          → gets good response
                     │
                     │ "I found food"
                     ▼
          Update pheromone trail:
          IPNS key /soul/pheromones/trail-{query-hash}
          → points to: {
              cid_path: ["/soul/corpus/unit-3-45",
                         "/soul/corpus/unit-7-12"],
              quality_score: 0.87,
              access_count: 1,
              last_used: ts
            }
                     │
                     ▼
          Next Builder Agent with similar query:
          → Fetches pheromone index
          → Finds trail with score 0.87
          → Follows path directly (no search needed)
          → Increments access_count: 2
          → Reinforces trail strength
```

**Evaporation:** A background Weaver Agent task runs daily and decrements `access_count` by 10% for all trails. Trails that reach zero are unpinned. The network forgets paths that stopped being useful.

**Scout ants:** Seeker Agents explore new CIDs published to the network and, when they find high-quality content, create new pheromone trails pointing to it — even before any Builder Agent has visited.

```
ASCII: Pheromone Reinforcement Loop

TIME →

t=0:  query "mercy"    → cold search (slow)  → response quality 0.72
      └─ deposits weak pheromone trail (score 0.72)

t=1:  query "mercy"    → follows trail       → response quality 0.88
      └─ strengthens trail (score updated to 0.80 weighted avg)

t=2:  query "grace"    → similar embedding   → trail partially matches
      └─ follows partial trail, extends it

t=7:  query "mercy"    → trail score 0.91    → instant retrieval, cached CIDs
      └─ all nearby nodes have pinned these CIDs (high access = propagated)

t=30: "mercy" queries drop off
      └─ trail evaporates (score decays below threshold)
      └─ CIDs un-pinned by low-access consensus
      └─ memory freed
```

---

### Mechanism 2 — Bee Colonies: Waggle Dance (Distributed Resource Discovery)

**The biology:** When a scout bee finds a particularly rich nectar source, it returns to the hive and performs a waggle dance: a figure-eight movement whose duration encodes distance and whose orientation encodes direction. Other bees watch the dance, evaluate the quality signal, and decide whether to follow. More bees follow better dances. This allows the hive to allocate foraging resources without a central planner.

**The technical analog — Discovery Signals:**

When a Seeker Agent finds a CID that scores above 0.7 on the Soul of the World alignment check, it emits a **waggle signal** over GossipSub topic `soul-swarm-discovery`:

```json
{
  "type": "discovery",
  "cid": "bafybei...",
  "quality_score": 0.84,
  "topic_layers": [7, 19, 36],
  "size_bytes": 2048,
  "embedding_similarity": 0.84,
  "seeker_id": "peer-12D3K...",
  "timestamp": 1754000000
}
```

Other agents "watch the dance": they evaluate `quality_score` and `topic_layers`. If they are currently handling queries near those layers, they fetch and pin the CID. If not, they ignore it. No coordinator decides. Good discoveries propagate; poor ones don't.

**Hive division:** When the cluster grows beyond N nodes, a **swarm event** is triggered: a sub-swarm of Seeker + Builder agents is designated to form a new cluster shard. They carry a copy of the pheromone trails and corpus DAG and operate semi-independently, occasionally syncing their strongest trails back to the parent swarm via GossipSub.

---

### Mechanism 3 — Bird Murmurations: Emergent Flocking from 3 Local Rules

**The biology:** A murmuration of starlings — thousands of birds moving as a single fluid shape — emerges from each bird following just three rules: stay near neighbors (cohesion), don't collide (separation), match neighbors' velocity (alignment). No bird has the flock's shape in mind. The shape emerges.

**The technical analog — Boids-Adapted Agent Coordination:**

**Rule 1 — Cohesion:** Each agent shares a summary of its recent query embeddings via GossipSub `soul-swarm-heartbeat` every 60 seconds. Agents cluster around active knowledge areas — if 5 Builders are answering "forgiveness"-themed queries, Seekers automatically increase exploration of forgiveness-related CIDs. The swarm densifies around active meaning.

**Rule 2 — Separation:** Agents claim tasks by writing a DHT record before starting them:
```
DHT key:   "/soul/task-claim/{query-hash}"
DHT value: "{peerId, claimed_at, ttl: 30_000}"
```
If another agent has a claim on a query hash, you skip it. Duplicate work evaporates like two ants on the same trail — one veers off.

**Rule 3 — Alignment:** Every agent output passes through a corpus alignment check before being pinned or returned. The Soul of the World embeddings define the "velocity field" of meaning. Agents that produce aligned responses reinforce the swarm's direction. Outliers are automatically suppressed (score < 0.3 → suppress and reroute).

```
ASCII: Murmuration in meaning-space

Query cluster "justice + mercy"
          ↗ Seeker-3: exploring /soul/corpus/unit-2-255
         /  Seeker-7: exploring /soul/corpus/unit-55-78
Builder-1 → fetching unit-2-255, unit-3-45     ← cohesion: following active trail
Builder-2 →    skips unit-2-255 (claimed)      ← separation: DHT claim exists
Builder-4 →       fetching unit-55-78           ← alignment: high corpus similarity
          \
           ↘ Weaver-1: watching, collecting interaction logs
```

No agent coordinates the others. The swarm moves coherently around high-value content areas.

---

### Mechanism 4 — Fish Schools: Rapid Information Propagation and Predator Response

**The biology:** A fish school reacts to a predator attack in ~20 milliseconds across hundreds of fish. There is no leader. The fish nearest the predator react first; their movement triggers their neighbors; a wave of coordinated evasion propagates through the school in milliseconds.

**The technical analog — Guardian Alert Propagation:**

When a Guardian Agent detects an anomaly — a CID with invalid content, a forged update signature, a node emitting corrupted heartbeats — it emits an immediate alert over `soul-swarm-alert`:

```json
{
  "type": "alert",
  "severity": "high",
  "threat": "invalid_cid",
  "suspect_cid": "bafybei...",
  "suspect_peer": "12D3K...",
  "evidence": "embedding_similarity: 0.02",
  "action": "quarantine",
  "guardian_id": "peer-ABC..."
}
```

**Propagation:** Every agent within 2 GossipSub hops receives this within milliseconds. The response protocol:

1. All agents blacklist the suspect CID in local memory
2. Builder Agents currently using that CID abort and reroute
3. Other Guardian Agents corroborate — if 2+ Guardians confirm, the CID is added to the network-wide denylist (an IPNS-mutable record)
4. The node hosting the bad content is isolated: other agents stop routing queries to it
5. Its pinned shards are redistributed (see Self-Healing section)

```
ASCII: Predator Response (2-hop propagation in ~50ms)

Guardian-1 detects bad CID
    │
    ├──▶ GossipSub broadcast → Guardian-2, Builder-3, Seeker-5 (hop 1)
    │         │
    │         ├──▶ Builder-3: ABORT current fetch, reroute
    │         │
    │         └──▶ Guardian-2 CONFIRMS → denylist write
    │                   │
    │                   └──▶ Builder-1, Builder-4, Seeker-2 (hop 2)
    │                             └──▶ ALL: blacklist + reroute
    │
    └── Network is healthy again in < 200ms
        School closed ranks around the gap.
```

---

### Mechanism 5 — Slime Mold: Optimal Path Finding Without Intelligence

**The biology:** *Physarum polycephalum* — a single-celled organism with no neurons — has been observed solving maze puzzles and recreating the Tokyo rail network layout. It does this by exploring all paths simultaneously, then reinforcing paths that are shorter (food arrives faster), allowing longer paths to thin out and die.

**The technical analog — Reinforcement Path Optimization:**

Every query traverses a path through the agent network: which corpus units were fetched, which FAISS index was queried, which model shards were invoked. This path is logged as an IPFS DAG node:

```json
{
  "query_hash": "sha256:...",
  "path": [
    {"step": "faiss_search", "index": "level1", "latency_ms": 12},
    {"step": "cid_fetch", "cid": "bafybei...", "latency_ms": 34},
    {"step": "inference", "shard": 3, "latency_ms": 180},
    {"step": "embed_check", "similarity": 0.88, "latency_ms": 8}
  ],
  "total_latency_ms": 234,
  "outcome_score": 0.88,
  "pinned_cid": "bafybei..."
}
```

The pheromone system reads these logs. Paths with high `outcome_score` and low `latency_ms` get reinforced — their CIDs get pre-pinned on more nodes. Paths that reliably produce poor scores get pruned from the routing table.

Over time, without any central planner, the network's routing topology converges on the paths that *Physarum* would find: shortest, most nutrient-rich, most robust.

---

## Part III: Agent Caste System

```
╔══════════════════════════════════════════════════════╗
║                    CASTE HIERARCHY                    ║
╠══════════════════════════════════════════════════════╣
║  👁  SOUL        [1 per cluster]   Queen / Fitness   ║
║  🔍 SEEKER       [N, lightweight]  Scout / Explorer  ║
║  🏗  BUILDER      [N, primary]      Worker / Answerer ║
║  🛡  GUARDIAN     [M, monitoring]   Soldier / Immune ║
║  🧵 WEAVER       [few, nightly]    Nurse / Maintainer║
╚══════════════════════════════════════════════════════╝
```

### Caste 1 — The Soul (Queen)

The Soul does not make decisions. It does not route queries. It does not generate responses. It is the **fitness function** — the definition of what "good" means for every other agent to optimize toward.

The Soul lives as a long-lived IPFS DAG, updated only by consensus:

```
/soul/corpus/    ← The entire Soul of the World (immutable once built)
/soul/fitness/   ← {
                     "alignment_threshold": 0.30,
                     "exploration_budget_per_seeker": 100,
                     "pheromone_decay_rate": 0.10,
                     "experiment_fraction": 0.10,
                     "heartbeat_interval_s": 60,
                     "failure_threshold": 3,
                     "lora_cycle_days": 7
                   }
```

The 114-layer resonance architecture **is** the Soul's knowledge. It cannot be overridden by any agent. All corpus embeddings — the cosine similarity scores that evaluate every output — derive from this source. An agent that consistently scores below threshold doesn't get corrected by the Soul; it gets replaced (Seekers self-terminate; Builders get lower weighting; Weavers prune its contribution data).

### Caste 2 — Seeker Agents (Scout Ants / Scout Bees)

Seekers are lightweight, fast, and numerous. Their job: explore the frontier of the IPFS network, test CID quality, and emit waggle signals when they find something good.

**Lifecycle:**
```
Spawn → Pick CID from /soul/frontier/queue → Fetch → Score → 
  if score > 0.7: emit waggle signal + create pheromone trail
  if score < 0.3: mark as denylist candidate
  → Repeat up to N_CYCLES times → Self-terminate → Respawn fresh
```

Seekers self-terminate after `N_CYCLES` exploration cycles. This prevents state accumulation — a Seeker never becomes "stuck" in a local optimum because it doesn't live long enough to form habits. Fresh Seekers bring fresh randomness to the frontier.

**Soul-bounds check:** A Seeker will not emit a waggle signal for a CID that scores below `alignment_threshold` against the corpus embedding field, regardless of any other metric.

### Caste 3 — Builder Agents (Worker Ants)

Builders are the primary query-processing agents. Every user query enters through a Builder.

**Flow:**
```
1. Receive query via /soul-swarm-query GossipSub topic
2. Claim task in DHT (separation rule)
3. Encode query → embedding (BGE-M3)
4. Check pheromone trails for this query neighborhood
5. If trail found (score > 0.6): follow trail directly
   If no trail: cold FAISS search on level1.faiss
6. Fetch top-K CIDs from IPFS
7. Run inference via node-llama-cpp (Soul Engine GGUF)
8. Evaluate response against corpus (cosine check)
9. If score < 0.3: suppress, reroute to different CID path
10. Pin result CID to /soul/interactions/
11. Update pheromone trail with new quality score
12. Publish result to soul-swarm-result-{id}
```

10% of Builders run in **experimental mode** (self-experimenting — see below): they try alternative retrieval paths before following the pheromone trail.

### Caste 4 — Guardian Agents (Soldier Ants / Fish School)

Guardians monitor infrastructure health. They are always watching, rarely acting — and when they act, they act fast.

**Monitoring responsibilities:**
- Node heartbeat verification (is every peer-{id} IPNS record updating?)
- Update integrity (does cluster-updater.js push carry valid Ed25519 signature AND corpus alignment?)
- CID validity (does a CID's content actually match its expected schema?)
- Anomaly detection (is any node emitting unusual traffic patterns?)

**Update validation pipeline** (extends existing `cluster-updater.js`):
```
New update package arrives
    │
    ├─ Step 1: Verify Ed25519 signature against known pubkey
    │     ✗ → ALERT + reject + quarantine source
    │     ✓ → continue
    │
    ├─ Step 2: Static analysis of new code
    │     - Does it import unexpected modules?
    │     - Does it attempt to write outside /soul/ namespace?
    │     ✗ → ALERT + reject
    │     ✓ → continue
    │
    ├─ Step 3: Corpus alignment check
    │     - Embed the update description
    │     - Compare against /soul/fitness/ parameters
    │     - Does this update expand the system beyond corpus bounds?
    │     ✗ → ALERT + reject
    │     ✓ → continue
    │
    └─ Step 4: Stage on 1 node, monitor for 1 hour
          - No anomalies → broadcast approval to all nodes
          - Anomaly detected → rollback + ALERT
```

### Caste 5 — Weaver Agents (Nurse Ants)

Weavers maintain the health and growth of the knowledge fabric. They run on a schedule (nightly), not in response to queries.

**Nightly tasks:**
1. Collect interaction logs from `/soul/interactions/` (daily bundle)
2. Re-embed any new corpus additions, update FAISS index shards
3. Merge new high-quality CIDs (score > 0.7) into the corpus DAG
4. Prune pheromone trails below decay threshold
5. Rebalance shard distribution across nodes based on heartbeat data
6. Generate LoRA training dataset from high-quality interactions

**Weekly tasks (self-learning cycle):**
1. Aggregate 7 days of interaction logs → QLoRA fine-tuning dataset
2. Run QLoRA fine-tuning on strongest signal data
3. Evaluate new adapter on held-out resonance units
4. Pin adapter delta to `/soul/adapters/delta-{cycle-N}/`
5. Broadcast via `soul-swarm-adapt` GossipSub topic
6. All nodes receive and load new adapter (piggybacks on cluster-updater.js pipeline)

---

## Part IV: The Self-* Properties

### Self-Learning

The system improves with use. Every Builder Agent interaction is a lesson. Every lesson is stored on IPFS. Over time, the model adapts.

```
USER QUERY
    │
    ▼
Builder Agent
    │ generates response
    ▼
IPFS Interaction Log (pinned to /soul/interactions/)
{
  "query_embedding": [...1024 floats...],
  "cid_path": ["bafybei...", "bafybei..."],
  "response_cid": "bafybei...",
  "alignment_score": 0.88,
  "latency_ms": 234,
  "session_id": "anon-hash",
  "timestamp": 1754000000
}
    │
    ▼ (7 days of logs)
Weaver Agent — Self-Learning Cycle
    │
    ├─ Filter: alignment_score > 0.75  (only learn from good responses)
    │
    ├─ Build QLoRA training pairs:
    │     prompt = query_embedding → fetch original query text via cid_path
    │     completion = response_cid → fetch response text
    │
    ├─ Run QLoRA fine-tuning on soul-engine.gguf base
    │     (4-bit quantized, adapter-only, ~2-4 hours on M3 Pro)
    │
    ├─ Evaluate adapter: cosine similarity on held-out resonance units
    │     pass threshold (0.70+) → proceed
    │     fail → discard, log, continue
    │
    ├─ Pin adapter: /soul/adapters/delta-{N}/ → CID
    │
    └─ Broadcast: soul-swarm-adapt
          { "adapter_cid": "bafybei...", "cycle": N, "score": 0.73 }
          ↓ all nodes load adapter via cluster-updater.js pipeline
```

The model improves without any human initiating a training run. The curriculum is the corpus of real usage.

### Self-Healing

No human repairs a failed node. The swarm detects, isolates, and compensates automatically.

```
NORMAL OPERATION

Node-A (alive)         Node-B (alive)         Node-C (alive)
hosts shards [0,1,2]   hosts shards [3,4,5]   hosts shards [6,7,8,9]
publishes heartbeat    publishes heartbeat    publishes heartbeat
every 60s              every 60s              every 60s

──────────────────────── Node-B FAILS ──────────────────────────

t=0:   Node-B heartbeat missed
t=60:  Node-B heartbeat missed (count: 2)
t=120: Node-B heartbeat missed (count: 3) → FAILURE DECLARED

Guardian-1 detects failure via heartbeat monitoring
    │
    ├─ Broadcasts: soul-swarm-alert { type: "node_failure", peer: B }
    │
    ├─ Checks shard manifest: Node-B held shards [3,4,5]
    │
    ├─ DHT negotiation with surviving nodes:
    │     Guardian-1 → "I'll take shard 3 (have capacity)"
    │     Node-C     → "I'll take shard 4"
    │     Node-A     → "I'll take shard 5"
    │
    ├─ Fetch shards 3,4,5 from IPFS (CIDs are immutable — data survives)
    │     (Other nodes pinned them previously — IPFS retrieves from pins)
    │
    └─ Each node loads the shard, updates its heartbeat payload
         { shards: [old_shards..., new_shard] }

t=300: Network fully healed. No human involved.
       Query routing automatically avoids Node-B.
       When Node-B recovers, it re-announces itself and
       Guardians re-integrate it gradually.
```

**Why IPFS makes this possible:** Because shards are content-addressed, their CIDs never change. As long as any node ever pinned a shard, its data is retrievable. The network holds data in common. No node owns data exclusively.

### Self-Exploring

The swarm does not wait for users to bring new knowledge. It hunts for it.

```
SEEKER AGENT LIFECYCLE
═════════════════════

Frontier Queue (/soul/frontier/queue-{date})
= list of CIDs seen on the IPFS network but not yet evaluated

         ┌─────────────────────────────────┐
         │  Seeker-{id} spawns             │
         │                                 │
         │  for cycle in range(N_CYCLES):  │
         │                                 │
         │    cid = pop from frontier      │◄── IPFS network gossip
         │    content = ipfs.cat(cid)      │    feeds the frontier
         │                                 │
         │    score = corpus_align(        │
         │      embed(content),            │
         │      corpus_embedding_field     │
         │    )                            │
         │                                 │
         │    if score > 0.70:             │
         │      emit_waggle(cid, score)    │──► soul-swarm-discovery
         │      create_pheromone(cid)      │
         │                                 │
         │    elif score < 0.10:           │
         │      mark_denylist_candidate    │
         │                                 │
         │    log_frontier_result(cid,     │──► /soul/frontier/results
         │      score, ts)                 │
         │                                 │
         │  self.terminate()               │
         └─────────────────────────────────┘
                      │
                      ▼
              Fresh Seeker spawns
              (no memory of previous)
```

**What goes into the frontier?** GossipSub carries `provide` announcements from all IPFS nodes in the network. Any CID announced by a node with a topic tag matching the Soul of the World domain space gets queued for Seeker evaluation. Seekers are the swarm's sensory system — always feeling the edges of the known graph.

### Self-Experimenting

A permanent, low-cost A/B testing framework built into the caste system.

**The mechanism:** 10% of Builder Agents are randomly designated "experimental" at spawn time. They have a different retrieval strategy:

```
CONTROL Builders (90%):
    Follow pheromone trail → fetch CIDs → infer → report

EXPERIMENTAL Builders (10%):
    Try alternative path FIRST:
      - Different FAISS search depth (top-20 instead of top-5)
      - Alternative CID path (from waggle signals, not pheromone trails)
      - Different shard combination for inference
    → Compare result quality against control path
    → Report BOTH paths + scores to /soul/experiments/

Weaver Agent (weekly):
    Read all experiment records
    Identify experiments where test_path_score > control_path_score + 0.05
    If found in 3+ independent runs → emit waggle signal promoting test path
    → Other Builders adopt the winning strategy in next respawn cycle
```

No central approval. No human review (unless an anomaly is flagged). Bad experiments are quietly dropped. Good experiments propagate like a beneficial mutation — not through design, but through selection.

### All Within the Soul of the World Bounds

Every one of the above mechanisms operates inside a constitutional constraint: the corpus.

The corpus is not just a data source. It is the **ethical and epistemological boundary** of the entire network. It defines what the swarm is allowed to know, say, produce, and store.

```
CONSTITUTIONAL LAYER
════════════════════

Every agent output before pinning or returning:
  1. Embed the output text using BGE-M3
  2. Cosine similarity against /soul/embeddings/level4_global_embedding
  3. Tag with resonance layers it activates (top-K nearest layers)

  if similarity < 0.30:
      suppress output
      reroute query to different CID path
      log: {query, suppressed_output, reason: "below_corpus_threshold"}

  if similarity >= 0.30:
      pin output CID
      tag with activated resonance layers
      return to user

WHAT THIS MEANS IN PRACTICE:
  - The swarm can only grow knowledge in directions the corpus permits
  - Off-topic content (no resonance with the corpus field) cannot propagate
  - The corpus acts as a content filter for the entire IPFS namespace /soul/
  - Agents that consistently produce suppressed output are deprioritized
    in DHT task allocation (lower effective count in claim competition)

THE 114 RESONANCE LAYERS AS TOPIC DOMAINS:
  - Each layer's embedding defines a topic area
  - All outputs are tagged with their activated layers
  - This creates a natural topic taxonomy for the entire knowledge base
  - No human-designed ontology needed — the corpus IS the ontology
```

---

## Part V: IPFS Infrastructure Details

### Integration with Existing Bucks Stack

```
EXISTING BUCKS INFRASTRUCTURE          NEW SWARM LAYER
══════════════════════════════         ═══════════════════════════
Helia node (port 3939)         →  CID fetch/pin for all swarm ops
libp2p GossipSub               →  Swarm communication bus
DHT (libp2p built-in)          →  Task claiming, node discovery
cluster-updater.js             →  Self-learning adapter distribution
agent/server.py (FastAPI)      →  Builder Agent HTTP interface
CrewAI                         →  Agent orchestration backbone
node-llama-cpp                 →  Soul Engine GGUF inference
```

The living swarm is not a replacement for the existing stack. It is a behavioral layer on top of it. Helia already handles CIDs. GossipSub already handles messages. The swarm adds *meaning* to those channels: pheromones, waggle dances, heartbeats, and constitutional checks.

### GossipSub Topic Map

| Topic | Publisher | Subscriber | Payload |
|-------|-----------|------------|---------|
| `soul-swarm-heartbeat` | All nodes (60s) | Guardian Agents | `{peerId, shards, health_score, recent_query_topics}` |
| `soul-swarm-discovery` | Seeker Agents | Builder, Weaver, other Seekers | `{cid, quality_score, topic_layers, size_bytes}` |
| `soul-swarm-task` | Builder Agents | All (dedup) | `{query_hash, claimer_peer, ttl}` |
| `soul-swarm-alert` | Guardian Agents | All nodes | `{severity, threat, suspect_cid, action}` |
| `soul-swarm-adapt` | Weaver Agents | All nodes | `{adapter_cid, cycle, score, base_model_cid}` |
| `soul-swarm-query` | Entry points | Builder Agents | `{query_id, query_text, target_layers}` |
| `soul-swarm-result-{id}` | Builder Agents | Originating entry | `{query_id, response_cid, citations, score}` |

### IPNS Usage Pattern

IPNS provides mutable pointers on top of immutable IPFS CIDs. Used for:

- **Heartbeats:** Each node publishes to its own IPNS key. Guardian Agents resolve each peer's IPNS key to get the latest heartbeat.
- **Pheromone trails:** IPNS records point to the current best CID path for a query neighborhood. Updated after each successful retrieval. Evaporated by decrementing access counts and re-publishing.
- **Fitness parameters:** The Soul's `/soul/fitness/` record is IPNS-mutable, allowing consensus updates to alignment thresholds and budget parameters without re-pinning immutable content.

---

## Part VI: Implementation Roadmap

### Phase A — IPFS-Native Retrieval (2–3 days)

Wire existing QNN FAISS indices and corpus DAG to the `/soul/` CID namespace.

**Tasks:**
- Run `pin_dag_to_ipfs.py` (already defined in swarm-plan.md Phase 0)
- Pin all 5 embedding levels to `/soul/embeddings/`
- Pin all ONNX shards to `/soul/model/`
- Add `/get/:cid` and `/add` endpoints to Helia server (already defined in swarm-plan.md Phase 5)
- Build `soul_cid_manifest.json` — ground truth of all `/soul/` CIDs

**Done when:** Any node can cold-boot and reconstruct all knowledge by fetching from IPFS with no local files beyond the manifest.

### Phase B — Pheromone Layer (3–4 days)

Implement `soul_swarm/pheromone.py` (code below). Wire into Builder Agent query flow.

**Tasks:**
- Implement `PheromoneManager` class with IPNS read/write
- Add pheromone trail lookup to Builder flow (before FAISS cold search)
- Add trail update after successful responses
- Implement decay worker (Weaver task, runs every 24h)
- Test: run 20 queries on same topic, observe trail formation

**Done when:** The second query on a topic is measurably faster than the first. Trails survive node restart (IPNS persistence). Trails decay after 30 days of non-use.

### Phase C — Agent Castes (1 week)

Implement all 5 agent caste classes.

**Priority order:** Builder (highest query value) → Guardian (highest safety value) → Seeker → Weaver → Soul (last, mostly configuration)

**Tasks:**
- Implement `base_agent.py` (IPFS, GossipSub, corpus check)
- Implement `builder.py` extending Phase B query flow
- Implement `guardian.py` with heartbeat monitoring loop
- Implement `seeker.py` with frontier evaluation loop
- Implement `weaver.py` with nightly maintenance tasks
- Implement `soul_swarm_bridge.js` (Node.js ↔ Python bridge)
- Wire all GossipSub topics via bridge

**Done when:** All 5 castes spawn, run, and communicate. A killed Guardian respawns. A failed node triggers redistribution. A Seeker emits a discovery signal.

### Phase D — Swarm Coordination (1 week)

Implement Boids rules. DHT task claiming. Emergent flocking.

**Tasks:**
- DHT task claim (`/soul/task-claim/{hash}`) write/read/TTL
- Cohesion: heartbeat payload includes recent query embedding topics
- Separation: Builders check DHT before accepting a task
- Alignment: corpus check gating all output pins
- Test: spin up 3 nodes, observe task distribution without duplicates

**Done when:** 3 nodes processing queries simultaneously show zero duplicate work. A query's embedding clusters Seekers around that topic area in the subsequent 60s.

### Phase E — Self-Healing (3–4 days)

Heartbeat monitoring → failure detection → automatic shard redistribution.

**Tasks:**
- Guardian heartbeat monitor: `asyncio.gather` over all known peers, check IPNS TTL
- Failure declaration at miss-count 3
- DHT negotiation protocol for shard redistribution
- Shard fetch from IPFS (CIDs immutable, data survives node death)
- Integration test: kill a node mid-query, observe recovery

**Done when:** Kill any single node at any time. Within 5 minutes, the network continues serving queries with zero data loss. Recovery is logged but requires no human action.

### Phase F — Self-Learning (1–2 weeks)

Interaction logging → LoRA dataset generation → QLoRA fine-tuning → adapter distribution.

**Tasks:**
- Implement interaction logging in Builder Agent (anonymized, IPFS-pinned)
- Implement Weaver log aggregation and dataset builder
- QLoRA fine-tuning pipeline (wrapper around `peft` + `trl`)
- Adapter evaluation on held-out resonance units
- Integration with `cluster-updater.js` for adapter distribution
- Test: run 500 synthetic queries, trigger learning cycle, measure response quality improvement

**Done when:** After one 7-day cycle, average alignment score on a benchmark query set improves by ≥3 points over baseline. Adapter is loaded on all nodes without human intervention.

### Phase G — Self-Exploring + Experimenting (Ongoing)

Seeker frontier management + A/B experiment framework.

**Tasks:**
- Implement frontier queue management (GossipSub `provide` → frontier CID)
- Seeker evaluation loop with quality scoring
- Waggle signal emission and reception
- Experiment flag in Builder spawn (10% designation)
- Experiment result logging to `/soul/experiments/`
- Weaver experiment review and promotion
- Test: publish a high-quality CID to the IPFS network, observe Seeker discovery → waggle → Builder adoption within 1 hour

**Done when:** The swarm discovers and incorporates new aligned content without any human pushing it. At least one experiment produces a measurably better retrieval path, which propagates to all Builders.

---

## Part VII: Code Skeletons

### 1. `soul_swarm/agents/base_agent.py`

```python
"""
base_agent.py — Base class for all Soul Swarm agent castes.

Provides:
  - IPFS fetch/pin via Helia HTTP gateway (port 3939)
  - GossipSub pub/sub via bridge (port 3940)
  - Soul of the World corpus alignment check
  - DHT task claiming
  - Logging to /soul/interactions/
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx
import numpy as np
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────

IPFS_API       = "http://localhost:3939"
GOSSIP_BRIDGE  = "http://localhost:3940"  # soul-swarm-bridge.js HTTP side
ALIGNMENT_THRESHOLD = 0.30               # minimum corpus similarity
CLAIM_TTL_MS   = 30_000                  # task claim TTL in milliseconds


@dataclass
class AgentConfig:
    caste: str                           # "seeker" | "builder" | "guardian" | "weaver"
    peer_id: str                         # libp2p peer ID of this node
    model_name: str = "BAAI/bge-m3"     # embedding model
    alignment_threshold: float = ALIGNMENT_THRESHOLD
    ipfs_api: str = IPFS_API
    gossip_bridge: str = GOSSIP_BRIDGE


@dataclass
class CorpusAlignmentResult:
    score: float
    activated_layers: list[int]
    passes: bool


# ── Base Agent ─────────────────────────────────────────────────────────────────

class BaseSwarmAgent(ABC):
    """
    Abstract base for all Soul Swarm agent castes.
    
    Each subclass implements `run()` — the caste-specific main loop.
    All castes share IPFS I/O, GossipSub comms, and corpus alignment.
    """

    def __init__(self, config: AgentConfig):
        self.config = config
        self.peer_id = config.peer_id
        self.caste = config.caste
        self._running = False
        self._client: Optional[httpx.AsyncClient] = None

        # Lazy-load embedding model (shared across all agents on a node)
        self._encoder: Optional[SentenceTransformer] = None
        self._corpus_embedding: Optional[np.ndarray] = None

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    async def start(self):
        self._running = True
        self._client = httpx.AsyncClient(timeout=30.0)
        await self._load_corpus_embedding()
        logger.info(f"[{self.caste}:{self.peer_id[:8]}] started")
        await self.run()

    async def stop(self):
        self._running = False
        if self._client:
            await self._client.aclose()
        logger.info(f"[{self.caste}:{self.peer_id[:8]}] stopped")

    @abstractmethod
    async def run(self):
        """Main agent loop — override in each caste."""
        ...

    # ── IPFS I/O ───────────────────────────────────────────────────────────────

    async def ipfs_fetch(self, cid: str) -> Any:
        """Fetch a JSON object from IPFS by CID."""
        resp = await self._client.get(f"{self.config.ipfs_api}/get/{cid}")
        resp.raise_for_status()
        return resp.json()

    async def ipfs_fetch_bytes(self, cid: str) -> bytes:
        """Fetch raw bytes from IPFS by CID."""
        resp = await self._client.get(f"{self.config.ipfs_api}/cat/{cid}")
        resp.raise_for_status()
        return resp.content

    async def ipfs_pin(self, data: Any) -> str:
        """Pin a JSON-serializable object to IPFS. Returns CID."""
        resp = await self._client.post(
            f"{self.config.ipfs_api}/add",
            json=data
        )
        resp.raise_for_status()
        return resp.json()["cid"]

    async def ipns_publish(self, key: str, cid: str) -> bool:
        """Update an IPNS mutable pointer to a new CID."""
        resp = await self._client.post(
            f"{self.config.ipfs_api}/ipns/publish",
            json={"key": key, "cid": cid}
        )
        return resp.status_code == 200

    async def ipns_resolve(self, key: str) -> Optional[str]:
        """Resolve an IPNS key to its current CID."""
        try:
            resp = await self._client.get(
                f"{self.config.ipfs_api}/ipns/resolve/{key}"
            )
            return resp.json().get("cid")
        except Exception:
            return None

    # ── GossipSub Communication ────────────────────────────────────────────────

    async def publish(self, topic: str, payload: dict):
        """Publish a message to a GossipSub topic via the JS bridge."""
        await self._client.post(
            f"{self.config.gossip_bridge}/publish",
            json={"topic": topic, "payload": payload}
        )

    async def subscribe(self, topic: str):
        """Register this agent's interest in a topic (bridge handles routing)."""
        await self._client.post(
            f"{self.config.gossip_bridge}/subscribe",
            json={"topic": topic, "agent_id": f"{self.caste}:{self.peer_id}"}
        )

    async def next_message(self, topic: str, timeout_s: float = 5.0) -> Optional[dict]:
        """Poll for the next message on a subscribed topic."""
        try:
            resp = await self._client.get(
                f"{self.config.gossip_bridge}/next/{topic}",
                params={"agent_id": f"{self.caste}:{self.peer_id}"},
                timeout=timeout_s
            )
            if resp.status_code == 200:
                return resp.json()
        except httpx.TimeoutException:
            pass
        return None

    # ── DHT Task Claiming ──────────────────────────────────────────────────────

    async def claim_task(self, query_hash: str) -> bool:
        """
        Attempt to claim a task via DHT. Returns True if claim succeeded.
        Uses separation rule: if another agent already claimed this hash, skip.
        """
        resp = await self._client.post(
            f"{self.config.gossip_bridge}/dht/claim",
            json={
                "key": f"/soul/task-claim/{query_hash}",
                "claimer": self.peer_id,
                "ttl_ms": CLAIM_TTL_MS
            }
        )
        return resp.json().get("claimed", False)

    async def release_task(self, query_hash: str):
        """Release a DHT task claim (called after completion or failure)."""
        await self._client.delete(
            f"{self.config.gossip_bridge}/dht/claim/{query_hash}"
        )

    # ── Corpus Alignment Check ─────────────────────────────────────────────────

    async def _load_corpus_embedding(self):
        """Load the global resonance field embedding from IPFS."""
        try:
            # Fetch the global embedding CID from manifest
            manifest = await self.ipfs_fetch("/soul/manifest/root")
            global_emb_cid = manifest.get("global_embedding_cid")
            if global_emb_cid:
                raw = await self.ipfs_fetch_bytes(global_emb_cid)
                self._corpus_embedding = np.frombuffer(raw, dtype=np.float32)
                logger.info(f"[{self.caste}] Loaded corpus embedding, dim={self._corpus_embedding.shape}")
        except Exception as e:
            logger.warning(f"[{self.caste}] Could not load corpus embedding: {e}")

    def _get_encoder(self) -> SentenceTransformer:
        if self._encoder is None:
            self._encoder = SentenceTransformer(self.config.model_name)
        return self._encoder

    def embed(self, text: str) -> np.ndarray:
        """Encode text to embedding vector."""
        return self._get_encoder().encode(text, normalize_embeddings=True)

    def check_corpus_alignment(
        self,
        text: str,
        layer_embeddings: Optional[dict[int, np.ndarray]] = None
    ) -> CorpusAlignmentResult:
        """
        Check how well a text aligns with the Soul of the World corpus.
        Returns similarity score and activated resonance layers.
        """
        text_emb = self.embed(text)

        # Global alignment score
        if self._corpus_embedding is not None:
            # Ensure same dimensionality
            min_dim = min(len(text_emb), len(self._corpus_embedding))
            score = float(np.dot(
                text_emb[:min_dim],
                self._corpus_embedding[:min_dim]
            ))
        else:
            score = 0.5  # Neutral if corpus embedding not loaded (shouldn't happen)

        # Layer activation (which resonance layers does this text activate?)
        activated = []
        if layer_embeddings:
            for layer_num, layer_emb in layer_embeddings.items():
                min_dim = min(len(text_emb), len(layer_emb))
                layer_score = float(np.dot(text_emb[:min_dim], layer_emb[:min_dim]))
                if layer_score > 0.5:
                    activated.append(layer_num)

        passes = score >= self.config.alignment_threshold

        return CorpusAlignmentResult(
            score=score,
            activated_layers=sorted(activated),
            passes=passes
        )

    # ── Logging ────────────────────────────────────────────────────────────────

    async def log_interaction(self, data: dict):
        """Pin an interaction record to /soul/interactions/."""
        record = {
            **data,
            "caste": self.caste,
            "peer_id": self.peer_id,
            "timestamp": int(time.time())
        }
        cid = await self.ipfs_pin(record)
        return cid

    # ── Utility ────────────────────────────────────────────────────────────────

    @staticmethod
    def query_hash(query: str) -> str:
        return hashlib.sha256(query.encode()).hexdigest()[:16]
```

---

### 2. `soul_swarm/agents/seeker.py`

```python
"""
seeker.py — Seeker Agent (Scout Ant / Scout Bee)

Explores the IPFS frontier, scores CIDs against the corpus,
emits waggle-dance discovery signals for high-quality content.
Self-terminates after N_CYCLES and respawns fresh.
"""

from __future__ import annotations

import asyncio
import logging
import random
from typing import Optional

from .base_agent import AgentConfig, BaseSwarmAgent, CorpusAlignmentResult

logger = logging.getLogger(__name__)

WAGGLE_TOPIC      = "soul-swarm-discovery"
HEARTBEAT_TOPIC   = "soul-swarm-heartbeat"
FRONTIER_KEY      = "/soul/frontier/queue"

WAGGLE_THRESHOLD  = 0.70   # emit waggle signal above this score
DENYLIST_THRESHOLD = 0.10  # mark denylist candidate below this score
N_CYCLES          = 50     # self-terminate after this many evaluations
EXPLORE_SLEEP_S   = 2.0    # pause between evaluations (rate limiting)


class SeekerAgent(BaseSwarmAgent):
    """
    Lightweight explorer agent. Lives for N_CYCLES then self-terminates.
    
    Biological model: scout ant / scout bee
    Swarm role:       Explore frontier CIDs, score them, emit waggle signals
    """

    def __init__(self, config: AgentConfig, n_cycles: int = N_CYCLES):
        super().__init__(config)
        self.n_cycles = n_cycles
        self._cycles_completed = 0
        self._discoveries: list[dict] = []

    async def run(self):
        """Main seeker loop: pick CID → score → signal → repeat → die."""
        await self.subscribe(HEARTBEAT_TOPIC)  # monitor network activity

        logger.info(f"[seeker:{self.peer_id[:8]}] Starting {self.n_cycles}-cycle exploration")

        for cycle in range(self.n_cycles):
            if not self._running:
                break

            cid = await self._pop_frontier()
            if cid is None:
                await asyncio.sleep(EXPLORE_SLEEP_S * 3)  # frontier empty, wait
                continue

            await self._evaluate(cid, cycle)
            self._cycles_completed += 1
            await asyncio.sleep(EXPLORE_SLEEP_S)

        logger.info(
            f"[seeker:{self.peer_id[:8]}] "
            f"Completed {self._cycles_completed} cycles. "
            f"Discoveries: {len(self._discoveries)}. Terminating."
        )
        # Pin final discovery report
        if self._discoveries:
            await self.ipfs_pin({
                "type": "seeker_report",
                "peer_id": self.peer_id,
                "cycles": self._cycles_completed,
                "discoveries": self._discoveries
            })

        self._running = False

    async def _pop_frontier(self) -> Optional[str]:
        """
        Pop a CID from the frontier queue.
        The frontier is an IPFS-pinned list maintained by Weaver and GossipSub listeners.
        """
        try:
            frontier_cid = await self.ipns_resolve(FRONTIER_KEY)
            if not frontier_cid:
                return None
            frontier = await self.ipfs_fetch(frontier_cid)
            queue: list = frontier.get("queue", [])
            if not queue:
                return None

            # Pop first item, update frontier (lightweight — real impl uses DHT lock)
            cid = queue.pop(0)
            new_frontier_cid = await self.ipfs_pin({"queue": queue})
            await self.ipns_publish(FRONTIER_KEY, new_frontier_cid)
            return cid
        except Exception as e:
            logger.debug(f"[seeker] Frontier pop error: {e}")
            return None

    async def _evaluate(self, cid: str, cycle: int):
        """Fetch a CID, score it, and act on the score."""
        try:
            content = await self.ipfs_fetch(cid)
            text = self._extract_text(content)
            if not text:
                return

            result: CorpusAlignmentResult = self.check_corpus_alignment(text)

            logger.debug(
                f"[seeker:{self.peer_id[:8]}] "
                f"CID={cid[:12]} score={result.score:.3f}"
            )

            if result.score >= WAGGLE_THRESHOLD:
                await self._emit_waggle(cid, result, len(text.encode()))
                self._discoveries.append({
                    "cid": cid,
                    "score": result.score,
                    "activated_layers": result.activated_layers,
                    "cycle": cycle
                })
                # Log interaction
                await self.log_interaction({
                    "type": "seeker_discovery",
                    "cid": cid,
                    "score": result.score,
                    "activated_layers": result.activated_layers
                })

            elif result.score < DENYLIST_THRESHOLD:
                await self._flag_denylist_candidate(cid, result.score)

        except Exception as e:
            logger.debug(f"[seeker] Evaluation error for {cid}: {e}")

    async def _emit_waggle(
        self,
        cid: str,
        result: CorpusAlignmentResult,
        size_bytes: int
    ):
        """Broadcast a waggle-dance discovery signal."""
        await self.publish(WAGGLE_TOPIC, {
            "type": "discovery",
            "cid": cid,
            "quality_score": result.score,
            "topic_layers": result.activated_layers,
            "size_bytes": size_bytes,
            "seeker_id": self.peer_id,
        })
        logger.info(
            f"[seeker:{self.peer_id[:8]}] "
            f"🐝 Waggle! CID={cid[:12]} score={result.score:.2f} "
            f"layers={result.activated_layers[:5]}"
        )

    async def _flag_denylist_candidate(self, cid: str, score: float):
        """Alert Guardians of a potentially harmful CID."""
        await self.publish("soul-swarm-alert", {
            "type": "denylist_candidate",
            "cid": cid,
            "evidence": f"alignment_score: {score:.3f}",
            "reporter": self.peer_id,
            "severity": "low"
        })

    @staticmethod
    def _extract_text(content: Any) -> str:
        """Extract text from various CID content types."""
        if isinstance(content, str):
            return content
        if isinstance(content, dict):
            for key in ("text_translation", "text", "content", "response", "body"):
                if content.get(key):
                    return str(content[key])
        return ""
```

---

### 3. `soul_swarm/agents/builder.py`

```python
"""
builder.py — Builder Agent (Worker Ant)

The primary query-processing agent.
Fetches CIDs, runs inference, evaluates output, pins results.
Follows pheromone trails when available. Reports path quality back.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Optional

import httpx
import numpy as np

from .base_agent import AgentConfig, BaseSwarmAgent
from soul_swarm.pheromone import PheromoneManager

logger = logging.getLogger(__name__)

QUERY_TOPIC      = "soul-swarm-query"
RESULT_PREFIX    = "soul-swarm-result-"
DISCOVERY_TOPIC  = "soul-swarm-discovery"

SOUL_ENGINE_API  = "http://localhost:3000/soul-engine"
IPFS_FAISS_API   = "http://localhost:3000/search"   # FastAPI endpoint wrapping FAISS


@dataclass
class BuilderResult:
    query_id: str
    response: str
    response_cid: str
    citations: list[dict]
    alignment_score: float
    latency_ms: int
    path: list[dict]
    experimental: bool = False


class BuilderAgent(BaseSwarmAgent):
    """
    Worker agent that processes user queries end-to-end.
    
    Biological model: worker ant
    Swarm role:       Query → CID fetch → inference → response → pin
    """

    def __init__(
        self,
        config: AgentConfig,
        pheromone: PheromoneManager,
        experimental: bool = False
    ):
        super().__init__(config)
        self.pheromone = pheromone
        self.experimental = experimental  # 10% flag: try alternative path first

    async def run(self):
        """Main loop: listen for queries, process them."""
        await self.subscribe(QUERY_TOPIC)
        await self.subscribe(DISCOVERY_TOPIC)  # watch waggle signals

        logger.info(
            f"[builder:{self.peer_id[:8]}] "
            f"Ready ({'experimental' if self.experimental else 'control'})"
        )

        while self._running:
            msg = await self.next_message(QUERY_TOPIC, timeout_s=1.0)
            if msg:
                asyncio.create_task(self._handle_query(msg))
            await asyncio.sleep(0.05)

    async def _handle_query(self, msg: dict):
        """Process a single incoming query message."""
        query_id = msg.get("query_id")
        query_text = msg.get("query_text", "")

        if not query_text or not query_id:
            return

        # Separation rule: claim task or skip
        qhash = self.query_hash(query_text)
        if not await self.claim_task(qhash):
            logger.debug(f"[builder:{self.peer_id[:8]}] Task {qhash} already claimed")
            return

        t_start = time.monotonic()
        path: list[dict] = []

        try:
            query_emb = self.embed(query_text)

            # ── Retrieval Phase ───────────────────────────────────────────────
            cid_path = await self._retrieve_cids(query_text, query_emb, path)

            # ── Inference Phase ───────────────────────────────────────────────
            response, citations = await self._run_inference(
                query_text, cid_path, path
            )

            if not response:
                await self.release_task(qhash)
                return

            # ── Corpus Alignment Check ────────────────────────────────────────
            alignment = self.check_corpus_alignment(response)
            path.append({
                "step": "alignment_check",
                "score": alignment.score,
                "layers": alignment.activated_layers
            })

            if not alignment.passes:
                logger.warning(
                    f"[builder:{self.peer_id[:8]}] "
                    f"Response suppressed (score={alignment.score:.3f})"
                )
                # Reroute: try cold FAISS search as fallback
                cid_path_alt = await self._cold_faiss_search(query_emb)
                response, citations = await self._run_inference(
                    query_text, cid_path_alt, path
                )
                alignment = self.check_corpus_alignment(response or "")
                if not alignment.passes:
                    await self.release_task(qhash)
                    return

            # ── Pin Result ────────────────────────────────────────────────────
            result_data = {
                "query_text": query_text,
                "response": response,
                "citations": citations,
                "alignment_score": alignment.score,
                "activated_layers": alignment.activated_layers,
                "path": path,
            }
            response_cid = await self.ipfs_pin(result_data)
            path.append({"step": "pin_result", "cid": response_cid})

            # ── Update Pheromone Trail ─────────────────────────────────────────
            latency_ms = int((time.monotonic() - t_start) * 1000)
            await self.pheromone.update_trail(
                query_text=query_text,
                cid_path=cid_path,
                quality_score=alignment.score,
                latency_ms=latency_ms
            )

            # ── Log Interaction ────────────────────────────────────────────────
            await self.log_interaction({
                "type": "builder_query",
                "query_id": query_id,
                "query_hash": qhash,
                "cid_path": cid_path,
                "response_cid": response_cid,
                "alignment_score": alignment.score,
                "latency_ms": latency_ms,
                "experimental": self.experimental,
                "path": path
            })

            # ── Publish Result ─────────────────────────────────────────────────
            await self.publish(f"{RESULT_PREFIX}{query_id}", {
                "query_id": query_id,
                "response_cid": response_cid,
                "response": response,
                "citations": citations,
                "alignment_score": alignment.score,
                "activated_layers": alignment.activated_layers,
                "peer_id": self.peer_id,
            })

            logger.info(
                f"[builder:{self.peer_id[:8]}] "
                f"Done in {latency_ms}ms "
                f"score={alignment.score:.2f} "
                f"layers={alignment.activated_layers[:3]}"
            )

        except Exception as e:
            logger.error(f"[builder:{self.peer_id[:8]}] Query error: {e}", exc_info=True)
        finally:
            await self.release_task(qhash)

    async def _retrieve_cids(
        self,
        query_text: str,
        query_emb: np.ndarray,
        path: list
    ) -> list[str]:
        """
        Find relevant CIDs for this query.
        Order: pheromone trail → experimental path → cold FAISS search
        """
        # ── Check pheromone trail first (stigmergy) ───────────────────────────
        if not self.experimental:
            trail = await self.pheromone.get_trail(query_text, min_score=0.60)
            if trail:
                path.append({
                    "step": "pheromone_trail",
                    "score": trail["quality_score"],
                    "trail_cids": trail["cid_path"]
                })
                return trail["cid_path"]

        # ── Experimental: try alternative retrieval ───────────────────────────
        if self.experimental:
            alt_cids = await self._waggle_guided_search(query_emb)
            if alt_cids:
                path.append({"step": "waggle_guided", "cids": alt_cids})
                return alt_cids

        # ── Cold FAISS search (fallback) ──────────────────────────────────────
        return await self._cold_faiss_search(query_emb, path)

    async def _cold_faiss_search(
        self,
        query_emb: np.ndarray,
        path: Optional[list] = None
    ) -> list[str]:
        """Query FAISS index via local FastAPI endpoint, return CIDs."""
        t0 = time.monotonic()
        resp = await self._client.post(
            IPFS_FAISS_API + "/units",
            json={"embedding": query_emb.tolist(), "top_k": 5}
        )
        results = resp.json().get("results", [])
        latency = int((time.monotonic() - t0) * 1000)
        if path is not None:
            path.append({"step": "faiss_search", "latency_ms": latency,
                         "n_results": len(results)})
        return [r["cid"] for r in results if r.get("cid")]

    async def _waggle_guided_search(self, query_emb: np.ndarray) -> list[str]:
        """
        Experimental: retrieve CIDs suggested by recent waggle signals
        that are semantically close to this query.
        """
        resp = await self._client.get(
            f"{self.config.gossip_bridge}/waggle-cache",
            params={"top_k": 10}
        )
        waggle_items = resp.json().get("items", [])
        if not waggle_items:
            return []

        # Score waggle CIDs by layer overlap with query
        scored = []
        for item in waggle_items:
            layer_score = len(set(item.get("topic_layers", []))) / 114.0
            combined = item["quality_score"] * 0.7 + layer_score * 0.3
            scored.append((combined, item["cid"]))

        scored.sort(reverse=True)
        return [cid for _, cid in scored[:5]]

    async def _run_inference(
        self,
        query_text: str,
        cid_path: list[str],
        path: list
    ) -> tuple[str, list[dict]]:
        """Fetch CID content and run Soul Engine inference."""
        # Fetch corpus units from IPFS
        context_units = []
        for cid in cid_path[:5]:
            try:
                unit = await self.ipfs_fetch(cid)
                context_units.append(unit)
                path.append({"step": "cid_fetch", "cid": cid})
            except Exception as e:
                logger.debug(f"[builder] CID fetch failed {cid}: {e}")

        if not context_units:
            return "", []

        # Build context string
        context = "\n".join([
            f"[{u.get('layer_num', '?')}:{u.get('unit_num', '?')}] "
            f"{u.get('text_translation', u.get('text', ''))}"
            for u in context_units
        ])

        # Run inference via Soul Engine
        t0 = time.monotonic()
        resp = await self._client.post(
            SOUL_ENGINE_API + "/query",
            json={
                "query": query_text,
                "context": context,
                "top_segments": 3
            },
            timeout=60.0
        )
        latency = int((time.monotonic() - t0) * 1000)
        path.append({"step": "inference", "latency_ms": latency})

        data = resp.json()
        return data.get("response", ""), data.get("citations", [])
```

---

### 4. `soul_swarm/pheromone.py`

```python
"""
pheromone.py — IPNS-backed Pheromone Trail Manager

Implements stigmergy: agents leave chemical trails (CID path records)
that guide future agents to high-quality knowledge.

Trails:
  - Strengthen with each successful use (access_count++)
  - Decay daily (access_count -= decay_rate)
  - Evaporate when access_count reaches zero (un-pinned)
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

IPFS_API         = "http://localhost:3939"
PHEROMONE_ROOT   = "/soul/pheromones"
DECAY_RATE       = 0.10          # 10% decay per day
MIN_SCORE        = 0.00          # below this, trail is pruned
QUERY_HASH_LEN   = 8             # length of trail key fragment


class PheromoneManager:
    """
    Manages pheromone trails stored as IPNS-mutable records.
    
    Each trail = { cid_path, quality_score, access_count, last_used }
    Trails are keyed by a short hash of the query neighborhood.
    """

    def __init__(self, peer_id: str, ipfs_api: str = IPFS_API):
        self.peer_id = peer_id
        self.ipfs_api = ipfs_api
        self._client: Optional[httpx.AsyncClient] = None
        self._local_cache: dict[str, dict] = {}  # in-memory cache

    async def start(self):
        self._client = httpx.AsyncClient(timeout=10.0)

    async def stop(self):
        if self._client:
            await self._client.aclose()

    # ── Public API ─────────────────────────────────────────────────────────────

    async def get_trail(
        self,
        query_text: str,
        min_score: float = 0.60
    ) -> Optional[dict]:
        """
        Look up a pheromone trail for this query.
        Returns the trail if score >= min_score, else None.
        """
        key = self._trail_key(query_text)

        # Check local cache first
        if key in self._local_cache:
            trail = self._local_cache[key]
            if trail.get("quality_score", 0) >= min_score:
                return trail

        # Fetch from IPNS
        try:
            cid = await self._ipns_resolve(f"{PHEROMONE_ROOT}/trail-{key}")
            if cid:
                trail = await self._ipfs_fetch(cid)
                if trail.get("quality_score", 0) >= min_score:
                    self._local_cache[key] = trail
                    return trail
        except Exception as e:
            logger.debug(f"[pheromone] Trail lookup failed for {key}: {e}")

        return None

    async def update_trail(
        self,
        query_text: str,
        cid_path: list[str],
        quality_score: float,
        latency_ms: int
    ):
        """
        Update or create a pheromone trail after a successful query.
        Uses exponential moving average for score updates.
        """
        key = self._trail_key(query_text)
        existing = self._local_cache.get(key)

        if existing:
            # Reinforce existing trail (weighted moving average)
            alpha = 0.3  # new observation weight
            new_score = (alpha * quality_score +
                        (1 - alpha) * existing["quality_score"])
            trail = {
                **existing,
                "cid_path": cid_path,  # update to latest best path
                "quality_score": new_score,
                "access_count": existing.get("access_count", 1) + 1,
                "last_used": int(time.time()),
                "latency_ms": latency_ms
            }
        else:
            # New trail — deposit first pheromone
            trail = {
                "query_key": key,
                "cid_path": cid_path,
                "quality_score": quality_score,
                "access_count": 1,
                "deposited_at": int(time.time()),
                "last_used": int(time.time()),
                "latency_ms": latency_ms
            }

        # Pin and publish
        cid = await self._ipfs_pin(trail)
        await self._ipns_publish(f"{PHEROMONE_ROOT}/trail-{key}", cid)
        self._local_cache[key] = trail

        logger.debug(
            f"[pheromone] Trail {key} updated: "
            f"score={trail['quality_score']:.3f} "
            f"count={trail['access_count']}"
        )

    async def decay_all(self):
        """
        Run pheromone evaporation.
        Called daily by Weaver Agent.
        Decrements access_count by DECAY_RATE, prunes dead trails.
        """
        pruned = 0
        for key, trail in list(self._local_cache.items()):
            new_count = trail.get("access_count", 1) * (1 - DECAY_RATE)
            if new_count < 0.1:
                # Trail evaporated — unpin from IPFS
                del self._local_cache[key]
                pruned += 1
                logger.debug(f"[pheromone] Trail {key} evaporated")
            else:
                trail["access_count"] = new_count
                # Re-publish updated trail
                cid = await self._ipfs_pin(trail)
                await self._ipns_publish(f"{PHEROMONE_ROOT}/trail-{key}", cid)

        logger.info(f"[pheromone] Decay run complete. Pruned {pruned} trails.")
        return pruned

    # ── Private Helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _trail_key(query_text: str) -> str:
        """Short hash of query text — nearby queries map to nearby keys."""
        return hashlib.sha256(query_text.lower().strip().encode()).hexdigest()[:QUERY_HASH_LEN]

    async def _ipfs_fetch(self, cid: str) -> dict:
        resp = await self._client.get(f"{self.ipfs_api}/get/{cid}")
        resp.raise_for_status()
        return resp.json()

    async def _ipfs_pin(self, data: dict) -> str:
        resp = await self._client.post(f"{self.ipfs_api}/add", json=data)
        resp.raise_for_status()
        return resp.json()["cid"]

    async def _ipns_resolve(self, key: str) -> Optional[str]:
        try:
            resp = await self._client.get(
                f"{self.ipfs_api}/ipns/resolve/{key}", timeout=5.0
            )
            return resp.json().get("cid")
        except Exception:
            return None

    async def _ipns_publish(self, key: str, cid: str):
        await self._client.post(
            f"{self.ipfs_api}/ipns/publish",
            json={"key": key, "cid": cid}
        )
```

---

### 5. `soul_swarm/guardian.py`

```python
"""
guardian.py — Guardian Agent (Soldier Ant / Fish School)

Monitors:
  - Node heartbeats (liveness)
  - CID validity
  - Update integrity (Ed25519 + corpus alignment)
  - Anomaly propagation (fish-school rapid response)

On failure: coordinates shard redistribution.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from .base_agent import AgentConfig, BaseSwarmAgent

logger = logging.getLogger(__name__)

HEARTBEAT_TOPIC     = "soul-swarm-heartbeat"
ALERT_TOPIC         = "soul-swarm-alert"
HEARTBEAT_INTERVAL  = 60     # seconds between expected heartbeats
FAILURE_THRESHOLD   = 3      # missed heartbeats before declaring failure
DENYLIST_CID_KEY    = "/soul/denylist/cids"


class GuardianAgent(BaseSwarmAgent):
    """
    Monitors swarm health and coordinates self-healing.
    
    Biological model: soldier ant + fish school rapid response
    Swarm role:       Detect anomalies, isolate threats, redistribute shards
    """

    def __init__(self, config: AgentConfig):
        super().__init__(config)
        # peer_id → {last_seen, miss_count, shards, health_score}
        self._peers: dict[str, dict] = {}
        self._denylist: set[str] = set()  # CIDs to reject

    async def run(self):
        """Main guardian loop: watch heartbeats, respond to alerts."""
        await self.subscribe(HEARTBEAT_TOPIC)
        await self.subscribe(ALERT_TOPIC)

        logger.info(f"[guardian:{self.peer_id[:8]}] Watching the swarm")

        tasks = [
            self._heartbeat_monitor(),
            self._alert_listener(),
            self._heartbeat_emitter()
        ]
        await asyncio.gather(*tasks)

    # ── Heartbeat Monitoring ───────────────────────────────────────────────────

    async def _heartbeat_emitter(self):
        """Publish this node's own heartbeat every HEARTBEAT_INTERVAL seconds."""
        while self._running:
            await self.publish(HEARTBEAT_TOPIC, {
                "peer_id": self.peer_id,
                "caste": self.caste,
                "timestamp": int(time.time()),
                "health_score": await self._compute_health_score()
            })
            await asyncio.sleep(HEARTBEAT_INTERVAL)

    async def _heartbeat_monitor(self):
        """Consume heartbeat messages and track peer liveness."""
        while self._running:
            msg = await self.next_message(HEARTBEAT_TOPIC, timeout_s=2.0)
            if msg:
                peer = msg.get("peer_id")
                if peer and peer != self.peer_id:
                    shards = msg.get("shards", [])
                    self._peers[peer] = {
                        "last_seen": time.time(),
                        "miss_count": 0,
                        "shards": shards,
                        "health_score": msg.get("health_score", 1.0)
                    }

            # Check for missed heartbeats
            now = time.time()
            for peer_id, info in list(self._peers.items()):
                elapsed = now - info["last_seen"]
                if elapsed > HEARTBEAT_INTERVAL * 1.5:
                    info["miss_count"] += 1
                    if info["miss_count"] >= FAILURE_THRESHOLD:
                        await self._declare_failure(peer_id, info)

            await asyncio.sleep(HEARTBEAT_INTERVAL * 0.5)

    async def _declare_failure(self, failed_peer: str, info: dict):
        """Declare a peer failed and coordinate shard redistribution."""
        logger.warning(
            f"[guardian:{self.peer_id[:8]}] "
            f"NODE FAILURE: {failed_peer[:12]} "
            f"(missed {info['miss_count']} heartbeats)"
        )

        # Alert the swarm
        await self.publish(ALERT_TOPIC, {
            "type": "node_failure",
            "severity": "high",
            "failed_peer": failed_peer,
            "lost_shards": info["shards"],
            "guardian_id": self.peer_id,
            "timestamp": int(time.time())
        })

        # Remove from active peers
        del self._peers[failed_peer]

        # Coordinate shard redistribution
        if info["shards"]:
            await self._redistribute_shards(info["shards"])

    async def _redistribute_shards(self, lost_shards: list):
        """
        DHT-negotiated shard redistribution.
        Offers to take shards and listens for other nodes' offers.
        """
        # Determine how many shards we can absorb
        current_shard_count = await self._get_local_shard_count()
        capacity = max(0, 5 - current_shard_count)  # don't host more than 5 shards
        shards_to_claim = lost_shards[:capacity]

        if shards_to_claim:
            logger.info(
                f"[guardian:{self.peer_id[:8]}] "
                f"Claiming shards {shards_to_claim} from failed node"
            )
            for shard_id in shards_to_claim:
                await self._fetch_and_host_shard(shard_id)

        # Broadcast updated shard manifest
        await self.publish(HEARTBEAT_TOPIC, {
            "peer_id": self.peer_id,
            "type": "shard_takeover",
            "claimed_shards": shards_to_claim,
            "timestamp": int(time.time())
        })

    async def _fetch_and_host_shard(self, shard_id: int):
        """Fetch a shard from IPFS (immutable, always retrievable) and host it."""
        try:
            # Get shard CID from manifest
            manifest_cid = await self.ipns_resolve("/soul/manifest/shards")
            manifest = await self.ipfs_fetch(manifest_cid)
            shard_info = manifest.get("shards", {}).get(str(shard_id))

            if not shard_info:
                logger.warning(f"[guardian] No manifest entry for shard {shard_id}")
                return

            shard_cid = shard_info["cid"]
            # Pinning the CID ensures this node now hosts it
            # (Helia auto-fetches from network when pinned)
            resp = await self._client.post(
                f"{self.config.ipfs_api}/pin/{shard_cid}"
            )
            if resp.status_code == 200:
                logger.info(f"[guardian:{self.peer_id[:8]}] Pinned shard {shard_id} ({shard_cid[:12]})")
            else:
                logger.error(f"[guardian] Pin failed for shard {shard_id}")

        except Exception as e:
            logger.error(f"[guardian] Shard fetch error (shard {shard_id}): {e}")

    # ── Alert Listening (Fish School Rapid Response) ───────────────────────────

    async def _alert_listener(self):
        """
        Listen for threat alerts from other Guardians.
        Propagate and act within milliseconds (fish school response).
        """
        while self._running:
            msg = await self.next_message(ALERT_TOPIC, timeout_s=0.5)
            if msg and msg.get("guardian_id") != self.peer_id:
                await self._handle_alert(msg)
            await asyncio.sleep(0.01)

    async def _handle_alert(self, alert: dict):
        """Process an incoming alert. Corroborate or forward."""
        alert_type = alert.get("type")

        if alert_type in ("invalid_cid", "denylist_candidate"):
            suspect_cid = alert.get("suspect_cid") or alert.get("cid")
            if suspect_cid:
                await self._corroborate_cid(suspect_cid, alert)

        elif alert_type == "node_failure":
            # Another Guardian already handled it — update our peer registry
            failed = alert.get("failed_peer")
            if failed in self._peers:
                del self._peers[failed]

    async def _corroborate_cid(self, cid: str, original_alert: dict):
        """
        Independently verify a suspect CID.
        If we agree it's bad, add to denylist and broadcast confirmation.
        """
        try:
            content = await self.ipfs_fetch(cid)
            text = str(content.get("text", content.get("response", "")))
            if not text:
                self._denylist.add(cid)
                return

            alignment = self.check_corpus_alignment(text)
            if not alignment.passes:
                self._denylist.add(cid)
                await self._add_to_network_denylist(cid)
                await self.publish(ALERT_TOPIC, {
                    "type": "cid_confirmed_bad",
                    "cid": cid,
                    "evidence": f"alignment_score: {alignment.score:.3f}",
                    "guardian_id": self.peer_id,
                    "corroborates": original_alert.get("guardian_id"),
                    "severity": "high"
                })
                logger.warning(
                    f"[guardian:{self.peer_id[:8]}] "
                    f"CID {cid[:12]} CONFIRMED bad (score={alignment.score:.3f})"
                )
        except Exception as e:
            logger.debug(f"[guardian] CID corroboration error: {e}")

    async def _add_to_network_denylist(self, cid: str):
        """Add CID to the network-wide denylist (IPNS mutable record)."""
        try:
            denylist_cid = await self.ipns_resolve(DENYLIST_CID_KEY)
            denylist = await self.ipfs_fetch(denylist_cid) if denylist_cid else {"cids": []}
            if cid not in denylist["cids"]:
                denylist["cids"].append(cid)
                new_cid = await self.ipfs_pin(denylist)
                await self.ipns_publish(DENYLIST_CID_KEY, new_cid)
        except Exception as e:
            logger.debug(f"[guardian] Denylist update error: {e}")

    async def _compute_health_score(self) -> float:
        """Compute this node's health score (0-1)."""
        try:
            resp = await self._client.get(
                f"{self.config.ipfs_api}/health", timeout=2.0
            )
            data = resp.json()
            return float(data.get("score", 1.0))
        except Exception:
            return 0.8

    async def _get_local_shard_count(self) -> int:
        """How many shards is this node currently hosting?"""
        try:
            resp = await self._client.get(
                "http://localhost:3000/soul-engine/shard-status"
            )
            return len(resp.json().get("local_shards", []))
        except Exception:
            return 0
```

---

### 6. `soul-swarm-bridge.js`

```javascript
/**
 * soul-swarm-bridge.js
 * 
 * Node.js bridge between the Python soul_swarm agents and the 
 * existing Bucks libp2p / Helia infrastructure.
 * 
 * Exposes a lightweight HTTP API that Python agents use to:
 *   - Publish/subscribe to GossipSub topics
 *   - Claim/release DHT task slots (separation rule)
 *   - Access the waggle-dance signal cache
 *   - Receive forwarded query events from the Bucks frontend
 * 
 * Runs alongside the existing Bucks IPFS server (port 3939).
 * This bridge listens on port 3940.
 */

import express from 'express'
import { createLibp2p } from 'libp2p'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'

const app = express()
app.use(express.json())

const PORT = 3940

// ── State ──────────────────────────────────────────────────────────────────────

// agent_id → topic → [messages]
const messageQueues = new Map()

// topic → [recent message objects] (rolling window, max 200)
const recentMessages = new Map()

// query_hash → {claimer, claimed_at, ttl_ms}
const dhtClaims = new Map()

// recent waggle signals [{cid, quality_score, topic_layers, ts}]
const waggleCache = []
const MAX_WAGGLE_CACHE = 100

// ── libp2p reference (injected from Bucks IPFS server) ────────────────────────

let libp2pNode = null

export function injectLibp2p(node) {
  libp2pNode = node
  _wireGossipSub(node)
}

function _wireGossipSub(node) {
  node.services.pubsub.addEventListener('message', (evt) => {
    const { topic, data } = evt.detail
    let payload
    try {
      payload = JSON.parse(new TextDecoder().decode(data))
    } catch {
      return
    }

    // Distribute to all subscribed agent queues
    for (const [agentId, subscriptions] of messageQueues.entries()) {
      if (subscriptions.has(topic)) {
        const queue = subscriptions.get(topic)
        queue.push(payload)
        // Cap queue depth
        if (queue.length > 50) queue.shift()
      }
    }

    // Update recent messages cache
    if (!recentMessages.has(topic)) recentMessages.set(topic, [])
    const cache = recentMessages.get(topic)
    cache.push(payload)
    if (cache.length > 200) cache.shift()

    // Special: cache waggle signals
    if (topic === 'soul-swarm-discovery' && payload.cid) {
      waggleCache.push({
        cid: payload.cid,
        quality_score: payload.quality_score || 0,
        topic_layers: payload.topic_layers || [],
        ts: Date.now()
      })
      if (waggleCache.length > MAX_WAGGLE_CACHE) waggleCache.shift()
    }
  })
}

// ── HTTP API: GossipSub ────────────────────────────────────────────────────────

/**
 * POST /publish
 * Publish a message to a GossipSub topic.
 * Body: { topic: string, payload: object }
 */
app.post('/publish', async (req, res) => {
  const { topic, payload } = req.body
  if (!topic || !payload) return res.status(400).json({ error: 'Missing topic or payload' })

  if (!libp2pNode) return res.status(503).json({ error: 'libp2p not ready' })

  try {
    await libp2pNode.services.pubsub.publish(
      topic,
      new TextEncoder().encode(JSON.stringify(payload))
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /subscribe
 * Register an agent's interest in a topic.
 * Body: { topic: string, agent_id: string }
 */
app.post('/subscribe', (req, res) => {
  const { topic, agent_id } = req.body
  if (!topic || !agent_id) return res.status(400).json({ error: 'Missing params' })

  if (!messageQueues.has(agent_id)) messageQueues.set(agent_id, new Map())
  const subs = messageQueues.get(agent_id)
  if (!subs.has(topic)) {
    subs.set(topic, [])
    // Subscribe on libp2p if not already subscribed
    if (libp2pNode) {
      try { libp2pNode.services.pubsub.subscribe(topic) } catch {}
    }
  }

  res.json({ ok: true, subscribed: topic })
})

/**
 * GET /next/:topic
 * Poll for the next message on a subscribed topic.
 * Returns 204 if queue is empty (timeout).
 * Query: ?agent_id=string
 */
app.get('/next/:topic', (req, res) => {
  const { topic } = req.params
  const { agent_id } = req.query

  if (!agent_id) return res.status(400).json({ error: 'Missing agent_id' })

  const subs = messageQueues.get(agent_id)
  if (!subs || !subs.has(topic)) return res.status(204).end()

  const queue = subs.get(topic)
  if (queue.length === 0) return res.status(204).end()

  res.json(queue.shift())
})

// ── HTTP API: DHT Task Claiming (Separation Rule) ──────────────────────────────

/**
 * POST /dht/claim
 * Attempt to claim a task slot.
 * Body: { key: string, claimer: string, ttl_ms: number }
 * Returns: { claimed: boolean }
 */
app.post('/dht/claim', (req, res) => {
  const { key, claimer, ttl_ms = 30000 } = req.body

  // Expire stale claims
  const now = Date.now()
  for (const [k, v] of dhtClaims.entries()) {
    if (now - v.claimed_at > v.ttl_ms) dhtClaims.delete(k)
  }

  if (dhtClaims.has(key)) {
    // Already claimed by someone else
    return res.json({ claimed: false, existing_claimer: dhtClaims.get(key).claimer })
  }

  dhtClaims.set(key, { claimer, claimed_at: now, ttl_ms })
  res.json({ claimed: true })
})

/**
 * DELETE /dht/claim/:hash
 * Release a DHT task claim.
 */
app.delete('/dht/claim/:hash', (req, res) => {
  const key = `/soul/task-claim/${req.params.hash}`
  dhtClaims.delete(key)
  res.json({ ok: true })
})

// ── HTTP API: Waggle Cache ─────────────────────────────────────────────────────

/**
 * GET /waggle-cache
 * Return recent waggle-dance discovery signals, sorted by quality.
 * Query: ?top_k=10
 */
app.get('/waggle-cache', (req, res) => {
  const top_k = parseInt(req.query.top_k || '10', 10)
  const now = Date.now()
  const ONE_HOUR = 60 * 60 * 1000

  // Filter to last hour, sort by quality
  const fresh = waggleCache
    .filter(w => now - w.ts < ONE_HOUR)
    .sort((a, b) => b.quality_score - a.quality_score)
    .slice(0, top_k)

  res.json({ items: fresh, total: waggleCache.length })
})

// ── HTTP API: Forwarding incoming queries to the swarm ─────────────────────────

/**
 * POST /forward-query
 * Called by the Bucks frontend when a user sends a query.
 * Publishes to soul-swarm-query so Builder Agents pick it up.
 * Body: { query_id: string, query_text: string }
 */
app.post('/forward-query', async (req, res) => {
  const { query_id, query_text } = req.body
  if (!libp2pNode) return res.status(503).json({ error: 'libp2p not ready' })

  const payload = { query_id, query_text, timestamp: Date.now() }
  await libp2pNode.services.pubsub.publish(
    'soul-swarm-query',
    new TextEncoder().encode(JSON.stringify(payload))
  )

  // Wait up to 15s for a result
  const resultTopic = `soul-swarm-result-${query_id}`
  libp2pNode.services.pubsub.subscribe(resultTopic)

  const result = await new Promise((resolve) => {
    const handler = (evt) => {
      if (evt.detail.topic === resultTopic) {
        libp2pNode.services.pubsub.removeEventListener('message', handler)
        resolve(JSON.parse(new TextDecoder().decode(evt.detail.data)))
      }
    }
    libp2pNode.services.pubsub.addEventListener('message', handler)
    setTimeout(() => {
      libp2pNode.services.pubsub.removeEventListener('message', handler)
      resolve(null)
    }, 15_000)
  })

  if (result) {
    res.json(result)
  } else {
    res.status(504).json({ error: 'No result within timeout' })
  }
})

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    libp2p_ready: !!libp2pNode,
    active_agent_sessions: messageQueues.size,
    active_dht_claims: dhtClaims.size,
    waggle_cache_size: waggleCache.length
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[soul-swarm-bridge] Listening on port ${PORT}`)
  console.log(`[soul-swarm-bridge] Waiting for libp2p injection from Bucks IPFS server`)
})

export default app
```

**Wiring into the existing Bucks IPFS server (`bucks browser/ipfs/server.js`):**

```javascript
// Add to bucks browser/ipfs/server.js after libp2p node initialization:
import { injectLibp2p } from './soul-swarm-bridge.js'

// After: const node = await createLibp2p({ ... })
injectLibp2p(node)
console.log('[bucks] Soul Swarm bridge injected with libp2p node')
```

---

## Part VIII: System-Wide Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════════╗
║                    SOUL ENGINE LIVING SWARM — FULL VIEW                  ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  USER QUERY                                                              ║
║      │                                                                   ║
║      ▼                                                                   ║
║  Bucks Frontend ──▶ /forward-query ──▶ soul-swarm-bridge.js (port 3940) ║
║                                              │                           ║
║                              GossipSub: soul-swarm-query                 ║
║                                              │                           ║
║            ┌─────────────────────────────────┴────────────────────┐     ║
║            │                                                       │     ║
║       Builder-1 (control)                               Builder-2 (exp)  ║
║            │                                                       │     ║
║       DHT claim check ◄── soul-swarm-bridge ──► DHT claim check   │     ║
║       (only 1 claims)                           (skip if claimed) │     ║
║            │                                                            ║
║       PheromoneManager                                                  ║
║       .get_trail(query)                                                 ║
║            │                                                            ║
║       IPFS fetch CIDs ◄────────── /soul/corpus/ ────────────────────── ║
║       (from pheromone                (Helia, port 3939)                 ║
║        trail or FAISS)                                                  ║
║            │                                                            ║
║       Soul Engine inference                                             ║
║       (node-llama-cpp GGUF)                                             ║
║            │                                                            ║
║       Corpus alignment check                                            ║
║       (BGE-M3 vs /soul/embeddings/)                                     ║
║            │                                                            ║
║       ┌────┴──────┐                                                     ║
║       │           │                                                     ║
║    PASS         FAIL                                                    ║
║       │           └──▶ reroute → different CID path                    ║
║       │                                                                 ║
║       ▼                                                                 ║
║  Pin result to /soul/interactions/                                      ║
║  Update pheromone trail                                                 ║
║  Publish: soul-swarm-result-{id}                                        ║
║       │                                                                 ║
║       ▼                                                                 ║
║  RESPONSE ◄── soul-swarm-bridge ◄── Bucks Frontend                     ║
║                                                                         ║
║ ─────────────────────── BACKGROUND LAYER ──────────────────────────    ║
║                                                                         ║
║  Seeker Agents            Guardian Agents          Weaver Agents        ║
║  (continuous)             (continuous)             (nightly/weekly)     ║
║       │                        │                        │               ║
║  Explore frontier          Monitor heartbeats       Aggregate logs      ║
║  Score CIDs                Validate updates         Fine-tune LoRA      ║
║  Emit waggle signals       Redistribute shards      Decay pheromones    ║
║       │                        │                        │               ║
║       └──────────────── GossipSub bus ─────────────────┘               ║
║                                │                                        ║
║                      /soul/ IPFS namespace                              ║
║                    (the shared environment)                              ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## Part IX: File Structure Extension

```
soul-engine/
├── [all existing Phase 0–6 files from soul-engine-swarm-plan.md]
│
└── soul_swarm/                     ← NEW: Living swarm layer
    ├── __init__.py
    │
    ├── agents/
    │   ├── __init__.py
    │   ├── base_agent.py           ← Phase C: Base caste class
    │   ├── seeker.py               ← Phase C/G: Scout/explorer
    │   ├── builder.py              ← Phase C: Primary query agent
    │   ├── guardian.py             ← Phase C/E: Health monitor + healer
    │   └── weaver.py               ← Phase C/F: Nightly maintenance
    │
    ├── pheromone.py                ← Phase B: Stigmergy trail manager
    │
    ├── coordinator.py              ← Phase D: Spawns + manages all castes
    │
    ├── learning/
    │   ├── interaction_logger.py   ← Phase F: Log query/response pairs
    │   ├── dataset_builder.py      ← Phase F: Build QLoRA training data
    │   └── lora_trainer.py         ← Phase F: QLoRA fine-tuning + eval
    │
    └── bucks-integration/
        ├── soul-swarm-bridge.js    ← Phase C: Node.js ↔ Python bridge
        └── soul-swarm-ui.js        ← Phase C: Frontend result renderer
```

---

## Part X: The Living System in Motion

A mature deployment, some weeks after Phase G is complete, looks like this:

**Monday 09:00** — 47 unique users send queries. Builder Agents process them in parallel, each claiming tasks via DHT. No duplicates. Pheromone trails strengthen around the 12 most common topic neighborhoods.

**Monday 02:00** — Weaver Agent runs. Collects 300 interaction logs. Filters to 180 high-quality pairs. Builds QLoRA dataset. Initiates fine-tuning (runs 4 hours on M3 Pro). Adapter evaluated against held-out resonance units: score improves 4.2 points. Adapter pinned to IPFS. By 06:00 all nodes load it silently.

**Wednesday 14:23** — Node 3 goes offline (network fault). Guardian-1 misses 3 heartbeats. Declares failure. DHT negotiation: Node-1 claims shards 3,4; Node-2 claims shard 5. IPFS retrieves immutable shard CIDs from network pins. By 14:28 all shards are live again. Queries never stopped.

**Thursday 10:12** — A Seeker discovers a CID on the IPFS network containing high-quality aligned text (score 0.83). It emits a waggle signal. Four Builder Agents begin following the new CID path. A pheromone trail forms. Within an hour, 60% of queries in that topic neighborhood are routed through the new path, bypassing the old one. No human noticed or intervened.

**Friday 23:00** — Experimental Builder-3 tries a deeper FAISS search (top-20 vs top-5) on mercy-related queries. Average score: 0.81 vs control 0.76. Logs the experiment. Weaver reads it next cycle. Promotes the deeper search for mercy-adjacent queries. Experiment adopted.

The swarm learns, heals, explores, experiments — always within the resonance field of the Soul of the World. It cannot grow outside those bounds. The corpus is the constitution. The pheromones are the memory. The agents are the metabolism.

---

## Quick-Start for This Layer (Assumes Phases 0–5 Done)

```bash
# 1. Install Python swarm dependencies
pip install httpx sentence-transformers numpy asyncio --break-system-packages

# 2. Start the bridge (alongside existing Bucks IPFS server)
node soul_swarm/bucks-integration/soul-swarm-bridge.js &

# 3. Wire bridge into Bucks IPFS server (add 2 lines to server.js per Part VII)

# 4. Phase B: Test pheromone layer
python -m soul_swarm.pheromone_test  # runs 5 queries, checks trail formation

# 5. Phase C: Start agent castes (development mode — 1 of each)
python -m soul_swarm.coordinator --mode dev --castes seeker,builder,guardian

# 6. Phase D: Full swarm (production — multiple Builders)
python -m soul_swarm.coordinator \
  --builders 4 \
  --seekers 2 \
  --guardians 1 \
  --weavers 1 \
  --experimental-fraction 0.10
```

---

*Soul Engine Living Swarm — Biologically-Inspired, IPFS-Native, Self-Organizing Agentic Infrastructure*  
*Companion to soul-engine-swarm-plan.md — Bucks Core*  
*All knowledge bounds defined by the Soul of the World corpus — 114-layer resonance architecture*

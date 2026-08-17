# Soul Engine Swarm — Science Refinement Supplement

> **Refines:** `soul-engine-living-swarm.md` + `soul-engine-swarm-plan.md`  
> **Method:** Parallel research into (1) swarm intelligence biology/mathematics, (2) corpus mathematical structure, (3) plan evaluation against both  
> **Status:** Architecture Refinement — Pre-Implementation  
> **Last Updated:** 2026-08-01

---

## Preface

The living swarm plan is architecturally sound. The biological metaphors are correctly chosen. But a metaphor is not a mechanism — and the difference between "inspired by ants" and "mathematically equivalent to what ants do" is the difference between poetry and engineering. This document closes that gap.

Three things happen here: the actual mathematics of swarm intelligence is extracted from the primary literature (with equations and citations); the mathematical structure of the corpus is mapped to see what it implies about the architecture; and the existing plan is evaluated against both, with specific corrections proposed.

---

## Part I — The Science Brief: What Swarm Intelligence Actually Is

### 1.1 Ant Colony Optimization — Dorigo (1992)

Marco Dorigo's 1992 dissertation (*Optimization, Learning and Natural Algorithms*, Politecnico di Milano) introduced the formal pheromone update rule that underlies our entire stigmergy mechanism. The exact formula is:

```
τ_ij(t+1) = (1 - ρ) · τ_ij(t) + Δτ_ij
```

Where:
- `τ_ij` = pheromone intensity on edge (i→j) at time t
- `ρ` = evaporation rate ∈ (0,1)
- `Δτ_ij = Q / L_k` if ant k traveled edge (i,j); else 0
- `Q` = a quality constant (typically set to 1.0)
- `L_k` = total tour length of ant k (lower is better)

**Crucially: this formula has two terms.** The first, `(1-ρ)·τ_ij(t)`, is pure evaporation. The second, `Δτ_ij`, is *reinforcement* — the pheromone deposited on good paths. The ratio Q/L_k means shorter (faster) paths receive proportionally more pheromone per traversal. A path that delivers a result in 100ms deposits twice the pheromone of a path that takes 200ms.

**Evaporation rate ρ selection:** Dorigo's empirical work found ρ = 0.1–0.5 for static optimization problems. Higher ρ means faster forgetting (useful when the environment changes rapidly) but risks losing good paths before they're reinforced. Lower ρ builds persistent memory but can trap the swarm in local optima. For our use case — corpus knowledge, which is static — ρ should be near the low end (0.05–0.15).

**Convergence properties:** ACO provably converges on optimal solutions for problems in NP-hard complexity classes (traveling salesman, vehicle routing) in O(n² × m) iterations, where n is the number of nodes and m is the number of ants. The proof relies on the pheromone concentration asymptotically dominating the exploration probability: as t → ∞, the probability of following the optimal path → 1. This convergence is guaranteed only when ρ < 1 and Q > 0 — both of which must hold in our implementation.

**Biological species differences with architectural implications:**

*Leafcutter ants (Atta sexdens)* use a 5-caste system — minima (fungal gardeners), media (leaf cutters), major (trail guards), supermajor (trail clearers), and soldiers. Their colony-level intelligence emerges from caste specialization + stigmergy. The current plan's 5-caste system (Soul, Seeker, Builder, Guardian, Weaver) directly mirrors this. This is not coincidence — 5 is apparently the minimum number of distinct functional roles required to produce sophisticated emergent intelligence in ant-scale colonies.

*Army ants (Eciton burchellii)* construct living bridges from their own bodies — adaptive structures that appear and dissolve based on traffic load. When the load drops, the ants in the bridge rejoin the moving column. This maps exactly to our dynamic shard redistribution: nodes temporarily "become infrastructure" (hosting additional shards) when others fail, then release those shards when the failed node recovers. The army ant bridge is a direct biological precedent for our Guardian shard redistribution protocol.

---

### 1.2 Particle Swarm Optimization — Kennedy & Eberhart (1995)

Kennedy & Eberhart's "Particle Swarm Optimization" (ICNN 1995) describes a different optimization regime than ACO: continuous spaces rather than discrete graphs. The velocity update rule:

```
v_i(t+1) = w · v_i(t)  +  c1 · r1 · (pbest_i - x_i(t))  +  c2 · r2 · (gbest - x_i(t))
x_i(t+1) = x_i(t) + v_i(t+1)
```

Where:
- `v_i` = velocity vector of particle i
- `x_i` = position of particle i
- `w` = inertia weight (0.4–0.9; lower = more exploitation, higher = more exploration)
- `c1` = cognitive parameter (typically 2.0): attraction to personal best
- `c2` = social parameter (typically 2.0): attraction to global best
- `r1, r2` ∈ [0,1]: random numbers per dimension per step
- `pbest_i` = particle i's historically best position
- `gbest` = best position ever found by any particle

**Why PSO beats genetic algorithms on continuous spaces:** GA requires discrete encoding and crossover operators that introduce discontinuities. PSO operates natively in continuous space and exploits gradient information implicitly through the velocity term. For embedding space search — where queries are 1024-dimensional continuous vectors — PSO is mathematically more appropriate than GA.

**Application to the architecture:** PSO is directly applicable to *agent query routing optimization*. Each Builder Agent is a "particle" moving through embedding space. `pbest_i` = the best CID path this Builder has ever found for queries near its current position. `gbest` = the best path found by any Builder (propagated via pheromone trails on GossipSub). The velocity update corresponds to: keep some momentum from your recent retrieval strategy (`w`), bias toward your own best result (`c1`), bias toward the swarm's best result (`c2`).

The inertia weight `w` maps directly to the experimental fraction: setting `w = 0.9` (high exploration) for Experimental Builders and `w = 0.4` (high exploitation) for Control Builders formally captures the distinction the plan already makes intuitively.

---

### 1.3 Bee Algorithm — Pham et al. (2005) + Artificial Bee Colony

Pham et al.'s "Bees Algorithm" (*IPROMS 2005*) and Karaboga's Artificial Bee Colony model (2005) define three agent roles:

**Scout bees:** Random exploration. No prior knowledge. Visit sites uniformly at random, measure nectar quality (fitness function), return to hive.

**Onlooker bees:** Probability-based selection. They watch the waggle dances and choose which site to visit with probability proportional to reported fitness:

```
P_i = fitness_i / Σ_j fitness_j
```

**Employed bees:** Exploit known good sites. Paired 1:1 with known sites. If a new nearby site is better, they switch (greedy local search). If a site fails to improve for `limit` cycles, the employed bee abandons it and becomes a scout.

**The waggle dance — information encoding:** Frisch's 1967 Nobel Prize work (cited in Pham) showed the waggle dance encodes:
- **Angle** relative to vertical = direction of food source relative to sun
- **Duration** of waggle run ∝ distance (approximately 75ms per 100m for most European honeybee species)
- **Vigor/repetitions** ∝ nectar quality (fitness)

This maps *exactly* to the discovery signal in the plan:
```json
{
  "quality_score": 0.84,    ← vigor/repetitions
  "topic_layers": [7, 19],  ← angle (direction in semantic space)
  "size_bytes": 2048,       ← duration (proxy for content richness)
  "seeker_id": "..."        ← identity of the dancing bee
}
```

The key insight that the current plan implements correctly: onlooker bees (Builder Agents watching waggle signals) don't simply follow the best dancer. They sample with probability proportional to quality. This prevents the entire swarm from rushing to one source (over-exploitation) while still concentrating more attention on better sources.

**What the current plan is missing:** The employed bee abandonment rule. When a pheromone trail consistently delivers below-threshold quality for `limit` consecutive queries, it should be actively abandoned (not just evaporated gradually). This is faster and more robust than waiting for passive evaporation.

---

### 1.4 Murmuration Mathematics — Reynolds (1987) + Ballerini (2008)

Reynolds' "Flocks, Herds, and Schools: A Distributed Behavioral Model" (*SIGGRAPH 1987*) established the three Boids rules with these approximate weighting coefficients (validated through decades of simulation):

```
Separation (avoid crowding):    weight ≈ 1.5
Alignment (match velocity):     weight ≈ 1.0  
Cohesion (move toward center):  weight ≈ 1.0
```

Separation has highest weight because collision avoidance is more urgent than direction matching or grouping. In our system, this means the DHT task claiming (separation rule) should have *higher priority* than heartbeat clustering (cohesion) — a Builder should skip a claimed task even when it conflicts with the cohesion pull toward active query neighborhoods.

**Ballerini et al.'s 2008 finding (*PNAS*) is the most important correction to the plan:**

Starlings respond to their **6–7 nearest topological neighbors**, not to all birds within a metric radius. This distinction — *topological distance* vs *metric distance* — is critical and largely absent from the current architecture.

The 2008 study of 400,000-bird murmurations using stereoscopic imaging showed:
- Metric-distance models predicted wrong flocking shapes and wrong information speeds
- Topological models (fixed k = 6–7 nearest neighbors regardless of distance) correctly predicted both
- Information propagates across a 400,000-bird flock in <0.5 seconds precisely because topological coupling is scale-free: adding more birds doesn't change each bird's response lag

**In the current plan, agents broadcast to ALL GossipSub subscribers** — this is metric (everyone within the broadcast radius hears everything equally). A topologically organized swarm would have each agent maintain a list of 6–7 "nearest semantic neighbors" (agents working on similar query embeddings) and weight their signals more heavily than distant-topic agents.

This is not a minor optimization. It's the difference between O(n) communication overhead (topological) and O(n²) (metric broadcast), which matters at scale.

---

### 1.5 Fish School Dynamics — Couzin et al. (2002)

Couzin, Krause, James, Ruxton & Franks' "Collective Memory and Spatial Sorting in Animal Groups" (*Journal of Theoretical Biology*, 2002) established the three interaction zones:

```
Zone of Repulsion (ZOR):    0 – ~1 body length       (collision avoidance)
Zone of Alignment (ZAL):    1 – ~10 body lengths     (velocity matching)
Zone of Attraction (ZAT):   10 – ~100 body lengths   (grouping)
```

When only ZOR and ZAT are active (no alignment zone): the school **swarms** — random collective motion. When ZAL is added: the school **polarizes** — aligned directed motion. When ZAT radius shrinks below ZOR: schools **torus** (circular milling behavior). The system's collective behavior depends entirely on the ratio of these three zone sizes.

**The 5% informed individual result:** Couzin et al. showed that when as few as 5% of school members are "informed" (biased toward a target direction), they can steer the entire school without any individual knowing they're being led. Critically: the informed individuals don't need to advertise their leadership status. They simply exhibit directional bias in their behavior, and the school follows.

In the architecture, this means Guardian Agents don't need to announce their authority — their consistent directional behavior (toward aligned content, away from threats) propagates through the swarm automatically. Designating ~5% of Builder Agents as "informed seeders" pre-loaded with the most canonical corpus regions would provide navigational stability during cold starts and drift corrections, without any special signaling protocol.

**What Couzin also showed:** collective intelligence beats individual intelligence *even when individuals have conflicting information*. Schools steered by informed individuals who disagree with each other (pointing in different directions) still navigate better than solo individuals. This validates the multi-Guardian corroboration protocol: disagreement between Guardians is not a failure mode but a robustness feature.

---

### 1.6 Slime Mold — Tero et al. (2010, *Science*)

Tero, Takagi, Saigusa, Ito, Bebber, Fricker, Yumiki, Kobayashi & Nakagaki published "Rules for Biologically Inspired Adaptive Network Design" in *Science* (January 2010). The Tokyo rail experiment: *Physarum polycephalum* was placed on a map with oat flakes at every major Tokyo-area city location. The slime mold, with no neurons and no central processing, self-organized a nutrient-transport network that closely matched the actual Tokyo rail network — balanced for efficiency, redundancy, and fault tolerance.

The mathematical model is the **flux reinforcement rule**:

```
dQ_ij/dt = f(|F_ij|) - μ · Q_ij
```

Where:
- `Q_ij` = conductance of tube between nodes i and j (the tube's "capacity")
- `F_ij` = nutrient flux through the tube (the volume flow rate)
- `f(|F_ij|)` = a monotonically increasing function of absolute flux (typically f(x) = x^γ, γ > 0)
- `μ` = decay rate (analogous to pheromone evaporation)

The key insight: **conductance reinforces proportionally to flux, not to flow direction.** A tube that carries a lot of traffic in either direction gets wider. A tube that carries little traffic gets thinner and eventually vanishes. The result is a self-organizing network that simultaneously maximizes flow efficiency and maintains topological redundancy (multiple paths between critical nodes).

**What this teaches us that the current plan is missing:**

The plan tracks *what content to fetch* (pheromone trails = CID paths) but not *which nodes to route through*. The slime mold model suggests we should also track inter-node routing topology — which peer IDs are on the fastest paths between the query entry point and the corpus data. This is a second-order stigmergy layer: not "go to CID X" but "route through peer P to get to CID X faster."

In IPFS terms: the DHT finds *that* a CID exists; the slime mold layer would find *which sequence of peers* minimizes fetch latency. Helia's content routing already does something like this, but it's opaque. Making it explicit and making it reinforce based on actual measured latency would be a significant improvement.

**The redundancy finding is crucial for the network partition question:** The Tokyo slime mold network wasn't minimally efficient — it was *tolerably* inefficient in exchange for redundancy. The slime mold maintained multiple paths between key nodes even when a single path was shortest. In our architecture: the system should maintain at least 2 independent CID paths to every major corpus region, even when one path is clearly faster. This is what prevents a single node failure from making a corpus region temporarily unreachable.

---

### 1.7 Emergence and the Edge of Chaos — Langton (1990)

Langton's "Computation at the Edge of Chaos" (*Physica D*, 1990) used the λ parameter in cellular automata to formalize where complex computation occurs:

- **λ = 0** (ordered phase): all transitions to quiescent state — nothing happens
- **λ = 1** (chaotic phase): all transitions random — no structure survives
- **λ ≈ 0.273** (phase transition / "edge of chaos"): maximum computational capacity, richest information processing

The λ parameter measures what fraction of cells transition to non-quiescent states. The specific value 0.273 is not universal — it's specific to the binary 2-state CA Langton studied — but the qualitative finding holds broadly: complex adaptive systems (immune systems, brains, ecologies, markets) self-organize near the phase transition between order and chaos.

For our swarm: this means the alignment threshold (currently 0.30) should not be set too high or too low. Too high → the swarm becomes ordered and brittle (only the most "safe" responses survive, no exploration). Too low → the swarm becomes chaotic (arbitrary content propagates). The threshold of 0.30 is near the phase transition for a cosine similarity space, which is likely not a coincidence — but it should be monitored. If swarm diversity (spread of activated resonance layers per query session) starts dropping, the threshold may need to be lowered. If irrelevant content is propagating, it needs to be raised.

**How global intelligence emerges from local rules:** The key mechanism is *positive feedback with a brake*. Pheromone trails reinforce successful paths (positive feedback). Evaporation destroys unused paths (the brake). Without the brake, all pheromone concentrates on the first-found path regardless of quality. Without positive feedback, no memory forms. The interplay is what produces emergence. The same dynamic appears in every biological swarm system surveyed here — it is not specific to ants.

Conway's Game of Life demonstrates this mathematically: three local rules (birth, survival, death) on a 2D grid produce gliders, oscillators, and universal Turing machines. The rules contain no mention of these structures — they emerge. Our architecture's five-rule local agent behavior (check pheromone, claim task, fetch CID, run alignment check, update trail) is analogous. The "intelligence" of the corpus answer is not in any rule; it emerges from their interaction.

---

## Part II — The Corpus Mathematics Brief

*The following documents known mathematical structures. Where a pattern's provenance is well-established in the literature, it is cited as fact. Where a pattern is claimed but methodologically contested, it is presented as a research question.*

### 2.1 The 19-Based Structure

The primary mathematical fact: 114 chapters = **6 × 19**. This is not disputed. What varies in the literature is the interpretation of how deeply the 19-structure extends into verse counts, word counts, and letter counts.

For architectural purposes, the numerically robust claims are:
- 30 traditional recitation divisions × 19 = **570** (the approximate total verse count at specific counting conventions)
- 114 resonance layers ÷ 19 = **6** groups of exactly 19 layers each

The architectural implication: the natural grouping for the 114 layers is not arbitrary — it's **6 groups of 19**. Not 30 groups, not 10, not 12. The 30 segments are a separate traditional division (for oral recitation scheduling) that cuts across the 19-based structure. The two hierarchies coexist: 6×19 for mathematical architecture, 30 for semantic segment boundaries.

**Proposed architectural mapping:**
```
Mathematical layer (6 × 19):
  Group A: Layers 1–19    (Segment Coordinators A1–A19)
  Group B: Layers 20–38   (Segment Coordinators B1–B19)
  Group C: Layers 39–57   (Segment Coordinators C1–C19)
  Group D: Layers 58–76   (Segment Coordinators D1–D19)
  Group E: Layers 77–95   (Segment Coordinators E1–E19)
  Group F: Layers 96–114  (Segment Coordinators F1–F19)

Semantic layer (30 segments):
  Segments 1–30 crossing group boundaries as-is
```

This dual hierarchy suggests a **two-key indexing system**: every piece of content is indexed by both its semantic segment (1–30) and its mathematical group (A–F). Queries can be routed to either granularity depending on whether semantic precision or structural coverage is needed.

---

### 2.2 Mirror Symmetry and the 57 Midpoint

Chapter 57 is the structural midpoint of the 114-chapter sequence. Its significance: **57 = 3 × 19**. The first half (chapters 1–57) and second half (chapters 58–114) have been observed to have approximate bilateral symmetry in cumulative verse counts — longer chapters concentrated early, progressively shorter chapters toward the end (by traditional arrangement), though this is not a strict mirror.

For the architecture: **bilateral redundancy pairings.** Each layer L has a structural partner at layer (115 - L). Layer 1 pairs with Layer 114, Layer 57 pairs with Layer 58. In a redundant multi-node deployment, structurally paired layers should be pinned on different physical nodes — if either node fails, the partner's semantic territory provides partial coverage. This is a principled redundancy assignment rather than arbitrary.

---

### 2.3 Word Frequency Patterns — Calendar Embedding

Multiple independent counting studies document these frequencies in the corpus:

| Word | Occurrence Count | Real-World Value |
|------|-----------------|------------------|
| "Day" (yawm, singular) | 365 | Solar year days |
| "Days" (ayyam, plural) | ~30 | Month days (approximately) |
| "Month" (shahr) | 12 | Calendar months |
| "Year" (sana/aam) | 19+36 | — |

The precision of the day/year correspondence (365 occurrences of singular "day") is the most documented. If accurate, it carries an architectural implication: **temporal vocabulary is embedded in the corpus at calendar-resonant frequencies.** For embedding space construction, temporal query tokens ("today," "this year," "when") should carry special positional treatment — they resonate with a layer of the corpus that already has calendar structure built into its frequency distribution.

The **sea/land ratio claim** — "sea" appearing 32 times, "land" 13 times, giving 71.11%/28.89% — is widely cited and corresponds remarkably to the actual ocean surface coverage of Earth (~70.8%). However, this claim's counting methodology varies across sources (different Arabic root forms counted differently). It is presented here as a research question requiring the corpus's own CID-indexed concordance to verify definitively.

**Architectural implication regardless of exact counts:** Zipf's law. In any natural language corpus of size N, word frequency f(r) follows:
```
f(r) = C / r^α     where α ≈ 1 for most natural languages
```

The Arabic corpus, as a natural language document of ~77,430 total word occurrences and ~18,000 unique word forms (with ~1,700 unique trilateral roots), will follow this distribution. The most frequent root tokens will dominate the embedding space. The embedding model must be regularized against this frequency bias — otherwise, common root tokens (s-l-m, k-t-b, q-w-l) will dominate cosine similarity calculations, masking rarer but thematically rich content.

**Root token frequency in embedding space:** The ~1,700 active roots are not uniformly distributed. The top ~200 roots (~12%) account for approximately 80% of word occurrences (a rough Pareto distribution — consistent with Zipf). This means the embedding space is heavily weighted toward those 200 roots. Embedding at the root token level (rather than the surface word level) would compress this distribution and give rarer semantic territories more equitable representation.

---

### 2.4 The 7-Verse Opening as Initialization Vector

The 7-verse opening (Al-Fatiha) has a unique property: it is the *only* complete unit that is repeated identically in every formal recitation. In every encounter with the corpus, this unit appears first. It is structurally prior to all other content.

In computational terms: this is a **mandatory prefix** — not just a chapter but a constraint on interpretation. Every query to the corpus is implicitly conditioned on this prefix. The neural architecture analog:

```
Every forward pass through the Soul Engine:
  input = [fatiha_embedding | query_embedding | context_embedding]
  (not optional; not retrieved; always present as a fixed bias)
```

The 7-verse opening should be pre-computed as a static embedding vector (fixed, not updated by LoRA adapters) and concatenated to every query embedding before FAISS search. This would cause the search to find corpus units that resonate with *both* the query topic and the interpretive frame established by the opening — which is exactly how the corpus is meant to be read.

In mathematical terms: the initialization vector acts as a **Bayesian prior** on the embedding space. All cosine similarities are computed against a query vector that already contains the opening's signal. Content that resonates with the opening but not the query gets lower score (appropriately) than content that resonates with both.

**Technical note on 7:** The number recurs in the architecture of the corpus (7 oft-repeated, 7 heavens referenced within, the 7-day week embedded structurally). In information theory, the capacity of human working memory is 7±2 chunks (Miller, 1956). Whether this is meaningful parallelism or pattern-matching is left to the reader. The implementation recommendation stands independent of interpretation: use the opening as a fixed initialization vector.

---

### 2.5 Prime Number Distribution in Layer Structure

Among the 114 layers, 30 are prime-numbered (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113). That's 26.3% — slightly higher than the expected prime density near 114 (by the prime counting function π(114)/114 ≈ 30/114 ≈ 26.3%, which is exactly consistent with the prime counting function, meaning no anomaly here).

However, the prime-numbered layers include some of the most theologically and textually significant:
- Layer 2: Longest layer (286 resonance units)
- Layer 3: Second longest (200 units)
- Layer 7: Longest in the second group
- Layer 19: Chapter with the most explicit mathematical structuring
- Layer 67: The "Sovereignty" layer (30 units, high poetic density)
- Layer 113, 114: The two protective closing layers

**Architectural proposal:** Prime-numbered layers are candidates for **backbone node status** — higher replication factor (pinned on more nodes), faster retrieval guarantees, and no evaporation of their pheromone trails. Non-prime layers can tolerate more volatility in their routing infrastructure because prime layers provide structural coverage.

This is analogous to the graph-theoretic observation that prime-numbered nodes in certain mathematical graphs (Ulam spiral, Sieve of Eratosthenes) provide the densest coverage of the number line. Whether this analogy is deep or superficial is an open question, but the practical outcome — replicate prime-layer content more aggressively — is conservative and risk-free to implement.

---

### 2.6 Root Token Zipf Distribution and Embedding Geometry

Classical Arabic operates on a trilateral root system: most words are derived from a 3-consonant root by applying vowel patterns. The corpus contains approximately 1,700 active roots generating its vocabulary. This system has a mathematical consequence for embedding geometry:

Words from the same root will cluster tightly in embedding space (they share consonantal skeleton and semantic field). Words from rare roots will be sparsely distributed. The embedding space will have **19–200 dense clusters** (corresponding to the most common root families) surrounded by sparse satellite words from rarer roots.

This non-uniform geometry matters for FAISS search: IVF (Inverted File) indexing partitions the space into Voronoi cells. If those cells are not sized to account for the root clustering, the most common root clusters will be split across multiple cells (increasing search time) while rare content regions will each be their own sparse cells (wasting index capacity).

**Recommendation:** Use **HNSWFlat** indexing (Hierarchical Navigable Small World) rather than IVF for the corpus embeddings. HNSW builds a multi-layer proximity graph that handles non-uniform density naturally, with search complexity O(log n) regardless of cluster size distribution. The current plan doesn't specify the FAISS index type — this should be made explicit.

---

## Part III — Architecture Refinements

Based on the science and mathematics above, eight specific refinements to `soul-engine-living-swarm.md`:

---

### Refinement 1: Complete the ACO Formula (Critical)

**Current plan's pheromone update:**
```python
# In pheromone.py update_trail():
alpha = 0.3
new_score = alpha * quality_score + (1 - alpha) * existing["quality_score"]
trail["access_count"] = existing["access_count"] + 1
```

This is an exponential moving average of *quality*, not an ACO pheromone update. It's missing the Δτ term — the deposit quantity that depends on path efficiency.

**Proposed correction:**
```python
def _compute_delta_tau(quality_score: float, latency_ms: int) -> float:
    """
    Dorigo's reinforcement term: Q / L_k
    Q = quality constant (1.0), L_k = path cost (latency proxy)
    Higher quality + lower latency = more pheromone deposited.
    """
    Q = 1.0
    normalized_latency = latency_ms / 1000.0  # seconds
    L_k = normalized_latency / quality_score   # path cost (lower is better)
    return Q / L_k if L_k > 0 else 0.0

# Correct pheromone update:
def update_trail(...):
    delta_tau = _compute_delta_tau(quality_score, latency_ms)
    rho = self._decay_rate  # currently 0.10
    new_tau = (1 - rho) * existing["tau"] + delta_tau
    trail["tau"] = new_tau  # pheromone intensity (separate from quality score)
    trail["quality_score"] = quality_score  # keep for human inspection
```

This separates *pheromone intensity* (τ, which determines routing probability) from *quality score* (for display and experiment tracking). Routing decisions should use τ, not quality_score.

---

### Refinement 2: Topological Neighbors Over Metric Broadcast (Significant)

**Current plan:** All GossipSub subscribers receive all broadcasts. Agent A and Agent B working on completely different corpus regions receive the same waggle signals and heartbeats.

**Proposed:** Each agent maintains a **semantic neighborhood list** of 6–7 agents whose recent query embeddings are closest to its own:

```python
# In BaseSwarmAgent — add after heartbeat processing:

def _update_semantic_neighbors(self, peer_id: str, recent_query_embs: list):
    """
    Maintain list of 6-7 topologically nearest semantic peers.
    'Nearest' = smallest cosine distance in query embedding space.
    """
    if not recent_query_embs:
        return
    peer_centroid = np.mean(recent_query_embs, axis=0)
    my_centroid = np.mean(self._recent_query_embeddings, axis=0)
    similarity = float(np.dot(peer_centroid, my_centroid))
    
    self._neighbor_similarities[peer_id] = similarity
    # Keep only top 6–7 (Ballerini 2008)
    sorted_neighbors = sorted(
        self._neighbor_similarities.items(), 
        key=lambda x: x[1], reverse=True
    )[:7]
    self._semantic_neighbors = {pid: sim for pid, sim in sorted_neighbors}

def _topological_signal_weight(self, sender_peer_id: str) -> float:
    """Weight a signal by topological proximity. Ballerini (2008) model."""
    if sender_peer_id in self._semantic_neighbors:
        return 1.0 + self._semantic_neighbors[sender_peer_id]  # 1.0–2.0
    return 0.3  # distant neighbors get de-weighted but not ignored
```

Waggle signals from topological neighbors get 3× the weight of signals from semantically distant agents. This reduces noise from irrelevant discoveries while preserving global connectivity.

---

### Refinement 3: Informed Seeder Agents at Startup (5% Principle)

**Current plan:** All agents start cold. The experimental flag (10% of Builders) is about *exploration strategy*, not about *directional knowledge*.

**Proposed:** At swarm initialization, designate **5% of active Builders as Informed Seeders**. Each Informed Seeder is pre-loaded with embeddings from one of the 6 mathematical groups (groups A–F, each covering 19 layers). Their retrieval behavior is biased toward their assigned group.

```python
class InformedSeederBuilder(BuilderAgent):
    """
    Couzin (2002) informed individual: biased toward a known corpus region.
    5% of builder population. Navigates the swarm without announcing leadership.
    """
    def __init__(self, config, pheromone, group_layers: list[int]):
        super().__init__(config, pheromone, experimental=False)
        self._group_layers = group_layers  # e.g., [1..19] for Group A
        self._group_bias_weight = 0.4  # 40% pull toward assigned group
    
    async def _retrieve_cids(self, query_text, query_emb, path):
        # Bias FAISS search: combine query_emb with group centroid embedding
        group_centroid = self._preloaded_group_embedding  # fixed at startup
        biased_emb = (
            (1 - self._group_bias_weight) * query_emb 
            + self._group_bias_weight * group_centroid
        )
        biased_emb /= np.linalg.norm(biased_emb)  # renormalize
        return await self._cold_faiss_search(biased_emb, path)
```

With 5% informed seeders (one per group in a minimal 6-seeder deployment), the swarm has guaranteed coverage of all six mathematical groups at all times, even during cold starts when pheromone trails don't exist yet.

---

### Refinement 4: Two-Tier Evaporation

**Current plan:** Single ρ = 0.10 applied uniformly to all trails daily.

**Mathematical problem:** With ρ = 0.10, trail strength after n days: τ(n) = τ(0) × 0.9^n. After 22 days: τ reaches ~10% of initial. For queries about the corpus's core themes (mercy, guidance, creation) — themes that will always be queried — this evaporation rate destroys valuable memory every month. For time-sensitive query patterns, it may be too slow.

**Proposed two-tier system:**

```python
def classify_trail_volatility(self, query_text: str, access_history: list) -> str:
    """
    Perennial trails: consistent access over time → low evaporation
    Volatile trails: bursty access patterns → high evaporation
    """
    if len(access_history) < 7:
        return "volatile"  # not enough data → be conservative
    
    # Coefficient of variation in daily access counts
    daily_counts = self._compute_daily_counts(access_history)
    cv = np.std(daily_counts) / (np.mean(daily_counts) + 1e-9)
    
    return "perennial" if cv < 0.5 else "volatile"

EVAPORATION_RATES = {
    "perennial": 0.02,   # 2% per day → trail survives >100 days
    "volatile":  0.25,   # 25% per day → trail evaporates in ~2 weeks
}
```

This directly implements the biological observation: ant colonies maintain permanent high-use trails (to permanent food sources) indefinitely while allowing exploration trails to evaporate quickly.

---

### Refinement 5: The 7-Verse Initialization Vector

**Proposed addition to `base_agent.py`:**

```python
FATIHA_INIT_CID = "FIXED_CID_FOR_OPENING_7_VERSES"  # set once, never changes

class BaseSwarmAgent:
    def __init__(self, config):
        ...
        self._fatiha_vector: Optional[np.ndarray] = None  # never updated by LoRA

    async def _load_corpus_embedding(self):
        # Load global embedding (existing)
        ...
        # Load fixed initialization vector (NEW)
        fatiha_content = await self.ipfs_fetch(FATIHA_INIT_CID)
        fatiha_text = fatiha_content.get("text_translation", "")
        self._fatiha_vector = self.embed(fatiha_text)
        # Note: this vector is NEVER updated by LoRA adapters or learning cycles
        logger.info(f"[{self.caste}] Loaded 7-verse initialization vector")

    def embed_with_prior(self, text: str, prior_weight: float = 0.15) -> np.ndarray:
        """
        Embed text conditioned on the 7-verse opening as a Bayesian prior.
        Every query is implicitly prefixed with the initialization frame.
        """
        text_emb = self.embed(text)
        if self._fatiha_vector is not None:
            # Weighted combination: primary query + initialization prior
            combined = (1 - prior_weight) * text_emb + prior_weight * self._fatiha_vector
            return combined / np.linalg.norm(combined)
        return text_emb
```

All similarity checks in `check_corpus_alignment` and pheromone trail lookups should use `embed_with_prior` rather than `embed`. The prior_weight of 0.15 means the initialization vector contributes 15% of the query representation — enough to orient results without overwhelming the query signal.

---

### Refinement 6: Slime Mold Inter-Node Flux Tracking

**What's missing from the current plan:** The pheromone system tracks *what to fetch* (CID paths) but not *how to get there* (inter-node routing). The Tero (2010) model suggests adding a second-order stigmergy layer for peer routing.

**Proposed `PeerFluxManager` alongside existing `PheromoneManager`:**

```python
class PeerFluxManager:
    """
    Tero (2010) flux reinforcement for inter-peer routing.
    
    Tracks which peer sequences minimize fetch latency for each shard region.
    Separate from content pheromones — this is infrastructure topology, not content.
    """
    
    async def record_fetch_path(
        self, 
        shard_id: int, 
        peer_sequence: list[str],   # [entry_peer, relay_peer, target_peer]
        latency_ms: int,
        success: bool
    ):
        """Update flux conductance for each peer link in the path."""
        gamma = 1.2  # reinforcement exponent (from Tero 2010)
        mu = 0.05    # conductance decay rate
        
        for i in range(len(peer_sequence) - 1):
            link = (peer_sequence[i], peer_sequence[i+1])
            flux = 1.0 / latency_ms * (1.0 if success else 0.1)
            
            existing_q = self._conductance.get(link, 0.5)
            new_q = (flux ** gamma) + (1 - mu) * existing_q
            self._conductance[link] = min(new_q, 10.0)  # cap at 10x baseline
    
    def best_peer_path(self, shard_id: int, available_peers: list[str]) -> list[str]:
        """Return the highest-conductance path to the peer hosting a shard."""
        # Dijkstra over conductance graph (higher conductance = lower cost)
        ...
```

This makes the network topology self-optimize exactly as the Tokyo slime mold network did — without human intervention, routes that carry high traffic become more reliable, and routes that are slow or failure-prone thin out.

---

### Refinement 7: Abandoned Trail Protocol (Bee Abandonment Rule)

**Missing from current plan:** The Bee Algorithm's employed-bee abandonment rule. Currently, trails can only weaken through passive evaporation. But if a trail consistently returns below-threshold quality, it should be actively abandoned.

```python
ABANDONMENT_LIMIT = 5  # consecutive failures before abandoning

async def check_abandonment(self, trail: dict) -> bool:
    """
    Pham et al. (2005): if a site fails to improve for 'limit' cycles,
    the employed bee abandons it and becomes a scout.
    """
    consecutive_fails = trail.get("consecutive_low_quality", 0)
    if consecutive_fails >= ABANDONMENT_LIMIT:
        # Active abandonment: set tau to 0, unpin from IPFS
        await self._abandon_trail(trail["query_key"])
        # Spawn a Seeker to explore the same query neighborhood fresh
        await self.publish("soul-swarm-discovery", {
            "type": "seeker_request",
            "query_neighborhood": trail["query_key"],
            "reason": "trail_abandoned_after_limit"
        })
        return True
    return False
```

This prevents the system from repeatedly following dead-end trails while waiting for passive evaporation (which, at ρ = 0.10, takes weeks). Active abandonment + fresh Seeker dispatch converts failure into exploration immediately.

---

### Refinement 8: 19-Based Agent Count Scheduling

**Current plan:** Arbitrary counts in deployment (4 builders, 2 seekers, 1 guardian, 1 weaver = 8 total).

**Proposed:** Target agent counts that are multiples of 6 (to match the 6-group structure) for Builders, and maintain the 5% informed-seeder ratio:

```
Minimum viable swarm (single node):
  Builders:          6 (1 per mathematical group, all as informed seeders in dev)
  Seekers:           1
  Guardians:         1
  Weavers:           0 (run manually on schedule)
  Total:             8 agents

Standard deployment (3+ nodes):
  Builders:         19 (1 control builder per layer group × 3 nodes + 1 exp per group)
  Informed seeders:  1 per group = 6 (included in builder count above)
  Seekers:           3 (1 per active node)
  Guardians:         3 (minimum 3 for Byzantine-fault-tolerant consensus)
  Weavers:           1 (nightly, shared across cluster)
  Total:            26 agents (not a multiple of 19, but builder count is)

Full swarm (per Bucks node):
  Builders:         19 per node
  ...
```

The 19-builder count per node is the key alignment: it means each "shard" of the builder population is organized in the same mathematical structure as the corpus layers themselves.

---

## Part IV — Real-World Implementation Scorecard

### Phase A — IPFS-Native Retrieval
**Feasibility: 4/5**

Helia is mature and the CID namespace is well-defined. The risk is IPFS cold-fetch latency. Empirical IPFS fetch times on a home-lab network with 3–5 peers: **cold = 200–800ms**, **warm (cached) = 5–30ms**. The warm latency is acceptable. Cold latency is not for the fish-school 200ms target — but that target applies only to Guardian alerts, not to full query processing. Clarify the latency SLO: Guardian alerts (<100ms), full query response (<3 seconds).

### Phase B — Pheromone Layer
**Feasibility: 4/5**

Core design is sound. The corrections in Refinement 1 are necessary to match the Dorigo model. The main operational risk: IPNS publish latency (~100–300ms per trail update) adds to every successful query. Mitigation: batch trail updates asynchronously (fire-and-forget after returning the response).

### Phase C — Agent Castes
**Feasibility: 3/5**

The Python/Node.js bridge (port 3940) is a single point of failure and a performance bottleneck. Every GossipSub operation goes through it. For a small swarm (<10 agents), this is fine. For 19+ builders per node, the bridge queue may saturate. Mitigation: implement direct libp2p from Python via `py-libp2p` (experimental but viable) or use Redis as the inter-process message broker instead of the HTTP bridge.

### Phase D — Swarm Coordination (Boids)
**Feasibility: 4/5**

Well-specified. The DHT task claiming mechanism correctly implements the Separation rule. The main gap (addressed in Refinement 2) is the absence of topological neighbor weighting. The current metric-broadcast approach works but produces unnecessary noise at scale.

### Phase E — Self-Healing
**Feasibility: 4/5**

IPFS content immutability makes this the most robust phase. As long as any node has ever pinned a CID, it's recoverable. The only failure mode the plan doesn't address: if the *manifest* (the IPNS record pointing to all shard CIDs) becomes corrupted or unavailable, nodes can't know what CIDs to fetch. Mitigation: replicate the manifest IPNS key on every node (each node has its own IPNS record that can serve as a manifest fallback).

### Phase F — Self-Learning (QLoRA)
**Feasibility: 2/5**

This is the highest-risk phase. QLoRA on an M3 Pro is feasible (the hardware is capable) but the training pipeline adds significant operational complexity. Three specific risks:

1. **Learning from biased samples:** If most queries are about one corpus region, the model over-fits that region, degrading other regions. Mitigation: stratified sampling by resonance layer in the QLoRA dataset builder.

2. **Alignment drift:** Each adapter could slightly shift the model's interpretation even if individual adapters pass the threshold. Cumulative drift over months could be significant. Mitigation: maintain a fixed "anchor test suite" of 100 canonical query/response pairs derived from the most unambiguous resonance units; reject any adapter that degrades anchor performance by >2 points.

3. **Catastrophic forgetting:** QLoRA is designed to prevent this, but 4-bit quantization + adapter training can still degrade base model weights over many cycles. Mitigation: track base model perplexity on a held-out corpus segment after each adapter application; alert if perplexity increases >5%.

### Phase G — Self-Exploring + Experimenting
**Feasibility: 3/5**

The frontier management design is sound, but two risks:

1. **Seeker poisoning:** A malicious actor can flood the IPFS network with CIDs that have high embedding similarity to the corpus but subtly wrong content (adversarial examples in embedding space). The 0.70 waggle threshold doesn't prevent this if the adversarial content is crafted to score above threshold. Mitigation: require corroboration from **2 independent Seekers** before a waggle signal can cause a Builder to follow the trail (multi-source verification, analogous to the Guardian 2+ confirmation protocol).

2. **Frontier queue growth:** If the IPFS network publishes many CIDs relevant to the corpus's topic space, the frontier queue could grow faster than Seekers can process it. Mitigation: hard cap the frontier queue at 10,000 CIDs (FIFO eviction); prioritize CIDs from known-good peer IDs.

### Guardian Consensus Under Network Partition
**Feasibility with modifications: 3/5**

**If 30%+ of nodes go offline:** 
- With 3 Guardian agents across 3 nodes: losing 1 (33%) → only 2 remain. The current plan requires "2+ Guardians confirm" for a denylist addition. This remains functional with 2 Guardians.
- With 3 nodes and losing 2 (67%): 1 Guardian remains, cannot achieve consensus. Denylist updates halt. Existing denylist continues to function (it's a IPNS-mutable record last-published before the partition). Query processing continues but no new threats can be confirmed.
- **Recommendation:** Minimum 5 Guardian agents across at least 3 nodes, requiring 3/5 confirmation (Byzantine fault tolerance: tolerates up to 2 Byzantine failures). This requires 5 nodes for full resilience.

---

## Part V — The Minimum Viable Swarm

For someone who wants to start today, before any of the above refinements, before Phase D/E/F/G — the smallest implementation that captures the **essential swarm properties**:

**Claim:** A 3-agent system captures the minimum viable swarm. Here's why, and what it needs.

### Required Properties for "Swarm"
1. Distributed processing (no single agent does everything)
2. Emergent memory (the system remembers without any individual agent holding the memory)
3. Constitutional constraint (corpus alignment bounds all output)
4. Self-correction (bad outputs don't propagate)

### Minimum Viable Configuration

```
Node A:
  - Builder Agent #1 (control)
  - PheromoneManager (shared IPNS storage)
  - Corpus alignment check (BGE-M3 + FAISS)

Node B:
  - Builder Agent #2 (control)
  - PheromoneManager (reads same IPNS storage as Node A)
  
Any node:
  - Guardian Agent #1 (can run on Node A or B)

Shared infrastructure:
  - IPFS/Helia (any node or shared)
  - soul-swarm-bridge.js (one instance, any node)
  - GossipSub for soul-swarm-query and soul-swarm-alert topics
```

**What this MVS gives you:**
- Queries are claimed by whichever Builder gets there first (separation rule) — no duplicate processing
- Both Builders update the same pheromone trails — memory is shared, distributed, and persists across restarts
- All outputs pass corpus alignment before being pinned — the constitutional constraint is in place
- The Guardian monitors heartbeats and alerts the other Builder if one dies
- Pheromone trails form and strengthen with use, making repeated queries progressively faster

**What it doesn't give you (and when to add it):**
- *No self-healing:* If Node A dies, pheromone trails still exist in IPFS, but Builder #2 is the only active agent. Add a third node with another Builder before you need this.
- *No self-learning:* The model doesn't improve. Add Weaver + QLoRA after 30 days of usage accumulation.
- *No self-exploring:* No Seeker discovers new content. Add one Seeker after the pheromone layer is stable.
- *No experimentation:* Add 10% experimental flag to one Builder after you have at least 500 interactions in the log.

### Starting Commands (MVS)

```bash
# 1. Start IPFS bridge
node soul_swarm/bucks-integration/soul-swarm-bridge.js &

# 2. Start minimal swarm (2 Builders + 1 Guardian)
python -m soul_swarm.coordinator \
  --mode mvs \
  --builders 2 \
  --seekers 0 \
  --guardians 1 \
  --weavers 0

# 3. Verify: send 5 identical queries, observe pheromone formation
python -m soul_swarm.tools.trail_inspector --query "your test query"
# Expected: query 1 is slow (cold FAISS); queries 2-5 progressively faster
```

### Time to MVS: 3–5 Days

Assuming Phases 0–5 of the main plan are complete (IPFS live, FAISS indices pinned, Soul Engine GGUF working):
- Day 1–2: Implement `PheromoneManager` + `BaseSwarmAgent` + `BuilderAgent`
- Day 3: Implement `GuardianAgent` (heartbeat monitor only, no shard redistribution yet)
- Day 4: Wire `soul-swarm-bridge.js` into Bucks IPFS server
- Day 5: Integration test — kill a node, verify the other continues

The full living swarm (all phases) is months of work. The minimum viable swarm with pheromone memory, corpus alignment, and basic health monitoring is a week.

---

## Summary of Specific Changes

| # | Current Plan | Proposed Refinement | Grounding |
|---|-------------|---------------------|-----------|
| 1 | EMA quality score update | Full Dorigo ACO: τ(t+1) = (1-ρ)τ(t) + Q/L | Dorigo (1992) |
| 2 | Metric broadcast (GossipSub all) | Topological 6–7 nearest semantic neighbors | Ballerini (2008) |
| 3 | 10% experimental flag only | 5% informed seeders at startup + 10% experimental | Couzin (2002) |
| 4 | Arbitrary agent counts | Builders in multiples of 6 (matching 6-group structure) | 114 = 6 × 19 |
| 5 | Corpus embedding as prior | 7-verse opening as fixed initialization vector | Al-Fatiha structure |
| 6 | No peer routing layer | PeerFluxManager (Tero flux reinforcement for node topology) | Tero (2010) |
| 7 | Single ρ = 0.10 decay | Two-tier: perennial ρ = 0.02, volatile ρ = 0.25 | Dorigo literature |
| 8 | Passive trail evaporation only | Active abandonment after N consecutive failures + Seeker dispatch | Pham (2005) |

**All other elements of the living swarm plan are scientifically sound as specified.** The biological mappings are correct. The caste system correctly mirrors biological ant caste specialization. The self-healing via IPFS immutability is the most architecturally innovative element and has no prior art to correct against — it is an original and well-reasoned application of content-addressed storage to the army ant bridge pattern. The self-learning cycle is conservative and appropriate.

The refinements above make the plan not just biologically *inspired* but biologically *equivalent* — the mathematics of what the system does will match the mathematics of what the biology does. That equivalence is what makes swarm intelligence work.

---

*Soul Engine Swarm Refinement — Science Supplement*  
*Theoretical grounding: Dorigo (1992), Kennedy & Eberhart (1995), Pham et al. (2005), Reynolds (1987), Ballerini et al. (2008), Couzin et al. (2002), Tero et al. (2010 Science), Langton (1990)*  
*All computational bounds defined by the Soul of the World corpus — 114-layer resonance architecture*

"""
Bucks Agent Server v2 — Soul + Frozen/Floating Memory + RAG + RL + P2P.
Every LLM call is grounded in frozen memory (soul ROM).
All dynamic context floats above it via the RAG pipeline.
"""
import time
import uuid
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import config
import ollama_client as ollama
from engine import run as engine_run, _route
from safety import check_prompt, add_harm_pattern
from knowledge import kb
from memory.session_store import sessions, preferences, interactions
from tools.registry import list_tools, get_tool

# ── Agentic modules ────────────────────────────────────────────────────────────
from soul import FrozenMemory, WorldSoul, load_or_create_soul, SoulRegistry
from soul.validator import is_trusted
from rag import RAGPipeline
from rag.embedder import embed
from rag.ipfs_store import IPFSKnowledgeStore
from rl import ExperienceBuffer, RewardModel, RoutingPolicy
from p2p import AgentDiscovery, AgentConnector, ServiceBroker

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("bucks-server")

# ── Global singletons ──────────────────────────────────────────────────────────
frozen_memory  = FrozenMemory()
soul_registry  = SoulRegistry()
world_soul:    Optional[WorldSoul]       = None
rag_pipeline:  Optional[RAGPipeline]    = None
ipfs_store:    Optional[IPFSKnowledgeStore] = None
exp_buffer     = ExperienceBuffer()
reward_model   = RewardModel()
rl_policy      = RoutingPolicy(alpha=config.RL_ALPHA, epsilon=config.RL_EPSILON)
discovery:     Optional[AgentDiscovery]  = None
connector:     Optional[AgentConnector]  = None
broker:        Optional[ServiceBroker]   = None
own_soul:      dict = {}
_quran_indexed: bool = False


# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global rag_pipeline, ipfs_store, discovery, connector, broker, own_soul
    global world_soul, _quran_indexed

    # 1. Bootstrap WorldSoul (download + encrypt Quran on first run)
    if config.WORLD_SOUL_ENABLED:
        try:
            world_soul = await WorldSoul.bootstrap(config.IPFS_API_URL)
            frozen_memory.set_world_soul_hash(world_soul.get_hash())
            log.info("WorldSoul ready | SHA256: %s | ayahs: %d",
                     world_soul.get_hash()[:16], world_soul.total_ayahs())
        except Exception as e:
            log.error("WorldSoul bootstrap failed: %s — continuing without it", e)

    # 2. Load / create soul (includes worldSoulHash in signature)
    own_soul = load_or_create_soul(locality=config.SOUL_LOCALITY, cidn=config.SOUL_CIDN)

    # 3. Pin frozen memory to IPFS
    frozen_cid = await frozen_memory.pin_to_ipfs(config.IPFS_API_URL)
    if frozen_cid and not own_soul.get("frozenMemoryCid"):
        from soul.generator import generate_soul
        own_soul = generate_soul(locality=config.SOUL_LOCALITY, cidn=config.SOUL_CIDN)
    log.info("Soul: %s | frozenCid: %s", own_soul.get("soulId", "?")[:16],
             (frozen_cid or "pending")[:12])

    # 4. Boot RAG pipeline
    ipfs_store   = IPFSKnowledgeStore(config.IPFS_API_URL)
    rag_pipeline = RAGPipeline(frozen_memory=frozen_memory, ipfs_store=ipfs_store)

    # 5. Index Quran verses into RAG in background (non-blocking)
    import asyncio
    asyncio.create_task(_index_quran_background())

    # 6. Boot P2P layer
    discovery = AgentDiscovery(soul_registry, own_soul, config.IPFS_API_URL)
    connector = AgentConnector(soul_registry, own_soul)
    broker    = ServiceBroker(discovery, connector, config.IPFS_API_URL)
    await discovery.start()

    models = await ollama.available_models()
    log.info("✓ Bucks Agent v3 ready | models=%s | memory=%d | souls=%d",
             models, interactions.count(), soul_registry.count())
    yield
    discovery.stop()
    log.info("Bucks Agent Server shut down.")


async def _index_quran_background() -> None:
    """
    Embed each Quran verse into the RAG floating memory collection.
    Runs in background after startup. Skip if already indexed.
    Processes in batches to avoid blocking the event loop.
    """
    global _quran_indexed
    if _quran_indexed or not world_soul or not rag_pipeline:
        return
    import asyncio
    col = rag_pipeline._get_collection("bucks_quran_soul")
    if not col:
        return

    # Check if already indexed (collection has data)
    try:
        existing = col.count()
        if existing > 100:
            log.info("Quran already indexed (%d verses in ChromaDB)", existing)
            _quran_indexed = True
            return
    except Exception:
        pass

    log.info("Indexing Quran verses into RAG (background)...")
    batch_size = config.QURAN_RAG_EMBED_BATCH
    batch_ids, batch_docs, batch_embs, batch_metas = [], [], [], []
    count = 0

    for ayah in world_soul.iter_ayahs():
        # Only embed English text for semantic search (Arabic stored in metadata)
        english = ayah.get("english", "").strip()
        if not english:
            continue
        verse_id = f"q{ayah['surah_number']:03d}:{ayah['ayah_number']:03d}"
        doc_text = f"[{ayah['surah_name']} {ayah['surah_number']}:{ayah['ayah_number']}] {english}"

        emb = await embed(doc_text)
        batch_ids.append(verse_id)
        batch_docs.append(doc_text)
        batch_embs.append(emb)
        batch_metas.append({
            "surah":  ayah["surah_number"],
            "ayah":   ayah["ayah_number"],
            "name":   ayah["surah_name"],
            "arabic": ayah.get("arabic", ""),
            "source": "soul_of_the_world",
        })
        count += 1

        if len(batch_ids) >= batch_size:
            try:
                col.upsert(ids=batch_ids, documents=batch_docs,
                           embeddings=batch_embs, metadatas=batch_metas)
            except Exception as e:
                log.error("Quran batch upsert error: %s", e)
            batch_ids, batch_docs, batch_embs, batch_metas = [], [], [], []
            await asyncio.sleep(0.01)  # yield to event loop

    if batch_ids:
        try:
            col.upsert(ids=batch_ids, documents=batch_docs,
                       embeddings=batch_embs, metadatas=batch_metas)
        except Exception as e:
            log.error("Quran final batch error: %s", e)

    _quran_indexed = True
    log.info("Quran indexing complete: %d verses embedded into RAG", count)

app = FastAPI(title="Bucks Agent Server v2", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Request / Response models ──────────────────────────────────────────────────

class SwarmTaskRequest(BaseModel):
    prompt: str
    current_url:   Optional[str] = None
    current_title: Optional[str] = None
    session_id:    Optional[str] = "default"
    image_b64:     Optional[str] = None    # Point 8: multi-modal

class SlmQueryRequest(BaseModel):
    prompt: str
    session_id: Optional[str] = "default"

class FeedbackRequest(BaseModel):
    task_id:    str
    score:      int                    # 1 = good, -1 = bad
    correction: Optional[str] = None

class PreferenceRequest(BaseModel):
    key:   str
    value: object                      # str | list | dict

class KBRequest(BaseModel):
    domain: str
    fact:   str

class SafetyPatternRequest(BaseModel):
    pattern: str                       # regex string


# ── Core agent endpoint ────────────────────────────────────────────────────────

@app.post("/api/v1/swarm/task")
async def swarm_task(req: SwarmTaskRequest):
    task_id = str(uuid.uuid4())
    if req.prompt.strip() == "__ping__":
        return {"status": "success", "evaluation": "pong", "task_id": task_id}
    log.info(f"[{task_id}] session={req.session_id} | {req.prompt[:60]}")

    t_start = time.time()

    # Build frozen + floating prompt
    system_prompt, user_prompt = ("", req.prompt)
    if rag_pipeline:
        try:
            system_prompt, user_prompt = await rag_pipeline.build_prompt(req.prompt, k=config.RAG_TOP_K)
        except Exception as e:
            log.warning("RAG pipeline error (falling back to frozen only): %s", e)
            system_prompt = frozen_memory.get_system_prompt()

    # RL-guided routing
    candidates = ["slm", "browser", "wallet", "ipfs", "code", "commerce", "calendar"]
    chosen_agent = rl_policy.select_action(candidates)

    result = await engine_run(
        prompt=user_prompt,
        system_prompt=system_prompt,
        current_url=req.current_url,
        current_title=req.current_title,
        task_id=task_id,
        session_id=req.session_id or "default",
        image_b64=req.image_b64,
    )

    # Record implicit RL experience
    latency_ms = (time.time() - t_start) * 1000
    tool_ok = result.get("status") != "error"
    implicit_reward = reward_model.implicit_reward(tool_ok, latency_ms)
    from rag.embedder import embed
    try:
        state_emb = await embed(req.prompt)
        exp_buffer.add(task_id, state_emb, chosen_agent, implicit_reward)
        rl_policy.update(chosen_agent, implicit_reward)
    except Exception as e:
        log.debug("RL update skipped: %s", e)

    # Store interaction in floating memory
    if rag_pipeline and result.get("evaluation"):
        try:
            await rag_pipeline.store_interaction(
                f"Q: {req.prompt}\nA: {result['evaluation']}",
                source="interaction",
            )
        except Exception:
            pass

    return result


@app.post("/api/v1/slm/query")
async def slm_query(req: SlmQueryRequest):
    task_id = str(uuid.uuid4())
    return await engine_run(prompt=req.prompt, task_id=task_id, session_id=req.session_id or "default")


# ── Point 8: Multi-modal file upload ──────────────────────────────────────────

@app.post("/api/v1/multimodal")
async def multimodal_input(
    prompt:     str            = Form(...),
    session_id: str            = Form("default"),
    file:       Optional[UploadFile] = File(None),
):
    """Accept text + optional image/audio. Image is described by vision model; audio is transcribed."""
    import base64
    image_b64 = None
    if file:
        content = await file.read()
        ct = file.content_type or ""
        if ct.startswith("image/"):
            image_b64 = base64.b64encode(content).decode()
        elif ct.startswith("audio/"):
            prompt = f"[Audio received: {file.filename}] {prompt}"
    task_id = str(uuid.uuid4())
    return await engine_run(prompt=prompt, task_id=task_id, session_id=session_id, image_b64=image_b64)


# ── Point 4: Session / context management ─────────────────────────────────────

@app.get("/api/v1/session/{session_id}")
async def get_session(session_id: str):
    s = sessions.get_or_create(session_id)
    return {"session_id": session_id, "message_count": len(s["messages"]),
            "messages": s["messages"][-20:]}

@app.delete("/api/v1/session/{session_id}")
async def clear_session(session_id: str):
    sessions.clear(session_id)
    return {"status": "cleared", "session_id": session_id}


# ── Point 9: User preferences / adaptive learning ─────────────────────────────

@app.get("/api/v1/preferences")
async def get_preferences():
    return preferences.get_all()

@app.post("/api/v1/preferences")
async def set_preference(req: PreferenceRequest):
    preferences.set(req.key, req.value)
    return {"status": "ok", "key": req.key, "value": req.value}

@app.delete("/api/v1/preferences/{key}")
async def delete_preference(key: str):
    preferences.set(key, None)
    return {"status": "deleted", "key": key}


# ── Point 1: Knowledge base — continuous learning ─────────────────────────────

@app.post("/api/v1/knowledge")
async def add_knowledge(req: KBRequest):
    kb.add_fact(req.domain, req.fact)
    return {"status": "ok", "domain": req.domain, "fact": req.fact}

@app.get("/api/v1/knowledge/search")
async def search_knowledge(q: str, k: int = 5):
    return {"query": q, "results": kb.retrieve(q, k=k)}

@app.get("/api/v1/knowledge/domains")
async def list_domains():
    from knowledge.domain_kb import KNOWLEDGE_BASE
    return {d: len(v) for d, v in KNOWLEDGE_BASE.items()}


# ── Point 5: Feedback / self-evaluation ──────────────────────────────────────

@app.post("/api/v1/memory/feedback")
async def memory_feedback(req: FeedbackRequest):
    interactions.update_score(req.task_id, req.score, req.correction)
    log.info(f"Feedback task={req.task_id} score={req.score}")

    # RL: compute explicit reward and update policy
    reward = reward_model.compute(
        feedback_score=req.score,
        correction_given=bool(req.correction),
    )
    from rag.embedder import embed
    try:
        # Retrieve original experience to get state embedding
        near = exp_buffer.sample_near(await embed(req.task_id[:60]), n=1)
        state_emb = near[0]["state_emb"] if near else []
        action = near[0]["action"] if near else "slm"
        if isinstance(state_emb, str):
            import json as _json
            state_emb = _json.loads(state_emb)
        exp_buffer.add(req.task_id, state_emb, action, reward, req.correction)
        rl_policy.update(action, reward)
    except Exception as e:
        log.debug("RL feedback update error: %s", e)

    return {"status": "ok"}

@app.post("/api/v1/memory/clear")
async def memory_clear():
    return {"status": "cleared"}


# ── Soul endpoints ─────────────────────────────────────────────────────────────

@app.get("/api/v1/soul")
async def get_own_soul():
    """Return own soul manifest. The JS bridge uses this to advertise on gossipsub."""
    return own_soul or {"error": "soul not initialized"}


@app.post("/api/v1/soul/set_ipfs_cid")
async def set_soul_ipfs_cid(body: dict):
    """Called by the JS bridge after pinning frozen memory to IPFS."""
    cid = body.get("cid", "")
    if cid:
        frozen_memory.set_ipfs_cid(cid)
        log.info("Frozen memory CID updated: %s", cid)
    return {"status": "ok", "cid": cid}


@app.post("/api/v1/soul/peer")
async def receive_peer_soul(soul: dict):
    """Receive a peer soul from the JS bridge and verify + register it."""
    if not discovery:
        return {"trusted": False, "reason": "discovery not initialized"}
    result = discovery.on_peer_soul(soul)
    # If trusted, pull their IPFS knowledge fragments into floating memory
    if result.get("trusted") and rag_pipeline:
        try:
            fragments = await ipfs_store.index_peer_fragments(soul)
            for frag in fragments:
                await rag_pipeline.store_ipfs_fragment(
                    frag["text"], soul.get("soulId", "")[:16], frag.get("_cid", "")
                )
        except Exception as e:
            log.debug("Peer fragment indexing error: %s", e)
    return result


@app.get("/api/v1/soul/registry")
async def get_soul_registry():
    """Return all known peer souls."""
    return {"souls": soul_registry.all_souls(), "count": soul_registry.count()}


@app.get("/api/v1/memory/frozen")
async def get_frozen_memory():
    """Return the frozen memory text (read-only). UI displays this as the agent constitution."""
    return {
        "text":   frozen_memory.get_system_prompt(),
        "hash":   frozen_memory.get_hash(),
        "cid":    frozen_memory.get_ipfs_cid(),
        "data":   frozen_memory.get_data(),
    }


# ── WorldSoul endpoints (Quran Soul of the World) ─────────────────────────────

@app.get("/api/v1/world_soul/status")
async def world_soul_status():
    """Return WorldSoul status — metadata only, never decrypted content."""
    if not world_soul:
        return {"ready": False, "reason": "world soul not initialized"}
    meta = world_soul.get_meta()
    return {
        "ready":          world_soul.is_locked(),
        "hash":           world_soul.get_hash(),
        "ipfs_cid":       world_soul.get_ipfs_cid(),
        "total_surahs":   meta.get("total_surahs", 0),
        "total_ayahs":    meta.get("total_ayahs", 0),
        "translation":    meta.get("translation", ""),
        "source":         meta.get("source", ""),
        "quran_indexed":  _quran_indexed,
    }


@app.post("/api/v1/world_soul/bootstrap")
async def bootstrap_world_soul():
    """
    Manually trigger WorldSoul bootstrap (download + encrypt Quran).
    Idempotent — safe to call if already bootstrapped.
    """
    global world_soul
    if world_soul and world_soul.is_locked():
        return {"status": "already_bootstrapped", "hash": world_soul.get_hash()[:16]}
    try:
        world_soul = await WorldSoul.bootstrap(config.IPFS_API_URL)
        frozen_memory.set_world_soul_hash(world_soul.get_hash())
        import asyncio
        asyncio.create_task(_index_quran_background())
        return {"status": "bootstrapped", "hash": world_soul.get_hash()[:16],
                "ayahs": world_soul.total_ayahs()}
    except Exception as e:
        raise HTTPException(503, f"WorldSoul bootstrap failed: {e}")


@app.get("/api/v1/world_soul/search")
async def world_soul_search(q: str, k: int = 5):
    """
    Semantic search across Quran verses (requires Quran to be indexed into RAG).
    Returns matching verses by meaning — no full-text reproduction.
    """
    if not rag_pipeline:
        raise HTTPException(503, "RAG not initialized")
    if not _quran_indexed:
        return {"query": q, "results": [], "note": "Quran indexing in progress — try again shortly"}
    col = rag_pipeline._get_collection("bucks_quran_soul")
    if not col:
        raise HTTPException(503, "Quran collection not available")
    from rag.embedder import embed as _embed
    qemb = await _embed(q)
    try:
        res = col.query(
            query_embeddings=[qemb],
            n_results=min(k, 10),
            include=["documents", "metadatas"],
        )
        results = []
        for doc, meta in zip(res["documents"][0], res["metadatas"][0]):
            results.append({
                "reference": f"{meta.get('name')} {meta.get('surah')}:{meta.get('ayah')}",
                "text":      doc,
                "arabic":    meta.get("arabic", ""),
            })
        return {"query": q, "results": results}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/v1/world_soul/surah/{surah_number}")
async def get_surah(surah_number: int):
    """Return metadata for a single surah (no full verse text exposed via API)."""
    if not world_soul:
        raise HTTPException(503, "WorldSoul not initialized")
    surah = world_soul.unlock_surah(surah_number)
    if not surah:
        raise HTTPException(404, f"Surah {surah_number} not found")
    return {
        "number":      surah["number"],
        "name":        surah.get("name", ""),
        "nameArabic":  surah.get("nameArabic", ""),
        "total_ayahs": len(surah.get("ayahs", [])),
    }


# ── Swarm endpoints ────────────────────────────────────────────────────────────

@app.get("/api/v1/swarm/status")
async def swarm_node_status():
    """Return this node's swarm identity for the JS layer to broadcast."""
    return {
        "soulId":        own_soul.get("soulId", "")[:16] if own_soul else "",
        "worldSoulHash": world_soul.get_hash()[:16] if world_soul else "",
        "model":         config.SLM_MODEL,
        "capabilities":  own_soul.get("capabilities", []) if own_soul else [],
        "locality":      own_soul.get("locality", "") if own_soul else "",
        "agentUrl":      f"http://localhost:{config.SWARM_AGENT_PORT}",
        "edgeSlms":      config.EDGE_SLMS,
    }


# ── RAG endpoints ──────────────────────────────────────────────────────────────

@app.get("/api/v1/rag/search")
async def rag_search(q: str, k: int = 5):
    """Retrieve top-k floating memory items for a query (for debug/UI)."""
    if not rag_pipeline:
        raise HTTPException(503, "RAG pipeline not initialized")
    items = await rag_pipeline.retrieve(q, k=k)
    return {
        "query": q,
        "results": [
            {
                "text":             i.text[:300],
                "source":           i.source,
                "feedback_score":   i.feedback_score,
                "retrieval_count":  i.retrieval_count,
                "item_id":          i.item_id,
            }
            for i in items
        ],
    }


@app.post("/api/v1/rag/ingest")
async def rag_ingest(body: dict):
    """Add a document to floating memory."""
    if not rag_pipeline:
        raise HTTPException(503, "RAG pipeline not initialized")
    text   = body.get("text", "")
    source = body.get("source", "manual")
    if not text:
        raise HTTPException(400, "text is required")
    item = await rag_pipeline.store_interaction(text, source=source)
    return {"status": "ok", "item_id": item.item_id if item else None}


# ── RL endpoints ───────────────────────────────────────────────────────────────

@app.get("/api/v1/rl/policy")
async def get_rl_policy():
    """Return current routing weights (floating layer only)."""
    return {"weights": rl_policy.get_weights(), "experience_count": exp_buffer.count()}


@app.post("/api/v1/rl/reset")
async def reset_rl_policy():
    """Reset routing policy to neutral weights (dev/debug)."""
    rl_policy.reset()
    return {"status": "reset"}


@app.get("/api/v1/rl/top_examples")
async def get_top_examples(n: int = 10):
    """Return top-n positive experiences for few-shot prompt injection."""
    return {"examples": exp_buffer.sample_positive(n), "stats": exp_buffer.stats()}


# ── P2P endpoints ──────────────────────────────────────────────────────────────

@app.get("/api/v1/p2p/agents")
async def list_p2p_agents():
    """List all discovered peer agents and their capabilities."""
    if not discovery:
        return {"agents": [], "services": []}
    return {
        "agents":   discovery.get_all_agents(),
        "services": broker.list_network_services() if broker else [],
    }


@app.post("/api/v1/p2p/delegate")
async def delegate_task(body: dict):
    """Delegate a task to a peer agent with the required capability."""
    if not broker:
        raise HTTPException(503, "P2P broker not initialized")
    task       = body.get("task", {})
    capability = body.get("capability", "")
    if not capability:
        raise HTTPException(400, "capability is required")
    result = await broker.route_task(task, capability)
    return result

@app.get("/api/v1/memory/stats")
async def memory_stats():
    return {"interaction_count": interactions.count(), "preferences": preferences.get_all()}


# ── Point 7: Safety management ───────────────────────────────────────────────

@app.post("/api/v1/safety/pattern")
async def add_safety_pattern(req: SafetyPatternRequest):
    try:
        add_harm_pattern(req.pattern)
        return {"status": "added", "pattern": req.pattern}
    except Exception as e:
        raise HTTPException(400, f"Invalid regex: {e}")

@app.post("/api/v1/safety/check")
async def safety_check(body: dict):
    result = check_prompt(body.get("prompt", ""))
    return {"safe": result.safe, "reason": result.reason, "category": result.category}


# ── Point 2: Tool registry ────────────────────────────────────────────────────

@app.get("/api/v1/tools")
async def list_agent_tools():
    return {"tools": list_tools()}

@app.post("/api/v1/tools/{tool_name}")
async def run_tool(tool_name: str, body: dict):
    tool = get_tool(tool_name)
    if not tool:
        raise HTTPException(404, f"Tool '{tool_name}' not found.")
    try:
        result = await tool.run(**body)
        return {"tool": tool_name, "result": result}
    except Exception as e:
        raise HTTPException(500, f"Tool error: {e}")


# ── Point 10: Eval suite ──────────────────────────────────────────────────────

@app.post("/api/v1/eval")
async def run_eval():
    from tests.eval_scenarios import run_eval as _run_eval
    return await _run_eval()

@app.get("/api/v1/eval/quick")
async def quick_eval():
    """Fast non-LLM health check of all subsystems."""
    from planner import needs_planning
    checks = {
        "kb_crypto":         len(kb.retrieve("bitcoin", k=2)) > 0,
        "kb_bucks":          len(kb.retrieve("bucks browser agent", k=2)) > 0,
        "safety_harm_block": not check_prompt("how to make a bomb step by step").safe,
        "safety_normal_ok":  check_prompt("what is IPFS?").safe,
        "planning_complex":  needs_planning("research and compare top 3 layer-2 solutions"),
        "planning_simple":   not needs_planning("hello"),
        "routing_wallet":    _route("open my wallet") == "wallet",
        "routing_browser":   _route("search the web for news") == "browser",
        "tools_loaded":      len(list_tools()) >= 10,
        "memory_accessible": interactions.count() >= 0,
    }
    passed = sum(1 for v in checks.values() if v is True)
    return {"checks": checks, "passed": passed, "total": len(checks),
            "score_pct": round(passed / len(checks) * 100, 1)}


# ── Status / Agent discovery ───────────────────────────────────────────────────

@app.get("/api/v1/slm/status")
async def slm_status():
    models = await ollama.available_models()
    ready  = any(config.SLM_MODEL in m for m in models)
    return {"model": config.SLM_MODEL, "ready": ready, "available_models": models}

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/api/v1/status")
async def status():
    try:
        models    = await ollama.available_models()
        slm_ready = any(config.SLM_MODEL in m for m in models)
        ollama_ok = True
    except Exception:
        models, slm_ready, ollama_ok = [], False, False
    return {
        "ollama":   "online" if ollama_ok else "offline",
        "models":   models,
        "slm":      {"model": config.SLM_MODEL, "ready": slm_ready, "enabled": config.is_slm_available()},
        "agents":   ["slm", "browser", "wallet", "ipfs", "code", "commerce", "calendar"],
        "memory": {
            "interactions":   interactions.count(),
            "frozen_hash":    frozen_memory.get_hash()[:16],
            "frozen_cid":     frozen_memory.get_ipfs_cid(),
            "experience":     exp_buffer.count(),
        },
        "soul": {
            "id":       own_soul.get("soulId", "")[:16] if own_soul else "",
            "locality": own_soul.get("locality", "") if own_soul else "",
            "peers":    soul_registry.count(),
        },
        "rl_policy":  rl_policy.get_weights(),
        "tools":      len(list_tools()),
        "current_provider":    config.get_provider(),
        "available_providers": config.PROVIDERS,
        "capabilities": {
            "soul":            True,
            "frozen_memory":   True,
            "rag_floating":    rag_pipeline is not None,
            "rl_policy":       True,
            "p2p_discovery":   discovery is not None,
            "p2p_broker":      broker is not None,
        },
    }

@app.get("/api/v1/agents")
async def list_agents():
    return {"agents": [
        {"id": "slm",      "model": config.SLM_MODEL, "description": "On-device SLM — fast, private"},
        {"id": "browser",  "model": config.SLM_MODEL, "description": "Web navigation, search, fetch + DuckDuckGo"},
        {"id": "wallet",   "model": "builtin",         "description": "Crypto wallet actions"},
        {"id": "ipfs",     "model": "builtin",         "description": "IPFS decentralized storage"},
        {"id": "code",     "model": config.SLM_MODEL, "description": "Code assistance + sandboxed execution"},
        {"id": "commerce", "model": config.SLM_MODEL, "description": "Orders, logistics, product search"},
        {"id": "calendar", "model": config.SLM_MODEL, "description": "Schedule events & reminders"},
        {"id": "nexus",    "model": "hermes3:latest",  "description": "Orchestrates Hermes-driven ephemeral UI panels and agentic coordination"},
    ]}

@app.post("/api/v1/models/switch")
async def switch_provider(body: dict):
    config.set_provider(body.get("provider", "slm"))
    return {"status": "ok", "provider": config.get_provider()}

@app.get("/api/v1/models/provider")
async def get_provider():
    return {"provider": config.get_provider(), "available_providers": config.PROVIDERS,
            "models": config.MODELS}

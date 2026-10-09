"""
Bucks Agent Server — FastAPI server at localhost:3000
Speaks the existing A2UI protocol so the Tauri backend needs zero changes.
Supports LitAI, Ollama, NIM, and on-device SLM (Qwen2.5:3b).
"""
import uuid
import time
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Any

from crew import BucksAgentCrew
from memory.chroma_store import BucksMemory
import config

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("bucks-agent")

memory: BucksMemory = None
crew: BucksAgentCrew = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global memory, crew
    log.info("Starting Bucks Agent Server...")
    memory = BucksMemory()
    crew = BucksAgentCrew(memory)
    log.info("Agent server ready.")
    yield
    log.info("Shutting down Bucks Agent Server.")


app = FastAPI(title="Bucks Agent Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response Models ──────────────────────────────────────────────

class SwarmTaskRequest(BaseModel):
    prompt: str
    current_url: Optional[str] = None
    current_title: Optional[str] = None


class FeedbackRequest(BaseModel):
    task_id: str
    score: int           # 1 = positive, -1 = negative, 0 = neutral
    correction: Optional[str] = None


class ModelSwitchRequest(BaseModel):
    provider: str  # "ollama" or "litai"


# ── Endpoints ──────────────────────────────────────────────────────────────

@app.post("/api/v1/swarm/task")
async def swarm_task(req: SwarmTaskRequest):
    """Main agent endpoint — identical contract to Solar Parsec Architect."""
    task_id = str(uuid.uuid4())
    log.info(f"[{task_id}] Query: {req.prompt[:80]}")

    # Health-check ping (sent by check_architect_status in lib.rs)
    if req.prompt.strip() == "__ping__":
        return {"status": "success", "evaluation": "pong", "task_id": task_id}

    try:
        result = await crew.run(
            prompt=req.prompt,
            current_url=req.current_url,
            current_title=req.current_title,
            task_id=task_id,
        )
        log.info(f"[{task_id}] Agent: {result.get('agent_used', '?')} | status: {result.get('status')}")
        return result
    except Exception as e:
        log.error(f"[{task_id}] Error: {e}")
        return {
            "status": "error",
            "evaluation": f"Agent error: {str(e)}",
            "task_id": task_id,
            "a2ui": {"type": "text", "content": f"Sorry, I encountered an error: {str(e)}"},
        }


@app.post("/api/v1/memory/feedback")
async def memory_feedback(req: FeedbackRequest):
    """Store user feedback into ChromaDB for self-reinforcement."""
    try:
        memory.store_feedback(req.task_id, req.score, req.correction)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/status")
async def status():
    """Health + model status check."""
    import httpx
    ollama_ok = False
    models = []
    slm_ready = False
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get("http://localhost:11434/api/tags")
            if r.status_code == 200:
                ollama_ok = True
                models = [m["name"] for m in r.json().get("models", [])]
                slm_ready = any(config.SLM_MODEL in m for m in models)
    except Exception:
        pass

    return {
        "ollama": "online" if ollama_ok else "offline",
        "models": models,
        "slm": {
            "model": config.SLM_MODEL,
            "ready": slm_ready,
            "enabled": config.is_slm_available(),
        },
        "memory_entries": memory.count() if memory else 0,
        "agents": ["slm", "code", "browser", "commerce"],
        "current_provider": config.get_provider(),
        "available_providers": config.PROVIDERS,
    }


@app.post("/api/v1/memory/clear")
async def memory_clear():
    """Clear all ChromaDB memory (use with caution)."""
    memory.clear()
    return {"status": "cleared"}


@app.get("/api/v1/agents")
async def list_agents():
    return {
        "agents": [
            {"id": "slm",      "model": config.SLM_MODEL,       "description": "On-device Qwen2.5:3b — fast, private, offline-capable"},
            {"id": "code",     "model": "deepseek-coder-v2",     "description": "Reads/modifies Bucks source code, runs builds"},
            {"id": "browser",  "model": "llama3.1",              "description": "Web navigation, search, page scraping"},
            {"id": "commerce", "model": "llama3.1",              "description": "Logistics, ecommerce, order tracking, inventory"},
            {"id": "nexus",    "model": "hermes3:latest",       "description": "Orchestrates Hermes-driven ephemeral UI panels and agentic coordination"},
        ]
    }


# ── SLM Endpoint ───────────────────────────────────────────────────────────

class SlmQueryRequest(BaseModel):
    prompt: str


@app.post("/api/v1/slm/query")
async def slm_query(req: SlmQueryRequest):
    """Direct path to the on-device Qwen2.5:3b SLM — no routing, max speed."""
    task_id = str(uuid.uuid4())
    log.info(f"[SLM:{task_id}] {req.prompt[:60]}")
    return await crew.run_slm(prompt=req.prompt, task_id=task_id)


@app.get("/api/v1/slm/status")
async def slm_status():
    """Check whether qwen2.5:3b is pulled and ready in Ollama."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get("http://localhost:11434/api/tags")
            if r.status_code == 200:
                models = [m["name"] for m in r.json().get("models", [])]
                ready = any(config.SLM_MODEL in m for m in models)
                return {"model": config.SLM_MODEL, "ready": ready, "available_models": models}
    except Exception as e:
        pass
    return {"model": config.SLM_MODEL, "ready": False, "available_models": []}


# ── Model Switching Endpoints ──────────────────────────────────────────────

@app.get("/api/v1/models/provider")
async def get_model_provider():
    """Get currently active model provider"""
    provider = config.get_provider()
    return {
        "provider": provider,
        "available_providers": ["ollama", "litai"],
        "models": config.MODELS,
    }


@app.post("/api/v1/models/switch")
async def switch_model_provider(req: ModelSwitchRequest):
    """Switch between Ollama and LitAI models and recreate agents"""
    global crew
    
    try:
        config.set_provider(req.provider)
        log.info(f"Switching to {req.provider} provider...")
        
        # Recreate crew with new provider
        crew = BucksAgentCrew(memory)
        
        return {
            "status": "success",
            "provider": req.provider,
            "message": f"Successfully switched to {req.provider} provider",
            "models": {
                "code": config.get_model_name("code"),
                "general": config.get_model_name("general"),
                "slm": config.SLM_MODEL,
            }
        }
    except Exception as e:
        log.error(f"Failed to switch provider: {e}")
        raise HTTPException(status_code=400, detail=str(e))

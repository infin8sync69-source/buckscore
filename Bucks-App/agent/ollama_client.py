"""
Lightweight Ollama client — direct HTTP, no langchain/crewai required.
"""
import json
import httpx
from config import OLLAMA_BASE_URL, SLM_MODEL

TIMEOUT = httpx.Timeout(120.0, connect=5.0)


async def generate(model: str, prompt: str, system: str = "") -> str:
    """
    Try /api/chat first; fall back to /api/generate for cloud-proxied models
    (e.g. gpt-oss:120b-cloud) that don't support the chat endpoint.
    """
    full_prompt = f"{system}\n\n{prompt}".strip() if system else prompt

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        # ── Try chat endpoint ──────────────────────────────────────────────
        try:
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})
            r = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json={"model": model, "messages": messages, "stream": False},
            )
            if r.status_code == 200:
                return r.json()["message"]["content"]
        except Exception:
            pass

        # ── Fall back to generate endpoint (works with cloud models) ──────
        r = await client.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={"model": model, "prompt": full_prompt, "stream": False},
        )
        r.raise_for_status()
        return r.json()["response"]


async def available_models() -> list[str]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(3.0)) as client:
        r = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
        return [m["name"] for m in r.json().get("models", [])]


async def is_model_ready(model: str) -> bool:
    try:
        models = await available_models()
        return any(model in m for m in models)
    except Exception:
        return False

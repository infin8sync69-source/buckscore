"""
Unified model engine — one interface over every inference backend.

soul_engine.py (the LIVE agent path) talks ONLY to this module for
generation, so switching between the embedded edge model, a local Ollama
daemon, or an OpenAI-compatible endpoint (LitAI / NVIDIA NIM) is a single
runtime choice rather than the scattered `if _use_embedded()` branches it
replaces.

(Not to be confused with the legacy `engine.py`, which is the older
ollama-only "Agent Engine v2" wired to the dormant server_lite.py path.)

Design goals:
  • Edge stays the default (inbuilt-first, no external service). The others
    are explicit opt-in and only appear "configured" when their key/URL is set.
  • Two call shapes cover everything soul_engine needs:
        chat_stream(messages)            -> async token generator (plain text)
        chat_with_tools(messages, tools) -> one assistant message dict
    Both normalize to the Ollama/OpenAI-ish message shape soul_engine already
    parses ({"role","content","tool_calls":[{"function":{"name","arguments"}}]};
    its parser already handles arguments as either a dict or a JSON string).
  • The active provider is a runtime choice, persisted to
    ~/.bucks/selected_provider.txt so it survives restarts, falling back to
    config.MODEL_PROVIDER (which itself comes from the env).
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import httpx

import config
import edge_llm

log = logging.getLogger("soul-engine.model_engine")

TIMEOUT = httpx.Timeout(120.0, connect=5.0)

_BUCKS_HOME = Path(os.getenv("BUCKS_HOME", os.getenv("BUCKS_DATA_DIR", Path.home() / ".bucks")))
_PROVIDER_FILE = _BUCKS_HOME / "selected_provider.txt"

# Human-facing provider descriptors. "openai_compatible" providers share one
# HTTP dispatch path (they all speak /chat/completions); only base_url/key/model
# differ. "slm" is a legacy alias that runs through the Ollama runtime.
_PROVIDER_META = {
    "nim":    {"label": "NVIDIA NIM (Cloud)",       "kind": "openai_compatible", "inbuilt": False},
    "qwen":   {"label": "Qwen 2.5 (Local / SLM)",   "kind": "ollama",            "inbuilt": True},
    "edge":   {"label": "Embedded (On-Device)",     "kind": "edge",              "inbuilt": True},
    "ollama": {"label": "Ollama (Local Daemon)",   "kind": "ollama",            "inbuilt": False},
    "litai":  {"label": "LitAI (Cloud)",           "kind": "openai_compatible", "inbuilt": False},
}


# ── Provider selection ──────────────────────────────────────────────────────
def _read_saved_provider() -> Optional[str]:
    try:
        val = _PROVIDER_FILE.read_text().strip().lower()
        return val if val in config.PROVIDERS or val == "qwen" else None
    except Exception:
        return None


def current_provider() -> str:
    """Active provider: persisted UI choice > config/env default."""
    return _read_saved_provider() or config.get_provider()


def _provider_configured(name: str) -> bool:
    """Always return True for primary model choices so user can select them."""
    return True


def available_providers() -> list[dict]:
    active = current_provider()
    out = []
    prov_keys = list(config.PROVIDERS)
    if "qwen" not in prov_keys:
        prov_keys.insert(1, "qwen")
    for name in prov_keys:
        meta = _PROVIDER_META.get(name, {})
        out.append({
            "id": name,
            "label": meta.get("label", name),
            "inbuilt": meta.get("inbuilt", False),
            "configured": True,
            "current": name == active,
        })
    return out


def switch_provider(name: str) -> dict:
    name = (name or "").lower()
    try:
        _BUCKS_HOME.mkdir(parents=True, exist_ok=True)
        _PROVIDER_FILE.write_text(name)
    except Exception as e:
        log.warning("Could not persist provider selection: %s", e)
    config.set_provider(name)
    return {"ok": True, "provider": name}


def _kind() -> str:
    return _PROVIDER_META.get(current_provider(), {}).get("kind", "ollama")


def _openai_endpoint() -> tuple[str, str, str]:
    """(base_url, api_key, model) for the active OpenAI-compatible provider."""
    name = current_provider()
    if name == "litai":
        return config.LITAI_BASE_URL, config.LITAI_API_KEY, config.get_model_name("general")
    return config.NIM_BASE_URL, (config.NGC_API_KEY or "no-key-required"), config.NIM_MODEL


def _ollama_model() -> str:
    prov = current_provider()
    if prov == "qwen":
        return "qwen2.5:7b"
    if prov == "slm":
        return config.SLM_MODEL
    return config.get_model_name("general")


# ── Generation: plain streaming ─────────────────────────────────────────────
async def chat_stream(messages: list[dict]) -> AsyncGenerator[str, None]:
    """Yield plain-text tokens from the active provider (no tools)."""
    kind = _kind()

    if kind == "edge":
        async for tok in edge_llm.chat_stream(messages):
            yield tok
        return

    if kind == "ollama":
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as c:
                async with c.stream(
                    "POST", f"{config.OLLAMA_BASE_URL}/api/chat",
                    json={"model": _ollama_model(), "messages": messages, "stream": True},
                ) as r:
                    if r.status_code == 200:
                        async for line in r.aiter_lines():
                            if not line.strip():
                                continue
                            try:
                                obj = json.loads(line)
                            except json.JSONDecodeError:
                                continue
                            tok = obj.get("message", {}).get("content", "")
                            if tok:
                                yield tok
                            if obj.get("done"):
                                return
        except Exception as e:
            log.warning("Ollama stream failed (%s), falling back to edge", e)

        async for tok in edge_llm.chat_stream(messages):
            yield tok
        return

    # openai_compatible (litai / nim)
    base, key, model = _openai_endpoint()
    headers = {"Authorization": f"Bearer {key}"} if key and not key.startswith("no-key") else {}
    streamed_any = False
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            async with c.stream(
                "POST", f"{base.rstrip('/')}/chat/completions",
                headers=headers,
                json={"model": model, "messages": messages, "stream": True},
            ) as r:
                if r.status_code == 200:
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[len("data:"):].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            obj = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        tok = (obj.get("choices") or [{}])[0].get("delta", {}).get("content", "")
                        if tok:
                            streamed_any = True
                            yield tok
                else:
                    log.warning("Cloud LLM endpoint returned status %d", r.status_code)
    except Exception as e:
        log.warning("Cloud LLM stream error: %s", e)

    if not streamed_any:
        log.info("Falling back to local edge LLM stream")
        async for tok in edge_llm.chat_stream(messages):
            yield tok


# ── Generation: tool-calling (non-streaming) ────────────────────────────────
async def chat_with_tools(messages: list[dict], tools: list[dict]) -> dict[str, Any]:
    """Return a single assistant message dict from the active provider. Shape is
    normalized so soul_engine's existing tool_calls parsing works unchanged."""
    kind = _kind()

    if kind == "edge":
        return await edge_llm.chat_with_tools(messages, tools)

    if kind == "ollama":
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as c:
                r = await c.post(
                    f"{config.OLLAMA_BASE_URL}/api/chat",
                    json={"model": _ollama_model(), "messages": messages,
                          "tools": tools, "stream": False},
                )
                if r.status_code == 200:
                    return r.json().get("message", {}) or {}
                log.warning("Ollama provider returned status %d, falling back to edge", r.status_code)
        except Exception as e:
            log.warning("Ollama tool call failed (%s), falling back to edge", e)
        return await edge_llm.chat_with_tools(messages, tools)

    # openai_compatible (litai / nim)
    base, key, model = _openai_endpoint()
    headers = {"Authorization": f"Bearer {key}"} if key and not key.startswith("no-key") else {}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(
                f"{base.rstrip('/')}/chat/completions",
                headers=headers,
                json={"model": model, "messages": messages, "tools": tools,
                      "tool_choice": "auto", "stream": False},
            )
            if r.status_code == 200:
                choices = r.json().get("choices") or [{}]
                return choices[0].get("message", {}) or {}
            log.warning("Cloud provider %s returned status %d, falling back to edge", current_provider(), r.status_code)
    except Exception as e:
        log.warning("Cloud provider %s tool call failed (%s), falling back to edge", current_provider(), e)

    return await edge_llm.chat_with_tools(messages, tools)


# ── Status helpers for /agent/status and the UI ─────────────────────────────
def active_model_label() -> str:
    """Which concrete model the active provider will use — for status display."""
    kind = _kind()
    if kind == "edge":
        return edge_llm.current_model_id() or edge_llm.resolve_model_id()
    if kind == "ollama":
        return _ollama_model()
    _, _, model = _openai_endpoint()
    return model

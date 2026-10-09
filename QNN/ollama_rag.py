#!/usr/bin/env python3
"""Ollama RAG module for Quran Semantic Search.

Provides OllamaRAG — a lightweight wrapper around the local Ollama HTTP API
that handles model selection, availability checks, and streaming generation.

Usage:
    from ollama_rag import OllamaRAG

    rag = OllamaRAG()                        # auto-detect host + model
    rag = OllamaRAG(host="http://localhost:11434", model="llama3")

    if rag.is_available():
        answer = rag.generate(prompt="...", context="...")

    models = rag.list_models()               # returns list of model name strings
"""

import json
import os
import urllib.error
import urllib.request
from typing import Optional

# ── preference order for auto-selection ──────────────────────────────────────
_PREFERRED = ["llama3", "llama3.2", "llama3.1", "llama2",
              "mistral", "mistral-nemo",
              "phi3", "phi",
              "gemma", "gemma2",
              "qwen", "qwen2",
              "deepseek", "vicuna", "openchat"]

_DEFAULT_HOST = "http://localhost:11434"
_TIMEOUT      = 120   # local models can be slow to respond


def _best_model(names: list[str]) -> Optional[str]:
    """Pick the highest-priority model from *names* based on _PREFERRED prefixes."""
    lowered = {n: n.lower() for n in names}
    for pref in _PREFERRED:
        for name, low in lowered.items():
            if low.startswith(pref):
                return name
    return names[0] if names else None


class OllamaRAG:
    """Thin wrapper around the Ollama /api/generate and /api/tags endpoints."""

    def __init__(
        self,
        host: Optional[str] = None,
        model: Optional[str] = None,
    ) -> None:
        self.host  = (host or os.environ.get("OLLAMA_HOST", _DEFAULT_HOST)).rstrip("/")
        self._model_override = model or os.environ.get("OLLAMA_MODEL")
        self._model_resolved: Optional[str] = None  # lazily resolved

    # ── public interface ──────────────────────────────────────────────────────

    @property
    def model(self) -> Optional[str]:
        """Resolved model name (auto-detected on first access, None if Ollama unreachable)."""
        if self._model_resolved is not None:
            return self._model_resolved
        if self._model_override:
            self._model_resolved = self._model_override
            return self._model_resolved
        names = self.list_models()
        self._model_resolved = _best_model(names) if names else None
        return self._model_resolved

    def is_available(self) -> bool:
        """Return True if the Ollama server is reachable and has at least one model."""
        return bool(self.list_models())

    def list_models(self) -> list[str]:
        """Return a list of installed model name strings, or [] on any error."""
        try:
            req  = urllib.request.Request(f"{self.host}/api/tags")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())
            return [m["name"] for m in data.get("models", [])]
        except Exception:
            return []

    def generate(self, prompt: str, context: str = "") -> str:
        """
        Call Ollama's /api/generate endpoint with *prompt* (context already baked in).

        If context is non-empty it is prepended to the prompt as a system preamble.
        Returns the model's response string, or raises RuntimeError on failure.
        """
        if not self.model:
            raise RuntimeError(
                "No Ollama model available. "
                "Install one with: ollama pull llama3"
            )

        full_prompt = prompt
        if context:
            full_prompt = f"{context}\n\n{prompt}"

        payload = json.dumps({
            "model":  self.model,
            "prompt": full_prompt,
            "stream": False,
            "options": {
                "temperature": 0.3,   # more focused for scholarly Q&A
                "num_predict": 600,
            },
        }).encode()

        req = urllib.request.Request(
            f"{self.host}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
                data = json.loads(resp.read().decode())
            return data.get("response", "").strip()
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Ollama unreachable: {exc}") from exc
        except Exception as exc:
            raise RuntimeError(f"Ollama error: {exc}") from exc

    # ── convenience ───────────────────────────────────────────────────────────

    def __repr__(self) -> str:
        return f"OllamaRAG(host={self.host!r}, model={self.model!r})"

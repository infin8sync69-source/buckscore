#!/usr/bin/env python3
"""
Soul of the World — NVIDIA NIM Client
Cloud GPU inference via NVIDIA Inference Microservices.
Replaces local Ollama when available; falls back to Ollama if NIM unreachable.
"""
import os
import time
from openai import OpenAI

# QNN_PATH env var lets users install the Soul Engine outside ~/Desktop/QNN.
QNN_BASE = os.environ.get('QNN_PATH', os.path.expanduser('~/Desktop/QNN'))

NIM_BASE_URL = "https://integrate.api.nvidia.com/v1"
NIM_API_KEY  = os.getenv("NVIDIA_API_KEY", "")

# Best available models ranked by capability
NIM_CHAT_MODELS = [
    "nvidia/llama-3.1-nemotron-70b-instruct",  # NVIDIA fine-tuned, best quality
    "meta/llama-3.1-70b-instruct",              # strong general
    "meta/llama-3.1-8b-instruct",               # fast fallback
]

NIM_EMBED_MODEL = "baai/bge-m3"  # same model as local BGE-M3

# Default system context injected into every generation call
_SOUL_ENGINE_SYSTEM = (
    "You are the Soul Engine, an intelligent assistant embedded inside Bucks — "
    "a privacy-first, decentralised browser built on IPFS and peer-to-peer technology. "
    "\n\nYou run alongside a local neural search system powered by a proprietary neural "
    "architecture trained on an ancient corpus of human wisdom (114 resonance layers, "
    "6,236 resonance units). Together, you form a dual-engine intelligence: the local "
    "system handles deep semantic retrieval, you handle reasoning, synthesis, and generation."
    "\n\nBucks users value: privacy, data sovereignty, open-source tools, decentralisation, "
    "and self-hosting. When answering questions about tools or architecture, favour "
    "self-hosted and open-source options. Be direct, substantive, and technically precise. "
    "Never mention the names of underlying AI models or training infrastructure."
)


class NIMClient:
    def __init__(self):
        if not NIM_API_KEY:
            raise ValueError(f"NVIDIA_API_KEY not set. Add it to {os.path.join(QNN_BASE, '.env')}")
        self.client = OpenAI(base_url=NIM_BASE_URL, api_key=NIM_API_KEY)
        self.active_model  = None
        self.embed_dim     = None   # verified at probe time
        self.embed_enabled = False  # only True if dim == 1024
        self._probe_models()

    def _probe_models(self):
        """Find the best available model."""
        for model in NIM_CHAT_MODELS:
            try:
                resp = self.client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": "ping"}],
                    max_tokens=5,
                    timeout=10,
                )
                self.active_model = model
                print(f"✓ NIM connected: {model}")
                return
            except Exception:
                continue
        raise RuntimeError("No NIM models reachable. Check API key and network.")

    def probe_embed(self) -> bool:
        """
        Test the NIM embedding endpoint.
        Returns True only if the dimension matches the local FAISS index (1024).
        Call this separately — do not call in __init__ to keep startup fast.
        """
        try:
            resp = self.client.embeddings.create(
                model=NIM_EMBED_MODEL,
                input="probe",
                encoding_format="float",
            )
            vec = resp.data[0].embedding
            self.embed_dim = len(vec)
            if self.embed_dim == 1024:
                self.embed_enabled = True
                print(f"✓ NIM embed: {NIM_EMBED_MODEL}  dim={self.embed_dim} ✓ (matches FAISS index)")
            else:
                self.embed_enabled = False
                print(
                    f"⚠ NIM embed: dim={self.embed_dim} ≠ 1024 — "
                    "keeping local BGE-M3 for embeddings, NIM for generation only"
                )
            return self.embed_enabled
        except Exception as e:
            print(f"⚠ NIM embed probe failed: {e} — using local BGE-M3 for embeddings")
            self.embed_enabled = False
            return False

    def generate(
        self,
        prompt: str,
        system: str = _SOUL_ENGINE_SYSTEM,
        temperature: float = 0.7,
        max_tokens: int = 3000,
    ) -> tuple[str, int]:
        """Generate response via NIM cloud inference. Returns (text, latency_ms)."""
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        t0 = time.time()
        resp = self.client.chat.completions.create(
            model=self.active_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        latency_ms = int((time.time() - t0) * 1000)
        text = resp.choices[0].message.content.strip()
        return text, latency_ms

    def embed(self, text: str) -> list:
        """
        Embed text via NIM (BGE-M3 endpoint).
        Only call after probe_embed() confirmed dim==1024.
        """
        if not self.embed_enabled:
            raise RuntimeError("NIM embed not verified safe — use local BGE-M3 instead.")
        resp = self.client.embeddings.create(
            model=NIM_EMBED_MODEL,
            input=text,
            encoding_format="float",
        )
        return resp.data[0].embedding


def get_nim_client() -> "NIMClient | None":
    """Return a NIMClient, or None if unreachable."""
    try:
        return NIMClient()
    except Exception as e:
        print(f"⚠ NIM unavailable: {e} — falling back to Ollama")
        return None


# ── CLI self-test ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv(os.path.join(QNN_BASE, '.env'))

    print("=== NIM Self-Test ===\n")
    nim = get_nim_client()
    if nim is None:
        print("FAIL: could not connect to NIM.")
        raise SystemExit(1)

    # Chat test
    prompt = "In one sentence, what is wisdom?"
    print(f"Prompt: {prompt!r}")
    text, ms = nim.generate(prompt, max_tokens=80)
    print(f"Response ({ms} ms): {text}\n")

    # Embed test
    print("Probing embed endpoint...")
    ok = nim.probe_embed()
    print(f"Embed enabled: {ok}  dim: {nim.embed_dim}\n")

    print("=== Self-test complete ===")

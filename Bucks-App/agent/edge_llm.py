"""
Embedded inference backend — runs a quantized GGUF model in-process via
llama-cpp-python. This is what lets the Soul Engine start up as part of
the Bucks Browser itself, with no separate Ollama daemon to install or run.

Model choice is RAM-tiered (see config.auto_select_slm / config.EDGE_SLMS):
a small edge device gets a ~0.6-1GB model, a normal laptop gets the
~2GB default. Weights are downloaded once to ~/.bucks/models/ on first
use (not bundled in the app itself, to keep install size small) and
cached there for every run after.
"""
from __future__ import annotations

import asyncio
import logging
import os
import platform
import threading
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import config

log = logging.getLogger("soul-engine.edge_llm")

_MODEL_DIR = Path(os.getenv("BUCKS_DATA_DIR", Path.home() / ".bucks")) / "models"
_MODEL_DIR.mkdir(parents=True, exist_ok=True)

# Maps config.EDGE_SLMS ids to a concrete pre-quantized GGUF on Hugging Face.
# Every id in config.EDGE_SLMS must have an entry here.
_GGUF_CATALOGUE: dict[str, dict[str, str]] = {
    # sha256 values are each model's HuggingFace LFS digest, fetched via a
    # HEAD request's X-Linked-ETag header (no need to download the file
    # itself to obtain it) — enforced by _verify_digest()/_download() above.
    "llama3.2:1b":  {"repo": "bartowski/Llama-3.2-1B-Instruct-GGUF",  "file": "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
                      "sha256": "6f85a640a97cf2bf5b8e764087b1e83da0fdb51d7c9fab7d0fece9385611df83"},
    "smollm2:1.7b": {"repo": "bartowski/SmolLM2-1.7B-Instruct-GGUF",  "file": "SmolLM2-1.7B-Instruct-Q4_K_M.gguf",
                      "sha256": "77665ea4815999596525c636fbeb56ba8b080b46ae85efef4f0d986a139834d7"},
    "qwen2.5:1.5b": {"repo": "Qwen/Qwen2.5-1.5B-Instruct-GGUF",       "file": "qwen2.5-1.5b-instruct-q4_k_m.gguf",
                      "sha256": "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"},
    "gemma2:2b":    {"repo": "bartowski/gemma-2-2b-it-GGUF",          "file": "gemma-2-2b-it-Q4_K_M.gguf",
                      "sha256": "e0aee85060f168f0f2d8473d7ea41ce2f3230c1bc1374847505ea599288a7787"},
    "llama3.2:3b":  {"repo": "bartowski/Llama-3.2-3B-Instruct-GGUF",  "file": "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
                      "sha256": "6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff"},
    "qwen2.5:3b":   {"repo": "Qwen/Qwen2.5-3B-Instruct-GGUF",         "file": "qwen2.5-3b-instruct-q4_k_m.gguf",
                      "sha256": "626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d"},
    "phi3:mini":    {"repo": "microsoft/Phi-3-mini-4k-instruct-gguf", "file": "Phi-3-mini-4k-instruct-q4.gguf", "max_ctx": 4096,
                      "sha256": "8a83c7fb9049a9b2e92266fa7ad04933bb53aa1e85136b7b30f1b8000ff2edef"},
    # bartowski mirror: the official Qwen repo only ships this quant as split
    # files, which hf_hub_download can't fetch as a single artifact (404).
    "qwen2.5:7b":   {"repo": "bartowski/Qwen2.5-7B-Instruct-GGUF",    "file": "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
                      "sha256": "65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423"},
    "llama3.1:8b":  {"repo": "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF", "file": "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
                      "sha256": "7b064f5842bf9532c91456deda288a1b672397a54fa729aa665952863033557c"},
}

# Generic OpenAI-style tool-calling prompt/parser built into llama-cpp-python.
# Chosen because it works across unrelated base models (Llama/Qwen/Phi) instead
# of depending on each model's own embedded chat template for tool syntax.
CHAT_FORMAT = os.getenv("BUCKS_EDGE_CHAT_FORMAT", "chatml-function-calling")
# 8192 by default: the agent prompt (system rules + RAG snippets + chat history
# + ~20 tool schemas) regularly exceeds 4096, and silent truncation is the main
# reason small-model answers come out incoherent. Entries with a smaller
# trained context (e.g. phi3:mini) carry a "max_ctx" cap in the catalogue.
N_CTX = int(os.getenv("BUCKS_EDGE_N_CTX", "8192"))

_llm: Optional[Any] = None
_current_model_id: Optional[str] = None
_load_lock = asyncio.Lock()
_infer_lock = asyncio.Lock()

# Download progress (UI feedback for the multi-minute first-run/model-switch
# fetch — previously the switch endpoint just blocked with zero visibility).
# Populated by polling real bytes on disk under the model's HF cache
# directory rather than depending on hf_hub_download's internal progress
# hooks, so it works across huggingface_hub versions.
_download_progress: dict[str, Any] = {
    "active": False, "model_id": None, "downloaded_bytes": 0, "total_bytes": 0,
}


def get_download_progress() -> dict:
    return dict(_download_progress)


def _dir_size_bytes(path: Path) -> int:
    try:
        return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    except OSError:
        return 0


def _watch_download_progress(model_id: str, target_dir: Path, total_bytes: int, stop_event: "threading.Event") -> None:
    while not stop_event.wait(0.5):
        _download_progress.update({
            "active": True, "model_id": model_id,
            "downloaded_bytes": _dir_size_bytes(target_dir), "total_bytes": total_bytes,
        })

# Persisted manual model choice (from the UI switcher). Survives restarts.
_SELECTION_FILE = _MODEL_DIR.parent / "selected_model.txt"


def _read_saved_selection() -> Optional[str]:
    try:
        val = _SELECTION_FILE.read_text().strip()
        return val if val in _GGUF_CATALOGUE else None
    except Exception:
        return None


def _write_saved_selection(model_id: str) -> None:
    try:
        _SELECTION_FILE.write_text(model_id)
    except Exception as e:
        log.warning("Could not persist model selection: %s", e)


def _n_gpu_layers() -> int:
    """-1 offloads every layer to Metal/CUDA if available; harmless no-op on CPU-only builds."""
    return int(os.getenv("BUCKS_EDGE_GPU_LAYERS", "-1"))


def device_label() -> str:
    gpu = _n_gpu_layers() != 0
    if platform.system() == "Darwin":
        return "metal" if gpu else "cpu"
    return "cuda" if gpu else "cpu"


def _is_cached(model_id: str) -> bool:
    entry = _GGUF_CATALOGUE.get(model_id)
    if not entry:
        return False
    return (_MODEL_DIR / f"models--{entry['repo'].replace('/', '--')}").exists()


def _is_obtainable(model_id: str) -> bool:
    """A model is viable if its weights are already cached, or the disk has
    room to download them (file size × 1.2 + 1 GB safety margin). Prevents
    auto-select from picking a model whose download would ENOSPC a full disk."""
    if _is_cached(model_id):
        return True
    import shutil
    size_gb = next((m["size_gb"] for m in config.EDGE_SLMS if m["id"] == model_id), 5.0)
    try:
        free_gb = shutil.disk_usage(_MODEL_DIR).free / (1024 ** 3)
    except OSError:
        return True  # can't tell — let the download attempt decide
    return free_gb >= size_gb * 1.2 + 1.0


def resolve_model_id() -> str:
    """Which model id would be loaded right now.
    Priority: explicit env pin (launch override) > saved UI selection > RAM+disk-tiered auto-select."""
    explicit = os.getenv("SLM_MODEL")
    if explicit and explicit in _GGUF_CATALOGUE:
        return explicit
    saved = _read_saved_selection()
    if saved:
        return saved
    return config.auto_select_slm(available_ram_gb=config.get_available_ram_gb(),
                                  viable=_is_obtainable)


def list_models() -> list[dict]:
    """Catalogue for the UI switcher: id, size, whether it fits current RAM,
    whether it's already downloaded, and which one is active."""
    ram = config.get_available_ram_gb()
    by_id = {m["id"]: m for m in config.EDGE_SLMS}
    out = []
    for model_id, entry in _GGUF_CATALOGUE.items():
        meta = by_id.get(model_id, {})
        size_gb = meta.get("size_gb", 0.0)
        cached = (_MODEL_DIR / f"models--{entry['repo'].replace('/', '--')}").exists()
        out.append({
            "id": model_id,
            "size_gb": size_gb,
            "fits_ram": (size_gb * 1.5) <= ram,
            "downloaded": cached,
            "current": model_id == _current_model_id,
        })
    out.sort(key=lambda m: m["size_gb"])
    return out


async def switch_model(model_id: str) -> dict:
    """Swap the active embedded model. Persists the choice so it survives restart.
    Frees the previous model before loading the new one to avoid holding two in RAM."""
    global _llm, _current_model_id
    if model_id not in _GGUF_CATALOGUE:
        return {"ok": False, "error": f"unknown model id: {model_id}"}
    _write_saved_selection(model_id)
    # Hold both locks: _infer_lock so we don't swap out from under a running
    # generation, _load_lock to serialize with any concurrent load. Acquire in
    # the same order the inference path uses (load first) to avoid deadlock.
    async with _load_lock, _infer_lock:
        # Drop the old model first so the new load doesn't peak at 2x memory.
        _llm = None
        _current_model_id = None
        import gc
        gc.collect()
        try:
            await asyncio.to_thread(_load, model_id)
            return {"ok": True, "model": model_id}
        except Exception as e:
            log.error("switch_model failed for %s: %s", model_id, e)
            return {"ok": False, "error": str(e)}


def _verify_digest(path: str, expected_sha256: Optional[str]) -> None:
    """Enforce a pinned SHA-256 on a downloaded weight file.

    Weights are fetched trust-on-first-use from third-party registries. The HF
    transport hashes blobs, but nothing here pins a digest we control, so a
    compromised or swapped upstream repo would be accepted silently. When a
    catalogue entry carries a ``sha256`` we verify it and delete the file on
    mismatch; when it does not we log that the file is UNPINNED so the gap is
    visible rather than silent. Add digests to _GGUF_CATALOGUE to enforce.
    """
    if not expected_sha256:
        log.warning("Model weights UNPINNED (no sha256 in catalogue): %s", path)
        return
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    got = h.hexdigest()
    if got.lower() != expected_sha256.lower():
        try:
            os.remove(path)
        except OSError:
            pass
        raise ValueError(
            f"Model digest mismatch for {path}: expected {expected_sha256}, got {got}"
        )
    log.info("Model digest verified: %s", path)


def _download(repo_id: str, filename: str, expected_sha256: Optional[str] = None,
               model_id: Optional[str] = None, size_gb: float = 0.0) -> str:
    from huggingface_hub import hf_hub_download

    target_dir = _MODEL_DIR / f"models--{repo_id.replace('/', '--')}"
    already_cached = target_dir.exists()
    stop_event = threading.Event()
    monitor: Optional[threading.Thread] = None
    if not already_cached and model_id:
        total_bytes = int(size_gb * (1024 ** 3))
        _download_progress.update({"active": True, "model_id": model_id, "downloaded_bytes": 0, "total_bytes": total_bytes})
        monitor = threading.Thread(
            target=_watch_download_progress, args=(model_id, target_dir, total_bytes, stop_event), daemon=True,
        )
        monitor.start()
    try:
        path = hf_hub_download(repo_id=repo_id, filename=filename, cache_dir=str(_MODEL_DIR))
        _verify_digest(path, expected_sha256)
        return path
    finally:
        stop_event.set()
        if monitor:
            monitor.join(timeout=2)
        _download_progress.update({"active": False})


def _load(model_id: Optional[str] = None) -> Any:
    """Blocking load (or swap) of the embedded model. Always call via a thread."""
    global _llm, _current_model_id
    from llama_cpp import Llama

    model_id = model_id or resolve_model_id()
    if _llm is not None and _current_model_id == model_id:
        return _llm

    entry = _GGUF_CATALOGUE.get(model_id)
    if not entry:
        raise ValueError(f"No embedded GGUF mapping for model id: {model_id}")

    log.info("Preparing embedded model %s (%s/%s)…", model_id, entry["repo"], entry["file"])
    size_gb = next((m["size_gb"] for m in config.EDGE_SLMS if m["id"] == model_id), 0.0)
    model_path = _download(entry["repo"], entry["file"], entry.get("sha256"), model_id=model_id, size_gb=size_gb)

    log.info("Loading %s into llama.cpp…", model_path)
    llm = Llama(
        model_path=model_path,
        n_ctx=min(N_CTX, int(entry.get("max_ctx", N_CTX))),
        n_gpu_layers=_n_gpu_layers(),
        chat_format=CHAT_FORMAT,
        verbose=False,
    )
    _llm = llm
    _current_model_id = model_id
    log.info("Embedded model ready: %s", model_id)
    return llm


async def ensure_loaded(model_id: Optional[str] = None) -> Any:
    async with _load_lock:
        return await asyncio.to_thread(_load, model_id)


async def is_ready() -> bool:
    try:
        await ensure_loaded()
        return True
    except Exception as e:
        log.warning("Embedded model not ready: %s", e)
        return False


def current_model_id() -> Optional[str]:
    return _current_model_id


def _set_chat_format(llm: Any, fmt: str) -> None:
    """Switch chat template/handler on an already-loaded model for this call.

    Tool-calling needs the portable chatml-function-calling handler (works
    across unrelated base models), but that handler's special tokens don't
    match every model's own tokenizer and can break plain-text generation
    (observed: Llama-3.2 rambling forever on <|im_start|>/<|im_end|> tokens
    it doesn't recognize as stop tokens). llama-cpp-python always caches the
    GGUF's own embedded template under "chat_template.default" regardless of
    the format passed at construction, so plain chat can use that instead —
    fall back to the constructed default if a model's GGUF has no embedded
    template metadata.
    """
    if fmt == "chat_template.default" and fmt not in llm._chat_handlers:
        fmt = CHAT_FORMAT
    llm.chat_format = fmt


async def chat_with_tools(messages: list[dict], tools: list[dict]) -> dict[str, Any]:
    """Non-streaming tool-calling completion. Returns an Ollama/OpenAI-shaped
    message dict: {"role": "assistant", "content": ..., "tool_calls": [...]}."""
    llm = await ensure_loaded()

    async with _infer_lock:
        def _call() -> dict[str, Any]:
            _set_chat_format(llm, CHAT_FORMAT)
            resp = llm.create_chat_completion(
                messages=messages, tools=tools, tool_choice="auto", stream=False,
            )
            return resp["choices"][0]["message"]

        return await asyncio.to_thread(_call)


async def chat_stream(messages: list[dict]) -> AsyncGenerator[str, None]:
    """Streaming plain-text completion (no tools). Yields content token strings."""
    llm = await ensure_loaded()

    async with _infer_lock:
        await asyncio.to_thread(_set_chat_format, llm, "chat_template.default")
        queue: "asyncio.Queue[Any]" = asyncio.Queue()
        loop = asyncio.get_running_loop()
        _DONE = object()

        def worker() -> None:
            try:
                for chunk in llm.create_chat_completion(messages=messages, stream=True):
                    delta = chunk["choices"][0].get("delta", {})
                    tok = delta.get("content", "")
                    if tok:
                        loop.call_soon_threadsafe(queue.put_nowait, tok)
            except Exception as e:  # noqa: BLE001 - surfaced to the SSE stream below
                loop.call_soon_threadsafe(queue.put_nowait, e)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, _DONE)

        threading.Thread(target=worker, daemon=True).start()
        while True:
            item = await queue.get()
            if item is _DONE:
                break
            if isinstance(item, Exception):
                raise item
            yield item

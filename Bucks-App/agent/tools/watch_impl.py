"""
Directory watching — real implementation backed by ``watchdog``.

The MCP ``/resources/watch`` endpoint previously accepted a WebSocket and
replied ``"File watching not yet implemented"``, which looks identical to a
working watch that has seen no events yet. This module provides the actual
behaviour.

Two shapes, because the two callers need different things:

  * ``watch_stream(path)`` — an async iterator of events, for the WebSocket.
    Runs until the consumer stops iterating.
  * ``collect_events(path, duration)`` — gathers events for a fixed window and
    returns them, for the request/response tool registry (a workflow step
    cannot hold an open stream).

Both go through ``fs_impl.safe_path``, so a watch is subject to the same
allowed-roots grant as a read, and neither emits events for credential paths.
"""
from __future__ import annotations

import asyncio
import fnmatch
import time
from pathlib import Path
from typing import AsyncIterator, Optional

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from tools.fs_impl import safe_path, DENIED_NAMES

# Directories that produce constant churn and would drown the stream in noise.
IGNORED_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    ".next", "dist", "build", ".cache", ".DS_Store",
}

# Two writes to the same file inside this window collapse into one event.
# Editors routinely emit several modify events per save.
COALESCE_SECONDS = 0.25


def _is_noise(path_str: str) -> bool:
    parts = Path(path_str).parts
    if any(p in IGNORED_DIRS for p in parts):
        return True
    # Never surface credential paths, matching the read/write deny-list.
    if any(p in DENIED_NAMES for p in parts):
        return True
    return Path(path_str).name.startswith(".~") or path_str.endswith("~")


class _QueueHandler(FileSystemEventHandler):
    """Bridges watchdog's own thread onto the asyncio loop."""

    def __init__(self, loop: asyncio.AbstractEventLoop,
                 queue: "asyncio.Queue[dict]", patterns: Optional[list[str]]):
        self._loop = loop
        self._queue = queue
        self._patterns = patterns
        self._last: dict[tuple[str, str], float] = {}

    def _emit(self, kind: str, event) -> None:
        path = event.dest_path if kind == "moved" and getattr(event, "dest_path", "") else event.src_path
        if _is_noise(path):
            return
        if self._patterns and not any(
            fnmatch.fnmatch(Path(path).name, pat) for pat in self._patterns
        ):
            return

        now = time.time()
        key = (kind, path)
        if now - self._last.get(key, 0.0) < COALESCE_SECONDS:
            return
        self._last[key] = now

        payload = {
            "event": kind,
            "path": path,
            "is_directory": bool(event.is_directory),
            "timestamp": now,
        }
        # Called from watchdog's thread — hop to the loop thread safely.
        self._loop.call_soon_threadsafe(self._queue.put_nowait, payload)

    def on_created(self, event):  self._emit("created", event)
    def on_modified(self, event): self._emit("modified", event)
    def on_deleted(self, event):  self._emit("deleted", event)
    def on_moved(self, event):    self._emit("moved", event)


def _start_observer(target: Path, loop, queue, patterns, recursive: bool) -> Observer:
    observer = Observer()
    observer.schedule(_QueueHandler(loop, queue, patterns), str(target), recursive=recursive)
    observer.start()
    return observer


async def watch_stream(
    path: str,
    patterns: Optional[list[str]] = None,
    recursive: bool = True,
) -> AsyncIterator[dict]:
    """Yield file-system events for ``path`` until the consumer stops.

    Raises PermissionError (via safe_path) if the directory is outside the
    granted roots, so the caller can reject the connection rather than open a
    stream that will never produce anything.
    """
    target = safe_path(path)
    if not target.is_dir():
        raise NotADirectoryError(f"Not a directory: {target}")

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict] = asyncio.Queue()
    observer = _start_observer(target, loop, queue, patterns, recursive)

    try:
        while True:
            yield await queue.get()
    finally:
        # Must stop the observer thread, or every closed WebSocket leaks one.
        observer.stop()
        observer.join(timeout=2)


async def collect_events(
    path: str,
    duration_seconds: float = 5.0,
    patterns: Optional[list[str]] = None,
    recursive: bool = True,
    max_events: int = 200,
) -> dict:
    """Watch for a fixed window and return what happened.

    For the tool registry and workflow steps, which are request/response and
    cannot consume an open stream.
    """
    target = safe_path(path)
    if not target.is_dir():
        return {"error": f"Not a directory: {target}", "events": []}

    duration_seconds = max(0.1, min(float(duration_seconds), 300.0))
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict] = asyncio.Queue()
    observer = _start_observer(target, loop, queue, patterns, recursive)

    events: list[dict] = []
    deadline = loop.time() + duration_seconds
    try:
        while len(events) < max_events:
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            try:
                events.append(await asyncio.wait_for(queue.get(), timeout=remaining))
            except asyncio.TimeoutError:
                break
    finally:
        observer.stop()
        observer.join(timeout=2)

    return {
        "path": str(target),
        "watched_seconds": duration_seconds,
        "count": len(events),
        "truncated": len(events) >= max_events,
        "events": events,
    }

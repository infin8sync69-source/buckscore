"""
Filesystem / git tools for the crewai code agent (see agents/code_agent.py).

These are **thin crewai ``@tool`` wrappers only**. The actual behaviour lives in
``tools/fs_impl.py``, which ``tools/registry.py`` also imports.

Previously this module carried its own full implementations while
``registry.py`` carried a second, separately-drifted set — and only
``registry.py``'s copies were dispatched by the agent. A change made here
therefore verified fine in isolation and still had zero effect on agent
behaviour. Keep behaviour in ``fs_impl.py`` so both consumers stay in step.
"""
from __future__ import annotations

from crewai.tools import tool

from tools.fs_impl import (
    BUCKS_ROOT,
    safe_path as _safe_path,
    read_file as _read_file,
    write_file as _write_file,
    list_directory as _list_directory,
    git_status as _git_status,
    git_diff as _git_diff,
)

__all__ = [
    "BUCKS_ROOT", "_safe_path",
    "read_file", "write_file", "list_directory", "git_status", "git_diff",
]


@tool("read_file")
def read_file(path: str) -> str:
    """Read the contents of a file in the Bucks project. Pass a relative or absolute path."""
    return _read_file(path)


@tool("write_file")
def write_file(path: str, content: str) -> str:
    """Write (overwrite) a file in the Bucks project. Pass relative path and full new content."""
    return _write_file(path, content)


@tool("list_directory")
def list_directory(path: str = ".") -> str:
    """List files and directories (with sizes) at a path inside the Bucks project."""
    return _list_directory(path)


@tool("git_status")
def git_status() -> str:
    """Get the current git status of the Bucks project."""
    return _git_status()


@tool("git_diff")
def git_diff() -> str:
    """Show unstaged changes in the Bucks project."""
    return _git_diff()

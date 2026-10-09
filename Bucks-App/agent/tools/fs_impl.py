"""
Filesystem / git tool implementations — the single source of truth.

WHY THIS MODULE EXISTS
----------------------
These functions previously existed **twice**: once in ``tools/file_tools.py``
(wrapped in crewai ``@tool`` decorators) and again, re-implemented, in
``tools/registry.py``. Only the ``registry.py`` copies were registered in
``TOOLS`` and dispatched by the agent, so a fix applied to ``file_tools.py``
verified correct in isolation and still changed nothing about agent behaviour.
That cost real debugging time, and the two copies had already drifted apart:

    | behaviour        | registry.py         | file_tools.py        |
    |------------------|---------------------|----------------------|
    | read_file size   | silent 8000-char cut| unbounded            |
    | list_directory   | 60 entries, no sizes| 100 entries, no sizes|
    | error strings    | "Read error: …"     | "Error reading X: …" |
    | BUCKS_ROOT       | own definition      | own definition       |

Both consumers now import from here, so there is exactly one implementation and
one project-root definition to keep correct.

This module deliberately has **no crewai dependency** so that importing it from
``registry.py`` costs nothing and cannot fail on an optional package.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

# Anchored to this file's location (<repo>/agent/tools/fs_impl.py → <repo>).
# The previous hardcoded default, "~/Desktop/bucks core", did not exist on the
# machine this ships from (the real tree is "~/Desktop/Bucks Core/bucks
# browser"), so every file/shell tool returned "No such file or directory" and
# the agent retried until it exhausted its step budget.
BUCKS_ROOT = Path(
    os.environ.get("BUCKS_PROJECT_ROOT")
    or Path(__file__).resolve().parents[2]
)

# Caps. read_file's limit protects an 8k-token context window from a single
# large file; list_directory's keeps a big node_modules listing from flooding
# the transcript. Both are surfaced to the model rather than applied silently —
# see the truncation notices below.
MAX_READ_CHARS = int(os.getenv("BUCKS_MAX_READ_CHARS", "8000"))
MAX_LIST_ENTRIES = int(os.getenv("BUCKS_MAX_LIST_ENTRIES", "100"))

# Extra directories the user has explicitly granted, beyond the project root.
# Colon-separated absolute paths, e.g.
#     BUCKS_ALLOWED_ROOTS="$HOME/Documents:$HOME/Desktop/work"
# Empty by default: without an explicit grant the tools stay confined to the
# project, which is the behaviour every existing caller was written against.
def _configured_roots() -> list[Path]:
    roots = [BUCKS_ROOT.resolve()]
    for raw in os.getenv("BUCKS_ALLOWED_ROOTS", "").split(os.pathsep):
        raw = raw.strip()
        if not raw:
            continue
        try:
            roots.append(Path(raw).expanduser().resolve())
        except OSError:
            continue
    return roots


# Never readable/writable even when nested inside a granted root. Credentials
# do not become safe to hand an agent just because they sit under a directory
# the user opened up for ordinary work files.
DENIED_NAMES = {
    ".ssh", ".aws", ".gnupg", ".kube", ".docker", ".netrc",
    ".env", ".env.local", "id_rsa", "id_ed25519", "credentials",
    "Keychains", "login.keychain-db", ".git-credentials", ".npmrc", ".pypirc",
}


def safe_path(rel_or_abs: str) -> Path:
    """Resolve a path, keeping it inside one of the allowed roots.

    Allowed roots are the project root plus anything the user granted via
    ``BUCKS_ALLOWED_ROOTS``. Containment is checked with ``is_relative_to``
    (real path components), not a string prefix — a raw ``startswith`` lets a
    sibling like ``/x/bucks core-evil`` slip past the guard for root
    ``/x/bucks core``. ``resolve()`` collapses symlinks, so a link pointing out
    of every root is rejected here rather than followed.
    """
    p = Path(rel_or_abs).expanduser()
    if not p.is_absolute():
        p = BUCKS_ROOT / p
    p = p.resolve()

    roots = _configured_roots()
    if not any(p == r or p.is_relative_to(r) for r in roots):
        raise PermissionError(
            f"Path outside allowed roots: {p}. Granted: "
            + ", ".join(str(r) for r in roots)
            + ". Add more with BUCKS_ALLOWED_ROOTS."
        )

    # Check every component, so .../Documents/.ssh/id_rsa is caught too.
    for part in p.parts:
        if part in DENIED_NAMES:
            raise PermissionError(f"Path is denied (sensitive): {p}")
    return p


def _display(p: Path) -> str:
    """Path shown back to the caller, relative to whichever root contains it."""
    for r in _configured_roots():
        if p == r or p.is_relative_to(r):
            try:
                return str(p.relative_to(r))
            except ValueError:
                break
    return str(p)


def _human_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 ** 2:
        return f"{n / 1024:.1f} KB"
    return f"{n / 1024 ** 2:.1f} MB"


def read_file(path: str) -> str:
    """Read a file inside the project, truncating loudly rather than silently."""
    try:
        p = safe_path(path)
        text = p.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return f"Read error: {e}"
    if len(text) > MAX_READ_CHARS:
        # Silent truncation used to make the model believe it had seen a whole
        # file when it had not, so it would reason confidently about content
        # that was never in its context. Say so explicitly instead.
        return (
            text[:MAX_READ_CHARS]
            + f"\n\n[TRUNCATED: showing first {MAX_READ_CHARS} of {len(text)} characters "
              f"of {p.name}. This is NOT the complete file.]"
        )
    return text


def write_file(path: str, content: str) -> str:
    try:
        p = safe_path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        # relative_to(BUCKS_ROOT) raised for files under a granted external
        # root, turning a successful write into a "Write error:" string.
        return f"✓ Written: {_display(p)}"
    except Exception as e:
        return f"Write error: {e}"


def list_directory(path: str = ".") -> str:
    """List a directory, including file sizes.

    Sizes matter: without them the agent cannot answer an ordinary question
    like "which files are largest?" without opening every file, so it guesses
    from filenames instead.
    """
    try:
        p = safe_path(path)
        entries = sorted(p.iterdir(), key=lambda x: (x.is_file(), x.name))
    except Exception as e:
        return f"List error: {e}"

    lines = []
    for e in entries[:MAX_LIST_ENTRIES]:
        if e.is_dir():
            lines.append(f"📁 {e.name}")
            continue
        try:
            lines.append(f"📄 {e.name} ({_human_size(e.stat().st_size)})")
        except OSError:
            lines.append(f"📄 {e.name}")

    if len(entries) > MAX_LIST_ENTRIES:
        lines.append(f"[… {len(entries) - MAX_LIST_ENTRIES} more entries not shown]")
    return "\n".join(lines) or "(empty)"


def _git(*args: str, timeout: int = 10) -> str:
    try:
        r = subprocess.run(
            ["git", *args], cwd=str(BUCKS_ROOT),
            capture_output=True, text=True, timeout=timeout,
        )
        return (r.stdout or "").strip()
    except Exception as e:
        return f"git {args[0]} error: {e}"


def git_status() -> str:
    out = _git("status", "--short")
    return out or "Clean."


def git_diff() -> str:
    out = _git("diff", "--stat")
    return out or "No changes."

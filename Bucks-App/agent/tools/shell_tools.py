"""
Shell execution tools for the Code Agent.
Whitelisted commands only — no destructive operations.
"""
import os
import shlex
import subprocess
from pathlib import Path
from crewai.tools import tool

# Single source of truth — see tools/fs_impl.py. Defining the project root
# separately in each tool module is how it came to be wrong (and wrong in three
# places at once) in the first place.
from tools.fs_impl import BUCKS_ROOT  # noqa: E402

ALLOWED_PREFIXES = (
    "npm ", "npx ", "cargo ", "pnpm ", "yarn ",
    "git status", "git diff", "git log",
    "ls ", "cat ", "echo ", "which ", "ollama ",
    "uvicorn ", "python ", "pip ",
)


# A prefix check alone is not an allowlist when the command goes to a shell:
# "ls ; rm -rf ~" starts with "ls ". Commands therefore run without a shell
# (argv from shlex), and anything a shell would interpret is refused outright.
SHELL_METACHARACTERS = (";", "&", "|", "`", "$(", ">", "<", "\n", "\r")


def _is_allowed(cmd: str) -> bool:
    stripped = cmd.strip()
    if any(m in stripped for m in SHELL_METACHARACTERS):
        return False
    return any(stripped.startswith(p) for p in ALLOWED_PREFIXES)


@tool("run_shell")
def run_shell(command: str, cwd: str = "") -> str:
    """
    Run a shell command inside the Bucks project.
    Only whitelisted commands are permitted (npm, cargo, git read-only, etc.).
    Pass cwd as a relative path inside the project if needed (e.g. 'Bucks-browser/bucks-app').
    """
    if not _is_allowed(command):
        return f"Command not allowed for safety: '{command}'. Permitted prefixes: {ALLOWED_PREFIXES}"
    work_dir = (BUCKS_ROOT / cwd).resolve() if cwd else BUCKS_ROOT
    if not work_dir.is_relative_to(BUCKS_ROOT.resolve()):
        return f"Working directory must stay inside the project: '{cwd}'"
    try:
        result = subprocess.run(
            shlex.split(command),
            cwd=str(work_dir),
            capture_output=True,
            text=True,
            timeout=120,
        )
        output = (result.stdout + result.stderr).strip()
        return output[:4000] or "(no output)"
    except subprocess.TimeoutExpired:
        return "Command timed out after 120s."
    except Exception as e:
        return f"Shell error: {e}"

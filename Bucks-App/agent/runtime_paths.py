"""
Where the agent keeps runtime state (databases, caches, learned weights).

The modules used to write next to the code, in `<agent>/../data`. That works for
a source checkout and breaks in a packaged app, where the code sits in a
read-only bundle. When BUCKS_DATA_DIR is set (the Bucks Browser always sets it,
to a folder in its own profile directory) everything goes there instead; when
it is not set, the old location is kept so existing installs find their data.
"""
from __future__ import annotations

import os
from pathlib import Path

_LEGACY_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def data_dir() -> Path:
    explicit = os.getenv("BUCKS_DATA_DIR", "").strip()
    return Path(explicit).expanduser() if explicit else _LEGACY_DATA_DIR

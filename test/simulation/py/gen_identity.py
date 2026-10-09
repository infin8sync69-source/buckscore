#!/usr/bin/env python3
"""
Generates one synthetic user's real signed Soul identity by importing the
actual production `soul.generator` module from bucks browser/agent (read-only
use — no edits to that tree). BUCKS_HOME must be set by the caller to an
isolated per-user directory so this never touches the real ~/.bucks or
collides with any concurrently-running dev instance.

Usage: BUCKS_HOME=<dir> python3 gen_identity.py <locality> <cidn>
Prints the soul manifest JSON to stdout.
"""
import json
import os
import sys

AGENT_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "bucks browser", "agent"))
sys.path.insert(0, AGENT_DIR)

if not os.environ.get("BUCKS_HOME"):
    print(json.dumps({"error": "BUCKS_HOME must be set to an isolated directory"}), file=sys.stderr)
    sys.exit(1)

locality = sys.argv[1] if len(sys.argv) > 1 else "global"
cidn = sys.argv[2] if len(sys.argv) > 2 else "bucks-sim"

from soul.generator import load_or_create_soul  # noqa: E402

soul = load_or_create_soul(locality=locality, cidn=cidn)
print(json.dumps(soul))

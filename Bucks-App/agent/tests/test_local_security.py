"""
Security and robustness checks for the Soul Engine as the Bucks Browser runs it:
the bearer-token gate, CORS, the run_shell allowlist, where runtime data goes,
and /health reporting a failed model load instead of "loading" forever.

Runs with the packages in requirements-engine.txt only:
    cd agent && python -m unittest tests.test_local_security -v
"""
from __future__ import annotations

import importlib
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

AGENT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT))

# Isolated state for everything imported below. BUCKS_SOUL_TOKEN is deliberately
# NOT set here: soul_engine installs its gate at import time, and other test
# modules in the same run (test_nexus_endpoints.py) use the app without a token.
# The real engine's gate is covered end to end by the browser's tests
# (test/unit/agent/soul.integration.test.js, test/e2e/soul.test.mjs).
_TMP = tempfile.TemporaryDirectory()
os.environ.setdefault("BUCKS_DATA_DIR", _TMP.name)
os.environ.setdefault("BUCKS_HOME", _TMP.name)
os.environ.setdefault("MODEL_PROVIDER", "edge")

from fastapi import FastAPI, WebSocket  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import local_auth  # noqa: E402

AUTH = {"Authorization": "Bearer test-token-123"}


def _app(prefix: str) -> FastAPI:
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.post("/agent")
    def agent():
        return {"ran": True}

    @app.websocket("/ws")
    async def ws(socket: WebSocket):
        await socket.accept()
        await socket.send_text("hi")
        await socket.close()

    local_auth.install(app, prefix)
    return app


class TokenGate(unittest.TestCase):
    def setUp(self):
        os.environ["UNIT_TOKEN"] = "s3cret"
        self.client = TestClient(_app("UNIT"))

    def tearDown(self):
        os.environ.pop("UNIT_TOKEN", None)
        os.environ.pop("UNIT_CORS_ORIGINS", None)

    def test_health_is_open_everything_else_needs_the_token(self):
        self.assertEqual(self.client.get("/health").status_code, 200)
        self.assertEqual(self.client.post("/agent").status_code, 401)
        self.assertEqual(self.client.post("/agent", headers={"Authorization": "Bearer wrong"}).status_code, 401)
        self.assertEqual(self.client.post("/agent", headers={"Authorization": "s3cret"}).status_code, 401)
        r = self.client.post("/agent", headers={"Authorization": "Bearer s3cret"})
        self.assertEqual((r.status_code, r.json()), (200, {"ran": True}))
        self.assertEqual(self.client.post("/health").status_code, 401, "only GET/HEAD /health is open")

    def test_a_web_page_cannot_get_through(self):
        # A "simple" cross-origin request (no preflight) and a preflight both fail.
        r = self.client.post("/agent", headers={"Origin": "https://evil.example", "Content-Type": "text/plain"}, content=b"{}")
        self.assertEqual(r.status_code, 401)
        r = self.client.options("/agent", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
        self.assertNotIn("access-control-allow-origin", {k.lower() for k in r.headers})

    def test_websocket_takes_the_token_as_query_parameter(self):
        with self.client.websocket_connect("/ws?token=s3cret") as ws:
            self.assertEqual(ws.receive_text(), "hi")
        with self.assertRaises(Exception):
            with self.client.websocket_connect("/ws?token=nope") as ws:
                ws.receive_text()

    def test_legacy_mode_without_a_token_stays_open_with_cors_star(self):
        os.environ.pop("UNIT_TOKEN", None)
        client = TestClient(_app("UNIT"))
        r = client.post("/agent", headers={"Origin": "http://localhost:1234"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers.get("access-control-allow-origin"), "*")

    def test_explicit_cors_list(self):
        os.environ["UNIT_CORS_ORIGINS"] = "http://localhost:1420, bucks://app"
        client = TestClient(_app("UNIT"))
        r = client.options("/agent", headers={"Origin": "http://localhost:1420", "Access-Control-Request-Method": "POST"})
        self.assertEqual(r.headers.get("access-control-allow-origin"), "http://localhost:1420")
        self.assertEqual(local_auth.cors_origins("NOPE", "tok"), [])
        self.assertEqual(local_auth.cors_origins("NOPE", ""), ["*"])


class SoulEngineApp(unittest.TestCase):
    """The real soul_engine app behind the gate (no lifespan: nothing is started or downloaded)."""

    @classmethod
    def setUpClass(cls):
        cls.engine = importlib.import_module("soul_engine")
        cls.edge = importlib.import_module("edge_llm")
        cls.client = TestClient(local_auth.BearerTokenMiddleware(cls.engine.app, token="test-token-123"))

    def test_engine_behind_the_gate(self):
        self.assertEqual(self.client.get("/providers").status_code, 401)
        self.assertEqual(self.client.get("/providers", headers=AUTH).status_code, 200)
        self.assertEqual(self.client.post("/agent", json={"message": "hi"}).status_code, 401)
        self.assertIn('local_auth.install(app, "BUCKS_SOUL")', (AGENT / "soul_engine.py").read_text())
        self.assertIn('local_auth.install(app, "BUCKS_MCP")', (AGENT / "mcp_server.py").read_text())

    def test_health_reports_a_failed_model_load(self):
        self.edge._current_model_id = None
        self.edge._load_error = None
        self.assertEqual(self.client.get("/health").json()["mode"], "loading")
        self.edge._load_error = "ModuleNotFoundError: No module named 'llama_cpp'"
        try:
            body = self.client.get("/health").json()
            self.assertEqual(body["mode"], "error")
            self.assertIn("llama_cpp", body["error"])
        finally:
            self.edge._load_error = None

    def test_default_backend_is_on_device(self):
        saved = os.environ.pop("MODEL_PROVIDER", None)
        try:
            import config
            self.assertEqual(importlib.reload(config).MODEL_PROVIDER, "edge")
        finally:
            if saved is not None:
                os.environ["MODEL_PROVIDER"] = saved
            importlib.reload(config)


class RuntimePaths(unittest.TestCase):
    def test_data_dir_follows_bucks_data_dir(self):
        import runtime_paths
        self.assertEqual(runtime_paths.data_dir(), Path(os.environ["BUCKS_DATA_DIR"]))
        saved = os.environ.pop("BUCKS_DATA_DIR")
        try:
            self.assertEqual(runtime_paths.data_dir(), AGENT.parent / "data")
        finally:
            os.environ["BUCKS_DATA_DIR"] = saved

    def test_session_store_has_no_built_in_cloud_database(self):
        os.environ.pop("DATABASE_URL", None)
        store = importlib.import_module("memory.session_store")
        store = importlib.reload(store)
        self.assertEqual(store.POSTGRES_URL, "")
        self.assertIsNone(store._get_pg_conn())
        self.assertNotIn("supabase.co", (AGENT / "memory" / "session_store.py").read_text())


class ShellAllowlist(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # shell_tools decorates with crewai's @tool; stub it so the test needs no crewai.
        crewai = types.ModuleType("crewai")
        crewai_tools = types.ModuleType("crewai.tools")
        crewai_tools.tool = lambda _name: (lambda fn: fn)
        sys.modules.setdefault("crewai", crewai)
        sys.modules.setdefault("crewai.tools", crewai_tools)
        cls.shell = importlib.import_module("tools.shell_tools")

    def test_metacharacters_cannot_smuggle_commands(self):
        allowed = self.shell._is_allowed
        self.assertTrue(allowed("git status"))
        self.assertTrue(allowed("ls -la"))
        for cmd in ("ls ; rm -rf ~", "ls && curl evil.sh", "ls | sh", "echo `id`", "echo $(id)",
                    "cat x > ~/.bashrc", "cat < /etc/passwd", "ls\nrm -rf /", "rm -rf /"):
            self.assertFalse(allowed(cmd), cmd)

    def test_runs_without_a_shell_and_stays_in_the_project(self):
        out = self.shell.run_shell("echo hello world")
        self.assertEqual(out, "hello world")
        self.assertIn("must stay inside the project", self.shell.run_shell("ls -la", cwd="../../.."))


if __name__ == "__main__":
    unittest.main()

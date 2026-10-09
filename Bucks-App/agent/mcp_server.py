"""
Bucks MCP (Model Context Protocol) Server

Exposes the Bucks tool registry as MCP-compliant capabilities for Claude Code,
other Claude instances, and MCP clients.

Runs alongside Soul Engine on a separate port (default 9999) to provide:
  - File system access (read, write, list, watch directories)
  - Web search and research capabilities
  - Task orchestration and workflow management
  - IPFS decentralized operations
  - And all 30+ tools from the Bucks registry

MCP Protocol: https://modelcontextprotocol.io/
"""

import os
import json
import asyncio
import inspect
import logging
from typing import Any, Optional
from contextlib import asynccontextmanager, aclosing

import httpx
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from tools.registry import TOOLS, get_tool

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("mcp-server")

HOST = "127.0.0.1"
PORT = int(os.getenv("BUCKS_MCP_PORT", "9999"))

app = FastAPI(
    title="Bucks MCP Server",
    description="Model Context Protocol server for Bucks agentic capabilities",
    version="1.0.0"
)

# CORS for Claude Code and other clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── MCP Protocol Responses ──────────────────────────────────────────────────

def mcp_resource_list() -> dict:
    """List all available MCP resources."""
    return {
        "resources": [
            {
                "uri": "file:///",
                "name": "Local File System",
                "description": "Read, write, and monitor local files",
                "mimeType": "application/x-directory"
            },
            {
                "uri": "bucks://tools",
                "name": "Bucks Tools Registry",
                "description": "All 30+ tools available in Bucks",
                "mimeType": "application/json"
            },
            {
                "uri": "bucks://workflows",
                "name": "Workflow Management",
                "description": "Create and manage multi-step workflows",
                "mimeType": "application/json"
            }
        ]
    }


_PY_TO_JSON = {
    str: "string", int: "integer", float: "number",
    bool: "boolean", list: "array", dict: "object",
}


def _schema_from_signature(fn) -> dict:
    """Derive a JSON Schema for a tool from its Python signature.

    No tool in the registry passes an explicit ``schema``, so reading
    ``tool.schema`` alone advertised ``properties: {}`` for all 35 tools — an
    MCP client had no way to learn that ``web_search`` takes a ``query``, and
    every call it composed was a guess.
    """
    props: dict[str, Any] = {}
    required: list[str] = []
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return {"type": "object", "properties": {}, "required": []}

    for name, param in sig.parameters.items():
        if name in ("self", "cls") or param.kind in (
            inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD
        ):
            continue
        entry: dict[str, Any] = {"type": _PY_TO_JSON.get(param.annotation, "string")}
        if param.default is inspect.Parameter.empty:
            required.append(name)
        else:
            entry["default"] = param.default
        props[name] = entry

    return {"type": "object", "properties": props, "required": required}


def mcp_tools_list() -> dict:
    """List all tools in MCP format."""
    tools = []
    for tool_name, tool in TOOLS.items():
        explicit = tool.schema or {}
        schema = (
            {
                "type": "object",
                "properties": explicit.get("properties", {}),
                "required": explicit.get("required", []),
            }
            if explicit.get("properties")
            else _schema_from_signature(tool.fn)
        )
        tools.append({
            "name": tool_name,
            "description": tool.description,
            "inputSchema": schema,
            "safe": tool.safe,
        })
    return {"tools": tools}


# ─── MCP Endpoints ───────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ready",
        "version": "1.0.0",
        "service": "bucks-mcp-server",
        "tools_available": len(TOOLS)
    }


@app.get("/resources")
async def list_resources():
    """MCP: List all available resources."""
    return mcp_resource_list()


@app.get("/tools")
async def list_mcp_tools():
    """MCP: List all available tools."""
    return mcp_tools_list()


@app.post("/tools/call")
async def call_tool(request: dict):
    """MCP: Execute a tool with given parameters.

    Request format:
    {
        "name": "tool_name",
        "arguments": {
            "param1": "value1",
            "param2": "value2"
        }
    }
    """
    try:
        tool_name = request.get("name")
        arguments = request.get("arguments", {})

        if not tool_name:
            raise HTTPException(status_code=400, detail="Tool name required")

        tool = get_tool(tool_name)
        if not tool:
            raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")

        # Execute the tool
        try:
            result = await tool.run(**arguments) if asyncio.iscoroutinefunction(tool.fn) else tool.fn(**arguments)
            return {
                "success": True,
                "result": result,
                "tool": tool_name
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "tool": tool_name
            }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/resources/read")
async def read_resource(uri: str):
    """MCP: Read a file resource.

    Query parameter:
      uri: file:///path/to/file
    """
    if not uri.startswith("file://"):
        raise HTTPException(status_code=400, detail="Invalid URI scheme (use file://)")

    file_path = uri[7:]  # Strip 'file://'

    try:
        # Use safe_path to validate and read
        from tools.fs_impl import read_file as fs_read_file
        content = fs_read_file(file_path)
        # fs_impl reports failure as a "Read error: …" string rather than
        # raising, so without this check a denied path came back as HTTP 200
        # with the error text sitting where the file content should be — a
        # client cannot tell that apart from a file that happens to say that.
        if content.startswith("Read error: "):
            raise HTTPException(status_code=400, detail=content[len("Read error: "):])
        return {
            "uri": uri,
            "content": content,
            "mimeType": "text/plain"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/resources/write")
async def write_resource(request: dict):
    """MCP: Write to a file resource.

    Request format:
    {
        "uri": "file:///path/to/file",
        "content": "file content here"
    }
    """
    uri = request.get("uri", "")
    content = request.get("content", "")

    if not uri.startswith("file://"):
        raise HTTPException(status_code=400, detail="Invalid URI scheme (use file://)")

    file_path = uri[7:]  # Strip 'file://'

    try:
        from tools.fs_impl import write_file as fs_write_file
        result = fs_write_file(file_path, content)
        if result.startswith("Write error: "):
            raise HTTPException(status_code=400, detail=result[len("Write error: "):])
        return {
            "uri": uri,
            "success": True,
            "result": result
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/resources/list")
async def list_directory_resource(uri: str):
    """MCP: List files in a directory.

    Query parameter:
      uri: file:///path/to/directory
    """
    if not uri.startswith("file://"):
        raise HTTPException(status_code=400, detail="Invalid URI scheme (use file://)")

    dir_path = uri[7:]  # Strip 'file://'

    try:
        from tools.fs_impl import list_directory as fs_list_directory
        result = fs_list_directory(dir_path)
        if result.startswith("List error: "):
            raise HTTPException(status_code=400, detail=result[len("List error: "):])
        return {
            "uri": uri,
            "contents": result,
            "mimeType": "application/json"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.websocket("/resources/watch")
async def watch_resource(
    websocket: WebSocket,
    uri: str,
    patterns: str = "",
    recursive: bool = True,
):
    """MCP: Watch a directory for changes (WebSocket).

    Query parameters:
      uri:       file:///path/to/directory
      patterns:  optional comma-separated globs, e.g. "*.py,*.md"
      recursive: descend into subdirectories (default true)

    Sends events as JSON when files change:
    {
        "event": "created|modified|deleted",
        "path": "/path/to/file",
        "timestamp": 1234567890
    }
    """
    if not uri.startswith("file://"):
        await websocket.close(code=4000, reason="Invalid URI scheme (use file://)")
        return

    watch_path = uri[7:]  # Strip 'file://'

    # Validate before accepting: a rejected watch should fail the handshake,
    # not open a stream that silently never emits.
    try:
        from tools.fs_impl import safe_path
        resolved = safe_path(watch_path)
        if not resolved.is_dir():
            raise NotADirectoryError(f"Not a directory: {resolved}")
    except Exception as e:
        await websocket.close(code=4001, reason=str(e)[:120])
        return

    await websocket.accept()

    pats = [p for p in (patterns or "").split(",") if p.strip()] or None

    try:
        await websocket.send_json({
            "status": "watching",
            "path": str(resolved),
            "patterns": pats,
            "recursive": recursive,
        })
    except Exception:
        return

    # A quiet watch never calls send(), and Starlette only surfaces a closed
    # socket through receive() — so a pump that just awaits file events sits
    # blocked on an empty queue forever after the client goes away, keeping its
    # watchdog observer thread alive. Racing the pump against a reader is what
    # actually bounds the observer's lifetime; leaked one thread per connection
    # without it.
    pump = asyncio.create_task(_watch_pump(websocket, str(resolved), pats, recursive))
    reader = asyncio.create_task(_await_disconnect(websocket))
    try:
        _done, pending = await asyncio.wait(
            {pump, reader}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        # Await the cancelled pump so aclosing() finishes stopping the observer
        # before this handler returns.
        await asyncio.gather(*pending, return_exceptions=True)
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass


async def _await_disconnect(websocket: WebSocket) -> None:
    """Resolve as soon as the client goes away."""
    try:
        while True:
            await websocket.receive()
    except Exception:
        return


async def _watch_pump(websocket: WebSocket, path: str,
                      patterns: Optional[list], recursive: bool) -> None:
    """Forward file events until cancelled; always stops the observer."""
    from tools.watch_impl import watch_stream
    async with aclosing(
        watch_stream(path, patterns=patterns, recursive=recursive)
    ) as stream:
        async for event in stream:
            await websocket.send_json(event)


@app.get("/capabilities")
async def get_capabilities():
    """Get server capabilities in MCP format."""
    return {
        "version": "1.0.0",
        "capabilities": {
            "resources": {
                "listChanged": False,
                "subscribe": True
            },
            "tools": {
                "listChanged": False
            },
            "sampling": {
                "supported": True
            }
        },
        "tools_count": len(TOOLS),
        "tool_categories": {
            "file_operations": ["read_file", "write_file", "list_directory", "git_status"],
            "web": ["web_search", "fetch_url", "extract_links"],
            "research": ["deep_research", "image_search", "weather_lookup"],
            "ipfs": ["ipfs_upload_text", "ipfs_cat_text", "dweb_search"],
            "calendar": ["calendar_add", "calendar_list"],
            "commerce": ["product_search", "track_order"]
        }
    }


# ─── Integration with Soul Engine ────────────────────────────────────────────

SOUL_ENGINE_URL = os.getenv("BUCKS_SOUL_URL", "http://127.0.0.1:8765")


@app.get("/soul/status")
async def get_soul_engine_status():
    """Proxy Soul Engine health status."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{SOUL_ENGINE_URL}/health")
            if response.status_code == 200:
                return response.json()
    except Exception as e:
        return {"status": "offline", "error": str(e)}

    return {"status": "offline"}


@app.post("/soul/query")
async def query_soul_engine(request: dict):
    """Send a query to Soul Engine and stream the response.

    Request format:
    {
        "message": "What is Bucks?",
        "system": "You are a helpful assistant",
        "stream": true
    }
    """
    try:
        async def generate():
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream(
                    "POST",
                    f"{SOUL_ENGINE_URL}/chat",
                    json=request
                ) as response:
                    async for line in response.aiter_lines():
                        if line:
                            yield line + "\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Startup & Shutdown ──────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info(f"[MCP] Bucks MCP Server starting on {HOST}:{PORT}")
    log.info(f"[MCP] Exposing {len(TOOLS)} tools via MCP protocol")
    log.info(f"[MCP] Soul Engine proxy: {SOUL_ENGINE_URL}")
    yield
    log.info("[MCP] Bucks MCP Server shutting down")


app.router.lifespan_context = lifespan


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")

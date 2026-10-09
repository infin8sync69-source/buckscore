# Bucks MCP (Model Context Protocol) Server

The Bucks MCP Server exposes the Bucks agentic capabilities as MCP-compliant resources and tools for Claude Code, other Claude instances, and any MCP-compatible client.

## What's Exposed?

### Resources
- **`file:///`** - Local file system access (read, write, list, watch)
- **`bucks://tools`** - All 30+ tools in the Bucks registry
- **`bucks://workflows`** - Workflow and task management

### Tools Available (30+)

**File Operations:**
- `read_file` - Read file contents
- `write_file` - Write/create files
- `list_directory` - List directory contents
- `git_status` - Check git status
- `git_diff` - Show git changes

**Web & Research:**
- `web_search` - Search with DuckDuckGo
- `fetch_url` - Fetch and parse web pages
- `extract_links` - Extract hyperlinks
- `deep_research` - Multi-source research with images
- `image_search` - Search images
- `youtube_search` - Search YouTube
- `weather_lookup` - Get weather data

**IPFS & Decentralized:**
- `ipfs_upload_text` - Upload to IPFS
- `ipfs_cat_text` - Read from IPFS
- `dweb_publish` - Publish to Bucks dWeb
- `dweb_search` - Search dWeb index

**Calendar & Commerce:**
- `calendar_add` - Add calendar event
- `calendar_list` - List calendar events
- `product_search` - Search products
- `track_order` - Track shipments

**Cluster Operations:**
- `cluster_list_members` - List cluster members
- `cluster_list_files` - List shared files
- `cluster_pin` - Pin file locally
- `cluster_recommend` - Vote for files

## How to Use

### Starting Bucks Starts MCP Too

When you launch Bucks:
```bash
npm start
```

The MCP server auto-starts on port 9999 (configurable via `BUCKS_MCP_PORT` env var).

### Connecting Claude Code

In Claude Code, use the MCP server to access Bucks tools:

```bash
# The server runs at http://127.0.0.1:9999
curl http://127.0.0.1:9999/health
```

### Using from Claude Code

1. **Install the Bucks MCP in Claude Code settings**
2. **Use tools like:**
   ```
   @read_file path=/Users/you/project/README.md
   @write_file path=/Users/you/project/hello.txt content="Hello world"
   @web_search query="latest AI research"
   ```

## API Endpoints

### Health & Status

```http
GET /health
Response: {
  "status": "ready",
  "version": "1.0.0",
  "tools_available": 34
}
```

### List Tools

```http
GET /tools
Response: {
  "tools": [
    {
      "name": "read_file",
      "description": "Read a file in the Bucks project",
      "inputSchema": {...}
    },
    ...
  ]
}
```

### Call a Tool

```http
POST /tools/call
Content-Type: application/json

{
  "name": "read_file",
  "arguments": {
    "path": "/path/to/file.txt"
  }
}

Response: {
  "success": true,
  "result": "file contents here",
  "tool": "read_file"
}
```

### Read File Resource

```http
GET /resources/read?uri=file:///path/to/file.txt
Response: {
  "uri": "file:///path/to/file.txt",
  "content": "file contents",
  "mimeType": "text/plain"
}
```

### Write File Resource

```http
POST /resources/write
Content-Type: application/json

{
  "uri": "file:///path/to/file.txt",
  "content": "new content here"
}

Response: {
  "uri": "file:///path/to/file.txt",
  "success": true,
  "result": "..."
}
```

### List Directory

```http
GET /resources/list?uri=file:///path/to/directory
Response: {
  "uri": "file:///path/to/directory",
  "contents": "file listing...",
  "mimeType": "application/json"
}
```

### Watch Directory (WebSocket)

Backed by `watchdog`. The path goes through the same allowed-roots check as a
read, and a watch on a path you have not granted is **rejected at the
handshake** rather than opening a stream that never emits.

```
ws://127.0.0.1:9999/resources/watch?uri=file:///path/to/dir&patterns=*.py,*.md&recursive=true
```

First frame confirms what is being watched:

```json
{"status":"watching","path":"/path/to/dir","patterns":["*.py","*.md"],"recursive":true}
```

Then one frame per change:

```json
{"event":"created","path":"/path/to/dir/a.py","is_directory":false,"timestamp":1786705509.1}
```

`event` is one of `created`, `modified`, `deleted`, `moved`.

**Filtering.** `node_modules`, `.git`, `__pycache__`, `.venv`, `dist`, `build`,
`.cache` and editor temp files are dropped, as are credential paths from the
deny-list. Repeated writes to one file within 250ms collapse into a single
event — editors emit several per save.

**For workflows**, use the `watch_directory` tool instead: a workflow step is
request/response and cannot hold a stream open.

```json
{"name":"watch_directory",
 "arguments":{"path":"/path/to/dir","duration_seconds":5,"patterns":["*.md"]}}
```

It watches for the given window (capped at 300s, 200 events) and returns
`{path, watched_seconds, count, truncated, events[]}`.

### Query Soul Engine

```http
POST /soul/query
Content-Type: application/json

{
  "message": "What is Bucks?",
  "system": "You are a helpful assistant",
  "stream": true
}

Response: Server-Sent Events stream of tokens
```

## Configuration

### Environment Variables

```bash
# MCP Server port (default: 9999)
export BUCKS_MCP_PORT=9999

# Soul Engine URL (default: http://127.0.0.1:8765)
export BUCKS_SOUL_URL=http://127.0.0.1:8765
```

### Start with Custom Port

```bash
BUCKS_MCP_PORT=8000 npm start
```

## Architecture

```
Electron Main Process (main.js)
  ├─ mcp-bridge.js (Electron side)
  │  └─ Launches Python MCP server process
  │
  └─ mcp_server.py (Python FastAPI server)
     ├─ Wraps tools/registry.py (30+ tools)
     ├─ Wraps tools/fs_impl.py (file system with safety)
     ├─ Proxies to Soul Engine (localhost:8765)
     └─ Exposes MCP protocol endpoints
```

## Security

### File Access
- All file paths validated via `fs_impl.safe_path()`
- Prevents directory escape attacks (symlinks resolved before the check)
- Max read: 8000 characters
- Max directory listing: 100 entries

**Which folders are reachable.** By default the tools are confined to the Bucks
project directory — a read of `~/Desktop/notes.txt` is refused with *"Path
outside allowed roots"*. Grant more with `BUCKS_ALLOWED_ROOTS` (colon-separated
absolute paths):

```bash
export BUCKS_ALLOWED_ROOTS="$HOME/Desktop:$HOME/Documents"
```

`start.sh` sets this for you; edit the line there to change the grant.

**Always denied**, even nested inside a granted root: `.ssh`, `.aws`, `.gnupg`,
`.kube`, `.docker`, `.netrc`, `.env`, `id_rsa`, `id_ed25519`, `credentials`,
`Keychains`, `.git-credentials`, `.npmrc`, `.pypirc`. Widening a root does not
expose credentials sitting under it. See `DENIED_NAMES` in
`agent/tools/fs_impl.py`.

### Tool Safety Gates
- State-changing tools marked as requiring user confirmation
- Tool execution happens in isolated Python processes
- No direct shell access (only through execute_code tool)

### Network
- MCP server only listens on localhost (127.0.0.1)
- Soul Engine proxy validates responses
- CORS enabled for Claude Code integration

## Troubleshooting

### MCP Server Not Starting

1. Check if port 9999 is in use:
   ```bash
   lsof -i :9999
   ```

2. Change port:
   ```bash
   BUCKS_MCP_PORT=9998 npm start
   ```

3. Check logs:
   ```bash
   # Electron console logs show MCP status
   # Look for "[MCP]" messages
   ```

### Tools Not Available

1. Verify Soul Engine is running (it's a dependency):
   ```bash
   curl http://127.0.0.1:8765/health
   ```

2. List available tools:
   ```bash
   curl http://127.0.0.1:9999/tools
   ```

3. Check tool status:
   ```bash
   curl http://127.0.0.1:9999/capabilities
   ```

### File Operations Failing

1. Check path is absolute or relative to project root
2. Verify read permissions: `ls -la /path/to/file`
3. Check file isn't too large (max 8000 chars for reading)

## Integration with Claude Code

### Step 1: Add MCP Server to Claude Code

In Claude Code `.claude/launch.json`:
```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "bucks-mcp",
      "url": "http://127.0.0.1:9999"
    }
  ]
}
```

### Step 2: Use Bucks Tools

```
@read_file path=/path/to/file
@web_search query="Claude API"
@execute_code language=python code="print('Hello from Bucks!')"
```

## Not implemented

- **Batch file operations** (read/write/transform many files in one call). No
  code exists; use a workflow with one task per file meanwhile.
- **Multi-agent coordination** — the cluster tools expose peers, but there is no
  task delegation across them.

Implemented and verified: file watching (`/resources/watch`, see below),
workflow endpoints (`TASK_ORCHESTRATION.md`), IPFS dynamic tool loading
(`ipfs_dynamic_load_tool`).

## See Also

- [Soul Engine](agent/soul_engine.py) - Local AI inference server
- [Tool Registry](agent/tools/registry.py) - 30+ available tools
- [MCP Spec](https://modelcontextprotocol.io/) - Protocol documentation

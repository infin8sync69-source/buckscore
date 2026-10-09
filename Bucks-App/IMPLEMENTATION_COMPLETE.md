# Agentic capabilities — what actually works

Status of the MCP server, task orchestration, and file tooling added to Bucks.
Last verified **2026-08-14** by running the checks quoted below against a live
app (Soul Engine `:8765`, MCP `:9999`).

This file previously claimed "production ready" for code that had never
executed a tool. Everything below is either something a recorded command
produced, or is listed as not implemented. If a claim here has no evidence
next to it, treat it as unverified.

---

## Works, with evidence

### Soul Engine auto-start
Pre-existing, not added here. `electron/main.js` calls `soulEngine.start()`;
the supervisor adopts a running engine or spawns one, clears port conflicts,
and health-polls.

```
[SoulEngine] ready
{"model":"qwen2.5:7b","device":"metal","mode":"local_llm","online":true}
```

### MCP server — 36 tools over the Model Context Protocol
`agent/mcp_server.py`, launched by `electron/mcp-bridge.js` on `:9999`.

```
{"status":"ready","version":"1.0.0","tools_available":36}
```

Tool parameter schemas are derived from each function's Python signature, so
clients can actually call them:

```json
{"name":"web_search","inputSchema":{"type":"object",
 "properties":{"query":{"type":"string"},"max_results":{"type":"integer","default":6}},
 "required":["query"]}}
```

### Local file access outside the project
Controlled by `BUCKS_ALLOWED_ROOTS` (set in `start.sh`). Default without it is
project-directory only.

```
list ~/Desktop  → 📁 Bucks Core, 📁 QNN, 📁 Zoho …
write           → ✓ Written: Desktop/bucks-mcp-check.txt
~/.ssh/id_rsa   → HTTP 400 (deny-list, checked per path component)
```

### Task orchestration
`agent/task_orchestrator.py` plus `/workflows*` endpoints on Soul Engine.
Dependency-ordered batches, parallel within a batch, retry with exponential
backoff, per-task timeout, SQLite persistence.

```
2-task workflow with a dependency → completed, real output from both tasks
cyclic workflow                   → failed: "Dependency cycle — unreachable tasks: A, B"
fresh process                     → list_workflows read prior runs back from SQLite
```

### Directory watching
`agent/tools/watch_impl.py`, `watchdog` 6.0. WebSocket `/resources/watch` for
streaming, `watch_directory` tool for workflow steps.

```
created  /tmp/watch-demo/alpha.txt      (node_modules/ churn filtered out)
patterns=*.md  → only keep.md
ungranted path → rejected at handshake, not a silently-empty stream
18 connect/disconnect cycles → thread count flat at 7
```

---

## Not implemented

- **Batch file operations.** No code. Use one workflow task per file.
- **Conditional / looping workflows.** Tasks form a DAG; no if-else or repeat.
- **Distributed execution.** All tasks run on the local machine.
- **Task resource limits and priority.** Every task is treated equally.
- **Multi-agent delegation.** Cluster tools list peers but do not hand off work.

---

## Bugs found and fixed after the first pass

Recorded because each one reported success while doing nothing — the failure
mode worth remembering.

| Defect | How it presented |
|---|---|
| Orchestrator built without a `tool_executor` | Workflows returned `completed, 100%` having run the mock; no tool ever executed |
| `safe_path` confined to the project root | `~/Desktop` refused — the headline feature did not work |
| No tool passed a `schema`, and MCP read only `tool.schema` | All tools advertised empty `inputSchema`; a client could only guess arguments |
| Workflows saved but never loaded | Any lookup from another process or after restart returned "not found" |
| Kahn's sort without cycle detection | Cyclic workflow reported `completed`, silently skipping the cycle |
| `fs_impl` returns errors as strings | `resources/read` returned HTTP 200 with the error text as file content |
| Watch pump blocked on an empty queue | Starlette surfaces disconnects only via `receive()`, so a quiet watch never noticed the client left — leaked an observer thread per connection |
| `#url-search-wrap:focus-within` defined 3× | The winner was in an inline `<style>` in index.html, which loads after every `<link>`; the omnibox grew 260→380px on click and shoved the whole nav bar sideways |
| `FLOAT_OVERLAYS` listed a docked sidebar | `#chat-tab-history-panel` is permanent, always `display:flex` — so "a menu is open" was true forever and **every website rendered blank** |
| Float-overlay event dispatched per tab view | The second dispatch saw the freeze the first applied, concluded it hadn't started one, and never lifted it — page stayed blank |
| `var(--text-muted)` never defined | 3 rules with no fallback, so `.bucks-stat-label` and two others inherited their parent's colour instead of rendering muted |
| Composer `<select>` had no `appearance:none` | macOS drew its own widget — a pale filled box in an otherwise dark flat bar |
| Placeholder set to 78 chars in JS | The dock fits ~65, so it cut mid-word (`…try "Mysor`), reading as a rendering fault |

---

## Reference

- MCP protocol and endpoints — [MCP_SERVER.md](MCP_SERVER.md)
- Workflow API and examples — [TASK_ORCHESTRATION.md](TASK_ORCHESTRATION.md)
- File access grant — the `BUCKS_ALLOWED_ROOTS` line in [start.sh](start.sh)

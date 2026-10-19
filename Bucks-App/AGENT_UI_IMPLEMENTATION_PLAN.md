# Bucks Browser — Agent UI & Agentic Capabilities Implementation Plan

**Date:** 2026-10-19 · **Status:** Proposal · **Scope:** the Electron browser and Soul Engine in `Bucks-App/` (`electron/` + `agent/`)

This plan brings the browser's agent UI in line with the 2026 standards: A2UI for the UI an agent describes, AG-UI for the event stream, and MCP Apps / WebMCP for third-party tools and UI. It also adds the safety floor needed before the agent is trusted to act on a user's behalf.

The Tauri/Svelte app in the separate `Bucks-browser` repo is out of scope, except where noted. Phase 2 deliberately keeps it able to render the same UI stream later.

---

## 1. Where things stand today

| Area | What exists | Where |
|---|---|---|
| Agent stream | `POST /agent` streams SSE events: `session`, `thinking`, `tool_call`, `tool_result`, `ui_component`, `token`, `browser_action`, `error`, `cancelled`, `done` | `agent/soul_engine.py:1811`; consumed at `electron/a2ui-engine.js:2195-2330` |
| UI contract | `{component, title, data}` envelope; 15 fixed components built by deterministic builders; `validate_component` for the model-driven path | `agent/genui.py`; rendered by `renderComponent` at `electron/renderer.js:5644` and `A2UIResults.normalize` in `electron/a2ui-results.js` |
| SSE clients | Three separate parsers talk to `127.0.0.1:8765` directly | `electron/a2ui-engine.js:19`, `electron/ephemeral-renderer.js:8`, `electron/renderer.js:4470` |
| Ephemeral surfaces | 5 context overlays that dissolve after 4s; Cmd/Ctrl+K popup window; agent overlay over a frozen page capture; New Tab response zone | `electron/ephemeral-ui.js`, `electron/ephemeral-window.js`, `electron/renderer.js:1118`, `:2558`, `:7186-7193` |
| Browser agent | Read/navigate/click/type/scroll/screenshot plus pane tools, run in the renderer | `BROWSER_TOOL_SCHEMAS` in `agent/soul_engine.py`; executor `electron/agent-browser-control.js` |
| Approval | A fixed list of tool names needs approval; 30s approval timeout; 90s remote-tool timeout; cancel endpoint | `STATE_CHANGING_TOOLS` at `agent/soul_engine.py:934`; `_await_approval` at `:1647`; UI `askApproval` at `electron/a2ui-engine.js:1983` |
| Trust UI | Citations linked into answers; a step trace; follow-up chips | `linkCitations` at `electron/a2ui-engine.js:1824`, `makeTrace` at `:1853` |
| MCP | Bucks runs an MCP **server** (port 9999). The browser is not an MCP **host**, so it cannot use external MCP servers or render MCP Apps | `agent/mcp_server.py`, `electron/mcp-bridge.js` |
| Tests | Playwright-driven Electron specs; pytest adversarial and endpoint suites | `electron/tests/*.spec.js`; `agent/tests/` |

### Problems this plan fixes

1. **"A2UI" here is not Google's A2UI.** Bucks uses the name for its own `{component,title,data}` envelope and `a2ui-*` files. The `Bucks-browser` Svelte app uses it for a third shape again: a single action object (`navigate`, `click`, `widget`, …) at `bucks-app/src/lib/AgentModule.svelte:13`. Google's A2UI (v0.9.1 stable, v1.0 RC) is a stream of surface messages built from a component catalog. Display and action are mixed together today.
2. **Approval depends on the tool name, not the situation.** `browser_read_page` can pull hostile page text into context, and a follow-up `browser_navigate` is approved the same way whether or not untrusted content is involved. Wallet and sensitive-site actions get no special treatment.
3. **The local agent API is open to any caller.** `soul_engine.py:971`, `mcp_server.py:47`, `server.py:41` and `server_lite.py:172` all use `allow_origins=["*"]` with no auth token. Any page loaded in a tab, or any local process, can call `/agent` and its server-side tools.
4. **Security items from `bucks_v1_todo.md` that are still open on this branch:**
   - C-02: `isInternalOrigin` uses `includes('index.html')` (`electron/main.js:173`).
   - C-08: `tabs:execJS` runs arbitrary code (`electron/tab-manager.js:337`).
   - C-13: renderers fetch 8765 directly.
   - C-20: `navigate()` only checks for a `scheme://` prefix (`electron/agent-browser-control.js:146`), so `javascript://…` and `file://…` get through.
5. **Every surface manages its own lifetime.** Overlays, the command bar, the page overlay and the New Tab zone each implement their own dismissal rules, and none can promote a result into something you keep.

---

## 2. Target architecture

```
 Soul Engine (agent/)                         Electron shell (electron/)
 ┌──────────────────────────┐   AG-UI events   ┌──────────────────────────────────────┐
 │ agent loop + tools       │ ───────────────► │ AgentStream  (one client, via IPC)   │
 │ genui builders ──► A2UI  │  (A2UI messages  │   │                                  │
 │   createSurface …        │   ride inside    │   ├─► SurfaceManager                 │
 │   deleteSurface          │   CUSTOM events) │   │     overlay · command bar ·      │
 │ policy engine (Rule of 2)│ ◄─────────────── │   │     inline · canvas · page ·     │
 └──────────────────────────┘  actions, tool   │   │     new-tab zone  (+ promote)    │
            ▲                  results,        │   └─► A2UI renderer (Bucks catalog)  │
            │                  approvals       │                                      │
     MCP servers (host) ◄── MCP Apps iframe ──►│ Action executor (agent-browser-ctl)  │
     WebMCP tools on pages ───────────────────►│ WebMCP bridge (document.modelContext)│
                                               └──────────────────────────────────────┘
```

### Principles

1. **Display and action are separate channels.** The agent changes the screen through A2UI messages and changes the world through tool calls. They never share a type field.
2. **Catalog-only rendering in the shell.** The model can only ask for components in the Bucks catalog. Arbitrary HTML is allowed only inside sandboxed MCP App iframes.
3. **Every surface has a declared lifetime.** Surfaces are ephemeral by default. Keeping one is an explicit `promote`.
4. **Authorization lives outside the model.** A deterministic policy engine decides allow / confirm / block. The model's own judgement is never the gate.
5. **Migrate behind adapters.** `renderer.js` is 9,885 lines, so there is no big-bang rewrite. Each phase ships behind a flag, with screenshot parity tests.

---

## 3. Phases

Estimates assume one developer familiar with the codebase. Phases 3 and 4 can run in parallel.

### Phase 0 — Safety floor (1–2 weeks, prerequisite for everything else)

| # | Task | Files |
|---|---|---|
| 0.1 | Generate a random token per launch in the main process and pass it to Soul Engine and the MCP server through env. Require it (header) on every non-health route. Restrict CORS to the shell origin. | `electron/main.js`, `electron/soul-engine-supervisor.js`, `electron/mcp-bridge.js`, `agent/soul_engine.py`, `agent/mcp_server.py`, `agent/server*.py` |
| 0.2 | Route all renderer→engine traffic through IPC (C-13). Add a streaming bridge in `preload.js` that the main process proxies with the token attached. Remove the three hardcoded `127.0.0.1:8765` constants. | `electron/preload.js`, `electron/main.js`, `electron/a2ui-engine.js`, `electron/ephemeral-renderer.js`, `electron/renderer.js` |
| 0.3 | Make `isInternalOrigin` an exact URL comparison (C-02). | `electron/main.js` |
| 0.4 | Restrict `tabs:execJS` to the shell's own `webContents` and to a named allowlist of scripts (for example `EXTRACT_SCRIPT`) instead of free-form code (C-08). | `electron/tab-manager.js`, `electron/preload.js`, `electron/agent-browser-control.js` |
| 0.5 | Give `navigate()` a scheme allowlist: `http`, `https`, `ipfs`, `ipns`, `bucks`. Reject `javascript:`, `file:`, `data:` and anything else (C-20). | `electron/agent-browser-control.js` |

**Done when:**
- pytest shows `/agent`, `/agent/approve/*` and `/agent/tool_result` return 401 without the token.
- A Playwright test shows a page loaded in a tab cannot reach the engine.
- `navigate('javascript://x')` and `navigate('file:///etc/passwd')` are rejected.
- Existing specs still pass.

### Phase 1 — One event protocol: AG-UI (≈2 weeks)

Map today's events onto AG-UI. Verify the exact event names against the AG-UI 1.0 spec before coding.

| Today | AG-UI |
|---|---|
| `session` | `RUN_STARTED` (thread/run ids) |
| `token` | `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` |
| `thinking` | reasoning events, or `STEP_STARTED` / `STEP_FINISHED` |
| `tool_call`, `tool_result` | `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` / `TOOL_CALL_RESULT` |
| `browser_action` | frontend tool call, plus a human-in-the-loop interrupt when approval is needed |
| `ui_component` | `CUSTOM` event named `a2ui` carrying A2UI messages (Phase 2) |
| `error` / `cancelled` / `done` | `RUN_ERROR` / `RUN_FINISHED` (with a cancelled reason) |
| goals / workflow progress | `STATE_SNAPSHOT` / `STATE_DELTA` |

Tasks:
- **Server:** add an encoder layer in Soul Engine, selected by request flag, so old and new formats run side by side during migration. Prefer the official AG-UI Python SDK if its dependencies are acceptable; otherwise hand-roll typed events against the published JSON Schema.
- **Shell:** add one `agent-stream.js` client that parses AG-UI and exposes normalized callbacks. Replace the three SSE parsers with it.
- **Approval:** make it an interrupt/resume pair instead of the current parked-future plus `_nxApprove`/`_nxDeny` globals.

**Done when:**
- A golden-file test locks the event sequence for a scripted run (text, tool call, approval, component, cancel).
- All surfaces run off `agent-stream.js`.
- The legacy format is deleted at the end of Phase 2.

### Phase 2 — One UI contract: A2UI v0.9 (≈3 weeks)

- **Bucks catalog.** Publish `electron/a2ui/catalog/bucks-v1.json` with a JSON Schema for each of the 15 current components:
  - answer, list, cta_row, product_grid, stat_cards, table, chart, image_gallery, video, research, weather, timeline, checklist, accordion, code;
  - plus the new approval card, wallet-address card and IPFS-file card.
- **Server.** Keep the deterministic builders in `genui.py` as the default; small local models are unreliable at nested JSON. Feed their output to an adapter that emits:
  - `createSurface` (with `catalogId`);
  - `updateComponents` (a flat list with a `root`);
  - `updateDataModel`;
  - `deleteSurface` when a surface expires.
  - `validate_component` becomes validation against the catalog schema.
  - The model-driven `render_component` path uses A2UI's prompt-first schema, with strict validation and a text fallback.
- **Shell renderer.** Start with a thin in-house interpreter for the four v0.9 messages that delegates to the existing component renderers. That needs no build step, which fits the script-tag architecture.
  - Keep wire compatibility so it can be swapped for `@a2ui/web_core` later if a bundler is added.
  - Check conformance against the A2UI sample messages.
- **Actions back to the agent.** Component actions become A2UI actions with IDs, posted back through `agent-stream.js`. This replaces the ad-hoc `actionPayload.type` switch at `electron/a2ui-engine.js:2585`.
  - Prepare for v1.0: use `actionResponse` for typeahead and validation, and `surfaceProperties` instead of a theme.
  - Styling stays in the `styles.css` tokens.
- **Naming.** Retire "A2UI" as the name of the old envelope. `a2ui-engine.js` becomes the answer surface and `A2UIResults` becomes the results layout. "A2UI" from now on means only the standard.
- **Other shell.** The same catalog lets the Svelte app in `Bucks-browser` render this stream later. Its action union in `AgentModule.svelte` should split into tools and display at that point.

**Done when:**
- Every existing component renders through the A2UI path, with Playwright screenshot parity against the current snapshots.
- Malformed component JSON falls back to text with no console errors.
- The deterministic builders still produce identical data.

### Phase 3 — Ephemeral surface manager (≈2 weeks)

- Add `electron/surface-manager.js`, the one owner of every agent surface. For each surface it tracks:
  - `id`;
  - `kind`: overlay, command bar, inline, canvas, page overlay, or new-tab zone;
  - `anchor`: tab, URL, selection or query;
  - `lifetime`: click-away, timeout, navigation, tab switch, or run end;
  - `promote()`.
- Move the existing dismissal logic into it:
  - the 5 overlays and `DISSOLVE_MS` in `ephemeral-ui.js`;
  - the Cmd+K window in `ephemeral-window.js`;
  - the freeze-frame overlay and New Tab zone in `renderer.js`.
- Server `deleteSurface` and local expiry both go through the manager.
- **Promote ("Keep")** saves a surface to a chat thread (`/chat/threads` already exists), or as a note or IPFS document through `ipfs_upload_text` / `dweb_publish`.
- **Decision needed:** the New Tab zone is really the persistent chat panel moved into the page. Either make it ephemeral (it clears on leaving) or present it as the chat.
- **Accessibility:**
  - Esc closes the topmost surface and focus returns to where it was.
  - Streaming answers are announced with `aria-live="polite"`.
  - `prefers-reduced-motion` is respected.

**Done when:**
- A test matrix passes for every surface kind against every dismissal trigger.
- No surface is left behind after navigation or a tab switch.
- A promoted surface can be found again after restart.

### Phase 4 — Answer UI polish (≈2 weeks, parallel with Phase 3)

- **Citations.** Extend `linkCitations` so tools return source IDs that map to claims. Add a hover preview (title, domain, snippet) and keep sources in view next to the answer.
- **Trace.** Show each tool and the domain it touched, collapse the trace when the run finishes, and never fall back to a generic spinner.
- **Streaming.** Extend the existing open-fence handling to half-finished tables and links. Every streaming surface gets a stop control wired to `/agent/cancel`.
- **Answers as components.** Route weather, places, products and media intents to components first, with text as the fallback.
- **Feedback.** Keep thumbs-up as the single control. Feed it into the eval set (Phase 6).

**Done when:**
- Playwright covers stop/cancel, citation hover and keyboard navigation of result layouts.
- An axe scan passes in both themes.

### Phase 5 — Agent capabilities (≈4–6 weeks, ordered by value)

1. **Policy engine (Rule of Two).** Replace the `STATE_CHANGING_TOOLS` name check with a per-action decision.
   - The rule: if the run has seen untrusted content, holds sensitive data, **and** the action changes state or communicates externally, it must be confirmed.
   - Sensitive sites (banking, auth, the wallet) and anything that signs or spends always require confirmation, showing the amount and recipient.
   - Allowed grants: "Allow once" and "Allow on this site for this session".
   - Add an alignment check: a cheap second model call that confirms a proposed state-changing action matches the user's stated goal.
   - Append every decision to a local audit log.
2. **WebMCP support.** Bucks is a browser, so it can implement `document.modelContext` (with a `navigator.modelContext` alias) in tab preloads.
   - Tools a page registers appear to the agent as `page:<origin>/<tool>`.
   - Declarative form annotations are supported too.
   - Tool descriptions are treated as untrusted input, and every call goes through the policy engine.
   - Ship behind a flag, falling back to `browser_read_page` snapshots.
3. **MCP host and MCP Apps.**
   - Let users connect external MCP servers.
   - Render MCP Apps `ui://` resources in a sandboxed frame: no Node integration, a strict CSP, and JSON-RPC over `postMessage` using the official `ext-apps` host bridge.
   - Target the 2026-07-28 spec (stateless core, Tasks extension).
   - Update Bucks's own `mcp_server.py` to the same spec, with the Phase 0 token.
4. **Long-running tasks and watchers.**
   - Turn `/agent/goals` and `/workflows` into resumable tasks that report progress through AG-UI state events.
   - Add "watch this page / price / listing and tell me" watchers that notify through an ephemeral toast.
5. **Memory you can see.**
   - Add a review screen (view, edit, delete) over the existing preferences and knowledge stores.
   - Add a periodic consolidation job over chat threads.
   - Scope memory per profile, with a clear off switch.
6. **Agent Skills.** Load `SKILL.md` folders (the open standard) as capabilities, revealing their content only when needed.
7. **Later, once their prerequisites exist:**
   - Expose Soul Engine as an A2A agent with an Agent Card for P2P delegation (`/api/v1/p2p/delegate` already exists).
   - AP2-style signed spending mandates for agent payments. These are blocked until the wallet signing fix (PROJECT_MAP §9) and C-19 land.

**Done when:**
- The prompt-injection suite (Phase 6) shows that no state change happens without confirmation when untrusted content is in context.
- A WebMCP demo page works end to end.
- One external MCP App renders and calls its server tool.

### Phase 6 — Evals and rollout (ongoing from Phase 1)

- Extend `agent/tests/test_adversarial.py` and `eval_scenarios.py` with injection cases: hidden page text, comments, URL parameters and tool descriptions. Track the attack success rate per release.
- Add local browser-task fixtures that measure task success and step count (the OSWorld-Human study found agents take 2.7–4.3× more steps than needed).
- Each phase sits behind a feature flag in the app settings and is turned on by default only after its "done when" checks pass.

---

## 4. Timeline

| Phase | Effort | Depends on | Ships |
|---|---|---|---|
| 0 Safety floor | 1–2 wk | — | token-gated engine, IPC-only access, C-02/08/13/20 closed |
| 1 AG-UI stream | ~2 wk | 0 | `agent-stream.js`, interrupt-based approval |
| 2 A2UI contract | ~3 wk | 1 | Bucks catalog, A2UI interpreter, action round-trip |
| 3 Surface manager | ~2 wk | 2 | unified lifetimes, promote/keep |
| 4 Answer UI polish | ~2 wk | 1 (parallel with 3) | citations, trace, stop, a11y |
| 5 Capabilities | 4–6 wk | 0, 1 (5.3 also needs 2) | policy engine, WebMCP, MCP host, tasks, memory, skills |
| 6 Evals | ongoing | 1 | injection suite, task evals |

That is roughly **14–17 weeks** for one developer, or about 9–10 weeks with two working Phases 3/4 and Phase 5 in parallel.

---

## 5. Decisions needed before starting

1. **Canonical shell.** This plan targets the Electron app in `Bucks-App/`, which is where the agent UI and recent work live. The Tauri/Svelte app in `Bucks-browser` was last changed in May 2026. Confirm it is secondary.
2. **A2UI renderer.** In-house interpreter (no build step) or `@a2ui/web_core` (adds a bundler)? The plan recommends in-house first.
3. **New Tab zone.** Ephemeral, or the persistent chat?

## 6. Risks

- **The standards are young.** A2UI is at v0.9.1 with v1.0 still a candidate; AG-UI only recently reached 1.0; WebMCP's entry point is moving from `navigator` to `document`. Pin versions and keep adapters thin.
- **Small local models.** JSON reliability is poor, so keep deterministic builders as the default path and validate everything the model emits.
- **Prompt injection can't be fully prevented.** The policy engine and confirmations limit the damage; they do not remove the risk. Treat every page and tool description as untrusted.
- **`renderer.js` size.** Extract behind adapters, and only with screenshot parity tests in place.

## 7. First two weeks: tickets

1. Per-launch token in `main.js`, passed through env to Soul Engine and the MCP server; 401 on missing token (0.1).
2. CORS locked to the shell origin in all four FastAPI apps (0.1).
3. `preload.js` streaming IPC bridge; switch `a2ui-engine.js` to it first (0.2).
4. Switch `ephemeral-renderer.js` and `renderer.js` to the bridge; delete the hardcoded URLs (0.2).
5. Exact-match `isInternalOrigin` with a unit test (0.3).
6. `tabs:execJS`: check the sender and use named scripts only (0.4).
7. `navigate()` scheme allowlist, with tests for `javascript://` and `file://` (0.5).
8. Write the AG-UI mapping as a golden-file fixture from one recorded `/agent` run (start of Phase 1).

Test commands: `cd Bucks-App/electron && npm test` (Playwright) and `cd Bucks-App/agent && pytest tests`.

---

### References

- A2UI: https://github.com/a2ui-project/a2ui · v1.0 spec https://a2ui.org/specification/v1.0-a2ui/ · v0.9 spec https://a2ui.org/specification/v0.9-a2ui/
- AG-UI: https://github.com/ag-ui-protocol/ag-ui · https://docs.ag-ui.com/introduction
- MCP Apps: https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/ · MCP 2026-07-28: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- WebMCP overview: https://www.openhermit.com/blog/navigator-modelcontext-2026
- Agent Skills: https://atlan.com/know/ai-agent/ai-agent-skills/what-are-agent-skills/
- Prompt injection / Rule of Two: https://sdtimes.com/security/prompt-injection-tops-2026-owasp-genai-llm-top-ten-vulnerabilities/

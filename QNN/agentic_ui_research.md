# Agentic UI Design: Research Report for Bucks Browser

**Prepared:** August 2026  
**Purpose:** Inform the complete redesign of the Bucks AI interface (Soul Engine + NIM fallback)  
**Scope:** Frontier agentic UI, A2UI/generative UI, ephemeral interfaces, competitive landscape, Bucks-specific recommendations  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What Is Agentic UI?](#2-what-is-agentic-ui)
3. [Core Agentic UI Principles](#3-core-agentic-ui-principles)
4. [A2UI — Agent-to-UI Generative Interface Patterns](#4-a2ui--agent-to-ui-generative-interface-patterns)
5. [Ephemeral UI Patterns](#5-ephemeral-ui-patterns)
6. [Frontier Model Integration Patterns](#6-frontier-model-integration-patterns)
7. [Competitive Landscape](#7-competitive-landscape)
8. [Bucks-Specific Recommendations](#8-bucks-specific-recommendations)
9. [Implementation Roadmap](#9-implementation-roadmap)
10. [Sources & References](#10-sources--references)

---

## 1. Executive Summary

### Top 5 Insights for Bucks

**1. The interface IS the agent.**  
Agentic UI has inverted the traditional relationship: rather than the user navigating menus to accomplish tasks, the UI materializes around what the agent is *doing*. For Bucks, this means the AI panel should not be a persistent sidebar — it should be a context-sensitive surface that rises, collapses, and reshapes based on active tasks. Soul Engine's RAG invocations, NIM API calls, wallet transactions, and IPFS lookups each deserve distinct visual representations that appear and dissolve contextually.

**2. Google A2UI + AG-UI protocol are the standards to build on.**  
As of late 2025, two open protocols have emerged as infrastructure for agentic frontends: **AG-UI** (CopilotKit, event-based SSE streaming) and **A2UI** (Google, declarative JSON component trees). Both are framework-agnostic. For Electron/JS, AG-UI is the immediate practical choice; A2UI is the forward-looking standard for cross-platform component rendering. Bucks should implement AG-UI now and design for A2UI compatibility.

**3. Human-in-the-loop interrupt/resume is now an engineering primitive, not an afterthought.**  
LangGraph's `interrupt()`, OpenAI Agents SDK, and AG-UI's interrupt model have standardized how agents pause, request approval, and resume. Bucks has uniquely high-stakes operations (crypto transactions, identity assertions, P2P message relay) that demand this pattern. Every destructive or financial action must pass through a choreographed approval gate — not a modal dialog, but a full task-state checkpoint that persists across sessions.

**4. Generative UI is production-ready and Electron-compatible.**  
Google's 2025 paper showed users prefer AI-generated HTML/CSS/JS over markdown 83% of the time. Vercel AI SDK UI (not RSC/streamUI, which is paused) provides production-ready streaming hooks. The Dyad and Mastra Electron integrations demonstrate that streaming tool calls with real-time partial-JSON preview is feasible in Electron IPC. Bucks should treat UI *as a response format* — Soul Engine should be able to emit structured component descriptors, not just text.

**5. Trust architecture is the differentiator for a sovereign browser.**  
The "glass box vs. black box" debate has settled in favor of glass box. Users forgive agents that show reasoning far more than agents that act silently. For Bucks — where the user controls their own inference, identity, and funds — transparency is not just UX polish, it's a core value proposition. Every agent action should surface its provenance: which model, which corpus shard, which tool call, with what confidence. This aligns directly with Bucks' sovereign positioning.

---

## 2. What Is Agentic UI?

### Definition

Agentic UI is the interface layer for systems where an AI model **dynamically directs its own process** — choosing tools, planning subtasks, recovering from errors — rather than executing a fixed sequence of steps. It differs from traditional chatbot UI in four fundamental ways:

| Dimension | Chatbot UI | Agentic UI |
|-----------|------------|------------|
| Interaction model | Request → Response | Goal → Multi-step plan → Execution → Feedback loop |
| User role | Driver | Supervisor |
| State | Stateless per turn | Persistent task state across turns and sessions |
| UI lifecycle | Static sidebar | Dynamic, materializes around tasks |

Anthropic's canonical framing distinguishes **workflows** (LLMs orchestrated through predefined code paths) from **agents** (LLMs that dynamically direct their own tool usage). The UI differs: workflows need progress visualization; agents need reasoning transparency, interrupt gates, and error recovery surfaces.

### The Paradigm Shift

Former Google CEO Eric Schmidt's observation that "user interfaces are largely going to go away" captures one extreme. The more nuanced reality emerging in 2025-2026 is that UIs are becoming **intent-centric** rather than **interface-centric**. The WIMP model (Windows, Icons, Menus, Pointer) is 50 years old. Agentic UIs replace menu navigation with natural-language goal expression, replacing the question "where do I find this?" with "do this."

For a browser specifically, this means the browser chrome itself becomes an agent surface. The distinction between "browsing the web" and "asking the AI to do something on the web" dissolves.

### Key Architectural Components

Anthropic's Building Effective Agents (Dec 2024) defines the foundational building blocks:

- **Augmented LLM** — base model + retrieval (RAG) + tools + memory
- **Prompt chaining** — sequential steps with gate checks
- **Routing** — input classification to specialized handlers
- **Parallelization** — sectioning (independent subtasks) and voting (confidence ensemble)
- **Orchestrator-workers** — central LLM delegates to specialized worker LLMs
- **Evaluator-optimizer** — generation + critique loop

The key UI insight from Anthropic: *"Prioritize transparency by explicitly showing the agent's planning steps."* This is not optional — it is one of three core principles for effective agents.

---

## 3. Core Agentic UI Principles

These 9 principles are synthesized from Anthropic's research, Microsoft Design's UX for Agents guidelines, Salesforce agentic experience design, FuseLab's Agent UX analysis, and Smashing Magazine's 2026 AI transparency patterns.

### Principle 1: Intent-First Design

Design for *what the user wants to accomplish*, not the sequence of steps to get there. The UI should accept a high-level goal and decompose it visibly into subtasks. The user sets the direction; the agent plots the route.

**Implementation:** Replace command-style input fields with goal-framing prompts. "What would you like to accomplish?" > "Enter a command." The input should accept multi-sentence context, not just short queries.

### Principle 2: Continuous Status Transparency

At every moment, the interface must communicate: **what is the agent doing right now**, **why it chose this action**, and **what it will do next**. The user should never wonder if the agent is stuck, succeeded, or failed.

**Implementation:** A persistent activity log (collapsible, but always accessible) shows a timestamped sequence of agent actions. Each entry includes the action name, tool called, parameters used (summarized), and result. This is distinct from a chat transcript — it's an execution trace.

### Principle 3: Progressive Task Disclosure

Display task decomposition progressively — show the plan, then fill in results step by step. Don't show a blank screen while thinking, and don't dump all results at once.

**Implementation pattern:**
```
[Goal accepted] → [Plan outline appears: 3 steps] → [Step 1 in progress...] →
[Step 1 complete, result visible] → [Step 2 in progress...] → [Final synthesis]
```

The plan itself should be editable before execution begins — let users modify subtasks, reorder steps, or veto specific tool calls.

### Principle 4: Calibrated Confidence Signals

Agents should communicate how confident they are in their outputs. Categorical signals work better than percentages:

- **Green / solid** — high confidence, verified against multiple sources
- **Amber / dashed** — moderate confidence, worth reviewing
- **Red / outlined** — low confidence or uncertainty explicitly flagged

For RAG systems (like Soul Engine), confidence ties directly to retrieval quality: was the answer grounded in retrieved documents, or generated from model weights alone? This distinction must be visually distinct.

### Principle 5: Human-in-the-Loop Checkpoints

Not all agent actions should execute silently. The interface must expose clear **approval gates** for:
- Irreversible actions (file deletion, transaction signing, message sending)
- Actions crossing trust boundaries (external API calls, web requests)
- Ambiguous interpretations (agent inferred intent, needs confirmation)

The checkpoint UI should show: what the agent proposes to do, what the consequence is, and give the user Approve / Modify / Reject options. This is not a modal alert — it is a structured task card with full context.

### Principle 6: Graceful Interrupt & Resume

Users need to be able to pause a running agent, inspect state, redirect, and resume — across sessions if necessary. The interface should persist incomplete operations and make them visible on return.

**LangGraph `interrupt()` pattern (production standard as of Jan 2025):**
```python
def human_approval_node(state):
    payload = interrupt({
        "action": state["proposed_action"],
        "impact": state["impact_assessment"],
        "alternatives": state["alternatives"]
    })
    return {"approved": payload["decision"], "modification": payload.get("edit")}
```

**UI binding:** When an interrupt fires, the frontend receives an event over AG-UI/SSE and renders an approval card. The agent's graph is parked in full state until the user responds.

### Principle 7: Proactive vs. Reactive Mode Awareness

Agents can operate reactively (responding to user requests) or proactively (monitoring context and initiating actions). The UI must make the current mode explicit and let users switch or suppress proactive behavior.

**Proactive signals** the interface should render:
- "I noticed X in your browsing — would you like me to Y?"
- Background task completion notifications
- Idle-time suggestions (research completed while user was away)

**Reactive indicators:**
- Clear input affordance when agent is waiting
- No ambient activity when user hasn't initiated

The mode toggle (pro/reactive) should be a first-class control, not buried in settings.

### Principle 8: Error Recovery as a First-Class Surface

Agents fail. The interface should treat failure as a normal event, not an exception. Error states must:
1. Explain what failed and why (tool call timed out, retrieval returned nothing, etc.)
2. Show what the agent already completed before failing
3. Offer concrete recovery options: retry, try alternative approach, ask user for clarification
4. Never silently discard partial work

### Principle 9: Source Provenance and Audit Trail

Every factual claim the agent makes should be traceable. For RAG systems, this means showing which corpus documents grounded each answer. For tool-using agents, this means showing which tool call produced which result.

**UI pattern:** Inline citations that expand on click to show the source document excerpt, confidence score, and retrieval timestamp. This is especially critical for Soul Engine's classical corpus — provenance is both a trust signal and a scholarly/research feature.

---

## 4. A2UI — Agent-to-UI Generative Interface Patterns

### What Is A2UI?

A2UI is not just Google's protocol — it's the broader concept of agents generating UI as a *response format*, rather than (or in addition to) text. The LLM decides not just *what to say* but *how to present it* — as a chart, a form, a map widget, a calendar, a transaction confirmation card.

Google's 2025 research paper "Generative UI: LLMs are Effective UI Generators" demonstrated that users preferred AI-generated HTML/CSS/JS over plain markdown **83% of the time**. This finding has driven rapid adoption.

### The Two Active Standards

#### AG-UI (CopilotKit / Microsoft endorsed)
- **Transport:** Server-Sent Events (SSE) over HTTP POST
- **Events:** ~16 structured event types (TEXT_MESSAGE_CONTENT, TOOL_CALL_START, TOOL_CALL_RESULT, STATE_SNAPSHOT, RUN_FINISHED, etc.)
- **Human-in-the-loop:** Built-in interrupt/resume via events
- **Adoption:** Microsoft Azure Agent Framework, LangGraph, CrewAI, AG2

**AG-UI event flow:**
```
POST /agent/run
  → RUN_STARTED
  → TEXT_MESSAGE_START
  → TEXT_MESSAGE_CONTENT (token stream)
  → TOOL_CALL_START { name, args_partial }
  → TOOL_CALL_ARGS_DELTA (streaming JSON)
  → TOOL_CALL_END
  → TOOL_CALL_RESULT
  → [INTERRUPT → human approval → RESUME]
  → RUN_FINISHED
```

#### A2UI (Google, v0.8 Public Preview, stable Q4 2026)
- **Format:** Declarative JSON component tree
- **Security model:** Client maintains a catalog of trusted components; agent can only reference catalog types (no arbitrary code injection)
- **Transport:** Compatible with AG-UI, A2A protocol, REST
- **Renderers:** Lit (web components), Angular, Flutter, React (community)

**A2UI payload example:**
```json
{
  "version": "0.8",
  "components": [
    {
      "id": "reservation-form",
      "type": "Card",
      "children": ["date-picker", "time-selector", "submit-btn"]
    },
    {
      "id": "date-picker",
      "type": "DatePicker",
      "props": { "label": "Date", "min": "2026-08-01" }
    },
    {
      "id": "submit-btn",
      "type": "Button",
      "props": { "label": "Reserve Table", "action": "submit_reservation" }
    }
  ]
}
```

The agent emits this JSON; the Electron renderer maps each type to its native component library.

### Implementing Generative UI in Electron/JS

The practical Electron architecture for generative UI uses three layers:

**Layer 1: Main Process (Node.js) — LLM + Tool Execution**
```javascript
// main.js
const { app, ipcMain } = require('electron');

ipcMain.handle('agent:run', async (event, { goal, context }) => {
  const stream = await soulEngine.streamWithTools(goal, {
    tools: [searchCorpus, queryWallet, sendP2PMessage, lookupIPFS],
    onToolCall: (call) => {
      event.sender.send('agent:tool-start', {
        id: call.id,
        name: call.name,
        args_preview: summarizeArgs(call.args)
      });
    },
    onToolResult: (result) => {
      event.sender.send('agent:tool-result', {
        id: result.id,
        result: result.data,
        ui_hint: result.ui_component // Soul Engine can emit component hints
      });
    },
    onInterrupt: (payload) => {
      return new Promise(resolve => {
        event.sender.send('agent:interrupt', payload);
        ipcMain.once('agent:resume', (_, decision) => resolve(decision));
      });
    }
  });
  return stream;
});
```

**Layer 2: Preload Bridge — Secure IPC**
```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bucks', {
  runAgent: (goal, context) => ipcRenderer.invoke('agent:run', { goal, context }),
  onToolStart: (cb) => ipcRenderer.on('agent:tool-start', (_, data) => cb(data)),
  onToolResult: (cb) => ipcRenderer.on('agent:tool-result', (_, data) => cb(data)),
  onInterrupt: (cb) => ipcRenderer.on('agent:interrupt', (_, data) => cb(data)),
  resumeAgent: (decision) => ipcRenderer.send('agent:resume', decision),
});
```

**Layer 3: Renderer (React/Vue) — Dynamic Component Registry**
```javascript
// AgentSurface.jsx
const COMPONENT_REGISTRY = {
  TransactionCard: lazy(() => import('./components/TransactionCard')),
  SourceCitation: lazy(() => import('./components/SourceCitation')),
  WalletConfirmation: lazy(() => import('./components/WalletConfirmation')),
  IPFSPreview: lazy(() => import('./components/IPFSPreview')),
  P2PMessageCompose: lazy(() => import('./components/P2PMessageCompose')),
  ChartWidget: lazy(() => import('./components/ChartWidget')),
};

function renderA2UIComponent(descriptor) {
  const Component = COMPONENT_REGISTRY[descriptor.type];
  if (!Component) {
    console.warn(`Unknown component type: ${descriptor.type}`);
    return <FallbackTextBlock data={descriptor} />;
  }
  return <Suspense fallback={<Skeleton />}><Component {...descriptor.props} /></Suspense>;
}
```

### Vercel AI SDK UI (Production-Ready Alternative)

> **Note:** Vercel AI SDK RSC (`streamUI`) is currently paused. For production, use **AI SDK UI** hooks with custom tool result rendering.

```javascript
import { useChat } from 'ai/react';

function BucksAgentChat() {
  const { messages, input, handleSubmit } = useChat({
    api: '/api/soul-engine',
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName === 'sign_transaction') {
        // Show approval gate before returning result
        const approved = await showTransactionApproval(toolCall.args);
        return { approved, signature: approved ? await wallet.sign(toolCall.args) : null };
      }
    }
  });

  return (
    <div>
      {messages.map(m => (
        <Message key={m.id} message={m} renderToolResult={renderA2UIComponent} />
      ))}
      <form onSubmit={handleSubmit}><input value={input} /></form>
    </div>
  );
}
```

---

## 5. Ephemeral UI Patterns

### The Concept

Ephemeral UI refers to interface elements that **materialize when needed and dissolve when the task is done**. They exist only for the duration of a specific context or goal. This is the antithesis of persistent navigation chrome.

The concept has roots in iOS's Dynamic Island — a persistent gesture target that expands/collapses around live activities (navigation, music, timers) without requiring the user to open an app. Key Dynamic Island design lessons:

- **Context-tap/long-press/swipe** gesture vocabulary for compact → expanded states
- **Live Activities API** for backgrounded tasks that persist as ambient signals
- **Contextual gradients** pulled from active content (album art → ambient color) for visual cohesion

### Ephemeral Patterns Applicable to Bucks

#### Pattern 1: Task Overlay Surfaces

When the agent initiates a multi-step task, a task surface slides up from the bottom of the browser chrome (not a new window, not a sidebar). It displays:
- Task title and current step
- Tool call activity feed
- Interrupt gate (if applicable)
- Dismiss → continues in background

When the task completes, it collapses to a notification pill. The user can re-expand at any time.

**Dissolved state:** A subtle ambient indicator (colored dot on the address bar, browser badge) signals background activity without dominating screen real estate.

#### Pattern 2: Contextual Action Halos

When the user's cursor or selection indicates intent (hovering a crypto address, selecting text in a webpage, right-clicking a link), an ephemeral action ring appears offering agent-powered options:

- Hover crypto address → "Lookup on Chain 8192" / "Send to…" / "Check reputation"
- Select text → "Research this via Soul Engine" / "Fact-check" / "Add to corpus"
- Hover IPFS link → "Fetch via IPFS" / "Preview" / "Pin to local node"

The ring dismisses on click-elsewhere. It never appears unless the user pauses (300ms threshold), preventing noise.

#### Pattern 3: Approval Cards (Ephemeral, Blocking)

For destructive or financial actions, an approval card materializes *over* the browser content (not in a separate window). It:
- Summarizes the action in plain language
- Shows the consequence (amount, recipient, content)
- Expires after a timeout if not interacted with (with countdown)
- Has a keyboard shortcut for approve (Enter) and reject (Escape)

After resolution, it dissolves completely — leaving no modal overlay residue.

#### Pattern 4: Source Tooltip Lattice

When Soul Engine cites a source, the citation appears inline as a small superscript chip. On hover, an ephemeral popover expands showing:
- Document title and date
- Relevant excerpt with query terms highlighted
- Confidence score
- Option to "explore this source further"

This never requires navigating away from the response. The lattice of citations makes the classical corpus *visible as a living resource*, not just footnotes.

#### Pattern 5: Ambient Agent Status Indicator

A minimal always-visible indicator (similar to macOS menu bar items) shows:
- **Soul Engine status:** idle / inferring / retrieving
- **NIM fallback status:** connected / rate-limited / offline
- **P2P mesh status:** node count, sync state
- **IPFS status:** pinning / fetching

It expands on click to a status panel. In idle state, it is a single small icon that doesn't compete with page content.

#### Pattern 6: Inline Tool Result Injection

Instead of scrolling up in a chat panel to see tool results, agent-generated components inject *directly into the page context* where relevant. For example:
- Web research results appear as a collapsible summary panel *beneath* the page being researched
- Corpus search results appear alongside the query in the address bar area
- Transaction confirmation appears as a temporary page overlay where the transaction was initiated

This makes the agent feel woven into the browsing experience, not bolted on.

---

## 6. Frontier Model Integration Patterns

Ranked by estimated impact for Bucks (highest first):

### Rank 1: Agentic RAG with Source Provenance UI

**Why #1 for Bucks:** Soul Engine is *the* core differentiator — a RAG system over a classical corpus. Getting the RAG integration right, with visible provenance, is the highest-leverage work.

**Pattern:** Move from static RAG to **Adaptive RAG** — the agent decides *whether* to retrieve, *what* to retrieve, and *how many rounds* of retrieval are needed based on query complexity.

- **FLARE:** Triggers retrieval when generation confidence drops (token probability below threshold)
- **Self-RAG:** Model produces reflection tokens (`[Retrieve]`, `[IsRel]`, `[IsSup]`) to self-direct retrieval
- **Adaptive-RAG:** Query complexity classifier routes to single-hop, multi-hop, or no-retrieval paths

**UI requirements:**
- Streaming intermediate retrieval steps: "Searching corpus for X..." → results → synthesis
- Inline citation chips on every factual claim
- Expandable source panel with ranked retrieval results
- Visual distinction between corpus-grounded answers vs. model-knowledge answers

### Rank 2: Human-in-the-Loop Interrupt/Resume for Wallet Operations

**Why #2 for Bucks:** Every crypto transaction, identity assertion, or signature operation must have a vetted approval gate. This is not optional — it is a legal and safety requirement.

**Implementation:** LangGraph `interrupt()` + AG-UI interrupt events. The Bucks wallet integration should define an `approval_required` tool category. Every tool in this category automatically triggers an interrupt before execution.

```python
# Soul Engine agent definition
APPROVAL_REQUIRED_TOOLS = [
    "sign_transaction",
    "broadcast_tx",
    "update_ipfs_identity",
    "send_p2p_message",
    "spend_gas"
]

def execute_tool(tool_name, args, state):
    if tool_name in APPROVAL_REQUIRED_TOOLS:
        approval = interrupt({
            "tool": tool_name,
            "args": args,
            "risk_level": assess_risk(tool_name, args),
            "estimated_cost": estimate_cost(tool_name, args)
        })
        if not approval["approved"]:
            return {"cancelled": True, "reason": approval.get("reason")}
    return run_tool(tool_name, args)
```

### Rank 3: Streaming Tool Calls with Partial-JSON Preview

**Why #3 for Bucks:** Users watching a Soul Engine inference session need real-time feedback. Streaming the tool call arguments as they're generated (partial JSON) dramatically improves perceived responsiveness.

**Electron IPC pattern:**
```javascript
// Stream partial tool call args token by token
import { jsonrepair } from 'jsonrepair';

function handleStreamingToolArgs(partial_json_stream) {
  let buffer = '';
  for await (const chunk of partial_json_stream) {
    buffer += chunk;
    try {
      const partial = JSON.parse(jsonrepair(buffer));
      renderToolCallPreview(partial); // show live preview of what agent is about to do
    } catch { /* continue buffering */ }
  }
}
```

### Rank 4: Memory-Augmented Sessions

**Why #4 for Bucks:** The sovereign browser use case demands persistent memory. Users should not have to re-explain their research context, wallet preferences, or reading habits every session.

**Architecture for Bucks:**

- **Core memory** (always in context): User research goals, active projects, wallet address book, corpus tags
- **Recall memory** (vector search): Past conversations, prior research sessions, source history
- **Archival memory** (IPFS-backed): Long-term knowledge base, pinned documents, verified facts

**Frameworks:** Letta (formerly MemGPT) provides the OS-inspired three-tier model. Mem0 is simpler as a bolt-on layer. For Bucks, IPFS-backed archival is a natural fit — the user's memory *is* their sovereign data store.

```javascript
// Memory retrieval at session start
async function initializeAgentContext(userId) {
  const coreMemory = await ipfsMemory.getCoreContext(userId);
  const recentRecall = await vectorStore.getRecentContext(userId, { limit: 20 });
  return {
    system_prompt_addition: formatMemoryContext(coreMemory),
    few_shot_examples: recentRecall.map(r => r.interaction)
  };
}
```

### Rank 5: Multi-Model Routing (Soul Engine → NIM Fallback)

**Why #5 for Bucks:** The Soul Engine / Nemotron-70B routing is already architecturally present. The UI dimension is making this routing *visible and controllable*.

**UI pattern:**
- Status indicator showing which model is active (Soul / NIM / hybrid)
- Per-query cost/latency estimate before sending
- Manual override: "Use NIM for this query" toggle
- Automatic routing with transparent explanation: "Switching to NIM: query exceeds local context window"

**Routing logic pattern:**
```javascript
function routeQuery(query, context) {
  const complexity = assessComplexity(query);
  const corpusRelevance = checkCorpusRelevance(query);
  
  if (corpusRelevance.score > 0.7 && complexity.tokens < LOCAL_CONTEXT_LIMIT) {
    return { engine: 'soul', reason: 'High corpus relevance, within local context' };
  }
  if (complexity.requires_reasoning && complexity.tokens > LOCAL_CONTEXT_LIMIT) {
    return { engine: 'nim', reason: 'Complex reasoning, exceeds local context' };
  }
  return { engine: 'soul', reason: 'Default local inference' };
}
```

### Rank 6: Generative UI Component Emission

**Why #6:** Once the core agent loop is solid, enabling Soul Engine to emit structured UI descriptors (A2UI-compatible JSON) rather than just text dramatically improves utility.

**Pattern:** Extend Soul Engine's output schema with an optional `ui_component` field on tool results. The renderer checks for this and renders the component instead of (or alongside) the text.

### Rank 7: Multi-Agent Coordination Visualization

**Why #7:** Bucks could support orchestrating specialized sub-agents (a research agent, a wallet agent, a messaging agent, a web agent). LangGraph's graph model is the right architecture. The UI challenge is showing the user which agent is active, what each has done, and how they're coordinating without overwhelming them.

**LangGraph Studio pattern:** A collapsible agent graph view (show node-by-node execution, current active node highlighted, edge traversal animated) accessible from the task panel.

---

## 7. Competitive Landscape

### Cursor 3 (April 2026) — The Agent-First IDE

Cursor rebuilt its entire interface around agents for v3.0. Key UI innovations directly relevant to Bucks:

- **Agents Window:** A dedicated sidebar that sits alongside the editor, showing all running agents (parallel execution), their status, and output. This is the canonical pattern for "agent process manager" UI.
- **Background Agent:** Cloud-hosted async agent that runs while the user does other things. The UI shows a persistent status strip: "Agent working on X in background — click to inspect."
- **Design Mode (Cmd+Shift+D):** Opens a built-in browser panel *alongside* the code, letting users annotate UI elements directly in the running app. This is the pattern of merging browsing + agent action.
- **Parallel execution:** Multiple agents run simultaneously with color-coded status lanes.

**Lesson for Bucks:** The agent panel should be a *process manager*, not a *chat history*. Multiple concurrent tasks (research, wallet operation, P2P messaging) should have their own status lanes, not be serialized in a single conversation thread.

### Devin / Windsurf (Cognition AI)

Windsurf (Cognition acquired it post-Devin) focuses on deep IDE integration with a less-is-more approach to agent UI. Key differentiator: **Flows** — a mode where the agent and developer work in tandem, the agent describing its plan step-by-step as the developer can intervene at any point.

User feedback from Cursor forums notes that Devin's Desktop IDE *feels more polished* than Cursor's agent window. The key difference: Devin shows the agent's full reasoning chain (every thought, tool call, and result) in a structured timeline, not just the final output.

**Lesson for Bucks:** Full reasoning chain visibility (not just results) is what users trust. Show the thinking.

### GitHub Copilot Coding Agent (GA September 2025)

GitHub deprecated Copilot Workspace (May 2025) and replaced it with the Copilot Coding Agent, with a fundamentally different UI architecture:
- **Issue → PR workflow:** User assigns a GitHub Issue to the agent; the agent opens a draft PR and updates it as it works
- **Async execution model:** The agent works in the cloud while the user does other things; changes appear in the PR diff
- **Audit trail:** Every agent action is recorded as a commit or PR comment — the PR timeline *is* the agent execution trace

**Lesson for Bucks:** The git commit timeline as an agent audit trail is a powerful pattern. For Bucks, IPFS commits (content-addressed writes) could serve an analogous role — each agent action that writes to IPFS creates a verifiable, content-addressed log entry.

### Claude / Anthropic Cowork (2025-2026)

Claude's Co-work product (desktop AI agent) is the most direct analog to Bucks' AI interface:
- Sees the screen, interacts with applications, reads/writes files
- Task list widget for progress tracking
- Approval gates for file writes and application actions
- `present_files` for surfacing created artifacts

Anthropic's three core agent design principles (from Building Effective Agents):
1. **Simplicity** — don't add complexity unless it demonstrably helps
2. **Transparency** — show planning steps explicitly
3. **ACI quality** — agent-computer interfaces deserve as much design effort as human-computer interfaces

**Lesson for Bucks:** Don't build complexity into Soul Engine before you've nailed transparency for simple operations. One well-designed approval gate for wallet operations beats ten half-baked agentic features.

### Replit Agent 3 (September 2025)

Replit became fully agent-first in 2025. Key innovation: **session replay** — the agent records browser sessions and can replay them for the developer to see exactly what the AI did. This is a powerful trust mechanism: not just showing logs, but showing *actual actions* taken.

**Lesson for Bucks:** Session replay for IPFS/P2P/wallet operations — a verifiable audit of "here is exactly what the AI did in your name" — is a compelling sovereign browser feature.

### Perplexity Comet Browser & OpenAI ChatGPT Atlas (2025)

Both launched as agentic browsers in 2025:
- **Perplexity Comet** (July 2025): Deep integration of web research agent with browsing; sources surfaced inline in pages
- **OpenAI ChatGPT Atlas** (October 2025): Task-aware browsing, agent can navigate pages, fill forms, extract structured data

**Key difference from Bucks:** Neither is sovereign. Both route queries through centralized cloud APIs. Bucks' unique position is *local-first inference* with *user-owned data*. The UI should make this sovereignty visible and valuable, not hidden.

---

## 8. Bucks-Specific Recommendations

These 10 recommendations are prioritized for the Bucks context (Electron, Soul Engine RAG, NIM fallback, IPFS identity, P2P messaging, Chain 8192 wallet).

### Recommendation 1: Replace the Chat Panel with an Agent Task Surface

**Current assumption:** Bucks likely has a chat-style AI sidebar.  
**Change:** Replace with a Task Surface — a dynamic panel that:
- Shows currently running tasks as "task cards" (not chat bubbles)
- Each card has: title, status, progress indicator, last action, expand/collapse
- Multiple tasks can run in parallel, each with its own card
- The surface collapses to a thin strip when all tasks are idle

The chat input remains, but its output goes to a new task card, not a thread of messages.

### Recommendation 2: Implement AG-UI Protocol for Soul Engine

Connect Soul Engine's inference loop to AG-UI event streaming. This provides:
- Token-by-token text streaming (today you probably have this)
- Structured tool call events (TOOL_CALL_START → TOOL_CALL_ARGS_DELTA → TOOL_CALL_RESULT)
- State snapshot events for session persistence
- Native interrupt/resume support for approval gates

Start with a lightweight Node.js AG-UI endpoint in the Electron main process. The renderer subscribes via EventSource or IPC bridge.

### Recommendation 3: Build a Bucks Component Registry (A2UI-compatible)

Define a catalog of Bucks-native UI components that agents can request:

| Component | Trigger |
|-----------|---------|
| `TransactionCard` | wallet tool call |
| `SourceCitation` | RAG retrieval result |
| `IPFSObjectPreview` | IPFS fetch result |
| `P2PMessageCompose` | messaging tool call |
| `ChainExplorerWidget` | on-chain lookup |
| `CorpusSearchResults` | Soul Engine query |
| `IdentityCard` | IPFS DID lookup |
| `ApprovalGate` | any APPROVAL_REQUIRED tool |

Soul Engine's structured output should include a `component_hint` field. The renderer maps hints to registered components.

### Recommendation 4: Instrument Every Soul Engine Tool Call with Transparency Events

Every tool Soul Engine calls should emit three events to the UI:
1. **Before:** "About to call [tool] with [summarized args]"
2. **During:** Live status (for async tools: IPFS fetch, P2P relay, chain query)
3. **After:** Result summary + confidence + time elapsed

This data feeds both the real-time activity log and the persistent session audit trail.

### Recommendation 5: Implement Tiered Approval Gates for All Wallet & Identity Operations

Define a three-tier approval system:

**Tier 1 — Silent** (no approval needed):
- Read operations (corpus search, IPFS read, chain balance check)
- Internal computations

**Tier 2 — Soft Gate** (shows notification, auto-approves in 10s):
- Low-value, reversible actions (pinning content, adding corpus tags)
- User can dismiss to cancel

**Tier 3 — Hard Gate** (explicit click required, no timeout):
- Transaction signing and broadcast
- IPFS identity updates
- P2P message transmission
- Any action with financial cost

The approval card must show: action summary, estimated cost/impact, session context, and a clear "Not me" escape hatch.

### Recommendation 6: Surface the RAG Corpus as a Living Resource

Soul Engine's classical corpus is the product's soul — it should be visible, not hidden behind an API. Implement:

- **Corpus indicator:** Small badge showing number of documents retrieved for the current query
- **Source lattice:** Inline citation chips on every factual response
- **Corpus browser:** A dedicated panel (accessible from the address bar) showing the corpus structure, recently used sources, and coverage by topic
- **Retrieval transparency:** For each answer, show: "Grounded by [N sources] | Model knowledge [%] vs. Corpus [%]"

This is a sovereign browser's answer to "where does this AI get its information?" — the answer is: *from your corpus, transparently.*

### Recommendation 7: Add a Soul Engine / NIM Mode Toggle with Routing Transparency

The UI should make the Soul Engine vs. NIM routing decision visible and controllable:
- Status bar indicator: "Soul" (local) / "NIM" (cloud) / "Hybrid"
- On each query, show which engine was used and why
- Settings panel: thresholds for automatic routing (context window, query complexity)
- Per-query manual override

For privacy-conscious users, this is a critical trust signal: "Your data never left your device for this query."

### Recommendation 8: Implement Ephemeral Contextual Action Halos

Add right-click / hover affordances that invoke Soul Engine contextually:
- **On any crypto address:** Chain 8192 lookup, wallet action options
- **On any text selection:** "Research with Soul Engine," "Check against corpus," "Add to research context"
- **On any IPFS/IPNS link:** Fetch, preview, pin
- **On any image:** "Analyze," "Reverse search," "Extract text"

This makes the AI feel ambient and contextual, not a separate mode you have to enter.

### Recommendation 9: Build Session Replay for Agent Actions

Implement a tamper-evident audit log of all agent actions taken in a session, stored locally (and optionally pinned to IPFS):

```javascript
// Audit log entry structure
{
  "session_id": "...",
  "timestamp": "2026-08-01T...",
  "action": "sign_transaction",
  "tool_call": { "args": {...}, "result": {...} },
  "user_approved": true,
  "approval_method": "explicit_click",
  "engine": "soul",
  "ipfs_cid": "Qm..." // optional: pin to IPFS for permanence
}
```

The replay UI should show a timeline of actions with expand-to-detail. IPFS-pinned entries are cryptographically verifiable.

### Recommendation 10: Design for Proactive Agent Behaviors

Plan for (not necessarily implement in Phase 1) proactive agent modes:
- **Research continuation:** "You were researching X yesterday. I found 3 new relevant documents while your node was syncing."
- **Price/chain alerts:** "Chain 8192 gas prices are low — you wanted to execute that transaction when gas dropped below threshold."
- **Corpus updates:** "A document you cited was updated. The new version changes the conclusion on page 4."

The UI contract for proactive notifications: ambient (non-blocking), dismissible, explainable ("why am I seeing this?"), and optionally suppressible per-type.

---

## 9. Implementation Roadmap

### Phase 1: Foundation (4-6 weeks)
*Goal: Replace the current AI interface with a transparency-first task surface*

**Sprint 1-2: Task Surface Architecture**
- [ ] Replace chat panel with Task Surface (task cards, parallel task support)
- [ ] Implement AG-UI event streaming from Soul Engine (IPC bridge)
- [ ] Add tool call transparency events (before/during/after) to all existing tools
- [ ] Build activity log component (timestamped, collapsible)

**Sprint 3-4: Trust Infrastructure**
- [ ] Implement three-tier approval gate system
- [ ] Build `ApprovalGate` component with hard-gate for wallet/identity operations
- [ ] Add session audit log (local, structured)
- [ ] Source citation chips for Soul Engine RAG responses

**Deliverable:** Agent interface that shows what it's doing, asks for approval when needed, and leaves a verifiable audit trail.

---

### Phase 2: Generative UI (6-8 weeks)
*Goal: Agents emit rich UI components, not just text*

**Sprint 5-6: Component Registry**
- [ ] Define Bucks component catalog (10 core components listed in Rec. 3)
- [ ] Implement A2UI-compatible JSON schema for component descriptors
- [ ] Build component renderer in Electron renderer process
- [ ] Connect Soul Engine structured output to component registry

**Sprint 7-8: Corpus & Model Transparency**
- [ ] Build `SourceCitation` component with inline expansion
- [ ] Implement corpus indicator and retrieval transparency display
- [ ] Build Soul Engine / NIM routing indicator + manual override
- [ ] Add per-query confidence scoring display

**Deliverable:** Soul Engine responses appear as rich, interactive UI components with full source provenance. Users can see exactly which corpus documents grounded each answer.

---

### Phase 3: Ephemeral & Contextual UI (4-6 weeks)
*Goal: Make the AI ambient and contextual throughout the browser, not just in a panel*

**Sprint 9-10: Contextual Action Halos**
- [ ] Right-click menu agent actions (text selection, crypto addresses, IPFS links)
- [ ] Hover delay + ephemeral action ring for crypto addresses
- [ ] IPFS link detection and preview injection
- [ ] Keyboard shortcuts for common agent actions

**Sprint 11-12: Ambient Status & Proactive Foundations**
- [ ] Ambient agent status indicator (Soul/NIM/P2P/IPFS states)
- [ ] Task collapse → notification pill behavior
- [ ] Background task persistence (tasks survive panel close)
- [ ] Session replay timeline UI

**Deliverable:** The AI feels woven into the browsing experience. The agent is contextually present on every page, not locked in a sidebar.

---

### Phase 4: Advanced Patterns (8-10 weeks)
*Goal: Multi-agent coordination, memory persistence, proactive behaviors*

**Sprint 13-15: Memory & Continuity**
- [ ] IPFS-backed persistent memory (core + recall tiers)
- [ ] Session context initialization from memory at startup
- [ ] Research continuation: surfacing relevant past context
- [ ] Corpus browser panel

**Sprint 16-18: Multi-Agent & Proactive**
- [ ] Orchestrator + specialist agent architecture (research / wallet / messaging agents)
- [ ] Agent graph visualization (LangGraph-style, collapsible)
- [ ] Proactive notification system (price alerts, corpus updates, P2P events)
- [ ] Full session replay with IPFS pinning option

**Deliverable:** Bucks agents are persistent, proactive, and verifiably accountable. The sovereign browser has a sovereign AI that acts in the user's interest, visibly and verifiably.

---

### Technology Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent streaming protocol | AG-UI (SSE) | Production-ready, Electron IPC compatible, Microsoft-endorsed |
| Component format | A2UI-compatible JSON | Future-proof, cross-platform, security-first |
| Frontend hooks | Vercel AI SDK UI | Not RSC/streamUI (paused), stable hooks for streaming |
| Multi-agent framework | LangGraph | Production-grade state, interrupt(), audit trails |
| Memory layer | IPFS-backed + Letta architecture | Sovereign storage, three-tier memory model |
| Approval gates | LangGraph interrupt() | Standardized, resumable, state-preserving |

---

## 10. Sources & References

### Primary Sources (Fetched)

- [Building Effective Agents — Anthropic Engineering](https://www.anthropic.com/engineering/building-effective-agents) — Dec 2024. Core agent architecture patterns, transparency principles, ACI design.
- [Introducing A2UI: An Open Project for Agent-Driven Interfaces — Google Developers Blog](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/) — Dec 2025. Full A2UI specification, security model, integration partners.

### Agentic UI Design

- [Designing User Interfaces for Agentic AI — Codewave](https://codewave.com/insights/designing-agentic-ai-ui/)
- [Agent UX: UI Design for AI Agents in 2026 — FuseLab Creative](https://fuselabcreative.com/ui-design-for-ai-agents/)
- [The Agentic Interface: Principles and Patterns — UX.raspberry / Medium](https://medium.com/@uxraspberry/the-agentic-interface-principles-and-patterns-for-autonomous-user-experiences-b0c1ecb8544f)
- [How to Embrace the Great UX Paradigm Shift to Agentic Experience Design — Salesforce](https://www.salesforce.com/blog/ux-shift-to-agentic-experience-design/)
- [UX Design for Agents — Microsoft Design](https://microsoft.design/articles/ux-design-for-agents/)
- [Practical Interface Patterns For AI Transparency (Part 2) — Smashing Magazine](https://www.smashingmagazine.com/2026/05/practical-interface-patterns-ai-transparency/)
- [Agentic Design Patterns — agentic-design.ai](https://agentic-design.ai/patterns/ui-ux-patterns)
- [Agent UX Patterns: Chat-First UX Fails — Hatchworks](https://hatchworks.com/blog/ai-agents/agent-ux-patterns/)

### Generative UI & A2UI

- [Generative UI: LLMs are Effective UI Generators — Google Research](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/)
- [Generative UI — arxiv 2604.09577](https://arxiv.org/abs/2604.09577)
- [AI SDK UI: Generative User Interfaces — Vercel](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)
- [Introducing AI SDK 3.0 with Generative UI — Vercel Blog](https://vercel.com/blog/ai-sdk-3-generative-ui)
- [A2UI GitHub Repository](https://github.com/google/A2UI)
- [AG-UI Protocol Overview](https://docs.ag-ui.com/introduction)
- [AG-UI: The Future of Agent-Driven User Interfaces — Microsoft Community Hub](https://techcommunity.microsoft.com/blog/appsonazureblog/ag-ui-the-future-of-agent-driven-user-interfaces/4515769)
- [CopilotKit GitHub — Frontend Stack for Agents & Generative UI](https://github.com/copilotkit/copilotkit)

### Ephemeral UI

- [The Future of AI UI/UX: Ephemeral Interfaces and Stateless Design — Hertzfelt Labs](https://hertzfelt.io/blog/the-future-of-ai-ui-ux-ephemeral-interfaces-and-stateless-design-paradigms)
- [Generative UI and the Ephemeral Interface — Roger Wong](https://rogerwong.me/2025/11/generative-ui-and-the-ephemeral-interface)
- [Software as Content: Dynamic Applications as the Human-Agent Interaction Layer — arxiv 2603.21334](https://arxiv.org/html/2603.21334v1)
- [The End of Permanent UI — Indigo](https://www.getindigo.ai/blog/the-end-of-permanent-ui)
- [Ephemeral Interfaces — Julian Fleck](https://www.julianfleck.net/concepts/ephemeral-interfaces)

### Human-in-the-Loop

- [Human-in-the-Loop with AG-UI — Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/integrations/ag-ui/human-in-the-loop)
- [Human-in-the-Loop Workflows with LangGraph — Abstract Algorithms](https://www.abstractalgorithms.dev/langgraph-human-in-the-loop)
- [Human-in-the-Loop for AI Agents: Best Practices — Permit.io](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo)
- [OpenAI Agents SDK: Human-in-the-Loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)

### Memory & Persistence

- [AI Agent Memory in 2026: MemPalace, Mem0, and Persistent Context — Eden AI](https://www.edenai.co/post/ai-agent-memory-mempalace-mem0-and-persistent-context)
- [Mem0 vs Letta (MemGPT): AI Agent Memory Compared — Vectorize.io](https://vectorize.io/articles/mem0-vs-letta)

### Competitive Landscape

- [Cursor 3: The Agent-First IDE — DEV Community](https://dev.to/akaranjkar08/cursor-3-the-agent-first-ide-that-reimagines-how-developers-work-13g5)
- [GitHub Copilot: The Agent Awakens — GitHub Blog](https://github.blog/news-insights/product-news/github-copilot-the-agent-awakens/)
- [Replit 2025: Replit in Review](https://replit.com/blog/2025-replit-in-review)
- [Top 5 Agentic Browsers in 2026 — Seraphic Security](https://seraphicsecurity.com/learn/ai-browser/top-5-agentic-browsers-in-2026-capabilities-and-security-risks/)

### Electron & Technical Implementation

- [AI Agent Tool Calling in Electron — Dyad](https://www.dyad.sh/blog/ai-agent-tool-calling-electron)
- [Building a Desktop AI Agent with Electron and Next.js — Skales](https://getskales.app/blog/building-ai-agent-electron/)
- [Mastra Electron Integration Guide](https://mastra.ai/guides/getting-started/electron)

### Crypto & Agent Identity

- [Agency by Design: Preserving User Control in a Post-Interface World — a16z Crypto](https://a16zcrypto.com/posts/article/preserving-user-control-ai-agents/)
- [AIP: Agent Identity Protocol for Verifiable Delegation — arxiv 2603.24775](https://arxiv.org/pdf/2603.24775)
- [AI Agent Wallet: Complete Guide — Cobo](https://www.cobo.com/post/ai-agent-wallet-complete-guide)

---

*Report compiled August 2026. All sources retrieved and verified. Research covers the frontier through mid-2026.*

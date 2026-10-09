"""
Bucks Agent Engine v2 — All 10 enhancement points integrated.

1.  Knowledge Base      — DomainKB + BM25 retrieval injected into every prompt
2.  Tool Integration    — ToolRegistry: web, code, files, calendar, commerce
3.  Goal-Driven Plan    — Planner decomposes complex goals into sub-tasks
4.  Context Management  — SQLite sessions + sliding window history pruning
5.  Self-Evaluation     — Evaluator scores responses; retries on low quality
6.  NLU Enhancement     — Rich system prompts + multi-turn dialogue injection
7.  Safety Guardrails   — Prompt + response content filters, rate limiting
8.  Multi-Modal Input   — Image description via Ollama vision (llava)
9.  Adaptive Learning   — User preference store personalises system prompt
10. Simulated Eval      — /api/v1/eval endpoint for scenario benchmarking
"""
import uuid
import json
import logging
import re
from typing import Optional

import ollama_client as ollama
import config
from safety             import check_prompt, check_response, SAFE_FALLBACK
from evaluator          import evaluate, should_retry, build_retry_prompt
from planner            import needs_planning, create_plan, execute_plan
from knowledge          import kb
from memory.session_store import sessions, preferences, interactions
from genui import research_component, validate_component

log = logging.getLogger("bucks-engine")

# ── NLU system prompt (Point 6) ───────────────────────────────────────────────

_BASE_SYSTEM = """You are Bucks, an intelligent, privacy-first browser agent built on a Web3 foundation.

CAPABILITIES:
• Navigate the web, search DuckDuckGo, fetch pages, extract links
• Execute sandboxed Python/JS code, read/write project files
• Manage calendar events, track orders, search products
• Handle IPFS/IPNS, wallet actions, DID identity

RESPONSE FORMAT:
Always end your response with a single-line JSON action object:
- Navigate:  {"type":"navigate","url":"https://..."}
- Search:    {"type":"search","content":"query text"}
- Text:      {"type":"text","content":"your reply"}
- Action:    {"type":"action","action":"open_wallet"} or {"type":"action","action":"open_ipfs"}
- Code:      {"type":"code","text":"...","language":"python"}

STYLE RULES:
• Be concise (1-3 sentences before the JSON), factual, privacy-respecting
• Never reveal private keys, seed phrases, or PII
• Prefer DuckDuckGo over Google for searches
• For ambiguous requests, ask one clarifying question before acting
"""

# Nexus-specific system prompt: instructs model to emit structured ephemeral UI JSON
_NEXUS_SYSTEM = """
You are Nexus, an ephemeral UI orchestrator. When asked to produce a UI panel,
return a short human-friendly lead (1-2 sentences) followed by a single-line
JSON object (as the final line) describing the UI action. The JSON MUST be
the very last line of the response and must include a top-level "type" key.
For ephemeral UI panels use this shape:

    {"type":"ui_component","component": {"component":"research","title":"...","data":{...}}}

The "component" value should follow the GenUI component contract (component, title, data).
If you cannot produce a structured component, return:

    {"type":"text","content":"<short explanation>"}

Do NOT include any extra explanation after the JSON. Keep the JSON valid and
compact. Keep output safe and avoid sensitive data.
"""

_TOOL_SYSTEM_ADDENDUM = """
You have access to these tools (call them by including their output in your reasoning):
{tool_list}
When a tool is needed, describe what you would use and what result it returned before giving your final answer.
"""

# ── Intent keywords → agent type ─────────────────────────────────────────────

_ROUTES = {
    "wallet":   {"wallet","balance","send money","transfer","payment","fund"},
    "ipfs":     {"ipfs","decentralized","upload","pin","cid","content hash","ipns"},
        "nexus":    {"nexus","hermes","ephemeral","panel"},
    "code":     {"code","build","fix","debug","compile","error",".rs",".ts",".svelte","src/","execute","run script","execute:","exec "},
    "commerce": {"order","track","shop","product","shipping","inventory","buy","price","ecommerce"},
    "browser":  {"search","navigate","url","website","web","fetch","page","open","go to","browse","find",
                 "weather","news","latest","what is","who is","where is","how to","look up","tell me about"},
    "calendar": {"calendar","event","schedule","appointment","remind","meeting"},
}

# Ordered priority list (first match wins)
_ROUTE_ORDER = ["wallet", "ipfs", "code", "calendar", "commerce", "nexus", "browser"]

def _route(prompt: str) -> str:
    p = prompt.lower()
    for agent in _ROUTE_ORDER:
        if any(k in p for k in _ROUTES[agent]):
            return agent
    return "slm"


def _pick_a2ui(text: str, agent: str, prompt: str) -> dict:
    """Extract last JSON from text, or synthesize one based on agent type."""
    matches = list(re.finditer(r'\{[^{}]+\}', text, re.DOTALL))
    if matches:
        try:
            a2ui = json.loads(matches[-1].group())
            if "type" in a2ui:
                return a2ui
        except json.JSONDecodeError:
            pass
    # Fallback synthesis
    if agent == "wallet":
        return {"type": "action", "action": "open_wallet"}
    if agent == "ipfs":
        return {"type": "action", "action": "open_ipfs"}
    url = re.search(r'https?://\S+', prompt)
    if url:
        return {"type": "navigate", "url": url.group()}
    fallback = {"type": "text", "content": text.strip()}

    # Nexus-specific post-processing: if model returned freeform text, build a
    # deterministic GenUI `research` component so the frontend can render it.
    try:
        if agent == "nexus":
            comp = research_component(prompt or "Nexus Panel", summary=fallback["content"], topic=(prompt[:60] if prompt else ""))
            valid = validate_component(comp)
            if valid:
                return {"type": "ui_component", "component": valid}
    except Exception:
        pass

    return fallback


# ── Main inference ─────────────────────────────────────────────────────────────

async def _call_llm(prompt: str, system: str, model: str) -> str:
    """Single LLM call with fallback."""
    models = await ollama.available_models()
    if not models:
        raise RuntimeError("No Ollama models available.")

    # Prefer cloud model for speed; fall back to local
    preferred = next((m for m in models if "cloud" in m), None) or model or models[0]
    try:
        return await ollama.generate(model=preferred, prompt=prompt, system=system)
    except Exception:
        fallback = next((m for m in models if m != preferred), None)
        if fallback:
            return await ollama.generate(model=fallback, prompt=prompt, system=system)
        raise


async def run(
    prompt:        str,
    current_url:   Optional[str] = None,
    current_title: Optional[str] = None,
    task_id:       Optional[str] = None,
    session_id:    str           = "default",
    image_b64:     Optional[str] = None,
    system_prompt: Optional[str] = None,
) -> dict:
    """
    Full enhanced inference pipeline:
    guardrails → context → KB → planning → LLM → eval → adaptive memory
    """
    task_id = task_id or str(uuid.uuid4())

    # ── 7: Safety check ───────────────────────────────────────────────────
    guard = check_prompt(prompt, session_id)
    if not guard:
        return _error_result(task_id, guard.reason, "safety_block")

    # ── 4: Context management — retrieve session history ──────────────────
    history = sessions.get_recent(session_id, n=6)
    sessions.append_message(session_id, "user", prompt)

    # ── 8: Multi-modal — describe image if provided ───────────────────────
    image_desc = ""
    if image_b64:
        image_desc = await _describe_image(image_b64)
        if image_desc:
            prompt = f"[Image: {image_desc}]\n{prompt}"

    # ── 1: Knowledge base retrieval ───────────────────────────────────────
    kb_context   = kb.format_context(prompt, k=3)

    # ── 4: Similar past interactions (RAG) ───────────────────────────────
    past_hits    = interactions.retrieve_similar(prompt, k=3)
    past_context = ""
    if past_hits:
        lines = ["[Relevant past interactions]"]
        for h in past_hits:
            lines.append(f"Q: {h['prompt'][:80]}\nA: {h['response'][:120]}")
        past_context = "\n".join(lines)

    # ── 9: Adaptive preference injection ──────────────────────────────────
    pref_context = preferences.build_preference_prompt()

    # Determine routing early so system prompt can be adjusted per-agent
    agent = _route(prompt)

    # ── 6: Build rich system prompt ───────────────────────────────────────
    # If this request routes to Nexus, prefer the Nexus system that enforces
    # final-line JSON A2UI output.
    system_parts = []
    if agent == "nexus":
        system_parts.append(_NEXUS_SYSTEM)
    system_parts.append(system_prompt if system_prompt else _BASE_SYSTEM)
    if pref_context:
        system_parts.append(f"[User Preferences]\n{pref_context}")
    if kb_context:
        system_parts.append(kb_context)
    if past_context:
        system_parts.append(past_context)
    if current_url:
        system_parts.append(f"[Current browser tab] {current_title or current_url} — {current_url}")
    system = "\n\n".join(system_parts)

    # ── 6: Multi-turn dialogue context ───────────────────────────────────
    history_text = ""
    if history:
        turns = "\n".join(f"{m['role'].upper()}: {m['content'][:200]}" for m in history[-4:])
        history_text = f"[Conversation so far]\n{turns}\n"
    full_prompt = history_text + f"USER: {prompt}"

    # ── 3: Planning for complex goals ─────────────────────────────────────
    agent = _route(prompt)
    plan_summary = ""
    if needs_planning(prompt):
        plan_id, steps = await create_plan(prompt)
        if steps:
            log.info(f"[{task_id}] Executing {len(steps)}-step plan")
            plan_summary = await execute_plan(plan_id, steps)
            if plan_summary:
                full_prompt += f"\n\n[Plan execution results]\n{plan_summary[:2000]}"

    # ── Tool pre-execution (browser/code/ipfs agents) ─────────────────────
    tool_output = ""
    if agent in ("browser", "code", "commerce", "calendar", "ipfs") and not plan_summary:
        tool_output = await _run_top_tool(agent, prompt)
        if tool_output:
            full_prompt += f"\n\n[Tool result]\n{tool_output[:1500]}"

    # ── LLM inference with retry loop (Point 5) ───────────────────────────
    models   = await ollama.available_models()
    model    = await _pick_model(models)
    response = ""
    eval_result = None

    for attempt in range(3):
        try:
            response = await _call_llm(full_prompt, system, model)
        except Exception as e:
            return _error_result(task_id, str(e), agent)

        # ── 5: Self-evaluation ─────────────────────────────────────────
        eval_result = evaluate(response, prompt, agent)
        if eval_result.verdict == "good":
            break
        if should_retry(eval_result, attempt):
            log.info(f"[{task_id}] Retry {attempt+1}: score={eval_result.score:.2f}")
            full_prompt = build_retry_prompt(prompt, response, kb_context, history)
        else:
            break

    # ── 7: Response safety check ──────────────────────────────────────────
    resp_guard = check_response(response)
    if not resp_guard:
        response = SAFE_FALLBACK

    # ── Extract A2UI action ───────────────────────────────────────────────
    clean, a2ui = _split_response(response, agent, prompt)

    # ── 4: Store to session + interaction history ─────────────────────────
    sessions.append_message(session_id, "agent", clean)
    interactions.store(task_id, prompt, clean, agent)

    # ── 9: Update user preferences from interaction signals ───────────────
    _infer_preferences(prompt)

    # If Nexus returned plain text, coerce into a deterministic GenUI research
    # component so the renderer receives a structured UI payload.
    final_a2ui = a2ui
    try:
        if agent == "nexus" and isinstance(a2ui, dict) and a2ui.get("type") == "text":
            comp = research_component(prompt or "Nexus Panel", summary=a2ui.get("content", ""), topic=(prompt[:60] if prompt else ""))
            valid = validate_component(comp)
            if valid:
                final_a2ui = {"type": "ui_component", "component": valid}
    except Exception:
        pass

    return {
        "status":     "success",
        "evaluation": clean,
        "agent_used": agent,
        "task_id":    task_id,
        "a2ui":       final_a2ui,
        "eval_score": round(eval_result.score, 2) if eval_result else 1.0,
        "plan_used":  bool(plan_summary),
    }



def _split_response(text: str, agent: str, prompt: str) -> tuple[str, dict]:
    # Robust JSON extraction: scan for balanced-brace substrings and attempt
    # to parse them as JSON. Return the first parsable object that contains
    # a top-level "type" key. Otherwise fall back to _pick_a2ui.
    s = text or ""
    n = len(s)
    for i, ch in enumerate(s):
        if ch != "{":
            continue
        depth = 0
        for j in range(i, n):
            if s[j] == "{":
                depth += 1
            elif s[j] == "}":
                depth -= 1
                if depth == 0:
                    candidate = s[i:j+1]
                    try:
                        obj = json.loads(candidate)
                        if isinstance(obj, dict) and "type" in obj:
                            clean = (s[:i] + s[j+1:]).strip()
                            # If there is significant text before the JSON,
                            # keep it as the evaluation; otherwise empty string.
                            return clean.strip(), obj
                    except json.JSONDecodeError:
                        pass
                    break
    # No parsable JSON found — synthesize or fallback
    return s.strip(), _pick_a2ui(s, agent, prompt)


async def _run_top_tool(agent: str, prompt: str) -> str:
    """Run the most relevant single tool for a given agent type."""
    from tools.registry import tools_for_agent, get_tool
    tools = tools_for_agent(agent)
    if not tools:
        return ""
    try:
        if agent in ("browser", "commerce"):
            tool = tools[0]
            cleaned = re.sub(r'^(search|find|look\s+up|what\s+is|tell\s+me\s+about)\s+', '',
                             prompt, flags=re.IGNORECASE).strip()
            return await tool.run(query=cleaned)
        elif agent == "code":
            tool = tools[0]
            return await tool.run(path=".")
        elif agent == "calendar":
            tool = tools[0]
            return await tool.run(date="")
        elif agent == "ipfs":
            cid_match = re.search(r'(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z0-9]{55})', prompt)
            cid = cid_match.group(1) if cid_match else ""
            
            if any(k in prompt.lower() for k in ("load", "inject", "install")):
                if cid:
                    tool = get_tool("ipfs_dynamic_load_tool")
                    return await tool.run(cid=cid)
                return "Error: No IPFS CID found in prompt to load tool."
            elif any(k in prompt.lower() for k in ("upload", "pin", "publish")):
                text_match = re.search(r'["\'](.*?)["\']', prompt)
                text = text_match.group(1) if text_match else prompt
                tool = get_tool("ipfs_upload_text")
                return await tool.run(text=text)
            else:
                if cid:
                    tool = get_tool("ipfs_cat_text")
                    return await tool.run(cid=cid)
                  
                return "Error: No IPFS CID found in prompt to fetch."
    except Exception as e:
        return f"Tool error: {e}"
    return ""


async def _pick_model(models: list[str]) -> str:
    if not models:
        return config.SLM_MODEL
    for m in models:
        if "cloud" in m:
            return m
    return models[0]


async def _describe_image(image_b64: str) -> str:
    """Use Ollama llava model to describe an image (Point 8)."""
    try:
        async with __import__("httpx").AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{config.OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": "llava",
                    "prompt": "Describe this image concisely for a browser agent.",
                    "images": [image_b64],
                    "stream": False,
                }
            )
            if r.status_code == 200:
                return r.json().get("response", "")
    except Exception:
        pass
    return ""


def _infer_preferences(prompt: str):
    """Detect and persist user preference signals from prompts (Point 9)."""
    p = prompt.lower()
    # Language preference
    lang_map = {
        "in hindi": "Hindi", "in spanish": "Spanish",
        "in french": "French", "in tamil": "Tamil",
        "in telugu": "Telugu", "in arabic": "Arabic",
    }
    for trigger, lang in lang_map.items():
        if trigger in p:
            preferences.set("language", lang)
            break
    # Tone preference
    if any(w in p for w in ["formally", "professional", "formal"]):
        preferences.set("tone", "formal")
    elif any(w in p for w in ["casually", "friendly", "simple"]):
        preferences.set("tone", "casual")
    # Domain interest tracking
    domain_signals = {
        "crypto": ["bitcoin","ethereum","crypto","blockchain","defi","nft"],
        "commerce": ["order","shop","buy","product","delivery"],
        "ipfs": ["ipfs","decentralized","cid","pin"],
        "code": ["code","bug","function","script","build"],
    }
    domains = preferences.get("domains", [])
    for domain, signals in domain_signals.items():
        if any(s in p for s in signals) and domain not in domains:
            domains.append(domain)
            preferences.set("domains", domains[-5:])  # keep last 5


def _error_result(task_id: str, msg: str, agent: str) -> dict:
    return {
        "status": "error",
        "evaluation": msg,
        "agent_used": agent,
        "task_id": task_id,
        "a2ui": {"type": "text", "content": msg},
        "eval_score": 0.0,
        "plan_used": False,
    }

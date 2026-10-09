"""
Goal-Driven Planner — Point 3.
Decomposes high-level objectives into ordered sub-tasks with success criteria.
Uses the LLM to generate plans, then executes each step with tool calls.
"""
import re
import uuid
import logging
from typing import Optional
import ollama_client as ollama
import config
from memory.session_store import plan_store

log = logging.getLogger("bucks-planner")

_PLAN_SYSTEM = """You are a task planning expert. When given a high-level goal, decompose it into
3-6 clear, actionable sub-tasks. Each sub-task should:
- Be a single, concrete action
- Have a clear success criterion
- Be achievable with web search, code execution, or file operations

Output ONLY a JSON array like:
[
  {"step": 1, "task": "Search for X", "success_criterion": "Found at least 3 results", "tool": "web_search"},
  {"step": 2, "task": "Fetch the top result URL", "success_criterion": "Page content retrieved", "tool": "fetch_url"}
]

Keep tasks minimal and focused. Do not include steps that require human action."""

_COMPLEX_TRIGGERS = [
    r"\b(research|analyze|compare|investigate|build|create|implement|design)\b",
    r"\b(step[\s-]by[\s-]step|in\s+detail|comprehensive|thorough|complete)\b",
    r"\band\s+then\b.+\band\s+then\b",
    r"\b(first|second|third|finally)\b.+\b(then|after|next)\b",
    r"\b(research\s+and\s+(compare|analyze|summarize))\b",
    r"\b(compare\s+(top|best|leading|multiple))\b",
    r"\b(find\s+and\s+(analyze|compare|summarize|explain))\b",
]
_COMPLEX_RE = [re.compile(p, re.IGNORECASE) for p in _COMPLEX_TRIGGERS]


def needs_planning(prompt: str) -> bool:
    """Heuristic: does this query need multi-step planning?"""
    if len(prompt.split()) < 5:
        return False
    return any(r.search(prompt) for r in _COMPLEX_RE)


async def create_plan(prompt: str, model: str = None) -> tuple[str, list[dict]]:
    """
    Ask the LLM to decompose a goal into steps.
    Returns (plan_id, steps).
    """
    if model is None:
        models = await ollama.available_models()
        model = next((m for m in models if "cloud" in m), models[0] if models else config.SLM_MODEL)

    try:
        raw = await ollama.generate(
            model=model,
            prompt=f"Goal: {prompt}\n\nCreate a step-by-step plan as a JSON array.",
            system=_PLAN_SYSTEM,
        )
        # Extract JSON array from response
        match = re.search(r'\[[\s\S]*\]', raw)
        if not match:
            return "", []
        steps = __import__("json").loads(match.group())
        if not isinstance(steps, list):
            return "", []

        plan_id = str(uuid.uuid4())[:8]
        plan_store.save_plan(plan_id, [s.get("task","") for s in steps])
        log.info(f"Plan {plan_id}: {len(steps)} steps for: {prompt[:50]}")
        return plan_id, steps

    except Exception as e:
        log.error(f"Planning error: {e}")
        return "", []


async def execute_plan(plan_id: str, steps: list[dict]) -> str:
    """
    Execute each step using appropriate tools, collect results.
    Returns a consolidated summary string.
    """
    from tools.registry import TOOLS
    results = []

    for step in steps:
        idx     = step.get("step", 0) - 1
        task    = step.get("task", "")
        tool_name = step.get("tool", "web_search")
        criterion = step.get("success_criterion", "")

        plan_store.update_step(plan_id, idx, "in_progress")
        log.info(f"[{plan_id}] Step {idx+1}: {task}")

        tool = TOOLS.get(tool_name)
        if not tool:
            result = f"Tool '{tool_name}' not available."
            plan_store.update_step(plan_id, idx, "failed", result)
            results.append(f"Step {idx+1} ({task}): {result}")
            continue

        # Extract a sensible argument from the task description
        arg = _extract_tool_arg(task, tool_name)
        try:
            result = await tool.run(**arg)
            # Truncate long tool outputs
            result_str = str(result)[:1200]
            plan_store.update_step(plan_id, idx, "done", result_str)
            results.append(f"Step {idx+1} — {task}:\n{result_str}")
        except Exception as e:
            plan_store.update_step(plan_id, idx, "failed", str(e))
            results.append(f"Step {idx+1} ({task}): Error — {e}")

    return "\n\n".join(results)


def _extract_tool_arg(task: str, tool_name: str) -> dict:
    """
    Infer tool arguments from a plain-English task description.
    """
    # Strip leading action words
    cleaned = re.sub(r'^(search\s+for|search|find|fetch|open|read|list|check)\s+',
                     '', task, flags=re.IGNORECASE).strip()

    url_match = re.search(r'https?://\S+', task)

    arg_map = {
        "web_search":     {"query": cleaned},
        "fetch_url":      {"url": url_match.group() if url_match else "https://google.com"},
        "extract_links":  {"url": url_match.group() if url_match else "https://google.com"},
        "read_file":      {"path": cleaned},
        "list_directory": {"path": cleaned or "."},
        "git_status":     {},
        "execute_code":   {"code": cleaned, "language": "python"},
        "track_order":    {"order_id": cleaned},
        "product_search": {"query": cleaned},
        "calendar_list":  {"date": cleaned},
    }
    return arg_map.get(tool_name, {"query": cleaned})

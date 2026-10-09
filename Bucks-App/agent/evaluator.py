"""
Self-Evaluation Loop — Point 5.
Scores agent responses, detects errors, triggers retries or clarification requests.
"""
import re
import logging
from dataclasses import dataclass, field

log = logging.getLogger("bucks-evaluator")

# ── Signals that indicate poor/incomplete responses ──────────────────────────

_LOW_QUALITY = [
    r"\bI\s+(don't|do not|cannot|can't)\s+(know|help|answer|provide)\b",
    r"\bI'm\s+(not\s+sure|unsure|uncertain)\b",
    r"\bI\s+apologize\b.{0,40}\b(unable|cannot)\b",
    r"\b(error|exception|traceback|failed)\b",
    r"^(N/A|None|null|\{\}|\[\])$",
    r"\b(as\s+an\s+AI|as\s+a\s+language\s+model)\b",
    # Search-failure fallbacks — these are non-answers that should trigger NIM
    r"couldn't find specific results",
    r"could not find specific results",
    r"No results found",
    r"try visiting a search engine directly",
    r"I searched for .{0,80} but couldn't",
]

_ERROR_SIGNALS = [
    r"\b(500|502|503|504)\s+(error|bad gateway|service unavailable)\b",
    r"(ConnectionError|TimeoutError|JSONDecodeError)",
    r"\bModel\s+error\b",
]

_HALLUCINATION_SIGNALS = [
    r"\b(as\s+of\s+my\s+knowledge\s+cutoff|my\s+training\s+data)\b",
    r"\b(I\s+made\s+up|fabricated|hallucinated)\b",
]

_COMPILED_LOW   = [re.compile(p, re.IGNORECASE) for p in _LOW_QUALITY]
_COMPILED_ERROR = [re.compile(p, re.IGNORECASE) for p in _ERROR_SIGNALS]
_COMPILED_HALL  = [re.compile(p, re.IGNORECASE) for p in _HALLUCINATION_SIGNALS]


@dataclass
class EvalResult:
    score: float          # 0.0 – 1.0
    verdict: str          # "good" | "retry" | "clarify" | "error"
    issues: list[str] = field(default_factory=list)
    suggestion: str = ""


def evaluate(response: str, prompt: str = "", agent: str = "") -> EvalResult:
    """
    Score a response. Returns EvalResult with action recommendation.
    """
    score = 1.0
    issues = []

    if not response or len(response.strip()) < 5:
        return EvalResult(0.0, "retry", ["Empty response"], "Re-query with more context.")

    # Penalise low-quality signals
    for pattern in _COMPILED_LOW:
        if pattern.search(response):
            score -= 0.25
            issues.append(f"Low-quality signal: {pattern.pattern[:40]}")

    # Penalise error signals harder
    for pattern in _COMPILED_ERROR:
        if pattern.search(response):
            score -= 0.4
            issues.append(f"Error detected: {pattern.pattern[:40]}")

    # Penalise hallucination signals
    for pattern in _COMPILED_HALL:
        if pattern.search(response):
            score -= 0.15
            issues.append("Potential hallucination phrasing")

    # Reward substantive length
    word_count = len(response.split())
    if word_count < 10:
        score -= 0.2
        issues.append("Response very short")
    elif word_count > 30:
        score += 0.05  # small bonus for substance

    score = max(0.0, min(1.0, score))

    # Determine verdict
    if score >= 0.7:
        verdict = "good"
        suggestion = ""
    elif score >= 0.45:
        verdict = "clarify"
        suggestion = _clarification_prompt(prompt, response)
    else:
        verdict = "retry"
        suggestion = "Response quality too low. Retrying with enhanced context."

    log.debug(f"[eval] agent={agent} score={score:.2f} verdict={verdict} issues={issues}")
    return EvalResult(score=score, verdict=verdict, issues=issues, suggestion=suggestion)


def _clarification_prompt(original_prompt: str, response: str) -> str:
    """Generate a clarification request the agent should surface to the user."""
    if "?" not in original_prompt:
        return f"Could you clarify what you mean by: '{original_prompt[:60]}'?"
    return "I need a bit more detail to help effectively. Could you elaborate?"


def should_retry(result: EvalResult, attempt: int, max_attempts: int = 2) -> bool:
    return result.verdict == "retry" and attempt < max_attempts


def build_retry_prompt(original_prompt: str, failed_response: str,
                       kb_context: str = "", history: list[dict] = None) -> str:
    """
    Construct an enhanced prompt for retry — includes failure context,
    KB hints, and an explicit instruction to do better.
    """
    parts = [
        "Your previous response was insufficient. Try again with more detail and accuracy.",
    ]
    if kb_context:
        parts.append(kb_context)
    if history:
        recent = history[-2:]
        for msg in recent:
            parts.append(f"{msg['role'].upper()}: {msg['content'][:200]}")
    parts.append(f"USER: {original_prompt}")
    parts.append(f"PREVIOUS ATTEMPT: {failed_response[:300]}")
    parts.append("BETTER RESPONSE:")
    return "\n\n".join(parts)

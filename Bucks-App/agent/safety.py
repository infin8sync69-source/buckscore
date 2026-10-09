"""
Safety Guardrails — Point 7.
Content filters, bias detection, rate limiting, fail-safe mechanisms.
"""
import re
import time
import hashlib
from collections import defaultdict

# ── Blocklist patterns ────────────────────────────────────────────────────────

_HARM_PATTERNS = [
    # Violence / weapons
    r"(how\s+to\s+(make|build|create|assemble)\s+(a\s+)?(bomb|weapon|explosive|gun|grenade|malware|virus|trojan|ransomware))",
    r"(step[\s-]by[\s-]step.{0,40}(bomb|attack|exploit|hack|crack\s+password|weapon))",
    r"(make\s+(a\s+)?(bomb|explosive|weapon).{0,30}(step|instruc|how))",
    r"(instructions?\s+for\s+(making|building|creating).{0,30}(bomb|weapon|explosive))",
    # Drugs
    r"(synthesize\s+(meth|cocaine|fentanyl|heroin|drug))",
    r"(how\s+to\s+make\s+(meth|cocaine|fentanyl|crack|heroin))",
    # PII / doxxing
    r"(doxx|dox\s+(someone|user|person))",
    r"(find\s+(ssn|social\s+security|credit\s+card\s+number|cvv)\s+of)",
    # Self-harm
    r"(how\s+to\s+(commit\s+suicide|self[\s-]harm|kill\s+(myself|yourself)))",
]

_BIAS_PATTERNS = [
    # Discriminatory generalisations
    r"\b(all\s+(black|white|asian|muslim|jewish|christian|hindu)\s+people\s+(are|is))\b",
    r"\b(women\s+(can't|cannot|shouldn't|don't)\s+(code|drive|lead|think))\b",
]

_COMPILED_HARM = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in _HARM_PATTERNS]
_COMPILED_BIAS = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in _BIAS_PATTERNS]


# ── Rate limiter ──────────────────────────────────────────────────────────────

class RateLimiter:
    """Token-bucket rate limiter per session."""
    def __init__(self, max_rps: int = 5, window: int = 60):
        self._window  = window
        self._max_rps = max_rps
        self._buckets: dict[str, list[float]] = defaultdict(list)

    def allow(self, session_id: str) -> bool:
        now  = time.time()
        hits = self._buckets[session_id]
        # Remove old timestamps outside the window
        self._buckets[session_id] = [t for t in hits if now - t < self._window]
        if len(self._buckets[session_id]) >= self._max_rps:
            return False
        self._buckets[session_id].append(now)
        return True

    def reset(self, session_id: str):
        self._buckets.pop(session_id, None)


rate_limiter = RateLimiter(max_rps=30, window=60)


# ── Guardrail check ───────────────────────────────────────────────────────────

class GuardrailResult:
    def __init__(self, safe: bool, reason: str = "", category: str = ""):
        self.safe     = safe
        self.reason   = reason
        self.category = category

    def __bool__(self):
        return self.safe


def check_prompt(prompt: str, session_id: str = "default") -> GuardrailResult:
    """
    Check a user prompt against all safety rules.
    Returns GuardrailResult; .safe=False means the request should be blocked.
    """
    # Rate limiting
    if not rate_limiter.allow(session_id):
        return GuardrailResult(False, "Too many requests. Please wait a moment.", "rate_limit")

    # Length check
    if len(prompt) > 8000:
        return GuardrailResult(False, "Input too long. Please shorten your message.", "length")

    # Harmful content
    for pattern in _COMPILED_HARM:
        if pattern.search(prompt):
            return GuardrailResult(False,
                "I can't help with that request as it may facilitate harm.",
                "harmful_content")

    # Bias/discrimination
    for pattern in _COMPILED_BIAS:
        if pattern.search(prompt):
            return GuardrailResult(False,
                "That prompt contains generalizations I shouldn't amplify. "
                "Please rephrase without broad group attributions.",
                "bias_detected")

    return GuardrailResult(True)


def check_response(response: str) -> GuardrailResult:
    """
    Post-generation check on model output.
    Catches hallucinated harmful content or PII leakage.
    """
    # Credit card pattern
    if re.search(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b', response):
        return GuardrailResult(False, "Response contained potential PII and was blocked.", "pii_leakage")

    # Phone numbers in bulk (suspicious)
    if len(re.findall(r'\b\d{10}\b', response)) > 3:
        return GuardrailResult(False, "Response flagged for potential data exposure.", "pii_bulk")

    # Harmful content check on output too
    for pattern in _COMPILED_HARM:
        if pattern.search(response):
            return GuardrailResult(False, "Response filtered for safety.", "harmful_output")

    return GuardrailResult(True)


def sanitize_for_log(text: str) -> str:
    """Remove PII patterns before logging."""
    text = re.sub(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b', '[CARD_REDACTED]', text)
    text = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL_REDACTED]', text)
    text = re.sub(r'\b\d{10,12}\b', '[PHONE_REDACTED]', text)
    return text


def add_harm_pattern(pattern: str):
    """Runtime extension — add new harm patterns without restart."""
    compiled = re.compile(pattern, re.IGNORECASE | re.DOTALL)
    _COMPILED_HARM.append(compiled)


SAFE_FALLBACK = (
    "I wasn't able to complete that request safely. "
    "Please try rephrasing or ask for something different."
)

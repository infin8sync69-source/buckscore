"""
RoutingPolicy — ε-greedy contextual bandit for agent routing.

Learns which agent_id performs best for a given query context.
Weights are updated via exponential moving average (EMA).

Constraint: can only update routing weights in floating memory.
            It cannot override frozen memory or soul signatures.
"""
import json
import logging
import random
from pathlib import Path
from typing import List, Optional

log = logging.getLogger("bucks.rl.policy")

_POLICY_FILE = Path(__file__).parent.parent.parent / "data" / "routing_policy.json"
_DEFAULT_AGENTS = ["slm", "browser", "wallet", "ipfs", "code", "commerce", "calendar"]
_ALPHA   = 0.1   # EMA learning rate
_EPSILON = 0.1   # exploration rate


class RoutingPolicy:
    def __init__(self, policy_path: Optional[Path] = None, alpha: float = _ALPHA, epsilon: float = _EPSILON):
        self._path    = policy_path or _POLICY_FILE
        self._alpha   = alpha
        self._epsilon = epsilon
        self._weights: dict[str, float] = {}
        self._load()

    # ── Action selection ──────────────────────────────────────────────────────

    def select_action(
        self,
        candidates: List[str],
        state_embedding: Optional[List[float]] = None,
    ) -> str:
        """
        ε-greedy selection:
          - With probability ε: pick a random candidate (explore).
          - Otherwise: pick the candidate with the highest weight (exploit).
        """
        if not candidates:
            return "slm"

        if random.random() < self._epsilon:
            return random.choice(candidates)

        best = max(candidates, key=lambda a: self._weights.get(a, 0.5))
        return best

    # ── Weight update ─────────────────────────────────────────────────────────

    def update(self, action: str, reward: float) -> None:
        """EMA update: w ← α·reward + (1−α)·w"""
        current = self._weights.get(action, 0.5)
        self._weights[action] = round(
            self._alpha * reward + (1 - self._alpha) * current, 4
        )
        self._save()
        log.debug("Policy update: %s → %.4f (reward=%.3f)", action, self._weights[action], reward)

    def update_batch(self, experiences: List[dict]) -> None:
        """Apply multiple (action, reward) updates at once."""
        for exp in experiences:
            self.update(exp.get("action", ""), float(exp.get("reward", 0)))

    # ── Read ──────────────────────────────────────────────────────────────────

    def get_weights(self) -> dict:
        return dict(self._weights)

    def best_agent(self, candidates: Optional[List[str]] = None) -> str:
        pool = candidates or _DEFAULT_AGENTS
        return max(pool, key=lambda a: self._weights.get(a, 0.5))

    # ── Persistence ───────────────────────────────────────────────────────────

    def _save(self) -> None:
        try:
            _POLICY_FILE.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps(self._weights, indent=2))
        except Exception as e:
            log.error("Failed to save routing policy: %s", e)

    def _load(self) -> None:
        if self._path.exists():
            try:
                self._weights = json.loads(self._path.read_text())
                log.info("Loaded routing policy: %s", self._weights)
                return
            except Exception as e:
                log.warning("Failed to load routing policy: %s", e)
        # Initialize with neutral weights
        self._weights = {a: 0.5 for a in _DEFAULT_AGENTS}

    def reset(self) -> None:
        self._weights = {a: 0.5 for a in _DEFAULT_AGENTS}
        self._save()
        log.warning("Routing policy reset to neutral weights.")

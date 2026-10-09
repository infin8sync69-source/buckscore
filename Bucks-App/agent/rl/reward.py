"""
RewardModel — computes scalar reward from feedback signals.

Inputs:
  feedback_score  : -1 (bad) / 0 (neutral) / 1 (good) — explicit user rating
  latency_ms      : response time in milliseconds
  tool_succeeded  : did the selected tool complete without error
  correction_given: user provided a correction text

Output: float in [-2.0, 2.0]

This reward is ONLY used to update the floating-layer RL policy.
It cannot modify frozen memory or soul structure.
"""
import logging

log = logging.getLogger("bucks.rl.reward")


class RewardModel:
    def compute(
        self,
        feedback_score: int = 0,
        latency_ms: float = 0.0,
        tool_succeeded: bool = True,
        correction_given: bool = False,
    ) -> float:
        """
        Compute composite reward.

        feedback_score : -1 | 0 | 1
        latency_ms     : measured response latency
        tool_succeeded : False if a tool raised an exception
        correction_given: True if user submitted a correction
        """
        r = float(feedback_score)                        # base [-1, 1]

        # Latency signal: fast responses are rewarded
        if latency_ms > 0:
            if latency_ms < 1500:
                r += 0.3
            elif latency_ms < 3000:
                r += 0.1
            elif latency_ms > 8000:
                r -= 0.2

        if not tool_succeeded:
            r -= 0.5

        if correction_given:
            r -= 0.3

        return max(-2.0, min(2.0, round(r, 3)))

    def implicit_reward(self, task_completed: bool, latency_ms: float) -> float:
        """
        Reward signal derived from task outcome alone (no explicit feedback).
        Used to update the policy in the background after every response.
        """
        r = 0.2 if task_completed else -0.1
        if latency_ms < 2000:
            r += 0.1
        elif latency_ms > 6000:
            r -= 0.1
        return round(r, 3)

#!/usr/bin/env python3
"""
Soul of the World — Pheromone Trail Manager
Implements ACO stigmergy for CID path optimization.
Formula: τ_ij(t+1) = (1-ρ)·τ_ij(t) + Σ(Q/L_k)

ρ = 0.1   (Dorigo-recommended slow evaporation → long memory)
Q = 1.0   (deposit constant)
"""
import json, time
from pathlib import Path

RHO     = 0.1   # evaporation rate
Q       = 1.0   # pheromone deposit constant
TAU_MIN = 0.01  # floor — trails never fully evaporate


class PheromoneManager:
    def __init__(self, trail_file: str | Path = None):
        self.trail_file = (
            Path(trail_file) if trail_file
            else Path(__file__).parent / 'soul_pheromones.json'
        )
        self._load()

    # ── Persistence ──────────────────────────────────────────────────────────

    def _load(self):
        if self.trail_file.exists():
            data = json.loads(self.trail_file.read_text(encoding='utf-8'))
            self.trails = data.get('trails', {})
            self.meta   = data.get('meta', self._default_meta())
        else:
            self.trails = {}
            self.meta   = self._default_meta()

    def _save(self):
        self.trail_file.write_text(
            json.dumps({'meta': self.meta, 'trails': self.trails},
                       indent=2, ensure_ascii=False),
            encoding='utf-8',
        )

    @staticmethod
    def _default_meta() -> dict:
        return {
            'queries':          0,
            'last_evaporation': time.time(),
            'rho':              RHO,
            'Q':                Q,
            'tau_min':          TAU_MIN,
        }

    # ── ACO operations ───────────────────────────────────────────────────────

    def reinforce(self, cids: list, path_length: int, quality: float = 1.0):
        """
        Deposit pheromone on a list of CIDs from a successful query.
        Δτ = Q × quality / L_k
        """
        deposit = Q * max(quality, 0.0) / max(path_length, 1)
        for cid in cids:
            self.trails[cid] = self.trails.get(cid, TAU_MIN) + deposit
        self.meta['queries'] += 1
        # Auto-evaporate every 10 queries
        if self.meta['queries'] % 10 == 0:
            self.evaporate()
        self._save()

    def evaporate(self):
        """Apply evaporation to all trails: τ ← max(τ_min, τ × (1-ρ))"""
        for cid in list(self.trails):
            self.trails[cid] = max(TAU_MIN, self.trails[cid] * (1.0 - RHO))
        self.meta['last_evaporation'] = time.time()
        self._save()

    def get_strength(self, cid: str) -> float:
        """Return current pheromone strength for a CID."""
        return self.trails.get(cid, TAU_MIN)

    def strongest_paths(self, n: int = 10) -> list[tuple[str, float]]:
        """Return top-N (cid, strength) pairs sorted descending."""
        return sorted(self.trails.items(), key=lambda x: x[1], reverse=True)[:n]

    # ── Diagnostics ──────────────────────────────────────────────────────────

    def summary(self) -> dict:
        strengths = list(self.trails.values())
        if not strengths:
            return {'tracked': 0}
        return {
            'tracked':   len(self.trails),
            'queries':   self.meta['queries'],
            'max':       round(max(strengths), 6),
            'min':       round(min(strengths), 6),
            'mean':      round(sum(strengths) / len(strengths), 6),
        }


if __name__ == '__main__':
    pm = PheromoneManager()
    print(f"Trail file:   {pm.trail_file}")
    s = pm.summary()
    print(f"Tracked CIDs: {s.get('tracked', 0)}")
    print(f"Total queries:{s.get('queries', 0)}")
    top = pm.strongest_paths()
    if top:
        print("\nTop pheromone paths:")
        for cid, strength in top:
            print(f"  {strength:.6f}  {cid[:60]}...")
    else:
        print("No trails yet.")

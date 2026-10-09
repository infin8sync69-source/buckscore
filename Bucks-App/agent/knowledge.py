"""
Minimal in-memory knowledge base.
Stores domain facts and retrieves them by keyword match for prompt grounding.
"""
from __future__ import annotations
import re
from typing import List, Tuple


class KnowledgeBase:
    def __init__(self):
        self._facts: List[Tuple[str, str]] = []  # (domain, fact)

    def add_fact(self, domain: str, fact: str) -> None:
        self._facts.append((domain, fact))

    def retrieve(self, query: str, k: int = 3) -> List[str]:
        q = query.lower()
        scored = []
        for domain, fact in self._facts:
            text = f"{domain} {fact}".lower()
            score = sum(1 for word in re.split(r"\W+", q) if word and word in text)
            if score:
                scored.append((score, fact))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [f for _, f in scored[:k]]

    def format_context(self, query: str, k: int = 3) -> str:
        results = self.retrieve(query, k=k)
        if not results:
            return ""
        return "Relevant knowledge:\n" + "\n".join(f"- {r}" for r in results)


kb = KnowledgeBase()

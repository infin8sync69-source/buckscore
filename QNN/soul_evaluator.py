#!/usr/bin/env python3
"""
Soul of the World — RAG Evaluator
Lightweight, local-only RAGAS-style evaluation for the swarm pipeline.

Metrics implemented (all computed with numpy + the already-loaded BGE-M3 encoder):

  1. faithfulness          — how well the response is grounded in the retrieved units.
                             Scores 0-1. 1.0 = every claim is supported by context.

  2. answer_relevance      — cosine similarity between the query embedding and the
                             response embedding. 1.0 = response is fully on-topic.

  3. context_precision     — fraction of retrieved units whose embeddings are
                             close to the query vector (above a threshold). Measures
                             whether retrieval actually found relevant material.

  4. context_recall        — measures whether the response text reuses vocabulary
                             and concepts from the retrieved units (BM25-based).

  5. composite_score       — weighted blend:
                             0.35×faithfulness + 0.35×answer_relevance
                             + 0.20×context_precision + 0.10×context_recall

Why not the RAGAS package?
  Full RAGAS requires an LLM judge (OpenAI / VertexAI) and has an unresolvable
  langchain_community conflict in the current install. These local metrics use the
  BGE-M3 encoder already in memory — no API calls, no latency overhead.

Usage:
    evaluator = SoulEvaluator(model=builder.model)
    scores = evaluator.evaluate(
        query          = "What is the nature of patience?",
        response       = "Patience is...",
        retrieved_units= hits,          # list of unit dicts from SwarmCore
    )
    print(scores)
    # {'faithfulness': 0.71, 'answer_relevance': 0.83,
    #  'context_precision': 0.80, 'context_recall': 0.64, 'composite': 0.75}
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Optional

import numpy as np

# Thresholds
FAITHFULNESS_THRESHOLD  = 0.35   # cosine-sim for a sentence to "match" a unit
CONTEXT_PRECISION_CUTOFF = 0.30  # units with query-sim above this count as relevant
WEIGHTS = {
    "faithfulness":      0.35,
    "answer_relevance":  0.35,
    "context_precision": 0.20,
    "context_recall":    0.10,
}


class SoulEvaluator:
    """
    Local RAG quality evaluator using the BGE-M3 encoder already loaded by the swarm.
    All methods are pure numpy — no external calls, no rate limits.
    """

    def __init__(self, model=None):
        """
        model: SentenceTransformer instance (already loaded in BuilderAgent).
               If None, embedding-based metrics are skipped and BM25-based fallbacks used.
        """
        self.model = model

    # ── Core encode ───────────────────────────────────────────────────────────

    def _encode(self, texts: list[str]) -> Optional[np.ndarray]:
        """Encode a list of texts. Returns shape (n, dim) or None if no model."""
        if self.model is None:
            return None
        return self.model.encode(texts, normalize_embeddings=True, batch_size=32).astype("float32")

    @staticmethod
    def _cosine(a: np.ndarray, b: np.ndarray) -> float:
        """Cosine similarity between two 1-D normalised vectors."""
        return float(np.dot(a, b))

    # ── Metric 1: Faithfulness ─────────────────────────────────────────────

    def _faithfulness(self, response: str, retrieved_units: list[dict]) -> float:
        """
        For each sentence in the response, compute cosine similarity against every
        retrieved unit's embedding. A sentence is 'faithful' if any unit exceeds
        FAITHFULNESS_THRESHOLD. Return fraction of faithful sentences.
        """
        if self.model is None or not retrieved_units:
            return self._faithfulness_bm25_fallback(response, retrieved_units)

        sentences = [s.strip() for s in re.split(r'[.!?]+', response) if len(s.strip()) > 15]
        if not sentences:
            return 0.5  # very short responses get neutral score

        unit_texts = [u.get("text_en", "") for u in retrieved_units]
        all_texts  = sentences + unit_texts
        embs       = self._encode(all_texts)
        if embs is None:
            return self._faithfulness_bm25_fallback(response, retrieved_units)

        sent_embs  = embs[:len(sentences)]
        unit_embs  = embs[len(sentences):]

        faithful = 0
        for s_emb in sent_embs:
            sims = unit_embs @ s_emb   # cosine sims to all units
            if float(sims.max()) >= FAITHFULNESS_THRESHOLD:
                faithful += 1

        return round(faithful / len(sentences), 4)

    def _faithfulness_bm25_fallback(self, response: str, retrieved_units: list[dict]) -> float:
        """
        Lexical faithfulness: fraction of non-trivial words in the response that
        appear in the retrieved context. Used when encoder is unavailable.
        """
        if not retrieved_units:
            return 0.0
        context_tokens = set(
            re.findall(r'\b[a-z]{4,}\b',
                       " ".join(u.get("text_en", "") for u in retrieved_units).lower())
        )
        resp_tokens = set(re.findall(r'\b[a-z]{4,}\b', response.lower()))
        if not resp_tokens:
            return 0.0
        overlap = len(resp_tokens & context_tokens) / len(resp_tokens)
        return round(overlap, 4)

    # ── Metric 2: Answer Relevance ─────────────────────────────────────────

    def _answer_relevance(self, query: str, response: str) -> float:
        """Cosine similarity between query embedding and response embedding."""
        if self.model is None:
            return self._answer_relevance_bm25_fallback(query, response)

        embs = self._encode([query, response])
        if embs is None:
            return self._answer_relevance_bm25_fallback(query, response)

        sim = self._cosine(embs[0], embs[1])
        # Cosine on BGE-M3 normalised vecs is in [-1, 1]; shift to [0, 1]
        return round(max(0.0, (sim + 1.0) / 2.0), 4)

    def _answer_relevance_bm25_fallback(self, query: str, response: str) -> float:
        """Jaccard overlap of query terms in response — used without encoder."""
        q_toks = set(re.findall(r'\b[a-z]{3,}\b', query.lower()))
        r_toks = set(re.findall(r'\b[a-z]{3,}\b', response.lower()))
        if not q_toks:
            return 0.5
        return round(len(q_toks & r_toks) / len(q_toks | r_toks), 4)

    # ── Metric 3: Context Precision ────────────────────────────────────────

    def _context_precision(self, query: str, retrieved_units: list[dict]) -> float:
        """
        Fraction of retrieved units that are semantically close to the query.
        A unit is 'relevant' if cosine-sim(unit, query) ≥ CONTEXT_PRECISION_CUTOFF.
        """
        if not retrieved_units:
            return 0.0

        # Re-use pre-computed retrieval scores if available (from SwarmCore output)
        scores = [float(u.get("score", 0.0)) for u in retrieved_units]
        if all(s == 0.0 for s in scores):
            # Fall back to raw embedding comparison
            if self.model is None:
                return 0.5
            unit_texts  = [u.get("text_en", "") for u in retrieved_units]
            all_texts   = [query] + unit_texts
            embs        = self._encode(all_texts)
            if embs is None:
                return 0.5
            q_emb       = embs[0]
            unit_embs   = embs[1:]
            scores      = (unit_embs @ q_emb).tolist()

        relevant = sum(1 for s in scores if s >= CONTEXT_PRECISION_CUTOFF)
        return round(relevant / len(retrieved_units), 4)

    # ── Metric 4: Context Recall (BM25-style) ─────────────────────────────

    def _context_recall(self, response: str, retrieved_units: list[dict]) -> float:
        """
        Measures how much of the retrieved units' vocabulary appears in the response.
        Proxy for whether the model actually used the context.
        Complements faithfulness (which measures per-sentence grounding).
        """
        if not retrieved_units:
            return 0.0
        context_text = " ".join(u.get("text_en", "") for u in retrieved_units)
        context_toks = Counter(re.findall(r'\b[a-z]{4,}\b', context_text.lower()))
        resp_toks    = set(re.findall(r'\b[a-z]{4,}\b', response.lower()))

        if not context_toks:
            return 0.0

        # Fraction of unique context vocabulary types recalled in the response
        recall = sum(1 for tok in context_toks if tok in resp_toks) / len(context_toks)
        return round(recall, 4)

    # ── Composite ─────────────────────────────────────────────────────────────

    def evaluate(
        self,
        query: str,
        response: str,
        retrieved_units: list[dict],
    ) -> dict:
        """
        Run all four metrics and return a score dict.
        All metrics in [0, 1]. Composite is a weighted blend.
        Typical latency: 20-60ms (dominated by 2 encoder calls for faithfulness).
        """
        faith  = self._faithfulness(response, retrieved_units)
        relev  = self._answer_relevance(query, response)
        prec   = self._context_precision(query, retrieved_units)
        recall = self._context_recall(response, retrieved_units)

        composite = round(
            WEIGHTS["faithfulness"]      * faith
            + WEIGHTS["answer_relevance"]  * relev
            + WEIGHTS["context_precision"] * prec
            + WEIGHTS["context_recall"]    * recall,
            4,
        )

        return {
            "faithfulness":      faith,
            "answer_relevance":  relev,
            "context_precision": prec,
            "context_recall":    recall,
            "composite":         composite,
        }

    def evaluate_batch(
        self,
        interactions: list[dict],
    ) -> list[dict]:
        """
        Evaluate a batch of interaction records (from LearningLogger).
        Each record must have: query, response_preview, retrieved_cids.
        Returns a list of score dicts, one per interaction.
        """
        results = []
        for rec in interactions:
            query    = rec.get("query", "")
            response = rec.get("response_preview", "")
            units    = [
                {"text_en": "", "cid": c, "score": 0.0}
                for c in rec.get("retrieved_cids", [])
            ]
            scores = self.evaluate(query, response, units)
            scores["query"] = query[:60]
            results.append(scores)
        return results


# ── Standalone smoke test ─────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Soul Evaluator — smoke test (encoder-free mode)")
    evaluator = SoulEvaluator(model=None)

    query    = "What is the nature of patience in hardship?"
    response = (
        "Patience is a virtue praised throughout the Soul of the World. "
        "Those who endure hardship with steadfastness are promised great reward. "
        "Grief and difficulty are not signs of abandonment, but tests of character."
    )
    units = [
        {"text_en": "Indeed, with hardship comes ease.", "score": 0.72, "cid": "sha256:a"},
        {"text_en": "Be patient — Allah is with the patient.", "score": 0.68, "cid": "sha256:b"},
        {"text_en": "Do not despair; hardship is followed by relief.", "score": 0.61, "cid": "sha256:c"},
    ]

    scores = evaluator.evaluate(query=query, response=response, retrieved_units=units)
    print("\nEvaluation scores:")
    for k, v in scores.items():
        bar = "█" * int(v * 20)
        print(f"  {k:22s} {v:.4f}  {bar}")

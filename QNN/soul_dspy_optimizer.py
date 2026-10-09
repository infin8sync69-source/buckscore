#!/usr/bin/env python3
"""
Soul of the World — DSPy Prompt Optimizer
Stanford's DSPy framework compiles the Ollama prompt in soul_builder_agent.py
against example Q&A pairs, finding the optimal prompt automatically via
BootstrapFewShot or MIPRO.

What DSPy does here:
  - Replaces the hardcoded prompt string in AdaptiveBuilder._call_soul_engine()
    with a compiled DSPy program that has been optimized against real examples.
  - The optimizer runs once (takes ~5 min with a small dev set) and saves the
    compiled program to soul_dspy_compiled.json.
  - At query time, the compiled program is loaded and used instead of the raw
    prompt — no runtime overhead, just a better-tuned prompt.

DSPy + Ollama local setup:
  - Uses dspy.OllamaLocal (points at http://127.0.0.1:11434)
  - Optimizer uses BootstrapFewShot which only needs the teacher (Ollama) to
    generate traces — no OpenAI key required.
  - If Ollama is offline, the script falls back to reporting the status.

Usage:
    # First time: compile and save (run once; takes a few minutes)
    python soul_dspy_optimizer.py --compile --examples soul_interactions.jsonl

    # Check the optimized prompt
    python soul_dspy_optimizer.py --show

    # Run a test query through the compiled program
    python soul_dspy_optimizer.py --query "What is the nature of patience?"

    # In soul_adaptive_builder.py, enable with:
    #   from soul_dspy_optimizer import load_compiled_program, dspy_generate
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BASE = Path(__file__).parent

COMPILED_PATH = BASE / "soul_dspy_compiled.json"
MIN_EXAMPLES  = 5      # minimum log entries needed to compile
DEV_SET_SIZE  = 20     # examples used for BootstrapFewShot

try:
    import dspy
    HAS_DSPY = True
except ImportError:
    HAS_DSPY = False


# ── DSPy Signature ────────────────────────────────────────────────────────────

class WisdomGuideSignature(dspy.Signature):
    """
    Answer a spiritual or philosophical question using retrieved passages from the
    Soul of the World. Ground your answer in the provided context passages.
    Be thoughtful, concise, and cite the layers when relevant.
    """
    context  = dspy.InputField(desc="Relevant passages from the Soul of the World corpus")
    question = dspy.InputField(desc="The user's question")
    answer   = dspy.OutputField(desc="A grounded, thoughtful response citing the passages")


# ── DSPy Program ─────────────────────────────────────────────────────────────

class SoulWisdomProgram(dspy.Module):
    """Single-hop RAG module: context + question → grounded answer."""

    def __init__(self):
        super().__init__()
        self.generate = dspy.ChainOfThought(WisdomGuideSignature)

    def forward(self, context: str, question: str) -> dspy.Prediction:
        return self.generate(context=context, question=question)


# ── LM Setup ─────────────────────────────────────────────────────────────────

def _setup_lm() -> bool:
    """Configure DSPy to use the local Ollama instance. Returns True if Ollama reachable."""
    if not HAS_DSPY:
        print("ERROR: dspy-ai not installed. Run: pip install dspy-ai --break-system-packages")
        return False

    import requests
    try:
        r = requests.get("http://127.0.0.1:11434/api/tags", timeout=3)
        if r.status_code != 200:
            print("ERROR: Ollama not reachable at localhost:11434")
            return False
        models = r.json().get("models", [])
        if not models:
            print("ERROR: No Ollama model loaded. Run: ollama pull <model>")
            return False
        model_name = models[0]["name"]
    except Exception as e:
        print(f"ERROR: Cannot reach Ollama: {e}")
        return False

    lm = dspy.OllamaLocal(
        model=model_name,
        base_url="http://localhost:11434",
        temperature=0.7,
        max_tokens=400,
    )
    dspy.configure(lm=lm)
    print(f"  DSPy LM: {model_name} (Ollama local)")
    return True


# ── Training Example Builder ──────────────────────────────────────────────────

def _load_examples(log_path: Path, min_alignment: float = 0.50) -> list[dspy.Example]:
    """
    Load training examples from soul_interactions.jsonl.
    Filters to interactions with alignment_score ≥ min_alignment.
    """
    examples = []
    if not log_path.exists():
        return examples

    with open(log_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue

            score = rec.get("corpus_alignment_score", 0.0)
            # NIM bridge entries carry estimated_quality when corpus_alignment_score
            # isn't set by the local swarm; treat them as equivalent for training.
            if score == 0.0 and rec.get("source") == "nim":
                score = rec.get("estimated_quality", 0.0)
            if score < min_alignment:
                continue

            # Skip entries not eligible for learning (e.g. error captures)
            if rec.get("learning_eligible") is False:
                continue

            query = rec.get("query", "")
            # Prefer full response for richer training signal; fall back to preview
            # (NIM bridge entries populate response_full; legacy entries use response_preview)
            response = (
                rec.get("response_full") or
                rec.get("response_preview") or
                rec.get("response") or ""
            )
            layers = rec.get("retrieved_layers", [])
            source = rec.get("source", "swarm")

            if not query or not response:
                continue

            # Build context string — layer refs for swarm hits, model tag for NIM examples
            if layers:
                context = f"Resonance layers retrieved: {', '.join(str(l) for l in layers)}"
            elif source == "nim":
                context = f"Reference answer from NIM ({rec.get('nim_model', 'unknown')})"
            else:
                context = "Soul of the World — direct response"

            ex = dspy.Example(
                context=context,
                question=query,
                answer=response,
            ).with_inputs("context", "question")
            examples.append(ex)

    return examples


# ── Metric ────────────────────────────────────────────────────────────────────

def _metric(example: dspy.Example, pred: dspy.Prediction, trace=None) -> bool:
    """
    Simple metric: prediction is acceptable if it's at least 30 chars
    and shares vocabulary with the example answer.
    A proper metric would use the SoulEvaluator composite score.
    """
    answer = getattr(pred, "answer", "") or ""
    if len(answer.strip()) < 30:
        return False

    import re
    pred_toks = set(re.findall(r'\b[a-z]{3,}\b', answer.lower()))
    gold_toks = set(re.findall(r'\b[a-z]{3,}\b', example.answer.lower()))
    if not gold_toks:
        return True
    overlap = len(pred_toks & gold_toks) / len(gold_toks)
    return overlap >= 0.15


# ── Compile ───────────────────────────────────────────────────────────────────

def compile_program(log_path: Path, output_path: Path = COMPILED_PATH):
    """
    Compile the WisdomGuide program using BootstrapFewShot.
    Saves the optimized program to soul_dspy_compiled.json.
    """
    if not _setup_lm():
        return

    examples = _load_examples(log_path)
    if len(examples) < MIN_EXAMPLES:
        print(
            f"  Need at least {MIN_EXAMPLES} high-quality interactions in {log_path.name}. "
            f"Found {len(examples)}. Run some queries first, then compile."
        )
        return

    # Split: first DEV_SET_SIZE for trainset, rest as devset
    trainset = examples[:DEV_SET_SIZE]
    print(f"  Compiling with {len(trainset)} examples...")

    program = SoulWisdomProgram()
    optimizer = dspy.BootstrapFewShot(
        metric=_metric,
        max_bootstrapped_demos=4,
        max_labeled_demos=2,
    )
    compiled = optimizer.compile(program, trainset=trainset)

    # Save
    compiled.save(str(output_path))
    print(f"  ✓ Compiled program saved to {output_path.name}")


# ── Load for inference ────────────────────────────────────────────────────────

def load_compiled_program() -> SoulWisdomProgram | None:
    """
    Load a previously compiled DSPy program from disk.
    Returns None if no compiled program exists or DSPy unavailable.
    """
    if not HAS_DSPY:
        return None
    if not COMPILED_PATH.exists():
        return None
    if not _setup_lm():
        return None
    program = SoulWisdomProgram()
    program.load(str(COMPILED_PATH))
    return program


def dspy_generate(context: str, question: str, program: SoulWisdomProgram) -> str:
    """
    Run the compiled DSPy program. Drop-in for AdaptiveBuilder._call_soul_engine().
    Returns the generated answer string.
    """
    try:
        pred = program(context=context, question=question)
        return getattr(pred, "answer", "") or ""
    except Exception as e:
        return f"[DSPy error: {e}]"


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Soul of the World — DSPy Optimizer")
    parser.add_argument("--compile",  action="store_true",  help="Compile program from interaction log")
    parser.add_argument("--show",     action="store_true",  help="Print compiled program details")
    parser.add_argument("--query",    metavar="TEXT",        help="Test a query through compiled program")
    parser.add_argument("--examples", default="soul_interactions.jsonl",
                        help="Interaction log to compile from (default: soul_interactions.jsonl)")
    args = parser.parse_args()

    if not HAS_DSPY:
        print("ERROR: dspy-ai not installed. Run: pip install dspy-ai --break-system-packages")
        sys.exit(1)

    if args.compile:
        print("Soul DSPy Optimizer — compiling...")
        compile_program(BASE / args.examples)

    elif args.show:
        if not COMPILED_PATH.exists():
            print("No compiled program found. Run with --compile first.")
        else:
            data = json.loads(COMPILED_PATH.read_text())
            print(json.dumps(data, indent=2)[:2000])

    elif args.query:
        program = load_compiled_program()
        if program is None:
            print("No compiled program. Run with --compile first.")
            sys.exit(1)
        context = "Soul of the World — passages on patience, wisdom, and guidance."
        answer  = dspy_generate(context, args.query, program)
        print(f"\nQ: {args.query}")
        print(f"A: {answer}")

    else:
        parser.print_help()
        print("\nQuick start:")
        print("  1. Run some swarm queries to build soul_interactions.jsonl")
        print("  2. python soul_dspy_optimizer.py --compile")
        print("  3. python soul_dspy_optimizer.py --query 'What is wisdom?'")


if __name__ == "__main__":
    main()

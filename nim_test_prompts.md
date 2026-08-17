# NIM/QNN Soul Engine — Prompt Test Suite

> **12 prompts across 4 complexity levels.**
> Grade each response on: Accuracy (0–3) · Depth (0–3) · Clarity (0–2) · Relevance (0–2) = 10 pts max.
> Engine won (QNN ⚡ or NIM ☁) should be noted for each response.

---

## Level 1 — Factual / Simple
*Tests basic recall, short answer, speed.*

| # | Prompt |
|---|--------|
| 1 | What is Bitcoin? |
| 2 | Explain IPFS in one sentence. |
| 3 | What does open source mean? |

---

## Level 2 — Conceptual / Medium
*Requires synthesis and explanation.*

| # | Prompt |
|---|--------|
| 4 | How does a peer-to-peer network differ from a client-server model? Give a concrete example. |
| 5 | What are the tradeoffs between self-hosting an app versus using a SaaS version? |
| 6 | Explain how a vector database like FAISS works and why it's useful for AI search. |

---

## Level 3 — Analytical / Hard
*Requires reasoning, comparison, or multi-step thinking.*

| # | Prompt |
|---|--------|
| 7 | Compare n8n, Zapier, and custom Python scripts for workflow automation. Which would you choose for a privacy-first startup and why? |
| 8 | A user wants to run Penpot locally but also collaborate with remote teammates. Walk through the architecture decisions they need to make. |
| 9 | What are the risks of storing a BIP-39 seed phrase digitally, and what mitigation strategies exist? |

---

## Level 4 — Agentic / Complex
*Tests whether the agent can reason about itself, plan multi-step actions, or handle open-ended creative tasks.*

| # | Prompt |
|---|--------|
| 10 | I'm building a decentralised browser app that runs open-source tools locally. What architecture decisions should I prioritise in year one? |
| 11 | Design a learning system where an AI improves itself by observing higher-quality AI outputs. What are the key components? |
| 12 | Given that QNN is trained on a 114-layer resonance architecture and NIM runs a 70B parameter model, explain in plain language how a user benefits from having both in the same interface. |

---

## Scoring rubric

| Dimension | 0 | Max |
|-----------|---|-----|
| **Accuracy** | Factually wrong or missing | 3 — completely correct |
| **Depth** | Surface-level only | 3 — multi-layer reasoning, nuanced |
| **Clarity** | Hard to follow | 2 — well-written, easy to parse |
| **Relevance** | Misses the question | 2 — directly and fully on-topic |

**Total: 10 pts per prompt. 120 pts max across the suite.**

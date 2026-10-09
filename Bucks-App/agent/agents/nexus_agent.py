"""
Nexus Agent — orchestrates Hermes and produces ephemeral UI A2UI actions.

Uses the Hermes model (via Ollama) to generate short ephemeral UI panels
and actions intended for the Bucks ephemeral surface protocol.
"""
from crewai import Agent
from langchain_ollama import ChatOllama

from config import OLLAMA_BASE_URL


def make_nexus_agent() -> Agent:
    llm = ChatOllama(
        model="hermes3:latest",
        base_url=OLLAMA_BASE_URL,
        temperature=0.2,
        num_ctx=4096,
        num_predict=512,
    )

    return Agent(
        role="Bucks Nexus (Hermes)",
        goal=(
            "Create concise ephemeral UI panels and orchestrate high-level agentic "
            "actions using the Hermes model. When appropriate, emit A2UI actions of "
            "type 'ephemeral' with a JSON payload that the frontend can render as a "
            "transient panel."
        ),
        backstory=(
            "You are Nexus, a lightweight orchestrator that drives ephemeral UI panels "
            "and high-level agentic coordination. Prefer short, safe UI payloads and "
            "return structured A2UI objects (type, title, content, actions)."
        ),
        tools=[],
        llm=llm,
        verbose=True,
        allow_delegation=False,
        max_iter=3,
    )

"""
SLM Agent — on-device Qwen2.5:3b for fast, private, low-latency responses.

Used for: intent routing, quick lookups, inline suggestions, and fallback
when the full Ollama stack isn't configured.  Runs entirely offline.
"""
from crewai import Agent
from model_factory import create_slm
from tools.web_tools import web_search


def make_slm_agent() -> Agent:
    llm = create_slm(temperature=0.2)

    return Agent(
        role="Bucks On-Device SLM",
        goal=(
            "Answer user queries quickly and privately using the on-device Qwen2.5:3b model. "
            "Produce concise A2UI responses — prefer navigate, search, or text actions. "
            "Never hallucinate URLs; use DuckDuckGo search when unsure."
        ),
        backstory=(
            "You are a compact, privacy-first language model (Qwen2.5 3B) running entirely "
            "on the user's device inside the Bucks browser. No data leaves the machine. "
            "You excel at fast intent recognition, quick lookups, and browser navigation "
            "assistance. When the task requires deep research or code changes, you hand off "
            "to a larger agent by returning a 'delegate' A2UI action."
        ),
        tools=[web_search],
        llm=llm,
        verbose=False,
        allow_delegation=False,
        max_iter=3,
    )

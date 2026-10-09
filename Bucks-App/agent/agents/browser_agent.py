"""
Browser Agent — navigates the web, searches, and scrapes pages using LitAI or Ollama.
"""
from crewai import Agent

from model_factory import create_llm
from tools.web_tools import web_search, fetch_url, extract_links


def make_browser_agent() -> Agent:
    llm = create_llm(task_type="general", temperature=0.3)

    return Agent(
        role="Bucks Browser Web Navigator",
        goal=(
            "Help users navigate the web, find information, and interact with websites "
            "through the Bucks browser. Produce A2UI actions for navigation and search."
        ),
        backstory=(
            "You are an expert web navigator embedded in the Bucks privacy browser. "
            "You can search the web using DuckDuckGo (no tracking), fetch and summarize pages, "
            "and extract useful links. You respect user privacy and prefer privacy-friendly sources. "
            "When the user wants to visit a URL, you produce a navigate A2UI action. "
            "When they want to search, you produce a search A2UI with a DuckDuckGo URL."
        ),
        tools=[web_search, fetch_url, extract_links],
        llm=llm,
        verbose=True,
        allow_delegation=False,
        max_iter=5,
    )

"""
LLM Factory — Creates LitAI, Ollama, NIM, or SLM (Qwen2.5:3b) instances based on config
"""
from typing import Any, Union
from crewai import LLM as CrewAILLM
from langchain_ollama import ChatOllama

from config import (
    get_provider, get_model_name,
    LITAI_API_KEY, LITAI_BASE_URL,
    OLLAMA_BASE_URL, NGC_API_KEY, NIM_BASE_URL,
    SLM_MODEL,
)


def create_llm(task_type: str = "general", temperature: float = 0.3) -> Union[ChatOllama, Any]:
    provider = get_provider()
    model_name = get_model_name(task_type)

    if provider == "litai":
        if not LITAI_API_KEY:
            raise ValueError("LITAI_API_KEY environment variable not set")
        return CrewAILLM(
            model=f"openai/{model_name}",
            api_key=LITAI_API_KEY,
            base_url=LITAI_BASE_URL,
            temperature=temperature,
        )

    elif provider == "nim":
        return CrewAILLM(
            model=f"openai/{model_name}",
            api_key=NGC_API_KEY or "no-key-required",
            base_url=NIM_BASE_URL,
            temperature=temperature,
        )

    elif provider in ("ollama", "slm"):
        # SLM uses Ollama runtime — just a different model tag (qwen2.5:3b)
        return ChatOllama(
            model=model_name,
            base_url=OLLAMA_BASE_URL,
            temperature=temperature,
            num_ctx=4096,      # 4k context — fits in RAM on any M-chip Mac
            num_predict=512,   # cap output tokens for snappy SLM responses
        )

    else:
        raise ValueError(f"Unknown provider: {provider}")


def create_slm(temperature: float = 0.2) -> ChatOllama:
    """Always returns the on-device Qwen2.5:3b regardless of the active provider."""
    return ChatOllama(
        model=SLM_MODEL,
        base_url=OLLAMA_BASE_URL,
        temperature=temperature,
        num_ctx=4096,
        num_predict=512,
    )

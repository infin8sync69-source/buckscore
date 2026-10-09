"""
Code Agent — reads/modifies Bucks browser source code using DeepSeek Coder v2 or LitAI.
"""
from crewai import Agent

from model_factory import create_llm
from tools.file_tools import read_file, write_file, list_directory, git_status, git_diff
from tools.shell_tools import run_shell


def make_code_agent() -> Agent:
    llm = create_llm(task_type="code", temperature=0.1)

    return Agent(
        role="Bucks Browser Code Engineer",
        goal=(
            "Read, understand, and modify the Bucks browser source code "
            "(SvelteKit + Tauri + Rust) to implement features, fix bugs, and "
            "improve the codebase as requested by the user."
        ),
        backstory=(
            "You are a senior full-stack engineer specializing in SvelteKit, Tauri, and Rust. "
            "You have deep knowledge of the Bucks browser project structure and can confidently "
            "read existing files, propose precise code changes, and run build/dev commands. "
            "You always read relevant files before making changes and explain what you changed."
        ),
        tools=[read_file, write_file, list_directory, git_status, git_diff, run_shell],
        llm=llm,
        verbose=True,
        allow_delegation=False,
        max_iter=8,
    )

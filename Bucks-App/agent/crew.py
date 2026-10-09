"""
BucksAgentCrew — Main crew orchestration with dynamic agent routing.

Agent tiers
-----------
slm       Qwen2.5:3b  — on-device, <1 s latency, no network
browser   llama3.1    — web search / navigation
commerce  llama3.1    — orders / logistics
code      deepseek-coder-v2  — source code edits
"""
from crewai import Crew, Task
from agents.code_agent import make_code_agent
from agents.browser_agent import make_browser_agent
from agents.commerce_agent import make_commerce_agent
from agents.slm_agent import make_slm_agent
from agents.nexus_agent import make_nexus_agent
from genui import research_component, validate_component

# Keywords that require a bigger model
_CODE_KW     = {"code", "build", "fix", "modify", "src/", ".rs", ".ts", ".svelte", "debug", "error", "compile"}
_COMMERCE_KW = {"order", "track", "commerce", "shop", "product", "shipping", "inventory", "buy", "price"}
_BROWSER_KW  = {"search", "navigate", "url", "website", "web", "fetch", "page", "open", "go to", "browse"}

# Short prompts that the SLM can handle alone (word count ≤ this threshold)
_SLM_MAX_WORDS = 20


class BucksAgentCrew:
    def __init__(self, memory):
        self.memory = memory
        self.slm_agent      = make_slm_agent()
        self.code_agent     = make_code_agent()
        self.browser_agent  = make_browser_agent()
        self.commerce_agent = make_commerce_agent()
        self.nexus_agent    = make_nexus_agent()

    def _route_agent(self, prompt: str) -> str:
        p = prompt.lower()

        if any(kw in p for kw in _CODE_KW):
            return "code"
        if any(kw in p for kw in _COMMERCE_KW):
            return "commerce"
        if any(kw in p for kw in _BROWSER_KW):
            return "browser"

        # Nexus-specific triggers: explicit 'nexus', 'hermes', or ephemeral UI requests
        if any(x in p for x in ("nexus", "hermes", "ephemeral", "panel")):
            return "nexus"

        # Short, conversational queries → SLM (fast + private)
        if len(prompt.split()) <= _SLM_MAX_WORDS:
            return "slm"

        return "browser"

    async def run(
        self,
        prompt: str,
        current_url: str = None,
        current_title: str = None,
        task_id: str = None,
    ) -> dict:
        try:
            agent_name = self._route_agent(prompt)

            agent_map = {
                "slm":      (self.slm_agent,      "Answer concisely using on-device Qwen2.5:3b"),
                "code":     (self.code_agent,      f"Complete this code task: {prompt}"),
                "commerce": (self.commerce_agent,  f"Handle this commerce task: {prompt}"),
                "browser":  (self.browser_agent,   f"Navigate and help with this web task: {prompt}"),
                "nexus":    (self.nexus_agent,    f"Create an ephemeral UI or orchestrate via Hermes: {prompt}"),
            }
            agent, task_goal = agent_map[agent_name]

            task = Task(
                description=prompt,
                expected_output="Clear, structured response with actions taken and results",
                agent=agent,
            )

            crew = Crew(
                agents=[agent],
                tasks=[task],
                verbose=(agent_name != "slm"),
                memory=True,
            )

            result = await crew.kickoff_async()

            # Post-process Nexus outputs: if Nexus returned plain text, try to
            # synthesize a structured GenUI `research` component so the
            # frontend can render an ephemeral panel.
            a2ui = {"type": "text", "content": str(result)}
            try:
                if agent_name == "nexus":
                    # result may be a Crew result object; coerce to string
                    summary = str(result)
                    comp = research_component(prompt or "Nexus Panel", summary=summary, topic=(prompt[:60] if prompt else ""))
                    valid = validate_component(comp)
                    if valid:
                        a2ui = {"type": "ui_component", "component": valid}
            except Exception:
                pass

            return {
                "status": "success",
                "evaluation": str(result),
                "agent_used": agent_name,
                "task_id": task_id,
                "a2ui": a2ui,
            }

        except Exception as e:
            return {
                "status": "error",
                "evaluation": f"Agent error: {str(e)}",
                "agent_used": "unknown",
                "task_id": task_id,
                "a2ui": {"type": "text", "content": f"Sorry, I encountered an error: {str(e)}"},
            }


    async def run_slm(self, prompt: str, task_id: str = None) -> dict:
        """Direct SLM path — bypasses routing for guaranteed on-device execution."""
        try:
            task = Task(
                description=prompt,
                expected_output="Concise response (1–3 sentences max)",
                agent=self.slm_agent,
            )
            crew = Crew(agents=[self.slm_agent], tasks=[task], verbose=False, memory=False)
            result = await crew.kickoff_async()
            return {
                "status": "success",
                "evaluation": str(result),
                "agent_used": "slm",
                "task_id": task_id,
                "a2ui": {"type": "text", "content": str(result)},
            }
        except Exception as e:
            return {
                "status": "error",
                "evaluation": str(e),
                "agent_used": "slm",
                "task_id": task_id,
                "a2ui": {"type": "text", "content": f"SLM error: {str(e)}"},
            }

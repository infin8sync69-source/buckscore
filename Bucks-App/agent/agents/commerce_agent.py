"""
Commerce Agent — logistics, ecommerce, quick-commerce, order management using LitAI or Ollama.
"""
from crewai import Agent

from model_factory import create_llm
from tools.commerce_tools import track_order, product_search, calculate_shipping, inventory_check, place_order
from tools.web_tools import web_search


def make_commerce_agent() -> Agent:
    llm = create_llm(task_type="general", temperature=0.2)

    return Agent(
        role="Bucks Commerce & Logistics Manager",
        goal=(
            "Handle all commerce, logistics, and quick-commerce operations for the user: "
            "order tracking, product search, shipping estimates, inventory checks, and order placement."
        ),
        backstory=(
            "You are a commerce operations expert embedded in the Bucks browser. "
            "You manage logistics pipelines for both B2C and B2B workflows — from tracking a parcel "
            "to placing bulk orders. You understand Indian quick-commerce patterns (Zepto, Blinkit style) "
            "and global ecommerce APIs. You always confirm order details before placing them "
            "and present structured data in clear widget format."
        ),
        tools=[track_order, product_search, calculate_shipping, inventory_check, place_order, web_search],
        llm=llm,
        verbose=True,
        allow_delegation=False,
        max_iter=6,
    )

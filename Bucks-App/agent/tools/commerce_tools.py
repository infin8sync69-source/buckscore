"""
Commerce tools for logistics, ecommerce, and quick-commerce workflows.
Designed to be extended with real API integrations per deployment.
"""
import json
import requests
from crewai.tools import tool
from typing import Optional


# ── Configurable API endpoints (set via env vars in production) ────────────
import os
LOGISTICS_API = os.environ.get("BUCKS_LOGISTICS_API", "")
ECOMMERCE_API = os.environ.get("BUCKS_ECOMMERCE_API", "")
ECOMMERCE_KEY = os.environ.get("BUCKS_ECOMMERCE_KEY", "")


@tool("track_order")
def track_order(order_id: str, carrier: str = "") -> str:
    """
    Track a shipment by order ID. Integrates with configured logistics API.
    Returns status, location, and ETA as JSON.
    """
    if LOGISTICS_API:
        try:
            r = requests.get(f"{LOGISTICS_API}/track/{order_id}", timeout=10)
            return r.json() if r.ok else f"API error: {r.status_code}"
        except Exception as e:
            return f"Tracking error: {e}"

    # Demo response when no real API configured
    return json.dumps({
        "order_id": order_id,
        "status": "In Transit",
        "carrier": carrier or "DHL",
        "location": "Mumbai Sorting Facility",
        "eta": "Tomorrow by 8 PM",
        "note": "Configure BUCKS_LOGISTICS_API env var for live tracking."
    })


@tool("product_search")
def product_search(query: str, category: str = "", max_results: int = 5) -> str:
    """
    Search product catalog for items. Returns product name, price, stock status.
    """
    if ECOMMERCE_API:
        try:
            params = {"q": query, "category": category, "limit": max_results}
            headers = {"Authorization": f"Bearer {ECOMMERCE_KEY}"} if ECOMMERCE_KEY else {}
            r = requests.get(f"{ECOMMERCE_API}/products/search", params=params, headers=headers, timeout=10)
            return json.dumps(r.json()) if r.ok else f"API error: {r.status_code}"
        except Exception as e:
            return f"Product search error: {e}"

    return json.dumps({
        "results": [
            {"name": f"{query} - Premium", "price": "₹299", "stock": "In Stock", "sku": "SKU-001"},
            {"name": f"{query} - Standard", "price": "₹199", "stock": "Low Stock (3 left)", "sku": "SKU-002"},
        ],
        "note": "Configure BUCKS_ECOMMERCE_API for live catalog."
    })


@tool("calculate_shipping")
def calculate_shipping(origin: str, destination: str, weight_kg: float = 1.0) -> str:
    """
    Calculate shipping cost and delivery time between two locations.
    """
    if LOGISTICS_API:
        try:
            r = requests.post(f"{LOGISTICS_API}/shipping/quote", json={
                "origin": origin, "destination": destination, "weight": weight_kg
            }, timeout=10)
            return json.dumps(r.json()) if r.ok else f"API error: {r.status_code}"
        except Exception as e:
            return f"Shipping calc error: {e}"

    per_kg = 45.0
    base = 80.0
    cost = base + (weight_kg * per_kg)
    days = 2 if "mumbai" in destination.lower() or "delhi" in destination.lower() else 4
    return json.dumps({
        "origin": origin, "destination": destination,
        "weight_kg": weight_kg,
        "estimated_cost": f"₹{cost:.0f}",
        "delivery_days": days,
        "note": "Configure BUCKS_LOGISTICS_API for live rates."
    })


@tool("inventory_check")
def inventory_check(sku: str) -> str:
    """Check real-time inventory for a product SKU."""
    if ECOMMERCE_API:
        try:
            headers = {"Authorization": f"Bearer {ECOMMERCE_KEY}"} if ECOMMERCE_KEY else {}
            r = requests.get(f"{ECOMMERCE_API}/inventory/{sku}", headers=headers, timeout=10)
            return json.dumps(r.json()) if r.ok else f"API error: {r.status_code}"
        except Exception as e:
            return f"Inventory error: {e}"

    return json.dumps({
        "sku": sku, "quantity": 42,
        "status": "In Stock", "warehouse": "Pune Hub",
        "note": "Configure BUCKS_ECOMMERCE_API for live inventory."
    })


@tool("place_order")
def place_order(product_sku: str, quantity: int, delivery_address: str, customer_name: str = "") -> str:
    """
    Place an order. Returns order confirmation ID and ETA.
    IMPORTANT: This creates a real order if BUCKS_ECOMMERCE_API is configured.
    """
    if ECOMMERCE_API:
        try:
            headers = {"Authorization": f"Bearer {ECOMMERCE_KEY}"} if ECOMMERCE_KEY else {}
            payload = {
                "sku": product_sku, "qty": quantity,
                "address": delivery_address, "name": customer_name
            }
            r = requests.post(f"{ECOMMERCE_API}/orders", json=payload, headers=headers, timeout=15)
            return json.dumps(r.json()) if r.ok else f"Order failed: {r.status_code} {r.text}"
        except Exception as e:
            return f"Order error: {e}"

    return json.dumps({
        "order_id": "DEMO-98765",
        "sku": product_sku, "quantity": quantity,
        "status": "DEMO — not submitted (configure BUCKS_ECOMMERCE_API)",
        "eta": "3-5 business days"
    })

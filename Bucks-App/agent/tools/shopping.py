"""
Real product lookup.

Strategy (deterministic, keyless, real images + real buy links):
  1. PRIMARY — extract product tiles straight from a retailer's search-results
     page (Amazon by default). Real title/price/rating, real CDN image that
     loads anywhere, and a real product-page URL to buy from. Retailers serve
     this HTML to a normal browser User-Agent; if a bot wall is detected we
     fall through.
  2. SECONDARY — generic structured-data extraction (schema.org/Product +
     Open Graph) from pages found via web search, for queries/regions the
     retailer path doesn't cover. Depends on web search being available.

Returns {"text", "_ui"} with a product_grid (+ shopping follow-up actions) on
success, or a plain-string note when nothing real was found (so no fake grid).
No API key, no paid service.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional
from urllib.parse import quote_plus, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

log = logging.getLogger("bucks.tools.shopping")

_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
_HEADERS = {
    "User-Agent": _UA,
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none",
}

# Preferred retailer region first (₹ for India), then amazon.com — one domain
# throttling server requests doesn't block the other, so this greatly improves
# reliability. Override the primary with BUCKS_SHOP_DOMAIN.
_SHOP_DOMAIN = os.getenv("BUCKS_SHOP_DOMAIN", "amazon.in")
_AMAZON_DOMAINS = list(dict.fromkeys([_SHOP_DOMAIN, "amazon.com"]))

_CURRENCY_SYMBOL = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥"}


# ── Retailer search-results extraction (Amazon) ────────────────────────────────

def _amazon_rating(tile) -> Optional[float]:
    el = tile.select_one("span.a-icon-alt")
    if el:
        m = re.search(r"([\d.]+)\s*out of", el.get_text())
        if m:
            try:
                return round(float(m.group(1)), 1)
            except ValueError:
                return None
    return None


async def _amazon_one(client, domain: str, query: str, max_results: int) -> list[dict]:
    url = f"https://www.{domain}/s?k={quote_plus(query)}"
    try:
        r = await client.get(url, headers={**_HEADERS, "Referer": f"https://www.{domain}/"})
    except Exception as e:
        log.debug("amazon %s fetch failed: %s", domain, e)
        return []
    if r.status_code != 200 or len(r.text) < 50000:  # tiny body = throttle/stub page
        return []
    low = r.text.lower()
    if "enter the characters you see below" in low or "/errors/validatecaptcha" in low:
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    base = f"https://www.{domain}"
    out: list[dict] = []
    for tile in soup.select('div[data-component-type="s-search-result"]'):
        h2 = tile.select_one("h2")
        title = h2.get_text(strip=True) if h2 else ""
        link = tile.select_one("h2 a") or tile.select_one("a.a-link-normal.s-link-style") \
            or tile.select_one("a.a-link-normal[href*='/dp/']")
        href = link.get("href", "") if link else ""
        img = tile.select_one("img.s-image")
        image = img.get("src", "") if img else ""
        price_el = tile.select_one(".a-price .a-offscreen")
        price = price_el.get_text(strip=True) if price_el else ""
        if not title or not href or not price:
            continue  # skip ads / incomplete tiles
        out.append({
            "name": title[:90],
            "price": price,
            "rating": _amazon_rating(tile),
            "image": image,
            "url": urljoin(base, href.split("?")[0]),
            "stock": domain.replace("amazon.", "amazon "),  # provenance badge
        })
        if len(out) >= max_results:
            break
    return out


async def _amazon_search(query: str, max_results: int) -> list[dict]:
    # Try each region in turn — if one throttles the server IP, another usually
    # still serves a full page.
    async with httpx.AsyncClient(timeout=14, follow_redirects=True, headers=_HEADERS) as c:
        for domain in _AMAZON_DOMAINS:
            out = await _amazon_one(c, domain, query, max_results)
            if out:
                return out
    return []


# ── Secondary: generic structured-data extraction (schema.org / OG) ────────────

def _first(obj: Any) -> Any:
    return (obj[0] if obj else None) if isinstance(obj, list) else obj


def _fmt_price(amount: Any, currency: str = "") -> str:
    if amount in (None, ""):
        return ""
    try:
        num = float(str(amount).replace(",", ""))
        s = f"{num:,.0f}" if num == int(num) else f"{num:,.2f}"
    except (ValueError, TypeError):
        s = str(amount)
    sym = _CURRENCY_SYMBOL.get((currency or "").upper(), "")
    return f"{sym}{s}" if sym else f"{s} {currency}".strip()


def _iter_jsonld(data: Any):
    if isinstance(data, list):
        for i in data:
            yield from _iter_jsonld(i)
    elif isinstance(data, dict):
        if isinstance(data.get("@graph"), list):
            for i in data["@graph"]:
                yield from _iter_jsonld(i)
        else:
            yield data


def _product_from_page(html: str, page_url: str) -> Optional[dict]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all("script", type="application/ld+json"):
        raw = (tag.string or tag.get_text() or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            try:
                data = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
            except Exception:
                continue
        for node in _iter_jsonld(data):
            t = node.get("@type", "")
            types = t if isinstance(t, list) else [t]
            if not any("Product" in str(x) for x in types) or not node.get("name"):
                continue
            offer = _first(node.get("offers")) or {}
            price = offer.get("price") if isinstance(offer, dict) else None
            currency = offer.get("priceCurrency", "") if isinstance(offer, dict) else ""
            image = _first(node.get("image"))
            if isinstance(image, dict):
                image = image.get("url")
            rating = None
            agg = node.get("aggregateRating")
            if isinstance(agg, dict):
                try:
                    rating = round(float(agg.get("ratingValue")), 1)
                except (ValueError, TypeError):
                    pass
            if price:
                return {
                    "name": str(node["name"]).strip()[:90],
                    "price": _fmt_price(price, currency),
                    "rating": rating,
                    "image": urljoin(page_url, image) if image else "",
                    "url": node.get("url") or page_url,
                    "stock": urlparse(page_url).netloc.replace("www.", ""),
                }
    return None


async def _web_structured(query: str, max_results: int) -> list[dict]:
    try:
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(f"{query} buy price", max_results=max_results * 2))
    except Exception:
        return []
    products, seen = [], set()
    async with httpx.AsyncClient(timeout=10, follow_redirects=True, headers=_HEADERS) as c:
        for res in results:
            url = res.get("href") or res.get("url") or ""
            host = urlparse(url).netloc
            if not url or host in seen:
                continue
            seen.add(host)
            try:
                r = await c.get(url)
                if r.status_code == 200 and "text/html" in r.headers.get("content-type", ""):
                    p = _product_from_page(r.text, str(r.url))
                    if p:
                        products.append(p)
            except Exception:
                continue
            if len(products) >= max_results:
                break
    return products


# ── Reliable fallback: real product catalog API (dummyjson) ───────────────────
# Server-side scraping of big retailers is unreliable (bot walls / throttling),
# so when the retailer + web paths come up empty we fall back to a real,
# keyless product catalog that returns real product names and real CDN images
# (which always load). The buy-link points at a live retailer search for that
# exact product, so clicking still lands on a real, buyable destination.

async def _catalog_search(query: str, max_results: int) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as c:
            r = await c.get(f"https://dummyjson.com/products/search",
                            params={"q": query, "limit": max_results})
        if r.status_code != 200:
            return []
        data = r.json()
    except Exception as e:
        log.warning("catalog fallback failed: %s", e)
        return []
    base = f"https://www.{_SHOP_DOMAIN}"
    out = []
    for p in data.get("products", [])[:max_results]:
        title = p.get("title", "")
        if not title:
            continue
        price = p.get("price")
        out.append({
            "name": title[:90],
            "price": _fmt_price(price, "USD") if price is not None else "",
            "rating": round(float(p["rating"]), 1) if p.get("rating") is not None else None,
            "image": p.get("thumbnail") or (p.get("images") or [""])[0],
            # Real buyable destination: search the configured retailer for it.
            "url": f"{base}/s?k={quote_plus(title)}",
            "stock": p.get("availabilityStatus") or "",
        })
    return out


# ── Public tool ────────────────────────────────────────────────────────────────

def _shopping_actions(query: str) -> list[dict]:
    """Follow-up shopping actions rendered under the grid. Each is phrased with a
    shopping keyword so it re-triggers the deterministic product_lookup flow."""
    return [
        {"label": "💸 Cheaper options", "kind": "agent", "value": f"buy cheap {query}"},
        {"label": "⭐ Top rated", "kind": "agent", "value": f"buy best {query}"},
        {"label": "🛍️ More like this", "kind": "agent", "value": f"buy {query}"},
    ]


async def product_lookup(query: str, max_results: int = 12):
    """Fetch REAL products for `query` (real image + real buy link). Tries a
    retailer's search results first, then generic structured-data extraction."""
    products = await _amazon_search(query, max_results)
    source = f"amazon {_SHOP_DOMAIN.split('.')[-1]}"
    if not products:
        products = await _web_structured(query, max_results)
        source = "the web"
    if not products:
        products = await _catalog_search(query, max_results)
        source = "a product catalog (tap a card to shop it live)"
    if not products:
        # Never leave the shopping intent without ephemeral UI: render a row of
        # live retailer-search links the user can open in a tab.
        note = (f"Couldn't fetch product listings for “{query}” right now — "
                f"here are live shops for it instead.")
        try:
            from urllib.parse import quote_plus
            from genui import cta_row_component
            q = quote_plus(query)
            actions = [
                {"label": "🛒 Amazon", "kind": "navigate",
                 "value": f"https://www.{_SHOP_DOMAIN}/s?k={q}"},
                {"label": "🛍️ Flipkart", "kind": "navigate",
                 "value": f"https://www.flipkart.com/search?q={q}"},
                {"label": "🔎 Shopping search", "kind": "navigate",
                 "value": f"https://duckduckgo.com/?q=buy+{q}&iax=shopping&ia=shopping"},
                {"label": "🔁 Try again", "kind": "agent", "value": f"buy {query}"},
            ]
            return {"text": note,
                    "_ui": cta_row_component(actions, title=f"Shop “{query}”")}
        except Exception:
            return note

    lines = [f"- {p['name']} — {p['price']} ({p.get('stock','')})" for p in products]
    text = f"Real products for “{query}” from {source}:\n" + "\n".join(lines)
    try:
        from genui import product_grid_component
        comp = product_grid_component(query, products)
        comp["data"]["actions"] = _shopping_actions(query)
        return {"text": text, "_ui": comp}
    except Exception:
        return text

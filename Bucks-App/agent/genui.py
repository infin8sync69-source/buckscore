"""
Generative UI — build predefined component specs from tool output.

The renderer has a fixed library of components (answer, list, cta_row,
product_grid, stat_cards, table, chart, image_gallery, video, research,
weather, timeline, checklist, accordion, code). Rather than ask the small local
model to emit complex nested JSON (unreliable), tools return typed data and
these builders map that data to a component spec deterministically. The spec
travels to the renderer as an SSE event: {type:"ui_component", ...}.

Envelope shape (also the contract the renderer's renderComponent expects):
    { "component": "<name>", "title": <optional str>, "data": { ... } }

Tools that want to drive UI return a dict of the form:
    { "text": "<summary for the model>", "_ui": <component spec> }
so the model still gets readable text AND the user gets a rendered component.
"""
from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import urlparse


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.replace("www.", "")
    except Exception:
        return ""


def _favicon(url: str) -> str:
    d = _domain(url)
    # Google's favicon service is a plain image GET (no API key); the renderer
    # falls back to a letter avatar if it fails to load.
    return f"https://www.google.com/s2/favicons?domain={d}&sz=64" if d else ""


def search_results_component(query: str, results: list[dict]) -> dict:
    """Build a `list` component (clickable source cards) from web search hits."""
    items = []
    for r in results:
        url = r.get("href") or r.get("url") or ""
        items.append({
            "title": (r.get("title") or _domain(url) or "Result").strip(),
            "subtitle": (r.get("body") or r.get("snippet") or "").strip()[:180],
            "url": url,
            "domain": _domain(url),
            "favicon": _favicon(url),
            # og:image when the page exposed one — the renderer falls back to a
            # text-only card whenever this is empty.
            "thumbnail": (r.get("thumbnail") or r.get("image") or "").strip(),
            # "video" for known video hosts, "" otherwise — drives the play
            # affordance and duration slot on the result card.
            "kind": (r.get("kind") or "").strip(),
        })
    return {
        "component": "list",
        "title": f"Results for “{query}”",
        "data": {"items": items},
    }


def product_grid_component(query: str, products: list[dict]) -> dict:
    """Build a `product_grid` component from catalog results."""
    items = []
    for p in products:
        items.append({
            "title": p.get("name") or p.get("title") or "Product",
            "price": p.get("price") or "",
            "image": p.get("imageUrl") or p.get("image") or "",
            "url": p.get("url") or "",
            "rating": p.get("rating"),
            "badge": p.get("stock") or "",
        })
    return {
        "component": "product_grid",
        "title": f"Products for “{query}”",
        "data": {"items": items, "query": query},
    }


def cta_row_component(actions: list[dict], title: str = "") -> dict:
    """actions: [{label, kind:"navigate"|"search"|"agent"|"copy", value}]."""
    return {"component": "cta_row", "title": title, "data": {"actions": actions}}


def image_gallery_component(query: str, images: list[dict], title: str = "") -> dict:
    """Build an `image_gallery` component (masonry grid + lightbox).

    images: [{title, image (full-res url), thumbnail, url (source page), source}]
    """
    items = []
    for im in images:
        src = im.get("image") or im.get("thumbnail") or ""
        if not src:
            continue
        items.append({
            "title": (im.get("title") or "").strip()[:120],
            "image": src,
            "thumbnail": im.get("thumbnail") or src,
            "url": im.get("url") or "",
            "source": im.get("source") or _domain(im.get("url") or ""),
        })
    return {
        "component": "image_gallery",
        "title": title or f"Images — “{query}”",
        "data": {"items": items, "query": query},
    }


def video_component(query: str, videos: list[dict], title: str = "") -> dict:
    """Build a `video` component: an embedded YouTube player + an up-next rail.

    videos: [{videoId, title, channel, duration, views, thumbnail}]
    The renderer embeds videos[0] and swaps the player when a rail item is
    clicked. videoIds are re-sanitized renderer-side before embedding.
    """
    vids = []
    for v in videos:
        vid = (v.get("videoId") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{6,20}", vid):
            continue
        vids.append({
            "videoId": vid,
            "title": (v.get("title") or "").strip()[:120],
            "channel": (v.get("channel") or "").strip()[:60],
            "duration": v.get("duration") or "",
            "views": v.get("views") or "",
            "thumbnail": v.get("thumbnail") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        })
    return {
        "component": "video",
        "title": title or f"Videos — “{query}”",
        "data": {"videos": vids, "query": query},
    }


def research_component(topic: str, hero: str = "", summary: str = "",
                       sections: list[dict] = None, images: list[dict] = None,
                       videos: list[dict] = None,
                       sources: list[dict] = None, stats: list[dict] = None,
                       actions: list[dict] = None) -> dict:
    """Build a comprehensive `research` dossier spec.

    hero:     banner image URL
    summary:  one-paragraph deterministic digest (the model streams the refined
              narrative separately as tokens)
    sections: [{heading, text, url?, image?}]  — one per source/insight
    images:   image_gallery-shaped items rendered as a strip
    videos:   video items rendered as a video rail/cards
    sources:  [{title, url, domain, favicon}]
    stats:    [{label, value, delta?}]
    actions:  cta_row-shaped follow-up actions
    """
    return {
        "component": "research",
        "title": f"Research — {topic}",
        "data": {
            "topic": topic,
            "hero": hero,
            "summary": summary,
            "sections": sections or [],
            "images": images or [],
            "videos": videos or [],
            "sources": sources or [],
            "stats": stats or [],
            "actions": actions or [],
        },
    }


def answer_component(markdown: str, title: str = "") -> dict:
    return {"component": "answer", "title": title, "data": {"markdown": markdown}}


def weather_component(place: str, current: dict, days: list[dict],
                      title: str = "") -> dict:
    """Build a `weather` card: current conditions + a multi-day forecast strip.

    current: {temp_c, feels_c, condition, icon, wind_kmh, humidity}
    days:    [{day, icon, condition, high_c, low_c}]
    """
    return {
        "component": "weather",
        "title": title or f"Weather — {place}",
        "data": {"place": place, "current": current or {}, "days": days or []},
    }


def timeline_component(events: list[dict], title: str = "") -> dict:
    """events: [{date, title, text?}] — a vertical chronology."""
    return {"component": "timeline", "title": title,
            "data": {"events": events or []}}


def checklist_component(items: list, title: str = "") -> dict:
    """items: [{text, done?}] or plain strings — an interactive to-do list."""
    norm = []
    for it in items or []:
        if isinstance(it, str):
            norm.append({"text": it, "done": False})
        elif isinstance(it, dict) and it.get("text"):
            norm.append({"text": str(it["text"]), "done": bool(it.get("done"))})
    return {"component": "checklist", "title": title, "data": {"items": norm}}


def accordion_component(items: list[dict], title: str = "") -> dict:
    """items: [{heading, text}] — collapsible sections (FAQ / step details)."""
    return {"component": "accordion", "title": title,
            "data": {"items": items or []}}


def code_component(code: str, language: str = "", title: str = "") -> dict:
    """A copyable code block."""
    return {"component": "code", "title": title,
            "data": {"code": code, "language": language}}


# ── Validation for the generative path (render_component tool, Phase C) ────────

_ALLOWED = {"answer", "list", "cta_row", "product_grid", "stat_cards", "table",
            "chart", "image_gallery", "video", "research",
            "weather", "timeline", "checklist", "accordion", "code"}


def validate_component(spec: Any) -> Optional[dict]:
    """Return the spec if it's a well-formed component, else None (caller falls
    back to a plain markdown answer). Kept deliberately permissive but safe."""
    if not isinstance(spec, dict):
        return None
    comp = spec.get("component")
    if comp not in _ALLOWED:
        return None
    if not isinstance(spec.get("data", {}), dict):
        return None
    return {
        "component": comp,
        "title": str(spec.get("title", "")),
        "data": spec.get("data", {}),
    }

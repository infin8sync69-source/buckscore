"""
Media tools — image search and YouTube video search, keyless.

Both tools return {"text", "_ui"}: `text` is a compact digest the model reads,
`_ui` is an ephemeral-UI component spec rendered for the user (see genui.py).

  image_search   → `image_gallery` component (grid + lightbox in the renderer)
  youtube_search → `video` component (embedded player + up-next rail)

Strategy is the same as tools/shopping.py: scrape what a normal browser gets,
no API keys, with layered fallbacks so the component never comes back empty
just because one provider throttled us.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Optional
from urllib.parse import quote_plus

import httpx

log = logging.getLogger("bucks.tools.media")

# Real Chrome sends a four-part version ("120.0.0.0"). The truncated "124.0"
# here reads as non-browser traffic and gets a thinner page back.
_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
# The Accept header is load-bearing: without it Bing serves a degraded page
# whose tiles are unrelated to the query (one stray shopping result rather
# than image hits), which silently poisoned every gallery it topped up.
_HEADERS = {
    "User-Agent": _UA,
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


# ── Image search ───────────────────────────────────────────────────────────────

def _ddg_images_sync(query: str, max_results: int) -> list[dict]:
    try:
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            hits = list(ddgs.images(query, max_results=max_results, safesearch="moderate"))
    except Exception as e:
        log.debug("ddg images failed: %s", e)
        return []
    out = []
    for h in hits:
        out.append({
            "title": h.get("title", ""),
            "image": h.get("image", ""),
            "thumbnail": h.get("thumbnail") or h.get("image", ""),
            "url": h.get("url", ""),
            "source": h.get("source", ""),
        })
    return out


async def _bing_images(query: str, max_results: int) -> list[dict]:
    """Fallback: Bing image tiles carry a JSON blob (murl/turl) per result."""
    url = f"https://www.bing.com/images/search?q={quote_plus(query)}&form=HDRSC2"
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as c:
            r = await c.get(url, headers=_HEADERS)
        if r.status_code != 200:
            return []
    except Exception as e:
        log.debug("bing images failed: %s", e)
        return []
    out = []
    for m in re.finditer(r'class="iusc"[^>]+m="([^"]+)"', r.text):
        try:
            blob = json.loads(m.group(1).replace("&quot;", '"').replace("&amp;", "&"))
        except Exception:
            continue
        if not blob.get("murl"):
            continue
        out.append({
            "title": blob.get("t", ""),
            "image": blob["murl"],
            "thumbnail": blob.get("turl") or blob["murl"],
            "url": blob.get("purl", ""),
            "source": "bing",
        })
        if len(out) >= max_results:
            break
    return out


async def image_search(query: str, max_results: int = 12):
    """Search the web for images. Returns an image_gallery component."""
    images = await asyncio.to_thread(_ddg_images_sync, query, max_results)
    if len(images) < max(4, max_results // 3):
        # DDG throttled or returned a thin page — top up from Bing, dedup by URL.
        seen = {im["image"] for im in images}
        for im in await _bing_images(query, max_results):
            if im["image"] not in seen:
                images.append(im)
                seen.add(im["image"])
            if len(images) >= max_results:
                break
    if not images:
        return (f"Couldn't fetch images for “{query}” right now — the image "
                f"providers may be throttling. Try again or rephrase.")

    lines = [f"- {im['title'] or im['image']} ({im['source']})" for im in images[:6]]
    text = f"Found {len(images)} images for “{query}”:\n" + "\n".join(lines)
    try:
        from genui import image_gallery_component
        return {"text": text, "_ui": image_gallery_component(query, images)}
    except Exception:
        return text


# ── YouTube search ─────────────────────────────────────────────────────────────

_YT_ID = re.compile(r"^[A-Za-z0-9_-]{6,20}$")


def _walk_video_renderers(node, out: list[dict], max_results: int):
    """Recursively collect videoRenderer nodes from ytInitialData."""
    if len(out) >= max_results:
        return
    if isinstance(node, dict):
        vr = node.get("videoRenderer")
        if isinstance(vr, dict) and vr.get("videoId"):
            vid = vr["videoId"]
            if _YT_ID.match(vid):
                title = "".join(r.get("text", "") for r in
                                vr.get("title", {}).get("runs", []) or [])
                channel = "".join(r.get("text", "") for r in
                                  vr.get("ownerText", {}).get("runs", []) or [])
                duration = vr.get("lengthText", {}).get("simpleText", "")
                views = vr.get("shortViewCountText", {}).get("simpleText", "") or \
                    vr.get("viewCountText", {}).get("simpleText", "")
                thumbs = vr.get("thumbnail", {}).get("thumbnails", [])
                thumb = thumbs[-1]["url"] if thumbs else ""
                out.append({
                    "videoId": vid, "title": title, "channel": channel,
                    "duration": duration, "views": views, "thumbnail": thumb,
                })
        for v in node.values():
            _walk_video_renderers(v, out, max_results)
    elif isinstance(node, list):
        for v in node:
            _walk_video_renderers(v, out, max_results)


def _extract_yt_initial_data(html: str) -> Optional[dict]:
    m = re.search(r"var ytInitialData\s*=\s*(\{.+?\});\s*</script>", html, re.DOTALL)
    if not m:
        m = re.search(r'window\["ytInitialData"\]\s*=\s*(\{.+?\});', html, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


async def youtube_search(query: str, max_results: int = 8):
    """Search YouTube and return a `video` component (embedded player + rail)."""
    url = f"https://www.youtube.com/results?search_query={quote_plus(query)}"
    videos: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as c:
            r = await c.get(url, headers={**_HEADERS,
                                          "Cookie": "CONSENT=YES+cb.20240101-00-p0.en+FX+000"})
        if r.status_code == 200:
            data = _extract_yt_initial_data(r.text)
            if data:
                _walk_video_renderers(data, videos, max_results)
    except Exception as e:
        log.debug("youtube scrape failed: %s", e)

    if not videos:
        # Fallback: DDG videos (also keyless) — still yields YouTube ids.
        def _ddg_videos():
            try:
                try:
                    from ddgs import DDGS
                except ImportError:
                    from duckduckgo_search import DDGS
                with DDGS() as ddgs:
                    return list(ddgs.videos(query, max_results=max_results))
            except Exception:
                return []
        for h in await asyncio.to_thread(_ddg_videos):
            content = h.get("content", "")  # e.g. https://www.youtube.com/watch?v=ID
            m = re.search(r"[?&]v=([A-Za-z0-9_-]{6,20})", content)
            if not m:
                continue
            videos.append({
                "videoId": m.group(1),
                "title": h.get("title", ""),
                "channel": (h.get("uploader") or h.get("publisher") or ""),
                "duration": h.get("duration", ""),
                "views": str((h.get("statistics") or {}).get("viewCount", "") or ""),
                "thumbnail": (h.get("images") or {}).get("medium", ""),
            })

    if not videos:
        return (f"Couldn't fetch videos for “{query}” right now. You can open "
                f"youtube.com in a tab and I'll read it live.")

    lines = [f"- {v['title']} — {v['channel']} ({v['duration']})" for v in videos[:6]]
    text = (f"Found {len(videos)} videos for “{query}” (the first one is embedded "
            f"and playable):\n" + "\n".join(lines))
    try:
        from genui import video_component
        return {"text": text, "_ui": video_component(query, videos)}
    except Exception:
        return text

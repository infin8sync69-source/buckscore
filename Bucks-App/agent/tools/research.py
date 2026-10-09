"""
Deep research pipeline — the "gather in-depth insight" tool.

One call fans out to: web search (top sources) → parallel page fetch + clean
text extraction → image search — and folds everything into a single `research`
dossier component (hero image, per-source insight sections, image strip,
source cards, follow-up actions). See genui.research_component.

Returns {"text", "_ui"}:
  text — the gathered corpus, trimmed for the model. The Soul Engine streams a
         model-refined narrative AFTER the component renders, so the user gets
         the visual dossier instantly and the refined prose seconds later.
  _ui  — the research component spec.
"""
from __future__ import annotations

import asyncio
import logging
import re
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

log = logging.getLogger("bucks.tools.research")

_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
# Without an Accept header a number of publishers answer 403 or serve a
# stripped page — costing both the article text and its share image.
_HEADERS = {
    "User-Agent": _UA,
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# Domains whose pages are apps/paywalls, not readable articles.
_SKIP_HOSTS = ("youtube.com", "facebook.com", "instagram.com", "x.com",
               "twitter.com", "tiktok.com", "pinterest.")


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.replace("www.", "")
    except Exception:
        return ""


def _favicon(url: str) -> str:
    d = _domain(url)
    return f"https://www.google.com/s2/favicons?domain={d}&sz=64" if d else ""


def _text_search_sync(query: str, max_results: int) -> list[dict]:
    try:
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            return [
                {"title": r.get("title", ""), "url": r.get("href") or r.get("url", ""),
                 "snippet": r.get("body", "")}
                for r in ddgs.text(query, max_results=max_results)
            ]
    except Exception as e:
        log.debug("ddgs text failed: %s", e)
        return []


async def _text_search(query: str, max_results: int = 8) -> list[dict]:
    results = await asyncio.to_thread(_text_search_sync, query, max_results)
    if results:
        return results
    # Fallback: DDG html endpoint (same one tools/registry.py uses).
    try:
        from tools.registry import _ddg_html_search
        raw = await _ddg_html_search(query, max_results)
        return [{"title": r["title"], "url": r["href"], "snippet": r["body"]} for r in raw]
    except Exception as e:
        log.debug("ddg html fallback failed: %s", e)
        return []


def _extract_readable(html: str, max_paras: int = 6) -> list[str]:
    """Pull the meaty paragraphs out of an article page."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
        tag.decompose()
    paras = []
    for p in soup.find_all(["p", "li"]):
        t = re.sub(r"\s+", " ", p.get_text(" ", strip=True))
        # Real sentences only — skips menus, cookie banners, button labels.
        if len(t) >= 80 and t.count(" ") >= 10:
            paras.append(t)
        if len(paras) >= max_paras:
            break
    return paras


def _og_image(html: str, base_url: str) -> str:
    """Share image for an already-fetched page. Reuses the web_search
    extractor so both result surfaces resolve thumbnails identically."""
    try:
        from tools.registry import _OG_RE, _CONTENT_RE, _abs_url
        head = html[:96000]
        for tag in _OG_RE.findall(head):
            m = _CONTENT_RE.search(tag)
            if m and (src := _abs_url(m.group(1), base_url)):
                return src
    except Exception:
        pass
    return ""


async def _fetch_source(client: httpx.AsyncClient, res: dict) -> dict | None:
    url = res.get("url", "")
    if not url or any(h in url for h in _SKIP_HOSTS):
        return None
    try:
        r = await client.get(url, headers=_HEADERS)
        if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
            return None
        paras = _extract_readable(r.text)
        # The page body is already in hand — pull its share image here rather
        # than paying for a second round trip just to get a thumbnail.
        thumbnail = _og_image(r.text, str(r.url))
    except Exception:
        return None
    if not paras and not res.get("snippet"):
        return None
    return {
        "title": res.get("title") or _domain(url),
        "url": str(r.url),
        "domain": _domain(str(r.url)),
        "favicon": _favicon(str(r.url)),
        "thumbnail": thumbnail,
        "snippet": res.get("snippet", ""),
        "paras": paras,
    }


_MEDIA_CLAUSE_RE = re.compile(
    r"\b(?:and\s+)?(?:also\s+)?(?:show|find|get|include|give|with)\s+(?:me\s+)?"
    r"(?:some\s+|a\s+|the\s+)?(?:good\s+|beginner\s+)?"
    r"(?:images?|photos?|pictures?|pics|diagrams?|videos?|clips?|"
    r"walkthroughs?|examples?)\b[^,.;]*", re.I)
_LEAD_VERB_RE = re.compile(
    r"^\s*(?:please\s+)?(?:explain|teach me|show me|tell me|walk me through|"
    r"help me|i want to|i'd like to|can you)\s+(?:about\s+|how\s+)?", re.I)


def _media_topic(topic: str, max_words: int = 10) -> str:
    """Condense a conversational research topic into a keyword query.

    Image and video search engines match keywords, not requests — feeding them
    "Explain how CRISPR works, show diagrams, and find videos for a beginner"
    returns teaching-material clutter rather than pictures of CRISPR.
    """
    q = _MEDIA_CLAUSE_RE.sub(" ", topic or "")
    q = _LEAD_VERB_RE.sub("", q)
    # An em/en-dash in these requests almost always introduces the "what I want
    # back" half ("… — with diagrams, the key papers, and a walkthrough").
    # The subject sits before it.
    q = re.split(r"\s[—–]\s", q)[0]
    q = re.sub(r"\b(for a beginner|for beginners|in one sentence|please)\b", " ", q, flags=re.I)
    q = re.sub(r"[,;]+", " ", q)
    q = re.sub(r"\s+", " ", q).strip(" ?.!-—")
    words = q.split()
    if len(words) > max_words:
        q = " ".join(words[:max_words])
    # Trim a dangling conjunction/preposition — from the cuts above or from the
    # truncation itself, so this has to run last.
    q = re.sub(r"(\s+(and|with|or|the|a|an|of|for|to|in|on|according))+$", "",
               q, flags=re.I)
    return q or (topic or "").strip()


async def deep_research(topic: str, max_sources: int = 4, max_images: int = 8):
    """Gather multi-source research + images + videos for `topic` and build the dossier."""
    from tools.media_tools import image_search, youtube_search

    media_q = _media_topic(topic)

    # Search text, images, and videos in parallel with fast timeouts
    results_task = _text_search(topic, max_results=max_sources * 3)
    images_task = image_search(media_q, max_results=max_images)
    videos_task = youtube_search(media_q, max_results=4)
    results, images_raw, videos_raw = await asyncio.gather(results_task, images_task, videos_task, return_exceptions=True)

    images = []
    if isinstance(images_raw, dict):
        images = (images_raw.get("_ui") or {}).get("data", {}).get("items", [])

    videos = []
    if isinstance(videos_raw, dict):
        # video specs carry their payload under data.videos — reading "items"
        # here silently dropped every video from every dossier.
        _vdata = (videos_raw.get("_ui") or {}).get("data", {})
        videos = _vdata.get("videos") or _vdata.get("items") or []

    if not isinstance(results, list):
        results = []

    sources: list[dict] = []
    if results:
        seen_hosts: set[str] = set()
        picked = []
        for res in results:
            host = _domain(res.get("url", ""))
            if not host or host in seen_hosts:
                continue
            seen_hosts.add(host)
            picked.append(res)
            if len(picked) >= max_sources * 2:
                break
        try:
            # These fetches run concurrently, so the wall-clock cost is the
            # slowest page, not the sum. 2s was dropping sources outright —
            # losing the article text and its thumbnail together.
            #
            # max_redirects is load-bearing: some sites ping-pong between the
            # slashed and unslashed form of a URL with 308s forever, and an
            # uncapped chain multiplies the per-request timeout by 20. The
            # outer wait_for is the backstop so no single host can ever stall
            # the dossier.
            async with httpx.AsyncClient(timeout=4.0, follow_redirects=True,
                                         max_redirects=5) as c:
                try:
                    fetched = await asyncio.wait_for(
                        asyncio.gather(*(_fetch_source(c, r) for r in picked),
                                       return_exceptions=True),
                        timeout=12.0)
                except asyncio.TimeoutError:
                    fetched = []
            sources = [s for s in fetched if isinstance(s, dict) and s][:max_sources]
        except Exception:
            sources = []

        # Instant fallback to DDG search snippets if page scraping timed out
        if not sources and picked:
            sources = [{
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "domain": _domain(r.get("url", "")),
                "favicon": _favicon(r.get("url", "")),
                "snippet": r.get("snippet", ""),
                "paras": [r.get("snippet", "")]
            } for r in picked[:max_sources]]

    if not sources and not images and not videos:
        return (f"Couldn't gather research on “{topic}” right now — search "
                f"providers may be throttling. Try again in a moment.")

    # ── Build the dossier component ────────────────────────────────────────────
    sections = []
    for s in sources:
        body = " ".join(s["paras"][:2]) if s.get("paras") else s.get("snippet", "")
        sections.append({
            "heading": s["title"][:110],
            "text": body[:600],
            "url": s["url"],
            "domain": s["domain"],
        })

    summary = (sources[0]["paras"][0][:400] if sources and sources[0].get("paras") else \
        (sources[0]["snippet"][:400] if sources else ""))

    # Plain labels — the UI supplies its own iconography, and emoji render
    # inconsistently across platforms.
    actions = [
        {"label": "Go deeper", "kind": "agent", "value": f"research {topic} in more depth"},
        {"label": "More images", "kind": "agent", "value": f"show me images of {topic}"},
        {"label": "Watch videos", "kind": "agent", "value": f"play videos about {topic}"},
    ]

    try:
        from genui import research_component
        ui = research_component(
            topic,
            hero=images[0]["image"] if images else "",
            summary=summary,
            sections=sections,
            images=images[1:7],
            videos=videos,
            sources=[{"title": s["title"], "url": s["url"], "domain": s["domain"],
                      "favicon": s["favicon"], "thumbnail": s.get("thumbnail", ""),
                      "snippet": (s.get("snippet") or
                                  (s["paras"][0] if s.get("paras") else ""))[:180]}
                     for s in sources],
            actions=actions,
        )
    except Exception:
        ui = None

    # ── Corpus for the model to refine ─────────────────────────────────────────
    # Each block is numbered, and that number is the ONLY citation handle the
    # model is given. The previous format opened every block with the literal
    # "SOURCE: <title> (<url>)", and the model dutifully copied that shape into
    # its markdown — shipping links labelled "SOURCE: Ethereum vs Solana for
    # DApps: Which Should You Choose?" into the middle of sentences. Numbering
    # also lets the renderer resolve [n] against the dossier's own source list,
    # which is emitted in this exact order (see genui.research_component).
    corpus_parts = []
    for i, s in enumerate(sources, 1):
        body = "\n".join(s["paras"][:4]) or s["snippet"]
        corpus_parts.append(f"[{i}] {s['title']} — {s['domain']}\n{body}")
    corpus = f"Research corpus on “{topic}” ({len(sources)} sources, "\
             f"{len(images)} images gathered).\n"\
             f"Cite a source by its bracketed number, e.g. [1]. "\
             f"Never write the word SOURCE, a bare URL, or a markdown link.\n\n"\
             + "\n\n".join(corpus_parts)
    corpus = corpus[:6000]

    if ui:
        return {"text": corpus, "_ui": ui}
    return corpus

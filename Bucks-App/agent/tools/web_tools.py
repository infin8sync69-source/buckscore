"""
Web tools for the Browser and Research agents.
Uses DuckDuckGo search + BeautifulSoup page fetching.
"""
import re
import requests
from crewai.tools import tool
from bs4 import BeautifulSoup
from duckduckgo_search import DDGS


def _ddg_html_search(query: str, max_results: int = 6) -> list[dict]:
    results = []
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
        resp = requests.post("https://html.duckduckgo.com/html/", data={"q": query}, headers=headers, timeout=10)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            for r in soup.find_all("div", class_="result"):
                a_title = r.find("a", class_="result__a")
                snippet_elem = r.find(class_="result__snippet")
                if a_title:
                    title = a_title.get_text().strip()
                    href = a_title.get("href", "")
                    body = snippet_elem.get_text().strip() if snippet_elem else ""
                    if href.startswith("/l/?"):
                        from urllib.parse import parse_qs, urlparse
                        parsed = parse_qs(urlparse(href).query)
                        if "uddg" in parsed:
                            href = parsed["uddg"][0]
                    results.append({"title": title, "href": href, "body": body})
                    if len(results) >= max_results:
                        break
    except Exception as e:
        import logging
        logging.getLogger("bucks.tools.web").error(f"DDG HTML search fallback failed: {e}")
    return results


@tool("web_search")
def web_search(query: str, max_results: int = 6) -> dict:
    """
    Search the web with DuckDuckGo. Returns titles, URLs, and snippets,
    and displays them as a visual list component.
    """
    results = []
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
    except Exception as e:
        import logging
        logging.getLogger("bucks.tools.web").warning(f"Standard DDGS text search failed: {e}")

    if not results:
        results = _ddg_html_search(query, max_results=max_results)

    if not results:
        return {
            "text": "No results found.",
            "_ui": None
        }

    lines = []
    for r in results:
        lines.append(f"**{r.get('title', '')}**\n{r.get('href', '')}\n{r.get('body', '')}\n")
    text_summary = "\n---\n".join(lines)

    from genui import search_results_component
    ui_spec = search_results_component(query, results)

    return {
        "text": text_summary,
        "_ui": ui_spec
    }


@tool("fetch_url")
def fetch_url(url: str, max_chars: int = 6000) -> str:
    """
    Fetch a URL and return readable text content (HTML stripped).
    """
    try:
        headers = {"User-Agent": "Mozilla/5.0 (BucksBrowser/1.0)"}
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text[:max_chars]
    except Exception as e:
        return f"Fetch error: {e}"


@tool("extract_links")
def extract_links(url: str, max_links: int = 20) -> str:
    """Extract all hyperlinks from a page."""
    try:
        headers = {"User-Agent": "Mozilla/5.0 (BucksBrowser/1.0)"}
        resp = requests.get(url, headers=headers, timeout=15)
        soup = BeautifulSoup(resp.text, "html.parser")
        links = []
        for a in soup.find_all("a", href=True)[:max_links]:
            href = a["href"]
            if href.startswith("http"):
                links.append(f"{a.get_text(strip=True)} → {href}")
        return "\n".join(links) or "No links found."
    except Exception as e:
        return f"Extract links error: {e}"

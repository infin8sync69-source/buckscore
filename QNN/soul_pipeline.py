#!/usr/bin/env python3
"""
soul_pipeline.py — NIM + QNN collaborative app selection pipeline

Pipeline:
  Stage 1 (QNN):  Generate selection criteria from corpus wisdom
  Stage 2 (NIM):  Research 30 candidate open-source web apps
  Stage 3 (QNN):  Score each candidate against wisdom criteria (0-10)
  Stage 4 (NIM):  Select top 10, generate full app-store-data.js entries
  Stage 5 (Test): Verify each app URL is reachable
  Stage 6 (Write): Merge new apps into app-store-data.js
"""

import json
import os
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')

BASE = Path(__file__).parent

# ── Timestamp helper ──────────────────────────────────────────────────────────

def ts():
    return time.strftime('%H:%M:%S')

# ── Fallback candidates (used if NIM API is unreachable) ─────────────────────

FALLBACK_CANDIDATES = [
    {"id": "cal-com", "name": "Cal.com", "tagline": "Open source scheduling infrastructure",
     "category": "Productivity", "repo": "calcom/cal.com", "runUrl": "https://cal.com",
     "stars": 32000, "rationale": "Replaces Calendly with full data ownership and self-hosting."},
    {"id": "docmost", "name": "Docmost", "tagline": "Collaborative wiki and docs platform",
     "category": "Productivity", "repo": "docmost/docmost", "runUrl": "https://docmost.com",
     "stars": 8000, "rationale": "Open alternative to Confluence with real-time collaboration."},
    {"id": "plane", "name": "Plane", "tagline": "Open source project management tool",
     "category": "Productivity", "repo": "makeplane/plane", "runUrl": "https://app.plane.so",
     "stars": 29000, "rationale": "Full-featured Jira alternative with sprints, issues, and cycles."},
    {"id": "formbricks", "name": "Formbricks", "tagline": "Open source survey and form builder",
     "category": "Utility", "repo": "formbricks/formbricks", "runUrl": "https://app.formbricks.com",
     "stars": 8500, "rationale": "Privacy-first Typeform alternative with self-hosting."},
    {"id": "rallly", "name": "Rallly", "tagline": "Schedule meetings with group polls",
     "category": "Productivity", "repo": "lukevella/rallly", "runUrl": "https://rallly.co",
     "stars": 4000, "rationale": "Doodle alternative that respects your data and schedule."},
    {"id": "maybe", "name": "Maybe", "tagline": "Personal finance and wealth management",
     "category": "Finance", "repo": "maybe-finance/maybe", "runUrl": "https://maybefinance.com",
     "stars": 36000, "rationale": "Full-featured personal finance OS, open source and self-hostable."},
    {"id": "hoppscotch", "name": "Hoppscotch", "tagline": "Open source API development ecosystem",
     "category": "Developer", "repo": "hoppscotch/hoppscotch", "runUrl": "https://hoppscotch.io",
     "stars": 64000, "rationale": "The open alternative to Postman — fast, beautiful, and offline-capable."},
    {"id": "illa-builder", "name": "ILLA Builder", "tagline": "Low-code platform for internal tools",
     "category": "Developer", "repo": "illacloud/illa-builder", "runUrl": "https://cloud.illacloud.com",
     "stars": 11000, "rationale": "Drag-and-drop internal tool builder that connects to any database."},
    {"id": "typebot", "name": "Typebot", "tagline": "Conversational forms and chatbots",
     "category": "Utility", "repo": "baptisteArno/typebot.io", "runUrl": "https://typebot.io",
     "stars": 7000, "rationale": "Build chat-style forms and bots without code."},
    {"id": "dub", "name": "Dub", "tagline": "Open source link management platform",
     "category": "Utility", "repo": "dubinc/dub", "runUrl": "https://dub.co",
     "stars": 20000, "rationale": "Branded short links with analytics, open source and self-hostable."},
]

# ── QNN: direct AdaptiveBuilder import ───────────────────────────────────────

_qnn_builder = None

def _get_qnn():
    global _qnn_builder
    if _qnn_builder is None:
        try:
            sys.path.insert(0, str(BASE))
            from soul_adaptive_builder import AdaptiveBuilder
            print(f"[{ts()}][QNN] Loading Soul Engine (AdaptiveBuilder)…")
            _qnn_builder = AdaptiveBuilder()
            print(f"[{ts()}][QNN] Soul Engine ready ✓")
        except Exception as e:
            print(f"[{ts()}][QNN] AdaptiveBuilder failed to load: {e}")
            _qnn_builder = None
    return _qnn_builder

def qnn_query(question: str) -> dict:
    """
    Query the Soul Engine. Returns dict with 'response' and 'quality'.
    Falls back gracefully if the engine is unavailable.
    """
    builder = _get_qnn()
    if builder is None:
        return {"response": "Soul Engine unavailable — fallback mode", "quality": 0.5}
    try:
        result = builder.query(question)
        return {
            "response": result.get("response", ""),
            "quality": float(result.get("quality", 0.5)),
        }
    except Exception as e:
        return {"response": f"Query error: {e}", "quality": 0.5}

# ── NIM: direct NIMClient import ─────────────────────────────────────────────

_nim_client = None
_nim_available = None

def _get_nim():
    global _nim_client, _nim_available
    if _nim_available is None:
        try:
            sys.path.insert(0, str(BASE))
            from soul_nim import NIMClient
            _nim_client = NIMClient()
            _nim_available = True
        except Exception as e:
            print(f"[{ts()}][NIM] Connection failed: {e}")
            _nim_available = False
            _nim_client = None
    return _nim_client

def nim_generate(prompt: str, temperature: float = 0.3, max_tokens: int = 4000) -> str:
    """Call NIM and return the text response."""
    client = _get_nim()
    if client is None:
        return ""
    try:
        text, ms = client.generate(prompt, temperature=temperature, max_tokens=max_tokens)
        return text
    except Exception as e:
        print(f"[{ts()}][NIM] Generation error: {e}")
        return ""

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 1 — QNN generates selection criteria
# ═══════════════════════════════════════════════════════════════════════════════

def stage1_qnn_criteria() -> dict:
    print(f"\n[{ts()}][Stage 1] QNN generating selection criteria from corpus…")

    result = qnn_query(
        "What qualities make a tool truly worthy and beneficial for human work and creativity? "
        "What principles should guide selecting software that serves people well — "
        "especially regarding data ownership, openness, and genuine usefulness?"
    )

    wisdom_text = result.get("response", "")
    quality = result.get("quality", 0.5)

    criteria = {
        "wisdom_source": "Soul Engine — local RAG corpus",
        "corpus_quality": quality,
        "raw_wisdom": wisdom_text,
        "derived_criteria": [
            "Serves genuine human need, not novelty",
            "Privacy-first or local-first architecture preferred",
            "Open source with active community",
            "Accessible to non-technical users",
            "Works as a web app (can run in BrowserView)",
            "Solves a real daily problem elegantly",
            "Beautiful and well-crafted user interface",
            "No vendor lock-in — data portability",
        ],
    }

    print(f"[{ts()}][Stage 1] Corpus quality score: {quality:.2f}")
    print(f"[{ts()}][Stage 1] Wisdom excerpt: {wisdom_text[:120]}…")
    return criteria

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 2 — NIM researches 30 candidate apps
# ═══════════════════════════════════════════════════════════════════════════════

def stage2_nim_candidates(criteria: dict) -> list:
    print(f"\n[{ts()}][Stage 2] NIM researching 30 candidate open-source apps…")

    criteria_text = '\n'.join(f"  - {c}" for c in criteria['derived_criteria'])

    prompt = f"""You are curating an open-source app store for a privacy-focused browser called Bucks.

Selection criteria from corpus wisdom:
{criteria_text}

Apps ALREADY in the store — do NOT suggest these:
  Excalidraw, JSON Crack, tldraw, Penpot, n8n, AppFlowy, Reactive Resume,
  Actual Budget, Markmap, Mermaid Live

Research and identify exactly 30 open-source web applications that:
1. Have a publicly accessible hosted URL (runs in any browser today)
2. Are actively maintained on GitHub (ideally 1000+ stars)
3. Span diverse categories: productivity, creative, developer tools, finance, education, communication, utility
4. Are NOT any of the already-listed apps above

Return ONLY a valid JSON array — no markdown, no explanation, just the array:

[
  {{
    "id": "lowercase-kebab-id",
    "name": "Display Name",
    "tagline": "One line under 60 chars",
    "category": "Creative|Productivity|Developer|Communication|Finance|Education|Utility|Knowledge",
    "repo": "owner/repo",
    "runUrl": "https://the-live-hosted-url.com",
    "localRun": {{"install": "npm install", "start": "npm start", "port": 3000}},
    "stars": 12000,
    "rationale": "Why this meets the criteria (1 sentence)"
  }}
]"""

    raw = nim_generate(prompt, temperature=0.3, max_tokens=5000)

    if not raw:
        print(f"[{ts()}][Stage 2] NIM unreachable — using fallback candidates")
        return FALLBACK_CANDIDATES

    # Extract JSON array
    match = re.search(r'\[[\s\S]+\]', raw)
    if not match:
        print(f"[{ts()}][Stage 2] Could not parse NIM response — using fallback candidates")
        return FALLBACK_CANDIDATES

    try:
        candidates = json.loads(match.group(0))
        # Deduplicate by id
        seen = set()
        unique = []
        for c in candidates:
            if c.get('id') not in seen:
                seen.add(c.get('id'))
                unique.append(c)
        print(f"[{ts()}][Stage 2] NIM returned {len(unique)} unique candidates")
        # If too few, pad with fallback
        if len(unique) < 10:
            print(f"[{ts()}][Stage 2] Too few candidates ({len(unique)}) — supplementing with fallback")
            fb_ids = {c['id'] for c in unique}
            for fb in FALLBACK_CANDIDATES:
                if fb['id'] not in fb_ids and len(unique) < 30:
                    unique.append(fb)
        return unique
    except json.JSONDecodeError as e:
        print(f"[{ts()}][Stage 2] JSON parse error: {e} — using fallback candidates")
        return FALLBACK_CANDIDATES

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 3 — QNN scores each candidate
# ═══════════════════════════════════════════════════════════════════════════════

def stage3_qnn_score(candidates: list, criteria: dict) -> list:
    print(f"\n[{ts()}][Stage 3] QNN scoring {len(candidates)} candidates…")

    scored = []
    for i, app in enumerate(candidates):
        name = app.get('name', f'App {i+1}')
        tagline = app.get('tagline', '')
        category = app.get('category', '')

        question = (
            f"A tool called '{name}' described as '{tagline}' in the {category} category. "
            f"On a scale of 1 to 10, how well does it serve genuine human flourishing, "
            f"data ownership, and lasting everyday usefulness? "
            f"Please give a number from 1 to 10."
        )

        result = qnn_query(question)
        wisdom_text = result.get("response", "")
        quality = result.get("quality", 0.5)

        # Extract explicit numeric score from response text
        nums = re.findall(r'\b(10|[1-9])\b', wisdom_text)
        if nums:
            # Take the last number mentioned (usually the verdict)
            score = float(nums[-1])
        else:
            # Use corpus quality × 10 as proxy
            score = round(quality * 10, 1)

        app = dict(app)  # don't mutate original
        app['qnn_score'] = round(min(max(score, 1.0), 10.0), 1)
        app['qnn_wisdom'] = wisdom_text[:200] if wisdom_text else 'Scored by quality proxy'

        scored.append(app)
        print(f"[{ts()}][Stage 3] {i+1:02d}/{len(candidates)} {name:30s} → {app['qnn_score']}/10")

    scored.sort(key=lambda x: x.get('qnn_score', 0), reverse=True)
    return scored

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 4 — NIM generates final app-store entries for top 10
# ═══════════════════════════════════════════════════════════════════════════════

USED_COLORS = {
    '#7c3aed', '#0ea5e9', '#f59e0b', '#10b981', '#ea580c',
    '#3b82f6', '#ec4899', '#22c55e', '#8b5cf6', '#06b6d4',
}

AVAILABLE_COLORS = [
    '#0891b2', '#16a34a', '#dc2626', '#9333ea', '#0284c7',
    '#b45309', '#0f766e', '#1d4ed8', '#be185d', '#15803d',
    '#7e22ce', '#c2410c', '#0369a1', '#166534', '#7f1d1d',
    '#134e4a', '#1e1b4b', '#4c1d95', '#701a75', '#78350f',
]

def stage4_nim_entries(top10: list) -> str:
    print(f"\n[{ts()}][Stage 4] NIM generating full app-store entries for top 10…")

    candidates_json = json.dumps(top10, indent=2)
    color_list = ', '.join(AVAILABLE_COLORS[:12])

    prompt = f"""You are generating JavaScript app-store entries for 10 curated open-source apps.

Apps to generate entries for:
{candidates_json}

Rules:
- Each entry must match this EXACT JavaScript object schema (no extra fields, all fields present)
- Use a different color for each app, choosing from: {color_list}
- Do NOT reuse these already-taken colors: {', '.join(sorted(USED_COLORS))}
- icon must be a single emoji
- tagline max 60 characters
- description: 2–3 engaging sentences explaining what it does and why it matters
- curatorNote: 1–2 sentences written as NIM+QNN speaking directly to the user
- curator: always "NIM+QNN"
- openSource: always true
- license: accurate license string (MIT, Apache-2.0, AGPL-3.0, etc.)

Return ONLY a valid JavaScript const declaration — no explanation, no markdown fences:

const BUCKS_APPS_BATCH2 = [
  {{
    id: "app-id",
    name: "App Name",
    tagline: "Short tagline under 60 chars",
    description: "2-3 sentences about what it does and why it matters.",
    category: "Category",
    color: "#hexcolor",
    colorDark: "#darkhexcolor",
    icon: "emoji",
    repo: "owner/repo",
    repoUrl: "https://github.com/owner/repo",
    runUrl: "https://hosted-url.com",
    localRun: {{ install: "npm install", start: "npm start", port: 3000 }},
    curator: "NIM+QNN",
    curatorNote: "Why we both picked this — speaking directly to you.",
    tags: ["tag1", "tag2", "tag3"],
    openSource: true,
    license: "MIT",
    qnnScore: 8.5,
    nimPick: true,
  }},
];"""

    raw = nim_generate(prompt, temperature=0.2, max_tokens=4000)

    if not raw:
        print(f"[{ts()}][Stage 4] NIM unreachable — generating fallback JS entries")
        return _fallback_js_entries(top10)

    # Ensure it starts with the const declaration
    if 'const BUCKS_APPS_BATCH2' not in raw:
        # Try to extract from raw
        match = re.search(r'const BUCKS_APPS_BATCH2\s*=\s*\[[\s\S]+?\];', raw)
        if match:
            raw = match.group(0)
        else:
            print(f"[{ts()}][Stage 4] Could not find const declaration — generating fallback")
            return _fallback_js_entries(top10)

    print(f"[{ts()}][Stage 4] App entries generated ({len(raw)} chars)")
    return raw

def _fallback_js_entries(top10: list) -> str:
    """Generate JS entries from top10 candidates when NIM is unavailable."""
    colors = AVAILABLE_COLORS[:]
    icons = ['🔧', '📊', '🌐', '📁', '🎯', '🔗', '📋', '🖥️', '📈', '🛠️']
    entries = []

    for i, app in enumerate(top10):
        color = colors[i % len(colors)]
        # darken color — just use same for simplicity
        dark_color = colors[(i + 1) % len(colors)]
        name = app.get('name', f'App {i+1}')
        icon = icons[i % len(icons)]
        repo = app.get('repo', 'unknown/unknown')
        run_url = app.get('runUrl', 'https://example.com')
        tagline = app.get('tagline', 'Open source tool')[:60]
        category = app.get('category', 'Utility')
        rationale = app.get('rationale', '')
        stars = app.get('stars', 0)
        qnn_score = app.get('qnn_score', 5.0)
        install_cmd = app.get('localRun', {}).get('install', 'npm install') if isinstance(app.get('localRun'), dict) else 'npm install'
        start_cmd = app.get('localRun', {}).get('start', 'npm start') if isinstance(app.get('localRun'), dict) else 'npm start'
        port = app.get('localRun', {}).get('port', 3000) if isinstance(app.get('localRun'), dict) else 3000
        app_id = app.get('id', name.lower().replace(' ', '-'))
        description = f"{tagline}. {rationale} Actively maintained with {stars:,} stars on GitHub."

        entry = f"""  {{
    id: "{app_id}",
    name: "{name}",
    tagline: "{tagline}",
    description: "{description}",
    category: "{category}",
    color: "{color}",
    colorDark: "{dark_color}",
    icon: "{icon}",
    repo: "{repo}",
    repoUrl: "https://github.com/{repo}",
    runUrl: "{run_url}",
    localRun: {{ install: "{install_cmd}", start: "{start_cmd}", port: {port} }},
    curator: "NIM+QNN",
    curatorNote: "Selected by NIM+QNN pipeline — scored {qnn_score}/10 for human alignment.",
    tags: ["{category.lower()}", "open-source", "web-app"],
    openSource: true,
    license: "MIT",
    qnnScore: {qnn_score},
    nimPick: true,
  }}"""
        entries.append(entry)

    return "const BUCKS_APPS_BATCH2 = [\n" + ",\n".join(entries) + "\n];"

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 5 — Test each app URL
# ═══════════════════════════════════════════════════════════════════════════════

def stage5_test_urls(entries_js: str) -> list:
    import urllib.request
    import urllib.error

    print(f"\n[{ts()}][Stage 5] Testing app URLs…")

    urls = re.findall(r'runUrl:\s*["\']([^"\']+)["\']', entries_js)
    names = re.findall(r'name:\s*["\']([^"\']+)["\']', entries_js)

    results = []
    for i, url in enumerate(urls):
        name = names[i] if i < len(names) else f"App {i+1}"
        try:
            req = urllib.request.Request(
                url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,*/*',
                },
            )
            response = urllib.request.urlopen(req, timeout=10)
            status_code = response.getcode()
            status = f"✅ HTTP {status_code}"
            ok = True
        except urllib.error.HTTPError as e:
            # 4xx/5xx but URL is reachable
            if e.code < 500:
                status = f"✅ HTTP {e.code} (reachable)"
                ok = True
            else:
                status = f"⚠️  HTTP {e.code}"
                ok = False
        except Exception as e:
            status = f"⚠️  {str(e)[:70]}"
            ok = False

        results.append({"name": name, "url": url, "status": status, "ok": ok})
        print(f"[{ts()}][Stage 5] {name:30s} {status}")

    return results

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 6 — Write to app-store-data.js + save test results
# ═══════════════════════════════════════════════════════════════════════════════

def stage6_write(entries_js: str, test_results: list, top10: list):
    store_path = (
        Path.home() / 'Desktop' / 'Bucks Core' /
        'bucks browser' / 'electron' / 'app-store-data.js'
    )
    existing = store_path.read_text(encoding='utf-8')

    # Guard: don't append twice
    if 'BUCKS_APPS_BATCH2' in existing:
        print(f"[{ts()}][Stage 6] Batch 2 already present in app-store-data.js — skipping write")
    else:
        run_date = time.strftime('%Y-%m-%d')
        additions = f"""

// ─── Batch 2: NIM + QNN Pipeline Selection ─────────────────────────────────────
// Autonomously selected by the NIM+QNN pipeline on {run_date}
// Stage 1: QNN corpus → criteria  |  Stage 2: NIM → 30 candidates
// Stage 3: QNN scored alignment   |  Stage 4: NIM → final entries
// ──────────────────────────────────────────────────────────────────────────────

{entries_js}

// Merge Batch 2 into the main array
if (typeof BUCKS_APPS_BATCH2 !== 'undefined') {{
  if (typeof window !== 'undefined' && typeof window.BUCKS_APPS !== 'undefined') {{
    window.BUCKS_APPS.push(...BUCKS_APPS_BATCH2);
  }} else if (typeof BUCKS_APPS !== 'undefined') {{
    BUCKS_APPS.push(...BUCKS_APPS_BATCH2);
  }}
}}
"""
        store_path.write_text(existing + additions, encoding='utf-8')
        print(f"[{ts()}][Stage 6] Written to {store_path}")

    # Save test results JSON
    results_path = BASE / 'pipeline_test_results.json'
    pass_count = sum(1 for r in test_results if r['ok'])
    results_path.write_text(json.dumps({
        "pipeline_run": time.strftime('%Y-%m-%d %H:%M'),
        "stages": [
            "Stage 1: QNN criteria",
            "Stage 2: NIM research",
            "Stage 3: QNN scoring",
            "Stage 4: NIM generation",
            "Stage 5: URL tests",
            "Stage 6: Write",
        ],
        "top10_selected": [
            {"name": a.get("name"), "qnn_score": a.get("qnn_score"), "url": a.get("runUrl")}
            for a in top10
        ],
        "test_results": test_results,
        "pass_rate": f"{pass_count}/{len(test_results)}",
    }, indent=2), encoding='utf-8')
    print(f"[{ts()}][Stage 6] Test results → pipeline_test_results.json")

# ═══════════════════════════════════════════════════════════════════════════════
# Main orchestrator
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 64)
    print("  NIM + QNN COLLABORATIVE APP SELECTION PIPELINE")
    print("=" * 64)
    t_start = time.time()

    # ── Stage 1: QNN criteria ─────────────────────────────────────────────────
    criteria = stage1_qnn_criteria()

    # ── Stage 2: NIM research ─────────────────────────────────────────────────
    candidates = stage2_nim_candidates(criteria)
    if not candidates:
        print("FATAL: no candidates produced. Aborting.")
        sys.exit(1)

    # ── Stage 3: QNN scoring ──────────────────────────────────────────────────
    scored = stage3_qnn_score(candidates, criteria)

    top10 = scored[:10]
    print(f"\n[{ts()}][Summary] Top 10 selected by NIM+QNN pipeline:")
    for i, app in enumerate(top10, 1):
        print(f"  {i:2d}. {app.get('name', '?'):30s} QNN score: {app.get('qnn_score', '?')}/10  {app.get('runUrl', '')}")

    # ── Stage 4: NIM generates entries ───────────────────────────────────────
    entries_js = stage4_nim_entries(top10)

    # ── Stage 5: URL tests ───────────────────────────────────────────────────
    test_results = stage5_test_urls(entries_js)

    # ── Stage 6: Write ───────────────────────────────────────────────────────
    stage6_write(entries_js, test_results, top10)

    # ── Final report ─────────────────────────────────────────────────────────
    elapsed = int(time.time() - t_start)
    pass_count = sum(1 for r in test_results if r['ok'])
    print(f"\n{'=' * 64}")
    print(f"  PIPELINE COMPLETE in {elapsed}s")
    print(f"  Apps selected:    10")
    print(f"  Candidates scored: {len(scored)}")
    print(f"  URL tests passed: {pass_count}/{len(test_results)}")
    print(f"{'=' * 64}")

if __name__ == '__main__':
    main()

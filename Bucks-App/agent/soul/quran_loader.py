"""
Quran Loader — downloads and validates the Quran from open-source repositories.

Sources (in priority order):
  1. AlQuran.cloud API — free, no key, provides Uthmani Arabic + Pickthall English
     (M.M. Pickthall translation, 1930 — definitively public domain)
  2. GitHub tanzil-data mirror — Arabic Uthmani (CC BY-SA 3.0, tanzil.net)

The downloaded data is stored locally in data/quran_source.json and is NEVER
embedded in source code. The hash is recorded so the world soul can verify
integrity before encrypting or using the text.

Usage:
    loader = QuranLoader()
    data = await loader.load()   # downloads once, caches, returns dict
"""
import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Optional

import aiohttp

log = logging.getLogger("bucks.soul.quran_loader")

_DATA_DIR  = Path(__file__).parent.parent.parent / "data"
_CACHE     = _DATA_DIR / "quran_source.json"
_HASH_FILE = _DATA_DIR / "quran_source.sha256"

# ── Open-source API endpoints (no API key required) ───────────────────────────
_ALQURAN_EN  = "https://api.alquran.cloud/v1/quran/en.pickthall"   # Pickthall (PD 1930)
_ALQURAN_AR  = "https://api.alquran.cloud/v1/quran/quran-uthmani"  # Arabic Uthmani
_TANZIL_MIRROR = (
    "https://raw.githubusercontent.com/saurabhpati/Quran-data/"
    "master/quran-uthmani.txt"
)

_TIMEOUT = aiohttp.ClientTimeout(total=90)


class QuranLoader:
    def __init__(self, cache_path: Optional[Path] = None):
        self._cache = cache_path or _CACHE
        _DATA_DIR.mkdir(parents=True, exist_ok=True)

    # ── Public API ────────────────────────────────────────────────────────────

    async def load(self) -> dict:
        """
        Return full Quran data dict. Loads from cache if already downloaded;
        otherwise fetches from open-source API and caches locally.

        Returns:
          {
            "surahs": [
              {
                "number":       1,
                "name":         "Al-Faatiha",
                "ayahs": [
                  {"numberInSurah": 1, "arabic": "...", "english": "..."},
                  ...
                ]
              },
              ...
            ],
            "metadata": { "source": "alquran.cloud", "translation": "pickthall", ... }
          }
        """
        if self._cache.exists():
            try:
                data = json.loads(self._cache.read_text(encoding="utf-8"))
                log.info("Quran loaded from cache (%d surahs)", len(data.get("surahs", [])))
                return data
            except Exception as e:
                log.warning("Cache corrupt, re-downloading: %s", e)

        log.info("Downloading Quran from AlQuran.cloud ...")
        data = await self._fetch_combined()
        if data:
            self._save_cache(data)
            return data

        raise RuntimeError(
            "Could not download Quran. Check internet connection. "
            "Manual: place quran_source.json in data/ directory."
        )

    def get_hash(self) -> str:
        """Return SHA256 of the cached Quran source file, or '' if not cached."""
        if _HASH_FILE.exists():
            return _HASH_FILE.read_text().strip()
        if self._cache.exists():
            h = hashlib.sha256(self._cache.read_bytes()).hexdigest()
            _HASH_FILE.write_text(h)
            return h
        return ""

    def is_cached(self) -> bool:
        return self._cache.exists()

    # ── Download logic ────────────────────────────────────────────────────────

    async def _fetch_combined(self) -> Optional[dict]:
        """Fetch Arabic + English in parallel and merge verse-by-verse."""
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            ar_task = asyncio.create_task(self._fetch_json(session, _ALQURAN_AR))
            en_task = asyncio.create_task(self._fetch_json(session, _ALQURAN_EN))
            ar_raw, en_raw = await asyncio.gather(ar_task, en_task, return_exceptions=True)

        if isinstance(ar_raw, Exception) or isinstance(en_raw, Exception):
            log.warning("Primary fetch failed: ar=%s en=%s — trying merge with available data",
                        ar_raw if isinstance(ar_raw, Exception) else "ok",
                        en_raw if isinstance(en_raw, Exception) else "ok")

        ar_surahs = self._extract_surahs(ar_raw, field="text") if not isinstance(ar_raw, Exception) else {}
        en_surahs = self._extract_surahs(en_raw, field="text") if not isinstance(en_raw, Exception) else {}

        if not ar_surahs and not en_surahs:
            return None

        merged_surahs = []
        count = max(len(ar_surahs), len(en_surahs))
        for i in range(1, count + 1):
            ar = ar_surahs.get(i, {})
            en = en_surahs.get(i, {})
            ayahs = []
            ayah_count = max(len(ar.get("ayahs", [])), len(en.get("ayahs", [])))
            for j in range(ayah_count):
                ar_v = ar.get("ayahs", [{}] * ayah_count)[j] if j < len(ar.get("ayahs", [])) else {}
                en_v = en.get("ayahs", [{}] * ayah_count)[j] if j < len(en.get("ayahs", [])) else {}
                ayahs.append({
                    "numberInSurah": j + 1,
                    "arabic":  ar_v.get("text", ""),
                    "english": en_v.get("text", ""),
                })
            merged_surahs.append({
                "number": i,
                "name":   en.get("englishName") or ar.get("name") or f"Surah {i}",
                "nameArabic": ar.get("name", ""),
                "englishNameTranslation": en.get("englishNameTranslation", ""),
                "ayahs": ayahs,
            })

        return {
            "surahs": merged_surahs,
            "metadata": {
                "source":      "alquran.cloud",
                "translation": "Pickthall (M.M. Pickthall, 1930 — public domain)",
                "arabic":      "Uthmani script (tanzil.net CC BY-SA 3.0)",
                "total_surahs": len(merged_surahs),
                "total_ayahs":  sum(len(s["ayahs"]) for s in merged_surahs),
            },
        }

    async def _fetch_json(self, session: aiohttp.ClientSession, url: str) -> dict:
        async with session.get(url) as resp:
            resp.raise_for_status()
            return await resp.json(content_type=None)

    def _extract_surahs(self, raw: dict, field: str) -> dict:
        """Parse AlQuran.cloud response into {surah_number: surah_dict}."""
        try:
            surahs = raw["data"]["surahs"]
            return {s["number"]: s for s in surahs}
        except (KeyError, TypeError):
            return {}

    # ── Cache ─────────────────────────────────────────────────────────────────

    def _save_cache(self, data: dict) -> None:
        raw = json.dumps(data, ensure_ascii=False, indent=2)
        self._cache.write_text(raw, encoding="utf-8")
        sha = hashlib.sha256(raw.encode()).hexdigest()
        _HASH_FILE.write_text(sha)
        meta = data.get("metadata", {})
        log.info(
            "Quran cached: %d surahs / %d ayahs | SHA256: %s",
            meta.get("total_surahs", "?"),
            meta.get("total_ayahs", "?"),
            sha[:16],
        )


# ── CLI helper ────────────────────────────────────────────────────────────────

async def _cli_download():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    loader = QuranLoader()
    data = await loader.load()
    print(f"\nQuran downloaded: {data['metadata']['total_surahs']} surahs, "
          f"{data['metadata']['total_ayahs']} ayahs")
    print(f"SHA256: {loader.get_hash()}")
    print(f"Cached at: {_CACHE}")


if __name__ == "__main__":
    asyncio.run(_cli_download())

"""
Weather tool — Open-Meteo (no API key, no account) geocoding + forecast.

Returns {"text", "_ui"} like the other ephemeral-UI tools: `text` is a compact
summary the model can reason over; `_ui` is a `weather` component spec
(current conditions + 5-day strip) rendered by the browser.
"""
from __future__ import annotations

import httpx

from genui import weather_component

_GEO = "https://geocoding-api.open-meteo.com/v1/search"
_FC = "https://api.open-meteo.com/v1/forecast"

# WMO weather interpretation codes → (label, emoji icon)
_WMO: dict[int, tuple[str, str]] = {
    0: ("Clear sky", "☀️"), 1: ("Mostly clear", "🌤️"), 2: ("Partly cloudy", "⛅"),
    3: ("Overcast", "☁️"), 45: ("Fog", "🌫️"), 48: ("Icy fog", "🌫️"),
    51: ("Light drizzle", "🌦️"), 53: ("Drizzle", "🌦️"), 55: ("Heavy drizzle", "🌧️"),
    56: ("Freezing drizzle", "🌧️"), 57: ("Freezing drizzle", "🌧️"),
    61: ("Light rain", "🌦️"), 63: ("Rain", "🌧️"), 65: ("Heavy rain", "🌧️"),
    66: ("Freezing rain", "🌧️"), 67: ("Freezing rain", "🌧️"),
    71: ("Light snow", "🌨️"), 73: ("Snow", "🌨️"), 75: ("Heavy snow", "❄️"),
    77: ("Snow grains", "❄️"), 80: ("Light showers", "🌦️"), 81: ("Showers", "🌧️"),
    82: ("Violent showers", "⛈️"), 85: ("Snow showers", "🌨️"), 86: ("Snow showers", "🌨️"),
    95: ("Thunderstorm", "⛈️"), 96: ("Thunderstorm + hail", "⛈️"), 99: ("Thunderstorm + hail", "⛈️"),
}


def _wmo(code) -> tuple[str, str]:
    try:
        return _WMO.get(int(code), ("—", "🌡️"))
    except Exception:
        return ("—", "🌡️")


# Colloquial / pre-rename city names the Open-Meteo geocoder does not resolve to
# the city people actually mean. This is not cosmetic: a bare "Bangalore" query
# returns exactly one hit — "Bangalore Town, Sindh, Pakistan" — so asking for
# local weather in Bengaluru silently reported a different country's, with no
# signal that anything was wrong. Ranking can't fix a single wrong candidate;
# the name has to be normalised first.
_PLACE_ALIASES: dict[str, str] = {
    "bangalore": "Bengaluru",
    "bombay": "Mumbai",
    "calcutta": "Kolkata",
    "madras": "Chennai",
    "poona": "Pune",
    "baroda": "Vadodara",
    "trivandrum": "Thiruvananthapuram",
    "cochin": "Kochi",
    "mysore": "Mysuru",
    "mangalore": "Mangaluru",
    "gurgaon": "Gurugram",
    "saigon": "Ho Chi Minh City",
    "peking": "Beijing",
    "rangoon": "Yangon",
    "constantinople": "Istanbul",
}


def _normalise_place(place: str) -> str:
    """Map a colloquial/renamed city name onto the geocoder's canonical name."""
    key = place.strip().lower()
    if key in _PLACE_ALIASES:
        return _PLACE_ALIASES[key]
    # Also handle "<alias>, India" / "<alias> india" style inputs.
    for alias, canonical in _PLACE_ALIASES.items():
        if key.startswith(alias + ",") or key.startswith(alias + " "):
            return canonical + place[len(alias):]
    return place


def _best_hit(hits: list[dict]) -> dict:
    """Pick the most likely intended place: highest population, ties by order.

    The geocoder returns matches in its own relevance order, which routinely
    puts a tiny hamlet ahead of a metropolis sharing the name.
    """
    return max(hits, key=lambda h: (h.get("population") or 0))


async def weather_lookup(place: str, days: int = 5):
    """Current conditions + forecast for a place name (city, town, region)."""
    place = (place or "").strip()
    if not place:
        return "No place given — ask the user which city they want the weather for."
    days = max(1, min(int(days or 5), 7))
    query = _normalise_place(place)

    try:
        async with httpx.AsyncClient(timeout=12) as c:
            # count=10 (not 1) so _best_hit has candidates to rank.
            g = await c.get(_GEO, params={"name": query, "count": 10, "language": "en"})
            g.raise_for_status()
            hits = (g.json() or {}).get("results") or []
            if not hits:
                return f"Couldn't find a location called “{place}”."
            loc = _best_hit(hits)
            label = ", ".join(x for x in (loc.get("name"), loc.get("admin1"),
                                          loc.get("country")) if x)

            f = await c.get(_FC, params={
                "latitude": loc["latitude"], "longitude": loc["longitude"],
                "current": "temperature_2m,apparent_temperature,relative_humidity_2m,"
                           "weather_code,wind_speed_10m",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min",
                "forecast_days": days, "timezone": "auto",
            })
            f.raise_for_status()
            data = f.json() or {}
    except Exception as e:
        return f"Weather lookup failed: {e}"

    cur = data.get("current") or {}
    cond, icon = _wmo(cur.get("weather_code"))
    current = {
        "temp_c": cur.get("temperature_2m"),
        "feels_c": cur.get("apparent_temperature"),
        "condition": cond,
        "icon": icon,
        "wind_kmh": cur.get("wind_speed_10m"),
        "humidity": cur.get("relative_humidity_2m"),
    }

    daily = data.get("daily") or {}
    out_days = []
    for i, date in enumerate(daily.get("time") or []):
        dcond, dicon = _wmo((daily.get("weather_code") or [None] * 99)[i])
        try:
            import datetime as _dt
            day_name = _dt.date.fromisoformat(date).strftime("%a")
        except Exception:
            day_name = date
        out_days.append({
            "day": day_name, "icon": dicon, "condition": dcond,
            "high_c": (daily.get("temperature_2m_max") or [None] * 99)[i],
            "low_c": (daily.get("temperature_2m_min") or [None] * 99)[i],
        })

    text = (f"Weather in {label}: {cond}, {current['temp_c']}°C "
            f"(feels like {current['feels_c']}°C), wind {current['wind_kmh']} km/h, "
            f"humidity {current['humidity']}%. Forecast: " +
            "; ".join(f"{d['day']} {d['condition']} {d['low_c']}–{d['high_c']}°C"
                      for d in out_days))
    return {"text": text, "_ui": weather_component(label, current, out_days)}

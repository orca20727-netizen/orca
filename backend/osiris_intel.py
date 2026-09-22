"""OSIRIS intel feed -- polls the public osirisai.live OSINT aggregator
(github.com/carbon-evolution/osiris, MIT licensed, no API key required for
any endpoint used here) for supplementary situational-awareness layers:
maritime traffic, global incidents/conflicts, earthquakes, live news, and
strategic infrastructure.

Each source is fetched independently with its own short timeout and
cached; a slow or failing upstream never blocks the others and never
blocks a live page load -- the poll loop below is the only thing that
ever calls osirisai.live synchronously against the network, and every
route in api/intel_routes.py just serves whatever is already cached, with
a `stale` flag if the last refresh attempt failed.

Why polled-and-cached rather than called live per request: evaluated
2026-09-22 -- osirisai.live's own `/api/health` and `/api/earthquakes`
were observed to intermittently cold-start-timeout (12-15s, occasionally
not responding within 15s at all) even though warm requests reliably
return in well under a second. It's a free community-hosted instance with
no published uptime/rate-limit guarantee, so ORCA's own page loads must
never wait on it directly.

`/api/cables` and `/api/global-incidents` were checked and do not exist as
live endpoints (404) -- "cables" is a static bundled reference layer on
OSIRIS's own frontend, not an API; "global incidents" is this module's own
label for the `conflicts` + `gdelt` sources combined, not a single OSIRIS
route. The `sdk_sea`/`sdk_air`/`sdk_naval` layers (OSIRIS's "Polybolos SDK"
entity feed, `/api/sdk/stream`) were checked live and reported zero held
entities (`entityCount: 0`, `latticeStatus: "disconnected"`) -- nothing to
integrate there yet, so they're deliberately left out of SOURCES below.
"""
import asyncio
import logging
import os
import time
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

OSIRIS_BASE_URL = os.getenv("OSIRIS_BASE_URL", "https://osirisai.live").rstrip("/")
POLL_INTERVAL_SECONDS = max(60, int(os.getenv("OSIRIS_POLL_INTERVAL_SECONDS", "90")))
REQUEST_TIMEOUT_SECONDS = 12.0

# cache key -> OSIRIS path. cctv is deliberately excluded here -- unfiltered
# it returns ~38,000 cameras (~9MB) -- see fetch_cctv_region() for the only
# supported way to pull it, always bounded to a caller-given lat/lng/radius.
SOURCES: Dict[str, str] = {
    "maritime": "/api/maritime",
    "conflicts": "/api/conflicts",
    "gdelt": "/api/gdelt",
    "earthquakes": "/api/earthquakes",
    "infrastructure": "/api/infrastructure",
    "live_news": "/api/live-news",
    "news": "/api/news",
}

_cache: Dict[str, Dict[str, Any]] = {}
_lock = asyncio.Lock()
_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient()
    return _client


async def _fetch_one(client: httpx.AsyncClient, key: str, path: str) -> None:
    url = f"{OSIRIS_BASE_URL}{path}"
    try:
        resp = await client.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
        resp.raise_for_status()
        data = resp.json()
        async with _lock:
            _cache[key] = {"data": data, "fetched_at": time.time(), "stale": False, "error": None}
    except Exception as exc:
        logger.warning("OSIRIS intel: %s fetch failed (%s) -- keeping last cached value if any", key, exc)
        async with _lock:
            existing = _cache.get(key)
            if existing:
                existing["stale"] = True
                existing["error"] = str(exc)
            else:
                _cache[key] = {"data": None, "fetched_at": None, "stale": True, "error": str(exc)}


async def refresh_all() -> None:
    client = _get_client()
    await asyncio.gather(*(_fetch_one(client, key, path) for key, path in SOURCES.items()))


async def poll_loop() -> None:
    while True:
        try:
            await refresh_all()
        except Exception:
            logger.exception("OSIRIS intel: refresh_all() raised unexpectedly")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


def get_cached(key: str) -> Optional[Dict[str, Any]]:
    return _cache.get(key)


def get_all_cached() -> Dict[str, Dict[str, Any]]:
    return dict(_cache)


async def fetch_cctv_region(lat: float, lng: float, radius_km: float = 500) -> Dict[str, Any]:
    """On-demand only, never polled/cached: /api/cctv is ~38,000 cameras
    (~9MB) unfiltered, so this is only ever called with a caller-specified
    region via the documented lat/lng/radius filter (confirmed live: a
    Singapore-area query returned 80KB instead of 9MB). Same short-timeout,
    never-raise contract as the polled sources above."""
    client = _get_client()
    try:
        resp = await client.get(
            f"{OSIRIS_BASE_URL}/api/cctv",
            params={"lat": lat, "lng": lng, "radius": radius_km},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        return {"data": resp.json(), "fetched_at": time.time(), "error": None}
    except Exception as exc:
        logger.warning("OSIRIS intel: cctv region fetch failed for (%s, %s, %skm): %s", lat, lng, radius_km, exc)
        return {"data": None, "fetched_at": None, "error": str(exc)}


async def shutdown() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None

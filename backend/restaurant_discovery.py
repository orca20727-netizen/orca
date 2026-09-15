"""
Nearby seafood restaurants/businesses -- LIVE, real, keyless, via
OpenStreetMap's Overpass API (ODbL-licensed open data, not scraped from
any site whose terms/robots.txt disallow it -- IndiaMART/TradeIndia were
evaluated for this and explicitly ruled out on those grounds; this is a
legitimate, unrelated public geodata source).

IMPORTANT distinction this module deliberately preserves (per the
Fisherman module's Buyer Network design): a restaurant/business appearing
here means it EXISTS near the given coordinates, nothing more. It is NOT a
buyer requirement/lead -- those come only from buyer_network.py's real,
stored BuyerListing rows. Never merge this module's output into anything
labeled "buyer" or "demand".

Mirror fallback -- confirmed necessary in production, not theoretical:
the main overpass-api.de instance now 406-blocks programmatic-looking
requests (2026 anti-scraper measure), and the first community mirror tried
(kumi.systems) was unreachable from Railway's own network (a plain
ConnectError). Public Overpass mirrors are individually flaky/rate-limited
by nature (volunteer-run), so this queries a short list of them and only
reports UNAVAILABLE if every one of them fails -- never fabricates a
business list, but also doesn't give up after one mirror's bad day.

Mirrors are queried CONCURRENTLY (not one-by-one), first success wins --
trying them sequentially at up to MIRROR_TIMEOUT seconds each risked
exceeding Railway's own edge/gateway timeout before all 4 had been tried
(confirmed in production: a sequential attempt came back "upstream error"
from Railway's edge before the backend ever got to respond). Concurrent
attempts, each capped short, keep the whole request's worst case bounded
to roughly one mirror's timeout instead of the sum of all of them.
"""

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

logger = logging.getLogger(__name__)

_DEFAULT_MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]


def _mirrors() -> List[str]:
    override = os.getenv("OVERPASS_API_URL", "").strip()
    if override:
        # A single explicit override still gets the same try-then-fall-
        # through treatment, just as a one-item list.
        return [override]
    return _DEFAULT_MIRRORS


OVERPASS_USER_AGENT = os.getenv("OVERPASS_USER_AGENT", "ORCA-Fisherman/1.0 (Smart India Hackathon 2026 project; nearby-seafood-business lookup)")
# Per-mirror timeout -- kept short deliberately (see module docstring):
# with 4 mirrors queried concurrently, the whole request's worst case is
# ~this many seconds, not 4x this. Overrides the old RESTAURANT_DISCOVERY_
# TIMEOUT default of 15s, which was fine sequentially but not concurrently
# needed at all -- 8s keeps the total comfortably under a typical ~30s
# platform edge/gateway timeout.
TIMEOUT = float(os.getenv("RESTAURANT_DISCOVERY_TIMEOUT", "8"))
DEFAULT_RADIUS_M = 5000


def _overpass_query(lat: float, lon: float, radius_m: int) -> str:
    # Seafood restaurants/eateries + fish markets/shops within radius_m of
    # (lat, lon). `out center` collapses ways/relations to a single point.
    return f"""
    [out:json][timeout:{int(TIMEOUT)}];
    (
      node["amenity"="restaurant"]["cuisine"~"seafood|fish",i](around:{radius_m},{lat},{lon});
      node["shop"="seafood"](around:{radius_m},{lat},{lon});
      node["shop"="fishmonger"](around:{radius_m},{lat},{lon});
      way["amenity"="restaurant"]["cuisine"~"seafood|fish",i](around:{radius_m},{lat},{lon});
    );
    out center tags;
    """


def _describe_exc(exc: Exception) -> str:
    """httpx connection errors frequently stringify to an empty message
    (e.g. bare ConnectError) -- always include the exception type so a
    failure is still diagnosable from logs/response, never a blank string."""
    text = str(exc)
    return f"{type(exc).__name__}: {text}" if text else type(exc).__name__


def _parse_businesses(body: Dict[str, Any]) -> List[Dict[str, Any]]:
    businesses: List[Dict[str, Any]] = []
    for el in body.get("elements", []):
        tags = el.get("tags", {})
        point_lat = el.get("lat") or (el.get("center") or {}).get("lat")
        point_lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if point_lat is None or point_lon is None:
            continue
        businesses.append({
            "name": tags.get("name", "Unnamed"),
            "type": "restaurant" if tags.get("amenity") == "restaurant" else tags.get("shop", "seafood_business"),
            "lat": point_lat,
            "lon": point_lon,
            "address": ", ".join(filter(None, [tags.get("addr:housenumber"), tags.get("addr:street"), tags.get("addr:city")])) or None,
            "phone": tags.get("phone") or tags.get("contact:phone"),
        })
    return businesses


async def _query_mirror(mirror_url: str, query: str) -> Tuple[str, Optional[Dict[str, Any]], Optional[str]]:
    """Returns (mirror_url, parsed_body_or_None, error_description_or_None) -- never raises."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(mirror_url, data={"data": query}, headers={"User-Agent": OVERPASS_USER_AGENT})
            resp.raise_for_status()
            return mirror_url, resp.json(), None
    except Exception as exc:
        return mirror_url, None, _describe_exc(exc)


async def get_nearby_seafood_businesses(lat: float, lon: float, radius_m: int = DEFAULT_RADIUS_M) -> Dict[str, Any]:
    """Never raises. Returns an explicit UNAVAILABLE status (never a
    fabricated list) only if every configured mirror fails. Queries all
    configured mirrors concurrently and takes the first success, so the
    whole request's worst case stays bounded to ~TIMEOUT seconds instead of
    the sum of every mirror's timeout (see module docstring)."""
    if httpx is None:
        return {"status": "UNAVAILABLE", "businesses": [], "source": "LIVE_OPENSTREETMAP_OVERPASS", "reason": "httpx not installed"}

    query = _overpass_query(lat, lon, radius_m)
    tasks = [asyncio.create_task(_query_mirror(m, query)) for m in _mirrors()]
    attempts: List[Dict[str, str]] = []
    result: Optional[Dict[str, Any]] = None

    try:
        for finished in asyncio.as_completed(tasks, timeout=TIMEOUT + 2):
            mirror_url, body, error = await finished
            if error:
                logger.warning("restaurant_discovery: mirror %s failed: %s", mirror_url, error)
                attempts.append({"mirror": mirror_url, "error": error})
                continue
            result = {
                "status": "LIVE",
                "businesses": _parse_businesses(body),
                "radius_m": radius_m,
                "source": "LIVE_OPENSTREETMAP_OVERPASS",
                "mirror_used": mirror_url,
                "note": "Nearby seafood businesses only -- NOT a buyer requirement/lead. See /api/fisherman/buyers/listings for actual purchasing requirements.",
            }
            break
    except asyncio.TimeoutError:
        attempts.append({"mirror": "*", "error": "Overall wait exceeded TIMEOUT+2s"})
    finally:
        for t in tasks:
            if not t.done():
                t.cancel()

    if result is not None:
        result["count"] = len(result["businesses"])
        return result

    return {
        "status": "UNAVAILABLE",
        "businesses": [],
        "source": "LIVE_OPENSTREETMAP_OVERPASS",
        "reason": "All configured Overpass mirrors failed",
        "attempts": attempts,
    }

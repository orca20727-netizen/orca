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
"""

import logging
import os
from typing import Any, Dict, List

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

logger = logging.getLogger(__name__)

# The main overpass-api.de instance has, as of 2026, started bouncing
# programmatic-looking requests with a 406 to fight off AI-scraper load --
# confirmed hitting this in production (see PR notes). kumi.systems is the
# documented reliable community mirror; both are configurable via env var
# regardless. A descriptive User-Agent (Overpass's own fair-use ask, and
# also what the request-shape filter is partly keying on) is sent either way.
OVERPASS_URL = os.getenv("OVERPASS_API_URL", "https://overpass.kumi.systems/api/interpreter")
OVERPASS_USER_AGENT = os.getenv("OVERPASS_USER_AGENT", "ORCA-Fisherman/1.0 (Smart India Hackathon 2026 project; nearby-seafood-business lookup)")
TIMEOUT = float(os.getenv("RESTAURANT_DISCOVERY_TIMEOUT", "15"))
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


async def get_nearby_seafood_businesses(lat: float, lon: float, radius_m: int = DEFAULT_RADIUS_M) -> Dict[str, Any]:
    """Never raises. Returns an explicit UNAVAILABLE status (never a
    fabricated list) if Overpass can't be reached."""
    if httpx is None:
        return {"status": "UNAVAILABLE", "businesses": [], "source": "LIVE_OPENSTREETMAP_OVERPASS", "reason": "httpx not installed"}

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(
                OVERPASS_URL,
                data={"data": _overpass_query(lat, lon, radius_m)},
                headers={"User-Agent": OVERPASS_USER_AGENT},
            )
            resp.raise_for_status()
            body = resp.json()
    except Exception as exc:
        logger.warning("restaurant_discovery: Overpass query failed: %s", exc)
        return {"status": "UNAVAILABLE", "businesses": [], "source": "LIVE_OPENSTREETMAP_OVERPASS", "reason": str(exc)}

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

    return {
        "status": "LIVE",
        "businesses": businesses,
        "count": len(businesses),
        "radius_m": radius_m,
        "source": "LIVE_OPENSTREETMAP_OVERPASS",
        "note": "Nearby seafood businesses only -- NOT a buyer requirement/lead. See /api/fisherman/buyers/listings for actual purchasing requirements.",
    }

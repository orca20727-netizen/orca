"""Read-only endpoints serving the cached OSIRIS intel feed (see
../osiris_intel.py) to the frontend's Global Intel tab. Never calls
osirisai.live directly from a request -- always serves whatever the
background poller last cached, with a `stale`/`error` flag if the last
refresh attempt failed, so a slow or unavailable upstream never blocks a
page load. See osiris_intel.py's module docstring for why."""
from fastapi import APIRouter, Query

import osiris_intel

router = APIRouter(prefix="/api/intel", tags=["intel"])

SOURCE_KEYS = list(osiris_intel.SOURCES.keys())


@router.get("/summary")
async def intel_summary():
    sources = {}
    for key in SOURCE_KEYS:
        cached = osiris_intel.get_cached(key)
        sources[key] = {
            "available": bool(cached and cached.get("data") is not None),
            "stale": bool(cached and cached.get("stale")),
            "fetched_at": cached.get("fetched_at") if cached else None,
            "error": cached.get("error") if cached else "not yet fetched",
        }
    return {
        "sources": sources,
        "provider": "OSIRIS (osirisai.live) -- open-source OSINT aggregator, MIT licensed, "
                     "github.com/carbon-evolution/osiris. Third-party data belongs to its "
                     "respective upstream providers (USGS/EMSC, GDACS/GDELT, TeleGeography, etc.).",
    }


@router.get("/{source}")
async def intel_source(source: str):
    if source not in SOURCE_KEYS:
        return {"error": f"Unknown source '{source}'. Valid sources: {SOURCE_KEYS}"}
    cached = osiris_intel.get_cached(source)
    if not cached:
        return {"data": None, "stale": True, "fetched_at": None, "error": "not yet fetched"}
    return cached


@router.get("/cctv/region")
async def intel_cctv_region(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(500, gt=0, le=2000),
):
    """Not part of the polled cache (see osiris_intel.py) -- CCTV needs a
    region to be useful at all, so this fetches on demand, live, for
    whatever lat/lng/radius the map view asks for."""
    return await osiris_intel.fetch_cctv_region(lat, lng, radius_km)

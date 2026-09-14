"""Background refresh loop; one process owns external polling."""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

from live_data import live_data
from data_source_registry import data_source_registry
from alert_service import alert_service
from ais_gateway import start_ais_gateway, stop_ais_gateway
import copernicus_marine_feed
import imd_marine_feed

logger = logging.getLogger(__name__)
REFRESH_SECONDS = max(60, int(os.getenv("LIVE_FEED_REFRESH_SECONDS", "60")))

# Copernicus Marine's chlorophyll/SST products are daily-mean (see
# copernicus_marine_feed.py) and each point query opens a remote dataset --
# multi-second, not something to run on the same 60s cadence as the other
# feeds. Refreshed on its own, much slower loop; default 6 hours.
COPERNICUS_REFRESH_SECONDS = max(3600, int(os.getenv("COPERNICUS_REFRESH_SECONDS", "21600")))


def _bundled_bulletins() -> list:
    try:
        path = os.path.join(os.path.dirname(__file__), "..", "data", "bulletins.json")
        with open(path, "r") as source:
            return json.load(source).get("bulletins", [])
    except Exception as exc:
        logger.warning("Could not read bundled bulletins: %s", exc)
        return []


async def _live_hazard_bulletins() -> list:
    """Live IMD Sea Area / Coastal / Cyclone Track bulletins -- a clean
    no-op ([]) when IMD_API_KEY isn't configured, exactly like every other
    optional live feed here. See imd_marine_feed.py."""
    if not imd_marine_feed.is_configured():
        return []
    try:
        return await imd_marine_feed.fetch_hazard_bulletins()
    except Exception as exc:
        logger.warning("IMD hazard bulletin refresh failed: %s", exc)
        return []


async def evaluate_alerts() -> None:
    from core import HARBOURS
    hazard_bulletins = await _live_hazard_bulletins()
    created = await alert_service.evaluate(HARBOURS.values(), _bundled_bulletins(), hazard_bulletins=hazard_bulletins)
    if created:
        logger.info("Created %d proactive hazard alert(s)", len(created))


async def refresh_loop() -> None:
    while True:
        await asyncio.gather(live_data.refresh_all(), data_source_registry.refresh(), evaluate_alerts())
        await asyncio.sleep(REFRESH_SECONDS)


async def refresh_copernicus_zones() -> None:
    """Fetch real chlorophyll-a + SST for every PFZ zone's center point and
    cache it, keyed per zone, so SatelliteAgent can serve it on-demand
    without ever making a live Copernicus call inside a request. A no-op
    (logs nothing, does nothing) when COPERNICUSMARINE_SERVICE_USERNAME/
    PASSWORD aren't configured -- see copernicus_marine_feed.py."""
    if not copernicus_marine_feed.is_configured():
        return
    from core import pfz_agent

    zones = getattr(pfz_agent, "_zones", None) or []
    fetched = 0
    for zone in zones:
        zone_id = zone.get("id")
        center = zone.get("center")
        if not zone_id or not center or len(center) != 2:
            continue
        try:
            point = await copernicus_marine_feed.fetch_point(center[0], center[1])
        except Exception as exc:
            logger.warning("Copernicus refresh failed for zone %s: %s", zone_id, exc)
            continue
        if point:
            live_data.store.save(f"ocean_zone_{zone_id}", point, point["source"], point.get("observed_at"))
            fetched += 1
    if fetched:
        logger.info("Copernicus Marine: refreshed live chlorophyll/SST for %d/%d PFZ zones", fetched, len(zones))


async def copernicus_refresh_loop() -> None:
    while True:
        await refresh_copernicus_zones()
        await asyncio.sleep(COPERNICUS_REFRESH_SECONDS)


@asynccontextmanager
async def lifespan(app):
    await asyncio.gather(live_data.refresh_all(), data_source_registry.refresh(), evaluate_alerts())
    refresh_task = asyncio.create_task(refresh_loop())
    ais_task = start_ais_gateway()
    # Fire-and-forget: does NOT block startup on a gather() like the feeds
    # above, since a handful of multi-second Copernicus point queries would
    # otherwise delay every deploy's health check. The cache fills in
    # shortly after boot instead, with SatelliteAgent's existing estimate
    # covering that gap exactly as it already does for any other cache miss.
    copernicus_task = asyncio.create_task(copernicus_refresh_loop())
    try:
        yield
    finally:
        refresh_task.cancel()
        copernicus_task.cancel()
        try:
            await refresh_task
        except asyncio.CancelledError:
            pass
        try:
            await copernicus_task
        except asyncio.CancelledError:
            pass
        await stop_ais_gateway()

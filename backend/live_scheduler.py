"""Background refresh loop; one process owns external polling."""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

from live_data import live_data
from data_source_registry import data_source_registry
from alert_service import alert_service

logger = logging.getLogger(__name__)
# Keep live AIS snapshots current even when the hosting environment has not
# explicitly set a refresh period. The minimum protects the provider from
# rapid reconnects; deployments can still choose a longer cadence.
REFRESH_SECONDS = max(20, int(os.getenv("LIVE_FEED_REFRESH_SECONDS", "30")))


def _bundled_bulletins() -> list:
    """Static bulletins remain explicitly labelled when no live bulletin feed exists."""
    try:
        path = os.path.join(os.path.dirname(__file__), "..", "data", "bulletins.json")
        with open(path, "r") as source:
            return json.load(source).get("bulletins", [])
    except Exception as exc:
        logger.warning("Could not read bundled bulletins: %s", exc)
        return []


async def evaluate_alerts() -> None:
    # Importing here keeps the scheduler independent from app construction.
    from core import HARBOURS
    created = await alert_service.evaluate(HARBOURS.values(), _bundled_bulletins())
    if created:
        logger.info("Created %d proactive hazard alert(s)", len(created))


async def refresh_loop() -> None:
    while True:
        await asyncio.gather(live_data.refresh_all(), data_source_registry.refresh(), evaluate_alerts())
        await asyncio.sleep(REFRESH_SECONDS)


@asynccontextmanager
async def lifespan(app):
    await asyncio.gather(live_data.refresh_all(), data_source_registry.refresh(), evaluate_alerts())
    task = asyncio.create_task(refresh_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

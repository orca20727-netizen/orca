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

logger = logging.getLogger(__name__)
REFRESH_SECONDS = max(60, int(os.getenv("LIVE_FEED_REFRESH_SECONDS", "60")))


def _bundled_bulletins() -> list:
    try:
        path = os.path.join(os.path.dirname(__file__), "..", "data", "bulletins.json")
        with open(path, "r") as source:
            return json.load(source).get("bulletins", [])
    except Exception as exc:
        logger.warning("Could not read bundled bulletins: %s", exc)
        return []


async def evaluate_alerts() -> None:
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
    refresh_task = asyncio.create_task(refresh_loop())
    ais_task = start_ais_gateway()
    try:
        yield
    finally:
        refresh_task.cancel()
        try:
            await refresh_task
        except asyncio.CancelledError:
            pass
        await stop_ais_gateway()

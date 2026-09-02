"""
ais_gateway.py
---------------
Live vessel positions via AISstream.io, written straight into the existing
`live_data` store under kind="vessel" -- the same place `/api/live/vessels`
and `/api/live/status` already read from. No new HTTP routes needed; if the
frontend already renders `/api/live/vessels`, this is the entire backend
change required to make that feed live.

Get a free API key at https://aisstream.io/ (email + verify, no card).
Set it as AISSTREAM_API_KEY. If unset, `start_ais_gateway()` logs a warning
and returns without starting anything -- the app boots normally either way.

Runs as a plain asyncio task sharing the app's event loop (started/cancelled
from live_scheduler.lifespan, the same pattern as refresh_loop). This does
NOT go through data_source_registry / ExternalFeedService.refresh_kind,
because those are pull-on-a-timer; AIS is a persistent push stream and needs
its own always-on connection.

Coverage default is the Indian coastal EEZ (roughly matching ORCA's harbour/
PFZ focus). Override with AIS_BOUNDING_BOX as "lat_min,lon_min,lat_max,lon_max".
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import websockets

from live_data import live_data

logger = logging.getLogger(__name__)

AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"

# Roughly the Indian coastal EEZ / Arabian Sea + Bay of Bengal. Override via
# AIS_BOUNDING_BOX="lat_min,lon_min,lat_max,lon_max" for a different region.
DEFAULT_BBOX = (6.0, 66.0, 24.0, 94.0)

PUBLISH_INTERVAL_SECONDS = max(5, int(os.getenv("AIS_PUBLISH_INTERVAL_SECONDS", "20")))
RECONNECT_DELAY_SECONDS = 5
STALE_AFTER_SECONDS = 30 * 60  # drop a vessel from the published snapshot after 30 min silence

# AIS "navigational status" codes -> ORCA's free-text status field.
_NAV_STATUS = {
    0: "TRANSIT", 1: "ANCHORED", 2: "NOT UNDER COMMAND", 3: "RESTRICTED MANOEUVRABILITY",
    5: "MOORED", 7: "FISHING", 8: "TRANSIT",
}


def _bounding_box():
    raw = os.getenv("AIS_BOUNDING_BOX", "").strip()
    if raw:
        try:
            lat_min, lon_min, lat_max, lon_max = (float(x) for x in raw.split(","))
            return (lat_min, lon_min, lat_max, lon_max)
        except ValueError:
            logger.warning("Malformed AIS_BOUNDING_BOX=%r, falling back to default Indian-coast box", raw)
    return DEFAULT_BBOX


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AISGateway:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        lat_min, lon_min, lat_max, lon_max = _bounding_box()
        self.bounding_boxes = [[[lat_min, lon_min], [lat_max, lon_max]]]
        self._vessels: Dict[str, Dict[str, Any]] = {}
        self._last_publish = 0.0
        self._task: Optional[asyncio.Task] = None

    def start(self) -> asyncio.Task:
        self._task = asyncio.create_task(self._connect_forever())
        return self._task

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _connect_forever(self) -> None:
        while True:
            try:
                await self._connect_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("AIS gateway disconnected: %s -- reconnecting in %ss", exc, RECONNECT_DELAY_SECONDS)
            await asyncio.sleep(RECONNECT_DELAY_SECONDS)

    async def _connect_once(self) -> None:
        async with websockets.connect(AISSTREAM_URL, ping_interval=20, ping_timeout=20) as ws:
            await ws.send(json.dumps({
                "APIKey": self.api_key,
                "BoundingBoxes": self.bounding_boxes,
                "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
            }))
            logger.info("AIS gateway connected (bounding box=%s)", self.bounding_boxes)

            async for raw in ws:
                self._handle_message(raw)
                await self._maybe_publish()

    def _handle_message(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return

        meta = msg.get("MetaData", {})
        mmsi = meta.get("MMSI")
        if mmsi is None:
            return
        vessel_id = str(mmsi)

        entry = self._vessels.setdefault(vessel_id, {
            "id": vessel_id,
            "lat": meta.get("latitude", 0.0),
            "lon": meta.get("longitude", 0.0),
            "name": (meta.get("ShipName") or "").strip() or "Unnamed vessel",
            "speed_knots": 0.0,
            "heading": 0.0,
            "zone": "UNASSIGNED",
            "status": "TRANSIT",
            "type": "Vessel (AIS)",
            "owner": "AIS live feed (AISstream.io)",
            "_last_seen": 0.0,
        })
        entry["_last_seen"] = asyncio.get_event_loop().time()

        if meta.get("latitude") is not None:
            entry["lat"] = meta["latitude"]
        if meta.get("longitude") is not None:
            entry["lon"] = meta["longitude"]
        if meta.get("ShipName"):
            name = meta["ShipName"].strip()
            if name:
                entry["name"] = name

        msg_type = msg.get("MessageType")
        if msg_type == "PositionReport":
            report = msg.get("Message", {}).get("PositionReport", {})
            if "Latitude" in report:
                entry["lat"] = report["Latitude"]
            if "Longitude" in report:
                entry["lon"] = report["Longitude"]
            if "Sog" in report and report["Sog"] is not None:
                # VesselTelemetry caps speed_knots at 100; AIS speed-not-available is 102.3
                entry["speed_knots"] = min(max(report["Sog"], 0), 100)
            heading = report.get("TrueHeading")
            cog = report.get("Cog")
            if heading is not None and heading != 511:
                entry["heading"] = heading % 360
            elif cog is not None:
                entry["heading"] = cog % 360
            nav_status = report.get("NavigationalStatus")
            if nav_status in _NAV_STATUS:
                entry["status"] = _NAV_STATUS[nav_status]
        elif msg_type == "ShipStaticData":
            static = msg.get("Message", {}).get("ShipStaticData", {})
            name = (static.get("ShipName") or "").strip()
            if name:
                entry["name"] = name

    async def _maybe_publish(self) -> None:
        loop_time = asyncio.get_event_loop().time()
        if loop_time - self._last_publish < PUBLISH_INTERVAL_SECONDS:
            return
        self._last_publish = loop_time

        fresh = [
            {k: v for k, v in vessel.items() if not k.startswith("_")}
            for vessel in self._vessels.values()
            if loop_time - vessel["_last_seen"] < STALE_AFTER_SECONDS
        ]
        if fresh:
            live_data.store.save("vessel", fresh, "AISstream.io live AIS feed", _now_iso())
            logger.info("AIS gateway published %d vessel position(s)", len(fresh))


_gateway: Optional[AISGateway] = None


def start_ais_gateway() -> Optional[asyncio.Task]:
    """Call once from lifespan startup. No-op (with a warning) if unconfigured."""
    global _gateway
    api_key = os.getenv("AISSTREAM_API_KEY", "").strip()
    if not api_key:
        logger.warning("AISSTREAM_API_KEY not set -- live AIS vessel tracking is disabled.")
        return None
    _gateway = AISGateway(api_key)
    return _gateway.start()


async def stop_ais_gateway() -> None:
    if _gateway:
        await _gateway.stop()

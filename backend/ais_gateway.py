"""Persistent AISStream gateway for an asyncio/FastAPI backend.

Set AISSTREAM_API_KEY in the process environment.  Do not put the key in
this file or expose it to browser code.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

import websockets

# Change this import only if your project exposes its live-data store elsewhere.
from live_data import live_data

logger = logging.getLogger(__name__)

AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"
DEFAULT_BOXES = [
    [[20.0, 67.5], [24.8, 73.5]],  # Gujarat / Kandla
    [[14.0, 71.5], [20.5, 74.5]],  # Mumbai, Goa, Konkan
    [[7.0, 72.5], [14.5, 77.5]],   # Kerala coast
    [[7.0, 76.5], [14.5, 81.5]],   # Tamil Nadu / Palk Strait
    [[12.0, 79.5], [23.5, 90.5]],  # East coast
]

PUBLISH_INTERVAL_SECONDS = max(5, int(os.getenv("AIS_PUBLISH_INTERVAL_SECONDS", "10")))
STALE_AFTER_SECONDS = 30 * 60
RECONNECT_DELAY_SECONDS = 5


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bounding_boxes() -> list:
    """Read optional JSON boxes from AISSTREAM_BOUNDING_BOXES."""
    raw = os.getenv("AISSTREAM_BOUNDING_BOXES", "").strip()
    if not raw:
        return DEFAULT_BOXES
    try:
        boxes = json.loads(raw)
        if isinstance(boxes, list) and boxes:
            return boxes
    except json.JSONDecodeError:
        pass
    logger.warning("Invalid AISSTREAM_BOUNDING_BOXES; using defaults")
    return DEFAULT_BOXES


def _coordinates(message: dict[str, Any]) -> Optional[tuple[float, float]]:
    meta = message.get("MetaData") or {}
    report = (message.get("Message") or {}).get("PositionReport") or {}
    try:
        lat = float(report.get("Latitude", meta.get("Latitude")))
        lon = float(report.get("Longitude", meta.get("Longitude")))
    except (TypeError, ValueError):
        return None
    if -90 <= lat <= 90 and -180 <= lon <= 180 and (lat or lon):
        return lat, lon
    return None


class AISGateway:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.vessels: dict[str, dict[str, Any]] = {}
        self.task: Optional[asyncio.Task] = None
        self.last_publish = 0.0
        self.connected_since: Optional[str] = None
        self.last_message_at: Optional[str] = None
        self.last_disconnect_reason: Optional[str] = None

    def start(self) -> asyncio.Task:
        self.task = asyncio.create_task(self._run(), name="aisstream-gateway")
        return self.task

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

    def state(self) -> dict[str, Any]:
        return {
            "configured": True,
            "connected": self.connected_since is not None,
            "connected_since": self.connected_since,
            "last_message_at": self.last_message_at,
            "last_disconnect_reason": self.last_disconnect_reason,
        }

    async def _run(self) -> None:
        while True:
            try:
                await self._connect()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # network failures are expected; retry below
                self.last_disconnect_reason = str(exc) or type(exc).__name__
                logger.warning("AISStream disconnected: %s", exc)
            finally:
                self.connected_since = None
            await asyncio.sleep(RECONNECT_DELAY_SECONDS)

    async def _connect(self) -> None:
        async with websockets.connect(
            AISSTREAM_URL, ping_interval=20, ping_timeout=20, compression="deflate"
        ) as socket:
            await socket.send(json.dumps({
                "APIKey": self.api_key,
                "BoundingBoxes": _bounding_boxes(),
                "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
            }))
            self.connected_since = _now()
            self.last_message_at = None
            logger.info("AISStream gateway connected")

            async for raw in socket:
                self.last_message_at = _now()
                self._ingest(json.loads(raw))
                await self._publish_if_due()

    def _ingest(self, message: dict[str, Any]) -> None:
        coordinates = _coordinates(message)
        meta = message.get("MetaData") or {}
        mmsi = meta.get("MMSI")
        if coordinates is None or mmsi is None:
            return

        lat, lon = coordinates
        vessel_id = str(mmsi)
        report = (message.get("Message") or {}).get("PositionReport") or {}
        vessel = self.vessels.setdefault(vessel_id, {
            "id": vessel_id,
            "name": "Unnamed vessel",
            "type": "Vessel (AIS)",
            "owner": "AIS live feed (AISStream)",
        })
        vessel.update({"lat": lat, "lon": lon, "_last_seen": asyncio.get_running_loop().time()})
        if str(meta.get("ShipName") or "").strip():
            vessel["name"] = str(meta["ShipName"]).strip()
        if report.get("Sog") is not None:
            vessel["speed_knots"] = min(max(float(report["Sog"]), 0), 100)
        heading = report.get("TrueHeading", report.get("Cog"))
        if heading is not None and heading != 511:
            vessel["heading"] = float(heading) % 360

    async def _publish_if_due(self) -> None:
        now = asyncio.get_running_loop().time()
        if now - self.last_publish < PUBLISH_INTERVAL_SECONDS:
            return
        self.last_publish = now
        vessels = [
            {key: value for key, value in vessel.items() if not key.startswith("_")}
            for vessel in self.vessels.values()
            if now - vessel["_last_seen"] < STALE_AFTER_SECONDS
        ]
        if vessels:
            # Matches the store used by /api/live/vessels in the supplied backend.
            live_data.store.save("vessel", vessels, "AISStream live AIS feed", _now())


_gateway: Optional[AISGateway] = None


def start_ais_gateway() -> Optional[asyncio.Task]:
    """Start once from the application's lifespan startup hook."""
    global _gateway
    api_key = os.getenv("AISSTREAM_API_KEY", "").strip()
    if not api_key:
        logger.warning("AISSTREAM_API_KEY is not set; AIS gateway disabled")
        return None
    _gateway = AISGateway(api_key)
    return _gateway.start()


async def stop_ais_gateway() -> None:
    if _gateway:
        await _gateway.stop()


def get_gateway_state() -> dict[str, Any]:
    return _gateway.state() if _gateway else {"configured": False, "connected": False}

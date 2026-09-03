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
import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import websockets

from live_data import live_data

logger = logging.getLogger(__name__)

AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"

# Coastal subscription boxes cover the major Indian port approaches without
# sampling the entire Indian Ocean. Operators may override them with the JSON
# AIS_BOUNDING_BOXES environment variable.
DEFAULT_BOXES = [
    [[20.0, 67.5], [24.8, 73.5]],  # Gujarat / Kandla
    [[14.0, 71.5], [20.5, 74.5]],  # Mumbai, Goa, Konkan
    [[7.0, 72.5], [14.5, 77.5]],   # Kerala / Lakshadweep coast
    [[7.0, 76.5], [14.5, 81.5]],   # Tamil Nadu / Palk Strait
    [[12.0, 79.5], [23.5, 90.5]],  # Andhra, Odisha, Bengal
]
PORTS = [
    ("Kandla", "Kutch, Gujarat", 23.03, 70.22), ("Mumbai", "Mumbai, Maharashtra", 18.94, 72.84),
    ("Mormugao", "Goa", 15.42, 73.80), ("Kochi", "Ernakulam, Kerala", 9.97, 76.24),
    ("Vizhinjam", "Thiruvananthapuram, Kerala", 8.48, 76.91), ("Thoothukudi", "Thoothukudi, Tamil Nadu", 8.76, 78.16),
    ("Chennai", "Chennai, Tamil Nadu", 13.08, 80.29), ("Ennore", "Tiruvallur, Tamil Nadu", 13.22, 80.32),
    ("Visakhapatnam", "Visakhapatnam, Andhra Pradesh", 17.69, 83.30), ("Paradip", "Jagatsinghpur, Odisha", 20.27, 86.67),
    ("Haldia", "Purba Medinipur, West Bengal", 22.03, 88.06),
]

PUBLISH_INTERVAL_SECONDS = max(5, int(os.getenv("AIS_PUBLISH_INTERVAL_SECONDS", "20")))
RECONNECT_DELAY_SECONDS = 5
STALE_AFTER_SECONDS = 30 * 60  # drop a vessel from the published snapshot after 30 min silence

# AIS "navigational status" codes -> ORCA's free-text status field.
_NAV_STATUS = {
    0: "TRANSIT", 1: "ANCHORED", 2: "NOT UNDER COMMAND", 3: "RESTRICTED MANOEUVRABILITY",
    5: "MOORED", 7: "FISHING", 8: "TRANSIT",
}


def _bounding_boxes() -> list:
    raw = os.getenv("AISSTREAM_BOUNDING_BOXES", "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list) and parsed:
                return parsed
        except (ValueError, json.JSONDecodeError):
            logger.warning("Malformed AISSTREAM_BOUNDING_BOXES; using major-port coverage")
    return DEFAULT_BOXES


def _nm_between(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_nm = 3440.065
    a = math.sin(math.radians(lat2 - lat1) / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return radius_nm * 2 * math.asin(min(1, math.sqrt(a)))


def _enrich_position(lat: float, lon: float) -> Dict[str, Any]:
    port, district, port_lat, port_lon = min(PORTS, key=lambda item: _nm_between(lat, lon, item[2], item[3]))
    # Dataset-backed IMBL segments are used when present; offshore locations
    # outside either monitored border are reported as no monitored IMBL nearby.
    boundary_file = os.path.join(os.path.dirname(__file__), "..", "data", "imbl_boundaries.json")
    nearest = None
    try:
        with open(boundary_file) as source:
            for boundary in json.load(source).get("boundaries", []):
                for point_lat, point_lon in boundary.get("coordinates", []):
                    distance = _nm_between(lat, lon, point_lat, point_lon)
                    nearest = distance if nearest is None else min(nearest, distance)
    except (OSError, ValueError, TypeError):
        pass
    return {"zone": f"{port} Port · {district}", "district": district, "nearest_port": port,
            "imbl_dist_nm": round(nearest, 1) if nearest is not None else None}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AISGateway:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.bounding_boxes = _bounding_boxes()
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
            logger.info("AIS gateway connected (coverage boxes=%s)", self.bounding_boxes)

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
            "zone": "Location pending",
            "district": "Location pending",
            "imbl_dist_nm": None,
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
            ship_type = static.get("TypeAndCargoType")
            if ship_type is not None:
                entry["type"] = f"AIS ship type {ship_type}"

        try:
            entry.update(_enrich_position(float(entry["lat"]), float(entry["lon"])))
        except (TypeError, ValueError):
            entry["zone"] = "Position unavailable"

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

"""External-feed ingestion, validation, and durable snapshots for ORCA.

Providers are deliberately configured through environment variables: satellite
and AIS data normally require an account or an agreement with the provider.
No provider secret is exposed to the browser.
"""
import asyncio
import json
import logging
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import httpx
except ImportError:  # Allows the existing offline demo to start without extras.
    httpx = None

try:
    import websockets
except ImportError:  # Allows the existing offline demo to start without extras.
    websockets = None

logger = logging.getLogger(__name__)
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "orca_live.db"
TIMEOUT = float(os.getenv("EXTERNAL_FEED_TIMEOUT", "15"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LiveDataStore:
    def __init__(self) -> None:
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS snapshots (
                kind TEXT PRIMARY KEY, payload TEXT NOT NULL, source TEXT NOT NULL,
                observed_at TEXT, ingested_at TEXT NOT NULL, status TEXT NOT NULL
            )""")

    def save(self, kind: str, payload: Any, source: str, observed_at: Optional[str] = None, status: str = "LIVE") -> None:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("""INSERT INTO snapshots(kind,payload,source,observed_at,ingested_at,status)
                VALUES(?,?,?,?,?,?) ON CONFLICT(kind) DO UPDATE SET payload=excluded.payload,
                source=excluded.source,observed_at=excluded.observed_at,
                ingested_at=excluded.ingested_at,status=excluded.status""",
                (kind, json.dumps(payload), source, observed_at, _now(), status))

    def latest(self, kind: str) -> Optional[Dict[str, Any]]:
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute("SELECT payload,source,observed_at,ingested_at,status FROM snapshots WHERE kind=?", (kind,)).fetchone()
        if not row:
            return None
        return {"payload": json.loads(row[0]), "source": row[1], "observed_at": row[2], "ingested_at": row[3], "status": row[4]}


class ExternalFeedService:
    """Fetches JSON feeds with one documented, simple contract.

    Vessel feed: {"vessels": [...], "observed_at": "ISO-8601"}
    PFZ feed:    {"zones": [...], "observed_at": "ISO-8601"}
    Ocean feed:  {"sst_celsius": 28.1, "chlorophyll_mg_m3": 1.2,
                  "sst_gradient_c_per_km": 0.16, "cloud_cover_pct": 12,
                  "observed_at": "ISO-8601", "source": "..."}
    """
    def __init__(self) -> None:
        self.store = LiveDataStore()

    @staticmethod
    def _headers() -> Dict[str, str]:
        token = os.getenv("EXTERNAL_FEED_BEARER_TOKEN")
        return {"Authorization": f"Bearer {token}"} if token else {}

    async def _fetch(self, url: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if httpx is None:
            raise RuntimeError("httpx is not installed; run pip install -r requirements.txt")
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(url, params=params, headers=self._headers())
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, dict):
            raise ValueError("External feed must return a JSON object")
        return data

    async def refresh_kind(self, kind: str) -> Dict[str, Any]:
        url = os.getenv(f"ORCA_{kind.upper()}_FEED_URL", "").strip()
        if not url:
            if kind == "vessel":
                if os.getenv("AISSTREAM_API_KEY", "").strip():
                    return await self._refresh_aisstream_vessels()
                return self._save_demo_vessels("AISStream key is not configured")
            return {"kind": kind, "status": "NOT_CONFIGURED"}
        try:
            data = await self._fetch(url)
            key = "vessels" if kind == "vessel" else "zones"
            items = data.get(key)
            if not isinstance(items, list):
                raise ValueError(f"{kind} feed must contain a '{key}' list")
            self.store.save(kind, items, data.get("source", url), data.get("observed_at"))
            return {"kind": kind, "status": "LIVE", "count": len(items), "source": data.get("source", url)}
        except Exception as exc:
            logger.warning("%s feed refresh failed: %s", kind, exc)
            return {"kind": kind, "status": "UNAVAILABLE", "error": str(exc)}

    @staticmethod
    def _aisstream_boxes() -> list:
        """Return AISStream boxes, defaulting to waters around India."""
        raw = os.getenv("AISSTREAM_BOUNDING_BOXES", "").strip()
        if not raw:
            # Coastal boxes give AISStream a useful India-wide sample without
            # subscribing to an unnecessarily large ocean area.
            return [
                [[6.0, 68.0], [14.5, 77.0]],  # Kerala / Karnataka / Lakshadweep
                [[8.0, 77.0], [15.0, 81.5]],  # Tamil Nadu / Palk Strait
                [[14.0, 80.0], [22.5, 88.0]], # Andhra / Odisha / Bengal
                [[17.0, 68.0], [24.0, 74.5]], # Gujarat / Maharashtra
            ]
        parsed = json.loads(raw)
        if not isinstance(parsed, list) or not parsed:
            raise ValueError("AISSTREAM_BOUNDING_BOXES must be a non-empty JSON list")
        return parsed

    def _save_demo_vessels(self, reason: str) -> Dict[str, Any]:
        """Keep the clearly-labelled bundled fleet visible between AIS runs."""
        try:
            source = DATA_DIR / "data" / "simulated_vessels.json"
            payload = json.loads(source.read_text()).get("vessels", [])
            if not isinstance(payload, list) or not payload:
                raise ValueError("bundled vessel list is empty")
            self.store.save("vessel", payload, f"Bundled demo vessels — {reason}", _now(), "DEMO")
            return {"kind": "vessel", "status": "DEMO", "count": len(payload), "source": "Bundled demo vessels"}
        except Exception as exc:
            logger.warning("Could not load demo vessel fallback: %s", exc)
            return {"kind": "vessel", "status": "UNAVAILABLE", "error": str(exc)}

    async def _refresh_aisstream_vessels(self) -> Dict[str, Any]:
        """Collect a short, authenticated AISStream sample and save it locally.

        The API key never leaves the backend; the browser only receives the
        normalised vessel snapshot returned by /api/live/vessels.
        """
        api_key = os.getenv("AISSTREAM_API_KEY", "").strip()
        if not api_key:
            return {"kind": "vessel", "status": "NOT_CONFIGURED"}
        if websockets is None:
            return {"kind": "vessel", "status": "UNAVAILABLE", "error": "websockets package is unavailable"}

        seconds = max(3, min(60, int(os.getenv("AISSTREAM_COLLECTION_SECONDS", "12"))))
        subscription = {
            "APIKey": api_key,
            "BoundingBoxes": self._aisstream_boxes(),
            "FilterMessageTypes": [
                "PositionReport", "StandardClassBPositionReport",
                "ExtendedClassBPositionReport", "LongRangeAisBroadcastMessage",
            ],
        }
        vessels: Dict[str, Dict[str, Any]] = {}
        try:
            async with websockets.connect("wss://stream.aisstream.io/v0/stream", open_timeout=10) as socket:
                await socket.send(json.dumps(subscription))
                deadline = asyncio.get_running_loop().time() + seconds
                while asyncio.get_running_loop().time() < deadline:
                    remaining = deadline - asyncio.get_running_loop().time()
                    try:
                        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=remaining))
                    except asyncio.TimeoutError:
                        break
                    metadata = message.get("MetaData") or message.get("Metadata") or {}
                    body = message.get("Message") or {}
                    position = next((item for item in body.values() if isinstance(item, dict)), {})
                    lat = metadata.get("Latitude", position.get("Latitude"))
                    lon = metadata.get("Longitude", position.get("Longitude"))
                    mmsi = metadata.get("MMSI") or position.get("UserID")
                    if lat is None or lon is None or mmsi is None:
                        continue
                    try:
                        lat, lon = float(lat), float(lon)
                    except (TypeError, ValueError):
                        continue
                    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                        continue
                    vessel_id = str(mmsi)
                    vessels[vessel_id] = {
                        "id": vessel_id,
                        "name": metadata.get("ShipName") or f"MMSI {vessel_id}",
                        "lat": lat, "lon": lon,
                        "speed_knots": position.get("Sog") or 0,
                        "heading": position.get("Cog") or position.get("TrueHeading") or 0,
                        "status": "ACTIVE",
                        "type": metadata.get("ShipType") or "AIS vessel",
                        "zone": "AIS live feed", "owner": "AIS broadcast",
                    }
            payload = list(vessels.values())
            if not payload:
                return self._save_demo_vessels("AISStream returned no vessels in the current coastal sample")
            self.store.save("vessel", payload, "AISStream live AIS", _now())
            return {"kind": "vessel", "status": "LIVE", "count": len(payload), "source": "AISStream live AIS"}
        except Exception as exc:
            logger.warning("AISStream vessel refresh failed: %s", exc)
            return self._save_demo_vessels("AISStream connection is temporarily unavailable")

    async def ocean_at(self, lat: float, lon: float) -> Optional[Dict[str, Any]]:
        url = os.getenv("ORCA_OCEAN_FEED_URL", "").strip()
        if not url:
            return None
        try:
            data = await self._fetch(url, {"lat": lat, "lon": lon})
            required = ("sst_celsius", "chlorophyll_mg_m3")
            if any(data.get(field) is None for field in required):
                raise ValueError("ocean feed must include sst_celsius and chlorophyll_mg_m3")
            self.store.save("ocean", data, data.get("source", url), data.get("observed_at"))
            return data
        except Exception as exc:
            logger.warning("ocean feed refresh failed: %s", exc)
            return None

    async def refresh_all(self) -> List[Dict[str, Any]]:
        return await asyncio.gather(self.refresh_kind("vessel"), self.refresh_kind("pfz"))

    def status(self) -> Dict[str, Any]:
        return {kind: self.store.latest(kind) for kind in ("ocean", "vessel", "pfz")}


live_data = ExternalFeedService()

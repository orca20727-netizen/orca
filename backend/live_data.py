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

    def save(self, kind: str, payload: Any, source: str, observed_at: Optional[str] = None) -> None:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("""INSERT INTO snapshots(kind,payload,source,observed_at,ingested_at,status)
                VALUES(?,?,?,?,?,?) ON CONFLICT(kind) DO UPDATE SET payload=excluded.payload,
                source=excluded.source,observed_at=excluded.observed_at,
                ingested_at=excluded.ingested_at,status=excluded.status""",
                (kind, json.dumps(payload), source, observed_at, _now(), "LIVE"))

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

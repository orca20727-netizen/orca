"""Proactive, in-app marine hazard alerts with durable deduplication."""
import asyncio
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from agents.weather_agent import WeatherHazardAgent

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "orca_live.db"
WAVE_ALERT_M = float(os.getenv("HAZARD_WAVE_ALERT_M", "2.5"))
WIND_ALERT_KNOTS = float(os.getenv("HAZARD_WIND_ALERT_KNOTS", "25"))
LIGHTNING_ALERT_PCT = float(os.getenv("HAZARD_LIGHTNING_ALERT_PCT", "50"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AlertStore:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self.db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT UNIQUE NOT NULL,
                severity TEXT NOT NULL, alert_type TEXT NOT NULL, location_id TEXT,
                title TEXT NOT NULL, message TEXT NOT NULL, data_source TEXT NOT NULL,
                details TEXT NOT NULL, created_at TEXT NOT NULL
            )""")

    def create(self, alert: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            try:
                cursor = conn.execute(
                    """INSERT INTO alerts(event_key,severity,alert_type,location_id,title,message,data_source,details,created_at)
                    VALUES(?,?,?,?,?,?,?,?,?)""",
                    (alert["event_key"], alert["severity"], alert["alert_type"], alert.get("location_id"),
                     alert["title"], alert["message"], json.dumps(alert["data_source"]),
                     json.dumps(alert["details"]), alert["created_at"]),
                )
            except sqlite3.IntegrityError:
                return None
        return {**alert, "id": cursor.lastrowid}

    def list(self, limit: int = 100) -> List[Dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute("""SELECT id,event_key,severity,alert_type,location_id,title,message,data_source,details,created_at
                FROM alerts ORDER BY id DESC LIMIT ?""", (limit,)).fetchall()
        keys = ("id", "event_key", "severity", "alert_type", "location_id", "title", "message", "data_source", "details", "created_at")
        return [{**dict(zip(keys, row)), "data_source": json.loads(row[7]), "details": json.loads(row[8])} for row in rows]


class AlertService:
    def __init__(self, store: Optional[AlertStore] = None, weather_agent: Optional[WeatherHazardAgent] = None) -> None:
        self.store = store or AlertStore()
        self.weather_agent = weather_agent or WeatherHazardAgent()
        self._subscribers: set[asyncio.Queue] = set()

    @staticmethod
    def _hazard_alerts(location: Dict[str, Any], weather: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
        checks = [
            ("HIGH_WAVES", weather.get("significant_wave_height_m", 0), WAVE_ALERT_M, "m", "WARNING"),
            ("HIGH_WIND", weather.get("surface_wind_knots", 0), WIND_ALERT_KNOTS, "kn", "WARNING"),
            ("LIGHTNING_RISK", weather.get("lightning_risk_pct", 0), LIGHTNING_ALERT_PCT, "%", "CRITICAL"),
        ]
        for kind, value, threshold, unit, severity in checks:
            if float(value or 0) >= threshold:
                name = location.get("name", location["id"])
                yield {
                    # One active condition per type/location prevents a new
                    # notification every refresh while a storm persists.
                    "event_key": f"{kind}:{location['id']}", "severity": severity,
                    "alert_type": kind, "location_id": location["id"],
                    "title": f"{kind.replace('_', ' ').title()} near {name}",
                    "message": f"{value}{unit} exceeds the configured {threshold}{unit} threshold. Review sea conditions before departure.",
                    "data_source": weather.get("data_source", "SIMULATED_FALLBACK"),
                    "details": {"observed_value": value, "threshold": threshold, "weather": weather}, "created_at": _now(),
                }

    @staticmethod
    def _cyclone_alerts(bulletins: Iterable[Dict[str, Any]]) -> Iterable[Dict[str, Any]]:
        for bulletin in bulletins:
            text = f"{bulletin.get('title', '')} {bulletin.get('summary', '')}".lower()
            if "cyclone" not in text:
                continue
            severity = bulletin.get("severity", "WARNING")
            if severity not in {"WARNING", "CRITICAL"}:
                severity = "WARNING"
            yield {
                "event_key": f"CYCLONE_BULLETIN:{bulletin.get('id', bulletin.get('title'))}", "severity": severity,
                "alert_type": "CYCLONE_BULLETIN", "location_id": bulletin.get("region"),
                "title": bulletin.get("title", "Cyclone bulletin"), "message": bulletin.get("summary", "Cyclone bulletin issued."),
                "data_source": {"tier": "STATIC_BULLETIN", "source": bulletin.get("source", "Bundled bulletin")},
                "details": {"bulletin_id": bulletin.get("id"), "valid_until": bulletin.get("valid_until")}, "created_at": _now(),
            }

    async def evaluate(self, harbours: Iterable[Dict[str, Any]], bulletins: Iterable[Dict[str, Any]], weather_by_harbour: Optional[Dict[str, Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
        """Create alerts only when a threshold is crossed; duplicate events stay suppressed."""
        created: List[Dict[str, Any]] = []
        harbour_list = list(harbours)
        supplied = weather_by_harbour or {}
        missing = [harbour for harbour in harbour_list if harbour["id"] not in supplied]
        fetched = await asyncio.gather(*(
            self.weather_agent.evaluate_hazard(*harbour["coordinates"]) for harbour in missing
        ))
        weather_for = {**supplied, **{harbour["id"]: weather for harbour, weather in zip(missing, fetched)}}
        for harbour in harbour_list:
            weather = weather_for[harbour["id"]]
            for candidate in self._hazard_alerts(harbour, weather):
                saved = self.store.create(candidate)
                if saved:
                    created.append(saved)
        for candidate in self._cyclone_alerts(bulletins):
            saved = self.store.create(candidate)
            if saved:
                created.append(saved)
        for alert in created:
            for queue in list(self._subscribers):
                queue.put_nowait(alert)
        return created

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)


alert_service = AlertService()

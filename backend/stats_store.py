"""
ORCA Stats Ledger.

Persistent, continuously-growing record of every reading this website's
own agents have produced (weather, satellite/ocean, PFZ ranking, fleet,
ETA) plus every advisory query served. This is the data the on-site AI
(backend/agents/synthesis_agent.py) reasons over -- there is no external
AI/LLM API call anywhere in this system any more; every answer is built
from (a) the live reading collected for this request and (b) the
accumulated history recorded here by the site's own features.

Storage: a local SQLite file (stdlib `sqlite3`, zero new dependencies).
One row per numeric metric per agent reading, plus a query log. Bounded
by an overall row cap so a long-running instance can't grow the file
without limit.

If ORCA_STATS_DB_PATH points at a Railway volume mount (e.g. /data/...),
the ledger survives redeploys and restarts, not just the current
container's uptime -- set that env var to a path under the mounted
volume for true continuous, permanent accumulation. Without it, this
still accumulates correctly for as long as the current instance runs;
it just resets on the next deploy.
"""

import os
import sqlite3
import threading
import time
from typing import Any, Dict, List, Optional

DB_PATH = os.getenv(
    "ORCA_STATS_DB_PATH",
    os.path.join(os.path.dirname(__file__), "data", "orca_stats.db"),
)

# Hard cap on total stored readings so an instance that runs for months
# can't grow the ledger file without bound. Pruned opportunistically on
# write, well before this becomes a real disk concern.
MAX_TOTAL_READINGS = 100_000
PRUNE_BATCH = 5_000

_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recorded_at REAL NOT NULL,
            agent TEXT NOT NULL,
            zone_id TEXT,
            metric TEXT NOT NULL,
            value REAL NOT NULL
        )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_readings_metric ON readings(metric, recorded_at)")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS query_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recorded_at REAL NOT NULL,
            intent TEXT,
            language TEXT,
            query TEXT
        )"""
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_query_intent ON query_log(intent, recorded_at)")
    conn.commit()
    return conn


class StatsStore:
    """Thread-safe wrapper around the SQLite ledger. One process-wide
    instance (`stats_store`, below) is shared by core.py's pipeline
    (writes) and synthesis_agent.py (reads for trend comparisons)."""

    def __init__(self):
        self._conn = _connect()

    def record_reading(self, agent: str, zone_id: Optional[str], metrics: Dict[str, Any]) -> None:
        """Append one row per numeric metric in `metrics`. Non-numeric or
        missing values are silently skipped -- there's nothing useful to
        average over a status string or a None."""
        ts = time.time()
        rows = [
            (ts, agent, zone_id, key, float(val))
            for key, val in metrics.items()
            if isinstance(val, (int, float)) and not isinstance(val, bool)
        ]
        if not rows:
            return
        with _lock:
            self._conn.executemany(
                "INSERT INTO readings (recorded_at, agent, zone_id, metric, value) VALUES (?,?,?,?,?)",
                rows,
            )
            self._conn.commit()
            self._prune_if_needed()

    def record_query(self, intent: str, language: str, query: str) -> None:
        with _lock:
            self._conn.execute(
                "INSERT INTO query_log (recorded_at, intent, language, query) VALUES (?,?,?,?)",
                (time.time(), intent, language, (query or "")[:500]),
            )
            self._conn.commit()

    def _prune_if_needed(self) -> None:
        """Caller already holds `_lock`. Deletes the oldest rows once the
        table exceeds MAX_TOTAL_READINGS, in one batch rather than on
        every single insert."""
        count = self._conn.execute("SELECT COUNT(*) FROM readings").fetchone()[0]
        if count <= MAX_TOTAL_READINGS:
            return
        self._conn.execute(
            "DELETE FROM readings WHERE id IN ("
            "SELECT id FROM readings ORDER BY recorded_at ASC LIMIT ?)",
            (PRUNE_BATCH,),
        )
        self._conn.commit()

    def trend(self, metric: str, agent: Optional[str] = None, hours: float = 24, limit: int = 200) -> Dict[str, Any]:
        """Summary stats for one metric over the last `hours` (default a
        rolling day), most-recent-first. Returns {"count": 0} when there
        isn't enough accumulated history yet to say anything meaningful --
        callers treat that as "stay silent", never as an error."""
        cutoff = time.time() - hours * 3600
        query = "SELECT value FROM readings WHERE metric=? AND recorded_at>=?"
        params: List[Any] = [metric, cutoff]
        if agent:
            query += " AND agent=?"
            params.append(agent)
        query += " ORDER BY recorded_at DESC LIMIT ?"
        params.append(limit)
        with _lock:
            values = [r[0] for r in self._conn.execute(query, params).fetchall()]
        if not values:
        return {"count": 0}
        return {
            "count": len(values),
            "latest": values[0],
            "avg": sum(values) / len(values),
            "min": min(values),
            "max": max(values),
            "window_hours": hours,
        }

    def total_reading_count(self) -> int:
        with _lock:
            return self._conn.execute("SELECT COUNT(*) FROM readings").fetchone()[0]

    def total_query_count(self) -> int:
        with _lock:
            return self._conn.execute("SELECT COUNT(*) FROM query_log").fetchone()[0]

    def popular_intents(self, limit: int = 5) -> List[Dict[str, Any]]:
        with _lock:
            rows = self._conn.execute(
                "SELECT intent, COUNT(*) c FROM query_log GROUP BY intent ORDER BY c DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [{"intent": r[0], "count": r[1]} for r in rows]


# Single process-wide instance -- every agent call and every synthesis
# call shares the same ledger, so trends reflect the whole site's
# activity, not just one request's session.
stats_store = StatsStore()

"""
Live fish market price feed -- Agmarknet (data.gov.in), for the ORCA
Fisherman module's five tracked species (Tuna, Pomfret, Sardine, Mackerel,
Kingfish).

Follows the exact same is_configured()/graceful-no-op pattern already used
by copernicus_marine_feed.py and imd_marine_feed.py: unconfigured (or any
upstream failure) never raises and never fabricates a price. The honesty
contract this module guarantees to its caller (fisherman_agent.py):

    1. LIVE_AGMARKNET   -- a real, current mandi price was fetched just now.
    2. STORED_SNAPSHOT  -- upstream failed/timed out, but we have an earlier
                            real reading (from this module) still within
                            STORED_SNAPSHOT_MAX_AGE_DAYS. Never silently
                            relabelled as live.
    3. (no entry)        -- neither of the above exists. The caller (which
                            already carries its own simulated defaults) is
                            responsible for falling back to that, tagged
                            SIMULATED_DEMO -- this module never returns a
                            fabricated number itself.

Known, documented real-world limitation (do not "fix" by inventing data):
Agmarknet/data.gov.in's "Variety-wise Daily Market Prices" dataset is
sourced from APMC mandis, which overwhelmingly trade agricultural produce,
not fish -- most Indian fish markets are informal/auction-based and don't
report into this system. In practice this means most species, most days,
will have NO matching mandi record, and this module will correctly return
nothing for them rather than pretend otherwise. This is expected behavior,
not a bug -- see README/STEP notes from the original Fisherman live-data
migration plan, which flagged this same limitation before any code existed.

Required env vars (see .env.example) -- free registration at data.gov.in:
    FISHERMAN_MARKET_API_KEY
    FISHERMAN_MARKET_RESOURCE_ID   (defaults to the public "Variety-wise
                                     Daily Market Prices Data of Commodity"
                                     resource; override if data.gov.in ever
                                     changes/replaces it)
"""

import logging
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import httpx
except ImportError:  # pragma: no cover - mirrors live_data.py's own guard
    httpx = None

from live_data import live_data, DB_PATH as LIVE_DATA_DB_PATH

logger = logging.getLogger(__name__)

API_BASE_URL = "https://api.data.gov.in/resource"
DEFAULT_RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"
TIMEOUT = float(os.getenv("FISHERMAN_MARKET_TIMEOUT", "12"))
STORED_SNAPSHOT_MAX_AGE_DAYS = 14

# Agmarknet's own commodity vocabulary is whatever a mandi typed at
# arrival time -- there is no guarantee any of these literally appear.
# Every candidate is tried per species; the first commodity that returns
# at least one row wins. Kept intentionally short/plain (not "Kingfish
# (Seer)") since Agmarknet commodity fields are exact-match, not
# full-text search, in practice.
SPECIES_TO_COMMODITY_CANDIDATES: Dict[str, List[str]] = {
    "Tuna": ["Tuna", "Fish"],
    "Pomfret": ["Pomfret", "Fish"],
    "Sardine": ["Sardine", "Fish"],
    "Mackerel": ["Mackerel", "Fish"],
    "Kingfish": ["Seer Fish", "Kingfish", "Fish"],
}


def is_configured() -> bool:
    return bool(os.getenv("FISHERMAN_MARKET_API_KEY", "").strip())


def _resource_id() -> str:
    return os.getenv("FISHERMAN_MARKET_RESOURCE_ID", "").strip() or DEFAULT_RESOURCE_ID


async def _fetch_commodity(client: "httpx.AsyncClient", api_key: str, commodity: str) -> Optional[Dict[str, Any]]:
    """One data.gov.in query for one commodity name. Returns the most
    recent matching mandi record, or None if the query errored or matched
    nothing -- never raises."""
    try:
        resp = await client.get(
            f"{API_BASE_URL}/{_resource_id()}",
            params={
                "api-key": api_key,
                "format": "json",
                "limit": 20,
                "filters[commodity]": commodity,
            },
        )
        resp.raise_for_status()
        body = resp.json()
    except Exception as exc:
        logger.info("Agmarknet query for commodity=%r failed: %s", commodity, exc)
        return None

    records = body.get("records") if isinstance(body, dict) else None
    if not records:
        return None

    def _arrival_key(rec: Dict[str, Any]) -> str:
        return rec.get("arrival_date", "") or ""

    records = sorted(records, key=_arrival_key, reverse=True)
    return records[0]


def _parse_price(record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Agmarknet reports min/modal/max price PER QUINTAL (100 kg), not per
    kg -- must divide by 100 before this is comparable to this app's
    existing per-kg prices. Returns None if the record's price fields
    aren't usable numbers (never guesses/fabricates a number)."""
    try:
        modal_per_quintal = float(record.get("modal_price"))
        min_per_quintal = float(record.get("min_price"))
        max_per_quintal = float(record.get("max_price"))
    except (TypeError, ValueError):
        return None
    if modal_per_quintal <= 0:
        return None
    return {
        "price_per_kg": round(modal_per_quintal / 100.0, 2),
        "min_price_per_kg": round(min_per_quintal / 100.0, 2),
        "max_price_per_kg": round(max_per_quintal / 100.0, 2),
        "market": record.get("market"),
        "state": record.get("state"),
        "district": record.get("district"),
        "arrival_date": record.get("arrival_date"),
        "commodity_matched": record.get("commodity"),
    }


async def _live_price_for(client: "httpx.AsyncClient", api_key: str, species: str) -> Optional[Dict[str, Any]]:
    for candidate in SPECIES_TO_COMMODITY_CANDIDATES.get(species, [species]):
        record = await _fetch_commodity(client, api_key, candidate)
        if record:
            parsed = _parse_price(record)
            if parsed:
                return parsed
    return None


def _stored_snapshot_kind(species: str) -> str:
    return f"fisherman_market:{species}"


# --- Real daily price history, for price_trend.py's 7-day/30-day calc ---
# live_data.LiveDataStore's `snapshots` table is single-row-per-kind (an
# upsert), so it can't hold a time series -- this is a separate table, in
# the SAME database file (reusing the existing DB, not new infrastructure),
# storing one row per (species, calendar day) so the trend calculation
# always reflects real observed prices, never a backfilled/estimated one.
# Deliberately NEVER called for SIMULATED_DEMO prices -- a flat, unchanging
# simulated number would otherwise produce a fake "0% trend" instead of the
# honest "insufficient data" the trend endpoint is supposed to show.
def _init_history_db() -> None:
    with sqlite3.connect(LIVE_DATA_DB_PATH) as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS fisherman_price_history (
            species TEXT NOT NULL, day TEXT NOT NULL, price_per_kg REAL NOT NULL,
            source TEXT NOT NULL, observed_at TEXT NOT NULL,
            PRIMARY KEY (species, day)
        )""")


_init_history_db()


def _record_price_history(species: str, price_per_kg: float, source: str, observed_at: str) -> None:
    day = observed_at[:10]  # ISO date portion, e.g. "2026-09-15"
    try:
        with sqlite3.connect(LIVE_DATA_DB_PATH) as conn:
            conn.execute(
                """INSERT INTO fisherman_price_history(species, day, price_per_kg, source, observed_at)
                   VALUES (?,?,?,?,?)
                   ON CONFLICT(species, day) DO UPDATE SET
                     price_per_kg=excluded.price_per_kg, source=excluded.source, observed_at=excluded.observed_at""",
                (species, day, price_per_kg, source, observed_at),
            )
    except Exception as exc:
        logger.warning("market_price_service: failed to record price history for %s: %s", species, exc)


def get_price_history(species: str, days: int = 30) -> List[Dict[str, Any]]:
    """Real observed daily prices for one species, most recent last. Never
    fabricated/interpolated -- a day with no real reading is simply absent,
    not filled in."""
    with sqlite3.connect(LIVE_DATA_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT day, price_per_kg, source FROM fisherman_price_history WHERE species=? ORDER BY day DESC LIMIT ?",
            (species, days),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


def _stale(observed_at: Optional[str]) -> bool:
    if not observed_at:
        return True
    try:
        observed = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
    except ValueError:
        return True
    age_days = (datetime.now(timezone.utc) - observed).total_seconds() / 86400.0
    return age_days > STORED_SNAPSHOT_MAX_AGE_DAYS


async def get_live_market_overrides(species_list: List[str]) -> Dict[str, Dict[str, Any]]:
    """Returns {species: {price_per_kg, source, ...}} only for species with
    a real (live-just-now or recent-stored) price. Species with neither are
    simply absent from the returned dict -- the caller keeps its own
    simulated default for those, tagged accordingly. Never raises."""
    overrides: Dict[str, Dict[str, Any]] = {}

    if not is_configured():
        return overrides
    if httpx is None:
        logger.warning("market_price_service: httpx not installed, skipping live fetch")
        return overrides

    api_key = os.getenv("FISHERMAN_MARKET_API_KEY").strip()

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            for species in species_list:
                live = await _live_price_for(client, api_key, species)
                if live:
                    now_iso = datetime.now(timezone.utc).isoformat()
                    overrides[species] = {**live, "source": "LIVE_AGMARKNET", "observed_at": now_iso}
                    live_data.store.save(_stored_snapshot_kind(species), live, "LIVE_AGMARKNET", now_iso)
                    _record_price_history(species, live["price_per_kg"], "LIVE_AGMARKNET", now_iso)
    except Exception as exc:
        logger.warning("market_price_service: live fetch pass failed entirely: %s", exc)

    # For any species that didn't get a live price this call, fall back to
    # our own most recent stored real reading (if not too stale) before
    # giving up and letting the caller use its simulated default.
    for species in species_list:
        if species in overrides:
            continue
        snapshot = live_data.store.latest(_stored_snapshot_kind(species))
        if snapshot and not _stale(snapshot.get("observed_at")):
            overrides[species] = {**snapshot["payload"], "source": "STORED_SNAPSHOT", "observed_at": snapshot.get("observed_at")}

    return overrides

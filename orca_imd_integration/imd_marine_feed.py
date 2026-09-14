"""India Meteorological Department (IMD) marine hazard bulletins -- Sea Area
Bulletin, Coastal Bulletin and Cyclone Track, used as a LIVE supplement to
AlertService's bundled bulletins.json sample data (see alert_service.py /
live_scheduler.py). Static bundled bulletins keep working exactly as before
either way -- this only adds a second, live source alongside them.

## Configuration
Set IMD_API_KEY to a key from a FREE account created at
https://api.imd.gov.in (IMD's own API portal: "Create Account", then
generate a key from the subscriptions/developer page). Claude cannot create
this account -- it's a real government registration, same as Copernicus
Marine's account requirement in copernicus_marine_feed.py.

Not configured (or httpx missing) -> every function here is a clean no-op
(returns an empty list) and AlertService keeps using only the bundled
static bulletins, exactly like every other optional live feed in this app:
a missing key degrades gracefully, it never crashes.

## Auth -- IMPORTANT CAVEAT
IMD's public documentation names the endpoints below but does not publish
the exact header/scheme its API gateway expects for the key. Rather than
guess and hardcode something that might be wrong, this is configurable:
  IMD_API_KEY_HEADER  (default "X-API-KEY")
  IMD_API_KEY_SCHEME  (optional value prefix, e.g. "Bearer " -- default:
                       no prefix, the raw key is sent as-is)
Once a real account exists, the first live call's response (401/403 body,
or success) will show whether these defaults are right; adjust the two env
vars if not -- no code change needed either way.

## Endpoints (documented at https://api.imd.gov.in)
- Sea Area Bulletin:  {IMD_API_BASE}/seabulletin
- Coastal Bulletin:   {IMD_API_BASE}/coastalbulletin
- Cyclone Track:      {IMD_API_BASE}/cyclone_track
(Cyclone Wind Warning and the Fishermen/Port Warning products exist too but
return GeoJSON polygon warning-zones rather than bulletin text, which needs
a different, geometry-aware consumer than AlertService's text-bulletin
pipeline -- left out of this first pass rather than half-supported.)

## Response shape -- also unconfirmed
IMD doesn't publish a sample payload for these, so _normalize_bulletin()
below is deliberately tolerant: it tries several plausible field names
(title/headline/bulletin_title, description/text/message/details,
region/state/district/area, severity/warning_level/color_code,
valid_upto/valid_until/expiry) and skips any record it can't extract a
usable title/message from, rather than raising or emitting a blank alert.
If real bulletins come through looking sparse once configured, that's the
first thing to adjust -- not a sign the integration itself is broken.
"""
import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

IMD_API_BASE = os.getenv("IMD_API_BASE", "https://api.imd.gov.in/api/v1").rstrip("/")
IMD_API_KEY_HEADER = os.getenv("IMD_API_KEY_HEADER", "X-API-KEY")
IMD_API_KEY_SCHEME = os.getenv("IMD_API_KEY_SCHEME", "")
IMD_TIMEOUT = float(os.getenv("IMD_API_TIMEOUT", "10"))

# alert_type -> endpoint path. alert_type feeds straight into AlertService's
# event_key/alert_type fields, so keep these aligned with the naming
# convention already used there (HIGH_WAVES, CYCLONE_BULLETIN, etc.).
ENDPOINTS = {
    "SEA_AREA_BULLETIN": "seabulletin",
    "COASTAL_BULLETIN": "coastalbulletin",
    "CYCLONE_BULLETIN": "cyclone_track",
}

SOURCE_LABEL = "India Meteorological Department (api.imd.gov.in)"

_SEVERITY_MAP = {
    "red": "CRITICAL", "critical": "CRITICAL", "severe": "CRITICAL",
    "orange": "WARNING", "warning": "WARNING",
    "yellow": "ADVISORY", "advisory": "ADVISORY", "info": "ADVISORY", "green": "ADVISORY",
}


def is_configured() -> bool:
    return bool(os.getenv("IMD_API_KEY")) and httpx is not None


def _headers() -> Dict[str, str]:
    key = os.getenv("IMD_API_KEY", "")
    return {IMD_API_KEY_HEADER: f"{IMD_API_KEY_SCHEME}{key}", "Accept": "application/json"}


def _as_list(payload: Any) -> List[Dict[str, Any]]:
    """Accept a bare JSON list or a common {"data"/"results"/"bulletins"/
    "records"/"items": [...]} wrapper -- IMD's docs don't show which."""
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("data", "results", "bulletins", "records", "items"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []


def _first(item: Dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = item.get(key)
        if value not in (None, ""):
            return str(value)
    return None


def _normalize_severity(item: Dict[str, Any]) -> str:
    raw = (_first(item, "severity", "warning_level", "color_code", "colour_code") or "").strip().lower()
    return _SEVERITY_MAP.get(raw, "WARNING")


def _normalize_bulletin(alert_type: str, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    title = _first(item, "title", "headline", "bulletin_title", "warning_title")
    message = _first(item, "description", "text", "message", "details", "forecast", "bulletin_text")
    if not title and not message:
        return None  # Nothing usable in this record -- skip it rather than emit a blank alert.
    identifier = _first(item, "id", "bulletin_id", "warning_id", "code") or title or message
    return {
        "id": identifier,
        "alert_type": alert_type,
        "severity": _normalize_severity(item),
        "region": _first(item, "region", "state", "district", "area", "location"),
        "title": title or f"IMD {alert_type.replace('_', ' ').title()}",
        "message": message or title,
        "valid_until": _first(item, "valid_upto", "valid_until", "expiry", "date_to"),
        "source": SOURCE_LABEL,
    }


async def _fetch_endpoint(client: "httpx.AsyncClient", alert_type: str, path: str) -> List[Dict[str, Any]]:
    try:
        response = await client.get(f"{IMD_API_BASE}/{path}", headers=_headers())
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        logger.warning("IMD %s fetch failed: %s", path, exc)
        return []
    return [
        normalized
        for item in _as_list(payload)
        if (normalized := _normalize_bulletin(alert_type, item)) is not None
    ]


async def fetch_hazard_bulletins() -> List[Dict[str, Any]]:
    """Live Sea Area + Coastal + Cyclone Track bulletins from IMD's official
    API, normalized for AlertService._hazard_bulletin_alerts(). Returns []
    (never raises) if not configured, if httpx isn't installed, or if every
    endpoint fails -- treat that exactly like "no live bulletins right
    now", the same way a missing/failed feed degrades everywhere else in
    this app."""
    if not is_configured():
        return []
    try:
        async with httpx.AsyncClient(timeout=IMD_TIMEOUT) as client:
            results = await asyncio.gather(
                *(_fetch_endpoint(client, alert_type, path) for alert_type, path in ENDPOINTS.items())
            )
    except Exception as exc:
        logger.warning("IMD bulletin fetch failed: %s", exc)
        return []
    return [bulletin for group in results for bulletin in group]

"""
Real price-trend calculation for the Fisherman module (Priority 3).

Computed entirely from market_price_service.py's own daily history table --
never from the static simulated dataset, and never interpolated/backfilled.
A species with fewer than 2 real observed days explicitly reports
insufficient data rather than a fabricated trend.
"""

from datetime import date, timedelta
from typing import Any, Dict, List

import market_price_service

MIN_POINTS_FOR_TREND = 2


def _pct_change(old: float, new: float) -> float:
    if not old:
        return 0.0
    return round((new - old) / old * 100.0, 1)


def _direction(pct: float) -> str:
    if pct > 1.0:
        return "rising"
    if pct < -1.0:
        return "falling"
    return "stable"


def compute_price_trend(species: str) -> Dict[str, Any]:
    history: List[Dict[str, Any]] = market_price_service.get_price_history(species, days=30)

    if len(history) < MIN_POINTS_FOR_TREND:
        return {
            "species": species,
            "status": "INSUFFICIENT_DATA",
            "reason": f"Only {len(history)} real observed day(s) on file -- need at least {MIN_POINTS_FOR_TREND} to compute a trend.",
            "classification": "CALCULATED",
        }

    latest = history[-1]
    previous = history[-2]
    current_price = latest["price_per_kg"]
    prev_price = previous["price_per_kg"]
    change_pct = _pct_change(prev_price, current_price)

    result: Dict[str, Any] = {
        "species": species,
        "status": "OK",
        "classification": "CALCULATED",
        "current_price_per_kg": current_price,
        "current_observed_day": latest["day"],
        "previous_price_per_kg": prev_price,
        "previous_observed_day": previous["day"],
        "change_pct": change_pct,
        "direction": _direction(change_pct),
        "observed_days_on_file": len(history),
    }

    last_7 = [h for h in history if h["day"] >= _n_days_ago_str(latest["day"], 7)]
    if len(last_7) >= MIN_POINTS_FOR_TREND:
        pct_7d = _pct_change(last_7[0]["price_per_kg"], last_7[-1]["price_per_kg"])
        result["trend_7d"] = {"change_pct": pct_7d, "direction": _direction(pct_7d), "points": len(last_7)}
    else:
        result["trend_7d"] = {"status": "INSUFFICIENT_DATA", "points": len(last_7)}

    last_30 = history  # already capped at 30 days by get_price_history
    if len(last_30) >= MIN_POINTS_FOR_TREND:
        pct_30d = _pct_change(last_30[0]["price_per_kg"], last_30[-1]["price_per_kg"])
        result["trend_30d"] = {"change_pct": pct_30d, "direction": _direction(pct_30d), "points": len(last_30)}
    else:
        result["trend_30d"] = {"status": "INSUFFICIENT_DATA", "points": len(last_30)}

    return result


def _n_days_ago_str(from_day: str, n: int) -> str:
    """from_day is an ISO date string ('YYYY-MM-DD'); returns the ISO date
    string n days before it, using only stdlib date arithmetic."""
    y, m, d = (int(x) for x in from_day.split("-"))
    return (date(y, m, d) - timedelta(days=n)).isoformat()

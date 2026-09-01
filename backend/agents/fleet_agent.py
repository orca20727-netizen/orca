import json
import logging
import os
from typing import Any, Dict, List, Optional, Tuple
from live_data import live_data

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")

# Used only when data/simulated_vessels.json can't be read (missing file,
# corrupted JSON, empty fleet) -- keeps the pipeline serving a plausible
# offline snapshot instead of raising and taking down the whole advisory.
FALLBACK_FLEET = {
    "total_active_vessels": 35,
    "vessels_in_target_zone": 8,
    "zone_capacity_pct": 32,
    "overcrowding_status": "OPTIMAL_CAPACITY",
    "border_warning_vessels_count": 3,
}

# Assumed sustainable vessel capacity per PFZ zone. Turns a raw in-zone
# vessel count into an occupancy percentage for the overcrowding verdict.
SUSTAINABLE_CAPACITY_PER_ZONE = 25
BORDER_RISK_STATUSES = {"BORDER_WARNING", "BORDER_ALERT"}


class FleetTrafficAgent:
    def __init__(self):
        self.name = "Fleet & Traffic Agent"
        self._vessels, self._load_error = self._load_vessels()

    @staticmethod
    def _load_vessels() -> Tuple[List[Dict[str, Any]], Optional[str]]:
        path = os.path.join(DATA_DIR, "simulated_vessels.json")
        try:
            with open(path, "r") as f:
                data = json.load(f)
            vessels = data.get("vessels", [])
            if not vessels:
                raise ValueError("simulated_vessels.json contained no vessels")
            return vessels, None
        except Exception as e:
            logger.warning("Fleet & Traffic Agent: falling back to offline fleet snapshot (%s)", e)
            return [], str(e)

    async def analyze_fleet(self, pfz_id: str = "PFZ-01") -> Dict[str, Any]:
        live_snapshot = live_data.store.latest("vessel")
        vessels = live_snapshot["payload"] if live_snapshot else self._vessels
        if not vessels:
            # Live/simulated telemetry feed unavailable -- degrade gracefully
            # instead of raising, so the rest of the advisory pipeline still
            # gets a usable (if stale) fleet picture.
            return {
                **FALLBACK_FLEET,
                "data_source": "SIMULATED_FALLBACK (vessel feed unavailable)",
                "fallback_reason": self._load_error,
            }

        in_zone = [v for v in vessels if str(v.get("zone", "")).startswith(pfz_id)]
        border_risk = [v for v in vessels if v.get("status") in BORDER_RISK_STATUSES]

        vessels_in_target_zone = len(in_zone)
        occupancy_pct = round(min(100.0, (vessels_in_target_zone / SUSTAINABLE_CAPACITY_PER_ZONE) * 100))

        if occupancy_pct < 60:
            overcrowding_status = "OPTIMAL_CAPACITY"
        elif occupancy_pct < 85:
            overcrowding_status = "MODERATE_CONGESTION"
        else:
            overcrowding_status = "OVERCROWDED"

        return {
            "total_active_vessels": len(vessels),
            "vessels_in_target_zone": vessels_in_target_zone,
            "zone_capacity_pct": occupancy_pct,
            "overcrowding_status": overcrowding_status,
            "border_warning_vessels_count": len(border_risk),
            "data_source": live_snapshot["source"] if live_snapshot else "SIMULATED_VESSEL_TELEMETRY",
            "observed_at": live_snapshot.get("observed_at") if live_snapshot else None,
            "ingested_at": live_snapshot.get("ingested_at") if live_snapshot else None,
        }

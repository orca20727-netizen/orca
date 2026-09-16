import json
import logging
import math
import os
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from .geo_utils import haversine_nm
from live_data import live_data

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")

# How stale a cached per-zone Copernicus Marine reading (backend/
# copernicus_marine_feed.py, refreshed every ~6h by live_scheduler.py) can
# be before this ranking stops trusting it -- mirrors satellite_agent.py's
# own COPERNICUS_STALE_HOURS so both features treat "fresh" identically.
COPERNICUS_STALE_HOURS = 30

# yield_score_pct previously came straight out of pfz_zones.json as a fixed
# per-zone constant, so it never moved and "why has my catch declined"
# could never detect a genuine change. It's now nudged by how today's live
# chlorophyll compares to the zone's own static baseline reading (the value
# the static score was presumably calibrated against), capped to this many
# percentage points either way so a single reading can't swing the number
# implausibly far from its documented baseline.
YIELD_LIVE_ADJUSTMENT_MAX_PP = 6.0

# Composite score weights. Distance is weighted the heaviest because a
# fishing zone with a slightly weaker chlorophyll front that a vessel can
# actually reach and fish within a day beats a marginally richer one that
# requires an overnight transit -- the whole point of a PFZ *advisory* is
# reachability, not just raw bio-oceanographic potential.
WEIGHT_CHLOROPHYLL = 0.35
WEIGHT_SST_GRADIENT = 0.25
WEIGHT_DISTANCE = 0.40

# Distance decay scale (nm). Larger = distance matters less steeply.
DISTANCE_DECAY_NM = 50.0

# Used only if data/pfz_zones.json can't be read (missing file, corrupted
# JSON) -- a single offline PFZ-01 snapshot so ranking still degrades
# gracefully instead of the whole advisory pipeline erroring out.
FALLBACK_ZONES: List[Dict[str, Any]] = [
    {
        "id": "PFZ-01",
        "name": "Kochi Deep Offshore (Malabar)",
        "region": "Kerala Coast",
        "center": [9.85, 75.60],
        "sst_celsius": 28.4,
        "sst_gradient_c_per_km": 0.18,
        "chlorophyll_mg_m3": 1.85,
        "yield_score_pct": 94,
        "dominant_species": ["Indian Mackerel", "Yellowfin Tuna", "Sardines"],
        "depth_m": 75,
        "safety_status": "SAFE",
        "advisory_notes": "Offline fallback snapshot -- live PFZ zone data unavailable.",
    }
]


class OceanAnalyticsPFZAgent:
    def __init__(self):
        self.name = "Ocean Analytics & PFZ Agent"
        self._zones, self._using_fallback = self._load_zones()

    @staticmethod
    def _load_zones() -> "tuple[List[Dict[str, Any]], bool]":
        path = os.path.join(DATA_DIR, "pfz_zones.json")
        try:
            with open(path, "r") as f:
                zones = json.load(f)["zones"]
            if not zones:
                raise ValueError("pfz_zones.json contained no zones")
            return zones, False
        except Exception as e:
            logger.warning("Ocean Analytics & PFZ Agent: falling back to offline PFZ snapshot (%s)", e)
            return FALLBACK_ZONES, True

    @staticmethod
    def _fresh_live_ocean_reading(zone_id: str) -> Optional[Dict[str, Any]]:
        """The cached Copernicus Marine reading for this exact PFZ zone id
        (backend/copernicus_marine_feed.py via live_scheduler.py), or None
        if there isn't one yet (no credentials configured, refresh hasn't
        run) or it's older than COPERNICUS_STALE_HOURS. Never raises --
        a malformed/missing cache entry just means "no live reading",
        same graceful-degradation contract every other live feed in this
        codebase follows."""
        snapshot = live_data.store.latest(f"ocean_zone_{zone_id}")
        if not snapshot:
            return None
        try:
            ingested_at = datetime.fromisoformat(snapshot["ingested_at"])
            if ingested_at.tzinfo is None:
                ingested_at = ingested_at.replace(tzinfo=timezone.utc)
            age_hours = (datetime.now(timezone.utc) - ingested_at).total_seconds() / 3600.0
            if age_hours > COPERNICUS_STALE_HOURS:
                return None
        except Exception:
            pass
        try:
            payload = snapshot.get("payload", {})
            if not math.isfinite(float(payload["chlorophyll_mg_m3"])):
                return None
        except Exception:
            return None
        return snapshot

    async def rank_pfz_zones(
        self, vessel_lat: float = 9.85, vessel_lon: float = 75.60
    ) -> Dict[str, Any]:
        live_snapshot = live_data.store.latest("pfz")
        zones = live_snapshot["payload"] if live_snapshot else self._zones
        if not zones:
            return {"error": "No PFZ zone data available"}

        max_chloro = max(z["chlorophyll_mg_m3"] for z in zones) or 1.0
        max_grad = max(z["sst_gradient_c_per_km"] for z in zones) or 1.0

        ranked = []
        for z in zones:
            center_lat, center_lon = z["center"][0], z["center"][1]
            distance_nm = haversine_nm(vessel_lat, vessel_lon, center_lat, center_lon)

            # yield_score_pct (and the chlorophyll/SST feeding this zone's
            # score) used to come straight from the static pfz_zones.json
            # dataset every time, so it could never actually move. When a
            # fresh Copernicus Marine reading exists for this zone, use its
            # live chlorophyll/SST instead, and nudge yield_score_pct by how
            # far that live reading has moved from the zone's own documented
            # baseline -- capped so one reading can't swing it implausibly
            # far. No live reading yet (no credentials configured, or the
            # background refresh hasn't run) -- falls back to the exact
            # static behavior this had before, unchanged.
            live_reading = self._fresh_live_ocean_reading(z["id"])
            static_chloro = z["chlorophyll_mg_m3"]
            if live_reading:
                live_payload = live_reading["payload"]
                chlorophyll_mg_m3 = round(float(live_payload["chlorophyll_mg_m3"]), 2)
                sst_celsius = round(float(live_payload.get("sst_celsius", z["sst_celsius"])), 2)
                yield_score_basis = "LIVE_COPERNICUS_ADJUSTED"
            else:
                chlorophyll_mg_m3 = static_chloro
                sst_celsius = z["sst_celsius"]
                yield_score_basis = "STATIC_PFZ_DATASET"
            # Copernicus doesn't give a per-point SST gradient (see
            # satellite_agent.py's own note on this) -- keep this zone's
            # documented baseline gradient rather than inventing one here.
            sst_gradient_c_per_km = z["sst_gradient_c_per_km"]

            chloro_score = (chlorophyll_mg_m3 / max_chloro) * 100.0
            sst_score = (sst_gradient_c_per_km / max_grad) * 100.0
            distance_score = 100.0 / (1.0 + distance_nm / DISTANCE_DECAY_NM)

            composite = (
                WEIGHT_CHLOROPHYLL * chloro_score
                + WEIGHT_SST_GRADIENT * sst_score
                + WEIGHT_DISTANCE * distance_score
            )

            if live_reading and static_chloro:
                chloro_delta_pct = (chlorophyll_mg_m3 - static_chloro) / static_chloro * 100.0
                yield_adjustment = max(
                    -YIELD_LIVE_ADJUSTMENT_MAX_PP,
                    min(YIELD_LIVE_ADJUSTMENT_MAX_PP, chloro_delta_pct * 0.3),
                )
                yield_score_pct = round(max(0.0, min(100.0, z["yield_score_pct"] + yield_adjustment)), 1)
            else:
                yield_score_pct = z["yield_score_pct"]

            ranked.append(
                {
                    "id": z["id"],
                    "name": z["name"],
                    "region": z["region"],
                    "distance_nm": round(distance_nm, 1),
                    "chlorophyll_mg_m3": chlorophyll_mg_m3,
                    "sst_celsius": sst_celsius,
                    "sst_gradient_c_per_km": sst_gradient_c_per_km,
                    "depth_m": z["depth_m"],
                    "dominant_species": z["dominant_species"],
                    "safety_status": z["safety_status"],
                    "advisory_notes": z["advisory_notes"],
                    "composite_score": round(composite, 2),
                    "yield_score_pct": yield_score_pct,
                    "yield_score_basis": yield_score_basis,
                }
            )

        ranked.sort(key=lambda r: r["composite_score"], reverse=True)
        top = ranked[0]

        return {
            "top_recommended_pfz": f"{top['id']} ({top['name']})",
            "region": top["region"],
            "yield_score_pct": top["yield_score_pct"],
            "yield_score_basis": top["yield_score_basis"],
            "composite_score": top["composite_score"],
            "dominant_species": top["dominant_species"],
            "depth_m": top["depth_m"],
            "chlorophyll_gradient": (
                f"{top['chlorophyll_mg_m3']} mg/m3 (High frontal convergence)"
                if top["chlorophyll_mg_m3"] >= 1.5
                else f"{top['chlorophyll_mg_m3']} mg/m3"
            ),
            "thermal_front": f"{top['sst_celsius']}\u00b0C SST contour match",
            "distance_from_vessel_nm": top["distance_nm"],
            "ranking_basis": {
                "weights": {
                    "chlorophyll": WEIGHT_CHLOROPHYLL,
                    "sst_gradient": WEIGHT_SST_GRADIENT,
                    "distance": WEIGHT_DISTANCE,
                },
                "distance_decay_nm": DISTANCE_DECAY_NM,
            },
            "full_ranking": ranked,
            "data_source": (
                live_snapshot["source"] if live_snapshot else
                ("SIMULATED_FALLBACK (PFZ zone data unavailable)" if self._using_fallback else "PFZ_ZONE_DATASET")
            ),
            "observed_at": live_snapshot.get("observed_at") if live_snapshot else None,
            "ingested_at": live_snapshot.get("ingested_at") if live_snapshot else None,
        }

import json
import logging
import os
from typing import Dict, Any, List

from .geo_utils import haversine_nm
from live_data import live_data

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")

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

            chloro_score = (z["chlorophyll_mg_m3"] / max_chloro) * 100.0
            sst_score = (z["sst_gradient_c_per_km"] / max_grad) * 100.0
            distance_score = 100.0 / (1.0 + distance_nm / DISTANCE_DECAY_NM)

            composite = (
                WEIGHT_CHLOROPHYLL * chloro_score
                + WEIGHT_SST_GRADIENT * sst_score
                + WEIGHT_DISTANCE * distance_score
            )

            ranked.append(
                {
                    "id": z["id"],
                    "name": z["name"],
                    "region": z["region"],
                    "distance_nm": round(distance_nm, 1),
                    "chlorophyll_mg_m3": z["chlorophyll_mg_m3"],
                    "sst_celsius": z["sst_celsius"],
                    "sst_gradient_c_per_km": z["sst_gradient_c_per_km"],
                    "depth_m": z["depth_m"],
                    "dominant_species": z["dominant_species"],
                    "safety_status": z["safety_status"],
                    "advisory_notes": z["advisory_notes"],
                    "composite_score": round(composite, 2),
                    "yield_score_pct": z["yield_score_pct"],
                }
            )

        ranked.sort(key=lambda r: r["composite_score"], reverse=True)
        top = ranked[0]

        return {
            "top_recommended_pfz": f"{top['id']} ({top['name']})",
            "region": top["region"],
            "yield_score_pct": top["yield_score_pct"],
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

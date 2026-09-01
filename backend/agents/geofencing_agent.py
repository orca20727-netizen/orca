import json
import logging
import os
from typing import Any, Dict, List, Optional

from .geo_utils import (
    point_to_polyline_distance_nm,
    point_in_any_polygon,
    point_to_polygon_boundary_distance_nm,
    segment_intersects_any_polygon,
    mpa_polygon,
)

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")

# Distance (NM) inside which a vessel is flagged as "approaching" an MPA
# even though it hasn't crossed the boundary yet -- same idea as the IMBL
# warning/danger thresholds, applied to MPAs. Configurable via env var so
# a deployment can tighten/loosen it without a code change.
MPA_SAFETY_BUFFER_NM = float(os.getenv("MPA_SAFETY_BUFFER_NM", "2.0"))


class GeofencingAgent:
    def __init__(self):
        self.name = "Geofencing & Routing Agent"
        # If either data file is missing/corrupted, degrade to an empty
        # list rather than crashing app startup -- check_geofences already
        # reports "no boundary data" / never flags an MPA breach in that
        # case, which is a safe (if less informative) default for a demo.
        self._boundaries = self._load_json_list("imbl_boundaries.json", "boundaries")
        self._mpas = self._load_json_list("mpas.json", "mpas")
        self._mpa_polygons = [mpa_polygon(m) for m in self._mpas]

    @staticmethod
    def _load_json_list(filename: str, key: str) -> List[Dict[str, Any]]:
        path = os.path.join(DATA_DIR, filename)
        try:
            with open(path, "r") as f:
                return json.load(f)[key]
        except Exception as e:
            logger.warning("Geofencing & Routing Agent: could not load %s (%s) -- continuing with empty %s", filename, e, key)
            return []

    def _mpa_status_at(self, lat: float, lon: float) -> Dict[str, Any]:
        """
        Checks a single point against every MPA's real polygon (not just
        its bounding box) for:
          1. Vessel is inside the MPA (a hard breach), or
          2. Vessel is outside but within MPA_SAFETY_BUFFER_NM of its
             boundary (a proximity warning, not yet a breach).
        Returns the nearest/most severe MPA match, or a clear "no match"
        result if the vessel is comfortably clear of every MPA.
        """
        if not self._mpas:
            return {"status": "NO_MPA_DATA", "breached": False, "mpa": None, "distance_nm": None}

        best_distance = float("inf")
        best_mpa = None
        breached_mpa = None

        for mpa, polygon in zip(self._mpas, self._mpa_polygons):
            if not polygon:
                continue
            if point_in_any_polygon(lat, lon, [polygon]):
                breached_mpa = mpa
                best_distance = 0.0
                best_mpa = mpa
                break  # inside an MPA is the worst case -- no need to check others
            d = point_to_polygon_boundary_distance_nm(lat, lon, polygon)
            if d < best_distance:
                best_distance = d
                best_mpa = mpa

        if breached_mpa is not None:
            return {"status": "MPA_BREACH", "breached": True, "mpa": breached_mpa, "distance_nm": 0.0}
        if best_mpa is not None and best_distance <= MPA_SAFETY_BUFFER_NM:
            return {"status": "MPA_PROXIMITY_WARNING", "breached": False, "mpa": best_mpa, "distance_nm": round(best_distance, 2)}
        return {
            "status": "CLEAR_OF_MPAS",
            "breached": False,
            "mpa": None,
            "distance_nm": round(best_distance, 2) if best_mpa is not None else None,
        }

    def check_route_against_mpas(self, waypoints: List[Dict[str, float]]) -> Dict[str, Any]:
        """
        Validates an already-computed route (list of {"lat", "lon"} dicts,
        e.g. from RoutePlanner.plan_route) against every MPA polygon:
        flags any leg that actually intersects an MPA, and any waypoint
        that sits within the safety buffer of one. Intended as an
        independent sanity check on a route from any source (not just the
        A* planner, which already avoids these during search) -- e.g. a
        manually-specified or externally-supplied route.
        """
        if not self._mpas or len(waypoints) < 2:
            return {"intersects_mpa": False, "within_buffer": False, "flagged_mpas": []}

        flagged = set()
        intersects = False
        within_buffer = False

        for i in range(len(waypoints) - 1):
            a, b = waypoints[i], waypoints[i + 1]
            if segment_intersects_any_polygon(a["lat"], a["lon"], b["lat"], b["lon"], self._mpa_polygons):
                intersects = True
            for mpa, polygon in zip(self._mpas, self._mpa_polygons):
                if not polygon:
                    continue
                for pt in (a, b):
                    d = point_to_polygon_boundary_distance_nm(pt["lat"], pt["lon"], polygon)
                    if d <= MPA_SAFETY_BUFFER_NM:
                        within_buffer = True
                        flagged.add(mpa.get("name", mpa.get("id")))

        return {
            "intersects_mpa": intersects,
            "within_buffer": within_buffer,
            "flagged_mpas": sorted(flagged),
            "buffer_nm": MPA_SAFETY_BUFFER_NM,
        }

    async def check_geofences(self, lat: float = 9.85, lon: float = 75.60) -> Dict[str, Any]:
        if not self._boundaries:
            return {"error": "No IMBL boundary data available"}

        # Real point-to-polyline distance (haversine + point-to-segment) to
        # every IMBL boundary, not a fixed constant -- pick whichever
        # boundary the vessel is actually closest to.
        per_boundary: List[Dict[str, Any]] = []
        for b in self._boundaries:
            d = point_to_polyline_distance_nm(lat, lon, b["coordinates"])
            per_boundary.append(
                {
                    "name": b["name"],
                    "country": b["country"],
                    "distance_nm": round(d, 2),
                    "warning_distance_nm": b["warning_distance_nm"],
                    "danger_distance_nm": b["danger_distance_nm"],
                }
            )

        nearest = min(per_boundary, key=lambda x: x["distance_nm"])

        if nearest["distance_nm"] <= nearest["danger_distance_nm"]:
            imbl_status = "DANGER_IMMINENT_BOUNDARY_BREACH"
        elif nearest["distance_nm"] <= nearest["warning_distance_nm"]:
            imbl_status = "WARNING_APPROACHING_BOUNDARY"
        else:
            imbl_status = "SAFE_INTERNATIONAL_CLEARANCE"

        mpa_check = self._mpa_status_at(lat, lon)
        mpa_breach_detected = mpa_check["breached"]

        return {
            "vessel_position": {"lat": lat, "lon": lon},
            "nearest_imbl_country": nearest["country"],
            "nearest_imbl_boundary": nearest["name"],
            "distance_to_imbl_nm": nearest["distance_nm"],
            "imbl_status": imbl_status,
            "mpa_breach_detected": mpa_breach_detected,
            "mpa_breached_name": mpa_check["mpa"]["name"] if mpa_breach_detected and mpa_check["mpa"] else None,
            "mpa_status": mpa_check["status"],
            "distance_to_nearest_mpa_nm": mpa_check["distance_nm"],
            "mpa_safety_buffer_nm": MPA_SAFETY_BUFFER_NM,
            "designated_corridor_active": not mpa_breach_detected and imbl_status == "SAFE_INTERNATIONAL_CLEARANCE",
            "all_boundaries_checked": per_boundary,
        }

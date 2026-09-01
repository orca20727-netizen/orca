import json
import logging
import os
from typing import Dict, Any, List, Optional, Tuple

from .route_planner import RoutePlanner

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")


class ETAVoyageSafetyAgent:
    def __init__(self, planner: Optional[RoutePlanner] = None):
        self.name = "ETA & Voyage Safety Agent"
        # If mpas.json / land_mask.json can't be read, route around nothing
        # rather than failing to start -- the router still runs, it just
        # won't be able to steer clear of any no-go zones until the data
        # file is fixed. A shared `planner` can be injected (see main.py)
        # so the /api/route endpoint and this agent's ETA calculation are
        # guaranteed to use the exact same routing engine and data.
        if planner is not None:
            self._planner = planner
            self._mpas = planner.mpas
        else:
            self._mpas = self._load_mpas()
            self._planner = RoutePlanner(self._mpas, land_polygons=self._load_land_polygons())

    @staticmethod
    def _load_mpas() -> List[Dict[str, Any]]:
        path = os.path.join(DATA_DIR, "mpas.json")
        try:
            with open(path, "r") as f:
                return json.load(f)["mpas"]
        except Exception as e:
            logger.warning("ETA & Voyage Safety Agent: could not load mpas.json (%s) -- routing without MPA avoidance", e)
            return []

    @staticmethod
    def _load_land_polygons() -> List[List[List[float]]]:
        path = os.path.join(DATA_DIR, "land_mask.json")
        try:
            with open(path, "r") as f:
                data = json.load(f)
            return [p["polygon"] for p in data.get("land_polygons", [])]
        except Exception as e:
            logger.warning("ETA & Voyage Safety Agent: could not load land_mask.json (%s) -- routing without land avoidance", e)
            return []

    async def calculate_voyage(
        self,
        distance_nm: Optional[float] = None,
        wave_height_m: float = 1.25,
        origin: Optional[Tuple[float, float]] = None,
        destination: Optional[Tuple[float, float]] = None,
    ) -> Dict[str, Any]:
        route_info: Dict[str, Any] = {}

        if distance_nm is not None:
            # Caller supplied an explicit distance (e.g. a known transit
            # figure) -- honor it as-is and skip routing.
            route_distance = distance_nm
        elif origin is not None and destination is not None:
            # Real A*-over-a-grid routing that avoids land and MPA no-go
            # zones, instead of a fixed straight-line constant.
            route_info = self._planner.plan_route(origin, destination)
            if not route_info.get("route_found"):
                # Do NOT fabricate a distance/ETA for a route that doesn't
                # exist -- surface the failure explicitly instead.
                return {
                    "route_distance_nm": None,
                    "one_way_eta_hours": None,
                    "estimated_return_ist": None,
                    "dusk_safety_verdict": "NO_SAFE_MARITIME_ROUTE",
                    "routing": {
                        "route_found": False,
                        "reason": route_info.get("reason", "NO_SAFE_MARITIME_ROUTE"),
                        "detail": route_info.get("detail"),
                        "waypoints": [],
                    },
                }
            route_distance = route_info.get("route_distance_nm")
        else:
            # No coordinates and no explicit distance given -- fall back to
            # the default Kochi Harbour -> PFZ-01 route, still computed via
            # the real router rather than hardcoded.
            route_info = self._planner.plan_route((9.93, 76.26), (9.85, 75.60))
            route_distance = route_info.get("route_distance_nm", 28.4)

        base_speed = 9.0  # knots
        wave_penalty = 0.88 if wave_height_m <= 1.5 else 0.75
        effective_speed = base_speed * wave_penalty

        transit_hours = route_distance / effective_speed
        fishing_hours = 4.0
        total_trip_hours = (transit_hours * 2) + fishing_hours

        departure_time = 6.0  # 06:00 IST
        estimated_return = departure_time + total_trip_hours
        dusk_time = 18.5  # 18:30 IST

        is_safe_return = estimated_return <= dusk_time
        display_return = estimated_return % 24  # wrap past-midnight returns for display

        result = {
            "route_distance_nm": round(route_distance, 2),
            "effective_speed_knots": round(effective_speed, 1),
            "one_way_eta_hours": round(transit_hours, 2),
            "estimated_return_ist": f"{int(display_return):02d}:{int((display_return % 1) * 60):02d} IST"
            + (" (+1 day)" if estimated_return >= 24 else ""),
            "dusk_threshold_ist": "18:30 IST",
            "dusk_safety_verdict": "SAFE_RETURN_BEFORE_DUSK" if is_safe_return else "CAUTION_RETURN_AFTER_DUSK",
        }

        if route_info:
            result["routing"] = {
                "route_found": route_info.get("route_found"),
                "mpa_avoidance_active": route_info.get("mpa_avoidance_active"),
                "land_avoidance": route_info.get("land_avoidance"),
                "route_source": route_info.get("route_source"),
                "straight_line_distance_nm": route_info.get("straight_line_distance_nm"),
                "detour_nm": route_info.get("detour_nm"),
                "detour_percent": route_info.get("detour_percent"),
                "avoided_mpas": route_info.get("avoided_mpas", []),
                "waypoints": route_info.get("waypoints"),
                "reason": route_info.get("reason"),
            }

        return result

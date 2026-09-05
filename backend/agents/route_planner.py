"""
Grid-based A* maritime route planner.

Plans a path from an origin to a destination lat/lon that:

  1. Never crosses land (data/land_mask.json -- a simplified coastline
     approximation; see that file's header for its known limitations).
  2. Never crosses a Marine Protected Area polygon (data/mpas.json).
  3. Stays outside each MPA's configured safety buffer where practical.

Approach: lay an adaptive-resolution lat/lon grid over the bounding box of
origin+destination (padded), mark any cell whose center falls on land or
inside an MPA as blocked, then run A* with 8-connected movement and a
haversine heuristic. Critically, edges (not just nodes) are checked: a
move between two adjacent, individually-unblocked cells is still rejected
if the segment between them crosses a land or MPA polygon boundary, so
A* can't "hop" a thin peninsula or a narrow no-go strip between two grid
points. Edge costs are the real haversine distance between adjacent cell
centers, so the summed path cost is a genuine (grid-quantized) routed
distance, not a fixed constant.

If no path is found (e.g. destination itself sits inside a no-go zone, or
the search grid can't find a way around), the caller gets an explicit
`route_found: False` with `reason: "NO_SAFE_MARITIME_ROUTE"` rather than a
silently wrong straight line -- the route is never fabricated.
"""

import heapq
import math
import os
from typing import Dict, Any, List, Tuple, Optional

from .geo_utils import (
    haversine_nm,
    point_in_bounds,
    point_in_any_polygon,
    segment_intersects_any_polygon,
    point_to_polygon_boundary_distance_nm,
    mpa_polygon as _mpa_polygon,
)

Cell = Tuple[int, int]


class RoutePlanner:
    def __init__(
        self,
        mpas: List[Dict[str, Any]],
        land_polygons: Optional[List[List[List[float]]]] = None,
        mpa_safety_buffer_nm: Optional[float] = None,
    ):
        self.mpas = mpas
        self.mpa_polygons = [_mpa_polygon(m) for m in mpas if _mpa_polygon(m)]
        self.land_polygons = land_polygons or []
        # Defaults to the same MPA_SAFETY_BUFFER_NM env var the Geofencing
        # Agent uses, so "clear per the router" and "clear per a geofence
        # check" agree unless a caller explicitly overrides this.
        self.mpa_safety_buffer_nm = (
            mpa_safety_buffer_nm if mpa_safety_buffer_nm is not None
            else float(os.getenv("MPA_SAFETY_BUFFER_NM", "2.0"))
        )

    # -- occupancy checks --------------------------------------------------

    def _on_land(self, lat: float, lon: float) -> bool:
        return point_in_any_polygon(lat, lon, self.land_polygons)

    def _in_or_near_mpa(self, lat: float, lon: float) -> Optional[Dict[str, Any]]:
        """Returns the breached/too-close MPA dict, or None if clear."""
        for mpa, poly in zip(self.mpas, self.mpa_polygons):
            if point_in_any_polygon(lat, lon, [poly]):
                return mpa
            if self.mpa_safety_buffer_nm > 0:
                if point_to_polygon_boundary_distance_nm(lat, lon, poly) < self.mpa_safety_buffer_nm:
                    return mpa
        return None

    def _blocked(self, lat: float, lon: float) -> bool:
        if self._on_land(lat, lon):
            return True
        return self._in_or_near_mpa(lat, lon) is not None

    def _edge_blocked(self, alat: float, alon: float, blat: float, blon: float) -> bool:
        """Rejects a movement edge (not just its endpoints) that crosses
        land or an MPA polygon boundary -- prevents A* from jumping over a
        thin restricted strip between two open grid cells."""
        if segment_intersects_any_polygon(alat, alon, blat, blon, self.land_polygons):
            return True
        if self.mpa_polygons and segment_intersects_any_polygon(alat, alon, blat, blon, self.mpa_polygons):
            return True
        return False

    # -- legacy helper kept for any external/test callers that still probe
    # a single MPA-bounds check directly -----------------------------------
    def _blocked_by_mpa_bounds_only(self, lat: float, lon: float) -> bool:
        for mpa in self.mpas:
            if point_in_bounds(lat, lon, mpa.get("bounds", [])):
                return True
        return False

    def plan_route(
        self,
        origin: Tuple[float, float],
        destination: Tuple[float, float],
        target_grid_cells_per_axis: Optional[int] = None,
        padding_deg: Optional[float] = None,
    ) -> Dict[str, Any]:
        olat, olon = origin
        dlat, dlon = destination

        # Never silently draw a route from or to land.  Harbour/PFZ inputs
        # must be placed on water before planning can begin.
        if self._on_land(olat, olon) or self._on_land(dlat, dlon):
            return {
                "route_found": False,
                "reason": "ENDPOINT_NOT_IN_NAVIGABLE_WATER",
                "detail": "Origin or destination is on land; choose a harbour or PFZ water coordinate.",
                "waypoints": [], "land_avoidance": True, "mpa_avoidance_active": True,
                "route_source": "A_STAR",
            }

        raw_lat_span = abs(dlat - olat)
        raw_lon_span = abs(dlon - olon)
        raw_span = max(raw_lat_span, raw_lon_span)

        # Padding scales with how far apart origin/destination are: a short
        # harbour -> nearby-PFZ hop only needs a small search margin, but a
        # long cross-coast trip (e.g. around a peninsula's southern tip)
        # needs enough margin for A* to actually find the detour, not just
        # room to wiggle around a locally-blocking MPA box.
        if padding_deg is None:
            padding_deg = max(0.4, 0.85 * raw_span)

        # Resolution also scales with distance so short hops stay fine
        # (better MPA/coastline fidelity) while long hops don't demand an
        # enormous grid -- capped for the performance budget of a live
        # HTTP request.
        if target_grid_cells_per_axis is None:
            target_grid_cells_per_axis = int(max(50, min(140, raw_span * 40)))

        lat_min = min(olat, dlat) - padding_deg
        lat_max = max(olat, dlat) + padding_deg
        lon_min = min(olon, dlon) - padding_deg
        lon_max = max(olon, dlon) + padding_deg

        lat_span = max(lat_max - lat_min, 1e-6)
        lon_span = max(lon_max - lon_min, 1e-6)

        # Adaptive step: keep the grid to roughly target_grid_cells_per_axis
        # per axis so short hops (harbour -> nearby PFZ) get fine resolution
        # and long hops (coast to coast) don't blow up the cell count.
        lat_step = lat_span / target_grid_cells_per_axis
        lon_step = lon_span / target_grid_cells_per_axis

        n_rows = int(round(lat_span / lat_step)) + 1
        n_cols = int(round(lon_span / lon_step)) + 1

        def cell_latlon(r: int, c: int) -> Tuple[float, float]:
            return (lat_min + r * lat_step, lon_min + c * lon_step)

        def nearest_cell(lat: float, lon: float) -> Cell:
            r = int(round((lat - lat_min) / lat_step))
            c = int(round((lon - lon_min) / lon_step))
            r = max(0, min(n_rows - 1, r))
            c = max(0, min(n_cols - 1, c))
            return (r, c)

        start = nearest_cell(olat, olon)
        goal = nearest_cell(dlat, dlon)

        avoided_mpas: List[str] = []

        # Origin/destination themselves are trusted (they're a real harbour
        # / PFZ center, i.e. known-water coordinates) -- only the
        # *destination* is checked for an outright no-go breach, matching
        # the documented "destination inside restricted zone" failure case.
        goal_mpa = self._in_or_near_mpa(dlat, dlon)
        if self._on_land(dlat, dlon):
            return {
                "route_found": False,
                "reason": "NO_SAFE_MARITIME_ROUTE",
                "detail": "Destination coordinate falls on land.",
                "waypoints": [],
                "land_avoidance": True,
                "mpa_avoidance_active": True,
                "route_source": "A_STAR",
            }
        if goal_mpa is not None:
            return {
                "route_found": False,
                "reason": "NO_SAFE_MARITIME_ROUTE",
                "detail": f"Destination falls inside/near Marine Protected Area '{goal_mpa.get('name', goal_mpa.get('id'))}'.",
                "waypoints": [],
                "land_avoidance": True,
                "mpa_avoidance_active": True,
                "route_source": "A_STAR",
            }

        neighbors = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

        def heuristic(cell: Cell) -> float:
            clat, clon = cell_latlon(*cell)
            return haversine_nm(clat, clon, dlat, dlon)

        open_heap: List[Tuple[float, Cell]] = [(heuristic(start), start)]
        came_from: Dict[Cell, Cell] = {}
        g_score: Dict[Cell, float] = {start: 0.0}
        visited = set()

        found = False
        while open_heap:
            _, current = heapq.heappop(open_heap)
            if current in visited:
                continue
            visited.add(current)

            if current == goal:
                found = True
                break

            clat, clon = cell_latlon(*current)
            for dr, dc in neighbors:
                nr, nc = current[0] + dr, current[1] + dc
                if not (0 <= nr < n_rows and 0 <= nc < n_cols):
                    continue
                neighbor = (nr, nc)
                if neighbor in visited:
                    continue
                nlat, nlon = cell_latlon(nr, nc)

                # Node check (land or MPA occupancy at the neighbor cell
                # itself) -- skip start/goal cells since those are trusted
                # known-water coordinates that may sit slightly inside the
                # coarse grid resolution's margin of error.
                if neighbor != goal and self._blocked(nlat, nlon):
                    continue

                # Edge check: reject the *movement* if it crosses land or
                # an MPA polygon boundary, even when both endpoints are
                # individually clear.
                if self._edge_blocked(clat, clon, nlat, nlon):
                    continue

                mpa_here = self._in_or_near_mpa(nlat, nlon)
                if mpa_here is not None:
                    name = mpa_here.get("name", mpa_here.get("id"))
                    if name not in avoided_mpas:
                        avoided_mpas.append(name)

                step_cost = haversine_nm(clat, clon, nlat, nlon)
                tentative_g = g_score[current] + step_cost

                if tentative_g < g_score.get(neighbor, math.inf):
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g
                    f_score = tentative_g + heuristic(neighbor)
                    heapq.heappush(open_heap, (f_score, neighbor))

        if not found:
            return {
                "route_found": False,
                "reason": "NO_SAFE_MARITIME_ROUTE",
                "detail": "No path avoiding land and MPA no-go zones was found within the search grid.",
                "waypoints": [],
                "land_avoidance": True,
                "mpa_avoidance_active": True,
                "route_source": "A_STAR",
                "grid_cells": n_rows * n_cols,
            }

        # Reconstruct path
        path_cells = [goal]
        while path_cells[-1] != start:
            path_cells.append(came_from[path_cells[-1]])
        path_cells.reverse()

        waypoints_latlon = [cell_latlon(r, c) for r, c in path_cells]
        # Snap the endpoints to the exact requested coordinates rather than
        # the nearest grid node, so the reported route starts/ends exactly
        # at origin/destination.
        waypoints_latlon[0] = (olat, olon)
        waypoints_latlon[-1] = (dlat, dlon)

        simplified = self._simplify_collinear(waypoints_latlon)

        # Simplification can re-introduce a land/MPA-crossing shortcut if a
        # "collinear enough" run of grid hops actually curved around an
        # obstacle -- verify every simplified edge is still clear, and fall
        # back to the un-simplified (denser) path if not.
        if not self._path_is_clear(simplified):
            simplified = waypoints_latlon

        # The dense fallback is deliberately checked too.  This makes the
        # promise of a water-only path explicit even for a coarse land mask.
        if not self._path_is_clear(simplified):
            return {
                "route_found": False,
                "reason": "ROUTE_VERIFICATION_FAILED",
                "detail": "No fully water-only route could be verified for these coordinates.",
                "waypoints": [], "land_avoidance": True, "mpa_avoidance_active": True,
                "route_source": "A_STAR",
            }

        total_nm = 0.0
        for i in range(len(simplified) - 1):
            total_nm += haversine_nm(
                simplified[i][0], simplified[i][1], simplified[i + 1][0], simplified[i + 1][1]
            )

        straight_line_nm = haversine_nm(olat, olon, dlat, dlon)
        detour_nm = max(0.0, total_nm - straight_line_nm)
        detour_pct = round((detour_nm / straight_line_nm) * 100.0, 1) if straight_line_nm > 0 else 0.0

        return {
            "route_found": True,
            "route_distance_nm": round(total_nm, 2),
            "distance_nm": round(total_nm, 2),
            "straight_line_distance_nm": round(straight_line_nm, 2),
            "detour_nm": round(detour_nm, 2),
            "detour_percent": detour_pct,
            "waypoints": [{"lat": round(la, 4), "lon": round(lo, 4)} for la, lo in simplified],
            "avoided_mpas": avoided_mpas,
            "land_avoidance": True,
            "mpa_avoidance_active": True,
            "route_source": "A_STAR",
            "grid_cells": n_rows * n_cols,
            "grid_resolution_deg": round(max(lat_step, lon_step), 4),
        }

    def _path_is_clear(self, points: List[Tuple[float, float]]) -> bool:
        for i in range(len(points) - 1):
            if self._edge_blocked(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]):
                return False
        return True

    @staticmethod
    def _simplify_collinear(
        points: List[Tuple[float, float]], angle_eps_deg: float = 2.0
    ) -> List[Tuple[float, float]]:
        """
        Drop interior waypoints that don't meaningfully change the bearing,
        so a long straight stretch of the A* staircase collapses to two
        endpoints instead of dozens of near-collinear grid hops. The caller
        re-validates the simplified path is still obstacle-clear afterward.
        """
        if len(points) <= 2:
            return points

        def bearing(p1, p2):
            lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
            lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
            dlon = lon2 - lon1
            x = math.sin(dlon) * math.cos(lat2)
            y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
            return math.degrees(math.atan2(x, y))

        simplified = [points[0]]
        prev_bearing = bearing(points[0], points[1])

        for i in range(1, len(points) - 1):
            b = bearing(points[i], points[i + 1])
            diff = abs((b - prev_bearing + 180) % 360 - 180)
            if diff > angle_eps_deg:
                simplified.append(points[i])
                prev_bearing = b

        simplified.append(points[-1])
        return simplified

"""
Shared geospatial math used across agents.

Everything here is plain-vanilla spherical trigonometry (haversine +
a local equirectangular projection for point-to-segment work). No
external geo libraries required, so it has zero extra dependencies.
"""

import math
from typing import Any, Dict, List, Tuple

EARTH_RADIUS_KM = 6371.0088
KM_PER_NM = 1.852


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points, in nautical miles."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    km = EARTH_RADIUS_KM * c
    return km / KM_PER_NM


def _to_local_xy_nm(lat: float, lon: float, ref_lat: float, ref_lon: float) -> Tuple[float, float]:
    """
    Project a lat/lon point onto a local tangent plane centered at
    (ref_lat, ref_lon), in nautical miles. Equirectangular approximation —
    accurate to a fraction of a percent over the distances (tens to low
    hundreds of nm) involved here, which is what point-to-segment distance
    and grid routing need.
    """
    x_nm = (lon - ref_lon) * math.cos(math.radians(ref_lat)) * 60.0
    y_nm = (lat - ref_lat) * 60.0
    return x_nm, y_nm


def point_to_segment_distance_nm(
    plat: float, plon: float, alat: float, alon: float, blat: float, blon: float
) -> float:
    """
    Shortest distance from point P to the line segment A-B, in nautical
    miles. Projects to a local planar frame centered on P so the segment's
    curvature over these distances is negligible, then does ordinary
    2D point-to-segment distance.
    """
    px, py = 0.0, 0.0  # P is the origin of its own local frame
    ax, ay = _to_local_xy_nm(alat, alon, plat, plon)
    bx, by = _to_local_xy_nm(blat, blon, plat, plon)

    abx, aby = bx - ax, by - ay
    seg_len_sq = abx * abx + aby * aby

    if seg_len_sq == 0:
        # Degenerate segment (A == B) — just distance to A
        return math.hypot(ax - px, ay - py)

    t = ((px - ax) * abx + (py - ay) * aby) / seg_len_sq
    t = max(0.0, min(1.0, t))

    closest_x = ax + t * abx
    closest_y = ay + t * aby

    return math.hypot(px - closest_x, py - closest_y)


def point_to_polyline_distance_nm(
    plat: float, plon: float, polyline: List[List[float]]
) -> float:
    """Minimum distance from a point to any segment of a multi-point polyline."""
    if len(polyline) == 1:
        return haversine_nm(plat, plon, polyline[0][0], polyline[0][1])

    best = float("inf")
    for i in range(len(polyline) - 1):
        alat, alon = polyline[i]
        blat, blon = polyline[i + 1]
        d = point_to_segment_distance_nm(plat, plon, alat, alon, blat, blon)
        best = min(best, d)
    return best


def point_in_bounds(lat: float, lon: float, bounds: List[List[float]]) -> bool:
    """
    True if (lat, lon) falls inside the axis-aligned bounding box described
    by `bounds` (a list of [lat, lon] corner pairs, as used in mpas.json /
    pfz_zones.json).
    """
    lats = [c[0] for c in bounds]
    lons = [c[1] for c in bounds]
    return min(lats) <= lat <= max(lats) and min(lons) <= lon <= max(lons)


def point_in_polygon(lat: float, lon: float, polygon: List[List[float]]) -> bool:
    """
    Standard ray-casting point-in-polygon test. `polygon` is a list of
    [lat, lon] vertices (need not repeat the first point at the end).
    Works for arbitrary (non-self-intersecting) polygons, not just
    axis-aligned boxes -- this is what lets MPAs and the coastline land
    mask be real GeoJSON-style polygons instead of bounding boxes.
    """
    n = len(polygon)
    if n < 3:
        return False
    inside = False
    x, y = lon, lat  # treat lon as x, lat as y for the standard algorithm
    x1, y1 = polygon[-1][1], polygon[-1][0]
    for i in range(n):
        x2, y2 = polygon[i][1], polygon[i][0]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-15) + x1):
            inside = not inside
        x1, y1 = x2, y2
    return inside


def point_in_any_polygon(lat: float, lon: float, polygons: List[List[List[float]]]) -> bool:
    """True if (lat, lon) falls inside any polygon in the given list."""
    return any(point_in_polygon(lat, lon, poly) for poly in polygons)


def _segments_intersect(
    p1: Tuple[float, float], p2: Tuple[float, float],
    p3: Tuple[float, float], p4: Tuple[float, float],
) -> bool:
    """True if 2D segment p1-p2 properly (or half-open) intersects p3-p4.
    Points are (x, y) tuples (already projected/local coordinates)."""

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    d1 = cross(p3, p4, p1)
    d2 = cross(p3, p4, p2)
    d3 = cross(p1, p2, p3)
    d4 = cross(p1, p2, p4)

    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True

    def on_segment(p, q, r):
        return min(p[0], r[0]) - 1e-9 <= q[0] <= max(p[0], r[0]) + 1e-9 and \
            min(p[1], r[1]) - 1e-9 <= q[1] <= max(p[1], r[1]) + 1e-9

    if d1 == 0 and on_segment(p3, p1, p4):
        return True
    if d2 == 0 and on_segment(p3, p2, p4):
        return True
    if d3 == 0 and on_segment(p1, p3, p2):
        return True
    if d4 == 0 and on_segment(p1, p4, p2):
        return True
    return False


def segment_intersects_polygon(
    alat: float, alon: float, blat: float, blon: float, polygon: List[List[float]]
) -> bool:
    """
    True if the great-circle-ish segment A-B crosses the boundary of
    `polygon`, OR either endpoint sits inside it. This is what lets the
    router reject an *edge* that jumps clean over a thin peninsula/no-go
    strip even when both grid-cell centers it connects happen to land in
    open water -- checking only node occupancy (the old approach) misses
    exactly this case.

    Projects everything onto a local equirectangular plane centered on A
    so ordinary 2D segment-intersection math applies; accurate enough at
    the grid-cell scales (a few NM) routing operates on here.
    """
    if point_in_polygon(alat, alon, polygon) or point_in_polygon(blat, blon, polygon):
        return True

    ax, ay = 0.0, 0.0
    bx, by = _to_local_xy_nm(blat, blon, alat, alon)
    seg_a = (ax, ay)
    seg_b = (bx, by)

    n = len(polygon)
    for i in range(n):
        plat1, plon1 = polygon[i]
        plat2, plon2 = polygon[(i + 1) % n]
        px1, py1 = _to_local_xy_nm(plat1, plon1, alat, alon)
        px2, py2 = _to_local_xy_nm(plat2, plon2, alat, alon)
        if _segments_intersect(seg_a, seg_b, (px1, py1), (px2, py2)):
            return True
    return False


def segment_intersects_any_polygon(
    alat: float, alon: float, blat: float, blon: float, polygons: List[List[List[float]]]
) -> bool:
    return any(segment_intersects_polygon(alat, alon, blat, blon, poly) for poly in polygons)


def point_to_polygon_boundary_distance_nm(lat: float, lon: float, polygon: List[List[float]]) -> float:
    """Distance from a point to the nearest edge of a polygon's boundary
    (treats the polygon as a closed polyline). Used to enforce MPA safety
    buffers -- a point can be *outside* an MPA polygon but still too close
    to it."""
    closed = list(polygon) + [polygon[0]]
    return point_to_polyline_distance_nm(lat, lon, closed)


def mpa_polygon(mpa: Dict[str, Any]) -> List[List[float]]:
    """An MPA's `polygon` field if present (real GeoJSON-style shape),
    otherwise its `bounds` box treated as a 4-vertex polygon. Lets any MPA
    upgrade from a bounding box to a real polygon just by adding a
    `polygon` field to mpas.json, with no code changes required anywhere
    that calls this helper."""
    return mpa.get("polygon") or mpa.get("bounds") or []

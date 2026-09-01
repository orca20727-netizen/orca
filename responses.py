from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class Waypoint(BaseModel):
    lat: float
    lon: float


class RouteResponse(BaseModel):
    route_found: bool
    waypoints: List[Waypoint] = []
    distance_nm: Optional[float] = None
    straight_line_distance_nm: Optional[float] = None
    detour_nm: Optional[float] = None
    detour_percent: Optional[float] = None
    avoided_mpas: List[str] = []
    land_avoidance: bool = True
    mpa_avoidance_active: bool = True
    route_source: str = "A_STAR"
    eta_hours: Optional[float] = None
    estimated_return_ist: Optional[str] = None
    dusk_safety_verdict: Optional[str] = None
    reason: Optional[str] = None
    detail: Optional[str] = None


class AdvisoryResponse(BaseModel):
    advisory_text: str
    confidence_pct: int
    citations: List[str] = []
    llm_engine: str
    intent: Optional[str] = None


class TelemetryResponse(BaseModel):
    plan: Dict[str, Any] = {}
    satellite: Dict[str, Any] = {}
    weather: Dict[str, Any] = {}
    pfz: Dict[str, Any] = {}
    geofence: Dict[str, Any] = {}
    fleet: Dict[str, Any] = {}
    eta: Dict[str, Any] = {}
    query: Optional[str] = None

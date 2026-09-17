from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from constants import DEFAULT_HARBOUR_ID, DEFAULT_PFZ_ID, MAX_QUERY_LENGTH
from language import SUPPORTED_LANGUAGES


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=MAX_QUERY_LENGTH)
    # Optional, not just defaulted: a caller (or a future frontend change)
    # sending JSON null here used to fail Pydantic validation outright
    # (`str` doesn't accept None), even though "no harbour/PFZ selected
    # yet" is a perfectly normal state -- None now means exactly that, and
    # the endpoint substitutes the same defaults it always has.
    origin_harbour: Optional[str] = None
    target_pfz: Optional[str] = None
    # Set only when the user deliberately changes the UI language selector.
    # If omitted, the backend replies in the query's detected language.
    response_language: Optional[str] = Field(default=None, max_length=8)
    session_id: Optional[str] = Field(default=None, min_length=8, max_length=100)
    history: List["ChatTurn"] = Field(default_factory=list, max_length=6)
    # Deliberately opt-in: useful for demonstrations/debugging, while normal
    # requests exercise the intent-driven collaboration plan.
    force_full_pipeline: bool = False

    @field_validator("query")
    @classmethod
    def _strip_query(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("query must not be blank")
        return v

    @field_validator("response_language")
    @classmethod
    def _supported_response_language(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.lower().strip()
        if v not in SUPPORTED_LANGUAGES:
            raise ValueError(
                f"response_language must be one of {', '.join(sorted(SUPPORTED_LANGUAGES))}"
            )
        return v


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(..., min_length=1, max_length=2000)


class RouteRequest(BaseModel):
    """
    Route can be resolved either from known harbour/PFZ ids (the common
    frontend case) or from raw coordinates (e.g. a custom vessel position).
    At least one complete pair (harbour+pfz, or origin+destination lat/lon)
    must be resolvable -- validated in the endpoint, since which fields are
    "required" depends on which mode is being used.
    """

    origin_harbour: Optional[str] = DEFAULT_HARBOUR_ID
    target_pfz: Optional[str] = DEFAULT_PFZ_ID

    origin_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    origin_lon: Optional[float] = Field(default=None, ge=-180, le=180)
    destination_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    destination_lon: Optional[float] = Field(default=None, ge=-180, le=180)


class VesselTelemetry(BaseModel):
    """A normalized GPS/AIS position record accepted from a tracker gateway."""
    id: str = Field(..., min_length=1, max_length=80)
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    name: str = Field(default="Unnamed vessel", max_length=120)
    speed_knots: float = Field(default=0, ge=0, le=100)
    heading: float = Field(default=0, ge=0, lt=360)
    zone: str = Field(default="UNASSIGNED", max_length=80)
    status: str = Field(default="TRANSIT", max_length=40)
    type: str = Field(default="Fishing vessel", max_length=80)
    owner: str = Field(default="Not supplied", max_length=120)
    imbl_dist_nm: Optional[float] = Field(default=None, ge=0)
    fuel_pct: Optional[float] = Field(default=None, ge=0, le=100)


class VesselTelemetryBatch(BaseModel):
    vessels: List[VesselTelemetry] = Field(..., min_length=1, max_length=10000)
    observed_at: Optional[str] = Field(default=None, max_length=64)
    source: str = Field(default="GPS/AIS tracker push", min_length=1, max_length=160)


# ---------------------------------------------------------------------
# ORCA Fisherman -- AI Decision Studio. All prediction/decision work these
# requests trigger runs on ORCA's own locally-trained models (see
# backend/ml/) -- no external AI API of any kind is involved.
# ---------------------------------------------------------------------
class TripPlanRequest(BaseModel):
    """The Trip Planner form. Every field has a sane default so the
    endpoint can be exercised (and the frontend can show a first result)
    without the fisherman filling in everything."""
    lat: float = Field(default=9.85, ge=-90, le=90)
    lon: float = Field(default=75.60, ge=-180, le=180)
    boat_type: str = Field(default="Motorized")
    gear_type: str = Field(default="Ring Seine")
    target_species: Optional[str] = Field(default=None, max_length=40)
    trip_duration_hours: float = Field(default=8.0, ge=1, le=48)
    fuel_budget: Optional[float] = Field(default=None, ge=0)
    month: Optional[int] = Field(default=None, ge=1, le=12)


class CatchPredictionRequest(BaseModel):
    zone_id: Optional[str] = Field(default=None, max_length=20)
    lat: float = Field(default=9.85, ge=-90, le=90)
    lon: float = Field(default=75.60, ge=-180, le=180)
    species: str = Field(default="Mackerel", max_length=40)
    gear_type: str = Field(default="Ring Seine", max_length=40)
    boat_type: str = Field(default="Motorized", max_length=40)
    trip_duration_hours: float = Field(default=8.0, ge=1, le=48)
    hour_of_day: int = Field(default=6, ge=0, le=23)
    month: Optional[int] = Field(default=None, ge=1, le=12)


class PricePredictionRequest(BaseModel):
    species: str = Field(default="Mackerel", max_length=40)
    month: Optional[int] = Field(default=None, ge=1, le=12)


class ZoneRecommendationRequest(BaseModel):
    lat: float = Field(default=9.85, ge=-90, le=90)
    lon: float = Field(default=75.60, ge=-180, le=180)
    month: Optional[int] = Field(default=None, ge=1, le=12)


class SpeciesRecommendationRequest(BaseModel):
    zone_id: Optional[str] = Field(default=None, max_length=20)
    lat: float = Field(default=9.85, ge=-90, le=90)
    lon: float = Field(default=75.60, ge=-180, le=180)
    month: Optional[int] = Field(default=None, ge=1, le=12)


class ProfitCalculationRequest(BaseModel):
    catch_kg: float = Field(..., ge=0)
    price_per_kg: float = Field(..., ge=0)
    fuel_cost: float = Field(default=4200, ge=0)
    ice_cost: float = Field(default=1200, ge=0)
    food_cost: float = Field(default=0, ge=0)
    maintenance_cost: float = Field(default=0, ge=0)
    transportation_cost: float = Field(default=0, ge=0)
    other_cost: float = Field(default=600, ge=0)


class RiskCalculationRequest(BaseModel):
    lat: float = Field(default=9.85, ge=-90, le=90)
    lon: float = Field(default=75.60, ge=-180, le=180)
    trip_duration_hours: float = Field(default=8.0, ge=1, le=48)
    distance_from_port_km: float = Field(default=20.0, ge=0)

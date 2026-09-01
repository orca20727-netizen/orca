from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from constants import DEFAULT_HARBOUR_ID, DEFAULT_PFZ_ID, MAX_QUERY_LENGTH


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=MAX_QUERY_LENGTH)
    origin_harbour: str = DEFAULT_HARBOUR_ID
    target_pfz: str = DEFAULT_PFZ_ID
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
        if v not in {"en", "hi", "ta", "ml"}:
            raise ValueError("response_language must be one of en, hi, ta, ml")
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

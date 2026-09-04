"""
Shared application state: data loading, agent instantiation, and the
multi-agent pipeline runner. Kept separate from both main.py (which should
only create the FastAPI app, configure middleware, and register routers)
and backend/api/routes.py (which should only define HTTP/WebSocket
endpoints) so each file has one job.
"""

import json
import logging
import asyncio
import os
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple

from agents.supervisor import SupervisorAgent
from agents.satellite_agent import SatelliteAgent
from agents.weather_agent import WeatherHazardAgent
from agents.pfz_agent import OceanAnalyticsPFZAgent
from agents.geofencing_agent import GeofencingAgent
from agents.fleet_agent import FleetTrafficAgent
from agents.eta_agent import ETAVoyageSafetyAgent
from agents.synthesis_agent import NeuralSynthesisAgent
from agents.route_planner import RoutePlanner

from constants import DEFAULT_HARBOUR_ID, DEFAULT_PFZ_ID
from language import detect_query_language
from session_store import session_store
from data_source_registry import data_source_registry
from stats_store import stats_store

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

# Used only if data/harbours.json or data/pfz_zones.json can't be read
# (missing file, corrupted JSON) -- keeps origin/destination resolution
# working in offline/degraded mode instead of crashing app startup.
_FALLBACK_HARBOURS = {
    DEFAULT_HARBOUR_ID: {"id": DEFAULT_HARBOUR_ID, "name": "Kochi Fisheries Harbour (Thoppumpady)", "coordinates": [9.93, 76.26]},
}
_FALLBACK_PFZ_ZONES = {
    DEFAULT_PFZ_ID: {"id": DEFAULT_PFZ_ID, "name": "Kochi Deep Offshore (Malabar)", "center": [9.85, 75.60]},
}


def _load_json(filename: str) -> Optional[Dict[str, Any]]:
    try:
        with open(os.path.join(DATA_DIR, filename), "r") as f:
            return json.load(f)
    except Exception as e:
        logger.warning("core: could not load %s (%s)", filename, e)
        return None


def _load_harbours() -> Dict[str, Any]:
    data = _load_json("harbours.json")
    if not data or not data.get("harbours"):
        return _FALLBACK_HARBOURS
    return {h["id"]: h for h in data["harbours"]}


def _load_pfz_zones() -> Dict[str, Any]:
    data = _load_json("pfz_zones.json")
    if not data or not data.get("zones"):
        return _FALLBACK_PFZ_ZONES
    return {z["id"]: z for z in data["zones"]}


def _load_mpas() -> list:
    data = _load_json("mpas.json")
    return data.get("mpas", []) if data else []


def _load_land_polygons() -> list:
    data = _load_json("land_mask.json")
    return [p["polygon"] for p in data.get("land_polygons", [])] if data else []


HARBOURS = _load_harbours()
PFZ_ZONES = _load_pfz_zones()
MPAS = _load_mpas()
LAND_POLYGONS = _load_land_polygons()

# A single shared RoutePlanner instance, loaded once from the same MPA and
# land-mask data used everywhere else. Both the ETA agent (used by the
# /api/advisory/synthesize pipeline) and the standalone /api/route endpoint
# are handed this exact instance, so the frontend and the advisory pipeline
# can never disagree about a route -- there is only one routing engine and
# one copy of the underlying geography. The safety buffer matches the same
# MPA_SAFETY_BUFFER_NM env var the Geofencing Agent uses, so a route is
# never reported "clear" of an MPA that the geofence check would still
# flag as a proximity warning.
route_planner = RoutePlanner(
    MPAS,
    land_polygons=LAND_POLYGONS,
    mpa_safety_buffer_nm=float(os.getenv("MPA_SAFETY_BUFFER_NM", "2.0")),
)

# Instantiate Agents
supervisor = SupervisorAgent()
satellite_agent = SatelliteAgent()
weather_agent = WeatherHazardAgent()
pfz_agent = OceanAnalyticsPFZAgent()
geofence_agent = GeofencingAgent()
fleet_agent = FleetTrafficAgent()
eta_agent = ETAVoyageSafetyAgent(planner=route_planner)
synthesis_agent = NeuralSynthesisAgent()

FALLBACK_ADVISORY = {
    "advisory_text": (
        "Neural Synthesis is temporarily unavailable. Please review the raw "
        "telemetry panels below and apply standard maritime safety precautions."
    ),
    "confidence_pct": 0,
    "citations": [],
    "llm_engine": "UNAVAILABLE (synthesis error)",
}


def harbour_coords(harbour_id: str) -> Tuple[float, float]:
    h = HARBOURS.get(harbour_id) or HARBOURS.get(DEFAULT_HARBOUR_ID) or next(iter(HARBOURS.values()))
    return tuple(h["coordinates"])


def pfz_coords(pfz_id: str) -> Tuple[float, float]:
    z = PFZ_ZONES.get(pfz_id) or PFZ_ZONES.get(DEFAULT_PFZ_ID) or next(iter(PFZ_ZONES.values()))
    return tuple(z["center"])


async def safe_call(
    agent_name: str,
    call: Callable[[], Awaitable[Dict[str, Any]]],
    fallback: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Runs a single agent step in isolation so one agent raising (a bad
    data file, an unexpected exception, anything not already caught inside
    the agent itself) degrades that one node instead of taking down the
    whole advisory pipeline. Logs the failure and hands back either the
    given fallback payload or a small degraded telemetry dict -- either
    way something the rest of the DAG (and the Synthesis Agent's
    `.get(..., default)` calls) can still consume safely."""
    try:
        return await call()
    except Exception as e:
        logger.exception("%s failed -- degrading this node instead of failing the whole request", agent_name)
        degraded = dict(fallback) if fallback else {}
        degraded["error"] = str(e)
        degraded["status"] = "DEGRADED_AGENT_FAILURE"
        return degraded


_AGENT_KEYS = ("satellite", "weather", "pfz", "geofence", "fleet", "eta")


def _skipped_agent(reason: str) -> Dict[str, Any]:
    return {"status": "SKIPPED", "reason": reason, "data_source": "NOT_INVOKED"}


async def run_pipeline(query: str, origin_harbour: str, target_pfz: str, response_language: Optional[str] = None, session_id: Optional[str] = None, history: Optional[list] = None, force_full_pipeline: bool = False) -> Dict[str, Any]:
    """Run only the supervisor-selected agents, plus synthesis downstream.

    `force_full_pipeline` is an explicit judge/demo escape hatch. Skipped
    nodes remain in telemetry with provenance so consumers never confuse
    unavailable data with a completed agent result.
    """
    context = session_store.resolve(session_id, query, origin_harbour, target_pfz, history or [])
    origin_harbour, target_pfz = context["origin_harbour"], context["target_pfz"]
    origin_lat, origin_lon = harbour_coords(origin_harbour)
    dest_lat, dest_lon = pfz_coords(target_pfz)

    language = detect_query_language(query)
    if response_language:
        language["response_code"] = response_language
        language["response_overridden"] = True
    else:
        language["response_overridden"] = False
    plan = await safe_call("Master Supervisor", lambda: supervisor.plan_dag(query, language["detected_code"] if language["supported"] else "en"))
    selected = set(_AGENT_KEYS if force_full_pipeline else plan.get("relevant_agents", []))
    # ETA depends on live weather, but it is not an independent agent choice.
    if "eta" in selected:
        selected.add("weather")
    initial_selected = sorted(selected)
    results: Dict[str, Dict[str, Any]] = {key: _skipped_agent("Not invoked for this query — intent did not require it") for key in _AGENT_KEYS}

    calls = {
        "satellite": lambda: safe_call("Satellite Oceanography", lambda: satellite_agent.fetch_oceanography(lat=origin_lat, lon=origin_lon)),
        "weather": lambda: safe_call("Weather & Hazard", lambda: weather_agent.evaluate_hazard(lat=origin_lat, lon=origin_lon)),
        "pfz": lambda: safe_call("Ocean Analytics PFZ", lambda: pfz_agent.rank_pfz_zones(vessel_lat=origin_lat, vessel_lon=origin_lon)),
        "geofence": lambda: safe_call("Geofencing & Routing", lambda: geofence_agent.check_geofences(lat=dest_lat, lon=dest_lon)),
        "fleet": lambda: safe_call("Fleet & Traffic", lambda: fleet_agent.analyze_fleet(pfz_id=target_pfz)),
    }
    independent = [key for key in ("satellite", "weather", "pfz", "geofence", "fleet") if key in selected]
    if independent:
        values = await asyncio.gather(*(calls[key]() for key in independent))
        results.update(dict(zip(independent, values)))

    reactive = [] if force_full_pipeline else supervisor.reactive_agents(plan.get("intent", ""), results["weather"])
    for key in reactive:
        if key not in selected:
            selected.add(key)
            results[key] = await calls[key]()

    if "eta" in selected:
        results["eta"] = await safe_call(
            "ETA & Voyage Safety",
            lambda: eta_agent.calculate_voyage(
                wave_height_m=results["weather"].get("significant_wave_height_m", 1.25),
                origin=(origin_lat, origin_lon), destination=(dest_lat, dest_lon),
            ),
        )
    plan.update({
        "initial_relevant_agents": initial_selected,
        "executed_agents": [key for key in _AGENT_KEYS if key in selected],
        "skipped_agents": [key for key in _AGENT_KEYS if key not in selected],
        "reactively_added_agents": reactive,
        "force_full_pipeline": force_full_pipeline,
    })
    sat_data, weather_data, pfz_data = results["satellite"], results["weather"], results["pfz"]
    geo_data, fleet_data, eta_data = results["geofence"], results["fleet"], results["eta"]

    # Record every completed (non-skipped, non-degraded) agent reading into
    # the site's own persistent stats ledger. This is the "continuously
    # stored" historical data backend/agents/synthesis_agent.py's trend
    # clauses compare each new live reading against -- there is no external
    # AI/API involved anywhere in this pipeline, only this website's own
    # accumulated numbers.
    def _record(agent_key: str, data: Dict[str, Any], numeric_fields: Tuple[str, ...]) -> None:
        if data.get("status") in ("SKIPPED", "DEGRADED_AGENT_FAILURE"):
            return
        metrics = {field: data.get(field) for field in numeric_fields if isinstance(data.get(field), (int, float))}
        if metrics:
            stats_store.record_reading(agent_key, target_pfz, metrics)

    _record("weather", weather_data, ("significant_wave_height_m", "surface_wind_knots", "safety_score"))
    _record("satellite", sat_data, ("sst_celsius", "chlorophyll_mg_m3"))
    _record("pfz", pfz_data, ("yield_score_pct", "distance_from_vessel_nm"))
    _record("fleet", fleet_data, ("vessels_in_target_zone",))
    _record("eta", eta_data, ("one_way_eta_hours", "route_distance_nm"))

    return {
        "plan": plan,
        "satellite": sat_data,
        "weather": weather_data,
        "pfz": pfz_data,
        "geofence": geo_data,
        "fleet": fleet_data,
        "eta": eta_data,
        "query": query,
        "language": language,
        "conversation_context": {"session_id": session_id, "history": context["history"], "carried_forward": context["carried_forward"], "resolved_origin_harbour": origin_harbour, "resolved_target_pfz": target_pfz},
        "source_provenance": {
            "ocean": {"tier": sat_data.get("source_tier"), "data_source": sat_data.get("data_source"), "registry": data_source_registry.for_dataset("ocean_sst_weather")},
            "pfz": {"data_source": pfz_data.get("data_source"), "registry": data_source_registry.for_dataset("pfz_advisory")},
            "fleet": {"data_source": fleet_data.get("data_source")},
        },
    }

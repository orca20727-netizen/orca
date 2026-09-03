"""
All ORCA INSIGHT HTTP + WebSocket endpoints, as an APIRouter included by
main.py. main.py itself only creates the FastAPI app, configures CORS/
middleware, and registers this router -- endpoint logic lives here, and
shared app state (loaded datasets, agent instances, the pipeline runner)
lives in backend/core.py.
"""

import asyncio
import hmac
import json
import logging
import os
from typing import Tuple

from fastapi import APIRouter, Header, HTTPException, Query, WebSocket, WebSocketDisconnect

from models.requests import QueryRequest, RouteRequest, VesselTelemetryBatch
from constants import DEFAULT_HARBOUR_ID, DEFAULT_PFZ_ID
import core
from live_data import live_data
from data_source_registry import data_source_registry
from alert_service import alert_service
from geofence_alerts import GEOFENCE_WARNING_NM, geofence_alert_for

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/health")
async def health_check():
    return {
        "status": "HEALTHY",
        "service": "ORCA INSIGHT Core Engine",
        "team": "SavioursX",
        "problem_statement": "PS 26176 (ISRO)",
        "active_agents": 8,
        "subsystems": {
            "groq_llm": "CONFIGURED" if os.getenv("GROQ_API_KEY") else "NOT_CONFIGURED (deterministic fallback only)",
            "pfz_dataset": "LOADED" if not core.pfz_agent._using_fallback else "FALLBACK_SNAPSHOT",
            "fleet_dataset": "LOADED" if core.fleet_agent._load_error is None else "FALLBACK_SNAPSHOT",
            "mpa_dataset": f"LOADED ({len(core.MPAS)} zones)" if core.MPAS else "UNAVAILABLE (routing without MPA avoidance)",
            "land_mask": f"LOADED ({len(core.LAND_POLYGONS)} polygons)" if core.LAND_POLYGONS else "UNAVAILABLE (routing without land avoidance)",
        },
    }


@router.get("/api/alerts")
async def list_alerts(limit: int = Query(default=100, ge=1, le=500)):
    """Recent server-generated hazard alerts with per-alert provenance."""
    return {"alerts": alert_service.store.list(limit), "data_source": "PROACTIVE_HAZARD_EVALUATOR"}


@router.websocket("/ws/alerts")
async def websocket_alerts(websocket: WebSocket):
    """Push newly-created alerts while the app/PWA remains connected."""
    await websocket.accept()
    queue = alert_service.subscribe()
    try:
        await websocket.send_json({"type": "ALERT_SNAPSHOT", "alerts": alert_service.store.list(100)})
        while True:
            alert = await queue.get()
            await websocket.send_json({"type": "ALERT_CREATED", "alert": alert})
    except WebSocketDisconnect:
        pass
    finally:
        alert_service.unsubscribe(queue)


def _resolve_route_endpoints(req: RouteRequest) -> Tuple[Tuple[float, float], Tuple[float, float]]:
    """Resolves a RouteRequest to concrete (origin, destination) lat/lon
    pairs. Raises HTTPException(404) for an unknown harbour/PFZ id, and
    HTTPException(400) if neither a harbour+pfz pair nor raw coordinates
    were resolvable."""
    has_raw_coords = None not in (req.origin_lat, req.origin_lon, req.destination_lat, req.destination_lon)

    if has_raw_coords:
        return (req.origin_lat, req.origin_lon), (req.destination_lat, req.destination_lon)

    if req.origin_harbour and req.origin_harbour not in core.HARBOURS:
        raise HTTPException(status_code=404, detail=f"Unknown origin_harbour '{req.origin_harbour}'.")
    if req.target_pfz and req.target_pfz not in core.PFZ_ZONES:
        raise HTTPException(status_code=404, detail=f"Unknown target_pfz '{req.target_pfz}'.")

    if req.origin_harbour and req.target_pfz:
        return core.harbour_coords(req.origin_harbour), core.pfz_coords(req.target_pfz)

    raise HTTPException(
        status_code=400,
        detail="Provide either (origin_harbour and target_pfz) or all four of "
        "(origin_lat, origin_lon, destination_lat, destination_lon).",
    )


@router.post("/api/route")
async def plan_route(req: RouteRequest):
    """
    Standalone routing endpoint: the frontend calls this directly to draw
    the map route, instead of computing its own midpoint/fake waypoints.
    Uses the exact same shared RoutePlanner instance (and therefore the
    exact same distance) as the /api/advisory/synthesize pipeline's ETA
    calculation, so the map, the displayed distance, and the ETA can never
    disagree with each other.
    """
    origin, destination = _resolve_route_endpoints(req)

    try:
        result = core.route_planner.plan_route(origin, destination)
    except Exception as e:
        logger.exception("Route planner raised unexpectedly")
        raise HTTPException(status_code=500, detail="Internal routing error.") from e

    if not result.get("route_found"):
        return {
            "route_found": False,
            "reason": result.get("reason", "NO_SAFE_MARITIME_ROUTE"),
            "detail": result.get("detail"),
            "waypoints": [],
            "land_avoidance": True,
            "mpa_avoidance_active": True,
        }

    # ETA reuses the exact routed distance (not a re-derived straight-line
    # figure) so distance and ETA can never disagree with the map.
    eta = await core.eta_agent.calculate_voyage(distance_nm=result["route_distance_nm"])

    return {
        "route_found": True,
        "waypoints": result["waypoints"],
        "distance_nm": result["route_distance_nm"],
        "straight_line_distance_nm": result["straight_line_distance_nm"],
        "detour_nm": result["detour_nm"],
        "detour_percent": result["detour_percent"],
        "avoided_mpas": result["avoided_mpas"],
        "land_avoidance": result["land_avoidance"],
        "mpa_avoidance_active": result["mpa_avoidance_active"],
        "route_source": result["route_source"],
        "eta_hours": eta.get("one_way_eta_hours"),
        "effective_speed_knots": eta.get("effective_speed_knots"),
        "estimated_return_ist": eta.get("estimated_return_ist"),
        "dusk_safety_verdict": eta.get("dusk_safety_verdict"),
    }


@router.get("/api/pfz")
async def get_pfz(
    lat: float = Query(9.85, ge=-90, le=90),
    lon: float = Query(75.60, ge=-180, le=180),
):
    return await core.pfz_agent.rank_pfz_zones(vessel_lat=lat, vessel_lon=lon)


@router.get("/api/geofence")
async def get_geofence(
    lat: float = Query(9.85, ge=-90, le=90),
    lon: float = Query(75.60, ge=-180, le=180),
):
    result = await core.geofence_agent.check_geofences(lat=lat, lon=lon)
    return {**result, "geofence_warning_threshold_nm": GEOFENCE_WARNING_NM, "proximity_alert": geofence_alert_for(result)}


@router.get("/api/weather")
async def get_weather(
    lat: float = Query(9.85, ge=-90, le=90),
    lon: float = Query(75.60, ge=-180, le=180),
):
    return await core.weather_agent.evaluate_hazard(lat=lat, lon=lon)


@router.get("/api/ocean")
async def get_ocean(
    lat: float = Query(9.85, ge=-90, le=90),
    lon: float = Query(75.60, ge=-180, le=180),
):
    return await core.satellite_agent.fetch_oceanography(lat=lat, lon=lon)


@router.get("/api/fleet")
async def get_fleet(pfz_id: str = DEFAULT_PFZ_ID):
    return await core.fleet_agent.analyze_fleet(pfz_id=pfz_id)


@router.get("/api/live/status")
async def live_status():
    """Source, observation time, and ingestion time for every live feed."""
    from ais_gateway import get_gateway_state
    return {
        "snapshots": live_data.status(),
        "source_registry": data_source_registry.status,
        "ais_gateway": get_gateway_state(),
    }
    


@router.get("/api/data-sources")
async def data_sources():
    """Allowlisted discovery candidates and their last reachability check."""
    return data_source_registry.status


@router.post("/api/live/refresh")
async def refresh_live_feeds():
    """Manually refresh configured vessel/PFZ feeds (useful for an operator)."""
    return {"results": await live_data.refresh_all()}


@router.get("/api/live/vessels")
async def live_vessels():
    snapshot = live_data.store.latest("vessel")
    if snapshot:
        return snapshot
    from ais_gateway import get_gateway_state
    return {"payload": [], "status": "NOT_CONFIGURED", "ais_gateway": get_gateway_state()}


@router.get("/api/live/pfz")
async def live_pfz():
    snapshot = live_data.store.latest("pfz")
    return snapshot or {"payload": [], "status": "NOT_CONFIGURED"}


@router.post("/api/telemetry/vessels", status_code=202)
async def ingest_vessel_telemetry(
    batch: VesselTelemetryBatch,
    authorization: str | None = Header(default=None),
):
    """Receive normalized positions pushed by an AIS/GPS tracker gateway.

    Set TELEMETRY_INGEST_TOKEN before exposing this route. The token is
    required in an ``Authorization: Bearer <token>`` header and is never
    exposed to the browser.
    """
    expected_token = os.getenv("TELEMETRY_INGEST_TOKEN", "")
    received_token = authorization.removeprefix("Bearer ") if authorization else ""
    if not expected_token:
        raise HTTPException(status_code=503, detail="Telemetry ingestion is not configured.")
    if not hmac.compare_digest(received_token, expected_token):
        raise HTTPException(status_code=401, detail="Invalid telemetry credentials.")

    vessels = [vessel.model_dump() for vessel in batch.vessels]
    live_data.store.save("vessel", vessels, batch.source, batch.observed_at)
    return {"status": "ACCEPTED", "accepted_vessels": len(vessels), "observed_at": batch.observed_at}


@router.post("/api/advisory/synthesize")
async def synthesize_advisory(req: QueryRequest):
    if req.origin_harbour not in core.HARBOURS:
        raise HTTPException(status_code=404, detail=f"Unknown origin_harbour '{req.origin_harbour}'.")
    if req.target_pfz not in core.PFZ_ZONES:
        raise HTTPException(status_code=404, detail=f"Unknown target_pfz '{req.target_pfz}'.")

    telemetry = await core.run_pipeline(req.query, req.origin_harbour, req.target_pfz, req.response_language, req.session_id, [turn.model_dump() for turn in req.history], req.force_full_pipeline)
    final_advisory = await core.safe_call(
        "Neural Synthesis", lambda: core.synthesis_agent.synthesize(telemetry), fallback=core.FALLBACK_ADVISORY
    )
    context = telemetry.get("conversation_context", {})
    core.session_store.record(req.session_id, req.query, final_advisory.get("advisory_text", ""), context.get("resolved_origin_harbour", req.origin_harbour), context.get("resolved_target_pfz", req.target_pfz))

    return {
        "telemetry": telemetry,
        "advisory": final_advisory,
        "language": telemetry.get("language"),
        "conversation": context,
    }


@router.websocket("/ws/agent-trace")
async def websocket_agent_trace(websocket: WebSocket):
    await websocket.accept()
    try:
        data = await websocket.receive_text()
        req_json = json.loads(data)
        query = req_json.get("query", "Default Marine Safety Query")
        origin_harbour = req_json.get("origin_harbour", DEFAULT_HARBOUR_ID)
        target_pfz = req_json.get("target_pfz", DEFAULT_PFZ_ID)
        telemetry = await core.run_pipeline(
            query, origin_harbour, target_pfz,
            force_full_pipeline=bool(req_json.get("force_full_pipeline", False)),
        )
        # The trace reports the same intent-driven execution that produced
        # telemetry; nodes omitted from the plan are explicit, not silently
        # rendered as successful work.
        await websocket.send_json({"type": "AGENT_STEP_START", "agent": "Master Supervisor"})
        await websocket.send_json({"type": "AGENT_STEP_COMPLETE", "agent": "Master Supervisor", "output": telemetry["plan"]})
        agent_events = [
            ("Satellite Oceanography", "satellite"), ("Weather & Hazard", "weather"),
            ("Ocean Analytics PFZ", "pfz"), ("Geofencing & Routing", "geofence"),
            ("Fleet & Traffic", "fleet"), ("ETA & Voyage Safety", "eta"),
        ]
        for agent_name, key in agent_events:
            output = telemetry[key]
            if output.get("status") == "SKIPPED":
                await websocket.send_json({"type": "AGENT_SKIPPED", "agent": agent_name, "reason": output["reason"], "output": output})
            else:
                await websocket.send_json({"type": "AGENT_STEP_START", "agent": agent_name})
                await websocket.send_json({"type": "AGENT_STEP_COMPLETE", "agent": agent_name, "output": output})

        # Final LLM Synthesis — emitted as its own DAG step so the visualizer
        # can animate all 8 nodes consistently, not just the first 7
        await websocket.send_json({
            "type": "AGENT_STEP_START",
            "agent": "Neural Synthesis"
        })
        synth_result = await core.safe_call(
            "Neural Synthesis", lambda: core.synthesis_agent.synthesize(telemetry), fallback=core.FALLBACK_ADVISORY
        )
        await websocket.send_json({
            "type": "AGENT_STEP_COMPLETE",
            "agent": "Neural Synthesis",
            "output": synth_result
        })

        await websocket.send_json({
            "type": "PIPELINE_COMPLETE",
            "telemetry": telemetry,
            "advisory": synth_result
        })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "PIPELINE_ERROR", "message": str(e)})
        except Exception:
            pass

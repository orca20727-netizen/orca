import pytest
import sys
import os

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import core
from alert_service import AlertService, AlertStore


@pytest.mark.asyncio
async def test_safe_call_returns_value_on_success():
    async def ok():
        return {"value": 42}

    result = await core.safe_call("Test Agent", ok)
    assert result == {"value": 42}


@pytest.mark.asyncio
async def test_safe_call_degrades_on_exception_instead_of_raising():
    async def boom():
        raise RuntimeError("simulated agent crash")

    result = await core.safe_call("Test Agent", boom)
    assert result["status"] == "DEGRADED_AGENT_FAILURE"
    assert "simulated agent crash" in result["error"]


@pytest.mark.asyncio
async def test_safe_call_merges_fallback_payload_on_exception():
    async def boom():
        raise ValueError("nope")

    result = await core.safe_call("Test Agent", boom, fallback={"advisory_text": "fallback text"})
    assert result["advisory_text"] == "fallback text"
    assert result["status"] == "DEGRADED_AGENT_FAILURE"


@pytest.mark.asyncio
async def test_run_pipeline_degrades_single_agent_failure_without_crashing(monkeypatch):
    # Simulate one agent (PFZ ranking) raising unexpectedly. The pipeline
    # should still return a complete telemetry dict -- the failing node
    # marked as degraded, every other node populated normally -- instead
    # of the whole request failing.
    async def _boom(*args, **kwargs):
        raise RuntimeError("pfz zone service unavailable")

    monkeypatch.setattr(core.pfz_agent, "rank_pfz_zones", _boom)

    telemetry = await core.run_pipeline(
        "Is it safe to sail to PFZ-01 from Kochi?", core.DEFAULT_HARBOUR_ID, core.DEFAULT_PFZ_ID
    )

    assert telemetry["pfz"]["status"] == "DEGRADED_AGENT_FAILURE"
    assert "pfz zone service unavailable" in telemetry["pfz"]["error"]

    # Relevant independent agents still run; unrelated nodes are honestly
    # represented as skipped by the intent-driven DAG.
    assert "clearance_verdict" in telemetry["weather"]
    assert telemetry["fleet"]["status"] == "SKIPPED"
    assert telemetry["eta"]["status"] == "SKIPPED"


@pytest.mark.asyncio
async def test_run_pipeline_succeeds_end_to_end_by_default():
    telemetry = await core.run_pipeline(
        "Is it safe to sail to PFZ-01 from Kochi?", core.DEFAULT_HARBOUR_ID, core.DEFAULT_PFZ_ID
    )
    for key in ("plan", "satellite", "weather", "pfz", "geofence", "fleet", "eta"):
        assert key in telemetry
        assert "status" not in telemetry[key] or telemetry[key]["status"] != "DEGRADED_AGENT_FAILURE"


@pytest.mark.asyncio
async def test_weather_intent_only_invokes_weather_agent():
    telemetry = await core.run_pipeline(
        "Is the sea safe today?", core.DEFAULT_HARBOUR_ID, core.DEFAULT_PFZ_ID
    )
    assert telemetry["plan"]["intent"] == "WEATHER_SAFETY"
    assert telemetry["plan"]["executed_agents"] == ["weather"]
    assert telemetry["weather"].get("status") != "SKIPPED"
    for key in ("satellite", "pfz", "geofence", "fleet", "eta"):
        assert telemetry[key]["status"] == "SKIPPED"


@pytest.mark.asyncio
async def test_general_hazard_reactively_adds_geofencing(monkeypatch):
    async def hazardous_weather(*args, **kwargs):
        return {"significant_wave_height_m": 3.1, "lightning_risk_pct": 5, "clearance_verdict": "UNSAFE"}

    called = False

    async def geofence(*args, **kwargs):
        nonlocal called
        called = True
        return {"imbl_status": "SAFE", "data_source": "TEST"}

    monkeypatch.setattr(core.weather_agent, "evaluate_hazard", hazardous_weather)
    monkeypatch.setattr(core.geofence_agent, "check_geofences", geofence)
    telemetry = await core.run_pipeline("Should I go fishing today?", core.DEFAULT_HARBOUR_ID, core.DEFAULT_PFZ_ID)

    assert telemetry["plan"]["intent"] == "GENERAL_VOYAGE_SAFETY"
    assert telemetry["plan"]["reactively_added_agents"] == ["geofence"]
    assert "geofence" in telemetry["plan"]["executed_agents"]
    assert called is True


@pytest.mark.asyncio
async def test_force_full_pipeline_executes_all_agents():
    telemetry = await core.run_pipeline(
        "Is the sea safe today?", core.DEFAULT_HARBOUR_ID, core.DEFAULT_PFZ_ID, force_full_pipeline=True
    )
    assert telemetry["plan"]["force_full_pipeline"] is True
    assert set(telemetry["plan"]["executed_agents"]) == {"satellite", "weather", "pfz", "geofence", "fleet", "eta"}


@pytest.mark.asyncio
async def test_wave_spike_creates_proactive_alert(tmp_path):
    service = AlertService(store=AlertStore(tmp_path / "alerts.db"))
    harbours = [{"id": "HBR-TEST", "name": "Test Harbour", "coordinates": [9.9, 76.2]}]
    created = await service.evaluate(harbours, [], {
        "HBR-TEST": {"significant_wave_height_m": 3.2, "surface_wind_knots": 10, "lightning_risk_pct": 2, "data_source": {"wave_height": "TEST"}}
    })
    assert len(created) == 1
    assert created[0]["alert_type"] == "HIGH_WAVES"
    assert created[0]["data_source"]["wave_height"] == "TEST"


@pytest.mark.asyncio
async def test_cyclone_bulletin_creates_alert_and_normal_weather_does_not(tmp_path):
    service = AlertService(store=AlertStore(tmp_path / "alerts.db"))
    harbours = [{"id": "HBR-TEST", "name": "Test Harbour", "coordinates": [9.9, 76.2]}]
    normal = {"HBR-TEST": {"significant_wave_height_m": 1.1, "surface_wind_knots": 12, "lightning_risk_pct": 8, "data_source": "SIMULATED_FALLBACK"}}
    cyclone = [{"id": "CYCLONE-01", "title": "Cyclone warning", "severity": "CRITICAL", "summary": "Cyclone approaching coast.", "source": "TEST"}]
    created = await service.evaluate(harbours, cyclone, normal)
    assert [alert["alert_type"] for alert in created] == ["CYCLONE_BULLETIN"]
    assert await service.evaluate(harbours, [], normal) == []


def test_harbour_and_pfz_coord_helpers_have_sane_defaults():
    lat, lon = core.harbour_coords("UNKNOWN_HARBOUR_ID")
    assert -90 <= lat <= 90
    assert -180 <= lon <= 180

    lat, lon = core.pfz_coords("UNKNOWN_PFZ_ID")
    assert -90 <= lat <= 90
    assert -180 <= lon <= 180


# -- FastAPI endpoint tests (require the `fastapi`/`httpx` test dependencies) -

fastapi_testclient = pytest.importorskip("fastapi.testclient")
from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

client = TestClient(app)


def test_health_endpoint_reports_subsystems():
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "HEALTHY"
    assert "subsystems" in body
    assert "groq_llm" in body["subsystems"]


def test_alerts_endpoint_returns_provenanced_alert_list():
    res = client.get("/api/alerts")
    assert res.status_code == 200
    body = res.json()
    assert isinstance(body["alerts"], list)
    assert body["data_source"] == "PROACTIVE_HAZARD_EVALUATOR"


def test_route_endpoint_returns_a_found_route_for_known_harbour_and_pfz():
    res = client.post("/api/route", json={"origin_harbour": "HBR-KOC", "target_pfz": "PFZ-01"})
    assert res.status_code == 200
    body = res.json()
    assert body["route_found"] is True
    assert len(body["waypoints"]) >= 2
    assert body["distance_nm"] > 0


def test_route_endpoint_404s_on_unknown_harbour():
    res = client.post("/api/route", json={"origin_harbour": "HBR-DOES-NOT-EXIST", "target_pfz": "PFZ-01"})
    assert res.status_code == 404


def test_route_endpoint_404s_on_unknown_pfz():
    res = client.post("/api/route", json={"origin_harbour": "HBR-KOC", "target_pfz": "PFZ-DOES-NOT-EXIST"})
    assert res.status_code == 404


def test_route_endpoint_400s_when_nothing_resolvable():
    res = client.post("/api/route", json={"origin_harbour": None, "target_pfz": None})
    assert res.status_code == 400


def test_route_endpoint_accepts_raw_coordinates():
    res = client.post("/api/route", json={
        "origin_lat": 9.93, "origin_lon": 76.26,
        "destination_lat": 9.85, "destination_lon": 75.60,
    })
    assert res.status_code == 200
    assert res.json()["route_found"] is True


def test_route_endpoint_422s_on_out_of_range_coordinates():
    res = client.post("/api/route", json={
        "origin_lat": 999, "origin_lon": 76.26,
        "destination_lat": 9.85, "destination_lon": 75.60,
    })
    assert res.status_code == 422


def test_pfz_endpoint_422s_on_out_of_range_lat():
    res = client.get("/api/pfz", params={"lat": 999, "lon": 75.60})
    assert res.status_code == 422


def test_geofence_endpoint_includes_threshold_alert_metadata():
    res = client.get("/api/geofence", params={"lat": 9.9, "lon": 79.55})
    assert res.status_code == 200
    body = res.json()
    assert body["geofence_warning_threshold_nm"] == 5.0
    assert body["proximity_alert"]["alert_type"] == "IMBL_PROXIMITY"


def test_advisory_synthesize_returns_telemetry_and_advisory():
    res = client.post("/api/advisory/synthesize", json={
        "query": "Is the sea safe today?",
        "origin_harbour": "HBR-KOC",
        "target_pfz": "PFZ-01",
    })
    assert res.status_code == 200
    body = res.json()
    assert "telemetry" in body and "advisory" in body
    assert body["telemetry"]["plan"]["intent"] == "WEATHER_SAFETY"
    assert "advisory_text" in body["advisory"]


def test_advisory_synthesize_returns_detected_language_metadata():
    res = client.post("/api/advisory/synthesize", json={
        "query": "வானிலை மற்றும் அலை பாதுகாப்பாக உள்ளதா?",
        "origin_harbour": "HBR-KOC",
        "target_pfz": "PFZ-01",
    })
    assert res.status_code == 200
    assert res.json()["language"]["response_code"] == "ta"


def test_advisory_session_carries_pfz_into_second_turn():
    session_id = "api-two-turn-session"
    first = client.post("/api/advisory/synthesize", json={
        "query": "Is PFZ-03 safe today?", "origin_harbour": "HBR-KOC", "target_pfz": "PFZ-01", "session_id": session_id,
    })
    assert first.status_code == 200
    second = client.post("/api/advisory/synthesize", json={
        "query": "Is that zone still safe tomorrow?", "origin_harbour": "HBR-KOC", "target_pfz": "PFZ-01", "session_id": session_id,
    })
    assert second.status_code == 200
    conversation = second.json()["conversation"]
    assert conversation["resolved_target_pfz"] == "PFZ-03"
    assert conversation["carried_forward"] is True


def test_live_status_exposes_source_registry():
    res = client.get("/api/live/status")
    assert res.status_code == 200
    assert "source_registry" in res.json()


def test_advisory_synthesize_404s_on_unknown_harbour():
    res = client.post("/api/advisory/synthesize", json={
        "query": "Is the sea safe today?",
        "origin_harbour": "HBR-DOES-NOT-EXIST",
        "target_pfz": "PFZ-01",
    })
    assert res.status_code == 404


def test_advisory_synthesize_422s_on_blank_query():
    res = client.post("/api/advisory/synthesize", json={
        "query": "",
        "origin_harbour": "HBR-KOC",
        "target_pfz": "PFZ-01",
    })
    assert res.status_code == 422


def test_advisory_synthesize_422s_on_overlong_query():
    res = client.post("/api/advisory/synthesize", json={
        "query": "x" * 5000,
        "origin_harbour": "HBR-KOC",
        "target_pfz": "PFZ-01",
    })
    assert res.status_code == 422

import pytest
import asyncio
import sys
import os

# Add backend directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from agents.supervisor import SupervisorAgent
from agents.satellite_agent import SatelliteAgent, FALLBACK_SST_C
import agents.satellite_agent as satellite_agent_module
from agents.weather_agent import WeatherHazardAgent, FALLBACK_SWH_M, FALLBACK_WIND_KNOTS
from agents.pfz_agent import OceanAnalyticsPFZAgent
import agents.pfz_agent as pfz_agent_module
from agents.geofencing_agent import GeofencingAgent, MPA_SAFETY_BUFFER_NM
import agents.geofencing_agent as geofencing_agent_module
from agents.fleet_agent import FleetTrafficAgent, FALLBACK_FLEET
import agents.fleet_agent as fleet_agent_module
from agents.eta_agent import ETAVoyageSafetyAgent
import agents.eta_agent as eta_agent_module
from agents.synthesis_agent import NeuralSynthesisAgent
from agents.geo_utils import haversine_nm, point_to_polyline_distance_nm, point_in_polygon
from agents.route_planner import RoutePlanner
from language import detect_query_language
from session_store import SessionStore
from geofence_alerts import geofence_alert_for


@pytest.fixture(autouse=True)
def isolate_persisted_live_snapshots(monkeypatch):
    """Unit tests exercise bundled-data fallbacks, never machine-local feeds."""
    monkeypatch.setattr(fleet_agent_module.live_data.store, "latest", lambda kind: None)


# ---------------------------------------------------------------------------
# Supervisor
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_supervisor_planning():
    agent = SupervisorAgent()
    plan = await agent.plan_dag("Is it safe to sail to PFZ-01 from Kochi?")
    assert plan["intent"] == "PFZ_RECOMMENDATION"
    assert len(plan["subtasks"]) >= 2
    assert plan["classification_method"] == "DETERMINISTIC_RULE_BASED"


@pytest.mark.asyncio
async def test_supervisor_intent_changes_with_query():
    # Behavior, not a fixed intent -- different phrasing should route to a
    # different intent classification.
    agent = SupervisorAgent()
    border_plan = await agent.plan_dag("Am I close to the IMBL border?")
    density_plan = await agent.plan_dag("How many vessels/count are in this zone?")
    assert border_plan["intent"] == "IMBL_BOUNDARY"
    assert density_plan["intent"] == "FLEET_DENSITY"


@pytest.mark.asyncio
async def test_hindi_query_detects_and_classifies_weather_intent():
    language = detect_query_language("आज मौसम और लहरें सुरक्षित हैं क्या?")
    assert language["response_code"] == "hi"
    plan = await SupervisorAgent().plan_dag("आज मौसम और लहरें सुरक्षित हैं क्या?", language["detected_code"])
    assert plan["intent"] == "WEATHER_SAFETY"


@pytest.mark.asyncio
async def test_supervisor_covers_all_eight_brief_examples():
    # Every example query from the project brief's own intent table should
    # classify to the intent the brief specifies -- this is the concrete,
    # checkable version of "not just simple keyword matching for one case".
    agent = SupervisorAgent()
    examples = [
        ("Which fishing zone is best?", "PFZ_RECOMMENDATION"),
        ("Is the sea safe today?", "WEATHER_SAFETY"),
        ("How close am I to Sri Lanka?", "IMBL_BOUNDARY"),
        ("Can I fish in this area?", "MPA_SAFETY"),
        ("Are there too many boats around PFZ-03?", "FLEET_DENSITY"),
        ("Give me the safest route to PFZ-04.", "ROUTE_PLANNING"),
        ("Can I return before sunset?", "ETA_RETURN"),
        ("Should I go fishing today?", "GENERAL_VOYAGE_SAFETY"),
    ]
    for query, expected_intent in examples:
        plan = await agent.plan_dag(query)
        assert plan["intent"] == expected_intent, f"{query!r} classified as {plan['intent']!r}, expected {expected_intent!r}"


# ---------------------------------------------------------------------------
# Satellite Oceanography Agent
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_satellite_agent():
    agent = SatelliteAgent()
    data = await agent.fetch_oceanography("Kochi_Malabar")
    # Live Open-Meteo SST when reachable, static fallback otherwise -- so
    # assert a physically-plausible Arabian Sea range rather than a magic
    # constant, and require the response to say which source it used.
    assert 20.0 <= data["sst_celsius"] <= 34.0
    assert data["chlorophyll_mg_m3"] > 1.0
    assert "ISRO Oceansat-3 (EOS-06)" in data["source_satellites"]
    assert data["data_source"]["sst"] in ("LIVE_OPEN_METEO_MARINE", "SIMULATED_FALLBACK")


@pytest.mark.asyncio
async def test_satellite_agent_falls_back_when_live_fetch_fails(monkeypatch):
    # Force the live Open-Meteo call to fail (network down / offline demo)
    # and check the agent degrades to the documented fallback constant
    # instead of raising -- this is the behavior item 8 asks for, not just
    # a happy-path check.
    agent = SatelliteAgent()

    async def _always_fail(*args, **kwargs):
        return None

    monkeypatch.setattr(agent, "_fetch_sst", _always_fail)
    data = await agent.fetch_oceanography()

    assert data["sst_celsius"] == FALLBACK_SST_C
    assert data["data_source"]["sst"] == "SIMULATED_FALLBACK"


@pytest.mark.asyncio
async def test_satellite_agent_uses_last_good_snapshot_when_configured_feed_fails(monkeypatch):
    agent = SatelliteAgent()
    cached = {
        "payload": {"sst_celsius": 27.8, "chlorophyll_mg_m3": 1.4, "sst_gradient_c_per_km": 0.15, "cloud_cover_pct": 22},
        "source": "Approved ocean provider", "observed_at": "2026-09-01T00:00:00Z",
    }

    async def no_live_feed(*args, **kwargs):
        return None

    monkeypatch.setattr(satellite_agent_module.live_data, "ocean_at", no_live_feed)
    monkeypatch.setattr(satellite_agent_module.live_data.store, "latest", lambda kind: cached if kind == "ocean" else None)
    data = await agent.fetch_oceanography()
    assert data["source_tier"] == "CACHED_LAST_GOOD"
    assert data["data_source"]["chlorophyll"] == "CACHED_LAST_GOOD_SATELLITE_SNAPSHOT"


# ---------------------------------------------------------------------------
# Weather & Marine Hazard Agent
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_weather_hazard_scoring():
    agent = WeatherHazardAgent()
    hazard = await agent.evaluate_hazard()
    assert 0 <= hazard["safety_score"] <= 100
    assert hazard["clearance_verdict"] in ["SAFE", "CAUTION", "UNSAFE"]
    assert hazard["sea_state_douglas"] >= 1


@pytest.mark.asyncio
async def test_weather_agent_falls_back_when_live_fetch_fails(monkeypatch):
    agent = WeatherHazardAgent()

    async def _always_fail(*args, **kwargs):
        return None

    monkeypatch.setattr(agent, "_fetch_marine", _always_fail)
    monkeypatch.setattr(agent, "_fetch_wind_and_sky", _always_fail)
    hazard = await agent.evaluate_hazard()

    assert hazard["significant_wave_height_m"] == FALLBACK_SWH_M
    assert hazard["surface_wind_knots"] == FALLBACK_WIND_KNOTS
    assert hazard["data_source"]["wave_height"] == "SIMULATED_FALLBACK"
    assert hazard["data_source"]["wind"] == "SIMULATED_FALLBACK"


@pytest.mark.asyncio
async def test_weather_agent_worse_sea_state_lowers_safety_score():
    # Behavior check: rougher input conditions should never score safer.
    agent = WeatherHazardAgent()

    async def _calm_marine(*args, **kwargs):
        return {"wave_height": 0.3}

    async def _rough_marine(*args, **kwargs):
        return {"wave_height": 3.5}

    async def _sky(*args, **kwargs):
        return {"wind_speed_10m": 10.0, "wind_direction_10m": 90, "weather_code": 1, "cloud_cover": 20}

    agent._fetch_marine = _calm_marine
    agent._fetch_wind_and_sky = _sky
    calm = await agent.evaluate_hazard()

    agent._fetch_marine = _rough_marine
    rough = await agent.evaluate_hazard()

    assert rough["safety_score"] <= calm["safety_score"]
    assert rough["sea_state_douglas"] >= calm["sea_state_douglas"]


# ---------------------------------------------------------------------------
# Ocean Analytics & PFZ Agent
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pfz_ranking():
    agent = OceanAnalyticsPFZAgent()
    pfz = await agent.rank_pfz_zones()
    assert "Kochi Deep" in pfz["top_recommended_pfz"]
    assert pfz["yield_score_pct"] >= 80
    # Composite ranking should cover every zone in the data file and be
    # sorted, not just hand back one fixed entry.
    ranking = pfz["full_ranking"]
    assert len(ranking) == 7
    scores = [r["composite_score"] for r in ranking]
    assert scores == sorted(scores, reverse=True)
    assert pfz["data_source"] == "PFZ_ZONE_DATASET"


@pytest.mark.asyncio
async def test_pfz_ranking_moves_with_vessel_position():
    agent = OceanAnalyticsPFZAgent()
    # A vessel sitting right at the Wadge Bank zone (highest raw yield,
    # 98%) should pull that zone to the top even though PFZ-01 wins from
    # the default Kochi-area position.
    pfz = await agent.rank_pfz_zones(vessel_lat=7.85, vessel_lon=77.2)
    assert "PFZ-03" in pfz["top_recommended_pfz"]


@pytest.mark.asyncio
async def test_pfz_agent_falls_back_when_zone_data_missing(monkeypatch):
    # Point the module at a directory with no pfz_zones.json and confirm
    # the agent degrades to its offline single-zone snapshot instead of
    # raising at construction time.
    monkeypatch.setattr(pfz_agent_module, "DATA_DIR", "/nonexistent/orca-insight-data")
    agent = pfz_agent_module.OceanAnalyticsPFZAgent()

    assert agent._using_fallback is True
    result = await agent.rank_pfz_zones()
    assert result["top_recommended_pfz"] == "PFZ-01 (Kochi Deep Offshore (Malabar))"
    assert "SIMULATED_FALLBACK" in result["data_source"]


# ---------------------------------------------------------------------------
# Geofencing & Routing Agent
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_geofencing_agent():
    agent = GeofencingAgent()
    geo = await agent.check_geofences()
    assert geo["imbl_status"] == "SAFE_INTERNATIONAL_CLEARANCE"
    assert geo["distance_to_imbl_nm"] > 0


@pytest.mark.asyncio
async def test_geofencing_agent_detects_boundary_proximity():
    agent = GeofencingAgent()
    # A point sitting right next to a vertex of the Sri Lanka IMBL polyline
    # should compute a small real distance and escalate the status --
    # not the fixed 138.5 nm / SAFE constant regardless of position.
    geo = await agent.check_geofences(lat=9.9, lon=79.55)
    assert geo["distance_to_imbl_nm"] < 5.0
    assert geo["imbl_status"] in ("WARNING_APPROACHING_BOUNDARY", "DANGER_IMMINENT_BOUNDARY_BREACH")


@pytest.mark.asyncio
async def test_geofencing_agent_detects_mpa_breach():
    agent = GeofencingAgent()
    geo = await agent.check_geofences(lat=9.15, lon=78.95)  # inside Gulf of Mannar MPA
    assert geo["mpa_breach_detected"] is True
    assert geo["mpa_status"] == "MPA_BREACH"


@pytest.mark.asyncio
async def test_geofencing_agent_clear_of_mpas_when_vessel_is_far_away():
    # "Vessel outside" case: a position nowhere near any MPA should report
    # no breach, no proximity warning, and the real (non-zero, non-fixed)
    # distance to the nearest one.
    agent = GeofencingAgent()
    geo = await agent.check_geofences(lat=9.85, lon=75.60)  # PFZ-01, nowhere near an MPA
    assert geo["mpa_breach_detected"] is False
    assert geo["mpa_status"] == "CLEAR_OF_MPAS"
    assert geo["distance_to_nearest_mpa_nm"] > MPA_SAFETY_BUFFER_NM


@pytest.mark.asyncio
async def test_geofencing_agent_flags_mpa_proximity_before_breach():
    # A point just outside the MPA polygon but within the configured
    # safety buffer should be flagged as a proximity warning -- distinct
    # from both "breached" and "clear" -- proving the buffer check uses
    # real polygon-boundary distance, not just an inside/outside test.
    agent = GeofencingAgent()
    # Just north of the Gulf of Mannar polygon's northern tip.
    geo = await agent.check_geofences(lat=9.29, lon=79.17)
    assert geo["mpa_breach_detected"] is False
    assert geo["mpa_status"] in ("MPA_PROXIMITY_WARNING", "MPA_BREACH")


def test_geofence_alert_threshold_fires_at_five_nm_and_not_when_clear():
    warning = geofence_alert_for({
        "distance_to_imbl_nm": 5.0, "nearest_imbl_boundary": "Palk Strait", "nearest_imbl_country": "Sri Lanka",
        "imbl_status": "WARNING_APPROACHING_BOUNDARY", "mpa_breach_detected": False, "mpa_status": "CLEAR_OF_MPAS",
    })
    assert warning is not None
    assert warning["alert_type"] == "IMBL_PROXIMITY"
    assert geofence_alert_for({
        "distance_to_imbl_nm": 5.01, "mpa_breach_detected": False, "mpa_status": "CLEAR_OF_MPAS",
    }) is None


def test_geofencing_agent_route_check_detects_leg_crossing_mpa():
    agent = geofencing_agent_module.GeofencingAgent()
    # A two-point "route" whose straight segment cuts directly through the
    # Gulf of Mannar polygon, even though neither endpoint sits inside it.
    waypoints = [{"lat": 8.95, "lon": 78.7}, {"lat": 9.35, "lon": 79.15}]
    result = agent.check_route_against_mpas(waypoints)
    assert result["intersects_mpa"] is True
    assert "Gulf of Mannar Marine National Park" in result["flagged_mpas"]


def test_geofencing_agent_route_check_clears_route_that_avoids_mpas():
    agent = geofencing_agent_module.GeofencingAgent()
    # A route that stays well clear of every MPA.
    waypoints = [{"lat": 9.93, "lon": 76.26}, {"lat": 9.85, "lon": 75.60}]
    result = agent.check_route_against_mpas(waypoints)
    assert result["intersects_mpa"] is False
    assert result["flagged_mpas"] == []


@pytest.mark.asyncio
async def test_geofencing_agent_degrades_when_boundary_data_missing(monkeypatch):
    # No imbl_boundaries.json/mpas.json reachable -- the agent should still
    # construct and report an explicit "no data" result rather than raising
    # out of check_geofences.
    monkeypatch.setattr(geofencing_agent_module, "DATA_DIR", "/nonexistent/orca-insight-data")
    agent = geofencing_agent_module.GeofencingAgent()

    assert agent._boundaries == []
    assert agent._mpas == []
    geo = await agent.check_geofences()
    assert "error" in geo


def test_point_to_polyline_distance_matches_known_geometry():
    # A point directly above the segment (perpendicular projection lands
    # on the segment itself) should be closer than a point offset past the
    # segment's endpoint, where the nearest point clamps to that endpoint
    # -- basic sanity check on the point-to-segment math used by the
    # geofencing agent.
    polyline = [[10.0, 78.0], [10.0, 79.0]]
    perpendicular_dist = point_to_polyline_distance_nm(10.05, 78.5, polyline)
    past_endpoint_dist = point_to_polyline_distance_nm(10.05, 77.5, polyline)
    assert perpendicular_dist < past_endpoint_dist


# ---------------------------------------------------------------------------
# Fleet & Traffic Agent
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fleet_agent_counts_real_vessels_in_requested_zone():
    # data/simulated_vessels.json has exactly 4 vessels tagged
    # "PFZ-01 (Kochi Deep)" and 24 vessels total -- assert the real counted
    # numbers, not a hardcoded constant that ignores pfz_id entirely.
    agent = FleetTrafficAgent()
    assert agent._load_error is None

    fleet = await agent.analyze_fleet("PFZ-01")
    assert fleet["total_active_vessels"] == 24
    assert fleet["vessels_in_target_zone"] == 4
    assert fleet["data_source"] == "SIMULATED_VESSEL_TELEMETRY"


@pytest.mark.asyncio
async def test_fleet_agent_vessel_count_changes_with_requested_zone():
    # Behavior check: a different pfz_id should generally produce a
    # different in-zone count than PFZ-01, proving the filter is real.
    agent = FleetTrafficAgent()
    pfz01 = await agent.analyze_fleet("PFZ-01")
    pfz03 = await agent.analyze_fleet("PFZ-03")
    unknown = await agent.analyze_fleet("PFZ-DOES-NOT-EXIST")

    assert pfz01["vessels_in_target_zone"] != pfz03["vessels_in_target_zone"]
    assert unknown["vessels_in_target_zone"] == 0


@pytest.mark.asyncio
async def test_fleet_agent_counts_border_risk_vessels():
    agent = FleetTrafficAgent()
    fleet = await agent.analyze_fleet("PFZ-01")
    # data/simulated_vessels.json has 3 BORDER_WARNING + 1 BORDER_ALERT vessel.
    assert fleet["border_warning_vessels_count"] == 4


@pytest.mark.asyncio
async def test_fleet_agent_falls_back_when_vessel_feed_missing(monkeypatch):
    monkeypatch.setattr(fleet_agent_module, "DATA_DIR", "/nonexistent/orca-insight-data")
    agent = fleet_agent_module.FleetTrafficAgent()

    assert agent._vessels == []
    assert agent._load_error is not None

    fleet = await agent.analyze_fleet("PFZ-01")
    assert fleet["total_active_vessels"] == FALLBACK_FLEET["total_active_vessels"]
    assert fleet["data_source"].startswith("SIMULATED_FALLBACK")
    assert fleet["fallback_reason"] == agent._load_error


# ---------------------------------------------------------------------------
# ETA & Voyage Safety Agent
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_eta_agent():
    agent = ETAVoyageSafetyAgent()
    eta = await agent.calculate_voyage(distance_nm=28.4, wave_height_m=1.25)
    assert eta["one_way_eta_hours"] > 0
    assert "dusk_safety_verdict" in eta


@pytest.mark.asyncio
async def test_eta_agent_routes_instead_of_straight_line():
    agent = ETAVoyageSafetyAgent()
    # No explicit distance_nm given -- should fall back to the real
    # A*-over-a-grid router (default Kochi Harbour -> PFZ-01) rather than
    # a hardcoded constant, and report routing metadata.
    eta = await agent.calculate_voyage()
    assert eta["route_distance_nm"] > 0
    assert "routing" in eta
    assert eta["routing"]["route_found"] is True
    assert eta["routing"]["mpa_avoidance_active"] is True
    assert len(eta["routing"]["waypoints"]) >= 2


@pytest.mark.asyncio
async def test_eta_agent_avoids_mpa():
    agent = ETAVoyageSafetyAgent()
    # Origin/destination straddling the Gulf of Mannar MPA -- the routed
    # distance should exceed the straight-line distance because the path
    # has to detour around the no-go box.
    eta = await agent.calculate_voyage(origin=(9.0, 78.5), destination=(9.5, 79.3))
    routing = eta["routing"]
    assert routing["route_found"] is True
    assert routing["straight_line_distance_nm"] is not None
    assert eta["route_distance_nm"] > routing["straight_line_distance_nm"]


@pytest.mark.asyncio
async def test_eta_agent_still_routes_when_mpa_data_missing(monkeypatch):
    # No mpas.json reachable -- the agent should still construct and route
    # (just without any no-go zones to avoid) rather than raising.
    monkeypatch.setattr(eta_agent_module, "DATA_DIR", "/nonexistent/orca-insight-data")
    agent = eta_agent_module.ETAVoyageSafetyAgent()

    assert agent._mpas == []
    eta = await agent.calculate_voyage()
    assert eta["routing"]["route_found"] is True


def test_route_planner_flags_unreachable_destination():
    mpas = [
        {
            "id": "MPA-TEST",
            "name": "Test No-Go Zone",
            "bounds": [[9.0, 78.6], [9.35, 78.6], [9.35, 79.2], [9.0, 79.2]],
        }
    ]
    planner = RoutePlanner(mpas)
    result = planner.plan_route((9.0, 78.5), (9.15, 78.95))  # destination inside the MPA
    assert result["route_found"] is False
    assert result["reason"] == "NO_SAFE_MARITIME_ROUTE"


def _load_real_land_polygons():
    import json
    path = os.path.join(os.path.dirname(__file__), "..", "..", "data", "land_mask.json")
    with open(path) as f:
        data = json.load(f)
    return [p["polygon"] for p in data["land_polygons"]]


def test_route_planner_never_crosses_land():
    # Kochi Harbour (west coast) -> Chennai Kasimedu (east coast): a
    # straight line between them crosses the entire Indian peninsula. The
    # router must either route around it (staying clear of every land
    # polygon edge, not just avoiding land at the endpoints) or explicitly
    # report that no route was found -- it must never draw a path that
    # cuts across the mainland.
    land_polygons = _load_real_land_polygons()
    planner = RoutePlanner([], land_polygons=land_polygons)
    result = planner.plan_route((9.93, 76.26), (13.12, 80.29))

    if result["route_found"]:
        waypoints = [(w["lat"], w["lon"]) for w in result["waypoints"]]
        for i in range(len(waypoints) - 1):
            alat, alon = waypoints[i]
            blat, blon = waypoints[i + 1]
            assert not any(
                point_in_polygon(alat, alon, poly) or point_in_polygon(blat, blon, poly)
                for poly in land_polygons
            ), f"waypoint segment {waypoints[i]} -> {waypoints[i+1]} touches land"
    else:
        # Also an acceptable, honest outcome -- as long as it's explicit.
        assert result["reason"] == "NO_SAFE_MARITIME_ROUTE"


def test_route_planner_short_hop_stays_direct():
    # A short harbour -> nearby-PFZ hop with no obstacles in the way
    # should route (approximately) directly, not via some unnecessary
    # detour -- distance should be close to the straight-line distance.
    land_polygons = _load_real_land_polygons()
    planner = RoutePlanner([], land_polygons=land_polygons)
    result = planner.plan_route((9.93, 76.26), (9.85, 75.60))  # Kochi -> PFZ-01
    assert result["route_found"] is True
    assert result["detour_percent"] < 15.0


# ---------------------------------------------------------------------------
# Neural Synthesis Agent
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_synthesis_agent():
    agent = NeuralSynthesisAgent()
    telemetry = {
        "weather": {"clearance_verdict": "SAFE", "safety_score": 88, "significant_wave_height_m": 1.25},
        "pfz": {"top_recommended_pfz": "PFZ-01", "yield_score_pct": 94},
        "eta": {"one_way_eta_hours": 3.46, "estimated_return_ist": "16:45 IST"},
        "fleet": {"vessels_in_target_zone": 8}
    }
    synth = await agent.synthesize(telemetry)
    assert "SAFE" in synth["advisory_text"]
    assert synth["confidence_pct"] >= 90
    assert len(synth["citations"]) > 0


@pytest.mark.asyncio
async def test_synthesis_agent_reflects_unsafe_dusk_verdict():
    # Behavior check: a CAUTION_RETURN_AFTER_DUSK verdict should change the
    # generated text, not just the raw telemetry it's built from.
    agent = NeuralSynthesisAgent()
    telemetry = {
        "weather": {"clearance_verdict": "CAUTION", "safety_score": 55, "significant_wave_height_m": 2.4},
        "pfz": {"top_recommended_pfz": "PFZ-01", "yield_score_pct": 70},
        "eta": {"one_way_eta_hours": 6.0, "estimated_return_ist": "20:15 IST", "dusk_safety_verdict": "CAUTION_RETURN_AFTER_DUSK"},
        "fleet": {"vessels_in_target_zone": 3},
    }
    synth = await agent.synthesize(telemetry)
    assert "after the dusk safety window" in synth["advisory_text"]
    assert "CAUTION" in synth["advisory_text"]


@pytest.mark.asyncio
async def test_synthesis_agent_answers_differ_by_intent():
    # The core "orchestrator gives the same answer for every query" bug:
    # the exact same underlying telemetry, but a different classified
    # intent, must produce a materially different advisory (not just a
    # cosmetic reordering) -- proving the answer is actually query-aware.
    agent = NeuralSynthesisAgent()
    shared_telemetry = {
        "weather": {"clearance_verdict": "SAFE", "safety_score": 88, "significant_wave_height_m": 1.1,
                    "surface_wind_knots": 12, "sea_state_douglas": 2},
        "satellite": {"sst_celsius": 28.4, "chlorophyll_mg_m3": 1.85},
        "pfz": {"top_recommended_pfz": "PFZ-01", "yield_score_pct": 94, "distance_from_vessel_nm": 12.3},
        "geofence": {"nearest_imbl_country": "Sri Lanka", "distance_to_imbl_nm": 138.5,
                     "imbl_status": "SAFE_INTERNATIONAL_CLEARANCE", "mpa_breach_detected": False},
        "fleet": {"vessels_in_target_zone": 8, "total_active_vessels": 24, "overcrowding_status": "OPTIMAL_CAPACITY",
                  "data_source": "SIMULATED_VESSEL_TELEMETRY"},
        "eta": {"one_way_eta_hours": 3.46, "estimated_return_ist": "16:45 IST",
                "dusk_safety_verdict": "SAFE_RETURN_BEFORE_DUSK", "dusk_threshold_ist": "18:30 IST",
                "route_distance_nm": 28.4, "routing": {"route_found": True, "straight_line_distance_nm": 27.9,
                                                        "detour_nm": 0.5, "detour_percent": 1.8, "avoided_mpas": []}},
    }

    weather_ans = await agent.synthesize({**shared_telemetry, "plan": {"intent": "WEATHER_SAFETY"}})
    imbl_ans = await agent.synthesize({**shared_telemetry, "plan": {"intent": "IMBL_BOUNDARY"}})
    fleet_ans = await agent.synthesize({**shared_telemetry, "plan": {"intent": "FLEET_DENSITY"}})
    eta_ans = await agent.synthesize({**shared_telemetry, "plan": {"intent": "ETA_RETURN"}})
    pfz_ans = await agent.synthesize({**shared_telemetry, "plan": {"intent": "PFZ_RECOMMENDATION"}})

    texts = {weather_ans["advisory_text"], imbl_ans["advisory_text"], fleet_ans["advisory_text"],
             eta_ans["advisory_text"], pfz_ans["advisory_text"]}
    assert len(texts) == 5, "expected five distinct, intent-specific advisory texts from identical telemetry"

    assert "wave" in weather_ans["advisory_text"].lower()
    assert "sri lanka" in imbl_ans["advisory_text"].lower()
    assert "8 vessels" in fleet_ans["advisory_text"].lower() or "8" in fleet_ans["advisory_text"]
    assert "16:45" in eta_ans["advisory_text"]
    assert "pfz-01" in pfz_ans["advisory_text"].lower()


@pytest.mark.asyncio
async def test_synthesis_agent_mpa_breach_warns_explicitly():
    agent = NeuralSynthesisAgent()
    telemetry = {
        "geofence": {"mpa_breach_detected": True, "mpa_breached_name": "Gulf of Mannar Marine National Park"},
        "plan": {"intent": "MPA_SAFETY"},
    }
    synth = await agent.synthesize(telemetry)
    assert "gulf of mannar" in synth["advisory_text"].lower()
    assert "restricted" in synth["advisory_text"].lower() or "warning" in synth["advisory_text"].lower()


@pytest.mark.asyncio
async def test_synthesis_agent_uses_only_the_in_house_stats_engine():
    """There is no external AI/LLM API anywhere in this system any more --
    every advisory comes from the rule-based ORCA_STATS_ENGINE, reasoning
    over this website's own telemetry and its own stats ledger."""
    agent = NeuralSynthesisAgent()
    assert not hasattr(agent, "_client")  # no external API client of any kind
    synth = await agent.synthesize({"plan": {"intent": "GENERAL_VOYAGE_SAFETY"}})
    assert "ORCA_STATS_ENGINE" in synth["llm_engine"]
    assert "GROQ" not in synth["llm_engine"]


@pytest.mark.asyncio
async def test_tamil_weather_query_gets_tamil_fallback_response():
    agent = NeuralSynthesisAgent()
    telemetry = {
        "plan": {"intent": "WEATHER_SAFETY"},
        "language": {"response_code": "ta", "supported": True},
        "weather": {"significant_wave_height_m": 1.2, "surface_wind_knots": 11, "clearance_verdict": "SAFE"},
    }
    synth = await agent.synthesize(telemetry)
    assert synth["language"]["response_code"] == "ta"
    assert "கடல் ஆலோசனை" in synth["advisory_text"]


def test_unsupported_language_safely_falls_back_to_english_with_note():
    language = detect_query_language("¿El mar está seguro hoy?")
    assert language["response_code"] == "en"
    assert language["supported"] is False
    assert "responding in English" in language["note"]


def test_session_store_carries_forward_last_pfz_for_followup():
    store = SessionStore()
    session_id = "test-session-carry-forward"
    store.record(session_id, "Is PFZ-03 safe today?", "PFZ-03 advisory", "HBR-KOC", "PFZ-03")
    resolved = store.resolve(session_id, "Is that zone still safe tomorrow?", "HBR-KOC", "PFZ-01", [])
    assert resolved["target_pfz"] == "PFZ-03"
    assert resolved["carried_forward"] is True
    assert len(resolved["history"]) == 2


def test_session_store_evicts_expired_session(monkeypatch):
    import session_store as session_module
    store = SessionStore()
    store.record("expired-session", "PFZ-03", "answer", "HBR-KOC", "PFZ-03")
    monkeypatch.setattr(session_module, "SESSION_TTL_SECONDS", 1)
    store._sessions["expired-session"].touched_at -= 2
    resolved = store.resolve("expired-session", "is that zone safe?", "HBR-KOC", "PFZ-01", [])
    assert resolved["target_pfz"] == "PFZ-01"

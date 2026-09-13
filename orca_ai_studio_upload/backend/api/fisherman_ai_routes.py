"""
ORCA Fisherman -- AI DECISION STUDIO endpoints.

Every prediction below runs on ORCA's own locally-trained scikit-learn
models (backend/ml/) plus deterministic profit/risk/market-optimizer
arithmetic (backend/ml/decision/decision_engine.py). There is no call to
OpenAI, Claude, Gemini, or any other external AI API anywhere in this
file or anything it imports -- see backend/ml/README.md for the full
architecture.

Live inputs (marine hazard conditions) are pulled from the SAME
core.weather_agent the rest of the app already uses (see
/api/fisherman/dashboard for the precedent), so this module never
disagrees with the Safety Barometer about today's conditions. Zone/
species/harbour reference data comes from ORCA's existing
pfz_zones.json / harbours.json / fisherman_market.json files.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

import core
from models.requests import (
    CatchPredictionRequest, PricePredictionRequest, ProfitCalculationRequest,
    RiskCalculationRequest, SpeciesRecommendationRequest, TripPlanRequest,
    ZoneRecommendationRequest,
)
from ml.data import reference_data as ref
from ml.decision import decision_engine as de
from ml.inference import predictor

logger = logging.getLogger(__name__)
router = APIRouter()


def _current_month(month):
    return month or datetime.now(timezone.utc).month


def _require_models():
    status = predictor.models_ready()
    missing = [name for name, ok in status.items() if not ok]
    if missing:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "AI Decision Studio models are not trained yet on this deployment.",
                "missing_models": missing,
                "fix": "Run: python3 backend/ml/data/generate_demo_dataset.py, then each "
                       "backend/ml/training/train_*.py script, then redeploy with the "
                       "resulting backend/ml/models/*.pkl files included.",
            },
        )


async def _candidate_zone_conditions(lat: float, lon: float, month: int):
    """Builds the per-zone feature dicts recommend_zones()/rank_species()
    need, from ORCA's existing PFZ zone profiles + ONE live marine hazard
    reading for the requesting vessel's position (applied to every
    candidate zone -- fetching separate live weather per zone would mean
    7x the API calls for a refinement the demo doesn't need yet)."""
    weather = await core.weather_agent.evaluate_hazard(lat=lat, lon=lon)
    candidates = []
    for z in ref.zones():
        harbours_sorted = sorted(
            ref.harbours(), key=lambda h: de.haversine_km(z["center"][0], z["center"][1], h["coordinates"][0], h["coordinates"][1])
        )
        nearest = harbours_sorted[0]
        distance_km = round(de.haversine_km(z["center"][0], z["center"][1], nearest["coordinates"][0], nearest["coordinates"][1]), 1)
        candidates.append({
            "zone_id": z["id"],
            "zone_name": z["name"],
            "zone_yield_score": z["yield_score_pct"],
            "chlorophyll_mg_m3": z["chlorophyll_mg_m3"],
            "sea_surface_temperature_c": z["sst_celsius"],
            "wave_height_m": weather.get("significant_wave_height_m", 1.0),
            "wind_speed_kmh": (weather.get("surface_wind_knots", 10) or 10) * 1.852,
            "rainfall_mm": max(0.0, (weather.get("lightning_risk_pct", 15) or 15) * 0.15),
            "distance_from_port_km": distance_km,
            "fishing_effort_vessels": z.get("vessels_in_zone", 5),
            "month": month,
            "dominant_species": z.get("dominant_species", []),
            "nearest_harbour": nearest,
        })
    return candidates, weather


@router.get("/api/fisherman/zones")
async def list_zones():
    """All PFZ zones with the same fields the AI Decision Studio's zone
    map/candidate list uses, so the frontend can render zone markers
    before a trip is even analyzed."""
    return {"zones": ref.zones(), "count": len(ref.zones())}


@router.post("/api/fisherman/predict-catch")
async def predict_catch(body: CatchPredictionRequest):
    _require_models()
    month = _current_month(body.month)
    zone = ref.zone_by_id(body.zone_id) if body.zone_id else None
    candidates, weather = await _candidate_zone_conditions(body.lat, body.lon, month)
    zc = next((c for c in candidates if zone and c["zone_id"] == zone["id"]), candidates[0])

    trip = {
        "zone_yield_score": zc["zone_yield_score"],
        "chlorophyll_mg_m3": zc["chlorophyll_mg_m3"],
        "sea_surface_temperature_c": zc["sea_surface_temperature_c"],
        "wave_height_m": zc["wave_height_m"],
        "wind_speed_kmh": zc["wind_speed_kmh"],
        "rainfall_mm": zc["rainfall_mm"],
        "distance_from_port_km": zc["distance_from_port_km"],
        "trip_duration_hours": body.trip_duration_hours,
        "fishing_effort_vessels": zc["fishing_effort_vessels"],
        "month": month,
        "hour_of_day": body.hour_of_day,
        "gear_type": body.gear_type,
        "boat_type": body.boat_type,
        "species": body.species,
        "wind_direction": weather.get("wind_direction", "West")[:1] or "W",
    }
    result = predictor.predict_catch(trip)
    result["zone_used"] = zc["zone_id"]
    return result


@router.post("/api/fisherman/predict-price")
async def predict_price(body: PricePredictionRequest):
    _require_models()
    month = _current_month(body.month)
    species_ref = ref.species_by_name(body.species)
    result = predictor.predict_price(species_ref["species"], month, species_ref.get("demand", "Medium"))
    result["live_reference_price_per_kg"] = species_ref.get("price_per_kg")
    return result


@router.post("/api/fisherman/recommend-zone")
async def recommend_zone(body: ZoneRecommendationRequest):
    _require_models()
    month = _current_month(body.month)
    candidates, weather = await _candidate_zone_conditions(body.lat, body.lon, month)
    ranked = de.recommend_zones([{k: v for k, v in c.items() if k not in ("dominant_species", "nearest_harbour")} for c in candidates])
    by_id = {c["zone_id"]: c for c in candidates}
    for r in ranked:
        r["dominant_species"] = by_id[r["zone_id"]]["dominant_species"]
    return {"zones": ranked, "weather_used": weather}


@router.post("/api/fisherman/recommend-species")
async def recommend_species(body: SpeciesRecommendationRequest):
    _require_models()
    month = _current_month(body.month)
    zone = ref.zone_by_id(body.zone_id) if body.zone_id else None
    candidates, _weather = await _candidate_zone_conditions(body.lat, body.lon, month)
    zc = next((c for c in candidates if zone and c["zone_id"] == zone["id"]), candidates[0])
    ranked = predictor.rank_species(
        {
            "zone_yield_score": zc["zone_yield_score"], "chlorophyll_mg_m3": zc["chlorophyll_mg_m3"],
            "sea_surface_temperature_c": zc["sea_surface_temperature_c"], "wave_height_m": zc["wave_height_m"],
        },
        month,
    )
    return {"zone_id": zc["zone_id"], "zone_name": zc["zone_name"], "ranked_species": ranked}


@router.post("/api/fisherman/calculate-profit")
async def calculate_profit(body: ProfitCalculationRequest):
    costs = {
        "fuel": body.fuel_cost, "ice": body.ice_cost, "food": body.food_cost,
        "maintenance": body.maintenance_cost, "transportation": body.transportation_cost,
        "other": body.other_cost,
    }
    return de.calculate_profit(body.catch_kg, body.price_per_kg, costs)


@router.post("/api/fisherman/calculate-risk")
async def calculate_risk(body: RiskCalculationRequest):
    weather = await core.weather_agent.evaluate_hazard(lat=body.lat, lon=body.lon)
    return de.calculate_risk(weather, body.trip_duration_hours, body.distance_from_port_km)


@router.post("/api/fisherman/analyze-trip")
async def analyze_trip(body: TripPlanRequest):
    """The single combined ORCA AI Decision Studio call: WHERE to fish,
    WHAT to catch, WHEN to go, WHERE to sell, and the resulting expected
    profit + risk + overall trip score -- everything the Trip Planner's
    'Analyze with ORCA AI' button needs in one response."""
    _require_models()
    month = _current_month(body.month)
    candidates, weather = await _candidate_zone_conditions(body.lat, body.lon, month)

    # WHERE: rank candidate zones, pick the best.
    zone_inputs = [{k: v for k, v in c.items() if k not in ("dominant_species", "nearest_harbour")} for c in candidates]
    ranked_zones = de.recommend_zones(zone_inputs)
    best_zone_ranked = ranked_zones[0]
    best_zone = next(c for c in candidates if c["zone_id"] == best_zone_ranked["zone_id"])

    # WHAT: rank species suitability for that zone; honor an explicit
    # target_species request if the fisherman already knows what they want.
    species_ranked = predictor.rank_species(
        {
            "zone_yield_score": best_zone["zone_yield_score"], "chlorophyll_mg_m3": best_zone["chlorophyll_mg_m3"],
            "sea_surface_temperature_c": best_zone["sea_surface_temperature_c"], "wave_height_m": best_zone["wave_height_m"],
        },
        month,
    )
    chosen = next(
        (s for s in species_ranked if body.target_species and s["species"].lower() == body.target_species.lower()),
        species_ranked[0],
    )
    species_ref = ref.species_by_name(chosen["species"])

    # WHEN: sweep the catch model over hour-of-day for this zone/species/gear/boat.
    base_trip = {
        "zone_yield_score": best_zone["zone_yield_score"], "chlorophyll_mg_m3": best_zone["chlorophyll_mg_m3"],
        "sea_surface_temperature_c": best_zone["sea_surface_temperature_c"], "wave_height_m": best_zone["wave_height_m"],
        "wind_speed_kmh": best_zone["wind_speed_kmh"], "rainfall_mm": best_zone["rainfall_mm"],
        "distance_from_port_km": best_zone["distance_from_port_km"], "trip_duration_hours": body.trip_duration_hours,
        "fishing_effort_vessels": best_zone["fishing_effort_vessels"], "month": month,
        "gear_type": body.gear_type, "boat_type": body.boat_type, "species": chosen["species"],
        "wind_direction": (weather.get("wind_direction") or "West")[:1] or "W",
    }
    time_rec = de.recommend_time(base_trip)

    # Expected catch at the recommended hour.
    catch = predictor.predict_catch({**base_trip, "hour_of_day": time_rec["best_hour"]})

    # WHERE TO SELL: price prediction + market optimizer across nearby harbours.
    price = predictor.predict_price(chosen["species"], month, species_ref.get("demand", "Medium"))
    markets_input = []
    for h in sorted(ref.harbours(), key=lambda h: de.haversine_km(best_zone["nearest_harbour"]["coordinates"][0], best_zone["nearest_harbour"]["coordinates"][1], h["coordinates"][0], h["coordinates"][1]))[:4]:
        dist = de.haversine_km(best_zone["nearest_harbour"]["coordinates"][0], best_zone["nearest_harbour"]["coordinates"][1], h["coordinates"][0], h["coordinates"][1])
        markets_input.append({"name": h["name"], "distance_km": round(dist, 1) or 3.0})
    markets = de.optimize_market(catch["predicted_catch_kg"], price["predicted_price_per_kg"], markets_input)
    best_market = markets[0]

    # PROFIT: deterministic arithmetic, using ORCA's own default trip-cost
    # figures (same numbers the existing Fisherman dashboard uses), with an
    # optional fuel-budget override from the Trip Planner form.
    default_costs = ref.default_trip_cost()
    fuel_cost = body.fuel_budget if body.fuel_budget is not None else default_costs.get("fuel", 4200)
    costs = {
        "fuel": fuel_cost,
        "ice": default_costs.get("ice", 1200),
        "transportation": best_market["transport_cost"],
        "other": default_costs.get("other", 600),
    }
    profit = de.calculate_profit(catch["predicted_catch_kg"], price["predicted_price_per_kg"], costs)

    # RISK: reuses the existing marine hazard evaluation.
    risk = de.calculate_risk(weather, body.trip_duration_hours, best_zone["distance_from_port_km"])

    alt_profits = []
    for m in markets[1:]:
        alt_costs = {**costs, "transportation": m["transport_cost"]}
        alt_profits.append(de.calculate_profit(catch["predicted_catch_kg"], price["predicted_price_per_kg"], alt_costs)["estimated_profit"])

    score = de.trip_score(
        best_zone_ranked["potential_score"], chosen["score"], catch["prediction_reliability"],
        risk["level"], profit["estimated_profit"], alt_profits,
    )
    explanation = de.explain(best_zone["zone_name"], chosen["species"], risk["level"], price["trend"], profit["estimated_profit"], max(alt_profits) if alt_profits else 0)

    return {
        "best_fishing_plan": {
            "zone_id": best_zone["zone_id"],
            "zone_name": best_zone["zone_name"],
            "target_species": chosen["species"],
            "species_suitability_score": chosen["score"],
            "best_time_window": time_rec["window"],
            "expected_catch_kg": catch["predicted_catch_kg"],
            "expected_catch_range": [catch["lower_range"], catch["upper_range"]],
            "expected_price_per_kg": price["predicted_price_per_kg"],
            "price_trend": price["trend"],
            "best_market": best_market["market"],
            "estimated_profit": profit["estimated_profit"],
            "risk": risk["level"],
            "model_reliability_pct": round(catch["prediction_reliability"] * 100, 1),
            "orca_trip_score": score["trip_score"],
        },
        "zone_ranking": ranked_zones,
        "species_ranking": species_ranked,
        "time_recommendation": time_rec,
        "catch_prediction": catch,
        "price_prediction": price,
        "market_comparison": markets,
        "profit_breakdown": profit,
        "risk_assessment": risk,
        "trip_score_breakdown": score,
        "why_orca_chose_this": explanation,
        "feature_importance": predictor.catch_feature_importance(),
        "model_transparency": predictor.all_metrics(),
        "status": "DEMO MODEL -- trained on ORCA's synthetic demonstration dataset, not real historical catch records.",
    }

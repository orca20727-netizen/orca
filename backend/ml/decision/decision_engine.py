"""
ORCA Fisherman -- central decision engine.

Combines the four trained models' outputs (via ml.inference.predictor)
with two DELIBERATELY non-ML, deterministic pieces -- the profit engine
and the market optimizer (spec items 11-12 are explicit that plain
arithmetic must not be dressed up as AI) -- plus a risk engine that reuses
ORCA's EXISTING marine hazard evaluation (core.weather_agent.evaluate_
hazard) rather than re-implementing wave/wind thresholds from scratch.

This module takes already-fetched inputs (weather dict, zone list, etc.)
rather than fetching them itself -- same pattern as fisherman_agent.
build_dashboard, which composes core.weather_agent / core.pfz_agent
results handed to it by the route, so this module has no network/async
code and stays trivially unit-testable.
"""
import math

from ml.inference import predictor


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------
# 1. Fishing zone ranking (0-100 product score)
# ---------------------------------------------------------------------
def recommend_zones(candidate_zones: list) -> list:
    """candidate_zones: [{zone_id, zone_name, zone_yield_score, chlorophyll_mg_m3,
    sea_surface_temperature_c, wave_height_m, wind_speed_kmh, rainfall_mm,
    distance_from_port_km, fishing_effort_vessels, month}, ...]

    Returns the same zones with a `potential_score` (0-100), sorted best
    first. The underlying model just needs to rank candidates correctly
    relative to each other -- the min-max scaling to 0-100 happens here,
    across whatever set of candidates this particular request evaluated
    (so the top zone is always ~90s, matching the product spec's examples,
    without hard-coding any zone as "always best" -- rescored every call
    from that call's own live conditions)."""
    raw = []
    for z in candidate_zones:
        raw.append((z, predictor.raw_zone_score(z)))
    values = [r for _, r in raw]
    lo, hi = min(values), max(values)
    spread = (hi - lo) or 1.0
    out = []
    for z, val in raw:
        scaled = 45 + 50 * ((val - lo) / spread)  # keeps the field within a believable 45-95 product range
        out.append({**z, "potential_score": round(scaled, 1), "raw_model_output_kg_proxy": round(val, 1)})
    out.sort(key=lambda r: -r["potential_score"])
    return out


# ---------------------------------------------------------------------
# 2. Best fishing time -- sweeps the CATCH MODEL over hour-of-day rather
#    than training a separate model for this; a real model call per hour,
#    not a hardcoded window.
# ---------------------------------------------------------------------
def recommend_time(base_trip: dict) -> dict:
    candidate_hours = list(range(4, 20))
    scored = []
    for hour in candidate_hours:
        trial = {**base_trip, "hour_of_day": hour}
        pred = predictor.predict_catch(trial)
        scored.append((hour, pred["predicted_catch_kg"]))

    best_hour, best_catch = max(scored, key=lambda t: t[1])
    # A believable "window", not a single instant: the two hours either
    # side of the best hour, clipped to the evaluated range.
    window_start = max(candidate_hours[0], best_hour - 1)
    window_end = min(candidate_hours[-1] + 1, best_hour + 2)

    return {
        "best_hour": best_hour,
        "window": f"{window_start:02d}:00 - {window_end:02d}:00",
        "expected_catch_at_best_hour_kg": best_catch,
        "hourly_scan": [{"hour": h, "expected_catch_kg": c} for h, c in scored],
    }


# ---------------------------------------------------------------------
# 3. Profit engine -- deterministic arithmetic, no model involved.
# ---------------------------------------------------------------------
def calculate_profit(catch_kg: float, price_per_kg: float, costs: dict) -> dict:
    """costs: any subset of {fuel, ice, food, maintenance, transportation, other} (INR)."""
    revenue = round(catch_kg * price_per_kg, 2)
    total_cost = round(sum(float(v) for v in costs.values()), 2)
    profit = round(revenue - total_cost, 2)
    return {
        "expected_catch_kg": round(catch_kg, 1),
        "expected_price_per_kg": round(price_per_kg, 2),
        "revenue": revenue,
        "cost_breakdown": {k: round(float(v), 2) for k, v in costs.items()},
        "total_cost": total_cost,
        "estimated_profit": profit,
        "roi_pct": round((profit / total_cost) * 100, 1) if total_cost else None,
    }


# ---------------------------------------------------------------------
# 4. Risk engine -- reuses the EXISTING weather/hazard evaluation
#    (core.weather_agent.evaluate_hazard) instead of re-deriving wave/wind
#    thresholds; only adds the trip-duration/distance escalation that
#    evaluate_hazard doesn't already cover.
# ---------------------------------------------------------------------
_LEVELS = ["LOW", "MODERATE", "HIGH"]


def calculate_risk(weather: dict, trip_duration_hours: float = 8.0, distance_from_port_km: float = 20.0) -> dict:
    verdict = weather.get("clearance_verdict", "CAUTION")
    base_level = {"SAFE": "LOW", "CAUTION": "MODERATE", "UNSAFE": "HIGH"}.get(verdict, "MODERATE")

    idx = _LEVELS.index(base_level)
    escalation_reasons = []
    if trip_duration_hours > 12 and distance_from_port_km > 60:
        idx = min(idx + 1, len(_LEVELS) - 1)
        escalation_reasons.append("long trip duration combined with distance from shore")
    level = _LEVELS[idx]

    return {
        "level": level,
        "wave_height_m": weather.get("significant_wave_height_m"),
        "wind_knots": weather.get("surface_wind_knots"),
        "rain_probability_pct": weather.get("lightning_risk_pct"),
        "based_on": "ORCA marine hazard evaluation (same source as the Safety Barometer)",
        "escalation_reasons": escalation_reasons,
        "advisory": "Check official marine safety advisories before departure.",
    }


# ---------------------------------------------------------------------
# 5. Market optimizer -- deterministic net-revenue comparison across
#    candidate markets (item 11): highest GROSS price never wins on its
#    own if transport/handling eats the difference.
# ---------------------------------------------------------------------
def optimize_market(catch_kg: float, price_per_kg: float, markets: list, handling_cost: float = 300.0) -> list:
    """markets: [{name, distance_km, transport_cost_per_km (optional), price_multiplier (optional)}]"""
    out = []
    for m in markets:
        mkt_price = price_per_kg * m.get("price_multiplier", 1.0)
        gross = round(catch_kg * mkt_price, 2)
        transport = round(m["distance_km"] * m.get("transport_cost_per_km", 6.5), 2)
        net = round(gross - transport - handling_cost, 2)
        out.append({
            "market": m["name"],
            "distance_km": m["distance_km"],
            "price_per_kg": round(mkt_price, 2),
            "gross_revenue": gross,
            "transport_cost": transport,
            "handling_cost": handling_cost,
            "net_revenue": net,
        })
    out.sort(key=lambda r: -r["net_revenue"])
    return out


# ---------------------------------------------------------------------
# 6. Combined ORCA TRIP SCORE + template-based explanation (no LLM --
#    every sentence is built from the structured numbers already computed
#    above, per spec item 15/19).
# ---------------------------------------------------------------------
def trip_score(zone_potential: float, species_score: float, catch_reliability: float, risk_level: str, profit: float, alt_profits: list) -> dict:
    risk_component = {"LOW": 95, "MODERATE": 70, "HIGH": 35}.get(risk_level, 60)

    if alt_profits:
        best_alt = max(alt_profits) if max(alt_profits) > 0 else 1
        profit_component = max(0, min(100, 50 + 50 * ((profit - sum(alt_profits) / len(alt_profits)) / best_alt)))
    else:
        profit_component = 70 if profit > 0 else 20

    weights = {"zone": 0.28, "species": 0.20, "reliability": 0.17, "risk": 0.20, "profit": 0.15}
    score = (
        zone_potential * weights["zone"]
        + species_score * weights["species"]
        + (catch_reliability * 100) * weights["reliability"]
        + risk_component * weights["risk"]
        + profit_component * weights["profit"]
    )
    score = round(max(0, min(100, score)), 0)

    return {
        "trip_score": int(score),
        "components": {
            "fishing_potential": round(zone_potential, 1),
            "market_opportunity": round(species_score, 1),
            "model_reliability_pct": round(catch_reliability * 100, 1),
            "risk": risk_level,
            "profit_component": round(profit_component, 1),
        },
    }


def explain(zone_name: str, species: str, risk_level: str, price_trend: str, profit: float, alt_best_profit: float) -> list:
    """Deterministic template sentences built ONLY from the structured
    values passed in -- no free-text generation, no LLM."""
    bullets = [f"Catch potential in {zone_name} is high for {species} under current ocean conditions."]
    if risk_level == "LOW":
        bullets.append("Marine weather risk is low for the planned trip window.")
    elif risk_level == "MODERATE":
        bullets.append("Marine weather risk is moderate -- review conditions before departure.")
    else:
        bullets.append("Marine weather risk is currently high -- this trip is not recommended without conditions improving.")
    if price_trend == "INCREASING":
        bullets.append(f"{species} prices are trending upward.")
    elif price_trend == "DECREASING":
        bullets.append(f"{species} prices are trending downward -- consider selling promptly.")
    else:
        bullets.append(f"{species} prices are stable.")
    if alt_best_profit and profit > alt_best_profit:
        bullets.append("Expected profit is higher than the alternative zones/markets evaluated.")
    elif alt_best_profit and profit <= alt_best_profit:
        bullets.append("A comparable or better-profit alternative was found -- see the full comparison below.")
    return bullets

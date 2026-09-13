"""
============================================================================
 DEMO DATASET GENERATOR -- ORCA Fisherman AI Decision Studio
============================================================================
Everything this script produces is CLEARLY-LABELED SYNTHETIC DATA for
developing and demonstrating the ML pipeline. It is NOT real catch/price
history. It exists so the training scripts have something realistic to
learn from until real data (CMFRI, Fishery Survey of India, fisherman-
entered catch records, etc. -- see README section below) is available.

It is NOT random noise dressed up as "AI": every row is generated from a
real underlying relationship between conditions and outcomes (see
_simulate_catch_kg / _simulate_price) so a model trained on it must
actually learn that relationship to predict well -- rows are not just a
label copy-pasted from a lookup table. That is what lets model evaluation
(MAE/RMSE/R2, feature importance) on this file mean something, even though
the file itself is synthetic.

Design goal (see spec item 25, "Real data integration"): the column shape
mirrors what real records would look like, and every "base fact" used to
generate a row (zone location/SST/chlorophyll/yield, harbour location,
species price/demand/catch range) is read from ORCA's OWN existing data
files (pfz_zones.json, harbours.json, fisherman_market.json) rather than
invented from scratch, so swapping in real historical trip records later
only means replacing this file -- the feature engineering and training
scripts don't need to change.

Output: backend/ml/data/fishing_trips_demo.csv
"""
import math
import os
import random
import sys

import numpy as np
import pandas as pd

random.seed(42)
np.random.seed(42)

# Reuse reference_data.py's own dual-path lookup (deployed-container
# layout data/<file> first, source-tree layout data/data/<file> as
# fallback -- see its docstring) instead of duplicating that logic here,
# so this script and the live inference/decision code can never drift
# out of sync on where these files actually are.
sys.path.insert(0, os.path.dirname(__file__))
import reference_data as ref

OUT_PATH = os.path.join(os.path.dirname(__file__), "fishing_trips_demo.csv")

N_ROWS = 6000

GEAR_TYPES = ["Gillnet", "Trawl", "Ring Seine", "Longline", "Hook & Line"]
# Relative catch-per-effort efficiency by gear (illustrative, not a claim
# about real gear performance -- just needs to be a real signal the model
# can learn, consistently applied).
GEAR_EFFICIENCY = {"Gillnet": 0.95, "Trawl": 1.15, "Ring Seine": 1.30, "Longline": 0.85, "Hook & Line": 0.55}

BOAT_TYPES = ["Traditional (Non-mechanized)", "Motorized", "Mechanized Trawler"]
BOAT_EFFICIENCY = {"Traditional (Non-mechanized)": 0.70, "Motorized": 1.00, "Mechanized Trawler": 1.35}
BOAT_MAX_RANGE_KM = {"Traditional (Non-mechanized)": 15, "Motorized": 45, "Mechanized Trawler": 120}

WIND_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]




def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _species_alias_hit(species, dominant_species_list):
    s = species.lower()
    for d in dominant_species_list:
        dl = d.lower()
        if s in dl or (s == "mackerel" and "mackerel" in dl) or (s == "kingfish" and ("kingfish" in dl or "seerfish" in dl)):
            return True
    return False


def _season_of(month):
    # Indian west/east coast fishing seasons (illustrative bucketing used
    # only to give the synthetic data a believable seasonal signal):
    # SW monsoon (Jun-Sep) rougher seas + a trawling ban window in many
    # states; post-monsoon (Oct-Jan) and pre-monsoon (Feb-May) calmer.
    if month in (6, 7, 8, 9):
        return "monsoon"
    if month in (10, 11, 12, 1):
        return "post_monsoon"
    return "pre_monsoon"


def _simulate_catch_kg(row, species_base):
    """The real relationship the catch model has to learn. Every factor
    here maps to a column in the dataset -- nothing here is invisible to
    the model."""
    lo, hi = species_base["catch_min_kg"], species_base["catch_max_kg"]
    base = (lo + hi) / 2.0

    zone_factor = 0.55 + 0.90 * (row["zone_yield_score"] / 100.0)  # 0.55 - 1.45
    chl_factor = 0.75 + 0.5 * min(row["chlorophyll_mg_m3"] / 2.5, 1.4)  # more phytoplankton -> more fish, saturating
    sst_penalty = 1.0 - 0.03 * abs(row["sea_surface_temperature_c"] - 28.0)  # ~28C sweet spot for these coasts
    wave_penalty = max(0.35, 1.0 - 0.28 * row["wave_height_m"])  # rough seas hurt catch efficiency
    wind_penalty = max(0.55, 1.0 - 0.018 * row["wind_speed_kmh"])
    rain_penalty = max(0.7, 1.0 - 0.01 * row["rainfall_mm"])

    gear_factor = GEAR_EFFICIENCY[row["gear_type"]]
    boat_factor = BOAT_EFFICIENCY[row["boat_type"]]

    # Dawn/dusk boost -- a real, well-known pattern (crepuscular feeding).
    hour = row["hour_of_day"]
    hour_factor = 1.15 if (hour <= 8 or hour >= 17) else 0.90

    # Longer trips catch more but with diminishing returns.
    duration_factor = 0.6 + 0.55 * min(row["trip_duration_hours"] / 10.0, 1.6)

    effort_penalty = max(0.6, 1.0 - 0.01 * max(0, row["fishing_effort_vessels"] - 5))

    catch = (
        base
        * zone_factor
        * chl_factor
        * sst_penalty
        * wave_penalty
        * wind_penalty
        * rain_penalty
        * gear_factor
        * boat_factor
        * hour_factor
        * duration_factor
        * effort_penalty
    )
    catch *= np.random.normal(1.0, 0.14)  # natural variability
    return max(0.0, round(catch, 1))


def _simulate_price(species_base, month, demand_bonus, trend_progress):
    base = species_base["price_per_kg"]
    # Mild seasonal demand swing + a slow multi-year drift + noise, so the
    # price model has real trend/seasonality signal to find (not pure
    # noise around a constant).
    seasonal = 1.0 + 0.06 * math.sin((month / 12.0) * 2 * math.pi)
    drift = 1.0 + 0.08 * trend_progress
    demand_mult = {"High": 1.08, "Medium": 1.0, "Low": 0.90}[demand_bonus]
    price = base * seasonal * drift * demand_mult * np.random.normal(1.0, 0.05)
    return max(10.0, round(price, 2))


def generate():
    zones = ref.zones()
    harbours = ref.harbours()
    species_market = ref.species_market()

    rows = []
    zone_weights = np.array([z["yield_score_pct"] for z in zones], dtype=float)
    zone_weights = zone_weights / zone_weights.sum()

    start_days_ago = 730  # ~2 years of synthetic history

    for i in range(N_ROWS):
        zone = np.random.choice(zones, p=zone_weights)
        day_offset = int(np.random.uniform(0, start_days_ago))
        # Cheap "date" without importing datetime timezone machinery: just
        # need month-of-year + a monotonically increasing trend progress.
        month = ((day_offset // 30) % 12) + 1
        trend_progress = 1.0 - (day_offset / start_days_ago)

        # Pick nearest harbour to this zone as the trip's home port.
        dists = [(_haversine_km(zone["center"][0], zone["center"][1], h["coordinates"][0], h["coordinates"][1]), h) for h in harbours]
        dists.sort(key=lambda t: t[0])
        harbour = dists[0][1]
        distance_km = round(dists[0][0] * np.random.uniform(0.9, 1.15), 1)

        # Species: 78% of the time pick one of the zone's own dominant
        # species (mapped to our 5 market species), else a random other
        # species -- gives the species model real positive AND negative
        # examples per zone instead of a trivial 1:1 lookup.
        candidates = [s for s in species_market if _species_alias_hit(s["species"], zone["dominant_species"])]
        if candidates and np.random.random() < 0.78:
            species_base = random.choice(candidates)
            species_suitable = 1
        else:
            species_base = random.choice(species_market)
            species_suitable = 1 if species_base in candidates else 0

        boat_type = random.choice(BOAT_TYPES)
        # A traditional boat realistically can't reach a far zone -- keep
        # the dataset physically sane rather than allowing nonsense combos.
        if distance_km > BOAT_MAX_RANGE_KM[boat_type]:
            boat_type = "Mechanized Trawler" if distance_km > BOAT_MAX_RANGE_KM["Motorized"] else "Motorized"

        gear_type = random.choice(GEAR_TYPES)
        season = _season_of(month)
        monsoon_bump = 1.6 if season == "monsoon" else (1.0 if season == "pre_monsoon" else 1.15)

        wave_height = max(0.2, np.random.normal(1.1 * monsoon_bump, 0.45))
        wind_speed = max(3.0, np.random.normal(14 * monsoon_bump, 5.0))
        rainfall = max(0.0, np.random.exponential(6.0 * monsoon_bump))
        sst = zone["sst_celsius"] + np.random.normal(0, 0.6) + 0.4 * math.sin((month / 12.0) * 2 * math.pi)
        chlorophyll = max(0.1, zone["chlorophyll_mg_m3"] + np.random.normal(0, 0.35))

        hour_of_day = int(np.random.choice(
            [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
            p=_hour_weights(),
        ))
        trip_duration = max(1.0, np.random.normal({"Traditional (Non-mechanized)": 5, "Motorized": 8, "Mechanized Trawler": 14}[boat_type], 2.5))
        fishing_effort = max(1, int(np.random.normal(zone["vessels_in_zone"], 3)))

        row = {
            "trip_id": f"DEMO-{i:05d}",
            "month": month,
            "season": season,
            "zone_id": zone["id"],
            "zone_name": zone["name"],
            "latitude": round(zone["center"][0] + np.random.uniform(-0.08, 0.08), 4),
            "longitude": round(zone["center"][1] + np.random.uniform(-0.08, 0.08), 4),
            "origin_harbour_id": harbour["id"],
            "distance_from_port_km": distance_km,
            "species": species_base["species"],
            "species_suitable_for_zone": species_suitable,
            "gear_type": gear_type,
            "boat_type": boat_type,
            "trip_duration_hours": round(trip_duration, 1),
            "hour_of_day": hour_of_day,
            "sea_surface_temperature_c": round(sst, 2),
            "chlorophyll_mg_m3": round(chlorophyll, 2),
            "wave_height_m": round(wave_height, 2),
            "wind_speed_kmh": round(wind_speed, 1),
            "wind_direction": random.choice(WIND_DIRECTIONS),
            "rainfall_mm": round(rainfall, 1),
            "zone_yield_score": zone["yield_score_pct"],
            "fishing_effort_vessels": fishing_effort,
            "demand": species_base["demand"],
        }
        row["catch_kg"] = _simulate_catch_kg(row, species_base)
        row["market_price_per_kg"] = _simulate_price(species_base, month, species_base["demand"], trend_progress)
        # Simple, deterministic (non-ML) cost fields -- fed to the profit
        # engine later, not to any prediction model.
        row["fuel_cost_inr"] = round(distance_km * 2 * 10.5 * (1.0 if boat_type != "Mechanized Trawler" else 1.6), 0)
        row["transport_cost_inr"] = round(distance_km * 6.5, 0)
        rows.append(row)

    df = pd.DataFrame(rows)
    df.to_csv(OUT_PATH, index=False)
    print(f"Wrote {len(df)} synthetic DEMO rows to {OUT_PATH}")
    print(df[["catch_kg", "market_price_per_kg", "zone_yield_score", "wave_height_m"]].describe())
    return df


def _hour_weights():
    # Crepuscular (dawn/dusk) bias -- early morning and evening trips more
    # common, matching _simulate_catch_kg's hour_factor logic above.
    hours = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
    w = np.array([3, 4, 4, 3, 2, 1, 1, 1, 1, 1, 1, 1, 2, 3, 4, 3], dtype=float)
    return w / w.sum()


if __name__ == "__main__":
    generate()

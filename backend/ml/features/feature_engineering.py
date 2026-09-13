"""
Shared feature engineering for the ORCA Fisherman AI Decision Studio.

Used by BOTH the training scripts and the live prediction service
(inference/predictor.py) so a request at inference time is encoded
*exactly* the same way the training data was -- this is the single most
common way a hand-rolled ML pipeline silently breaks (train/serve skew),
so it lives in one place instead of being duplicated.

Every "build_*_features" function below documents its own drop_target
behaviour explicitly and returns a plain pandas DataFrame with a fixed,
deterministic column order, "columns" attribute-compatible with whatever
was used at training time (see FEATURE_COLUMNS_* saved alongside each
model's metrics.json).
"""
import math

import numpy as np
import pandas as pd

GEAR_TYPES = ["Gillnet", "Trawl", "Ring Seine", "Longline", "Hook & Line"]
BOAT_TYPES = ["Traditional (Non-mechanized)", "Motorized", "Mechanized Trawler"]
SPECIES_LIST = ["Tuna", "Pomfret", "Sardine", "Mackerel", "Kingfish"]
DEMAND_LEVELS = ["High", "Medium", "Low"]
WIND_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
SEASONS = ["monsoon", "post_monsoon", "pre_monsoon"]


def _one_hot(df: pd.DataFrame, col: str, categories: list) -> pd.DataFrame:
    """One-hot encode `col` against a FIXED category list (not whatever
    happens to be present in this particular batch) so a single-row
    inference request produces the same columns, in the same order, that
    the model was trained on."""
    out = pd.DataFrame(index=df.index)
    for cat in categories:
        out[f"{col}__{cat}"] = (df[col] == cat).astype(int)
    return out


def _cyclical(df: pd.DataFrame, col: str, period: float) -> pd.DataFrame:
    radians = 2 * math.pi * (df[col].astype(float) / period)
    return pd.DataFrame({f"{col}_sin": np.sin(radians), f"{col}_cos": np.cos(radians)}, index=df.index)


# ---------------------------------------------------------------------
# Catch model: per-trip expected catch (kg). Needs everything that would
# actually change how much a specific trip catches.
# ---------------------------------------------------------------------
CATCH_NUMERIC = [
    "zone_yield_score", "chlorophyll_mg_m3", "sea_surface_temperature_c",
    "wave_height_m", "wind_speed_kmh", "rainfall_mm", "distance_from_port_km",
    "trip_duration_hours", "fishing_effort_vessels",
]


def build_catch_features(df: pd.DataFrame) -> pd.DataFrame:
    parts = [
        df[CATCH_NUMERIC].reset_index(drop=True),
        _cyclical(df, "month", 12).reset_index(drop=True),
        _cyclical(df, "hour_of_day", 24).reset_index(drop=True),
        _one_hot(df, "gear_type", GEAR_TYPES).reset_index(drop=True),
        _one_hot(df, "boat_type", BOAT_TYPES).reset_index(drop=True),
        _one_hot(df, "species", SPECIES_LIST).reset_index(drop=True),
        _one_hot(df, "wind_direction", WIND_DIRECTIONS).reset_index(drop=True),
    ]
    return pd.concat(parts, axis=1)


# ---------------------------------------------------------------------
# Zone model: a zone's general fishing potential right now, independent
# of which species/gear/boat a particular fisherman brings -- so it can
# rank *candidate zones* before a species/gear is even chosen.
# ---------------------------------------------------------------------
ZONE_NUMERIC = [
    "zone_yield_score", "chlorophyll_mg_m3", "sea_surface_temperature_c",
    "wave_height_m", "wind_speed_kmh", "rainfall_mm", "distance_from_port_km",
    "fishing_effort_vessels",
]


def build_zone_features(df: pd.DataFrame) -> pd.DataFrame:
    parts = [
        df[ZONE_NUMERIC].reset_index(drop=True),
        _cyclical(df, "month", 12).reset_index(drop=True),
    ]
    return pd.concat(parts, axis=1)


# ---------------------------------------------------------------------
# Species model: is THIS species a good match for THESE zone/ocean
# conditions right now? (binary "suitable" classifier -> probability
# doubles as a 0-100 ranking score across the species list.)
# ---------------------------------------------------------------------
SPECIES_NUMERIC = [
    "zone_yield_score", "chlorophyll_mg_m3", "sea_surface_temperature_c",
    "wave_height_m",
]


def build_species_features(df: pd.DataFrame) -> pd.DataFrame:
    parts = [
        df[SPECIES_NUMERIC].reset_index(drop=True),
        _one_hot(df, "species", SPECIES_LIST).reset_index(drop=True),
        _one_hot(df, "season", SEASONS).reset_index(drop=True),
    ]
    return pd.concat(parts, axis=1)


# ---------------------------------------------------------------------
# Price model: species market price from season/demand -- deliberately
# does NOT see zone/ocean columns (price is a market phenomenon, not an
# oceanographic one; keeping them out avoids the model "cheating" by
# picking up spurious zone/price correlation baked into demo data).
# ---------------------------------------------------------------------
def build_price_features(df: pd.DataFrame) -> pd.DataFrame:
    parts = [
        _cyclical(df, "month", 12).reset_index(drop=True),
        _one_hot(df, "species", SPECIES_LIST).reset_index(drop=True),
        _one_hot(df, "demand", DEMAND_LEVELS).reset_index(drop=True),
    ]
    return pd.concat(parts, axis=1)

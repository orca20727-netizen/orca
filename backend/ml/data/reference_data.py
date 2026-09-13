"""
Lazy-loaded, cached access to ORCA's EXISTING reference data files
(pfz_zones.json, harbours.json, fisherman_market.json) for the AI
Decision Studio routes -- these are DATA SOURCES the decision engine
reads, not something the ML layer re-implements (same files
fisherman_agent.py and pfz_agent.py already load).

IMPORTANT -- two different layouts to handle: in the SOURCE repo these
files live under data/data/ (that's where this checkout has them). But
the Dockerfile that builds the deployed image does `COPY data/data/
data/`, which FLATTENS one level -- so inside the running container
they end up at data/<file>, not data/data/<file>, exactly matching what
every existing agent already reads (see agents/pfz_agent.py: `backend/
agents/../../data/pfz_zones.json`, i.e. <app_root>/data/pfz_zones.json).
The repo also has same-named files sitting at the repo root, which are
unused legacy leftovers the Dockerfile never copies at all.

So: try the deployed-container layout (data/<file>, matching every other
agent) FIRST, and fall back to the source-tree layout (data/data/<file>)
so training/dataset-generation scripts run directly against a source
checkout still work. Never fall back to the repo-root copies -- those
aren't part of the deployed image.
"""
import json
import os
from functools import lru_cache

_REPO_ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "..")
_CANDIDATE_DATA_DIRS = [
    os.path.join(_REPO_ROOT, "data"),          # deployed container layout
    os.path.join(_REPO_ROOT, "data", "data"),  # source-tree layout
]


def _read(filename: str) -> dict:
    tried = []
    for d in _CANDIDATE_DATA_DIRS:
        path = os.path.join(d, filename)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        tried.append(path)
    raise FileNotFoundError(f"{filename} not found in any of: {tried}")


@lru_cache(maxsize=1)
def zones() -> list:
    return _read("pfz_zones.json")["zones"]


@lru_cache(maxsize=1)
def harbours() -> list:
    return _read("harbours.json")["harbours"]


@lru_cache(maxsize=1)
def species_market() -> list:
    return _read("fisherman_market.json")["species_market"]


@lru_cache(maxsize=1)
def default_trip_cost() -> dict:
    return _read("fisherman_market.json").get("default_trip_cost", {"fuel": 4200, "ice": 1200, "other": 600})


def species_by_name(name: str) -> dict:
    for s in species_market():
        if s["species"].lower() == (name or "").lower():
            return s
    return species_market()[0]


def zone_by_id(zone_id: str):
    for z in zones():
        if z["id"] == zone_id:
            return z
    return None

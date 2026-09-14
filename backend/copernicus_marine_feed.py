"""Real chlorophyll-a + sea-surface-temperature from the Copernicus Marine
Service (EU/Mercator Ocean), used to replace SatelliteAgent's SST-delta
*estimate* for chlorophyll with an actual measured/analysed value -- Open-
Meteo (ORCA's other live ocean source) has no ocean-color/chlorophyll field
at all, which is exactly why that estimate existed in the first place.

## Configuration
Set COPERNICUSMARINE_SERVICE_USERNAME / COPERNICUSMARINE_SERVICE_PASSWORD to
a FREE account created at https://data.marine.copernicus.eu (these are the
Copernicus Marine Toolbox's own expected env var names -- see
https://help.marine.copernicus.eu/en/articles/8185007 -- so the toolbox
picks them up automatically with no credentials file written to disk,
important since this runs in an ephemeral container).

Not configured -> every function here is a clean no-op (returns None) and
SatelliteAgent keeps using its existing SST-delta estimate, exactly like
every other optional live feed in this app (ORCA_*_FEED_URL,
AISSTREAM_API_KEY): a missing key degrades gracefully, it never crashes.

## Products (near-real-time, global -- both cover the Arabian Sea/Bay of
## Bengal used by ORCA's PFZ zones)
- Chlorophyll-a: product GLOBAL_ANALYSISFORECAST_BGC_001_028, dataset
  `cmems_mod_glo_bgc-pft_anfc_0.25deg_P1D-m`, variable "chl" (mg/m3), stored
  on 50 depth levels (~0.49m to ~5728m) -- like SST below, constrained to
  the shallowest level for the surface value. (Confirmed live in production:
  omitting the depth bound here returns NaN at every real coastal
  coordinate tested, because the unconstrained query returns all 50 depths
  per timestamp and an arbitrary one gets picked, typically deeper than the
  seafloor at these continental-shelf zones.) Daily-mean, ~0.25 deg (~28km)
  resolution, delivered ~12:00 UTC.
- SST: product GLOBAL_ANALYSISFORECAST_PHY_001_024, dataset
  `cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m`, variable "thetao"
  (potential temperature, deg C -- already Celsius, no Kelvin conversion)
  at the shallowest depth level (~0.49m) as the surface value. Daily-mean,
  ~0.083 deg (~8km) resolution.

Both update once a day, so this is polled on a multi-hour interval
(see COPERNICUS_REFRESH_SECONDS in live_scheduler.py) and cached in
live_data's LiveDataStore, never called per API request -- opening a
remote Zarr store and subsetting it is far too slow (multi-second) to run
on every page load.
"""
import asyncio
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

CHL_DATASET_ID = "cmems_mod_glo_bgc-pft_anfc_0.25deg_P1D-m"
CHL_VARIABLE = "chl"
SST_DATASET_ID = "cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m"
SST_VARIABLE = "thetao"

SOURCE_LABEL = (
    "Copernicus Marine Service "
    "(GLOBAL_ANALYSISFORECAST_BGC_001_028 chlorophyll + "
    "GLOBAL_ANALYSISFORECAST_PHY_001_024 SST)"
)


def is_configured() -> bool:
    return bool(os.getenv("COPERNICUSMARINE_SERVICE_USERNAME")) and bool(
        os.getenv("COPERNICUSMARINE_SERVICE_PASSWORD")
    )


def _lookback_window() -> "tuple[str, str]":
    # Both products are daily-mean and can lag a day or two behind "now"
    # (analysis re-runs, provider delivery schedule) -- a 4-day lookback
    # window means we always find at least the most recent available day
    # rather than getting an empty result on a slow-delivery day, and we
    # always take the LATEST row within that window (see below).
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=4)).strftime("%Y-%m-%dT00:00:00")
    end = now.strftime("%Y-%m-%dT23:59:59")
    return start, end


def _fetch_point_sync(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    try:
        import copernicusmarine
    except ImportError:
        logger.warning("copernicusmarine package not installed; skipping live ocean-color fetch")
        return None

    start, end = _lookback_window()
    try:
        chl_df = copernicusmarine.read_dataframe(
            dataset_id=CHL_DATASET_ID,
            variables=[CHL_VARIABLE],
            minimum_longitude=lon,
            maximum_longitude=lon,
            minimum_latitude=lat,
            maximum_latitude=lat,
            minimum_depth=0,
            maximum_depth=1,
            coordinates_selection_method="nearest",
            start_datetime=start,
            end_datetime=end,
        )
        sst_df = copernicusmarine.read_dataframe(
            dataset_id=SST_DATASET_ID,
            variables=[SST_VARIABLE],
            minimum_longitude=lon,
            maximum_longitude=lon,
            minimum_latitude=lat,
            maximum_latitude=lat,
            minimum_depth=0,
            maximum_depth=1,
            coordinates_selection_method="nearest",
            start_datetime=start,
            end_datetime=end,
        )
    except Exception as exc:
        logger.warning("Copernicus Marine fetch failed for (%.3f, %.3f): %s", lat, lon, exc)
        return None

    if chl_df is None or sst_df is None or chl_df.empty or sst_df.empty:
        logger.warning("Copernicus Marine returned no rows for (%.3f, %.3f)", lat, lon)
        return None

    try:
        chl_row = chl_df.sort_values("time").iloc[-1]
        sst_row = sst_df.sort_values("time").iloc[-1]
        sst_celsius = float(sst_row[SST_VARIABLE])
        chlorophyll_mg_m3 = float(chl_row[CHL_VARIABLE])
    except Exception as exc:
        logger.warning("Copernicus Marine response parsing failed for (%.3f, %.3f): %s", lat, lon, exc)
        return None

    # The "nearest" coordinate lookup can still land on a masked/land grid
    # cell (common this close to the coast, which is exactly where ORCA's
    # PFZ zones sit) -- CMEMS represents those as NaN, and FastAPI's default
    # JSONResponse sets allow_nan=False, so a NaN reaching the API crashes
    # the whole request with "Out of range float values are not JSON
    # compliant" instead of just this one field being missing. Treat a
    # non-finite reading as no data, same as an empty/failed fetch, so
    # SatelliteAgent falls back to its estimate instead of ever serving or
    # caching a NaN.
    if not (math.isfinite(sst_celsius) and math.isfinite(chlorophyll_mg_m3)):
        logger.warning(
            "Copernicus Marine returned non-finite value(s) for (%.3f, %.3f) (sst=%s, chl=%s) -- "
            "likely a masked/land grid cell; treating as no data",
            lat, lon, sst_celsius, chlorophyll_mg_m3,
        )
        return None

    return {
        "sst_celsius": round(sst_celsius, 2),
        "chlorophyll_mg_m3": round(chlorophyll_mg_m3, 2),
        "observed_at": str(chl_row.get("time", "")) or datetime.now(timezone.utc).isoformat(),
        "source": SOURCE_LABEL,
    }


async def fetch_point(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """Non-blocking wrapper -- read_dataframe() is a blocking network call
    that opens a remote dataset, so it must not run directly on the event
    loop (it would stall every other request for its whole duration)."""
    if not is_configured():
        return None
    return await asyncio.to_thread(_fetch_point_sync, lat, lon)

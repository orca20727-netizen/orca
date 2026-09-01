import os
from typing import Dict, Any, Optional

try:
    import httpx
except ImportError:  # pragma: no cover - only hit if the dependency is missing at runtime
    httpx = None

MARINE_API_URL = "https://marine-api.open-meteo.com/v1/marine"
FORECAST_API_URL = "https://api.open-meteo.com/v1/forecast"

# Configurable via .env / environment (see .env.example) so a deployment on
# a slow or high-latency network can raise this without a code change.
OPEN_METEO_TIMEOUT = float(os.getenv("OPEN_METEO_TIMEOUT", "10"))

# Thunderstorm-family WMO weather codes used by Open-Meteo.
THUNDERSTORM_CODES = {95, 96, 99}

# Fallback values used only when the live Open-Meteo call fails (offline
# demo / no network) -- kept identical to the original static constants so
# behavior degrades gracefully instead of erroring out.
FALLBACK_SWH_M = 1.25
FALLBACK_WIND_KNOTS = 14.2
FALLBACK_LIGHTNING_PCT = 8


class WeatherHazardAgent:
    def __init__(self):
        self.name = "Weather & Marine Hazard Agent"

    async def _fetch_marine(self, lat: float, lon: float) -> Optional[Dict[str, Any]]:
        if httpx is None:
            return None
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "wave_height,wave_direction,wave_period",
            "timezone": "Asia/Kolkata",
        }
        try:
            async with httpx.AsyncClient(timeout=OPEN_METEO_TIMEOUT) as client:
                resp = await client.get(MARINE_API_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
                return data.get("current")
        except Exception:
            return None

    async def _fetch_wind_and_sky(self, lat: float, lon: float) -> Optional[Dict[str, Any]]:
        if httpx is None:
            return None
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "wind_speed_10m,wind_direction_10m,weather_code,cloud_cover",
            "wind_speed_unit": "kn",
            "timezone": "Asia/Kolkata",
        }
        try:
            async with httpx.AsyncClient(timeout=OPEN_METEO_TIMEOUT) as client:
                resp = await client.get(FORECAST_API_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
                return data.get("current")
        except Exception:
            return None

    async def evaluate_hazard(self, lat: float = 9.85, lon: float = 75.60) -> Dict[str, Any]:
        marine = await self._fetch_marine(lat, lon)
        sky = await self._fetch_wind_and_sky(lat, lon)

        live_swh = marine is not None
        live_wind = sky is not None

        swh = float(marine["wave_height"]) if live_swh and marine.get("wave_height") is not None else FALLBACK_SWH_M
        wind_knots = (
            float(sky["wind_speed_10m"])
            if live_wind and sky.get("wind_speed_10m") is not None
            else FALLBACK_WIND_KNOTS
        )
        wind_direction_deg = sky.get("wind_direction_10m") if live_wind else None

        if live_wind and sky.get("weather_code") in THUNDERSTORM_CODES:
            lightning_pct = 55
        elif live_wind and sky.get("cloud_cover") is not None:
            # Rough proxy in the absence of a dedicated lightning-probability
            # field: heavier cloud cover raises the chance somewhat.
            lightning_pct = min(30, round(float(sky["cloud_cover"]) * 0.3))
        else:
            lightning_pct = FALLBACK_LIGHTNING_PCT

        # Sea state derived from real (or fallback) wave height. Uses the
        # same SWH breakpoints as the frontend's live-telemetry sea-state
        # calculation, so backend and UI never disagree for the same swh.
        if swh < 0.5:
            sea_state = 1
        elif swh < 1.25:
            sea_state = 2
        elif swh < 2.5:
            sea_state = 3
        else:
            sea_state = 4

        safety_score = 100 - int(swh * 15) - int(wind_knots * 0.8) - int(lightning_pct * 0.5)
        safety_score = max(0, min(100, safety_score))

        clearance = "SAFE" if safety_score >= 75 else ("CAUTION" if safety_score >= 50 else "UNSAFE")

        return {
            "significant_wave_height_m": round(swh, 2),
            "surface_wind_knots": round(wind_knots, 1),
            "wind_direction": self._compass(wind_direction_deg) if wind_direction_deg is not None else "Westerly",
            "sea_state_douglas": sea_state,
            "lightning_risk_pct": lightning_pct,
            "safety_score": safety_score,
            "clearance_verdict": clearance,
            "data_source": {
                "wave_height": "LIVE_OPEN_METEO_MARINE" if live_swh else "SIMULATED_FALLBACK",
                "wind": "LIVE_OPEN_METEO_FORECAST" if live_wind else "SIMULATED_FALLBACK",
            },
        }

    @staticmethod
    def _compass(deg: float) -> str:
        dirs = [
            "North", "North-Northeast", "Northeast", "East-Northeast",
            "East", "East-Southeast", "Southeast", "South-Southeast",
            "South", "South-Southwest", "Southwest", "West-Southwest",
            "West", "West-Northwest", "Northwest", "North-Northwest",
        ]
        idx = int((deg / 22.5) + 0.5) % 16
        return dirs[idx]

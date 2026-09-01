"""Allowlisted discovery/provenance registry for marine data sources.

This does not scrape or infer restricted provider data. It periodically checks
known public pages/APIs and configured providers, then reports availability so
agents can select a documented source tier for each request.
"""
import asyncio
import os
from datetime import datetime, timezone
from typing import Any, Dict

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

SOURCES = {
    "open_meteo_marine": {"dataset": "ocean_sst_weather", "url": "https://marine-api.open-meteo.com/v1/marine", "tier": "PUBLIC_LIVE"},
    "incois_pfz_webgis": {"dataset": "pfz_advisory", "url": "https://www.incois.gov.in/MarineFisheries/PfzWebGis", "tier": "PUBLIC_DISCOVERY_ONLY"},
    "copernicus_s3_olci": {"dataset": "chlorophyll", "url": "https://sh.dataspace.copernicus.eu/process/v1", "tier": "AUTH_REQUIRED_DISCOVERY"},
}


class DataSourceRegistry:
    def __init__(self) -> None:
        self.status: Dict[str, Dict[str, Any]] = {}

    async def _probe(self, name: str, config: Dict[str, str]) -> Dict[str, Any]:
        if httpx is None:
            return {"name": name, **config, "reachable": False, "reason": "httpx not installed", "checked_at": self._now()}
        try:
            async with httpx.AsyncClient(timeout=float(os.getenv("SOURCE_REGISTRY_TIMEOUT", "5")), follow_redirects=True) as client:
                response = await client.get(config["url"])
            return {"name": name, **config, "reachable": response.status_code < 500, "http_status": response.status_code, "checked_at": self._now()}
        except Exception as exc:
            return {"name": name, **config, "reachable": False, "reason": str(exc), "checked_at": self._now()}

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    async def refresh(self) -> Dict[str, Dict[str, Any]]:
        candidates = dict(SOURCES)
        for kind in ("ocean", "pfz", "vessel"):
            url = os.getenv(f"ORCA_{kind.upper()}_FEED_URL", "").strip()
            if url:
                candidates[f"configured_{kind}_feed"] = {"dataset": kind, "url": url, "tier": "CONFIGURED_LIVE"}
        results = await asyncio.gather(*(self._probe(name, config) for name, config in candidates.items()))
        self.status = {result["name"]: result for result in results}
        return self.status

    def for_dataset(self, dataset: str) -> Dict[str, Any]:
        matches = [item for item in self.status.values() if item.get("dataset") == dataset]
        reachable = [item for item in matches if item.get("reachable")]
        return {"dataset": dataset, "candidates": matches, "selected_candidate": reachable[0]["name"] if reachable else None}


data_source_registry = DataSourceRegistry()

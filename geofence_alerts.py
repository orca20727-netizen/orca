"""Pure threshold logic shared by real-position and simulated-vessel flows."""
import os
from typing import Any, Dict, Optional

GEOFENCE_WARNING_NM = float(os.getenv("GEOFENCE_WARNING_NM", "5"))


def geofence_alert_for(result: Dict[str, Any], warning_nm: float = GEOFENCE_WARNING_NM) -> Optional[Dict[str, Any]]:
    """Turn a geofence reading into one actionable alert, or None when clear."""
    if result.get("mpa_breach_detected"):
        return {
            "alert_type": "MPA_BREACH", "severity": "CRITICAL",
            "key": f"MPA_BREACH:{result.get('mpa_breached_name', 'unknown')}",
            "title": "Marine protected area entered", "message": f"Exit {result.get('mpa_breached_name', 'the protected area')} immediately.",
            "data_source": "LIVE_GEOFENCE_CHECK", "details": result,
        }
    if result.get("mpa_status") == "MPA_PROXIMITY_WARNING":
        return {
            "alert_type": "MPA_PROXIMITY", "severity": "WARNING",
            "key": "MPA_PROXIMITY", "title": "Approaching marine protected area",
            "message": f"Boundary is {result.get('distance_to_nearest_mpa_nm')} NM away. Keep clear of the protected-area buffer.",
            "data_source": "LIVE_GEOFENCE_CHECK", "details": result,
        }
    distance = result.get("distance_to_imbl_nm")
    if isinstance(distance, (int, float)) and distance <= warning_nm:
        danger = result.get("imbl_status") == "DANGER_IMMINENT_BOUNDARY_BREACH"
        return {
            "alert_type": "IMBL_PROXIMITY", "severity": "CRITICAL" if danger else "WARNING",
            "key": f"IMBL:{result.get('nearest_imbl_boundary', 'unknown')}",
            "title": "IMBL boundary danger" if danger else "Approaching IMBL boundary",
            "message": f"{result.get('nearest_imbl_country', 'International')} boundary is {distance} NM away (warning threshold: {warning_nm} NM).",
            "data_source": "LIVE_GEOFENCE_CHECK", "details": result,
        }
    return None

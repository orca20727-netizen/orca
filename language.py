"""Small, offline-safe language detection for ORCA chat requests."""
import re
from typing import Any, Dict

SUPPORTED_LANGUAGES = {"en", "hi", "ta", "ml"}
LANGUAGE_NAMES = {"en": "English", "hi": "Hindi", "ta": "Tamil", "ml": "Malayalam"}

try:
    from langdetect import DetectorFactory, detect
    DetectorFactory.seed = 0
except ImportError:  # Offline/local simulation remains functional without it.
    detect = None


def detect_query_language(query: str) -> Dict[str, Any]:
    """Return a supported response language plus transparent provenance.

    Unicode script detection is deterministic for the regional languages ORCA
    supports; langdetect handles Latin-script language identification when the
    optional package is installed. Unsupported languages intentionally fall
    back to English rather than guessing a translation.
    """
    text = (query or "").strip()
    if re.search(r"[\u0900-\u097F]", text):
        return {"detected_code": "hi", "response_code": "hi", "supported": True, "method": "UNICODE_SCRIPT", "note": None}
    if re.search(r"[\u0B80-\u0BFF]", text):
        return {"detected_code": "ta", "response_code": "ta", "supported": True, "method": "UNICODE_SCRIPT", "note": None}
    if re.search(r"[\u0D00-\u0D7F]", text):
        return {"detected_code": "ml", "response_code": "ml", "supported": True, "method": "UNICODE_SCRIPT", "note": None}

    detected = "en"
    method = "SAFE_DEFAULT"
    if detect is not None and text:
        try:
            detected = (detect(text) or "en").split("-")[0].lower()
            method = "LANGDETECT"
        except Exception:
            method = "SAFE_DEFAULT"
    supported = detected in SUPPORTED_LANGUAGES
    return {
        "detected_code": detected,
        "response_code": detected if supported else "en",
        "supported": supported,
        "method": method,
        "note": None if supported else "Language not fully supported; responding in English.",
    }

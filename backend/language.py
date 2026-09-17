"""Small, offline-safe language detection for ORCA chat requests."""
import re
from typing import Any, Dict

SUPPORTED_LANGUAGES = {"en", "hi", "ta", "ml", "gu", "mr", "kn", "te", "or", "bn"}
LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "ta": "Tamil",
    "ml": "Malayalam",
    "gu": "Gujarati",
    "mr": "Marathi",
    "kn": "Kannada",
    "te": "Telugu",
    "or": "Odia",
    "bn": "Bengali",
}

# Unicode script ranges are deterministic, offline, and require no external
# AI API -- each of ORCA's supported regional languages (besides Hindi and
# Marathi, which share the Devanagari script) maps to exactly one range.
_SCRIPT_RANGES = [
    ("bn", r"[\u0980-\u09FF]"),   # Bengali
    ("or", r"[\u0B00-\u0B7F]"),   # Odia
    ("ta", r"[\u0B80-\u0BFF]"),   # Tamil
    ("te", r"[\u0C00-\u0C7F]"),   # Telugu
    ("kn", r"[\u0C80-\u0CFF]"),   # Kannada
    ("ml", r"[\u0D00-\u0D7F]"),   # Malayalam
    ("gu", r"[\u0A80-\u0AFF]"),   # Gujarati
]
_DEVANAGARI_RANGE = r"[\u0900-\u097F]"  # Shared by Hindi and Marathi

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

    Hindi and Marathi both use the Devanagari script, so script detection
    alone cannot tell them apart. When langdetect is installed, its n-gram
    model on the actual Devanagari text is used to pick "mr" over the "hi"
    default; without it (or on any detection error) the text is treated as
    Hindi, matching this module's prior behaviour. Either way this stays
    fully rule-based/offline -- no external AI API is used.
    """
    text = (query or "").strip()

    if re.search(_DEVANAGARI_RANGE, text):
        code = "hi"
        method = "UNICODE_SCRIPT"
        if detect is not None:
            try:
                if (detect(text) or "").split("-")[0].lower() == "mr":
                    code = "mr"
                    method = "UNICODE_SCRIPT+LANGDETECT"
            except Exception:
                pass
        return {"detected_code": code, "response_code": code, "supported": True, "method": method, "note": None}

    for code, pattern in _SCRIPT_RANGES:
        if re.search(pattern, text):
            return {"detected_code": code, "response_code": code, "supported": True, "method": "UNICODE_SCRIPT", "note": None}

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

"""
Neural Synthesis Agent.

Turns the multi-agent telemetry dict (weather, satellite/ocean, PFZ
ranking, IMBL/MPA geofencing, fleet, routing/ETA) plus the Supervisor's
classified intent into a single natural-language advisory.

Two tiers, always both query-aware (never one canned paragraph regardless
of intent):

  1. LIVE (Groq/Llama): used whenever GROQ_API_KEY is set and the call
     succeeds. The prompt hands the model every piece of telemetry
     collected for this request and explicitly instructs it not to invent
     numbers it wasn't given.
  2. DETERMINISTIC FALLBACK: used whenever GROQ_API_KEY is missing, the
     `groq` package isn't installed, the request times out, or the LLM
     response is malformed/empty. Never a single fixed paragraph -- it
     branches on the same classified intent so a weather question gets a
     weather-focused answer, an IMBL question gets a boundary-focused
     answer, etc.

`llm_engine` on the response always says plainly which tier actually
produced the text -- never claims a live LLM response when the fallback
ran, and never silently reuses stale wording across unrelated queries.
"""

import asyncio
import logging
import os
from typing import Any, Dict

try:
    from groq import Groq
except ImportError:  # pragma: no cover - groq package not installed
    Groq = None

logger = logging.getLogger(__name__)

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_TIMEOUT_SEC = float(os.getenv("GROQ_TIMEOUT_SEC", "8"))

SYSTEM_PROMPT = (
    "You are the Neural Synthesis layer of ORCA INSIGHT, a maritime fishing "
    "and voyage-safety advisory system for Indian coastal fishermen. You are "
    "given ONLY the structured telemetry below, already computed by "
    "specialist agents (satellite oceanography, weather/hazard, PFZ ranking, "
    "IMBL/MPA geofencing, fleet density, route planning, ETA). "
    "Use ONLY the supplied telemetry. Do not invent, estimate, or assume any "
    "number, distance, coordinate, or status that is not explicitly present "
    "below. If a piece of information the user asked about is unavailable in "
    "the telemetry, say plainly that it is unavailable rather than guessing. "
    "Directly answer the user's actual question first, then add only the "
    "telemetry that supports that answer. Keep the reply concise (3-6 "
    "sentences), in the requested response language, and end with one clear recommendation "
    "such as PROCEED, PROCEED WITH CAUTION, or DO NOT PROCEED."
)


def _fmt(value: Any, unit: str = "", unavailable: str = "unavailable") -> str:
    if value is None or value == "":
        return unavailable
    return f"{value}{unit}"


def _build_prompt(telemetry: Dict[str, Any], intent: str, response_language: str) -> str:
    query = telemetry.get("query", "")
    w = telemetry.get("weather", {}) or {}
    s = telemetry.get("satellite", {}) or {}
    p = telemetry.get("pfz", {}) or {}
    g = telemetry.get("geofence", {}) or {}
    f = telemetry.get("fleet", {}) or {}
    e = telemetry.get("eta", {}) or {}
    routing = e.get("routing", {}) or {}
    context = telemetry.get("conversation_context", {}) or {}
    history = context.get("history", [])[-6:]

    lines = [
        f"USER QUERY: {query!r}",
        f"CLASSIFIED INTENT: {intent}",
        f"RESPONSE LANGUAGE: {response_language} (write the final advisory in this language)",
        f"CONTEXT RESOLVED PFZ: {_fmt(context.get('resolved_target_pfz'))}; carried forward: {_fmt(context.get('carried_forward'))}",
        "RECENT CONVERSATION: " + " | ".join(f"{turn.get('role', 'user')}: {turn.get('text', '')}" for turn in history),
        "",
        "-- Ocean / Satellite Telemetry --",
        f"SST: {_fmt(s.get('sst_celsius'), ' C')} (source: {_fmt(s.get('data_source', {}).get('sst') if isinstance(s.get('data_source'), dict) else None)})",
        f"Chlorophyll: {_fmt(s.get('chlorophyll_mg_m3'), ' mg/m3')} ({_fmt(s.get('data_source', {}).get('chlorophyll') if isinstance(s.get('data_source'), dict) else None)})",
        "",
        "-- Weather / Hazard Telemetry --",
        f"Significant wave height: {_fmt(w.get('significant_wave_height_m'), ' m')}",
        f"Wind: {_fmt(w.get('surface_wind_knots'), ' kn')} {_fmt(w.get('wind_direction'), '')}",
        f"Sea state (Douglas): {_fmt(w.get('sea_state_douglas'))}",
        f"Weather safety score: {_fmt(w.get('safety_score'), '/100')}",
        f"Weather clearance verdict: {_fmt(w.get('clearance_verdict'))}",
        "",
        "-- PFZ Ranking --",
        f"Top recommended PFZ: {_fmt(p.get('top_recommended_pfz'))}",
        f"Predicted yield: {_fmt(p.get('yield_score_pct'), '%')}",
        f"Distance from vessel: {_fmt(p.get('distance_from_vessel_nm'), ' NM')}",
        "",
        "-- IMBL / MPA Geofencing --",
        f"Nearest IMBL boundary: {_fmt(g.get('nearest_imbl_boundary'))} ({_fmt(g.get('nearest_imbl_country'))})",
        f"Distance to IMBL: {_fmt(g.get('distance_to_imbl_nm'), ' NM')}",
        f"IMBL status: {_fmt(g.get('imbl_status'))}",
        f"MPA breach detected: {_fmt(g.get('mpa_breach_detected'))} ({_fmt(g.get('mpa_breached_name'))})",
        "",
        "-- Fleet --",
        f"Vessels in target zone: {_fmt(f.get('vessels_in_target_zone'))}",
        f"Overcrowding status: {_fmt(f.get('overcrowding_status'))}",
        f"Fleet data source: {_fmt(f.get('data_source'))}",
        "",
        "-- Route & ETA --",
        f"Route found: {_fmt(routing.get('route_found'))}",
        f"Route distance: {_fmt(e.get('route_distance_nm'), ' NM')}",
        f"Straight-line distance: {_fmt(routing.get('straight_line_distance_nm'), ' NM')}",
        f"Detour: {_fmt(routing.get('detour_nm'), ' NM')} ({_fmt(routing.get('detour_percent'), '%')})",
        f"Land avoidance active: {_fmt(routing.get('land_avoidance'))}",
        f"MPAs avoided en route: {_fmt(routing.get('avoided_mpas'))}",
        f"One-way ETA: {_fmt(e.get('one_way_eta_hours'), ' hours')}",
        f"Estimated return: {_fmt(e.get('estimated_return_ist'))}",
        f"Dusk safety verdict: {_fmt(e.get('dusk_safety_verdict'))}",
    ]
    return "\n".join(lines)


class NeuralSynthesisAgent:
    def __init__(self):
        self.name = "Neural Synthesis Agent (LLM)"
        self.api_key = os.getenv("GROQ_API_KEY")
        self._client = Groq(api_key=self.api_key) if (Groq is not None and self.api_key) else None

    async def _call_groq(self, prompt: str) -> str:
        """Runs the (synchronous) Groq SDK call off the event loop with a
        hard timeout. Raises on any failure -- caller falls back to the
        deterministic engine."""

        def _sync_call() -> str:
            completion = self._client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=400,
                temperature=0.3,
            )
            return completion.choices[0].message.content

        return await asyncio.wait_for(asyncio.to_thread(_sync_call), timeout=GROQ_TIMEOUT_SEC)

    async def synthesize(self, multi_agent_telemetry: Dict[str, Any]) -> Dict[str, Any]:
        intent = (multi_agent_telemetry.get("plan") or {}).get("intent")
        if not intent:
            # No Supervisor plan in this telemetry (e.g. a hand-built
            # telemetry dict in a test, or a degraded Supervisor node) --
            # classify directly from the raw query so behavior still
            # varies by question instead of always hitting the generic
            # branch.
            from .supervisor import classify_intent
            intent = classify_intent(multi_agent_telemetry.get("query", "") or "")
        language = multi_agent_telemetry.get("language") or {}
        response_language = language.get("response_code", "en")
        language_note = language.get("note")

        if self._client is not None:
            try:
                prompt = _build_prompt(multi_agent_telemetry, intent, response_language)
                text = await self._call_groq(prompt)
                if text and text.strip():
                    return {
                        "advisory_text": text.strip(),
                        "confidence_pct": 92,
                        "citations": ["Open-Meteo", "ORCA Multi-Agent Telemetry", f"Groq/{GROQ_MODEL}"],
                        "llm_engine": f"GROQ_LLAMA_LIVE ({GROQ_MODEL})",
                        "intent": intent,
                        "language": {"response_code": response_language, "note": language_note, "provenance": "QUERY_LANGUAGE_DETECTION"},
                    }
                logger.warning("Neural Synthesis: Groq returned an empty response -- using deterministic fallback")
            except Exception as e:
                logger.warning("Neural Synthesis: Groq call failed (%s) -- using deterministic fallback", e)

        return self._deterministic_fallback(multi_agent_telemetry, intent, response_language, language_note)

    # -- Deterministic, query-aware fallback --------------------------------

    def _deterministic_fallback(self, t: Dict[str, Any], intent: str, response_language: str = "en", language_note: str | None = None) -> Dict[str, Any]:
        w = t.get("weather", {}) or {}
        p = t.get("pfz", {}) or {}
        g = t.get("geofence", {}) or {}
        f = t.get("fleet", {}) or {}
        e = t.get("eta", {}) or {}
        routing = e.get("routing", {}) or {}

        if intent == "WEATHER_SAFETY":
            txt = (
                f"Sea state {_fmt(w.get('sea_state_douglas'))} (Douglas scale) with "
                f"{_fmt(w.get('significant_wave_height_m'), ' m')} significant wave height and "
                f"{_fmt(w.get('surface_wind_knots'), ' kn')} winds. "
                f"Weather safety score is {_fmt(w.get('safety_score'), '/100')}. "
                f"Weather clearance verdict: {_fmt(w.get('clearance_verdict'))}."
            )
        elif intent == "IMBL_BOUNDARY":
            txt = (
                f"Nearest IMBL boundary is {_fmt(g.get('nearest_imbl_boundary'))} "
                f"({_fmt(g.get('nearest_imbl_country'))}), currently "
                f"{_fmt(g.get('distance_to_imbl_nm'), ' NM')} away. "
                f"IMBL status: {_fmt(g.get('imbl_status'))}."
            )
        elif intent == "MPA_SAFETY":
            breach = g.get("mpa_breach_detected")
            if breach:
                txt = (
                    f"WARNING: current position falls inside a Marine Protected Area "
                    f"({_fmt(g.get('mpa_breached_name'))}). Fishing here is restricted -- "
                    f"move to open water or a designated PFZ before deploying gear."
                )
            elif breach is False:
                txt = (
                    "No Marine Protected Area breach detected at the checked position. "
                    f"Nearest IMBL clearance is {_fmt(g.get('distance_to_imbl_nm'), ' NM')} "
                    f"({_fmt(g.get('imbl_status'))})."
                )
            else:
                txt = "MPA breach status is unavailable for this position -- geofencing telemetry did not return a result."
        elif intent == "FLEET_DENSITY":
            txt = (
                f"{_fmt(f.get('vessels_in_target_zone'))} vessels are currently reported in the "
                f"target zone, out of {_fmt(f.get('total_active_vessels'))} active vessels tracked "
                f"overall. Overcrowding status: {_fmt(f.get('overcrowding_status'))}. "
                f"Fleet data source: {_fmt(f.get('data_source'))}."
            )
        elif intent == "ROUTE_PLANNING":
            if routing.get("route_found") is False:
                txt = (
                    "No safe maritime route could be found avoiding land and Marine Protected "
                    f"Areas for this origin/destination pair ({_fmt(routing.get('reason'))}). "
                    "Recommend selecting a different harbour or PFZ."
                )
            else:
                txt = (
                    f"Route distance is {_fmt(e.get('route_distance_nm'), ' NM')} "
                    f"(straight-line: {_fmt(routing.get('straight_line_distance_nm'), ' NM')}, "
                    f"detour {_fmt(routing.get('detour_nm'), ' NM')} / {_fmt(routing.get('detour_percent'), '%')}), "
                    f"routed to stay clear of land and MPAs"
                    + (f" (avoided: {', '.join(routing.get('avoided_mpas'))})" if routing.get("avoided_mpas") else "")
                    + f". One-way ETA is {_fmt(e.get('one_way_eta_hours'), ' hours')}."
                )
        elif intent == "ETA_RETURN":
            dusk = e.get("dusk_safety_verdict")
            if dusk == "CAUTION_RETURN_AFTER_DUSK":
                txt = (
                    f"One-way ETA is {_fmt(e.get('one_way_eta_hours'), ' hours')}. Estimated return is "
                    f"{_fmt(e.get('estimated_return_ist'))}, which falls after the dusk safety window "
                    f"({_fmt(e.get('dusk_threshold_ist'))}) -- CAUTION advised for the return leg."
                )
            elif dusk == "SAFE_RETURN_BEFORE_DUSK":
                txt = (
                    f"One-way ETA is {_fmt(e.get('one_way_eta_hours'), ' hours')}. Estimated return is "
                    f"{_fmt(e.get('estimated_return_ist'))}, comfortably before the dusk safety window "
                    f"({_fmt(e.get('dusk_threshold_ist'))})."
                )
            else:
                txt = f"One-way ETA is {_fmt(e.get('one_way_eta_hours'), ' hours')}. Return-time verdict is unavailable."
        elif intent == "PFZ_RECOMMENDATION":
            txt = (
                f"Recommended PFZ is {_fmt(p.get('top_recommended_pfz'))} "
                f"({_fmt(p.get('yield_score_pct'), '%')} predicted yield, "
                f"{_fmt(p.get('distance_from_vessel_nm'), ' NM')} from current position). "
                f"Weather clearance verdict: {_fmt(w.get('clearance_verdict'))}."
            )
        else:  # GENERAL_VOYAGE_SAFETY
            dusk = e.get("dusk_safety_verdict")
            dusk_clause = (
                "the estimated return time falls after the dusk safety window, so exercise added caution"
                if dusk == "CAUTION_RETURN_AFTER_DUSK"
                else "the estimated return is comfortably before the dusk safety window"
                if dusk == "SAFE_RETURN_BEFORE_DUSK"
                else "the return-time margin against dusk is unavailable"
            )
            txt = (
                f"Weather clearance verdict: {_fmt(w.get('clearance_verdict'))} "
                f"(safety score {_fmt(w.get('safety_score'), '/100')}). "
                f"Recommended PFZ is {_fmt(p.get('top_recommended_pfz'))} "
                f"({_fmt(p.get('yield_score_pct'), '%')} predicted yield). "
                f"One-way ETA is {_fmt(e.get('one_way_eta_hours'), ' hours')}; {dusk_clause}."
            )

        localized = self._localize_fallback(t, intent, response_language, txt)
        if language_note:
            localized = f"{language_note} {localized}"
        return {
            "advisory_text": localized,
            "confidence_pct": 90,
            "citations": ["Open-Meteo", "ORCA Multi-Agent Telemetry"],
            "llm_engine": "DETERMINISTIC_FALLBACK (Groq unavailable or not configured)" if self._client is None
            else "DETERMINISTIC_FALLBACK (Groq call failed or returned empty response)",
            "intent": intent,
            "language": {"response_code": response_language, "note": language_note, "provenance": "QUERY_LANGUAGE_DETECTION"},
        }

    @staticmethod
    def _localize_fallback(t: Dict[str, Any], intent: str, language: str, english_text: str) -> str:
        """Offline-native response for the most common safety queries.

        Numeric telemetry stays unchanged; only wording is localized. Other
        intents retain the grounded English fallback rather than fabricating a
        translation when no translation engine is configured.
        """
        if language == "en":
            return english_text
        w = t.get("weather", {}) or {}
        wave = _fmt(w.get("significant_wave_height_m"), " m")
        wind = _fmt(w.get("surface_wind_knots"), " kn")
        verdict = _fmt(w.get("clearance_verdict"))
        if intent == "WEATHER_SAFETY":
            templates = {
                "hi": f"समुद्री सलाह: लहर की ऊंचाई {wave} और हवा {wind} है। मौसम सुरक्षा स्थिति: {verdict}। सावधानी से यात्रा करें।",
                "ta": f"கடல் ஆலோசனை: அலை உயரம் {wave}, காற்று {wind}. வானிலை பாதுகாப்பு நிலை: {verdict}. எச்சரிக்கையுடன் பயணம் செய்யவும்.",
                "ml": f"കടൽ നിർദേശം: തിരമാല ഉയരം {wave}, കാറ്റ് {wind}. കാലാവസ്ഥാ സുരക്ഷാ നില: {verdict}. ജാഗ്രതയോടെ യാത്ര ചെയ്യുക.",
            }
            return templates.get(language, english_text)
        prefixes = {
            "hi": "समुद्री सलाह: ",
            "ta": "கடல் ஆலோசனை: ",
            "ml": "കടൽ നിർദേശം: ",
        }
        return prefixes.get(language, "Marine advisory: ") + english_text

"""
ORCA Stats Synthesis Agent.

Turns the multi-agent telemetry dict (weather, satellite/ocean, PFZ
ranking, IMBL/MPA geofencing, fleet, routing/ETA) plus the Supervisor's
classified intent into a single natural-language advisory -- entirely
in-house, built from scratch on this website's own data.

There is NO external AI/LLM API call anywhere in this module, or anywhere
in this codebase: every sentence is generated from (a) the live reading
collected for this request, and (b) the accumulated historical stats this
same website has recorded from its own agents over time, via the
persistent ledger in backend/stats_store.py. Reasoning is rule-based,
branching on the same classified intent so a weather question gets a
weather-focused answer, an IMBL question gets a boundary-focused answer,
etc. -- never one canned paragraph regardless of what was asked.

Where enough history has accumulated (at least 3 prior readings for that
metric), the answer adds a clause comparing the live reading against the
site's own recorded average -- e.g. "1.26 m (12% above the site's own
41-reading average of 1.12 m)". With fewer than 3 stored readings (a
freshly deployed instance, or a metric nobody has asked about yet) that
clause is silently omitted rather than fabricated.

`llm_engine` is kept as a response field name for frontend/API
compatibility, but always reads "ORCA_STATS_ENGINE" now: there is only
one engine, it never depends on any external network/API availability,
and it never silently reuses stale wording across unrelated queries.
"""

import logging
from typing import Any, Dict, Optional

from stats_store import stats_store

logger = logging.getLogger(__name__)


def _fmt(value: Any, unit: str = "", unavailable: str = "unavailable") -> str:
    if value is None or value == "":
        return unavailable
    return f"{value}{unit}"


def _trend_clause(metric: str, current: Optional[float], unit: str = "", agent: Optional[str] = None) -> str:
    """Compares `current` against this website's own recorded history for
    that metric (see stats_store.trend). Returns "" -- never a fabricated
    comparison -- when there's no live value or fewer than 3 stored
    readings to compare against."""
    if current is None:
        return ""
    stats = stats_store.trend(metric, agent=agent)
    if stats.get("count", 0) < 3:
        return ""
    avg = stats["avg"]
    if not avg:
        return ""
    delta_pct = (current - avg) / avg * 100
    if abs(delta_pct) < 8:
        qualifier = "consistent with"
    elif delta_pct > 0:
        qualifier = f"{abs(delta_pct):.0f}% above"
    else:
        qualifier = f"{abs(delta_pct):.0f}% below"
    return f" ({qualifier} the site's own {stats['count']}-reading average of {avg:.2f}{unit})"


class NeuralSynthesisAgent:
    """Name kept for backward compatibility with core.py's import and the
    frontend's Agent DAG Visualizer labels. Nothing in this class calls
    an external model -- it is a rule-based reasoning engine over this
    website's own live telemetry and its own accumulated stats ledger."""

    def __init__(self):
        self.name = "ORCA Stats Synthesis Agent (rule-based, no external AI)"

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

        # Every served query is itself a stat: recording it here (not just
        # the raw agent readings) is what lets /api/health and future
        # features report "most-asked intents" from real usage.
        stats_store.record_query(intent, response_language, multi_agent_telemetry.get("query", ""))

        return self._synthesize(multi_agent_telemetry, intent, response_language, language_note)

    # -- Rule-based, query-aware, stats-grounded synthesis -------------------

    def _synthesize(self, t: Dict[str, Any], intent: str, response_language: str = "en", language_note: Optional[str] = None) -> Dict[str, Any]:
        w = t.get("weather", {}) or {}
        s = t.get("satellite", {}) or {}
        p = t.get("pfz", {}) or {}
        g = t.get("geofence", {}) or {}
        f = t.get("fleet", {}) or {}
        e = t.get("eta", {}) or {}
        routing = e.get("routing", {}) or {}

        if intent == "WEATHER_SAFETY":
            wave = w.get("significant_wave_height_m")
            lightning = w.get("lightning_risk_pct")
            lightning_level = (
                "High" if isinstance(lightning, (int, float)) and lightning >= 50
                else "Moderate" if isinstance(lightning, (int, float)) and lightning >= 25
                else "Low" if isinstance(lightning, (int, float))
                else None
            )
            lightning_clause = (
                f" Lightning/squall risk is {_fmt(lightning, '%')} ({lightning_level})."
                if lightning_level else ""
            )
            # Directly answers "any lightning or cyclone alerts?" with the
            # site's own currently-recorded proactive alerts (see
            # backend/alert_service.py) rather than a generic wave/wind
            # paragraph that never mentions either hazard by name.
            cyclone_alerts = [a for a in (t.get("active_alerts") or []) if a.get("alert_type") == "CYCLONE_BULLETIN"]
            cyclone_clause = (
                f" Active cyclone bulletin on file: {cyclone_alerts[0].get('title')} -- {cyclone_alerts[0].get('message')}"
                if cyclone_alerts
                else " No active cyclone bulletin on file for this coastline right now."
            )
            txt = (
                f"Sea state {_fmt(w.get('sea_state_douglas'))} (Douglas scale) with "
                f"{_fmt(wave, ' m')} significant wave height"
                f"{_trend_clause('significant_wave_height_m', wave, ' m', agent='weather')} and "
                f"{_fmt(w.get('surface_wind_knots'), ' kn')} winds. "
                f"Weather safety score is {_fmt(w.get('safety_score'), '/100')}. "
                f"Weather clearance verdict: {_fmt(w.get('clearance_verdict'))}."
                f"{lightning_clause}{cyclone_clause}"
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
            vessels = f.get("vessels_in_target_zone")
            txt = (
                f"{_fmt(vessels)} vessels are currently reported in the "
                f"target zone{_trend_clause('vessels_in_target_zone', vessels, agent='fleet')}, "
                f"out of {_fmt(f.get('total_active_vessels'))} active vessels tracked "
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
        elif intent == "OCEAN_CONDITIONS":
            # "Which regions show high chlorophyll / favorable SST?" -- the
            # satellite agent's live reading plus its own historical trend,
            # grounded the same way every other branch is (no fabricated
            # multi-region scan the underlying agents don't actually do).
            sst = s.get("sst_celsius")
            chl = s.get("chlorophyll_mg_m3")
            front = s.get("thermal_front_detected")
            location_name = p.get("top_recommended_pfz") or s.get("region") or "this position"
            txt = (
                f"At {location_name}, sea surface temperature is "
                f"{_fmt(sst, ' degC')}{_trend_clause('sst_celsius', sst, ' degC', agent='satellite')}, with "
                f"chlorophyll-a concentration at {_fmt(chl, ' mg/m3')}"
                f"{_trend_clause('chlorophyll_mg_m3', chl, ' mg/m3', agent='satellite')}. "
                + (
                    "A thermal front is detected here, typically favorable for pelagic fish aggregation. "
                    if front
                    else "No significant thermal front detected at this position right now. "
                )
                + f"Ocean data tier: {_fmt(s.get('source_tier'))}."
            )
        elif intent == "YIELD_TREND_ANALYSIS":
            # "Why has fish productivity declined?" -- answered the only
            # honest way a stats-grounded system can: by comparing the
            # live PFZ yield (and the SST/chlorophyll it's derived from)
            # against this site's own recorded history for that same
            # metric, and saying plainly when there isn't enough history
            # yet to call it a decline at all.
            yield_pct = p.get("yield_score_pct")
            yield_stats = stats_store.trend("yield_score_pct", agent="pfz")
            sst = s.get("sst_celsius")
            chl = s.get("chlorophyll_mg_m3")
            if yield_stats.get("count", 0) >= 3 and yield_pct is not None and yield_stats.get("avg"):
                avg = yield_stats["avg"]
                delta_pct = (yield_pct - avg) / avg * 100
                if delta_pct <= -8:
                    trend_clause = f"{abs(delta_pct):.0f}% below this zone's own {yield_stats['count']}-reading average of {avg:.1f}%"
                    verdict = "a real decline against this site's own recorded history"
                elif delta_pct >= 8:
                    trend_clause = f"{abs(delta_pct):.0f}% above this zone's own {yield_stats['count']}-reading average of {avg:.1f}%"
                    verdict = "actually above its own recent average -- not a decline"
                else:
                    trend_clause = f"consistent with this zone's own {yield_stats['count']}-reading average of {avg:.1f}%"
                    verdict = "within its normal recorded range, not a meaningful decline"
                txt = (
                    f"Predicted yield at {_fmt(p.get('top_recommended_pfz'))} is {_fmt(yield_pct, '%')}, "
                    f"{trend_clause} -- {verdict}. "
                    f"Sea surface temperature is {_fmt(sst, ' degC')}{_trend_clause('sst_celsius', sst, ' degC', agent='satellite')} "
                    f"and chlorophyll-a is {_fmt(chl, ' mg/m3')}{_trend_clause('chlorophyll_mg_m3', chl, ' mg/m3', agent='satellite')}, "
                    "the two factors this system's PFZ ranking is built from."
                )
            else:
                txt = (
                    f"Predicted yield at {_fmt(p.get('top_recommended_pfz'))} is {_fmt(yield_pct, '%')}. "
                    "Not enough recorded history on this zone yet to say whether that is a decline or within its "
                    "normal range -- ORCA only compares against its own accumulated readings, and needs at least "
                    "3 prior readings for this metric before it will call a trend either way."
                )
        elif intent == "PFZ_RECOMMENDATION":
            yield_pct = p.get("yield_score_pct")
            txt = (
                f"Recommended PFZ is {_fmt(p.get('top_recommended_pfz'))} "
                f"({_fmt(yield_pct, '%')} predicted yield{_trend_clause('yield_score_pct', yield_pct, '%', agent='pfz')}, "
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

        localized = self._localize(t, intent, response_language, txt)
        if language_note:
            localized = f"{language_note} {localized}"

        readings_seen = stats_store.total_reading_count()
        return {
            "advisory_text": localized,
            "confidence_pct": 90,
            "citations": ["Open-Meteo", "ORCA Multi-Agent Telemetry", f"ORCA Stats Ledger ({readings_seen} readings recorded)"],
            "llm_engine": f"ORCA_STATS_ENGINE (rule-based, {readings_seen} historical readings on file)",
            "intent": intent,
            "language": {"response_code": response_language, "note": language_note, "provenance": "QUERY_LANGUAGE_DETECTION"},
        }

    @staticmethod
    def _localize(t: Dict[str, Any], intent: str, language: str, english_text: str) -> str:
        """Offline-native response for the most common safety queries.

        Numeric telemetry stays unchanged; only wording is localized. Other
        intents retain the grounded English text rather than fabricating a
        translation when no translation engine is configured -- this
        system has never called out to a translation API either.
        """
        if language == "en":
            return english_text
        w = t.get("weather", {}) or {}
        wave = _fmt(w.get("significant_wave_height_m"), " m")
        wind = _fmt(w.get("surface_wind_knots"), " kn")
        verdict = _fmt(w.get("clearance_verdict"))
        if intent == "WEATHER_SAFETY":
            lightning = w.get("lightning_risk_pct")
            # Same "any lightning/cyclone alert?" question a non-English
            # speaker asks just as often -- keep the answer's substance
            # (not just wave/wind) equivalent across every supported
            # language rather than only enriching the English branch.
            lightning_suffix = {
                "hi": f" बिजली/तूफान जोखिम: {_fmt(lightning, '%')}।" if isinstance(lightning, (int, float)) else "",
                "ta": f" மின்னல்/புயல் அபாயம்: {_fmt(lightning, '%')}." if isinstance(lightning, (int, float)) else "",
                "ml": f" ഇടിമിന്നൽ/കൊടുങ്കാറ്റ് സാധ്യത: {_fmt(lightning, '%')}." if isinstance(lightning, (int, float)) else "",
            }
            templates = {
                "hi": f"समुद्री सलाह: लहर की ऊंचाई {wave} और हवा {wind} है। मौसम सुरक्षा स्थिति: {verdict}।{lightning_suffix.get('hi', '')} सावधानी से यात्रा करें।",
                "ta": f"கடல் ஆலோசனை: அலை உயரம் {wave}, காற்று {wind}. வானிலை பாதுகாப்பு நிலை: {verdict}.{lightning_suffix.get('ta', '')} எச்சரிக்கையுடன் பயணம் செய்யவும்.",
                "ml": f"കടൽ നിർദേശം: തിരമാല ഉയരം {wave}, കാറ്റ് {wind}. കാലാവസ്ഥാ സുരക്ഷാ നില: {verdict}.{lightning_suffix.get('ml', '')} ജാഗ്രതയോടെ യാത്ര ചെയ്യുക.",
            }
            return templates.get(language, english_text)
        prefixes = {
            "hi": "समुद्री सलाह: ",
            "ta": "கடல் ஆலோசனை: ",
            "ml": "കടൽ നിർദേശം: ",
        }
        return prefixes.get(language, "Marine advisory: ") + english_text

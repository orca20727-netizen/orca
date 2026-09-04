"""
Master Supervisor / DAG Planner.

Classifies a natural-language voyage query into one of eight intents and
dynamically selects which downstream agents are relevant to it, instead of
always running (and always synthesizing an answer from) the exact same
fixed agent set regardless of what was actually asked.

Classification is a deterministic, rule-based, multi-signal classifier
(weighted keyword/phrase groups per intent, evaluated in a fixed priority
order so a more specific intent -- e.g. an IMBL boundary question -- wins
over a more generic one -- e.g. general voyage safety) -- see section 4 of
the project brief: "Use a deterministic intent classifier first. If Groq is
available, optionally use LLM classification as a second layer, but never
make the system unusable without the API key." Only the deterministic
layer is implemented for now; the synthesis agent is the one that talks to
Groq (for language generation, not intent routing), so the system never
depends on network/API availability just to figure out what was asked.
"""

from typing import Any, Dict, List

# Each intent maps to (priority, [keyword/phrase signals]). Priority is
# evaluated low-to-high; the classifier returns the *first* intent (in
# priority order) that has at least one matching signal, so more specific
# intents (boundary, MPA, route, ETA) are checked before the generic
# "GENERAL_VOYAGE_SAFETY" catch-all.
INTENT_SIGNALS_BY_LANG: Dict[str, Dict[str, List[str]]] = {
    "en": {
    "IMBL_BOUNDARY": [
        "imbl", "international maritime boundary", "border", "boundary",
        "sri lanka", "pakistan", "bangladesh", "cross the line", "how close am i to",
    ],
    "MPA_SAFETY": [
        "mpa", "marine protected area", "protected area", "can i fish here",
        "can i fish in", "no-fishing", "no fishing zone", "restricted zone",
        "eco-reserve", "sanctuary", "national park", "am i allowed to fish",
    ],
    "ROUTE_PLANNING": [
        "route", "safest way", "safest route", "how do i get",
        "navigate to", "waypoint", "give me the safest", "way to pfz",
    ],
    "ETA_RETURN": [
        "eta", "return", "come back", "dusk", "sunset", "before dark",
        "how long will it take", "what time will i", "back to harbour", "back home",
    ],
    "FLEET_DENSITY": [
        "density", "how many boats", "how many vessels", "vessel count",
        "traffic", "crowd", "overcrowd", "too many boats", "how busy",
    ],
    "WEATHER_SAFETY": [
        "weather", "wave", "wind", "storm", "sea state", "safe today",
        "is the sea safe", "rough sea", "cyclone", "rain",
        "tide", "tidal", "high tide", "low tide", "lightning", "thunderstorm",
    ],
    "PFZ_RECOMMENDATION": [
        "pfz", "fishing zone", "best zone", "which zone", "where should i fish",
        "fishing ground", "predicted yield", "which fishing",
    ],
    },
    "hi": {
        "IMBL_BOUNDARY": ["सीमा", "समुद्री सीमा", "आईएमबीएल", "श्रीलंका"],
        "MPA_SAFETY": ["संरक्षित क्षेत्र", "मछली पकड़ सकता", "प्रतिबंधित क्षेत्र"],
        "ROUTE_PLANNING": ["मार्ग", "रास्ता", "सुरक्षित रास्ता"],
        "ETA_RETURN": ["वापस", "कितना समय", "सूर्यास्त"],
        "FLEET_DENSITY": ["कितनी नाव", "नावों", "भीड़"],
        "WEATHER_SAFETY": ["मौसम", "लहर", "हवा", "तूफान", "चक्रवात", "ज्वार", "बिजली"],
        "PFZ_RECOMMENDATION": ["मछली पकड़ने का क्षेत्र", "पीएफजेड", "सबसे अच्छा क्षेत्र"],
    },
    "ta": {
        "IMBL_BOUNDARY": ["எல்லை", "கடல் எல்லை", "இஎம்பிஎல்", "இலங்கை"],
        "MPA_SAFETY": ["பாதுகாக்கப்பட்ட பகுதி", "மீன்பிடிக்க", "தடைசெய்யப்பட்ட பகுதி"],
        "ROUTE_PLANNING": ["வழி", "பாதுகாப்பான வழி", "பாதை"],
        "ETA_RETURN": ["திரும்ப", "எவ்வளவு நேரம்", "சூரிய அஸ்தமனம்"],
        "FLEET_DENSITY": ["எத்தனை படகுகள்", "படகுகள்", "நெரிசல்"],
        "WEATHER_SAFETY": ["வானிலை", "அலை", "காற்று", "புயல்", "சூறாவளி", "ஓதம்", "மின்னல்"],
        "PFZ_RECOMMENDATION": ["மீன்பிடி பகுதி", "பிஎப்இசட்", "சிறந்த பகுதி"],
    },
    "ml": {
        "IMBL_BOUNDARY": ["അതിർത്ത്", "സമുദ്ര അതിർത്തി", "ഐഎംബിഎൽ", "ശ്രീലങ്ക"],
        "MPA_SAFETY": ["സംരക്ഷിത മേഖല", "മത്സ്യബന്ധനം", "നിയന്ത്രിത മേഖല"],
        "ROUTE_PLANNING": ["വഴി", "സുരക്ഷിത വഴി", "പാത"],
        "ETA_RETURN": ["തിരികെ", "എത്ര സമയം", "സൂര്യാസ്തമയം"],
        "FLEET_DENSITY": ["എത്ര ബോട്ടുകൾ", "ബോട്ടുകൾ", "തിരക്ക്"],
        "WEATHER_SAFETY": ["കാലാവസ്ഥ", "തിര", "കാറ്റ്", "കൊടുങ്കാറ്റ്", "വേലിയേറ്റം", "ഇടിമിന്നൽ"],
        "PFZ_RECOMMENDATION": ["മത്സ്യബന്ധന മേഖല", "പി എഫ് ഇസഡ്", "മികച്ച മേഖല"],
    },
}

# Priority is preserved across languages. Exporting this alias keeps older
# integrations that imported INTENT_SIGNALS from breaking.
INTENT_SIGNALS = list(INTENT_SIGNALS_BY_LANG["en"].items())

# Which downstream agents actually matter for each intent. core.run_pipeline
# executes this plan (rather than using it merely as synthesis decoration).
INTENT_RELEVANT_AGENTS: Dict[str, List[str]] = {
    "PFZ_RECOMMENDATION": ["satellite", "pfz", "weather"],
    "WEATHER_SAFETY": ["weather"],
    "IMBL_BOUNDARY": ["geofence"],
    "MPA_SAFETY": ["geofence"],
    "FLEET_DENSITY": ["fleet"],
    "ROUTE_PLANNING": ["eta", "geofence", "weather"],
    "ETA_RETURN": ["eta", "weather"],
    "GENERAL_VOYAGE_SAFETY": ["weather", "pfz", "fleet", "eta"],
}

# Subtasks dispatched per intent -- kept close to the legacy fixed list for
# UI/backward-compat (the frontend displays subtask counts), but now
# actually varies by intent rather than being identical for every query.
_SUBTASK_LIBRARY = {
    "FETCH_SATELLITE_SST_CHLOROPHYLL": "satellite",
    "EVALUATE_WAVE_WIND_HAZARD": "weather",
    "COMPUTE_PFZ_CONVERGENCE": "pfz",
    "VALIDATE_IMBL_BOUNDARIES": "geofence",
    "CHECK_MPA_RESTRICTIONS": "geofence",
    "CALCULATE_FLEET_DENSITY": "fleet",
    "PLAN_SEA_ROUTE": "eta",
    "ESTIMATE_VOYAGE_ETA": "eta",
    "SYNTHESIZE_NEURAL_ADVISORY": "synthesis",
}


def classify_intent(query: str, language_code: str = "en") -> str:
    """Deterministic, rule-based intent classification. Returns one of the
    eight supported intents; never raises, never requires network access."""
    q = query.lower()
    signals_by_intent = INTENT_SIGNALS_BY_LANG.get(language_code, INTENT_SIGNALS_BY_LANG["en"])
    for intent in INTENT_SIGNALS_BY_LANG["en"]:
        signals = signals_by_intent.get(intent, [])
        for signal in signals:
            if signal in q:
                return intent
    return "GENERAL_VOYAGE_SAFETY"


class SupervisorAgent:
    def __init__(self):
        self.name = "Master Supervisor / DAG Planner"

    async def plan_dag(self, query: str, language_code: str = "en") -> Dict[str, Any]:
        intent = classify_intent(query, language_code)
        relevant_agents = INTENT_RELEVANT_AGENTS.get(intent, INTENT_RELEVANT_AGENTS["GENERAL_VOYAGE_SAFETY"])

        subtasks = [
            name for name, agent_key in _SUBTASK_LIBRARY.items()
            if agent_key in relevant_agents or agent_key == "synthesis"
        ]
        # Synthesis always runs last regardless of intent.
        if "SYNTHESIZE_NEURAL_ADVISORY" not in subtasks:
            subtasks.append("SYNTHESIZE_NEURAL_ADVISORY")

        return {
            "query": query,
            "intent": intent,
            "relevant_agents": relevant_agents,
            "subtasks": subtasks,
            "classification_method": "DETERMINISTIC_RULE_BASED",
            "query_language": language_code,
            "execution_mode": "PARALLEL_ASYNC_DAG",
        }

    @staticmethod
    def reactive_agents(intent: str, weather: Dict[str, Any]) -> List[str]:
        """Return agents added after live evidence changes the initial plan.

        A general fishing question normally does not need a boundary check.
        Rough seas, an unsafe clearance, or high lightning risk can make a
        reroute relevant, so the geofence agent is added at that point.
        """
        hazard = (
            weather.get("clearance_verdict") in {"CAUTION", "UNSAFE"}
            or float(weather.get("significant_wave_height_m", 0) or 0) >= 2.5
            or float(weather.get("lightning_risk_pct", 0) or 0) >= 50
        )
        return ["geofence"] if intent == "GENERAL_VOYAGE_SAFETY" and hazard else []

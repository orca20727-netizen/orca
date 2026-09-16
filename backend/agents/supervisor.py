"""
Master Supervisor / DAG Planner.

Classifies a natural-language voyage query into one of a fixed set of
maritime intents (plus greeting/small-talk/generic-question intents, see
below) and
dynamically selects which downstream agents are relevant to it, instead of
always running (and always synthesizing an answer from) the exact same
fixed agent set regardless of what was actually asked.

Classification is a deterministic, rule-based, multi-signal classifier
(weighted keyword/phrase groups per intent, evaluated in a fixed priority
order so a more specific intent -- e.g. an IMBL boundary question -- wins
over a more generic one -- e.g. general voyage safety). There is no
external AI/LLM API anywhere in this system any more: the synthesis agent
(backend/agents/synthesis_agent.py) that consumes this classification is
also fully rule-based, reasoning only over this website's own live
telemetry and its own accumulated stats ledger (backend/stats_store.py),
so nothing here -- classification or synthesis -- ever depends on
external network/API availability.
"""

import re
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
    # Evidence-based diagnostics -- "why is this zone underperforming" --
    # checked before the generic PFZ_RECOMMENDATION ("which zone should I
    # fish") so a decline/diagnostic question gets a trend-comparison
    # answer instead of a plain recommendation.
    "YIELD_TREND_ANALYSIS": [
        "declined", "decline", "productivity", "gone down", "dropped",
        "why has", "why is the catch", "catch is down", "less fish",
        "fewer fish", "yield has fallen", "why has fish", "falling catch",
    ],
    "OCEAN_CONDITIONS": [
        "chlorophyll", "sea surface temperature", "thermal front",
        "ocean colour", "ocean color", "phytoplankton", "algal bloom",
        "favorable sea surface", "sst",
    ],
    "PFZ_RECOMMENDATION": [
        "pfz", "fishing zone", "best zone", "which zone", "where should i fish",
        "fishing ground", "predicted yield", "which fishing",
    ],
    # Everything below is deliberately checked AFTER every maritime-specific
    # intent above, so a query that matches both (e.g. "hi, is the sea safe
    # today?") still gets a real maritime intent as its primary answer, with
    # the greeting/small-talk reply appended -- never the other way round.
    # These give a "decent response" to greetings, thanks, capability
    # questions and simple generic questions instead of falling into the
    # GENERAL_VOYAGE_SAFETY catch-all and dumping an irrelevant full
    # weather/PFZ/ETA advisory on someone who just said "hi".
    "GREETING": [
        "hi", "hello", "hey", "hiya", "yo",
        "good morning", "good afternoon", "good evening", "namaste",
    ],
    "THANKS_FAREWELL": [
        "thanks", "thank you", "thankyou", "much appreciated", "appreciate it",
        "bye", "goodbye", "see you", "take care", "good night",
    ],
    "HELP_CAPABILITY": [
        "help", "what can you do", "who are you", "what are you",
        "how do i use this", "how does this work", "what is this app",
        "capabilities",
    ],
    "DATE_TIME": [
        "what time is it", "current time", "what's the time", "what is the time",
        "today's date", "what's the date", "what is the date", "what day is it",
        "what day is today",
    ],
    # Common non-maritime trivia-question shapes. Answered with a graceful
    # redirect (never a fabricated "answer") -- this system has no external
    # AI/API to actually look these up. See _looks_like_arithmetic() below
    # for the separate, genuinely-answerable MATH_CALCULATION case.
    "OFF_TOPIC_GENERIC": [
        "capital of", "who invented", "tell me a joke", "prime minister of",
        "president of", "meaning of life", "population of", "who won the world cup",
        "recipe for", "how to cook", "define ", "who is the ceo",
        "tallest mountain", "who wrote", "cricket score", "stock price",
    ],
    },
    "hi": {
        "IMBL_BOUNDARY": ["सीमा", "समुद्री सीमा", "आईएमबीएल", "श्रीलंका"],
        "MPA_SAFETY": ["संरक्षित क्षेत्र", "मछली पकड़ सकता", "प्रतिबंधित क्षेत्र"],
        "ROUTE_PLANNING": ["मार्ग", "रास्ता", "सुरक्षित रास्ता"],
        "ETA_RETURN": ["वापस", "कितना समय", "सूर्यास्त"],
        "FLEET_DENSITY": ["कितनी नाव", "नावों", "भीड़"],
        "WEATHER_SAFETY": ["मौसम", "लहर", "हवा", "तूफान", "चक्रवात", "ज्वार", "बिजली"],
        # Best-effort keyword coverage (not professionally reviewed
        # translations), matching the style of the other language blocks
        # in this file.
        "YIELD_TREND_ANALYSIS": ["उत्पादकता", "घट गई", "कम मछली", "पकड़ कम"],
        "OCEAN_CONDITIONS": ["क्लोरोफिल", "सतह का तापमान", "समुद्र का तापमान"],
        "PFZ_RECOMMENDATION": ["मछली पकड़ने का क्षेत्र", "पीएफजेड", "सबसे अच्छा क्षेत्र"],
        "GREETING": ["नमस्ते", "नमस्कार", "हैलो", "सुप्रभात"],
        "THANKS_FAREWELL": ["धन्यवाद", "शुक्रिया", "अलविदा", "फिर मिलेंगे"],
        "HELP_CAPABILITY": ["मदद", "आप क्या कर सकते हैं", "आप कौन हैं"],
        "DATE_TIME": ["अभी क्या समय है", "आज की तारीख", "आज कौन सा दिन है"],
        "OFF_TOPIC_GENERIC": ["राजधानी", "किसने आविष्कार किया", "मजाक सुनाओ"],
    },
    "ta": {
        "IMBL_BOUNDARY": ["எல்லை", "கடல் எல்லை", "இஎம்பிஎல்", "இலங்கை"],
        "MPA_SAFETY": ["பாதுகாக்கப்பட்ட பகுதி", "மீன்பிடிக்க", "தடைசெய்யப்பட்ட பகுதி"],
        "ROUTE_PLANNING": ["வழி", "பாதுகாப்பான வழி", "பாதை"],
        "ETA_RETURN": ["திரும்ப", "எவ்வளவு நேரம்", "சூரிய அஸ்தமனம்"],
        "FLEET_DENSITY": ["எத்தனை படகுகள்", "படகுகள்", "நெரிசல்"],
        "WEATHER_SAFETY": ["வானிலை", "அலை", "காற்று", "புயல்", "சூறாவளி", "ஓதம்", "மின்னல்"],
        "YIELD_TREND_ANALYSIS": ["உற்பத்தி குறைந்தது", "மீன் குறைவு", "ஏன் குறைந்தது"],
        "OCEAN_CONDITIONS": ["குளோரோபில்", "கடல் மேற்பரப்பு வெப்பநிலை"],
        "PFZ_RECOMMENDATION": ["மீன்பிடி பகுதி", "பிஎப்இசட்", "சிறந்த பகுதி"],
        "GREETING": ["வணக்கம்", "ஹலோ", "காலை வணக்கம்"],
        "THANKS_FAREWELL": ["நன்றி", "போய் வருகிறேன்", "பிறகு சந்திப்போம்"],
        "HELP_CAPABILITY": ["உதவி", "நீங்கள் என்ன செய்ய முடியும்", "நீங்கள் யார்"],
        "DATE_TIME": ["இப்போது நேரம் என்ன", "இன்றைய தேதி", "இன்று என்ன நாள்"],
        "OFF_TOPIC_GENERIC": ["தலைநகரம்", "கண்டுபிடித்தவர்", "ஒரு நகைச்சுவை சொல்லு"],
    },
    "ml": {
        "IMBL_BOUNDARY": ["അതിർത്ത്", "സമുദ്ര അതിർത്തി", "ഐഎംബിഎൽ", "ശ്രീലങ്ക"],
        "MPA_SAFETY": ["സംരക്ഷിത മേഖല", "മത്സ്യബന്ധനം", "നിയന്ത്രിത മേഖല"],
        "ROUTE_PLANNING": ["വഴി", "സുരക്ഷിത വഴി", "പാത"],
        "ETA_RETURN": ["തിരികെ", "എത്ര സമയം", "സൂര്യാസ്തമയം"],
        "FLEET_DENSITY": ["എത്ര ബോട്ടുകൾ", "ബോട്ടുകൾ", "തിരക്ക്"],
        "WEATHER_SAFETY": ["കാലാവസ്ഥ", "തിര", "കാറ്റ്", "കൊടുങ്കാറ്റ്", "വേലിയേറ്റം", "ഇടിമിന്നൽ"],
        "YIELD_TREND_ANALYSIS": ["ഉൽപാദനക്ഷമത കുറഞ്ഞു", "മീൻ കുറവ്"],
        "OCEAN_CONDITIONS": ["ക്ലോറോഫിൽ", "സമുദ്രോപരിതല താപനില"],
        "PFZ_RECOMMENDATION": ["മത്സ്യബന്ധന മേഖല", "പി എഫ് ഇസഡ്", "മികച്ച മേഖല"],
        "GREETING": ["നമസ്കാരം", "ഹലോ", "സുപ്രഭാതം"],
        "THANKS_FAREWELL": ["നന്ദി", "വിട", "പിന്നെ കാണാം"],
        "HELP_CAPABILITY": ["സഹായം", "നിങ്ങൾക്ക് എന്ത് ചെയ്യാൻ കഴിയും", "നിങ്ങൾ ആരാണ്"],
        "DATE_TIME": ["ഇപ്പോൾ എത്ര മണിയായി", "ഇന്നത്തെ തീയതി", "ഇന്ന് ഏത് ദിവസമാണ്"],
        "OFF_TOPIC_GENERIC": ["തലസ്ഥാനം", "കണ്ടുപിടിച്ചത്", "ഒരു തമാശ പറയൂ"],
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
    "YIELD_TREND_ANALYSIS": ["satellite", "pfz", "weather"],
    "OCEAN_CONDITIONS": ["satellite", "pfz"],
    "GENERAL_VOYAGE_SAFETY": ["weather", "pfz", "fleet", "eta"],
    # Greetings, thanks, capability questions, the time/date, arithmetic and
    # off-topic trivia don't need any maritime agent to answer -- core.py's
    # run_pipeline pre-populates every agent slot with a SKIPPED placeholder
    # regardless, so an empty list here is a safe, fully-supported plan.
    "GREETING": [],
    "THANKS_FAREWELL": [],
    "HELP_CAPABILITY": [],
    "DATE_TIME": [],
    "MATH_CALCULATION": [],
    "OFF_TOPIC_GENERIC": [],
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


_WORD_BOUNDARY_CACHE: Dict[str, "re.Pattern[str]"] = {}

# Only these newly-added intents get word-boundary-safe matching for their
# single-token signals (see _signal_matches). Every pre-existing maritime
# intent (WEATHER_SAFETY, IMBL_BOUNDARY, etc.) keeps the ORIGINAL plain
# substring check, completely untouched -- a first version of this fix
# applied word-boundary matching to every ASCII single-token signal
# indiscriminately, which silently broke plural/inflected forms of
# existing keywords that used to match fine via plain substring (e.g.
# "wave" no longer matching inside "waves", "storm" inside "storms",
# "tide" inside "tides", "route" inside "routes", "border" inside
# "borders") -- caught via a live production test ("waves 2-3 m expected,
# is it safe?" wrongly fell through to GENERAL_VOYAGE_SAFETY instead of
# WEATHER_SAFETY). Scoping the boundary check to only the intents that
# actually need it eliminates that regression entirely while still
# stopping the original problem this was meant to fix: a bare "hi" (or
# "help") matching inside "fishing" / "helpful".
_WORD_BOUNDARY_INTENTS = {
    "GREETING", "THANKS_FAREWELL", "HELP_CAPABILITY", "OFF_TOPIC_GENERIC",
}


def _signal_matches(signal: str, q: str, use_word_boundary: bool) -> bool:
    """True if `signal` is present in the already-lowercased query `q`.

    Multi-word phrases ("fishing zone", "how many boats") and any
    non-ASCII (Hindi/Tamil/Malayalam) signal always keep the exact plain-
    substring check -- a phrase that long can't plausibly match inside an
    unrelated word, and several non-English signal lists rely on substring
    matching for agglutinative-language suffixes that attach to a word
    with no space.

    A single ASCII token belonging to one of the new small-talk/generic
    intents (`_WORD_BOUNDARY_INTENTS`, e.g. "hi", "help") instead matches
    only as its own whole word via a word-boundary regex, so it can't
    false-positive inside an unrelated longer word ("hi" inside "fishing",
    "help" inside "helpful"). Every pre-existing maritime intent's signals
    are NEVER passed `use_word_boundary=True` and so are completely
    unaffected by this -- see the note on `_WORD_BOUNDARY_INTENTS` above."""
    if not use_word_boundary or " " in signal or not signal.isascii():
        return signal in q
    pattern = _WORD_BOUNDARY_CACHE.get(signal)
    if pattern is None:
        pattern = re.compile(r"\b" + re.escape(signal) + r"\b")
        _WORD_BOUNDARY_CACHE[signal] = pattern
    return bool(pattern.search(q))


# A handful of common arithmetic phrasings ("2+2", "5 * 3", "12 plus 7",
# "what is 9 times 4"). Deliberately conservative: a bare spaced dash
# ("5 - 3") or symbol expression only counts as arithmetic when it's either
# the entire query or paired with an explicit calculation trigger word, so
# an ordinary maritime sentence that happens to mention a numeric range
# (e.g. "waves 2-3 m") never gets misclassified as a math question -- note
# the *unspaced* "2-3" also can't match _MATH_DASH_PATTERN at all, which
# requires whitespace on both sides of the dash.
_MATH_WORD_PATTERN = re.compile(r"\b\d+\s*(?:plus|minus|times|multiplied by|divided by)\s*\d+\b")
_MATH_SYMBOL_PATTERN = re.compile(r"\d+\s*[+*x×/÷]\s*\d+")
_MATH_DASH_PATTERN = re.compile(r"\d+\s+-\s+\d+")
_MATH_PURE_EXPRESSION = re.compile(r"^[\d.\s+\-*/x×÷()]+$")
_MATH_TRIGGER_PHRASES = ("what is", "what's", "calculate", "solve", "compute", "how much is")


def _looks_like_arithmetic(q: str) -> bool:
    """True only for a genuinely-answerable arithmetic question -- this
    feeds MATH_CALCULATION, the one OFF_TOPIC-adjacent intent this system
    can actually compute a correct, real answer for (via a safe AST
    evaluator in synthesis_agent.py), rather than the graceful redirect
    every other generic/trivia question gets."""
    if _MATH_WORD_PATTERN.search(q):
        return True
    if _MATH_SYMBOL_PATTERN.search(q) or _MATH_DASH_PATTERN.search(q):
        stripped = q.strip().rstrip("?").strip()
        if _MATH_PURE_EXPRESSION.match(stripped):
            return True
        return any(p in q for p in _MATH_TRIGGER_PHRASES)
    return False


def classify_intents(query: str, language_code: str = "en") -> List[str]:
    """Deterministic, rule-based intent classification -- returns EVERY
    intent (in the same fixed priority order as before) that has at least
    one matching signal, not just the first, so a compound question like
    "is it safe today and where should I fish?" is recognised as both
    WEATHER_SAFETY and PFZ_RECOMMENDATION instead of only the
    higher-priority one. Never raises, never requires network access.
    Always returns at least one intent (GENERAL_VOYAGE_SAFETY if nothing
    matched)."""
    q = query.lower()
    signals_by_intent = INTENT_SIGNALS_BY_LANG.get(language_code, INTENT_SIGNALS_BY_LANG["en"])
    matched = []
    for intent in INTENT_SIGNALS_BY_LANG["en"]:
        signals = signals_by_intent.get(intent, [])
        use_word_boundary = intent in _WORD_BOUNDARY_INTENTS
        if any(_signal_matches(signal, q, use_word_boundary) for signal in signals):
            matched.append(intent)
    # MATH_CALCULATION isn't in the keyword table above -- number/operator
    # shapes vary too much for a fixed phrase list, so it gets its own
    # dedicated (and deliberately conservative) detector instead.
    if "MATH_CALCULATION" not in matched and _looks_like_arithmetic(q):
        matched.append("MATH_CALCULATION")
    return matched or ["GENERAL_VOYAGE_SAFETY"]


def classify_intent(query: str, language_code: str = "en") -> str:
    """The single highest-priority matched intent -- kept for callers that
    only ever wanted one answer (e.g. synthesis_agent's own fallback path
    when no Supervisor plan is available). See classify_intents() for the
    full compound-question-aware match."""
    return classify_intents(query, language_code)[0]


class SupervisorAgent:
    def __init__(self):
        self.name = "Master Supervisor / DAG Planner"

    async def plan_dag(self, query: str, language_code: str = "en") -> Dict[str, Any]:
        all_intents = classify_intents(query, language_code)
        intent = all_intents[0]  # highest-priority match; kept as-is for every existing reader of plan["intent"]

        # Compound question support: run the union of every matched
        # intent's agents, not just the primary one, so "is it safe today
        # and where should I fish?" actually gets both weather AND PFZ
        # telemetry instead of only whichever intent happened to win
        # priority. A single-intent query (the overwhelming majority)
        # behaves exactly as before, since the union of one set is itself.
        relevant_agents: List[str] = []
        for i in all_intents:
            for agent in INTENT_RELEVANT_AGENTS.get(i, INTENT_RELEVANT_AGENTS["GENERAL_VOYAGE_SAFETY"]):
                if agent not in relevant_agents:
                    relevant_agents.append(agent)

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
            "all_intents": all_intents,
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

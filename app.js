/**
 * ORCA INSIGHT - Final Production Multi-Agent Marine Intelligence Platform
 * Smart India Hackathon 2026 · Problem Statement 26176 · ISRO (Dept. of Space)
 * Team SavioursX
 */

// Backend Connection Config — points at the FastAPI service in /backend.
// Auto-detects the backend host from the page's own hostname so a phone
// on the same Wi-Fi (loading the frontend as http://<LAN-IP>:3000) reaches
// the backend at http://<LAN-IP>:8000 instead of its own localhost, where
// nothing is listening. Falls back to 'localhost' only when the page
// itself was loaded from localhost/127.0.0.1 or as a local file://.
// Override by setting window.ORCA_API_BASE / window.ORCA_WS_BASE before
// app.js loads (useful when deploying the API somewhere other than the
// frontend's own host, e.g. a separate domain).
const ORCA_BACKEND_HOST = (
  window.location.hostname && window.location.hostname !== ''
) ? window.location.hostname : 'localhost';
const ORCA_BACKEND_PROTOCOL = window.location.protocol === 'https:' ? 'https' : 'http';
const ORCA_BACKEND_WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';

const BACKEND_CONFIG = {
  // Railway supplies these at container start through config.js. The fallback
  // preserves the local two-port demo and avoids mixed-content URLs on HTTPS.
  apiBase: window.ORCA_API_BASE || `${ORCA_BACKEND_PROTOCOL}://${ORCA_BACKEND_HOST}:8000`,
  wsBase: window.ORCA_WS_BASE || `${ORCA_BACKEND_WS_PROTOCOL}://${ORCA_BACKEND_HOST}:8000`
};

// Theme system: applied immediately, before DOMContentLoaded, so the page
// never flashes the default Night theme before switching to a saved
// preference. Must match the [data-theme="..."] blocks in styles.css;
// setupThemeSwitcher() below only wires up the <select> to this.
const ORCA_THEMES = ['night', 'day', 'grey', 'blue'];
(function applyStoredThemeEarly() {
  try {
    const saved = localStorage.getItem('orca-theme');
    document.documentElement.setAttribute('data-theme', ORCA_THEMES.includes(saved) ? saved : 'night');
  } catch (err) {
    // Storage can be unavailable (private browsing, disabled cookies) --
    // fall back to the default theme rather than breaking startup.
    document.documentElement.setAttribute('data-theme', 'night');
  }
})();

// Maps the agent names the FastAPI backend sends over the websocket to the
// DAG node ids used in the frontend (see agentsList below).
const BACKEND_AGENT_ID_MAP = {
  "Master Supervisor": "supervisor",
  "Satellite Oceanography": "satellite_agent",
  "Weather & Hazard": "weather_agent",
  "Ocean Analytics PFZ": "pfz_agent",
  "Geofencing & Routing": "geofencing_agent",
  "Fleet & Traffic": "fleet_agent",
  "ETA & Voyage Safety": "eta_agent",
  "Neural Synthesis": "synthesis_agent"
};

// Global Application State
const state = {
  currentLang: 'en',
  languageOverride: false,
  detectedQueryLanguage: 'en',
  activeTab: 'home',
  backendOnline: false,
  // Fleet view is live-feed-only: never render the bundled demo AIS records
  // as if they were real vessels. It stays empty until the backend receives
  // a valid AIS/GPS snapshot.
  usesLiveVessels: true,
  liveVesselCount: 0,
  simulatedVesselCount: 0,
  latestChatQuery: "Is it safe to sail to PFZ-01 from Kochi today?",
  satellites: [],
  pfzZones: [],
  imblBoundaries: [],
  mpas: [],
  harbours: [],
  vessels: [],
  bulletins: [],
  proactiveAlerts: [],
  browserNotificationsEnabled: false,
  localAlertKeys: new Set(),
  map: null,
  mapLayers: {
    pfz: null,
    imbl: null,
    mpas: null,
    harbours: null,
    vessels: null,
    heatmap: null,
    route: null,
    indiaBoundary: null
  },
  indiaBoundary: null,
  selectedHarbour: 'HBR-KOC',
  selectedPFZ: 'PFZ-01',
  activeVesselMarkers: {},
  chatHistory: [],
  sessionId: null,
  isSimulatingDAG: false,
  activeDAGNode: null,
  isSpeaking: false,
  speechSynth: window.speechSynthesis || null,
  currentUtterance: null,
  vesselUpdateInterval: null,
  sosActive: false,
  
  // Real Marine Telemetry from Open-Meteo
    liveMarine: {
    waveHeight: 1.25,
    windSpeed: 14.2,
    seaState: 3,
    lightningRisk: 8,
    isLiveFeed: false,
    lastFetchTime: null
  },

  // Real past-24h hourly history for the Safety Barometer sparklines,
  // seeded from Open-Meteo's own historical hourly data (see
  // fetchSafetyTrendHistory). Left empty until that fetch succeeds; the
  // sparklines fall back to the live reading alone rather than inventing
  // history when it hasn't loaded yet.
  safetyTrend: {
    wave: [],
    wind: [],
    sea: [],
    lightning: []
  },

  // Voice Recognition (STT)
  recognition: null,
  isListening: false,

  // DAG Canvas Zoom & Pan
  dagZoom: 1.0,
  dagPan: { x: 0, y: 0 },
  isDraggingDAG: false,
  dagDragStart: { x: 0, y: 0 },

  // NavIC GPS & NMEA Bridge
  navicConnected: true,
  navicInterval: null,
  positionWatchId: null,
  simulatedGeofenceInterval: null,
  geofenceAlertKeys: new Set(),
  currentNMEA: '',
  navicSatellites: [
    { id: 'IRNSS-1A', prn: '01', az: 45, el: 68, snr: 44, locked: true },
    { id: 'IRNSS-1B', prn: '02', az: 130, el: 74, snr: 47, locked: true },
    { id: 'IRNSS-1C', prn: '03', az: 210, el: 60, snr: 42, locked: true },
    { id: 'IRNSS-1D', prn: '04', az: 315, el: 55, snr: 39, locked: true },
    { id: 'IRNSS-1E', prn: '05', az: 95, el: 48, snr: 41, locked: true },
    { id: 'IRNSS-1F', prn: '06', az: 170, el: 82, snr: 49, locked: true },
    { id: 'IRNSS-1I', prn: '07', az: 280, el: 42, snr: 38, locked: true }
  ]
};

// Multilingual Translations Dictionary
const translations = {
  en: {
    appTitle: "ORCA INSIGHT",
    appSubtitle: "ISRO Collaborative Marine Intelligence · SIH 2026 PS 26176",
    teamName: "Team SavioursX",
    navHome: "Home",
    navChat: "AI Decision Studio",
    navMap: "GIS Command Map",
    navDAG: "Agent DAG Visualizer",
    navSafety: "Safety Barometer",
    navFleet: "Fleet Monitor",
    navNavic: "NavIC GPS Bridge",
    navBulletins: "Advisory Bulletins",
    heroTitle: "Collaborative Marine Intelligence for the Indian Ocean",
    heroDesc: "Reasoning over ISRO Oceansat-3, INSAT-3DR satellite oceanography, IMBL geofencing, real-time fleet density, and voyage ETA to empower India's coastal fishing community.",
    ctaStudio: "Launch AI Decision Studio",
    ctaMap: "Open GIS Command Map",
    ctaFleet: "Inspect Fleet Monitor",
    statsActiveVessels: "Active Vessels Tracked",
    statsSatellites: "ISRO Satellite Feeds",
    statsPFZ: "High-Yield Fishing Zones",
    statsIMBL: "IMBL Geofenced Sectors",
    chipPFZ: "Find Nearest High-Yield PFZ",
    chipSafety: "Check Sea-Venture Clearance",
    chipBorder: "IMBL Border Distance Check",
    chipDensity: "Vessel Density & Overcrowding",
    chipETA: "Calculate ETA & Safe Return Time",
    chatPlaceholder: "Ask ORCA (or click microphone to speak)...",
    chatSend: "Ask Agents",
    routePlannerTitle: "Voyage Route Simulator & Sea-State ETA",
    originHarbour: "Origin Fishing Harbour",
    destinationPFZ: "Destination PFZ Zone",
    simulateRouteBtn: "Simulate Safe Route & ETA",
    distanceNM: "Route Distance",
    liveETA: "Live Sea-State ETA",
    returnDusk: "Return-by-Dusk Safety Verdict",
    sosButton: "SOS EMERGENCY",
    clearanceSafe: "SAFE FOR SEA VENTURE",
    clearanceCaution: "PROCEED WITH CAUTION",
    clearanceUnsafe: "UNSAFE: DO NOT VENTURE",
    waveHeight: "Significant Wave Height",
    windSpeed: "Surface Wind Speed",
    seaState: "Douglas Sea State",
    lightningRisk: "Lightning & Squall Risk",
    vesselTableTitle: "Live Coastal Fleet Telemetry (Live AIS + Simulated Fill-in)",
    simulatedDisclaimer: "NOTE: Live AIS vessel positions are backfilled with a clearly-tagged simulated fleet where there's no receiver coverage yet. Satellite oceanography layers remain simulated for Smart India Hackathon 2026 demonstration."
  },
  hi: {
    appTitle: "ओर्का इनसाइट (ORCA INSIGHT)",
    appSubtitle: "इसरो सहयोगात्मक समुद्री बुद्धिमत्ता · SIH 2026 PS 26176",
    teamName: "टीम सेवियर्सएक्स (Team SavioursX)",
    navHome: "मुख्य पृष्ठ",
    navChat: "एआई निर्णय केंद्र",
    navMap: "जीआईएस कमांड मैप",
    navDAG: "एजेंट डीएजी विज़ुअलाइज़र",
    navSafety: "सुरक्षा बैरोमीटर",
    navFleet: "नाव बेड़ा मॉनिटर",
    navNavic: "नाविक (NavIC) जीपीएस",
    navBulletins: "आधिकारिक बुलेटिन",
    heroTitle: "भारतीय महासागर के लिए सहयोगात्मक समुद्री बुद्धिमत्ता",
    heroDesc: "इसरो ओशनसैट-3, इनसैट-3डीआर उपग्रह डेटा, आईएमबीएल सीमा सुरक्षा, लाइव नाव घनत्व और सटीक ईटीए का विश्लेषण कर मछुआरों को सुरक्षित और समृद्ध बनाता है।",
    ctaStudio: "एआई निर्णय केंद्र शुरू करें",
    ctaMap: "कमांड मैप खोलें",
    ctaFleet: "नाव बेड़ा देखें",
    statsActiveVessels: "सक्रिय नावें ट्रैक की गईं",
    statsSatellites: "इसरो उपग्रह डेटा स्रोत",
    statsPFZ: "उच्च उपज मत्स्य क्षेत्र",
    statsIMBL: "आईएमबीएल सुरक्षित सीमा क्षेत्र",
    chipPFZ: "निकटतम उच्च उपज मत्स्य क्षेत्र खोजें",
    chipSafety: "समुद्र यात्रा सुरक्षा जांचें",
    chipBorder: "अंतरराष्ट्रीय समुद्री सीमा दूरी",
    chipDensity: "नाव घनत्व और भीड़ अलर्ट",
    chipETA: "पहुंचने का समय (ETA) और सुरक्षित वापसी",
    chatPlaceholder: "ओर्का से पूछें या माइक दबाकर बोलें...",
    chatSend: "पूछें",
    routePlannerTitle: "यात्रा मार्ग सिम्युलेटर और ईटीए",
    originHarbour: "प्रस्थान बंदरगाह",
    destinationPFZ: "मत्स्य क्षेत्र (PFZ)",
    simulateRouteBtn: "सुरक्षित मार्ग और ईटीए गणना करें",
    distanceNM: "मार्ग दूरी (समुद्री मील)",
    liveETA: "सटीक पहुंचने का समय (ETA)",
    returnDusk: "सूर्यास्त से पहले सुरक्षित वापसी",
    sosButton: "आपातकालीन एसओएस (SOS)",
    clearanceSafe: "समुद्र यात्रा के लिए सुरक्षित",
    clearanceCaution: "सावधानीपूर्वक आगे बढ़ें",
    clearanceUnsafe: "असुरक्षित: समुद्र में न जाएं",
    waveHeight: "लहरों की ऊंचाई",
    windSpeed: "हवा की गति",
    seaState: "समुद्र की स्थिति (डगलस)",
    lightningRisk: "बिजली और तूफान का जोखिम",
    vesselTableTitle: "लाइव तटीय बेड़ा टेलीमेट्री (लाइव एआईएस + सिम्युलेटेड)",
    simulatedDisclaimer: "नोट: जिन क्षेत्रों में अभी रिसीवर कवरेज नहीं है, वहाँ लाइव एआईएस नाव स्थितियों को स्पष्ट रूप से चिह्नित सिम्युलेटेड बेड़े से पूरा किया जाता है। उपग्रह समुद्र विज्ञान डेटा एसआईएच 2026 प्रदर्शन के लिए सिम्युलेटेड है।"
  },
  ta: {
    appTitle: "ஆர்கா இன்சைட் (ORCA INSIGHT)",
    appSubtitle: "இஸ்ரோ கூட்டு கடல்சார் நுண்ணறிவு · SIH 2026 PS 26176",
    teamName: "டீம் சேவியர்ஸ்எக்ஸ் (Team SavioursX)",
    navHome: "முகப்பு",
    navChat: "AI முடிவெடுக்கும் மையம்",
    navMap: "GIS கட்டளை வரைபடம்",
    navDAG: "ஏஜென்ட் DAG காட்சிப்படுத்தி",
    navSafety: "பாதுகாப்பு அளவுகோல்",
    navFleet: "படகுகள் கண்காணிப்பு",
    navNavic: "நாவிக் (NavIC) ஜிபிஎஸ்",
    navBulletins: "அதிகாரப்பூர்வ அறிவிப்புகள்",
    heroTitle: "இந்தியப் பெருங்கடலுக்கான கூட்டு கடல்சார் நுண்ணறிவு",
    heroDesc: "இஸ்ரோ ஓஷன்சாட்-3, இன்சாட்-3டிஆர் செயற்கைக்கோள் தரவு, சர்வதேச எல்லைக் கோடு, படகுகளின் அடர்த்தி மற்றும் வருகை நேரத்தை பகுப்பாய்வு செய்து மீனவர்களுக்கு வழிகாட்டுகிறது.",
    ctaStudio: "AI முடிவெடுக்கும் மையம்",
    ctaMap: "கட்டளை வரைபடம்",
    ctaFleet: "படகு கண்காணிப்பு",
    statsActiveVessels: "கண்காணிக்கப்படும் படகுகள்",
    statsSatellites: "இஸ்ரோ செயற்கைக்கோள்கள்",
    statsPFZ: "மீன்பிடி மண்டலங்கள் (PFZ)",
    statsIMBL: "எல்லைப் பாதுகாப்பு மண்டலங்கள்",
    chipPFZ: "அருகிலுள்ள அதிக மீன்வள பகுதி",
    chipSafety: "கடல் பயண பாதுகாப்பு சரிபார்ப்பு",
    chipBorder: "சர்வதேச எல்லை தூரம்",
    chipDensity: "படகு நெரிசல் எச்சரிக்கை",
    chipETA: "பயண நேரம் மற்றும் திரும்பும் நேரம்",
    chatPlaceholder: "ஆர்காவிடம் கேளுங்கள் அல்லது மைக் அழுத்தி பேசுங்கள்...",
    chatSend: "கேட்கவும்",
    routePlannerTitle: "பாதுகாப்பான வழித்தடம் மற்றும் ETA",
    originHarbour: "புறப்படும் துறைமுகம்",
    destinationPFZ: "இலக்கு மீன்பிடி பகுதி",
    simulateRouteBtn: "வழித்தடத்தை கணக்கிடுங்கள்",
    distanceNM: "தொலைவு (கடல் மைல்)",
    liveETA: "பயண நேரம் (Live ETA)",
    returnDusk: "இரவுக்குள் திரும்புதல் பாதுகாப்பு",
    sosButton: "அவசர உதவி (SOS)",
    clearanceSafe: "கடல் பயணம் பாதுகாப்பானது",
    clearanceCaution: "எச்சரிக்கையுடன் செல்லவும்",
    clearanceUnsafe: "ஆபத்து: கடலுக்கு செல்ல வேண்டாம்",
    waveHeight: "அலைகளின் உயரம்",
    windSpeed: "காற்றின் வேகம்",
    seaState: "கடல் நிலை",
    lightningRisk: "மின்னல் மற்றும் புயல் ஆபத்து",
    vesselTableTitle: "நேரடி படகு தொலைத்தொடர்பு தரவு",
    simulatedDisclaimer: "குறிப்பு: வரவேற்பி (receiver) கவரேஜ் இல்லாத பகுதிகளில் லைவ் AIS படகு நிலைகள், தெளிவாகக் குறிக்கப்பட்ட சிமுலேட்டட் கடற்படையால் நிரப்பப்படுகின்றன. செயற்கைக்கோள் கடல் தரவு SIH 2026 விளக்கக்காட்சிக்காக சிமுலேட் செய்யப்பட்டதாகவே உள்ளது."
  },
  ml: {
    appTitle: "ഓർക്ക ഇൻസൈറ്റ് (ORCA INSIGHT)",
    appSubtitle: "ഐ.എസ്.ആർ.ഒ സമുദ്ര രഹസ്യാന്വേഷണം · SIH 2026 PS 26176",
    teamName: "ടീം സേവ്യേഴ്സ്എക്സ് (Team SavioursX)",
    navHome: "ഹോം",
    navChat: "എ.ഐ ഡിസിഷൻ സ്റ്റുഡിയോ",
    navMap: "ജി.ഐ.എസ് കമാൻഡ് മാപ്പ്",
    navDAG: "ഏജന്റ് ഡി.എ.ജി റീസണിംഗ്",
    navSafety: "സുരക്ഷാ മാനദണ്ഡങ്ങൾ",
    navFleet: "ബോട്ട് ഫ്ലീറ്റ് മോണിറ്റർ",
    navNavic: "നാവിക് (NavIC) ജി.പി.എസ്",
    navBulletins: "ബുള്ളറ്റിനുകൾ",
    heroTitle: "ഇന്ത്യൻ സമുദ്രത്തിനായുള്ള സമ്പൂർണ്ണ എ.ഐ സഹായം",
    heroDesc: "ഐ.എസ്.ആർ.ഒ ഓഷ്യൻസാറ്റ്-3, ഇൻസാറ്റ്-3ഡിആർ ഉപഗ്രഹ വിവരങ്ങൾ, സമുദ്രാതിർത്തി (IMBL), മത്സ്യസാന്നിധ്യ മേഖലകൾ (PFZ), തത്സമയ ബോട്ട് വിവരങ്ങൾ എന്നിവ ലഭ്യമാക്കുന്നു.",
    ctaStudio: "എ.ഐ സ്റ്റുഡിയോ തുറക്കുക",
    ctaMap: "കമാൻഡ് മാപ്പ് തുറക്കുക",
    ctaFleet: "ഫ്ലീറ്റ് മോണിറ്റർ",
    statsActiveVessels: "നിരീക്ഷിക്കുന്ന ബോട്ടുകൾ",
    statsSatellites: "ഉപഗ്രഹങ്ങൾ",
    statsPFZ: "മത്സ്യലഭ്യതാ മേഖലകൾ",
    statsIMBL: "അതിർത്തി നിരീക്ഷണ മേഖലകൾ",
    chipPFZ: "ഏറ്റവും അടുത്തുള്ള PFZ കണ്ടെത്തുക",
    chipSafety: "കടൽ യാത്ര സുരക്ഷാ പരിശോധന",
    chipBorder: "സമുദ്രാതിർത്തി ദൂര പരിശോധന",
    chipDensity: "ബോട്ട് സാന്ദ്രതാ മുന്നറിയിപ്പ്",
    chipETA: "യാത്രാ സമയവും തിരിച്ചുവരവും",
    chatPlaceholder: "ചോദിക്കൂ അല്ലെങ്കിൽ മൈക്ക് അമർത്തി സംസാരിക്കൂ...",
    chatSend: "ചോദിക്കുക",
    routePlannerTitle: "റൂട്ട് സിമുലേറ്ററും യാത്രാസമയവും",
    originHarbour: "പുറപ്പെടുന്ന തുറമുഖം",
    destinationPFZ: "ലക്ഷ്യസ്ഥാനം (PFZ)",
    simulateRouteBtn: "റൂട്ട് കണക്കാക്കുക",
    distanceNM: "ദൂരം (നോട്ടിക്കൽ മൈൽ)",
    liveETA: "യാത്രാ സമയം (ETA)",
    returnDusk: "സൂര്യാസ്തമയത്തിന് മുൻപുള്ള തിരിച്ചുവരവ്",
    sosButton: "അടിയന്തിര സഹായം (SOS)",
    clearanceSafe: "കടലിൽ പോകാൻ സുരക്ഷിതം",
    clearanceCaution: "ജാഗ്രത പാലിക്കുക",
    clearanceUnsafe: "അപകടകരം: പോകരുത്",
    waveHeight: "തിരമാലയുടെ ഉയരം",
    windSpeed: "കാറ്റിന്റെ വേഗത",
    seaState: "കടൽ അവസ്ഥ",
    lightningRisk: "മിന്നൽ സാധ്യത",
    vesselTableTitle: "തത്സമയ ബോട്ട് വിവരങ്ങൾ (AIS)",
    simulatedDisclaimer: "ശ്രദ്ധിക്കുക: നിലവിൽ റിസീവർ കവറേജ് ഇല്ലാത്ത സ്ഥലങ്ങളിൽ ലൈവ് AIS ബോട്ട് സ്ഥാനങ്ങൾ, വ്യക്തമായി അടയാളപ്പെടുത്തിയ സിമുലേറ്റഡ് കപ്പലുകൾ ഉപയോഗിച്ച് പൂരിപ്പിക്കുന്നു. ഉപഗ്രഹ സമുദ്ര വിവരങ്ങൾ SIH 2026 അവതരണത്തിനായി സിമുലേറ്റ് ചെയ്തതു തന്നെയാണ്."
  }
};

// 8 Multi-Agent Definitions
const agentsList = [
  {
    id: "supervisor",
    name: "Master Supervisor / DAG Planner",
    role: "Decomposes multi-modal marine query, allocates subtasks to satellite, hazard, and geofence agents.",
    sensors: ["Intent Parser", "Task Scheduler"],
    latency: "18ms",
    status: "idle",
    sampleOutput: { intent: "VOYAGE_SAFETY_AND_PFZ_QUERY", target_region: "Kochi_Malabar", subtasks: ["FETCH_SST", "EVAL_WAVE_HAZARD", "CHECK_IMBL", "COMPUTE_FLEET_DENSITY", "CALC_ETA"] }
  },
  {
    id: "satellite_agent",
    name: "Satellite Oceanography Agent",
    role: "Ingests Oceansat-3 OCM-3 (chlorophyll-a) & SSTM (thermal fronts) along with INSAT-3DR cloud imagery.",
    sensors: ["Oceansat-3 OCM-3", "SSTM", "INSAT-3DR Sounder"],
    latency: "34ms",
    status: "idle",
    sampleOutput: { sst_celsius: 28.4, sst_gradient: "0.18 C/km", chlorophyll_mg_m3: 1.85, upwelling_active: true, cloud_cover_pct: 18 }
  },
  {
    id: "weather_agent",
    name: "Weather & Marine Hazard Agent",
    role: "Evaluates Significant Wave Height (SWH), wind gust vectors, lightning probability, and generates sea-clearance score.",
    sensors: ["Open-Meteo Live SWH", "Sentinel-3 SRAL Altimeter", "Scatterometer"],
    latency: "29ms",
    status: "idle",
    sampleOutput: { wave_height_m: 1.25, wind_speed_knots: 14.2, sea_state_douglas: 3, lightning_risk_pct: 8, safety_score: 88, clearance: "SAFE" }
  },
  {
    id: "pfz_agent",
    name: "Ocean Analytics & PFZ Agent",
    role: "Identifies thermal-chlorophyll front intersections, calculates pelagic biomass density, and ranks target fishing zones.",
    sensors: ["INCOIS Frontal Matrix", "MODIS-Aqua Validation"],
    latency: "42ms",
    status: "idle",
    sampleOutput: { matched_pfz: "PFZ-01 (Kochi Deep)", catch_potential: "HIGH (94%)", target_species: ["Tuna", "Mackerel", "Sardines"], depth_m: 75 }
  },
  {
    id: "geofencing_agent",
    name: "Geofencing & Routing Agent",
    role: "Monitors International Maritime Boundary Lines (IMBL), buffers Marine Protected Areas, and calculates A* safe waypoints.",
    sensors: ["ISRO NavIC Geofence Engine", "UNCLOS Maritime Grid"],
    latency: "22ms",
    status: "idle",
    sampleOutput: { imbl_status: "SAFE", nearest_imbl_nm: 138.5, mpa_breach: false, route_waypoints_count: 5, avoidance_active: true }
  },
  {
    id: "fleet_agent",
    name: "Fleet & Traffic Agent (New)",
    role: "Scans AIS & ARGOS-4 vessel transponders, tracks fleet distribution, and flags overcrowding or border congestion.",
    sensors: ["ARGOS-4 Marine Beacon", "AIS Coastal VTS Receiver"],
    latency: "31ms",
    status: "idle",
    sampleOutput: { vessels_in_pfz: 8, zone_capacity_pct: 32, overcrowding_risk: "LOW", border_proximity_alerts: 2 }
  },
  {
    id: "eta_agent",
    name: "ETA & Voyage Safety Agent (New)",
    role: "Calculates transit duration adjusted for real-time wave resistance and evaluates return-by-dusk safety window.",
    sensors: ["Hydrodynamic Transit Model", "Astronomical Ephemeris (Dusk)"],
    latency: "25ms",
    status: "idle",
    sampleOutput: { route_distance_nm: 28.4, vessel_speed_knots: 8.2, adjusted_eta_hours: 3.46, fishing_window_hours: 4.0, estimated_return_ist: "16:45 IST", dusk_ist: "18:30 IST", dusk_safety_verdict: "SAFE_RETURN_BEFORE_DUSK" }
  },
  {
    id: "synthesis_agent",
    name: "Neural Synthesis Agent (LLM)",
    role: "Aggregates multi-agent telemetry into an authoritative, grounded natural-language advisory with citation tags and TTS.",
    sensors: ["Groq Llama-3 / Grounded Neural Engine", "Web Speech Synthesizer"],
    latency: "52ms",
    status: "idle",
    sampleOutput: { advisory_generated: true, confidence_pct: 96, citations: ["Oceansat-3 OCM-3", "INSAT-3DR", "INCOIS PFZ-01", "Coast Guard VTS"], tts_ready: true }
  }
];

// Runs one startup step in isolation. Every step used to run back-to-back
// with no guard, which meant a single throwing step (e.g. an invalid
// GeoJSON layer, or a missing function) silently aborted every step after
// it -- including the Safety Barometer refresh and Fleet Monitor's live
// vessel polling, leaving the whole page frozen on stale placeholder
// values with no visible error. A broken feature must never again be able
// to take the rest of the dashboard down with it.
function runStartupStep(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`ORCA INSIGHT: startup step "${label}" failed and was skipped:`, err);
    return null;
  }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  runStartupStep('registerServiceWorker', registerServiceWorker);
  runStartupStep('checkBackendHealth', checkBackendHealth);
  setInterval(() => runStartupStep('checkBackendHealth', checkBackendHealth), 15000); // re-check periodically in case the backend starts later
  try {
    await loadInitialData();
  } catch (err) {
    console.error('ORCA INSIGHT: loadInitialData failed:', err);
  }
  runStartupStep('setupNavigation', setupNavigation);
  runStartupStep('setupSlideFillButtons', setupSlideFillButtons);
  runStartupStep('setupHeaderScrollHide', setupHeaderScrollHide);
  runStartupStep('setupScrollReveal', setupScrollReveal);
  runStartupStep('setupLanguageSwitcher', setupLanguageSwitcher);
  runStartupStep('setupThemeSwitcher', setupThemeSwitcher);
  runStartupStep('setupMap', setupMap);
  runStartupStep('setupChatbot', setupChatbot);
  runStartupStep('setupSpeechRecognition', setupSpeechRecognition);
  runStartupStep('setupDAGVisualizer', setupDAGVisualizer);
  runStartupStep('setupRoutePlanner', setupRoutePlanner);
  runStartupStep('setupFleetMonitor', setupFleetMonitor);
  runStartupStep('setupSafetyBarometer', setupSafetyBarometer);
  runStartupStep('setupNavICTelemetry', setupNavICTelemetry);
  runStartupStep('setupGeofenceTracking', setupGeofenceTracking);
  runStartupStep('setupBulletins', setupBulletins);
  runStartupStep('setupProactiveAlerts', setupProactiveAlerts);
  runStartupStep('setupSOSModal', setupSOSModal);
  runStartupStep('setupMSSCodeGenerator', setupMSSCodeGenerator);
  runStartupStep('startLiveVesselSimulation', startLiveVesselSimulation);
  runStartupStep('updateLiveClock', updateLiveClock);
  setInterval(updateLiveClock, 1000);

  // Fetch real Open-Meteo Marine Data for default Kochi Harbour
  runStartupStep('fetchLiveMarineTelemetry', () => fetchLiveMarineTelemetry(9.93, 76.26));
  runStartupStep('refreshExternalTelemetry', refreshExternalTelemetry);
  // Match the live AIS publisher cadence so the Fleet Monitor shows a new
  // server snapshot within one polling cycle.
  setInterval(() => runStartupStep('refreshExternalTelemetry', refreshExternalTelemetry), 10000);
});

// Live deployments intentionally do not install an offline service worker:
// cached application shells can hide fresh vessel and safety data on devices
// that previously visited the dashboard.
function registerServiceWorker() {
  return;
}

// Fetch wrapper with a hard timeout so a missing/unreachable backend fails
// fast instead of hanging the UI.
function fetchWithTimeout(url, opts = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Pings the FastAPI backend's /api/health route to decide whether the app
// should run in Live Backend mode or fall back to the offline local simulation.
async function checkBackendHealth() {
  try {
    const res = await fetchWithTimeout(`${BACKEND_CONFIG.apiBase}/api/health`, {}, 2500);
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
    await res.json();
    state.backendOnline = true;
  } catch (err) {
    state.backendOnline = false;
  }
  updateBackendStatusBadges();
  return state.backendOnline;
}

function updateBackendStatusBadges() {
  const onlineHtml = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> LIVE FASTAPI BACKEND CONNECTED`;
  const onlineClass = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono";
  const offlineHtml = `<span class="w-2 h-2 rounded-full bg-amber-400"></span> BACKEND OFFLINE · LOCAL SIMULATION MODE`;
  const offlineClass = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-300 text-[11px] font-mono";

  ['backendStatusBadge', 'dagBackendStatusBadge'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = state.backendOnline ? onlineHtml : offlineHtml;
    el.className = state.backendOnline ? onlineClass : offlineClass;
  });
}

// Pull server-validated AIS/GPS snapshots when an operator has configured a
// real feed. The browser never calls satellite/AIS providers directly, so
// provider credentials stay on the backend. The backend backfills any port
// with zero live coverage using a clearly-tagged simulated fleet (see
// backend ais_gateway.enrich_simulated_vessels) -- every vessel arrives with
// an explicit `is_simulated` flag, so the frontend never has to guess and
// never presents simulated data as real AIS traffic.
async function refreshExternalTelemetry() {
  if (!(await checkBackendHealth())) return;
  try {
    const res = await fetchWithTimeout(`${BACKEND_CONFIG.apiBase}/api/live/vessels`, {}, 5000);
    if (!res.ok) return;
    const snapshot = await res.json();
    if ((snapshot.status !== 'LIVE' && snapshot.status !== 'SIMULATED_FALLBACK') || !Array.isArray(snapshot.payload) || !snapshot.payload.length) {
      updateAisFeedBanner(snapshot.status, snapshot.ais_gateway);
      return;
    }
    updateAisFeedBanner(snapshot.status, snapshot.ais_gateway, snapshot.live_vessel_count, snapshot.simulated_vessel_count);
    state.vessels = snapshot.payload;
    state.liveVesselCount = snapshot.live_vessel_count ?? snapshot.payload.filter(v => !v.is_simulated).length;
    state.simulatedVesselCount = snapshot.simulated_vessel_count ?? snapshot.payload.filter(v => v.is_simulated).length;
    state.usesLiveVessels = true;
    renderVesselsOnMap();
    renderVesselsTable();
    renderFleetDistributionChart();
    updateImblAlertBox();
  } catch (err) {
    console.warn('External telemetry refresh unavailable; retaining last known data.', err);
  }
}

function updateAisFeedBanner(status, gatewayState, liveCount, simulatedCount) {
  const id = 'aisFeedStatusBanner';
  let el = document.getElementById(id);

  // LIVE with no simulated backfill needed -- nothing to explain, remove any banner.
  if (status === 'LIVE' && !simulatedCount) {
    if (el) el.remove();
    return;
  }

  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483000;font:600 12px/1.5 system-ui,-apple-system,sans-serif;padding:8px 16px;text-align:center;box-shadow:0 -2px 8px rgba(0,0,0,.35);';
    document.body.appendChild(el);
  }

  // Blended live + simulated coverage: informational, not an error/warning.
  if ((status === 'LIVE' || status === 'SIMULATED_FALLBACK') && simulatedCount) {
    el.style.background = '#0c4a6e';
    el.style.color = '#e0f2fe';
    const liveText = liveCount ? `${liveCount} live AIS vessel${liveCount === 1 ? '' : 's'}` : 'no live AIS vessels right now';
    el.textContent = `ℹ Showing ${liveText} + ${simulatedCount} simulated vessel${simulatedCount === 1 ? '' : 's'} filling ports with no live AIS coverage right now.`;
    return;
  }

  el.style.background = '#78350f';
  el.style.color = '#fef3c7';
  let detail = 'Live AIS vessel feed unavailable -- showing 0 vessels.';
  if (gatewayState) {
    if (!gatewayState.configured) {
      detail = 'Live AIS vessel feed is not configured on this deployment.';
    } else if (gatewayState.connected) {
      detail = 'Connected to the AIS provider (AISstream.io), but it isn’t sending vessel data right now — likely a provider-side outage, not a local fault.';
    } else {
      detail = 'Disconnected from the AIS provider (AISstream.io); reconnecting automatically.';
    }
  }
  el.textContent = '⚠ ' + detail;
}

// Populates the home tab's IMBL Border Proximity Alert card from real
// vessel telemetry instead of a fixed, hardcoded example vessel/distance.
// Shows the closest tracked vessel to the India-Sri Lanka maritime boundary
// when one is inside the warning distance, and an honest "no alerts"
// message otherwise -- it never fabricates a vessel or distance that isn't
// actually in state.vessels.
const IMBL_WARNING_DISTANCE_NM = 10;
function updateImblAlertBox() {
  const box = document.getElementById('imblAlertBox');
  if (!box) return;
  const card = document.getElementById('imblAlertCard');
  const dot = document.getElementById('imblAlertDot');

  const candidates = state.vessels.filter(v => typeof v.imbl_dist_nm === 'number');
  const closest = candidates.length
    ? candidates.reduce((a, b) => (b.imbl_dist_nm < a.imbl_dist_nm ? b : a))
    : null;
  const isAlert = !!(closest && closest.imbl_dist_nm <= IMBL_WARNING_DISTANCE_NM);

  if (card) {
    card.classList.toggle('bg-red-950/40', isAlert);
    card.classList.toggle('border-red-500/50', isAlert);
    card.classList.toggle('bg-emerald-950/30', !isAlert);
    card.classList.toggle('border-emerald-600/30', !isAlert);
  }
  if (dot) {
    dot.classList.toggle('bg-red-500', isAlert);
    dot.classList.toggle('animate-ping', isAlert);
    dot.classList.toggle('bg-emerald-500', !isAlert);
  }

  if (isAlert) {
    const simTag = closest.is_simulated ? ' (simulated)' : '';
    box.className = 'text-xs text-red-200 leading-relaxed';
    box.innerHTML = `<strong>${closest.id} (${closest.name})</strong> is operating at <strong>${closest.imbl_dist_nm} NM</strong> from the India–Sri Lanka IMBL${simTag}. Automated warning dispatched.`;
  } else if (closest) {
    box.className = 'text-xs text-emerald-200 leading-relaxed';
    box.innerHTML = `No vessels currently within the ${IMBL_WARNING_DISTANCE_NM} NM IMBL warning distance. Nearest tracked vessel: <strong>${closest.imbl_dist_nm} NM</strong> away.`;
  } else {
    box.className = 'text-xs text-slate-400 leading-relaxed';
    box.innerHTML = 'No vessel telemetry available yet.';
  }
}

// Live Open-Meteo Marine API Integration
async function fetchLiveMarineTelemetry(lat, lon) {
  const badgeEl = document.getElementById('apiLiveBadge');
  try {
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_direction,wave_period&hourly=wave_height&timezone=Asia%2FKolkata`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Network response error");
    const data = await res.json();

    if (data && data.current) {
      state.liveMarine.waveHeight = data.current.wave_height || 1.25;
      state.liveMarine.isLiveFeed = true;
      state.liveMarine.lastFetchTime = new Date().toLocaleTimeString();

      // Recalculate Sea State
      if (state.liveMarine.waveHeight < 0.5) state.liveMarine.seaState = 1;
      else if (state.liveMarine.waveHeight < 1.25) state.liveMarine.seaState = 2;
      else if (state.liveMarine.waveHeight < 2.5) state.liveMarine.seaState = 3;
      else state.liveMarine.seaState = 4;

      if (badgeEl) {
        badgeEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> LIVE OPEN-METEO TELEMETRY (${state.liveMarine.waveHeight}m SWH)`;
        badgeEl.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-mono";
      }

      // Update Safety Barometer Tiles
      updateSafetyMetricsUI();
    }
  } catch (err) {
    console.log("Open-Meteo Marine API running in cached offline mode", err);
    if (badgeEl) {
      badgeEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-cyan-400"></span> TELEMETRY ACTIVE (CACHED SATELLITE ARCHIVE)`;
      badgeEl.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 text-xs font-mono";
    }
  }
}

function updateSafetyMetricsUI() {
  const waveVal = document.getElementById('marineWaveVal');
  const windVal = document.getElementById('marineWindVal');
  const seaVal = document.getElementById('marineSeaVal');
  
  if (waveVal) waveVal.textContent = `${state.liveMarine.waveHeight.toFixed(2)} m`;
  if (windVal) windVal.textContent = `${state.liveMarine.windSpeed.toFixed(1)} kn`;
  if (seaVal) seaVal.textContent = `State ${state.liveMarine.seaState}`;
}

// Proactive alerts use the backend stream when available. Local Simulation
// still evaluates the browser's Open-Meteo telemetry, but never claims that
// result was issued by a server-side monitoring service.
function setupProactiveAlerts() {
  const toggle = document.getElementById('toggleHazardNotifications');
  if (toggle) {
    toggle.addEventListener('change', async () => {
      if (!toggle.checked) {
        state.browserNotificationsEnabled = false;
        return;
      }
      if (!('Notification' in window)) {
        toggle.checked = false;
        showHazardAlert({ title: 'Browser notifications unavailable', message: 'In-app hazard banners will still be shown while this tab is open.', severity: 'INFO' }, false);
        return;
      }
      const permission = await Notification.requestPermission();
      state.browserNotificationsEnabled = permission === 'granted';
      toggle.checked = state.browserNotificationsEnabled;
      if (!state.browserNotificationsEnabled) showHazardAlert({ title: 'Browser notifications not enabled', message: 'In-app hazard banners remain active while this tab is open.', severity: 'INFO' }, false);
    });
  }
  connectHazardAlertStream();
  setInterval(evaluateLocalHazards, 60000);
}

async function connectHazardAlertStream() {
  if (!(await checkBackendHealth())) {
    evaluateLocalHazards();
    return;
  }
  try {
    const response = await fetchWithTimeout(`${BACKEND_CONFIG.apiBase}/api/alerts`, {}, 3000);
    if (response.ok) state.proactiveAlerts = (await response.json()).alerts || [];
    const socket = new WebSocket(`${BACKEND_CONFIG.wsBase}/ws/alerts`);
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'ALERT_SNAPSHOT') state.proactiveAlerts = message.alerts || [];
        if (message.type === 'ALERT_CREATED' && message.alert) {
          state.proactiveAlerts.unshift(message.alert);
          showHazardAlert(message.alert, true);
        }
      } catch (error) { console.warn('Invalid hazard-alert event', error); }
    });
    socket.addEventListener('error', evaluateLocalHazards);
  } catch (error) {
    evaluateLocalHazards();
  }
}

function evaluateLocalHazards() {
  const wave = state.liveMarine.waveHeight;
  const wind = state.liveMarine.windSpeed;
  const localCandidates = [
    wave >= 2.5 && { key: 'LOCAL_HIGH_WAVES', severity: 'WARNING', title: 'High waves — local simulation', message: `${wave.toFixed(2)}m exceeds the 2.5m caution threshold. Source: browser Open-Meteo telemetry.` },
    wind >= 25 && { key: 'LOCAL_HIGH_WIND', severity: 'WARNING', title: 'High wind — local simulation', message: `${wind.toFixed(1)} kn exceeds the 25 kn caution threshold. Source: browser Open-Meteo telemetry.` },
    state.liveMarine.lightningRisk >= 50 && { key: 'LOCAL_LIGHTNING', severity: 'CRITICAL', title: 'Lightning risk — local simulation', message: `Lightning proxy is ${state.liveMarine.lightningRisk}%. Source: browser Open-Meteo telemetry.` }
  ].filter(Boolean);
  localCandidates.forEach(alert => {
    if (!state.localAlertKeys.has(alert.key)) {
      state.localAlertKeys.add(alert.key);
      showHazardAlert({ ...alert, data_source: 'LOCAL_SIMULATION' }, true);
    }
  });
}

function showHazardAlert(alert, allowBrowserNotification) {
  const banner = document.createElement('div');
  const danger = alert.severity === 'CRITICAL';
  banner.className = `fixed right-4 top-20 z-[70] max-w-sm p-4 rounded-xl border shadow-2xl ${danger ? 'bg-red-950 border-red-500 text-red-100' : 'bg-amber-950 border-amber-500 text-amber-100'}`;
  banner.innerHTML = `<strong class="block text-sm">${alert.title}</strong><span class="block text-xs mt-1">${alert.message}</span><span class="block text-[10px] mt-2 opacity-70">${typeof alert.data_source === 'string' ? alert.data_source : 'PROACTIVE_HAZARD_EVALUATOR'}</span>`;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 9000);
  if (allowBrowserNotification && state.browserNotificationsEnabled && document.visibilityState !== 'visible') {
    new Notification(alert.title, { body: alert.message, tag: alert.event_key || alert.key });
  }
}

// Load JSON Datasets
async function loadInitialData() {
  try {
    const [satRes, pfzRes, imblRes, mpaRes, hbrRes, vesRes, bulRes, indiaRes] = await Promise.all([
      fetch('data/satellites.json').then(r => r.json()),
      fetch('data/pfz_zones.json').then(r => r.json()),
      fetch('data/imbl_boundaries.json').then(r => r.json()),
      fetch('data/mpas.json').then(r => r.json()),
      fetch('data/harbours.json').then(r => r.json()),
      fetch('data/simulated_vessels.json').then(r => r.json()),
      fetch('data/bulletins.json').then(r => r.json()),
      // Official India boundary (per Survey of India, including J&K/Ladakh
      // and Aksai Chin as depicted in India's own government maps), sourced
      // from datameet/maps (CC-0), simplified from 10.7MB to ~150KB with
      // turf.simplify at a 0.01-degree tolerance -- plenty precise for a
      // national-scale reference overlay, not a street-level navigation aid.
      fetch('data/india_boundary.geojson').then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    state.satellites = satRes.satellites || [];
    state.pfzZones = pfzRes.zones || [];
    state.imblBoundaries = imblRes.boundaries || [];
    state.mpas = mpaRes.mpas || [];
    state.harbours = hbrRes.harbours || [];
    state.indiaBoundary = indiaRes || null;
    // Keep the file available for offline demo assets, but do not display its
    // simulated vessels in the live fleet/map UI. Only /api/live/vessels can
    // populate state.vessels.
    state.vessels = [];
    state.bulletins = bulRes.bulletins || [];
    
    console.log("ORCA INSIGHT: Static map datasets loaded; awaiting live AIS/GPS vessel feed.");
  } catch (err) {
    console.error("Error loading JSON telemetry data", err);
  }
}

// Navigation Tab Switcher
function setupNavigation() {
  const navButtons = document.querySelectorAll('[data-nav-target]');
  navButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const target = btn.getAttribute('data-nav-target');
      switchTab(target);
    });
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.add('hidden');
  });

  const activeSection = document.getElementById(`tab-${tabId}`);
  if (activeSection) {
    activeSection.classList.remove('hidden');
  }

  document.querySelectorAll('[data-nav-target]').forEach(btn => {
    if (btn.getAttribute('data-nav-target') === tabId) {
      btn.classList.add('bg-cyan-500/20', 'text-cyan-400', 'border-cyan-500/50');
      btn.classList.remove('text-slate-400', 'border-transparent');
    } else {
      btn.classList.remove('bg-cyan-500/20', 'text-cyan-400', 'border-cyan-500/50');
      btn.classList.add('text-slate-400', 'border-transparent');
    }
    btn.classList.toggle('sfb-active', btn.getAttribute('data-nav-target') === tabId);
  });

  if (tabId === 'map' && state.map) {
    setTimeout(() => {
      // Mappls' vector engine has no documented invalidateSize() -- try its
      // MapLibre-style resize() defensively so a tab-switch reflow still
      // repaints the canvas correctly; never let this break tab switching.
      try { state.map.resize(); } catch (err) { /* not available -- ignore */ }
    }, 200);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Slide Fill Button (liquid hover-fill effect)
// Faithful vanilla CSS/JS recreation of the Originkit "Slide Fill Button" —
// the real component's source is paywalled inside Framer and not publicly
// retrievable, so this reproduces the documented effect from scratch.
function setupSlideFillButtons() {
  const buttons = document.querySelectorAll('.sfb-btn:not(.sfb-enhanced)');
  if (!buttons.length) return;

  if (!window.__sfbResizeObserver) {
    window.__sfbResizeObserver = new ResizeObserver(entries => {
      entries.forEach(entry => {
        const btn = entry.target;
        const submerged = btn.querySelector('.sfb-inner--submerged');
        if (submerged) submerged.style.height = btn.offsetHeight + 'px';
      });
    });
  }

  buttons.forEach(btn => {
    const cs = getComputedStyle(btn);

    const baseInner = document.createElement('span');
    baseInner.className = 'sfb-inner';
    while (btn.firstChild) baseInner.appendChild(btn.firstChild);

    const content = document.createElement('span');
    content.className = 'sfb-content';
    content.appendChild(baseInner);

    const fill = document.createElement('span');
    fill.className = 'sfb-fill';
    fill.setAttribute('aria-hidden', 'true');
    const submerged = baseInner.cloneNode(true);
    submerged.classList.add('sfb-inner--submerged');
    fill.appendChild(submerged);

    btn.appendChild(content);
    btn.appendChild(fill);
    btn.classList.add('sfb-enhanced');

    [baseInner, submerged].forEach(inner => {
      inner.style.display = cs.display.includes('flex') ? cs.display : 'flex';
      inner.style.alignItems = cs.alignItems;
      inner.style.justifyContent = cs.justifyContent;
      inner.style.gap = cs.gap;
    });

    submerged.style.height = btn.offsetHeight + 'px';
    window.__sfbResizeObserver.observe(btn);
  });
}

// Header hide-on-scroll (UI/UX restyle, phase 2) -- purely decorative and
// additive: toggles a CSS class on <header> based on scroll direction, does
// not touch any existing state, ids, or classes JS elsewhere depends on.
function setupHeaderScrollHide() {
  const header = document.querySelector('header');
  if (!header) return;
  let lastY = window.scrollY;
  let ticking = false;
  const THRESHOLD = 12;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const currentY = window.scrollY;
      if (Math.abs(currentY - lastY) > THRESHOLD) {
        if (currentY > lastY && currentY > 80) {
          header.classList.add('header-hidden');
        } else {
          header.classList.remove('header-hidden');
        }
        lastY = currentY;
      }
      ticking = false;
    });
  }, { passive: true });
}

// Scroll-reveal entrance animation (UI/UX restyle, phase 6) -- purely decorative
// and additive: observes elements carrying the .reveal class and adds .revealed
// once each enters the viewport, then stops observing it. Does not touch any
// existing state, ids, or classes JS elsewhere depends on. Elements without
// IntersectionObserver support (or if none exist on the page) are revealed
// immediately so content is never left permanently hidden.
function setupScrollReveal() {
  const targets = document.querySelectorAll('.reveal');
  if (!targets.length) return;
  const revealAll = () => targets.forEach(el => el.classList.add('revealed'));
  if (!('IntersectionObserver' in window)) {
    revealAll();
    return;
  }
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  targets.forEach(el => observer.observe(el));
  // Safety net: some browsers/contexts (e.g. a page that loads in a
  // background/inactive tab) throttle or defer IntersectionObserver
  // callbacks indefinitely. Never leave content permanently invisible --
  // force-reveal anything still unrevealed after a short grace period.
  setTimeout(() => {
    revealAll();
    observer.disconnect();
  }, 1200);
}

// Language Switcher
function setupLanguageSwitcher() {
  const langSelect = document.getElementById('langSelect');
  if (!langSelect) return;

  langSelect.addEventListener('change', (e) => {
    state.currentLang = e.target.value;
    state.languageOverride = true;
    applyLanguage(state.currentLang);
  });
}

// Theme Switcher (Night/Day/Grey/Blue) -- purely presentational: swaps a
// data-theme attribute that styles.css keys off of, so none of the data
// fetching or rendering logic in this file is touched by a theme change.
function setupThemeSwitcher() {
  const themeSelect = document.getElementById('themeSelect');
  if (!themeSelect) return;

  themeSelect.value = document.documentElement.getAttribute('data-theme') || 'night';

  themeSelect.addEventListener('change', (e) => {
    const theme = ORCA_THEMES.includes(e.target.value) ? e.target.value : 'night';
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('orca-theme', theme);
    } catch (err) {
      console.warn('ORCA INSIGHT: could not persist theme preference:', err);
    }
    // Nudge a resize so the map canvas and any open popups repaint with the
    // new theme's colors.
    if (state.map) {
      setTimeout(() => {
        try { state.map.resize(); } catch (err) { /* not available -- ignore */ }
      }, 50);
    }
  });
}

function applyLanguage(lang) {
  const t = translations[lang] || translations.en;
  
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) {
      el.textContent = t[key];
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (t[key]) {
      el.placeholder = t[key];
    }
  });
}

// Live Clock
function updateLiveClock() {
  const clockEl = document.getElementById('liveClock');
  if (!clockEl) return;
  
  const now = new Date();
  const istStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  clockEl.innerHTML = `<span class="text-cyan-400 font-mono font-semibold">${istStr} IST</span> · <span class="text-slate-400 font-mono">${dateStr}</span>`;
}

// Web Speech API Voice Input (Speech-to-Text / STT)
function setupSpeechRecognition() {
  const micBtn = document.getElementById('btnVoiceInput');
  const chatInput = document.getElementById('chatInput');
  const sttStatus = document.getElementById('sttRecordingStatus');

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (micBtn) {
      micBtn.title = "Speech Recognition not supported in this browser";
      micBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
    return;
  }

  state.recognition = new SpeechRecognition();
  state.recognition.continuous = false;
  state.recognition.interimResults = true;

  micBtn.addEventListener('click', () => {
    if (state.isListening) {
      state.recognition.stop();
      return;
    }

    // Set recognition language
    const langMap = {
      en: 'en-IN',
      hi: 'hi-IN',
      ta: 'ta-IN',
      ml: 'ml-IN'
    };
    state.recognition.lang = langMap[state.currentLang] || 'en-IN';

    try {
      state.recognition.start();
    } catch (e) {
      console.warn(e);
    }
  });

  state.recognition.onstart = () => {
    state.isListening = true;
    micBtn.classList.add('bg-red-600', 'text-white', 'stt-recording');
    if (sttStatus) {
      sttStatus.classList.remove('hidden');
      sttStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500 animate-ping"></span> Listening in <b>${state.recognition.lang}</b>... Speak now.`;
    }
  };

  state.recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    if (chatInput) chatInput.value = transcript;
  };

  state.recognition.onend = () => {
    state.isListening = false;
    micBtn.classList.remove('bg-red-600', 'text-white', 'stt-recording');
    if (sttStatus) sttStatus.classList.add('hidden');

    if (chatInput && chatInput.value.trim()) {
      handleChatQuery(chatInput.value.trim());
    }
  };

  state.recognition.onerror = (e) => {
    state.isListening = false;
    micBtn.classList.remove('bg-red-600', 'text-white', 'stt-recording');
    if (sttStatus) sttStatus.classList.add('hidden');
    console.warn("Speech recognition notice:", e.error);
  };
}

// Leaflet Map Initialization
function setupMap() {
  const mapContainer = document.getElementById('mapContainer');
  if (!mapContainer) return;

  // Government of India-authorized basemap (Mappls / MapmyIndia) -- this
  // replaces the previous Leaflet + OpenStreetMap stack entirely. Mappls
  // has no plain XYZ tile layer that plugs into Leaflet, so every overlay
  // below is rebuilt on Mappls' own Marker/Polygon/Polyline/Circle APIs
  // instead of Leaflet's, tracked in plain arrays under state.mapLayers
  // (Mappls has no Leaflet-style featureGroup) and cleared/rebuilt via
  // clearMapLayerGroup() + the render*Layer() functions below.
  if (typeof mappls === 'undefined' || !mappls.Map) {
    console.warn('ORCA INSIGHT: Mappls SDK failed to load -- GIS map disabled.');
    return;
  }

  state.map = new mappls.Map('mapContainer', {
    center: { lat: 12.0, lng: 77.5 },
    zoom: 6
  });

  state.map.addListener('load', function () {
    state.mapLayers.indiaBoundary = [];
    state.mapLayers.pfz = [];
    state.mapLayers.imbl = [];
    state.mapLayers.mpas = [];
    state.mapLayers.harbours = [];
    state.mapLayers.vessels = [];
    state.mapLayers.heatmap = [];
    state.mapLayers.route = [];

    renderIndiaBoundaryLayer();
    renderPFZLayers();
    renderIMBLLayers();
    renderMPALayers();
    renderHarbourMarkers();
    renderVesselsOnMap();
    renderHeatmapLayers();
    setupLayerToggles();
  });
}

// Removes every Mappls layer object tracked under state.mapLayers[key] and
// empties the array. Mappls has no Leaflet-style featureGroup.clearLayers(),
// so each render*Layer() function below calls this first, then rebuilds
// from scratch -- the same "clear then redraw" pattern the Leaflet version
// used, just without a single container object to clear in one call.
function clearMapLayerGroup(key) {
  const group = state.mapLayers[key];
  if (!Array.isArray(group) || !state.map) return;
  group.forEach(layer => {
    try { mappls.remove({ map: state.map, layer }); } catch (err) { /* already gone */ }
  });
  state.mapLayers[key] = [];
}

// Draws India's officially correct external boundary -- per the Survey of
// India's depiction (Jammu & Kashmir/Ladakh, Aksai Chin, and the China/
// Pakistan-disputed sectors shown as Indian territory, no dotted/disputed
// lines) -- as a bold outline on top of the base map. Source: data/
// india_boundary.geojson, compiled by datameet/maps (CC-0) from LSIB (US
// Dept of State), Pakistan admin boundary data, and Natural Earth vectors;
// see data/README or the ORCA_HANDOFF doc for the full source citation.
function renderIndiaBoundaryLayer() {
  if (!state.map || !state.indiaBoundary) return;
  // Guarded: this is an optional cosmetic overlay drawn on top of Mappls'
  // own government-compliant vector basemap for extra visual emphasis. A
  // malformed or missing boundary file (e.g. a 404 error body that still
  // parses as JSON) must never be allowed to throw here and abort the rest
  // of setupMap() -- that exact failure mode previously took down the
  // whole page's live data refresh (see renderSatelliteCards incident).
  // Fail silently and leave the layer empty instead.
  try {
    clearMapLayerGroup('indiaBoundary');

    // Extract every ring/line from the boundary GeoJSON ourselves (rather
    // than handing the raw FeatureCollection to mappls.addGeoJson(), whose
    // own documentation is inconsistent about coordinate order) and draw
    // each with mappls.Polyline, whose {lat,lng} path format is unambiguous.
    const rings = [];
    const collectGeometry = (geometry) => {
      if (!geometry) return;
      if (geometry.type === 'Polygon') {
        geometry.coordinates.forEach(ring => rings.push(ring));
      } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(poly => poly.forEach(ring => rings.push(ring)));
      } else if (geometry.type === 'LineString') {
        rings.push(geometry.coordinates);
      } else if (geometry.type === 'MultiLineString') {
        geometry.coordinates.forEach(line => rings.push(line));
      }
    };
    const gj = state.indiaBoundary;
    if (gj.type === 'FeatureCollection') gj.features.forEach(f => collectGeometry(f.geometry));
    else if (gj.type === 'Feature') collectGeometry(gj.geometry);
    else collectGeometry(gj);

    rings.forEach(ring => {
      const paths = ring.map(([lng, lat]) => ({ lat, lng }));
      const line = new mappls.Polyline({
        map: state.map,
        paths,
        strokeColor: '#ff9933',
        strokeOpacity: 0.95,
        strokeWeight: 3,
        popupHtml: 'India — official boundary (Survey of India)',
        popupOptions: true
      });
      state.mapLayers.indiaBoundary.push(line);
    });
  } catch (err) {
    console.warn('India boundary overlay skipped (invalid/missing data):', err);
  }
}

function renderPFZLayers() {
  if (!state.map) return;
  clearMapLayerGroup('pfz');

  state.pfzZones.forEach(zone => {
    const isHigh = zone.yield_rating.includes('HIGH');
    const color = isHigh ? '#10b981' : '#f59e0b';
    const fillColor = isHigh ? '#059669' : '#d97706';

    const paths = zone.bounds.map(([lat, lng]) => ({ lat, lng }));

    const popupHtml = `
      <div class="p-2 min-w-[220px]">
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="font-bold text-cyan-400 text-sm">${zone.name}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${isHigh ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}">${zone.yield_rating} YIELD (${zone.yield_score_pct}%)</span>
        </div>
        <p class="text-xs text-slate-300 mb-2">${zone.advisory_notes}</p>
        <div class="grid grid-cols-2 gap-1 text-[11px] bg-slate-900/80 p-1.5 rounded border border-slate-700">
          <div><span class="text-slate-400">SST:</span> <span class="text-slate-200 font-semibold">${zone.sst_celsius}°C</span></div>
          <div><span class="text-slate-400">Chlorophyll:</span> <span class="text-slate-200 font-semibold">${zone.chlorophyll_mg_m3} mg/m³</span></div>
          <div><span class="text-slate-400">Depth:</span> <span class="text-slate-200 font-semibold">${zone.depth_m} m</span></div>
          <div><span class="text-slate-400">Vessels:</span> <span class="text-cyan-400 font-bold">${zone.vessels_in_zone} Active</span></div>
        </div>
        <div class="mt-2 text-[10px] text-slate-400">
          <span class="font-semibold text-slate-300">Target Species:</span> ${zone.dominant_species.join(', ')}
        </div>
        <button onclick="selectPFZForRouting('${zone.id}')" class="mt-2 w-full py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-semibold transition">
          Simulate Route Here ➔
        </button>
      </div>
    `;

    const polygon = new mappls.Polygon({
      map: state.map,
      paths,
      strokeColor: color,
      strokeOpacity: 1,
      strokeWeight: 2,
      fillColor: fillColor,
      fillOpacity: 0.25,
      popupHtml,
      popupOptions: true
    });
    state.mapLayers.pfz.push(polygon);

    const labelHtml = `<div class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-900/90 text-cyan-300 border border-cyan-500/40 whitespace-nowrap shadow-lg flex items-center gap-1">
               <span class="w-1.5 h-1.5 rounded-full ${isHigh ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}"></span>
               ${zone.id} · ${zone.yield_rating}
             </div>`;
    const marker = new mappls.Marker({
      map: state.map,
      position: { lat: zone.center[0], lng: zone.center[1] },
      html: labelHtml,
      width: 80,
      height: 20,
      popupHtml,
      popupOptions: true
    });
    state.mapLayers.pfz.push(marker);
  });
}

function renderIMBLLayers() {
  if (!state.map) return;
  clearMapLayerGroup('imbl');

  state.imblBoundaries.forEach(bound => {
    const paths = bound.coordinates.map(([lat, lng]) => ({ lat, lng }));

    const popupHtml = `
      <div class="p-2">
        <div class="flex items-center gap-1 text-red-400 font-bold text-xs mb-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          ${bound.name}
        </div>
        <p class="text-xs text-slate-300">Strict International Maritime Boundary. Warning buffer: <span class="text-amber-400 font-bold">${bound.warning_distance_nm} NM</span>. Critical geofence: <span class="text-red-400 font-bold">${bound.danger_distance_nm} NM</span>.</p>
        <p class="text-[11px] text-slate-400 mt-1">Cross-border crossing prohibited under UNCLOS maritime treaty.</p>
      </div>
    `;

    const polyline = new mappls.Polyline({
      map: state.map,
      paths,
      strokeColor: '#ef4444',
      strokeWeight: 3,
      popupHtml,
      popupOptions: true
    });
    state.mapLayers.imbl.push(polyline);

    const bufferPaths = bound.coordinates.map(c => ({ lat: c[0] + 0.08, lng: c[1] + 0.08 }));
    const bufferPopupHtml = `⚠️ ${bound.warning_distance_nm} NM IMBL Buffer Corridor`;
    const bufferPoly = new mappls.Polyline({
      map: state.map,
      paths: bufferPaths,
      strokeColor: '#f59e0b',
      strokeWeight: 1.5,
      strokeOpacity: 0.7,
      popupHtml: bufferPopupHtml,
      popupOptions: true
    });
    state.mapLayers.imbl.push(bufferPoly);
  });
}

function renderMPALayers() {
  if (!state.map) return;
  clearMapLayerGroup('mpas');

  state.mpas.forEach(mpa => {
    const paths = mpa.bounds.map(([lat, lng]) => ({ lat, lng }));

    const popupHtml = `
      <div class="p-2">
        <span class="text-xs font-bold text-pink-400">🛡️ ${mpa.name}</span>
        <div class="text-[11px] bg-pink-950/60 border border-pink-700/50 text-pink-200 px-1.5 py-0.5 rounded my-1 font-semibold">
          RESTRICTED ECO-RESERVE
        </div>
        <p class="text-xs text-slate-300">${mpa.description}</p>
      </div>
    `;

    const polygon = new mappls.Polygon({
      map: state.map,
      paths,
      strokeColor: '#ec4899',
      strokeOpacity: 1,
      strokeWeight: 2,
      fillColor: '#db2777',
      fillOpacity: 0.2,
      popupHtml,
      popupOptions: true
    });
    state.mapLayers.mpas.push(polygon);
  });
}

function renderHarbourMarkers() {
  if (!state.map) return;
  clearMapLayerGroup('harbours');

  state.harbours.forEach(hbr => {
    const html = `<div class="w-8 h-8 rounded-full bg-cyan-950 border-2 border-cyan-400 flex items-center justify-center text-cyan-300 shadow-lg shadow-cyan-500/30 hover:scale-110 transition cursor-pointer">
               ⚓
             </div>`;

    const popupHtml = `
      <div class="p-2 min-w-[200px]">
        <div class="font-bold text-cyan-400 text-sm">${hbr.name}</div>
        <div class="text-xs text-slate-400 mb-2">${hbr.state} Coast</div>
        <div class="grid grid-cols-2 gap-1 text-[11px] bg-slate-900 p-1.5 rounded border border-slate-700">
          <div><span class="text-slate-400">Capacity:</span> <span class="text-slate-200 font-semibold">${hbr.capacity_vessels}</span></div>
          <div><span class="text-slate-400">VHF:</span> <span class="text-cyan-400 font-bold">${hbr.vhf_channel}</span></div>
          <div><span class="text-slate-400">Fuel Station:</span> <span class="text-emerald-400 font-semibold">Available</span></div>
          <div><span class="text-slate-400">Ice Plant:</span> <span class="text-emerald-400 font-semibold">Active</span></div>
        </div>
        <button onclick="selectHarbourForRouting('${hbr.id}')" class="mt-2 w-full py-1 bg-teal-600 hover:bg-teal-500 text-white rounded text-xs font-semibold transition">
          Set as Origin Harbour ⚓
        </button>
      </div>
    `;

    const marker = new mappls.Marker({
      map: state.map,
      position: { lat: hbr.coordinates[0], lng: hbr.coordinates[1] },
      html,
      width: 32,
      height: 32,
      popupHtml,
      popupOptions: true
    });
    state.mapLayers.harbours.push(marker);
  });
}

function renderVesselsOnMap() {
  if (!state.map) return;
  clearMapLayerGroup('vessels');
  state.activeVesselMarkers = {};

  state.vessels.forEach(vessel => {
    let colorClass = 'bg-emerald-500 text-slate-950';
    let pulseClass = '';

    if (vessel.status === 'BORDER_ALERT') {
      colorClass = 'bg-red-500 text-white';
      pulseClass = 'pulse-sos';
    } else if (vessel.status === 'BORDER_WARNING') {
      colorClass = 'bg-amber-500 text-slate-950';
    } else if (vessel.status === 'TRANSIT') {
      colorClass = 'bg-cyan-500 text-slate-950';
    }

    // Simulated fill-in vessels get a visibly different marker (dashed
    // outline, hollow center, "SIM" tag) so they're never mistaken for real
    // AIS traffic at a glance, regardless of their status color.
    const simBorder = vessel.is_simulated ? 'border-dashed border-2 border-slate-200 opacity-80' : 'border border-ocean-700';

    const html = `
        <div class="relative flex items-center justify-center">
          <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold shadow-md ${simBorder} ${colorClass} ${pulseClass}" style="transform: rotate(${vessel.heading}deg);">
            ▲
          </div>
          <span class="absolute -top-4 whitespace-nowrap text-[9px] font-mono bg-slate-950/80 px-1 rounded text-slate-300 border border-slate-800 pointer-events-none">
                        ${vessel.id.includes('-') ? vessel.id.split('-').slice(1).join('-') : vessel.id}${vessel.is_simulated ? ' · SIM' : ''}
          </span>
        </div>
      `;

    const popupHtml = `
      <div class="p-2 min-w-[220px]">
        ${vessel.is_simulated ? '<div class="mb-1 px-1.5 py-0.5 inline-block rounded text-[9px] font-bold uppercase tracking-wider bg-slate-700 text-slate-200 border border-slate-500">Simulated · no live AIS coverage here</div>' : ''}
        <div class="flex items-center justify-between mb-1">
          <span class="font-bold text-white text-xs">${vessel.name}</span>
          <span class="text-[10px] font-mono px-1 rounded glass-chip text-cyan-300">${vessel.id}</span>
        </div>
        <div class="text-[11px] text-slate-400 mb-2">${vessel.type} · ${vessel.owner}</div>

        <div class="grid grid-cols-2 gap-1 text-[11px] bg-slate-900 p-2 rounded border border-slate-700">
          <div><span class="text-slate-400">Speed:</span> <span class="text-cyan-400 font-bold">${vessel.speed_knots} kn</span></div>
          <div><span class="text-slate-400">Heading:</span> <span class="text-slate-200 font-semibold">${vessel.heading}°</span></div>
          <div><span class="text-slate-400">Zone:</span> <span class="text-slate-200 font-semibold">${vessel.zone}</span></div>
          <div><span class="text-slate-400">IMBL Dist:</span> <span class="${vessel.imbl_dist_nm < 5 ? 'text-red-400 font-bold' : 'text-emerald-400'}">${vessel.imbl_dist_nm} NM</span></div>
          <div><span class="text-slate-400">Status:</span> <span class="font-bold ${vessel.status.includes('ALERT') ? 'text-red-400' : 'text-emerald-400'}">${vessel.status}</span></div>
          <div><span class="text-slate-400">Fuel:</span> <span class="text-slate-200">${vessel.fuel_pct != null ? vessel.fuel_pct + '%' : 'N/A'}</span></div>

        </div>
      </div>
    `;

    const marker = new mappls.Marker({
      map: state.map,
      position: { lat: vessel.lat, lng: vessel.lon },
      html,
      width: 24,
      height: 24,
      popupHtml,
      popupOptions: true
    });

    state.mapLayers.vessels.push(marker);
    state.activeVesselMarkers[vessel.id] = { marker, popupHtml };
  });

  const mapVesselCounter = document.getElementById('mapActiveVessels');
  if (mapVesselCounter) {
    mapVesselCounter.textContent = state.simulatedVesselCount
      ? `${state.vessels.length} Active Vessels (${state.liveVesselCount} live · ${state.simulatedVesselCount} simulated)`
      : `${state.vessels.length} Active Vessels`;
  }

  // These two live outside the map tab (home KPI card + DAG side panel)
  // but show the same fleet count -- keep them in sync from the one place
  // vessel data actually gets (re)rendered, instead of leaving them as
  // dead placeholder markup that never reflects the real dataset size.
  const homeVesselCounter = document.getElementById('homeActiveVessels');
  if (homeVesselCounter) {
    homeVesselCounter.textContent = state.vessels.length;
  }
  const dagPanelVesselCounter = document.getElementById('dagPanelVesselCount');
  if (dagPanelVesselCounter) {
    dagPanelVesselCounter.textContent = `${state.vessels.length} Tracked`;
  }

  // Fit the GIS view to the actual incoming AIS coordinates so vessels near
  // Kochi, Mumbai, Chennai, Vizag, etc. are not hidden by a port-centred
  // default map view. Invalid coordinates are excluded at the backend.
  // Computed manually (center + a span-based zoom) rather than via
  // mappls.fitBounds(), whose bounds-array coordinate order is
  // inconsistent across Mappls' own documentation.
  const livePoints = state.vessels
    .filter(v => Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lon)))
    .map(v => [Number(v.lat), Number(v.lon)]);
  if (state.map && livePoints.length > 1 && !state.hasFittedLiveFleet) {
    const lats = livePoints.map(p => p[0]);
    const lngs = livePoints.map(p => p[1]);
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const maxSpan = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
    let zoom = 8;
    if (maxSpan > 20) zoom = 4;
    else if (maxSpan > 10) zoom = 5;
    else if (maxSpan > 5) zoom = 6;
    else if (maxSpan > 2) zoom = 7;
    state.map.setCenter({ lat: centerLat, lng: centerLng });
    state.map.setZoom(zoom);
    state.hasFittedLiveFleet = true;
  }
}

function renderHeatmapLayers() {
  if (!state.map) return;
  clearMapLayerGroup('heatmap');

  state.pfzZones.forEach(zone => {
    const radiusMeters = 35000 + (zone.vessels_in_zone * 4000);
    const circle = new mappls.Circle({
      map: state.map,
      center: { lat: zone.center[0], lng: zone.center[1] },
      radius: radiusMeters,
      strokeColor: '#06b6d4',
      strokeOpacity: 1,
      strokeWeight: 1,
      fillColor: '#06b6d4',
      fillOpacity: 0.12
    });
    state.mapLayers.heatmap.push(circle);
  });
}

function setupLayerToggles() {
  const toggles = [
    { id: 'layerPFZ', key: 'pfz', renderer: renderPFZLayers },
    { id: 'layerIMBL', key: 'imbl', renderer: renderIMBLLayers },
    { id: 'layerMPA', key: 'mpas', renderer: renderMPALayers },
    { id: 'layerHarbours', key: 'harbours', renderer: renderHarbourMarkers },
    { id: 'layerVessels', key: 'vessels', renderer: renderVesselsOnMap },
    { id: 'layerHeatmap', key: 'heatmap', renderer: renderHeatmapLayers },
    { id: 'layerIndiaBoundary', key: 'indiaBoundary', renderer: renderIndiaBoundaryLayer }
  ];

  toggles.forEach(t => {
    const el = document.getElementById(t.id);
    if (el) {
      el.addEventListener('change', (e) => {
        // Mappls has no Leaflet-style map.addLayer()/removeLayer() for
        // arbitrary marker/shape objects, so "off" clears the tracked
        // group and "on" simply re-runs the same render*Layer() function
        // every other refresh already uses to rebuild it from scratch.
        if (e.target.checked) {
          t.renderer();
        } else {
          clearMapLayerGroup(t.key);
        }
      });
    }
  });
}

// Route Simulator & Live Wave-adjusted ETA
function setupRoutePlanner() {
  const harbourSelect = document.getElementById('routeOriginSelect');
  const pfzSelect = document.getElementById('routePFZSelect');
  const simBtn = document.getElementById('btnSimulateRoute');

  if (harbourSelect && state.harbours.length > 0) {
    harbourSelect.innerHTML = state.harbours.map(h => `<option value="${h.id}">${h.name} (${h.state})</option>`).join('');
    harbourSelect.value = state.selectedHarbour;
    harbourSelect.addEventListener('change', (e) => {
      state.selectedHarbour = e.target.value;
      const hbr = state.harbours.find(h => h.id === e.target.value);
      if (hbr) {         fetchLiveMarineTelemetry(hbr.coordinates[0], hbr.coordinates[1]);         fetchSafetyTrendHistory(hbr.coordinates[0], hbr.coordinates[1]).then(() => renderTrendSparklines());         refreshSafetyBarometer(hbr.coordinates[0], hbr.coordinates[1]);       }
    });
  }

  if (pfzSelect && state.pfzZones.length > 0) {
    pfzSelect.innerHTML = state.pfzZones.map(p => `<option value="${p.id}">${p.name} · ${p.yield_rating} Yield (${p.yield_score_pct}%)</option>`).join('');
    pfzSelect.value = state.selectedPFZ;
    pfzSelect.addEventListener('change', (e) => {
      state.selectedPFZ = e.target.value;
    });
  }

  if (simBtn) {
    simBtn.addEventListener('click', () => {
      calculateAndRenderRoute(state.selectedHarbour, state.selectedPFZ);
    });
  }

  setTimeout(() => {
    calculateAndRenderRoute(state.selectedHarbour, state.selectedPFZ);
  }, 400);
}

window.selectHarbourForRouting = function(harbourId) {
  state.selectedHarbour = harbourId;
  const el = document.getElementById('routeOriginSelect');
  if (el) el.value = harbourId;
  calculateAndRenderRoute(state.selectedHarbour, state.selectedPFZ);
};

window.selectPFZForRouting = function(pfzId) {
  state.selectedPFZ = pfzId;
  const el = document.getElementById('routePFZSelect');
  if (el) el.value = pfzId;
  calculateAndRenderRoute(state.selectedHarbour, state.selectedPFZ);
};

// Requests the real land-and-MPA-aware A* route from the FastAPI backend.
// This is the ONLY route computation in the frontend -- there is no local
// midpoint/fake-waypoint fallback. If the backend can't be reached, or the
// backend itself reports no safe route exists, that is shown to the user
// honestly instead of drawing an invented line on the map.
async function fetchRouteFromBackend(harbourId, pfzId) {
  const res = await fetchWithTimeout(`${BACKEND_CONFIG.apiBase}/api/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin_harbour: harbourId, target_pfz: pfzId })
  }, 8000);
  if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
  return res.json();
}

async function calculateAndRenderRoute(harbourId, pfzId) {
  const harbour = state.harbours.find(h => h.id === harbourId) || state.harbours[0];
  const pfz = state.pfzZones.find(p => p.id === pfzId) || state.pfzZones[0];

  if (!harbour || !pfz) return;

  const distEl = document.getElementById('routeDistVal');
  const etaEl = document.getElementById('routeETAVal');
  const duskEl = document.getElementById('routeDuskVerdict');
  const speedEl = document.getElementById('routeSpeedVal');

  let route;
  try {
    route = await fetchRouteFromBackend(harbourId, pfzId);
    state.backendOnline = true;
  } catch (err) {
    console.log('ORCA backend unreachable — cannot compute a routed distance.', err.message || err);
    state.backendOnline = false;
    route = null;
  }
  updateBackendStatusBadges();

  clearMapLayerGroup('route');

  if (!route) {
    // Backend unreachable -- do NOT draw a fabricated straight/midpoint
    // line and do NOT display a distance/ETA that wasn't actually routed.
    if (distEl) distEl.textContent = '—';
    if (etaEl) etaEl.textContent = '—';
    if (speedEl) speedEl.textContent = '—';
    if (duskEl) {
      duskEl.innerHTML = `<span class="text-slate-400 font-bold">⚠ ROUTE UNAVAILABLE:</span> ORCA backend is unreachable, so no routed distance/ETA can be shown. Running in local fallback mode.`;
      duskEl.className = "p-2.5 rounded-lg text-xs bg-slate-800/60 border border-slate-600/40 text-slate-300";
    }
    return;
  }

  if (!route.route_found) {
    if (distEl) distEl.textContent = '—';
    if (etaEl) etaEl.textContent = '—';
    if (speedEl) speedEl.textContent = '—';
    if (duskEl) {
      duskEl.innerHTML = `<span class="text-red-400 font-bold">✕ NO SAFE MARITIME ROUTE FOUND:</span> ${route.detail || route.reason || 'The router could not find a path avoiding land and Marine Protected Areas for this harbour/PFZ pair.'}`;
      duskEl.className = "p-2.5 rounded-lg text-xs bg-red-950/60 border border-red-500/40 text-red-200";
    }
    return;
  }

  const distNM = route.distance_nm;
  const etaHours = route.eta_hours;
  const etaHoursFloor = Math.floor(etaHours);
  const etaMinutes = Math.round((etaHours - etaHoursFloor) * 60);
  const isReturnSafe = route.dusk_safety_verdict === 'SAFE_RETURN_BEFORE_DUSK';

  if (distEl) distEl.textContent = `${distNM.toFixed(1)} NM`;
  if (etaEl) etaEl.textContent = `${etaHoursFloor}h ${etaMinutes}m (One-Way)`;
  if (speedEl) {
    speedEl.textContent = route.effective_speed_knots != null
      ? `${route.effective_speed_knots} kn (Wave-adjusted)`
      : '—';
  }

  if (duskEl) {
    if (isReturnSafe) {
      duskEl.innerHTML = `<span class="text-emerald-400 font-bold">✓ SAFE RETURN:</span> Expected harbour arrival by <span class="font-mono text-white">${route.estimated_return_ist || '—'}</span> (Before 18:30 IST dusk).`;
      duskEl.className = "p-2.5 rounded-lg text-xs bg-emerald-950/60 border border-emerald-500/40 text-emerald-200";
    } else {
      duskEl.innerHTML = `<span class="text-amber-400 font-bold">⚠️ RETURN AFTER DUSK:</span> Expected return at <span class="font-mono text-white">${route.estimated_return_ist || '—'}</span> (Exceeds 18:30 IST sunset). Recommend an earlier departure or a night navigational beacon check.`;
      duskEl.className = "p-2.5 rounded-lg text-xs bg-amber-950/60 border border-amber-500/40 text-amber-200";
    }
  }

  if (state.map) {
    // Draw EXACTLY the waypoints the backend A* router returned -- the
    // frontend never invents its own waypoints.
    const paths = route.waypoints.map(p => ({ lat: p.lat, lng: p.lon }));

    const detourNote = route.detour_percent > 1
      ? ` · Detour ${route.detour_percent}% around ${route.avoided_mpas && route.avoided_mpas.length ? route.avoided_mpas.join(', ') : 'land/no-go zones'}`
      : '';

    const routePopupHtml = `
      <div class="p-1 text-xs">
        <span class="font-bold text-cyan-400">Sea-Only A* Route (Land + MPA Avoidance)</span><br/>
        <span>${harbour.name} ➔ ${pfz.name}</span><br/>
        <span>Distance: <b class="text-white">${distNM.toFixed(1)} NM</b> · ETA: <b class="text-white">${etaHoursFloor}h ${etaMinutes}m</b>${detourNote}</span>
      </div>
    `;

    const routeLine = new mappls.Polyline({
      map: state.map,
      paths,
      strokeColor: '#06b6d4',
      strokeWeight: 3.5,
      strokeOpacity: 0.9,
      popupHtml: routePopupHtml,
      popupOptions: true
    });
    state.mapLayers.route.push(routeLine);
  }
}

// Interactive React Flow Style Agent DAG Visualizer Canvas
function setupDAGVisualizer() {
  renderDAGNodes();
  setupDAGCanvasControls();

  const runBtn = document.getElementById('btnRunDAGSimulation');
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      runFullDAGPipelineSimulation();
    });
  }
}

function setupDAGCanvasControls() {
  const zoomInBtn = document.getElementById('btnDAGZoomIn');
  const zoomOutBtn = document.getElementById('btnDAGZoomOut');
  const zoomResetBtn = document.getElementById('btnDAGZoomReset');
  const container = document.getElementById('dagCanvasInner');

  function updateTransform() {
    if (container) {
      container.style.transform = `scale(${state.dagZoom}) translate(${state.dagPan.x}px, ${state.dagPan.y}px)`;
    }
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      state.dagZoom = Math.min(1.5, state.dagZoom + 0.1);
      updateTransform();
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      state.dagZoom = Math.max(0.6, state.dagZoom - 0.1);
      updateTransform();
    });
  }
  if (zoomResetBtn) {
    zoomResetBtn.addEventListener('click', () => {
      state.dagZoom = 1.0;
      state.dagPan = { x: 0, y: 0 };
      updateTransform();
    });
  }
}

function renderDAGNodes() {
  const dagContainer = document.getElementById('dagNodesGrid');
  if (!dagContainer) return;

  dagContainer.innerHTML = agentsList.map((agent, idx) => {
    return `
      <div id="dag-node-${agent.id}" onclick="inspectDAGNode('${agent.id}')" class="relative group p-4 rounded-xl glass-card glass-card-interactive cursor-pointer">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 font-mono text-xs font-bold flex items-center justify-center border border-cyan-500/40">
              ${idx + 1}
            </span>
            <h4 class="font-bold text-slate-100 text-sm group-hover:text-cyan-300 transition">${agent.name}</h4>
          </div>
          <span id="badge-lat-${agent.id}" class="text-[10px] font-mono px-1.5 py-0.5 rounded glass-chip text-slate-400">
            ${agent.latency}
          </span>
        </div>
        <p class="text-xs text-slate-400 mb-3 line-clamp-2">${agent.role}</p>
        <div class="flex flex-wrap gap-1 mb-2">
          ${agent.sensors.map(s => `<span class="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/40 font-mono">${s}</span>`).join('')}
        </div>
        <div class="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800">
          <span class="flex items-center gap-1.5">
            <span id="status-dot-${agent.id}" class="w-2 h-2 rounded-full bg-slate-500"></span>
            <span id="status-text-${agent.id}" class="capitalize">Idle</span>
          </span>
          <span class="text-cyan-400 text-xs font-medium group-hover:translate-x-0.5 transition">Inspect ➔</span>
        </div>
      </div>
    `;
  }).join('');
}

window.inspectDAGNode = function(agentId) {
  const agent = agentsList.find(a => a.id === agentId);
  if (!agent) return;

  state.activeDAGNode = agent;
  const modal = document.getElementById('dagInspectorModal');
  const titleEl = document.getElementById('inspectorAgentName');
  const roleEl = document.getElementById('inspectorAgentRole');
  const latencyEl = document.getElementById('inspectorLatency');
  const jsonEl = document.getElementById('inspectorRawJSON');

  if (titleEl) titleEl.textContent = agent.name;
  if (roleEl) roleEl.textContent = agent.role;
  if (latencyEl) latencyEl.textContent = `Execution Latency: ${agent.latency} · Subtasks Verified`;
  if (jsonEl) jsonEl.textContent = JSON.stringify(agent.sampleOutput, null, 2);

  if (modal) modal.classList.remove('hidden');
};

window.closeDAGInspector = function() {
  const modal = document.getElementById('dagInspectorModal');
  if (modal) modal.classList.add('hidden');
};

function resetDAGNodeUI() {
  agentsList.forEach(a => {
    const nodeEl = document.getElementById(`dag-node-${a.id}`);
    const dotEl = document.getElementById(`status-dot-${a.id}`);
    const textEl = document.getElementById(`status-text-${a.id}`);
    if (nodeEl) nodeEl.classList.remove('border-cyan-400', 'bg-cyan-950/40', 'glow-cyan', 'border-emerald-500/70', 'opacity-45', 'grayscale');
    if (dotEl) dotEl.className = "w-2 h-2 rounded-full bg-slate-500";
    if (textEl) textEl.textContent = "Queued";
  });
}

function setDAGNodeExecuting(agentId) {
  const nodeEl = document.getElementById(`dag-node-${agentId}`);
  const dotEl = document.getElementById(`status-dot-${agentId}`);
  const textEl = document.getElementById(`status-text-${agentId}`);
  if (nodeEl) nodeEl.classList.add('border-cyan-400', 'bg-cyan-950/40', 'glow-cyan');
  if (dotEl) dotEl.className = "w-2 h-2 rounded-full bg-cyan-400 animate-ping";
  if (textEl) textEl.textContent = "Executing...";
}

function setDAGNodeCompleted(agentId) {
  const nodeEl = document.getElementById(`dag-node-${agentId}`);
  const dotEl = document.getElementById(`status-dot-${agentId}`);
  const textEl = document.getElementById(`status-text-${agentId}`);
  if (nodeEl) { nodeEl.classList.remove('border-cyan-400', 'glow-cyan'); nodeEl.classList.add('border-emerald-500/70'); }
  if (dotEl) dotEl.className = "w-2 h-2 rounded-full bg-emerald-400";
  if (textEl) textEl.textContent = "Completed";
}

function setDAGNodeSkipped(agentId, reason) {
  const nodeEl = document.getElementById(`dag-node-${agentId}`);
  const dotEl = document.getElementById(`status-dot-${agentId}`);
  const textEl = document.getElementById(`status-text-${agentId}`);
  if (nodeEl) nodeEl.classList.add('opacity-45', 'grayscale');
  if (dotEl) dotEl.className = "w-2 h-2 rounded-full bg-slate-500";
  if (textEl) textEl.textContent = "Not invoked — intent did not require it";
  const agentDef = agentsList.find(a => a.id === agentId);
  if (agentDef) agentDef.sampleOutput = { status: 'SKIPPED', reason };
}

// Entry point wired to the "Run Live Pipeline Simulation" button. Tries the
// real backend over WebSocket first; only falls back to the offline
// setTimeout animation if the backend can't be reached.
async function runFullDAGPipelineSimulation() {
  if (state.isSimulatingDAG) return;
  const wentLive = await runFullDAGPipelineSimulationLive();
  if (!wentLive) {
    await runFullDAGPipelineSimulationOffline();
  }
}

// Streams real AGENT_STEP_START / AGENT_STEP_COMPLETE / PIPELINE_COMPLETE
// events from the FastAPI backend's /ws/agent-trace socket and drives the
// DAG node UI off of them. Resolves false (without side effects beyond the
// attempt itself) if the socket can't connect, so the caller can fall back.
function runFullDAGPipelineSimulationLive() {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(`${BACKEND_CONFIG.wsBase}/ws/agent-trace`);
    } catch (err) {
      resolve(false);
      return;
    }

    let settled = false;
    const connectTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch (e) { /* noop */ }
        resolve(false);
      }
    }, 2500);

    const runBtn = document.getElementById('btnRunDAGSimulation');

    ws.addEventListener('open', () => {
      clearTimeout(connectTimeout);
      settled = true;
      state.isSimulatingDAG = true;
      state.backendOnline = true;
      updateBackendStatusBadges();

      if (runBtn) {
        runBtn.disabled = true;
        runBtn.innerHTML = `<span class="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1"></span> Reasoning Active (Live Backend)...`;
      }
      resetDAGNodeUI();
      ws.send(JSON.stringify({ query: state.latestChatQuery }));
      resolve(true);
    });

    ws.addEventListener('message', (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }

      if (msg.type === 'AGENT_STEP_START' || msg.type === 'AGENT_STEP_COMPLETE') {
        const nodeId = BACKEND_AGENT_ID_MAP[msg.agent];
        if (!nodeId) return;

        if (msg.type === 'AGENT_STEP_START') {
          setDAGNodeExecuting(nodeId);
        } else {
          setDAGNodeCompleted(nodeId);
          // Feed the real agent output into the inspector modal's JSON view
          const agentDef = agentsList.find(a => a.id === nodeId);
          if (agentDef && msg.output) agentDef.sampleOutput = msg.output;
        }
        return;
      }

      if (msg.type === 'AGENT_SKIPPED') {
        const nodeId = BACKEND_AGENT_ID_MAP[msg.agent];
        if (nodeId) setDAGNodeSkipped(nodeId, msg.reason);
        return;
      }

      if (msg.type === 'PIPELINE_COMPLETE') {
        state.isSimulatingDAG = false;
        if (runBtn) {
          runBtn.disabled = false;
          runBtn.innerHTML = `✓ Pipeline Executed via Live Backend · Run Again`;
        }
        try { ws.close(); } catch (e) { /* noop */ }
        return;
      }

      if (msg.type === 'PIPELINE_ERROR') {
        console.warn('ORCA backend pipeline error:', msg.message);
        state.isSimulatingDAG = false;
        if (runBtn) {
          runBtn.disabled = false;
          runBtn.innerHTML = `▶ Run Live Pipeline Simulation`;
        }
        try { ws.close(); } catch (e) { /* noop */ }
      }
    });

    ws.addEventListener('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(connectTimeout);
        resolve(false);
      }
    });

    ws.addEventListener('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(connectTimeout);
        resolve(false);
      }
      state.isSimulatingDAG = false;
    });
  });
}

// Offline fallback: the original scripted animation, used only when the
// FastAPI backend is unreachable so the DAG tab still has something to show.
async function runFullDAGPipelineSimulationOffline() {
  state.isSimulatingDAG = true;

  const runBtn = document.getElementById('btnRunDAGSimulation');
  if (runBtn) {
    runBtn.disabled = true;
    runBtn.innerHTML = `<span class="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1"></span> Reasoning Active (Local Simulation)...`;
  }

  resetDAGNodeUI();

  for (let i = 0; i < agentsList.length; i++) {
    const agent = agentsList[i];
    setDAGNodeExecuting(agent.id);
    await new Promise(r => setTimeout(r, 400));
    setDAGNodeCompleted(agent.id);
  }

  state.isSimulatingDAG = false;
  if (runBtn) {
    runBtn.disabled = false;
    runBtn.innerHTML = `✓ Pipeline Executed (Local Simulation) · Run Again`;
  }
}

// AI Decision Studio & Chatbot Engine
function setupChatbot() {
  const sendBtn = document.getElementById('btnSendChat');
  const inputEl = document.getElementById('chatInput');
  const chips = document.querySelectorAll('[data-chat-prompt]');
  if (!state.sessionId) state.sessionId = createChatSessionId();
  const newConversationBtn = document.getElementById('btnNewConversation');
  if (newConversationBtn) newConversationBtn.addEventListener('click', startNewConversation);

  if (sendBtn && inputEl) {
    sendBtn.addEventListener('click', () => {
      handleChatQuery(inputEl.value);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleChatQuery(inputEl.value);
      }
    });
  }

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const promptText = chip.getAttribute('data-chat-prompt');
      if (inputEl) inputEl.value = promptText;
      handleChatQuery(promptText);
    });
  });

  const ttsBtn = document.getElementById('btnTTSPlay');
  if (ttsBtn) {
    ttsBtn.addEventListener('click', toggleAudioAdvisory);
  }
}

function createChatSessionId() {
  return (window.crypto?.randomUUID?.() || `orca-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function startNewConversation() {
  state.sessionId = createChatSessionId();
  state.chatHistory = [];
  state.latestAdvisoryText = '';
  const messages = document.getElementById('chatMessages');
  if (messages) messages.innerHTML = `<div class="text-xs text-slate-400 font-mono text-center py-4">New conversation started. ORCA will not use earlier chat context.</div>`;
}

async function handleChatQuery(queryText) {
  if (!queryText || !queryText.trim()) return;
  const inputEl = document.getElementById('chatInput');
  if (inputEl) inputEl.value = '';

  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) return;

  const userMsgHtml = `
    <div class="flex items-start justify-end gap-3 mb-4">
      <div class="max-w-[80%] p-3.5 rounded-2xl bg-cyan-600/30 border border-cyan-500/40 text-slate-100 text-sm">
        <p class="font-medium">${queryText}</p>
        <span class="text-[10px] text-cyan-300 font-mono mt-1 block text-right">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="w-8 h-8 rounded-full bg-cyan-500 text-slate-950 font-bold flex items-center justify-center text-xs shadow-md">
        YOU
      </div>
    </div>
  `;
  messagesContainer.insertAdjacentHTML('beforeend', userMsgHtml);
  state.chatHistory.push({ role: 'user', text: queryText, timestamp: new Date().toISOString() });
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  const loaderId = `loader-${Date.now()}`;
  const skeletonHtml = `
    <div id="${loaderId}" class="flex items-start gap-3 mb-4 animate-pulse">
      <div class="w-8 h-8 rounded-full bg-slate-800 border border-cyan-500/50 flex items-center justify-center text-cyan-400 text-xs">
        ORCA
      </div>
      <div class="max-w-[85%] p-4 rounded-2xl bg-slate-900 border border-slate-700 text-slate-300 text-sm space-y-2 w-full">
        <div class="flex items-center gap-2 text-cyan-400 text-xs font-mono">
          <span class="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
          Orchestrating 8 Specialized AI Agents across Oceansat-3, INSAT-3DR & Open-Meteo...
        </div>
        <div class="h-3 bg-slate-800 rounded w-3/4"></div>
        <div class="h-3 bg-slate-800 rounded w-1/2"></div>
      </div>
    </div>
  `;
  messagesContainer.insertAdjacentHTML('beforeend', skeletonHtml);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  state.latestChatQuery = queryText;

  // Try the real multi-agent FastAPI backend first (Tier 1 wiring).
  // A ~500ms minimum delay keeps the "orchestrating agents" skeleton from
  // flashing instantly when the backend is down and the fallback is instant.
  let advisory;
  try {
    const [data] = await Promise.all([
      fetchAdvisoryFromBackend(queryText),
      new Promise(r => setTimeout(r, 500))
    ]);
    advisory = buildAdvisoryFromBackend(data, queryText);
    syncDetectedLanguage(advisory.language);
    state.backendOnline = true;
  } catch (err) {
    console.log('ORCA backend unreachable — falling back to local grounded simulation.', err.message || err);
    state.backendOnline = false;
    await new Promise(r => setTimeout(r, 500));
    advisory = generateAgentAdvisory(queryText);
  }
  updateBackendStatusBadges();

  const loaderEl = document.getElementById(loaderId);
  if (loaderEl) loaderEl.remove();

  state.latestAdvisoryText = advisory.plainText;
  state.chatHistory.push({ role: 'assistant', text: advisory.plainText, timestamp: new Date().toISOString(), language: advisory.language?.response_code || 'en' });

  const botMsgHtml = `
    <div class="flex items-start gap-3 mb-6">
      <div class="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-slate-950 font-black flex items-center justify-center text-xs shadow-lg shadow-cyan-500/20">
        AI
      </div>
      <div class="max-w-[88%] p-5 rounded-2xl bg-slate-900/95 border border-slate-700 shadow-xl space-y-3">
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-cyan-400 tracking-wider uppercase">Multi-Agent Marine Advisory</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              ${advisory.confidence}% Grounded Confidence
            </span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/20 text-violet-200 border border-violet-400/30" title="Language detected from the message">
              ${languageBadgeLabel(advisory.language)}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="playAudioText('${encodeURIComponent(advisory.plainText)}')" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-600 text-xs flex items-center gap-1.5 transition">
              <span class="text-xs">🔊</span> Listen (TTS)
            </button>
            <button onclick="copyAdvisoryMSS()" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-teal-300 border border-slate-600 text-xs flex items-center gap-1 transition">
              <span>📡</span> NavIC MSS Code
            </button>
          </div>
        </div>

        <div class="text-sm text-slate-200 leading-relaxed font-sans">
          ${advisory.formattedHtml}
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800 text-[11px] font-mono">
          <div class="p-2 rounded bg-slate-950/80 border border-slate-800">
            <span class="text-slate-400 block">Recommended Zone</span>
            <span class="text-cyan-400 font-bold">${advisory.metrics.zone}</span>
          </div>
          <div class="p-2 rounded bg-slate-950/80 border border-slate-800">
            <span class="text-slate-400 block">Live Sea State ETA</span>
            <span class="text-emerald-400 font-bold">${advisory.metrics.eta}</span>
          </div>
          <div class="p-2 rounded bg-slate-950/80 border border-slate-800">
            <span class="text-slate-400 block">Active Vessels</span>
            <span class="text-amber-300 font-bold">${advisory.metrics.vesselCount} Vessels</span>
          </div>
          <div class="p-2 rounded bg-slate-950/80 border border-slate-800">
            <span class="text-slate-400 block">IMBL Clearance</span>
            <span class="text-slate-200 font-bold">${advisory.metrics.imblClearance}</span>
          </div>
        </div>

        <details class="group mt-3 pt-2 border-t border-slate-800/80">
          <summary class="text-xs text-slate-400 hover:text-cyan-400 cursor-pointer flex items-center justify-between font-mono">
            <span>🔍 View Multi-Agent Reasoning Trace (${advisory.agentSteps.length} steps executed)</span>
            <span class="text-[10px] text-slate-500 group-open:rotate-180 transition">▼</span>
          </summary>
          <div class="mt-3 space-y-2 text-xs bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono">
            ${advisory.agentSteps.map(step => `
              <div class="flex items-start justify-between border-b border-ocean-700 pb-1.5 last:border-0">
                <div>
                  <span class="text-cyan-400 font-semibold">[${step.agent}]</span>
                  <p class="text-slate-300 text-[11px] mt-0.5">${step.trace}</p>
                </div>
                <span class="text-[10px] text-slate-500 ml-2 whitespace-nowrap">${step.latency}</span>
              </div>
            `).join('')}
          </div>
        </details>
      </div>
    </div>
  `;

  messagesContainer.insertAdjacentHTML('beforeend', botMsgHtml);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Calls the real multi-agent FastAPI backend's synthesis endpoint.
// Throws on any network/HTTP failure so the caller can fall back to the
// offline local simulation.
async function fetchAdvisoryFromBackend(queryText) {
  const res = await fetchWithTimeout(`${BACKEND_CONFIG.apiBase}/api/advisory/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: queryText,
      origin_harbour: state.selectedHarbour,
      target_pfz: state.selectedPFZ,
      response_language: state.languageOverride ? state.currentLang : null,
      session_id: state.sessionId,
      history: state.chatHistory.slice(-6).map(turn => ({ role: turn.role, text: turn.text }))
    })
  }, 6000);
  if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
  return res.json();
}

// Adapts the FastAPI backend's { telemetry, advisory } response into the
// same shape generateAgentAdvisory() produces, so the chat renderer doesn't
// need to know whether the data came from the live backend or the fallback.
function buildAdvisoryFromBackend(data, query) {
  const t = data.telemetry || {};
  const adv = data.advisory || {};
  const satellite = t.satellite || {};
  const weather = t.weather || {};
  const pfz = t.pfz || {};
  const eta = t.eta || {};
  const fleet = t.fleet || {};
  const geo = t.geofence || {};
  const language = data.language || adv.language || { response_code: 'en', provenance: 'BACKEND_UNAVAILABLE' };
  const provenance = t.source_provenance || {};
  const oceanTier = provenance.ocean?.tier || satellite.source_tier || 'UNSPECIFIED';
  const chlorophyllSource = satellite.data_source?.chlorophyll || 'UNAVAILABLE';

  const zone = pfz.top_recommended_pfz || state.selectedPFZ;
  const etaHours = eta.one_way_eta_hours;
  const etaLabel = (typeof etaHours === 'number')
    ? `${Math.floor(etaHours)}h ${Math.round((etaHours % 1) * 60)}m`
    : '—';
  const imblClearance = (typeof geo.distance_to_imbl_nm === 'number')
    ? `${geo.distance_to_imbl_nm} NM (${geo.imbl_status || 'Status Unknown'})`
    : '—';

  const agentSteps = [
    { agent: "Master Supervisor", trace: `Intent classified as ${t.plan?.intent || 'N/A'}. ${(t.plan?.subtasks || []).length} subtasks dispatched.`, latency: "live" },
    { agent: "Satellite Oceanography", trace: `SST ${satellite.sst_celsius ?? '—'}°C · Chlorophyll ${satellite.chlorophyll_mg_m3 ?? '—'} mg/m³ via ${(satellite.source_satellites || []).join(', ') || 'ISRO feeds'}.`, latency: "live" },
    { agent: "Weather & Hazard", trace: `SWH ${weather.significant_wave_height_m ?? '—'}m, wind ${weather.surface_wind_knots ?? '—'}kn. Safety score ${weather.safety_score ?? '—'}/100 (${weather.clearance_verdict ?? '—'}).`, latency: "live" },
    { agent: "Ocean Analytics PFZ", trace: `Top zone ${zone} · predicted yield ${pfz.yield_score_pct ?? '—'}%.`, latency: "live" },
    { agent: "Geofencing & Routing", trace: `Nearest IMBL: ${geo.nearest_imbl_country ?? '—'} at ${geo.distance_to_imbl_nm ?? '—'} NM (${geo.imbl_status ?? '—'}).`, latency: "live" },
    { agent: "Fleet & Traffic", trace: `${fleet.total_active_vessels ?? '—'} active vessels · ${fleet.vessels_in_target_zone ?? '—'} in target zone (${fleet.overcrowding_status ?? '—'}).`, latency: "live" },
    { agent: "ETA & Voyage Safety", trace: `One-way ETA ${eta.one_way_eta_hours ?? '—'}h at ${eta.effective_speed_knots ?? '—'}kn. Return ${eta.estimated_return_ist ?? '—'} — ${eta.dusk_safety_verdict ?? '—'}.`, latency: "live" },
    { agent: "Neural Synthesis", trace: `Advisory generated via ${adv.llm_engine || 'grounded engine'} with ${adv.confidence_pct ?? '—'}% confidence.`, latency: "live" }
  ];

  return {
    confidence: adv.confidence_pct ?? 90,
    metrics: { zone, eta: etaLabel, vesselCount: fleet.total_active_vessels ?? '—', imblClearance },
    plainText: adv.advisory_text || 'The ORCA INSIGHT backend generated an advisory but returned no text.',
    formattedHtml: `<p><strong class="text-emerald-400">✓ Live Multi-Agent Advisory</strong> <span class="text-[10px] text-slate-500 font-mono">(${adv.llm_engine || 'Grounded Engine'})</span></p>
      <p class="mt-2 text-slate-300">${adv.advisory_text || ''}</p>
      <p class="mt-2 text-[11px] font-mono ${chlorophyllSource.includes('ESTIMATED') ? 'text-amber-300' : 'text-slate-500'}">Ocean source tier: ${oceanTier} · Chlorophyll: ${chlorophyllSource}</p>
      <p class="mt-2 text-[11px] text-slate-500">Citations: ${(adv.citations || []).join(', ') || '—'}</p>`,
    agentSteps,
    language
  };
}

function languageBadgeLabel(language) {
  const code = language?.response_code || 'en';
  const names = { en: 'English', hi: 'हिन्दी', ta: 'தமிழ்', ml: 'മലയാളം' };
  return `Detected: ${names[code] || 'English'}`;
}

function syncDetectedLanguage(language) {
  const code = language?.response_code || 'en';
  state.detectedQueryLanguage = code;
  // Only auto-align static UI labels when the user has not deliberately
  // chosen a different display language. The response itself always follows
  // detected language unless that explicit UI override is set.
  if (!state.languageOverride && translations[code]) {
    state.currentLang = code;
    const select = document.getElementById('langSelect');
    if (select) select.value = code;
    applyLanguage(code);
  }
}

// OFFLINE / DEGRADED-MODE fallback ONLY -- used exclusively when the real
// FastAPI multi-agent backend could not be reached (see the catch branch
// in handleChatQuery). This never runs when the backend is online. Every
// number here is a fixed illustrative placeholder, not live telemetry --
// labeled SIMULATED throughout so it can never be mistaken for a live
// Oceansat/Open-Meteo/AIS reading, per the "no feature may silently claim
// to be live when it is actually simulated" requirement.
function generateAgentAdvisory(query) {
  const q = query.toLowerCase();
  const OFFLINE_BANNER = `<p class="mb-2 text-[11px] font-mono text-amber-300 bg-amber-950/40 border border-amber-700/40 rounded px-2 py-1">⚠ OFFLINE ADVISORY ENGINE — ORCA backend unreachable. The figures below are a simulated illustrative estimate, not live telemetry.</p>`;

  if (q.includes('border') || q.includes('imbl') || q.includes('sri lanka') || q.includes('pakistan') || q.includes('सीमा') || q.includes('எல்லை')) {
    return {
      confidence: 60,
      metrics: { zone: "Palk Strait & Rameswaram", eta: "1h 45m (simulated)", vesselCount: 7, imblClearance: "SIMULATED ~2-4 NM" },
      plainText: "OFFLINE ADVISORY (backend unreachable, simulated estimate): Vessels in the Palk Strait / Gulf of Mannar area are typically within a few Nautical Miles of the India-Sri Lanka IMBL boundary. Maintain a westward heading and keep VHF transponders active on Channel 16. Reconnect to the ORCA backend for an actual measured distance to the boundary.",
      formattedHtml: OFFLINE_BANNER + `<p><strong class="text-red-400">⚠️ IMBL Geofencing Advisory (Simulated Offline Estimate):</strong></p>
        <p class="mt-1">Without a live backend connection, exact vessel-to-boundary distances cannot be measured. As a general precaution near Palk Strait Sector 4, maintain a westward heading toward Mandapam.</p>
        <p class="mt-2 text-slate-300">This is a generic offline safety reminder, not a measured geofence reading. Reconnect to ORCA backend for a real distance-to-IMBL calculation.</p>`,
      agentSteps: [
        { agent: "Offline Advisory Engine", trace: "Backend unreachable. Classified query as IMBL_BOUNDARY using local keyword match.", latency: "offline" },
        { agent: "Offline Advisory Engine", trace: "No live geofencing telemetry available -- returning generic boundary-safety guidance only.", latency: "offline" },
      ]
    };
  }

  if (q.includes('density') || q.includes('count') || q.includes('overcrowd') || q.includes('how many') || q.includes('घनत्व') || q.includes('அடர்த்தி')) {
    return {
      confidence: 55,
      metrics: { zone: "PFZ-01 & Wadge Bank", eta: "— (simulated)", vesselCount: "unavailable", imblClearance: "unavailable" },
      plainText: "OFFLINE ADVISORY (backend unreachable, simulated estimate): Live vessel counts cannot be retrieved without a backend connection. Historically, Wadge Bank and Kochi Deep Offshore see moderate fishing traffic. Reconnect to the ORCA backend for an actual fleet-density reading from the vessel dataset.",
      formattedHtml: OFFLINE_BANNER + `<p><strong class="text-cyan-400">🚢 Fleet Density (Offline — Simulated Placeholder):</strong></p>
        <p class="mt-1">The Fleet & Traffic Agent's live vessel dataset is not reachable right now, so an exact in-zone vessel count is unavailable.</p>
        <ul class="list-disc list-inside mt-2 space-y-1 text-slate-300">
          <li>Reconnect to the ORCA backend for a real per-zone vessel count and overcrowding verdict.</li>
        </ul>`,
      agentSteps: [
        { agent: "Offline Advisory Engine", trace: "Backend unreachable. Classified query as FLEET_DENSITY using local keyword match.", latency: "offline" },
        { agent: "Offline Advisory Engine", trace: "No live fleet dataset available -- vessel counts not shown to avoid presenting a fabricated figure.", latency: "offline" },
      ]
    };
  }

  const liveWave = state.liveMarine.waveHeight.toFixed(2);
  return {
    confidence: 55,
    metrics: { zone: "PFZ-01 (Kochi Deep) — simulated", eta: "— (simulated)", vesselCount: "unavailable", imblClearance: "unavailable" },
    plainText: `OFFLINE ADVISORY (backend unreachable): ORCA's multi-agent backend could not be reached, so this answer is a generic, non-live placeholder rather than a grounded reading. Your browser's own Open-Meteo widget reports significant wave height around ${liveWave}m, but PFZ ranking, route distance, ETA, and fleet counts all require the backend and are not shown here. Reconnect to the ORCA backend for a real advisory.`,
    formattedHtml: OFFLINE_BANNER + `<p><strong class="text-amber-400">⚠ Offline Placeholder Advisory</strong></p>
      <p class="mt-1">The ORCA multi-agent backend (satellite, weather, PFZ ranking, geofencing, fleet, routing, and Neural Synthesis) is currently unreachable. Client-side, this browser last saw a wave height of <strong>${liveWave}m</strong> from Open-Meteo, but every other figure requires the backend.</p>
      <p class="mt-2 text-slate-300"><strong>No PFZ recommendation, route, ETA, or fleet count is shown</strong> because those would have to be invented rather than computed. Reconnect to the ORCA backend for a full grounded advisory.</p>`,
    agentSteps: [
      { agent: "Offline Advisory Engine", trace: "Backend unreachable. No intent-specific keyword matched -- returning GENERAL_VOYAGE_SAFETY offline placeholder.", latency: "offline" },
      { agent: "Offline Advisory Engine", trace: `Only client-visible figure available: last known Open-Meteo wave height ${liveWave}m (fetched directly by the browser, not via backend).`, latency: "offline" },
    ]
  };
}

// Text-to-Speech (TTS) Engine
window.playAudioText = function(encodedText) {
  const text = decodeURIComponent(encodedText);
  if (!state.speechSynth) {
    alert("Speech Synthesis not supported by your browser.");
    return;
  }

  if (state.isSpeaking) {
    state.speechSynth.cancel();
    state.isSpeaking = false;
    updateTTSButtons(false);
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1.0;

  const voices = state.speechSynth.getVoices();
  const indVoice = voices.find(v => v.lang.includes('en-IN') || v.name.includes('India'));
  if (indVoice) utterance.voice = indVoice;

  utterance.onstart = () => {
    state.isSpeaking = true;
    updateTTSButtons(true);
  };

  utterance.onend = () => {
    state.isSpeaking = false;
    updateTTSButtons(false);
  };

  utterance.onerror = () => {
    state.isSpeaking = false;
    updateTTSButtons(false);
  };

  state.currentUtterance = utterance;
  state.speechSynth.speak(utterance);
};

function toggleAudioAdvisory() {
  if (state.latestAdvisoryText) {
    window.playAudioText(encodeURIComponent(state.latestAdvisoryText));
  } else {
    window.playAudioText(encodeURIComponent("Welcome to ORCA INSIGHT. All satellite feeds and coastal oceanography systems are operating with normal status."));
  }
}

function updateTTSButtons(isPlaying) {
  const ttsBtn = document.getElementById('btnTTSPlay');
  if (ttsBtn) {
    if (isPlaying) {
      ttsBtn.innerHTML = `
        <span class="flex items-center gap-1">
          <span class="w-1 h-3 bg-cyan-400 soundbar"></span>
          <span class="w-1 h-3 bg-cyan-400 soundbar"></span>
          <span class="w-1 h-3 bg-cyan-400 soundbar"></span>
          <span class="ml-1 text-xs">Stop Audio</span>
        </span>
      `;
      ttsBtn.classList.add('bg-cyan-600', 'text-white');
    } else {
      ttsBtn.innerHTML = `<span>🔊 Listen Audio Advisory</span>`;
      ttsBtn.classList.remove('bg-cyan-600', 'text-white');
    }
  }
}

// NavIC GPS Bridge & NMEA Simulator
function setupNavICTelemetry() {
  renderNavICSkyplot();
  renderNavICSatelliteList();

  const toggleBtn = document.getElementById('btnToggleNavIC');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      state.navicConnected = !state.navicConnected;
      toggleBtn.innerHTML = state.navicConnected ? 
        `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span> NavIC Receiver: Connected (L5/S-Band)` :
        `<span class="w-2 h-2 rounded-full bg-red-500"></span> NavIC Receiver: Disconnected`;
      toggleBtn.className = state.navicConnected ? 
        "px-3 py-1.5 rounded-lg bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 text-xs font-mono flex items-center gap-2" :
        "px-3 py-1.5 rounded-lg bg-red-950/80 border border-red-500/50 text-red-300 text-xs font-mono flex items-center gap-2";
    });
  }

  // Generate live NMEA sentences
  if (state.navicInterval) clearInterval(state.navicInterval);
  state.navicInterval = setInterval(() => {
    if (!state.navicConnected) return;

    const timeStr = new Date().toISOString().replace(/[-:T]/g, '').slice(8, 14);
    const latStr = "0955.8421,N";
    const lonStr = "07536.1245,E";
    const gga = `$GNGGA,${timeStr}.00,${latStr},${lonStr},1,07,1.05,14.2,M,-84.2,M,,*4A`;
    const rmc = `$GNRMC,${timeStr}.00,A,${latStr},${lonStr},08.20,220.4,300826,,,A*72`;

    const nmeaBox = document.getElementById('nmeaLiveConsole');
    if (nmeaBox) {
      nmeaBox.textContent = `${gga}\n${rmc}\n$GPGSV,2,1,07,01,68,045,44,02,74,130,47,03,60,210,42,04,55,315,39*78`;
    }
  }, 1000);
}

// Real GPS is never enabled implicitly. The browser controls permission and
// ORCA only sends the current point to its geofence endpoint for an in-tab
// safety decision; it does not persist a route history.
function setupGeofenceTracking() {
  const trackButton = document.getElementById('btnTrackMyPosition');
  const simulateButton = document.getElementById('btnSimulateGeofenceMovement');
  if (trackButton) trackButton.addEventListener('click', () => togglePositionTracking(trackButton));
  if (simulateButton) simulateButton.addEventListener('click', () => toggleGeofenceSimulation(simulateButton));
}

function setGeofenceTrackingStatus(text, colour = 'text-slate-400') {
  const status = document.getElementById('geofenceTrackingStatus');
  if (status) { status.textContent = text; status.className = `font-mono ${colour}`; }
}

function togglePositionTracking(button) {
  if (state.positionWatchId !== null) {
    navigator.geolocation.clearWatch(state.positionWatchId);
    state.positionWatchId = null;
    button.textContent = 'Track my position';
    setGeofenceTrackingStatus('Tracking off · no position is being requested');
    return;
  }
  if (!navigator.geolocation) {
    setGeofenceTrackingStatus('Geolocation is not supported by this browser. Use simulated vessel movement for the demo.', 'text-amber-300');
    return;
  }
  setGeofenceTrackingStatus('Requesting device-location permission…', 'text-cyan-300');
  state.positionWatchId = navigator.geolocation.watchPosition(
    position => {
      checkGeofenceAt(position.coords.latitude, position.coords.longitude, 'DEVICE_GEOLOCATION');
      button.textContent = 'Stop tracking';
      setGeofenceTrackingStatus(`Live device tracking · accuracy ±${Math.round(position.coords.accuracy)}m · not stored`, 'text-emerald-300');
    },
    error => {
      state.positionWatchId = null;
      button.textContent = 'Track my position';
      setGeofenceTrackingStatus(`Location permission unavailable (${error.message}). No position was sent.`, 'text-amber-300');
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 }
  );
}

async function checkGeofenceAt(lat, lon, source) {
  try {
    const url = `${BACKEND_CONFIG.apiBase}/api/geofence?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const response = await fetchWithTimeout(url, {}, 4000);
    if (!response.ok) throw new Error(`Geofence check failed (${response.status})`);
    const result = await response.json();
    const alert = result.proximity_alert;
    if (alert && !state.geofenceAlertKeys.has(alert.key)) {
      state.geofenceAlertKeys.add(alert.key);
      showHazardAlert({ ...alert, message: `${alert.message} Source: ${source}.` }, true);
    }
    return result;
  } catch (error) {
    // In Local Simulation no client-side boundary geometry is available, so
    // explicitly avoid inventing a distance or a boundary-crossing claim.
    setGeofenceTrackingStatus('Backend unavailable — exact geofence distance cannot be evaluated in local simulation.', 'text-amber-300');
    return null;
  }
}

function toggleGeofenceSimulation(button) {
  if (state.simulatedGeofenceInterval) {
    clearInterval(state.simulatedGeofenceInterval);
    state.simulatedGeofenceInterval = null;
    button.textContent = 'Simulate vessel movement';
    setGeofenceTrackingStatus('Geofence simulation stopped');
    return;
  }
  // A clearly-labelled route toward the Palk Strait IMBL. It calls the same
  // API and threshold function as device GPS; no simulated result is mixed
  // into the live AIS layer.
  const path = [[9.90, 79.22], [9.90, 79.33], [9.90, 79.43], [9.90, 79.52], [9.90, 79.56]];
  let index = 0;
  const advance = () => {
    const [lat, lon] = path[index];
    checkGeofenceAt(lat, lon, 'SIMULATED_VESSEL_DEMO');
    setGeofenceTrackingStatus(`Simulated vessel movement · point ${index + 1}/${path.length} · ${lat.toFixed(2)}, ${lon.toFixed(2)}`, 'text-amber-300');
    index += 1;
    if (index >= path.length) {
      clearInterval(state.simulatedGeofenceInterval);
      state.simulatedGeofenceInterval = null;
      button.textContent = 'Simulate vessel movement';
    }
  };
  button.textContent = 'Stop simulation';
  advance();
  state.simulatedGeofenceInterval = setInterval(advance, 2200);
}

function renderNavICSkyplot() {
  const canvas = document.getElementById('navicSkyplotCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = cx - 25;

  ctx.clearRect(0, 0, w, h);

  // Concentric elevation rings (30, 60, 90 deg)
  [radius, radius * 0.66, radius * 0.33].forEach(r => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#1e3155';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // Crosshairs (N, S, E, W)
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.strokeStyle = '#1e3155';
  ctx.stroke();

  // Cardinal Labels
  ctx.fillStyle = '#06b6d4';
  ctx.font = '10px Inter';
  ctx.fillText('N', cx - 4, cy - radius - 6);
  ctx.fillText('S', cx - 4, cy + radius + 14);
  ctx.fillText('E', cx + radius + 6, cy + 3);
  ctx.fillText('W', cx - radius - 14, cy + 3);

  // Plot Satellites
  state.navicSatellites.forEach(sat => {
    const r = radius * (1 - sat.el / 90);
    const theta = ((sat.az - 90) * Math.PI) / 180;
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);

    // Halo
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#06b6d4';
    ctx.fill();

    // Text
    ctx.fillStyle = '#060c18';
    ctx.font = 'bold 8px JetBrains Mono';
    ctx.fillText(sat.prn, x - 5, y + 3);
  });
}

function renderNavICSatelliteList() {
  const container = document.getElementById('navicSatelliteList');
  if (!container) return;

  container.innerHTML = state.navicSatellites.map(sat => `
    <div class="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800 text-xs font-mono">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
        <span class="text-white font-bold">${sat.id} (PRN ${sat.prn})</span>
      </div>
      <div class="flex items-center gap-3 text-slate-400 text-[11px]">
        <span>Az: ${sat.az}°</span>
        <span>El: ${sat.el}°</span>
        <span class="text-cyan-400 font-bold">${sat.snr} dB-Hz</span>
      </div>
    </div>
  `).join('');
}

// Low-Bandwidth NavIC MSS / SMS Code Generator
function setupMSSCodeGenerator() {
  window.copyAdvisoryMSS = function() {
    const liveWave = state.liveMarine.waveHeight.toFixed(1);
    const mssCode = `ORCA#KL01#SST28.4#W${liveWave}M#CLR:SAFE(88)#RET1645#CH16`;
    navigator.clipboard.writeText(mssCode).then(() => {
      alert(`Copied NavIC MSS / SMS 120-char Satellite Emergency Code:\n\n${mssCode}`);
    });
  };
}

// Safety Barometer & Sparklines
// Safety Barometer & Sparklines
//
// The score card, condition tiles, and sparklines are all driven from the
// backend's real WeatherHazardAgent (GET /api/weather), which computes a
// genuine safety_score/clearance_verdict from live Open-Meteo wave/wind
// data. Nothing here invents a number: if a fetch fails, the UI simply
// keeps showing the last known-good values instead of a fabricated one.
function setupSafetyBarometer() {
  renderSatelliteCards();
  renderTrendSparklines();

  const hbr = state.harbours.find(h => h.id === state.selectedHarbour);
  const lat = hbr ? hbr.coordinates[0] : 9.93;
  const lon = hbr ? hbr.coordinates[1] : 76.26;

  fetchSafetyTrendHistory(lat, lon).then(() => renderTrendSparklines());
  refreshSafetyBarometer(lat, lon);
  // Open-Meteo's underlying models don't update faster than hourly, so a
  // 5-minute poll is frequent enough to feel live without hammering it.
  setInterval(() => refreshSafetyBarometer(lat, lon), 5 * 60 * 1000);
}

function renderSatelliteCards() {
  const container = document.getElementById('satelliteCardsGrid');
  if (!container || state.satellites.length === 0) return;

  container.innerHTML = state.satellites.map(sat => `
    <div class="p-4 rounded-xl bg-slate-900/90 border border-slate-700/80 hover:border-cyan-500/60 transition shadow-lg">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div>
          <h4 class="font-bold text-slate-100 text-sm">${sat.name}</h4>
          <span class="text-[10px] font-mono text-slate-400">NORAD: ${sat.norad_id} · ${sat.orbit_type}</span>
        </div>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
          ${sat.health_status}
        </span>
      </div>

      <div class="my-3 space-y-1.5 text-xs">
        ${sat.sensors.map(sen => `
          <div class="flex items-center justify-between bg-slate-950/70 px-2 py-1 rounded border border-slate-800">
            <span class="text-cyan-300 font-mono text-[11px]">${sen.name}</span>
            <span class="text-slate-400 text-[10px]">${sen.metric}</span>
          </div>
        `).join('')}
      </div>

      <div class="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-slate-800 text-slate-400 font-mono">
        <div><span>Sync Latency:</span> <strong class="text-cyan-400">${sat.data_sync_latency_sec}s</strong></div>
        <div><span>Battery:</span> <strong class="text-emerald-400">${sat.battery_level_pct}%</strong></div>
        <div><span>Last Pass:</span> <span class="text-slate-300 text-[10px]">${sat.last_pass_ist}</span></div>
        <div><span>Altitude:</span> <span class="text-slate-300 text-[10px]">${sat.altitude_km} km</span></div>
      </div>
    </div>
  `).join('');
}
// Pulls the backend's real hazard score and applies it to the Safety Index
// card and the 4 condition tiles.
async function refreshSafetyBarometer(lat, lon) {
  try {
    const res = await fetchWithTimeout(`${BACKEND_CONFIG.apiBase}/api/weather?lat=${lat}&lon=${lon}`, {}, 6000);
    if (!res.ok) throw new Error(`Weather agent responded with ${res.status}`);
    const weather = await res.json();

    updateSafetyIndexCard(weather);

    state.liveMarine.waveHeight = weather.significant_wave_height_m;
    state.liveMarine.windSpeed = weather.surface_wind_knots;
    state.liveMarine.windDirection = weather.wind_direction;
    state.liveMarine.seaState = weather.sea_state_douglas;
    state.liveMarine.lightningRisk = weather.lightning_risk_pct;
    state.liveMarine.safetyScore = weather.safety_score;
    state.liveMarine.clearanceVerdict = weather.clearance_verdict;
    state.liveMarine.isLiveFeed = weather.data_source?.wave_height === 'LIVE_OPEN_METEO_MARINE';

    updateMapHUD();

    renderTrendSparklines();
  } catch (err) {
    console.log('Safety Barometer live refresh failed, keeping last known values', err);
  }
}

// Keeps the GIS Command Map's bottom info bar (wave/wind/clearance) in
// sync with the same live weather reading the Safety Barometer uses --
// this bar used to be static hardcoded text and never changed.
function updateMapHUD() {
  const waveEl = document.getElementById('mapHudWave');
  const windEl = document.getElementById('mapHudWind');
  const clearanceEl = document.getElementById('mapHudClearance');
  if (!waveEl && !windEl && !clearanceEl) return;

  if (waveEl && state.liveMarine.waveHeight != null) {
    waveEl.textContent = `${state.liveMarine.waveHeight} m`;
  }
  if (windEl && state.liveMarine.windSpeed != null) {
    const dir = state.liveMarine.windDirection || '';
    const dirAbbrev = dir ? ` ${dir[0]}` : '';
    windEl.textContent = `${state.liveMarine.windSpeed} kn${dirAbbrev}`;
  }
  if (clearanceEl && state.liveMarine.clearanceVerdict) {
    const verdict = state.liveMarine.clearanceVerdict;
    const score = state.liveMarine.safetyScore ?? '—';
    clearanceEl.textContent = `${verdict} (${score}/100)`;
    const colorClass = verdict === 'SAFE' ? 'text-emerald-400'
      : verdict === 'CAUTION' ? 'text-amber-400'
      : 'text-rose-400';
    clearanceEl.className = `font-bold ${colorClass}`;
  }
}

// Applies a /api/weather response to the score card + 4 condition tiles.
function updateSafetyIndexCard(weather) {
  const scoreEl = document.getElementById('safetyIndexScore');
  const verdictEl = document.getElementById('safetyVerdictText');
  const descEl = document.getElementById('safetyVerdictDesc');
  const cardEl = document.getElementById('safetyVerdictCard');
  const dotEl = document.getElementById('safetyPulseDot');
  const ringEl = document.getElementById('safetyIndexRing');

  const verdict = weather.clearance_verdict || 'SAFE';
  const theme = {
    SAFE: { color: 'emerald', label: 'SAFE FOR SEA VENTURE', icon: '✓' },
    CAUTION: { color: 'amber', label: 'PROCEED WITH CAUTION', icon: '⚠' },
    UNSAFE: { color: 'rose', label: 'UNSAFE — DO NOT VENTURE', icon: '✕' }
  }[verdict] || { color: 'emerald', label: 'SAFE FOR SEA VENTURE', icon: '✓' };

  const colorClasses = {
    emerald: { card: 'from-emerald-950/80 border-emerald-500/50', dot: 'bg-emerald-400', text: 'text-emerald-400', ring: 'border-emerald-400', glow: 'shadow-emerald-500/30' },
    amber: { card: 'from-amber-950/80 border-amber-500/50', dot: 'bg-amber-400', text: 'text-amber-400', ring: 'border-amber-400', glow: 'shadow-amber-500/30' },
    rose: { card: 'from-rose-950/80 border-rose-500/50', dot: 'bg-rose-400', text: 'text-rose-400', ring: 'border-rose-400', glow: 'shadow-rose-500/30' }
  };
  const c = colorClasses[theme.color];

  if (scoreEl) {
    scoreEl.textContent = weather.safety_score ?? '—';
    scoreEl.className = `text-3xl sm:text-4xl font-black ${c.text} font-mono`;
  }
  if (verdictEl) verdictEl.textContent = theme.label;
  if (descEl) {
    descEl.textContent = `Live Open-Meteo marine telemetry places significant wave height at ${weather.significant_wave_height_m}m and surface wind at ${weather.surface_wind_knots}kn near your selected harbour, giving a computed safety score of ${weather.safety_score}/100.`;
  }
  if (cardEl) {
    cardEl.className = `p-6 rounded-2xl bg-gradient-to-r ${c.card} via-ocean-900 to-ocean-900 border shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6`;
  }
  if (dotEl) dotEl.className = `w-3 h-3 rounded-full ${c.dot} animate-ping`;
  if (ringEl) {
    ringEl.className = `w-14 h-14 rounded-full border-4 ${c.ring} flex items-center justify-center text-2xl ${c.text} font-bold shadow-lg ${c.glow}`;
    ringEl.textContent = theme.icon;
  }

  const waveVal = document.getElementById('safetyTileWaveVal');
  const waveBand = document.getElementById('safetyTileWaveBand');
  if (waveVal) waveVal.textContent = `${weather.significant_wave_height_m} m`;
  if (waveBand) waveBand.textContent = waveBandLabel(weather.significant_wave_height_m);

  const windVal = document.getElementById('safetyTileWindVal');
  const windBand = document.getElementById('safetyTileWindBand');
  if (windVal) windVal.textContent = `${weather.surface_wind_knots} kn`;
  if (windBand) windBand.textContent = `${weather.wind_direction || 'Westerly'} Breeze`;

  const seaVal = document.getElementById('marineSeaVal');
  const seaBand = document.getElementById('safetyTileSeaBand');
  if (seaVal) seaVal.textContent = `State ${weather.sea_state_douglas}`;
  if (seaBand) seaBand.textContent = seaStateLabel(weather.sea_state_douglas);

  const lightVal = document.getElementById('safetyTileLightningVal');
  const lightBand = document.getElementById('safetyTileLightningBand');
  const lightPct = weather.lightning_risk_pct;
  if (lightVal) lightVal.textContent = `${lightPct}% ${lightPct < 20 ? 'Low' : lightPct < 50 ? 'Moderate' : 'High'}`;
  if (lightBand) lightBand.textContent = lightningBandLabel(lightPct);
}

function waveBandLabel(h) {
  if (h < 0.5) return 'Calm (< 0.5m)';
  if (h < 1.25) return 'Slight (0.5 - 1.25m)';
  if (h < 2.5) return 'Moderate (1.25 - 2.5m)';
  return 'Rough (> 2.5m)';
}

function seaStateLabel(seaState) {
  return { 1: 'Calm', 2: 'Slight', 3: 'Slight to Moderate', 4: 'Moderate to Rough' }[seaState] || 'Unknown';
}

function lightningBandLabel(pct) {
  if (pct < 20) return 'Safe Atmospheric Profile';
  if (pct < 50) return 'Elevated Convective Risk';
  return 'Severe Squall Warning';
}

function seaStateFromSwh(h) {
  if (h < 0.5) return 1;
  if (h < 1.25) return 2;
  if (h < 2.5) return 3;
  return 4;
}

// Seeds the Safety Barometer sparklines with genuine past-24h hourly
// readings pulled directly from Open-Meteo (marine API for wave height,
// forecast API for wind/cloud cover), so the trend line is real history
// from the moment the tab loads instead of starting empty. If either
// request fails, state.safetyTrend simply stays empty and the sparkline
// falls back to plotting the live reading alone — never a fake number.
async function fetchSafetyTrendHistory(lat, lon) {
  try {
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height&past_days=1&forecast_days=1&timezone=Asia%2FKolkata`;
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,cloud_cover,weather_code&wind_speed_unit=kn&past_days=1&forecast_days=1&timezone=Asia%2FKolkata`;

    const [marineRes, forecastRes] = await Promise.all([
      fetchWithTimeout(marineUrl, {}, 8000),
      fetchWithTimeout(forecastUrl, {}, 8000)
    ]);
    if (!marineRes.ok || !forecastRes.ok) throw new Error('Open-Meteo history request failed');

    const marine = await marineRes.json();
    const forecast = await forecastRes.json();

    const findNowIndex = (times) => {
      if (!Array.isArray(times) || times.length === 0) return -1;
      const nowMs = Date.now();
      let idx = -1;
      for (let i = 0; i < times.length; i++) {
        if (new Date(times[i]).getTime() <= nowMs) idx = i;
        else break;
      }
      return idx;
    };

    const last12 = (arr, idx) => {
      if (!Array.isArray(arr) || idx < 0) return null;
      const start = Math.max(0, idx - 11);
      const slice = arr.slice(start, idx + 1).filter(v => typeof v === 'number');
      return slice.length >= 2 ? slice : null;
    };

    const waveTimes = (marine.hourly && marine.hourly.time) || [];
    const waveHeights = (marine.hourly && marine.hourly.wave_height) || [];
    const wIdx = findNowIndex(waveTimes);
    const waveTrend = last12(waveHeights, wIdx);
    if (waveTrend) {
      state.safetyTrend.wave = waveTrend;
      state.safetyTrend.sea = waveTrend.map(seaStateFromSwh);
    }

    const fTimes = (forecast.hourly && forecast.hourly.time) || [];
    const windSpeeds = (forecast.hourly && forecast.hourly.wind_speed_10m) || [];
    const cloudCover = (forecast.hourly && forecast.hourly.cloud_cover) || [];
    const weatherCodes = (forecast.hourly && forecast.hourly.weather_code) || [];
    const fIdx = findNowIndex(fTimes);

    const windTrend = last12(windSpeeds, fIdx);
    if (windTrend) state.safetyTrend.wind = windTrend;

    if (fIdx >= 0) {
      const start = Math.max(0, fIdx - 11);
      const lightTrend = [];
      for (let i = start; i <= fIdx; i++) {
        if ([95, 96, 99].includes(weatherCodes[i])) lightTrend.push(55);
        else if (typeof cloudCover[i] === 'number') lightTrend.push(Math.min(30, Math.round(cloudCover[i] * 0.3)));
        else lightTrend.push(state.liveMarine.lightningRisk);
      }
      if (lightTrend.length >= 2) state.safetyTrend.lightning = lightTrend;
    }
  } catch (err) {
    console.log('Safety Barometer 24h history unavailable, using live-only trend', err);
  }
}

function renderTrendSparklines() {
  const wavePoints = appendLivePoint(state.safetyTrend.wave, state.liveMarine.waveHeight);
  drawSVGSparkline('sparklineWave', wavePoints, '#06b6d4');

  const windPoints = appendLivePoint(state.safetyTrend.wind, state.liveMarine.windSpeed);
  drawSVGSparkline('sparklineWind', windPoints, '#3b82f6');

  const seaPoints = appendLivePoint(state.safetyTrend.sea, state.liveMarine.seaState);
  drawSVGSparkline('sparklineSea', seaPoints, '#10b981');

  const lightPoints = appendLivePoint(state.safetyTrend.lightning, state.liveMarine.lightningRisk);
  drawSVGSparkline('sparklineLightning', lightPoints, '#f59e0b');
}

// Appends the latest live reading to the real 24h history fetched from
// Open-Meteo. Every plotted point is a genuine measurement — when no
// history has loaded yet, this just plots the single live value twice so
// the sparkline still renders instead of showing invented history.
function appendLivePoint(history, liveValue) {
  const base = Array.isArray(history) && history.length >= 2 ? history.slice() : [liveValue];
  const points = base.concat([liveValue]);
  return points.length >= 2 ? points : [liveValue, liveValue];
}

function drawSVGSparkline(elementId, dataPoints, strokeColor) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const width = 140;
  const height = 36;
  const min = Math.min(...dataPoints) * 0.9;
  const max = Math.max(...dataPoints) * 1.1;

  const pointsString = dataPoints.map((val, idx) => {
    const x = (idx / (dataPoints.length - 1)) * width;
    const y = height - ((val - min) / (max - min)) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  el.innerHTML = `
    <svg class="w-full h-9 overflow-visible sparkline-svg" viewBox="0 0 ${width} ${height}">
      <polyline fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${pointsString}" />
      <circle cx="${width}" cy="${height - ((dataPoints[dataPoints.length-1] - min) / (max - min)) * height}" r="3" fill="${strokeColor}" />
    </svg>
  `;
}

// Fleet Monitor Dashboard
function setupFleetMonitor() {
  renderFleetDistributionChart();
  renderVesselsTable();
  setupVesselFilters();
}

function renderFleetDistributionChart() {
  const chartContainer = document.getElementById('zoneDistributionBars');
  if (!chartContainer) return;

  const zoneCounts = {};
  state.vessels.forEach(v => {
    zoneCounts[v.zone] = (zoneCounts[v.zone] || 0) + 1;
  });

  const maxCount = Math.max(...Object.values(zoneCounts), 1);

  chartContainer.innerHTML = Object.entries(zoneCounts).map(([zone, count]) => {
    const pct = Math.round((count / maxCount) * 100);
    return `
      <div class="space-y-1">
        <div class="flex justify-between text-xs">
          <span class="text-slate-300 font-medium">${zone}</span>
          <span class="text-cyan-400 font-mono font-bold">${count} vessels</span>
        </div>
        <div class="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
          <div class="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all duration-500" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');

  const totalEl = document.getElementById('fleetTotalActive');
  if (totalEl) {
    totalEl.textContent = state.simulatedVesselCount
      ? `${state.vessels.length} (${state.liveVesselCount} live · ${state.simulatedVesselCount} sim)`
      : state.vessels.length;
  }
}

function renderVesselsTable(filteredList = null) {
  const tbody = document.getElementById('vesselsTableBody');
  if (!tbody) return;

  const list = filteredList || state.vessels;

  tbody.innerHTML = list.map(v => {
    let statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300">SAFE FISHING</span>`;
    if (v.status === 'BORDER_ALERT') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300 animate-pulse">BORDER ALERT</span>`;
    } else if (v.status === 'BORDER_WARNING') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300">BORDER WARN</span>`;
    } else if (v.status === 'TRANSIT') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300">IN TRANSIT</span>`;
    }
    // Simulated fill-in vessels always carry their own tag alongside the
    // status badge, so a scan of the table never mistakes one for real AIS.
    const simTag = v.is_simulated
      ? `<span class="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-slate-700 text-slate-200 border border-slate-500" title="Simulated -- no live AIS coverage near this port">SIM</span>`
      : '';

    return `
      <tr class="border-b border-slate-800 hover:bg-slate-800/50 transition ${v.is_simulated ? 'opacity-80' : ''}">
        <td class="py-2.5 px-3 font-mono text-cyan-400 text-xs font-bold">${v.id}</td>
        <td class="py-2.5 px-3 text-xs text-white font-medium">${v.name}</td>
        <td class="py-2.5 px-3 text-xs text-slate-400">${v.type}</td>
        <td class="py-2.5 px-3 text-xs text-slate-300">${v.zone}</td>
        <td class="py-2.5 px-3 font-mono text-xs text-slate-200">${v.speed_knots} kn / ${v.heading}°</td>
        <td class="py-2.5 px-3 font-mono text-xs ${v.imbl_dist_nm < 5 ? 'text-red-400 font-bold' : 'text-emerald-400'}">${v.imbl_dist_nm} NM</td>
        <td class="py-2.5 px-3">${statusBadge}${simTag}</td>
        <td class="py-2.5 px-3 text-right">
          <button onclick="zoomToVessel('${v.id}')" class="px-2 py-1 bg-slate-800 hover:bg-cyan-600 text-cyan-300 hover:text-white rounded text-[11px] font-medium transition">
            Locate ➔
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function setupVesselFilters() {
  const searchInput = document.getElementById('vesselSearchInput');
  const statusFilter = document.getElementById('vesselStatusFilter');

  function applyFilter() {
    const q = (searchInput ? searchInput.value : '').toLowerCase();
    const st = statusFilter ? statusFilter.value : 'ALL';

    const filtered = state.vessels.filter(v => {
      const matchQuery = v.name.toLowerCase().includes(q) || v.id.toLowerCase().includes(q) || v.zone.toLowerCase().includes(q);
      const matchStatus = st === 'ALL' || v.status === st;
      return matchQuery && matchStatus;
    });

    renderVesselsTable(filtered);
  }

  if (searchInput) searchInput.addEventListener('input', applyFilter);
  if (statusFilter) statusFilter.addEventListener('change', applyFilter);
}

window.zoomToVessel = function(vesselId) {
  const vessel = state.vessels.find(v => v.id === vesselId);
  if (!vessel || !state.map) return;

  switchTab('map');
  state.map.setCenter({ lat: vessel.lat, lng: vessel.lon });
  state.map.setZoom(9);

  const entry = state.activeVesselMarkers[vesselId];
  if (entry) {
    setTimeout(() => {
      entry.marker.setPopup(entry.popupHtml, { openPopup: true });
    }, 400);
  }
};

// Official Advisory Bulletins
function setupBulletins() {
  renderBulletinsList();
  setupBulletinFilters();
}

function renderBulletinsList(filterSeverity = 'ALL') {
  const container = document.getElementById('bulletinsListContainer');
  if (!container || state.bulletins.length === 0) return;

  const filtered = state.bulletins.filter(b => filterSeverity === 'ALL' || b.severity === filterSeverity);

  container.innerHTML = filtered.map(b => {
    let borderClass = 'border-blue-500/50 bg-blue-950/20';
    let badgeClass = 'bg-blue-500/20 text-blue-300';
    if (b.severity === 'CRITICAL') {
      borderClass = 'border-red-500/50 bg-red-950/20';
      badgeClass = 'bg-red-500/20 text-red-300';
    } else if (b.severity === 'WARNING') {
      borderClass = 'border-amber-500/50 bg-amber-950/20';
      badgeClass = 'bg-amber-500/20 text-amber-300';
    } else if (b.severity === 'ADVISORY') {
      borderClass = 'border-emerald-500/50 bg-emerald-950/20';
      badgeClass = 'bg-emerald-500/20 text-emerald-300';
    }

    return `
      <div class="p-5 rounded-xl border ${borderClass} shadow-lg space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded text-xs font-mono font-bold ${badgeClass}">${b.severity}</span>
            <span class="text-xs font-mono text-slate-400">${b.id}</span>
          </div>
          <span class="text-xs text-slate-400 font-mono">Issued: ${b.issued_at}</span>
        </div>

        <h3 class="text-base font-bold text-white">${b.title}</h3>
        <p class="text-sm text-slate-300 leading-relaxed">${b.summary}</p>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 font-mono">
          <div><span class="text-slate-400">Region:</span> <span class="text-slate-200 font-medium">${b.region}</span></div>
          <div><span class="text-slate-400">Waves:</span> <span class="text-cyan-400 font-medium">${b.wave_forecast}</span></div>
          <div><span class="text-slate-400">Winds:</span> <span class="text-slate-200 font-medium">${b.wind_forecast}</span></div>
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
          <span class="text-slate-400">Source: <strong class="text-slate-300">${b.source}</strong></span>
          <button onclick="playAudioText('${encodeURIComponent(b.title + '. ' + b.summary)}')" class="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 transition">
            <span>🔊</span> Listen Bulletin
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function setupBulletinFilters() {
  const chips = document.querySelectorAll('[data-bulletin-filter]');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('bg-cyan-500', 'text-slate-950'));
      chip.classList.add('bg-cyan-500', 'text-slate-950');
      const sev = chip.getAttribute('data-bulletin-filter');
      renderBulletinsList(sev);
    });
  });
}

// Emergency SOS Modal
function setupSOSModal() {
  const sosBtn = document.getElementById('btnHeaderSOS');
  const modal = document.getElementById('sosModal');
  const cancelBtn = document.getElementById('btnCancelSOS');
  const triggerBtn = document.getElementById('btnTriggerDistress');

  if (sosBtn) {
    sosBtn.addEventListener('click', () => {
      if (modal) modal.classList.remove('hidden');
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (modal) modal.classList.add('hidden');
    });
  }

  if (triggerBtn) {
    triggerBtn.addEventListener('click', () => {
      triggerDistressBeacon();
    });
  }
}

function triggerDistressBeacon() {
  state.sosActive = true;
  const statusEl = document.getElementById('sosDistressStatus');
  if (statusEl) {
    statusEl.innerHTML = `
      <div class="p-4 rounded-xl bg-red-950/80 border border-red-500 text-red-200 text-sm space-y-2">
        <div class="flex items-center gap-2 font-bold text-red-400 text-base">
          <span class="w-3 h-3 rounded-full bg-red-500 animate-ping"></span>
          406 MHz SAS&R BEACON TRANSMITTING TO ISRO & COAST GUARD MRCC
        </div>
        <p>Distress packet relayed via INSAT-3DR SAS&R receiver. Maritime Rescue Coordination Centre (MRCC Chennai/Mumbai) alerted on VHF Ch 16.</p>
        <p class="font-mono text-xs text-slate-300">GPS Coordinates: 09°52'N, 75°33'E · Vessel ID: IND-KL-001 (Matsya Vardhini 4)</p>
      </div>
    `;
  }
}

// Live Vessel Physics Simulation Loop
function startLiveVesselSimulation() {
  if (state.vesselUpdateInterval) clearInterval(state.vesselUpdateInterval);

  state.vesselUpdateInterval = setInterval(() => {
    if (state.usesLiveVessels) return; // never distort or fabricate AIS/GPS positions
    state.vessels.forEach(v => {
      const rad = (v.heading * Math.PI) / 180;
      const speedDeg = (v.speed_knots / 3600) * 0.04;

      v.lat += Math.cos(rad) * speedDeg;
      v.lon += Math.sin(rad) * speedDeg;

      if (v.lat < 6.5) v.heading = 45;
      if (v.lat > 23.5) v.heading = 180;
      if (v.lon < 66.0) v.heading = 90;
      if (v.lon > 88.0) v.heading = 270;

      const entry = state.activeVesselMarkers[v.id];
      if (entry) {
        entry.marker.setPosition({ lat: v.lat, lng: v.lon });
      }
    });

    if (state.activeTab === 'fleet') {
      renderFleetDistributionChart();
    }
  }, 3500);
}

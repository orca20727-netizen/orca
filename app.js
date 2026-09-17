/**
 * ORCA INSIGHT - Final Production Multi-Agent Marine Intelligence Platform
 * Smart India Hackathon 2026 · Problem Statement 26176 · ISRO (Dept. of Space)
 * Team SavioursX
 */

// Redesign-style inline icon set: replaces the plain emoji glyphs that used
// to sit in these dynamically-built strings (⚠, 🛡️, ⚓, 🔊, 🚢, 🔍, 📡, etc.)
// with small stroke-style SVGs matching the Hub landing/dashboard icon set,
// so pop-ups, banners and toasts built in JS stay visually consistent with
// the icons in the static markup.
const ORCA_ICON_PATHS = {
  alert:    '<path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>',
  shield:   '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/>',
  anchor:   '<circle cx="12" cy="5" r="2"/><path d="M12 7v13M6 12H2a10 10 0 0 0 10 9 10 10 0 0 0 10-9h-4"/>',
  speaker:  '<path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M17 8a5 5 0 0 1 0 8"/>',
  vessel:   '<path d="M3 17h18M5 17V9l7-4 7 4v8"/>',
  search:   '<circle cx="10" cy="10" r="6"/><path d="M15 15l5 5"/>',
  radar:    '<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'
};
function orcaIcon(name, size) {
  size = size || 13;
  const body = ORCA_ICON_PATHS[name] || '';
  return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'style="display:inline-block;vertical-align:-2px;flex-shrink:0" aria-hidden="true">' + body + '</svg>';
}

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

// Theme system removed (Night/Grey/Blue deleted) -- Day is now the only
// theme, and its values live directly in :root in styles.css, so there's
// nothing left to apply/switch here.

// The Mappls Maps SDK's overlay registry can still be finishing its own
// internal setup a moment after the SDK fires the map's 'load' event --
// most visible on the very first route-polyline auto-render, ~400ms after
// page load. When that happens, the SDK's own lazily-loaded internal
// module throws asynchronously, outside of any promise this app awaits,
// so no local try/catch around the calling code can catch it. Recognise
// this one narrow, well-understood SDK timing signature and log it
// quietly instead of letting it surface as an unhandled top-level error;
// it is harmless and self-recovers -- every subsequent route
// recalculation (harbour/PFZ change, "Simulate Route" click) draws
// correctly once the SDK has finished settling. Anything else is left
// alone and still surfaces normally.
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason && event.reason.message;
  if (msg === "Cannot read properties of null (reading 'push')") {
    event.preventDefault();
    console.warn('Mappls SDK internal timing notice (harmless, self-recovers):', msg);
  }
});

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
  // Initialized as empty arrays (not null) so any render*Layer() call that
  // races ahead of the Mappls map's async 'load' event (e.g. the route
  // planner's setTimeout auto-run, or a telemetry refresh firing early)
  // finds a safe, already-iterable array instead of crashing on
  // `.push()`/`.forEach()` against null. state.map itself is what actually
  // gates whether markers can be added (see the `if (!state.map) return;`
  // guard at the top of each render function) -- these arrays just track
  // what's currently drawn, so there's no reason for them to start as null.
  mapLayers: {
    pfz: [],
    imbl: [],
    mpas: [],
    harbours: [],
    vessels: [],
    heatmap: [],
    route: [],
    indiaBoundary: []
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
    navFleetGIS: "Fleet & GIS Command",
    navNavic: "NavIC GPS Bridge",
    navBulletins: "Advisory Bulletins",
    navSafetyAdv: "Safety & Advisories",
    heroTitle: "Collaborative Marine Intelligence for the Indian Ocean",
    heroDesc: "Reasoning over ISRO Oceansat-3, INSAT-3DR satellite oceanography, IMBL geofencing, real-time fleet density, and voyage ETA to empower India's coastal fishing community.",
    ctaStudio: "Launch AI Decision Studio",
    ctaMap: "Open GIS Command Map",
    ctaFleet: "Inspect Fleet Monitor",
    ctaFleetGIS: "Open Fleet & GIS Command",
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
    bigVerdictQuestion: "Safe to go fishing today?",
    bigVerdictYes: "YES",
    bigVerdictNo: "NO",
    bigVerdictCaution: "CAUTION",
    listenVerdict: "Listen",
    waveHeight: "Significant Wave Height",
    windSpeed: "Surface Wind Speed",
    seaState: "Douglas Sea State",
    lightningRisk: "Lightning & Squall Risk",
    vesselTableTitle: "Live Coastal Fleet Telemetry (Live AIS + Simulated Fill-in)",
    simulatedDisclaimer: "NOTE: Live AIS vessel positions are backfilled with a clearly-tagged simulated fleet where there's no receiver coverage yet. Satellite oceanography layers remain simulated for Smart India Hackathon 2026 demonstration.",

    // ---- ORCA FISHERMAN module ----
    fmTitle: "ORCA FISHERMAN",
    fmSubtitle: "Daily Opportunity Console · Team SavioursX",
    fmLiveFeedBadge: "LIVE OPPORTUNITY FEED",
    fmToggleDarkMode: "Toggle dark mode",
    fmBackToHub: "← Hub",
    fmBackToHubTitle: "Back to ORCA Hub",
    fmNavOpportunity: "Today's Opportunity",
    fmNavMap: "Fishing Zones Map",
    fmNavSell: "Sell Smarter",
    fmNavCalculator: "Trip Calculator",
    fmNavCommunity: "Performance & Community",
    fmCheckingBackend: "Checking backend...",
    fmBestOpportunityLabel: "Today's Best Opportunity",
    fmLoadingOpportunityDesc: "Loading today's opportunity from the Fisherman Opportunity Agent…",
    fmPreferredSpeciesLabel: "Preferred species:",
    fmAutoBestMatch: "Auto (Best Match)",
    fmOpportunityScoreLabel: "Opportunity Score",
    fmRecommendedZoneLabel: "Recommended Zone",
    fmExpectedCatchLabel: "Expected Catch",
    fmAtTodaysPrice: "at today's price",
    fmRevenueRangeLabel: "Revenue Range",
    fmBeforeTripCosts: "before trip costs",
    fmEstimatedProfitLabel: "Estimated Profit",
    fmConfidenceLabel: "Confidence",
    fmScoreBreakdownTitle: "Opportunity Score Breakdown",
    fmAiStudioTitle: "AI Decision Studio — Plan Your Trip",
    fmAiStudioDesc: "4 on-device scikit-learn models (catch, zone, species, price) trained on ORCA's own data, combined with a deterministic profit & risk engine. No external AI API is used anywhere in this pipeline.",
    fmDemoModelBadge: "DEMO MODEL · synthetic training data",
    fmTripPlannerTitle: "Trip Planner",
    fmBoatTypeLabel: "Boat Type",
    fmBoatTraditional: "Traditional (Non-mechanized)",
    fmBoatMotorized: "Motorized",
    fmBoatMechanized: "Mechanized Trawler",
    fmGearTypeLabel: "Gear Type",
    fmGearGillnet: "Gillnet",
    fmGearTrawl: "Trawl",
    fmGearRingSeine: "Ring Seine",
    fmGearLongline: "Longline",
    fmGearHookLine: "Hook & Line",
    fmTripDurationLabel: "Trip Duration (hours)",
    fmTargetSpeciesLabel: "Target Species",
    fmSpeciesTuna: "Tuna",
    fmSpeciesPomfret: "Pomfret",
    fmSpeciesSardine: "Sardine",
    fmSpeciesMackerel: "Mackerel",
    fmSpeciesKingfish: "Kingfish",
    fmUsesCurrentLocation: "Uses your current harbour location and live marine weather for today.",
    fmPlanMyTrip: "Plan My Trip",
    fmRunningModelsBtn: "Running ORCA models…",
    fmRunningModelsDesc: "Running ORCA's on-device ML models (catch, zone, species, price) plus the profit & risk engine…",
    fmRecommendedPlanLabel: "ORCA's Recommended Plan",
    fmTripScoreLabel: "ORCA Trip Score",
    fmBestZoneLabel: "Best Zone",
    fmBestTimeWindowLabel: "Best Time Window",
    fmHighestPredictedCatch: "highest predicted catch",
    fmReliabilityLabel: "Reliability",
    fmRiskLabel: "Risk",
    fmZoneRankingTitle: "Zone Ranking · Fishing Potential",
    fmSpeciesSuitabilityTitle: "Species Suitability Ranking",
    fmWhereToSellTitle: "Where to Sell",
    fmThMarket: "Market",
    fmThDistance: "Distance",
    fmThPricePerKg: "Price/kg",
    fmThNetRevenue: "Net Revenue",
    fmFeatureImportanceTitle: "What Drives This Prediction",
    fmFeatureImportanceDesc: "Top factors the catch model actually weighed for this trip — real feature importances read from the trained model, not invented.",
    fmWhyOrcaTitle: "Why ORCA Chose This",
    fmModelTransparencyTitle: "Model Transparency",
    fmModelTransparencyDisclaimer: "DEMO MODEL — every model above is trained on ORCA's synthetic demonstration dataset, not real historical catch records. Reliability figures are measured on that dataset, not real-world accuracy.",
    fmZonesMapTitle: "Best Fish Yield Zones · Live Map",
    fmZonesMapDesc: "Same live-scored Ocean Analytics & PFZ Agent data used by Today's Opportunity, plotted on the GIS Command Map's basemap.",
    fmRankedByYieldTitle: "Ranked by Yield",
    fmLoadingZones: "Loading zones…",
    fmTopZoneLabel: "Top Zone:",
    fmYieldScoreLabel: "Yield Score:",
    fmLoadingPricing: "Loading pricing comparison…",
    fmTypicalPriceLabel: "Typical Informal Price",
    fmOpportunityPriceLabel: "ORCA Opportunity Price",
    fmExtraRevenueLabel: "Potential Extra Revenue",
    fmSpeciesPriceRankingTitle: "Species Price Ranking",
    fmThSpecies: "Species",
    fmThTrend: "Trend",
    fmThDemand: "Demand",
    fmThEstProfit: "Est. Profit",
    fmThOpportunityScore: "Opportunity Score",
    fmBuyerLeadsTitle: "Buyer Leads",
    fmTripCostCalcTitle: "Trip-Cost Calculator",
    fmSpeciesLabel: "Species",
    fmExpectedCatchKgLabel: "Expected Catch (kg)",
    fmPricePerKgLabel: "Price per kg (₹)",
    fmFuelLabel: "Fuel (₹)",
    fmIceLabel: "Ice (₹)",
    fmOtherLabel: "Other (₹)",
    fmRecalculateBtn: "Recalculate",
    fmTripSummaryTitle: "Trip Summary",
    fmGrossRevenueLabel: "Gross Revenue:",
    fmTotalTripCostLabel: "Total Trip Cost:",
    fmNetProfitLabel: "Net Profit:",
    fmProfitMarginLabel: "Profit Margin:",
    fmCalcDefaultsNote: "Defaults are pre-filled from today's recommended species and this app's simulated market data — adjust any field and press Recalculate.",
    fmTripPerformanceTitle: "Your Trip Performance",
    fmLoadingPerformance: "Loading performance history…",
    fmThTrip: "Trip",
    fmThCatchKg: "Catch (kg)",
    fmThRevenue: "Revenue",
    fmThProfit: "Profit",
    fmCommunityFeedTitle: "Community & Advisory Feed",
    fmBuiltBy: "Built by",
    fmHackathonLine: "Smart India Hackathon 2026 · Problem Statement 26176 (ISRO)",
    fmFooterDisclaimer: "DISCLAIMER: Species market prices, buyer leads and trip history are simulated for Smart India Hackathon 2026 judging demonstration.",
    fmNoTripHistory: "No trip history recorded yet.",
    fmYourCatch: "Your catch",
    fmTripAgoSingular: "{n} trip ago",
    fmTripAgoPlural: "{n} trips ago",
    fmTargetSpeciesColon: "Target Species:",
    fmYieldWord: "YIELD",
    fmSstLabel: "SST:",
    fmDepthLabel: "Depth:",
    fmSafetyLabel: "Safety:",
    fmOpportunityDescTemplate: "Best match today at ₹{price}/kg near {zone} — composite Opportunity Score {score}/100.",
    fmTheRecommendedZone: "the recommended zone",
    fmSellSmarterDescTemplate: "{species}: selling to an ORCA-matched buyer instead of the informal market nets an estimated extra {revenue} on an assumed {catch} kg catch.",
    fmAiErrorTemplate: "Could not reach ORCA's AI Decision Studio backend ({error}). Training the ML models requires a one-time backend setup -- see backend/ml/training/. Try again shortly.",
    fmPlanDescTemplate: "Best window {window} · sell at {market} · ORCA Trip Score {score}/100.",
    fmTheRecommendedMarket: "the recommended market",
    fmKmFromPortTemplate: "{km} km from port",
    fmStatusLive: "LIVE",
    fmStatusOffline: "BACKEND OFFLINE — showing last known data",
    fmScoreOcean: "Ocean Safety",
    fmScoreFish: "Fish Yield",
    fmScoreMarket: "Market Momentum",
    fmScoreProfit: "Profit Margin",
    fmTierHigh: "HIGH",
    fmTierGood: "GOOD",
    fmTierModerate: "MODERATE",
    fmPostWeatherAlert: "Weather Alert",
    fmPostMarketUpdate: "Market Update",
    fmPostFishermanReport: "Fisherman Report",
    fmPostUpdate: "Update",
    fmNearbyBusinessesTitle: "Nearby Seafood Buyers & Markets · Live",
    fmNearbyBusinessesDesc: "Real, live via OpenStreetMap near your current position — restaurants and shops that buy/serve seafood nearby. Not a buyer requirement/lead; see Buyer Leads below for that.",
    fmRefreshBtn: "Refresh",
    fmLoadingNearby: "Checking nearby seafood buyers…",
    fmNearbyBadgeLive: "LIVE",
    fmNearbyBadgeUnavailable: "UNAVAILABLE",
    fmNearbyNoneFound: "No seafood buyers or markets found within range right now.",
    fmNearbyFailed: "Couldn't reach live nearby-business data right now.",
    fmPostBuyerDemandBtn: "+ Post Buyer Demand",
    fmBuyerLeadsRealNote: "Leads tagged LIVE are real, verified buyer requirements posted through ORCA's Buyer Network. Others are simulated demo data.",
    fmBuyerModalTitle: "Post Real Buyer Demand",
    fmBuyerModalDesc: "Verified via a one-time code sent to your email (or shown here directly if email isn't configured for this demo). No payments happen on ORCA — this just connects you with fishermen.",
    fmBuyerBusinessNameLabel: "Business Name",
    fmBuyerEmailLabel: "Contact Email",
    fmBuyerLocationLabel: "Location",
    fmBuyerSendCodeBtn: "Send Verification Code",
    fmBuyerDevOtpTemplate: "Email isn't configured for this demo — your code is {code}",
    fmBuyerOtpLabel: "Verification Code",
    fmBuyerVerifyBtn: "Verify Code",
    fmBuyerQtyLabel: "Required Qty (kg)",
    fmBuyerDeadlineLabel: "Deadline",
    fmBuyerPriceMinLabel: "Price Min (₹/kg)",
    fmBuyerPriceMaxLabel: "Price Max (₹/kg)",
    fmBuyerListingLocationLabel: "Pickup Location",
    fmBuyerPostListingBtn: "Post Listing",
    fmBuyerSuccessTitle: "Listing posted",
    fmBuyerSuccessDesc: "Your real buyer requirement is now live in Buyer Leads for fishermen to see and claim.",
    fmBuyerDoneBtn: "Done",
    fmBuyerErrRequired: "Business name and email are required.",
    fmBuyerErrOtp: "Enter the verification code.",
    fmBuyerErrGeneric: "Something went wrong — please try again.",
    fmBuyerErrQty: "Enter a required quantity in kg.",
    fmBuyerLiveTag: "LIVE",
    fmBuyerDemoTag: "DEMO",
    fmClaimBtn: "Claim this lead",
    fmClaimPromptText: "Enter your name and phone/contact so this buyer knows who's fulfilling it:",
    fmClaimSuccess: "Claimed — the buyer will be notified off-platform.",
    fmClaimFailed: "Couldn't claim this listing right now."
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
    navFleetGIS: "फ्लीट और जीआईएस कमांड",
    navNavic: "नाविक (NavIC) जीपीएस",
    navBulletins: "आधिकारिक बुलेटिन",
    navSafetyAdv: "सुरक्षा व सलाह",
    heroTitle: "भारतीय महासागर के लिए सहयोगात्मक समुद्री बुद्धिमत्ता",
    heroDesc: "इसरो ओशनसैट-3, इनसैट-3डीआर उपग्रह डेटा, आईएमबीएल सीमा सुरक्षा, लाइव नाव घनत्व और सटीक ईटीए का विश्लेषण कर मछुआरों को सुरक्षित और समृद्ध बनाता है।",
    ctaStudio: "एआई निर्णय केंद्र शुरू करें",
    ctaMap: "कमांड मैप खोलें",
    ctaFleet: "नाव बेड़ा देखें",
    ctaFleetGIS: "फ्लीट और जीआईएस कमांड खोलें",
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
    bigVerdictQuestion: "आज मछली पकड़ने जाना सुरक्षित है?",
    bigVerdictYes: "हाँ",
    bigVerdictNo: "नहीं",
    bigVerdictCaution: "सावधान",
    listenVerdict: "सुनें",
    waveHeight: "लहरों की ऊंचाई",
    windSpeed: "हवा की गति",
    seaState: "समुद्र की स्थिति (डगलस)",
    lightningRisk: "बिजली और तूफान का जोखिम",
    vesselTableTitle: "लाइव तटीय बेड़ा टेलीमेट्री (लाइव एआईएस + सिम्युलेटेड)",
    simulatedDisclaimer: "नोट: जिन क्षेत्रों में अभी रिसीवर कवरेज नहीं है, वहाँ लाइव एआईएस नाव स्थितियों को स्पष्ट रूप से चिह्नित सिम्युलेटेड बेड़े से पूरा किया जाता है। उपग्रह समुद्र विज्ञान डेटा एसआईएच 2026 प्रदर्शन के लिए सिम्युलेटेड है।",

    // ---- ORCA FISHERMAN module ----
    fmTitle: "ओर्का फिशरमैन (ORCA FISHERMAN)",
    fmSubtitle: "दैनिक अवसर कंसोल · टीम सेवियर्सएक्स",
    fmLiveFeedBadge: "लाइव अवसर फ़ीड",
    fmToggleDarkMode: "डार्क मोड बदलें",
    fmBackToHub: "← हब",
    fmBackToHubTitle: "ओर्का हब पर वापस जाएं",
    fmNavOpportunity: "आज का अवसर",
    fmNavMap: "मत्स्य क्षेत्र मानचित्र",
    fmNavSell: "समझदारी से बेचें",
    fmNavCalculator: "यात्रा लागत कैलकुलेटर",
    fmNavCommunity: "प्रदर्शन और समुदाय",
    fmCheckingBackend: "बैकएंड की जांच हो रही है...",
    fmBestOpportunityLabel: "आज का सर्वश्रेष्ठ अवसर",
    fmLoadingOpportunityDesc: "फिशरमैन अवसर एजेंट से आज का अवसर लोड हो रहा है…",
    fmPreferredSpeciesLabel: "पसंदीदा मछली प्रजाति:",
    fmAutoBestMatch: "स्वतः (सर्वश्रेष्ठ मिलान)",
    fmOpportunityScoreLabel: "अवसर स्कोर",
    fmRecommendedZoneLabel: "अनुशंसित क्षेत्र",
    fmExpectedCatchLabel: "अनुमानित मत्स्य पकड़",
    fmAtTodaysPrice: "आज के मूल्य पर",
    fmRevenueRangeLabel: "राजस्व सीमा",
    fmBeforeTripCosts: "यात्रा लागत से पहले",
    fmEstimatedProfitLabel: "अनुमानित लाभ",
    fmConfidenceLabel: "विश्वास स्तर",
    fmScoreBreakdownTitle: "अवसर स्कोर का विवरण",
    fmAiStudioTitle: "एआई निर्णय केंद्र — अपनी यात्रा की योजना बनाएं",
    fmAiStudioDesc: "4 ऑन-डिवाइस scikit-learn मॉडल (पकड़, क्षेत्र, प्रजाति, मूल्य) जो ओर्का के अपने डेटा पर प्रशिक्षित हैं, एक निश्चित लाभ व जोखिम इंजन के साथ मिलकर काम करते हैं। इस पूरी प्रक्रिया में कहीं भी बाहरी एआई एपीआई का उपयोग नहीं किया जाता।",
    fmDemoModelBadge: "डेमो मॉडल · सिंथेटिक प्रशिक्षण डेटा",
    fmTripPlannerTitle: "यात्रा योजनाकार",
    fmBoatTypeLabel: "नाव का प्रकार",
    fmBoatTraditional: "पारंपरिक (गैर-मशीनीकृत)",
    fmBoatMotorized: "मोटरयुक्त",
    fmBoatMechanized: "मशीनीकृत ट्रॉलर",
    fmGearTypeLabel: "जाल का प्रकार",
    fmGearGillnet: "गिलनेट",
    fmGearTrawl: "ट्रॉल",
    fmGearRingSeine: "रिंग सीन",
    fmGearLongline: "लॉन्गलाइन",
    fmGearHookLine: "हुक और लाइन",
    fmTripDurationLabel: "यात्रा अवधि (घंटे)",
    fmTargetSpeciesLabel: "लक्षित प्रजाति",
    fmSpeciesTuna: "टूना",
    fmSpeciesPomfret: "पॉम्फ्रेट",
    fmSpeciesSardine: "सार्डिन",
    fmSpeciesMackerel: "मैकेरल (बांगड़ा)",
    fmSpeciesKingfish: "किंगफिश (सुरमई)",
    fmUsesCurrentLocation: "आपके वर्तमान बंदरगाह स्थान और आज के लाइव समुद्री मौसम का उपयोग करता है।",
    fmPlanMyTrip: "मेरी यात्रा की योजना बनाएं",
    fmRunningModelsBtn: "ओर्का मॉडल चल रहे हैं…",
    fmRunningModelsDesc: "ओर्का के ऑन-डिवाइस एमएल मॉडल (पकड़, क्षेत्र, प्रजाति, मूल्य) और लाभ व जोखिम इंजन चलाए जा रहे हैं…",
    fmRecommendedPlanLabel: "ओर्का की अनुशंसित योजना",
    fmTripScoreLabel: "ओर्का यात्रा स्कोर",
    fmBestZoneLabel: "सर्वश्रेष्ठ क्षेत्र",
    fmBestTimeWindowLabel: "सर्वश्रेष्ठ समय विंडो",
    fmHighestPredictedCatch: "सर्वाधिक अनुमानित पकड़",
    fmReliabilityLabel: "विश्वसनीयता",
    fmRiskLabel: "जोखिम",
    fmZoneRankingTitle: "क्षेत्र रैंकिंग · मत्स्य क्षमता",
    fmSpeciesSuitabilityTitle: "प्रजाति उपयुक्तता रैंकिंग",
    fmWhereToSellTitle: "कहां बेचें",
    fmThMarket: "बाज़ार",
    fmThDistance: "दूरी",
    fmThPricePerKg: "मूल्य/किग्रा",
    fmThNetRevenue: "शुद्ध राजस्व",
    fmFeatureImportanceTitle: "इस भविष्यवाणी के पीछे मुख्य कारक",
    fmFeatureImportanceDesc: "पकड़ मॉडल द्वारा इस यात्रा के लिए वास्तव में तौले गए मुख्य कारक — प्रशिक्षित मॉडल से पढ़े गए वास्तविक फीचर महत्व, बनाए गए नहीं।",
    fmWhyOrcaTitle: "ओर्का ने यह क्यों चुना",
    fmModelTransparencyTitle: "मॉडल पारदर्शिता",
    fmModelTransparencyDisclaimer: "डेमो मॉडल — ऊपर दिए गए सभी मॉडल ओर्का के सिंथेटिक प्रदर्शन डेटासेट पर प्रशिक्षित हैं, वास्तविक ऐतिहासिक पकड़ रिकॉर्ड पर नहीं। विश्वसनीयता के आंकड़े उसी डेटासेट पर मापे गए हैं, वास्तविक दुनिया की सटीकता पर नहीं।",
    fmZonesMapTitle: "सर्वश्रेष्ठ मत्स्य उपज क्षेत्र · लाइव मानचित्र",
    fmZonesMapDesc: "वही लाइव-स्कोर किया गया ओशन एनालिटिक्स व PFZ एजेंट डेटा जो आज के अवसर में उपयोग होता है, जीआईएस कमांड मैप के आधार मानचित्र पर दिखाया गया।",
    fmRankedByYieldTitle: "उपज के अनुसार रैंक किया गया",
    fmLoadingZones: "क्षेत्र लोड हो रहे हैं…",
    fmTopZoneLabel: "शीर्ष क्षेत्र:",
    fmYieldScoreLabel: "उपज स्कोर:",
    fmLoadingPricing: "मूल्य तुलना लोड हो रही है…",
    fmTypicalPriceLabel: "सामान्य अनौपचारिक मूल्य",
    fmOpportunityPriceLabel: "ओर्का अवसर मूल्य",
    fmExtraRevenueLabel: "संभावित अतिरिक्त राजस्व",
    fmSpeciesPriceRankingTitle: "प्रजाति मूल्य रैंकिंग",
    fmThSpecies: "प्रजाति",
    fmThTrend: "रुझान",
    fmThDemand: "मांग",
    fmThEstProfit: "अनुमानित लाभ",
    fmThOpportunityScore: "अवसर स्कोर",
    fmBuyerLeadsTitle: "खरीदार संपर्क",
    fmTripCostCalcTitle: "यात्रा-लागत कैलकुलेटर",
    fmSpeciesLabel: "प्रजाति",
    fmExpectedCatchKgLabel: "अनुमानित पकड़ (किग्रा)",
    fmPricePerKgLabel: "मूल्य प्रति किग्रा (₹)",
    fmFuelLabel: "ईंधन (₹)",
    fmIceLabel: "बर्फ (₹)",
    fmOtherLabel: "अन्य (₹)",
    fmRecalculateBtn: "पुनर्गणना करें",
    fmTripSummaryTitle: "यात्रा सारांश",
    fmGrossRevenueLabel: "सकल राजस्व:",
    fmTotalTripCostLabel: "कुल यात्रा लागत:",
    fmNetProfitLabel: "शुद्ध लाभ:",
    fmProfitMarginLabel: "लाभ मार्जिन:",
    fmCalcDefaultsNote: "डिफ़ॉल्ट मान आज की अनुशंसित प्रजाति और इस ऐप के सिम्युलेटेड बाज़ार डेटा से पहले से भरे गए हैं — कोई भी फ़ील्ड बदलें और पुनर्गणना करें दबाएं।",
    fmTripPerformanceTitle: "आपकी यात्रा प्रदर्शन",
    fmLoadingPerformance: "प्रदर्शन इतिहास लोड हो रहा है…",
    fmThTrip: "यात्रा",
    fmThCatchKg: "पकड़ (किग्रा)",
    fmThRevenue: "राजस्व",
    fmThProfit: "लाभ",
    fmCommunityFeedTitle: "समुदाय और सलाहकार फ़ीड",
    fmBuiltBy: "निर्मित द्वारा",
    fmHackathonLine: "स्मार्ट इंडिया हैकाथॉन 2026 · समस्या कथन 26176 (इसरो)",
    fmFooterDisclaimer: "अस्वीकरण: प्रजाति बाज़ार मूल्य, खरीदार संपर्क और यात्रा इतिहास स्मार्ट इंडिया हैकाथॉन 2026 के प्रदर्शन हेतु सिम्युलेटेड हैं।",
    fmNoTripHistory: "अभी तक कोई यात्रा इतिहास दर्ज नहीं हुआ।",
    fmYourCatch: "आपकी पकड़",
    fmTripAgoSingular: "{n} यात्रा पहले",
    fmTripAgoPlural: "{n} यात्राएं पहले",
    fmTargetSpeciesColon: "लक्षित प्रजाति:",
    fmYieldWord: "उपज",
    fmSstLabel: "SST:",
    fmDepthLabel: "गहराई:",
    fmSafetyLabel: "सुरक्षा:",
    fmOpportunityDescTemplate: "आज ₹{price}/किग्रा पर {zone} के पास सर्वश्रेष्ठ मिलान — समग्र अवसर स्कोर {score}/100।",
    fmTheRecommendedZone: "अनुशंसित क्षेत्र",
    fmSellSmarterDescTemplate: "{species}: अनौपचारिक बाज़ार के बजाय ओर्का-मिलान खरीदार को बेचने से अनुमानित {catch} किग्रा पकड़ पर लगभग {revenue} अतिरिक्त राजस्व मिलता है।",
    fmAiErrorTemplate: "ओर्का के एआई निर्णय केंद्र बैकएंड तक नहीं पहुंचा जा सका ({error})। एमएल मॉडल प्रशिक्षित करने के लिए एक बार बैकएंड सेटअप आवश्यक है -- backend/ml/training/ देखें। कृपया थोड़ी देर बाद पुनः प्रयास करें।",
    fmPlanDescTemplate: "सर्वश्रेष्ठ विंडो {window} · {market} पर बेचें · ओर्का यात्रा स्कोर {score}/100।",
    fmTheRecommendedMarket: "अनुशंसित बाज़ार",
    fmKmFromPortTemplate: "बंदरगाह से {km} किमी",
    fmStatusLive: "लाइव",
    fmStatusOffline: "बैकएंड ऑफ़लाइन — अंतिम ज्ञात डेटा दिखाया जा रहा है",
    fmScoreOcean: "समुद्री सुरक्षा",
    fmScoreFish: "मत्स्य उपज",
    fmScoreMarket: "बाज़ार गति",
    fmScoreProfit: "लाभ मार्जिन",
    fmTierHigh: "उच्च",
    fmTierGood: "अच्छा",
    fmTierModerate: "मध्यम",
    fmPostWeatherAlert: "मौसम चेतावनी",
    fmPostMarketUpdate: "बाज़ार अपडेट",
    fmPostFishermanReport: "मछुआरा रिपोर्ट",
    fmPostUpdate: "अपडेट",
    fmNearbyBusinessesTitle: "आस-पास के समुद्री खाद्य खरीदार और बाज़ार · लाइव",
    fmNearbyBusinessesDesc: "आपकी वर्तमान स्थिति के पास OpenStreetMap के माध्यम से वास्तविक, लाइव डेटा — पास के रेस्टोरेंट और दुकानें जो समुद्री भोजन खरीदती/परोसती हैं। यह खरीदार की मांग/लीड नहीं है; उसके लिए नीचे खरीदार संपर्क देखें।",
    fmRefreshBtn: "रीफ्रेश करें",
    fmLoadingNearby: "आस-पास के समुद्री खाद्य खरीदारों की जांच हो रही है…",
    fmNearbyBadgeLive: "लाइव",
    fmNearbyBadgeUnavailable: "अनुपलब्ध",
    fmNearbyNoneFound: "अभी दायरे में कोई समुद्री खाद्य खरीदार या बाज़ार नहीं मिला।",
    fmNearbyFailed: "अभी लाइव नज़दीकी व्यवसाय डेटा तक नहीं पहुंच सका।",
    fmPostBuyerDemandBtn: "+ खरीदार मांग पोस्ट करें",
    fmBuyerLeadsRealNote: "लाइव टैग वाले लीड ORCA के खरीदार नेटवर्क के माध्यम से पोस्ट की गई वास्तविक, सत्यापित खरीदार आवश्यकताएं हैं। बाकी सिम्युलेटेड डेमो डेटा हैं।",
    fmBuyerModalTitle: "वास्तविक खरीदार मांग पोस्ट करें",
    fmBuyerModalDesc: "आपके ईमेल पर भेजे गए वन-टाइम कोड से सत्यापित (या यदि इस डेमो के लिए ईमेल कॉन्फ़िगर नहीं है तो सीधे यहां दिखाया जाएगा)। ORCA पर कोई भुगतान नहीं होता — यह केवल आपको मछुआरों से जोड़ता है।",
    fmBuyerBusinessNameLabel: "व्यवसाय का नाम",
    fmBuyerEmailLabel: "संपर्क ईमेल",
    fmBuyerLocationLabel: "स्थान",
    fmBuyerSendCodeBtn: "सत्यापन कोड भेजें",
    fmBuyerDevOtpTemplate: "इस डेमो के लिए ईमेल कॉन्फ़िगर नहीं है — आपका कोड है {code}",
    fmBuyerOtpLabel: "सत्यापन कोड",
    fmBuyerVerifyBtn: "कोड सत्यापित करें",
    fmBuyerQtyLabel: "आवश्यक मात्रा (किग्रा)",
    fmBuyerDeadlineLabel: "समय सीमा",
    fmBuyerPriceMinLabel: "न्यूनतम मूल्य (₹/किग्रा)",
    fmBuyerPriceMaxLabel: "अधिकतम मूल्य (₹/किग्रा)",
    fmBuyerListingLocationLabel: "पिकअप स्थान",
    fmBuyerPostListingBtn: "लिस्टिंग पोस्ट करें",
    fmBuyerSuccessTitle: "लिस्टिंग पोस्ट हो गई",
    fmBuyerSuccessDesc: "आपकी वास्तविक खरीदार आवश्यकता अब खरीदार संपर्क में लाइव है, जिसे मछुआरे देख और दावा कर सकते हैं।",
    fmBuyerDoneBtn: "पूर्ण",
    fmBuyerErrRequired: "व्यवसाय का नाम और ईमेल आवश्यक हैं।",
    fmBuyerErrOtp: "सत्यापन कोड दर्ज करें।",
    fmBuyerErrGeneric: "कुछ गलत हो गया — कृपया पुनः प्रयास करें।",
    fmBuyerErrQty: "किलोग्राम में आवश्यक मात्रा दर्ज करें।",
    fmBuyerLiveTag: "लाइव",
    fmBuyerDemoTag: "डेमो",
    fmClaimBtn: "यह लीड दावा करें",
    fmClaimPromptText: "अपना नाम और फ़ोन/संपर्क दर्ज करें ताकि खरीदार को पता चले कि इसे कौन पूरा कर रहा है:",
    fmClaimSuccess: "दावा किया गया — खरीदार को ऑफ-प्लेटफ़ॉर्म सूचित किया जाएगा।",
    fmClaimFailed: "अभी यह लिस्टिंग दावा नहीं की जा सकी।"
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
    navFleetGIS: "கப்பல் & GIS கட்டளை",
    navNavic: "நாவிக் (NavIC) ஜிபிஎஸ்",
    navBulletins: "அதிகாரப்பூர்வ அறிவிப்புகள்",
    navSafetyAdv: "பாதுகாப்பு & அறிவிப்புகள்",
    heroTitle: "இந்தியப் பெருங்கடலுக்கான கூட்டு கடல்சார் நுண்ணறிவு",
    heroDesc: "இஸ்ரோ ஓஷன்சாட்-3, இன்சாட்-3டிஆர் செயற்கைக்கோள் தரவு, சர்வதேச எல்லைக் கோடு, படகுகளின் அடர்த்தி மற்றும் வருகை நேரத்தை பகுப்பாய்வு செய்து மீனவர்களுக்கு வழிகாட்டுகிறது.",
    ctaStudio: "AI முடிவெடுக்கும் மையம்",
    ctaMap: "கட்டளை வரைபடம்",
    ctaFleet: "படகு கண்காணிப்பு",
    ctaFleetGIS: "கப்பல் & GIS கட்டளையை திறக்கவும்",
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
    bigVerdictQuestion: "இன்று மீன்பிடிக்க செல்வது பாதுகாப்பானதா?",
    bigVerdictYes: "ஆம்",
    bigVerdictNo: "இல்லை",
    bigVerdictCaution: "எச்சரிக்கை",
    listenVerdict: "கேளுங்கள்",
    waveHeight: "அலைகளின் உயரம்",
    windSpeed: "காற்றின் வேகம்",
    seaState: "கடல் நிலை",
    lightningRisk: "மின்னல் மற்றும் புயல் ஆபத்து",
    vesselTableTitle: "நேரடி படகு தொலைத்தொடர்பு தரவு",
    simulatedDisclaimer: "குறிப்பு: வரவேற்பி (receiver) கவரேஜ் இல்லாத பகுதிகளில் லைவ் AIS படகு நிலைகள், தெளிவாகக் குறிக்கப்பட்ட சிமுலேட்டட் கடற்படையால் நிரப்பப்படுகின்றன. செயற்கைக்கோள் கடல் தரவு SIH 2026 விளக்கக்காட்சிக்காக சிமுலேட் செய்யப்பட்டதாகவே உள்ளது.",

    // ---- ORCA FISHERMAN module ----
    fmTitle: "ஆர்கா ஃபிஷர்மேன் (ORCA FISHERMAN)",
    fmSubtitle: "தினசரி வாய்ப்பு கன்சோல் · டீம் சேவியர்ஸ்எக்ஸ்",
    fmLiveFeedBadge: "நேரடி வாய்ப்பு ஊட்டம்",
    fmToggleDarkMode: "இருள் பயன்முறையை மாற்று",
    fmBackToHub: "← மையம்",
    fmBackToHubTitle: "ஆர்கா மையத்திற்குத் திரும்பு",
    fmNavOpportunity: "இன்றைய வாய்ப்பு",
    fmNavMap: "மீன்பிடி மண்டல வரைபடம்",
    fmNavSell: "புத்திசாலித்தனமாக விற்கவும்",
    fmNavCalculator: "பயண செலவு கால்குலேட்டர்",
    fmNavCommunity: "செயல்திறன் & சமூகம்",
    fmCheckingBackend: "பின்தளம் சரிபார்க்கப்படுகிறது...",
    fmBestOpportunityLabel: "இன்றைய சிறந்த வாய்ப்பு",
    fmLoadingOpportunityDesc: "மீனவர் வாய்ப்பு முகவரிடமிருந்து இன்றைய வாய்ப்பு ஏற்றப்படுகிறது…",
    fmPreferredSpeciesLabel: "விருப்பமான மீன் வகை:",
    fmAutoBestMatch: "தானாக (சிறந்த பொருத்தம்)",
    fmOpportunityScoreLabel: "வாய்ப்பு மதிப்பெண்",
    fmRecommendedZoneLabel: "பரிந்துரைக்கப்பட்ட மண்டலம்",
    fmExpectedCatchLabel: "எதிர்பார்க்கப்படும் பிடிப்பு",
    fmAtTodaysPrice: "இன்றைய விலையில்",
    fmRevenueRangeLabel: "வருவாய் வரம்பு",
    fmBeforeTripCosts: "பயண செலவுக்கு முன்",
    fmEstimatedProfitLabel: "மதிப்பிடப்பட்ட லாபம்",
    fmConfidenceLabel: "நம்பகத்தன்மை",
    fmScoreBreakdownTitle: "வாய்ப்பு மதிப்பெண் விவரம்",
    fmAiStudioTitle: "AI முடிவெடுக்கும் மையம் — உங்கள் பயணத்தைத் திட்டமிடுங்கள்",
    fmAiStudioDesc: "ஆர்காவின் சொந்த தரவில் பயிற்சி பெற்ற 4 ஆன்-டிவைஸ் scikit-learn மாதிரிகள் (பிடிப்பு, மண்டலம், இனம், விலை), ஒரு நிர்ணயிக்கப்பட்ட லாப & இடர் இயந்திரத்துடன் இணைந்து செயல்படுகின்றன. இந்த செயல்முறையில் எங்கும் வெளிப்புற AI API பயன்படுத்தப்படவில்லை.",
    fmDemoModelBadge: "டெமோ மாதிரி · செயற்கை பயிற்சி தரவு",
    fmTripPlannerTitle: "பயண திட்டமிடுநர்",
    fmBoatTypeLabel: "படகு வகை",
    fmBoatTraditional: "பாரம்பரிய (இயந்திரமற்ற)",
    fmBoatMotorized: "மோட்டார் படகு",
    fmBoatMechanized: "இயந்திரமயமாக்கப்பட்ட ட்ராலர்",
    fmGearTypeLabel: "வலை வகை",
    fmGearGillnet: "கில்நெட்",
    fmGearTrawl: "ட்ரால்",
    fmGearRingSeine: "ரிங் சீன்",
    fmGearLongline: "லாங்லைன்",
    fmGearHookLine: "தூண்டில் & கயிறு",
    fmTripDurationLabel: "பயண கால அளவு (மணி நேரம்)",
    fmTargetSpeciesLabel: "இலக்கு மீன் இனம்",
    fmSpeciesTuna: "சூரை (Tuna)",
    fmSpeciesPomfret: "வாவல் (Pomfret)",
    fmSpeciesSardine: "மத்தி (Sardine)",
    fmSpeciesMackerel: "கானாங்கெளுத்தி (Mackerel)",
    fmSpeciesKingfish: "வஞ்சிரம் (Kingfish)",
    fmUsesCurrentLocation: "உங்கள் தற்போதைய துறைமுக இருப்பிடம் மற்றும் இன்றைய நேரடி கடல்வாழ் வானிலையைப் பயன்படுத்துகிறது.",
    fmPlanMyTrip: "எனது பயணத்தைத் திட்டமிடு",
    fmRunningModelsBtn: "ஆர்கா மாதிரிகள் இயங்குகின்றன…",
    fmRunningModelsDesc: "ஆர்காவின் ஆன்-டிவைஸ் ML மாதிரிகள் (பிடிப்பு, மண்டலம், இனம், விலை) மற்றும் லாப & இடர் இயந்திரம் இயக்கப்படுகிறது…",
    fmRecommendedPlanLabel: "ஆர்காவின் பரிந்துரைக்கப்பட்ட திட்டம்",
    fmTripScoreLabel: "ஆர்கா பயண மதிப்பெண்",
    fmBestZoneLabel: "சிறந்த மண்டலம்",
    fmBestTimeWindowLabel: "சிறந்த நேர இடைவெளி",
    fmHighestPredictedCatch: "அதிகபட்ச கணிக்கப்பட்ட பிடிப்பு",
    fmReliabilityLabel: "நம்பகத்தன்மை",
    fmRiskLabel: "இடர்",
    fmZoneRankingTitle: "மண்டல தரவரிசை · மீன்பிடி திறன்",
    fmSpeciesSuitabilityTitle: "இன தகுதி தரவரிசை",
    fmWhereToSellTitle: "எங்கு விற்பது",
    fmThMarket: "சந்தை",
    fmThDistance: "தூரம்",
    fmThPricePerKg: "விலை/கிலோ",
    fmThNetRevenue: "நிகர வருவாய்",
    fmFeatureImportanceTitle: "இந்த கணிப்பை இயக்குவது என்ன",
    fmFeatureImportanceDesc: "இந்த பயணத்திற்கு பிடிப்பு மாதிரி உண்மையில் கருதிய முக்கிய காரணிகள் — கண்டுபிடிக்கப்படவில்லை, பயிற்சி பெற்ற மாதிரியிலிருந்து படிக்கப்பட்ட உண்மையான முக்கியத்துவங்கள்.",
    fmWhyOrcaTitle: "ஆர்கா இதை ஏன் தேர்ந்தெடுத்தது",
    fmModelTransparencyTitle: "மாதிரி வெளிப்படைத்தன்மை",
    fmModelTransparencyDisclaimer: "டெமோ மாதிரி — மேலே உள்ள ஒவ்வொரு மாதிரியும் ஆர்காவின் செயற்கை மாதிரித் தரவுத்தொகுப்பில் பயிற்சி பெற்றுள்ளது, உண்மையான வரலாற்று பிடிப்பு பதிவுகளில் அல்ல. நம்பகத்தன்மை புள்ளிவிவரங்கள் அந்த தரவுத்தொகுப்பில் அளவிடப்பட்டவை, நிஜ உலக துல்லியம் அல்ல.",
    fmZonesMapTitle: "சிறந்த மீன் விளைச்சல் மண்டலங்கள் · நேரடி வரைபடம்",
    fmZonesMapDesc: "இன்றைய வாய்ப்பில் பயன்படுத்தப்படும் அதே நேரடி-மதிப்பிடப்பட்ட Ocean Analytics & PFZ முகவர் தரவு, GIS கட்டளை வரைபடத்தின் அடிப்படை வரைபடத்தில் காட்டப்படுகிறது.",
    fmRankedByYieldTitle: "விளைச்சல் அடிப்படையில் தரவரிசை",
    fmLoadingZones: "மண்டலங்கள் ஏற்றப்படுகின்றன…",
    fmTopZoneLabel: "சிறந்த மண்டலம்:",
    fmYieldScoreLabel: "விளைச்சல் மதிப்பெண்:",
    fmLoadingPricing: "விலை ஒப்பீடு ஏற்றப்படுகிறது…",
    fmTypicalPriceLabel: "வழக்கமான முறைசாரா விலை",
    fmOpportunityPriceLabel: "ஆர்கா வாய்ப்பு விலை",
    fmExtraRevenueLabel: "சாத்தியமான கூடுதல் வருவாய்",
    fmSpeciesPriceRankingTitle: "இன விலை தரவரிசை",
    fmThSpecies: "இனம்",
    fmThTrend: "போக்கு",
    fmThDemand: "தேவை",
    fmThEstProfit: "மதிப்பிடப்பட்ட லாபம்",
    fmThOpportunityScore: "வாய்ப்பு மதிப்பெண்",
    fmBuyerLeadsTitle: "வாங்குபவர் தொடர்புகள்",
    fmTripCostCalcTitle: "பயண-செலவு கால்குலேட்டர்",
    fmSpeciesLabel: "இனம்",
    fmExpectedCatchKgLabel: "எதிர்பார்க்கப்படும் பிடிப்பு (கிலோ)",
    fmPricePerKgLabel: "கிலோவுக்கு விலை (₹)",
    fmFuelLabel: "எரிபொருள் (₹)",
    fmIceLabel: "பனிக்கட்டி (₹)",
    fmOtherLabel: "மற்றவை (₹)",
    fmRecalculateBtn: "மீண்டும் கணக்கிடு",
    fmTripSummaryTitle: "பயண சுருக்கம்",
    fmGrossRevenueLabel: "மொத்த வருவாய்:",
    fmTotalTripCostLabel: "மொத்த பயண செலவு:",
    fmNetProfitLabel: "நிகர லாபம்:",
    fmProfitMarginLabel: "லாப வரம்பு:",
    fmCalcDefaultsNote: "இன்றைய பரிந்துரைக்கப்பட்ட இனம் மற்றும் இந்த ஆப்பின் சிமுலேட் செய்யப்பட்ட சந்தை தரவிலிருந்து இயல்புநிலைகள் முன் நிரப்பப்பட்டுள்ளன — எந்த புலத்தையும் மாற்றி மீண்டும் கணக்கிடு பொத்தானை அழுத்தவும்.",
    fmTripPerformanceTitle: "உங்கள் பயண செயல்திறன்",
    fmLoadingPerformance: "செயல்திறன் வரலாறு ஏற்றப்படுகிறது…",
    fmThTrip: "பயணம்",
    fmThCatchKg: "பிடிப்பு (கிலோ)",
    fmThRevenue: "வருவாய்",
    fmThProfit: "லாபம்",
    fmCommunityFeedTitle: "சமூகம் & ஆலோசனை ஊட்டம்",
    fmBuiltBy: "உருவாக்கியவர்",
    fmHackathonLine: "ஸ்மார்ட் இந்தியா ஹேக்கத்தான் 2026 · பிரச்சனை அறிக்கை 26176 (இஸ்ரோ)",
    fmFooterDisclaimer: "மறுப்பு: இன சந்தை விலைகள், வாங்குபவர் தொடர்புகள் மற்றும் பயண வரலாறு ஸ்மார்ட் இந்தியா ஹேக்கத்தான் 2026 நடுவர் காட்சிக்காக சிமுலேட் செய்யப்பட்டவை.",
    fmNoTripHistory: "இதுவரை பயண வரலாறு எதுவும் பதிவு செய்யப்படவில்லை.",
    fmYourCatch: "உங்கள் பிடிப்பு",
    fmTripAgoSingular: "{n} பயணம் முன்பு",
    fmTripAgoPlural: "{n} பயணங்கள் முன்பு",
    fmTargetSpeciesColon: "இலக்கு மீன் இனம்:",
    fmYieldWord: "விளைச்சல்",
    fmSstLabel: "SST:",
    fmDepthLabel: "ஆழம்:",
    fmSafetyLabel: "பாதுகாப்பு:",
    fmOpportunityDescTemplate: "இன்று ₹{price}/கிலோவில் {zone} அருகே சிறந்த பொருத்தம் — மொத்த வாய்ப்பு மதிப்பெண் {score}/100.",
    fmTheRecommendedZone: "பரிந்துரைக்கப்பட்ட மண்டலம்",
    fmSellSmarterDescTemplate: "{species}: முறைசாரா சந்தைக்கு பதிலாக ஆர்கா-பொருத்திய வாங்குபவருக்கு விற்பது, {catch} கிலோ பிடிப்பில் மதிப்பிடப்பட்ட கூடுதல் {revenue} வருவாயைத் தரும்.",
    fmAiErrorTemplate: "ஆர்காவின் AI முடிவெடுக்கும் மைய பின்தளத்தை அடைய முடியவில்லை ({error}). ML மாதிரிகளுக்கு பயிற்சி அளிக்க ஒருமுறை பின்தள அமைப்பு தேவை -- backend/ml/training/ ஐப் பார்க்கவும். சிறிது நேரத்தில் மீண்டும் முயற்சிக்கவும்.",
    fmPlanDescTemplate: "சிறந்த இடைவெளி {window} · {market} இல் விற்கவும் · ஆர்கா பயண மதிப்பெண் {score}/100.",
    fmTheRecommendedMarket: "பரிந்துரைக்கப்பட்ட சந்தை",
    fmKmFromPortTemplate: "துறைமுகத்திலிருந்து {km} கிமீ",
    fmStatusLive: "நேரடி",
    fmStatusOffline: "பின்தளம் ஆஃப்லைன் — கடைசியாக அறியப்பட்ட தரவு காட்டப்படுகிறது",
    fmScoreOcean: "கடல் பாதுகாப்பு",
    fmScoreFish: "மீன் விளைச்சல்",
    fmScoreMarket: "சந்தை வேகம்",
    fmScoreProfit: "லாப வரம்பு",
    fmTierHigh: "அதிகம்",
    fmTierGood: "நல்லது",
    fmTierModerate: "மிதமானது",
    fmPostWeatherAlert: "வானிலை எச்சரிக்கை",
    fmPostMarketUpdate: "சந்தை புதுப்பிப்பு",
    fmPostFishermanReport: "மீனவர் அறிக்கை",
    fmPostUpdate: "புதுப்பிப்பு",
    fmNearbyBusinessesTitle: "அருகிலுள்ள கடல் உணவு வாங்குபவர்கள் & சந்தைகள் · நேரடி",
    fmNearbyBusinessesDesc: "உங்கள் தற்போதைய இருப்பிடத்திற்கு அருகில் OpenStreetMap வழியாக உண்மையான, நேரடி தரவு — கடல் உணவை வாங்கும்/பரிமாறும் அருகிலுள்ள உணவகங்கள் மற்றும் கடைகள். இது வாங்குபவர் தேவை/லீட் அல்ல; அதற்கு கீழே வாங்குபவர் தொடர்புகளைப் பார்க்கவும்.",
    fmRefreshBtn: "புதுப்பிக்கவும்",
    fmLoadingNearby: "அருகிலுள்ள கடல் உணவு வாங்குபவர்களை சரிபார்க்கிறது…",
    fmNearbyBadgeLive: "நேரடி",
    fmNearbyBadgeUnavailable: "கிடைக்கவில்லை",
    fmNearbyNoneFound: "இப்போது வரம்பிற்குள் கடல் உணவு வாங்குபவர்கள் அல்லது சந்தைகள் எதுவும் கிடைக்கவில்லை.",
    fmNearbyFailed: "இப்போது நேரடி அருகிலுள்ள வணிக தரவை அணுக முடியவில்லை.",
    fmPostBuyerDemandBtn: "+ வாங்குபவர் தேவையை பதிவிடவும்",
    fmBuyerLeadsRealNote: "நேரடி என குறியிடப்பட்ட லீட்கள் ORCA இன் வாங்குபவர் நெட்வொர்க் மூலம் பதிவிடப்பட்ட உண்மையான, சரிபார்க்கப்பட்ட வாங்குபவர் தேவைகள். மற்றவை உருவகப்படுத்தப்பட்ட டெமோ தரவு.",
    fmBuyerModalTitle: "உண்மையான வாங்குபவர் தேவையை பதிவிடவும்",
    fmBuyerModalDesc: "உங்கள் மின்னஞ்சலுக்கு அனுப்பப்படும் ஒரு முறை குறியீட்டால் சரிபார்க்கப்படும் (இந்த டெமோவிற்கு மின்னஞ்சல் கட்டமைக்கப்படவில்லை எனில் இங்கே நேரடியாக காட்டப்படும்). ORCA இல் எந்த பணமும் செலுத்தப்படாது — இது உங்களை மீனவர்களுடன் இணைக்கிறது.",
    fmBuyerBusinessNameLabel: "வணிகத்தின் பெயர்",
    fmBuyerEmailLabel: "தொடர்பு மின்னஞ்சல்",
    fmBuyerLocationLabel: "இடம்",
    fmBuyerSendCodeBtn: "சரிபார்ப்பு குறியீட்டை அனுப்பவும்",
    fmBuyerDevOtpTemplate: "இந்த டெமோவிற்கு மின்னஞ்சல் கட்டமைக்கப்படவில்லை — உங்கள் குறியீடு {code}",
    fmBuyerOtpLabel: "சரிபார்ப்பு குறியீடு",
    fmBuyerVerifyBtn: "குறியீட்டை சரிபார்க்கவும்",
    fmBuyerQtyLabel: "தேவையான அளவு (கிலோ)",
    fmBuyerDeadlineLabel: "கடைசி தேதி",
    fmBuyerPriceMinLabel: "குறைந்தபட்ச விலை (₹/கிலோ)",
    fmBuyerPriceMaxLabel: "அதிகபட்ச விலை (₹/கிலோ)",
    fmBuyerListingLocationLabel: "பெறும் இடம்",
    fmBuyerPostListingBtn: "பட்டியலை பதிவிடவும்",
    fmBuyerSuccessTitle: "பட்டியல் பதிவிடப்பட்டது",
    fmBuyerSuccessDesc: "உங்கள் உண்மையான வாங்குபவர் தேவை இப்போது வாங்குபவர் தொடர்புகளில் நேரடியாக உள்ளது, மீனவர்கள் இதைப் பார்த்து உரிமை கோரலாம்.",
    fmBuyerDoneBtn: "முடிந்தது",
    fmBuyerErrRequired: "வணிகத்தின் பெயர் மற்றும் மின்னஞ்சல் தேவை.",
    fmBuyerErrOtp: "சரிபார்ப்பு குறியீட்டை உள்ளிடவும்.",
    fmBuyerErrGeneric: "ஏதோ தவறு நடந்தது — மீண்டும் முயற்சிக்கவும்.",
    fmBuyerErrQty: "கிலோவில் தேவையான அளவை உள்ளிடவும்.",
    fmBuyerLiveTag: "நேரடி",
    fmBuyerDemoTag: "டெமோ",
    fmClaimBtn: "இந்த லீட்டை உரிமை கோரவும்",
    fmClaimPromptText: "இதை நிறைவேற்றுவது யார் என்று வாங்குபவருக்குத் தெரிய உங்கள் பெயர் மற்றும் தொலைபேசி/தொடர்பை உள்ளிடவும்:",
    fmClaimSuccess: "உரிமை கோரப்பட்டது — வாங்குபவருக்கு தளத்திற்கு வெளியே தெரிவிக்கப்படும்.",
    fmClaimFailed: "இப்போது இந்த பட்டியலை உரிமை கோர முடியவில்லை."
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
    navFleetGIS: "ഫ്ലീറ്റ് & ജിഐഎസ് കമാൻഡ്",
    navNavic: "നാവിക് (NavIC) ജി.പി.എസ്",
    navBulletins: "ബുള്ളറ്റിനുകൾ",
    navSafetyAdv: "സുരക്ഷയും ഉപദേശങ്ങളും",
    heroTitle: "ഇന്ത്യൻ സമുദ്രത്തിനായുള്ള സമ്പൂർണ്ണ എ.ഐ സഹായം",
    heroDesc: "ഐ.എസ്.ആർ.ഒ ഓഷ്യൻസാറ്റ്-3, ഇൻസാറ്റ്-3ഡിആർ ഉപഗ്രഹ വിവരങ്ങൾ, സമുദ്രാതിർത്തി (IMBL), മത്സ്യസാന്നിധ്യ മേഖലകൾ (PFZ), തത്സമയ ബോട്ട് വിവരങ്ങൾ എന്നിവ ലഭ്യമാക്കുന്നു.",
    ctaStudio: "എ.ഐ സ്റ്റുഡിയോ തുറക്കുക",
    ctaMap: "കമാൻഡ് മാപ്പ് തുറക്കുക",
    ctaFleet: "ഫ്ലീറ്റ് മോണിറ്റർ",
    ctaFleetGIS: "ഫ്ലീറ്റ് & ജിഐഎസ് കമാൻഡ് തുറക്കുക",
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
    simulatedDisclaimer: "ശ്രദ്ധിക്കുക: നിലവിൽ റിസീവർ കവറേജ് ഇല്ലാത്ത സ്ഥലങ്ങളിൽ ലൈവ് AIS ബോട്ട് സ്ഥാനങ്ങൾ, വ്യക്തമായി അടയാളപ്പെടുത്തിയ സിമുലേറ്റഡ് കപ്പലുകൾ ഉപയോഗിച്ച് പൂരിപ്പിക്കുന്നു. ഉപഗ്രഹ സമുദ്ര വിവരങ്ങൾ SIH 2026 അവതരണത്തിനായി സിമുലേറ്റ് ചെയ്തതു തന്നെയാണ്.",
    bigVerdictQuestion: "ഇന്ന് മീൻപിടിക്കാൻ പോകുന്നത് സുരക്ഷിതമാണോ?",
    bigVerdictYes: "അതെ",
    bigVerdictNo: "ഇല്ല",
    bigVerdictCaution: "ജാഗ്രത",
    listenVerdict: "കേൾക്കുക",

    // ---- ORCA FISHERMAN module ----
    fmTitle: "ഓർക്ക ഫിഷർമാൻ (ORCA FISHERMAN)",
    fmSubtitle: "ദൈനംദിന അവസര കൺസോൾ · ടീം സേവ്യേഴ്സ്എക്സ്",
    fmLiveFeedBadge: "തത്സമയ അവസര ഫീഡ്",
    fmToggleDarkMode: "ഡാർക്ക് മോഡ് മാറ്റുക",
    fmBackToHub: "← ഹബ്",
    fmBackToHubTitle: "ഓർക്ക ഹബിലേക്ക് മടങ്ങുക",
    fmNavOpportunity: "ഇന്നത്തെ അവസരം",
    fmNavMap: "മത്സ്യമേഖല മാപ്പ്",
    fmNavSell: "മിടുക്കോടെ വിൽക്കുക",
    fmNavCalculator: "യാത്രാ ചെലവ് കാൽക്കുലേറ്റർ",
    fmNavCommunity: "പ്രകടനവും സമൂഹവും",
    fmCheckingBackend: "ബാക്കെൻഡ് പരിശോധിക്കുന്നു...",
    fmBestOpportunityLabel: "ഇന്നത്തെ മികച്ച അവസരം",
    fmLoadingOpportunityDesc: "ഫിഷർമാൻ അവസര ഏജന്റിൽ നിന്ന് ഇന്നത്തെ അവസരം ലോഡ് ചെയ്യുന്നു…",
    fmPreferredSpeciesLabel: "ഇഷ്ടപ്പെട്ട മത്സ്യയിനം:",
    fmAutoBestMatch: "ഓട്ടോ (മികച്ച പൊരുത്തം)",
    fmOpportunityScoreLabel: "അവസര സ്കോർ",
    fmRecommendedZoneLabel: "ശുപാർശ ചെയ്ത മേഖല",
    fmExpectedCatchLabel: "പ്രതീക്ഷിക്കുന്ന പിടിത്തം",
    fmAtTodaysPrice: "ഇന്നത്തെ വിലയിൽ",
    fmRevenueRangeLabel: "വരുമാന പരിധി",
    fmBeforeTripCosts: "യാത്രാ ചെലവിന് മുൻപ്",
    fmEstimatedProfitLabel: "കണക്കാക്കിയ ലാഭം",
    fmConfidenceLabel: "വിശ്വാസ്യത",
    fmScoreBreakdownTitle: "അവസര സ്കോർ വിശദാംശം",
    fmAiStudioTitle: "എ.ഐ ഡിസിഷൻ സ്റ്റുഡിയോ — നിങ്ങളുടെ യാത്ര ആസൂത്രണം ചെയ്യുക",
    fmAiStudioDesc: "ഓർക്കയുടെ സ്വന്തം ഡാറ്റയിൽ പരിശീലനം നേടിയ 4 ഓൺ-ഡിവൈസ് scikit-learn മോഡലുകൾ (പിടിത്തം, മേഖല, ഇനം, വില), ഒരു നിശ്ചിത ലാഭ & റിസ്ക് എഞ്ചിനുമായി ചേർന്ന് പ്രവർത്തിക്കുന്നു. ഈ പ്രക്രിയയിൽ എവിടെയും ബാഹ്യ എ.ഐ എ.പി.ഐ ഉപയോഗിക്കുന്നില്ല.",
    fmDemoModelBadge: "ഡെമോ മോഡൽ · സിന്തറ്റിക് പരിശീലന ഡാറ്റ",
    fmTripPlannerTitle: "യാത്രാ ആസൂത്രകൻ",
    fmBoatTypeLabel: "ബോട്ട് തരം",
    fmBoatTraditional: "പരമ്പരാഗതം (യന്ത്രവൽക്കരിക്കാത്തത്)",
    fmBoatMotorized: "മോട്ടോർവൽക്കരിച്ചത്",
    fmBoatMechanized: "യന്ത്രവൽക്കരിച്ച ട്രോളർ",
    fmGearTypeLabel: "വല തരം",
    fmGearGillnet: "ഗിൽനെറ്റ്",
    fmGearTrawl: "ട്രോൾ",
    fmGearRingSeine: "റിംഗ് സീൻ",
    fmGearLongline: "ലോംഗ്‌ലൈൻ",
    fmGearHookLine: "ചൂണ്ടയും ചരടും",
    fmTripDurationLabel: "യാത്രാ ദൈർഘ്യം (മണിക്കൂർ)",
    fmTargetSpeciesLabel: "ലക്ഷ്യമിടുന്ന ഇനം",
    fmSpeciesTuna: "ചൂര (Tuna)",
    fmSpeciesPomfret: "ആവോലി (Pomfret)",
    fmSpeciesSardine: "മത്തി (Sardine)",
    fmSpeciesMackerel: "അയല (Mackerel)",
    fmSpeciesKingfish: "അയക്കൂറ (Kingfish)",
    fmUsesCurrentLocation: "നിങ്ങളുടെ നിലവിലെ തുറമുഖ സ്ഥാനവും ഇന്നത്തെ തത്സമയ കടൽ കാലാവസ്ഥയും ഉപയോഗിക്കുന്നു.",
    fmPlanMyTrip: "എന്റെ യാത്ര ആസൂത്രണം ചെയ്യുക",
    fmRunningModelsBtn: "ഓർക്ക മോഡലുകൾ പ്രവർത്തിക്കുന്നു…",
    fmRunningModelsDesc: "ഓർക്കയുടെ ഓൺ-ഡിവൈസ് എം.എൽ മോഡലുകൾ (പിടിത്തം, മേഖല, ഇനം, വില) കൂടാതെ ലാഭ & റിസ്ക് എഞ്ചിനും പ്രവർത്തിപ്പിക്കുന്നു…",
    fmRecommendedPlanLabel: "ഓർക്കയുടെ ശുപാർശിത പദ്ധതി",
    fmTripScoreLabel: "ഓർക്ക യാത്രാ സ്കോർ",
    fmBestZoneLabel: "മികച്ച മേഖല",
    fmBestTimeWindowLabel: "മികച്ച സമയ പരിധി",
    fmHighestPredictedCatch: "ഏറ്റവും ഉയർന്ന പ്രവചിത പിടിത്തം",
    fmReliabilityLabel: "വിശ്വാസ്യത",
    fmRiskLabel: "റിസ്ക്",
    fmZoneRankingTitle: "മേഖല റാങ്കിംഗ് · മത്സ്യബന്ധന ശേഷി",
    fmSpeciesSuitabilityTitle: "ഇന അനുയോജ്യതാ റാങ്കിംഗ്",
    fmWhereToSellTitle: "എവിടെ വിൽക്കണം",
    fmThMarket: "മാർക്കറ്റ്",
    fmThDistance: "ദൂരം",
    fmThPricePerKg: "വില/കിലോ",
    fmThNetRevenue: "അറ്റ വരുമാനം",
    fmFeatureImportanceTitle: "ഈ പ്രവചനത്തെ നയിക്കുന്നത് എന്ത്",
    fmFeatureImportanceDesc: "ഈ യാത്രയ്ക്കായി പിടിത്ത മോഡൽ യഥാർത്ഥത്തിൽ പരിഗണിച്ച പ്രധാന ഘടകങ്ങൾ — കണ്ടുപിടിച്ചതല്ല, പരിശീലനം ലഭിച്ച മോഡലിൽ നിന്ന് വായിച്ചെടുത്ത യഥാർത്ഥ ഫീച്ചർ പ്രാധാന്യങ്ങൾ.",
    fmWhyOrcaTitle: "ഓർക്ക ഇത് തിരഞ്ഞെടുത്തത് എന്തുകൊണ്ട്",
    fmModelTransparencyTitle: "മോഡൽ സുതാര്യത",
    fmModelTransparencyDisclaimer: "ഡെമോ മോഡൽ — മുകളിലുള്ള എല്ലാ മോഡലുകളും ഓർക്കയുടെ സിന്തറ്റിക് ഡെമോൺസ്ട്രേഷൻ ഡാറ്റാസെറ്റിൽ പരിശീലനം നേടിയതാണ്, യഥാർത്ഥ ചരിത്രപരമായ പിടിത്ത രേഖകളിലല്ല. വിശ്വാസ്യതാ കണക്കുകൾ ആ ഡാറ്റാസെറ്റിൽ അളന്നതാണ്, യഥാർത്ഥ ലോക കൃത്യതയല്ല.",
    fmZonesMapTitle: "മികച്ച മത്സ്യ വിളവ് മേഖലകൾ · തത്സമയ മാപ്പ്",
    fmZonesMapDesc: "ഇന്നത്തെ അവസരത്തിൽ ഉപയോഗിക്കുന്ന അതേ തത്സമയ-സ്കോർ ചെയ്ത Ocean Analytics & PFZ ഏജന്റ് ഡാറ്റ, GIS കമാൻഡ് മാപ്പിന്റെ അടിസ്ഥാന മാപ്പിൽ കാണിച്ചിരിക്കുന്നു.",
    fmRankedByYieldTitle: "വിളവ് അനുസരിച്ച് റാങ്ക് ചെയ്തത്",
    fmLoadingZones: "മേഖലകൾ ലോഡ് ചെയ്യുന്നു…",
    fmTopZoneLabel: "ഏറ്റവും മികച്ച മേഖല:",
    fmYieldScoreLabel: "വിളവ് സ്കോർ:",
    fmLoadingPricing: "വില താരതമ്യം ലോഡ് ചെയ്യുന്നു…",
    fmTypicalPriceLabel: "സാധാരണ അനൗപചാരിക വില",
    fmOpportunityPriceLabel: "ഓർക്ക അവസര വില",
    fmExtraRevenueLabel: "സാധ്യമായ അധിക വരുമാനം",
    fmSpeciesPriceRankingTitle: "ഇന വില റാങ്കിംഗ്",
    fmThSpecies: "ഇനം",
    fmThTrend: "പ്രവണത",
    fmThDemand: "ആവശ്യം",
    fmThEstProfit: "കണക്കാക്കിയ ലാഭം",
    fmThOpportunityScore: "അവസര സ്കോർ",
    fmBuyerLeadsTitle: "വാങ്ങുന്നവരുടെ ബന്ധങ്ങൾ",
    fmTripCostCalcTitle: "യാത്രാ-ചെലവ് കാൽക്കുലേറ്റർ",
    fmSpeciesLabel: "ഇനം",
    fmExpectedCatchKgLabel: "പ്രതീക്ഷിക്കുന്ന പിടിത്തം (കിലോ)",
    fmPricePerKgLabel: "കിലോയ്ക്ക് വില (₹)",
    fmFuelLabel: "ഇന്ധനം (₹)",
    fmIceLabel: "ഐസ് (₹)",
    fmOtherLabel: "മറ്റുള്ളവ (₹)",
    fmRecalculateBtn: "വീണ്ടും കണക്കാക്കുക",
    fmTripSummaryTitle: "യാത്രാ സംഗ്രഹം",
    fmGrossRevenueLabel: "മൊത്ത വരുമാനം:",
    fmTotalTripCostLabel: "ആകെ യാത്രാ ചെലവ്:",
    fmNetProfitLabel: "അറ്റ ലാഭം:",
    fmProfitMarginLabel: "ലാഭ മാർജിൻ:",
    fmCalcDefaultsNote: "ഇന്നത്തെ ശുപാർശിത ഇനവും ഈ ആപ്പിന്റെ സിമുലേറ്റഡ് മാർക്കറ്റ് ഡാറ്റയും ഉപയോഗിച്ചാണ് സ്ഥിരസ്ഥിതികൾ മുൻകൂട്ടി പൂരിപ്പിച്ചിരിക്കുന്നത് — ഏത് ഫീൽഡും മാറ്റി വീണ്ടും കണക്കാക്കുക അമർത്തുക.",
    fmTripPerformanceTitle: "നിങ്ങളുടെ യാത്രാ പ്രകടനം",
    fmLoadingPerformance: "പ്രകടന ചരിത്രം ലോഡ് ചെയ്യുന്നു…",
    fmThTrip: "യാത്ര",
    fmThCatchKg: "പിടിത്തം (കിലോ)",
    fmThRevenue: "വരുമാനം",
    fmThProfit: "ലാഭം",
    fmCommunityFeedTitle: "സമൂഹവും ഉപദേശ ഫീഡും",
    fmBuiltBy: "നിർമ്മിച്ചത്",
    fmHackathonLine: "സ്മാർട്ട് ഇന്ത്യ ഹാക്കത്തോൺ 2026 · പ്രശ്ന പ്രസ്താവന 26176 (ഐ.എസ്.ആർ.ഒ)",
    fmFooterDisclaimer: "മുന്നറിയിപ്പ്: ഇന മാർക്കറ്റ് വിലകൾ, വാങ്ങുന്നവരുടെ ബന്ധങ്ങൾ, യാത്രാ ചരിത്രം എന്നിവ സ്മാർട്ട് ഇന്ത്യ ഹാക്കത്തോൺ 2026 വിലയിരുത്തൽ പ്രദർശനത്തിനായി സിമുലേറ്റ് ചെയ്തതാണ്.",
    fmNoTripHistory: "ഇതുവരെ യാത്രാ ചരിത്രം രേഖപ്പെടുത്തിയിട്ടില്ല.",
    fmYourCatch: "നിങ്ങളുടെ പിടിത്തം",
    fmTripAgoSingular: "{n} യാത്ര മുൻപ്",
    fmTripAgoPlural: "{n} യാത്രകൾ മുൻപ്",
    fmTargetSpeciesColon: "ലക്ഷ്യമിടുന്ന ഇനം:",
    fmYieldWord: "വിളവ്",
    fmSstLabel: "SST:",
    fmDepthLabel: "ആഴം:",
    fmSafetyLabel: "സുരക്ഷ:",
    fmOpportunityDescTemplate: "ഇന്ന് ₹{price}/കിലോയിൽ {zone} ന് സമീപം മികച്ച പൊരുത്തം — മൊത്തം അവസര സ്കോർ {score}/100.",
    fmTheRecommendedZone: "ശുപാർശ ചെയ്ത മേഖല",
    fmSellSmarterDescTemplate: "{species}: അനൗപചാരിക മാർക്കറ്റിന് പകരം ഓർക്ക-പൊരുത്തപ്പെടുത്തിയ വാങ്ങുന്നയാൾക്ക് വിൽക്കുന്നത് {catch} കിലോ പിടിത്തത്തിൽ കണക്കാക്കിയ അധിക {revenue} വരുമാനം നേടിത്തരുന്നു.",
    fmAiErrorTemplate: "ഓർക്കയുടെ എ.ഐ ഡിസിഷൻ സ്റ്റുഡിയോ ബാക്കെൻഡിലേക്ക് എത്താൻ കഴിഞ്ഞില്ല ({error}). എം.എൽ മോഡലുകൾ പരിശീലിപ്പിക്കാൻ ഒറ്റത്തവണ ബാക്കെൻഡ് സജ്ജീകരണം ആവശ്യമാണ് -- backend/ml/training/ കാണുക. അൽപ്പസമയത്തിനുള്ളിൽ വീണ്ടും ശ്രമിക്കുക.",
    fmPlanDescTemplate: "മികച്ച സമയപരിധി {window} · {market} ൽ വിൽക്കുക · ഓർക്ക യാത്രാ സ്കോർ {score}/100.",
    fmTheRecommendedMarket: "ശുപാർശ ചെയ്ത മാർക്കറ്റ്",
    fmKmFromPortTemplate: "തുറമുഖത്ത് നിന്ന് {km} കിമീ",
    fmStatusLive: "തത്സമയം",
    fmStatusOffline: "ബാക്കെൻഡ് ഓഫ്‌ലൈൻ — അവസാനം അറിയാവുന്ന ഡാറ്റ കാണിക്കുന്നു",
    fmScoreOcean: "സമുദ്ര സുരക്ഷ",
    fmScoreFish: "മത്സ്യ വിളവ്",
    fmScoreMarket: "മാർക്കറ്റ് ചലനം",
    fmScoreProfit: "ലാഭ മാർജിൻ",
    fmTierHigh: "ഉയർന്നത്",
    fmTierGood: "നല്ലത്",
    fmTierModerate: "മിതമായത്",
    fmPostWeatherAlert: "കാലാവസ്ഥാ മുന്നറിയിപ്പ്",
    fmPostMarketUpdate: "മാർക്കറ്റ് അപ്ഡേറ്റ്",
    fmPostFishermanReport: "മത്സ്യത്തൊഴിലാളി റിപ്പോർട്ട്",
    fmPostUpdate: "അപ്ഡേറ്റ്",
    fmNearbyBusinessesTitle: "സമീപത്തെ കടൽ ഭക്ഷണ വാങ്ങുന്നവരും മാർക്കറ്റുകളും · തത്സമയം",
    fmNearbyBusinessesDesc: "നിങ്ങളുടെ നിലവിലെ സ്ഥാനത്തിന് സമീപം OpenStreetMap വഴി യഥാർത്ഥ, തത്സമയ ഡാറ്റ — കടൽ ഭക്ഷണം വാങ്ങുന്ന/വിളമ്പുന്ന സമീപത്തെ റെസ്റ്റോറന്റുകളും കടകളും. ഇത് ഒരു വാങ്ങൽ ആവശ്യം/ലീഡ് അല്ല; അതിന് താഴെയുള്ള വാങ്ങുന്നവരുടെ ബന്ധങ്ങൾ കാണുക.",
    fmRefreshBtn: "പുതുക്കുക",
    fmLoadingNearby: "സമീപത്തെ കടൽ ഭക്ഷണ വാങ്ങുന്നവരെ പരിശോധിക്കുന്നു…",
    fmNearbyBadgeLive: "തത്സമയം",
    fmNearbyBadgeUnavailable: "ലഭ്യമല്ല",
    fmNearbyNoneFound: "ഇപ്പോൾ പരിധിക്കുള്ളിൽ കടൽ ഭക്ഷണ വാങ്ങുന്നവരോ മാർക്കറ്റുകളോ കണ്ടെത്തിയില്ല.",
    fmNearbyFailed: "ഇപ്പോൾ തത്സമയ സമീപ ബിസിനസ് ഡാറ്റ ലഭ്യമാക്കാൻ കഴിഞ്ഞില്ല.",
    fmPostBuyerDemandBtn: "+ വാങ്ങൽ ആവശ്യം പോസ്റ്റ് ചെയ്യുക",
    fmBuyerLeadsRealNote: "തത്സമയം എന്ന് ടാഗ് ചെയ്ത ലീഡുകൾ ORCA യുടെ ബയർ നെറ്റ്‌വർക്ക് വഴി പോസ്റ്റ് ചെയ്ത യഥാർത്ഥ, സ്ഥിരീകരിച്ച വാങ്ങൽ ആവശ്യങ്ങളാണ്. ബാക്കിയുള്ളവ അനുകരിച്ച ഡെമോ ഡാറ്റയാണ്.",
    fmBuyerModalTitle: "യഥാർത്ഥ വാങ്ങൽ ആവശ്യം പോസ്റ്റ് ചെയ്യുക",
    fmBuyerModalDesc: "നിങ്ങളുടെ ഇമെയിലിലേക്ക് അയച്ച ഒറ്റത്തവണ കോഡ് വഴി സ്ഥിരീകരിക്കുന്നു (ഈ ഡെമോയ്ക്ക് ഇമെയിൽ ക്രമീകരിച്ചിട്ടില്ലെങ്കിൽ ഇവിടെ നേരിട്ട് കാണിക്കും). ORCA യിൽ പണമിടപാടുകൾ ഒന്നും നടക്കുന്നില്ല — ഇത് നിങ്ങളെ മത്സ്യത്തൊഴിലാളികളുമായി ബന്ധിപ്പിക്കുക മാത്രം ചെയ്യുന്നു.",
    fmBuyerBusinessNameLabel: "ബിസിനസ്സിന്റെ പേര്",
    fmBuyerEmailLabel: "ബന്ധപ്പെടേണ്ട ഇമെയിൽ",
    fmBuyerLocationLabel: "സ്ഥലം",
    fmBuyerSendCodeBtn: "സ്ഥിരീകരണ കോഡ് അയയ്ക്കുക",
    fmBuyerDevOtpTemplate: "ഈ ഡെമോയ്ക്ക് ഇമെയിൽ ക്രമീകരിച്ചിട്ടില്ല — നിങ്ങളുടെ കോഡ് {code}",
    fmBuyerOtpLabel: "സ്ഥിരീകരണ കോഡ്",
    fmBuyerVerifyBtn: "കോഡ് സ്ഥിരീകരിക്കുക",
    fmBuyerQtyLabel: "ആവശ്യമായ അളവ് (കി.ഗ്രാം)",
    fmBuyerDeadlineLabel: "അവസാന തീയതി",
    fmBuyerPriceMinLabel: "കുറഞ്ഞ വില (₹/കി.ഗ്രാം)",
    fmBuyerPriceMaxLabel: "കൂടിയ വില (₹/കി.ഗ്രാം)",
    fmBuyerListingLocationLabel: "പിക്കപ്പ് സ്ഥലം",
    fmBuyerPostListingBtn: "ലിസ്റ്റിംഗ് പോസ്റ്റ് ചെയ്യുക",
    fmBuyerSuccessTitle: "ലിസ്റ്റിംഗ് പോസ്റ്റ് ചെയ്തു",
    fmBuyerSuccessDesc: "നിങ്ങളുടെ യഥാർത്ഥ വാങ്ങൽ ആവശ്യം ഇപ്പോൾ വാങ്ങുന്നവരുടെ ബന്ധങ്ങളിൽ തത്സമയം ലഭ്യമാണ്, മത്സ്യത്തൊഴിലാളികൾക്ക് ഇത് കണ്ട് അവകാശപ്പെടാം.",
    fmBuyerDoneBtn: "പൂർത്തിയായി",
    fmBuyerErrRequired: "ബിസിനസ്സിന്റെ പേരും ഇമെയിലും ആവശ്യമാണ്.",
    fmBuyerErrOtp: "സ്ഥിരീകരണ കോഡ് നൽകുക.",
    fmBuyerErrGeneric: "എന്തോ പിഴവ് സംഭവിച്ചു — വീണ്ടും ശ്രമിക്കുക.",
    fmBuyerErrQty: "കിലോഗ്രാമിൽ ആവശ്യമായ അളവ് നൽകുക.",
    fmBuyerLiveTag: "തത്സമയം",
    fmBuyerDemoTag: "ഡെമോ",
    fmClaimBtn: "ഈ ലീഡ് അവകാശപ്പെടുക",
    fmClaimPromptText: "ഇത് ആരാണ് നിറവേറ്റുന്നതെന്ന് വാങ്ങുന്നയാൾ അറിയാൻ നിങ്ങളുടെ പേരും ഫോൺ/ബന്ധപ്പെടാനുള്ള വിവരവും നൽകുക:",
    fmClaimSuccess: "അവകാശപ്പെട്ടു — വാങ്ങുന്നയാളെ പ്ലാറ്റ്‌ഫോമിന് പുറത്ത് അറിയിക്കും.",
    fmClaimFailed: "ഇപ്പോൾ ഈ ലിസ്റ്റിംഗ് അവകാശപ്പെടാൻ കഴിഞ്ഞില്ല."
  },
  gu: {
    appTitle: "ઓર્કા ઇનસાઇટ (ORCA INSIGHT)",
    appSubtitle: "ISRO સહયોગી દરિયાઈ બુદ્ધિમત્તા · SIH 2026 PS 26176",
    teamName: "ટીમ સેવિયર્સએક્સ (Team SavioursX)",
    navHome: "હોમ",
    navChat: "એઆઈ નિર્ણય સ્ટુડિયો",
    navMap: "GIS કમાન્ડ મેપ",
    navDAG: "એજન્ટ DAG વિઝ્યુલાઇઝર",
    navSafety: "સલામતી બેરોમીટર",
    navFleet: "ફ્લીટ મોનિટર",
    navFleetGIS: "ફ્લીટ અને GIS કમાન્ડ",
    navNavic: "નાવિક (NavIC) જીપીએસ",
    navBulletins: "સલાહકારી બુલેટિન",
    navSafetyAdv: "સલામતી અને સલાહકારો",
    heroTitle: "હિંદ મહાસાગર માટે સહયોગી દરિયાઈ બુદ્ધિમત્તા",
    heroDesc: "ISRO Oceansat-3, INSAT-3DR ઉપગ્રહ સમુદ્રશાસ્ત્ર, IMBL જિયોફેન્સિંગ, રિયલ-ટાઇમ ફ્લીટ ડેન્સિટી અને સફર ETA પર તર્ક કરીને ભારતના તટીય માછીમાર સમુદાયને સશક્ત બનાવવું.",
    ctaStudio: "એઆઈ નિર્ણય સ્ટુડિયો શરૂ કરો",
    ctaMap: "GIS કમાન્ડ મેપ ખોલો",
    ctaFleet: "ફ્લીટ મોનિટર તપાસો",
    ctaFleetGIS: "ફ્લીટ અને GIS કમાન્ડ ખોલો",
    statsActiveVessels: "ટ્રેક કરાયેલા સક્રિય જહાજો",
    statsSatellites: "ISRO ઉપગ્રહ ફીડ",
    statsPFZ: "ઉચ્ચ ઉપજવાળા માછીમારી ક્ષેત્રો",
    statsIMBL: "IMBL જિયોફેન્સ કરેલા સેક્ટર",
    chipPFZ: "નજીકનું ઉચ્ચ ઉપજ PFZ શોધો",
    chipSafety: "સમુદ્ર-સફર મંજૂરી તપાસો",
    chipBorder: "IMBL સીમા અંતર તપાસ",
    chipDensity: "જહાજ ઘનતા અને ભીડ",
    chipETA: "ETA અને સુરક્ષિત વળતર સમય ગણો",
    chatPlaceholder: "ORCA ને પૂછો (અથવા બોલવા માટે માઇક્રોફોન દબાવો)...",
    chatSend: "એજન્ટોને પૂછો",
    routePlannerTitle: "સફર માર્ગ સિમ્યુલેટર અને સી-સ્ટેટ ETA",
    originHarbour: "મૂળ માછીમારી બંદર",
    destinationPFZ: "ગંતવ્ય PFZ ઝોન",
    simulateRouteBtn: "સુરક્ષિત માર્ગ અને ETA સિમ્યુલેટ કરો",
    distanceNM: "માર્ગ અંતર (નોટિકલ માઇલ)",
    liveETA: "લાઇવ સી-સ્ટેટ ETA",
    returnDusk: "સંધ્યા-સુધીમાં પરત ફરવાનો સલામતી ચુકાદો",
    sosButton: "SOS ઇમરજન્સી",
    clearanceSafe: "સમુદ્ર-સફર માટે સલામત",
    clearanceCaution: "સાવધાની સાથે આગળ વધો",
    clearanceUnsafe: "અસુરક્ષિત: સફર ન કરો",
    bigVerdictQuestion: "આજે માછીમારી માટે જવું સલામત છે?",
    bigVerdictYes: "હા",
    bigVerdictNo: "ના",
    bigVerdictCaution: "સાવધાની",
    listenVerdict: "સાંભળો",
    waveHeight: "નોંધપાત્ર મોજાની ઊંચાઈ",
    windSpeed: "સપાટી પવન ગતિ",
    seaState: "ડગ્લાસ સી સ્ટેટ",
    lightningRisk: "વીજળી અને તોફાનનું જોખમ",
    vesselTableTitle: "લાઇવ તટીય ફ્લીટ ટેલિમેટ્રી (લાઇવ AIS + સિમ્યુલેટેડ ફિલ-ઇન)",
    simulatedDisclaimer: "નોંધ: જ્યાં હજુ રિસીવર કવરેજ નથી ત્યાં લાઇવ AIS જહાજ સ્થિતિ સ્પષ્ટ રીતે ટેગ કરેલા સિમ્યુલેટેડ ફ્લીટ સાથે ભરવામાં આવે છે. Smart India Hackathon 2026 નિદર્શન માટે ઉપગ્રહ સમુદ્રશાસ્ત્ર સ્તરો સિમ્યુલેટેડ જ રહે છે.",
    fmTitle: "ઓર્કા ફિશરમેન (ORCA FISHERMAN)",
    fmSubtitle: "દૈનિક તક કન્સોલ · ટીમ સેવિયર્સએક્સ",
    fmLiveFeedBadge: "લાઇવ તક ફીડ",
    fmToggleDarkMode: "ડાર્ક મોડ ટૉગલ કરો",
    fmBackToHub: "← હબ",
    fmBackToHubTitle: "ORCA હબ પર પાછા જાઓ",
    fmNavOpportunity: "આજની તક",
    fmNavMap: "માછીમારી ઝોન નકશો",
    fmNavSell: "સ્માર્ટ રીતે વેચો",
    fmNavCalculator: "ટ્રિપ કેલ્ક્યુલેટર",
    fmNavCommunity: "કામગીરી અને સમુદાય",
    fmCheckingBackend: "બેકએન્ડ તપાસી રહ્યા છીએ...",
    fmBestOpportunityLabel: "આજની શ્રેષ્ઠ તક",
    fmLoadingOpportunityDesc: "ફિશરમેન ઓપોર્ચ્યુનિટી એજન્ટ પાસેથી આજની તક લોડ થઈ રહી છે…",
    fmPreferredSpeciesLabel: "પસંદગીની પ્રજાતિ:",
    fmAutoBestMatch: "ઓટો (શ્રેષ્ઠ મેચ)",
    fmOpportunityScoreLabel: "તક સ્કોર",
    fmRecommendedZoneLabel: "ભલામણ કરેલ ઝોન",
    fmExpectedCatchLabel: "અપેક્ષિત પકડ",
    fmAtTodaysPrice: "આજના ભાવે",
    fmRevenueRangeLabel: "આવક શ્રેણી",
    fmBeforeTripCosts: "ટ્રિપ ખર્ચ પહેલાં",
    fmEstimatedProfitLabel: "અંદાજિત નફો",
    fmConfidenceLabel: "વિશ્વાસ સ્તર",
    fmScoreBreakdownTitle: "તક સ્કોર વિભાજન",
    fmAiStudioTitle: "એઆઈ નિર્ણય સ્ટુડિયો — તમારી ટ્રિપનું આયોજન કરો",
    fmAiStudioDesc: "ORCA ના પોતાના ડેટા પર તાલીમ પામેલા 4 ઓન-ડિવાઇસ scikit-learn મોડલ (પકડ, ઝોન, પ્રજાતિ, ભાવ), એક નિશ્ચિત નફો અને જોખમ એન્જિન સાથે મળીને કામ કરે છે. આ સમગ્ર પ્રક્રિયામાં ક્યાંય પણ બાહ્ય એઆઈ API નો ઉપયોગ થતો નથી.",
    fmDemoModelBadge: "ડેમો મોડલ · સિન્થેટિક તાલીમ ડેટા",
    fmTripPlannerTitle: "ટ્રિપ પ્લાનર",
    fmBoatTypeLabel: "બોટનો પ્રકાર",
    fmBoatTraditional: "પરંપરાગત (બિન-યાંત્રિક)",
    fmBoatMotorized: "મોટરવાળી",
    fmBoatMechanized: "યાંત્રિક ટ્રોલર",
    fmGearTypeLabel: "ગિયર પ્રકાર",
    fmGearGillnet: "ગિલનેટ",
    fmGearTrawl: "ટ્રોલ",
    fmGearRingSeine: "રિંગ સીન",
    fmGearLongline: "લોંગલાઇન",
    fmGearHookLine: "હૂક અને લાઇન",
    fmTripDurationLabel: "ટ્રિપનો સમયગાળો (કલાક)",
    fmTargetSpeciesLabel: "લક્ષ્ય પ્રજાતિ",
    fmSpeciesTuna: "ટુના",
    fmSpeciesPomfret: "પોમ્ફ્રેટ",
    fmSpeciesSardine: "સારડીન",
    fmSpeciesMackerel: "મેકરેલ (બાંગડા)",
    fmSpeciesKingfish: "કિંગફિશ (સુરમાઈ)",
    fmUsesCurrentLocation: "તમારા વર્તમાન બંદર સ્થાન અને આજના લાઇવ દરિયાઈ હવામાનનો ઉપયોગ કરે છે.",
    fmPlanMyTrip: "મારી ટ્રિપ પ્લાન કરો",
    fmRunningModelsBtn: "ORCA મોડલ ચાલી રહ્યા છે…",
    fmRunningModelsDesc: "ORCA ના ઓન-ડિવાઇસ ML મોડલ (પકડ, ઝોન, પ્રજાતિ, ભાવ) અને નફો-જોખમ એન્જિન ચલાવી રહ્યા છીએ…",
    fmRecommendedPlanLabel: "ORCA ની ભલામણ કરેલ યોજના",
    fmTripScoreLabel: "ORCA ટ્રિપ સ્કોર",
    fmBestZoneLabel: "શ્રેષ્ઠ ઝોન",
    fmBestTimeWindowLabel: "શ્રેષ્ઠ સમય વિન્ડો",
    fmHighestPredictedCatch: "સૌથી વધુ અંદાજિત પકડ",
    fmReliabilityLabel: "વિશ્વસનીયતા",
    fmRiskLabel: "જોખમ",
    fmZoneRankingTitle: "ઝોન રેન્કિંગ · માછીમારી ક્ષમતા",
    fmSpeciesSuitabilityTitle: "પ્રજાતિ યોગ્યતા રેન્કિંગ",
    fmWhereToSellTitle: "ક્યાં વેચવું",
    fmThMarket: "બજાર",
    fmThDistance: "અંતર",
    fmThPricePerKg: "ભાવ/કિગ્રા",
    fmThNetRevenue: "ચોખ્ખી આવક",
    fmFeatureImportanceTitle: "આ આગાહી શેના પર આધારિત છે",
    fmFeatureImportanceDesc: "આ ટ્રિપ માટે પકડ મોડલે ખરેખર જે પરિબળોને મહત્વ આપ્યું તે ટોચના પરિબળો — તાલીમ પામેલા મોડલમાંથી લેવાયેલા વાસ્તવિક ફીચર ઇમ્પોર્ટન્સ, બનાવેલા નહીં.",
    fmWhyOrcaTitle: "ORCA એ આ કેમ પસંદ કર્યું",
    fmModelTransparencyTitle: "મોડલ પારદર્શિતા",
    fmModelTransparencyDisclaimer: "ડેમો મોડલ — ઉપરનું દરેક મોડલ ORCA ના સિન્થેટિક નિદર્શન ડેટાસેટ પર તાલીમ પામેલું છે, વાસ્તવિક ઐતિહાસિક પકડ રેકોર્ડ પર નહીં. વિશ્વસનીયતાના આંકડા તે ડેટાસેટ પર માપવામાં આવ્યા છે, વાસ્તવિક દુનિયાની ચોકસાઈ પર નહીં.",
    fmZonesMapTitle: "શ્રેષ્ઠ માછલી ઉપજ ઝોન · લાઇવ નકશો",
    fmZonesMapDesc: "આજની તકમાં વપરાયેલ સમાન લાઇવ-સ્કોર થયેલ ઓશન એનાલિટિક્સ અને PFZ એજન્ટ ડેટા, GIS કમાન્ડ મેપના બેઝમેપ પર દર્શાવેલ.",
    fmRankedByYieldTitle: "ઉપજ પ્રમાણે ક્રમાંકિત",
    fmLoadingZones: "ઝોન લોડ થઈ રહ્યા છે…",
    fmTopZoneLabel: "ટોચનો ઝોન:",
    fmYieldScoreLabel: "ઉપજ સ્કોર:",
    fmLoadingPricing: "ભાવ સરખામણી લોડ થઈ રહી છે…",
    fmTypicalPriceLabel: "સામાન્ય અનૌપચારિક ભાવ",
    fmOpportunityPriceLabel: "ORCA તક ભાવ",
    fmExtraRevenueLabel: "સંભવિત વધારાની આવક",
    fmSpeciesPriceRankingTitle: "પ્રજાતિ ભાવ ક્રમાંક",
    fmThSpecies: "પ્રજાતિ",
    fmThTrend: "વલણ",
    fmThDemand: "માંગ",
    fmThEstProfit: "અંદાજિત નફો",
    fmThOpportunityScore: "તક સ્કોર",
    fmBuyerLeadsTitle: "ખરીદદાર લીડ્સ",
    fmTripCostCalcTitle: "ટ્રિપ-ખર્ચ કેલ્ક્યુલેટર",
    fmSpeciesLabel: "પ્રજાતિ",
    fmExpectedCatchKgLabel: "અપેક્ષિત પકડ (કિગ્રા)",
    fmPricePerKgLabel: "ભાવ પ્રતિ કિગ્રા (₹)",
    fmFuelLabel: "ઇંધણ (₹)",
    fmIceLabel: "બરફ (₹)",
    fmOtherLabel: "અન્ય (₹)",
    fmRecalculateBtn: "ફરીથી ગણો",
    fmTripSummaryTitle: "ટ્રિપ સારાંશ",
    fmGrossRevenueLabel: "કુલ આવક:",
    fmTotalTripCostLabel: "કુલ ટ્રિપ ખર્ચ:",
    fmNetProfitLabel: "ચોખ્ખો નફો:",
    fmProfitMarginLabel: "નફા માર્જિન:",
    fmCalcDefaultsNote: "ડિફોલ્ટ મૂલ્યો આજની ભલામણ કરેલ પ્રજાતિ અને આ એપની સિમ્યુલેટેડ બજાર માહિતીમાંથી પહેલેથી ભરેલા છે — કોઈપણ ફીલ્ડ બદલો અને ફરીથી ગણો દબાવો.",
    fmTripPerformanceTitle: "તમારી ટ્રિપ કામગીરી",
    fmLoadingPerformance: "કામગીરી ઇતિહાસ લોડ થઈ રહ્યો છે…",
    fmThTrip: "ટ્રિપ",
    fmThCatchKg: "પકડ (કિગ્રા)",
    fmThRevenue: "આવક",
    fmThProfit: "નફો",
    fmCommunityFeedTitle: "સમુદાય અને સલાહકારી ફીડ",
    fmBuiltBy: "દ્વારા બનાવેલ",
    fmHackathonLine: "Smart India Hackathon 2026 · સમસ્યા વિધાન 26176 (ISRO)",
    fmFooterDisclaimer: "અસ્વીકરણ: પ્રજાતિ બજાર ભાવ, ખરીદદાર લીડ્સ અને ટ્રિપ ઇતિહાસ Smart India Hackathon 2026 નિર્ણાયક નિદર્શન માટે સિમ્યુલેટેડ છે.",
    fmNoTripHistory: "હજુ સુધી કોઈ ટ્રિપ ઇતિહાસ નોંધાયો નથી.",
    fmYourCatch: "તમારી પકડ",
    fmTripAgoSingular: "{n} ટ્રિપ પહેલાં",
    fmTripAgoPlural: "{n} ટ્રિપ પહેલાં",
    fmTargetSpeciesColon: "લક્ષ્ય પ્રજાતિ:",
    fmYieldWord: "ઉપજ",
    fmSstLabel: "SST:",
    fmDepthLabel: "ઊંડાઈ:",
    fmSafetyLabel: "સલામતી:",
    fmOpportunityDescTemplate: "આજે ₹{price}/કિગ્રા પર {zone} નજીક શ્રેષ્ઠ મેચ — સંયુક્ત તક સ્કોર {score}/100.",
    fmTheRecommendedZone: "ભલામણ કરેલ ઝોન",
    fmSellSmarterDescTemplate: "{species}: અનૌપચારિક બજારને બદલે ORCA-મેચ કરેલા ખરીદદારને વેચવાથી, ધારેલી {catch} કિગ્રા પકડ પર અંદાજિત વધારાની {revenue} મળે છે.",
    fmAiErrorTemplate: "ORCA ના એઆઈ નિર્ણય સ્ટુડિયો બેકએન્ડ ({error}) સુધી પહોંચી શકાયું નથી. ML મોડલને તાલીમ આપવા માટે એક વખતનું બેકએન્ડ સેટઅપ જરૂરી છે -- backend/ml/training/ જુઓ. થોડી વારમાં ફરી પ્રયાસ કરો.",
    fmPlanDescTemplate: "શ્રેષ્ઠ વિન્ડો {window} · {market} પર વેચો · ORCA ટ્રિપ સ્કોર {score}/100.",
    fmTheRecommendedMarket: "ભલામણ કરેલ બજાર",
    fmKmFromPortTemplate: "બંદરથી {km} કિમી",
    fmStatusLive: "લાઇવ",
    fmStatusOffline: "બેકએન્ડ ઓફલાઇન — છેલ્લો જાણીતો ડેટા બતાવી રહ્યા છીએ",
    fmScoreOcean: "સમુદ્ર સલામતી",
    fmScoreFish: "માછલી ઉપજ",
    fmScoreMarket: "બજાર ગતિ",
    fmScoreProfit: "નફા માર્જિન",
    fmTierHigh: "ઉચ્ચ",
    fmTierGood: "સારું",
    fmTierModerate: "મધ્યમ",
    fmPostWeatherAlert: "હવામાન ચેતવણી",
    fmPostMarketUpdate: "બજાર અપડેટ",
    fmPostFishermanReport: "માછીમાર અહેવાલ",
    fmPostUpdate: "અપડેટ",
    fmNearbyBusinessesTitle: "નજીકના સીફૂડ ખરીદદારો અને બજારો · લાઇવ",
    fmNearbyBusinessesDesc: "તમારા વર્તમાન સ્થાનની નજીક OpenStreetMap દ્વારા વાસ્તવિક, લાઇવ — રેસ્ટોરન્ટ અને દુકાનો જે નજીકમાં સીફૂડ ખરીદે/પીરસે છે. આ ખરીદદારની જરૂરિયાત/લીડ નથી; તે માટે નીચે ખરીદદાર લીડ્સ જુઓ.",
    fmRefreshBtn: "તાજું કરો",
    fmLoadingNearby: "નજીકના સીફૂડ ખરીદદારો તપાસી રહ્યા છીએ…",
    fmNearbyBadgeLive: "લાઇવ",
    fmNearbyBadgeUnavailable: "અનુપલબ્ધ",
    fmNearbyNoneFound: "અત્યારે રેન્જમાં કોઈ સીફૂડ ખરીદદાર કે બજાર મળ્યું નથી.",
    fmNearbyFailed: "અત્યારે લાઇવ નજીકના-બિઝનેસ ડેટા સુધી પહોંચી શકાયું નથી.",
    fmPostBuyerDemandBtn: "+ ખરીદદાર માંગ પોસ્ટ કરો",
    fmBuyerLeadsRealNote: "LIVE ટેગ કરેલા લીડ્સ ORCA ના બાયર નેટવર્ક દ્વારા પોસ્ટ કરેલી વાસ્તવિક, ચકાસાયેલ ખરીદદાર જરૂરિયાતો છે. બાકીના સિમ્યુલેટેડ ડેમો ડેટા છે.",
    fmBuyerModalTitle: "વાસ્તવિક ખરીદદાર માંગ પોસ્ટ કરો",
    fmBuyerModalDesc: "તમારા ઇમેઇલ પર મોકલેલા એક વખતના કોડ દ્વારા ચકાસાયેલ (અથવા આ ડેમો માટે ઇમેઇલ સેટ ન હોય તો સીધું અહીં બતાવેલ). ORCA પર કોઈ ચુકવણી થતી નથી — આ ફક્ત તમને માછીમારો સાથે જોડે છે.",
    fmBuyerBusinessNameLabel: "વ્યવસાયનું નામ",
    fmBuyerEmailLabel: "સંપર્ક ઇમેઇલ",
    fmBuyerLocationLabel: "સ્થાન",
    fmBuyerSendCodeBtn: "ચકાસણી કોડ મોકલો",
    fmBuyerDevOtpTemplate: "આ ડેમો માટે ઇમેઇલ સેટ નથી — તમારો કોડ {code} છે",
    fmBuyerOtpLabel: "ચકાસણી કોડ",
    fmBuyerVerifyBtn: "કોડ ચકાસો",
    fmBuyerQtyLabel: "જરૂરી જથ્થો (કિગ્રા)",
    fmBuyerDeadlineLabel: "અંતિમ તારીખ",
    fmBuyerPriceMinLabel: "ન્યૂનતમ ભાવ (₹/કિગ્રા)",
    fmBuyerPriceMaxLabel: "મહત્તમ ભાવ (₹/કિગ્રા)",
    fmBuyerListingLocationLabel: "પિકઅપ સ્થાન",
    fmBuyerPostListingBtn: "લિસ્ટિંગ પોસ્ટ કરો",
    fmBuyerSuccessTitle: "લિસ્ટિંગ પોસ્ટ થયું",
    fmBuyerSuccessDesc: "તમારી વાસ્તવિક ખરીદદાર જરૂરિયાત હવે માછીમારો જોવા અને ક્લેમ કરવા માટે બાયર લીડ્સમાં લાઇવ છે.",
    fmBuyerDoneBtn: "થઈ ગયું",
    fmBuyerErrRequired: "વ્યવસાયનું નામ અને ઇમેઇલ જરૂરી છે.",
    fmBuyerErrOtp: "ચકાસણી કોડ દાખલ કરો.",
    fmBuyerErrGeneric: "કંઈક ખોટું થયું — ફરી પ્રયાસ કરો.",
    fmBuyerErrQty: "કિગ્રામાં જરૂરી જથ્થો દાખલ કરો.",
    fmBuyerLiveTag: "લાઇવ",
    fmBuyerDemoTag: "ડેમો",
    fmClaimBtn: "આ લીડ ક્લેમ કરો",
    fmClaimPromptText: "આ કોણ પૂરું કરે છે તે ખરીદદારને ખબર પડે તે માટે તમારું નામ અને ફોન/સંપર્ક દાખલ કરો:",
    fmClaimSuccess: "ક્લેમ થયું — ખરીદદારને પ્લેટફોર્મની બહાર જાણ કરવામાં આવશે.",
    fmClaimFailed: "અત્યારે આ લિસ્ટિંગ ક્લેમ કરી શકાયું નથી."
  },
  mr: {
    appTitle: "ऑर्का इनसाइट (ORCA INSIGHT)",
    appSubtitle: "ISRO सहयोगी सागरी बुद्धिमत्ता · SIH 2026 PS 26176",
    teamName: "टीम सेव्हियर्सएक्स (Team SavioursX)",
    navHome: "मुख्यपृष्ठ",
    navChat: "एआय निर्णय स्टुडिओ",
    navMap: "GIS कमांड नकाशा",
    navDAG: "एजंट DAG व्हिज्युअलायझर",
    navSafety: "सुरक्षा बॅरोमीटर",
    navFleet: "फ्लीट मॉनिटर",
    navFleetGIS: "फ्लीट आणि GIS कमांड",
    navNavic: "नाविक (NavIC) जीपीएस",
    navBulletins: "सल्लागार बुलेटिन",
    navSafetyAdv: "सुरक्षा आणि सल्ला",
    heroTitle: "हिंद महासागरासाठी सहयोगी सागरी बुद्धिमत्ता",
    heroDesc: "ISRO Oceansat-3, INSAT-3DR उपग्रह समुद्रशास्त्र, IMBL जिओफेन्सिंग, रिअल-टाइम फ्लीट घनता आणि प्रवास ETA वर तर्क करून भारताच्या किनारपट्टीवरील मच्छिमार समुदायाला सक्षम करणे.",
    ctaStudio: "एआय निर्णय स्टुडिओ सुरू करा",
    ctaMap: "GIS कमांड नकाशा उघडा",
    ctaFleet: "फ्लीट मॉनिटर तपासा",
    ctaFleetGIS: "फ्लीट आणि GIS कमांड उघडा",
    statsActiveVessels: "ट्रॅक केलेली सक्रिय जहाजे",
    statsSatellites: "ISRO उपग्रह फीड",
    statsPFZ: "उच्च-उत्पन्न मासेमारी क्षेत्रे",
    statsIMBL: "IMBL जिओफेन्स केलेले सेक्टर",
    chipPFZ: "जवळचे उच्च-उत्पन्न PFZ शोधा",
    chipSafety: "समुद्र-प्रवास मंजुरी तपासा",
    chipBorder: "IMBL सीमा अंतर तपासणी",
    chipDensity: "जहाज घनता आणि गर्दी",
    chipETA: "ETA आणि सुरक्षित परतीचा वेळ काढा",
    chatPlaceholder: "ORCA ला विचारा (किंवा बोलण्यासाठी मायक्रोफोनवर क्लिक करा)...",
    chatSend: "एजंट्सना विचारा",
    routePlannerTitle: "प्रवास मार्ग सिम्युलेटर आणि सी-स्टेट ETA",
    originHarbour: "मूळ मासेमारी बंदर",
    destinationPFZ: "गंतव्य PFZ झोन",
    simulateRouteBtn: "सुरक्षित मार्ग आणि ETA सिम्युलेट करा",
    distanceNM: "मार्ग अंतर (नॉटिकल मैल)",
    liveETA: "लाइव्ह सी-स्टेट ETA",
    returnDusk: "संधिप्रकाशापूर्वी परतीचा सुरक्षा निर्णय",
    sosButton: "SOS आणीबाणी",
    clearanceSafe: "समुद्र-प्रवासासाठी सुरक्षित",
    clearanceCaution: "सावधगिरीने पुढे जा",
    clearanceUnsafe: "असुरक्षित: प्रवास करू नका",
    bigVerdictQuestion: "आज मासेमारीला जाणे सुरक्षित आहे का?",
    bigVerdictYes: "होय",
    bigVerdictNo: "नाही",
    bigVerdictCaution: "सावधगिरी",
    listenVerdict: "ऐका",
    waveHeight: "लक्षणीय लाट उंची",
    windSpeed: "पृष्ठभाग वाऱ्याचा वेग",
    seaState: "डग्लस सी स्टेट",
    lightningRisk: "वीज आणि वादळाचा धोका",
    vesselTableTitle: "लाइव्ह किनारी फ्लीट टेलिमेट्री (लाइव्ह AIS + सिम्युलेटेड फिल-इन)",
    simulatedDisclaimer: "टीप: जिथे अद्याप रिसीव्हर कव्हरेज नाही तिथे लाइव्ह AIS जहाज स्थाने स्पष्टपणे टॅग केलेल्या सिम्युलेटेड फ्लीटने भरली जातात. Smart India Hackathon 2026 च्या प्रात्यक्षिकासाठी उपग्रह समुद्रशास्त्र स्तर सिम्युलेटेडच राहतात.",
    fmTitle: "ऑर्का फिशरमन (ORCA FISHERMAN)",
    fmSubtitle: "दैनंदिन संधी कन्सोल · टीम सेव्हियर्सएक्स",
    fmLiveFeedBadge: "लाइव्ह संधी फीड",
    fmToggleDarkMode: "डार्क मोड टॉगल करा",
    fmBackToHub: "← हब",
    fmBackToHubTitle: "ORCA हबवर परत जा",
    fmNavOpportunity: "आजची संधी",
    fmNavMap: "मासेमारी क्षेत्र नकाशा",
    fmNavSell: "हुशारीने विका",
    fmNavCalculator: "ट्रिप कॅल्क्युलेटर",
    fmNavCommunity: "कामगिरी आणि समुदाय",
    fmCheckingBackend: "बॅकएंड तपासत आहे...",
    fmBestOpportunityLabel: "आजची सर्वोत्तम संधी",
    fmLoadingOpportunityDesc: "फिशरमन ऑपर्च्युनिटी एजंटकडून आजची संधी लोड होत आहे…",
    fmPreferredSpeciesLabel: "पसंतीची प्रजाती:",
    fmAutoBestMatch: "ऑटो (सर्वोत्तम जुळणी)",
    fmOpportunityScoreLabel: "संधी गुण",
    fmRecommendedZoneLabel: "शिफारस केलेला झोन",
    fmExpectedCatchLabel: "अपेक्षित पकड",
    fmAtTodaysPrice: "आजच्या दराने",
    fmRevenueRangeLabel: "महसूल श्रेणी",
    fmBeforeTripCosts: "ट्रिप खर्चापूर्वी",
    fmEstimatedProfitLabel: "अंदाजित नफा",
    fmConfidenceLabel: "विश्वासार्हता",
    fmScoreBreakdownTitle: "संधी गुण विभाजन",
    fmAiStudioTitle: "एआय निर्णय स्टुडिओ — तुमच्या ट्रिपचे नियोजन करा",
    fmAiStudioDesc: "ORCA च्या स्वतःच्या डेटावर प्रशिक्षित 4 ऑन-डिव्हाइस scikit-learn मॉडेल्स (पकड, झोन, प्रजाती, भाव), एका निश्चित नफा व जोखीम इंजिनसह एकत्र काम करतात. या संपूर्ण प्रक्रियेत कुठेही बाह्य एआय API वापरले जात नाही.",
    fmDemoModelBadge: "डेमो मॉडेल · सिंथेटिक प्रशिक्षण डेटा",
    fmTripPlannerTitle: "ट्रिप प्लॅनर",
    fmBoatTypeLabel: "बोटीचा प्रकार",
    fmBoatTraditional: "पारंपरिक (यांत्रिक नसलेली)",
    fmBoatMotorized: "मोटरयुक्त",
    fmBoatMechanized: "यांत्रिक ट्रॉलर",
    fmGearTypeLabel: "गियर प्रकार",
    fmGearGillnet: "गिलनेट",
    fmGearTrawl: "ट्रॉल",
    fmGearRingSeine: "रिंग सीन",
    fmGearLongline: "लाँगलाइन",
    fmGearHookLine: "हुक आणि लाइन",
    fmTripDurationLabel: "ट्रिप कालावधी (तास)",
    fmTargetSpeciesLabel: "लक्ष्य प्रजाती",
    fmSpeciesTuna: "टुना",
    fmSpeciesPomfret: "पापलेट",
    fmSpeciesSardine: "सार्डिन",
    fmSpeciesMackerel: "मॅकरेल (बांगडा)",
    fmSpeciesKingfish: "किंगफिश (सुरमई)",
    fmUsesCurrentLocation: "तुमचे सध्याचे बंदर स्थान आणि आजचे लाइव्ह सागरी हवामान वापरते.",
    fmPlanMyTrip: "माझी ट्रिप प्लॅन करा",
    fmRunningModelsBtn: "ORCA मॉडेल्स चालू आहेत…",
    fmRunningModelsDesc: "ORCA चे ऑन-डिव्हाइस ML मॉडेल्स (पकड, झोन, प्रजाती, भाव) आणि नफा-जोखीम इंजिन चालवत आहोत…",
    fmRecommendedPlanLabel: "ORCA ची शिफारस केलेली योजना",
    fmTripScoreLabel: "ORCA ट्रिप गुण",
    fmBestZoneLabel: "सर्वोत्तम झोन",
    fmBestTimeWindowLabel: "सर्वोत्तम वेळ खिडकी",
    fmHighestPredictedCatch: "सर्वाधिक अंदाजित पकड",
    fmReliabilityLabel: "विश्वसनीयता",
    fmRiskLabel: "जोखीम",
    fmZoneRankingTitle: "झोन क्रमवारी · मासेमारी क्षमता",
    fmSpeciesSuitabilityTitle: "प्रजाती योग्यता क्रमवारी",
    fmWhereToSellTitle: "कुठे विकावे",
    fmThMarket: "बाजार",
    fmThDistance: "अंतर",
    fmThPricePerKg: "भाव/किलो",
    fmThNetRevenue: "निव्वळ महसूल",
    fmFeatureImportanceTitle: "हा अंदाज कशावर आधारित आहे",
    fmFeatureImportanceDesc: "या ट्रिपसाठी पकड मॉडेलने प्रत्यक्षात विचारात घेतलेले मुख्य घटक — प्रशिक्षित मॉडेलमधून घेतलेले खरे फीचर इम्पॉर्टन्स, बनवलेले नाहीत.",
    fmWhyOrcaTitle: "ORCA ने हे का निवडले",
    fmModelTransparencyTitle: "मॉडेल पारदर्शकता",
    fmModelTransparencyDisclaimer: "डेमो मॉडेल — वरील प्रत्येक मॉडेल ORCA च्या सिंथेटिक प्रात्यक्षिक डेटासेटवर प्रशिक्षित आहे, खऱ्या ऐतिहासिक पकड नोंदींवर नाही. विश्वसनीयतेचे आकडे त्या डेटासेटवर मोजले आहेत, प्रत्यक्ष जगातील अचूकतेवर नाहीत.",
    fmZonesMapTitle: "सर्वोत्तम मासे उत्पन्न झोन · लाइव्ह नकाशा",
    fmZonesMapDesc: "आजच्या संधीत वापरलेला तोच लाइव्ह-स्कोअर केलेला ओशन अॅनालिटिक्स आणि PFZ एजंट डेटा, GIS कमांड नकाशाच्या बेसमॅपवर दाखवलेला.",
    fmRankedByYieldTitle: "उत्पन्नानुसार क्रमवारी",
    fmLoadingZones: "झोन लोड होत आहेत…",
    fmTopZoneLabel: "अव्वल झोन:",
    fmYieldScoreLabel: "उत्पन्न गुण:",
    fmLoadingPricing: "किंमत तुलना लोड होत आहे…",
    fmTypicalPriceLabel: "सर्वसाधारण अनौपचारिक भाव",
    fmOpportunityPriceLabel: "ORCA संधी भाव",
    fmExtraRevenueLabel: "संभाव्य अतिरिक्त महसूल",
    fmSpeciesPriceRankingTitle: "प्रजाती भाव क्रमवारी",
    fmThSpecies: "प्रजाती",
    fmThTrend: "कल",
    fmThDemand: "मागणी",
    fmThEstProfit: "अंदाजित नफा",
    fmThOpportunityScore: "संधी गुण",
    fmBuyerLeadsTitle: "खरेदीदार लीड्स",
    fmTripCostCalcTitle: "ट्रिप-खर्च कॅल्क्युलेटर",
    fmSpeciesLabel: "प्रजाती",
    fmExpectedCatchKgLabel: "अपेक्षित पकड (किलो)",
    fmPricePerKgLabel: "भाव प्रति किलो (₹)",
    fmFuelLabel: "इंधन (₹)",
    fmIceLabel: "बर्फ (₹)",
    fmOtherLabel: "इतर (₹)",
    fmRecalculateBtn: "पुन्हा गणना करा",
    fmTripSummaryTitle: "ट्रिप सारांश",
    fmGrossRevenueLabel: "एकूण महसूल:",
    fmTotalTripCostLabel: "एकूण ट्रिप खर्च:",
    fmNetProfitLabel: "निव्वळ नफा:",
    fmProfitMarginLabel: "नफा मार्जिन:",
    fmCalcDefaultsNote: "आजच्या शिफारस केलेल्या प्रजाती आणि या अॅपच्या सिम्युलेटेड बाजार डेटावरून डीफॉल्ट मूल्ये आधीच भरलेली आहेत — कोणतेही फील्ड बदला आणि पुन्हा गणना करा दाबा.",
    fmTripPerformanceTitle: "तुमची ट्रिप कामगिरी",
    fmLoadingPerformance: "कामगिरी इतिहास लोड होत आहे…",
    fmThTrip: "ट्रिप",
    fmThCatchKg: "पकड (किलो)",
    fmThRevenue: "महसूल",
    fmThProfit: "नफा",
    fmCommunityFeedTitle: "समुदाय आणि सल्लागार फीड",
    fmBuiltBy: "निर्मिती",
    fmHackathonLine: "Smart India Hackathon 2026 · समस्या विधान 26176 (ISRO)",
    fmFooterDisclaimer: "अस्वीकरण: प्रजातींचे बाजारभाव, खरेदीदार लीड्स आणि ट्रिप इतिहास Smart India Hackathon 2026 च्या परीक्षण प्रात्यक्षिकासाठी सिम्युलेटेड आहेत.",
    fmNoTripHistory: "अद्याप कोणताही ट्रिप इतिहास नोंदवलेला नाही.",
    fmYourCatch: "तुमची पकड",
    fmTripAgoSingular: "{n} ट्रिपपूर्वी",
    fmTripAgoPlural: "{n} ट्रिपपूर्वी",
    fmTargetSpeciesColon: "लक्ष्य प्रजाती:",
    fmYieldWord: "उत्पन्न",
    fmSstLabel: "SST:",
    fmDepthLabel: "खोली:",
    fmSafetyLabel: "सुरक्षा:",
    fmOpportunityDescTemplate: "आज ₹{price}/किलो दराने {zone} जवळ सर्वोत्तम जुळणी — एकत्रित संधी गुण {score}/100.",
    fmTheRecommendedZone: "शिफारस केलेला झोन",
    fmSellSmarterDescTemplate: "{species}: अनौपचारिक बाजाराऐवजी ORCA-जुळणी केलेल्या खरेदीदाराला विकल्यास, गृहीत धरलेल्या {catch} किलो पकडीवर अंदाजे अतिरिक्त {revenue} मिळतो.",
    fmAiErrorTemplate: "ORCA च्या एआय निर्णय स्टुडिओ बॅकएंडपर्यंत ({error}) पोहोचता आले नाही. ML मॉडेल्सना प्रशिक्षण देण्यासाठी एकवेळ बॅकएंड सेटअप आवश्यक आहे -- backend/ml/training/ पहा. लवकरच पुन्हा प्रयत्न करा.",
    fmPlanDescTemplate: "सर्वोत्तम खिडकी {window} · {market} वर विका · ORCA ट्रिप गुण {score}/100.",
    fmTheRecommendedMarket: "शिफारस केलेले बाजार",
    fmKmFromPortTemplate: "बंदरापासून {km} किमी",
    fmStatusLive: "लाइव्ह",
    fmStatusOffline: "बॅकएंड ऑफलाइन — शेवटचा ज्ञात डेटा दाखवत आहे",
    fmScoreOcean: "सागरी सुरक्षा",
    fmScoreFish: "मासे उत्पन्न",
    fmScoreMarket: "बाजार गती",
    fmScoreProfit: "नफा मार्जिन",
    fmTierHigh: "उच्च",
    fmTierGood: "चांगले",
    fmTierModerate: "मध्यम",
    fmPostWeatherAlert: "हवामान इशारा",
    fmPostMarketUpdate: "बाजार अद्यतन",
    fmPostFishermanReport: "मच्छिमार अहवाल",
    fmPostUpdate: "अद्यतन",
    fmNearbyBusinessesTitle: "जवळचे सीफूड खरेदीदार आणि बाजार · लाइव्ह",
    fmNearbyBusinessesDesc: "तुमच्या सध्याच्या स्थानाजवळ OpenStreetMap द्वारे खरे, लाइव्ह — जवळपास सीफूड खरेदी/विकणारी रेस्टॉरंट्स आणि दुकाने. ही खरेदीदाराची गरज/लीड नाही; त्यासाठी खाली खरेदीदार लीड्स पहा.",
    fmRefreshBtn: "रिफ्रेश करा",
    fmLoadingNearby: "जवळचे सीफूड खरेदीदार तपासत आहोत…",
    fmNearbyBadgeLive: "लाइव्ह",
    fmNearbyBadgeUnavailable: "अनुपलब्ध",
    fmNearbyNoneFound: "सध्या श्रेणीत कोणतेही सीफूड खरेदीदार किंवा बाजार आढळले नाहीत.",
    fmNearbyFailed: "सध्या लाइव्ह जवळपासच्या-व्यवसाय डेटापर्यंत पोहोचता आले नाही.",
    fmPostBuyerDemandBtn: "+ खरेदीदार मागणी पोस्ट करा",
    fmBuyerLeadsRealNote: "LIVE टॅग केलेले लीड्स ORCA च्या बायर नेटवर्कद्वारे पोस्ट केलेल्या खऱ्या, पडताळणी केलेल्या खरेदीदार गरजा आहेत. बाकीचे सिम्युलेटेड डेमो डेटा आहेत.",
    fmBuyerModalTitle: "खरी खरेदीदार मागणी पोस्ट करा",
    fmBuyerModalDesc: "तुमच्या ईमेलवर पाठवलेल्या एकवेळच्या कोडद्वारे पडताळणी केलेली (किंवा या डेमोसाठी ईमेल कॉन्फिगर नसल्यास येथेच दाखवलेली). ORCA वर कोणतेही पेमेंट होत नाही — हे फक्त तुम्हाला मच्छिमारांशी जोडते.",
    fmBuyerBusinessNameLabel: "व्यवसायाचे नाव",
    fmBuyerEmailLabel: "संपर्क ईमेल",
    fmBuyerLocationLabel: "स्थान",
    fmBuyerSendCodeBtn: "पडताळणी कोड पाठवा",
    fmBuyerDevOtpTemplate: "या डेमोसाठी ईमेल कॉन्फिगर नाही — तुमचा कोड {code} आहे",
    fmBuyerOtpLabel: "पडताळणी कोड",
    fmBuyerVerifyBtn: "कोड पडताळा",
    fmBuyerQtyLabel: "आवश्यक प्रमाण (किलो)",
    fmBuyerDeadlineLabel: "अंतिम मुदत",
    fmBuyerPriceMinLabel: "किमान भाव (₹/किलो)",
    fmBuyerPriceMaxLabel: "कमाल भाव (₹/किलो)",
    fmBuyerListingLocationLabel: "पिकअप स्थान",
    fmBuyerPostListingBtn: "लिस्टिंग पोस्ट करा",
    fmBuyerSuccessTitle: "लिस्टिंग पोस्ट झाले",
    fmBuyerSuccessDesc: "तुमची खरी खरेदीदार गरज आता मच्छिमारांना पाहण्यासाठी आणि दावा करण्यासाठी बायर लीड्समध्ये लाइव्ह आहे.",
    fmBuyerDoneBtn: "पूर्ण झाले",
    fmBuyerErrRequired: "व्यवसायाचे नाव आणि ईमेल आवश्यक आहेत.",
    fmBuyerErrOtp: "पडताळणी कोड टाका.",
    fmBuyerErrGeneric: "काहीतरी चूक झाली — कृपया पुन्हा प्रयत्न करा.",
    fmBuyerErrQty: "किलोमध्ये आवश्यक प्रमाण टाका.",
    fmBuyerLiveTag: "लाइव्ह",
    fmBuyerDemoTag: "डेमो",
    fmClaimBtn: "ही लीड दावा करा",
    fmClaimPromptText: "हे कोण पूर्ण करत आहे हे खरेदीदाराला कळावे यासाठी तुमचे नाव आणि फोन/संपर्क टाका:",
    fmClaimSuccess: "दावा केला — खरेदीदाराला प्लॅटफॉर्मबाहेर कळवले जाईल.",
    fmClaimFailed: "सध्या ही लिस्टिंग दावा करता आली नाही."
  },
  kn: {
    appTitle: "ಓರ್ಕಾ ಇನ್‌ಸೈಟ್ (ORCA INSIGHT)",
    appSubtitle: "ISRO ಸಹಯೋಗಿ ಸಮುದ್ರ ಬುದ್ಧಿಮತ್ತೆ · SIH 2026 PS 26176",
    teamName: "ಟೀಮ್ ಸೇವಿಯರ್ಸ್‌ಎಕ್ಸ್ (Team SavioursX)",
    navHome: "ಮುಖಪುಟ",
    navChat: "ಎಐ ನಿರ್ಧಾರ ಸ್ಟುಡಿಯೋ",
    navMap: "GIS ಕಮಾಂಡ್ ನಕ್ಷೆ",
    navDAG: "ಏಜೆಂಟ್ DAG ವಿಶುವಲೈಸರ್",
    navSafety: "ಸುರಕ್ಷತಾ ಬ್ಯಾರೋಮೀಟರ್",
    navFleet: "ಫ್ಲೀಟ್ ಮಾನಿಟರ್",
    navFleetGIS: "ಫ್ಲೀಟ್ ಮತ್ತು GIS ಕಮಾಂಡ್",
    navNavic: "ನಾವಿಕ್ (NavIC) ಜಿಪಿಎಸ್",
    navBulletins: "ಸಲಹಾ ಬುಲೆಟಿನ್‌ಗಳು",
    navSafetyAdv: "ಸುರಕ್ಷತೆ ಮತ್ತು ಸಲಹೆಗಳು",
    heroTitle: "ಹಿಂದೂ ಮಹಾಸಾಗರಕ್ಕಾಗಿ ಸಹಯೋಗಿ ಸಮುದ್ರ ಬುದ್ಧಿಮತ್ತೆ",
    heroDesc: "ISRO Oceansat-3, INSAT-3DR ಉಪಗ್ರಹ ಸಮುದ್ರಶಾಸ್ತ್ರ, IMBL ಜಿಯೋಫೆನ್ಸಿಂಗ್, ರಿಯಲ್-ಟೈಮ್ ಫ್ಲೀಟ್ ಸಾಂದ್ರತೆ ಮತ್ತು ಪ್ರಯಾಣದ ETA ಮೇಲೆ ತರ್ಕಿಸಿ ಭಾರತದ ಕರಾವಳಿ ಮೀನುಗಾರ ಸಮುದಾಯವನ್ನು ಸಬಲಗೊಳಿಸುವುದು.",
    ctaStudio: "ಎಐ ನಿರ್ಧಾರ ಸ್ಟುಡಿಯೋ ಪ್ರಾರಂಭಿಸಿ",
    ctaMap: "GIS ಕಮಾಂಡ್ ನಕ್ಷೆ ತೆರೆಯಿರಿ",
    ctaFleet: "ಫ್ಲೀಟ್ ಮಾನಿಟರ್ ಪರಿಶೀಲಿಸಿ",
    ctaFleetGIS: "ಫ್ಲೀಟ್ ಮತ್ತು GIS ಕಮಾಂಡ್ ತೆರೆಯಿರಿ",
    statsActiveVessels: "ಟ್ರ್ಯಾಕ್ ಮಾಡಿದ ಸಕ್ರಿಯ ಹಡಗುಗಳು",
    statsSatellites: "ISRO ಉಪಗ್ರಹ ಫೀಡ್‌ಗಳು",
    statsPFZ: "ಹೆಚ್ಚಿನ ಇಳುವರಿ ಮೀನುಗಾರಿಕೆ ವಲಯಗಳು",
    statsIMBL: "IMBL ಜಿಯೋಫೆನ್ಸ್ ಮಾಡಿದ ವಲಯಗಳು",
    chipPFZ: "ಹತ್ತಿರದ ಹೆಚ್ಚಿನ ಇಳುವರಿ PFZ ಹುಡುಕಿ",
    chipSafety: "ಸಮುದ್ರ-ಪ್ರಯಾಣ ಅನುಮತಿ ಪರಿಶೀಲಿಸಿ",
    chipBorder: "IMBL ಗಡಿ ಅಂತರ ಪರಿಶೀಲನೆ",
    chipDensity: "ಹಡಗು ಸಾಂದ್ರತೆ ಮತ್ತು ಜನದಟ್ಟಣೆ",
    chipETA: "ETA ಮತ್ತು ಸುರಕ್ಷಿತ ಹಿಂತಿರುಗುವ ಸಮಯ ಲೆಕ್ಕ ಹಾಕಿ",
    chatPlaceholder: "ORCA ಅನ್ನು ಕೇಳಿ (ಅಥವಾ ಮಾತನಾಡಲು ಮೈಕ್ರೊಫೋನ್ ಒತ್ತಿ)...",
    chatSend: "ಏಜೆಂಟ್‌ಗಳನ್ನು ಕೇಳಿ",
    routePlannerTitle: "ಪ್ರಯಾಣ ಮಾರ್ಗ ಸಿಮ್ಯುಲೇಟರ್ ಮತ್ತು ಸೀ-ಸ್ಟೇಟ್ ETA",
    originHarbour: "ಮೂಲ ಮೀನುಗಾರಿಕೆ ಬಂದರು",
    destinationPFZ: "ಗಮ್ಯಸ್ಥಾನ PFZ ವಲಯ",
    simulateRouteBtn: "ಸುರಕ್ಷಿತ ಮಾರ್ಗ ಮತ್ತು ETA ಸಿಮ್ಯುಲೇಟ್ ಮಾಡಿ",
    distanceNM: "ಮಾರ್ಗ ದೂರ (ನಾಟಿಕಲ್ ಮೈಲ್)",
    liveETA: "ಲೈವ್ ಸೀ-ಸ್ಟೇಟ್ ETA",
    returnDusk: "ಸಂಜೆಯ-ಮುಂಚಿನ ಹಿಂತಿರುಗುವ ಸುರಕ್ಷತಾ ತೀರ್ಪು",
    sosButton: "SOS ತುರ್ತುಸ್ಥಿತಿ",
    clearanceSafe: "ಸಮುದ್ರ-ಪ್ರಯಾಣಕ್ಕೆ ಸುರಕ್ಷಿತ",
    clearanceCaution: "ಎಚ್ಚರಿಕೆಯಿಂದ ಮುಂದುವರಿಯಿರಿ",
    clearanceUnsafe: "ಅಸುರಕ್ಷಿತ: ಪ್ರಯಾಣ ಮಾಡಬೇಡಿ",
    bigVerdictQuestion: "ಇಂದು ಮೀನುಗಾರಿಕೆಗೆ ಹೋಗುವುದು ಸುರಕ್ಷಿತವೇ?",
    bigVerdictYes: "ಹೌದು",
    bigVerdictNo: "ಇಲ್ಲ",
    bigVerdictCaution: "ಎಚ್ಚರಿಕೆ",
    listenVerdict: "ಆಲಿಸಿ",
    waveHeight: "ಗಮನಾರ್ಹ ಅಲೆಗಳ ಎತ್ತರ",
    windSpeed: "ಮೇಲ್ಮೈ ಗಾಳಿಯ ವೇಗ",
    seaState: "ಡಗ್ಲಸ್ ಸೀ ಸ್ಟೇಟ್",
    lightningRisk: "ಮಿಂಚು ಮತ್ತು ಬಿರುಗಾಳಿ ಅಪಾಯ",
    vesselTableTitle: "ಲೈವ್ ಕರಾವಳಿ ಫ್ಲೀಟ್ ಟೆಲಿಮೆಟ್ರಿ (ಲೈವ್ AIS + ಸಿಮ್ಯುಲೇಟೆಡ್ ಫಿಲ್-ಇನ್)",
    simulatedDisclaimer: "ಗಮನಿಸಿ: ಇನ್ನೂ ರಿಸೀವರ್ ಕವರೇಜ್ ಇಲ್ಲದ ಕಡೆ ಲೈವ್ AIS ಹಡಗು ಸ್ಥಾನಗಳನ್ನು ಸ್ಪಷ್ಟವಾಗಿ ಟ್ಯಾಗ್ ಮಾಡಿದ ಸಿಮ್ಯುಲೇಟೆಡ್ ಫ್ಲೀಟ್‌ನೊಂದಿಗೆ ಭರ್ತಿ ಮಾಡಲಾಗುತ್ತದೆ. Smart India Hackathon 2026 ಪ್ರದರ್ಶನಕ್ಕಾಗಿ ಉಪಗ್ರಹ ಸಮುದ್ರಶಾಸ್ತ್ರ ಪದರಗಳು ಸಿಮ್ಯುಲೇಟೆಡ್ ಆಗಿಯೇ ಉಳಿಯುತ್ತವೆ.",
    fmTitle: "ಓರ್ಕಾ ಫಿಷರ್‌ಮ್ಯಾನ್ (ORCA FISHERMAN)",
    fmSubtitle: "ದೈನಂದಿನ ಅವಕಾಶ ಕನ್ಸೋಲ್ · ಟೀಮ್ ಸೇವಿಯರ್ಸ್‌ಎಕ್ಸ್",
    fmLiveFeedBadge: "ಲೈವ್ ಅವಕಾಶ ಫೀಡ್",
    fmToggleDarkMode: "ಡಾರ್ಕ್ ಮೋಡ್ ಟಾಗಲ್ ಮಾಡಿ",
    fmBackToHub: "← ಹಬ್",
    fmBackToHubTitle: "ORCA ಹಬ್‌ಗೆ ಹಿಂತಿರುಗಿ",
    fmNavOpportunity: "ಇಂದಿನ ಅವಕಾಶ",
    fmNavMap: "ಮೀನುಗಾರಿಕೆ ವಲಯ ನಕ್ಷೆ",
    fmNavSell: "ಜಾಣ್ಮೆಯಿಂದ ಮಾರಾಟ ಮಾಡಿ",
    fmNavCalculator: "ಟ್ರಿಪ್ ಕ್ಯಾಲ್ಕುಲೇಟರ್",
    fmNavCommunity: "ಸಾಧನೆ ಮತ್ತು ಸಮುದಾಯ",
    fmCheckingBackend: "ಬ್ಯಾಕೆಂಡ್ ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ...",
    fmBestOpportunityLabel: "ಇಂದಿನ ಅತ್ಯುತ್ತಮ ಅವಕಾಶ",
    fmLoadingOpportunityDesc: "ಫಿಷರ್‌ಮ್ಯಾನ್ ಆಪರ್ಚುನಿಟಿ ಏಜೆಂಟ್‌ನಿಂದ ಇಂದಿನ ಅವಕಾಶ ಲೋಡ್ ಆಗುತ್ತಿದೆ…",
    fmPreferredSpeciesLabel: "ಆದ್ಯತೆಯ ಪ್ರಭೇದ:",
    fmAutoBestMatch: "ಆಟೋ (ಅತ್ಯುತ್ತಮ ಹೊಂದಾಣಿಕೆ)",
    fmOpportunityScoreLabel: "ಅವಕಾಶ ಸ್ಕೋರ್",
    fmRecommendedZoneLabel: "ಶಿಫಾರಸು ಮಾಡಿದ ವಲಯ",
    fmExpectedCatchLabel: "ನಿರೀಕ್ಷಿತ ಹಿಡಿತ",
    fmAtTodaysPrice: "ಇಂದಿನ ಬೆಲೆಯಲ್ಲಿ",
    fmRevenueRangeLabel: "ಆದಾಯ ವ್ಯಾಪ್ತಿ",
    fmBeforeTripCosts: "ಟ್ರಿಪ್ ವೆಚ್ಚಗಳ ಮೊದಲು",
    fmEstimatedProfitLabel: "ಅಂದಾಜು ಲಾಭ",
    fmConfidenceLabel: "ವಿಶ್ವಾಸಾರ್ಹತೆ",
    fmScoreBreakdownTitle: "ಅವಕಾಶ ಸ್ಕೋರ್ ವಿಭಜನೆ",
    fmAiStudioTitle: "ಎಐ ನಿರ್ಧಾರ ಸ್ಟುಡಿಯೋ — ನಿಮ್ಮ ಟ್ರಿಪ್ ಯೋಜಿಸಿ",
    fmAiStudioDesc: "ORCA ದ ಸ್ವಂತ ಡೇಟಾದ ಮೇಲೆ ತರಬೇತಿ ಪಡೆದ 4 ಆನ್-ಡಿವೈಸ್ scikit-learn ಮಾದರಿಗಳು (ಹಿಡಿತ, ವಲಯ, ಪ್ರಭೇದ, ಬೆಲೆ), ಒಂದು ನಿಶ್ಚಿತ ಲಾಭ ಮತ್ತು ಅಪಾಯ ಎಂಜಿನ್‌ನೊಂದಿಗೆ ಒಟ್ಟಾಗಿ ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತವೆ. ಈ ಸಂಪೂರ್ಣ ಪ್ರಕ್ರಿಯೆಯಲ್ಲಿ ಎಲ್ಲಿಯೂ ಬಾಹ್ಯ ಎಐ API ಬಳಸಲಾಗುವುದಿಲ್ಲ.",
    fmDemoModelBadge: "ಡೆಮೊ ಮಾದರಿ · ಸಿಂಥೆಟಿಕ್ ತರಬೇತಿ ಡೇಟಾ",
    fmTripPlannerTitle: "ಟ್ರಿಪ್ ಪ್ಲಾನರ್",
    fmBoatTypeLabel: "ದೋಣಿ ಪ್ರಕಾರ",
    fmBoatTraditional: "ಸಾಂಪ್ರದಾಯಿಕ (ಯಾಂತ್ರಿಕವಲ್ಲದ)",
    fmBoatMotorized: "ಮೋಟಾರೀಕೃತ",
    fmBoatMechanized: "ಯಾಂತ್ರಿಕೃತ ಟ್ರಾಲರ್",
    fmGearTypeLabel: "ಗೇರ್ ಪ್ರಕಾರ",
    fmGearGillnet: "ಗಿಲ್‌ನೆಟ್",
    fmGearTrawl: "ಟ್ರಾಲ್",
    fmGearRingSeine: "ರಿಂಗ್ ಸೀನ್",
    fmGearLongline: "ಲಾಂಗ್‌ಲೈನ್",
    fmGearHookLine: "ಹುಕ್ ಮತ್ತು ಲೈನ್",
    fmTripDurationLabel: "ಟ್ರಿಪ್ ಅವಧಿ (ಗಂಟೆಗಳು)",
    fmTargetSpeciesLabel: "ಗುರಿ ಪ್ರಭೇದ",
    fmSpeciesTuna: "ಟುನಾ",
    fmSpeciesPomfret: "ಪಾಂಫ್ರೆಟ್",
    fmSpeciesSardine: "ಸಾರ್ಡಿನ್ (ಬೂತಾಯಿ)",
    fmSpeciesMackerel: "ಮ್ಯಾಕೆರೆಲ್ (ಬಂಗುಡೆ)",
    fmSpeciesKingfish: "ಕಿಂಗ್‌ಫಿಶ್ (ಅಂಜಲ್/ಆಣಂಜಲ್)",
    fmUsesCurrentLocation: "ನಿಮ್ಮ ಪ್ರಸ್ತುತ ಬಂದರು ಸ್ಥಳ ಮತ್ತು ಇಂದಿನ ಲೈವ್ ಸಮುದ್ರ ಹವಾಮಾನವನ್ನು ಬಳಸುತ್ತದೆ.",
    fmPlanMyTrip: "ನನ್ನ ಟ್ರಿಪ್ ಯೋಜಿಸಿ",
    fmRunningModelsBtn: "ORCA ಮಾದರಿಗಳು ಚಾಲನೆಯಲ್ಲಿವೆ…",
    fmRunningModelsDesc: "ORCA ದ ಆನ್-ಡಿವೈಸ್ ML ಮಾದರಿಗಳನ್ನು (ಹಿಡಿತ, ವಲಯ, ಪ್ರಭೇದ, ಬೆಲೆ) ಮತ್ತು ಲಾಭ-ಅಪಾಯ ಎಂಜಿನ್ ಅನ್ನು ಚಲಾಯಿಸಲಾಗುತ್ತಿದೆ…",
    fmRecommendedPlanLabel: "ORCA ದ ಶಿಫಾರಸು ಮಾಡಿದ ಯೋಜನೆ",
    fmTripScoreLabel: "ORCA ಟ್ರಿಪ್ ಸ್ಕೋರ್",
    fmBestZoneLabel: "ಅತ್ಯುತ್ತಮ ವಲಯ",
    fmBestTimeWindowLabel: "ಅತ್ಯುತ್ತಮ ಸಮಯ ಕಿಟಕಿ",
    fmHighestPredictedCatch: "ಅತ್ಯಧಿಕ ಅಂದಾಜು ಹಿಡಿತ",
    fmReliabilityLabel: "ವಿಶ್ವಾಸಾರ್ಹತೆ",
    fmRiskLabel: "ಅಪಾಯ",
    fmZoneRankingTitle: "ವಲಯ ಶ್ರೇಣಿ · ಮೀನುಗಾರಿಕೆ ಸಾಮರ್ಥ್ಯ",
    fmSpeciesSuitabilityTitle: "ಪ್ರಭೇದ ಸೂಕ್ತತೆ ಶ್ರೇಣಿ",
    fmWhereToSellTitle: "ಎಲ್ಲಿ ಮಾರಾಟ ಮಾಡುವುದು",
    fmThMarket: "ಮಾರುಕಟ್ಟೆ",
    fmThDistance: "ದೂರ",
    fmThPricePerKg: "ಬೆಲೆ/ಕೆಜಿ",
    fmThNetRevenue: "ನಿವ್ವಳ ಆದಾಯ",
    fmFeatureImportanceTitle: "ಈ ಭವಿಷ್ಯವಾಣಿ ಯಾವುದರ ಮೇಲೆ ಆಧಾರಿತವಾಗಿದೆ",
    fmFeatureImportanceDesc: "ಈ ಟ್ರಿಪ್‌ಗಾಗಿ ಹಿಡಿತ ಮಾದರಿಯು ನಿಜವಾಗಿ ಪರಿಗಣಿಸಿದ ಪ್ರಮುಖ ಅಂಶಗಳು — ತರಬೇತಿ ಪಡೆದ ಮಾದರಿಯಿಂದ ಓದಲಾದ ನಿಜವಾದ ಫೀಚರ್ ಇಂಪಾರ್ಟನ್ಸ್‌ಗಳು, ಕಲ್ಪಿಸಿದ್ದಲ್ಲ.",
    fmWhyOrcaTitle: "ORCA ಇದನ್ನೇ ಏಕೆ ಆಯ್ಕೆ ಮಾಡಿತು",
    fmModelTransparencyTitle: "ಮಾದರಿ ಪಾರದರ್ಶಕತೆ",
    fmModelTransparencyDisclaimer: "ಡೆಮೊ ಮಾದರಿ — ಮೇಲಿನ ಪ್ರತಿಯೊಂದು ಮಾದರಿ ORCA ದ ಸಿಂಥೆಟಿಕ್ ಪ್ರದರ್ಶನ ಡೇಟಾಸೆಟ್‌ನ ಮೇಲೆ ತರಬೇತಿ ಪಡೆದಿದೆ, ನಿಜವಾದ ಐತಿಹಾಸಿಕ ಹಿಡಿತ ದಾಖಲೆಗಳ ಮೇಲೆ ಅಲ್ಲ. ವಿಶ್ವಾಸಾರ್ಹತೆಯ ಅಂಕಿಅಂಶಗಳನ್ನು ಆ ಡೇಟಾಸೆಟ್‌ನಲ್ಲಿ ಅಳೆಯಲಾಗಿದೆ, ನೈಜ-ಜಗತ್ತಿನ ನಿಖರತೆಯಲ್ಲಿ ಅಲ್ಲ.",
    fmZonesMapTitle: "ಅತ್ಯುತ್ತಮ ಮೀನು ಇಳುವರಿ ವಲಯಗಳು · ಲೈವ್ ನಕ್ಷೆ",
    fmZonesMapDesc: "ಇಂದಿನ ಅವಕಾಶದಲ್ಲಿ ಬಳಸಿದ ಅದೇ ಲೈವ್-ಸ್ಕೋರ್ ಮಾಡಿದ ಓಷನ್ ಅನಾಲಿಟಿಕ್ಸ್ ಮತ್ತು PFZ ಏಜೆಂಟ್ ಡೇಟಾ, GIS ಕಮಾಂಡ್ ನಕ್ಷೆಯ ಬೇಸ್‌ಮ್ಯಾಪ್‌ನಲ್ಲಿ ಗುರುತಿಸಲಾಗಿದೆ.",
    fmRankedByYieldTitle: "ಇಳುವರಿಯಿಂದ ಶ್ರೇಣೀಕರಿಸಲಾಗಿದೆ",
    fmLoadingZones: "ವಲಯಗಳು ಲೋಡ್ ಆಗುತ್ತಿವೆ…",
    fmTopZoneLabel: "ಅಗ್ರ ವಲಯ:",
    fmYieldScoreLabel: "ಇಳುವರಿ ಸ್ಕೋರ್:",
    fmLoadingPricing: "ಬೆಲೆ ಹೋಲಿಕೆ ಲೋಡ್ ಆಗುತ್ತಿದೆ…",
    fmTypicalPriceLabel: "ವಿಶಿಷ್ಟ ಅನೌಪಚಾರಿಕ ಬೆಲೆ",
    fmOpportunityPriceLabel: "ORCA ಅವಕಾಶ ಬೆಲೆ",
    fmExtraRevenueLabel: "ಸಂಭಾವ್ಯ ಹೆಚ್ಚುವರಿ ಆದಾಯ",
    fmSpeciesPriceRankingTitle: "ಪ್ರಭೇದ ಬೆಲೆ ಶ್ರೇಣಿ",
    fmThSpecies: "ಪ್ರಭೇದ",
    fmThTrend: "ಪ್ರವೃತ್ತಿ",
    fmThDemand: "ಬೇಡಿಕೆ",
    fmThEstProfit: "ಅಂದಾಜು ಲಾಭ",
    fmThOpportunityScore: "ಅವಕಾಶ ಸ್ಕೋರ್",
    fmBuyerLeadsTitle: "ಖರೀದಿದಾರ ಲೀಡ್‌ಗಳು",
    fmTripCostCalcTitle: "ಟ್ರಿಪ್-ವೆಚ್ಚ ಕ್ಯಾಲ್ಕುಲೇಟರ್",
    fmSpeciesLabel: "ಪ್ರಭೇದ",
    fmExpectedCatchKgLabel: "ನಿರೀಕ್ಷಿತ ಹಿಡಿತ (ಕೆಜಿ)",
    fmPricePerKgLabel: "ಪ್ರತಿ ಕೆಜಿಗೆ ಬೆಲೆ (₹)",
    fmFuelLabel: "ಇಂಧನ (₹)",
    fmIceLabel: "ಐಸ್ (₹)",
    fmOtherLabel: "ಇತರೆ (₹)",
    fmRecalculateBtn: "ಮರು ಲೆಕ್ಕ ಹಾಕಿ",
    fmTripSummaryTitle: "ಟ್ರಿಪ್ ಸಾರಾಂಶ",
    fmGrossRevenueLabel: "ಒಟ್ಟು ಆದಾಯ:",
    fmTotalTripCostLabel: "ಒಟ್ಟು ಟ್ರಿಪ್ ವೆಚ್ಚ:",
    fmNetProfitLabel: "ನಿವ್ವಳ ಲಾಭ:",
    fmProfitMarginLabel: "ಲಾಭ ಅಂಚು:",
    fmCalcDefaultsNote: "ಇಂದಿನ ಶಿಫಾರಸು ಮಾಡಿದ ಪ್ರಭೇದ ಮತ್ತು ಈ ಆ್ಯಪ್‌ನ ಸಿಮ್ಯುಲೇಟೆಡ್ ಮಾರುಕಟ್ಟೆ ಡೇಟಾದಿಂದ ಡೀಫಾಲ್ಟ್‌ಗಳನ್ನು ಮೊದಲೇ ಭರ್ತಿ ಮಾಡಲಾಗಿದೆ — ಯಾವುದೇ ಕ್ಷೇತ್ರವನ್ನು ಬದಲಾಯಿಸಿ ಮತ್ತು ಮರು ಲೆಕ್ಕ ಹಾಕಿ ಒತ್ತಿ.",
    fmTripPerformanceTitle: "ನಿಮ್ಮ ಟ್ರಿಪ್ ಸಾಧನೆ",
    fmLoadingPerformance: "ಸಾಧನೆ ಇತಿಹಾಸ ಲೋಡ್ ಆಗುತ್ತಿದೆ…",
    fmThTrip: "ಟ್ರಿಪ್",
    fmThCatchKg: "ಹಿಡಿತ (ಕೆಜಿ)",
    fmThRevenue: "ಆದಾಯ",
    fmThProfit: "ಲಾಭ",
    fmCommunityFeedTitle: "ಸಮುದಾಯ ಮತ್ತು ಸಲಹಾ ಫೀಡ್",
    fmBuiltBy: "ನಿರ್ಮಿಸಿದವರು",
    fmHackathonLine: "Smart India Hackathon 2026 · ಸಮಸ್ಯಾ ಹೇಳಿಕೆ 26176 (ISRO)",
    fmFooterDisclaimer: "ಹಕ್ಕುತ್ಯಾಗ: ಪ್ರಭೇದ ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳು, ಖರೀದಿದಾರ ಲೀಡ್‌ಗಳು ಮತ್ತು ಟ್ರಿಪ್ ಇತಿಹಾಸವನ್ನು Smart India Hackathon 2026 ತೀರ್ಪುಗಾರಿಕೆ ಪ್ರದರ್ಶನಕ್ಕಾಗಿ ಸಿಮ್ಯುಲೇಟ್ ಮಾಡಲಾಗಿದೆ.",
    fmNoTripHistory: "ಇನ್ನೂ ಯಾವುದೇ ಟ್ರಿಪ್ ಇತಿಹಾಸ ದಾಖಲಾಗಿಲ್ಲ.",
    fmYourCatch: "ನಿಮ್ಮ ಹಿಡಿತ",
    fmTripAgoSingular: "{n} ಟ್ರಿಪ್ ಹಿಂದೆ",
    fmTripAgoPlural: "{n} ಟ್ರಿಪ್‌ಗಳ ಹಿಂದೆ",
    fmTargetSpeciesColon: "ಗುರಿ ಪ್ರಭೇದ:",
    fmYieldWord: "ಇಳುವರಿ",
    fmSstLabel: "SST:",
    fmDepthLabel: "ಆಳ:",
    fmSafetyLabel: "ಸುರಕ್ಷತೆ:",
    fmOpportunityDescTemplate: "ಇಂದು ₹{price}/ಕೆಜಿ ಗೆ {zone} ಬಳಿ ಅತ್ಯುತ್ತಮ ಹೊಂದಾಣಿಕೆ — ಒಟ್ಟು ಅವಕಾಶ ಸ್ಕೋರ್ {score}/100.",
    fmTheRecommendedZone: "ಶಿಫಾರಸು ಮಾಡಿದ ವಲಯ",
    fmSellSmarterDescTemplate: "{species}: ಅನೌಪಚಾರಿಕ ಮಾರುಕಟ್ಟೆಗೆ ಬದಲಾಗಿ ORCA-ಹೊಂದಾಣಿಕೆಯಾದ ಖರೀದಿದಾರರಿಗೆ ಮಾರಾಟ ಮಾಡುವುದರಿಂದ, ಊಹಿಸಲಾದ {catch} ಕೆಜಿ ಹಿಡಿತದ ಮೇಲೆ ಅಂದಾಜು ಹೆಚ್ಚುವರಿ {revenue} ಸಿಗುತ್ತದೆ.",
    fmAiErrorTemplate: "ORCA ದ ಎಐ ನಿರ್ಧಾರ ಸ್ಟುಡಿಯೋ ಬ್ಯಾಕೆಂಡ್ ({error}) ಅನ್ನು ತಲುಪಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ML ಮಾದರಿಗಳಿಗೆ ತರಬೇತಿ ನೀಡಲು ಒಂದು ಬಾರಿ ಬ್ಯಾಕೆಂಡ್ ಸೆಟಪ್ ಅಗತ್ಯವಿದೆ -- backend/ml/training/ ನೋಡಿ. ಸ್ವಲ್ಪ ಸಮಯದಲ್ಲಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    fmPlanDescTemplate: "ಅತ್ಯುತ್ತಮ ಕಿಟಕಿ {window} · {market} ನಲ್ಲಿ ಮಾರಾಟ ಮಾಡಿ · ORCA ಟ್ರಿಪ್ ಸ್ಕೋರ್ {score}/100.",
    fmTheRecommendedMarket: "ಶಿಫಾರಸು ಮಾಡಿದ ಮಾರುಕಟ್ಟೆ",
    fmKmFromPortTemplate: "ಬಂದರಿನಿಂದ {km} ಕಿಮೀ",
    fmStatusLive: "ಲೈವ್",
    fmStatusOffline: "ಬ್ಯಾಕೆಂಡ್ ಆಫ್‌ಲೈನ್ — ಕೊನೆಯ ತಿಳಿದಿರುವ ಡೇಟಾ ತೋರಿಸಲಾಗುತ್ತಿದೆ",
    fmScoreOcean: "ಸಮುದ್ರ ಸುರಕ್ಷತೆ",
    fmScoreFish: "ಮೀನು ಇಳುವರಿ",
    fmScoreMarket: "ಮಾರುಕಟ್ಟೆ ಚಲನೆ",
    fmScoreProfit: "ಲಾಭ ಅಂಚು",
    fmTierHigh: "ಹೆಚ್ಚು",
    fmTierGood: "ಉತ್ತಮ",
    fmTierModerate: "ಮಧ್ಯಮ",
    fmPostWeatherAlert: "ಹವಾಮಾನ ಎಚ್ಚರಿಕೆ",
    fmPostMarketUpdate: "ಮಾರುಕಟ್ಟೆ ನವೀಕರಣ",
    fmPostFishermanReport: "ಮೀನುಗಾರ ವರದಿ",
    fmPostUpdate: "ನವೀಕರಣ",
    fmNearbyBusinessesTitle: "ಹತ್ತಿರದ ಸೀಫುಡ್ ಖರೀದಿದಾರರು ಮತ್ತು ಮಾರುಕಟ್ಟೆಗಳು · ಲೈವ್",
    fmNearbyBusinessesDesc: "ನಿಮ್ಮ ಪ್ರಸ್ತುತ ಸ್ಥಳದ ಬಳಿ OpenStreetMap ಮೂಲಕ ನೈಜ, ಲೈವ್ — ಹತ್ತಿರದಲ್ಲಿ ಸೀಫುಡ್ ಖರೀದಿಸುವ/ಬಡಿಸುವ ರೆಸ್ಟೋರೆಂಟ್‌ಗಳು ಮತ್ತು ಅಂಗಡಿಗಳು. ಇದು ಖರೀದಿದಾರರ ಅಗತ್ಯ/ಲೀಡ್ ಅಲ್ಲ; ಅದಕ್ಕಾಗಿ ಕೆಳಗಿನ ಖರೀದಿದಾರ ಲೀಡ್‌ಗಳನ್ನು ನೋಡಿ.",
    fmRefreshBtn: "ರಿಫ್ರೆಶ್ ಮಾಡಿ",
    fmLoadingNearby: "ಹತ್ತಿರದ ಸೀಫುಡ್ ಖರೀದಿದಾರರನ್ನು ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…",
    fmNearbyBadgeLive: "ಲೈವ್",
    fmNearbyBadgeUnavailable: "ಲಭ್ಯವಿಲ್ಲ",
    fmNearbyNoneFound: "ಸದ್ಯಕ್ಕೆ ವ್ಯಾಪ್ತಿಯಲ್ಲಿ ಯಾವುದೇ ಸೀಫುಡ್ ಖರೀದಿದಾರರು ಅಥವಾ ಮಾರುಕಟ್ಟೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ.",
    fmNearbyFailed: "ಸದ್ಯಕ್ಕೆ ಲೈವ್ ಹತ್ತಿರದ-ವ್ಯಾಪಾರ ಡೇಟಾವನ್ನು ತಲುಪಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.",
    fmPostBuyerDemandBtn: "+ ಖರೀದಿದಾರ ಬೇಡಿಕೆ ಪೋಸ್ಟ್ ಮಾಡಿ",
    fmBuyerLeadsRealNote: "LIVE ಟ್ಯಾಗ್ ಮಾಡಿದ ಲೀಡ್‌ಗಳು ORCA ದ ಬಯರ್ ನೆಟ್‌ವರ್ಕ್ ಮೂಲಕ ಪೋಸ್ಟ್ ಮಾಡಿದ ನೈಜ, ಪರಿಶೀಲಿಸಿದ ಖರೀದಿದಾರ ಅಗತ್ಯಗಳಾಗಿವೆ. ಉಳಿದವು ಸಿಮ್ಯುಲೇಟೆಡ್ ಡೆಮೊ ಡೇಟಾ.",
    fmBuyerModalTitle: "ನೈಜ ಖರೀದಿದಾರ ಬೇಡಿಕೆ ಪೋಸ್ಟ್ ಮಾಡಿ",
    fmBuyerModalDesc: "ನಿಮ್ಮ ಇಮೇಲ್‌ಗೆ ಕಳುಹಿಸಲಾದ ಒಂದು-ಬಾರಿಯ ಕೋಡ್ ಮೂಲಕ ಪರಿಶೀಲಿಸಲಾಗಿದೆ (ಅಥವಾ ಈ ಡೆಮೊಗೆ ಇಮೇಲ್ ಕಾನ್ಫಿಗರ್ ಮಾಡದಿದ್ದರೆ ಇಲ್ಲಿಯೇ ನೇರವಾಗಿ ತೋರಿಸಲಾಗುತ್ತದೆ). ORCA ನಲ್ಲಿ ಯಾವುದೇ ಪಾವತಿಗಳು ನಡೆಯುವುದಿಲ್ಲ — ಇದು ಕೇವಲ ನಿಮ್ಮನ್ನು ಮೀನುಗಾರರೊಂದಿಗೆ ಸಂಪರ್ಕಿಸುತ್ತದೆ.",
    fmBuyerBusinessNameLabel: "ವ್ಯಾಪಾರದ ಹೆಸರು",
    fmBuyerEmailLabel: "ಸಂಪರ್ಕ ಇಮೇಲ್",
    fmBuyerLocationLabel: "ಸ್ಥಳ",
    fmBuyerSendCodeBtn: "ಪರಿಶೀಲನಾ ಕೋಡ್ ಕಳುಹಿಸಿ",
    fmBuyerDevOtpTemplate: "ಈ ಡೆಮೊಗೆ ಇಮೇಲ್ ಕಾನ್ಫಿಗರ್ ಮಾಡಿಲ್ಲ — ನಿಮ್ಮ ಕೋಡ್ {code}",
    fmBuyerOtpLabel: "ಪರಿಶೀಲನಾ ಕೋಡ್",
    fmBuyerVerifyBtn: "ಕೋಡ್ ಪರಿಶೀಲಿಸಿ",
    fmBuyerQtyLabel: "ಅಗತ್ಯವಿರುವ ಪ್ರಮಾಣ (ಕೆಜಿ)",
    fmBuyerDeadlineLabel: "ಗಡುವು",
    fmBuyerPriceMinLabel: "ಕನಿಷ್ಠ ಬೆಲೆ (₹/ಕೆಜಿ)",
    fmBuyerPriceMaxLabel: "ಗರಿಷ್ಠ ಬೆಲೆ (₹/ಕೆಜಿ)",
    fmBuyerListingLocationLabel: "ಪಿಕಪ್ ಸ್ಥಳ",
    fmBuyerPostListingBtn: "ಪಟ್ಟಿ ಪೋಸ್ಟ್ ಮಾಡಿ",
    fmBuyerSuccessTitle: "ಪಟ್ಟಿ ಪೋಸ್ಟ್ ಆಗಿದೆ",
    fmBuyerSuccessDesc: "ನಿಮ್ಮ ನೈಜ ಖರೀದಿದಾರ ಅಗತ್ಯವು ಈಗ ಮೀನುಗಾರರು ನೋಡಲು ಮತ್ತು ಕ್ಲೈಮ್ ಮಾಡಲು ಬಯರ್ ಲೀಡ್‌ಗಳಲ್ಲಿ ಲೈವ್ ಆಗಿದೆ.",
    fmBuyerDoneBtn: "ಮುಗಿದಿದೆ",
    fmBuyerErrRequired: "ವ್ಯಾಪಾರದ ಹೆಸರು ಮತ್ತು ಇಮೇಲ್ ಅಗತ್ಯವಿದೆ.",
    fmBuyerErrOtp: "ಪರಿಶೀಲನಾ ಕೋಡ್ ನಮೂದಿಸಿ.",
    fmBuyerErrGeneric: "ಏನೋ ತಪ್ಪಾಗಿದೆ — ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    fmBuyerErrQty: "ಕೆಜಿಯಲ್ಲಿ ಅಗತ್ಯವಿರುವ ಪ್ರಮಾಣವನ್ನು ನಮೂದಿಸಿ.",
    fmBuyerLiveTag: "ಲೈವ್",
    fmBuyerDemoTag: "ಡೆಮೊ",
    fmClaimBtn: "ಈ ಲೀಡ್ ಅನ್ನು ಕ್ಲೈಮ್ ಮಾಡಿ",
    fmClaimPromptText: "ಇದನ್ನು ಯಾರು ಪೂರೈಸುತ್ತಿದ್ದಾರೆ ಎಂದು ಖರೀದಿದಾರರಿಗೆ ತಿಳಿಯಲು ನಿಮ್ಮ ಹೆಸರು ಮತ್ತು ಫೋನ್/ಸಂಪರ್ಕವನ್ನು ನಮೂದಿಸಿ:",
    fmClaimSuccess: "ಕ್ಲೈಮ್ ಮಾಡಲಾಗಿದೆ — ಖರೀದಿದಾರರಿಗೆ ಪ್ಲಾಟ್‌ಫಾರ್ಮ್‌ನ ಹೊರಗೆ ತಿಳಿಸಲಾಗುತ್ತದೆ.",
    fmClaimFailed: "ಸದ್ಯಕ್ಕೆ ಈ ಪಟ್ಟಿಯನ್ನು ಕ್ಲೈಮ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ."
  },
  te: {
    appTitle: "ఓర్కా ఇన్‌సైట్ (ORCA INSIGHT)",
    appSubtitle: "ISRO సహకార సముద్ర మేధస్సు · SIH 2026 PS 26176",
    teamName: "టీమ్ సేవియర్స్‌ఎక్స్ (Team SavioursX)",
    navHome: "హోమ్",
    navChat: "ఏఐ నిర్ణయ స్టూడియో",
    navMap: "GIS కమాండ్ మ్యాప్",
    navDAG: "ఏజెంట్ DAG విజువలైజర్",
    navSafety: "భద్రతా బారోమీటర్",
    navFleet: "ఫ్లీట్ మానిటర్",
    navFleetGIS: "ఫ్లీట్ మరియు GIS కమాండ్",
    navNavic: "నావిక్ (NavIC) జీపీఎస్",
    navBulletins: "సలహా బులెటిన్‌లు",
    navSafetyAdv: "భద్రత మరియు సలహాలు",
    heroTitle: "హిందూ మహాసముద్రం కోసం సహకార సముద్ర మేధస్సు",
    heroDesc: "ISRO Oceansat-3, INSAT-3DR ఉపగ్రహ సముద్రశాస్త్రం, IMBL జియోఫెన్సింగ్, రియల్-టైమ్ ఫ్లీట్ సాంద్రత మరియు ప్రయాణ ETA పై తర్కించి భారత తీర ప్రాంత మత్స్యకార సమాజాన్ని శక్తివంతం చేయడం.",
    ctaStudio: "ఏఐ నిర్ణయ స్టూడియోను ప్రారంభించండి",
    ctaMap: "GIS కమాండ్ మ్యాప్‌ను తెరవండి",
    ctaFleet: "ఫ్లీట్ మానిటర్‌ను పరిశీలించండి",
    ctaFleetGIS: "ఫ్లీట్ మరియు GIS కమాండ్‌ను తెరవండి",
    statsActiveVessels: "ట్రాక్ చేయబడిన క్రియాశీల నౌకలు",
    statsSatellites: "ISRO ఉపగ్రహ ఫీడ్‌లు",
    statsPFZ: "అధిక దిగుబడి మత్స్య మండలాలు",
    statsIMBL: "IMBL జియోఫెన్స్ చేసిన సెక్టార్‌లు",
    chipPFZ: "సమీప అధిక దిగుబడి PFZ కనుగొనండి",
    chipSafety: "సముద్ర-ప్రయాణ అనుమతిని తనిఖీ చేయండి",
    chipBorder: "IMBL సరిహద్దు దూర తనిఖీ",
    chipDensity: "నౌక సాంద్రత మరియు రద్దీ",
    chipETA: "ETA మరియు సురక్షిత రిటర్న్ సమయాన్ని లెక్కించండి",
    chatPlaceholder: "ORCA ని అడగండి (లేదా మాట్లాడటానికి మైక్రోఫోన్‌ను నొక్కండి)...",
    chatSend: "ఏజెంట్లను అడగండి",
    routePlannerTitle: "ప్రయాణ మార్గ సిమ్యులేటర్ మరియు సీ-స్టేట్ ETA",
    originHarbour: "మూల మత్స్య నౌకాశ్రయం",
    destinationPFZ: "గమ్యస్థాన PFZ మండలం",
    simulateRouteBtn: "సురక్షిత మార్గం మరియు ETA ని సిమ్యులేట్ చేయండి",
    distanceNM: "మార్గ దూరం (నాటికల్ మైళ్ళు)",
    liveETA: "లైవ్ సీ-స్టేట్ ETA",
    returnDusk: "సంధ్యలోపు తిరిగి రావాల్సిన భద్రతా తీర్పు",
    sosButton: "SOS అత్యవసర పరిస్థితి",
    clearanceSafe: "సముద్ర-ప్రయాణానికి సురక్షితం",
    clearanceCaution: "జాగ్రత్తగా కొనసాగండి",
    clearanceUnsafe: "అసురక్షితం: ప్రయాణించవద్దు",
    bigVerdictQuestion: "ఈరోజు చేపలు పట్టడానికి వెళ్లడం సురక్షితమేనా?",
    bigVerdictYes: "అవును",
    bigVerdictNo: "కాదు",
    bigVerdictCaution: "జాగ్రత్త",
    listenVerdict: "వినండి",
    waveHeight: "గణనీయమైన అల ఎత్తు",
    windSpeed: "ఉపరితల గాలి వేగం",
    seaState: "డగ్లస్ సీ స్టేట్",
    lightningRisk: "మెరుపు మరియు తుఫాను ప్రమాదం",
    vesselTableTitle: "లైవ్ తీర ప్రాంత ఫ్లీట్ టెలిమెట్రీ (లైవ్ AIS + సిమ్యులేటెడ్ ఫిల్-ఇన్)",
    simulatedDisclaimer: "గమనిక: ఇంకా రిసీవర్ కవరేజ్ లేని చోట లైవ్ AIS నౌక స్థానాలు స్పష్టంగా ట్యాగ్ చేయబడిన సిమ్యులేటెడ్ ఫ్లీట్‌తో నింపబడతాయి. Smart India Hackathon 2026 ప్రదర్శన కోసం ఉపగ్రహ సముద్రశాస్త్ర పొరలు సిమ్యులేటెడ్‌గానే ఉంటాయి.",
    fmTitle: "ఓర్కా ఫిషర్‌మ్యాన్ (ORCA FISHERMAN)",
    fmSubtitle: "రోజువారీ అవకాశ కన్సోల్ · టీమ్ సేవియర్స్‌ఎక్స్",
    fmLiveFeedBadge: "లైవ్ అవకాశ ఫీడ్",
    fmToggleDarkMode: "డార్క్ మోడ్‌ను టోగుల్ చేయండి",
    fmBackToHub: "← హబ్",
    fmBackToHubTitle: "ORCA హబ్‌కు తిరిగి వెళ్లండి",
    fmNavOpportunity: "ఈరోజు అవకాశం",
    fmNavMap: "మత్స్య మండల మ్యాప్",
    fmNavSell: "తెలివిగా అమ్మండి",
    fmNavCalculator: "ట్రిప్ కాలిక్యులేటర్",
    fmNavCommunity: "పనితీరు మరియు సమాజం",
    fmCheckingBackend: "బ్యాకెండ్‌ను తనిఖీ చేస్తోంది...",
    fmBestOpportunityLabel: "ఈరోజు ఉత్తమ అవకాశం",
    fmLoadingOpportunityDesc: "ఫిషర్‌మ్యాన్ అపార్చునిటీ ఏజెంట్ నుండి ఈరోజు అవకాశం లోడ్ అవుతోంది…",
    fmPreferredSpeciesLabel: "ఇష్టపడే జాతి:",
    fmAutoBestMatch: "ఆటో (ఉత్తమ మ్యాచ్)",
    fmOpportunityScoreLabel: "అవకాశ స్కోరు",
    fmRecommendedZoneLabel: "సిఫార్సు చేసిన మండలం",
    fmExpectedCatchLabel: "ఆశించిన పట్టు",
    fmAtTodaysPrice: "ఈరోజు ధర వద్ద",
    fmRevenueRangeLabel: "ఆదాయ శ్రేణి",
    fmBeforeTripCosts: "ట్రిప్ ఖర్చులకు ముందు",
    fmEstimatedProfitLabel: "అంచనా వేసిన లాభం",
    fmConfidenceLabel: "విశ్వసనీయత",
    fmScoreBreakdownTitle: "అవకాశ స్కోరు విభజన",
    fmAiStudioTitle: "ఏఐ నిర్ణయ స్టూడియో — మీ ట్రిప్‌ను ప్లాన్ చేయండి",
    fmAiStudioDesc: "ORCA యొక్క సొంత డేటాపై శిక్షణ పొందిన 4 ఆన్-డివైస్ scikit-learn మోడల్‌లు (పట్టు, మండలం, జాతి, ధర), ఒక నిర్ణీత లాభం & రిస్క్ ఇంజన్‌తో కలిసి పనిచేస్తాయి. ఈ మొత్తం ప్రక్రియలో ఎక్కడా బాహ్య ఏఐ API ఉపయోగించబడదు.",
    fmDemoModelBadge: "డెమో మోడల్ · సింథటిక్ శిక్షణ డేటా",
    fmTripPlannerTitle: "ట్రిప్ ప్లానర్",
    fmBoatTypeLabel: "పడవ రకం",
    fmBoatTraditional: "సాంప్రదాయ (యాంత్రికం కాని)",
    fmBoatMotorized: "మోటరైజ్డ్",
    fmBoatMechanized: "యాంత్రిక ట్రాలర్",
    fmGearTypeLabel: "గేర్ రకం",
    fmGearGillnet: "గిల్‌నెట్",
    fmGearTrawl: "ట్రాల్",
    fmGearRingSeine: "రింగ్ సీన్",
    fmGearLongline: "లాంగ్‌లైన్",
    fmGearHookLine: "హుక్ మరియు లైన్",
    fmTripDurationLabel: "ట్రిప్ వ్యవధి (గంటలు)",
    fmTargetSpeciesLabel: "లక్ష్య జాతి",
    fmSpeciesTuna: "టూనా",
    fmSpeciesPomfret: "పాంఫ్రెట్ (చందువా)",
    fmSpeciesSardine: "సార్డిన్ (మత్తగుడిస)",
    fmSpeciesMackerel: "మ్యాకరెల్ (బంగడ/కనగల)",
    fmSpeciesKingfish: "కింగ్‌ఫిష్ (వంజరం)",
    fmUsesCurrentLocation: "మీ ప్రస్తుత నౌకాశ్రయ స్థానం మరియు ఈరోజు లైవ్ సముద్ర వాతావరణాన్ని ఉపయోగిస్తుంది.",
    fmPlanMyTrip: "నా ట్రిప్‌ను ప్లాన్ చేయండి",
    fmRunningModelsBtn: "ORCA మోడల్‌లు నడుస్తున్నాయి…",
    fmRunningModelsDesc: "ORCA యొక్క ఆన్-డివైస్ ML మోడల్‌లను (పట్టు, మండలం, జాతి, ధర) మరియు లాభం-రిస్క్ ఇంజన్‌ను నడుపుతోంది…",
    fmRecommendedPlanLabel: "ORCA యొక్క సిఫార్సు చేసిన ప్రణాళిక",
    fmTripScoreLabel: "ORCA ట్రిప్ స్కోరు",
    fmBestZoneLabel: "ఉత్తమ మండలం",
    fmBestTimeWindowLabel: "ఉత్తమ సమయ విండో",
    fmHighestPredictedCatch: "అత్యధిక అంచనా వేసిన పట్టు",
    fmReliabilityLabel: "విశ్వసనీయత",
    fmRiskLabel: "రిస్క్",
    fmZoneRankingTitle: "మండల ర్యాంకింగ్ · మత్స్య సామర్థ్యం",
    fmSpeciesSuitabilityTitle: "జాతి అనుకూలత ర్యాంకింగ్",
    fmWhereToSellTitle: "ఎక్కడ అమ్మాలి",
    fmThMarket: "మార్కెట్",
    fmThDistance: "దూరం",
    fmThPricePerKg: "ధర/కేజీ",
    fmThNetRevenue: "నికర ఆదాయం",
    fmFeatureImportanceTitle: "ఈ అంచనా దేనిపై ఆధారపడింది",
    fmFeatureImportanceDesc: "ఈ ట్రిప్ కోసం పట్టు మోడల్ నిజంగా పరిగణించిన ప్రధాన అంశాలు — శిక్షణ పొందిన మోడల్ నుండి చదవబడిన నిజమైన ఫీచర్ ఇంపార్టెన్స్‌లు, కల్పితం కాదు.",
    fmWhyOrcaTitle: "ORCA దీన్ని ఎందుకు ఎంచుకుంది",
    fmModelTransparencyTitle: "మోడల్ పారదర్శకత",
    fmModelTransparencyDisclaimer: "డెమో మోడల్ — పైన ఉన్న ప్రతి మోడల్ ORCA యొక్క సింథటిక్ ప్రదర్శన డేటాసెట్‌పై శిక్షణ పొందింది, నిజమైన చారిత్రక పట్టు రికార్డులపై కాదు. విశ్వసనీయత గణాంకాలు ఆ డేటాసెట్‌పై కొలవబడ్డాయి, వాస్తవ-ప్రపంచ ఖచ్చితత్వంపై కాదు.",
    fmZonesMapTitle: "ఉత్తమ చేపల దిగుబడి మండలాలు · లైవ్ మ్యాప్",
    fmZonesMapDesc: "ఈరోజు అవకాశంలో ఉపయోగించిన అదే లైవ్-స్కోర్ చేసిన ఓషన్ అనలిటిక్స్ & PFZ ఏజెంట్ డేటా, GIS కమాండ్ మ్యాప్ బేస్‌మ్యాప్‌పై చూపబడింది.",
    fmRankedByYieldTitle: "దిగుబడి ప్రకారం ర్యాంక్ చేయబడింది",
    fmLoadingZones: "మండలాలు లోడ్ అవుతున్నాయి…",
    fmTopZoneLabel: "టాప్ మండలం:",
    fmYieldScoreLabel: "దిగుబడి స్కోరు:",
    fmLoadingPricing: "ధర పోలిక లోడ్ అవుతోంది…",
    fmTypicalPriceLabel: "సాధారణ అనధికారిక ధర",
    fmOpportunityPriceLabel: "ORCA అవకాశ ధర",
    fmExtraRevenueLabel: "సంభావ్య అదనపు ఆదాయం",
    fmSpeciesPriceRankingTitle: "జాతి ధర ర్యాంకింగ్",
    fmThSpecies: "జాతి",
    fmThTrend: "ధోరణి",
    fmThDemand: "డిమాండ్",
    fmThEstProfit: "అంచనా లాభం",
    fmThOpportunityScore: "అవకాశ స్కోరు",
    fmBuyerLeadsTitle: "కొనుగోలుదారు లీడ్‌లు",
    fmTripCostCalcTitle: "ట్రిప్-ఖర్చు కాలిక్యులేటర్",
    fmSpeciesLabel: "జాతి",
    fmExpectedCatchKgLabel: "ఆశించిన పట్టు (కేజీ)",
    fmPricePerKgLabel: "కేజీకి ధర (₹)",
    fmFuelLabel: "ఇంధనం (₹)",
    fmIceLabel: "మంచు (₹)",
    fmOtherLabel: "ఇతర (₹)",
    fmRecalculateBtn: "మళ్లీ లెక్కించండి",
    fmTripSummaryTitle: "ట్రిప్ సారాంశం",
    fmGrossRevenueLabel: "మొత్తం ఆదాయం:",
    fmTotalTripCostLabel: "మొత్తం ట్రిప్ ఖర్చు:",
    fmNetProfitLabel: "నికర లాభం:",
    fmProfitMarginLabel: "లాభ మార్జిన్:",
    fmCalcDefaultsNote: "ఈరోజు సిఫార్సు చేసిన జాతి మరియు ఈ యాప్ యొక్క సిమ్యులేటెడ్ మార్కెట్ డేటా నుండి డిఫాల్ట్‌లు ముందుగా నింపబడ్డాయి — ఏదైనా ఫీల్డ్‌ను మార్చి మళ్లీ లెక్కించండి నొక్కండి.",
    fmTripPerformanceTitle: "మీ ట్రిప్ పనితీరు",
    fmLoadingPerformance: "పనితీరు చరిత్ర లోడ్ అవుతోంది…",
    fmThTrip: "ట్రిప్",
    fmThCatchKg: "పట్టు (కేజీ)",
    fmThRevenue: "ఆదాయం",
    fmThProfit: "లాభం",
    fmCommunityFeedTitle: "సమాజం మరియు సలహా ఫీడ్",
    fmBuiltBy: "నిర్మించినవారు",
    fmHackathonLine: "Smart India Hackathon 2026 · సమస్యా ప్రకటన 26176 (ISRO)",
    fmFooterDisclaimer: "నిరాకరణ: జాతి మార్కెట్ ధరలు, కొనుగోలుదారు లీడ్‌లు మరియు ట్రిప్ చరిత్ర Smart India Hackathon 2026 జడ్జింగ్ ప్రదర్శన కోసం సిమ్యులేట్ చేయబడ్డాయి.",
    fmNoTripHistory: "ఇంకా ట్రిప్ చరిత్ర నమోదు కాలేదు.",
    fmYourCatch: "మీ పట్టు",
    fmTripAgoSingular: "{n} ట్రిప్ క్రితం",
    fmTripAgoPlural: "{n} ట్రిప్‌ల క్రితం",
    fmTargetSpeciesColon: "లక్ష్య జాతి:",
    fmYieldWord: "దిగుబడి",
    fmSstLabel: "SST:",
    fmDepthLabel: "లోతు:",
    fmSafetyLabel: "భద్రత:",
    fmOpportunityDescTemplate: "ఈరోజు ₹{price}/కేజీకి {zone} సమీపంలో ఉత్తమ మ్యాచ్ — మొత్తం అవకాశ స్కోరు {score}/100.",
    fmTheRecommendedZone: "సిఫార్సు చేసిన మండలం",
    fmSellSmarterDescTemplate: "{species}: అనధికారిక మార్కెట్‌కు బదులుగా ORCA-సరిపోలిన కొనుగోలుదారుకు అమ్మడం వల్ల, భావించిన {catch} కేజీల పట్టుపై అంచనా అదనపు {revenue} లభిస్తుంది.",
    fmAiErrorTemplate: "ORCA యొక్క ఏఐ నిర్ణయ స్టూడియో బ్యాకెండ్‌ను ({error}) చేరుకోలేకపోయింది. ML మోడల్‌లకు శిక్షణ ఇవ్వడానికి ఒకసారి బ్యాకెండ్ సెటప్ అవసరం -- backend/ml/training/ చూడండి. కొద్ది సేపట్లో మళ్లీ ప్రయత్నించండి.",
    fmPlanDescTemplate: "ఉత్తమ విండో {window} · {market} వద్ద అమ్మండి · ORCA ట్రిప్ స్కోరు {score}/100.",
    fmTheRecommendedMarket: "సిఫార్సు చేసిన మార్కెట్",
    fmKmFromPortTemplate: "పోర్టు నుండి {km} కి.మీ",
    fmStatusLive: "లైవ్",
    fmStatusOffline: "బ్యాకెండ్ ఆఫ్‌లైన్ — చివరిగా తెలిసిన డేటా చూపిస్తోంది",
    fmScoreOcean: "సముద్ర భద్రత",
    fmScoreFish: "చేపల దిగుబడి",
    fmScoreMarket: "మార్కెట్ మొమెంటం",
    fmScoreProfit: "లాభ మార్జిన్",
    fmTierHigh: "అధిక",
    fmTierGood: "మంచి",
    fmTierModerate: "మధ్యస్థ",
    fmPostWeatherAlert: "వాతావరణ హెచ్చరిక",
    fmPostMarketUpdate: "మార్కెట్ నవీకరణ",
    fmPostFishermanReport: "మత్స్యకారుని నివేదిక",
    fmPostUpdate: "నవీకరణ",
    fmNearbyBusinessesTitle: "సమీప సీఫుడ్ కొనుగోలుదారులు & మార్కెట్‌లు · లైవ్",
    fmNearbyBusinessesDesc: "మీ ప్రస్తుత స్థానానికి సమీపంలో OpenStreetMap ద్వారా నిజమైన, లైవ్ — సమీపంలో సీఫుడ్ కొనుగోలు/అందించే రెస్టారెంట్‌లు మరియు దుకాణాలు. ఇది కొనుగోలుదారు అవసరం/లీడ్ కాదు; దాని కోసం దిగువన ఉన్న కొనుగోలుదారు లీడ్‌లను చూడండి.",
    fmRefreshBtn: "రిఫ్రెష్ చేయండి",
    fmLoadingNearby: "సమీప సీఫుడ్ కొనుగోలుదారులను తనిఖీ చేస్తోంది…",
    fmNearbyBadgeLive: "లైవ్",
    fmNearbyBadgeUnavailable: "అందుబాటులో లేదు",
    fmNearbyNoneFound: "ప్రస్తుతం పరిధిలో సీఫుడ్ కొనుగోలుదారులు లేదా మార్కెట్‌లు కనుగొనబడలేదు.",
    fmNearbyFailed: "ప్రస్తుతం లైవ్ సమీప-వ్యాపార డేటాను చేరుకోలేకపోయింది.",
    fmPostBuyerDemandBtn: "+ కొనుగోలుదారు డిమాండ్‌ను పోస్ట్ చేయండి",
    fmBuyerLeadsRealNote: "LIVE ట్యాగ్ చేయబడిన లీడ్‌లు ORCA యొక్క బయ్యర్ నెట్‌వర్క్ ద్వారా పోస్ట్ చేయబడిన నిజమైన, ధృవీకరించబడిన కొనుగోలుదారు అవసరాలు. మిగతావి సిమ్యులేటెడ్ డెమో డేటా.",
    fmBuyerModalTitle: "నిజమైన కొనుగోలుదారు డిమాండ్‌ను పోస్ట్ చేయండి",
    fmBuyerModalDesc: "మీ ఇమెయిల్‌కు పంపిన వన్-టైమ్ కోడ్ ద్వారా ధృవీకరించబడింది (లేదా ఈ డెమో కోసం ఇమెయిల్ కాన్ఫిగర్ చేయకపోతే నేరుగా ఇక్కడ చూపబడుతుంది). ORCA లో ఎలాంటి చెల్లింపులు జరగవు — ఇది మిమ్మల్ని మత్స్యకారులతో అనుసంధానిస్తుంది.",
    fmBuyerBusinessNameLabel: "వ్యాపార పేరు",
    fmBuyerEmailLabel: "సంప్రదింపు ఇమెయిల్",
    fmBuyerLocationLabel: "స్థానం",
    fmBuyerSendCodeBtn: "ధృవీకరణ కోడ్‌ను పంపండి",
    fmBuyerDevOtpTemplate: "ఈ డెమో కోసం ఇమెయిల్ కాన్ఫిగర్ చేయలేదు — మీ కోడ్ {code}",
    fmBuyerOtpLabel: "ధృవీకరణ కోడ్",
    fmBuyerVerifyBtn: "కోడ్‌ను ధృవీకరించండి",
    fmBuyerQtyLabel: "అవసరమైన పరిమాణం (కేజీ)",
    fmBuyerDeadlineLabel: "గడువు",
    fmBuyerPriceMinLabel: "కనీస ధర (₹/కేజీ)",
    fmBuyerPriceMaxLabel: "గరిష్ట ధర (₹/కేజీ)",
    fmBuyerListingLocationLabel: "పికప్ స్థానం",
    fmBuyerPostListingBtn: "లిస్టింగ్‌ను పోస్ట్ చేయండి",
    fmBuyerSuccessTitle: "లిస్టింగ్ పోస్ట్ చేయబడింది",
    fmBuyerSuccessDesc: "మీ నిజమైన కొనుగోలుదారు అవసరం ఇప్పుడు మత్స్యకారులు చూడటానికి మరియు క్లెయిమ్ చేయడానికి బయ్యర్ లీడ్‌లలో లైవ్‌గా ఉంది.",
    fmBuyerDoneBtn: "పూర్తయింది",
    fmBuyerErrRequired: "వ్యాపార పేరు మరియు ఇమెయిల్ అవసరం.",
    fmBuyerErrOtp: "ధృవీకరణ కోడ్‌ను నమోదు చేయండి.",
    fmBuyerErrGeneric: "ఏదో తప్పు జరిగింది — దయచేసి మళ్లీ ప్రయత్నించండి.",
    fmBuyerErrQty: "కేజీలలో అవసరమైన పరిమాణాన్ని నమోదు చేయండి.",
    fmBuyerLiveTag: "లైవ్",
    fmBuyerDemoTag: "డెమో",
    fmClaimBtn: "ఈ లీడ్‌ను క్లెయిమ్ చేయండి",
    fmClaimPromptText: "దీన్ని ఎవరు పూర్తి చేస్తున్నారో కొనుగోలుదారుకు తెలియజేయడానికి మీ పేరు మరియు ఫోన్/సంప్రదింపు వివరాలను నమోదు చేయండి:",
    fmClaimSuccess: "క్లెయిమ్ చేయబడింది — కొనుగోలుదారుకు ప్లాట్‌ఫారమ్ వెలుపల తెలియజేయబడుతుంది.",
    fmClaimFailed: "ప్రస్తుతం ఈ లిస్టింగ్‌ను క్లెయిమ్ చేయలేకపోయింది."
  },
  or: {
    appTitle: "ଓର୍କା ଇନସାଇଟ (ORCA INSIGHT)",
    appSubtitle: "ISRO ସହଯୋଗୀ ସାମୁଦ୍ରିକ ବୁଦ୍ଧିମତା · SIH 2026 PS 26176",
    teamName: "ଟିମ୍ ସେଭିଅର୍ସଏକ୍ସ (Team SavioursX)",
    navHome: "ମୂଳପୃଷ୍ଠା",
    navChat: "ଏଆଇ ନିଷ୍ପତ୍ତି ଷ୍ଟୁଡିଓ",
    navMap: "GIS କମାଣ୍ଡ ମାନଚିତ୍ର",
    navDAG: "ଏଜେଣ୍ଟ DAG ଭିଜୁଆଲାଇଜର",
    navSafety: "ସୁରକ୍ଷା ବାରୋମିଟର",
    navFleet: "ଫ୍ଲିଟ୍ ମନିଟର",
    navFleetGIS: "ଫ୍ଲିଟ୍ ଏବଂ GIS କମାଣ୍ଡ",
    navNavic: "ନାଭିକ୍ (NavIC) ଜିପିଏସ",
    navBulletins: "ପରାମର୍ଶ ବୁଲେଟିନ",
    navSafetyAdv: "ସୁରକ୍ଷା ଏବଂ ପରାମର୍ଶ",
    heroTitle: "ଭାରତୀୟ ମହାସାଗର ପାଇଁ ସହଯୋଗୀ ସାମୁଦ୍ରିକ ବୁଦ୍ଧିମତା",
    heroDesc: "ISRO Oceansat-3, INSAT-3DR ଉପଗ୍ରହ ସମୁଦ୍ରବିଜ୍ଞାନ, IMBL ଜିଓଫେନ୍ସିଂ, ରିଅଲ-ଟାଇମ ଫ୍ଲିଟ୍ ଘନତା ଏବଂ ଯାତ୍ରା ETA ଉପରେ ତର୍କ କରି ଭାରତର ଉପକୂଳବର୍ତ୍ତୀ ମତ୍ସ୍ୟଜୀବୀ ସମ୍ପ୍ରଦାୟକୁ ସଶକ୍ତ କରିବା।",
    ctaStudio: "ଏଆଇ ନିଷ୍ପତ୍ତି ଷ୍ଟୁଡିଓ ଆରମ୍ଭ କରନ୍ତୁ",
    ctaMap: "GIS କମାଣ୍ଡ ମାନଚିତ୍ର ଖୋଲନ୍ତୁ",
    ctaFleet: "ଫ୍ଲିଟ୍ ମନିଟର ଯାଞ୍ଚ କରନ୍ତୁ",
    ctaFleetGIS: "ଫ୍ଲିଟ୍ ଏବଂ GIS କମାଣ୍ଡ ଖୋଲନ୍ତୁ",
    statsActiveVessels: "ଟ୍ରାକ୍ କରାଯାଇଥିବା ସକ୍ରିୟ ଜାହାଜ",
    statsSatellites: "ISRO ଉପଗ୍ରହ ଫିଡ୍",
    statsPFZ: "ଉଚ୍ଚ-ଅମଳ ମତ୍ସ୍ୟଜୀବୀ ମଣ୍ଡଳ",
    statsIMBL: "IMBL ଜିଓଫେନ୍ସ ହୋଇଥିବା ସେକ୍ଟର",
    chipPFZ: "ନିକଟସ୍ଥ ଉଚ୍ଚ-ଅମଳ PFZ ଖୋଜନ୍ତୁ",
    chipSafety: "ସମୁଦ୍ର-ଯାତ୍ରା ମଞ୍ଜୁରି ଯାଞ୍ଚ କରନ୍ତୁ",
    chipBorder: "IMBL ସୀମା ଦୂରତା ଯାଞ୍ଚ",
    chipDensity: "ଜାହାଜ ଘନତା ଏବଂ ଭିଡ଼",
    chipETA: "ETA ଏବଂ ସୁରକ୍ଷିତ ପ୍ରତ୍ୟାବର୍ତ୍ତନ ସମୟ ଗଣନା କରନ୍ତୁ",
    chatPlaceholder: "ORCA କୁ ପଚାରନ୍ତୁ (କିମ୍ବା କହିବାକୁ ମାଇକ୍ରୋଫୋନ୍ ଦବାନ୍ତୁ)...",
    chatSend: "ଏଜେଣ୍ଟମାନଙ୍କୁ ପଚାରନ୍ତୁ",
    routePlannerTitle: "ଯାତ୍ରା ମାର୍ଗ ସିମୁଲେଟର ଏବଂ ସି-ଷ୍ଟେଟ ETA",
    originHarbour: "ମୂଳ ମତ୍ସ୍ୟଜୀବୀ ବନ୍ଦର",
    destinationPFZ: "ଗନ୍ତବ୍ୟ PFZ ମଣ୍ଡଳ",
    simulateRouteBtn: "ସୁରକ୍ଷିତ ମାର୍ଗ ଏବଂ ETA ସିମୁଲେଟ୍ କରନ୍ତୁ",
    distanceNM: "ମାର୍ଗ ଦୂରତା (ନଟିକାଲ ମାଇଲ)",
    liveETA: "ଲାଇଭ୍ ସି-ଷ୍ଟେଟ ETA",
    returnDusk: "ସନ୍ଧ୍ୟା ପୂର୍ବରୁ ପ୍ରତ୍ୟାବର୍ତ୍ତନ ସୁରକ୍ଷା ନିଷ୍ପତ୍ତି",
    sosButton: "SOS ଜରୁରୀକାଳୀନ",
    clearanceSafe: "ସମୁଦ୍ର-ଯାତ୍ରା ପାଇଁ ସୁରକ୍ଷିତ",
    clearanceCaution: "ସତର୍କତା ସହ ଆଗକୁ ବଢ଼ନ୍ତୁ",
    clearanceUnsafe: "ଅସୁରକ୍ଷିତ: ଯାତ୍ରା କରନ୍ତୁ ନାହିଁ",
    bigVerdictQuestion: "ଆଜି ମାଛ ଧରିବାକୁ ଯିବା ସୁରକ୍ଷିତ କି?",
    bigVerdictYes: "ହଁ",
    bigVerdictNo: "ନା",
    bigVerdictCaution: "ସତର୍କତା",
    listenVerdict: "ଶୁଣନ୍ତୁ",
    waveHeight: "ଉଲ୍ଲେଖନୀୟ ତରଙ୍ଗ ଉଚ୍ଚତା",
    windSpeed: "ପୃଷ୍ଠ ପବନ ବେଗ",
    seaState: "ଡଗଲାସ୍ ସି ଷ୍ଟେଟ",
    lightningRisk: "ବିଜୁଳି ଏବଂ ଝଡ଼ ବିପଦ",
    vesselTableTitle: "ଲାଇଭ୍ ଉପକୂଳବର୍ତ୍ତୀ ଫ୍ଲିଟ୍ ଟେଲିମେଟ୍ରି (ଲାଇଭ୍ AIS + ସିମୁଲେଟେଡ୍ ଫିଲ-ଇନ)",
    simulatedDisclaimer: "ଟିପ୍ପଣୀ: ଯେଉଁଠାରେ ଏପର୍ଯ୍ୟନ୍ତ ରିସିଭର ଆବରଣ ନାହିଁ, ସେଠାରେ ଲାଇଭ୍ AIS ଜାହାଜ ସ୍ଥିତି ସ୍ପଷ୍ଟ ଭାବେ ଟ୍ୟାଗ୍ ହୋଇଥିବା ସିମୁଲେଟେଡ୍ ଫ୍ଲିଟ୍ ସହିତ ପୂରଣ ହୁଏ। Smart India Hackathon 2026 ପ୍ରଦର୍ଶନ ପାଇଁ ଉପଗ୍ରହ ସମୁଦ୍ରବିଜ୍ଞାନ ସ୍ତର ସିମୁଲେଟେଡ୍ ହିଁ ରହିଥାଏ।",
    fmTitle: "ଓର୍କା ଫିସରମ୍ୟାନ (ORCA FISHERMAN)",
    fmSubtitle: "ଦୈନିକ ସୁଯୋଗ କନସୋଲ · ଟିମ୍ ସେଭିଅର୍ସଏକ୍ସ",
    fmLiveFeedBadge: "ଲାଇଭ୍ ସୁଯୋଗ ଫିଡ୍",
    fmToggleDarkMode: "ଡାର୍କ ମୋଡ୍ ଟୋଗଲ୍ କରନ୍ତୁ",
    fmBackToHub: "← ହବ୍",
    fmBackToHubTitle: "ORCA ହବ୍‌କୁ ଫେରନ୍ତୁ",
    fmNavOpportunity: "ଆଜିର ସୁଯୋଗ",
    fmNavMap: "ମତ୍ସ୍ୟଜୀବୀ ମଣ୍ଡଳ ମାନଚିତ୍ର",
    fmNavSell: "ବୁଦ୍ଧିମତାର ସହ ବିକ୍ରି କରନ୍ତୁ",
    fmNavCalculator: "ଯାତ୍ରା ଖର୍ଚ୍ଚ କାଲକୁଲେଟର",
    fmNavCommunity: "କାର୍ଯ୍ୟଦକ୍ଷତା ଏବଂ ସମ୍ପ୍ରଦାୟ",
    fmCheckingBackend: "ବ୍ୟାକଏଣ୍ଡ ଯାଞ୍ଚ କରାଯାଉଛି...",
    fmBestOpportunityLabel: "ଆଜିର ସର୍ବୋତ୍ତମ ସୁଯୋଗ",
    fmLoadingOpportunityDesc: "ଫିସରମ୍ୟାନ ଅପର୍ଚୁନିଟି ଏଜେଣ୍ଟଠାରୁ ଆଜିର ସୁଯୋଗ ଲୋଡ଼ ହେଉଛି…",
    fmPreferredSpeciesLabel: "ପସନ୍ଦିତ ପ୍ରଜାତି:",
    fmAutoBestMatch: "ଅଟୋ (ସର୍ବୋତ୍ତମ ମେଳ)",
    fmOpportunityScoreLabel: "ସୁଯୋଗ ସ୍କୋର",
    fmRecommendedZoneLabel: "ପରାମର୍ଶିତ ମଣ୍ଡଳ",
    fmExpectedCatchLabel: "ଆଶାତୀତ ଧରା",
    fmAtTodaysPrice: "ଆଜିର ମୂଲ୍ୟରେ",
    fmRevenueRangeLabel: "ରାଜସ୍ୱ ପରିସର",
    fmBeforeTripCosts: "ଯାତ୍ରା ଖର୍ଚ୍ଚ ପୂର୍ବରୁ",
    fmEstimatedProfitLabel: "ଆକଳିତ ଲାଭ",
    fmConfidenceLabel: "ବିଶ୍ୱାସନୀୟତା",
    fmScoreBreakdownTitle: "ସୁଯୋଗ ସ୍କୋର ବିଭାଜନ",
    fmAiStudioTitle: "ଏଆଇ ନିଷ୍ପତ୍ତି ଷ୍ଟୁଡିଓ — ଆପଣଙ୍କ ଯାତ୍ରା ଯୋଜନା କରନ୍ତୁ",
    fmAiStudioDesc: "ORCA ର ନିଜସ୍ୱ ତଥ୍ୟ ଉପରେ ତାଲିମ ପାଇଥିବା 4ଟି ଅନ-ଡିଭାଇସ scikit-learn ମଡେଲ (ଧରା, ମଣ୍ଡଳ, ପ୍ରଜାତି, ମୂଲ୍ୟ), ଏକ ନିର୍ଦ୍ଧାରିତ ଲାଭ ଏବଂ ବିପଦ ଇଞ୍ଜିନ ସହିତ ମିଶି କାର୍ଯ୍ୟ କରନ୍ତି। ଏହି ସମଗ୍ର ପ୍ରକ୍ରିୟାରେ କେଉଁଠାରେ ମଧ୍ୟ ବାହ୍ୟ ଏଆଇ API ବ୍ୟବହାର ହୁଏ ନାହିଁ।",
    fmDemoModelBadge: "ଡେମୋ ମଡେଲ୍ · ସିନ୍ଥେଟିକ୍ ତାଲିମ ତଥ୍ୟ",
    fmTripPlannerTitle: "ଯାତ୍ରା ଯୋଜକ",
    fmBoatTypeLabel: "ଡଙ୍ଗା ପ୍ରକାର",
    fmBoatTraditional: "ପାରମ୍ପାରିକ (ଅଯାନ୍ତ୍ରିକ)",
    fmBoatMotorized: "ମୋଟରଯୁକ୍ତ",
    fmBoatMechanized: "ଯାନ୍ତ୍ରିକ ଟ୍ରଲର",
    fmGearTypeLabel: "ଗିଅର ପ୍ରକାର",
    fmGearGillnet: "ଗିଲନେଟ",
    fmGearTrawl: "ଟ୍ରଲ",
    fmGearRingSeine: "ରିଙ୍ଗ ସିନ",
    fmGearLongline: "ଲଙ୍ଗଲାଇନ",
    fmGearHookLine: "ହୁକ୍ ଏବଂ ଲାଇନ",
    fmTripDurationLabel: "ଯାତ୍ରା ଅବଧି (ଘଣ୍ଟା)",
    fmTargetSpeciesLabel: "ଲକ୍ଷ୍ୟ ପ୍ରଜାତି",
    fmSpeciesTuna: "ଟୁନା",
    fmSpeciesPomfret: "ପମ୍ଫ୍ରେଟ",
    fmSpeciesSardine: "ସାର୍ଡିନ",
    fmSpeciesMackerel: "ମାକେରେଲ (ବଙ୍ଗଡ଼ା)",
    fmSpeciesKingfish: "କିଙ୍ଗଫିସ (ସୁରମାଇ)",
    fmUsesCurrentLocation: "ଆପଣଙ୍କର ବର୍ତ୍ତମାନର ବନ୍ଦର ସ୍ଥାନ ଏବଂ ଆଜିର ଲାଇଭ୍ ସାମୁଦ୍ରିକ ପାଣିପାଗ ବ୍ୟବହାର କରେ।",
    fmPlanMyTrip: "ମୋ ଯାତ୍ରା ଯୋଜନା କରନ୍ତୁ",
    fmRunningModelsBtn: "ORCA ମଡେଲ ଚାଲୁଛି…",
    fmRunningModelsDesc: "ORCA ର ଅନ-ଡିଭାଇସ ML ମଡେଲ (ଧରା, ମଣ୍ଡଳ, ପ୍ରଜାତି, ମୂଲ୍ୟ) ଏବଂ ଲାଭ-ବିପଦ ଇଞ୍ଜିନ ଚଲାଉଛି…",
    fmRecommendedPlanLabel: "ORCA ର ପରାମର୍ଶିତ ଯୋଜନା",
    fmTripScoreLabel: "ORCA ଯାତ୍ରା ସ୍କୋର",
    fmBestZoneLabel: "ସର୍ବୋତ୍ତମ ମଣ୍ଡଳ",
    fmBestTimeWindowLabel: "ସର୍ବୋତ୍ତମ ସମୟ ୱିଣ୍ଡୋ",
    fmHighestPredictedCatch: "ସର୍ବାଧିକ ପୂର୍ବାନୁମାନିତ ଧରା",
    fmReliabilityLabel: "ନିର୍ଭରଯୋଗ୍ୟତା",
    fmRiskLabel: "ବିପଦ",
    fmZoneRankingTitle: "ମଣ୍ଡଳ ର‍୍ୟାଙ୍କିଂ · ମତ୍ସ୍ୟଜୀବୀ ସାମର୍ଥ୍ୟ",
    fmSpeciesSuitabilityTitle: "ପ୍ରଜାତି ଉପଯୁକ୍ତତା ର‍୍ୟାଙ୍କିଂ",
    fmWhereToSellTitle: "କେଉଁଠାରେ ବିକ୍ରି କରିବେ",
    fmThMarket: "ବଜାର",
    fmThDistance: "ଦୂରତା",
    fmThPricePerKg: "ମୂଲ୍ୟ/କିଗ୍ରା",
    fmThNetRevenue: "ନିଟ୍ ରାଜସ୍ୱ",
    fmFeatureImportanceTitle: "ଏହି ପୂର୍ବାନୁମାନ କେଉଁ ଉପରେ ଆଧାରିତ",
    fmFeatureImportanceDesc: "ଏହି ଯାତ୍ରା ପାଇଁ ଧରା ମଡେଲ ପ୍ରକୃତରେ ବିଚାର କରିଥିବା ମୁଖ୍ୟ କାରକଗୁଡ଼ିକ — ତାଲିମପ୍ରାପ୍ତ ମଡେଲରୁ ପଢ଼ାଯାଇଥିବା ପ୍ରକୃତ ଫିଚର ଇମ୍ପର୍ଟାନ୍ସ, ବନାଇଥିବା ନୁହେଁ।",
    fmWhyOrcaTitle: "ORCA ଏହାକୁ କାହିଁକି ବାଛିଲା",
    fmModelTransparencyTitle: "ମଡେଲ ସ୍ୱଚ୍ଛତା",
    fmModelTransparencyDisclaimer: "ଡେମୋ ମଡେଲ — ଉପରୋକ୍ତ ପ୍ରତ୍ୟେକ ମଡେଲ ORCA ର ସିନ୍ଥେଟିକ୍ ପ୍ରଦର୍ଶନ ଡାଟାସେଟ ଉପରେ ତାଲିମପ୍ରାପ୍ତ, ପ୍ରକୃତ ଐତିହାସିକ ଧରା ରେକର୍ଡ ଉପରେ ନୁହେଁ। ନିର୍ଭରଯୋଗ୍ୟତା ଅଙ୍କ ସେହି ଡାଟାସେଟ ଉପରେ ମାପାଯାଇଛି, ପ୍ରକୃତ-ଜଗତ ସଠିକତା ଉପରେ ନୁହେଁ।",
    fmZonesMapTitle: "ସର୍ବୋତ୍ତମ ମାଛ ଅମଳ ମଣ୍ଡଳ · ଲାଇଭ୍ ମାନଚିତ୍ର",
    fmZonesMapDesc: "ଆଜିର ସୁଯୋଗରେ ବ୍ୟବହୃତ ସମାନ ଲାଇଭ୍-ସ୍କୋର ହୋଇଥିବା ଓସନ ଆନାଲିଟିକ୍ସ ଏବଂ PFZ ଏଜେଣ୍ଟ ତଥ୍ୟ, GIS କମାଣ୍ଡ ମାନଚିତ୍ରର ବେସମ୍ୟାପ ଉପରେ ଦେଖାଯାଇଛି।",
    fmRankedByYieldTitle: "ଅମଳ ଅନୁସାରେ ର‍୍ୟାଙ୍କ ହୋଇଛି",
    fmLoadingZones: "ମଣ୍ଡଳଗୁଡ଼ିକ ଲୋଡ଼ ହେଉଛି…",
    fmTopZoneLabel: "ଶୀର୍ଷ ମଣ୍ଡଳ:",
    fmYieldScoreLabel: "ଅମଳ ସ୍କୋର:",
    fmLoadingPricing: "ମୂଲ୍ୟ ତୁଳନା ଲୋଡ଼ ହେଉଛି…",
    fmTypicalPriceLabel: "ସାଧାରଣ ଅନୌପଚାରିକ ମୂଲ୍ୟ",
    fmOpportunityPriceLabel: "ORCA ସୁଯୋଗ ମୂଲ୍ୟ",
    fmExtraRevenueLabel: "ସମ୍ଭାବ୍ୟ ଅତିରିକ୍ତ ରାଜସ୍ୱ",
    fmSpeciesPriceRankingTitle: "ପ୍ରଜାତି ମୂଲ୍ୟ ର‍୍ୟାଙ୍କିଂ",
    fmThSpecies: "ପ୍ରଜାତି",
    fmThTrend: "ଧାରା",
    fmThDemand: "ଚାହିଦା",
    fmThEstProfit: "ଆକଳିତ ଲାଭ",
    fmThOpportunityScore: "ସୁଯୋଗ ସ୍କୋର",
    fmBuyerLeadsTitle: "କ୍ରେତା ଲିଡ୍",
    fmTripCostCalcTitle: "ଯାତ୍ରା-ଖର୍ଚ୍ଚ କାଲକୁଲେଟର",
    fmSpeciesLabel: "ପ୍ରଜାତି",
    fmExpectedCatchKgLabel: "ଆଶାତୀତ ଧରା (କିଗ୍ରା)",
    fmPricePerKgLabel: "ପ୍ରତି କିଗ୍ରା ମୂଲ୍ୟ (₹)",
    fmFuelLabel: "ଇନ୍ଧନ (₹)",
    fmIceLabel: "ବରଫ (₹)",
    fmOtherLabel: "ଅନ୍ୟାନ୍ୟ (₹)",
    fmRecalculateBtn: "ପୁନଃ ଗଣନା କରନ୍ତୁ",
    fmTripSummaryTitle: "ଯାତ୍ରା ସାରାଂଶ",
    fmGrossRevenueLabel: "ମୋଟ ରାଜସ୍ୱ:",
    fmTotalTripCostLabel: "ମୋଟ ଯାତ୍ରା ଖର୍ଚ୍ଚ:",
    fmNetProfitLabel: "ନିଟ୍ ଲାଭ:",
    fmProfitMarginLabel: "ଲାଭ ମାର୍ଜିନ:",
    fmCalcDefaultsNote: "ଆଜିର ପରାମର୍ଶିତ ପ୍ରଜାତି ଏବଂ ଏହି ଆପ୍‌ର ସିମୁଲେଟେଡ୍ ବଜାର ତଥ୍ୟରୁ ଡିଫଲ୍ଟ ପୂର୍ବରୁ ପୂରଣ ହୋଇଛି — କୌଣସି ଫିଲ୍ଡ ପରିବର୍ତ୍ତନ କରନ୍ତୁ ଏବଂ ପୁନଃ ଗଣନା କରନ୍ତୁ ଦବାନ୍ତୁ।",
    fmTripPerformanceTitle: "ଆପଣଙ୍କର ଯାତ୍ରା କାର୍ଯ୍ୟଦକ୍ଷତା",
    fmLoadingPerformance: "କାର୍ଯ୍ୟଦକ୍ଷତା ଇତିହାସ ଲୋଡ଼ ହେଉଛି…",
    fmThTrip: "ଯାତ୍ରା",
    fmThCatchKg: "ଧରା (କିଗ୍ରା)",
    fmThRevenue: "ରାଜସ୍ୱ",
    fmThProfit: "ଲାଭ",
    fmCommunityFeedTitle: "ସମ୍ପ୍ରଦାୟ ଏବଂ ପରାମର୍ଶ ଫିଡ୍",
    fmBuiltBy: "ନିର୍ମାତା",
    fmHackathonLine: "Smart India Hackathon 2026 · ସମସ୍ୟା ବିବୃତ୍ତି 26176 (ISRO)",
    fmFooterDisclaimer: "ଅସ୍ୱୀକରଣ: ପ୍ରଜାତି ବଜାର ମୂଲ୍ୟ, କ୍ରେତା ଲିଡ୍ ଏବଂ ଯାତ୍ରା ଇତିହାସ Smart India Hackathon 2026 ବିଚାର ପ୍ରଦର୍ଶନ ପାଇଁ ସିମୁଲେଟେଡ୍।",
    fmNoTripHistory: "ଏପର୍ଯ୍ୟନ୍ତ କୌଣସି ଯାତ୍ରା ଇତିହାସ ଲିପିବଦ୍ଧ ହୋଇନାହିଁ।",
    fmYourCatch: "ଆପଣଙ୍କର ଧରା",
    fmTripAgoSingular: "{n} ଯାତ୍ରା ପୂର୍ବେ",
    fmTripAgoPlural: "{n} ଯାତ୍ରା ପୂର୍ବେ",
    fmTargetSpeciesColon: "ଲକ୍ଷ୍ୟ ପ୍ରଜାତି:",
    fmYieldWord: "ଅମଳ",
    fmSstLabel: "SST:",
    fmDepthLabel: "ଗଭୀରତା:",
    fmSafetyLabel: "ସୁରକ୍ଷା:",
    fmOpportunityDescTemplate: "ଆଜି ₹{price}/କିଗ୍ରାରେ {zone} ନିକଟରେ ସର୍ବୋତ୍ତମ ମେଳ — ମିଳିତ ସୁଯୋଗ ସ୍କୋର {score}/100।",
    fmTheRecommendedZone: "ପରାମର୍ଶିତ ମଣ୍ଡଳ",
    fmSellSmarterDescTemplate: "{species}: ଅନୌପଚାରିକ ବଜାର ପରିବର୍ତ୍ତେ ORCA-ମେଳ ହୋଇଥିବା କ୍ରେତାଙ୍କୁ ବିକ୍ରି କରିବା ଦ୍ୱାରା, ଅନୁମାନିତ {catch} କିଗ୍ରା ଧରା ଉପରେ ଆକଳିତ ଅତିରିକ୍ତ {revenue} ମିଳେ।",
    fmAiErrorTemplate: "ORCA ର ଏଆଇ ନିଷ୍ପତ୍ତି ଷ୍ଟୁଡିଓ ବ୍ୟାକଏଣ୍ଡ ({error}) ପାଖରେ ପହଞ୍ଚିହେଲା ନାହିଁ। ML ମଡେଲକୁ ତାଲିମ ଦେବା ପାଇଁ ଏକ ଥର ବ୍ୟାକଏଣ୍ଡ ସେଟଅପ୍ ଆବଶ୍ୟକ -- backend/ml/training/ ଦେଖନ୍ତୁ। ଟିକିଏ ପରେ ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ।",
    fmPlanDescTemplate: "ସର୍ବୋତ୍ତମ ୱିଣ୍ଡୋ {window} · {market} ରେ ବିକ୍ରି କରନ୍ତୁ · ORCA ଯାତ୍ରା ସ୍କୋର {score}/100।",
    fmTheRecommendedMarket: "ପରାମର୍ଶିତ ବଜାର",
    fmKmFromPortTemplate: "ବନ୍ଦରଠାରୁ {km} କିମି",
    fmStatusLive: "ଲାଇଭ୍",
    fmStatusOffline: "ବ୍ୟାକଏଣ୍ଡ ଅଫଲାଇନ୍ — ଶେଷ ଜଣାଶୁଣା ତଥ୍ୟ ଦେଖାଉଛି",
    fmScoreOcean: "ସାମୁଦ୍ରିକ ସୁରକ୍ଷା",
    fmScoreFish: "ମାଛ ଅମଳ",
    fmScoreMarket: "ବଜାର ଗତି",
    fmScoreProfit: "ଲାଭ ମାର୍ଜିନ",
    fmTierHigh: "ଉଚ୍ଚ",
    fmTierGood: "ଭଲ",
    fmTierModerate: "ମଧ୍ୟମ",
    fmPostWeatherAlert: "ପାଣିପାଗ ଚେତାବନୀ",
    fmPostMarketUpdate: "ବଜାର ଅପଡେଟ",
    fmPostFishermanReport: "ମତ୍ସ୍ୟଜୀବୀ ରିପୋର୍ଟ",
    fmPostUpdate: "ଅପଡେଟ",
    fmNearbyBusinessesTitle: "ନିକଟସ୍ଥ ସିଫୁଡ୍ କ୍ରେତା ଏବଂ ବଜାର · ଲାଇଭ୍",
    fmNearbyBusinessesDesc: "ଆପଣଙ୍କର ବର୍ତ୍ତମାନର ସ୍ଥାନ ନିକଟରେ OpenStreetMap ମାଧ୍ୟମରେ ପ୍ରକୃତ, ଲାଇଭ୍ — ନିକଟରେ ସିଫୁଡ୍ କିଣୁଥିବା/ପରିବେଷଣ କରୁଥିବା ରେଷ୍ଟୁରାଣ୍ଟ ଏବଂ ଦୋକାନ। ଏହା କ୍ରେତା ଆବଶ୍ୟକତା/ଲିଡ୍ ନୁହେଁ; ସେଥିପାଇଁ ତଳେ କ୍ରେତା ଲିଡ୍ ଦେଖନ୍ତୁ।",
    fmRefreshBtn: "ରିଫ୍ରେଶ କରନ୍ତୁ",
    fmLoadingNearby: "ନିକଟସ୍ଥ ସିଫୁଡ୍ କ୍ରେତାମାନଙ୍କୁ ଯାଞ୍ଚ କରାଯାଉଛି…",
    fmNearbyBadgeLive: "ଲାଇଭ୍",
    fmNearbyBadgeUnavailable: "ଅନୁପଲବ୍ଧ",
    fmNearbyNoneFound: "ବର୍ତ୍ତମାନ ପରିସର ମଧ୍ୟରେ କୌଣସି ସିଫୁଡ୍ କ୍ରେତା କିମ୍ବା ବଜାର ମିଳିଲା ନାହିଁ।",
    fmNearbyFailed: "ବର୍ତ୍ତମାନ ଲାଇଭ୍ ନିକଟସ୍ଥ-ବ୍ୟବସାୟ ତଥ୍ୟ ପାଖରେ ପହଞ୍ଚିହେଲା ନାହିଁ।",
    fmPostBuyerDemandBtn: "+ କ୍ରେତା ଚାହିଦା ପୋଷ୍ଟ କରନ୍ତୁ",
    fmBuyerLeadsRealNote: "LIVE ଟ୍ୟାଗ୍ ହୋଇଥିବା ଲିଡ୍ ORCA ର ବାୟର ନେଟୱାର୍କ ମାଧ୍ୟମରେ ପୋଷ୍ଟ ହୋଇଥିବା ପ୍ରକୃତ, ଯାଞ୍ଚିତ କ୍ରେତା ଆବଶ୍ୟକତା। ବାକି ସିମୁଲେଟେଡ୍ ଡେମୋ ତଥ୍ୟ।",
    fmBuyerModalTitle: "ପ୍ରକୃତ କ୍ରେତା ଚାହିଦା ପୋଷ୍ଟ କରନ୍ତୁ",
    fmBuyerModalDesc: "ଆପଣଙ୍କ ଇମେଲକୁ ପଠାଯାଇଥିବା ଏକ ଥର କୋଡ୍ ମାଧ୍ୟମରେ ଯାଞ୍ଚିତ (କିମ୍ବା ଏହି ଡେମୋ ପାଇଁ ଇମେଲ୍ କନଫିଗର ହୋଇନଥିଲେ ସିଧାସଳଖ ଏଠାରେ ଦେଖାଯାଏ)। ORCA ଉପରେ କୌଣସି ପେମେଣ୍ଟ ହୁଏ ନାହିଁ — ଏହା କେବଳ ଆପଣଙ୍କୁ ମତ୍ସ୍ୟଜୀବୀଙ୍କ ସହ ଯୋଡ଼ିଥାଏ।",
    fmBuyerBusinessNameLabel: "ବ୍ୟବସାୟ ନାମ",
    fmBuyerEmailLabel: "ଯୋଗାଯୋଗ ଇମେଲ",
    fmBuyerLocationLabel: "ସ୍ଥାନ",
    fmBuyerSendCodeBtn: "ଯାଞ୍ଚ କୋଡ୍ ପଠାନ୍ତୁ",
    fmBuyerDevOtpTemplate: "ଏହି ଡେମୋ ପାଇଁ ଇମେଲ୍ କନଫିଗର ହୋଇନାହିଁ — ଆପଣଙ୍କର କୋଡ୍ {code}",
    fmBuyerOtpLabel: "ଯାଞ୍ଚ କୋଡ୍",
    fmBuyerVerifyBtn: "କୋଡ୍ ଯାଞ୍ଚ କରନ୍ତୁ",
    fmBuyerQtyLabel: "ଆବଶ୍ୟକ ପରିମାଣ (କିଗ୍ରା)",
    fmBuyerDeadlineLabel: "ଶେଷ ତାରିଖ",
    fmBuyerPriceMinLabel: "ସର୍ବନିମ୍ନ ମୂଲ୍ୟ (₹/କିଗ୍ରା)",
    fmBuyerPriceMaxLabel: "ସର୍ବାଧିକ ମୂଲ୍ୟ (₹/କିଗ୍ରା)",
    fmBuyerListingLocationLabel: "ପିକଅପ ସ୍ଥାନ",
    fmBuyerPostListingBtn: "ତାଲିକା ପୋଷ୍ଟ କରନ୍ତୁ",
    fmBuyerSuccessTitle: "ତାଲିକା ପୋଷ୍ଟ ହେଲା",
    fmBuyerSuccessDesc: "ଆପଣଙ୍କର ପ୍ରକୃତ କ୍ରେତା ଆବଶ୍ୟକତା ବର୍ତ୍ତମାନ ମତ୍ସ୍ୟଜୀବୀମାନେ ଦେଖିବା ଏବଂ ଦାବି କରିବା ପାଇଁ ବାୟର ଲିଡ୍‌ରେ ଲାଇଭ୍ ଅଛି।",
    fmBuyerDoneBtn: "ସମାପ୍ତ",
    fmBuyerErrRequired: "ବ୍ୟବସାୟ ନାମ ଏବଂ ଇମେଲ ଆବଶ୍ୟକ।",
    fmBuyerErrOtp: "ଯାଞ୍ଚ କୋଡ୍ ପ୍ରବେଶ କରନ୍ତୁ।",
    fmBuyerErrGeneric: "କିଛି ଭୁଲ ହୋଇଗଲା — ଦୟାକରି ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ।",
    fmBuyerErrQty: "କିଗ୍ରାରେ ଆବଶ୍ୟକ ପରିମାଣ ପ୍ରବେଶ କରନ୍ତୁ।",
    fmBuyerLiveTag: "ଲାଇଭ୍",
    fmBuyerDemoTag: "ଡେମୋ",
    fmClaimBtn: "ଏହି ଲିଡ୍ ଦାବି କରନ୍ତୁ",
    fmClaimPromptText: "ଏହା କିଏ ପୂରଣ କରୁଛି ତାହା କ୍ରେତା ଜାଣିବା ପାଇଁ ଆପଣଙ୍କର ନାମ ଏବଂ ଫୋନ/ଯୋଗାଯୋଗ ପ୍ରବେଶ କରନ୍ତୁ:",
    fmClaimSuccess: "ଦାବି ହେଲା — କ୍ରେତାଙ୍କୁ ପ୍ଲାଟଫର୍ମ ବାହାରେ ଜଣାଯିବ।",
    fmClaimFailed: "ବର୍ତ୍ତମାନ ଏହି ତାଲିକା ଦାବି କରିହେଲା ନାହିଁ।"
  },
  bn: {
    appTitle: "অর্কা ইনসাইট (ORCA INSIGHT)",
    appSubtitle: "ISRO সহযোগী সামুদ্রিক বুদ্ধিমত্তা · SIH 2026 PS 26176",
    teamName: "টিম সেভিয়র্সএক্স (Team SavioursX)",
    navHome: "হোম",
    navChat: "এআই সিদ্ধান্ত স্টুডিও",
    navMap: "GIS কমান্ড ম্যাপ",
    navDAG: "এজেন্ট DAG ভিজ্যুয়ালাইজার",
    navSafety: "সুরক্ষা ব্যারোমিটার",
    navFleet: "ফ্লিট মনিটর",
    navFleetGIS: "ফ্লিট ও GIS কমান্ড",
    navNavic: "নাভিক (NavIC) জিপিএস",
    navBulletins: "পরামর্শ বুলেটিন",
    navSafetyAdv: "সুরক্ষা ও পরামর্শ",
    heroTitle: "ভারত মহাসাগরের জন্য সহযোগী সামুদ্রিক বুদ্ধিমত্তা",
    heroDesc: "ISRO Oceansat-3, INSAT-3DR উপগ্রহ সমুদ্রবিজ্ঞান, IMBL জিওফেন্সিং, রিয়েল-টাইম ফ্লিট ঘনত্ব এবং যাত্রার ETA বিশ্লেষণ করে ভারতের উপকূলীয় জেলে সম্প্রদায়কে ক্ষমতায়ন করা।",
    ctaStudio: "এআই সিদ্ধান্ত স্টুডিও চালু করুন",
    ctaMap: "GIS কমান্ড ম্যাপ খুলুন",
    ctaFleet: "ফ্লিট মনিটর পরীক্ষা করুন",
    ctaFleetGIS: "ফ্লিট ও GIS কমান্ড খুলুন",
    statsActiveVessels: "ট্র্যাক করা সক্রিয় জাহাজ",
    statsSatellites: "ISRO উপগ্রহ ফিড",
    statsPFZ: "উচ্চ-ফলনশীল মৎস্য অঞ্চল",
    statsIMBL: "IMBL জিওফেন্স করা সেক্টর",
    chipPFZ: "নিকটতম উচ্চ-ফলনশীল PFZ খুঁজুন",
    chipSafety: "সমুদ্র-যাত্রার অনুমতি পরীক্ষা করুন",
    chipBorder: "IMBL সীমান্ত দূরত্ব পরীক্ষা",
    chipDensity: "জাহাজের ঘনত্ব ও ভিড়",
    chipETA: "ETA এবং নিরাপদ প্রত্যাবর্তনের সময় গণনা করুন",
    chatPlaceholder: "ORCA কে জিজ্ঞাসা করুন (অথবা কথা বলতে মাইক্রোফোনে ক্লিক করুন)...",
    chatSend: "এজেন্টদের জিজ্ঞাসা করুন",
    routePlannerTitle: "যাত্রাপথ সিমুলেটর এবং সি-স্টেট ETA",
    originHarbour: "মূল মৎস্য বন্দর",
    destinationPFZ: "গন্তব্য PFZ অঞ্চল",
    simulateRouteBtn: "নিরাপদ পথ ও ETA সিমুলেট করুন",
    distanceNM: "পথের দূরত্ব (নটিক্যাল মাইল)",
    liveETA: "লাইভ সি-স্টেট ETA",
    returnDusk: "সন্ধ্যার আগে ফেরার সুরক্ষা রায়",
    sosButton: "SOS জরুরি অবস্থা",
    clearanceSafe: "সমুদ্র-যাত্রার জন্য নিরাপদ",
    clearanceCaution: "সতর্কতার সাথে এগিয়ে যান",
    clearanceUnsafe: "অনিরাপদ: যাত্রা করবেন না",
    bigVerdictQuestion: "আজ মাছ ধরতে যাওয়া কি নিরাপদ?",
    bigVerdictYes: "হ্যাঁ",
    bigVerdictNo: "না",
    bigVerdictCaution: "সতর্কতা",
    listenVerdict: "শুনুন",
    waveHeight: "উল্লেখযোগ্য ঢেউয়ের উচ্চতা",
    windSpeed: "সমুদ্রপৃষ্ঠের বাতাসের গতি",
    seaState: "ডগলাস সি স্টেট",
    lightningRisk: "বজ্রপাত ও ঝড়ের ঝুঁকি",
    vesselTableTitle: "লাইভ উপকূলীয় ফ্লিট টেলিমেট্রি (লাইভ AIS + সিমুলেটেড ফিল-ইন)",
    simulatedDisclaimer: "দ্রষ্টব্য: যেখানে এখনও রিসিভার কভারেজ নেই, সেখানে লাইভ AIS জাহাজের অবস্থান স্পষ্টভাবে ট্যাগ করা সিমুলেটেড ফ্লিট দিয়ে পূরণ করা হয়। Smart India Hackathon 2026 প্রদর্শনের জন্য উপগ্রহ সমুদ্রবিজ্ঞান স্তরগুলি সিমুলেটেডই থাকে।",
    fmTitle: "অর্কা ফিশারম্যান (ORCA FISHERMAN)",
    fmSubtitle: "দৈনিক সুযোগ কনসোল · টিম সেভিয়র্সএক্স",
    fmLiveFeedBadge: "লাইভ সুযোগ ফিড",
    fmToggleDarkMode: "ডার্ক মোড টগল করুন",
    fmBackToHub: "← হাব",
    fmBackToHubTitle: "ORCA হাবে ফিরে যান",
    fmNavOpportunity: "আজকের সুযোগ",
    fmNavMap: "মৎস্য অঞ্চলের মানচিত্র",
    fmNavSell: "বুদ্ধিমত্তার সাথে বিক্রি করুন",
    fmNavCalculator: "ট্রিপ ক্যালকুলেটর",
    fmNavCommunity: "কর্মক্ষমতা ও সম্প্রদায়",
    fmCheckingBackend: "ব্যাকএন্ড পরীক্ষা করা হচ্ছে...",
    fmBestOpportunityLabel: "আজকের সেরা সুযোগ",
    fmLoadingOpportunityDesc: "ফিশারম্যান অপরচুনিটি এজেন্ট থেকে আজকের সুযোগ লোড হচ্ছে…",
    fmPreferredSpeciesLabel: "পছন্দের প্রজাতি:",
    fmAutoBestMatch: "অটো (সেরা মিল)",
    fmOpportunityScoreLabel: "সুযোগ স্কোর",
    fmRecommendedZoneLabel: "সুপারিশকৃত অঞ্চল",
    fmExpectedCatchLabel: "প্রত্যাশিত ধরা",
    fmAtTodaysPrice: "আজকের দামে",
    fmRevenueRangeLabel: "আয়ের পরিসর",
    fmBeforeTripCosts: "ট্রিপ খরচের আগে",
    fmEstimatedProfitLabel: "আনুমানিক লাভ",
    fmConfidenceLabel: "আস্থার মাত্রা",
    fmScoreBreakdownTitle: "সুযোগ স্কোর বিভাজন",
    fmAiStudioTitle: "এআই সিদ্ধান্ত স্টুডিও — আপনার ট্রিপ পরিকল্পনা করুন",
    fmAiStudioDesc: "ORCA-র নিজস্ব ডেটার উপর প্রশিক্ষিত 4টি অন-ডিভাইস scikit-learn মডেল (ধরা, অঞ্চল, প্রজাতি, দাম), একটি নির্দিষ্ট লাভ ও ঝুঁকি ইঞ্জিনের সাথে একত্রে কাজ করে। এই সম্পূর্ণ প্রক্রিয়ায় কোথাও বাহ্যিক এআই API ব্যবহৃত হয় না।",
    fmDemoModelBadge: "ডেমো মডেল · সিন্থেটিক প্রশিক্ষণ ডেটা",
    fmTripPlannerTitle: "ট্রিপ প্ল্যানার",
    fmBoatTypeLabel: "নৌকার ধরন",
    fmBoatTraditional: "ঐতিহ্যবাহী (অ-যান্ত্রিক)",
    fmBoatMotorized: "মোটরচালিত",
    fmBoatMechanized: "যান্ত্রিক ট্রলার",
    fmGearTypeLabel: "গিয়ারের ধরন",
    fmGearGillnet: "গিলনেট",
    fmGearTrawl: "ট্রল",
    fmGearRingSeine: "রিং সেইন",
    fmGearLongline: "লংলাইন",
    fmGearHookLine: "হুক ও লাইন",
    fmTripDurationLabel: "ট্রিপের সময়কাল (ঘণ্টা)",
    fmTargetSpeciesLabel: "লক্ষ্য প্রজাতি",
    fmSpeciesTuna: "টুনা",
    fmSpeciesPomfret: "পমফ্রেট",
    fmSpeciesSardine: "সার্ডিন (চন্দনা)",
    fmSpeciesMackerel: "ম্যাকেরেল (বাংড়া)",
    fmSpeciesKingfish: "কিংফিশ (সুরমাই)",
    fmUsesCurrentLocation: "আপনার বর্তমান বন্দরের অবস্থান এবং আজকের লাইভ সামুদ্রিক আবহাওয়া ব্যবহার করে।",
    fmPlanMyTrip: "আমার ট্রিপ পরিকল্পনা করুন",
    fmRunningModelsBtn: "ORCA মডেল চলছে…",
    fmRunningModelsDesc: "ORCA-র অন-ডিভাইস ML মডেল (ধরা, অঞ্চল, প্রজাতি, দাম) এবং লাভ-ঝুঁকি ইঞ্জিন চালানো হচ্ছে…",
    fmRecommendedPlanLabel: "ORCA-র সুপারিশকৃত পরিকল্পনা",
    fmTripScoreLabel: "ORCA ট্রিপ স্কোর",
    fmBestZoneLabel: "সেরা অঞ্চল",
    fmBestTimeWindowLabel: "সেরা সময়ের উইন্ডো",
    fmHighestPredictedCatch: "সর্বোচ্চ পূর্বাভাসিত ধরা",
    fmReliabilityLabel: "নির্ভরযোগ্যতা",
    fmRiskLabel: "ঝুঁকি",
    fmZoneRankingTitle: "অঞ্চল র‍্যাঙ্কিং · মৎস্য সম্ভাবনা",
    fmSpeciesSuitabilityTitle: "প্রজাতি উপযুক্ততা র‍্যাঙ্কিং",
    fmWhereToSellTitle: "কোথায় বিক্রি করবেন",
    fmThMarket: "বাজার",
    fmThDistance: "দূরত্ব",
    fmThPricePerKg: "দাম/কেজি",
    fmThNetRevenue: "নিট আয়",
    fmFeatureImportanceTitle: "এই পূর্বাভাস কীসের উপর ভিত্তি করে",
    fmFeatureImportanceDesc: "এই ট্রিপের জন্য ধরা মডেল প্রকৃতপক্ষে যে প্রধান বিষয়গুলিকে গুরুত্ব দিয়েছে — প্রশিক্ষিত মডেল থেকে পড়া প্রকৃত ফিচার ইম্পর্টেন্স, বানানো নয়।",
    fmWhyOrcaTitle: "ORCA কেন এটি বেছে নিল",
    fmModelTransparencyTitle: "মডেল স্বচ্ছতা",
    fmModelTransparencyDisclaimer: "ডেমো মডেল — উপরের প্রতিটি মডেল ORCA-র সিন্থেটিক প্রদর্শন ডেটাসেটের উপর প্রশিক্ষিত, প্রকৃত ঐতিহাসিক ধরার রেকর্ডের উপর নয়। নির্ভরযোগ্যতার পরিসংখ্যান সেই ডেটাসেটে পরিমাপ করা হয়েছে, বাস্তব-জগতের নির্ভুলতায় নয়।",
    fmZonesMapTitle: "সেরা মাছের ফলন অঞ্চল · লাইভ মানচিত্র",
    fmZonesMapDesc: "আজকের সুযোগে ব্যবহৃত একই লাইভ-স্কোর করা ওশান অ্যানালিটিক্স ও PFZ এজেন্ট ডেটা, GIS কমান্ড ম্যাপের বেসম্যাপে দেখানো হয়েছে।",
    fmRankedByYieldTitle: "ফলন অনুসারে র‍্যাঙ্ক করা",
    fmLoadingZones: "অঞ্চলগুলি লোড হচ্ছে…",
    fmTopZoneLabel: "শীর্ষ অঞ্চল:",
    fmYieldScoreLabel: "ফলন স্কোর:",
    fmLoadingPricing: "দামের তুলনা লোড হচ্ছে…",
    fmTypicalPriceLabel: "সাধারণ অনানুষ্ঠানিক দাম",
    fmOpportunityPriceLabel: "ORCA সুযোগ মূল্য",
    fmExtraRevenueLabel: "সম্ভাব্য অতিরিক্ত আয়",
    fmSpeciesPriceRankingTitle: "প্রজাতি মূল্য র‍্যাঙ্কিং",
    fmThSpecies: "প্রজাতি",
    fmThTrend: "প্রবণতা",
    fmThDemand: "চাহিদা",
    fmThEstProfit: "আনুমানিক লাভ",
    fmThOpportunityScore: "সুযোগ স্কোর",
    fmBuyerLeadsTitle: "ক্রেতা লিড",
    fmTripCostCalcTitle: "ট্রিপ-খরচ ক্যালকুলেটর",
    fmSpeciesLabel: "প্রজাতি",
    fmExpectedCatchKgLabel: "প্রত্যাশিত ধরা (কেজি)",
    fmPricePerKgLabel: "প্রতি কেজি দাম (₹)",
    fmFuelLabel: "জ্বালানি (₹)",
    fmIceLabel: "বরফ (₹)",
    fmOtherLabel: "অন্যান্য (₹)",
    fmRecalculateBtn: "পুনরায় গণনা করুন",
    fmTripSummaryTitle: "ট্রিপ সারাংশ",
    fmGrossRevenueLabel: "মোট আয়:",
    fmTotalTripCostLabel: "মোট ট্রিপ খরচ:",
    fmNetProfitLabel: "নিট লাভ:",
    fmProfitMarginLabel: "লাভের মার্জিন:",
    fmCalcDefaultsNote: "আজকের সুপারিশকৃত প্রজাতি এবং এই অ্যাপের সিমুলেটেড বাজার ডেটা থেকে ডিফল্টগুলি আগে থেকেই পূরণ করা আছে — যেকোনো ফিল্ড পরিবর্তন করুন এবং পুনরায় গণনা করুন চাপুন।",
    fmTripPerformanceTitle: "আপনার ট্রিপের কর্মক্ষমতা",
    fmLoadingPerformance: "কর্মক্ষমতার ইতিহাস লোড হচ্ছে…",
    fmThTrip: "ট্রিপ",
    fmThCatchKg: "ধরা (কেজি)",
    fmThRevenue: "আয়",
    fmThProfit: "লাভ",
    fmCommunityFeedTitle: "সম্প্রদায় ও পরামর্শ ফিড",
    fmBuiltBy: "নির্মাতা",
    fmHackathonLine: "Smart India Hackathon 2026 · সমস্যা বিবৃতি 26176 (ISRO)",
    fmFooterDisclaimer: "দাবিত্যাগ: প্রজাতির বাজারদর, ক্রেতা লিড এবং ট্রিপের ইতিহাস Smart India Hackathon 2026 বিচার প্রদর্শনের জন্য সিমুলেটেড।",
    fmNoTripHistory: "এখনও কোনো ট্রিপের ইতিহাস রেকর্ড করা হয়নি।",
    fmYourCatch: "আপনার ধরা",
    fmTripAgoSingular: "{n} ট্রিপ আগে",
    fmTripAgoPlural: "{n} ট্রিপ আগে",
    fmTargetSpeciesColon: "লক্ষ্য প্রজাতি:",
    fmYieldWord: "ফলন",
    fmSstLabel: "SST:",
    fmDepthLabel: "গভীরতা:",
    fmSafetyLabel: "সুরক্ষা:",
    fmOpportunityDescTemplate: "আজ ₹{price}/কেজিতে {zone}-এর কাছে সেরা মিল — সম্মিলিত সুযোগ স্কোর {score}/100।",
    fmTheRecommendedZone: "সুপারিশকৃত অঞ্চল",
    fmSellSmarterDescTemplate: "{species}: অনানুষ্ঠানিক বাজারের পরিবর্তে ORCA-মিলিত ক্রেতার কাছে বিক্রি করলে, ধরে নেওয়া {catch} কেজি ধরার উপর আনুমানিক অতিরিক্ত {revenue} পাওয়া যায়।",
    fmAiErrorTemplate: "ORCA-র এআই সিদ্ধান্ত স্টুডিও ব্যাকএন্ডে ({error}) পৌঁছানো যায়নি। ML মডেলগুলি প্রশিক্ষণের জন্য একবার ব্যাকএন্ড সেটআপ প্রয়োজন -- backend/ml/training/ দেখুন। কিছুক্ষণ পরে আবার চেষ্টা করুন।",
    fmPlanDescTemplate: "সেরা উইন্ডো {window} · {market}-এ বিক্রি করুন · ORCA ট্রিপ স্কোর {score}/100।",
    fmTheRecommendedMarket: "সুপারিশকৃত বাজার",
    fmKmFromPortTemplate: "বন্দর থেকে {km} কিমি",
    fmStatusLive: "লাইভ",
    fmStatusOffline: "ব্যাকএন্ড অফলাইন — শেষ জানা ডেটা দেখানো হচ্ছে",
    fmScoreOcean: "সামুদ্রিক সুরক্ষা",
    fmScoreFish: "মাছের ফলন",
    fmScoreMarket: "বাজারের গতি",
    fmScoreProfit: "লাভের মার্জিন",
    fmTierHigh: "উচ্চ",
    fmTierGood: "ভালো",
    fmTierModerate: "মাঝারি",
    fmPostWeatherAlert: "আবহাওয়া সতর্কতা",
    fmPostMarketUpdate: "বাজার আপডেট",
    fmPostFishermanReport: "জেলে প্রতিবেদন",
    fmPostUpdate: "আপডেট",
    fmNearbyBusinessesTitle: "নিকটবর্তী সীফুড ক্রেতা ও বাজার · লাইভ",
    fmNearbyBusinessesDesc: "আপনার বর্তমান অবস্থানের কাছে OpenStreetMap-এর মাধ্যমে প্রকৃত, লাইভ — কাছাকাছি সীফুড কেনা/পরিবেশনকারী রেস্তোরাঁ ও দোকান। এটি ক্রেতার প্রয়োজন/লিড নয়; তার জন্য নিচে ক্রেতা লিড দেখুন।",
    fmRefreshBtn: "রিফ্রেশ করুন",
    fmLoadingNearby: "নিকটবর্তী সীফুড ক্রেতাদের পরীক্ষা করা হচ্ছে…",
    fmNearbyBadgeLive: "লাইভ",
    fmNearbyBadgeUnavailable: "অনুপলব্ধ",
    fmNearbyNoneFound: "এই মুহূর্তে পরিসরের মধ্যে কোনো সীফুড ক্রেতা বা বাজার পাওয়া যায়নি।",
    fmNearbyFailed: "এই মুহূর্তে লাইভ কাছাকাছি-ব্যবসার ডেটায় পৌঁছানো যায়নি।",
    fmPostBuyerDemandBtn: "+ ক্রেতার চাহিদা পোস্ট করুন",
    fmBuyerLeadsRealNote: "LIVE ট্যাগ করা লিডগুলি ORCA-র বায়ার নেটওয়ার্কের মাধ্যমে পোস্ট করা প্রকৃত, যাচাইকৃত ক্রেতার চাহিদা। বাকিগুলি সিমুলেটেড ডেমো ডেটা।",
    fmBuyerModalTitle: "প্রকৃত ক্রেতার চাহিদা পোস্ট করুন",
    fmBuyerModalDesc: "আপনার ইমেইলে পাঠানো একবারের কোডের মাধ্যমে যাচাইকৃত (অথবা এই ডেমোর জন্য ইমেইল কনফিগার না থাকলে সরাসরি এখানে দেখানো হয়)। ORCA-তে কোনো পেমেন্ট হয় না — এটি শুধু আপনাকে জেলেদের সাথে সংযুক্ত করে।",
    fmBuyerBusinessNameLabel: "ব্যবসার নাম",
    fmBuyerEmailLabel: "যোগাযোগের ইমেইল",
    fmBuyerLocationLabel: "অবস্থান",
    fmBuyerSendCodeBtn: "যাচাইকরণ কোড পাঠান",
    fmBuyerDevOtpTemplate: "এই ডেমোর জন্য ইমেইল কনফিগার করা নেই — আপনার কোড {code}",
    fmBuyerOtpLabel: "যাচাইকরণ কোড",
    fmBuyerVerifyBtn: "কোড যাচাই করুন",
    fmBuyerQtyLabel: "প্রয়োজনীয় পরিমাণ (কেজি)",
    fmBuyerDeadlineLabel: "শেষ তারিখ",
    fmBuyerPriceMinLabel: "সর্বনিম্ন দাম (₹/কেজি)",
    fmBuyerPriceMaxLabel: "সর্বোচ্চ দাম (₹/কেজি)",
    fmBuyerListingLocationLabel: "পিকআপ স্থান",
    fmBuyerPostListingBtn: "লিস্টিং পোস্ট করুন",
    fmBuyerSuccessTitle: "লিস্টিং পোস্ট হয়েছে",
    fmBuyerSuccessDesc: "আপনার প্রকৃত ক্রেতার চাহিদা এখন জেলেদের দেখার ও দাবি করার জন্য বায়ার লিডে লাইভ আছে।",
    fmBuyerDoneBtn: "সম্পন্ন",
    fmBuyerErrRequired: "ব্যবসার নাম এবং ইমেইল প্রয়োজন।",
    fmBuyerErrOtp: "যাচাইকরণ কোড লিখুন।",
    fmBuyerErrGeneric: "কিছু ভুল হয়েছে — অনুগ্রহ করে আবার চেষ্টা করুন।",
    fmBuyerErrQty: "কেজিতে প্রয়োজনীয় পরিমাণ লিখুন।",
    fmBuyerLiveTag: "লাইভ",
    fmBuyerDemoTag: "ডেমো",
    fmClaimBtn: "এই লিড দাবি করুন",
    fmClaimPromptText: "এটি কে পূরণ করছে তা ক্রেতাকে জানাতে আপনার নাম এবং ফোন/যোগাযোগ লিখুন:",
    fmClaimSuccess: "দাবি করা হয়েছে — ক্রেতাকে প্ল্যাটফর্মের বাইরে জানানো হবে।",
    fmClaimFailed: "এই মুহূর্তে এই তালিকা দাবি করা যায়নি।"
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
    name: "Neural Synthesis Agent (Stats-Driven)",
    role: "Aggregates multi-agent telemetry into an authoritative, grounded natural-language advisory with citation tags and TTS -- entirely rule-based, reasoning over this site's own live telemetry and its own accumulated stats ledger. No external AI/LLM API is used.",
    sensors: ["ORCA Stats Reasoning Engine (Rule-Based)", "Web Speech Synthesizer"],
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
  runStartupStep('setupMobileNavDropdowns', setupMobileNavDropdowns);
  runStartupStep('setupLiquidGlassButtons', setupLiquidGlassButtons);
  runStartupStep('setupHeaderScrollHide', setupHeaderScrollHide);
  runStartupStep('setupScrollReveal', setupScrollReveal);
  runStartupStep('setupLanguageSwitcher', setupLanguageSwitcher);
  // setupMap() is intentionally NOT called here. The default active tab on
  // load is 'home', so #mapContainer sits inside a `.hidden` (display:none)
  // tab-content section at this point -- initializing Mappls' vector/WebGL
  // engine against a zero-size, invisible container leaves it permanently
  // broken (a blank white canvas, with markers/polylines that never
  // visually render even though the JS calls to add them succeed without
  // error) -- a plain resize()/invalidateSize() call later doesn't recover
  // it. This is exactly the bug switchTab()'s 'fleetgis' branch below now
  // avoids by lazy-initializing setupMap() the first time that tab is
  // actually visible, mirroring the same fix already used for the
  // Fisherman module's own Command Map (see setupFishermanMap()/
  // switchFishermanTab() -- that map was never affected because it was
  // already lazy-initialized this way).
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
    el.innerHTML = `${orcaIcon('vessel')} Showing ${liveText} + ${simulatedCount} simulated vessel${simulatedCount === 1 ? '' : 's'} filling ports with no live AIS coverage right now.`;
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
  el.innerHTML = orcaIcon('alert') + ' ' + detail;
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
  banner.className = `fixed right-4 top-20 z-[70] max-w-sm p-4 rounded-xl glass-card shadow-2xl ${danger ? 'glass-card-danger text-red-100' : 'glass-card-warn text-amber-100'}`;
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

// Mobile-only "current section" dropdown nav (phone-width screens only --
// see the sm:hidden/hidden sm:flex pair around each <nav> in index.html).
// Reuses the existing [data-nav-target]/[data-fm-nav] click-and-highlight
// wiring in setupNavigation()/switchTab() and setupFishermanNavigation()/
// switchFishermanTab() untouched -- this only opens/closes the panel and
// keeps the trigger button's label in sync, so a phone user picks a
// section from one tap-opened list instead of scrolling a pill row.
function setupMobileNavDropdowns() {
  setupMobileNavDropdown('mobileNavToggle', 'mobileNavPanel', 'mobileNavChevron');
  setupMobileNavDropdown('fmMobileNavToggle', 'fmMobileNavPanel', 'fmMobileNavChevron');
}

function setupMobileNavDropdown(toggleId, panelId, chevronId) {
  const toggle = document.getElementById(toggleId);
  const panel = document.getElementById(panelId);
  if (!toggle || !panel || toggle.dataset.mobileNavWired) return;
  toggle.dataset.mobileNavWired = '1';
  const chevron = document.getElementById(chevronId);

  // Chevron rotation uses an inline style rather than a rotate-180 utility
  // class: that class would only ever be added via classList from here,
  // never appear as a literal class="..." in index.html's static markup,
  // and this project's Tailwind build (tools/build-tailwind.py) only
  // compiles utility classes it finds by scanning that static markup --
  // see the sibling comment on setupMobileNavDropdown() gaps. An inline
  // style sidesteps that build step entirely for this one small toggle.
  const closePanel = () => {
    panel.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
    if (chevron) chevron.style.transform = '';
  };
  const openPanel = () => {
    panel.classList.remove('hidden');
    toggle.setAttribute('aria-expanded', 'true');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
  };
  // Exposed so switchTab()/switchFishermanTab() can force-close this panel
  // after ANY tab change (not just one made by tapping inside the panel --
  // e.g. a "View on Map" button elsewhere calling switchTab() directly).
  toggle.__closeMobileNavPanel = closePanel;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.classList.contains('hidden')) openPanel(); else closePanel();
  });
  panel.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => closePanel());
  });
  document.addEventListener('click', (e) => {
    if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !toggle.contains(e.target)) {
      closePanel();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.classList.contains('hidden')) closePanel();
  });
}

function closeMobileNavPanel(toggleId) {
  const toggle = document.getElementById(toggleId);
  if (toggle && typeof toggle.__closeMobileNavPanel === 'function') toggle.__closeMobileNavPanel();
}

// Copies the currently-translated label off whichever [data-nav-target]/
// [data-fm-nav] button matches tabId (already kept correct by
// applyLanguage()'s own [data-i18n] sweep) onto the mobile dropdown
// trigger's own label span, which deliberately carries no data-i18n of
// its own -- it always names the ACTIVE section, not a fixed key.
function updateMobileNavLabel(labelId, navAttr, tabId) {
  const labelEl = document.getElementById(labelId);
  if (!labelEl || !tabId) return;
  const sourceSpan = document.querySelector(`[${navAttr}="${tabId}"] span[data-i18n]`);
  if (sourceSpan) labelEl.textContent = sourceSpan.textContent;
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

  updateMobileNavLabel('mobileNavCurrentLabel', 'data-nav-target', tabId);
  closeMobileNavPanel('mobileNavToggle');

  if (tabId === 'fleetgis') {
    if (!state.map) {
      // First time this tab has ever been shown -- initialize the Mappls
      // GIS Command Map now, while #mapContainer is actually visible and
      // has real layout dimensions. Initializing it eagerly at page load
      // (while this tab is still hidden) is what previously produced a
      // permanently broken white/blank map with vessels and routes that
      // never rendered -- see the comment where setupMap() used to be
      // called in the DOMContentLoaded handler. Mirrors setupFishermanMap()
      // /switchFishermanTab()'s own lazy-init pattern for the Fisherman
      // module's Command Map.
      runStartupStep('setupMap', setupMap);
    } else {
      setTimeout(() => {
        // Mappls' vector engine has no documented invalidateSize() -- try
        // its MapLibre-style resize() defensively so a tab-switch reflow
        // still repaints the canvas correctly; never let this break tab
        // switching.
        try { state.map.resize(); } catch (err) { /* not available -- ignore */ }
      }, 200);
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Liquid Glass Button
// Vanilla CSS/JS recreation of the Originkit "Liquid Glass Button" recipe:
// a blurred glass face with a gradient edge stroke and an internal light
// that tracks the pointer. Replaces the old wave/water hover-fill effect
// while keeping the same .sfb-btn markup contract (data-nav-target,
// sfb-active, etc.) so nothing else in the app has to change.
function setupLiquidGlassButtons() {
  const buttons = document.querySelectorAll('.sfb-btn:not(.sfb-enhanced)');
  if (!buttons.length) return;

  buttons.forEach(btn => {
    const content = document.createElement('span');
    content.className = 'sfb-content';
    while (btn.firstChild) content.appendChild(btn.firstChild);

    const light = document.createElement('span');
    light.className = 'sfb-light';
    light.setAttribute('aria-hidden', 'true');

    const ring = document.createElement('span');
    ring.className = 'sfb-ring';
    ring.setAttribute('aria-hidden', 'true');

    btn.appendChild(light);
    btn.appendChild(ring);
    btn.appendChild(content);
    btn.classList.add('sfb-enhanced');

    const trackPointer = e => {
      const r = btn.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      btn.style.setProperty('--mx', `${x.toFixed(1)}%`);
      btn.style.setProperty('--my', `${y.toFixed(1)}%`);
    };

    btn.addEventListener('pointerenter', trackPointer);
    btn.addEventListener('pointermove', trackPointer);
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
  const fmLangSelect = document.getElementById('fmLangSelect');

  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      state.currentLang = e.target.value;
      state.languageOverride = true;
      applyLanguage(state.currentLang);
    });
  }

  // ORCA Fisherman console has its own header, so it gets its own <select>
  // -- wired to the exact same state.currentLang/applyLanguage() pipeline as
  // the Insight dashboard's langSelect above, so choosing a language in
  // either module keeps BOTH in sync (see applyLanguage()'s selector sync).
  if (fmLangSelect) {
    fmLangSelect.addEventListener('change', (e) => {
      state.currentLang = e.target.value;
      state.languageOverride = true;
      applyLanguage(state.currentLang);
    });
  }
}

// Also called directly by initFishermanConsole() the first time the
// Fisherman shell is opened, in case orcaEnterFisherman() runs before
// setupLanguageSwitcher()'s DOMContentLoaded step has wired #fmLangSelect
// (its container may not exist in the DOM lookup order some browsers use
// for a freshly-unhidden shell). Calling this twice is harmless --
// addEventListener no-ops on a duplicate identical listener only if the
// same function reference is passed, so guard with a flag instead.
function setupFishermanLanguageSwitcher() {
  const fmLangSelect = document.getElementById('fmLangSelect');
  if (!fmLangSelect || fmLangSelect.dataset.wired) return;
  fmLangSelect.dataset.wired = '1';
  fmLangSelect.addEventListener('change', (e) => {
    state.currentLang = e.target.value;
    state.languageOverride = true;
    applyLanguage(state.currentLang);
  });
}

// Small translation helper for JS-rendered (non-data-i18n) strings -- every
// dynamic render function in the Fisherman module (and any future Insight
// dynamic content) should route its hardcoded copy through this instead of
// inlining English text, so applyLanguage() re-rendering picks it up too.
function t(key, fallback) {
  const dict = translations[state.currentLang] || translations.en;
  if (dict[key] != null) return dict[key];
  if (translations.en[key] != null) return translations.en[key];
  return fallback != null ? fallback : key;
}

// Same lookup as t(), but does {placeholder} substitution for template
// sentences (score/price/zone-name interpolated advisory text, etc.) so
// those sentences can be fully translated instead of only their static
// fragments.
function tFormat(key, vars, fallback) {
  let str = t(key, fallback);
  if (vars) {
    Object.keys(vars).forEach(k => {
      str = str.split(`{${k}}`).join(vars[k] != null ? vars[k] : '');
    });
  }
  return str;
}

function applyLanguage(lang) {
  const t = translations[lang] || translations.en;
  state.currentLang = lang;

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

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (t[key]) {
      el.title = t[key];
    }
  });

  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria');
    if (t[key]) {
      el.setAttribute('aria-label', t[key]);
    }
  });

  // Keep BOTH language selectors (Insight's #langSelect and Fisherman's
  // #fmLangSelect) showing the same choice, whichever one the user actually
  // changed, so switching language in one module is reflected in the other
  // the moment they open it.
  const langSelectEl = document.getElementById('langSelect');
  if (langSelectEl && langSelectEl.value !== lang) langSelectEl.value = lang;
  const fmLangSelectEl = document.getElementById('fmLangSelect');
  if (fmLangSelectEl && fmLangSelectEl.value !== lang) fmLangSelectEl.value = lang;

  // Mobile dropdown nav trigger labels carry no data-i18n of their own
  // (they always name the ACTIVE section, not a fixed key) -- resync them
  // from whichever [data-nav-target]/[data-fm-nav] button the sweep above
  // just retranslated.
  updateMobileNavLabel('mobileNavCurrentLabel', 'data-nav-target', state.activeTab || 'home');
  updateMobileNavLabel('fmMobileNavCurrentLabel', 'data-fm-nav', (typeof fishermanState !== 'undefined' && fishermanState.activeTab) || 'opportunity');

  // The Fisherman console's dynamic (JS-template-rendered) content isn't
  // covered by the [data-i18n] sweep above -- re-run its render functions
  // against whatever data is already cached so a language switch while the
  // console is open never leaves half-English, half-translated content on
  // screen. All of this is a no-op (and cheap) if the Fisherman console has
  // never been opened yet, since fishermanState.dashboard stays null.
  if (typeof fishermanState !== 'undefined') {
    try {
      if (fishermanState.dashboard) {
        renderFishermanOpportunity(fishermanState.dashboard);
        renderFishermanSellSmarter(fishermanState.dashboard);
        renderFishermanPerformance(fishermanState.dashboard);
      }
      if (fishermanState.zoneRanking && fishermanState.zoneRanking.length) {
        renderFishermanZoneList();
        renderFishermanZoneMarkers();
      }
      if (fishermanState.lastAiTripData) {
        renderAiTripResults(fishermanState.lastAiTripData);
      }
      renderRealBuyerListings();
      if (fishermanState.nearbyBusinesses) {
        renderNearbyBusinesses();
      }
    } catch (err) {
      console.log('ORCA FISHERMAN: dynamic re-render on language switch skipped', err);
    }
  }
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
      ml: 'ml-IN',
      gu: 'gu-IN',
      mr: 'mr-IN',
      kn: 'kn-IN',
      te: 'te-IN',
      or: 'or-IN',
      bn: 'bn-IN'
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
    const bufferPopupHtml = `${orcaIcon('alert')} ${bound.warning_distance_nm} NM IMBL Buffer Corridor`;
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
        <span class="text-xs font-bold text-pink-400">${orcaIcon('shield')} ${mpa.name}</span>
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
               ${orcaIcon('anchor', 15)}
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
          ${orcaIcon('anchor', 12)} Set as Origin Harbour
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
          <span class="absolute -top-4 whitespace-nowrap text-[9px] font-mono bg-[#14A3C7] px-1 rounded text-[#00008B] border border-[#00008B]/30 pointer-events-none">
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
      strokeColor: '#123456',
      strokeOpacity: 1,
      strokeWeight: 1,
      fillColor: '#123456',
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
      duskEl.innerHTML = `<span class="text-slate-400 font-bold"> ROUTE UNAVAILABLE:</span> ORCA backend is unreachable, so no routed distance/ETA can be shown. Running in local fallback mode.`;
      duskEl.className = "p-2.5 rounded-lg text-xs glass-card glass-card-neutral text-slate-300";
      duskEl.style.color = "";
    }
    return;
  }

  if (!route.route_found) {
    if (distEl) distEl.textContent = '—';
    if (etaEl) etaEl.textContent = '—';
    if (speedEl) speedEl.textContent = '—';
    if (duskEl) {
      duskEl.innerHTML = `<span class="text-red-400 font-bold">✕ NO SAFE MARITIME ROUTE FOUND:</span> ${route.detail || route.reason || 'The router could not find a path avoiding land and Marine Protected Areas for this harbour/PFZ pair.'}`;
      duskEl.className = "p-2.5 rounded-lg text-xs glass-card glass-card-danger text-red-200";
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
      duskEl.className = "p-2.5 rounded-lg text-xs glass-card glass-card-safe text-emerald-200";
      duskEl.style.color = "";
    } else {
      duskEl.innerHTML = `<span class="font-bold" style="color:#ff0000;"> RETURN AFTER DUSK:</span> Expected return at <span class="font-mono" style="color:#ff0000;">${route.estimated_return_ist || '—'}</span> (Exceeds 18:30 IST sunset). Recommend an earlier departure or a night navigational beacon check.`;
      duskEl.className = "p-2.5 rounded-lg text-xs";
      duskEl.style.color = "#ff0000";
    }
  }

  if (state.map) {
    try {
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
        strokeColor: '#123456',
        strokeWeight: 3.5,
        strokeOpacity: 0.9,
        popupHtml: routePopupHtml,
        popupOptions: true
      });
      if (!Array.isArray(state.mapLayers.route)) state.mapLayers.route = [];
      state.mapLayers.route.push(routeLine);
    } catch (err) {
      // The Mappls SDK can still be settling its internal canvas/layer
      // state a moment after its own 'load' event fires -- most visible
      // on the very first auto-render, ~400ms after page load. Never let
      // that surface as an unhandled promise rejection; the next route
      // recalculation (harbour/PFZ change, "Simulate Route" click) draws
      // the polyline normally once the SDK has settled.
      console.warn('Route polyline draw skipped (map still initializing):', err.message || err);
    }
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
          ${agent.sensors.map(s => `<span class="text-[10px] text-slate-400 font-mono">${s}</span>`).join(' ')}
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
      <div class="max-w-[80%] p-3.5 rounded-2xl glass-card glass-card-info text-slate-100 text-sm">
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
      <div class="max-w-[85%] p-4 rounded-2xl glass-card text-slate-300 text-sm space-y-2 w-full">
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
      <div class="w-8 h-8 rounded-full bg-cyan-500 text-slate-950 font-black flex items-center justify-center text-xs shadow-lg shadow-cyan-500/20">
        AI
      </div>
      <div class="max-w-[88%] p-5 rounded-2xl glass-card shadow-xl space-y-3">
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
              <span class="text-xs"></span> Listen (TTS)
            </button>
            <button onclick="copyAdvisoryMSS()" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-teal-300 border border-slate-600 text-xs flex items-center gap-1 transition">
              <span>${orcaIcon('radar')}</span> NavIC MSS Code
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
            <span>${orcaIcon('search')} View Multi-Agent Reasoning Trace (${advisory.agentSteps.length} steps executed)</span>
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
  renderReasoningTrace(advisory.agentSteps);
}

// Renders the same agentSteps already computed for the chat message's
// inline collapsible trace into the persistent "Live Reasoning Trace"
// panel beside the conversation, so the multi-agent execution is visible
// live without expanding each message.
function renderReasoningTrace(steps) {
  const list = document.getElementById('reasoningTraceList');
  const countEl = document.getElementById('reasoningTraceCount');
  if (!list || !steps || !steps.length) return;
  if (countEl) countEl.textContent = `${steps.length}-node DAG`;
  list.innerHTML = steps.map((step, idx) => `
    <div class="flex gap-3 pb-3 mb-3 border-b border-ocean-700/60 last:border-0 last:pb-0 last:mb-0">
      <div class="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 text-[10px] font-mono font-bold flex items-center justify-center flex-none mt-0.5">${idx + 1}</div>
      <div class="min-w-0">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-bold text-slate-100">${step.agent}</span>
          <span class="text-[10px] text-slate-500 font-mono flex-none">${step.latency}</span>
        </div>
        <p class="text-[11px] text-slate-400 mt-0.5 leading-relaxed">${step.trace}</p>
      </div>
    </div>
  `).join('');
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
  const names = { en: 'English', hi: 'हिन्दी', ta: 'தமிழ்', ml: 'മലയാളം', gu: 'ગુજરાતી', mr: 'मराठी', kn: 'ಕನ್ನಡ', te: 'తెలుగు', or: 'ଓଡ଼ିଆ', bn: 'বাংলা' };
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
  const OFFLINE_BANNER = `<p class="mb-2 text-[11px] font-mono text-amber-300 bg-amber-950/40 border border-amber-700/40 rounded px-2 py-1">${orcaIcon('alert')} OFFLINE ADVISORY ENGINE — ORCA backend unreachable. The figures below are a simulated illustrative estimate, not live telemetry.</p>`;

  if (q.includes('border') || q.includes('imbl') || q.includes('sri lanka') || q.includes('pakistan') || q.includes('सीमा') || q.includes('எல்லை')) {
    return {
      confidence: 60,
      metrics: { zone: "Palk Strait & Rameswaram", eta: "1h 45m (simulated)", vesselCount: 7, imblClearance: "SIMULATED ~2-4 NM" },
      plainText: "OFFLINE ADVISORY (backend unreachable, simulated estimate): Vessels in the Palk Strait / Gulf of Mannar area are typically within a few Nautical Miles of the India-Sri Lanka IMBL boundary. Maintain a westward heading and keep VHF transponders active on Channel 16. Reconnect to the ORCA backend for an actual measured distance to the boundary.",
      formattedHtml: OFFLINE_BANNER + `<p><strong class="text-red-400">${orcaIcon('alert')} IMBL Geofencing Advisory (Simulated Offline Estimate):</strong></p>
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
      formattedHtml: OFFLINE_BANNER + `<p><strong class="text-cyan-400">${orcaIcon('vessel')} Fleet Density (Offline — Simulated Placeholder):</strong></p>
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
    formattedHtml: OFFLINE_BANNER + `<p><strong class="text-amber-400">${orcaIcon('alert')} Offline Placeholder Advisory</strong></p>
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
      ttsBtn.innerHTML = `<span>${orcaIcon('speaker')} Listen Audio Advisory</span>`;
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
  ctx.fillStyle = '#123456';
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
    ctx.fillStyle = '#123456';
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
    <div class="flex items-center justify-between p-2 rounded glass-chip glass-card-terminal text-xs font-mono">
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
    <div class="p-4 rounded-xl glass-card glass-card-interactive transition shadow-lg">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div>
          <h4 class="font-bold text-slate-100 text-sm">${sat.name}</h4>
          <span class="text-[10px] font-mono text-slate-400">NORAD: ${sat.norad_id} · ${sat.orbit_type}</span>
        </div>
        <span class="text-[10px] font-bold text-emerald-300 flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
          ${sat.health_status}
        </span>
      </div>

      <div class="my-3 space-y-1.5 text-xs">
        ${sat.sensors.map(sen => `
          <div class="flex items-center justify-between py-0.5">
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
    // Keep the AI Decision Studio's "Live Ocean Telemetry" card (wave/
    // wind/sea state) in sync with the same reading -- this used to only
    // get set once at startup by fetchLiveMarineTelemetry(), so it went
    // stale after the first load even though this function itself polls
    // every 5 minutes.
    updateSafetyMetricsUI();

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
  const chatClearanceEl = document.getElementById('chatSeaClearanceVal');

  const verdict = weather.clearance_verdict || 'SAFE';
  const theme = {
    SAFE: { color: 'emerald', label: 'SAFE FOR SEA VENTURE', icon: '✓' },
    CAUTION: { color: 'amber', label: 'PROCEED WITH CAUTION', icon: '!' },
    UNSAFE: { color: 'rose', label: 'UNSAFE — DO NOT VENTURE', icon: '✕' }
  }[verdict] || { color: 'emerald', label: 'SAFE FOR SEA VENTURE', icon: '✓' };

  const colorClasses = {
    emerald: { border: 'border-emerald-500', dot: 'bg-emerald-400', text: 'text-emerald-400', ring: 'border-emerald-400', glow: 'shadow-emerald-500/30' },
    amber: { border: 'border-amber-500', dot: 'bg-amber-400', text: 'text-amber-400', ring: 'border-amber-400', glow: 'shadow-amber-500/30' },
    rose: { border: 'border-rose-500', dot: 'bg-rose-400', text: 'text-rose-400', ring: 'border-rose-400', glow: 'shadow-rose-500/30' }
  };
  const c = colorClasses[theme.color];

  if (scoreEl) {
    scoreEl.textContent = weather.safety_score ?? '—';
    scoreEl.className = `text-3xl sm:text-4xl font-black ${c.text} font-mono`;
  }
  if (verdictEl) {
    verdictEl.textContent = theme.label;
    verdictEl.className = `text-2xl sm:text-3xl font-extrabold ${c.text}`;
  }
  if (descEl) {
    descEl.textContent = `Live Open-Meteo marine telemetry places significant wave height at ${weather.significant_wave_height_m}m and surface wind at ${weather.surface_wind_knots}kn near your selected harbour, giving a computed safety score of ${weather.safety_score}/100.`;
  }
  const glassVariant = { emerald: 'glass-card-safe', amber: 'glass-card-warn', rose: 'glass-card-danger' }[theme.color] || 'glass-card-safe';
  if (cardEl) {
    cardEl.className = `p-6 rounded-2xl glass-card ${glassVariant} flex flex-col md:flex-row items-center justify-between gap-6`;
  }
  if (dotEl) dotEl.className = `w-3 h-3 rounded-full ${c.dot} animate-ping`;
  if (ringEl) {
    ringEl.className = `w-14 h-14 rounded-full border-4 ${c.ring} flex items-center justify-center text-2xl ${c.text} font-bold shadow-lg ${c.glow}`;
    ringEl.textContent = theme.icon;
  }
  if (chatClearanceEl) {
  chatClearanceEl.textContent = `${weather.clearance_verdict} (${weather.safety_score}/100)`;
  chatClearanceEl.className = `${c.text} font-bold`;
}

  updateBigVerdictCard(verdict, weather);

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

// Big Yes/No verdict banner: a huge icon + word + Listen button that reads
// correctly at a glance, no literacy required, sitting above the detailed
// Safety Barometer card (which stays exactly as-is for anyone who wants the
// numbers). Keeps its own tiny state so the Listen button can speak the
// same verdict without re-deriving it from the DOM.
window._orcaBigVerdict = { verdict: 'SAFE', label: 'Safe to go fishing today', score: null };

function updateBigVerdictCard(verdict, weather) {
  const cardEl = document.getElementById('bigVerdictCard');
  const iconWrapEl = document.getElementById('bigVerdictIcon');
  const wordEl = document.getElementById('bigVerdictWord');
  const btnEl = document.getElementById('btnListenVerdict');
  if (!cardEl || !iconWrapEl || !wordEl) return;

  const lang = (state.currentLang || 'en');
  const t = translations[lang] || translations.en;

  const themes = {
    SAFE: {
      glass: 'glass-card-safe', ring: 'border-emerald-400', text: 'text-emerald-400',
      btn: 'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/30', glow: 'shadow-emerald-500/30',
      word: t.bigVerdictYes || 'YES', speakWord: 'Yes',
      icon: '<path d="M5 12l5 5L20 7"/>'
    },
    CAUTION: {
      glass: 'glass-card-warn', ring: 'border-amber-400', text: 'text-amber-400',
      btn: 'bg-amber-500 hover:bg-amber-400 shadow-amber-500/30', glow: 'shadow-amber-500/30',
      word: t.bigVerdictCaution || 'CAUTION', speakWord: 'Caution',
      icon: '<path d="M12 9v4"/><path d="M12 16.5h.01"/><path d="M10.6 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.4 3.9a2 2 0 0 0-3.4 3.4"/>'
    },
    UNSAFE: {
      glass: 'glass-card-danger', ring: 'border-rose-400', text: 'text-rose-400',
      btn: 'bg-rose-500 hover:bg-rose-400 shadow-rose-500/30', glow: 'shadow-rose-500/30',
      word: t.bigVerdictNo || 'NO', speakWord: 'No',
      icon: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>'
    }
  };
  const th = themes[verdict] || themes.SAFE;

  cardEl.className = `p-6 sm:p-8 rounded-2xl glass-card ${th.glass} flex flex-col sm:flex-row items-center gap-5 sm:gap-8 text-center sm:text-left`;
  iconWrapEl.className = `w-24 h-24 sm:w-28 sm:h-28 rounded-full border-[5px] ${th.ring} flex items-center justify-center ${th.text} shrink-0 shadow-lg ${th.glow}`;
  iconWrapEl.innerHTML = `<svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${th.icon}</svg>`;
  wordEl.textContent = th.word;
  wordEl.className = `text-5xl sm:text-6xl font-black ${th.text} leading-none`;
  if (btnEl) {
    btnEl.className = `w-full sm:w-auto shrink-0 flex items-center justify-center gap-2 px-6 py-4 rounded-xl ${th.btn} text-slate-950 font-bold text-base shadow-lg transition`;
  }

  const questionText = (t.bigVerdictQuestion || 'Safe to go fishing today?');
  const score = weather && weather.safety_score != null ? weather.safety_score : null;
  window._orcaBigVerdict = {
    verdict, word: th.speakWord, question: questionText,
    sentence: `${questionText} ${th.speakWord}.${score != null ? ` Safety score ${score} out of 100.` : ''}`
  };
}

function speakBigVerdict() {
  const v = window._orcaBigVerdict || { sentence: 'Safety verdict not yet available.' };
  if (typeof window.playAudioText === 'function') {
    window.playAudioText(encodeURIComponent(v.sentence));
  }
}
window.speakBigVerdict = speakBigVerdict;

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
  drawSVGSparkline('sparklineWave', wavePoints, '#123456');

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
          <div class="h-full rounded-full bg-cyan-500 transition-all duration-500" style="width: ${pct}%"></div>
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
    let statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold text-[#006A4E]">SAFE FISHING</span>`;
    if (v.status === 'BORDER_ALERT') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold text-[#7E3517] animate-pulse">BORDER ALERT</span>`;
    } else if (v.status === 'BORDER_WARNING') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold text-[#B8860B]">BORDER WARN</span>`;
    } else if (v.status === 'TRANSIT') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold text-cyan-300">IN TRANSIT</span>`;
    }
    // Simulated fill-in vessels always carry their own tag alongside the
    // status badge, so a scan of the table never mistakes one for real AIS.
    const simTag = v.is_simulated
      ? `<span class="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-slate-700 text-slate-200 border border-slate-500" title="Simulated -- no live AIS coverage near this port">SIM</span>`
      : '';

    return `
      <tr class="border-b border-slate-800 hover:bg-slate-800/50 transition ${v.is_simulated ? 'opacity-80' : ''}">
        <td class="py-2.5 px-3 font-mono text-cyan-400 text-xs font-bold">${v.id}</td>
        <td class="py-2.5 px-3 text-xs text-[#003366] font-medium">${v.name}</td>
        <td class="py-2.5 px-3 text-xs text-slate-400">${v.type}</td>
        <td class="py-2.5 px-3 text-xs text-slate-300">${v.zone}</td>
        <td class="py-2.5 px-3 font-mono text-xs text-slate-200">${v.speed_knots} kn / ${v.heading}°</td>
        <td class="py-2.5 px-3 font-mono text-xs ${v.imbl_dist_nm < 5 ? 'text-[#7E3517] font-bold' : 'text-[#006A4E]'}">${v.imbl_dist_nm} NM</td>
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

  switchTab('fleetgis');
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
    let severityColor = '#ffffff';
    if (b.severity === 'CRITICAL') {
      severityColor = '#7E3517';
    } else if (b.severity === 'WARNING') {
      severityColor = '#D4A017';
    } else if (b.severity === 'ADVISORY') {
      severityColor = '#033E3E';
    }

    return `
      <div class="p-5 rounded-xl glass-card space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-mono font-bold" style="color: ${severityColor};">${b.severity}</span>
            <span class="text-xs font-mono text-slate-400">${b.id}</span>
          </div>
          <span class="text-xs text-slate-400 font-mono">Issued: ${b.issued_at}</span>
        </div>

        <h3 class="text-base font-bold" style="color: ${severityColor};">${b.title}</h3>
        <p class="text-sm text-slate-300 leading-relaxed">${b.summary}</p>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 font-mono">
          <div><span class="text-slate-400">Region:</span> <span class="text-slate-200 font-medium">${b.region}</span></div>
          <div><span class="text-slate-400">Waves:</span> <span class="text-cyan-400 font-medium">${b.wave_forecast}</span></div>
          <div><span class="text-slate-400">Winds:</span> <span class="text-slate-200 font-medium">${b.wind_forecast}</span></div>
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
          <span class="text-slate-400">Source: <strong class="text-slate-300">${b.source}</strong></span>
          <button onclick="playAudioText('${encodeURIComponent(b.title + '. ' + b.summary)}')" class="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 transition">
            <span>${orcaIcon('speaker')}</span> Listen Bulletin
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
      <div class="p-4 rounded-xl glass-card glass-card-danger text-red-200 text-sm space-y-2">
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

    if (state.activeTab === 'fleetgis') {
      renderFleetDistributionChart();
    }
  }, 3500);
}

// ============================================================
// ORCA FISHERMAN MODULE
// ============================================================
// Standalone console wired to GET /api/fisherman/dashboard
// (backend/agents/fisherman_agent.py, composed from the SAME
// weather_agent + pfz_agent results the Insight dashboard uses, so
// this console's "today's opportunity" can never disagree with the
// Safety Barometer or GIS Command Map about current conditions).
//
// Deliberately namespaced end-to-end (fm*/calc* ids, data-fm-nav,
// .fm-tab-content, switchFishermanTab/initFishermanConsole) instead
// of reusing the Insight dashboard's tab-content/data-nav-target
// contract, so entering/leaving this console can never interfere
// with switchTab()'s own state above.
// ============================================================

const fishermanState = {
  initialized: false,
  dashboard: null,
  // Same default Kochi Harbour coordinates used elsewhere in this app
  // (see fetchLiveMarineTelemetry(9.93, 76.26) above) so the Fisherman
  // console's default view matches the rest of the app's default origin.
  lat: 9.93,
  lon: 76.26,
  // Fishing Zones Map (fm-tab-map) -- a second, independent Mappls map
  // instance (the GIS Command Map's render*Layer() functions are all
  // hardcoded to the single global state.map, so this map gets its own
  // small self-contained instance + marker list rather than being bolted
  // onto that code).
  map: null,
  mapMarkers: [],
  zoneRanking: [],
  // Cached last successful AI Decision Studio result, so applyLanguage()
  // can re-render it in the new language without another network round
  // trip when the user switches languages while results are on screen.
  lastAiTripData: null,
  // Real, live ORCA Buyer Network open listings (backend/buyer_network.py)
  // -- fetched separately from the dashboard because these carry a
  // listing_id (needed to claim one), which the dashboard's own
  // per-species "buyers" array deliberately doesn't include.
  realListings: [],
  // Real, live nearby seafood businesses (OpenStreetMap Overpass) -- see
  // backend/restaurant_discovery.py. Cached so applyLanguage() can
  // re-render the empty/error copy in the new language without refetching.
  nearbyBusinesses: null,
  // In-progress ORCA Buyer Network registration/verification, tracked only
  // in memory for this one modal session -- never persisted client-side.
  buyerModal: { buyerId: null, verified: false },
  // Which fm-tab-* section is currently shown -- mirrors the Insight
  // dashboard's own state.activeTab, used to keep the mobile dropdown
  // nav's trigger label correct after a language switch.
  activeTab: 'opportunity'
};

// Called by orcaEnterFisherman() (in index.html) every time the Fisherman
// shell is opened. Wires up event listeners exactly once, then always
// pulls a fresh dashboard snapshot.
function initFishermanConsole() {
  if (!fishermanState.initialized) {
    setupFishermanNavigation();
    setupTripCalculator();
    setupFishermanLanguageSwitcher();
    setupBuyerModal();
    const refreshNearbyBtn = document.getElementById('btnRefreshNearbyBusinesses');
    if (refreshNearbyBtn) refreshNearbyBtn.addEventListener('click', () => refreshNearbyBusinesses());
    fishermanState.initialized = true;
  }
  // Reflect whatever language is already active (set via the Insight
  // dashboard's own switcher, or a previous visit to this console) onto
  // the Fisherman header's own selector every time the shell is opened.
  const fmLangSelectEl = document.getElementById('fmLangSelect');
  if (fmLangSelectEl) fmLangSelectEl.value = state.currentLang || 'en';
  refreshFishermanDashboard();
  refreshFishermanZones();
  refreshRealBuyerListings();
  refreshNearbyBusinesses();
}
window.ORCA_FISHERMAN_INIT = initFishermanConsole;

function setupFishermanNavigation() {
  document.querySelectorAll('[data-fm-nav]').forEach(btn => {
    btn.addEventListener('click', () => switchFishermanTab(btn.getAttribute('data-fm-nav')));
  });
  const speciesSelect = document.getElementById('fmSpeciesSelect');
  if (speciesSelect) {
    speciesSelect.addEventListener('change', () => {
      refreshFishermanDashboard(speciesSelect.value || null);
    });
  }
}

function switchFishermanTab(tabId) {
  fishermanState.activeTab = tabId;

  document.querySelectorAll('.fm-tab-content').forEach(section => {
    section.classList.add('hidden');
  });
  const activeSection = document.getElementById(`fm-tab-${tabId}`);
  if (activeSection) activeSection.classList.remove('hidden');

  document.querySelectorAll('[data-fm-nav]').forEach(btn => {
    const isActive = btn.getAttribute('data-fm-nav') === tabId;
    btn.classList.toggle('bg-emerald-500/20', isActive);
    btn.classList.toggle('text-emerald-400', isActive);
    btn.classList.toggle('border-emerald-500/50', isActive);
    btn.classList.toggle('text-slate-400', !isActive);
    btn.classList.toggle('border-transparent', !isActive);
    btn.classList.toggle('sfb-active', isActive);
  });

  updateMobileNavLabel('fmMobileNavCurrentLabel', 'data-fm-nav', tabId);
  closeMobileNavPanel('fmMobileNavToggle');

  if (tabId === 'map') {
    if (!fishermanState.map) {
      setupFishermanMap();
    } else {
      // Mirrors switchTab()'s own defensive Mappls resize() call above --
      // the container has zero size while its parent tab is hidden, so the
      // map needs a nudge once it's actually visible again.
      setTimeout(() => {
        try { fishermanState.map.resize(); } catch (err) { /* not available -- ignore */ }
      }, 200);
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setFishermanStatusBadge(online, label) {
  const badge = document.getElementById('fmBackendStatusBadge');
  if (!badge) return;
  if (online) {
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> ${label}`;
    badge.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono w-fit";
  } else {
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400"></span> ${label}`;
    badge.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-300 text-[11px] font-mono w-fit";
  }
}

async function refreshFishermanDashboard(preferredSpecies) {
  try {
    let url = `${BACKEND_CONFIG.apiBase}/api/fisherman/dashboard?lat=${fishermanState.lat}&lon=${fishermanState.lon}`;
    if (preferredSpecies) url += `&species=${encodeURIComponent(preferredSpecies)}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) throw new Error(`Fisherman dashboard responded with ${res.status}`);
    const data = await res.json();
    fishermanState.dashboard = data;

    setFishermanStatusBadge(true, `${t('fmStatusLive')} — ${data.data_source}`);
    renderFishermanOpportunity(data);
    renderFishermanSellSmarter(data);
    renderFishermanCalculatorDefaults(data);
    renderFishermanPerformance(data);
  } catch (err) {
    console.log('Fisherman dashboard refresh failed, keeping last known values', err);
    setFishermanStatusBadge(false, t('fmStatusOffline'));
  }
}

// Full literal Tailwind class strings (not template-interpolated) so the
// Tailwind Play CDN's runtime scanner reliably picks these up, matching
// the same convention already used by updateSafetyIndexCard() above.
// A function (not a static const) so its labels re-translate every time
// it's called, rather than freezing to whatever language was active when
// app.js first parsed.
function fmScoreMeta() {
  return {
    ocean:  { label: t('fmScoreOcean'),  weightLabel: '25%', barClass: 'bg-cyan-500',    textClass: 'text-cyan-400' },
    fish:   { label: t('fmScoreFish'),   weightLabel: '30%', barClass: 'bg-emerald-500', textClass: 'text-emerald-400' },
    market: { label: t('fmScoreMarket'), weightLabel: '20%', barClass: 'bg-amber-500',   textClass: 'text-amber-400' },
    profit: { label: t('fmScoreProfit'), weightLabel: '25%', barClass: 'bg-teal-500',    textClass: 'text-teal-400' }
  };
}

function fmCurrency(n) {
  return `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
}

function renderFishermanOpportunity(data) {
  const opp = data.opportunity || {};

  const speciesEl = document.getElementById('fmRecommendedSpecies');
  if (speciesEl) speciesEl.textContent = opp.recommended_species || '—';

  const descEl = document.getElementById('fmOpportunityDesc');
  if (descEl) {
    descEl.textContent = tFormat('fmOpportunityDescTemplate', {
      price: opp.price_per_kg,
      zone: opp.top_recommended_pfz || t('fmTheRecommendedZone'),
      score: opp.composite_score
    });
  }

  const scoreEl = document.getElementById('fmOpportunityScore');
  if (scoreEl) scoreEl.textContent = opp.composite_score != null ? Math.round(opp.composite_score) : '—';

  const zoneEl = document.getElementById('fmRecommendedZone');
  if (zoneEl) zoneEl.textContent = opp.top_recommended_pfz || '—';
  const distEl = document.getElementById('fmZoneDistance');
  if (distEl) distEl.textContent = opp.distance_from_vessel_nm != null ? `${opp.distance_from_vessel_nm} NM away` : '';

  const catchEl = document.getElementById('fmExpectedCatch');
  if (catchEl) catchEl.textContent = (opp.catch_min_kg != null && opp.catch_max_kg != null) ? `${opp.catch_min_kg}–${opp.catch_max_kg} kg` : '—';

  const revEl = document.getElementById('fmRevenueRange');
  if (revEl) revEl.textContent = (opp.revenue_min != null && opp.revenue_max != null) ? `${fmCurrency(opp.revenue_min)}–${fmCurrency(opp.revenue_max)}` : '—';

  const profitEl = document.getElementById('fmProfitRange');
  if (profitEl) profitEl.textContent = (opp.profit_min != null && opp.profit_max != null) ? `${fmCurrency(opp.profit_min)}–${fmCurrency(opp.profit_max)}` : '—';

  const confEl = document.getElementById('fmConfidencePct');
  if (confEl) confEl.textContent = opp.confidence_pct != null ? `${t('fmConfidenceLabel')} ${opp.confidence_pct}%` : `${t('fmConfidenceLabel')} —%`;

  const breakdownEl = document.getElementById('fmScoreBreakdown');
  if (breakdownEl && opp.score_breakdown) {
    const scoreMeta = fmScoreMeta();
    breakdownEl.innerHTML = Object.entries(opp.score_breakdown).map(([key, v]) => {
      const meta = scoreMeta[key] || { label: key, weightLabel: `${Math.round((v.weight || 0) * 100)}%`, barClass: 'bg-cyan-500', textClass: 'text-cyan-400' };
      const score = Math.max(0, Math.min(100, Math.round(v.score || 0)));
      return `
        <div class="space-y-1">
          <div class="flex justify-between">
            <span class="text-slate-300 font-medium">${meta.label} <span class="text-slate-500">(${meta.weightLabel})</span></span>
            <span class="${meta.textClass} font-mono font-bold">${score}/100</span>
          </div>
          <div class="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
            <div class="h-full rounded-full ${meta.barClass} transition-all duration-500" style="width: ${score}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Species selector: "Auto" + every ranked species, preserving whatever
  // the user had picked (falls back to Auto if that species dropped out).
  const speciesSelect = document.getElementById('fmSpeciesSelect');
  if (speciesSelect && Array.isArray(data.ranking)) {
    const current = speciesSelect.value;
    speciesSelect.innerHTML = `<option value="">${t('fmAutoBestMatch')}</option>` +
      data.ranking.map(r => `<option value="${r.species}">${r.species}</option>`).join('');
    speciesSelect.value = (current && data.ranking.some(r => r.species === current)) ? current : '';
  }
}

function renderFishermanSellSmarter(data) {
  const ss = data.sell_smarter || {};

  const descEl = document.getElementById('fmSellSmarterDesc');
  if (descEl) {
    descEl.textContent = tFormat('fmSellSmarterDescTemplate', {
      species: ss.species || t('fmYourCatch'),
      revenue: fmCurrency(ss.potential_additional_revenue),
      catch: ss.assumed_catch_kg || 0
    });
  }
  const typicalEl = document.getElementById('fmTypicalPrice');
  if (typicalEl) typicalEl.textContent = ss.typical_price_per_kg != null ? `₹${ss.typical_price_per_kg}/kg` : '—';
  const oppPriceEl = document.getElementById('fmOpportunityPrice');
  if (oppPriceEl) oppPriceEl.textContent = ss.opportunity_price_per_kg != null ? `₹${ss.opportunity_price_per_kg}/kg` : '—';
  const extraEl = document.getElementById('fmExtraRevenue');
  if (extraEl) extraEl.textContent = fmCurrency(ss.potential_additional_revenue);

  const rankingBody = document.getElementById('fmSpeciesRankingBody');
  if (rankingBody && Array.isArray(data.ranking)) {
    rankingBody.innerHTML = data.ranking.map(r => {
      const trendUp = (r.price_change_pct || 0) >= 0;
      const trendClass = trendUp ? 'text-emerald-400' : 'text-red-400';
      const trendArrow = trendUp ? '▲' : '▼';
      const demandClass = { High: 'text-emerald-400', Medium: 'text-amber-400', Low: 'text-red-400' }[r.demand] || 'text-slate-300';
      return `
        <tr class="border-b border-ocean-800/60 hover:bg-ocean-800/40 transition">
          <td class="py-2 px-3 font-semibold text-slate-100">${r.species}</td>
          <td class="py-2 px-3 font-mono text-slate-200">₹${r.price_per_kg}</td>
          <td class="py-2 px-3 font-mono ${trendClass}">${trendArrow} ${Math.abs(r.price_change_pct || 0)}%</td>
          <td class="py-2 px-3 font-semibold ${demandClass}">${r.demand}</td>
          <td class="py-2 px-3 font-mono text-amber-300">${fmCurrency(r.profit_min)}–${fmCurrency(r.profit_max)}</td>
          <td class="py-2 px-3 font-mono text-cyan-300">${r.composite_score}/100</td>
        </tr>
      `;
    }).join('');
  }

  const buyersGrid = document.getElementById('fmBuyerLeadsGrid');
  if (buyersGrid && Array.isArray(data.buyers)) {
    buyersGrid.innerHTML = data.buyers.map(b => {
      const isReal = b.buyer_source === 'ORCA_BUYER_NETWORK';
      const badge = isReal
        ? `<span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-500/40">${t('fmBuyerLiveTag')}</span>`
        : `<span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">${t('fmBuyerDemoTag')}</span>`;
      return `
      <div class="p-4 rounded-xl glass-card space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-sm font-bold text-slate-100 flex items-center gap-2">${b.name} ${badge}</span>
          <span class="text-[11px] font-mono text-emerald-300">${b.species}</span>
        </div>
        <div class="text-xs text-slate-400">Wants <strong class="text-slate-200">${b.qty_kg} kg</strong> · ₹${b.price_min}–₹${b.price_max}/kg</div>
        <div class="flex items-center justify-between text-[11px] text-slate-500">
          <span>${b.location}</span>
          <span class="text-amber-300 font-semibold">${b.deadline}</span>
        </div>
      </div>
    `;
    }).join('');
  }
}

// --- Real ORCA Buyer Network listings (claimable) --------------------
// Fetched separately from the main dashboard because each row here
// carries a listing_id (needed for /claim), which the dashboard's own
// per-species "buyers" summary deliberately omits (see fisherman_agent.py).
async function refreshRealBuyerListings() {
  try {
    const res = await fetchWithTimeout(`${BACKEND_CONFIG.apiBase}/api/fisherman/buyers/listings?status=OPEN`, {}, 8000);
    if (!res.ok) throw new Error(`buyers/listings responded with ${res.status}`);
    const data = await res.json();
    fishermanState.realListings = Array.isArray(data.listings) ? data.listings : [];
  } catch (err) {
    console.log('ORCA FISHERMAN: real buyer listings fetch failed, leaving last known list', err);
  }
  renderRealBuyerListings();
}

function renderRealBuyerListings() {
  const grid = document.getElementById('fmRealListingsGrid');
  if (!grid) return;
  const listings = fishermanState.realListings || [];
  if (!listings.length) {
    grid.classList.add('hidden');
    grid.innerHTML = '';
    return;
  }
  grid.classList.remove('hidden');
  grid.innerHTML = listings.map(l => `
    <div class="p-4 rounded-xl glass-card space-y-1.5 border border-emerald-500/40">
      <div class="flex items-center justify-between">
        <span class="text-sm font-bold text-slate-100 flex items-center gap-2">${l.name}
          <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-500/40">${t('fmBuyerLiveTag')}</span>
        </span>
        <span class="text-[11px] font-mono text-emerald-300">${l.species}</span>
      </div>
      <div class="text-xs text-slate-400">Wants <strong class="text-slate-200">${l.qty_kg} kg</strong>${(l.price_min != null || l.price_max != null) ? ` · ₹${l.price_min ?? '—'}–₹${l.price_max ?? '—'}/kg` : ''}</div>
      <div class="flex items-center justify-between text-[11px] text-slate-500">
        <span>${l.location || '—'}</span>
        <span class="text-amber-300 font-semibold">${l.deadline || '—'}</span>
      </div>
      <button type="button" class="w-full mt-1 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] shadow-md transition" data-claim-listing-id="${l.listing_id}">${t('fmClaimBtn')}</button>
    </div>
  `).join('');
  grid.querySelectorAll('[data-claim-listing-id]').forEach(btn => {
    btn.addEventListener('click', () => claimBuyerListing(btn.getAttribute('data-claim-listing-id'), btn));
  });
}

async function claimBuyerListing(listingId, btnEl) {
  const contact = window.prompt(t('fmClaimPromptText'));
  if (!contact || !contact.trim()) return;
  try {
    const res = await fetchWithTimeout(`${BACKEND_CONFIG.apiBase}/api/fisherman/buyers/listings/${listingId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fisherman_contact: contact.trim() })
    }, 8000);
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.claimed) throw new Error(result.detail || 'claim failed');
    alert(t('fmClaimSuccess'));
    refreshRealBuyerListings();
  } catch (err) {
    console.log('ORCA FISHERMAN: claim failed', err);
    alert(t('fmClaimFailed'));
  }
}

// --- Nearby seafood businesses (live, keyless, OpenStreetMap Overpass) --
async function refreshNearbyBusinesses() {
  const badge = document.getElementById('fmNearbyBusinessesBadge');
  if (badge) badge.textContent = '…';
  try {
    const url = `${BACKEND_CONFIG.apiBase}/api/fisherman/nearby-businesses?lat=${fishermanState.lat}&lon=${fishermanState.lon}`;
    const res = await fetchWithTimeout(url, {}, 10000);
    if (!res.ok) throw new Error(`nearby-businesses responded with ${res.status}`);
    fishermanState.nearbyBusinesses = await res.json();
  } catch (err) {
    console.log('ORCA FISHERMAN: nearby businesses fetch failed', err);
    fishermanState.nearbyBusinesses = { status: 'UNAVAILABLE', businesses: [] };
  }
  renderNearbyBusinesses();
}

function renderNearbyBusinesses() {
  const grid = document.getElementById('fmNearbyBusinessesGrid');
  const badge = document.getElementById('fmNearbyBusinessesBadge');
  const data = fishermanState.nearbyBusinesses;
  if (!grid || !data) return;

  if (badge) {
    const live = data.status === 'LIVE';
    badge.textContent = live ? t('fmNearbyBadgeLive') : t('fmNearbyBadgeUnavailable');
    badge.className = `text-[10px] font-mono normal-case tracking-normal px-2 py-0.5 rounded-full border ${live ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`;
  }

  const businesses = Array.isArray(data.businesses) ? data.businesses : [];
  if (data.status !== 'LIVE') {
    grid.innerHTML = `<div class="text-slate-500" style="grid-column: 1 / -1;">${t('fmNearbyFailed')}</div>`;
    return;
  }
  if (!businesses.length) {
    grid.innerHTML = `<div class="text-slate-500" style="grid-column: 1 / -1;">${t('fmNearbyNoneFound')}</div>`;
    return;
  }
  grid.innerHTML = businesses.map(b => `
    <div class="p-3 rounded-lg glass-chip space-y-1">
      <div class="text-slate-100 font-semibold">${b.name || 'Unnamed'}</div>
      <div class="text-slate-500 text-[10px] uppercase tracking-wide">${(b.type || '').replace(/_/g, ' ')}</div>
      ${b.address ? `<div class="text-slate-400">${b.address}</div>` : ''}
      ${b.phone ? `<div class="text-slate-400 font-mono">${b.phone}</div>` : ''}
    </div>
  `).join('');
}

// --- ORCA Buyer Network registration modal (register -> OTP -> listing) -
function setupBuyerModal() {
  const modal = document.getElementById('fmBuyerModal');
  if (!modal) return;

  const openBtn = document.getElementById('btnOpenBuyerModal');
  const closeBtn = document.getElementById('btnCloseBuyerModal');
  const doneBtn = document.getElementById('btnBuyerModalDone');
  if (openBtn) openBtn.addEventListener('click', () => openBuyerModal());
  if (closeBtn) closeBtn.addEventListener('click', () => closeBuyerModal());
  if (doneBtn) doneBtn.addEventListener('click', () => closeBuyerModal());
  modal.addEventListener('click', (e) => { if (e.target === modal) closeBuyerModal(); });

  const registerBtn = document.getElementById('btnBuyerRegister');
  if (registerBtn) registerBtn.addEventListener('click', submitBuyerRegistration);

  const verifyBtn = document.getElementById('btnBuyerVerify');
  if (verifyBtn) verifyBtn.addEventListener('click', submitBuyerVerification);

  const listingBtn = document.getElementById('btnBuyerCreateListing');
  if (listingBtn) listingBtn.addEventListener('click', submitBuyerListing);
}

function showBuyerModalError(message) {
  const el = document.getElementById('fmBuyerModalError');
  if (!el) return;
  if (!message) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = message;
  el.classList.remove('hidden');
}

function openBuyerModal() {
  const modal = document.getElementById('fmBuyerModal');
  if (!modal) return;
  resetBuyerModal();
  modal.classList.remove('hidden');
}

function closeBuyerModal() {
  const modal = document.getElementById('fmBuyerModal');
  if (modal) modal.classList.add('hidden');
}

function resetBuyerModal() {
  fishermanState.buyerModal = { buyerId: null, verified: false };
  showBuyerModalError(null);
  ['fmBuyerBusinessName', 'fmBuyerEmail', 'fmBuyerLocation', 'fmBuyerOtp', 'fmBuyerQty', 'fmBuyerDeadline', 'fmBuyerPriceMin', 'fmBuyerPriceMax', 'fmBuyerListingLocation'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const devOtpNote = document.getElementById('fmBuyerDevOtpNote');
  if (devOtpNote) { devOtpNote.classList.add('hidden'); devOtpNote.textContent = ''; }
  ['fmBuyerStep1', 'fmBuyerStep2', 'fmBuyerStep3', 'fmBuyerStep4'].forEach((id, idx) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', idx !== 0);
  });
}

function showBuyerStep(stepNum) {
  ['fmBuyerStep1', 'fmBuyerStep2', 'fmBuyerStep3', 'fmBuyerStep4'].forEach((id, idx) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', idx !== (stepNum - 1));
  });
}

async function submitBuyerRegistration() {
  showBuyerModalError(null);
  const name = (document.getElementById('fmBuyerBusinessName')?.value || '').trim();
  const email = (document.getElementById('fmBuyerEmail')?.value || '').trim();
  const location = (document.getElementById('fmBuyerLocation')?.value || '').trim();
  if (!name || !email) { showBuyerModalError(t('fmBuyerErrRequired')); return; }
  try {
    const res = await fetchWithTimeout(`${BACKEND_CONFIG.apiBase}/api/fisherman/buyers/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name: name, contact_email: email, location: location || null })
    }, 8000);
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.detail || 'register failed');
    fishermanState.buyerModal.buyerId = result.buyer_id;
    const devOtpNote = document.getElementById('fmBuyerDevOtpNote');
    if (devOtpNote && result.dev_otp) {
      devOtpNote.textContent = tFormat('fmBuyerDevOtpTemplate', { code: result.dev_otp });
      devOtpNote.classList.remove('hidden');
    }
    showBuyerStep(2);
  } catch (err) {
    console.log('ORCA FISHERMAN: buyer registration failed', err);
    showBuyerModalError(t('fmBuyerErrGeneric'));
  }
}

async function submitBuyerVerification() {
  showBuyerModalError(null);
  const code = (document.getElementById('fmBuyerOtp')?.value || '').trim();
  if (!code) { showBuyerModalError(t('fmBuyerErrOtp')); return; }
  try {
    const res = await fetchWithTimeout(`${BACKEND_CONFIG.apiBase}/api/fisherman/buyers/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer_id: fishermanState.buyerModal.buyerId, code })
    }, 8000);
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.verified) throw new Error(result.detail || 'verify failed');
    fishermanState.buyerModal.verified = true;
    showBuyerStep(3);
  } catch (err) {
    console.log('ORCA FISHERMAN: buyer verification failed', err);
    showBuyerModalError(t('fmBuyerErrGeneric'));
  }
}

async function submitBuyerListing() {
  showBuyerModalError(null);
  const species = document.getElementById('fmBuyerSpecies')?.value;
  const qty = parseFloat(document.getElementById('fmBuyerQty')?.value);
  if (!qty || qty <= 0) { showBuyerModalError(t('fmBuyerErrQty')); return; }
  const priceMinRaw = document.getElementById('fmBuyerPriceMin')?.value;
  const priceMaxRaw = document.getElementById('fmBuyerPriceMax')?.value;
  const deadline = (document.getElementById('fmBuyerDeadline')?.value || '').trim();
  const location = (document.getElementById('fmBuyerListingLocation')?.value || '').trim();
  try {
    const res = await fetchWithTimeout(`${BACKEND_CONFIG.apiBase}/api/fisherman/buyers/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyer_id: fishermanState.buyerModal.buyerId,
        species,
        required_qty_kg: qty,
        price_min: priceMinRaw ? parseFloat(priceMinRaw) : null,
        price_max: priceMaxRaw ? parseFloat(priceMaxRaw) : null,
        deadline: deadline || null,
        location: location || null
      })
    }, 8000);
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.created) throw new Error(result.detail || 'create listing failed');
    showBuyerStep(4);
    refreshRealBuyerListings();
    refreshFishermanDashboard();
  } catch (err) {
    console.log('ORCA FISHERMAN: buyer listing creation failed', err);
    showBuyerModalError(t('fmBuyerErrGeneric'));
  }
}

function renderFishermanCalculatorDefaults(data) {
  const d = data.trip_calculator_defaults;
  if (!d) return;

  const speciesSelect = document.getElementById('calcSpecies');
  if (speciesSelect && Array.isArray(data.ranking)) {
    speciesSelect.innerHTML = data.ranking.map(r => `<option value="${r.species}" data-price="${r.price_per_kg}">${r.species}</option>`).join('');
    speciesSelect.value = d.species;
  }

  // Only pre-fill fields the user hasn't touched themselves, so a manual
  // edit followed by a background refresh never silently overwrites it.
  const prefill = (id, value) => {
    const el = document.getElementById(id);
    if (el && !el.dataset.userEdited) el.value = value;
  };
  prefill('calcCatchKg', d.catch_kg);
  prefill('calcPricePerKg', d.price_per_kg);
  prefill('calcFuelCost', d.fuel_cost);
  prefill('calcIceCost', d.ice_cost);
  prefill('calcOtherCost', d.other_cost);

  recalculateTrip();
}

function setupTripCalculator() {
  ['calcCatchKg', 'calcPricePerKg', 'calcFuelCost', 'calcIceCost', 'calcOtherCost'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { el.dataset.userEdited = '1'; recalculateTrip(); });
  });
  const speciesSelect = document.getElementById('calcSpecies');
  if (speciesSelect) {
    speciesSelect.addEventListener('change', () => {
      const opt = speciesSelect.selectedOptions[0];
      const priceEl = document.getElementById('calcPricePerKg');
      if (opt && priceEl && !priceEl.dataset.userEdited) priceEl.value = opt.dataset.price;
      recalculateTrip();
    });
  }
  const btn = document.getElementById('btnRecalcTrip');
  if (btn) btn.addEventListener('click', recalculateTrip);
}

function recalculateTrip() {
  const num = id => parseFloat(document.getElementById(id)?.value) || 0;
  const catchKg = num('calcCatchKg');
  const pricePerKg = num('calcPricePerKg');
  const fuel = num('calcFuelCost');
  const ice = num('calcIceCost');
  const other = num('calcOtherCost');
  const revenue = catchKg * pricePerKg;
  const cost = fuel + ice + other;
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  const revEl = document.getElementById('calcRevenueOut');
  if (revEl) revEl.textContent = fmCurrency(revenue);
  const costEl = document.getElementById('calcCostOut');
  if (costEl) costEl.textContent = fmCurrency(cost);
  const profitEl = document.getElementById('calcProfitOut');
  if (profitEl) {
    profitEl.textContent = fmCurrency(profit);
    profitEl.className = `font-mono font-bold ${profit >= 0 ? 'text-amber-400' : 'text-red-400'}`;
  }
  const marginEl = document.getElementById('calcMarginOut');
  if (marginEl) marginEl.textContent = `${margin.toFixed(1)}%`;
}

// A function (not a static const) so labels re-translate on language switch
// -- mirrors fmScoreMeta()/fmYieldTiers() above.
function fmPostTypeMeta() {
  return {
    weather_alert: { icon: '', color: 'text-amber-300', label: t('fmPostWeatherAlert') },
    market_update: { icon: '', color: 'text-emerald-300', label: t('fmPostMarketUpdate') },
    fisherman_post: { icon: '', color: 'text-cyan-300', label: t('fmPostFishermanReport') }
  };
}

function renderFishermanPerformance(data) {
  const perf = data.performance || {};

  const avgEl = document.getElementById('fmAvgProfit');
  if (avgEl) avgEl.textContent = perf.average_profit ? `${fmCurrency(perf.average_profit)} avg/trip` : '—';

  const insightEl = document.getElementById('fmPerformanceInsight');
  if (insightEl) insightEl.textContent = perf.insight || t('fmNoTripHistory');

  const tbody = document.getElementById('fmTripHistoryBody');
  if (tbody && Array.isArray(perf.trips)) {
    tbody.innerHTML = perf.trips.map(trip => `
      <tr class="border-b border-ocean-800/60 hover:bg-ocean-800/40 transition">
        <td class="py-2 px-3 text-slate-300">${tFormat(trip.trips_ago === 1 ? 'fmTripAgoSingular' : 'fmTripAgoPlural', { n: trip.trips_ago })}</td>
        <td class="py-2 px-3 font-semibold text-slate-100">${trip.species}</td>
        <td class="py-2 px-3 font-mono text-slate-300">${trip.catch_kg} kg</td>
        <td class="py-2 px-3 font-mono text-slate-300">₹${trip.price_per_kg}</td>
        <td class="py-2 px-3 font-mono text-emerald-300">${fmCurrency(trip.revenue)}</td>
        <td class="py-2 px-3 font-mono text-amber-300">${fmCurrency(trip.profit)}</td>
      </tr>
    `).join('');
  }

  const feed = document.getElementById('fmCommunityFeed');
  if (feed && Array.isArray(data.community_posts)) {
    const postTypeMeta = fmPostTypeMeta();
    feed.innerHTML = data.community_posts.map(p => {
      const meta = postTypeMeta[p.type] || { icon: '', color: 'text-slate-300', label: t('fmPostUpdate') };
      return `
        <div class="p-4 rounded-xl glass-card space-y-1.5">
          <div class="flex items-center justify-between text-[11px]">
            <span class="font-bold ${meta.color} flex items-center gap-1.5">${meta.icon} ${meta.label}</span>
            <span class="text-slate-500">${p.posted}</span>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed">${p.text}</p>
          <span class="text-[11px] text-slate-500">— ${p.author}</span>
        </div>
      `;
    }).join('');
  }
}

// ============================================================
// FISHERMAN FISHING ZONES MAP (fm-tab-map)
// ============================================================
// Reuses the exact same Mappls SDK already loaded for the GIS Command Map
// (one <script> tag in index.html's <head>, one shared `mappls` global) --
// but as its OWN map instance, since none of the existing render*Layer()
// functions in this file take a map instance as a parameter; they're all
// hardcoded to the single global state.map used by the Insight dashboard.
// Duplicating the (short) init/marker/clear pattern here keeps this
// feature fully independent of Insight's map state, so nothing here can
// ever interfere with the GIS Command Map tab.
//
// Zone data is the SAME live-scored GET /api/pfz used internally by
// fisherman_agent.build_dashboard() (via core.pfz_agent.rank_pfz_zones()),
// merged client-side with the static data/pfz_zones.json's center/bounds
// (already loaded into state.pfzZones by loadInitialData() above) since
// the live ranking returns scores/distance but not coordinates.

// A function (not a static const) so tier labels re-translate on language
// switch -- mirrors fmScoreMeta()/fmPostTypeMeta() above.
function fmYieldTiers() {
  return [
    { min: 85, label: t('fmTierHigh'),     textClass: 'text-emerald-400', dot: 'bg-emerald-400', barClass: 'bg-emerald-500', badgeClass: 'bg-emerald-500/20 text-emerald-300' },
    { min: 70, label: t('fmTierGood'),     textClass: 'text-cyan-400',    dot: 'bg-cyan-400',    barClass: 'bg-cyan-500',    badgeClass: 'bg-cyan-500/20 text-cyan-300' },
    { min: 0,  label: t('fmTierModerate'), textClass: 'text-amber-400',   dot: 'bg-amber-400',   barClass: 'bg-amber-500',   badgeClass: 'bg-amber-500/20 text-amber-300' }
  ];
}
function fmYieldTier(score) {
  const tiers = fmYieldTiers();
  return tiers.find(tier => (score || 0) >= tier.min) || tiers[tiers.length - 1];
}

async function refreshFishermanZones() {
  try {
    const url = `${BACKEND_CONFIG.apiBase}/api/pfz?lat=${fishermanState.lat}&lon=${fishermanState.lon}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) throw new Error(`PFZ agent responded with ${res.status}`);
    const data = await res.json();
    const ranking = Array.isArray(data.full_ranking) ? data.full_ranking : [];

    const byId = {};
    state.pfzZones.forEach(z => { byId[z.id] = z; });

    // Re-sorted by yield_score_pct (not the GIS map's reachability-weighted
    // composite_score) since this view is specifically "best fish YIELD
    // zones" for a fisherman deciding where to go, not the route planner's
    // distance-adjusted ranking.
    fishermanState.zoneRanking = ranking
      .map(z => ({ ...z, center: (byId[z.id] || {}).center || null }))
      .sort((a, b) => (b.yield_score_pct || 0) - (a.yield_score_pct || 0));

    renderFishermanZoneList();
    renderFishermanZoneMarkers();
  } catch (err) {
    console.log('Fisherman zone map refresh failed, keeping last known values', err);
  }
}

function renderFishermanZoneList() {
  const listEl = document.getElementById('fmZoneRankList');
  if (!listEl) return;

  if (!fishermanState.zoneRanking.length) {
    listEl.innerHTML = `<p class="text-slate-500 text-[11px] leading-relaxed">${t('fmLoadingZones')}</p>`;
    return;
  }

  listEl.innerHTML = fishermanState.zoneRanking.map((z, i) => {
    const tier = fmYieldTier(z.yield_score_pct || 0);
    const pct = Math.max(0, Math.min(100, z.yield_score_pct || 0));
    return `
      <button type="button" onclick="focusFishermanZone('${z.id}')" class="w-full text-left p-2.5 rounded-lg glass-chip hover:border-emerald-500/50 transition space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="font-bold text-slate-100">#${i + 1} ${z.name || z.id}</span>
          <span class="flex items-center gap-1 ${tier.textClass} font-mono font-bold whitespace-nowrap">
            <span class="w-1.5 h-1.5 rounded-full ${tier.dot}"></span>${z.yield_score_pct}%
          </span>
        </div>
        <div class="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div class="h-full rounded-full ${tier.barClass}" style="width: ${pct}%"></div>
        </div>
        <div class="flex items-center justify-between text-[10px] text-slate-500">
          <span>${(z.dominant_species || []).slice(0, 2).join(', ')}</span>
          <span>${z.distance_nm != null ? `${z.distance_nm} NM` : ''}</span>
        </div>
      </button>
    `;
  }).join('');

  const top = fishermanState.zoneRanking[0];
  if (top) {
    const hudZone = document.getElementById('fmMapHudZone');
    if (hudZone) hudZone.textContent = top.name || top.id;
    const hudYield = document.getElementById('fmMapHudYield');
    if (hudYield) hudYield.textContent = `${top.yield_score_pct}%`;
    const hudSpecies = document.getElementById('fmMapHudSpecies');
    if (hudSpecies) hudSpecies.textContent = (top.dominant_species || []).join(', ');
  }
}

function setupFishermanMap() {
  const container = document.getElementById('fmMapContainer');
  if (!container || fishermanState.map) return;

  if (typeof mappls === 'undefined' || !mappls.Map) {
    console.warn('ORCA FISHERMAN: Mappls SDK failed to load -- zone map disabled.');
    return;
  }

  fishermanState.map = new mappls.Map('fmMapContainer', {
    center: { lat: 12.0, lng: 77.5 },
    zoom: 6
  });

  fishermanState.map.addListener('load', function () {
    renderFishermanZoneMarkers();
  });
}

function clearFishermanZoneMarkers() {
  if (!fishermanState.map) return;
  fishermanState.mapMarkers.forEach(marker => {
    try { mappls.remove({ map: fishermanState.map, layer: marker }); } catch (err) { /* already gone */ }
  });
  fishermanState.mapMarkers = [];
}

function renderFishermanZoneMarkers() {
  if (!fishermanState.map) return;
  clearFishermanZoneMarkers();

  fishermanState.zoneRanking.forEach((z, i) => {
    if (!z.center) return; // live ranking has no static-dataset match to plot
    const tier = fmYieldTier(z.yield_score_pct || 0);

    const popupHtml = `
      <div class="p-2 min-w-[220px]">
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="font-bold text-cyan-400 text-sm">#${i + 1} ${z.name || z.id}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${tier.badgeClass}">${tier.label} ${t('fmYieldWord')} (${z.yield_score_pct}%)</span>
        </div>
        <p class="text-xs text-slate-300 mb-2">${z.advisory_notes || ''}</p>
        <div class="grid grid-cols-2 gap-1 text-[11px] bg-slate-900/80 p-1.5 rounded border border-slate-700">
          <div><span class="text-slate-400">${t('fmSstLabel')}</span> <span class="text-slate-200 font-semibold">${z.sst_celsius}°C</span></div>
          <div><span class="text-slate-400">${t('fmDepthLabel')}</span> <span class="text-slate-200 font-semibold">${z.depth_m} m</span></div>
          <div><span class="text-slate-400">${t('fmThDistance')}:</span> <span class="text-cyan-400 font-bold">${z.distance_nm} NM</span></div>
          <div><span class="text-slate-400">${t('fmSafetyLabel')}</span> <span class="text-slate-200 font-semibold">${z.safety_status || '—'}</span></div>
        </div>
        <div class="mt-2 text-[10px] text-slate-400">
          <span class="font-semibold text-slate-300">${t('fmTargetSpeciesColon')}</span> ${(z.dominant_species || []).join(', ')}
        </div>
      </div>
    `;
    const labelHtml = `<div class="px-2 py-0.5 rounded text-[10px] font-bold ${tier.badgeClass} whitespace-nowrap shadow-lg flex items-center gap-1">
      <span class="w-1.5 h-1.5 rounded-full ${tier.dot}"></span> #${i + 1} ${z.id} · ${z.yield_score_pct}%
    </div>`;

    const marker = new mappls.Marker({
      map: fishermanState.map,
      position: { lat: z.center[0], lng: z.center[1] },
      html: labelHtml,
      width: 100,
      height: 20,
      popupHtml,
      popupOptions: true
    });
    fishermanState.mapMarkers.push(marker);
  });
}

// Bound via onclick="focusFishermanZone('PFZ-01')" from the rendered zone
// list (see renderFishermanZoneList() above) -- pans/zooms the map to that
// zone. Wrapped defensively: Mappls' exact Map API surface beyond
// addListener()/resize() isn't documented in this codebase (see the
// existing resize() try/catch in switchTab() above), so a missing
// setCenter/setZoom degrades to a no-op instead of an error.
function focusFishermanZone(zoneId) {
  const zone = fishermanState.zoneRanking.find(z => z.id === zoneId);
  if (!zone || !zone.center || !fishermanState.map) return;
  try {
    fishermanState.map.setCenter({ lat: zone.center[0], lng: zone.center[1] });
    fishermanState.map.setZoom(8);
  } catch (err) { /* Mappls setCenter/setZoom not available -- ignore */ }
}

// ============================================================
// ORCA FISHERMAN -- AI DECISION STUDIO (fm-tab-aistudio)
// ============================================================
// Trip Planner UI for POST /api/fisherman/analyze-trip
// (backend/api/fisherman_ai_routes.py), which runs ORCA's own
// on-device scikit-learn models (backend/ml/) plus a deterministic
// profit/risk/market engine (backend/ml/decision/decision_engine.py).
// No external AI API is called anywhere in this pipeline -- every
// number rendered below comes straight from that response. Reuses
// fishermanState.lat/lon (same default harbour origin as the rest of
// the Fisherman console) rather than tracking its own location.
// ============================================================

function fmModelPct(v) {
  return v != null ? `${Math.round(v * 100) / 100}%` : '—';
}

async function runAiTripPlanner() {
  const btn = document.getElementById('aiPlanTripBtn');
  const btnLabel = document.getElementById('aiPlanTripBtnLabel');
  const loadingEl = document.getElementById('aiLoadingState');
  const errorEl = document.getElementById('aiErrorState');
  const resultsEl = document.getElementById('aiResultsWrap');

  if (btn) btn.setAttribute('disabled', 'true');
  if (btnLabel) btnLabel.textContent = t('fmRunningModelsBtn');
  if (loadingEl) loadingEl.classList.remove('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  if (resultsEl) resultsEl.classList.add('hidden');

  const boatType = document.getElementById('aiBoatType')?.value || 'Motorized';
  const gearType = document.getElementById('aiGearType')?.value || 'Gillnet';
  const tripDuration = parseFloat(document.getElementById('aiTripDuration')?.value) || 8;
  const targetSpecies = document.getElementById('aiTargetSpecies')?.value || null;

  const payload = {
    lat: fishermanState.lat,
    lon: fishermanState.lon,
    boat_type: boatType,
    gear_type: gearType,
    target_species: targetSpecies,
    trip_duration_hours: tripDuration,
    month: new Date().getMonth() + 1
  };

  try {
    const res = await fetchWithTimeout(`${BACKEND_CONFIG.apiBase}/api/fisherman/analyze-trip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 15000);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Backend responded with ${res.status}`);
    }
    const data = await res.json();
    fishermanState.lastAiTripData = data;
    renderAiTripResults(data);
    if (resultsEl) resultsEl.classList.remove('hidden');
  } catch (err) {
    console.log('AI Decision Studio trip analysis failed', err);
    if (errorEl) {
      errorEl.textContent = tFormat('fmAiErrorTemplate', { error: err.message || err });
      errorEl.classList.remove('hidden');
    }
  } finally {
    if (btn) btn.removeAttribute('disabled');
    if (btnLabel) btnLabel.textContent = t('fmPlanMyTrip');
    if (loadingEl) loadingEl.classList.add('hidden');
  }
}

function renderAiTripResults(data) {
  const plan = data.best_fishing_plan || {};

  const headlineEl = document.getElementById('aiPlanHeadline');
  if (headlineEl) headlineEl.textContent = `${plan.target_species || '—'} at ${plan.zone_name || t('fmTheRecommendedZone')}`;

  const descEl = document.getElementById('aiPlanDesc');
  if (descEl) {
    descEl.textContent = tFormat('fmPlanDescTemplate', {
      window: plan.best_time_window || '—',
      market: plan.best_market || t('fmTheRecommendedMarket'),
      score: plan.orca_trip_score != null ? plan.orca_trip_score : '—'
    });
  }

  const scoreEl = document.getElementById('aiTripScore');
  if (scoreEl) scoreEl.textContent = plan.orca_trip_score != null ? Math.round(plan.orca_trip_score) : '—';

  const zoneEl = document.getElementById('aiBestZone');
  if (zoneEl) zoneEl.textContent = plan.zone_name || '—';
  const zoneDistEl = document.getElementById('aiBestZoneDistance');
  const topZone = (data.zone_ranking || [])[0];
  if (zoneDistEl) zoneDistEl.textContent = topZone && topZone.distance_from_port_km != null ? tFormat('fmKmFromPortTemplate', { km: Math.round(topZone.distance_from_port_km) }) : '';

  const timeEl = document.getElementById('aiBestTimeWindow');
  if (timeEl) timeEl.textContent = plan.best_time_window || '—';

  const catchEl = document.getElementById('aiExpectedCatch');
  if (catchEl) {
    catchEl.textContent = plan.expected_catch_range
      ? `${Math.round(plan.expected_catch_range[0])}–${Math.round(plan.expected_catch_range[1])} kg`
      : (plan.expected_catch_kg != null ? `${Math.round(plan.expected_catch_kg)} kg` : '—');
  }
  const reliabilityEl = document.getElementById('aiCatchReliability');
  if (reliabilityEl) reliabilityEl.textContent = plan.model_reliability_pct != null ? `${t('fmReliabilityLabel')} ${Math.round(plan.model_reliability_pct)}%` : `${t('fmReliabilityLabel')} —%`;

  const profitEl = document.getElementById('aiEstimatedProfit');
  if (profitEl) profitEl.textContent = plan.estimated_profit != null ? fmCurrency(plan.estimated_profit) : '—';
  const riskEl = document.getElementById('aiRiskLevel');
  if (riskEl) riskEl.textContent = plan.risk ? `${t('fmRiskLabel')} ${plan.risk}` : `${t('fmRiskLabel')} —`;

  // Zone ranking list
  const zoneListEl = document.getElementById('aiZoneRankList');
  if (zoneListEl && Array.isArray(data.zone_ranking)) {
    zoneListEl.innerHTML = data.zone_ranking.map((z, i) => `
      <div class="flex items-center justify-between gap-3 p-2.5 rounded-lg ${i === 0 ? 'glass-chip border border-emerald-500/50' : 'glass-chip'}">
        <div class="min-w-0">
          <div class="font-semibold text-slate-100 truncate">${z.zone_name}</div>
          <div class="text-[10px] text-slate-500">${Math.round(z.distance_from_port_km)} km · yield score ${z.zone_yield_score}</div>
        </div>
        <span class="font-mono font-bold ${i === 0 ? 'text-emerald-400' : 'text-cyan-300'} shrink-0">${Math.round(z.potential_score)}</span>
      </div>
    `).join('');
  }

  // Species ranking list
  const speciesListEl = document.getElementById('aiSpeciesRankList');
  if (speciesListEl && Array.isArray(data.species_ranking)) {
    speciesListEl.innerHTML = data.species_ranking.map((s, i) => `
      <div class="flex items-center justify-between gap-3 p-2.5 rounded-lg ${i === 0 ? 'glass-chip border border-emerald-500/50' : 'glass-chip'}">
        <span class="font-semibold text-slate-100">${s.species}</span>
        <span class="font-mono font-bold ${i === 0 ? 'text-emerald-400' : 'text-cyan-300'}">${Math.round(s.score)}</span>
      </div>
    `).join('');
  }

  // Market comparison table
  const marketBodyEl = document.getElementById('aiMarketTableBody');
  if (marketBodyEl && Array.isArray(data.market_comparison)) {
    marketBodyEl.innerHTML = data.market_comparison.map((m, i) => `
      <tr class="border-b border-ocean-800/60 ${i === 0 ? 'text-emerald-400' : 'text-slate-300'}">
        <td class="py-2 px-3 font-semibold">${m.market}</td>
        <td class="py-2 px-3 font-mono">${Math.round(m.distance_km)} km</td>
        <td class="py-2 px-3 font-mono">₹${m.price_per_kg}</td>
        <td class="py-2 px-3 font-mono font-bold">${fmCurrency(m.net_revenue)}</td>
      </tr>
    `).join('');
  }

  // Feature importance (top 6, catch model)
  const featureEl = document.getElementById('aiFeatureImportanceList');
  if (featureEl && data.feature_importance) {
    const top = Object.entries(data.feature_importance)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const maxVal = top.length ? top[0][1] : 1;
    featureEl.innerHTML = top.map(([name, val]) => `
      <div class="space-y-1">
        <div class="flex justify-between">
          <span class="text-slate-300">${name.replace(/__/g, ': ').replace(/_/g, ' ')}</span>
          <span class="text-cyan-300 font-mono">${fmModelPct(val * 100)}</span>
        </div>
        <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
          <div class="h-full rounded-full bg-cyan-500" style="width: ${Math.max(3, (val / maxVal) * 100)}%"></div>
        </div>
      </div>
    `).join('');
  }

  // Why ORCA chose this -- deterministic template sentences from the backend
  const explanationEl = document.getElementById('aiExplanationList');
  if (explanationEl && Array.isArray(data.why_orca_chose_this)) {
    explanationEl.innerHTML = data.why_orca_chose_this.map(s => `<li>${s}</li>`).join('');
  }

  // Model transparency -- real algorithm + validation metrics per model
  const transparencyEl = document.getElementById('aiModelTransparencyList');
  if (transparencyEl && data.model_transparency) {
    transparencyEl.innerHTML = Object.entries(data.model_transparency).map(([name, m]) => {
      const metrics = m.validation_metrics || {};
      const metricsLine = metrics.r2 != null
        ? `R² ${metrics.r2} · MAE ${metrics.mae}`
        : (metrics.f1 != null ? `F1 ${metrics.f1} · Acc ${metrics.accuracy}` : '—');
      return `
        <div class="p-2.5 rounded-lg glass-card space-y-1">
          <div class="text-slate-400 uppercase tracking-wider text-[10px]">${name.replace(/_/g, ' ')}</div>
          <div class="text-slate-200 font-semibold">${m.selected_algorithm || '—'}</div>
          <div class="text-slate-500 font-mono">${metricsLine}</div>
        </div>
      `;
    }).join('');
  }
}

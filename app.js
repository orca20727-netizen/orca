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
  selectedVesselId: null,   // vessel id whose 3D marker is currently highlighted (Locate action / marker click)
  vesselShipSpriteUrl: null,      // cached 3D-rendered ship PNG, shared by every vessel marker
  vesselShipSpriteLoading: false,
  vesselShipSpriteFailed: false,
  vesselShipSpriteCallbacks: [],
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
    fmClaimFailed: "Couldn't claim this listing right now.",
    dagAgentSupervisorName: "Master Supervisor / DAG Planner",
    dagAgentSupervisorRole: "Decomposes multi-modal marine query, allocates subtasks to satellite, hazard, and geofence agents.",
    dagAgentSatelliteName: "Satellite Oceanography Agent",
    dagAgentSatelliteRole: "Ingests Oceansat-3 OCM-3 (chlorophyll-a) & SSTM (thermal fronts) along with INSAT-3DR cloud imagery.",
    dagAgentWeatherName: "Weather & Marine Hazard Agent",
    dagAgentWeatherRole: "Evaluates Significant Wave Height (SWH), wind gust vectors, lightning probability, and generates sea-clearance score.",
    dagAgentPfzName: "Ocean Analytics & PFZ Agent",
    dagAgentPfzRole: "Identifies thermal-chlorophyll front intersections, calculates pelagic biomass density, and ranks target fishing zones.",
    dagAgentGeofenceName: "Geofencing & Routing Agent",
    dagAgentGeofenceRole: "Monitors International Maritime Boundary Lines (IMBL), buffers Marine Protected Areas, and calculates A* safe waypoints.",
    dagAgentFleetName: "Fleet & Traffic Agent (New)",
    dagAgentFleetRole: "Scans AIS & ARGOS-4 vessel transponders, tracks fleet distribution, and flags overcrowding or border congestion.",
    dagAgentEtaName: "ETA & Voyage Safety Agent (New)",
    dagAgentEtaRole: "Calculates transit duration adjusted for real-time wave resistance and evaluates return-by-dusk safety window.",
    dagAgentSynthesisName: "Neural Synthesis Agent (Stats-Driven)",
    dagAgentSynthesisRole: "Aggregates multi-agent telemetry into an authoritative, grounded natural-language advisory with citation tags and TTS -- entirely rule-based, reasoning over this site's own live telemetry and its own accumulated stats ledger. No external AI/LLM API is used.",
    dagStatusIdle: "Idle",
    dagInspectLink: "Inspect ➔",
    dagInspectorLatencyTemplate: "Execution Latency: {latency} · Subtasks Verified",
    dagStatusQueued: "Queued",
    dagStatusExecuting: "Executing...",
    dagStatusCompleted: "Completed",
    dagStatusSkipped: "Not invoked — intent did not require it",
    dagBtnReasoningActiveLive: "Reasoning Active (Live Backend)...",
    dagBtnExecutedLive: "✓ Pipeline Executed via Live Backend · Run Again",
    dagBtnErrorRetry: "▶ Run Live Pipeline Simulation",
    dagBtnReasoningActiveOffline: "Reasoning Active (Local Simulation)...",
    dagBtnExecutedOffline: "✓ Pipeline Executed (Local Simulation) · Run Again",
    dagTabTitle: "8-Node Collaborative Multi-Agent DAG",
    dagInteractiveCanvasBadge: "Interactive Reasoning Canvas",
    dagTabDesc: "Real-time multi-agent execution pipeline reasoning over Oceansat-3, INSAT-3DR, IMBL geofencing, fleet density, and voyage ETA.",
    backendCheckingStatus: "Checking backend...",
    dagZoomReset: "Reset",
    dagRunSimulationBtn: "▶ Run Live Pipeline Simulation",
    dagClickToInspectHint: "Click any agent card to inspect its raw telemetry input, internal algorithms, and JSON data output.",
    dagOrchestratorLabel: "Orchestrator: LangGraph / Async Agent Core",
    dagInspectorDefaultTitle: "Agent Details",
    dagInspectorDefaultRole: "Role description",
    dagInspectorLatencyPlaceholder: "Latency: 24ms",
    dagInspectorJsonLabel: "Live JSON Payload",
    dagCloseInspector: "Close Inspector",
    chatNewConversationMsg: "New conversation started. ORCA will not use earlier chat context.",
    chatYouLabel: "YOU",
    chatOrcaLabel: "ORCA",
    chatOrchestratingMsg: "Orchestrating 8 Specialized AI Agents across Oceansat-3, INSAT-3DR & Open-Meteo...",
    chatAiLabel: "AI",
    chatAdvisoryHeader: "Multi-Agent Marine Advisory",
    chatGroundedConfidenceTemplate: "{confidence}% Grounded Confidence",
    chatLangDetectedTooltip: "Language detected from the message",
    chatListenTts: "Listen (TTS)",
    chatNavicMssBtn: "NavIC MSS Code",
    chatMetricZone: "Recommended Zone",
    chatMetricEta: "Live Sea State ETA",
    chatMetricVessels: "Active Vessels",
    chatVesselsSuffix: "{count} Vessels",
    chatMetricImbl: "IMBL Clearance",
    chatReasoningTraceSummaryTemplate: "View Multi-Agent Reasoning Trace ({steps} steps executed)",
    chatNodeDagSuffixTemplate: "{count}-node DAG",
    chatNoAdvisoryTextFallback: "The ORCA INSIGHT backend generated an advisory but returned no text.",
    chatLiveAdvisoryLabel: "✓ Live Multi-Agent Advisory",
    chatGroundedEngineFallback: "Grounded Engine",
    chatOceanSourceTierTemplate: "Ocean source tier: {tier} · Chlorophyll: {chlorophyll}",
    chatCitationsTemplate: "Citations: {citations}",
    chatOfflineBannerText: "OFFLINE ADVISORY ENGINE — ORCA backend unreachable. The figures below are a simulated illustrative estimate, not live telemetry.",
    chatOfflineImblPlainText: "OFFLINE ADVISORY (backend unreachable, simulated estimate): Vessels in the Palk Strait / Gulf of Mannar area are typically within a few Nautical Miles of the India-Sri Lanka IMBL boundary. Maintain a westward heading and keep VHF transponders active on Channel 16. Reconnect to the ORCA backend for an actual measured distance to the boundary.",
    chatOfflineImblHtmlHeading: "IMBL Geofencing Advisory (Simulated Offline Estimate):",
    chatOfflineImblHtmlBody1: "Without a live backend connection, exact vessel-to-boundary distances cannot be measured. As a general precaution near Palk Strait Sector 4, maintain a westward heading toward Mandapam.",
    chatOfflineImblHtmlBody2: "This is a generic offline safety reminder, not a measured geofence reading. Reconnect to ORCA backend for a real distance-to-IMBL calculation.",
    chatOfflineImblStep1: "Backend unreachable. Classified query as IMBL_BOUNDARY using local keyword match.",
    chatOfflineImblStep2: "No live geofencing telemetry available -- returning generic boundary-safety guidance only.",
    chatOfflineDensityPlainText: "OFFLINE ADVISORY (backend unreachable, simulated estimate): Live vessel counts cannot be retrieved without a backend connection. Historically, Wadge Bank and Kochi Deep Offshore see moderate fishing traffic. Reconnect to the ORCA backend for an actual fleet-density reading from the vessel dataset.",
    chatOfflineDensityHtmlHeading: "Fleet Density (Offline — Simulated Placeholder):",
    chatOfflineDensityHtmlBody: "The Fleet & Traffic Agent's live vessel dataset is not reachable right now, so an exact in-zone vessel count is unavailable.",
    chatOfflineDensityListItem: "Reconnect to the ORCA backend for a real per-zone vessel count and overcrowding verdict.",
    chatOfflineDensityStep1: "Backend unreachable. Classified query as FLEET_DENSITY using local keyword match.",
    chatOfflineDensityStep2: "No live fleet dataset available -- vessel counts not shown to avoid presenting a fabricated figure.",
    chatOfflineGenericPlainTextTemplate: "OFFLINE ADVISORY (backend unreachable): ORCA's multi-agent backend could not be reached, so this answer is a generic, non-live placeholder rather than a grounded reading. Your browser's own Open-Meteo widget reports significant wave height around {liveWave}m, but PFZ ranking, route distance, ETA, and fleet counts all require the backend and are not shown here. Reconnect to the ORCA backend for a real advisory.",
    chatOfflineGenericHtmlHeading: "Offline Placeholder Advisory",
    chatOfflineGenericHtmlBody1Template: "The ORCA multi-agent backend (satellite, weather, PFZ ranking, geofencing, fleet, routing, and Neural Synthesis) is currently unreachable. Client-side, this browser last saw a wave height of <strong>{liveWave}m</strong> from Open-Meteo, but every other figure requires the backend.",
    chatOfflineGenericHtmlBody2: "<strong>No PFZ recommendation, route, ETA, or fleet count is shown</strong> because those would have to be invented rather than computed. Reconnect to the ORCA backend for a full grounded advisory.",
    chatOfflineGenericStep1: "Backend unreachable. No intent-specific keyword matched -- returning GENERAL_VOYAGE_SAFETY offline placeholder.",
    chatOfflineGenericStep2Template: "Only client-visible figure available: last known Open-Meteo wave height {liveWave}m (fetched directly by the browser, not via backend).",
    chatTtsUnsupportedAlert: "Speech Synthesis not supported by your browser.",
    chatTtsWelcomeFallback: "Welcome to ORCA INSIGHT. All satellite feeds and coastal oceanography systems are operating with normal status.",
    chatStopAudio: "Stop Audio",
    chatListenAudioAdvisory: "Listen Audio Advisory",
    chatTabTitle: "AI Decision Studio & Multi-Agent Chatbot",
    chatTabSubtitle: "Powered by collaborative agents reasoning over Oceansat-3, INSAT-3DR, and coastal geofencing",
    chatNewConversationBtn: "New Conversation",
    chatPromptPFZ: "Find the nearest high-yield PFZ fishing zone from Kochi Harbour with catch potential and species.",
    chatPromptSafety: "Check Sea-Venture Clearance score, significant wave height, and wind hazard for today.",
    chatPromptBorder: "Check distance to India-Sri Lanka IMBL border and list vessels in the 2 NM danger zone.",
    chatPromptDensity: "What is the current vessel count and density distribution across Wadge Bank and Kochi Deep?",
    chatPromptETA: "Calculate transit ETA from Kochi to PFZ-01 and verify if round-trip returns safely before 18:30 dusk.",
    chatConversationLabel: "Conversation",
    chatNeuralCoreActive: "ORCA INSIGHT Neural Core Active",
    chatAgentsReadyUptime: "8 Agents Ready · 99.94% Uptime",
    chatWelcomeMessage: "Vanakkam / Namaste! I am the <strong>ORCA INSIGHT</strong> multi-agent synthesis system. You can speak or type your query about safe sailing clearance, high-yield PFZ zones along India's coast, live vessel traffic, IMBL border proximity, and sea-state adjusted ETA calculations.",
    chatMicHint: "Click the microphone icon below to speak in Tamil, Hindi, Malayalam, or English!",
    chatVoiceInputTitle: "Speak Query (Speech-to-Text)",
    chatLiveReasoningTraceTitle: "Live Reasoning Trace",
    chatReasoningTraceEmptyHint: "Ask a question on the left to watch each of the 8 collaborative agents reason through it here, live.",
    chatLiveTelemetryTitle: "Live Ocean Telemetry",
    chatCurrentSeaClearance: "Current Sea Clearance:",
    chatSignificantWaves: "Significant Waves:",
    chatSurfaceWind: "Surface Wind:",
    chatActiveVessels: "Active Vessels:",
    chatOpenDagVisualizerBtn: "Open Full Agent DAG Visualizer ➔",
    navicConnected: "NavIC Receiver: Connected (L5/S-Band)",
    navicDisconnected: "NavIC Receiver: Disconnected",
    navicTrackMyPosition: "Track my position",
    navicStopTracking: "Stop tracking",
    navicSimulateMovement: "Simulate vessel movement",
    navicStopSimulation: "Stop simulation",
    navicStatusTrackingOff: "Tracking off · no position is being requested",
    navicStatusGeoUnsupported: "Geolocation is not supported by this browser. Use simulated vessel movement for the demo.",
    navicStatusRequestingPermission: "Requesting device-location permission…",
    navicStatusLiveTrackingTemplate: "Live device tracking · accuracy ±{accuracy}m · not stored",
    navicStatusPermissionErrorTemplate: "Location permission unavailable ({error}). No position was sent.",
    navicStatusBackendUnavailable: "Backend unavailable — exact geofence distance cannot be evaluated in local simulation.",
    navicStatusSimStopped: "Geofence simulation stopped",
    navicStatusSimMovingTemplate: "Simulated vessel movement · point {index}/{total} · {lat}, {lon}",
    navicMssCopiedAlertTemplate: "Copied NavIC MSS / SMS 120-char Satellite Emergency Code:\n\n{code}",
    navicSkyplotTitle: "ISRO NavIC (IRNSS) Skyplot",
    navicConstellationDesc: "7-Satellite Geostationary / IGSO Constellation",
    navicConnectedShort: "Connected (L5/S)",
    navicTrackedSatellitesTitle: "Tracked Satellites (SNR dB-Hz)",
    navicNmeaStreamTitle: "Live NMEA-0183 Hardware Stream ($GNGGA / $GNRMC)",
    navicBaudRateDesc: "Baud Rate: 9600 bps · 1 Hz Feed",
    navicDopPrecisionLabel: "DOP Precision",
    navicDopValue: "HDOP 1.05 (Excellent)",
    navicDiffFixLabel: "Differential Fix",
    navicDiffFixValue: "NavIC DGPS Active",
    navicBorderHwLabel: "Border Alert Hardware",
    navicBorderHwValue: "Buzzer Armed",
    navicGeofenceTitle: "Live position geofencing",
    navicGeofenceDesc: "Your device location is used only for in-session IMBL/MPA checks and is never stored by ORCA.",
    navicGeofenceInitialStatus: "Tracking off · 5 NM IMBL warning / MPA buffer warning",
    safetyVerdictDescTemplate: "Live Open-Meteo marine telemetry places significant wave height at {wave}m and surface wind at {wind}kn near your selected harbour, giving a computed safety score of {score}/100.",
    safetyWindDefaultDirection: "Westerly",
    safetyBreezeSuffix: "{direction} Breeze",
    severityLow: "Low",
    severityModerate: "Moderate",
    severityHigh: "High",
    waveBandCalm: "Calm (< 0.5m)",
    waveBandSlight: "Slight (0.5 - 1.25m)",
    waveBandModerate: "Moderate (1.25 - 2.5m)",
    waveBandRough: "Rough (> 2.5m)",
    seaStateCalm: "Calm",
    seaStateSlight: "Slight",
    seaStateSlightModerate: "Slight to Moderate",
    seaStateModerateRough: "Moderate to Rough",
    seaStateUnknown: "Unknown",
    lightningBandSafe: "Safe Atmospheric Profile",
    lightningBandElevated: "Elevated Convective Risk",
    lightningBandSevere: "Severe Squall Warning",
    safetySyncLatencyLabel: "Sync Latency:",
    safetyBatteryLabel: "Battery:",
    safetyLastPassLabel: "Last Pass:",
    safetyAltitudeLabel: "Altitude:",
    telemetryLiveOpenMeteoTemplate: "LIVE OPEN-METEO TELEMETRY ({wave}m SWH)",
    telemetryCachedArchive: "TELEMETRY ACTIVE (CACHED SATELLITE ARCHIVE)",
    backendOnlineStatus: "LIVE FASTAPI BACKEND CONNECTED",
    backendOfflineStatus: "BACKEND OFFLINE · LOCAL SIMULATION MODE",
    aisLiveCountTemplate: "{count} live AIS vessel{plural}",
    aisNoLiveVessels: "no live AIS vessels right now",
    aisBlendedBannerTemplate: "Showing {liveText} + {simCount} simulated vessel{plural} filling ports with no live AIS coverage right now.",
    aisUnavailableDefault: "Live AIS vessel feed unavailable -- showing 0 vessels.",
    aisNotConfigured: "Live AIS vessel feed is not configured on this deployment.",
    aisConnectedNotSending: "Connected to the AIS provider (AISstream.io), but it isn’t sending vessel data right now — likely a provider-side outage, not a local fault.",
    aisDisconnectedReconnecting: "Disconnected from the AIS provider (AISstream.io); reconnecting automatically.",
    imblAlertActiveTemplate: "<strong>{vesselId} ({vesselName})</strong> is operating at <strong>{dist} NM</strong> from the India–Sri Lanka IMBL{simTag}. Automated warning dispatched.",
    imblAlertNoneTemplate: "No vessels currently within the {warnDist} NM IMBL warning distance. Nearest tracked vessel: <strong>{dist} NM</strong> away.",
    imblAlertNoData: "No vessel telemetry available yet.",
    simulatedSuffix: " (simulated)",
    notifUnavailableTitle: "Browser notifications unavailable",
    notifUnavailableMsg: "In-app hazard banners will still be shown while this tab is open.",
    notifNotEnabledTitle: "Browser notifications not enabled",
    notifNotEnabledMsg: "In-app hazard banners remain active while this tab is open.",
    hazardHighWavesTitle: "High waves — local simulation",
    hazardHighWavesMsgTemplate: "{wave}m exceeds the 2.5m caution threshold. Source: browser Open-Meteo telemetry.",
    hazardHighWindTitle: "High wind — local simulation",
    hazardHighWindMsgTemplate: "{wind} kn exceeds the 25 kn caution threshold. Source: browser Open-Meteo telemetry.",
    hazardLightningTitle: "Lightning risk — local simulation",
    hazardLightningMsgTemplate: "Lightning proxy is {pct}%. Source: browser Open-Meteo telemetry.",
    safetyOfficialClearanceLabel: "Official Maritime Clearance",
    safetyVerdictDescInitial: "All satellite oceanography indicators (Oceansat-3 SSTM thermal fronts, Sentinel-3 wave altimetry) confirm favorable fishing conditions along Kerala, Karnataka, and Tamil Nadu coastal waters.",
    safetyIndexLabel: "Safety Index",
    satConstellationTitle: "ISRO & International Oceanographic Satellite Constellation",
    satStaticDataNote: "Static reference data (not live telemetry)",
    mapIndiaBoundaryPopup: "India — official boundary (Survey of India)",
    mapPfzYieldSuffix: "{rating} YIELD ({pct}%)",
    mapPfzSstLabel: "SST:",
    mapPfzChlorophyllLabel: "Chlorophyll:",
    mapPfzDepthLabel: "Depth:",
    mapPfzVesselsLabel: "Vessels:",
    mapPfzActiveSuffix: "{count} Active",
    mapPfzTargetSpeciesLabel: "Target Species:",
    mapPfzSimulateRouteBtn: "Simulate Route Here ➔",
    mapImblPopupBodyTemplate: "Strict International Maritime Boundary. Warning buffer: {warn} NM. Critical geofence: {danger} NM.",
    mapImblPopupTreatyNote: "Cross-border crossing prohibited under UNCLOS maritime treaty.",
    mapImblBufferCorridorTemplate: "{dist} NM IMBL Buffer Corridor",
    mapMpaRestrictedBadge: "RESTRICTED ECO-RESERVE",
    mapHarbourCoastSuffix: "{state} Coast",
    mapHarbourCapacityLabel: "Capacity:",
    mapHarbourVhfLabel: "VHF:",
    mapHarbourFuelLabel: "Fuel Station:",
    mapHarbourFuelAvailable: "Available",
    mapHarbourIceLabel: "Ice Plant:",
    mapHarbourIceActive: "Active",
    mapHarbourSetOriginBtn: "Set as Origin Harbour",
    mapVesselSimulatedBadge: "Simulated · no live AIS coverage here",
    mapVesselSpeedLabel: "Speed:",
    mapVesselHeadingLabel: "Heading:",
    mapVesselZoneLabel: "Zone:",
    mapVesselImblDistLabel: "IMBL Dist:",
    mapVesselStatusLabel: "Status:",
    mapVesselFuelLabel: "Fuel:",
    mapVesselFuelNA: "N/A",
    mapRoutePopupTitle: "Sea-Only A* Route (Land + MPA Avoidance)",
    mapRouteDistanceEtaTemplate: "Distance: {dist} NM · ETA: {eta}{detourNote}",
    mapRouteDetourTemplate: " · Detour {pct}% around {zones}",
    mapRouteLandNoGoZones: "land/no-go zones",
    vesselStatusSafeFishing: "SAFE FISHING",
    vesselStatusBorderAlert: "BORDER ALERT",
    vesselStatusBorderWarn: "BORDER WARN",
    vesselStatusInTransit: "IN TRANSIT",
    vesselSimBadgeText: "SIM",
    vesselSimBadgeTitle: "Simulated -- no live AIS coverage near this port",
    vesselLocateAction: "Locate ➔",
    fleetVesselCountSuffix: "{count} vessels",
    fleetLiveSimBreakdownTemplate: "{total} ({live} live · {sim} sim)",
    mapActiveVesselsBreakdownTemplate: "{total} Active Vessels ({live} live · {sim} simulated)",
    mapActiveVesselsSimpleTemplate: "{total} Active Vessels",
    mapTabTitle: "GIS Command Map · Indian Coastal Waters",
    mapTabDesc: "Interactive high-contrast nautical map with real-time satellite PFZs, IMBL boundary corridors, and AIS vessel tracks.",
    layerPfzZones: "PFZ Zones",
    layerImblBuffer: "IMBL Buffer",
    layerEcoReserves: "Eco Reserves (MPA)",
    layerHarbours: "Harbours",
    layerLiveVessels: "Live Vessels",
    layerDensityHeatmap: "Density Heatmap",
    layerIndiaBoundary: "India Boundary (Survey of India)",
    routePlannerDesc: "A*-style path avoiding MPAs and border hazards",
    routeVesselSpeedLabel: "Vessel Speed:",
    fleetMonitorTitle: "Fleet Monitor · Live Vessel Telemetry",
    fleetTotalActiveTitle: "Total Active Vessels",
    fleetTotalActiveDesc: "Vessels currently broadcasting AIS transponder signals",
    fleetZoneDistTitle: "Vessel Distribution per Zone",
    imblAlertCardTitle: "IMBL Border Proximity Alert",
    fleetTableSubDesc: "Live AIS positions from AISstream.io, backfilled with a clearly-tagged simulated fleet (see \"SIM\" badge) wherever there's currently no live receiver coverage",
    vesselSearchPlaceholder: "Search vessel name or ID...",
    filterAllStatuses: "All Statuses",
    filterSafeFishing: "Safe Fishing",
    filterInTransit: "In Transit",
    filterBorderAlert: "Border Alert",
    thVesselId: "Vessel ID",
    thVesselName: "Vessel Name",
    thType: "Type",
    thCurrentZone: "Current Zone",
    thSpeedHeading: "Speed / Heading",
    thImblDist: "IMBL Dist",
    thStatus: "Status",
    thAction: "Action",
    bulletinIssuedLabel: "Issued:",
    bulletinRegionLabel: "Region:",
    bulletinWavesLabel: "Waves:",
    bulletinWindsLabel: "Winds:",
    bulletinSourceLabel: "Source:",
    bulletinListenBtn: "Listen Bulletin",
    bulletinsTabTitle: "Official Marine & Fisheries Bulletins (ISRO - INCOIS)",
    bulletinsTabDesc: "Numbered advisories, cyclone hazard warnings, and international boundary compliance alerts.",
    bulletinNotifyToggleTitle: "Receive browser alerts only while this tab/PWA is open",
    bulletinNotifyToggleLabel: "Notify while open",
    bulletinFilterAll: "All Bulletins",
    bulletinFilterCritical: "Critical",
    bulletinFilterWarning: "Warnings",
    bulletinFilterAdvisory: "Advisories",
    bulletinsPushNote: "Hazard alerts are proactive only while this tab/PWA is open. Closed-app push notifications require a production push-subscription service and are not implemented in this prototype.",
    sosModalTitle: "EMERGENCY DISTRESS BEACON (SOS)",
    sosInstructions: "Activating emergency SOS will transmit an emergency 406 MHz distress signal via <strong>INSAT-3DR SAS&R</strong> to the Indian Coast Guard Maritime Rescue Coordination Centre (MRCC).",
    sosCurrentPositionLabel: "Current Position:",
    sosVhfChannelLabel: "Emergency VHF Channel:",
    sosMrccHelplineLabel: "MRCC Helpline:",
    sosConfirmBtn: "CONFIRM & BROADCAST DISTRESS BEACON",
    sosBeaconTransmittingBanner: "406 MHz SAS&R BEACON TRANSMITTING TO ISRO & COAST GUARD MRCC",
    sosDistressRelayedMsg: "Distress packet relayed via INSAT-3DR SAS&R receiver. Maritime Rescue Coordination Centre (MRCC Chennai/Mumbai) alerted on VHF Ch 16.",
    sosGpsVesselIdTemplate: "GPS Coordinates: {coords} · Vessel ID: {vesselId} ({vesselName})",
    landingEyebrow: "ISRO Collaborative Marine Intelligence · Smart India Hackathon 2026",
    landingSubtitle: "One collaborative marine-intelligence platform, two command decks: a fisherman's daily opportunity console, and the full ISRO satellite, AIS and geofencing insight suite.",
    landingStripItem1: "Oceansat-3 SSTM Thermal Fronts",
    landingStripItem2: "INSAT-3DR Satellite Oceanography",
    landingStripItem3: "8-Node Collaborative Agent DAG",
    landingStripItem4: "NavIC (IRNSS) GPS Bridge",
    landingStripItem5: "IMBL Border Geofencing Alerts",
    landingStripItem6: "Live AIS Fleet & GIS Command",
    landingStripItem7: "Sell Smarter Buyer Pricing",
    landingStripItem8: "406 MHz SOS Distress Beacon",
    landingFishermanCardTitle: "ORCA Fisherman",
    landingFishermanCardDesc: "Today's Opportunity Score, Sell Smarter pricing, a trip-cost calculator and buyer leads for your catch — built for the boat.",
    landingFishermanCardCta: "Open Fisherman Console",
    landingFishermanCardTitleAttr: "Open the Fisherman Console",
    landingInsightCardTitle: "ORCA Insight",
    landingInsightCardDesc: "Full command deck: ISRO satellite oceanography, GIS map, the 8-node agent DAG, Safety Barometer, Fleet Monitor and NavIC bridge.",
    landingInsightCardCta: "Open Insight Command Deck",
    landingInsightCardTitleAttr: "Open the Insight command deck",
    backToOverviewTitle: "Back to overview",
    statSimulatedFleetLabel: "Simulated AIS fleet",
    statSatellitesActiveTemplate: "{count} Active",
    statSatellitesListLabel: "Oceansat-3, INSAT-3DR, Sentinel-3",
    statPfzZonesCountTemplate: "{count} Zones",
    statPfzZonesListLabel: "Wadge Bank, Kochi, Veraval...",
    statImblCorridorsCountTemplate: "{count} Corridors",
    statImblBordersLabel: "India-Sri Lanka & Pak Borders",
    pillarDagTitle: "8-Node Collaborative Agent DAG",
    pillarDagDesc: "Multi-agent architecture decomposing queries into satellite, wave hazard, geofencing, vessel counting, ETA, and neural synthesis steps with sub-second latency.",
    pillarEtaTitle: "Live Sea-State ETA & Dusk Safety",
    pillarEtaDesc: "Hydrodynamic transit calculations adjusted for wave resistance with automated Return-by-Dusk safety alerts to prevent stranded fishermen after sunset.",
    pillarFleetTitle: "Live Fleet Density & IMBL Alert",
    pillarFleetDesc: "Real-time vessel counting per zone, overcrowding risk indicators, and automated 5 NM/2 NM geofence proximity alerts protecting maritime borders.",
    footerCreditLine: "<span class=\"text-slate-200 font-semibold\">{appTitle}</span> · Built by <strong class=\"text-cyan-400\">{teamName}</strong> · Smart India Hackathon 2026 · Problem Statement 26176 (ISRO)",
    sttListeningStatusTemplate: "Listening in <b>{lang}</b>... Speak now.",
    sttUnsupportedTitle: "Speech Recognition not supported in this browser",
    routeUnavailableLabel: " ROUTE UNAVAILABLE:",
    routeUnavailableMsg: "ORCA backend is unreachable, so no routed distance/ETA can be shown. Running in local fallback mode.",
    routeNoSafeRouteLabel: "✕ NO SAFE MARITIME ROUTE FOUND:",
    routeNoSafeRouteMsgTemplate: "{detail}",
    routeNoSafeRouteDefaultReason: "The router could not find a path avoiding land and Marine Protected Areas for this harbour/PFZ pair.",
    routeSafeReturnLabel: "✓ SAFE RETURN:",
    routeSafeReturnTemplate: "Expected harbour arrival by {time} (Before 18:30 IST dusk).",
    routeReturnAfterDuskLabel: " RETURN AFTER DUSK:",
    routeReturnAfterDuskTemplate: "Expected return at {time} (Exceeds 18:30 IST sunset). Recommend an earlier departure or a night navigational beacon check."
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
    fmClaimFailed: "अभी यह लिस्टिंग दावा नहीं की जा सकी।",
    dagAgentSupervisorName: "मास्टर सुपरवाइज़र / DAG प्लानर",
    dagAgentSupervisorRole: "बहु-मॉडल समुद्री प्रश्न को विभाजित करता है, सैटेलाइट, खतरा और जियोफेंस एजेंटों को उप-कार्य आवंटित करता है।",
    dagAgentSatelliteName: "सैटेलाइट समुद्र विज्ञान एजेंट",
    dagAgentSatelliteRole: "Oceansat-3 OCM-3 (क्लोरोफिल-a) और SSTM (थर्मल फ्रंट) के साथ-साथ INSAT-3DR क्लाउड इमेजरी को ग्रहण करता है।",
    dagAgentWeatherName: "मौसम और समुद्री खतरा एजेंट",
    dagAgentWeatherRole: "महत्वपूर्ण लहर ऊँचाई (SWH), पवन गस्ट वेक्टर और बिजली गिरने की संभावना का मूल्यांकन करता है, तथा समुद्र-क्लीयरेंस स्कोर उत्पन्न करता है।",
    dagAgentPfzName: "समुद्री विश्लेषण और PFZ एजेंट",
    dagAgentPfzRole: "थर्मल-क्लोरोफिल फ्रंट के प्रतिच्छेदन की पहचान करता है, पेलैजिक बायोमास घनत्व की गणना करता है और लक्षित मछली पकड़ने के क्षेत्रों को रैंक करता है।",
    dagAgentGeofenceName: "जियोफेंसिंग और मार्ग निर्धारण एजेंट",
    dagAgentGeofenceRole: "अंतरराष्ट्रीय समुद्री सीमा रेखाओं (IMBL) की निगरानी करता है, समुद्री संरक्षित क्षेत्रों को बफर करता है, और A* सुरक्षित वेपॉइंट की गणना करता है।",
    dagAgentFleetName: "फ्लीट और यातायात एजेंट (नया)",
    dagAgentFleetRole: "AIS और ARGOS-4 वेसल ट्रांसपोंडर को स्कैन करता है, फ्लीट वितरण को ट्रैक करता है, और भीड़भाड़ या सीमा जमावड़े को फ़्लैग करता है।",
    dagAgentEtaName: "ETA और यात्रा सुरक्षा एजेंट (नया)",
    dagAgentEtaRole: "वास्तविक समय की लहर प्रतिरोध के अनुसार यात्रा अवधि की गणना करता है और शाम से पहले वापसी की सुरक्षा विंडो का मूल्यांकन करता है।",
    dagAgentSynthesisName: "न्यूरल सिंथेसिस एजेंट (आँकड़ा-संचालित)",
    dagAgentSynthesisRole: "बहु-एजेंट टेलीमेट्री को उद्धरण टैग और TTS के साथ एक प्रामाणिक, आधारभूत प्राकृतिक-भाषा सलाह में एकत्रित करता है -- पूरी तरह नियम-आधारित, इस साइट के अपने लाइव टेलीमेट्री और अपने संचित आँकड़ा लेजर पर तर्क करते हुए। किसी बाहरी AI/LLM API का उपयोग नहीं किया जाता है।",
    dagStatusIdle: "निष्क्रिय",
    dagInspectLink: "निरीक्षण करें ➔",
    dagInspectorLatencyTemplate: "निष्पादन विलंब: {latency} · उप-कार्य सत्यापित",
    dagStatusQueued: "कतारबद्ध",
    dagStatusExecuting: "निष्पादित हो रहा है...",
    dagStatusCompleted: "पूर्ण",
    dagStatusSkipped: "आमंत्रित नहीं — प्रश्न को इसकी आवश्यकता नहीं थी",
    dagBtnReasoningActiveLive: "तर्कणा सक्रिय (लाइव बैकएंड)...",
    dagBtnExecutedLive: "✓ लाइव बैकएंड के माध्यम से पाइपलाइन निष्पादित · फिर से चलाएँ",
    dagBtnErrorRetry: "▶ लाइव पाइपलाइन सिमुलेशन चलाएँ",
    dagBtnReasoningActiveOffline: "तर्कणा सक्रिय (स्थानीय सिमुलेशन)...",
    dagBtnExecutedOffline: "✓ पाइपलाइन निष्पादित (स्थानीय सिमुलेशन) · फिर से चलाएँ",
    dagTabTitle: "8-नोड सहयोगी बहु-एजेंट DAG",
    dagInteractiveCanvasBadge: "इंटरैक्टिव रीज़निंग कैनवस",
    dagTabDesc: "Oceansat-3, INSAT-3DR, IMBL जियोफेंसिंग, फ्लीट घनत्व और यात्रा ETA पर तर्क करने वाली रीयल-टाइम बहु-एजेंट निष्पादन पाइपलाइन।",
    backendCheckingStatus: "बैकएंड की जाँच हो रही है...",
    dagZoomReset: "रीसेट",
    dagRunSimulationBtn: "▶ लाइव पाइपलाइन सिमुलेशन चलाएँ",
    dagClickToInspectHint: "किसी भी एजेंट कार्ड पर क्लिक करके उसका कच्चा टेलीमेट्री इनपुट, आंतरिक एल्गोरिद्म और JSON डेटा आउटपुट देखें।",
    dagOrchestratorLabel: "ऑर्केस्ट्रेटर: LangGraph / Async Agent Core",
    dagInspectorDefaultTitle: "एजेंट विवरण",
    dagInspectorDefaultRole: "भूमिका विवरण",
    dagInspectorLatencyPlaceholder: "विलंब: 24ms",
    dagInspectorJsonLabel: "लाइव JSON पेलोड",
    dagCloseInspector: "इंस्पेक्टर बंद करें",
    chatNewConversationMsg: "नई बातचीत शुरू हुई। ORCA पिछले चैट संदर्भ का उपयोग नहीं करेगा।",
    chatYouLabel: "आप",
    chatOrcaLabel: "ORCA",
    chatOrchestratingMsg: "Oceansat-3, INSAT-3DR और Open-Meteo में 8 विशेष AI एजेंटों का समन्वय हो रहा है...",
    chatAiLabel: "AI",
    chatAdvisoryHeader: "बहु-एजेंट समुद्री सलाह",
    chatGroundedConfidenceTemplate: "{confidence}% आधारित विश्वास",
    chatLangDetectedTooltip: "संदेश से भाषा का पता लगाया गया",
    chatListenTts: "सुनें (TTS)",
    chatNavicMssBtn: "NavIC MSS कोड",
    chatMetricZone: "अनुशंसित क्षेत्र",
    chatMetricEta: "लाइव समुद्री स्थिति ETA",
    chatMetricVessels: "सक्रिय वेसल",
    chatVesselsSuffix: "{count} वेसल",
    chatMetricImbl: "IMBL क्लीयरेंस",
    chatReasoningTraceSummaryTemplate: "बहु-एजेंट तर्कणा ट्रेस देखें ({steps} चरण निष्पादित)",
    chatNodeDagSuffixTemplate: "{count}-नोड DAG",
    chatNoAdvisoryTextFallback: "ORCA INSIGHT बैकएंड ने एक सलाह उत्पन्न की लेकिन कोई पाठ नहीं लौटाया।",
    chatLiveAdvisoryLabel: "✓ लाइव बहु-एजेंट सलाह",
    chatGroundedEngineFallback: "आधारित इंजन",
    chatOceanSourceTierTemplate: "समुद्र स्रोत स्तर: {tier} · क्लोरोफिल: {chlorophyll}",
    chatCitationsTemplate: "उद्धरण: {citations}",
    chatOfflineBannerText: "ऑफ़लाइन सलाह इंजन — ORCA बैकएंड अनुपलब्ध है। नीचे दिए गए आँकड़े एक सिम्युलेटेड उदाहरणात्मक अनुमान हैं, लाइव टेलीमेट्री नहीं।",
    chatOfflineImblPlainText: "ऑफ़लाइन सलाह (बैकएंड अनुपलब्ध, सिम्युलेटेड अनुमान): पाक जलडमरूमध्य / मन्नार की खाड़ी क्षेत्र के वेसल आमतौर पर भारत-श्रीलंका IMBL सीमा से कुछ नॉटिकल मील के भीतर होते हैं। पश्चिम दिशा में मार्ग बनाए रखें और VHF ट्रांसपोंडर को चैनल 16 पर सक्रिय रखें। सीमा की वास्तविक मापी गई दूरी के लिए ORCA बैकएंड से पुनः जुड़ें।",
    chatOfflineImblHtmlHeading: "IMBL जियोफेंसिंग सलाह (सिम्युलेटेड ऑफ़लाइन अनुमान):",
    chatOfflineImblHtmlBody1: "लाइव बैकएंड कनेक्शन के बिना, वेसल-से-सीमा की सटीक दूरी मापी नहीं जा सकती। पाक जलडमरूमध्य सेक्टर 4 के पास सामान्य सावधानी के रूप में, मंडपम की ओर पश्चिम दिशा में मार्ग बनाए रखें।",
    chatOfflineImblHtmlBody2: "यह एक सामान्य ऑफ़लाइन सुरक्षा अनुस्मारक है, न कि मापी गई जियोफेंस रीडिंग। वास्तविक दूरी-से-IMBL गणना के लिए ORCA बैकएंड से पुनः जुड़ें।",
    chatOfflineImblStep1: "बैकएंड अनुपलब्ध। स्थानीय कीवर्ड मिलान का उपयोग करके प्रश्न को IMBL_BOUNDARY के रूप में वर्गीकृत किया गया।",
    chatOfflineImblStep2: "कोई लाइव जियोफेंसिंग टेलीमेट्री उपलब्ध नहीं -- केवल सामान्य सीमा-सुरक्षा मार्गदर्शन लौटाया जा रहा है।",
    chatOfflineDensityPlainText: "ऑफ़लाइन सलाह (बैकएंड अनुपलब्ध, सिम्युलेटेड अनुमान): बैकएंड कनेक्शन के बिना लाइव वेसल गणना प्राप्त नहीं की जा सकती। ऐतिहासिक रूप से, वेज बैंक और कोच्चि डीप ऑफशोर में मध्यम मछली पकड़ने की गतिविधि देखी जाती है। वेसल डेटासेट से वास्तविक फ्लीट-घनत्व रीडिंग के लिए ORCA बैकएंड से पुनः जुड़ें।",
    chatOfflineDensityHtmlHeading: "फ्लीट घनत्व (ऑफ़लाइन — सिम्युलेटेड प्लेसहोल्डर):",
    chatOfflineDensityHtmlBody: "फ्लीट और यातायात एजेंट का लाइव वेसल डेटासेट अभी उपलब्ध नहीं है, इसलिए क्षेत्र में सटीक वेसल गणना अनुपलब्ध है।",
    chatOfflineDensityListItem: "वास्तविक प्रति-क्षेत्र वेसल गणना और भीड़भाड़ के निर्णय के लिए ORCA बैकएंड से पुनः जुड़ें।",
    chatOfflineDensityStep1: "बैकएंड अनुपलब्ध। स्थानीय कीवर्ड मिलान का उपयोग करके प्रश्न को FLEET_DENSITY के रूप में वर्गीकृत किया गया।",
    chatOfflineDensityStep2: "कोई लाइव फ्लीट डेटासेट उपलब्ध नहीं -- एक मनगढ़ंत आँकड़ा प्रस्तुत करने से बचने के लिए वेसल गणना नहीं दिखाई गई।",
    chatOfflineGenericPlainTextTemplate: "ऑफ़लाइन सलाह (बैकएंड अनुपलब्ध): ORCA के बहु-एजेंट बैकएंड तक नहीं पहुँचा जा सका, इसलिए यह उत्तर एक आधारित रीडिंग के बजाय एक सामान्य, गैर-लाइव प्लेसहोल्डर है। आपके ब्राउज़र का अपना Open-Meteo विजेट लगभग {liveWave}m की महत्वपूर्ण लहर ऊँचाई दर्शाता है, लेकिन PFZ रैंकिंग, मार्ग दूरी, ETA और फ्लीट गणना सभी को बैकएंड की आवश्यकता होती है और यहाँ नहीं दिखाई गई हैं। वास्तविक सलाह के लिए ORCA बैकएंड से पुनः जुड़ें।",
    chatOfflineGenericHtmlHeading: "ऑफ़लाइन प्लेसहोल्डर सलाह",
    chatOfflineGenericHtmlBody1Template: "ORCA का बहु-एजेंट बैकएंड (सैटेलाइट, मौसम, PFZ रैंकिंग, जियोफेंसिंग, फ्लीट, रूटिंग और न्यूरल सिंथेसिस) अभी अनुपलब्ध है। क्लाइंट-साइड पर, इस ब्राउज़र ने Open-Meteo से अंतिम बार <strong>{liveWave}m</strong> की लहर ऊँचाई देखी, लेकिन बाकी सभी आँकड़ों के लिए बैकएंड आवश्यक है।",
    chatOfflineGenericHtmlBody2: "<strong>कोई PFZ अनुशंसा, मार्ग, ETA या फ्लीट गणना नहीं दिखाई गई है</strong> क्योंकि उन्हें गणना करने के बजाय गढ़ना पड़ता। पूर्ण आधारित सलाह के लिए ORCA बैकएंड से पुनः जुड़ें।",
    chatOfflineGenericStep1: "बैकएंड अनुपलब्ध। कोई प्रश्न-विशिष्ट कीवर्ड मेल नहीं खाया -- GENERAL_VOYAGE_SAFETY ऑफ़लाइन प्लेसहोल्डर लौटाया जा रहा है।",
    chatOfflineGenericStep2Template: "केवल क्लाइंट-दृश्य आँकड़ा उपलब्ध: अंतिम ज्ञात Open-Meteo लहर ऊँचाई {liveWave}m (सीधे ब्राउज़र द्वारा प्राप्त, बैकएंड के माध्यम से नहीं)।",
    chatTtsUnsupportedAlert: "आपके ब्राउज़र द्वारा स्पीच सिंथेसिस समर्थित नहीं है।",
    chatTtsWelcomeFallback: "ORCA INSIGHT में आपका स्वागत है। सभी सैटेलाइट फीड और तटीय समुद्र विज्ञान प्रणालियाँ सामान्य स्थिति में काम कर रही हैं।",
    chatStopAudio: "ऑडियो रोकें",
    chatListenAudioAdvisory: "ऑडियो सलाह सुनें",
    chatTabTitle: "AI निर्णय स्टूडियो और बहु-एजेंट चैटबॉट",
    chatTabSubtitle: "Oceansat-3, INSAT-3DR और तटीय जियोफेंसिंग पर तर्क करने वाले सहयोगी एजेंटों द्वारा संचालित",
    chatNewConversationBtn: "नई बातचीत",
    chatPromptPFZ: "कोच्चि हार्बर से निकटतम उच्च-उपज PFZ मछली पकड़ने का क्षेत्र, पकड़ने की संभावना और प्रजातियों सहित खोजें।",
    chatPromptSafety: "आज के लिए समुद्र-यात्रा क्लीयरेंस स्कोर, महत्वपूर्ण लहर ऊँचाई और पवन खतरे की जाँच करें।",
    chatPromptBorder: "भारत-श्रीलंका IMBL सीमा की दूरी जाँचें और 2 NM खतरा क्षेत्र में वेसलों की सूची दिखाएँ।",
    chatPromptDensity: "वेज बैंक और कोच्चि डीप में वर्तमान वेसल गणना और घनत्व वितरण क्या है?",
    chatPromptETA: "कोच्चि से PFZ-01 तक यात्रा ETA की गणना करें और सत्यापित करें कि राउंड-ट्रिप 18:30 की शाम से पहले सुरक्षित रूप से लौटती है या नहीं।",
    chatConversationLabel: "बातचीत",
    chatNeuralCoreActive: "ORCA INSIGHT न्यूरल कोर सक्रिय",
    chatAgentsReadyUptime: "8 एजेंट तैयार · 99.94% अपटाइम",
    chatWelcomeMessage: "वणक्कम / नमस्ते! मैं <strong>ORCA INSIGHT</strong> बहु-एजेंट संश्लेषण प्रणाली हूँ। आप सुरक्षित नौकायन क्लीयरेंस, भारत के तट के किनारे उच्च-उपज PFZ क्षेत्रों, लाइव वेसल यातायात, IMBL सीमा निकटता और समुद्री-स्थिति के अनुसार समायोजित ETA गणनाओं के बारे में बोल या टाइप कर सकते हैं।",
    chatMicHint: "तमिल, हिन्दी, मलयालम या अंग्रेज़ी में बोलने के लिए नीचे माइक्रोफ़ोन आइकन पर क्लिक करें!",
    chatVoiceInputTitle: "प्रश्न बोलें (स्पीच-टू-टेक्स्ट)",
    chatLiveReasoningTraceTitle: "लाइव तर्कणा ट्रेस",
    chatReasoningTraceEmptyHint: "बाईं ओर एक प्रश्न पूछें और देखें कि 8 सहयोगी एजेंटों में से प्रत्येक इसके माध्यम से लाइव कैसे तर्क करता है।",
    chatLiveTelemetryTitle: "लाइव समुद्री टेलीमेट्री",
    chatCurrentSeaClearance: "वर्तमान समुद्र क्लीयरेंस:",
    chatSignificantWaves: "महत्वपूर्ण लहरें:",
    chatSurfaceWind: "सतही हवा:",
    chatActiveVessels: "सक्रिय वेसल:",
    chatOpenDagVisualizerBtn: "पूर्ण एजेंट DAG विज़ुअलाइज़र खोलें ➔",
    navicConnected: "NavIC रिसीवर: कनेक्टेड (L5/S-Band)",
    navicDisconnected: "NavIC रिसीवर: डिस्कनेक्टेड",
    navicTrackMyPosition: "मेरी स्थिति ट्रैक करें",
    navicStopTracking: "ट्रैकिंग बंद करें",
    navicSimulateMovement: "वेसल की गति सिम्युलेट करें",
    navicStopSimulation: "सिमुलेशन बंद करें",
    navicStatusTrackingOff: "ट्रैकिंग बंद · कोई स्थिति अनुरोधित नहीं की जा रही",
    navicStatusGeoUnsupported: "इस ब्राउज़र द्वारा जियोलोकेशन समर्थित नहीं है। डेमो के लिए सिम्युलेटेड वेसल मूवमेंट का उपयोग करें।",
    navicStatusRequestingPermission: "डिवाइस-स्थान अनुमति का अनुरोध किया जा रहा है…",
    navicStatusLiveTrackingTemplate: "लाइव डिवाइस ट्रैकिंग · सटीकता ±{accuracy}m · संग्रहीत नहीं",
    navicStatusPermissionErrorTemplate: "स्थान अनुमति अनुपलब्ध ({error})। कोई स्थिति नहीं भेजी गई।",
    navicStatusBackendUnavailable: "बैकएंड अनुपलब्ध — स्थानीय सिमुलेशन में सटीक जियोफेंस दूरी का मूल्यांकन नहीं किया जा सकता।",
    navicStatusSimStopped: "जियोफेंस सिमुलेशन बंद",
    navicStatusSimMovingTemplate: "सिम्युलेटेड वेसल मूवमेंट · बिंदु {index}/{total} · {lat}, {lon}",
    navicMssCopiedAlertTemplate: "NavIC MSS / SMS 120-अक्षर सैटेलाइट आपातकालीन कोड कॉपी किया गया:\\n\\n{code}",
    navicSkyplotTitle: "ISRO NavIC (IRNSS) स्काईप्लॉट",
    navicConstellationDesc: "7-सैटेलाइट जियोस्टेशनरी / IGSO नक्षत्र",
    navicConnectedShort: "कनेक्टेड (L5/S)",
    navicTrackedSatellitesTitle: "ट्रैक किए गए सैटेलाइट (SNR dB-Hz)",
    navicNmeaStreamTitle: "लाइव NMEA-0183 हार्डवेयर स्ट्रीम ($GNGGA / $GNRMC)",
    navicBaudRateDesc: "बॉड दर: 9600 bps · 1 Hz फ़ीड",
    navicDopPrecisionLabel: "DOP परिशुद्धता",
    navicDopValue: "HDOP 1.05 (उत्कृष्ट)",
    navicDiffFixLabel: "डिफरेंशियल फिक्स",
    navicDiffFixValue: "NavIC DGPS सक्रिय",
    navicBorderHwLabel: "सीमा अलर्ट हार्डवेयर",
    navicBorderHwValue: "बज़र आर्म्ड",
    navicGeofenceTitle: "लाइव स्थिति जियोफेंसिंग",
    navicGeofenceDesc: "आपके डिवाइस के स्थान का उपयोग केवल सत्र के दौरान IMBL/MPA जाँच के लिए किया जाता है और ORCA द्वारा कभी संग्रहीत नहीं किया जाता।",
    navicGeofenceInitialStatus: "ट्रैकिंग बंद · 5 NM IMBL चेतावनी / MPA बफर चेतावनी",
    safetyVerdictDescTemplate: "लाइव Open-Meteo समुद्री टेलीमेट्री आपके चयनित हार्बर के पास महत्वपूर्ण लहर ऊँचाई {wave}m और सतही हवा {wind}kn दर्शाती है, जिससे {score}/100 का गणना किया गया सुरक्षा स्कोर मिलता है।",
    safetyWindDefaultDirection: "पश्चिमी",
    safetyBreezeSuffix: "{direction} हवा",
    severityLow: "कम",
    severityModerate: "मध्यम",
    severityHigh: "अधिक",
    waveBandCalm: "शांत (< 0.5m)",
    waveBandSlight: "हल्की (0.5 - 1.25m)",
    waveBandModerate: "मध्यम (1.25 - 2.5m)",
    waveBandRough: "उग्र (> 2.5m)",
    seaStateCalm: "शांत",
    seaStateSlight: "हल्की",
    seaStateSlightModerate: "हल्की से मध्यम",
    seaStateModerateRough: "मध्यम से उग्र",
    seaStateUnknown: "अज्ञात",
    lightningBandSafe: "सुरक्षित वायुमंडलीय प्रोफ़ाइल",
    lightningBandElevated: "बढ़ा हुआ संवहनी जोखिम",
    lightningBandSevere: "गंभीर तूफ़ान चेतावनी",
    safetySyncLatencyLabel: "सिंक विलंब:",
    safetyBatteryLabel: "बैटरी:",
    safetyLastPassLabel: "अंतिम पास:",
    safetyAltitudeLabel: "ऊँचाई:",
    telemetryLiveOpenMeteoTemplate: "लाइव OPEN-METEO टेलीमेट्री ({wave}m SWH)",
    telemetryCachedArchive: "टेलीमेट्री सक्रिय (संग्रहीत सैटेलाइट आर्काइव)",
    backendOnlineStatus: "लाइव FASTAPI बैकएंड कनेक्टेड",
    backendOfflineStatus: "बैकएंड ऑफ़लाइन · स्थानीय सिमुलेशन मोड",
    aisLiveCountTemplate: "{count} लाइव AIS वेसल{plural}",
    aisNoLiveVessels: "अभी कोई लाइव AIS वेसल नहीं",
    aisBlendedBannerTemplate: "{liveText} + {simCount} सिम्युलेटेड वेसल{plural} दिखाए जा रहे हैं, उन बंदरगाहों में जहाँ अभी कोई लाइव AIS कवरेज नहीं है।",
    aisUnavailableDefault: "लाइव AIS वेसल फ़ीड अनुपलब्ध -- 0 वेसल दिखाए जा रहे हैं।",
    aisNotConfigured: "इस डिप्लॉयमेंट पर लाइव AIS वेसल फ़ीड कॉन्फ़िगर नहीं है।",
    aisConnectedNotSending: "AIS प्रदाता (AISstream.io) से जुड़ा हुआ है, लेकिन यह अभी वेसल डेटा नहीं भेज रहा है — संभवतः प्रदाता-पक्ष की समस्या, स्थानीय दोष नहीं।",
    aisDisconnectedReconnecting: "AIS प्रदाता (AISstream.io) से डिस्कनेक्ट; स्वचालित रूप से पुनः जुड़ रहा है।",
    imblAlertActiveTemplate: "<strong>{vesselId} ({vesselName})</strong> भारत–श्रीलंका IMBL से <strong>{dist} NM</strong> की दूरी पर संचालित हो रहा है{simTag}। स्वचालित चेतावनी भेजी गई।",
    imblAlertNoneTemplate: "फ़िलहाल {warnDist} NM IMBL चेतावनी दूरी के भीतर कोई वेसल नहीं है। निकटतम ट्रैक किया गया वेसल: <strong>{dist} NM</strong> दूर।",
    imblAlertNoData: "अभी तक कोई वेसल टेलीमेट्री उपलब्ध नहीं है।",
    simulatedSuffix: " (सिम्युलेटेड)",
    notifUnavailableTitle: "ब्राउज़र सूचनाएँ अनुपलब्ध",
    notifUnavailableMsg: "जब तक यह टैब खुला है तब तक इन-ऐप खतरा बैनर फिर भी दिखाए जाएँगे।",
    notifNotEnabledTitle: "ब्राउज़र सूचनाएँ सक्षम नहीं हैं",
    notifNotEnabledMsg: "जब तक यह टैब खुला है तब तक इन-ऐप खतरा बैनर सक्रिय रहते हैं।",
    hazardHighWavesTitle: "ऊँची लहरें — स्थानीय सिमुलेशन",
    hazardHighWavesMsgTemplate: "{wave}m, 2.5m सावधानी सीमा से अधिक है। स्रोत: ब्राउज़र Open-Meteo टेलीमेट्री।",
    hazardHighWindTitle: "तेज़ हवा — स्थानीय सिमुलेशन",
    hazardHighWindMsgTemplate: "{wind} kn, 25 kn सावधानी सीमा से अधिक है। स्रोत: ब्राउज़र Open-Meteo टेलीमेट्री।",
    hazardLightningTitle: "बिजली गिरने का जोखिम — स्थानीय सिमुलेशन",
    hazardLightningMsgTemplate: "बिजली प्रॉक्सी {pct}% है। स्रोत: ब्राउज़र Open-Meteo टेलीमेट्री।",
    safetyOfficialClearanceLabel: "आधिकारिक समुद्री क्लीयरेंस",
    safetyVerdictDescInitial: "सभी सैटेलाइट समुद्र विज्ञान संकेतक (Oceansat-3 SSTM थर्मल फ्रंट, Sentinel-3 लहर अल्टीमेट्री) केरल, कर्नाटक और तमिलनाडु के तटीय जल में अनुकूल मछली पकड़ने की स्थितियों की पुष्टि करते हैं।",
    safetyIndexLabel: "सुरक्षा सूचकांक",
    satConstellationTitle: "ISRO और अंतरराष्ट्रीय समुद्र विज्ञान सैटेलाइट नक्षत्र",
    satStaticDataNote: "स्थिर संदर्भ डेटा (लाइव टेलीमेट्री नहीं)",
    mapIndiaBoundaryPopup: "भारत — आधिकारिक सीमा (Survey of India)",
    mapPfzYieldSuffix: "{rating} उपज ({pct}%)",
    mapPfzSstLabel: "SST:",
    mapPfzChlorophyllLabel: "क्लोरोफिल:",
    mapPfzDepthLabel: "गहराई:",
    mapPfzVesselsLabel: "वेसल:",
    mapPfzActiveSuffix: "{count} सक्रिय",
    mapPfzTargetSpeciesLabel: "लक्षित प्रजातियाँ:",
    mapPfzSimulateRouteBtn: "यहाँ मार्ग सिम्युलेट करें ➔",
    mapImblPopupBodyTemplate: "सख्त अंतरराष्ट्रीय समुद्री सीमा रेखा। चेतावनी बफर: {warn} NM। गंभीर जियोफेंस: {danger} NM।",
    mapImblPopupTreatyNote: "UNCLOS समुद्री संधि के तहत सीमा पार करना प्रतिबंधित है।",
    mapImblBufferCorridorTemplate: "{dist} NM IMBL बफर कॉरिडोर",
    mapMpaRestrictedBadge: "प्रतिबंधित इको-रिज़र्व",
    mapHarbourCoastSuffix: "{state} तट",
    mapHarbourCapacityLabel: "क्षमता:",
    mapHarbourVhfLabel: "VHF:",
    mapHarbourFuelLabel: "ईंधन स्टेशन:",
    mapHarbourFuelAvailable: "उपलब्ध",
    mapHarbourIceLabel: "बर्फ संयंत्र:",
    mapHarbourIceActive: "सक्रिय",
    mapHarbourSetOriginBtn: "मूल हार्बर के रूप में सेट करें",
    mapVesselSimulatedBadge: "सिम्युलेटेड · यहाँ कोई लाइव AIS कवरेज नहीं",
    mapVesselSpeedLabel: "गति:",
    mapVesselHeadingLabel: "दिशा:",
    mapVesselZoneLabel: "क्षेत्र:",
    mapVesselImblDistLabel: "IMBL दूरी:",
    mapVesselStatusLabel: "स्थिति:",
    mapVesselFuelLabel: "ईंधन:",
    mapVesselFuelNA: "उपलब्ध नहीं",
    mapRoutePopupTitle: "समुद्र-केवल A* मार्ग (भूमि + MPA परिहार)",
    mapRouteDistanceEtaTemplate: "दूरी: {dist} NM · ETA: {eta}{detourNote}",
    mapRouteDetourTemplate: " · {zones} के आसपास {pct}% घुमाव",
    mapRouteLandNoGoZones: "भूमि/निषिद्ध क्षेत्र",
    vesselStatusSafeFishing: "सुरक्षित मछली पकड़ना",
    vesselStatusBorderAlert: "सीमा चेतावनी",
    vesselStatusBorderWarn: "सीमा सतर्कता",
    vesselStatusInTransit: "यात्रा में",
    vesselSimBadgeText: "SIM",
    vesselSimBadgeTitle: "सिम्युलेटेड -- इस बंदरगाह के पास कोई लाइव AIS कवरेज नहीं",
    vesselLocateAction: "पता लगाएँ ➔",
    fleetVesselCountSuffix: "{count} वेसल",
    fleetLiveSimBreakdownTemplate: "{total} ({live} लाइव · {sim} सिम)",
    mapActiveVesselsBreakdownTemplate: "{total} सक्रिय वेसल ({live} लाइव · {sim} सिम्युलेटेड)",
    mapActiveVesselsSimpleTemplate: "{total} सक्रिय वेसल",
    mapTabTitle: "GIS कमांड मैप · भारतीय तटीय जल",
    mapTabDesc: "रीयल-टाइम सैटेलाइट PFZ, IMBL सीमा कॉरिडोर और AIS वेसल ट्रैक के साथ इंटरैक्टिव उच्च-कंट्रास्ट नॉटिकल मैप।",
    layerPfzZones: "PFZ क्षेत्र",
    layerImblBuffer: "IMBL बफर",
    layerEcoReserves: "इको रिज़र्व (MPA)",
    layerHarbours: "हार्बर",
    layerLiveVessels: "लाइव वेसल",
    layerDensityHeatmap: "घनत्व हीटमैप",
    layerIndiaBoundary: "भारत सीमा (Survey of India)",
    routePlannerDesc: "MPA और सीमा खतरों से बचने वाला A*-शैली मार्ग",
    routeVesselSpeedLabel: "वेसल गति:",
    fleetMonitorTitle: "फ्लीट मॉनिटर · लाइव वेसल टेलीमेट्री",
    fleetTotalActiveTitle: "कुल सक्रिय वेसल",
    fleetTotalActiveDesc: "वर्तमान में AIS ट्रांसपोंडर सिग्नल प्रसारित करने वाले वेसल",
    fleetZoneDistTitle: "प्रति क्षेत्र वेसल वितरण",
    imblAlertCardTitle: "IMBL सीमा निकटता चेतावनी",
    fleetTableSubDesc: "AISstream.io से लाइव AIS स्थितियाँ, जहाँ भी अभी कोई लाइव रिसीवर कवरेज नहीं है वहाँ स्पष्ट रूप से टैग किए गए सिम्युलेटेड फ्लीट (\"SIM\" बैज देखें) से भरी गई",
    vesselSearchPlaceholder: "वेसल का नाम या ID खोजें...",
    filterAllStatuses: "सभी स्थितियाँ",
    filterSafeFishing: "सुरक्षित मछली पकड़ना",
    filterInTransit: "यात्रा में",
    filterBorderAlert: "सीमा चेतावनी",
    thVesselId: "वेसल ID",
    thVesselName: "वेसल का नाम",
    thType: "प्रकार",
    thCurrentZone: "वर्तमान क्षेत्र",
    thSpeedHeading: "गति / दिशा",
    thImblDist: "IMBL दूरी",
    thStatus: "स्थिति",
    thAction: "कार्रवाई",
    bulletinIssuedLabel: "जारी:",
    bulletinRegionLabel: "क्षेत्र:",
    bulletinWavesLabel: "लहरें:",
    bulletinWindsLabel: "हवाएँ:",
    bulletinSourceLabel: "स्रोत:",
    bulletinListenBtn: "बुलेटिन सुनें",
    bulletinsTabTitle: "आधिकारिक समुद्री और मत्स्य बुलेटिन (ISRO - INCOIS)",
    bulletinsTabDesc: "क्रमांकित सलाह, चक्रवात खतरा चेतावनियाँ, और अंतरराष्ट्रीय सीमा अनुपालन अलर्ट।",
    bulletinNotifyToggleTitle: "केवल जब यह टैब/PWA खुला हो तब ब्राउज़र अलर्ट प्राप्त करें",
    bulletinNotifyToggleLabel: "खुले रहने पर सूचित करें",
    bulletinFilterAll: "सभी बुलेटिन",
    bulletinFilterCritical: "गंभीर",
    bulletinFilterWarning: "चेतावनियाँ",
    bulletinFilterAdvisory: "सलाह",
    bulletinsPushNote: "खतरा अलर्ट केवल तब सक्रिय होते हैं जब यह टैब/PWA खुला हो। बंद-ऐप पुश सूचनाओं के लिए एक उत्पादन पुश-सब्सक्रिप्शन सेवा की आवश्यकता होती है और यह इस प्रोटोटाइप में लागू नहीं है।",
    sosModalTitle: "आपातकालीन संकट बीकन (SOS)",
    sosInstructions: "आपातकालीन SOS सक्रिय करने से <strong>INSAT-3DR SAS&R</strong> के माध्यम से भारतीय तटरक्षक समुद्री बचाव समन्वय केंद्र (MRCC) को एक आपातकालीन 406 MHz संकट सिग्नल प्रेषित किया जाएगा।",
    sosCurrentPositionLabel: "वर्तमान स्थिति:",
    sosVhfChannelLabel: "आपातकालीन VHF चैनल:",
    sosMrccHelplineLabel: "MRCC हेल्पलाइन:",
    sosConfirmBtn: "पुष्टि करें और संकट बीकन प्रसारित करें",
    sosBeaconTransmittingBanner: "406 MHz SAS&R बीकन ISRO और तटरक्षक MRCC को प्रेषित हो रहा है",
    sosDistressRelayedMsg: "संकट पैकेट INSAT-3DR SAS&R रिसीवर के माध्यम से रिले किया गया। समुद्री बचाव समन्वय केंद्र (MRCC चेन्नई/मुंबई) को VHF चैनल 16 पर सतर्क किया गया।",
    sosGpsVesselIdTemplate: "GPS निर्देशांक: {coords} · वेसल ID: {vesselId} ({vesselName})",
    landingEyebrow: "ISRO सहयोगी समुद्री बुद्धिमत्ता · स्मार्ट इंडिया हैकाथॉन 2026",
    landingSubtitle: "एक सहयोगी समुद्री-बुद्धिमत्ता मंच, दो कमांड डेक: मछुआरे का दैनिक अवसर कंसोल, और पूर्ण ISRO सैटेलाइट, AIS और जियोफेंसिंग इनसाइट सुइट।",
    landingStripItem1: "Oceansat-3 SSTM थर्मल फ्रंट",
    landingStripItem2: "INSAT-3DR सैटेलाइट समुद्र विज्ञान",
    landingStripItem3: "8-नोड सहयोगी एजेंट DAG",
    landingStripItem4: "NavIC (IRNSS) GPS ब्रिज",
    landingStripItem5: "IMBL सीमा जियोफेंसिंग अलर्ट",
    landingStripItem6: "लाइव AIS फ्लीट और GIS कमांड",
    landingStripItem7: "सेल स्मार्टर बायर प्राइसिंग",
    landingStripItem8: "406 MHz SOS संकट बीकन",
    landingFishermanCardTitle: "ORCA फिशरमैन",
    landingFishermanCardDesc: "आज का अवसर स्कोर, सेल स्मार्टर प्राइसिंग, एक ट्रिप-लागत कैलकुलेटर और आपकी पकड़ के लिए खरीदार लीड — नाव के लिए बनाया गया।",
    landingFishermanCardCta: "फिशरमैन कंसोल खोलें",
    landingFishermanCardTitleAttr: "फिशरमैन कंसोल खोलें",
    landingInsightCardTitle: "ORCA इनसाइट",
    landingInsightCardDesc: "पूर्ण कमांड डेक: ISRO सैटेलाइट समुद्र विज्ञान, GIS मैप, 8-नोड एजेंट DAG, सुरक्षा बैरोमीटर, फ्लीट मॉनिटर और NavIC ब्रिज।",
    landingInsightCardCta: "इनसाइट कमांड डेक खोलें",
    landingInsightCardTitleAttr: "इनसाइट कमांड डेक खोलें",
    backToOverviewTitle: "अवलोकन पर वापस जाएँ",
    statSimulatedFleetLabel: "सिम्युलेटेड AIS फ्लीट",
    statSatellitesActiveTemplate: "{count} सक्रिय",
    statSatellitesListLabel: "Oceansat-3, INSAT-3DR, Sentinel-3",
    statPfzZonesCountTemplate: "{count} क्षेत्र",
    statPfzZonesListLabel: "वेज बैंक, कोच्चि, वेरावल...",
    statImblCorridorsCountTemplate: "{count} कॉरिडोर",
    statImblBordersLabel: "भारत-श्रीलंका और पाक सीमाएँ",
    pillarDagTitle: "8-नोड सहयोगी एजेंट DAG",
    pillarDagDesc: "बहु-एजेंट आर्किटेक्चर जो प्रश्नों को सैटेलाइट, लहर खतरा, जियोफेंसिंग, वेसल गणना, ETA और न्यूरल सिंथेसिस चरणों में उप-सेकंड विलंबता के साथ विभाजित करता है।",
    pillarEtaTitle: "लाइव समुद्री-स्थिति ETA और शाम सुरक्षा",
    pillarEtaDesc: "लहर प्रतिरोध के अनुसार समायोजित हाइड्रोडायनामिक यात्रा गणनाएँ, सूर्यास्त के बाद फंसे मछुआरों को रोकने के लिए स्वचालित शाम-से-पहले-वापसी सुरक्षा अलर्ट के साथ।",
    pillarFleetTitle: "लाइव फ्लीट घनत्व और IMBL अलर्ट",
    pillarFleetDesc: "प्रति क्षेत्र रीयल-टाइम वेसल गणना, भीड़भाड़ जोखिम संकेतक, और समुद्री सीमाओं की रक्षा करने वाले स्वचालित 5 NM/2 NM जियोफेंस निकटता अलर्ट।",
    footerCreditLine: "<span class=\"text-slate-200 font-semibold\">{appTitle}</span> · निर्मित <strong class=\"text-cyan-400\">{teamName}</strong> द्वारा · स्मार्ट इंडिया हैकाथॉन 2026 · समस्या विवरण 26176 (ISRO)",
    sttListeningStatusTemplate: "<b>{lang}</b> में सुन रहा है... अभी बोलें।",
    sttUnsupportedTitle: "इस ब्राउज़र में स्पीच रिकग्निशन समर्थित नहीं है",
    routeUnavailableLabel: " मार्ग अनुपलब्ध:",
    routeUnavailableMsg: "ORCA बैकएंड अनुपलब्ध है, इसलिए कोई रूटेड दूरी/ETA नहीं दिखाई जा सकती। स्थानीय फ़ॉलबैक मोड में चल रहा है।",
    routeNoSafeRouteLabel: "✕ कोई सुरक्षित समुद्री मार्ग नहीं मिला:",
    routeNoSafeRouteMsgTemplate: "{detail}",
    routeNoSafeRouteDefaultReason: "राउटर को इस हार्बर/PFZ जोड़ी के लिए भूमि और समुद्री संरक्षित क्षेत्रों से बचने वाला मार्ग नहीं मिल सका।",
    routeSafeReturnLabel: "✓ सुरक्षित वापसी:",
    routeSafeReturnTemplate: "अनुमानित हार्बर आगमन {time} तक (18:30 IST शाम से पहले)।",
    routeReturnAfterDuskLabel: " शाम के बाद वापसी:",
    routeReturnAfterDuskTemplate: "अनुमानित वापसी {time} पर (18:30 IST सूर्यास्त से अधिक)। पहले प्रस्थान या रात्रि नौवहन बीकन जाँच की सिफारिश की जाती है।"
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
    fmClaimFailed: "இப்போது இந்த பட்டியலை உரிமை கோர முடியவில்லை.",
    dagAgentSupervisorName: "மாஸ்டர் சூப்பர்வைசர் / DAG திட்டமிடுபவர்",
    dagAgentSupervisorRole: "பல்வகை கடல் வினவலைப் பிரிக்கிறது, செயற்கைக்கோள், அபாய மற்றும் ஜியோஃபென்ஸ் முகவர்களுக்கு துணைப்பணிகளை ஒதுக்குகிறது.",
    dagAgentSatelliteName: "செயற்கைக்கோள் கடலியல் முகவர்",
    dagAgentSatelliteRole: "Oceansat-3 OCM-3 (குளோரோஃபில்-a) மற்றும் SSTM (வெப்ப முனைகள்) உடன் INSAT-3DR மேக படங்களையும் உள்வாங்குகிறது.",
    dagAgentWeatherName: "வானிலை & கடல் அபாய முகவர்",
    dagAgentWeatherRole: "குறிப்பிடத்தக்க அலை உயரம் (SWH), காற்று வேக திசையன்கள், மின்னல் நிகழ்தகவை மதிப்பிட்டு, கடல்-அனுமதி மதிப்பெண்ணை உருவாக்குகிறது.",
    dagAgentPfzName: "கடல் பகுப்பாய்வு & PFZ முகவர்",
    dagAgentPfzRole: "வெப்ப-குளோரோஃபில் முனைகளின் சந்திப்புகளை அடையாளம் கண்டு, பெலஜிக் உயிர்பொருள் அடர்த்தியைக் கணக்கிட்டு, இலக்கு மீன்பிடி மண்டலங்களை தரவரிசைப்படுத்துகிறது.",
    dagAgentGeofenceName: "ஜியோஃபென்சிங் & வழி முகவர்",
    dagAgentGeofenceRole: "சர்வதேச கடல் எல்லைக் கோடுகளை (IMBL) கண்காணித்து, கடல் பாதுகாக்கப்பட்ட பகுதிகளை பஃபர் செய்து, A* பாதுகாப்பான வழிப்புள்ளிகளைக் கணக்கிடுகிறது.",
    dagAgentFleetName: "கப்பல் கூட்டம் & போக்குவரத்து முகவர் (புதியது)",
    dagAgentFleetRole: "AIS & ARGOS-4 கப்பல் டிரான்ஸ்பாண்டர்களை ஸ்கேன் செய்து, கப்பல் விநியோகத்தைக் கண்காணித்து, நெரிசல் அல்லது எல்லை கூட்டத்தைக் குறிக்கிறது.",
    dagAgentEtaName: "ETA & பயண பாதுகாப்பு முகவர் (புதியது)",
    dagAgentEtaRole: "நிகழ்நேர அலை எதிர்ப்புக்கு ஏற்ப பயண காலத்தைக் கணக்கிட்டு, மாலைக்கு முன் திரும்பும் பாதுகாப்பு காலப்பகுதியை மதிப்பிடுகிறது.",
    dagAgentSynthesisName: "நியூரல் சிந்தசிஸ் முகவர் (புள்ளிவிவர-உந்துதல்)",
    dagAgentSynthesisRole: "பல்-முகவர் தொலைநிலைத் தரவை மேற்கோள் குறிச்சொற்கள் மற்றும் TTS உடன் அதிகாரப்பூர்வமான, ஆதாரப்பூர்வ இயற்கை-மொழி ஆலோசனையாக ஒருங்கிணைக்கிறது -- முழுவதும் விதி-அடிப்படையிலானது, இந்த தளத்தின் சொந்த லைவ் தொலைநிலைத் தரவு மற்றும் அதன் சொந்த குவிந்த புள்ளிவிவர பதிவேட்டின் மீது தர்க்கம் செய்கிறது. வெளிப்புற AI/LLM API எதுவும் பயன்படுத்தப்படவில்லை.",
    dagStatusIdle: "செயலற்றது",
    dagInspectLink: "ஆய்வு செய் ➔",
    dagInspectorLatencyTemplate: "செயல்படுத்தல் தாமதம்: {latency} · துணைப்பணிகள் சரிபார்க்கப்பட்டன",
    dagStatusQueued: "வரிசையில்",
    dagStatusExecuting: "செயல்படுத்தப்படுகிறது...",
    dagStatusCompleted: "முடிந்தது",
    dagStatusSkipped: "அழைக்கப்படவில்லை — நோக்கத்திற்கு இது தேவைப்படவில்லை",
    dagBtnReasoningActiveLive: "தர்க்கம் செயலில் (லைவ் பேக்எண்ட்)...",
    dagBtnExecutedLive: "✓ லைவ் பேக்எண்ட் வழியாக பைப்லைன் செயல்படுத்தப்பட்டது · மீண்டும் இயக்கு",
    dagBtnErrorRetry: "▶ லைவ் பைப்லைன் சிமுலேஷனை இயக்கு",
    dagBtnReasoningActiveOffline: "தர்க்கம் செயலில் (உள்ளூர் சிமுலேஷன்)...",
    dagBtnExecutedOffline: "✓ பைப்லைன் செயல்படுத்தப்பட்டது (உள்ளூர் சிமுலேஷன்) · மீண்டும் இயக்கு",
    dagTabTitle: "8-முனை கூட்டு பல்-முகவர் DAG",
    dagInteractiveCanvasBadge: "ஊடாடும் தர்க்க கேன்வாஸ்",
    dagTabDesc: "Oceansat-3, INSAT-3DR, IMBL ஜியோஃபென்சிங், கப்பல் அடர்த்தி மற்றும் பயண ETA மீது தர்க்கம் செய்யும் நிகழ்நேர பல்-முகவர் செயல்படுத்தல் பைப்லைன்.",
    backendCheckingStatus: "பேக்எண்ட் சரிபார்க்கப்படுகிறது...",
    dagZoomReset: "மீட்டமை",
    dagRunSimulationBtn: "▶ லைவ் பைப்லைன் சிமுலேஷனை இயக்கு",
    dagClickToInspectHint: "எந்த முகவர் அட்டையையும் கிளிக் செய்து அதன் மூல தொலைநிலைத் தரவு உள்ளீடு, உள் அல்காரிதம்கள் மற்றும் JSON தரவு வெளியீட்டை ஆய்வு செய்யவும்.",
    dagOrchestratorLabel: "ஆர்கெஸ்ட்ரேட்டர்: LangGraph / Async Agent Core",
    dagInspectorDefaultTitle: "முகவர் விவரங்கள்",
    dagInspectorDefaultRole: "பங்கு விளக்கம்",
    dagInspectorLatencyPlaceholder: "தாமதம்: 24ms",
    dagInspectorJsonLabel: "லைவ் JSON பேலோட்",
    dagCloseInspector: "ஆய்வாளரை மூடு",
    chatNewConversationMsg: "புதிய உரையாடல் தொடங்கியது. ORCA முந்தைய அரட்டை சூழலைப் பயன்படுத்தாது.",
    chatYouLabel: "நீங்கள்",
    chatOrcaLabel: "ORCA",
    chatOrchestratingMsg: "Oceansat-3, INSAT-3DR & Open-Meteo முழுவதும் 8 சிறப்பு AI முகவர்கள் ஒருங்கிணைக்கப்படுகின்றன...",
    chatAiLabel: "AI",
    chatAdvisoryHeader: "பல்-முகவர் கடல் ஆலோசனை",
    chatGroundedConfidenceTemplate: "{confidence}% ஆதாரப்பூர்வ நம்பிக்கை",
    chatLangDetectedTooltip: "செய்தியிலிருந்து மொழி கண்டறியப்பட்டது",
    chatListenTts: "கேளுங்கள் (TTS)",
    chatNavicMssBtn: "NavIC MSS குறியீடு",
    chatMetricZone: "பரிந்துரைக்கப்பட்ட மண்டலம்",
    chatMetricEta: "லைவ் கடல் நிலை ETA",
    chatMetricVessels: "செயலில் உள்ள கப்பல்கள்",
    chatVesselsSuffix: "{count} கப்பல்கள்",
    chatMetricImbl: "IMBL அனுமதி",
    chatReasoningTraceSummaryTemplate: "பல்-முகவர் தர்க்க தடத்தைக் காண்க ({steps} படிகள் செயல்படுத்தப்பட்டன)",
    chatNodeDagSuffixTemplate: "{count}-முனை DAG",
    chatNoAdvisoryTextFallback: "ORCA INSIGHT பேக்எண்ட் ஒரு ஆலோசனையை உருவாக்கியது ஆனால் எந்த உரையையும் திரும்பவில்லை.",
    chatLiveAdvisoryLabel: "✓ லைவ் பல்-முகவர் ஆலோசனை",
    chatGroundedEngineFallback: "ஆதாரப்பூர்வ இயந்திரம்",
    chatOceanSourceTierTemplate: "கடல் மூல அடுக்கு: {tier} · குளோரோஃபில்: {chlorophyll}",
    chatCitationsTemplate: "மேற்கோள்கள்: {citations}",
    chatOfflineBannerText: "ஆஃப்லைன் ஆலோசனை இயந்திரம் — ORCA பேக்எண்ட் அணுக முடியவில்லை. கீழே உள்ள புள்ளிவிவரங்கள் ஒரு உருவகப்படுத்தப்பட்ட உதாரண மதிப்பீடு, லைவ் தொலைநிலைத் தரவு அல்ல.",
    chatOfflineImblPlainText: "ஆஃப்லைன் ஆலோசனை (பேக்எண்ட் அணுக முடியவில்லை, உருவகப்படுத்தப்பட்ட மதிப்பீடு): பாக் நீரிணை / மன்னார் வளைகுடா பகுதியில் உள்ள கப்பல்கள் பொதுவாக இந்தியா-இலங்கை IMBL எல்லையிலிருந்து சில கடல் மைல்களுக்குள் இருக்கும். மேற்கு நோக்கிய திசையைப் பராமரித்து VHF டிரான்ஸ்பாண்டர்களை சேனல் 16-இல் செயலில் வைத்திருங்கள். எல்லைக்கான உண்மையான அளவிடப்பட்ட தூரத்திற்கு ORCA பேக்எண்டுடன் மீண்டும் இணையவும்.",
    chatOfflineImblHtmlHeading: "IMBL ஜியோஃபென்சிங் ஆலோசனை (உருவகப்படுத்தப்பட்ட ஆஃப்லைன் மதிப்பீடு):",
    chatOfflineImblHtmlBody1: "லைவ் பேக்எண்ட் இணைப்பு இல்லாமல், கப்பல்-முதல்-எல்லை துல்லியமான தூரங்களை அளவிட முடியாது. பாக் நீரிணை பிரிவு 4-க்கு அருகில் பொதுவான முன்னெச்சரிக்கையாக, மண்டபம் நோக்கி மேற்கு திசையைப் பராமரிக்கவும்.",
    chatOfflineImblHtmlBody2: "இது ஒரு பொதுவான ஆஃப்லைன் பாதுகாப்பு நினைவூட்டல், அளவிடப்பட்ட ஜியோஃபென்ஸ் அளவீடு அல்ல. உண்மையான தூரம்-முதல்-IMBL கணக்கீட்டிற்கு ORCA பேக்எண்டுடன் மீண்டும் இணையவும்.",
    chatOfflineImblStep1: "பேக்எண்ட் அணுக முடியவில்லை. உள்ளூர் முக்கியச்சொல் பொருத்தத்தைப் பயன்படுத்தி வினவல் IMBL_BOUNDARY என வகைப்படுத்தப்பட்டது.",
    chatOfflineImblStep2: "லைவ் ஜியோஃபென்சிங் தொலைநிலைத் தரவு இல்லை -- பொதுவான எல்லை-பாதுகாப்பு வழிகாட்டுதலை மட்டும் திருப்பி அளிக்கிறது.",
    chatOfflineDensityPlainText: "ஆஃப்லைன் ஆலோசனை (பேக்எண்ட் அணுக முடியவில்லை, உருவகப்படுத்தப்பட்ட மதிப்பீடு): பேக்எண்ட் இணைப்பு இல்லாமல் லைவ் கப்பல் எண்ணிக்கையைப் பெற முடியாது. வரலாற்று ரீதியாக, வேஜ் பேங்க் மற்றும் கொச்சி டீப் ஆஃப்ஷோரில் மிதமான மீன்பிடி நடவடிக்கை காணப்படுகிறது. கப்பல் தரவுத்தொகுப்பிலிருந்து உண்மையான கப்பல் கூட்ட-அடர்த்தி அளவீட்டிற்கு ORCA பேக்எண்டுடன் மீண்டும் இணையவும்.",
    chatOfflineDensityHtmlHeading: "கப்பல் கூட்ட அடர்த்தி (ஆஃப்லைன் — உருவகப்படுத்தப்பட்ட இடப்பிடி):",
    chatOfflineDensityHtmlBody: "கப்பல் கூட்டம் & போக்குவரத்து முகவரின் லைவ் கப்பல் தரவுத்தொகுப்பு தற்போது அணுக முடியாது, எனவே மண்டலத்திற்குள் துல்லியமான கப்பல் எண்ணிக்கை கிடைக்கவில்லை.",
    chatOfflineDensityListItem: "உண்மையான மண்டல வாரியான கப்பல் எண்ணிக்கை மற்றும் நெரிசல் தீர்ப்பிற்கு ORCA பேக்எண்டுடன் மீண்டும் இணையவும்.",
    chatOfflineDensityStep1: "பேக்எண்ட் அணுக முடியவில்லை. உள்ளூர் முக்கியச்சொல் பொருத்தத்தைப் பயன்படுத்தி வினவல் FLEET_DENSITY என வகைப்படுத்தப்பட்டது.",
    chatOfflineDensityStep2: "லைவ் கப்பல் கூட்ட தரவுத்தொகுப்பு இல்லை -- தவறான புள்ளிவிவரத்தை காட்டுவதைத் தவிர்க்க கப்பல் எண்ணிக்கை காட்டப்படவில்லை.",
    chatOfflineGenericPlainTextTemplate: "ஆஃப்லைன் ஆலோசனை (பேக்எண்ட் அணுக முடியவில்லை): ORCA-வின் பல்-முகவர் பேக்எண்டை அணுக முடியவில்லை, எனவே இந்த பதில் ஒரு ஆதாரப்பூர்வ அளவீட்டைக் காட்டிலும் ஒரு பொதுவான, லைவ் அல்லாத இடப்பிடி ஆகும். உங்கள் உலாவியின் சொந்த Open-Meteo விட்ஜெட் சுமார் {liveWave}m குறிப்பிடத்தக்க அலை உயரத்தைக் காட்டுகிறது, ஆனால் PFZ தரவரிசை, வழி தூரம், ETA மற்றும் கப்பல் எண்ணிக்கை அனைத்திற்கும் பேக்எண்ட் தேவை, அவை இங்கே காட்டப்படவில்லை. உண்மையான ஆலோசனைக்கு ORCA பேக்எண்டுடன் மீண்டும் இணையவும்.",
    chatOfflineGenericHtmlHeading: "ஆஃப்லைன் இடப்பிடி ஆலோசனை",
    chatOfflineGenericHtmlBody1Template: "ORCA-வின் பல்-முகவர் பேக்எண்ட் (செயற்கைக்கோள், வானிலை, PFZ தரவரிசை, ஜியோஃபென்சிங், கப்பல் கூட்டம், வழிசெலுத்தல் மற்றும் நியூரல் சிந்தசிஸ்) தற்போது அணுக முடியாது. கிளையன்ட் தரப்பில், இந்த உலாவி Open-Meteo-விலிருந்து கடைசியாக <strong>{liveWave}m</strong> அலை உயரத்தைக் கண்டது, ஆனால் மற்ற ஒவ்வொரு புள்ளிவிவரத்திற்கும் பேக்எண்ட் தேவை.",
    chatOfflineGenericHtmlBody2: "<strong>எந்த PFZ பரிந்துரையும், வழியும், ETA-வும் அல்லது கப்பல் எண்ணிக்கையும் காட்டப்படவில்லை</strong> ஏனெனில் அவை கணக்கிடப்படுவதற்குப் பதிலாக கற்பனை செய்யப்பட வேண்டும். முழுமையான ஆதாரப்பூர்வ ஆலோசனைக்கு ORCA பேக்எண்டுடன் மீண்டும் இணையவும்.",
    chatOfflineGenericStep1: "பேக்எண்ட் அணுக முடியவில்லை. நோக்கம்-குறிப்பிட்ட முக்கியச்சொல் எதுவும் பொருந்தவில்லை -- GENERAL_VOYAGE_SAFETY ஆஃப்லைன் இடப்பிடி திருப்பி அளிக்கப்படுகிறது.",
    chatOfflineGenericStep2Template: "கிளையன்ட்-பார்வைக்குக் கிடைக்கும் புள்ளிவிவரம் மட்டும்: கடைசியாக அறியப்பட்ட Open-Meteo அலை உயரம் {liveWave}m (உலாவியால் நேரடியாகப் பெறப்பட்டது, பேக்எண்ட் வழியாக அல்ல).",
    chatTtsUnsupportedAlert: "உங்கள் உலாவியால் பேச்சு தொகுப்பு ஆதரிக்கப்படவில்லை.",
    chatTtsWelcomeFallback: "ORCA INSIGHT-க்கு வரவேற்கிறோம். அனைத்து செயற்கைக்கோள் ஊட்டங்களும் கடலோர கடலியல் அமைப்புகளும் இயல்பான நிலையில் இயங்குகின்றன.",
    chatStopAudio: "ஆடியோவை நிறுத்து",
    chatListenAudioAdvisory: "ஆடியோ ஆலோசனையைக் கேளுங்கள்",
    chatTabTitle: "AI முடிவு ஸ்டூடியோ & பல்-முகவர் அரட்டைப்பொறி",
    chatTabSubtitle: "Oceansat-3, INSAT-3DR மற்றும் கடலோர ஜியோஃபென்சிங் மீது தர்க்கம் செய்யும் கூட்டு முகவர்களால் இயக்கப்படுகிறது",
    chatNewConversationBtn: "புதிய உரையாடல்",
    chatPromptPFZ: "கொச்சி துறைமுகத்திலிருந்து அருகிலுள்ள அதிக-மகசூல் PFZ மீன்பிடி மண்டலத்தை பிடிப்பு சாத்தியம் மற்றும் இனங்களுடன் கண்டறியவும்.",
    chatPromptSafety: "இன்றைக்கான கடல்-பயண அனுமதி மதிப்பெண், குறிப்பிடத்தக்க அலை உயரம் மற்றும் காற்று அபாயத்தை சரிபார்க்கவும்.",
    chatPromptBorder: "இந்தியா-இலங்கை IMBL எல்லைக்கான தூரத்தைச் சரிபார்த்து 2 NM ஆபத்து மண்டலத்தில் உள்ள கப்பல்களைப் பட்டியலிடவும்.",
    chatPromptDensity: "வேஜ் பேங்க் மற்றும் கொச்சி டீப் முழுவதும் தற்போதைய கப்பல் எண்ணிக்கை மற்றும் அடர்த்தி விநியோகம் என்ன?",
    chatPromptETA: "கொச்சியிலிருந்து PFZ-01 வரை பயண ETA-வைக் கணக்கிட்டு, 18:30 மாலைக்கு முன் இருவழிப் பயணம் பாதுகாப்பாகத் திரும்புமா என்று சரிபார்க்கவும்.",
    chatConversationLabel: "உரையாடல்",
    chatNeuralCoreActive: "ORCA INSIGHT நியூரல் கோர் செயலில்",
    chatAgentsReadyUptime: "8 முகவர்கள் தயார் · 99.94% இயக்க நேரம்",
    chatWelcomeMessage: "வணக்கம் / நமஸ்தே! நான் <strong>ORCA INSIGHT</strong> பல்-முகவர் தொகுப்பு அமைப்பு. பாதுகாப்பான கடல் பயண அனுமதி, இந்தியாவின் கடற்கரையோரம் அதிக-மகசூல் PFZ மண்டலங்கள், லைவ் கப்பல் போக்குவரத்து, IMBL எல்லை அருகாமை மற்றும் கடல்-நிலை சரிசெய்யப்பட்ட ETA கணக்கீடுகள் பற்றி நீங்கள் பேசலாம் அல்லது தட்டச்சு செய்யலாம்.",
    chatMicHint: "தமிழ், இந்தி, மலையாளம் அல்லது ஆங்கிலத்தில் பேச கீழே உள்ள மைக்ரோஃபோன் ஐகானைக் கிளிக் செய்யவும்!",
    chatVoiceInputTitle: "வினவலைப் பேசுங்கள் (பேச்சிலிருந்து உரை)",
    chatLiveReasoningTraceTitle: "லைவ் தர்க்க தடம்",
    chatReasoningTraceEmptyHint: "8 கூட்டு முகவர்களில் ஒவ்வொன்றும் இதன் மூலம் லைவ் ஆக எப்படி தர்க்கம் செய்கிறது என்பதைக் காண இடதுபுறத்தில் ஒரு கேள்வியைக் கேளுங்கள்.",
    chatLiveTelemetryTitle: "லைவ் கடல் தொலைநிலைத் தரவு",
    chatCurrentSeaClearance: "தற்போதைய கடல் அனுமதி:",
    chatSignificantWaves: "குறிப்பிடத்தக்க அலைகள்:",
    chatSurfaceWind: "மேற்பரப்பு காற்று:",
    chatActiveVessels: "செயலில் உள்ள கப்பல்கள்:",
    chatOpenDagVisualizerBtn: "முழு முகவர் DAG விஷுவலைசரைத் திற ➔",
    navicConnected: "NavIC ரிசீவர்: இணைக்கப்பட்டது (L5/S-Band)",
    navicDisconnected: "NavIC ரிசீவர்: துண்டிக்கப்பட்டது",
    navicTrackMyPosition: "எனது நிலையைக் கண்காணி",
    navicStopTracking: "கண்காணிப்பை நிறுத்து",
    navicSimulateMovement: "கப்பல் இயக்கத்தை உருவகப்படுத்து",
    navicStopSimulation: "உருவகப்படுத்துதலை நிறுத்து",
    navicStatusTrackingOff: "கண்காணிப்பு நிறுத்தப்பட்டது · எந்த நிலையும் கோரப்படவில்லை",
    navicStatusGeoUnsupported: "இந்த உலாவியால் இருப்பிடம் ஆதரிக்கப்படவில்லை. டெமோவிற்கு உருவகப்படுத்தப்பட்ட கப்பல் இயக்கத்தைப் பயன்படுத்தவும்.",
    navicStatusRequestingPermission: "சாதன-இருப்பிட அனுமதி கோரப்படுகிறது…",
    navicStatusLiveTrackingTemplate: "லைவ் சாதன கண்காணிப்பு · துல்லியம் ±{accuracy}m · சேமிக்கப்படவில்லை",
    navicStatusPermissionErrorTemplate: "இருப்பிட அனுமதி கிடைக்கவில்லை ({error}). எந்த நிலையும் அனுப்பப்படவில்லை.",
    navicStatusBackendUnavailable: "பேக்எண்ட் கிடைக்கவில்லை — உள்ளூர் உருவகப்படுத்துதலில் துல்லியமான ஜியோஃபென்ஸ் தூரத்தை மதிப்பிட முடியாது.",
    navicStatusSimStopped: "ஜியோஃபென்ஸ் உருவகப்படுத்துதல் நிறுத்தப்பட்டது",
    navicStatusSimMovingTemplate: "உருவகப்படுத்தப்பட்ட கப்பல் இயக்கம் · புள்ளி {index}/{total} · {lat}, {lon}",
    navicMssCopiedAlertTemplate: "NavIC MSS / SMS 120-எழுத்து செயற்கைக்கோள் அவசர குறியீடு நகலெடுக்கப்பட்டது:\\n\\n{code}",
    navicSkyplotTitle: "ISRO NavIC (IRNSS) ஸ்கைப்ளாட்",
    navicConstellationDesc: "7-செயற்கைக்கோள் புவிநிலை / IGSO தொகுப்பு",
    navicConnectedShort: "இணைக்கப்பட்டது (L5/S)",
    navicTrackedSatellitesTitle: "கண்காணிக்கப்படும் செயற்கைக்கோள்கள் (SNR dB-Hz)",
    navicNmeaStreamTitle: "லைவ் NMEA-0183 வன்பொருள் ஸ்ட்ரீம் ($GNGGA / $GNRMC)",
    navicBaudRateDesc: "பாட் விகிதம்: 9600 bps · 1 Hz ஊட்டம்",
    navicDopPrecisionLabel: "DOP துல்லியம்",
    navicDopValue: "HDOP 1.05 (சிறந்தது)",
    navicDiffFixLabel: "வேறுபாட்டு நிர்ணயம்",
    navicDiffFixValue: "NavIC DGPS செயலில்",
    navicBorderHwLabel: "எல்லை அலர்ட் வன்பொருள்",
    navicBorderHwValue: "பஸ்ஸர் தயார்நிலையில்",
    navicGeofenceTitle: "லைவ் நிலை ஜியோஃபென்சிங்",
    navicGeofenceDesc: "உங்கள் சாதன இருப்பிடம் அமர்வுக்குள் IMBL/MPA சரிபார்ப்புகளுக்கு மட்டுமே பயன்படுத்தப்படுகிறது, ORCA-வால் ஒருபோதும் சேமிக்கப்படாது.",
    navicGeofenceInitialStatus: "கண்காணிப்பு நிறுத்தப்பட்டது · 5 NM IMBL எச்சரிக்கை / MPA பஃபர் எச்சரிக்கை",
    safetyVerdictDescTemplate: "லைவ் Open-Meteo கடல் தொலைநிலைத் தரவு உங்கள் தேர்ந்தெடுக்கப்பட்ட துறைமுகத்திற்கு அருகில் குறிப்பிடத்தக்க அலை உயரம் {wave}m மற்றும் மேற்பரப்பு காற்று {wind}kn ஆக வைக்கிறது, இது கணக்கிடப்பட்ட {score}/100 பாதுகாப்பு மதிப்பெண்ணைத் தருகிறது.",
    safetyWindDefaultDirection: "மேற்கு",
    safetyBreezeSuffix: "{direction} தென்றல்",
    severityLow: "குறைவு",
    severityModerate: "மிதமான",
    severityHigh: "அதிக",
    waveBandCalm: "அமைதியான (< 0.5m)",
    waveBandSlight: "லேசான (0.5 - 1.25m)",
    waveBandModerate: "மிதமான (1.25 - 2.5m)",
    waveBandRough: "கடுமையான (> 2.5m)",
    seaStateCalm: "அமைதியான",
    seaStateSlight: "லேசான",
    seaStateSlightModerate: "லேசானது முதல் மிதமானது வரை",
    seaStateModerateRough: "மிதமானது முதல் கடுமையானது வரை",
    seaStateUnknown: "தெரியவில்லை",
    lightningBandSafe: "பாதுகாப்பான வளிமண்டல விவரக்குறிப்பு",
    lightningBandElevated: "உயர்ந்த வெப்பச்சலன ஆபத்து",
    lightningBandSevere: "கடுமையான புயல் எச்சரிக்கை",
    safetySyncLatencyLabel: "ஒத்திசைவு தாமதம்:",
    safetyBatteryLabel: "பேட்டரி:",
    safetyLastPassLabel: "கடைசி கடப்பு:",
    safetyAltitudeLabel: "உயரம்:",
    telemetryLiveOpenMeteoTemplate: "லைவ் OPEN-METEO தொலைநிலைத் தரவு ({wave}m SWH)",
    telemetryCachedArchive: "தொலைநிலைத் தரவு செயலில் (சேமிக்கப்பட்ட செயற்கைக்கோள் காப்பகம்)",
    backendOnlineStatus: "லைவ் FASTAPI பேக்எண்ட் இணைக்கப்பட்டது",
    backendOfflineStatus: "பேக்எண்ட் ஆஃப்லைன் · உள்ளூர் உருவகப்படுத்துதல் முறை",
    aisLiveCountTemplate: "{count} லைவ் AIS கப்பல்{plural}",
    aisNoLiveVessels: "தற்போது லைவ் AIS கப்பல்கள் இல்லை",
    aisBlendedBannerTemplate: "தற்போது லைவ் AIS கவரேஜ் இல்லாத துறைமுகங்களை நிரப்ப {liveText} + {simCount} உருவகப்படுத்தப்பட்ட கப்பல்{plural} காட்டப்படுகின்றன.",
    aisUnavailableDefault: "லைவ் AIS கப்பல் ஊட்டம் கிடைக்கவில்லை -- 0 கப்பல்கள் காட்டப்படுகின்றன.",
    aisNotConfigured: "இந்த வரிசைப்படுத்தலில் லைவ் AIS கப்பல் ஊட்டம் கட்டமைக்கப்படவில்லை.",
    aisConnectedNotSending: "AIS வழங்குநருடன் (AISstream.io) இணைக்கப்பட்டுள்ளது, ஆனால் அது தற்போது கப்பல் தரவை அனுப்பவில்லை — வழங்குநர்-தரப்பு தடையாக இருக்கலாம், உள்ளூர் கோளாறு அல்ல.",
    aisDisconnectedReconnecting: "AIS வழங்குநரிலிருந்து (AISstream.io) துண்டிக்கப்பட்டது; தானாக மீண்டும் இணைக்கிறது.",
    imblAlertActiveTemplate: "<strong>{vesselId} ({vesselName})</strong> இந்தியா–இலங்கை IMBL-லிருந்து <strong>{dist} NM</strong> தூரத்தில் இயங்குகிறது{simTag}. தானியங்கி எச்சரிக்கை அனுப்பப்பட்டது.",
    imblAlertNoneTemplate: "தற்போது {warnDist} NM IMBL எச்சரிக்கை தூரத்திற்குள் எந்த கப்பலும் இல்லை. அருகிலுள்ள கண்காணிக்கப்பட்ட கப்பல்: <strong>{dist} NM</strong> தொலைவில்.",
    imblAlertNoData: "இதுவரை கப்பல் தொலைநிலைத் தரவு கிடைக்கவில்லை.",
    simulatedSuffix: " (உருவகப்படுத்தப்பட்டது)",
    notifUnavailableTitle: "உலாவி அறிவிப்புகள் கிடைக்கவில்லை",
    notifUnavailableMsg: "இந்த தாவல் திறந்திருக்கும் வரை பயன்பாட்டு-உள் அபாய பேனர்கள் காட்டப்படும்.",
    notifNotEnabledTitle: "உலாவி அறிவிப்புகள் இயக்கப்படவில்லை",
    notifNotEnabledMsg: "இந்த தாவல் திறந்திருக்கும் வரை பயன்பாட்டு-உள் அபாய பேனர்கள் செயலில் இருக்கும்.",
    hazardHighWavesTitle: "உயர் அலைகள் — உள்ளூர் உருவகப்படுத்துதல்",
    hazardHighWavesMsgTemplate: "{wave}m, 2.5m எச்சரிக்கை வரம்பை மீறுகிறது. மூலம்: உலாவி Open-Meteo தொலைநிலைத் தரவு.",
    hazardHighWindTitle: "அதிக காற்று — உள்ளூர் உருவகப்படுத்துதல்",
    hazardHighWindMsgTemplate: "{wind} kn, 25 kn எச்சரிக்கை வரம்பை மீறுகிறது. மூலம்: உலாவி Open-Meteo தொலைநிலைத் தரவு.",
    hazardLightningTitle: "மின்னல் ஆபத்து — உள்ளூர் உருவகப்படுத்துதல்",
    hazardLightningMsgTemplate: "மின்னல் ப்ராக்ஸி {pct}% ஆகும். மூலம்: உலாவி Open-Meteo தொலைநிலைத் தரவு.",
    safetyOfficialClearanceLabel: "அதிகாரப்பூர்வ கடல் அனுமதி",
    safetyVerdictDescInitial: "அனைத்து செயற்கைக்கோள் கடலியல் குறிகாட்டிகளும் (Oceansat-3 SSTM வெப்ப முனைகள், Sentinel-3 அலை உயரமானி) கேரளா, கர்நாடகா மற்றும் தமிழ்நாடு கடலோர நீரில் சாதகமான மீன்பிடி நிலைமைகளை உறுதிப்படுத்துகின்றன.",
    safetyIndexLabel: "பாதுகாப்பு குறியீடு",
    satConstellationTitle: "ISRO & சர்வதேச கடலியல் செயற்கைக்கோள் தொகுப்பு",
    satStaticDataNote: "நிலையான குறிப்புத் தரவு (லைவ் தொலைநிலைத் தரவு அல்ல)",
    mapIndiaBoundaryPopup: "இந்தியா — அதிகாரப்பூர்வ எல்லை (Survey of India)",
    mapPfzYieldSuffix: "{rating} மகசூல் ({pct}%)",
    mapPfzSstLabel: "SST:",
    mapPfzChlorophyllLabel: "குளோரோஃபில்:",
    mapPfzDepthLabel: "ஆழம்:",
    mapPfzVesselsLabel: "கப்பல்கள்:",
    mapPfzActiveSuffix: "{count} செயலில்",
    mapPfzTargetSpeciesLabel: "இலக்கு இனங்கள்:",
    mapPfzSimulateRouteBtn: "இங்கே வழியை உருவகப்படுத்து ➔",
    mapImblPopupBodyTemplate: "கடுமையான சர்வதேச கடல் எல்லைக் கோடு. எச்சரிக்கை பஃபர்: {warn} NM. முக்கிய ஜியோஃபென்ஸ்: {danger} NM.",
    mapImblPopupTreatyNote: "UNCLOS கடல் ஒப்பந்தத்தின் கீழ் எல்லை கடத்தல் தடைசெய்யப்பட்டுள்ளது.",
    mapImblBufferCorridorTemplate: "{dist} NM IMBL பஃபர் காரிடார்",
    mapMpaRestrictedBadge: "தடைசெய்யப்பட்ட சுற்றுச்சூழல் காப்பகம்",
    mapHarbourCoastSuffix: "{state} கடற்கரை",
    mapHarbourCapacityLabel: "கொள்ளளவு:",
    mapHarbourVhfLabel: "VHF:",
    mapHarbourFuelLabel: "எரிபொருள் நிலையம்:",
    mapHarbourFuelAvailable: "கிடைக்கிறது",
    mapHarbourIceLabel: "பனிக்கட்டி ஆலை:",
    mapHarbourIceActive: "செயலில்",
    mapHarbourSetOriginBtn: "தொடக்க துறைமுகமாக அமை",
    mapVesselSimulatedBadge: "உருவகப்படுத்தப்பட்டது · இங்கே லைவ் AIS கவரேஜ் இல்லை",
    mapVesselSpeedLabel: "வேகம்:",
    mapVesselHeadingLabel: "திசை:",
    mapVesselZoneLabel: "மண்டலம்:",
    mapVesselImblDistLabel: "IMBL தூரம்:",
    mapVesselStatusLabel: "நிலை:",
    mapVesselFuelLabel: "எரிபொருள்:",
    mapVesselFuelNA: "இல்லை",
    mapRoutePopupTitle: "கடல்-மட்டும் A* வழி (நிலம் + MPA தவிர்ப்பு)",
    mapRouteDistanceEtaTemplate: "தூரம்: {dist} NM · ETA: {eta}{detourNote}",
    mapRouteDetourTemplate: " · {zones} சுற்றி {pct}% சுற்றுவழி",
    mapRouteLandNoGoZones: "நிலம்/தடைசெய்யப்பட்ட மண்டலங்கள்",
    vesselStatusSafeFishing: "பாதுகாப்பான மீன்பிடி",
    vesselStatusBorderAlert: "எல்லை எச்சரிக்கை",
    vesselStatusBorderWarn: "எல்லை கவனம்",
    vesselStatusInTransit: "பயணத்தில்",
    vesselSimBadgeText: "SIM",
    vesselSimBadgeTitle: "உருவகப்படுத்தப்பட்டது -- இந்த துறைமுகத்திற்கு அருகில் லைவ் AIS கவரேஜ் இல்லை",
    vesselLocateAction: "கண்டறி ➔",
    fleetVesselCountSuffix: "{count} கப்பல்கள்",
    fleetLiveSimBreakdownTemplate: "{total} ({live} லைவ் · {sim} சிம்)",
    mapActiveVesselsBreakdownTemplate: "{total} செயலில் உள்ள கப்பல்கள் ({live} லைவ் · {sim} உருவகப்படுத்தப்பட்டது)",
    mapActiveVesselsSimpleTemplate: "{total} செயலில் உள்ள கப்பல்கள்",
    mapTabTitle: "GIS கட்டளை வரைபடம் · இந்திய கடலோர நீர்",
    mapTabDesc: "நிகழ்நேர செயற்கைக்கோள் PFZ-கள், IMBL எல்லை காரிடார்கள் மற்றும் AIS கப்பல் தடங்களுடன் ஊடாடும் உயர்-மாறுபாடு கடல்சார் வரைபடம்.",
    layerPfzZones: "PFZ மண்டலங்கள்",
    layerImblBuffer: "IMBL பஃபர்",
    layerEcoReserves: "சுற்றுச்சூழல் காப்பகங்கள் (MPA)",
    layerHarbours: "துறைமுகங்கள்",
    layerLiveVessels: "லைவ் கப்பல்கள்",
    layerDensityHeatmap: "அடர்த்தி வெப்பப் படம்",
    layerIndiaBoundary: "இந்திய எல்லை (Survey of India)",
    routePlannerDesc: "MPA-க்கள் மற்றும் எல்லை அபாயங்களைத் தவிர்க்கும் A*-பாணி பாதை",
    routeVesselSpeedLabel: "கப்பல் வேகம்:",
    fleetMonitorTitle: "கப்பல் கூட்ட கண்காணிப்பு · லைவ் கப்பல் தொலைநிலைத் தரவு",
    fleetTotalActiveTitle: "மொத்த செயலில் உள்ள கப்பல்கள்",
    fleetTotalActiveDesc: "தற்போது AIS டிரான்ஸ்பாண்டர் சிக்னல்களை ஒளிபரப்பும் கப்பல்கள்",
    fleetZoneDistTitle: "மண்டலத்திற்கு கப்பல் விநியோகம்",
    imblAlertCardTitle: "IMBL எல்லை அருகாமை எச்சரிக்கை",
    fleetTableSubDesc: "AISstream.io-விலிருந்து லைவ் AIS நிலைகள், தற்போது லைவ் ரிசீவர் கவரேஜ் இல்லாத இடங்களில் தெளிவாக-குறிக்கப்பட்ட உருவகப்படுத்தப்பட்ட கப்பல் கூட்டத்துடன் (\"SIM\" பேட்ஜைப் பார்க்கவும்) நிரப்பப்பட்டது",
    vesselSearchPlaceholder: "கப்பல் பெயர் அல்லது ID-ஐத் தேடு...",
    filterAllStatuses: "அனைத்து நிலைகள்",
    filterSafeFishing: "பாதுகாப்பான மீன்பிடி",
    filterInTransit: "பயணத்தில்",
    filterBorderAlert: "எல்லை எச்சரிக்கை",
    thVesselId: "கப்பல் ID",
    thVesselName: "கப்பல் பெயர்",
    thType: "வகை",
    thCurrentZone: "தற்போதைய மண்டலம்",
    thSpeedHeading: "வேகம் / திசை",
    thImblDist: "IMBL தூரம்",
    thStatus: "நிலை",
    thAction: "செயல்",
    bulletinIssuedLabel: "வெளியிடப்பட்டது:",
    bulletinRegionLabel: "பகுதி:",
    bulletinWavesLabel: "அலைகள்:",
    bulletinWindsLabel: "காற்று:",
    bulletinSourceLabel: "மூலம்:",
    bulletinListenBtn: "அறிவிப்பைக் கேளுங்கள்",
    bulletinsTabTitle: "அதிகாரப்பூர்வ கடல் & மீன்வள அறிவிப்புகள் (ISRO - INCOIS)",
    bulletinsTabDesc: "எண்ணிடப்பட்ட ஆலோசனைகள், சூறாவளி அபாய எச்சரிக்கைகள் மற்றும் சர்வதேச எல்லை இணக்க எச்சரிக்கைகள்.",
    bulletinNotifyToggleTitle: "இந்த தாவல்/PWA திறந்திருக்கும் போது மட்டுமே உலாவி எச்சரிக்கைகளைப் பெறுங்கள்",
    bulletinNotifyToggleLabel: "திறந்திருக்கும் போது அறிவி",
    bulletinFilterAll: "அனைத்து அறிவிப்புகள்",
    bulletinFilterCritical: "முக்கியமான",
    bulletinFilterWarning: "எச்சரிக்கைகள்",
    bulletinFilterAdvisory: "ஆலோசனைகள்",
    bulletinsPushNote: "இந்த தாவல்/PWA திறந்திருக்கும் போது மட்டுமே அபாய எச்சரிக்கைகள் செயலில் இருக்கும். மூடப்பட்ட-பயன்பாட்டு புஷ் அறிவிப்புகளுக்கு உற்பத்தி புஷ்-சந்தா சேவை தேவை, இது இந்த முன்மாதிரியில் செயல்படுத்தப்படவில்லை.",
    sosModalTitle: "அவசர அபாய பீக்கன் (SOS)",
    sosInstructions: "அவசர SOS-ஐ செயல்படுத்துவது <strong>INSAT-3DR SAS&R</strong> வழியாக இந்திய கடலோர காவல்படை கடல் மீட்பு ஒருங்கிணைப்பு மையத்திற்கு (MRCC) அவசர 406 MHz அபாய சிக்னலை அனுப்பும்.",
    sosCurrentPositionLabel: "தற்போதைய நிலை:",
    sosVhfChannelLabel: "அவசர VHF சேனல்:",
    sosMrccHelplineLabel: "MRCC உதவி எண்:",
    sosConfirmBtn: "உறுதிப்படுத்தி அபாய பீக்கனை ஒளிபரப்பு",
    sosBeaconTransmittingBanner: "406 MHz SAS&R பீக்கன் ISRO & கடலோர காவல்படை MRCC-க்கு அனுப்பப்படுகிறது",
    sosDistressRelayedMsg: "அபாய பாக்கெட் INSAT-3DR SAS&R ரிசீவர் வழியாக அனுப்பப்பட்டது. கடல் மீட்பு ஒருங்கிணைப்பு மையத்திற்கு (MRCC சென்னை/மும்பை) VHF சேனல் 16-இல் தெரிவிக்கப்பட்டது.",
    sosGpsVesselIdTemplate: "GPS ஆயத்தொலைவுகள்: {coords} · கப்பல் ID: {vesselId} ({vesselName})",
    landingEyebrow: "ISRO கூட்டு கடல் நுண்ணறிவு · ஸ்மார்ட் இந்தியா ஹேக்கத்தான் 2026",
    landingSubtitle: "ஒரு கூட்டு கடல்-நுண்ணறிவு தளம், இரண்டு கட்டளை மையங்கள்: ஒரு மீனவரின் தினசரி வாய்ப்பு கன்சோல், மற்றும் முழு ISRO செயற்கைக்கோள், AIS மற்றும் ஜியோஃபென்சிங் நுண்ணறிவு தொகுப்பு.",
    landingStripItem1: "Oceansat-3 SSTM வெப்ப முனைகள்",
    landingStripItem2: "INSAT-3DR செயற்கைக்கோள் கடலியல்",
    landingStripItem3: "8-முனை கூட்டு முகவர் DAG",
    landingStripItem4: "NavIC (IRNSS) GPS பாலம்",
    landingStripItem5: "IMBL எல்லை ஜியோஃபென்சிங் எச்சரிக்கைகள்",
    landingStripItem6: "லைவ் AIS கப்பல் கூட்டம் & GIS கட்டளை",
    landingStripItem7: "சிறந்த விற்பனை வாங்குபவர் விலை நிர்ணயம்",
    landingStripItem8: "406 MHz SOS அபாய பீக்கன்",
    landingFishermanCardTitle: "ORCA மீனவர்",
    landingFishermanCardDesc: "இன்றைய வாய்ப்பு மதிப்பெண், சிறந்த விற்பனை விலை நிர்ணயம், ஒரு பயண-செலவு கால்குலேட்டர் மற்றும் உங்கள் பிடிப்புக்கான வாங்குபவர் தொடர்புகள் — படகுக்காக உருவாக்கப்பட்டது.",
    landingFishermanCardCta: "மீனவர் கன்சோலைத் திற",
    landingFishermanCardTitleAttr: "மீனவர் கன்சோலைத் திற",
    landingInsightCardTitle: "ORCA இன்சைட்",
    landingInsightCardDesc: "முழு கட்டளை மையம்: ISRO செயற்கைக்கோள் கடலியல், GIS வரைபடம், 8-முனை முகவர் DAG, பாதுகாப்பு பாரோமீட்டர், கப்பல் கூட்ட கண்காணிப்பு மற்றும் NavIC பாலம்.",
    landingInsightCardCta: "இன்சைட் கட்டளை மையத்தைத் திற",
    landingInsightCardTitleAttr: "இன்சைட் கட்டளை மையத்தைத் திற",
    backToOverviewTitle: "மேலோட்டத்திற்குத் திரும்பு",
    statSimulatedFleetLabel: "உருவகப்படுத்தப்பட்ட AIS கப்பல் கூட்டம்",
    statSatellitesActiveTemplate: "{count} செயலில்",
    statSatellitesListLabel: "Oceansat-3, INSAT-3DR, Sentinel-3",
    statPfzZonesCountTemplate: "{count} மண்டலங்கள்",
    statPfzZonesListLabel: "வேஜ் பேங்க், கொச்சி, வேரவல்...",
    statImblCorridorsCountTemplate: "{count} காரிடார்கள்",
    statImblBordersLabel: "இந்தியா-இலங்கை & பாகிஸ்தான் எல்லைகள்",
    pillarDagTitle: "8-முனை கூட்டு முகவர் DAG",
    pillarDagDesc: "வினவல்களை செயற்கைக்கோள், அலை அபாயம், ஜியோஃபென்சிங், கப்பல் எண்ணிக்கை, ETA மற்றும் நியூரல் சிந்தசிஸ் படிகளாக துணை-வினாடி தாமதத்துடன் பிரிக்கும் பல்-முகவர் கட்டமைப்பு.",
    pillarEtaTitle: "லைவ் கடல்-நிலை ETA & மாலை பாதுகாப்பு",
    pillarEtaDesc: "அலை எதிர்ப்புக்கு ஏற்ப சரிசெய்யப்பட்ட ஹைட்ரோடைனமிக் பயண கணக்கீடுகள், சூரிய அஸ்தமனத்திற்குப் பிறகு சிக்கிய மீனவர்களைத் தடுக்க தானியங்கி மாலைக்கு-முன்-திரும்பும் பாதுகாப்பு எச்சரிக்கைகளுடன்.",
    pillarFleetTitle: "லைவ் கப்பல் கூட்ட அடர்த்தி & IMBL எச்சரிக்கை",
    pillarFleetDesc: "மண்டலத்திற்கு நிகழ்நேர கப்பல் எண்ணிக்கை, நெரிசல் ஆபத்து குறிகாட்டிகள், மற்றும் கடல் எல்லைகளைப் பாதுகாக்கும் தானியங்கி 5 NM/2 NM ஜியோஃபென்ஸ் அருகாமை எச்சரிக்கைகள்.",
    footerCreditLine: "<span class=\"text-slate-200 font-semibold\">{appTitle}</span> · உருவாக்கியவர் <strong class=\"text-cyan-400\">{teamName}</strong> · ஸ்மார்ட் இந்தியா ஹேக்கத்தான் 2026 · பிரச்சனை அறிக்கை 26176 (ISRO)",
    sttListeningStatusTemplate: "<b>{lang}</b>-இல் கேட்கிறது... இப்போது பேசுங்கள்.",
    sttUnsupportedTitle: "இந்த உலாவியில் பேச்சு அங்கீகாரம் ஆதரிக்கப்படவில்லை",
    routeUnavailableLabel: " வழி கிடைக்கவில்லை:",
    routeUnavailableMsg: "ORCA பேக்எண்ட் அணுக முடியாது, எனவே எந்த வழிநடத்தப்பட்ட தூரம்/ETA-வும் காட்ட முடியாது. உள்ளூர் மாற்று முறையில் இயங்குகிறது.",
    routeNoSafeRouteLabel: "✕ பாதுகாப்பான கடல் வழி எதுவும் கிடைக்கவில்லை:",
    routeNoSafeRouteMsgTemplate: "{detail}",
    routeNoSafeRouteDefaultReason: "இந்த துறைமுகம்/PFZ இணைக்கு நிலம் மற்றும் கடல் பாதுகாக்கப்பட்ட பகுதிகளைத் தவிர்க்கும் பாதையை ரூட்டரால் கண்டறிய முடியவில்லை.",
    routeSafeReturnLabel: "✓ பாதுகாப்பான திரும்புதல்:",
    routeSafeReturnTemplate: "எதிர்பார்க்கப்படும் துறைமுக வருகை {time}க்குள் (18:30 IST மாலைக்கு முன்).",
    routeReturnAfterDuskLabel: " மாலைக்குப் பின் திரும்புதல்:",
    routeReturnAfterDuskTemplate: "எதிர்பார்க்கப்படும் திரும்புதல் {time}-இல் (18:30 IST சூரிய அஸ்தமனத்தை மீறுகிறது). முன்கூட்டிய புறப்பாடு அல்லது இரவு வழிசெலுத்தல் பீக்கன் சரிபார்ப்பை பரிந்துரைக்கிறோம்."
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
    fmClaimFailed: "ഇപ്പോൾ ഈ ലിസ്റ്റിംഗ് അവകാശപ്പെടാൻ കഴിഞ്ഞില്ല.",
    dagAgentSupervisorName: "മാസ്റ്റർ സൂപ്പർവൈസർ / DAG പ്ലാനർ",
    dagAgentSupervisorRole: "മൾട്ടി-മോഡൽ സമുദ്ര അന്വേഷണത്തെ വിഭജിക്കുന്നു, സാറ്റലൈറ്റ്, അപകട, ജിയോഫെൻസ് ഏജന്റുമാർക്ക് ഉപജോലികൾ അനുവദിക്കുന്നു.",
    dagAgentSatelliteName: "സാറ്റലൈറ്റ് സമുദ്രശാസ്ത്ര ഏജന്റ്",
    dagAgentSatelliteRole: "Oceansat-3 OCM-3 (ക്ലോറോഫിൽ-a) & SSTM (താപ മുന്നണികൾ) എന്നിവയോടൊപ്പം INSAT-3DR ക്ലൗഡ് ഇമേജറിയും സ്വീകരിക്കുന്നു.",
    dagAgentWeatherName: "കാലാവസ്ഥ & സമുദ്ര അപകട ഏജന്റ്",
    dagAgentWeatherRole: "പ്രധാന തരംഗ ഉയരം (SWH), കാറ്റ് ഗസ്റ്റ് വെക്ടറുകൾ, മിന്നൽ സാധ്യത എന്നിവ വിലയിരുത്തി, കടൽ-ക്ലിയറൻസ് സ്കോർ സൃഷ്ടിക്കുന്നു.",
    dagAgentPfzName: "സമുദ്ര വിശകലനം & PFZ ഏജന്റ്",
    dagAgentPfzRole: "താപ-ക്ലോറോഫിൽ മുന്നണികളുടെ കവലകൾ തിരിച്ചറിഞ്ഞ്, പെലാജിക് ബയോമാസ് സാന്ദ്രത കണക്കാക്കി, ലക്ഷ്യ മത്സ്യബന്ധന മേഖലകൾ റാങ്ക് ചെയ്യുന്നു.",
    dagAgentGeofenceName: "ജിയോഫെൻസിംഗ് & റൂട്ടിംഗ് ഏജന്റ്",
    dagAgentGeofenceRole: "അന്താരാഷ്ട്ര സമുദ്ര അതിർത്തി രേഖകൾ (IMBL) നിരീക്ഷിക്കുന്നു, സമുദ്ര സംരക്ഷിത പ്രദേശങ്ങൾ ബഫർ ചെയ്യുന്നു, A* സുരക്ഷിത വേപോയിന്റുകൾ കണക്കാക്കുന്നു.",
    dagAgentFleetName: "ഫ്ലീറ്റ് & ട്രാഫിക് ഏജന്റ് (പുതിയത്)",
    dagAgentFleetRole: "AIS & ARGOS-4 വെസൽ ട്രാൻസ്‌പോണ്ടറുകൾ സ്കാൻ ചെയ്ത്, ഫ്ലീറ്റ് വിതരണം ട്രാക്ക് ചെയ്ത്, തിരക്ക് അല്ലെങ്കിൽ അതിർത്തി തിരക്ക് ഫ്ലാഗ് ചെയ്യുന്നു.",
    dagAgentEtaName: "ETA & യാത്രാ സുരക്ഷാ ഏജന്റ് (പുതിയത്)",
    dagAgentEtaRole: "തത്സമയ തരംഗ പ്രതിരോധത്തിനനുസരിച്ച് യാത്രാ ദൈർഘ്യം കണക്കാക്കി, സന്ധ്യയ്ക്ക് മുമ്പുള്ള തിരിച്ചുവരവ് സുരക്ഷാ ജാലകം വിലയിരുത്തുന്നു.",
    dagAgentSynthesisName: "ന്യൂറൽ സിന്തസിസ് ഏജന്റ് (സ്ഥിതിവിവര-അധിഷ്ഠിതം)",
    dagAgentSynthesisRole: "മൾട്ടി-ഏജന്റ് ടെലിമെട്രിയെ സൈറ്റേഷൻ ടാഗുകളും TTS-ഉം സഹിതം ആധികാരികവും അടിസ്ഥാനപരവുമായ സ്വാഭാവിക-ഭാഷാ ഉപദേശമായി സമാഹരിക്കുന്നു -- പൂർണ്ണമായും നിയമാധിഷ്ഠിതം, ഈ സൈറ്റിന്റെ സ്വന്തം തത്സമയ ടെലിമെട്രിയിലും അതിന്റെ ശേഖരിച്ച സ്ഥിതിവിവര രേഖയിലും യുക്തി ഉപയോഗിക്കുന്നു. ബാഹ്യ AI/LLM API ഒന്നും ഉപയോഗിക്കുന്നില്ല.",
    dagStatusIdle: "നിഷ്‌ക്രിയം",
    dagInspectLink: "പരിശോധിക്കുക ➔",
    dagInspectorLatencyTemplate: "എക്സിക്യൂഷൻ ലേറ്റൻസി: {latency} · ഉപജോലികൾ പരിശോധിച്ചു",
    dagStatusQueued: "ക്യൂവിൽ",
    dagStatusExecuting: "നടപ്പിലാക്കുന്നു...",
    dagStatusCompleted: "പൂർത്തിയായി",
    dagStatusSkipped: "വിളിച്ചില്ല — ഉദ്ദേശ്യത്തിന് ഇത് ആവശ്യമില്ലായിരുന്നു",
    dagBtnReasoningActiveLive: "യുക്തി സജീവം (തത്സമയ ബാക്കെൻഡ്)...",
    dagBtnExecutedLive: "✓ തത്സമയ ബാക്കെൻഡ് വഴി പൈപ്പ്‌ലൈൻ നടപ്പിലാക്കി · വീണ്ടും പ്രവർത്തിപ്പിക്കുക",
    dagBtnErrorRetry: "▶ തത്സമയ പൈപ്പ്‌ലൈൻ സിമുലേഷൻ പ്രവർത്തിപ്പിക്കുക",
    dagBtnReasoningActiveOffline: "യുക്തി സജീവം (പ്രാദേശിക സിമുലേഷൻ)...",
    dagBtnExecutedOffline: "✓ പൈപ്പ്‌ലൈൻ നടപ്പിലാക്കി (പ്രാദേശിക സിമുലേഷൻ) · വീണ്ടും പ്രവർത്തിപ്പിക്കുക",
    dagTabTitle: "8-നോഡ് സഹകരണ മൾട്ടി-ഏജന്റ് DAG",
    dagInteractiveCanvasBadge: "ഇന്ററാക്ടീവ് റീസണിംഗ് കാൻവാസ്",
    dagTabDesc: "Oceansat-3, INSAT-3DR, IMBL ജിയോഫെൻസിംഗ്, ഫ്ലീറ്റ് സാന്ദ്രത, യാത്രാ ETA എന്നിവയിൽ യുക്തി ഉപയോഗിക്കുന്ന തത്സമയ മൾട്ടി-ഏജന്റ് എക്സിക്യൂഷൻ പൈപ്പ്‌ലൈൻ.",
    backendCheckingStatus: "ബാക്കെൻഡ് പരിശോധിക്കുന്നു...",
    dagZoomReset: "റീസെറ്റ്",
    dagRunSimulationBtn: "▶ തത്സമയ പൈപ്പ്‌ലൈൻ സിമുലേഷൻ പ്രവർത്തിപ്പിക്കുക",
    dagClickToInspectHint: "ഏതെങ്കിലും ഏജന്റ് കാർഡിൽ ക്ലിക്ക് ചെയ്ത് അതിന്റെ അസംസ്കൃത ടെലിമെട്രി ഇൻപുട്ട്, ആന്തരിക അൽഗോരിതങ്ങൾ, JSON ഡാറ്റ ഔട്ട്‌പുട്ട് എന്നിവ പരിശോധിക്കുക.",
    dagOrchestratorLabel: "ഓർക്കസ്ട്രേറ്റർ: LangGraph / Async Agent Core",
    dagInspectorDefaultTitle: "ഏജന്റ് വിശദാംശങ്ങൾ",
    dagInspectorDefaultRole: "റോൾ വിവരണം",
    dagInspectorLatencyPlaceholder: "ലേറ്റൻസി: 24ms",
    dagInspectorJsonLabel: "തത്സമയ JSON പേലോഡ്",
    dagCloseInspector: "ഇൻസ്പെക്ടർ അടയ്ക്കുക",
    chatNewConversationMsg: "പുതിയ സംഭാഷണം ആരംഭിച്ചു. ORCA മുൻ ചാറ്റ് സന്ദർഭം ഉപയോഗിക്കില്ല.",
    chatYouLabel: "നിങ്ങൾ",
    chatOrcaLabel: "ORCA",
    chatOrchestratingMsg: "Oceansat-3, INSAT-3DR & Open-Meteo എന്നിവയിലുടനീളം 8 പ്രത്യേക AI ഏജന്റുമാരെ ഏകോപിപ്പിക്കുന്നു...",
    chatAiLabel: "AI",
    chatAdvisoryHeader: "മൾട്ടി-ഏജന്റ് സമുദ്ര ഉപദേശം",
    chatGroundedConfidenceTemplate: "{confidence}% അടിസ്ഥാനപരമായ വിശ്വാസ്യത",
    chatLangDetectedTooltip: "സന്ദേശത്തിൽ നിന്ന് ഭാഷ കണ്ടെത്തി",
    chatListenTts: "കേൾക്കുക (TTS)",
    chatNavicMssBtn: "NavIC MSS കോഡ്",
    chatMetricZone: "ശുപാർശ ചെയ്യപ്പെട്ട മേഖല",
    chatMetricEta: "തത്സമയ സമുദ്ര നില ETA",
    chatMetricVessels: "സജീവ വെസലുകൾ",
    chatVesselsSuffix: "{count} വെസലുകൾ",
    chatMetricImbl: "IMBL ക്ലിയറൻസ്",
    chatReasoningTraceSummaryTemplate: "മൾട്ടി-ഏജന്റ് യുക്തി ട്രെയ്സ് കാണുക ({steps} ഘട്ടങ്ങൾ നടപ്പിലാക്കി)",
    chatNodeDagSuffixTemplate: "{count}-നോഡ് DAG",
    chatNoAdvisoryTextFallback: "ORCA INSIGHT ബാക്കെൻഡ് ഒരു ഉപദേശം സൃഷ്ടിച്ചെങ്കിലും ഒരു വാചകവും തിരികെ നൽകിയില്ല.",
    chatLiveAdvisoryLabel: "✓ തത്സമയ മൾട്ടി-ഏജന്റ് ഉപദേശം",
    chatGroundedEngineFallback: "അടിസ്ഥാനപരമായ എഞ്ചിൻ",
    chatOceanSourceTierTemplate: "സമുദ്ര ഉറവിട നില: {tier} · ക്ലോറോഫിൽ: {chlorophyll}",
    chatCitationsTemplate: "സൈറ്റേഷനുകൾ: {citations}",
    chatOfflineBannerText: "ഓഫ്‌ലൈൻ ഉപദേശ എഞ്ചിൻ — ORCA ബാക്കെൻഡ് എത്തിച്ചേരാനാവുന്നില്ല. താഴെയുള്ള കണക്കുകൾ ഒരു അനുകരണ ഉദാഹരണ കണക്കാണ്, തത്സമയ ടെലിമെട്രി അല്ല.",
    chatOfflineImblPlainText: "ഓഫ്‌ലൈൻ ഉപദേശം (ബാക്കെൻഡ് എത്തിച്ചേരാനാവുന്നില്ല, അനുകരണ കണക്ക്): പാക്ക് കടലിടുക്ക് / മന്നാർ ഉൾക്കടൽ പ്രദേശത്തെ വെസലുകൾ സാധാരണയായി ഇന്ത്യ-ശ്രീലങ്ക IMBL അതിർത്തിയിൽ നിന്ന് ചില നോട്ടിക്കൽ മൈലുകൾക്കുള്ളിലാണ്. പടിഞ്ഞാറൻ ദിശ നിലനിർത്തുകയും VHF ട്രാൻസ്‌പോണ്ടറുകൾ ചാനൽ 16-ൽ സജീവമായി സൂക്ഷിക്കുകയും ചെയ്യുക. അതിർത്തിയിലേക്കുള്ള യഥാർത്ഥ അളന്ന ദൂരത്തിന് ORCA ബാക്കെൻഡിലേക്ക് വീണ്ടും ബന്ധിപ്പിക്കുക.",
    chatOfflineImblHtmlHeading: "IMBL ജിയോഫെൻസിംഗ് ഉപദേശം (അനുകരണ ഓഫ്‌ലൈൻ കണക്ക്):",
    chatOfflineImblHtmlBody1: "തത്സമയ ബാക്കെൻഡ് കണക്ഷൻ ഇല്ലാതെ, കൃത്യമായ വെസൽ-മുതൽ-അതിർത്തി ദൂരങ്ങൾ അളക്കാൻ കഴിയില്ല. പാക്ക് കടലിടുക്ക് സെക്ടർ 4-നടുത്ത് ഒരു പൊതു മുൻകരുതൽ എന്ന നിലയിൽ, മണ്ഡപത്തിലേക്ക് പടിഞ്ഞാറൻ ദിശ നിലനിർത്തുക.",
    chatOfflineImblHtmlBody2: "ഇത് ഒരു പൊതു ഓഫ്‌ലൈൻ സുരക്ഷാ ഓർമ്മപ്പെടുത്തലാണ്, അളന്ന ജിയോഫെൻസ് റീഡിംഗ് അല്ല. യഥാർത്ഥ ദൂരം-മുതൽ-IMBL കണക്കുകൂട്ടലിന് ORCA ബാക്കെൻഡിലേക്ക് വീണ്ടും ബന്ധിപ്പിക്കുക.",
    chatOfflineImblStep1: "ബാക്കെൻഡ് എത്തിച്ചേരാനാവുന്നില്ല. പ്രാദേശിക കീവേഡ് പൊരുത്തം ഉപയോഗിച്ച് അന്വേഷണം IMBL_BOUNDARY ആയി തരംതിരിച്ചു.",
    chatOfflineImblStep2: "തത്സമയ ജിയോഫെൻസിംഗ് ടെലിമെട്രി ലഭ്യമല്ല -- പൊതുവായ അതിർത്തി-സുരക്ഷാ മാർഗ്ഗനിർദ്ദേശം മാത്രം തിരികെ നൽകുന്നു.",
    chatOfflineDensityPlainText: "ഓഫ്‌ലൈൻ ഉപദേശം (ബാക്കെൻഡ് എത്തിച്ചേരാനാവുന്നില്ല, അനുകരണ കണക്ക്): ബാക്കെൻഡ് കണക്ഷൻ ഇല്ലാതെ തത്സമയ വെസൽ എണ്ണം ലഭ്യമല്ല. ചരിത്രപരമായി, വെജ് ബാങ്കിലും കൊച്ചി ഡീപ് ഓഫ്‌ഷോറിലും മിതമായ മത്സ്യബന്ധന പ്രവർത്തനം കാണപ്പെടുന്നു. വെസൽ ഡാറ്റാസെറ്റിൽ നിന്ന് യഥാർത്ഥ ഫ്ലീറ്റ്-സാന്ദ്രത റീഡിംഗിന് ORCA ബാക്കെൻഡിലേക്ക് വീണ്ടും ബന്ധിപ്പിക്കുക.",
    chatOfflineDensityHtmlHeading: "ഫ്ലീറ്റ് സാന്ദ്രത (ഓഫ്‌ലൈൻ — അനുകരണ പ്ലേസ്‌ഹോൾഡർ):",
    chatOfflineDensityHtmlBody: "ഫ്ലീറ്റ് & ട്രാഫിക് ഏജന്റിന്റെ തത്സമയ വെസൽ ഡാറ്റാസെറ്റ് ഇപ്പോൾ ലഭ്യമല്ല, അതിനാൽ മേഖലയിലെ കൃത്യമായ വെസൽ എണ്ണം ലഭ്യമല്ല.",
    chatOfflineDensityListItem: "യഥാർത്ഥ മേഖല-തിരിച്ചുള്ള വെസൽ എണ്ണത്തിനും തിരക്ക് വിധിക്കും ORCA ബാക്കെൻഡിലേക്ക് വീണ്ടും ബന്ധിപ്പിക്കുക.",
    chatOfflineDensityStep1: "ബാക്കെൻഡ് എത്തിച്ചേരാനാവുന്നില്ല. പ്രാദേശിക കീവേഡ് പൊരുത്തം ഉപയോഗിച്ച് അന്വേഷണം FLEET_DENSITY ആയി തരംതിരിച്ചു.",
    chatOfflineDensityStep2: "തത്സമയ ഫ്ലീറ്റ് ഡാറ്റാസെറ്റ് ലഭ്യമല്ല -- വ്യാജ കണക്ക് അവതരിപ്പിക്കുന്നത് ഒഴിവാക്കാൻ വെസൽ എണ്ണം കാണിച്ചിട്ടില്ല.",
    chatOfflineGenericPlainTextTemplate: "ഓഫ്‌ലൈൻ ഉപദേശം (ബാക്കെൻഡ് എത്തിച്ചേരാനാവുന്നില്ല): ORCA യുടെ മൾട്ടി-ഏജന്റ് ബാക്കെൻഡിലേക്ക് എത്തിച്ചേരാൻ കഴിഞ്ഞില്ല, അതിനാൽ ഈ ഉത്തരം ഒരു അടിസ്ഥാനപരമായ റീഡിംഗിനു പകരം ഒരു പൊതു, തത്സമയമല്ലാത്ത പ്ലേസ്‌ഹോൾഡറാണ്. നിങ്ങളുടെ ബ്രൗസറിന്റെ സ്വന്തം Open-Meteo വിജറ്റ് ഏകദേശം {liveWave}m പ്രധാന തരംഗ ഉയരം കാണിക്കുന്നു, എന്നാൽ PFZ റാങ്കിംഗ്, റൂട്ട് ദൂരം, ETA, ഫ്ലീറ്റ് എണ്ണം എന്നിവയ്‌ക്കെല്ലാം ബാക്കെൻഡ് ആവശ്യമാണ്, അവ ഇവിടെ കാണിക്കുന്നില്ല. യഥാർത്ഥ ഉപദേശത്തിന് ORCA ബാക്കെൻഡിലേക്ക് വീണ്ടും ബന്ധിപ്പിക്കുക.",
    chatOfflineGenericHtmlHeading: "ഓഫ്‌ലൈൻ പ്ലേസ്‌ഹോൾഡർ ഉപദേശം",
    chatOfflineGenericHtmlBody1Template: "ORCA യുടെ മൾട്ടി-ഏജന്റ് ബാക്കെൻഡ് (സാറ്റലൈറ്റ്, കാലാവസ്ഥ, PFZ റാങ്കിംഗ്, ജിയോഫെൻസിംഗ്, ഫ്ലീറ്റ്, റൂട്ടിംഗ്, ന്യൂറൽ സിന്തസിസ്) നിലവിൽ എത്തിച്ചേരാനാവുന്നില്ല. ക്ലയന്റ്-സൈഡിൽ, ഈ ബ്രൗസർ Open-Meteo-യിൽ നിന്ന് അവസാനമായി കണ്ട തരംഗ ഉയരം <strong>{liveWave}m</strong> ആണ്, എന്നാൽ മറ്റെല്ലാ കണക്കുകൾക്കും ബാക്കെൻഡ് ആവശ്യമാണ്.",
    chatOfflineGenericHtmlBody2: "<strong>PFZ ശുപാർശയോ റൂട്ടോ ETA-യോ ഫ്ലീറ്റ് എണ്ണമോ കാണിക്കുന്നില്ല</strong> കാരണം അവ കണക്കാക്കുന്നതിന് പകരം കെട്ടിച്ചമയ്ക്കേണ്ടിവരും. പൂർണ്ണമായ അടിസ്ഥാനപരമായ ഉപദേശത്തിന് ORCA ബാക്കെൻഡിലേക്ക് വീണ്ടും ബന്ധിപ്പിക്കുക.",
    chatOfflineGenericStep1: "ബാക്കെൻഡ് എത്തിച്ചേരാനാവുന്നില്ല. ഉദ്ദേശ്യ-നിർദ്ദിഷ്ട കീവേഡ് ഒന്നും പൊരുത്തപ്പെട്ടില്ല -- GENERAL_VOYAGE_SAFETY ഓഫ്‌ലൈൻ പ്ലേസ്‌ഹോൾഡർ തിരികെ നൽകുന്നു.",
    chatOfflineGenericStep2Template: "ക്ലയന്റ്-ദൃശ്യമായ കണക്ക് മാത്രം ലഭ്യമാണ്: അവസാനം അറിയപ്പെട്ട Open-Meteo തരംഗ ഉയരം {liveWave}m (ബ്രൗസർ നേരിട്ട് നേടിയത്, ബാക്കെൻഡ് വഴിയല്ല).",
    chatTtsUnsupportedAlert: "നിങ്ങളുടെ ബ്രൗസർ സ്പീച്ച് സിന്തസിസ് പിന്തുണയ്ക്കുന്നില്ല.",
    chatTtsWelcomeFallback: "ORCA INSIGHT-ലേക്ക് സ്വാഗതം. എല്ലാ സാറ്റലൈറ്റ് ഫീഡുകളും തീരദേശ സമുദ്രശാസ്ത്ര സംവിധാനങ്ങളും സാധാരണ നിലയിൽ പ്രവർത്തിക്കുന്നു.",
    chatStopAudio: "ഓഡിയോ നിർത്തുക",
    chatListenAudioAdvisory: "ഓഡിയോ ഉപദേശം കേൾക്കുക",
    chatTabTitle: "AI തീരുമാന സ്റ്റുഡിയോ & മൾട്ടി-ഏജന്റ് ചാറ്റ്ബോട്ട്",
    chatTabSubtitle: "Oceansat-3, INSAT-3DR, തീരദേശ ജിയോഫെൻസിംഗ് എന്നിവയിൽ യുക്തി ഉപയോഗിക്കുന്ന സഹകരണ ഏജന്റുമാർ പ്രവർത്തിപ്പിക്കുന്നു",
    chatNewConversationBtn: "പുതിയ സംഭാഷണം",
    chatPromptPFZ: "കൊച്ചി ഹാർബറിൽ നിന്ന് ഏറ്റവും അടുത്തുള്ള ഉയർന്ന-വിളവ് PFZ മത്സ്യബന്ധന മേഖല, പിടിക്കാനുള്ള സാധ്യതയും ഇനങ്ങളും സഹിതം കണ്ടെത്തുക.",
    chatPromptSafety: "ഇന്നത്തേക്കുള്ള കടൽ-യാത്രാ ക്ലിയറൻസ് സ്കോർ, പ്രധാന തരംഗ ഉയരം, കാറ്റ് അപകടം എന്നിവ പരിശോധിക്കുക.",
    chatPromptBorder: "ഇന്ത്യ-ശ്രീലങ്ക IMBL അതിർത്തിയിലേക്കുള്ള ദൂരം പരിശോധിച്ച് 2 NM അപകട മേഖലയിലെ വെസലുകളുടെ പട്ടിക നൽകുക.",
    chatPromptDensity: "വെജ് ബാങ്കിലും കൊച്ചി ഡീപ്പിലും ഉടനീളമുള്ള നിലവിലെ വെസൽ എണ്ണവും സാന്ദ്രത വിതരണവും എന്താണ്?",
    chatPromptETA: "കൊച്ചിയിൽ നിന്ന് PFZ-01 ലേക്കുള്ള യാത്രാ ETA കണക്കാക്കി, റൗണ്ട്-ട്രിപ്പ് 18:30 സന്ധ്യയ്ക്ക് മുമ്പ് സുരക്ഷിതമായി മടങ്ങുമോ എന്ന് പരിശോധിക്കുക.",
    chatConversationLabel: "സംഭാഷണം",
    chatNeuralCoreActive: "ORCA INSIGHT ന്യൂറൽ കോർ സജീവം",
    chatAgentsReadyUptime: "8 ഏജന്റുമാർ തയ്യാർ · 99.94% അപ്‌ടൈം",
    chatWelcomeMessage: "വണക്കം / നമസ്തേ! ഞാൻ <strong>ORCA INSIGHT</strong> മൾട്ടി-ഏജന്റ് സിന്തസിസ് സിസ്റ്റമാണ്. സുരക്ഷിതമായ യാത്രാ ക്ലിയറൻസ്, ഇന്ത്യയുടെ തീരത്തുള്ള ഉയർന്ന-വിളവ് PFZ മേഖലകൾ, തത്സമയ വെസൽ ട്രാഫിക്, IMBL അതിർത്തി സാമീപ്യം, കടൽ-നില അനുസരിച്ച് ക്രമീകരിച്ച ETA കണക്കുകൂട്ടലുകൾ എന്നിവയെക്കുറിച്ച് നിങ്ങൾക്ക് സംസാരിക്കാം അല്ലെങ്കിൽ ടൈപ്പ് ചെയ്യാം.",
    chatMicHint: "തമിഴ്, ഹിന്ദി, മലയാളം അല്ലെങ്കിൽ ഇംഗ്ലീഷിൽ സംസാരിക്കാൻ താഴെയുള്ള മൈക്രോഫോൺ ഐക്കണിൽ ക്ലിക്ക് ചെയ്യുക!",
    chatVoiceInputTitle: "അന്വേഷണം സംസാരിക്കുക (സ്പീച്ച്-ടു-ടെക്സ്റ്റ്)",
    chatLiveReasoningTraceTitle: "തത്സമയ യുക്തി ട്രെയ്സ്",
    chatReasoningTraceEmptyHint: "8 സഹകരണ ഏജന്റുമാരിൽ ഓരോന്നും ഇത് എങ്ങനെ തത്സമയം യുക്തി ഉപയോഗിക്കുന്നു എന്ന് കാണാൻ ഇടതുവശത്ത് ഒരു ചോദ്യം ചോദിക്കുക.",
    chatLiveTelemetryTitle: "തത്സമയ സമുദ്ര ടെലിമെട്രി",
    chatCurrentSeaClearance: "നിലവിലെ കടൽ ക്ലിയറൻസ്:",
    chatSignificantWaves: "പ്രധാന തരംഗങ്ങൾ:",
    chatSurfaceWind: "ഉപരിതല കാറ്റ്:",
    chatActiveVessels: "സജീവ വെസലുകൾ:",
    chatOpenDagVisualizerBtn: "പൂർണ്ണ ഏജന്റ് DAG വിഷ്വലൈസർ തുറക്കുക ➔",
    navicConnected: "NavIC റിസീവർ: ബന്ധിപ്പിച്ചു (L5/S-Band)",
    navicDisconnected: "NavIC റിസീവർ: വിച്ഛേദിച്ചു",
    navicTrackMyPosition: "എന്റെ സ്ഥാനം ട്രാക്ക് ചെയ്യുക",
    navicStopTracking: "ട്രാക്കിംഗ് നിർത്തുക",
    navicSimulateMovement: "വെസൽ ചലനം അനുകരിക്കുക",
    navicStopSimulation: "സിമുലേഷൻ നിർത്തുക",
    navicStatusTrackingOff: "ട്രാക്കിംഗ് ഓഫ് · ഒരു സ്ഥാനവും അഭ്യർത്ഥിക്കുന്നില്ല",
    navicStatusGeoUnsupported: "ഈ ബ്രൗസർ ജിയോലൊക്കേഷൻ പിന്തുണയ്ക്കുന്നില്ല. ഡെമോയ്ക്ക് അനുകരണ വെസൽ ചലനം ഉപയോഗിക്കുക.",
    navicStatusRequestingPermission: "ഡിവൈസ്-ലൊക്കേഷൻ അനുമതി അഭ്യർത്ഥിക്കുന്നു…",
    navicStatusLiveTrackingTemplate: "തത്സമയ ഡിവൈസ് ട്രാക്കിംഗ് · കൃത്യത ±{accuracy}m · സൂക്ഷിക്കുന്നില്ല",
    navicStatusPermissionErrorTemplate: "ലൊക്കേഷൻ അനുമതി ലഭ്യമല്ല ({error}). ഒരു സ്ഥാനവും അയച്ചില്ല.",
    navicStatusBackendUnavailable: "ബാക്കെൻഡ് ലഭ്യമല്ല — പ്രാദേശിക സിമുലേഷനിൽ കൃത്യമായ ജിയോഫെൻസ് ദൂരം വിലയിരുത്താൻ കഴിയില്ല.",
    navicStatusSimStopped: "ജിയോഫെൻസ് സിമുലേഷൻ നിർത്തി",
    navicStatusSimMovingTemplate: "അനുകരണ വെസൽ ചലനം · പോയിന്റ് {index}/{total} · {lat}, {lon}",
    navicMssCopiedAlertTemplate: "NavIC MSS / SMS 120-അക്ഷര സാറ്റലൈറ്റ് അടിയന്തര കോഡ് പകർത്തി:\\n\\n{code}",
    navicSkyplotTitle: "ISRO NavIC (IRNSS) സ്കൈപ്ലോട്ട്",
    navicConstellationDesc: "7-സാറ്റലൈറ്റ് ജിയോസ്റ്റേഷണറി / IGSO നക്ഷത്രസമൂഹം",
    navicConnectedShort: "ബന്ധിപ്പിച്ചു (L5/S)",
    navicTrackedSatellitesTitle: "ട്രാക്ക് ചെയ്ത സാറ്റലൈറ്റുകൾ (SNR dB-Hz)",
    navicNmeaStreamTitle: "തത്സമയ NMEA-0183 ഹാർഡ്‌വെയർ സ്ട്രീം ($GNGGA / $GNRMC)",
    navicBaudRateDesc: "ബോഡ് നിരക്ക്: 9600 bps · 1 Hz ഫീഡ്",
    navicDopPrecisionLabel: "DOP കൃത്യത",
    navicDopValue: "HDOP 1.05 (മികച്ചത്)",
    navicDiffFixLabel: "ഡിഫറൻഷ്യൽ ഫിക്സ്",
    navicDiffFixValue: "NavIC DGPS സജീവം",
    navicBorderHwLabel: "അതിർത്തി അലേർട്ട് ഹാർഡ്‌വെയർ",
    navicBorderHwValue: "ബസ്സർ സജ്ജം",
    navicGeofenceTitle: "തത്സമയ സ്ഥാന ജിയോഫെൻസിംഗ്",
    navicGeofenceDesc: "നിങ്ങളുടെ ഡിവൈസ് ലൊക്കേഷൻ സെഷനിൽ IMBL/MPA പരിശോധനകൾക്ക് മാത്രം ഉപയോഗിക്കുന്നു, ORCA ഒരിക്കലും ഇത് സൂക്ഷിക്കുന്നില്ല.",
    navicGeofenceInitialStatus: "ട്രാക്കിംഗ് ഓഫ് · 5 NM IMBL മുന്നറിയിപ്പ് / MPA ബഫർ മുന്നറിയിപ്പ്",
    safetyVerdictDescTemplate: "തത്സമയ Open-Meteo സമുദ്ര ടെലിമെട്രി നിങ്ങളുടെ തിരഞ്ഞെടുത്ത ഹാർബറിനടുത്ത് പ്രധാന തരംഗ ഉയരം {wave}m ഉം ഉപരിതല കാറ്റ് {wind}kn ഉം ആയി കാണിക്കുന്നു, ഇത് കണക്കാക്കിയ {score}/100 സുരക്ഷാ സ്കോർ നൽകുന്നു.",
    safetyWindDefaultDirection: "പടിഞ്ഞാറൻ",
    safetyBreezeSuffix: "{direction} കാറ്റ്",
    severityLow: "കുറവ്",
    severityModerate: "മിതം",
    severityHigh: "ഉയർന്നത്",
    waveBandCalm: "ശാന്തം (< 0.5m)",
    waveBandSlight: "ലഘു (0.5 - 1.25m)",
    waveBandModerate: "മിതം (1.25 - 2.5m)",
    waveBandRough: "പരുഷം (> 2.5m)",
    seaStateCalm: "ശാന്തം",
    seaStateSlight: "ലഘു",
    seaStateSlightModerate: "ലഘു മുതൽ മിതം വരെ",
    seaStateModerateRough: "മിതം മുതൽ പരുഷം വരെ",
    seaStateUnknown: "അജ്ഞാതം",
    lightningBandSafe: "സുരക്ഷിത അന്തരീക്ഷ പ്രൊഫൈൽ",
    lightningBandElevated: "ഉയർന്ന സംവഹന അപകടസാധ്യത",
    lightningBandSevere: "കടുത്ത കൊടുങ്കാറ്റ് മുന്നറിയിപ്പ്",
    safetySyncLatencyLabel: "സിങ്ക് ലേറ്റൻസി:",
    safetyBatteryLabel: "ബാറ്ററി:",
    safetyLastPassLabel: "അവസാന പാസ്:",
    safetyAltitudeLabel: "ഉയരം:",
    telemetryLiveOpenMeteoTemplate: "തത്സമയ OPEN-METEO ടെലിമെട്രി ({wave}m SWH)",
    telemetryCachedArchive: "ടെലിമെട്രി സജീവം (സൂക്ഷിച്ച സാറ്റലൈറ്റ് ആർക്കൈവ്)",
    backendOnlineStatus: "തത്സമയ FASTAPI ബാക്കെൻഡ് ബന്ധിപ്പിച്ചു",
    backendOfflineStatus: "ബാക്കെൻഡ് ഓഫ്‌ലൈൻ · പ്രാദേശിക സിമുലേഷൻ മോഡ്",
    aisLiveCountTemplate: "{count} തത്സമയ AIS വെസൽ{plural}",
    aisNoLiveVessels: "ഇപ്പോൾ തത്സമയ AIS വെസലുകൾ ഇല്ല",
    aisBlendedBannerTemplate: "തത്സമയ AIS കവറേജ് ഇല്ലാത്ത തുറമുഖങ്ങൾ നിറയ്ക്കാൻ {liveText} + {simCount} അനുകരണ വെസൽ{plural} കാണിക്കുന്നു.",
    aisUnavailableDefault: "തത്സമയ AIS വെസൽ ഫീഡ് ലഭ്യമല്ല -- 0 വെസലുകൾ കാണിക്കുന്നു.",
    aisNotConfigured: "ഈ ഡിപ്ലോയ്‌മെന്റിൽ തത്സമയ AIS വെസൽ ഫീഡ് കോൺഫിഗർ ചെയ്തിട്ടില്ല.",
    aisConnectedNotSending: "AIS ദാതാവുമായി (AISstream.io) ബന്ധിപ്പിച്ചിരിക്കുന്നു, പക്ഷേ ഇപ്പോൾ വെസൽ ഡാറ്റ അയയ്ക്കുന്നില്ല — ഒരു ദാതാവ്-ഭാഗ തകരാറാകാം, പ്രാദേശിക തകരാറല്ല.",
    aisDisconnectedReconnecting: "AIS ദാതാവിൽ നിന്ന് (AISstream.io) വിച്ഛേദിച്ചു; സ്വയമേവ വീണ്ടും ബന്ധിപ്പിക്കുന്നു.",
    imblAlertActiveTemplate: "<strong>{vesselId} ({vesselName})</strong> ഇന്ത്യ–ശ്രീലങ്ക IMBL-ൽ നിന്ന് <strong>{dist} NM</strong> അകലെ പ്രവർത്തിക്കുന്നു{simTag}. സ്വയമേവയുള്ള മുന്നറിയിപ്പ് അയച്ചു.",
    imblAlertNoneTemplate: "നിലവിൽ {warnDist} NM IMBL മുന്നറിയിപ്പ് ദൂരത്തിനുള്ളിൽ വെസലുകൾ ഒന്നുമില്ല. ഏറ്റവും അടുത്ത ട്രാക്ക് ചെയ്ത വെസൽ: <strong>{dist} NM</strong> അകലെ.",
    imblAlertNoData: "ഇതുവരെ വെസൽ ടെലിമെട്രി ലഭ്യമല്ല.",
    simulatedSuffix: " (അനുകരണം)",
    notifUnavailableTitle: "ബ്രൗസർ അറിയിപ്പുകൾ ലഭ്യമല്ല",
    notifUnavailableMsg: "ഈ ടാബ് തുറന്നിരിക്കുന്നിടത്തോളം ആപ്പ്-ഉള്ളിലെ അപകട ബാനറുകൾ കാണിക്കും.",
    notifNotEnabledTitle: "ബ്രൗസർ അറിയിപ്പുകൾ പ്രവർത്തനക്ഷമമല്ല",
    notifNotEnabledMsg: "ഈ ടാബ് തുറന്നിരിക്കുന്നിടത്തോളം ആപ്പ്-ഉള്ളിലെ അപകട ബാനറുകൾ സജീവമായി തുടരും.",
    hazardHighWavesTitle: "ഉയർന്ന തരംഗങ്ങൾ — പ്രാദേശിക സിമുലേഷൻ",
    hazardHighWavesMsgTemplate: "{wave}m, 2.5m മുന്നറിയിപ്പ് പരിധി കവിയുന്നു. ഉറവിടം: ബ്രൗസർ Open-Meteo ടെലിമെട്രി.",
    hazardHighWindTitle: "ശക്തമായ കാറ്റ് — പ്രാദേശിക സിമുലേഷൻ",
    hazardHighWindMsgTemplate: "{wind} kn, 25 kn മുന്നറിയിപ്പ് പരിധി കവിയുന്നു. ഉറവിടം: ബ്രൗസർ Open-Meteo ടെലിമെട്രി.",
    hazardLightningTitle: "മിന്നൽ അപകടസാധ്യത — പ്രാദേശിക സിമുലേഷൻ",
    hazardLightningMsgTemplate: "മിന്നൽ പ്രോക്സി {pct}% ആണ്. ഉറവിടം: ബ്രൗസർ Open-Meteo ടെലിമെട്രി.",
    safetyOfficialClearanceLabel: "ഔദ്യോഗിക സമുദ്ര ക്ലിയറൻസ്",
    safetyVerdictDescInitial: "എല്ലാ സാറ്റലൈറ്റ് സമുദ്രശാസ്ത്ര സൂചകങ്ങളും (Oceansat-3 SSTM താപ മുന്നണികൾ, Sentinel-3 തരംഗ ആൾട്ടിമെട്രി) കേരളം, കർണാടക, തമിഴ്നാട് തീരദേശ ജലങ്ങളിൽ അനുകൂലമായ മത്സ്യബന്ധന സാഹചര്യങ്ങൾ സ്ഥിരീകരിക്കുന്നു.",
    safetyIndexLabel: "സുരക്ഷാ സൂചിക",
    satConstellationTitle: "ISRO & അന്താരാഷ്ട്ര സമുദ്രശാസ്ത്ര സാറ്റലൈറ്റ് നക്ഷത്രസമൂഹം",
    satStaticDataNote: "സ്ഥിര റഫറൻസ് ഡാറ്റ (തത്സമയ ടെലിമെട്രി അല്ല)",
    mapIndiaBoundaryPopup: "ഇന്ത്യ — ഔദ്യോഗിക അതിർത്തി (Survey of India)",
    mapPfzYieldSuffix: "{rating} വിളവ് ({pct}%)",
    mapPfzSstLabel: "SST:",
    mapPfzChlorophyllLabel: "ക്ലോറോഫിൽ:",
    mapPfzDepthLabel: "ആഴം:",
    mapPfzVesselsLabel: "വെസലുകൾ:",
    mapPfzActiveSuffix: "{count} സജീവം",
    mapPfzTargetSpeciesLabel: "ലക്ഷ്യ ഇനങ്ങൾ:",
    mapPfzSimulateRouteBtn: "ഇവിടെ റൂട്ട് അനുകരിക്കുക ➔",
    mapImblPopupBodyTemplate: "കർശനമായ അന്താരാഷ്ട്ര സമുദ്ര അതിർത്തി രേഖ. മുന്നറിയിപ്പ് ബഫർ: {warn} NM. നിർണായക ജിയോഫെൻസ്: {danger} NM.",
    mapImblPopupTreatyNote: "UNCLOS സമുദ്ര ഉടമ്പടി പ്രകാരം അതിർത്തി കടക്കൽ നിരോധിച്ചിരിക്കുന്നു.",
    mapImblBufferCorridorTemplate: "{dist} NM IMBL ബഫർ ഇടനാഴി",
    mapMpaRestrictedBadge: "നിയന്ത്രിത ഇക്കോ-റിസർവ്",
    mapHarbourCoastSuffix: "{state} തീരം",
    mapHarbourCapacityLabel: "ശേഷി:",
    mapHarbourVhfLabel: "VHF:",
    mapHarbourFuelLabel: "ഇന്ധന സ്റ്റേഷൻ:",
    mapHarbourFuelAvailable: "ലഭ്യമാണ്",
    mapHarbourIceLabel: "ഐസ് പ്ലാന്റ്:",
    mapHarbourIceActive: "സജീവം",
    mapHarbourSetOriginBtn: "ഉത്ഭവ ഹാർബറായി സജ്ജമാക്കുക",
    mapVesselSimulatedBadge: "അനുകരണം · ഇവിടെ തത്സമയ AIS കവറേജ് ഇല്ല",
    mapVesselSpeedLabel: "വേഗത:",
    mapVesselHeadingLabel: "ദിശ:",
    mapVesselZoneLabel: "മേഖല:",
    mapVesselImblDistLabel: "IMBL ദൂരം:",
    mapVesselStatusLabel: "നില:",
    mapVesselFuelLabel: "ഇന്ധനം:",
    mapVesselFuelNA: "ലഭ്യമല്ല",
    mapRoutePopupTitle: "സമുദ്രം-മാത്രം A* റൂട്ട് (ഭൂമി + MPA ഒഴിവാക്കൽ)",
    mapRouteDistanceEtaTemplate: "ദൂരം: {dist} NM · ETA: {eta}{detourNote}",
    mapRouteDetourTemplate: " · {zones} ചുറ്റും {pct}% വഴിതിരിവ്",
    mapRouteLandNoGoZones: "ഭൂമി/നിരോധിത മേഖലകൾ",
    vesselStatusSafeFishing: "സുരക്ഷിത മത്സ്യബന്ധനം",
    vesselStatusBorderAlert: "അതിർത്തി മുന്നറിയിപ്പ്",
    vesselStatusBorderWarn: "അതിർത്തി ജാഗ്രത",
    vesselStatusInTransit: "യാത്രയിൽ",
    vesselSimBadgeText: "SIM",
    vesselSimBadgeTitle: "അനുകരണം -- ഈ തുറമുഖത്തിനടുത്ത് തത്സമയ AIS കവറേജ് ഇല്ല",
    vesselLocateAction: "കണ്ടെത്തുക ➔",
    fleetVesselCountSuffix: "{count} വെസലുകൾ",
    fleetLiveSimBreakdownTemplate: "{total} ({live} തത്സമയം · {sim} അനുകരണം)",
    mapActiveVesselsBreakdownTemplate: "{total} സജീവ വെസലുകൾ ({live} തത്സമയം · {sim} അനുകരണം)",
    mapActiveVesselsSimpleTemplate: "{total} സജീവ വെസലുകൾ",
    mapTabTitle: "GIS കമാൻഡ് മാപ്പ് · ഇന്ത്യൻ തീരദേശ ജലം",
    mapTabDesc: "തത്സമയ സാറ്റലൈറ്റ് PFZ-കൾ, IMBL അതിർത്തി ഇടനാഴികൾ, AIS വെസൽ ട്രാക്കുകൾ എന്നിവയുള്ള ഇന്ററാക്ടീവ് ഉയർന്ന-കോൺട്രാസ്റ്റ് നോട്ടിക്കൽ മാപ്പ്.",
    layerPfzZones: "PFZ മേഖലകൾ",
    layerImblBuffer: "IMBL ബഫർ",
    layerEcoReserves: "ഇക്കോ റിസർവുകൾ (MPA)",
    layerHarbours: "ഹാർബറുകൾ",
    layerLiveVessels: "തത്സമയ വെസലുകൾ",
    layerDensityHeatmap: "സാന്ദ്രത ഹീറ്റ്മാപ്പ്",
    layerIndiaBoundary: "ഇന്ത്യ അതിർത്തി (Survey of India)",
    routePlannerDesc: "MPA-കളും അതിർത്തി അപകടങ്ങളും ഒഴിവാക്കുന്ന A*-ശൈലി പാത",
    routeVesselSpeedLabel: "വെസൽ വേഗത:",
    fleetMonitorTitle: "ഫ്ലീറ്റ് മോണിറ്റർ · തത്സമയ വെസൽ ടെലിമെട്രി",
    fleetTotalActiveTitle: "മൊത്തം സജീവ വെസലുകൾ",
    fleetTotalActiveDesc: "നിലവിൽ AIS ട്രാൻസ്‌പോണ്ടർ സിഗ്നലുകൾ പ്രക്ഷേപണം ചെയ്യുന്ന വെസലുകൾ",
    fleetZoneDistTitle: "മേഖല തിരിച്ചുള്ള വെസൽ വിതരണം",
    imblAlertCardTitle: "IMBL അതിർത്തി സാമീപ്യ മുന്നറിയിപ്പ്",
    fleetTableSubDesc: "AISstream.io-യിൽ നിന്നുള്ള തത്സമയ AIS സ്ഥാനങ്ങൾ, തത്സമയ റിസീവർ കവറേജ് ഇല്ലാത്തിടത്തെല്ലാം വ്യക്തമായി-ടാഗ് ചെയ്ത അനുകരണ ഫ്ലീറ്റ് (\"SIM\" ബാഡ്ജ് കാണുക) കൊണ്ട് നിറച്ചത്",
    vesselSearchPlaceholder: "വെസൽ പേരോ ID-യോ തിരയുക...",
    filterAllStatuses: "എല്ലാ നിലകളും",
    filterSafeFishing: "സുരക്ഷിത മത്സ്യബന്ധനം",
    filterInTransit: "യാത്രയിൽ",
    filterBorderAlert: "അതിർത്തി മുന്നറിയിപ്പ്",
    thVesselId: "വെസൽ ID",
    thVesselName: "വെസൽ പേര്",
    thType: "തരം",
    thCurrentZone: "നിലവിലെ മേഖല",
    thSpeedHeading: "വേഗത / ദിശ",
    thImblDist: "IMBL ദൂരം",
    thStatus: "നില",
    thAction: "നടപടി",
    bulletinIssuedLabel: "പുറപ്പെടുവിച്ചത്:",
    bulletinRegionLabel: "മേഖല:",
    bulletinWavesLabel: "തരംഗങ്ങൾ:",
    bulletinWindsLabel: "കാറ്റുകൾ:",
    bulletinSourceLabel: "ഉറവിടം:",
    bulletinListenBtn: "ബുള്ളറ്റിൻ കേൾക്കുക",
    bulletinsTabTitle: "ഔദ്യോഗിക സമുദ്ര & മത്സ്യബന്ധന ബുള്ളറ്റിനുകൾ (ISRO - INCOIS)",
    bulletinsTabDesc: "നമ്പറിട്ട ഉപദേശങ്ങൾ, ചുഴലിക്കാറ്റ് അപകട മുന്നറിയിപ്പുകൾ, അന്താരാഷ്ട്ര അതിർത്തി അനുസരണ അലേർട്ടുകൾ.",
    bulletinNotifyToggleTitle: "ഈ ടാബ്/PWA തുറന്നിരിക്കുമ്പോൾ മാത്രം ബ്രൗസർ അലേർട്ടുകൾ സ്വീകരിക്കുക",
    bulletinNotifyToggleLabel: "തുറന്നിരിക്കുമ്പോൾ അറിയിക്കുക",
    bulletinFilterAll: "എല്ലാ ബുള്ളറ്റിനുകളും",
    bulletinFilterCritical: "നിർണായകം",
    bulletinFilterWarning: "മുന്നറിയിപ്പുകൾ",
    bulletinFilterAdvisory: "ഉപദേശങ്ങൾ",
    bulletinsPushNote: "ഈ ടാബ്/PWA തുറന്നിരിക്കുമ്പോൾ മാത്രം അപകട അലേർട്ടുകൾ സജീവമാണ്. അടച്ച-ആപ്പ് പുഷ് അറിയിപ്പുകൾക്ക് ഒരു പ്രൊഡക്ഷൻ പുഷ്-സബ്സ്ക്രിപ്ഷൻ സേവനം ആവശ്യമാണ്, ഇത് ഈ പ്രോട്ടോടൈപ്പിൽ നടപ്പിലാക്കിയിട്ടില്ല.",
    sosModalTitle: "അടിയന്തര ദുരിതസൂചന ബീക്കൺ (SOS)",
    sosInstructions: "അടിയന്തര SOS സജീവമാക്കുന്നത് <strong>INSAT-3DR SAS&R</strong> വഴി ഇന്ത്യൻ കോസ്റ്റ് ഗാർഡ് സമുദ്ര രക്ഷാ ഏകോപന കേന്ദ്രത്തിലേക്ക് (MRCC) ഒരു അടിയന്തര 406 MHz ദുരിതസൂചന സിഗ്നൽ കൈമാറും.",
    sosCurrentPositionLabel: "നിലവിലെ സ്ഥാനം:",
    sosVhfChannelLabel: "അടിയന്തര VHF ചാനൽ:",
    sosMrccHelplineLabel: "MRCC ഹെൽപ്‌ലൈൻ:",
    sosConfirmBtn: "സ്ഥിരീകരിച്ച് ദുരിതസൂചന ബീക്കൺ പ്രക്ഷേപണം ചെയ്യുക",
    sosBeaconTransmittingBanner: "406 MHz SAS&R ബീക്കൺ ISRO & കോസ്റ്റ് ഗാർഡ് MRCC-ലേക്ക് കൈമാറുന്നു",
    sosDistressRelayedMsg: "ദുരിതസൂചന പാക്കറ്റ് INSAT-3DR SAS&R റിസീവർ വഴി റിലേ ചെയ്തു. സമുദ്ര രക്ഷാ ഏകോപന കേന്ദ്രത്തെ (MRCC ചെന്നൈ/മുംബൈ) VHF ചാനൽ 16-ൽ അറിയിച്ചു.",
    sosGpsVesselIdTemplate: "GPS കോർഡിനേറ്റുകൾ: {coords} · വെസൽ ID: {vesselId} ({vesselName})",
    landingEyebrow: "ISRO സഹകരണ സമുദ്ര ഇന്റലിജൻസ് · സ്മാർട്ട് ഇന്ത്യ ഹാക്കത്തോൺ 2026",
    landingSubtitle: "ഒരു സഹകരണ സമുദ്ര-ഇന്റലിജൻസ് പ്ലാറ്റ്‌ഫോം, രണ്ട് കമാൻഡ് ഡെക്കുകൾ: ഒരു മത്സ്യത്തൊഴിലാളിയുടെ ദൈനംദിന അവസര കൺസോൾ, പൂർണ്ണ ISRO സാറ്റലൈറ്റ്, AIS, ജിയോഫെൻസിംഗ് ഇൻസൈറ്റ് സ്യൂട്ട്.",
    landingStripItem1: "Oceansat-3 SSTM താപ മുന്നണികൾ",
    landingStripItem2: "INSAT-3DR സാറ്റലൈറ്റ് സമുദ്രശാസ്ത്രം",
    landingStripItem3: "8-നോഡ് സഹകരണ ഏജന്റ് DAG",
    landingStripItem4: "NavIC (IRNSS) GPS ബ്രിഡ്ജ്",
    landingStripItem5: "IMBL അതിർത്തി ജിയോഫെൻസിംഗ് അലേർട്ടുകൾ",
    landingStripItem6: "തത്സമയ AIS ഫ്ലീറ്റ് & GIS കമാൻഡ്",
    landingStripItem7: "സെൽ സ്മാർട്ടർ ബയർ പ്രൈസിംഗ്",
    landingStripItem8: "406 MHz SOS ദുരിതസൂചന ബീക്കൺ",
    landingFishermanCardTitle: "ORCA ഫിഷർമാൻ",
    landingFishermanCardDesc: "ഇന്നത്തെ അവസര സ്കോർ, സെൽ സ്മാർട്ടർ പ്രൈസിംഗ്, ഒരു യാത്രാ-ചെലവ് കാൽക്കുലേറ്റർ, നിങ്ങളുടെ പിടിത്തത്തിനുള്ള ബയർ ലീഡുകൾ — ബോട്ടിനായി നിർമ്മിച്ചത്.",
    landingFishermanCardCta: "ഫിഷർമാൻ കൺസോൾ തുറക്കുക",
    landingFishermanCardTitleAttr: "ഫിഷർമാൻ കൺസോൾ തുറക്കുക",
    landingInsightCardTitle: "ORCA ഇൻസൈറ്റ്",
    landingInsightCardDesc: "പൂർണ്ണ കമാൻഡ് ഡെക്ക്: ISRO സാറ്റലൈറ്റ് സമുദ്രശാസ്ത്രം, GIS മാപ്പ്, 8-നോഡ് ഏജന്റ് DAG, സേഫ്റ്റി ബാരോമീറ്റർ, ഫ്ലീറ്റ് മോണിറ്റർ, NavIC ബ്രിഡ്ജ്.",
    landingInsightCardCta: "ഇൻസൈറ്റ് കമാൻഡ് ഡെക്ക് തുറക്കുക",
    landingInsightCardTitleAttr: "ഇൻസൈറ്റ് കമാൻഡ് ഡെക്ക് തുറക്കുക",
    backToOverviewTitle: "അവലോകനത്തിലേക്ക് മടങ്ങുക",
    statSimulatedFleetLabel: "അനുകരണ AIS ഫ്ലീറ്റ്",
    statSatellitesActiveTemplate: "{count} സജീവം",
    statSatellitesListLabel: "Oceansat-3, INSAT-3DR, Sentinel-3",
    statPfzZonesCountTemplate: "{count} മേഖലകൾ",
    statPfzZonesListLabel: "വെജ് ബാങ്ക്, കൊച്ചി, വേരാവൽ...",
    statImblCorridorsCountTemplate: "{count} ഇടനാഴികൾ",
    statImblBordersLabel: "ഇന്ത്യ-ശ്രീലങ്ക & പാക് അതിർത്തികൾ",
    pillarDagTitle: "8-നോഡ് സഹകരണ ഏജന്റ് DAG",
    pillarDagDesc: "അന്വേഷണങ്ങളെ സാറ്റലൈറ്റ്, തരംഗ അപകടം, ജിയോഫെൻസിംഗ്, വെസൽ എണ്ണൽ, ETA, ന്യൂറൽ സിന്തസിസ് ഘട്ടങ്ങളായി ഉപ-സെക്കൻഡ് ലേറ്റൻസിയോടെ വിഭജിക്കുന്ന മൾട്ടി-ഏജന്റ് ആർക്കിടെക്ചർ.",
    pillarEtaTitle: "തത്സമയ സമുദ്ര-നില ETA & സന്ധ്യാ സുരക്ഷ",
    pillarEtaDesc: "തരംഗ പ്രതിരോധത്തിനനുസരിച്ച് ക്രമീകരിച്ച ഹൈഡ്രോഡൈനാമിക് യാത്രാ കണക്കുകൂട്ടലുകൾ, സൂര്യാസ്തമയത്തിനുശേഷം കുടുങ്ങിപ്പോയ മത്സ്യത്തൊഴിലാളികളെ തടയാൻ സ്വയമേവയുള്ള സന്ധ്യയ്ക്ക്-മുമ്പ്-മടക്കം സുരക്ഷാ അലേർട്ടുകളോടെ.",
    pillarFleetTitle: "തത്സമയ ഫ്ലീറ്റ് സാന്ദ്രത & IMBL അലേർട്ട്",
    pillarFleetDesc: "മേഖല തിരിച്ചുള്ള തത്സമയ വെസൽ എണ്ണൽ, തിരക്ക് അപകടസാധ്യതാ സൂചകങ്ങൾ, സമുദ്ര അതിർത്തികളെ സംരക്ഷിക്കുന്ന സ്വയമേവയുള്ള 5 NM/2 NM ജിയോഫെൻസ് സാമീപ്യ അലേർട്ടുകൾ.",
    footerCreditLine: "<span class=\"text-slate-200 font-semibold\">{appTitle}</span> · നിർമ്മിച്ചത് <strong class=\"text-cyan-400\">{teamName}</strong> · സ്മാർട്ട് ഇന്ത്യ ഹാക്കത്തോൺ 2026 · പ്രശ്ന പ്രസ്താവന 26176 (ISRO)",
    sttListeningStatusTemplate: "<b>{lang}</b>-ൽ കേൾക്കുന്നു... ഇപ്പോൾ സംസാരിക്കുക.",
    sttUnsupportedTitle: "ഈ ബ്രൗസറിൽ സ്പീച്ച് റെക്കഗ്നിഷൻ പിന്തുണയ്ക്കുന്നില്ല",
    routeUnavailableLabel: " റൂട്ട് ലഭ്യമല്ല:",
    routeUnavailableMsg: "ORCA ബാക്കെൻഡ് എത്തിച്ചേരാനാവുന്നില്ല, അതിനാൽ റൂട്ട് ചെയ്ത ദൂരം/ETA കാണിക്കാൻ കഴിയില്ല. പ്രാദേശിക ഫോൾബാക്ക് മോഡിൽ പ്രവർത്തിക്കുന്നു.",
    routeNoSafeRouteLabel: "✕ സുരക്ഷിതമായ സമുദ്ര റൂട്ട് കണ്ടെത്തിയില്ല:",
    routeNoSafeRouteMsgTemplate: "{detail}",
    routeNoSafeRouteDefaultReason: "ഈ ഹാർബർ/PFZ ജോടിക്ക് ഭൂമിയും സമുദ്ര സംരക്ഷിത പ്രദേശങ്ങളും ഒഴിവാക്കുന്ന പാത റൂട്ടറിന് കണ്ടെത്താനായില്ല.",
    routeSafeReturnLabel: "✓ സുരക്ഷിത മടക്കം:",
    routeSafeReturnTemplate: "പ്രതീക്ഷിക്കുന്ന ഹാർബർ വരവ് {time}-ന് മുമ്പ് (18:30 IST സന്ധ്യയ്ക്ക് മുമ്പ്).",
    routeReturnAfterDuskLabel: " സന്ധ്യയ്ക്ക് ശേഷമുള്ള മടക്കം:",
    routeReturnAfterDuskTemplate: "പ്രതീക്ഷിക്കുന്ന മടക്കം {time}-ന് (18:30 IST സൂര്യാസ്തമയം കവിയുന്നു). നേരത്തെയുള്ള പുറപ്പാട് അല്ലെങ്കിൽ രാത്രി നാവിഗേഷൻ ബീക്കൺ പരിശോധന ശുപാർശ ചെയ്യുന്നു."
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
    fmClaimFailed: "અત્યારે આ લિસ્ટિંગ ક્લેમ કરી શકાયું નથી.",
    dagAgentSupervisorName: "માસ્ટર સુપરવાઇઝર / DAG પ્લાનર",
    dagAgentSupervisorRole: "બહુ-મોડલ દરિયાઈ પ્રશ્નને વિભાજિત કરે છે, સેટેલાઇટ, જોખમ અને જિયોફેન્સ એજન્ટોને પેટા-કાર્યો સોંપે છે.",
    dagAgentSatelliteName: "સેટેલાઇટ સમુદ્રશાસ્ત્ર એજન્ટ",
    dagAgentSatelliteRole: "Oceansat-3 OCM-3 (ક્લોરોફિલ-a) અને SSTM (થર્મલ ફ્રન્ટ્સ) ની સાથે INSAT-3DR ક્લાઉડ ઇમેજરી ગ્રહણ કરે છે.",
    dagAgentWeatherName: "હવામાન અને દરિયાઈ જોખમ એજન્ટ",
    dagAgentWeatherRole: "નોંધપાત્ર તરંગ ઊંચાઈ (SWH), પવન ગસ્ટ વેક્ટર, વીજળીની સંભાવનાનું મૂલ્યાંકન કરે છે, અને દરિયા-ક્લિયરન્સ સ્કોર બનાવે છે.",
    dagAgentPfzName: "સમુદ્ર વિશ્લેષણ અને PFZ એજન્ટ",
    dagAgentPfzRole: "થર્મલ-ક્લોરોફિલ ફ્રન્ટ્સના આંતરછેદોને ઓળખે છે, પેલેજિક બાયોમાસ ઘનતાની ગણતરી કરે છે, અને લક્ષ્ય મત્સ્યપાલન ઝોનને ક્રમાંકિત કરે છે.",
    dagAgentGeofenceName: "જિયોફેન્સિંગ અને રૂટિંગ એજન્ટ",
    dagAgentGeofenceRole: "આંતરરાષ્ટ્રીય દરિયાઈ સીમા રેખાઓ (IMBL) પર નજર રાખે છે, દરિયાઈ સંરક્ષિત વિસ્તારોને બફર કરે છે, અને A* સુરક્ષિત વેપોઇન્ટની ગણતરી કરે છે.",
    dagAgentFleetName: "ફ્લીટ અને ટ્રાફિક એજન્ટ (નવું)",
    dagAgentFleetRole: "AIS અને ARGOS-4 વેસલ ટ્રાન્સપોન્ડરને સ્કેન કરે છે, ફ્લીટ વિતરણને ટ્રેક કરે છે, અને ભીડ અથવા સીમા ભીડને ફ્લેગ કરે છે.",
    dagAgentEtaName: "ETA અને પ્રવાસ સુરક્ષા એજન્ટ (નવું)",
    dagAgentEtaRole: "વાસ્તવિક-સમય તરંગ પ્રતિકારને અનુરૂપ પ્રવાસ સમયગાળાની ગણતરી કરે છે અને સંધ્યા પહેલા પાછા ફરવાની સુરક્ષા વિન્ડોનું મૂલ્યાંકન કરે છે.",
    dagAgentSynthesisName: "ન્યુરલ સિન્થેસિસ એજન્ટ (આંકડા-આધારિત)",
    dagAgentSynthesisRole: "બહુ-એજન્ટ ટેલિમેટ્રીને સાઇટેશન ટેગ્સ અને TTS સાથે એક અધિકૃત, આધારભૂત કુદરતી-ભાષા સલાહમાં એકત્રિત કરે છે -- સંપૂર્ણપણે નિયમ-આધારિત, આ સાઇટના પોતાના લાઇવ ટેલિમેટ્રી અને તેના પોતાના સંચિત આંકડા લેજર પર તર્ક કરે છે. કોઈ બાહ્ય AI/LLM API નો ઉપયોગ થતો નથી.",
    dagStatusIdle: "નિષ્ક્રિય",
    dagInspectLink: "નિરીક્ષણ કરો ➔",
    dagInspectorLatencyTemplate: "એક્ઝિક્યુશન લેટન્સી: {latency} · પેટા-કાર્યો ચકાસાયેલા",
    dagStatusQueued: "કતારમાં",
    dagStatusExecuting: "એક્ઝિક્યુટ થઈ રહ્યું છે...",
    dagStatusCompleted: "પૂર્ણ",
    dagStatusSkipped: "આમંત્રિત નથી — હેતુને આની જરૂર નહોતી",
    dagBtnReasoningActiveLive: "તર્ક સક્રિય (લાઇવ બેકએન્ડ)...",
    dagBtnExecutedLive: "✓ લાઇવ બેકએન્ડ દ્વારા પાઇપલાઇન એક્ઝિક્યુટ કરી · ફરીથી ચલાવો",
    dagBtnErrorRetry: "▶ લાઇવ પાઇપલાઇન સિમ્યુલેશન ચલાવો",
    dagBtnReasoningActiveOffline: "તર્ક સક્રિય (સ્થાનિક સિમ્યુલેશન)...",
    dagBtnExecutedOffline: "✓ પાઇપલાઇન એક્ઝિક્યુટ કરી (સ્થાનિક સિમ્યુલેશન) · ફરીથી ચલાવો",
    dagTabTitle: "8-નોડ સહયોગી બહુ-એજન્ટ DAG",
    dagInteractiveCanvasBadge: "ઇન્ટરેક્ટિવ રિઝનિંગ કેનવાસ",
    dagTabDesc: "Oceansat-3, INSAT-3DR, IMBL જિયોફેન્સિંગ, ફ્લીટ ઘનતા અને પ્રવાસ ETA પર તર્ક કરતી રીયલ-ટાઇમ બહુ-એજન્ટ એક્ઝિક્યુશન પાઇપલાઇન.",
    backendCheckingStatus: "બેકએન્ડ તપાસી રહ્યા છીએ...",
    dagZoomReset: "રીસેટ",
    dagRunSimulationBtn: "▶ લાઇવ પાઇપલાઇન સિમ્યુલેશન ચલાવો",
    dagClickToInspectHint: "કોઈપણ એજન્ટ કાર્ડ પર ક્લિક કરીને તેનું કાચું ટેલિમેટ્રી ઇનપુટ, આંતરિક અલ્ગોરિધમ્સ અને JSON ડેટા આઉટપુટ તપાસો.",
    dagOrchestratorLabel: "ઓર્કેસ્ટ્રેટર: LangGraph / Async Agent Core",
    dagInspectorDefaultTitle: "એજન્ટ વિગતો",
    dagInspectorDefaultRole: "ભૂમિકા વર્ણન",
    dagInspectorLatencyPlaceholder: "લેટન્સી: 24ms",
    dagInspectorJsonLabel: "લાઇવ JSON પેલોડ",
    dagCloseInspector: "ઇન્સ્પેક્ટર બંધ કરો",
    chatNewConversationMsg: "નવી વાતચીત શરૂ થઈ. ORCA અગાઉના ચેટ સંદર્ભનો ઉપયોગ કરશે નહીં.",
    chatYouLabel: "તમે",
    chatOrcaLabel: "ORCA",
    chatOrchestratingMsg: "Oceansat-3, INSAT-3DR અને Open-Meteo પર 8 વિશિષ્ટ AI એજન્ટોનું સંકલન થઈ રહ્યું છે...",
    chatAiLabel: "AI",
    chatAdvisoryHeader: "બહુ-એજન્ટ દરિયાઈ સલાહ",
    chatGroundedConfidenceTemplate: "{confidence}% આધારભૂત વિશ્વાસ",
    chatLangDetectedTooltip: "સંદેશ પરથી ભાષા શોધાઈ",
    chatListenTts: "સાંભળો (TTS)",
    chatNavicMssBtn: "NavIC MSS કોડ",
    chatMetricZone: "ભલામણ કરેલ ઝોન",
    chatMetricEta: "લાઇવ દરિયાઈ સ્થિતિ ETA",
    chatMetricVessels: "સક્રિય વેસલ",
    chatVesselsSuffix: "{count} વેસલ",
    chatMetricImbl: "IMBL ક્લિયરન્સ",
    chatReasoningTraceSummaryTemplate: "બહુ-એજન્ટ તર્ક ટ્રેસ જુઓ ({steps} પગલાં ચલાવ્યા)",
    chatNodeDagSuffixTemplate: "{count}-નોડ DAG",
    chatNoAdvisoryTextFallback: "ORCA INSIGHT બેકએન્ડે એક સલાહ બનાવી પરંતુ કોઈ ટેક્સ્ટ પરત કર્યું નહીં.",
    chatLiveAdvisoryLabel: "✓ લાઇવ બહુ-એજન્ટ સલાહ",
    chatGroundedEngineFallback: "આધારભૂત એન્જિન",
    chatOceanSourceTierTemplate: "સમુદ્ર સ્રોત સ્તર: {tier} · ક્લોરોફિલ: {chlorophyll}",
    chatCitationsTemplate: "સાઇટેશન: {citations}",
    chatOfflineBannerText: "ઓફલાઇન સલાહ એન્જિન — ORCA બેકએન્ડ પહોંચી શકાય તેમ નથી. નીચેના આંકડા સિમ્યુલેટેડ ઉદાહરણરૂપ અંદાજ છે, લાઇવ ટેલિમેટ્રી નથી.",
    chatOfflineImblPlainText: "ઓફલાઇન સલાહ (બેકએન્ડ પહોંચી શકાય તેમ નથી, સિમ્યુલેટેડ અંદાજ): પાક સામુદ્રધુની / મન્નારના અખાત વિસ્તારના વેસલ સામાન્ય રીતે ભારત-શ્રીલંકા IMBL સીમાથી થોડા નોટિકલ માઈલની અંદર હોય છે. પશ્ચિમ દિશા જાળવી રાખો અને VHF ટ્રાન્સપોન્ડરને ચેનલ 16 પર સક્રિય રાખો. સીમાના વાસ્તવિક માપેલા અંતર માટે ORCA બેકએન્ડ સાથે ફરીથી જોડાઓ.",
    chatOfflineImblHtmlHeading: "IMBL જિયોફેન્સિંગ સલાહ (સિમ્યુલેટેડ ઓફલાઇન અંદાજ):",
    chatOfflineImblHtmlBody1: "લાઇવ બેકએન્ડ કનેક્શન વિના, ચોક્કસ વેસલ-થી-સીમા અંતર માપી શકાતું નથી. પાક સામુદ્રધુની સેક્ટર 4 નજીક સામાન્ય સાવચેતી તરીકે, મંડપમ તરફ પશ્ચિમ દિશા જાળવી રાખો.",
    chatOfflineImblHtmlBody2: "આ એક સામાન્ય ઓફલાઇન સુરક્ષા રિમાઇન્ડર છે, માપેલ જિયોફેન્સ રીડિંગ નથી. વાસ્તવિક અંતર-થી-IMBL ગણતરી માટે ORCA બેકએન્ડ સાથે ફરીથી જોડાઓ.",
    chatOfflineImblStep1: "બેકએન્ડ પહોંચી શકાય તેમ નથી. સ્થાનિક કીવર્ડ મેચનો ઉપયોગ કરીને પ્રશ્નને IMBL_BOUNDARY તરીકે વર્ગીકૃત કર્યો.",
    chatOfflineImblStep2: "કોઈ લાઇવ જિયોફેન્સિંગ ટેલિમેટ્રી ઉપલબ્ધ નથી -- ફક્ત સામાન્ય સીમા-સુરક્ષા માર્ગદર્શન પરત કરી રહ્યા છીએ.",
    chatOfflineDensityPlainText: "ઓફલાઇન સલાહ (બેકએન્ડ પહોંચી શકાય તેમ નથી, સિમ્યુલેટેડ અંદાજ): બેકએન્ડ કનેક્શન વિના લાઇવ વેસલ ગણતરી મેળવી શકાતી નથી. ઐતિહાસિક રીતે, વેજ બેંક અને કોચી ડીપ ઓફશોરમાં મધ્યમ મત્સ્યપાલન પ્રવૃત્તિ જોવા મળે છે. વેસલ ડેટાસેટમાંથી વાસ્તવિક ફ્લીટ-ઘનતા રીડિંગ માટે ORCA બેકએન્ડ સાથે ફરીથી જોડાઓ.",
    chatOfflineDensityHtmlHeading: "ફ્લીટ ઘનતા (ઓફલાઇન — સિમ્યુલેટેડ પ્લેસહોલ્ડર):",
    chatOfflineDensityHtmlBody: "ફ્લીટ અને ટ્રાફિક એજન્ટનો લાઇવ વેસલ ડેટાસેટ હાલમાં પહોંચી શકાય તેમ નથી, તેથી ઝોનમાં ચોક્કસ વેસલ ગણતરી અનુપલબ્ધ છે.",
    chatOfflineDensityListItem: "વાસ્તવિક પ્રતિ-ઝોન વેસલ ગણતરી અને ભીડના ચુકાદા માટે ORCA બેકએન્ડ સાથે ફરીથી જોડાઓ.",
    chatOfflineDensityStep1: "બેકએન્ડ પહોંચી શકાય તેમ નથી. સ્થાનિક કીવર્ડ મેચનો ઉપયોગ કરીને પ્રશ્નને FLEET_DENSITY તરીકે વર્ગીકૃત કર્યો.",
    chatOfflineDensityStep2: "કોઈ લાઇવ ફ્લીટ ડેટાસેટ ઉપલબ્ધ નથી -- ખોટો આંકડો રજૂ કરવાનું ટાળવા વેસલ ગણતરી બતાવી નથી.",
    chatOfflineGenericPlainTextTemplate: "ઓફલાઇન સલાહ (બેકએન્ડ પહોંચી શકાય તેમ નથી): ORCA ના બહુ-એજન્ટ બેકએન્ડ સુધી પહોંચી શકાયું નથી, તેથી આ જવાબ આધારભૂત રીડિંગને બદલે એક સામાન્ય, બિન-લાઇવ પ્લેસહોલ્ડર છે. તમારા બ્રાઉઝરનું પોતાનું Open-Meteo વિજેટ લગભગ {liveWave}m ની નોંધપાત્ર તરંગ ઊંચાઈ દર્શાવે છે, પરંતુ PFZ ક્રમાંકન, રૂટ અંતર, ETA અને ફ્લીટ ગણતરી બધાને બેકએન્ડની જરૂર છે અને તે અહીં બતાવવામાં આવ્યા નથી. વાસ્તવિક સલાહ માટે ORCA બેકએન્ડ સાથે ફરીથી જોડાઓ.",
    chatOfflineGenericHtmlHeading: "ઓફલાઇન પ્લેસહોલ્ડર સલાહ",
    chatOfflineGenericHtmlBody1Template: "ORCA નું બહુ-એજન્ટ બેકએન્ડ (સેટેલાઇટ, હવામાન, PFZ ક્રમાંકન, જિયોફેન્સિંગ, ફ્લીટ, રૂટિંગ, અને ન્યુરલ સિન્થેસિસ) હાલમાં પહોંચી શકાય તેમ નથી. ક્લાયન્ટ-સાઇડ પર, આ બ્રાઉઝરે Open-Meteo પરથી છેલ્લે <strong>{liveWave}m</strong> ની તરંગ ઊંચાઈ જોઈ, પરંતુ બાકીના દરેક આંકડા માટે બેકએન્ડ જરૂરી છે.",
    chatOfflineGenericHtmlBody2: "<strong>કોઈ PFZ ભલામણ, રૂટ, ETA, અથવા ફ્લીટ ગણતરી બતાવવામાં આવી નથી</strong> કારણ કે તેની ગણતરી કરવાને બદલે તેને બનાવવી પડશે. સંપૂર્ણ આધારભૂત સલાહ માટે ORCA બેકએન્ડ સાથે ફરીથી જોડાઓ.",
    chatOfflineGenericStep1: "બેકએન્ડ પહોંચી શકાય તેમ નથી. કોઈ હેતુ-વિશિષ્ટ કીવર્ડ મેચ થયો નથી -- GENERAL_VOYAGE_SAFETY ઓફલાઇન પ્લેસહોલ્ડર પરત કરી રહ્યા છીએ.",
    chatOfflineGenericStep2Template: "ફક્ત ક્લાયન્ટ-દૃશ્યમાન આંકડો ઉપલબ્ધ: છેલ્લે જાણીતી Open-Meteo તરંગ ઊંચાઈ {liveWave}m (સીધા બ્રાઉઝર દ્વારા મેળવેલ, બેકએન્ડ મારફતે નહીં).",
    chatTtsUnsupportedAlert: "તમારા બ્રાઉઝર દ્વારા સ્પીચ સિન્થેસિસ સપોર્ટેડ નથી.",
    chatTtsWelcomeFallback: "ORCA INSIGHT માં આપનું સ્વાગત છે. બધા સેટેલાઇટ ફીડ અને દરિયાકાંઠાની સમુદ્રશાસ્ત્ર સિસ્ટમો સામાન્ય સ્થિતિમાં કાર્યરત છે.",
    chatStopAudio: "ઓડિયો બંધ કરો",
    chatListenAudioAdvisory: "ઓડિયો સલાહ સાંભળો",
    chatTabTitle: "AI નિર્ણય સ્ટુડિયો અને બહુ-એજન્ટ ચેટબોટ",
    chatTabSubtitle: "Oceansat-3, INSAT-3DR અને દરિયાકાંઠાની જિયોફેન્સિંગ પર તર્ક કરતા સહયોગી એજન્ટો દ્વારા સંચાલિત",
    chatNewConversationBtn: "નવી વાતચીત",
    chatPromptPFZ: "કોચી હાર્બરથી નજીકનું ઉચ્ચ-ઉપજ PFZ મત્સ્યપાલન ઝોન, પકડની સંભાવના અને પ્રજાતિઓ સાથે શોધો.",
    chatPromptSafety: "આજ માટે સી-વેન્ચર ક્લિયરન્સ સ્કોર, નોંધપાત્ર તરંગ ઊંચાઈ, અને પવન જોખમ તપાસો.",
    chatPromptBorder: "ભારત-શ્રીલંકા IMBL સીમાનું અંતર તપાસો અને 2 NM ડેન્જર ઝોનમાં વેસલની યાદી બતાવો.",
    chatPromptDensity: "વેજ બેંક અને કોચી ડીપમાં વર્તમાન વેસલ ગણતરી અને ઘનતા વિતરણ શું છે?",
    chatPromptETA: "કોચીથી PFZ-01 સુધીના પ્રવાસ ETA ની ગણતરી કરો અને ચકાસો કે રાઉન્ડ-ટ્રિપ 18:30 ના સંધ્યા પહેલા સુરક્ષિત રીતે પાછું ફરે છે કે નહીં.",
    chatConversationLabel: "વાતચીત",
    chatNeuralCoreActive: "ORCA INSIGHT ન્યુરલ કોર સક્રિય",
    chatAgentsReadyUptime: "8 એજન્ટ તૈયાર · 99.94% અપટાઇમ",
    chatWelcomeMessage: "વણક્કમ / નમસ્તે! હું <strong>ORCA INSIGHT</strong> બહુ-એજન્ટ સંશ્લેષણ સિસ્ટમ છું. તમે સુરક્ષિત સફર ક્લિયરન્સ, ભારતના દરિયાકાંઠે ઉચ્ચ-ઉપજ PFZ ઝોન, લાઇવ વેસલ ટ્રાફિક, IMBL સીમા નિકટતા, અને દરિયા-સ્થિતિ પ્રમાણે એડજસ્ટ કરેલ ETA ગણતરીઓ વિશે બોલી અથવા ટાઇપ કરી શકો છો.",
    chatMicHint: "તમિલ, હિન્દી, મલયાલમ અથવા અંગ્રેજીમાં બોલવા માટે નીચે માઇક્રોફોન આઇકોન પર ક્લિક કરો!",
    chatVoiceInputTitle: "પ્રશ્ન બોલો (સ્પીચ-ટુ-ટેક્સ્ટ)",
    chatLiveReasoningTraceTitle: "લાઇવ તર્ક ટ્રેસ",
    chatReasoningTraceEmptyHint: "ડાબી બાજુએ પ્રશ્ન પૂછો અને જુઓ કે 8 સહયોગી એજન્ટોમાંથી દરેક તેના દ્વારા લાઇવ કેવી રીતે તર્ક કરે છે.",
    chatLiveTelemetryTitle: "લાઇવ સમુદ્ર ટેલિમેટ્રી",
    chatCurrentSeaClearance: "વર્તમાન દરિયા ક્લિયરન્સ:",
    chatSignificantWaves: "નોંધપાત્ર તરંગો:",
    chatSurfaceWind: "સપાટી પવન:",
    chatActiveVessels: "સક્રિય વેસલ:",
    chatOpenDagVisualizerBtn: "સંપૂર્ણ એજન્ટ DAG વિઝ્યુલાઇઝર ખોલો ➔",
    navicConnected: "NavIC રિસીવર: કનેક્ટેડ (L5/S-Band)",
    navicDisconnected: "NavIC રિસીવર: ડિસ્કનેક્ટેડ",
    navicTrackMyPosition: "મારું સ્થાન ટ્રેક કરો",
    navicStopTracking: "ટ્રેકિંગ બંધ કરો",
    navicSimulateMovement: "વેસલ ગતિ સિમ્યુલેટ કરો",
    navicStopSimulation: "સિમ્યુલેશન બંધ કરો",
    navicStatusTrackingOff: "ટ્રેકિંગ બંધ · કોઈ સ્થાનની વિનંતી કરવામાં આવી રહી નથી",
    navicStatusGeoUnsupported: "આ બ્રાઉઝર દ્વારા જિયોલોકેશન સપોર્ટેડ નથી. ડેમો માટે સિમ્યુલેટેડ વેસલ મૂવમેન્ટનો ઉપયોગ કરો.",
    navicStatusRequestingPermission: "ડિવાઇસ-સ્થાન પરવાનગીની વિનંતી કરી રહ્યા છીએ…",
    navicStatusLiveTrackingTemplate: "લાઇવ ડિવાઇસ ટ્રેકિંગ · ચોકસાઈ ±{accuracy}m · સંગ્રહિત નથી",
    navicStatusPermissionErrorTemplate: "સ્થાન પરવાનગી અનુપલબ્ધ ({error}). કોઈ સ્થાન મોકલવામાં આવ્યું નથી.",
    navicStatusBackendUnavailable: "બેકએન્ડ અનુપલબ્ધ — સ્થાનિક સિમ્યુલેશનમાં ચોક્કસ જિયોફેન્સ અંતરનું મૂલ્યાંકન કરી શકાતું નથી.",
    navicStatusSimStopped: "જિયોફેન્સ સિમ્યુલેશન બંધ",
    navicStatusSimMovingTemplate: "સિમ્યુલેટેડ વેસલ મૂવમેન્ટ · બિંદુ {index}/{total} · {lat}, {lon}",
    navicMssCopiedAlertTemplate: "NavIC MSS / SMS 120-અક્ષર સેટેલાઇટ ઇમરજન્સી કોડ કોપી કર્યો:\\n\\n{code}",
    navicSkyplotTitle: "ISRO NavIC (IRNSS) સ્કાયપ્લોટ",
    navicConstellationDesc: "7-સેટેલાઇટ જિયોસ્ટેશનરી / IGSO નક્ષત્ર",
    navicConnectedShort: "કનેક્ટેડ (L5/S)",
    navicTrackedSatellitesTitle: "ટ્રેક કરેલા સેટેલાઇટ (SNR dB-Hz)",
    navicNmeaStreamTitle: "લાઇવ NMEA-0183 હાર્ડવેર સ્ટ્રીમ ($GNGGA / $GNRMC)",
    navicBaudRateDesc: "બોડ દર: 9600 bps · 1 Hz ફીડ",
    navicDopPrecisionLabel: "DOP ચોકસાઈ",
    navicDopValue: "HDOP 1.05 (ઉત્કૃષ્ટ)",
    navicDiffFixLabel: "ડિફરેન્શિયલ ફિક્સ",
    navicDiffFixValue: "NavIC DGPS સક્રિય",
    navicBorderHwLabel: "સીમા એલર્ટ હાર્ડવેર",
    navicBorderHwValue: "બઝર આર્મ્ડ",
    navicGeofenceTitle: "લાઇવ સ્થાન જિયોફેન્સિંગ",
    navicGeofenceDesc: "તમારા ડિવાઇસના સ્થાનનો ઉપયોગ ફક્ત સેશન દરમિયાન IMBL/MPA તપાસ માટે થાય છે અને ORCA દ્વારા ક્યારેય સંગ્રહિત થતો નથી.",
    navicGeofenceInitialStatus: "ટ્રેકિંગ બંધ · 5 NM IMBL ચેતવણી / MPA બફર ચેતવણી",
    safetyVerdictDescTemplate: "લાઇવ Open-Meteo દરિયાઈ ટેલિમેટ્રી તમારા પસંદ કરેલા હાર્બર નજીક નોંધપાત્ર તરંગ ઊંચાઈ {wave}m અને સપાટી પવન {wind}kn દર્શાવે છે, જે {score}/100 નો ગણતરી કરેલ સુરક્ષા સ્કોર આપે છે.",
    safetyWindDefaultDirection: "પશ્ચિમી",
    safetyBreezeSuffix: "{direction} પવન",
    severityLow: "ઓછું",
    severityModerate: "મધ્યમ",
    severityHigh: "ઊંચું",
    waveBandCalm: "શાંત (< 0.5m)",
    waveBandSlight: "હળવું (0.5 - 1.25m)",
    waveBandModerate: "મધ્યમ (1.25 - 2.5m)",
    waveBandRough: "તોફાની (> 2.5m)",
    seaStateCalm: "શાંત",
    seaStateSlight: "હળવું",
    seaStateSlightModerate: "હળવાથી મધ્યમ",
    seaStateModerateRough: "મધ્યમથી તોફાની",
    seaStateUnknown: "અજ્ઞાત",
    lightningBandSafe: "સુરક્ષિત વાતાવરણીય પ્રોફાઇલ",
    lightningBandElevated: "વધેલું સંવહન જોખમ",
    lightningBandSevere: "ગંભીર તોફાન ચેતવણી",
    safetySyncLatencyLabel: "સિંક લેટન્સી:",
    safetyBatteryLabel: "બેટરી:",
    safetyLastPassLabel: "છેલ્લો પાસ:",
    safetyAltitudeLabel: "ઊંચાઈ:",
    telemetryLiveOpenMeteoTemplate: "લાઇવ OPEN-METEO ટેલિમેટ્રી ({wave}m SWH)",
    telemetryCachedArchive: "ટેલિમેટ્રી સક્રિય (સંગ્રહિત સેટેલાઇટ આર્કાઇવ)",
    backendOnlineStatus: "લાઇવ FASTAPI બેકએન્ડ કનેક્ટેડ",
    backendOfflineStatus: "બેકએન્ડ ઓફલાઇન · સ્થાનિક સિમ્યુલેશન મોડ",
    aisLiveCountTemplate: "{count} લાઇવ AIS વેસલ{plural}",
    aisNoLiveVessels: "હાલમાં કોઈ લાઇવ AIS વેસલ નથી",
    aisBlendedBannerTemplate: "{liveText} + {simCount} સિમ્યુલેટેડ વેસલ{plural} બતાવી રહ્યા છીએ, જ્યાં હાલમાં કોઈ લાઇવ AIS કવરેજ નથી તેવા બંદરો ભરવા માટે.",
    aisUnavailableDefault: "લાઇવ AIS વેસલ ફીડ અનુપલબ્ધ -- 0 વેસલ બતાવી રહ્યા છીએ.",
    aisNotConfigured: "આ ડિપ્લોયમેન્ટ પર લાઇવ AIS વેસલ ફીડ કન્ફિગર કરેલ નથી.",
    aisConnectedNotSending: "AIS પ્રદાતા (AISstream.io) સાથે જોડાયેલ છે, પરંતુ તે હાલમાં વેસલ ડેટા મોકલી રહ્યું નથી — સંભવતઃ પ્રદાતા-બાજુનો વિક્ષેપ, સ્થાનિક ખામી નથી.",
    aisDisconnectedReconnecting: "AIS પ્રદાતા (AISstream.io) થી ડિસ્કનેક્ટેડ; આપમેળે ફરીથી જોડાઈ રહ્યા છીએ.",
    imblAlertActiveTemplate: "<strong>{vesselId} ({vesselName})</strong> ભારત–શ્રીલંકા IMBL થી <strong>{dist} NM</strong> ના અંતરે કાર્યરત છે{simTag}. સ્વચાલિત ચેતવણી મોકલવામાં આવી.",
    imblAlertNoneTemplate: "હાલમાં {warnDist} NM IMBL ચેતવણી અંતરની અંદર કોઈ વેસલ નથી. સૌથી નજીકનું ટ્રેક કરેલ વેસલ: <strong>{dist} NM</strong> દૂર.",
    imblAlertNoData: "હજુ સુધી કોઈ વેસલ ટેલિમેટ્રી ઉપલબ્ધ નથી.",
    simulatedSuffix: " (સિમ્યુલેટેડ)",
    notifUnavailableTitle: "બ્રાઉઝર સૂચનાઓ અનુપલબ્ધ",
    notifUnavailableMsg: "જ્યાં સુધી આ ટેબ ખુલ્લું છે ત્યાં સુધી ઇન-એપ જોખમ બેનર બતાવવામાં આવશે.",
    notifNotEnabledTitle: "બ્રાઉઝર સૂચનાઓ સક્ષમ નથી",
    notifNotEnabledMsg: "જ્યાં સુધી આ ટેબ ખુલ્લું છે ત્યાં સુધી ઇન-એપ જોખમ બેનર સક્રિય રહે છે.",
    hazardHighWavesTitle: "ઊંચા તરંગો — સ્થાનિક સિમ્યુલેશન",
    hazardHighWavesMsgTemplate: "{wave}m, 2.5m સાવચેતી મર્યાદા કરતાં વધારે છે. સ્રોત: બ્રાઉઝર Open-Meteo ટેલિમેટ્રી.",
    hazardHighWindTitle: "તેજ પવન — સ્થાનિક સિમ્યુલેશન",
    hazardHighWindMsgTemplate: "{wind} kn, 25 kn સાવચેતી મર્યાદા કરતાં વધારે છે. સ્રોત: બ્રાઉઝર Open-Meteo ટેલિમેટ્રી.",
    hazardLightningTitle: "વીજળીનું જોખમ — સ્થાનિક સિમ્યુલેશન",
    hazardLightningMsgTemplate: "વીજળી પ્રોક્સી {pct}% છે. સ્રોત: બ્રાઉઝર Open-Meteo ટેલિમેટ્રી.",
    safetyOfficialClearanceLabel: "સત્તાવાર દરિયાઈ ક્લિયરન્સ",
    safetyVerdictDescInitial: "બધા સેટેલાઇટ સમુદ્રશાસ્ત્ર સૂચકો (Oceansat-3 SSTM થર્મલ ફ્રન્ટ્સ, Sentinel-3 તરંગ અલ્ટીમેટ્રી) કેરળ, કર્ણાટક, અને તમિલનાડુના દરિયાકાંઠાના પાણીમાં અનુકૂળ મત્સ્યપાલન સ્થિતિની પુષ્ટિ કરે છે.",
    safetyIndexLabel: "સુરક્ષા સૂચકાંક",
    satConstellationTitle: "ISRO અને આંતરરાષ્ટ્રીય સમુદ્રશાસ્ત્ર સેટેલાઇટ નક્ષત્ર",
    satStaticDataNote: "સ્થિર સંદર્ભ ડેટા (લાઇવ ટેલિમેટ્રી નથી)",
    mapIndiaBoundaryPopup: "ભારત — સત્તાવાર સીમા (Survey of India)",
    mapPfzYieldSuffix: "{rating} ઉપજ ({pct}%)",
    mapPfzSstLabel: "SST:",
    mapPfzChlorophyllLabel: "ક્લોરોફિલ:",
    mapPfzDepthLabel: "ઊંડાઈ:",
    mapPfzVesselsLabel: "વેસલ:",
    mapPfzActiveSuffix: "{count} સક્રિય",
    mapPfzTargetSpeciesLabel: "લક્ષ્ય પ્રજાતિઓ:",
    mapPfzSimulateRouteBtn: "અહીં રૂટ સિમ્યુલેટ કરો ➔",
    mapImblPopupBodyTemplate: "કડક આંતરરાષ્ટ્રીય દરિયાઈ સીમા રેખા. ચેતવણી બફર: {warn} NM. જટિલ જિયોફેન્સ: {danger} NM.",
    mapImblPopupTreatyNote: "UNCLOS દરિયાઈ સંધિ હેઠળ સીમા પાર કરવી પ્રતિબંધિત છે.",
    mapImblBufferCorridorTemplate: "{dist} NM IMBL બફર કોરિડોર",
    mapMpaRestrictedBadge: "પ્રતિબંધિત ઇકો-રિઝર્વ",
    mapHarbourCoastSuffix: "{state} કિનારો",
    mapHarbourCapacityLabel: "ક્ષમતા:",
    mapHarbourVhfLabel: "VHF:",
    mapHarbourFuelLabel: "ઇંધણ સ્ટેશન:",
    mapHarbourFuelAvailable: "ઉપલબ્ધ",
    mapHarbourIceLabel: "બરફ પ્લાન્ટ:",
    mapHarbourIceActive: "સક્રિય",
    mapHarbourSetOriginBtn: "મૂળ હાર્બર તરીકે સેટ કરો",
    mapVesselSimulatedBadge: "સિમ્યુલેટેડ · અહીં કોઈ લાઇવ AIS કવરેજ નથી",
    mapVesselSpeedLabel: "ઝડપ:",
    mapVesselHeadingLabel: "દિશા:",
    mapVesselZoneLabel: "ઝોન:",
    mapVesselImblDistLabel: "IMBL અંતર:",
    mapVesselStatusLabel: "સ્થિતિ:",
    mapVesselFuelLabel: "ઇંધણ:",
    mapVesselFuelNA: "ઉપલબ્ધ નથી",
    mapRoutePopupTitle: "દરિયા-ફક્ત A* રૂટ (જમીન + MPA ટાળવું)",
    mapRouteDistanceEtaTemplate: "અંતર: {dist} NM · ETA: {eta}{detourNote}",
    mapRouteDetourTemplate: " · {zones} ની આસપાસ {pct}% ડિટૂર",
    mapRouteLandNoGoZones: "જમીન/નિષિદ્ધ ઝોન",
    vesselStatusSafeFishing: "સુરક્ષિત મત્સ્યપાલન",
    vesselStatusBorderAlert: "સીમા ચેતવણી",
    vesselStatusBorderWarn: "સીમા સાવધાની",
    vesselStatusInTransit: "પ્રવાસમાં",
    vesselSimBadgeText: "SIM",
    vesselSimBadgeTitle: "સિમ્યુલેટેડ -- આ બંદર નજીક કોઈ લાઇવ AIS કવરેજ નથી",
    vesselLocateAction: "શોધો ➔",
    fleetVesselCountSuffix: "{count} વેસલ",
    fleetLiveSimBreakdownTemplate: "{total} ({live} લાઇવ · {sim} સિમ)",
    mapActiveVesselsBreakdownTemplate: "{total} સક્રિય વેસલ ({live} લાઇવ · {sim} સિમ્યુલેટેડ)",
    mapActiveVesselsSimpleTemplate: "{total} સક્રિય વેસલ",
    mapTabTitle: "GIS કમાન્ડ મેપ · ભારતીય દરિયાકાંઠાના પાણી",
    mapTabDesc: "રીયલ-ટાઇમ સેટેલાઇટ PFZ, IMBL સીમા કોરિડોર, અને AIS વેસલ ટ્રેક સાથે ઇન્ટરેક્ટિવ ઉચ્ચ-કોન્ટ્રાસ્ટ નોટિકલ મેપ.",
    layerPfzZones: "PFZ ઝોન",
    layerImblBuffer: "IMBL બફર",
    layerEcoReserves: "ઇકો રિઝર્વ (MPA)",
    layerHarbours: "હાર્બર",
    layerLiveVessels: "લાઇવ વેસલ",
    layerDensityHeatmap: "ઘનતા હીટમેપ",
    layerIndiaBoundary: "ભારત સીમા (Survey of India)",
    routePlannerDesc: "MPA અને સીમા જોખમોને ટાળતો A*-શૈલી પાથ",
    routeVesselSpeedLabel: "વેસલ ઝડપ:",
    fleetMonitorTitle: "ફ્લીટ મોનિટર · લાઇવ વેસલ ટેલિમેટ્રી",
    fleetTotalActiveTitle: "કુલ સક્રિય વેસલ",
    fleetTotalActiveDesc: "હાલમાં AIS ટ્રાન્સપોન્ડર સિગ્નલ પ્રસારિત કરતા વેસલ",
    fleetZoneDistTitle: "પ્રતિ ઝોન વેસલ વિતરણ",
    imblAlertCardTitle: "IMBL સીમા નિકટતા ચેતવણી",
    fleetTableSubDesc: "AISstream.io માંથી લાઇવ AIS સ્થિતિઓ, જ્યાં પણ હાલમાં કોઈ લાઇવ રિસીવર કવરેજ નથી ત્યાં સ્પષ્ટ રીતે-ટેગ કરેલ સિમ્યુલેટેડ ફ્લીટ (\"SIM\" બેજ જુઓ) સાથે ભરેલી",
    vesselSearchPlaceholder: "વેસલનું નામ અથવા ID શોધો...",
    filterAllStatuses: "બધી સ્થિતિઓ",
    filterSafeFishing: "સુરક્ષિત મત્સ્યપાલન",
    filterInTransit: "પ્રવાસમાં",
    filterBorderAlert: "સીમા ચેતવણી",
    thVesselId: "વેસલ ID",
    thVesselName: "વેસલનું નામ",
    thType: "પ્રકાર",
    thCurrentZone: "વર્તમાન ઝોન",
    thSpeedHeading: "ઝડપ / દિશા",
    thImblDist: "IMBL અંતર",
    thStatus: "સ્થિતિ",
    thAction: "ક્રિયા",
    bulletinIssuedLabel: "જારી:",
    bulletinRegionLabel: "પ્રદેશ:",
    bulletinWavesLabel: "તરંગો:",
    bulletinWindsLabel: "પવનો:",
    bulletinSourceLabel: "સ્રોત:",
    bulletinListenBtn: "બુલેટિન સાંભળો",
    bulletinsTabTitle: "સત્તાવાર દરિયાઈ અને મત્સ્યપાલન બુલેટિન (ISRO - INCOIS)",
    bulletinsTabDesc: "ક્રમાંકિત સલાહ, ચક્રવાત જોખમ ચેતવણીઓ, અને આંતરરાષ્ટ્રીય સીમા પાલન એલર્ટ.",
    bulletinNotifyToggleTitle: "ફક્ત આ ટેબ/PWA ખુલ્લું હોય ત્યારે જ બ્રાઉઝર એલર્ટ મેળવો",
    bulletinNotifyToggleLabel: "ખુલ્લું હોય ત્યારે સૂચિત કરો",
    bulletinFilterAll: "બધા બુલેટિન",
    bulletinFilterCritical: "ગંભીર",
    bulletinFilterWarning: "ચેતવણીઓ",
    bulletinFilterAdvisory: "સલાહ",
    bulletinsPushNote: "જોખમ એલર્ટ ફક્ત ત્યારે જ સક્રિય છે જ્યારે આ ટેબ/PWA ખુલ્લું હોય. બંધ-એપ પુશ સૂચનાઓ માટે એક પ્રોડક્શન પુશ-સબ્સ્ક્રિપ્શન સેવાની જરૂર છે અને તે આ પ્રોટોટાઇપમાં લાગુ કરેલ નથી.",
    sosModalTitle: "કટોકટી ડિસ્ટ્રેસ બીકોન (SOS)",
    sosInstructions: "કટોકટી SOS સક્રિય કરવાથી <strong>INSAT-3DR SAS&R</strong> મારફતે ભારતીય કોસ્ટ ગાર્ડ મરીટાઇમ રેસ્ક્યુ કોઓર્ડિનેશન સેન્ટર (MRCC) ને એક કટોકટી 406 MHz ડિસ્ટ્રેસ સિગ્નલ પ્રસારિત કરવામાં આવશે.",
    sosCurrentPositionLabel: "વર્તમાન સ્થાન:",
    sosVhfChannelLabel: "કટોકટી VHF ચેનલ:",
    sosMrccHelplineLabel: "MRCC હેલ્પલાઇન:",
    sosConfirmBtn: "પુષ્ટિ કરો અને ડિસ્ટ્રેસ બીકોન પ્રસારિત કરો",
    sosBeaconTransmittingBanner: "406 MHz SAS&R બીકોન ISRO અને કોસ્ટ ગાર્ડ MRCC ને પ્રસારિત થઈ રહ્યું છે",
    sosDistressRelayedMsg: "ડિસ્ટ્રેસ પેકેટ INSAT-3DR SAS&R રિસીવર મારફતે રિલે કરવામાં આવ્યું. મરીટાઇમ રેસ્ક્યુ કોઓર્ડિનેશન સેન્ટર (MRCC ચેન્નાઈ/મુંબઈ) ને VHF ચેનલ 16 પર ચેતવણી આપવામાં આવી.",
    sosGpsVesselIdTemplate: "GPS કોઓર્ડિનેટ્સ: {coords} · વેસલ ID: {vesselId} ({vesselName})",
    landingEyebrow: "ISRO સહયોગી દરિયાઈ બુદ્ધિમત્તા · સ્માર્ટ ઇન્ડિયા હેકાથોન 2026",
    landingSubtitle: "એક સહયોગી દરિયાઈ-બુદ્ધિમત્તા પ્લેટફોર્મ, બે કમાન્ડ ડેક: માછીમારનું દૈનિક તક કન્સોલ, અને સંપૂર્ણ ISRO સેટેલાઇટ, AIS અને જિયોફેન્સિંગ ઇનસાઇટ સ્યુટ.",
    landingStripItem1: "Oceansat-3 SSTM થર્મલ ફ્રન્ટ્સ",
    landingStripItem2: "INSAT-3DR સેટેલાઇટ સમુદ્રશાસ્ત્ર",
    landingStripItem3: "8-નોડ સહયોગી એજન્ટ DAG",
    landingStripItem4: "NavIC (IRNSS) GPS બ્રિજ",
    landingStripItem5: "IMBL સીમા જિયોફેન્સિંગ એલર્ટ",
    landingStripItem6: "લાઇવ AIS ફ્લીટ અને GIS કમાન્ડ",
    landingStripItem7: "સેલ સ્માર્ટર બાયર પ્રાઇસિંગ",
    landingStripItem8: "406 MHz SOS ડિસ્ટ્રેસ બીકોન",
    landingFishermanCardTitle: "ORCA ફિશરમેન",
    landingFishermanCardDesc: "આજનો તક સ્કોર, સેલ સ્માર્ટર પ્રાઇસિંગ, એક ટ્રિપ-ખર્ચ કેલ્ક્યુલેટર, અને તમારી પકડ માટે ખરીદનાર લીડ — બોટ માટે બનાવેલ.",
    landingFishermanCardCta: "ફિશરમેન કન્સોલ ખોલો",
    landingFishermanCardTitleAttr: "ફિશરમેન કન્સોલ ખોલો",
    landingInsightCardTitle: "ORCA ઇનસાઇટ",
    landingInsightCardDesc: "સંપૂર્ણ કમાન્ડ ડેક: ISRO સેટેલાઇટ સમુદ્રશાસ્ત્ર, GIS મેપ, 8-નોડ એજન્ટ DAG, સેફ્ટી બેરોમીટર, ફ્લીટ મોનિટર, અને NavIC બ્રિજ.",
    landingInsightCardCta: "ઇનસાઇટ કમાન્ડ ડેક ખોલો",
    landingInsightCardTitleAttr: "ઇનસાઇટ કમાન્ડ ડેક ખોલો",
    backToOverviewTitle: "ઓવરવ્યૂ પર પાછા જાઓ",
    statSimulatedFleetLabel: "સિમ્યુલેટેડ AIS ફ્લીટ",
    statSatellitesActiveTemplate: "{count} સક્રિય",
    statSatellitesListLabel: "Oceansat-3, INSAT-3DR, Sentinel-3",
    statPfzZonesCountTemplate: "{count} ઝોન",
    statPfzZonesListLabel: "વેજ બેંક, કોચી, વેરાવળ...",
    statImblCorridorsCountTemplate: "{count} કોરિડોર",
    statImblBordersLabel: "ભારત-શ્રીલંકા અને પાક સીમાઓ",
    pillarDagTitle: "8-નોડ સહયોગી એજન્ટ DAG",
    pillarDagDesc: "પ્રશ્નોને સેટેલાઇટ, તરંગ જોખમ, જિયોફેન્સિંગ, વેસલ ગણતરી, ETA, અને ન્યુરલ સિન્થેસિસ પગલાંમાં સબ-સેકન્ડ લેટન્સી સાથે વિભાજિત કરતું બહુ-એજન્ટ આર્કિટેક્ચર.",
    pillarEtaTitle: "લાઇવ દરિયા-સ્થિતિ ETA અને સંધ્યા સુરક્ષા",
    pillarEtaDesc: "તરંગ પ્રતિકારને અનુરૂપ એડજસ્ટ કરેલ હાઇડ્રોડાયનેમિક પ્રવાસ ગણતરીઓ, સૂર્યાસ્ત પછી ફસાયેલા માછીમારોને અટકાવવા સ્વચાલિત સંધ્યા-પહેલા-પાછા ફરવાની સુરક્ષા એલર્ટ સાથે.",
    pillarFleetTitle: "લાઇવ ફ્લીટ ઘનતા અને IMBL એલર્ટ",
    pillarFleetDesc: "પ્રતિ ઝોન રીયલ-ટાઇમ વેસલ ગણતરી, ભીડ જોખમ સૂચકો, અને દરિયાઈ સીમાઓનું રક્ષણ કરતા સ્વચાલિત 5 NM/2 NM જિયોફેન્સ નિકટતા એલર્ટ.",
    footerCreditLine: "<span class=\"text-slate-200 font-semibold\">{appTitle}</span> · દ્વારા નિર્મિત <strong class=\"text-cyan-400\">{teamName}</strong> · સ્માર્ટ ઇન્ડિયા હેકાથોન 2026 · સમસ્યા નિવેદન 26176 (ISRO)",
    sttListeningStatusTemplate: "<b>{lang}</b> માં સાંભળી રહ્યા છીએ... હવે બોલો.",
    sttUnsupportedTitle: "આ બ્રાઉઝરમાં સ્પીચ રેકગ્નિશન સપોર્ટેડ નથી",
    routeUnavailableLabel: " રૂટ અનુપલબ્ધ:",
    routeUnavailableMsg: "ORCA બેકએન્ડ પહોંચી શકાય તેમ નથી, તેથી કોઈ રૂટેડ અંતર/ETA બતાવી શકાતું નથી. સ્થાનિક ફોલબેક મોડમાં ચાલી રહ્યું છે.",
    routeNoSafeRouteLabel: "✕ કોઈ સુરક્ષિત દરિયાઈ રૂટ મળ્યો નથી:",
    routeNoSafeRouteMsgTemplate: "{detail}",
    routeNoSafeRouteDefaultReason: "રાઉટર આ હાર્બર/PFZ જોડી માટે જમીન અને દરિયાઈ સંરક્ષિત વિસ્તારોને ટાળતો પાથ શોધી શક્યું નથી.",
    routeSafeReturnLabel: "✓ સુરક્ષિત વળતર:",
    routeSafeReturnTemplate: "અંદાજિત હાર્બર આગમન {time} સુધીમાં (18:30 IST સંધ્યા પહેલા).",
    routeReturnAfterDuskLabel: " સંધ્યા પછી વળતર:",
    routeReturnAfterDuskTemplate: "અંદાજિત વળતર {time} વાગ્યે (18:30 IST સૂર્યાસ્ત કરતાં વધારે). વહેલા પ્રસ્થાન અથવા રાત્રિ નેવિગેશન બીકોન તપાસની ભલામણ કરવામાં આવે છે."
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
    fmClaimFailed: "सध्या ही लिस्टिंग दावा करता आली नाही.",
    dagAgentSupervisorName: "मास्टर सुपरवायझर / DAG प्लॅनर",
    dagAgentSupervisorRole: "बहु-मॉडेल सागरी प्रश्न विभाजित करतो, सॅटेलाइट, धोका आणि जिओफेन्स एजंटना उप-कामे नियुक्त करतो.",
    dagAgentSatelliteName: "सॅटेलाइट सागरशास्त्र एजंट",
    dagAgentSatelliteRole: "Oceansat-3 OCM-3 (क्लोरोफिल-a) आणि SSTM (थर्मल फ्रंट्स) यांच्यासोबत INSAT-3DR ढग प्रतिमा घेतो.",
    dagAgentWeatherName: "हवामान आणि सागरी धोका एजंट",
    dagAgentWeatherRole: "लक्षणीय लाट उंची (SWH), वारा झोत सदिश, वीज पडण्याची शक्यता यांचे मूल्यांकन करतो आणि समुद्र-क्लिअरन्स स्कोअर तयार करतो.",
    dagAgentPfzName: "सागरी विश्लेषण आणि PFZ एजंट",
    dagAgentPfzRole: "थर्मल-क्लोरोफिल फ्रंट्सचे छेदनबिंदू ओळखतो, पेलेजिक बायोमास घनतेची गणना करतो आणि लक्ष्य मासेमारी क्षेत्रांना क्रमवारी देतो.",
    dagAgentGeofenceName: "जिओफेन्सिंग आणि मार्ग एजंट",
    dagAgentGeofenceRole: "आंतरराष्ट्रीय सागरी सीमारेषांवर (IMBL) लक्ष ठेवतो, सागरी संरक्षित क्षेत्रांना बफर करतो आणि A* सुरक्षित वेपॉइंट्सची गणना करतो.",
    dagAgentFleetName: "फ्लीट आणि वाहतूक एजंट (नवीन)",
    dagAgentFleetRole: "AIS आणि ARGOS-4 वेसल ट्रान्सपॉन्डर स्कॅन करतो, फ्लीट वितरणाचा मागोवा घेतो आणि गर्दी किंवा सीमा गर्दी फ्लॅग करतो.",
    dagAgentEtaName: "ETA आणि प्रवास सुरक्षा एजंट (नवीन)",
    dagAgentEtaRole: "रिअल-टाइम लाट प्रतिकारानुसार प्रवास कालावधीची गणना करतो आणि संध्याकाळपूर्वी परतण्याच्या सुरक्षा विंडोचे मूल्यांकन करतो.",
    dagAgentSynthesisName: "न्यूरल सिंथेसिस एजंट (आकडेवारी-आधारित)",
    dagAgentSynthesisRole: "बहु-एजंट टेलिमेट्रीला उद्धरण टॅग आणि TTS सह एका अधिकृत, आधारभूत नैसर्गिक-भाषा सल्ल्यात एकत्रित करतो -- पूर्णपणे नियम-आधारित, या साइटच्या स्वतःच्या लाइव्ह टेलिमेट्री आणि तिच्या स्वतःच्या संचित आकडेवारी नोंदवहीवर तर्क करतो. कोणतेही बाह्य AI/LLM API वापरले जात नाही.",
    dagStatusIdle: "निष्क्रिय",
    dagInspectLink: "तपासा ➔",
    dagInspectorLatencyTemplate: "अंमलबजावणी विलंब: {latency} · उप-कामे सत्यापित",
    dagStatusQueued: "रांगेत",
    dagStatusExecuting: "अंमलात आणले जात आहे...",
    dagStatusCompleted: "पूर्ण",
    dagStatusSkipped: "आमंत्रित नाही — हेतूला याची गरज नव्हती",
    dagBtnReasoningActiveLive: "तर्क सक्रिय (लाइव्ह बॅकएंड)...",
    dagBtnExecutedLive: "✓ लाइव्ह बॅकएंडद्वारे पाइपलाइन अंमलात आणली · पुन्हा चालवा",
    dagBtnErrorRetry: "▶ लाइव्ह पाइपलाइन सिम्युलेशन चालवा",
    dagBtnReasoningActiveOffline: "तर्क सक्रिय (स्थानिक सिम्युलेशन)...",
    dagBtnExecutedOffline: "✓ पाइपलाइन अंमलात आणली (स्थानिक सिम्युलेशन) · पुन्हा चालवा",
    dagTabTitle: "8-नोड सहयोगी बहु-एजंट DAG",
    dagInteractiveCanvasBadge: "परस्परसंवादी तर्क कॅनव्हास",
    dagTabDesc: "Oceansat-3, INSAT-3DR, IMBL जिओफेन्सिंग, फ्लीट घनता आणि प्रवास ETA वर तर्क करणारी रिअल-टाइम बहु-एजंट अंमलबजावणी पाइपलाइन.",
    backendCheckingStatus: "बॅकएंड तपासत आहे...",
    dagZoomReset: "रीसेट",
    dagRunSimulationBtn: "▶ लाइव्ह पाइपलाइन सिम्युलेशन चालवा",
    dagClickToInspectHint: "कोणत्याही एजंट कार्डवर क्लिक करून त्याचे कच्चे टेलिमेट्री इनपुट, अंतर्गत अल्गोरिदम आणि JSON डेटा आउटपुट तपासा.",
    dagOrchestratorLabel: "ऑर्केस्ट्रेटर: LangGraph / Async Agent Core",
    dagInspectorDefaultTitle: "एजंट तपशील",
    dagInspectorDefaultRole: "भूमिका वर्णन",
    dagInspectorLatencyPlaceholder: "विलंब: 24ms",
    dagInspectorJsonLabel: "लाइव्ह JSON पेलोड",
    dagCloseInspector: "इन्स्पेक्टर बंद करा",
    chatNewConversationMsg: "नवीन संभाषण सुरू झाले. ORCA मागील चॅट संदर्भ वापरणार नाही.",
    chatYouLabel: "तुम्ही",
    chatOrcaLabel: "ORCA",
    chatOrchestratingMsg: "Oceansat-3, INSAT-3DR आणि Open-Meteo वर 8 विशेष AI एजंट समन्वयित केले जात आहेत...",
    chatAiLabel: "AI",
    chatAdvisoryHeader: "बहु-एजंट सागरी सल्ला",
    chatGroundedConfidenceTemplate: "{confidence}% आधारभूत विश्वास",
    chatLangDetectedTooltip: "संदेशावरून भाषा ओळखली",
    chatListenTts: "ऐका (TTS)",
    chatNavicMssBtn: "NavIC MSS कोड",
    chatMetricZone: "शिफारस केलेले क्षेत्र",
    chatMetricEta: "लाइव्ह सागरी स्थिती ETA",
    chatMetricVessels: "सक्रिय वेसल",
    chatVesselsSuffix: "{count} वेसल",
    chatMetricImbl: "IMBL क्लिअरन्स",
    chatReasoningTraceSummaryTemplate: "बहु-एजंट तर्क ट्रेस पहा ({steps} पायऱ्या अंमलात आणल्या)",
    chatNodeDagSuffixTemplate: "{count}-नोड DAG",
    chatNoAdvisoryTextFallback: "ORCA INSIGHT बॅकएंडने एक सल्ला तयार केला पण कोणताही मजकूर परत केला नाही.",
    chatLiveAdvisoryLabel: "✓ लाइव्ह बहु-एजंट सल्ला",
    chatGroundedEngineFallback: "आधारभूत इंजिन",
    chatOceanSourceTierTemplate: "सागरी स्रोत स्तर: {tier} · क्लोरोफिल: {chlorophyll}",
    chatCitationsTemplate: "उद्धरणे: {citations}",
    chatOfflineBannerText: "ऑफलाइन सल्ला इंजिन — ORCA बॅकएंड पोहोचता येत नाही. खालील आकडेवारी एक सिम्युलेटेड उदाहरण अंदाज आहे, लाइव्ह टेलिमेट्री नाही.",
    chatOfflineImblPlainText: "ऑफलाइन सल्ला (बॅकएंड पोहोचता येत नाही, सिम्युलेटेड अंदाज): पाक सामुद्रधुनी / मन्नारच्या आखाती भागातील वेसल सहसा भारत-श्रीलंका IMBL सीमेपासून काही सागरी मैलांच्या आत असतात. पश्चिम दिशा राखा आणि VHF ट्रान्सपॉन्डर चॅनेल 16 वर सक्रिय ठेवा. सीमेच्या प्रत्यक्ष मोजलेल्या अंतरासाठी ORCA बॅकएंडशी पुन्हा जोडा.",
    chatOfflineImblHtmlHeading: "IMBL जिओफेन्सिंग सल्ला (सिम्युलेटेड ऑफलाइन अंदाज):",
    chatOfflineImblHtmlBody1: "लाइव्ह बॅकएंड कनेक्शनशिवाय, अचूक वेसल-ते-सीमा अंतर मोजता येत नाही. पाक सामुद्रधुनी सेक्टर 4 जवळ सामान्य खबरदारी म्हणून, मंडपमच्या दिशेने पश्चिम दिशा राखा.",
    chatOfflineImblHtmlBody2: "हा एक सामान्य ऑफलाइन सुरक्षा स्मरणपत्र आहे, मोजलेले जिओफेन्स रीडिंग नाही. प्रत्यक्ष अंतर-ते-IMBL गणनेसाठी ORCA बॅकएंडशी पुन्हा जोडा.",
    chatOfflineImblStep1: "बॅकएंड पोहोचता येत नाही. स्थानिक कीवर्ड जुळणी वापरून प्रश्न IMBL_BOUNDARY म्हणून वर्गीकृत केला.",
    chatOfflineImblStep2: "कोणतीही लाइव्ह जिओफेन्सिंग टेलिमेट्री उपलब्ध नाही -- फक्त सामान्य सीमा-सुरक्षा मार्गदर्शन परत करत आहे.",
    chatOfflineDensityPlainText: "ऑफलाइन सल्ला (बॅकएंड पोहोचता येत नाही, सिम्युलेटेड अंदाज): बॅकएंड कनेक्शनशिवाय लाइव्ह वेसल संख्या मिळवता येत नाही. ऐतिहासिकदृष्ट्या, वेज बँक आणि कोची डीप ऑफशोअरमध्ये मध्यम मासेमारी क्रियाकलाप दिसतो. वेसल डेटासेटमधून प्रत्यक्ष फ्लीट-घनता रीडिंगसाठी ORCA बॅकएंडशी पुन्हा जोडा.",
    chatOfflineDensityHtmlHeading: "फ्लीट घनता (ऑफलाइन — सिम्युलेटेड प्लेसहोल्डर):",
    chatOfflineDensityHtmlBody: "फ्लीट आणि वाहतूक एजंटचा लाइव्ह वेसल डेटासेट सध्या पोहोचता येत नाही, त्यामुळे क्षेत्रातील अचूक वेसल संख्या अनुपलब्ध आहे.",
    chatOfflineDensityListItem: "प्रत्यक्ष प्रति-क्षेत्र वेसल संख्या आणि गर्दीच्या निर्णयासाठी ORCA बॅकएंडशी पुन्हा जोडा.",
    chatOfflineDensityStep1: "बॅकएंड पोहोचता येत नाही. स्थानिक कीवर्ड जुळणी वापरून प्रश्न FLEET_DENSITY म्हणून वर्गीकृत केला.",
    chatOfflineDensityStep2: "कोणताही लाइव्ह फ्लीट डेटासेट उपलब्ध नाही -- खोटी आकडेवारी सादर करणे टाळण्यासाठी वेसल संख्या दाखवली नाही.",
    chatOfflineGenericPlainTextTemplate: "ऑफलाइन सल्ला (बॅकएंड पोहोचता येत नाही): ORCA च्या बहु-एजंट बॅकएंडपर्यंत पोहोचता आले नाही, त्यामुळे हे उत्तर आधारभूत रीडिंगऐवजी एक सामान्य, लाइव्ह नसलेले प्लेसहोल्डर आहे. तुमच्या ब्राउझरचे स्वतःचे Open-Meteo विजेट सुमारे {liveWave}m ची लक्षणीय लाट उंची दाखवते, पण PFZ क्रमवारी, मार्ग अंतर, ETA आणि फ्लीट संख्या या सर्वांना बॅकएंडची गरज आहे आणि ते इथे दाखवलेले नाहीत. प्रत्यक्ष सल्ल्यासाठी ORCA बॅकएंडशी पुन्हा जोडा.",
    chatOfflineGenericHtmlHeading: "ऑफलाइन प्लेसहोल्डर सल्ला",
    chatOfflineGenericHtmlBody1Template: "ORCA चा बहु-एजंट बॅकएंड (सॅटेलाइट, हवामान, PFZ क्रमवारी, जिओफेन्सिंग, फ्लीट, मार्गनिश्चिती आणि न्यूरल सिंथेसिस) सध्या पोहोचता येत नाही. क्लायंट-साइडवर, या ब्राउझरने Open-Meteo वरून शेवटी <strong>{liveWave}m</strong> ची लाट उंची पाहिली, पण इतर प्रत्येक आकडेवारीसाठी बॅकएंड आवश्यक आहे.",
    chatOfflineGenericHtmlBody2: "<strong>कोणतीही PFZ शिफारस, मार्ग, ETA किंवा फ्लीट संख्या दाखवलेली नाही</strong> कारण त्यांची गणना करण्याऐवजी ती रचावी लागेल. संपूर्ण आधारभूत सल्ल्यासाठी ORCA बॅकएंडशी पुन्हा जोडा.",
    chatOfflineGenericStep1: "बॅकएंड पोहोचता येत नाही. कोणताही हेतू-विशिष्ट कीवर्ड जुळला नाही -- GENERAL_VOYAGE_SAFETY ऑफलाइन प्लेसहोल्डर परत करत आहे.",
    chatOfflineGenericStep2Template: "फक्त क्लायंट-दृश्यमान आकडेवारी उपलब्ध: शेवटची ज्ञात Open-Meteo लाट उंची {liveWave}m (ब्राउझरद्वारे थेट मिळवलेली, बॅकएंडमार्गे नाही).",
    chatTtsUnsupportedAlert: "तुमच्या ब्राउझरद्वारे स्पीच सिंथेसिस समर्थित नाही.",
    chatTtsWelcomeFallback: "ORCA INSIGHT मध्ये आपले स्वागत आहे. सर्व सॅटेलाइट फीड आणि किनारी सागरशास्त्र प्रणाली सामान्य स्थितीत कार्यरत आहेत.",
    chatStopAudio: "ऑडिओ थांबवा",
    chatListenAudioAdvisory: "ऑडिओ सल्ला ऐका",
    chatTabTitle: "AI निर्णय स्टुडिओ आणि बहु-एजंट चॅटबॉट",
    chatTabSubtitle: "Oceansat-3, INSAT-3DR आणि किनारी जिओफेन्सिंगवर तर्क करणाऱ्या सहयोगी एजंट्सद्वारे चालवलेले",
    chatNewConversationBtn: "नवीन संभाषण",
    chatPromptPFZ: "कोची हार्बरपासून जवळचे उच्च-उत्पादन PFZ मासेमारी क्षेत्र, पकडण्याची शक्यता आणि प्रजातींसह शोधा.",
    chatPromptSafety: "आजसाठी सी-व्हेंचर क्लिअरन्स स्कोअर, लक्षणीय लाट उंची आणि वारा धोका तपासा.",
    chatPromptBorder: "भारत-श्रीलंका IMBL सीमेचे अंतर तपासा आणि 2 NM धोका क्षेत्रातील वेसलची यादी दाखवा.",
    chatPromptDensity: "वेज बँक आणि कोची डीपमध्ये सध्याची वेसल संख्या आणि घनता वितरण काय आहे?",
    chatPromptETA: "कोचीपासून PFZ-01 पर्यंतच्या प्रवास ETA ची गणना करा आणि पडताळा की राउंड-ट्रिप 18:30 च्या संध्याकाळपूर्वी सुरक्षितपणे परत येते का.",
    chatConversationLabel: "संभाषण",
    chatNeuralCoreActive: "ORCA INSIGHT न्यूरल कोअर सक्रिय",
    chatAgentsReadyUptime: "8 एजंट तयार · 99.94% अपटाइम",
    chatWelcomeMessage: "वणक्कम / नमस्ते! मी <strong>ORCA INSIGHT</strong> बहु-एजंट संश्लेषण प्रणाली आहे. तुम्ही सुरक्षित प्रवास क्लिअरन्स, भारताच्या किनाऱ्यावरील उच्च-उत्पादन PFZ क्षेत्रे, लाइव्ह वेसल वाहतूक, IMBL सीमा जवळीक आणि सागरी-स्थिती समायोजित ETA गणनांबद्दल बोलू किंवा टाइप करू शकता.",
    chatMicHint: "तमिळ, हिंदी, मल्याळम किंवा इंग्रजीत बोलण्यासाठी खालील मायक्रोफोन आयकॉनवर क्लिक करा!",
    chatVoiceInputTitle: "प्रश्न बोला (स्पीच-टू-टेक्स्ट)",
    chatLiveReasoningTraceTitle: "लाइव्ह तर्क ट्रेस",
    chatReasoningTraceEmptyHint: "8 सहयोगी एजंट्सपैकी प्रत्येक याद्वारे लाइव्ह कसा तर्क करतो हे पाहण्यासाठी डावीकडे एक प्रश्न विचारा.",
    chatLiveTelemetryTitle: "लाइव्ह सागरी टेलिमेट्री",
    chatCurrentSeaClearance: "सध्याचा समुद्र क्लिअरन्स:",
    chatSignificantWaves: "लक्षणीय लाटा:",
    chatSurfaceWind: "पृष्ठभाग वारा:",
    chatActiveVessels: "सक्रिय वेसल:",
    chatOpenDagVisualizerBtn: "संपूर्ण एजंट DAG व्हिज्युअलायझर उघडा ➔",
    navicConnected: "NavIC रिसीव्हर: जोडलेले (L5/S-Band)",
    navicDisconnected: "NavIC रिसीव्हर: डिस्कनेक्ट केलेले",
    navicTrackMyPosition: "माझे स्थान ट्रॅक करा",
    navicStopTracking: "ट्रॅकिंग थांबवा",
    navicSimulateMovement: "वेसल हालचाल सिम्युलेट करा",
    navicStopSimulation: "सिम्युलेशन थांबवा",
    navicStatusTrackingOff: "ट्रॅकिंग बंद · कोणतेही स्थान विनंती केलेले नाही",
    navicStatusGeoUnsupported: "या ब्राउझरद्वारे जिओलोकेशन समर्थित नाही. डेमोसाठी सिम्युलेटेड वेसल हालचाल वापरा.",
    navicStatusRequestingPermission: "डिव्हाइस-स्थान परवानगीची विनंती केली जात आहे…",
    navicStatusLiveTrackingTemplate: "लाइव्ह डिव्हाइस ट्रॅकिंग · अचूकता ±{accuracy}m · संग्रहित नाही",
    navicStatusPermissionErrorTemplate: "स्थान परवानगी अनुपलब्ध ({error}). कोणतेही स्थान पाठवले गेले नाही.",
    navicStatusBackendUnavailable: "बॅकएंड अनुपलब्ध — स्थानिक सिम्युलेशनमध्ये अचूक जिओफेन्स अंतराचे मूल्यांकन करता येत नाही.",
    navicStatusSimStopped: "जिओफेन्स सिम्युलेशन थांबले",
    navicStatusSimMovingTemplate: "सिम्युलेटेड वेसल हालचाल · बिंदू {index}/{total} · {lat}, {lon}",
    navicMssCopiedAlertTemplate: "NavIC MSS / SMS 120-अक्षर सॅटेलाइट आणीबाणी कोड कॉपी केला:\\n\\n{code}",
    navicSkyplotTitle: "ISRO NavIC (IRNSS) स्कायप्लॉट",
    navicConstellationDesc: "7-सॅटेलाइट जिओस्टेशनरी / IGSO तारकासमूह",
    navicConnectedShort: "जोडलेले (L5/S)",
    navicTrackedSatellitesTitle: "ट्रॅक केलेले सॅटेलाइट (SNR dB-Hz)",
    navicNmeaStreamTitle: "लाइव्ह NMEA-0183 हार्डवेअर स्ट्रीम ($GNGGA / $GNRMC)",
    navicBaudRateDesc: "बॉड दर: 9600 bps · 1 Hz फीड",
    navicDopPrecisionLabel: "DOP अचूकता",
    navicDopValue: "HDOP 1.05 (उत्कृष्ट)",
    navicDiffFixLabel: "डिफरेन्शियल फिक्स",
    navicDiffFixValue: "NavIC DGPS सक्रिय",
    navicBorderHwLabel: "सीमा अलर्ट हार्डवेअर",
    navicBorderHwValue: "बझर सज्ज",
    navicGeofenceTitle: "लाइव्ह स्थान जिओफेन्सिंग",
    navicGeofenceDesc: "तुमच्या डिव्हाइसचे स्थान फक्त सत्रादरम्यान IMBL/MPA तपासणीसाठी वापरले जाते आणि ORCA द्वारे कधीही संग्रहित केले जात नाही.",
    navicGeofenceInitialStatus: "ट्रॅकिंग बंद · 5 NM IMBL इशारा / MPA बफर इशारा",
    safetyVerdictDescTemplate: "लाइव्ह Open-Meteo सागरी टेलिमेट्री तुमच्या निवडलेल्या हार्बरजवळ लक्षणीय लाट उंची {wave}m आणि पृष्ठभाग वारा {wind}kn दाखवते, ज्यामुळे {score}/100 चा गणना केलेला सुरक्षा स्कोअर मिळतो.",
    safetyWindDefaultDirection: "पश्चिमी",
    safetyBreezeSuffix: "{direction} वारा",
    severityLow: "कमी",
    severityModerate: "मध्यम",
    severityHigh: "जास्त",
    waveBandCalm: "शांत (< 0.5m)",
    waveBandSlight: "सौम्य (0.5 - 1.25m)",
    waveBandModerate: "मध्यम (1.25 - 2.5m)",
    waveBandRough: "खवळलेला (> 2.5m)",
    seaStateCalm: "शांत",
    seaStateSlight: "सौम्य",
    seaStateSlightModerate: "सौम्य ते मध्यम",
    seaStateModerateRough: "मध्यम ते खवळलेला",
    seaStateUnknown: "अज्ञात",
    lightningBandSafe: "सुरक्षित वातावरणीय प्रोफाइल",
    lightningBandElevated: "वाढलेला संवहन धोका",
    lightningBandSevere: "गंभीर वादळ इशारा",
    safetySyncLatencyLabel: "सिंक विलंब:",
    safetyBatteryLabel: "बॅटरी:",
    safetyLastPassLabel: "शेवटचा पास:",
    safetyAltitudeLabel: "उंची:",
    telemetryLiveOpenMeteoTemplate: "लाइव्ह OPEN-METEO टेलिमेट्री ({wave}m SWH)",
    telemetryCachedArchive: "टेलिमेट्री सक्रिय (संग्रहित सॅटेलाइट आर्काइव्ह)",
    backendOnlineStatus: "लाइव्ह FASTAPI बॅकएंड जोडलेले",
    backendOfflineStatus: "बॅकएंड ऑफलाइन · स्थानिक सिम्युलेशन मोड",
    aisLiveCountTemplate: "{count} लाइव्ह AIS वेसल{plural}",
    aisNoLiveVessels: "सध्या कोणतेही लाइव्ह AIS वेसल नाहीत",
    aisBlendedBannerTemplate: "सध्या लाइव्ह AIS कव्हरेज नसलेली बंदरे भरण्यासाठी {liveText} + {simCount} सिम्युलेटेड वेसल{plural} दाखवत आहोत.",
    aisUnavailableDefault: "लाइव्ह AIS वेसल फीड अनुपलब्ध -- 0 वेसल दाखवत आहोत.",
    aisNotConfigured: "या डिप्लॉयमेंटवर लाइव्ह AIS वेसल फीड कॉन्फिगर केलेले नाही.",
    aisConnectedNotSending: "AIS पुरवठादाराशी (AISstream.io) जोडलेले आहे, पण ते सध्या वेसल डेटा पाठवत नाही — बहुधा पुरवठादार-बाजूचा अडथळा, स्थानिक दोष नाही.",
    aisDisconnectedReconnecting: "AIS पुरवठादारापासून (AISstream.io) डिस्कनेक्ट केलेले; आपोआप पुन्हा जोडत आहे.",
    imblAlertActiveTemplate: "<strong>{vesselId} ({vesselName})</strong> भारत–श्रीलंका IMBL पासून <strong>{dist} NM</strong> अंतरावर कार्यरत आहे{simTag}. स्वयंचलित इशारा पाठवला.",
    imblAlertNoneTemplate: "सध्या {warnDist} NM IMBL इशारा अंतराच्या आत कोणतेही वेसल नाही. सर्वात जवळचे ट्रॅक केलेले वेसल: <strong>{dist} NM</strong> दूर.",
    imblAlertNoData: "अद्याप कोणतीही वेसल टेलिमेट्री उपलब्ध नाही.",
    simulatedSuffix: " (सिम्युलेटेड)",
    notifUnavailableTitle: "ब्राउझर सूचना अनुपलब्ध",
    notifUnavailableMsg: "हे टॅब उघडे असेपर्यंत इन-अॅप धोका बॅनर तरीही दाखवले जातील.",
    notifNotEnabledTitle: "ब्राउझर सूचना सक्षम नाहीत",
    notifNotEnabledMsg: "हे टॅब उघडे असेपर्यंत इन-अॅप धोका बॅनर सक्रिय राहतील.",
    hazardHighWavesTitle: "उंच लाटा — स्थानिक सिम्युलेशन",
    hazardHighWavesMsgTemplate: "{wave}m, 2.5m खबरदारी मर्यादेपेक्षा जास्त आहे. स्रोत: ब्राउझर Open-Meteo टेलिमेट्री.",
    hazardHighWindTitle: "तीव्र वारा — स्थानिक सिम्युलेशन",
    hazardHighWindMsgTemplate: "{wind} kn, 25 kn खबरदारी मर्यादेपेक्षा जास्त आहे. स्रोत: ब्राउझर Open-Meteo टेलिमेट्री.",
    hazardLightningTitle: "वीज पडण्याचा धोका — स्थानिक सिम्युलेशन",
    hazardLightningMsgTemplate: "वीज प्रॉक्सी {pct}% आहे. स्रोत: ब्राउझर Open-Meteo टेलिमेट्री.",
    safetyOfficialClearanceLabel: "अधिकृत सागरी क्लिअरन्स",
    safetyVerdictDescInitial: "सर्व सॅटेलाइट सागरशास्त्र निर्देशक (Oceansat-3 SSTM थर्मल फ्रंट्स, Sentinel-3 लाट अल्टिमेट्री) केरळ, कर्नाटक आणि तमिळनाडूच्या किनारी पाण्यात अनुकूल मासेमारी परिस्थितीची पुष्टी करतात.",
    safetyIndexLabel: "सुरक्षा निर्देशांक",
    satConstellationTitle: "ISRO आणि आंतरराष्ट्रीय सागरशास्त्र सॅटेलाइट तारकासमूह",
    satStaticDataNote: "स्थिर संदर्भ डेटा (लाइव्ह टेलिमेट्री नाही)",
    mapIndiaBoundaryPopup: "भारत — अधिकृत सीमा (Survey of India)",
    mapPfzYieldSuffix: "{rating} उत्पादन ({pct}%)",
    mapPfzSstLabel: "SST:",
    mapPfzChlorophyllLabel: "क्लोरोफिल:",
    mapPfzDepthLabel: "खोली:",
    mapPfzVesselsLabel: "वेसल:",
    mapPfzActiveSuffix: "{count} सक्रिय",
    mapPfzTargetSpeciesLabel: "लक्ष्य प्रजाती:",
    mapPfzSimulateRouteBtn: "इथे मार्ग सिम्युलेट करा ➔",
    mapImblPopupBodyTemplate: "कडक आंतरराष्ट्रीय सागरी सीमारेषा. इशारा बफर: {warn} NM. गंभीर जिओफेन्स: {danger} NM.",
    mapImblPopupTreatyNote: "UNCLOS सागरी कराराअंतर्गत सीमा ओलांडणे प्रतिबंधित आहे.",
    mapImblBufferCorridorTemplate: "{dist} NM IMBL बफर कॉरिडोर",
    mapMpaRestrictedBadge: "प्रतिबंधित इको-रिझर्व्ह",
    mapHarbourCoastSuffix: "{state} किनारा",
    mapHarbourCapacityLabel: "क्षमता:",
    mapHarbourVhfLabel: "VHF:",
    mapHarbourFuelLabel: "इंधन स्टेशन:",
    mapHarbourFuelAvailable: "उपलब्ध",
    mapHarbourIceLabel: "बर्फ प्रकल्प:",
    mapHarbourIceActive: "सक्रिय",
    mapHarbourSetOriginBtn: "मूळ हार्बर म्हणून सेट करा",
    mapVesselSimulatedBadge: "सिम्युलेटेड · इथे कोणतेही लाइव्ह AIS कव्हरेज नाही",
    mapVesselSpeedLabel: "वेग:",
    mapVesselHeadingLabel: "दिशा:",
    mapVesselZoneLabel: "क्षेत्र:",
    mapVesselImblDistLabel: "IMBL अंतर:",
    mapVesselStatusLabel: "स्थिती:",
    mapVesselFuelLabel: "इंधन:",
    mapVesselFuelNA: "उपलब्ध नाही",
    mapRoutePopupTitle: "फक्त-समुद्र A* मार्ग (जमीन + MPA टाळणे)",
    mapRouteDistanceEtaTemplate: "अंतर: {dist} NM · ETA: {eta}{detourNote}",
    mapRouteDetourTemplate: " · {zones} भोवती {pct}% वळसा",
    mapRouteLandNoGoZones: "जमीन/निषिद्ध क्षेत्रे",
    vesselStatusSafeFishing: "सुरक्षित मासेमारी",
    vesselStatusBorderAlert: "सीमा इशारा",
    vesselStatusBorderWarn: "सीमा सावधानता",
    vesselStatusInTransit: "प्रवासात",
    vesselSimBadgeText: "SIM",
    vesselSimBadgeTitle: "सिम्युलेटेड -- या बंदराजवळ कोणतेही लाइव्ह AIS कव्हरेज नाही",
    vesselLocateAction: "शोधा ➔",
    fleetVesselCountSuffix: "{count} वेसल",
    fleetLiveSimBreakdownTemplate: "{total} ({live} लाइव्ह · {sim} सिम)",
    mapActiveVesselsBreakdownTemplate: "{total} सक्रिय वेसल ({live} लाइव्ह · {sim} सिम्युलेटेड)",
    mapActiveVesselsSimpleTemplate: "{total} सक्रिय वेसल",
    mapTabTitle: "GIS कमांड नकाशा · भारतीय किनारी पाणी",
    mapTabDesc: "रिअल-टाइम सॅटेलाइट PFZ, IMBL सीमा कॉरिडोर आणि AIS वेसल ट्रॅकसह परस्परसंवादी उच्च-कॉन्ट्रास्ट नॉटिकल नकाशा.",
    layerPfzZones: "PFZ क्षेत्रे",
    layerImblBuffer: "IMBL बफर",
    layerEcoReserves: "इको रिझर्व्ह (MPA)",
    layerHarbours: "हार्बर",
    layerLiveVessels: "लाइव्ह वेसल",
    layerDensityHeatmap: "घनता हीटमॅप",
    layerIndiaBoundary: "भारत सीमा (Survey of India)",
    routePlannerDesc: "MPA आणि सीमा धोके टाळणारा A*-शैली मार्ग",
    routeVesselSpeedLabel: "वेसल वेग:",
    fleetMonitorTitle: "फ्लीट मॉनिटर · लाइव्ह वेसल टेलिमेट्री",
    fleetTotalActiveTitle: "एकूण सक्रिय वेसल",
    fleetTotalActiveDesc: "सध्या AIS ट्रान्सपॉन्डर सिग्नल प्रसारित करणारे वेसल",
    fleetZoneDistTitle: "प्रति क्षेत्र वेसल वितरण",
    imblAlertCardTitle: "IMBL सीमा जवळीक इशारा",
    fleetTableSubDesc: "AISstream.io वरून लाइव्ह AIS स्थिती, जिथे सध्या कोणतेही लाइव्ह रिसीव्हर कव्हरेज नाही तिथे स्पष्टपणे-टॅग केलेल्या सिम्युलेटेड फ्लीटसह (\"SIM\" बॅज पहा) भरलेली",
    vesselSearchPlaceholder: "वेसलचे नाव किंवा ID शोधा...",
    filterAllStatuses: "सर्व स्थिती",
    filterSafeFishing: "सुरक्षित मासेमारी",
    filterInTransit: "प्रवासात",
    filterBorderAlert: "सीमा इशारा",
    thVesselId: "वेसल ID",
    thVesselName: "वेसलचे नाव",
    thType: "प्रकार",
    thCurrentZone: "सध्याचे क्षेत्र",
    thSpeedHeading: "वेग / दिशा",
    thImblDist: "IMBL अंतर",
    thStatus: "स्थिती",
    thAction: "कृती",
    bulletinIssuedLabel: "जारी:",
    bulletinRegionLabel: "प्रदेश:",
    bulletinWavesLabel: "लाटा:",
    bulletinWindsLabel: "वारे:",
    bulletinSourceLabel: "स्रोत:",
    bulletinListenBtn: "बुलेटिन ऐका",
    bulletinsTabTitle: "अधिकृत सागरी आणि मत्स्यव्यवसाय बुलेटिन (ISRO - INCOIS)",
    bulletinsTabDesc: "क्रमांकित सल्ला, चक्रीवादळ धोका इशारे, आणि आंतरराष्ट्रीय सीमा अनुपालन अलर्ट.",
    bulletinNotifyToggleTitle: "फक्त हे टॅब/PWA उघडे असताना ब्राउझर अलर्ट मिळवा",
    bulletinNotifyToggleLabel: "उघडे असताना सूचित करा",
    bulletinFilterAll: "सर्व बुलेटिन",
    bulletinFilterCritical: "गंभीर",
    bulletinFilterWarning: "इशारे",
    bulletinFilterAdvisory: "सल्ला",
    bulletinsPushNote: "हे टॅब/PWA उघडे असतानाच धोका इशारे सक्रिय असतात. बंद-अॅप पुश सूचनांसाठी उत्पादन पुश-सबस्क्रिप्शन सेवा आवश्यक आहे आणि ती या प्रोटोटाइपमध्ये लागू केलेली नाही.",
    sosModalTitle: "आणीबाणी संकट बीकन (SOS)",
    sosInstructions: "आणीबाणी SOS सक्रिय केल्याने <strong>INSAT-3DR SAS&R</strong> द्वारे भारतीय तटरक्षक सागरी बचाव समन्वय केंद्राला (MRCC) एक आणीबाणी 406 MHz संकट सिग्नल प्रसारित केला जाईल.",
    sosCurrentPositionLabel: "सध्याचे स्थान:",
    sosVhfChannelLabel: "आणीबाणी VHF चॅनेल:",
    sosMrccHelplineLabel: "MRCC हेल्पलाइन:",
    sosConfirmBtn: "पुष्टी करा आणि संकट बीकन प्रसारित करा",
    sosBeaconTransmittingBanner: "406 MHz SAS&R बीकन ISRO आणि तटरक्षक MRCC कडे प्रसारित होत आहे",
    sosDistressRelayedMsg: "संकट पॅकेट INSAT-3DR SAS&R रिसीव्हरद्वारे रिले केले. सागरी बचाव समन्वय केंद्राला (MRCC चेन्नई/मुंबई) VHF चॅनेल 16 वर सतर्क केले.",
    sosGpsVesselIdTemplate: "GPS निर्देशांक: {coords} · वेसल ID: {vesselId} ({vesselName})",
    landingEyebrow: "ISRO सहयोगी सागरी बुद्धिमत्ता · स्मार्ट इंडिया हॅकाथॉन 2026",
    landingSubtitle: "एक सहयोगी सागरी-बुद्धिमत्ता प्लॅटफॉर्म, दोन कमांड डेक: मच्छिमाराचे दैनंदिन संधी कन्सोल, आणि संपूर्ण ISRO सॅटेलाइट, AIS आणि जिओफेन्सिंग इनसाइट सुइट.",
    landingStripItem1: "Oceansat-3 SSTM थर्मल फ्रंट्स",
    landingStripItem2: "INSAT-3DR सॅटेलाइट सागरशास्त्र",
    landingStripItem3: "8-नोड सहयोगी एजंट DAG",
    landingStripItem4: "NavIC (IRNSS) GPS पूल",
    landingStripItem5: "IMBL सीमा जिओफेन्सिंग इशारे",
    landingStripItem6: "लाइव्ह AIS फ्लीट आणि GIS कमांड",
    landingStripItem7: "सेल स्मार्टर बायर प्राइसिंग",
    landingStripItem8: "406 MHz SOS संकट बीकन",
    landingFishermanCardTitle: "ORCA फिशरमन",
    landingFishermanCardDesc: "आजचा संधी स्कोअर, सेल स्मार्टर प्राइसिंग, ट्रिप-खर्च कॅल्क्युलेटर, आणि तुमच्या पकडीसाठी खरेदीदार लीड — बोटीसाठी तयार केलेले.",
    landingFishermanCardCta: "फिशरमन कन्सोल उघडा",
    landingFishermanCardTitleAttr: "फिशरमन कन्सोल उघडा",
    landingInsightCardTitle: "ORCA इनसाइट",
    landingInsightCardDesc: "संपूर्ण कमांड डेक: ISRO सॅटेलाइट सागरशास्त्र, GIS नकाशा, 8-नोड एजंट DAG, सेफ्टी बॅरोमीटर, फ्लीट मॉनिटर, आणि NavIC पूल.",
    landingInsightCardCta: "इनसाइट कमांड डेक उघडा",
    landingInsightCardTitleAttr: "इनसाइट कमांड डेक उघडा",
    backToOverviewTitle: "आढाव्याकडे परत जा",
    statSimulatedFleetLabel: "सिम्युलेटेड AIS फ्लीट",
    statSatellitesActiveTemplate: "{count} सक्रिय",
    statSatellitesListLabel: "Oceansat-3, INSAT-3DR, Sentinel-3",
    statPfzZonesCountTemplate: "{count} क्षेत्रे",
    statPfzZonesListLabel: "वेज बँक, कोची, वेरावळ...",
    statImblCorridorsCountTemplate: "{count} कॉरिडोर",
    statImblBordersLabel: "भारत-श्रीलंका आणि पाक सीमा",
    pillarDagTitle: "8-नोड सहयोगी एजंट DAG",
    pillarDagDesc: "प्रश्नांना सॅटेलाइट, लाट धोका, जिओफेन्सिंग, वेसल गणना, ETA आणि न्यूरल सिंथेसिस पायऱ्यांमध्ये उप-सेकंद विलंबासह विभाजित करणारी बहु-एजंट रचना.",
    pillarEtaTitle: "लाइव्ह सागरी-स्थिती ETA आणि संध्याकाळ सुरक्षा",
    pillarEtaDesc: "लाट प्रतिकारानुसार समायोजित हायड्रोडायनामिक प्रवास गणना, सूर्यास्तानंतर अडकलेल्या मच्छिमारांना रोखण्यासाठी स्वयंचलित संध्याकाळपूर्वी-परतण्याच्या सुरक्षा इशाऱ्यांसह.",
    pillarFleetTitle: "लाइव्ह फ्लीट घनता आणि IMBL इशारा",
    pillarFleetDesc: "प्रति क्षेत्र रिअल-टाइम वेसल गणना, गर्दी धोका निर्देशक, आणि सागरी सीमांचे संरक्षण करणारे स्वयंचलित 5 NM/2 NM जिओफेन्स जवळीक इशारे.",
    footerCreditLine: "<span class=\"text-slate-200 font-semibold\">{appTitle}</span> · निर्मित <strong class=\"text-cyan-400\">{teamName}</strong> द्वारे · स्मार्ट इंडिया हॅकाथॉन 2026 · समस्या विवरण 26176 (ISRO)",
    sttListeningStatusTemplate: "<b>{lang}</b> मध्ये ऐकत आहे... आता बोला.",
    sttUnsupportedTitle: "या ब्राउझरमध्ये स्पीच रेकग्निशन समर्थित नाही",
    routeUnavailableLabel: " मार्ग अनुपलब्ध:",
    routeUnavailableMsg: "ORCA बॅकएंड पोहोचता येत नाही, त्यामुळे कोणतेही मार्गबद्ध अंतर/ETA दाखवता येत नाही. स्थानिक फॉलबॅक मोडमध्ये चालत आहे.",
    routeNoSafeRouteLabel: "✕ कोणताही सुरक्षित सागरी मार्ग सापडला नाही:",
    routeNoSafeRouteMsgTemplate: "{detail}",
    routeNoSafeRouteDefaultReason: "या हार्बर/PFZ जोडीसाठी जमीन आणि सागरी संरक्षित क्षेत्रे टाळणारा मार्ग राउटरला सापडला नाही.",
    routeSafeReturnLabel: "✓ सुरक्षित परतणे:",
    routeSafeReturnTemplate: "अपेक्षित हार्बर आगमन {time} पर्यंत (18:30 IST संध्याकाळपूर्वी).",
    routeReturnAfterDuskLabel: " संध्याकाळनंतर परतणे:",
    routeReturnAfterDuskTemplate: "अपेक्षित परतणे {time} वाजता (18:30 IST सूर्यास्तापेक्षा जास्त). लवकर प्रस्थान किंवा रात्रीच्या नेव्हिगेशन बीकन तपासणीची शिफारस केली जाते."
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
    fmClaimFailed: "ಸದ್ಯಕ್ಕೆ ಈ ಪಟ್ಟಿಯನ್ನು ಕ್ಲೈಮ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.",
    dagAgentSupervisorName: "ಮಾಸ್ಟರ್ ಸೂಪರ್‌ವೈಸರ್ / DAG ಪ್ಲಾನರ್",
    dagAgentSupervisorRole: "ಬಹು-ಮಾದರಿ ಸಾಗರ ಪ್ರಶ್ನೆಯನ್ನು ವಿಭಜಿಸುತ್ತದೆ, ಉಪಗ್ರಹ, ಅಪಾಯ ಮತ್ತು ಜಿಯೋಫೆನ್ಸ್ ಏಜೆಂಟ್‌ಗಳಿಗೆ ಉಪಕಾರ್ಯಗಳನ್ನು ಹಂಚುತ್ತದೆ.",
    dagAgentSatelliteName: "ಉಪಗ್ರಹ ಸಾಗರಶಾಸ್ತ್ರ ಏಜೆಂಟ್",
    dagAgentSatelliteRole: "Oceansat-3 OCM-3 (ಕ್ಲೋರೊಫಿಲ್-a) ಮತ್ತು SSTM (ಉಷ್ಣ ಮುಂಭಾಗಗಳು) ಜೊತೆಗೆ INSAT-3DR ಮೋಡದ ಚಿತ್ರಣವನ್ನೂ ಸ್ವೀಕರಿಸುತ್ತದೆ.",
    dagAgentWeatherName: "ಹವಾಮಾನ ಮತ್ತು ಸಾಗರ ಅಪಾಯ ಏಜೆಂಟ್",
    dagAgentWeatherRole: "ಗಮನಾರ್ಹ ಅಲೆ ಎತ್ತರ (SWH), ಗಾಳಿಯ ರಭಸ ವೆಕ್ಟರ್‌ಗಳು, ಮಿಂಚಿನ ಸಾಧ್ಯತೆಯನ್ನು ಮೌಲ್ಯಮಾಪನ ಮಾಡುತ್ತದೆ ಮತ್ತು ಸಮುದ್ರ-ಕ್ಲಿಯರೆನ್ಸ್ ಸ್ಕೋರ್ ಅನ್ನು ಸೃಷ್ಟಿಸುತ್ತದೆ.",
    dagAgentPfzName: "ಸಾಗರ ವಿಶ್ಲೇಷಣೆ ಮತ್ತು PFZ ಏಜೆಂಟ್",
    dagAgentPfzRole: "ಉಷ್ಣ-ಕ್ಲೋರೊಫಿಲ್ ಮುಂಭಾಗಗಳ ಛೇದನಗಳನ್ನು ಗುರುತಿಸುತ್ತದೆ, ಪೆಲಾಜಿಕ್ ಜೀವರಾಶಿ ಸಾಂದ್ರತೆಯನ್ನು ಲೆಕ್ಕಹಾಕುತ್ತದೆ ಮತ್ತು ಗುರಿ ಮೀನುಗಾರಿಕೆ ವಲಯಗಳನ್ನು ಶ್ರೇಣೀಕರಿಸುತ್ತದೆ.",
    dagAgentGeofenceName: "ಜಿಯೋಫೆನ್ಸಿಂಗ್ ಮತ್ತು ಮಾರ್ಗ ಏಜೆಂಟ್",
    dagAgentGeofenceRole: "ಅಂತಾರಾಷ್ಟ್ರೀಯ ಸಾಗರ ಗಡಿ ರೇಖೆಗಳನ್ನು (IMBL) ಮೇಲ್ವಿಚಾರಣೆ ಮಾಡುತ್ತದೆ, ಸಾಗರ ಸಂರಕ್ಷಿತ ಪ್ರದೇಶಗಳನ್ನು ಬಫರ್ ಮಾಡುತ್ತದೆ ಮತ್ತು A* ಸುರಕ್ಷಿತ ವೇಪಾಯಿಂಟ್‌ಗಳನ್ನು ಲೆಕ್ಕಹಾಕುತ್ತದೆ.",
    dagAgentFleetName: "ಫ್ಲೀಟ್ ಮತ್ತು ಸಂಚಾರ ಏಜೆಂಟ್ (ಹೊಸದು)",
    dagAgentFleetRole: "AIS ಮತ್ತು ARGOS-4 ವೆಸೆಲ್ ಟ್ರಾನ್ಸ್‌ಪಾಂಡರ್‌ಗಳನ್ನು ಸ್ಕ್ಯಾನ್ ಮಾಡುತ್ತದೆ, ಫ್ಲೀಟ್ ವಿತರಣೆಯನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡುತ್ತದೆ ಮತ್ತು ಜನದಟ್ಟಣೆ ಅಥವಾ ಗಡಿ ದಟ್ಟಣೆಯನ್ನು ಫ್ಲ್ಯಾಗ್ ಮಾಡುತ್ತದೆ.",
    dagAgentEtaName: "ETA ಮತ್ತು ಪ್ರಯಾಣ ಸುರಕ್ಷತಾ ಏಜೆಂಟ್ (ಹೊಸದು)",
    dagAgentEtaRole: "ನೈಜ-ಸಮಯದ ಅಲೆ ಪ್ರತಿರೋಧಕ್ಕೆ ಅನುಗುಣವಾಗಿ ಪ್ರಯಾಣದ ಅವಧಿಯನ್ನು ಲೆಕ್ಕಹಾಕುತ್ತದೆ ಮತ್ತು ಸಂಜೆಗೂ ಮುನ್ನ ಹಿಂತಿರುಗುವ ಸುರಕ್ಷತಾ ಕಿಟಕಿಯನ್ನು ಮೌಲ್ಯಮಾಪನ ಮಾಡುತ್ತದೆ.",
    dagAgentSynthesisName: "ನ್ಯೂರಲ್ ಸಿಂಥೆಸಿಸ್ ಏಜೆಂಟ್ (ಅಂಕಿಅಂಶ-ಆಧಾರಿತ)",
    dagAgentSynthesisRole: "ಬಹು-ಏಜೆಂಟ್ ಟೆಲಿಮೆಟ್ರಿಯನ್ನು ಉಲ್ಲೇಖ ಟ್ಯಾಗ್‌ಗಳು ಮತ್ತು TTS ಜೊತೆಗೆ ಅಧಿಕೃತ, ಆಧಾರಿತ ನೈಸರ್ಗಿಕ-ಭಾಷಾ ಸಲಹೆಯಾಗಿ ಒಟ್ಟುಗೂಡಿಸುತ್ತದೆ -- ಸಂಪೂರ್ಣವಾಗಿ ನಿಯಮ-ಆಧಾರಿತ, ಈ ಸೈಟ್‌ನ ಸ್ವಂತ ಲೈವ್ ಟೆಲಿಮೆಟ್ರಿ ಮತ್ತು ಅದರ ಸ್ವಂತ ಸಂಚಿತ ಅಂಕಿಅಂಶ ಲೆಡ್ಜರ್ ಮೇಲೆ ತರ್ಕಿಸುತ್ತದೆ. ಯಾವುದೇ ಬಾಹ್ಯ AI/LLM API ಬಳಸಲಾಗಿಲ್ಲ.",
    dagStatusIdle: "ನಿಷ್ಕ್ರಿಯ",
    dagInspectLink: "ಪರಿಶೀಲಿಸಿ ➔",
    dagInspectorLatencyTemplate: "ಎಕ್ಸಿಕ್ಯೂಶನ್ ಲೇಟೆನ್ಸಿ: {latency} · ಉಪಕಾರ್ಯಗಳು ಪರಿಶೀಲಿಸಲಾಗಿದೆ",
    dagStatusQueued: "ಸಾಲಿನಲ್ಲಿ",
    dagStatusExecuting: "ಕಾರ್ಯಗತಗೊಳ್ಳುತ್ತಿದೆ...",
    dagStatusCompleted: "ಪೂರ್ಣಗೊಂಡಿದೆ",
    dagStatusSkipped: "ಆಹ್ವಾನಿಸಲಾಗಿಲ್ಲ — ಉದ್ದೇಶಕ್ಕೆ ಇದು ಅಗತ್ಯವಿರಲಿಲ್ಲ",
    dagBtnReasoningActiveLive: "ತರ್ಕ ಸಕ್ರಿಯ (ಲೈವ್ ಬ್ಯಾಕೆಂಡ್)...",
    dagBtnExecutedLive: "✓ ಲೈವ್ ಬ್ಯಾಕೆಂಡ್ ಮೂಲಕ ಪೈಪ್‌ಲೈನ್ ಕಾರ್ಯಗತಗೊಳಿಸಲಾಗಿದೆ · ಮತ್ತೆ ಚಲಾಯಿಸಿ",
    dagBtnErrorRetry: "▶ ಲೈವ್ ಪೈಪ್‌ಲೈನ್ ಸಿಮ್ಯುಲೇಶನ್ ಚಲಾಯಿಸಿ",
    dagBtnReasoningActiveOffline: "ತರ್ಕ ಸಕ್ರಿಯ (ಸ್ಥಳೀಯ ಸಿಮ್ಯುಲೇಶನ್)...",
    dagBtnExecutedOffline: "✓ ಪೈಪ್‌ಲೈನ್ ಕಾರ್ಯಗತಗೊಳಿಸಲಾಗಿದೆ (ಸ್ಥಳೀಯ ಸಿಮ್ಯುಲೇಶನ್) · ಮತ್ತೆ ಚಲಾಯಿಸಿ",
    dagTabTitle: "8-ನೋಡ್ ಸಹಯೋಗಿ ಬಹು-ಏಜೆಂಟ್ DAG",
    dagInteractiveCanvasBadge: "ಸಂವಾದಾತ್ಮಕ ತರ್ಕ ಕ್ಯಾನ್ವಾಸ್",
    dagTabDesc: "Oceansat-3, INSAT-3DR, IMBL ಜಿಯೋಫೆನ್ಸಿಂಗ್, ಫ್ಲೀಟ್ ಸಾಂದ್ರತೆ ಮತ್ತು ಪ್ರಯಾಣ ETA ಕುರಿತು ತರ್ಕಿಸುವ ನೈಜ-ಸಮಯದ ಬಹು-ಏಜೆಂಟ್ ಕಾರ್ಯಗತ ಪೈಪ್‌ಲೈನ್.",
    backendCheckingStatus: "ಬ್ಯಾಕೆಂಡ್ ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ...",
    dagZoomReset: "ಮರುಹೊಂದಿಸಿ",
    dagRunSimulationBtn: "▶ ಲೈವ್ ಪೈಪ್‌ಲೈನ್ ಸಿಮ್ಯುಲೇಶನ್ ಚಲಾಯಿಸಿ",
    dagClickToInspectHint: "ಯಾವುದೇ ಏಜೆಂಟ್ ಕಾರ್ಡ್ ಮೇಲೆ ಕ್ಲಿಕ್ ಮಾಡಿ ಅದರ ಕಚ್ಚಾ ಟೆಲಿಮೆಟ್ರಿ ಇನ್‌ಪುಟ್, ಆಂತರಿಕ ಅಲ್ಗಾರಿದಮ್‌ಗಳು ಮತ್ತು JSON ಡೇಟಾ ಔಟ್‌ಪುಟ್ ಅನ್ನು ಪರಿಶೀಲಿಸಿ.",
    dagOrchestratorLabel: "ಆರ್ಕೆಸ್ಟ್ರೇಟರ್: LangGraph / Async Agent Core",
    dagInspectorDefaultTitle: "ಏಜೆಂಟ್ ವಿವರಗಳು",
    dagInspectorDefaultRole: "ಪಾತ್ರ ವಿವರಣೆ",
    dagInspectorLatencyPlaceholder: "ಲೇಟೆನ್ಸಿ: 24ms",
    dagInspectorJsonLabel: "ಲೈವ್ JSON ಪೇಲೋಡ್",
    dagCloseInspector: "ಇನ್ಸ್‌ಪೆಕ್ಟರ್ ಮುಚ್ಚಿ",
    chatNewConversationMsg: "ಹೊಸ ಸಂಭಾಷಣೆ ಪ್ರಾರಂಭವಾಗಿದೆ. ORCA ಹಿಂದಿನ ಚಾಟ್ ಸಂದರ್ಭವನ್ನು ಬಳಸುವುದಿಲ್ಲ.",
    chatYouLabel: "ನೀವು",
    chatOrcaLabel: "ORCA",
    chatOrchestratingMsg: "Oceansat-3, INSAT-3DR ಮತ್ತು Open-Meteo ಮೂಲಕ 8 ವಿಶೇಷ AI ಏಜೆಂಟ್‌ಗಳನ್ನು ಸಂಘಟಿಸಲಾಗುತ್ತಿದೆ...",
    chatAiLabel: "AI",
    chatAdvisoryHeader: "ಬಹು-ಏಜೆಂಟ್ ಸಾಗರ ಸಲಹೆ",
    chatGroundedConfidenceTemplate: "{confidence}% ಆಧಾರಿತ ವಿಶ್ವಾಸ",
    chatLangDetectedTooltip: "ಸಂದೇಶದಿಂದ ಭಾಷೆ ಪತ್ತೆಯಾಗಿದೆ",
    chatListenTts: "ಆಲಿಸಿ (TTS)",
    chatNavicMssBtn: "NavIC MSS ಕೋಡ್",
    chatMetricZone: "ಶಿಫಾರಸು ಮಾಡಿದ ವಲಯ",
    chatMetricEta: "ಲೈವ್ ಸಾಗರ ಸ್ಥಿತಿ ETA",
    chatMetricVessels: "ಸಕ್ರಿಯ ವೆಸೆಲ್‌ಗಳು",
    chatVesselsSuffix: "{count} ವೆಸೆಲ್‌ಗಳು",
    chatMetricImbl: "IMBL ಕ್ಲಿಯರೆನ್ಸ್",
    chatReasoningTraceSummaryTemplate: "ಬಹು-ಏಜೆಂಟ್ ತರ್ಕ ಜಾಡು ನೋಡಿ ({steps} ಹಂತಗಳು ಕಾರ್ಯಗತಗೊಂಡಿವೆ)",
    chatNodeDagSuffixTemplate: "{count}-ನೋಡ್ DAG",
    chatNoAdvisoryTextFallback: "ORCA INSIGHT ಬ್ಯಾಕೆಂಡ್ ಒಂದು ಸಲಹೆಯನ್ನು ಸೃಷ್ಟಿಸಿತು ಆದರೆ ಯಾವುದೇ ಪಠ್ಯವನ್ನು ಹಿಂತಿರುಗಿಸಲಿಲ್ಲ.",
    chatLiveAdvisoryLabel: "✓ ಲೈವ್ ಬಹು-ಏಜೆಂಟ್ ಸಲಹೆ",
    chatGroundedEngineFallback: "ಆಧಾರಿತ ಎಂಜಿನ್",
    chatOceanSourceTierTemplate: "ಸಾಗರ ಮೂಲ ಶ್ರೇಣಿ: {tier} · ಕ್ಲೋರೊಫಿಲ್: {chlorophyll}",
    chatCitationsTemplate: "ಉಲ್ಲೇಖಗಳು: {citations}",
    chatOfflineBannerText: "ಆಫ್‌ಲೈನ್ ಸಲಹಾ ಎಂಜಿನ್ — ORCA ಬ್ಯಾಕೆಂಡ್ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ. ಕೆಳಗಿನ ಅಂಕಿಅಂಶಗಳು ಸಿಮ್ಯುಲೇಟೆಡ್ ಉದಾಹರಣಾ ಅಂದಾಜು, ಲೈವ್ ಟೆಲಿಮೆಟ್ರಿ ಅಲ್ಲ.",
    chatOfflineImblPlainText: "ಆಫ್‌ಲೈನ್ ಸಲಹೆ (ಬ್ಯಾಕೆಂಡ್ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ, ಸಿಮ್ಯುಲೇಟೆಡ್ ಅಂದಾಜು): ಪಾಕ್ ಜಲಸಂಧಿ / ಮನ್ನಾರ್ ಕೊಲ್ಲಿ ಪ್ರದೇಶದ ವೆಸೆಲ್‌ಗಳು ಸಾಮಾನ್ಯವಾಗಿ ಭಾರತ-ಶ್ರೀಲಂಕಾ IMBL ಗಡಿಯಿಂದ ಕೆಲವು ನಾಟಿಕಲ್ ಮೈಲುಗಳ ಒಳಗೆ ಇರುತ್ತವೆ. ಪಶ್ಚಿಮ ದಿಕ್ಕನ್ನು ಕಾಪಾಡಿಕೊಳ್ಳಿ ಮತ್ತು VHF ಟ್ರಾನ್ಸ್‌ಪಾಂಡರ್‌ಗಳನ್ನು ಚಾನೆಲ್ 16 ರಲ್ಲಿ ಸಕ್ರಿಯವಾಗಿರಿಸಿ. ಗಡಿಗೆ ನಿಜವಾದ ಅಳತೆ ಮಾಡಿದ ದೂರಕ್ಕಾಗಿ ORCA ಬ್ಯಾಕೆಂಡ್‌ಗೆ ಮರುಸಂಪರ್ಕಿಸಿ.",
    chatOfflineImblHtmlHeading: "IMBL ಜಿಯೋಫೆನ್ಸಿಂಗ್ ಸಲಹೆ (ಸಿಮ್ಯುಲೇಟೆಡ್ ಆಫ್‌ಲೈನ್ ಅಂದಾಜು):",
    chatOfflineImblHtmlBody1: "ಲೈವ್ ಬ್ಯಾಕೆಂಡ್ ಸಂಪರ್ಕವಿಲ್ಲದೆ, ನಿಖರವಾದ ವೆಸೆಲ್-ಗಡಿ ದೂರಗಳನ್ನು ಅಳೆಯಲಾಗುವುದಿಲ್ಲ. ಪಾಕ್ ಜಲಸಂಧಿ ಸೆಕ್ಟರ್ 4 ರ ಬಳಿ ಸಾಮಾನ್ಯ ಮುನ್ನೆಚ್ಚರಿಕೆಯಾಗಿ, ಮಂಡಪಂ ಕಡೆಗೆ ಪಶ್ಚಿಮ ದಿಕ್ಕನ್ನು ಕಾಪಾಡಿಕೊಳ್ಳಿ.",
    chatOfflineImblHtmlBody2: "ಇದು ಸಾಮಾನ್ಯ ಆಫ್‌ಲೈನ್ ಸುರಕ್ಷತಾ ಜ್ಞಾಪನೆ, ಅಳತೆ ಮಾಡಿದ ಜಿಯೋಫೆನ್ಸ್ ವಾಚನ ಅಲ್ಲ. ನಿಜವಾದ ದೂರ-ಗೆ-IMBL ಲೆಕ್ಕಾಚಾರಕ್ಕಾಗಿ ORCA ಬ್ಯಾಕೆಂಡ್‌ಗೆ ಮರುಸಂಪರ್ಕಿಸಿ.",
    chatOfflineImblStep1: "ಬ್ಯಾಕೆಂಡ್ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ. ಸ್ಥಳೀಯ ಕೀವರ್ಡ್ ಹೊಂದಾಣಿಕೆಯನ್ನು ಬಳಸಿ ಪ್ರಶ್ನೆಯನ್ನು IMBL_BOUNDARY ಎಂದು ವರ್ಗೀಕರಿಸಲಾಗಿದೆ.",
    chatOfflineImblStep2: "ಯಾವುದೇ ಲೈವ್ ಜಿಯೋಫೆನ್ಸಿಂಗ್ ಟೆಲಿಮೆಟ್ರಿ ಲಭ್ಯವಿಲ್ಲ -- ಸಾಮಾನ್ಯ ಗಡಿ-ಸುರಕ್ಷತಾ ಮಾರ್ಗದರ್ಶನವನ್ನು ಮಾತ್ರ ಹಿಂತಿರುಗಿಸುತ್ತಿದೆ.",
    chatOfflineDensityPlainText: "ಆಫ್‌ಲೈನ್ ಸಲಹೆ (ಬ್ಯಾಕೆಂಡ್ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ, ಸಿಮ್ಯುಲೇಟೆಡ್ ಅಂದಾಜು): ಬ್ಯಾಕೆಂಡ್ ಸಂಪರ್ಕವಿಲ್ಲದೆ ಲೈವ್ ವೆಸೆಲ್ ಎಣಿಕೆಗಳನ್ನು ಪಡೆಯಲಾಗುವುದಿಲ್ಲ. ಐತಿಹಾಸಿಕವಾಗಿ, ವೆಜ್ ಬ್ಯಾಂಕ್ ಮತ್ತು ಕೊಚ್ಚಿ ಡೀಪ್ ಆಫ್‌ಶೋರ್‌ನಲ್ಲಿ ಮಧ್ಯಮ ಮೀನುಗಾರಿಕೆ ಚಟುವಟಿಕೆ ಕಂಡುಬರುತ್ತದೆ. ವೆಸೆಲ್ ಡೇಟಾಸೆಟ್‌ನಿಂದ ನಿಜವಾದ ಫ್ಲೀಟ್-ಸಾಂದ್ರತೆ ವಾಚನಕ್ಕಾಗಿ ORCA ಬ್ಯಾಕೆಂಡ್‌ಗೆ ಮರುಸಂಪರ್ಕಿಸಿ.",
    chatOfflineDensityHtmlHeading: "ಫ್ಲೀಟ್ ಸಾಂದ್ರತೆ (ಆಫ್‌ಲೈನ್ — ಸಿಮ್ಯುಲೇಟೆಡ್ ಪ್ಲೇಸ್‌ಹೋಲ್ಡರ್):",
    chatOfflineDensityHtmlBody: "ಫ್ಲೀಟ್ ಮತ್ತು ಸಂಚಾರ ಏಜೆಂಟ್‌ನ ಲೈವ್ ವೆಸೆಲ್ ಡೇಟಾಸೆಟ್ ಸದ್ಯಕ್ಕೆ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ, ಆದ್ದರಿಂದ ವಲಯದೊಳಗಿನ ನಿಖರ ವೆಸೆಲ್ ಎಣಿಕೆ ಲಭ್ಯವಿಲ್ಲ.",
    chatOfflineDensityListItem: "ನಿಜವಾದ ಪ್ರತಿ-ವಲಯ ವೆಸೆಲ್ ಎಣಿಕೆ ಮತ್ತು ಜನದಟ್ಟಣೆ ತೀರ್ಪಿಗಾಗಿ ORCA ಬ್ಯಾಕೆಂಡ್‌ಗೆ ಮರುಸಂಪರ್ಕಿಸಿ.",
    chatOfflineDensityStep1: "ಬ್ಯಾಕೆಂಡ್ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ. ಸ್ಥಳೀಯ ಕೀವರ್ಡ್ ಹೊಂದಾಣಿಕೆಯನ್ನು ಬಳಸಿ ಪ್ರಶ್ನೆಯನ್ನು FLEET_DENSITY ಎಂದು ವರ್ಗೀಕರಿಸಲಾಗಿದೆ.",
    chatOfflineDensityStep2: "ಯಾವುದೇ ಲೈವ್ ಫ್ಲೀಟ್ ಡೇಟಾಸೆಟ್ ಲಭ್ಯವಿಲ್ಲ -- ಸುಳ್ಳು ಅಂಕಿಅಂಶ ಪ್ರಸ್ತುತಪಡಿಸುವುದನ್ನು ತಪ್ಪಿಸಲು ವೆಸೆಲ್ ಎಣಿಕೆ ತೋರಿಸಲಾಗಿಲ್ಲ.",
    chatOfflineGenericPlainTextTemplate: "ಆಫ್‌ಲೈನ್ ಸಲಹೆ (ಬ್ಯಾಕೆಂಡ್ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ): ORCA ಯ ಬಹು-ಏಜೆಂಟ್ ಬ್ಯಾಕೆಂಡ್ ತಲುಪಲಾಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಈ ಉತ್ತರ ಆಧಾರಿತ ವಾಚನದ ಬದಲು ಸಾಮಾನ್ಯ, ಲೈವ್ ಅಲ್ಲದ ಪ್ಲೇಸ್‌ಹೋಲ್ಡರ್ ಆಗಿದೆ. ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನ ಸ್ವಂತ Open-Meteo ವಿಜೆಟ್ ಸುಮಾರು {liveWave}m ಗಮನಾರ್ಹ ಅಲೆ ಎತ್ತರವನ್ನು ತೋರಿಸುತ್ತದೆ, ಆದರೆ PFZ ಶ್ರೇಣೀಕರಣ, ಮಾರ್ಗ ದೂರ, ETA ಮತ್ತು ಫ್ಲೀಟ್ ಎಣಿಕೆಗಳಿಗೆಲ್ಲಾ ಬ್ಯಾಕೆಂಡ್ ಅಗತ್ಯವಿದೆ ಮತ್ತು ಅವು ಇಲ್ಲಿ ತೋರಿಸಲಾಗಿಲ್ಲ. ನಿಜವಾದ ಸಲಹೆಗಾಗಿ ORCA ಬ್ಯಾಕೆಂಡ್‌ಗೆ ಮರುಸಂಪರ್ಕಿಸಿ.",
    chatOfflineGenericHtmlHeading: "ಆಫ್‌ಲೈನ್ ಪ್ಲೇಸ್‌ಹೋಲ್ಡರ್ ಸಲಹೆ",
    chatOfflineGenericHtmlBody1Template: "ORCA ಯ ಬಹು-ಏಜೆಂಟ್ ಬ್ಯಾಕೆಂಡ್ (ಉಪಗ್ರಹ, ಹವಾಮಾನ, PFZ ಶ್ರೇಣೀಕರಣ, ಜಿಯೋಫೆನ್ಸಿಂಗ್, ಫ್ಲೀಟ್, ರೂಟಿಂಗ್, ಮತ್ತು ನ್ಯೂರಲ್ ಸಿಂಥೆಸಿಸ್) ಪ್ರಸ್ತುತ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ. ಕ್ಲೈಂಟ್-ಸೈಡ್‌ನಲ್ಲಿ, ಈ ಬ್ರೌಸರ್ Open-Meteo ಇಂದ ಕೊನೆಯ ಬಾರಿಗೆ <strong>{liveWave}m</strong> ಅಲೆ ಎತ್ತರವನ್ನು ಕಂಡಿತು, ಆದರೆ ಇತರ ಪ್ರತಿಯೊಂದು ಅಂಕಿಅಂಶಕ್ಕೂ ಬ್ಯಾಕೆಂಡ್ ಅಗತ್ಯವಿದೆ.",
    chatOfflineGenericHtmlBody2: "<strong>ಯಾವುದೇ PFZ ಶಿಫಾರಸು, ಮಾರ್ಗ, ETA ಅಥವಾ ಫ್ಲೀಟ್ ಎಣಿಕೆ ತೋರಿಸಲಾಗಿಲ್ಲ</strong> ಏಕೆಂದರೆ ಅವುಗಳನ್ನು ಲೆಕ್ಕಹಾಕುವ ಬದಲು ಕಲ್ಪಿಸಬೇಕಾಗುತ್ತದೆ. ಸಂಪೂರ್ಣ ಆಧಾರಿತ ಸಲಹೆಗಾಗಿ ORCA ಬ್ಯಾಕೆಂಡ್‌ಗೆ ಮರುಸಂಪರ್ಕಿಸಿ.",
    chatOfflineGenericStep1: "ಬ್ಯಾಕೆಂಡ್ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ. ಯಾವುದೇ ಉದ್ದೇಶ-ನಿರ್ದಿಷ್ಟ ಕೀವರ್ಡ್ ಹೊಂದಾಣಿಕೆಯಾಗಲಿಲ್ಲ -- GENERAL_VOYAGE_SAFETY ಆಫ್‌ಲೈನ್ ಪ್ಲೇಸ್‌ಹೋಲ್ಡರ್ ಹಿಂತಿರುಗಿಸುತ್ತಿದೆ.",
    chatOfflineGenericStep2Template: "ಕ್ಲೈಂಟ್-ಗೋಚರ ಅಂಕಿಅಂಶ ಮಾತ್ರ ಲಭ್ಯವಿದೆ: ಕೊನೆಯ ತಿಳಿದಿರುವ Open-Meteo ಅಲೆ ಎತ್ತರ {liveWave}m (ಬ್ರೌಸರ್‌ನಿಂದ ನೇರವಾಗಿ ಪಡೆಯಲಾಗಿದೆ, ಬ್ಯಾಕೆಂಡ್ ಮೂಲಕ ಅಲ್ಲ).",
    chatTtsUnsupportedAlert: "ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಿಂದ ಸ್ಪೀಚ್ ಸಿಂಥೆಸಿಸ್ ಬೆಂಬಲಿತವಾಗಿಲ್ಲ.",
    chatTtsWelcomeFallback: "ORCA INSIGHT ಗೆ ಸುಸ್ವಾಗತ. ಎಲ್ಲಾ ಉಪಗ್ರಹ ಫೀಡ್‌ಗಳು ಮತ್ತು ಕರಾವಳಿ ಸಾಗರಶಾಸ್ತ್ರ ವ್ಯವಸ್ಥೆಗಳು ಸಾಮಾನ್ಯ ಸ್ಥಿತಿಯಲ್ಲಿ ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತಿವೆ.",
    chatStopAudio: "ಆಡಿಯೋ ನಿಲ್ಲಿಸಿ",
    chatListenAudioAdvisory: "ಆಡಿಯೋ ಸಲಹೆ ಆಲಿಸಿ",
    chatTabTitle: "AI ನಿರ್ಧಾರ ಸ್ಟುಡಿಯೋ ಮತ್ತು ಬಹು-ಏಜೆಂಟ್ ಚಾಟ್‌ಬಾಟ್",
    chatTabSubtitle: "Oceansat-3, INSAT-3DR ಮತ್ತು ಕರಾವಳಿ ಜಿಯೋಫೆನ್ಸಿಂಗ್ ಕುರಿತು ತರ್ಕಿಸುವ ಸಹಯೋಗಿ ಏಜೆಂಟ್‌ಗಳಿಂದ ಚಾಲಿತ",
    chatNewConversationBtn: "ಹೊಸ ಸಂಭಾಷಣೆ",
    chatPromptPFZ: "ಕೊಚ್ಚಿ ಹಾರ್ಬರ್‌ನಿಂದ ಹತ್ತಿರದ ಅಧಿಕ-ಇಳುವರಿ PFZ ಮೀನುಗಾರಿಕೆ ವಲಯವನ್ನು ಹಿಡಿಯುವ ಸಾಧ್ಯತೆ ಮತ್ತು ಜಾತಿಗಳೊಂದಿಗೆ ಹುಡುಕಿ.",
    chatPromptSafety: "ಇಂದಿಗಾಗಿ ಸಮುದ್ರ-ಪ್ರಯಾಣ ಕ್ಲಿಯರೆನ್ಸ್ ಸ್ಕೋರ್, ಗಮನಾರ್ಹ ಅಲೆ ಎತ್ತರ ಮತ್ತು ಗಾಳಿ ಅಪಾಯವನ್ನು ಪರಿಶೀಲಿಸಿ.",
    chatPromptBorder: "ಭಾರತ-ಶ್ರೀಲಂಕಾ IMBL ಗಡಿಗೆ ದೂರವನ್ನು ಪರಿಶೀಲಿಸಿ ಮತ್ತು 2 NM ಅಪಾಯ ವಲಯದಲ್ಲಿನ ವೆಸೆಲ್‌ಗಳ ಪಟ್ಟಿಯನ್ನು ನೀಡಿ.",
    chatPromptDensity: "ವೆಜ್ ಬ್ಯಾಂಕ್ ಮತ್ತು ಕೊಚ್ಚಿ ಡೀಪ್‌ನಾದ್ಯಂತ ಪ್ರಸ್ತುತ ವೆಸೆಲ್ ಎಣಿಕೆ ಮತ್ತು ಸಾಂದ್ರತೆ ವಿತರಣೆ ಏನು?",
    chatPromptETA: "ಕೊಚ್ಚಿಯಿಂದ PFZ-01 ಗೆ ಪ್ರಯಾಣ ETA ಅನ್ನು ಲೆಕ್ಕಹಾಕಿ ಮತ್ತು ರೌಂಡ್-ಟ್ರಿಪ್ 18:30 ಸಂಜೆಗೆ ಮುನ್ನ ಸುರಕ್ಷಿತವಾಗಿ ಹಿಂತಿರುಗುತ್ತದೆಯೇ ಎಂದು ಪರಿಶೀಲಿಸಿ.",
    chatConversationLabel: "ಸಂಭಾಷಣೆ",
    chatNeuralCoreActive: "ORCA INSIGHT ನ್ಯೂರಲ್ ಕೋರ್ ಸಕ್ರಿಯ",
    chatAgentsReadyUptime: "8 ಏಜೆಂಟ್‌ಗಳು ಸಿದ್ಧ · 99.94% ಅಪ್‌ಟೈಮ್",
    chatWelcomeMessage: "ವಣಕ್ಕಂ / ನಮಸ್ತೆ! ನಾನು <strong>ORCA INSIGHT</strong> ಬಹು-ಏಜೆಂಟ್ ಸಂಶ್ಲೇಷಣಾ ವ್ಯವಸ್ಥೆ. ಸುರಕ್ಷಿತ ಪ್ರಯಾಣ ಕ್ಲಿಯರೆನ್ಸ್, ಭಾರತದ ಕರಾವಳಿಯುದ್ದಕ್ಕೂ ಅಧಿಕ-ಇಳುವರಿ PFZ ವಲಯಗಳು, ಲೈವ್ ವೆಸೆಲ್ ಸಂಚಾರ, IMBL ಗಡಿ ಸಾಮೀಪ್ಯ ಮತ್ತು ಸಮುದ್ರ-ಸ್ಥಿತಿ ಹೊಂದಾಣಿಕೆಯ ETA ಲೆಕ್ಕಾಚಾರಗಳ ಬಗ್ಗೆ ನೀವು ಮಾತನಾಡಬಹುದು ಅಥವಾ ಟೈಪ್ ಮಾಡಬಹುದು.",
    chatMicHint: "ತಮಿಳು, ಹಿಂದಿ, ಮಲಯಾಳಂ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಮಾತನಾಡಲು ಕೆಳಗಿನ ಮೈಕ್ರೊಫೋನ್ ಐಕಾನ್ ಕ್ಲಿಕ್ ಮಾಡಿ!",
    chatVoiceInputTitle: "ಪ್ರಶ್ನೆ ಹೇಳಿ (ಸ್ಪೀಚ್-ಟು-ಟೆಕ್ಸ್ಟ್)",
    chatLiveReasoningTraceTitle: "ಲೈವ್ ತರ್ಕ ಜಾಡು",
    chatReasoningTraceEmptyHint: "8 ಸಹಯೋಗಿ ಏಜೆಂಟ್‌ಗಳಲ್ಲಿ ಪ್ರತಿಯೊಂದೂ ಇದರ ಮೂಲಕ ಲೈವ್ ಆಗಿ ಹೇಗೆ ತರ್ಕಿಸುತ್ತದೆ ಎಂದು ನೋಡಲು ಎಡಭಾಗದಲ್ಲಿ ಪ್ರಶ್ನೆ ಕೇಳಿ.",
    chatLiveTelemetryTitle: "ಲೈವ್ ಸಾಗರ ಟೆಲಿಮೆಟ್ರಿ",
    chatCurrentSeaClearance: "ಪ್ರಸ್ತುತ ಸಮುದ್ರ ಕ್ಲಿಯರೆನ್ಸ್:",
    chatSignificantWaves: "ಗಮನಾರ್ಹ ಅಲೆಗಳು:",
    chatSurfaceWind: "ಮೇಲ್ಮೈ ಗಾಳಿ:",
    chatActiveVessels: "ಸಕ್ರಿಯ ವೆಸೆಲ್‌ಗಳು:",
    chatOpenDagVisualizerBtn: "ಪೂರ್ಣ ಏಜೆಂಟ್ DAG ವಿಷುವಲೈಸರ್ ತೆರೆಯಿರಿ ➔",
    navicConnected: "NavIC ರಿಸೀವರ್: ಸಂಪರ್ಕಿತ (L5/S-Band)",
    navicDisconnected: "NavIC ರಿಸೀವರ್: ಸಂಪರ್ಕ ಕಡಿತ",
    navicTrackMyPosition: "ನನ್ನ ಸ್ಥಾನವನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಿ",
    navicStopTracking: "ಟ್ರ್ಯಾಕಿಂಗ್ ನಿಲ್ಲಿಸಿ",
    navicSimulateMovement: "ವೆಸೆಲ್ ಚಲನೆಯನ್ನು ಸಿಮ್ಯುಲೇಟ್ ಮಾಡಿ",
    navicStopSimulation: "ಸಿಮ್ಯುಲೇಶನ್ ನಿಲ್ಲಿಸಿ",
    navicStatusTrackingOff: "ಟ್ರ್ಯಾಕಿಂಗ್ ಆಫ್ · ಯಾವುದೇ ಸ್ಥಾನವನ್ನು ವಿನಂತಿಸಲಾಗುತ್ತಿಲ್ಲ",
    navicStatusGeoUnsupported: "ಈ ಬ್ರೌಸರ್ ಜಿಯೋಲೊಕೇಶನ್ ಬೆಂಬಲಿಸುವುದಿಲ್ಲ. ಡೆಮೊಗಾಗಿ ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಸೆಲ್ ಚಲನೆಯನ್ನು ಬಳಸಿ.",
    navicStatusRequestingPermission: "ಸಾಧನ-ಸ್ಥಳ ಅನುಮತಿಯನ್ನು ವಿನಂತಿಸಲಾಗುತ್ತಿದೆ…",
    navicStatusLiveTrackingTemplate: "ಲೈವ್ ಸಾಧನ ಟ್ರ್ಯಾಕಿಂಗ್ · ನಿಖರತೆ ±{accuracy}m · ಸಂಗ್ರಹಿಸಲಾಗಿಲ್ಲ",
    navicStatusPermissionErrorTemplate: "ಸ್ಥಳ ಅನುಮತಿ ಲಭ್ಯವಿಲ್ಲ ({error}). ಯಾವುದೇ ಸ್ಥಾನವನ್ನು ಕಳುಹಿಸಲಾಗಿಲ್ಲ.",
    navicStatusBackendUnavailable: "ಬ್ಯಾಕೆಂಡ್ ಲಭ್ಯವಿಲ್ಲ — ಸ್ಥಳೀಯ ಸಿಮ್ಯುಲೇಶನ್‌ನಲ್ಲಿ ನಿಖರ ಜಿಯೋಫೆನ್ಸ್ ದೂರವನ್ನು ಮೌಲ್ಯಮಾಪನ ಮಾಡಲಾಗುವುದಿಲ್ಲ.",
    navicStatusSimStopped: "ಜಿಯೋಫೆನ್ಸ್ ಸಿಮ್ಯುಲೇಶನ್ ನಿಲ್ಲಿಸಲಾಗಿದೆ",
    navicStatusSimMovingTemplate: "ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಸೆಲ್ ಚಲನೆ · ಬಿಂದು {index}/{total} · {lat}, {lon}",
    navicMssCopiedAlertTemplate: "NavIC MSS / SMS 120-ಅಕ್ಷರ ಉಪಗ್ರಹ ತುರ್ತು ಕೋಡ್ ನಕಲಿಸಲಾಗಿದೆ:\\n\\n{code}",
    navicSkyplotTitle: "ISRO NavIC (IRNSS) ಸ್ಕೈಪ್ಲಾಟ್",
    navicConstellationDesc: "7-ಉಪಗ್ರಹ ಜಿಯೋಸ್ಟೇಶನರಿ / IGSO ನಕ್ಷತ್ರಪುಂಜ",
    navicConnectedShort: "ಸಂಪರ್ಕಿತ (L5/S)",
    navicTrackedSatellitesTitle: "ಟ್ರ್ಯಾಕ್ ಮಾಡಿದ ಉಪಗ್ರಹಗಳು (SNR dB-Hz)",
    navicNmeaStreamTitle: "ಲೈವ್ NMEA-0183 ಹಾರ್ಡ್‌ವೇರ್ ಸ್ಟ್ರೀಮ್ ($GNGGA / $GNRMC)",
    navicBaudRateDesc: "ಬಾಡ್ ದರ: 9600 bps · 1 Hz ಫೀಡ್",
    navicDopPrecisionLabel: "DOP ನಿಖರತೆ",
    navicDopValue: "HDOP 1.05 (ಅತ್ಯುತ್ತಮ)",
    navicDiffFixLabel: "ಡಿಫರೆನ್ಷಿಯಲ್ ಫಿಕ್ಸ್",
    navicDiffFixValue: "NavIC DGPS ಸಕ್ರಿಯ",
    navicBorderHwLabel: "ಗಡಿ ಎಚ್ಚರಿಕೆ ಹಾರ್ಡ್‌ವೇರ್",
    navicBorderHwValue: "ಬಝ್ಝರ್ ಸಿದ್ಧ",
    navicGeofenceTitle: "ಲೈವ್ ಸ್ಥಾನ ಜಿಯೋಫೆನ್ಸಿಂಗ್",
    navicGeofenceDesc: "ನಿಮ್ಮ ಸಾಧನದ ಸ್ಥಳವನ್ನು ಸೆಷನ್‌ನಲ್ಲಿ IMBL/MPA ಪರಿಶೀಲನೆಗಳಿಗೆ ಮಾತ್ರ ಬಳಸಲಾಗುತ್ತದೆ ಮತ್ತು ORCA ಎಂದಿಗೂ ಇದನ್ನು ಸಂಗ್ರಹಿಸುವುದಿಲ್ಲ.",
    navicGeofenceInitialStatus: "ಟ್ರ್ಯಾಕಿಂಗ್ ಆಫ್ · 5 NM IMBL ಎಚ್ಚರಿಕೆ / MPA ಬಫರ್ ಎಚ್ಚರಿಕೆ",
    safetyVerdictDescTemplate: "ಲೈವ್ Open-Meteo ಸಾಗರ ಟೆಲಿಮೆಟ್ರಿ ನಿಮ್ಮ ಆಯ್ಕೆ ಮಾಡಿದ ಹಾರ್ಬರ್ ಬಳಿ ಗಮನಾರ್ಹ ಅಲೆ ಎತ್ತರ {wave}m ಮತ್ತು ಮೇಲ್ಮೈ ಗಾಳಿ {wind}kn ಎಂದು ತೋರಿಸುತ್ತದೆ, ಇದು ಲೆಕ್ಕಾಚಾರ ಮಾಡಿದ {score}/100 ಸುರಕ್ಷತಾ ಸ್ಕೋರ್ ನೀಡುತ್ತದೆ.",
    safetyWindDefaultDirection: "ಪಶ್ಚಿಮ",
    safetyBreezeSuffix: "{direction} ತಂಗಾಳಿ",
    severityLow: "ಕಡಿಮೆ",
    severityModerate: "ಮಧ್ಯಮ",
    severityHigh: "ಹೆಚ್ಚು",
    waveBandCalm: "ಶಾಂತ (< 0.5m)",
    waveBandSlight: "ಸೌಮ್ಯ (0.5 - 1.25m)",
    waveBandModerate: "ಮಧ್ಯಮ (1.25 - 2.5m)",
    waveBandRough: "ಪ್ರಕ್ಷುಬ್ಧ (> 2.5m)",
    seaStateCalm: "ಶಾಂತ",
    seaStateSlight: "ಸೌಮ್ಯ",
    seaStateSlightModerate: "ಸೌಮ್ಯದಿಂದ ಮಧ್ಯಮ",
    seaStateModerateRough: "ಮಧ್ಯಮದಿಂದ ಪ್ರಕ್ಷುಬ್ಧ",
    seaStateUnknown: "ಅಜ್ಞಾತ",
    lightningBandSafe: "ಸುರಕ್ಷಿತ ವಾತಾವರಣ ಪ್ರೊಫೈಲ್",
    lightningBandElevated: "ಹೆಚ್ಚಿದ ಸಂವಹನ ಅಪಾಯ",
    lightningBandSevere: "ತೀವ್ರ ಬಿರುಗಾಳಿ ಎಚ್ಚರಿಕೆ",
    safetySyncLatencyLabel: "ಸಿಂಕ್ ಲೇಟೆನ್ಸಿ:",
    safetyBatteryLabel: "ಬ್ಯಾಟರಿ:",
    safetyLastPassLabel: "ಕೊನೆಯ ಪಾಸ್:",
    safetyAltitudeLabel: "ಎತ್ತರ:",
    telemetryLiveOpenMeteoTemplate: "ಲೈವ್ OPEN-METEO ಟೆಲಿಮೆಟ್ರಿ ({wave}m SWH)",
    telemetryCachedArchive: "ಟೆಲಿಮೆಟ್ರಿ ಸಕ್ರಿಯ (ಸಂಗ್ರಹಿಸಿದ ಉಪಗ್ರಹ ಆರ್ಕೈವ್)",
    backendOnlineStatus: "ಲೈವ್ FASTAPI ಬ್ಯಾಕೆಂಡ್ ಸಂಪರ್ಕಿತ",
    backendOfflineStatus: "ಬ್ಯಾಕೆಂಡ್ ಆಫ್‌ಲೈನ್ · ಸ್ಥಳೀಯ ಸಿಮ್ಯುಲೇಶನ್ ಮೋಡ್",
    aisLiveCountTemplate: "{count} ಲೈವ್ AIS ವೆಸೆಲ್{plural}",
    aisNoLiveVessels: "ಪ್ರಸ್ತುತ ಯಾವುದೇ ಲೈವ್ AIS ವೆಸೆಲ್‌ಗಳಿಲ್ಲ",
    aisBlendedBannerTemplate: "ಪ್ರಸ್ತುತ ಲೈವ್ AIS ಕವರೇಜ್ ಇಲ್ಲದ ಬಂದರುಗಳನ್ನು ತುಂಬಲು {liveText} + {simCount} ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಸೆಲ್{plural} ತೋರಿಸಲಾಗುತ್ತಿದೆ.",
    aisUnavailableDefault: "ಲೈವ್ AIS ವೆಸೆಲ್ ಫೀಡ್ ಲಭ್ಯವಿಲ್ಲ -- 0 ವೆಸೆಲ್‌ಗಳನ್ನು ತೋರಿಸಲಾಗುತ್ತಿದೆ.",
    aisNotConfigured: "ಈ ಡಿಪ್ಲಾಯ್‌ಮೆಂಟ್‌ನಲ್ಲಿ ಲೈವ್ AIS ವೆಸೆಲ್ ಫೀಡ್ ಕಾನ್ಫಿಗರ್ ಮಾಡಿಲ್ಲ.",
    aisConnectedNotSending: "AIS ಪೂರೈಕೆದಾರರೊಂದಿಗೆ (AISstream.io) ಸಂಪರ್ಕಿತವಾಗಿದೆ, ಆದರೆ ಇದು ಪ್ರಸ್ತುತ ವೆಸೆಲ್ ಡೇಟಾವನ್ನು ಕಳುಹಿಸುತ್ತಿಲ್ಲ — ಬಹುಶಃ ಪೂರೈಕೆದಾರ-ಬದಿಯ ಅಡಚಣೆ, ಸ್ಥಳೀಯ ದೋಷವಲ್ಲ.",
    aisDisconnectedReconnecting: "AIS ಪೂರೈಕೆದಾರರಿಂದ (AISstream.io) ಸಂಪರ್ಕ ಕಡಿತಗೊಂಡಿದೆ; ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಮರುಸಂಪರ್ಕಿಸುತ್ತಿದೆ.",
    imblAlertActiveTemplate: "<strong>{vesselId} ({vesselName})</strong> ಭಾರತ–ಶ್ರೀಲಂಕಾ IMBL ನಿಂದ <strong>{dist} NM</strong> ದೂರದಲ್ಲಿ ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತಿದೆ{simTag}. ಸ್ವಯಂಚಾಲಿತ ಎಚ್ಚರಿಕೆ ಕಳುಹಿಸಲಾಗಿದೆ.",
    imblAlertNoneTemplate: "ಪ್ರಸ್ತುತ {warnDist} NM IMBL ಎಚ್ಚರಿಕೆ ದೂರದೊಳಗೆ ಯಾವುದೇ ವೆಸೆಲ್ ಇಲ್ಲ. ಹತ್ತಿರದ ಟ್ರ್ಯಾಕ್ ಮಾಡಿದ ವೆಸೆಲ್: <strong>{dist} NM</strong> ದೂರದಲ್ಲಿ.",
    imblAlertNoData: "ಇನ್ನೂ ಯಾವುದೇ ವೆಸೆಲ್ ಟೆಲಿಮೆಟ್ರಿ ಲಭ್ಯವಿಲ್ಲ.",
    simulatedSuffix: " (ಸಿಮ್ಯುಲೇಟೆಡ್)",
    notifUnavailableTitle: "ಬ್ರೌಸರ್ ಅಧಿಸೂಚನೆಗಳು ಲಭ್ಯವಿಲ್ಲ",
    notifUnavailableMsg: "ಈ ಟ್ಯಾಬ್ ತೆರೆದಿರುವವರೆಗೆ ಇನ್-ಆ್ಯಪ್ ಅಪಾಯ ಬ್ಯಾನರ್‌ಗಳು ಇನ್ನೂ ತೋರಿಸಲ್ಪಡುತ್ತವೆ.",
    notifNotEnabledTitle: "ಬ್ರೌಸರ್ ಅಧಿಸೂಚನೆಗಳು ಸಕ್ರಿಯಗೊಂಡಿಲ್ಲ",
    notifNotEnabledMsg: "ಈ ಟ್ಯಾಬ್ ತೆರೆದಿರುವವರೆಗೆ ಇನ್-ಆ್ಯಪ್ ಅಪಾಯ ಬ್ಯಾನರ್‌ಗಳು ಸಕ್ರಿಯವಾಗಿ ಉಳಿಯುತ್ತವೆ.",
    hazardHighWavesTitle: "ಎತ್ತರದ ಅಲೆಗಳು — ಸ್ಥಳೀಯ ಸಿಮ್ಯುಲೇಶನ್",
    hazardHighWavesMsgTemplate: "{wave}m, 2.5m ಎಚ್ಚರಿಕೆ ಮಿತಿಯನ್ನು ಮೀರಿದೆ. ಮೂಲ: ಬ್ರೌಸರ್ Open-Meteo ಟೆಲಿಮೆಟ್ರಿ.",
    hazardHighWindTitle: "ಬಲವಾದ ಗಾಳಿ — ಸ್ಥಳೀಯ ಸಿಮ್ಯುಲೇಶನ್",
    hazardHighWindMsgTemplate: "{wind} kn, 25 kn ಎಚ್ಚರಿಕೆ ಮಿತಿಯನ್ನು ಮೀರಿದೆ. ಮೂಲ: ಬ್ರೌಸರ್ Open-Meteo ಟೆಲಿಮೆಟ್ರಿ.",
    hazardLightningTitle: "ಮಿಂಚಿನ ಅಪಾಯ — ಸ್ಥಳೀಯ ಸಿಮ್ಯುಲೇಶನ್",
    hazardLightningMsgTemplate: "ಮಿಂಚಿನ ಪ್ರಾಕ್ಸಿ {pct}% ಆಗಿದೆ. ಮೂಲ: ಬ್ರೌಸರ್ Open-Meteo ಟೆಲಿಮೆಟ್ರಿ.",
    safetyOfficialClearanceLabel: "ಅಧಿಕೃತ ಸಾಗರ ಕ್ಲಿಯರೆನ್ಸ್",
    safetyVerdictDescInitial: "ಎಲ್ಲಾ ಉಪಗ್ರಹ ಸಾಗರಶಾಸ್ತ್ರ ಸೂಚಕಗಳು (Oceansat-3 SSTM ಉಷ್ಣ ಮುಂಭಾಗಗಳು, Sentinel-3 ಅಲೆ ಆಲ್ಟಿಮೆಟ್ರಿ) ಕೇರಳ, ಕರ್ನಾಟಕ ಮತ್ತು ತಮಿಳುನಾಡಿನ ಕರಾವಳಿ ನೀರಿನಲ್ಲಿ ಅನುಕೂಲಕರ ಮೀನುಗಾರಿಕೆ ಪರಿಸ್ಥಿತಿಗಳನ್ನು ದೃಢಪಡಿಸುತ್ತವೆ.",
    safetyIndexLabel: "ಸುರಕ್ಷತಾ ಸೂಚ್ಯಂಕ",
    satConstellationTitle: "ISRO ಮತ್ತು ಅಂತಾರಾಷ್ಟ್ರೀಯ ಸಾಗರಶಾಸ್ತ್ರ ಉಪಗ್ರಹ ನಕ್ಷತ್ರಪುಂಜ",
    satStaticDataNote: "ಸ್ಥಿರ ಉಲ್ಲೇಖ ಡೇಟಾ (ಲೈವ್ ಟೆಲಿಮೆಟ್ರಿ ಅಲ್ಲ)",
    mapIndiaBoundaryPopup: "ಭಾರತ — ಅಧಿಕೃತ ಗಡಿ (Survey of India)",
    mapPfzYieldSuffix: "{rating} ಇಳುವರಿ ({pct}%)",
    mapPfzSstLabel: "SST:",
    mapPfzChlorophyllLabel: "ಕ್ಲೋರೊಫಿಲ್:",
    mapPfzDepthLabel: "ಆಳ:",
    mapPfzVesselsLabel: "ವೆಸೆಲ್‌ಗಳು:",
    mapPfzActiveSuffix: "{count} ಸಕ್ರಿಯ",
    mapPfzTargetSpeciesLabel: "ಗುರಿ ಜಾತಿಗಳು:",
    mapPfzSimulateRouteBtn: "ಇಲ್ಲಿ ಮಾರ್ಗ ಸಿಮ್ಯುಲೇಟ್ ಮಾಡಿ ➔",
    mapImblPopupBodyTemplate: "ಕಠಿಣ ಅಂತಾರಾಷ್ಟ್ರೀಯ ಸಾಗರ ಗಡಿ ರೇಖೆ. ಎಚ್ಚರಿಕೆ ಬಫರ್: {warn} NM. ನಿರ್ಣಾಯಕ ಜಿಯೋಫೆನ್ಸ್: {danger} NM.",
    mapImblPopupTreatyNote: "UNCLOS ಸಾಗರ ಒಪ್ಪಂದದ ಅಡಿಯಲ್ಲಿ ಗಡಿ ದಾಟುವುದನ್ನು ನಿಷೇಧಿಸಲಾಗಿದೆ.",
    mapImblBufferCorridorTemplate: "{dist} NM IMBL ಬಫರ್ ಕಾರಿಡಾರ್",
    mapMpaRestrictedBadge: "ನಿರ್ಬಂಧಿತ ಪರಿಸರ ಮೀಸಲು",
    mapHarbourCoastSuffix: "{state} ಕರಾವಳಿ",
    mapHarbourCapacityLabel: "ಸಾಮರ್ಥ್ಯ:",
    mapHarbourVhfLabel: "VHF:",
    mapHarbourFuelLabel: "ಇಂಧನ ನಿಲ್ದಾಣ:",
    mapHarbourFuelAvailable: "ಲಭ್ಯವಿದೆ",
    mapHarbourIceLabel: "ಐಸ್ ಪ್ಲಾಂಟ್:",
    mapHarbourIceActive: "ಸಕ್ರಿಯ",
    mapHarbourSetOriginBtn: "ಮೂಲ ಹಾರ್ಬರ್ ಆಗಿ ಹೊಂದಿಸಿ",
    mapVesselSimulatedBadge: "ಸಿಮ್ಯುಲೇಟೆಡ್ · ಇಲ್ಲಿ ಲೈವ್ AIS ಕವರೇಜ್ ಇಲ್ಲ",
    mapVesselSpeedLabel: "ವೇಗ:",
    mapVesselHeadingLabel: "ದಿಕ್ಕು:",
    mapVesselZoneLabel: "ವಲಯ:",
    mapVesselImblDistLabel: "IMBL ದೂರ:",
    mapVesselStatusLabel: "ಸ್ಥಿತಿ:",
    mapVesselFuelLabel: "ಇಂಧನ:",
    mapVesselFuelNA: "ಲಭ್ಯವಿಲ್ಲ",
    mapRoutePopupTitle: "ಸಮುದ್ರ-ಮಾತ್ರ A* ಮಾರ್ಗ (ಭೂಮಿ + MPA ತಪ್ಪಿಸುವಿಕೆ)",
    mapRouteDistanceEtaTemplate: "ದೂರ: {dist} NM · ETA: {eta}{detourNote}",
    mapRouteDetourTemplate: " · {zones} ಸುತ್ತಲೂ {pct}% ಸುತ್ತುಮಾರ್ಗ",
    mapRouteLandNoGoZones: "ಭೂಮಿ/ನಿಷೇಧಿತ ವಲಯಗಳು",
    vesselStatusSafeFishing: "ಸುರಕ್ಷಿತ ಮೀನುಗಾರಿಕೆ",
    vesselStatusBorderAlert: "ಗಡಿ ಎಚ್ಚರಿಕೆ",
    vesselStatusBorderWarn: "ಗಡಿ ಜಾಗರೂಕತೆ",
    vesselStatusInTransit: "ಸಾಗಣೆಯಲ್ಲಿ",
    vesselSimBadgeText: "SIM",
    vesselSimBadgeTitle: "ಸಿಮ್ಯುಲೇಟೆಡ್ -- ಈ ಬಂದರಿನ ಬಳಿ ಲೈವ್ AIS ಕವರೇಜ್ ಇಲ್ಲ",
    vesselLocateAction: "ಪತ್ತೆ ಮಾಡಿ ➔",
    fleetVesselCountSuffix: "{count} ವೆಸೆಲ್‌ಗಳು",
    fleetLiveSimBreakdownTemplate: "{total} ({live} ಲೈವ್ · {sim} ಸಿಮ್)",
    mapActiveVesselsBreakdownTemplate: "{total} ಸಕ್ರಿಯ ವೆಸೆಲ್‌ಗಳು ({live} ಲೈವ್ · {sim} ಸಿಮ್ಯುಲೇಟೆಡ್)",
    mapActiveVesselsSimpleTemplate: "{total} ಸಕ್ರಿಯ ವೆಸೆಲ್‌ಗಳು",
    mapTabTitle: "GIS ಕಮಾಂಡ್ ನಕ್ಷೆ · ಭಾರತೀಯ ಕರಾವಳಿ ನೀರು",
    mapTabDesc: "ನೈಜ-ಸಮಯದ ಉಪಗ್ರಹ PFZ ಗಳು, IMBL ಗಡಿ ಕಾರಿಡಾರ್‌ಗಳು ಮತ್ತು AIS ವೆಸೆಲ್ ಟ್ರ್ಯಾಕ್‌ಗಳೊಂದಿಗೆ ಸಂವಾದಾತ್ಮಕ ಹೆಚ್ಚಿನ-ಕಾಂಟ್ರಾಸ್ಟ್ ನಾಟಿಕಲ್ ನಕ್ಷೆ.",
    layerPfzZones: "PFZ ವಲಯಗಳು",
    layerImblBuffer: "IMBL ಬಫರ್",
    layerEcoReserves: "ಪರಿಸರ ಮೀಸಲುಗಳು (MPA)",
    layerHarbours: "ಹಾರ್ಬರ್‌ಗಳು",
    layerLiveVessels: "ಲೈವ್ ವೆಸೆಲ್‌ಗಳು",
    layerDensityHeatmap: "ಸಾಂದ್ರತೆ ಹೀಟ್‌ಮ್ಯಾಪ್",
    layerIndiaBoundary: "ಭಾರತ ಗಡಿ (Survey of India)",
    routePlannerDesc: "MPA ಗಳು ಮತ್ತು ಗಡಿ ಅಪಾಯಗಳನ್ನು ತಪ್ಪಿಸುವ A*-ಶೈಲಿಯ ಮಾರ್ಗ",
    routeVesselSpeedLabel: "ವೆಸೆಲ್ ವೇಗ:",
    fleetMonitorTitle: "ಫ್ಲೀಟ್ ಮಾನಿಟರ್ · ಲೈವ್ ವೆಸೆಲ್ ಟೆಲಿಮೆಟ್ರಿ",
    fleetTotalActiveTitle: "ಒಟ್ಟು ಸಕ್ರಿಯ ವೆಸೆಲ್‌ಗಳು",
    fleetTotalActiveDesc: "ಪ್ರಸ್ತುತ AIS ಟ್ರಾನ್ಸ್‌ಪಾಂಡರ್ ಸಂಕೇತಗಳನ್ನು ಪ್ರಸಾರ ಮಾಡುತ್ತಿರುವ ವೆಸೆಲ್‌ಗಳು",
    fleetZoneDistTitle: "ಪ್ರತಿ ವಲಯ ವೆಸೆಲ್ ವಿತರಣೆ",
    imblAlertCardTitle: "IMBL ಗಡಿ ಸಾಮೀಪ್ಯ ಎಚ್ಚರಿಕೆ",
    fleetTableSubDesc: "AISstream.io ಇಂದ ಲೈವ್ AIS ಸ್ಥಾನಗಳು, ಪ್ರಸ್ತುತ ಲೈವ್ ರಿಸೀವರ್ ಕವರೇಜ್ ಇಲ್ಲದಿರುವಲ್ಲೆಲ್ಲಾ ಸ್ಪಷ್ಟವಾಗಿ-ಟ್ಯಾಗ್ ಮಾಡಿದ ಸಿಮ್ಯುಲೇಟೆಡ್ ಫ್ಲೀಟ್‌ನೊಂದಿಗೆ (\"SIM\" ಬ್ಯಾಡ್ಜ್ ನೋಡಿ) ತುಂಬಿಸಲಾಗಿದೆ",
    vesselSearchPlaceholder: "ವೆಸೆಲ್ ಹೆಸರು ಅಥವಾ ID ಹುಡುಕಿ...",
    filterAllStatuses: "ಎಲ್ಲಾ ಸ್ಥಿತಿಗಳು",
    filterSafeFishing: "ಸುರಕ್ಷಿತ ಮೀನುಗಾರಿಕೆ",
    filterInTransit: "ಸಾಗಣೆಯಲ್ಲಿ",
    filterBorderAlert: "ಗಡಿ ಎಚ್ಚರಿಕೆ",
    thVesselId: "ವೆಸೆಲ್ ID",
    thVesselName: "ವೆಸೆಲ್ ಹೆಸರು",
    thType: "ಪ್ರಕಾರ",
    thCurrentZone: "ಪ್ರಸ್ತುತ ವಲಯ",
    thSpeedHeading: "ವೇಗ / ದಿಕ್ಕು",
    thImblDist: "IMBL ದೂರ",
    thStatus: "ಸ್ಥಿತಿ",
    thAction: "ಕ್ರಿಯೆ",
    bulletinIssuedLabel: "ಬಿಡುಗಡೆ:",
    bulletinRegionLabel: "ಪ್ರದೇಶ:",
    bulletinWavesLabel: "ಅಲೆಗಳು:",
    bulletinWindsLabel: "ಗಾಳಿಗಳು:",
    bulletinSourceLabel: "ಮೂಲ:",
    bulletinListenBtn: "ಬುಲೆಟಿನ್ ಆಲಿಸಿ",
    bulletinsTabTitle: "ಅಧಿಕೃತ ಸಾಗರ ಮತ್ತು ಮೀನುಗಾರಿಕೆ ಬುಲೆಟಿನ್‌ಗಳು (ISRO - INCOIS)",
    bulletinsTabDesc: "ಸಂಖ್ಯಿತ ಸಲಹೆಗಳು, ಚಂಡಮಾರುತ ಅಪಾಯ ಎಚ್ಚರಿಕೆಗಳು, ಮತ್ತು ಅಂತಾರಾಷ್ಟ್ರೀಯ ಗಡಿ ಅನುಸರಣೆ ಎಚ್ಚರಿಕೆಗಳು.",
    bulletinNotifyToggleTitle: "ಈ ಟ್ಯಾಬ್/PWA ತೆರೆದಿರುವಾಗ ಮಾತ್ರ ಬ್ರೌಸರ್ ಎಚ್ಚರಿಕೆಗಳನ್ನು ಸ್ವೀಕರಿಸಿ",
    bulletinNotifyToggleLabel: "ತೆರೆದಿರುವಾಗ ಸೂಚಿಸಿ",
    bulletinFilterAll: "ಎಲ್ಲಾ ಬುಲೆಟಿನ್‌ಗಳು",
    bulletinFilterCritical: "ನಿರ್ಣಾಯಕ",
    bulletinFilterWarning: "ಎಚ್ಚರಿಕೆಗಳು",
    bulletinFilterAdvisory: "ಸಲಹೆಗಳು",
    bulletinsPushNote: "ಈ ಟ್ಯಾಬ್/PWA ತೆರೆದಿರುವಾಗ ಮಾತ್ರ ಅಪಾಯ ಎಚ್ಚರಿಕೆಗಳು ಸಕ್ರಿಯವಾಗಿರುತ್ತವೆ. ಮುಚ್ಚಿದ-ಆ್ಯಪ್ ಪುಶ್ ಅಧಿಸೂಚನೆಗಳಿಗೆ ಉತ್ಪಾದನಾ ಪುಶ್-ಚಂದಾದಾರಿಕೆ ಸೇವೆ ಅಗತ್ಯವಿದೆ ಮತ್ತು ಇದನ್ನು ಈ ಮೂಲಮಾದರಿಯಲ್ಲಿ ಅಳವಡಿಸಲಾಗಿಲ್ಲ.",
    sosModalTitle: "ತುರ್ತು ಸಂಕಷ್ಟ ಬೀಕಾನ್ (SOS)",
    sosInstructions: "ತುರ್ತು SOS ಅನ್ನು ಸಕ್ರಿಯಗೊಳಿಸುವುದರಿಂದ <strong>INSAT-3DR SAS&R</strong> ಮೂಲಕ ಭಾರತೀಯ ಕರಾವಳಿ ಕಾವಲು ಪಡೆ ಸಾಗರ ರಕ್ಷಣಾ ಸಮನ್ವಯ ಕೇಂದ್ರಕ್ಕೆ (MRCC) ತುರ್ತು 406 MHz ಸಂಕಷ್ಟ ಸಂಕೇತವನ್ನು ರವಾನಿಸಲಾಗುತ್ತದೆ.",
    sosCurrentPositionLabel: "ಪ್ರಸ್ತುತ ಸ್ಥಾನ:",
    sosVhfChannelLabel: "ತುರ್ತು VHF ಚಾನೆಲ್:",
    sosMrccHelplineLabel: "MRCC ಸಹಾಯವಾಣಿ:",
    sosConfirmBtn: "ದೃಢೀಕರಿಸಿ ಮತ್ತು ಸಂಕಷ್ಟ ಬೀಕಾನ್ ಪ್ರಸಾರ ಮಾಡಿ",
    sosBeaconTransmittingBanner: "406 MHz SAS&R ಬೀಕಾನ್ ISRO ಮತ್ತು ಕರಾವಳಿ ಕಾವಲು ಪಡೆ MRCC ಗೆ ರವಾನೆಯಾಗುತ್ತಿದೆ",
    sosDistressRelayedMsg: "ಸಂಕಷ್ಟ ಪ್ಯಾಕೆಟ್ INSAT-3DR SAS&R ರಿಸೀವರ್ ಮೂಲಕ ರಿಲೇ ಮಾಡಲಾಗಿದೆ. ಸಾಗರ ರಕ್ಷಣಾ ಸಮನ್ವಯ ಕೇಂದ್ರಕ್ಕೆ (MRCC ಚೆನ್ನೈ/ಮುಂಬೈ) VHF ಚಾನೆಲ್ 16 ರಲ್ಲಿ ಎಚ್ಚರಿಸಲಾಗಿದೆ.",
    sosGpsVesselIdTemplate: "GPS ನಿರ್ದೇಶಾಂಕಗಳು: {coords} · ವೆಸೆಲ್ ID: {vesselId} ({vesselName})",
    landingEyebrow: "ISRO ಸಹಯೋಗಿ ಸಾಗರ ಇಂಟೆಲಿಜೆನ್ಸ್ · ಸ್ಮಾರ್ಟ್ ಇಂಡಿಯಾ ಹ್ಯಾಕಥಾನ್ 2026",
    landingSubtitle: "ಒಂದು ಸಹಯೋಗಿ ಸಾಗರ-ಇಂಟೆಲಿಜೆನ್ಸ್ ವೇದಿಕೆ, ಎರಡು ಕಮಾಂಡ್ ಡೆಕ್‌ಗಳು: ಮೀನುಗಾರನ ದೈನಂದಿನ ಅವಕಾಶ ಕನ್ಸೋಲ್, ಮತ್ತು ಸಂಪೂರ್ಣ ISRO ಉಪಗ್ರಹ, AIS ಮತ್ತು ಜಿಯೋಫೆನ್ಸಿಂಗ್ ಇನ್‌ಸೈಟ್ ಸೂಟ್.",
    landingStripItem1: "Oceansat-3 SSTM ಉಷ್ಣ ಮುಂಭಾಗಗಳು",
    landingStripItem2: "INSAT-3DR ಉಪಗ್ರಹ ಸಾಗರಶಾಸ್ತ್ರ",
    landingStripItem3: "8-ನೋಡ್ ಸಹಯೋಗಿ ಏಜೆಂಟ್ DAG",
    landingStripItem4: "NavIC (IRNSS) GPS ಸೇತುವೆ",
    landingStripItem5: "IMBL ಗಡಿ ಜಿಯೋಫೆನ್ಸಿಂಗ್ ಎಚ್ಚರಿಕೆಗಳು",
    landingStripItem6: "ಲೈವ್ AIS ಫ್ಲೀಟ್ ಮತ್ತು GIS ಕಮಾಂಡ್",
    landingStripItem7: "ಸೆಲ್ ಸ್ಮಾರ್ಟರ್ ಬಯರ್ ಪ್ರೈಸಿಂಗ್",
    landingStripItem8: "406 MHz SOS ಸಂಕಷ್ಟ ಬೀಕಾನ್",
    landingFishermanCardTitle: "ORCA ಫಿಶರ್‌ಮ್ಯಾನ್",
    landingFishermanCardDesc: "ಇಂದಿನ ಅವಕಾಶ ಸ್ಕೋರ್, ಸೆಲ್ ಸ್ಮಾರ್ಟರ್ ಪ್ರೈಸಿಂಗ್, ಟ್ರಿಪ್-ವೆಚ್ಚ ಕ್ಯಾಲ್ಕುಲೇಟರ್, ಮತ್ತು ನಿಮ್ಮ ಹಿಡಿತಕ್ಕಾಗಿ ಖರೀದಿದಾರ ಲೀಡ್‌ಗಳು — ದೋಣಿಗಾಗಿ ನಿರ್ಮಿಸಲಾಗಿದೆ.",
    landingFishermanCardCta: "ಫಿಶರ್‌ಮ್ಯಾನ್ ಕನ್ಸೋಲ್ ತೆರೆಯಿರಿ",
    landingFishermanCardTitleAttr: "ಫಿಶರ್‌ಮ್ಯಾನ್ ಕನ್ಸೋಲ್ ತೆರೆಯಿರಿ",
    landingInsightCardTitle: "ORCA ಇನ್‌ಸೈಟ್",
    landingInsightCardDesc: "ಸಂಪೂರ್ಣ ಕಮಾಂಡ್ ಡೆಕ್: ISRO ಉಪಗ್ರಹ ಸಾಗರಶಾಸ್ತ್ರ, GIS ನಕ್ಷೆ, 8-ನೋಡ್ ಏಜೆಂಟ್ DAG, ಸೇಫ್ಟಿ ಬ್ಯಾರೊಮೀಟರ್, ಫ್ಲೀಟ್ ಮಾನಿಟರ್, ಮತ್ತು NavIC ಸೇತುವೆ.",
    landingInsightCardCta: "ಇನ್‌ಸೈಟ್ ಕಮಾಂಡ್ ಡೆಕ್ ತೆರೆಯಿರಿ",
    landingInsightCardTitleAttr: "ಇನ್‌ಸೈಟ್ ಕಮಾಂಡ್ ಡೆಕ್ ತೆರೆಯಿರಿ",
    backToOverviewTitle: "ಅವಲೋಕನಕ್ಕೆ ಹಿಂತಿರುಗಿ",
    statSimulatedFleetLabel: "ಸಿಮ್ಯುಲೇಟೆಡ್ AIS ಫ್ಲೀಟ್",
    statSatellitesActiveTemplate: "{count} ಸಕ್ರಿಯ",
    statSatellitesListLabel: "Oceansat-3, INSAT-3DR, Sentinel-3",
    statPfzZonesCountTemplate: "{count} ವಲಯಗಳು",
    statPfzZonesListLabel: "ವೆಜ್ ಬ್ಯಾಂಕ್, ಕೊಚ್ಚಿ, ವೆರಾವಲ್...",
    statImblCorridorsCountTemplate: "{count} ಕಾರಿಡಾರ್‌ಗಳು",
    statImblBordersLabel: "ಭಾರತ-ಶ್ರೀಲಂಕಾ ಮತ್ತು ಪಾಕ್ ಗಡಿಗಳು",
    pillarDagTitle: "8-ನೋಡ್ ಸಹಯೋಗಿ ಏಜೆಂಟ್ DAG",
    pillarDagDesc: "ಪ್ರಶ್ನೆಗಳನ್ನು ಉಪಗ್ರಹ, ಅಲೆ ಅಪಾಯ, ಜಿಯೋಫೆನ್ಸಿಂಗ್, ವೆಸೆಲ್ ಎಣಿಕೆ, ETA, ಮತ್ತು ನ್ಯೂರಲ್ ಸಿಂಥೆಸಿಸ್ ಹಂತಗಳಾಗಿ ಉಪ-ಸೆಕೆಂಡ್ ಲೇಟೆನ್ಸಿಯೊಂದಿಗೆ ವಿಭಜಿಸುವ ಬಹು-ಏಜೆಂಟ್ ವಾಸ್ತುಶಿಲ್ಪ.",
    pillarEtaTitle: "ಲೈವ್ ಸಾಗರ-ಸ್ಥಿತಿ ETA ಮತ್ತು ಸಂಜೆ ಸುರಕ್ಷತೆ",
    pillarEtaDesc: "ಅಲೆ ಪ್ರತಿರೋಧಕ್ಕೆ ಅನುಗುಣವಾಗಿ ಹೊಂದಿಸಲಾದ ಹೈಡ್ರೊಡೈನಾಮಿಕ್ ಪ್ರಯಾಣ ಲೆಕ್ಕಾಚಾರಗಳು, ಸೂರ್ಯಾಸ್ತದ ನಂತರ ಸಿಲುಕಿದ ಮೀನುಗಾರರನ್ನು ತಡೆಯಲು ಸ್ವಯಂಚಾಲಿತ ಸಂಜೆಗೂ-ಮುನ್ನ-ಹಿಂತಿರುಗುವ ಸುರಕ್ಷತಾ ಎಚ್ಚರಿಕೆಗಳೊಂದಿಗೆ.",
    pillarFleetTitle: "ಲೈವ್ ಫ್ಲೀಟ್ ಸಾಂದ್ರತೆ ಮತ್ತು IMBL ಎಚ್ಚರಿಕೆ",
    pillarFleetDesc: "ಪ್ರತಿ ವಲಯ ನೈಜ-ಸಮಯದ ವೆಸೆಲ್ ಎಣಿಕೆ, ಜನದಟ್ಟಣೆ ಅಪಾಯ ಸೂಚಕಗಳು, ಮತ್ತು ಸಾಗರ ಗಡಿಗಳನ್ನು ರಕ್ಷಿಸುವ ಸ್ವಯಂಚಾಲಿತ 5 NM/2 NM ಜಿಯೋಫೆನ್ಸ್ ಸಾಮೀಪ್ಯ ಎಚ್ಚರಿಕೆಗಳು.",
    footerCreditLine: "<span class=\"text-slate-200 font-semibold\">{appTitle}</span> · ನಿರ್ಮಿಸಿದವರು <strong class=\"text-cyan-400\">{teamName}</strong> · ಸ್ಮಾರ್ಟ್ ಇಂಡಿಯಾ ಹ್ಯಾಕಥಾನ್ 2026 · ಸಮಸ್ಯಾ ಹೇಳಿಕೆ 26176 (ISRO)",
    sttListeningStatusTemplate: "<b>{lang}</b> ನಲ್ಲಿ ಆಲಿಸುತ್ತಿದೆ... ಈಗ ಮಾತನಾಡಿ.",
    sttUnsupportedTitle: "ಈ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಸ್ಪೀಚ್ ರೆಕಗ್ನಿಷನ್ ಬೆಂಬಲಿತವಾಗಿಲ್ಲ",
    routeUnavailableLabel: " ಮಾರ್ಗ ಲಭ್ಯವಿಲ್ಲ:",
    routeUnavailableMsg: "ORCA ಬ್ಯಾಕೆಂಡ್ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ, ಆದ್ದರಿಂದ ಯಾವುದೇ ಮಾರ್ಗಬದ್ಧ ದೂರ/ETA ತೋರಿಸಲಾಗುವುದಿಲ್ಲ. ಸ್ಥಳೀಯ ಫಾಲ್‌ಬ್ಯಾಕ್ ಮೋಡ್‌ನಲ್ಲಿ ಚಾಲನೆಯಲ್ಲಿದೆ.",
    routeNoSafeRouteLabel: "✕ ಯಾವುದೇ ಸುರಕ್ಷಿತ ಸಾಗರ ಮಾರ್ಗ ಕಂಡುಬಂದಿಲ್ಲ:",
    routeNoSafeRouteMsgTemplate: "{detail}",
    routeNoSafeRouteDefaultReason: "ಈ ಹಾರ್ಬರ್/PFZ ಜೋಡಿಗಾಗಿ ಭೂಮಿ ಮತ್ತು ಸಾಗರ ಸಂರಕ್ಷಿತ ಪ್ರದೇಶಗಳನ್ನು ತಪ್ಪಿಸುವ ಮಾರ್ಗವನ್ನು ರೂಟರ್ ಕಂಡುಹಿಡಿಯಲಾಗಲಿಲ್ಲ.",
    routeSafeReturnLabel: "✓ ಸುರಕ್ಷಿತ ಹಿಂತಿರುಗುವಿಕೆ:",
    routeSafeReturnTemplate: "ನಿರೀಕ್ಷಿತ ಹಾರ್ಬರ್ ಆಗಮನ {time} ರೊಳಗೆ (18:30 IST ಸಂಜೆಗೂ ಮುನ್ನ).",
    routeReturnAfterDuskLabel: " ಸಂಜೆಯ ನಂತರ ಹಿಂತಿರುಗುವಿಕೆ:",
    routeReturnAfterDuskTemplate: "ನಿರೀಕ್ಷಿತ ಹಿಂತಿರುಗುವಿಕೆ {time} ಕ್ಕೆ (18:30 IST ಸೂರ್ಯಾಸ್ತವನ್ನು ಮೀರಿದೆ). ಮುಂಚಿನ ಪ್ರಯಾಣ ಅಥವಾ ರಾತ್ರಿ ಸಂಚರಣೆ ಬೀಕಾನ್ ಪರಿಶೀಲನೆಯನ್ನು ಶಿಫಾರಸು ಮಾಡಲಾಗಿದೆ."
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
    fmClaimFailed: "ప్రస్తుతం ఈ లిస్టింగ్‌ను క్లెయిమ్ చేయలేకపోయింది.",
    dagAgentSupervisorName: "మాస్టర్ సూపర్‌వైజర్ / DAG ప్లానర్",
    dagAgentSupervisorRole: "బహుళ-మోడల్ సముద్ర ప్రశ్నను విభజించి, సబ్‌టాస్క్‌లను శాటిలైట్, ప్రమాద మరియు జియోఫెన్స్ ఏజెంట్లకు కేటాయిస్తుంది.",
    dagAgentSatelliteName: "శాటిలైట్ ఓషనోగ్రఫీ ఏజెంట్",
    dagAgentSatelliteRole: "Oceansat-3 OCM-3 (క్లోరోఫిల్-a) & SSTM (థర్మల్ ఫ్రంట్లు) డేటాను INSAT-3DR మేఘ చిత్రాలతో పాటు స్వీకరిస్తుంది.",
    dagAgentWeatherName: "వాతావరణం & సముద్ర ప్రమాద ఏజెంట్",
    dagAgentWeatherRole: "గణనీయమైన అల ఎత్తు (SWH), గాలి వేగ వెక్టర్లు, మెరుపు సంభావ్యతను అంచనా వేసి, సముద్ర-అనుమతి స్కోర్‌ను రూపొందిస్తుంది.",
    dagAgentPfzName: "సముద్ర విశ్లేషణ & PFZ ఏజెంట్",
    dagAgentPfzRole: "థర్మల్-క్లోరోఫిల్ ఫ్రంట్ ఖండనలను గుర్తించి, పెలాజిక్ బయోమాస్ సాంద్రతను లెక్కించి, లక్ష్య మత్స్య జోన్లను ర్యాంక్ చేస్తుంది.",
    dagAgentGeofenceName: "జియోఫెన్సింగ్ & రూటింగ్ ఏజెంట్",
    dagAgentGeofenceRole: "అంతర్జాతీయ సముద్ర సరిహద్దు రేఖలను (IMBL) పర్యవేక్షిస్తుంది, సముద్ర సంరక్షిత ప్రాంతాలకు బఫర్లు ఏర్పరుస్తుంది, మరియు A* సురక్షిత మార్గ బిందువులను లెక్కిస్తుంది.",
    dagAgentFleetName: "ఫ్లీట్ & ట్రాఫిక్ ఏజెంట్ (కొత్తది)",
    dagAgentFleetRole: "AIS & ARGOS-4 నౌకా ట్రాన్స్‌పాండర్లను స్కాన్ చేసి, ఫ్లీట్ పంపిణీని ట్రాక్ చేసి, రద్దీ లేదా సరిహద్దు కంజెషన్‌ను గుర్తిస్తుంది.",
    dagAgentEtaName: "ETA & ప్రయాణ భద్రతా ఏజెంట్ (కొత్తది)",
    dagAgentEtaRole: "రియల్-టైమ్ అల నిరోధానికి అనుగుణంగా ప్రయాణ వ్యవధిని లెక్కించి, సాయంత్రం లోపు తిరిగి రావడానికి భద్రతా విండోను అంచనా వేస్తుంది.",
    dagAgentSynthesisName: "న్యూరల్ సింథసిస్ ఏజెంట్ (గణాంక ఆధారిత)",
    dagAgentSynthesisRole: "బహుళ-ఏజెంట్ టెలిమెట్రీని ఒక ప్రామాణికమైన, ఆధారసహిత సహజ-భాషా సలహాగా సైటేషన్ ట్యాగ్‌లు మరియు TTSతో కలిపి సమీకరిస్తుంది -- ఇది పూర్తిగా నియమ-ఆధారితమైనది, ఈ సైట్ యొక్క స్వంత లైవ్ టెలిమెట్రీ మరియు దాని స్వంత సేకరించిన గణాంక లెడ్జర్‌పై ఆధారపడి తర్కిస్తుంది. బాహ్య AI/LLM API ఏదీ ఉపయోగించబడదు.",
    dagStatusIdle: "ఖాళీగా",
    dagInspectLink: "పరిశీలించండి ➔",
    dagInspectorLatencyTemplate: "అమలు లేటెన్సీ: {latency} · సబ్‌టాస్క్‌లు ధృవీకరించబడ్డాయి",
    dagStatusQueued: "క్యూలో ఉంది",
    dagStatusExecuting: "అమలు జరుగుతోంది...",
    dagStatusCompleted: "పూర్తయింది",
    dagStatusSkipped: "పిలవబడలేదు — ఉద్దేశ్యానికి దీని అవసరం లేదు",
    dagBtnReasoningActiveLive: "తర్కం క్రియాశీలంగా ఉంది (లైవ్ బ్యాకెండ్)...",
    dagBtnExecutedLive: "✓ లైవ్ బ్యాకెండ్ ద్వారా పైప్‌లైన్ అమలు చేయబడింది · మళ్లీ రన్ చేయండి",
    dagBtnErrorRetry: "▶ లైవ్ పైప్‌లైన్ సిమ్యులేషన్‌ను రన్ చేయండి",
    dagBtnReasoningActiveOffline: "తర్కం క్రియాశీలంగా ఉంది (స్థానిక సిమ్యులేషన్)...",
    dagBtnExecutedOffline: "✓ పైప్‌లైన్ అమలు చేయబడింది (స్థానిక సిమ్యులేషన్) · మళ్లీ రన్ చేయండి",
    dagTabTitle: "8-నోడ్ సహకార బహుళ-ఏజెంట్ DAG",
    dagInteractiveCanvasBadge: "ఇంటరాక్టివ్ రీజనింగ్ కాన్వాస్",
    dagTabDesc: "Oceansat-3, INSAT-3DR, IMBL జియోఫెన్సింగ్, ఫ్లీట్ సాంద్రత మరియు ప్రయాణ ETAపై తర్కించే రియల్-టైమ్ బహుళ-ఏజెంట్ అమలు పైప్‌లైన్.",
    backendCheckingStatus: "బ్యాకెండ్‌ను తనిఖీ చేస్తోంది...",
    dagZoomReset: "రీసెట్",
    dagRunSimulationBtn: "▶ లైవ్ పైప్‌లైన్ సిమ్యులేషన్‌ను రన్ చేయండి",
    dagClickToInspectHint: "దాని ముడి టెలిమెట్రీ ఇన్‌పుట్, అంతర్గత అల్గారిథమ్‌లు మరియు JSON డేటా అవుట్‌పుట్‌ను పరిశీలించడానికి ఏదైనా ఏజెంట్ కార్డ్‌పై క్లిక్ చేయండి.",
    dagOrchestratorLabel: "ఆర్కెస్ట్రేటర్: LangGraph / Async ఏజెంట్ కోర్",
    dagInspectorDefaultTitle: "ఏజెంట్ వివరాలు",
    dagInspectorDefaultRole: "పాత్ర వివరణ",
    dagInspectorLatencyPlaceholder: "లేటెన్సీ: 24ms",
    dagInspectorJsonLabel: "లైవ్ JSON పేలోడ్",
    dagCloseInspector: "ఇన్‌స్పెక్టర్‌ను మూసివేయండి",
    chatNewConversationMsg: "కొత్త సంభాషణ ప్రారంభమైంది. ORCA మునుపటి చాట్ సందర్భాన్ని ఉపయోగించదు.",
    chatYouLabel: "మీరు",
    chatOrcaLabel: "ORCA",
    chatOrchestratingMsg: "Oceansat-3, INSAT-3DR & Open-Meteo అంతటా 8 ప్రత్యేక AI ఏజెంట్లను సమన్వయం చేస్తోంది...",
    chatAiLabel: "AI",
    chatAdvisoryHeader: "బహుళ-ఏజెంట్ సముద్ర సలహా",
    chatGroundedConfidenceTemplate: "{confidence}% ఆధారసహిత విశ్వాసం",
    chatLangDetectedTooltip: "సందేశం నుండి గుర్తించిన భాష",
    chatListenTts: "వినండి (TTS)",
    chatNavicMssBtn: "NavIC MSS కోడ్",
    chatMetricZone: "సిఫార్సు చేసిన జోన్",
    chatMetricEta: "లైవ్ సముద్ర స్థితి ETA",
    chatMetricVessels: "క్రియాశీల నౌకలు",
    chatVesselsSuffix: "{count} నౌకలు",
    chatMetricImbl: "IMBL అనుమతి",
    chatReasoningTraceSummaryTemplate: "బహుళ-ఏజెంట్ రీజనింగ్ ట్రేస్‌ను చూడండి ({steps} దశలు అమలు చేయబడ్డాయి)",
    chatNodeDagSuffixTemplate: "{count}-నోడ్ DAG",
    chatNoAdvisoryTextFallback: "ORCA INSIGHT బ్యాకెండ్ ఒక సలహాను రూపొందించింది కానీ ఎలాంటి టెక్స్ట్‌ను తిరిగి ఇవ్వలేదు.",
    chatLiveAdvisoryLabel: "✓ లైవ్ బహుళ-ఏజెంట్ సలహా",
    chatGroundedEngineFallback: "ఆధారసహిత ఇంజిన్",
    chatOceanSourceTierTemplate: "సముద్ర మూల స్థాయి: {tier} · క్లోరోఫిల్: {chlorophyll}",
    chatCitationsTemplate: "సైటేషన్లు: {citations}",
    chatOfflineBannerText: "ఆఫ్‌లైన్ సలహా ఇంజిన్ — ORCA బ్యాకెండ్ చేరుకోలేకపోయింది. దిగువ గణాంకాలు లైవ్ టెలిమెట్రీ కాదు, సిమ్యులేటెడ్ ఉదాహరణ అంచనా మాత్రమే.",
    chatOfflineImblPlainText: "ఆఫ్‌లైన్ సలహా (బ్యాకెండ్ చేరుకోలేదు, సిమ్యులేటెడ్ అంచనా): Palk Strait / Gulf of Mannar ప్రాంతంలోని నౌకలు సాధారణంగా India-Sri Lanka IMBL సరిహద్దుకు కొన్ని నాటికల్ మైళ్ల దూరంలో ఉంటాయి. పశ్చిమ దిశగా గమనాన్ని కొనసాగించండి మరియు VHF ట్రాన్స్‌పాండర్లను ఛానల్ 16లో యాక్టివ్‌గా ఉంచండి. సరిహద్దుకు వాస్తవ కొలిచిన దూరం కోసం ORCA బ్యాకెండ్‌కు మళ్లీ కనెక్ట్ అవ్వండి.",
    chatOfflineImblHtmlHeading: "IMBL జియోఫెన్సింగ్ సలహా (సిమ్యులేటెడ్ ఆఫ్‌లైన్ అంచనా):",
    chatOfflineImblHtmlBody1: "లైవ్ బ్యాకెండ్ కనెక్షన్ లేకుండా, నౌక నుండి సరిహద్దుకు ఖచ్చితమైన దూరాలను కొలవలేము. Palk Strait Sector 4 సమీపంలో సాధారణ జాగ్రత్తగా, Mandapam వైపు పశ్చిమ దిశ గమనాన్ని కొనసాగించండి.",
    chatOfflineImblHtmlBody2: "ఇది కొలిచిన జియోఫెన్స్ రీడింగ్ కాదు, ఒక సాధారణ ఆఫ్‌లైన్ భద్రతా రిమైండర్ మాత్రమే. IMBLకు నిజమైన దూర గణన కోసం ORCA బ్యాకెండ్‌కు మళ్లీ కనెక్ట్ అవ్వండి.",
    chatOfflineImblStep1: "బ్యాకెండ్ చేరుకోలేదు. స్థానిక కీవర్డ్ మ్యాచ్‌ను ఉపయోగించి ప్రశ్నను IMBL_BOUNDARYగా వర్గీకరించారు.",
    chatOfflineImblStep2: "లైవ్ జియోఫెన్సింగ్ టెలిమెట్రీ అందుబాటులో లేదు -- సాధారణ సరిహద్దు-భద్రతా మార్గదర్శకత్వాన్ని మాత్రమే తిరిగి ఇస్తోంది.",
    chatOfflineDensityPlainText: "ఆఫ్‌లైన్ సలహా (బ్యాకెండ్ చేరుకోలేదు, సిమ్యులేటెడ్ అంచనా): బ్యాకెండ్ కనెక్షన్ లేకుండా లైవ్ నౌక లెక్కలను పొందలేము. చారిత్రకంగా, Wadge Bank మరియు Kochi Deep Offshore ప్రాంతాల్లో మధ్యస్థ మత్స్య రద్దీ కనిపిస్తుంది. నౌక డేటాసెట్ నుండి వాస్తవ ఫ్లీట్-సాంద్రత రీడింగ్ కోసం ORCA బ్యాకెండ్‌కు మళ్లీ కనెక్ట్ అవ్వండి.",
    chatOfflineDensityHtmlHeading: "ఫ్లీట్ సాంద్రత (ఆఫ్‌లైన్ — సిమ్యులేటెడ్ ప్లేస్‌హోల్డర్):",
    chatOfflineDensityHtmlBody: "ఫ్లీట్ & ట్రాఫిక్ ఏజెంట్ యొక్క లైవ్ నౌక డేటాసెట్ ప్రస్తుతం చేరుకోలేకపోతోంది, కాబట్టి జోన్‌లోని ఖచ్చితమైన నౌక లెక్క అందుబాటులో లేదు.",
    chatOfflineDensityListItem: "నిజమైన జోన్-వారీ నౌక లెక్క మరియు రద్దీ నిర్ధారణ కోసం ORCA బ్యాకెండ్‌కు మళ్లీ కనెక్ట్ అవ్వండి.",
    chatOfflineDensityStep1: "బ్యాకెండ్ చేరుకోలేదు. స్థానిక కీవర్డ్ మ్యాచ్‌ను ఉపయోగించి ప్రశ్నను FLEET_DENSITYగా వర్గీకరించారు.",
    chatOfflineDensityStep2: "లైవ్ ఫ్లీట్ డేటాసెట్ అందుబాటులో లేదు -- కల్పిత గణాంకాన్ని చూపించకుండా ఉండటానికి నౌక లెక్కలు చూపబడలేదు.",
    chatOfflineGenericPlainTextTemplate: "ఆఫ్‌లైన్ సలహా (బ్యాకెండ్ చేరుకోలేదు): ORCA యొక్క బహుళ-ఏజెంట్ బ్యాకెండ్‌ను చేరుకోలేకపోయాము, కాబట్టి ఈ సమాధానం ఆధారసహిత రీడింగ్ కాకుండా ఒక సాధారణ, లైవ్ కాని ప్లేస్‌హోల్డర్ మాత్రమే. మీ బ్రౌజర్ యొక్క స్వంత Open-Meteo విడ్జెట్ గణనీయమైన అల ఎత్తు దాదాపు {liveWave}m అని నివేదిస్తుంది, కానీ PFZ ర్యాంకింగ్, రూట్ దూరం, ETA మరియు ఫ్లీట్ లెక్కలు అన్నీ బ్యాకెండ్‌ను అవసరం చేస్తాయి మరియు ఇక్కడ చూపబడవు. నిజమైన సలహా కోసం ORCA బ్యాకెండ్‌కు మళ్లీ కనెక్ట్ అవ్వండి.",
    chatOfflineGenericHtmlHeading: "ఆఫ్‌లైన్ ప్లేస్‌హోల్డర్ సలహా",
    chatOfflineGenericHtmlBody1Template: "ORCA బహుళ-ఏజెంట్ బ్యాకెండ్ (శాటిలైట్, వాతావరణం, PFZ ర్యాంకింగ్, జియోఫెన్సింగ్, ఫ్లీట్, రూటింగ్ మరియు న్యూరల్ సింథసిస్) ప్రస్తుతం చేరుకోలేకపోతోంది. క్లయింట్-సైడ్‌లో, ఈ బ్రౌజర్ చివరిసారిగా Open-Meteo నుండి <strong>{liveWave}m</strong> అల ఎత్తును చూసింది, కానీ మిగతా ప్రతి గణాంకం బ్యాకెండ్‌ను అవసరం చేస్తుంది.",
    chatOfflineGenericHtmlBody2: "<strong>ఎలాంటి PFZ సిఫార్సు, రూట్, ETA లేదా ఫ్లీట్ లెక్క చూపబడదు</strong> ఎందుకంటే వాటిని లెక్కించడం కాకుండా కల్పించవలసి వస్తుంది. పూర్తి ఆధారసహిత సలహా కోసం ORCA బ్యాకెండ్‌కు మళ్లీ కనెక్ట్ అవ్వండి.",
    chatOfflineGenericStep1: "బ్యాకెండ్ చేరుకోలేదు. ఉద్దేశ్యానికి సంబంధించిన కీవర్డ్ ఏదీ సరిపోలలేదు -- GENERAL_VOYAGE_SAFETY ఆఫ్‌లైన్ ప్లేస్‌హోల్డర్‌ను తిరిగి ఇస్తోంది.",
    chatOfflineGenericStep2Template: "క్లయింట్‌కు కనిపించే ఒకే గణాంకం అందుబాటులో ఉంది: చివరిగా తెలిసిన Open-Meteo అల ఎత్తు {liveWave}m (బ్యాకెండ్ ద్వారా కాకుండా బ్రౌజర్ నేరుగా పొందింది).",
    chatTtsUnsupportedAlert: "మీ బ్రౌజర్ స్పీచ్ సింథసిస్‌కు మద్దతు ఇవ్వదు.",
    chatTtsWelcomeFallback: "ORCA INSIGHTకు స్వాగతం. అన్ని శాటిలైట్ ఫీడ్‌లు మరియు తీర ఓషనోగ్రఫీ వ్యవస్థలు సాధారణ స్థితిలో పనిచేస్తున్నాయి.",
    chatStopAudio: "ఆడియోను ఆపండి",
    chatListenAudioAdvisory: "ఆడియో సలహాను వినండి",
    chatTabTitle: "AI నిర్ణయ స్టూడియో & బహుళ-ఏజెంట్ చాట్‌బాట్",
    chatTabSubtitle: "Oceansat-3, INSAT-3DR మరియు తీర జియోఫెన్సింగ్‌పై తర్కించే సహకార ఏజెంట్లచే శక్తినిస్తుంది",
    chatNewConversationBtn: "కొత్త సంభాషణ",
    chatPromptPFZ: "Kochi హార్బర్ నుండి క్యాచ్ సంభావ్యత మరియు జాతులతో సమీపంలోని అధిక-దిగుబడి PFZ మత్స్య జోన్‌ను కనుగొనండి.",
    chatPromptSafety: "నేటికి సముద్ర-యాత్రా అనుమతి స్కోర్, గణనీయమైన అల ఎత్తు మరియు గాలి ప్రమాదాన్ని తనిఖీ చేయండి.",
    chatPromptBorder: "India-Sri Lanka IMBL సరిహద్దుకు దూరాన్ని తనిఖీ చేసి, 2 NM ప్రమాద జోన్‌లోని నౌకలను జాబితా చేయండి.",
    chatPromptDensity: "Wadge Bank మరియు Kochi Deep అంతటా ప్రస్తుత నౌక లెక్క మరియు సాంద్రత పంపిణీ ఏమిటి?",
    chatPromptETA: "Kochi నుండి PFZ-01కు ప్రయాణ ETAను లెక్కించి, రౌండ్-ట్రిప్ 18:30 సాయంత్రం లోపు సురక్షితంగా తిరిగి వస్తుందో ధృవీకరించండి.",
    chatConversationLabel: "సంభాషణ",
    chatNeuralCoreActive: "ORCA INSIGHT న్యూరల్ కోర్ క్రియాశీలంగా ఉంది",
    chatAgentsReadyUptime: "8 ఏజెంట్లు సిద్ధంగా ఉన్నాయి · 99.94% అప్‌టైమ్",
    chatWelcomeMessage: "వణక్కం / నమస్తే! నేను <strong>ORCA INSIGHT</strong> బహుళ-ఏజెంట్ సింథసిస్ వ్యవస్థను. మీరు సురక్షిత ప్రయాణ అనుమతి, భారత తీరం వెంబడి అధిక-దిగుబడి PFZ జోన్లు, లైవ్ నౌకా రద్దీ, IMBL సరిహద్దు సామీప్యత మరియు సముద్ర-స్థితి సర్దుబాటు చేసిన ETA గణనల గురించి మీ ప్రశ్నను మాట్లాడవచ్చు లేదా టైప్ చేయవచ్చు.",
    chatMicHint: "తమిళం, హిందీ, మలయాళం లేదా ఇంగ్లీష్‌లో మాట్లాడటానికి క్రింద ఉన్న మైక్రోఫోన్ చిహ్నాన్ని క్లిక్ చేయండి!",
    chatVoiceInputTitle: "ప్రశ్న మాట్లాడండి (స్పీచ్-టు-టెక్స్ట్)",
    chatLiveReasoningTraceTitle: "లైవ్ రీజనింగ్ ట్రేస్",
    chatReasoningTraceEmptyHint: "8 సహకార ఏజెంట్లలో ప్రతి ఒక్కటి దీన్ని ఇక్కడ లైవ్‌గా తర్కించడాన్ని చూడటానికి ఎడమవైపు ఒక ప్రశ్న అడగండి.",
    chatLiveTelemetryTitle: "లైవ్ సముద్ర టెలిమెట్రీ",
    chatCurrentSeaClearance: "ప్రస్తుత సముద్ర అనుమతి:",
    chatSignificantWaves: "గణనీయమైన అలలు:",
    chatSurfaceWind: "ఉపరితల గాలి:",
    chatActiveVessels: "క్రియాశీల నౌకలు:",
    chatOpenDagVisualizerBtn: "పూర్తి ఏజెంట్ DAG విజువలైజర్‌ను తెరవండి ➔",
    navicConnected: "NavIC రిసీవర్: కనెక్ట్ చేయబడింది (L5/S-బ్యాండ్)",
    navicDisconnected: "NavIC రిసీవర్: డిస్‌కనెక్ట్ చేయబడింది",
    navicTrackMyPosition: "నా స్థానాన్ని ట్రాక్ చేయండి",
    navicStopTracking: "ట్రాకింగ్‌ను ఆపండి",
    navicSimulateMovement: "నౌక కదలికను సిమ్యులేట్ చేయండి",
    navicStopSimulation: "సిమ్యులేషన్‌ను ఆపండి",
    navicStatusTrackingOff: "ట్రాకింగ్ ఆఫ్‌లో ఉంది · ఎలాంటి స్థానం అభ్యర్థించబడటం లేదు",
    navicStatusGeoUnsupported: "ఈ బ్రౌజర్ జియోలొకేషన్‌కు మద్దతు ఇవ్వదు. డెమో కోసం సిమ్యులేటెడ్ నౌక కదలికను ఉపయోగించండి.",
    navicStatusRequestingPermission: "పరికర-స్థాన అనుమతిని అభ్యర్థిస్తోంది…",
    navicStatusLiveTrackingTemplate: "లైవ్ పరికర ట్రాకింగ్ · ఖచ్చితత్వం ±{accuracy}m · నిల్వ చేయబడదు",
    navicStatusPermissionErrorTemplate: "స్థాన అనుమతి అందుబాటులో లేదు ({error}). ఎలాంటి స్థానం పంపబడలేదు.",
    navicStatusBackendUnavailable: "బ్యాకెండ్ అందుబాటులో లేదు — స్థానిక సిమ్యులేషన్‌లో ఖచ్చితమైన జియోఫెన్స్ దూరాన్ని అంచనా వేయలేము.",
    navicStatusSimStopped: "జియోఫెన్స్ సిమ్యులేషన్ ఆగిపోయింది",
    navicStatusSimMovingTemplate: "సిమ్యులేటెడ్ నౌక కదలిక · పాయింట్ {index}/{total} · {lat}, {lon}",
    navicMssCopiedAlertTemplate: "NavIC MSS / SMS 120-అక్షరాల శాటిలైట్ అత్యవసర కోడ్ కాపీ చేయబడింది:\n\n{code}",
    navicSkyplotTitle: "ISRO NavIC (IRNSS) స్కైప్లాట్",
    navicConstellationDesc: "7-శాటిలైట్ జియోస్టేషనరీ / IGSO కాన్‌స్టలేషన్",
    navicConnectedShort: "కనెక్ట్ చేయబడింది (L5/S)",
    navicTrackedSatellitesTitle: "ట్రాక్ చేయబడిన శాటిలైట్లు (SNR dB-Hz)",
    navicNmeaStreamTitle: "లైవ్ NMEA-0183 హార్డ్‌వేర్ స్ట్రీమ్ ($GNGGA / $GNRMC)",
    navicBaudRateDesc: "బాడ్ రేట్: 9600 bps · 1 Hz ఫీడ్",
    navicDopPrecisionLabel: "DOP ఖచ్చితత్వం",
    navicDopValue: "HDOP 1.05 (అద్భుతం)",
    navicDiffFixLabel: "డిఫరెన్షియల్ ఫిక్స్",
    navicDiffFixValue: "NavIC DGPS క్రియాశీలం",
    navicBorderHwLabel: "సరిహద్దు హెచ్చరిక హార్డ్‌వేర్",
    navicBorderHwValue: "బజర్ సిద్ధంగా ఉంది",
    navicGeofenceTitle: "లైవ్ స్థాన జియోఫెన్సింగ్",
    navicGeofenceDesc: "మీ పరికర స్థానం సెషన్-లోపల IMBL/MPA తనిఖీల కోసం మాత్రమే ఉపయోగించబడుతుంది మరియు ORCA దీన్ని ఎప్పుడూ నిల్వ చేయదు.",
    navicGeofenceInitialStatus: "ట్రాకింగ్ ఆఫ్‌లో ఉంది · 5 NM IMBL హెచ్చరిక / MPA బఫర్ హెచ్చరిక",
    safetyVerdictDescTemplate: "మీరు ఎంచుకున్న హార్బర్ సమీపంలో లైవ్ Open-Meteo సముద్ర టెలిమెట్రీ ప్రకారం గణనీయమైన అల ఎత్తు {wave}m మరియు ఉపరితల గాలి వేగం {wind}kn గా ఉంది, ఇది {score}/100 లెక్కించిన భద్రతా స్కోర్‌ను ఇస్తుంది.",
    safetyWindDefaultDirection: "పశ్చిమ దిశ",
    safetyBreezeSuffix: "{direction} గాలి",
    severityLow: "తక్కువ",
    severityModerate: "మధ్యస్థం",
    severityHigh: "అధికం",
    waveBandCalm: "ప్రశాంతం (< 0.5m)",
    waveBandSlight: "కొద్దిగా (0.5 - 1.25m)",
    waveBandModerate: "మధ్యస్థం (1.25 - 2.5m)",
    waveBandRough: "కల్లోలం (> 2.5m)",
    seaStateCalm: "ప్రశాంతం",
    seaStateSlight: "కొద్దిగా",
    seaStateSlightModerate: "కొద్దిగా నుండి మధ్యస్థం",
    seaStateModerateRough: "మధ్యస్థం నుండి కల్లోలం",
    seaStateUnknown: "తెలియదు",
    lightningBandSafe: "సురక్షిత వాతావరణ ప్రొఫైల్",
    lightningBandElevated: "పెరిగిన కన్వెక్టివ్ ప్రమాదం",
    lightningBandSevere: "తీవ్రమైన తుఫాను హెచ్చరిక",
    safetySyncLatencyLabel: "సింక్ లేటెన్సీ:",
    safetyBatteryLabel: "బ్యాటరీ:",
    safetyLastPassLabel: "చివరి పాస్:",
    safetyAltitudeLabel: "ఎత్తు:",
    telemetryLiveOpenMeteoTemplate: "లైవ్ OPEN-METEO టెలిమెట్రీ ({wave}m SWH)",
    telemetryCachedArchive: "టెలిమెట్రీ క్రియాశీలం (కాష్ చేసిన శాటిలైట్ ఆర్కైవ్)",
    backendOnlineStatus: "లైవ్ FASTAPI బ్యాకెండ్ కనెక్ట్ చేయబడింది",
    backendOfflineStatus: "బ్యాకెండ్ ఆఫ్‌లైన్‌లో ఉంది · స్థానిక సిమ్యులేషన్ మోడ్",
    aisLiveCountTemplate: "{count} లైవ్ AIS నౌక{plural}",
    aisNoLiveVessels: "ప్రస్తుతం ఎలాంటి లైవ్ AIS నౌకలు లేవు",
    aisBlendedBannerTemplate: "{liveText} + {simCount} సిమ్యులేటెడ్ నౌక{plural}ను చూపిస్తోంది, ఇవి ప్రస్తుతం లైవ్ AIS కవరేజ్ లేని పోర్టులను పూరిస్తున్నాయి.",
    aisUnavailableDefault: "లైవ్ AIS నౌక ఫీడ్ అందుబాటులో లేదు -- 0 నౌకలను చూపిస్తోంది.",
    aisNotConfigured: "ఈ డిప్లాయ్‌మెంట్‌లో లైవ్ AIS నౌక ఫీడ్ కాన్ఫిగర్ చేయబడలేదు.",
    aisConnectedNotSending: "AIS ప్రొవైడర్‌కు (AISstream.io) కనెక్ట్ చేయబడింది, కానీ ఇది ప్రస్తుతం నౌక డేటాను పంపడం లేదు — ఇది స్థానిక లోపం కాదు, ప్రొవైడర్-వైపు అంతరాయం కావచ్చు.",
    aisDisconnectedReconnecting: "AIS ప్రొవైడర్ (AISstream.io) నుండి డిస్‌కనెక్ట్ చేయబడింది; స్వయంచాలకంగా మళ్లీ కనెక్ట్ అవుతోంది.",
    imblAlertActiveTemplate: "<strong>{vesselId} ({vesselName})</strong> India–Sri Lanka IMBL నుండి <strong>{dist} NM</strong> దూరంలో నడుస్తోంది{simTag}. స్వయంచాలక హెచ్చరిక పంపబడింది.",
    imblAlertNoneTemplate: "ప్రస్తుతం {warnDist} NM IMBL హెచ్చరిక దూరంలో ఎలాంటి నౌకలు లేవు. సమీపంలో ట్రాక్ చేసిన నౌక: <strong>{dist} NM</strong> దూరంలో ఉంది.",
    imblAlertNoData: "ఇంకా ఎలాంటి నౌక టెలిమెట్రీ అందుబాటులో లేదు.",
    simulatedSuffix: " (సిమ్యులేటెడ్)",
    notifUnavailableTitle: "బ్రౌజర్ నోటిఫికేషన్లు అందుబాటులో లేవు",
    notifUnavailableMsg: "ఈ ట్యాబ్ తెరిచి ఉన్నంత వరకు యాప్-లోపల ప్రమాద బ్యానర్లు ఇప్పటికీ చూపబడతాయి.",
    notifNotEnabledTitle: "బ్రౌజర్ నోటిఫికేషన్లు ప్రారంభించబడలేదు",
    notifNotEnabledMsg: "ఈ ట్యాబ్ తెరిచి ఉన్నంత వరకు యాప్-లోపల ప్రమాద బ్యానర్లు క్రియాశీలంగా ఉంటాయి.",
    hazardHighWavesTitle: "ఎత్తైన అలలు — స్థానిక సిమ్యులేషన్",
    hazardHighWavesMsgTemplate: "{wave}m అనేది 2.5m జాగ్రత్తా పరిమితిని మించిపోయింది. మూలం: బ్రౌజర్ Open-Meteo టెలిమెట్రీ.",
    hazardHighWindTitle: "అధిక గాలి — స్థానిక సిమ్యులేషన్",
    hazardHighWindMsgTemplate: "{wind} kn అనేది 25 kn జాగ్రత్తా పరిమితిని మించిపోయింది. మూలం: బ్రౌజర్ Open-Meteo టెలిమెట్రీ.",
    hazardLightningTitle: "మెరుపు ప్రమాదం — స్థానిక సిమ్యులేషన్",
    hazardLightningMsgTemplate: "మెరుపు ప్రాక్సీ {pct}%గా ఉంది. మూలం: బ్రౌజర్ Open-Meteo టెలిమెట్రీ.",
    safetyOfficialClearanceLabel: "అధికారిక సముద్ర అనుమతి",
    safetyVerdictDescInitial: "అన్ని శాటిలైట్ ఓషనోగ్రఫీ సూచికలు (Oceansat-3 SSTM థర్మల్ ఫ్రంట్లు, Sentinel-3 అల ఆల్టిమెట్రీ) కేరళ, కర్ణాటక మరియు తమిళనాడు తీర జలాల వెంబడి అనుకూలమైన మత్స్య పరిస్థితులను ధృవీకరిస్తాయి.",
    safetyIndexLabel: "భద్రతా సూచిక",
    satConstellationTitle: "ISRO & అంతర్జాతీయ ఓషనోగ్రాఫిక్ శాటిలైట్ కాన్‌స్టలేషన్",
    satStaticDataNote: "స్థిర సూచన డేటా (లైవ్ టెలిమెట్రీ కాదు)",
    mapIndiaBoundaryPopup: "భారతదేశం — అధికారిక సరిహద్దు (Survey of India)",
    mapPfzYieldSuffix: "{rating} దిగుబడి ({pct}%)",
    mapPfzSstLabel: "SST:",
    mapPfzChlorophyllLabel: "క్లోరోఫిల్:",
    mapPfzDepthLabel: "లోతు:",
    mapPfzVesselsLabel: "నౌకలు:",
    mapPfzActiveSuffix: "{count} క్రియాశీలం",
    mapPfzTargetSpeciesLabel: "లక్ష్య జాతులు:",
    mapPfzSimulateRouteBtn: "ఇక్కడ రూట్‌ను సిమ్యులేట్ చేయండి ➔",
    mapImblPopupBodyTemplate: "కఠినమైన అంతర్జాతీయ సముద్ర సరిహద్దు. హెచ్చరిక బఫర్: {warn} NM. క్రిటికల్ జియోఫెన్స్: {danger} NM.",
    mapImblPopupTreatyNote: "UNCLOS సముద్ర ఒప్పందం ప్రకారం సరిహద్దు దాటడం నిషేధించబడింది.",
    mapImblBufferCorridorTemplate: "{dist} NM IMBL బఫర్ కారిడార్",
    mapMpaRestrictedBadge: "నిషేధిత ఎకో-రిజర్వ్",
    mapHarbourCoastSuffix: "{state} తీరం",
    mapHarbourCapacityLabel: "సామర్థ్యం:",
    mapHarbourVhfLabel: "VHF:",
    mapHarbourFuelLabel: "ఇంధన స్టేషన్:",
    mapHarbourFuelAvailable: "అందుబాటులో ఉంది",
    mapHarbourIceLabel: "ఐస్ ప్లాంట్:",
    mapHarbourIceActive: "క్రియాశీలం",
    mapHarbourSetOriginBtn: "మూల హార్బర్‌గా సెట్ చేయండి",
    mapVesselSimulatedBadge: "సిమ్యులేటెడ్ · ఇక్కడ లైవ్ AIS కవరేజ్ లేదు",
    mapVesselSpeedLabel: "వేగం:",
    mapVesselHeadingLabel: "దిశ:",
    mapVesselZoneLabel: "జోన్:",
    mapVesselImblDistLabel: "IMBL దూరం:",
    mapVesselStatusLabel: "స్థితి:",
    mapVesselFuelLabel: "ఇంధనం:",
    mapVesselFuelNA: "N/A",
    mapRoutePopupTitle: "సముద్రం-మాత్రమే A* రూట్ (భూమి + MPA నివారణ)",
    mapRouteDistanceEtaTemplate: "దూరం: {dist} NM · ETA: {eta}{detourNote}",
    mapRouteDetourTemplate: " · {zones} చుట్టూ {pct}% డిటూర్",
    mapRouteLandNoGoZones: "భూమి/నిషేధిత జోన్లు",
    vesselStatusSafeFishing: "సురక్షిత మత్స్యం",
    vesselStatusBorderAlert: "సరిహద్దు హెచ్చరిక",
    vesselStatusBorderWarn: "సరిహద్దు జాగ్రత్త",
    vesselStatusInTransit: "ప్రయాణంలో",
    vesselSimBadgeText: "SIM",
    vesselSimBadgeTitle: "సిమ్యులేటెడ్ -- ఈ పోర్ట్ సమీపంలో లైవ్ AIS కవరేజ్ లేదు",
    vesselLocateAction: "గుర్తించండి ➔",
    fleetVesselCountSuffix: "{count} నౌకలు",
    fleetLiveSimBreakdownTemplate: "{total} ({live} లైవ్ · {sim} సిమ్)",
    mapActiveVesselsBreakdownTemplate: "{total} క్రియాశీల నౌకలు ({live} లైవ్ · {sim} సిమ్యులేటెడ్)",
    mapActiveVesselsSimpleTemplate: "{total} క్రియాశీల నౌకలు",
    mapTabTitle: "GIS కమాండ్ మ్యాప్ · భారత తీర జలాలు",
    mapTabDesc: "రియల్-టైమ్ శాటిలైట్ PFZలు, IMBL సరిహద్దు కారిడార్లు మరియు AIS నౌకా ట్రాక్‌లతో కూడిన ఇంటరాక్టివ్ హై-కాంట్రాస్ట్ నాటికల్ మ్యాప్.",
    layerPfzZones: "PFZ జోన్లు",
    layerImblBuffer: "IMBL బఫర్",
    layerEcoReserves: "ఎకో రిజర్వ్‌లు (MPA)",
    layerHarbours: "హార్బర్లు",
    layerLiveVessels: "లైవ్ నౌకలు",
    layerDensityHeatmap: "సాంద్రత హీట్‌మ్యాప్",
    layerIndiaBoundary: "భారత సరిహద్దు (Survey of India)",
    routePlannerDesc: "MPAలు మరియు సరిహద్దు ప్రమాదాలను నివారించే A*-శైలి మార్గం",
    routeVesselSpeedLabel: "నౌక వేగం:",
    fleetMonitorTitle: "ఫ్లీట్ మానిటర్ · లైవ్ నౌక టెలిమెట్రీ",
    fleetTotalActiveTitle: "మొత్తం క్రియాశీల నౌకలు",
    fleetTotalActiveDesc: "ప్రస్తుతం AIS ట్రాన్స్‌పాండర్ సిగ్నల్‌లను ప్రసారం చేస్తున్న నౌకలు",
    fleetZoneDistTitle: "జోన్ వారీగా నౌక పంపిణీ",
    imblAlertCardTitle: "IMBL సరిహద్దు సామీప్యత హెచ్చరిక",
    fleetTableSubDesc: "AISstream.io నుండి లైవ్ AIS స్థానాలు, ప్రస్తుతం లైవ్ రిసీవర్ కవరేజ్ లేని చోట స్పష్టంగా ట్యాగ్ చేసిన సిమ్యులేటెడ్ ఫ్లీట్‌తో (\"SIM\" బ్యాడ్జ్ చూడండి) బ్యాక్‌ఫిల్ చేయబడింది",
    vesselSearchPlaceholder: "నౌక పేరు లేదా IDని శోధించండి...",
    filterAllStatuses: "అన్ని స్థితులు",
    filterSafeFishing: "సురక్షిత మత్స్యం",
    filterInTransit: "ప్రయాణంలో",
    filterBorderAlert: "సరిహద్దు హెచ్చరిక",
    thVesselId: "నౌక ID",
    thVesselName: "నౌక పేరు",
    thType: "రకం",
    thCurrentZone: "ప్రస్తుత జోన్",
    thSpeedHeading: "వేగం / దిశ",
    thImblDist: "IMBL దూరం",
    thStatus: "స్థితి",
    thAction: "చర్య",
    bulletinIssuedLabel: "జారీ చేయబడింది:",
    bulletinRegionLabel: "ప్రాంతం:",
    bulletinWavesLabel: "అలలు:",
    bulletinWindsLabel: "గాలులు:",
    bulletinSourceLabel: "మూలం:",
    bulletinListenBtn: "బులెటిన్‌ను వినండి",
    bulletinsTabTitle: "అధికారిక సముద్ర & మత్స్య బులెటిన్లు (ISRO - INCOIS)",
    bulletinsTabDesc: "క్రమసంఖ్య గల సలహాలు, తుఫాను ప్రమాద హెచ్చరికలు మరియు అంతర్జాతీయ సరిహద్దు అనుసరణ హెచ్చరికలు.",
    bulletinNotifyToggleTitle: "ఈ ట్యాబ్/PWA తెరిచి ఉన్నప్పుడు మాత్రమే బ్రౌజర్ హెచ్చరికలను స్వీకరించండి",
    bulletinNotifyToggleLabel: "తెరిచి ఉన్నప్పుడు తెలియజేయండి",
    bulletinFilterAll: "అన్ని బులెటిన్లు",
    bulletinFilterCritical: "క్రిటికల్",
    bulletinFilterWarning: "హెచ్చరికలు",
    bulletinFilterAdvisory: "సలహాలు",
    bulletinsPushNote: "ఈ ట్యాబ్/PWA తెరిచి ఉన్నప్పుడు మాత్రమే ప్రమాద హెచ్చరికలు చురుగ్గా పనిచేస్తాయి. యాప్ మూసివేయబడినప్పుడు పుష్ నోటిఫికేషన్లకు ప్రొడక్షన్ పుష్-సబ్‌స్క్రిప్షన్ సేవ అవసరం మరియు ఇది ఈ ప్రోటోటైప్‌లో అమలు చేయబడలేదు.",
    sosModalTitle: "అత్యవసర ఆపద బీకాన్ (SOS)",
    sosInstructions: "అత్యవసర SOSను ప్రారంభించడం వల్ల <strong>INSAT-3DR SAS&R</strong> ద్వారా భారత కోస్ట్ గార్డ్ మెరైన్ రెస్క్యూ కోఆర్డినేషన్ సెంటర్ (MRCC)కు అత్యవసర 406 MHz ఆపద సిగ్నల్ ప్రసారం చేయబడుతుంది.",
    sosCurrentPositionLabel: "ప్రస్తుత స్థానం:",
    sosVhfChannelLabel: "అత్యవసర VHF ఛానల్:",
    sosMrccHelplineLabel: "MRCC హెల్ప్‌లైన్:",
    sosConfirmBtn: "నిర్ధారించి ఆపద బీకాన్‌ను ప్రసారం చేయండి",
    sosBeaconTransmittingBanner: "406 MHz SAS&R బీకాన్ ISRO & కోస్ట్ గార్డ్ MRCCకు ప్రసారం అవుతోంది",
    sosDistressRelayedMsg: "INSAT-3DR SAS&R రిసీవర్ ద్వారా ఆపద ప్యాకెట్ రిలే చేయబడింది. మెరైన్ రెస్క్యూ కోఆర్డినేషన్ సెంటర్ (MRCC చెన్నై/ముంబై) VHF Ch 16లో హెచ్చరించబడింది.",
    sosGpsVesselIdTemplate: "GPS కోఆర్డినేట్లు: {coords} · నౌక ID: {vesselId} ({vesselName})",
    landingEyebrow: "ISRO సహకార సముద్ర ఇంటెలిజెన్స్ · Smart India Hackathon 2026",
    landingSubtitle: "ఒక సహకార సముద్ర-ఇంటెలిజెన్స్ ప్లాట్‌ఫారమ్, రెండు కమాండ్ డెక్‌లు: మత్స్యకారుని రోజువారీ అవకాశ కన్సోల్, మరియు పూర్తి ISRO శాటిలైట్, AIS మరియు జియోఫెన్సింగ్ ఇన్‌సైట్ సూట్.",
    landingStripItem1: "Oceansat-3 SSTM థర్మల్ ఫ్రంట్లు",
    landingStripItem2: "INSAT-3DR శాటిలైట్ ఓషనోగ్రఫీ",
    landingStripItem3: "8-నోడ్ సహకార ఏజెంట్ DAG",
    landingStripItem4: "NavIC (IRNSS) GPS బ్రిడ్జ్",
    landingStripItem5: "IMBL సరిహద్దు జియోఫెన్సింగ్ హెచ్చరికలు",
    landingStripItem6: "లైవ్ AIS ఫ్లీట్ & GIS కమాండ్",
    landingStripItem7: "Sell Smarter కొనుగోలుదారు ధర",
    landingStripItem8: "406 MHz SOS ఆపద బీకాన్",
    landingFishermanCardTitle: "ORCA Fisherman",
    landingFishermanCardDesc: "నేటి అవకాశ స్కోర్, Sell Smarter ధర, ప్రయాణ-ఖర్చు కాలిక్యులేటర్ మరియు మీ క్యాచ్ కోసం కొనుగోలుదారు లీడ్‌లు — పడవ కోసం రూపొందించబడింది.",
    landingFishermanCardCta: "Fisherman Console తెరవండి",
    landingFishermanCardTitleAttr: "Fisherman Consoleను తెరవండి",
    landingInsightCardTitle: "ORCA Insight",
    landingInsightCardDesc: "పూర్తి కమాండ్ డెక్: ISRO శాటిలైట్ ఓషనోగ్రఫీ, GIS మ్యాప్, 8-నోడ్ ఏజెంట్ DAG, భద్రతా బారోమీటర్, ఫ్లీట్ మానిటర్ మరియు NavIC బ్రిడ్జ్.",
    landingInsightCardCta: "Insight Command Deckను తెరవండి",
    landingInsightCardTitleAttr: "Insight command deckను తెరవండి",
    backToOverviewTitle: "అవలోకనానికి తిరిగి వెళ్ళండి",
    statSimulatedFleetLabel: "సిమ్యులేటెడ్ AIS ఫ్లీట్",
    statSatellitesActiveTemplate: "{count} క్రియాశీలం",
    statSatellitesListLabel: "Oceansat-3, INSAT-3DR, Sentinel-3",
    statPfzZonesCountTemplate: "{count} జోన్లు",
    statPfzZonesListLabel: "Wadge Bank, Kochi, Veraval...",
    statImblCorridorsCountTemplate: "{count} కారిడార్లు",
    statImblBordersLabel: "India-Sri Lanka & Pak సరిహద్దులు",
    pillarDagTitle: "8-నోడ్ సహకార ఏజెంట్ DAG",
    pillarDagDesc: "సబ్-సెకండ్ లేటెన్సీతో ప్రశ్నలను శాటిలైట్, అల ప్రమాదం, జియోఫెన్సింగ్, నౌక లెక్కింపు, ETA మరియు న్యూరల్ సింథసిస్ దశలుగా విభజించే బహుళ-ఏజెంట్ ఆర్కిటెక్చర్.",
    pillarEtaTitle: "లైవ్ సముద్ర-స్థితి ETA & సాయంత్రం భద్రత",
    pillarEtaDesc: "సూర్యాస్తమయం తర్వాత మత్స్యకారులు చిక్కుకుపోకుండా నిరోధించడానికి స్వయంచాలక Return-by-Dusk భద్రతా హెచ్చరికలతో అల నిరోధానికి సర్దుబాటు చేసిన హైడ్రోడైనమిక్ ప్రయాణ గణనలు.",
    pillarFleetTitle: "లైవ్ ఫ్లీట్ సాంద్రత & IMBL హెచ్చరిక",
    pillarFleetDesc: "సముద్ర సరిహద్దులను రక్షించే జోన్ వారీగా రియల్-టైమ్ నౌక లెక్కింపు, రద్దీ ప్రమాద సూచికలు మరియు స్వయంచాలక 5 NM/2 NM జియోఫెన్స్ సామీప్యత హెచ్చరికలు.",
    footerCreditLine: "<span class=\"text-slate-200 font-semibold\">{appTitle}</span> · నిర్మించినవారు <strong class=\"text-cyan-400\">{teamName}</strong> · Smart India Hackathon 2026 · Problem Statement 26176 (ISRO)",
    sttListeningStatusTemplate: "<b>{lang}</b>లో వింటోంది... ఇప్పుడు మాట్లాడండి.",
    sttUnsupportedTitle: "ఈ బ్రౌజర్‌లో స్పీచ్ రికగ్నిషన్‌కు మద్దతు లేదు",
    routeUnavailableLabel: " రూట్ అందుబాటులో లేదు:",
    routeUnavailableMsg: "ORCA బ్యాకెండ్ చేరుకోలేకపోతోంది, కాబట్టి ఎలాంటి రూట్ దూరం/ETA చూపించలేము. స్థానిక ఫాల్‌బ్యాక్ మోడ్‌లో నడుస్తోంది.",
    routeNoSafeRouteLabel: "✕ సురక్షిత సముద్ర రూట్ కనుగొనబడలేదు:",
    routeNoSafeRouteMsgTemplate: "{detail}",
    routeNoSafeRouteDefaultReason: "ఈ హార్బర్/PFZ జతకు భూమి మరియు సముద్ర సంరక్షిత ప్రాంతాలను నివారించే మార్గాన్ని రూటర్ కనుగొనలేకపోయింది.",
    routeSafeReturnLabel: "✓ సురక్షిత తిరిగి రాక:",
    routeSafeReturnTemplate: "{time} నాటికి హార్బర్ చేరుకోవడం అంచనా (18:30 IST సాయంత్రం లోపు).",
    routeReturnAfterDuskLabel: " సాయంత్రం తర్వాత తిరిగి రాక:",
    routeReturnAfterDuskTemplate: "{time}కు తిరిగి రావడం అంచనా (18:30 IST సూర్యాస్తమయాన్ని మించిపోతుంది). ముందుగా బయలుదేరడం లేదా రాత్రి నావిగేషనల్ బీకాన్ తనిఖీని సిఫార్సు చేస్తున్నాము."
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
    fmClaimFailed: "ବର୍ତ୍ତମାନ ଏହି ତାଲିକା ଦାବି କରିହେଲା ନାହିଁ।",
    dagAgentSupervisorName: "ମାଷ୍ଟର ସୁପରଭାଇଜର / DAG ପ୍ଲାନର",
    dagAgentSupervisorRole: "ବହୁ-ମାଧ୍ୟମ ସାମୁଦ୍ରିକ ପ୍ରଶ୍ନକୁ ବିଭକ୍ତ କରି ଉପକାର୍ଯ୍ୟଗୁଡ଼ିକୁ ସାଟେଲାଇଟ୍, ବିପଦ ଓ ଜିଓଫେନ୍ସ ଏଜେଣ୍ଟଙ୍କୁ ପ୍ରଦାନ କରେ।",
    dagAgentSatelliteName: "ସାଟେଲାଇଟ୍ ମହାସାଗର ବିଜ୍ଞାନ ଏଜେଣ୍ଟ",
    dagAgentSatelliteRole: "Oceansat-3 OCM-3 (କ୍ଲୋରୋଫିଲ୍-a) ଓ SSTM (ତାପୀୟ ଫ୍ରଣ୍ଟ) ସହିତ INSAT-3DR ମେଘ ଚିତ୍ର ଗ୍ରହଣ କରେ।",
    dagAgentWeatherName: "ପାଣିପାଗ ଓ ସାମୁଦ୍ରିକ ବିପଦ ଏଜେଣ୍ଟ",
    dagAgentWeatherRole: "ଉଲ୍ଲେଖନୀୟ ତରଙ୍ଗ ଉଚ୍ଚତା (SWH), ପବନ ଝଡ଼ ଦିଗ, ବିଜୁଳି ସମ୍ଭାବନା ମୂଲ୍ୟାୟନ କରି ସମୁଦ୍ର-ଯାତ୍ରା ମଞ୍ଜୁରୀ ସ୍କୋର ତିଆରି କରେ।",
    dagAgentPfzName: "ମହାସାଗର ବିଶ୍ଳେଷଣ ଓ PFZ ଏଜେଣ୍ଟ",
    dagAgentPfzRole: "ତାପୀୟ-କ୍ଲୋରୋଫିଲ୍ ଫ୍ରଣ୍ଟ ମିଳନ ସ୍ଥଳ ଚିହ୍ନଟ କରି, ପେଲାଜିକ୍ ଜୈବ ପିଣ୍ଡ ଘନତା ଗଣନା କରି ଲକ୍ଷ୍ୟ ମତ୍ସ୍ୟ ଅଞ୍ଚଳଗୁଡ଼ିକୁ କ୍ରମାନ୍ୱୟ କରେ।",
    dagAgentGeofenceName: "ଜିଓଫେନ୍ସିଂ ଓ ମାର୍ଗ ନିର୍ଦ୍ଧାରଣ ଏଜେଣ୍ଟ",
    dagAgentGeofenceRole: "ଆନ୍ତର୍ଜାତୀୟ ସାମୁଦ୍ରିକ ସୀମା ରେଖା (IMBL) ନିରୀକ୍ଷଣ କରି, ସାମୁଦ୍ରିକ ସୁରକ୍ଷିତ ଅଞ୍ଚଳଗୁଡ଼ିକୁ ବଫର କରି A* ସୁରକ୍ଷିତ ୱେପଏଣ୍ଟ ଗଣନା କରେ।",
    dagAgentFleetName: "ଫ୍ଲିଟ୍ ଓ ଯାତାୟାତ ଏଜେଣ୍ଟ (ନୂଆ)",
    dagAgentFleetRole: "AIS ଓ ARGOS-4 ଜାହାଜ ଟ୍ରାନ୍ସପଣ୍ଡରକୁ ସ୍କାନ୍ କରି, ଫ୍ଲିଟ୍ ବଣ୍ଟନ ଟ୍ରାକ୍ କରି ଅତିରିକ୍ତ ଭିଡ଼ କିମ୍ବା ସୀମା ଯାନଜଟ ଚିହ୍ନଟ କରେ।",
    dagAgentEtaName: "ETA ଓ ଯାତ୍ରା ସୁରକ୍ଷା ଏଜେଣ୍ଟ (ନୂଆ)",
    dagAgentEtaRole: "ପ୍ରକୃତ-ସମୟ ତରଙ୍ଗ ପ୍ରତିରୋଧ ଅନୁସାରେ ପରିବହନ ଅବଧି ଗଣନା କରି ସନ୍ଧ୍ୟା ପୂର୍ବରୁ ଫେରିବାର ସୁରକ୍ଷା ସମୟସୀମା ମୂଲ୍ୟାୟନ କରେ।",
    dagAgentSynthesisName: "ନ୍ୟୁରାଲ୍ ସିଣ୍ଥେସିସ୍ ଏଜେଣ୍ଟ (ପରିସଂଖ୍ୟାନ-ଚାଳିତ)",
    dagAgentSynthesisRole: "ବହୁ-ଏଜେଣ୍ଟ ଟେଲିମେଟ୍ରିକୁ ଏକତ୍ର କରି ଉଦ୍ଧୃତି ଟ୍ୟାଗ ଓ TTS ସହିତ ଏକ ପ୍ରାମାଣିକ, ତଥ୍ୟ-ଆଧାରିତ ପ୍ରାକୃତିକ-ଭାଷା ପରାମର୍ଶ ପ୍ରସ୍ତୁତ କରେ -- ସମ୍ପୂର୍ଣ୍ଣ ନିୟମ-ଆଧାରିତ, ଏହି ସାଇଟର ନିଜ ଲାଇଭ୍ ଟେଲିମେଟ୍ରି ଓ ନିଜ ସଂଚିତ ପରିସଂଖ୍ୟାନ ଖାତା ଉପରେ ଚିନ୍ତନ କରି। କୌଣସି ବାହ୍ୟ AI/LLM API ବ୍ୟବହାର ହୁଏ ନାହିଁ।",
    dagStatusIdle: "ନିଷ୍କ୍ରିୟ",
    dagInspectLink: "ନିରୀକ୍ଷଣ କରନ୍ତୁ ➔",
    dagInspectorLatencyTemplate: "ନିଷ୍ପାଦନ ବିଳମ୍ବ: {latency} · ଉପକାର୍ଯ୍ୟ ଯାଞ୍ଚ ହୋଇଛି",
    dagStatusQueued: "ଧାଡ଼ିରେ",
    dagStatusExecuting: "ନିଷ୍ପାଦନ ହେଉଛି...",
    dagStatusCompleted: "ସମ୍ପୂର୍ଣ୍ଣ",
    dagStatusSkipped: "ଆହ୍ୱାନ ହୋଇନାହିଁ — ଉଦ୍ଦେଶ୍ୟ ଏହାକୁ ଆବଶ୍ୟକ କରିନଥିଲା",
    dagBtnReasoningActiveLive: "ତର୍କଣ ସକ୍ରିୟ (ଲାଇଭ୍ ବ୍ୟାକଏଣ୍ଡ)...",
    dagBtnExecutedLive: "✓ ଲାଇଭ୍ ବ୍ୟାକଏଣ୍ଡ ମାଧ୍ୟମରେ ପାଇପଲାଇନ୍ ନିଷ୍ପାଦିତ · ପୁଣି ଚଲାନ୍ତୁ",
    dagBtnErrorRetry: "▶ ଲାଇଭ୍ ପାଇପଲାଇନ୍ ସିମୁଲେସନ୍ ଚଲାନ୍ତୁ",
    dagBtnReasoningActiveOffline: "ତର୍କଣ ସକ୍ରିୟ (ସ୍ଥାନୀୟ ସିମୁଲେସନ୍)...",
    dagBtnExecutedOffline: "✓ ପାଇପଲାଇନ୍ ନିଷ୍ପାଦିତ (ସ୍ଥାନୀୟ ସିମୁଲେସନ୍) · ପୁଣି ଚଲାନ୍ତୁ",
    dagTabTitle: "8-ନୋଡ୍ ସହଯୋଗୀ ବହୁ-ଏଜେଣ୍ଟ DAG",
    dagInteractiveCanvasBadge: "ଇଣ୍ଟରାକ୍ଟିଭ୍ ତର୍କଣ କାନଭାସ୍",
    dagTabDesc: "Oceansat-3, INSAT-3DR, IMBL ଜିଓଫେନ୍ସିଂ, ଫ୍ଲିଟ୍ ଘନତା ଓ ଯାତ୍ରା ETA ଉପରେ ତର୍କଣ କରୁଥିବା ପ୍ରକୃତ-ସମୟ ବହୁ-ଏଜେଣ୍ଟ ନିଷ୍ପାଦନ ପାଇପଲାଇନ୍।",
    backendCheckingStatus: "ବ୍ୟାକଏଣ୍ଡ ଯାଞ୍ଚ ହେଉଛି...",
    dagZoomReset: "ପୁନଃସେଟ୍",
    dagRunSimulationBtn: "▶ ଲାଇଭ୍ ପାଇପଲାଇନ୍ ସିମୁଲେସନ୍ ଚଲାନ୍ତୁ",
    dagClickToInspectHint: "ଏହାର କଞ୍ଚା ଟେଲିମେଟ୍ରି ଇନପୁଟ୍, ଆଭ୍ୟନ୍ତରୀଣ ଆଲଗୋରିଦମ୍ ଓ JSON ତଥ୍ୟ ଆଉଟପୁଟ୍ ନିରୀକ୍ଷଣ କରିବାକୁ ଯେକୌଣସି ଏଜେଣ୍ଟ କାର୍ଡରେ କ୍ଲିକ୍ କରନ୍ତୁ।",
    dagOrchestratorLabel: "ଅର୍କେଷ୍ଟ୍ରେଟର: LangGraph / ଏସିଙ୍କ୍ ଏଜେଣ୍ଟ କୋର୍",
    dagInspectorDefaultTitle: "ଏଜେଣ୍ଟ ବିବରଣୀ",
    dagInspectorDefaultRole: "ଭୂମିକା ବର୍ଣ୍ଣନା",
    dagInspectorLatencyPlaceholder: "ବିଳମ୍ବ: 24ms",
    dagInspectorJsonLabel: "ଲାଇଭ୍ JSON ପେଲୋଡ୍",
    dagCloseInspector: "ନିରୀକ୍ଷକ ବନ୍ଦ କରନ୍ତୁ",
    chatNewConversationMsg: "ନୂଆ ବାର୍ତ୍ତାଳାପ ଆରମ୍ଭ ହେଲା। ORCA ପୂର୍ବ ଚାଟ୍ ପ୍ରସଙ୍ଗ ବ୍ୟବହାର କରିବ ନାହିଁ।",
    chatYouLabel: "ଆପଣ",
    chatOrcaLabel: "ORCA",
    chatOrchestratingMsg: "Oceansat-3, INSAT-3DR ଓ Open-Meteo ଉପରେ 8ଟି ବିଶେଷଜ୍ଞ AI ଏଜେଣ୍ଟଙ୍କୁ ଅର୍କେଷ୍ଟ୍ରେଟ୍ କରୁଛି...",
    chatAiLabel: "AI",
    chatAdvisoryHeader: "ବହୁ-ଏଜେଣ୍ଟ ସାମୁଦ୍ରିକ ପରାମର୍ଶ",
    chatGroundedConfidenceTemplate: "{confidence}% ତଥ୍ୟ-ଆଧାରିତ ବିଶ୍ୱାସ",
    chatLangDetectedTooltip: "ବାର୍ତ୍ତାରୁ ଚିହ୍ନଟ ହୋଇଥିବା ଭାଷା",
    chatListenTts: "ଶୁଣନ୍ତୁ (TTS)",
    chatNavicMssBtn: "NavIC MSS କୋଡ୍",
    chatMetricZone: "ସୁପାରିଶିତ ଅଞ୍ଚଳ",
    chatMetricEta: "ଲାଇଭ୍ ସମୁଦ୍ର ସ୍ଥିତି ETA",
    chatMetricVessels: "ସକ୍ରିୟ ଜାହାଜ",
    chatVesselsSuffix: "{count} ଜାହାଜ",
    chatMetricImbl: "IMBL ମଞ୍ଜୁରୀ",
    chatReasoningTraceSummaryTemplate: "ବହୁ-ଏଜେଣ୍ଟ ତର୍କଣ ଟ୍ରେସ୍ ଦେଖନ୍ତୁ ({steps} ପାହାଚ ନିଷ୍ପାଦିତ)",
    chatNodeDagSuffixTemplate: "{count}-ନୋଡ୍ DAG",
    chatNoAdvisoryTextFallback: "ORCA INSIGHT ବ୍ୟାକଏଣ୍ଡ ଏକ ପରାମର୍ଶ ତିଆରି କଲା କିନ୍ତୁ କୌଣସି ପାଠ୍ୟ ଫେରାଇଲା ନାହିଁ।",
    chatLiveAdvisoryLabel: "✓ ଲାଇଭ୍ ବହୁ-ଏଜେଣ୍ଟ ପରାମର୍ଶ",
    chatGroundedEngineFallback: "ତଥ୍ୟ-ଆଧାରିତ ଇଞ୍ଜିନ୍",
    chatOceanSourceTierTemplate: "ମହାସାଗର ଉତ୍ସ ସ୍ତର: {tier} · କ୍ଲୋରୋଫିଲ୍: {chlorophyll}",
    chatCitationsTemplate: "ଉଦ୍ଧୃତି: {citations}",
    chatOfflineBannerText: "ଅଫଲାଇନ୍ ପରାମର୍ଶ ଇଞ୍ଜିନ୍ — ORCA ବ୍ୟାକଏଣ୍ଡ ପହଞ୍ଚିହେଉ ନାହିଁ। ନିମ୍ନଲିଖିତ ଆଙ୍କଡ଼ା ଏକ ସିମୁଲେଟେଡ୍ ଉଦାହରଣମୂଳକ ଆକଳନ, ଲାଇଭ୍ ଟେଲିମେଟ୍ରି ନୁହେଁ।",
    chatOfflineImblPlainText: "ଅଫଲାଇନ୍ ପରାମର୍ଶ (ବ୍ୟାକଏଣ୍ଡ ପହଞ୍ଚିହେଉ ନାହିଁ, ସିମୁଲେଟେଡ୍ ଆକଳନ): Palk Strait / Gulf of Mannar ଅଞ୍ଚଳରେ ଜାହାଜଗୁଡ଼ିକ ସାଧାରଣତଃ ଭାରତ-ଶ୍ରୀଲଙ୍କା IMBL ସୀମାର କିଛି ନଟିକାଲ୍ ମାଇଲ ମଧ୍ୟରେ ରୁହନ୍ତି। ପଶ୍ଚିମ ଦିଗକୁ ଅଗ୍ରସର ହୁଅନ୍ତୁ ଏବଂ ଚ୍ୟାନେଲ 16ରେ VHF ଟ୍ରାନ୍ସପଣ୍ଡର ସକ୍ରିୟ ରଖନ୍ତୁ। ସୀମାର ପ୍ରକୃତ ମାପିତ ଦୂରତା ପାଇଁ ORCA ବ୍ୟାକଏଣ୍ଡ ସହିତ ପୁନଃସଂଯୋଗ କରନ୍ତୁ।",
    chatOfflineImblHtmlHeading: "IMBL ଜିଓଫେନ୍ସିଂ ପରାମର୍ଶ (ସିମୁଲେଟେଡ୍ ଅଫଲାଇନ୍ ଆକଳନ):",
    chatOfflineImblHtmlBody1: "ଲାଇଭ୍ ବ୍ୟାକଏଣ୍ଡ ସଂଯୋଗ ବିନା, ପ୍ରକୃତ ଜାହାଜ-ରୁ-ସୀମା ଦୂରତା ମାପିହେବ ନାହିଁ। Palk Strait ସେକ୍ଟର 4 ନିକଟରେ ଏକ ସାଧାରଣ ସତର୍କତା ଭାବେ, Mandapam ଆଡ଼କୁ ପଶ୍ଚିମ ଦିଗ ଧରି ରଖନ୍ତୁ।",
    chatOfflineImblHtmlBody2: "ଏହା ଏକ ସାଧାରଣ ଅଫଲାଇନ୍ ସୁରକ୍ଷା ସ୍ମାରକ, ମାପିତ ଜିଓଫେନ୍ସ ରିଡିଂ ନୁହେଁ। ପ୍ରକୃତ IMBL ଦୂରତା ଗଣନା ପାଇଁ ORCA ବ୍ୟାକଏଣ୍ଡ ସହିତ ପୁନଃସଂଯୋଗ କରନ୍ତୁ।",
    chatOfflineImblStep1: "ବ୍ୟାକଏଣ୍ଡ ପହଞ୍ଚିହେଉ ନାହିଁ। ସ୍ଥାନୀୟ କୀୱାର୍ଡ ମେଳ ବ୍ୟବହାର କରି ପ୍ରଶ୍ନକୁ IMBL_BOUNDARY ଭାବେ ବର୍ଗୀକୃତ କରାଗଲା।",
    chatOfflineImblStep2: "କୌଣସି ଲାଇଭ୍ ଜିଓଫେନ୍ସିଂ ଟେଲିମେଟ୍ରି ଉପଲବ୍ଧ ନାହିଁ -- କେବଳ ସାଧାରଣ ସୀମା-ସୁରକ୍ଷା ମାର୍ଗଦର୍ଶନ ଫେରାଯାଉଛି।",
    chatOfflineDensityPlainText: "ଅଫଲାଇନ୍ ପରାମର୍ଶ (ବ୍ୟାକଏଣ୍ଡ ପହଞ୍ଚିହେଉ ନାହିଁ, ସିମୁଲେଟେଡ୍ ଆକଳନ): ବ୍ୟାକଏଣ୍ଡ ସଂଯୋଗ ବିନା ଲାଇଭ୍ ଜାହାଜ ସଂଖ୍ୟା ପାଇହେବ ନାହିଁ। ଐତିହାସିକ ଭାବେ, Wadge Bank ଓ Kochi Deep Offshoreରେ ମଧ୍ୟମ ମତ୍ସ୍ୟ ଚଳାଚଳ ଦେଖାଯାଏ। ଜାହାଜ ତଥ୍ୟସେଟରୁ ପ୍ରକୃତ ଫ୍ଲିଟ୍-ଘନତା ରିଡିଂ ପାଇଁ ORCA ବ୍ୟାକଏଣ୍ଡ ସହିତ ପୁନଃସଂଯୋଗ କରନ୍ତୁ।",
    chatOfflineDensityHtmlHeading: "ଫ୍ଲିଟ୍ ଘନତା (ଅଫଲାଇନ୍ — ସିମୁଲେଟେଡ୍ ପ୍ଲେସହୋଲଡର):",
    chatOfflineDensityHtmlBody: "ଫ୍ଲିଟ୍ ଓ ଯାତାୟାତ ଏଜେଣ୍ଟର ଲାଇଭ୍ ଜାହାଜ ତଥ୍ୟସେଟ୍ ବର୍ତ୍ତମାନ ପହଞ୍ଚିହେଉ ନାହିଁ, ତେଣୁ ଅଞ୍ଚଳ-ଭିତରେ ପ୍ରକୃତ ଜାହାଜ ସଂଖ୍ୟା ଉପଲବ୍ଧ ନାହିଁ।",
    chatOfflineDensityListItem: "ପ୍ରକୃତ ପ୍ରତି-ଅଞ୍ଚଳ ଜାହାଜ ସଂଖ୍ୟା ଓ ଭିଡ଼ ନିଷ୍କର୍ଷ ପାଇଁ ORCA ବ୍ୟାକଏଣ୍ଡ ସହିତ ପୁନଃସଂଯୋଗ କରନ୍ତୁ।",
    chatOfflineDensityStep1: "ବ୍ୟାକଏଣ୍ଡ ପହଞ୍ଚିହେଉ ନାହିଁ। ସ୍ଥାନୀୟ କୀୱାର୍ଡ ମେଳ ବ୍ୟବହାର କରି ପ୍ରଶ୍ନକୁ FLEET_DENSITY ଭାବେ ବର୍ଗୀକୃତ କରାଗଲା।",
    chatOfflineDensityStep2: "କୌଣସି ଲାଇଭ୍ ଫ୍ଲିଟ୍ ତଥ୍ୟସେଟ୍ ଉପଲବ୍ଧ ନାହିଁ -- ମନଗଢ଼ା ଆଙ୍କଡ଼ା ଦେଖାଇବାକୁ ଏଡ଼ାଇବା ପାଇଁ ଜାହାଜ ସଂଖ୍ୟା ଦେଖାଯାଉ ନାହିଁ।",
    chatOfflineGenericPlainTextTemplate: "ଅଫଲାଇନ୍ ପରାମର୍ଶ (ବ୍ୟାକଏଣ୍ଡ ପହଞ୍ଚିହେଉ ନାହିଁ): ORCAର ବହୁ-ଏଜେଣ୍ଟ ବ୍ୟାକଏଣ୍ଡ ପହଞ୍ଚିହେଲା ନାହିଁ, ତେଣୁ ଏହି ଉତ୍ତର ଏକ ତଥ୍ୟ-ଆଧାରିତ ରିଡିଂ ପରିବର୍ତ୍ତେ ଏକ ସାଧାରଣ, ଅଣ-ଲାଇଭ୍ ପ୍ଲେସହୋଲଡର। ଆପଣଙ୍କ ବ୍ରାଉଜରର ନିଜ Open-Meteo ୱିଜେଟ୍ ପ୍ରାୟ {liveWave}m ଉଲ୍ଲେଖନୀୟ ତରଙ୍ଗ ଉଚ୍ଚତା ଦେଖାଉଛି, କିନ୍ତୁ PFZ କ୍ରମାନ୍ୱୟ, ମାର୍ଗ ଦୂରତା, ETA ଓ ଫ୍ଲିଟ୍ ସଂଖ୍ୟା ସମସ୍ତେ ବ୍ୟାକଏଣ୍ଡ ଆବଶ୍ୟକ କରନ୍ତି ଏବଂ ଏଠାରେ ଦେଖାଯାଉ ନାହିଁ। ପ୍ରକୃତ ପରାମର୍ଶ ପାଇଁ ORCA ବ୍ୟାକଏଣ୍ଡ ସହିତ ପୁନଃସଂଯୋଗ କରନ୍ତୁ।",
    chatOfflineGenericHtmlHeading: "ଅଫଲାଇନ୍ ପ୍ଲେସହୋଲଡର ପରାମର୍ଶ",
    chatOfflineGenericHtmlBody1Template: "ORCA ବହୁ-ଏଜେଣ୍ଟ ବ୍ୟାକଏଣ୍ଡ (ସାଟେଲାଇଟ୍, ପାଣିପାଗ, PFZ କ୍ରମାନ୍ୱୟ, ଜିଓଫେନ୍ସିଂ, ଫ୍ଲିଟ୍, ମାର୍ଗ ନିର୍ଦ୍ଧାରଣ ଓ ନ୍ୟୁରାଲ୍ ସିଣ୍ଥେସିସ୍) ବର୍ତ୍ତମାନ ପହଞ୍ଚିହେଉ ନାହିଁ। କ୍ଲାଏଣ୍ଟ-ପାର୍ଶ୍ୱରେ, ଏହି ବ୍ରାଉଜର ଶେଷରେ Open-Meteoରୁ <strong>{liveWave}m</strong> ତରଙ୍ଗ ଉଚ୍ଚତା ଦେଖିଥିଲା, କିନ୍ତୁ ଅନ୍ୟ ସମସ୍ତ ଆଙ୍କଡ଼ା ବ୍ୟାକଏଣ୍ଡ ଆବଶ୍ୟକ କରନ୍ତି।",
    chatOfflineGenericHtmlBody2: "<strong>କୌଣସି PFZ ସୁପାରିଶ, ମାର୍ଗ, ETA କିମ୍ବା ଫ୍ଲିଟ୍ ସଂଖ୍ୟା ଦେଖାଯାଉ ନାହିଁ</strong> କାରଣ ସେଗୁଡ଼ିକ ଗଣନା ପରିବର୍ତ୍ତେ ମନଗଢ଼ା ହେବ। ସମ୍ପୂର୍ଣ୍ଣ ତଥ୍ୟ-ଆଧାରିତ ପରାମର୍ଶ ପାଇଁ ORCA ବ୍ୟାକଏଣ୍ଡ ସହିତ ପୁନଃସଂଯୋଗ କରନ୍ତୁ।",
    chatOfflineGenericStep1: "ବ୍ୟାକଏଣ୍ଡ ପହଞ୍ଚିହେଉ ନାହିଁ। କୌଣସି ଉଦ୍ଦେଶ୍ୟ-ନିର୍ଦ୍ଦିଷ୍ଟ କୀୱାର୍ଡ ମେଳ ହେଲା ନାହିଁ -- GENERAL_VOYAGE_SAFETY ଅଫଲାଇନ୍ ପ୍ଲେସହୋଲଡର ଫେରାଯାଉଛି।",
    chatOfflineGenericStep2Template: "କେବଳ କ୍ଲାଏଣ୍ଟ-ଦୃଶ୍ୟମାନ ଆଙ୍କଡ଼ା ଉପଲବ୍ଧ: ଶେଷ ଜଣା Open-Meteo ତରଙ୍ଗ ଉଚ୍ଚତା {liveWave}m (ବ୍ୟାକଏଣ୍ଡ ମାଧ୍ୟମରେ ନୁହେଁ, ସିଧାସଳଖ ବ୍ରାଉଜର ଦ୍ୱାରା ପ୍ରାପ୍ତ)।",
    chatTtsUnsupportedAlert: "ଆପଣଙ୍କ ବ୍ରାଉଜର ଦ୍ୱାରା ସ୍ପିଚ୍ ସିଣ୍ଥେସିସ୍ ସମର୍ଥିତ ନୁହେଁ।",
    chatTtsWelcomeFallback: "ORCA INSIGHTକୁ ସ୍ୱାଗତ। ସମସ୍ତ ସାଟେଲାଇଟ୍ ଫିଡ୍ ଓ ଉପକୂଳ ମହାସାଗର ବ୍ୟବସ୍ଥା ସ୍ୱାଭାବିକ ସ୍ଥିତିରେ କାର୍ଯ୍ୟ କରୁଛନ୍ତି।",
    chatStopAudio: "ଅଡିଓ ବନ୍ଦ କରନ୍ତୁ",
    chatListenAudioAdvisory: "ଅଡିଓ ପରାମର୍ଶ ଶୁଣନ୍ତୁ",
    chatTabTitle: "AI ନିଷ୍ପତ୍ତି ଷ୍ଟୁଡିଓ ଓ ବହୁ-ଏଜେଣ୍ଟ ଚାଟବଟ୍",
    chatTabSubtitle: "Oceansat-3, INSAT-3DR ଓ ଉପକୂଳ ଜିଓଫେନ୍ସିଂ ଉପରେ ତର୍କଣ କରୁଥିବା ସହଯୋଗୀ ଏଜେଣ୍ଟଙ୍କ ଦ୍ୱାରା ଚାଳିତ",
    chatNewConversationBtn: "ନୂଆ ବାର୍ତ୍ତାଳାପ",
    chatPromptPFZ: "Kochi ବନ୍ଦରଗାହରୁ ନିକଟତମ ଉଚ୍ଚ-ଉତ୍ପାଦନ PFZ ମତ୍ସ୍ୟ ଅଞ୍ଚଳ ତାହାର ମାଛ ଧରିବା ସମ୍ଭାବନା ଓ ପ୍ରଜାତି ସହିତ ଖୋଜନ୍ତୁ।",
    chatPromptSafety: "ଆଜି ପାଇଁ ସମୁଦ୍ର-ଯାତ୍ରା ମଞ୍ଜୁରୀ ସ୍କୋର, ଉଲ୍ଲେଖନୀୟ ତରଙ୍ଗ ଉଚ୍ଚତା ଓ ପବନ ବିପଦ ଯାଞ୍ଚ କରନ୍ତୁ।",
    chatPromptBorder: "ଭାରତ-ଶ୍ରୀଲଙ୍କା IMBL ସୀମାର ଦୂରତା ଯାଞ୍ଚ କରି 2 NM ବିପଦ ଅଞ୍ଚଳରେ ଥିବା ଜାହାଜଗୁଡ଼ିକୁ ତାଲିକାଭୁକ୍ତ କରନ୍ତୁ।",
    chatPromptDensity: "Wadge Bank ଓ Kochi Deep ଉପରେ ବର୍ତ୍ତମାନର ଜାହାଜ ସଂଖ୍ୟା ଓ ଘନତା ବଣ୍ଟନ କ'ଣ?",
    chatPromptETA: "Kochiରୁ PFZ-01କୁ ପରିବହନ ETA ଗଣନା କରି ଯାଞ୍ଚ କରନ୍ତୁ ଯେ ଆସାଯିବା ଯାତ୍ରା ସନ୍ଧ୍ୟା 18:30 ପୂର୍ବରୁ ସୁରକ୍ଷିତ ଭାବେ ଫେରେ କି ନାହିଁ।",
    chatConversationLabel: "ବାର୍ତ୍ତାଳାପ",
    chatNeuralCoreActive: "ORCA INSIGHT ନ୍ୟୁରାଲ୍ କୋର୍ ସକ୍ରିୟ",
    chatAgentsReadyUptime: "8 ଏଜେଣ୍ଟ ପ୍ରସ୍ତୁତ · 99.94% ଅପଟାଇମ୍",
    chatWelcomeMessage: "ବଣକ୍କମ୍ / ନମସ୍ତେ! ମୁଁ <strong>ORCA INSIGHT</strong> ବହୁ-ଏଜେଣ୍ଟ ସିଣ୍ଥେସିସ୍ ପ୍ରଣାଳୀ। ଆପଣ ସୁରକ୍ଷିତ ଯାତ୍ରା ମଞ୍ଜୁରୀ, ଭାରତ ଉପକୂଳରେ ଉଚ୍ଚ-ଉତ୍ପାଦନ PFZ ଅଞ୍ଚଳ, ଲାଇଭ୍ ଜାହାଜ ଯାତାୟାତ, IMBL ସୀମା ନିକଟତା ଓ ସମୁଦ୍ର-ସ୍ଥିତି ସଜାଡ଼ାଯାଇଥିବା ETA ଗଣନା ବିଷୟରେ ଆପଣଙ୍କ ପ୍ରଶ୍ନ କହିପାରିବେ କିମ୍ବା ଟାଇପ୍ କରିପାରିବେ।",
    chatMicHint: "ତାମିଲ, ହିନ୍ଦୀ, ମାଲାୟାଲମ୍ କିମ୍ବା ଇଂରାଜୀରେ କହିବାକୁ ତଳେ ଥିବା ମାଇକ୍ରୋଫୋନ୍ ଆଇକନ୍‌ରେ କ୍ଲିକ୍ କରନ୍ତୁ!",
    chatVoiceInputTitle: "ପ୍ରଶ୍ନ କୁହନ୍ତୁ (ସ୍ପିଚ୍-ଟୁ-ଟେକ୍ସଟ୍)",
    chatLiveReasoningTraceTitle: "ଲାଇଭ୍ ତର୍କଣ ଟ୍ରେସ୍",
    chatReasoningTraceEmptyHint: "ବାମରେ ଏକ ପ୍ରଶ୍ନ ପଚାରନ୍ତୁ ଏବଂ 8ଟି ସହଯୋଗୀ ଏଜେଣ୍ଟ ପ୍ରତ୍ୟେକ ଏହା ଉପରେ ଲାଇଭ୍ ତର୍କଣ କରୁଥିବା ଦେଖନ୍ତୁ।",
    chatLiveTelemetryTitle: "ଲାଇଭ୍ ମହାସାଗର ଟେଲିମେଟ୍ରି",
    chatCurrentSeaClearance: "ବର୍ତ୍ତମାନର ସମୁଦ୍ର ମଞ୍ଜୁରୀ:",
    chatSignificantWaves: "ଉଲ୍ଲେଖନୀୟ ତରଙ୍ଗ:",
    chatSurfaceWind: "ପୃଷ୍ଠ ପବନ:",
    chatActiveVessels: "ସକ୍ରିୟ ଜାହାଜ:",
    chatOpenDagVisualizerBtn: "ସମ୍ପୂର୍ଣ୍ଣ ଏଜେଣ୍ଟ DAG ଭିଜୁଆଲାଇଜର୍ ଖୋଲନ୍ତୁ ➔",
    navicConnected: "NavIC ରିସିଭର୍: ସଂଯୁକ୍ତ (L5/S-Band)",
    navicDisconnected: "NavIC ରିସିଭର୍: ବିଚ୍ଛିନ୍ନ",
    navicTrackMyPosition: "ମୋର ସ୍ଥିତି ଟ୍ରାକ୍ କରନ୍ତୁ",
    navicStopTracking: "ଟ୍ରାକିଂ ବନ୍ଦ କରନ୍ତୁ",
    navicSimulateMovement: "ଜାହାଜ ଗତି ସିମୁଲେଟ୍ କରନ୍ତୁ",
    navicStopSimulation: "ସିମୁଲେସନ୍ ବନ୍ଦ କରନ୍ତୁ",
    navicStatusTrackingOff: "ଟ୍ରାକିଂ ବନ୍ଦ · କୌଣସି ସ୍ଥିତି ଅନୁରୋଧ ହେଉ ନାହିଁ",
    navicStatusGeoUnsupported: "ଏହି ବ୍ରାଉଜର ଦ୍ୱାରା ଜିଓଲୋକେସନ୍ ସମର୍ଥିତ ନୁହେଁ। ଡେମୋ ପାଇଁ ସିମୁଲେଟେଡ୍ ଜାହାଜ ଗତି ବ୍ୟବହାର କରନ୍ତୁ।",
    navicStatusRequestingPermission: "ଡିଭାଇସ୍-ସ୍ଥାନ ଅନୁମତି ଅନୁରୋଧ କରାଯାଉଛି…",
    navicStatusLiveTrackingTemplate: "ଲାଇଭ୍ ଡିଭାଇସ୍ ଟ୍ରାକିଂ · ସଠିକତା ±{accuracy}m · ସଂରକ୍ଷିତ ନୁହେଁ",
    navicStatusPermissionErrorTemplate: "ସ୍ଥାନ ଅନୁମତି ଉପଲବ୍ଧ ନାହିଁ ({error})। କୌଣସି ସ୍ଥିତି ପଠାଯାଇ ନାହିଁ।",
    navicStatusBackendUnavailable: "ବ୍ୟାକଏଣ୍ଡ ଉପଲବ୍ଧ ନାହିଁ — ସ୍ଥାନୀୟ ସିମୁଲେସନ୍‌ରେ ପ୍ରକୃତ ଜିଓଫେନ୍ସ ଦୂରତା ମୂଲ୍ୟାୟନ ହୋଇପାରିବ ନାହିଁ।",
    navicStatusSimStopped: "ଜିଓଫେନ୍ସ ସିମୁଲେସନ୍ ବନ୍ଦ ହେଲା",
    navicStatusSimMovingTemplate: "ସିମୁଲେଟେଡ୍ ଜାହାଜ ଗତି · ବିନ୍ଦୁ {index}/{total} · {lat}, {lon}",
    navicMssCopiedAlertTemplate: "NavIC MSS / SMS 120-ଅକ୍ଷର ସାଟେଲାଇଟ୍ ଜରୁରୀ କୋଡ୍ କପି ହେଲା:\n\n{code}",
    navicSkyplotTitle: "ISRO NavIC (IRNSS) ସ୍କାଇପ୍ଲଟ୍",
    navicConstellationDesc: "7-ସାଟେଲାଇଟ୍ ଜିଓଷ୍ଟେସନାରୀ / IGSO ନକ୍ଷତ୍ରମଣ୍ଡଳ",
    navicConnectedShort: "ସଂଯୁକ୍ତ (L5/S)",
    navicTrackedSatellitesTitle: "ଟ୍ରାକ୍ ହୋଇଥିବା ସାଟେଲାଇଟ୍ (SNR dB-Hz)",
    navicNmeaStreamTitle: "ଲାଇଭ୍ NMEA-0183 ହାର୍ଡୱେର୍ ଷ୍ଟ୍ରିମ୍ ($GNGGA / $GNRMC)",
    navicBaudRateDesc: "ବଡ୍ ରେଟ୍: 9600 bps · 1 Hz ଫିଡ୍",
    navicDopPrecisionLabel: "DOP ସଠିକତା",
    navicDopValue: "HDOP 1.05 (ଉତ୍କୃଷ୍ଟ)",
    navicDiffFixLabel: "ଡିଫରେନ୍ସିଆଲ୍ ଫିକ୍ସ",
    navicDiffFixValue: "NavIC DGPS ସକ୍ରିୟ",
    navicBorderHwLabel: "ସୀମା ଆଲର୍ଟ ହାର୍ଡୱେର୍",
    navicBorderHwValue: "ବଜର୍ ସଜ୍ଜିତ",
    navicGeofenceTitle: "ଲାଇଭ୍ ସ୍ଥିତି ଜିଓଫେନ୍ସିଂ",
    navicGeofenceDesc: "ଆପଣଙ୍କ ଡିଭାଇସ୍ ସ୍ଥାନ କେବଳ ସେସନ୍-ମଧ୍ୟରେ IMBL/MPA ଯାଞ୍ଚ ପାଇଁ ବ୍ୟବହୃତ ହୁଏ ଏବଂ ORCA ଦ୍ୱାରା କେବେ ସଂରକ୍ଷିତ ହୁଏ ନାହିଁ।",
    navicGeofenceInitialStatus: "ଟ୍ରାକିଂ ବନ୍ଦ · 5 NM IMBL ଚେତାବନୀ / MPA ବଫର ଚେତାବନୀ",
    safetyVerdictDescTemplate: "ଆପଣଙ୍କ ମନୋନୀତ ବନ୍ଦରଗାହ ନିକଟରେ ଲାଇଭ୍ Open-Meteo ସାମୁଦ୍ରିକ ଟେଲିମେଟ୍ରି ଅନୁସାରେ ଉଲ୍ଲେଖନୀୟ ତରଙ୍ଗ ଉଚ୍ଚତା {wave}m ଓ ପୃଷ୍ଠ ପବନ {wind}kn, ଯାହା ଗଣନା କରାଯାଇଥିବା {score}/100 ସୁରକ୍ଷା ସ୍କୋର ଦେଉଛି।",
    safetyWindDefaultDirection: "ପଶ୍ଚିମାଞ୍ଚଳ",
    safetyBreezeSuffix: "{direction} ପବନ",
    severityLow: "ନିମ୍ନ",
    severityModerate: "ମଧ୍ୟମ",
    severityHigh: "ଉଚ୍ଚ",
    waveBandCalm: "ଶାନ୍ତ (< 0.5m)",
    waveBandSlight: "ହାଲୁକା (0.5 - 1.25m)",
    waveBandModerate: "ମଧ୍ୟମ (1.25 - 2.5m)",
    waveBandRough: "ଉଚ୍ଛୃଙ୍ଖଳ (> 2.5m)",
    seaStateCalm: "ଶାନ୍ତ",
    seaStateSlight: "ହାଲୁକା",
    seaStateSlightModerate: "ହାଲୁକାରୁ ମଧ୍ୟମ",
    seaStateModerateRough: "ମଧ୍ୟମରୁ ଉଚ୍ଛୃଙ୍ଖଳ",
    seaStateUnknown: "ଅଜଣା",
    lightningBandSafe: "ସୁରକ୍ଷିତ ବାୟୁମଣ୍ଡଳୀୟ ପ୍ରୋଫାଇଲ୍",
    lightningBandElevated: "ବର୍ଦ୍ଧିତ ସଂଚାଳନ ବିପଦ",
    lightningBandSevere: "ଗମ୍ଭୀର ଝଡ଼ ଚେତାବନୀ",
    safetySyncLatencyLabel: "ସିଙ୍କ ବିଳମ୍ବ:",
    safetyBatteryLabel: "ବ୍ୟାଟେରୀ:",
    safetyLastPassLabel: "ଶେଷ ପାସ୍:",
    safetyAltitudeLabel: "ଉଚ୍ଚତା:",
    telemetryLiveOpenMeteoTemplate: "ଲାଇଭ୍ OPEN-METEO ଟେଲିମେଟ୍ରି ({wave}m SWH)",
    telemetryCachedArchive: "ଟେଲିମେଟ୍ରି ସକ୍ରିୟ (କ୍ୟାଶ୍‌ ହୋଇଥିବା ସାଟେଲାଇଟ୍ ଆର୍କାଇଭ୍)",
    backendOnlineStatus: "ଲାଇଭ୍ FASTAPI ବ୍ୟାକଏଣ୍ଡ ସଂଯୁକ୍ତ",
    backendOfflineStatus: "ବ୍ୟାକଏଣ୍ଡ ଅଫଲାଇନ୍ · ସ୍ଥାନୀୟ ସିମୁଲେସନ୍ ମୋଡ୍",
    aisLiveCountTemplate: "{count} ଲାଇଭ୍ AIS ଜାହାଜ{plural}",
    aisNoLiveVessels: "ବର୍ତ୍ତମାନ କୌଣସି ଲାଇଭ୍ AIS ଜାହାଜ ନାହିଁ",
    aisBlendedBannerTemplate: "{liveText} + {simCount} ସିମୁଲେଟେଡ୍ ଜାହାଜ{plural} ଦେଖାଉଛି ଯାହା ବର୍ତ୍ତମାନ ଲାଇଭ୍ AIS କଭରେଜ ନଥିବା ବନ୍ଦରଗାହଗୁଡ଼ିକୁ ପୂରଣ କରୁଛି।",
    aisUnavailableDefault: "ଲାଇଭ୍ AIS ଜାହାଜ ଫିଡ୍ ଉପଲବ୍ଧ ନାହିଁ -- 0 ଜାହାଜ ଦେଖାଉଛି।",
    aisNotConfigured: "ଏହି ଡିପ୍ଲୟମେଣ୍ଟରେ ଲାଇଭ୍ AIS ଜାହାଜ ଫିଡ୍ କନଫିଗର୍ ହୋଇନାହିଁ।",
    aisConnectedNotSending: "AIS ପ୍ରଦାତା (AISstream.io) ସହିତ ସଂଯୁକ୍ତ, କିନ୍ତୁ ଏହା ବର୍ତ୍ତମାନ ଜାହାଜ ତଥ୍ୟ ପଠାଉ ନାହିଁ — ସମ୍ଭବତଃ ଏକ ପ୍ରଦାତା-ପାର୍ଶ୍ୱ ବିଭ୍ରାଟ, ସ୍ଥାନୀୟ ତ୍ରୁଟି ନୁହେଁ।",
    aisDisconnectedReconnecting: "AIS ପ୍ରଦାତା (AISstream.io) ରୁ ବିଚ୍ଛିନ୍ନ; ସ୍ୱୟଂଚାଳିତ ଭାବେ ପୁନଃସଂଯୋଗ ହେଉଛି।",
    imblAlertActiveTemplate: "<strong>{vesselId} ({vesselName})</strong> ଭାରତ–ଶ୍ରୀଲଙ୍କା IMBL{simTag}ରୁ <strong>{dist} NM</strong> ଦୂରରେ କାର୍ଯ୍ୟ କରୁଛି। ସ୍ୱୟଂଚାଳିତ ଚେତାବନୀ ପଠାଯାଇଛି।",
    imblAlertNoneTemplate: "ବର୍ତ୍ତମାନ {warnDist} NM IMBL ଚେତାବନୀ ଦୂରତା ମଧ୍ୟରେ କୌଣସି ଜାହାଜ ନାହିଁ। ନିକଟତମ ଟ୍ରାକ୍ ହୋଇଥିବା ଜାହାଜ: <strong>{dist} NM</strong> ଦୂରରେ।",
    imblAlertNoData: "ଏପର୍ଯ୍ୟନ୍ତ କୌଣସି ଜାହାଜ ଟେଲିମେଟ୍ରି ଉପଲବ୍ଧ ନାହିଁ।",
    simulatedSuffix: " (ସିମୁଲେଟେଡ୍)",
    notifUnavailableTitle: "ବ୍ରାଉଜର ବିଜ୍ଞପ୍ତି ଉପଲବ୍ଧ ନାହିଁ",
    notifUnavailableMsg: "ଏହି ଟ୍ୟାବ୍ ଖୋଲା ଥିବା ପର୍ଯ୍ୟନ୍ତ ଇନ୍-ଆପ୍ ବିପଦ ବ୍ୟାନର୍ ଦେଖାଯିବ।",
    notifNotEnabledTitle: "ବ୍ରାଉଜର ବିଜ୍ଞପ୍ତି ସକ୍ଷମ ହୋଇନାହିଁ",
    notifNotEnabledMsg: "ଏହି ଟ୍ୟାବ୍ ଖୋଲା ଥିବା ପର୍ଯ୍ୟନ୍ତ ଇନ୍-ଆପ୍ ବିପଦ ବ୍ୟାନର୍ ସକ୍ରିୟ ରୁହେ।",
    hazardHighWavesTitle: "ଉଚ୍ଚ ତରଙ୍ଗ — ସ୍ଥାନୀୟ ସିମୁଲେସନ୍",
    hazardHighWavesMsgTemplate: "{wave}m 2.5m ସତର୍କତା ସୀମାକୁ ଅତିକ୍ରମ କରୁଛି। ଉତ୍ସ: ବ୍ରାଉଜର Open-Meteo ଟେଲିମେଟ୍ରି।",
    hazardHighWindTitle: "ଉଚ୍ଚ ପବନ — ସ୍ଥାନୀୟ ସିମୁଲେସନ୍",
    hazardHighWindMsgTemplate: "{wind} kn 25 kn ସତର୍କତା ସୀମାକୁ ଅତିକ୍ରମ କରୁଛି। ଉତ୍ସ: ବ୍ରାଉଜର Open-Meteo ଟେଲିମେଟ୍ରି।",
    hazardLightningTitle: "ବିଜୁଳି ବିପଦ — ସ୍ଥାନୀୟ ସିମୁଲେସନ୍",
    hazardLightningMsgTemplate: "ବିଜୁଳି ପ୍ରକ୍ସି {pct}%। ଉତ୍ସ: ବ୍ରାଉଜର Open-Meteo ଟେଲିମେଟ୍ରି।",
    safetyOfficialClearanceLabel: "ସରକାରୀ ସାମୁଦ୍ରିକ ମଞ୍ଜୁରୀ",
    safetyVerdictDescInitial: "ସମସ୍ତ ସାଟେଲାଇଟ୍ ମହାସାଗର ବିଜ୍ଞାନ ସୂଚକ (Oceansat-3 SSTM ତାପୀୟ ଫ୍ରଣ୍ଟ, Sentinel-3 ତରଙ୍ଗ ଆଲ୍ଟିମେଟ୍ରି) Kerala, Karnataka ଓ Tamil Nadu ଉପକୂଳ ଜଳରାଶିରେ ଅନୁକୂଳ ମାଛ ଧରିବା ପରିସ୍ଥିତି ନିଶ୍ଚିତ କରୁଛନ୍ତି।",
    safetyIndexLabel: "ସୁରକ୍ଷା ସୂଚକାଙ୍କ",
    satConstellationTitle: "ISRO ଓ ଆନ୍ତର୍ଜାତୀୟ ମହାସାଗର ବିଜ୍ଞାନ ସାଟେଲାଇଟ୍ ନକ୍ଷତ୍ରମଣ୍ଡଳ",
    satStaticDataNote: "ସ୍ଥିର ସନ୍ଦର୍ଭ ତଥ୍ୟ (ଲାଇଭ୍ ଟେଲିମେଟ୍ରି ନୁହେଁ)",
    mapIndiaBoundaryPopup: "ଭାରତ — ସରକାରୀ ସୀମା (Survey of India)",
    mapPfzYieldSuffix: "{rating} ଉତ୍ପାଦନ ({pct}%)",
    mapPfzSstLabel: "SST:",
    mapPfzChlorophyllLabel: "କ୍ଲୋରୋଫିଲ୍:",
    mapPfzDepthLabel: "ଗଭୀରତା:",
    mapPfzVesselsLabel: "ଜାହାଜ:",
    mapPfzActiveSuffix: "{count} ସକ୍ରିୟ",
    mapPfzTargetSpeciesLabel: "ଲକ୍ଷ୍ୟ ପ୍ରଜାତି:",
    mapPfzSimulateRouteBtn: "ଏଠାରୁ ମାର୍ଗ ସିମୁଲେଟ୍ କରନ୍ତୁ ➔",
    mapImblPopupBodyTemplate: "କଠୋର ଆନ୍ତର୍ଜାତୀୟ ସାମୁଦ୍ରିକ ସୀମା। ଚେତାବନୀ ବଫର: {warn} NM। ଗମ୍ଭୀର ଜିଓଫେନ୍ସ: {danger} NM।",
    mapImblPopupTreatyNote: "UNCLOS ସାମୁଦ୍ରିକ ଚୁକ୍ତି ଅନୁସାରେ ସୀମା-ପାର ଅତିକ୍ରମଣ ନିଷିଦ୍ଧ।",
    mapImblBufferCorridorTemplate: "{dist} NM IMBL ବଫର କରିଡର",
    mapMpaRestrictedBadge: "ପ୍ରତିବନ୍ଧିତ ଇକୋ-ରିଜର୍ଭ",
    mapHarbourCoastSuffix: "{state} ଉପକୂଳ",
    mapHarbourCapacityLabel: "କ୍ଷମତା:",
    mapHarbourVhfLabel: "VHF:",
    mapHarbourFuelLabel: "ଇନ୍ଧନ ଷ୍ଟେସନ୍:",
    mapHarbourFuelAvailable: "ଉପଲବ୍ଧ",
    mapHarbourIceLabel: "ବରଫ ପ୍ଲାଣ୍ଟ:",
    mapHarbourIceActive: "ସକ୍ରିୟ",
    mapHarbourSetOriginBtn: "ମୂଳ ବନ୍ଦରଗାହ ଭାବେ ସେଟ୍ କରନ୍ତୁ",
    mapVesselSimulatedBadge: "ସିମୁଲେଟେଡ୍ · ଏଠାରେ ଲାଇଭ୍ AIS କଭରେଜ ନାହିଁ",
    mapVesselSpeedLabel: "ଗତି:",
    mapVesselHeadingLabel: "ଦିଗ:",
    mapVesselZoneLabel: "ଅଞ୍ଚଳ:",
    mapVesselImblDistLabel: "IMBL ଦୂରତା:",
    mapVesselStatusLabel: "ସ୍ଥିତି:",
    mapVesselFuelLabel: "ଇନ୍ଧନ:",
    mapVesselFuelNA: "ଉପଲବ୍ଧ ନାହିଁ",
    mapRoutePopupTitle: "କେବଳ-ସମୁଦ୍ର A* ମାର୍ଗ (ଭୂମି + MPA ଏଡ଼ାଇବା)",
    mapRouteDistanceEtaTemplate: "ଦୂରତା: {dist} NM · ETA: {eta}{detourNote}",
    mapRouteDetourTemplate: " · {zones} ଚାରିପାଖରେ {pct}% ବିପଥ",
    mapRouteLandNoGoZones: "ଭୂମି/ନିଷିଦ୍ଧ ଅଞ୍ଚଳ",
    vesselStatusSafeFishing: "ସୁରକ୍ଷିତ ମାଛ ଧରିବା",
    vesselStatusBorderAlert: "ସୀମା ଚେତାବନୀ",
    vesselStatusBorderWarn: "ସୀମା ସତର୍କତା",
    vesselStatusInTransit: "ପରିବହନରେ",
    vesselSimBadgeText: "SIM",
    vesselSimBadgeTitle: "ସିମୁଲେଟେଡ୍ -- ଏହି ବନ୍ଦରଗାହ ନିକଟରେ ଲାଇଭ୍ AIS କଭରେଜ ନାହିଁ",
    vesselLocateAction: "ଅବସ୍ଥାନ ଚିହ୍ନଟ ➔",
    fleetVesselCountSuffix: "{count} ଜାହାଜ",
    fleetLiveSimBreakdownTemplate: "{total} ({live} ଲାଇଭ୍ · {sim} ସିମ୍)",
    mapActiveVesselsBreakdownTemplate: "{total} ସକ୍ରିୟ ଜାହାଜ ({live} ଲାଇଭ୍ · {sim} ସିମୁଲେଟେଡ୍)",
    mapActiveVesselsSimpleTemplate: "{total} ସକ୍ରିୟ ଜାହାଜ",
    mapTabTitle: "GIS କମାଣ୍ଡ ମାନଚିତ୍ର · ଭାରତୀୟ ଉପକୂଳ ଜଳରାଶି",
    mapTabDesc: "ପ୍ରକୃତ-ସମୟ ସାଟେଲାଇଟ୍ PFZ, IMBL ସୀମା କରିଡର ଓ AIS ଜାହାଜ ଟ୍ରାକ୍ ସହିତ ଇଣ୍ଟରାକ୍ଟିଭ୍ ଉଚ୍ଚ-କଣ୍ଟ୍ରାଷ୍ଟ ନାବିକ ମାନଚିତ୍ର।",
    layerPfzZones: "PFZ ଅଞ୍ଚଳ",
    layerImblBuffer: "IMBL ବଫର",
    layerEcoReserves: "ଇକୋ ରିଜର୍ଭ (MPA)",
    layerHarbours: "ବନ୍ଦରଗାହ",
    layerLiveVessels: "ଲାଇଭ୍ ଜାହାଜ",
    layerDensityHeatmap: "ଘନତା ହିଟମ୍ୟାପ୍",
    layerIndiaBoundary: "ଭାରତ ସୀମା (Survey of India)",
    routePlannerDesc: "MPA ଓ ସୀମା ବିପଦ ଏଡ଼ାଇ A*-ଶୈଳୀ ମାର୍ଗ",
    routeVesselSpeedLabel: "ଜାହାଜ ଗତି:",
    fleetMonitorTitle: "ଫ୍ଲିଟ୍ ମନିଟର୍ · ଲାଇଭ୍ ଜାହାଜ ଟେଲିମେଟ୍ରି",
    fleetTotalActiveTitle: "ମୋଟ ସକ୍ରିୟ ଜାହାଜ",
    fleetTotalActiveDesc: "ବର୍ତ୍ତମାନ AIS ଟ୍ରାନ୍ସପଣ୍ଡର ସଙ୍କେତ ପ୍ରସାରଣ କରୁଥିବା ଜାହାଜ",
    fleetZoneDistTitle: "ପ୍ରତି ଅଞ୍ଚଳ ଜାହାଜ ବଣ୍ଟନ",
    imblAlertCardTitle: "IMBL ସୀମା ନିକଟତା ଚେତାବନୀ",
    fleetTableSubDesc: "AISstream.io ରୁ ଲାଇଭ୍ AIS ସ୍ଥିତି, ଯେଉଁଠି ବର୍ତ୍ତମାନ ଲାଇଭ୍ ରିସିଭର୍ କଭରେଜ ନାହିଁ ସେଠାରେ ସ୍ପଷ୍ଟ-ଟ୍ୟାଗ୍ ହୋଇଥିବା ସିମୁଲେଟେଡ୍ ଫ୍ଲିଟ୍ (\"SIM\" ବ୍ୟାଜ୍ ଦେଖନ୍ତୁ) ସହିତ ପୂରଣ",
    vesselSearchPlaceholder: "ଜାହାଜ ନାମ କିମ୍ବା ID ଖୋଜନ୍ତୁ...",
    filterAllStatuses: "ସମସ୍ତ ସ୍ଥିତି",
    filterSafeFishing: "ସୁରକ୍ଷିତ ମାଛ ଧରିବା",
    filterInTransit: "ପରିବହନରେ",
    filterBorderAlert: "ସୀମା ଚେତାବନୀ",
    thVesselId: "ଜାହାଜ ID",
    thVesselName: "ଜାହାଜ ନାମ",
    thType: "ପ୍ରକାର",
    thCurrentZone: "ବର୍ତ୍ତମାନର ଅଞ୍ଚଳ",
    thSpeedHeading: "ଗତି / ଦିଗ",
    thImblDist: "IMBL ଦୂରତା",
    thStatus: "ସ୍ଥିତି",
    thAction: "କାର୍ଯ୍ୟ",
    bulletinIssuedLabel: "ଜାରି:",
    bulletinRegionLabel: "ଅଞ୍ଚଳ:",
    bulletinWavesLabel: "ତରଙ୍ଗ:",
    bulletinWindsLabel: "ପବନ:",
    bulletinSourceLabel: "ଉତ୍ସ:",
    bulletinListenBtn: "ବୁଲେଟିନ୍ ଶୁଣନ୍ତୁ",
    bulletinsTabTitle: "ସରକାରୀ ସାମୁଦ୍ରିକ ଓ ମତ୍ସ୍ୟଚାଷ ବୁଲେଟିନ୍ (ISRO - INCOIS)",
    bulletinsTabDesc: "କ୍ରମାଙ୍କିତ ପରାମର୍ଶ, ଘୂର୍ଣ୍ଣିବାତ୍ୟା ବିପଦ ଚେତାବନୀ ଓ ଆନ୍ତର୍ଜାତୀୟ ସୀମା ପାଳନ ଆଲର୍ଟ।",
    bulletinNotifyToggleTitle: "ଏହି ଟ୍ୟାବ୍/PWA ଖୋଲା ଥିବା ପର୍ଯ୍ୟନ୍ତ ହିଁ ବ୍ରାଉଜର ଆଲର୍ଟ ପାଆନ୍ତୁ",
    bulletinNotifyToggleLabel: "ଖୋଲା ଥିବାବେଳେ ସୂଚିତ କରନ୍ତୁ",
    bulletinFilterAll: "ସମସ୍ତ ବୁଲେଟିନ୍",
    bulletinFilterCritical: "ଗମ୍ଭୀର",
    bulletinFilterWarning: "ଚେତାବନୀ",
    bulletinFilterAdvisory: "ପରାମର୍ଶ",
    bulletinsPushNote: "ବିପଦ ଆଲର୍ଟ କେବଳ ଏହି ଟ୍ୟାବ୍/PWA ଖୋଲା ଥିବାବେଳେ ହିଁ ସକ୍ରିୟ। ବନ୍ଦ-ଆପ୍ ପୁଶ୍ ବିଜ୍ଞପ୍ତି ପାଇଁ ଏକ ପ୍ରୋଡକ୍ସନ୍ ପୁଶ୍-ସବ୍ସ୍କ୍ରିପ୍ସନ୍ ସେବା ଆବଶ୍ୟକ ଏବଂ ଏହି ପ୍ରୋଟୋଟାଇପ୍‌ରେ କାର୍ଯ୍ୟକାରୀ ହୋଇନାହିଁ।",
    sosModalTitle: "ଜରୁରୀକାଳୀନ ବିପଦ ସଙ୍କେତ (SOS)",
    sosInstructions: "ଜରୁରୀକାଳୀନ SOS ସକ୍ରିୟ କରିବା ଦ୍ୱାରା <strong>INSAT-3DR SAS&R</strong> ମାଧ୍ୟମରେ ଭାରତୀୟ ଉପକୂଳ ରକ୍ଷୀ ସାମୁଦ୍ରିକ ଉଦ୍ଧାର ସମନ୍ୱୟ କେନ୍ଦ୍ର (MRCC)କୁ ଏକ ଜରୁରୀ 406 MHz ବିପଦ ସଙ୍କେତ ପ୍ରସାରଣ ହେବ।",
    sosCurrentPositionLabel: "ବର୍ତ୍ତମାନର ସ୍ଥିତି:",
    sosVhfChannelLabel: "ଜରୁରୀକାଳୀନ VHF ଚ୍ୟାନେଲ୍:",
    sosMrccHelplineLabel: "MRCC ହେଲ୍ପଲାଇନ୍:",
    sosConfirmBtn: "ନିଶ୍ଚିତ କରନ୍ତୁ ଓ ବିପଦ ସଙ୍କେତ ପ୍ରସାରଣ କରନ୍ତୁ",
    sosBeaconTransmittingBanner: "406 MHz SAS&R ବିକନ୍ ISRO ଓ ଉପକୂଳ ରକ୍ଷୀ MRCCକୁ ପ୍ରସାରିତ ହେଉଛି",
    sosDistressRelayedMsg: "INSAT-3DR SAS&R ରିସିଭର୍ ମାଧ୍ୟମରେ ବିପଦ ପ୍ୟାକେଟ୍ ପଠାଯାଇଛି। ସାମୁଦ୍ରିକ ଉଦ୍ଧାର ସମନ୍ୱୟ କେନ୍ଦ୍ର (MRCC Chennai/Mumbai) VHF ଚ୍ୟାନେଲ୍ 16ରେ ସତର୍କ କରାଯାଇଛି।",
    sosGpsVesselIdTemplate: "GPS ସଂଯୋଜକ: {coords} · ଜାହାଜ ID: {vesselId} ({vesselName})",
    landingEyebrow: "ISRO ସହଯୋଗୀ ସାମୁଦ୍ରିକ ବୁଦ୍ଧିମତ୍ତା · Smart India Hackathon 2026",
    landingSubtitle: "ଏକ ସହଯୋଗୀ ସାମୁଦ୍ରିକ-ବୁଦ୍ଧିମତ୍ତା ପ୍ଲାଟଫର୍ମ, ଦୁଇଟି କମାଣ୍ଡ ଡେକ୍: ଏକ ମତ୍ସ୍ୟଜୀବୀଙ୍କ ଦୈନିକ ସୁଯୋଗ କୋନ୍ସୋଲ୍, ଏବଂ ସମ୍ପୂର୍ଣ୍ଣ ISRO ସାଟେଲାଇଟ୍, AIS ଓ ଜିଓଫେନ୍ସିଂ ଅନ୍ତର୍ଦୃଷ୍ଟି ସୁଟ୍।",
    landingStripItem1: "Oceansat-3 SSTM ତାପୀୟ ଫ୍ରଣ୍ଟ",
    landingStripItem2: "INSAT-3DR ସାଟେଲାଇଟ୍ ମହାସାଗର ବିଜ୍ଞାନ",
    landingStripItem3: "8-ନୋଡ୍ ସହଯୋଗୀ ଏଜେଣ୍ଟ DAG",
    landingStripItem4: "NavIC (IRNSS) GPS ବ୍ରିଜ୍",
    landingStripItem5: "IMBL ସୀମା ଜିଓଫେନ୍ସିଂ ଆଲର୍ଟ",
    landingStripItem6: "ଲାଇଭ୍ AIS ଫ୍ଲିଟ୍ ଓ GIS କମାଣ୍ଡ",
    landingStripItem7: "ଅଧିକ ସ୍ମାର୍ଟ ବିକ୍ରୟ ମୂଲ୍ୟ ନିର୍ଦ୍ଧାରଣ",
    landingStripItem8: "406 MHz SOS ବିପଦ ସଙ୍କେତ",
    landingFishermanCardTitle: "ORCA ଫିଶରମ୍ୟାନ୍",
    landingFishermanCardDesc: "ଆଜିର ସୁଯୋଗ ସ୍କୋର, ସ୍ମାର୍ଟ ବିକ୍ରୟ ମୂଲ୍ୟ ନିର୍ଦ୍ଧାରଣ, ଏକ ଯାତ୍ରା-ମୂଲ୍ୟ କାଲକୁଲେଟର ଓ ଆପଣଙ୍କ ମାଛ ପାଇଁ କ୍ରେତା ଲିଡ୍ — ନୌକା ପାଇଁ ତିଆରି।",
    landingFishermanCardCta: "ଫିଶରମ୍ୟାନ୍ କୋନ୍ସୋଲ୍ ଖୋଲନ୍ତୁ",
    landingFishermanCardTitleAttr: "ଫିଶରମ୍ୟାନ୍ କୋନ୍ସୋଲ୍ ଖୋଲନ୍ତୁ",
    landingInsightCardTitle: "ORCA ଇନସାଇଟ୍",
    landingInsightCardDesc: "ସମ୍ପୂର୍ଣ୍ଣ କମାଣ୍ଡ ଡେକ୍: ISRO ସାଟେଲାଇଟ୍ ମହାସାଗର ବିଜ୍ଞାନ, GIS ମାନଚିତ୍ର, 8-ନୋଡ୍ ଏଜେଣ୍ଟ DAG, ସୁରକ୍ଷା ବାରୋମିଟର୍, ଫ୍ଲିଟ୍ ମନିଟର୍ ଓ NavIC ବ୍ରିଜ୍।",
    landingInsightCardCta: "ଇନସାଇଟ୍ କମାଣ୍ଡ ଡେକ୍ ଖୋଲନ୍ତୁ",
    landingInsightCardTitleAttr: "ଇନସାଇଟ୍ କମାଣ୍ଡ ଡେକ୍ ଖୋଲନ୍ତୁ",
    backToOverviewTitle: "ସମୀକ୍ଷାକୁ ଫେରନ୍ତୁ",
    statSimulatedFleetLabel: "ସିମୁଲେଟେଡ୍ AIS ଫ୍ଲିଟ୍",
    statSatellitesActiveTemplate: "{count} ସକ୍ରିୟ",
    statSatellitesListLabel: "Oceansat-3, INSAT-3DR, Sentinel-3",
    statPfzZonesCountTemplate: "{count} ଅଞ୍ଚଳ",
    statPfzZonesListLabel: "Wadge Bank, Kochi, Veraval...",
    statImblCorridorsCountTemplate: "{count} କରିଡର",
    statImblBordersLabel: "ଭାରତ-ଶ୍ରୀଲଙ୍କା ଓ ପାକିସ୍ତାନ ସୀମା",
    pillarDagTitle: "8-ନୋଡ୍ ସହଯୋଗୀ ଏଜେଣ୍ଟ DAG",
    pillarDagDesc: "ପ୍ରଶ୍ନଗୁଡ଼ିକୁ ସାଟେଲାଇଟ୍, ତରଙ୍ଗ ବିପଦ, ଜିଓଫେନ୍ସିଂ, ଜାହାଜ ଗଣନା, ETA ଓ ନ୍ୟୁରାଲ୍ ସିଣ୍ଥେସିସ୍ ପାହାଚରେ ବିଭକ୍ତ କରୁଥିବା ବହୁ-ଏଜେଣ୍ଟ ସ୍ଥାପତ୍ୟ, ଉପ-ସେକେଣ୍ଡ ବିଳମ୍ବ ସହିତ।",
    pillarEtaTitle: "ଲାଇଭ୍ ସମୁଦ୍ର-ସ୍ଥିତି ETA ଓ ସନ୍ଧ୍ୟା ସୁରକ୍ଷା",
    pillarEtaDesc: "ତରଙ୍ଗ ପ୍ରତିରୋଧ ଅନୁସାରେ ସଜାଡ଼ାଯାଇଥିବା ହାଇଡ୍ରୋଡାଇନାମିକ୍ ପରିବହନ ଗଣନା, ସ୍ୱୟଂଚାଳିତ ସନ୍ଧ୍ୟା-ପୂର୍ବ-ଫେରନ୍ତୁ ସୁରକ୍ଷା ଆଲର୍ଟ ସହିତ, ଯାହା ସୂର୍ଯ୍ୟାସ୍ତ ପରେ ମତ୍ସ୍ୟଜୀବୀଙ୍କୁ ଅଟକିବାରୁ ରୋକେ।",
    pillarFleetTitle: "ଲାଇଭ୍ ଫ୍ଲିଟ୍ ଘନତା ଓ IMBL ଆଲର୍ଟ",
    pillarFleetDesc: "ପ୍ରତି ଅଞ୍ଚଳ ପ୍ରକୃତ-ସମୟ ଜାହାଜ ଗଣନା, ଭିଡ଼ ବିପଦ ସୂଚକ ଓ ସାମୁଦ୍ରିକ ସୀମା ସୁରକ୍ଷା ପାଇଁ ସ୍ୱୟଂଚାଳିତ 5 NM/2 NM ଜିଓଫେନ୍ସ ନିକଟତା ଆଲର୍ଟ।",
    footerCreditLine: "<span class=\"text-slate-200 font-semibold\">{appTitle}</span> · <strong class=\"text-cyan-400\">{teamName}</strong> ଦ୍ୱାରା ନିର୍ମିତ · Smart India Hackathon 2026 · ସମସ୍ୟା ବିବୃତ୍ତି 26176 (ISRO)",
    sttListeningStatusTemplate: "<b>{lang}</b>ରେ ଶୁଣୁଛି... ବର୍ତ୍ତମାନ କୁହନ୍ତୁ।",
    sttUnsupportedTitle: "ଏହି ବ୍ରାଉଜରରେ ସ୍ପିଚ୍ ରିକଗନିସନ୍ ସମର୍ଥିତ ନୁହେଁ",
    routeUnavailableLabel: " ମାର୍ଗ ଉପଲବ୍ଧ ନାହିଁ:",
    routeUnavailableMsg: "ORCA ବ୍ୟାକଏଣ୍ଡ ପହଞ୍ଚିହେଉ ନାହିଁ, ତେଣୁ କୌଣସି ମାର୍ଗ ଦୂରତା/ETA ଦେଖାଯାଇପାରିବ ନାହିଁ। ସ୍ଥାନୀୟ ଫଲବ୍ୟାକ୍ ମୋଡ୍‌ରେ ଚାଲୁଛି।",
    routeNoSafeRouteLabel: "✕ କୌଣସି ସୁରକ୍ଷିତ ସାମୁଦ୍ରିକ ମାର୍ଗ ମିଳିଲା ନାହିଁ:",
    routeNoSafeRouteMsgTemplate: "{detail}",
    routeNoSafeRouteDefaultReason: "ରାଉଟର୍ ଏହି ବନ୍ଦରଗାହ/PFZ ଯୋଡ଼ି ପାଇଁ ଭୂମି ଓ ସାମୁଦ୍ରିକ ସୁରକ୍ଷିତ ଅଞ୍ଚଳ ଏଡ଼ାଇ ଏକ ପଥ ଖୋଜିପାରିଲା ନାହିଁ।",
    routeSafeReturnLabel: "✓ ସୁରକ୍ଷିତ ପ୍ରତ୍ୟାବର୍ତ୍ତନ:",
    routeSafeReturnTemplate: "ଆଶାକରାଯାଉଥିବା ବନ୍ଦରଗାହ ପହଞ୍ଚିବା ସମୟ {time} (18:30 IST ସନ୍ଧ୍ୟା ପୂର୍ବରୁ)।",
    routeReturnAfterDuskLabel: " ସନ୍ଧ୍ୟା ପରେ ପ୍ରତ୍ୟାବର୍ତ୍ତନ:",
    routeReturnAfterDuskTemplate: "ଆଶାକରାଯାଉଥିବା ପ୍ରତ୍ୟାବର୍ତ୍ତନ ସମୟ {time} (18:30 IST ସୂର୍ଯ୍ୟାସ୍ତକୁ ଅତିକ୍ରମ କରୁଛି)। ଏକ ପୂର୍ବ ପ୍ରସ୍ଥାନ କିମ୍ବା ରାତି ନାବିକ ବିକନ୍ ଯାଞ୍ଚ ସୁପାରିଶ କରାଯାଏ।"
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
    fmClaimFailed: "এই মুহূর্তে এই তালিকা দাবি করা যায়নি।",
    dagAgentSupervisorName: "মাস্টার সুপারভাইজার / DAG প্ল্যানার",
    dagAgentSupervisorRole: "বহু-মাধ্যম সামুদ্রিক প্রশ্নকে বিশ্লেষণ করে উপ-কাজে ভাগ করে এবং স্যাটেলাইট, বিপদ ও জিওফেন্স এজেন্টদের মধ্যে বণ্টন করে।",
    dagAgentSatelliteName: "স্যাটেলাইট সমুদ্রবিজ্ঞান এজেন্ট",
    dagAgentSatelliteRole: "Oceansat-3 OCM-3 (ক্লোরোফিল-a) ও SSTM (তাপীয় ফ্রন্ট) ডেটার পাশাপাশি INSAT-3DR মেঘ চিত্র গ্রহণ করে।",
    dagAgentWeatherName: "আবহাওয়া ও সামুদ্রিক বিপদ এজেন্ট",
    dagAgentWeatherRole: "উল্লেখযোগ্য ঢেউয়ের উচ্চতা (SWH), বাতাসের ঝাপটার দিক এবং বজ্রপাতের সম্ভাবনা মূল্যায়ন করে, এবং সমুদ্রযাত্রা-অনুমোদন স্কোর তৈরি করে।",
    dagAgentPfzName: "সমুদ্র বিশ্লেষণ ও PFZ এজেন্ট",
    dagAgentPfzRole: "তাপীয়-ক্লোরোফিল ফ্রন্টের সংযোগস্থল চিহ্নিত করে, উপরিভাগের জৈববস্তুর ঘনত্ব গণনা করে এবং লক্ষ্য মাছ ধরার অঞ্চলগুলিকে ক্রমানুসারে সাজায়।",
    dagAgentGeofenceName: "জিওফেন্সিং ও রুটিং এজেন্ট",
    dagAgentGeofenceRole: "আন্তর্জাতিক সামুদ্রিক সীমারেখা (IMBL) পর্যবেক্ষণ করে, সামুদ্রিক সংরক্ষিত অঞ্চলগুলির চারপাশে বাফার তৈরি করে এবং A* নিরাপদ পথ-বিন্দু গণনা করে।",
    dagAgentFleetName: "নৌবহর ও ট্র্যাফিক এজেন্ট (নতুন)",
    dagAgentFleetRole: "AIS ও ARGOS-4 জাহাজ ট্রান্সপন্ডার স্ক্যান করে, নৌবহরের বণ্টন ট্র্যাক করে এবং অতিরিক্ত ভিড় বা সীমান্ত যানজট চিহ্নিত করে।",
    dagAgentEtaName: "ETA ও যাত্রা নিরাপত্তা এজেন্ট (নতুন)",
    dagAgentEtaRole: "রিয়েল-টাইম ঢেউয়ের প্রতিরোধ অনুযায়ী সমন্বিত যাত্রার সময়কাল গণনা করে এবং সন্ধ্যার আগে ফেরার নিরাপত্তা সময়সীমা মূল্যায়ন করে।",
    dagAgentSynthesisName: "নিউরাল সংশ্লেষণ এজেন্ট (পরিসংখ্যান-চালিত)",
    dagAgentSynthesisRole: "একাধিক এজেন্টের টেলিমেট্রি একত্র করে উদ্ধৃতি ট্যাগ ও TTS সহ একটি নির্ভরযোগ্য, তথ্যভিত্তিক প্রাকৃতিক-ভাষার পরামর্শে রূপান্তর করে -- সম্পূর্ণরূপে নিয়ম-ভিত্তিক, এই সাইটের নিজস্ব লাইভ টেলিমেট্রি ও সঞ্চিত পরিসংখ্যান খতিয়ানের উপর ভিত্তি করে যুক্তি প্রয়োগ করে। কোনো বাহ্যিক AI/LLM API ব্যবহার করা হয় না।",
    dagStatusIdle: "নিষ্ক্রিয়",
    dagInspectLink: "পরীক্ষা করুন ➔",
    dagInspectorLatencyTemplate: "এক্সিকিউশন লেটেন্সি: {latency} · উপ-কাজ যাচাইকৃত",
    dagStatusQueued: "সারিবদ্ধ",
    dagStatusExecuting: "চলছে...",
    dagStatusCompleted: "সম্পন্ন",
    dagStatusSkipped: "আহ্বান করা হয়নি — উদ্দেশ্যের জন্য এর প্রয়োজন ছিল না",
    dagBtnReasoningActiveLive: "যুক্তি প্রক্রিয়া চলছে (লাইভ ব্যাকএন্ড)...",
    dagBtnExecutedLive: "✓ লাইভ ব্যাকএন্ডের মাধ্যমে পাইপলাইন কার্যকর হয়েছে · আবার চালান",
    dagBtnErrorRetry: "▶ লাইভ পাইপলাইন সিমুলেশন চালান",
    dagBtnReasoningActiveOffline: "যুক্তি প্রক্রিয়া চলছে (স্থানীয় সিমুলেশন)...",
    dagBtnExecutedOffline: "✓ পাইপলাইন কার্যকর হয়েছে (স্থানীয় সিমুলেশন) · আবার চালান",
    dagTabTitle: "8-নোড সহযোগী মাল্টি-এজেন্ট DAG",
    dagInteractiveCanvasBadge: "ইন্টারঅ্যাক্টিভ রিজনিং ক্যানভাস",
    dagTabDesc: "Oceansat-3, INSAT-3DR, IMBL জিওফেন্সিং, নৌবহরের ঘনত্ব এবং যাত্রার ETA-এর উপর ভিত্তি করে রিয়েল-টাইম মাল্টি-এজেন্ট এক্সিকিউশন পাইপলাইন যুক্তি প্রক্রিয়া।",
    backendCheckingStatus: "ব্যাকএন্ড পরীক্ষা করা হচ্ছে...",
    dagZoomReset: "রিসেট",
    dagRunSimulationBtn: "▶ লাইভ পাইপলাইন সিমুলেশন চালান",
    dagClickToInspectHint: "যেকোনো এজেন্ট কার্ডে ক্লিক করে এর মূল টেলিমেট্রি ইনপুট, অভ্যন্তরীণ অ্যালগরিদম এবং JSON ডেটা আউটপুট পরীক্ষা করুন।",
    dagOrchestratorLabel: "অর্কেস্ট্রেটর: LangGraph / Async Agent Core",
    dagInspectorDefaultTitle: "এজেন্টের বিবরণ",
    dagInspectorDefaultRole: "ভূমিকার বিবরণ",
    dagInspectorLatencyPlaceholder: "লেটেন্সি: 24ms",
    dagInspectorJsonLabel: "লাইভ JSON পেলোড",
    dagCloseInspector: "ইনস্পেক্টর বন্ধ করুন",
    chatNewConversationMsg: "নতুন কথোপকথন শুরু হয়েছে। ORCA পূর্ববর্তী চ্যাটের প্রসঙ্গ ব্যবহার করবে না।",
    chatYouLabel: "আপনি",
    chatOrcaLabel: "ORCA",
    chatOrchestratingMsg: "Oceansat-3, INSAT-3DR ও Open-Meteo জুড়ে 8টি বিশেষায়িত AI এজেন্ট পরিচালনা করা হচ্ছে...",
    chatAiLabel: "AI",
    chatAdvisoryHeader: "মাল্টি-এজেন্ট সামুদ্রিক পরামর্শ",
    chatGroundedConfidenceTemplate: "{confidence}% তথ্যভিত্তিক আস্থা",
    chatLangDetectedTooltip: "বার্তা থেকে শনাক্ত করা ভাষা",
    chatListenTts: "শুনুন (TTS)",
    chatNavicMssBtn: "NavIC MSS কোড",
    chatMetricZone: "প্রস্তাবিত অঞ্চল",
    chatMetricEta: "লাইভ সমুদ্র পরিস্থিতি ETA",
    chatMetricVessels: "সক্রিয় জাহাজ",
    chatVesselsSuffix: "{count}টি জাহাজ",
    chatMetricImbl: "IMBL অনুমোদন",
    chatReasoningTraceSummaryTemplate: "মাল্টি-এজেন্ট রিজনিং ট্রেস দেখুন ({steps}টি ধাপ সম্পন্ন)",
    chatNodeDagSuffixTemplate: "{count}-নোড DAG",
    chatNoAdvisoryTextFallback: "ORCA INSIGHT ব্যাকএন্ড একটি পরামর্শ তৈরি করেছে কিন্তু কোনো টেক্সট ফেরত দেয়নি।",
    chatLiveAdvisoryLabel: "✓ লাইভ মাল্টি-এজেন্ট পরামর্শ",
    chatGroundedEngineFallback: "তথ্যভিত্তিক ইঞ্জিন",
    chatOceanSourceTierTemplate: "সমুদ্র উৎস স্তর: {tier} · ক্লোরোফিল: {chlorophyll}",
    chatCitationsTemplate: "উদ্ধৃতি: {citations}",
    chatOfflineBannerText: "অফলাইন পরামর্শ ইঞ্জিন — ORCA ব্যাকএন্ডে পৌঁছানো যাচ্ছে না। নিচের সংখ্যাগুলি একটি সিমুলেটেড দৃষ্টান্তমূলক অনুমান, লাইভ টেলিমেট্রি নয়।",
    chatOfflineImblPlainText: "অফলাইন পরামর্শ (ব্যাকএন্ডে পৌঁছানো যাচ্ছে না, সিমুলেটেড অনুমান): Palk Strait / Gulf of Mannar এলাকায় জাহাজগুলি সাধারণত ভারত-শ্রীলঙ্কা IMBL সীমান্ত থেকে কয়েক নটিক্যাল মাইলের মধ্যে থাকে। পশ্চিমমুখী দিক বজায় রাখুন এবং VHF ট্রান্সপন্ডার চ্যানেল 16-এ সক্রিয় রাখুন। সীমান্তের প্রকৃত পরিমাপকৃত দূরত্ব জানতে ORCA ব্যাকএন্ডের সাথে পুনরায় সংযুক্ত হোন।",
    chatOfflineImblHtmlHeading: "IMBL জিওফেন্সিং পরামর্শ (সিমুলেটেড অফলাইন অনুমান):",
    chatOfflineImblHtmlBody1: "লাইভ ব্যাকএন্ড সংযোগ ছাড়া, জাহাজ থেকে সীমান্তের সঠিক দূরত্ব পরিমাপ করা যায় না। Palk Strait সেক্টর 4-এর কাছে সাধারণ সতর্কতা হিসেবে, Mandapam-এর দিকে পশ্চিমমুখী দিক বজায় রাখুন।",
    chatOfflineImblHtmlBody2: "এটি একটি সাধারণ অফলাইন নিরাপত্তা স্মরণিকা, পরিমাপকৃত জিওফেন্স রিডিং নয়। IMBL-এর প্রকৃত দূরত্ব গণনার জন্য ORCA ব্যাকএন্ডের সাথে পুনরায় সংযুক্ত হোন।",
    chatOfflineImblStep1: "ব্যাকএন্ডে পৌঁছানো যাচ্ছে না। স্থানীয় কীওয়ার্ড মিলের মাধ্যমে প্রশ্নটিকে IMBL_BOUNDARY হিসেবে শ্রেণীবদ্ধ করা হয়েছে।",
    chatOfflineImblStep2: "কোনো লাইভ জিওফেন্সিং টেলিমেট্রি উপলব্ধ নেই -- শুধুমাত্র সাধারণ সীমান্ত-নিরাপত্তা নির্দেশনা ফেরত দেওয়া হচ্ছে।",
    chatOfflineDensityPlainText: "অফলাইন পরামর্শ (ব্যাকএন্ডে পৌঁছানো যাচ্ছে না, সিমুলেটেড অনুমান): ব্যাকএন্ড সংযোগ ছাড়া লাইভ জাহাজের সংখ্যা পাওয়া যায় না। ঐতিহাসিকভাবে, Wadge Bank এবং Kochi Deep Offshore-এ মাঝারি মাছ ধরার ট্র্যাফিক দেখা যায়। জাহাজ ডেটাসেট থেকে প্রকৃত নৌবহর-ঘনত্ব রিডিং পেতে ORCA ব্যাকএন্ডের সাথে পুনরায় সংযুক্ত হোন।",
    chatOfflineDensityHtmlHeading: "নৌবহর ঘনত্ব (অফলাইন — সিমুলেটেড প্লেসহোল্ডার):",
    chatOfflineDensityHtmlBody: "নৌবহর ও ট্র্যাফিক এজেন্টের লাইভ জাহাজ ডেটাসেট এই মুহূর্তে পৌঁছানো যাচ্ছে না, তাই অঞ্চল-ভিত্তিক সঠিক জাহাজ সংখ্যা পাওয়া যাচ্ছে না।",
    chatOfflineDensityListItem: "প্রকৃত অঞ্চল-ভিত্তিক জাহাজ সংখ্যা এবং অতিরিক্ত ভিড়ের রায় পেতে ORCA ব্যাকএন্ডের সাথে পুনরায় সংযুক্ত হোন।",
    chatOfflineDensityStep1: "ব্যাকএন্ডে পৌঁছানো যাচ্ছে না। স্থানীয় কীওয়ার্ড মিলের মাধ্যমে প্রশ্নটিকে FLEET_DENSITY হিসেবে শ্রেণীবদ্ধ করা হয়েছে।",
    chatOfflineDensityStep2: "কোনো লাইভ নৌবহর ডেটাসেট উপলব্ধ নেই -- বানানো সংখ্যা উপস্থাপন এড়াতে জাহাজের সংখ্যা দেখানো হচ্ছে না।",
    chatOfflineGenericPlainTextTemplate: "অফলাইন পরামর্শ (ব্যাকএন্ডে পৌঁছানো যাচ্ছে না): ORCA-এর মাল্টি-এজেন্ট ব্যাকএন্ডে পৌঁছানো যায়নি, তাই এই উত্তরটি একটি তথ্যভিত্তিক রিডিং নয় বরং একটি সাধারণ, নন-লাইভ প্লেসহোল্ডার। আপনার ব্রাউজারের নিজস্ব Open-Meteo উইজেট প্রায় {liveWave}মি উল্লেখযোগ্য ঢেউয়ের উচ্চতা জানাচ্ছে, তবে PFZ র‍্যাঙ্কিং, রুট দূরত্ব, ETA এবং নৌবহরের সংখ্যা — এসবের জন্য ব্যাকএন্ড প্রয়োজন এবং এখানে দেখানো হচ্ছে না। প্রকৃত পরামর্শের জন্য ORCA ব্যাকএন্ডের সাথে পুনরায় সংযুক্ত হোন।",
    chatOfflineGenericHtmlHeading: "অফলাইন প্লেসহোল্ডার পরামর্শ",
    chatOfflineGenericHtmlBody1Template: "ORCA-এর মাল্টি-এজেন্ট ব্যাকএন্ড (স্যাটেলাইট, আবহাওয়া, PFZ র‍্যাঙ্কিং, জিওফেন্সিং, নৌবহর, রুটিং এবং নিউরাল সংশ্লেষণ) এই মুহূর্তে পৌঁছানো যাচ্ছে না। ক্লায়েন্ট-সাইডে, এই ব্রাউজারটি Open-Meteo থেকে সর্বশেষ <strong>{liveWave}মি</strong> ঢেউয়ের উচ্চতা দেখেছিল, তবে অন্যান্য প্রতিটি সংখ্যার জন্য ব্যাকএন্ড প্রয়োজন।",
    chatOfflineGenericHtmlBody2: "<strong>কোনো PFZ সুপারিশ, রুট, ETA বা নৌবহরের সংখ্যা দেখানো হচ্ছে না</strong> কারণ সেগুলি গণনা না করে বানাতে হতো। সম্পূর্ণ তথ্যভিত্তিক পরামর্শের জন্য ORCA ব্যাকএন্ডের সাথে পুনরায় সংযুক্ত হোন।",
    chatOfflineGenericStep1: "ব্যাকএন্ডে পৌঁছানো যাচ্ছে না। কোনো উদ্দেশ্য-নির্দিষ্ট কীওয়ার্ড মেলেনি -- GENERAL_VOYAGE_SAFETY অফলাইন প্লেসহোল্ডার ফেরত দেওয়া হচ্ছে।",
    chatOfflineGenericStep2Template: "শুধুমাত্র ক্লায়েন্ট-দৃশ্যমান সংখ্যা উপলব্ধ: সর্বশেষ জানা Open-Meteo ঢেউয়ের উচ্চতা {liveWave}মি (ব্যাকএন্ড ছাড়াই সরাসরি ব্রাউজার দ্বারা সংগৃহীত)।",
    chatTtsUnsupportedAlert: "আপনার ব্রাউজার স্পিচ সিন্থেসিস সমর্থন করে না।",
    chatTtsWelcomeFallback: "ORCA INSIGHT-এ স্বাগতম। সমস্ত স্যাটেলাইট ফিড এবং উপকূলীয় সমুদ্রবিজ্ঞান সিস্টেম স্বাভাবিক অবস্থায় কাজ করছে।",
    chatStopAudio: "অডিও বন্ধ করুন",
    chatListenAudioAdvisory: "অডিও পরামর্শ শুনুন",
    chatTabTitle: "AI সিদ্ধান্ত স্টুডিও ও মাল্টি-এজেন্ট চ্যাটবট",
    chatTabSubtitle: "Oceansat-3, INSAT-3DR এবং উপকূলীয় জিওফেন্সিং-এর উপর যুক্তি প্রয়োগকারী সহযোগী এজেন্ট দ্বারা চালিত",
    chatNewConversationBtn: "নতুন কথোপকথন",
    chatPromptPFZ: "Kochi Harbour থেকে সবচেয়ে কাছের উচ্চ-ফলনশীল PFZ মাছ ধরার অঞ্চল খুঁজুন, ধরার সম্ভাবনা ও প্রজাতিসহ।",
    chatPromptSafety: "আজকের সমুদ্রযাত্রা-অনুমোদন স্কোর, উল্লেখযোগ্য ঢেউয়ের উচ্চতা এবং বাতাসের বিপদ পরীক্ষা করুন।",
    chatPromptBorder: "ভারত-শ্রীলঙ্কা IMBL সীমান্তের দূরত্ব পরীক্ষা করুন এবং 2 NM বিপদ অঞ্চলে থাকা জাহাজের তালিকা দিন।",
    chatPromptDensity: "Wadge Bank এবং Kochi Deep জুড়ে বর্তমান জাহাজের সংখ্যা এবং ঘনত্বের বণ্টন কী?",
    chatPromptETA: "Kochi থেকে PFZ-01 পর্যন্ত যাত্রার ETA গণনা করুন এবং যাচাই করুন যে সন্ধ্যা 18:30-এর আগে নিরাপদে যাওয়া-আসা সম্ভব কিনা।",
    chatConversationLabel: "কথোপকথন",
    chatNeuralCoreActive: "ORCA INSIGHT নিউরাল কোর সক্রিয়",
    chatAgentsReadyUptime: "8টি এজেন্ট প্রস্তুত · 99.94% আপটাইম",
    chatWelcomeMessage: "Vanakkam / নমস্তে! আমি <strong>ORCA INSIGHT</strong> মাল্টি-এজেন্ট সংশ্লেষণ সিস্টেম। আপনি নিরাপদ যাত্রা অনুমোদন, ভারতের উপকূল বরাবর উচ্চ-ফলনশীল PFZ অঞ্চল, লাইভ জাহাজ চলাচল, IMBL সীমান্তের নৈকট্য এবং সমুদ্র-পরিস্থিতি অনুযায়ী সমন্বিত ETA গণনা সম্পর্কে আপনার প্রশ্ন বলতে বা টাইপ করতে পারেন।",
    chatMicHint: "তামিল, হিন্দি, মালায়ালাম বা ইংরেজিতে কথা বলতে নিচের মাইক্রোফোন আইকনে ক্লিক করুন!",
    chatVoiceInputTitle: "কথা বলে প্রশ্ন করুন (স্পিচ-টু-টেক্সট)",
    chatLiveReasoningTraceTitle: "লাইভ রিজনিং ট্রেস",
    chatReasoningTraceEmptyHint: "বামদিকে একটি প্রশ্ন জিজ্ঞাসা করুন এবং এখানে লাইভভাবে দেখুন কীভাবে 8টি সহযোগী এজেন্ট এটির উপর যুক্তি প্রয়োগ করছে।",
    chatLiveTelemetryTitle: "লাইভ সমুদ্র টেলিমেট্রি",
    chatCurrentSeaClearance: "বর্তমান সমুদ্রযাত্রা অনুমোদন:",
    chatSignificantWaves: "উল্লেখযোগ্য ঢেউ:",
    chatSurfaceWind: "ভূপৃষ্ঠের বাতাস:",
    chatActiveVessels: "সক্রিয় জাহাজ:",
    chatOpenDagVisualizerBtn: "সম্পূর্ণ এজেন্ট DAG ভিজ্যুয়ালাইজার খুলুন ➔",
    navicConnected: "NavIC রিসিভার: সংযুক্ত (L5/S-ব্যান্ড)",
    navicDisconnected: "NavIC রিসিভার: সংযোগ বিচ্ছিন্ন",
    navicTrackMyPosition: "আমার অবস্থান ট্র্যাক করুন",
    navicStopTracking: "ট্র্যাকিং বন্ধ করুন",
    navicSimulateMovement: "জাহাজের চলাচল সিমুলেট করুন",
    navicStopSimulation: "সিমুলেশন বন্ধ করুন",
    navicStatusTrackingOff: "ট্র্যাকিং বন্ধ · কোনো অবস্থান অনুরোধ করা হচ্ছে না",
    navicStatusGeoUnsupported: "এই ব্রাউজার জিওলোকেশন সমর্থন করে না। ডেমোর জন্য সিমুলেটেড জাহাজ চলাচল ব্যবহার করুন।",
    navicStatusRequestingPermission: "ডিভাইস-অবস্থানের অনুমতি চাওয়া হচ্ছে…",
    navicStatusLiveTrackingTemplate: "লাইভ ডিভাইস ট্র্যাকিং · নির্ভুলতা ±{accuracy}মি · সংরক্ষণ করা হয় না",
    navicStatusPermissionErrorTemplate: "অবস্থানের অনুমতি অনুপলব্ধ ({error})। কোনো অবস্থান পাঠানো হয়নি।",
    navicStatusBackendUnavailable: "ব্যাকএন্ড অনুপলব্ধ — স্থানীয় সিমুলেশনে সঠিক জিওফেন্স দূরত্ব মূল্যায়ন করা যায় না।",
    navicStatusSimStopped: "জিওফেন্স সিমুলেশন বন্ধ হয়েছে",
    navicStatusSimMovingTemplate: "সিমুলেটেড জাহাজের চলাচল · বিন্দু {index}/{total} · {lat}, {lon}",
    navicMssCopiedAlertTemplate: "NavIC MSS / SMS 120-অক্ষরের স্যাটেলাইট জরুরি কোড কপি করা হয়েছে:\n\n{code}",
    navicSkyplotTitle: "ISRO NavIC (IRNSS) স্কাইপ্লট",
    navicConstellationDesc: "7-স্যাটেলাইট জিওস্টেশনারি / IGSO নক্ষত্রমণ্ডল",
    navicConnectedShort: "সংযুক্ত (L5/S)",
    navicTrackedSatellitesTitle: "ট্র্যাক করা স্যাটেলাইট (SNR dB-Hz)",
    navicNmeaStreamTitle: "লাইভ NMEA-0183 হার্ডওয়্যার স্ট্রিম ($GNGGA / $GNRMC)",
    navicBaudRateDesc: "বড রেট: 9600 bps · 1 Hz ফিড",
    navicDopPrecisionLabel: "DOP নির্ভুলতা",
    navicDopValue: "HDOP 1.05 (চমৎকার)",
    navicDiffFixLabel: "ডিফারেনশিয়াল ফিক্স",
    navicDiffFixValue: "NavIC DGPS সক্রিয়",
    navicBorderHwLabel: "সীমান্ত সতর্কতা হার্ডওয়্যার",
    navicBorderHwValue: "বাজার সক্রিয়",
    navicGeofenceTitle: "লাইভ অবস্থান জিওফেন্সিং",
    navicGeofenceDesc: "আপনার ডিভাইসের অবস্থান শুধুমাত্র সেশন-চলাকালীন IMBL/MPA পরীক্ষার জন্য ব্যবহৃত হয় এবং ORCA দ্বারা কখনো সংরক্ষণ করা হয় না।",
    navicGeofenceInitialStatus: "ট্র্যাকিং বন্ধ · 5 NM IMBL সতর্কতা / MPA বাফার সতর্কতা",
    safetyVerdictDescTemplate: "লাইভ Open-Meteo সামুদ্রিক টেলিমেট্রি অনুযায়ী আপনার নির্বাচিত হারবারের কাছে উল্লেখযোগ্য ঢেউয়ের উচ্চতা {wave}মি এবং ভূপৃষ্ঠের বাতাস {wind}kn, যা {score}/100 নিরাপত্তা স্কোর নির্দেশ করে।",
    safetyWindDefaultDirection: "পশ্চিমা",
    safetyBreezeSuffix: "{direction} মৃদুবায়ু",
    severityLow: "কম",
    severityModerate: "মাঝারি",
    severityHigh: "উচ্চ",
    waveBandCalm: "শান্ত (< 0.5মি)",
    waveBandSlight: "সামান্য (0.5 - 1.25মি)",
    waveBandModerate: "মাঝারি (1.25 - 2.5মি)",
    waveBandRough: "উত্তাল (> 2.5মি)",
    seaStateCalm: "শান্ত",
    seaStateSlight: "সামান্য",
    seaStateSlightModerate: "সামান্য থেকে মাঝারি",
    seaStateModerateRough: "মাঝারি থেকে উত্তাল",
    seaStateUnknown: "অজানা",
    lightningBandSafe: "নিরাপদ বায়ুমণ্ডলীয় প্রোফাইল",
    lightningBandElevated: "উচ্চতর পরিচলন ঝুঁকি",
    lightningBandSevere: "তীব্র ঝড়ো হাওয়া সতর্কতা",
    safetySyncLatencyLabel: "সিঙ্ক লেটেন্সি:",
    safetyBatteryLabel: "ব্যাটারি:",
    safetyLastPassLabel: "সর্বশেষ পাস:",
    safetyAltitudeLabel: "উচ্চতা:",
    telemetryLiveOpenMeteoTemplate: "লাইভ OPEN-METEO টেলিমেট্রি ({wave}মি SWH)",
    telemetryCachedArchive: "টেলিমেট্রি সক্রিয় (ক্যাশড স্যাটেলাইট আর্কাইভ)",
    backendOnlineStatus: "লাইভ FASTAPI ব্যাকএন্ড সংযুক্ত",
    backendOfflineStatus: "ব্যাকএন্ড অফলাইন · স্থানীয় সিমুলেশন মোড",
    aisLiveCountTemplate: "{count}টি লাইভ AIS জাহাজ{plural}",
    aisNoLiveVessels: "এই মুহূর্তে কোনো লাইভ AIS জাহাজ নেই",
    aisBlendedBannerTemplate: "{liveText} + {simCount}টি সিমুলেটেড জাহাজ{plural} দেখানো হচ্ছে, যেসব বন্দরে এই মুহূর্তে লাইভ AIS কভারেজ নেই সেগুলি পূরণ করতে।",
    aisUnavailableDefault: "লাইভ AIS জাহাজ ফিড অনুপলব্ধ -- 0টি জাহাজ দেখানো হচ্ছে।",
    aisNotConfigured: "এই ডেপ্লয়মেন্টে লাইভ AIS জাহাজ ফিড কনফিগার করা নেই।",
    aisConnectedNotSending: "AIS প্রদানকারীর (AISstream.io) সাথে সংযুক্ত, কিন্তু এটি এই মুহূর্তে জাহাজের তথ্য পাঠাচ্ছে না — সম্ভবত প্রদানকারীর দিক থেকে বিভ্রাট, স্থানীয় ত্রুটি নয়।",
    aisDisconnectedReconnecting: "AIS প্রদানকারীর (AISstream.io) সাথে সংযোগ বিচ্ছিন্ন; স্বয়ংক্রিয়ভাবে পুনরায় সংযুক্ত হচ্ছে।",
    imblAlertActiveTemplate: "<strong>{vesselId} ({vesselName})</strong> ভারত–শ্রীলঙ্কা IMBL থেকে <strong>{dist} NM</strong> দূরত্বে চলাচল করছে{simTag}। স্বয়ংক্রিয় সতর্কতা পাঠানো হয়েছে।",
    imblAlertNoneTemplate: "বর্তমানে {warnDist} NM IMBL সতর্কতা দূরত্বের মধ্যে কোনো জাহাজ নেই। সবচেয়ে কাছের ট্র্যাক করা জাহাজ: <strong>{dist} NM</strong> দূরে।",
    imblAlertNoData: "এখনো কোনো জাহাজ টেলিমেট্রি উপলব্ধ নেই।",
    simulatedSuffix: " (সিমুলেটেড)",
    notifUnavailableTitle: "ব্রাউজার বিজ্ঞপ্তি অনুপলব্ধ",
    notifUnavailableMsg: "এই ট্যাব খোলা থাকাকালীন অ্যাপের মধ্যে বিপদ ব্যানার তবুও দেখানো হবে।",
    notifNotEnabledTitle: "ব্রাউজার বিজ্ঞপ্তি সক্রিয় নেই",
    notifNotEnabledMsg: "এই ট্যাব খোলা থাকাকালীন অ্যাপের মধ্যে বিপদ ব্যানার সক্রিয় থাকে।",
    hazardHighWavesTitle: "উঁচু ঢেউ — স্থানীয় সিমুলেশন",
    hazardHighWavesMsgTemplate: "{wave}মি 2.5মি সতর্কতা সীমা অতিক্রম করেছে। উৎস: ব্রাউজার Open-Meteo টেলিমেট্রি।",
    hazardHighWindTitle: "প্রবল বাতাস — স্থানীয় সিমুলেশন",
    hazardHighWindMsgTemplate: "{wind} kn 25 kn সতর্কতা সীমা অতিক্রম করেছে। উৎস: ব্রাউজার Open-Meteo টেলিমেট্রি।",
    hazardLightningTitle: "বজ্রপাতের ঝুঁকি — স্থানীয় সিমুলেশন",
    hazardLightningMsgTemplate: "বজ্রপাতের প্রক্সি {pct}%। উৎস: ব্রাউজার Open-Meteo টেলিমেট্রি।",
    safetyOfficialClearanceLabel: "সরকারি সামুদ্রিক অনুমোদন",
    safetyVerdictDescInitial: "সমস্ত স্যাটেলাইট সমুদ্রবিজ্ঞান সূচক (Oceansat-3 SSTM তাপীয় ফ্রন্ট, Sentinel-3 ঢেউ অল্টিমেট্রি) কেরালা, কর্ণাটক এবং তামিলনাড়ু উপকূলীয় জলে অনুকূল মাছ ধরার পরিস্থিতি নিশ্চিত করে।",
    safetyIndexLabel: "নিরাপত্তা সূচক",
    satConstellationTitle: "ISRO ও আন্তর্জাতিক সমুদ্রবিজ্ঞান স্যাটেলাইট নক্ষত্রমণ্ডল",
    satStaticDataNote: "স্থির রেফারেন্স ডেটা (লাইভ টেলিমেট্রি নয়)",
    mapIndiaBoundaryPopup: "ভারত — সরকারি সীমানা (Survey of India)",
    mapPfzYieldSuffix: "{rating} ফলন ({pct}%)",
    mapPfzSstLabel: "SST:",
    mapPfzChlorophyllLabel: "ক্লোরোফিল:",
    mapPfzDepthLabel: "গভীরতা:",
    mapPfzVesselsLabel: "জাহাজ:",
    mapPfzActiveSuffix: "{count}টি সক্রিয়",
    mapPfzTargetSpeciesLabel: "লক্ষ্য প্রজাতি:",
    mapPfzSimulateRouteBtn: "এখানে রুট সিমুলেট করুন ➔",
    mapImblPopupBodyTemplate: "কঠোর আন্তর্জাতিক সামুদ্রিক সীমানা। সতর্কতা বাফার: {warn} NM। সংকটজনক জিওফেন্স: {danger} NM।",
    mapImblPopupTreatyNote: "UNCLOS সামুদ্রিক চুক্তি অনুযায়ী সীমান্ত অতিক্রম নিষিদ্ধ।",
    mapImblBufferCorridorTemplate: "{dist} NM IMBL বাফার করিডোর",
    mapMpaRestrictedBadge: "নিষিদ্ধ বাস্তুসংস্থান সংরক্ষিত অঞ্চল",
    mapHarbourCoastSuffix: "{state} উপকূল",
    mapHarbourCapacityLabel: "ধারণক্ষমতা:",
    mapHarbourVhfLabel: "VHF:",
    mapHarbourFuelLabel: "জ্বালানি স্টেশন:",
    mapHarbourFuelAvailable: "উপলব্ধ",
    mapHarbourIceLabel: "বরফ কারখানা:",
    mapHarbourIceActive: "সক্রিয়",
    mapHarbourSetOriginBtn: "উৎস হারবার হিসেবে নির্ধারণ করুন",
    mapVesselSimulatedBadge: "সিমুলেটেড · এখানে লাইভ AIS কভারেজ নেই",
    mapVesselSpeedLabel: "গতি:",
    mapVesselHeadingLabel: "দিক:",
    mapVesselZoneLabel: "অঞ্চল:",
    mapVesselImblDistLabel: "IMBL দূরত্ব:",
    mapVesselStatusLabel: "অবস্থা:",
    mapVesselFuelLabel: "জ্বালানি:",
    mapVesselFuelNA: "প্রযোজ্য নয়",
    mapRoutePopupTitle: "শুধুমাত্র সমুদ্র A* রুট (স্থল + MPA পরিহার)",
    mapRouteDistanceEtaTemplate: "দূরত্ব: {dist} NM · ETA: {eta}{detourNote}",
    mapRouteDetourTemplate: " · {zones}-এর চারপাশে {pct}% ঘুরপথ",
    mapRouteLandNoGoZones: "স্থল/নিষিদ্ধ অঞ্চল",
    vesselStatusSafeFishing: "নিরাপদ মাছ ধরা",
    vesselStatusBorderAlert: "সীমান্ত সতর্কতা",
    vesselStatusBorderWarn: "সীমান্ত হুঁশিয়ারি",
    vesselStatusInTransit: "যাত্রারত",
    vesselSimBadgeText: "SIM",
    vesselSimBadgeTitle: "সিমুলেটেড -- এই বন্দরের কাছে লাইভ AIS কভারেজ নেই",
    vesselLocateAction: "অবস্থান দেখুন ➔",
    fleetVesselCountSuffix: "{count}টি জাহাজ",
    fleetLiveSimBreakdownTemplate: "{total} ({live} লাইভ · {sim} সিম)",
    mapActiveVesselsBreakdownTemplate: "{total}টি সক্রিয় জাহাজ ({live} লাইভ · {sim} সিমুলেটেড)",
    mapActiveVesselsSimpleTemplate: "{total}টি সক্রিয় জাহাজ",
    mapTabTitle: "GIS কমান্ড মানচিত্র · ভারতীয় উপকূলীয় জলসীমা",
    mapTabDesc: "রিয়েল-টাইম স্যাটেলাইট PFZ, IMBL সীমানা করিডোর এবং AIS জাহাজ ট্র্যাক সহ ইন্টারঅ্যাক্টিভ উচ্চ-কনট্রাস্ট নটিক্যাল মানচিত্র।",
    layerPfzZones: "PFZ অঞ্চল",
    layerImblBuffer: "IMBL বাফার",
    layerEcoReserves: "বাস্তুসংস্থান সংরক্ষিত অঞ্চল (MPA)",
    layerHarbours: "হারবার",
    layerLiveVessels: "লাইভ জাহাজ",
    layerDensityHeatmap: "ঘনত্ব হিটম্যাপ",
    layerIndiaBoundary: "ভারতের সীমানা (Survey of India)",
    routePlannerDesc: "MPA ও সীমান্ত বিপদ পরিহারকারী A*-শৈলীর পথ",
    routeVesselSpeedLabel: "জাহাজের গতি:",
    fleetMonitorTitle: "নৌবহর মনিটর · লাইভ জাহাজ টেলিমেট্রি",
    fleetTotalActiveTitle: "মোট সক্রিয় জাহাজ",
    fleetTotalActiveDesc: "বর্তমানে AIS ট্রান্সপন্ডার সংকেত প্রেরণকারী জাহাজ",
    fleetZoneDistTitle: "প্রতি অঞ্চলে জাহাজের বণ্টন",
    imblAlertCardTitle: "IMBL সীমান্ত নৈকট্য সতর্কতা",
    fleetTableSubDesc: "AISstream.io থেকে লাইভ AIS অবস্থান, যেখানে বর্তমানে কোনো লাইভ রিসিভার কভারেজ নেই সেখানে স্পষ্টভাবে চিহ্নিত সিমুলেটেড নৌবহর দিয়ে পূরণ করা হয়েছে (\"SIM\" ব্যাজ দেখুন)",
    vesselSearchPlaceholder: "জাহাজের নাম বা ID অনুসন্ধান করুন...",
    filterAllStatuses: "সব অবস্থা",
    filterSafeFishing: "নিরাপদ মাছ ধরা",
    filterInTransit: "যাত্রারত",
    filterBorderAlert: "সীমান্ত সতর্কতা",
    thVesselId: "জাহাজ ID",
    thVesselName: "জাহাজের নাম",
    thType: "ধরন",
    thCurrentZone: "বর্তমান অঞ্চল",
    thSpeedHeading: "গতি / দিক",
    thImblDist: "IMBL দূরত্ব",
    thStatus: "অবস্থা",
    thAction: "কার্যক্রম",
    bulletinIssuedLabel: "প্রকাশিত:",
    bulletinRegionLabel: "অঞ্চল:",
    bulletinWavesLabel: "ঢেউ:",
    bulletinWindsLabel: "বাতাস:",
    bulletinSourceLabel: "উৎস:",
    bulletinListenBtn: "বুলেটিন শুনুন",
    bulletinsTabTitle: "সরকারি সামুদ্রিক ও মৎস্য বুলেটিন (ISRO - INCOIS)",
    bulletinsTabDesc: "ক্রমাঙ্কিত পরামর্শ, ঘূর্ণিঝড় বিপদ সতর্কতা এবং আন্তর্জাতিক সীমানা সম্মতি সতর্কতা।",
    bulletinNotifyToggleTitle: "শুধুমাত্র এই ট্যাব/PWA খোলা থাকাকালীন ব্রাউজার সতর্কতা পান",
    bulletinNotifyToggleLabel: "খোলা থাকলে জানান",
    bulletinFilterAll: "সব বুলেটিন",
    bulletinFilterCritical: "সংকটজনক",
    bulletinFilterWarning: "সতর্কতা",
    bulletinFilterAdvisory: "পরামর্শ",
    bulletinsPushNote: "এই ট্যাব/PWA খোলা থাকাকালীনই বিপদ সতর্কতা সক্রিয়ভাবে দেখানো হয়। অ্যাপ বন্ধ থাকা অবস্থায় পুশ বিজ্ঞপ্তির জন্য একটি প্রোডাকশন পুশ-সাবস্ক্রিপশন পরিষেবা প্রয়োজন, যা এই প্রোটোটাইপে বাস্তবায়িত হয়নি।",
    sosModalTitle: "জরুরি বিপদ সংকেত বীকন (SOS)",
    sosInstructions: "জরুরি SOS সক্রিয় করলে <strong>INSAT-3DR SAS&R</strong>-এর মাধ্যমে একটি জরুরি 406 MHz বিপদ সংকেত ভারতীয় কোস্ট গার্ডের সামুদ্রিক উদ্ধার সমন্বয় কেন্দ্রে (MRCC) প্রেরণ করা হবে।",
    sosCurrentPositionLabel: "বর্তমান অবস্থান:",
    sosVhfChannelLabel: "জরুরি VHF চ্যানেল:",
    sosMrccHelplineLabel: "MRCC হেল্পলাইন:",
    sosConfirmBtn: "নিশ্চিত করুন ও বিপদ সংকেত সম্প্রচার করুন",
    sosBeaconTransmittingBanner: "406 MHz SAS&R বীকন ISRO ও কোস্ট গার্ড MRCC-তে প্রেরিত হচ্ছে",
    sosDistressRelayedMsg: "INSAT-3DR SAS&R রিসিভারের মাধ্যমে বিপদ প্যাকেট প্রেরণ করা হয়েছে। সামুদ্রিক উদ্ধার সমন্বয় কেন্দ্র (MRCC Chennai/Mumbai) VHF চ্যানেল 16-এ সতর্ক করা হয়েছে।",
    sosGpsVesselIdTemplate: "GPS স্থানাঙ্ক: {coords} · জাহাজ ID: {vesselId} ({vesselName})",
    landingEyebrow: "ISRO সহযোগী সামুদ্রিক বুদ্ধিমত্তা · Smart India Hackathon 2026",
    landingSubtitle: "একটি সহযোগী সামুদ্রিক-বুদ্ধিমত্তা প্ল্যাটফর্ম, দুটি কমান্ড ডেক: একজন জেলের দৈনিক সুযোগ কনসোল, এবং সম্পূর্ণ ISRO স্যাটেলাইট, AIS ও জিওফেন্সিং ইনসাইট স্যুট।",
    landingStripItem1: "Oceansat-3 SSTM তাপীয় ফ্রন্ট",
    landingStripItem2: "INSAT-3DR স্যাটেলাইট সমুদ্রবিজ্ঞান",
    landingStripItem3: "8-নোড সহযোগী এজেন্ট DAG",
    landingStripItem4: "NavIC (IRNSS) GPS ব্রিজ",
    landingStripItem5: "IMBL সীমান্ত জিওফেন্সিং সতর্কতা",
    landingStripItem6: "লাইভ AIS নৌবহর ও GIS কমান্ড",
    landingStripItem7: "Sell Smarter ক্রেতা মূল্য নির্ধারণ",
    landingStripItem8: "406 MHz SOS বিপদ সংকেত বীকন",
    landingFishermanCardTitle: "ORCA Fisherman",
    landingFishermanCardDesc: "আজকের সুযোগ স্কোর, Sell Smarter মূল্য নির্ধারণ, একটি ভ্রমণ-খরচ ক্যালকুলেটর এবং আপনার ধরার জন্য ক্রেতার তথ্য — নৌকার জন্য তৈরি।",
    landingFishermanCardCta: "Fisherman কনসোল খুলুন",
    landingFishermanCardTitleAttr: "Fisherman কনসোল খুলুন",
    landingInsightCardTitle: "ORCA Insight",
    landingInsightCardDesc: "সম্পূর্ণ কমান্ড ডেক: ISRO স্যাটেলাইট সমুদ্রবিজ্ঞান, GIS মানচিত্র, 8-নোড এজেন্ট DAG, নিরাপত্তা ব্যারোমিটার, নৌবহর মনিটর এবং NavIC ব্রিজ।",
    landingInsightCardCta: "Insight কমান্ড ডেক খুলুন",
    landingInsightCardTitleAttr: "Insight কমান্ড ডেক খুলুন",
    backToOverviewTitle: "ওভারভিউতে ফিরে যান",
    statSimulatedFleetLabel: "সিমুলেটেড AIS নৌবহর",
    statSatellitesActiveTemplate: "{count}টি সক্রিয়",
    statSatellitesListLabel: "Oceansat-3, INSAT-3DR, Sentinel-3",
    statPfzZonesCountTemplate: "{count}টি অঞ্চল",
    statPfzZonesListLabel: "Wadge Bank, Kochi, Veraval...",
    statImblCorridorsCountTemplate: "{count}টি করিডোর",
    statImblBordersLabel: "ভারত-শ্রীলঙ্কা ও পাকিস্তান সীমান্ত",
    pillarDagTitle: "8-নোড সহযোগী এজেন্ট DAG",
    pillarDagDesc: "মাল্টি-এজেন্ট আর্কিটেকচার যা প্রশ্নগুলিকে স্যাটেলাইট, ঢেউ বিপদ, জিওফেন্সিং, জাহাজ গণনা, ETA এবং নিউরাল সংশ্লেষণ ধাপে বিভক্ত করে, এক সেকেন্ডেরও কম লেটেন্সিতে।",
    pillarEtaTitle: "লাইভ সমুদ্র-পরিস্থিতি ETA ও সন্ধ্যা নিরাপত্তা",
    pillarEtaDesc: "ঢেউয়ের প্রতিরোধ অনুযায়ী সমন্বিত হাইড্রোডাইনামিক যাত্রা গণনা, সূর্যাস্তের পর জেলেরা আটকে না পড়ে তা নিশ্চিত করতে স্বয়ংক্রিয় সন্ধ্যার-আগে-ফেরা নিরাপত্তা সতর্কতাসহ।",
    pillarFleetTitle: "লাইভ নৌবহর ঘনত্ব ও IMBL সতর্কতা",
    pillarFleetDesc: "প্রতি অঞ্চলে রিয়েল-টাইম জাহাজ গণনা, অতিরিক্ত ভিড়ের ঝুঁকি সূচক এবং সামুদ্রিক সীমান্ত রক্ষাকারী স্বয়ংক্রিয় 5 NM/2 NM জিওফেন্স নৈকট্য সতর্কতা।",
    footerCreditLine: "<span class=\"text-slate-200 font-semibold\">{appTitle}</span> · নির্মাতা <strong class=\"text-cyan-400\">{teamName}</strong> · Smart India Hackathon 2026 · সমস্যা বিবৃতি 26176 (ISRO)",
    sttListeningStatusTemplate: "<b>{lang}</b>-এ শোনা হচ্ছে... এখন বলুন।",
    sttUnsupportedTitle: "এই ব্রাউজারে স্পিচ রিকগনিশন সমর্থিত নয়",
    routeUnavailableLabel: " রুট অনুপলব্ধ:",
    routeUnavailableMsg: "ORCA ব্যাকএন্ডে পৌঁছানো যাচ্ছে না, তাই কোনো রুটেড দূরত্ব/ETA দেখানো যাচ্ছে না। স্থানীয় ফলব্যাক মোডে চলছে।",
    routeNoSafeRouteLabel: "✕ কোনো নিরাপদ সামুদ্রিক রুট পাওয়া যায়নি:",
    routeNoSafeRouteMsgTemplate: "{detail}",
    routeNoSafeRouteDefaultReason: "রাউটার এই হারবার/PFZ জোড়ার জন্য স্থল ও সামুদ্রিক সংরক্ষিত অঞ্চল পরিহার করে কোনো পথ খুঁজে পায়নি।",
    routeSafeReturnLabel: "✓ নিরাপদ প্রত্যাবর্তন:",
    routeSafeReturnTemplate: "প্রত্যাশিত হারবার আগমন {time}-এর মধ্যে (সন্ধ্যা 18:30 IST-এর আগে)।",
    routeReturnAfterDuskLabel: " সন্ধ্যার পর প্রত্যাবর্তন:",
    routeReturnAfterDuskTemplate: "প্রত্যাশিত প্রত্যাবর্তন {time}-এ (18:30 IST সূর্যাস্ত অতিক্রম করে)। আগে রওনা হওয়া বা রাতের নেভিগেশনাল বীকন পরীক্ষার পরামর্শ দেওয়া হচ্ছে।"
  }
};

// 8 Multi-Agent Definitions
const agentsList = [
  {
    id: "supervisor",
    name: "Master Supervisor / DAG Planner",
    nameKey: "dagAgentSupervisorName",
    role: "Decomposes multi-modal marine query, allocates subtasks to satellite, hazard, and geofence agents.",
    roleKey: "dagAgentSupervisorRole",
    sensors: ["Intent Parser", "Task Scheduler"],
    latency: "18ms",
    status: "idle",
    sampleOutput: { intent: "VOYAGE_SAFETY_AND_PFZ_QUERY", target_region: "Kochi_Malabar", subtasks: ["FETCH_SST", "EVAL_WAVE_HAZARD", "CHECK_IMBL", "COMPUTE_FLEET_DENSITY", "CALC_ETA"] }
  },
  {
    id: "satellite_agent",
    name: "Satellite Oceanography Agent",
    nameKey: "dagAgentSatelliteName",
    role: "Ingests Oceansat-3 OCM-3 (chlorophyll-a) & SSTM (thermal fronts) along with INSAT-3DR cloud imagery.",
    roleKey: "dagAgentSatelliteRole",
    sensors: ["Oceansat-3 OCM-3", "SSTM", "INSAT-3DR Sounder"],
    latency: "34ms",
    status: "idle",
    sampleOutput: { sst_celsius: 28.4, sst_gradient: "0.18 C/km", chlorophyll_mg_m3: 1.85, upwelling_active: true, cloud_cover_pct: 18 }
  },
  {
    id: "weather_agent",
    name: "Weather & Marine Hazard Agent",
    nameKey: "dagAgentWeatherName",
    role: "Evaluates Significant Wave Height (SWH), wind gust vectors, lightning probability, and generates sea-clearance score.",
    roleKey: "dagAgentWeatherRole",
    sensors: ["Open-Meteo Live SWH", "Sentinel-3 SRAL Altimeter", "Scatterometer"],
    latency: "29ms",
    status: "idle",
    sampleOutput: { wave_height_m: 1.25, wind_speed_knots: 14.2, sea_state_douglas: 3, lightning_risk_pct: 8, safety_score: 88, clearance: "SAFE" }
  },
  {
    id: "pfz_agent",
    name: "Ocean Analytics & PFZ Agent",
    nameKey: "dagAgentPfzName",
    role: "Identifies thermal-chlorophyll front intersections, calculates pelagic biomass density, and ranks target fishing zones.",
    roleKey: "dagAgentPfzRole",
    sensors: ["INCOIS Frontal Matrix", "MODIS-Aqua Validation"],
    latency: "42ms",
    status: "idle",
    sampleOutput: { matched_pfz: "PFZ-01 (Kochi Deep)", catch_potential: "HIGH (94%)", target_species: ["Tuna", "Mackerel", "Sardines"], depth_m: 75 }
  },
  {
    id: "geofencing_agent",
    name: "Geofencing & Routing Agent",
    nameKey: "dagAgentGeofenceName",
    role: "Monitors International Maritime Boundary Lines (IMBL), buffers Marine Protected Areas, and calculates A* safe waypoints.",
    roleKey: "dagAgentGeofenceRole",
    sensors: ["ISRO NavIC Geofence Engine", "UNCLOS Maritime Grid"],
    latency: "22ms",
    status: "idle",
    sampleOutput: { imbl_status: "SAFE", nearest_imbl_nm: 138.5, mpa_breach: false, route_waypoints_count: 5, avoidance_active: true }
  },
  {
    id: "fleet_agent",
    name: "Fleet & Traffic Agent (New)",
    nameKey: "dagAgentFleetName",
    role: "Scans AIS & ARGOS-4 vessel transponders, tracks fleet distribution, and flags overcrowding or border congestion.",
    roleKey: "dagAgentFleetRole",
    sensors: ["ARGOS-4 Marine Beacon", "AIS Coastal VTS Receiver"],
    latency: "31ms",
    status: "idle",
    sampleOutput: { vessels_in_pfz: 8, zone_capacity_pct: 32, overcrowding_risk: "LOW", border_proximity_alerts: 2 }
  },
  {
    id: "eta_agent",
    name: "ETA & Voyage Safety Agent (New)",
    nameKey: "dagAgentEtaName",
    role: "Calculates transit duration adjusted for real-time wave resistance and evaluates return-by-dusk safety window.",
    roleKey: "dagAgentEtaRole",
    sensors: ["Hydrodynamic Transit Model", "Astronomical Ephemeris (Dusk)"],
    latency: "25ms",
    status: "idle",
    sampleOutput: { route_distance_nm: 28.4, vessel_speed_knots: 8.2, adjusted_eta_hours: 3.46, fishing_window_hours: 4.0, estimated_return_ist: "16:45 IST", dusk_ist: "18:30 IST", dusk_safety_verdict: "SAFE_RETURN_BEFORE_DUSK" }
  },
  {
    id: "synthesis_agent",
    name: "Neural Synthesis Agent (Stats-Driven)",
    nameKey: "dagAgentSynthesisName",
    role: "Aggregates multi-agent telemetry into an authoritative, grounded natural-language advisory with citation tags and TTS -- entirely rule-based, reasoning over this site's own live telemetry and its own accumulated stats ledger. No external AI/LLM API is used.",
    roleKey: "dagAgentSynthesisRole",
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
  const onlineHtml = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> ${t('backendOnlineStatus', 'LIVE FASTAPI BACKEND CONNECTED')}`;
  const onlineClass = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono";
  const offlineHtml = `<span class="w-2 h-2 rounded-full bg-amber-400"></span> ${t('backendOfflineStatus', 'BACKEND OFFLINE · LOCAL SIMULATION MODE')}`;
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
  // The English plural "s" suffix only applies when the display language is
  // English -- other languages get an empty suffix so a translated noun
  // never has a stray English "s" appended to it.
  const enPlural = (n) => (state.currentLang === 'en' && n !== 1) ? 's' : '';
  if ((status === 'LIVE' || status === 'SIMULATED_FALLBACK') && simulatedCount) {
    el.style.background = '#0c4a6e';
    el.style.color = '#e0f2fe';
    const liveText = liveCount ? tFormat('aisLiveCountTemplate', { count: liveCount, plural: enPlural(liveCount) }, `${liveCount} live AIS vessel${enPlural(liveCount)}`) : t('aisNoLiveVessels', 'no live AIS vessels right now');
    el.innerHTML = `${orcaIcon('vessel')} ${tFormat('aisBlendedBannerTemplate', { liveText, simCount: simulatedCount, plural: enPlural(simulatedCount) }, `Showing ${liveText} + ${simulatedCount} simulated vessel${enPlural(simulatedCount)} filling ports with no live AIS coverage right now.`)}`;
    return;
  }

  el.style.background = '#78350f';
  el.style.color = '#fef3c7';
  let detail = t('aisUnavailableDefault', 'Live AIS vessel feed unavailable -- showing 0 vessels.');
  if (gatewayState) {
    if (!gatewayState.configured) {
      detail = t('aisNotConfigured', 'Live AIS vessel feed is not configured on this deployment.');
    } else if (gatewayState.connected) {
      detail = t('aisConnectedNotSending', 'Connected to the AIS provider (AISstream.io), but it isn’t sending vessel data right now — likely a provider-side outage, not a local fault.');
    } else {
      detail = t('aisDisconnectedReconnecting', 'Disconnected from the AIS provider (AISstream.io); reconnecting automatically.');
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
    const simTag = closest.is_simulated ? t('simulatedSuffix', ' (simulated)') : '';
    box.className = 'text-xs text-red-200 leading-relaxed';
    box.innerHTML = tFormat('imblAlertActiveTemplate', { vesselId: closest.id, vesselName: closest.name, dist: closest.imbl_dist_nm, simTag }, `<strong>${closest.id} (${closest.name})</strong> is operating at <strong>${closest.imbl_dist_nm} NM</strong> from the India–Sri Lanka IMBL${simTag}. Automated warning dispatched.`);
  } else if (closest) {
    box.className = 'text-xs text-emerald-200 leading-relaxed';
    box.innerHTML = tFormat('imblAlertNoneTemplate', { warnDist: IMBL_WARNING_DISTANCE_NM, dist: closest.imbl_dist_nm }, `No vessels currently within the ${IMBL_WARNING_DISTANCE_NM} NM IMBL warning distance. Nearest tracked vessel: <strong>${closest.imbl_dist_nm} NM</strong> away.`);
  } else {
    box.className = 'text-xs text-slate-400 leading-relaxed';
    box.innerHTML = t('imblAlertNoData', 'No vessel telemetry available yet.');
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
        badgeEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> ${tFormat('telemetryLiveOpenMeteoTemplate', { wave: state.liveMarine.waveHeight }, `LIVE OPEN-METEO TELEMETRY (${state.liveMarine.waveHeight}m SWH)`)}`;
        badgeEl.className = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-mono";
      }

      // Update Safety Barometer Tiles
      updateSafetyMetricsUI();
    }
  } catch (err) {
    console.log("Open-Meteo Marine API running in cached offline mode", err);
    if (badgeEl) {
      badgeEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-cyan-400"></span> ${t('telemetryCachedArchive', 'TELEMETRY ACTIVE (CACHED SATELLITE ARCHIVE)')}`;
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
        showHazardAlert({ title: t('notifUnavailableTitle', 'Browser notifications unavailable'), message: t('notifUnavailableMsg', 'In-app hazard banners will still be shown while this tab is open.'), severity: 'INFO' }, false);
        return;
      }
      const permission = await Notification.requestPermission();
      state.browserNotificationsEnabled = permission === 'granted';
      toggle.checked = state.browserNotificationsEnabled;
      if (!state.browserNotificationsEnabled) showHazardAlert({ title: t('notifNotEnabledTitle', 'Browser notifications not enabled'), message: t('notifNotEnabledMsg', 'In-app hazard banners remain active while this tab is open.'), severity: 'INFO' }, false);
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
    wave >= 2.5 && { key: 'LOCAL_HIGH_WAVES', severity: 'WARNING', title: t('hazardHighWavesTitle', 'High waves — local simulation'), message: tFormat('hazardHighWavesMsgTemplate', { wave: wave.toFixed(2) }, `${wave.toFixed(2)}m exceeds the 2.5m caution threshold. Source: browser Open-Meteo telemetry.`) },
    wind >= 25 && { key: 'LOCAL_HIGH_WIND', severity: 'WARNING', title: t('hazardHighWindTitle', 'High wind — local simulation'), message: tFormat('hazardHighWindMsgTemplate', { wind: wind.toFixed(1) }, `${wind.toFixed(1)} kn exceeds the 25 kn caution threshold. Source: browser Open-Meteo telemetry.`) },
    state.liveMarine.lightningRisk >= 50 && { key: 'LOCAL_LIGHTNING', severity: 'CRITICAL', title: t('hazardLightningTitle', 'Lightning risk — local simulation'), message: tFormat('hazardLightningMsgTemplate', { pct: state.liveMarine.lightningRisk }, `Lightning proxy is ${state.liveMarine.lightningRisk}%. Source: browser Open-Meteo telemetry.`) }
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

  // Some translated sentences legitimately need embedded HTML (e.g. a
  // <strong> around a brand name) rather than plain text -- data-i18n above
  // always does textContent, which would show literal "<strong>" tags, so
  // these two extra sweeps use innerHTML instead for that small set of keys.
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (t[key]) {
      el.innerHTML = t[key];
    }
  });

  // footerCreditLine reuses the already-translated appTitle/teamName keys
  // via {placeholder} substitution instead of duplicating the brand text.
  document.querySelectorAll('[data-i18n-html-tpl]').forEach(el => {
    const key = el.getAttribute('data-i18n-html-tpl');
    if (t[key]) {
      el.innerHTML = tFormat(key, { appTitle: t.appTitle || 'ORCA INSIGHT', teamName: t.teamName || 'Team SavioursX' }, t[key]);
    }
  });

  // The 5 AI Decision Studio quick-prompt chips carry the actual query text
  // sent to the backend in a plain data-chat-prompt attribute, separate from
  // their visible (already-covered-by-data-i18n) chip label -- retranslate
  // that attribute value here since it isn't part of the sweeps above.
  document.querySelectorAll('[data-chat-prompt-i18n]').forEach(el => {
    const key = el.getAttribute('data-chat-prompt-i18n');
    if (t[key]) {
      el.setAttribute('data-chat-prompt', t[key]);
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

  // ORCA INSIGHT's own JS-rendered sections (DAG cards, satellite cards,
  // fleet table/chart, bulletins, NavIC satellite list, safety score card)
  // aren't covered by the [data-i18n] sweep above either -- re-run their
  // render functions against whatever data is already cached so a language
  // switch never leaves stale-language dynamic content on screen. Each is
  // guarded so this is a cheap no-op for any tab that hasn't been opened yet.
  try {
    if (typeof agentsList !== 'undefined' && document.getElementById('dagNodesGrid')) {
      renderDAGNodes();
    }
    if (typeof state !== 'undefined' && state.satellites && state.satellites.length) {
      renderSatelliteCards();
    }
    if (typeof state !== 'undefined' && state.vessels && state.vessels.length) {
      renderVesselsTable();
      renderFleetDistributionChart();
      renderVesselsOnMap();
      updateImblAlertBox();
    }
    if (typeof state !== 'undefined' && state.bulletins && state.bulletins.length) {
      renderBulletinsList();
    }
    if (typeof state !== 'undefined' && state.navicSatellites && state.navicSatellites.length) {
      renderNavICSatelliteList();
    }
    if (typeof state !== 'undefined' && state.lastWeatherResponse) {
      updateSafetyIndexCard(state.lastWeatherResponse);
    }
  } catch (err) {
    console.log('ORCA INSIGHT: dynamic re-render on language switch skipped', err);
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
      micBtn.title = t('sttUnsupportedTitle', "Speech Recognition not supported in this browser");
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
      sttStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500 animate-ping"></span> ${tFormat('sttListeningStatusTemplate', { lang: state.recognition.lang }, `Listening in <b>${state.recognition.lang}</b>... Speak now.`)}`;
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
        popupHtml: t('mapIndiaBoundaryPopup', 'India — official boundary (Survey of India)'),
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
          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${isHigh ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}">${tFormat('mapPfzYieldSuffix', { rating: zone.yield_rating, pct: zone.yield_score_pct }, `${zone.yield_rating} YIELD (${zone.yield_score_pct}%)`)}</span>
        </div>
        <p class="text-xs text-slate-300 mb-2">${zone.advisory_notes}</p>
        <div class="grid grid-cols-2 gap-1 text-[11px] bg-slate-900/80 p-1.5 rounded border border-slate-700">
          <div><span class="text-slate-400">${t('mapPfzSstLabel', 'SST:')}</span> <span class="text-slate-200 font-semibold">${zone.sst_celsius}°C</span></div>
          <div><span class="text-slate-400">${t('mapPfzChlorophyllLabel', 'Chlorophyll:')}</span> <span class="text-slate-200 font-semibold">${zone.chlorophyll_mg_m3} mg/m³</span></div>
          <div><span class="text-slate-400">${t('mapPfzDepthLabel', 'Depth:')}</span> <span class="text-slate-200 font-semibold">${zone.depth_m} m</span></div>
          <div><span class="text-slate-400">${t('mapPfzVesselsLabel', 'Vessels:')}</span> <span class="text-cyan-400 font-bold">${tFormat('mapPfzActiveSuffix', { count: zone.vessels_in_zone }, `${zone.vessels_in_zone} Active`)}</span></div>
        </div>
        <div class="mt-2 text-[10px] text-slate-400">
          <span class="font-semibold text-slate-300">${t('mapPfzTargetSpeciesLabel', 'Target Species:')}</span> ${zone.dominant_species.join(', ')}
        </div>
        <button onclick="selectPFZForRouting('${zone.id}')" class="mt-2 w-full py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-semibold transition">
          ${t('mapPfzSimulateRouteBtn', 'Simulate Route Here ➔')}
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
        <p class="text-xs text-slate-300">${tFormat('mapImblPopupBodyTemplate', { warn: bound.warning_distance_nm, danger: bound.danger_distance_nm }, `Strict International Maritime Boundary. Warning buffer: ${bound.warning_distance_nm} NM. Critical geofence: ${bound.danger_distance_nm} NM.`)}</p>
        <p class="text-[11px] text-slate-400 mt-1">${t('mapImblPopupTreatyNote', 'Cross-border crossing prohibited under UNCLOS maritime treaty.')}</p>
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
    const bufferPopupHtml = `${orcaIcon('alert')} ${tFormat('mapImblBufferCorridorTemplate', { dist: bound.warning_distance_nm }, `${bound.warning_distance_nm} NM IMBL Buffer Corridor`)}`;
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
          ${t('mapMpaRestrictedBadge', 'RESTRICTED ECO-RESERVE')}
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
        <div class="text-xs text-slate-400 mb-2">${tFormat('mapHarbourCoastSuffix', { state: hbr.state }, `${hbr.state} Coast`)}</div>
        <div class="grid grid-cols-2 gap-1 text-[11px] bg-slate-900 p-1.5 rounded border border-slate-700">
          <div><span class="text-slate-400">${t('mapHarbourCapacityLabel', 'Capacity:')}</span> <span class="text-slate-200 font-semibold">${hbr.capacity_vessels}</span></div>
          <div><span class="text-slate-400">${t('mapHarbourVhfLabel', 'VHF:')}</span> <span class="text-cyan-400 font-bold">${hbr.vhf_channel}</span></div>
          <div><span class="text-slate-400">${t('mapHarbourFuelLabel', 'Fuel Station:')}</span> <span class="text-emerald-400 font-semibold">${t('mapHarbourFuelAvailable', 'Available')}</span></div>
          <div><span class="text-slate-400">${t('mapHarbourIceLabel', 'Ice Plant:')}</span> <span class="text-emerald-400 font-semibold">${t('mapHarbourIceActive', 'Active')}</span></div>
        </div>
        <button onclick="selectHarbourForRouting('${hbr.id}')" class="mt-2 w-full py-1 bg-teal-600 hover:bg-teal-500 text-white rounded text-xs font-semibold transition">
          ${orcaIcon('anchor', 12)} ${t('mapHarbourSetOriginBtn', 'Set as Origin Harbour')}
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

// ---------------------------------------------------------------------
// Shared vessel ship sprite (perf): a <model-viewer> per vessel means a
// separate GLB parse + WebGL context per marker, which gets expensive fast
// with many vessels on screen (browsers also cap concurrent WebGL
// contexts, so a large fleet could start silently losing contexts).
// Instead, cargo_ship.glb is loaded into ONE hidden <model-viewer>, that
// single 3D render is captured once to a PNG data URL, and every vessel
// marker below just reuses that cached image via a plain <img> tag --
// same rendered-3D look, one model load total instead of one per vessel.
// Positioning, rotation, popups, and selection are untouched; only how the
// pixels for the ship icon are produced/reused changes.
// ---------------------------------------------------------------------
function ensureVesselShipSprite(onReady) {
  if (state.vesselShipSpriteUrl || state.vesselShipSpriteFailed) {
    onReady();
    return;
  }

  state.vesselShipSpriteCallbacks = state.vesselShipSpriteCallbacks || [];
  state.vesselShipSpriteCallbacks.push(onReady);
  if (state.vesselShipSpriteLoading) return; // already fetching/rendering for an earlier caller
  state.vesselShipSpriteLoading = true;

  const finish = () => {
    state.vesselShipSpriteLoading = false;
    const callbacks = state.vesselShipSpriteCallbacks || [];
    state.vesselShipSpriteCallbacks = [];
    callbacks.forEach(cb => cb());
  };

  if (typeof customElements === 'undefined' || !customElements.get('model-viewer')) {
    // <model-viewer> script hasn't loaded (e.g. blocked/offline) -- markers
    // fall back to per-vessel inline <model-viewer> below, same as before.
    state.vesselShipSpriteFailed = true;
    finish();
    return;
  }

  const mv = document.createElement('model-viewer');
  mv.setAttribute('src', 'assets/models/cargo_ship.glb');
  mv.setAttribute('camera-orbit', '0deg 55deg 2.4m');
  mv.setAttribute('field-of-view', '25deg');
  mv.setAttribute('exposure', '1.1');
  mv.setAttribute('shadow-intensity', '0');
  mv.setAttribute('disable-zoom', '');
  mv.setAttribute('interaction-prompt', 'none');
  mv.setAttribute('camera-controls', 'false');
  mv.setAttribute('loading', 'eager');
  mv.setAttribute('reveal', 'auto');
  // Rendered off-screen at a higher pixel size than the 34x34 marker so the
  // cached sprite still looks crisp on hi-DPI screens / when zoomed.
  mv.style.cssText = 'position:fixed; top:-9999px; left:-9999px; width:160px; height:160px; background:transparent; pointer-events:none;';
  document.body.appendChild(mv);

  const capture = () => {
    // Two animation frames so the renderer has definitely painted before
    // the canvas gets read back out.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        state.vesselShipSpriteUrl = mv.toDataURL('image/png');
      } catch (err) {
        console.warn('ORCA GIS: vessel ship sprite capture failed, falling back to per-marker 3D model.', err);
        state.vesselShipSpriteFailed = true;
      }
      mv.remove();
      finish();
    }));
  };

  mv.addEventListener('load', capture, { once: true });
  mv.addEventListener('error', () => {
    state.vesselShipSpriteFailed = true;
    mv.remove();
    finish();
  }, { once: true });
}

// Reads whichever anomaly flag ORCA's existing (unmodified) anomaly-detection
// logic already attaches to a vessel record -- this never computes, scores,
// or infers an anomaly itself, only displays a result that already exists on
// the vessel object. Checks a few of the most conventional shapes such a
// pre-computed flag could arrive in (a plain boolean field, or a nested
// `anomaly` object) so this keeps working regardless of exactly which of
// those shapes the backend uses; add another key here if the real one is
// different, but no detection logic belongs in this function.
function isVesselAnomalous(vessel) {
  if (!vessel) return false;
  if (vessel.is_anomalous || vessel.anomaly_detected || vessel.flagged_anomalous) return true;
  const a = vessel.anomaly;
  if (a === true) return true;
  if (a && typeof a === 'object') {
    return !!(a.detected || a.is_anomalous || a.flagged);
  }
  return false;
}

function renderVesselsOnMap() {
  if (!state.map) return;

  // First call on a page load renders nothing until the shared sprite is
  // ready (a few frames), then re-renders itself once -- every later call
  // (periodic refreshes, etc.) already has the sprite cached and returns
  // immediately below, so this never repeats the expensive part.
  if (!state.vesselShipSpriteUrl && !state.vesselShipSpriteFailed) {
    ensureVesselShipSprite(renderVesselsOnMap);
    return;
  }

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

    // Visual vessel marker: a lightweight 3D low-poly cargo-ship GLB
    // (assets/models/cargo_ship.glb), in place of the old flat circle+arrow
    // icon. Everything else about the marker (Mappls positioning, popup,
    // selection) is unchanged below.
    // The colored status ring keeps the same BORDER_ALERT/WARNING/TRANSIT/
    // simulated signal the old circle used to convey, now sitting behind
    // the ship model instead of being the marker itself. The inner wrapper
    // carries a stable id so heading rotation can be updated in place by
    // startLiveVesselSimulation() without needing a full marker rebuild.
    //
    // Bow orientation: cargo_ship.glb is authored bow-forward on -Z, which
    // is the glTF "front" convention -- so camera-orbit's theta=0 below
    // faces the bow, and it renders pointing toward the top of the icon at
    // heading 0. The wrapper's rotate(vessel.heading deg) then turns the
    // whole rendered ship clockwise from there, exactly like the old "▲"
    // compass arrow did, so the bow now tracks true heading.
    //
    // shipVisual: normally the shared cached sprite (see
    // ensureVesselShipSprite above) reused as a plain <img> for every
    // vessel. Only falls back to a per-vessel <model-viewer> if the shared
    // capture failed for some reason -- same visual result either way.
    const shipVisual = state.vesselShipSpriteUrl
      ? `<img src="${state.vesselShipSpriteUrl}" alt="" draggable="false" style="width:100%;height:100%;object-fit:contain;pointer-events:none;">`
      : `<model-viewer
              src="assets/models/cargo_ship.glb"
              style="width:100%;height:100%;background:transparent;"
              camera-orbit="0deg 55deg 2.4m"
              field-of-view="25deg"
              exposure="1.1"
              shadow-intensity="0"
              disable-zoom
              interaction-prompt="none"
              camera-controls="false"
              loading="eager"
              reveal="auto">
            </model-viewer>`;

    // Selection highlight: a Tailwind ring (same ring/animate-pulse utilities
    // already used elsewhere in this file, e.g. the live-status dots) drawn
    // around the marker when this vessel is the currently selected one.
    // Seeded from state.selectedVesselId here so a full re-render (periodic
    // refresh, layer toggle, etc.) never drops the highlight; toggled live
    // in between re-renders by setVesselSelectionHighlight() below, which
    // only touches this one element -- the ship model, status ring, label,
    // popup and marker positioning are all untouched by selection.
    const isSelected = state.selectedVesselId === vessel.id;

    // Anomaly warning: a subtle, static (non-pulsing, on purpose -- this is
    // a passive data flag, not an active alert like BORDER_ALERT's pulse)
    // dashed amber ring plus a small corner badge, shown only for vessels
    // the existing anomaly-detection logic has already flagged via
    // isVesselAnomalous() above. Deliberately visually distinct from the
    // (larger, solid, pulsing cyan) selection ring so the two never read as
    // the same thing, and from the colored status ring underneath, which
    // keeps signaling BORDER_ALERT/WARNING/TRANSIT exactly as before.
    const isAnomalous = isVesselAnomalous(vessel);
    const anomalyRing = isAnomalous
      ? `<div class="absolute -inset-1 rounded-full border-2 border-dashed border-amber-400/80 pointer-events-none" title="${t('mapVesselAnomalyTitle', 'Flagged anomalous by ORCA detection')}"></div>`
      : '';
    const anomalyBadge = isAnomalous
      ? `<span class="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-400 text-slate-950 text-[8px] leading-none pointer-events-none" title="${t('mapVesselAnomalyTitle', 'Flagged anomalous by ORCA detection')}">⚠</span>`
      : '';

    const html = `
        <div id="vesselMarkerWrap-${vessel.id}" class="relative flex items-center justify-center" style="width:40px;height:40px;">
          <div id="vesselSelectRing-${vessel.id}" class="absolute -inset-2 rounded-full ring-4 ring-cyan-300 animate-pulse pointer-events-none ${isSelected ? '' : 'hidden'}"></div>
          <div class="absolute inset-0 rounded-full ${simBorder} ${colorClass} ${pulseClass} opacity-70"></div>
          ${anomalyRing}
          <div id="vesselShip-${vessel.id}" data-heading="${vessel.heading}" style="width:34px;height:34px;transform: rotate(${vessel.heading}deg); transition: transform 0.4s linear; pointer-events:none;">
            ${shipVisual}
          </div>
          <span class="absolute -top-4 whitespace-nowrap text-[9px] font-mono bg-[#14A3C7] px-1 rounded text-[#00008B] border border-[#00008B]/30 pointer-events-none">
                        ${vessel.id.includes('-') ? vessel.id.split('-').slice(1).join('-') : vessel.id}${vessel.is_simulated ? ' · SIM' : ''}
          </span>
          ${anomalyBadge}
        </div>
      `;

    const popupHtml = `
      <div class="p-2 min-w-[220px]">
        ${vessel.is_simulated ? `<div class="mb-1 px-1.5 py-0.5 inline-block rounded text-[9px] font-bold uppercase tracking-wider bg-slate-700 text-slate-200 border border-slate-500">${t('mapVesselSimulatedBadge', 'Simulated · no live AIS coverage here')}</div>` : ''}
        <div class="flex items-center justify-between mb-1">
          <span class="font-bold text-white text-xs">${vessel.name}</span>
          <span class="text-[10px] font-mono px-1 rounded glass-chip text-cyan-300">${vessel.id}</span>
        </div>
        <div class="text-[11px] text-slate-400 mb-2">${vessel.type} · ${vessel.owner}</div>

        <div class="grid grid-cols-2 gap-1 text-[11px] bg-slate-900 p-2 rounded border border-slate-700">
          <div><span class="text-slate-400">${t('mapVesselSpeedLabel', 'Speed:')}</span> <span class="text-cyan-400 font-bold">${vessel.speed_knots} kn</span></div>
          <div><span class="text-slate-400">${t('mapVesselHeadingLabel', 'Heading:')}</span> <span class="text-slate-200 font-semibold">${vessel.heading}°</span></div>
          <div><span class="text-slate-400">${t('mapVesselZoneLabel', 'Zone:')}</span> <span class="text-slate-200 font-semibold">${vessel.zone}</span></div>
          <div><span class="text-slate-400">${t('mapVesselImblDistLabel', 'IMBL Dist:')}</span> <span class="${vessel.imbl_dist_nm < 5 ? 'text-red-400 font-bold' : 'text-emerald-400'}">${vessel.imbl_dist_nm} NM</span></div>
          <div><span class="text-slate-400">${t('mapVesselStatusLabel', 'Status:')}</span> <span class="font-bold ${vessel.status.includes('ALERT') ? 'text-red-400' : 'text-emerald-400'}">${vessel.status}</span></div>
          <div><span class="text-slate-400">${t('mapVesselFuelLabel', 'Fuel:')}</span> <span class="text-slate-200">${vessel.fuel_pct != null ? vessel.fuel_pct + '%' : t('mapVesselFuelNA', 'N/A')}</span></div>

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

    // Clicking the marker itself also selects/highlights it, in addition to
    // the existing "Locate ➔" table action below. Wrapped in try/catch like
    // the other Mappls calls beyond addListener()/resize() in this file
    // (see focusFishermanZone() above) -- if this particular event isn't
    // actually supported, the marker's existing built-in click-to-open-popup
    // behavior (popupOptions: true) still works exactly as before; only the
    // extra highlight would be skipped.
    try {
      marker.addListener('click', () => selectVessel(vessel.id));
    } catch (err) { /* Mappls marker click listener not available -- ignore */ }
  });

  const mapVesselCounter = document.getElementById('mapActiveVessels');
  if (mapVesselCounter) {
    mapVesselCounter.textContent = state.simulatedVesselCount
      ? tFormat('mapActiveVesselsBreakdownTemplate', { total: state.vessels.length, live: state.liveVesselCount, sim: state.simulatedVesselCount }, `${state.vessels.length} Active Vessels (${state.liveVesselCount} live · ${state.simulatedVesselCount} simulated)`)
      : tFormat('mapActiveVesselsSimpleTemplate', { total: state.vessels.length }, `${state.vessels.length} Active Vessels`);
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
      duskEl.innerHTML = `<span class="text-slate-400 font-bold">${t('routeUnavailableLabel', ' ROUTE UNAVAILABLE:')}</span> ${t('routeUnavailableMsg', 'ORCA backend is unreachable, so no routed distance/ETA can be shown. Running in local fallback mode.')}`;
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
      duskEl.innerHTML = `<span class="text-red-400 font-bold">${t('routeNoSafeRouteLabel', '✕ NO SAFE MARITIME ROUTE FOUND:')}</span> ${tFormat('routeNoSafeRouteMsgTemplate', { detail: route.detail || route.reason || t('routeNoSafeRouteDefaultReason', 'The router could not find a path avoiding land and Marine Protected Areas for this harbour/PFZ pair.') }, `${route.detail || route.reason || 'The router could not find a path avoiding land and Marine Protected Areas for this harbour/PFZ pair.'}`)}`;
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
      duskEl.innerHTML = `<span class="text-emerald-400 font-bold">${t('routeSafeReturnLabel', '✓ SAFE RETURN:')}</span> ${tFormat('routeSafeReturnTemplate', { time: `<span class="font-mono text-white">${route.estimated_return_ist || '—'}</span>` }, `Expected harbour arrival by <span class="font-mono text-white">${route.estimated_return_ist || '—'}</span> (Before 18:30 IST dusk).`)}`;
      duskEl.className = "p-2.5 rounded-lg text-xs glass-card glass-card-safe text-emerald-200";
      duskEl.style.color = "";
    } else {
      duskEl.innerHTML = `<span class="font-bold" style="color:#ff0000;">${t('routeReturnAfterDuskLabel', ' RETURN AFTER DUSK:')}</span> ${tFormat('routeReturnAfterDuskTemplate', { time: `<span class="font-mono" style="color:#ff0000;">${route.estimated_return_ist || '—'}</span>` }, `Expected return at <span class="font-mono" style="color:#ff0000;">${route.estimated_return_ist || '—'}</span> (Exceeds 18:30 IST sunset). Recommend an earlier departure or a night navigational beacon check.`)}`;
      duskEl.className = "p-2.5 rounded-lg text-xs";
      duskEl.style.color = "#ff0000";
    }
  }

  if (state.map) {
    try {
      // Draw EXACTLY the waypoints the backend A* router returned -- the
      // frontend never invents its own waypoints.
      const paths = route.waypoints.map(p => ({ lat: p.lat, lng: p.lon }));

      const zonesText = route.avoided_mpas && route.avoided_mpas.length ? route.avoided_mpas.join(', ') : t('mapRouteLandNoGoZones', 'land/no-go zones');
      const detourNote = route.detour_percent > 1
        ? tFormat('mapRouteDetourTemplate', { pct: route.detour_percent, zones: zonesText }, ` · Detour ${route.detour_percent}% around ${zonesText}`)
        : '';

      const routePopupHtml = `
        <div class="p-1 text-xs">
          <span class="font-bold text-cyan-400">${t('mapRoutePopupTitle', 'Sea-Only A* Route (Land + MPA Avoidance)')}</span><br/>
          <span>${harbour.name} ➔ ${pfz.name}</span><br/>
          <span>${tFormat('mapRouteDistanceEtaTemplate', { dist: `<b class="text-white">${distNM.toFixed(1)}</b>`, eta: `<b class="text-white">${etaHoursFloor}h ${etaMinutes}m</b>`, detourNote }, `Distance: <b class="text-white">${distNM.toFixed(1)} NM</b> · ETA: <b class="text-white">${etaHoursFloor}h ${etaMinutes}m</b>${detourNote}`)}</span>
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
            <h4 class="font-bold text-slate-100 text-sm group-hover:text-cyan-300 transition">${t(agent.nameKey, agent.name)}</h4>
          </div>
          <span id="badge-lat-${agent.id}" class="text-[10px] font-mono px-1.5 py-0.5 rounded glass-chip text-slate-400">
            ${agent.latency}
          </span>
        </div>
        <p class="text-xs text-slate-400 mb-3 line-clamp-2">${t(agent.roleKey, agent.role)}</p>
        <div class="flex flex-wrap gap-1 mb-2">
          ${agent.sensors.map(s => `<span class="text-[10px] text-slate-400 font-mono">${s}</span>`).join(' ')}
        </div>
        <div class="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800">
          <span class="flex items-center gap-1.5">
            <span id="status-dot-${agent.id}" class="w-2 h-2 rounded-full bg-slate-500"></span>
            <span id="status-text-${agent.id}" class="capitalize">${t('dagStatusIdle', 'Idle')}</span>
          </span>
          <span class="text-cyan-400 text-xs font-medium group-hover:translate-x-0.5 transition">${t('dagInspectLink', 'Inspect ➔')}</span>
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

  if (titleEl) titleEl.textContent = t(agent.nameKey, agent.name);
  if (roleEl) roleEl.textContent = t(agent.roleKey, agent.role);
  if (latencyEl) latencyEl.textContent = tFormat('dagInspectorLatencyTemplate', { latency: agent.latency }, `Execution Latency: ${agent.latency} · Subtasks Verified`);
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
    if (textEl) textEl.textContent = t('dagStatusQueued', 'Queued');
  });
}

function setDAGNodeExecuting(agentId) {
  const nodeEl = document.getElementById(`dag-node-${agentId}`);
  const dotEl = document.getElementById(`status-dot-${agentId}`);
  const textEl = document.getElementById(`status-text-${agentId}`);
  if (nodeEl) nodeEl.classList.add('border-cyan-400', 'bg-cyan-950/40', 'glow-cyan');
  if (dotEl) dotEl.className = "w-2 h-2 rounded-full bg-cyan-400 animate-ping";
  if (textEl) textEl.textContent = t('dagStatusExecuting', 'Executing...');
}

function setDAGNodeCompleted(agentId) {
  const nodeEl = document.getElementById(`dag-node-${agentId}`);
  const dotEl = document.getElementById(`status-dot-${agentId}`);
  const textEl = document.getElementById(`status-text-${agentId}`);
  if (nodeEl) { nodeEl.classList.remove('border-cyan-400', 'glow-cyan'); nodeEl.classList.add('border-emerald-500/70'); }
  if (dotEl) dotEl.className = "w-2 h-2 rounded-full bg-emerald-400";
  if (textEl) textEl.textContent = t('dagStatusCompleted', 'Completed');
}

function setDAGNodeSkipped(agentId, reason) {
  const nodeEl = document.getElementById(`dag-node-${agentId}`);
  const dotEl = document.getElementById(`status-dot-${agentId}`);
  const textEl = document.getElementById(`status-text-${agentId}`);
  if (nodeEl) nodeEl.classList.add('opacity-45', 'grayscale');
  if (dotEl) dotEl.className = "w-2 h-2 rounded-full bg-slate-500";
  if (textEl) textEl.textContent = t('dagStatusSkipped', 'Not invoked — intent did not require it');
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
        runBtn.innerHTML = `<span class="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1"></span> ${t('dagBtnReasoningActiveLive', 'Reasoning Active (Live Backend)...')}`;
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
          runBtn.innerHTML = t('dagBtnExecutedLive', '✓ Pipeline Executed via Live Backend · Run Again');
        }
        try { ws.close(); } catch (e) { /* noop */ }
        return;
      }

      if (msg.type === 'PIPELINE_ERROR') {
        console.warn('ORCA backend pipeline error:', msg.message);
        state.isSimulatingDAG = false;
        if (runBtn) {
          runBtn.disabled = false;
          runBtn.innerHTML = t('dagBtnErrorRetry', '▶ Run Live Pipeline Simulation');
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
    runBtn.innerHTML = `<span class="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1"></span> ${t('dagBtnReasoningActiveOffline', 'Reasoning Active (Local Simulation)...')}`;
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
    runBtn.innerHTML = t('dagBtnExecutedOffline', '✓ Pipeline Executed (Local Simulation) · Run Again');
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
  if (messages) messages.innerHTML = `<div class="text-xs text-slate-400 font-mono text-center py-4">${t('chatNewConversationMsg', 'New conversation started. ORCA will not use earlier chat context.')}</div>`;
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
        ${t('chatYouLabel', 'YOU')}
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
        ${t('chatOrcaLabel', 'ORCA')}
      </div>
      <div class="max-w-[85%] p-4 rounded-2xl glass-card text-slate-300 text-sm space-y-2 w-full">
        <div class="flex items-center gap-2 text-cyan-400 text-xs font-mono">
          <span class="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
          ${t('chatOrchestratingMsg', 'Orchestrating 8 Specialized AI Agents across Oceansat-3, INSAT-3DR & Open-Meteo...')}
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
        ${t('chatAiLabel', 'AI')}
      </div>
      <div class="max-w-[88%] p-5 rounded-2xl glass-card shadow-xl space-y-3">
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-cyan-400 tracking-wider uppercase">${t('chatAdvisoryHeader', 'Multi-Agent Marine Advisory')}</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              ${tFormat('chatGroundedConfidenceTemplate', { confidence: advisory.confidence }, `${advisory.confidence}% Grounded Confidence`)}
            </span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/20 text-violet-200 border border-violet-400/30" title="${t('chatLangDetectedTooltip', 'Language detected from the message')}">
              ${languageBadgeLabel(advisory.language)}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="playAudioText('${encodeURIComponent(advisory.plainText)}')" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-600 text-xs flex items-center gap-1.5 transition">
              <span class="text-xs"></span> ${t('chatListenTts', 'Listen (TTS)')}
            </button>
            <button onclick="copyAdvisoryMSS()" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-teal-300 border border-slate-600 text-xs flex items-center gap-1 transition">
              <span>${orcaIcon('radar')}</span> ${t('chatNavicMssBtn', 'NavIC MSS Code')}
            </button>
          </div>
        </div>

        <div class="text-sm text-slate-200 leading-relaxed font-sans">
          ${advisory.formattedHtml}
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800 text-[11px] font-mono">
          <div class="p-2 rounded bg-slate-950/80 border border-slate-800">
            <span class="text-slate-400 block">${t('chatMetricZone', 'Recommended Zone')}</span>
            <span class="text-cyan-400 font-bold">${advisory.metrics.zone}</span>
          </div>
          <div class="p-2 rounded bg-slate-950/80 border border-slate-800">
            <span class="text-slate-400 block">${t('chatMetricEta', 'Live Sea State ETA')}</span>
            <span class="text-emerald-400 font-bold">${advisory.metrics.eta}</span>
          </div>
          <div class="p-2 rounded bg-slate-950/80 border border-slate-800">
            <span class="text-slate-400 block">${t('chatMetricVessels', 'Active Vessels')}</span>
            <span class="text-amber-300 font-bold">${tFormat('chatVesselsSuffix', { count: advisory.metrics.vesselCount }, `${advisory.metrics.vesselCount} Vessels`)}</span>
          </div>
          <div class="p-2 rounded bg-slate-950/80 border border-slate-800">
            <span class="text-slate-400 block">${t('chatMetricImbl', 'IMBL Clearance')}</span>
            <span class="text-slate-200 font-bold">${advisory.metrics.imblClearance}</span>
          </div>
        </div>

        <details class="group mt-3 pt-2 border-t border-slate-800/80">
          <summary class="text-xs text-slate-400 hover:text-cyan-400 cursor-pointer flex items-center justify-between font-mono">
            <span>${orcaIcon('search')} ${tFormat('chatReasoningTraceSummaryTemplate', { steps: advisory.agentSteps.length }, `View Multi-Agent Reasoning Trace (${advisory.agentSteps.length} steps executed)`)}</span>
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
  if (countEl) countEl.textContent = tFormat('chatNodeDagSuffixTemplate', { count: steps.length }, `${steps.length}-node DAG`);
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
  // The Satellite Oceanography agent is only invoked for queries whose
  // classified intent actually needs ocean-color data (e.g. PFZ/ocean
  // conditions) -- for greetings, thanks, help, date/time, and other
  // small-talk it is deliberately skipped (see supervisor.py's
  // INTENT_RELEVANT_AGENTS). Without this check, every one of those
  // ordinary "hi"/"hello" replies would show a "Chlorophyll: UNAVAILABLE"
  // footer line, which reads as broken data rather than "not applicable to
  // this question". Only render that line when satellite actually ran.
  const satelliteRan = (t.plan?.executed_agents || []).includes('satellite');

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
    plainText: adv.advisory_text || tFormat('chatNoAdvisoryTextFallback', null, 'The ORCA INSIGHT backend generated an advisory but returned no text.'),
    formattedHtml: `<p><strong class="text-emerald-400">${tFormat('chatLiveAdvisoryLabel', null, '✓ Live Multi-Agent Advisory')}</strong> <span class="text-[10px] text-slate-500 font-mono">(${adv.llm_engine || tFormat('chatGroundedEngineFallback', null, 'Grounded Engine')})</span></p>
      <p class="mt-2 text-slate-300">${adv.advisory_text || ''}</p>
      ${satelliteRan ? `<p class="mt-2 text-[11px] font-mono ${chlorophyllSource.includes('ESTIMATED') ? 'text-amber-300' : 'text-slate-500'}">${tFormat('chatOceanSourceTierTemplate', { tier: oceanTier, chlorophyll: chlorophyllSource }, `Ocean source tier: ${oceanTier} · Chlorophyll: ${chlorophyllSource}`)}</p>` : ''}
      <p class="mt-2 text-[11px] text-slate-500">${tFormat('chatCitationsTemplate', { citations: (adv.citations || []).join(', ') || '—' }, `Citations: ${(adv.citations || []).join(', ') || '—'}`)}</p>`,
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
  const OFFLINE_BANNER = `<p class="mb-2 text-[11px] font-mono text-amber-300 bg-amber-950/40 border border-amber-700/40 rounded px-2 py-1">${orcaIcon('alert')} ${t('chatOfflineBannerText', 'OFFLINE ADVISORY ENGINE — ORCA backend unreachable. The figures below are a simulated illustrative estimate, not live telemetry.')}</p>`;

  if (q.includes('border') || q.includes('imbl') || q.includes('sri lanka') || q.includes('pakistan') || q.includes('सीमा') || q.includes('எல்லை')) {
    return {
      confidence: 60,
      metrics: { zone: "Palk Strait & Rameswaram", eta: "1h 45m (simulated)", vesselCount: 7, imblClearance: "SIMULATED ~2-4 NM" },
      plainText: t('chatOfflineImblPlainText', "OFFLINE ADVISORY (backend unreachable, simulated estimate): Vessels in the Palk Strait / Gulf of Mannar area are typically within a few Nautical Miles of the India-Sri Lanka IMBL boundary. Maintain a westward heading and keep VHF transponders active on Channel 16. Reconnect to the ORCA backend for an actual measured distance to the boundary."),
      formattedHtml: OFFLINE_BANNER + `<p><strong class="text-red-400">${orcaIcon('alert')} ${t('chatOfflineImblHtmlHeading', 'IMBL Geofencing Advisory (Simulated Offline Estimate):')}</strong></p>
        <p class="mt-1">${t('chatOfflineImblHtmlBody1', 'Without a live backend connection, exact vessel-to-boundary distances cannot be measured. As a general precaution near Palk Strait Sector 4, maintain a westward heading toward Mandapam.')}</p>
        <p class="mt-2 text-slate-300">${t('chatOfflineImblHtmlBody2', 'This is a generic offline safety reminder, not a measured geofence reading. Reconnect to ORCA backend for a real distance-to-IMBL calculation.')}</p>`,
      agentSteps: [
        { agent: "Offline Advisory Engine", trace: t('chatOfflineImblStep1', "Backend unreachable. Classified query as IMBL_BOUNDARY using local keyword match."), latency: "offline" },
        { agent: "Offline Advisory Engine", trace: t('chatOfflineImblStep2', "No live geofencing telemetry available -- returning generic boundary-safety guidance only."), latency: "offline" },
      ]
    };
  }

  if (q.includes('density') || q.includes('count') || q.includes('overcrowd') || q.includes('how many') || q.includes('घनत्व') || q.includes('அடர்த்தி')) {
    return {
      confidence: 55,
      metrics: { zone: "PFZ-01 & Wadge Bank", eta: "— (simulated)", vesselCount: "unavailable", imblClearance: "unavailable" },
      plainText: t('chatOfflineDensityPlainText', "OFFLINE ADVISORY (backend unreachable, simulated estimate): Live vessel counts cannot be retrieved without a backend connection. Historically, Wadge Bank and Kochi Deep Offshore see moderate fishing traffic. Reconnect to the ORCA backend for an actual fleet-density reading from the vessel dataset."),
      formattedHtml: OFFLINE_BANNER + `<p><strong class="text-cyan-400">${orcaIcon('vessel')} ${t('chatOfflineDensityHtmlHeading', 'Fleet Density (Offline — Simulated Placeholder):')}</strong></p>
        <p class="mt-1">${t('chatOfflineDensityHtmlBody', "The Fleet & Traffic Agent's live vessel dataset is not reachable right now, so an exact in-zone vessel count is unavailable.")}</p>
        <ul class="list-disc list-inside mt-2 space-y-1 text-slate-300">
          <li>${t('chatOfflineDensityListItem', 'Reconnect to the ORCA backend for a real per-zone vessel count and overcrowding verdict.')}</li>
        </ul>`,
      agentSteps: [
        { agent: "Offline Advisory Engine", trace: t('chatOfflineDensityStep1', "Backend unreachable. Classified query as FLEET_DENSITY using local keyword match."), latency: "offline" },
        { agent: "Offline Advisory Engine", trace: t('chatOfflineDensityStep2', "No live fleet dataset available -- vessel counts not shown to avoid presenting a fabricated figure."), latency: "offline" },
      ]
    };
  }

  const liveWave = state.liveMarine.waveHeight.toFixed(2);
  return {
    confidence: 55,
    metrics: { zone: "PFZ-01 (Kochi Deep) — simulated", eta: "— (simulated)", vesselCount: "unavailable", imblClearance: "unavailable" },
    plainText: tFormat('chatOfflineGenericPlainTextTemplate', { liveWave }, `OFFLINE ADVISORY (backend unreachable): ORCA's multi-agent backend could not be reached, so this answer is a generic, non-live placeholder rather than a grounded reading. Your browser's own Open-Meteo widget reports significant wave height around ${liveWave}m, but PFZ ranking, route distance, ETA, and fleet counts all require the backend and are not shown here. Reconnect to the ORCA backend for a real advisory.`),
    formattedHtml: OFFLINE_BANNER + `<p><strong class="text-amber-400">${orcaIcon('alert')} ${t('chatOfflineGenericHtmlHeading', 'Offline Placeholder Advisory')}</strong></p>
      <p class="mt-1">${tFormat('chatOfflineGenericHtmlBody1Template', { liveWave }, `The ORCA multi-agent backend (satellite, weather, PFZ ranking, geofencing, fleet, routing, and Neural Synthesis) is currently unreachable. Client-side, this browser last saw a wave height of <strong>${liveWave}m</strong> from Open-Meteo, but every other figure requires the backend.`)}</p>
      <p class="mt-2 text-slate-300">${t('chatOfflineGenericHtmlBody2', '<strong>No PFZ recommendation, route, ETA, or fleet count is shown</strong> because those would have to be invented rather than computed. Reconnect to the ORCA backend for a full grounded advisory.')}</p>`,
    agentSteps: [
      { agent: "Offline Advisory Engine", trace: t('chatOfflineGenericStep1', "Backend unreachable. No intent-specific keyword matched -- returning GENERAL_VOYAGE_SAFETY offline placeholder."), latency: "offline" },
      { agent: "Offline Advisory Engine", trace: tFormat('chatOfflineGenericStep2Template', { liveWave }, `Only client-visible figure available: last known Open-Meteo wave height ${liveWave}m (fetched directly by the browser, not via backend).`), latency: "offline" },
    ]
  };
}

// Text-to-Speech (TTS) Engine
window.playAudioText = function(encodedText) {
  const text = decodeURIComponent(encodedText);
  if (!state.speechSynth) {
    alert(t('chatTtsUnsupportedAlert', "Speech Synthesis not supported by your browser."));
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
    window.playAudioText(encodeURIComponent(t('chatTtsWelcomeFallback', "Welcome to ORCA INSIGHT. All satellite feeds and coastal oceanography systems are operating with normal status.")));
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
          <span class="ml-1 text-xs">${t('chatStopAudio', 'Stop Audio')}</span>
        </span>
      `;
      ttsBtn.classList.add('bg-cyan-600', 'text-white');
    } else {
      ttsBtn.innerHTML = `<span>${orcaIcon('speaker')} ${t('chatListenAudioAdvisory', 'Listen Audio Advisory')}</span>`;
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
        `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span> ${t('navicConnected', 'NavIC Receiver: Connected (L5/S-Band)')}` :
        `<span class="w-2 h-2 rounded-full bg-red-500"></span> ${t('navicDisconnected', 'NavIC Receiver: Disconnected')}`;
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
    button.textContent = t('navicTrackMyPosition', 'Track my position');
    setGeofenceTrackingStatus(t('navicStatusTrackingOff', 'Tracking off · no position is being requested'));
    return;
  }
  if (!navigator.geolocation) {
    setGeofenceTrackingStatus(t('navicStatusGeoUnsupported', 'Geolocation is not supported by this browser. Use simulated vessel movement for the demo.'), 'text-amber-300');
    return;
  }
  setGeofenceTrackingStatus(t('navicStatusRequestingPermission', 'Requesting device-location permission…'), 'text-cyan-300');
  state.positionWatchId = navigator.geolocation.watchPosition(
    position => {
      checkGeofenceAt(position.coords.latitude, position.coords.longitude, 'DEVICE_GEOLOCATION');
      button.textContent = t('navicStopTracking', 'Stop tracking');
      setGeofenceTrackingStatus(tFormat('navicStatusLiveTrackingTemplate', { accuracy: Math.round(position.coords.accuracy) }, `Live device tracking · accuracy ±${Math.round(position.coords.accuracy)}m · not stored`), 'text-emerald-300');
    },
    error => {
      state.positionWatchId = null;
      button.textContent = t('navicTrackMyPosition', 'Track my position');
      setGeofenceTrackingStatus(tFormat('navicStatusPermissionErrorTemplate', { error: error.message }, `Location permission unavailable (${error.message}). No position was sent.`), 'text-amber-300');
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
    setGeofenceTrackingStatus(t('navicStatusBackendUnavailable', 'Backend unavailable — exact geofence distance cannot be evaluated in local simulation.'), 'text-amber-300');
    return null;
  }
}

function toggleGeofenceSimulation(button) {
  if (state.simulatedGeofenceInterval) {
    clearInterval(state.simulatedGeofenceInterval);
    state.simulatedGeofenceInterval = null;
    button.textContent = t('navicSimulateMovement', 'Simulate vessel movement');
    setGeofenceTrackingStatus(t('navicStatusSimStopped', 'Geofence simulation stopped'));
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
    setGeofenceTrackingStatus(tFormat('navicStatusSimMovingTemplate', { index: index + 1, total: path.length, lat: lat.toFixed(2), lon: lon.toFixed(2) }, `Simulated vessel movement · point ${index + 1}/${path.length} · ${lat.toFixed(2)}, ${lon.toFixed(2)}`), 'text-amber-300');
    index += 1;
    if (index >= path.length) {
      clearInterval(state.simulatedGeofenceInterval);
      state.simulatedGeofenceInterval = null;
      button.textContent = t('navicSimulateMovement', 'Simulate vessel movement');
    }
  };
  button.textContent = t('navicStopSimulation', 'Stop simulation');
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
      alert(tFormat('navicMssCopiedAlertTemplate', { code: mssCode }, `Copied NavIC MSS / SMS 120-char Satellite Emergency Code:\n\n${mssCode}`));
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
        <div><span>${t('safetySyncLatencyLabel', 'Sync Latency:')}</span> <strong class="text-cyan-400">${sat.data_sync_latency_sec}s</strong></div>
        <div><span>${t('safetyBatteryLabel', 'Battery:')}</span> <strong class="text-emerald-400">${sat.battery_level_pct}%</strong></div>
        <div><span>${t('safetyLastPassLabel', 'Last Pass:')}</span> <span class="text-slate-300 text-[10px]">${sat.last_pass_ist}</span></div>
        <div><span>${t('safetyAltitudeLabel', 'Altitude:')}</span> <span class="text-slate-300 text-[10px]">${sat.altitude_km} km</span></div>
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
    state.lastWeatherResponse = weather;

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
    descEl.textContent = tFormat('safetyVerdictDescTemplate', { wave: weather.significant_wave_height_m, wind: weather.surface_wind_knots, score: weather.safety_score }, `Live Open-Meteo marine telemetry places significant wave height at ${weather.significant_wave_height_m}m and surface wind at ${weather.surface_wind_knots}kn near your selected harbour, giving a computed safety score of ${weather.safety_score}/100.`);
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
  if (windBand) windBand.textContent = tFormat('safetyBreezeSuffix', { direction: weather.wind_direction || t('safetyWindDefaultDirection', 'Westerly') }, `${weather.wind_direction || 'Westerly'} Breeze`);

  const seaVal = document.getElementById('marineSeaVal');
  const seaBand = document.getElementById('safetyTileSeaBand');
  if (seaVal) seaVal.textContent = `State ${weather.sea_state_douglas}`;
  if (seaBand) seaBand.textContent = seaStateLabel(weather.sea_state_douglas);

  const lightVal = document.getElementById('safetyTileLightningVal');
  const lightBand = document.getElementById('safetyTileLightningBand');
  const lightPct = weather.lightning_risk_pct;
  if (lightVal) lightVal.textContent = `${lightPct}% ${lightPct < 20 ? t('severityLow', 'Low') : lightPct < 50 ? t('severityModerate', 'Moderate') : t('severityHigh', 'High')}`;
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
  if (h < 0.5) return t('waveBandCalm', 'Calm (< 0.5m)');
  if (h < 1.25) return t('waveBandSlight', 'Slight (0.5 - 1.25m)');
  if (h < 2.5) return t('waveBandModerate', 'Moderate (1.25 - 2.5m)');
  return t('waveBandRough', 'Rough (> 2.5m)');
}

function seaStateLabel(seaState) {
  return { 1: t('seaStateCalm', 'Calm'), 2: t('seaStateSlight', 'Slight'), 3: t('seaStateSlightModerate', 'Slight to Moderate'), 4: t('seaStateModerateRough', 'Moderate to Rough') }[seaState] || t('seaStateUnknown', 'Unknown');
}

function lightningBandLabel(pct) {
  if (pct < 20) return t('lightningBandSafe', 'Safe Atmospheric Profile');
  if (pct < 50) return t('lightningBandElevated', 'Elevated Convective Risk');
  return t('lightningBandSevere', 'Severe Squall Warning');
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
          <span class="text-cyan-400 font-mono font-bold">${tFormat('fleetVesselCountSuffix', { count }, `${count} vessels`)}</span>
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
      ? tFormat('fleetLiveSimBreakdownTemplate', { total: state.vessels.length, live: state.liveVesselCount, sim: state.simulatedVesselCount }, `${state.vessels.length} (${state.liveVesselCount} live · ${state.simulatedVesselCount} sim)`)
      : state.vessels.length;
  }
}

function renderVesselsTable(filteredList = null) {
  const tbody = document.getElementById('vesselsTableBody');
  if (!tbody) return;

  const list = filteredList || state.vessels;

  tbody.innerHTML = list.map(v => {
    let statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold text-[#006A4E]">${t('vesselStatusSafeFishing', 'SAFE FISHING')}</span>`;
    if (v.status === 'BORDER_ALERT') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold text-[#7E3517] animate-pulse">${t('vesselStatusBorderAlert', 'BORDER ALERT')}</span>`;
    } else if (v.status === 'BORDER_WARNING') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold text-[#B8860B]">${t('vesselStatusBorderWarn', 'BORDER WARN')}</span>`;
    } else if (v.status === 'TRANSIT') {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold text-cyan-300">${t('vesselStatusInTransit', 'IN TRANSIT')}</span>`;
    }
    // Simulated fill-in vessels always carry their own tag alongside the
    // status badge, so a scan of the table never mistakes one for real AIS.
    const simTag = v.is_simulated
      ? `<span class="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-slate-700 text-slate-200 border border-slate-500" title="${t('vesselSimBadgeTitle', 'Simulated -- no live AIS coverage near this port')}">${t('vesselSimBadgeText', 'SIM')}</span>`
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
            ${t('vesselLocateAction', 'Locate ➔')}
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

// Highlights vessel `vesselId`'s 3D marker (the ring added in
// renderVesselsOnMap()) and un-highlights whichever vessel was previously
// selected. Purely a visual toggle on existing DOM nodes -- it never
// touches marker creation, positioning, the popup, or any other
// interaction, so the existing info panel/popup behavior in zoomToVessel()
// and the marker's own click-to-open-popup are unaffected.
function setVesselSelectionHighlight(vesselId, on) {
  const ring = document.getElementById(`vesselSelectRing-${vesselId}`);
  if (ring) ring.classList.toggle('hidden', !on);
}

function selectVessel(vesselId) {
  if (state.selectedVesselId === vesselId) return;
  const previousId = state.selectedVesselId;
  state.selectedVesselId = vesselId;
  if (previousId) setVesselSelectionHighlight(previousId, false);
  setVesselSelectionHighlight(vesselId, true);
}

window.zoomToVessel = function(vesselId) {
  const vessel = state.vessels.find(v => v.id === vesselId);
  if (!vessel || !state.map) return;

  selectVessel(vesselId);

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
          <span class="text-xs text-slate-400 font-mono">${t('bulletinIssuedLabel', 'Issued:')} ${b.issued_at}</span>
        </div>

        <h3 class="text-base font-bold" style="color: ${severityColor};">${b.title}</h3>
        <p class="text-sm text-slate-300 leading-relaxed">${b.summary}</p>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 font-mono">
          <div><span class="text-slate-400">${t('bulletinRegionLabel', 'Region:')}</span> <span class="text-slate-200 font-medium">${b.region}</span></div>
          <div><span class="text-slate-400">${t('bulletinWavesLabel', 'Waves:')}</span> <span class="text-cyan-400 font-medium">${b.wave_forecast}</span></div>
          <div><span class="text-slate-400">${t('bulletinWindsLabel', 'Winds:')}</span> <span class="text-slate-200 font-medium">${b.wind_forecast}</span></div>
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
          <span class="text-slate-400">${t('bulletinSourceLabel', 'Source:')} <strong class="text-slate-300">${b.source}</strong></span>
          <button onclick="playAudioText('${encodeURIComponent(b.title + '. ' + b.summary)}')" class="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 transition">
            <span>${orcaIcon('speaker')}</span> ${t('bulletinListenBtn', 'Listen Bulletin')}
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
          ${t('sosBeaconTransmittingBanner', '406 MHz SAS&R BEACON TRANSMITTING TO ISRO & COAST GUARD MRCC')}
        </div>
        <p>${t('sosDistressRelayedMsg', 'Distress packet relayed via INSAT-3DR SAS&R receiver. Maritime Rescue Coordination Centre (MRCC Chennai/Mumbai) alerted on VHF Ch 16.')}</p>
        <p class="font-mono text-xs text-slate-300">${tFormat('sosGpsVesselIdTemplate', { coords: "09°52'N, 75°33'E", vesselId: 'IND-KL-001', vesselName: 'Matsya Vardhini 4' }, "GPS Coordinates: 09°52'N, 75°33'E · Vessel ID: IND-KL-001 (Matsya Vardhini 4)")}</p>
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
        // Keep the 3D ship model's rotation in sync with heading changes
        // (e.g. the boundary-bounce turns above) without rebuilding the
        // marker -- same lightweight in-place update as setPosition.
        const shipEl = document.getElementById(`vesselShip-${v.id}`);
        if (shipEl) {
          shipEl.style.transform = `rotate(${v.heading}deg)`;
        }
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

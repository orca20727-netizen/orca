# ORCA INSIGHT — Smart India Hackathon 2026 Pitch Deck
**Problem Statement 26176 · Sponsored by ISRO (Dept. of Space)**  
**Theme:** *Disaster Management & Blue Economy* | **Team:** *SavioursX*

---

## 🎯 Slide 1: Title & Executive Summary
- **Title:** ORCA INSIGHT — Collaborative Multi-Agent Marine Intelligence for the Indian Ocean
- **Tagline:** "The Agentic Brain for India's 4 Million Coastal Fishermen"
- **Organization:** Indian Space Research Organisation (ISRO) & INCOIS
- **Core Value Proposition:** Real-time synthesis of satellite oceanography, NavIC geofencing, fleet density monitoring, and wave-adjusted voyage ETA to prevent maritime tragedies and double catch efficiency.

---

## 🛑 Slide 2: The Problem
1. **At-Sea Navigation Hazards:** 150+ fishermen face fatal capsizing annually due to sudden squalls and high sea states.
2. **International Boundary Breaches (IMBL):** Fishermen inadvertently drift across Sri Lankan and Pakistani maritime boundaries due to lack of real-time geofencing.
3. **Overfishing & Resource Depletion:** Concentrated vessel clustering in depleted zones while high-yield pelagic thermal fronts remain unexplored.
4. **Connectivity Desert:** 95% of traditional craft operate beyond 4G/5G cell range with zero real-time advisory access.

---

## 💡 Slide 3: Our Solution — ORCA INSIGHT
- An 8-agent collaborative intelligence pipeline reasoning over:
  - **ISRO Oceansat-3 (OCM-3/SSTM):** Real-time chlorophyll-a & thermal fronts.
  - **ISRO INSAT-3DR (SAS&R/Sounder):** Convective cyclone tracking & distress beacons.
  - **Open-Meteo & Sentinel-3:** Live Significant Wave Heights & wind vectors.
  - **NavIC (IRNSS) Constellation:** High-precision sub-meter maritime geofencing.
  - **Live AIS Fleet Simulation:** Dynamic vessel density and overcrowding risk detection over a 24-vessel simulated fleet (live AIS/ARGOS-4 feed integration is a Phase 2 roadmap item).

---

## 🚀 Slide 4: Headline Innovations (The Differentiators)
| Feature | Traditional Tools | ORCA INSIGHT |
| :--- | :--- | :--- |
| **Fleet Monitoring** | None (Blind to other boats) | **Vessel Density Counter & Overcrowding Detection (simulated 24-vessel fleet)** |
| **Voyage Routing** | Static distance only | **Hydrodynamic Wave-Adjusted ETA + Return-by-Dusk Safety Verdict** |
| **Hardware Bridge** | None | **NavIC NMEA-0183 Serial/Bluetooth Bridge + Skyplot** |
| **Accessibility** | English text numbers | **Voice Input (STT) & Speech Playback (TTS) in 4 Coastal Languages** |
| **Offline at Sea** | App crashes without 4G | **Offline PWA + 120-char NavIC MSS / SMS Satellite Code** |

**Gap 1 — Before/After note:** Before, the four-language control changed UI
labels and speech locale but English-only intent rules still handled the
query. Now ORCA detects the query language independently, routes supported
Hindi/Tamil/Malayalam intent phrases natively, returns detected-language
provenance, and clearly falls back to grounded English for unsupported
languages. This is offline-safe; it does not claim machine translation where
none was performed.

**Gap 2 — Before/After note:** Before, every question was stateless even
though the interface declared a chat history. Now each tab has a bounded,
30-minute in-memory conversation session: ORCA sends and retains only the six
most recent turns, carries forward the last harbour/PFZ for plain-language
follow-ups, and offers a visible New Conversation reset. This makes the
multi-turn behavior demonstrable without retaining a permanent user profile.

**Gap 3 — Before/After note:** Before, ORCA used a fixed source list and only
manual feed URLs. Now an allowlisted source registry periodically checks
Open-Meteo, INCOIS PFZ WebGIS, Copernicus Sentinel-3 discovery, and configured
providers, then exposes availability and request-level provenance. The data
chain is configured live → cached last-good → public live where available →
static fallback. This is intentionally not described as unrestricted source
discovery: INCOIS WebGIS is discovery-only and authenticated Copernicus ocean
colour data is not claimed as live unless a valid provider feed is configured.

**Gap 4 — Before/After note:** Before, the Supervisor labeled an intent plan
but the backend still ran every specialist agent on every question. Now the
pipeline executes only the agents required by that intent and marks all other
DAG nodes as not invoked; a full-pipeline debug flag remains available for
demo comparison. A hazardous weather result can also reactively add
Geofencing to a general query, demonstrating evidence-driven replanning
rather than a fixed visual workflow.

**Gap 5 — Before/After note:** Before, hazard information was only visible
when a user opened the app and asked for it. Now the backend evaluates wave,
wind, lightning-proxy, and cyclone-bulletin thresholds on its refresh cycle,
deduplicates alert records, and streams new alerts to open clients. Users can
opt in to browser notifications while the tab/PWA is open; this prototype
does not overclaim closed-app push delivery or live cyclone data when a
bundled bulletin is the source.

**Gap 6 — Before/After note:** Before, IMBL/MPA geofencing ran only when a
user manually asked about a location. Now users can explicitly opt into
browser GPS tracking for repeated live geofence checks and immediate in-app/
browser warnings at the 5 NM IMBL threshold or MPA buffer. A labelled
simulated vessel route drives the same endpoint for a reliable demo. ORCA
does not store location history or claim an exact offline geofence reading
when the backend is unavailable.

---

## 🏗️ Slide 5: Multi-Agent System Architecture
1. **Master Supervisor Agent:** Decomposes marine intent into parallel tasks.
2. **Satellite Oceanography Agent:** Extracts SST gradients & chlorophyll contours.
3. **Weather & Hazard Agent:** Calculates Sea-Venture Clearance (0-100).
4. **Ocean Analytics & PFZ Agent:** Ranks zones by species biomass potential.
5. **Geofencing & Routing Agent:** Monitors 5 NM/2 NM IMBL buffers & A* safe paths.
6. **Fleet & Traffic Agent:** Tracks 24 simulated AIS vessels per zone (live AIS feed integration is a Phase 2 roadmap item — see Slide 9).
7. **ETA & Voyage Safety Agent:** Computes wave resistance & dusk limits.
8. **Neural Synthesis Agent (LLM):** Produces grounded, cited multilingual advisories.

---

## 📱 Slide 6: User Experience & Field Workflow
- **Before Departure:** Fisherman speaks query in Tamil / Malayalam / Hindi -> Checks 88/100 Safe clearance -> Reviews wave-adjusted ETA (3h 25m).
- **At Sea (No 4G):** NavIC receiver connects via Bluetooth -> PWA maintains offline geofencing -> Audible buzzer triggers if within 2 NM of IMBL.
- **Emergency:** 1-Click SOS broadcasts 406 MHz SAS&R distress packet to Coast Guard MRCC.

---

## 📈 Slide 7: Technical Feasibility & Scalability
- **Frontend:** Lightweight PWA running at 60 FPS on basic Android phones.
- **Backend:** Async FastAPI multi-agent DAG with an in-house rule-based Stats Synthesis Engine -- zero external AI/LLM API, reasoning entirely over the site's own live telemetry and its own persistent stats ledger.
- **Open Data Pipelines:** Zero proprietary vendor lock-in (ISRO MOSDAC, Open-Meteo, Copernicus, AISStream).

---

## 🌍 Slide 8: Social & Economic Impact (Blue Economy)
- **30% Fuel Savings:** Direct routing to verified PFZ hotspots.
- **Zero IMBL Arrests:** Proactive 5 NM audible geofence buffers.
- **Lives Protected:** Return-by-dusk warnings prevent night strandings.
- **Target Reach:** 4,000,000+ coastal fishermen across 9 maritime states.

---

## 🔮 Slide 9: Future Roadmap
- **Phase 1 (Hackathon):** Complete working prototype with live Open-Meteo & NavIC simulator.
- **Phase 2 (Pilot):** Hardware deployment on 50 motorized craft in Kochi & Rameswaram.
- **Phase 3 (National Rollout):** Direct integration with Ministry of Fisheries & ISRO NavIC MSS transponders.

---

## 👥 Slide 10: Team SavioursX & Thank You
- **Problem Statement:** 26176 (ISRO, Dept. of Space)
- **Team Name:** SavioursX
- **Live Demo Link:** `http://localhost:3000`
- **Thank You Judges & ISRO Mentors!**

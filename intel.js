"use strict";
/* ORCA Insight — Global Intel tab.
 * Fully self-contained: deliberately does not touch or depend on any
 * identifier in app.js (a much larger, separately-maintained file) --
 * this script defines its own small helpers, all prefixed `intel`, and
 * wires itself into the page purely through the existing generic
 * switchTab()/[data-nav-target] contract already in app.js (see its
 * comment above setupNavigation(): any element with a matching
 * data-nav-target/id="tab-<x>" pair works with zero JS changes there).
 *
 * Data source: OSIRIS (osirisai.live), an open-source OSINT aggregator --
 * see backend/osiris_intel.py for the full rationale and the upstream
 * providers behind each field. This is supplementary situational-
 * awareness context only: never used in routing, safety verdicts, or PFZ
 * recommendations. Every request here hits this service's own
 * /api/intel/* cache, never osirisai.live directly -- that public
 * instance has been observed to occasionally take 12-15s to respond,
 * which is exactly why the backend polls and caches instead of proxying
 * a request live. Insight's API has no auth (see backend/main.py CORS),
 * so unlike Defence's equivalent panel this needs no bearer token. */

function intelQ(sel) { return document.querySelector(sel); }

function intelEscape(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function intelFmtTime(unixSeconds) {
  if (!unixSeconds) return "";
  try { return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z"; }
  catch (e) { return ""; }
}

function intelRow(title, meta, link, linkText) {
  const div = document.createElement("div");
  div.className = "p-2 rounded-lg bg-ocean-900/60 border border-ocean-800";
  const strong = document.createElement("div");
  strong.className = "text-slate-200 font-semibold";
  strong.textContent = title || "";
  div.appendChild(strong);
  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.className = "text-[11px] text-slate-500 mt-0.5";
    metaEl.textContent = meta;
    div.appendChild(metaEl);
  }
  if (link) {
    const a = document.createElement("a");
    a.href = link; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.className = "text-[11px] text-cyan-400 hover:underline";
    a.textContent = linkText || "Open";
    div.appendChild(a);
  }
  return div;
}

function intelSetLoading(id) {
  const wrap = intelQ(id);
  if (wrap) wrap.textContent = "Loading…";
}

function intelSetEmpty(id, msg) {
  const wrap = intelQ(id);
  if (!wrap) return;
  wrap.textContent = msg || "No data available yet.";
}

async function intelFetch(path) {
  const resp = await fetch("/api/intel" + path);
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return resp.json();
}

async function intelLoadSummary() {
  try {
    const data = await intelFetch("/summary");
    const wrap = intelQ("#intelSourceHealth");
    if (wrap) {
      wrap.innerHTML = "";
      Object.keys(data.sources || {}).forEach((key) => {
        const s = data.sources[key];
        const status = !s.available ? "bg-red-500" : (s.stale ? "bg-amber-400" : "bg-emerald-400");
        const chip = document.createElement("span");
        chip.className = "inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-ocean-800 text-[11px] text-slate-300 font-mono";
        chip.innerHTML = `<span class="inline-block w-1.5 h-1.5 rounded-full ${status}"></span> ${intelEscape(key.replace(/_/g, " "))}`;
        wrap.appendChild(chip);
      });
    }
    const updated = intelQ("#intelUpdatedAt");
    if (updated) updated.textContent = "Updated " + new Date().toLocaleTimeString();
  } catch (e) {
    intelSetEmpty("#intelSourceHealth", "Could not reach intel summary.");
  }
}

async function intelLoadIncidents() {
  const id = "#intelIncidentsList";
  intelSetLoading(id);
  try {
    const [conflicts, gdelt] = await Promise.all([
      intelFetch("/conflicts").catch(() => null),
      intelFetch("/gdelt").catch(() => null),
    ]);
    const wrap = intelQ(id);
    wrap.innerHTML = "";
    let count = 0;
    ((conflicts && conflicts.data && conflicts.data.zones) || []).slice(0, 8).forEach((z) => {
      wrap.appendChild(intelRow(z.label || z.id, z.description || z.region || "", z.sourceUrl, "Source"));
      count++;
    });
    ((gdelt && gdelt.data && gdelt.data.events) || []).slice(0, 12).forEach((ev) => {
      wrap.appendChild(intelRow(ev.name || "Event", "GDELT / GDACS", ev.url, "Details"));
      count++;
    });
    if (!count) intelSetEmpty(id, "No active incidents in cache yet.");
  } catch (e) {
    intelSetEmpty(id, "Could not load global incidents.");
  }
}

async function intelLoadEarthquakes() {
  const id = "#intelEarthquakesList";
  intelSetLoading(id);
  try {
    const resp = await intelFetch("/earthquakes");
    const quakes = (resp.data && resp.data.earthquakes) || [];
    const wrap = intelQ(id);
    wrap.innerHTML = "";
    if (!quakes.length) { intelSetEmpty(id, "No recent seismic events in cache yet."); return; }
    quakes.slice().sort((a, b) => (b.magnitude || 0) - (a.magnitude || 0)).slice(0, 10).forEach((q) => {
      wrap.appendChild(intelRow(
        `M${q.magnitude} — ${q.place || "Unknown location"}`,
        `Depth ${q.depth != null ? q.depth.toFixed(1) + " km" : "—"} · ${intelFmtTime((q.time || 0) / 1000)}`,
        q.url, "Details",
      ));
    });
  } catch (e) {
    intelSetEmpty(id, "Could not load earthquake data.");
  }
}

async function intelLoadInfrastructure() {
  const id = "#intelInfraList";
  intelSetLoading(id);
  try {
    const resp = await intelFetch("/infrastructure");
    const items = (resp.data && resp.data.infrastructure) || [];
    const wrap = intelQ(id);
    wrap.innerHTML = "";
    if (!items.length) { intelSetEmpty(id, "No infrastructure data in cache yet."); return; }
    items.slice(0, 12).forEach((it) => {
      wrap.appendChild(intelRow(it.name, `${it.city || ""}${it.city ? ", " : ""}${it.country || ""} · ${it.status || ""}`));
    });
  } catch (e) {
    intelSetEmpty(id, "Could not load infrastructure data.");
  }
}

async function intelLoadMaritime() {
  const id = "#intelMaritimeList";
  intelSetLoading(id);
  try {
    const resp = await intelFetch("/maritime");
    const ports = (resp.data && resp.data.ports) || [];
    const wrap = intelQ(id);
    wrap.innerHTML = "";
    if (!ports.length) { intelSetEmpty(id, "No maritime data in cache yet."); return; }
    ports.slice(0, 12).forEach((p) => {
      wrap.appendChild(intelRow(`${p.name} (${p.country || "—"})`, `${p.type || ""} · ${p.congestion || ""} · ${p.volume || ""}`));
    });
  } catch (e) {
    intelSetEmpty(id, "Could not load maritime data.");
  }
}

async function intelLoadLiveNews() {
  const id = "#intelLiveNewsList";
  intelSetLoading(id);
  try {
    const resp = await intelFetch("/live_news");
    const feeds = (resp.data && resp.data.feeds) || [];
    const wrap = intelQ(id);
    wrap.innerHTML = "";
    if (!feeds.length) { intelSetEmpty(id, "No live news streams in cache yet."); return; }
    feeds.slice(0, 12).forEach((f) => {
      wrap.appendChild(intelRow(f.name, `${f.city || ""}${f.city ? ", " : ""}${f.country || ""} · ${f.category || ""}`, f.url, "Open stream"));
    });
  } catch (e) {
    intelSetEmpty(id, "Could not load live news streams.");
  }
}

async function intelLoadNews() {
  const id = "#intelNewsList";
  intelSetLoading(id);
  try {
    const resp = await intelFetch("/news");
    const posts = (resp.data && resp.data.news) || [];
    const wrap = intelQ(id);
    wrap.innerHTML = "";
    if (!posts.length) { intelSetEmpty(id, "No OSINT news posts in cache yet."); return; }
    posts.slice(0, 15).forEach((n) => {
      let ts = 0;
      try { ts = new Date(n.published).getTime() / 1000; } catch (e) { /* ignore */ }
      wrap.appendChild(intelRow(n.title || "(untitled)", `${n.source_name || n.source || ""} · ${intelFmtTime(ts)}`, n.link, "Open post"));
    });
  } catch (e) {
    intelSetEmpty(id, "Could not load OSINT news feed.");
  }
}

async function intelLoadAll() {
  await Promise.all([
    intelLoadSummary(),
    intelLoadIncidents(),
    intelLoadEarthquakes(),
    intelLoadInfrastructure(),
    intelLoadMaritime(),
    intelLoadLiveNews(),
    intelLoadNews(),
  ]);
}

async function intelRunCctvSearch(lat, lng, radiusKm) {
  const id = "#intelCctvList";
  const wrap = intelQ(id);
  wrap.textContent = "Searching…";
  try {
    const resp = await intelFetch(`/cctv/region?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius_km=${encodeURIComponent(radiusKm)}`);
    const cams = (resp.data && resp.data.cameras) || [];
    wrap.innerHTML = "";
    if (!cams.length) { intelSetEmpty(id, resp.error ? "OSIRIS CCTV lookup failed: " + resp.error : "No cameras found in this region."); return; }
    cams.slice(0, 40).forEach((c) => {
      wrap.appendChild(intelRow(
        c.name || c.id,
        `${c.city || ""}${c.city ? ", " : ""}${c.country || ""} · ${c.source || ""}`,
        c.external_url || c.stream_url || null,
        "Open feed",
      ));
    });
  } catch (e) {
    intelSetEmpty(id, "CCTV lookup failed: " + e.message);
  }
}

let intelStarted = false;
let intelRefreshTimer = null;

function intelStart() {
  if (intelStarted) return;
  intelStarted = true;
  intelLoadAll();
  intelRefreshTimer = setInterval(intelLoadAll, 90000);

  const refreshBtn = intelQ("#intelRefreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", () => intelLoadAll());

  const cctvForm = intelQ("#intelCctvForm");
  if (cctvForm) {
    cctvForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const fd = new FormData(cctvForm);
      intelRunCctvSearch(fd.get("lat"), fd.get("lng"), fd.get("radius_km"));
    });
  }
}

// The Global Intel tab is a small part of a much larger dashboard, so
// this only starts fetching once the tab has actually been opened --
// matching the existing "lazy init on first view" pattern app.js itself
// uses for the Fleet & GIS map (see switchTab()'s 'fleetgis' branch).
// It does not hook into switchTab() itself (no shared loader-dispatch
// map exists for the Insight tabs the way Defence's app.js has
// viewLoaders) -- instead it watches the tab-intel section's own
// visibility directly, which needs no changes to app.js at all.
document.addEventListener("DOMContentLoaded", () => {
  const section = intelQ("#tab-intel");
  if (!section) return;
  if (!section.classList.contains("hidden")) { intelStart(); return; }
  const observer = new MutationObserver(() => {
    if (!section.classList.contains("hidden")) {
      intelStart();
      observer.disconnect();
    }
  });
  observer.observe(section, { attributes: true, attributeFilter: ["class"] });
});

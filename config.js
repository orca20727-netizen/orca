window.ORCA_API_BASE = window.location.origin;
window.ORCA_WS_BASE = window.location.origin.replace(/^http/, 'ws');

// Live-only overlay replaces bundled demo telemetry with current provider data
// or an explicit unavailable state.
(() => {
  const script = document.createElement('script');
  script.src = '/live-overrides.js';
  script.defer = true;
  document.head.appendChild(script);
})();

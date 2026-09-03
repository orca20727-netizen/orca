window.ORCA_API_BASE = window.location.origin;
window.ORCA_WS_BASE = window.location.origin.replace(/^http/, 'ws');

// ORCA is a live operations dashboard. Remove older offline PWA workers and
// their cached app shells so phones, tablets, and laptops always load the
// current deployed frontend and live API wiring.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  });
}
if (window.caches) {
  caches.keys().then((keys) => keys.filter((key) => key.startsWith('orca-insight-'))
    .forEach((key) => caches.delete(key)));
}

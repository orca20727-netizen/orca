window.ORCA_API_BASE = window.location.origin;
window.ORCA_WS_BASE = window.location.origin.replace(/^http/, 'ws');

// Register the app-shell service worker so ORCA INSIGHT can be installed
// as a PWA (desktop "Install app" / mobile "Add to Home Screen"). sw.js
// always fetches index.html/app.js/config.js/styles.css from the network
// first and only falls back to its cache when offline, so an installed
// app never gets stuck showing a stale build.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ---- "Install App" button wiring ----
// Chrome/Edge/Android fire `beforeinstallprompt` once the PWA criteria
// (manifest + service worker + icons + HTTPS) are met. We capture it and
// reveal our own Install button instead of the browser's own mini-infobar,
// so installing is an obvious, visible action in the UI.
window.ORCA_DEFERRED_INSTALL_PROMPT = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  window.ORCA_DEFERRED_INSTALL_PROMPT = event;
  document.querySelectorAll('.orca-install-btn').forEach((btn) => btn.classList.remove('hidden'));
});

window.addEventListener('appinstalled', () => {
  window.ORCA_DEFERRED_INSTALL_PROMPT = null;
  document.querySelectorAll('.orca-install-btn').forEach((btn) => btn.classList.add('hidden'));
});

window.ORCA_INSTALL_APP = async function () {
  const promptEvent = window.ORCA_DEFERRED_INSTALL_PROMPT;
  if (promptEvent) {
    promptEvent.prompt();
    await promptEvent.userChoice;
    window.ORCA_DEFERRED_INSTALL_PROMPT = null;
    document.querySelectorAll('.orca-install-btn').forEach((btn) => btn.classList.add('hidden'));
    return;
  }
  // iOS Safari (and any browser without beforeinstallprompt support) has no
  // programmatic install API -- show the manual steps instead.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  alert(isIOS
    ? 'To install: tap the Share icon in Safari, then "Add to Home Screen".'
    : 'To install: open your browser menu and choose "Install app" (or "Add to Home screen").');
};

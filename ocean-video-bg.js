/* ============================================================
   ORCA — OceanVideoBackground
   Reusable, self-injecting cinematic video background.
   Include this ONE script anywhere (once) and it does the rest —
   no need to paste <video> markup into every page/section.

   Expects assets at:
     /videos/orca-ocean-wallpaper.mp4
     /videos/orca-ocean-wallpaper.webm   (optional)
     /images/orca-ocean-fallback.jpg     (static poster / reduced-motion / on error)
   ============================================================ */
(function OceanVideoBackground() {
  "use strict";

  var VIDEO_MP4 = "videos/orca-ocean-wallpaper.mp4";
  var VIDEO_WEBM = "videos/orca-ocean-wallpaper.webm";
  var FALLBACK_IMG = "images/orca-ocean-fallback.jpg";

  function init() {
    if (document.querySelector(".orca-ocean-bg")) return; // don't double-inject

    var wrap = document.createElement("div");
    wrap.className = "orca-ocean-bg";
    wrap.setAttribute("aria-hidden", "true"); // decorative only, never announced

    var prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    var img = document.createElement("img");
    img.className = "orca-ocean-fallback-img";
    img.src = FALLBACK_IMG;
    img.alt = "";
    img.loading = "eager";
    wrap.appendChild(img);

    if (!prefersReducedMotion) {
      var video = document.createElement("video");
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", ""); // older iOS Safari
      video.preload = "auto";
      video.poster = FALLBACK_IMG;

      var sourceWebm = document.createElement("source");
      sourceWebm.src = VIDEO_WEBM;
      sourceWebm.type = "video/webm";
      video.appendChild(sourceWebm);

      var sourceMp4 = document.createElement("source");
      sourceMp4.src = VIDEO_MP4;
      sourceMp4.type = "video/mp4";
      video.appendChild(sourceMp4);

      // If the video can't load/play for any reason, quietly keep the
      // static fallback image visible — never leave a blank/broken box.
      video.addEventListener("error", function () {
        video.remove();
      });

      video.addEventListener("canplay", function () {
        var playPromise = video.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(function () {
            // Autoplay blocked by the browser — static image stays as the
            // background; that's an acceptable, still-professional fallback.
          });
        }
      });

      wrap.appendChild(video);
    }

    document.body.insertBefore(wrap, document.body.firstChild);
  }

  // Dim the background further while the GIS map tab is open, so map
  // labels/controls stay the clear focal point (see body.orca-map-active
  // rule in ocean-bg.css). Purely additive — safe no-op if that tab
  // system isn't present.
  function watchMapTab() {
    var mapSection = document.getElementById("tab-map");
    if (!mapSection) return;
    var apply = function () {
      document.body.classList.toggle(
        "orca-map-active",
        !mapSection.classList.contains("hidden")
      );
    };
    apply();
    new MutationObserver(apply).observe(mapSection, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init();
      watchMapTab();
    });
  } else {
    init();
    watchMapTab();
  }
})();

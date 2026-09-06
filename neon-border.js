/*!
 * neon-border.js — Vanilla JS/CSS port of the "Neon Border" Originkit
 * component, adapted for the ORCA INSIGHT dashboard (index.html /
 * styles.css / app.js — no React in this project, so the original TSX
 * component can't be dropped in directly; this reproduces the same
 * animated conic-gradient border + glow algorithm in plain JS).
 *
 * WHAT IT DOES
 * Draws an animated glowing border (two traveling arcs orbiting the
 * card's perimeter, corner to corner, plus a soft outer glow) as a
 * decorative absolutely-positioned overlay INSIDE any card element.
 * It does not touch the card's background/content — so it works as a
 * drop-in replacement for the flat "white block" card look without
 * having to restructure the card markup.
 *
 * USAGE
 * 1. Save this file as neon-border.js next to index.html.
 * 2. Add, right before </body> (after app.js is fine too):
 *      <script src="neon-border.js"></script>
 * 3. That's it — on load it finds every element matching
 *      .glass-card, .glass-card-strong
 *    and gives it an animated neon border. It also watches the DOM
 *    (MutationObserver) so cards injected later by app.js — DAG
 *    nodes, satellite cards, sidebar tiles, etc. — get the effect too.
 *
 * CUSTOMIZING
 * - Change the default selector/options globally by defining, BEFORE
 *   the <script src="neon-border.js"> tag:
 *     <script>
 *       window.NeonBorderConfig = {
 *         selectors: ".glass-card, .glass-card-strong",
 *         options: { color: "#14A3C7", thickness: 3, borderSize: 40, glow: 70, speed: 10 }
 *       };
 *     </script>
 * - Or override per-element with data attributes, e.g.:
 *     <div class="glass-card" data-neon-color="#f59e0b" data-neon-speed="6">
 * - To add it to an element by hand from your own code:
 *     NeonBorder.apply("#mySpecificCard", { color: "#10b981" });
 *
 * NOTE ON OVERFLOW
 * The glow bleeds a little outside the card's box. If a card's parent
 * has `overflow: hidden` / `overflow-x-auto` etc. the glow will be
 * clipped at that boundary — that's a CSS layout choice, not a bug in
 * this script. Remove/loosen overflow clipping on ancestors of cards
 * where you want the full glow to show.
 */
(function (global) {
    "use strict";

    var DEFAULTS = {
        color: "#14A3C7",
        thickness: 3,
        borderSize: 40,
        glow: 70,
        speed: 10,
        movement: "continuous" // "continuous" | "step"
    };

    var GLOW_LAYERS = [
        { blur: 6, opacity: 0.5, reach: 0.3 },
        { blur: 12, opacity: 0.3, reach: 0.6 },
        { blur: 34, opacity: 0.18, reach: 1 }
    ];
    var MAX_GLOW_BLUR = 34;
    var MAX_GLOW_REACH = 22;
    var ARC_SAMPLES = 24;
    var MIN_ARC = 0.015;
    var SLOWEST_CYCLE = 30, FASTEST_CYCLE = 4;
    var SLOWEST_STEP = 3, FASTEST_STEP = 0.35;
    var STEP_EASE = [0.72, 0.16, 0.18, 1.05];
    var GLIDE_EASE = [0.65, 0, 0.35, 1];

    function withAlpha(input, alpha) {
        var a = Math.max(0, Math.min(1, alpha));
        if (typeof input !== "string") return "rgba(0,0,0," + a + ")";
        var s = input.trim();
        var hex = s.match(/^#([0-9a-f]{3,8})$/i);
        if (hex) {
            var h = hex[1];
            if (h.length === 3 || h.length === 4) {
                h = h.split("").map(function (c) { return c + c; }).join("");
            }
            var n = parseInt(h.slice(0, 6), 16);
            if (!isFinite(n)) return "rgba(0,0,0," + a + ")";
            return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
        }
        var rgb = s.match(/^rgba?\(([^)]+)\)/i);
        if (rgb) {
            var parts = rgb[1].split(",").map(function (v) { return parseFloat(v); });
            if (parts.length >= 3 && parts.slice(0, 3).every(isFinite)) {
                return "rgba(" + parts[0] + "," + parts[1] + "," + parts[2] + "," + a + ")";
            }
        }
        return "rgba(0,0,0," + a + ")";
    }

    function perimeterPoint(u, w, h) {
        var d = (((u % 1) + 1) % 1) * 2 * (w + h);
        if (d < w) return [d, 0];
        if (d < w + h) return [w, d - w];
        if (d < w * 2 + h) return [w - (d - w - h), h];
        return [0, h - (d - w * 2 - h)];
    }

    function cornerLap(k, w, h) {
        var p = 2 * (w + h);
        var at = [0, w / p, (w + h) / p, (w * 2 + h) / p];
        return Math.floor(k / 4) + at[((k % 4) + 4) % 4];
    }

    function perimeterAngle(u, w, h) {
        var pt = perimeterPoint(u, w, h);
        return (Math.atan2(pt[0] - w / 2, h / 2 - pt[1]) * 180) / Math.PI;
    }

    function buildArc(lap, lengthPct, w, h, color) {
        var fw = w > 0 ? w : 100;
        var fh = h > 0 ? h : 100;
        var len = Math.max(0, Math.min(100, lengthPct));
        var span = Math.max(MIN_ARC, (len / 100) * 0.5);
        var solidT = len / 100;
        var stops = [];
        var base = 0, prev = 0, acc = 0;

        for (var i = 0; i <= ARC_SAMPLES; i++) {
            var f = i / ARC_SAMPLES;
            var angle = perimeterAngle(lap + (f - 0.5) * span, fw, fh);
            if (i === 0) {
                base = angle;
            } else {
                var d = angle - prev;
                while (d > 180) d -= 360;
                while (d < -180) d += 360;
                acc += d;
            }
            prev = angle;

            var t = Math.abs(f - 0.5) * 2;
            var k = solidT >= 1 ? 1 : (t <= solidT ? 1 : 1 - (t - solidT) / (1 - solidT));
            stops.push(withAlpha(color, k * k * (3 - 2 * k)) + " " + acc.toFixed(2) + "deg");
        }
        var end = acc.toFixed(2);
        stops.push(withAlpha(color, 0) + " " + end + "deg");
        stops.push(withAlpha(color, 0) + " 360deg");

        return "conic-gradient(from " + base.toFixed(2) + "deg at 50% 50%, " + stops.join(", ") + ")";
    }

    function makeEaseFn(pts) {
        var x1 = pts[0], y1 = pts[1], x2 = pts[2], y2 = pts[3];
        if (x1 === y1 && x2 === y2) return function (t) { return t; };
        function bez(a, b, t) {
            var u = 1 - t;
            return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
        }
        return function (t) {
            var x = Math.max(0, Math.min(1, t));
            var s = x;
            for (var i = 0; i < 8; i++) {
                var cx = bez(x1, x2, s) - x;
                var u = 1 - s;
                var dx = 3 * u * u * x1 + 6 * u * s * (x2 - x1) + 3 * s * s * (1 - x2);
                if (Math.abs(dx) < 1e-6) break;
                s -= cx / dx;
                s = Math.max(0, Math.min(1, s));
            }
            return bez(y1, y2, s);
        };
    }

    var stepEase = makeEaseFn(STEP_EASE);
    var glideEase = makeEaseFn(GLIDE_EASE);

    function injectStyleOnce() {
        if (document.getElementById("neon-border-styles")) return;
        var style = document.createElement("style");
        style.id = "neon-border-styles";
        style.textContent =
            ".neon-border-host{position:relative;}" +
            ".neon-border-slot{position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:1;}" +
            ".neon-border-band{position:absolute;box-sizing:border-box;" +
            "-webkit-mask-image:linear-gradient(#fff 0 0),linear-gradient(#fff 0 0);" +
            "-webkit-mask-clip:content-box,border-box;-webkit-mask-composite:xor;" +
            "mask-image:linear-gradient(#fff 0 0),linear-gradient(#fff 0 0);" +
            "mask-clip:content-box,border-box;mask-composite:exclude;}";
        document.head.appendChild(style);
    }

    function NeonBorderInstance(hostEl, opts) {
        this.host = hostEl;
        this.opts = Object.assign({}, DEFAULTS, opts || {});
        this.size = { w: 0, h: 0 };
        this._buildDom();
        this._observeResize();
        this._start();
    }

    NeonBorderInstance.prototype._radius = function () {
        var cs = getComputedStyle(this.host);
        var r = parseFloat(cs.borderTopLeftRadius);
        return isFinite(r) ? r : 0;
    };

    NeonBorderInstance.prototype._buildDom = function () {
        var slot = document.createElement("div");
        slot.className = "neon-border-slot";
        slot.setAttribute("aria-hidden", "true");
        this.slot = slot;

        this.groupA = document.createElement("div");
        this.groupB = document.createElement("div");
        [this.groupA, this.groupB].forEach(function (g) {
            g.style.position = "absolute";
            g.style.inset = "0";
            g.style.overflow = "visible";
            g.style.pointerEvents = "none";
        });

        this.slot.appendChild(this.groupA);
        this.slot.appendChild(this.groupB);
        this.host.classList.add("neon-border-host");
        this.host.insertBefore(this.slot, this.host.firstChild);

        var r = this.host.getBoundingClientRect();
        this.size = { w: r.width, h: r.height };
        this._renderGroupContents();
    };

    NeonBorderInstance.prototype._renderGroupContents = function () {
        var o = this.opts;
        var radius = this._radius();
        var thick = Math.max(1, Math.min(10, o.thickness));
        var amount = Math.max(0, Math.min(100, o.glow)) / 100;
        var glowOuter = 10 + MAX_GLOW_REACH + MAX_GLOW_BLUR * 2;

        function bandEl(r, offset) {
            offset = offset || 0;
            var d = document.createElement("div");
            d.className = "neon-border-band";
            d.style.inset = (offset - r) + "px";
            d.style.padding = r + "px";
            d.style.borderRadius = radius > 0 ? (radius + r) + "px" : "0";
            d.style.background = "var(--neon-arc)";
            return d;
        }

        var ringAt = function (share) { return thick + amount * MAX_GLOW_REACH * share; };

        function fillGroup(g) {
            g.innerHTML = "";
            if (amount > 0) {
                GLOW_LAYERS.forEach(function (l) {
                    var r = ringAt(l.reach);
                    var layer = document.createElement("div");
                    layer.style.position = "absolute";
                    layer.style.inset = -glowOuter + "px";
                    layer.style.boxSizing = "border-box";
                    layer.style.padding = glowOuter + "px";
                    layer.style.borderRadius = radius > 0 ? (radius + glowOuter) + "px" : "0";
                    layer.style.opacity = l.opacity;
                    layer.style.mixBlendMode = "plus-lighter";
                    layer.style.filter = l.blur ? "blur(" + l.blur.toFixed(1) + "px)" : "none";
                    layer.appendChild(bandEl(r, glowOuter));
                    g.appendChild(layer);
                });
            }
            for (var i = 0; i < 2; i++) {
                var edge = document.createElement("div");
                edge.style.position = "absolute";
                edge.style.inset = "0";
                edge.style.mixBlendMode = "plus-lighter";
                edge.appendChild(bandEl(thick, 0));
                g.appendChild(edge);
            }
        }

        fillGroup(this.groupA);
        fillGroup(this.groupB);
    };

    NeonBorderInstance.prototype._observeResize = function () {
        var self = this;
        if (typeof ResizeObserver === "undefined") return;
        this._ro = new ResizeObserver(function () {
            var r = self.host.getBoundingClientRect();
            if (r.width === self.size.w && r.height === self.size.h) return;
            self.size = { w: r.width, h: r.height };
            self._renderGroupContents();
        });
        this._ro.observe(this.host);
    };

    NeonBorderInstance.prototype._start = function () {
        var self = this;
        var lap = 0, corner = 0, stepT = 0, last = performance.now();

        function frame(now) {
            var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
            last = now;
            var o = self.opts;
            var s = Math.max(0, Math.min(20, o.speed));

            if (s > 0) {
                var step = o.movement === "step";
                var beat = step
                    ? SLOWEST_STEP + ((FASTEST_STEP - SLOWEST_STEP) * (s - 1)) / 19
                    : (SLOWEST_CYCLE + ((FASTEST_CYCLE - SLOWEST_CYCLE) * (s - 1)) / 19) / 4;

                stepT += dt / beat;
                while (stepT >= 1) { stepT -= 1; corner += 1; }
                var eased = step ? stepEase(Math.min(1, stepT * 2)) : glideEase(stepT);

                var w = self.size.w || 100, h = self.size.h || 100;
                var from = cornerLap(corner, w, h);
                var to = cornerLap(corner + 1, w, h);
                lap = from + (to - from) * eased;

                self.groupA.style.setProperty("--neon-arc", buildArc(lap, o.borderSize, w, h, o.color));
                self.groupB.style.setProperty("--neon-arc", buildArc(lap + 0.5, o.borderSize, w, h, o.color));
            }
            self._raf = requestAnimationFrame(frame);
        }
        this._raf = requestAnimationFrame(frame);
    };

    NeonBorderInstance.prototype.destroy = function () {
        if (this._raf) cancelAnimationFrame(this._raf);
        if (this._ro) this._ro.disconnect();
        if (this.slot && this.slot.parentNode) this.slot.parentNode.removeChild(this.slot);
    };

    var registry = new WeakMap();

    function readOpts(el) {
        var d = el.dataset;
        var o = {};
        if (d.neonColor) o.color = d.neonColor;
        if (d.neonThickness) o.thickness = parseFloat(d.neonThickness);
        if (d.neonBorderSize) o.borderSize = parseFloat(d.neonBorderSize);
        if (d.neonGlow) o.glow = parseFloat(d.neonGlow);
        if (d.neonSpeed) o.speed = parseFloat(d.neonSpeed);
        if (d.neonMovement) o.movement = d.neonMovement;
        return o;
    }

    function apply(selectorOrEl, opts) {
        injectStyleOnce();
        var els = typeof selectorOrEl === "string"
            ? Array.prototype.slice.call(document.querySelectorAll(selectorOrEl))
            : [selectorOrEl];
        els.forEach(function (el) {
            if (!el || registry.has(el)) return;
            var instance = new NeonBorderInstance(el, Object.assign({}, opts, readOpts(el)));
            registry.set(el, instance);
        });
    }

    function autoInit() {
        var cfg = global.NeonBorderConfig || {};
        var selector = cfg.selectors || ".glass-card, .glass-card-strong";
        apply(selector, cfg.options || {});

        var mo = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (node.nodeType !== 1) return;
                    if (node.matches && node.matches(selector)) apply(node, cfg.options || {});
                    if (node.querySelectorAll) {
                        Array.prototype.slice.call(node.querySelectorAll(selector)).forEach(function (el) {
                            apply(el, cfg.options || {});
                        });
                    }
                });
            });
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", autoInit);
    } else {
        autoInit();
    }

    global.NeonBorder = { apply: apply, Instance: NeonBorderInstance };
})(window);

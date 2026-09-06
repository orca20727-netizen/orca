/*!
 * variable-weight-headings.js
 * Vanilla-JS port of the "Dynamic Weight" (VariableFontCursorProximity)
 * Originkit/Framer component, adapted for ORCA INSIGHT (plain HTML/CSS/
 * JS + Tailwind — no React/Framer Motion in this project, so the .tsx
 * component is re-implemented here with the same math: each letter's
 * font-variation-settings `wght` axis morphs from a resting weight to
 * a heavier weight based on how close the cursor is to that letter,
 * eased over time.
 *
 * USAGE
 * Add, right before </body> (after neon-border.js is fine):
 *   <script src="variable-weight-headings.js"></script>
 *
 * On load it finds every heading matching the default selector,
 * splits its text into per-letter <span>s, and morphs each letter's
 * weight as the cursor passes near it. It also watches the DOM
 * (MutationObserver) so headings injected later by app.js — DAG node
 * titles, satellite card titles, bulletin titles — get the effect too.
 *
 * WHAT IT SKIPS ON PURPOSE
 * Headings using a background-clip:text gradient (ORCA INSIGHT's own
 * "text-gradient" class, or Tailwind's bg-clip-text + text-transparent)
 * are skipped by default. Splitting a gradient-clipped heading into
 * per-letter spans breaks the single smooth gradient into one mini
 * gradient per letter, which usually looks wrong rather than better.
 * If you actually want that look on a specific heading, add
 * data-varweight-force="true" to it and it'll be split anyway.
 *
 * CUSTOMIZING
 * - Global: define before the script tag —
 *     window.VarWeightConfig = {
 *       selector: "h1, h2, h3, h4, h5",
 *       fromWeight: 500, toWeight: 900, strength: 25, duration: 0.3
 *     };
 * - Per-heading: data attributes on the element —
 *     <h3 data-varweight-from="400" data-varweight-to="800" data-varweight-strength="40">
 * - Manually apply to something outside the default selector:
 *     VariableWeight.apply("#myHeading", { toWeight: 850 });
 */
(function (global) {
    "use strict";

    var MAX_REACH = 800; // px, at strength = 100

    var DEFAULTS = {
        selector: "h1, h2, h3, h4, h5",
        fromWeight: 500,
        toWeight: 900,
        strength: 25,
        duration: 0.3 // seconds, easing time constant
    };

    var FONT_STACK = '"InterVariableFramer", "Inter Variable", "Inter", system-ui, sans-serif';

    var FONT_FACE_CSS =
        '@font-face{font-family:"InterVariableFramer";' +
        'src:url("https://rsms.me/inter/font-files/InterVariable.woff2?v=4.0") format("woff2-variations");' +
        'font-weight:100 900;font-style:normal;font-display:swap;}' +
        '@font-face{font-family:"InterVariableFramer";' +
        'src:url("https://rsms.me/inter/font-files/InterVariable-Italic.woff2?v=4.0") format("woff2-variations");' +
        'font-weight:100 900;font-style:italic;font-display:swap;}' +
        '.varweight-host{font-family:' + FONT_STACK + ';}' +
        '.varweight-letter{display:inline-block;}' +
        '.varweight-word{display:inline-block;white-space:nowrap;}' +
        '.varweight-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
        'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0;}';

    function injectStylesOnce() {
        if (document.getElementById("varweight-styles")) return;
        var style = document.createElement("style");
        style.id = "varweight-styles";
        style.textContent = FONT_FACE_CSS;
        document.head.appendChild(style);
    }

    function isGradientText(el) {
        var cls = el.className || "";
        if (typeof cls !== "string") cls = String(cls);
        return /\btext-gradient\b/.test(cls) ||
            (/\bbg-clip-text\b/.test(cls) && /\btext-transparent\b/.test(cls));
    }

    function readOpts(el) {
        var d = el.dataset;
        var o = {};
        if (d.varweightFrom) o.fromWeight = parseFloat(d.varweightFrom);
        if (d.varweightTo) o.toWeight = parseFloat(d.varweightTo);
        if (d.varweightStrength) o.strength = parseFloat(d.varweightStrength);
        if (d.varweightDuration) o.duration = parseFloat(d.varweightDuration);
        return o;
    }

    // ---- One instance per split heading -----------------------------------

    function Instance(el, opts) {
        this.el = el;
        this.opts = Object.assign({}, DEFAULTS, opts);
        this.letters = [];   // {span, factor}
        this.reach = Math.max(1, (Math.max(1, Math.min(100, this.opts.strength)) / 100) * MAX_REACH);
        this.fromSettings = "'wght' " + this.opts.fromWeight;
        this._split();
    }

    Instance.prototype._split = function () {
        var el = this.el;
        var text = el.textContent;
        el.textContent = "";
        el.classList.add("varweight-host");

        var srOnly = document.createElement("span");
        srOnly.className = "varweight-sr-only";
        srOnly.textContent = text;
        el.appendChild(srOnly);

        var self = this;
        var words = text.split(" ");
        words.forEach(function (word, wi) {
            var wordSpan = document.createElement("span");
            wordSpan.className = "varweight-word";
            wordSpan.setAttribute("aria-hidden", "true");

            word.split("").forEach(function (ch) {
                var letterSpan = document.createElement("span");
                letterSpan.className = "varweight-letter";
                letterSpan.style.fontVariationSettings = self.fromSettings;
                letterSpan.textContent = ch;
                wordSpan.appendChild(letterSpan);
                self.letters.push({ span: letterSpan, factor: 0 });
            });

            el.appendChild(wordSpan);
            if (wi < words.length - 1) {
                var space = document.createElement("span");
                space.setAttribute("aria-hidden", "true");
                space.style.display = "inline-block";
                space.innerHTML = "&nbsp;";
                el.appendChild(space);
            }
        });
    };

    Instance.prototype.tick = function (mouseX, mouseY, dtSec) {
        if (this.letters.length === 0) return;
        var o = this.opts;
        var tau = Math.max(0.016, o.duration);
        var a = 1 - Math.exp(-dtSec / tau);

        for (var i = 0; i < this.letters.length; i++) {
            var item = this.letters[i];
            var rect = item.span.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            var dx = mouseX - cx;
            var dy = mouseY - cy;
            var dist = Math.sqrt(dx * dx + dy * dy);

            var target = Math.min(Math.max(1 - dist / this.reach, 0), 1);
            var f = item.factor + (target - item.factor) * a;
            item.factor = f;

            if (f < 0.001) {
                if (item.span.style.fontVariationSettings !== this.fromSettings) {
                    item.span.style.fontVariationSettings = this.fromSettings;
                }
                continue;
            }
            var w = Math.round(o.fromWeight + (o.toWeight - o.fromWeight) * f);
            item.span.style.fontVariationSettings = "'wght' " + w;
        }
    };

    // ---- Global engine: one mousemove listener + one rAF loop -------------

    var instances = [];
    var registry = new WeakMap();
    var mouseX = -99999, mouseY = -99999;
    var lastFrame = 0;
    var started = false;

    function onPointerMove(clientX, clientY) {
        mouseX = clientX;
        mouseY = clientY;
    }

    function startEngine() {
        if (started) return;
        started = true;
        window.addEventListener("mousemove", function (ev) {
            onPointerMove(ev.clientX, ev.clientY);
        });
        window.addEventListener("touchmove", function (ev) {
            if (ev.touches.length === 0) return;
            onPointerMove(ev.touches[0].clientX, ev.touches[0].clientY);
        });

        function frame(now) {
            var dtSec = Math.min(0.1, Math.max(0, (now - (lastFrame || now)) / 1000));
            lastFrame = now;
            for (var i = 0; i < instances.length; i++) {
                instances[i].tick(mouseX, mouseY, dtSec);
            }
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function apply(selectorOrEl, opts) {
        injectStylesOnce();
        startEngine();
        var els = typeof selectorOrEl === "string"
            ? Array.prototype.slice.call(document.querySelectorAll(selectorOrEl))
            : [selectorOrEl];

        els.forEach(function (el) {
            if (!el || registry.has(el)) return;
            if (el.children.length > 0 && el.querySelector("*")) {
                // Heading already contains child elements (icons, nested
                // markup) rather than plain text — skip to avoid mangling it.
                return;
            }
            if (isGradientText(el) && el.dataset.varweightForce !== "true") return;
            if (!el.textContent || !el.textContent.trim()) return;

            var instance = new Instance(el, Object.assign({}, opts, readOpts(el)));
            registry.set(el, instance);
            instances.push(instance);
        });
    }

    function autoInit() {
        var cfg = global.VarWeightConfig || {};
        var selector = cfg.selector || DEFAULTS.selector;
        var opts = {
            fromWeight: cfg.fromWeight,
            toWeight: cfg.toWeight,
            strength: cfg.strength,
            duration: cfg.duration
        };
        Object.keys(opts).forEach(function (k) { if (opts[k] === undefined) delete opts[k]; });

        apply(selector, opts);

        var mo = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (node.nodeType !== 1) return;
                    if (node.matches && node.matches(selector)) apply(node, opts);
                    if (node.querySelectorAll) {
                        Array.prototype.slice.call(node.querySelectorAll(selector)).forEach(function (el) {
                            apply(el, opts);
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

    global.VariableWeight = { apply: apply };
})(window);

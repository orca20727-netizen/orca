// react-components.js
// React component templates for ORCA INSIGHT, mounted alongside the
// existing vanilla app.js -- no build step, no rewrite of anything that
// already works. Loaded via <script type="text/babel" src="react-components.js">,
// so Babel (loaded in index.html <head>) transpiles this JSX in-browser
// automatically once the page loads.
//
// NOTE: only JSX is transpiled here, not TypeScript. Any pasted template
// written in .tsx needs its type annotations stripped first (interfaces,
// ": SomeType", generics like Required<X>, "as Foo" casts) -- the runtime
// logic is unaffected, only the type-checking layer is removed.
//
// HOW TO ADD A NEW TEMPLATE:
//   1. Paste the component's JSX/function body in below (strip TypeScript
//      types and any Next.js-only bits: "use client", next/image, next/link).
//   2. Add a mount point in index.html: <div id="reactMount-yourThing"></div>
//   3. At the bottom of this file, call:
//        mount("reactMount-yourThing", React.createElement(YourComponent, {props}));
//   4. Add react-components.js to the Dockerfile's COPY line (see RAILWAY notes).
//
// Every mount is independent -- if one component errors, it won't take
// down app.js or any other mounted component.

// =======================================================================
// CloudSky -- ambient WebGL cloudscape background (ported from Originkit,
// TypeScript types stripped -- logic is unchanged from the original).
// =======================================================================

var CloudSky_MAX_DPR = 2;

var CloudSky_PUFF_UP = 0.34;
var CloudSky_PUFF_DOWN = 0.19;
var CloudSky_ERODE = 0.7;
var CloudSky_SHADOW_STEP = 0.085;
var CloudSky_NEAR_CELL = 1.05;
var CloudSky_FAR_CELL = 2.15;
var CloudSky_FAR_MIX = 0.55;
var CloudSky_NEAR_DRIFT = 0.055;
var CloudSky_FAR_DRIFT = 0.026;
var CloudSky_CIRRUS_DRIFT = 0.014;
var CloudSky_PUFF_WMAX = 2.15;
var CloudSky_SHADE_BLEND = 12.0;

var CloudSky_VERT_SRC = [
  "attribute vec2 a_pos;",
  "void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }"
].join("\n");

var CloudSky_FRAG_SRC = [
  "#ifdef GL_FRAGMENT_PRECISION_HIGH",
  "precision highp float;",
  "#else",
  "precision mediump float;",
  "#endif",
  "",
  "uniform vec2 uRes;",
  "uniform float uNearX, uFarX, uCirrusX;",
  "uniform float uCoverage, uSize, uSoftness, uShadow, uCirrus;",
  "uniform vec3 uZenith, uHorizon, uCloud;",
  "uniform vec4 uGlow;",
  "uniform vec2 uSun;",
  "uniform vec2 uParallax;",
  "",
  "vec2 hash22(vec2 p){",
  "  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));",
  "  q += dot(q, q.yzx + 33.33);",
  "  return fract((q.xx + q.yz) * q.zy);",
  "}",
  "",
  "float hash12(vec2 p){",
  "  vec3 q = fract(vec3(p.xyx) * 0.1031);",
  "  q += dot(q, q.yzx + 33.33);",
  "  return fract((q.x + q.y) * q.z);",
  "}",
  "",
  "float vnoise(vec2 x){",
  "  vec2 i = floor(x), f = fract(x);",
  "  f = f * f * (3.0 - 2.0 * f);",
  "  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),",
  "             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);",
  "}",
  "",
  "float fbm(vec2 p){",
  "  float a = 0.5, s = 0.0;",
  "  for (int i = 0; i < 4; i++){",
  "    s += a * vnoise(p);",
  "    p *= 2.03;",
  "    a *= 0.5;",
  "  }",
  "  return s;",
  "}",
  "",
  "vec2 blobs(vec2 uv, float seed){",
  "  vec2 id = floor(uv), f = fract(uv);",
  "  float best = -1e4;",
  "  float wsum = 0.0, ysum = 0.0;",
  "  float wMax = min(" + CloudSky_PUFF_WMAX.toFixed(3) + ", 0.72 * uSize);",
  "  float reach = min(2.0, ceil(wMax + 0.85) - 1.0);",
  "  for (int j = -2; j <= 2; j++){",
  "    for (int i = -2; i <= 2; i++){",
  "      vec2 o = vec2(float(i), float(j));",
  "      if (max(abs(o.x), abs(o.y)) > reach) continue;",
  "      vec2 h = hash22(id + o + seed);",
  "      if (fract(h.x * 37.1) > uCoverage) continue;",
  "      vec2 c = o + 0.15 + h * 0.7;",
  "      float w = min(" + CloudSky_PUFF_WMAX.toFixed(3) + ", (0.30 + 0.42 * fract(h.y * 19.7)) * uSize);",
  "      vec2 d = f - c;",
  "      float ry = (d.y > 0.0 ? " + CloudSky_PUFF_UP.toFixed(3) + " : " + CloudSky_PUFF_DOWN.toFixed(3) + ") * uSize * (0.8 + 0.5 * fract(h.y * 7.3));",
  "      float e = length(vec2(d.x / max(w, 1e-3), d.y / max(ry, 1e-3)));",
  "      float val = 1.0 - e;",
  "      float yN = d.y / max(ry, 1e-3);",
  "      if (val > best){",
  "        float k = exp(" + CloudSky_SHADE_BLEND.toFixed(1) + " * (best - val));",
  "        wsum = wsum * k + 1.0;",
  "        ysum = ysum * k + yN;",
  "        best = val;",
  "      } else {",
  "        float g = exp(" + CloudSky_SHADE_BLEND.toFixed(1) + " * (val - best));",
  "        wsum += g;",
  "        ysum += g * yN;",
  "      }",
  "    }",
  "  }",
  "  return vec2(best, ysum / max(wsum, 1e-4));",
  "}",
  "",
  "vec2 cloudField(vec2 uv, float seed, float detailScale){",
  "  vec2 b = blobs(uv, seed);",
  "  float n = fbm(uv * detailScale + seed * 3.1) * 0.72",
  "          + fbm(uv * detailScale * 3.3 + seed * 7.7) * 0.28;",
  "  return vec2(b.x - (1.0 - n) * " + CloudSky_ERODE.toFixed(3) + ", b.y);",
  "}",
  "",
  "vec3 shadeCloud(float dyNorm, vec3 sky){",
  "  float t = smoothstep(-0.95, 0.25, dyNorm);",
  "  vec3 base = mix(uCloud * 0.52, sky, 0.34);",
  "  return mix(mix(uCloud, base, uShadow), uCloud, t);",
  "}",
  "",
  "void main(){",
  "  vec2 frag = gl_FragCoord.xy / max(uRes.y, 1.0);",
  "  float aspect = uRes.x / max(uRes.y, 1.0);",
  "  vec2 p = vec2(frag.x, frag.y);",
  "",
  "  vec3 sky = mix(uHorizon, uZenith, smoothstep(-0.15, 1.05, p.y));",
  "  vec2 sunP = vec2(uSun.x * aspect, uSun.y);",
  "  float sd = length(p - sunP);",
  "  sky += uGlow.rgb * uGlow.a * exp(-sd * 3.4) * 0.30;",
  "",
  "  vec3 col = sky;",
  "",
  "  if (uCirrus > 0.0) {",
  "    vec2 cuv = vec2(p.x * 1.4 + uCirrusX, p.y * 5.5);",
  "    float veil = fbm(cuv) * fbm(cuv * 2.3 + 9.0);",
  "    veil = smoothstep(0.24, 0.55, veil) * smoothstep(0.15, 0.7, p.y);",
  "    col = mix(col, uCloud, veil * uCirrus * 0.5);",
  "  }",
  "",
  "  vec2 fuv = vec2(p.x + uFarX, p.y) * " + CloudSky_FAR_CELL.toFixed(3) + " + uParallax * 0.4;",
  "  vec2 fd = cloudField(fuv, 17.0, 11.0);",
  "  float fa = clamp(fd.x * uSoftness, 0.0, 1.0);",
  "  if (fa > 0.0) {",
  "    vec3 lit = shadeCloud(fd.y, sky);",
  "    col = mix(col, mix(lit, sky, " + CloudSky_FAR_MIX.toFixed(3) + "), fa);",
  "  }",
  "",
  "  vec2 nuv = vec2(p.x + uNearX, p.y) * " + CloudSky_NEAR_CELL.toFixed(3) + " + uParallax;",
  "  vec2 nd = cloudField(nuv, 3.0, 8.5);",
  "  float na = clamp(nd.x * uSoftness, 0.0, 1.0);",
  "  if (na > 0.0) {",
  "    vec3 lit = shadeCloud(nd.y, sky);",
  "    float above = clamp(cloudField(nuv + vec2(0.0, " + CloudSky_SHADOW_STEP.toFixed(3) + "), 3.0, 8.5).x * uSoftness, 0.0, 1.0);",
  "    lit *= 1.0 - 0.18 * uShadow * above;",
  "    lit += uGlow.rgb * uGlow.a * 0.22 * exp(-length(p - sunP) * 1.6);",
  "    col = mix(col, lit, na);",
  "  }",
  "",
  "  gl_FragColor = vec4(col, 1.0);",
  "}"
].join("\n");

function CloudSky_compile(gl, type, src) {
  var sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("CloudSky shader:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function CloudSky_parseColor(input, fb) {
  if (!input) return fb;
  var str = String(input).trim();
  if (str.charAt(0) === "#") {
    var hex = str.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + (hex.length === 4 ? hex[3] + hex[3] : "");
    }
    if (hex.length >= 6) {
      var r = parseInt(hex.slice(0, 2), 16);
      var g = parseInt(hex.slice(2, 4), 16);
      var b = parseInt(hex.slice(4, 6), 16);
      var a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return [r / 255, g / 255, b / 255, a];
    }
    return fb;
  }
  var m = str.match(/[\d.]+/g);
  if (m && m.length >= 3) {
    return [
      Math.min(255, parseFloat(m[0])) / 255,
      Math.min(255, parseFloat(m[1])) / 255,
      Math.min(255, parseFloat(m[2])) / 255,
      m.length >= 4 ? Math.min(1, parseFloat(m[3])) : 1
    ];
  }
  return fb;
}

function CloudSky_num(v, fb) {
  return typeof v === "number" && isFinite(v) ? v : fb;
}

function CloudSky_clampN(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

var CloudSky_CLOUD_DEFAULTS = { softness: 100, shadow: 100, cirrus: 45 };
var CloudSky_SUN_DEFAULTS = { x: 78, y: 92, glow: "rgba(232, 243, 255, 0.9)" };
var CloudSky_POINTER_DEFAULTS = { parallax: 100, wind: 100, damping: 20 };

function CloudSkyBase(props) {
  props = props || {};
  var style = props.style;
  var background = props.background !== undefined ? props.background : "#0075FF";
  var baseColor = props.baseColor !== undefined ? props.baseColor : "#B4D2F0";
  var accentColor = props.accentColor !== undefined ? props.accentColor : "#FFFFFF";
  var density = props.density !== undefined ? props.density : 100;
  var speed = props.speed !== undefined ? props.speed : 64;
  var size = props.size !== undefined ? props.size : 130;
  var clouds = props.clouds;
  var sun = props.sun;
  var pointer = props.pointer;
  var width = props.width;
  var height = props.height;

  var clouds_ = Object.assign({}, CloudSky_CLOUD_DEFAULTS, clouds || {});
  var sun_ = Object.assign({}, CloudSky_SUN_DEFAULTS, sun || {});
  var pointer_ = Object.assign({}, CloudSky_POINTER_DEFAULTS, pointer || {});

  var canvasRef = React.useRef(null);
  var sizeRef = React.useRef({ w: 0, h: 0 });
  sizeRef.current = { w: CloudSky_num(width, 0), h: CloudSky_num(height, 0) };

  var vRef = React.useRef({});
  vRef.current = {
    zenith: background,
    horizon: baseColor,
    cloud: accentColor,
    glow: sun_.glow,
    coverage: CloudSky_clampN(CloudSky_num(density, 55), 0, 100) / 100,
    speed: CloudSky_clampN(CloudSky_num(speed, 50), 0, 100) / 50,
    size: CloudSky_clampN(CloudSky_num(size, 100), 20, 300) / 100,
    softness: 4.5 / Math.max(0.15, CloudSky_clampN(CloudSky_num(clouds_.softness, 100), 20, 300) / 100),
    shadow: CloudSky_clampN(CloudSky_num(clouds_.shadow, 100), 0, 200) / 100,
    cirrus: CloudSky_clampN(CloudSky_num(clouds_.cirrus, 45), 0, 100) / 100,
    sunX: CloudSky_clampN(CloudSky_num(sun_.x, 78), 0, 100) / 100,
    sunY: CloudSky_clampN(CloudSky_num(sun_.y, 92), 0, 100) / 100,
    parallax: CloudSky_clampN(CloudSky_num(pointer_.parallax, 100), 0, 300) / 100,
    wind: CloudSky_clampN(CloudSky_num(pointer_.wind, 100), 0, 300) / 100,
    damping: CloudSky_clampN(CloudSky_num(pointer_.damping, 20), 1, 100)
  };

  var ptrRef = React.useRef({ x: 0, y: 0, inside: false });

  React.useEffect(function () {
    var canvas = canvasRef.current;
    if (!canvas) return;
    var gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false });
    if (!gl) {
      console.error("CloudSky: WebGL unavailable");
      return;
    }

    var vs = CloudSky_compile(gl, gl.VERTEX_SHADER, CloudSky_VERT_SRC);
    var fs = CloudSky_compile(gl, gl.FRAGMENT_SHADER, CloudSky_FRAG_SRC);
    if (!vs || !fs) return;
    var prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("CloudSky link:", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var locs = {};
    function u(name) {
      if (!(name in locs)) locs[name] = gl.getUniformLocation(prog, name);
      return locs[name];
    }

    var raf = 0;
    var last = performance.now();
    var nearX = 0;
    var farX = 0;
    var cirrusX = 0;
    var leanX = 0;
    var leanY = 0;

    function render(now) {
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      var v = vRef.current;
      var p = ptrRef.current;

      var k = 1 - Math.exp(-v.damping * 0.12 * dt);
      leanX += ((p.inside ? p.x : 0) - leanX) * k;
      leanY += ((p.inside ? p.y : 0) - leanY) * k;

      var gust = 1 + leanX * v.wind;
      var rate = v.speed * gust;
      nearX = (nearX - CloudSky_NEAR_DRIFT * rate * dt) % 1000;
      farX = (farX - CloudSky_FAR_DRIFT * rate * dt) % 1000;
      cirrusX = (cirrusX - CloudSky_CIRRUS_DRIFT * rate * dt) % 1000;

      var dpr = Math.min(window.devicePixelRatio || 1, CloudSky_MAX_DPR);
      var cw = sizeRef.current.w || canvas.clientWidth || 1200;
      var ch = sizeRef.current.h || canvas.clientHeight || 800;
      var bw = Math.max(1, Math.round(cw * dpr));
      var bh = Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      gl.viewport(0, 0, bw, bh);

      var zen = CloudSky_parseColor(v.zenith, [0.369, 0.576, 0.824, 1]);
      var hor = CloudSky_parseColor(v.horizon, [0.706, 0.824, 0.941, 1]);
      var cld = CloudSky_parseColor(v.cloud, [1, 1, 1, 1]);
      var glow = CloudSky_parseColor(v.glow, [0.91, 0.953, 1, 0.9]);

      gl.uniform2f(u("uRes"), bw, bh);
      gl.uniform1f(u("uNearX"), nearX);
      gl.uniform1f(u("uFarX"), farX);
      gl.uniform1f(u("uCirrusX"), cirrusX);
      gl.uniform1f(u("uCoverage"), v.coverage);
      gl.uniform1f(u("uSize"), v.size);
      gl.uniform1f(u("uSoftness"), v.softness);
      gl.uniform1f(u("uShadow"), v.shadow);
      gl.uniform1f(u("uCirrus"), v.cirrus);
      gl.uniform2f(u("uSun"), v.sunX, v.sunY);
      gl.uniform2f(u("uParallax"), -leanX * v.parallax * 0.07, -leanY * v.parallax * 0.05);
      gl.uniform3f(u("uZenith"), zen[0], zen[1], zen[2]);
      gl.uniform3f(u("uHorizon"), hor[0], hor[1], hor[2]);
      gl.uniform3f(u("uCloud"), cld[0], cld[1], cld[2]);
      gl.uniform4f(u("uGlow"), glow[0], glow[1], glow[2], glow[3]);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(render);
    }

    function track(e) {
      var r = canvas.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      ptrRef.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptrRef.current.y = 1 - ((e.clientY - r.top) / r.height) * 2;
      ptrRef.current.inside = true;
    }
    function onLeave() {
      ptrRef.current.inside = false;
    }

    canvas.addEventListener("pointermove", track);
    canvas.addEventListener("pointerenter", track);
    canvas.addEventListener("pointerleave", onLeave);

    raf = requestAnimationFrame(render);

    return function () {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", track);
      canvas.removeEventListener("pointerenter", track);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return React.createElement(
    "div",
    {
      style: Object.assign(
        {
          position: "relative",
          overflow: "hidden",
          background: background,
          isolation: "isolate",
          width: typeof width === "number" && width > 0 ? width : "100%",
          height: typeof height === "number" && height > 0 ? height : "100%"
        },
        style || {}
      )
    },
    React.createElement(canvasRef ? "canvas" : "canvas", {
      ref: canvasRef,
      style: { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }
    })
  );
}

var CloudSky_presetProps = {
  clouds: { cirrus: 100, shadow: 70, softness: 200 },
  sun: { x: 100, y: 100, glow: "#FFFFFF" },
  pointer: { wind: 300, damping: 50, parallax: 300 }
};

function CloudSky(props) {
  var merged = Object.assign({}, CloudSky_presetProps, props || {});
  return React.createElement(CloudSkyBase, merged);
}

// -- Mounts. Add one line per template you drop in. --------------------

(function mountAll() {
  function mount(id, element) {
    var host = document.getElementById(id);
    if (!host) return; // mount point not on this page/tab -- skip quietly
    ReactDOM.createRoot(host).render(element);
  }

  // Ambient background: CloudSky, replacing BeyondHorizon. Colors tinted to
  // fit ORCA's dark navy/cyan theme instead of the component's bright default
  // daytime sky -- tweak these to taste, every color here is just a prop.
  mount(
    "beyondHorizonHost",
    React.createElement(CloudSky, {
      background: "#04101c",
      baseColor: "#0a1f33",
      accentColor: "#3d5a72",
      density: 40,
      speed: 40,
      size: 130,
      clouds: { cirrus: 12, shadow: 90, softness: 160 },
      sun: { x: 82, y: 88, glow: "rgba(120, 190, 220, 0.35)" }
    })
  );
})();

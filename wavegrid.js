// Wave Grid — Originkit (vanilla JS build)
//
// Adapted from franky-adl/3d-wave-grid. The mechanism is his; the framing,
// controls and the click ripple are not.
//
// This is a plain-JS / three.js port of the original React component so it
// can be dropped into a static HTML page with:
//
//   <script type="importmap">
//   { "imports": { "three": "https://unpkg.com/three@0.160.0/build/three.module.js" } }
//   </script>
//   <script type="module">
//     import { createWaveGrid } from "./wavegrid.js";
//     createWaveGrid(document.getElementById("waveGridBg"), { ...options });
//   </script>
//
// createWaveGrid(container, config) builds the scene inside `container`,
// starts the render loop, and wires up a ResizeObserver. It returns a handle
// with update(config) and dispose() methods.
//
// See the original component for the full design notes on why the shader is
// built the way it is (averaged-not-summed trail weights, the asymmetric
// window, RGBADepthPacking for the shadow pass, etc.) — those comments are
// preserved inline below.

import * as THREE from "three"

const DEFAULTS = {
    base: "#FFFFFF",
    crest: "#00FFFF",
    grid: 20,
    gap: 2,
    amplitude: 20,
    waveSpeed: 6,
    trail: 9,
    tilt: 4,
    shadows: true,
    sizePercent: 200,
}

// Must match MAX_TRAIL in the shader and the divisor in the texel lookup. The
// loop bound has to be a compile-time constant, so this is a define rather than
// a uniform, and the live count only ever shortens it.
const MAX_TRAIL = 128

// The blocks are far taller than the wave ever lifts them, so their sides fill
// the gaps at a glancing angle and the field reads as solid rather than as a
// scatter of tiles. Neither was worth a control.
const CUBE_WIDTH = 0.8
const CUBE_HEIGHT = 3

/*
 * The panel used to own all of these. They are pinned at the values the field
 * was shipped looking like: every one of them was a slider whose whole useful
 * range was a few steps either side of this number, which is a constant with
 * extra work attached rather than a control.
 */
const WAVE_FREQ = 1.2
const WAVE_WIDTH = 3.12
const JITTER = 0.2
const RIPPLE_STRENGTH = 3.04
const PARALLAX = 0.048

function clamp(v, lo, hi, fallback) {
    const n = typeof v === "number" && isFinite(v) ? v : fallback
    return Math.max(lo, Math.min(hi, n))
}

/** Panel values are whole numbers; the scene wants the real ones. */
function settingsFor(cfg) {
    const grid = 2 * Math.round(11 + clamp(cfg.grid, 1, 20, DEFAULTS.grid)) - 1
    const gap = clamp(cfg.gap, 0, 20, DEFAULTS.gap) * 0.025
    return {
        grid,
        gap,
        bounds: grid * (CUBE_WIDTH + gap),
        waveSpeed: 1.0 + clamp(cfg.waveSpeed, 1, 20, DEFAULTS.waveSpeed) * 0.85,
        frequency: WAVE_FREQ,
        waveWidth: WAVE_WIDTH,
        amplitude: clamp(cfg.amplitude, 0, 20, DEFAULTS.amplitude) * 0.075,
        maxHeight: 0.15 + clamp(cfg.amplitude, 0, 20, DEFAULTS.amplitude) * 0.055,
        jitter: JITTER,
        fadeTime: 0.3 + clamp(cfg.trail, 1, 20, DEFAULTS.trail) * 0.22,
        trailSpacing: 0.14,
        rippleStrength: RIPPLE_STRENGTH,
        tilt: clamp(cfg.tilt, 0, 20, DEFAULTS.tilt) * 0.035,
        parallax: PARALLAX,
        span: 0.5 * (100 / clamp(cfg.sizePercent, 20, 200, 100)),
    }
}

/**
 * Splices the wave displacement into one of three's own vertex shaders.
 */
function overrideVertex(vertexShader) {
    return vertexShader
        .replace(
            "#include <common>",
            /* glsl */ `#include <common>
            #define MAX_TRAIL ${MAX_TRAIL}
            varying float vHeight;
            attribute vec2 aOffset;
            uniform sampler2D uTrailTexture;
            uniform int   uTrailCount;
            uniform float uWaveSpeed;
            uniform float uWaveFreq;
            uniform float uWaveWidth;
            uniform float uFadeTime;
            uniform float uAmplitude;
            uniform float uJitter;
            uniform float uMaxHeight;

            vec2 hash2(vec2 p) {
                p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
                return fract(sin(p) * 43758.5453123) - 0.5;
            }`
        )
        .replace(
            "#include <begin_vertex>",
            /* glsl */ `#include <begin_vertex>

            vHeight = 0.0;

            if (position.y > 0.0) {
                vec2 worldXZ = aOffset + hash2(aOffset) * uJitter;
                float waveHeight = 0.0;
                float totalWeight = 0.0;

                for (int i = 0; i < MAX_TRAIL; i++) {
                    if (i >= uTrailCount) break;

                    vec4 td = texture2D(
                        uTrailTexture,
                        vec2((float(i) + 0.5) / float(MAX_TRAIL), 0.5)
                    );

                    float dist = length(worldXZ - td.rg);
                    float relDist = dist - uWaveSpeed * td.b;

                    float lead = uWaveWidth * (relDist > 0.0 ? 0.3 : 1.0);
                    float window = exp(-(relDist * relDist) / (lead * lead));
                    float fade = exp(-td.b / uFadeTime);
                    float atten = 1.0 / (1.0 + dist * 0.1);
                    float weight = fade * window * atten * td.a;

                    waveHeight += weight * (0.5 + 0.5 * cos(uWaveFreq * relDist));
                    totalWeight += weight;
                }

                waveHeight /= max(totalWeight, 1.0);

                float displacement = clamp(waveHeight * uAmplitude, 0.0, uMaxHeight);
                transformed.y += displacement;
                vHeight = displacement;
            }`
        )
}

class WaveGridScene {
    constructor(container, cfg) {
        this.container = container
        this.cfg = cfg

        this.scene = new THREE.Scene()
        this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300)

        this.geometry = null
        this.offsets = null
        this.mesh = null

        this.waveUniforms = {
            uTrailTexture: { value: null },
            uTrailCount: { value: 0 },
            uFadeTime: { value: 2 },
            uWaveSpeed: { value: 6 },
            uWaveFreq: { value: 1.2 },
            uWaveWidth: { value: 3 },
            uAmplitude: { value: 0.4 },
            uJitter: { value: 0.2 },
            uMaxHeight: { value: 0.4 },
        }
        this.colorUniforms = {
            uColorBase: { value: new THREE.Color(DEFAULTS.base) },
            uColorHigh: { value: new THREE.Color(DEFAULTS.crest) },
        }

        this.trail = []
        this.trailData = new Float32Array(MAX_TRAIL * 4)
        this.lastPoint = null

        this.raycaster = new THREE.Raycaster()
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        this.ndc = new THREE.Vector2()
        this.hit = new THREE.Vector3()

        this.pointer = new THREE.Vector2()
        this.easedPointer = new THREE.Vector2()

        this.builtGrid = 0
        this.builtGap = -1

        this.width = 0
        this.height = 0
        this.frameId = 0
        this.lastT = 0
        this.disposed = false
        this.unbind = () => {}

        const S = settingsFor(cfg)

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        this.renderer.outputColorSpace = THREE.SRGBColorSpace
        this.renderer.setClearColor(0x000000, 0)
        this.renderer.shadowMap.enabled = cfg.shadows !== false
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
        const el = this.renderer.domElement
        el.style.position = "absolute"
        el.style.inset = "0"
        el.style.width = "100%"
        el.style.height = "100%"
        el.style.touchAction = "none"
        el.style.cursor = "crosshair"
        container.appendChild(el)

        this.trailTexture = new THREE.DataTexture(
            this.trailData,
            MAX_TRAIL,
            1,
            THREE.RGBAFormat,
            THREE.FloatType
        )
        this.trailTexture.minFilter = THREE.NearestFilter
        this.trailTexture.magFilter = THREE.NearestFilter
        this.trailTexture.needsUpdate = true
        this.waveUniforms.uTrailTexture.value = this.trailTexture

        this.ambient = new THREE.AmbientLight(0xffffff, 0.5)
        this.scene.add(this.ambient)

        this.keyLight = new THREE.DirectionalLight(0xffffff, 4.0)
        this.keyLight.position.set(-20, 10, 6)
        this.keyLight.castShadow = true
        this.keyLight.shadow.mapSize.set(1024, 1024)
        this.keyLight.shadow.radius = 6
        this.keyLight.shadow.camera.near = 0.1
        this.keyLight.shadow.camera.far = 80
        this.keyLight.shadow.bias = 0
        this.keyLight.shadow.normalBias = 0.04
        this.scene.add(this.keyLight)

        this.fillLight = new THREE.DirectionalLight(0xffffff, 1.0)
        this.fillLight.position.set(10, 5, -3)
        this.scene.add(this.fillLight)

        this.material = new THREE.MeshPhongMaterial({ color: 0xffffff })
        this.material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, this.waveUniforms, this.colorUniforms)
            shader.vertexShader = overrideVertex(shader.vertexShader)
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    "#include <common>",
                    /* glsl */ `#include <common>
                    varying float vHeight;
                    uniform vec3 uColorBase;
                    uniform vec3 uColorHigh;
                    uniform float uMaxHeight;`
                )
                .replace(
                    "#include <color_fragment>",
                    /* glsl */ `#include <color_fragment>
                    float lift = clamp(vHeight / uMaxHeight, 0.0, 1.0);
                    diffuseColor.rgb = mix(uColorBase, uColorHigh, lift);`
                )
        }
        this.material.needsUpdate = true

        this.depthMaterial = new THREE.MeshDepthMaterial({
            depthPacking: THREE.RGBADepthPacking,
        })
        this.depthMaterial.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, this.waveUniforms)
            shader.vertexShader = overrideVertex(shader.vertexShader)
        }
        this.depthMaterial.needsUpdate = true

        this.buildGrid()
        this.pushUniforms(S)
        this.bindEvents()
    }

    // ── Grid ────────────────────────────────────────────────────────────────

    buildGrid() {
        const S = settingsFor(this.cfg)
        const count = S.grid * S.grid

        this.geometry = new THREE.BoxGeometry(CUBE_WIDTH, CUBE_HEIGHT, CUBE_WIDTH)
        this.offsets = new THREE.InstancedBufferAttribute(
            new Float32Array(count * 2),
            2
        )
        this.geometry.setAttribute("aOffset", this.offsets)

        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count)
        this.mesh.customDepthMaterial = this.depthMaterial
        this.mesh.castShadow = true
        this.mesh.receiveShadow = true
        this.mesh.frustumCulled = false
        this.scene.add(this.mesh)

        this.builtGrid = S.grid
        this.builtGap = -1
        this.layoutGrid()
    }

    layoutGrid() {
        if (!this.mesh || !this.offsets) return
        const S = settingsFor(this.cfg)
        const spacing = CUBE_WIDTH + S.gap
        const origin = ((S.grid - 1) * spacing) / 2
        const dummy = new THREE.Object3D()

        for (let i = 0; i < S.grid; i++) {
            for (let j = 0; j < S.grid; j++) {
                const index = i * S.grid + j
                const x = i * spacing - origin
                const z = j * spacing - origin
                dummy.position.set(x, 0, z)
                dummy.updateMatrix()
                this.mesh.setMatrixAt(index, dummy.matrix)
                this.offsets.setXY(index, x, z)
            }
        }
        this.mesh.instanceMatrix.needsUpdate = true
        this.offsets.needsUpdate = true

        const reach = S.bounds * 0.7
        const sc = this.keyLight.shadow.camera
        sc.left = -reach
        sc.right = reach
        sc.top = reach
        sc.bottom = -reach
        sc.updateProjectionMatrix()

        this.builtGap = S.gap
        this.updateCamera()
    }

    destroyGrid() {
        if (this.mesh) {
            this.scene.remove(this.mesh)
            this.mesh.dispose()
            this.mesh = null
        }
        if (this.geometry) {
            this.geometry.dispose()
            this.geometry = null
        }
        this.offsets = null
    }

    // ── Camera ──────────────────────────────────────────────────────────────

    updateCamera() {
        if (this.disposed) return
        const S = settingsFor(this.cfg)
        const aspect = Math.max(1, this.width) / Math.max(1, this.height)

        const distance = 14

        const alpha = S.tilt + this.easedPointer.y * S.parallax * 4.0
        const beta = this.easedPointer.x * S.parallax * 6.0

        this.camera.position.set(
            -distance * Math.cos(alpha) * Math.sin(beta),
            distance * Math.cos(alpha) * Math.cos(beta),
            distance * Math.sin(alpha)
        )
        this.camera.up.set(0, 0, -1)
        this.camera.lookAt(0, 0, 0)

        const span = S.bounds * S.span
        const visibleHeight = aspect < 1 ? span / aspect : span
        this.camera.aspect = aspect
        this.camera.fov =
            2 * Math.atan(visibleHeight / 2 / distance) * (180 / Math.PI)
        this.camera.near = 0.1
        this.camera.far = distance + S.bounds * 2 + 20
        this.camera.updateProjectionMatrix()
    }

    // ── Disturbances ────────────────────────────────────────────────────────

    groundAt(e) {
        const rect = this.renderer.domElement.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return null
        this.ndc.set(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        )
        this.raycaster.setFromCamera(this.ndc, this.camera)
        return this.raycaster.ray.intersectPlane(this.groundPlane, this.hit)
    }

    addPoint(x, z, strength) {
        if (this.trail.length >= MAX_TRAIL) this.trail.shift()
        this.trail.push({ x, z, age: 0, strength })
    }

    bindEvents() {
        const el = this.renderer.domElement

        const onMove = (e) => {
            if (this.disposed) return
            const rect = el.getBoundingClientRect()
            if (rect.width > 0 && rect.height > 0) {
                this.pointer.set(
                    ((e.clientX - rect.left) / rect.width) * 2 - 1,
                    -((e.clientY - rect.top) / rect.height) * 2 + 1
                )
            }

            const p = this.groundAt(e)
            if (!p) return
            const S = settingsFor(this.cfg)

            let strength = 0.35
            if (this.lastPoint) {
                const dx = p.x - this.lastPoint.x
                const dz = p.z - this.lastPoint.z
                const moved = Math.sqrt(dx * dx + dz * dz)
                if (moved < S.trailSpacing) return
                strength = Math.min(moved, 1.2)
            }

            this.addPoint(p.x, p.z, strength)
            this.lastPoint = { x: p.x, z: p.z }
        }

        const onDown = (e) => {
            if (this.disposed) return
            const S = settingsFor(this.cfg)
            const p = this.groundAt(e)
            if (!p) return

            this.addPoint(p.x, p.z, S.rippleStrength)
            this.lastPoint = { x: p.x, z: p.z }
        }

        const onLeave = () => {
            this.pointer.set(0, 0)
            this.lastPoint = null
        }

        el.addEventListener("pointermove", onMove)
        el.addEventListener("pointerdown", onDown)
        el.addEventListener("pointerleave", onLeave)
        el.addEventListener("pointercancel", onLeave)

        this.unbind = () => {
            el.removeEventListener("pointermove", onMove)
            el.removeEventListener("pointerdown", onDown)
            el.removeEventListener("pointerleave", onLeave)
            el.removeEventListener("pointercancel", onLeave)
        }
    }

    // ── Frame ───────────────────────────────────────────────────────────────

    pushUniforms(S) {
        const u = this.waveUniforms
        u.uFadeTime.value = S.fadeTime
        u.uWaveSpeed.value = S.waveSpeed
        u.uWaveFreq.value = S.frequency
        u.uWaveWidth.value = S.waveWidth
        u.uAmplitude.value = S.amplitude
        u.uJitter.value = S.jitter
        u.uMaxHeight.value = S.maxHeight
    }

    start() {
        this.lastT = performance.now()
        const loop = () => {
            this.frameId = requestAnimationFrame(loop)
            this.step()
        }
        loop()
    }

    setSize(width, height) {
        if (this.disposed || width <= 0 || height <= 0) return
        this.width = width
        this.height = height
        this.renderer.setSize(width, height, false)
        this.updateCamera()
    }

    updateConfig(cfg) {
        if (this.disposed) return
        this.cfg = cfg
        const S = settingsFor(cfg)

        if (S.grid !== this.builtGrid) {
            this.destroyGrid()
            this.buildGrid()
        } else if (S.gap !== this.builtGap) {
            this.layoutGrid()
        }

        this.colorUniforms.uColorBase.value.set(cfg.base || DEFAULTS.base)
        this.colorUniforms.uColorHigh.value.set(cfg.crest || DEFAULTS.crest)
        this.pushUniforms(S)

        const shadows = cfg.shadows !== false
        if (this.renderer.shadowMap.enabled !== shadows) {
            this.renderer.shadowMap.enabled = shadows
            this.keyLight.castShadow = shadows
            this.material.needsUpdate = true
            this.depthMaterial.needsUpdate = true
        }

        this.updateCamera()
    }

    step() {
        if (this.disposed) return
        const now = performance.now()
        let dt = (now - this.lastT) / 1000
        this.lastT = now
        if (!isFinite(dt) || dt < 0) dt = 0
        if (dt > 0.05) dt = 0.05

        const S = settingsFor(this.cfg)

        const expiry = S.fadeTime * 4
        for (let i = this.trail.length - 1; i >= 0; i--) {
            this.trail[i].age += dt
            if (this.trail[i].age > expiry) this.trail.splice(i, 1)
        }

        const count = Math.min(this.trail.length, MAX_TRAIL)
        if (count > 0 || this.waveUniforms.uTrailCount.value > 0) {
            for (let i = 0; i < count; i++) {
                const t = this.trail[i]
                const o = i * 4
                this.trailData[o] = t.x
                this.trailData[o + 1] = t.z
                this.trailData[o + 2] = t.age
                this.trailData[o + 3] = t.strength
            }
            this.trailTexture.needsUpdate = true
            this.waveUniforms.uTrailCount.value = count
        }

        const k = 1 - Math.exp(-dt * 2.4)
        this.easedPointer.x += (this.pointer.x - this.easedPointer.x) * k
        this.easedPointer.y += (this.pointer.y - this.easedPointer.y) * k
        this.updateCamera()

        this.renderer.render(this.scene, this.camera)
    }

    dispose() {
        this.disposed = true
        cancelAnimationFrame(this.frameId)
        this.unbind()
        this.destroyGrid()
        this.material.dispose()
        this.depthMaterial.dispose()
        this.trailTexture.dispose()
        this.renderer.dispose()
        const el = this.renderer.domElement
        if (el.parentNode === this.container) this.container.removeChild(el)
    }
}

/**
 * Mounts the Wave Grid inside `container` (must be positioned, e.g.
 * position: relative/absolute/fixed, and have a non-zero size), starts the
 * render loop, and wires up resize handling automatically.
 *
 * Returns a handle:
 *   - update(newConfig)  → change colors/grid/amplitude/etc live
 *   - dispose()           → tear down the WebGL context and listeners
 *
 * Any option not passed falls back to the shipped default preset.
 */
export function createWaveGrid(container, config = {}) {
    const cfg = { ...DEFAULTS, ...config }

    let scene
    try {
        scene = new WaveGridScene(container, cfg)
    } catch (err) {
        // No WebGL — fail quietly rather than throwing into the page.
        console.warn("Wave Grid: could not initialize WebGL context.", err)
        return { update() {}, dispose() {} }
    }

    scene.setSize(container.clientWidth, container.clientHeight)
    scene.start()

    const ro = new ResizeObserver(() => {
        scene.setSize(container.clientWidth, container.clientHeight)
    })
    ro.observe(container)

    return {
        update(newConfig) {
            Object.assign(cfg, newConfig)
            scene.updateConfig(cfg)
        },
        dispose() {
            ro.disconnect()
            scene.dispose()
        },
    }
}

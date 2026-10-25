/**
 * Holographic placement-preview FX (pure helpers — no scene wiring here; the
 * scene integrator consumes these next phase).
 *
 * The ghost preview becomes a light-blue translucent hologram of the ACTUAL
 * component mesh: animated CRT scanlines scrolling slowly up in world-Y, a
 * fresnel rim glow, and a very subtle global flicker. Pin markers (glowing
 * ring + short light beam per target hole) show exactly where the legs land,
 * with a downward-travelling pulse in each beam so the pins read as "falling
 * into place".
 *
 * Intended scene usage:
 *
 *   // on ghost change (cheap — geometry is shared, materials are cached):
 *   const built = buildComponentObject(comp, entry, pinPositions)
 *   const holo = applyHologram(built.object, ok ? 'valid' : 'invalid')
 *   overlayGroup.add(holo)
 *   const markers = makePinMarkers(pinPositions, ok ? 'valid' : 'invalid')
 *   overlayGroup.add(markers.group)
 *
 *   // once per animation frame, before render (one number write):
 *   tickHolograms(elapsedSeconds)   // e.g. clock.getElapsedTime()
 *
 *   // honor prefers-reduced-motion (freezes scroll/flicker/pulse):
 *   setHologramReducedMotion(true)
 *
 *   // on ghost change / cancel:
 *   overlayGroup.remove(holo)       // clone shares geometry — nothing to free
 *   markers.dispose()
 *
 * Perf contract (README Known Issues / DESIGN.md §9): the two hologram
 * materials and the two marker material pairs are module-cached (page
 * lifetime, like meshes/shared.ts); all animation runs in the shaders off ONE
 * shared clock uniform, so per-frame JS cost is a single number assignment and
 * there are zero per-frame allocations. Hologram meshes never cast shadows
 * (the one shadow map stays clean) and are depth-tested but not depth-writing.
 */

import * as THREE from 'three'

export type HologramVariant = 'valid' | 'invalid'

/**
 * Marker / outline tints (additive, UX wave): the two hologram variants plus
 * the PROBLEM layer's 'error' (red) and 'risk' (amber) — scene
 * setProblemHighlights; problem tints pulse harder than the placement ones —
 * and 'hint', a dim cyan for soft guidance (the valid anchor rows of an
 * armed package). UX fix wave (H7, SC-11): 'info' (--ios-blue, the problem
 * layer's hint level, a thinner outline) and 'source' (the hover-only
 * neutral marker of scene setSourceHighlight — calm cyan rings, thin rim).
 */
export type FxTint = HologramVariant | 'error' | 'risk' | 'info' | 'hint' | 'source'

/** Above components (0), selection (2) and the legacy ghost box (3). */
export const HOLOGRAM_RENDER_ORDER = 4
/** Pin marker rings draw over the hologram; beams over the rings (+1). */
export const PIN_MARKER_RENDER_ORDER = 5
/** Outline hulls draw after the opaque parts they rim (depth-tested), before holograms. */
export const OUTLINE_RENDER_ORDER = 3

/** Holographic cyan-blue for valid placements (DESIGN-adjacent teal-blue). */
const VALID_COLOR = 0x66ccff
/** iOS destructive red for invalid placements (DESIGN.md --ios-red). */
const INVALID_COLOR = 0xff453a
/** iOS orange for the problem layer's 'risk' level (DESIGN.md --ios-orange). */
const RISK_COLOR = 0xff9f0a
/** iOS blue for the problem layer's 'info' level (DESIGN.md --ios-blue). */
const INFO_COLOR = 0x0a84ff
/** Ring pulse amplitude: placement markers breathe, problem markers throb. */
const PULSE_CALM = 0.18
const PULSE_ALERT = 0.45
/** 'hint' rings: the valid cyan at this fraction (additive — a soft glow, not a target) */
const HINT_LEVEL = 0.42
/**
 * Outline width as a view angle (radians): the hull is pushed out along its
 * normals by this × the view depth, so the rim keeps a constant ≈ 3–4 px on
 * screen at any zoom (45° FOV, 768–1080 px tall canvases).
 */
const OUTLINE_WIDTH = 0.0036
/** problem-layer rims: errors / risks a bit bolder, the 'info' hint and the hover marker thinner */
const OUTLINE_WIDTH_ALERT = 0.005
const OUTLINE_WIDTH_THIN = 0.0026
/**
 * The problem layer announces itself (SC-11): its rings and rims throb for
 * two outline pulses (5.2 rad/s → ≈ 2.4 s) after the layer is (re)shown,
 * then hold steady — readable, not nagging. Other tints pulse as before.
 */
const ALERT_RATE = 5.2
const PROBLEM_PULSE_WINDOW_S = (2 * 2 * Math.PI) / ALERT_RATE

/** Base hologram opacity before scanline / fresnel / flicker contributions.
 *  (Raised from the blind-tuned 0.35 after the screenshot pass: over the
 *  bright ABS board an alpha-0.35 cyan washed out to near-invisible.) */
const BASE_OPACITY = 0.52
/** World-Y distance between scanlines, and their upward scroll speed (u/s). */
const SCANLINE_SPACING = 0.18
const SCANLINE_SPEED = 0.22
/** Height of the pin-marker light beams (short — just above leg tops). */
const BEAM_HEIGHT = 1.4
/** Marker ring/beam plan sizes (hole collar outer radius is 0.32). */
const MARKER_PLANE = 1.5
const BEAM_RADIUS_TOP = 0.17
const BEAM_RADIUS_BOTTOM = 0.12

// ---------------------------------------------------------------------------
// Shared animation clock (one uniform object referenced by every FX material)
// ---------------------------------------------------------------------------

const CLOCK: { value: number } = { value: 0 }
const REDUCED: { value: number } = { value: 0 }
/** start of the problem layer's announce pulses (shared by every problem-tint material) */
const PROBLEM_START: { value: number } = { value: 0 }

/**
 * Advance every hologram/pin-marker shader. Call once per rendered frame with
 * **elapsed seconds since app start** (e.g. `THREE.Clock#getElapsedTime()` or
 * `performance.now() / 1000`). Costs one number write; allocation-free.
 */
export function tickHolograms(time: number): void {
  CLOCK.value = time
}

/**
 * `prefers-reduced-motion`: freezes the scanline scroll, the flicker and the
 * marker pulses (the hologram stays visible, just static).
 */
export function setHologramReducedMotion(reduced: boolean): void {
  REDUCED.value = reduced ? 1 : 0
}

/**
 * The problem layer was (re)shown at `time` (the same clock as
 * tickHolograms): its 'error' / 'risk' / 'info' rings and rims pulse twice
 * from now, then hold steady. One number write.
 */
export function restartProblemPulse(time: number): void {
  PROBLEM_START.value = time
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

/**
 * All fragment shaders end with the standard tonemapping/colorspace chunks so
 * the FX pass through the same ACES + sRGB pipeline as the rest of the scene
 * (ShaderMaterial output would otherwise bypass tone mapping and clash).
 */
const TONEMAP_FOOTER = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`

/** Hologram vertex: world position + normal (instancing-safe). */
const HOLO_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vec3 pos = position;
    vec3 nrm = normal;
    #ifdef USE_INSTANCING
      pos = (instanceMatrix * vec4(pos, 1.0)).xyz;
      nrm = mat3(instanceMatrix) * nrm;
    #endif
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * nrm);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

/**
 * Hologram fragment: translucent base + thin CRT scanlines every
 * SCANLINE_SPACING world units scrolling slowly upward + fresnel rim glow
 * (edges brighter, additive feel via >1 pre-tonemap color) + subtle global
 * sin flicker (±0.04 opacity, disabled by the reduced-motion uniform).
 */
const HOLO_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uReducedMotion;
  uniform float uOpacity;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    float anim = 1.0 - uReducedMotion;
    float t = uTime * anim;

    // scanlines: distance to the nearest line in line-spacing units
    float phase = (vWorldPos.y - t * ${SCANLINE_SPEED.toFixed(3)}) / ${SCANLINE_SPACING.toFixed(3)};
    float f = fract(phase);
    float line = smoothstep(0.14, 0.02, min(f, 1.0 - f));

    // fresnel rim (abs() so thin double-faced parts still rim correctly)
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float ndv = clamp(abs(dot(normalize(vWorldNormal), viewDir)), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.5);

    // very subtle global flicker, +/-0.04 opacity
    float flicker = (0.6 * sin(t * 13.0) + 0.4 * sin(t * 29.3)) * 0.04 * anim;

    float alpha = clamp(uOpacity + 0.20 * line + 0.38 * fres + flicker, 0.0, 0.92);
    vec3 col = uColor * (1.05 + 0.9 * line + 1.5 * fres);
    gl_FragColor = vec4(col, alpha);
    ${TONEMAP_FOOTER}
  }
`

/** Flat marker-ring quad: radial LED-phosphor falloff, subtle pulse. */
const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const RING_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uReducedMotion;
  uniform float uPulse;
  uniform float uRate;
  uniform float uStart;
  uniform float uWindow;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    float anim = 1.0 - uReducedMotion;
    float d = length(vUv - vec2(0.5)) * ${MARKER_PLANE.toFixed(2)};
    // world-position phase: shared material, per-hole pulse offset for free;
    // a problem tint pulses only inside its announce window (uWindow > 0)
    float k = uTime - uStart;
    float on = uWindow > 0.0 ? step(k, uWindow) : 1.0;
    float pulse = 1.0 + uPulse * anim * on * sin(k * uRate + vWorldPos.x * 1.3 + vWorldPos.z * 2.1);
    float core = exp(-pow((d - 0.34) / 0.07, 2.0));
    float halo = 0.45 * exp(-pow((d - 0.34) / 0.20, 2.0));
    float a = (core + halo) * pulse;
    gl_FragColor = vec4(uColor * a * 1.1, clamp(a, 0.0, 1.0));
    ${TONEMAP_FOOTER}
  }
`

/**
 * Beam: open-ended tapered cylinder, alpha fades with height and toward the
 * silhouette (soft volumetric look); a bright packet travels DOWN the beam so
 * the pins read as falling into the hole. Reduced motion = steady glow.
 */
const BEAM_VERT = /* glsl */ `
  varying float vY;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vY = position.y;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uReducedMotion;
  uniform float uHeight;
  varying float vY;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    float anim = 1.0 - uReducedMotion;
    float hFrac = clamp(vY / uHeight, 0.0, 1.0);
    float vert = pow(1.0 - hFrac, 1.6);
    float phase = vWorldPos.x * 0.37 + vWorldPos.z * 0.61;
    float p = fract(uTime * 0.7 + phase);
    float center = (1.0 - p) * uHeight;
    float packet = 0.8 * exp(-pow((vY - center) / 0.22, 2.0));
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float ndv = clamp(abs(dot(normalize(vWorldNormal), viewDir)), 0.0, 1.0);
    float body = pow(ndv, 1.4);
    float a = (0.30 + anim * packet + (1.0 - anim) * 0.20) * vert * body;
    gl_FragColor = vec4(uColor * a, clamp(a, 0.0, 1.0));
    ${TONEMAP_FOOTER}
  }
`

/**
 * Outline hull (inverted hull): the part's own geometry pushed out along its
 * normals by a constant VIEW ANGLE (uWidth × depth) and drawn back-faces
 * only, depth-tested — the real part hides the hull everywhere except a
 * clean rim around its silhouette, so nothing covers the part itself (an
 * instrument's LCD stays readable). Instancing-safe.
 */
const OUTLINE_VERT = /* glsl */ `
  uniform float uWidth;
  void main() {
    vec3 pos = position;
    vec3 nrm = normal;
    #ifdef USE_INSTANCING
      pos = (instanceMatrix * vec4(pos, 1.0)).xyz;
      nrm = mat3(instanceMatrix) * nrm;
    #endif
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vec3 n = normalMatrix * nrm;
    float len = length(n);
    if (len > 1e-6) mv.xyz += (n / len) * uWidth * max(-mv.z, 0.0);
    gl_Position = projectionMatrix * mv;
  }
`

/** Solid rim colour; the alert tints throb (reduced motion: steady). */
const OUTLINE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uReducedMotion;
  uniform float uPulse;
  uniform float uStart;
  uniform float uWindow;
  void main() {
    float anim = 1.0 - uReducedMotion;
    // problem tints: two pulses from uStart, then a steady rim (uWindow > 0)
    float k = uTime - uStart;
    float on = uWindow > 0.0 ? step(k, uWindow) : 1.0;
    float a = clamp(0.82 + uPulse * anim * on * sin(k * ${ALERT_RATE.toFixed(1)}), 0.0, 1.0);
    // kept under 1.0 pre-tonemap: ACES would bleach a hotter red to orange
    gl_FragColor = vec4(uColor * (0.8 + 0.2 * a), a);
    ${TONEMAP_FOOTER}
  }
`

// ---------------------------------------------------------------------------
// Material / geometry caches (page lifetime, like meshes/shared.ts)
// ---------------------------------------------------------------------------

function variantColor(variant: FxTint): THREE.Color {
  // THREE.Color converts hex into the linear working space (ColorManagement)
  if (variant === 'hint') return new THREE.Color(VALID_COLOR).multiplyScalar(HINT_LEVEL)
  if (variant === 'info') return new THREE.Color(INFO_COLOR)
  return new THREE.Color(
    variant === 'valid' || variant === 'source' ? VALID_COLOR : variant === 'risk' ? RISK_COLOR : INVALID_COLOR,
  )
}

function tintPulse(tint: FxTint): number {
  return tint === 'error' || tint === 'risk' || tint === 'info' ? PULSE_ALERT : PULSE_CALM
}

/** The problem layer's tints (announce pulses, then steady). */
function isProblemTint(tint: FxTint): boolean {
  return tint === 'error' || tint === 'risk' || tint === 'info'
}

/** Pulse-window uniforms: problem tints share PROBLEM_START; the rest pulse forever (window 0). */
function pulseWindow(tint: FxTint): { uStart: { value: number }; uWindow: { value: number } } {
  return isProblemTint(tint)
    ? { uStart: PROBLEM_START, uWindow: { value: PROBLEM_PULSE_WINDOW_S } }
    : { uStart: { value: 0 }, uWindow: { value: 0 } }
}

const holoMats = new Map<HologramVariant, THREE.ShaderMaterial>()
const ringMats = new Map<FxTint, THREE.ShaderMaterial>()
const beamMats = new Map<FxTint, THREE.ShaderMaterial>()
const outlineMats = new Map<FxTint, THREE.ShaderMaterial>()
let ringGeo: THREE.PlaneGeometry | null = null
let beamGeo: THREE.CylinderGeometry | null = null

/**
 * The holographic preview material: translucent cyan-blue (valid) / red
 * (invalid) with scrolling CRT scanlines, fresnel rim and subtle flicker.
 * Cached per variant — the SAME instance is returned every call, so a ghost
 * rebuild costs no material compiles. Depth-tested, never depth-writing;
 * assign HOLOGRAM_RENDER_ORDER to meshes using it (applyHologram does).
 */
export function makeHologramMaterial(variant: HologramVariant): THREE.ShaderMaterial {
  let mat = holoMats.get(variant)
  if (!mat) {
    mat = new THREE.ShaderMaterial({
      vertexShader: HOLO_VERT,
      fragmentShader: HOLO_FRAG,
      uniforms: {
        uColor: { value: variantColor(variant) },
        uOpacity: { value: BASE_OPACITY },
        uTime: CLOCK,
        uReducedMotion: REDUCED,
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
    })
    mat.name = `hologram-${variant}`
    holoMats.set(variant, mat)
  }
  return mat
}

/** Raycast no-op: holograms/markers must never swallow scene picking. */
const noRaycast: THREE.Object3D['raycast'] = () => {}

/**
 * Clone `source` (a built component object) into its holographic ghost:
 * every mesh keeps its geometry (shared with the source — NOT copied) but
 * renders with the cached hologram material; lights, sprites (LED glow),
 * points and lines are stripped; shadows are disabled; nothing raycasts.
 *
 * Cheap to call on every ghost move/rotate. Discard by removing the clone
 * from its parent — it owns no GPU resources of its own (geometry belongs to
 * the source, the material is module-cached).
 */
export function applyHologram(source: THREE.Object3D, variant: HologramVariant): THREE.Object3D {
  const clone = source.clone(true)
  const material = makeHologramMaterial(variant)
  const doomed: THREE.Object3D[] = []
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) {
      mesh.material = material
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.renderOrder = HOLOGRAM_RENDER_ORDER
      mesh.raycast = noRaycast
    } else if (
      (o as THREE.Light).isLight ||
      (o as THREE.Sprite).isSprite ||
      (o as THREE.Points).isPoints ||
      (o as THREE.Line).isLine
    ) {
      doomed.push(o)
    }
    // the ghost must never be picked as a real component
    if (o.userData && 'componentId' in o.userData) delete o.userData.componentId
  })
  for (const o of doomed) o.parent?.remove(o)
  return clone
}

// ---------------------------------------------------------------------------
// Pin markers (ring + falling-light beam per target hole)
// ---------------------------------------------------------------------------

export interface PinMarkers {
  /** Add to the overlay group; positioned in world space already. */
  group: THREE.Group
  /** Detach + empty the group. Shared geometry/materials stay cached. */
  dispose(): void
}

function markerRingGeometry(): THREE.PlaneGeometry {
  if (!ringGeo) {
    ringGeo = new THREE.PlaneGeometry(MARKER_PLANE, MARKER_PLANE)
    ringGeo.rotateX(-Math.PI / 2)
  }
  return ringGeo
}

function markerBeamGeometry(): THREE.CylinderGeometry {
  if (!beamGeo) {
    beamGeo = new THREE.CylinderGeometry(
      BEAM_RADIUS_TOP,
      BEAM_RADIUS_BOTTOM,
      BEAM_HEIGHT,
      14,
      1,
      true, // open-ended: no hard caps in an additive volume
    )
    beamGeo.translate(0, BEAM_HEIGHT / 2, 0) // base at y = 0
  }
  return beamGeo
}

function markerRingMaterial(variant: FxTint): THREE.ShaderMaterial {
  let mat = ringMats.get(variant)
  if (!mat) {
    mat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: {
        uColor: { value: variantColor(variant) },
        uTime: CLOCK,
        uReducedMotion: REDUCED,
        uPulse: { value: tintPulse(variant) },
        uRate: { value: isProblemTint(variant) ? ALERT_RATE : 3.1 },
        ...pulseWindow(variant),
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    })
    mat.name = `pin-marker-ring-${variant}`
    ringMats.set(variant, mat)
  }
  return mat
}

function markerBeamMaterial(variant: FxTint): THREE.ShaderMaterial {
  let mat = beamMats.get(variant)
  if (!mat) {
    mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: {
        uColor: { value: variantColor(variant) },
        uHeight: { value: BEAM_HEIGHT },
        uTime: CLOCK,
        uReducedMotion: REDUCED,
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    })
    mat.name = `pin-marker-beam-${variant}`
    beamMats.set(variant, mat)
  }
  return mat
}

/**
 * Glowing target markers for the ghost's legs: a small pulsing ring + a short
 * additive light beam at each hole position (world space, y = hole top).
 * Animation is fully shader-side off the shared clock (`tickHolograms`).
 * Rebuild per ghost change is cheap: 2·N tiny meshes over cached resources.
 */
export function makePinMarkers(
  positions: ReadonlyArray<{ x: number; y: number; z: number }>,
  variant: FxTint,
  /** `beams: false` = rings only (a soft row glow instead of "land here" targets) */
  opts: { beams?: boolean } = {},
): PinMarkers {
  const group = new THREE.Group()
  group.name = 'pin-markers'
  const ringMat = markerRingMaterial(variant)
  const beamMat = opts.beams === false ? null : markerBeamMaterial(variant)
  const rGeo = markerRingGeometry()
  const bGeo = markerBeamGeometry()
  for (const p of positions) {
    const ring = new THREE.Mesh(rGeo, ringMat)
    ring.position.set(p.x, p.y + 0.06, p.z) // float just above the collar
    ring.renderOrder = PIN_MARKER_RENDER_ORDER
    ring.raycast = noRaycast
    // markers are world-positioned once and never move (all animation is
    // shader-side) — freeze their matrices so the per-frame auto-update
    // recompose is skipped (perf discipline, hotspots.md B2)
    ring.updateMatrix()
    ring.matrixAutoUpdate = false
    group.add(ring)
    if (!beamMat) continue
    const beam = new THREE.Mesh(bGeo, beamMat)
    beam.position.set(p.x, p.y + 0.02, p.z)
    beam.renderOrder = PIN_MARKER_RENDER_ORDER + 1
    beam.raycast = noRaycast
    beam.updateMatrix()
    beam.matrixAutoUpdate = false
    group.add(beam)
  }
  group.updateMatrix()
  group.matrixAutoUpdate = false
  return {
    group,
    dispose() {
      group.parent?.remove(group)
      group.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// Outline hulls (lesson highlights of instruments / displays, problem layer)
// ---------------------------------------------------------------------------

/**
 * The cached outline-hull material for `tint` (one shader program for every
 * tint — only uniforms differ). Back faces only, depth-tested, never
 * depth-writing; meshes using it take OUTLINE_RENDER_ORDER (applyOutline).
 */
export function makeOutlineMaterial(tint: FxTint): THREE.ShaderMaterial {
  let mat = outlineMats.get(tint)
  if (!mat) {
    mat = new THREE.ShaderMaterial({
      vertexShader: OUTLINE_VERT,
      fragmentShader: OUTLINE_FRAG,
      uniforms: {
        uColor: { value: variantColor(tint) },
        uWidth: {
          value:
            tint === 'error' || tint === 'risk'
              ? OUTLINE_WIDTH_ALERT
              : tint === 'info' || tint === 'source'
                ? OUTLINE_WIDTH_THIN
                : OUTLINE_WIDTH,
        },
        uPulse: { value: tint === 'valid' || tint === 'source' ? 0.08 : 0.18 },
        uTime: CLOCK,
        uReducedMotion: REDUCED,
        ...pulseWindow(tint),
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
    })
    mat.name = `outline-${tint}`
    outlineMats.set(tint, mat)
  }
  return mat
}

/**
 * Clone `source` (a built component object or a wire group) into an outline
 * hull: every mesh keeps its geometry (shared — NOT copied) and its local
 * transforms, renders with the cached outline material; lights, sprites,
 * points and lines are stripped; nothing casts shadows or raycasts. Unlike
 * applyHologram the part itself stays fully visible — only a rim around its
 * silhouette is added. Discard by removing the clone (it owns no GPU
 * resources).
 */
export function applyOutline(source: THREE.Object3D, tint: FxTint): THREE.Object3D {
  const clone = source.clone(true)
  const material = makeOutlineMaterial(tint)
  const doomed: THREE.Object3D[] = []
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) {
      mesh.material = material
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.renderOrder = OUTLINE_RENDER_ORDER
      mesh.raycast = noRaycast
      // the hull of an invisible pick proxy would draw a phantom box
      if (!mesh.visible) doomed.push(o)
    } else if (
      (o as THREE.Light).isLight ||
      (o as THREE.Sprite).isSprite ||
      (o as THREE.Points).isPoints ||
      (o as THREE.Line).isLine
    ) {
      doomed.push(o)
    }
    if (o.userData && 'componentId' in o.userData) delete o.userData.componentId
  })
  for (const o of doomed) o.parent?.remove(o)
  return clone
}

/**
 * Free every module-cached hologram resource (materials + marker geometry)
 * and reset the caches. Only needed on full app teardown — the caches are
 * intentionally page-lifetime, mirroring meshes/shared.ts. Safe to call
 * repeatedly; the next makeHologramMaterial/makePinMarkers call recreates.
 */
export function disposeHolograms(): void {
  for (const m of holoMats.values()) m.dispose()
  for (const m of ringMats.values()) m.dispose()
  for (const m of beamMats.values()) m.dispose()
  for (const m of outlineMats.values()) m.dispose()
  holoMats.clear()
  ringMats.clear()
  beamMats.clear()
  outlineMats.clear()
  ringGeo?.dispose()
  beamGeo?.dispose()
  ringGeo = null
  beamGeo = null
}

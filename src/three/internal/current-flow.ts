/**
 * 顯示電流 — the current-flow layer (owner: flow; contract C2).
 *
 * Glowing particles stream along every wire, every piece of breadboard strip
 * / rail metal and through every 2-terminal part that REALLY carries current
 * in the running simulation — in at one pin hole, up that leg, over the
 * body, down the other leg, out at the other hole (the routed pose the scene
 * draws, never a box through the air):
 *  - direction = conventional current (+ → −): SimTelemetry.wireCurrents
 *    (from → to), stripCurrents ("a>b") and the part's pinCurrents (into the
 *    part at pin 0 = through the body from pin 0 to pin 1);
 *  - ONE colour (electric cyan — never red, which means supply and damage;
 *    a white-hot centre and a dark rim read on every wire colour and on the
 *    white board); |I| is encoded by SPEED and DENSITY only, on a perceptual
 *    LOG scale from 10 µA to 200 mA (0.5 mA and 20 mA look clearly
 *    different). The legend everywhere: 「光點越快越密＝電流越大，方向＝由正到負」;
 *  - nothing below MIN_SHOWN_A (no current → no particles); unknown currents
 *    (a frame without wireCurrents) show nothing — never a guess;
 *  - a paused simulation (sim time stops advancing) freezes the particles;
 *  - prefers-reduced-motion: particles stand still and each one carries a
 *    short fading tail behind it, so the direction still reads without motion.
 *
 * GPU / CPU budget: ONE THREE.Points (one draw call) with a fixed pool of
 * MAX_POINTS, positions written into preallocated typed arrays from
 * precomputed polylines (cumulative lengths, binary search) inside the
 * scene's existing animate loop — no allocation per frame, no React. The
 * layer sits in the scene's overlay group (never path-traced in Studio).
 */
import * as THREE from 'three'
import type { SimTelemetry } from '../../model/types'
import { holePosition, parseHole } from '../../model/breadboard'
import { routedPoseFor } from '../meshes/shared'
import type { RoutedComponent } from './wire-router'

/** Below this |I| (A) nothing is drawn (GMIN leaks are nA). */
export const MIN_SHOWN_A = 5e-6
/** The perceptual scale's ends (A): u = 0 at 10 µA, u = 1 at 200 mA. */
export const SCALE_LO_A = 1e-5
export const SCALE_HI_A = 0.2
/** Particle speed at u = 0 / u = 1 (hole pitches per second). */
const SPEED_LO = 0.8
const SPEED_HI = 12
/** Distance between particles at u = 0 / u = 1 (pitches). */
const GAP_LO = 2.4
const GAP_HI = 0.7
/** World size of a particle head (its halo included) — the same at every current. */
const HEAD_SIZE = 0.44
/** A head never shrinks below this many CSS px on screen (zoomed-out views). */
const MIN_HEAD_PX = 4.5
/** Heads in the whole layer (each head draws up to TRAIL points: 2 in motion, 3 under reduced motion). */
const MAX_HEADS = 2000
const TRAIL = 3
const MAX_POINTS = MAX_HEADS * TRAIL
/** Heads per path (a very long rail at full current). */
const MAX_PER_PATH = 96
/** Display smoothing of the shown current (s) — frame-to-frame jitter only. */
const EASE_S = 0.12
/** Fade-out time constant when a path's current stops (s). */
const FADE_OUT_S = 0.05
/** The sim counts as paused when its time has not moved for this long (ms). */
const PAUSE_MS = 400
/** Height of the strip / rail particles above the board face. */
const STRIP_Y = 0.05
/** Clearance of the over-the-body path above a part's top. */
const BODY_CLEAR = 0.1

/** Perceptual position of a current magnitude on the log scale (0..1). */
export function flowLevel(amps: number): number {
  const a = Math.abs(amps)
  if (!(a > 0)) return 0
  const u = (Math.log10(a) - Math.log10(SCALE_LO_A)) / (Math.log10(SCALE_HI_A) - Math.log10(SCALE_LO_A))
  return u < 0 ? 0 : u > 1 ? 1 : u
}

/** Particle speed (pitches / s) for a current magnitude. */
export function flowSpeed(amps: number): number {
  return SPEED_LO + (SPEED_HI - SPEED_LO) * flowLevel(amps)
}

/** Distance between particles (pitches) for a current magnitude. */
export function flowGap(amps: number): number {
  return GAP_LO + (GAP_HI - GAP_LO) * flowLevel(amps)
}

/**
 * The particle colour (sRGB 0..1): electric cyan #1ED8FF. One hue at every
 * current (F15): red already means "supply" (wires) and "damage" (parts), and
 * a colour scale would need a legend of its own. Brighter and greener than
 * the blue wire, bluer and far brighter than the teal one; the shader's dark
 * rim carries it over the white board and white / yellow wires.
 */
export const FLOW_RGB: Readonly<{ r: number; g: number; b: number }> = { r: 0.118, g: 0.847, b: 1.0 }

/** The particle colour into `out` (the same at every level; kept as a function for callers). */
export function flowColor(_u: number, out: { r: number; g: number; b: number }): void {
  out.r = FLOW_RGB.r
  out.g = FLOW_RGB.g
  out.b = FLOW_RGB.b
}

/** sRGB → linear (the shader's colorspace_fragment converts back for the screen). */
function lin(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
attribute float aMin;
uniform float uScale;
uniform float uLift;
uniform float uMinPx;
varying vec4 vColor;
varying float vHead;
void main() {
  vColor = aColor;
  vHead = aMin > 0.99 ? 1.0 : 0.0;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // pull the glow toward the camera so it rides ON the wire / strip surface
  mv.xyz += normalize(-mv.xyz) * uLift;
  // a head never shrinks below uMinPx; its trail points keep their proportion (aMin)
  gl_PointSize = max(uMinPx * aMin, aSize * uScale / max(0.05, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`

/*
 * A glowing bead that reads on the dark desk AND on the white board: a
 * whitened centre, a saturated core, a thin dark rim (contrast on light
 * plastic) and a soft coloured halo.
 */
const FRAG = /* glsl */ `
varying vec4 vColor;
varying float vHead;
void main() {
  vec2 p = gl_PointCoord - vec2(0.5);
  float r = length(p);
  if (r > 0.5) discard;
  // a tight quad (the bead fills two thirds of it): half the fill of a wide halo
  float core = 1.0 - smoothstep(0.28, 0.33, r);
  float rim = smoothstep(0.29, 0.335, r) * (1.0 - smoothstep(0.41, 0.46, r));
  float halo = (1.0 - smoothstep(0.42, 0.5, r)) * 0.24;
  // saturated bead with a hot centre, a dark outline (reads on the white
  // board and on a wire of the same colour) and a faint glow (dark desk)
  vec3 hot = mix(vColor.rgb, vec3(1.0), 0.5 * (1.0 - smoothstep(0.0, 0.15, r)));
  vec3 rgb = mix(vColor.rgb, hot, core);
  // trail points: a soft coloured dot, no outline (the head carries it)
  rim *= vHead;
  rgb = mix(rgb, vec3(0.015, 0.02, 0.04), rim * (1.0 - core));
  float a = max(core * (0.55 + 0.45 * vHead), max(rim * 0.85, halo));
  a *= vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(rgb, a);
  #include <colorspace_fragment>
}
`

interface FlowPath {
  /** the map key ("w:…", "p:…", "s:…") — iterating values() allocates no entry pairs */
  key: string
  /** polyline xyz */
  pts: Float32Array
  /** cumulative length per point */
  cum: Float32Array
  len: number
  /** target current (A, signed along the path) from the latest telemetry */
  target: number
  /** eased magnitude (A) and presence (0..1) */
  shownA: number
  on: number
  /** direction of travel (+1 along the polyline, −1 against) */
  dir: number
  /** phase of the first particle along the path (pitches) */
  phase: number
}

export interface FlowStats {
  visible: boolean
  paths: number
  activePaths: number
  heads: number
  points: number
  /** CPU time of the last tick (ms) */
  tickMs: number
  /** Σ of the drawn positions (diagnostics: equal on two reads = frozen) */
  sig?: number
}

/** One path's state (diagnostics / e2e only). */
export interface FlowPathInfo {
  /** "w:<wire>", "p:<part>", "s:<holeA>><holeB>" */
  key: string
  /** shown current (A, signed along the path) */
  amps: number
  /** particle speed (pitches / s) */
  speed: number
}

/** the particle colour in linear space (the shader converts back for the screen) */
const LIN_R = lin(FLOW_RGB.r)
const LIN_G = lin(FLOW_RGB.g)
const LIN_B = lin(FLOW_RGB.b)
/** Leg points this far below the board face (inside the hole) are not drawn. */
const LEG_MIN_Y = 0.02

/**
 * Top of a part's solid body (world y): its meshes only — never the glow
 * sprites (an LED's halo / flare is several times the dome) or other
 * additive light effects, which are not the part.
 */
export function bodyTopOf(root: THREE.Object3D): number {
  root.updateWorldMatrix(true, true)
  let top = -Infinity
  const box = new THREE.Box3()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (mats.some((m) => m && (m as THREE.Material).blending === THREE.AdditiveBlending)) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    const bb = mesh.geometry.boundingBox
    if (!bb) return
    box.copy(bb).applyMatrix4(mesh.matrixWorld)
    if (box.max.y > top) top = box.max.y
  })
  return top
}

function makePath(key: string, pts: number[]): FlowPath | null {
  const n = pts.length / 3
  if (n < 2) return null
  const p = new Float32Array(pts)
  const cum = new Float32Array(n)
  let len = 0
  for (let i = 1; i < n; i++) {
    const dx = p[i * 3] - p[i * 3 - 3]
    const dy = p[i * 3 + 1] - p[i * 3 - 2]
    const dz = p[i * 3 + 2] - p[i * 3 - 1]
    len += Math.sqrt(dx * dx + dy * dy + dz * dz)
    cum[i] = len
  }
  if (!(len > 1e-4)) return null
  return { key, pts: p, cum, len, target: 0, shownA: 0, on: 0, dir: 1, phase: Math.random() * 3 }
}

export class CurrentFlowLayer {
  readonly object: THREE.Points
  private readonly geo: THREE.BufferGeometry
  private readonly mat: THREE.ShaderMaterial
  private readonly pos: Float32Array
  private readonly col: Float32Array
  private readonly size: Float32Array
  private readonly minPx: Float32Array
  private readonly posAttr: THREE.BufferAttribute
  private readonly colAttr: THREE.BufferAttribute
  private readonly sizeAttr: THREE.BufferAttribute
  private readonly minAttr: THREE.BufferAttribute
  /** "w:<wire id>", "p:<part id>", "s:<holeA>><holeB>" */
  private readonly paths = new Map<string, FlowPath>()
  /** 2-terminal parts: pin names (current through the body = pinCurrents[pin0]) */
  private readonly partPins = new Map<string, [string, string]>()
  private wanted = false
  private telemetry: SimTelemetry | null = null
  private lastSimTime = NaN
  private lastAdvance = -Infinity
  private reduced: boolean
  private readonly stats: FlowStats = { visible: false, paths: 0, activePaths: 0, heads: 0, points: 0, tickMs: 0 }
  /** the window.__flowStats hook this layer installed (?e2e pages only) */
  private statsHook: (() => FlowStats) | null = null

  constructor(opts: { reducedMotion: boolean }) {
    this.reduced = opts.reducedMotion
    this.pos = new Float32Array(MAX_POINTS * 3)
    this.col = new Float32Array(MAX_POINTS * 4)
    this.size = new Float32Array(MAX_POINTS)
    this.minPx = new Float32Array(MAX_POINTS)
    this.geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage)
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage)
    this.minAttr = new THREE.BufferAttribute(this.minPx, 1).setUsage(THREE.DynamicDrawUsage)
    this.geo.setAttribute('position', this.posAttr)
    this.geo.setAttribute('aMin', this.minAttr)
    this.geo.setAttribute('aColor', this.colAttr)
    this.geo.setAttribute('aSize', this.sizeAttr)
    this.geo.setDrawRange(0, 0)
    // the layer is everywhere on the board: never let a stale bound cull it
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 }, uLift: { value: 0.22 }, uMinPx: { value: MIN_HEAD_PX } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      toneMapped: false,
    })
    this.object = new THREE.Points(this.geo, this.mat)
    this.object.name = 'current-flow'
    this.object.frustumCulled = false
    this.object.renderOrder = 5
    this.object.visible = false
    this.object.matrixAutoUpdate = false
    this.object.updateMatrix()
    if (typeof window !== 'undefined' && /[?&]e2e\b/.test(window.location?.search ?? '')) {
      const w = window as unknown as Record<string, unknown>
      this.statsHook = () => this.getStats()
      w.__flowStats = this.statsHook
      w.__flowPaths = () => this.getPathInfo()
    }
  }

  // ------------------------------------------------------------ geometry

  /**
   * A wire's path from its `from` end (`a`) to its `to` end (`b`) along the
   * rendered tube's curve (sampled once per layout change).
   */
  setWirePath(id: string, a: THREE.Vector3, b: THREE.Vector3, curve: THREE.Curve<THREE.Vector3> | null): void {
    const pts: number[] = [a.x, a.y, a.z]
    if (curve) {
      const n = 28
      const first = curve.getPoint(0)
      const last = curve.getPoint(1)
      // orientation guard: the curve must run from a to b
      const flip =
        Math.hypot(first.x - b.x, first.z - b.z) + Math.hypot(last.x - a.x, last.z - a.z) <
        Math.hypot(first.x - a.x, first.z - a.z) + Math.hypot(last.x - b.x, last.z - b.z)
      const v = new THREE.Vector3()
      for (let i = 0; i <= n; i++) {
        curve.getPoint(flip ? 1 - i / n : i / n, v)
        pts.push(v.x, v.y, v.z)
      }
    }
    pts.push(b.x, b.y, b.z)
    this.put(`w:${id}`, pts)
  }

  /**
   * A 2-terminal part's path, pin 0's hole → pin 1's hole, the way the part
   * is drawn: `body` is its built object (or its top y) and `routed` the
   * router-planned pose the scene built it with. Routed: up pin 0's leg
   * (exactly the lead path), over the body just above its top, down pin 1's
   * leg. Unrouted (straight legs under the body): up from the hole to just
   * above the body, across, down into the other hole — the legs' own line.
   */
  setPartPath(
    id: string,
    pins: [string, string],
    a: THREE.Vector3,
    b: THREE.Vector3,
    body: THREE.Object3D | number,
    routed?: RoutedComponent | null,
  ): void {
    let topY = typeof body === 'number' ? body : bodyTopOf(body)
    if (!Number.isFinite(topY)) topY = 0.6
    this.partPins.set(id, pins)
    const rp = routed ? routedPoseFor(routed, [a, b], 2) : null
    if (rp && rp.legs.length >= 2) {
      const [l0, l1] = rp.legs
      const e0 = l0[l0.length - 1]
      const e1 = l1[l1.length - 1]
      const y = Math.max(topY, e0.y, e1.y) + BODY_CLEAR
      const pts: number[] = [a.x, Math.max(a.y, 0), a.z]
      for (const v of l0) if (v.y > LEG_MIN_Y) pts.push(v.x, v.y, v.z)
      // over the body: up at its pin-0 end, along its top, down at its pin-1 end
      pts.push(e0.x, y, e0.z, e1.x, y, e1.z)
      for (let i = l1.length - 1; i >= 0; i--) if (l1[i].y > LEG_MIN_Y) pts.push(l1[i].x, l1[i].y, l1[i].z)
      pts.push(b.x, Math.max(b.y, 0), b.z)
      this.put(`p:${id}`, pts)
      return
    }
    const y = Math.max(topY, 0.4) + BODY_CLEAR
    this.put(`p:${id}`, [a.x, a.y, a.z, a.x, y, a.z, b.x, y, b.z, b.x, b.y, b.z])
  }

  removeWire(id: string): void {
    this.paths.delete(`w:${id}`)
  }

  removePart(id: string): void {
    this.paths.delete(`p:${id}`)
    this.partPins.delete(id)
  }

  private put(key: string, pts: number[]): void {
    const p = makePath(key, pts)
    if (!p) {
      this.paths.delete(key)
      return
    }
    const old = this.paths.get(key)
    if (old) {
      p.phase = old.phase
      p.shownA = old.shownA
      p.on = old.on
      p.dir = old.dir
    }
    this.paths.set(key, p)
    if (this.telemetry) this.applyTargets()
  }

  /** Strip / rail metal between two holes (created on first use, by key "a>b"). */
  private stripPath(key: string): FlowPath | null {
    const k = `s:${key}`
    const have = this.paths.get(k)
    if (have) return have
    const gt = key.indexOf('>')
    if (gt <= 0) return null
    const ha = parseHole(key.slice(0, gt))
    const hb = parseHole(key.slice(gt + 1))
    if (!ha || !hb) return null
    const pa = holePosition(ha)
    const pb = holePosition(hb)
    const p = makePath(k, [pa.x, STRIP_Y, pa.z, pb.x, STRIP_Y, pb.z])
    if (p) this.paths.set(k, p)
    return p
  }

  // ------------------------------------------------------------ state

  /** The user's 顯示電流 preference (useFlowView.visible). */
  setWanted(on: boolean): void {
    this.wanted = on
    if (!on) this.hide()
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on
  }

  /** Latest telemetry (null = the session ended → nothing shows). */
  setTelemetry(t: SimTelemetry | null): void {
    const prev = this.telemetry
    this.telemetry = t
    if (!t) {
      this.lastSimTime = NaN
      for (const p of this.paths.values()) {
        p.target = 0
        p.shownA = 0
        p.on = 0
      }
      this.hide()
      return
    }
    if (!(t.time === this.lastSimTime) || prev === null) {
      if (t.time !== this.lastSimTime) this.lastAdvance = performance.now()
      this.lastSimTime = t.time
    }
    this.applyTargets()
  }

  private applyTargets(): void {
    const t = this.telemetry
    if (!t) return
    const known = t.wireCurrents !== undefined
    for (const [key, p] of this.paths) {
      if (key.startsWith('s:')) p.target = 0 // re-set below from this frame's list
      else if (key.startsWith('w:')) {
        const i = known ? t.wireCurrents?.[key.slice(2)] : undefined
        p.target = typeof i === 'number' && Number.isFinite(i) ? i : 0
      } else if (key.startsWith('p:')) {
        const id = key.slice(2)
        const pins = this.partPins.get(id)
        const pc = t.components[id]?.pinCurrents
        const i = pins && pc ? pc[pins[0]] : undefined
        p.target = typeof i === 'number' && Number.isFinite(i) ? i : 0
      }
    }
    const strips = t.stripCurrents
    if (strips) {
      for (const key in strips) {
        const i = strips[key]
        if (!(Math.abs(i) >= MIN_SHOWN_A)) continue
        const p = this.stripPath(key)
        if (p) p.target = i
      }
    }
  }

  private hide(): void {
    this.object.visible = false
    this.geo.setDrawRange(0, 0)
    this.stats.visible = false
    this.stats.heads = 0
    this.stats.points = 0
    this.stats.activePaths = 0
  }

  /** Point-size scale: canvas px per world unit at distance 1 (call on resize / fov change). */
  setViewScale(canvasHeightPx: number, fovDeg: number, pixelRatio = 1): void {
    const s = canvasHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360))
    if (Number.isFinite(s) && s > 0) this.mat.uniforms.uScale.value = s
    if (Number.isFinite(pixelRatio) && pixelRatio > 0) this.mat.uniforms.uMinPx.value = MIN_HEAD_PX * pixelRatio
  }

  // ------------------------------------------------------------ per frame

  /** Advance and write the particles (scene animate loop; dt in s). */
  tick(dt: number): void {
    const t = this.telemetry
    if (!this.wanted || !t) {
      if (this.object.visible) this.hide()
      return
    }
    const t0 = performance.now()
    const running = t0 - this.lastAdvance < PAUSE_MS
    const step = running && !this.reduced ? Math.min(dt, 0.1) : 0
    // a paused simulation snaps to its last picture and holds it (no easing drift)
    const hdt = Math.min(dt, 0.25)
    const k = running && dt > 0 ? 1 - Math.exp(-hdt / EASE_S) : 1
    const kOff = running && dt > 0 ? 1 - Math.exp(-hdt / FADE_OUT_S) : 1
    const pos = this.pos
    const col = this.col
    const size = this.size
    let heads = 0
    let n = 0
    let active = 0
    // per frame: values() + p.key (no [key, value] pair per path)
    for (const p of this.paths.values()) {
      const target = Math.abs(p.target)
      const on = target >= MIN_SHOWN_A ? 1 : 0
      if (on) {
        p.dir = p.target >= 0 ? 1 : -1
        p.shownA = p.shownA > 0 ? p.shownA + (target - p.shownA) * k : target
      }
      // current gone: the particles fade within ~0.2 s (a blink's off-time stays dark)
      p.on += (on - p.on) * (on ? k : kOff)
      if (p.on < 0.02) {
        p.on = on ? p.on : 0
        if (!on) {
          // a strip segment that faded out is rebuilt on demand (bounded memory)
          if (p.key.charCodeAt(0) === 115 /* 's' */) this.paths.delete(p.key)
          continue
        }
      }
      active++
      const amps = p.shownA
      const u = flowLevel(amps)
      const gap = GAP_LO + (GAP_HI - GAP_LO) * u
      const speed = SPEED_LO + (SPEED_HI - SPEED_LO) * u
      p.phase += step * speed * p.dir
      if (p.phase > 1e6 || p.phase < -1e6) p.phase %= p.len // positions repeat every p.len: no jump
      const count = Math.min(MAX_PER_PATH, Math.max(1, Math.floor(p.len / gap)))
      const spacing = p.len / count // whole number of particles: a seamless loop
      const alpha = p.on
      // in motion one tail point reads as a streak; standing still (reduced
      // motion) two show the direction
      const trail = this.reduced ? TRAIL : 2
      for (let j = 0; j < count; j++) {
        if (heads >= MAX_HEADS) break
        heads++
        let s = (p.phase + j * spacing) % p.len
        if (s < 0) s += p.len
        for (let tr = 0; tr < trail; tr++) {
          // tail points trail BEHIND the head (against the travel direction)
          const back = tr * 0.16 * (0.6 + u)
          let st = s - back * p.dir
          if (st < 0 || st > p.len) {
            if (tr > 0) continue // a tail never wraps around the loop
            st = st < 0 ? 0 : p.len
          }
          this.sample(p, st, n)
          const fade = tr === 0 ? 1 : tr === 1 ? 0.45 : 0.2
          const c = n * 4
          col[c] = LIN_R
          col[c + 1] = LIN_G
          col[c + 2] = LIN_B
          col[c + 3] = alpha * fade
          const shrink = tr === 0 ? 1 : tr === 1 ? 0.72 : 0.5
          size[n] = HEAD_SIZE * shrink
          this.minPx[n] = shrink
          n++
        }
      }
    }
    this.geo.setDrawRange(0, n)
    if (n > 0) {
      this.posAttr.clearUpdateRanges()
      this.posAttr.addUpdateRange(0, n * 3)
      this.posAttr.needsUpdate = true
      this.colAttr.clearUpdateRanges()
      this.colAttr.addUpdateRange(0, n * 4)
      this.colAttr.needsUpdate = true
      this.sizeAttr.clearUpdateRanges()
      this.sizeAttr.addUpdateRange(0, n)
      this.sizeAttr.needsUpdate = true
      this.minAttr.clearUpdateRanges()
      this.minAttr.addUpdateRange(0, n)
      this.minAttr.needsUpdate = true
    }
    this.object.visible = n > 0
    const st = this.stats
    st.visible = n > 0
    st.paths = this.paths.size
    st.activePaths = active
    st.heads = heads
    st.points = n
    st.tickMs = performance.now() - t0
  }

  /** Write the point at arc length `s` of `p` into slot `n`. */
  private sample(p: FlowPath, s: number, n: number): void {
    const cum = p.cum
    let lo = 0
    let hi = cum.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid] <= s) lo = mid
      else hi = mid
    }
    const seg = cum[hi] - cum[lo]
    const f = seg > 0 ? (s - cum[lo]) / seg : 0
    const a = lo * 3
    const b = hi * 3
    const pts = p.pts
    const o = n * 3
    this.pos[o] = pts[a] + (pts[b] - pts[a]) * f
    this.pos[o + 1] = pts[a + 1] + (pts[b + 1] - pts[a + 1]) * f
    this.pos[o + 2] = pts[a + 2] + (pts[b + 2] - pts[a + 2]) * f
  }

  getStats(): FlowStats {
    let sig = 0
    for (let i = 0; i < this.stats.points * 3; i++) sig += this.pos[i]
    return { ...this.stats, sig }
  }

  /** Every path drawing particles right now (diagnostics / e2e only). */
  getPathInfo(): FlowPathInfo[] {
    const out: FlowPathInfo[] = []
    if (!this.wanted || !this.telemetry) return out
    for (const [key, p] of this.paths) {
      // live currents only (a path fading out after its current stopped is not listed)
      if (p.on < 0.02 || !(Math.abs(p.target) >= MIN_SHOWN_A)) continue
      out.push({ key, amps: p.shownA * p.dir, speed: flowSpeed(p.shownA) })
    }
    return out
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
    this.paths.clear()
    this.partPins.clear()
    if (typeof window !== 'undefined') {
      const w = window as unknown as Record<string, unknown>
      // only this layer's hooks (a remounted scene may already own newer ones)
      if (this.statsHook && w.__flowStats === this.statsHook) {
        delete w.__flowStats
        delete w.__flowPaths
      }
    }
  }
}

/**
 * Pooled GPU particles for the realism FX (owner: vivid; confetti: cheer):
 * ONE THREE.Points per blending mode, a fixed-size pool, a tiny procedural
 * shader (no textures): soft puff, ring (sound waves), tumbling confetti
 * quad (a crisp anti-aliased rectangle that rolls in the view plane and
 * flutters — narrower and darker edge-on), four-point star (sparkle) and a
 * crisp thin ring (the celebration's burst). The CPU integrates live
 * particles only; an idle system costs nothing (the Points object is hidden
 * when empty and no attribute is uploaded).
 *
 * Sizes: a positive size is in world units (perspective: smaller far away);
 * a NEGATIVE size is in CSS pixels on screen (-12 = 12 px at any zoom — the
 * confetti and the burst ring must read the same on a phone and a desktop).
 * A particle's size0 and size1 share one sign.
 */
import * as THREE from 'three'

export const SHAPE_PUFF = 0
export const SHAPE_RING = 1
export const SHAPE_STAR = 3
/** tumbling confetti quad: SHAPE_FLAKE + face-on share 0..0.99 (the flutter; animated when spin > 0) */
export const SHAPE_FLAKE = 2
/** crisp thin ring (≈ 2.5 px line, anti-aliased) */
export const SHAPE_CRISP_RING = 4

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
attribute float aShape;
attribute float aRot;
uniform float uScale;
uniform float uDpr;
varying vec4 vColor;
varying float vShape;
varying float vRot;
varying float vSize;
void main() {
  vColor = aColor;
  vShape = aShape;
  vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float px = aSize < 0.0 ? -aSize * uDpr : aSize * uScale / max(0.05, -mv.z);
  gl_PointSize = max(1.0, px);
  vSize = gl_PointSize;
  gl_Position = projectionMatrix * mv;
}
`

const FRAG = /* glsl */ `
varying vec4 vColor;
varying float vShape;
varying float vRot;
varying float vSize;
void main() {
  vec2 p = gl_PointCoord - vec2(0.5);
  float r = length(p);
  float aa = 1.0 / max(vSize, 1.0);
  float shade = 1.0;
  float a;
  if (vShape < 0.5) {
    a = exp(-r * r * 18.0) * step(r, 0.5);
  } else if (vShape < 1.5) {
    a = smoothstep(0.28, 0.38, r) * (1.0 - smoothstep(0.40, 0.5, r));
  } else if (vShape < 2.999) {
    // a 2:1 paper quad rolled by vRot; its width follows the flutter (edge-on = a sliver, darker)
    float f = clamp(vShape - 2.0, 0.0, 1.0);
    float c = cos(vRot);
    float s = sin(vRot);
    vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
    float hw = 0.42 * max(f, 0.08);
    a = (1.0 - smoothstep(hw - aa, hw + aa, abs(q.x))) * (1.0 - smoothstep(0.21 - aa, 0.21 + aa, abs(q.y)));
    shade = 0.6 + 0.4 * f;
  } else if (vShape < 3.5) {
    float core = exp(-r * r * 60.0);
    float sx = exp(-abs(p.x) * 34.0) * exp(-abs(p.y) * 5.0);
    float sy = exp(-abs(p.y) * 34.0) * exp(-abs(p.x) * 5.0);
    a = clamp(core + 0.8 * (sx + sy), 0.0, 1.0) * step(r, 0.5);
  } else {
    // crisp ring: a ≈ 2.5 px line just inside the sprite's edge
    float hw = 1.25 * aa;
    float rr = 0.5 - hw - aa;
    a = 1.0 - smoothstep(hw - aa, hw + aa, abs(r - rr));
  }
  a *= vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * shade, a);
  #include <colorspace_fragment>
}
`

export interface SpawnSpec {
  x: number
  y: number
  z: number
  vx?: number
  vy?: number
  vz?: number
  /** seconds */
  life: number
  /** world size at birth / at death */
  size0: number
  size1?: number
  /** linear RGB */
  r: number
  g: number
  b: number
  /** peak alpha */
  alpha: number
  shape?: number
  /** downward acceleration (u/s²) */
  gravity?: number
  /** velocity damping per second (0 = none) */
  drag?: number
  /** fade-in share of the life (0..1, default 0.08) */
  fadeIn?: number
  /** fade-out share at the end of the life (0..1); absent = fade over all of the rest (a puff) */
  fadeOut?: number
  /** flake flutter (rad/s) — SHAPE_FLAKE only */
  spin?: number
  /** roll in the view plane: start angle (rad) and speed (rad/s) — SHAPE_FLAKE only */
  rot?: number
  roll?: number
  /** twinkle (Hz) — alpha pulses */
  twinkle?: number
}

export class ParticleSystem {
  readonly points: THREE.Points
  readonly capacity: number
  private readonly geo: THREE.BufferGeometry
  private readonly mat: THREE.ShaderMaterial
  private readonly pos: Float32Array
  private readonly size: Float32Array
  private readonly color: Float32Array
  private readonly shape: Float32Array
  private readonly vel: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly s0: Float32Array
  private readonly s1: Float32Array
  private readonly peak: Float32Array
  private readonly grav: Float32Array
  private readonly drag: Float32Array
  private readonly fadeIn: Float32Array
  private readonly fadeOut: Float32Array
  private readonly spin: Float32Array
  private readonly twinkle: Float32Array
  private readonly baseShape: Float32Array
  private readonly rot: Float32Array
  private readonly roll: Float32Array
  /** live particles are packed into [0, live) */
  private live = 0
  private uploaded = false

  constructor(capacity: number, blending: THREE.Blending, opts: { depthTest?: boolean } = {}) {
    this.capacity = capacity
    this.pos = new Float32Array(capacity * 3)
    this.size = new Float32Array(capacity)
    this.color = new Float32Array(capacity * 4)
    this.shape = new Float32Array(capacity)
    this.vel = new Float32Array(capacity * 3)
    this.age = new Float32Array(capacity)
    this.life = new Float32Array(capacity)
    this.s0 = new Float32Array(capacity)
    this.s1 = new Float32Array(capacity)
    this.peak = new Float32Array(capacity)
    this.grav = new Float32Array(capacity)
    this.drag = new Float32Array(capacity)
    this.fadeIn = new Float32Array(capacity)
    this.fadeOut = new Float32Array(capacity)
    this.spin = new Float32Array(capacity)
    this.twinkle = new Float32Array(capacity)
    this.baseShape = new Float32Array(capacity)
    this.rot = new Float32Array(capacity)
    this.roll = new Float32Array(capacity)
    const geo = new THREE.BufferGeometry()
    const dyn = (arr: Float32Array, n: number) => {
      const a = new THREE.BufferAttribute(arr, n)
      a.setUsage(THREE.DynamicDrawUsage)
      return a
    }
    geo.setAttribute('position', dyn(this.pos, 3))
    geo.setAttribute('aSize', dyn(this.size, 1))
    geo.setAttribute('aColor', dyn(this.color, 4))
    geo.setAttribute('aShape', dyn(this.shape, 1))
    geo.setAttribute('aRot', dyn(this.rot, 1))
    geo.setDrawRange(0, 0)
    // particles roam the whole scene: never frustum-cull the pool
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    this.geo = geo
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 400 }, uDpr: { value: 1 } },
      transparent: true,
      depthWrite: false,
      depthTest: opts.depthTest ?? true,
      blending,
    })
    this.points = new THREE.Points(geo, this.mat)
    this.points.visible = false // shown while particles live (renderer.compile ignores visibility)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
    this.points.name = 'fx-particles'
  }

  get count(): number {
    return this.live
  }

  /**
   * pixels per world unit at distance 1 (viewport height / 2·tan(fov/2),
   * device px) and the device pixels per CSS pixel (for negative = pixel sizes)
   */
  setScale(s: number, dpr?: number): void {
    this.mat.uniforms.uScale.value = s
    if (typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0) this.mat.uniforms.uDpr.value = dpr
  }

  spawn(s: SpawnSpec): void {
    let i = this.live
    if (i >= this.capacity) {
      // pool full: recycle the oldest-by-progress slot (cheap: the first one)
      i = 0
    } else {
      this.live++
    }
    const i3 = i * 3
    this.pos[i3] = s.x
    this.pos[i3 + 1] = s.y
    this.pos[i3 + 2] = s.z
    this.vel[i3] = s.vx ?? 0
    this.vel[i3 + 1] = s.vy ?? 0
    this.vel[i3 + 2] = s.vz ?? 0
    this.age[i] = 0
    this.life[i] = Math.max(0.02, s.life)
    this.s0[i] = s.size0
    this.s1[i] = s.size1 ?? s.size0
    this.peak[i] = s.alpha
    this.grav[i] = s.gravity ?? 0
    this.drag[i] = s.drag ?? 0
    this.fadeIn[i] = s.fadeIn ?? 0.08
    this.fadeOut[i] = s.fadeOut ?? 0
    this.spin[i] = s.spin ?? 0
    this.twinkle[i] = s.twinkle ?? 0
    this.baseShape[i] = s.shape ?? SHAPE_PUFF
    this.rot[i] = s.rot ?? 0
    this.roll[i] = s.roll ?? 0
    const i4 = i * 4
    this.color[i4] = s.r
    this.color[i4 + 1] = s.g
    this.color[i4 + 2] = s.b
    this.color[i4 + 3] = 0
    this.size[i] = s.size0
    this.shape[i] = this.baseShape[i]
  }

  private kill(i: number): void {
    const last = this.live - 1
    if (i !== last) {
      const copy3 = (a: Float32Array) => {
        a[i * 3] = a[last * 3]
        a[i * 3 + 1] = a[last * 3 + 1]
        a[i * 3 + 2] = a[last * 3 + 2]
      }
      copy3(this.pos)
      copy3(this.vel)
      for (const a of [this.age, this.life, this.s0, this.s1, this.peak, this.grav, this.drag, this.fadeIn, this.fadeOut, this.spin, this.twinkle, this.baseShape, this.size, this.shape, this.rot, this.roll]) a[i] = a[last]
      for (let k = 0; k < 4; k++) this.color[i * 4 + k] = this.color[last * 4 + k]
    }
    this.live--
  }

  /** Integrate; returns true when anything is (or was just) visible. */
  update(dt: number, t: number): boolean {
    if (this.live === 0) {
      if (this.uploaded) {
        this.uploaded = false
        this.geo.setDrawRange(0, 0)
        this.points.visible = false
      }
      return false
    }
    const h = Math.min(Math.max(dt, 0), 0.05)
    for (let i = 0; i < this.live; ) {
      this.age[i] += h
      const k = this.age[i] / this.life[i]
      if (k >= 1) {
        this.kill(i)
        continue
      }
      const i3 = i * 3
      const damp = this.drag[i] > 0 ? Math.exp(-this.drag[i] * h) : 1
      this.vel[i3] *= damp
      this.vel[i3 + 1] = this.vel[i3 + 1] * damp - this.grav[i] * h
      this.vel[i3 + 2] *= damp
      this.pos[i3] += this.vel[i3] * h
      this.pos[i3 + 1] += this.vel[i3 + 1] * h
      this.pos[i3 + 2] += this.vel[i3 + 2] * h
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k
      const fi = this.fadeIn[i]
      const fo = this.fadeOut[i]
      let a =
        this.peak[i] *
        (k < fi ? k / Math.max(fi, 1e-3) : fo > 0 ? Math.min(1, (1 - k) / fo) : 1 - (k - fi) / Math.max(1 - fi, 1e-3))
      if (this.twinkle[i] > 0) a *= 0.55 + 0.45 * Math.sin((t + i * 0.37) * this.twinkle[i] * Math.PI * 2)
      this.color[i * 4 + 3] = Math.max(0, a)
      if (this.baseShape[i] >= SHAPE_FLAKE && this.baseShape[i] < SHAPE_STAR) {
        if (this.spin[i] !== 0) this.shape[i] = SHAPE_FLAKE + 0.08 + 0.9 * Math.abs(Math.sin(this.age[i] * this.spin[i] + i))
        this.rot[i] += this.roll[i] * h
      }
      i++
    }
    const n = this.live
    this.geo.setDrawRange(0, n)
    for (const name of ['position', 'aSize', 'aColor', 'aShape', 'aRot']) {
      const attr = this.geo.getAttribute(name) as THREE.BufferAttribute
      const per = attr.itemSize
      attr.clearUpdateRanges()
      attr.addUpdateRange(0, n * per)
      attr.needsUpdate = true
    }
    this.points.visible = n > 0
    this.uploaded = true
    return true
  }

  clear(): void {
    this.live = 0
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
  }
}

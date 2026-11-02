/**
 * SceneFx (owner: vivid) — the 3D feedback layer of the mounted scene:
 *
 *  - damage events from the telemetry the parts' OWN models publish
 *    (ComponentTelemetry.damage): a part that burns (LED die, resistor film,
 *    a board's on-board LED) gets a flash, sparks and a smoke puff, then a
 *    thin smoke trail; an electrolytic that vents gets a vapour puff; each
 *    plays the short 'burn' cue (setFxCueSink). Only FRESH events animate —
 *    a part that is already burned when its mesh is rebuilt just looks burned;
 *  - heat: a part whose thermal model is hot (telemetry `heat` ≥ 1 — the
 *    resistor's dissipation above its rating) smokes, more and darker the
 *    hotter it gets;
 *  - sound: a buzzer that is really driven (telemetry `sounding`) sends out
 *    expanding sound rings;
 *  - pin damage: a board pin the simulation MEASURED beyond its absolute
 *    maximum (pinDamageFromIssues — latched until reset) wears a pulsing red
 *    warning marker;
 *  - celebrations (fx bus 'celebrate'): 'lesson-pass' = a crisp ring and a
 *    fountain of tumbling confetti quads (11–16 px on screen, gravity, roll
 *    and flutter, 1–1.5 s) from each working part the user can see — never
 *    from behind the 「完成！」 badge (the event's `avoid` rect: the badge's
 *    measured box) or a side panel, and from the circuit's rim only when
 *    every part is hidden; 'circuit-ok' = a crisp ring and sparkles along
 *    the parts that newly work;
 *  - the per-frame part animators (registry.ts).
 *
 * Everything is pooled GPU particles (particles.ts) and a few sprites; an
 * idle layer costs one early return per frame. prefers-reduced-motion: no
 * moving particles — the same events show as static glows that fade.
 */
import * as THREE from 'three'
import type { SimTelemetry, ComponentTelemetry } from '../../../model/types'
import { pinDamageFromIssues } from '../../../sim/erc/rules-damage'
import type { SceneFxEvent, ScreenRect } from './bus'
import { ParticleSystem, SHAPE_CRISP_RING, SHAPE_FLAKE, SHAPE_PUFF, SHAPE_RING, SHAPE_STAR, type SpawnSpec } from './particles'
import { setFxReducedMotion, tickFrameAnimators } from './registry'
import { asFxSprite } from '../../meshes/led-glow-render'

export interface SceneFxHost {
  /**
   * world bounds of a placed part's solid body into `out` (the scene uses
   * partBodyBounds: no light / damage sprites); false = unknown id
   */
  bounds(id: string, out: THREE.Box3): boolean
  /** world position of a part's catalog pin (the wire attach point), null = unknown */
  pinWorld(id: string, pin: string): THREE.Vector3 | null
  /** ids of every placed part */
  ids(): Iterable<string>
}

export type FxCue = 'burn'
type CueSink = (cue: FxCue) => void
let cueSink: CueSink | null = null

/** The UI's sound player for damage cues (CelebrationOverlay registers playCue). */
export function setFxCueSink(sink: CueSink | null): void {
  cueSink = sink
}

/** a damage event younger than this (simulation seconds) animates */
export const FRESH_DAMAGE_S = 1.5

interface Emitter {
  kind: 'smoke' | 'heat' | 'rings'
  x: number
  y: number
  z: number
  /** particles per second */
  rate: number
  /** accumulated fractional spawns */
  acc: number
  /** wall time (s, SceneFx clock) the emitter ends; Infinity = until removed */
  until: number
  /** 0..1 strength (heat level) */
  level: number
}

interface Marker {
  sprite: THREE.Sprite
  key: string
}

const tmpBox = new THREE.Box3()
const tmpV = new THREE.Vector3()
const meshBox = new THREE.Box3()

const isAdditive = (m: THREE.Material | THREE.Material[]): boolean =>
  Array.isArray(m) ? m.some((x) => x?.blending === THREE.AdditiveBlending) : m?.blending === THREE.AdditiveBlending

function unionSolid(o: THREE.Object3D, out: THREE.Box3): void {
  for (const c of o.children) {
    // hidden objects and FX (light, haze, soot, pick proxies) are not the part
    if (!c.visible || c.userData.bbNoStudio === true) continue
    const mesh = c as THREE.Mesh
    if (mesh.isMesh && !isAdditive(mesh.material)) {
      const im = c as THREE.InstancedMesh
      if (im.isInstancedMesh) {
        if (im.boundingBox === null) im.computeBoundingBox()
        if (im.boundingBox) meshBox.copy(im.boundingBox)
        else meshBox.makeEmpty()
      } else {
        const g = mesh.geometry
        if (g.boundingBox === null) g.computeBoundingBox()
        if (g.boundingBox) meshBox.copy(g.boundingBox)
        else meshBox.makeEmpty()
      }
      if (!meshBox.isEmpty()) out.union(meshBox.applyMatrix4(c.matrixWorld))
    }
    unionSolid(c, out)
  }
}

/**
 * The world box of a part's solid body (`root`'s world matrices must be
 * current): its visible meshes only — never a sprite (an LED's invisible
 * pick proxy, glare, a hot resistor's haze, soot), an additive glow shell,
 * an FX object (bbNoStudio) or a hidden damage mesh. Box3.setFromObject
 * counts every one of those, visible or not; a burn's flash and smoke start
 * at THIS top. A part with no visible solid mesh falls back to its full box.
 */
export function partBodyBounds(root: THREE.Object3D, out: THREE.Box3): THREE.Box3 {
  out.makeEmpty()
  unionSolid(root, out)
  if (out.isEmpty()) out.setFromObject(root)
  return out
}

/** a polarized can tolerates ≈ 1 V reversed (sim CAP_REVERSE_OK); beyond it a vented can keeps wisping */
export const VENT_WISP_REVERSE_V = 1
/** the reverse voltage across a capacitor (− lead above + lead), from its own pin voltages */
function reverseOf(ct: ComponentTelemetry): number {
  const pv = ct.pinVoltages
  const p = pv?.p1
  const n = pv?.p2
  return typeof p === 'number' && typeof n === 'number' ? n - p : 0
}
const tmpSize = new THREE.Vector2()
const tmpProj = new THREE.Vector3()

function lin(hex: number): { r: number; g: number; b: number } {
  const c = new THREE.Color(hex)
  return { r: c.r, g: c.g, b: c.b }
}

const SPARK = lin(0xffa24a)
const FLASH = lin(0xfff0d0)
const SOOT = lin(0x1e1c1a)
const SMOKE = lin(0x6a6764)
const HAZE = lin(0x8f8a84)
const VAPOUR = lin(0xd8d6cf)
const RING = lin(0x9fdcff)
const OK_GREEN = lin(0x8dffb8)
/** the crisp success ring / still halo (normal blending): a deeper green that reads on the white board and the wood */
const OK_RING = lin(0x1fbf5c)
const OK_WHITE = lin(0xf2fff6)
// saturated paper colours that read on the white board and the dark wood alike (no white)
const CONFETTI = [0xff3b5c, 0xffb020, 0x1f9bff, 0x2fc75a, 0xa95cf0, 0xff7a1a, 0x00c2b8].map(lin)
/** confetti quads per lesson pass (spread over the fountains, at least 20 each) */
const CONFETTI_TOTAL = 120
/** fountains on the circuit's rim when the badge / a panel hides EVERY working part */
const MIN_BURSTS = 3

let markerTex: THREE.Texture | null | undefined
function markerTexture(): THREE.Texture | null {
  if (markerTex !== undefined) return markerTex
  if (typeof document === 'undefined') return (markerTex = null)
  const S = 128
  const cv = document.createElement('canvas')
  cv.width = S
  cv.height = S
  const ctx = cv.getContext('2d')
  if (!ctx) return (markerTex = null)
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,60,40,0.55)')
  g.addColorStop(0.55, 'rgba(255,40,30,0.2)')
  g.addColorStop(1, 'rgba(255,40,30,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  // warning triangle with "!"
  ctx.beginPath()
  ctx.moveTo(S / 2, S * 0.2)
  ctx.lineTo(S * 0.8, S * 0.74)
  ctx.lineTo(S * 0.2, S * 0.74)
  ctx.closePath()
  ctx.fillStyle = '#ff3b30'
  ctx.fill()
  ctx.lineWidth = 5
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 40px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('!', S / 2, S * 0.56)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  markerTex = tex
  return tex
}

export class SceneFx {
  readonly group: THREE.Group
  private readonly soft = new ParticleSystem(420, THREE.NormalBlending)
  private readonly glow = new ParticleSystem(560, THREE.AdditiveBlending)
  /** sound rings: drawn over the part that sounds (no depth test — the body must not cut them) */
  private readonly rings = new ParticleSystem(48, THREE.AdditiveBlending, { depthTest: false })
  private readonly emitters = new Map<string, Emitter>()
  /** parts with a heat / sound-ring emitter (allocation-free lookups per frame) */
  private readonly heatIds = new Set<string>()
  private readonly ringIds = new Set<string>()
  /** glow2 (m3): vented cans still reversed — a faint wisp keeps rising */
  private readonly wispIds = new Set<string>()
  private readonly markers = new Map<string, Marker>()
  /** id → last damage key seen ('burned@0.0012') */
  private readonly seenDamage = new Map<string, string>()
  private issuesRef: unknown = null
  private issuesLen = -1
  private clock = 0
  private readonly markerMat: THREE.SpriteMaterial
  /** the last rendered camera and canvas (the celebration projects through them) */
  private cam: THREE.PerspectiveCamera | null = null
  private dom: HTMLElement | null = null

  constructor(
    private readonly host: SceneFxHost,
    private readonly reduced: boolean,
  ) {
    setFxReducedMotion(reduced)
    this.group = new THREE.Group()
    this.group.name = 'fx'
    this.group.add(this.soft.points, this.glow.points, this.rings.points)
    this.markerMat = new THREE.SpriteMaterial({ map: markerTexture(), transparent: true, depthTest: false, depthWrite: false })
    // e2e (?e2e only): read-only access to the realism state for the replays
    try {
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('e2e')) {
        ;(window as unknown as Record<string, unknown>).__vividFx = this
      }
    } catch {
      /* no location */
    }
  }

  /**
   * e2e / diagnostics: what the scene SHOWS per part — LED halo / flare /
   * pool, resistor glow / char, soot / cracks, vents — read from the scene
   * graph (names set by the part builders), plus the FX counters.
   */
  debugLook(): Record<string, unknown> {
    const parts: Record<string, Record<string, unknown>> = {}
    const root = this.group.parent?.parent
    root?.traverse((o) => {
      if (!o.name) return
      let p: THREE.Object3D | null = o
      let id: string | undefined
      while (p && !id) {
        id = typeof p.userData.componentId === 'string' ? p.userData.componentId : undefined
        p = p.parent
      }
      if (!id) return
      const rec = (parts[id] ??= {})
      const mat = (o as THREE.Mesh).material as THREE.Material & { opacity?: number }
      if (['led-halo', 'led-flare', 'led-pool', 'res-glow', 'res-char', 'res-gap', 'cap-vented'].includes(o.name)) {
        rec[o.name] = { visible: o.visible, opacity: mat?.opacity ?? null, scale: +o.scale.x.toFixed(3) }
      }
    })
    return { parts, particles: this.particleCount, emitters: this.emitterCount, markers: this.markerCount }
  }

  /** live particle count (tests / diagnostics) */
  get particleCount(): number {
    return this.soft.count + this.glow.count + this.rings.count
  }

  get emitterCount(): number {
    return this.emitters.size
  }

  get markerCount(): number {
    return this.markers.size
  }

  // ------------------------------------------------------------ telemetry

  setTelemetry(t: SimTelemetry | null): void {
    if (!t) {
      this.emitters.clear()
      this.heatIds.clear()
      this.ringIds.clear()
      this.wispIds.clear()
      this.seenDamage.clear()
      this.clearMarkers()
      this.issuesRef = null
      this.issuesLen = -1
      return
    }
    const comps = t.components
    for (const id in comps) {
      const ct = comps[id]
      if (!ct) continue
      this.damageOf(id, id, ct, t.time)
      if (ct.sub) for (const sid in ct.sub) if (ct.sub[sid]?.damage) this.damageOf(`${id}/${sid}`, id, ct.sub[sid], t.time)
      // heat smoke (resistor above its rating)
      // (keys are built only for parts that have / get an emitter: the
      // steady state of a big circuit allocates nothing per frame)
      const heat = typeof ct.heat === 'number' && ct.damage?.kind !== 'burned' ? ct.heat : 0
      if (heat >= 1) {
        const hk = `heat:${id}`
        const e = this.emitters.get(hk) ?? this.addEmitter(hk, 'heat', id, Infinity)
        if (e) {
          e.level = Math.min(1, (heat - 1) / 2.5)
          e.rate = 1.5 + 9 * e.level
          this.heatIds.add(id)
        }
      } else if (this.heatIds.has(id)) {
        this.heatIds.delete(id)
        this.emitters.delete(`heat:${id}`)
      }
      // glow2 (m3): a vented can still reversed by more than its 1 V keeps a
      // faint wisp rising (the electrolyte still boiling) until it is fixed
      if (ct.damage?.kind === 'vented' && reverseOf(ct) > VENT_WISP_REVERSE_V) {
        if (!this.wispIds.has(id)) {
          const e = this.addEmitter(`wisp:${id}`, 'heat', id, Infinity)
          if (e) {
            e.level = 0.15
            e.rate = 1.3
            this.wispIds.add(id)
          }
        }
      } else if (this.wispIds.has(id)) {
        this.wispIds.delete(id)
        this.emitters.delete(`wisp:${id}`)
      }
      // buzzer sound rings
      if (ct.sounding === true) {
        if (!this.ringIds.has(id)) {
          const e = this.addEmitter(`ring:${id}`, 'rings', id, Infinity)
          if (e) {
            e.rate = 3.4
            this.ringIds.add(id)
          }
        }
      } else if (this.ringIds.has(id)) {
        this.ringIds.delete(id)
        this.emitters.delete(`ring:${id}`)
      }
    }
    // ids gone from the telemetry (part removed): drop their emitters
    if (this.emitters.size > 0) {
      for (const [k] of this.emitters) {
        const id = k.slice(k.indexOf(':') + 1)
        if (!(id in comps)) {
          this.emitters.delete(k)
          this.heatIds.delete(id)
          this.ringIds.delete(id)
          this.wispIds.delete(id)
        }
      }
    }
    // pin damage markers: only when the (latched, append-only) issue list changed
    if (t.issues !== this.issuesRef || t.issues.length !== this.issuesLen) {
      this.issuesRef = t.issues
      this.issuesLen = t.issues.length
      this.syncMarkers(t)
    }
  }

  private damageOf(key: string, partId: string, ct: ComponentTelemetry, now: number): void {
    const d = ct.damage
    const dk = d && d.kind !== 'overheating' ? `${d.kind}@${d.since}` : ''
    const prev = this.seenDamage.get(key)
    if (prev === dk) return
    if (dk) this.seenDamage.set(key, dk)
    else this.seenDamage.delete(key)
    if (!d || dk === '') return
    if (!(now - d.since <= FRESH_DAMAGE_S)) return // already broken when we first saw it: the look says so
    if (d.kind === 'burned') this.burst(partId, 'burn')
    else if (d.kind === 'vented') this.burst(partId, 'vent')
  }

  private topOf(id: string, out: THREE.Vector3): boolean {
    if (!this.host.bounds(id, tmpBox) || tmpBox.isEmpty()) return false
    tmpBox.getCenter(out)
    out.y = tmpBox.max.y + 0.05
    return true
  }

  private addEmitter(key: string, kind: Emitter['kind'], id: string, until: number): Emitter | null {
    if (!this.topOf(id, tmpV)) return null
    const e: Emitter = { kind, x: tmpV.x, y: tmpV.y, z: tmpV.z, rate: 4, acc: 0, until, level: 0 }
    this.emitters.set(key, e)
    return e
  }

  /** A part just burned / vented: flash, sparks, puff, then a thin trail. */
  burst(id: string, kind: 'burn' | 'vent'): void {
    if (!this.topOf(id, tmpV)) return
    const { x, y, z } = tmpV
    cueSink?.('burn')
    if (this.reduced) {
      this.glow.spawn({ x, y, z, life: 0.9, size0: 2.6, r: FLASH.r, g: FLASH.g, b: FLASH.b, alpha: 0.7, fadeIn: 0.02 })
      this.soft.spawn({ x, y: y + 0.6, z, life: 2.4, size0: 2.2, r: SOOT.r, g: SOOT.g, b: SOOT.b, alpha: 0.35, fadeIn: 0.05 })
      return
    }
    this.glow.spawn({ x, y, z, life: 0.2, size0: 4.2, size1: 1.2, r: FLASH.r, g: FLASH.g, b: FLASH.b, alpha: 0.95, fadeIn: 0.01 })
    const nSpark = kind === 'burn' ? 22 : 8
    for (let i = 0; i < nSpark; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 2 + Math.random() * 4
      this.glow.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * sp,
        vy: 1.5 + Math.random() * 3.5,
        vz: Math.sin(a) * sp,
        life: 0.25 + Math.random() * 0.4,
        size0: 0.22,
        size1: 0.05,
        r: SPARK.r,
        g: SPARK.g,
        b: SPARK.b,
        alpha: 1,
        shape: SHAPE_STAR,
        gravity: 9,
        drag: 1.2,
        fadeIn: 0.01,
      })
    }
    const col = kind === 'burn' ? SOOT : VAPOUR
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 0.3 + Math.random() * 0.8
      this.soft.spawn({
        x: x + Math.cos(a) * 0.1,
        y,
        z: z + Math.sin(a) * 0.1,
        vx: Math.cos(a) * sp,
        vy: 0.8 + Math.random() * 1.2,
        vz: Math.sin(a) * sp,
        life: 1.4 + Math.random() * 1.0,
        size0: 0.5,
        size1: 2.4 + Math.random() * 1.2,
        r: col.r,
        g: col.g,
        b: col.b,
        alpha: kind === 'burn' ? 0.55 : 0.4,
        drag: 1.1,
        fadeIn: 0.06,
      })
    }
    // the thin trail that follows (decays over its lifetime)
    this.emitters.set(`smoke:${id}`, { kind: 'smoke', x, y, z, rate: 6, acc: 0, until: this.clock + (kind === 'burn' ? 7 : 4), level: kind === 'burn' ? 1 : 0.4 })
  }

  // ------------------------------------------------------------ markers

  private clearMarkers(): void {
    for (const mk of this.markers.values()) this.group.remove(mk.sprite)
    this.markers.clear()
  }

  private syncMarkers(t: SimTelemetry): void {
    const dmg = pinDamageFromIssues(t.issues)
    const keep = new Set<string>()
    for (const d of dmg) {
      const key = `${d.componentId}:${d.pin}`
      keep.add(key)
      if (this.markers.has(key)) continue
      const p = this.host.pinWorld(d.componentId, d.pin)
      if (!p) continue
      // never in the Enhanced SAO normal/depth pre-pass (asFxSprite)
      const sprite = asFxSprite(new THREE.Sprite(this.markerMat))
      sprite.position.set(p.x, p.y + 1.3, p.z)
      sprite.scale.setScalar(1.8)
      sprite.renderOrder = 6
      sprite.name = `fx-pin-damage:${key}`
      this.group.add(sprite)
      this.markers.set(key, { sprite, key })
    }
    for (const [k, mk] of this.markers) {
      if (keep.has(k)) continue
      this.group.remove(mk.sprite)
      this.markers.delete(k)
    }
  }

  // ------------------------------------------------------------ celebration

  handle(e: SceneFxEvent): void {
    if (e.type !== 'celebrate') return
    const ids = e.componentIds.length > 0 ? e.componentIds : [...this.host.ids()]
    const tops: THREE.Vector3[] = []
    const union = new THREE.Box3()
    for (const id of ids.slice(0, 32)) {
      if (!this.host.bounds(id, tmpBox) || tmpBox.isEmpty()) continue
      union.union(tmpBox)
      const c = tmpBox.getCenter(new THREE.Vector3())
      c.y = tmpBox.max.y + 0.1
      tops.push(c)
    }
    if (tops.length === 0) return
    if (e.kind === 'lesson-pass') this.confetti(tops, union, e.avoid)
    else this.sparkle(tops)
  }

  /**
   * World point → viewport CSS px through the last rendered camera; null
   * before the first frame, without a canvas (node tests) or behind the camera.
   */
  private toClient(p: THREE.Vector3, rect: DOMRect): { x: number; y: number } | null {
    if (!this.cam) return null
    tmpProj.copy(p).project(this.cam)
    if (!(tmpProj.z < 1) || !Number.isFinite(tmpProj.x) || !Number.isFinite(tmpProj.y)) return null
    return { x: rect.left + ((tmpProj.x + 1) / 2) * rect.width, y: rect.top + ((1 - tmpProj.y) / 2) * rect.height }
  }

  /**
   * Where the lesson-pass burst comes from: the working parts the user can
   * see — not one the 「完成！」 badge hides (`avoid`) or a side panel
   * covers. Only when EVERY part is hidden and `useRim` is set (the confetti)
   * do points on the circuit's edge that are in view stand in, so the cheer
   * still reads; the reduced-motion glow marks parts only. At most 8.
   */
  private burstOrigins(tops: THREE.Vector3[], union: THREE.Box3, avoid: ScreenRect | undefined, useRim: boolean): THREE.Vector3[] {
    const dom = this.dom
    if (!avoid || !this.cam || !dom || typeof dom.getBoundingClientRect !== 'function') return tops.slice(0, 8)
    const rect = dom.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 0)) return tops.slice(0, 8)
    const PAD = 28
    const doc = dom.ownerDocument
    /** the 3D view itself is what the user sees at (x, y) — not a side panel or sheet over it */
    const seen = (x: number, y: number): boolean => {
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false
      if (!doc || typeof doc.elementFromPoint !== 'function') return true
      const el = doc.elementFromPoint(x, y)
      return el === null || el === dom || dom.contains(el)
    }
    const clear = (p: THREE.Vector3): boolean => {
      const q = this.toClient(p, rect)
      if (!q) return false
      const hidden = q.x >= avoid.x0 - PAD && q.x <= avoid.x1 + PAD && q.y >= avoid.y0 - PAD && q.y <= avoid.y1 + PAD
      // the burst spreads ≈ 40 px: its sides must be in the open view too
      return !hidden && seen(q.x, q.y) && seen(q.x - 40, q.y) && seen(q.x + 40, q.y)
    }
    const chosen = tops.filter(clear).slice(0, 8)
    if (chosen.length > 0) return chosen
    if (!useRim) return tops.slice(0, 8)
    // every part hidden: burst from the circuit's rim (in view, clear of the
    // badge, spread apart), so the cheer still reads around the circuit
    let y = Infinity
    for (const p of tops) y = Math.min(y, p.y)
    const m = 1.5
    const cx = (union.min.x + union.max.x) / 2
    const cz = (union.min.z + union.max.z) / 2
    const rim: THREE.Vector3[] = []
    for (const x of [union.min.x - m, cx, union.max.x + m]) {
      for (const z of [union.min.z - m, cz, union.max.z + m]) {
        if (x !== cx || z !== cz) rim.push(new THREE.Vector3(x, y, z))
      }
    }
    const open = rim.filter(clear)
    while (chosen.length < MIN_BURSTS && open.length > 0) {
      // the rim point farthest from every burst chosen so far
      let best = 0
      let bestD = -1
      for (let i = 0; i < open.length; i++) {
        let d = Infinity
        for (const c of chosen) d = Math.min(d, c.distanceToSquared(open[i]))
        if (chosen.length === 0) d = this.toClient(open[i], rect)?.y ?? 0 // none yet: the lowest on screen (nearest the viewer)
        if (d > bestD) {
          bestD = d
          best = i
        }
      }
      chosen.push(open.splice(best, 1)[0])
    }
    return chosen.length > 0 ? chosen : tops.slice(0, 8)
  }

  /**
   * The lesson-pass burst: from each working part a crisp expanding ring
   * and a fountain of tumbling paper quads (11–16 CSS px sprites — the quad
   * itself 9–13 px long) that pop up, roll, flutter and fall under gravity
   * over 1–1.5 s. Reduced motion: a still glow on each part, nothing moves.
   */
  private confetti(tops: THREE.Vector3[], union: THREE.Box3, avoid: ScreenRect | undefined): void {
    const from = this.burstOrigins(tops, union, avoid, !this.reduced)
    if (this.reduced) {
      // a still green halo on each visible part (normal blending: it reads on the white board too)
      for (const p of from) {
        this.soft.spawn({ x: p.x, y: p.y + 0.3, z: p.z, life: 2.6, size0: 3.4, r: OK_RING.r, g: OK_RING.g, b: OK_RING.b, alpha: 0.5, fadeIn: 0.12, fadeOut: 0.35 })
      }
      return
    }
    const per = Math.max(20, Math.ceil(CONFETTI_TOTAL / from.length))
    let n = 0
    for (const p of from) {
      // the burst: one crisp ring, not a haze
      this.soft.spawn({ x: p.x, y: p.y + 0.15, z: p.z, life: 0.55, size0: -14, size1: -88, r: OK_RING.r, g: OK_RING.g, b: OK_RING.b, alpha: 0.95, shape: SHAPE_CRISP_RING, fadeIn: 0.02 })
      for (let i = 0; i < per; i++, n++) {
        const a = Math.random() * Math.PI * 2
        const sp = 2 + Math.random() * 3.5
        const c = CONFETTI[n % CONFETTI.length]
        this.soft.spawn({
          x: p.x + Math.cos(a) * 0.25,
          y: p.y + 0.1,
          z: p.z + Math.sin(a) * 0.25,
          vx: Math.cos(a) * sp,
          vy: 4 + Math.random() * 3.5,
          vz: Math.sin(a) * sp,
          life: 1.0 + Math.random() * 0.5,
          size0: -(11 + Math.random() * 5),
          r: c.r,
          g: c.g,
          b: c.b,
          alpha: 1,
          shape: SHAPE_FLAKE + 0.5,
          spin: 6 + Math.random() * 9,
          rot: Math.random() * Math.PI,
          roll: (Math.random() - 0.5) * 12,
          gravity: 9,
          drag: 1.1,
          fadeIn: 0.02,
          fadeOut: 0.3,
        })
      }
    }
  }

  private sparkle(tops: THREE.Vector3[]): void {
    const per = Math.max(3, Math.min(10, Math.floor(60 / tops.length)))
    for (const p of tops) {
      if (this.reduced) {
        this.glow.spawn({ x: p.x, y: p.y + 0.3, z: p.z, life: 1.6, size0: 1.4, r: OK_GREEN.r, g: OK_GREEN.g, b: OK_GREEN.b, alpha: 0.8, shape: SHAPE_STAR, fadeIn: 0.1 })
        continue
      }
      this.soft.spawn({ x: p.x, y: p.y, z: p.z, life: 0.6, size0: -10, size1: -60, r: OK_RING.r, g: OK_RING.g, b: OK_RING.b, alpha: 0.9, shape: SHAPE_CRISP_RING, fadeIn: 0.02 })
      for (let i = 0; i < per; i++) {
        const a = Math.random() * Math.PI * 2
        const rr = 0.3 + Math.random() * 1.1
        const c = i % 2 === 0 ? OK_GREEN : OK_WHITE
        this.glow.spawn({
          x: p.x + Math.cos(a) * rr,
          y: p.y + Math.random() * 0.6,
          z: p.z + Math.sin(a) * rr,
          vy: 0.4 + Math.random() * 0.8,
          life: 0.8 + Math.random() * 0.8,
          size0: 0.55 + Math.random() * 0.35,
          size1: 0.15,
          r: c.r,
          g: c.g,
          b: c.b,
          alpha: 1,
          shape: SHAPE_STAR,
          twinkle: 3 + Math.random() * 3,
          drag: 0.5,
          fadeIn: 0.15,
        })
      }
    }
  }

  // ------------------------------------------------------------ frame

  tick(t: number, dt: number, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): void {
    this.clock = t
    this.cam = camera
    this.dom = (renderer as { domElement?: HTMLElement }).domElement ?? null
    tickFrameAnimators(t, dt)
    const busy = this.emitters.size > 0 || this.particleCount > 0 || this.markers.size > 0
    if (!busy) {
      // hide whatever the last frame showed (no upload when already hidden)
      this.soft.update(dt, t)
      this.glow.update(dt, t)
      this.rings.update(dt, t)
      return
    }
    renderer.getDrawingBufferSize(tmpSize)
    const scale = tmpSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    const dpr = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1
    this.soft.setScale(scale, dpr)
    this.glow.setScale(scale, dpr)
    this.rings.setScale(scale, dpr)
    for (const [k, e] of this.emitters) {
      if (t >= e.until) {
        this.emitters.delete(k)
        continue
      }
      e.acc += e.rate * Math.min(dt, 0.1)
      while (e.acc >= 1) {
        e.acc -= 1
        this.emit(e, t)
      }
    }
    if (this.markers.size > 0) {
      const pulse = this.reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 6)
      this.markerMat.opacity = this.reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 6)
      for (const mk of this.markers.values()) mk.sprite.scale.setScalar(1.8 * pulse)
    }
    this.soft.update(dt, t)
    this.glow.update(dt, t)
    this.rings.update(dt, t)
  }

  private emit(e: Emitter, t: number): void {
    const jx = (Math.random() - 0.5) * 0.3
    const jz = (Math.random() - 0.5) * 0.3
    if (e.kind === 'rings') {
      const s: SpawnSpec = { x: e.x, y: e.y + 0.35, z: e.z, life: 0.9, size0: this.reduced ? 2.6 : 1.2, size1: this.reduced ? 2.6 : 4.4, r: RING.r, g: RING.g, b: RING.b, alpha: 0.8, shape: SHAPE_RING, fadeIn: 0.05 }
      this.rings.spawn(s)
      return
    }
    if (this.reduced) return // static cues only: the part's own look carries it
    if (e.kind === 'smoke') {
      // decays with the remaining time of the trail
      const left = Math.max(0, Math.min(1, (e.until - t) / 6))
      this.soft.spawn({ x: e.x + jx, y: e.y, z: e.z + jz, vx: jx * 0.6, vy: 0.6 + Math.random() * 0.5, vz: jz * 0.6, life: 2.2 + Math.random(), size0: 0.3, size1: 1.8, r: SMOKE.r, g: SMOKE.g, b: SMOKE.b, alpha: 0.28 * (0.3 + 0.7 * left) * e.level + 0.05, drag: 0.4, fadeIn: 0.12 })
      return
    }
    // heat: light haze wisps when warm, darker heavier smoke when far over
    const lv = e.level
    const c = lv > 0.45 ? SMOKE : HAZE
    this.soft.spawn({ x: e.x + jx, y: e.y, z: e.z + jz, vx: jx * 0.5, vy: 0.5 + Math.random() * 0.5 + lv * 0.4, vz: jz * 0.5, life: 1.8 + Math.random() * 0.8, size0: 0.3, size1: 1.4 + lv * 1.4, r: c.r, g: c.g, b: c.b, alpha: 0.2 + 0.3 * lv, drag: 0.3, fadeIn: 0.15 })
  }

  dispose(): void {
    this.clearMarkers()
    this.emitters.clear()
    this.soft.dispose()
    this.glow.dispose()
    this.rings.dispose()
    this.markerMat.dispose()
  }
}

// keep the shape constants referenced for tree-shaking clarity
void SHAPE_PUFF

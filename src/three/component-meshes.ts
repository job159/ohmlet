/**
 * Procedural 3D component visuals (meshes agent).
 *
 * Contract: build/refresh THREE.Object3D visuals for components.
 *
 * Coordinate conventions (see src/model/breadboard.ts):
 *  - 1 unit = one hole pitch (0.1"). Board top surface is y = 0.
 *  - `pinPositions` are world positions of each pin's hole top (y=0) in
 *    catalog pin order; off-board components get their terminal posts.
 *  - The returned object must be positioned in world space by the builder
 *    itself (use the pin positions); the scene adds it unmodified.
 *  - obj.userData.componentId is set by the scene after build.
 *
 * Implementation lives in src/three/meshes/*; this module dispatches on
 * `entry.visual.shape` and keeps per-instance update closures in a WeakMap so
 * the public BuiltComponent shape stays exactly as the contract requires.
 */

import * as THREE from 'three'
import type { ComponentInstance, ComponentTelemetry } from '../model/types'
import type { CatalogEntry } from '../model/catalog'
import type { RoutedComponent } from './internal/wire-router'
import {
  BuildResult,
  VisualUpdater,
  centroidOf,
  isSharedResource,
  plastic,
  topLabel,
} from './meshes/shared'
import {
  buildCapacitor,
  buildDiode,
  buildInductor,
  buildPhotoresistor,
  buildPotentiometer,
  buildResistor,
} from './meshes/passives'
import { buildLed, buildTo92 } from './meshes/semis'
import { buildButton, buildDipSwitch, buildSlideSwitch } from './meshes/switches'
import { buildDip, buildSevenSeg } from './meshes/ics'
import { buildBuzzer, buildInstrumentBox, buildProbe } from './meshes/instruments'
import { buildLogicProbe, buildMultimeter } from './meshes/instruments-ext'
import { buildBluePill } from './meshes/boards'
import { tryModelOverride } from './meshes/gltf-overrides'
import { registeredMeshBuilder } from './meshes/registry'

// part-family mesh modules register themselves (src/three/meshes/ext/*.mesh.ts)
import.meta.glob('./meshes/ext/*.mesh.ts', { eager: true })

export interface BuiltComponent {
  object: THREE.Object3D
  /** world position of each pin (for wire attachment), catalog pin order */
  pinWorld: THREE.Vector3[]
}

/** Per-instance refresh closures, keyed by the built root object. */
const updaters = new WeakMap<THREE.Object3D, VisualUpdater>()

export function buildComponentObject(
  comp: ComponentInstance,
  entry: CatalogEntry,
  pinPositions: THREE.Vector3[],
  /**
   * Optional router-planned pose for 2/3-lead leaded parts (see
   * internal/wire-router): body at bodyCenter along bodyDir, leads following
   * the planned waypoints into their exact holes. Malformed/absent poses fall
   * back to the pins-derived placement.
   */
  routed?: RoutedComponent,
): BuiltComponent {
  // authored .glb override first (no-op unless registered — see gltf-overrides)
  const result =
    tryModelOverride(comp, entry, pinPositions, () =>
      dispatch(comp, entry, pinPositions, routed),
    ) ?? dispatch(comp, entry, pinPositions, routed)
  if (result.update) updaters.set(result.object, result.update)
  return { object: result.object, pinWorld: result.pinWorld }
}

export function updateComponentVisual(
  built: BuiltComponent,
  comp: ComponentInstance,
  entry: CatalogEntry,
  telemetry: ComponentTelemetry | null,
): void {
  updaters.get(built.object)?.(comp, entry, telemetry)
}

/** True when the built object has a telemetry/param updater at all. */
export function hasComponentUpdater(built: BuiltComponent): boolean {
  return updaters.has(built.object)
}

// ---------------------------------------------------------------------------
// PERF: telemetry diffing (src/three/scene.ts setTelemetry)
//
// The engine publishes a FRESH telemetry snapshot every frame (structured
// clone from the simulation worker), but most parts look exactly the same
// from one frame to the next. Visual updaters are pure functions of
// (component params, the telemetry fields they read) — so a part whose
// visually relevant telemetry is unchanged can skip its updater AND the
// matrix recomposition of its subtree.
//
// VISUALLY_INERT_TELEMETRY_KEYS are fields NO mesh updater reads (they feed
// the inspector / status UI only): per-pin voltages, branch current and
// power, chip logic outputs, the MCU execution state (pc / cycles change
// every frame) and the 顯示電流 pin currents (window means — they change
// every frame while tracking; the flow layer reads them from the whole
// snapshot, never through a part's updater — tests/flow-inert.test.ts holds
// that). tests/perf-telemetry-diff.test.ts
// scans src/three/meshes for reads of these names and fails if an updater
// starts using one — add it back to the comparison (remove it here) when
// that happens.
//
// A part whose updater animates against WALL time while a flag is set
// (the buzzer body vibrates while `sounding`) is never skipped while set.
// ---------------------------------------------------------------------------

export const VISUALLY_INERT_TELEMETRY_KEYS: ReadonlySet<string> = new Set([
  'pinVoltages',
  'current',
  'power',
  'outputs',
  'mcu',
  'pinCurrents',
])

/** Telemetry that must reach its updater every frame (wall-time animation). */
export function telemetryAnimates(t: ComponentTelemetry | null | undefined): boolean {
  return t?.sounding === true
}

/**
 * Same visual inputs: deep equality over every telemetry field except the
 * visually inert ones (also inside `sub` elements). Typed arrays compare by
 * content, numbers by value (NaN equals NaN, so a NaN reading does not force
 * a refresh every frame; +0 / −0 are equal — no updater distinguishes them).
 */
export function sameVisualTelemetry(
  a: ComponentTelemetry | null | undefined,
  b: ComponentTelemetry | null | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return sameTelemetryRecord(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>)
}

function sameTelemetryRecord(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  let na = 0
  for (const k in a) {
    if (VISUALLY_INERT_TELEMETRY_KEYS.has(k)) continue
    const va = a[k]
    if (va === undefined) continue
    na++
    const vb = b[k]
    if (k === 'sub') {
      if (!sameSub(va, vb)) return false
    } else if (!sameValue(va, vb)) return false
  }
  let nb = 0
  for (const k in b) {
    if (VISUALLY_INERT_TELEMETRY_KEYS.has(k) || b[k] === undefined) continue
    nb++
  }
  return na === nb
}

function sameSub(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  let na = 0
  for (const k in a) {
    const ea = a[k]
    const eb = b[k]
    if (ea === undefined) continue
    na++
    if (ea === eb) continue
    if (!isPlainObject(ea) || !isPlainObject(eb) || !sameTelemetryRecord(ea, eb)) return false
  }
  let nb = 0
  for (const k in b) if (b[k] !== undefined) nb++
  return na === nb
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const ta = typeof a
  if (ta !== typeof b) return false
  if (ta === 'number') return Number.isNaN(a as number) && Number.isNaN(b as number)
  if (ta !== 'object' || a === null || b === null) return false
  if (ArrayBuffer.isView(a)) {
    if (!ArrayBuffer.isView(b) || a.constructor !== b.constructor) return false
    const x = a as unknown as ArrayLike<number>
    const y = b as unknown as ArrayLike<number>
    const n = x.length
    if (n !== y.length) return false
    for (let i = 0; i < n; i++) if (x[i] !== y[i] && !(Number.isNaN(x[i]) && Number.isNaN(y[i]))) return false
    return true
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false
    return true
  }
  if (Array.isArray(b) || ArrayBuffer.isView(b)) return false
  const oa = a as Record<string, unknown>
  const ob = b as Record<string, unknown>
  let na = 0
  for (const k in oa) {
    if (oa[k] === undefined) continue
    na++
    if (!sameValue(oa[k], ob[k])) return false
  }
  let nb = 0
  for (const k in ob) if (ob[k] !== undefined) nb++
  return na === nb
}

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'bumpMap',
  'lightMap',
] as const

/**
 * Dispose the per-instance GPU resources of an object returned by
 * `buildComponentObject`. Geometries/materials/textures cached module-wide by
 * the meshes module are shared across ALL component instances and are skipped
 * (they live for the page lifetime — see meshes/shared.ts).
 */
export function disposeComponentObject(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>()
  const mats = new Set<THREE.Material>()
  root.traverse((o) => {
    const any = o as unknown as {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }
    const geo = any.geometry
    if (geo && typeof geo.dispose === 'function' && !isSharedResource(geo)) geos.add(geo)
    const mat = any.material
    if (Array.isArray(mat)) {
      for (const m of mat) {
        if (m && m.isMaterial && !isSharedResource(m)) mats.add(m)
      }
    } else if (mat && mat.isMaterial && !isSharedResource(mat)) {
      mats.add(mat)
    }
  })
  for (const geo of geos) geo.dispose()
  for (const mat of mats) {
    const anyMat = mat as unknown as Record<string, unknown>
    for (const slot of TEXTURE_SLOTS) {
      const tex = anyMat[slot] as THREE.Texture | null | undefined
      if (tex && tex.isTexture && !isSharedResource(tex)) tex.dispose()
    }
    mat.dispose()
  }
}

// ---------------------------------------------------------------------------

function dispatch(
  comp: ComponentInstance,
  entry: CatalogEntry,
  pins: THREE.Vector3[],
  routed?: RoutedComponent,
): BuildResult {
  const shape = entry.visual?.shape
  try {
    switch (shape) {
      case 'resistor':
        if (pins.length >= 2) return buildResistor(comp, entry, pins, routed)
        break
      case 'capacitor':
        if (pins.length >= 2) return buildCapacitor(comp, entry, pins, routed)
        break
      case 'inductor':
        if (pins.length >= 2) return buildInductor(comp, entry, pins, routed)
        break
      case 'pot':
      case 'potentiometer':
        if (pins.length >= 3) return buildPotentiometer(comp, entry, pins)
        break
      case 'ldr':
      case 'photoresistor':
        if (pins.length >= 2) return buildPhotoresistor(comp, entry, pins, routed)
        break
      case 'diode':
        if (pins.length >= 2) return buildDiode(comp, entry, pins, routed)
        break
      case 'led':
        if (pins.length >= 2) return buildLed(comp, entry, pins, routed)
        break
      case 'to92':
        if (pins.length >= 2) return buildTo92(comp, entry, pins, routed)
        break
      case 'button':
        if (pins.length >= 1) return buildButton(comp, entry, pins)
        break
      case 'slide':
        if (pins.length >= 2) return buildSlideSwitch(comp, entry, pins)
        break
      case 'dipswitch':
        if (pins.length >= 2) return buildDipSwitch(comp, entry, pins)
        break
      case 'dip':
        if (pins.length >= 2) return buildDip(comp, entry, pins)
        break
      case 'sevenseg':
        if (pins.length >= 2) return buildSevenSeg(comp, entry, pins)
        break
      case 'buzzer':
        if (pins.length >= 1) return buildBuzzer(comp, entry, pins)
        break
      case 'psu':
        if (pins.length >= 1) return buildInstrumentBox(comp, entry, pins, 'psu')
        break
      case 'fungen':
        if (pins.length >= 1) return buildInstrumentBox(comp, entry, pins, 'fungen')
        break
      case 'probe':
        if (pins.length >= 1) return buildProbe(comp, entry, pins)
        break
      // ---- embedded-platform parts (additive) ----
      case 'bluepill':
        if (pins.length >= 2) return buildBluePill(comp, entry, pins)
        break
      case 'logic_probe':
        if (pins.length >= 1) return buildLogicProbe(comp, entry, pins)
        break
      case 'dmm':
        if (pins.length >= 1) return buildMultimeter(comp, entry, pins)
        break
      default: {
        const build = registeredMeshBuilder(shape, pins.length)
        if (build) return build(comp, entry, pins, routed)
      }
    }
  } catch {
    // never let a bad layout crash the scene — fall back to the labeled box
  }
  return buildFallback(comp, entry, pins)
}

/** Default: a labeled box over the centroid (placeholder behavior + label). */
function buildFallback(
  _comp: ComponentInstance,
  entry: CatalogEntry,
  pins: THREE.Vector3[],
): BuildResult {
  const center = centroidOf(pins)
  const w = Math.max(1.5, pins.length)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, 1.2), plastic(0x6688aa, 0.6))
  mesh.position.set(center.x, 0.9, center.z)
  const group = new THREE.Group()
  group.add(mesh)
  const lblW = Math.min(w - 0.2, 3.2)
  const lbl = topLabel(entry.label.split(/\s+/)[0] ?? entry.type, lblW, lblW / 3.2, {
    w: 256,
    h: 80,
    fg: '#e6e6e6',
  })
  if (lbl) {
    lbl.position.set(center.x, 1.52, center.z)
    group.add(lbl)
  }
  return { object: group, pinWorld: pins.map((p) => p.clone()) }
}

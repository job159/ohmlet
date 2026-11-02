/**
 * Real application store (glue agent): implements the AppState contract from
 * src/state/types.ts with zustand, and drives the simulation through a
 * SimHost (src/sim/coordinator/api.ts).
 *
 * Layout edits are immutable. The simulated world lives OUTSIDE the store, in
 * a SimHost — a Web Worker in the browser, an inline coordinator in node — so
 * real MCU firmware can run without starving the UI thread (review §10.5).
 * Every document change (edit, undo/redo, load, clear) is sent with
 * `host.load(layout, rev)`; runtime params (knobs, buttons, switches…) and
 * instrument moves are NOT document rebuilds — runtime params go to
 * `host.setRuntimeParam` exactly as they used to go to the live engine.
 *
 * Sim timing (wall dt × simSpeed, the per-frame CPU budget, falling behind
 * instead of freezing) is now the host's job. The store consumes SimFrames:
 * telemetry is pushed to the 3D scene on EVERY frame (via the telemetry
 * sink); React state (telemetry / simTime / issues / scope) is throttled to
 * ~10 Hz while running and published immediately while paused. The 1 kHz
 * scope feed arrives with each frame and is kept trimmed to the scope window.
 *
 * Legacy session semantics are preserved with `simActive` (the old
 * `engine !== null`): a session starts with startSim, survives stopSim
 * (paused), and ends with resetSim. Outside a session, host frames never
 * reach AppState, so telemetry/issues/simTime look exactly as before.
 */
import { create } from 'zustand'
import type { AppState, InteractionMode, MoveTarget } from './types'
import type {
  CircuitLayout,
  ComponentInstance,
  EndpointRef,
  HoleRef,
  ParamValue,
  Rotation,
  ScopeSample,
  SimIssue,
  SimTelemetry,
  Wire,
} from '../model/types'
import type { BoardConfig } from '../model/types'
import {
  BOARD_SIZES,
  boardConfigOf,
  boardOf,
  isBoardCount,
  isBoardRows,
  MAX_BOARD_COUNT,
  MAX_BOARD_ROWS,
  STRIP_ROWS,
} from '../model/types'
import { getEntry } from '../model/catalog'
import type { CatalogEntry } from '../model/catalog'
import {
  boardExtents,
  componentPinHoles,
  formatHole,
  isHoleOnBoard,
  holePosition,
  OFFBOARD_APRON,
  offboardBodyPosition,
  offboardBodyRect,
  offboardGeometryOf,
  offboardHasOwnBody,
  offboardSlotSpan,
  offboardTerminalPosition,
  parseHole,
  parseTerminalRef,
  remapLayout,
  rotateOffsetDelta,
  spansSeam,
} from '../model/breadboard'
import { occludedHoles } from '../model/occlusion'
import { allowedRotationsOf, stripShorts, validateLayout } from '../model/validate'
import {
  RENDER_MODE_IDS,
  RENDER_MODE_STORAGE_KEY,
  type RenderModeId,
} from '../three/render-modes/capability'
import '../sim/chips/all' // side-effect: register every behavioral chip model
import type { SimFrame, SimHost, SimHostCallbacks } from '../sim/coordinator/api'
// The ONE import of the SimHost implementation (worker in the browser, inline
// in node); everything else in the app talks to the SimHost contract.
import { createSimHost } from '../sim/coordinator'
import { generateCircuit } from '../llm/generate'
import { LayoutHistory } from './history'
import { migrateComponentIds, type IdRenames } from './project'

/**
 * Additive store actions of the UX fix wave (helper H8), declared on the
 * AppState contract from here (module augmentation) so src/state/types.ts
 * stays as it is:
 *  - moveWireEnd(id, end, ref, opts?): re-route one end of a wire — validated
 *    exactly like addWire (wireRefusal) with the wire itself out of the way;
 *    the wire keeps its id, and its colour unless `opts.color` gives the new
 *    one (a wire still wearing its convention colour follows the convention
 *    of its new ends — SC-13 (4)); ONE undo step either way.
 *  - swapLeads(id): swap the two holes of a placed two-lead part (canSwapLeads)
 *    — 「對調兩腳」 for a reversed LED / diode; ONE undo step.
 */
declare module './types' {
  interface AppState {
    moveWireEnd(id: string, end: 'from' | 'to', ref: EndpointRef, opts?: WireEndOptions): WireEditResult
    swapLeads(id: string): { ok: boolean }
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LS_LAYOUT = 'bb.layout'
const LS_API_KEY = 'bb.apiKey'
const AUTOSAVE_DEBOUNCE_MS = 500
const REACT_PUSH_MS = 100 // ~10 Hz React state updates

const EMPTY_LAYOUT: CircuitLayout = { version: 1, components: [], wires: [] }

/**
 * clearBoard records an undo step for `layout` (and visibly changes it): the
 * board holds parts or wires, or its rig is not the default one (a board
 * size, several boards, extra rows) — the 更多 sheet's 「已清空麵包板」 +
 * 〔復原〕 says so exactly then.
 */
export function clearBoardRecordsUndo(layout: CircuitLayout): boolean {
  return (
    layout.components.length > 0 ||
    layout.wires.length > 0 ||
    layout.board !== undefined ||
    layout.boardCount !== undefined ||
    layout.boardRows !== undefined
  )
}

/** Sensible id prefixes per catalog type (fallback: 'U' for ICs, 'X' else). Exported for tests. */
export const ID_PREFIX: Readonly<Record<string, string>> = {
  resistor: 'R',
  capacitor: 'C',
  inductor: 'L',
  potentiometer: 'RV',
  photoresistor: 'LDR',
  diode: 'D',
  led: 'LED',
  npn: 'Q',
  pnp: 'Q',
  nmos: 'Q',
  // not 'PB': 「PB1」 reads as the STM32 pin PB1 (UX H8; older 'PB<n>' ids are
  // renamed on load — project.ts migrateComponentIds)
  pushbutton: 'SW',
  slide_switch: 'SW',
  dip_switch_8: 'SW',
  power_supply: 'PS',
  function_generator: 'FG',
  seven_segment: 'DISP',
  buzzer: 'BZ',
  scope_probe: 'PRB',
  // the designators the bundled examples and lessons use (UX QA IS-F1): a
  // part placed from the library gets the same name the texts say (DMM1, not X1)
  multimeter: 'DMM',
  logic_probe: 'LP',
  // power
  battery_9v: 'BAT',
  battery_aa2: 'BAT',
  lm7805: 'U',
  ams1117_33: 'U',
  crystal_hc49: 'Y',
  // displays
  ssd1306_i2c: 'OLED',
  ssd1306_spi: 'OLED',
  sh1106_i2c: 'OLED',
  lcd1602: 'LCD',
  lcd2004: 'LCD',
  lcd1602_i2c: 'LCD',
  st7735: 'TFT',
  ili9341: 'TFT',
  max7219_8x8: 'MX',
  tm1637_4digit: 'TM',
  ws2812b_strip8: 'LED',
  // motors and their drivers
  dc_motor: 'M',
  stepper_28byj48: 'M',
  nema17_stepper: 'M',
  sg90_servo: 'SV',
  uln2003_board: 'DRV',
  l298n_module: 'DRV',
  tb6612fng_module: 'DRV',
  drv8833_module: 'DRV',
  a4988_driver: 'DRV',
  drv8825_driver: 'DRV',
  tmc2209_driver: 'DRV',
  // sensors
  bme280: 'ENV',
  bmp280: 'ENV',
  dht11: 'DHT',
  dht22: 'DHT',
  ds18b20: 'TS',
  hcsr04: 'US',
  mpu6050_gy521: 'IMU',
  ky040_encoder: 'ENC',
  ir_receiver_vs1838b: 'IR',
  // modules
  usb_uart_ch340: 'CH',
  hc05_bt: 'BT',
  w25q32_flash: 'F',
  level_shifter_4ch: 'LS',
  max485_module: 'M',
}

// ---------------------------------------------------------------------------
// Pure layout helpers (exported for App.tsx ghost validity / click handling)
// ---------------------------------------------------------------------------

/** Canonical form of a hole ref, or null when it does not parse. */
export function normalizeHoleRef(ref: HoleRef): string | null {
  const h = parseHole(ref)
  return h ? formatHole(h) : null
}

/** Every hole occupied by a component lead or a wire endpoint (canonical refs). */
export function occupiedHoles(layout: CircuitLayout): Set<string> {
  const config = boardConfigOf(layout) // rig-aware: far columns exist on bigger rigs
  const used = new Set<string>()
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry) continue
    const holes = componentPinHoles(comp, entry, config)
    if (!holes) continue
    for (const h of holes) if (h) used.add(formatHole(h))
  }
  for (const w of layout.wires) {
    const f = normalizeHoleRef(w.from)
    if (f) used.add(f)
    const t = normalizeHoleRef(w.to)
    if (t) used.add(t)
  }
  return used
}

/** True when `ref` parses as a hole and no lead / wire end sits in it. */
export function holeIsFree(layout: CircuitLayout, ref: HoleRef): boolean {
  const n = normalizeHoleRef(ref)
  if (!n) return false
  return !occupiedHoles(layout).has(n)
}

/**
 * Every hole covered by some component's molded BODY beyond its own pins
 * (canonical refs). Nothing may plug into a covered hole — no component pin,
 * no wire end (the potentiometer-overhang bug). Consulted by placementValid,
 * addComponent and addWire so the store can never commit a layout the
 * validator's occlusion pass would reject.
 */
export function occludedHolesOf(layout: CircuitLayout): Set<string> {
  const config = boardConfigOf(layout)
  const out = new Set<string>()
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry) continue
    for (const ref of occludedHoles(comp, entry, config)) out.add(ref)
  }
  return out
}

/**
 * Would placing `type` succeed right now? For dip/footprint parts `at` is the
 * anchor under the cursor (with the armed `rotation`, absent = 0); for
 * leads/probe parts it is the next hole to pick (already-picked holes go in
 * `picked`). Used for the red/green ghost — green here must imply
 * addComponent succeeds, so occupancy AND body occlusion are both consulted
 * (the target holes must be clear of every body overhang, and the new part's
 * own body must not cover an occupied hole).
 */
export function placementValid(
  layout: CircuitLayout,
  type: string,
  at: HoleRef,
  picked: HoleRef[] = [],
  rotation: Rotation = 0,
): boolean {
  const entry = getEntry(type)
  if (!entry) return false
  const config = boardConfigOf(layout) // rig-aware: must agree with addComponent
  const used = occupiedHoles(layout)
  const blocked = occludedHolesOf(layout)
  if (entry.placement === 'dip' || entry.placement === 'footprint') {
    // catalog-restricted orientations (CatalogEntry.allowedRotations)
    if (!allowedRotationsOf(entry).includes(rotation)) return false
    const probe: ComponentInstance =
      rotation !== 0 ? { id: '__ghost__', type, at, rotation } : { id: '__ghost__', type, at }
    const holes = componentPinHoles(probe, entry, config)
    if (!holes) return false
    if (spansSeam(holes, config)) return false // packages cannot straddle a module seam
    // B3: two of its own pins in one strip would be shorted (validator error)
    if (stripShorts(entry, holes).some((s) => s.severe)) return false
    for (const h of holes) {
      if (!h) continue
      const key = formatHole(h)
      if (used.has(key) || blocked.has(key)) return false
    }
    // the package's own body must not cover an already-occupied hole
    for (const ref of occludedHoles(probe, entry, config)) {
      if (used.has(ref)) return false
    }
    return true
  }
  if (entry.placement === 'leads' || entry.placement === 'probe') {
    const h = parseHole(at)
    if (!h || !isHoleOnBoard(h, config)) return false
    const n = formatHole(h)
    if (used.has(n) || blocked.has(n)) return false
    for (const p of picked) if (normalizeHoleRef(p) === n) return false
    // last pin of the part: its own body rect is now known — it must not
    // overhang an occupied hole (e.g. a potentiometer body over a wire end)
    if (picked.length + 1 === entry.pins.length) {
      const holes: string[] = []
      for (const p of picked) {
        const np = normalizeHoleRef(p)
        if (!np) return false
        holes.push(np)
      }
      holes.push(n)
      const probe: ComponentInstance = { id: '__ghost__', type, holes }
      for (const ref of occludedHoles(probe, entry, config)) {
        if (used.has(ref)) return false
      }
    }
    return true
  }
  return false // offboard parts are placed without a hole
}

/**
 * The pin-1 anchor that keeps a placed footprint's pin bounding box centered
 * where it is when the package turns to `rot` (rotation about the body
 * center, rounded to the hole grid). Null when it cannot be computed or
 * falls off the strip rows. Used by rotatePlaced when turning about pin 1
 * is impossible.
 */
function recenteredAnchor(
  comp: ComponentInstance,
  entry: CatalogEntry,
  rot: Rotation,
  config: BoardConfig,
): string | null {
  const offsets = entry.footprintOffsets
  const at = comp.at ? parseHole(comp.at) : null
  const cur = componentPinHoles(comp, entry, config)
  if (!offsets || offsets.length === 0 || !at || at.kind !== 'strip' || !cur) return null
  let minC = Infinity
  let maxC = -Infinity
  let minR = Infinity
  let maxR = -Infinity
  for (const h of cur) {
    if (!h || h.kind !== 'strip') return null
    const r = STRIP_ROWS.indexOf(h.row)
    minC = Math.min(minC, h.col)
    maxC = Math.max(maxC, h.col)
    minR = Math.min(minR, r)
    maxR = Math.max(maxR, r)
  }
  const anchorRow = STRIP_ROWS.indexOf(offsets[0].row)
  let dMinC = Infinity
  let dMaxC = -Infinity
  let dMinR = Infinity
  let dMaxR = -Infinity
  for (const o of offsets) {
    const d = rotateOffsetDelta(o.dCol, STRIP_ROWS.indexOf(o.row) - anchorRow, rot)
    dMinC = Math.min(dMinC, d.dCol)
    dMaxC = Math.max(dMaxC, d.dCol)
    dMinR = Math.min(dMinR, d.dRow)
    dMaxR = Math.max(dMaxR, d.dRow)
  }
  const col = Math.round((minC + maxC) / 2 - (dMinC + dMaxC) / 2)
  const row = Math.round((minR + maxR) / 2 - (dMinR + dMaxR) / 2)
  if (row < 0 || row >= STRIP_ROWS.length || col < 1) return null
  return formatHole({ ...at, col, row: STRIP_ROWS[row] })
}

// ---------------------------------------------------------------------------
// Moving placed parts (previewMove / commitMove / moveSelection)
// ---------------------------------------------------------------------------

/**
 * One hole shifted on the board lattice: strip holes move by `dCol` columns
 * and `dRowLattice` strip-row indices ('a'..'j'; the e→f channel hop is ONE
 * step), rail holes move by `dCol` rail indices and refuse any vertical
 * component. The board-row prefix is preserved. Null = the shift is
 * meaningless (off the lattice); shifts landing OFF THE RIG still format and
 * are rejected later by validateLayout — never silently clamped.
 */
function shiftLatticeHole(ref: HoleRef, dCol: number, dRowLattice: number): HoleRef | null {
  const h = parseHole(ref)
  if (!h) return null
  if (h.kind === 'rail') {
    if (dRowLattice !== 0) return null // rails have no row lattice to move along
    const index = h.index + dCol
    if (index < 0) return null
    return formatHole({ ...h, index })
  }
  const rowIdx = STRIP_ROWS.indexOf(h.row) + dRowLattice
  if (rowIdx < 0 || rowIdx >= STRIP_ROWS.length) return null
  const col = h.col + dCol
  if (col < 1) return null
  return formatHole({ ...h, col, row: STRIP_ROWS[rowIdx] })
}

/**
 * The layout with the components in `ids` moved to `target` (see MoveTarget
 * in state/types.ts), or null when the move is structurally meaningless
 * (unknown id, anchor-form on a non-package or a group, vertical shift of a
 * package/rail hole, zero delta...). Wires STAY PUT — wire ids in the set
 * are ignored. Pure; electrical/physical validity (bounds, seams, occupancy,
 * occlusion) is the caller's validateLayout pass.
 */
function movedLayout(
  layout: CircuitLayout,
  ids: readonly string[],
  target: MoveTarget,
): CircuitLayout | null {
  const compIds = new Set<string>()
  for (const id of ids) {
    if (layout.components.some((c) => c.id === id)) compIds.add(id)
    else if (!layout.wires.some((w) => w.id === id)) return null // unknown id
    // wire ids: ignored — wires stay put (v1 move semantics)
  }
  if (compIds.size === 0) return null

  if ('anchor' in target) {
    // single dip/footprint package re-anchor (free drag re-anchor)
    if (compIds.size !== 1) return null
    const id = compIds.values().next().value as string
    const comp = layout.components.find((c) => c.id === id)
    const entry = comp ? getEntry(comp.type) : undefined
    if (!entry || (entry.placement !== 'dip' && entry.placement !== 'footprint')) return null
    const n = normalizeHoleRef(target.anchor)
    if (!n) return null
    return {
      ...layout,
      components: layout.components.map((c) => (c.id === id ? { ...c, at: n } : c)),
    }
  }

  const { dCol, dRowLattice } = target
  if (!Number.isInteger(dCol) || !Number.isInteger(dRowLattice)) return null
  if (dCol === 0 && dRowLattice === 0) return null // a no-op move is not a move
  const components: ComponentInstance[] = []
  for (const c of layout.components) {
    if (!compIds.has(c.id)) {
      components.push(c)
      continue
    }
    const entry = getEntry(c.type)
    if (!entry) return null
    switch (entry.placement) {
      case 'offboard':
        return null // instruments move via setInstrumentPos, not the hole lattice
      case 'leads':
      case 'probe': {
        if (!c.holes) return null
        const holes: string[] = []
        for (const ref of c.holes) {
          const s = shiftLatticeHole(ref, dCol, dRowLattice)
          if (!s) return null
          holes.push(s)
        }
        components.push({ ...c, holes })
        break
      }
      case 'dip':
      case 'footprint': {
        if (dRowLattice !== 0) return null // packages stay pinned to their anchor row
        if (!c.at) return null
        const s = shiftLatticeHole(c.at, dCol, 0)
        if (!s) return null
        components.push({ ...c, at: s })
        break
      }
    }
  }
  return { ...layout, components }
}

// ---------------------------------------------------------------------------
// Grid growth: instrument auto-nudge
// ---------------------------------------------------------------------------

interface PlanRect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** Strict overlap — rects that merely touch edges do NOT overlap (matches the validator). */
function rectsOverlap(a: PlanRect, b: PlanRect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
}

/**
 * Instruments keep their ABSOLUTE `pos` when the grid grows — but a grown
 * board can now overlap an explicitly-positioned instrument body, which the
 * model validator (rightly) rejects. Auto-nudge any such instrument to a
 * deterministic clear bench spot: keep its x, drop it to the bench row just
 * past the board's far edge, then walk right in 7-unit steps (one shelf
 * pitch; a unit wider than that steps by its own width + 0.5) until it
 * clears every other instrument. Every rect is the part's own footprint
 * (CatalogEntry.offboard; the legacy 6.5 × 4.5 rect when absent).
 * Default-shelf units (no `pos`) sit left of the board and are never
 * affected. Returns the SAME layout reference when nothing needed nudging.
 */
function nudgeInstrumentsClear(layout: CircuitLayout): CircuitLayout {
  const config = boardConfigOf(layout)
  const ext = boardExtents(config)
  const units: {
    compIndex: number
    slot: number
    pos?: { x: number; z: number }
    geom?: CatalogEntry['offboard']
  }[] = []
  let slot = 0 // default-shelf slot (layout order, advanced by each unit's span)
  layout.components.forEach((c, compIndex) => {
    const entry = getEntry(c.type)
    if (entry?.placement !== 'offboard') return
    units.push({ compIndex, slot, pos: c.pos, geom: entry.offboard })
    slot += offboardSlotSpan(entry.offboard)
  })
  const rects = units.map((u) => offboardBodyRect(u.slot, u.pos, u.geom))
  const moved = new Map<number, { x: number; z: number }>() // unit index → new pos
  for (let i = 0; i < units.length; i++) {
    const pos = units[i].pos
    if (!pos) continue // the default shelf (left of the board) is always clear
    const geom = units[i].geom
    const blocked = (r: PlanRect): boolean =>
      rectsOverlap(r, ext) || rects.some((o, j) => j !== i && rectsOverlap(r, o))
    if (!blocked(rects[i])) continue
    let x = pos.x
    // body rect minZ strictly past the board edge: legacy z−2 → z = maxZ + 2.5
    // exactly; a per-type rect starts d − (oz + apron) behind its anchor
    // (rounded up onto the 0.5 placement grid the validator demands)
    const g = offboardGeometryOf(geom)
    const z = offboardHasOwnBody(geom)
      ? Math.ceil((ext.maxZ + 0.5 + g.d - g.oz - OFFBOARD_APRON) * 2) / 2
      : ext.maxZ + 2.5
    const step = Math.max(7, Math.ceil((g.w + 0.5) * 2) / 2)
    let r = offboardBodyRect(units[i].slot, { x, z }, geom)
    // every other unit blocks ≤ ⌈(its width + mine) / step⌉ + 1 steps; always terminates
    let guard = 8
    for (const o of rects) guard += Math.ceil((o.maxX - o.minX + g.w) / step) + 2
    while (blocked(r) && guard-- > 0) {
      x += step
      r = offboardBodyRect(units[i].slot, { x, z }, geom)
    }
    moved.set(i, { x, z })
    rects[i] = r
  }
  if (moved.size === 0) return layout
  const components = layout.components.slice()
  units.forEach((u, i) => {
    const pos = moved.get(i)
    if (pos) components[u.compIndex] = { ...components[u.compIndex], pos }
  })
  return { ...layout, components }
}

// ---------------------------------------------------------------------------
// A new off-board unit clear of the existing off-board leads (UX QA IS-F15)
// ---------------------------------------------------------------------------

/**
 * Whether a newly added off-board unit avoids the plan-view leads of the
 * units already on the bench. The new chrome turns it on (lab-watchers sets
 * the policy); the classic chrome and every loaded file keep the default
 * shelf exactly.
 */
let avoidOffboardLeads: () => boolean = () => false

/** Install the placement policy (null = the default shelf always). */
export function setOffboardPlacementPolicy(avoidLeads: (() => boolean) | null): void {
  avoidOffboardLeads = avoidLeads ?? (() => false)
}

interface PlanPoint {
  x: number
  z: number
}

/** Does the segment a–b cross (or touch) rect `r`? (Liang–Barsky clipping.) */
function segmentHitsRect(a: PlanPoint, b: PlanPoint, r: PlanRect): boolean {
  let lo = 0
  let hi = 1
  const dx = b.x - a.x
  const dz = b.z - a.z
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0
    const u = q / p
    if (p < 0) {
      if (u > hi) return false
      if (u > lo) lo = u
    } else {
      if (u < lo) return false
      if (u < hi) hi = u
    }
    return true
  }
  return clip(-dx, a.x - r.minX) && clip(dx, r.maxX - a.x) && clip(-dz, a.z - r.minZ) && clip(dz, r.maxZ - a.z) && lo <= hi
}

/**
 * Where a NEW off-board unit of `entry` should go (null = its default-shelf
 * slot is clear): when the plan-view segment of an existing off-board lead
 * (a terminal → its board hole, or terminal → terminal) crosses the slot's
 * body rect, the first spot on the bench row past the board's far edge,
 * walking right in 7-unit steps — the walk nudgeInstrumentsClear uses — that
 * no lead crosses, overlapping neither the board nor another unit and
 * covering no other unit's terminal posts. Pure.
 */
export function clearOffboardSpot(layout: CircuitLayout, entry: CatalogEntry): PlanPoint | null {
  const geom = entry.offboard
  const units: { id: string; slot: number; pos?: PlanPoint; geom?: CatalogEntry['offboard']; pins: readonly string[] }[] = []
  let slot = 0
  for (const c of layout.components) {
    const e = getEntry(c.type)
    if (e?.placement !== 'offboard') continue
    units.push({ id: c.id, slot, pos: c.pos, geom: e.offboard, pins: e.pins })
    slot += offboardSlotSpan(e.offboard)
  }
  const mySlot = slot
  const terminalAt = (ref: string): PlanPoint | null => {
    const t = parseTerminalRef(ref)
    const u = t ? units.find((x) => x.id === t.componentId) : undefined
    const i = u && t ? u.pins.indexOf(t.pin) : -1
    return u && i >= 0 ? offboardTerminalPosition(u.slot, i, u.pos, u.geom) : null
  }
  const leads: [PlanPoint, PlanPoint][] = []
  for (const w of layout.wires) {
    const a = terminalAt(w.from)
    const b = terminalAt(w.to)
    if (!a && !b) continue
    const ha = a ? null : parseHole(w.from)
    const hb = b ? null : parseHole(w.to)
    const pa = a ?? (ha ? holePosition(ha) : null)
    const pb = b ?? (hb ? holePosition(hb) : null)
    if (pa && pb) leads.push([pa, pb])
  }
  const crossed = (r: PlanRect) => leads.some(([a, b]) => segmentHitsRect(a, b, r))
  if (!crossed(offboardBodyRect(mySlot, undefined, geom))) return null

  const config = boardConfigOf(layout)
  const ext = boardExtents(config)
  const rects = units.map((u) => offboardBodyRect(u.slot, u.pos, u.geom))
  const posts: PlanPoint[] = units.flatMap((u) => u.pins.map((_, i) => offboardTerminalPosition(u.slot, i, u.pos, u.geom)))
  const inside = (p: PlanPoint, r: PlanRect) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ
  const blocked = (r: PlanRect) => rectsOverlap(r, ext) || rects.some((o) => rectsOverlap(r, o)) || crossed(r) || posts.some((p) => inside(p, r))
  const g = offboardGeometryOf(geom)
  const z = offboardHasOwnBody(geom) ? Math.ceil((ext.maxZ + 0.5 + g.d - g.oz - OFFBOARD_APRON) * 2) / 2 : ext.maxZ + 2.5
  const step = Math.max(7, Math.ceil((g.w + 0.5) * 2) / 2)
  let x = offboardBodyPosition(mySlot, undefined, geom).x
  let guard = 8
  for (const o of rects) guard += Math.ceil((o.maxX - o.minX + g.w) / step) + 2
  guard += Math.ceil((ext.maxX - ext.minX + g.w) / step) + 2
  let r = offboardBodyRect(mySlot, { x, z }, geom)
  while (blocked(r) && guard-- > 0) {
    x += step
    r = offboardBodyRect(mySlot, { x, z }, geom)
  }
  return blocked(r) ? null : { x, z }
}

/**
 * Shrink protection shared by setBoardSize / setBoardCount: how many parts
 * (components or wires) would be stranded on the `target` rig — any lead or
 * wire endpoint off the target bounds, or a dip/footprint package that would
 * straddle one of the target's module seams (seams move when the module SIZE
 * changes). Pin holes resolve against the CURRENT rig so far-column parts are
 * seen at all.
 */
function strandedParts(layout: CircuitLayout, target: BoardConfig): number {
  const current = boardConfigOf(layout)
  let offenders = 0
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry || entry.placement === 'offboard') continue
    const holes = componentPinHoles(comp, entry, current)
    const fits =
      holes !== null &&
      holes.every((h) => h === null || isHoleOnBoard(h, target)) &&
      !((entry.placement === 'dip' || entry.placement === 'footprint') && spansSeam(holes, target))
    if (!fits) offenders++
  }
  for (const w of layout.wires) {
    const fits = [w.from, w.to].every((end) => {
      const h = parseHole(end)
      return !h || isHoleOnBoard(h, target)
    })
    if (!fits) offenders++
  }
  return offenders
}

/** "the Half board" / "the Standard ×3 rig" — for shrink-refusal messages. */
function rigName(config: BoardConfig): string {
  const label = BOARD_SIZES[config.size].label
  return config.count > 1 ? `${label} ×${config.count} rig` : `${label} board`
}

/**
 * The lowest free `${prefix}${n}`. Case-insensitive (UX H8): examples and
 * lessons name their wires 'w1'…, so a new wire next to them is 'W8', never
 * a second 「導線 W1」 beside 「導線 w1」.
 */
function nextFreeId(layout: CircuitLayout, prefix: string): string {
  const taken = new Set<string>()
  for (const c of layout.components) taken.add(c.id.toLowerCase())
  for (const w of layout.wires) taken.add(w.id.toLowerCase())
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`
    if (!taken.has(id.toLowerCase())) return id
  }
}

function idPrefixFor(type: string): string {
  const p = ID_PREFIX[type]
  if (p) return p
  const entry = getEntry(type)
  // MCU boards carry an IC designator too (U1 = the Blue Pill), as on schematics
  return entry?.category === 'ic' || entry?.category === 'mcu' ? 'U' : 'X'
}

/**
 * Endpoint is a hole that exists on the ACTIVE rig, or a terminal of an
 * existing off-board component. parseHole alone is only syntax (it accepts
 * the maxima across rigs) — without the isHoleOnBoard bounds check, a stale
 * wire-mode `from` surviving a board shrink could commit an off-rig wire,
 * which the autosave persists and validateLayout then rejects on next boot
 * (silently wiping the circuit back to empty).
 */
function endpointValid(layout: CircuitLayout, ref: EndpointRef): boolean {
  const h = parseHole(ref)
  if (h) return isHoleOnBoard(h, boardConfigOf(layout))
  const t = parseTerminalRef(ref)
  if (!t) return false
  const comp = layout.components.find((c) => c.id === t.componentId)
  if (!comp) return false
  const entry = getEntry(comp.type)
  return !!entry && entry.placement === 'offboard' && entry.pins.includes(t.pin)
}

function canonicalEndpoint(ref: EndpointRef): string {
  return normalizeHoleRef(ref) ?? ref
}

// ---------------------------------------------------------------------------
// Wire validation with a reason (UX helper H8)
// ---------------------------------------------------------------------------

/**
 * Why a wire between two endpoints would be refused (addWire / moveWireEnd
 * use exactly these checks, in this order). `ref` is the canonical endpoint
 * the problem is at. Text: src/ui/workspace/hole-chip.ts wireRefusalText.
 */
export type WireRefusal =
  | { kind: 'no-wire'; wireId: string } // moveWireEnd: the wire is gone
  | { kind: 'invalid-endpoint'; ref: string } // off the active rig / not a terminal of a placed off-board part
  | { kind: 'same-endpoint'; ref: string } // both ends on one point
  | { kind: 'duplicate'; ref: string; wireId: string } // a wire already joins the two points
  | { kind: 'occupied'; ref: string } // a lead or another wire end sits in the hole
  | { kind: 'covered'; ref: string; by?: string } // under a part's molded body (by = its id)

/** The component whose body covers hole `ref` (canonical), if any. */
function coveringPart(layout: CircuitLayout, ref: string): string | undefined {
  const config = boardConfigOf(layout)
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (entry && occludedHoles(comp, entry, config).has(ref)) return comp.id
  }
  return undefined
}

/**
 * Would `addWire(from, to)` be refused on `layout` — and why? null = the
 * wire is valid. Pure; the same checks addWire makes (endpoint on this rig /
 * an existing terminal, not one point twice, no duplicate in either
 * direction, hole ends free and not under a part body).
 */
export function wireRefusal(layout: CircuitLayout, from: EndpointRef, to: EndpointRef): WireRefusal | null {
  if (!endpointValid(layout, from)) return { kind: 'invalid-endpoint', ref: canonicalEndpoint(from) }
  if (!endpointValid(layout, to)) return { kind: 'invalid-endpoint', ref: canonicalEndpoint(to) }
  const cFrom = canonicalEndpoint(from)
  const cTo = canonicalEndpoint(to)
  if (cFrom === cTo) return { kind: 'same-endpoint', ref: cTo }
  for (const w of layout.wires) {
    const wf = canonicalEndpoint(w.from)
    const wt = canonicalEndpoint(w.to)
    if ((wf === cFrom && wt === cTo) || (wf === cTo && wt === cFrom)) return { kind: 'duplicate', ref: cTo, wireId: w.id }
  }
  // hole endpoints must be unoccupied (one lead per hole) AND not sit
  // under a component body's overhang (occlusion — validator parity)
  const used = occupiedHoles(layout)
  const blocked = occludedHolesOf(layout)
  for (const end of [cFrom, cTo]) {
    if (!parseHole(end)) continue
    if (used.has(end)) return { kind: 'occupied', ref: end }
    if (blocked.has(end)) {
      const by = coveringPart(layout, end)
      return by ? { kind: 'covered', ref: end, by } : { kind: 'covered', ref: end }
    }
  }
  return null
}

/** Result of moveWireEnd: `changed` false = the end was already there (no undo step). */
export type WireEditResult = { ok: true; changed: boolean } | { ok: false; refusal: WireRefusal }

/**
 * Options of moveWireEnd. `color`: the wire's colour after the re-route,
 * applied in the SAME undo step (blank / absent = keep the colour). Ignored
 * when the end does not move (no step is made for a colour alone).
 */
export interface WireEndOptions {
  color?: string
}

/**
 * Can `swapLeads(id)` act on this part? A placed two-lead part (placement
 * 'leads' with both holes on the board). Polarity is the caller's question
 * (LED, diode, electrolytic capacitor …) — swapping a resistor is legal.
 */
export function canSwapLeads(layout: CircuitLayout, id: string): boolean {
  const comp = layout.components.find((c) => c.id === id)
  const entry = comp ? getEntry(comp.type) : undefined
  return !!comp && entry?.placement === 'leads' && entry.pins.length === 2 && comp.holes?.length === 2
}

/**
 * The store's load-time normalisation of a document read from outside the
 * running app (autosave, loadLayout): pushbutton ids 'PB<n>' → 'SW<n>'
 * (project.ts migrateComponentIds). The renames of the last load stay
 * readable (lastLoadRenames) for callers that hold ids of their own.
 */
let lastRenames: IdRenames = {}
function normalizedOnLoad(layout: CircuitLayout): CircuitLayout {
  const m = migrateComponentIds(layout)
  lastRenames = m.renames
  return m.layout
}

/** Old id → new id applied by the last loadLayout / boot restore ({} = none). */
export function lastLoadRenames(): IdRenames {
  return lastRenames
}

/**
 * How many documents loadLayout has loaded (an example, a lesson circuit, a
 * JSON / project import, an AI circuit). Bumped right before the loaded
 * layout commits, so a layout subscriber can tell a wholesale load from an
 * edit or an undo / redo (state/lab.ts: firmware bindings across 〔復原〕).
 */
let layoutLoads = 0
export function layoutLoadCount(): number {
  return layoutLoads
}

/**
 * Wire mode survives document swaps (undo/redo, board resize), but a pending
 * first endpoint must still exist on the new document — a rig shrink or an
 * undone board-grow can strand `mode.from` off the board, leaving a floating
 * wire preview and a dead wire mode (every second click would be refused by
 * endpointValid). Drop just the endpoint; the armed mode + color survive.
 */
function reconcileWireMode(mode: InteractionMode, layout: CircuitLayout): InteractionMode {
  if (mode.kind !== 'wire' || !mode.from || endpointValid(layout, mode.from)) return mode
  return { kind: 'wire', from: null, color: mode.color }
}

/**
 * Transient runtime-only params that must never persist: the pushbutton's
 * momentary 'pressed' (HOLD) lives in the in-memory document so the UI can
 * render it, but a history snapshot / autosave / export carrying
 * pressed:true would resurrect a stuck-held button (undo restores it and the
 * engine rebuild reads it; a reload boots with the button held).
 */
const TRANSIENT_PARAM_KEYS = ['pressed'] as const

/**
 * `layout` with transient params stripped from every component. Returns the
 * SAME reference when there is nothing to strip, preserving the store's
 * layout reference-identity semantics (history entries are plain references).
 */
export function stripTransientParams(layout: CircuitLayout): CircuitLayout {
  let changed = false
  const components = layout.components.map((c) => {
    const params = c.params
    if (!params || !TRANSIENT_PARAM_KEYS.some((k) => k in params)) return c
    changed = true
    const rest: Record<string, ParamValue> = { ...params }
    for (const k of TRANSIENT_PARAM_KEYS) delete rest[k]
    if (Object.keys(rest).length === 0) {
      const { params: _omit, ...bare } = c
      return bare
    }
    return { ...c, params: rest }
  })
  return changed ? { ...layout, components } : layout
}

// ---------------------------------------------------------------------------
// localStorage boot / autosave
// ---------------------------------------------------------------------------

function loadSavedApiKey(): string {
  try {
    return window.localStorage.getItem(LS_API_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Persisted render-mode pref; null when unset/unknown (device auto-default). */
function loadSavedRenderMode(): RenderModeId | null {
  try {
    const raw = window.localStorage.getItem(RENDER_MODE_STORAGE_KEY)
    return raw !== null && (RENDER_MODE_IDS as readonly string[]).includes(raw)
      ? (raw as RenderModeId)
      : null
  } catch {
    return null
  }
}

function loadSavedLayout(): CircuitLayout {
  try {
    const raw = window.localStorage.getItem(LS_LAYOUT)
    if (!raw) return EMPTY_LAYOUT
    const parsed: unknown = JSON.parse(raw)
    const res = validateLayout(parsed)
    if (res.ok && res.layout) return normalizedOnLoad(res.layout)
  } catch {
    /* corrupted save / no storage: start empty */
  }
  return EMPTY_LAYOUT
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleAutosave(layout: CircuitLayout): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    try {
      // never persist a mid-hold 'pressed' — a reload must not boot held
      window.localStorage.setItem(LS_LAYOUT, JSON.stringify(stripTransientParams(layout)))
    } catch {
      /* storage full / unavailable */
    }
  }, AUTOSAVE_DEBOUNCE_MS)
}

// ---------------------------------------------------------------------------
// Undo/redo history (module level — layouts are immutable references; the
// stacks never persist, so every boot starts with empty history)
// ---------------------------------------------------------------------------

const history = new LayoutHistory()

/** TEST-ONLY: empty the undo/redo stacks and resync the store flags. */
export function __resetHistoryForTests(): void {
  history.clear()
  useStore.setState({ canUndo: false, canRedo: false })
}

// ---------------------------------------------------------------------------
// SimHost runtime (module level — never inside React state)
// ---------------------------------------------------------------------------

/** Builds the simulation host; swapped by tests for fake / instrumented hosts. */
export type SimHostFactory = (callbacks: SimHostCallbacks) => SimHost

let hostFactory: SimHostFactory = createSimHost
let host: SimHost | null = null

/**
 * Revision passed with the latest `host.load` — every load gets a fresh
 * number, so frames computed from a superseded document are recognisable
 * (SimFrame.rev).
 */
let rev = 0
/**
 * First revision of the current power-on epoch (host boot or resetSim).
 * Frames older than this were computed BEFORE the reset and are dropped
 * entirely. Frames of an older revision of the SAME epoch still carry real
 * events (scope samples, UART bytes, log lines), but their snapshot
 * (telemetry, issues) describes a superseded document and is ignored.
 */
let epochRev = 0

/**
 * A simulation session exists — the legacy `engine !== null`: set by
 * startSim, kept by stopSim (paused), cleared by resetSim / a host failure.
 * Outside a session host frames never touch AppState.
 */
let simActive = false
/** startSim is awaiting its first running frame: a host error now is a failed start */
let startPending = false
/** the host paused itself on an MCU debugger halt while the user had it running */
let debugHalted = false

let lastReactPushMs = Number.NEGATIVE_INFINITY

/** Snapshot of the newest current-revision frame of this session. */
let lastTelemetry: SimTelemetry | null = null
let lastIssues: SimIssue[] = []
let lastSimTime = 0

/** Scope ring buffer (mutated in place; a fresh wrapper object is pushed to state). */
let scopeBuf: ScopeSample[] = []

/**
 * A layout committed WITHOUT a world rebuild (runtime param, instrument
 * move): the layout subscription skips host.load for exactly this reference.
 */
let skipLoadFor: CircuitLayout | null = null

/** Wall clock (ms) for the React throttle — injectable for tests. */
const defaultNowMs = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()
let nowMs: () => number = defaultNowMs

/**
 * Per-frame telemetry consumer (the 3D scene). Registered by App.tsx so live
 * telemetry reaches the scene at full frame rate, bypassing React.
 */
let telemetrySink: ((t: SimTelemetry | null) => void) | null = null
export function setTelemetrySink(sink: ((t: SimTelemetry | null) => void) | null): void {
  telemetrySink = sink
  sink?.(useStore.getState().telemetry)
}

/**
 * Fired after a wholesale layout load succeeds (example, JSON import, AI
 * apply). Registered by App.tsx to re-frame the 3D camera onto the loaded
 * circuit — loaded circuits can sit anywhere on the board, outside the fixed
 * home framing of a phone viewport. Module-level like the telemetry sink:
 * scene concerns never live in React/store state.
 */
let layoutLoadedSink: (() => void) | null = null
export function setLayoutLoadedSink(sink: (() => void) | null): void {
  layoutLoadedSink = sink
}

/**
 * Abort controller for the in-flight LLM generation (module level, like the
 * engine — never inside React state). Non-null exactly while a generation is
 * running. Cancellation is exposed as the `cancelGeneration` store action.
 */
let generateAbort: AbortController | null = null

/**
 * Host lifecycle, for the embedded-lab store (src/state/lab.ts), which owns
 * firmware bindings, terminals and MCU panels but not the host itself:
 *  - 'loaded' after EVERY host.load; `boot` = the host was just created, so
 *    it holds no firmware and no logic-analyzer configuration yet,
 *  - 'frame' for every frame of the current power-on epoch; `current` = it
 *    was computed from the latest document revision,
 *  - 'reset' after resetSim (time → 0, recorders cleared),
 *  - 'disposed' when the host died (onError / a throwing call) or was replaced.
 */
export type SimHostEvent =
  | { kind: 'loaded'; host: SimHost; layout: CircuitLayout; rev: number; boot: boolean }
  | { kind: 'frame'; frame: SimFrame; current: boolean }
  | { kind: 'reset' }
  | { kind: 'disposed' }

const hostListeners = new Set<(e: SimHostEvent) => void>()

/** Subscribe to host lifecycle events; returns the unsubscribe function. */
export function onSimHostEvent(listener: (e: SimHostEvent) => void): () => void {
  hostListeners.add(listener)
  return () => {
    hostListeners.delete(listener)
  }
}

function emitHostEvent(e: SimHostEvent): void {
  for (const listener of [...hostListeners]) {
    try {
      listener(e)
    } catch (err) {
      // a broken panel must not stall the simulation feed — but never silently
      console.error('sim host listener failed', err)
    }
  }
}

/** The live host, if one exists (never creates one). */
export function peekSimHost(): SimHost | null {
  return host
}

/**
 * The live host, created (and loaded with the current document) on first
 * use. Null when construction failed — the failure is posted as an issue.
 */
export function getSimHost(): SimHost | null {
  return ensureHost()
}

function ensureHost(): SimHost | null {
  if (host) return host
  let created: SimHost | null = null
  let constructionError: string | null = null
  const callbacks: SimHostCallbacks = {
    // callbacks of a replaced/disposed host are ignored
    onFrame: (f) => {
      if (created !== null && host === created) onHostFrame(f)
    },
    onError: (message) => {
      if (created === null) constructionError ??= message // reported while being built
      else if (host === created) onHostError(message)
    },
  }
  try {
    created = hostFactory(callbacks)
  } catch (err) {
    failSession(`simulation failed to start: ${String(err)}`)
    return null
  }
  if (constructionError !== null) {
    try {
      created.dispose()
    } catch {
      /* never became usable */
    }
    failSession(`simulation failed to start: ${constructionError}`)
    return null
  }
  host = created
  loadHost(useStore.getState().layout, { boot: true })
  return host
}

/** Run a host call; a synchronous throw is a host failure (inline host). */
function callHost(run: () => void): boolean {
  try {
    run()
    return true
  } catch (err) {
    onHostError(String(err))
    return false
  }
}

/** Send `layout` to the host under a fresh revision, then tell the lab. */
function loadHost(layout: CircuitLayout, opts: { boot?: boolean; newEpoch?: boolean } = {}): void {
  const h = host
  if (!h) return
  rev++
  if (opts.boot || opts.newEpoch) epochRev = rev
  const r = rev
  if (!callHost(() => h.load(layout, r))) return
  emitHostEvent({ kind: 'loaded', host: h, layout, rev: r, boot: opts.boot === true })
}

/**
 * Fatal host failure: drop the host (the next start builds a fresh one) and
 * roll back an optimistic start — the legacy engine-construction failure
 * path (engine = null, running = false, one error issue).
 */
function onHostError(message: string): void {
  const h = host
  host = null
  if (h) {
    try {
      h.dispose()
    } catch {
      /* already dead */
    }
  }
  const prefix =
    useStore.getState().running && !startPending ? 'simulation stopped' : 'simulation failed to start'
  failSession(`${prefix}: ${message}`)
  if (h) emitHostEvent({ kind: 'disposed' })
}

function failSession(message: string): void {
  startPending = false
  debugHalted = false
  simActive = false
  useStore.setState({ running: false, issues: [{ level: 'error', message }] })
}

function trimScope(now: number, timeWindow: number): void {
  const cutoff = now - timeWindow
  let drop = 0
  while (drop < scopeBuf.length && scopeBuf[drop].t < cutoff) drop++
  if (drop > 0) scopeBuf.splice(0, drop)
}

function onHostFrame(f: SimFrame): void {
  if (f.rev < epochRev) return // computed before the last reset/boot
  const current = f.rev === rev
  if (current && f.running) startPending = false
  emitHostEvent({ kind: 'frame', frame: f, current })
  if (!simActive) return // no session: AppState stays as legacy had it (no engine)

  // scope samples are real recordings of this epoch even from an older revision
  for (const sample of f.scope) scopeBuf.push(sample)
  if (!current) return // snapshot of a superseded document

  if (
    !f.running &&
    useStore.getState().running &&
    !startPending &&
    f.mcus.some((m) => m.state === 'halted')
  ) {
    // An MCU debugger halt / breakpoint freezes the WHOLE world (both hosts
    // stop their loop on it): the session stays, paused, and resuming that
    // MCU resumes it (resumeAfterDebugHalt). The 'halted' check keeps a stale
    // paused frame of an earlier stop from being mistaken for one.
    debugHalted = true
    useStore.setState({ running: false })
  }
  const s = useStore.getState()

  lastTelemetry = f.telemetry
  lastIssues = f.issues
  lastSimTime = f.time
  trimScope(f.time, s.scope.timeWindow)

  // telemetry → 3D scene every frame
  telemetrySink?.(f.telemetry)

  // React state at ~10 Hz while running; paused frames (stepTime, the final
  // frame after pause, a reload) are published at once like legacy publishNow
  const now = nowMs()
  if (s.running && now - lastReactPushMs < REACT_PUSH_MS) return
  lastReactPushMs = now
  useStore.setState({
    telemetry: f.telemetry,
    simTime: f.time,
    issues: f.issues.slice(),
    scope: { samples: scopeBuf, timeWindow: s.scope.timeWindow },
  })
}

/** Push the session's latest outputs to both React state and the scene. */
function publishNow(): void {
  const tele = simActive ? lastTelemetry : null
  useStore.setState({
    telemetry: tele,
    simTime: simActive ? lastSimTime : 0,
    issues: simActive ? lastIssues.slice() : [],
    scope: { samples: scopeBuf, timeWindow: useStore.getState().scope.timeWindow },
  })
  telemetrySink?.(tele)
}

/** Begin a fresh session (legacy: the engine was built from scratch at t = 0). */
function beginSession(): void {
  scopeBuf = []
  lastTelemetry = null
  lastIssues = []
  lastSimTime = 0
  simActive = true
}

/**
 * Restart the world after the MCU debugger released the halt that froze it
 * (no-op unless the host paused itself on that halt while running).
 */
export function resumeAfterDebugHalt(): void {
  if (!debugHalted) return
  debugHalted = false
  if (simActive && !useStore.getState().running) useStore.getState().startSim()
}

/**
 * While paused: advance exactly `seconds` of sim time, then the host
 * publishes a frame (single-stepping UI, deterministic tests). Starts a
 * session when none exists, like startSim. No-op while running.
 */
export function stepSimTime(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return
  if (useStore.getState().running) return
  const h = ensureHost()
  if (!h) return
  if (!simActive) beginSession()
  callHost(() => h.stepTime(seconds))
}

/**
 * TEST-ONLY: replace the host factory (null = the real createSimHost). The
 * current host, if any, is disposed and the session ends.
 */
export function __setSimHostFactoryForTests(factory: SimHostFactory | null): void {
  const h = host
  host = null
  if (h) {
    try {
      h.dispose()
    } catch {
      /* ignore */
    }
    emitHostEvent({ kind: 'disposed' })
  }
  hostFactory = factory ?? createSimHost
  simActive = false
  startPending = false
  debugHalted = false
}

/** TEST-ONLY: wall clock used by the 10 Hz React throttle (null = real clock). */
export function __setSimClockForTests(clock: (() => number) | null): void {
  nowMs = clock ?? defaultNowMs
  lastReactPushMs = Number.NEGATIVE_INFINITY
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStore = create<AppState>()((set, get) => {
  /**
   * Commit an immutable layout update (+ autosave). The layout subscription
   * below sends every new document to the host (the legacy live-engine
   * rebuild); `rebuild = false` (runtime params, instrument moves) skips that.
   */
  const commitLayout = (layout: CircuitLayout, rebuild = true): void => {
    skipLoadFor = rebuild ? null : layout
    set({ layout })
    scheduleAutosave(layout)
  }

  /**
   * Record the PRE-mutation layout right before a mutation commits.
   * Snapshots are stripped of transient params: a push taken while a
   * pushbutton is held must not let undo restore a stuck-pressed document.
   */
  const pushHistory = (tag?: string): void => {
    history.push(stripTransientParams(get().layout), tag)
    set({ canUndo: history.canUndo, canRedo: history.canRedo })
  }

  /**
   * Land an undo/redo snapshot: swap the document, sync the can* flags, drop
   * selected ids that no longer exist, autosave, and (via the layout
   * subscription) reload the host world — the host keeps the running clock
   * and reposts issues with its next frame.
   */
  const restoreSnapshot = (layout: CircuitLayout): void => {
    const sel = get().selection
    const alive = sel.filter(
      (id) => layout.components.some((c) => c.id === id) || layout.wires.some((w) => w.id === id),
    )
    set({
      layout,
      selection: alive.length === sel.length ? sel : alive, // keep identity when unchanged
      mode: reconcileWireMode(get().mode, layout), // drop a `from` stranded off the restored rig
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    })
    scheduleAutosave(layout)
  }

  return {
    // --- document -----------------------------------------------------------
    layout: loadSavedLayout(),
    selection: [],
    mode: { kind: 'select' } as InteractionMode,
    hoverHole: null,
    canUndo: false,
    canRedo: false,

    // --- preferences ----------------------------------------------------------
    renderMode: loadSavedRenderMode(),

    // --- simulation ---------------------------------------------------------
    running: false,
    simSpeed: 1,
    simTime: 0,
    telemetry: null,
    issues: [],
    scope: { samples: [], timeWindow: 5 },

    // --- llm ----------------------------------------------------------------
    llm: {
      apiKey: loadSavedApiKey(),
      busy: false,
      status: '',
      explanation: null,
      pending: null,
      error: null,
    },

    // --- actions: document --------------------------------------------------

    addComponent(type, opts) {
      const entry = getEntry(type)
      if (!entry) return
      const layout = get().layout
      const comp: ComponentInstance = { id: nextFreeId(layout, idPrefixFor(type)), type }
      // a new scope probe takes the lowest channel no probe uses yet (UX
      // IS-4): a second probe never silently lands on CH1 next to the first.
      // CH1 stays implicit (the catalog default), so a first probe is
      // serialized exactly as before.
      if (type === 'scope_probe') {
        const used = new Set(
          layout.components.filter((c) => c.type === 'scope_probe').map((c) => Number(c.params?.channel ?? 1)),
        )
        const free = [1, 2, 3, 4].find((ch) => !used.has(ch))
        if (free !== undefined && free !== 1) comp.params = { channel: free }
      }

      switch (entry.placement) {
        case 'leads':
        case 'probe': {
          if (!opts.holes || opts.holes.length !== entry.pins.length) return
          const normalized: string[] = []
          for (const ref of opts.holes) {
            const n = normalizeHoleRef(ref)
            if (!n) return
            normalized.push(n)
          }
          comp.holes = normalized
          break
        }
        case 'dip':
        case 'footprint': {
          if (!opts.at) return
          const n = normalizeHoleRef(opts.at)
          if (!n) return
          comp.at = n
          // armed in-plane rotation (canonical: 0 stays absent). A rotation a
          // package cannot take (90/270 on a DIP) makes componentPinHoles
          // return null below — the add is refused, never silently coerced.
          const rot = opts.rotation ?? 0
          if (!allowedRotationsOf(entry).includes(rot)) return // catalog-restricted orientation (validator agrees)
          if (rot !== 0) comp.rotation = rot
          break
        }
        case 'offboard': {
          // the new chrome: never on a slot an existing lead crosses (UX QA IS-F15);
          // classic and loaded files keep the default shelf
          if (avoidOffboardLeads()) {
            const spot = clearOffboardSpot(layout, entry)
            if (spot) comp.pos = spot
          }
          break
        }
      }

      // placement validation: pin holes resolvable on THIS rig + occupancy
      // + body occlusion (must agree with placementValid — the green ghost)
      const config = boardConfigOf(layout)
      const pinHoles = componentPinHoles(comp, entry, config)
      if (!pinHoles) return // bad anchor / off the board — silently refuse
      if (
        (entry.placement === 'dip' || entry.placement === 'footprint') &&
        spansSeam(pinHoles, config)
      ) {
        return // a rigid package cannot straddle the gap between board modules
      }
      if (
        (entry.placement === 'dip' || entry.placement === 'footprint') &&
        stripShorts(entry, pinHoles).some((s) => s.severe)
      ) {
        return // B3: two of its own pins in one strip (validator error) — must agree with placementValid
      }
      const used = occupiedHoles(layout)
      const blocked = occludedHolesOf(layout)
      const mine = new Set<string>()
      for (const h of pinHoles) {
        if (!h) continue
        const key = formatHole(h)
        if (used.has(key) || blocked.has(key) || mine.has(key)) return // taken / under a body
        mine.add(key)
      }
      // the new part's own body must not cover an already-occupied hole
      for (const ref of occludedHoles(comp, entry, config)) {
        if (used.has(ref)) return
      }

      pushHistory(`add:${type}`)
      commitLayout({ ...layout, components: [...layout.components, comp] })
    },

    removeSelected() {
      // EVERY selected component and wire goes in ONE undo step (multi-select
      // group delete; a single selection behaves exactly like before)
      const { selection, layout } = get()
      if (selection.length === 0) return
      const ids = new Set(selection)
      const goneComps = new Set(
        layout.components.filter((c) => ids.has(c.id)).map((c) => c.id),
      )
      const components = layout.components.filter((c) => !goneComps.has(c.id))
      const wires = layout.wires.filter((w) => {
        if (ids.has(w.id)) return false
        // wires to a removed instrument's off-board terminals go with it
        const f = parseTerminalRef(w.from)
        if (f && goneComps.has(f.componentId)) return false
        const t = parseTerminalRef(w.to)
        return !(t && goneComps.has(t.componentId))
      })
      if (
        components.length === layout.components.length &&
        wires.length === layout.wires.length
      ) {
        set({ selection: [] }) // stale ids only — nothing to record
        return
      }
      set({ selection: [] })
      pushHistory(`remove:${selection.join('+')}`)
      commitLayout({ ...layout, components, wires })
    },

    removeComponent(id) {
      const layout = get().layout
      if (!layout.components.some((c) => c.id === id)) return
      const components = layout.components.filter((c) => c.id !== id)
      // wires to this component's off-board terminals go with it
      const wires = layout.wires.filter((w) => {
        const f = parseTerminalRef(w.from)
        const t = parseTerminalRef(w.to)
        return f?.componentId !== id && t?.componentId !== id
      })
      const sel = get().selection
      if (sel.includes(id)) set({ selection: sel.filter((s) => s !== id) })
      pushHistory(`remove:${id}`)
      commitLayout({ ...layout, components, wires })
    },

    removeWire(id) {
      const layout = get().layout
      if (!layout.wires.some((w) => w.id === id)) return
      const sel = get().selection
      if (sel.includes(id)) set({ selection: sel.filter((s) => s !== id) })
      pushHistory(`remove:${id}`)
      commitLayout({ ...layout, wires: layout.wires.filter((w) => w.id !== id) })
    },

    addWire(from, to, color) {
      const layout = get().layout
      // invalid endpoint, self-wire, duplicate (either direction), an
      // occupied or body-covered hole: refused (wireRefusal says why)
      if (wireRefusal(layout, from, to)) return
      const wire: Wire = {
        id: nextFreeId(layout, 'W'),
        from: canonicalEndpoint(from),
        to: canonicalEndpoint(to),
        color: color ?? 'red',
      }
      pushHistory('wire')
      commitLayout({ ...layout, wires: [...layout.wires, wire] })
    },

    moveWireEnd(id, end, ref, opts) {
      const layout = get().layout
      const wire = layout.wires.find((w) => w.id === id)
      if (!wire) return { ok: false, refusal: { kind: 'no-wire', wireId: id } }
      const target = canonicalEndpoint(ref)
      if (canonicalEndpoint(wire[end]) === target) return { ok: true, changed: false }
      // validated exactly like a new wire, with this wire itself out of the way
      // (its old end hole is free for the moved end; the other end stays)
      const rest: CircuitLayout = { ...layout, wires: layout.wires.filter((w) => w.id !== id) }
      const other = wire[end === 'from' ? 'to' : 'from']
      const refusal = end === 'from' ? wireRefusal(rest, ref, other) : wireRefusal(rest, other, ref)
      if (refusal) return { ok: false, refusal }
      const moved: Wire = { ...wire, [end]: target }
      // the convention colour of the new ends (SC-13 (4)) rides in the same step
      const color = typeof opts?.color === 'string' ? opts.color.trim() : ''
      if (color) moved.color = color
      pushHistory(`wire-end:${id}`) // one undo step per re-route (never coalesced)
      commitLayout({ ...layout, wires: layout.wires.map((w) => (w.id === id ? moved : w)) })
      return { ok: true, changed: true }
    },

    swapLeads(id) {
      const layout = get().layout
      if (!canSwapLeads(layout, id)) return { ok: false }
      const components = layout.components.map((c) => (c.id === id && c.holes ? { ...c, holes: [c.holes[1], c.holes[0]] } : c))
      const next: CircuitLayout = { ...layout, components }
      // the full validator decides (a body overhang that turns with the part)
      if (!validateLayout(next).ok) return { ok: false }
      pushHistory(`swap:${id}`)
      commitLayout(next)
      return { ok: true }
    },

    setParam(componentId, key, value) {
      const layout = get().layout
      const comp = layout.components.find((c) => c.id === componentId)
      if (!comp) return
      const entry = getEntry(comp.type)
      if (!entry) return
      const def = entry.params?.find((p) => p.key === key)
      if (!def) return

      const components = layout.components.map((c) =>
        c.id === componentId ? { ...c, params: { ...c.params, [key]: value } } : c,
      )
      const isRuntime = def.runtime === true
      // Undoable like any document edit — except the momentary 'pressed'
      // (pushbutton HOLD), which is transient by nature. The param tag makes
      // rapid same-knob updates (slider drags) coalesce into ONE undo step.
      if (key !== 'pressed') pushHistory(`param:${componentId}:${key}`)
      // runtime params go straight to the live world — no rebuild;
      // structural params (resistance, capacitance…) require a rebuild.
      // (scope_probe 'channel' is structural: the reload rebinds the probe.)
      commitLayout({ ...layout, components }, !isRuntime)
      // forwarded whenever a host exists, session or not: the host keeps the
      // world of the last load, and a runtime commit does not reload it
      const h = host
      if (isRuntime && h) callHost(() => h.setRuntimeParam(componentId, key, value))
    },

    select(id) {
      const sel = get().selection
      // keep the array identity stable for repeat-clicks (the scene resyncs
      // highlight overlays on every selection identity change)
      if (id === null ? sel.length === 0 : sel.length === 1 && sel[0] === id) return
      set({ selection: id === null ? [] : [id] })
    },

    toggleSelect(id) {
      const sel = get().selection
      set({ selection: sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id] })
    },

    clearSelection() {
      if (get().selection.length > 0) set({ selection: [] })
    },

    marqueeSelect(ids) {
      set({ selection: [...new Set(ids)] })
    },

    setMode(mode) {
      if (mode.kind === 'place') {
        const entry = getEntry(mode.type)
        if (!entry) return
        if (entry.placement === 'offboard') {
          // off-board instruments are placed immediately — no hole to pick
          const before = get().layout.components.length
          get().addComponent(mode.type, {})
          const comps = get().layout.components
          set({
            mode: { kind: 'select' },
            selection: comps.length > before ? [comps[comps.length - 1].id] : get().selection,
          })
          return
        }
      }
      set({ mode })
    },

    setHoverHole(h) {
      if (get().hoverHole === h) return
      set({ hoverHole: h })
    },

    clearBoard() {
      get().resetSim()
      // one undo step restores the whole board (skip when already empty)
      if (clearBoardRecordsUndo(get().layout)) pushHistory('clear')
      set({ layout: EMPTY_LAYOUT, selection: [], mode: { kind: 'select' } })
      scheduleAutosave(EMPTY_LAYOUT)
    },

    loadLayout(layout) {
      const res = validateLayout(layout)
      if (!res.ok || !res.layout) return { ok: false, errors: res.errors }
      get().resetSim()
      pushHistory('load') // import / example / AI apply = one undo step
      const loaded = normalizedOnLoad(res.layout) // pushbutton 'PB<n>' → 'SW<n>' (UX H8)
      layoutLoads++ // read by layout subscribers during the set() below
      set({
        layout: loaded,
        selection: [],
        mode: { kind: 'select' },
        issues: res.warnings.map((message) => ({ level: 'warning' as const, message })),
      })
      scheduleAutosave(loaded)
      layoutLoadedSink?.() // after set(): scene subscribers already saw the new layout
      return { ok: true, errors: [] }
    },

    exportJson() {
      // exports must not carry the momentary 'pressed' of a held button
      return JSON.stringify(stripTransientParams(get().layout), null, 2)
    },

    undo() {
      // strip the stashed current document too — redo must not restore a
      // snapshot taken while a pushbutton was held
      const restored = history.undo(stripTransientParams(get().layout))
      if (!restored) return
      restoreSnapshot(restored)
    },

    redo() {
      const restored = history.redo(stripTransientParams(get().layout))
      if (!restored) return
      restoreSnapshot(restored)
    },

    // --- actions: move / rotate ----------------------------------------------

    previewMove(ids, target) {
      // pure: same movedLayout + full-validator pass commitMove uses, so the
      // drag hologram's tint can never disagree with the commit
      const moved = movedLayout(get().layout, ids, target)
      return { valid: moved !== null && validateLayout(moved).ok }
    },

    commitMove(ids, target) {
      const layout = get().layout
      const moved = movedLayout(layout, ids, target)
      // ALL-OR-NOTHING: the full validator re-checks bounds, seams, occupancy
      // and occlusion with the moving parts' old holes vacated (they are
      // simply absent from the candidate). Wires stay put (v1 semantics).
      if (!moved || !validateLayout(moved).ok) return { ok: false }
      pushHistory('move')
      commitLayout(moved)
      return { ok: true }
    },

    moveSelection(dCol, dRowLattice = 0) {
      const { selection, layout } = get()
      // wires stay put — nudge only the selected components
      const ids = selection.filter((id) => layout.components.some((c) => c.id === id))
      if (ids.length === 0) return
      get().commitMove(ids, { dCol, dRowLattice })
    },

    rotateArmed() {
      const mode = get().mode
      if (mode.kind !== 'place') return
      const entry = getEntry(mode.type)
      if (!entry || (entry.placement !== 'dip' && entry.placement !== 'footprint')) return
      const cur = mode.rotation ?? 0
      // the next rotation the package may take, in quarter-turn order: DIPs
      // only ever take 0|180 (90/270 would short opposite pin pairs), and a
      // catalog `allowedRotations` narrows footprints the same way
      const allowed = allowedRotationsOf(entry)
      if (allowed.length === 0) return
      let next: Rotation = allowed[0]
      for (let step = 90; step <= 360; step += 90) {
        const r = ((cur + step) % 360) as Rotation
        if (allowed.includes(r)) {
          next = r
          break
        }
      }
      set({ mode: { ...mode, rotation: next } })
    },

    rotatePlaced(id) {
      const layout = get().layout
      const comp = layout.components.find((c) => c.id === id)
      const entry = comp ? getEntry(comp.type) : undefined
      if (!comp || !entry || (entry.placement !== 'dip' && entry.placement !== 'footprint')) {
        return { ok: false }
      }
      const cur: Rotation = comp.rotation ?? 0
      // candidate quarter turns in cycling order; DIPs toggle 0↔180 in place,
      // catalog `allowedRotations` drop the orientations a part cannot take
      const allowed = allowedRotationsOf(entry)
      const steps: number[] = entry.placement === 'dip' ? [180] : [90, 180, 270]
      const config = boardConfigOf(layout)
      const withRotation = (rot: Rotation, anchor: string | undefined): CircuitLayout => ({
        ...layout,
        components: layout.components.map((c) => {
          if (c.id !== id) return c
          const next: ComponentInstance = { ...c }
          if (rot === 0) delete next.rotation // canonical: rotation 0 stays absent
          else next.rotation = rot
          if (anchor !== undefined) next.at = anchor
          return next
        }),
      })
      for (const step of steps) {
        const rot = ((cur + step) % 360) as Rotation
        if (!allowed.includes(rot)) continue
        // 1. about pin 1 (legacy): re-validate holes incl. occupancy, occlusion and seams
        const candidate = withRotation(rot, undefined)
        if (validateLayout(candidate).ok) {
          pushHistory(`rotate:${id}`)
          commitLayout(candidate)
          return { ok: true }
        }
        // 2. a footprint that cannot turn about pin 1 — its pins would run
        //    off the strip rows / leave the designed anchor row, or short
        //    each other (B3: a relay or level shifter straddling the channel)
        //    — turns about its body center instead: pin 1 moves to the other
        //    side and the package keeps covering the same area
        if (entry.placement !== 'footprint') continue
        const turned = componentPinHoles({ ...comp, rotation: rot }, entry, config)
        if (turned && !stripShorts(entry, turned).some((s) => s.severe)) continue // blocked otherwise (occupancy …)
        const anchor = recenteredAnchor(comp, entry, rot, config)
        if (!anchor || anchor === comp.at) continue
        const centered = withRotation(rot, anchor)
        if (validateLayout(centered).ok) {
          pushHistory(`rotate:${id}`)
          commitLayout(centered)
          return { ok: true }
        }
      }
      return { ok: false } // no other rotation fits — leave the part untouched
    },

    // --- actions: instruments -------------------------------------------------

    setInstrumentPos(id, pos) {
      const layout = get().layout
      const comp = layout.components.find((c) => c.id === id)
      const entry = comp ? getEntry(comp.type) : undefined
      if (!comp || !entry) return { ok: false, error: `no component "${id}"` }
      if (entry.placement !== 'offboard') {
        return { ok: false, error: `"${id}" sits on the board — only instruments take a bench position` }
      }
      if (comp.pos && comp.pos.x === pos.x && comp.pos.z === pos.z) return { ok: true }
      const components = layout.components.map((c) =>
        c.id === id ? { ...c, pos: { x: pos.x, z: pos.z } } : c,
      )
      const candidate: CircuitLayout = { ...layout, components }
      // model rules: 0.5-grid snap, body clear of the board + other instruments
      const res = validateLayout(candidate)
      if (!res.ok) return { ok: false, error: res.errors[0] }
      // the param-style tag coalesces a continuous drag into ONE undo step
      pushHistory(`param:${id}:pos`)
      // visual-only: no engine rebuild, but the fresh layout identity makes
      // the scene replan wire routes around the moved instrument box
      commitLayout(candidate, false)
      return { ok: true }
    },

    setBoardSize(size) {
      const layout = get().layout
      if (size === boardOf(layout)) return { ok: true }

      // Shrink safety against (newSize, CURRENT count + rows): every component
      // lead and wire endpoint must exist on the target rig, and no package
      // may land on one of its (moved) seams. (Growing passes trivially — the
      // hole lattices nest.) `rows` MUST carry over: omitting it would make
      // isHoleOnBoard treat the target as a 1-row grid and falsely strand
      // every part on board-rows >= 1, even on pure growth.
      const current = boardConfigOf(layout)
      const target: BoardConfig = { size, count: current.count, rows: current.rows }
      const offenders = strandedParts(layout, target)
      if (offenders > 0) {
        const noun = offenders === 1 ? 'part' : 'parts'
        return { ok: false, error: `${offenders} ${noun} would fall off the ${rigName(target)}` }
      }

      pushHistory('board')
      // a bigger board can swallow an explicitly-positioned instrument; keep
      // the store's invariant (committed layouts always validate) by nudging
      // it clear — no-op (same reference) when nothing overlaps
      const next: CircuitLayout = nudgeInstrumentsClear({ ...layout, board: size })
      commitLayout(next)
      // a pending wire-mode `from` is not a committed part: strandedParts
      // never saw it, so drop it here if the new rig no longer has its hole
      set({ mode: reconcileWireMode(get().mode, next) })
      return { ok: true }
    },

    setBoardCount(n) {
      if (!isBoardCount(n)) {
        return {
          ok: false,
          error: `Board count must be a whole number from 1 to ${MAX_BOARD_COUNT}`,
        }
      }
      const layout = get().layout
      const current = boardConfigOf(layout)
      if (n === current.count) return { ok: true }

      // Shrink safety: every lead and wire endpoint must exist on the smaller
      // rig (count growth passes trivially — columns/rail indices just extend
      // rightward and existing seams stay put). `rows` carries over so parts
      // on board-rows >= 1 are bounds-checked against the real grid depth.
      const target: BoardConfig = { size: current.size, count: n, rows: current.rows }
      if (n < current.count) {
        const offenders = strandedParts(layout, target)
        if (offenders > 0) {
          const noun = offenders === 1 ? 'part' : 'parts'
          return { ok: false, error: `${offenders} ${noun} would fall off the ${rigName(target)}` }
        }
      }

      pushHistory('boards')
      // absent = 1 is the canonical single-board form (back-compat exports)
      let next: CircuitLayout = { ...layout, boardCount: n }
      if (n === 1) delete next.boardCount
      // a wider rig can swallow an explicitly-positioned instrument (e.g. the
      // scene's plus paddle growing rightward) — auto-nudge it clear so the
      // committed document always validates (shrinks are a no-op here)
      next = nudgeInstrumentsClear(next)
      commitLayout(next)
      // a pending wire-mode `from` is not a committed part: strandedParts
      // never saw it, so drop it here if the new rig no longer has its hole
      set({ mode: reconcileWireMode(get().mode, next) })
      return { ok: true }
    },

    setBoardRows(n) {
      if (!isBoardRows(n)) {
        return {
          ok: false,
          error: `Board rows must be a whole number from 1 to ${MAX_BOARD_ROWS}`,
        }
      }
      const layout = get().layout
      const current = boardConfigOf(layout)
      if (n === current.rows) return { ok: true }

      // Shrink safety: every lead and wire endpoint must exist on the
      // shallower grid (isHoleOnBoard bounds the board-row prefix).
      const target: BoardConfig = { size: current.size, count: current.count, rows: n }
      if (n < current.rows) {
        const offenders = strandedParts(layout, target)
        if (offenders > 0) {
          const noun = offenders === 1 ? 'part' : 'parts'
          return {
            ok: false,
            error: `${offenders} ${noun} would fall off the ${n}-row grid`,
          }
        }
      }

      pushHistory('rows')
      // absent = 1 is the canonical single-row form (back-compat exports)
      let next: CircuitLayout = { ...layout, boardRows: n }
      if (n === 1) delete next.boardRows
      // a deeper board can swallow an explicitly-positioned instrument —
      // keep its absolute pos when clear, auto-nudge it when not
      if (n > current.rows) next = nudgeInstrumentsClear(next)
      commitLayout(next)
      set({ mode: reconcileWireMode(get().mode, next) })
      return { ok: true }
    },

    growGrid(direction) {
      const layout = get().layout
      const cfg = boardConfigOf(layout)
      let next: CircuitLayout
      if (direction === 'right' || direction === 'left') {
        if (cfg.count >= MAX_BOARD_COUNT) {
          return { ok: false, error: `The rig is already ${MAX_BOARD_COUNT} modules wide` }
        }
        // growing LEFT shifts the content one module of columns rightward
        // (rail indices proportionally) so the origin stays the top-left board
        const base =
          direction === 'left' ? remapLayout(layout, BOARD_SIZES[cfg.size].cols, 0) : layout
        next = { ...base, boardCount: cfg.count + 1 }
      } else {
        if (cfg.rows >= MAX_BOARD_ROWS) {
          return { ok: false, error: `The grid is already ${MAX_BOARD_ROWS} board-rows deep` }
        }
        // growing UP shifts the content one board-row deeper ("1:" prefixes)
        const base = direction === 'up' ? remapLayout(layout, 0, 1) : layout
        next = { ...base, boardRows: cfg.rows + 1 }
      }
      // instruments keep their ABSOLUTE pos; any the grown board now overlaps
      // is auto-nudged to clear bench space (validator rules)
      next = nudgeInstrumentsClear(next)
      // defensive gate (grid-model contract): a remap can never silently
      // clamp — anything off the rails fails validation loudly, and we refuse
      // rather than commit a document the next boot would reject
      const res = validateLayout(next)
      if (!res.ok) {
        return { ok: false, error: `growing the grid failed validation: ${res.errors[0]}` }
      }
      pushHistory(`grow:${direction}`) // ONE undo step restores refs + rig together
      commitLayout(next)
      set({ mode: reconcileWireMode(get().mode, next) })
      return { ok: true }
    },

    // --- actions: preferences --------------------------------------------------

    setRenderMode(mode) {
      set({ renderMode: mode })
      try {
        if (mode === null) window.localStorage.removeItem(RENDER_MODE_STORAGE_KEY)
        else window.localStorage.setItem(RENDER_MODE_STORAGE_KEY, mode)
      } catch {
        /* storage unavailable — the choice just won't persist */
      }
    },

    // --- actions: simulation -------------------------------------------------

    startSim() {
      if (get().running) return
      const h = ensureHost() // first use: built + loaded with the current document
      if (!h) return // host construction failed; issue already posted
      if (!simActive) beginSession()
      debugHalted = false
      // optimistic: the button flips at once; onHostError rolls it back
      startPending = true
      set({ running: true })
      lastReactPushMs = Number.NEGATIVE_INFINITY
      publishNow()
      callHost(() => h.start(get().simSpeed))
    },

    stopSim() {
      if (!get().running) return
      startPending = false
      set({ running: false })
      publishNow() // leave the final state on screen (the paused frame follows)
      const h = host
      if (h) callHost(() => h.pause())
    },

    resetSim() {
      startPending = false
      debugHalted = false
      simActive = false
      scopeBuf = []
      lastTelemetry = null
      lastIssues = []
      lastSimTime = 0
      set({
        running: false,
        simTime: 0,
        telemetry: null,
        issues: [],
        scope: { samples: scopeBuf, timeWindow: get().scope.timeWindow },
      })
      telemetrySink?.(null)
      // never builds a host just to reset it (tests reset in every beforeEach)
      const h = host
      if (h && callHost(() => h.pause()) && callHost(() => h.reset())) {
        emitHostEvent({ kind: 'reset' })
        // a fresh revision for the power-cycled world: frames still in flight
        // from before the reset become recognisably stale (epochRev)
        loadHost(get().layout, { newEpoch: true })
      }
    },

    setSimSpeed(x) {
      if (!Number.isFinite(x) || x <= 0) return
      set({ simSpeed: x })
      const h = host
      if (h) callHost(() => h.setSpeed(x))
    },

    setScopeWindow(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return
      if (simActive) trimScope(lastSimTime, seconds)
      set({ scope: { samples: scopeBuf, timeWindow: seconds } })
    },

    // --- actions: llm --------------------------------------------------------

    setApiKey(k) {
      set({ llm: { ...get().llm, apiKey: k } })
      try {
        window.localStorage.setItem(LS_API_KEY, k)
      } catch {
        /* storage unavailable */
      }
    },

    cancelGeneration() {
      if (!generateAbort) return
      generateAbort.abort()
      // don't let in-flight progress overwrite the terminal status
      if (get().llm.busy) set({ llm: { ...get().llm, status: 'cancelling…' } })
    },

    async generateFromPrompt(prompt) {
      if (get().llm.busy) return
      const controller = new AbortController()
      generateAbort = controller
      set({
        llm: {
          ...get().llm,
          busy: true,
          status: 'starting…',
          error: null,
          pending: null,
          explanation: null,
        },
      })
      try {
        const res = await generateCircuit({
          apiKey: get().llm.apiKey,
          prompt,
          boardConfig: boardConfigOf(get().layout),
          onStatus: (status) => {
            // don't let in-flight progress overwrite the 'cancelling…' status
            if (!controller.signal.aborted) set({ llm: { ...get().llm, status } })
          },
          signal: controller.signal,
        })
        set({
          llm: {
            ...get().llm,
            busy: false,
            status: '',
            pending: res.layout,
            explanation: res.explanation,
            error: null,
          },
        })
      } catch (err) {
        // user-initiated cancel returns the panel to idle without an error
        const cancelled = controller.signal.aborted
        set({
          llm: {
            ...get().llm,
            busy: false,
            status: '',
            error: cancelled ? null : err instanceof Error ? err.message : String(err),
          },
        })
      } finally {
        if (generateAbort === controller) generateAbort = null
      }
    },

    applyPending() {
      const pending = get().llm.pending
      if (!pending) return
      const res = get().loadLayout(pending)
      if (res.ok) {
        set({ llm: { ...get().llm, pending: null, explanation: null, error: null } })
      } else {
        set({
          llm: {
            ...get().llm,
            error: `Generated circuit failed validation: ${res.errors.join('; ')}`,
          },
        })
      }
    },

    discardPending() {
      set({ llm: { ...get().llm, pending: null, explanation: null } })
    },
  }
})

/**
 * Every document change reaches the host: edits, undo/redo, loads, clears —
 * and direct setState({ layout }) as tests do. Commits flagged as
 * non-rebuilding (runtime params, instrument moves) are skipped, exactly as
 * the legacy store skipped its engine rebuild for them. No host = nothing to
 * do: the first ensureHost() loads the then-current document.
 */
useStore.subscribe((state, prev) => {
  if (state.layout === prev.layout) return
  const skip = state.layout === skipLoadFor
  skipLoadFor = null
  if (!skip) loadHost(state.layout)
})

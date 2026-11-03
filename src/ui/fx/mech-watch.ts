/**
 * Mechanical sound watcher (owner: sound) — WHEN the board makes a
 * mechanical sound, from real state only (product owner: 「各種元器件的機械
 * 聲音，插入、點擊，有爽度」). The sounds themselves are sound.ts playMech /
 * mech-voices.ts.
 *
 *   startMechSoundWatch()   CelebrationOverlay installs it once; returns stop
 *   withMechCause(c, run)   undo / redo (edit-feedback.ts): one swish, not the diff
 *   withMechPaste(run)      a paste / duplicate (copy-paste.ts place()): ONE insert,
 *                           even onto an empty board (never a whole-circuit 'load')
 *   voiceSceneCue(cue)      the 3D scene's own moments (FxCue: lift, snap, settle,
 *                           wire tip, a refused drop, a board's touchdown) —
 *                           CelebrationOverlay's sink
 *   soundsHere()            where the page may sound (the product chrome, not
 *                           ?shotrig) — CelebrationOverlay hands it to sound.ts
 *   setSceneShowing(probe)  a 3D scene shows the board (it voices a new board
 *                           module's touchdown itself)
 *
 * The event source is the STORE, not the call sites: every way a part,
 * wire or control changes (a click, a drag-to-wire, Ctrl+V, the inspector,
 * a lesson's coach fix, a 3D press) lands in the document, so a diff of two
 * layouts says what happened, once, and new flows sound with no extra call.
 * mechCuesOf (pure) reads one step, first match wins:
 *  1. a whole layout landed (store.loadLayout: an example, a lesson, an
 *     import, an AI circuit) → 'load' (an emptied one → 'clear');
 *  2. the rig changed and nothing came or went (a board added / removed,
 *     growGrid left / up remapping every hole) → 'board' only. ONE new
 *     module drops in on the 3D scene (scene.ts spawn tween) and the scene
 *     voices its touchdown itself — it is the only clack while a scene shows
 *     the board (never early while the board is still in the air, never
 *     twice however slow the rebuild); this store-side one plays only with no
 *     scene (MechHit.byScene). Any other rig change sounds at once;
 *  3. a paste / duplicate (withMechPaste — copy-paste.ts place()) → ONE
 *     'insert' (or 'wire-in' for wires alone), even onto an empty board;
 *  4. an emptied board of more than three named things → 'clear';
 *  5. a whole circuit at once — parts swapped for others, parts and wires
 *     added together (unless every earlier part and wire stayed untouched: a
 *     paste), more than LOAD_ADDITIONS additions → 'load';
 *  6. parts added → ONE 'insert' (count = their leads, kind = the heaviest
 *     placement: a DIP / footprint thocks, an instrument thuds on the bench);
 *  7. parts removed → 'pull' (their wires go with them);
 *  8. wires added → 'wire-in'; 9. wires removed → 'wire-out';
 *  then per part / wire (several may sound together): a rotation → 'rotate',
 *  a new place → 'seat' (the drag's lift is the scene's), a re-routed wire
 *  end → 'wire-in', and the mechanical runtime params (MECH_PARAMS): a
 *  button down → 'press' (a finger holds it) or 'latch' (kept pressed), up →
 *  'release'; a toggle / slide switch, DIP bits, a pot or trimmer crossing a
 *  1/POT_STEPS step, encoder detents, a jumper (the PCF8574's A2–A0: one
 *  click per jumper moved), the multimeter's dial.
 *  Knobs that are not mechanical (light, temperature, a supply voltage, a
 *  joystick's stick), structural values (resistance…) and wire colours are
 *  silent; so is a setParam that writes the value already there.
 *
 * Also: the place / wire modes (a first wire end or a lead tip picked →
 * 'wire-tip'; the placement ghost turned by R / the rotate button →
 * 'rotate', like a placed part; the ghost aiming is silent), the momentary
 * holds (a finger on a latched button → 'press'; the latch taking over a
 * held one → 'latch'), and real relay contacts (RelayEdges — the model's NO
 * contact edges in the host frames, only while the simulation runs and the
 * tab is visible; a relay switching faster than the frame rate is heard at
 * the frame rate, never invented). Undo / redo play one distinct swish
 * instead of the inverse diff (withMechCause). A refusal ('refuse') is
 * played by its callers (App.tsx: a part that does not fit; copy-paste.ts:
 * no room for a copy; the scene: a refused drop), never on a plain cancel.
 * The classic chrome and ?shotrig are silent: soundsHere is checked at play
 * time, sound.ts's gate (setSoundGate) makes no AudioContext there, and
 * under ?shotrig nothing is watched.
 *
 * Cheap: the store subscriber returns at once unless the layout or the mode
 * changed (it is called on every 10 Hz telemetry push and every hover), a
 * diff is O(parts), and the per-frame host listener touches only the cached
 * relay ids (none: it returns at once).
 */
import { getEntry, type CatalogEntry, type ParamDef } from '../../model/catalog'
import { parseHole, parseTerminalRef } from '../../model/breadboard'
import type { CircuitLayout, ComponentInstance, ParamValue, SimTelemetry, Wire } from '../../model/types'
import type { InteractionMode } from '../../state/types'
import { layoutLoadCount, onSimHostEvent, useStore } from '../../state/store'
import { useLatchHolds } from '../embedded/latch'
import { isLegacyChrome } from '../chrome/legacy'
import { celebrationsSuppressed } from './celebrate'
import { playMech, type MechCue, type MechOpts } from './sound'

export type MechKind = NonNullable<MechOpts['kind']>

/** What one change sounds like. */
export interface MechHit {
  cue: MechCue
  /** leads / bits / detents / wires / relays involved */
  count?: number
  kind?: MechKind
  /** 0..1 (a pot's position) */
  level?: number
  /** the parts / wires that make it */
  ids: string[]
  /**
   * a moment the 3D scene voices itself while it shows the board (ONE new
   * board module's touchdown, scene.ts spawn tween): the watcher plays it
   * only when no scene shows the board (setSceneShowing)
   */
  byScene?: true
}

export interface MechDiffContext {
  /** the parts a finger holds down at the change (latch.ts useLatchHolds) */
  held: readonly string[]
  /** a whole layout landed at once (store.loadLayout) */
  loaded?: boolean
  /** a paste / duplicate made the change (withMechPaste): one insert, whatever was on the board */
  pasted?: boolean
}

/** more additions than this in one step is a whole circuit (an example / file load; a paste — withMechPaste — is always ONE insert) */
export const LOAD_ADDITIONS = 8
/** a pot / trimmer ticks each time it crosses one of this many steps of its travel */
export const POT_STEPS = 32
/** relay contacts count only this long (simulated s, 5× the operate time) after a load: the rebuilt world re-picks first */
export const RELAY_SETTLE_S = 0.02

type ParamVoice = 'press' | 'toggle' | 'slide' | 'dip' | 'pot' | 'detent' | 'jumper' | 'rotary'

/**
 * The mechanical runtime params and their voice: a catalog param with
 * `runtime: true` whose key matches (and the entry's visual.shape / the
 * param's unit, where the key alone is ambiguous). `bits`: the value is a
 * number whose bits are separate jumpers (one click per jumper moved).
 */
export const MECH_PARAMS: readonly { key: string; shape?: string; unit?: string; voice: ParamVoice; bits?: true }[] = [
  { key: 'pressed', voice: 'press' }, // pushbutton, the KY-040 / joystick push switch
  { key: 'state', shape: 'toggle', voice: 'toggle' },
  { key: 'state', shape: 'slide', voice: 'slide' },
  { key: 'on', shape: 'dipswitch', voice: 'dip' },
  { key: 'position', unit: 'detents', voice: 'detent' }, // KY-040
  { key: 'position', shape: 'pot', voice: 'pot' },
  { key: 'contrast', voice: 'pot' }, // the LCD's contrast trimmer
  { key: 'vref', voice: 'pot' }, // a stepper driver's current trimmer
  { key: 'boot0', voice: 'jumper' },
  { key: 'jumper5v', voice: 'jumper' },
  { key: 'jumperEnA', voice: 'jumper' },
  { key: 'jumperEnB', voice: 'jumper' },
  { key: 'address', shape: 'comm_pcf8574', voice: 'jumper', bits: true }, // the A2–A0 shunts (0x20…0x27)
  { key: 'mode', shape: 'dmm', voice: 'rotary' },
]

function paramVoice(entry: CatalogEntry, key: string): { voice: ParamVoice; def: ParamDef; bits: boolean } | null {
  const def = entry.params?.find((p) => p.key === key)
  if (!def?.runtime) return null
  const rule = MECH_PARAMS.find(
    (r) => r.key === key && (r.shape === undefined || r.shape === entry.visual?.shape) && (r.unit === undefined || r.unit === def.unit),
  )
  return rule ? { voice: rule.voice, def, bits: rule.bits === true } : null
}

/** jumpers moved between two values whose bits are jumpers ('0x20' → '0x23': 2); 1 when unreadable */
function changedJumpers(a: ParamValue, b: ParamValue): number {
  const x = Number(a)
  const y = Number(b)
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 1
  let d = (x ^ y) >>> 0
  let n = 0
  while (d) {
    n += d & 1
    d >>>= 1
  }
  return Math.max(1, n)
}

/** where a value sits on its param's travel, 0..1 */
function travel(v: ParamValue, def: ParamDef): number {
  const lo = def.min ?? 0
  const hi = def.max ?? 1
  const x = (Number(v) - lo) / (hi - lo || 1)
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0
}

const potStep = (level: number): number => Math.min(POT_STEPS - 1, Math.floor(level * POT_STEPS))

/** DIP bits that differ ('00010000' vs '00110000' → 1) */
function changedBits(a: string, b: string): number {
  let n = 0
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] === '1') !== (b[i] === '1')) n++
  return n
}

/** The mechanical sounds of one part's param changes (`held`: the parts a finger holds). */
function paramHits(b: ComponentInstance, c: ComponentInstance, entry: CatalogEntry, held: readonly string[]): MechHit[] {
  if (b.params === c.params) return []
  const out: MechHit[] = []
  const keys = new Set([...Object.keys(b.params ?? {}), ...Object.keys(c.params ?? {})])
  for (const key of keys) {
    const bv = b.params?.[key]
    const av = c.params?.[key]
    if (bv === av) continue
    const pv = paramVoice(entry, key)
    if (!pv) continue
    const was = bv ?? pv.def.default
    const now = av ?? pv.def.default
    const ids = [c.id]
    switch (pv.voice) {
      case 'press': {
        if ((was === true) === (now === true)) break
        // pressMomentary marks the part held BEFORE it writes pressed: a finger; else the latch
        out.push(now === true ? { cue: held.includes(c.id) ? 'press' : 'latch', ids } : { cue: 'release', ids })
        break
      }
      case 'dip': {
        const n = changedBits(String(was), String(now))
        if (n > 0) out.push({ cue: 'dip', count: n, ids })
        break
      }
      case 'pot': {
        const level = travel(now, pv.def)
        if (potStep(travel(was, pv.def)) !== potStep(level)) out.push({ cue: 'pot', level, ids })
        break
      }
      case 'detent': {
        const steps = Math.round(Number(now) - Number(was))
        if (Number.isFinite(steps) && steps !== 0) out.push({ cue: 'detent', count: Math.min(4, Math.abs(steps)), ids })
        break
      }
      case 'jumper': {
        if (String(was) === String(now)) break
        out.push(pv.bits ? { cue: 'jumper', count: changedJumpers(was, now), ids } : { cue: 'jumper', ids })
        break
      }
      default:
        if (String(was) !== String(now)) out.push({ cue: pv.voice, ids })
    }
  }
  return out
}

/** A wire whose off-board end belongs to one of `ids` (it goes with that part) — edit-feedback's rule. */
function attachedTo(w: Wire, ids: ReadonlySet<string>): boolean {
  for (const end of [w.from, w.to]) {
    const term = parseHole(end) ? null : parseTerminalRef(end)
    if (term && ids.has(term.componentId)) return true
  }
  return false
}

const KIND_WEIGHT: Record<MechKind, number> = { offboard: 1, probe: 2, leads: 3, dip: 4, footprint: 4 }

/** the leads of `parts`, and the heaviest body among them */
function bodyOf(parts: readonly ComponentInstance[]): { count: number; kind: MechKind } {
  let count = 0
  let kind: MechKind = 'leads'
  let weight = 0
  for (const c of parts) {
    const entry = getEntry(c.type)
    count += entry?.pins.length ?? 2
    const k: MechKind = entry?.placement ?? 'leads'
    if (KIND_WEIGHT[k] > weight) {
      weight = KIND_WEIGHT[k]
      kind = k
    }
  }
  return { count, kind }
}

const boardKey = (l: CircuitLayout): string => `${l.board ?? 'standard'}|${l.boardCount ?? 1}|${l.boardRows ?? 1}`

/**
 * The rig grew by exactly ONE module column or board-row of the same board
 * size: the 3D scene drops it in and voices its touchdown (scene.ts
 * syncBoard's spawn rule — anything else it rebuilds without a drop).
 */
function oneModuleGrew(b: CircuitLayout, a: CircuitLayout): boolean {
  if ((b.board ?? 'standard') !== (a.board ?? 'standard')) return false
  const bc = b.boardCount ?? 1
  const ac = a.boardCount ?? 1
  const br = b.boardRows ?? 1
  const ar = a.boardRows ?? 1
  return (ac === bc + 1 && ar === br) || (ar === br + 1 && ac === bc)
}

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((x, i) => x === (b ?? [])[i])

/** hits of the same cue merged into one (counts added, the last level) */
function merged(hits: readonly MechHit[]): MechHit[] {
  const out: MechHit[] = []
  for (const h of hits) {
    const same = out.find((x) => x.cue === h.cue)
    if (!same) {
      out.push({ ...h, ids: [...h.ids] })
      continue
    }
    if (h.count !== undefined) same.count = (same.count ?? 0) + h.count
    if (h.level !== undefined) same.level = h.level
    same.ids.push(...h.ids)
  }
  return out
}

/** What turning `before` into `after` sounds like (see the module doc), in play order. */
export function mechCuesOf(before: CircuitLayout, after: CircuitLayout, ctx: MechDiffContext): MechHit[] {
  if (before === after) return []
  const empty = after.components.length === 0 && after.wires.length === 0
  if (ctx.loaded) {
    if (!empty) return [{ cue: 'load', ids: after.components.map((c) => c.id) }]
    return before.components.length + before.wires.length > 0 ? [{ cue: 'clear', ids: [] }] : []
  }
  const bComps = new Map(before.components.map((c) => [c.id, c]))
  const aComps = new Map(after.components.map((c) => [c.id, c]))
  const bWires = new Map(before.wires.map((w) => [w.id, w]))
  const aWires = new Map(after.wires.map((w) => [w.id, w]))
  const addedC = after.components.filter((c) => !bComps.has(c.id))
  const removedC = before.components.filter((c) => !aComps.has(c.id))
  const addedW = after.wires.filter((w) => !bWires.has(w.id))
  const removedW = before.wires.filter((w) => !aWires.has(w.id))
  const additions = addedC.length + addedW.length
  const removals = removedC.length + removedW.length

  if (boardKey(before) !== boardKey(after) && additions + removals === 0) {
    // one module added drops in on the scene, which voices its own touchdown
    return [oneModuleGrew(before, after) ? { cue: 'board', ids: [], byScene: true } : { cue: 'board', ids: [] }]
  }
  if (ctx.pasted && additions > 0 && removals === 0) {
    // Ctrl+V / Ctrl+D / 複製: one gesture, one insert — even onto an empty board
    if (addedC.length > 0) return [{ cue: 'insert', ...bodyOf(addedC), ids: [...addedC.map((c) => c.id), ...addedW.map((w) => w.id)] }]
    return [{ cue: 'wire-in', count: addedW.length, ids: addedW.map((w) => w.id) }]
  }
  const gone = new Set(removedC.map((c) => c.id))
  const loose = removedW.filter((w) => !attachedTo(w, gone))
  if (empty && removedC.length + loose.length > 3) return [{ cue: 'clear', ids: [...removedC.map((c) => c.id), ...loose.map((w) => w.id)] }]
  if (additions > 0) {
    // a paste adds parts (and their wires) and leaves every earlier part and wire untouched
    const pasted =
      removals === 0 &&
      before.components.length > 0 &&
      before.components.every((c) => aComps.get(c.id) === c) &&
      before.wires.every((w) => aWires.get(w.id) === w)
    if (removals > 0 || additions > LOAD_ADDITIONS || (addedC.length > 0 && addedW.length > 0 && !pasted)) {
      return [{ cue: 'load', ids: after.components.map((c) => c.id) }]
    }
    if (addedC.length > 0) return [{ cue: 'insert', ...bodyOf(addedC), ids: [...addedC.map((c) => c.id), ...addedW.map((w) => w.id)] }]
    return [{ cue: 'wire-in', count: addedW.length, ids: addedW.map((w) => w.id) }]
  }
  if (removedC.length > 0) return [{ cue: 'pull', ...bodyOf(removedC), ids: [...removedC.map((c) => c.id), ...loose.map((w) => w.id)] }]
  if (removedW.length > 0) return [{ cue: 'wire-out', count: removedW.length, ids: removedW.map((w) => w.id) }]

  const hits: MechHit[] = []
  const rotated: ComponentInstance[] = []
  const moved: ComponentInstance[] = []
  for (const c of after.components) {
    const b = bComps.get(c.id)
    if (!b || b === c) continue
    if ((b.rotation ?? 0) !== (c.rotation ?? 0)) rotated.push(c)
    else if (b.at !== c.at || !sameList(b.holes, c.holes) || b.pos?.x !== c.pos?.x || b.pos?.z !== c.pos?.z) moved.push(c)
    const entry = getEntry(c.type)
    if (entry) hits.push(...paramHits(b, c, entry, ctx.held))
  }
  const rewired = after.wires.filter((w) => {
    const b = bWires.get(w.id)
    return !!b && b !== w && (b.from !== w.from || b.to !== w.to)
  })
  const structural: MechHit[] = []
  if (rotated.length > 0) structural.push({ cue: 'rotate', ids: rotated.map((c) => c.id) })
  if (moved.length > 0) structural.push({ cue: 'seat', ...bodyOf(moved), ids: moved.map((c) => c.id) })
  if (rewired.length > 0) structural.push({ cue: 'wire-in', count: rewired.length, ids: rewired.map((w) => w.id) })
  return merged([...structural, ...hits])
}

/**
 * The place / wire modes: a first wire end picked, a lead tip set into its
 * hole, the placement ghost turned (R / the rotate button — store.rotateArmed:
 * the same placement, only its rotation changed) like a placed part. The
 * ghost aiming is silent.
 */
export function modeCuesOf(prev: InteractionMode, next: InteractionMode): MechHit[] {
  if (next.kind === 'wire' && next.from != null && !(prev.kind === 'wire' && prev.from === next.from)) return [{ cue: 'wire-tip', ids: [] }]
  if (next.kind === 'place' && prev.kind === 'place' && next.type === prev.type) {
    if (next.pickedHoles.length > prev.pickedHoles.length) return [{ cue: 'wire-tip', ids: [] }]
    if (next.pickedHoles === prev.pickedHoles && (next.rotation ?? 0) !== (prev.rotation ?? 0)) return [{ cue: 'rotate', ids: [] }]
  }
  return []
}

/**
 * The momentary holds (latch.ts): a finger pressing a button that is kept
 * pressed ('press' — its pressed param does not change), and the latch
 * taking over a button a finger held (the double-click: 'latch').
 */
export function holdCuesOf(prev: readonly string[], held: readonly string[], layout: CircuitLayout): MechHit[] {
  const pressed = (id: string): boolean => layout.components.some((c) => c.id === id && c.params?.pressed === true)
  const out: MechHit[] = []
  for (const id of held) if (!prev.includes(id) && pressed(id)) out.push({ cue: 'press', ids: [id] })
  for (const id of prev) if (!held.includes(id) && pressed(id)) out.push({ cue: 'latch', ids: [id] })
  return out
}

// ---------------------------------------------------------------- relays

/** Relay contact edges in one frame: how many relays closed / opened their NO contact. */
export interface RelayEdge {
  on: number
  off: number
}

interface RelayRef {
  id: string
  /** the sub-circuit element that reports the contact when the part itself does not */
  sub: string | null
}

/** the relays of `layout`: relay_5v, or any part whose sub-circuit holds a relay coil */
function relaysIn(layout: CircuitLayout): RelayRef[] {
  const out: RelayRef[] = []
  for (const c of layout.components) {
    const el = getEntry(c.type)?.subcircuit?.find((s) => s.model === 'relay_srd05')
    if (el || c.type === 'relay_5v') out.push({ id: c.id, sub: el?.id ?? null })
  }
  return out
}

/** a relay's NO contact in a snapshot: 1 closed, 0 open, null unknown */
function contactNo(tele: SimTelemetry, r: RelayRef): number | null {
  const ct = tele.components[r.id]
  if (!ct) return null
  let v = ct.values?.no
  if (v === undefined && r.sub) v = ct.sub?.[r.sub]?.values?.no
  return typeof v === 'number' && Number.isFinite(v) ? (v > 0.5 ? 1 : 0) : null
}

/**
 * Real relay clicks from the model's NO contact (RelayDevice values.no,
 * mirrored onto relay_5v by its monitor chip), fed by the host events:
 *  - a NEW WORLD — the first frame of a newer document revision (`rev`), or
 *    a load of one, whichever comes first: every load rebuilds the analog
 *    world, so an energized relay drops to rest and re-picks within a few
 *    ms: SETTLE — the states from before are kept, frames are watched
 *    without a sound until RELAY_SETTLE_S of simulated time past the first
 *    frame of the new world, then a relay whose settled state differs from
 *    before clicks once (removing its drive wire clicks; an unrelated edit
 *    does not). By revision, not by the 'loaded' event: the inline host (no
 *    Worker) publishes the new world's first frame inside host.load, BEFORE
 *    the store says 'loaded' — that frame starts the settle too;
 *  - loaded(layout, rev): the relays of the new world;
 *  - frame(time, telemetry, rev): per relay, 0→1 'on', 1→0 'off' — at most
 *    one edge per relay per frame (a relay switching faster than the frame
 *    rate is heard at the frame rate);
 *  - clear() on reset (the world restarts at rest), dispose() when the host died.
 * A relay seen for the first time counts from rest (every world starts there).
 * Without a `rev` (tests), every loaded() is a new world.
 */
export class RelayEdges {
  private relays: RelayRef[] = []
  private readonly no = new Map<string, number>()
  private settle: { pre: Map<string, number>; from: number | null } | null = null
  /** the newest document revision seen in a frame or a load */
  private rev = -Infinity

  /** a new world: settle (a second one while settling keeps the states from before the first) */
  private rebuilt(): void {
    if (this.settle) this.settle.from = null
    else this.settle = { pre: new Map(this.no), from: null }
  }

  /** `rev` is newer than any seen: note it (true = a new world) */
  private newer(rev: number | undefined): boolean {
    if (rev === undefined || !(rev > this.rev)) return false
    this.rev = rev
    return true
  }

  loaded(layout: CircuitLayout, rev?: number): void {
    this.relays = relaysIn(layout)
    const fresh = rev === undefined || this.newer(rev)
    if (this.relays.length === 0) {
      this.no.clear()
      this.settle = null
      return
    }
    if (fresh) this.rebuilt()
  }

  frame(time: number, tele: SimTelemetry, rev?: number): RelayEdge | null {
    const list = this.relays
    if (this.newer(rev) && list.length > 0) this.rebuilt()
    if (list.length === 0) return null
    const s = this.settle
    if (s && s.from === null) s.from = time
    const settling = s !== null && time < (s.from ?? time) + RELAY_SETTLE_S
    let on = 0
    let off = 0
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      const v = contactNo(tele, r)
      if (v === null) continue
      const was = settling ? v : s ? (s.pre.get(r.id) ?? 0) : (this.no.get(r.id) ?? 0)
      this.no.set(r.id, v)
      if (v === was) continue
      if (v === 1) on++
      else off++
    }
    if (s && !settling) this.settle = null
    return on > 0 || off > 0 ? { on, off } : null
  }

  clear(): void {
    this.no.clear()
    this.settle = null
  }

  dispose(): void {
    this.clear()
    this.relays = []
  }
}

// ---------------------------------------------------------------- the watcher

/** undo / redo in progress: the layout change plays this once instead of its diff */
let cause: 'undo' | 'redo' | null = null
let causeVoiced = false

/**
 * Run `run` (a synchronous st.undo() / st.redo()) as an undo / redo: the
 * board change it makes sounds as ONE distinct swish, not as the inverse
 * edit (undoing a placement does not 'pull').
 */
export function withMechCause<T>(c: 'undo' | 'redo', run: () => T): T {
  const outer = cause
  const outerVoiced = causeVoiced
  cause = c
  causeVoiced = false
  try {
    return run()
  } finally {
    cause = outer
    causeVoiced = outerVoiced
  }
}

/** a paste / duplicate in progress (withMechPaste) */
let pasting = false

/**
 * Run `run` (copy-paste.ts place(): a synchronous store.pasteParts) as a
 * paste: the parts and wires it adds sound as ONE insert (one gesture), even
 * onto an empty board or with the copy's wires — never a whole-circuit
 * 'load' cascade. Its undo is the usual one swish (withMechCause).
 */
export function withMechPaste<T>(run: () => T): T {
  const outer = pasting
  pasting = true
  try {
    return run()
  } finally {
    pasting = outer
  }
}

/**
 * The page may sound here: the product chrome (the classic chrome keeps its
 * original silence) and not the visual-regression harness (?shotrig —
 * celebrationsSuppressed). CelebrationOverlay hands it to sound.ts
 * (setSoundGate), so neither place even makes an AudioContext.
 */
export function soundsHere(): boolean {
  return !isLegacyChrome() && !celebrationsSuppressed()
}

/** a 3D scene shows the board (CelebrationOverlay: scene-bridge sceneRegistered) */
let sceneShowing: () => boolean = () => false

/**
 * Tell the watcher whether a 3D scene shows the board (CelebrationOverlay;
 * null = none): while one does, a new board module's touchdown clack is the
 * scene's alone (MechHit.byScene) — played when the module really lands,
 * however long the rebuild took, and never a second time from here.
 */
export function setSceneShowing(probe: (() => boolean) | null): void {
  sceneShowing = probe ?? (() => false)
}

function sceneShows(): boolean {
  try {
    return sceneShowing()
  } catch {
    return false
  }
}

function optsOf(hit: MechHit): MechOpts {
  const o: MechOpts = {}
  if (hit.count !== undefined) o.count = hit.count
  if (hit.kind !== undefined) o.kind = hit.kind
  if (hit.level !== undefined) o.level = hit.level
  return o
}

/** sim-driven sounds only while the simulation runs and the page is seen */
function audible(): boolean {
  if (!useStore.getState().running) return false
  return !(typeof document !== 'undefined' && document.visibilityState === 'hidden')
}

/**
 * A moment only the 3D scene sees (CelebrationOverlay's FxCue sink — a drag
 * lifting a part, the aimed hole changing, a refused drop, a drop settling
 * back, a new board's touchdown): play it where the page may sound
 * (soundsHere — not the classic chrome, not ?shotrig).
 */
export function voiceSceneCue(cue: MechCue): void {
  if (soundsHere()) playMech(cue)
}

function install(): () => void {
  const unsubs: (() => void)[] = []
  const voice = (hit: MechHit): void => {
    // a new module's touchdown is the scene's own clack while a scene shows the board
    if (hit.byScene && sceneShows()) return
    if (soundsHere()) playMech(hit.cue, optsOf(hit))
  }

  let loads = layoutLoadCount()
  unsubs.push(
    useStore.subscribe((s, prev) => {
      if (s.layout === prev.layout && s.mode === prev.mode) return
      if (s.layout !== prev.layout) {
        const n = layoutLoadCount()
        const loaded = n !== loads
        loads = n
        if (cause) {
          if (!causeVoiced) {
            causeVoiced = true
            voice({ cue: cause, ids: [] })
          }
        } else {
          const ctx: MechDiffContext = { held: useLatchHolds.getState().held, loaded }
          if (pasting) ctx.pasted = true
          for (const hit of mechCuesOf(prev.layout, s.layout, ctx)) voice(hit)
        }
      }
      if (s.mode !== prev.mode && !cause) for (const hit of modeCuesOf(prev.mode, s.mode)) voice(hit)
    }),
  )
  unsubs.push(
    useLatchHolds.subscribe((s, prev) => {
      if (s.held === prev.held || cause) return
      for (const hit of holdCuesOf(prev.held, s.held, useStore.getState().layout)) voice(hit)
    }),
  )
  const relays = new RelayEdges()
  relays.loaded(useStore.getState().layout)
  unsubs.push(
    onSimHostEvent((e) => {
      if (e.kind === 'frame') {
        if (!e.current) return
        const edge = relays.frame(e.frame.time, e.frame.telemetry, e.frame.rev)
        if (!edge || !audible()) return
        if (edge.on > 0) voice({ cue: 'relay-on', count: edge.on, ids: [] })
        if (edge.off > 0) voice({ cue: 'relay-off', count: edge.off, ids: [] })
      } else if (e.kind === 'loaded') relays.loaded(e.layout, e.rev)
      else if (e.kind === 'reset') relays.clear()
      else relays.dispose()
    }),
  )
  return () => {
    for (const u of unsubs) u()
  }
}

let watchers = 0
let uninstall: (() => void) | null = null

/**
 * Install the watcher (CelebrationOverlay, once per page). Ref-counted and
 * StrictMode-safe: however many callers, ONE set of subscriptions (one
 * sound per change); it goes when the last caller stops. A no-op under the
 * visual-regression harness (?shotrig — celebrationsSuppressed).
 */
export function startMechSoundWatch(): () => void {
  watchers++
  if (watchers === 1 && !celebrationsSuppressed()) uninstall = install()
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    watchers--
    if (watchers === 0) {
      uninstall?.()
      uninstall = null
    }
  }
}

/** callers of startMechSoundWatch that have not stopped (tests) */
export function mechWatchCount(): number {
  return watchers
}

/**
 * clipboard.ts — copy / paste of placed parts WITH their settings (round 5:
 * Ctrl/⌘+C／V／X／D). Pure and node-testable; it imports only the model,
 * because the store imports it (store.pasteParts commits a plan as ONE undo
 * step; src/ui/chrome/copy-paste.ts holds the clip and says what happened).
 *
 *  - clipFromSelection(layout, ids): deep copies of the selected parts (type,
 *    params, holes / anchor, rotation) and the wires that travel with them:
 *    a wire between two copied parts, the power feed from a copied part's
 *    strip to a rail, and a copied instrument's lead to a rail (a meter's
 *    COM, a generator's GND). A wire to a part or an instrument that is not
 *    copied stays behind; a SELECTED wire comes along unless it does that,
 *    bridges two rails, or ties a source's output (a supply's +, a
 *    generator's OUT) to a rail — a second source on that rail. The clip
 *    names the selected wires that stay (PartClip.left). The caller passes
 *    the layout without transient params (store.stripTransientParams): a
 *    held button is never copied held, and burn damage is telemetry, never
 *    a param.
 *  - wiresLeftLoose(layout, clip): what a cut takes besides the selection —
 *    the clip's wires left with no part on their strips.
 *  - planPaste(layout, clip, deps): the document with the copy in it. The
 *    hovered hole (deps.near: the top-left of the copied PARTS on it, a
 *    column or two either side), the clip's own spot (the originals were cut
 *    or deleted: they come back where they were — FIRST when the pointer
 *    rests on that spot, so click, Ctrl+X, Ctrl+V puts a part back), else
 *    the nearest free spot beside the source, left or right (a tie goes
 *    right), then the other half of the board, then other board-rows. What
 *    keeps the copy a copy:
 *      · ISOLATION: no strip of the copy is a strip the circuit already uses
 *        (validateLayout checks holes, not nets: without this a copy could
 *        share a 5-hole strip with the circuit and wire itself in) — except
 *        on its own spot, where it may join again exactly what it shared
 *        when it was taken (PartClip.rejoin), and where a wire of the clip
 *        still lying there (copy, then Delete: the Delete key leaves wires)
 *        is used again rather than doubled.
 *      · the strips keep their grouping: a vertical shift moves whole halves
 *        (0, or ±5 for a–e ↔ f–j; the hovered spot may also shift inside a
 *        half); packages move by columns only, and a part with a pin on a
 *        rail keeps its half and its board-row.
 *      · the RAILS stay the same nets: a wire's end on a rail takes the
 *        nearest free hole of the rail on the side (and board-row) its wire
 *        moved to when that rail is already one net with it (bridged by a
 *        wire), else of the very rail it was on — a longer wire, the last
 *        resort beside the source (another board-row's rail, or the other
 *        side's, is another net until a wire joins them).
 *      · CLEAR SPACE: the copy's footprint (pins + bodies) overlaps no part
 *        already there (its own spot excepted) — beside the source with a
 *        free column between first, then touching.
 *    A part or wire keeps its own id when nothing has it now (cut, paste:
 *    R5 stays R5), else takes deps.allocId's in the store's own scheme (R2,
 *    LED2, U2, W9); an off-board part takes deps.offboardPos or the default
 *    shelf; a scope probe re-picks the lowest free channel as addComponent
 *    does.
 *    validateLayout is the final judge (at most PASTE_VALIDATIONS full
 *    validations, then 'no-room').
 */
import { getEntry, type CatalogEntry } from '../model/catalog'
import {
  componentPinHoles,
  formatHole,
  holePosition,
  isHoleOnBoard,
  netIdForHole,
  netIdForTerminal,
  parseHole,
  parseTerminalRef,
  spansSeam,
} from '../model/breadboard'
import { occludedHoles } from '../model/occlusion'
import {
  BOARD_SIZES,
  MAX_BOARD_COUNT,
  MAX_BOARD_ROWS,
  STRIP_ROWS,
  boardConfigOf,
  type BoardConfig,
  type CircuitLayout,
  type ComponentInstance,
  type Hole,
  type HoleRef,
  type RailHole,
  type RailId,
  type StripHole,
  type Wire,
} from '../model/types'
import { validateLayout } from '../model/validate'

/** What Ctrl+C took: the parts and the wires that travel with them, under their SOURCE ids. */
export interface PartClip {
  /** deep copies of the copied parts, in layout order */
  components: ComponentInstance[]
  /** deep copies of the wires that come along, in layout order */
  wires: Wire[]
  /** the copied selection (source ids): its pasted counterparts are selected after a paste */
  sourceIds: string[]
  /**
   * The strips the clip shared with what stayed, and the holes the rest of
   * the circuit had in them then (strip net → hole refs). A paste on the
   * clip's own spot may join exactly those again — a cut, then a paste, puts
   * the parts back connected as they were; anything else there now refuses.
   */
  rejoin?: Readonly<Record<string, readonly string[]>>
  /** selected wires that do not come along (to a part that stays, rail to rail, a source's output to a rail) */
  left?: readonly string[]
}

/** The store's own rules a plan needs (store.pasteParts passes them). */
export interface PasteDeps {
  /** a free id in the store's scheme for a part of `type` (null = a wire, W*) */
  allocId(layout: CircuitLayout, type: string | null): string
  /** where a new off-board unit goes (null = its default-shelf slot) */
  offboardPos(layout: CircuitLayout, entry: CatalogEntry): { x: number; z: number } | null
  /** the hole under the pointer: the copy's top-left goes there when it fits */
  near?: HoleRef | null
}

/** A paste as a whole new document — or why there is none. */
export type PastePlan =
  | {
      ok: true
      layout: CircuitLayout
      /** the new parts' ids (layout order) */
      ids: string[]
      /** the new wires' ids */
      wireIds: string[]
      /** source id → new id (parts and wires) */
      renames: Readonly<Record<string, string>>
      /** what to select: the copied selection's counterparts */
      selection: string[]
      /** where it went: the hovered hole, the clip's own spot, or beside the source */
      where: PasteWhere
      /** the pointer was on a free hole, and the copy did not fit there (it went elsewhere) */
      nearMissed: boolean
    }
  | { ok: false; reason: 'empty' | 'no-room' }

export type PasteWhere = 'near' | 'home' | 'beside'

/** Full validateLayout passes one paste may spend before it says 'no-room'. */
export const PASTE_VALIDATIONS = 40
/** Search cost of moving to the other half of the board (in columns): small groups go right first. */
const HALF_SWAP_COST = 12
/** Search cost of another board-row (in columns). */
const BOARD_ROW_COST = 40
/** Search cost of a feed wire left on its far rail (a long wire over the board): the last resort. */
const LONG_FEED_COST = 1000

/** The rail on the other side of the board, same polarity (top+ ↔ bot+, top- ↔ bot-). */
const MIRROR: Readonly<Record<RailId, RailId>> = { 'top+': 'bot+', 'top-': 'bot-', 'bot+': 'top+', 'bot-': 'top-' }

/** An off-board unit's terminals that drive what they touch: a copy never ties a second one to a rail. */
const DRIVING_TERMINALS: Readonly<Record<string, readonly string[]>> = {
  power_supply: ['+'],
  function_generator: ['out'],
}

/** The documents planPaste made (the history names undoing one 「放上 …」 even on an empty board). */
const pastedLayouts = new WeakSet<CircuitLayout>()

/** Is `layout` a document a paste made (edit-feedback's history wording)? */
export function isPasteResult(layout: CircuitLayout): boolean {
  return pastedLayouts.has(layout)
}

/** The largest rig: a part's pin pattern resolves the same on every smaller one. */
const ANY_RIG: BoardConfig = { size: 'labxl', count: MAX_BOARD_COUNT, rows: MAX_BOARD_ROWS }

function cloneComponent(c: ComponentInstance): ComponentInstance {
  const out: ComponentInstance = { id: c.id, type: c.type }
  if (c.params) out.params = { ...c.params }
  if (c.holes) out.holes = [...c.holes]
  if (c.at !== undefined) out.at = c.at
  if (c.rotation !== undefined) out.rotation = c.rotation
  if (c.pos) out.pos = { ...c.pos }
  return out
}

const isPackage = (entry: CatalogEntry): boolean => entry.placement === 'dip' || entry.placement === 'footprint'

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/**
 * One wire end, seen from the copy: a terminal of a copied instrument (a
 * source's output: 'drive'), a strip holding a copied part's pin, a rail, a
 * strip with no pin at all, or something that stays behind (a strip of
 * another part, another instrument's terminal).
 */
type EndKind = 'term' | 'drive' | 'pin' | 'rail' | 'free' | 'foreign'

function wireTravels(a: EndKind, b: EndKind, selected: boolean): boolean {
  if (a === 'foreign' || b === 'foreign') return false
  const inner = (k: EndKind) => k === 'pin' || k === 'term' || k === 'drive'
  if (inner(a) && inner(b)) return true // between two copied parts
  // a copied part's power feed; a copied instrument's lead to a rail (a meter's COM, a generator's GND)
  const lead = (x: EndKind, y: EndKind) => (x === 'pin' || x === 'term') && y === 'rail'
  if (lead(a, b) || lead(b, a)) return true
  // never a rail-to-rail bridge, nor a source's output tied to a rail (a second source on it)
  if (a === 'rail' && (b === 'rail' || b === 'drive')) return false
  if (b === 'rail' && a === 'drive') return false
  return selected // a selected wire comes along
}

/**
 * The clip of `ids` on `layout` (pass it stripped of transient params), or
 * null when nothing in `ids` can be copied.
 */
export function clipFromSelection(layout: CircuitLayout, ids: readonly string[]): PartClip | null {
  const sel = new Set(ids)
  const config = boardConfigOf(layout)
  const components: ComponentInstance[] = []
  const copied = new Set<string>()
  for (const c of layout.components) {
    if (!sel.has(c.id)) continue
    const entry = getEntry(c.type)
    if (!entry || !componentPinHoles(c, entry, ANY_RIG)) continue // a malformed part is never copied
    components.push(cloneComponent(c))
    copied.add(c.id)
  }
  // strip net → whose pins it holds ('copied' wins: that strip comes along)
  const owner = new Map<string, 'copied' | 'foreign'>()
  for (const c of layout.components) {
    const entry = getEntry(c.type)
    if (!entry || entry.placement === 'offboard') continue
    for (const h of componentPinHoles(c, entry, config) ?? []) {
      if (h?.kind !== 'strip') continue
      const net = netIdForHole(h)
      if (copied.has(c.id)) owner.set(net, 'copied')
      else if (!owner.has(net)) owner.set(net, 'foreign')
    }
  }
  const typeOf = new Map(layout.components.map((c) => [c.id, c.type]))
  const kindOf = (ref: string): EndKind => {
    const h = parseHole(ref)
    if (h) {
      if (h.kind === 'rail') return 'rail'
      const o = owner.get(netIdForHole(h))
      return o === 'copied' ? 'pin' : (o ?? 'free')
    }
    const term = parseTerminalRef(ref)
    if (!term || !copied.has(term.componentId)) return 'foreign'
    return DRIVING_TERMINALS[typeOf.get(term.componentId) ?? '']?.includes(term.pin) ? 'drive' : 'term'
  }
  const travels = (w: Wire) => wireTravels(kindOf(w.from), kindOf(w.to), sel.has(w.id))
  const wires = layout.wires.filter(travels).map((w) => ({ ...w }))
  if (components.length === 0 && wires.length === 0) return null
  const left = layout.wires.filter((w) => sel.has(w.id) && !travels(w)).map((w) => w.id)
  const inClip = new Set([...copied, ...wires.map((w) => w.id)])
  // the strips the clip shares with what stays, and the holes in them that are not the clip's
  const holed: { id: string; holes: Hole[] }[] = [
    ...layout.components.map((c) => {
      const entry = getEntry(c.type)
      const holes = entry ? (componentPinHoles(c, entry, config) ?? []).filter((h): h is Hole => h !== null) : []
      return { id: c.id, holes }
    }),
    ...layout.wires.map((w) => ({ id: w.id, holes: [w.from, w.to].map(parseHole).filter((h): h is Hole => h !== null) })),
  ]
  const clipNets = new Set<string>()
  for (const x of holed) if (inClip.has(x.id)) for (const h of x.holes) if (h.kind === 'strip') clipNets.add(netIdForHole(h))
  const rejoin: Record<string, string[]> = {}
  for (const x of holed) {
    if (inClip.has(x.id)) continue
    for (const h of x.holes) {
      const net = h.kind === 'strip' ? netIdForHole(h) : null
      if (net && clipNets.has(net)) (rejoin[net] ??= []).push(formatHole(h))
    }
  }
  const clip: PartClip = { components, wires, sourceIds: [...sel].filter((id) => inClip.has(id)), rejoin }
  if (left.length > 0) clip.left = left
  return clip
}

/**
 * A cut (Ctrl+X) moves the wires that travel with the parts too: the clip's
 * wires that would hang loose once its parts are gone — no strip end on a
 * strip another part's pin is in. A power feed still serving a part that
 * stays is kept (taking it would change the circuit left behind).
 */
export function wiresLeftLoose(layout: CircuitLayout, clip: PartClip): string[] {
  const gone = new Set(clip.components.map((c) => c.id))
  const config = boardConfigOf(layout)
  const pinned = new Set<string>()
  for (const c of layout.components) {
    const entry = gone.has(c.id) ? undefined : getEntry(c.type)
    if (!entry || entry.placement === 'offboard') continue
    for (const h of componentPinHoles(c, entry, config) ?? []) if (h?.kind === 'strip') pinned.add(netIdForHole(h))
  }
  const inClip = new Set(clip.wires.map((w) => w.id))
  const loose = (end: string): boolean => {
    const h = parseHole(end)
    return h?.kind !== 'strip' || !pinned.has(netIdForHole(h))
  }
  return layout.wires.filter((w) => inClip.has(w.id) && loose(w.from) && loose(w.to)).map((w) => w.id)
}

// ---------------------------------------------------------------------------
// Paste
// ---------------------------------------------------------------------------

/** Where the group goes: whole columns, strip-row lattice steps, board-rows. */
interface Offset {
  dCol: number
  dRow: number
  dBoardRow: number
}

interface Box {
  x0: number
  x1: number
  z0: number
  z1: number
}

function boxOf(holes: Iterable<Hole>): Box | null {
  let box: Box | null = null
  for (const h of holes) {
    const p = holePosition(h)
    if (!box) box = { x0: p.x, x1: p.x, z0: p.z, z1: p.z }
    else {
      box.x0 = Math.min(box.x0, p.x)
      box.x1 = Math.max(box.x1, p.x)
      box.z0 = Math.min(box.z0, p.z)
      box.z1 = Math.max(box.z1, p.z)
    }
  }
  return box
}

/** `h` moved by the offset's rows and board-rows (columns: the caller), or null off the lattice. */
function shiftStrip(h: StripHole, dCol: number, dRow: number, dBoardRow: number): StripHole | null {
  const rowIdx = STRIP_ROWS.indexOf(h.row) + dRow
  const boardRow = (h.boardRow ?? 0) + dBoardRow
  const col = h.col + dCol
  if (rowIdx < 0 || rowIdx >= STRIP_ROWS.length || boardRow < 0 || col < 1) return null
  const row = STRIP_ROWS[rowIdx]
  return boardRow !== 0 ? { kind: 'strip', col, row, boardRow } : { kind: 'strip', col, row }
}

/**
 * Does a vertical shift of `d` strip rows keep the strips' grouping? Every
 * a–e hole must land in one half and every f–j hole in one half — the other
 * one when the group has both (a hole pair split across the channel stays
 * split, a strip stays one strip). `sameHalves`: a–e stays a–e and f–j
 * stays f–j (a group on a rail).
 */
function rowShiftKeepsStrips(rows: ReadonlySet<number>, d: number, sameHalves: boolean): boolean {
  let top: boolean | null = null // where the a–e holes land (true = a–e)
  let bottom: boolean | null = null // where the f–j holes land
  for (const r of rows) {
    const to = r + d
    if (to < 0 || to >= STRIP_ROWS.length) return false
    const landsTop = to < 5
    if (r < 5) {
      if (top === null) top = landsTop
      else if (top !== landsTop) return false
    } else if (bottom === null) bottom = landsTop
    else if (bottom !== landsTop) return false
  }
  if (sameHalves && (top === false || bottom === true)) return false
  return top === null || bottom === null || top !== bottom
}

/** A scope probe takes the lowest channel no probe uses yet (store.addComponent's rule; CH1 stays implicit). */
function rechannel(comp: ComponentInstance, layout: CircuitLayout): void {
  const used = new Set(
    layout.components.filter((c) => c.type === 'scope_probe').map((c) => Number(c.params?.channel ?? 1)),
  )
  const free = [1, 2, 3, 4].find((ch) => !used.has(ch))
  const params = { ...comp.params }
  if (free !== undefined && free !== 1) params.channel = free
  else delete params.channel
  if (Object.keys(params).length > 0) comp.params = params
  else delete comp.params
}

/**
 * The free hole of `src`'s rail (same board-row) whose x is nearest `x`, or
 * null when the rail is full. Rail hole i sits at x = 2.5 + i + ⌊i/5⌋.
 */
function nearestFreeRail(src: RailHole, x: number, count: number, free: (ref: string) => boolean): string | null {
  const guess = Math.max(0, Math.min(count - 1, Math.round(((x - 2.5) * 5) / 6)))
  let best: string | null = null
  let bestD = Infinity
  for (let d = 0; d < count; d++) {
    for (const i of d === 0 ? [guess] : [guess - d, guess + d]) {
      if (i < 0 || i >= count) continue
      const h: RailHole = src.boardRow ? { kind: 'rail', rail: src.rail, index: i, boardRow: src.boardRow } : { kind: 'rail', rail: src.rail, index: i }
      const dist = Math.abs(holePosition(h).x - x)
      if (dist >= bestD) continue
      const ref = formatHole(h)
      if (!free(ref)) continue
      best = ref
      bestD = dist
    }
    if (best !== null && d - 2 > bestD) break // every hole further out is further in x too
  }
  return best
}

/** Plan a paste of `clip` onto `layout` (see the file header). Pure. */
export function planPaste(layout: CircuitLayout, clip: PartClip, deps: PasteDeps): PastePlan {
  if (clip.components.length === 0 && clip.wires.length === 0) return { ok: false, reason: 'empty' }
  const config = boardConfigOf(layout)

  // ---- ids, settings and off-board spots (independent of where the board parts land)
  const renames: Record<string, string> = {}
  const fresh: { comp: ComponentInstance; entry: CatalogEntry; pins: Hole[]; body: Hole[] }[] = []
  let acc = layout
  /** The source's own id when nothing has it now (a cut, then a paste: R5 stays R5, W3 stays W3), else a new one. */
  const idFor = (l: CircuitLayout, srcId: string, type: string | null): string => {
    const lower = srcId.toLowerCase()
    const taken = l.components.some((c) => c.id.toLowerCase() === lower) || l.wires.some((w) => w.id.toLowerCase() === lower)
    return taken ? deps.allocId(l, type) : srcId
  }
  for (const src of clip.components) {
    const entry = getEntry(src.type)
    const pinHoles = entry ? componentPinHoles(src, entry, ANY_RIG) : null
    if (!entry || !pinHoles) continue
    const comp = cloneComponent(src)
    comp.id = idFor(acc, src.id, src.type)
    renames[src.id] = comp.id
    delete comp.pos // a copy never sits on its original's bench spot
    if (entry.placement === 'offboard') {
      const pos = deps.offboardPos(acc, entry)
      if (pos) comp.pos = pos
    }
    if (src.type === 'scope_probe') rechannel(comp, acc)
    const pins = pinHoles.filter((h): h is Hole => h !== null)
    const body = entry.placement === 'offboard' ? [] : [...occludedHoles(src, entry, ANY_RIG)].map(parseHole).filter((h): h is Hole => h !== null)
    fresh.push({ comp, entry, pins, body })
    acc = { ...acc, components: [...acc.components, comp] }
  }
  // wires: a terminal end follows its part to the new id (a wire whose part did not come is dropped)
  const freshWires: Wire[] = []
  const retarget = (ref: string): string | null => {
    if (parseHole(ref)) return ref
    const term = parseTerminalRef(ref)
    const id = term ? renames[term.componentId] : undefined
    return term && id ? `${id}:${term.pin}` : null
  }
  for (const src of clip.wires) {
    const from = retarget(src.from)
    const to = retarget(src.to)
    if (from === null || to === null) continue
    const w: Wire = { ...src, id: idFor(acc, src.id, null), from, to }
    renames[src.id] = w.id
    freshWires.push(w)
    acc = { ...acc, wires: [...acc.wires, w] }
  }
  if (fresh.length === 0 && freshWires.length === 0) return { ok: false, reason: 'empty' }

  // ---- the off-board units first: their spot does not depend on the board parts'
  const offboard = fresh.filter((f) => f.entry.placement === 'offboard').map((f) => f.comp)
  if (offboard.length > 0 && !validateLayout({ ...layout, components: [...layout.components, ...offboard] }).ok) {
    return { ok: false, reason: 'no-room' }
  }

  // ---- the group on the board: strip holes move; a part's pin on a rail and a wire's end on a rail re-find a free hole
  const strips = new Map<string, StripHole>()
  /** the copied parts' own strip holes (the hovered hole takes their top-left) */
  const partStrips: StripHole[] = []
  const railPins = new Map<string, RailHole>()
  /** a wire's end on a rail, and the wire's other end (null: an instrument's terminal) */
  const railEnds = new Map<string, { hole: RailHole; partner: Hole | null }>()
  for (const f of fresh) {
    for (const h of f.pins) {
      if (h.kind === 'rail') railPins.set(formatHole(h), h)
      else {
        strips.set(formatHole(h), h)
        partStrips.push(h)
      }
    }
  }
  for (const w of freshWires) {
    const ends = [parseHole(w.from), parseHole(w.to)]
    ends.forEach((h, i) => {
      if (h?.kind === 'strip') strips.set(formatHole(h), h)
      else if (h) railEnds.set(formatHole(h), { hole: h, partner: ends[1 - i] })
    })
  }
  const bodyHoles = fresh.flatMap((f) => f.body)

  // the circuit already there
  const occupied = new Set<string>()
  const blocked = new Set<string>()
  const obstacles: Box[] = []
  for (const c of layout.components) {
    const entry = getEntry(c.type)
    if (!entry || entry.placement === 'offboard') continue
    const pins = (componentPinHoles(c, entry, config) ?? []).filter((h): h is Hole => h !== null)
    const covered = [...occludedHoles(c, entry, config)]
    for (const h of pins) occupied.add(formatHole(h))
    for (const ref of covered) blocked.add(ref)
    const box = boxOf([...pins, ...covered.map(parseHole).filter((h): h is Hole => h !== null)])
    if (box) obstacles.push(box)
  }
  for (const w of layout.wires) {
    for (const end of [w.from, w.to]) {
      const h = parseHole(end)
      if (h) occupied.add(formatHole(h))
    }
  }
  /** strip net → the holes in use in it */
  const netHoles = new Map<string, string[]>()
  for (const ref of occupied) {
    const h = parseHole(ref)
    if (h?.kind !== 'strip') continue
    const net = netIdForHole(h)
    netHoles.set(net, [...(netHoles.get(net) ?? []), ref])
  }
  /** A strip the circuit uses (`free`: holes that do not count — a wire of the clip lying on its own spot). */
  const netInUse = (net: string, free?: ReadonlySet<string>): boolean => (netHoles.get(net) ?? []).some((ref) => !free?.has(ref))
  /** On its own spot the copy may join a strip again — when only what it shared then is in it. */
  const mayRejoin = (net: string, free?: ReadonlySet<string>): boolean => {
    const was = clip.rejoin?.[net]
    return !!was && (netHoles.get(net) ?? []).every((ref) => free?.has(ref) || was.includes(ref))
  }
  const HOME: Offset = { dCol: 0, dRow: 0, dBoardRow: 0 }
  const isHome = (o: Offset) => o.dCol === 0 && o.dRow === 0 && o.dBoardRow === 0

  // which rails the wires already join into one net (a feed may move to a rail that is)
  const parent = new Map<string, string>()
  const root = (n: string): string => {
    let r = n
    for (let p = parent.get(r); p !== undefined; p = parent.get(r)) r = p
    return r
  }
  let joined = false
  const endNet = (ref: string): string => {
    const h = parseHole(ref)
    if (h) return netIdForHole(h)
    const term = parseTerminalRef(ref)
    return term ? netIdForTerminal(term.componentId, term.pin) : ref
  }
  const oneNet = (a: RailHole, b: RailHole): boolean => {
    if (!joined) {
      joined = true
      for (const w of layout.wires) {
        const x = root(endNet(w.from))
        const y = root(endNet(w.to))
        if (x !== y) parent.set(x, y)
      }
    }
    return root(netIdForHole(a)) === root(netIdForHole(b))
  }
  /**
   * The rail a wire's rail end goes to for an offset: the one on the side
   * (and board-row) its wire moved to when that rail is one net with its
   * own, else its own (`long`: a longer wire back to it). Depends on the
   * rows and board-rows only.
   */
  const railTarget = (end: { hole: RailHole; partner: Hole | null }, o: Offset): { hole: RailHole; long: boolean } => {
    const h = end.hole
    const p = end.partner
    let rail = h.rail
    if (p?.kind === 'strip') {
      const from = STRIP_ROWS.indexOf(p.row)
      if (from < 5 !== from + o.dRow < 5) rail = MIRROR[rail] // its wire went to the other half
    }
    const boardRow = (h.boardRow ?? 0) + o.dBoardRow
    const to: RailHole = boardRow !== 0 ? { kind: 'rail', rail, index: h.index, boardRow } : { kind: 'rail', rail, index: h.index }
    if ((rail === h.rail && boardRow === (h.boardRow ?? 0)) || oneNet(h, to)) return { hole: to, long: false }
    return { hole: h, long: p?.kind === 'strip' }
  }

  const stripList = [...strips.values()]
  const railCount = BOARD_SIZES[config.size].railHoles * config.count
  const totalCols = BOARD_SIZES[config.size].cols * config.count
  const rowsOfRig = config.rows
  const hasPackage = fresh.some((f) => isPackage(f.entry))
  const railPinned = railPins.size > 0
  const rowSet = new Set(stripList.map((h) => STRIP_ROWS.indexOf(h.row)))

  /** Shift every strip hole, re-find every rail hole: source ref → new ref (null = it does not fit). */
  const placeHoles = (o: Offset, free?: ReadonlySet<string>): Map<string, string> | null => {
    const out = new Map<string, string>()
    const home = isHome(o)
    const inUse = (ref: string) => (occupied.has(ref) && !free?.has(ref)) || blocked.has(ref)
    for (const [ref, h] of strips) {
      const s = shiftStrip(h, o.dCol, o.dRow, o.dBoardRow)
      if (!s || !isHoleOnBoard(s, config)) return null
      const to = formatHole(s)
      if (inUse(to)) return null
      const net = netIdForHole(s)
      if (netInUse(net, free) && !(home && mayRejoin(net, free))) return null // ISOLATION
      out.set(ref, to)
    }
    const taken = new Set<string>()
    const putRail = (ref: string, on: RailHole, x: number): boolean => {
      const to = nearestFreeRail(on, x, railCount, (r) => !inUse(r) && !taken.has(r))
      if (to === null) return false
      taken.add(to)
      out.set(ref, to)
      return true
    }
    for (const [ref, h] of railPins) if (!putRail(ref, h, holePosition(h).x + o.dCol)) return null
    for (const [ref, end] of railEnds) if (!putRail(ref, railTarget(end, o).hole, holePosition(end.hole).x + o.dCol)) return null
    // the packages: never across a module seam, never a body over a hole in use
    for (const f of fresh) {
      if (!isPackage(f.entry)) continue
      const moved = f.pins.map((h) => (h.kind === 'strip' ? shiftStrip(h, o.dCol, 0, o.dBoardRow) : null))
      if (spansSeam(moved, config)) return null
    }
    for (const h of bodyHoles) {
      const s = h.kind === 'strip' ? shiftStrip(h, o.dCol, o.dRow, o.dBoardRow) : null
      if (s && occupied.has(formatHole(s)) && !free?.has(formatHole(s))) return null
    }
    return out
  }

  /** The candidate document for a placement (`skip`: the clip's wires already lying there). */
  const build = (o: Offset, holes: ReadonlyMap<string, string>, skip?: ReadonlyMap<string, string>): CircuitLayout => {
    const canon = (ref: string) => {
      const h = parseHole(ref)
      return h ? (holes.get(formatHole(h)) ?? ref) : ref
    }
    const comps = fresh.map(({ comp, entry }) => {
      if (entry.placement === 'offboard') return comp
      const next = { ...comp }
      if (comp.holes) next.holes = comp.holes.map(canon)
      if (comp.at !== undefined) {
        const at = parseHole(comp.at)
        const s = at?.kind === 'strip' ? shiftStrip(at, o.dCol, o.dRow, o.dBoardRow) : null
        if (s) next.at = formatHole(s)
      }
      return next
    })
    const wires = freshWires.filter((w) => !skip?.has(w.id)).map((w) => ({ ...w, from: canon(w.from), to: canon(w.to) }))
    return { ...layout, components: [...layout.components, ...comps], wires: [...layout.wires, ...wires] }
  }

  /** On its own spot: a wire of the clip still lying there (copy, then Delete — the Delete key leaves wires) is used again, not doubled. */
  interface Reuse {
    /** fresh wire id → the id of the wire lying there */
    wires: Map<string, string>
    /** its holes (they do not count as in use) */
    holes: Set<string>
  }
  const reuse: Reuse = { wires: new Map(), holes: new Set() }
  {
    const canonRef = (ref: string) => {
      const h = parseHole(ref)
      return h ? formatHole(h) : ref
    }
    const pairKey = (a: string, b: string) => [canonRef(a), canonRef(b)].sort().join('|')
    const lying = new Map(layout.wires.map((w) => [pairKey(w.from, w.to), w]))
    for (const w of freshWires) {
      const there = parseHole(w.from) && parseHole(w.to) ? lying.get(pairKey(w.from, w.to)) : undefined
      if (!there) continue
      reuse.wires.set(w.id, there.id)
      reuse.holes.add(canonRef(there.from)).add(canonRef(there.to))
    }
  }

  let budget = PASTE_VALIDATIONS
  const attempt = (o: Offset, with_?: Reuse): CircuitLayout | null => {
    const holes = placeHoles(o, with_?.holes)
    if (!holes) return null
    budget--
    const next = build(o, holes, with_?.wires)
    return validateLayout(next).ok ? next : null
  }

  let nearFree = false
  let nearOverHome = false
  const done = (next: CircuitLayout, where: PasteWhere, skip?: ReadonlyMap<string, string>): PastePlan => {
    const ids = fresh.map((f) => f.comp.id)
    const wireIds = freshWires.filter((w) => !skip?.has(w.id)).map((w) => w.id)
    const named: Record<string, string> = {}
    for (const [src, id] of Object.entries(renames)) named[src] = skip?.get(id) ?? id
    const picked = clip.sourceIds.map((id) => named[id]).filter((id): id is string => !!id)
    pastedLayouts.add(next)
    return {
      ok: true,
      layout: next,
      ids,
      wireIds,
      renames: named,
      selection: picked.length > 0 ? picked : [...ids, ...wireIds],
      where,
      nearMissed: nearFree && !nearOverHome && where !== 'near',
    }
  }

  // nothing on the board (instruments and the wires between them): one place to try
  if (stripList.length === 0 && railPins.size === 0 && railEnds.size === 0) {
    const next = attempt(HOME)
    return next ? done(next, 'home') : { ok: false, reason: 'no-room' }
  }

  // ---- the offsets that keep the group whole
  let minCol = Infinity
  let maxCol = -Infinity
  let minBr = Infinity
  let maxBr = -Infinity
  for (const h of stripList) {
    minCol = Math.min(minCol, h.col)
    maxCol = Math.max(maxCol, h.col)
  }
  const railHoles = [...railPins.values(), ...[...railEnds.values()].map((e) => e.hole)]
  for (const h of [...stripList, ...railHoles]) {
    minBr = Math.min(minBr, h.boardRow ?? 0)
    maxBr = Math.max(maxBr, h.boardRow ?? 0)
  }
  let dColLo: number
  let dColHi: number
  if (stripList.length > 0) {
    dColLo = 1 - minCol
    dColHi = totalCols - maxCol
  } else {
    // only rail holes (a decoupling capacitor across the rails, a meter's COM lead): keep them over the rails
    const xs = railHoles.map((h) => holePosition(h).x)
    const lastX = holePosition({ kind: 'rail', rail: 'top+', index: railCount - 1 }).x
    dColLo = Math.ceil(2.5 - Math.min(...xs))
    dColHi = Math.floor(lastX - Math.max(...xs))
  }
  // a part with a pin on a rail keeps its half and board-row; a wire's rail end follows (railTarget)
  const brOffsets: number[] = []
  for (let d = -minBr; d <= rowsOfRig - 1 - maxBr; d++) if (!railPinned || d === 0) brOffsets.push(d)
  const besideRows = [0, 5, -5].filter(
    (d) => d === 0 || (stripList.length > 0 && !hasPackage && !railPinned && rowShiftKeepsStrips(rowSet, d, false)),
  )

  // the box of the copy's footprint (part pins, bodies, its wires' strip ends) for a vertical shift, at dCol 0
  const boxes = new Map<string, Box | null>()
  const groupBox = (dRow: number, dBoardRow: number): Box | null => {
    const key = `${dRow}:${dBoardRow}`
    if (!boxes.has(key)) {
      const holes: Hole[] = [...railPins.values()]
      for (const h of [...stripList, ...bodyHoles]) {
        if (h.kind === 'strip') {
          const s = shiftStrip(h, 0, dRow, dBoardRow)
          if (s) holes.push(s)
        } else holes.push(h)
      }
      boxes.set(key, boxOf(holes))
    }
    return boxes.get(key) ?? null
  }
  // the parts already there, binned by columns: a check looks at its neighbours only (big rigs)
  const BIN = 8
  const bins = new Map<number, Box[]>()
  for (const ob of obstacles) {
    for (let k = Math.floor(ob.x0 / BIN); k <= Math.floor(ob.x1 / BIN); k++) {
      const bin = bins.get(k)
      if (bin) bin.push(ob)
      else bins.set(k, [ob])
    }
  }
  /** The copy keeps clear of every part already there (`margin`: free columns between). */
  const clear = (o: Offset, margin: number): boolean => {
    const b = groupBox(o.dRow, o.dBoardRow)
    if (!b) return true
    const x0 = b.x0 + o.dCol - margin
    const x1 = b.x1 + o.dCol + margin
    for (let k = Math.floor(x0 / BIN); k <= Math.floor(x1 / BIN); k++) {
      for (const ob of bins.get(k) ?? []) if (x0 <= ob.x1 && x1 >= ob.x0 && b.z0 <= ob.z1 && b.z1 >= ob.z0) return false
    }
    return true
  }
  /** A feed wire left on its far rail for this offset (rows and board-rows only). */
  const longs = new Map<string, boolean>()
  const isLong = (o: Offset): boolean => {
    const key = `${o.dRow}:${o.dBoardRow}`
    let long = longs.get(key)
    if (long === undefined) {
      long = [...railEnds.values()].some((end) => railTarget(end, o).long)
      longs.set(key, long)
    }
    return long
  }

  // ---- the pointer: a free hole (a copy that does not fit there says so), or the clip's own spot
  const near = deps.near ? parseHole(deps.near) : null
  if (near?.kind === 'strip' && isHoleOnBoard(near, config)) {
    const ref = formatHole(near)
    nearFree = !occupied.has(ref) && !blocked.has(ref) && !netInUse(netIdForHole(near))
  }
  const homeBox = groupBox(0, 0)
  if (near && homeBox) {
    const p = holePosition(near)
    nearOverHome = p.x >= homeBox.x0 - 1 && p.x <= homeBox.x1 + 1 && p.z >= homeBox.z0 - 1.5 && p.z <= homeBox.z1 + 1.5
  }
  const homeFits = brOffsets.includes(0) && dColLo <= 0 && dColHi >= 0
  const tryHome = (): CircuitLayout | null => (budget > 0 && homeFits ? attempt(HOME, reuse) : null)

  // ---- 1. the pointer resting on the clip's own spot (click, Ctrl+X, Ctrl+V): back where it was, joined as it was
  if (nearOverHome) {
    const next = tryHome()
    if (next) return done(next, 'home', reuse.wires)
  }

  // ---- 2. the hovered hole: the copied parts' top-left there (a column or two either side)
  const anchorHoles = partStrips.length > 0 ? partStrips : stripList
  if (near && anchorHoles.length > 0) {
    const aBr = Math.min(...anchorHoles.map((h) => h.boardRow ?? 0))
    const top = anchorHoles.filter((h) => (h.boardRow ?? 0) === aBr)
    const aCol = Math.min(...top.map((h) => h.col))
    const aRow = Math.min(...top.map((h) => STRIP_ROWS.indexOf(h.row)))
    const wantCol = (near.kind === 'strip' ? near.col : Math.round(holePosition(near).x)) - aCol
    const wantRow = near.kind === 'strip' ? STRIP_ROWS.indexOf(near.row) - aRow : 0
    const dBoardRow = (near.boardRow ?? 0) - aBr
    const rowOptions = hasPackage
      ? [0]
      : Array.from({ length: 19 }, (_, i) => i - 9).filter((d) => rowShiftKeepsStrips(rowSet, d, railPinned))
    const dRow = rowOptions.reduce((a, b) => (Math.abs(b - wantRow) < Math.abs(a - wantRow) ? b : a), 0)
    if (brOffsets.includes(dBoardRow)) {
      for (const k of [0, 1, -1, 2, -2]) {
        if (budget <= 0) break
        const o = { dCol: wantCol + k, dRow, dBoardRow }
        if (o.dCol < dColLo || o.dCol > dColHi || !clear(o, 0)) continue
        const next = attempt(o)
        if (next) return done(next, 'near')
      }
    }
  }

  // ---- 3. its own spot (the originals were cut or deleted): back where it was, joined as it was
  if (!nearOverHome) {
    const next = tryHome()
    if (next) return done(next, 'home', reuse.wires)
  }

  // ---- 4. beside the source: nearest first (a tie goes right, then down); a long feed wire last
  const offsets: Offset[] = []
  for (const dBoardRow of brOffsets) {
    for (const dRow of besideRows) {
      for (let dCol = dColLo; dCol <= dColHi; dCol++) offsets.push({ dCol, dRow, dBoardRow })
    }
  }
  const cost = (o: Offset) => Math.abs(o.dCol) + (o.dRow !== 0 ? HALF_SWAP_COST : 0) + Math.abs(o.dBoardRow) * BOARD_ROW_COST
  const rank = (o: Offset) => (o.dBoardRow !== 0 ? 8 : 0) + (o.dCol < 0 ? 4 : 0) + (o.dRow < 0 ? 2 : 0) + (o.dBoardRow < 0 ? 1 : 0)
  offsets.sort((a, b) => cost(a) - cost(b) || rank(a) - rank(b))
  const tiers = [offsets.filter((o) => !isLong(o)), offsets.filter((o) => isLong(o))]
  // the hole checks first (a few lookups; the same for either margin), the box against every part after
  const fits = new Map<Offset, Map<string, string> | null>()
  for (const tier of tiers) {
    for (const margin of [1, 0]) {
      for (const o of tier) {
        if (budget <= 0) return { ok: false, reason: 'no-room' }
        if (isHome(o)) continue
        let holes = fits.get(o)
        if (holes === undefined) fits.set(o, (holes = placeHoles(o)))
        if (!holes || !clear(o, margin)) continue
        budget--
        const next = build(o, holes)
        if (validateLayout(next).ok) return done(next, 'beside')
      }
    }
  }
  return { ok: false, reason: 'no-room' }
}

/**
 * Terminal currents of every simulated element, computed FROM THE STAMPS
 * (顯示電流 / ComponentTelemetry.pinCurrents — contract C2).
 *
 * The MNA matrix is a pure conductance matrix (src/sim/mna.ts): row n of the
 * stamped system says Σ_elements (A_e·x − b_e)_n = 0, and each element's own
 * share (A_e·x − b_e)_n is exactly the current that element takes OUT of node
 * n — i.e. the current flowing INTO the element at that node. So:
 *
 *  - Devices: StampRecorder sits between the devices and the real system on a
 *    tracked step. It forwards every call UNCHANGED (same calls, same order —
 *    the solution stays bit-identical, like the engine's DiagStampCtx) and
 *    keeps the final Newton iteration's stamps per device; after the solve
 *    they are evaluated at the solution x. A device pin on the 0 V reference
 *    node has no matrix row: it takes the device's KCL residual (−Σ of its
 *    other pin currents).
 *  - Pins of one device on the SAME node: the stamps name nodes, not pins,
 *    so they cannot tell those pins apart (a DIP switch's eight commons on
 *    one rail, a pot wired as a rheostat, a diode-connected transistor, an
 *    optocoupler's cathode and emitter both on 0 V). Such a device books its
 *    own terminal currents (AnalogDevice.terminalCurrents: its last stamp's
 *    branches evaluated at x — the same currents, per pin); a device without
 *    that hook publishes NaN = unknown for every pin on such a node that
 *    received a nonzero contribution of its stamps (an exact 0 stays 0: a
 *    resistor shorted by its own strip carries nothing). Never a share.
 *    Only legs the catalog joins INSIDE the part (internalBridges — a
 *    pushbutton's A1/A2, a 7-segment's COM1/COM2, a module's GND pins) are
 *    one conductor: the part's current at it is booked equally on its legs
 *    and the wire model's bridge edge (./wire-currents.ts) carries the
 *    difference, so every drawn wire and strip is the copper model's own
 *    answer (chips do the same with their bridged supply pins).
 *  - Chips: their drives are plain conductances the engine stamps itself, so
 *    the currents are computed from the drive arrays and x directly. A CMOS
 *    stage (drivePinStageAt) returns its current through the chip's own rail
 *    pins (KCL-exact).
 *  - Norton drives (drivePin / drivePinAt: every legacy chip — 555, 74xx,
 *    CD40xx, LM358 —, a module output behind its internal regulator, the UART
 *    terminal's USB-TTL adapter on an MCU pin) return through the 0 V
 *    reference in the SOLVER. On a real chip that current flows through its
 *    supply pins, so the display books it there (the solution is untouched):
 *    a SOURCING output's current enters through the chip's supply pin
 *    (VCC / VDD; a module's own supply pin; the adapter's GND lead on the
 *    board's GND), a SINKING output's current leaves through its ground pin
 *    (GND / VSS). When that pin sits on another net than the 0 V one, the
 *    current continues through the STIFF element(s) holding that net
 *    against 0 V — a Thevenin source (bench supply, battery …, found from
 *    the recorded stamps; parallel sources share it by conductance) or, for
 *    a sourcing return, a voltage regulator's pass element (in → out: an
 *    LM7805 fed from a battery, the Blue Pill's 3.3 V LDO behind the 5V
 *    pin) — so the + wire carries what the − wire carries. Only stiff
 *    elements: their voltages do not depend on the extra current, so the
 *    picture never contradicts a voltage the solver computed. Where no such
 *    path exists (a chip fed through a resistor or a meter, a floating
 *    supply pin) the loop cannot be closed honestly: the current stays
 *    booked on the reference and the chip's supply and ground pins publish
 *    NaN = unknown for that window and HOLD_S of simulated time after it
 *    (a stray leak below KCL_HIDE_A does not count).
 *
 * Never a broken loop (drain → conceal): a net with an unknown pin current,
 * or whose pin currents miss Kirchhoff's current law by more than
 * KCL_HIDE_A, is hidden — and so is every part that pushes a visible
 * current (≥ KCL_HIDE_A) into a hidden net, with every net that part pushes
 * a visible current into, until the hidden region exchanges no visible
 * current with the rest. Hidden pins publish NaN = unknown; the wire model
 * (./wire-currents.ts) shows nothing on a net with an unknown pin. A learner
 * therefore never sees current leave a chip and vanish into a dark rail:
 * an unattributable circuit shows nothing at all, a closed one everything.
 *
 * Every tracked step adds I·dt to per-pin integrals; `drain()` returns the
 * mean over the window since the previous drain (the frame interval), so a
 * PWM-driven LED shows its average current, exactly what an ammeter would
 * read. With no step since the last drain the previous means are repeated
 * (a paused simulation keeps its last picture).
 *
 * Zero allocation per step once the buffers have grown to the circuit's size.
 */
import type { StampContext } from '../mna'

/** Node index of the 0 V reference (mirrors engine GROUND_NODE). */
const GROUND = -1
/** Unmapped pin (mirrors engine NO_NODE). */
const NO_NODE = -2
/** Longest chain of sources a Norton current is carried through to 0 V (stacked supplies, regulator + battery). */
const MAX_HOPS = 3
/**
 * A net whose pin currents miss KCL by more than this is hidden (A), and a
 * pin carrying at least this much makes its part and its net share a
 * neighbour's fate (conceal). Half the flow layer's visibility floor
 * (MIN_SHOWN_A = 5 µA): an imbalance or a crossing that could draw a
 * particle is hidden. The solver's own unbooked leak is GMIN (1 nS per
 * node, ≤ 12 nA per node at 12 V — ~0.1 µA in the largest bundled example),
 * far below it.
 */
export const KCL_HIDE_A = 2.5e-6
/**
 * Simulated seconds a chip stays concealed after its last unattributable
 * window: longer than a blinker's period, so a circuit that cannot be shown
 * whole stays dark instead of flickering in step with its own output.
 */
const HOLD_S = 3
/** Device model of a regulator's pass element (pins [in, out, gnd], src/sim/devices.ts LdoDevice). */
const PASS_MODEL = 'ldo'

// entry kinds
const K_ELEMENT = 0 // A[row][col] += val
const K_CONDUCT = 1 // conductance val between row and col
const K_CURRENT = 2 // b[row] += val

/**
 * StampContext proxy: forwards every call to `target` unchanged and records
 * the calls of the current `owner` (≥ 0). `begin()` drops the previous
 * iteration's record (only the final Newton linearization is kept).
 */
export class StampRecorder implements StampContext {
  /** device index whose stamps are being recorded; −1 = forward only */
  owner = -1
  /** number of recorded entries */
  count = 0
  kind: Uint8Array = new Uint8Array(64)
  row: Int32Array = new Int32Array(64)
  col: Int32Array = new Int32Array(64)
  val: Float64Array = new Float64Array(64)
  own: Int32Array = new Int32Array(64)
  /**
   * Thevenin sources of the current pass, per device (addNorton): its two
   * nodes and conductance (0 = the device stamped no source). Sized by the
   * tracker (sourceSlots); the final Newton iteration's record is kept.
   */
  srcPlus: Int32Array = new Int32Array(0)
  srcMinus: Int32Array = new Int32Array(0)
  srcG: Float64Array = new Float64Array(0)
  /**
   * per device: 1 = also record its 0 V-row entries (they have no matrix
   * row; the tracker only checks them for a nonzero contribution — a device
   * with pins of two terminals on the 0 V net and no terminalCurrents hook)
   */
  groundRows: Uint8Array = new Uint8Array(0)
  private target: StampContext

  constructor(target: StampContext) {
    this.target = target
  }

  get nodeCount(): number {
    return this.target.nodeCount
  }

  /** Start a fresh stamping pass that forwards to `target`. */
  begin(target: StampContext): void {
    this.target = target
    this.count = 0
    this.owner = -1
    this.srcG.fill(0)
  }

  /** Size the per-device source record (the tracker's device count). */
  sourceSlots(n: number): void {
    this.srcPlus = new Int32Array(n)
    this.srcMinus = new Int32Array(n)
    this.srcG = new Float64Array(n)
    this.groundRows = new Uint8Array(n)
  }

  /** the current owner's 0 V-row entries are recorded too (groundRows) */
  private ground(): boolean {
    const o = this.owner
    return o >= 0 && o < this.groundRows.length && this.groundRows[o] === 1
  }

  addElement(row: number, col: number, value: number): void {
    this.target.addElement(row, col, value)
    if (this.owner >= 0 && col >= 0 && (row >= 0 || this.ground())) this.push(K_ELEMENT, row < 0 ? GROUND : row, col, value)
  }

  addConductance(a: number, b: number, g: number): void {
    this.target.addConductance(a, b, g)
    if (this.owner >= 0) this.push(K_CONDUCT, a, b, g)
  }

  addCurrent(node: number, current: number): void {
    this.target.addCurrent(node, current)
    if (this.owner >= 0 && (node >= 0 || this.ground())) this.push(K_CURRENT, node < 0 ? GROUND : node, -1, current)
  }

  addNorton(plus: number, minus: number, v: number, rout: number): void {
    this.target.addNorton(plus, minus, v, rout)
    if (this.owner < 0) return
    // exactly MnaSystem.addNorton's decomposition
    const r = rout > 1e-6 ? rout : 1e-6
    const g = 1 / r
    const o = this.owner
    if (o < this.srcG.length && plus !== minus) {
      this.srcPlus[o] = plus
      this.srcMinus[o] = minus
      this.srcG[o] = g
    }
    this.push(K_CONDUCT, plus, minus, g)
    const gnd = this.ground()
    if (plus >= 0 || gnd) this.push(K_CURRENT, plus < 0 ? GROUND : plus, -1, v * g)
    if (minus >= 0 || gnd) this.push(K_CURRENT, minus < 0 ? GROUND : minus, -1, -v * g)
  }

  private push(kind: number, row: number, col: number, val: number): void {
    const i = this.count
    if (i >= this.kind.length) this.grow()
    this.kind[i] = kind
    this.row[i] = row
    this.col[i] = col
    this.val[i] = val
    this.own[i] = this.owner
    this.count = i + 1
  }

  private grow(): void {
    const n = this.kind.length * 2
    const kind = new Uint8Array(n)
    kind.set(this.kind)
    const row = new Int32Array(n)
    row.set(this.row)
    const col = new Int32Array(n)
    col.set(this.col)
    const val = new Float64Array(n)
    val.set(this.val)
    const own = new Int32Array(n)
    own.set(this.own)
    this.kind = kind
    this.row = row
    this.col = col
    this.val = val
    this.own = own
  }
}

/** One device as the tracker sees it: its pin nodes and the part-pin slot each pin feeds. */
export interface TrackedDevice {
  /** solver node per device pin (−1 = 0 V reference) */
  nodes: ArrayLike<number>
  /** global part-pin slot per device pin (−1: an internal sub-circuit node, not a catalog pin) */
  slots: ArrayLike<number>
  /**
   * Optional: the device model (CatalogEntry.sim.model or the
   * SubcircuitElement's model). 'ldo' (pins [in, out, gnd]) is a
   * regulator's pass element: a chip's sourcing return current is carried
   * through it, in → out, to whatever feeds its input. A regulator inside a
   * chip part (the Blue Pill's REG) is also found from the chip's catalog
   * entry without it.
   */
  model?: string
  /**
   * Optional: per device pin, its terminal — pins with the same value are
   * ONE conductor inside the part (catalog internalBridges: a pushbutton's
   * A1/A2, a 7-segment's COM1/COM2), always on one net. Default: every pin
   * its own terminal.
   */
  terminal?: ArrayLike<number>
  /**
   * Optional (AnalogDevice.terminalCurrents): add the current INTO each
   * device pin — out[off + k] for nodes[k], A; NaN = not booked by the
   * model — under the device's last stamp evaluated at the solution x (out
   * is zeroed first). Used only while pins of two terminals of the device
   * share a node, to split that node's exact total (see split()).
   */
  terminalCurrents?: (x: Float64Array, out: Float64Array, off: number) => void
}

/** devMode: every node of the device holds pins of one terminal — its stamps are exact per pin */
const MODE_EXACT = 0
/** devMode: two terminals share a node; the device books its own pins (terminalCurrents) */
const MODE_HOOK = 1
/** devMode: two terminals share a node and no hook: a nonzero contribution there makes its pins unknown */
const MODE_UNKNOWN = 2

/** The drive state of a chip runtime (engine ChipRuntime, structurally). */
export interface TrackedChipDrives {
  readonly pinNodes: Int32Array
  readonly driveG: Float64Array
  readonly driveV: Float64Array
  readonly stageUp: Float64Array | null
  readonly stageDown: Float64Array | null
  readonly railHiNode: number
  readonly railLoNode: number
  /** catalog pin index of the stage's high / low rail (−1 = none) */
  readonly railHiIdx: number
  readonly railLoIdx: number
  /**
   * Optional (the engine's ChipRuntime has both): the part's catalog entry
   * and the chip model — where a Norton drive's current really returns
   * (nortonReturnPins, see the file header).
   */
  readonly entry?: TrackedEntry
  readonly chip?: unknown
}

/** The catalog fields the tracker reads (CatalogEntry, structurally). */
export interface TrackedEntry {
  readonly pins: readonly string[]
  readonly supplyPins?: { readonly plus: readonly string[]; readonly minus: readonly string[] }
  /** an MCU board: its Norton drive is the UART terminal's USB-TTL adapter */
  readonly mcu?: { readonly gndPin?: string }
  /** on-board analog parts (a regulator 'ldo' among them: a pass element, see TrackedDevice.model) */
  readonly subcircuit?: readonly { readonly model: string; readonly pins: readonly string[] }[]
}

/** Legacy supply / ground pin names (the engine's power checks use VCC / VDD too). */
const HI_NAMES = ['VCC', 'VDD', 'V+']
const LO_NAMES = ['GND', 'VSS', 'V-', 'V−', 'VEE']

/**
 * Catalog pin indices a Norton drive's current returns through: [sourcing,
 * sinking] (−1 = none known). See the file header.
 */
export function nortonReturnPins(d: TrackedChipDrives): [number, number] {
  const e = d.entry
  const pins = e?.pins ?? []
  const first = (names: readonly string[]): number => {
    for (const n of names) {
      const i = pins.indexOf(n)
      if (i >= 0) return i
    }
    return -1
  }
  const chip = (d.chip ?? null) as { supplyIdx?: unknown; groundIdx?: unknown; gndIdx?: unknown } | null
  const num = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < pins.length ? v : -1)
  let lo = num(chip?.groundIdx)
  if (lo < 0) lo = num(chip?.gndIdx)
  if (lo < 0 && e?.mcu?.gndPin) lo = pins.indexOf(e.mcu.gndPin)
  if (lo < 0 && e?.supplyPins) lo = first(e.supplyPins.minus)
  if (lo < 0) lo = first(LO_NAMES)
  if (lo < 0) lo = d.railLoIdx
  // an MCU board's Norton drive is the USB-TTL adapter (USB-powered, its GND
  // lead on the board's GND): its current enters and leaves there
  if (e?.mcu) return [lo, lo]
  let hi = num(chip?.supplyIdx) // a module: its own supply pin (behind its regulator)
  if (hi < 0 && e?.supplyPins) hi = first(e.supplyPins.plus)
  if (hi < 0) hi = first(HI_NAMES)
  if (hi < 0) hi = d.railHiIdx
  return [hi, lo]
}

export interface TrackedChip {
  drives: TrackedChipDrives
  /** global part-pin slot of catalog pin 0 (pins are consecutive) */
  base: number
}

/** Means published by drain(). */
export interface CurrentMeans {
  /**
   * mean current INTO the part per global part-pin slot (A); NaN = unknown
   * (not attributable, or concealed so that no broken loop shows)
   */
  pins: Float64Array
  /**
   * mean current the 0 V reference injects INTO the ground net (A): what no
   * pin could be credited with — a Norton current without an honest return
   * path (its chip's rails then publish NaN) or a device stamping against
   * the reference without a pin on the 0 V net (negative = the reference
   * absorbs it). ≈ 0 for every circuit whose loops close.
   */
  ref: number
  /** sim time span the means cover (s; 0 = repeated from an earlier window) */
  span: number
}

export class CurrentTracker {
  readonly recorder: StampRecorder
  private readonly devStart: Int32Array
  private readonly devNode: Int32Array
  private readonly devSlot: Int32Array
  private readonly devTmp: Float64Array
  /** per device pin: its terminal (TrackedDevice.terminal; default its own index) */
  private readonly devTerm: Int32Array
  /** per device pin: 1 = its node holds pins of two or more terminals of the device (the stamps cannot split it) */
  private readonly devAmb: Uint8Array
  /** per device pin, this step (MODE_UNKNOWN): a nonzero contribution landed on its ambiguous node */
  private readonly devBad: Uint8Array
  /** split(): the hook's values and the nodes already split, per device pin */
  private readonly hookTmp: Float64Array
  private readonly devSeen: Uint8Array
  /** per device: MODE_EXACT / MODE_HOOK / MODE_UNKNOWN */
  private readonly devMode: Uint8Array
  /** per device: its terminalCurrents hook (MODE_HOOK only) */
  private readonly hooks: (((x: Float64Array, out: Float64Array, off: number) => void) | null)[]
  private readonly chips: TrackedChip[]
  private readonly acc: Float64Array
  /**
   * per chip: the Norton charge (Σ |I|·dt) this window that had no honest
   * return path; a mean of KCL_HIDE_A or more makes its rail pins unknown
   * (a stray pA–nA leak of an idle output stays booked on the reference)
   */
  private readonly unrouted: Float64Array
  /**
   * per chip: simulated seconds its rails stay unknown after the last window
   * with an unattributable current (HOLD_S). A 555 whose sourcing phase has
   * no path would otherwise show particles only while its LED is dark —
   * a picture that says the opposite of what happens.
   */
  private readonly hold: Float64Array
  /** per chip: the Norton return pins, sourcing / sinking (catalog index, −1 = none) */
  private readonly nortonHi: Int32Array
  private readonly nortonLo: Int32Array
  /**
   * This step's source chains, one per distinct return net (the search runs
   * once per net and step, the charge is credited once at the end): the net,
   * its hop count (−1 = no chain), the hops and the charge to carry.
   */
  private readonly pendNode: Int32Array
  /** 1 = the chain carries a sourcing return (regulator pass elements allowed), 0 = sinking */
  private readonly pendSrc: Uint8Array
  private readonly pendHops: Int32Array
  private readonly pendFrom: Int32Array
  private readonly pendTo: Int32Array
  private readonly pendQ: Float64Array
  private pendN = 0
  /** breadth-first scratch (no allocation per step) */
  private readonly visit: Int32Array
  private readonly via: Int32Array
  /** per device: a regulator pass element's in / out node (NO_NODE = not one) */
  private readonly passIn: Int32Array
  private readonly passOut: Int32Array
  /**
   * conceal (drain): solver node per slot (NO_NODE = unmapped), the part
   * group per slot (slots joined by a device or a chip), and CSR lists
   * node → slots (index node + 1: the 0 V node is 0) and group → slots.
   */
  private readonly slotNode: Int32Array
  private readonly slotGroup: Int32Array
  private readonly nodeStart: Int32Array
  private readonly nodeSlots: Int32Array
  private readonly groupStart: Int32Array
  private readonly groupSlots: Int32Array
  private readonly hidNode: Uint8Array
  private readonly hidGroup: Uint8Array
  /** work queue of the conceal pass: node entries ≥ 0 (index node + 1), group entries −1 − g */
  private readonly work: Int32Array
  private accRef = 0
  private accT = 0
  private readonly means: CurrentMeans
  private haveMeans = false

  constructor(target: StampContext, devices: TrackedDevice[], chips: TrackedChip[], slotCount: number) {
    this.recorder = new StampRecorder(target)
    const nDev = devices.length
    this.devStart = new Int32Array(nDev + 1)
    let total = 0
    for (let i = 0; i < nDev; i++) {
      this.devStart[i] = total
      total += devices[i].nodes.length
    }
    this.devStart[nDev] = total
    this.devNode = new Int32Array(total)
    this.devSlot = new Int32Array(total)
    this.devTmp = new Float64Array(total)
    this.devTerm = new Int32Array(total)
    this.devAmb = new Uint8Array(total)
    this.devBad = new Uint8Array(total)
    this.hookTmp = new Float64Array(total)
    this.devSeen = new Uint8Array(total)
    this.devMode = new Uint8Array(nDev)
    this.hooks = new Array(nDev).fill(null)
    this.recorder.sourceSlots(nDev)
    for (let i = 0; i < nDev; i++) {
      const d = devices[i]
      const s = this.devStart[i]
      const n = d.nodes.length
      for (let k = 0; k < n; k++) {
        this.devNode[s + k] = d.nodes[k]
        this.devSlot[s + k] = k < d.slots.length ? d.slots[k] : -1
        const t = d.terminal && k < d.terminal.length ? d.terminal[k] : k
        this.devTerm[s + k] = Number.isInteger(t) ? t : k
      }
      // a node holding pins of two terminals, one of them published: the stamps cannot split it
      let amb = false
      for (let p = s; p < s + n; p++) {
        const node = this.devNode[p]
        if (node < GROUND) continue
        let published = false
        let twoTerminals = false
        for (let q = s; q < s + n; q++) {
          if (this.devNode[q] !== node) continue
          if (this.devSlot[q] >= 0) published = true
          if (this.devTerm[q] !== this.devTerm[p]) twoTerminals = true
        }
        if (published && twoTerminals) {
          this.devAmb[p] = 1
          amb = true
        }
      }
      if (!amb) continue
      if (typeof d.terminalCurrents === 'function') {
        this.devMode[i] = MODE_HOOK
        this.hooks[i] = d.terminalCurrents
      } else {
        this.devMode[i] = MODE_UNKNOWN
        // its 0 V-row entries decide whether its pins on the 0 V net are known
        for (let p = s; p < s + n; p++) if (this.devAmb[p] && this.devNode[p] === GROUND) this.recorder.groundRows[i] = 1
      }
    }
    this.chips = chips
    this.acc = new Float64Array(slotCount)
    this.unrouted = new Float64Array(chips.length)
    this.hold = new Float64Array(chips.length)
    this.means = { pins: new Float64Array(slotCount), ref: 0, span: 0 }
    this.nortonHi = new Int32Array(chips.length)
    this.nortonLo = new Int32Array(chips.length)
    for (let c = 0; c < chips.length; c++) {
      const [hi, lo] = nortonReturnPins(chips[c].drives)
      this.nortonHi[c] = hi
      this.nortonLo[c] = lo
    }
    const cap = 2 * chips.length + 2
    this.pendNode = new Int32Array(cap)
    this.pendSrc = new Uint8Array(cap)
    this.pendHops = new Int32Array(cap)
    this.pendFrom = new Int32Array(cap * MAX_HOPS)
    this.pendTo = new Int32Array(cap * MAX_HOPS)
    this.pendQ = new Float64Array(cap)
    this.visit = new Int32Array(2 * nDev + 2)
    this.via = new Int32Array(2 * nDev + 2)

    // regulator pass elements: by model, or a chip part's own 'ldo' sub-circuit element (matched by its slots)
    this.passIn = new Int32Array(nDev).fill(NO_NODE)
    this.passOut = new Int32Array(nDev).fill(NO_NODE)
    const markPass = (e: number): void => {
      const s = this.devStart[e]
      if (this.devStart[e + 1] - s < 2) return
      const a = this.devNode[s]
      const b = this.devNode[s + 1]
      if (a <= NO_NODE || b <= NO_NODE || a === b) return
      this.passIn[e] = a
      this.passOut[e] = b
    }
    for (let e = 0; e < nDev; e++) if (devices[e].model === PASS_MODEL) markPass(e)
    for (const ch of chips) {
      const entry = ch.drives.entry
      for (const el of entry?.subcircuit ?? []) {
        if (el.model !== PASS_MODEL || el.pins.length < 2) continue
        const want = el.pins.map((p) => {
          const i = p.startsWith('@') ? -1 : entry!.pins.indexOf(p)
          return i >= 0 ? ch.base + i : -1
        })
        if (want[0] < 0 || want[1] < 0) continue // in / out must be catalog pins to be identified
        for (let e = 0; e < nDev; e++) {
          const s = this.devStart[e]
          if (this.devStart[e + 1] - s !== want.length) continue
          let same = true
          for (let k = 0; k < want.length && same; k++) same = this.devSlot[s + k] === want[k]
          if (same) markPass(e)
        }
      }
    }

    // conceal: slot → node / part group, node → slots, group → slots
    const slotNode = new Int32Array(slotCount).fill(NO_NODE)
    const parent = new Int32Array(slotCount)
    for (let s = 0; s < slotCount; s++) parent[s] = s
    const find = (s: number): number => {
      while (parent[s] !== s) {
        parent[s] = parent[parent[s]]
        s = parent[s]
      }
      return s
    }
    const join = (a: number, b: number): void => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent[ra] = rb
    }
    let maxNode = GROUND
    for (let e = 0; e < nDev; e++) {
      let first = -1
      for (let p = this.devStart[e]; p < this.devStart[e + 1]; p++) {
        const slot = this.devSlot[p]
        if (slot < 0 || slot >= slotCount) continue
        const node = this.devNode[p]
        if (node >= GROUND) {
          slotNode[slot] = node
          if (node > maxNode) maxNode = node
        }
        if (first < 0) first = slot
        else join(first, slot)
      }
    }
    for (const ch of chips) {
      const nodes = ch.drives.pinNodes
      for (let p = 0; p < nodes.length; p++) {
        const slot = ch.base + p
        if (slot < 0 || slot >= slotCount) continue
        if (nodes[p] >= GROUND) {
          slotNode[slot] = nodes[p]
          if (nodes[p] > maxNode) maxNode = nodes[p]
        }
        if (p > 0 && ch.base >= 0) join(ch.base, slot)
      }
    }
    const nNodes = maxNode + 2 // index node + 1 (the 0 V node is 0)
    this.slotNode = slotNode
    this.nodeStart = new Int32Array(nNodes + 1)
    for (let s = 0; s < slotCount; s++) if (slotNode[s] >= GROUND) this.nodeStart[slotNode[s] + 2]++
    for (let v = 0; v < nNodes; v++) this.nodeStart[v + 1] += this.nodeStart[v]
    this.nodeSlots = new Int32Array(this.nodeStart[nNodes])
    {
      const fill = this.nodeStart.slice(0, nNodes)
      for (let s = 0; s < slotCount; s++) if (slotNode[s] >= GROUND) this.nodeSlots[fill[slotNode[s] + 1]++] = s
    }
    const groupOf = new Int32Array(slotCount)
    const rootGroup = new Map<number, number>()
    for (let s = 0; s < slotCount; s++) {
      const r = find(s)
      let g = rootGroup.get(r)
      if (g === undefined) {
        g = rootGroup.size
        rootGroup.set(r, g)
      }
      groupOf[s] = g
    }
    const nGroups = rootGroup.size
    this.slotGroup = groupOf
    this.groupStart = new Int32Array(nGroups + 1)
    for (let s = 0; s < slotCount; s++) this.groupStart[groupOf[s] + 1]++
    for (let g = 0; g < nGroups; g++) this.groupStart[g + 1] += this.groupStart[g]
    this.groupSlots = new Int32Array(slotCount)
    {
      const fill = this.groupStart.slice(0, nGroups)
      for (let s = 0; s < slotCount; s++) this.groupSlots[fill[groupOf[s]]++] = s
    }
    this.hidNode = new Uint8Array(nNodes)
    this.hidGroup = new Uint8Array(nGroups)
    this.work = new Int32Array(nNodes + nGroups)
  }

  /** Clear the integrals and the last means (a rebuilt world starts dark). */
  reset(): void {
    this.acc.fill(0)
    this.unrouted.fill(0)
    this.hold.fill(0)
    this.accRef = 0
    this.accT = 0
    this.haveMeans = false
    this.means.pins.fill(0)
    this.means.ref = 0
    this.means.span = 0
  }

  /**
   * After a successful solve: evaluate the recorded device stamps and the chip
   * drives at the solution `x` and integrate the currents over `dt`.
   */
  accumulate(x: Float64Array, dt: number): void {
    if (!(dt > 0)) return
    const acc = this.acc
    let ref = 0

    // ---- devices: recorded final-iteration stamps
    const rec = this.recorder
    const tmp = this.devTmp
    tmp.fill(0)
    const nodeOf = this.devNode
    const start = this.devStart
    const n = rec.count
    const kind = rec.kind
    const row = rec.row
    const col = rec.col
    const val = rec.val
    const own = rec.own
    const mode = this.devMode
    for (let j = 0; j < n; j++) {
      const e = own[j]
      const k = kind[j]
      const r = row[j]
      if (k === K_ELEMENT) {
        const c = col[j]
        const i = val[j] * (c >= 0 ? x[c] : 0)
        if (r >= 0) this.attribute(e, r, i)
        else if (i !== 0) this.unsplit(e, GROUND) // (recorded for MODE_UNKNOWN only)
      } else if (k === K_CURRENT) {
        if (r >= 0) this.attribute(e, r, -val[j])
        else if (val[j] !== 0) this.unsplit(e, GROUND)
      } else {
        // conductance g between r and c (either may be the reference)
        const c = col[j]
        const vr = r >= 0 ? x[r] : 0
        const vc = c >= 0 ? x[c] : 0
        const i = val[j] * (vr - vc)
        if (r >= 0) this.attribute(e, r, i)
        else if (i !== 0 && mode[e] === MODE_UNKNOWN) this.unsplit(e, GROUND)
        if (c >= 0) this.attribute(e, c, -i)
        else if (i !== 0 && mode[e] === MODE_UNKNOWN) this.unsplit(e, GROUND)
      }
    }
    const nDev = start.length - 1
    for (let e = 0; e < nDev; e++) {
      const s = start[e]
      const end = start[e + 1]
      const m = mode[e]
      // KCL residual of the device → its pins on the 0 V reference node
      let sum = 0
      let gp = 0
      for (let p = s; p < end; p++) {
        if (nodeOf[p] === GROUND) gp++
        else sum += tmp[p]
      }
      if (gp > 0) {
        const share = -sum / gp
        for (let p = s; p < end; p++) if (nodeOf[p] === GROUND) tmp[p] = share
      } else if (sum !== 0) {
        // stamped against the reference without a pin there
        ref += sum
      }
      // pins of two terminals on one node: the stamps gave that node's exact total; the device splits it
      if (m === MODE_HOOK) this.split(e, s, end, x)
      if (m === MODE_UNKNOWN) {
        // a node of two terminals that received a current: its split is not known — never a share
        for (let p = s; p < end; p++) {
          if (this.devBad[p]) {
            tmp[p] = NaN
            this.devBad[p] = 0
          }
        }
      }
      for (let p = s; p < end; p++) {
        const slot = this.devSlot[p]
        if (slot >= 0) acc[slot] += tmp[p] * dt
      }
    }

    // ---- chips: drive conductances, computed directly
    const chips = this.chips
    this.pendN = 0
    for (let c = 0; c < chips.length; c++) {
      const ch = chips[c]
      const d = ch.drives
      const base = ch.base
      const nodes = d.pinNodes
      const np = nodes.length
      const up = d.stageUp
      const down = d.stageDown
      const hi = d.railHiNode
      const lo = d.railLoNode
      const vHi = hi >= 0 ? x[hi] : 0
      const vLo = lo >= 0 ? x[lo] : 0
      for (let p = 0; p < np; p++) {
        const node = nodes[p]
        if (node <= NO_NODE) continue
        const v = node >= 0 ? x[node] : 0
        const g = d.driveG[p]
        if (g > 0 && node >= 0) {
          // Norton drive to the reference (engine: node === −1 is not stamped):
          // i flows into the chip at p and, on a real chip, out of its supply
          // pin (sourcing, i < 0) or its ground pin (sinking, i > 0)
          const i = g * (v - d.driveV[p])
          acc[base + p] += i * dt
          const r = i < 0 ? this.nortonHi[c] : this.nortonLo[c]
          if (!this.route(nodes, base, r, i, dt)) {
            // no honest path: it stays on the reference (the rails publish unknown at drain)
            ref += i
            this.unrouted[c] += (i < 0 ? -i : i) * dt
          }
        }
        if (up !== null && down !== null) {
          const gu = up[p]
          if (gu > 0 && hi > NO_NODE) {
            const i = gu * (v - vHi)
            acc[base + p] += i * dt
            if (d.railHiIdx >= 0) acc[base + d.railHiIdx] -= i * dt
          }
          const gd = down[p]
          if (gd > 0 && lo > NO_NODE) {
            const i = gd * (v - vLo)
            acc[base + p] += i * dt
            if (d.railLoIdx >= 0) acc[base + d.railLoIdx] -= i * dt
          }
        }
      }
    }

    // the Norton currents that return through a supply net: through its source chain
    for (let k = 0; k < this.pendN; k++) if (this.pendQ[k] !== 0) this.creditChain(k)

    this.accRef += ref * dt
    this.accT += dt
  }

  /**
   * Mean currents since the previous drain (null before any tracked step).
   * The returned object is REUSED — copy what you keep.
   */
  drain(): CurrentMeans | null {
    const T = this.accT
    if (T > 0) {
      const m = this.means
      const acc = this.acc
      const inv = 1 / T
      for (let i = 0; i < acc.length; i++) {
        m.pins[i] = acc[i] * inv
        acc[i] = 0
      }
      for (let c = 0; c < this.chips.length; c++) {
        if (this.unrouted[c] * inv >= KCL_HIDE_A) this.hold[c] = HOLD_S
        else if (this.hold[c] > 0) this.hold[c] = Math.max(0, this.hold[c] - T)
        if (this.hold[c] > 0) this.unknownRails(c, m.pins)
        this.unrouted[c] = 0
      }
      m.ref = this.accRef * inv
      m.span = T
      this.accRef = 0
      this.accT = 0
      this.haveMeans = true
      this.conceal(m.pins)
      return m
    }
    if (!this.haveMeans) return null
    this.means.span = 0
    return this.means
  }

  /**
   * Book a Norton drive's current `i` (into the chip at the driven pin) as
   * leaving the chip at its catalog pin `r` and — when that pin is not on the
   * 0 V net — through the source(s) holding r's net against 0 V. False = no
   * honest path (nothing booked).
   */
  private route(nodes: Int32Array, base: number, r: number, i: number, dt: number): boolean {
    if (i === 0) return true
    if (r < 0 || r >= nodes.length) return false
    const n = nodes[r]
    if (n === GROUND) {
      this.acc[base + r] -= i * dt
      return true
    }
    if (n < 0) return false
    const k = this.chainOf(n, i < 0)
    if (k < 0) return false
    this.pendQ[k] += i * dt
    this.acc[base + r] -= i * dt
    return true
  }

  /**
   * Never a broken loop (see the file header): hide (NaN) every pin of the
   * region that cannot be shown whole. Seeds: unknown pins and nets whose
   * pin currents miss KCL; a hidden net hides every part pushing a visible
   * current into it, a hidden part every net it pushes a visible current
   * into. Runs once per drain (the frame rate), allocation-free; a circuit
   * whose loops all close costs one pass over its pins.
   */
  private conceal(pins: Float64Array): void {
    const nodeStart = this.nodeStart
    const nodeSlots = this.nodeSlots
    const nNodes = this.hidNode.length
    const work = this.work
    let w = 0
    let any = false
    for (let v = 0; v < nNodes; v++) {
      let sum = 0
      let known = true
      for (let j = nodeStart[v]; j < nodeStart[v + 1]; j++) {
        const i = pins[nodeSlots[j]]
        if (Number.isFinite(i)) sum += i
        else known = false
      }
      const hide = !known || !(Math.abs(sum) <= KCL_HIDE_A)
      this.hidNode[v] = hide ? 1 : 0
      if (hide) {
        work[w++] = v
        any = true
      }
    }
    if (!any) return
    this.hidGroup.fill(0)
    const slotGroup = this.slotGroup
    const slotNode = this.slotNode
    const groupStart = this.groupStart
    const groupSlots = this.groupSlots
    // a pin "pushes a visible current" when |I| ≥ KCL_HIDE_A — or is unknown (NaN: may be anything)
    while (w > 0) {
      const item = work[--w]
      if (item >= 0) {
        // a hidden net: every part pushing a visible current into it goes too
        for (let j = nodeStart[item]; j < nodeStart[item + 1]; j++) {
          const s = nodeSlots[j]
          const g = slotGroup[s]
          if (this.hidGroup[g] || Math.abs(pins[s]) < KCL_HIDE_A) continue
          this.hidGroup[g] = 1
          work[w++] = -1 - g
        }
      } else {
        // a hidden part: its visible pins become unknown, their nets hidden
        const g = -1 - item
        for (let j = groupStart[g]; j < groupStart[g + 1]; j++) {
          const s = groupSlots[j]
          if (Math.abs(pins[s]) < KCL_HIDE_A) continue
          pins[s] = NaN
          const node = slotNode[s]
          if (node < GROUND) continue
          const v = node + 1
          if (this.hidNode[v]) continue
          this.hidNode[v] = 1
          work[w++] = v
        }
      }
    }
  }

  /**
   * Chip `c` (index into the constructor's `chips`) is concealed right now:
   * within the last HOLD_S of simulated time its Norton output current had
   * no honest return path, so its rail pins publish unknown (the engine's
   * SimTelemetry.flowConcealed names it). Valid after drain().
   */
  isHeld(c: number): boolean {
    return c >= 0 && c < this.hold.length && this.hold[c] > 0
  }

  /** A Norton current of chip `c` could not be attributed: its rail pins publish unknown. */
  private unknownRails(c: number, pins: Float64Array): void {
    const ch = this.chips[c]
    const n = ch.drives.pinNodes.length
    const hi = this.nortonHi[c]
    const lo = this.nortonLo[c]
    if (hi >= 0 && hi < n) pins[ch.base + hi] = NaN
    if (lo >= 0 && lo < n) pins[ch.base + lo] = NaN
  }

  /**
   * The chain from net `n` to the 0 V net in this step (index into the
   * pending list; −1 = none): the shortest chain of recorded Thevenin
   * sources and — for a sourcing return (`sourcing`: the current flows OUT
   * of the chain into net n) — regulator pass elements entered at their
   * output (at most MAX_HOPS: stacked supplies, a regulator on a battery),
   * searched once per net, direction and step.
   */
  private chainOf(n: number, sourcing: boolean): number {
    const dir = sourcing ? 1 : 0
    for (let k = 0; k < this.pendN; k++) {
      if (this.pendNode[k] === n && this.pendSrc[k] === dir) return this.pendHops[k] >= 0 ? k : -1
    }
    if (this.pendN >= this.pendNode.length) return -1
    const rec = this.recorder
    const sg = rec.srcG
    const sp = rec.srcPlus
    const sm = rec.srcMinus
    const nDev = sg.length
    const passIn = this.passIn
    const passOut = this.passOut
    // breadth-first over nodes: visit[j] = node, via[j] = index of its parent in visit
    const visit = this.visit
    const via = this.via
    let head = 0
    let tail = 0
    visit[tail] = n
    via[tail++] = -1
    let found = -1
    search: while (head < tail) {
      const j0 = head++
      let depth = 0
      for (let j = j0; via[j] >= 0; j = via[j]) depth++
      if (depth >= MAX_HOPS) continue
      const at = visit[j0]
      for (let e = 0; e < nDev; e++) {
        let other = NO_NODE
        if (sg[e] > 0) other = sp[e] === at ? sm[e] : sm[e] === at ? sp[e] : NO_NODE
        // a regulator only sources: in → out (its input never at 0 V — that is no supply)
        else if (sourcing && passOut[e] === at && passIn[e] >= 0) other = passIn[e]
        if (other < GROUND) continue
        let seen = false
        for (let j = 0; j < tail; j++) if (visit[j] === other) seen = true
        if (seen || tail >= visit.length) continue
        visit[tail] = other
        via[tail] = j0
        if (other === GROUND) {
          found = tail++
          break search
        }
        tail++
      }
    }
    const k = this.pendN++
    this.pendNode[k] = n
    this.pendSrc[k] = dir
    this.pendQ[k] = 0
    if (found < 0) {
      this.pendHops[k] = -1
      return -1
    }
    let hops = 0
    for (let j = found; via[j] >= 0; j = via[j]) hops++
    this.pendHops[k] = hops
    let h = hops
    for (let j = found; via[j] >= 0; j = via[j]) {
      h--
      this.pendFrom[k * MAX_HOPS + h] = visit[via[j]]
      this.pendTo[k * MAX_HOPS + h] = visit[j]
    }
    return k
  }

  /**
   * Carry pending chain `k`'s charge (= Σ I·dt) to the 0 V net: each source
   * on a hop (parallel sources share by conductance; with no source on the
   * hop, the regulators from its near to its far net share it equally)
   * takes it in at its terminal on the near net and gives it out at its
   * terminal on the far one.
   */
  private creditChain(k: number): void {
    const q = this.pendQ[k]
    const rec = this.recorder
    const sg = rec.srcG
    const sp = rec.srcPlus
    const sm = rec.srcMinus
    const nDev = sg.length
    const sourcing = this.pendSrc[k] === 1
    for (let h = 0; h < this.pendHops[k]; h++) {
      const a = this.pendFrom[k * MAX_HOPS + h]
      const b = this.pendTo[k * MAX_HOPS + h]
      let gSum = 0
      for (let e = 0; e < nDev; e++) {
        if (sg[e] > 0 && ((sp[e] === a && sm[e] === b) || (sp[e] === b && sm[e] === a))) gSum += sg[e]
      }
      if (gSum > 0) {
        for (let e = 0; e < nDev; e++) {
          if (!(sg[e] > 0) || !((sp[e] === a && sm[e] === b) || (sp[e] === b && sm[e] === a))) continue
          const share = (q * sg[e]) / gSum
          this.creditDevice(e, a, share) // into the source on the near net…
          this.creditDevice(e, b, -share) // …out of it on the far one
        }
        continue
      }
      if (!sourcing) continue // (unreachable: the search allows regulators for sourcing returns only)
      let regs = 0
      for (let e = 0; e < nDev; e++) if (!(sg[e] > 0) && this.passOut[e] === a && this.passIn[e] === b) regs++
      for (let e = 0; e < nDev; e++) {
        if (sg[e] > 0 || this.passOut[e] !== a || this.passIn[e] !== b) continue
        const share = q / regs
        this.creditDevice(e, a, share) // out of the regulator at OUT (q < 0: sourcing)…
        this.creditDevice(e, b, -share) // …into it at IN
      }
    }
  }

  /**
   * Add charge `q` (into the device) to device `e`'s pins on node `node`:
   * one terminal's legs share it equally (one conductor, see the file
   * header); pins of two terminals there cannot be told apart → unknown.
   */
  private creditDevice(e: number, node: number, q: number): void {
    const s = this.devStart[e]
    const end = this.devStart[e + 1]
    let hits = 0
    let amb = false
    for (let p = s; p < end; p++) {
      if (this.devNode[p] !== node) continue
      hits++
      if (this.devAmb[p]) amb = true
    }
    if (hits === 0) return
    for (let p = s; p < end; p++) {
      if (this.devNode[p] !== node) continue
      const slot = this.devSlot[p]
      if (slot >= 0) this.acc[slot] += amb && q !== 0 ? NaN : q / hits
    }
  }

  /**
   * Add `i` to device `e`'s pins on node `r`. One pin there: exact. Legs of
   * one terminal (internalBridges): shared equally (one conductor, see the
   * file header). Pins of two terminals (MODE_UNKNOWN — a MODE_HOOK device
   * never gets here): a nonzero `i` makes them unknown (unsplit).
   */
  private attribute(e: number, r: number, i: number): void {
    const s = this.devStart[e]
    const end = this.devStart[e + 1]
    const nodeOf = this.devNode
    let first = -1
    let hits = 0
    for (let p = s; p < end; p++) {
      if (nodeOf[p] === r) {
        if (first < 0) first = p
        hits++
      }
    }
    if (hits === 0) return
    const tmp = this.devTmp
    if (hits === 1) {
      tmp[first] += i // the usual case: one pin per node
      return
    }
    if (i !== 0 && this.devAmb[first] && this.devMode[e] === MODE_UNKNOWN) this.unsplit(e, r)
    const share = i / hits
    for (let p = first; p < end; p++) if (nodeOf[p] === r) tmp[p] += share
  }

  /** Device `e` put a current on node `r`, where pins of two of its terminals sit: their split is unknown this step. */
  private unsplit(e: number, r: number): void {
    const end = this.devStart[e + 1]
    for (let p = this.devStart[e]; p < end; p++) if (this.devNode[p] === r && this.devAmb[p]) this.devBad[p] = 1
  }

  /**
   * MODE_HOOK device `e` (pins s..end): every node holding pins of two or
   * more of its terminals gets its EXACT total (the stamp attribution, the
   * 0 V residual) split by the device's own terminalCurrents. A terminal
   * the hook leaves NaN (a model that books only its simple branches) takes
   * the node total minus the others when it is the only one; with two or
   * more unknown terminals the node's pins are unknown. A terminal's legs
   * (internalBridges) share its current equally (one conductor).
   */
  private split(e: number, s: number, end: number, x: Float64Array): void {
    const tmp = this.devTmp
    const h = this.hookTmp
    const nodeOf = this.devNode
    const term = this.devTerm
    const amb = this.devAmb
    const seen = this.devSeen
    for (let p = s; p < end; p++) {
      h[p] = 0
      seen[p] = 0
    }
    this.hooks[e]!(x, h, s)
    for (let p = s; p < end; p++) {
      if (!amb[p] || seen[p]) continue
      const node = nodeOf[p]
      // the node's exact total; the terminals the hook cannot tell (at most two tracked)
      let total = 0
      let u1 = NO_TERM
      let u2 = NO_TERM
      for (let q = p; q < end; q++) {
        if (nodeOf[q] !== node) continue
        seen[q] = 1
        total += tmp[q]
        if (Number.isFinite(h[q])) continue
        if (u1 === NO_TERM) u1 = term[q]
        else if (term[q] !== u1) u2 = term[q]
      }
      if (u2 !== NO_TERM) {
        for (let q = p; q < end; q++) if (nodeOf[q] === node) tmp[q] = NaN
        continue
      }
      // known terminals: the hook's values, a terminal's legs sharing their sum
      let known = 0
      let uLegs = 0
      for (let q = p; q < end; q++) {
        if (nodeOf[q] !== node) continue
        if (term[q] === u1) {
          uLegs++
          continue
        }
        let legs = 0
        let sum = 0
        for (let r = p; r < end; r++) {
          if (nodeOf[r] !== node || term[r] !== term[q]) continue
          legs++
          sum += h[r]
        }
        tmp[q] = sum / legs
        known += h[q]
      }
      if (u1 === NO_TERM) continue
      // the one terminal the hook left open: the rest of the node's current (KCL)
      const rest = (total - known) / uLegs
      for (let q = p; q < end; q++) if (nodeOf[q] === node && term[q] === u1) tmp[q] = rest
    }
  }
}

/** split(): no terminal */
const NO_TERM = -2147483648

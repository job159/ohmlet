/**
 * Component catalog: every part the simulator (and the LLM) can place.
 * CONTRACT FILE — chip pin arrays may be corrected by the owning chips agent
 * (verified against datasheets); everything else is fixed.
 *
 * Pin order in `pins` IS the package pin number (index 0 = pin 1) for 'dip'
 * and 'footprint' parts, and the order of `holes[]` for 'leads'/'probe' parts.
 */

import type { Rotation, StripRow } from './types'
import { EXTRA_PARTS } from './parts'

export type PlacementKind =
  | 'leads' // free 2/3-lead part: instance lists one HoleRef per pin in `holes`
  | 'dip' // DIP package straddling the channel: instance gives pin-1 hole in `at` (row f)
  | 'footprint' // fixed multi-hole footprint (e.g. pushbutton): pin-1 hole in `at`
  | 'offboard' // instrument with terminals, not on the board (wire to "ID:PIN")
  | 'probe' // single-hole instrument probe

export type ComponentCategory =
  | 'passive'
  | 'semiconductor'
  | 'switch'
  | 'display'
  | 'ic'
  | 'power'
  | 'instrument'
  // embedded-platform extension categories
  | 'mcu' // microcontroller boards (STM32 Blue Pill …)
  | 'sensor' // sensor breakouts and transducers
  | 'module' // communication / interface / memory modules
  | 'motor' // motors and motor drivers

/**
 * How much of a part's behavior the simulator really models. Shown on every
 * library card and in the inspector. NEVER mark a part 'full' or 'partial'
 * unless its electrical/behavioral model exists and is covered by tests.
 *  'full'    — complete within the stated model (see `simulated`)
 *  'partial' — a stated subset is simulated (see `limits`)
 *  'visual'  — placement + wiring + netlist only; no behavior beyond its
 *              connections (pins are open circuits unless bridged)
 *  'dev'     — under development: not placeable in normal builds
 */
export type SupportLevel = 'full' | 'partial' | 'visual' | 'dev'

export interface SupportInfo {
  level: SupportLevel
  /** what IS modeled — short phrases ("Shockley diode, per-color Vf", "I²C bit-level slave") */
  simulated?: string[]
  /** what is NOT modeled / known deviations ("no reverse breakdown", "no clock stretching") */
  limits?: string[]
}

/** Pinout documentation for one catalog pin (aligned by name with `pins`). */
export interface PinInfo {
  /** must equal an entry of CatalogEntry.pins */
  pin: string
  /** printed silkscreen label when different from the pin id (e.g. 'G' for 'GND1', '3.3' for '3V3_1') */
  label?: string
  kind: 'power' | 'ground' | 'io' | 'analog' | 'input' | 'output' | 'passive' | 'nc' | 'control'
  /** alternate functions / roles, e.g. ['USART1_TX', 'TIM1_CH2'] */
  functions?: string[]
  /** STM32: five-volt-tolerant input */
  ft?: boolean
  note?: string
}

/**
 * An analog element living INSIDE a part (board-level LEDs, pull-ups,
 * regulators, current-limit resistors). The engine instantiates it with the
 * existing device models; its telemetry appears under ComponentTelemetry.sub.
 * `pins` names either catalog pins of the parent part or internal nodes
 * prefixed with '@' (e.g. '@led_k'), which get private solver nodes.
 */
export interface SubcircuitElement {
  id: string
  /** a device model registered in src/sim/devices.ts (resistor, led, diode, capacitor, ldo …) */
  model: string
  pins: string[]
  params?: Record<string, number | string | boolean>
}

/** MCU boards: how catalog pins map onto the MCU model (CatalogEntry.mcu). */
export interface McuBoardSpec {
  /** MCU model id registered in src/mcu/registry.ts, e.g. 'stm32f103c8' */
  model: string
  /** catalog pin → MCU port pin ('PA0' … 'PC15'); unlisted pins are power/control */
  pinMap: Record<string, string>
  /** catalog pin that carries the MCU VDD (3.3 V net) */
  vddPin: string
  /** catalog pin used as the MCU ground reference */
  gndPin: string
  /** catalog pin wired to NRST, if broken out */
  resetPin?: string
  /** MCU pins wired to on-board parts (not on headers), e.g. { PC13: 'LED_PC13' } — informative */
  onBoard?: Record<string, string>
}

/** Library metadata for the embedded component library UI. */
export interface PartMeta {
  /** manufacturer part number / module name, e.g. 'STM32F103C8T6', 'GY-521' */
  partNumber?: string
  manufacturer?: string
  /** physical size in mm [length, width, height] */
  sizeMm?: [number, number, number]
  /** search keywords */
  tags?: string[]
  /** one-paragraph spec summary for the inspector */
  specs?: string[]
  /** bundled example project id (examples/…) demonstrating the part */
  example?: string
}

/**
 * Plan-rect the molded BODY of a part covers, for occlusion checks
 * (src/model/occlusion.ts): a hole under the body that is not one of the
 * part's own pin holes must stay completely empty — no other component pin
 * and no wire end may plug into it. The rects mirror the rendered meshes
 * (a hole counts as covered when the body crosses its center in plan view).
 *
 * Interpretation by placement kind:
 *  - 'dip' / 'footprint' (anchored, row-pinned): `dCols` is the inclusive
 *    column range covered relative to the `at` anchor column, and `rows`
 *    lists the absolute strip rows covered (exact, because these anchors are
 *    pinned to fixed rows). Rotation re-maps the rect together with the pins.
 *  - 'leads' (free parts, e.g. the potentiometer): the rect floats with the
 *    pins — `dCols` is the column overhang beyond the leftmost/rightmost pin
 *    column ([-1, 1] = one extra column each side), and `rows` is a window
 *    RE-CENTERED on the pins' rows: its extent each side of its middle letter
 *    is the rows of overhang above/below the pin rows (['e','f','g'] = one
 *    row each side).
 */
export type BodyFootprint = { dCols: [number, number]; rows: StripRow[] }

export interface ParamDef {
  key: string
  label: string
  kind: 'number' | 'select' | 'boolean' | 'text'
  default: number | string | boolean
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: string[]
  /** runtime params are adjustable while the simulation runs (knobs, switches) */
  runtime?: boolean
}

export interface CatalogEntry {
  type: string
  label: string
  category: ComponentCategory
  placement: PlacementKind
  /** pin names; order = package pin number (dip/footprint) or holes[] order (leads) */
  pins: string[]
  /** for placement 'footprint': hole offsets per pin, relative to the pin-1 anchor */
  footprintOffsets?: { dCol: number; row: StripRow }[]
  /** pin-name pairs permanently connected inside the part (merged in the netlist) */
  internalBridges?: [string, string][]
  /**
   * Plan-rect the molded body covers, for occlusion (see BodyFootprint).
   * 'auto' = the bounding box of the pin holes (a body that covers exactly
   * its pin rect, like a plain DIP package). Absent = the body covers nothing
   * beyond its own pin holes (thin leaded parts the router can stand up).
   */
  bodyFootprint?: BodyFootprint | 'auto'
  params?: ParamDef[]
  sim:
    | { kind: 'device'; model: string } // analog model in src/sim/devices.ts
    | { kind: 'chip'; model: string } // behavioral IC in src/sim/chips/*
    | { kind: 'probe' } // no electrical stamp
  /** rendering hints for src/three/component-meshes.ts (free to ignore) */
  visual?: { shape?: string; color?: string; body?: [number, number, number] }
  /** 1-3 sentence usage doc — embedded verbatim in the LLM system prompt */
  doc: string

  // ---- embedded-platform extensions (all optional, additive) ----
  /** simulation support level (absent = legacy part, treated as 'full' within its documented model) */
  support?: SupportInfo
  /** pinout documentation (hover tooltips, inspector pin table) */
  pinInfo?: PinInfo[]
  /** analog elements inside the part (see SubcircuitElement) */
  subcircuit?: SubcircuitElement[]
  /** MCU board mapping (sim.kind must be 'chip' with model 'mcu-board') */
  mcu?: McuBoardSpec
  /** logic-level behavior run by the Simulation Coordinator (sim.kind 'chip', model 'digital-device') */
  digital?: import('../sim/digital/api').DigitalSpec
  /** library metadata */
  meta?: PartMeta
  /**
   * Wire-router obstacle override for tall parts: height above the board top
   * (plan units). The rect comes from `bodyFootprint` (or the pin bbox).
   */
  obstacleHeight?: number
  /**
   * Placement 'offboard' ONLY: the unit's own bench geometry, in plan units
   * relative to its body anchor (`ComponentInstance.pos`, or the default
   * shelf). Every field is optional; an absent field keeps the legacy
   * instrument value, so a part without `offboard` renders, routes and
   * validates exactly like the bench PSU:
   *  - `terminalPitch` — x step between consecutive terminals (legacy 2.5)
   *  - `terminalOffset` — terminal 0 at anchor + (x, z) (legacy (2, 2)); the
   *    terminal row runs +x along the unit's front face
   *  - `rect` — body footprint {w, d} (legacy 6.5 × 4.5): x from anchor.x to
   *    anchor.x + w; its front edge sits 0.5 in front of the terminal row and
   *    it reaches d back from there. It must hold the whole unit (body, leads,
   *    terminals — tests/offboard-geometry.test.ts checks every mesh): the
   *    validator keeps it off the board and off every other unit, the wire
   *    router treats it as a solid obstacle (and the scene's drag tint box
   *    covers it), the default shelf right-aligns it 3 units left of the board
   *    and gives a unit deeper than the legacy 4.5 extra (half) shelf slots so
   *    the next unit still starts 2.5 in front of its terminal row
   *    (offboardSlotSpan).
   * Resolved by src/model/breadboard.ts (offboardTerminalPosition /
   * offboardBodyPosition / offboardBodyRect).
   */
  offboard?: { terminalPitch?: number; rect?: { w: number; d: number }; terminalOffset?: { x: number; z: number } }
  /** pins that supply the part (validator/engine power checks), beyond the legacy VCC/VDD/GND/VSS names */
  supplyPins?: { plus: string[]; minus: string[] }
  /**
   * The part is an independent off-board SOURCE (battery, lab current
   * source …) beyond the legacy power_supply / function_generator: its
   * terminals `plus` / `minus` (catalog pin names) power the circuit. The
   * engine then reports no "no power supply" issue, and when the layout has
   * neither a power_supply nor a function_generator the netlist takes the
   * FIRST source's `minus` terminal as the 0 V reference (no "no ground").
   * The validator's supply checks accept these terminals too.
   */
  source?: { plus: string; minus: string }
  /**
   * The part's model needs strict Newton convergence (SimEngine
   * .strictConvergence: iterate until no device reports `limited`) even in a
   * pure analog world — e.g. a relay whose coil kick must not be solved with
   * a still step-limited flyback diode. Layouts without such a part keep the
   * legacy (bit-identical) solver behavior.
   */
  strictNewton?: true
  /**
   * In-plane rotations the package may take (dip / footprint parts only;
   * absent = every rotation its placement allows: DIP 0/180, footprint
   * 0/90/180/270). Honored by validateLayout, the store's rotateArmed /
   * rotatePlaced / addComponent and the placement ghost (placementValid).
   * Use it for packages whose pins only land on distinct, sensible strips in
   * some orientations (a footprint straddling the channel turned 90° puts
   * two pins into one strip — defect B3).
   */
  allowedRotations?: Rotation[]
  /**
   * Datasheet absolute/recommended ratings used by the electrical rule
   * checker (src/sim/erc). Only stated values are checked; absent = unknown
   * (the ERC then never claims a violation).
   */
  ratings?: PartRatings
}

export interface PartRatings {
  /** recommended supply range across supplyPins (V) */
  vddMin?: number
  vddMax?: number
  /** absolute-maximum voltage on any signal pin relative to the minus supply (V) */
  vPinMax?: number
  /** I/O pins are 5 V tolerant regardless of VDD */
  pins5vTolerant?: boolean
  /** continuous current through the part / its main branch (A) */
  iMax?: number
  /** continuous power dissipation (W) */
  pMax?: number
  /** forward current of an LED-like junction, continuous (A) */
  ifMax?: number
}

/** Support info with the legacy default applied. */
export function supportOf(entry: CatalogEntry): SupportInfo {
  return entry.support ?? { level: 'full' }
}

const E = (e: CatalogEntry) => e

// ---------------------------------------------------------------------------
// Support annotations for the legacy (pre-embedded) parts — what the models
// in src/sim/devices.ts and src/sim/chips/* actually compute, read from the
// code, never from intent. Shown on library cards and in the inspector.
// ---------------------------------------------------------------------------

/**
 * The legacy chips (555, 74xx, CD40xx, LM358) drive their outputs against the
 * solver's 0 V reference (drivePin), so the current they drive does not pass
 * through the supply in the SOLUTION: a bench supply's own reading (its
 * inspector, 量測) leaves it out, while the current-flow view books it on
 * the chip's supply pins and shows the real loop
 * (src/sim/coordinator/current-tracker.ts). Release decision: say so plainly.
 */
const LEGACY_SUPPLY_READING =
  'a bench supply’s own current reading leaves out the current these outputs drive: the solver returns it through circuit ground, not through the chip’s VCC and GND pins'

/** Shared honesty notes for the behavioral logic ICs (src/sim/chips/*). */
const LOGIC_LIMITS = [
  'behavioral, not transistor-level: inputs draw no current and the outputs draw no supply current from VCC/VDD',
  'floating inputs read LOW (real TTL floats HIGH, real CMOS floats undefined)',
  'evaluated once per analog step (50 µs): no propagation delay or rise time below that',
  'outputs are ideal 50 Ω drivers referenced to circuit ground, not the chip GND pin; no fan-out limit',
  'supply below 2 V releases every output (no brown-out behavior in between)',
  LEGACY_SUPPLY_READING,
]
const LOGIC_INPUTS = 'inputs compared against 0.5·VCC; push-pull outputs (VCC / 0 V through 50 Ω)'
const SWITCH_CONTACT = 'contact = 20 S (50 mΩ) closed / 1 nS open'

const LEGACY_SUPPORT: Record<string, SupportInfo> = {
  resistor: {
    level: 'full',
    simulated: [
      "ideal linear resistance (Ohm's law)",
      'branch current and power telemetry',
      'self-heating against its ¼ W power rating (first-order thermal model, τ ≈ 10 s): above its rating it overheats and smokes; a sustained gross overload (the body at 10 times the rated temperature rise — 10 Ω across 12 V, 14.4 W, takes ≈ 2 s) burns it open, latched until a new part goes in (a circuit edit or a reset puts one in; in the workspace, “Replace” and a value change do too)',
    ],
    limits: [
      'no tolerance or temperature coefficient: the resistance stays the same while it heats',
      'resistance clamped to 1 mΩ … 1 TΩ',
    ],
  },
  capacitor: {
    level: 'partial',
    simulated: [
      'ideal capacitance (backward-Euler companion at the analog step)',
      'charge persists while the simulation runs',
      'a polarized (electrolytic) capacitor reversed by more than 1 V vents (5 V reverse in ≈ 1 s, 2 V in ≈ 4 s, 1 V or less never), latched until a new part goes in (a circuit edit or a reset puts one in; in the workspace, “Replace” and a value change do too)',
    ],
    limits: [
      'a vented capacitor keeps its capacitance in the simulation (a real one loses it and may short)',
      'no ESR, leakage or voltage rating',
      'charge resets whenever the circuit is edited (the engine is rebuilt)',
    ],
  },
  inductor: {
    level: 'full',
    simulated: ['ideal inductance (backward-Euler companion)', 'branch current telemetry'],
    limits: ['no winding resistance, saturation or core loss', 'no mutual coupling'],
  },
  potentiometer: {
    level: 'full',
    simulated: ['two series resistances split at the wiper (linear taper)', 'knob position adjustable while running'],
    limits: ['linear taper only', 'each half never drops below 0.5 Ω (end resistance)', 'no power rating'],
  },
  photoresistor: {
    level: 'full',
    simulated: ['R = 200 Ω·10^(3·(1 − light)): ~200 Ω bright … ~200 kΩ dark', 'light level adjustable while running'],
    limits: ['instant response (real CdS cells take tens of ms and have light history)', 'no spectral response'],
  },
  diode: {
    level: 'full',
    simulated: ['Shockley junction, Is = 1 pA, n = 1.2 (≈0.66 V at 1 mA)'],
    limits: ['no reverse breakdown', 'no junction capacitance or reverse recovery', 'no thermal limits'],
  },
  led: {
    level: 'full',
    simulated: [
      'Shockley junction (n = 2) fitted to the color forward voltage at 10 mA: red 1.8 V, yellow 2.0 V, green 2.2 V, blue 3.0 V, white 3.2 V',
      'brightness = current / its rated 20 mA: 100 % at 20 mA, above 100 % it is over-driven (it flickers); current and brightness are the mean over the last 20 ms of simulated time, as the eye sees it: a PWM-dimmed LED fades smoothly and reads as an average, with its on-current as the peak',
      'junction temperature from P = Vf · I (first-order: 350 K/W, τ ≈ 5 s): above 100 °C it overheats; at 150 °C it burns open (latched until a new part goes in — a circuit edit or a reset puts one in; in the workspace, “Replace” and a value change do too); above 150 mA for more than 1 ms it burns at once (31 mA from 100 Ω on 5 V never burns it)',
      'the 3D look follows that brightness as the eye sees it (perceptual curve): dark at 0 mA; from about 0.5 mA a hot core brighter than the lens and a soft glow, both brighter and wider at every step (2, 4, 10 mA); toward 20 mA a white-hot core, rays and a dazzling flare; a white LED glows brighter than the white board, with a darker cool edge; a burned LED is charred and dark',
    ],
    limits: ['no reverse breakdown', 'light output is linear in current (no efficiency droop, no dimming as it heats)'],
  },
  npn: {
    level: 'full',
    simulated: ['Ebers-Moll transport model, βF = 150, βR = 3, Is = 10 fA'],
    limits: ['no Early effect, junction capacitances or breakdown', 'no thermal model'],
  },
  pnp: {
    level: 'full',
    simulated: ['Ebers-Moll transport model (PNP), βF = 150, βR = 3, Is = 10 fA'],
    limits: ['no Early effect, junction capacitances or breakdown', 'no thermal model'],
  },
  nmos: {
    level: 'full',
    simulated: ['square-law (SPICE level 1) MOSFET: Vth = 2 V, k = 0.1 A/V², λ = 0.01 /V', 'symmetric conduction when drain and source swap'],
    limits: ['no body diode', 'no gate capacitance (switches instantly)', 'no subthreshold conduction'],
  },
  pushbutton: {
    level: 'full',
    simulated: [`A side ↔ B side, ${SWITCH_CONTACT}`, 'pressed state changeable while running'],
    limits: ['no contact bounce'],
  },
  slide_switch: {
    level: 'full',
    simulated: [`common ↔ a or b, ${SWITCH_CONTACT}`, 'position changeable while running'],
    limits: ['no contact bounce; the transition is instant (no break-before-make gap)'],
  },
  dip_switch_8: {
    level: 'full',
    simulated: [`eight independent switches nA ↔ nB, ${SWITCH_CONTACT}`, 'states changeable while running'],
    limits: ['no contact bounce'],
  },
  power_supply: {
    level: 'full',
    simulated: ['ideal voltage source behind 10 mΩ', 'voltage adjustable while running', 'flags a current above 2 A that lasts 10 ms as a possible short (a capacitor’s start-up surge is not one); the warning clears once the current stays under 2 A for 10 ms'],
    limits: [
      'no current limit or foldback: a short is only flagged, never limited',
      'no ripple or regulation dynamics',
      'its current reading leaves out the output current of the behavioral chips (555, 74xx, CD40xx, LM358): the solver returns it through circuit ground',
    ],
  },
  function_generator: {
    level: 'full',
    simulated: ['sine / square / triangle source behind 50 Ω', 'waveform, frequency, amplitude and offset adjustable while running'],
    limits: [
      'evaluated once per analog step (50 µs): signals above ~1 kHz are coarsely sampled',
      'no rise-time limit or duty-cycle control',
    ],
  },
  seven_segment: {
    level: 'full',
    simulated: ['eight LED junctions (a–g, dp) to the common cathode, ~2.0 V at 10 mA', 'a segment reads lit above 1 mA'],
    limits: ['segments are on/off (no brightness levels)', 'no per-segment burn-out', 'common-cathode only'],
  },
  buzzer: {
    level: 'partial',
    simulated: ['a 300 Ω resistive load', '"sounding" while |V| > 1 V'],
    limits: [
      'electrically a 300 Ω resistor only: no coil inductance or back-EMF',
      'sounds in either polarity (a real buzzer needs p1 positive); no audio is produced',
    ],
  },
  ne555: {
    level: 'full',
    simulated: [
      'behavioral comparators at 2/3·VCC and 1/3·VCC (CTRL-adjustable), RS latch, async active-low RESET',
      'push-pull OUT (VCC − 0.5 V / 0.1 V through 10 Ω), open-drain DISCH (25 Ω)',
    ],
    limits: LOGIC_LIMITS,
  },
  lm358: {
    level: 'full',
    simulated: [
      'behavioral op-amp: open-loop gain 100 000, output 20 mV … VCC − 1.2 V through 50 Ω',
      'slew rate 0.5 V/µs; feedback-aware stepping so followers / amplifiers settle',
    ],
    limits: [
      'no input bias current, offset or frequency response beyond slew limiting',
      'floating inputs read 0 V',
      'evaluated once per analog step (50 µs): tight loops with lag oscillate around the right mean',
      LEGACY_SUPPLY_READING,
    ],
  },
  sn7400: { level: 'full', simulated: [LOGIC_INPUTS, 'four 2-input NAND gates'], limits: LOGIC_LIMITS },
  sn7404: { level: 'full', simulated: [LOGIC_INPUTS, 'six inverters'], limits: LOGIC_LIMITS },
  sn7408: { level: 'full', simulated: [LOGIC_INPUTS, 'four 2-input AND gates'], limits: LOGIC_LIMITS },
  sn7432: { level: 'full', simulated: [LOGIC_INPUTS, 'four 2-input OR gates'], limits: LOGIC_LIMITS },
  sn7486: { level: 'full', simulated: [LOGIC_INPUTS, 'four 2-input XOR gates'], limits: LOGIC_LIMITS },
  sn7474: {
    level: 'full',
    simulated: [LOGIC_INPUTS, 'two rising-edge D flip-flops with async active-low CLR / PRE'],
    limits: [...LOGIC_LIMITS, 'CLR and PRE both low: CLR wins (the real part forces Q = QN = high)'],
  },
  cd4017: {
    level: 'full',
    simulated: [LOGIC_INPUTS, 'Johnson decade counter: rising CLK edges gated by INH, async RST, CO high for counts 0–4'],
    limits: LOGIC_LIMITS,
  },
  cd4026: {
    level: 'full',
    simulated: [LOGIC_INPUTS, 'decade counter with decoded 7-segment outputs, DEI/DEO display enable, CO and UCS'],
    limits: LOGIC_LIMITS,
  },
  cd4511: {
    level: 'full',
    simulated: [LOGIC_INPUTS, 'BCD latch / 7-segment decoder with LT, BL and LE; codes above 9 blank'],
    limits: LOGIC_LIMITS,
  },
  sn74193: {
    level: 'full',
    simulated: [LOGIC_INPUTS, 'presettable 4-bit up/down counter: UP/DOWN clocks, async LOAD and CLR, CO/BO'],
    limits: LOGIC_LIMITS,
  },
  cd4040: {
    level: 'full',
    simulated: [LOGIC_INPUTS, '12-stage ripple counter advancing on falling CLK edges, async RST'],
    limits: [...LOGIC_LIMITS, 'all stages update in the same step (no ripple delay between stages)'],
  },
  scope_probe: {
    level: 'full',
    simulated: ['records the voltage of the net it touches for the scope panel (channels 1–4)'],
    limits: ['ideal probe: no loading, no bandwidth limit'],
  },
}

// ---------------------------------------------------------------------------
// Datasheet ratings checked by the electrical rule checker (src/sim/erc).
// Recommended operating ranges unless noted; only stated values are checked.
// ---------------------------------------------------------------------------

/** TI SN74xx standard TTL (SN7400 … SN74193): VCC 4.75–5.25 V recommended (abs max 7 V); input voltage abs max 5.5 V. */
const TTL_RATINGS: PartRatings = { vddMin: 4.75, vddMax: 5.25, vPinMax: 5.5 }
/** TI CD4000B-series CMOS (CD4017B/4026B/4040B/4511B): VDD 3–18 V recommended (abs max 20 V). */
const CMOS4000B_RATINGS: PartRatings = { vddMin: 3, vddMax: 18 }

export const CATALOG: Record<string, CatalogEntry> = {
  // ----------------------------------------------------------- passives
  resistor: E({
    type: 'resistor',
    label: 'Resistor',
    category: 'passive',
    placement: 'leads',
    pins: ['p1', 'p2'],
    params: [
      { key: 'resistance', label: 'Resistance', kind: 'number', default: 1000, min: 0.1, max: 1e8, unit: 'Ω' },
    ],
    sim: { kind: 'device', model: 'resistor' },
    visual: { shape: 'resistor' },
    support: LEGACY_SUPPORT.resistor,
    // ¼ W through-hole film resistor (e.g. Yageo CFR-25: 0.25 W at 70 °C)
    ratings: { pMax: 0.25 },
    doc: 'Basic resistor. Two leads, place each lead in any hole. Always put 220Ω–1kΩ in series with every LED.',
  }),
  capacitor: E({
    type: 'capacitor',
    label: 'Capacitor',
    category: 'passive',
    placement: 'leads',
    pins: ['p1', 'p2'],
    params: [
      { key: 'capacitance', label: 'Capacitance', kind: 'number', default: 1e-5, min: 1e-12, max: 1, unit: 'F' },
      { key: 'polarized', label: 'Polarized (electrolytic)', kind: 'boolean', default: false },
    ],
    sim: { kind: 'device', model: 'capacitor' },
    visual: { shape: 'capacitor' },
    support: LEGACY_SUPPORT.capacitor,
    doc: 'Capacitor. For polarized (electrolytic) caps, p1 is +, p2 is −. Timing for a 555: t ≈ 1.1·R·C.',
  }),
  inductor: E({
    type: 'inductor',
    label: 'Inductor',
    category: 'passive',
    placement: 'leads',
    pins: ['p1', 'p2'],
    params: [
      { key: 'inductance', label: 'Inductance', kind: 'number', default: 0.01, min: 1e-9, max: 100, unit: 'H' },
    ],
    sim: { kind: 'device', model: 'inductor' },
    visual: { shape: 'inductor' },
    support: LEGACY_SUPPORT.inductor,
    doc: 'Inductor (coil). Two leads.',
  }),
  potentiometer: E({
    type: 'potentiometer',
    label: 'Potentiometer',
    category: 'passive',
    placement: 'leads',
    pins: ['ccw', 'wiper', 'cw'],
    params: [
      { key: 'resistance', label: 'Total resistance', kind: 'number', default: 10000, min: 100, max: 1e6, unit: 'Ω' },
      { key: 'position', label: 'Position', kind: 'number', default: 0.5, min: 0, max: 1, step: 0.01, runtime: true },
    ],
    // wide square trimmer body (3296P-style): overhangs one column beyond each
    // outer lead and one row above/below the lead row — matches the rendered mesh
    bodyFootprint: { dCols: [-1, 1], rows: ['e', 'f', 'g'] },
    sim: { kind: 'device', model: 'potentiometer' },
    visual: { shape: 'pot' },
    support: LEGACY_SUPPORT.potentiometer,
    doc: 'Potentiometer with 3 leads: ccw end, wiper, cw end. The user can turn the knob while the simulation runs. Its wide body overhangs neighboring holes (one column left/right of the outer leads, one row above/below) — leave those holes empty.',
  }),
  photoresistor: E({
    type: 'photoresistor',
    label: 'Photoresistor (LDR)',
    category: 'passive',
    placement: 'leads',
    pins: ['p1', 'p2'],
    params: [
      { key: 'light', label: 'Light level', kind: 'number', default: 0.5, min: 0, max: 1, step: 0.01, runtime: true },
    ],
    sim: { kind: 'device', model: 'photoresistor' },
    visual: { shape: 'ldr' },
    support: LEGACY_SUPPORT.photoresistor,
    // GL5528-class CdS cell: maximum power dissipation 100 mW
    ratings: { pMax: 0.1 },
    doc: 'Light-dependent resistor: ~200kΩ in the dark down to ~200Ω in bright light. The user can change the light level slider while simulating — great for night-light circuits.',
  }),

  // ------------------------------------------------------ semiconductors
  diode: E({
    type: 'diode',
    label: 'Diode (1N4148)',
    category: 'semiconductor',
    placement: 'leads',
    pins: ['anode', 'cathode'],
    sim: { kind: 'device', model: 'diode' },
    visual: { shape: 'diode' },
    support: LEGACY_SUPPORT.diode,
    // Vishay 1N4148: average forward current IF(AV) 150 mA, Ptot 500 mW
    ratings: { iMax: 0.15, pMax: 0.5 },
    doc: 'Small-signal silicon diode. Conducts anode→cathode with ~0.7V drop.',
  }),
  led: E({
    type: 'led',
    label: 'LED',
    category: 'semiconductor',
    placement: 'leads',
    pins: ['anode', 'cathode'],
    params: [
      { key: 'color', label: 'Color', kind: 'select', default: 'red', options: ['red', 'green', 'yellow', 'blue', 'white'] },
    ],
    sim: { kind: 'device', model: 'led' },
    visual: { shape: 'led' },
    support: LEGACY_SUPPORT.led,
    // 5 mm indicator LED (e.g. Kingbright WP7113 series): IF 20 mA continuous
    ratings: { ifMax: 0.02 },
    doc: 'LED. Anode (+) to the higher potential through a series resistor (220Ω–1kΩ); cathode (−) toward ground. Rated 20 mA; far more current overheats it until it burns out (with no resistor at all, at once).',
  }),
  npn: E({
    type: 'npn',
    label: 'NPN transistor (2N3904)',
    category: 'semiconductor',
    placement: 'leads',
    pins: ['emitter', 'base', 'collector'],
    sim: { kind: 'device', model: 'npn' },
    visual: { shape: 'to92' },
    support: LEGACY_SUPPORT.npn,
    // onsemi 2N3904: IC 200 mA continuous, PD 625 mW
    ratings: { iMax: 0.2, pMax: 0.625 },
    doc: 'NPN BJT, pin order emitter/base/collector (2N3904 flat side facing you: E-B-C). Drive the base through a resistor (1k–10k).',
  }),
  pnp: E({
    type: 'pnp',
    label: 'PNP transistor (2N3906)',
    category: 'semiconductor',
    placement: 'leads',
    pins: ['emitter', 'base', 'collector'],
    sim: { kind: 'device', model: 'pnp' },
    visual: { shape: 'to92' },
    support: LEGACY_SUPPORT.pnp,
    // onsemi 2N3906: IC 200 mA continuous, PD 625 mW
    ratings: { iMax: 0.2, pMax: 0.625 },
    doc: 'PNP BJT, pin order emitter/base/collector.',
  }),
  nmos: E({
    type: 'nmos',
    label: 'N-MOSFET (2N7000)',
    category: 'semiconductor',
    placement: 'leads',
    pins: ['source', 'gate', 'drain'],
    sim: { kind: 'device', model: 'nmos' },
    visual: { shape: 'to92' },
    support: LEGACY_SUPPORT.nmos,
    // onsemi 2N7000: ID 200 mA continuous, PD 350 mW
    ratings: { iMax: 0.2, pMax: 0.35 },
    doc: 'Small N-channel MOSFET, pin order source/gate/drain. Vth ≈ 2V.',
  }),

  // ------------------------------------------------------------ switches
  pushbutton: E({
    type: 'pushbutton',
    label: 'Pushbutton (tactile)',
    category: 'switch',
    placement: 'footprint',
    pins: ['A1', 'A2', 'B1', 'B2'],
    footprintOffsets: [
      { dCol: 0, row: 'f' }, // A1 (pin 1, anchor)
      { dCol: 0, row: 'e' }, // A2
      { dCol: 2, row: 'f' }, // B1
      { dCol: 2, row: 'e' }, // B2
    ],
    internalBridges: [
      ['A1', 'A2'],
      ['B1', 'B2'],
    ],
    params: [{ key: 'pressed', label: 'Pressed', kind: 'boolean', default: false, runtime: true }],
    // 3-column-wide molded base: the middle column (at+1, rows e/f) sits
    // under the body and must stay empty
    bodyFootprint: { dCols: [0, 2], rows: ['e', 'f'] },
    sim: { kind: 'device', model: 'pushbutton' },
    visual: { shape: 'button' },
    support: LEGACY_SUPPORT.pushbutton,
    doc: 'Momentary tactile button straddling the center channel. `at` = hole for pin A1 (row f). Occupies columns at and at+2 in rows e and f. A-side and B-side connect while pressed. A1/A2 are internally joined, as are B1/B2. The body also covers the middle column (at+1, rows e and f) — leave those two holes empty.',
  }),
  slide_switch: E({
    type: 'slide_switch',
    label: 'Slide switch (SPDT)',
    category: 'switch',
    placement: 'leads',
    pins: ['a', 'common', 'b'],
    params: [
      { key: 'state', label: 'Position', kind: 'select', default: 'a', options: ['a', 'b'], runtime: true },
    ],
    sim: { kind: 'device', model: 'slide_switch' },
    visual: { shape: 'slide' },
    support: LEGACY_SUPPORT.slide_switch,
    doc: 'SPDT slide switch with 3 leads: the common connects to lead a or lead b depending on the slider position. User-togglable during simulation.',
  }),
  dip_switch_8: E({
    type: 'dip_switch_8',
    label: 'DIP switch ×8',
    category: 'switch',
    placement: 'dip',
    pins: [
      '1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A',
      '8B', '7B', '6B', '5B', '4B', '3B', '2B', '1B',
    ],
    params: [
      { key: 'on', label: 'Switch states (1=on)', kind: 'text', default: '00000000', runtime: true },
    ],
    // explicit rect = the full DIP-16 package span (cols at..at+7 × rows e/f);
    // the rendered body stays inside the pin rows, so nothing beyond the pins
    bodyFootprint: { dCols: [0, 7], rows: ['e', 'f'] },
    sim: { kind: 'device', model: 'dip_switch_8' },
    visual: { shape: 'dipswitch' },
    support: LEGACY_SUPPORT.dip_switch_8,
    doc: 'Eight independent switches in a DIP-16 package. Switch n connects pin nA to pin nB when on. Perfect for setting BCD digit inputs by hand.',
  }),

  // ----------------------------------------------------- power / sources
  power_supply: E({
    type: 'power_supply',
    label: 'DC power supply',
    category: 'power',
    placement: 'offboard',
    pins: ['+', '-'],
    params: [
      { key: 'voltage', label: 'Voltage', kind: 'number', default: 5, min: 0, max: 15, step: 0.1, unit: 'V', runtime: true },
    ],
    sim: { kind: 'device', model: 'power_supply' },
    visual: { shape: 'psu' },
    support: LEGACY_SUPPORT.power_supply,
    doc: 'Adjustable bench DC supply, off-board. Wire its terminals ("ID:+" and "ID:-") to the power rails, e.g. {"from":"PS1:+","to":"top+0"}. Its "-" terminal defines circuit ground. Every circuit needs exactly one.',
  }),
  function_generator: E({
    type: 'function_generator',
    label: 'Function generator',
    category: 'power',
    placement: 'offboard',
    pins: ['out', 'gnd'],
    params: [
      { key: 'waveform', label: 'Waveform', kind: 'select', default: 'square', options: ['sine', 'square', 'triangle'], runtime: true },
      { key: 'frequency', label: 'Frequency', kind: 'number', default: 1, min: 0.01, max: 100000, unit: 'Hz', runtime: true },
      { key: 'amplitude', label: 'Amplitude (peak)', kind: 'number', default: 2.5, min: 0, max: 10, step: 0.1, unit: 'V', runtime: true },
      { key: 'offset', label: 'DC offset', kind: 'number', default: 2.5, min: -10, max: 10, step: 0.1, unit: 'V', runtime: true },
    ],
    sim: { kind: 'device', model: 'function_generator' },
    visual: { shape: 'fungen' },
    support: LEGACY_SUPPORT.function_generator,
    doc: 'Off-board signal source: out = offset + amplitude·wave(2π·f·t). Wire "ID:out" and "ID:gnd". Tie gnd to the supply ground rail.',
  }),

  // ----------------------------------------------------------- displays
  seven_segment: E({
    type: 'seven_segment',
    label: '7-segment display',
    category: 'display',
    placement: 'dip',
    pins: ['E', 'D', 'COM1', 'C', 'DP', 'B', 'A', 'COM2', 'F', 'G'],
    internalBridges: [['COM1', 'COM2']],
    // explicit rect = the DIP-10 package span (cols at..at+4 × rows e/f); the
    // rendered display body stays inside the pin rows, nothing beyond the pins
    bodyFootprint: { dCols: [0, 4], rows: ['e', 'f'] },
    sim: { kind: 'device', model: 'seven_segment' },
    visual: { shape: 'sevenseg' },
    support: LEGACY_SUPPORT.seven_segment,
    doc: 'Common-cathode single-digit 7-segment display (DIP-10, straddles the channel; `at` = pin E hole in row f). Segment pins A–G and DP are LED anodes (~2V forward); wire COM1 or COM2 to ground. Use series resistors on segment lines, or a CD4511/CD4026 driver.',
  }),
  buzzer: E({
    type: 'buzzer',
    label: 'Buzzer',
    category: 'display',
    placement: 'leads',
    pins: ['p1', 'p2'],
    sim: { kind: 'device', model: 'buzzer' },
    visual: { shape: 'buzzer' },
    support: LEGACY_SUPPORT.buzzer,
    doc: 'Simple buzzer (~300Ω load). Sounds when more than ~1V is applied (p1 positive).',
  }),

  // ----------------------------------------------------------------- ICs
  ne555: E({
    type: 'ne555',
    label: 'NE555 timer',
    category: 'ic',
    placement: 'dip',
    pins: ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THRES', 'DISCH', 'VCC'],
    sim: { kind: 'chip', model: 'ne555' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.ne555,
    // TI NE555: VCC 4.5–16 V recommended (abs max 18 V)
    ratings: { vddMin: 4.5, vddMax: 16 },
    doc: 'Classic 555 timer (DIP-8). Astable blinker: R_A from VCC to DISCH, R_B from DISCH to THRES, C from THRES to GND, tie TRIG to THRES, RESET to VCC. f ≈ 1.44/((R_A+2·R_B)·C). OUT drives loads directly.',
  }),
  lm358: E({
    type: 'lm358',
    label: 'LM358 dual op-amp',
    category: 'ic',
    placement: 'dip',
    pins: ['OUT1', 'IN1-', 'IN1+', 'GND', 'IN2+', 'IN2-', 'OUT2', 'VCC'],
    sim: { kind: 'chip', model: 'lm358' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.lm358,
    // TI LM358: single supply 3 V to 32 V (32 V = absolute maximum)
    ratings: { vddMin: 3, vddMax: 32 },
    doc: 'Dual single-supply op-amp (DIP-8). Output swings from 0V to about VCC−1.2V. Use as comparator or amplifier.',
  }),
  sn7400: E({
    type: 'sn7400',
    label: '7400 quad NAND',
    category: 'ic',
    placement: 'dip',
    pins: ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'],
    sim: { kind: 'chip', model: 'sn7400' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.sn7400,
    ratings: TTL_RATINGS,
    doc: 'Quad 2-input NAND gates (DIP-14). Gate n: inputs nA,nB → output nY. Power VCC (pin 14) and GND (pin 7) must be wired.',
  }),
  sn7404: E({
    type: 'sn7404',
    label: '7404 hex inverter',
    category: 'ic',
    placement: 'dip',
    pins: ['1A', '1Y', '2A', '2Y', '3A', '3Y', 'GND', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'VCC'],
    sim: { kind: 'chip', model: 'sn7404' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.sn7404,
    ratings: TTL_RATINGS,
    doc: 'Six independent inverters (DIP-14). nY = NOT nA.',
  }),
  sn7408: E({
    type: 'sn7408',
    label: '7408 quad AND',
    category: 'ic',
    placement: 'dip',
    pins: ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'],
    sim: { kind: 'chip', model: 'sn7408' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.sn7408,
    ratings: TTL_RATINGS,
    doc: 'Quad 2-input AND gates (DIP-14).',
  }),
  sn7432: E({
    type: 'sn7432',
    label: '7432 quad OR',
    category: 'ic',
    placement: 'dip',
    pins: ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'],
    sim: { kind: 'chip', model: 'sn7432' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.sn7432,
    ratings: TTL_RATINGS,
    doc: 'Quad 2-input OR gates (DIP-14).',
  }),
  sn7486: E({
    type: 'sn7486',
    label: '7486 quad XOR',
    category: 'ic',
    placement: 'dip',
    pins: ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'],
    sim: { kind: 'chip', model: 'sn7486' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.sn7486,
    ratings: TTL_RATINGS,
    doc: 'Quad 2-input XOR gates (DIP-14).',
  }),
  sn7474: E({
    type: 'sn7474',
    label: '7474 dual D flip-flop',
    category: 'ic',
    placement: 'dip',
    pins: ['1CLR', '1D', '1CLK', '1PRE', '1Q', '1QN', 'GND', '2QN', '2Q', '2PRE', '2CLK', '2D', '2CLR', 'VCC'],
    sim: { kind: 'chip', model: 'sn7474' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.sn7474,
    ratings: TTL_RATINGS,
    doc: 'Dual D flip-flop with async preset/clear, rising-edge clock (DIP-14). CLR and PRE are active-low — tie them to VCC when unused. Tie QN back to D for a divide-by-2 toggle.',
  }),
  cd4017: E({
    type: 'cd4017',
    label: 'CD4017 decade counter',
    category: 'ic',
    placement: 'dip',
    pins: ['Q5', 'Q1', 'Q0', 'Q2', 'Q6', 'Q7', 'Q3', 'VSS', 'Q8', 'Q4', 'Q9', 'CO', 'INH', 'CLK', 'RST', 'VDD'],
    sim: { kind: 'chip', model: 'cd4017' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.cd4017,
    ratings: CMOS4000B_RATINGS,
    doc: 'Johnson decade counter (DIP-16): one of Q0–Q9 goes high in sequence on each rising CLK edge. Tie INH and RST to GND for free running. Great for LED chasers.',
  }),
  cd4026: E({
    type: 'cd4026',
    label: 'CD4026 counter + 7-seg driver',
    category: 'ic',
    placement: 'dip',
    pins: ['CLK', 'INH', 'DEI', 'DEO', 'CO', 'F', 'G', 'VSS', 'D', 'A', 'E', 'B', 'C', 'UCS', 'RST', 'VDD'],
    sim: { kind: 'chip', model: 'cd4026' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.cd4026,
    ratings: CMOS4000B_RATINGS,
    doc: 'Decade counter with direct 7-segment outputs A–G (DIP-16) — drives a common-cathode display through ~330Ω resistors. CO emits one pulse per 10 counts (chain it to the next digit CLK). Tie DEI to VDD, INH and RST to GND.',
  }),
  cd4511: E({
    type: 'cd4511',
    label: 'CD4511 BCD→7-seg latch/decoder',
    category: 'ic',
    placement: 'dip',
    pins: ['B', 'C', 'LT', 'BL', 'LE', 'D', 'A', 'VSS', 'E_SEG', 'D_SEG', 'C_SEG', 'B_SEG', 'A_SEG', 'G_SEG', 'F_SEG', 'VDD'],
    sim: { kind: 'chip', model: 'cd4511' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.cd4511,
    ratings: CMOS4000B_RATINGS,
    doc: 'BCD-to-7-segment latch/decoder/driver (DIP-16) for common-cathode displays. BCD in on A(lsb) B C D(msb); segment outputs *_SEG drive the display through ~330Ω resistors. Tie LT and BL to VDD, LE to GND for transparent display. To show a fixed digit, tie A–D to VDD/GND in its BCD pattern — ideal for hardwired date displays.',
  }),
  sn74193: E({
    type: 'sn74193',
    label: '74193 4-bit up/down counter',
    category: 'ic',
    placement: 'dip',
    pins: ['B', 'QB', 'QA', 'DOWN', 'UP', 'QC', 'QD', 'GND', 'D', 'C', 'LOAD', 'CO', 'BO', 'CLR', 'A', 'VCC'],
    sim: { kind: 'chip', model: 'sn74193' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.sn74193,
    ratings: TTL_RATINGS,
    doc: 'Presettable 4-bit binary up/down counter (DIP-16). Rising edge on UP counts up (hold DOWN high), on DOWN counts down (hold UP high). LOAD (active low) presets QA–QD from inputs A–D; CLR high resets to 0.',
  }),
  cd4040: E({
    type: 'cd4040',
    label: 'CD4040 12-bit ripple counter',
    category: 'ic',
    placement: 'dip',
    pins: ['Q12', 'Q6', 'Q5', 'Q7', 'Q4', 'Q3', 'Q2', 'VSS', 'Q1', 'CLK', 'RST', 'Q9', 'Q8', 'Q10', 'Q11', 'VDD'],
    sim: { kind: 'chip', model: 'cd4040' },
    visual: { shape: 'dip' },
    bodyFootprint: 'auto', // plain DIP package: the body covers exactly its pin rect
    support: LEGACY_SUPPORT.cd4040,
    ratings: CMOS4000B_RATINGS,
    doc: '12-stage binary ripple counter (DIP-16), advances on the FALLING edge of CLK. Qn toggles at CLK/2^n — chain after a 555 to divide a fast clock down to ~1Hz. RST high clears.',
  }),

  // -------------------------------------------------------- instruments
  scope_probe: E({
    type: 'scope_probe',
    label: 'Oscilloscope probe',
    category: 'instrument',
    placement: 'probe',
    pins: ['tip'],
    params: [
      { key: 'channel', label: 'Channel', kind: 'number', default: 1, min: 1, max: 4, step: 1 },
    ],
    sim: { kind: 'probe' },
    visual: { shape: 'probe' },
    support: LEGACY_SUPPORT.scope_probe,
    doc: 'Oscilloscope probe: place its single hole on any net to plot that voltage on the scope panel (channels 1–4).',
  }),

  // ------------------------------------------------- embedded platform
  logic_probe: E({
    type: 'logic_probe',
    label: 'Logic analyzer probe',
    category: 'instrument',
    placement: 'probe',
    pins: ['tip'],
    params: [
      {
        key: 'channel',
        label: 'Channel',
        kind: 'select',
        default: 'D0',
        options: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'D14', 'D15'],
      },
    ],
    sim: { kind: 'probe' },
    visual: { shape: 'logic_probe' },
    support: {
      level: 'full',
      simulated: [
        'records logic edges of its net with exact timestamps when the net is MCU-driven or logic-resolvable',
        'thresholds analog nets (VIL 0.8 V / VIH 2.0 V, hysteresis) at the analog step resolution otherwise',
      ],
      limits: ['no loading of the probed net (ideal probe)'],
    },
    meta: { tags: ['logic analyzer', 'LA', 'digital', 'decoder', 'uart', 'i2c', 'spi'] },
    doc: 'Logic-analyzer probe: place its single hole on a net to record it as channel D0–D15 in the Logic Analyzer panel (UART/I²C/SPI decoding, VCD export). Draws no current.',
  }),
  multimeter: E({
    type: 'multimeter',
    label: 'Digital multimeter',
    category: 'instrument',
    placement: 'offboard',
    pins: ['COM', 'IN'],
    params: [
      { key: 'mode', label: 'Mode', kind: 'select', default: 'V', options: ['V', 'A', 'Ω'], runtime: true },
    ],
    sim: { kind: 'device', model: 'multimeter' },
    visual: { shape: 'dmm' },
    support: {
      level: 'full',
      simulated: [
        'V: 10 MΩ input impedance between IN and COM',
        'A: 0.1 Ω shunt in series (wire the meter IN SERIES with the load)',
        'Ω: 1 V / 10 kΩ ohmmeter source — reads the resistance between the probes',
        'the display is the mean over a ~100 ms gate of simulated time, like an integrating meter: a PWM signal reads its average (duty × high level)',
      ],
      limits: [
        'DC only (no AC RMS)',
        'Ω readings are invalid in a powered circuit, exactly like a real meter',
        'no fuse model: an A-mode meter across a supply is a short circuit',
      ],
    },
    meta: { tags: ['DMM', 'voltmeter', 'ammeter', 'ohmmeter', 'measure'] },
    doc: 'Bench digital multimeter (off-board, terminals COM and IN). Mode V measures voltage IN−COM (10 MΩ), mode A measures current through the meter (0.1 Ω — wire it in series), mode Ω measures resistance between the probes (unpowered circuit only).',
  }),
  stm32_bluepill: E({
    type: 'stm32_bluepill',
    label: 'STM32F103C8T6 Blue Pill',
    category: 'mcu',
    placement: 'footprint',
    // Board lies along the columns, micro-USB at the LEFT (pin-1 / low-column) end.
    // Near header (row h), left→right = pins 1..20; far header (row c),
    // right→left = pins 21..40 (counter-clockwise like a DIP).
    pins: [
      'PB12', 'PB13', 'PB14', 'PB15', 'PA8', 'PA9', 'PA10', 'PA11', 'PA12', 'PA15',
      'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'PB8', 'PB9', '5V', 'GND3', '3V3_2',
      'VBAT', 'PC13', 'PC14', 'PC15', 'PA0', 'PA1', 'PA2', 'PA3', 'PA4', 'PA5',
      'PA6', 'PA7', 'PB0', 'PB1', 'PB10', 'PB11', 'NRST', '3V3_1', 'GND2', 'GND1',
    ],
    footprintOffsets: [
      ...Array.from({ length: 20 }, (_, i) => ({ dCol: i, row: 'h' as const })),
      ...Array.from({ length: 20 }, (_, i) => ({ dCol: 19 - i, row: 'c' as const })),
    ],
    internalBridges: [
      ['GND1', 'GND2'],
      ['GND2', 'GND3'],
      ['3V3_1', '3V3_2'],
    ],
    // PCB 53 × 22.6 mm centered on the channel: covers strip rows b..i, leaving
    // one free hole (row a / row j) beside every header pin.
    bodyFootprint: { dCols: [0, 19], rows: ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] },
    // router obstacle height = the real mesh top: the BOOT jumper caps (2.5 mm
    // header spacer + 1.6 mm PCB + 2.5 mm header + 6 mm cap ≈ 12.6 mm ≈ 4.98
    // units — meshes/boards.ts BLUEPILL_MESH_TOP, asserted by the tests)
    obstacleHeight: 5.0,
    params: [
      { key: 'boot0', label: 'BOOT0 jumper', kind: 'select', default: '0', options: ['0', '1'], runtime: true },
    ],
    sim: { kind: 'chip', model: 'mcu-board' },
    visual: { shape: 'bluepill' },
    mcu: {
      model: 'stm32f103c8',
      pinMap: {
        PA0: 'PA0', PA1: 'PA1', PA2: 'PA2', PA3: 'PA3', PA4: 'PA4', PA5: 'PA5', PA6: 'PA6', PA7: 'PA7',
        PA8: 'PA8', PA9: 'PA9', PA10: 'PA10', PA11: 'PA11', PA12: 'PA12', PA15: 'PA15',
        PB0: 'PB0', PB1: 'PB1', PB3: 'PB3', PB4: 'PB4', PB5: 'PB5', PB6: 'PB6', PB7: 'PB7',
        PB8: 'PB8', PB9: 'PB9', PB10: 'PB10', PB11: 'PB11', PB12: 'PB12', PB13: 'PB13',
        PB14: 'PB14', PB15: 'PB15', PC13: 'PC13', PC14: 'PC14', PC15: 'PC15',
      },
      vddPin: '3V3_1',
      gndPin: 'GND1',
      resetPin: 'NRST',
      onBoard: { PC13: 'LED_PC13 (active low, via 510 Ω to 3.3 V)', PA12: '10 kΩ USB D+ pull-up (R10)' },
    },
    // On-board analog parts, modeled with the existing device models.
    subcircuit: [
      { id: 'REG', model: 'ldo', pins: ['5V', '3V3_1', 'GND1'], params: { vout: 3.3, dropout: 0.25, rout: 0.05, ilimit: 0.3 } },
      { id: 'LED_PWR', model: 'led', pins: ['3V3_1', '@pwr_k'], params: { color: 'red' } },
      { id: 'R_PWR', model: 'resistor', pins: ['@pwr_k', 'GND1'], params: { resistance: 1000 } },
      { id: 'LED_PC13', model: 'led', pins: ['3V3_1', '@pc13_k'], params: { color: 'green' } },
      { id: 'R_PC13', model: 'resistor', pins: ['@pc13_k', 'PC13'], params: { resistance: 510 } },
      { id: 'R_USB_DP', model: 'resistor', pins: ['PA12', '3V3_1'], params: { resistance: 10000 } },
    ],
    supplyPins: { plus: ['3V3_1', '5V'], minus: ['GND1'] },
    // MCU VDD on the 3.3 pins: 2.0–3.6 V (DS5319 Table 9). The 5V pin feeds
    // the on-board XC6206 ("662K") regulator, 6.0 V max input — checked by
    // the ERC through the REG sub-circuit element.
    ratings: { vddMin: 2.0, vddMax: 3.6 },
    pinInfo: [
      { pin: 'PB12', label: 'B12', kind: 'io', ft: true, functions: ['SPI2_NSS', 'I2C2_SMBA', 'USART3_CK', 'TIM1_BKIN'] },
      { pin: 'PB13', label: 'B13', kind: 'io', ft: true, functions: ['SPI2_SCK', 'USART3_CTS', 'TIM1_CH1N'] },
      { pin: 'PB14', label: 'B14', kind: 'io', ft: true, functions: ['SPI2_MISO', 'USART3_RTS', 'TIM1_CH2N'] },
      { pin: 'PB15', label: 'B15', kind: 'io', ft: true, functions: ['SPI2_MOSI', 'TIM1_CH3N'] },
      { pin: 'PA8', label: 'A8', kind: 'io', ft: true, functions: ['USART1_CK', 'TIM1_CH1', 'MCO'] },
      { pin: 'PA9', label: 'A9', kind: 'io', ft: true, functions: ['USART1_TX', 'TIM1_CH2'] },
      { pin: 'PA10', label: 'A10', kind: 'io', ft: true, functions: ['USART1_RX', 'TIM1_CH3'] },
      { pin: 'PA11', label: 'A11', kind: 'io', ft: true, functions: ['USART1_CTS', 'USBDM', 'CAN_RX', 'TIM1_CH4'] },
      { pin: 'PA12', label: 'A12', kind: 'io', ft: true, functions: ['USART1_RTS', 'USBDP', 'CAN_TX', 'TIM1_ETR'], note: 'Board R10 (10 kΩ) pulls PA12 up to 3.3 V (USB D+).' },
      { pin: 'PA15', label: 'A15', kind: 'io', ft: true, functions: ['JTDI', 'TIM2_CH1_ETR (remap)', 'SPI1_NSS (remap)'], note: 'JTAG JTDI after reset — release with AFIO SWJ_CFG (NOJTAG) to use as GPIO.' },
      { pin: 'PB3', label: 'B3', kind: 'io', ft: true, functions: ['JTDO', 'TIM2_CH2 (remap)', 'SPI1_SCK (remap)'], note: 'JTAG JTDO after reset — release with AFIO SWJ_CFG (NOJTAG).' },
      { pin: 'PB4', label: 'B4', kind: 'io', ft: true, functions: ['NJTRST', 'TIM3_CH1 (remap)', 'SPI1_MISO (remap)'], note: 'JTAG NJTRST after reset — release with AFIO SWJ_CFG.' },
      { pin: 'PB5', label: 'B5', kind: 'io', functions: ['I2C1_SMBA', 'TIM3_CH2 (remap)', 'SPI1_MOSI (remap)'] },
      { pin: 'PB6', label: 'B6', kind: 'io', ft: true, functions: ['I2C1_SCL', 'TIM4_CH1', 'USART1_TX (remap)'] },
      { pin: 'PB7', label: 'B7', kind: 'io', ft: true, functions: ['I2C1_SDA', 'TIM4_CH2', 'USART1_RX (remap)'] },
      { pin: 'PB8', label: 'B8', kind: 'io', ft: true, functions: ['TIM4_CH3', 'I2C1_SCL (remap)', 'CAN_RX (remap)'] },
      { pin: 'PB9', label: 'B9', kind: 'io', ft: true, functions: ['TIM4_CH4', 'I2C1_SDA (remap)', 'CAN_TX (remap)'] },
      { pin: '5V', label: '5V', kind: 'power', note: 'USB 5 V / regulator input (on-board 3.3 V LDO).' },
      { pin: 'GND3', label: 'G', kind: 'ground' },
      { pin: '3V3_2', label: '3.3', kind: 'power', note: 'Regulator output — or feed 3.3 V here directly.' },
      { pin: 'VBAT', label: 'VB', kind: 'power', note: 'Backup-domain supply (RTC/backup registers). Not modeled separately.' },
      { pin: 'PC13', label: 'C13', kind: 'io', functions: ['TAMPER-RTC'], note: 'On-board LED (active low). Low-current pin: sink ≤ 3 mA, ≤ 2 MHz.' },
      { pin: 'PC14', label: 'C14', kind: 'io', functions: ['OSC32_IN'], note: '32.768 kHz crystal on board; low-current pin.' },
      { pin: 'PC15', label: 'C15', kind: 'io', functions: ['OSC32_OUT'], note: '32.768 kHz crystal on board; low-current pin.' },
      { pin: 'PA0', label: 'A0', kind: 'io', functions: ['WKUP', 'USART2_CTS', 'ADC12_IN0', 'TIM2_CH1_ETR'] },
      { pin: 'PA1', label: 'A1', kind: 'io', functions: ['USART2_RTS', 'ADC12_IN1', 'TIM2_CH2'] },
      { pin: 'PA2', label: 'A2', kind: 'io', functions: ['USART2_TX', 'ADC12_IN2', 'TIM2_CH3'] },
      { pin: 'PA3', label: 'A3', kind: 'io', functions: ['USART2_RX', 'ADC12_IN3', 'TIM2_CH4'] },
      { pin: 'PA4', label: 'A4', kind: 'io', functions: ['SPI1_NSS', 'USART2_CK', 'ADC12_IN4'] },
      { pin: 'PA5', label: 'A5', kind: 'io', functions: ['SPI1_SCK', 'ADC12_IN5'] },
      { pin: 'PA6', label: 'A6', kind: 'io', functions: ['SPI1_MISO', 'ADC12_IN6', 'TIM3_CH1'] },
      { pin: 'PA7', label: 'A7', kind: 'io', functions: ['SPI1_MOSI', 'ADC12_IN7', 'TIM3_CH2'] },
      { pin: 'PB0', label: 'B0', kind: 'io', functions: ['ADC12_IN8', 'TIM3_CH3'] },
      { pin: 'PB1', label: 'B1', kind: 'io', functions: ['ADC12_IN9', 'TIM3_CH4'] },
      { pin: 'PB10', label: 'B10', kind: 'io', ft: true, functions: ['I2C2_SCL', 'USART3_TX', 'TIM2_CH3 (remap)'] },
      { pin: 'PB11', label: 'B11', kind: 'io', ft: true, functions: ['I2C2_SDA', 'USART3_RX', 'TIM2_CH4 (remap)'] },
      { pin: 'NRST', label: 'R', kind: 'control', note: 'Reset, active low (internal pull-up). Pull to GND to hold the MCU in reset.' },
      { pin: '3V3_1', label: '3.3', kind: 'power' },
      { pin: 'GND2', label: 'G', kind: 'ground' },
      { pin: 'GND1', label: 'G', kind: 'ground' },
    ],
    support: {
      level: 'partial',
      simulated: [
        'real firmware execution: ARMv7-M (Cortex-M3) instruction set, NVIC, SysTick, exceptions',
        'peripherals per the MCU support table (Inspector → Peripherals); unsupported blocks are logged on access',
        'GPIO electrical model: 50 Ω drivers, 40 kΩ pulls, datasheet VIL/VIH with hysteresis, overvoltage/short warnings',
        'on-board power LED, PC13 LED (510 Ω), 3.3 V LDO, PA12 10 kΩ pull-up',
      ],
      limits: [
        'USB, CAN and the system-memory bootloader (BOOT0 = 1) are not emulated',
        'instruction timing approximates the Cortex-M3 TRM (flash wait states not modeled)',
        "The MCU core's own supply current (IDD, about 20–36 mA at 72 MHz) is not simulated: a bench supply's current excludes the chip itself",
      ],
    },
    meta: {
      partNumber: 'STM32F103C8T6',
      manufacturer: 'STMicroelectronics (MCU) / generic board',
      sizeMm: [53, 22.6, 12.7],
      tags: ['stm32', 'blue pill', 'bluepill', 'arm', 'cortex-m3', 'microcontroller', 'mcu', 'f103'],
      specs: [
        'Cortex-M3 up to 72 MHz, 64 KiB flash, 20 KiB SRAM',
        '8 MHz HSE crystal, 32.768 kHz LSE crystal',
        '3× USART, 2× I²C, 2× SPI, 4 timers (TIM1 advanced), 2× 12-bit ADC, 7-ch DMA',
        'Powered from 5 V (on-board LDO) or 3.3 V pins',
      ],
      example: 'bluepill-blink',
    },
    doc: 'STM32F103C8T6 "Blue Pill" dev board running real firmware (load an ELF/BIN in the inspector). Place it straddling the channel with pins in rows h and c (anchor = PB12 in row h). Power: 5V pin (on-board 3.3 V regulator) or 3V3 pin, and GND. On-board LED on PC13 is active-low. GPIOs are 3.3 V; PA8–PA15 and PB3,PB4,PB6–PB15 are 5 V tolerant.',
  }),

  // ---- per-family part files (src/model/parts/*.parts.ts), appended in path order
  ...partsRecord(EXTRA_PARTS),
}

function partsRecord(parts: CatalogEntry[]): Record<string, CatalogEntry> {
  const out: Record<string, CatalogEntry> = {}
  for (const p of parts) out[p.type] = p
  return out
}

export function getEntry(type: string): CatalogEntry | undefined {
  return CATALOG[type]
}

export function paramDefault(entry: CatalogEntry, key: string): number | string | boolean | undefined {
  return entry.params?.find((p) => p.key === key)?.default
}

/** Effective param value with catalog default fallback. */
export function paramOf(
  params: Record<string, number | string | boolean> | undefined,
  entry: CatalogEntry,
  key: string,
): number | string | boolean | undefined {
  return params?.[key] ?? paramDefault(entry, key)
}

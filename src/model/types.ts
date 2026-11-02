/**
 * Core shared types for ohmlet.
 * CONTRACT FILE — do not modify without coordinating with the integrator.
 */

export const STRIP_ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const
export type StripRow = (typeof STRIP_ROWS)[number]

export type RailId = 'top+' | 'top-' | 'bot+' | 'bot-'
export const RAILS: RailId[] = ['top+', 'top-', 'bot+', 'bot-']

/** Board size presets. */
export type BoardSizeId = 'half' | 'standard' | 'labxl'

/**
 * The board presets: terminal-strip column count, holes per power rail, a
 * human label, and the marketing "point" count (which equals the total hole
 * count: 10 rows × cols + 4 rails × railHoles).
 */
export const BOARD_SIZES: Record<
  BoardSizeId,
  { cols: number; railHoles: number; label: string; points: number }
> = {
  half: { cols: 30, railHoles: 25, label: 'Half', points: 400 },
  standard: { cols: 63, railHoles: 50, label: 'Standard', points: 830 },
  labxl: { cols: 126, railHoles: 100, label: 'Lab XL', points: 1660 },
}

/** Type guard for BoardSizeId. */
export function isBoardSizeId(v: unknown): v is BoardSizeId {
  return v === 'half' || v === 'standard' || v === 'labxl'
}

/**
 * Maximum number of identical board modules that can be ganged side by side
 * into one rig (like bench-mounted lab stations).
 */
export const MAX_BOARD_COUNT = 6

/** Type guard for a valid module count (integer 1..MAX_BOARD_COUNT). */
export function isBoardCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_BOARD_COUNT
}

/**
 * Maximum number of BOARD-ROWS a rig can stack front-to-back (a 2-D grid:
 * up to MAX_BOARD_COUNT modules wide × MAX_BOARD_ROWS board-rows deep).
 */
export const MAX_BOARD_ROWS = 4

/** Type guard for a valid board-row count (integer 1..MAX_BOARD_ROWS). */
export function isBoardRows(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_BOARD_ROWS
}

/**
 * A full board rig: the size preset of each module, how many identical
 * modules are ganged side by side (1..MAX_BOARD_COUNT), and how many such
 * rig rows are stacked front-to-back (`rows`, 1..MAX_BOARD_ROWS).
 *
 * COLUMN NUMBERING IS CONTINUOUS across modules: module 2 of a 'standard' rig
 * starts at column 64 (total columns = size.cols × count). Rail hole indices
 * continue the same way (total rail holes = size.railHoles × count), and each
 * of the four rails stays ONE continuous bused net along the whole rig — the
 * modules are electrically joined like mounted lab stations.
 *
 * BOARD-ROWS (`rows`, 1..MAX_BOARD_ROWS; absent = 1, full back-compat with
 * the shipped 1-D rig) stack additional full rig rows front-to-back into a
 * 2-D grid: count modules wide × rows board-rows deep. Each board-row is a
 * complete rig row with its OWN four power rails — unlike the side-by-side
 * bus, rails on DIFFERENT board-rows are INDEPENDENT nets (like separate
 * breadboards on a bench): power must be jumpered between rows with wires.
 * Hole refs address rows with an optional 0-indexed prefix: the front row
 * (row 0) is bare ("a12", "top+5"); deeper rows are "1:a12", "2:top+5",
 * "3:j63". Column and rail ranges are identical on every row.
 */
export type BoardConfig = { size: BoardSizeId; count: number; rows?: number }

/**
 * Normalize a bare size id (= a single board) or a full config to a
 * BoardConfig. Lets board-size-aware helpers accept both forms. An absent
 * `rows` means 1 board-row (read it with `boardRowsOf`).
 */
export function asBoardConfig(c: BoardSizeId | BoardConfig): BoardConfig {
  return typeof c === 'string' ? { size: c, count: 1 } : c
}

/** Board-row count of a config (absent or malformed `rows` = 1, hardened). */
export function boardRowsOf(c: BoardSizeId | BoardConfig): number {
  if (typeof c === 'string') return 1
  return isBoardRows(c.rows) ? c.rows : 1
}

/**
 * Columns on the terminal strip area of the STANDARD board: 1..NUM_COLS.
 * @deprecated Use `BOARD_SIZES[boardOf(layout)].cols` — boards now come in
 * multiple sizes. Kept as the standard-board value for back-compat.
 */
export const NUM_COLS = BOARD_SIZES.standard.cols
/**
 * Holes per power rail on the STANDARD board: index 0..RAIL_HOLES-1 (grouped
 * in 5s visually).
 * @deprecated Use `BOARD_SIZES[boardOf(layout)].railHoles` — boards now come
 * in multiple sizes. Kept as the standard-board value for back-compat.
 */
export const RAIL_HOLES = BOARD_SIZES.standard.railHoles

export interface StripHole {
  kind: 'strip'
  col: number // 1..cols of the board preset (max 126 on 'labxl')
  row: StripRow
  /**
   * 0-indexed board-row of a 2-D grid (0 = front row). OPTIONAL — absent
   * means 0, the canonical form for the front row; every helper treats
   * absent and 0 identically. Bounds against a rig: 0..rows-1.
   */
  boardRow?: number
}
export interface RailHole {
  kind: 'rail'
  rail: RailId
  index: number // 0..railHoles-1 of the board preset (max 0..99 on 'labxl')
  /** 0-indexed board-row (absent = 0, the front row) — see StripHole.boardRow. */
  boardRow?: number
}
export type Hole = StripHole | RailHole

/**
 * Textual hole reference, the format used in the DSL / LLM output:
 *   strip holes:  "a12", "j63"  (row letter + column)
 *   rail holes:   "top+5", "bot-12" (rail id + index)
 *   board-row prefix (2-D grids): "1:a12", "2:top+5" — the prefix is the
 *     0-INDEXED board-row; the front row (row 0) is written bare. formatHole
 *     always emits the bare form for row 0 ("0:a12" parses but is
 *     non-canonical).
 * Syntax allows the maxima across board presets (columns 1..126, rail index
 * 0..99); whether a ref actually exists on a given board is a separate,
 * board-size-aware check (`isHoleOnBoard` in breadboard.ts).
 */
export type HoleRef = string

/**
 * A wire endpoint: either a HoleRef, or "<COMPONENT_ID>:<PIN_NAME>" for the
 * terminal of an off-board component (power supply, function generator).
 * Example: "PS1:+", "FG1:out".
 */
export type EndpointRef = string

export type ParamValue = number | string | boolean

/**
 * In-plane package rotation in quarter turns, CLOCKWISE in plan view
 * (columns increasing rightward, strip rows a→j increasing downward). Only
 * 'dip' and 'footprint' placements rotate; DIP packages allow only 0 | 180
 * (90/270 would fold both pin rows of the package into single strip columns,
 * shorting every opposite pin pair).
 */
export type Rotation = 0 | 90 | 180 | 270

/** Type guard for a Rotation value. */
export function isRotation(v: unknown): v is Rotation {
  return v === 0 || v === 90 || v === 180 || v === 270
}

export interface ComponentInstance {
  /** Unique id within the layout, e.g. "R1", "U2", "LED3". */
  id: string
  /** Catalog type key, e.g. "resistor", "ne555". */
  type: string
  params?: Record<string, ParamValue>
  /**
   * For placement 'leads' and 'probe': one HoleRef per lead, in catalog pin
   * order. (e.g. resistor: [hole of p1, hole of p2])
   */
  holes?: HoleRef[]
  /**
   * For placement 'dip' and 'footprint': the hole of PIN 1. For DIP packages
   * this MUST be in row 'f' (pins 1..N/2 run left→right along row f, pins
   * N/2+1..N run right→left along row e, straddling the center channel).
   */
  at?: HoleRef
  /**
   * For placement 'dip' and 'footprint' ONLY: in-plane rotation in quarter
   * turns, clockwise in plan view (absent = 0). DIP packages (including the
   * DIP-style seven_segment) allow only 0 | 180. At 180 a DIP occupies the
   * SAME holes — `at` still names the row-f hole at the LEFT end of the
   * package — but the pin walk reverses (pin 1 ends at the row-e right end).
   * A footprint part keeps pin 1 at `at` and rotates the remaining pin
   * offsets around it. Leads/probe/offboard parts reject the field.
   */
  rotation?: Rotation
  /**
   * For placement 'offboard' ONLY: explicit plan position of the instrument's
   * body anchor (hole-pitch units, snapped to the 0.5 grid). Absent = the
   * legacy slot-shelf formula (`offboardBodyPosition(slot)` — a pure function
   * of the unit's index among off-board components), so existing layouts
   * render identically. Validated by validateLayout (0.5-grid snap; the body
   * rect must not intersect the active rig's board extents nor another
   * instrument's body rect); round-trips export/import.
   */
  pos?: { x: number; z: number }
}

export interface Wire {
  id: string
  from: EndpointRef
  to: EndpointRef
  /** css-ish color name or hex; purely cosmetic */
  color?: string
}

export interface CircuitLayout {
  version: 1
  name?: string
  description?: string
  /** Board size preset. Absent = 'standard' (full backward compatibility). */
  board?: BoardSizeId
  /**
   * Number of identical board modules ganged side by side (integer
   * 1..MAX_BOARD_COUNT). Absent = 1 — a single board, full backward
   * compatibility. Column numbering and rail indices run CONTINUOUSLY across
   * modules and the rails are bused into single nets (see BoardConfig).
   */
  boardCount?: number
  /**
   * Number of board-rows stacked front-to-back (integer 1..MAX_BOARD_ROWS).
   * Absent = 1 — the shipped single-row rig, full backward compatibility.
   * Each board-row is a full rig row with its own four power rails; rails on
   * different board-rows are INDEPENDENT nets (jumper power between rows).
   * Hole refs on rows beyond the first carry the "1:" / "2:" / "3:" prefix
   * (0-indexed board-row; the front row is bare). See BoardConfig.
   */
  boardRows?: number
  components: ComponentInstance[]
  wires: Wire[]
}

/** The board size a layout is laid out for (absent board = 'standard'). */
export function boardOf(layout: Pick<CircuitLayout, 'board'>): BoardSizeId {
  return layout.board ?? 'standard'
}

/**
 * The full board rig a layout is laid out for: size preset (absent =
 * 'standard') + module count + board-row count (absent or out-of-range = 1;
 * hardened so a malformed count can never produce a bogus rig downstream).
 * Always returns an explicit `rows`.
 */
export function boardConfigOf(
  layout: Pick<CircuitLayout, 'board' | 'boardCount' | 'boardRows'>,
): Required<BoardConfig> {
  return {
    size: layout.board ?? 'standard',
    count: isBoardCount(layout.boardCount) ? layout.boardCount : 1,
    rows: isBoardRows(layout.boardRows) ? layout.boardRows : 1,
  }
}

// ---------------------------------------------------------------------------
// Simulation telemetry (engine → UI / 3D)
// ---------------------------------------------------------------------------

export interface ComponentTelemetry {
  /** pin name → node voltage (V) */
  pinVoltages: Record<string, number>
  /**
   * main branch current (A) where meaningful (2-lead devices). LEDs (the 5 mm
   * LED, every board's on-board LED, the RGB LED): eye-averaged — the MEAN
   * over the last 20 ms of simulated time (devices.ts LED_EYE_S, LedWindow),
   * so a PWM-driven LED reports its average current (what the eye and an
   * ammeter see) and a slow blinker reads on or off; `power`, `light` and
   * the RGB LED's `leds` / `rgb` / values iR·iG·iB are eye means too. A
   * steady LED reads the same as an instant sample.
   */
  current?: number
  power?: number
  /**
   * 0..1 visual brightness for LEDs: the INSTANT current / 10 mA, clamped
   * (the engine's per-step value). The classic chrome shows this scale of
   * the eye-averaged `current` instead (src/instruments/led-light.ts
   * classicLedBrightness), so its Current and Brightness rows agree.
   */
  ledBrightness?: number
  /** latched true when an LED exceeded its max current */
  burned?: boolean
  /** 7-segment display: segment name (a..g, dp) → lit */
  segments?: Record<string, boolean>
  /**
   * 7-segment display: each segment's relative luminous intensity, like an
   * LED's `light` — its junction current / the rated 20 mA, rounded to
   * 0.001, NOT clamped (> 1 = over-driven). Absent = the model does not
   * publish per-segment light (the 3D view then shows an honest ON).
   */
  segmentLight?: Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'dp', number>
  /** chip logic outputs: pin name → high/low (for visualization) */
  outputs?: Record<string, boolean>
  /** pushbutton runtime state echo */
  pressed?: boolean
  /** buzzer is audibly driven */
  sounding?: boolean
  /**
   * LED-like emitters: relative luminous intensity = forward current / the
   * part's rated continuous current (20 mA for a 5 mm LED). 0 = dark, 1 =
   * rated (full, dazzling), > 1 = over-driven (published unclamped so the
   * 3D view can show the harsh over-drive look). Light output of an LED is
   * close to linear in its current; the 3D view maps it perceptually.
   * Eye-averaged: the mean current over the last 20 ms of simulated time
   * (see `current`), so a PWM LED fades instead of strobing. Rounded to 0.001.
   * Absent = the model does not emit light.
   */
  light?: number
  /**
   * Thermal stress of a part with a thermal model (first-order filter of the
   * dissipated power the solver computes), published only from 0.5 on
   * (rounded to 0.01):
   *  - a resistor with a power rating: body temperature rise / the rise at
   *    rated power (RES_THERMAL_TAU = 10 s); 1 = at the rating, > 1 hotter
   *    than the part is made for (it burns open at 10);
   *  - an LED: junction temperature rise / the rise at its 100 °C maximum
   *    junction temperature (LED_THERMAL_TAU = 5 s); 1 = 100 °C
   *    (overheating), ≈ 1.67 = 150 °C (it burns open).
   */
  heat?: number
  /**
   * Damage the part's OWN model latched (or a hot state it is in): only
   * from real electrical conditions, cleared when the simulation is reset /
   * rebuilt (a fresh model) — see PartDamage.
   */
  damage?: PartDamage

  // ---- embedded-platform extensions (all optional, additive) ----
  /**
   * Board-level sub-circuit elements (CatalogEntry.subcircuit), keyed by
   * element id — e.g. a Blue Pill's on-board 'LED_PC13' / 'LED_PWR'
   * (ledBrightness) or its regulator.
   */
  sub?: Record<string, ComponentTelemetry>
  /** MCU boards: execution state for the 3D model, inspector and status UI */
  mcu?: McuTelemetry
  /** display modules: framebuffer snapshot (bump `version` on change) */
  display?: DisplayTelemetry
  /**
   * sensors / motors / instruments: named scalar outputs (angle, rpm,
   * distance, reading…). LEDs: `iPeak` (A) — present only while the eye
   * means (`current`, `light`) average a SWITCHING current (PWM / a blink:
   * a whole on or off phase inside the 20 ms eye window and a whole on/off
   * cycle within two windows, i.e. 25 Hz or faster), the highest
   * instantaneous current in the window; every reader then says
   * 平均 / average (src/instruments/led-light.ts isAveragedLed: the
   * inspector's 電流 / 功率 / 亮度 rows with 「峰值」, the board's on-board
   * LEDs, the 3D LED label). RGB LED: iR / iG / iB (die eye means, A), burnedR /
   * burnedG / burnedB = 1 for each die its model burned out.
   */
  values?: Record<string, number>
  /** addressable / RGB LEDs: packed 0xRRGGBB per LED (linear brightness already applied) */
  rgb?: number[]
  /** named LED channels 0..1 (multi-LED parts) */
  leds?: Record<string, number>
  /** multimeter / text displays: preformatted lines */
  text?: string[]
  /**
   * Terminal currents (A) the solver knows, keyed by catalog pin name;
   * positive = conventional current flowing INTO the part at that pin; the
   * mean over the telemetry window. Only pins whose current is computed from
   * the real stamps appear: an ABSENT pin is UNKNOWN, never 0. A region
   * whose loop cannot be closed honestly is published as unknown, whole: a
   * net with an unknown pin or whose pin currents miss Kirchhoff's current
   * law by more than 2.5 µA (current-tracker.ts KCL_HIDE_A), plus every part
   * and net exchanging ≥ 2.5 µA with it; a chip whose output current had no
   * honest return path stays unknown for 3 s of simulated time
   * (SimTelemetry.flowConcealed names them). Present only while current
   * tracking (顯示電流) is on. Drives the 顯示電流 flow layer.
   */
  pinCurrents?: Record<string, number>
}

/**
 * A damage state a part's simulation model reports (ComponentTelemetry.damage):
 *  - 'burned'      destroyed by over-current / over-power (an LED's die, a
 *                  resistor burned open) — latched;
 *  - 'overheating' dissipating beyond its rating right now (hot, smoking),
 *                  not yet destroyed — clears when it cools;
 *  - 'vented'      an electrolytic capacitor's vent opened (reverse
 *                  voltage) — latched;
 *  - 'overvoltage' / 'overcurrent'  a pin driven beyond its absolute maximum
 *                  rating — the simulation no longer guarantees the part's
 *                  behaviour — latched.
 * `since` = simulation time (s) the state began.
 */
export interface PartDamage {
  kind: 'burned' | 'overheating' | 'vented' | 'overvoltage' | 'overcurrent'
  since: number
  /** the pins concerned (IC pin damage), catalog pin names */
  pins?: string[]
}

/** MCU execution state published with a board's telemetry. */
export interface McuTelemetry {
  state:
    | 'no-firmware'
    | 'unpowered'
    | 'reset'
    | 'running'
    | 'sleeping'
    | 'halted'
    | 'lockup'
  /** firmware display name, if loaded */
  firmware?: string
  pc: number
  hclkHz: number
  cycles: number
  /**
   * catalog pin name → short mode tag. GPIO: 'in', 'in↑', 'in↓', 'an', 'out',
   * 'od', 'af', 'af-od'. Non-GPIO pins: 'pwr', 'gnd', 'rst', 'nc'.
   */
  pinModes?: Record<string, string>
  /** achieved speed vs real time over the last second (1 = real time) */
  realtime?: number
}

/**
 * Display framebuffer snapshot.
 *  'mono-pages' — SSD1306/SH1106 GDDRAM: (height/8) pages × width bytes, LSB = top pixel of the page
 *  'rgb565'     — width×height 16-bit pixels, row-major
 *  'chars'      — character LCD: `text` rows (HD44780 DDRAM projection)
 */
export interface DisplayTelemetry {
  version: number
  width: number
  height: number
  format: 'mono-pages' | 'rgb565' | 'chars'
  data?: Uint8Array
  text?: string[]
  /** panel powered and display ON */
  on: boolean
  /** 0..1 */
  contrast?: number
  /** backlight 0..1 (LCDs) */
  backlight?: number
  /** horizontal/vertical flip as programmed (SEG remap / COM scan) */
  flipX?: boolean
  flipY?: boolean
  /** inverted display mode */
  invert?: boolean
}

export interface SimIssue {
  level: 'error' | 'warning'
  message: string
  componentId?: string
}

export interface SimTelemetry {
  time: number
  /** net id → voltage (V) */
  netVoltages: Record<string, number>
  components: Record<string, ComponentTelemetry>
  issues: SimIssue[]
  /**
   * Wire id → current through that wire (A), signed: positive = conventional
   * current flowing from the wire's `from` end to its `to` end. Solved per net
   * from KCL with the pin currents at its holes / terminals (wires and strip
   * metal as small length-proportional resistances). Absent wire = UNKNOWN,
   * never 0: every wire of a net with an unknown pin current (a concealed
   * region — see ComponentTelemetry.pinCurrents) is left out. Present only
   * while current tracking (顯示電流) is on.
   */
  wireCurrents?: Record<string, number>
  /**
   * Breadboard strip / rail metal between two used holes, keyed
   * "<holeA>><holeB>" (canonical hole refs joined by '>', e.g. "c12>e12",
   * "top+3>top+10", "1:a5>1:d5") → current (A), positive = from holeA to
   * holeB. Same KCL solve as wireCurrents; only segments carrying more than
   * 1 nA are listed. A missing segment carries no current only on a net
   * whose currents are known: on a concealed net (an unknown pin current)
   * nothing is listed and the metal's current is UNKNOWN. Published together
   * with wireCurrents.
   */
  stripCurrents?: Record<string, number>
  /**
   * Current tracking (顯示電流): ids of the parts whose current loop could
   * not be closed honestly in this window, so the flow layer shows nothing
   * for them (their pinCurrents are partly absent). The chips whose output
   * current has no honest return path come first (the cause — e.g. a
   * legacy chip fed through a resistor), then every part concealed with
   * them. Absent = every loop closes (or tracking is off).
   */
  flowConcealed?: string[]
}

/** One oscilloscope sample: time + voltage per channel (1..4 → index 0..3). NaN = channel unattached. */
export interface ScopeSample {
  t: number
  v: [number, number, number, number]
}

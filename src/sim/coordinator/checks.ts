/**
 * Firmware-contract runner: evaluates a project's machine-checkable
 * `checks` (firmware/README.md, "The expect contract") against REAL firmware
 * executing on the simulated Blue Pill inside a SimulationCoordinator.
 *
 * The bench (`checksLayout`): a Blue Pill (U1) straddling the channel of a
 * standard breadboard, a 5 V power_supply into its 5V pin and GND, the
 * board 3V3 on the top+ rail, plus the loads the project's `circuit` lines
 * name (LED + series resistor to GND, pull-up to 3V3, pull-down to GND,
 * serial ICs — an AT24C02 EEPROM on SCL/SDA, a 74HC595 on SRCLK/SER/RCLK
 * with an LED per output — and jumper wires between header pins; the
 * phrasings are listed in firmware/README.md "The expect contract").
 * Push-buttons are not placed: every pin a scenario drives gets a test
 * STIMULUS (./stimulus — 50 Ω to VSS / VDD or released, acting on the net
 * through the analog stamp and the logic layer, never on MCU registers).
 *
 * Every run (the free-running "baseline" and each scenario) starts from
 * power-on in a fresh coordinator:
 *   - reset = the analog solve in which VDD first crosses the POR level
 *     (the board's power supervisor, ./mcu-board);
 *   - t0 = reset + settleMs ('settle') or the instant the named port
 *     reports its FIRST transmitted byte ('uart:<port>', the stop-bit end
 *     reported through SimulationCoordinator.addUartListener);
 *   - drives are scheduled at t0 + at on the coordinator event queue
 *     (exact virtual time); UART drives go through SimulationCoordinator
 *     .uartSend — the terminal's USB-TTL adapter puts real UART frames on
 *     the USART's RX pin at the firmware's line settings (./uart-adapter);
 *   - pins are observed by the logic recorder on MCU-pin channels (exact
 *     edge times: drive edges for outputs, Schmitt-input edges for inputs),
 *     UART bytes by the time-stamped UART listener.
 * Each rule yields an outcome with expected vs measured values and times
 * (ms relative to t0). Nothing here imitates behavior: every observation is
 * what the simulated MCU and circuit produced.
 *
 * Rule semantics beyond the README text (documented here so a report can be
 * read without the code):
 *   - `pins`, `uart` (line config), `hclkHz` are sampled at reset + settleMs
 *     and again at the end of the baseline;
 *   - `idle` holds from reset + settleMs to the end of the baseline;
 *   - a `square` signal needs at least three edges in the baseline (both
 *     phases measured edge to edge) and may not stop toggling: the time
 *     since its last edge must stay below that phase + tolerance;
 *   - a periodic UART signal may not miss a line: the time since its last
 *     line must stay below everyMs + tolerance; in the baseline every line
 *     after the boot text must belong to a periodic signal of that port
 *     (when the port has one);
 *   - `every` expectations need ≥ 2 edges, and the gaps from the window
 *     start to the first edge and from the last edge to the window end are
 *     at most one period (+ tolerance);
 *   - `quiet`: edges matched by an edge expectation, inside an `every`
 *     window, or belonging to an `always` square signal are expected;
 *     bytes of the boot text, of matched uart expectations and of `always`
 *     periodic lines are expected;
 *   - UART texts may finish after `durationMs`: the run continues for
 *     UART_TAIL_MS so a text whose first byte lies inside its window can
 *     complete; edges and bytes after durationMs are not evaluated.
 */
import type { CircuitLayout, ComponentInstance, Wire } from '../../model/types'
import { componentPinHoles, formatHole } from '../../model/breadboard'
import { getEntry } from '../../model/catalog'
import type { FirmwareImage } from '../../mcu/firmware'
import type { McuDevice, UartLineConfig } from '../../mcu/mcu-api'
import {
  PIN_ANALOG,
  PIN_IN_FLOAT,
  PIN_IN_PULLDOWN,
  PIN_IN_PULLUP,
  PIN_OUT_OD,
  PIN_OUT_PP,
} from '../../mcu/pins'
import type { PinDriveState } from '../../mcu/pins'
import type { LogicChannelConfig } from './api'
import { MAX_ANALOG_DT, SimulationCoordinator } from './coordinator'
import { StimulusPlan, isStimulusLevel } from './stimulus'
import type { StimulusAction, StimulusLevel } from './stimulus'

// ================================================================ schema

/** Resolved PinDriveState names used by `checks.pins`. */
export type PinRole =
  | 'analog'
  | 'input-floating'
  | 'input-pullup'
  | 'input-pulldown'
  | 'output-pp'
  | 'output-od'
  | 'af-pp'
  | 'af-od'

/** [from, to] in ms (relative to t0 or to a referenced event). */
export type CheckWindow = [number, number]

export interface UartLineSpec {
  tx?: string
  rx?: string
  baud?: number
  dataBits?: number
  parity?: 'none' | 'even' | 'odd'
  stopBits?: number
}

export type BootSpec = string | { match: string }

/** One `signals` entry (the kind follows from its keys, see the README table). */
export interface SignalSpec {
  pin?: string
  pins?: string[]
  uart?: string
  square?: [number, number]
  tolUs?: number
  firstEdge?: 0 | 1
  firstEdgeAt?: CheckWindow
  invertOf?: string
  sameAs?: string
  skewUs?: number
  edgesAfter?: string
  maxLagUs?: number
  oneHot?: boolean
  lines?: string
  match?: string
  nFrom?: number
  firstAt?: CheckWindow
  everyMs?: number
  afterEdgeOf?: string
  lagMs?: CheckWindow
  always?: boolean
}

export interface DriveSpec {
  at: number
  pin?: string
  level?: StimulusLevel
  uart?: string
  text?: string
}

export interface ExpectSpec {
  id?: string
  from?: string
  at: CheckWindow
  pin?: string
  edge?: 0 | 1
  level?: 0 | 1
  every?: number
  uart?: string
}

export interface ScenarioSpec {
  name: string
  durationMs: number
  drive?: DriveSpec[]
  expect?: ExpectSpec[]
  quiet?: string[]
}

export interface FirmwareChecks {
  hclkHz?: number
  settleMs?: number
  t0?: string
  circuit?: string[]
  pins?: Record<string, PinRole>
  uart?: Record<string, UartLineSpec>
  boot?: Record<string, BootSpec>
  idle?: Record<string, 0 | 1>
  signals?: SignalSpec[]
  scenarios?: ScenarioSpec[]
}

/** One firmware/dist/manifest.json entry. */
export interface ManifestEntry {
  kind?: string
  description?: string
  expect?: string
  checks?: FirmwareChecks
}

// ================================================================ report

export interface CheckOutcome {
  /** rule id, e.g. 'pins PA5', 'signal[0] PB13 square', 'expect[2] PA5 edge↑', 'quiet USART1' */
  rule: string
  ok: boolean
  /** expected vs measured, times in ms relative to t0 */
  message: string
}

export interface RunReport {
  /** 'baseline' or the scenario name */
  name: string
  ok: boolean
  /** absolute sim time (ms) of power-on reset and of t0 (null: never reached) */
  resetMs: number | null
  t0Ms: number | null
  /** observed span after t0 (ms) */
  durationMs: number
  outcomes: CheckOutcome[]
  /** MCU / simulator log lines at warning or error level */
  log: string[]
  /** wall-clock time spent (ms) */
  wallMs: number
}

export interface ChecksReport {
  project: string
  ok: boolean
  runs: RunReport[]
  /** every failed outcome as '<run>: <rule>: <message>' */
  failures: string[]
  /** how the bench was built (wired loads, stimulus pins, circuit lines not modeled) */
  bench: string[]
}

export interface RunChecksOptions {
  /** project name used in the report (default 'firmware') */
  name?: string
  /** run only the scenarios with these names (default: all) */
  scenarios?: string[]
  /** skip the free-running baseline run */
  skipBaseline?: boolean
  /** baseline length after t0 (ms); default: derived from the signals (see baselineDurationMs) */
  baselineMs?: number
  /** coordinator factory (default: a plain SimulationCoordinator) */
  coordinator?: () => SimulationCoordinator
  /** called after every run (progress) */
  onRun?: (run: RunReport) => void
}

// ============================================================ constants

/** Component id of the board under test in the generated layout. */
export const CHECK_BOARD_ID = 'U1'
/** Edge-time slack for window comparisons (ms): 1 ps, far below any MCU cycle. */
const EPS = 1e-9
/** Default `every` / pairing tolerance when no signal states one (µs) — README. */
const DEFAULT_TOL_US = 20
/** Simulated time after durationMs so UART texts that started in time can finish (ms). */
export const UART_TAIL_MS = 25
/** How long after reset a 'uart:<port>' time origin may take (ms, on top of settleMs). */
const T0_TIMEOUT_MS = 2000
/** Shortest baseline after t0 (ms). */
const MIN_BASELINE_MS = 200
/** Longest derived baseline (ms). */
const MAX_BASELINE_MS = 30_000
/** Logic-analyzer channels available (LogicChannelConfig.index 0..15). */
const MAX_CHANNELS = 16

type Level = 0 | 1 | 2

// ======================================================== bench layout

export interface ChecksBench {
  layout: CircuitLayout
  /** human-readable bench description lines */
  notes: string[]
  /** pins driven by any scenario (they get a stimulus) */
  stimulusPins: string[]
}

const LED_COLORS = ['red', 'green', 'yellow', 'blue', 'white'] as const

/** The board under test as placed by `checksLayout`. */
const CHECK_BOARD: ComponentInstance = { id: CHECK_BOARD_ID, type: 'stm32_bluepill', at: 'h10' }

/**
 * The free breadboard hole on the strip of a Blue Pill header pin in the
 * `checksLayout` bench (row j beside the h-row header, row a beside the
 * c-row header) — where a test or lesson wires extra parts to that pin.
 */
export function checkBoardTap(pin: string): string {
  const entry = getEntry(CHECK_BOARD.type)
  if (!entry) throw new Error('catalog has no stm32_bluepill')
  const i = entry.pins.indexOf(pin)
  const h = i >= 0 ? componentPinHoles(CHECK_BOARD, entry)?.[i] : null
  if (!h || h.kind !== 'strip') throw new Error(`no header hole for ${pin}`)
  return formatHole({ ...h, row: h.row === 'c' ? 'a' : 'j' })
}

function parseOhms(num: string, kilo: string | undefined): number {
  const v = parseFloat(num)
  return kilo ? v * 1000 : v
}

/**
 * Build the test bench of a project: Blue Pill U1 at h10 on a standard
 * board (header pins in rows h and c; every strip keeps one free hole in
 * row j / a), bench supply PS1 5 V → 5V pin, PS1− and GND3 → top− rail,
 * 3V3 → top+ rail, plus the loads named by `checks.circuit`.
 */
export function checksLayout(checks: FirmwareChecks, name = 'firmware'): ChecksBench {
  const board: ComponentInstance = { ...CHECK_BOARD }
  const entry = getEntry(board.type)
  if (!entry) throw new Error('catalog has no stm32_bluepill')
  const tap = checkBoardTap
  const notes: string[] = ['U1 stm32_bluepill at h10, PS1 5 V → 5V pin, GND → top− rail, 3V3 → top+ rail']
  const comps: ComponentInstance[] = [{ id: 'PS1', type: 'power_supply', params: { voltage: 5 } }, board]
  let wseq = 0
  const wires: Wire[] = []
  const wire = (from: string, to: string): void => {
    wires.push({ id: `W${++wseq}`, from, to })
  }
  wire('PS1:+', tap('5V'))
  wire('PS1:-', 'top-0')
  wire(tap('GND3'), 'top-1')
  wire(tap('3V3_1'), 'top+0')

  // loads from the circuit lines: column X (wire + first lead) and X+2
  let col = 33
  let rail = 10
  let nR = 0
  let nD = 0
  let nU = 1 // U1 is the board
  let bot = 10
  let botLinked = false
  /** header holes already wired (the board body covers rows b–i: ONE free hole per pin) */
  const usedTaps = new Set<string>()
  const takeTap = (line: string, pin: string): string | null => {
    if (entry.pins.indexOf(pin) < 0) {
      notes.push(`circuit "${line}": ${pin} is not a Blue Pill header pin — not wired`)
      return null
    }
    const h = tap(pin)
    if (usedTaps.has(h)) {
      notes.push(`circuit "${line}": ${pin} is already wired by an earlier circuit line (one free hole per header pin) — not wired`)
      return null
    }
    usedTaps.add(h)
    return h
  }
  const topRail = (sign: '+' | '-'): string => `top${sign}${rail++}`
  const botGnd = (): string => {
    if (!botLinked) {
      botLinked = true
      wire('top-2', 'bot-0') // ground on the bottom rail too
    }
    return `bot-${bot++}`
  }
  for (const line of checks.circuit ?? []) {
    const m = /^\s*([^:]+):\s*(.*)$/.exec(line)
    const pins = m ? m[1].split(/[\s,]+/).filter((p) => /^P[A-E]\d{1,2}$/.test(p)) : []
    const body = (m ? m[2] : line).toLowerCase()
    const led = /\b(?:(red|green|yellow|blue|white)\s+)?led\s*\+\s*(\d+(?:\.\d+)?)\s*(k)?\s*(?:ohm|Ω)\s+to\s+gnd\b/.exec(body)
    const pullUp = /(\d+(?:\.\d+)?)\s*(k)?\s*(?:ohm|Ω)\s+pull-?up\s+to\s+3v3\b/.exec(body)
    const pullDown = /(\d+(?:\.\d+)?)\s*(k)?\s*(?:ohm|Ω)\s+pull-?down\s+to\s+gnd\b/.exec(body)
    const ic = /^\s*(at24c02|74hc595)\b/.exec(body)
    if (m && m[1].includes('->') && /^\s*jumper(?:\s+wire)?\s*$/.test(body)) {
      // "PA6 -> PA0: jumper wire" — a wire between the two header strips
      const ends = m[1].split('->').map((s) => s.trim())
      if (ends.length !== 2 || !ends.every((p) => /^P[A-E]\d{1,2}$/.test(p))) {
        notes.push(`circuit "${line}": a jumper line names two header pins ("PA6 -> PA0: jumper wire") — not wired`)
        continue
      }
      const ha = takeTap(line, ends[0])
      const hb = takeTap(line, ends[1])
      if (!ha || !hb) continue
      wire(ha, hb)
      notes.push(`${ends[0]} → ${ends[1]}: jumper wire ${ha} – ${hb}`)
    } else if (ic && ic[1] === 'at24c02') {
      // "PB6, PB7: AT24C02 (A2-A0, WP to GND) + 4.7k pull-ups to 3V3" — pins in order SCL, SDA
      if (pins.length !== 2) {
        notes.push(`circuit "${line}": an AT24C02 line names its SCL and SDA pins, in that order ("PB6, PB7: AT24C02 …") — not wired`)
        continue
      }
      const c = col
      if (c + 3 > 63 || rail + 7 > 49) {
        notes.push(`circuit "${line}": no free breadboard space left for the AT24C02 — not wired`)
        continue
      }
      const scl = takeTap(line, pins[0])
      const sda = takeTap(line, pins[1])
      if (!scl || !sda) continue
      const id = `U${++nU}`
      // DIP-8 at f{c}: A0 f c, A1 f c+1, A2 f c+2, GND f c+3, SDA e c+3, SCL e c+2, WP e c+1, VCC e c
      comps.push({ id, type: 'at24c02', at: `f${c}` })
      wire(`a${c}`, topRail('+')) // VCC = board 3V3
      wire(`j${c + 3}`, topRail('-')) // GND
      for (let k = 0; k < 3; k++) wire(`j${c + k}`, topRail('-')) // A0–A2 low: address 0x50
      const wpHigh = /\bwp\s+(?:high|to\s+3v3)\b/.test(body)
      wire(`a${c + 1}`, topRail(wpHigh ? '+' : '-')) // WP
      wire(`a${c + 2}`, scl)
      wire(`a${c + 3}`, sda)
      const pu = /(\d+(?:\.\d+)?)\s*(k)?\s*(?:ohm|Ω)?\s*pull-?ups?\s+to\s+3v3\b/.exec(body)
      let puText = ' — no pull-ups'
      if (pu) {
        const ohms = parseOhms(pu[1], pu[2])
        comps.push({ id: `R${++nR}`, type: 'resistor', holes: [`b${c + 2}`, topRail('+')], params: { resistance: ohms } })
        comps.push({ id: `R${++nR}`, type: 'resistor', holes: [`b${c + 3}`, topRail('+')], params: { resistance: ohms } })
        puText = ` + ${ohms} Ω pull-ups to 3V3`
      }
      notes.push(`${pins[0]} (SCL), ${pins[1]} (SDA): ${id} AT24C02 at f${c}, A2–A0 GND, WP ${wpHigh ? '3V3' : 'GND'}, VCC 3V3${puText}`)
      col += 5
    } else if (ic && ic[1] === '74hc595') {
      // "PA5, PA7, PA4: 74HC595 (…), QA-QH: LED + 220 ohm to GND" — pins in order SRCLK, SER, RCLK
      if (pins.length !== 3) {
        notes.push(`circuit "${line}": a 74HC595 line names its SRCLK, SER and RCLK pins, in that order ("PA5, PA7, PA4: 74HC595 …") — not wired`)
        continue
      }
      const leds = /\bq[a-h]\s*[-–]\s*q[a-h]\s*:\s*(?:(red|green|yellow|blue|white)\s+)?led\s*\+\s*(\d+(?:\.\d+)?)\s*(k)?\s*(?:ohm|Ω)\s+to\s+gnd\b/.exec(body)
      const c = col
      const width = leds ? 15 : 8 // DIP-16 (8 columns) + 7 LED junction columns
      if (c + width - 1 > 63 || rail + 13 > 49) {
        notes.push(`circuit "${line}": no free breadboard space left for the 74HC595 — not wired`)
        continue
      }
      const srclk = takeTap(line, pins[0])
      const ser = takeTap(line, pins[1])
      const rclk = takeTap(line, pins[2])
      if (!srclk || !ser || !rclk) continue
      const id = `U${++nU}`
      // DIP-16 at f{c}: QB…QH f c…c+6, GND f c+7; QH' e c+7, SRCLR e c+6,
      // SRCLK e c+5, RCLK e c+4, OE e c+3, SER e c+2, QA e c+1, VCC e c
      comps.push({ id, type: '74hc595', at: `f${c}` })
      wire(`a${c}`, topRail('+')) // VCC = board 3V3
      wire(`j${c + 7}`, topRail('-')) // GND
      wire(`a${c + 6}`, topRail('+')) // SRCLR high
      wire(`a${c + 3}`, topRail('-')) // OE low
      wire(`a${c + 5}`, srclk)
      wire(`a${c + 2}`, ser)
      wire(`a${c + 4}`, rclk)
      let ledText = ''
      if (leds) {
        const color = (LED_COLORS as readonly string[]).includes(leds[1] ?? '') ? (leds[1] as string) : 'red'
        const ohms = parseOhms(leds[2], leds[3])
        const j0 = c + 8
        // QA (upper strip of column c+1): resistor to column j0, LED to the top − rail
        comps.push({ id: `R${++nR}`, type: 'resistor', holes: [`b${c + 1}`, `b${j0}`], params: { resistance: ohms } })
        comps.push({ id: `D${++nD}`, type: 'led', holes: [`c${j0}`, topRail('-')], params: { color } })
        // QB…QH (lower strips of columns c…c+6): resistors to columns j0…j0+6, LEDs to the bottom − rail
        for (let k = 0; k < 7; k++) {
          comps.push({ id: `R${++nR}`, type: 'resistor', holes: [`j${c + k}`, `j${j0 + k}`], params: { resistance: ohms } })
          comps.push({ id: `D${++nD}`, type: 'led', holes: [`i${j0 + k}`, botGnd()], params: { color } })
        }
        ledText = `, QA–QH: ${ohms} Ω + ${color} LED to GND each (D${nD - 7}–D${nD})`
      }
      notes.push(`${pins[0]} (SRCLK), ${pins[1]} (SER), ${pins[2]} (RCLK): ${id} 74HC595 at f${c}, SRCLR 3V3, OE GND, VCC 3V3${ledText}`)
      col += width + 1
    } else if (pins.length > 0 && (led || pullUp || pullDown)) {
      for (const pin of pins) {
        if (entry.pins.indexOf(pin) < 0) {
          notes.push(`circuit "${line}": ${pin} is not a Blue Pill header pin — not wired`)
          continue
        }
        if (col + 2 > 63 || rail > 49) {
          notes.push(`circuit "${line}": no free breadboard space left for ${pin} — not wired`)
          continue
        }
        const h = takeTap(line, pin)
        if (!h) continue
        wire(h, `e${col}`)
        if (led) {
          const color = (LED_COLORS as readonly string[]).includes(led[1] ?? '') ? (led[1] as string) : 'red'
          const ohms = parseOhms(led[2], led[3])
          const r = `R${++nR}`
          const d = `D${++nD}`
          comps.push({ id: r, type: 'resistor', holes: [`a${col}`, `a${col + 2}`], params: { resistance: ohms } })
          comps.push({ id: d, type: 'led', holes: [`b${col + 2}`, `top-${rail}`], params: { color } })
          notes.push(`${pin}: ${r} ${ohms} Ω + ${color} LED ${d} to GND`)
        } else {
          const spec = (pullUp ?? pullDown) as RegExpExecArray
          const ohms = parseOhms(spec[1], spec[2])
          const r = `R${++nR}`
          comps.push({
            id: r,
            type: 'resistor',
            holes: [`a${col}`, pullUp ? `top+${rail}` : `top-${rail}`],
            params: { resistance: ohms },
          })
          notes.push(`${pin}: ${r} ${ohms} Ω pull-${pullUp ? 'up to 3V3' : 'down to GND'}`)
        }
        col += 3
        rail++
      }
    } else if (/push-?button\s+to\s+gnd/.test(body)) {
      notes.push(`${pins.join(', ') || line}: button modeled by the scenario stimulus (50 Ω to GND while pressed, released = open)`)
    } else if (/on-board led|virtual terminal|unconnected|not connected|nothing (?:else )?connected|no load|logic analy[sz]er|scope|probe/.test(body)) {
      notes.push(`"${line}": nothing to place (on-board part, UART tap, recorder or open pin)`)
    } else if (
      /\bnot placed\b/.test(body) ||
      /^\s*no\s+[^\s:(]+(?:\s+[^\s:(]+)?\s*(?:on\s+(?:the\s+bus|this\s+bench|p[a-e]\d{1,2})\b|\()/.test(line.toLowerCase()) ||
      (pins.length > 0 && /^\s*open\b/.test(body))
    ) {
      // the line itself says the part is ABSENT ("CH340 module: not placed on
      // this bench", "no BME280 on the bus", "PB12: open"): an empty bench is
      // exactly what it describes
      notes.push(`"${line}": nothing to place (the line states the part is absent from this bench)`)
    } else {
      notes.push(`circuit "${line}": not understood by the runner — NOT wired`)
    }
  }

  const stimulusPins: string[] = []
  for (const sc of checks.scenarios ?? []) {
    for (const d of sc.drive ?? []) if (d.pin && !stimulusPins.includes(d.pin)) stimulusPins.push(d.pin)
  }
  if (stimulusPins.length) notes.push(`stimulus (50 Ω to VSS / VDD or open) on ${stimulusPins.join(', ')}`)
  return {
    layout: { version: 1, name: `checks: ${name}`, components: comps, wires },
    notes,
    stimulusPins,
  }
}

// ======================================================= signal kinds

type SignalKind = 'square' | 'invert' | 'same' | 'edgesAfter' | 'oneHot' | 'uartLines' | 'unknown'

function signalKind(s: SignalSpec): SignalKind {
  if (s.pin && Array.isArray(s.square)) return 'square'
  if (s.pin && s.invertOf) return 'invert'
  if (s.pin && s.sameAs) return 'same'
  if (s.pin && s.edgesAfter) return 'edgesAfter'
  if (Array.isArray(s.pins) && s.oneHot) return 'oneHot'
  if (s.uart && (typeof s.lines === 'string' || typeof s.match === 'string')) return 'uartLines'
  return 'unknown'
}

function signalLabel(s: SignalSpec, i: number): string {
  switch (signalKind(s)) {
    case 'square':
      return `signal[${i}] ${s.pin} square ${s.square?.[0]}/${s.square?.[1]} ms`
    case 'invert':
      return `signal[${i}] ${s.pin} = !${s.invertOf}`
    case 'same':
      return `signal[${i}] ${s.pin} = ${s.sameAs}`
    case 'edgesAfter':
      return `signal[${i}] ${s.pin} edges after ${s.edgesAfter}`
    case 'oneHot':
      return `signal[${i}] one-hot ${(s.pins ?? []).join('→')}`
    case 'uartLines':
      return `signal[${i}] ${s.uart} lines every ${s.everyMs} ms`
    default:
      return `signal[${i}]`
  }
}

/** Every pin a logic channel must record. */
function observedPins(checks: FirmwareChecks, uartPorts: Set<string>): string[] {
  const out: string[] = []
  const add = (p: string | undefined): void => {
    if (p && !uartPorts.has(p) && !out.includes(p)) out.push(p)
  }
  for (const p of Object.keys(checks.idle ?? {})) add(p)
  for (const s of checks.signals ?? []) {
    add(s.pin)
    add(s.invertOf)
    add(s.sameAs)
    add(s.edgesAfter)
    add(s.afterEdgeOf)
    for (const p of s.pins ?? []) add(p)
  }
  for (const sc of checks.scenarios ?? []) {
    for (const d of sc.drive ?? []) add(d.pin)
    for (const e of sc.expect ?? []) add(e.pin)
    for (const q of sc.quiet ?? []) add(q)
  }
  return out
}

/** Ports referenced anywhere (uart config, boot, signals, drives, expectations, t0). */
function uartPortsOf(checks: FirmwareChecks): Set<string> {
  const s = new Set<string>([...Object.keys(checks.uart ?? {}), ...Object.keys(checks.boot ?? {})])
  for (const sg of checks.signals ?? []) if (sg.uart) s.add(sg.uart)
  for (const sc of checks.scenarios ?? []) {
    for (const d of sc.drive ?? []) if (d.uart) s.add(d.uart)
    for (const e of sc.expect ?? []) if (e.uart) s.add(e.uart)
  }
  const t0 = checks.t0 ?? 'settle'
  if (t0.startsWith('uart:')) s.add(t0.slice(5))
  return s
}

/**
 * Default baseline length after t0 (ms): long enough to measure every
 * square signal edge to edge in both phases (first edge + high + low) and
 * three lines of every periodic UART signal, at least MIN_BASELINE_MS.
 */
export function baselineDurationMs(checks: FirmwareChecks): number {
  let need = MIN_BASELINE_MS
  for (const s of checks.signals ?? []) {
    const k = signalKind(s)
    if (k === 'square' && s.square) {
      const [hi, lo] = s.square
      const first = s.firstEdgeAt ? s.firstEdgeAt[1] : Math.max(hi, lo)
      need = Math.max(need, first + hi + lo + Math.max(1, (hi + lo) * 0.01))
    } else if (k === 'uartLines' && s.everyMs) {
      const first = s.firstAt ? s.firstAt[1] : s.everyMs
      need = Math.max(need, first + 2 * s.everyMs + 1)
    }
  }
  return Math.min(MAX_BASELINE_MS, need)
}

// ======================================================== run plumbing

interface PinTrace {
  pin: string
  /** level before the first edge */
  initial: Level
  /** edge times (ms relative to t0), ascending */
  t: number[]
  /** level after each edge */
  l: Level[]
}

interface UartStream {
  /** stop-bit end time of each byte (ms relative to t0) */
  t: number[]
  b: number[]
}

interface Snapshot {
  atMs: number
  state: string
  hclkHz: number
  roles: Map<string, PinRole | 'not bonded'>
  uarts: Map<string, UartLineConfig>
}

interface RunData {
  name: string
  baseline: boolean
  /** ms relative to t0 */
  winEnd: number
  settleRel: number
  firstDriveRel: number
  traces: Map<string, PinTrace>
  uart: Map<string, UartStream>
  /** index of the first byte after the boot text per port (−1: boot text not found) */
  bootEnd: Map<string, number>
  settle: Snapshot | null
  end: Snapshot | null
  stimulusOk: { pin: string; atMs: number; ok: boolean }[]
}

function roleOf(d: PinDriveState): PinRole {
  switch (d.mode) {
    case PIN_ANALOG:
      return 'analog'
    case PIN_IN_PULLUP:
      return 'input-pullup'
    case PIN_IN_PULLDOWN:
      return 'input-pulldown'
    case PIN_OUT_PP:
      return d.af ? 'af-pp' : 'output-pp'
    case PIN_OUT_OD:
      return d.af ? 'af-od' : 'output-od'
    case PIN_IN_FLOAT:
    default:
      return 'input-floating'
  }
}

function snapshot(mcu: McuDevice, pins: string[], ports: string[], atMs: number): Snapshot {
  const ds = mcu.debugState()
  const roles = new Map<string, PinRole | 'not bonded'>()
  for (const p of pins) {
    const idx = mcu.pins.pinIndex(p)
    roles.set(p, idx < 0 ? 'not bonded' : roleOf(mcu.pins.drive(idx)))
  }
  const uarts = new Map<string, UartLineConfig>()
  for (const port of ports) {
    const tap = mcu.uarts.find((u) => u.name === port)
    if (tap) uarts.set(port, tap.config())
  }
  return { atMs, state: ds.state, hclkHz: ds.hclkHz, roles, uarts }
}

function textBytes(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff)
  return out
}

/** Printable form of UART text for messages. */
export function escapeText(s: string): string {
  return JSON.stringify(s).slice(1, -1)
}

function bytesText(b: number[], from: number, to: number): string {
  let s = ''
  for (let i = Math.max(0, from); i < Math.min(b.length, to); i++) s += String.fromCharCode(b[i])
  return s
}

const ms = (x: number): string => `${Number.isFinite(x) ? x.toFixed(3) : String(x)} ms`
const us = (x: number): string => `${(x * 1000).toFixed(2)} µs`
const win = (w: CheckWindow, base = 0): string => `[${(w[0] + base).toFixed(3)}, ${(w[1] + base).toFixed(3)}] ms`
const lvl = (l: Level): string => (l === 2 ? 'undefined' : String(l))
const inWin = (t: number, a: number, b: number): boolean => t >= a - EPS && t <= b + EPS

// ============================================================ trace ops

/** Index of the last edge at or before x (−1: none). */
function lastAtOrBefore(tr: PinTrace, x: number): number {
  let lo = 0
  let hi = tr.t.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (tr.t[mid] <= x + EPS) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

function levelAt(tr: PinTrace, x: number): Level {
  const k = lastAtOrBefore(tr, x)
  return k >= 0 ? tr.l[k] : tr.initial
}

/** Indices of edges with a ≤ t ≤ b. */
function edgesIn(tr: PinTrace, a: number, b: number): number[] {
  const out: number[] = []
  for (let k = 0; k < tr.t.length; k++) {
    const t = tr.t[k]
    if (t > b + EPS) break
    if (t >= a - EPS) out.push(k)
  }
  return out
}

/** Latest edge time at or before x (−Infinity: none). */
function lastEdgeTime(tr: PinTrace, x: number): number {
  const k = lastAtOrBefore(tr, x)
  return k >= 0 ? tr.t[k] : -Infinity
}

function listTimes(ts: number[], max = 4): string {
  const shown = ts.slice(0, max).map((t) => t.toFixed(3)).join(', ')
  return ts.length > max ? `${shown} … (${ts.length} in total) ms` : `${shown} ms`
}

// ======================================================= rule evaluators

type Outcomes = CheckOutcome[]

function pass(out: Outcomes, rule: string, message: string): void {
  out.push({ rule, ok: true, message })
}
function fail(out: Outcomes, rule: string, message: string): void {
  out.push({ rule, ok: false, message })
}

function noTrace(out: Outcomes, rule: string, pin: string): void {
  fail(out, rule, `${pin} was not recorded (not a Blue Pill header pin?)`)
}

/** Square-wave rule over [ws, we]. `strict` (baseline): at least three edges. */
function checkSquare(out: Outcomes, rule: string, s: SignalSpec, tr: PinTrace, ws: number, we: number, strict: boolean): void {
  const [hi, lo] = s.square as [number, number]
  const tol = (s.tolUs ?? DEFAULT_TOL_US) / 1000
  const idx = edgesIn(tr, ws, we)
  const t = idx.map((k) => tr.t[k])
  const l = idx.map((k) => tr.l[k])
  const errs: string[] = []
  if (l.some((x) => x === 2)) errs.push(`undefined level at ${ms(t[l.indexOf(2)])}`)
  if (s.firstEdgeAt) {
    if (t.length === 0) errs.push(`no edge at all; first edge expected within ${win(s.firstEdgeAt)}`)
    else if (!inWin(t[0], s.firstEdgeAt[0], s.firstEdgeAt[1])) errs.push(`first edge at ${ms(t[0])}, expected within ${win(s.firstEdgeAt)}`)
  } else if (t.length > 0 && t[0] - ws > Math.max(hi, lo) + tol) {
    errs.push(`first edge only at ${ms(t[0])}, more than one phase (${Math.max(hi, lo)} ms) after the window start ${ms(ws)}`)
  }
  if (s.firstEdge !== undefined && t.length > 0 && l[0] !== s.firstEdge) {
    errs.push(`first edge goes to ${lvl(l[0])}, expected ${s.firstEdge === 1 ? 'a rising' : 'a falling'} edge`)
  }
  const bad: string[] = []
  let nBad = 0
  for (let k = 1; k < t.length; k++) {
    if (l[k] === l[k - 1]) {
      nBad++
      if (bad.length < 3) bad.push(`two edges to ${lvl(l[k])} at ${ms(t[k - 1])} and ${ms(t[k])}`)
      continue
    }
    const want = l[k - 1] === 1 ? hi : lo
    const d = t[k] - t[k - 1]
    if (Math.abs(d - want) > tol + EPS) {
      nBad++
      if (bad.length < 3) bad.push(`${l[k - 1] === 1 ? 'high' : 'low'} phase ${ms(t[k - 1])} → ${ms(t[k])} lasted ${d.toFixed(4)} ms (expected ${want} ms ± ${us(tol)})`)
    }
  }
  if (nBad > 0) errs.push(`${nBad} bad phase(s): ${bad.join('; ')}`)
  if (t.length === 0 && !s.firstEdgeAt && we - ws > Math.max(hi, lo) + tol) {
    errs.push(`no edge in ${ms(ws)}–${ms(we)} (stuck at ${lvl(levelAt(tr, ws))})`)
  } else if (t.length > 0) {
    const last = l[l.length - 1]
    const phase = last === 1 ? hi : lo
    if (we - t[t.length - 1] > phase + tol + EPS) errs.push(`stopped toggling: stuck at ${lvl(last)} from ${ms(t[t.length - 1])} to the window end ${ms(we)} (phase is ${phase} ms)`)
  }
  if (strict && t.length < 3) errs.push(`only ${t.length} edge(s) observed in ${ms(ws)}–${ms(we)}; both phases need 3`)
  if (errs.length) fail(out, rule, errs.join('; '))
  else pass(out, rule, `${t.length} edges, phases ${hi}/${lo} ms within ± ${us(tol)}${t.length ? `, first edge at ${ms(t[0])}` : ''}`)
}

/** pin = f(ref) except within skew after an edge of ref. */
function checkRelation(out: Outcomes, rule: string, a: PinTrace, p: PinTrace, invert: boolean, skewMs: number, ws: number, we: number): void {
  const times = new Set<number>()
  for (const k of edgesIn(a, ws, we)) times.add(a.t[k])
  for (const k of edgesIn(p, ws, we)) times.add(p.t[k])
  const pts = [ws, ...[...times].filter((t) => t > ws + EPS).sort((x, y) => x - y)]
  const bad: string[] = []
  let nBad = 0
  let k = 0
  while (k < pts.length) {
    const t = pts[k]
    const la = levelAt(a, t)
    const lp = levelAt(p, t)
    const ok = la !== 2 && lp !== 2 && la === (invert ? 1 - lp : lp)
    if (ok) {
      k++
      continue
    }
    // violation from t until the next point where the relation holds
    let j = k + 1
    while (j < pts.length) {
      const la2 = levelAt(a, pts[j])
      const lp2 = levelAt(p, pts[j])
      if (la2 !== 2 && lp2 !== 2 && la2 === (invert ? 1 - lp2 : lp2)) break
      j++
    }
    const vEnd = j < pts.length ? pts[j] : we
    const eP = lastEdgeTime(p, t)
    const excused = eP > -Infinity && eP <= t + EPS && vEnd - eP <= skewMs + EPS
    if (!excused) {
      nBad++
      if (bad.length < 3) {
        const since = eP > -Infinity ? `, last ${p.pin} edge at ${ms(eP)}` : ''
        bad.push(`${a.pin}=${lvl(la)} while ${p.pin}=${lvl(lp)} from ${ms(t)} to ${ms(vEnd)}${since}`)
      }
    }
    k = j
  }
  if (nBad) fail(out, rule, `${nBad} violation(s) (allowed skew ${us(skewMs)} after a ${p.pin} edge): ${bad.join('; ')}`)
  else pass(out, rule, `${a.pin} = ${invert ? '!' : ''}${p.pin} throughout ${ms(ws)}–${ms(we)} (skew ≤ ${us(skewMs)})`)
}

function checkEdgesAfter(out: Outcomes, rule: string, a: PinTrace, p: PinTrace, maxLagMs: number, ws: number, we: number): void {
  const idx = edgesIn(a, ws, we)
  const bad: string[] = []
  let worst = 0
  for (const k of idx) {
    const eP = lastEdgeTime(p, a.t[k])
    const lag = a.t[k] - eP
    if (Number.isFinite(lag)) worst = Math.max(worst, lag)
    if (!(lag <= maxLagMs + EPS)) {
      if (bad.length < 3) bad.push(`${a.pin} edge at ${ms(a.t[k])} is ${Number.isFinite(lag) ? us(lag) : 'not'} after the last ${p.pin} edge${Number.isFinite(eP) ? ` (${ms(eP)})` : ''}`)
    }
  }
  if (bad.length) fail(out, rule, `max lag ${us(maxLagMs)} exceeded: ${bad.join('; ')}`)
  else if (idx.length === 0) fail(out, rule, `no ${a.pin} edge in ${ms(ws)}–${ms(we)} to check`)
  else pass(out, rule, `${idx.length} edges, worst lag ${us(worst)} (≤ ${us(maxLagMs)})`)
}

function checkOneHot(out: Outcomes, rule: string, trs: PinTrace[], ws: number, we: number): void {
  const times = new Set<number>()
  for (const tr of trs) for (const k of edgesIn(tr, ws, we)) if (tr.t[k] > ws + EPS) times.add(tr.t[k])
  const pts = [ws, ...[...times].sort((x, y) => x - y)]
  const errs: string[] = []
  let prev = -1
  let changes = 0
  for (const t of pts) {
    const levels = trs.map((tr) => levelAt(tr, t))
    const high = levels.flatMap((l, i) => (l === 1 ? [i] : []))
    if (levels.includes(2) || high.length !== 1) {
      errs.push(`at ${ms(t)}: ${trs.map((tr, i) => `${tr.pin}=${lvl(levels[i])}`).join(' ')} (exactly one must be high)`)
      if (errs.length >= 3) break
      prev = -1
      continue
    }
    const cur = high[0]
    if (prev >= 0 && cur !== prev) {
      changes++
      if (cur !== (prev + 1) % trs.length) {
        errs.push(`at ${ms(t)}: ${trs[prev].pin} → ${trs[cur].pin}, expected ${trs[prev].pin} → ${trs[(prev + 1) % trs.length].pin}`)
        if (errs.length >= 3) break
      }
    }
    prev = cur
  }
  if (errs.length) fail(out, rule, errs.join('; '))
  else pass(out, rule, `one-hot throughout ${ms(ws)}–${ms(we)}, ${changes} change(s), each a single instant, order ${trs.map((t) => t.pin).join(' → ')}`)
}

interface Line {
  start: number // byte index
  end: number // exclusive
  t: number // first byte time (ms rel t0)
  text: string
}

/** Complete lines ('\n'-terminated) after `from`. */
function linesOf(st: UartStream, from: number): Line[] {
  const out: Line[] = []
  let s = from
  for (let i = from; i < st.b.length; i++) {
    if (st.b[i] === 0x0a) {
      out.push({ start: s, end: i + 1, t: st.t[s], text: bytesText(st.b, s, i + 1) })
      s = i + 1
    }
  }
  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Matcher of a periodic UART signal: whole line → n (template) / 0 (regex) / null. */
function lineMatcher(s: SignalSpec): (text: string) => number | null {
  if (typeof s.lines === 'string') {
    const parts = s.lines.split('{n}')
    const re = new RegExp(`^${parts.map(escapeRe).join('(\\d+)')}$`)
    return (text) => {
      const m = re.exec(text)
      if (!m) return null
      return parts.length > 1 ? Number(m[1]) : 0
    }
  }
  let re: RegExp
  try {
    re = new RegExp(s.match ?? '^$')
  } catch {
    re = /(?!)/
  }
  return (text) => (re.test(text) ? 0 : null)
}

function checkUartLines(
  out: Outcomes,
  rule: string,
  s: SignalSpec,
  st: UartStream,
  bootEnd: number,
  ws: number,
  we: number,
  strict: boolean,
  traces: Map<string, PinTrace>,
  claim: (start: number, end: number) => void,
): void {
  const match = lineMatcher(s)
  const lines = linesOf(st, Math.max(0, bootEnd)).filter((ln) => inWin(ln.t, ws, we))
  const hits = lines.filter((ln) => match(ln.text) !== null)
  const tol = (s.tolUs ?? DEFAULT_TOL_US) / 1000
  const every = s.everyMs ?? 0
  const errs: string[] = []
  if (hits.length === 0) {
    errs.push(`no matching line in ${ms(ws)}–${ms(we)}${lines.length ? `; lines seen: ${lines.slice(0, 3).map((l) => `"${escapeText(l.text)}" at ${ms(l.t)}`).join(', ')}` : ''}`)
  } else {
    if (s.firstAt && !inWin(hits[0].t, s.firstAt[0], s.firstAt[1])) {
      errs.push(`first line "${escapeText(hits[0].text)}" at ${ms(hits[0].t)}, expected within ${win(s.firstAt)}`)
    }
    if (typeof s.lines === 'string' && s.lines.includes('{n}')) {
      const n0 = s.nFrom ?? 1
      for (let k = 0; k < hits.length; k++) {
        const n = match(hits[k].text)
        if (n !== n0 + k) {
          errs.push(`line ${k + 1} is "${escapeText(hits[k].text)}" at ${ms(hits[k].t)}, expected n = ${n0 + k}`)
          break
        }
      }
    }
    const bad: string[] = []
    for (let k = 1; k < hits.length; k++) {
      const d = hits[k].t - hits[k - 1].t
      if (Math.abs(d - every) > tol + EPS && bad.length < 3) bad.push(`${ms(hits[k - 1].t)} → ${ms(hits[k].t)} = ${d.toFixed(4)} ms`)
    }
    if (bad.length) errs.push(`period ${every} ms ± ${us(tol)} violated: ${bad.join('; ')}`)
    const lastT = hits[hits.length - 1].t
    if (we - lastT > every + tol + EPS) errs.push(`line missing: the last one started at ${ms(lastT)}, the next was due by ${ms(lastT + every + tol)} (window end ${ms(we)})`)
    if (s.afterEdgeOf) {
      const p = traces.get(s.afterEdgeOf)
      const lag = s.lagMs ?? [0, Infinity]
      if (!p) errs.push(`${s.afterEdgeOf} was not recorded`)
      else {
        const lb: string[] = []
        for (const h of hits) {
          const d = h.t - lastEdgeTime(p, h.t)
          if (!(d >= lag[0] - EPS && d <= lag[1] + EPS) && lb.length < 3) lb.push(`line at ${ms(h.t)} is ${Number.isFinite(d) ? ms(d) : 'not'} after a ${s.afterEdgeOf} edge`)
        }
        if (lb.length) errs.push(`expected each line ${win(lag)} after a ${s.afterEdgeOf} edge: ${lb.join('; ')}`)
      }
    }
    if (strict && hits.length < 3) errs.push(`only ${hits.length} line(s) observed in ${ms(ws)}–${ms(we)}`)
  }
  for (const h of hits) claim(h.start, h.end)
  if (errs.length) fail(out, rule, errs.join('; '))
  else pass(out, rule, `${hits.length} lines, first at ${ms(hits[0].t)}, every ${every} ms ± ${us(tol)}`)
}

// ================================================================ boot

/** Index after the boot text (−1: not found) and an outcome. */
function evalBoot(out: Outcomes, port: string, spec: BootSpec, st: UartStream, firstDriveRel: number, baseline: boolean): number {
  const rule = `boot ${port}`
  if (typeof spec === 'string') {
    if (spec === '') {
      const before = st.t.findIndex((t) => t < firstDriveRel - EPS)
      if (before >= 0) {
        fail(out, rule, `expected silence until stimulated${baseline ? ' (the baseline is never stimulated)' : ` (first drive at ${ms(firstDriveRel)})`}, but ${port} sent "${escapeText(bytesText(st.b, before, before + 40))}" from ${ms(st.t[before])}`)
      } else pass(out, rule, baseline ? 'silent without stimulus' : 'silent until stimulated')
      return 0
    }
    const want = textBytes(spec)
    const got = bytesText(st.b, 0, want.length)
    if (st.b.length >= want.length && got === spec) {
      pass(out, rule, `"${escapeText(spec)}" from ${ms(st.t[0])} to ${ms(st.t[want.length - 1])}`)
      return want.length
    }
    fail(out, rule, `expected the first bytes "${escapeText(spec)}", got "${escapeText(got)}"${st.b.length < want.length ? ` (only ${st.b.length} byte(s) sent)` : ''}`)
    return -1
  }
  let re: RegExp
  try {
    re = new RegExp(spec.match)
  } catch (err) {
    fail(out, rule, `invalid regex ${spec.match}: ${String(err)}`)
    return -1
  }
  for (let i = 0; i < st.b.length; i++) {
    if (st.b[i] !== 0x0a) continue
    const text = bytesText(st.b, 0, i + 1)
    if (re.test(text)) {
      pass(out, rule, `"${escapeText(text)}" matches /${escapeText(spec.match)}/ (${ms(st.t[0])})`)
      return i + 1
    }
  }
  fail(out, rule, `no leading line(s) match /${escapeText(spec.match)}/; first bytes: "${escapeText(bytesText(st.b, 0, 60))}"`)
  return -1
}

// ======================================================== the runner

/** Run one project's checks; see the file header for the bench and the semantics. */
export function runChecks(manifestEntry: ManifestEntry, image: FirmwareImage, opts: RunChecksOptions = {}): ChecksReport {
  const project = opts.name ?? 'firmware'
  const checks = manifestEntry.checks
  if (!checks) {
    return { project, ok: false, runs: [], failures: [`${project}: the manifest entry has no checks`], bench: [] }
  }
  const bench = checksLayout(checks, project)
  const ports = uartPortsOf(checks)
  const pins = observedPins(checks, ports)
  const runs: RunReport[] = []
  const pre: CheckOutcome[] = []
  if (pins.length > MAX_CHANNELS) fail(pre, 'recorder', `${pins.length} pins to observe, the logic recorder has ${MAX_CHANNELS} channels`)
  const t0Spec = checks.t0 ?? 'settle'
  if (t0Spec !== 'settle' && !/^uart:\w+$/.test(t0Spec)) fail(pre, 't0', `unknown time origin "${t0Spec}"`)
  checks.signals?.forEach((s, i) => {
    if (signalKind(s) === 'unknown') fail(pre, signalLabel(s, i), `signal not understood: ${JSON.stringify(s)}`)
  })
  for (const n of bench.notes) if (n.includes('NOT wired') || n.includes('not wired')) fail(pre, 'circuit', n)
  if (pre.length) {
    const r: RunReport = { name: 'setup', ok: false, resetMs: null, t0Ms: null, durationMs: 0, outcomes: pre, log: [], wallMs: 0 }
    runs.push(r)
  }

  const want = opts.scenarios
  if (!opts.skipBaseline) {
    const dur = opts.baselineMs ?? baselineDurationMs(checks)
    const r = runOne(checks, image, bench, pins, ports, { name: 'baseline', durationMs: dur }, true, opts)
    runs.push(r)
    opts.onRun?.(r)
  }
  for (const sc of checks.scenarios ?? []) {
    if (want && !want.includes(sc.name)) continue
    const r = runOne(checks, image, bench, pins, ports, sc, false, opts)
    runs.push(r)
    opts.onRun?.(r)
  }
  const failures: string[] = []
  for (const r of runs) for (const o of r.outcomes) if (!o.ok) failures.push(`${r.name}: ${o.rule}: ${o.message}`)
  return { project, ok: failures.length === 0, runs, failures, bench: bench.notes }
}

function runOne(
  checks: FirmwareChecks,
  image: FirmwareImage,
  bench: ChecksBench,
  pins: string[],
  ports: Set<string>,
  sc: ScenarioSpec,
  baseline: boolean,
  opts: RunChecksOptions,
): RunReport {
  const w0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const out: Outcomes = []
  const log: string[] = []
  const report = (resetMs: number | null, t0Ms: number | null): RunReport => ({
    name: sc.name,
    ok: out.every((o) => o.ok),
    resetMs,
    t0Ms,
    durationMs: sc.durationMs,
    outcomes: out,
    log,
    wallMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - w0,
  })

  const co = opts.coordinator ? opts.coordinator() : new SimulationCoordinator()
  try {
    co.load(bench.layout, 1)
    co.setFirmware(CHECK_BOARD_ID, image)
    const channels: LogicChannelConfig[] = pins.slice(0, MAX_CHANNELS).map((pin, index) => ({
      index,
      label: pin,
      source: { kind: 'mcu-pin', componentId: CHECK_BOARD_ID, pin },
    }))
    co.setLogicChannels(channels)
    const mcu = co.mcu(CHECK_BOARD_ID)
    if (!mcu) {
      fail(out, 'run', 'no MCU model for the Blue Pill (stm32f103c8 not registered)')
      return report(null, null)
    }
    const rawUart = new Map<string, { t: number[]; b: number[] }>()
    for (const p of ports) rawUart.set(p, { t: [], b: [] })

    // ---- time origin + drives
    const t0Spec = checks.t0 ?? 'settle'
    const t0Port = t0Spec.startsWith('uart:') ? t0Spec.slice(5) : null
    let t0: number | null = null
    const getT0 = (): number | null => t0
    const plan = new StimulusPlan(co)
    const drives = sc.drive ?? []
    const arm = (origin: number): void => {
      t0 = origin
      const actions: StimulusAction[] = []
      for (const d of drives) {
        if (d.pin !== undefined) {
          if (!isStimulusLevel(d.level)) {
            fail(out, `drive ${d.pin}@${d.at}`, `level must be 0, 1 or "open", got ${JSON.stringify(d.level)}`)
            continue
          }
          actions.push({ at: origin + d.at / 1000, componentId: CHECK_BOARD_ID, pin: d.pin, level: d.level })
        } else if (d.uart !== undefined) {
          const port = d.uart
          const bytes = Uint8Array.from(textBytes(d.text ?? ''))
          co.scheduleAt(origin + d.at / 1000, () => co.uartSend(CHECK_BOARD_ID, port, bytes))
        }
      }
      plan.schedule(actions)
    }
    const unsub = co.addUartListener((id, port, byte, t) => {
      if (id !== CHECK_BOARD_ID) return
      let st = rawUart.get(port)
      if (!st) {
        st = { t: [], b: [] }
        rawUart.set(port, st)
      }
      st.t.push(t)
      st.b.push(byte)
      if (t0 === null && port === t0Port) arm(t)
    })

    // ---- power-on: the analog solve in which VDD crosses the POR level
    for (let k = 0; k < 2000 && !mcu.powered; k++) co.advance(MAX_ANALOG_DT)
    if (!mcu.powered) {
      fail(out, 'power', `the MCU never powered up (VDD stayed below the POR level for ${(co.time * 1000).toFixed(1)} ms)`)
      unsub()
      return report(null, null)
    }
    const tReset = co.time
    const settleMs = checks.settleMs ?? 0
    const tSettle = tReset + settleMs / 1000
    const pinNames = Object.keys(checks.pins ?? {})
    for (const spec of Object.values(checks.uart ?? {})) {
      for (const p of [spec.tx, spec.rx]) if (p && !pinNames.includes(p)) pinNames.push(p)
    }
    const portNames = [...ports]
    let settleSnap: Snapshot | null = null
    co.scheduleAt(tSettle, () => {
      settleSnap = snapshot(mcu, pinNames, portNames, (co.now - tReset) * 1000)
    })
    if (t0Port === null) arm(tSettle)
    else {
      const limit = tSettle + T0_TIMEOUT_MS / 1000
      while (getT0() === null && co.time < limit) co.advance(Math.min(0.01, limit - co.time))
      if (getT0() === null) {
        fail(out, 't0', `${t0Port} transmitted nothing within ${settleMs + T0_TIMEOUT_MS} ms of reset — the time origin was never reached`)
        collectLog(co, log)
        unsub()
        return report(tReset * 1000, null)
      }
    }
    const origin = getT0() ?? tSettle
    const tEnd = origin + (sc.durationMs + UART_TAIL_MS) / 1000
    // the baseline also needs the settle snapshot (static rules)
    const tObserveEnd = baseline ? Math.max(tEnd, tSettle + 1e-3) : tEnd
    if (co.time < tObserveEnd) co.advance(tObserveEnd - co.time)
    unsub()
    const endSnap = snapshot(mcu, pinNames, portNames, (co.time - tReset) * 1000)

    // ---- collect
    const rel = (t: number): number => (t - origin) * 1000
    const q = co.query({ kind: 'logic', t0: 0, t1: co.time })
    const traces = new Map<string, PinTrace>()
    if (q.kind === 'logic') {
      if (q.capture.overflow) fail(out, 'recorder', 'the logic recorder overflowed (edges were dropped)')
      for (const tr of q.capture.traces) {
        traces.set(tr.label, {
          pin: tr.label,
          initial: tr.initial,
          t: Array.from(tr.times, rel),
          l: Array.from(tr.levels) as Level[],
        })
      }
    }
    const uart = new Map<string, UartStream>()
    for (const [p, st] of rawUart) uart.set(p, { t: st.t.map(rel), b: st.b })
    let firstDriveRel = Infinity
    for (const d of drives) firstDriveRel = Math.min(firstDriveRel, d.at)
    const run: RunData = {
      name: sc.name,
      baseline,
      winEnd: sc.durationMs,
      settleRel: rel(tSettle),
      firstDriveRel,
      traces,
      uart,
      bootEnd: new Map(),
      settle: settleSnap,
      end: endSnap,
      stimulusOk: plan.applied.map((a) => ({ pin: a.action.pin, atMs: rel(a.t), ok: a.ok })),
    }
    collectLog(co, log)
    for (const line of log) if (line.startsWith('error')) fail(out, 'log', line)
    evaluate(out, checks, run, mcu)
    return report(tReset * 1000, origin * 1000)
  } catch (err) {
    fail(out, 'run', `runner error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
    return report(null, null)
  } finally {
    co.dispose()
  }
}

function collectLog(co: SimulationCoordinator, log: string[]): void {
  const f = co.frame()
  for (const e of f.log) {
    if (e.level === 'info') continue
    log.push(`${e.level} ${(e.time * 1000).toFixed(3)} ms ${e.source}: ${e.message}`)
  }
}

// ========================================================== evaluation

function evaluate(out: Outcomes, checks: FirmwareChecks, run: RunData, mcu: McuDevice): void {
  const { traces, uart } = run
  const end = run.winEnd

  for (const a of run.stimulusOk) {
    if (!a.ok) fail(out, `drive ${a.pin}`, `stimulus on ${a.pin} could not be applied at ${ms(a.atMs)} (no such board header pin / not connected)`)
  }

  // ---- static state (baseline only): clock, pin roles, UART line config
  if (run.baseline) {
    for (const snap of [run.settle, run.end]) {
      if (!snap) {
        fail(out, 'settle', 'the settle instant was never reached')
        continue
      }
      const when = snap === run.settle ? `at settle (${ms(snap.atMs)} after reset)` : `at the end (${ms(snap.atMs)} after reset)`
      if (checks.hclkHz !== undefined) {
        if (snap.hclkHz === checks.hclkHz) pass(out, 'hclkHz', `${snap.hclkHz} Hz ${when}`)
        else fail(out, 'hclkHz', `expected ${checks.hclkHz} Hz, measured ${snap.hclkHz} Hz ${when}`)
      }
      for (const [pin, role] of Object.entries(checks.pins ?? {})) {
        const got = snap.roles.get(pin)
        if (got === role) pass(out, `pins ${pin}`, `${role} ${when}`)
        else fail(out, `pins ${pin}`, `expected ${role}, measured ${got ?? 'unknown'} ${when}`)
      }
      for (const [port, spec] of Object.entries(checks.uart ?? {})) {
        const cfg = snap.uarts.get(port)
        const rule = `uart ${port}`
        if (!cfg) {
          fail(out, rule, `the MCU has no ${port}`)
          continue
        }
        const errs: string[] = []
        if (!cfg.enabled) errs.push('not enabled (UE and TE/RE)')
        if (spec.baud !== undefined && !(Math.abs(cfg.baud - spec.baud) <= spec.baud * 1e-3)) errs.push(`baud ${cfg.baud.toFixed(1)} (expected ${spec.baud} ± 0.1 %)`)
        if (spec.dataBits !== undefined && cfg.dataBits !== spec.dataBits) errs.push(`${cfg.dataBits} data bits (expected ${spec.dataBits})`)
        if (spec.parity !== undefined && cfg.parity !== spec.parity) errs.push(`parity ${cfg.parity} (expected ${spec.parity})`)
        if (spec.stopBits !== undefined && cfg.stopBits !== spec.stopBits) errs.push(`${cfg.stopBits} stop bits (expected ${spec.stopBits})`)
        const tx = spec.tx ? snap.roles.get(spec.tx) : undefined
        if (spec.tx && tx !== 'af-pp' && tx !== 'af-od') errs.push(`TX pin ${spec.tx} is ${tx ?? 'unknown'}, not an alternate-function output`)
        const rx = spec.rx ? snap.roles.get(spec.rx) : undefined
        if (spec.rx && rx !== 'input-floating' && rx !== 'input-pullup' && rx !== 'input-pulldown') errs.push(`RX pin ${spec.rx} is ${rx ?? 'unknown'}, not an input`)
        if (errs.length) fail(out, rule, `${errs.join('; ')} ${when}`)
        else pass(out, rule, `${cfg.baud.toFixed(1)} Bd ${cfg.dataBits}${cfg.parity[0].toUpperCase()}${cfg.stopBits}, TX ${spec.tx ?? '?'} ${tx ?? ''}, RX ${spec.rx ?? '?'} ${rx ?? ''} ${when}`)
      }
    }
  }

  // ---- MCU still alive at the end
  const ds = mcu.debugState()
  if (ds.state !== 'running' && ds.state !== 'sleeping') {
    fail(out, 'mcu state', `MCU is ${ds.state} at the end (PC 0x${(ds.registers.r[15] >>> 0).toString(16).padStart(8, '0')}${ds.pcSymbol ? ` in ${ds.pcSymbol}` : ''})`)
  }

  // ---- boot text per port
  for (const [port, spec] of Object.entries(checks.boot ?? {})) {
    const st = uart.get(port) ?? { t: [], b: [] }
    run.bootEnd.set(port, evalBoot(out, port, spec, st, run.baseline ? Infinity : run.firstDriveRel, run.baseline))
  }
  const bootEndOf = (port: string): number => run.bootEnd.get(port) ?? 0

  // ---- idle levels (baseline: from settle to the end)
  if (run.baseline) {
    for (const [pin, v] of Object.entries(checks.idle ?? {})) {
      const tr = traces.get(pin)
      const rule = `idle ${pin}`
      if (!tr) {
        noTrace(out, rule, pin)
        continue
      }
      const l0 = levelAt(tr, run.settleRel)
      const later = edgesIn(tr, run.settleRel + EPS * 10, end)
      if (l0 !== v) fail(out, rule, `expected ${v} from settle (${ms(run.settleRel)}), measured ${lvl(l0)}`)
      else if (later.length) fail(out, rule, `left ${v}: edge to ${lvl(tr.l[later[0]])} at ${ms(tr.t[later[0]])}${later.length > 1 ? ` (+${later.length - 1} more)` : ''}`)
      else pass(out, rule, `${v} from ${ms(run.settleRel)} to ${ms(end)}`)
    }
  }

  // ---- signals
  const sigClaims = new Map<string, Set<number>>() // port → byte indices of periodic lines
  const claimLine = (port: string) => (start: number, stop: number): void => {
    let set = sigClaims.get(port)
    if (!set) sigClaims.set(port, (set = new Set()))
    for (let i = start; i < stop; i++) set.add(i)
  }
  const squareTol = new Map<string, number>()
  const alwaysSquare = new Set<string>()
  checks.signals?.forEach((s) => {
    if (signalKind(s) === 'square' && s.pin) {
      squareTol.set(s.pin, (s.tolUs ?? DEFAULT_TOL_US) / 1000)
      if (s.always) alwaysSquare.add(s.pin)
    }
  })
  checks.signals?.forEach((s, i) => {
    if (!run.baseline && !s.always) return
    const rule = signalLabel(s, i)
    const kind = signalKind(s)
    const ws = 0
    const we = end
    if (kind === 'square') {
      const tr = traces.get(s.pin as string)
      if (!tr) return noTrace(out, rule, s.pin as string)
      checkSquare(out, rule, s, tr, ws, we, run.baseline)
    } else if (kind === 'invert' || kind === 'same') {
      const a = traces.get(s.pin as string)
      const ref = (kind === 'invert' ? s.invertOf : s.sameAs) as string
      const p = traces.get(ref)
      if (!a) return noTrace(out, rule, s.pin as string)
      if (!p) return noTrace(out, rule, ref)
      checkRelation(out, rule, a, p, kind === 'invert', (s.skewUs ?? 0) / 1000, ws, we)
    } else if (kind === 'edgesAfter') {
      const a = traces.get(s.pin as string)
      const p = traces.get(s.edgesAfter as string)
      if (!a) return noTrace(out, rule, s.pin as string)
      if (!p) return noTrace(out, rule, s.edgesAfter as string)
      checkEdgesAfter(out, rule, a, p, (s.maxLagUs ?? 0) / 1000, ws, we)
    } else if (kind === 'oneHot') {
      const trs: PinTrace[] = []
      for (const pin of s.pins ?? []) {
        const tr = traces.get(pin)
        if (!tr) return noTrace(out, rule, pin)
        trs.push(tr)
      }
      checkOneHot(out, rule, trs, ws, we)
    } else if (kind === 'uartLines') {
      const port = s.uart as string
      const st = uart.get(port) ?? { t: [], b: [] }
      checkUartLines(out, rule, s, st, bootEndOf(port), ws, we, run.baseline, traces, claimLine(port))
    }
  })

  // baseline: every line after the boot text belongs to a periodic signal of its port
  if (run.baseline) {
    for (const port of new Set((checks.signals ?? []).filter((s) => signalKind(s) === 'uartLines').map((s) => s.uart as string))) {
      const st = uart.get(port)
      if (!st) continue
      const claimed = sigClaims.get(port) ?? new Set<number>()
      const stray = linesOf(st, Math.max(0, bootEndOf(port))).filter((ln) => inWin(ln.t, 0, end) && !claimed.has(ln.start))
      const rule = `${port} unstimulated output`
      if (stray.length) fail(out, rule, `line(s) outside the periodic signal(s): ${stray.slice(0, 3).map((l) => `"${escapeText(l.text)}" at ${ms(l.t)}`).join(', ')}`)
      else pass(out, rule, 'only the periodic lines after the boot text')
    }
  }

  if (run.baseline) return

  // ---- scenario expectations
  const sc = (checks.scenarios ?? []).find((x) => x.name === run.name)
  if (!sc) return
  const times = new Map<string, number | null>()
  const edgeClaims = new Map<string, Set<number>>() // pin → edge indices
  const byteClaims = new Map<string, Set<number>>() // port → byte indices
  const everyWins = new Map<string, [number, number][]>()
  const claimed = <K>(m: Map<K, Set<number>>, key: K): Set<number> => {
    let s = m.get(key)
    if (!s) m.set(key, (s = new Set()))
    return s
  }
  ;(sc.expect ?? []).forEach((e, i) => {
    let base = 0
    let fromTxt = ''
    if (e.from !== undefined) {
      const tRef = times.get(e.from)
      if (tRef === undefined) {
        fail(out, `expect[${i}]`, `"from": "${e.from}" names no earlier expectation`)
        if (e.id) times.set(e.id, null)
        return
      }
      if (tRef === null) {
        fail(out, expectLabel(e, i), `not evaluated: it is relative to "${e.from}", which failed`)
        if (e.id) times.set(e.id, null)
        return
      }
      base = tRef
      fromTxt = ` (${e.from} at ${ms(tRef)} + ${win(e.at)})`
    }
    const a = base + e.at[0]
    const b = base + e.at[1]
    const rule = expectLabel(e, i)
    let at: number | null = null
    if (b > end + EPS) fromTxt += ` [window ends after the observed ${ms(end)}]`
    if (e.pin !== undefined && e.edge !== undefined) {
      const tr = traces.get(e.pin)
      if (!tr) noTrace(out, rule, e.pin)
      else {
        const used = claimed(edgeClaims, e.pin)
        const k = edgesIn(tr, a, b).find((x) => tr.l[x] === e.edge && !used.has(x))
        if (k === undefined) {
          fail(out, rule, `${e.pin} ${e.edge ? 'rising' : 'falling'} edge expected within ${ms(a)}–${ms(b)}${fromTxt}; ${describeNearEdges(tr, e.edge, a, b)}`)
        } else {
          used.add(k)
          at = tr.t[k]
          pass(out, rule, `${e.pin} ${e.edge ? '↑' : '↓'} at ${ms(at)} (window ${ms(a)}–${ms(b)}${fromTxt})`)
        }
      }
    } else if (e.pin !== undefined && e.level !== undefined) {
      const tr = traces.get(e.pin)
      if (!tr) noTrace(out, rule, e.pin)
      else {
        const l0 = levelAt(tr, a)
        const inside = edgesIn(tr, a + EPS * 10, b)
        if (l0 !== e.level) fail(out, rule, `${e.pin} expected ${e.level} throughout ${ms(a)}–${ms(b)}${fromTxt}, but it is ${lvl(l0)} at ${ms(a)}`)
        else if (inside.length) fail(out, rule, `${e.pin} expected ${e.level} throughout ${ms(a)}–${ms(b)}${fromTxt}, but it changed to ${lvl(tr.l[inside[0]])} at ${ms(tr.t[inside[0]])}`)
        else {
          at = a
          pass(out, rule, `${e.pin} = ${e.level} throughout ${ms(a)}–${ms(b)}`)
        }
      }
    } else if (e.pin !== undefined && e.every !== undefined) {
      const tr = traces.get(e.pin)
      if (!tr) noTrace(out, rule, e.pin)
      else {
        const tol = squareTol.get(e.pin) ?? DEFAULT_TOL_US / 1000
        const idx = edgesIn(tr, a, b)
        const wins = everyWins.get(e.pin) ?? []
        wins.push([a, b])
        everyWins.set(e.pin, wins)
        const t = idx.map((k) => tr.t[k])
        const errs: string[] = []
        if (t.length < 2) errs.push(`only ${t.length} edge(s) in ${ms(a)}–${ms(b)}`)
        else {
          const bad: string[] = []
          for (let k = 1; k < t.length; k++) {
            const d = t[k] - t[k - 1]
            if (Math.abs(d - e.every) > tol + EPS && bad.length < 3) bad.push(`${ms(t[k - 1])} → ${ms(t[k])} = ${d.toFixed(4)} ms`)
          }
          if (bad.length) errs.push(`edges not ${e.every} ms ± ${us(tol)} apart: ${bad.join('; ')}`)
          if (t[0] - a > e.every + tol + EPS) errs.push(`first edge only at ${ms(t[0])}`)
          if (b - t[t.length - 1] > e.every + tol + EPS) errs.push(`no edge after ${ms(t[t.length - 1])}`)
        }
        if (errs.length) fail(out, rule, `${e.pin} edges every ${e.every} ms expected in ${ms(a)}–${ms(b)}${fromTxt}: ${errs.join('; ')}`)
        else {
          at = t[0]
          pass(out, rule, `${t.length} edges ${e.every} ms ± ${us(tol)} apart in ${ms(a)}–${ms(b)}`)
        }
      }
    } else if (e.uart !== undefined && e.pin === undefined) {
      // README form { "at": [...], "uart": "<text>" }: text on the project's port
      at = matchUartExpect(out, rule, e.uart, a, b, fromTxt, uart, checks, run, byteClaims)
    } else {
      fail(out, rule, `expectation not understood: ${JSON.stringify(e)}`)
    }
    if (e.id) times.set(e.id, at)
  })

  // ---- quiet
  for (const q of sc.quiet ?? []) {
    const rule = `quiet ${q}`
    const st = uart.get(q)
    if (st) {
      const exp = claimed(byteClaims, q)
      const sig = sigClaims.get(q) ?? new Set<number>()
      const from = Math.max(0, bootEndOf(q))
      const stray: number[] = []
      for (let i = from; i < st.b.length; i++) {
        if (!inWin(st.t[i], 0, end)) continue
        if (!exp.has(i) && !sig.has(i)) stray.push(i)
      }
      if (stray.length) {
        const i0 = stray[0]
        let i1 = i0
        while (i1 + 1 < st.b.length && stray.includes(i1 + 1) && i1 - i0 < 60) i1++
        fail(out, rule, `${stray.length} unexpected byte(s), first "${escapeText(bytesText(st.b, i0, i1 + 1))}" from ${ms(st.t[i0])}`)
      } else pass(out, rule, 'no unexpected bytes')
      continue
    }
    const tr = traces.get(q)
    if (!tr) {
      noTrace(out, rule, q)
      continue
    }
    if (alwaysSquare.has(q)) {
      pass(out, rule, `${q} edges belong to its always-on square signal`)
      continue
    }
    const used = edgeClaims.get(q) ?? new Set<number>()
    const wins = everyWins.get(q) ?? []
    const stray = edgesIn(tr, 0, end).filter((k) => !used.has(k) && !wins.some(([a, b]) => inWin(tr.t[k], a, b)))
    if (stray.length) fail(out, rule, `${stray.length} unexpected edge(s) on ${q}: ${stray.slice(0, 4).map((k) => `${tr.l[k] === 1 ? '↑' : tr.l[k] === 0 ? '↓' : '?'} ${ms(tr.t[k])}`).join(', ')}`)
    else pass(out, rule, 'no unexpected edges')
  }
}

function expectLabel(e: ExpectSpec, i: number): string {
  const id = e.id ? ` ${e.id}` : ''
  if (e.pin !== undefined && e.edge !== undefined) return `expect[${i}]${id} ${e.pin} ${e.edge ? '↑' : '↓'}`
  if (e.pin !== undefined && e.level !== undefined) return `expect[${i}]${id} ${e.pin} = ${e.level}`
  if (e.pin !== undefined && e.every !== undefined) return `expect[${i}]${id} ${e.pin} every ${e.every} ms`
  if (e.uart !== undefined) return `expect[${i}]${id} uart "${escapeText(e.uart)}"`
  return `expect[${i}]${id}`
}

function describeNearEdges(tr: PinTrace, edge: 0 | 1, a: number, b: number): string {
  const same: number[] = []
  for (let k = 0; k < tr.t.length; k++) if (tr.l[k] === edge) same.push(tr.t[k])
  if (same.length === 0) return `${tr.pin} never went ${edge} (level ${lvl(levelAt(tr, b))} at ${ms(b)})`
  let best = same[0]
  for (const t of same) if (Math.abs(t - (a + b) / 2) < Math.abs(best - (a + b) / 2)) best = t
  const inside = edgesIn(tr, a, b).map((k) => tr.t[k])
  return `nearest ${edge ? 'rising' : 'falling'} edge at ${ms(best)}${inside.length ? `; edges inside the window: ${listTimes(inside)}` : ''}`
}

/**
 * `{ at, uart: "<text>" }`: the text must be transmitted contiguously with
 * its first byte inside the window, on the project's (single) UART port.
 */
function matchUartExpect(
  out: Outcomes,
  rule: string,
  text: string,
  a: number,
  b: number,
  fromTxt: string,
  uart: Map<string, UartStream>,
  checks: FirmwareChecks,
  run: RunData,
  byteClaims: Map<string, Set<number>>,
): number | null {
  const port = uartPortFor(checks)
  const st = port ? uart.get(port) : undefined
  if (!port || !st) {
    fail(out, rule, 'no UART port to observe (checks.uart / boot / t0 name none)')
    return null
  }
  const want = textBytes(text)
  let used = byteClaims.get(port)
  if (!used) byteClaims.set(port, (used = new Set()))
  const from = Math.max(0, run.bootEnd.get(port) ?? 0)
  let elsewhere = -1
  for (let i = from; i + want.length <= st.b.length; i++) {
    let ok = true
    for (let j = 0; j < want.length; j++) {
      if (st.b[i + j] !== want[j]) {
        ok = false
        break
      }
    }
    if (!ok) continue
    let taken = false
    for (let j = 0; j < want.length; j++) if (used.has(i + j)) taken = true
    if (taken) continue
    if (inWin(st.t[i], a, b)) {
      for (let j = 0; j < want.length; j++) used.add(i + j)
      pass(out, rule, `${port} "${escapeText(text)}" first byte at ${ms(st.t[i])} (window ${ms(a)}–${ms(b)}${fromTxt})`)
      return st.t[i]
    }
    if (elsewhere < 0 || Math.abs(st.t[i] - a) < Math.abs(st.t[elsewhere] - a)) elsewhere = i
  }
  let seen = ''
  if (elsewhere >= 0) seen = `found with its first byte at ${ms(st.t[elsewhere])} instead`
  else {
    const near = linesOf(st, from).filter((ln) => ln.t >= a - 50 && ln.t <= b + 50)
    seen = near.length
      ? `${port} sent ${near.slice(0, 3).map((l) => `"${escapeText(l.text)}" at ${ms(l.t)}`).join(', ')} around the window`
      : `${port} sent nothing matching (${st.b.length - from} byte(s) after the boot text)`
  }
  fail(out, rule, `${port} "${escapeText(text)}" expected with its first byte within ${ms(a)}–${ms(b)}${fromTxt}; ${seen}`)
  return null
}

/** The port uart expectations refer to: t0's port, else the only configured one. */
function uartPortFor(checks: FirmwareChecks): string | null {
  const t0 = checks.t0 ?? 'settle'
  if (t0.startsWith('uart:')) return t0.slice(5)
  const names = [...new Set([...Object.keys(checks.uart ?? {}), ...Object.keys(checks.boot ?? {})])]
  return names.length >= 1 ? names[0] : null
}

/** Multi-line human-readable summary of a report (test failure messages, lessons). */
export function formatReport(r: ChecksReport, verbose = false): string {
  const lines: string[] = [`${r.project}: ${r.ok ? 'PASS' : 'FAIL'}`]
  for (const run of r.runs) {
    const nFail = run.outcomes.filter((o) => !o.ok).length
    lines.push(
      `  [${run.ok ? 'ok' : 'FAIL'}] ${run.name} — ${run.outcomes.length - nFail}/${run.outcomes.length} rules` +
        (run.t0Ms !== null ? `, t0 = ${run.t0Ms.toFixed(3)} ms` : '') +
        `, ${Math.round(run.wallMs)} ms wall`,
    )
    for (const o of run.outcomes) if (!o.ok || verbose) lines.push(`      ${o.ok ? 'ok  ' : 'FAIL'} ${o.rule}: ${o.message}`)
    if (!run.ok || verbose) for (const l of run.log.slice(0, 10)) lines.push(`      log ${l}`)
  }
  return lines.join('\n')
}

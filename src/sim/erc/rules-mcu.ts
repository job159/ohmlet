/**
 * MCU / logic rules: GPIO overvoltage (rule 3), floating inputs (rule 4),
 * I²C pull-ups (rule 5) and logic-level mismatches (rule 6b).
 *
 * Hardware facts (STM32F103, DS5319 = DocID13587 Rev 16):
 *  - Table 9: VIN on a standard I/O −0.3 … VDD + 0.3 V; on a five-volt-
 *    tolerant (FT) I/O −0.3 … 5.5 V (2 V < VDD ≤ 3.6 V). Note 3: "To sustain
 *    a voltage higher than VDD+0.3 V, the internal pull-up/pull-down
 *    resistors must be disabled."
 *  - Table 7: injected current ±5 mA on standard pins, −5/+0 mA on FT pins
 *    (positive injection is not possible on FT pins); 25 mA per I/O.
 *  - Table 36: VOH ≥ VDD − 0.4 V (CMOS port, 8 mA).
 * The same limits drive the coordinator's run-time pin checks
 * (src/mcu/pins.ts STM32F1_GPIO, src/sim/coordinator/mcu-board.ts).
 *
 * I²C: SDA and SCL are open-drain lines that need pull-up resistors to the
 * supply (NXP UM10204 §3.1.1).
 */
import type { ErcFinding, ErcLevel } from './api'
import type { Circuit, Edge, NetPin, PartNode } from './graph'
import {
  edgesOn,
  fmtA,
  fmtOhm,
  fmtV,
  legacyVih,
  outputHigh,
  outputRailVoltage,
  netOfPin,
  otherEnd,
  pinsOn,
  railOf,
  refOfPin,
  supplyPinsOf,
  teleOf,
  trustedPinModes,
} from './graph'
import { listText, makeFinding } from './finding'
import { boardVdd, partSupply } from './paths'
import { firmwareModesSettled, inSystemMemory, MODE_SETTLE_S } from './mcu-state'
import { STM32F1_GPIO } from '../../mcu/pins'
import { formatHole, parseHole } from '../../model/breadboard'
import { occludedHoles } from '../../model/occlusion'
import { STRIP_ROWS } from '../../model/types'

/** Injected-current limit of a standard I/O (A) — DS5319 Table 7. */
const I_INJ_MAX = 0.005
/** A resistance above this is not a pull (the coordinator's floating-input threshold is 1 MΩ). */
const R_PULL_MAX = 1e6
/** FT pins of an STM32F103 in LQFP48 — for the "use an FT pin" hint (DS5319 Table 5). */
const FT_HINT = 'PA8–PA15, PB3, PB4, PB6–PB15'

interface McuPin {
  board: PartNode
  pin: string
  net: string
  ref: string | null
  ft: boolean
  /** board VDD relative to its ground (V); 3.3 assumed when unknown */
  vdd: number
  powered: boolean
  /** the board's GND pin reaches the circuit ground */
  grounded: boolean
  /** board ground voltage (ERC reference) */
  gnd: number
  /** firmware pin mode tag ('in', 'in↑', 'out', 'af-od' …) when the firmware is running */
  mode: string | null
  functions: string[]
}

/**
 * The board's pin modes when they are the running FIRMWARE's choice (IN-15):
 * trusted telemetry, not booted from system memory, not still at the reset
 * entry point and — when the board's last reset / load time is known — run
 * for at least `settle` seconds since then (default: MODE_SETTLE_S when the
 * reset time is known, else immediately). null otherwise.
 */
function firmwareModes(c: Circuit, board: PartNode, settle?: number): Record<string, string> | null {
  const tele = teleOf(c, board.comp.id)
  const modes = trustedPinModes(tele)
  if (!modes || !tele?.mcu || !c.telemetry) return null
  const id = board.comp.id
  const resetAt = c.mcuReset.resetAt?.[id]
  const ctx = { time: c.telemetry.time, resetAt, resetPc: c.mcuReset.resetPc?.[id] }
  return firmwareModesSettled(tele.mcu, ctx, settle ?? (resetAt !== undefined ? MODE_SETTLE_S : 0)) ? modes : null
}

/**
 * The MCU pins on nets, with the firmware's pin modes when they are its
 * choice (firmwareModes). `rawModes`: the telemetry's modes as they are
 * (a board in system memory — what the bootloader left).
 */
function mcuPins(c: Circuit, settle?: number, rawModes = false): McuPin[] {
  const out: McuPin[] = []
  for (const board of c.parts) {
    const spec = board.entry.mcu
    if (!spec) continue
    const vddRaw = boardVdd(c, board)
    const gndRail = railOf(c, netOfPin(board, spec.gndPin))
    const gnd = gndRail?.v ?? 0
    const modes = rawModes ? trustedPinModes(teleOf(c, board.comp.id)) : firmwareModes(c, board, settle)
    const info = new Map((board.entry.pinInfo ?? []).map((p) => [p.pin, p]))
    for (const pin of Object.keys(spec.pinMap)) {
      const net = netOfPin(board, pin)
      if (!net) continue
      out.push({
        board,
        pin,
        net,
        ref: refOfPin(board, pin),
        ft: info.get(pin)?.ft === true,
        vdd: Number.isFinite(vddRaw) ? vddRaw : 3.3,
        powered: Number.isFinite(vddRaw),
        grounded: gndRail !== undefined,
        gnd,
        mode: modes?.[pin] ?? null,
        functions: info.get(pin)?.functions ?? [],
      })
    }
  }
  return out
}

function pinName(p: McuPin): string {
  return `${p.board.comp.id} ${p.pin}`
}

const PULL_MODES = new Set(['in↑', 'in↓'])

// ---------------------------------------------------------------------------
// Rule 3 — GPIO overvoltage  +  Rule 6b — logic levels
// ---------------------------------------------------------------------------

interface HighSource {
  /** voltage relative to the MCU ground (V) */
  v: number
  what: string
  compId: string
  /** series resistance between the source and the pin (0 = direct) */
  r: number
  via: Edge | null
  kind: 'rail' | 'sig' | 'logic'
  vMin?: number
}

/** Voltage sources reaching the pin's net directly or through one resistor. */
function highSources(c: Circuit, p: McuPin): HighSource[] {
  const out: HighSource[] = []
  const at = (net: string, r: number, via: Edge | null) => {
    const rail = railOf(c, net)
    if (rail) out.push({ v: rail.v - p.gnd, what: rail.by, compId: rail.compId, r, via, kind: 'rail' })
    for (const np of pinsOn(c, net)) {
      if (np.part === p.board) continue
      if (np.role === 'sig') {
        const g = c.signals.find((s) => s.part === np.part)
        if (!g) continue
        const base = (railOf(c, g.gnd)?.v ?? 0) - p.gnd
        out.push({ v: base + g.vMax, vMin: base + g.vMin, what: `${np.part.comp.id} out`, compId: np.part.comp.id, r, via, kind: 'sig' })
      } else if ((np.role === 'out' || np.role === 'io') && !isI2cPin(np)) {
        const sp = supplyPinsOf(np.part.entry)
        const g = (sp ? railOf(c, netOfPin(np.part, sp.minus[0] ?? ''))?.v : undefined) ?? 0
        // a declared output rail (e.g. the module's 3.3 V regulator) is what the output swings to
        const rail = outputRailVoltage(c, np.part, np.pin)
        const vs = rail !== undefined ? rail - g : partSupply(c, np.part)
        if (!Number.isFinite(vs)) continue
        out.push({
          v: rail !== undefined ? rail - p.gnd : g - p.gnd + outputHigh(np.part.entry.type, vs),
          what: `${np.part.comp.id} ${np.pin} (an output powered at ${fmtV(vs)})`,
          compId: np.part.comp.id,
          r,
          via,
          kind: 'logic',
        })
      }
    }
  }
  at(p.net, 0, null)
  for (const e of edgesOn(c, p.net)) {
    if (e.kind !== 'resistor' && e.kind !== 'variable') continue
    const other = otherEnd(e, p.net)
    if (other !== p.net) at(other, e.r ?? 0, e)
  }
  return out
}

export function checkGpioVoltages(c: Circuit, out: ErcFinding[]): void {
  for (const p of mcuPins(c)) {
    // every pin is in spec up to VDD + 0.3 V; FT pins tolerate up to 5.5 V
    const limit = STM32F1_GPIO.vMaxStandard(p.vdd)
    const name = pinName(p)
    const srcs = highSources(c, p)
    const reported = new Set<string>()
    const emit = (level: ErcLevel, rule: 'gpio-overvoltage' | 'logic-level', s: HighSource, message: string, short: string) => {
      const key = `${p.board.comp.id}:${p.pin}:${s.compId}`
      if (reported.has(`${rule}:${key}`)) return
      reported.add(`${rule}:${key}`)
      out.push(
        makeFinding({
          rule,
          level,
          key,
          message,
          short,
          ref: 'DS5319 Tables 7 and 9',
          // beyond the absolute maximum (vivid damage facts): one row with the
          // simulator's measured 「… exceeds VDD + 0.3 V」 of the same pin
          fact: rule === 'gpio-overvoltage' && level === 'error' ? `absmax:${p.board.comp.id}:${p.pin}` : undefined,
          componentIds: [p.board.comp.id, s.compId, s.via?.compId],
          nets: [p.net, s.via ? otherEnd(s.via, p.net) : null],
          holes: [p.ref, s.via?.refA, s.via?.refB],
        }),
      )
    }
    const ftAdvice = `Use a 5 V-tolerant pin (${FT_HINT}), a level shifter, or a resistor divider (e.g. 10 kΩ / 20 kΩ).`

    // A pin held by a rail / output directly ignores resistor-coupled
    // sources; otherwise every resistor-coupled source (incl. pull-downs)
    // forms one Thevenin divider — the voltage the pin actually settles at
    // (input current negligible) and the resistance limiting the injection.
    const held = srcs.some((s) => s.r === 0)
    let gSum = 0
    let iSum = 0
    for (const s of srcs) {
      if (s.r > 0) {
        gSum += 1 / s.r
        iSum += s.v / s.r
      }
    }
    const vTh = gSum > 0 ? iSum / gSum : NaN
    const rTh = gSum > 0 ? 1 / gSum : Infinity

    for (const s of srcs) {
      if (s.r > 0 && held) continue
      const rule = s.kind === 'logic' ? 'logic-level' : 'gpio-overvoltage'
      const through = s.via ? ` through ${s.via.label} (${fmtOhm(s.r)})` : ''
      // the voltage the pin sees from this source
      const v = s.r > 0 ? vTh : s.v
      // negative swing (generator, negative rail)
      const vLow = s.vMin ?? s.v
      if (vLow < -0.3 - 0.005 && s.r === 0) {
        emit(
          'error',
          'gpio-overvoltage',
          s,
          `${name} is connected to ${s.what}, which goes down to ${fmtV(vLow)} — below the VSS − 0.3 V limit. ` +
            `Keep the signal between 0 V and ${fmtV(p.vdd)} (offset it, or add a clamp / divider).`,
          `${name} below 0 V`,
        )
      }
      if (!p.powered && p.grounded && s.v > 0.3 && s.r === 0) {
        emit(
          'risk',
          'gpio-overvoltage',
          s,
          `${p.board.comp.id} is not powered, yet ${p.pin} is connected to ${s.what} (${fmtV(s.v)}): current flows into the pin and back-powers the chip through its protection structures. ` +
            `Power the board, or disconnect the signal while it is off.`,
          `${name} back-powers ${p.board.comp.id}`,
        )
        continue
      }
      if (!(s.v > limit + 0.005) || !(v > limit + 0.005)) {
        continue
      }
      const divided = s.r > 0 && Math.abs(v - s.v) > 0.005 ? ` (the resistors on the pin divide it to ≈ ${fmtV(v)})` : ''
      if (!p.ft) {
        if (s.r === 0) {
          emit(
            'error',
            rule,
            s,
            `${name} is not 5 V tolerant (limit VDD + 0.3 V = ${fmtV(limit)}) but is driven to ${fmtV(s.v)} by ${s.what}: ` +
              `its protection diode conducts and current is forced into the chip. ${ftAdvice}`,
            `${name} voltage too high`,
          )
        } else {
          const iInj = (v - limit) / Math.max(rTh, 1e-3)
          emit(
            iInj > I_INJ_MAX ? 'error' : 'risk',
            rule,
            s,
            `${name} is not 5 V tolerant (limit ${fmtV(limit)}) but is pulled toward ${fmtV(s.v)} by ${s.what}${through}${divided}: ` +
              `≈ ${fmtA(iInj)} would be injected into the pin` +
              `${iInj > I_INJ_MAX ? `, above the ±5 mA injection limit` : ` (within the ±5 mA injection limit, but outside the operating range and it back-feeds VDD)`}. ${ftAdvice}`,
            `${name} voltage too high`,
          )
        }
        continue
      }
      // five-volt-tolerant pin
      if (v > STM32F1_GPIO.vMaxFt(p.vdd) + 0.005) {
        emit(
          'error',
          rule,
          s,
          `${name} is 5 V tolerant but only up to ${fmtV(STM32F1_GPIO.vMaxFt(p.vdd))}; ${s.what}${through} takes it to ${fmtV(v)}` +
            `${s.r > 0 ? ' — FT pins cannot sink positive injection current, so the resistor does not protect it' : ''}. ` +
            `Use a divider or level shifter.`,
          `${name} voltage too high`,
        )
      } else if (p.mode !== null && PULL_MODES.has(p.mode)) {
        emit(
          'risk',
          rule,
          s,
          `${name} is 5 V tolerant, but the running firmware enabled its internal pull-${p.mode === 'in↑' ? 'up' : 'down'} while ${s.what}${through} takes it to ${fmtV(v)}: ` +
            `to sustain more than VDD + 0.3 V the internal pull-up/pull-down must be disabled. Configure the pin with GPIO_NOPULL.`,
          `${name}: turn off the internal pull`,
        )
      } else {
        emit(
          'info',
          rule,
          s,
          `${name} is 5 V tolerant (FT), so ${fmtV(v)} from ${s.what}${through} is allowed (≤ 5.5 V) — ` +
            `but keep its internal pull-up/pull-down disabled: a pin above VDD + 0.3 V needs GPIO_NOPULL.`,
          `${name} gets 5 V (FT pin)`,
        )
      }
    }

    // 3.3 V output into a 5 V CMOS input
    if (p.mode !== null && !['out', 'af'].includes(p.mode)) continue
    for (const np of pinsOn(c, p.net)) {
      if (np.part === p.board || (np.role !== 'in' && np.role !== 'io') || isI2cPin(np)) continue
      const vs = partSupply(c, np.part)
      if (!Number.isFinite(vs)) continue
      const vih = inputVih(np, vs)
      if (!(vih > p.vdd + 0.005)) continue
      const id = np.part.comp.id
      const key = `${p.board.comp.id}:${p.pin}:${id}:${np.pin}`
      out.push(
        makeFinding({
          rule: 'logic-level',
          level: 'risk',
          key,
          message:
            `${id} (${np.part.entry.label}, powered at ${fmtV(vs)}) needs at least ${fmtV(vih)} on ${np.pin} to read a logic high, ` +
            `but ${name} drives at most ${fmtV(p.vdd)}${p.mode === null ? ' (if the firmware uses it as an output)' : ''}. ` +
            `Use a level shifter (e.g. a 74HCT buffer) or power ${id} from 3.3 V.` +
            `${np.part.entry.digital ? '' : ' (The simulator’s behavioral chips switch at 0.5·VCC, so it may still appear to work here.)'}`,
          short: `${id} ${np.pin} needs a higher logic level`,
          componentIds: [p.board.comp.id, id],
          nets: [p.net],
          holes: [p.ref, refOfPin(np.part, np.pin)],
        }),
      )
    }
  }
}

/**
 * Signal pins of parts with a stated absolute-maximum pin voltage
 * (ratings.vPinMax, relative to the part's minus supply) tied directly to a
 * higher rail or generator.
 */
export function checkPinRatings(c: Circuit, out: ErcFinding[]): void {
  for (const part of c.parts) {
    const vMax = part.entry.ratings?.vPinMax
    if (vMax === undefined || part.entry.mcu) continue
    const sp = supplyPinsOf(part.entry)
    const minus = railOf(c, sp ? netOfPin(part, sp.minus[0] ?? '') : null)
    if (!minus) continue
    part.entry.pins.forEach((pin, i) => {
      const role = part.roles[i]
      const net = part.nets[i]
      if (!net || role === 'vcc' || role === 'gnd') return
      const rail = railOf(c, net)
      let v = rail ? rail.v - minus.v : NaN
      let by = rail?.by ?? ''
      let byId = rail?.compId ?? ''
      if (!rail) {
        for (const np of pinsOn(c, net)) {
          if (np.role !== 'sig') continue
          const g = c.signals.find((s) => s.part === np.part)
          if (!g) continue
          v = (railOf(c, g.gnd)?.v ?? 0) + g.vMax - minus.v
          by = `${np.part.comp.id} out (peak)`
          byId = np.part.comp.id
        }
      }
      if (!(v > vMax + 0.005)) return
      out.push(
        makeFinding({
          rule: 'logic-level',
          level: 'error',
          key: `${part.comp.id}:${pin}:vpin`,
          message:
            `${part.comp.id} ${pin} is driven to ${fmtV(v)} by ${by}, above the ${fmtV(vMax)} absolute-maximum input voltage of the ${part.entry.label}. ` +
            `Keep its inputs within its supply (e.g. tie them to the part’s own VCC, or use a divider).`,
          short: `${part.comp.id} ${pin} above its maximum input`,
          componentIds: [part.comp.id, byId],
          nets: [net],
          holes: [part.refs[i]],
        }),
      )
    })
  }
}

function inputVih(np: NetPin, vs: number): number {
  const d = np.part.entry.digital
  if (d) return (d.vihFrac ?? 0.7) * vs
  return legacyVih(np.part.entry.type, vs)
}

// ---------------------------------------------------------------------------
// Rule 4 — floating inputs
// ---------------------------------------------------------------------------

interface Pull {
  edge: Edge
  v: number
  by: string
}

/** Resistor-like elements from `net` to a rail (pull-ups / pull-downs), incl. board sub-circuits. */
export function pullsOn(c: Circuit, net: string): Pull[] {
  const out: Pull[] = []
  for (const e of edgesOn(c, net)) {
    if (e.kind !== 'resistor' && e.kind !== 'variable') continue
    if ((e.r ?? 0) > R_PULL_MAX) continue
    const other = otherEnd(e, net)
    if (other === net) continue
    const rail = railOf(c, other)
    if (rail) out.push({ edge: e, v: rail.v, by: rail.by })
  }
  return out
}

/** Something other than `self` that sets the level of `net` (driver or rail). */
function otherDriver(c: Circuit, net: string, self: NetPin | null): string | null {
  const rail = railOf(c, net)
  if (rail) return rail.by
  for (const np of pinsOn(c, net)) {
    if (self && np.part === self.part && np.pin === self.pin) continue
    if (np.role === 'gpio' || np.role === 'out' || np.role === 'sig') return `${np.part.comp.id} ${np.pin}`
    if (np.role === 'io' && !isI2cPin(np)) return `${np.part.comp.id} ${np.pin}`
  }
  return null
}

interface SwitchLink {
  edges: Edge[]
  /** rail voltages the switch can connect the net to */
  targets: { v: number; by: string; net: string }[]
  /** every position connects the net to some rail (SPDT with both throws wired) */
  alwaysDefined: boolean
}

function switchesOn(c: Circuit, net: string): SwitchLink[] {
  const byComp = new Map<string, Edge[]>()
  for (const e of edgesOn(c, net)) {
    if (e.kind !== 'switch' || e.a === e.b) continue
    const key = e.compId + (e.label.includes('switch ') ? e.label : '')
    if (!byComp.has(key)) byComp.set(key, [])
    byComp.get(key)!.push(e)
  }
  const out: SwitchLink[] = []
  for (const edges of byComp.values()) {
    const targets: SwitchLink['targets'] = []
    for (const e of edges) {
      const other = otherEnd(e, net)
      const rail = railOf(c, other)
      if (rail) targets.push({ v: rail.v, by: rail.by, net: other })
    }
    if (targets.length === 0) continue
    // SPDT common on this net with every throw on a rail: defined in each position
    const alwaysDefined = edges.length >= 2 && targets.length === edges.length
    out.push({ edges, targets, alwaysDefined })
  }
  return out
}

export function checkFloatingInputs(c: Circuit, out: ErcFinding[]): void {
  for (const p of mcuPins(c)) {
    const self = pinsOn(c, p.net).find((np) => np.part === p.board && np.pin === p.pin) ?? null
    const links = switchesOn(c, p.net)
    if (links.length === 0) continue
    if (links.some((l) => l.alwaysDefined)) continue
    if (otherDriver(c, p.net, self)) continue
    const link = links[0]
    const t = link.targets[0]
    const toHigh = t.v - p.gnd > p.vdd / 2
    const sw = listText([...new Set(link.edges.map((e) => e.label))])
    const name = pinName(p)
    const pulls = pullsOn(c, p.net)
    const comps = [p.board.comp.id, ...link.edges.map((e) => e.compId)]
    const holes = [p.ref, ...link.edges.flatMap((e) => [e.refA, e.refB])]
    const key = `${p.board.comp.id}:${p.pin}`
    const target = `${t.by} (${fmtV(t.v - p.gnd)})`
    const wantPull = toHigh ? 'pull-down' : 'pull-up'
    const pullMode = toHigh ? 'GPIO_PULLDOWN' : 'GPIO_PULLUP'
    const extRail = toHigh ? 'GND' : '3.3 V'

    if (pulls.length > 0) {
      // a pull exists — but does it pull the other way?
      const same = pulls.filter((q) => Math.abs(q.v - t.v) < p.vdd / 2)
      if (same.length === pulls.length) {
        out.push(
          makeFinding({
            rule: 'floating-input',
            level: 'risk',
            key,
            message:
              `${sw} and ${listText(same.map((q) => q.edge.label))} both connect ${name} to ${toHigh ? 'the high rail' : 'ground'}, so pressing ${sw} changes nothing. ` +
              `Connect ${listText(same.map((q) => q.edge.label))} to ${extRail} instead (a ${wantPull}).`,
            short: `${name}: the pull goes the wrong way`,
            componentIds: [...comps, ...same.map((q) => q.edge.compId)],
            nets: [p.net],
            holes,
          }),
        )
      }
      continue
    }

    let level: ErcLevel | null = 'risk'
    let message: string
    switch (p.mode) {
      case 'in↑':
      case 'in↓': {
        const pullHigh = p.mode === 'in↑'
        if (pullHigh !== toHigh) {
          level = null // the internal pull defines the open state
          message = ''
        } else {
          message =
            `The firmware enabled ${name}’s internal pull-${pullHigh ? 'up' : 'down'}, but ${sw} also connects it to ${target}: pressing ${sw} changes nothing. ` +
            `Wire ${sw} to ${extRail} instead, or use ${pullMode}.`
        }
        break
      }
      case 'out':
      case 'af':
        message =
          `${name} is a push-pull output in the running firmware, and ${sw} connects it to ${target}: closing ${sw} while the pin drives the opposite level short-circuits its driver ` +
          `(over the 25 mA pin limit). Configure ${p.pin} as an input with a ${wantPull} (${pullMode}), or add a 1 kΩ series resistor.`
        break
      case 'od':
      case 'af-od':
        message = toHigh
          ? `${name} is an open-drain output and ${sw} connects it to ${target}: closing ${sw} while the pin pulls low short-circuits it. Configure ${p.pin} as an input with ${pullMode}.`
          : `${name} is an open-drain output with no pull-up: when it is released and ${sw} is open the line floats. Add a pull-up (e.g. 10 kΩ to 3.3 V) or configure the pin with ${pullMode}.`
        break
      case 'in':
      case 'an':
        message =
          `The running firmware configured ${name} as a ${p.mode === 'an' ? 'analog' : 'floating'} input (GPIO_NOPULL) and only ${sw} connects it to ${target}: ` +
          `while ${sw} is open nothing sets its level, so it reads random values. Enable the internal ${wantPull} (${pullMode}) or add a 10 kΩ resistor from ${p.pin} to ${extRail}.`
        break
      default:
        message =
          `${sw} connects ${name} to ${target}, but nothing sets its level while ${sw} is open: unless the firmware enables an internal ${wantPull}, the input floats and reads random values. ` +
          `Enable the internal ${wantPull} (${pullMode}) or add a 10 kΩ resistor from ${p.pin} to ${extRail}.`
    }
    if (level === null) continue
    const short =
      p.mode === 'in↑' || p.mode === 'in↓'
        ? `${name}: the pull goes the wrong way`
        : p.mode === 'out' || p.mode === 'af' || ((p.mode === 'od' || p.mode === 'af-od') && toHigh)
          ? `${name}: the button can short the output`
          : p.mode === 'od' || p.mode === 'af-od'
            ? `${name}: open-drain without a pull`
            : `${name} input is floating`
    const ref = p.mode === 'out' || p.mode === 'af' ? 'DS5319 Table 7' : undefined
    out.push(makeFinding({ rule: 'floating-input', level, key, message, short, ref, componentIds: comps, nets: [p.net], holes }))
  }

  // logic-device inputs (no firmware can pull them)
  for (const part of c.parts) {
    if (!part.entry.digital) continue
    part.entry.pins.forEach((pin, i) => {
      // pins the device itself may drive (incl. internal pulls) never float
      if (part.roles[i] !== 'in' || part.entry.digital!.outputs.includes(pin)) return
      const net = part.nets[i]
      if (!net) return
      const self: NetPin = { part, pin, index: i, role: 'in' }
      const links = switchesOn(c, net)
      if (links.length === 0 || links.some((l) => l.alwaysDefined)) return
      if (otherDriver(c, net, self) || pullsOn(c, net).length > 0) return
      const link = links[0]
      const sw = listText([...new Set(link.edges.map((e) => e.label))])
      const toHigh = link.targets[0].v > 1.5
      out.push(
        makeFinding({
          rule: 'floating-input',
          level: 'risk',
          key: `${part.comp.id}:${pin}`,
          message:
            `${part.comp.id} ${pin} is only connected to ${link.targets[0].by} through ${sw}: while ${sw} is open the input floats. ` +
            `Add a 10 kΩ ${toHigh ? 'pull-down to GND' : 'pull-up to the supply'}.`,
          short: `${part.comp.id} ${pin} input is floating`,
          componentIds: [part.comp.id, ...link.edges.map((e) => e.compId)],
          nets: [net],
          holes: [part.refs[i], ...link.edges.flatMap((e) => [e.refA, e.refB])],
        }),
      )
    })
  }
}

// ---------------------------------------------------------------------------
// Rule 5 — I²C pull-ups
// ---------------------------------------------------------------------------

type I2cSignal = 'SDA' | 'SCL'

/** Holes a part pin, a wire end or a part's body takes (per circuit). */
const takenCache = new WeakMap<Circuit, Set<string>>()
function takenHoles(c: Circuit): Set<string> {
  let taken = takenCache.get(c)
  if (taken) return taken
  taken = new Set<string>()
  for (const part of c.parts) {
    for (const r of part.refs) if (r) taken.add(r)
    for (const r of occludedHoles(part.comp, part.entry, c.board)) taken.add(r)
  }
  for (const w of c.wires) {
    for (const end of [w.from, w.to]) {
      const h = typeof end === 'string' ? parseHole(end) : null
      if (h) taken.add(formatHole(h))
    }
  }
  takenCache.set(c, taken)
  return taken
}

/**
 * The free hole nearest to a pin in its own 5-hole strip — where the pull-up
 * resistor goes (IN-19: 「在電路板上標示」 rings a hole the user can see and
 * use, not only the pin under the board). null when the strip is full.
 */
function freeHoleBeside(c: Circuit, ref: string | null): string | null {
  const h = ref ? parseHole(ref) : null
  if (!h || h.kind !== 'strip') return null
  const at = STRIP_ROWS.indexOf(h.row)
  const half = at < 5 ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9]
  const taken = takenHoles(c)
  const order = half.filter((i) => i !== at).sort((a, b) => Math.abs(a - at) - Math.abs(b - at))
  for (const i of order) {
    const r = formatHole({ ...h, row: STRIP_ROWS[i] })
    if (!taken.has(r)) return r
  }
  return null
}

/** I²C signal of a non-MCU pin (name or pinInfo function), else null. */
function deviceI2cSignal(np: NetPin): I2cSignal | null {
  const e = np.part.entry
  if (e.mcu || e.sim.kind !== 'chip') return null
  if (np.role === 'vcc' || np.role === 'gnd') return null
  const name = np.pin.toUpperCase()
  if (/(^|_)SDA\d*$/.test(name)) return 'SDA'
  if (/(^|_)SCL\d*$/.test(name)) return 'SCL'
  const fns = e.pinInfo?.find((p) => p.pin === np.pin)?.functions ?? []
  if (fns.some((f) => /\bSDA\b/i.test(f))) return 'SDA'
  if (fns.some((f) => /\bSCL\b/i.test(f))) return 'SCL'
  return null
}

function isI2cPin(np: NetPin): boolean {
  return deviceI2cSignal(np) !== null
}

/** I²C signals an MCU pin can carry (pinInfo functions I2Cn_SDA / I2Cn_SCL, incl. remaps). */
function mcuI2cSignals(p: McuPin): I2cSignal[] {
  const out: I2cSignal[] = []
  for (const f of p.functions) {
    const m = /I2C\d_(SDA|SCL)/.exec(f)
    if (m && !out.includes(m[1] as I2cSignal)) out.push(m[1] as I2cSignal)
  }
  return out
}

export function checkI2c(c: Circuit, out: ErcFinding[]): void {
  const mcu = mcuPins(c)
  const mcuByNet = new Map<string, McuPin[]>()
  for (const p of mcu) {
    if (mcuI2cSignals(p).length === 0) continue
    if (!mcuByNet.has(p.net)) mcuByNet.set(p.net, [])
    mcuByNet.get(p.net)!.push(p)
  }
  const nets = new Set<string>()
  for (const [net, list] of c.pinsByNet) if (list.some((np) => isI2cPin(np))) nets.add(net)
  for (const [net, list] of mcuByNet) if (list.some((p) => p.mode === 'af-od' || p.mode === 'od')) nets.add(net)

  for (const net of nets) {
    const devEnds = pinsOn(c, net).filter((np) => isI2cPin(np))
    const mcuEnds = mcuByNet.get(net) ?? []
    const allMcuOnNet = mcu.filter((p) => p.net === net)

    // SDA ↔ SCL swapped against the MCU pin's I²C function
    for (const d of devEnds) {
      const sig = deviceI2cSignal(d)!
      for (const p of mcuEnds) {
        const sigs = mcuI2cSignals(p)
        if (sigs.length === 1 && sigs[0] !== sig) {
          out.push(
            makeFinding({
              rule: 'i2c-pullup',
              level: 'risk',
              key: `${d.part.comp.id}:${d.pin}:swap:${p.board.comp.id}:${p.pin}`,
              message:
                `${d.part.comp.id} ${d.pin} (I²C ${sig}) is wired to ${pinName(p)}, whose I²C function is ${p.functions.filter((f) => /I2C\d_/.test(f)).join(' / ')}: ` +
                `SDA and SCL look swapped. Connect ${sig} to an MCU pin with an I2Cn_${sig} function.`,
              short: 'I²C SDA and SCL swapped',
              componentIds: [d.part.comp.id, p.board.comp.id],
              nets: [net],
              holes: [refOfPin(d.part, d.pin), p.ref],
            }),
          )
        }
      }
    }

    const pulls = pullsOn(c, net).filter((q) => q.v > 1.0)
    if (pulls.length > 0) continue
    // a module's own on-board resistor to an internal (unanalyzed) node is
    // most likely its pull-up: never claim a missing pull-up then
    if (edgesOn(c, net).some((e) => e.kind === 'resistor' && e.sub !== undefined && !railOf(c, otherEnd(e, net)))) continue

    const odMcu = allMcuOnNet.filter((p) => p.mode === 'af-od' || p.mode === 'od')
    const ppMcu = allMcuOnNet.filter((p) => p.mode === 'out' || p.mode === 'af')

    // the running firmware made an I²C pin open-drain (the I2C peripheral took
    // it) and nothing on its net pulls it up — even with no device wired yet
    // the bus cannot work (ENG-07): STM32F1 pins have no internal pull in AF mode
    if (devEnds.length === 0 && odMcu.length === 1 && ppMcu.length === 0 && !otherPushPull(c, net)) {
      for (const p of odMcu) {
        if (p.mode !== 'af-od') continue
        const fn = p.functions.map((f) => /^I2C(\d)_(SDA|SCL)$/.exec(f)).find((m) => m !== null)
        if (!fn) continue
        const bus = `I²C${fn[1]}`
        out.push(
          makeFinding({
            rule: 'i2c-pullup',
            level: 'risk',
            key: `${p.board.comp.id}:${p.pin}:lone`,
            message:
              `${bus} ${fn[2]} (${pinName(p)}) is open-drain, but its net has no pull-up resistor: ` +
              `add a 4.7 kΩ resistor from SCL and from SDA to 3.3 V.`,
            short: `${bus} ${fn[2]} has no pull-up`,
            ref: 'NXP UM10204 §3.1.1',
            group: `i2c-lone:${p.board.comp.id}`,
            componentIds: [p.board.comp.id],
            nets: [net],
            holes: [p.ref, freeHoleBeside(c, p.ref)],
          }),
        )
      }
      continue
    }
    const unknownMcu = allMcuOnNet.filter((p) => p.mode === null && mcuI2cSignals(p).length > 0)
    const odEnds = devEnds.length + odMcu.length
    const sig: I2cSignal =
      (devEnds[0] && deviceI2cSignal(devEnds[0])) || (odMcu[0] && mcuI2cSignals(odMcu[0])[0]) || 'SDA'
    const ends = [
      ...devEnds.map((d) => `${d.part.comp.id} ${d.pin}`),
      ...[...odMcu, ...unknownMcu].map((p) => `${pinName(p)}${p.mode ? ` (${p.mode})` : ''}`),
    ]
    const comps = [...devEnds.map((d) => d.part.comp.id), ...allMcuOnNet.map((p) => p.board.comp.id)]
    const holes = [
      ...devEnds.map((d) => refOfPin(d.part, d.pin)),
      ...allMcuOnNet.flatMap((p) => [p.ref, freeHoleBeside(c, p.ref)]),
    ]
    const fix = `Add a pull-up resistor (typically 4.7 kΩ) from this ${sig} line to 3.3 V — one on SDA and one on SCL.`
    if (odEnds >= 2 && ppMcu.length === 0 && !otherPushPull(c, net)) {
      out.push(
        makeFinding({
          rule: 'i2c-pullup',
          level: 'error',
          key: net,
          message:
            `The I²C ${sig} line ${listText(ends)} has no pull-up resistor: SDA and SCL are open-drain, ` +
            `so every device can only pull it low and nothing ever drives it high — the bus cannot work. ${fix}`,
          short: `I²C ${sig} has no pull-up`,
          group: 'i2c-pullup',
          ref: 'NXP UM10204 §3.1.1',
          componentIds: comps,
          nets: [net],
          holes,
        }),
      )
    } else if (devEnds.length > 0 && (unknownMcu.length > 0 || odMcu.length > 0) && ppMcu.length === 0) {
      out.push(
        makeFinding({
          rule: 'i2c-pullup',
          level: 'risk',
          key: net,
          message:
            `${listText(ends)} form an I²C ${sig} line without a pull-up resistor. If the firmware uses I²C here (the MCU pin then becomes open-drain), ` +
            `nothing drives the line high and the bus cannot work. ${fix}`,
          short: `I²C ${sig} has no pull-up`,
          group: 'i2c-pullup',
          componentIds: comps,
          nets: [net],
          holes,
        }),
      )
    }
  }
}

// ---------------------------------------------------------------------------
// gpio-mode — a load hangs on a pin the running firmware never drives (IN-8)
// ---------------------------------------------------------------------------

/** Input / analog modes: the firmware does not drive the pin. */
const UNDRIVEN_MODES: Record<string, string> = {
  in: 'a floating input',
  'in↑': 'an input with pull-up',
  'in↓': 'an input with pull-down',
  an: 'an analog input',
}

/** The load on `net`: an LED lead, a buzzer, a transistor base / gate (first one found). */
function loadOn(c: Circuit, net: string, board: PartNode): { id: string; kind: 'led' | 'other' } | null {
  for (const np of pinsOn(c, net)) {
    if (np.part === board || np.part.entry.sim.kind !== 'device') continue
    const model = np.part.entry.sim.model
    if (model === 'led') return { id: np.part.comp.id, kind: 'led' }
    if (model === 'buzzer' || ((model === 'npn' || model === 'pnp') && np.pin === 'base') || ((model === 'nmos' || model === 'pmos' || model === 'irlz44n') && np.pin === 'gate')) {
      return { id: np.part.comp.id, kind: 'other' }
    }
  }
  return null
}

/**
 * Live rule 'gpio-mode' (risk): an LED / buzzer / transistor base hangs only
 * on MCU pin P — directly or through one series resistor — and after
 * MODE_SETTLE_S of running the firmware still has P as an input or analog
 * pin, so nothing will ever drive the load ("wrong firmware / wrong pin",
 * STU-10). Uses only the real pin modes the firmware programmed.
 */
/** The load on an MCU pin's own net, or one resistor away (and nothing else drives that net). */
function undrivenLoad(c: Circuit, p: McuPin): { load: { id: string; kind: 'led' | 'other' }; via: Edge | null } | null {
  const self = pinsOn(c, p.net).find((np) => np.part === p.board && np.pin === p.pin) ?? null
  if (otherDriver(c, p.net, self)) return null
  const load = loadOn(c, p.net, p.board)
  if (load) return { load, via: null }
  for (const e of edgesOn(c, p.net)) {
    if (e.kind !== 'resistor') continue
    const other = otherEnd(e, p.net)
    if (other === p.net || otherDriver(c, other, null)) continue
    const far = loadOn(c, other, p.board)
    if (far) return { load: far, via: e }
  }
  return null
}

export function checkGpioModes(c: Circuit, out: ErcFinding[]): void {
  if (!c.telemetry) return
  // a board running its ROM bootloader (BOOT0 = 1): its loads stay dark because
  // the firmware never runs — a consequence of that state (the problems list
  // folds it under the BOOT0 row), never the firmware's pin choice (IN-15)
  for (const p of mcuPins(c, 0, true)) {
    const mcu = teleOf(c, p.board.comp.id)?.mcu
    if (!mcu || (mcu.state !== 'running' && mcu.state !== 'sleeping') || !inSystemMemory(mcu.pc)) continue
    if (p.mode === null || !(p.mode in UNDRIVEN_MODES)) continue
    const u = undrivenLoad(c, p)
    if (!u) continue
    out.push(
      makeFinding({
        rule: 'gpio-mode',
        level: 'risk',
        key: `${p.board.comp.id}:${p.pin}`,
        message: `${u.load.id} hangs on ${pinName(p)}, but ${p.board.comp.id} runs its ROM bootloader (BOOT0 = 1), not your firmware, so nothing drives ${p.pin}. Set BOOT0 back to 0 and reset the MCU.`,
        short: `${u.load.id} on ${p.pin}: the firmware is not running`,
        componentIds: [u.load.id, p.board.comp.id, u.via?.compId],
        nets: [p.net],
        holes: [p.ref, u.via?.refA, u.via?.refB],
      }),
    )
  }
  // per board: MODE_SETTLE_S of run time since ITS last reset / load (a Reset
  // MCU or a re-flash while paused puts every pin back to input), never from
  // system memory (BOOT0 = 1) or still at the reset entry point (IN-15)
  for (const p of mcuPins(c, MODE_SETTLE_S)) {
    if (p.mode === null || !(p.mode in UNDRIVEN_MODES)) continue
    // only a core that runs its firmware chose these modes: a locked-up /
    // halted / unpowered board has its own, more fundamental problem
    const st = teleOf(c, p.board.comp.id)?.mcu?.state
    if (st !== 'running' && st !== 'sleeping') continue
    const u = undrivenLoad(c, p)
    if (!u) continue
    const { load, via } = u
    const fw = teleOf(c, p.board.comp.id)?.mcu?.firmware
    const name = pinName(p)
    const modeWord = UNDRIVEN_MODES[p.mode]
    // the firmware DID write the port, but its RCC clock was off: the root cause is the clock, not the pin choice
    const port = /^P([A-G])\d{1,2}$/.exec(p.board.entry.mcu?.pinMap[p.pin] ?? p.pin)
    const gpio = port ? `GPIO${port[1]}` : null
    if (gpio && p.mode === 'in' && c.mcuReset.unclocked?.[p.board.comp.id]?.includes(gpio)) {
      const bit = `IOP${port![1]}EN`
      out.push(
        makeFinding({
          rule: 'gpio-mode',
          level: 'risk',
          key: `${p.board.comp.id}:${p.pin}`,
          message:
            `The firmware writes to ${gpio}, but ${gpio}’s clock is off (RCC_APB2ENR.${bit} = 0), so the writes are ignored and ${p.pin} stays a floating input. ` +
            `Call __HAL_RCC_${gpio}_CLK_ENABLE() first.`,
          short: `${gpio} has no clock: ${p.pin} is not driven`,
          ref: 'RM0008 §7.3.7',
          fact: `gpio-clock:${p.board.comp.id}:${gpio}`,
          componentIds: [load.id, p.board.comp.id, via?.compId],
          nets: [p.net],
          holes: [p.ref, via?.refA, via?.refB],
        }),
      )
      continue
    }
    const tail = 'Check which pin the firmware drives — the Pins tab lists every pin’s mode.'
    out.push(
      makeFinding({
        rule: 'gpio-mode',
        level: 'risk',
        key: `${p.board.comp.id}:${p.pin}`,
        message:
          load.kind === 'led'
            ? `${load.id} hangs on ${name}, but the running firmware${fw ? ` (${fw})` : ''} leaves ${p.pin} as ${modeWord}, so the LED stays dark. ${tail}`
            : `${load.id} hangs on ${name}, but the running firmware${fw ? ` (${fw})` : ''} leaves ${p.pin} as ${modeWord}, so nothing drives it. ${tail}`,
        short: `${load.id} on ${p.pin}: not an output`,
        componentIds: [load.id, p.board.comp.id, via?.compId],
        nets: [p.net],
        holes: [p.ref, via?.refA, via?.refB],
      }),
    )
  }
}

/** A push-pull driver (logic output / generator / non-I²C push-pull pin) on the net. */
function otherPushPull(c: Circuit, net: string): boolean {
  return pinsOn(c, net).some((np) => np.role === 'out' || np.role === 'sig')
}

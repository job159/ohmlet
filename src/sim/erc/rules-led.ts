/**
 * Rule 2 — LED current limiting.
 *
 * For every LED junction (an `led` part, each segment of a 7-segment
 * display) the anode side is walked upstream to what drives it and the
 * cathode side downstream to what sinks it (paths.ts). A path with no
 * resistance at all means nothing limits the LED current:
 *  - error: both ends are fixed supply rails and the path has no switch,
 *    transistor or potentiometer (the LED sits directly across a supply);
 *  - risk:  a GPIO / logic output / generator drives it, or the path goes
 *    through a switch, transistor or potentiometer.
 * With series resistance, the worst-case current (rail-to-rail, ideal
 * drivers) is compared with the part's `ratings.ifMax`: above it → risk.
 * Telemetry adds the measured current; a model-reported burn-out
 * (LedDevice.burned) makes it an error.
 *
 * Reversed LEDs (IN-17): cathode toward the supply rail and anode toward
 * ground → risk (it can never light); cathode toward a GPIO / logic output
 * and anode toward ground → info until the simulation shows it (a pin the
 * firmware drives low never reverse-biases it); while running, a cathode
 * measured more than 1 V above the anode with no current → error, naming
 * both holes and the measured voltage.
 */
import type { ErcFinding, ErcLevel } from './api'
import type { Circuit, Edge, PartNode } from './graph'
import { fmtA, fmtOhm, fmtV, teleOf } from './graph'
import { fmtCurrent, fmtVoltage } from '../../instruments/format'
import { fmtLight } from '../../instruments/led-light'
import { e12AtLeast, listText, makeFinding } from './finding'
import { conditionalCount, reach } from './paths'
import type { Reach } from './paths'
import { STM32F1_GPIO } from '../../mcu/pins'

/** Design current used for the series-resistor suggestion (A) — the LED model's full brightness. */
const DESIGN_CURRENT = 0.01


interface LedSubject {
  part: PartNode
  edges: Edge[]
  /** "D1" or "DS1 segment A" */
  name: (e: Edge) => string
  ifMax: number
}

function ledSubjects(c: Circuit): LedSubject[] {
  const out: LedSubject[] = []
  for (const part of c.parts) {
    const e = part.entry
    if (e.sim.kind !== 'device') continue
    if (e.sim.model !== 'led' && e.sim.model !== 'seven_segment') continue
    const edges = c.edges.filter((x) => x.compId === part.comp.id && x.kind === 'junction' && x.sub === undefined)
    if (edges.length === 0) continue
    out.push({
      part,
      edges,
      name: (x) => (e.sim.kind === 'device' && e.sim.model === 'led' ? part.comp.id : x.label),
      ifMax: e.ratings?.ifMax ?? NaN,
    })
  }
  return out
}

interface Verdict {
  level: ErcLevel
  edge: Edge
  up: Reach
  down: Reach
  /** worst-case current through the limiting resistance (A), NaN when unlimited */
  current: number
  vDrive: number
  sumVf: number
}

const RANK: Record<ErcLevel, number> = { error: 3, risk: 2, info: 1 }

function judge(edge: Edge, up: Reach, down: Reach, ifMax: number): Verdict | null {
  const sumVf =
    (edge.vf ?? 2) +
    up.flags.junctions.reduce((s, j) => s + (j.vf ?? 0.7), 0) +
    down.flags.junctions.reduce((s, j) => s + (j.vf ?? 0.7), 0)
  const vUp = up.end.v
  const vDown = down.end.kind === 'rail' ? down.end.v : 0
  const dv = vUp - vDown
  // a known reverse or zero bias drives no current through this path
  if (Number.isFinite(dv) && dv <= 0) return null
  const r = up.r + down.r
  const cond = conditionalCount(up.flags) + conditionalCount(down.flags)
  if (r === 0) {
    const direct = up.end.kind === 'rail' && down.end.kind === 'rail' && cond === 0 && Number.isFinite(dv) && dv > sumVf
    return { level: direct ? 'error' : 'risk', edge, up, down, current: NaN, vDrive: dv, sumVf }
  }
  if (!Number.isFinite(dv) || !Number.isFinite(ifMax)) return null
  const i = (dv - sumVf) / (r + driverR(up) + driverR(down))
  if (i <= ifMax * 1.0001) return null
  return { level: 'risk', edge, up, down, current: i, vDrive: dv, sumVf }
}

/**
 * Output resistance of a driving / sinking endpoint as the simulator models
 * it: MCU pins (STM32F1_GPIO.routStrong), behavioral logic outputs and the
 * function generator are 50 Ω sources; rails are stiff.
 */
function driverR(r: Reach): number {
  return r.end.kind === 'gpio' ? STM32F1_GPIO.routStrong : r.end.kind === 'out' || r.end.kind === 'sig' ? 50 : 0
}

function better(a: Verdict | null, b: Verdict | null): Verdict | null {
  if (!a) return b
  if (!b) return a
  if (RANK[b.level] !== RANK[a.level]) return RANK[b.level] > RANK[a.level] ? b : a
  // prefer unlimited over too-small, then the larger current
  const ua = Number.isNaN(a.current)
  const ub = Number.isNaN(b.current)
  if (ua !== ub) return ub ? b : a
  return (b.current || 0) > (a.current || 0) ? b : a
}

function suggestion(v: Verdict): string {
  if (!Number.isFinite(v.vDrive)) return 'Add a series resistor (typically 220 Ω–1 kΩ).'
  const need = (v.vDrive - v.sumVf) / DESIGN_CURRENT
  if (!(need > 0)) return 'Add a series resistor (typically 220 Ω–1 kΩ).'
  const r = e12AtLeast(need)
  return `Add a series resistor of about ${fmtOhm(r)} (≈ (${fmtV(v.vDrive)} − ${fmtV(v.sumVf)}) / ${fmtA(DESIGN_CURRENT)}).`
}

function conditionText(v: Verdict): string {
  const sw = [...v.up.flags.switches, ...v.down.flags.switches]
  const tr = [...v.up.flags.transistors, ...v.down.flags.transistors]
  const pots = [...v.up.flags.variables, ...v.down.flags.variables]
  const bits: string[] = []
  if (sw.length > 0) bits.push(`when ${listText(sw.map((e) => e.label))} ${sw.length > 1 ? 'are' : 'is'} closed`)
  if (tr.length > 0) bits.push(`when ${listText(tr.map((e) => e.label))} conduct${tr.length > 1 ? '' : 's'}`)
  if (pots.length > 0) {
    const ids = [...new Set(pots.map((e) => e.compId))]
    bits.push(`with ${listText(ids)} turned to its end (≈ 0.5 Ω)`)
  }
  return bits.join(' and ')
}

export function checkLeds(c: Circuit, out: ErcFinding[]): void {
  for (const subj of ledSubjects(c)) {
    const id = subj.part.comp.id
    const tele = teleOf(c, id)
    const burned = tele?.burned === true
    let worst: Verdict | null = null
    const shorted: Edge[] = []
    let reverse: { edge: Edge; hi: Reach; lo: Reach } | null = null

    for (const edge of subj.edges) {
      if (edge.a === edge.b) {
        shorted.push(edge)
        continue
      }
      const ups = reach(c, edge.a, 'up', { skip: edge, block: edge.b, throughResistors: true })
      const downs = reach(c, edge.b, 'down', { skip: edge, block: edge.a, throughResistors: true })
      let local: Verdict | null = null
      for (const u of ups) for (const d of downs) local = better(local, judge(edge, u, d, subj.ifMax))
      worst = better(worst, local)
      if (!local && !reverse) {
        // reversed? (cathode side driven — by a rail, or by a GPIO / logic
        // output that can go high — and the anode side returned to a rail)
        const hi = reach(c, edge.b, 'up', { skip: edge, block: edge.a, throughResistors: true }).filter(
          (r) => r.end.kind === 'rail' || r.end.kind === 'gpio' || r.end.kind === 'out',
        )
        const lo = reach(c, edge.a, 'down', { skip: edge, block: edge.b, throughResistors: true }).filter((r) => r.end.kind === 'rail')
        // a rail on the cathode side is the stronger case: prefer it
        hi.sort((x, y) => (x.end.kind === 'rail' ? 0 : 1) - (y.end.kind === 'rail' ? 0 : 1))
        for (const h of hi) {
          for (const l of lo) {
            if (!reverse && h.end.v - l.end.v > (edge.vf ?? 2)) reverse = { edge, hi: h, lo: l }
          }
        }
      }
    }

    // the brightness on the app's one scale (telemetry `light` = I / the rated
    // 20 mA, src/instruments/led-light.ts) in the inspector's own form, so the
    // raw finding rows (ERC panel, a lesson's 最可能的原因) read the percent the
    // inspector prints; below 10 % the inspector prints one decimal, which the
    // sentence's zh-TW template (whole percent) cannot carry — then the
    // current alone is quoted
    const lightPct = tele && typeof tele.light === 'number' && !burned ? fmtLight(tele.light) : ''
    const brightness = /^\d+ %$/.test(lightPct) ? ` (brightness ${lightPct})` : ''
    const measured =
      tele && typeof tele.current === 'number' && Number.isFinite(tele.current) && subj.part.entry.sim.kind === 'device' && subj.part.entry.sim.model === 'led'
        ? ` The simulation measures ${fmtCurrent(Math.abs(tele.current), { plain: true })} through it right now${brightness}.`
        : ''
    // the LED model's burn-out in the words every burn sentence uses (here,
    // rules-live; zh-TW messages-erc.ts LED_BURN_RULE_ZH): the junction-
    // temperature model of src/sim/devices.ts — LED_TJ_BURN_C 150 °C, reached
    // only far above the rating for seconds (31 mA from 100 Ω on 5 V never
    // burns it) — or the gross overload LED_PEAK_CURRENT 150 mA held for
    // LED_PEAK_TIME 1 ms (an LED straight across a supply). Literal text, so
    // tests/i18n/messages-static.test.ts sees the whole sentence.
    const burnText = burned
      ? ' The simulation’s LED model has already burned it out (its junction passed about 150 °C, far over its rating for seconds, or more than 150 mA flowed for over 1 ms).'
      : ''

    if (shorted.length > 0) {
      const names = shorted.map((e) => subj.name(e))
      out.push(
        makeFinding({
          rule: 'led-current',
          level: 'error',
          key: `${id}:shorted`,
          message:
            `${listText(names)} ${names.length > 1 ? 'have' : 'has'} both leads on the same net (${shorted[0].a}), so ${names.length > 1 ? 'they' : 'it'} can never light: ` +
            `a breadboard strip connects its two leads together. Move one lead to a different strip.`,
          short: `${listText(names)}: both leads in one strip`,
          componentIds: [id],
          nets: shorted.map((e) => e.a),
          holes: shorted.flatMap((e) => [e.refA, e.refB]),
        }),
      )
    }

    if (worst) {
      const v = worst
      const name = subj.name(v.edge)
      const gpioDriven = v.up.end.kind === 'gpio' || v.down.end.kind === 'gpio'
      const level: ErcLevel = burned ? 'error' : v.level
      const holes = [v.edge.refA, v.edge.refB]
      const comps = [
        id,
        v.up.end.part?.comp.id,
        v.down.end.part?.comp.id,
        ...[v.up, v.down].flatMap((r) => [...r.flags.switches, ...r.flags.transistors, ...r.flags.variables, ...r.flags.resistors].map((e) => e.compId)),
      ]
      let message: string
      let ref: string | undefined
      if (Number.isNaN(v.current)) {
        const cond = conditionText(v)
        const across = `${v.up.end.what} and ${v.down.end.what}`
        if (v.level === 'error') {
          message =
            `${name} sits directly across ${across} with nothing to limit its current: once an LED conducts it has almost no resistance, so the current is limited only by the supply and it burns out. ` +
            suggestion(v)
        } else if (v.up.end.kind === 'gpio' || v.down.end.kind === 'gpio') {
          const pin = v.up.end.kind === 'gpio' ? v.up.end.what : v.down.end.what
          const est = Number.isFinite(v.vDrive) ? (v.vDrive - v.sumVf) / STM32F1_GPIO.routStrong : NaN
          message =
            `${name} is driven by ${pin} with no current-limiting resistor${cond ? ` (${cond})` : ''}: only the pin’s output driver limits the current` +
            `${est > 0 ? ` (≈ ${fmtA(est)})` : ''}, ` +
            `which can exceed the LED’s rating and the GPIO’s 25 mA limit. ` +
            suggestion(v)
          ref = `DS5319 Table 7 (25 mA per pin); the estimate uses the simulator’s ${STM32F1_GPIO.routStrong} Ω pin model`
        } else if (v.up.end.kind === 'out' || v.down.end.kind === 'out') {
          const pin = v.up.end.kind === 'out' ? v.up.end.what : v.down.end.what
          message =
            `${name} hangs on logic output ${pin} with no current-limiting resistor${cond ? ` (${cond})` : ''}: real logic outputs are not current sources and the LED would be over-driven. ` +
            suggestion(v)
        } else if (v.up.end.kind === 'sig') {
          message =
            `${name} is driven by ${v.up.end.what} (peaks at ${fmtV(v.up.end.v)}) with no series resistor${cond ? ` (${cond})` : ''}: only the generator’s 50 Ω output limits the current. ` +
            suggestion(v)
        } else {
          message =
            `${name} is connected across ${across} with no current-limiting resistor${cond ? ` ${cond}` : ''}: the LED current would only be limited by the supply. ` +
            suggestion(v)
        }
      } else {
        const rs = [...v.up.flags.resistors, ...v.down.flags.resistors]
        const rText = listText(rs.map((e) => `${e.label} (${fmtOhm(e.r ?? 0)})`))
        const rd = driverR(v.up) + driverR(v.down)
        const need = e12AtLeast((v.vDrive - v.sumVf) / subj.ifMax - rd)
        message =
          `${rText} ${rs.length > 1 ? 'let' : 'lets'} up to ≈ ${fmtA(v.current)} flow through ${name} from ${v.up.end.what}` +
          `${rd > 0 ? ` (with the driver’s ≈ ${rd} Ω output resistance)` : ''} — above its ${fmtA(subj.ifMax)} rated continuous current. ` +
          `Use at least ${fmtOhm(need)} in series.`
      }
      // the GPIO's own over-current finding (rules-live) has the same cause: one group
      const gpioEnd = v.up.end.kind === 'gpio' ? v.up.end : v.down.end.kind === 'gpio' ? v.down.end : null
      out.push(
        makeFinding({
          rule: 'led-current',
          level,
          key: id,
          // a GPIO-driven LED toggles: one instant's current would contradict the pin's measured peak
          message: message + (gpioDriven ? '' : measured) + burnText,
          short: burned ? `${id} burned out` : Number.isNaN(v.current) ? `${name} has no series resistor` : `${name} series resistor too small`,
          ref,
          group: !burned && gpioEnd?.part && gpioEnd.pin ? `gpio-current:${gpioEnd.part.comp.id}:${gpioEnd.pin}` : undefined,
          fact: burned ? `burned:${id}` : undefined,
          componentIds: comps,
          nets: [v.edge.a, v.edge.b, v.up.end.net, v.down.end.net],
          holes,
        }),
      )
    } else if (burned) {
      // limited by the static analysis, yet the model burned it: report what the model saw
      out.push(
        makeFinding({
          rule: 'led-current',
          level: 'error',
          key: id,
          message: `${id} burned out in the simulation (its junction passed about 150 °C, far over its rating for seconds, or more than 150 mA flowed for over 1 ms) — its series resistance is too small for the voltage driving it. Use a larger series resistor.${measured}`,
          short: `${id} burned out`,
          fact: `burned:${id}`,
          componentIds: [id],
          nets: subj.edges.flatMap((e) => [e.a, e.b]),
          holes: subj.edges.flatMap((e) => [e.refA, e.refB]),
        }),
      )
    } else if (shorted.length === 0) {
      const live = liveReversal(c, subj)
      if (live) {
        // measured: the cathode sits well above the anode and nothing flows
        out.push(
          makeFinding({
            rule: 'led-current',
            level: 'error',
            key: `${id}:reversed`,
            message:
              `${id} may be reversed: the long lead (anode) is in ${live.refA} and the short lead (cathode) in ${live.refK}; ` +
              `the cathode is ${fmtVoltage(live.dv)} above the anode, so it cannot light. Swap its two leads.`,
            short: `${id} may be reversed`,
            fact: `reversed:${id}`,
            componentIds: [id],
            nets: [live.edge.a, live.edge.b],
            holes: [live.refA, live.refK],
          }),
        )
      } else if (reverse) {
        const name = subj.name(reverse.edge)
        const byPin = reverse.hi.end.kind !== 'rail'
        out.push(
          makeFinding({
            rule: 'led-current',
            // two rails: it can never light (risk); a pin: only when the firmware drives it high (info until seen)
            level: byPin ? 'info' : 'risk',
            key: `${id}:reversed`,
            message: byPin
              ? `${name} faces ${reverse.hi.end.what} the wrong way round: its cathode (−, the short lead / flat side) goes toward ${reverse.hi.end.what} and its anode toward ${reverse.lo.end.what}, ` +
                `so it stays dark whenever ${reverse.hi.end.what} drives high. Swap its two leads.`
              : `${name} is wired in reverse: its cathode (−, the short lead / flat side) goes toward ${reverse.hi.end.what} and its anode toward ${reverse.lo.end.what}, ` +
                `so it can never light. Swap its two leads.`,
            short: `${name} is reversed`,
            fact: `reversed:${id}`,
            componentIds: [id],
            nets: [reverse.edge.a, reverse.edge.b],
            holes: [reverse.edge.refA, reverse.edge.refB],
          }),
        )
      }
    }
  }
}

/** A reverse bias above this (V) with no current means the LED faces the supply the wrong way. */
const REVERSE_BIAS_V = 1.0
/** "No current" for the reversal check (A). */
const NO_CURRENT_A = 1e-6

/**
 * The running simulation shows `subj` (a single LED) reverse-biased: its
 * cathode more than 1 V above its anode while (practically) no current
 * flows, with a supply in the circuit. Only measured values — never a guess.
 */
function liveReversal(c: Circuit, subj: LedSubject): { edge: Edge; refA: string; refK: string; dv: number } | null {
  const e = subj.part.entry
  if (e.sim.kind !== 'device' || e.sim.model !== 'led' || c.sources.length === 0) return null
  const tele = teleOf(c, subj.part.comp.id)
  const va = tele?.pinVoltages?.anode
  const vk = tele?.pinVoltages?.cathode
  const i = tele?.current
  if (typeof va !== 'number' || typeof vk !== 'number' || typeof i !== 'number') return null
  if (!Number.isFinite(va) || !Number.isFinite(vk) || !Number.isFinite(i) || tele?.burned === true) return null
  const dv = vk - va
  if (!(dv > REVERSE_BIAS_V) || !(Math.abs(i) < NO_CURRENT_A)) return null
  const edge = subj.edges[0]
  if (!edge?.refA || !edge.refB) return null
  return { edge, refA: edge.refA, refK: edge.refB, dv }
}

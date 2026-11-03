/**
 * Unconnected leads (UX wave IN-4): the beginner's most common wiring
 * mistake — an LED whose cathode sits in a strip nobody else uses ("I forgot
 * the ground wire") — leaves the circuit open, and nothing else in the ERC
 * notices (no short, no over-current, the simulation just shows 0 mA).
 *
 * Applies to every two-lead part placed with leads (resistor, LED, diode,
 * Zener, capacitor, inductor, buzzer, LDR, thermistor). A lead is OPEN when
 * its net carries no other part's pin — no other component, no board
 * header, no off-board terminal (a source's rail wire reaches the rail
 * through its own terminal pin) — measuring probes do not count, and a
 * wire that leads nowhere does not either.
 *
 *  - exactly one lead open → 'risk' while the simulation runs (telemetry
 *    given), 'info' before (the learner may still be wiring it);
 *  - both leads open → 'info' "not wired yet", only when the circuit has an
 *    MCU board or a source (a lone part on an empty board is not a mistake).
 *
 * Multi-pin parts are not judged here: unused MCU pins, NC pins and spare
 * IC inputs are legitimately unconnected (other rules cover inputs).
 *
 * A lead whose net reaches only a power rail that no supply feeds (the
 * cathode wired to the top − rail, but only the bottom rails are powered —
 * IN-17) is open too: the message names the floating rail and how to feed
 * it, and the whole rail is marked.
 *
 * rail-unpowered (info): a power rail that carries parts or wires while no
 * supply feeds it (the circuit has a source elsewhere).
 */
import type { ErcFinding } from './api'
import type { Circuit, PartNode } from './graph'
import { pinsOn, railOf, refOfPin } from './graph'
import { listText, makeFinding } from './finding'
import { formatHole, holePosition, parseHole } from '../../model/breadboard'
import { BOARD_SIZES, RAILS, type RailId } from '../../model/types'

/** "cathode" / "anode" / "cathode (banded end)" / "lead 2" — English words the messages tables translate. */
function leadWord(part: PartNode, pin: string): string {
  const model = part.entry.sim.kind === 'device' ? part.entry.sim.model : ''
  if (pin === 'anode') return 'anode'
  if (pin === 'cathode') return model === 'diode' || model === 'zener' ? 'cathode (banded end)' : 'cathode'
  const m = /^p(\d+)$/.exec(pin)
  if (m) return `lead ${m[1]}`
  return pin
}

/** "column 38 (the a–e strip)" for a strip hole, "the top − rail" for a rail hole, else the ref. */
function whereWord(ref: string): string {
  const h = parseHole(ref)
  if (!h) return ref
  if (h.kind === 'strip') return `column ${h.col} (the ${h.row <= 'e' ? 'a–e' : 'f–j'} strip)`
  const side = h.rail.startsWith('top') ? 'top' : 'bottom'
  const pol = h.rail.endsWith('+') ? '+' : '−'
  return `the ${side} ${pol} rail`
}

/** One power rail of one board row, as a net. */
interface RailNet {
  rail: RailId
  boardRow: number
  net: string
}

/** Every power rail that is a net of the circuit (the four rails of each board row in use). */
function railNets(c: Circuit): RailNet[] {
  const out: RailNet[] = []
  for (let boardRow = 0; boardRow < (c.board.rows ?? 1); boardRow++) {
    for (const rail of RAILS) {
      const ref = formatHole(boardRow === 0 ? { kind: 'rail', rail, index: 0 } : { kind: 'rail', rail, index: 0, boardRow })
      const net = c.netlist.netOf(ref)
      if (net) out.push({ rail, boardRow, net })
    }
  }
  return out
}

/** "the top − rail" (English source; the messages tables translate it). */
function railWords(r: { rail: RailId }): string {
  return `the ${r.rail.startsWith('top') ? 'top' : 'bottom'} ${r.rail.endsWith('+') ? '+' : '−'} rail`
}

/** Every hole of one rail (the whole rail is marked on the board). */
function railHoleRefs(c: Circuit, r: RailNet): string[] {
  const n = BOARD_SIZES[c.board.size].railHoles * c.board.count
  const out: string[] = []
  for (let index = 0; index < n; index++) {
    out.push(formatHole(r.boardRow === 0 ? { kind: 'rail', rail: r.rail, index } : { kind: 'rail', rail: r.rail, index, boardRow: r.boardRow }))
  }
  return out
}

/**
 * How to feed a floating rail: another rail of the same polarity that IS fed
 * ("the bottom − rail"), and a source terminal of that polarity ("PS1:-").
 */
function railFix(c: Circuit, r: RailNet, all: readonly RailNet[]): { text: string; source: string | null } {
  const minus = r.rail.endsWith('-')
  const fed = all.find((o) => {
    if (o.net === r.net || o.rail.endsWith('-') !== minus) return false
    const v = railOf(c, o.net)?.v
    return v !== undefined && (minus ? Math.abs(v) < 0.05 : v > 0.05)
  })
  const src = c.sources.find((x) => (minus ? x.minus : x.plus) && x.plus !== x.minus)
  const source = src ? `${src.part.comp.id}:${minus ? '-' : '+'}` : null
  const self = railWords(r)
  if (fed && source) return { text: `Wire ${self} to ${railWords(fed)}, or straight to ${source}.`, source }
  if (fed) return { text: `Wire ${self} to ${railWords(fed)}.`, source }
  if (source) return { text: `Wire ${self} straight to ${source}.`, source }
  return { text: `Wire ${self} to a supply’s ${minus ? '−' : '+'} terminal.`, source }
}

/** Is `r` a rail a supply feeds at its polarity (− rails at ≈ 0 V, + rails above it)? */
function railFed(c: Circuit, r: RailNet): boolean {
  const v = railOf(c, r.net)?.v
  return v !== undefined && (r.rail.endsWith('-') ? Math.abs(v) < 0.05 : v > 0.05)
}

/**
 * The hole of `candidates` (fed rails) nearest to `ref` on the board — where
 * the fix wire goes. 「在電路板上標示」 frames it beside the problem
 * (ErcFinding.fixHoles), so the learner sees both ends of the missing wire.
 */
function nearestRailHole(c: Circuit, ref: string, candidates: readonly RailNet[]): string | null {
  const h = parseHole(ref)
  if (!h || candidates.length === 0) return null
  const at = holePosition(h)
  const n = BOARD_SIZES[c.board.size].railHoles * c.board.count
  let best: string | null = null
  let bestD = Infinity
  for (const r of candidates) {
    for (let index = 0; index < n; index++) {
      const hole = r.boardRow === 0 ? { kind: 'rail' as const, rail: r.rail, index } : { kind: 'rail' as const, rail: r.rail, index, boardRow: r.boardRow }
      const p = holePosition(hole)
      const d = Math.abs(p.x - at.x) + Math.abs(p.z - at.z)
      if (d < bestD) {
        bestD = d
        best = formatHole(hole)
      }
    }
  }
  return best
}

/** Is anything besides `part` itself on its pin `i`'s net? */
function leadConnected(c: Circuit, part: PartNode, i: number): boolean {
  const net = part.nets[i]
  if (!net) return false
  return pinsOn(c, net, part).length > 0
}

/** Rails already named by an open-lead finding (rail-unpowered skips them): net ids. */
const reportedRails = new WeakMap<Circuit, Set<string>>()

export function checkOpenLeads(c: Circuit, out: ErcFinding[]): void {
  const live = c.telemetry !== null
  const mcu = c.parts.find((p) => p.entry.mcu)
  const hasDriver = c.sources.length > 0 || c.signals.length > 0 || mcu !== undefined
  const rails = railNets(c)
  const reported = new Set<string>()
  reportedRails.set(c, reported)
  for (const part of c.parts) {
    const e = part.entry
    if (e.sim.kind !== 'device' || e.placement !== 'leads' || e.pins.length !== 2) continue
    const [n0, n1] = part.nets
    const [r0, r1] = part.refs
    // unplaced / partly placed parts and leads shorted in one strip are other rules' business
    if (!n0 || !n1 || !r0 || !r1 || n0 === n1) continue
    const open = [!leadConnected(c, part, 0), !leadConnected(c, part, 1)]
    const id = part.comp.id
    if (open[0] && open[1]) {
      if (!hasDriver) continue
      out.push(
        makeFinding({
          rule: 'open-lead',
          level: 'info',
          key: `${id}:both`,
          message: `${id} (${e.label}) is not wired yet: neither of its leads (${r0}, ${r1}) connects to anything.`,
          short: `${id} not wired yet`,
          componentIds: [id],
          nets: [n0, n1],
          holes: [r0, r1],
        }),
      )
      continue
    }
    const i = open[0] ? 0 : open[1] ? 1 : -1
    if (i < 0) continue
    const pin = e.pins[i]
    const ref = part.refs[i]!
    const word = leadWord(part, pin)
    const where = whereWord(ref)
    const isLed = e.sim.kind === 'device' && e.sim.model === 'led'
    // the lead reaches a power rail — but no supply feeds that rail (a wire to the wrong rail)
    const floating = rails.find((r) => r.net === part.nets[i])
    if (floating) {
      reported.add(floating.net)
      const fix = railFix(c, floating, rails)
      // the fix wire's other end: the nearest hole of a fed rail of the same polarity
      const minus = floating.rail.endsWith('-')
      const fedSame = rails.filter((r) => r.net !== floating.net && r.rail.endsWith('-') === minus && railFed(c, r))
      const back = isLed && pin === 'cathode' ? 'so the current cannot get back' : isLed && pin === 'anode' ? 'so no current can flow into the LED' : `so no current flows through this ${e.label}`
      out.push(
        makeFinding({
          rule: 'open-lead',
          level: live ? 'risk' : 'info',
          key: `${id}:${pin}`,
          message: `${id}’s ${word} (${ref}) goes to ${railWords(floating)}, but no supply feeds that rail${fix.source ? ` (${fix.source})` : ''}, ${back}. ${fix.text}`,
          // the lead IS wired — to a rail nothing feeds (persona fix: the pill said 「陰極沒接」 beside the card's
          // 「陰極接的電源軌沒有電」; now 「LED1 陰極的電源軌沒接電」 — the card never repeats a title verbatim)
          short: `${id} ${word.replace(/ \(banded end\)$/, '')} on an unfed rail`,
          componentIds: [id],
          nets: [part.nets[i]],
          holes: [ref, ...railHoleRefs(c, floating)],
          fixHoles: [nearestRailHole(c, ref, fedSame)],
        }),
      )
      continue
    }
    let message: string
    // where the missing wire goes (framed with the lead): an LED cathode's nearest fed − rail hole, else the board's G pin
    let fixHole: string | null = null
    if (isLed && pin === 'cathode') {
      fixHole =
        nearestRailHole(c, ref, rails.filter((r) => r.rail.endsWith('-') && railFed(c, r))) ??
        (mcu?.entry.mcu ? refOfPin(mcu, mcu.entry.mcu.gndPin) : null)
      const gnd = mcu
        ? mcu.entry.type === 'stm32_bluepill'
          ? ` or the G pin of the Blue Pill (${mcu.comp.id})`
          : ` or a GND pin of ${mcu.comp.id}`
        : ''
      message =
        `${id}’s cathode (${ref}) is not connected to anything: the current has no path back to ground, so the LED cannot light. ` +
        `Wire ${where} to the − rail${gnd}.`
    } else if (isLed && pin === 'anode') {
      message =
        `${id}’s anode (${ref}) is not connected to anything: no current can flow into the LED, so it cannot light. ` +
        `Wire ${where} to the pin or resistor that should drive it.`
    } else {
      message =
        `${id}’s ${word} (${ref}) is not connected to anything: no current flows through this ${e.label}. ` +
        `Wire ${where} to the rest of the circuit.`
    }
    out.push(
      makeFinding({
        rule: 'open-lead',
        level: live ? 'risk' : 'info',
        key: `${id}:${pin}`,
        message,
        short: `${id} ${word.replace(/ \(banded end\)$/, '')} not connected`,
        componentIds: [id],
        nets: [part.nets[i]],
        holes: [ref],
        fixHoles: [fixHole],
      }),
    )
  }
}

/**
 * rail-unpowered (info): a power rail with parts or wires on it that no
 * supply feeds, in a circuit that has a source (without any source the
 * 'unpowered' error says so). Rails an open-lead finding already named are
 * skipped (one fact, one row).
 */
export function checkUnpoweredRails(c: Circuit, out: ErcFinding[]): void {
  if (c.sources.length === 0) return
  const rails = railNets(c)
  const reported = reportedRails.get(c) ?? new Set<string>()
  const seen = new Set<string>()
  for (const r of rails) {
    if (seen.has(r.net) || reported.has(r.net)) continue
    seen.add(r.net)
    if (railOf(c, r.net)) continue
    const parts = [...new Set(pinsOn(c, r.net).map((np) => np.part.comp.id))]
    const wires = c.wires.filter((w) => c.netlist.netOf(w.from) === r.net || c.netlist.netOf(w.to) === r.net).map((w) => w.id)
    if (parts.length === 0 && wires.length === 0) continue
    const what = listText([...parts, ...wires.map((w) => `wire ${w}`)].slice(0, 4))
    const fix = railFix(c, r, rails)
    out.push(
      makeFinding({
        rule: 'rail-unpowered',
        level: 'info',
        key: r.boardRow === 0 ? r.rail : `${r.boardRow}:${r.rail}`,
        message: `${railWords(r).replace(/^the/, 'The')} carries ${what}, but no supply feeds it, so nothing on it gets ${r.rail.endsWith('+') ? 'power' : 'a ground'}. ${fix.text}`,
        short: `${railWords(r).replace(/^the /, '')} has no supply`,
        componentIds: parts,
        nets: [r.net],
        holes: railHoleRefs(c, r),
        wireIds: wires,
      }),
    )
  }
}

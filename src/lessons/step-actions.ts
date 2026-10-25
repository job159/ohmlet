/**
 * One-click step actions (UX LS-1, LS-11) and the firmware a lesson can bind
 * — pure data derivations over a Lesson (no DOM, no stores): node tests
 * check them, src/ui/lessons renders and runs them.
 *
 *   stepActions(lesson, i)   the actions step i offers: its explicit
 *                            `action`, else derived from its check —
 *                              firmware-loaded + project → load-firmware
 *                              measure / uart-contains / firmware-checks → run
 *                              measure frequency / duty at a part's pin →
 *                                add-logic (that part's pins, merged)
 *                              has-part / connected-via of a part type the
 *                              solution ADDS to the start circuit → arm-part
 *                              connected (no part to add) → wire: the
 *                                solution's new wires at the step's holes
 *                              measure at a meter terminal (DMM1:IN) →
 *                                wire: the meter's test leads (meterWires)
 *                            (an 'all' check contributes its sub-checks;
 *                            derived wires merge into one 開始接線);
 *                            arm-part, wire, load-firmware, run, add-logic
 *                            (▶ first: it hides while the simulation runs);
 *                            'reset' and 'unwire' are explicit only
 *                            (resetTarget names the board of a 「重置 MCU」).
 *   pendingWire(a, layout)   the first wire of a 'wire' action the board
 *                            does not hold yet (null: all drawn)
 *   wiresOnBoard(a, layout)  the wires of an 'unwire' action on the board
 *   stepPendingWire(l, i, …) the same for step i's own wire action
 *   isJumperExperiment(l, i) step i wires what its check forbids (a3 PB13)
 *   paramFixes(…)            「把 R1 設為 330 Ω」: the value a failing
 *                            connected-via-param check wants
 *   lessonInstrument(l)      the tray tab a lesson's circuit opens on
 *   lessonMcu(lesson)        the MCU board the lesson's firmware goes to
 *   mainFirmware(lesson, id) the solution's firmware of board `id`
 *   mistakeFirmware(l, m)    the 'lesson-*' firmware a mistake reproduces
 *   lessonFirmwareRefs(l)    every firmware a step or mistake can load
 */
import { getEntry, paramOf } from '../model/catalog'
import { componentPinHoles, parseHole, parseTerminalRef } from '../model/breadboard'
import { boardConfigOf, type CircuitLayout, type ParamValue } from '../model/types'
import type { EvaluatedCheck } from './engine/evaluate'
import { fmtRange, isPercentRange } from './engine/format'
import type { Lesson, LessonCheck, LessonMistake, LessonStepAction, PinRef } from './types'

/** Stable identity of an action (React key, busy state). */
export function actionKey(a: LessonStepAction): string {
  switch (a.kind) {
    case 'load-firmware':
      return `fw|${a.component}|${a.project}`
    case 'run':
      return 'run'
    case 'arm-part':
      return `arm|${a.type}`
    case 'wire':
      return `wire|${a.wires.map((w) => w.join('>')).join(',')}`
    case 'add-logic': {
      const v = a.view
      return `logic|${a.component}|${a.pins.join(',')}${v ? `|${v.span}|${v.burstOn ?? ''}|${v.minBurst ?? ''}` : ''}`
    }
    case 'reset':
      return a.scope === 'mcu' ? `reset|mcu|${a.component ?? ''}` : 'reset|circuit'
    case 'unwire':
      return `unwire|${a.wires.map((w) => w.join('>')).join(',')}`
  }
}

/**
 * The board a 「重置 MCU」 action resets: its own `component`, else the
 * lesson's MCU board (lessonMcu). null for 「重置模擬」 (the whole circuit)
 * or a lesson without a board.
 */
export function resetTarget(lesson: Lesson, a: Extract<LessonStepAction, { kind: 'reset' }>): string | null {
  if (a.scope !== 'mcu') return null
  return a.component ?? lessonMcu(lesson) ?? null
}

/** Number of parts of `type` in a layout. */
export function countParts(layout: CircuitLayout, type: string): number {
  return (Array.isArray(layout.components) ? layout.components : []).filter((c) => c && c.type === type).length
}

/** The solution places more parts of `type` than the start circuit holds. */
export function solutionAdds(lesson: Lesson, type: string): boolean {
  return countParts(lesson.solution.layout, type) > countParts(lesson.start.layout, type)
}

/** A part of the lessons' circuits (start or solution) by id. */
function lessonPart(lesson: Lesson, id: string) {
  return lesson.solution.layout.components.find((c) => c.id === id) ?? lesson.start.layout.components.find((c) => c.id === id)
}

/** marker of a derived 'connected' that needs a wire (resolved against the step's holes afterwards) */
const NEEDS_WIRE: LessonStepAction = { kind: 'wire', wires: [] }

/** A bench meter (off-board, IN and COM terminals): what a voltage reading at its terminal needs wired. */
export function isMeterType(type: string | undefined): boolean {
  const e = type ? getEntry(type) : undefined
  return !!e && e.placement === 'offboard' && e.pins.includes('IN') && e.pins.includes('COM')
}

/**
 * The wires a reading at a meter terminal (`DMM1:IN`) needs (release QA
 * LS-F9): the solution's wires on that meter's terminals that the start
 * circuit does not have, the measured terminal's first, each written from
 * the terminal (「DMM1 IN 端 → e12」). [] for any other `at`.
 */
export function meterWires(lesson: Lesson, at: PinRef): [string, string][] {
  if (!('terminal' in at)) return []
  const term = parseTerminalRef(at.terminal)
  if (!term || !isMeterType(lessonPart(lesson, term.componentId)?.type)) return []
  const prefix = `${term.componentId}:`
  const start = lesson.start.layout.wires
  const out: [string, string][] = []
  for (const w of lesson.solution.layout.wires) {
    if (start.some((s) => sameWire(s, w.from, w.to))) continue
    if (w.from.startsWith(prefix)) out.push([w.from, w.to])
    else if (w.to.startsWith(prefix)) out.push([w.to, w.from])
  }
  // the terminal the step reads first
  return out.sort((a, b) => Number(b[0] === at.terminal) - Number(a[0] === at.terminal))
}

function derive(lesson: Lesson, c: LessonCheck, out: LessonStepAction[]): void {
  switch (c.kind) {
    case 'firmware-loaded':
      if (c.project) out.push({ kind: 'load-firmware', component: c.component, project: c.project })
      return
    case 'measure': {
      // a frequency / duty is read on the logic analyzer: put the pin there (a part's pin, never an
      // analog terminal of a function generator — that lesson reads the oscilloscope)
      if ((c.quantity === 'frequency' || c.quantity === 'duty') && 'component' in c.at && lessonPart(lesson, c.at.component)) {
        out.push({ kind: 'add-logic', component: c.at.component, pins: [c.at.pin] })
      }
      // a reading at a meter terminal: its test leads first (「開始接線（DMM1 IN 端 → e12）」)
      const wires = meterWires(lesson, c.at)
      if (wires.length > 0) out.push({ kind: 'wire', wires })
      out.push({ kind: 'run' })
      return
    }
    case 'uart-contains':
    case 'firmware-checks':
      out.push({ kind: 'run' })
      return
    case 'has-part':
      if (solutionAdds(lesson, c.type)) out.push({ kind: 'arm-part', type: c.type })
      return
    case 'connected':
      if (c.via && solutionAdds(lesson, c.via.type)) out.push({ kind: 'arm-part', type: c.via.type })
      else out.push(NEEDS_WIRE)
      return
    case 'all':
      for (const x of c.checks) derive(lesson, x, out)
      return
    default:
      return
  }
}

/** "a16" / "PS1:+" — one endpoint of a wire, compared as written. */
function sameWire(w: { from: string; to: string }, a: string, b: string): boolean {
  return (w.from === a && w.to === b) || (w.from === b && w.to === a)
}

/**
 * The wires step `index` asks for: wires of the solution that the start
 * circuit does not have and that end in one of the step's highlighted
 * holes, oriented and ordered by those holes (「a16 → top-13」).
 */
export function stepWires(lesson: Lesson, index: number): [string, string][] {
  const holes = lesson.steps[index]?.highlight?.holes ?? []
  if (holes.length === 0) return []
  const start = lesson.start.layout.wires
  const added = lesson.solution.layout.wires.filter((w) => !start.some((s) => sameWire(s, w.from, w.to)))
  const at = (ref: string) => holes.indexOf(ref)
  return added
    .filter((w) => at(w.from) >= 0 || at(w.to) >= 0)
    .map((w): [string, string] => {
      const f = at(w.from)
      const t = at(w.to)
      // the end the step names first is where the learner starts (a terminal end comes first: it has no hole)
      return f < 0 ? [w.from, w.to] : t < 0 ? [w.from, w.to] : f <= t ? [w.from, w.to] : [w.to, w.from]
    })
    .sort((a, b) => firstAt(holes, a) - firstAt(holes, b))
}

function firstAt(holes: readonly string[], w: [string, string]): number {
  const i = [holes.indexOf(w[0]), holes.indexOf(w[1])].filter((x) => x >= 0)
  return i.length > 0 ? Math.min(...i) : Infinity
}

/** The first wire of a 'wire' action the board does not hold yet (either direction), null when all are drawn. */
export function pendingWire(a: Extract<LessonStepAction, { kind: 'wire' }>, layout: CircuitLayout): [string, string] | null {
  const wires = Array.isArray(layout.wires) ? layout.wires : []
  return a.wires.find(([f, t]) => !wires.some((w) => w && sameWire(w, f, t))) ?? null
}

/**
 * A jumper experiment (final round): the step's 「開始接線」 draws what its
 * own check forbids — a3 「U1 PB13 沒有接地」 after 「從 j11 接到 bot-7」. Its
 * check fails while the jumper is in BY DESIGN (it asks for the jumper to
 * go again afterwards), so an automatic re-check then is not a failed attempt.
 */
export function isJumperExperiment(lesson: Lesson, index: number): boolean {
  const c = lesson.steps[index]?.check
  if (!c) return false
  const forbids = c.kind === 'not-connected' || (c.kind === 'all' && c.checks.length > 0 && c.checks.every((x) => x.kind === 'not-connected'))
  return forbids && stepActions(lesson, index).some((a) => a.kind === 'wire')
}

/** The next wire step `index` still asks for (its 'wire' action), null when it asks for none or all are drawn. */
export function stepPendingWire(lesson: Lesson, index: number, layout: CircuitLayout): [string, string] | null {
  const a = stepActions(lesson, index).find((x): x is Extract<LessonStepAction, { kind: 'wire' }> => x.kind === 'wire')
  return a ? pendingWire(a, layout) : null
}

const ORDER: Record<LessonStepAction['kind'], number> = {
  'arm-part': 0,
  wire: 1,
  reset: 1.5,
  unwire: 1.6,
  'load-firmware': 2,
  run: 3,
  'add-logic': 4,
}

/** The wires of a 'unwire' action that are on the board now, as drawn (either direction counts). */
export function wiresOnBoard(a: Extract<LessonStepAction, { kind: 'unwire' }>, layout: CircuitLayout): { id: string; from: string; to: string }[] {
  const wires = Array.isArray(layout.wires) ? layout.wires : []
  return wires.filter((w) => !!w && a.wires.some(([f, t]) => sameWire(w, f, t)))
}

/** The one-click actions of step `index` (deduplicated, in display order). */
export function stepActions(lesson: Lesson, index: number): LessonStepAction[] {
  const step = lesson.steps[index]
  if (!step) return []
  const derived = step.action === undefined
  const raw: LessonStepAction[] = []
  if (!derived) raw.push(...(Array.isArray(step.action) ? step.action : [step.action!]))
  else if (step.check) derive(lesson, step.check, raw)
  const seen = new Set<string>()
  const out: LessonStepAction[] = []
  // derived wires join ONE 「開始接線」 per step (a step's holes and a meter's test leads: the same walk)
  const pushWires = (wires: readonly [string, string][]) => {
    const same = out.find((x): x is Extract<LessonStepAction, { kind: 'wire' }> => x.kind === 'wire')
    if (!same) {
      out.push({ kind: 'wire', wires: wires.map((w): [string, string] => [w[0], w[1]]) })
      return
    }
    for (const w of wires) if (!same.wires.some(([f, t]) => (f === w[0] && t === w[1]) || (f === w[1] && t === w[0]))) same.wires = [...same.wires, [w[0], w[1]]]
  }
  for (const a of raw) {
    if (a === NEEDS_WIRE) {
      if (seen.has('wire')) continue
      seen.add('wire')
      const wires = stepWires(lesson, index)
      if (wires.length > 0) pushWires(wires)
      continue
    }
    if (derived && a.kind === 'wire') {
      pushWires(a.wires)
      continue
    }
    if (a.kind === 'add-logic') {
      // one button per part: 「把 PA5、PC13 加到邏輯分析儀」 (a view given for the part is kept)
      const same = out.find((x): x is Extract<LessonStepAction, { kind: 'add-logic' }> => x.kind === 'add-logic' && x.component === a.component)
      if (same) {
        for (const p of a.pins) if (!same.pins.includes(p)) same.pins = [...same.pins, p]
        if (a.view && !same.view) same.view = { ...a.view }
        continue
      }
      out.push(a.view ? { ...a, pins: [...a.pins], view: { ...a.view } } : { ...a, pins: [...a.pins] })
      continue
    }
    const k = actionKey(a)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(a)
  }
  // explicit lists keep their author's order; derived ones read arm → wire → load → run → add channels
  return step.action !== undefined ? out : out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
}

// ------------------------------------------------- one-click value fix (LS-11)

/** E12 preferred values (one decade). */
const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]

/** The E12 value nearest `x` within [min, max] (x itself when no E12 value fits). */
export function nearestE12(x: number, min: number, max: number): number {
  let best: number | null = null
  for (let d = -3; d <= 9; d++) {
    for (const m of E12) {
      const v = Number((m * 10 ** d).toPrecision(3))
      if (v < min || v > max) continue
      if (best === null || Math.abs(v - x) < Math.abs(best - x)) best = v
    }
  }
  return best ?? x
}

/** A number from a param value: 330, "330", "4.7k", "10 kΩ". */
export function numericParam(v: ParamValue | undefined): number {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return NaN
  const m = /^\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([pnuµmkKMG]?)/.exec(v)
  if (!m) return NaN
  const mult: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 }
  return parseFloat(m[1]) * (m[2] ? mult[m[2]] : 1)
}

export interface ParamFix {
  /** the part to change ('R1') */
  component: string
  /** its param key ('resistance') */
  param: string
  /** the value it gets */
  value: number
  /** the param's unit ('Ω'), '' when it has none */
  unit: string
}

/**
 * 「把 R1 設為 330 Ω」: for every FAILING connected-via-param check (an 'all'
 * contributes its sub-checks) whose bridging part is on the board with a
 * value outside the range, the value to set — the reference solution's own
 * value for that part when it is in range (the number the lesson teaches),
 * else the E12 value nearest the middle of the range. `result` is the
 * evaluated result of `check` (its focus names the bridging parts).
 */
export function paramFixes(lesson: Lesson, check: LessonCheck, result: EvaluatedCheck | undefined, layout: CircuitLayout): ParamFix[] {
  if (!result || result.pass) return []
  if (check.kind === 'all') return check.checks.flatMap((c, i) => paramFixes(lesson, c, result.children?.[i], layout))
  if (check.kind !== 'connected' || !check.via?.param) return []
  const via = check.via
  const param = via.param as string
  const entry = getEntry(via.type)
  if (!entry) return []
  const min = via.min ?? -Infinity
  const max = via.max ?? Infinity
  const inRange = (v: number) => Number.isFinite(v) && v >= min && v <= max
  const unit = entry.params?.find((p) => p.key === param)?.unit ?? ''
  for (const id of result.focus?.components ?? []) {
    const comp = layout.components.find((c) => c.id === id && c.type === via.type)
    if (!comp) continue
    const now = numericParam(paramOf(comp.params, entry, param))
    if (inRange(now)) continue
    const ref = lessonPart(lesson, id)
    const taught = ref && ref.type === via.type ? numericParam(paramOf(ref.params, entry, param)) : NaN
    const solution = lesson.solution.layout.components
      .filter((c) => c.type === via.type)
      .map((c) => numericParam(paramOf(c.params, entry, param)))
      .find(inRange)
    const middle = Number.isFinite(min) && Number.isFinite(max) ? (min + max) / 2 : Number.isFinite(min) ? min : max
    const value = inRange(taught) ? taught : solution !== undefined ? solution : nearestE12(middle, min, max)
    if (!Number.isFinite(value)) continue
    return [{ component: id, param, value, unit }]
  }
  return []
}

// ------------------------------------------------- observe steps (LS-12)

/** A catalog type that lights up for the learner to watch (LEDs). */
function isLed(type: string): boolean {
  const e = getEntry(type)
  return !!e && e.sim.kind === 'device' && e.sim.model === 'led'
}

/**
 * What an OBSERVE step frames (UX LS-12 b) — a step whose check reads an
 * LED's current or brightness or a blinking pin, or whose highlight holds
 * LEDs and that runs the simulation: the LEDs themselves and the parts in
 * series with them, NOT the whole board — framed together with a 40-pin
 * board the LEDs shrink to ~16 px at 1366 × 768 (measured), framed on their
 * own they stay ≥ 30 px with the wire to the board in view — unless the
 * step names a board to watch too (highlight.watch: i1 compares LED1 with
 * the Blue Pill's own PC13 LED, which must then be in the frame). null for
 * any other step.
 */
export function observeTargets(lesson: Lesson, index: number): { components: string[] } | null {
  const step = lesson.steps[index]
  if (!step) return null
  const typeOf = (id: string) => lessonPart(lesson, id)?.type ?? ''
  const leds = new Set<string>((step.highlight?.components ?? []).filter((id) => isLed(typeOf(id))))
  let reads = false
  const walk = (c: LessonCheck) => {
    if (c.kind === 'all') return c.checks.forEach(walk)
    if (c.kind !== 'measure') return
    if ((c.quantity === 'current' || c.quantity === 'led-brightness') && c.component && isLed(typeOf(c.component.split('/')[0]))) {
      reads = true
      leds.add(c.component.split('/')[0])
    }
    // a blinking MCU pin: the LEDs of the step are what the learner watches
    if (c.quantity === 'frequency' && 'component' in c.at && getEntry(typeOf(c.at.component))?.mcu) reads = true
  }
  if (step.check) walk(step.check)
  const runs = stepActions(lesson, index).some((a) => a.kind === 'run')
  if (leds.size === 0 || !(reads || runs)) return null
  // the parts between a blinking pin and its LED (the resistor in series) stay in the frame
  const between = (step.highlight?.components ?? []).filter((id) => !leds.has(id) && !getEntry(typeOf(id))?.mcu)
  // …and what the step says to watch besides them (a board's own LED: the whole board)
  const watch = (step.highlight?.watch ?? []).filter((id) => !leds.has(id) && !between.includes(id))
  return { components: [...leds, ...between, ...watch] }
}

// ------------------------------------------------ the pin a step points at

/**
 * The MCU pin a step points at (UX LS-14): a highlighted hole in the same
 * 5-hole strip as a pin of a highlighted MCU board — i1 step 1 highlights
 * U1 and `a20`, PA5's only free hole → { U1, PA5 }. null when none.
 */
export function stepPinTarget(lesson: Lesson, index: number, layout: CircuitLayout): { component: string; pin: string } | null {
  const step = lesson.steps[index]
  const holes = step?.highlight?.holes ?? []
  const ids = step?.highlight?.components ?? []
  if (holes.length === 0 || ids.length === 0) return null
  const half = (row: string) => (row <= 'e' ? 0 : 1)
  for (const id of ids) {
    const comp = layout.components.find((c) => c.id === id)
    const entry = comp ? getEntry(comp.type) : undefined
    if (!comp || !entry?.mcu) continue
    const pinHoles = componentPinHoles(comp, entry, boardConfigOf(layout))
    if (!pinHoles) continue
    for (const ref of holes) {
      const h = parseHole(ref)
      if (!h || h.kind !== 'strip') continue
      const i = pinHoles.findIndex(
        (p) => !!p && p.kind === 'strip' && p.col === h.col && (p.boardRow ?? 0) === (h.boardRow ?? 0) && half(p.row) === half(h.row),
      )
      if (i >= 0) return { component: id, pin: entry.pins[i] }
    }
  }
  return null
}

// ------------------------------------------- the step's expected reading (LS-15)

export interface StepExpectation {
  quantity: Extract<LessonCheck, { kind: 'measure' }>['quantity']
  /** in the quantity's own unit (a duty / brightness as a 0..1 fraction) */
  min: number
  max: number
  /** 「1.7 V – 1.9 V」 */
  range: string
}

/**
 * What step `index` expects `componentId` to read (UX LS-15): its measure
 * check (an 'all' contributes its sub-checks) at a terminal / pin of that
 * part, or about that part — 「DMM1 讀數約 1.8 V」 → { voltage, 1.7, 1.9 }.
 * null when the step measures nothing there.
 */
export function stepExpectation(lesson: Lesson, index: number, componentId: string): StepExpectation | null {
  const check = lesson.steps[index]?.check
  if (!check) return null
  let found: StepExpectation | null = null
  const walk = (c: LessonCheck) => {
    if (found) return
    if (c.kind === 'all') return c.checks.forEach(walk)
    if (c.kind !== 'measure') return
    const at = c.at
    const about =
      ('terminal' in at && at.terminal.split(':')[0] === componentId) ||
      ('component' in at && at.component === componentId && c.quantity !== 'current' && c.quantity !== 'led-brightness') ||
      ((c.quantity === 'current' || c.quantity === 'led-brightness') && c.component?.split('/')[0] === componentId)
    if (!about) return
    const percent = (c.quantity === 'duty' || c.quantity === 'led-brightness') && isPercentRange(c.min, c.max)
    found = {
      quantity: c.quantity,
      min: percent ? c.min / 100 : c.min,
      max: percent ? c.max / 100 : c.max,
      range: fmtRange(c.quantity, c.min, c.max),
    }
  }
  walk(check)
  return found
}

/** A reading inside the expectation (null: no usable value). */
export function meetsExpectation(e: StepExpectation, value: number | null | undefined): boolean | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value >= e.min && value <= e.max
}

// --------------------------------------------------------- instrument

/** Every check of a lesson's steps and acceptance (sub-checks included). */
function allChecks(lesson: Lesson): LessonCheck[] {
  const out: LessonCheck[] = []
  const walk = (c: LessonCheck) => {
    out.push(c)
    if (c.kind === 'all') c.checks.forEach(walk)
  }
  for (const s of lesson.steps) if (s.check) walk(s.check)
  lesson.acceptance.forEach(walk)
  return out
}

/** The tray tab a lesson's circuit opens on: requires.instrument, else the logic analyzer when a check reads a frequency or duty. */
export function lessonInstrument(lesson: Lesson): 'logic' | 'scope' | 'uart' | null {
  if (lesson.requires?.instrument) return lesson.requires.instrument
  return allChecks(lesson).some((c) => c.kind === 'measure' && (c.quantity === 'frequency' || c.quantity === 'duty')) ? 'logic' : null
}

// ----------------------------------------------------------- firmware

/** The MCU board a lesson binds firmware to: the solution's, else the first MCU board of its circuits. */
export function lessonMcu(lesson: Lesson): string | undefined {
  const bound = Object.keys(lesson.solution.firmware ?? {})[0] ?? Object.keys(lesson.start.firmware ?? {})[0]
  if (bound) return bound
  for (const layout of [lesson.solution.layout, lesson.start.layout]) {
    const mcu = layout.components.find((c) => !!getEntry(c.type)?.mcu)
    if (mcu) return mcu.id
  }
  return undefined
}

/** The firmware the reference solution runs on board `component`. */
export function mainFirmware(lesson: Lesson, component: string): string | undefined {
  return lesson.solution.firmware?.[component] ?? lesson.start.firmware?.[component]
}

/** The 'lesson-*' firmware (from requires.firmware) a mistake mentions — "reproduce this mistake". */
export function mistakeFirmware(lesson: Lesson, m: LessonMistake): string[] {
  const text = `${m.symptom}\n${m.cause}\n${m.fix}`
  return (lesson.requires?.firmware ?? []).filter((f) => f.startsWith('lesson-') && f !== mainFirmware(lesson, lessonMcu(lesson) ?? '') && text.includes(f))
}

/** Every firmware project a step action or a mistake button of the lesson can load. */
export function lessonFirmwareRefs(lesson: Lesson): { project: string; component: string; where: string }[] {
  const out: { project: string; component: string; where: string }[] = []
  lesson.steps.forEach((s, i) => {
    for (const a of stepActions(lesson, i)) {
      if (a.kind === 'load-firmware') out.push({ project: a.project, component: a.component, where: `steps.${s.id}` })
    }
  })
  const mcu = lessonMcu(lesson)
  lesson.mistakes.forEach((m, i) => {
    for (const f of mistakeFirmware(lesson, m)) out.push({ project: f, component: mcu ?? '', where: `mistakes[${i}]` })
  })
  return out
}

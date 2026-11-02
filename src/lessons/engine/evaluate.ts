/**
 * Lesson check evaluator: every LessonCheck kind (src/lessons/types.ts)
 * against the REAL simulation — nothing here imitates a result.
 *
 *  has-part / connected / not-connected
 *      the netlist (src/sim/netlist.ts buildNetlist) of the circuit; pins
 *      resolve through the catalog (refs.ts). `via` looks for ONE part of the
 *      given type with a pin on each of the two nets and its param in
 *      [min, max]; two nets that are already the same net fail (the part
 *      would be bypassed).
 *  firmware-loaded
 *      the firmware bound to the MCU board; with `project`, byte-identical
 *      (SHA-256) to firmware/dist/<project>.elf.
 *  measure
 *      a SimulationCoordinator (inline, deterministic virtual time) runs the
 *      circuit with its firmware. Non-`fresh` measurements share ONE session
 *      that starts at power-on and continues from check to check ("the
 *      current state"); `fresh` ones power up their own world. Quantities:
 *        voltage         time-weighted mean over the second half of the
 *                        window (what a DMM shows: PWM reads as its
 *                        average) — from the full-resolution scope ring of a
 *                        hidden ideal probe on the net when the net has a
 *                        hole, else from jittered samples of the solution;
 *        frequency/duty  edges of the logic recorder (exact for MCU pins and
 *                        MCU-driven / logic nets; thresholded analog
 *                        otherwise, then refined from the scope ring at the
 *                        waveform's own mid-level when the thresholds miss
 *                        it), whole periods only (signal.ts);
 *        current         |I| of the part's telemetry, mean of jittered
 *                        samples over the second half of the window;
 *        led-brightness  the LED's brightness on the app's one scale (F4):
 *                        telemetry `light` = I / its rated 20 mA (> 1 is
 *                        over-driven, 0 when burned), same sampling; the
 *                        result prints it with the LED current —
 *                        「量測值 49 %（9.70 mA）」.
 *      A voltage at a bench meter's terminal whose IN or COM lead has no
 *      connection fails without simulating: 「DMM1 IN 端還沒接線，量不到電壓」.
 *      duty / led-brightness ranges are fractions 0..1; a range whose max
 *      is above 1 is read as percent. `component` may name a board's
 *      sub-circuit element as "U1/LED_PC13".
 *  uart-contains
 *      the bytes a UART transmitted since power-on (time-stamped coordinator
 *      listener) contain `text` (byte-exact, CR ignored) within `seconds`.
 *  stimulus (measure / uart-contains, final round)
 *      learner actions the check performs itself: the session advances
 *      exactly TO each change's virtual time (every MCU in lockstep there)
 *      and applies it through SimulationCoordinator.setRuntimeParam — the
 *      inspector's runtime-param path. (Not the coordinator's scheduleAt
 *      event queue: a circuit without an MCU advances in whole analog steps
 *      and never runs that queue.) The changes a check did not reach are
 *      dropped when it ends. The result names them (EvaluatedCheck.stimulus),
 *      so a pass never hides what was done. A runtime param any of the
 *      evaluated checks drives starts every simulated world at its catalog
 *      default (the knob at 0, the button released): the checks control it,
 *      so whatever the learner left turned or ticked on the live board can
 *      neither break nor fake them.
 *  firmware-checks
 *      src/sim/coordinator/checks.ts runChecks on the project's contract
 *      (firmware/dist/manifest.json) — the firmware's own bench, independent
 *      of the learner's wiring.
 *  erc-clean
 *      src/sim/erc runErc with a live telemetry snapshot (a fresh session run
 *      for ERC_SETTLE_SECONDS) — what the ERC panel shows while running.
 *  all
 *      every sub-check passes.
 *
 * A check that fails because a part it names is not on the board carries
 * `missing` (its ids; a has-part check its type) — the UI offers the
 * starting circuit there instead of marking what is not there.
 *
 * Details are zh-TW through t() (English sources in this file, entries in
 * src/i18n/zh-TW/lessons-ui.ts). Pure of DOM: runs in node tests, in the
 * lesson-check worker, and inline on the main thread as a fallback (where it
 * yields to the event loop every few milliseconds).
 */
import type { CircuitLayout, ComponentInstance, ComponentTelemetry, SimTelemetry } from '../../model/types'
import { getEntry, paramOf } from '../../model/catalog'
import { parseTerminalRef } from '../../model/breadboard'
import { buildNetlist, type Netlist } from '../../sim/netlist'
import { SimulationCoordinator } from '../../sim/coordinator/coordinator'
import type { LogicChannelConfig, LogicSource } from '../../sim/coordinator/api'
import { runChecks, type ManifestEntry } from '../../sim/coordinator/checks'
import { ERC_LEVEL_ORDER, runErc, type ErcFinding } from '../../sim/erc'
import { loadFirmwareFile, sha256Hex } from '../../mcu/loader'
import type { FirmwareImage } from '../../mcu/firmware'
import { t } from '../../i18n'
import { fmtLedLight, fmtLight, isAveragedLed, ledFindingMessage, LED_LIGHT_RATED_A } from '../../instruments/led-light'
import { tMessage } from '../../i18n/messages'
import { terminalLabel } from '../../i18n/parts'
import type { CheckResult, Lesson, LessonCheck, LessonCircuit, LessonStimulus } from '../types'
import { defaultAssets, type EvalAssets, type FirmwareFile } from './assets'
import { checkLabel, fmtMeasured, fmtRange, fmtSi, isPercentRange, partName, stimulusText } from './format'
import { pinRefComponent, pinRefText, resolvePinRef, tidyCjkSpaces, type ResolvedRef } from './refs'
import {
  analogEdges,
  jitteredInstants,
  periodStats,
  sampleStats,
  timeWeightedStats,
  type PeriodStats,
  type SeriesStats,
} from './signal'

// ------------------------------------------------------------------ types

export interface EvaluatedCheck extends CheckResult {
  /** position in the evaluated list: "0", "3", "2.1" (sub-check 1 of check 2) */
  key: string
  kind: LessonCheck['kind']
  /** the lesson's label, else a generated zh-TW description */
  label: string
  /** technical lines (contract rule ids, firmware output) — shown verbatim, never translated */
  technical?: string[]
  /** sub-check results of an 'all' check */
  children?: EvaluatedCheck[]
  /** parts / holes the check is about (3D highlight of a failure) */
  focus?: { components: string[]; holes: string[] }
  /** the check could not be evaluated (missing asset, simulation failure) — counts as failed */
  error?: boolean
  /** what the check did itself while it ran (its stimulus, 「檢查時會自動操作：…」) */
  stimulus?: string
  /**
   * the check failed because parts are not on the board (release QA LS-F10):
   * the ids it names that the circuit lacks — for a has-part check the
   * catalog type it found too few of. A sub-check's go to its 'all' too.
   * The list offers 「載入起始電路」 instead of marking parts that are not there.
   */
  missing?: string[]
}

/** What is evaluated: a circuit and the firmware file bound to each MCU board. */
export interface EvalInput {
  layout: CircuitLayout
  /** MCU component id → firmware file */
  firmware: Record<string, FirmwareFile>
}

export interface EvalProgress {
  /** 0..1 over the whole run */
  fraction: number
  /** top-level check being evaluated */
  index: number
  total: number
  /** its label */
  label: string
}

export interface EvalOptions {
  /** bundled firmware + contracts (default: loaded on demand) */
  assets?: EvalAssets
  onProgress?: (p: EvalProgress) => void
  /** checked between simulation slices; aborting rejects with EvalCancelledError */
  signal?: { readonly aborted: boolean }
  /** yield to the event loop at most every N ms of work (default: 12 on a page, never elsewhere) */
  yieldEveryMs?: number
}

export interface LessonEvaluation {
  lessonId: string
  /** every acceptance check passed */
  pass: boolean
  results: EvaluatedCheck[]
}

export class EvalCancelledError extends Error {
  constructor() {
    super('lesson check cancelled')
    this.name = 'EvalCancelledError'
  }
}

// -------------------------------------------------------------- constants

/** default / maximum `seconds` of a measure check */
export const DEFAULT_MEASURE_SECONDS = 1
export const MAX_MEASURE_SECONDS = 10
/** default / maximum `seconds` of a uart-contains check */
export const DEFAULT_UART_SECONDS = 2
export const MAX_UART_SECONDS = 20
/** simulated time before the ERC's telemetry snapshot */
export const ERC_SETTLE_SECONDS = 0.3
/** sim time per coordinator.advance call (progress / cancellation granularity) */
const CHUNK_SECONDS = 0.02
/** jittered samples per averaged measurement */
const SAMPLE_COUNT = 200
/** UART bytes kept per session */
const UART_CAP = 1 << 20
/** scope channels (scope_probe 1..4) and logic channels (D0..D15) available to a session */
const SCOPE_CHANNELS = 4
const LOGIC_CHANNELS = 16
const PROBE_ID = '__lesson_probe_'

// ------------------------------------------------------------ probe plan

type MeasureCheck = Extract<LessonCheck, { kind: 'measure' }>

/** Hidden instruments a session adds so measurements can read the recorders. */
interface ProbePlan {
  /** the circuit + hidden ideal scope probes (the learner's own scope probes are left out — they carry no stamp) */
  layout: CircuitLayout
  logic: LogicChannelConfig[]
  /** logic source key → channel index */
  logicIndex: Map<string, number>
  /** hole endpoint → scope channel 0..3 */
  scope: Map<string, number>
}

function logicKey(src: LogicSource): string {
  return src.kind === 'mcu-pin' ? `mcu|${src.componentId}|${src.pin}` : src.kind === 'net' ? `net|${src.ref}` : `probe|${src.componentId}`
}

function logicSourceOf(r: Extract<ResolvedRef, { ok: true }>): LogicSource {
  return r.mcuPin ? { kind: 'mcu-pin', componentId: r.mcuPin.componentId, pin: r.mcuPin.pin } : { kind: 'net', ref: r.endpoint }
}

function measuresOf(checks: readonly LessonCheck[]): MeasureCheck[] {
  const out: MeasureCheck[] = []
  const walk = (c: LessonCheck): void => {
    if (c.kind === 'measure') out.push(c)
    else if (c.kind === 'all') c.checks.forEach(walk)
  }
  checks.forEach(walk)
  return out
}

/** The runtime params the checks' stimulus drives: part id → param keys. */
function drivenParams(checks: readonly LessonCheck[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const walk = (c: LessonCheck): void => {
    if (c.kind === 'all') return c.checks.forEach(walk)
    if (c.kind !== 'measure' && c.kind !== 'uart-contains') return
    for (const st of c.stimulus ?? []) {
      const keys = out.get(st.component) ?? new Set<string>()
      keys.add(st.param)
      out.set(st.component, keys)
    }
  }
  checks.forEach(walk)
  return out
}

/** `comp` with the runtime params in `keys` back at their catalog defaults. */
function atDefaults(comp: ComponentInstance, keys: ReadonlySet<string>): ComponentInstance {
  const entry = getEntry(comp.type)
  const params = { ...(comp.params ?? {}) }
  for (const k of keys) {
    const def = entry?.params?.find((p) => p.key === k)
    if (!def || def.runtime !== true) continue
    if (def.default === undefined) delete params[k]
    else params[k] = def.default
  }
  return { ...comp, params }
}

function buildPlan(
  layout: CircuitLayout,
  netlist: Netlist,
  checks: readonly LessonCheck[],
  /** the checks whose stimulus params start at their defaults (default: `checks`) */
  drivenBy: readonly LessonCheck[] = checks,
): ProbePlan {
  const logic: LogicChannelConfig[] = []
  const logicIndex = new Map<string, number>()
  const scope = new Map<string, number>()
  for (const m of measuresOf(checks)) {
    if (m.quantity === 'current' || m.quantity === 'led-brightness') continue
    const r = resolvePinRef(layout, m.at)
    if (!r.ok) continue
    if (r.hole && !scope.has(r.endpoint) && scope.size < SCOPE_CHANNELS && netlist.netOf(r.endpoint) !== null) {
      scope.set(r.endpoint, scope.size)
    }
    if (m.quantity === 'frequency' || m.quantity === 'duty') {
      const src = logicSourceOf(r)
      const key = logicKey(src)
      if (!logicIndex.has(key) && logic.length < LOGIC_CHANNELS) {
        logicIndex.set(key, logic.length)
        logic.push({ index: logic.length, label: pinRefText(m.at, layout), source: src })
      }
    }
  }
  // a part the checks act on starts from its catalog default (the knob at 0, the button released)
  const driven = drivenParams(drivenBy)
  const components: ComponentInstance[] = (Array.isArray(layout.components) ? layout.components : [])
    .filter((c) => c && c.type !== 'scope_probe')
    .map((c) => (driven.has(c.id) ? atDefaults(c, driven.get(c.id)!) : c))
  for (const [hole, ch] of scope) {
    components.push({ id: `${PROBE_ID}${ch + 1}`, type: 'scope_probe', holes: [hole], params: { channel: ch + 1 } })
  }
  return { layout: { ...layout, components }, logic, logicIndex, scope }
}

// ---------------------------------------------------------------- session

interface UartByte {
  componentId: string
  port: string
  byte: number
  t: number
}

/** One simulated world: coordinator from power-on, firmware programmed, recorders bound. */
class SimSession {
  readonly co = new SimulationCoordinator()
  readonly uart: UartByte[] = []
  private readonly unsub: () => void
  /** runtime param changes still to apply, by time (a check's stimulus) */
  private stim: { at: number; seq: number; st: LessonStimulus }[] = []
  private stimSeq = 0

  constructor(
    readonly plan: ProbePlan,
    images: ReadonlyMap<string, FirmwareImage>,
  ) {
    this.co.load(plan.layout, 1)
    for (const [id, image] of images) this.co.setFirmware(id, image)
    if (plan.logic.length > 0) this.co.setLogicChannels(plan.logic)
    this.unsub = this.co.addUartListener((componentId, port, byte, tt) => {
      if (this.uart.length < UART_CAP) this.uart.push({ componentId, port, byte, t: tt })
    })
  }

  get time(): number {
    return this.co.time
  }

  /**
   * Queue runtime param changes at their virtual times (a time already
   * passed applies now). Returns the function that drops the ones not
   * applied yet.
   */
  addStimulus(list: readonly LessonStimulus[]): () => void {
    const mine = new Set<number>()
    for (const st of list) {
      const seq = ++this.stimSeq
      mine.add(seq)
      this.stim.push({ at: Math.max(st.at, this.time), seq, st })
    }
    // stable by time, then by the order the lesson wrote them
    this.stim.sort((a, b) => a.at - b.at || a.seq - b.seq)
    this.applyDue()
    return () => {
      this.stim = this.stim.filter((x) => !mine.has(x.seq))
    }
  }

  /** Virtual time of the next queued change (Infinity: none). */
  nextStimulusAt(): number {
    return this.stim.length > 0 ? this.stim[0].at : Infinity
  }

  /** Apply every queued change whose time has come — the inspector's runtime-param path. */
  applyDue(): void {
    while (this.stim.length > 0 && this.stim[0].at <= this.time + 1e-12) {
      const { st } = this.stim.shift()!
      this.co.setRuntimeParam(st.component, st.param, st.value)
    }
  }

  /** the engine failed to start (its issue message), else null */
  startFailure(): string | null {
    if (this.co.engine) return null
    const issue = this.co.issues().find((i) => i.message.startsWith('simulation failed to start'))
    return issue ? issue.message : 'simulation failed to start'
  }

  dispose(): void {
    this.unsub()
    this.co.dispose()
  }
}

// ---------------------------------------------------------------- context

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * Everything one evaluation run shares: the circuit, its netlist, the parsed
 * firmware, the shared simulation session and progress / cancellation.
 */
export class EvalContext {
  readonly layout: CircuitLayout
  readonly firmware: Record<string, FirmwareFile>
  readonly assets: EvalAssets
  private readonly opts: EvalOptions
  private readonly planChecks: readonly LessonCheck[]
  private netlistCache: Netlist | null = null
  private planCache: ProbePlan | null = null
  private imageCache: Map<string, FirmwareImage> | null = null
  /** firmware that could not be parsed: component id → loader error */
  readonly firmwareErrors: Record<string, string> = {}
  private shared: SimSession | null = null
  private readonly yieldEvery: number
  private lastYield = now()
  // progress range of the check being evaluated
  private base = 0
  private span = 1
  private index = 0
  private total = 1
  private label = ''

  constructor(input: EvalInput, planChecks: readonly LessonCheck[] = [], opts: EvalOptions = {}) {
    this.layout = input.layout
    this.firmware = input.firmware ?? {}
    this.assets = opts.assets ?? defaultAssets
    this.opts = opts
    this.planChecks = planChecks
    this.yieldEvery = opts.yieldEveryMs ?? (typeof window !== 'undefined' ? 12 : Infinity)
  }

  get netlist(): Netlist {
    if (!this.netlistCache) this.netlistCache = buildNetlist(this.layout)
    return this.netlistCache
  }

  get plan(): ProbePlan {
    if (!this.planCache) this.planCache = buildPlan(this.layout, this.netlist, this.planChecks)
    return this.planCache
  }

  /** Parsed firmware of every MCU board in the circuit that has a file bound. */
  images(): Map<string, FirmwareImage> {
    if (this.imageCache) return this.imageCache
    const out = new Map<string, FirmwareImage>()
    for (const comp of this.layout.components ?? []) {
      if (!comp || !getEntry(comp.type)?.mcu) continue
      const fw = this.firmware[comp.id]
      if (!fw) continue
      try {
        const res = loadFirmwareFile(fw.name, fw.bytes, fw.binBase !== undefined ? { binBase: fw.binBase } : {})
        if (res.ok) out.set(comp.id, res.image)
        else this.firmwareErrors[comp.id] = res.error
      } catch (err) {
        this.firmwareErrors[comp.id] = err instanceof Error ? err.message : String(err)
      }
    }
    this.imageCache = out
    return out
  }

  /** The session non-fresh measurements share (power-on at its creation). */
  sharedSession(): SimSession {
    if (!this.shared) this.shared = new SimSession(this.plan, this.images())
    return this.shared
  }

  /** A new world from power-on (the caller disposes it). */
  freshSession(plan: ProbePlan = this.plan): SimSession {
    return new SimSession(plan, this.images())
  }

  /** A plan for checks this context was not prepared for (evaluateCheck called directly). */
  planFor(checks: readonly LessonCheck[]): ProbePlan {
    // its own instruments; the parts the run drives start at their defaults in every world of the run
    return buildPlan(this.layout, this.netlist, checks, [...this.planChecks, ...checks])
  }

  throwIfCancelled(): void {
    if (this.opts.signal?.aborted) throw new EvalCancelledError()
  }

  async maybeYield(): Promise<void> {
    if (this.yieldEvery === Infinity) return
    if (now() - this.lastYield < this.yieldEvery) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    this.lastYield = now()
  }

  /** set the progress range of the next top-level check */
  beginCheck(base: number, span: number, index: number, total: number, label: string): void {
    this.base = base
    this.span = span
    this.index = index
    this.total = total
    this.label = label
    this.report(0)
  }

  /** progress inside the current range (0..1) */
  report(fraction: number): void {
    const f = Math.min(1, Math.max(0, fraction))
    this.opts.onProgress?.({
      fraction: Math.min(1, this.base + this.span * f),
      index: this.index,
      total: this.total,
      label: this.label,
    })
  }

  /** run `fn` with the progress range narrowed to [lo, hi] of the current one */
  async within<T>(lo: number, hi: number, fn: () => Promise<T>): Promise<T> {
    const base = this.base
    const span = this.span
    this.base = base + span * lo
    this.span = span * (hi - lo)
    try {
      return await fn()
    } finally {
      this.base = base
      this.span = span
    }
  }

  /** Advance `s` to virtual time `target` in slices (progress, cancellation, yielding). */
  async advanceTo(s: SimSession, target: number, onFraction?: (f: number) => void): Promise<void> {
    const start = s.time
    const total = target - start
    while (s.time < target - 1e-12) {
      this.throwIfCancelled()
      const before = s.time
      // a queued stimulus splits the slice: the change lands at its exact time
      const stop = Math.min(target, s.time + CHUNK_SECONDS, Math.max(s.nextStimulusAt(), s.time + 1e-9))
      s.co.advance(stop - s.time)
      s.applyDue()
      if (!(s.time > before)) break // no engine (failed to start) or halted
      if (onFraction && total > 0) onFraction((s.time - start) / total)
      await this.maybeYield()
    }
  }

  dispose(): void {
    this.shared?.dispose()
    this.shared = null
  }
}

// ----------------------------------------------------------------- helpers

function result(
  c: LessonCheck,
  key: string,
  pass: boolean,
  detail: string,
  extra: Partial<Pick<EvaluatedCheck, 'technical' | 'children' | 'focus' | 'error' | 'missing'>> = {},
): EvaluatedCheck {
  return { key, kind: c.kind, label: checkLabel(c), pass, detail, ...extra }
}

// --------------------------------------------------------------- stimulus

/**
 * Why a check's stimulus cannot be applied to this circuit, null when it can:
 * a part the learner removed fails the check like any missing part; a param
 * that is not a runtime setting (or a negative / non-finite time) is the
 * lesson author's mistake and reads as an evaluation error.
 */
function stimulusProblem(
  stimulus: readonly LessonStimulus[] | undefined,
  layout: CircuitLayout,
): { detail: string; error: boolean; component: string } | null {
  for (const st of stimulus ?? []) {
    const comp = findComponent(layout, st.component)
    if (!comp) return { detail: t('{id} is not in the circuit', { id: st.component }), error: false, component: st.component }
    const def = getEntry(comp.type)?.params?.find((p) => p.key === st.param)
    if (!def || def.runtime !== true || !Number.isFinite(st.at) || st.at < 0) {
      return {
        detail: t('{id} has no setting “{param}” that can change while the simulation runs.', { id: st.component, param: st.param }),
        error: true,
        component: st.component,
      }
    }
  }
  return null
}

/** The stimulus a check scheduled, as applied (a time the session already passed runs now). */
interface AppliedStimulus {
  list: LessonStimulus[] | null
}

/**
 * How much later than written a check's actions run: when the shared
 * session has already passed the first one (an earlier check ran on), the
 * whole little script starts NOW, keeping the spacing of its actions (a
 * press and its release never collapse into one instant). 0 for a fresh
 * world or a script still ahead.
 */
function stimulusShift(s: SimSession, stimulus: readonly LessonStimulus[] | undefined): number {
  if (!stimulus || stimulus.length === 0) return 0
  return Math.max(0, s.time - Math.min(...stimulus.map((x) => x.at)))
}

/**
 * Queue a check's stimulus on `s`, moved later by `shift` (each change at
 * its exact virtual time, through the coordinator's runtime-param path),
 * noting the times it really gets in `applied`. Returns the function that
 * drops the changes the check did not reach.
 */
function scheduleStimulus(
  s: SimSession,
  stimulus: readonly LessonStimulus[] | undefined,
  shift: number,
  applied?: AppliedStimulus,
): () => void {
  const list = (stimulus ?? []).map((st) => ({ ...st, at: st.at + shift }))
  if (list.length === 0) return () => {}
  if (applied) applied.list = list
  return s.addStimulus(list)
}

/** The result of a check with a stimulus names what it did (EvaluatedCheck.stimulus). */
function withStimulus(r: EvaluatedCheck, stimulus: readonly LessonStimulus[] | null | undefined, layout: CircuitLayout): EvaluatedCheck {
  if (!stimulus || stimulus.length === 0) return r
  return { ...r, stimulus: stimulusText(stimulus, layout) }
}

function refError(r: Extract<ResolvedRef, { ok: false }>): string {
  switch (r.reason) {
    case 'no-component':
      return t('{id} is not in the circuit', r.params)
    case 'no-pin':
      return t('{id} has no pin named {pin}', r.params)
    case 'unplaced':
      return t('{id} is not placed on the board correctly', r.params)
    case 'bad-hole':
      return t('“{ref}” is not a breadboard hole', r.params)
    case 'bad-terminal':
      return t('“{ref}” is not a terminal reference', r.params)
  }
}

/** `missing` of a ref that names a part the circuit lacks (LS-F10). */
function missingOf(r: ResolvedRef): Pick<EvaluatedCheck, 'missing'> {
  return !r.ok && r.reason === 'no-component' && r.params.id ? { missing: [r.params.id] } : {}
}

function focusOf(...refs: (string | null | undefined)[]): { components: string[]; holes: string[] } {
  const components: string[] = []
  for (const r of refs) if (r && !components.includes(r)) components.push(r)
  return { components, holes: [] }
}

function holesOf(...rs: ResolvedRef[]): string[] {
  const out: string[] = []
  for (const r of rs) if (r.ok && r.hole && !out.includes(r.endpoint)) out.push(r.endpoint)
  return out
}

function findComponent(layout: CircuitLayout, id: string): ComponentInstance | undefined {
  return Array.isArray(layout.components) ? layout.components.find((c) => c && c.id === id) : undefined
}

function inRange(value: number, min: number, max: number): boolean {
  const eps = 1e-9 * Math.max(1, Math.abs(min), Math.abs(max))
  return Number.isFinite(value) && value >= min - eps && value <= max + eps
}

function numberParam(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return NaN
  const m = /^\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([pnuµmkKMG]?)/.exec(v)
  if (!m) return NaN
  const mult: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 }
  return parseFloat(m[1]) * (m[2] ? mult[m[2]] : 1)
}

/**
 * The test lead of a bench meter that has no connection at all (LS-F9):
 * for a reading at `DMM1:IN`, 「DMM1 IN 端」 when IN has no wire, else
 * 「DMM1 COM 端」 when COM has none; null when both are wired (or `terminal`
 * is not a meter's).
 */
function unwiredMeterLead(terminal: string, ctx: EvalContext): string | null {
  const term = parseTerminalRef(terminal)
  const comp = term ? findComponent(ctx.layout, term.componentId) : undefined
  const entry = comp ? getEntry(comp.type) : undefined
  if (!comp || !entry || entry.placement !== 'offboard' || !entry.pins.includes('IN') || !entry.pins.includes('COM')) return null
  // an off-board terminal connects through wires only
  const wired = (pin: string) =>
    (ctx.layout.wires ?? []).some((w) =>
      [w?.from, w?.to].some((end) => {
        const t = typeof end === 'string' ? parseTerminalRef(end) : null
        return !!t && t.componentId === comp.id && t.pin.toUpperCase() === pin
      }),
    )
  for (const pin of ['IN', 'COM']) if (!wired(pin)) return terminalLabel(`${comp.id}:${pin}`, ctx.layout)
  return null
}

function simNotes(ctx: EvalContext, s: SimSession): string {
  const notes: string[] = []
  const fail = s.startFailure()
  if (fail) notes.push(t('The simulation could not start: {error}', { error: tMessage(fail) }))
  for (const [id, err] of Object.entries(ctx.firmwareErrors)) {
    notes.push(t('The firmware of {id} could not be loaded: {error}', { id, error: tMessage(err) }))
  }
  return notes.length > 0 ? ` ${notes.join(' ')}` : ''
}

// ----------------------------------------------------------- the checks

function evalHasPart(c: Extract<LessonCheck, { kind: 'has-part' }>, ctx: EvalContext, key: string): EvaluatedCheck {
  const need = Math.max(1, Math.floor(c.count ?? 1))
  const found = (ctx.layout.components ?? []).filter((x) => x && x.type === c.type)
  const pass = found.length >= need
  const detail = pass
    ? t('Found {n} × {part} (need at least {need}).', { n: found.length, part: partName(c.type), need })
    : found.length === 0
      ? t('No {part} in the circuit (need at least {need}).', { part: partName(c.type), need })
      : t('Only {n} × {part} in the circuit (need at least {need}).', { n: found.length, part: partName(c.type), need })
  return result(c, key, pass, detail, { focus: focusOf(...found.map((x) => x.id)), ...(pass ? {} : { missing: [c.type] }) })
}

function evalConnected(c: Extract<LessonCheck, { kind: 'connected' }>, ctx: EvalContext, key: string): EvaluatedCheck {
  const ra = resolvePinRef(ctx.layout, c.a)
  const rb = resolvePinRef(ctx.layout, c.b)
  const a = pinRefText(c.a, ctx.layout)
  const b = pinRefText(c.b, ctx.layout)
  const focus = { ...focusOf(pinRefComponent(c.a), pinRefComponent(c.b)), holes: holesOf(ra, rb) }
  if (!ra.ok) return result(c, key, false, refError(ra), { focus, ...missingOf(ra) })
  if (!rb.ok) return result(c, key, false, refError(rb), { focus, ...missingOf(rb) })
  const na = ctx.netlist.netOf(ra.endpoint)
  const nb = ctx.netlist.netOf(rb.endpoint)

  if (!c.via) {
    const pass = na !== null && na === nb
    const detail = pass
      ? t('{a} and {b} are on the same net.', { a, b })
      : na === null
        ? t('{a} is not connected to anything.', { a })
        : nb === null
          ? t('{a} is not connected to anything.', { a: b })
          : t('{a} and {b} are not connected.', { a, b })
    return result(c, key, pass, detail, { focus })
  }

  const via = c.via
  const part = partName(via.type)
  if (na === null || nb === null) {
    return result(c, key, false, t('{a} is not connected to anything.', { a: na === null ? a : b }), { focus })
  }
  if (na === nb) {
    return result(c, key, false, t('{a} and {b} are connected directly — the {part} is bypassed.', { a, b, part }), { focus })
  }
  const entry = getEntry(via.type)
  const unit = via.param ? (entry?.params?.find((p) => p.key === via.param)?.unit ?? '') : ''
  const bridges: { id: string; value: number; ok: boolean }[] = []
  for (const comp of ctx.layout.components ?? []) {
    if (!comp || comp.type !== via.type || !entry) continue
    const nets = entry.pins.map((pin) => {
      const r = resolvePinRef(ctx.layout, { component: comp.id, pin })
      return r.ok ? ctx.netlist.netOf(r.endpoint) : null
    })
    const ia = nets.indexOf(na)
    const ib = nets.indexOf(nb)
    if (ia < 0 || ib < 0 || ia === ib) continue
    const value = via.param ? numberParam(paramOf(comp.params, entry, via.param)) : NaN
    const ok =
      !via.param ||
      (Number.isFinite(value) && (via.min === undefined || value >= via.min) && (via.max === undefined || value <= via.max))
    bridges.push({ id: comp.id, value, ok })
  }
  const good = bridges.find((x) => x.ok)
  const fmt = (v: number): string => (unit ? fmtSi(v, unit) : String(v))
  const range =
    via.min !== undefined && via.max !== undefined
      ? t('{min} – {max}', { min: fmt(via.min), max: fmt(via.max) })
      : via.min !== undefined
        ? t('at least {min}', { min: fmt(via.min) })
        : via.max !== undefined
          ? t('at most {max}', { max: fmt(via.max) })
          : ''
  const withFocus = { ...focus, components: [...focus.components, ...bridges.map((x) => x.id)] }
  if (good) {
    const detail = via.param
      ? t('{id} ({value}) connects {a} and {b}.', { id: good.id, value: fmt(good.value), a, b })
      : t('{id} connects {a} and {b}.', { id: good.id, a, b })
    return result(c, key, true, detail, { focus: withFocus })
  }
  if (bridges.length > 0) {
    const x = bridges[0]
    return result(
      c,
      key,
      false,
      t('{id} connects {a} and {b}, but its value {value} is outside {range}.', { id: x.id, a, b, value: fmt(x.value), range }),
      { focus: withFocus },
    )
  }
  return result(c, key, false, t('No {part} connects {a} and {b}.', { part, a, b }), { focus: withFocus })
}

function evalNotConnected(c: Extract<LessonCheck, { kind: 'not-connected' }>, ctx: EvalContext, key: string): EvaluatedCheck {
  const ra = resolvePinRef(ctx.layout, c.a)
  const rb = resolvePinRef(ctx.layout, c.b)
  const a = pinRefText(c.a, ctx.layout)
  const b = pinRefText(c.b, ctx.layout)
  const focus = { ...focusOf(pinRefComponent(c.a), pinRefComponent(c.b)), holes: holesOf(ra, rb) }
  // an absent pin cannot be shorted to anything
  const na = ra.ok ? ctx.netlist.netOf(ra.endpoint) : null
  const nb = rb.ok ? ctx.netlist.netOf(rb.endpoint) : null
  const shorted = na !== null && na === nb
  return result(
    c,
    key,
    !shorted,
    shorted ? t('{a} and {b} are connected (they share a net).', { a, b }) : t('{a} and {b} are on separate nets.', { a, b }),
    { focus },
  )
}

function stem(name: string): string {
  return name.replace(/\.[A-Za-z0-9]+$/, '')
}

async function evalFirmwareLoaded(
  c: Extract<LessonCheck, { kind: 'firmware-loaded' }>,
  ctx: EvalContext,
  key: string,
): Promise<EvaluatedCheck> {
  const focus = focusOf(c.component)
  const comp = findComponent(ctx.layout, c.component)
  if (!comp) return result(c, key, false, t('{id} is not in the circuit', { id: c.component }), { focus, missing: [c.component] })
  if (!getEntry(comp.type)?.mcu) {
    return result(c, key, false, t('{id} is not a microcontroller board.', { id: c.component }), { focus })
  }
  const fw = ctx.firmware[c.component]
  if (!fw) return result(c, key, false, t('{id} has no firmware loaded.', { id: c.component }), { focus })
  if (!c.project) return result(c, key, true, t('{id} has {name} loaded.', { id: c.component, name: fw.name }), { focus })
  const bundled = await ctx.assets.bundled(c.project)
  const same = bundled ? sha256Hex(fw.bytes) === sha256Hex(bundled.bytes) : stem(fw.name) === c.project
  return result(
    c,
    key,
    same,
    same
      ? t('{id} has {name} loaded.', { id: c.component, name: fw.name })
      : t('{id} has {name} loaded, not the {project} firmware.', { id: c.component, name: fw.name, project: c.project }),
    { focus },
  )
}

/**
 * An LED's rated continuous current (A) — the catalog's ifMax, 100 % of the
 * brightness scale (F4); a board's on-board LED ("U1/LED_PC13") and a part
 * without a rating use the 5 mm LED's 20 mA.
 */
function ledRatedCurrent(layout: CircuitLayout, id: string): number {
  if (id.includes('/')) return LED_LIGHT_RATED_A
  const comp = layout.components.find((x) => x.id === id)
  const ifMax = comp ? getEntry(comp.type)?.ratings?.ifMax : undefined
  return typeof ifMax === 'number' && ifMax > 0 ? ifMax : LED_LIGHT_RATED_A
}

/** telemetry of a part or of a board's sub-circuit element ("U1/LED_PC13") */
function telemetryOf(comps: Record<string, ComponentTelemetry>, id: string): ComponentTelemetry | undefined {
  const slash = id.indexOf('/')
  if (slash < 0) return comps[id]
  return comps[id.slice(0, slash)]?.sub?.[id.slice(slash + 1)]
}

async function evalMeasure(c: MeasureCheck, ctx: EvalContext, key: string): Promise<EvaluatedCheck> {
  const applied: AppliedStimulus = { list: null }
  const r = await measureOnce(c, ctx, key, applied)
  return withStimulus(r, applied.list ?? c.stimulus, ctx.layout)
}

async function measureOnce(c: MeasureCheck, ctx: EvalContext, key: string, applied: AppliedStimulus): Promise<EvaluatedCheck> {
  const seconds = Math.min(MAX_MEASURE_SECONDS, Math.max(0.001, c.seconds ?? DEFAULT_MEASURE_SECONDS))
  const q = c.quantity
  const partQuantity = q === 'current' || q === 'led-brightness'
  const r = resolvePinRef(ctx.layout, c.at)
  const partId = partQuantity ? (c.component ?? pinRefComponent(c.at)) : null
  const focus = { ...focusOf(partId ?? pinRefComponent(c.at)), holes: holesOf(r) }

  if (partQuantity) {
    if (!partId) return result(c, key, false, t('The check names no part to measure.'), { focus })
    if (!findComponent(ctx.layout, partId.split('/')[0])) {
      return result(c, key, false, t('{id} is not in the circuit', { id: partId.split('/')[0] }), { focus, missing: [partId.split('/')[0]] })
    }
  } else if (!r.ok) {
    return result(c, key, false, refError(r), { focus, ...missingOf(r) })
  }
  const bad = stimulusProblem(c.stimulus, ctx.layout)
  if (bad) {
    return result(c, key, false, bad.detail, {
      focus: { ...focus, components: [...new Set([...focus.components, bad.component])] },
      ...(bad.error ? { error: true } : { missing: [bad.component] }),
    })
  }
  // a voltage at a meter terminal: a test lead with no connection reads nothing (LS-F9) — say so,
  // never 「量測值 ≈ 0 V」
  if (q === 'voltage' && 'terminal' in c.at) {
    const lead = unwiredMeterLead(c.at.terminal, ctx)
    if (lead) return result(c, key, false, t('{terminal} is not wired yet — no voltage to measure', { terminal: lead }), { focus })
  }

  // a context prepared for other checks: give this one its own instruments
  let plan = ctx.plan
  let fresh = !!c.fresh
  if (!partQuantity && r.ok) {
    const needLogic = (q === 'frequency' || q === 'duty') && !plan.logicIndex.has(logicKey(logicSourceOf(r)))
    if (needLogic) {
      plan = ctx.planFor([c])
      fresh = true
    }
  }
  const s = fresh ? ctx.freshSession(plan) : ctx.sharedSession()
  const dropStimulus = scheduleStimulus(s, c.stimulus, stimulusShift(s, c.stimulus), applied)
  try {
    const t0 = s.time
    const t1 = t0 + seconds
    const tMid = t0 + seconds / 2
    const progress = (f: number) => ctx.report(f)
    const percent = (q === 'duty' || q === 'led-brightness') && isPercentRange(c.min, c.max)
    const lo = percent ? c.min / 100 : c.min
    const hi = percent ? c.max / 100 : c.max
    const expected = fmtRange(q, c.min, c.max)

    const averaged = async (sample: () => number): Promise<SeriesStats> => {
      await ctx.advanceTo(s, tMid, (f) => progress(f * 0.5))
      const values: number[] = []
      for (const at of jitteredInstants(tMid, t1, SAMPLE_COUNT)) {
        await ctx.advanceTo(s, at)
        values.push(sample())
        progress(0.5 + (0.5 * (s.time - tMid)) / (t1 - tMid))
      }
      await ctx.advanceTo(s, t1)
      return sampleStats(values)
    }
    // an LED's min / max with the very rounding of its measured value (fmtLight, P1): 「量測值 49 %」
    // beside 「最大 48.5 %」 would contradict itself
    const spreadValue = (v: number): string => (q === 'led-brightness' ? fmtLight(v) : fmtMeasured(q, v, c.min, c.max))
    const withSpread = (st: SeriesStats): string =>
      st.count > 0 && Math.abs(st.max - st.min) > 1e-9 * Math.max(1, Math.abs(st.max))
        ? ` ${t('Average over {from} – {to} s of simulated time (min {min}, max {max}).', {
            from: Number(tMid.toFixed(3)),
            to: Number(t1.toFixed(3)),
            min: spreadValue(st.min),
            max: spreadValue(st.max),
          })}`
        : ''

    if (q === 'voltage' && r.ok) {
      const ch = plan.scope.get(r.endpoint)
      let st: SeriesStats
      if (ch !== undefined) {
        await ctx.advanceTo(s, t1, progress)
        const res = s.co.query({ kind: 'scope', t0: tMid, t1 })
        const trace = res.kind === 'scope' ? res.capture.traces.find((x) => x.index === ch) : undefined
        st = trace ? timeWeightedStats(trace.t, trace.v, tMid, t1) : sampleStats([])
      } else {
        st = await averaged(() => s.co.engine?.netVoltage(r.endpoint) ?? NaN)
      }
      if (st.count === 0 && ctx.netlist.netOf(r.endpoint) === null) {
        return result(c, key, false, t('{a} is not connected to anything.', { a: pinRefText(c.at, ctx.layout) }) + simNotes(ctx, s), { focus })
      }
      const pass = inRange(st.mean, lo, hi)
      return result(
        c,
        key,
        pass,
        t('Measured {value} (expected {range}).', { value: fmtMeasured(q, st.mean, c.min, c.max), range: expected }) + withSpread(st) + simNotes(ctx, s),
        { focus },
      )
    }

    if ((q === 'frequency' || q === 'duty') && r.ok) {
      await ctx.advanceTo(s, t1, progress)
      const idx = plan.logicIndex.get(logicKey(logicSourceOf(r)))
      const res = s.co.query({ kind: 'logic', t0, t1 })
      const trace = res.kind === 'logic' && idx !== undefined ? res.capture.traces.find((x) => x.index === idx) : undefined
      let stats: PeriodStats | null = trace ? periodStats(trace) : null
      // thresholded analog net whose swing misses the logic thresholds: the scope ring at its own mid-level
      const ch = plan.scope.get(r.endpoint)
      if ((!trace || !trace.exact) && (!stats || stats.frequency === null) && ch !== undefined) {
        const sc = s.co.query({ kind: 'scope', t0, t1 })
        const st = sc.kind === 'scope' ? sc.capture.traces.find((x) => x.index === ch) : undefined
        const edges = st ? analogEdges(st.t, st.v, t0, t1) : null
        if (edges) stats = periodStats(edges)
      }
      if (!stats) return result(c, key, false, t('No signal could be recorded at {at}.', { at: pinRefText(c.at, ctx.layout) }) + simNotes(ctx, s), { focus })
      const edgesText = t('{rising} rising and {falling} falling edges in {s} s.', {
        rising: stats.rising,
        falling: stats.falling,
        s: Number(seconds.toFixed(3)),
      })
      if (stats.constant !== null) {
        // DC: frequency 0 Hz, duty = the level
        const level =
          stats.constant === 1 ? t('it stays high') : stats.constant === 0 ? t('it stays low') : t('its level is undefined (floating)')
        const value = q === 'frequency' ? 0 : stats.constant === 2 ? NaN : stats.constant
        const pass = inRange(value, lo, hi)
        return result(
          c,
          key,
          pass,
          t('The signal does not change — {level} (expected {range}).', { level, range: expected }) + simNotes(ctx, s),
          { focus },
        )
      }
      const value = q === 'frequency' ? stats.frequency : stats.duty
      if (value === null) {
        return result(
          c,
          key,
          false,
          t('Not enough edges to measure a whole period. {edges}', { edges: edgesText }) + simNotes(ctx, s),
          { focus },
        )
      }
      const pass = inRange(value, lo, hi)
      return result(
        c,
        key,
        pass,
        t('Measured {value} (expected {range}).', { value: fmtMeasured(q, value, c.min, c.max), range: expected }) + ` ${edgesText}` + simNotes(ctx, s),
        { focus },
      )
    }

    // current / led-brightness of a part
    const id = partId as string
    // an LED's brightness is printed with its current (F4): the current sampled at the same instants
    const ledCurrents: number[] = []
    // a PWM / fast-blink LED's telemetry is the eye mean of a switching current: say 平均 as the
    // inspector and the 3D label do (「15 %（平均 3.07 mA）」)
    let switching = false
    // an LED burned out at every sampled instant prints 「0 %（已燒毀）」 as the inspector, the
    // properties panel and the 3D label do — never 「0 %（0 A）」 (a mean that still includes light
    // from before a burn mid-window keeps its numbers)
    let ledSamples = 0
    let burnedSamples = 0
    const st = await averaged(() => {
      const tel = telemetryOf(s.co.telemetry().components, id)
      if (!tel) return NaN
      if (q === 'current') return tel.current === undefined ? NaN : Math.abs(tel.current)
      if (typeof tel.light !== 'number') return NaN
      if (isAveragedLed(tel)) switching = true
      ledSamples++
      if (tel.burned) burnedSamples++
      ledCurrents.push(tel.burned ? 0 : typeof tel.current === 'number' ? Math.abs(tel.current) : NaN)
      return tel.light
    })
    if (st.count === 0) {
      const what = q === 'current' ? t('{id} reports no current.', { id }) : t('{id} reports no LED brightness.', { id })
      return result(c, key, false, what + simNotes(ctx, s), { focus })
    }
    const pass = inRange(st.mean, lo, hi)
    let value = fmtMeasured(q, st.mean, c.min, c.max)
    let range = expected
    if (q === 'led-brightness') {
      const rated = ledRatedCurrent(ctx.layout, id)
      const iMean = sampleStats(ledCurrents).mean
      const burned = ledSamples > 0 && burnedSamples === ledSamples
      value = fmtLedLight(st.mean, iMean, { rated, average: switching, burned })
      // the expected brightness with the currents it means: 「25 % – 150 %，即 5 mA – 30 mA」
      range = t('{range}, i.e. {currents}|led-range', { range: expected, currents: fmtRange('current', lo * rated, hi * rated) })
    }
    return result(
      c,
      key,
      pass,
      t('Measured {value} (expected {range}).', { value, range }) + withSpread(st) + simNotes(ctx, s),
      { focus },
    )
  } finally {
    dropStimulus()
    if (fresh) s.dispose()
  }
}

/** Index of `needle` in `hay` (byte arrays), -1 when absent. */
function indexOfBytes(hay: readonly number[], needle: Uint8Array): number {
  if (needle.length === 0) return 0
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

function printable(bytes: readonly number[]): string {
  let s = ''
  for (const b of bytes) {
    if (b === 0x0d) continue
    if (b === 0x0a) s += '⏎'
    else if (b >= 0x20 && b < 0x7f) s += String.fromCharCode(b)
    else s += '·'
  }
  return s
}

async function evalUart(c: Extract<LessonCheck, { kind: 'uart-contains' }>, ctx: EvalContext, key: string): Promise<EvaluatedCheck> {
  const applied: AppliedStimulus = { list: null }
  const r = await uartOnce(c, ctx, key, applied)
  return withStimulus(r, applied.list ?? c.stimulus, ctx.layout)
}

async function uartOnce(
  c: Extract<LessonCheck, { kind: 'uart-contains' }>,
  ctx: EvalContext,
  key: string,
  applied: AppliedStimulus,
): Promise<EvaluatedCheck> {
  const focus = focusOf(c.component)
  if (!findComponent(ctx.layout, c.component)) {
    return result(c, key, false, t('{id} is not in the circuit', { id: c.component }), { focus, missing: [c.component] })
  }
  const bad = stimulusProblem(c.stimulus, ctx.layout)
  if (bad) {
    return result(c, key, false, bad.detail, {
      focus: focusOf(c.component, bad.component),
      ...(bad.error ? { error: true } : { missing: [bad.component] }),
    })
  }
  const seconds = Math.min(MAX_UART_SECONDS, Math.max(0.001, c.seconds ?? DEFAULT_UART_SECONDS))
  const needle = new TextEncoder().encode(c.text.replace(/\r/g, ''))
  const s = ctx.sharedSession()
  // with a stimulus, only what the firmware sends AFTER the first action
  // counts, and the check performs every action it lists within `seconds`
  // (a release after the press happens even when the text came earlier), so
  // the next check on the shared session starts from a known state. A
  // session already past the first action runs the script — and the
  // deadline — that much later (stimulusShift).
  const stim = c.stimulus ?? []
  const shift = stimulusShift(s, stim)
  const deadline = seconds + shift
  const from = stim.length > 0 ? Math.min(...stim.map((x) => x.at)) + shift : 0
  const until = stim.length > 0 ? Math.min(deadline, Math.max(...stim.map((x) => x.at)) + shift) : 0
  const dropStimulus = scheduleStimulus(s, stim, shift, applied)
  try {
    return await uartIn(c, ctx, key, s, deadline, from, until, needle, focus)
  } finally {
    dropStimulus()
  }
}

async function uartIn(
  c: Extract<LessonCheck, { kind: 'uart-contains' }>,
  ctx: EvalContext,
  key: string,
  s: SimSession,
  seconds: number,
  from: number,
  until: number,
  needle: Uint8Array,
  focus: { components: string[]; holes: string[] },
): Promise<EvaluatedCheck> {
  const stream = (): { bytes: number[]; times: number[] } => {
    const bytes: number[] = []
    const times: number[] = []
    for (const u of s.uart) {
      if (u.componentId !== c.component || u.port !== c.port || u.t > seconds || u.t < from) continue
      if (u.byte === 0x0d) continue
      bytes.push(u.byte & 0xff)
      times.push(u.t)
    }
    return { bytes, times }
  }
  let found = -1
  let st = stream()
  found = indexOfBytes(st.bytes, needle)
  while ((found < 0 || s.time < until - 1e-12) && s.time < seconds - 1e-12) {
    const before = s.time
    await ctx.advanceTo(s, Math.min(seconds, found < 0 ? s.time + 0.05 : until))
    ctx.report(s.time / seconds)
    if (!(s.time > before)) break
    st = stream()
    found = indexOfBytes(st.bytes, needle)
  }
  const got = printable(st.bytes.slice(-80))
  if (found >= 0) {
    const at = st.times[found + needle.length - 1] ?? 0
    return result(
      c,
      key,
      true,
      t('Received “{text}” {s} s after power-on.', { text: c.text, s: Number(at.toFixed(3)) }),
      { focus },
    )
  }
  const detail =
    st.bytes.length === 0
      ? from > 0
        ? t('{port} of {id} sent nothing between {from} s and {s} s.', {
            port: c.port,
            id: c.component,
            from: Number(from.toFixed(3)),
            s: Number(seconds.toFixed(3)),
          })
        : t('{port} of {id} sent nothing within {s} s.', { port: c.port, id: c.component, s: Number(seconds.toFixed(3)) })
      : t('“{text}” did not arrive within {s} s — the last bytes received are shown below.', {
          text: c.text,
          s: Number(seconds.toFixed(3)),
        })
  return result(c, key, false, detail + simNotes(ctx, s), { focus, technical: st.bytes.length > 0 ? [got] : undefined })
}

async function evalFirmwareChecks(
  c: Extract<LessonCheck, { kind: 'firmware-checks' }>,
  ctx: EvalContext,
  key: string,
): Promise<EvaluatedCheck> {
  let entry: ManifestEntry | null = null
  let file: FirmwareFile | null = null
  try {
    entry = await ctx.assets.manifest(c.project)
    file = await ctx.assets.bundled(c.project)
  } catch {
    /* reported below */
  }
  if (!file) {
    return result(c, key, false, t('The {project} firmware is not bundled with the app.', { project: c.project }), { error: true })
  }
  if (!entry?.checks) {
    return result(c, key, false, t('The {project} firmware has no behavior contract.', { project: c.project }), { error: true })
  }
  const loaded = loadFirmwareFile(file.name, file.bytes)
  if (!loaded.ok) {
    return result(c, key, false, t('The firmware could not be loaded: {error}', { error: tMessage(loaded.error) }), { error: true })
  }
  ctx.throwIfCancelled()
  const runsExpected = 1 + (entry.checks.scenarios?.length ?? 0)
  let runsDone = 0
  const report = runChecks(entry, loaded.image, {
    name: c.project,
    onRun: () => {
      runsDone++
      ctx.report(runsDone / runsExpected)
    },
  })
  const rules = report.runs.reduce((n, r) => n + r.outcomes.length, 0)
  const failed = report.failures.length
  return result(
    c,
    key,
    report.ok,
    report.ok
      ? t('All {n} rules of the {project} contract pass ({runs} runs on its test bench).', {
          n: rules,
          project: c.project,
          runs: report.runs.length,
        })
      : t('{failed} of {n} rules of the {project} contract fail.', { failed, n: rules, project: c.project }),
    report.ok ? {} : { technical: report.failures.slice(0, 12) },
  )
}

async function evalErc(c: Extract<LessonCheck, { kind: 'erc-clean' }>, ctx: EvalContext, key: string): Promise<EvaluatedCheck> {
  const level = c.level ?? 'error'
  const s = ctx.freshSession()
  let findings: ErcFinding[]
  let telemetry: SimTelemetry
  let notes = ''
  try {
    await ctx.advanceTo(s, ERC_SETTLE_SECONDS, (f) => ctx.report(f))
    telemetry = s.co.telemetry()
    findings = runErc(ctx.layout, { telemetry, issues: s.co.issues() })
    notes = simNotes(ctx, s)
  } finally {
    s.dispose()
  }
  const bad = findings.filter((f) => ERC_LEVEL_ORDER[f.level] <= ERC_LEVEL_ORDER[level])
  const counts = { error: 0, risk: 0, info: 0 }
  for (const f of findings) counts[f.level]++
  const focus = { components: [...new Set(bad.flatMap((f) => f.componentIds))], holes: [...new Set(bad.flatMap((f) => f.holes))] }
  if (bad.length === 0) {
    return result(
      c,
      key,
      true,
      level === 'risk'
        ? t('No errors or risks ({info} notes).', { info: counts.info })
        : t('No errors ({risk} risks, {info} notes).', { risk: counts.risk, info: counts.info }),
    )
  }
  // an LED's brightness on the app's one scale (F4), from the same readings — the brightness check and the inspector's percent
  const first = bad.slice(0, 3).map((f) => tMessage(ledFindingMessage(f, telemetry)))
  return result(
    c,
    key,
    false,
    t('{n} findings: {list}', { n: bad.length, list: first.join(' ') }) + notes,
    { focus },
  )
}

// ------------------------------------------------------------- dispatcher

/** Relative cost of a check (progress weighting ≈ simulated seconds). */
export function checkWeight(c: LessonCheck): number {
  switch (c.kind) {
    case 'measure':
      return Math.min(MAX_MEASURE_SECONDS, Math.max(0.001, c.seconds ?? DEFAULT_MEASURE_SECONDS)) + (c.fresh ? 0.05 : 0)
    case 'uart-contains':
      return Math.min(MAX_UART_SECONDS, c.seconds ?? DEFAULT_UART_SECONDS)
    case 'firmware-checks':
      return 4
    case 'erc-clean':
      return ERC_SETTLE_SECONDS + 0.05
    case 'all':
      return c.checks.reduce((n, x) => n + checkWeight(x), 0) || 0.02
    default:
      return 0.02
  }
}

/**
 * Evaluate one check in `ctx` (rejects only with EvalCancelledError). Its
 * label and detail name pins the app's one way (H1, LS-13): the label is
 * generated against the evaluated circuit, Chinese words join without the
 * stray space (「LED1 陰極（短腳）與 PS1 負端」).
 */
export async function evaluateCheck(check: LessonCheck, ctx: EvalContext, key = '0'): Promise<EvaluatedCheck> {
  const r = await evaluateOne(check, ctx, key)
  return { ...r, label: checkLabel(check, ctx.layout), detail: tidyCjkSpaces(r.detail) }
}

async function evaluateOne(check: LessonCheck, ctx: EvalContext, key: string): Promise<EvaluatedCheck> {
  ctx.throwIfCancelled()
  try {
    switch (check.kind) {
      case 'has-part':
        return evalHasPart(check, ctx, key)
      case 'connected':
        return evalConnected(check, ctx, key)
      case 'not-connected':
        return evalNotConnected(check, ctx, key)
      case 'firmware-loaded':
        return await evalFirmwareLoaded(check, ctx, key)
      case 'measure':
        return await evalMeasure(check, ctx, key)
      case 'uart-contains':
        return await evalUart(check, ctx, key)
      case 'firmware-checks':
        return await evalFirmwareChecks(check, ctx, key)
      case 'erc-clean':
        return await evalErc(check, ctx, key)
      case 'all': {
        const weights = check.checks.map(checkWeight)
        const total = weights.reduce((a, b) => a + b, 0) || 1
        const children: EvaluatedCheck[] = []
        let cum = 0
        for (let i = 0; i < check.checks.length; i++) {
          const lo = cum / total
          cum += weights[i]
          children.push(await ctx.within(lo, cum / total, () => evaluateCheck(check.checks[i], ctx, `${key}.${i}`)))
        }
        const passed = children.filter((x) => x.pass).length
        const focus = {
          components: [...new Set(children.filter((x) => !x.pass).flatMap((x) => x.focus?.components ?? []))],
          holes: [...new Set(children.filter((x) => !x.pass).flatMap((x) => x.focus?.holes ?? []))],
        }
        const missing = [...new Set(children.filter((x) => !x.pass).flatMap((x) => x.missing ?? []))]
        return result(
          check,
          key,
          passed === children.length,
          t('{passed} of {n} conditions hold.', { passed, n: children.length }),
          missing.length > 0 ? { children, focus, missing } : { children, focus },
        )
      }
    }
  } catch (err) {
    if (err instanceof EvalCancelledError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    return result(check, key, false, t('This check could not be evaluated: {error}', { error: tMessage(msg) }), { error: true })
  }
}

/** Evaluate `checks` in order on one circuit (one shared simulation session). */
export async function evaluateChecks(
  input: EvalInput,
  checks: readonly LessonCheck[],
  opts: EvalOptions = {},
): Promise<EvaluatedCheck[]> {
  const ctx = new EvalContext(input, checks, opts)
  try {
    const weights = checks.map(checkWeight)
    const total = weights.reduce((a, b) => a + b, 0) || 1
    const out: EvaluatedCheck[] = []
    let cum = 0
    for (let i = 0; i < checks.length; i++) {
      ctx.beginCheck(cum / total, weights[i] / total, i, checks.length, checkLabel(checks[i], input.layout))
      out.push(await evaluateCheck(checks[i], ctx, String(i)))
      cum += weights[i]
    }
    ctx.beginCheck(1, 0, checks.length, checks.length, '')
    return out
  } finally {
    ctx.dispose()
  }
}

/** A lesson circuit (firmware by firmware/dist project name) as evaluator input. */
export async function lessonCircuitInput(circuit: LessonCircuit, assets: EvalAssets = defaultAssets): Promise<EvalInput> {
  const firmware: Record<string, FirmwareFile> = {}
  for (const [id, project] of Object.entries(circuit.firmware ?? {})) {
    const file = await assets.bundled(project)
    if (!file) throw new Error(`unknown bundled firmware "${project}"`)
    firmware[id] = file
  }
  return { layout: circuit.layout, firmware }
}

function isEvalInput(x: LessonCircuit | EvalInput): x is EvalInput {
  return Object.values(x.firmware ?? {}).every((v) => typeof v === 'object' && v !== null)
}

/** Run a lesson's acceptance checks on a circuit (a LessonCircuit or a live EvalInput). */
export async function evaluateLesson(
  lesson: Lesson,
  circuit: LessonCircuit | EvalInput,
  opts: EvalOptions = {},
): Promise<LessonEvaluation> {
  const input = isEvalInput(circuit) ? circuit : await lessonCircuitInput(circuit, opts.assets)
  const results = await evaluateChecks(input, lesson.acceptance, opts)
  return { lessonId: lesson.id, pass: results.length > 0 && results.every((r) => r.pass), results }
}

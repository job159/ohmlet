/**
 * Problems — one data source for "what is wrong / what to do next" (UX wave
 * contract K3 — IN-3 / SH-2). Feeds the status pill (WS1), the inspector's
 * problems panel (WS4, anchor #ws-problems) and the phone More sheet.
 *
 *   useProblems                zustand: { problems, counts, top, findings, live, ercError }
 *   startProblemsWatcher()     App.tsx mounts it once; returns the stop function
 *   recomputeProblems()        compute now (tests, after a manual change)
 *   deriveProblems(input)      the pure derivation (tests)
 *   openFirmwareFor(id)        the "載入韌體…" action (opens the built-in picker)
 *   focusInspector(id, opts?)  select a part and bring its inspector section up
 *   locateProblem(p)           "在電路板上標示" (scene bridge, problem layer) — also
 *                              selects the problem's part and opens its inspector
 *   <ProblemsList/>            simple list UI (ProblemsList.tsx, re-exported here)
 *
 * Contract v2 (UX helper H5):
 *  - Problem.fact: the ONE fact a row states, so the same fact never shows
 *    twice in different words. MCU rows: 'fw-missing:U1', 'power:U1',
 *    'boot0:U1', 'halt:U1', 'lockup:U1'; ERC rows: ErcFinding.fact
 *    ('power:U1', 'power:*', 'burned:LED1', 'overcurrent:U1:PA5',
 *    'overcurrent-supply:PS1', 'reversed:LED1', 'gpio-clock:U1:GPIOA');
 *    simulator rows: SIM_ISSUE_FACTS. Rows with one fact merge into one —
 *    the one with an action wins (mcu > erc > sim), parts / holes / wires
 *    are merged (IN-13).
 *  - Problem.pendingRuntime: a static finding only the firmware's pin set-up
 *    can confirm or clear, while the board's firmware has not run yet —
 *    level 'info', shown under 「執行後確認」 (IN-16).
 *  - Problem.affects / Problem.folded: findings with one cause fold into one
 *    row (「1 個原因 · 影響 2 處」); readings that cannot be trusted (the
 *    solver did not converge, a board without GND) and consequences of a
 *    board-state fact (「連帶影響（先解決：…）」) fold under their root (IN-14 /
 *    IN-15) and are listed under 「詳細」 with their values as 「—」.
 *  - ProblemsState.layout: the layout the list was computed for (null before
 *    the first run); ProblemsState.resolved: static risks the live readings
 *    cleared plus transient simulator warnings the live readings retracted
 *    (a CMOS input that floated while the MCU was in reset — IN-16).
 *  - boardBlocker(id) / useBoardBlocker(id): why a board produces nothing —
 *    power → firmware → lockup → halt → BOOT0.
 *
 * Sources, merged and sorted error → warning → info (ERC rule order inside
 * the ERC block, then simulator issues, then MCU states):
 *  - ERC  — runErc(layout, { telemetry, issues, mcuResetAt, mcuResetPc,
 *           unclockedPorts }) — the live rules know each board's last reset
 *           (IN-15): error→error, risk→warning, info→info;
 *  - sim  — the simulator's issues (title = the first clause of the message)
 *           and the peripheral warnings of the simulation log that are user
 *           mistakes (TIM1 MOE = 0, a clock left off, a clock above its
 *           limit, two alternate functions on one pin — IN-15);
 *  - mcu  — per MCU board in the layout: no firmware bound (warning, action
 *           載入韌體…), debugger halt (warning, 繼續執行 → runOrResume), lockup
 *           (error), system-memory boot (BOOT0 = 1, warning) and — while the
 *           simulation has run — an unpowered board the ERC did not already
 *           explain.
 *
 * Rate: the watcher recomputes 250 ms after the last layout / firmware /
 * run-state change (debounce) and at most once per second for live data
 * (telemetry, issues, MCU frames, the log) — never per frame; a result equal
 * to the previous one is not re-published (stable identities, no re-render).
 * A board whose layout appeared < 1 s ago is not yet reported as "no
 * firmware" (examples and lessons bind firmware right after the layout
 * loads), so the pill does not flash amber on every example open.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import type { CircuitLayout, SimIssue, SimTelemetry } from '../../model/types'
import { getEntry, type CatalogEntry } from '../../model/catalog'
import { componentPinHoles, formatHole } from '../../model/breadboard'
import { boardConfigOf } from '../../model/types'
import { pinLabel } from '../../i18n/parts'
import type { McuFrameInfo, SimLogEntry } from '../../sim/coordinator/api'
import { buildNetlist, type Netlist } from '../../sim/netlist'
import { firmwareModesSettled, inSystemMemory, MODE_SETTLE_S, runErc, type ErcFinding } from '../../sim/erc'
import { pinDamageFromIssues } from '../../sim/erc/rules-damage'
import { ledFindingMessage } from '../../instruments/led-light'
import type { FirmwareRecord } from '../../state/lab-types'
import { canSwapLeads, useStore } from '../../state/store'
import { onLangChange, t } from '../../i18n'
import { tMessage } from '../../i18n/messages'
import { isLegacyChrome, isWorkspaceShowing } from '../chrome/legacy'
import { showInstrument } from '../chrome/instrument-sheet'
import { runOrResume } from '../chrome/run-control'
import { focusInScene } from '../workspace/scene-bridge'
import { showToast, tick } from '../kit'
import { activePinFunction, pinFunctionContext } from './instruments/pin-function'
import { hasActivity } from './instruments/net-activity'
import { POWER_UP_GRACE_S, faultExceptionName, faultHandlerDetail, frameFaultOf, lockupCauseOf, lockupCauseText } from './format'
import { labBuffers, useLab } from './lab'

export { ProblemsList, ProblemsView, type ProblemsListProps } from './ProblemsList'

export type ProblemLevel = 'error' | 'warning' | 'info'
export type ProblemSource = 'erc' | 'sim' | 'mcu'

export interface ProblemAction {
  /** button text, UI language, verb first (「載入韌體…」) */
  label: string
  run(): void
}

/** Rows folded under a root row (IN-14 / IN-15): a heading and the folded rows' texts. */
export interface ProblemFold {
  /** 「連帶影響（先解決：U1 從系統記憶體開機）」, 「已隱藏的腳位讀數」 */
  head: string
  /** one line per folded row; readings show 「—」 instead of their value */
  items: string[]
}

export interface Problem {
  /** stable id (React key, dedupe): 'erc:<finding id>' / 'sim:…' / 'mcu:<kind>:<id>' / 'log:…' */
  id: string
  level: ProblemLevel
  source: ProblemSource
  /** short headline in the UI language (≈ ≤ 22 CJK characters) */
  title: string
  /** full explanation: cause + fix, UI language */
  detail: string
  /** parts involved (select / locate them); the subject first */
  componentIds: string[]
  /** hole / terminal refs involved ("a38", "PS1:+") */
  holes: string[]
  /** the one-click fix, when there is one */
  action?: ProblemAction
  /** wires on the offending path (ERC supply shorts) — locate them too */
  wireIds?: string[]
  /** ERC rule id (source 'erc') */
  rule?: string
  /** datasheet / model reference (ErcFinding.ref), UI language — shown under 「詳細」 */
  ref?: string
  /** common-cause key (ErcFinding.group) — rows of one group are already folded into one */
  group?: string
  /**
   * The ONE fact this row states (problems contract v2 — UX helper H5), so
   * the same fact never shows twice in different words: MCU state rows carry
   * 'fw-missing:<id>', 'power:<id>', 'boot0:<id>', 'halt:<id>',
   * 'lockup:<id>'; ERC / simulator rows 'power:*', 'overcurrent:<id>:<pin>',
   * 'overcurrent-supply:<id>', 'burned:<id>', 'reversed:<id>',
   * 'float:<id>:<pin>', 'gpio-clock:<id>:<port>', 'tim-moe:<id>:<tim>' …
   */
  fact?: string
  /**
   * A static finding that only the firmware's pin setup can confirm or clear
   * (IN-16): shown under 「執行後確認」 before the board's firmware has run, at
   * level 'info' (the pill ignores it).
   */
  pendingRuntime?: boolean
  /** this row folds findings with one cause: the number of places it affects (≥ 2) */
  affects?: number
  /** rows folded under this one (IN-14 readings, IN-15 consequences) */
  folded?: ProblemFold
  /** a caption under the headline (a retracted transient warning says what happened) */
  note?: string
  /**
   * where the fix goes (ErcFinding.fixHoles — the nearest − rail hole beside
   * an open LED cathode): 「在電路板上標示」 frames these with the problem,
   * unmarked, so both ends of the missing wire are in view
   */
  fixHoles?: string[]
  /**
   * A STATE the board is in, not a risk (QA IN-F3): the debugger halt. Not
   * counted (ProblemsState.counts), listed first under 「目前狀態」 with the
   * state's own dot colour (H6) and no level.
   */
  state?: boolean
  /** further one-click ways out after `action` (a fault handler: 「在模擬日誌中檢視」) */
  extraActions?: ProblemAction[]
}

/** The board-state facts a board can be blocked by, most fundamental first. */
export type BoardBlockerKind = 'power' | 'fw-missing' | 'lockup' | 'halt' | 'boot0'

/**
 * Why a board produces no signal right now (UX helper H5 — boardBlocker):
 * the kind of fact, the board, and the problem row that states it (its
 * action is the fix: 載入韌體… / 繼續執行 / 在電路板上標示).
 */
export interface BoardBlocker {
  kind: BoardBlockerKind
  componentId: string
  problem: Problem
}

export interface ProblemCounts {
  error: number
  warning: number
  info: number
}

export interface ProblemsState {
  /** sorted error → warning → info; one row per fact and per common cause */
  problems: Problem[]
  counts: ProblemCounts
  /** the most important error or warning (null when there is none — info never tops) */
  top: Problem | null
  /** the raw ERC findings of the last run (the ERC panel's details) */
  findings: ErcFinding[]
  /** the last run used live telemetry */
  live: boolean
  /** the rule check threw on this layout (message, untranslated) */
  ercError: string | null
  /**
   * static ERC errors / risks that the live readings cleared (e.g. a
   * floating input the running firmware pulls up) and simulator warnings
   * the live readings retracted (a CMOS input that only floated while the
   * MCU was in reset) — the panel's collapsed 「已由即時讀數排除」 group
   */
  resolved: Problem[]
  /**
   * The layout (identity) this list was computed for (contract v2 — H5);
   * null before the first run. A consumer that must not speak for a
   * circuit the list has not seen yet (the pill's 「電路已就緒」, SH-13)
   * compares it with useStore.getState().layout.
   */
  layout: CircuitLayout | null
}

const EMPTY: ProblemsState = {
  problems: [],
  counts: { error: 0, warning: 0, info: 0 },
  top: null,
  findings: [],
  live: false,
  ercError: null,
  resolved: [],
  layout: null,
}

export const useProblems = create<ProblemsState>()(() => ({ ...EMPTY }))

/** Anchor id of the problems panel (WS4 ErcPanel root) — the pill scrolls to it. */
export const PROBLEMS_ANCHOR_ID = 'ws-problems'

// ---------------------------------------------------------------------------
// inspector focus
// ---------------------------------------------------------------------------

export type InspectorTab = 'overview' | 'pins' | 'firmware' | 'peripherals'

export interface InspectorFocusRequest {
  componentId: string
  tab?: InspectorTab
  pin?: string
  /** bumps on every request (consumers apply each seq once) */
  seq: number
}

/**
 * The latest focusInspector request. The MCU inspector (WS4, IN-6) applies
 * each new `seq` once: switch to `tab`, scroll to / flash `pin`.
 */
export const useInspectorFocus = create<{ request: InspectorFocusRequest | null }>(() => ({ request: null }))

function afterLayout(run: () => void): void {
  if (typeof requestAnimationFrame !== 'function') return
  requestAnimationFrame(() => requestAnimationFrame(run))
}

function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Select `componentId` and bring its inspector up: the workspace opens its
 * right panel (phones present the Properties sheet for the selection), the
 * request is published for the MCU panel's tabs (useInspectorFocus), and
 * after layout the section scrolls into view when its anchor exists —
 * `#fw-{id}` (firmware card), `#pin-{id}-{pin}` (pin row), `#insp-{id}`.
 */
export function focusInspector(componentId: string, opts: { tab?: InspectorTab; pin?: string } = {}): void {
  const st = useStore.getState()
  if (!st.layout.components.some((c) => c.id === componentId)) return
  st.select(componentId)
  if (isWorkspaceShowing()) {
    const lab = useLab.getState()
    lab.setWorkspace({ right: { ...lab.workspace.right, open: true } })
  }
  const prev = useInspectorFocus.getState().request
  const request: InspectorFocusRequest = { componentId, seq: (prev?.seq ?? 0) + 1 }
  if (opts.tab) request.tab = opts.tab
  if (opts.pin) request.pin = opts.pin
  useInspectorFocus.setState({ request })
  afterLayout(() => {
    if (typeof document === 'undefined') return
    const id = opts.pin ? `pin-${componentId}-${opts.pin}` : opts.tab === 'firmware' ? `fw-${componentId}` : `insp-${componentId}`
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
  })
}

// ---------------------------------------------------------------------------
// "nothing has run since the last reset" (IN-2): a re-flash or a Reset MCU
// while the simulation is paused leaves the board's last frame in the lab
// store until the next frame arrives — that frame describes the OLD run
// (its PC, its symbol, its lockup) and must not be shown as the board's state
// ---------------------------------------------------------------------------

/** board id → the newest frame it had when it was last reset / re-flashed (a store: the MCU panel re-renders on a mark) */
const useResetMarks = create<{ marks: Record<string, McuFrameInfo> }>(() => ({ marks: {} }))
let resetTracking = false

function markReset(componentId: string, frame: McuFrameInfo | undefined): void {
  if (!frame) return
  useResetMarks.setState((s) => ({ marks: { ...s.marks, [componentId]: frame } }))
}

/** Remember that `componentId` was just reset (Reset MCU): its current frame is history. */
export function noteMcuReset(componentId: string): void {
  markReset(componentId, useLab.getState().mcus[componentId])
}

/** Every firmware (re)binding resets the board: track it once, for the app's lifetime. */
export function trackMcuResets(): void {
  if (resetTracking) return
  resetTracking = true
  useLab.subscribe((s, prev) => {
    if (s.firmware === prev.firmware) return
    for (const id of new Set([...Object.keys(s.firmware), ...Object.keys(prev.firmware)])) {
      if (s.firmware[id] !== prev.firmware[id]) markReset(id, prev.mcus[id] ?? s.mcus[id])
    }
  })
}

/** `frame` when it was produced after the board's last reset, else undefined (nothing ran since). */
export function frameSinceReset(componentId: string, frame: McuFrameInfo | undefined): McuFrameInfo | undefined {
  return frame && useResetMarks.getState().marks[componentId] === frame ? undefined : frame
}

/** frameSinceReset as a hook (re-renders when the board is reset). */
export function useFrameSinceReset(componentId: string, frame: McuFrameInfo | undefined): McuFrameInfo | undefined {
  const mark = useResetMarks((s) => s.marks[componentId])
  return frame && mark === frame ? undefined : frame
}

/** The lab's MCU frames without the ones that predate their board's last reset. */
function currentFrames(mcus: Record<string, McuFrameInfo>): Record<string, McuFrameInfo> {
  const marks = useResetMarks.getState().marks
  if (Object.keys(marks).length === 0) return mcus
  let out: Record<string, McuFrameInfo> | null = null
  for (const [id, f] of Object.entries(mcus)) {
    if (marks[id] !== f) continue
    out ??= { ...mcus }
    delete out[id]
  }
  return out ?? mcus
}

// ---------------------------------------------------------------------------
// the built-in firmware picker, opened from anywhere (IN-19 (4))
// ---------------------------------------------------------------------------

export interface FirmwarePickerRequest {
  componentId: string
  /** the element the picker anchors to (the button that asked), when still in the page */
  anchor: HTMLElement | null
  /** bumps on every request (the MCU status card opens the picker once per seq) */
  seq: number
}

/**
 * The latest "open the built-in firmware picker for this board" request:
 * the MCU status card (McuPanel FirmwareSummary) of that board opens
 * BundledFirmwarePicker for each new seq — anchored to `anchor` on desktop,
 * as a sheet on touch screens — with the search field focused.
 */
export const useFirmwarePickerRequest = create<{ request: FirmwarePickerRequest | null }>(() => ({ request: null }))

/**
 * "載入韌體…": select the board (its inspector opens) and open the built-in
 * firmware picker right away — 本課使用 / 範例韌體 first, focus in the search
 * field. The picker anchors to the element that had focus when the action
 * ran (the button the user pressed), else to the board's firmware row.
 */
export function openFirmwareFor(componentId: string): void {
  const active = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null
  const anchor = active && active !== document.body ? active : null
  focusInspector(componentId)
  const prev = useFirmwarePickerRequest.getState().request
  useFirmwarePickerRequest.setState({ request: { componentId, anchor, seq: (prev?.seq ?? 0) + 1 } })
}

// ---------------------------------------------------------------------------
// where a problem is
// ---------------------------------------------------------------------------

/** hole / terminal ref → the part pin sitting there, per layout identity */
let holeIndexCache: { layout: CircuitLayout; index: Map<string, { id: string; pin: string }> } | null = null
function holeIndex(layout: CircuitLayout): Map<string, { id: string; pin: string }> {
  if (holeIndexCache?.layout === layout) return holeIndexCache.index
  const index = new Map<string, { id: string; pin: string }>()
  const board = boardConfigOf(layout)
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry) continue
    if (entry.placement === 'offboard') {
      for (const pin of entry.pins) index.set(`${comp.id}:${pin}`, { id: comp.id, pin })
      continue
    }
    const holes = componentPinHoles(comp, entry, board)
    holes?.forEach((h, i) => {
      if (h) index.set(formatHole(h), { id: comp.id, pin: entry.pins[i] })
    })
  }
  holeIndexCache = { layout, index }
  return index
}

/** The pins of `componentId` a problem names (through its holes). */
function problemPins(p: Problem, layout: CircuitLayout, componentId: string): string[] {
  const index = holeIndex(layout)
  const out: string[] = []
  for (const h of p.holes) {
    const at = index.get(h)
    if (at && at.id === componentId && !out.includes(at.pin)) out.push(at.pin)
  }
  return out
}

/** One place a problem is: a part (with the pins it names) or a wire — a chip the user can press (IN-19). */
export type ProblemWhereItem =
  | { kind: 'part'; id: string; pins: string[]; text: string; title: string }
  | { kind: 'wire'; id: string; text: string; title: string }
  | { kind: 'more'; text: string; title: string }

/**
 * Where a problem is, as a person reads it (IN-19 / IN-20): parts first with
 * the pins the problem names, in the short pin form of UX helper H1 —
 * 「U1 PA5」, 「D1 陰極」, 「U1 PB6/PB7」 (the full form 「U1 PA5（板上 A5）」 as
 * the title) — then wires 「導線 W1」. At most four parts.
 */
export function problemWhereItems(p: Problem, layout: CircuitLayout): ProblemWhereItem[] {
  const items: ProblemWhereItem[] = []
  for (const id of p.componentIds.slice(0, 4)) {
    const comp = layout.components.find((c) => c.id === id)
    const entry = comp ? getEntry(comp.type) : undefined
    const pins = entry ? problemPins(p, layout, id) : []
    if (!entry || pins.length === 0 || (!entry.mcu && (pins.length > 1 || entry.pins.length > 3))) {
      items.push({ kind: 'part', id, pins: entry && entry.mcu ? pins.slice(0, 1) : [], text: id, title: id })
      continue
    }
    const short = [...new Set(pins.map((pin) => pinLabel(entry, pin, { form: 'short' })))]
    const full = [...new Set(pins.map((pin) => pinLabel(entry, pin, { id })))]
    items.push({ kind: 'part', id, pins, text: `${id} ${short.join('/')}`, title: full.join(t(', ')) })
  }
  if (p.componentIds.length > 4) items.push({ kind: 'more', text: '…', title: p.componentIds.slice(4).join(t(', ')) })
  for (const w of p.wireIds ?? []) {
    const text = t('Wire {id}', { id: w })
    items.push({ kind: 'wire', id: w, text, title: text })
  }
  return items
}

/** problemWhereItems as one line: 「U1 PB12、SW1」, 「LED1 陰極」, 「導線 W1」. */
export function problemWhere(p: Problem, layout: CircuitLayout): string {
  return problemWhereItems(p, layout)
    .map((i) => i.text)
    .join(t(', '))
}

/**
 * The part a problem is about and the pin of it the problem names (its
 * subject: the first component — the rules list it first), or null.
 */
export function problemSubject(p: Problem, layout: CircuitLayout): { id: string; pin?: string } | null {
  const id = p.componentIds.find((c) => layout.components.some((x) => x.id === c))
  if (!id) return null
  const pin = problemPins(p, layout, id)[0]
  return pin ? { id, pin } : { id }
}

/** The camera span (hole pitches) when a problem is shown with its fix target (H7 includeHoles). */
const FIX_FRAME_SPAN = 12

/**
 * "在電路板上標示": frame the problem's parts / holes / wires and mark them
 * (6 s; 'info' in blue on scenes that draw it — UX helper H7) — with the
 * place the fix goes (Problem.fixHoles) kept in the frame, unmarked — and
 * select the problem's subject so the inspector shows it, scrolled to the
 * pin the problem names (IN-19).
 */
export function locateProblem(p: Problem): boolean {
  const spec = { components: [...p.componentIds, ...(p.wireIds ?? [])], holes: p.holes }
  const level = p.level === 'error' ? 'error' : p.level === 'warning' ? 'risk' : 'info'
  // the fix target (the − rail hole beside an open lead) stays in the frame, unmarked, a little wider than one strip
  const fix = p.fixHoles?.filter((h) => !p.holes.includes(h)) ?? []
  const shown = focusInScene(spec, fix.length > 0 ? { kind: 'problem', level, includeHoles: fix, minSpanHoles: FIX_FRAME_SPAN } : { kind: 'problem', level })
  const layout = useStore.getState().layout
  const subject = problemSubject(p, layout)
  if (subject) {
    const entry = getEntry(layout.components.find((c) => c.id === subject.id)?.type ?? '')
    // MCU rows scroll to their pin row (#pin-U1-PA5); other parts open at their header
    focusInspector(subject.id, entry?.mcu && subject.pin ? { pin: subject.pin } : {})
  }
  return shown
}

// ---------------------------------------------------------------------------
// derivation (pure)
// ---------------------------------------------------------------------------

export interface ProblemsInput {
  layout: CircuitLayout
  findings: readonly ErcFinding[]
  issues: readonly SimIssue[]
  firmware: Record<string, FirmwareRecord>
  mcus: Record<string, McuFrameInfo>
  running: boolean
  simTime: number
  /** boards that appeared too recently to be called "without firmware" */
  firmwareGrace?: ReadonlySet<string>
  /**
   * boards whose firmware has not configured its pins yet (bound but not run,
   * or run less than the settle time since its reset): their firmware-
   * dependent static findings are 「執行後確認」 (IN-16)
   */
  pendingBoards?: ReadonlySet<string>
  /** the simulation log since the last reset (peripheral warnings worth a row — IN-15) */
  log?: readonly SimLogEntry[]
  /** board id → sim time of its last firmware load (older log entries describe another image) */
  loadedAt?: Readonly<Record<string, number>>
  /** latest telemetry (pin modes for the log rows' pins) */
  telemetry?: SimTelemetry | null
  /**
   * simulator warnings the live readings retracted (IN-16): fact
   * ('float:U2:SRCLK') → the note that replaces the warning
   */
  cleared?: ReadonlyMap<string, string>
}

const LEVEL_ORDER: Record<ProblemLevel, number> = { error: 0, warning: 1, info: 2 }
const SOURCE_ORDER: Record<ProblemSource, number> = { erc: 0, sim: 1, mcu: 2 }
/** Which of two rows with one fact is kept (it has the action, or comes from here): mcu > erc > sim. */
const KEEP_ORDER: Record<ProblemSource, number> = { mcu: 0, erc: 1, sim: 2 }

/** MCU row kind (its id 'mcu:<kind>:<board>') → its fact prefix (Problem.fact). */
const MCU_FACT: Record<string, BoardBlockerKind> = {
  'no-firmware': 'fw-missing',
  unpowered: 'power',
  'boot-sysmem': 'boot0',
  halted: 'halt',
  lockup: 'lockup',
  // a core stuck in its own fault handler blocks the board like a lockup (IN-F7)
  'fault-handler': 'lockup',
}

const BLOCKER_ORDER: readonly BoardBlockerKind[] = ['power', 'fw-missing', 'lockup', 'halt', 'boot0']
const BLOCKER_FACT = /^(power|fw-missing|lockup|halt|boot0):(.+)$/

/**
 * The board-state fact `p` states about board `componentId`, if any:
 * Problem.fact first ('power:U1'; '*' = every board), then the rows that
 * predate facts — an ERC power error naming the board ('unpowered' /
 * 'ground-reference'; the circuit-wide "no power source" lists every
 * consumer), a simulator 'unpowered' / 'no ground' / 'no power supply' /
 * 'no firmware loaded' issue.
 */
export function blockerKindOf(p: Problem, componentId: string): BoardBlockerKind | null {
  const m = p.fact ? BLOCKER_FACT.exec(p.fact) : null
  if (m) return m[2] === componentId || m[2] === '*' ? (m[1] as BoardBlockerKind) : null
  if (p.fact) return null
  const names = p.componentIds.includes(componentId)
  if (p.source === 'erc') {
    if (p.level !== 'error' || (p.rule !== 'unpowered' && p.rule !== 'ground-reference')) return null
    // the finding's subject (its id 'erc:<rule>:<key>'): the board itself, or
    // the circuit-wide "no power source" that lists every consumer (a part
    // merely fed THROUGH the board's regulator does not make the board unpowered)
    const subject = p.id.slice(`erc:${p.rule}:`.length)
    return subject === componentId || (subject === 'no-source' && (names || p.componentIds.length === 0)) ? 'power' : null
  }
  if (p.source === 'sim') {
    // the simulator's English source survives in the row id ('sim:<component>:<message>')
    const message = p.id.slice(p.id.indexOf(':', 4) + 1)
    if (/^no (ground|power supply)\b/i.test(message)) return 'power'
    if (!names) return null
    if (/\bunpowered\b/i.test(message)) return 'power'
    if (/no firmware loaded/i.test(message)) return 'fw-missing'
  }
  return null
}

/**
 * The most fundamental reason board `componentId` produces nothing right
 * now (UX helper H5), in this order: no power (an ERC power error, the MCU
 * 'unpowered' row, the simulator's unpowered / no-ground issue) → no
 * firmware → lockup → debugger halt → system-memory boot (BOOT0 = 1).
 * null = nothing blocks it. Consumers (the LA empty note, the UART status
 * line, the scope readout — IS-14) lead with it before any generic hint.
 */
export function boardBlocker(componentId: string, problems: readonly Problem[] = useProblems.getState().problems): BoardBlocker | null {
  let best: BoardBlocker | null = null
  for (const p of problems) {
    const kind = blockerKindOf(p, componentId)
    if (!kind) continue
    if (!best || BLOCKER_ORDER.indexOf(kind) < BLOCKER_ORDER.indexOf(best.kind)) best = { kind, componentId, problem: p }
  }
  return best
}

/**
 * boardBlocker as a hook (re-renders when the blocking row changes —
 * at the problems' own ≤ 1 Hz rate). null id = no board. The result keeps
 * its identity while the blocking row is the same (safe in effect deps).
 */
export function useBoardBlocker(componentId: string | null): BoardBlocker | null {
  const problem = useProblems((s) => (componentId ? boardBlocker(componentId, s.problems)?.problem ?? null : null))
  return useMemo(() => {
    if (!componentId || !problem) return null
    const kind = blockerKindOf(problem, componentId)
    return kind ? { kind, componentId, problem } : null
  }, [componentId, problem])
}

/**
 * The headline of a long message: its first clause (before 「——」「：」「。」 /
 * " — " ": " ". "). A leading part id (「U1：…」) or part pin (「U1 PA5：…」)
 * is not a headline on its own: it stays with the next clause.
 */
export function problemTitle(message: string): string {
  const s = message.trim()
  const lead = /^([A-Za-z]+\d+\w*(?: P[A-E]\d{1,2})?)(?:：|: )(.+)$/s.exec(s)
  if (lead) return `${lead[1]} ${problemTitle(lead[2])}`
  const m = /^(.+?)(?:——|—| — |：|。|: |\. )/.exec(s)
  const head = (m ? m[1] : s).trim()
  return head.length > 40 ? `${head.slice(0, 39)}…` : head
}

/**
 * One headline for headlines that differ in a single word — 「I²C1 SCL 沒有上拉電阻」 +
 * 「I²C1 SDA 沒有上拉電阻」 → 「I²C1 SCL、SDA 沒有上拉電阻」; otherwise the first one.
 */
export function mergeTitles(titles: readonly string[]): string {
  const split = titles.map((s) => s.split(' '))
  const n = split[0].length
  if (titles.length < 2 || split.some((w) => w.length !== n)) return titles[0]
  const differing = split[0].map((_, i) => new Set(split.map((w) => w[i])).size > 1)
  if (differing.filter(Boolean).length !== 1) return titles[0]
  const at = differing.indexOf(true)
  const words = [...new Set(split.map((w) => w[at]))]
  return [...split[0].slice(0, at), words.join(t(', ')), ...split[0].slice(at + 1)].join(' ')
}

/** ErcFinding.short (the rule's short headline), else the first clause of the message. */
function ercTitle(f: ErcFinding): string {
  return f.short ? tMessage(f.short) : problemTitle(tMessage(f.message))
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A finding's raw catalog pin names in readable words (IN-20): 「3V3_1」 →
 * 「3V3（板上 3.3）」, 「GND1」 → 「GND（板上 G）」 — the full form in the
 * explanation, the short form (「3V3」, 「GND」) in the headline. Pins whose
 * short name is the catalog name (PA5, VCC) are left as written.
 */
function readablePins(text: string, f: ErcFinding, layout: CircuitLayout | undefined, form: 'full' | 'short'): string {
  if (!f.pins || !layout) return text
  let out = text
  for (const { id, pin } of f.pins) {
    const type = layout.components.find((c) => c.id === id)?.type
    const entry = type ? getEntry(type) : undefined
    if (!entry) continue
    const short = pinLabel(entry, pin, { form: 'short' })
    if (short === pin) continue
    const name = form === 'short' ? short : pinLabel(entry, pin)
    // 「3V3（板上 3.3）與」: no space after a closing full-width parenthesis before Chinese text
    out = out.replace(new RegExp(`(?<![\\w.])${escapeRe(pin)}(?![\\w（(])( (?=[^\\x00-\\x7f]))?`, 'g'), (_m, sp: string | undefined) =>
      sp && name.endsWith('）') ? name : `${name}${sp ?? ''}`,
    )
  }
  return out
}

/** 「PS1 正端（5.00 V） 與」 → 「PS1 正端（5.00 V）與」: no space between a full-width 「）」 and the Chinese text after it. */
function tidyCjk(text: string): string {
  return text.replace(/）[ \t]+(?=[\u3400-\u9fff])/g, '）')
}

/** One ERC finding as a problem (error→error, risk→warning, info→info). */
export function ercProblem(f: ErcFinding, layout?: CircuitLayout, telemetry?: SimTelemetry | null): Problem {
  const p: Problem = {
    id: `erc:${f.id}`,
    level: f.level === 'error' ? 'error' : f.level === 'risk' ? 'warning' : 'info',
    source: 'erc',
    title: tidyCjk(readablePins(ercTitle(f), f, layout, 'short')),
    // an LED's brightness on the app's one scale (F4), the inspector's percent
    detail: tidyCjk(readablePins(tMessage(ledFindingMessage(f, telemetry)), f, layout, 'full')),
    componentIds: [...f.componentIds],
    holes: [...f.holes],
    rule: f.rule,
  }
  if (f.wireIds && f.wireIds.length > 0) p.wireIds = [...f.wireIds]
  if (f.ref) p.ref = tMessage(f.ref)
  if (f.group) p.group = f.group
  if (f.fact) p.fact = f.fact
  if (f.fixHoles && f.fixHoles.length > 0) p.fixHoles = [...f.fixHoles]
  return p
}

/**
 * Static errors / risks the live readings cleared: findings of the static
 * run (no telemetry) whose id the live run no longer reports.
 */
export function resolvedByLive(staticFindings: readonly ErcFinding[], liveFindings: readonly ErcFinding[], layout?: CircuitLayout): Problem[] {
  const now = new Set(liveFindings.map((f) => f.id))
  return staticFindings.filter((f) => f.level !== 'info' && !now.has(f.id)).map((f) => ercProblem(f, layout))
}

/** A simulator issue → the fact it states (one row per fact, IN-13). */
const SIM_ISSUE_FACTS: readonly [RegExp, (m: RegExpExecArray, id: string | null) => string | null][] = [
  [/no firmware loaded/, (_m, id) => (id ? `fw-missing:${id}` : null)],
  [/BOOT0 = 1 selects/, (_m, id) => (id ? `boot0:${id}` : null)],
  [/\bMCU unpowered\b/, (_m, id) => (id ? `power:${id}` : null)],
  [/^no (ground|power supply)\b/, () => 'power:*'],
  [/^(\S+) (\S+): driver (?:sources|sinks) [\d.]+ mA/, (m) => `overcurrent:${m[1]}:${m[2]}`],
  [/^LED (\S+) burned out/, (m) => `burned:${m[1]}`],
  // vivid damage facts: a resistor's thermal model burned it open, an electrolytic vented,
  // a board pin measured beyond its absolute maximum (one row with the ERC's finding of it)
  [/^(\S+) burned open \(/, (m) => `burned:${m[1]}`],
  [/^(\S+) vented: /, (m) => `vented:${m[1]}`],
  [/^(\S+) (\S+): -?[\d.]+ V (?:exceeds |is below VSS − 0\.3 V)/, (m) => `absmax:${m[1]}:${m[2]}`],
  [/^supply (\S+) current > 2A/, (m) => `overcurrent-supply:${m[1]}`],
  // a CMOS input of a part (74HC595, a display driver) left floating (IN-16)
  [/^.+? input (\S+) is floating \(CMOS inputs must be driven\)/, (m, id) => (id ? `float:${id}:${m[1]}` : null)],
  // an MCU pin left a floating input with something on its net (mcu-board.ts — QA IN-F2)
  [/^(\S+) (\S+): floating input — nothing drives its net/, (m) => `float:${m[1]}:${m[2]}`],
]

/** The fact of a simulator issue (the part: the issue's own, else the message's leading id). */
export function simIssueFact(issue: SimIssue): string | null {
  const id = issue.componentId ?? /^([A-Za-z]+\d+\w*)[: ]/.exec(issue.message)?.[1] ?? null
  for (const [re, fact] of SIM_ISSUE_FACTS) {
    const m = re.exec(issue.message)
    if (m) return fact(m, id)
  }
  return null
}

/** A pin reading the solver produced (IN-14): 'U1 PB12: -1261957.64 V is below VSS − 0.3 V' → the board. */
const PIN_READING = /^(\S+) (\S+): -?[\d.]+ V (?:is below VSS − 0\.3 V|exceeds )/
/** The solver could not solve this circuit (its readings cannot be trusted). */
const SOLVER_TROUBLE = /^(solver failed to converge|numerical error in solver)/

/** 「U1 PB12：-1261957.64 V 低於 VSS − 0.3 V」 → 「U1 PB12：— 低於 VSS − 0.3 V」 (the first value only). */
function withoutValue(text: string): string {
  return text.replace(/[-−]?\d[\d.,]*\s?(?:[kmµ]?V)(?![A-Za-z])/, '—')
}

/**
 * Findings that read the firmware's pin modes (or depend on what the firmware
 * will do): those ERC rules, and the simulator's 「U1 PA5：浮接輸入」 of the
 * board's own pins — a board that runs no firmware leaves every pin an input
 * (QA IN-F2).
 */
function firmwareDependent(p: Problem, board: string): boolean {
  if (p.source === 'sim') return !!p.fact?.startsWith(`float:${board}:`)
  if (p.source !== 'erc' || !p.componentIds.includes(board)) return false
  if (p.rule === 'gpio-mode') return true
  if (p.level === 'error') return false // certain from the wiring alone
  return p.rule === 'floating-input' || p.rule === 'i2c-pullup' || p.rule === 'logic-level'
}

/** 「U1 從系統記憶體開機（未模擬）」 → 「U1 從系統記憶體開機」 (a heading quotes the fact, not its aside). */
function bareTitle(title: string): string {
  return title.replace(/（[^（）]*）$/, '').replace(/ \([^()]*\)$/, '')
}

/** Merge `from` into `into` (the kept row): parts, holes, wires, the more severe level. */
function absorb(into: Problem, from: Problem): void {
  const uniq = (xs: readonly string[]) => [...new Set(xs)]
  into.componentIds = uniq([...into.componentIds, ...from.componentIds])
  into.holes = uniq([...into.holes, ...from.holes])
  const wires = uniq([...(into.wireIds ?? []), ...(from.wireIds ?? [])])
  if (wires.length > 0) into.wireIds = wires
  const fix = uniq([...(into.fixHoles ?? []), ...(from.fixHoles ?? [])])
  if (fix.length > 0) into.fixHoles = fix
  if (LEVEL_ORDER[from.level] < LEVEL_ORDER[into.level]) into.level = from.level
}

/** Two sentences of one explanation: no space after Chinese punctuation (「…。因為…」), one after English. */
function appendSentence(text: string, more: string): string {
  return /[。！？）」]$/.test(text) ? `${text}${more}` : `${text} ${more}`
}

/** Add folded rows under `root` (one heading per root; later folds append). */
function fold(root: Problem, head: string, items: readonly string[]): void {
  if (items.length === 0) return
  root.folded = root.folded ? { head: root.folded.head, items: [...root.folded.items, ...items] } : { head, items: [...items] }
}

/**
 * The pure derivation behind useProblems (UI language of the moment):
 * the rows, plus the simulator warnings the live readings retracted.
 */
export function deriveProblemsDetailed(input: ProblemsInput): { problems: Problem[]; cleared: Problem[] } {
  const layout = input.layout
  const out: Problem[] = []
  for (const f of input.findings) out.push(ercProblem(f, layout, input.telemetry))

  const powerErc = input.findings.some((f) => (f.rule === 'unpowered' || f.rule === 'ground-reference') && f.level === 'error')
  // the raw message of each simulator row (folding reads it)
  const simMessage = new Map<Problem, string>()
  for (const issue of input.issues) {
    const detail = tMessage(issue.message)
    const p: Problem = {
      id: `sim:${issue.componentId ?? ''}:${issue.message}`,
      level: issue.level === 'error' ? 'error' : 'warning',
      source: 'sim',
      title: problemTitle(detail),
      detail,
      componentIds: issue.componentId ? [issue.componentId] : [],
      holes: [],
    }
    const fact = simIssueFact(issue)
    if (fact) p.fact = fact
    // "no ground" / "no power supply" while an ERC power error explains the circuit: the same cause
    if (powerErc && /^no (ground|power supply)\b/i.test(issue.message)) p.fact = 'power:*'
    simMessage.set(p, issue.message)
    out.push(p)
  }

  out.push(...logProblems(input))

  const unpoweredByErc = new Set(
    input.findings.filter((f) => f.rule === 'unpowered' || f.rule === 'ground-reference').flatMap((f) => f.componentIds),
  )
  const anyUnpoweredErc = input.findings.some((f) => f.rule === 'unpowered' && f.componentIds.length === 0)
  for (const comp of layout.components) {
    const entry = getEntry(comp.type)
    if (!entry?.mcu) continue
    const id = comp.id
    const frame = input.mcus[id]
    const mcu = (kind: string, level: ProblemLevel, title: string, detail: string, action?: ProblemAction): Problem => {
      const p: Problem = { id: `mcu:${kind}:${id}`, level, source: 'mcu', title, detail, componentIds: [id], holes: [], fact: `${MCU_FACT[kind] ?? kind}:${id}` }
      if (action) p.action = action
      out.push(p)
      return p
    }
    // a core in its own fault handler (IPSR 3–6 — QA IN-F7): the frame says 'running', the firmware is stuck
    const faultRow = (): void => {
      const { exception, fault } = frameFaultOf(frame)
      const name = faultExceptionName(exception)
      if (!name) return
      const p = mcu(
        'fault-handler',
        'error',
        t('{id} hit a {fault} — the firmware is stuck in {handler}', { id, fault: name, handler: `${name}_Handler` }),
        faultHandlerDetail(exception, fault),
        { label: t('See the registers'), run: () => showRegisters(id) },
      )
      if (!isLegacyChrome()) p.extraActions = [{ label: t('Show in the simulation log'), run: () => openSimulationLog() }]
    }
    if (!input.firmware[id]) {
      if (!input.firmwareGrace?.has(id)) {
        mcu(
          'no-firmware',
          'warning',
          t('{id} has no firmware yet', { id }),
          t('This board has no program to run. Pick a built-in firmware (for example hal-blink) or load an .elf / .bin / .hex file from your computer.'),
          { label: t('Load firmware…'), run: () => openFirmwareFor(id) },
        )
      }
      continue
    }
    if (!frame) continue
    if (frame.state === 'lockup') {
      // the cause the bound image names (QA clarity LOCKUP-CAUSE) — the 執行狀態 card says the same
      // words and offers the fix — else the common causes
      const cause = lockupCauseOf(input.firmware[id], loaderWarningsOf(input, id))
      mcu(
        'lockup',
        'error',
        t('{id} fault (lockup)', { id }),
        cause
          ? lockupCauseText(cause)
          : t('The core hit a fault while handling a fault and stopped. Common causes: no vector table at 0x08000000, or a bad stack pointer.'),
        { label: t('See why'), run: () => showExecutionState(id) },
      )
    } else if (frame.state === 'halted') {
      // a state, not a risk (QA IN-F3): listed under 「目前狀態」, not counted
      mcu(
        'halted',
        'warning',
        t('{id} core halted (debugger)', { id }),
        t('The debugger stopped the core, so the whole simulation is frozen. Resume to keep running.'),
        { label: t('Resume running'), run: () => runOrResume() },
      ).state = true
      // halted inside its fault handler (「查看暫存器」 halts it): the fault stays the problem
      faultRow()
    } else if ((frame.state === 'running' || frame.state === 'sleeping') && inSystemMemory(frame.pc)) {
      mcu(
        'boot-sysmem',
        'warning',
        t('{id} boots from system memory (not simulated)', { id }),
        t('BOOT0 = 1: the MCU starts the built-in bootloader, which is not simulated. Set the BOOT0 jumper back to 0, then press Reset MCU.'),
        { label: t('See why'), run: () => showExecutionState(id) },
      )
    } else if ((frame.state === 'running' || frame.state === 'sleeping') && faultExceptionName(frameFaultOf(frame).exception)) {
      faultRow()
    } else if (frame.state === 'unpowered' && input.running && input.simTime > POWER_UP_GRACE_S && !unpoweredByErc.has(id) && !anyUnpoweredErc) {
      mcu(
        'unpowered',
        'warning',
        t('{id} has no power', { id }),
        t('VDD is below 2.0 V, so the MCU is held in reset. Connect the 5V or 3V3 pin to a supply and the G pin to the − rail.'),
        { label: t('See why'), run: () => showExecutionState(id) },
      )
    }
  }

  // ---- one fact, one row (IN-13): 'power:*' covers every board's power fact
  const anyPower = out.some((p) => p.fact === 'power:*')
  const keyOf = (p: Problem): string => {
    if (p.fact) return anyPower && p.fact.startsWith('power:') ? 'power:*' : p.fact
    return `${p.componentIds[0] ?? ''}\u0000${p.title}`
  }
  const byKey = new Map<string, Problem[]>()
  for (const p of out) {
    const k = keyOf(p)
    const list = byKey.get(k)
    if (list) list.push(p)
    else byKey.set(k, [p])
  }
  let rows: Problem[] = []
  for (const list of byKey.values()) {
    if (list.length === 1) {
      rows.push(list[0])
      continue
    }
    const keep = [...list].sort((a, b) => (a.action ? 0 : 1) - (b.action ? 0 : 1) || KEEP_ORDER[a.source] - KEEP_ORDER[b.source])[0]
    const kept: Problem = { ...keep, componentIds: [...keep.componentIds], holes: [...keep.holes] }
    const raw = simMessage.get(keep)
    if (raw !== undefined) simMessage.set(kept, raw)
    for (const p of list) {
      if (p === keep) continue
      absorb(kept, p)
      // the simulator's extra clause belongs to the kept explanation (「目前開發板僅以電氣方式模擬」)
      if (/simulated electrically only/.test(simMessage.get(p) ?? '') && kept.fact?.startsWith('fw-missing:')) {
        kept.detail = appendSentence(kept.detail, t('Until then the board is simulated electrically only.'))
      }
    }
    if (keep.fact?.startsWith('power:') && keyOf(keep) === 'power:*' && keep.fact !== 'power:*') kept.fact = 'power:*'
    rows.push(kept)
  }

  // ---- consequences of a board-state fact (IN-15 (2)): a board that cannot
  // run its firmware (no power / no firmware / lockup / halt / BOOT0) — the
  // findings that read its firmware's pin modes fold under the state row
  const stateRow = new Map<string, Problem>()
  for (const p of rows) {
    const m = p.fact ? BLOCKER_FACT.exec(p.fact) : null
    if (!m) continue
    const boards = m[2] === '*' ? layout.components.filter((c) => getEntry(c.type)?.mcu).map((c) => c.id) : [m[2]]
    for (const b of boards) {
      const cur = stateRow.get(b)
      const kind = m[1] as BoardBlockerKind
      if (!cur || BLOCKER_ORDER.indexOf(kind) < BLOCKER_ORDER.indexOf(BLOCKER_FACT.exec(cur.fact!)![1] as BoardBlockerKind)) stateRow.set(b, p)
    }
  }
  if (stateRow.size > 0) {
    const keep: Problem[] = []
    for (const p of rows) {
      const board = [...stateRow.keys()].find((b) => stateRow.get(b) !== p && firmwareDependent(p, b))
      if (!board) {
        keep.push(p)
        continue
      }
      const root = stateRow.get(board)!
      fold(root, t('Consequences (fix first: {what})', { what: bareTitle(root.title) }), [p.title])
    }
    rows = keep
  }

  // ---- a floating MCU pin that the gpio-mode finding of that very pin already
  // explains (「LED1 接在 PA5，但 PA5 不是輸出」): one row, the float folded (QA IN-F2)
  const gpioRows = new Map<string, Problem>()
  for (const p of rows) if (p.rule === 'gpio-mode' && p.id.startsWith('erc:gpio-mode:')) gpioRows.set(p.id.slice('erc:gpio-mode:'.length), p)
  if (gpioRows.size > 0) {
    const related = new Map<Problem, string[]>()
    rows = rows.filter((p) => {
      const root = p.source === 'sim' && p.fact?.startsWith('float:') ? gpioRows.get(p.fact.slice('float:'.length)) : undefined
      if (!root) return true
      related.set(root, [...(related.get(root) ?? []), p.title])
      return false
    })
    for (const [root, titles] of related) fold(root, t('{n} more related', { n: titles.length }), titles)
  }

  // ---- readings that cannot be trusted (IN-14): the solver did not converge,
  // or a board has no GND / no power — its per-pin readings (−1261957 V …)
  // fold under the root cause, their values shown as 「—」
  const solver = rows.filter((p) => SOLVER_TROUBLE.test(simMessage.get(p) ?? ''))
  const blocked = (board: string): Problem | undefined =>
    rows.find((p) => p.level === 'error' && (p.fact === `power:${board}` || p.fact === 'power:*'))
  const readings = rows.filter((p) => {
    const m = PIN_READING.exec(simMessage.get(p) ?? '')
    return m !== null && (solver.length > 0 || blocked(m[1]) !== undefined)
  })
  if (readings.length > 0 || solver.length > 0) {
    const firstError = rows.find((p) => p.level === 'error' && !solver.includes(p) && !readings.includes(p))
    const gone = new Set<Problem>()
    const rootOf = (p: Problem): Problem | undefined => {
      const m = PIN_READING.exec(simMessage.get(p) ?? '')
      return (m ? blocked(m[1]) : undefined) ?? firstError
    }
    const groups = new Map<Problem, Problem[]>()
    for (const p of [...readings, ...solver]) {
      const root = rootOf(p) ?? solver[0]
      if (!root || root === p) continue
      const list = groups.get(root)
      if (list) list.push(p)
      else groups.set(root, [p])
    }
    // a solver row that is itself the root keeps its readings
    if (!firstError && solver.length > 0 && readings.length > 0 && !groups.has(solver[0])) {
      const own = readings.filter((p) => !rootOf(p))
      if (own.length > 0) groups.set(solver[0], own)
    }
    for (const [root, list] of groups) {
      const n = list.filter((p) => readings.includes(p)).length
      const board = (/^power:(.+)$/.exec(root.fact ?? '') ?? [])[1]
      const why =
        n === 0
          ? t('The simulator cannot solve the circuit while this fault is there, so its readings may be wrong.')
          : board && board !== '*'
            ? root.rule === 'ground-reference'
              ? t('Because {id}’s GND is not connected, the circuit has no reference point, so the pin voltages cannot be computed ({n} pin readings hidden).', { id: board, n })
              : t('Because {id} has no power, its pin voltages cannot be computed ({n} pin readings hidden).', { id: board, n })
            : board === '*'
              ? t('With no power source the circuit has no reference point, so the pin voltages cannot be computed ({n} pin readings hidden).', { n })
              : solver.includes(root)
                ? t('The pin voltages cannot be computed ({n} pin readings hidden).', { n })
                : t('The simulator cannot solve the circuit while this fault is there, so its readings are hidden ({n}).', { n })
      root.detail = appendSentence(root.detail, why)
      fold(
        root,
        t('Hidden readings'),
        list.map((p) => withoutValue(p.detail)),
      )
      for (const p of list) gone.add(p)
    }
    rows = rows.filter((p) => !gone.has(p))
  }

  // ---- a supply's > 2 A is a consequence of the short that causes it (AN2-19)
  const short = rows.find((p) => p.rule === 'supply-short' && p.level === 'error')
  if (short) {
    const over = rows.filter((p) => p.fact?.startsWith('overcurrent-supply:'))
    if (over.length > 0) {
      fold(short, t('Consequences (fix first: {what})', { what: bareTitle(short.title) }), over.map((p) => p.title))
      for (const p of over) absorb(short, { ...p, level: short.level })
      rows = rows.filter((p) => !over.includes(p))
    }
  }

  // ---- firmware-dependent findings before the firmware ran: 「執行後確認」 (IN-16)
  if (input.pendingBoards && input.pendingBoards.size > 0) {
    for (const p of rows) {
      if (p.level === 'error' || p.source !== 'erc') continue
      if (![...input.pendingBoards].some((b) => firmwareDependent(p, b))) continue
      p.level = 'info'
      p.pendingRuntime = true
    }
  }

  // ---- one cause, one row (IN-13 (5)): findings sharing ErcFinding.group
  const grouped: Problem[] = []
  const byGroup = new Map<string, Problem[]>()
  for (const p of rows) {
    const k = p.group ? `${p.level}:${p.group}` : null
    const list = k ? byGroup.get(k) : undefined
    if (list) {
      list.push(p)
      continue
    }
    if (k) byGroup.set(k, [p])
    grouped.push(p)
  }
  rows = grouped.map((head) => {
    const list = head.group ? (byGroup.get(`${head.level}:${head.group}`) ?? [head]) : [head]
    if (list.length < 2) return head
    const merged: Problem = { ...head, componentIds: [...head.componentIds], holes: [...head.holes], title: mergeTitles(list.map((p) => p.title)), affects: list.length }
    for (const p of list.slice(1)) {
      absorb(merged, p)
      if (!merged.action && p.action) merged.action = p.action
      if (p.folded) fold(merged, p.folded.head, p.folded.items)
    }
    return merged
  })

  // ---- damage honesty (vivid): a board pin the simulation MEASURED beyond its
  // absolute maximum rating (DS5319 Table 7) — the chip may be damaged and the
  // model's behaviour is no longer a promise; said once, on the row of that fact
  const damaged = pinDamageFromIssues(input.issues)
  if (damaged.length > 0) {
    for (const p of rows) {
      const m = p.fact ? /^(absmax|overcurrent):([^:]+):(.+)$/.exec(p.fact) : null
      if (!m || !damaged.some((d) => d.componentId === m[2] && d.pin === m[3])) continue
      p.detail = appendSentence(
        p.detail,
        t('Beyond its absolute maximum rating a real chip’s pin may already be damaged — from here on the simulation no longer guarantees how {id} behaves. Fix the cause, then reset the simulation.', { id: m[2] }),
      )
    }
  }

  // ---- actions the rows' facts call for
  for (const p of rows) {
    if (p.action) continue
    const fact = p.fact ?? ''
    if (fact.startsWith('reversed:') && canSwapLeads(layout, fact.slice('reversed:'.length))) {
      const id = fact.slice('reversed:'.length)
      p.action = { label: t('Swap the leads'), run: () => swapLeadsWithFeedback(id) }
    } else if ((/^(gpio-clock|tim-moe|clock-limit|af-conflict):/.test(fact) || p.id.startsWith('log:')) && !isLegacyChrome()) {
      // the desktop tray's log tab, or the phone's 儀器 sheet on its log view (the shell's showInstrument)
      p.action = { label: t('Show in the simulation log'), run: () => openSimulationLog() }
    }
  }

  // ---- transient warnings the live readings retracted (IN-16)
  const cleared: Problem[] = []
  if (input.cleared && input.cleared.size > 0) {
    rows = rows.filter((p) => {
      const note = p.fact ? input.cleared!.get(p.fact) : undefined
      if (note === undefined) return true
      cleared.push({ ...p, note })
      return false
    })
  }

  const problems = rows
    .map((p, i) => ({ p, i }))
    .sort((a, b) => LEVEL_ORDER[a.p.level] - LEVEL_ORDER[b.p.level] || SOURCE_ORDER[a.p.source] - SOURCE_ORDER[b.p.source] || a.i - b.i)
    .map((x) => x.p)
  return { problems, cleared }
}

/** The pure derivation behind useProblems (UI language of the moment). */
export function deriveProblems(input: ProblemsInput): Problem[] {
  return deriveProblemsDetailed(input).problems
}

/**
 * 「對調兩腳」 with an answer (QA IN-F8): swap the two holes of a placed
 * two-lead part (H8 swapLeads — one undo step) and say what happened —
 * 「已對調 LED1 的兩腳」, or 「無法對調 LED1 的兩腳」 when the swap was refused.
 */
export function swapLeadsWithFeedback(componentId: string): boolean {
  const { ok } = useStore.getState().swapLeads(componentId)
  if (ok) tick()
  showToast(ok ? t('Swapped the leads of {id}', { id: componentId }) : t('Could not swap the leads of {id}', { id: componentId }))
  return ok
}

/**
 * 「查看暫存器」 of a core stuck in its fault handler (QA IN-F7): halt it
 * (registers are read from a stopped core), bring its 概況 tab up and, once
 * the halted core was read (McuPanel's register rows, #regs-{id}), scroll the
 * registers and the decoded fault bits into view — what the button promised.
 */
export function showRegisters(componentId: string): void {
  const lab = useLab.getState()
  const state = lab.mcus[componentId]?.state
  if (state === 'running' || state === 'sleeping') lab.mcuHalt(componentId)
  focusInspector(componentId, { tab: 'overview' })
  scrollWhenShown(`regs-${componentId}`)
}

/**
 * 「查看原因」 of a board-state row (lockup, BOOT0 = 1, no power — QA clarity
 * LOCKUP-CAUSE): the board's 概況 tab with its 執行狀態 card, where the reason
 * and its fix are, in view (#exec-{id}).
 */
export function showExecutionState(componentId: string): void {
  focusInspector(componentId, { tab: 'overview' })
  scrollWhenShown(`exec-${componentId}`)
}

/** The loader's warnings for `board`'s current image, from the log rows since its last load (`<id>/loader`). */
function loaderWarningsOf(input: ProblemsInput, board: string): string[] {
  const since = input.loadedAt?.[board] ?? 0
  const source = `${board}/loader`
  return (input.log ?? []).filter((e) => e.source === source && e.level !== 'info' && e.time >= since).map((e) => e.message)
}

/** Scroll element #id into view as soon as it exists (checked each frame, for up to `ms`). */
function scrollWhenShown(id: string, ms = 2000): void {
  if (typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') return
  const t0 = Date.now()
  const look = (): void => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
      return
    }
    if (Date.now() - t0 < ms) requestAnimationFrame(look)
  }
  // after focusInspector's own scroll to the part (two frames)
  afterLayout(() => requestAnimationFrame(look))
}

/** Is `p` a board-state fact of board `componentId` (power / firmware / lockup / halt / BOOT0 — H5 blockerKindOf)? */
export function isBoardStateOf(p: Problem, componentId: string): boolean {
  return blockerKindOf(p, componentId) !== null
}

/**
 * "在模擬日誌中檢視": the simulation log where the instruments live — the
 * workspace tray on its log tab, or the 儀器 sheet presented on its log view
 * (phones, narrow windows). The classic chrome has no such link.
 */
export function openSimulationLog(): void {
  showInstrument('log')
}

// ---------------------------------------------------------------------------
// the simulation log: peripheral warnings that are user mistakes (IN-15 (4))
// ---------------------------------------------------------------------------

/** TIM1 / TIM8 channel pins at the reset mapping (CH1–CH4) — the advanced timers' MOE gate. */
const ADV_TIMER_PINS: Record<string, readonly string[]> = { TIM1: ['PA8', 'PA9', 'PA10', 'PA11'] }

const LOG_MOE = /^(TIM\d+) is counting with CCxE\/CCxNE set but BDTR\.MOE = 0/
const LOG_GATED = /^(?:write to|read of) (\S+) (?:ignored|returned 0): (RCC_\w+)\.(\w+) = 0: /
const LOG_CLOCK_LIMIT = /^(SYSCLK|HCLK|PCLK1|PCLK2|ADCCLK) (\S+ MHz) exceeds the (\d+) MHz/
const LOG_AF_CONFLICT = /^(.+) both drive (P[A-G]\d{1,2}) as an alternate function/

/** The board id and peripheral of a log source 'U1/TIM1' (null = not a board peripheral). */
function logBoard(source: string): string | null {
  const m = /^([^/]+)\/(\S+)$/.exec(source)
  return m ? m[1] : null
}

/**
 * Warnings of the simulation log that are user mistakes, one row per fact
 * (the same warning logged twice is one row): TIM1 counting with MOE = 0
 * (「TIM1 的輸出被關閉（MOE = 0）——PA8 沒有 PWM」), a peripheral used with
 * its clock off, a bus clock above its limit, two alternate functions on one
 * pin. Only entries since the board's last firmware load count.
 */
function logProblems(input: ProblemsInput): Problem[] {
  const out = new Map<string, Problem>()
  if (!input.log || input.log.length === 0) return []
  for (const e of input.log) {
    if (e.level !== 'warning' && e.level !== 'error') continue
    const board = logBoard(e.source)
    if (!board) continue
    const comp = input.layout.components.find((c) => c.id === board)
    const entry = comp ? getEntry(comp.type) : undefined
    if (!entry?.mcu) continue
    if (e.time < (input.loadedAt?.[board] ?? 0)) continue
    let fact: string | null = null
    let title = ''
    let pins: string[] = []
    let m = LOG_MOE.exec(e.message)
    if (m) {
      const tim = m[1]
      pins = timerPwmPins(input, board, entry, tim)
      fact = `tim-moe:${board}:${tim}`
      title = pins.length > 0 ? t('{tim} outputs are off (MOE = 0) — {pins} has no PWM', { tim, pins: pins.join(t(', ')) }) : t('{tim} outputs are off (MOE = 0) — no PWM', { tim })
    } else if ((m = LOG_GATED.exec(e.message))) {
      fact = `gpio-clock:${board}:${m[1]}`
      title = m[1].startsWith('GPIO') ? t('{p} has no clock — its pins ignore the firmware', { p: m[1] }) : t('{p} has no clock — the firmware cannot use it', { p: m[1] })
    } else if ((m = LOG_CLOCK_LIMIT.exec(e.message))) {
      fact = `clock-limit:${board}:${m[1]}`
      title = t('{clk} is {f}, above its {max} MHz limit', { clk: m[1], f: m[2], max: m[3] })
    } else if ((m = LOG_AF_CONFLICT.exec(e.message))) {
      fact = `af-conflict:${board}:${m[2]}`
      pins = [m[2]]
      title = t('Two peripherals drive {pin}', { pin: m[2] })
    }
    if (!fact || out.has(fact)) continue
    const holes = pinHoles(input.layout, board, pins)
    out.set(fact, {
      id: `log:${fact}`,
      level: 'warning',
      source: 'sim',
      title,
      detail: tMessage(e.message),
      componentIds: [board],
      holes,
      fact,
    })
  }
  return [...out.values()]
}

/** The channel pins of an advanced timer the firmware set up as its outputs (alternate function, not a UART's). */
function timerPwmPins(input: ProblemsInput, board: string, entry: CatalogEntry, tim: string): string[] {
  const modes = input.telemetry?.components[board]?.mcu?.pinModes
  // the board's USARTs and AFIO_MAPR (H10): the same facts as the inspector's pin rows and the LA picker
  const pfc = pinFunctionContext(input.mcus[board])
  const pins = ADV_TIMER_PINS[tim] ?? []
  return pins.filter((pin) => {
    const mode = modes?.[pin]
    if (mode !== 'af') return false
    const fns = entry.pinInfo?.find((p) => p.pin === pin)?.functions ?? []
    const fn = activePinFunction(fns, mode, pfc)
    return fn === null || fn.startsWith(tim)
  })
}

/** Holes of a board's pins (catalog pin names). */
function pinHoles(layout: CircuitLayout, board: string, pins: readonly string[]): string[] {
  if (pins.length === 0) return []
  const out: string[] = []
  for (const [hole, at] of holeIndex(layout)) if (at.id === board && pins.includes(at.pin)) out.push(hole)
  return out
}

/** Errors / warnings / hints — a board STATE (Problem.state: the debugger halt) is not counted (QA IN-F3). */
export function countProblems(problems: readonly Problem[]): ProblemCounts {
  const n: ProblemCounts = { error: 0, warning: 0, info: 0 }
  for (const p of problems) if (!p.state) n[p.level]++
  return n
}

/** The first error or warning (problems are sorted). */
export function topProblem(problems: readonly Problem[]): Problem | null {
  const p = problems[0]
  return p && p.level !== 'info' ? p : null
}

// ---------------------------------------------------------------------------
// watcher
// ---------------------------------------------------------------------------

/** Layout / firmware / run-state changes: debounce. */
export const PROBLEMS_DEBOUNCE_MS = 250
/** Live data (telemetry, issues, MCU frames): at most once per … */
export const PROBLEMS_LIVE_MS = 1000
/** A newly placed / loaded board gets this long to receive its firmware. */
export const FIRMWARE_GRACE_MS = 1000

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** board id → when it (re)appeared in the layout */
let boardSeenAt = new Map<string, number>()
let lastPublishedKey = ''

function trackBoards(layout: CircuitLayout, now: number): void {
  const next = new Map<string, number>()
  for (const c of layout.components) {
    if (!getEntry(c.type)?.mcu) continue
    next.set(c.id, boardSeenAt.get(c.id) ?? now)
  }
  boardSeenAt = next
}

/** Signature of what the UI shows (actions are rebuilt per run; their meaning follows the data). */
function keyOf(s: Omit<ProblemsState, 'findings' | 'layout'>): string {
  return JSON.stringify([
    s.live,
    s.ercError,
    s.problems.map((p) => [
      p.id,
      p.level,
      p.title,
      p.detail,
      p.action?.label ?? '',
      p.extraActions?.map((a) => a.label) ?? [],
      p.affects ?? 0,
      p.folded ?? null,
      p.note ?? '',
      p.pendingRuntime ?? false,
      p.state ?? false,
    ]),
    s.resolved.map((p) => [p.id, p.title, p.note ?? '']),
  ])
}

/** The static ERC run of a layout, cached per layout identity (the live run changes at 1 Hz, the layout does not). */
let staticCache: { layout: CircuitLayout; findings: ErcFinding[] } | null = null
function staticFindings(layout: CircuitLayout): ErcFinding[] {
  if (staticCache?.layout !== layout) {
    let findings: ErcFinding[] = []
    try {
      findings = runErc(layout)
    } catch {
      findings = []
    }
    staticCache = { layout, findings }
  }
  return staticCache.findings
}

/** "ELF32 ARM, Thumb entry 0x08000B45" → 0x08000B44: the PC a board starts from after a reset. */
function entryPcOf(record: FirmwareRecord | undefined): number | undefined {
  const m = /\bentry (0x[0-9a-f]+)/i.exec(record?.description ?? '')
  return m ? parseInt(m[1].slice(2), 16) & ~1 : undefined
}

/** Per-board reset / load times from the lab's terminal marks (since the simulation's last reset). */
function boardMarks(): { resetAt: Record<string, number>; loadedAt: Record<string, number> } {
  const resetAt: Record<string, number> = {}
  const loadedAt: Record<string, number> = {}
  for (const m of labBuffers.terminalMarks()) {
    resetAt[m.componentId] = Math.max(resetAt[m.componentId] ?? 0, m.t)
    if (m.kind === 'load') loadedAt[m.componentId] = Math.max(loadedAt[m.componentId] ?? 0, m.t)
  }
  return { resetAt, loadedAt }
}

/** "write to GPIOA ignored: RCC_APB2ENR.IOPAEN = 0 …" in the log → board → ['GPIOA'] (since the board's last load). */
function unclockedPortsOf(log: readonly SimLogEntry[], loadedAt: Readonly<Record<string, number>>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const e of log) {
    if (e.level === 'info') continue
    const m = /^write to (GPIO[A-G]) ignored: RCC_APB2ENR\.IOP[A-G]EN = 0/.exec(e.message)
    const board = m ? logBoard(e.source) : null
    if (!m || !board || e.time < (loadedAt[board] ?? 0)) continue
    const list = (out[board] ??= [])
    if (!list.includes(m[1])) list.push(m[1])
  }
  return out
}

/** Warnings of the log worth scanning (the ring holds up to a few thousand lines; most are info). */
let logCache: { log: readonly SimLogEntry[]; warnings: SimLogEntry[] } | null = null
function logWarnings(): SimLogEntry[] {
  const log = labBuffers.log()
  if (logCache?.log !== log) logCache = { log, warnings: log.filter((e) => e.level !== 'info') }
  return logCache.warnings
}

/**
 * A reversed LED the running simulation measured stays reported for as long
 * as the circuit and the simulation session are the same: a blinking pin
 * reverse-biases it only half of the time, and a fact that was measured does
 * not stop being true when the pin goes low (IN-17).
 */
let reversedLatch: { layout: CircuitLayout; findings: Map<string, ErcFinding> } | null = null
/**
 * A telemetry snapshot in which an LED the static rules suspect (a reversed
 * LED facing a GPIO, level info) was measured reverse-biased — caught by the
 * watcher on ANY telemetry update, not only at the ≤ 1 Hz recompute, so a pin
 * that blinks at the recompute's own rate cannot hide it (aliasing).
 */
let reversedEvidence: { layout: CircuitLayout; telemetry: SimTelemetry } | null = null

/** The LEDs the last published ERC run suspects of facing a GPIO the wrong way (info), by id. */
function reversalSuspects(): string[] {
  const out: string[] = []
  for (const f of useProblems.getState().findings) {
    if (f.level === 'info' && f.fact?.startsWith('reversed:')) out.push(f.fact.slice('reversed:'.length))
  }
  return out
}

/** Does `telemetry` show a suspect reverse-biased (the cathode > 1 V above the anode, no current)? */
export function seesReversal(telemetry: SimTelemetry | null, ids: readonly string[]): boolean {
  if (!telemetry) return false
  for (const id of ids) {
    const t = telemetry.components[id]
    const va = t?.pinVoltages?.anode
    const vk = t?.pinVoltages?.cathode
    if (typeof va !== 'number' || typeof vk !== 'number' || typeof t?.current !== 'number') continue
    if (vk - va > 1.0 && Math.abs(t.current) < 1e-6) return true
  }
  return false
}

function latchReversed(layout: CircuitLayout, findings: ErcFinding[], live: boolean): ErcFinding[] {
  if (!live) {
    reversedLatch = null
    reversedEvidence = null
    return findings
  }
  if (reversedLatch?.layout !== layout) reversedLatch = { layout, findings: new Map() }
  // evidence a telemetry update caught between two recomputes: the same rules, on that snapshot
  if (reversedEvidence?.layout === layout) {
    try {
      for (const f of runErc(layout, { telemetry: reversedEvidence.telemetry })) {
        if (f.fact?.startsWith('reversed:') && f.level === 'error') reversedLatch.findings.set(f.id, f)
      }
    } catch {
      // a rule that throws reports through the main run
    }
  }
  reversedEvidence = null
  for (const f of findings) if (f.fact?.startsWith('reversed:') && f.level === 'error') reversedLatch.findings.set(f.id, f)
  if (reversedLatch.findings.size === 0) return findings
  const out = findings.filter((f) => !(reversedLatch!.findings.has(f.id) && f.level !== 'error'))
  for (const [id, f] of reversedLatch.findings) if (!out.some((x) => x.id === id)) out.push(f)
  return out
}

/**
 * Transient floating-input warnings (IN-16): fact → the sim time the watcher
 * first saw it; cleared when the input's net shows activity since then, or
 * the MCU pin on its net is now an output (the float happened while the MCU
 * was in reset). Forgotten with the simulation session.
 */
let floatSeen = new Map<string, number>()
let lastSimTime = 0

/** The MCU pins on the net of `componentId`'s pin `pin` (catalog pins), per layout identity. */
let netCache: { layout: CircuitLayout; netlist: Netlist } | null = null
function mcuPinsOnNet(layout: CircuitLayout, componentId: string, pin: string): { board: string; pin: string; entry: CatalogEntry }[] {
  if (netCache?.layout !== layout) netCache = { layout, netlist: buildNetlist(layout) }
  const netlist = netCache.netlist
  const index = holeIndex(layout)
  let net: string | null = null
  for (const [ref, at] of index) {
    if (at.id === componentId && at.pin === pin) {
      net = netlist.netOf(ref)
      break
    }
  }
  if (!net) return []
  const out: { board: string; pin: string; entry: CatalogEntry }[] = []
  for (const [ref, at] of index) {
    if (at.id === componentId || netlist.netOf(ref) !== net) continue
    const entry = getEntry(layout.components.find((c) => c.id === at.id)?.type ?? '')
    if (entry?.mcu?.pinMap[at.pin]) out.push({ board: at.id, pin: at.pin, entry })
  }
  return out
}

const DRIVEN = new Set(['out', 'af'])

/** fact → note for every floating-input warning the live readings retracted. */
function retractedFloats(issues: readonly SimIssue[], layout: CircuitLayout, telemetry: SimTelemetry | null, simTime: number): Map<string, string> {
  const cleared = new Map<string, string>()
  if (!telemetry) {
    floatSeen = new Map()
    return cleared
  }
  if (simTime < lastSimTime) floatSeen = new Map() // the simulation was reset
  lastSimTime = simTime
  for (const issue of issues) {
    const fact = simIssueFact(issue)
    if (!fact?.startsWith('float:')) continue
    const [, id, pin] = fact.split(':')
    if (!floatSeen.has(fact)) floatSeen.set(fact, simTime)
    const since = floatSeen.get(fact)!
    const drivers = mcuPinsOnNet(layout, id, pin)
    const driving = drivers.find((d) => DRIVEN.has(telemetry.components[d.board]?.mcu?.pinModes?.[d.pin] ?? ''))
    let active = false
    try {
      active = hasActivity({ componentId: id, pin }, since)
    } catch {
      active = false
    }
    if (!driving && !active) continue
    const by = driving ?? drivers[0]
    cleared.set(
      fact,
      by
        ? t('{id} {pin} floated briefly at start-up (the MCU pins are high-impedance during reset); {by} drives it since.', {
            id,
            pin,
            by: pinLabel(by.entry, by.pin, { form: 'short' }),
          })
        : t('{id} {pin} floated briefly at start-up; it has a signal since.', { id, pin }),
    )
  }
  return cleared
}

/**
 * Compute the problems from the live stores now and publish them when they
 * differ from the last result. Returns the ms until a grace period ends
 * (the watcher re-runs then), or null.
 */
export function recomputeProblems(now: number = nowMs()): number | null {
  const s = useStore.getState()
  const lab = useLab.getState()
  trackBoards(s.layout, now)
  const telemetry: SimTelemetry | null = s.telemetry
  const { resetAt, loadedAt } = boardMarks()
  const log = logWarnings()
  // every board with firmware: its pin modes count from its last reset / load (0 = the session start)
  const mcuResetAt: Record<string, number> = {}
  const mcuResetPc: Record<string, number> = {}
  for (const id of Object.keys(lab.firmware)) {
    mcuResetAt[id] = resetAt[id] ?? 0
    const pc = entryPcOf(lab.firmware[id])
    if (pc !== undefined) mcuResetPc[id] = pc
  }
  let findings: ErcFinding[] = []
  let ercError: string | null = null
  try {
    findings = runErc(s.layout, { telemetry, issues: s.issues, mcuResetAt, mcuResetPc, unclockedPorts: unclockedPortsOf(log, loadedAt) })
  } catch (err) {
    ercError = String(err)
  }
  findings = latchReversed(s.layout, findings, telemetry !== null)
  const grace = new Set<string>()
  let wake: number | null = null
  for (const [id, at] of boardSeenAt) {
    const left = at + FIRMWARE_GRACE_MS - now
    if (left > 0 && !lab.firmware[id]) {
      grace.add(id)
      wake = wake === null ? left : Math.min(wake, left)
    }
  }
  // boards whose firmware has not set its pins up yet (bound, not run / not settled since its reset)
  const pendingBoards = new Set<string>()
  for (const id of Object.keys(lab.firmware)) {
    const mcu = telemetry?.components[id]?.mcu
    if (!telemetry) pendingBoards.add(id)
    else if (mcu && (mcu.state === 'running' || mcu.state === 'sleeping')) {
      if (!firmwareModesSettled(mcu, { time: telemetry.time, resetAt: mcuResetAt[id], resetPc: mcuResetPc[id] }, MODE_SETTLE_S)) pendingBoards.add(id)
    }
  }
  const cleared = retractedFloats(s.issues, s.layout, telemetry, s.simTime)
  const { problems, cleared: retracted } = deriveProblemsDetailed({
    layout: s.layout,
    findings,
    issues: s.issues,
    firmware: lab.firmware,
    mcus: currentFrames(lab.mcus),
    running: s.running,
    simTime: s.simTime,
    firmwareGrace: grace,
    pendingBoards,
    log,
    loadedAt,
    telemetry,
    cleared,
  })
  const resolved = [
    ...(telemetry !== null && ercError === null ? resolvedByLive(staticFindings(s.layout), findings, s.layout) : []),
    ...retracted,
  ]
  const next = { problems, counts: countProblems(problems), top: topProblem(problems), live: telemetry !== null, ercError, resolved }
  const key = keyOf(next)
  if (key !== lastPublishedKey) {
    lastPublishedKey = key
    useProblems.setState({ ...next, findings, layout: s.layout })
  } else if (useProblems.getState().layout !== s.layout) {
    // same rows, newer circuit: only the stamp moves (no list re-render)
    useProblems.setState({ layout: s.layout })
  }
  return wake
}

/** Live subscriptions, shared by every started watcher (reference-counted). */
let watcher: { refs: number; stop: () => void } | null = null

/**
 * Keep useProblems current (App.tsx: useEffect(() => startProblemsWatcher(), [])).
 * Computes once right away, then on store changes at the rates above and on
 * a language switch. Returns the stop function (idempotent). Starting twice
 * (React StrictMode, a second host) shares one set of subscriptions; they
 * end when the last starter stops.
 */
export function startProblemsWatcher(): () => void {
  if (watcher) watcher.refs++
  else watcher = { refs: 1, stop: subscribeProblems() }
  let stopped = false
  return () => {
    if (stopped || !watcher) return
    stopped = true
    watcher.refs--
    if (watcher.refs > 0) return
    watcher.stop()
    watcher = null
  }
}

function subscribeProblems(): () => void {
  trackMcuResets()
  let timer: ReturnType<typeof setTimeout> | null = null
  let due = Number.POSITIVE_INFINITY
  let lastRun = Number.NEGATIVE_INFINITY

  const run = (): void => {
    timer = null
    due = Number.POSITIVE_INFINITY
    lastRun = nowMs()
    const wake = recomputeProblems(lastRun)
    if (wake !== null) arm(lastRun + wake + 5)
  }
  const arm = (at: number): void => {
    if (timer !== null && at >= due) return
    if (timer !== null) clearTimeout(timer)
    due = at
    timer = setTimeout(run, Math.max(0, at - nowMs()))
  }
  /** a structural change: debounce — run PROBLEMS_DEBOUNCE_MS after the last one (absorbs a pending live run) */
  const structural = (): void => {
    const at = nowMs() + PROBLEMS_DEBOUNCE_MS
    if (timer !== null) clearTimeout(timer)
    due = at
    timer = setTimeout(run, PROBLEMS_DEBOUNCE_MS)
  }
  /** live data: throttle to one run per PROBLEMS_LIVE_MS */
  const live = (): void => arm(Math.max(nowMs(), lastRun + PROBLEMS_LIVE_MS))

  const unStore = useStore.subscribe((s, prev) => {
    if (s.layout !== prev.layout || s.running !== prev.running) structural()
    else if (s.telemetry !== prev.telemetry || s.issues !== prev.issues || (s.simTime === 0) !== (prev.simTime === 0)) {
      // a suspected reversed LED caught reverse-biased in this snapshot: keep it as evidence (IN-17)
      if (s.telemetry !== prev.telemetry && !reversedEvidence) {
        const ids = reversalSuspects()
        if (ids.length > 0 && seesReversal(s.telemetry, ids)) reversedEvidence = { layout: s.layout, telemetry: s.telemetry! }
      }
      live()
    }
  })
  const unMarks = useResetMarks.subscribe(() => structural())
  const unLab = useLab.subscribe((s, prev) => {
    if (s.firmware !== prev.firmware) structural()
    else if (s.mcus !== prev.mcus || s.logVersion !== prev.logVersion) live()
  })
  const unLang = onLangChange(() => {
    lastPublishedKey = '' // texts change language: always re-publish
    if (timer !== null) clearTimeout(timer)
    run()
  })
  run()
  return () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    unStore()
    unLab()
    unMarks()
    unLang()
  }
}

/** TEST-ONLY: forget the published state and board timestamps. */
export function __resetProblemsForTests(): void {
  if (watcher) watcher.stop()
  watcher = null
  boardSeenAt = new Map()
  lastPublishedKey = ''
  staticCache = null
  reversedLatch = null
  reversedEvidence = null
  floatSeen = new Map()
  lastSimTime = 0
  logCache = null
  useResetMarks.setState({ marks: {} })
  useProblems.setState({ ...EMPTY })
  useInspectorFocus.setState({ request: null })
  useFirmwarePickerRequest.setState({ request: null })
}
